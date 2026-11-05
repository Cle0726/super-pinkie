"""Real in-place portable update on Windows, driven by a release's own replacer.

The upgrade scenario in smoke.py only seeds a profile with an older version and
then starts the new one from a different folder; it never runs the replacer that
users actually hit when they press 「更新并重启」.  This probe does:

  1. copies an unpacked portable release to an isolated folder (optionally a
     Desktop-like path with Chinese characters and spaces) and starts it with an
     isolated profile, exactly like a user's install;
  2. loads WindowsUpdater from the *old* release's source (the replacer that
     runs is always the one of the version being replaced) and calls its real
     launch_replacer() with the new portable zip, then closes the old window the
     way the App does (its gateway keeps running);
  3. waits for that replacer to finish and records what landed: VERSION in the
     install folder, the updater log, leftover backup/stage folders, the
     health/start timing, last-failure.json and which install owns 18789;
  4. watches what the user would see: every second it lists the visible
     top-level windows whose title has 超級碧琪, every 5 s (and whenever a new
     one appears) it saves a screenshot under probe-out.  With
     --require-visible, any stretch longer than 3 s with no such window between
     the click and the new window is a problem: that is the 「窗口全关了，用户
     干等」 users reported.  --expect failure-window makes the rollback fail on
     purpose and requires the failure window with its admin-repair button.

    python tools/windows-smoke/update_probe.py --case NAME --old-app DIR \
        --old-source windows_desktop.py --new-zip new-portable.zip --out DIR \
        [--expect landed|rolled-back|failure-window] [--chinese-path] [--require-visible]

Never touches a real profile, the real App or a user's 18789: it is meant for a
CI runner (or a throwaway Windows VM) where the isolated profile is the only one.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import find_exe, http_ready, kill_app, log, profile_env  # noqa: E402

CALLER = r'''
import importlib.util, json, os, sys
from pathlib import Path
source, exe, payload, digest, version, result = sys.argv[1:]
spec = importlib.util.spec_from_file_location("old_windows_desktop", source)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
exe = Path(exe)
updater = module.WindowsUpdater(exe.parent / "_internal", executable=exe)
assert updater.portable, "release under test is not detected as portable"
updater.prepared = {"payload": Path(payload), "sha256": digest, "version": version}
outcome = updater.launch_replacer()
Path(result).write_text(json.dumps(outcome, ensure_ascii=False), encoding="utf-8")
'''


APP_TITLE = "超級碧琪"
FAILURE_TITLE = "没有装上"
GAP_LIMIT = 3.0


def visible_windows():
    """Titles of visible, not minimised top-level windows that belong to the App."""
    import win32gui

    found = []

    def collect(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd)
        if APP_TITLE in title:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
            if right - left > 40 and bottom - top > 40:
                found.append({"hwnd": hwnd, "title": title})
        return True

    win32gui.EnumWindows(collect, None)
    return found


def visibility_gaps(samples, limit=GAP_LIMIT):
    """Stretches (start, end, seconds) longer than ``limit`` with no App window.

    ``samples`` are {"t": seconds, "titles": [...]} in time order; a stretch
    still open at the last sample ends there.
    """
    gaps, empty_since = [], None
    for sample in samples:
        if sample["titles"]:
            if empty_since is not None and sample["t"] - empty_since > limit:
                gaps.append((round(empty_since, 1), round(sample["t"], 1), round(sample["t"] - empty_since, 1)))
            empty_since = None
        elif empty_since is None:
            empty_since = sample["t"]
    if samples and empty_since is not None and samples[-1]["t"] - empty_since > limit:
        gaps.append((round(empty_since, 1), round(samples[-1]["t"], 1), round(samples[-1]["t"] - empty_since, 1)))
    return gaps


class VisibilityWatch(threading.Thread):
    """Samples the App's visible windows once a second and screenshots them."""

    def __init__(self, shots, interval=1.0, shot_every=5.0, lister=visible_windows, grab=None):
        super().__init__(name="visibility-watch", daemon=True)
        self.shots = Path(shots)
        self.interval, self.shot_every = interval, shot_every
        self.lister, self.grab = lister, grab
        self.samples, self.errors, self.screenshots = [], [], []
        self.halt = threading.Event()
        self.started_at = None
        self.failure_window = None
        self.seen = set()

    def _shot(self, t, why):
        if self.grab is None:
            try:
                from PIL import ImageGrab
                self.grab = lambda: ImageGrab.grab(all_screens=True)
            except Exception as error:  # noqa: BLE001 -- evidence only
                self.errors.append(f"no screenshots: {error}")
                self.grab = False
        if not self.grab:
            return
        try:
            self.shots.mkdir(parents=True, exist_ok=True)
            name = f"{t:06.1f}s-{why}.png"
            self.grab().save(self.shots / name)
            self.screenshots.append(name)
        except Exception as error:  # noqa: BLE001
            self.errors.append(f"screenshot at {t:.1f}s failed: {error}")

    def run(self):
        self.started_at = time.monotonic()
        last_shot = -self.shot_every
        while not self.halt.is_set():
            t = time.monotonic() - self.started_at
            try:
                windows = self.lister()
            except Exception as error:  # noqa: BLE001
                self.errors.append(f"window list failed at {t:.1f}s: {error}")
                windows = []
            titles = sorted({w["title"] for w in windows})
            self.samples.append({"t": round(t, 1), "titles": titles})
            new = [title for title in titles if title not in self.seen]
            self.seen.update(titles)
            for window in windows:
                if FAILURE_TITLE in window["title"] and self.failure_window is None:
                    self.failure_window = window
            if new or t - last_shot >= self.shot_every:
                self._shot(t, "new-window" if new else "tick")
                last_shot = t
            self.halt.wait(self.interval)

    def stop(self):
        self.halt.set()
        self.join(timeout=10)

    def report(self):
        return {"samples": self.samples, "gaps": visibility_gaps(self.samples),
                "titles_seen": sorted(self.seen), "screenshots": self.screenshots, "errors": self.errors}


