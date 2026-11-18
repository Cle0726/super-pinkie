"""批 7「另记」：每题 Metre 自己的输入 vs 项目模式做同一题。读隔离副本的会话记录（usage）。

python -I -X utf8 tokens.py <副本根> <metre 轮次> <project 轮次>
"""
import json, re, sys
from pathlib import Path

ROOT = Path(sys.argv[1])
ROUNDS = {'metre': sys.argv[2], 'project': sys.argv[3]}
AGENTS = ROOT / 'home' / '.openclaw' / 'agents'
CASES = [f'S{i}' for i in range(1, 10)]
CHILD = re.compile(r'agent:[a-z]+:pinkie-child:[0-9a-f]{8,}')


def session_file(key):
    agent = key.split(':')[1]
    idx = json.loads((AGENTS / agent / 'sessions' / 'sessions.json').read_text(encoding='utf-8'))
    entry = idx.get(key)
    if not entry:
        return None
    path = AGENTS / agent / 'sessions' / f"{entry['sessionId']}.jsonl"
    return path if path.exists() else None


def usage(key):
    path = session_file(key)
    if not path:
        return None
    calls, recent = [], []
    for line in path.read_text(encoding='utf-8').splitlines():
        try:
            m = json.loads(line).get('message') or {}
        except Exception:
            continue
        if m.get('role') == 'user':
            recent = []
        if m.get('role') != 'assistant' or not isinstance(m.get('usage'), dict):
            continue
        u = m['usage']
        inp, out = int(u.get('input') or 0) + int(u.get('cacheRead') or 0), int(u.get('output') or 0)
        if not inp:
            continue
        # 有的「stop」那条记的是这一轮几次调用的合计（= 前面几次之和），不是一次新调用。
        if len(recent) >= 2 and any(inp == sum(recent[-k:]) for k in range(2, len(recent) + 1)):
            continue
        recent.append(inp)
        calls.append((inp, out))
    if not calls:
        return None
    return {'calls': len(calls), 'first': calls[0][0], 'input': sum(c[0] for c in calls), 'output': sum(c[1] for c in calls)}


def children(agent, rnd, case):
    hist = ROOT / 'eval' / rnd / case / 'history.json'
    keys = set()
    if hist.exists():
        keys |= set(CHILD.findall(hist.read_text(encoding='utf-8')))
    board = ROOT / 'eval' / rnd / case / 'board.json'
    if board.exists():
        for s in json.loads(board.read_text(encoding='utf-8')).get('sessions') or []:
            keys.add(s['key'])
    total = {'n': 0, 'input': 0, 'output': 0}
    for k in sorted(keys):
        u = usage(k)
        if u:
            total['n'] += 1
            total['input'] += u['input']
            total['output'] += u['output']
    return total


rows = []
for case in CASES:
    row = {'case': case}
    for agent, rnd in ROUNDS.items():
        row[agent] = usage(f'agent:{agent}:eval-{rnd}-{case.lower()}')
        row[agent + 'Children'] = children(agent, rnd, case)
    rows.append(row)
print(json.dumps(rows, ensure_ascii=False, indent=1))
