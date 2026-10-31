#!/usr/bin/env python3
"""C.le. first run — give the new app its own copy of the old app's data, as 碧琪.

Run by the C.le. launcher before it starts its gateway, once: when DST already has an
openclaw.json nothing happens. Nothing in SRC (the 超級碧琪 state, ~/.openclaw) is ever written.

    cle-firstrun.py --src ~/.openclaw --dst ~/.openclaw-cle-studio --bundle <Resources/SuperPinkie>
                    --node <node> --openclaw <openclaw.mjs> --profile cle-studio --port 18809

What it does, in order (into DST.partial, renamed to DST only when everything succeeded):
 1. clone-copies (APFS clonefile, instant, no extra space) the data worth keeping: config, keys,
    sessions, session state, attachments, logbook, skills; caches, logs, backups, the browser
    profile, npm caches and the old app's own plugins are left behind;
 2. clones every agent workspace into DST/workspaces/<name> and points the config at it;
 3. the character is 碧琪, not 碧琪: the identity files of the four rooms come from the C.le.
    templates (the user's own 「🚀 桌面自动化执行指令」 section of AGENTS.md is carried over
    verbatim), and in the copied workspaces' markdown (memory, notes, skills) the old name
    becomes 碧琪 (the product name 碧琪 App becomes C.le.); the unrestricted room keeps its own
    files, only the name in them is changed; chat transcripts are history and stay as they were;
 4. channels (WeChat, Telegram, …) are removed so the two apps never answer for the same account;
 5. `openclaw doctor --fix --non-interactive` migrates the config and state to this runtime;
 6. the C.le. overlay (installer/cle/overlay.json) is applied: rooms' identities, plugins, port,
    no auto-update.
"""
import argparse, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

KEEP = ['openclaw.json', 'credentials', 'identity', 'devices', 'agents', 'state', 'media', 'logbook',
        'skills', 'skill-workshop', 'customizations', 'pinkie-deep-think', 'pinkie-rich', 'wiki',
        'canvas', 'exec-approvals.json', 'exec-approvals.json.migrated', 'node.json', 'memory']
SKIP_IN_AGENTS = {'logs', 'cache', 'tmp'}
ROOMS = {'workspace', 'workspace-project', 'workspace-thinking', 'workspace-learning'}
IDENTITY_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'AESTHETICS.md', 'HEARTBEAT.md', 'METHODS.md']
TCC = '## 🚀 桌面自动化执行指令'


def log(*a):
    print('[cle-firstrun]', *a, flush=True)


