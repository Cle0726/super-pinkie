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

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.release.runtime_inventory import cli_json, inspect_activation


GATEWAY = "http://127.0.0.1:18789"
HTTP = build_opener(ProxyHandler({}))


def gateway_listening(port=18789):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
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


def verify_installed_features(app, config_path, state, env, label):
    runtime = app / 'Contents/Resources/SuperPinkie/runtime'
    command = [runtime / 'bin/node', runtime / 'openclaw/openclaw.mjs']
    report = inspect_activation(command, env)
    if not report['ok']:
        raise RuntimeError(f'{label}: packaged features are missing: {report}')
    # All calls are read-only and target the disposable profile's local gateway.
    gateway = json.loads(config_path.read_text(encoding='utf-8')).get('gateway') or {}
    if gateway.get('mode', 'local') != 'local' or gateway.get('port', 18789) != 18789:
        raise RuntimeError(f'{label}: fixture Gateway is not local')
    checks = {
        'usage': ('pinkie.usage.get', {}),
        'workbench': ('pinkie.fs.status', {'sessionKey': 'agent:project:main'}),
        'learning desk': ('pinkie.learning.desk.metrics', {'sessionKey': 'agent:learning:main'}),
        'model setup': ('pinkie.modelSetup.list', {}),
        'Metre lock': ('pinkie.guard.metreStatus', {}),
    }
    for name, (method, params) in checks.items():
        value = cli_json([*command, 'gateway', 'call', method, '--json', '--timeout', '15000',
                          '--params', json.dumps(params)], env, dict)
        if name == 'Metre lock' and not (value.get('required') and value.get('locked') and value.get('configured')):
            raise RuntimeError(f'{label}: Metre release lock not active')
        if name == 'model setup' and not isinstance(value.get('providers'), list):
            raise RuntimeError(f'{label}: model setup did not return the provider list')
    for name, port in [('party', 18889), ('roundtable', 18891)]:
        with HTTP.open(f'http://127.0.0.1:{port}/api/health', timeout=4) as response:
            if json.load(response).get('service') != f'super-pinkie-{name}':
                raise RuntimeError(f'{label}: unexpected {name} service')
    guard = json.loads((state / 'guard/status.json').read_text(encoding='utf-8'))
    if not guard.get('trusted') or guard.get('limitReached') or guard.get('counterTampered') or guard.get('strikesIn24h') != 0:
        raise RuntimeError(f'{label}: official settings guard is not clean after startup')
    print(f'{label}: all core agents, plugins, model sync, services and live Gateway methods verified', flush=True)


def launch(package, profile, label, *, verify_features=False):
    app = package / "超級碧琪.app"
    executable = app / "Contents/MacOS/Launcher"
    home, state = profile / "home", profile / "state"
    claw = home / ".openclaw"
    for directory in (home, state, claw):
        directory.mkdir(parents=True, exist_ok=True)
    occupied = [port for port in (18789, 18889, 18891) if gateway_listening(port)]
    if occupied:
        raise RuntimeError(f'{label}: the fixture ports were already in use: {occupied}')
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
                    if verify_features:
                        verify_installed_features(app, claw / 'openclaw.json', state, env, label)
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
    parser.add_argument("--old-app", type=Path, help="extracted published ZIP directory for an additional upgrade test")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="pinkie-native-smoke-", dir=os.environ.get("RUNNER_TEMP"),
                                     ignore_cleanup_errors=True) as folder:
        root = Path(folder)
        launch(args.app.resolve(), root / "fresh", "fresh", verify_features=True)
        if not args.old_app:
            return
        profile = root / "upgrade"
        launch(args.old_app.resolve(), profile, "upgrade-old")
        marker = profile / "home/.openclaw/workspace/pinkie-ci-user-note.txt"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_bytes(b"Existing user note in isolated release QA profile.\n")
        launch(args.app.resolve(), profile, "upgrade", verify_features=True)
        if marker.read_bytes() != b"Existing user note in isolated release QA profile.\n":
            raise RuntimeError("existing workspace data changed on upgrade startup")
        print("Mac release ZIP launched successfully with fresh and existing profiles", flush=True)


if __name__ == "__main__":
    main()
