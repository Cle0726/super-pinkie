"""B5: party / tts read the request body before a 4xx (same rule as roundtable #204).

If the server answers and closes without reading the body, the kernel answers the unread bytes with RST and a
Windows client loses the reply it was already sent (WinError 10053/10054). The client here sends the whole
request first and reads afterwards, like urllib. On Linux the reply survives an RST, so we also look at the
client's TCP state once the server has closed: a clean close is CLOSE_WAIT, a reset is CLOSE.
Counter-example: with main's party/server.py and edge_tts_server.py every test below fails.
"""
import importlib.util
import json
from pathlib import Path
import socket
import struct
import sys
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
# Well above what the server buffers while reading headers, still under DRAIN_LIMIT.
BODY_SIZE = 256 * 1024
REPEAT = 5
LINUX = sys.platform.startswith('linux')
TCP_CLOSE = 7
TCP_CLOSE_WAIT = 8


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tcp_state(sock):
    return struct.unpack('B', sock.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 1))[0]


class DrainCase:
    module = None

    def start(self, setup=None):
        self.server = self.module.ThreadingHTTPServer(('127.0.0.1', 0), self.module.Handler)
        if setup:
            setup(self.server)
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

    def raw_post(self, path, headers, body):
        head = ['POST ' + path + ' HTTP/1.1', 'Host: ' + self.host, 'Content-Length: ' + str(len(body))]
        head += [name + ': ' + value for name, value in headers.items()]
        request = ('\r\n'.join(head) + '\r\n\r\n').encode() + body
        self.closed.clear()
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        received, reset = b'', False
        try:
            sock.sendall(request)
            # Read only after the server has closed (these servers speak HTTP/1.0 and close after every reply).
            # Reading while the server is still closing is a race on Windows: the reply sometimes beats the RST.
            # Waiting first makes it the urllib case every time: an RST already queued throws the reply away.
            self.assertTrue(self.closed.wait(5), 'the server never closed the connection')
            time.sleep(.2)
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                received += chunk
            if LINUX:
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

    def assert_clean(self, path, headers, body, status):
        # On Windows the RST only wins the race part of the time (3 of 5 on main's party, measured), so one clean
        # close proves nothing: every one of REPEAT tries must get the reply and close without a reset.
        for attempt in range(REPEAT):
            response, reset = self.raw_post(path, headers, body)
            self.assertFalse(reset, f'try {attempt + 1}: connection reset, the server closed without reading the request body')
            self.assertRegex(response[:40], rb'^HTTP/1\.[01] %d ' % status, response[:80])

    def assert_too_large_says_close(self, path, headers):
        # A body claimed larger than DRAIN_LIMIT is not read; the reply says Connection: close.
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        try:
            head = ['POST ' + path + ' HTTP/1.1', 'Host: ' + self.host, 'Content-Length: ' + str(self.module.DRAIN_LIMIT + 1)]
            head += [name + ': ' + value for name, value in headers.items()]
            sock.sendall(('\r\n'.join(head) + '\r\n\r\n').encode())
            response = b''
            while b'\r\n\r\n' not in response:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                response += chunk
        finally:
            sock.close()
        self.assertIn(b'Connection: close', response.split(b'\r\n\r\n', 1)[0])


class PartyRejectDrainsBody(DrainCase, unittest.TestCase):
    module = load('party_server_drain', 'services/party/server.py')

    def setUp(self):
        self.start(lambda server: setattr(server, 'token', 'page-token'))

    def big(self):
        return json.dumps({'name': 'x', 'pad': 'x' * BODY_SIZE}).encode()

    def test_wrong_token_403_closes_cleanly(self):
        headers = {'Content-Type': 'application/json', 'Origin': 'http://' + self.host, 'X-Party-Token': 'wrong'}
        self.assert_clean('/api/rooms', headers, self.big(), 403)

    def test_oversized_body_400_closes_cleanly(self):
        headers = {'Content-Type': 'application/json', 'Origin': 'http://' + self.host, 'X-Party-Token': 'page-token'}
        self.assert_clean('/api/rooms', headers, self.big(), 400)

    def test_too_large_to_drain_says_connection_close(self):
        self.assert_too_large_says_close('/api/rooms', {'Content-Type': 'application/json', 'X-Party-Token': 'wrong'})


class TtsRejectDrainsBody(DrainCase, unittest.TestCase):
    module = load('tts_server_drain', 'services/tts/edge_tts_server.py')

    def setUp(self):
        self.start()

    def test_wrong_path_404_closes_cleanly(self):
        self.assert_clean('/nope', {'Content-Type': 'application/json'}, b'{"input":"' + b'x' * BODY_SIZE + b'"}', 404)

    def test_too_large_to_drain_says_connection_close(self):
        self.assert_too_large_says_close('/nope', {'Content-Type': 'application/json'})


if __name__ == '__main__':
    unittest.main()
