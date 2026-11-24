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
from urllib.parse import parse_qs, urlparse

RECOVERED = "PROBE-RECOVERED-OK"
PARTIAL = "碧琪先说到一半"
DISPATCH_PROMPT = "METRE-SIDEBAR-PROBE"
DISPATCH_TITLE = "整理侧栏验收提纲"
DISPATCH_CHILD_MODEL = "sidebar-worker-free"
DISPATCH_TOOL_ID = "call_sidebar_acceptance"
ROLE_PROBE = "METRE-ROLE-PACKAGE-PROBE"
ROLE_TITLE = "角色验收：整理本机夹具"
ROLE_CHILD_MODEL = "role-worker-free"
# Since a0ebf381 a dispatched child sits in the branch under its parent's row; only a
# child whose parent is not listed (archived, deleted, other mode) goes to this group.
ORPHAN_GROUP_SELECTOR = '[data-laolao-group="__metre-dispatched"]'


def nested_child_selector(parent):
    """Rows rendered in the branch right under the parent's own sidebar row."""
    return f'#laolao-session-manager [data-session-key="{parent}"] + .pinkie-session-branch [data-session-key]'


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
                    try:
                        rss = proc.memory_info().rss >> 20
                    except (psutil.Error, OSError):
                        rss = 0
                    if delta > 0.3 or rss > 400:
                        try:
                            cmd = " ".join(proc.cmdline())[-160:]
                        except (psutil.Error, OSError):
                            cmd = ""
                        rows.append([round(delta, 1), rss, proc.pid, proc.info["name"], cmd])
                last = now
                rows.sort(reverse=True)
                memory = psutil.virtual_memory()
                handle.write(json.dumps({"t": time.strftime("%H:%M:%S"), "case": self.label,
                                         "free_mb": memory.available >> 20, "cpu": psutil.cpu_percent(),
                                         "top": rows[:8]}, ensure_ascii=False) + "\n")
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


