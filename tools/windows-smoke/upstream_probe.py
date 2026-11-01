"""What 碧琪 does on Windows when a model turn fails.

Runs after the fresh smoke scenario, on its profile, against a fake
OpenAI-compatible model server on loopback.  Four cases:

  disconnect     the stream breaks off half way, the next request succeeds:
                 a real upstream outage, which must be continued automatically.
  not-found      the model URL answers 404 for every request: a wrong path or
                 an endpoint that does not exist.  Retrying cannot help.
  proxy-down     nothing listens on the model port (a local proxy that never
                 started).  Retrying cannot help either.
  plugin-missing the core plugin misses one of its files, so it never loads;
                 the stream then breaks off once.  No watchdog exists to retry.

For every case the summary records the model requests the fake server saw,
the retry ribbon the page showed over time, the watchdog lines in the gateway
log and whether the final reply arrived.  Screenshots are taken when the
ribbon first appears and at the end of the case.
"""

import json
import shutil
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RECOVERED = "PROBE-RECOVERED-OK"
PARTIAL = "碧琪先说到一半"
# Mid-turn retries are hidden control messages with this prefix.
WATCHDOG_PREFIX = "[pinkie-watchdog]"
# The file whose absence kept the plugin from loading in v2.5.23.
PLUGIN_FILE = Path("vendor/reading-node.mjs")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class FakeUpstream:
    """OpenAI-style chat completions; each request takes the next behaviour."""

    def __init__(self, port):
        self.port = port
        self.plan = ["ok"]
        self.requests = []
        self.server = None

    def start(self):
        upstream = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_GET(self):
                body = json.dumps({"object": "list", "data": [{"id": "probe-model", "object": "model"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0") or 0)
                try:
                    payload = json.loads(self.rfile.read(length) or b"{}")
                except ValueError:
                    payload = {}
                behaviour = upstream.plan.pop(0) if len(upstream.plan) > 1 else upstream.plan[0]
                users = [m for m in payload.get("messages", []) if m.get("role") == "user"]
                last = users[-1].get("content", "") if users else ""
                if isinstance(last, list):
                    last = " ".join(str(part.get("text", "")) for part in last if isinstance(part, dict))
                upstream.requests.append({
                    "at": round(time.time(), 1),
                    "path": self.path,
                    "behaviour": behaviour,
                    "watchdog": WATCHDOG_PREFIX in str(last),
                })
                if behaviour == "not-found":
                    body = json.dumps({"error": {"message": "404 page not found", "type": "not_found_error"}}).encode()
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                text = PARTIAL if behaviour == "drop" else f"续上了，{RECOVERED}"
                if not payload.get("stream"):
                    if behaviour == "drop":
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.close_connection = True
                        return
                    body = json.dumps({
                        "id": "probe", "object": "chat.completion", "created": int(time.time()), "model": "probe-model",
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
                    }, ensure_ascii=False).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                base = {"id": "probe", "object": "chat.completion.chunk", "created": int(time.time()), "model": "probe-model"}

                def chunk(raw):
                    self.wfile.write(f"{len(raw):x}\r\n".encode() + raw + b"\r\n")
                    self.wfile.flush()

                def frame(delta, finish=None, usage=None):
                    data = {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
                    if usage:
                        data["usage"] = usage
                    chunk(("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode())

                frame({"role": "assistant", "content": text})
                if behaviour == "drop":
                    time.sleep(0.5)
                    # Break the connection mid-body: no finish_reason, no
                    # [DONE], no terminating chunk.  Node reports "terminated".
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.close_connection = True
                    return
                frame({}, "stop", {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20})
                chunk(b"data: [DONE]\n\n")
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()

        self.server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None


def configure(profile, port):
    config = profile / "home/.openclaw/openclaw.json"
    data = json.loads(config.read_text(encoding="utf-8"))
    providers = data.setdefault("models", {}).setdefault("providers", {})
    providers["probe"] = {
        "api": "openai-completions",
        "auth": "api-key",
        "apiKey": "probe-dummy",
        "baseUrl": f"http://127.0.0.1:{port}/v1",
        "timeoutSeconds": 60,
        "models": [{"id": "probe-model", "name": "Probe", "reasoning": False,
                    "contextWindow": 128000, "maxTokens": 4096, "input": ["text"]}],
    }
    data.setdefault("agents", {}).setdefault("defaults", {})["model"] = {"primary": "probe/probe-model", "fallbacks": []}
    config.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


RIBBON = r"""() => {
  const html = document.documentElement;
  const text = document.body.innerText || '';
  return {
    state: html.getAttribute('data-laolao-watchdog-state') || '',
    message: html.getAttribute('data-laolao-watchdog-message') || '',
    recovered: text.includes('PROBE-RECOVERED-OK'),
    failureCard: text.includes('这次模型调用失败'),
    partial: text.includes('碧琪先说到一半'),
  };
}"""


def gateway_lines(log_path, offset):
    if not log_path.is_file():
        return [], offset
    with log_path.open("rb") as handle:
        handle.seek(offset)
        chunk = handle.read()
    lines = chunk.decode("utf-8", "replace").splitlines()
    keep = [line.strip()[:400] for line in lines
            if any(word in line for word in ("watchdog", "pinkie-mode-architecture", "failed", "error", "Error"))]
    return keep[-80:], offset + len(chunk)


def run_case(page, out, name, upstream, plan, log_path, seconds, stop_when_recovered):
    upstream.plan = list(plan)
    first_request = len(upstream.requests)
    session = f"agent:main:probe-{name}"
    page.goto(f"http://127.0.0.1:18789/chat?session={session}", wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_selector(".laolao-mode-switcher", timeout=60_000)
    page.wait_for_timeout(6000)
    offset = log_path.stat().st_size if log_path.is_file() else 0
    sent = page.evaluate("""async ([sessionKey, key]) => {
      try {
        await window.__laolaoSidebar.gwRequest('chat.send',
          {sessionKey, message: '碧琪，测试一下：请回复一句话。', idempotencyKey: key, deliver: false}, 20000);
        return {ok: true};
      } catch (error) { return {ok: false, error: String(error)}; }
    }""", [session, f"probe-{name}-{uuid.uuid4().hex[:8]}"])
    timeline = []
    shot_taken = False
    started = time.monotonic()
    calm_since = None
    while time.monotonic() - started < seconds:
        page.wait_for_timeout(1000)
        try:
            state = page.evaluate(RIBBON)
        except Exception as error:  # navigation during recovery
            state = {"error": str(error)}
        state["t"] = round(time.monotonic() - started, 1)
        state["requests"] = len(upstream.requests) - first_request
        last = timeline[-1] if timeline else {}
        if any(state.get(k) != last.get(k) for k in ("state", "message", "recovered", "failureCard", "partial")):
            timeline.append(state)
        if state.get("state") and not shot_taken:
            page.screenshot(path=str(out / f"probe-{name}-ribbon.png"))
            shot_taken = True
        if stop_when_recovered and state.get("recovered") and state.get("state") in ("", "recovered"):
            calm_since = calm_since or time.monotonic()
            if time.monotonic() - calm_since > 6:
                break
        else:
            calm_since = None
    page.screenshot(path=str(out / f"probe-{name}-end.png"))
    final = timeline[-1] if timeline else {}
    lines, _ = gateway_lines(log_path, offset)
    requests = upstream.requests[first_request:]
    return {
        "sent": sent,
        "seconds": round(time.monotonic() - started, 1),
        "requests": len(requests),
        "watchdog_requests": sum(1 for r in requests if r["watchdog"]),
        "request_log": requests[:40],
        "timeline": timeline[:60],
        "final": final,
        "ribbon_ever": sorted({entry.get("message", "") for entry in timeline if entry.get("state")}),
        "gateway": lines,
    }


def judge(name, result):
    """The behaviour 碧琪 must have; returns the reasons it falls short."""
    final, problems = result["final"], []
    claims_retry = any("重试" in message or "续接" in message for message in result["ribbon_ever"])
    if not result["sent"].get("ok"):
        problems.append(f"chat.send failed: {result['sent'].get('error')}")
    if name == "disconnect":
        if not final.get("recovered"):
            problems.append("the reply never arrived after the stream broke off")
        if final.get("state") not in ("", "recovered"):
            problems.append(f"ribbon still shows {final.get('message')!r}")
    elif name in ("not-found", "proxy-down"):
        if result["requests"] > 3:
            problems.append(f"{result['requests']} model requests for a failure retrying cannot fix")
        if final.get("state") == "retrying":
            problems.append(f"ribbon still claims a retry: {final.get('message')!r}")
    elif name == "plugin-missing":
        if final.get("state") == "retrying" or (claims_retry and not final.get("recovered")):
            problems.append("ribbon claims an automatic retry although no watchdog is loaded")
    return problems


def plugin_copies(exe, profile):
    """The plugin file in the package and in the installed extension.

    The launcher re-installs the extension from the package on every start,
    so hiding only the installed copy would not survive the restart."""
    copies = list(exe.parent.rglob("services/mode-architecture/" + PLUGIN_FILE.as_posix()))
    copies.append(profile / "home/.openclaw/extensions/pinkie-mode-architecture" / PLUGIN_FILE)
    return [path for path in copies if path.is_file()]


def run(exe, profile, out, launch, kill_app, profile_env):
    from playwright.sync_api import sync_playwright

    port = free_port()
    upstream = FakeUpstream(port)
    upstream.start()
    configure(profile, port)
    log_path = profile / "local/SuperPinkie/logs/gateway.log"
    summary = {"port": port, "cases": {}}
    try:
        env = profile_env(profile)
        process, ready, seconds = launch(exe, env, out, "probe")
        summary["gateway_ready"], summary["seconds"] = ready, seconds
        if not ready:
            return summary
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            page = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN").new_page()
            summary["cases"]["disconnect"] = run_case(page, out, "disconnect", upstream, ["drop", "ok"], log_path, 120, True)
            summary["cases"]["not-found"] = run_case(page, out, "not-found", upstream, ["not-found"], log_path, 75, False)
            upstream.stop()
            summary["cases"]["proxy-down"] = run_case(page, out, "proxy-down", upstream, ["ok"], log_path, 75, False)
            upstream = FakeUpstream(port)
            upstream.start()
            browser.close()
        kill_app(exe.parent)
        hidden = []
        for path in plugin_copies(exe, profile):
            path.rename(path.with_name(path.name + ".probe-hidden"))
            hidden.append(path)
        summary["hidden_plugin_files"] = [str(path) for path in hidden]
        try:
            process, ready, seconds = launch(exe, env, out, "probe-plugin-missing")
            if ready:
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(channel="msedge", headless=True)
                    page = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN").new_page()
                    summary["cases"]["plugin-missing"] = run_case(page, out, "plugin-missing", upstream, ["drop", "ok"], log_path, 75, True)
                    browser.close()
        finally:
            kill_app(exe.parent)
            for path in hidden:
                shutil.move(str(path.with_name(path.name + ".probe-hidden")), str(path))
    finally:
        upstream.stop()
        if (profile / "local/SuperPinkie/logs").is_dir():
            shutil.copytree(profile / "local/SuperPinkie/logs", out / "probe-logs", dirs_exist_ok=True)
    for name, result in summary["cases"].items():
        result["problems"] = judge(name, result)
    summary["passed"] = bool(summary["cases"]) and len(summary["cases"]) == 4 and not any(
        result["problems"] for result in summary["cases"].values())
    return summary
