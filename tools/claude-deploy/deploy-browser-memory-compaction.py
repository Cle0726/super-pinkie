#!/usr/bin/env python3
"""Install the browser site-memory tool and the new compaction divider into the
running 超級碧琪 App without restarting it.

Same safety pattern as Codex's round-7 update: clone the App, apply changes to
the clone, sign the clone, then atomically replace only the files that differ.
If any of those files changed in the installed App after the snapshot (another
session deploying), it stops before writing. Backups go to Application Support.
"""
import datetime, hashlib, json, os, shutil, stat, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
APP = Path('/Applications/超級碧琪.app')
RES = Path('Contents/Resources/SuperPinkie')
LIVE = Path.home() / '.openclaw/extensions/pinkie-mode-architecture/app-browser.mjs'
STAGE_ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/pinkie-deploy-stage')
DRY = '--dry-run' in sys.argv
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def branded_browser():
    # The live plugin speaks as 碧琪; the repo source still says Li An.
    return (REPO / 'services/mode-architecture/app-browser.mjs').read_text().replace('Li An', '碧琪')


def apply(root):
    res = root / RES
    ui = REPO / 'ui/injections'
    for name in ('laolao-context-compact.js', 'laolao-compaction-glyph.js'):
        for target in (res / 'runtime/openclaw/dist/control-ui' / name, res / 'ui/injections' / name):
            shutil.copy2(ui / name, target)
    for rel in ('runtime/openclaw/dist/control-ui/index.html', 'installer/macos/apply-theme.sh', 'installer/windows/apply-theme.ps1'):
        p = res / rel
        p.write_text(p.read_text().replace('contextcompact9', 'contextcompact10'))
    (res / 'services/mode-architecture/app-browser.mjs').write_text(branded_browser())
    if (res / 'tests/browser-fast.test.mjs').exists():
        shutil.copy2(REPO / 'tests/browser-memory.test.mjs', res / 'tests/browser-memory.test.mjs')


def changed_files(a, b):
    out = subprocess.run(['diff', '-rq', '--no-dereference', str(a), str(b)], capture_output=True, text=True).stdout
    paths = []
    for line in out.splitlines():
        if line.startswith('Files '):
            left = line[6:].split(' and ')[0]
            paths.append(Path(left).relative_to(a))
        elif line.startswith('Only in '):
            raise SystemExit('Unexpected added/removed file: ' + line)
    return paths


def main():
    if STAGE_ROOT.exists():
        shutil.rmtree(STAGE_ROOT)
    STAGE_ROOT.mkdir(parents=True)
    stage = STAGE_ROOT / APP.name
    subprocess.run(['cp', '-cR', str(APP), str(stage)], check=True)  # APFS clone
    snapshot = STAGE_ROOT / 'snapshot.app'
    subprocess.run(['cp', '-cR', str(APP), str(snapshot)], check=True)
    apply(stage)
    subprocess.run(['codesign', '--force', '--options', 'runtime', '--sign', '-', '--requirements',
                    '=designated => identifier "com.cle0726.super-pinkie"', str(stage)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(stage)], check=True)
    changes = changed_files(snapshot, stage)
    print('files to replace:', *[str(p) for p in changes], sep='\n  ')
    live_before = sha(LIVE)
    if DRY:
        return
    backup = Path.home() / 'Library/Application Support/SuperPinkie/backups' / ('claude-browser-memory-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True, mode=0o700)
    for rel in changes:
        q = backup / rel
        q.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snapshot / rel, q)
    shutil.copy2(LIVE, backup / 'live-app-browser.mjs')
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
        if sha(LIVE) != live_before:
            raise SystemExit('Live plugin changed during the update; stopped.')
        temp = LIVE.with_name('.app-browser.mjs.claude-update')
        temp.write_text(branded_browser())
        os.chmod(temp, stat.S_IMODE(LIVE.stat().st_mode))
        os.replace(temp, LIVE)
    except BaseException:
        for rel in reversed(written):
            shutil.copy2(backup / rel, APP / rel)
        raise
    print(json.dumps({'status': 'installed', 'files': [str(p) for p in written], 'backup': str(backup), 'livePlugin': str(LIVE),
                      'signature': 'deep strict passed', 'restart': 'not done; gateway restart activates app_browser memory'}, ensure_ascii=False, indent=1))
    shutil.rmtree(STAGE_ROOT, ignore_errors=True)


main()
