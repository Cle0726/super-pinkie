#!/usr/bin/env python3
"""Install the 「帮我说清楚」 interface in the local 超級碧琪 App.

Same safety pattern as deploy-browser-memory-compaction.py: clone the App, apply changes to the
clone, sign the clone, then atomically replace only the files that differ. If any of those files
changed in the installed App after the snapshot (another session deploying), it stops before
writing. Only the two companion assets and their two cache versions are changed;
plugin files and the App's installer templates are left untouched.
Backups go to Application Support. Gateway restart is NOT done here.
"""
import datetime, hashlib, json, os, shutil, stat, subprocess, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
APP = Path('/Applications/超級碧琪.app')
RES = Path('Contents/Resources/SuperPinkie')
STAGE_ARG = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else None
DRY = '--dry-run' in sys.argv
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def bump(text):
    if text.count('laolao-companion.css?v=companion6') != 1:
        raise SystemExit('Expected exactly one current companion CSS version; nothing written.')
    for old, new in (('laolao-companion.js?v=companion7', 'laolao-companion.js?v=companion8'),):
        if text.count(old) != 1:
            raise SystemExit(f'Expected exactly one {old}; stopped without changing the App.')
        text = text.replace(old, new, 1)
    return text


def apply(root):
    res = root / RES
    ui = REPO / 'ui/injections'
    for name in ('laolao-companion.js', 'laolao-companion.css'):
        for target in (res / 'runtime/openclaw/dist/control-ui' / name, res / 'ui/injections' / name):
            shutil.copy2(ui / name, target)
    p = res / 'runtime/openclaw/dist/control-ui/index.html'
    p.write_text(bump(p.read_text()))


def changed_files(a, b):
    out = subprocess.run(['diff', '-rq', '--no-dereference', str(a), str(b)], capture_output=True, text=True).stdout
    paths = []
    for line in out.splitlines():
        if line.startswith('Files '):
            paths.append(Path(line[6:].split(' and ')[0]).relative_to(a))
        elif line.startswith('Only in '):
            raise SystemExit('Unexpected added/removed file: ' + line)
    return paths


def deploy(stage_root):
    if 'laolao-companion.js?v=companion8' in (APP / RES / 'runtime/openclaw/dist/control-ui/index.html').read_text():
        raise SystemExit('App already has companion8; refusing to bump twice.')
    stage = stage_root / APP.name
    snapshot = stage_root / 'snapshot.app'
    subprocess.run(['cp', '-cR', str(APP), str(snapshot)], check=True)
    subprocess.run(['cp', '-cR', str(snapshot), str(stage)], check=True)  # APFS clone
    apply(stage)
    subprocess.run(['codesign', '--force', '--options', 'runtime', '--sign', '-', '--requirements',
                    '=designated => identifier "com.cle0726.super-pinkie"', str(stage)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(stage)], check=True)
    changes = changed_files(snapshot, stage)
    print('files to replace:', *[str(p) for p in changes], sep='\n  ')
    if DRY:
        return
    for rel in changes:
        if sha(APP / rel) != sha(snapshot / rel):
            raise SystemExit(f'{rel} changed in the installed App during the update; nothing written.')
    backup = Path.home() / 'Library/Application Support/SuperPinkie/backups' / ('claude-work-first-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True, mode=0o700)
    for rel in changes:
        q = backup / rel
        q.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snapshot / rel, q)
    written = []
    try:
        for rel in changes:
            target = APP / rel
            if sha(target) != sha(snapshot / rel):
                raise SystemExit(f'{rel} changed in the installed App during the update; stopped before overwriting it.')
            temp = target.with_name('.' + target.name + '.claude-update')
            shutil.copy2(stage / rel, temp)
            os.chmod(temp, stat.S_IMODE((stage / rel).stat().st_mode))
            os.replace(temp, target)
            written.append(rel)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(APP)], check=True)
    except BaseException:
        for rel in reversed(written):
            if sha(APP / rel) == sha(stage / rel):
                shutil.copy2(backup / rel, APP / rel)
            else:
                print(f'Not rolling back {rel}: it changed after installation.', file=sys.stderr)
        raise
    print(json.dumps({'status': 'installed', 'files': [str(p) for p in written], 'backup': str(backup),
                      'signature': 'deep strict passed', 'restart': 'not done; restart the 18789 gateway separately'},
                     ensure_ascii=False, indent=1))


def main():
    if STAGE_ARG:
        STAGE_ARG.mkdir(parents=True, exist_ok=False)
        root = STAGE_ARG
    else:
        root = Path(tempfile.mkdtemp(prefix='pinkie-deploy-work-first-'))
    try:
        deploy(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


main()