def close_window(hwnd):
    import win32con
    import win32gui

    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)


def zip_version(path):
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.replace("\\", "/").endswith("_internal/VERSION"):
                return archive.read(name).decode("utf-8-sig").strip()
    raise SystemExit(f"no _internal/VERSION in {path}")


def read(path):
    try:
        return Path(path).read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return ""


def gateway_owner():
    script = ("$c = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | "
              "Where-Object { $_.LocalPort -eq 18789 } | Select-Object -First 1; "
              "if ($c) { (Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\").ExecutablePath }")
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", required=True)
    parser.add_argument("--old-app", required=True, help="unpacked portable release to update from")
    parser.add_argument("--old-source", required=True, help="that release's app/windows_desktop.py")
    parser.add_argument("--new-zip", required=True, help="portable zip to update to")
    parser.add_argument("--out", required=True)
    parser.add_argument("--work", default=None)
    parser.add_argument("--chinese-path", action="store_true", help="install under 「桌面 测试」 like a Desktop copy")
    parser.add_argument("--expect", choices=("landed", "rolled-back", "failure-window"), default="landed")
    parser.add_argument("--require-visible", action="store_true",
                        help="fail on any gap over 3 s with no visible App window (replacers from this build)")
    parser.add_argument("--timeout", type=int, default=1500)
    parser.add_argument("--new-version", help="version to announce when the zip has none (broken package case)")
    args = parser.parse_args()

    out = Path(args.out).resolve(); out.mkdir(parents=True, exist_ok=True)
    work = Path(args.work or (Path.cwd() / "update-probe" / args.case)).resolve()
    shutil.rmtree(work, ignore_errors=True)
    parent = work / ("桌面 测试" if args.chinese_path else "apps")
    parent.mkdir(parents=True)
    target = parent / "超級碧琪"
    shutil.copytree(find_exe(args.old_app).parent, target)
    exe = target / "超級碧琪.exe"
    old_version = read(target / "_internal/VERSION").strip()
    new_zip = Path(args.new_zip).resolve()
    new_version = args.new_version or zip_version(new_zip)
    digest = hashlib.sha256(new_zip.read_bytes()).hexdigest()
    env = profile_env(work / "profile")
    # A user starts the App from Explorer. This runner step is PowerShell 7,
    # whose module path makes Windows PowerShell 5.1 (the replacer) load
    # PowerShell 7 modules: 2.5.27's helper then fails on Get-FileHash.
    inherited_module_path = env.get("PSModulePath", "")
    env["PSModulePath"] = os.pathsep.join([
        str(Path(env["USERPROFILE"]) / "Documents/WindowsPowerShell/Modules"),
        str(Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "WindowsPowerShell/Modules"),
        str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "system32/WindowsPowerShell/v1.0/Modules"),
    ])
    state = Path(env["LOCALAPPDATA"]) / "SuperPinkie"
    if args.expect == "failure-window":
        # Read by launch_replacer(): the replacer then fails its rollback on
        # purpose, which is the only way to reach the failure window on CI.
        env["PINKIE_UPDATE_PROBE_FAIL_ROLLBACK"] = "1"
    summary = {"case": args.case, "from": old_version, "to": new_version, "install": str(target),
               "expect": args.expect, "problems": [], "runner_module_path": inherited_module_path}
    log(f"[{args.case}] {old_version} -> {new_version} in {target}")

    app = subprocess.Popen([str(exe)], env=env, cwd=str(target))
    started = time.monotonic()
    while time.monotonic() - started < 480 and not http_ready() and app.poll() is None:
        time.sleep(2)
    summary["old_ready_seconds"] = round(time.monotonic() - started, 1)
    if not http_ready():
        summary["problems"].append("old version never became ready")
    time.sleep(10)  # let the window finish loading, like a user reading the update dialog

    caller = work / "caller.py"; caller.write_text(CALLER, encoding="utf-8")
    result_file = work / "caller-result.json"
    watch = VisibilityWatch(out / f"update-{args.case}-shots")
    watch.start()
    clicked = time.monotonic()
    caller_run = subprocess.run([sys.executable, "-X", "utf8", str(caller), str(Path(args.old_source).resolve()),
                                 str(exe), str(new_zip), digest, new_version, str(result_file)],
                                env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    outcome = json.loads(read(result_file) or "{}")
    summary["launch"] = outcome
    if caller_run.returncode:
        summary["problems"].append("caller failed: " + caller_run.stderr[-800:])
    # The App closes its own window 0.6 s after the helper reports ready; the
    # gateway it started is intentionally left running.
    subprocess.run(["taskkill", "/PID", str(app.pid), "/F"], capture_output=True)

    log_path = state / "logs/updater.log"
    deadline = time.monotonic() + args.timeout
    finished = None
    failure_window_closed = False
    while time.monotonic() < deadline:
        if args.expect == "failure-window" and watch.failure_window and not failure_window_closed:
            time.sleep(3)  # let the screenshot catch it with its buttons
            watch._shot(time.monotonic() - watch.started_at, "failure-window")
            summary["failure_window_title"] = watch.failure_window["title"]
            close_window(watch.failure_window["hwnd"])
            failure_window_closed = True
        text = read(log_path)
        if "update completed" in text or "update failed" in text:
            if not list((state / "updates").glob("apply-*.ps1")):
                finished = round(time.monotonic() - clicked, 1)
                break
        time.sleep(2)
    summary["helper_seconds"] = finished
    if args.expect != "failure-window":
        # Watch until the new (or restored) App window is on screen.
        until = time.monotonic() + 120
        while time.monotonic() < until and APP_TITLE not in (watch.samples[-1]["titles"] if watch.samples else []):
            time.sleep(1)
        summary["app_window_seconds"] = (round(time.monotonic() - clicked, 1)
                                         if watch.samples and APP_TITLE in watch.samples[-1]["titles"] else None)
    watch.stop()
    visibility = watch.report()
    summary["visibility"] = {key: value for key, value in visibility.items() if key != "samples"}
    (out / f"update-{args.case}-windows.json").write_text(json.dumps(visibility, ensure_ascii=False, indent=2), encoding="utf-8")
    time.sleep(20)  # the restored/new window loads and consumes last-failure.json
    summary["installed_version"] = read(target / "_internal/VERSION").strip()
    summary["updater_log"] = read(log_path).splitlines()[-40:]
    summary["launcher_log"] = [line for line in read(state / "logs/launcher.log").splitlines()
                               if "update" in line or "gateway" in line][-30:]
    summary["left_behind"] = sorted(p.name for p in parent.iterdir() if p.name != "超級碧琪")
    summary["stage_left"] = sorted(p.name for p in (state / "updates").glob(".pinkie-stage-*"))
    summary["failure_note_pending"] = (state / "updates/last-failure.json").exists()
    summary["gateway_owner"] = gateway_owner()

    if finished is None:
        summary["problems"].append("replacer did not finish")
    if args.expect == "landed":
        if summary["installed_version"] != new_version:
            summary["problems"].append(f"install still at {summary['installed_version']}, not {new_version}")
        if not any("update completed" in line for line in summary["updater_log"]):
            summary["problems"].append("updater log has no completion")
        if not summary["gateway_owner"].lower().startswith(str(target).lower()):
            summary["problems"].append(f"18789 owned by {summary['gateway_owner'] or 'nobody'}")
    elif args.expect == "rolled-back":
        if summary["installed_version"] != old_version:
            summary["problems"].append(f"rollback left {summary['installed_version']}")
        if not any("update failed" in line for line in summary["updater_log"]):
            summary["problems"].append("failure not logged")
        if summary["failure_note_pending"]:
            summary["problems"].append("restored version never picked up last-failure.json (user was not told)")
    else:
        if not failure_window_closed:
            summary["problems"].append("the failure window never became visible")
        if not any("admin repair offered" in line for line in summary["updater_log"]):
            summary["problems"].append("the failure window did not offer 用管理员权限修复")
        if summary["installed_version"] != old_version:
            summary["problems"].append(f"install changed to {summary['installed_version']}")
    gaps = summary["visibility"]["gaps"]
    if args.expect == "failure-window":
        # Nothing reopens after the failure window is closed by the probe.
        gaps = [gap for gap in gaps if not (failure_window_closed and gap[1] == visibility["samples"][-1]["t"])]
    if args.require_visible:
        if gaps:
            summary["problems"].append(f"no visible window for {', '.join(f'{g[2]}s at {g[0]}s' for g in gaps)}")
        if visibility["errors"] and not visibility["samples"]:
            summary["problems"].append("could not watch the screen: " + "; ".join(visibility["errors"][:3]))
    elif gaps:
        summary["visibility_warning"] = "old replacer: the user saw nothing for " + ", ".join(f"{g[2]}s" for g in gaps)
    if summary["left_behind"]:
        summary["problems"].append(f"left next to the install: {summary['left_behind']}")
    if summary["stage_left"]:
        summary["problems"].append(f"staging left: {summary['stage_left']}")

    kill_app(target)
    summary["passed"] = not summary["problems"]
    (out / f"update-{args.case}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy2(log_path, out / f"update-{args.case}-updater.log") if log_path.exists() else None
    for name in ("launcher.log", "setup.log"):
        source = state / "logs" / name
        if source.exists():
            shutil.copy2(source, out / f"update-{args.case}-{name}")
    log(f"[{args.case}] passed={summary['passed']} installed={summary['installed_version']} "
        f"helper={finished}s problems={summary['problems']}")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
