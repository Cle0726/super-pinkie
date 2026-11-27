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
SPEC = importlib.util.spec_from_file_location('roundtable_server_drain', ROOT/'services/roundtable/server.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

MODELS = [{'id': 'relay/a', 'name': 'A', 'provider': 'relay'}]
# 比服务端读请求头时顺手进缓冲区的 8 KiB 大得多，又不超过 DRAIN_LIMIT：
# 不读请求体就关连接时，服务端内核里一定还压着没读的字节，关的那一下就是 RST 而不是 FIN。
BODY_SIZE = 256 * 1024
LINUX = sys.platform.startswith('linux')
TCP_CLOSE = 7  # include/net/tcp_states.h：收到 RST 之后
TCP_CLOSE_WAIT = 8  # 只收到 FIN，正常收尾


def tcp_state(sock):
    return struct.unpack('B', sock.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 1))[0]


class RejectDrainsBodyTests(unittest.TestCase):
    """拒掉的 POST 要先读掉请求体再关：否则服务端内核回 RST，Windows 上连 403 都收不到（WinError 10053）。

    Linux 收到 RST 时已经读到的回复不会丢，所以光看回复抓不住。这里等服务端把连接彻底关掉以后，
    直接看客户端这头的 TCP 状态：正常收尾是 CLOSE_WAIT，被 RST 是 CLOSE。
    反例：把 Handler.discard_body 换成 `lambda self: True`（等于撤掉修复），前四条每次都红。
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = mock.patch.dict(os.environ, {'PINKIE_STATE_ROOT': str(Path(self.temp.name)/'state')})
        self.state.start()
        self.models = mock.patch.object(MODULE, 'available_models', return_value=MODELS)
        self.models.start()
        self.store = MODULE.Store(self.temp.name)
        self.session = self.store.create_session('拒绝收尾')['id']
        self.server = MODULE.ThreadingHTTPServer(('127.0.0.1', 0), MODULE.Handler)
        self.server.token, self.server.store = 'page-token', self.store
        self.server.roundtable = MODULE.Roundtable(self.store)
        self.closed = threading.Event()
        close_request = self.server.shutdown_request

        def shutdown_request(request):
            close_request(request)
            self.closed.set()
        self.server.shutdown_request = shutdown_request
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_port
        self.host = '127.0.0.1:' + str(self.port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.roundtable.pool.shutdown(wait=False, cancel_futures=True)
        self.store.db.close()
        self.models.stop()
        self.state.stop()
        self.temp.cleanup()

    def raw_post(self, path, headers, body):
        """整份请求一次发完，读到 EOF，等服务端关完；返回 (回复字节, 连接是否被重置)。"""
        head = ['POST ' + path + ' HTTP/1.1', 'Host: ' + self.host, 'Content-Length: ' + str(len(body))]
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

    def big_ops(self):
        return json.dumps({'ops': [], 'pad': 'x' * BODY_SIZE}).encode()

    def assert_clean(self, response, reset, status):
        self.assertFalse(reset, '连接被 RST：服务端没读完请求体就关了')
        self.assertTrue(response.startswith(('HTTP/1.0 %d ' % status).encode()), response[:80])
        self.assertIn('error', json.loads(response.split(b'\r\n\r\n', 1)[1]))

    def test_wrong_page_token_403_closes_cleanly(self):
        path = '/api/sessions/' + self.session + '/whiteboard'
        headers = {'Content-Type': 'application/json', 'Origin': 'http://' + self.host, 'X-Roundtable-Token': 'wrong'}
        self.assert_clean(*self.raw_post(path, headers, self.big_ops()), 403)

    def test_wrong_board_token_403_closes_cleanly(self):
        path = '/api/sessions/' + self.session + '/whiteboard/pinkie'
        headers = {'Content-Type': 'application/json', 'X-Roundtable-Board': 'wrong'}
        self.assert_clean(*self.raw_post(path, headers, self.big_ops()), 403)

    def test_oversized_body_400_closes_cleanly(self):
        # 令牌对但超过 64000 字节：校验在读请求体之前就抛了，同样要先读掉。
        path = '/api/sessions/' + self.session + '/whiteboard'
        headers = {'Content-Type': 'application/json', 'Origin': 'http://' + self.host, 'X-Roundtable-Token': 'page-token'}
        self.assert_clean(*self.raw_post(path, headers, self.big_ops()), 400)

    def test_too_large_to_drain_says_connection_close(self):
        # 声称超过 DRAIN_LIMIT 的请求体不去读，回复里明说 Connection: close。
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        try:
            sock.sendall(('POST /api/sessions/' + self.session + '/whiteboard HTTP/1.1\r\nHost: ' + self.host +
                          '\r\nContent-Type: application/json\r\nX-Roundtable-Token: wrong\r\nContent-Length: ' +
                          str(MODULE.DRAIN_LIMIT + 1) + '\r\n\r\n').encode())
            response = b''
            while b'\r\n\r\n' not in response:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                response += chunk
        finally:
            sock.close()
        head = response.split(b'\r\n\r\n', 1)[0].decode().lower()
        self.assertTrue(head.startswith('http/1.0 403 '), head)
        self.assertIn('connection: close', head)

    def test_accepted_post_still_works(self):
        path = '/api/sessions/' + self.session + '/whiteboard'
        headers = {'Content-Type': 'application/json', 'Origin': 'http://' + self.host, 'X-Roundtable-Token': 'page-token'}
        item = {'id': 'note-aaaa', 'kind': 'note', 'x': 10, 'y': 20, 'w': 160, 'h': 100, 'text': '想法', 'color': 'mint'}
        body = json.dumps({'ops': [{'op': 'put', 'baseRev': 0, 'item': item}]}).encode()
        response, reset = self.raw_post(path, headers, body)
        self.assertFalse(reset)
        self.assertTrue(response.startswith(b'HTTP/1.0 200 '), response[:80])
        self.assertEqual('user', json.loads(response.split(b'\r\n\r\n', 1)[1])['applied'][0]['by'])


if __name__ == '__main__':
    unittest.main()
