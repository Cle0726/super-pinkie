"""Windows smoke test for the packaged 超級碧琪 desktop App.

Runs on a GitHub windows-latest runner (or any Windows box).  Each scenario
starts the real packaged exe against an isolated USERPROFILE/LOCALAPPDATA,
waits for the bundled gateway on 18789, checks that all six mode agents are
registered, then drives http://127.0.0.1:18789/chat in Edge with Playwright and
switches through every mode.  No model key is configured: only the shell,
gateway, plugins and mode switching are exercised.

    python tools/windows-smoke/smoke.py --app <onedir> --out <dir> \
        [--old-app <older onedir>] [--strict]

Everything lands in --out: screenshots, console logs, gateway/launcher logs,
the (redacted) openclaw.json and a summary.json.  --strict exits non-zero when
any scenario fails, which is what the release gate uses.
"""

import argparse
import json
import locale
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.release.runtime_inventory import inspect_activation

GATEWAY = "http://127.0.0.1:18789/"
CHAT = GATEWAY + "chat"
MODES = [
    ("chat", "agent:main:"),
    ("project", "agent:project:"),
    ("thinking", "agent:thinking:"),
    ("learning", "agent:learning:"),
    ("unrestricted", "agent:unrestricted:"),
    ("metre", "agent:metre:"),
]
AGENTS = ["main", "project", "thinking", "learning", "unrestricted", "metre"]
SECRET = re.compile(r"(key|token|secret|password|authorization)", re.I)


def log(message):
    print(f"[smoke {time.strftime('%H:%M:%S')}] {message}", flush=True)


def find_exe(app_dir):
    app_dir = Path(app_dir)
    for candidate in [app_dir / "超級碧琪.exe", *app_dir.glob("*/超級碧琪.exe")]:
        if candidate.is_file():
            return candidate
    raise SystemExit(f"no 超級碧琪.exe under {app_dir}")


REPO = Path(__file__).resolve().parents[2]


def release_info(exe):
    """The user (release-channel) build: guard on, channel release, written into the package."""
    for base in (exe.parent / "_internal", exe.parent):
        info_file = base / "build-info.json"
        if info_file.is_file():
            try:
                info = json.loads(info_file.read_text(encoding="utf-8-sig"))
            except ValueError:
                return None
            return info if info.get("guard") is True and info.get("channel") == "release" else None
    return None


def release_package_checks(exe):
    """A release package ships the release opening video and poster, never the dev ones."""
    import hashlib

    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    expected = {
        "laolao-splash.mp4": digest(REPO / "ui/assets/laolao-splash-release.mp4"),
        "laolao-splash-video-poster.png": digest(REPO / "ui/assets/laolao-splash-video-poster-release.png"),
    }
    found = {name: [] for name in expected}
    for name in expected:
        for path in exe.parent.rglob(name):
            found[name].append({"path": str(path.relative_to(exe.parent)), "release": digest(path) == expected[name]})
    passed = all(found[name] and all(item["release"] for item in found[name]) for name in expected)
    return {"passed": passed, "splash": found}


def runtime_dir(exe):
    for base in (exe.parent / "_internal", exe.parent):
        if (base / "runtime/bin/node.exe").is_file():
            return base / "runtime"
    raise SystemExit(f"no bundled runtime next to {exe}")


def profile_env(profile):
    home = profile / "home"
    local = profile / "local"
    roaming = profile / "roaming"
    for directory in (home, local, roaming):
        directory.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    for name in ("PINKIE_STATE_ROOT", "OPENCLAW_CONFIG_PATH", "OPENCLAW_ROOT", "UR_PROMPTS_DIR", "PYTHONUTF8"):
        env.pop(name, None)
    env.update({
        "USERPROFILE": str(home),
        "HOME": str(home),
        "LOCALAPPDATA": str(local),
        "APPDATA": str(roaming),
    })
    # Only this isolated smoke profile opens a localhost debugging endpoint.
    # Capture the actual packaged WebView2, not Edge's separate renderer.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        debug_port = listener.getsockname()[1]
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={debug_port}"
    env["PINKIE_SMOKE_WEBVIEW_CDP"] = f"http://127.0.0.1:{debug_port}"
    return env


