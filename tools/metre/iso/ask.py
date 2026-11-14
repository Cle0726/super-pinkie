"""在 Metre 隔离网关上发消息（一批并行），打印每条的回复前 400 字。

  python -I -X utf8 tools/metre/iso/ask.py metre:你好 project:你好 ...      # agent:消息
  可选环境变量 METRE_ISO_MODEL（默认 mm/workbuddy/hy4free）、METRE_ISO_LABEL（会话 key 的批次名）
"""
import concurrent.futures as cf, json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gateway as gw  # noqa

MODEL = os.environ.get('METRE_ISO_MODEL', 'mm/workbuddy/hy4free')
LABEL = os.environ.get('METRE_ISO_LABEL', time.strftime('%H%M%S'))


def find_meta(node):
    if isinstance(node, dict):
        if 'finalAssistantVisibleText' in node:
            return node
        for v in node.values():
            hit = find_meta(v)
            if hit:
                return hit
    elif isinstance(node, list):
        for v in node:
            hit = find_meta(v)
            if hit:
                return hit
    return None


def ask(agent, message, idx):
    m = gw.manifest
    key = f'agent:{agent}:iso-{LABEL}-{idx}'
    cmd = [m['node'], m['runtime'], 'agent', '--agent', agent, '--session-key', key, '--model', MODEL,
           '--message', message, '--json', '--timeout', '420']
    started = time.time()
    r = subprocess.run(cmd, env=gw.environment(), capture_output=True, text=True, encoding='utf-8', errors='replace',
                       cwd=str(Path(m['runtime']).parent), timeout=480)
    try:
        node = find_meta(json.loads(r.stdout[r.stdout.index('{'):])) or {}
        text = node.get('finalAssistantVisibleText') or ''
    except Exception:
        text = 'RAW: ' + (r.stdout or r.stderr)[-400:]
    return {'agent': agent, 'key': key, 'exit': r.returncode, 'seconds': round(time.time() - started), 'text': text[:400]}


if __name__ == '__main__':
    jobs = [a.split(':', 1) for a in sys.argv[1:]]
    with cf.ThreadPoolExecutor(8) as pool:
        for res in pool.map(lambda p: ask(p[1][0], p[1][1], p[0]), enumerate(jobs)):
            print(json.dumps(res, ensure_ascii=False))
