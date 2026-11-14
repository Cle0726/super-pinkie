"""启动 / 停止隔离网关；打印给评测脚本用的环境变量（不打印令牌）。

python3 -I gateway.py start | stop | env
- 网关在 sandbox-exec 里跑：用户主目录和 App 包只读，只能写本目录和 ~/Library/Caches。
- 不设 PINKIE_APP_BROWSER_ENDPOINT：测试里的碧琪连不到用户 App 的侧栏浏览器，也就不会在用户 App 里弹网页。
"""
import json, os, signal, socket, subprocess, sys, time
from pathlib import Path

ROOT = Path(os.environ.get('WF_ISO_ROOT', Path.home() / '碧琪实测' / 'iso-wf'))
manifest = json.loads((ROOT / 'manifest.json').read_text())
PIDFILE = ROOT / 'gateway.pid'

def environment():
    config = json.loads(Path(manifest['configPath']).read_text())
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PINKIE_', 'OPENCLAW_'))}
    env.update(
        OPENCLAW_CONFIG_PATH=manifest['configPath'], OPENCLAW_STATE_DIR=manifest['stateDir'],
        OPENCLAW_HOME=str(ROOT / 'home'), OPENCLAW_GATEWAY_PORT=str(manifest['gatewayPort']),
        OPENCLAW_GATEWAY_TOKEN=config['gateway']['auth']['token'],
        PINKIE_STATE_ROOT=manifest['pinkieStateRoot'], PINKIE_ISO_HOME=str(ROOT / 'home'),
        PINKIE_OPENCLAW_ENTRY=manifest['runtime'],
        PINKIE_OPENCLAW_RUNTIME=str(Path(manifest['runtime']).parent / 'dist'),
        TMPDIR=str(ROOT / 'tmp'), UV_CACHE_DIR=str(ROOT / 'cache/uv'), PIP_CACHE_DIR=str(ROOT / 'cache/pip'),
        npm_config_cache=str(ROOT / 'cache/npm'), XDG_CACHE_HOME=str(ROOT / 'cache'),
        PYTHONDONTWRITEBYTECODE='1')
    # 工具箱装进隔离目录（网关沙箱写不了 ~/.pinkie）；WF_TOOLBOX_NO_SYSTEM=1 时假装电脑上什么都没装（计划 D 实测）
    env['PINKIE_TOOLBOX_DIR'] = str(ROOT / 'toolbox')
    if os.environ.get('WF_TOOLBOX_NO_SYSTEM') == '1':
        env['PINKIE_TOOLBOX_NO_SYSTEM'] = '1'
    # 跟 App 一样带上碧琪自带技能（WF_MANAGED_SKILLS=0 时不带，做对照组）
    if os.environ.get('WF_MANAGED_SKILLS', '1') != '0' and (ROOT / 'bundled-skills').is_dir():
        env['PINKIE_MANAGED_SKILLS_DIR'] = str(ROOT / 'bundled-skills')
    return env

def listening(port):
    with socket.socket() as s:
        s.settimeout(.3)
        return s.connect_ex(('127.0.0.1', port)) == 0

cmd = sys.argv[1] if len(sys.argv) > 1 else 'env'
port = manifest['gatewayPort']
if cmd == 'start':
    assert port != 18789
    if listening(port):
        raise SystemExit(f'端口 {port} 已在监听，先看看是谁')
    log = open(ROOT / 'logs/gateway.log', 'ab', buffering=0)
    proc = subprocess.Popen(['/usr/bin/sandbox-exec', '-f', str(ROOT / 'sandbox.sb'), 'node', manifest['runtime'],
                             'gateway', 'run', '--port', str(port), '--bind', 'loopback', '--auth', 'token', '--allow-unconfigured'],
                            env=environment(), stdout=log, stderr=subprocess.STDOUT, start_new_session=True, cwd=str(ROOT))
    PIDFILE.write_text(str(proc.pid))
    for _ in range(120):
        if proc.poll() is not None:
            raise SystemExit(f'网关退出了，看 {ROOT}/logs/gateway.log')
        if listening(port):
            print(json.dumps({'gateway': 'listening', 'port': port, 'pid': proc.pid}))
            break
        time.sleep(.5)
    else:
        raise SystemExit('60 秒内没起来')
elif cmd == 'stop':
    if PIDFILE.exists():
        pid = int(PIDFILE.read_text())
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        PIDFILE.unlink()
    for _ in range(30):
        if not listening(port):
            break
        time.sleep(.5)
    print(json.dumps({'gateway': 'stopped' if not listening(port) else 'still listening', 'port': port}))
else:
    # 给 shell 用：eval "$(python3 -I gateway.py env)"；令牌照样导出但不显示在终端里。
    for k, v in environment().items():
        if k.startswith(('PINKIE_', 'OPENCLAW_', 'TMPDIR', 'UV_', 'PIP_', 'npm_', 'XDG_')):
            print(f"export {k}={json.dumps(v, ensure_ascii=False)}")
