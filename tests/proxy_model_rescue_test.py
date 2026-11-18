"""失效模型自救: 默认模型挂了, 代理自己找一个能用的模型回答, 并记住这次替换。

用假上游跑真实的代理进程, 不连任何模型。
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
PROXY = ROOT / "proxy" / "mm-retry-proxy.py"

# 假上游: 每个模型怎么回
BEHAVIOUR = {
    "dead-404": (404, {"error": {"message": "model not found"}}),
    "no-account": (503, {"error": {"message": "auth_unavailable: no auth available"}}),
    "paywall": (402, {"error": {"message": "payment required"}}),
    "bad-request": (400, {"error": {"message": "messages: field required"}}),
    "down-502": (502, {"error": {"message": "bad gateway"}}),
}
UPSTREAM_MODELS = ["dead-404", "grok-imagine-image", "paywall", "down-502", "text-ok", "vision-ok"]


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class FakeUpstream(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *args):
        pass

    def send(self, status, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/v1/models":
            self.send(200, {"data": [{"id": m} for m in UPSTREAM_MODELS]})
        else:
            self.send(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        model = body.get("model")
        FakeUpstream.seen.append(model)
        has_image = any(isinstance(m.get("content"), list) and any(
            part.get("type") == "image_url" for part in m["content"]) for m in body.get("messages", []))
        if model == "blind-ok" and has_image:
            self.send(400, {"error": {"message": "This model does not support image input"}})
            return
        if model in BEHAVIOUR:
            status, payload = BEHAVIOUR[model]
            self.send(status, payload)
            return
        if body.get("stream"):
            events = (
                'data: {"model":"%s","choices":[{"index":0,"delta":{"content":"hi from %s"},"finish_reason":null}]}\n\n'
                'data: {"model":"%s","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
                "data: [DONE]\n\n" % (model, model, model)
            ).encode()
            self.send(200, events, "text/event-stream")
            return
        self.send(200, {"model": model, "choices": [{"index": 0, "message": {
            "role": "assistant", "content": "hi from %s" % model}, "finish_reason": "stop"}]})


class ModelRescueTests(unittest.TestCase):
    def setUp(self):
        FakeUpstream.seen = []
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.port = free_port()
        config = {
            "agents": {"defaults": {"model": {"primary": "mm/dead-404", "fallbacks": ["mm/text-ok"]}}},
            "models": {"providers": {"mm": {"baseUrl": "http://127.0.0.1:%d/v1" % self.port, "models": [
                {"id": "dead-404", "input": ["text", "image"]},
                {"id": "text-ok", "input": ["text"]},
                {"id": "vision-ok", "input": ["text", "image"]},
                {"id": "down-502", "input": ["text", "image"]},
                # App 默认把所有聊天模型都标成能看图; 这个其实看不了
                {"id": "blind-ok", "input": ["text", "image"]},
            ]}}},
        }
        self.config_path = os.path.join(self.tmp.name, "openclaw.json")
        with open(self.config_path, "w") as handle:
            json.dump(config, handle)
        self.process = None

    def tearDown(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process.stdout.close()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.tmp.cleanup()

    def start_proxy(self, **extra):
        env = dict(os.environ)
        env.update({
            "UR_PROXY_PROMPTS_DIR": self.tmp.name,
            "UR_MODEL_RESCUE_STATE_DIR": self.tmp.name,
            "UR_OPENCLAW_CONFIG": self.config_path,
            "UR_PROXY_RETRY_BASE_DELAY": "0.1",
            "UR_PROXY_RETRY_MAX_DELAY": "0.1",
            "UR_PROXY_HTTP_STATUS_ATTEMPTS": "2",
        })
        env.update(extra)
        self.process = subprocess.Popen(
            [sys.executable, str(PROXY), str(self.port), str(self.upstream.server_address[1])],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/health" % self.port, timeout=1).read()
                return
            except OSError:
                time.sleep(0.05)
        self.fail("proxy did not start")

    def chat(self, model, stream=False, image=False):
        content = "hello"
        if image:
            content = [{"type": "text", "text": "what is this"},
                       {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]
        body = json.dumps({"model": model, "stream": stream,
                           "messages": [{"role": "system", "content": "agent prompt"},
                                        {"role": "user", "content": content}]}).encode()
        request = urllib.request.Request("http://127.0.0.1:%d/v1/chat/completions" % self.port, body,
                                         {"Content-Type": "application/json", "Authorization": "Bearer k"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, response.headers, response.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read().decode()

    def state(self):
        with open(os.path.join(self.tmp.name, "model-rescue-%d.json" % self.port)) as handle:
            return json.load(handle)

    def test_dead_default_is_answered_by_working_model_and_remembered(self):
        self.start_proxy()
        status, headers, text = self.chat("dead-404")
        self.assertEqual(status, 200, text)
        self.assertIn("hi from text-ok", text)  # 配置里的后备链排在上游列表前面
        self.assertEqual(headers.get("X-Pinkie-Model-Rescued"), "dead-404 -> text-ok")
        self.assertEqual(FakeUpstream.seen, ["dead-404", "text-ok"])
        self.assertEqual(self.state()["routes"], {"dead-404": "text-ok"})
        # 第二次: 不再先撞失效模型
        FakeUpstream.seen = []
        status, _, text = self.chat("dead-404", stream=True)
        self.assertEqual(status, 200)
        self.assertIn("hi from text-ok", text)
        self.assertEqual(FakeUpstream.seen, ["text-ok"])

    def test_image_request_only_goes_to_vision_model(self):
        self.start_proxy()
        status, headers, text = self.chat("dead-404", image=True)
        self.assertEqual(status, 200, text)
        self.assertIn("hi from vision-ok", text)
        # down-502 能看图但不通, 换到它时不在它身上反复重试
        self.assertNotIn("text-ok", FakeUpstream.seen)
        self.assertNotIn("grok-imagine-image", FakeUpstream.seen)
        self.assertEqual(headers.get("X-Pinkie-Model-Rescued"), "dead-404 -> vision-ok")

    def test_model_that_cannot_read_images_is_learned(self):
        self.start_proxy()
        status, headers, text = self.chat("blind-ok", image=True)
        self.assertEqual(status, 200, text)
        self.assertNotIn("hi from blind-ok", text)
        self.assertIn("blind-ok", self.state()["blind"])
        seer = headers.get("X-Pinkie-Model-Rescued").split(" -> ")[1]
        # 纯文字照旧给它
        FakeUpstream.seen = []
        status, headers, text = self.chat("blind-ok")
        self.assertIn("hi from blind-ok", text)
        self.assertIsNone(headers.get("X-Pinkie-Model-Rescued"))
        # 再带图: 直接给看过图的模型, 不再先撞一次
        FakeUpstream.seen = []
        status, _, text = self.chat("blind-ok", image=True)
        self.assertEqual(status, 200)
        self.assertEqual(FakeUpstream.seen, [seer])

    def test_no_account_and_paywall_are_rescued(self):
        self.start_proxy()
        for model in ("no-account", "paywall"):
            status, _, text = self.chat(model)
            self.assertEqual(status, 200, text)
            self.assertIn("hi from", text)

    def test_ordinary_bad_request_is_not_rescued(self):
        self.start_proxy()
        status, _, text = self.chat("bad-request")
        self.assertEqual(status, 400)
        self.assertIn("field required", text)
        self.assertEqual(FakeUpstream.seen, ["bad-request"])

    def test_persistent_5xx_switches_after_retries(self):
        self.start_proxy()
        status, _, text = self.chat("down-502")
        self.assertEqual(status, 200, text)
        self.assertEqual(FakeUpstream.seen[:2], ["down-502", "down-502"])
        self.assertNotEqual(FakeUpstream.seen[-1], "down-502")

    def test_recovered_original_is_used_again_after_cooldown(self):
        with open(os.path.join(self.tmp.name, "model-rescue-%d.json" % self.port), "w") as handle:
            json.dump({"dead": {"text-ok": {"at": time.time() - 7200, "status": 404}},
                       "good": {}, "routes": {"text-ok": "vision-ok"}}, handle)
        self.start_proxy()
        status, headers, text = self.chat("text-ok")
        self.assertEqual(status, 200)
        self.assertIn("hi from text-ok", text)
        self.assertIsNone(headers.get("X-Pinkie-Model-Rescued"))
        self.assertNotIn("text-ok", self.state()["routes"])

    def test_disabled_passes_failure_through(self):
        self.start_proxy(UR_MODEL_RESCUE="0")
        status, _, _ = self.chat("dead-404")
        self.assertEqual(status, 404)
        self.assertEqual(FakeUpstream.seen, ["dead-404"])


if __name__ == "__main__":
    unittest.main()
