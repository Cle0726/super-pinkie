#!/usr/bin/env python3
"""Install the background-window pointer fix (BrowserAgentActivation) into the
running 超級碧琪 App without restarting it.

Clone the App, put the rebuilt Launcher and its source into the clone, sign
the clone, then atomically replace only the files that differ. Stops before
writing if the installed Launcher is no longer the one this fix was built on
(its __text section must still match the verified production build), or if
any target file changed after the snapshot.
"""
import datetime, hashlib, os, shutil, stat, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = Path('/Applications/超級碧琪.app')
LAUNCHER = Path('Contents/MacOS/Launcher')
SOURCE = Path('Contents/Resources/SuperPinkie/desktop/macos/Sources/BrowserControl.swift')
BUILT = HERE / 'build/production-native/Launcher'
VERIFIED_TEXT = 'a2ba993ad9ac4a74'  # installed Launcher == round-7 production sources
STAGE_ROOT = Path(sys.argv[1])
DRY = '--dry-run' in sys.argv
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def text_hash(binary):
    dump = subprocess.run(['otool', '-s', '__TEXT', '__text', str(binary)], capture_output=True, text=True, check=True).stdout
    return hashlib.sha1('\n'.join(dump.splitlines()[2:]).encode() + b'\n').hexdigest()[:16]


def main():
    if text_hash(APP / LAUNCHER) != VERIFIED_TEXT:
        raise SystemExit('Installed Launcher is not the verified build any more (another update?); rebuild the fix on it first.')
    if (APP / SOURCE).read_text() != (HERE / 'base/BrowserControl.swift').read_text():
        raise SystemExit('Installed BrowserControl.swift changed since the fix was prepared; stopped.')
    shutil.rmtree(STAGE_ROOT, ignore_errors=True)
    STAGE_ROOT.mkdir(parents=True)
    stage, snapshot = STAGE_ROOT / APP.name, STAGE_ROOT / 'snapshot.app'
    subprocess.run(['cp', '-cR', str(APP), str(stage)], check=True)
    subprocess.run(['cp', '-cR', str(APP), str(snapshot)], check=True)
    shutil.copy2(BUILT, stage / LAUNCHER)
    shutil.copy2(HERE / 'src/BrowserControl.swift', stage / SOURCE)
    subprocess.run(['codesign', '--force', '--options', 'runtime', '--sign', '-', '--requirements',
                    '=designated => identifier "com.cle0726.super-pinkie"', str(stage)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(stage)], check=True)
    out = subprocess.run(['diff', '-rq', '--no-dereference', str(snapshot), str(stage)], capture_output=True, text=True).stdout
    changes = []
    for line in out.splitlines():
        if not line.startswith('Files '):
            raise SystemExit('Unexpected difference: ' + line)
        changes.append(Path(line[6:].split(' and ')[0]).relative_to(snapshot))
    allowed = {LAUNCHER, SOURCE, Path('Contents/_CodeSignature/CodeResources')}
    if set(changes) - allowed:
        raise SystemExit(f'Unexpected files would change: {set(changes) - allowed}')
    print('files to replace:', *map(str, changes), sep='\n  ')
    if DRY:
        return
    backup = Path.home() / 'Library/Application Support/SuperPinkie/backups' / ('claude-native-pointer-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True, mode=0o700)
    for rel in changes:
        (backup / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snapshot / rel, backup / rel)
    written = []
    try:
        for rel in changes:
            target = APP / rel
            if sha(target) != sha(snapshot / rel):
                raise SystemExit(f'{rel} changed in the installed App during the update; stopped before overwriting it.')
            temp = target.with_name('.' + target.name + '.claude-update')
            shutil.copy2(stage / rel, temp)
            os.chmod(temp, stat.S_IMODE((stage / rel).stat().st_mode))
            os.replace(temp, target)  # the running process keeps its old inode
            written.append(rel)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(APP)], check=True)
    except BaseException:
        for rel in reversed(written):
            temp = (APP / rel).with_name('.' + rel.name + '.claude-rollback')
            shutil.copy2(backup / rel, temp)
            os.replace(temp, APP / rel)
        raise
    print('installed', [str(p) for p in written], 'backup', backup, sep='\n')
    shutil.rmtree(STAGE_ROOT, ignore_errors=True)


main()
