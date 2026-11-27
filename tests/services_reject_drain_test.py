import importlib.util
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PARTY = load('party_server_reject_drain', 'services/party/server.py')
TTS = load('tts_server_reject_drain', 'services/tts/edge_tts_server.py')
# 比服务端读请求头时顺手进缓冲区的 8 KiB 大得多，又不超过 DRAIN_LIMIT：
# 不读请求体就关连接时，服务端内核里一定还压着没读的字节，关的那一下就是 RST 而不是 FIN。
BODY_SIZE = 256 * 1024
LINUX = sys.platform.startswith('linux')
TCP_CLOSE = 7  # include/net/tcp_states.h：收到 RST 之后
TCP_CLOSE_WAIT = 8  # 只收到 FIN，正常收尾


def tcp_state(sock):
    return struct.unpack('B', sock.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 1))[0]


class DrainHarness(unittest.TestCase):
    """拒掉的请求要先读掉请求体再关：否则服务端内核回 RST，Windows 上连 4xx 回复都收不到（WinError 10053/10054）。

    同 tests/roundtable_reject_drain_test.py（#204）：Linux 收到 RST 时已经读到的回复不会丢，光看回复抓不住。
    这里等服务端把连接彻底关掉以后，直接看客户端这头的 TCP 状态：正常收尾是 CLOSE_WAIT，被 RST 是 CLOSE。
    反例：把 Handler.discard_body 换成 `lambda self: True`（等于撤掉修复），各个 *_closes_cleanly 每次都红。
    """

    def start(self, server):
        self.server = server
        self.closed = threading.Event()
        close_request = server.shutdown_request

        def shutdown_request(request):
            close_request(request)
            self.closed.set()
        server.shutdown_request = shutdown_request
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.port = server.server_port
        self.host = '127.0.0.1:' + str(self.port)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def raw(self, method, path, headers, body=b'', length=None):
        """整份请求一次发完，读到 EOF，等服务端关完；返回 (回复字节, 连接是否被重置)。"""
        head = [method + ' ' + path + ' HTTP/1.1', 'Host: ' + self.host,
                'Content-Length: ' + (str(len(body)) if length is None else length)]
        head += [name + ': ' + value for name, value in headers.items()]
        request = ('\r\n'.join(head) + '\r\n\r\n').encode() + body
        self.closed.clear()
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        received, reset = b'', False
        try:
            sock.sendall(request)
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                received += chunk
            self.assertTrue(self.closed.wait(5), '服务端没有关连接')
            if LINUX:
                # 回环上 RST 在服务端 close() 时就送到了；留一点余量给软中断。
                deadline = time.monotonic() + .3
                while tcp_state(sock) != TCP_CLOSE and time.monotonic() < deadline:
                    time.sleep(.01)
                state = tcp_state(sock)
                self.assertIn(state, (TCP_CLOSE, TCP_CLOSE_WAIT))
                reset = state == TCP_CLOSE
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            reset = True
        finally:
            sock.close()
        return received, reset

    def head_only(self, path, headers, length):
        """只发请求头、声称很长的请求体；读到回复头为止，返回小写的回复头。"""
        head = ['POST ' + path + ' HTTP/1.1', 'Host: ' + self.host, 'Content-Length: ' + str(length)]
        head += [name + ': ' + value for name, value in headers.items()]
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        response = b''
        try:
            sock.sendall(('\r\n'.join(head) + '\r\n\r\n').encode())
            while b'\r\n\r\n' not in response:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                response += chunk
        finally:
            sock.close()
        return response.split(b'\r\n\r\n', 1)[0].decode().lower()

    def assert_clean(self, response, reset, status, json_error=True):
        self.assertFalse(reset, '连接被 RST：服务端没读完请求体就关了')
        self.assertTrue(response.startswith(('HTTP/1.0 %d ' % status).encode()), response[:80])
        if json_error:
            self.assertIn('error', json.loads(response.split(b'\r\n\r\n', 1)[1]))


