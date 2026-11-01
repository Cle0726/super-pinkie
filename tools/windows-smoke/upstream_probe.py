"""What 碧琪 does on Windows when a model turn fails.

Runs after the fresh smoke scenario, on its profile, against a fake
OpenAI-compatible model server on loopback.  Four cases:

  disconnect     the stream breaks off half way, the next request succeeds:
                 a real upstream outage, which must be continued automatically.
  disconnect-action the same interruption during an execution-style request;
                 exercises the completion gate that caused the earlier stall.
  not-found      the model URL answers 404 for every request: a wrong path or
                 an endpoint that does not exist.  Retrying cannot help.
  proxy-down     nothing listens on the model port (a local proxy that never
                 started).  Retrying cannot help either.
  plugin-missing the core plugin misses one of its files, so it never loads;
                 the stream then breaks off once.  No watchdog exists to retry.
  bad-config     the old control center's API form left a key OpenClaw
                 rejects; the gateway never starts unless the launcher repairs it.

For every case the summary records the model requests the fake server saw,
the retry ribbon the page showed over time, the watchdog lines in the gateway
log and whether the final reply arrived.  Screenshots are taken when the
ribbon first appears and at the end of the case.
"""

import json
import os
import re
import shutil
import socket
import struct
import subprocess
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


class CpuSampler(threading.Thread):
    """Every few seconds, which processes on the runner used the CPU.

    The gateway slowed down for minutes after a successful continuation; this
    tells whether the gateway itself, the browser or a stray child is busy.
    """

    def __init__(self, path, every=3.0):
        super().__init__(daemon=True)
        self.path, self.every, self.label = path, every, ""
        self.halt = threading.Event()

    def run(self):
        try:
            import psutil
        except ImportError:
            return
        last = {}
        with self.path.open("a", encoding="utf-8") as handle:
            while not self.halt.wait(self.every):
                now, rows = {}, []
                for proc in psutil.process_iter(["pid", "name"]):
                    try:
                        times = proc.cpu_times()
                        used = times.user + times.system
                    except (psutil.Error, OSError):
                        continue
                    now[proc.pid] = used
                    delta = used - last.get(proc.pid, used)
                    if delta > 0.3:
                        try:
                            cmd = " ".join(proc.cmdline())[-160:]
                        except (psutil.Error, OSError):
                            cmd = ""
                        rows.append([round(delta, 1), proc.pid, proc.info["name"], cmd])
                last = now
                rows.sort(reverse=True)
                handle.write(json.dumps({"t": time.strftime("%H:%M:%S"), "case": self.label,
                                         "top": rows[:6]}, ensure_ascii=False) + "\n")
                handle.flush()


# Counts every gateway request the page sends, by method, so a request storm
# shows up even though the gateway log leaves most fast responses out.
COUNT_REQUESTS = """(() => {
  const counts = window.__probeRequestCounts = {};
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      const frame = JSON.parse(String(data));
      if (frame && frame.method) counts[frame.method] = (counts[frame.method] || 0) + 1;
    } catch {}
    return send.call(this, data);
  };
})()"""


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
                    # Break the connection mid-body with a reset: no
                    # finish_reason, no [DONE], no terminating chunk.  A plain
                    # shutdown sometimes left Windows holding a half-open
                    # stream until the client's idle timeout.
                    self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
                    self.connection.close()
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
    # One provider per case: OpenClaw cools a provider down after a failure,
    # and a shared one let one case's failure hold up the next case's turn.
    for name in CASE_PROVIDERS.values():
        providers[name] = provider(port)
    providers["probe"] = provider(port)
    data.setdefault("agents", {}).setdefault("defaults", {})["model"] = {"primary": "probe/probe-model", "fallbacks": []}
    config.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


CASE_PROVIDERS = {"disconnect": "probe-a", "not-found": "probe-b", "proxy-down": "probe-c",
                  "plugin-missing": "probe-d", "disconnect-action": "probe-e"}


def provider(port):
    return {
        "api": "openai-completions",
        "auth": "api-key",
        "apiKey": "probe-dummy",
        "baseUrl": f"http://127.0.0.1:{port}/v1",
        "timeoutSeconds": 60,
        "models": [{"id": "probe-model", "name": "Probe", "reasoning": False,
                    "contextWindow": 128000, "maxTokens": 4096, "input": ["text"]}],
    }


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


