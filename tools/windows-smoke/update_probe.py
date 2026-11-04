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
     health/start timing, last-failure.json and which install owns 18789.

    python tools/windows-smoke/update_probe.py --case NAME --old-app DIR \
        --old-source windows_desktop.py --new-zip new-portable.zip --out DIR \
        [--expect landed|rolled-back] [--chinese-path]

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
    parser.add_argument("--expect", choices=("landed", "rolled-back"), default="landed")
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
    state = Path(env["LOCALAPPDATA"]) / "SuperPinkie"
    summary = {"case": args.case, "from": old_version, "to": new_version, "install": str(target),
               "expect": args.expect, "problems": []}
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
    while time.monotonic() < deadline:
        text = read(log_path)
        if "update completed" in text or "update failed" in text:
            if not list((state / "updates").glob("apply-*.ps1")):
                finished = round(time.monotonic() - clicked, 1)
                break
        time.sleep(2)
    summary["helper_seconds"] = finished
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
    else:
        if summary["installed_version"] != old_version:
            summary["problems"].append(f"rollback left {summary['installed_version']}")
        if not any("update failed" in line for line in summary["updater_log"]):
            summary["problems"].append("failure not logged")
        if summary["failure_note_pending"]:
            summary["problems"].append("restored version never picked up last-failure.json (user was not told)")
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
