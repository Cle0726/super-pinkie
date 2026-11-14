"""碧琪「工作优先」实测用的隔离环境：自己的状态目录、端口、令牌，不碰用户的 App、18789 网关和 ~/.openclaw。

只读取线上配置、工作区、插件来做副本；所有写入都落在 ROOT 下面。
参照 repo/tools/product-audit/setup-isolation.py（Codex 的做法），区别：
- 插件用线上当前版本（含 11-01 的修复），手册用 repo 版本；
- 保留真实模型配置（mm 走本机的重试代理），不加计量代理；
- 四个模式（聊天/项目/想法/学习）都带上真实工作区的手册、记忆和技能，不带视频、运行产物等大文件。

用法：python3 -I setup.py            # 新建（ROOT 已存在就停）
密钥只复制、不打印。
"""
from pathlib import Path
import copy, hashlib, json, os, secrets, shutil, socket, subprocess

HOME = Path.home()
LIVE = HOME / '.openclaw'
REPO = Path(__file__).resolve().parents[3] / 'repo'
ROOT = Path(os.environ.get('WF_ISO_ROOT', HOME / '碧琪实测' / 'iso-wf'))
APP_RUNTIME = Path('/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw')
MODES = {'main': 'workspace', 'project': 'workspace-project', 'thinking': 'workspace-thinking', 'learning': 'workspace-learning'}
KEEP_DIRS = ['persona', 'playbooks', 'skills', 'memory', '.openclaw', '.clawhub', 'avatars']

if ROOT.exists():
    raise SystemExit(f'{ROOT} 已存在：先看清楚里面是什么，再决定删不删。')
for name in ['state', 'app-state', 'home/.openclaw', 'projects', 'tmp', 'cache', 'plugins', 'logs', 'runtime']:
    (ROOT / name).mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(ROOT, 0o700)

def clone(src, dst):
    # APFS 克隆：秒级、几乎不占空间；之后两边各改各的。
    subprocess.run(['cp', '-cR', str(src), str(dst)], check=True)

def free_port(avoid=()):
    while True:
        s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
        if port not in avoid and port != 18789:
            return port

# 1. OpenClaw 运行时（克隆一份，网关不从 App 包里跑）
clone(APP_RUNTIME, ROOT / 'runtime' / 'openclaw')

# 2. 插件：线上当前版本
plugin_dirs = {'pinkie-mode-architecture': 'mode-architecture', 'pinkie-project-scope': 'project-scope'}
for live_name, local in plugin_dirs.items():
    shutil.copytree(LIVE / 'extensions' / live_name, ROOT / 'plugins' / local,
                    ignore=shutil.ignore_patterns('__pycache__', 'index.mjs.bak*'))

adapters = []
ENV_AWARE = lambda f: (f.parent / 'openclaw-paths.mjs').exists()
def adapt(relative, old, new, expected):
    file = ROOT / 'plugins' / relative
    text = file.read_text()
    if text.count(old) == 0 and text.count(new) == 0 and ENV_AWARE(file):
        # 11-10 起线上插件自己按 OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH 找路径（openclaw-paths.mjs），不用再改写。
        adapters.append({'file': relative, 'replacements': 0, 'skipped': 'plugin already env-aware'})
        return
    if text.count(old) != expected:
        raise RuntimeError(f'{relative}: 预期 {expected} 处，实际 {text.count(old)} 处')
    out = text.replace(old, new)
    file.write_text(out)
    adapters.append({'file': relative, 'replacements': expected,
                     'before': hashlib.sha256(text.encode()).hexdigest(), 'after': hashlib.sha256(out.encode()).hexdigest()})

# 只为测试改的几处写死的主目录路径（不是产品修复）。
adapt('mode-architecture/index.mjs', "path.join(os.homedir(), '.openclaw', 'openclaw.json')",
      "(process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), '.openclaw', 'openclaw.json'))", 2)
adapt('mode-architecture/index.mjs', 'new LongTermMemoryStore({parentForChild',
      'new LongTermMemoryStore({home: process.env.PINKIE_ISO_HOME, parentForChild', 1)
adapt('mode-architecture/workbench.mjs', "path.join(os.homedir(), '.openclaw/agent-env/bin/python')",
      "path.join(process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw'), 'agent-env/bin/python')", 1)

# 3. 工作区：只带手册、记忆、技能等小文件；手册换成 repo 版本
for agent, ws in MODES.items():
    src, dst = LIVE / ws, ROOT / 'home/.openclaw' / ws
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.is_file() and item.suffix == '.md':
            shutil.copy2(item, dst / item.name)
        elif item.is_dir() and item.name in KEEP_DIRS:
            shutil.copytree(item, dst / item.name, symlinks=True,
                            ignore=shutil.ignore_patterns('node_modules', '.venv', '*.mp4', '*.mov'))
    if agent == 'learning' and (src / 'notes').is_dir():
        (dst / 'notes').mkdir(exist_ok=True)
        for note in (src / 'notes').glob('*.md'):
            shutil.copy2(note, dst / 'notes' / note.name)
    # 会话检查点不带过去
    shutil.rmtree(dst / 'memory/context/sessions', ignore_errors=True)
for mode in ['project', 'thinking']:
    repo_mode = REPO / 'personas' / mode
    for name in ['AGENTS.md', 'SOUL.md', 'IDENTITY.md']:
        shutil.copy2(repo_mode / name, ROOT / 'home/.openclaw' / MODES[mode] / name)
    if (repo_mode / 'playbooks').is_dir():
        shutil.rmtree(ROOT / 'home/.openclaw' / MODES[mode] / 'playbooks', ignore_errors=True)
        shutil.copytree(repo_mode / 'playbooks', ROOT / 'home/.openclaw' / MODES[mode] / 'playbooks')

