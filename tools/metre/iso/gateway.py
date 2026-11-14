"""启动 / 停止 Windows 隔离网关；打印给评测脚本用的环境变量（不打印令牌）。

  python -I -X utf8 tools/tool-health/iso-windows/gateway.py start | stop | status | env

- 端口来自 setup.py 写的 manifest.json（随机，永远不是 18789），只绑 127.0.0.1，令牌鉴权；
- 主目录、LOCALAPPDATA、APPDATA、TEMP 全指到副本里，正式的 ~/.openclaw 和
  %LOCALAPPDATA%\\SuperPinkie 不会被写；
- 不设 PINKIE_APP_BROWSER_ENDPOINT：测试里的碧琪连不到用户 App 的侧栏浏览器。
"""
import json, os, socket, subprocess, sys, time
from pathlib import Path

REAL_HOME = Path(os.environ.get('USERPROFILE') or Path.home())
ROOT = Path(os.environ.get('METRE_ISO_ROOT') or REAL_HOME / '碧琪实测' / 'iso-metre')
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
PIDFILE = ROOT / 'gateway.pid'
port = manifest['gatewayPort']
assert port != 18789


def environment():
    config = json.loads(Path(manifest['configPath']).read_text(encoding='utf-8'))
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('PINKIE_', 'OPENCLAW_', 'CLE_KK_'))}
    home = manifest['home']
    env.update(
        USERPROFILE=home, HOME=home, LOCALAPPDATA=str(ROOT / 'local'), APPDATA=str(ROOT / 'roaming'),
        TEMP=str(ROOT / 'tmp'), TMP=str(ROOT / 'tmp'),
        OPENCLAW_CONFIG_PATH=manifest['configPath'], OPENCLAW_STATE_DIR=manifest['stateDir'],
        OPENCLAW_GATEWAY_PORT=str(port), OPENCLAW_GATEWAY_TOKEN=config['gateway']['auth']['token'],
        OPENCLAW_NO_AUTO_UPDATE='1', OPENCLAW_SERVICE_KIND='gateway',
        PINKIE_STATE_ROOT=manifest['pinkieStateRoot'], PINKIE_ISO_HOME=home,
        PINKIE_NODE_BIN=manifest['node'], PINKIE_OPENCLAW_ENTRY=manifest['runtime'],
        PINKIE_OPENCLAW_RUNTIME=str(Path(manifest['runtime']).parent / 'dist'),
        PINKIE_RUNTIME_CONFIG_SCHEMA='2026.7', PINKIE_GATEWAY_URL=f'http://127.0.0.1:{port}',
        CLE_KK_LOCAL_UNRESTRICTED='1', PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1',
        npm_config_cache=str(ROOT / 'cache/npm'), PIP_CACHE_DIR=str(ROOT / 'cache/pip'), UV_CACHE_DIR=str(ROOT / 'cache/uv'))
    # 只给副本网关的调试开关：TH_PASS_OPENCLAW_CACHE_TRACE=1 → OPENCLAW_CACHE_TRACE=1（环境变量，不是配置键）。
    # B3 用它导出完整系统提示词（会话记录里的 systemPrompt 超过 32768 字会被截掉）。
    env.update({k[len('TH_PASS_'):]: v for k, v in os.environ.items() if k.upper().startswith('TH_PASS_')})
    skills = Path(manifest['runtime']).parents[2] / 'bundled-skills'
    if skills.is_dir():
        env['PINKIE_MANAGED_SKILLS_DIR'] = str(skills)
    entries = [e for e in env.get('NO_PROXY', '').replace(' ', ',').split(',') if e]
    for host in ('localhost', '127.0.0.1', '::1'):
        if host not in entries:
            entries.append(host)
    env['NO_PROXY'] = ','.join(entries)
    return env


def listening():
    with socket.socket() as s:
        s.settimeout(.3)
        return s.connect_ex(('127.0.0.1', port)) == 0


cmd = sys.argv[1] if len(sys.argv) > 1 else 'env'
if __name__ != '__main__':
    cmd = 'import'
if cmd == 'start':
    if listening():
        raise SystemExit(f'端口 {port} 已在监听，先看看是谁')
    log = open(ROOT / 'logs/gateway.log', 'ab', buffering=0)
    proc = subprocess.Popen([manifest['node'], manifest['runtime'], 'gateway', 'run', '--port', str(port),
                             '--bind', 'loopback', '--auth', 'token', '--allow-unconfigured'],
                            env=environment(), stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            cwd=str(Path(manifest['runtime']).parent),
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW)
    PIDFILE.write_text(str(proc.pid))
    for _ in range(int(os.environ.get("METRE_ISO_WAIT", "240"))):
        if proc.poll() is not None:
            raise SystemExit(f'网关退出了（{proc.returncode}），看 {ROOT / "logs/gateway.log"}')
        if listening():
            print(json.dumps({'gateway': 'listening', 'port': port, 'pid': proc.pid}))
            break
        time.sleep(.5)
    else:
        raise SystemExit('120 秒内没起来')
elif cmd == 'stop':
    if PIDFILE.exists():
        subprocess.run(['taskkill', '/PID', PIDFILE.read_text().strip(), '/T', '/F'], capture_output=True)
        PIDFILE.unlink()
    for _ in range(30):
        if not listening():
            break
        time.sleep(.5)
    print(json.dumps({'gateway': 'stopped' if not listening() else 'still listening', 'port': port}))
elif cmd == 'status':
    print(json.dumps({'port': port, 'listening': listening(), 'pid': PIDFILE.read_text().strip() if PIDFILE.exists() else None}))
elif cmd == 'import':
    pass
else:
    # 给 PowerShell 用；令牌照样导出但不显示。
    for k, v in environment().items():
        if k.startswith(('PINKIE_', 'OPENCLAW_')) and k != 'OPENCLAW_GATEWAY_TOKEN':
            print(f'$env:{k} = {json.dumps(v, ensure_ascii=False)}')
