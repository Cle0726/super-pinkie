"""碧琪工具整改（tools-health-1113）在 Windows 上用的隔离副本。

照 tools/tool-health/iso-reference-mac/setup.py 的思路，换成 Windows 的路径：
- 自己的「主目录」：USERPROFILE / HOME / LOCALAPPDATA / APPDATA 都指到 ROOT 下面，
  所以 os.homedir()、~/.openclaw、%LOCALAPPDATA%\\SuperPinkie 全落在副本里；
- 运行时：从已装 App 的 _internal\\runtime 复制一份，再按仓库 desktop/windows/mac-runtime
  的 SHA256SUMS 叠上快照（和 build-win.ps1 一样），网关不在 App 安装目录里跑；
- 插件：仓库当前分支的 services/（`sync` 子命令重新复制，改完代码后用）；
- 工作区：正式工作区的手册、记忆、技能等小文件，只读复制；人格换成仓库版本；
- 配置：正式 openclaw.json 只读复制，换成自己的端口（随机，不是 18789）、令牌、路径，
  渠道和绑定清空。模型密钥（models.json、配置里的 apiKey）只复制、不打印。

用法（仓库根目录下）：
  python -I -X utf8 tools/tool-health/iso-windows/setup.py            # 新建（ROOT 已存在就停）
  python -I -X utf8 tools/tool-health/iso-windows/setup.py sync       # 重新复制 services/ 插件
  python -I -X utf8 tools/tool-health/iso-windows/setup.py patch apply-web-fetch-fakeip-v6.mjs ...
                                                                    # 把仓库里的运行时补丁打到副本运行时
ROOT 默认 %USERPROFILE%\\碧琪实测\\iso-th，可用环境变量 TH_ISO_ROOT 改。
"""
from pathlib import Path
import copy, hashlib, json, os, secrets, shutil, socket, subprocess, sys

REAL_HOME = Path(os.environ.get('USERPROFILE') or Path.home())
LIVE = REAL_HOME / '.openclaw'
REPO = Path(__file__).resolve().parents[3]
ROOT = Path(os.environ.get('TH_ISO_ROOT') or REAL_HOME / '碧琪实测' / 'iso-th')
APP_RUNTIME = Path(os.environ.get('LOCALAPPDATA', REAL_HOME / 'AppData/Local')) / 'Programs/SuperPinkie/_internal/runtime'
HOME = ROOT / 'home'
STATE = HOME / '.openclaw'
RUNTIME = ROOT / 'runtime'
OPENCLAW = RUNTIME / 'node_modules' / 'openclaw'
MODES = {'main': 'workspace', 'project': 'workspace-project', 'thinking': 'workspace-thinking', 'learning': 'workspace-learning'}
PERSONA_DIR = {'main': 'chat', 'project': 'project', 'thinking': 'thinking', 'learning': 'learning'}
KEEP_DIRS = ['persona', 'playbooks', 'skills', 'memory', '.openclaw', '.clawhub', 'avatars']
PLUGINS = {'pinkie-mode-architecture': 'mode-architecture', 'pinkie-project-scope': 'project-scope',
           'pinkie-first-person-renderer': 'first-person-renderer'}


def free_port():
    while True:
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        if port != 18789:
            return port