def stuck_stack(page):
    """Pause the page's script and return where its main thread is busy."""
    frames = []
    try:
        cdp = page.context.new_cdp_session(page)
        scripts = {}
        cdp.on("Debugger.scriptParsed", lambda event: scripts.update({event["scriptId"]: event.get("url", "")}))
        cdp.on("Debugger.paused", lambda event: frames.extend(
            f"{f.get('functionName') or '(anonymous)'} "
            f"{scripts.get(f['location']['scriptId'], f.get('url', ''))}:"
            f"{f['location']['lineNumber'] + 1}:{f['location'].get('columnNumber', 0) + 1}"
            for f in event.get("callFrames", [])[:12]))
        cdp.send("Debugger.enable")
        cdp.send("Debugger.pause")
        deadline = time.monotonic() + 10
        while not frames and time.monotonic() < deadline:
            # Sync Playwright only delivers CDP events inside its own calls.
            page.wait_for_timeout(200)
        try:
            cdp.send("Debugger.resume")
        except Exception:
            pass
    except Exception as error:
        frames.append(f"cdp failed: {str(error)[:200]}")
    return frames


def shot(page, path, result):
    # A renderer that stops answering must not cost the rest of the evidence.
    try:
        page.screenshot(path=str(path), timeout=15_000)
    except Exception as error:
        result.setdefault("screenshot_errors", []).append(f"{path.name}: {str(error)[:200]}")
        if "stuck_stack" not in result:
            result["stuck_stack"] = stuck_stack(page)


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


def session_errors(profile, session):
    """Read the actual failed assistant turn, not just the absence of a ribbon."""
    sessions = profile / "home/.openclaw/agents/main/sessions"
    try:
        index = json.loads((sessions / "sessions.json").read_text(encoding="utf-8"))
        session_id = index[session]["sessionId"]
        result = []
        for line in (sessions / f"{session_id}.jsonl").read_text(encoding="utf-8").splitlines():
            entry = json.loads(line).get("message") or {}
            if entry.get("role") == "assistant" and entry.get("errorMessage"):
                result.append(str(entry["errorMessage"])[:500])
        return result
    except (OSError, ValueError, KeyError):
        return []


def run_case(page, out, name, upstream, plan, log_path, profile, seconds, stop_when_recovered):
    upstream.plan = list(plan)
    first_request = len(upstream.requests)
    session = f"agent:main:probe-{name}"
    try:
        page.goto(f"http://127.0.0.1:18789/chat?session={session}", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_selector(".laolao-mode-switcher", timeout=60_000)
    except Exception as error:
        # A gateway still busy with the previous case must not cost the rest.
        return {"sent": {"ok": False, "error": f"page did not load: {str(error)[:200]}"}, "seconds": 0,
                "requests": 0, "watchdog_requests": 0, "request_log": [], "timeline": [], "final": {},
                "ribbon_ever": [], "gateway": [], "watchdog_retries": 0}
    page.wait_for_timeout(6000)
    offset = log_path.stat().st_size if log_path.is_file() else 0
    prompt = "碧琪，测试一下：请回复一句话。" if name == "disconnect-action" else f"你好，{name}，请说一句问候。"
    sent = page.evaluate("""async ([sessionKey, key, model, prompt]) => {
      try {
        await window.__laolaoSidebar.gwRequest('sessions.patch', {key: sessionKey, model}, 15000);
      } catch (error) { return {ok: false, error: 'model selection failed: ' + String(error)}; }
      try {
        await window.__laolaoSidebar.gwRequest('chat.send',
          {sessionKey, message: prompt, idempotencyKey: key, deliver: false}, 20000);
        return {ok: true};
      } catch (error) { return {ok: false, error: String(error)}; }
    }""", [session, f"probe-{name}-{uuid.uuid4().hex[:8]}", f"{CASE_PROVIDERS[name]}/probe-model", prompt])
    timeline = []
    rates = []
    notes = {}
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
        try:
            rates.append({"t": state["t"], **page.evaluate("({...(window.__probeRequestCounts || {})})")})
        except Exception as error:
            rates.append({"t": state["t"], "error": str(error)[:120]})
        last = timeline[-1] if timeline else {}
        if any(state.get(k) != last.get(k) for k in ("state", "message", "recovered", "failureCard", "partial")):
            timeline.append(state)
        if state.get("state") and not shot_taken:
            shot(page, out / f"probe-{name}-ribbon.png", notes)
            shot_taken = True
        if stop_when_recovered and state.get("recovered") and state.get("state") in ("", "recovered"):
            calm_since = calm_since or time.monotonic()
            if time.monotonic() - calm_since > 6:
                break
        else:
            calm_since = None
    shot(page, out / f"probe-{name}-end.png", notes)
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
        # Cumulative page→gateway requests by method, sampled once a second.
        "page_requests": rates[::5][:40],
        "final": final,
        "ribbon_ever": sorted({entry.get("message", "") for entry in timeline if entry.get("state")}),
        "gateway": lines,
        "session_errors": session_errors(profile, session),
        **notes,
        # One attempt may log both scheduling and dispatch; do not count it
        # twice when checking the connection-failure retry limit.
        "watchdog_retries": sum(1 for line in lines if "watchdog retry scheduled" in line),
    }


