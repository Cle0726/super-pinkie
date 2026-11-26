#!/usr/bin/env python3
"""碧琪本地语音服务：OpenAI 兼容的 /v1/audio/speech 接口。"""

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
# 拒掉的请求最多读掉多少请求体、等多久再回复；超出就回 Connection: close（同 services/roundtable #204）。
DRAIN_LIMIT = 1 << 20
DRAIN_SECONDS = 2


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


class Handler(BaseHTTPRequestHandler):
    def handle_one_request(self):
        self.body_read = False
        super().handle_one_request()

    def discard_body(self):
        # 没读请求体就回 404/500 再关连接：内核对还没读的字节回 RST，Windows 客户端连已经发出的回复都收不到
        # （WinError 10053/10054，同 services/roundtable #204）。回复前先把请求体读掉；
        # 长度不明、太大或读不完就返回 False，由调用方明说 Connection: close。
        if self.body_read:
            return True
        self.body_read = True
        if self.headers.get("Transfer-Encoding"):
            return False
        try:
            left = int(self.headers.get("Content-Length", "0"))
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
            try:
                self.connection.settimeout(self.timeout)
            except OSError:
                pass

    def start_reply(self, code):
        drained = self.discard_body()
        self.send_response(code)
        if not drained:
            self.send_header("Connection", "close")
            self.close_connection = True

    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_GET(self):
        if self.path != "/health":
            self.start_reply(404)
            self.end_headers()
            return
        payload = b'{"ok":true}'
        self.start_reply(200)
        self.cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.start_reply(204)
        self.cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self.start_reply(404)
            self.end_headers()
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0:
                raise ValueError("Content-Length is invalid")
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
            self.start_reply(200)
            self.cors_headers()
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except Exception as error:
            payload = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.start_reply(500)
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
