"""Distinguish packaged Mac Gateway CLI authorization/setup failures in CI."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import smoke_launch as smoke


def diagnose(app, config_path, state, env, label):
    cfg = json.loads(config_path.read_text(encoding='utf-8'))
    gateway = cfg.get('gateway') or {}
    auth = gateway.get('auth') or {}
    print('gateway configuration:', {key: gateway.get(key) for key in ('mode', 'bind', 'port')},
          'auth mode:', auth.get('mode'), 'token configured:', bool(auth.get('token')), flush=True)
    if gateway.get('mode') == 'remote':
        raise RuntimeError('not using a local disposable Gateway')
    subprocess.run(['node', str(Path(__file__).with_name('live_webkit_diagnostic.mjs'))],
                   env=env, check=True, timeout=65)
    runtime = app / 'Contents/Resources/SuperPinkie/runtime'
    command = [str(runtime/'bin/node'), str(runtime/'openclaw/openclaw.mjs')]
    for name, params in (('sessions.list', {'limit': 1}), ('pinkie.usage.get', {}), ('pinkie.guard.metreStatus', {})):
        completed = subprocess.run([*command, 'gateway', 'call', name, '--json', '--timeout', '15000',
                                    '--params', json.dumps(params)], env=env, capture_output=True, text=True, timeout=35)
        print(name, 'exit', completed.returncode, flush=True)
        if not completed.returncode:
            continue
        for line in completed.stderr.splitlines()[:16]:
            for secret in (auth.get('token'), auth.get('password')):
                if isinstance(secret, str) and secret:
                    line = line.replace(secret, '<redacted>')
            print(re.sub(r'(?i)(?:bearer|token=|password=)\s*[^\s&]+', '<redacted>', line)[:600], flush=True)
    for service, port in (('party', 18889), ('roundtable', 18891)):
        try:
            with smoke.HTTP.open(f'http://127.0.0.1:{port}/api/health', timeout=3) as response:
                print(service, json.load(response).get('service'), flush=True)
        except OSError as error:
            print(service, type(error).__name__, flush=True)


if sys.platform != 'darwin' or os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('Requires a disposable macOS Actions runner')
with tempfile.TemporaryDirectory(prefix='pinkie-cli-diagnostic-', dir=os.environ['RUNNER_TEMP'], ignore_cleanup_errors=True) as root:
    smoke.verify_installed_features = diagnose
    smoke.launch(Path(sys.argv[1]).resolve(), Path(root), 'diagnostic', verify_features=True)
