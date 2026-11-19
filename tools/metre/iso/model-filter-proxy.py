"""Test-only relay in front of the model pool. Only explicit model ids can be used.

Pinkie's model-sync refills the provider catalog from GET <baseUrl>/models at gateway start,
so trimming openclaw.json alone does not stick. The relay also rejects POSTs for
other models; otherwise an explicit model or fallback can bypass a filtered list.
Allowlisted upstream responses and streams are relayed as before.

  python -I model-filter-proxy.py <listen-port> <upstream-port> <model-id> [<model-id> ...]
  Set METRE_PROXY_FREE_ONLY=1 and METRE_PROXY_MAX_POSTS=N for a bounded free trial.
  The caller must check actual route availability and cost independently.
"""
import http.client, http.server, json, os, re, socketserver, sys, threading
from urllib.parse import urlsplit

LISTEN, UPSTREAM = int(sys.argv[1]), int(sys.argv[2])
ALLOWED = frozenset(sys.argv[3:])
FREE_ONLY = os.environ.get('METRE_PROXY_FREE_ONLY') == '1'
MAX_POSTS = int(os.environ.get('METRE_PROXY_MAX_POSTS', '0'))
FREE_ID = re.compile(r'(?:^|[/:._-])(?:free|hy\d+free)(?=$|[/:._@+-])', re.I)
if not ALLOWED or MAX_POSTS < 0 or (FREE_ONLY and (not MAX_POSTS or not all(FREE_ID.search(id) for id in ALLOWED))):
    raise SystemExit('Use explicit allowed model ids; free-only runs require free ids and a positive POST limit.')
REQUEST_LOCK = threading.Lock()
FORWARDED = 0
MAX_BODY_BYTES = 32 * 1024 * 1024
HOP = {'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'content-length'}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def relay(self):
        global FORWARDED
        path = urlsplit(self.path).path.rstrip('/')
        if (self.command == 'GET' and not path.endswith('/models')) or (
                self.command == 'POST' and not path.endswith(('/chat/completions', '/responses'))):
            self.send_error(404, 'not a model trial endpoint')
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            self.send_error(400, 'invalid request size')
            return
        if not 0 <= length <= MAX_BODY_BYTES:
            self.send_error(413, 'trial request too large')
            return
        body = self.rfile.read(length) if length else None
        if self.command == 'POST':
            try:
                payload = json.loads(body or b'{}')
            except (ValueError, UnicodeError):
                self.send_error(400, 'invalid model request')
                return
            model = payload.get('model') if isinstance(payload, dict) else None
            if not isinstance(model, str) or model not in ALLOWED:
                self.send_error(403, 'model is not in this isolated trial')
                return
            with REQUEST_LOCK:
                over_budget = bool(MAX_POSTS and FORWARDED >= MAX_POSTS)
                if not over_budget:
                    FORWARDED += 1
                    print(f'model request {FORWARDED}: {model}', flush=True)
            if over_budget:
                self.send_error(429, 'isolated trial request budget used up')
                return
        conn = http.client.HTTPConnection('127.0.0.1', UPSTREAM, timeout=900)
        try:
            self.forward(conn, body, path)
        finally:
            conn.close()

    def forward(self, conn, body, path):
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        conn.request(self.command, self.path, body=body, headers=headers)
        resp = conn.getresponse()
        if self.command == 'GET' and path.endswith('/models') and resp.status == 200:
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
