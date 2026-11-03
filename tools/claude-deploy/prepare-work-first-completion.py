#!/usr/bin/env python3
"""Prepare and sign a review copy. Never install or restart the user's App.

The plugin candidate must come from the current branded live files plus the
owned work-first patch. Unrelated repository UI changes are never copied.
"""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, runpy

APP = Path('/Applications/超級碧琪.app')
RES = Path('Contents/Resources/SuperPinkie')
REPO = Path(__file__).resolve().parents[2]
PLUGIN_FILES = ('index.mjs', 'companion.mjs', 'file-delivery.mjs')

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None

def prepare(out, plugin_candidate):
    out = out.resolve()
    if out.exists() or str(out).startswith(('/Applications/', str(Path.home()/'.openclaw'))):
        raise SystemExit('Use a new staging directory outside the installed App and live state.')
    out.mkdir(parents=True)
    snapshot, stage = out/'snapshot.app', out/APP.name
    subprocess.run(['cp', '-cR', str(APP), str(snapshot)], check=True)
    subprocess.run(['cp', '-cR', str(snapshot), str(stage)], check=True)
    for name in PLUGIN_FILES:
        source = plugin_candidate/'services/mode-architecture'/name
        if not source.is_file(): raise SystemExit('Missing candidate: '+str(source))
        if name == 'index.mjs' and 'workFirstContext' not in source.read_text():
            raise SystemExit('Not a work-first candidate')
        shutil.copy2(source, stage/RES/'services/mode-architecture'/name)
    # Patch the two verified installed modules, preserving every unrelated asset.
    js = '''import fs from 'node:fs';import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [repo,root]=process.argv.slice(1);
const media=await import(pathToFileURL(path.join(repo,'patch/apply-work-first-media-gate.mjs')));
const chat=await import(pathToFileURL(path.join(repo,'patch/apply-work-first-chat.mjs')));
const {refreshPrecompressed}=await import(pathToFileURL(path.join(repo,'patch/lib-precompressed.mjs')));
for(const [rel,pattern,fn] of [['dist',/^chat-pg-.*\\.js$/,media.transformWithStatus],['dist/control-ui/assets',/^chat-page-.*\\.js$/,chat.transformWithStatus]]){
 const dir=path.join(root,rel),files=fs.readdirSync(dir).filter(n=>pattern.test(n));
 if(files.length!==1)throw Error('Ambiguous module');
 const file=path.join(dir,files[0]),result=fn(fs.readFileSync(file,'utf8'));
 if(!result.changed&&result.reason!=='already-patched')throw Error(result.reason);
 fs.writeFileSync(file,result.text);const compressed=refreshPrecompressed(file);
 if(compressed.error||compressed.missing?.length)throw Error(JSON.stringify(compressed));
}
'''
    subprocess.run(['node', '--input-type=module', '-e', js, str(REPO), str(stage/RES/'runtime/openclaw')],check=True)
    # Exercise the actual bundled copy helper twice in a temporary destination.
    # Full install() is deliberately not called: it also creates other modes.
    setup=runpy.run_path(str(stage/RES/'services/mode-architecture/setup.py'),run_name='work_first_copy_probe')
    destination=out/'startup-copy-probe'
    destination.mkdir()
    persistence=[]
    for cycle in (1,2):
        for name in PLUGIN_FILES:
            setup['_copy_if_changed'](stage/RES/'services/mode-architecture'/name,destination/name)
            if sha(destination/name)!=sha(plugin_candidate/'services/mode-architecture'/name):
                raise SystemExit('Startup copy lost fix: '+name)
        persistence.append({'cycle':cycle,'filesMatch':True})
    subprocess.run(['codesign','--force','--options','runtime','--sign','-', '--requirements',
                    '=designated => identifier "com.cle0726.super-pinkie"',str(stage)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(stage)],check=True)
    diff=subprocess.run(['diff','-rq','--no-dereference',str(snapshot),str(stage)],capture_output=True,text=True)
    if diff.returncode not in (0,1):raise SystemExit(diff.stderr)
    changes=[]
    for line in diff.stdout.splitlines():
        if not line.startswith('Files '):raise SystemExit('Unexpected added/removed file: '+line)
        rel=Path(line[6:].split(' and ')[0]).relative_to(snapshot)
        allowed=(str(rel) in ['Contents/MacOS/Launcher','Contents/_CodeSignature/CodeResources']
          or rel.parent==RES/'services/mode-architecture' and rel.name in PLUGIN_FILES
          or str(rel).startswith(str(RES/'runtime/openclaw/dist/control-ui/assets/chat-page-'))
          or str(rel)==str(RES/'runtime/openclaw/dist/control-ui/asset-manifest.json')
          or rel.parent==RES/'runtime/openclaw/dist' and rel.name.startswith('chat-pg-'))
        if not allowed:raise SystemExit('Unowned change: '+str(rel))
        if sha(APP/rel)!=sha(snapshot/rel):raise SystemExit('Installed App changed during preparation: '+str(rel))
        changes.append({'path':str(rel),'installedBefore':sha(snapshot/rel),'candidate':sha(stage/rel)})
    # Stage only the two owned handbook edits on top of the current live text.
    # Personal context and all unrelated handbook content are retained.
    personal=[]
    for name in ('AGENTS.md','playbooks/environment.md'):
        relative=Path('workspace-project')/name
        target=Path.home()/'.openclaw'/relative
        original=target.read_text()
        template=(REPO/'personas/project'/name).read_text()
        if name=='AGENTS.md':
            marker='- **成品要点一下就能用。**'
            old=[line for line in original.splitlines() if line.startswith(marker)]
            new=[line for line in template.splitlines() if line.startswith(marker)]
            if len(old)!=1 or len(new)!=1:raise SystemExit('Cannot identify owned handbook paragraph')
            updated=original.replace(old[0],new[0],1)
        else:
            heading='## 自动整理：别把网页里的定时器当成后台'
            if heading in original:raise SystemExit('Handbook already changed; review before staging')
            begin=template.index(heading)
            end=template.index('要用的工具不在、',begin)
            addition=template[begin:end].strip()
            first,rest=original.split('\n',1)
            updated=first+'\n\n'+addition+'\n'+rest
        dest=out/'handbooks'/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(updated)
        personal.append({'path':str(relative),'installedBefore':sha(target),'candidate':sha(dest)})
    report={'status':'prepared_not_installed','app':str(stage),'signature':'deep strict passed',
            'startupCopyProbe':persistence,'changes':changes,'liveGatewayRestarted':False,
            'personalChanges':personal,
            'personalFilesAfterApproval':['workspace-project/AGENTS.md','workspace-project/playbooks/environment.md']}
    (out/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'appFiles':len(changes),'handbookFiles':len(personal),'signature':report['signature'],
                      'startupCopyProbe':persistence,'manifest':str(out/'manifest.json')},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--plugin-candidate',type=Path,required=True)
    args=parser.parse_args()
    prepare(args.out,args.plugin_candidate)
