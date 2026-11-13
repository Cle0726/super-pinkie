#!/usr/bin/env python3
# 只听 127.0.0.1:47811。GET：读 art/study-game/refs（bridge 用）。POST /upload：chatgpt.com 页面用表单（导航，不受 fetch 的 CSP 限制）
# 把生成的图交过来，存成 ~/Downloads/pk__<slot>.png，由 mover.zsh 搬进 raw/；然后 303 跳回 chatgpt.com 并带上已收到的键。
import http.server, functools, sys, os, urllib.parse, email.parser, email.policy
ROOT = '/Users/Admin/release-superpinkie/art/study-game/refs'
OUT = os.path.expanduser('~/Downloads')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', 'https://chatgpt.com')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        super().end_headers()
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        msg = email.parser.BytesParser(policy=email.policy.default).parsebytes(b'Content-Type: ' + self.headers['Content-Type'].encode() + b'\r\n\r\n' + body)
        got = []
        for part in msg.iter_parts():
            fn = part.get_filename()
            if not fn or not fn.startswith('pk__') or '/' in fn or '..' in fn: continue
            data = part.get_payload(decode=True)
            if not data: continue
            if data[:4] == b'\x89PNG': ext = '.png'
            elif data[:4] == b'GIF8': ext = '.gif'
            elif data[:4] == b'RIFF' and data[8:12] == b'WEBP': ext = '.webp'
            else: continue
            fn = fn.rsplit('.', 1)[0] + ext
            tmp = os.path.join(OUT, '.' + fn + '.part')
            open(tmp, 'wb').write(data); os.rename(tmp, os.path.join(OUT, fn))
            got.append(part.get_param('name', header='content-disposition'))
        self.send_response(303)
        self.send_header('Location', 'https://chatgpt.com/#pkdone=' + urllib.parse.quote(','.join(got)))
        self.end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', 47811), functools.partial(H, directory=ROOT)).serve_forever()
