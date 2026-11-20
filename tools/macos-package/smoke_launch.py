"""Launch packaged macOS release apps on an isolated GitHub runner only."""

import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener


GATEWAY = "http://127.0.0.1:18789"
HTTP = build_opener(ProxyHandler({}))


def gateway_listening():
    try:
        with socket.create_connection(("127.0.0.1", 18789), timeout=1):
            return True
    except OSError:
        return False


def gateway_up():
    try:
        with HTTP.open(GATEWAY + "/readyz", timeout=2) as response:
            body = json.load(response)
            return response.status == 200 and isinstance(body, dict) and body.get("ready") is True
    except (OSError, ValueError):
        return False


def process_table():
    result = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,state=,lstart="],
                            env={**os.environ, "LC_ALL": "C"},
                            text=True, check=True, capture_output=True)
    table = {}
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        pid, parent, state, started = line.split(maxsplit=3)
        if not state.startswith("Z"):
            table[int(pid)] = (int(parent), started)
    return table


def owned_processes(owned, table):
    active = {pid for pid, (_, started) in table.items() if owned.get(pid) == started}
    while True:
        children = {pid: started for pid, (parent, started) in table.items()
                    if parent in active and pid not in active}
        if not children:
            return active
        owned.update(children)
        active.update(children)


def stop_owned(process, owned):
    # Swift's Process can create a new process group. Follow the already
    # observed descendants, even after they are reparented on launcher exit.
    for sig, grace in ((signal.SIGTERM, 12), (signal.SIGKILL, 10)):
        sent = set()
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            active = owned_processes(owned, process_table())
            if not active and process.poll() is not None and not gateway_listening():
                return
            for pid in sorted(active - sent):
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
                sent.add(pid)
            time.sleep(.5)
    raise RuntimeError("the isolated launcher or its gateway did not stop")


def launch(package, profile, label):
    app = package / "超級碧琪.app"
    executable = app / "Contents/MacOS/Launcher"
    home, state = profile / "home", profile / "state"
    claw = home / ".openclaw"
    for directory in (home, state, claw):
        directory.mkdir(parents=True, exist_ok=True)
    if gateway_listening():
        raise RuntimeError("loopback gateway was already running before " + label)
    env = {**os.environ, "HOME": str(home), "PINKIE_STATE_ROOT": str(state),
           "OPENCLAW_STATE_DIR": str(claw), "PINKIE_GATEWAY_URL": GATEWAY + "/"}
    with (profile / f"{label}-launcher.log").open("wb") as log:
        process = subprocess.Popen([str(executable)], cwd=app, env=env,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        owned = {}
        started = time.monotonic()
        try:
            initial = process_table().get(process.pid)
            if initial is None:
                raise RuntimeError(f"{label}: native launcher did not remain running")
            owned[process.pid] = initial[1]
            while time.monotonic() - started < 180:
                owned_processes(owned, process_table())
                if process.poll() is not None:
                    raise RuntimeError(f"{label}: native launcher exited ({process.returncode})")
                if gateway_up() and (claw / "openclaw.json").is_file():
                    time.sleep(3)
                    if process.poll() is not None or not gateway_up():
                        raise RuntimeError(f"{label}: native app did not stay up")
                    guard_log = state / "logs/guard.log"
                    if guard_log.is_file() and "alert:" in guard_log.read_text(encoding="utf-8", errors="replace"):
                        raise RuntimeError(f"{label}: settings protection showed a startup alert")
                    print(f"{label}: native launcher and bundled gateway ready ({time.monotonic()-started:.1f}s)", flush=True)
                    return
                time.sleep(2)
            raise RuntimeError(f"{label}: bundled gateway/profile not ready in 180s "
                               f"(port={gateway_listening()}, ready={gateway_up()}, "
                               f"config={(claw / 'openclaw.json').is_file()})")
        finally:
            stop_owned(process, owned)


def main():
    if sys.platform != "darwin" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("This check must run on a disposable macOS GitHub Actions runner")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True, help="extracted candidate ZIP directory")
    parser.add_argument("--old-app", type=Path, required=True, help="extracted published ZIP directory")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="pinkie-native-smoke-", dir=os.environ.get("RUNNER_TEMP"),
                                     ignore_cleanup_errors=True) as folder:
        root = Path(folder)
        launch(args.app.resolve(), root / "fresh", "fresh")
        profile = root / "upgrade"
        launch(args.old_app.resolve(), profile, "upgrade-old")
        marker = profile / "home/.openclaw/workspace/pinkie-ci-user-note.txt"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_bytes(b"Existing user note in isolated release QA profile.\n")
        launch(args.app.resolve(), profile, "upgrade")
        if marker.read_bytes() != b"Existing user note in isolated release QA profile.\n":
            raise RuntimeError("existing workspace data changed on upgrade startup")
        print("Mac release ZIP launched successfully with fresh and existing profiles", flush=True)


if __name__ == "__main__":
    main()