# What the page is drawing.  The runner's software GPU process has climbed to
# every core during the probe; this names the animation, video or canvas.
VISUALS = """() => {
  const running = document.getAnimations().filter((a) => a.playState === 'running');
  const names = {};
  for (const a of running) {
    const target = a.effect && a.effect.target;
    const where = target && target.nodeType === 1 ? (target.id || String(target.className || target.tagName)).slice(0, 40) : '?';
    const key = (a.animationName || a.id || a.constructor.name) + ' @' + where;
    names[key] = (names[key] || 0) + 1;
  }
  const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 12);
  let blurred = 0;
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.backdropFilter && style.backdropFilter !== 'none') blurred += 1;
  }
  return {
    animations: running.length, top,
    canvases: document.querySelectorAll('canvas').length,
    videos: [...document.querySelectorAll('video')].filter((v) => !v.paused).length,
    blurred, nodes: document.getElementsByTagName('*').length,
    lite: document.documentElement.hasAttribute('data-pinkie-lite'),
  };
}"""


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
        self.release_sidebar_child = threading.Event()
        self.dispatch_issued = threading.Event()
        self.release_role_child = threading.Event()
        self.role_dispatch_issued = threading.Event()
        self.dispatch_lock = threading.Lock()

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
                tool_call = None
                session_start = next((tool["function"] for tool in payload.get("tools", [])
                                      if tool.get("function", {}).get("name") == "pinkie_session_start"), None)
                if ROLE_PROBE in str(last) and session_start:
                    options = session_start.get("parameters", {}).get("properties", {}).get("role", {}).get("enum", [])
                    with upstream.dispatch_lock:
                        if "researcher" in options and not upstream.role_dispatch_issued.is_set():
                            upstream.role_dispatch_issued.set()
                            tool_call = {"id": "call_role_package_probe", "type": "function", "function": {
                                "name": "pinkie_session_start", "arguments": json.dumps({
                                    "initiation": "user_asked", "role": "researcher", "title": ROLE_TITLE,
                                    "model": f"probe/{ROLE_CHILD_MODEL}", "prompt": "只读本机隔离夹具，不联网。"
                                }, ensure_ascii=False)}}
                elif DISPATCH_PROMPT in str(last) and session_start:
                    with upstream.dispatch_lock:
                        if not upstream.dispatch_issued.is_set():
                            upstream.dispatch_issued.set()
                            tool_call = {"id": DISPATCH_TOOL_ID, "type": "function", "function": {
                                "name": "pinkie_session_start", "arguments": json.dumps({
                                    "initiation": "user_asked", "mode": "project", "title": DISPATCH_TITLE,
                                    "model": f"probe/{DISPATCH_CHILD_MODEL}", "prompt": "只回复：侧栏验收完成。"
                                }, ensure_ascii=False)}}
                role_card = payload.get("model") == ROLE_CHILD_MODEL and "【角色卡：调研员】" in json.dumps(payload, ensure_ascii=False)
                upstream.requests.append({
                    "at": round(time.time(), 1),
                    "path": self.path,
                    "behaviour": behaviour,
                    "model": payload.get("model"),
                    "dispatch_tool": bool(tool_call),
                    "watchdog": WATCHDOG_PREFIX in str(last),
                    "role_card": role_card,
                })
                if payload.get("model") == DISPATCH_CHILD_MODEL:
                    upstream.release_sidebar_child.wait(90)
                elif payload.get("model") == ROLE_CHILD_MODEL:
                    upstream.release_role_child.wait(90)
                if behaviour == "not-found":
                    body = json.dumps({"error": {"message": "404 page not found", "type": "not_found_error"}}).encode()
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                text = PARTIAL if behaviour == "drop" else f"续上了，{RECOVERED}"
                message = {"role": "assistant", "content": text}
                finish = "stop"
                if tool_call:
                    message = {"role": "assistant", "content": None, "tool_calls": [tool_call]}
                    finish = "tool_calls"
                if not payload.get("stream"):
                    if behaviour == "drop":
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.close_connection = True
                        return
                    body = json.dumps({
                        "id": "probe", "object": "chat.completion", "created": int(time.time()), "model": "probe-model",
                        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
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

                if tool_call:
                    frame({"role": "assistant", "tool_calls": [{"index": 0, **tool_call}]})
                else:
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
                frame({}, finish, {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20})
                chunk(b"data: [DONE]\n\n")
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()

        self.server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.release_role_child.set()
        self.release_sidebar_child.set()
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
    providers["probe"]["models"].append({**providers["probe"]["models"][0], "id": DISPATCH_CHILD_MODEL})
    providers["probe"]["models"].append({**providers["probe"]["models"][0], "id": ROLE_CHILD_MODEL})
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
    // The completion gate's honest terminal note: a toolless reply to an
    // execution request is not accepted as done, but the turn still ends.
    honestStop: text.includes('本轮未完成'),
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
    # The headless renderer on a busy Windows runner can stall once and then
    # recover; retry the capture before treating it as a real hang.
    last_error = None
    for _attempt in range(2):
        try:
            page.screenshot(path=str(path), timeout=15_000)
            return
        except Exception as error:
            last_error = error
            page.wait_for_timeout(1500)
    result.setdefault("screenshot_errors", []).append(f"{path.name}: {str(last_error)[:200]}")
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
    # The headless browser on a busy Windows runner can time out on the very
    # first navigation even though the gateway is healthy.  Retry the load a
    # couple of times before giving up: a page that merely loaded slowly must
    # not fail the case, but a page that never comes up still does.
    load_error = None
    for _attempt in range(3):
        try:
            page.goto(f"http://127.0.0.1:18789/chat?session={session}", wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_selector(".laolao-mode-switcher", timeout=60_000)
            load_error = None
            break
        except Exception as error:
            load_error = error
            page.wait_for_timeout(2000)
    if load_error is not None:
        # A gateway still busy with the previous case must not cost the rest.
        return {"sent": {"ok": False, "error": f"page did not load: {str(load_error)[:200]}"}, "seconds": 0,
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
    visuals = []
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
            if len(rates) % 5 == 1:
                visuals.append({"t": state["t"], **page.evaluate(VISUALS)})
        except Exception as error:
            rates.append({"t": state["t"], "error": str(error)[:120]})
        last = timeline[-1] if timeline else {}
        if any(state.get(k) != last.get(k) for k in ("state", "message", "recovered", "honestStop", "failureCard", "partial")):
            timeline.append(state)
        if state.get("state") and not shot_taken:
            shot(page, out / f"probe-{name}-ribbon.png", notes)
            shot_taken = True
        settled = state.get("recovered") or (name == "disconnect-action" and state.get("honestStop"))
        if stop_when_recovered and settled and state.get("state") in ("", "recovered"):
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
        "visuals": visuals[:40],
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
        # The fake model cannot call tools, so the completion gate may refuse
        # its reply to the execution-style request; then the turn must still
        # end with the gate's honest note instead of spinning.
        settled = final.get("recovered") or (name == "disconnect-action" and final.get("honestStop"))
        if not settled:
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


def connect_packaged_webview(playwright, endpoint, timeout=45):
    """Drive the isolated App's real WebView2, never an unrelated browser.

    The smoke profile enables a fresh loopback-only CDP port. The gateway can
    be ready a little before the window, so wait for the actual page as well.
    A missing native window remains a test failure, not a reason to fall back
    to a separate Edge process or skip any outage assertion.
    """
    endpoint = str(endpoint or "")
    if not re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", endpoint):
        raise RuntimeError("isolated packaged WebView2 debugging endpoint is missing")
    deadline = time.monotonic() + timeout
    last_error = None
    browser = None
    while time.monotonic() < deadline:
        try:
            if browser is None:
                browser = playwright.chromium.connect_over_cdp(endpoint, timeout=5000)
            for context in browser.contexts:
                pages = context.pages
                if pages:
                    page = next((item for item in pages if item.url.startswith("http://127.0.0.1:18789/")), pages[0])
                    return browser, context, page
            last_error = RuntimeError("the packaged WebView2 has no page yet")
        except Exception as error:
            last_error = error
            browser = None
        time.sleep(0.5)
    raise RuntimeError(f"packaged WebView2 did not become available: {last_error}")


def seed_read_only_cli(exe, profile, env):
    """Reproduce an existing desktop whose CLI was first paired for reading.

    The profile belongs only to this smoke run. Verify the actual approved
    scopes without recording its device token or modifying user credentials.
    """
    node = next(exe.parent.rglob("runtime/bin/node.exe"))
    cli = node.parent.parent / "node_modules/openclaw/openclaw.mjs"
    result = subprocess.run([str(node), str(cli), "gateway", "call", "sessions.list",
                             "--params", '{"agentId":"main","limit":1}', "--json", "--timeout", "15000"],
                            env=env, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError("could not prepare the read-only CLI pairing")
    auth = json.loads((profile / "home/.openclaw/identity/device-auth.json").read_text(encoding="utf-8"))
    scopes = set(auth.get("tokens", {}).get("operator", {}).get("scopes", []))
    if "operator.read" not in scopes or scopes.intersection({"operator.write", "operator.admin"}):
        raise RuntimeError("smoke profile did not get a read-only CLI pairing")
    return {"read_only": True}


def verify_metre_sidebar(page, out, upstream):
    """The real gateway dispatches with a local tool response, never a paid model."""
    parent = f"agent:metre:sidebar-smoke-{uuid.uuid4().hex[:8]}"
    upstream.plan = ["ok"]
    first_request = len(upstream.requests)
    page.goto(f"http://127.0.0.1:18789/chat?session={parent}", wait_until="domcontentloaded", timeout=90_000)
    page.wait_for_function("""() => document.documentElement.dataset.laolaoMode === 'metre'
      && !document.getElementById('laolao-splash') && Boolean(window.__laolaoSidebar?.gwRequest)
      && Boolean(document.querySelector('#laolao-session-manager'))""", timeout=90_000)
    try:
        page.evaluate("""async key => {
          const rpc = window.__laolaoSidebar.gwRequest;
          await rpc('sessions.create', {key, agentId: 'metre', model: 'probe/probe-model'}, 15000);
          localStorage.setItem('pinkie:session-sidebar:fold:' + key, '1');
        }""", parent)
        for label, value in (("Virtuoso", "solo"), ("Baton", "dispatch")):
            page.get_by_role("radio", name=label, exact=True).click(timeout=20_000)
            page.locator(f'.pinkie-baton__seg[aria-label="{label}"][aria-checked="true"]').wait_for(timeout=20_000)
            saved = page.evaluate("""key => window.__laolaoSidebar.gwRequest('pinkie.session.prefs.get', {key})""", parent)
            if saved.get("dispatch") != value:
                raise RuntimeError(f"{label} was not saved for the conversation receiving the message")
        await_dispatch = page.evaluate("""([key, prompt]) => window.__laolaoSidebar.gwRequest(
          'chat.send', {sessionKey: key, message: prompt, deliver: false, idempotencyKey: key}, 20000)
        """, [parent, DISPATCH_PROMPT])
        if await_dispatch.get("status") not in ("started", "ok"):
            raise RuntimeError("Metre test message did not start")
        entry = page.locator(nested_child_selector(parent)).filter(has_text=DISPATCH_TITLE)
        entry.wait_for(state="visible", timeout=75_000)
        child = entry.get_attribute("data-session-key")
        if not child or not child.startswith("agent:project:pinkie-child:"):
            raise RuntimeError("Metre sidebar did not show the dispatched project session")
        if page.locator(ORPHAN_GROUP_SELECTOR + f' [data-session-key="{child}"]').count():
            raise RuntimeError("Metre sidebar listed a dispatch whose parent is shown as an orphan too")
        if not any(item["dispatch_tool"] for item in upstream.requests[first_request:]):
            raise RuntimeError("the packaged gateway did not request the scripted dispatch tool")
        page.screenshot(path=str(out / "metre-dispatched-sidebar.png"), timeout=15_000)
    except Exception:
        # This isolated profile contains only fixture messages. Capture the
        # gateway's answer so a rejected tool call is distinguishable from a missing row.
        try:
            details = page.evaluate("""async key => {
              const rpc = window.__laolaoSidebar.gwRequest;
              const [lineage, history] = await Promise.all([
                rpc('pinkie.session.lineage', {agentId: 'metre'}, 5000),
                rpc('chat.history', {sessionKey: key, limit: 10}, 5000),
              ]);
              return {away: lineage?.away || {}, messages: history?.messages || []};
            }""", parent)
        except Exception as error:
            details = {"probe_error": str(error)}
        details["fixture_requests"] = upstream.requests[first_request:]
        (out / "metre-dispatch-diagnostics.json").write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[metre-sidebar] " + json.dumps(details, ensure_ascii=False)[:3000], flush=True)
        raise
    finally:
        upstream.release_sidebar_child.set()
    entry.get_by_role("link", name=DISPATCH_TITLE, exact=True).click(timeout=15_000)
    try:
        page.wait_for_function("""(key) => new URL(location.href).searchParams.get('session') === key
          && document.documentElement.dataset.laolaoMode === 'project'
          && !document.querySelector('.laolao-mode-transition')""", arg=child, timeout=35_000)
    except Exception:
        view = page.evaluate("""() => ({
          url: location.href, mode: document.documentElement.dataset.laolaoMode,
          pending: document.documentElement.dataset.laolaoModePending,
          transition: Boolean(document.querySelector('.laolao-mode-transition')),
          pane: document.querySelector('openclaw-chat-pane[active]')?.state?.sessionKey,
          note: [...document.querySelectorAll('.laolao-toast')].map(node => node.textContent).slice(-2),
        })""")
        print("[metre-sidebar] after click: " + json.dumps(view, ensure_ascii=False), flush=True)
        page.screenshot(path=str(out / "metre-dispatched-click-diagnostic.png"), timeout=10_000)
        raise
    owned = page.locator(f'#laolao-session-manager [data-session-key="{child}"]')
    owned.wait_for(state="visible", timeout=30_000)
    if parse_qs(urlparse(page.url).query).get("session") != [child]:
        raise RuntimeError("Metre sidebar opened a different session")
    return {"passed": True, "child": child, "engine": "packaged WebView2"}


def verify_metre_role_sidebar(page, out, upstream):
    """Dispatch an official role through the packaged UI and inspect its real board."""
    parent = f"agent:metre:roles-smoke-{uuid.uuid4().hex[:8]}"
    upstream.plan = ["ok"]
    first_request = len(upstream.requests)
    page.goto(f"http://127.0.0.1:18789/chat?session={parent}", wait_until="domcontentloaded", timeout=90_000)
    page.wait_for_function("""() => document.documentElement.dataset.laolaoMode === 'metre'
      && !document.getElementById('laolao-splash') && Boolean(window.__laolaoSidebar?.gwRequest)
      && Boolean(window.__pinkieMetreBoard?.open)""", timeout=90_000)
    try:
        page.evaluate("""async key => {
          const rpc = window.__laolaoSidebar.gwRequest;
          await rpc('sessions.create', {key, agentId: 'metre', model: 'probe/probe-model'}, 15000);
          localStorage.setItem('pinkie:session-sidebar:fold:' + key, '1');
        }""", parent)
        baton = page.get_by_role("radio", name="Baton", exact=True)
        if baton.get_attribute("aria-checked") != "true":
            baton.click(timeout=20_000)
        page.locator('.pinkie-baton__seg[aria-label="Baton"][aria-checked="true"]').wait_for(timeout=20_000)
        result = page.evaluate("""([key, prompt]) => window.__laolaoSidebar.gwRequest(
          'chat.send', {sessionKey: key, message: prompt, deliver: false, idempotencyKey: key}, 20000)
        """, [parent, ROLE_PROBE])
        if result.get("status") not in ("started", "ok"):
            raise RuntimeError("Metre role test message did not start")

        entry = page.locator(nested_child_selector(parent)).filter(has_text=ROLE_TITLE)
        entry.get_by_text("调研员", exact=True).wait_for(timeout=75_000)
        child = entry.get_attribute("data-session-key")
        if not child or not child.startswith("agent:roles:pinkie-child:"):
            raise RuntimeError("packaged Metre sidebar did not group the role child correctly")
        board = page.evaluate("""key => window.__laolaoSidebar.gwRequest(
          'pinkie.metre.board', {sessionKey: key}, 15000)""", parent)
        row = next((s for s in board.get("sessions", []) if s["key"] == child), None)
        cards = board.get("runtime", {}).get("metreRoles") or {}
        if not row or row.get("role") != "researcher" or row.get("roleName") != "调研员" or row.get("roleSource") != "official":
            raise RuntimeError("role task identity is missing on the packaged board")
        if cards.get("valid") != 33 or cards.get("invalid") != 0:
            raise RuntimeError("the fresh packaged gateway did not load 33 valid official roles")

        menu_button = page.locator("button.laolao-mode-switcher:visible").first
        modes_by_theme = {}
        for theme in ("light", "dark"):
            page.emulate_media(color_scheme=theme)
            # Set the isolated WebView's app theme as well as the OS media query:
            # the package can persist a scheme independently of the OS.
            page.evaluate("""theme => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.dataset.themeMode = theme;
            }""", theme)
            menu_button.click(timeout=15_000)
            menu = page.locator(".laolao-mode-menu:visible")
            menu.wait_for(timeout=15_000)
            modes = menu.locator("button[data-mode]").evaluate_all("(rows) => rows.map(row => row.dataset.mode)")
            if "metre" not in modes or "roles" in modes:
                raise RuntimeError(f"unexpected user-visible mode menu: {modes}")
            modes_by_theme[theme] = modes
            page.screenshot(path=str(out / f"metre-roles-menu-{theme}.png"), timeout=15_000)
            menu_button.click(timeout=15_000)
            menu.wait_for(state="hidden", timeout=15_000)
        page.evaluate("() => window.__pinkieMetreBoard.open()")
        page.locator("#pk-metre-board .pk-mb-role-label").filter(has_text="调研员").wait_for(timeout=25_000)
        page.screenshot(path=str(out / "metre-roles-board.png"), timeout=15_000)
        role_requests = [r for r in upstream.requests[first_request:] if r["model"] == ROLE_CHILD_MODEL]
        if not role_requests or not role_requests[0]["role_card"]:
            raise RuntimeError("the isolated model capture did not contain the official role card")
        return {"passed": True, "child": child, "role": row["role"], "model": row.get("model"),
                "validCards": cards["valid"], "invalidCards": cards["invalid"], "modes": modes_by_theme,
                "engine": "packaged WebView2", "provider": "synthetic loopback only"}
    finally:
        upstream.release_role_child.set()


def run_metre_sidebar_only(exe, profile, out, launch, kill_app, profile_env):
    """Re-run this one acceptance case with an isolated, real packaged window."""
    from playwright.sync_api import sync_playwright

    env = profile_env(profile)
    try:
        _, ready, _ = launch(exe, env, out, "metre-prepare")
        if not ready:
            raise RuntimeError("fresh gateway did not start")
    finally:
        kill_app(exe.parent)
    upstream = FakeUpstream(free_port())
    upstream.start()
    try:
        configure(profile, upstream.port)
        _, ready, _ = relaunch(launch, kill_app, exe, env, out, "metre-sidebar")
        if not ready:
            raise RuntimeError("gateway with the loopback model did not start")
        with sync_playwright() as playwright:
            browser, _, page = connect_packaged_webview(playwright, env.get("PINKIE_SMOKE_WEBVIEW_CDP"))
            try:
                return verify_metre_sidebar(page, out, upstream)
            finally:
                browser.close()
    finally:
        upstream.release_sidebar_child.set()
        kill_app(exe.parent)
        upstream.stop()


def run(exe, profile, out, launch, kill_app, profile_env, *, metre_sidebar=False, metre_roles=False):
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
        # The watchdog must recover an interrupted turn even if an older
        # read-only call paired the shared CLI identity before it tried to send.
        summary["prior_cli_pairing"] = seed_read_only_cli(exe, profile, env)
        profiler = start_gateway_profiler(exe, log_path, log_offset, out) if profile_enabled else None
        with sync_playwright() as playwright:
            browser, context, page = connect_packaged_webview(playwright, env.get("PINKIE_SMOKE_WEBVIEW_CDP"))
            context.add_init_script(COUNT_REQUESTS)
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
            if metre_sidebar:
                sampler.label = "metre-sidebar"
                try:
                    summary["metre_sidebar"] = verify_metre_sidebar(page, out, upstream)
                except Exception as error:
                    summary["metre_sidebar"] = {"passed": False, "error": str(error)}
            if metre_roles:
                sampler.label = "metre-roles"
                try:
                    summary["metre_roles"] = verify_metre_role_sidebar(page, out, upstream)
                except Exception as error:
                    summary["metre_roles"] = {"passed": False, "error": str(error)}
            browser.close()
        stop_gateway_profiler(profiler)
        profiler = None
        kill_app(exe.parent)
        hidden = []
        # The user (release) build treats a package missing its own files as
        # not official and says so; that case only applies to dev builds.
        release = (exe.parent / "_internal/build-info.json").is_file() and '"channel": "release"' in (exe.parent / "_internal/build-info.json").read_text(encoding="utf-8-sig")
        for path in ([] if release else plugin_copies(exe, profile)):
            path.rename(path.with_name(path.name + ".probe-hidden"))
            hidden.append(path)
        summary["hidden_plugin_files"] = [str(path) for path in hidden]
        summary["release"] = release
        try:
            process, ready, seconds = relaunch(launch, kill_app, exe, env, out, "probe-plugin-missing") if not release else (None, False, 0)
            if ready:
                with sync_playwright() as playwright:
                    browser, context, page = connect_packaged_webview(playwright, env.get("PINKIE_SMOKE_WEBVIEW_CDP"))
                    context.add_init_script(COUNT_REQUESTS)
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
    summary["passed"] = (
        (not metre_sidebar or summary.get("metre_sidebar", {}).get("passed") is True)
        and (not metre_roles or summary.get("metre_roles", {}).get("passed") is True)
        and len(summary["cases"]) == (5 if summary.get("release") else 6) and not any(result["problems"] for result in summary["cases"].values())
    )
    return summary