def capture_native_ui(exe, env, out, label, pid):
    runtime = runtime_dir(exe)
    script = Path(__file__).resolve().parents[1] / "ui-parity/capture.mjs"
    command = [str(runtime / "bin/node.exe"), str(script),
               "--control-ui", str(runtime / "node_modules/openclaw/dist/control-ui"),
               "--cdp", env["PINKIE_SMOKE_WEBVIEW_CDP"], "--browser", "webview2",
               "--native-platform", "windows", "--label", "native-" + label,
               "--desktop-python", sys.executable, "--app-pid", str(pid),
               "--out", str(out.resolve()), "--strict"]
    result = subprocess.run(command, env=env, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=480)
    (out / f"{label}-native-capture.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"packaged WebView2 UI capture failed: {result.returncode}")
    return {"passed": True, "engine": "packaged WebView2", "views": ["home", "chat", "cards", "sidebar", "learning", "power"]}


def http_ready(url=GATEWAY):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return 200 <= response.status < 400
    except Exception:
        return False


def service_health():
    result = {}
    for name, port in (("party", 18889), ("roundtable", 18891)):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=3) as response:
                data = json.loads(response.read().decode("utf-8"))
            result[name] = data.get("service") == f"super-pinkie-{name}"
        except (OSError, ValueError, AttributeError):
            result[name] = False
    return result


def kill_app(app_dir):
    """Stop every process started from this App directory (exe, node, relays)."""
    script = (
        "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and "
        f"$_.ExecutablePath.StartsWith('{str(Path(app_dir).resolve())}', 'OrdinalIgnoreCase') }} | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=False)
    deadline = time.monotonic() + 30
    while http_ready() and time.monotonic() < deadline:
        time.sleep(1)


def desktop_shot(path):
    try:
        from PIL import ImageGrab
        ImageGrab.grab(all_screens=True).save(path)
    except Exception as error:  # Desktop capture is best effort on CI.
        log(f"desktop screenshot failed: {error}")


def guard_alerts(env):
    path = Path(env["LOCALAPPDATA"]) / "SuperPinkie/logs/guard.log"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [line.strip()[:200] for line in lines if "alert:" in line]


def guard_alert(env, since=0):
    """The first guard notice raised after the first `since` ones."""
    return next(iter(guard_alerts(env)[since:]), "")


def launch(exe, env, out, label, timeout=480):
    log(f"[{label}] launching {exe}")
    seen = len(guard_alerts(env))
    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent))
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        if http_ready():
            break
        if process.poll() is not None:
            log(f"[{label}] exe exited early with {process.returncode}")
            break
        if guard_alert(env, seen):
            # The guard's message box holds startup until someone clicks it.
            log(f"[{label}] guard notice raised: {guard_alert(env, seen)}")
            break
        time.sleep(2)
    ready = http_ready()
    seconds = round(time.monotonic() - started, 1)
    log(f"[{label}] gateway ready={ready} after {seconds}s")
    # The launcher finishes prepare() before it starts the gateway; give the
    # window a moment to load the chat page before the desktop capture.
    time.sleep(15 if ready else 0)
    desktop_shot(out / f"{label}-desktop.png")
    return process, ready, seconds


def agents_list(runtime, env, out, label):
    command = [str(runtime / "bin/node.exe"), str(runtime / "node_modules/openclaw/openclaw.mjs"), "agents", "list", "--json"]
    result = subprocess.run(command, env=env, capture_output=True, timeout=120)
    (out / f"{label}-agents-list.stdout.bin").write_bytes(result.stdout)
    (out / f"{label}-agents-list.stderr.txt").write_bytes(result.stderr)
    text = result.stdout.decode("utf-8", "replace")
    decode = {}
    # What the launcher sees: subprocess text=True decodes with the ANSI code
    # page.  Chinese Windows is cp936; the runner is cp1252.
    for codec in ("cp936", "cp1252", locale.getpreferredencoding(False)):
        try:
            result.stdout.decode(codec)
            decode[codec] = "ok"
        except UnicodeDecodeError as error:
            decode[codec] = f"UnicodeDecodeError: {error}"
    ids = []
    identities = {}
    parse_error = None
    try:
        start = text.find("[")
        items = json.loads(text[start:] if start >= 0 else text)
        ids = [item.get("id") for item in items if isinstance(item, dict)]
        identities = {item.get("id"): item.get("identityName") for item in items if isinstance(item, dict) and item.get("id")}
    except ValueError as error:
        parse_error = str(error)
    return {
        "returncode": result.returncode,
        "ids": ids,
        "identities": identities,
        "missing": [agent for agent in AGENTS if agent not in ids],
        "stdout_is_pure_json": text.lstrip().startswith("["),
        "parse_error": parse_error,
        "decode": decode,
    }


