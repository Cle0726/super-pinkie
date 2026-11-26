#!/usr/bin/env python3
"""碧琪本地语音服务：OpenAI 兼容的 /v1/audio/speech 接口。"""

import contextlib
import json
import os
import asyncio
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("PINKIE_TTS_HOST", "127.0.0.1")
# This file is also imported by the desktop host. Its command line can carry
# updater or profile-protection flags, which are not a TTS port argument.
cli_port = sys.argv[1] if __name__ == "__main__" and len(sys.argv) > 1 else "18888"
PORT = int(os.environ.get("PINKIE_TTS_PORT", cli_port))
ALLOWED_ORIGIN = os.environ.get("PINKIE_GATEWAY_ORIGIN", "http://127.0.0.1:18789")
DEFAULT_RATE = os.environ.get("PINKIE_TTS_RATE", "+10%")
DEFAULT_PITCH = os.environ.get("PINKIE_TTS_PITCH", "+8Hz")
DEFAULT_VOLUME = os.environ.get("PINKIE_TTS_VOLUME", "+0%")


def synthesize(voice, text, rate=DEFAULT_RATE, pitch=DEFAULT_PITCH, volume=DEFAULT_VOLUME):
    import edge_tts

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as output:
        output_path = output.name
    try:
        asyncio.run(edge_tts.Communicate(text, voice, rate=rate, volume=volume, pitch=pitch).save(output_path))
        with open(output_path, "rb") as media:
            return media.read()
    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass


# B5：拒掉的请求最多替客户端读掉这么多请求体再回复（同 roundtable）。
DRAIN_LIMIT = 1 << 20
DRAIN_SECONDS = 2


class Handler(BaseHTTPRequestHandler):
    def handle_one_request(self):
        self.body_read = False
        super().handle_one_request()

    def discard_body(self):
        # B5（同 roundtable #204）：没读请求体就回 4xx 再关连接，内核对没读的字节回 RST，
        # Windows 客户端连已经发出的回复都收不到（WinError 10053/10054）。回复前先把请求体读掉；
        # 长度不明、太大或读不完就返回 False，由调用方明说 Connection: close。
        if getattr(self, 'body_read', True):
            return True
        self.body_read = True
        if self.headers.get('Transfer-Encoding'):
            return False
        try:
            left = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return False
        if left <= 0:
            return left == 0
        if left > DRAIN_LIMIT:
            return False
        try:
            self.connection.settimeout(DRAIN_SECONDS)
            while left:
                chunk = self.rfile.read(min(left, 65536))
                if not chunk:
                    return False
                left -= len(chunk)
            return True
        except OSError:
            return False
        finally:
            with contextlib.suppress(OSError):
                self.connection.settimeout(self.timeout)

    def not_found(self):
        drained = self.discard_body()
        self.send_response(404)
        if not drained:
            self.send_header('Connection', 'close')
            self.close_connection = True
        self.send_header('Content-Length', '0')
        self.end_headers()

    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_GET(self):
        if self.path != "/health":
            return self.not_found()
        payload = b'{"ok":true}'
        self.send_response(200)
        self.cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self.not_found()
        try:
            size = int(self.headers.get("Content-Length", "0"))
            self.body_read = True
            request = json.loads(self.rfile.read(size))
            text = str(request.get("input", "")).strip()
            if not text:
                raise ValueError("input is empty")
            audio = synthesize(
                str(request.get("voice", "zh-CN-XiaoyiNeural")),
                text,
                str(request.get("rate", DEFAULT_RATE)),
                str(request.get("pitch", DEFAULT_PITCH)),
                str(request.get("volume", DEFAULT_VOLUME)),
            )
            self.send_response(200)
            self.cors_headers()
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except Exception as error:
            payload = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, *_args):
        return


def serve(port=PORT, on_ready=None):
    server = ThreadingHTTPServer((HOST, int(port)), Handler)
    if on_ready:
        on_ready(server)
    print(f"pinkie edge-tts server listening on {HOST}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    serve()
