#!/usr/bin/env python3
"""Install a reviewed work-first candidate only with --apply; default is read-only.
Never stop or restart the user's App or gateway.
"""
from pathlib import Path
import argparse, datetime, hashlib, json, os, shutil, stat, subprocess, uuid

APP = Path('/Applications/超級碧琪.app')
RES = Path('Contents/Resources/SuperPinkie')
PERSONAL = {'workspace-project/AGENTS.md','workspace-project/playbooks/environment.md'}

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None

def app_file_allowed(rel):
    return (str(rel) in {'Contents/MacOS/Launcher','Contents/_CodeSignature/CodeResources'}
      or rel.parent==RES/'services/mode-architecture' and rel.name in {'index.mjs','companion.mjs','file-delivery.mjs'}
      or rel.parent==RES/'runtime/openclaw/dist' and rel.name.startswith('chat-pg-') and rel.suffix=='.js'
      or str(rel).startswith(str(RES/'runtime/openclaw/dist/control-ui/assets/chat-page-'))
      or rel==RES/'runtime/openclaw/dist/control-ui/asset-manifest.json')

def atomic_copy(source, target):
    temp=target.with_name('.'+target.name+'.work-first-'+uuid.uuid4().hex)
    try:
        shutil.copy2(source,temp)
        os.chmod(temp,stat.S_IMODE(source.stat().st_mode))
        os.replace(temp,target)
    finally:
        temp.unlink(missing_ok=True)

def install(manifest_file, *, apply=False, app=APP, home=None, backup_root=None, verify=None):
    home=Path(home or Path.home())
    manifest_file=Path(manifest_file).resolve(); root=manifest_file.parent
    data=json.loads(manifest_file.read_text())
    if data.get('status')!='prepared_not_installed':raise RuntimeError('Not a prepared manifest')
    staged=(root/app.name).resolve()
    if Path(data['app']).resolve()!=staged:raise RuntimeError('Candidate path mismatch')
    verify=verify or (lambda p:subprocess.run(['codesign','--verify','--deep','--strict',str(p)],check=True,capture_output=True))
    verify(staged)
    changes=[]
    for change in data['changes']:
        rel=Path(change['path'])
        if rel.is_absolute() or '..' in rel.parts or not app_file_allowed(rel):raise RuntimeError('Unowned App file: '+str(rel))
        changes.append((app/rel,staged/rel,change['installedBefore'],change['candidate'],'app/'+str(rel)))
    for change in data.get('personalChanges',[]):
        rel=Path(change['path'])
        if str(rel) not in PERSONAL:raise RuntimeError('Unowned handbook')
        changes.append((home/'.openclaw'/rel,root/'handbooks'/rel,change['installedBefore'],change['candidate'],'handbooks/'+str(rel)))
    for target,source,before,after,_ in changes:
        if sha(source)!=after:raise RuntimeError('Candidate changed: '+str(source))
        if sha(target)!=before:raise RuntimeError('Target changed since review; nothing installed: '+str(target))
        if not target.parent.is_dir():raise RuntimeError('Missing target directory: '+str(target.parent))
    if not apply:return {'status':'dry_run','files':len(changes),'restart':'not performed'}
    backup=Path(backup_root or home/'Library/Application Support/SuperPinkie/backups')/('work-first-completion-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
    backup.mkdir(parents=True,mode=0o700)
    for target,_,_,_,rel in changes:
        out=backup/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,out)
    written=[]
    try:
        for target,source,before,after,rel in changes:
            if sha(target)!=before:raise RuntimeError('Concurrent update: '+str(target))
            atomic_copy(source,target);written.append((target,after,rel))
        verify(app)
    except BaseException:
        for target,after,rel in reversed(written):
            if sha(target)==after:atomic_copy(backup/rel,target)
        raise
    return {'status':'installed','files':len(written),'backup':str(backup),'signature':'deep strict passed','restart':'not performed; user relaunch activates bundled plugins'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    print(json.dumps(install(args.manifest,apply=args.apply),ensure_ascii=False,indent=2))
