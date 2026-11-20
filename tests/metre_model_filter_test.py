from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "tools/metre/iso/model-filter-proxy.py"
FREE = "workbuddy/hy4flash-free"
PAID = "workbuddy/hy4flash"


def request(port, method, route, payload=None):
    client = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        client.request(method, route, None if payload is None else json.dumps(payload),
                       {"content-type": "application/json"})
        reply = client.getresponse()
        return reply.status, reply.read()
    finally:
        client.close()


class MetreModelFilterTests(unittest.TestCase):
    def test_only_allowlisted_posts_reach_upstream_and_the_budget_is_hard(self):
        forwarded = []

        class Fixture(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send_json(self, content):
                encoded = json.dumps(content).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_GET(self):
                self.send_json({"data": [{"id": FREE}, {"id": PAID}]})

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                forwarded.append(payload["model"])
                self.send_json({"fixture": True})

        with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    listen = sock.getsockname()[1]
                env = {**os.environ, "METRE_PROXY_FREE_ONLY": "1", "METRE_PROXY_MAX_POSTS": "1"}
                with subprocess.Popen([sys.executable, "-I", str(SOURCE), str(listen),
                                       str(server.server_port), FREE], env=env,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as proxy:
                    try:
                        deadline = time.monotonic() + 10
                        while True:
                            try:
                                status, raw = request(listen, "GET", "/v1/models")
                                break
                            except OSError:
                                if proxy.poll() is not None or time.monotonic() >= deadline:
                                    raise
                                time.sleep(0.05)
                        self.assertEqual(status, 200)
                        self.assertEqual(json.loads(raw)["data"], [{"id": FREE}])
                        self.assertEqual(request(listen, "POST", "/v1/responses", {"model": PAID})[0], 403)
                        self.assertEqual(request(listen, "POST", "/v1/chat/completions", {"model": FREE})[0], 200)
                        self.assertEqual(request(listen, "POST", "/v1/chat/completions", {"model": FREE})[0], 429)
                        self.assertEqual(forwarded, [FREE])
                    finally:
                        proxy.terminate()
                        proxy.wait(timeout=5)
            finally:
                server.shutdown()
                thread.join(timeout=5)

    def test_free_only_mode_refuses_unverified_nonfree_id_at_startup(self):
        env = {**os.environ, "METRE_PROXY_FREE_ONLY": "1", "METRE_PROXY_MAX_POSTS": "1"}
        result = subprocess.run([sys.executable, "-I", str(SOURCE), "0", "1", PAID],
                                env=env, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("free-only runs require free ids", result.stderr)


if __name__ == "__main__":
    unittest.main()