class PartyRejectDrainsBodyTests(DrainHarness):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pinkie-party-drain-')
        # 同 party_service_test：状态根目录放进临时目录，绝不碰真实用户数据。
        self.state = mock.patch.dict(os.environ, {'PINKIE_STATE_ROOT': str(Path(self.temp.name) / 'state')})
        self.state.start()
        self.store = PARTY.Store(self.temp.name)
        self.manager = PARTY.Manager(self.store)
        server = PARTY.ThreadingHTTPServer(('127.0.0.1', 0), PARTY.Handler)
        server.token, server.store, server.manager = 'page-token', self.store, self.manager
        self.start(server)

    def tearDown(self):
        self.stop()
        self.manager.close()
        self.manager.pool.shutdown(wait=True)
        self.store.db.close()
        self.state.stop()
        self.temp.cleanup()

    def headers(self, token):
        return {'Content-Type': 'application/json', 'Origin': 'http://' + self.host, 'X-Party-Token': token}

    def big_body(self):
        return json.dumps({'name': '收尾', 'pad': 'x' * BODY_SIZE}).encode()

    def test_wrong_token_403_closes_cleanly(self):
        self.assert_clean(*self.raw('POST', '/api/rooms', self.headers('wrong'), self.big_body()), 403)

    def test_oversized_body_400_closes_cleanly(self):
        # 令牌对但超过 64000 字节：校验在读请求体之前就抛了，同样要先读掉。
        self.assert_clean(*self.raw('POST', '/api/rooms', self.headers('page-token'), self.big_body()), 400)

    def test_too_large_to_drain_says_connection_close(self):
        head = self.head_only('/api/rooms', self.headers('wrong'), PARTY.DRAIN_LIMIT + 1)
        self.assertTrue(head.startswith('http/1.0 403 '), head)
        self.assertIn('connection: close', head)

    def test_accepted_post_still_works(self):
        response, reset = self.raw('POST', '/api/rooms', self.headers('page-token'), json.dumps({'name': '收尾'}).encode())
        self.assertFalse(reset)
        self.assertTrue(response.startswith(b'HTTP/1.0 200 '), response[:80])
        self.assertEqual('收尾', json.loads(response.split(b'\r\n\r\n', 1)[1])['name'])


class TtsRejectDrainsBodyTests(DrainHarness):
    def setUp(self):
        self.start(TTS.ThreadingHTTPServer(('127.0.0.1', 0), TTS.Handler))

    def tearDown(self):
        self.stop()

    def test_wrong_path_404_closes_cleanly(self):
        body = json.dumps({'input': 'x' * BODY_SIZE}).encode()
        self.assert_clean(*self.raw('POST', '/v1/audio/nope', {'Content-Type': 'application/json'}, body), 404, json_error=False)

    def test_unreadable_length_500_says_connection_close(self):
        response, reset = self.raw('POST', '/v1/audio/speech', {'Content-Type': 'application/json'}, length='abc')
        self.assertFalse(reset)
        head = response.split(b'\r\n\r\n', 1)[0].decode().lower()
        self.assertTrue(head.startswith('http/1.0 500 '), head)
        self.assertIn('connection: close', head)

    def test_empty_input_500_closes_cleanly(self):
        body = json.dumps({'input': ' ', 'pad': 'x' * BODY_SIZE}).encode()
        self.assert_clean(*self.raw('POST', '/v1/audio/speech', {'Content-Type': 'application/json'}, body), 500)

    def test_accepted_post_still_works(self):
        with mock.patch.object(TTS, 'synthesize', return_value=b'ID3-fake-audio'):
            response, reset = self.raw('POST', '/v1/audio/speech', {'Content-Type': 'application/json'},
                                       json.dumps({'input': '你好'}).encode())
        self.assertFalse(reset)
        self.assertTrue(response.startswith(b'HTTP/1.0 200 '), response[:80])
        self.assertEqual(b'ID3-fake-audio', response.split(b'\r\n\r\n', 1)[1])


if __name__ == '__main__':
    unittest.main()
