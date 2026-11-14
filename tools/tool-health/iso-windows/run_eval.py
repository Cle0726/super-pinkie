"""在 Windows 隔离网关上批量跑实测题（ACCEPTANCE.md「实测题目」），一批跑完一次汇报。

  python -I -X utf8 tools/tool-health/iso-windows/run_eval.py --label before --repeat 2 --jobs 8 \
      [--models mm/workbuddy/deepseek-v4.1-flash,mm/grok-4.7,mm/gemini-3.8-flash-tiered] [--only 1,2,9]

- 每道题每个模型每一遍都是一个新会话（session key 带批次名），互不串；
- 结果写到 <ROOT>/evals/<label>/results.json：题号、模型、第几遍、会话 key、耗时、回复前 600 字、
  停止原因；体检数字用 session-stats.py --state <ROOT>/home/.openclaw --since <批次开始时间> 去量；
- 题目里的 {TEMP}、{FIX} 换成本机路径；夹具由 fixtures.py 准备。
"""
import argparse, concurrent.futures as cf, json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REAL_HOME = Path(os.environ.get('USERPROFILE') or Path.home())
ROOT = Path(os.environ.get('TH_ISO_ROOT') or REAL_HOME / '碧琪实测' / 'iso-th')
DEFAULT_MODELS = 'mm/workbuddy/deepseek-v4.1-flash,mm/grok-4.7,mm/gemini-3.8-flash-tiered'


def gateway_env():
    out = subprocess.run([sys.executable, '-I', '-X', 'utf8', str(HERE / 'gateway.py'), 'env'],
                         capture_output=True, text=True, encoding='utf-8')
    sys.path.insert(0, str(HERE))
    env = dict(os.environ)
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    for line in out.stdout.splitlines():
        key, value = line[len('$env:'):].split(' = ', 1)
        env[key] = json.loads(value)
    config = json.loads(Path(manifest['configPath']).read_text(encoding='utf-8'))
    env['OPENCLAW_GATEWAY_TOKEN'] = config['gateway']['auth']['token']
    env.update(USERPROFILE=manifest['home'], HOME=manifest['home'], PYTHONUTF8='1')
    return env, manifest


def subst(text):
    return (text.replace('{TEMP}', str(Path(os.environ.get('LOCALAPPDATA', REAL_HOME / 'AppData/Local')) / 'Temp'))
                .replace('{FIX}', str(ROOT / 'fixtures')))


def run_one(env, manifest, label, q, model, rep):
    key = f"agent:{q.get('agent', 'main')}:th-{label}-q{q['id']}-{model.split('/')[-1]}-r{rep}"
    started = time.time()
    replies = []
    for message in q['messages']:
        cmd = [manifest['node'], manifest['runtime'], 'agent', '--agent', q.get('agent', 'main'), '--session-key', key,
               '--model', model, '--message', subst(message), '--json', '--timeout', str(q.get('timeout', 420))]
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace',
                           cwd=str(Path(manifest['runtime']).parent), timeout=q.get('timeout', 420) + 60)
        text, stop = '', None
        try:
            node = find_meta(json.loads(r.stdout[r.stdout.index('{'):])) or {}
            text = node.get('finalAssistantVisibleText') or ''
            stop = (node.get('completion') or {}).get('stopReason') or node.get('stopReason')
        except Exception:
            text = (r.stdout or r.stderr)[-600:]
        replies.append({'exit': r.returncode, 'stop': stop, 'text': (text or '')[:600]})
    return {'q': q['id'], 'model': model, 'rep': rep, 'sessionKey': key,
            'seconds': round(time.time() - started), 'replies': replies}


def find_meta(obj):
    if isinstance(obj, dict):
        if 'finalAssistantVisibleText' in obj:
            return obj
        for v in obj.values():
            m = find_meta(v)
            if m:
                return m
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True)
    ap.add_argument('--repeat', type=int, default=2)
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--models', default=DEFAULT_MODELS)
    ap.add_argument('--only', default='')
    ap.add_argument('--questions', default=str(HERE / 'questions.json'))
    a = ap.parse_args()
    questions = json.loads(Path(a.questions).read_text(encoding='utf-8'))
    if a.only:
        wanted = set(a.only.split(','))
        questions = [q for q in questions if str(q['id']) in wanted]
    env, manifest = gateway_env()
    out_dir = ROOT / 'evals' / a.label
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    tasks = [(q, m, r) for q in questions for m in a.models.split(',') for r in range(1, a.repeat + 1)]
    results = []
    with cf.ThreadPoolExecutor(a.jobs) as pool:
        futures = [pool.submit(run_one, env, manifest, a.label, q, m, r) for q, m, r in tasks]
        for f in cf.as_completed(futures):
            try:
                results.append(f.result())
            except Exception as error:
                results.append({'error': repr(error)})
    results.sort(key=lambda x: (str(x.get('q')), x.get('model', ''), x.get('rep', 0)))
    (out_dir / 'results.json').write_text(json.dumps({'started': started, 'finished': time.time(), 'results': results},
                                                     ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({'label': a.label, 'runs': len(results), 'since': started, 'out': str(out_dir / 'results.json')},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
