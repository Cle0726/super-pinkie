#!/usr/bin/env python3
# 给 chatgpt.com 页面里的脚本取参考图用：只读服务 art/study-game/refs，带 CORS + Private-Network 头，只听 127.0.0.1。
import http.server, functools, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else '/Users/Admin/release-superpinkie/art/study-game/refs'
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', 'https://chatgpt.com')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()
    def do_POST(self):
        pass
http.server.ThreadingHTTPServer(('127.0.0.1', 47811), functools.partial(H, directory=ROOT)).serve_forever()