def clone(src: Path, dst: Path):
    """APFS clone (cp -c); falls back to a normal copy on other file systems."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(['/bin/cp', '-cRp', str(src), str(dst)], capture_output=True)
    if r.returncode != 0:
        if src.is_dir():
            shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)


def rename_in_markdown(root: Path, unrestricted: bool):
    n = 0
    for p in root.rglob('*.md'):
        try:
            t = p.read_text(encoding='utf-8')
        except Exception:
            continue
        if '碧琪' not in t:
            continue
        u = t.replace('碧琪 App', 'C.le.').replace('碧琪App', 'C.le.').replace('超級碧琪', 'C.le.').replace('超级碧琪', 'C.le.')
        u = u.replace('碧琪', '碧琪')
        if u != t:
            p.write_text(u, encoding='utf-8'); n += 1
    return n


def install_identity(ws: Path, template: Path, live_ws: Path):
    for name in IDENTITY_FILES:
        src = template / name
        if src.exists():
            shutil.copy2(src, ws / name)
    # the user's own section of AGENTS.md, byte for byte from their current file
    live_agents = live_ws / 'AGENTS.md'
    if live_agents.exists() and (ws / 'AGENTS.md').exists():
        live = live_agents.read_text(encoding='utf-8')
        mine = (ws / 'AGENTS.md').read_text(encoding='utf-8')
        if TCC in live:
            head = mine.split(TCC)[0] if TCC in mine else mine.rstrip('\n') + '\n\n'
            (ws / 'AGENTS.md').write_text(head + live[live.index(TCC):], encoding='utf-8')
    for sub in ('persona', 'avatars'):
        if (template / sub).is_dir():
            target = ws / sub
            target.mkdir(exist_ok=True)
            for f in (template / sub).iterdir():
                shutil.copy2(f, target / f.name)


def deep_merge(base, over):
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            deep_merge(base[k], v)
        else:
            base[k] = v
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=str(Path.home() / '.openclaw'))
    ap.add_argument('--dst', default=str(Path.home() / '.openclaw-cle-studio'))
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--node', required=True)
    ap.add_argument('--openclaw', required=True)
    ap.add_argument('--profile', default='cle-studio')
    ap.add_argument('--port', default='18809')
    a = ap.parse_args()
    src, dst, bundle = Path(a.src).expanduser(), Path(a.dst).expanduser(), Path(a.bundle)
    tmpl = bundle / 'installer' / 'cle'
    ext = bundle / 'extensions'
    if (dst / 'openclaw.json').exists():
        log('already set up:', dst); return 0
    part = dst.with_name(dst.name + '.partial')
    if part.exists():
        shutil.rmtree(part)
    part.mkdir(parents=True)
    t0 = time.time()

    have_src = (src / 'openclaw.json').exists()
    cfg = {}
    if have_src:
        for name in KEEP:
            if (src / name).exists():
                if name == 'agents':
                    (part / 'agents').mkdir(exist_ok=True)
                    for agent in (src / 'agents').iterdir():
                        if agent.is_dir():
                            (part / 'agents' / agent.name).mkdir(exist_ok=True)
                            for item in agent.iterdir():
                                if item.name not in SKIP_IN_AGENTS:
                                    clone(item, part / 'agents' / agent.name / item.name)
                else:
                    clone(src / name, part / name)
        cfg = json.loads((part / 'openclaw.json').read_text(encoding='utf-8'))
        log('copied data in', round(time.time() - t0, 1), 's')

    # workspaces: every workspace the old config knows, cloned beside the new state
    text = json.dumps(cfg, ensure_ascii=False)
    workspaces = set(re.findall(r'"workspace"\s*:\s*"([^"]+)"', text))
    for ws in sorted(src.glob('workspace*')):
        if ws.is_dir():
            workspaces.add(str(ws))
    mapping = {}
    for w in sorted(workspaces):
        wp = Path(os.path.expanduser(w))
        if not wp.is_dir():
            continue
        target = part / 'workspaces' / wp.name
        if not target.exists():
            clone(wp, target)
        mapping[str(wp)] = str(dst / 'workspaces' / wp.name)
        mapping[w] = str(dst / 'workspaces' / wp.name)      # the config may say ~/.openclaw/…
    for name in sorted(ROOMS):
        if not (part / 'workspaces' / name).exists():
            (part / 'workspaces' / name).mkdir(parents=True)
            mapping.setdefault(str(src / name), str(dst / 'workspaces' / name))

    # 碧琪, not 碧琪
    renamed = 0
    for ws in (part / 'workspaces').iterdir():
        if not ws.is_dir():
            continue
        live_ws = Path(next((k for k, v in mapping.items() if v.endswith('/' + ws.name)), str(src / ws.name)))
        if ws.name in ROOMS and (tmpl / 'personas' / ws.name).is_dir():
            install_identity(ws, tmpl / 'personas' / ws.name, live_ws)
        renamed += rename_in_markdown(ws, unrestricted=ws.name.endswith('unrestricted'))
    log('identity installed; old name replaced in', renamed, 'files')

    # paths: workspaces first (longest), then the state root itself
    text = json.dumps(cfg, ensure_ascii=False)
    for old in sorted(mapping, key=len, reverse=True):
        text = text.replace(json.dumps(old, ensure_ascii=False)[1:-1], json.dumps(mapping[old], ensure_ascii=False)[1:-1])
    for form in (str(src), '~/' + str(src.relative_to(Path.home())) if str(src).startswith(str(Path.home())) else str(src)):
        text = text.replace(form + '/agents', str(dst) + '/agents').replace(form + '/media', str(dst) + '/media')
    cfg = json.loads(text) if text else {}
    cfg['channels'] = {}
    cfg['bindings'] = []
    cfg.setdefault('plugins', {})['load'] = {'paths': []}
    (part / 'openclaw.json').write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')

    # small state files that name the old root by absolute path (outgoing image records, …)
    for p in list((part / 'media').rglob('*.json')) if (part / 'media').exists() else []:
        try:
            t = p.read_text(encoding='utf-8')
        except Exception:
            continue
        if str(src) + '/' in t:
            p.write_text(t.replace(str(src) + '/', str(dst) + '/'), encoding='utf-8')

    # move into place, then migrate with the bundled runtime
    os.rename(part, dst)
    env = dict(os.environ, OPENCLAW_PROFILE=a.profile, OPENCLAW_NO_AUTO_UPDATE='1')
    r = subprocess.run([a.node, a.openclaw, '--profile', a.profile, 'doctor', '--fix', '--non-interactive'],
                       env=env, capture_output=True, text=True, timeout=900)
    log('doctor exit', r.returncode)
    (dst / 'cle-firstrun-doctor.log').write_text((r.stdout or '') + '\n' + (r.stderr or ''), encoding='utf-8')

    # the C.le. overlay
    cfg = json.loads((dst / 'openclaw.json').read_text(encoding='utf-8'))
    ov = (tmpl / 'overlay.json').read_text(encoding='utf-8')
    ov = ov.replace('{{EXT}}', str(ext)).replace('{{SRC}}', str(src)).replace('"{{PORT}}"', str(int(a.port)))
    ov = json.loads(ov)
    entries = (cfg.get('agents') or {}).get('entries') or {}
    for agent_id, extra in ov['agents']['entries'].items():
        if agent_id in entries:
            for k, v in extra.items():
                entries[agent_id][k] = v
    if 'ownership' in ov['agents']:
        cfg.setdefault('agents', {})['ownership'] = ov['agents']['ownership']
    for k in ('plugins', 'update', 'nodeHost', 'ui'):
        if k in ov:
            cfg[k] = ov[k] if k == 'plugins' else deep_merge(cfg.get(k) or {}, ov[k])
    cfg['gateway'] = deep_merge(cfg.get('gateway') or {}, ov['gateway'])
    # Absolute: C.le.'s gateway must never land on 超級碧琪's port, whatever the
    # overlay or a copied config says. The other app is the sole owner of 18789.
    if not a.port or str(cfg['gateway'].get('port')) in ('', '18789', 'None'):
        cfg['gateway']['port'] = int(a.port or 18809)
    if str(cfg['gateway'].get('port')) == '18789':
        cfg['gateway']['port'] = 18809
    cfg['gateway']['port'] = int(cfg['gateway']['port'])
    cfg['channels'] = {}
    cfg['bindings'] = []
    (dst / 'openclaw.json').write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')
    (dst / '.cle-firstrun').write_text(time.strftime('%Y-%m-%d %H:%M:%S') + f' from {src}\n', encoding='utf-8')
    log('done in', round(time.time() - t0, 1), 's ->', dst)
    return 0


if __name__ == '__main__':
    sys.exit(main())
