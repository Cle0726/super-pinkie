"""Capture the guard's reasons on a disposable Windows runner, without publishing."""
import json
import os
from pathlib import Path

from smoke import agents_list, find_exe, http_ready, kill_app, launch, profile_env, runtime_dir


if os.environ.get('GITHUB_ACTIONS') != 'true' or http_ready():
    raise SystemExit('Requires an isolated Windows CI runner with no active gateway')
out = Path('legacy-evidence').resolve()
out.mkdir()
profile = Path(os.environ['RUNNER_TEMP']).resolve() / 'pinkie-legacy-guard-only'
profile.mkdir()
env = profile_env(profile)
old = find_exe('legacy-old')
new = find_exe('legacy-current')
_, is_ready, _ = launch(old, env, out, 'old')
try:
    if not is_ready:
        raise RuntimeError('the actual published v2.5.16 ZIP did not start')
    agents_list(runtime_dir(old), env, out, 'old')
finally:
    kill_app(old.parent)
_, is_ready, _ = launch(new, env, out, 'upgrade')
try:
    guard = profile / 'local/SuperPinkie/guard'
    for name in ('status.json', 'guard.log'):
        file = guard / name
        if not file.is_file():
            continue
        raw = file.read_text(encoding='utf-8')
        (out / name).write_text(raw, encoding='utf-8')
        if name == 'guard.log':
            for line in raw.splitlines():
                evt = json.loads(line)
                if evt.get('tool') or evt.get('kind'):
                    print(json.dumps({k: evt.get(k) for k in ('at', 'tool', 'kind', 'restored', 'categories')}, ensure_ascii=False), flush=True)
        else:
            evt = json.loads(raw)
            print(json.dumps({k: evt.get(k) for k in ('strikesIn24h', 'limitReached', 'counterTampered', 'isBundleTransition', 'history')}, ensure_ascii=False), flush=True)
finally:
    kill_app(new.parent)
raise SystemExit(0 if is_ready else 1)
