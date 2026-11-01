"""Windows smoke test for the packaged 超級碧琪 desktop App.

Runs on a GitHub windows-latest runner (or any Windows box).  Each scenario
starts the real packaged exe against an isolated USERPROFILE/LOCALAPPDATA,
waits for the bundled gateway on 18789, checks that all five mode agents are
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
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

GATEWAY = "http://127.0.0.1:18789/"
CHAT = GATEWAY + "chat"
MODES = [
    ("chat", "agent:main:"),
    ("project", "agent:project:"),
    ("thinking", "agent:thinking:"),
    ("learning", "agent:learning:"),
    ("unrestricted", "agent:unrestricted:"),
]
AGENTS = ["main", "project", "thinking", "learning", "unrestricted"]
SECRET = re.compile(r"(key|token|secret|password|authorization)", re.I)


def log(message):
    print(f"[smoke {time.strftime('%H:%M:%S')}] {message}", flush=True)


def find_exe(app_dir):
    app_dir = Path(app_dir)
    for candidate in [app_dir / "超級碧琪.exe", *app_dir.glob("*/超級碧琪.exe")]:
        if candidate.is_file():
            return candidate
    raise SystemExit(f"no 超級碧琪.exe under {app_dir}")


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
    return env


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


def launch(exe, env, out, label, timeout=480):
    log(f"[{label}] launching {exe}")
    process = subprocess.Popen([str(exe)], env=env, cwd=str(exe.parent))
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        if http_ready():
            break
        if process.poll() is not None:
            log(f"[{label}] exe exited early with {process.returncode}")
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
    return label != "fresh" or all(agents.get("identities", {}).get(agent) == "碧琪" for agent in AGENTS)


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
    fonts: getComputedStyle(document.body).fontFamily,
    text: (document.body.innerText || '').slice(0, 600),
    // Gateway errors surface as a banner, e.g. 'Unknown agent id "project"'.
    gatewayError: ((document.body.innerText || '').match(/(GatewayRequestError[^\n]*|Unknown agent id[^\n]*)/) || [''])[0],
  };
}"""


def drive_ui(out, label):
    from playwright.sync_api import sync_playwright

    result = {"modes": {}, "console_errors": [], "page_errors": [], "failed_requests": [], "http_errors": []}
    console = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
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
            # A plugin may fail to register without a visible load error. Ask
            # the real gateway for two read-only methods supplied by it.
            result["plugin_methods"] = page.evaluate("""async () => {
              const checks = [
                ['usage', 'pinkie.usage.get', {}],
                ['workbench', 'pinkie.fs.status', {sessionKey: 'agent:project:main'}],
              ];
              const result = {};
              for (const [name, method, params] of checks) {
                try {
                  if (!window.__laolaoSidebar?.gwRequest) throw new Error('gateway client unavailable');
                  await window.__laolaoSidebar.gwRequest(method, params, 15000);
                  result[name] = {ok: true};
                } catch (error) { result[name] = {ok: false, error: String(error)}; }
              }
              return result;
            }""")
            for index, (mode, prefix) in enumerate(MODES):
                entry = {"ok": False}
                try:
                    page.click(".laolao-mode-switcher", timeout=15_000)
                    page.wait_for_selector(".laolao-mode-menu__option", timeout=10_000)
                    page.locator(".laolao-mode-menu__option").nth(index).click(timeout=10_000)
                    deadline = time.monotonic() + 40
                    state = None
                    while time.monotonic() < deadline:
                        page.wait_for_timeout(500)
                        state = page.evaluate(PAGE_STATE)
                        # The URL may carry the alias "main"; the shell's
                        # resolved key says which agent really answers.
                        session = state["shellSession"] or state["session"]
                        if state["mode"] == mode and not state["transition"] and session.startswith(prefix):
                            entry["ok"] = True
                            break
                    page.wait_for_timeout(1500)
                    entry["state"] = page.evaluate(PAGE_STATE)
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


def scenario(label, exe, profile, out, old_exe=None):
    summary = {"label": label, "exe": str(exe)}
    env = profile_env(profile)
    if old_exe:
        process, ready, seconds = launch(old_exe, env, out, f"{label}-old")
        summary["old"] = {"exe": str(old_exe), "gateway_ready": ready, "seconds": seconds}
        if ready:
            summary["old"]["agents"] = agents_list(runtime_dir(old_exe), env, out, f"{label}-old")
        summary["old"]["files"] = collect_files(profile, out, f"{label}-old")
        kill_app(old_exe.parent)
        process.wait(timeout=30) if process.poll() is None else None
        # Judge the new version on its own log lines only.
        shutil.rmtree(profile / "local/SuperPinkie/logs", ignore_errors=True)
    process, ready, seconds = launch(exe, env, out, label)
    summary.update({"gateway_ready": ready, "seconds": seconds})
    try:
        if ready:
            summary["agents"] = agents_list(runtime_dir(exe), env, out, label)
            summary["ui"] = drive_ui(out, label)
            summary["service_health"] = service_health()
    except Exception as error:
        summary["error"] = repr(error)
    finally:
        summary["files"] = collect_files(profile, out, label)
        kill_app(exe.parent)
    modes = summary.get("ui", {}).get("modes", {})
    plugin_methods = summary.get("ui", {}).get("plugin_methods", {})
    summary["passed"] = bool(
        ready
        and not summary.get("agents", {}).get("missing", AGENTS)
        and fresh_mode_identities_ok(label, summary.get("agents", {}))
        and not summary["files"]["log_problems"]
        and len(modes) == len(MODES)
        and all(entry.get("ok") for entry in modes.values())
        and len(plugin_methods) == 2
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
    args = parser.parse_args()

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
    summaries["fresh"] = scenario("fresh", exe, work / "fresh", out)
    if args.upstream_probe:
        import upstream_probe

        summaries["upstream_probe"] = upstream_probe.run(exe, work / "fresh", out, launch, kill_app, profile_env)
        for name, result in summaries["upstream_probe"].get("cases", {}).items():
            log(f"[probe] {name}: requests={result['requests']} final={result['final']} problems={result['problems']}")
    if args.old_app:
        summaries["upgrade"] = scenario("upgrade", exe, work / "upgrade", out, old_exe=find_exe(args.old_app))
    (out / "summary.json").write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding="utf-8")
    passed = all(value.get("passed") for key, value in summaries.items() if key != "host")
    log(f"overall passed={passed}")
    if args.strict and not passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
