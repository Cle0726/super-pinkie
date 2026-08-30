#!/usr/bin/env python3
"""碧琪本地语音服务：OpenAI 兼容的 /v1/audio/speech 接口。"""

import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("PINKIE_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("PINKIE_TTS_PORT", sys.argv[1] if len(sys.argv) > 1 else "18888"))
ALLOWED_ORIGIN = os.environ.get("PINKIE_GATEWAY_ORIGIN", "http://127.0.0.1:18789")
DEFAULT_RATE = os.environ.get("PINKIE_TTS_RATE", "+10%")
DEFAULT_PITCH = os.environ.get("PINKIE_TTS_PITCH", "+8Hz")
DEFAULT_VOLUME = os.environ.get("PINKIE_TTS_VOLUME", "+0%")


def synthesize(voice, text, rate=DEFAULT_RATE, pitch=DEFAULT_PITCH, volume=DEFAULT_VOLUME):
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as output:
        output_path = output.name
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "edge_tts",
                "--voice",
                voice,
                "--text",
                text,
                "--rate",
                rate,
                "--pitch",
                pitch,
                "--volume",
                volume,
                "--write-media",
                output_path,
            ],
            check=True,
            capture_output=True,
            timeout=60,
        )
        with open(output_path, "rb") as media:
            return media.read()
    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_GET(self):
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
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
            self.send_response(404)
            self.end_headers()
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
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


print(f"pinkie edge-tts server listening on {HOST}:{PORT}", flush=True)
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