# 4. Python 专用环境：克隆一份，改掉指回线上的脚本头
env_dst = ROOT / 'state' / 'agent-env'
clone(LIVE / 'agent-env', env_dst)
for script in (env_dst / 'bin').iterdir():
    if script.is_symlink() or not script.is_file():
        continue
    try:
        text = script.read_text()
    except (UnicodeDecodeError, PermissionError):
        continue
    if str(LIVE / 'agent-env') in text:
        script.write_text(text.replace(str(LIVE / 'agent-env'), str(env_dst)))
cfg_file = env_dst / 'pyvenv.cfg'
if cfg_file.exists():
    cfg_file.write_text(cfg_file.read_text().replace(str(LIVE / 'agent-env'), str(env_dst)))
# 工作区 TOOLS.md 里写的专用环境路径指到副本
for ws in MODES.values():
    tools = ROOT / 'home/.openclaw' / ws / 'TOOLS.md'
    if tools.exists():
        tools.write_text(tools.read_text().replace('~/.openclaw/agent-env', str(env_dst)).replace(str(LIVE / 'agent-env'), str(env_dst)))

# 5. 配置
config = json.loads((LIVE / 'openclaw.json').read_text())
config = copy.deepcopy(config)
port = free_port()
token = secrets.token_urlsafe(32)

def relocate(value):
    if isinstance(value, str):
        return (value.replace(str(LIVE / 'agent-env'), str(env_dst))
                     .replace('~/.openclaw/agent-env', str(env_dst)))
    if isinstance(value, list):
        return [relocate(v) for v in value]
    if isinstance(value, dict):
        return {k: relocate(v) for k, v in value.items()}
    return value

agents = []
for original in config['agents']['list']:
    if original.get('id') not in MODES:
        continue
    agent = relocate(copy.deepcopy(original))
    agent['workspace'] = str(ROOT / 'home/.openclaw' / MODES[agent['id']])
    agent_dir = ROOT / 'state/agents' / agent['id'] / 'agent'
    agent_dir.mkdir(parents=True, exist_ok=True)
    live_models = LIVE / 'agents' / agent['id'] / 'agent' / 'models.json'
    if live_models.exists():
        shutil.copy2(live_models, agent_dir / 'models.json')
        os.chmod(agent_dir / 'models.json', 0o600)
    agent['agentDir'] = str(agent_dir)
    agents.append(agent)
assert {a['id'] for a in agents} == set(MODES), [a['id'] for a in agents]
config['agents']['list'] = agents
config['agents'].setdefault('defaults', {})['workspace'] = str(ROOT / 'home/.openclaw/workspace')
config['agents']['defaults']['heartbeat'] = {'every': '0m'}
config['tools'] = relocate(config.get('tools', {}))
gw = config.setdefault('gateway', {})
gw.update(port=port, bind='loopback', auth={'mode': 'token', 'token': token}, tailscale={'mode': 'off'})
gw.setdefault('controlUi', {})['allowInsecureAuth'] = True
config['channels'] = {}
config['bindings'] = []
entries = copy.deepcopy(config.get('plugins', {}).get('entries', {}))
keep = ['pinkie-mode-architecture', 'pinkie-project-scope', 'openai', 'memory-core']
config['plugins'] = {
    'allow': keep,
    'entries': {name: entries.get(name, {'enabled': True}) for name in keep},
    'load': {'paths': [str(ROOT / 'plugins' / local) for local in plugin_dirs.values()]},
}
config.setdefault('logging', {})['file'] = str(ROOT / 'logs' / 'openclaw.log')  # 不和线上网关共用 /tmp/openclaw 的日志
cfg_path = ROOT / 'state' / 'openclaw.json'
cfg_path.write_text(json.dumps(config, ensure_ascii=False, indent=2))
os.chmod(cfg_path, 0o600)
(ROOT / 'state/exec-approvals.json').write_text(json.dumps({'version': 1, 'defaults': {}, 'agents': {}}, indent=2))

# 6. 写入限制：用户主目录整体只读，只放行本目录和缓存；App 包只读
def q(p):
    return '"' + str(p).replace('\\', '\\\\').replace('"', '\\"') + '"'
profile = '\n'.join([
    '(version 1)', '(allow default)',
    f'(deny file-write* (subpath {q(HOME)}))',
    f'(deny file-write* (subpath {q("/Applications/超級碧琪.app")}))',
    f'(allow file-write* (subpath {q(ROOT)}))',
    f'(allow file-write* (subpath {q(HOME / "Library/Caches")}))',
]) + '\n'
(ROOT / 'sandbox.sb').write_text(profile)

manifest = {'root': str(ROOT), 'gatewayPort': port, 'configPath': str(cfg_path), 'stateDir': str(ROOT / 'state'),
            'pinkieStateRoot': str(ROOT / 'app-state'), 'projects': str(ROOT / 'projects'), 'agentEnv': str(env_dst),
            'runtime': str(ROOT / 'runtime/openclaw/openclaw.mjs'), 'modes': sorted(MODES), 'testOnlyAdapters': adapters,
            'plugins': {k: hashlib.md5((ROOT / 'plugins' / v / 'index.mjs').read_bytes()).hexdigest() for k, v in plugin_dirs.items()},
            'writeRestriction': '用户主目录和 App 包只读；只放行本目录与 ~/Library/Caches'}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({k: manifest[k] for k in ['root', 'gatewayPort', 'modes']}, ensure_ascii=False))