def robocopy(src, dst, *extra):
    # robocopy 退出码 < 8 都算成功。
    r = subprocess.run(['robocopy', str(src), str(dst), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1', *extra],
                       capture_output=True, text=True, errors='replace')
    if r.returncode >= 8:
        raise SystemExit(f'robocopy {src} -> {dst} 失败（{r.returncode}）：{r.stdout[-400:]}')


def sync_plugins():
    for live_name, local in PLUGINS.items():
        dst = STATE / 'extensions' / live_name
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(REPO / 'services' / local, dst, ignore=shutil.ignore_patterns('__pycache__', '*.bak*', 'node_modules'))
    return {name: hashlib.md5((STATE / 'extensions' / name / 'index.mjs').read_bytes()).hexdigest()
            for name in PLUGINS if (STATE / 'extensions' / name / 'index.mjs').exists()}


def sync_mode_tool_deny():
    """照 services/mode-architecture/setup.py：四个模式的 tools.deny 补上 UNUSED/REPLACED_OPENCLAW_TOOLS，
    plugins.allow 补上 NEEDED_BUNDLED_PLUGINS。

    正式 App 由插件安装器改配置；副本配置是建副本时复制的，换了插件代码后要再补一次。只加不删，
    用的是已有的 agents.list[].tools.deny，不加新配置键。常量用 ast 从仓库源码里读，不执行它。
    """
    import ast
    tree = ast.parse((REPO / 'services/mode-architecture/setup.py').read_text(encoding='utf-8'))
    consts = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in ('UNUSED_OPENCLAW_TOOLS', 'REPLACED_OPENCLAW_TOOLS', 'MODE_AGENT_IDS',
                                      'NEEDED_BUNDLED_PLUGINS', 'CHANNEL_TOOLS'):
                try:
                    consts[node.targets[0].id] = ast.literal_eval(node.value)
                except ValueError:
                    pass
    names = tuple(consts.get('UNUSED_OPENCLAW_TOOLS', ())) + tuple(consts.get('REPLACED_OPENCLAW_TOOLS', ()))
    modes = set(consts.get('MODE_AGENT_IDS') or MODES)
    cfg_path = STATE / 'openclaw.json'
    config = json.loads(cfg_path.read_text(encoding='utf-8'))
    # 副本没配任何渠道：渠道工具（B1）在四个模式都不发。配了渠道的副本照正式安装器自己算，这里不猜。
    if not config.get('channels'):
        names += tuple(n for group in consts.get('CHANNEL_TOOLS', {}).values() for n in group)
    added = {}
    for agent in config.get('agents', {}).get('list', []):
        if isinstance(agent, dict) and agent.get('id') in modes:
            deny = agent.setdefault('tools', {}).setdefault('deny', [])
            new = [n for n in names if n not in deny]
            deny.extend(new)
            if new:
                added[agent['id']] = new
    allow = config.get('plugins', {}).get('allow')
    deny = config.get('plugins', {}).get('deny') or []
    if isinstance(allow, list):
        new = [n for n in consts.get('NEEDED_BUNDLED_PLUGINS', ()) if n not in allow and n not in deny]
        allow.extend(new)
        if new:
            added['plugins.allow'] = new
    if added:
        cfg_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    return added


def overlay_snapshot():
    snapshot = REPO / 'desktop/windows/mac-runtime'
    ai_dirs = [d for d in (OPENCLAW / 'node_modules/@openclaw/ai/dist', RUNTIME / 'node_modules/@openclaw/ai/dist') if d.is_dir()]
    count = 0
    for line in (snapshot / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        expect, rel = line.split('  ', 1)
        rel = rel.strip()
        src = snapshot / rel
        if rel.startswith('openclaw/'):
            targets = [OPENCLAW / rel[len('openclaw/'):]]
        elif rel.startswith('ai/'):
            targets = [d / Path(rel).name for d in ai_dirs]
        else:
            continue
        for target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            if hashlib.sha256(target.read_bytes()).hexdigest() != expect.lower():
                raise SystemExit(f'快照校验失败 {rel}')
            count += 1
    return count


def apply_patches(names):
    node = RUNTIME / 'bin' / 'node.exe'
    backups = ROOT / 'backups' / 'runtime-patches'
    out = []
    for name in names:
        env = {**os.environ, 'OPENCLAW_ROOT': str(OPENCLAW), 'PINKIE_PATCH_BACKUP_ROOT': str(backups),
               'PINKIE_PATCH_BACKUP': str(backups), 'PINKIE_STATE_ROOT': str(ROOT / 'local/SuperPinkie')}
        r = subprocess.run([str(node), str(REPO / 'patch' / name)], env=env, capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        out.append({'patch': name, 'status': r.returncode, 'out': (r.stdout or r.stderr).strip()[-300:]})
    print(json.dumps(out, ensure_ascii=False, indent=1))
    if any(o['status'] for o in out):
        raise SystemExit(1)


def build():
    if ROOT.exists():
        raise SystemExit(f'{ROOT} 已存在：先看清楚里面是什么，再决定删不删。')
    for name in ['home/.openclaw', 'local/SuperPinkie', 'roaming', 'tmp', 'cache', 'logs', 'backups']:
        (ROOT / name).mkdir(parents=True, exist_ok=True)

    # 1. 运行时：复制已装 App 的一份，再叠仓库快照
    robocopy(APP_RUNTIME, RUNTIME)
    overlaid = overlay_snapshot()

    # 2. 插件
    plugin_hashes = sync_plugins()

    # 3. 工作区（只读复制小文件；人格用仓库版本）
    for agent, ws in MODES.items():
        src, dst = LIVE / ws, STATE / ws
        dst.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            for item in src.iterdir():
                if item.is_file() and item.suffix == '.md':
                    shutil.copy2(item, dst / item.name)
                elif item.is_dir() and item.name in KEEP_DIRS:
                    shutil.copytree(item, dst / item.name, symlinks=True,
                                    ignore=shutil.ignore_patterns('node_modules', '.venv', '*.mp4', '*.mov', '*.zip'))
        shutil.rmtree(dst / 'memory/context/sessions', ignore_errors=True)
        repo_mode = REPO / 'personas' / PERSONA_DIR[agent]
        for name in ['AGENTS.md', 'SOUL.md', 'IDENTITY.md']:
            if (repo_mode / name).exists():
                shutil.copy2(repo_mode / name, dst / name)
        if (repo_mode / 'playbooks').is_dir():
            shutil.rmtree(dst / 'playbooks', ignore_errors=True)
            shutil.copytree(repo_mode / 'playbooks', dst / 'playbooks')

    # 4. 配置
    config = copy.deepcopy(json.loads((LIVE / 'openclaw.json').read_text(encoding='utf-8')))
    port = free_port()
    token = secrets.token_urlsafe(32)
    agents = []
    for original in config['agents']['list']:
        if original.get('id') not in MODES:
            continue
        agent = copy.deepcopy(original)
        agent.pop('model', None)  # 各模式不单独指定，统一用默认（hy4free）
        agent['workspace'] = str(STATE / MODES[agent['id']])
        agent_dir = STATE / 'agents' / agent['id'] / 'agent'
        agent_dir.mkdir(parents=True, exist_ok=True)
        live_models = LIVE / 'agents' / agent['id'] / 'agent' / 'models.json'
        if live_models.exists():
            shutil.copy2(live_models, agent_dir / 'models.json')
        agent['agentDir'] = str(agent_dir)
        agents.append(agent)
    config['agents']['list'] = agents
    config['agents'].setdefault('defaults', {})['workspace'] = str(STATE / 'workspace')
    config['agents']['defaults']['heartbeat'] = {'every': '0m'}
    # 用户 11-13：实测统一用 hy4free；它自己能看图，image / pdf 工具也走它（imageModel / pdfModel 是运行时已有的键）。
    # 只用 hy4free，不设后备（用户 11-13：hy4std、deepseek 不能用）。
    vision = {'primary': 'mm/workbuddy/hy4free', 'fallbacks': []}
    config['agents']['defaults']['model'] = dict(vision)
    config['agents']['defaults']['imageModel'] = dict(vision)
    config['agents']['defaults']['pdfModel'] = dict(vision)
    gw = config.setdefault('gateway', {})
    gw.update(port=port, bind='loopback', auth={'mode': 'token', 'token': token})
    config['channels'] = {}
    config['bindings'] = []
    entries = copy.deepcopy(config.get('plugins', {}).get('entries', {}))
    keep = list(PLUGINS)
    config['plugins'] = {'allow': keep, 'entries': {n: entries.get(n, {'enabled': True}) for n in keep},
                         'load': {'paths': [str(STATE / 'extensions' / n) for n in keep]}}
    config.setdefault('logging', {})['file'] = str(ROOT / 'logs' / 'openclaw.log')
    cfg_path = STATE / 'openclaw.json'
    cfg_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')

    manifest = {'root': str(ROOT), 'gatewayPort': port, 'configPath': str(cfg_path), 'stateDir': str(STATE),
                'home': str(HOME), 'pinkieStateRoot': str(ROOT / 'local/SuperPinkie'),
                'runtime': str(OPENCLAW / 'openclaw.mjs'), 'node': str(RUNTIME / 'bin' / 'node.exe'),
                'modes': sorted(MODES), 'snapshotFiles': overlaid, 'plugins': plugin_hashes,
                'runtimeSource': str(APP_RUNTIME)}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: manifest[k] for k in ['root', 'gatewayPort', 'modes', 'snapshotFiles']}, ensure_ascii=False))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'build'
    if cmd == 'build':
        build()
    elif cmd == 'sync':
        print(json.dumps({'plugins': sync_plugins(), 'denyAdded': sync_mode_tool_deny()}, ensure_ascii=False))
    elif cmd == 'patch':
        apply_patches(sys.argv[2:])
    else:
        raise SystemExit(__doc__)
