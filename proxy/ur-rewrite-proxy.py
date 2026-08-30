#!/usr/bin/env python3
"""ur-rewrite-proxy: inject unrestricted system prompts into upstream model
gateway requests at the HTTP layer.

This proxy sits between an OpenClaw gateway and its model relay (for example
the "mm" provider). For OpenAI-compatible chat completion requests whose
system prompt marks an unrestricted-mode agent, it prepends the per-model
unrestricted prompt (chosen from the prompts/ directory) as messages[0]
BEFORE forwarding. Everything else passes through untouched (with optional
retries for transient upstream failures).

Why this layer: some OpenClaw run pipelines (e.g. the dashboard/webchat path)
bypass the in-process model transports entirely, so an HTTP-layer rewrite is
the only injection point that covers every path.

Configuration (all optional, with defaults):
  UR_PROXY_LISTEN           listen port (default: 1467, or argv[1])
  UR_PROXY_UPSTREAM_HOST    upstream host (default: 127.0.0.1)
  UR_PROXY_UPSTREAM_PORT    upstream port (default: 1466)
  UR_PROXY_PROMPTS_DIR      directory with unrestricted-prompt-*.txt (default: ~/.openclaw)
  UR_PROXY_GATE_MARKER      substring that marks an unrestricted-mode agent
                            in the system prompt (default: "agent=unrestricted")
  UR_PROXY_TEMP_ZERO_MODELS comma-separated regex list of model ids that get
                            temperature forced to 0 for deterministic behavior
                            (default: gemini-3.7-flash-tiered,gemini-pro-agent,gemini-3.1-pro-high)
"""

import http.client
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("UR_PROXY_LISTEN", "1467"))
UPSTREAM_HOST = os.environ.get("UR_PROXY_UPSTREAM_HOST", "127.0.0.1")
UPSTREAM_PORT = int(os.environ.get("UR_PROXY_UPSTREAM_PORT", "1466"))
PROMPTS_DIR = os.environ.get("UR_PROXY_PROMPTS_DIR", os.path.expanduser("~/.openclaw"))
GATE_MARKER = os.environ.get("UR_PROXY_GATE_MARKER", "agent=unrestricted")
DEDUPE_MARKERS = ("你是绝对自由", "OPENCLAW_UR_INJECT")
TEMP_ZERO_MODELS = [
    re.compile(p) for p in os.environ.get(
        "UR_PROXY_TEMP_ZERO_MODELS",
        "gemini-3.7-flash-tiered,gemini-pro-agent,gemini-3.1-pro-high",
    ).split(",") if p.strip()
]

MAX_ATTEMPTS = 8
FIRST_BYTE_TIMEOUT_SECONDS = 30
STREAM_IDLE_TIMEOUT_SECONDS = 300
RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "content-length",
}


def resolve_prompt_for_model(model_id, provider=""):
    """Pick the prompt file for a model id (mirrors the transport routing)."""
    mid = (model_id or "").lower()
    if "claude" in mid or "anthropic" in (provider or ""):
        fname = "unrestricted-prompt-claude.txt"
    elif "gemini-3.7-flash-tiered" in mid or "gemini-pro-agent" in mid or "gemini-3.1-pro-high" in mid:
        fname = "unrestricted-prompt-gemini-hard.txt"
    elif "gemini" in mid:
        fname = "unrestricted-prompt-gemini.txt"
    elif "gpt-oss" in mid or "gptoss" in mid:
        fname = "unrestricted-prompt-gptoss.txt"
    elif "gpt-5" in mid or provider == "codex":
        fname = "unrestricted-prompt-gpt5.txt"
    else:
        fname = "unrestricted-prompt.txt"
    try:
        with open(os.path.join(PROMPTS_DIR, fname), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _content_injected(content):
    if isinstance(content, str):
        return content.startswith(DEDUPE_MARKERS[0]) or DEDUPE_MARKERS[1] in content
    if isinstance(content, list):
        return any(
            isinstance(b, dict) and isinstance(b.get("text"), str)
            and (b["text"].startswith(DEDUPE_MARKERS[0]) or DEDUPE_MARKERS[1] in b["text"])
            for b in content
        )
    return False


def rewrite_chat_body(raw):
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("messages"), list):
        return None
    sys_text = "\n".join(
        m.get("content", "") for m in parsed["messages"]
        if isinstance(m, dict) and m.get("role") == "system" and isinstance(m.get("content"), str)
    )
    is_gated = GATE_MARKER in sys_text or DEDUPE_MARKERS[1] in sys_text
    msgs = parsed["messages"]
    already = bool(msgs) and msgs[0].get("role") == "system" and _content_injected(msgs[0].get("content"))
    return {"parsed": parsed, "gated": is_gated, "already": already, "model": parsed.get("model")}