def judge(name, result):
    """The behaviour 碧琪 must have; returns the reasons it falls short."""
    problems = []
    if name == "bad-config":
        if not result["gateway_ready"]:
            problems.append("the gateway did not start with the config the old API form wrote")
        if result["model_key_left"]:
            problems.append("the launcher left the invalid provider key in place")
        return problems
    final = result["final"]
    claims_retry = any(entry.get("state") == "retrying" for entry in result["timeline"])
    if not result["sent"].get("ok"):
        problems.append(f"chat.send failed: {result['sent'].get('error')}")
    if result.get("screenshot_errors"):
        problems.append("the browser stopped responding while capturing the result")
    if name in ("disconnect", "disconnect-action"):
        if not any("watchdog retry scheduled" in line for line in result["gateway"]):
            problems.append("the upstream watchdog did not schedule the continuation")
        if result["watchdog_requests"] < 1:
            problems.append("the fake upstream did not receive a watchdog continuation")
        if result["requests"] > 4:
            problems.append(f"the upstream received too many requests: {result['requests']}")
        if not final.get("recovered"):
            problems.append("the reply never arrived after the stream broke off")
        if final.get("state") not in ("", "recovered"):
            problems.append(f"ribbon still shows {final.get('message')!r}")
    elif name in ("not-found", "proxy-down"):
        if name == "not-found" and not any(r.get("behaviour") == "not-found" for r in result["request_log"]):
            problems.append("the fake upstream never returned a 404")
        if name == "not-found" and (result["requests"] != 1 or result["watchdog_retries"] or claims_retry):
            problems.append("a 404 must not be retried or advertised as retrying")
        errors = " ".join(result.get("session_errors", []) + result.get("gateway", []))
        expected = r"not found|404" if name == "not-found" else r"connect|network|refused"
        if not re.search(expected, errors, re.I):
            problems.append(f"the expected {name} failure was not recorded: {errors[:500]!r}")
        if result["requests"] > 3 or result["watchdog_retries"] > 2:
            problems.append(f"{result['requests']} model requests / {result['watchdog_retries']} watchdog retries"
                            " for a failure retrying cannot fix")
        if final.get("state") == "retrying":
            problems.append(f"ribbon still claims a retry: {final.get('message')!r}")
    elif name == "plugin-missing":
        if final.get("state") == "retrying" or (claims_retry and not final.get("recovered")):
            problems.append("ribbon claims an automatic retry although no watchdog is loaded")
        if "核心插件" not in final.get("message", ""):
            problems.append(f"the page never said the core plugin is missing (ribbon {final.get('message')!r})")
    return problems


def plugin_copies(exe, profile):
    """The plugin file in the package and in the installed extension.

    The launcher re-installs the extension from the package on every start,
    so hiding only the installed copy would not survive the restart."""
    copies = list(exe.parent.rglob("services/mode-architecture/" + PLUGIN_FILE.as_posix()))
    copies.append(profile / "home/.openclaw/extensions/pinkie-mode-architecture" / PLUGIN_FILE)
    return [path for path in copies if path.is_file()]