def redact(value):
    if isinstance(value, dict):
        return {k: ("<redacted>" if SECRET.search(k) and isinstance(v, str) else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def fresh_mode_identities_ok(label, agents):
    # Existing users may have deliberately customized their identities.
    identities = agents.get("identities", {})
    return label != "fresh" or all(identities.get(agent) == ("Metre" if agent == "metre" else "碧琪") for agent in AGENTS)


def collect_files(profile, out, label):
    home = profile / "home"
    state = profile / "local/SuperPinkie"
    config = home / ".openclaw/openclaw.json"
    if config.is_file():
        try:
            data = json.loads(config.read_text(encoding="utf-8"))
            (out / f"{label}-openclaw.json").write_text(json.dumps(redact(data), ensure_ascii=False, indent=2), encoding="utf-8")
        except ValueError:
            shutil.copy2(config, out / f"{label}-openclaw.raw.json")
    if (state / "logs").is_dir():
        shutil.copytree(state / "logs", out / f"{label}-logs", dirs_exist_ok=True)
    markers = sorted(p.name for p in state.glob("bundled-setup-*")) if state.is_dir() else []
    workspaces = {}
    for workspace in sorted((home / ".openclaw").glob("workspace*")):
        files = sorted(p.name for p in workspace.iterdir())
        soul = workspace / "SOUL.md"
        head = soul.read_text(encoding="utf-8", errors="replace").splitlines()[:2] if soul.is_file() else []
        workspaces[workspace.name] = {"files": files, "soul_head": head}
    problems = []
    logs = state / "logs"
    # Failures the launcher only writes to its own logs.
    for name, pattern in (
        ("setup.log", r"安装失败|⚠️"),
        ("launcher.log", r"service failed|startup failed|gateway start failed"),
        ("gateway.log", r"failed to load|plugin\(s\) failed"),
        # A guard notice on an untouched profile means the App flagged its
        # own setup as tampering (and the box blocks startup until clicked).
        ("guard.log", r"alert:"),
    ):
        path = logs / name
        if path.is_file():
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                if re.search(pattern, line):
                    problems.append(f"{name}: {line.strip()[:300]}")
    return {"markers": markers, "workspaces": workspaces, "log_problems": sorted(set(problems))}


PAGE_STATE = r"""() => {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const shell = document.querySelector('openclaw-app-shell');
  return {
    url: location.href,
    mode: html.getAttribute('data-laolao-mode'),
    pending: html.getAttribute('data-laolao-mode-pending'),
    session: params.get('session') || '',
    shellSession: shell?.context?.gateway?.snapshot?.sessionKey || '',
    transition: Boolean(document.querySelector('.laolao-mode-transition')),
    switcher: Boolean(document.querySelector('.laolao-mode-switcher')),
    // document.body is null for a moment while a mode switch reloads the page.
    fonts: document.body ? getComputedStyle(document.body).fontFamily : '',
    text: (document.body?.innerText || '').slice(0, 600),
    // Gateway errors surface as a banner, e.g. 'Unknown agent id "project"'.
    gatewayError: ((document.body?.innerText || '').match(/(GatewayRequestError[^\n]*|Unknown agent id[^\n]*)/) || [''])[0],
  };
}"""


METRE_DIALOG = ".laolao-metre-lock-dialog"
METRE_LOCK_READY = r"""async () => {
  const status = await window.__laolaoSidebar?.gwRequest('pinkie.guard.metreStatus', {}, 8000);
  return status?.required === true && status.configured === true && status.locked === true && !status.unlocked;
}"""


def still_outside_metre(before, state):
    return bool(before["mode"] and before["mode"] != "metre"
                and state["mode"] == before["mode"] and state["pending"] != "metre"
                and not any(state[key].lower().startswith("agent:metre:") for key in ("session", "shellSession")))


def open_release_metre_prompt(page, before, timeout_error, label):
    password = page.locator(f'{METRE_DIALOG} input[type="password"]')

    def select_metre():
        page.click(".laolao-mode-switcher", timeout=15_000)
        page.locator('.laolao-mode-menu__option[data-mode="metre"]').click(timeout=10_000)

    select_metre()
    try:
        password.wait_for(state="visible", timeout=20_000)
        return "first"
    except timeout_error:
        # A previous mode switch reloads the chat page. Its new gateway socket
        # can still be connecting, and the status request can outlast this wait.
        # Retry only this missing prompt, and only once the real lock answers.
        if not still_outside_metre(before, page.evaluate(PAGE_STATE)):
            raise RuntimeError("mode/session changed without showing the Metre password prompt")
        if not page.evaluate(METRE_LOCK_READY):
            raise RuntimeError("gateway did not confirm the configured Metre lock before retry")
        if password.is_visible():
            return "late"
        log(f"[{label}] Metre password prompt timed out; retrying once after the lock answered")
        select_metre()
        password.wait_for(state="visible", timeout=20_000)
        return "retry"


def drive_ui(out, label, release=False):
    # Let the context report the service worker's own requests (see measure_loads).
    os.environ.setdefault("PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS", "1")
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

    result = {"modes": {}, "console_errors": [], "page_errors": [], "failed_requests": [], "http_errors": []}
    console = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        try:
            result["cache_evidence"] = cache_evidence()
            (out / f"{label}-cache-evidence.json").write_text(json.dumps(result["cache_evidence"], indent=2), encoding="utf-8")
        except Exception as error:
            result["cache_evidence"] = {"error": repr(error)}
        try:
            result["load_metrics"] = measure_loads(browser, out, label)
        except Exception as error:
            result["load_metrics"] = {"error": repr(error)}
        for scheme in ("light", "dark"):
            context = browser.new_context(viewport={"width": 1280, "height": 800}, color_scheme=scheme, locale="zh-CN")
            page = context.new_page()
            page.on("console", lambda msg: console.append({"scheme": scheme, "type": msg.type, "text": msg.text, "url": page.url, "location": msg.location}))
            page.on("pageerror", lambda error: result["page_errors"].append({"scheme": scheme, "error": str(error)}))
            page.on("requestfailed", lambda req: result["failed_requests"].append({"scheme": scheme, "url": req.url, "failure": req.failure}))
            page.on("response", lambda res: result["http_errors"].append({"scheme": scheme, "url": res.url, "status": res.status}) if res.status >= 400 else None)
            page.goto(CHAT, wait_until="domcontentloaded", timeout=120_000)
            try:
                page.wait_for_selector(".laolao-mode-switcher", timeout=90_000)
            except Exception as error:
                result.setdefault("errors", []).append(f"{scheme}: no mode switcher: {error}")
            page.wait_for_timeout(8000)  # entry splash
            page.screenshot(path=str(out / f"{label}-{scheme}-initial.png"))
            result[f"{scheme}_initial"] = page.evaluate(PAGE_STATE)
            if scheme == "dark":
                context.close()
                break
            if release:
                # The user build asks once whether to send usage summaries. It
                # is a modal over the whole window: answer 暂不开启 like a user
                # who skips it, and check nothing is sent before they choose.
                prompt = {"ok": False}
                try:
                    page.wait_for_selector("#pinkie-feedback-onboarding", state="visible", timeout=45_000)
                    prompt["status_before"] = page.evaluate("""async () => {
                      const s = await window.__laolaoSidebar.gwRequest('pinkie.feedback.status', {}, 15000);
                      return {ok: s?.ok, isRelease: s?.isRelease, asked: s?.asked, consent: s?.consent};
                    }""")
                    page.screenshot(path=str(out / f"{label}-feedback-prompt.png"))
                    page.click('#pinkie-feedback-onboarding [data-choice="decline"]', timeout=10_000)
                    page.wait_for_selector("#pinkie-feedback-onboarding", state="detached", timeout=15_000)
                    prompt["status_after"] = page.evaluate("""async () => {
                      const s = await window.__laolaoSidebar.gwRequest('pinkie.feedback.status', {}, 15000);
                      return {ok: s?.ok, asked: s?.asked, consent: s?.consent};
                    }""")
                    before, after = prompt["status_before"], prompt["status_after"]
                    prompt["ok"] = bool(before.get("isRelease") is True and before.get("consent") is not True
                                        and after.get("asked") is True and after.get("consent") is not True)
                except Exception as error:
                    prompt["error"] = str(error)
                result["feedback_prompt"] = prompt
                log(f"[{label}] feedback prompt: ok={prompt['ok']}")
            # A plugin may fail to register without a visible load error. Ask
            # the real gateway for two read-only methods supplied by it.
            # In the user (release) build Metre stays behind the developer
            # password: the board must be refused and the lock must report
            # itself configured and locked. A dev build must answer it.
            result["plugin_methods"] = page.evaluate("""async (release) => {
              const checks = [
                ['usage', 'pinkie.usage.get', {}],
                ['workbench', 'pinkie.fs.status', {sessionKey: 'agent:project:main'}],
                ['model_setup', 'pinkie.modelSetup.list', {}],
                ['learning_desk', 'pinkie.learning.desk.metrics', {sessionKey: 'agent:learning:main'}],
                ['metre_board', 'pinkie.metre.board', {sessionKey: 'agent:metre:main'}],
              ];
              const result = {};
              const rpc = (method, params) => {
                if (!window.__laolaoSidebar?.gwRequest) throw new Error('gateway client unavailable');
                return window.__laolaoSidebar.gwRequest(method, params, 15000);
              };
              for (const [name, method, params] of checks) {
                try {
                  if (name === 'metre_board' && release) {
                    const status = await rpc('pinkie.guard.metreStatus', {});
                    if (!status?.required || !status.locked || status.unlocked || status.configured === false) {
                      throw new Error('release build: Metre lock is not required, configured and locked: ' + JSON.stringify(status));
                    }
                    let refused = '';
                    try { await rpc(method, params); } catch (error) { refused = String(error?.message || error); }
                    if (!refused.includes('开发者密码')) throw new Error('release build: locked Metre board was not refused: ' + (refused || 'answered'));
                    result[name] = {ok: true, locked: true, refused};
                    continue;
                  }
                  const value = await rpc(method, params);
                  if (name === 'metre_board' && (!value?.ok || !value.overview || !Array.isArray(value.sessions))) {
                    throw new Error('Metre board did not return a valid overview and session list');
                  }
                  if (name === 'model_setup' && !Array.isArray(value?.providers)) {
                    throw new Error('model setup did not return its provider list');
                  }
                  if (name === 'learning_desk' && !value?.range) {
                    throw new Error('the learning desk did not return its metrics');
                  }
                  result[name] = {ok: true};
                } catch (error) { result[name] = {ok: false, error: String(error)}; }
              }
              return result;
            }""", release)
            for index, (mode, prefix) in enumerate(MODES):
                entry = {"ok": False}
                if release and mode == "metre":
                    # The user build asks for the developer password and stays
                    # where it was when the prompt is cancelled.
                    try:
                        before = page.evaluate(PAGE_STATE)
                        entry["prompt_delivery"] = open_release_metre_prompt(page, before, PlaywrightTimeoutError, label)
                        page.screenshot(path=str(out / f"{label}-mode-{index + 1}-metre-locked.png"))
                        page.keyboard.press("Escape")
                        page.wait_for_selector(METRE_DIALOG, state="detached", timeout=10_000)
                        page.wait_for_timeout(1500)
                        entry["state"] = page.evaluate(PAGE_STATE)
                        entry["locked_prompt"] = True
                        entry["ok"] = still_outside_metre(before, entry["state"])
                    except Exception as error:
                        entry["error"] = str(error)
                    page.screenshot(path=str(out / f"{label}-mode-{index + 1}-{mode}.png"))
                    result["modes"][mode] = entry
                    log(f"[{label}] mode {mode}: locked prompt ok={entry['ok']}")
                    continue
                try:
                    page.click(".laolao-mode-switcher", timeout=15_000)
                    page.wait_for_selector(".laolao-mode-menu__option", timeout=10_000)
                    page.locator(".laolao-mode-menu__option").nth(index).click(timeout=10_000)
                    deadline = time.monotonic() + 40
                    state = None
                    while time.monotonic() < deadline:
                        page.wait_for_timeout(500)
                        try:
                            state = page.evaluate(PAGE_STATE)
                        except Exception as error:
                            # Switching modes reloads the page on purpose; a poll that
                            # lands mid-reload sees "Execution context was destroyed".
                            if "context was destroyed" not in str(error) and "navigat" not in str(error):
                                raise
                            continue
                        # The URL may carry the alias "main"; the shell's
                        # resolved key says which agent really answers.
                        session = state["shellSession"] or state["session"]
                        if state["mode"] == mode and not state["transition"] and session.startswith(prefix):
                            entry["ok"] = True
                            break
                    page.wait_for_timeout(1500)
                    for attempt in range(3):
                        try:
                            entry["state"] = page.evaluate(PAGE_STATE)
                            break
                        except Exception as error:
                            if attempt == 2 or ("context was destroyed" not in str(error) and "navigat" not in str(error)):
                                raise
                            page.wait_for_timeout(1000)
                    if entry["state"]["gatewayError"]:
                        entry["ok"] = False
                except Exception as error:
                    entry["error"] = str(error)
                    try:
                        entry["state"] = page.evaluate(PAGE_STATE)
                    except Exception:
                        pass
                page.screenshot(path=str(out / f"{label}-mode-{index + 1}-{mode}.png"))
                result["modes"][mode] = entry
                log(f"[{label}] mode {mode}: ok={entry['ok']} session={entry.get('state', {}).get('session')}")
            context.close()
        browser.close()
    result["console_errors"] = [item for item in console if item["type"] in ("error", "warning")]
    (out / f"{label}-console.json").write_text(json.dumps(console, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def cache_evidence(base=GATEWAY):
    """Ask the gateway directly: does an unchanged UI file come back as 304?

    The page cannot see this (its reloads are answered by the service worker),
    so the server is asked the way a web view revalidates. index.html must
    stay no-cache and keep answering 200 so a new version is never hidden.
    """
    import urllib.error

    def get(path, etag=None):
        request = urllib.request.Request(base.rstrip("/") + path, headers={"If-None-Match": etag} if etag else {})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = response.read()
                return response.status, dict(response.headers), len(body)
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), len(error.read() or b"")

    status, headers, size = get("/chat")
    index = urllib.request.urlopen(base.rstrip("/") + "/chat", timeout=15).read().decode("utf-8", "replace")
    paths = ["/laolao-theme.css", "/laolao-wallpaper.png", "/laolao-deep-think.js"]
    bundle = re.search(r'src="(/assets/index-[^"?]+\.js)', index)
    if bundle:
        paths.append(bundle.group(1))
    result = {"index": {"status": status, "cache_control": headers.get("Cache-Control"), "etag": headers.get("ETag"), "bytes": size},
              "files": {}}
    for path in paths:
        first_status, first_headers, first_size = get(path)
        etag = first_headers.get("ETag")
        second = get(path, etag) if etag else (None, {}, None)
        result["files"][path] = {
            "status": first_status, "bytes": first_size, "etag": etag,
            "cache_control": first_headers.get("Cache-Control"),
            "revalidate_status": second[0], "revalidate_bytes": second[2],
        }
    files = result["files"].values()
    result["proven"] = bool(files) and all(item["revalidate_status"] == 304 and item["revalidate_bytes"] == 0 for item in files) \
        and status == 200 and "no-cache" in str(result["index"]["cache_control"])
    log(f"cache evidence: proven={result['proven']} " + ", ".join(
        f"{path}={item['status']}->{item['revalidate_status']}" for path, item in result["files"].items()))
    return result


def measure_loads(browser, out, label, reloads=2):
    """Cold load, then reloads: what the web view has to fetch again each start.

    Not a pass/fail gate. It shows whether unchanged UI files come back as 304
    or from cache, how many bytes cross the wire and how soon the page is
    usable -- the numbers behind "does a second start feel faster".
    """
    context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN")
    page = context.new_page()
    cdp = context.new_cdp_session(page)
    cdp.send("Network.enable")
    current = {}

    def on_response(event):
        response = event.get("response", {})
        current.setdefault(event["requestId"], {}).update({
            "url": response.get("url", ""), "status": response.get("status"),
            "disk": bool(response.get("fromDiskCache")), "worker": bool(response.get("fromServiceWorker")),
        })

    def on_finished(event):
        current.setdefault(event["requestId"], {})["bytes"] = event.get("encodedDataLength", 0)

    def on_cached(event):
        current.setdefault(event["requestId"], {})["memory"] = True

    worker = {}

    def on_context_response(response):
        # Only reported with PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1:
        # the worker's own trips to the gateway, where 304s actually happen.
        try:
            if response.request.service_worker is None or not response.url.startswith("http://127.0.0.1"):
                return
        except Exception:
            return
        worker[response.status] = worker.get(response.status, 0) + 1

    context.on("response", on_context_response)
    cdp.on("Network.responseReceived", on_response)
    cdp.on("Network.loadingFinished", on_finished)
    cdp.on("Network.requestServedFromCache", on_cached)
    runs = []
    for index in range(reloads + 1):
        current.clear()
        worker.clear()
        started = time.monotonic()
        if index == 0:
            page.goto(CHAT, wait_until="domcontentloaded", timeout=120_000)
        else:
            page.reload(wait_until="domcontentloaded", timeout=120_000)
        page.wait_for_selector(".laolao-mode-switcher", timeout=90_000)
        usable = time.monotonic() - started
        try:
            page.wait_for_load_state("networkidle", timeout=30_000)
        except Exception:
            pass
        settled = time.monotonic() - started
        timing = page.evaluate("""() => { const n = performance.getEntriesByType('navigation')[0] || {};
          return {dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0)}; }""")
        entries = [item for item in current.values() if item.get("url", "").startswith("http://127.0.0.1")]
        run = {
            "run": "cold" if index == 0 else f"reload-{index}",
            "usable_s": round(usable, 2), "settled_s": round(settled, 2), **timing,
            "requests": len(entries),
            "status_200": sum(1 for item in entries if item.get("status") == 200 and not item.get("disk") and not item.get("memory")),
            "status_304": sum(1 for item in entries if item.get("status") == 304),
            "from_cache": sum(1 for item in entries if item.get("disk") or item.get("memory")),
            "via_worker": sum(1 for item in entries if item.get("worker")),
            "wire_bytes": sum(int(item.get("bytes") or 0) for item in entries),
            "worker_statuses": {str(code): count for code, count in sorted(worker.items())},
        }
        runs.append(run)
        log(f"[{label}] load {run['run']}: usable={run['usable_s']}s requests={run['requests']} "
            f"200={run['status_200']} 304={run['status_304']} cache={run['from_cache']} bytes={run['wire_bytes']} "
            f"worker={run['worker_statuses']}")
        page.wait_for_timeout(6000)
        page.screenshot(path=str(out / f"{label}-load-{run['run']}.png"))
    context.close()
    (out / f"{label}-load-metrics.json").write_text(json.dumps(runs, indent=2), encoding="utf-8")
    return runs


def metre_install_receipt(exe, profile):
    import runpy

    helper = Path(__file__).resolve().parents[1] / "metre/roles/package-receipt.py"
    return runpy.run_path(str(helper))["snapshot"](runtime_dir(exe).parent, profile / "home")


def seed_metre_user_data(exe, profile):
    state = profile / "home/.openclaw"
    template = (runtime_dir(exe).parent / "personas/metre/roles/researcher.md").read_text(encoding="utf-8-sig")
    role = template.replace("id: researcher", "id: upgrade-smoke-probe", 1)
    if role == template:
        raise RuntimeError("role specimen missing its official id")
    files = {
        "workspace-metre/roles/user/upgrade-smoke-probe.md": role.encode("utf-8"),
        "workspace/metre-upgrade-user-note.txt": "原用户笔记 · Windows 安装验收\n".encode("utf-8"),
    }
    for name, data in files.items():
        target = state / name
        target.parent.mkdir(parents=True, exist_ok=True)
        # The older app has already initialized this isolated profile.
        # Do not replace an existing file even in a test profile.
        with target.open("xb") as output:
            output.write(data)
    return files


def scenario(label, exe, profile, out, old_exe=None, *, metre_roles=False):
    summary = {"label": label, "exe": str(exe)}
    release = release_info(exe)
    if release:
        summary["release"] = {"build_info": release, **release_package_checks(exe)}
    env = profile_env(profile)
    preserved = {}
    if old_exe:
        process, ready, seconds = launch(old_exe, env, out, f"{label}-old")
        summary["old"] = {"exe": str(old_exe), "gateway_ready": ready, "seconds": seconds}
        if ready:
            summary["old"]["agents"] = agents_list(runtime_dir(old_exe), env, out, f"{label}-old")
        summary["old"]["files"] = collect_files(profile, out, f"{label}-old")
        kill_app(old_exe.parent)
        process.wait(timeout=30) if process.poll() is None else None
        if metre_roles and ready:
            preserved = seed_metre_user_data(exe, profile)
        # Judge the new version on its own log lines only.
        shutil.rmtree(profile / "local/SuperPinkie/logs", ignore_errors=True)
    process, ready, seconds = launch(exe, env, out, label)
    summary.update({"gateway_ready": ready, "seconds": seconds})
    try:
        if ready:
            runtime = runtime_dir(exe)
            summary["agents"] = agents_list(runtime, env, out, label)
            if release:
                summary["activation"] = inspect_activation(
                    [runtime / "bin/node.exe", runtime / "node_modules/openclaw/openclaw.mjs"],
                    env, agent_ids=summary["agents"]["ids"])
                log(f"[{label}] installed activation: {summary['activation']}")
            if metre_roles:
                receipt = metre_install_receipt(exe, profile)
                if old_exe:
                    if not preserved:
                        raise RuntimeError("the older packaged App did not start; upgrade not verified")
                    state = profile / "home/.openclaw"
                    receipt["preservedUserFiles"] = {
                        name: (state / name).read_bytes() == value for name, value in preserved.items()}
                    if not all(receipt["preservedUserFiles"].values()):
                        raise RuntimeError("the packaged update modified fixture user data")
                summary["metre_roles"] = receipt
            summary["ui"] = drive_ui(out, label, release=bool(release))
            summary["service_health"] = service_health()
            summary["native_ui"] = capture_native_ui(exe, env, out, label, process.pid)
    except Exception as error:
        summary["error"] = repr(error)
    finally:
        summary["files"] = collect_files(profile, out, label)
        kill_app(exe.parent)
    modes = summary.get("ui", {}).get("modes", {})
    plugin_methods = summary.get("ui", {}).get("plugin_methods", {})
    summary["passed"] = bool(
        ready
        and (not release or summary["release"]["passed"])
        and (not release or summary.get("activation", {}).get("ok"))
        and (not release or summary.get("ui", {}).get("feedback_prompt", {}).get("ok"))
        and (not metre_roles or bool(summary.get("metre_roles")))
        and not summary.get("agents", {}).get("missing", AGENTS)
        and fresh_mode_identities_ok(label, summary.get("agents", {}))
        and not summary["files"]["log_problems"]
        and summary.get("native_ui", {}).get("passed")
        and len(modes) == len(MODES)
        and all(entry.get("ok") for entry in modes.values())
        and set(plugin_methods) == {"usage", "workbench", "model_setup", "learning_desk", "metre_board"}
        and all(entry.get("ok") for entry in plugin_methods.values())
        and all(summary.get("service_health", {}).get(name) for name in ("party", "roundtable"))
        and not summary.get("ui", {}).get("page_errors")
        and not any(item.get("type") == "error" for item in summary.get("ui", {}).get("console_errors", []))
    )
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True, help="onedir folder (or its parent) holding 超級碧琪.exe")
    parser.add_argument("--old-app", help="older onedir used to seed the upgrade profile")
    parser.add_argument("--out", required=True)
    parser.add_argument("--work", default=None)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--upstream-probe", action="store_true",
                        help="after the fresh scenario, check how failed model turns are retried")
    parser.add_argument("--metre-sidebar", action="store_true",
                        help="also dispatch a local fixture task and open its sidebar row in packaged WebView2")
    parser.add_argument("--metre-sidebar-only", action="store_true", help="run only the packaged Metre sidebar case")
    parser.add_argument("--metre-roles", action="store_true",
                        help="also verify the private agent, 33 cards, user data and native role dispatch")
    args = parser.parse_args()
    if args.metre_sidebar and not args.upstream_probe:
        parser.error("--metre-sidebar requires --upstream-probe")
    if args.metre_roles and (not args.upstream_probe or not args.old_app or args.metre_sidebar_only):
        parser.error("--metre-roles requires --upstream-probe and --old-app")

    subprocess.run([sys.executable, str(Path(__file__).with_name('desktop_shot.py')), '--prepare'], check=True)

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    work = Path(args.work or (out.parent / "smoke-profiles")).resolve()
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    exe = find_exe(args.app)
    summaries = {
        "host": {
            "preferred_encoding": locale.getpreferredencoding(False),
            "python": sys.version,
        }
    }
    if http_ready():
        raise SystemExit("port 18789 is already in use before the smoke test")
    if release_info(exe):
        # Dispatching from Metre needs the developer password in the user
        # build; its lock is checked in the scenarios instead.
        if args.metre_sidebar_only:
            log("release build: Metre is locked, nothing to probe in the Metre sidebar")
            return 0
        if args.metre_sidebar or args.metre_roles:
            log("release build: skipping the Metre sidebar / role dispatch probes (Metre is locked)")
        args.metre_sidebar = args.metre_roles = False
    if args.metre_sidebar_only:
        import upstream_probe
        try:
            result = upstream_probe.run_metre_sidebar_only(exe, work / "fresh", out, launch, kill_app, profile_env)
        except Exception as error:
            result = {"passed": False, "error": str(error)}
        (out / "summary.json").write_text(json.dumps({"metre_sidebar": result}, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"[probe] metre-sidebar: {result}")
        return 0 if result["passed"] else 1
    summaries["fresh"] = scenario("fresh", exe, work / "fresh", out, metre_roles=args.metre_roles)
    if args.upstream_probe:
        import upstream_probe

        try:
            summaries["upstream_probe"] = upstream_probe.run(
                exe, work / "fresh", out, launch, kill_app, profile_env, metre_sidebar=args.metre_sidebar,
                metre_roles=args.metre_roles)
        except Exception as error:
            summaries["upstream_probe"] = {"passed": False, "error": repr(error), "cases": {}}
            kill_app(exe.parent)
        if args.metre_sidebar:
            log(f"[probe] metre-sidebar: {summaries['upstream_probe'].get('metre_sidebar', {})}")
        for name, result in summaries["upstream_probe"].get("cases", {}).items():
            log(f"[probe] {name}: requests={result.get('requests')} final={result.get('final')} problems={result['problems']}")
    if args.old_app:
        summaries["upgrade"] = scenario("upgrade", exe, work / "upgrade", out, old_exe=find_exe(args.old_app),
                                        metre_roles=args.metre_roles)
    (out / "summary.json").write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding="utf-8")
    passed = all(value.get("passed") for key, value in summaries.items() if key != "host")
    log(f"overall passed={passed}")
    if args.strict and not passed:
        sys.exit(1)


if __name__ == "__main__":
    sys.exit(main())
