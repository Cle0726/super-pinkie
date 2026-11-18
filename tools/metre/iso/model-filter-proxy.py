"""Test-only pass-through in front of the model pool: /v1/models lists only the allowed ids.

Pinkie's model-sync refills the provider catalog from GET <baseUrl>/models at gateway start,
so trimming openclaw.json alone does not stick. Everything else (chat completions, streaming)
is relayed byte for byte.

  python -I model-filter-proxy.py <listen-port> <upstream-port> <model-id> [<model-id> ...]
"""
import http.client, http.server, json, socketserver, sys

LISTEN, UPSTREAM = int(sys.argv[1]), int(sys.argv[2])
ALLOWED = set(sys.argv[3:])
HOP = {'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'content-length'}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def relay(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else None
        conn = http.client.HTTPConnection('127.0.0.1', UPSTREAM, timeout=900)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        conn.request(self.command, self.path, body=body, headers=headers)
        resp = conn.getresponse()
        if self.command == 'GET' and self.path.rstrip('/').endswith('/models') and resp.status == 200:
            payload = json.loads(resp.read())
            payload['data'] = [m for m in payload.get('data', []) if m.get('id') in ALLOWED]
            raw = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self.send_response(resp.status, resp.reason)
        for k, v in resp.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()
        while True:
            chunk = resp.read1(65536) if hasattr(resp, 'read1') else resp.read(65536)
            if not chunk:
                break
            self.wfile.write(b'%x\r\n%s\r\n' % (len(chunk), chunk))
            self.wfile.flush()
        self.wfile.write(b'0\r\n\r\n')

    do_GET = do_POST = relay


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


print('model filter proxy on', LISTEN, '->', UPSTREAM, sorted(ALLOWED), flush=True)
Server(('127.0.0.1', LISTEN), Handler).serve_forever()