def port_free(port=18789, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return True
        time.sleep(1)
    return False


def relaunch(launch, kill_app, exe, env, out, label):
    """Start the App after a previous run; one retry if the gateway flaps.

    The previous gateway can still answer for a moment while it shuts down,
    which made a fresh start look ready and then not."""
    for attempt in range(2):
        port_free()
        process, ready, seconds = launch(exe, env, out, label if attempt == 0 else f"{label}-retry")
        if ready:
            return process, ready, seconds
        kill_app(exe.parent)
    return process, ready, seconds


def bad_config(exe, profile, out, launch, kill_app, env):
    """The old control center's API form left a "model" key on the provider.

    OpenClaw refuses such a config and the gateway never starts; the page
    then waits for 「上游恢复」 forever.  The launcher must repair it."""
    config = profile / "home/.openclaw/openclaw.json"
    data = json.loads(config.read_text(encoding="utf-8"))
    data["models"]["providers"]["probe"]["model"] = "probe-model"
    config.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        _process, ready, seconds = relaunch(launch, kill_app, exe, env, out, "probe-bad-config")
    finally:
        kill_app(exe.parent)
    provider = json.loads(config.read_text(encoding="utf-8"))["models"]["providers"]["probe"]
    return {"gateway_ready": ready, "seconds": seconds, "model_key_left": "model" in provider,
            "models": [item.get("id") for item in provider.get("models", [])]}


def start_gateway_profiler(exe, log_path, offset, out):
    """Capture a CPU profile only on explicitly requested diagnostic runs."""
    try:
        with log_path.open("rb") as handle:
            handle.seek(offset)
            text = handle.read().decode("utf-8", "replace")
        match = re.search(r"Debugger listening on (ws://127\.0\.0\.1:\d+/[^\s]+)", text)
        if not match:
            (out / "probe-profiler-error.txt").write_text("Gateway inspector URL not found", encoding="utf-8")
            return None
        node = next(exe.parent.rglob("runtime/bin/node.exe"))
        env = os.environ.copy()
        env.pop("NODE_OPTIONS", None)
        return subprocess.Popen(
            [str(node), str(Path(__file__).with_name("profile_gateway.mjs")), match.group(1), str(out / "probe-gateway.cpuprofile")],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )
    except (OSError, StopIteration) as error:
        (out / "probe-profiler-error.txt").write_text(str(error), encoding="utf-8")
        return None


def stop_gateway_profiler(process):
    if not process or process.poll() is not None:
        return
    try:
        process.communicate(input=b"stop\n", timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        process.kill()
        process.wait(timeout=5)


def run(exe, profile, out, launch, kill_app, profile_env):
    from playwright.sync_api import sync_playwright

    port = free_port()
    upstream = FakeUpstream(port)
    upstream.start()
    configure(profile, port)
    log_path = profile / "local/SuperPinkie/logs/gateway.log"
    summary = {"port": port, "cases": {}}
    profiler = None
    sampler = CpuSampler(out / "probe-cpu.jsonl")
    sampler.start()
    try:
        env = profile_env(profile)
        profile_enabled = os.environ.get("PINKIE_SMOKE_PROFILE_GATEWAY") == "1"
        if profile_enabled:
            env["NODE_OPTIONS"] = "--inspect=127.0.0.1:0"
        log_offset = log_path.stat().st_size if log_path.is_file() else 0
        process, ready, seconds = launch(exe, env, out, "probe")
        summary["gateway_ready"], summary["seconds"] = ready, seconds
        if not ready:
            return summary
        profiler = start_gateway_profiler(exe, log_path, log_offset, out) if profile_enabled else None
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN")
            context.add_init_script(COUNT_REQUESTS)
            page = context.new_page()
            sampler.label = "disconnect"
            summary["cases"]["disconnect"] = run_case(page, out, "disconnect", upstream, ["drop", "ok"], log_path, profile, 120, True)
            sampler.label = "not-found"
            summary["cases"]["not-found"] = run_case(page, out, "not-found", upstream, ["not-found"], log_path, profile, 75, False)
            upstream.stop()
            sampler.label = "proxy-down"
            summary["cases"]["proxy-down"] = run_case(page, out, "proxy-down", upstream, ["ok"], log_path, profile, 75, False)
            upstream = FakeUpstream(port)
            upstream.start()
            sampler.label = "disconnect-action"
            summary["cases"]["disconnect-action"] = run_case(
                page, out, "disconnect-action", upstream, ["drop", "ok"], log_path, profile, 120, True)
            browser.close()
        stop_gateway_profiler(profiler)
        profiler = None
        kill_app(exe.parent)
        hidden = []
        for path in plugin_copies(exe, profile):
            path.rename(path.with_name(path.name + ".probe-hidden"))
            hidden.append(path)
        summary["hidden_plugin_files"] = [str(path) for path in hidden]
        try:
            process, ready, seconds = relaunch(launch, kill_app, exe, env, out, "probe-plugin-missing")
            if ready:
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(channel="msedge", headless=True)
                    page = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN").new_page()
                    summary["cases"]["plugin-missing"] = run_case(page, out, "plugin-missing", upstream, ["drop", "ok"], log_path, profile, 75, True)
                    browser.close()
        finally:
            kill_app(exe.parent)
            for path in hidden:
                shutil.move(str(path.with_name(path.name + ".probe-hidden")), str(path))
        summary["cases"]["bad-config"] = bad_config(exe, profile, out, launch, kill_app, env)
    finally:
        sampler.halt.set()
        stop_gateway_profiler(profiler)
        upstream.stop()
        if (profile / "local/SuperPinkie/logs").is_dir():
            shutil.copytree(profile / "local/SuperPinkie/logs", out / "probe-logs", dirs_exist_ok=True)
        # The transcripts hold the exact error text each failed turn ended with.
        sessions = profile / "home/.openclaw/agents/main/sessions"
        if sessions.is_dir():
            shutil.copytree(sessions, out / "probe-transcripts", dirs_exist_ok=True)
    for name, result in summary["cases"].items():
        result["problems"] = judge(name, result)
    summary["passed"] = len(summary["cases"]) == 6 and not any(
        result["problems"] for result in summary["cases"].values())
    return summary
