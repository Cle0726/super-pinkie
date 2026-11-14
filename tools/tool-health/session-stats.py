#!/usr/bin/env python3
"""碧琪会话体检：只读会话记录，不改任何东西。

用法：
  python3 session-stats.py                      # 读 ~/.openclaw（只读）
  python3 session-stats.py --state <隔离副本的状态目录> --last 60
  python3 session-stats.py --json out.json      # 另存一份数字，方便前后对比

输出：工具失败率、一次回复调几个工具、exec 占比、每轮固定负担（系统提示词 + 工具说明字数）、
出错/中断的回复数。验收标准见 briefs/tools-health-1113/ACCEPTANCE.md。
"""
import argparse
import collections
import glob
import json
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--state', default=os.path.expanduser('~/.openclaw'))
    ap.add_argument('--last', type=int, default=60, help='只看最近多少个会话文件')
    ap.add_argument('--since', type=float, default=0, help='只看这个 Unix 秒之后改过的会话文件')
    ap.add_argument('--json', default='')
    a = ap.parse_args()

    files = glob.glob(os.path.join(a.state, 'agents', '*', 'sessions', '*.jsonl'))
    files = [f for f in files if os.path.getmtime(f) >= a.since]
    files = sorted(files, key=os.path.getmtime, reverse=True)[: a.last]

    total = collections.Counter()
    failed = collections.Counter()
    samples = collections.defaultdict(list)
    per_msg = collections.Counter()
    stop = collections.Counter()
    models = collections.Counter()
    usage = collections.Counter()
    sys_chars, tool_chars, tool_counts = [], [], []
    replies = 0

    for path in files:
        for line in open(path, errors='ignore'):
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get('type') == 'context.compiled':
                d = o.get('data') or {}
                sp = d.get('systemPrompt')
                if isinstance(sp, dict) and sp.get('originalChars'):
                    sys_chars.append(sp['originalChars'])
                elif isinstance(sp, str):
                    sys_chars.append(len(sp))
                if isinstance(d.get('tools'), list):
                    tool_counts.append(len(d['tools']))
                    tool_chars.append(len(json.dumps(d['tools'], ensure_ascii=False)))
                continue
            m = o.get('message')
            if not isinstance(m, dict):
                continue
            role = m.get('role')
            if role == 'assistant':
                replies += 1
                content = m.get('content') or []
                n = sum(1 for b in content if isinstance(b, dict) and b.get('type') == 'toolCall')
                per_msg[n] += 1
                stop[m.get('stopReason')] += 1
                models[m.get('model')] += 1
                for k, v in (m.get('usage') or {}).items():
                    if isinstance(v, (int, float)):
                        usage[k] += v
            elif role == 'toolResult':
                name = m.get('toolName')
                total[name] += 1
                if m.get('isError'):
                    failed[name] += 1
                    if len(samples[name]) < 2:
                        text = ''.join(b.get('text', '') for b in (m.get('content') or []) if isinstance(b, dict))
                        samples[name].append(text[:200].replace('\n', ' '))

    def med(xs):
        xs = sorted(xs)
        return xs[len(xs) // 2] if xs else 0

    calls = sum(total.values())
    with_tools = sum(v for k, v in per_msg.items() if k >= 1)
    multi = sum(v for k, v in per_msg.items() if k >= 2)
    out = {
        'sessions': len(files),
        'replies': replies,
        'tool_calls': calls,
        'exec_share': round(total['exec'] / calls, 3) if calls else 0,
        'parallel_share': round(multi / with_tools, 3) if with_tools else 0,
        'error_or_aborted_share': round((stop['error'] + stop['aborted']) / replies, 3) if replies else 0,
        'system_prompt_chars_median': med(sys_chars),
        'tool_schema_chars_median': med(tool_chars),
        'tool_count_median': med(tool_counts),
        'avg_tokens_per_reply': round(usage['totalTokens'] / replies) if replies else 0,
        'tools': {n: {'calls': c, 'failed': failed[n], 'rate': round(failed[n] / c, 3)} for n, c in total.most_common()},
        'models': dict(models.most_common(10)),
    }

    print(f"会话 {out['sessions']} 个，模型回复 {replies} 次，工具调用 {calls} 次")
    print(f"exec 占比 {out['exec_share']:.0%}　一次调多个工具的占比 {out['parallel_share']:.0%}　"
          f"出错或中断 {out['error_or_aborted_share']:.1%}")
    print(f"每轮固定负担：系统提示词约 {out['system_prompt_chars_median']} 字，"
          f"工具说明约 {out['tool_schema_chars_median']} 字（{out['tool_count_median']} 个工具），"
          f"平均每次回复 {out['avg_tokens_per_reply']} token")
    print('工具失败率：')
    for n, c in total.most_common():
        print(f'  {n:<24} {failed[n]:>3}/{c:<4} {failed[n] / c:.0%}')
        for s in samples.get(n, []):
            print(f'      例：{s}')
    print('模型：', out['models'])
    if a.json:
        with open(a.json, 'w') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
