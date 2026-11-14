"""给用户真实环境拍个指纹，测试前后各拍一次对比，证明隔离测试没碰到它。

只读：openclaw.json、线上插件、四个模式的手册/工具说明/检查点目录、专用 Python 环境的包列表、
项目绑定、App 包里的插件和界面文件、18789 网关进程号、线上会话里有没有测试会话。
密钥不打印：配置文件只记哈希。
用法：python3 -I live-fingerprint.py out.json ；python3 -I live-fingerprint.py --diff a.json b.json
"""
import hashlib, json, os, subprocess, sys
from pathlib import Path

HOME = Path.home(); LIVE = HOME / '.openclaw'
APP = Path('/Applications/超級碧琪.app/Contents/Resources/SuperPinkie')
STATE = HOME / 'Library/Application Support/SuperPinkie'

def md5(p):
    try: return hashlib.md5(Path(p).read_bytes()).hexdigest()
    except Exception: return None

def snap():
    out = {'files': {}, 'lists': {}}
    files = [LIVE / 'openclaw.json', STATE / 'project-scope/bindings.json']
    files += sorted((LIVE / 'extensions/pinkie-mode-architecture').glob('*.mjs'))
    files += sorted((APP / 'services/mode-architecture').glob('*.mjs'))
    files += [APP / 'runtime/openclaw/dist/control-ui/index.html',
              APP / 'runtime/openclaw/dist/control-ui/laolao-companion.js']
    for ws in ['workspace', 'workspace-project', 'workspace-thinking', 'workspace-learning']:
        for name in ['AGENTS.md', 'TOOLS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md']:
            files.append(LIVE / ws / name)
        d = LIVE / ws / 'memory/context/sessions'
        out['lists'][str(d)] = sorted(p.name for p in d.glob('*')) if d.exists() else None
    for f in files:
        out['files'][str(f)] = md5(f)
    site = sorted((LIVE / 'agent-env/lib').glob('python*/site-packages'))
    out['lists']['agent-env packages'] = sorted(p.name for p in site[0].iterdir()) if site else None
    lab = []
    for sj in (LIVE / 'agents').glob('*/sessions/sessions.json'):
        try: lab += [k for k in json.loads(sj.read_text()) if 'pinkie-lab' in k]
        except Exception: pass
    out['lists']['live pinkie-lab sessions'] = sorted(lab)
    pid = subprocess.run(['lsof', '-tiTCP:18789', '-sTCP:LISTEN'], capture_output=True, text=True).stdout.split()
    out['lists']['18789 pid'] = pid
    return out

if sys.argv[1] == '--diff':
    a, b = (json.loads(Path(x).read_text()) for x in sys.argv[2:4])
    changed = [k for k in set(a['files']) | set(b['files']) if a['files'].get(k) != b['files'].get(k)]
    changed += [k for k in set(a['lists']) | set(b['lists']) if a['lists'].get(k) != b['lists'].get(k)]
    print(json.dumps({'unchanged': not changed, 'changed': sorted(changed)}, ensure_ascii=False, indent=1))
else:
    Path(sys.argv[1]).write_text(json.dumps(snap(), ensure_ascii=False, indent=1))
    print('saved', sys.argv[1])