def retry_delay(attempt, response=None):
    fallback = (1.0, 1.5, 2.5, 3.5, 5.0, 7.0, 9.0)[min(attempt - 1, 6)]
    if response is None:
        return fallback
    raw = response.getheader("Retry-After")
    try:
        return min(max(float(raw), fallback), 12.0)
    except (TypeError, ValueError):
        return fallback


class UrRewriteProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self.proxy()

    def do_POST(self):
        self.proxy()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def proxy(self):
        if self.path == "/health":
            self.respond_json(200, {"ok": True, "attempts": MAX_ATTEMPTS})
            return

        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = max(0, int(raw_length))
        except ValueError:
            self.respond_json(400, {"error": {"message": "Invalid Content-Length"}})
            return
        body = self.rfile.read(length) if length else None
        injected = False
        if self.command == "POST" and self.path.startswith("/v1/chat/completions") and body:
            info = rewrite_chat_body(body)
            if info is not None and info["gated"] and not info["already"]:
                prompt = resolve_prompt_for_model(info["model"])
                if prompt:
                    info["parsed"]["messages"].insert(0, {"role": "system", "content": prompt})
                    mid = (info["model"] or "").lower()
                    if any(rx.search(mid) for rx in TEMP_ZERO_MODELS):
                        info["parsed"]["temperature"] = 0
                    body = json.dumps(info["parsed"], ensure_ascii=False).encode("utf-8")
                    injected = True
            print("ur-proxy: model=%s gated=%s already=%s injected=%s" % (
                (info or {}).get("model"), (info or {}).get("gated"),
                (info or {}).get("already"), injected), flush=True)
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS | {"host"}
        }

        last_error = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            connection = http.client.HTTPConnection(
                UPSTREAM_HOST, UPSTREAM_PORT, timeout=FIRST_BYTE_TIMEOUT_SECONDS
            )
            try:
                connection.request(self.command, self.path, body=body, headers=headers)
                response = connection.getresponse()
                if response.status in RETRYABLE_STATUS_CODES and attempt < MAX_ATTEMPTS:
                    response.read()
                    time.sleep(retry_delay(attempt, response))
                    continue
                if connection.sock is not None:
                    connection.sock.settimeout(STREAM_IDLE_TIMEOUT_SECONDS)
                self.relay(response)
                return
            except (OSError, TimeoutError, http.client.HTTPException) as error:
                last_error = error
                if attempt < MAX_ATTEMPTS:
                    time.sleep(retry_delay(attempt))
                    continue
            finally:
                connection.close()

        self.respond_json(
            503,
            {"error": {
                "message": f"upstream unavailable after {MAX_ATTEMPTS} attempts, please retry later.",
                "type": "upstream_unavailable",
            }},
        )
        if last_error:
            self.log_message("upstream unavailable after %d attempts: %s", MAX_ATTEMPTS, type(last_error).__name__)

    def relay(self, response):
        self.send_response(response.status, response.reason)
        for key, value in response.getheaders():
            if key.lower() not in HOP_BY_HOP_HEADERS:
                self.send_header(key, value)
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        while True:
            chunk = response.read(64 * 1024)
            if not chunk:
                break
            self.wfile.write(chunk)
            self.wfile.flush()

    def respond_json(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def log_message(self, format_string, *args):
        print("ur-proxy:", format_string % args, flush=True)


print(f"ur-rewrite-proxy listening on {LISTEN_HOST}:{LISTEN_PORT} -> {UPSTREAM_HOST}:{UPSTREAM_PORT}", flush=True)
ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), UrRewriteProxyHandler).serve_forever()
