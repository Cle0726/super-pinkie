#!/usr/bin/env python3
"""A7：出错 / 中断的回复按原因分类计数。只读会话记录，不改任何东西，不输出用户内容。

用法：
  python error-classes.py                                   # 读 ~/.openclaw（只读），最近 60 个会话
  python error-classes.py --state <隔离副本状态目录> --since <Unix 秒> --last 500
  python error-classes.py --json out.json                   # 另存数字（不要提交正式环境的结果）

数的东西：
  1. assistant 消息里 stopReason 为 error / aborted 的条数（和 session-stats.py 的「出错或中断」同一口径）；
  2. custom 事件 openclaw:prompt-error 的条数（运行时认定「这一轮没跑完」时记的）。
--since 同时过滤会话文件（修改时间）和每一条事件（时间戳），这样同一个会话文件里更早批次的事件不会混进来。

分类只看运行时记下的报错原文（errorMessage / prompt-error 的 error），同一会话 10 秒内有
prompt-error 时用它补充原因（例如 "Request was aborted" + "request timed out" 算上游超时）。
「中断」再细分：中断后 120 秒内用户自己发了消息算「用户停止」，其后是碧琪自动续接（pinkie-watchdog /
pinkie-tier）或什么都没有的算「系统 / 原因不明」。
"""
import argparse
import collections
import datetime
import glob
import json
import os
import re
import sys

CLASSES = [
    ('upstream_timeout', '上游超时（无响应 / 请求超时 / 整轮超时）'),
    ('upstream_eof', '上游断流（EOF / 连接断开 / 5xx）'),
    ('rate_limit', '上游限流（429）'),
    ('auth', '鉴权（无可用账号 / 令牌）'),
    ('context_overflow', '上下文超长'),
    ('abort_user', '中断：用户停止'),
    ('abort_system', '中断：系统 / 原因不明'),
    ('other', '其他'),
]
LABEL = dict(CLASSES)

RULES = [
    ('context_overflow', r'context (length|window)|maximum context|too many tokens|prompt is too long|上下文.*(超|过长)|token limit'),
    ('auth', r'\b401\b|\b403\b|auth_unavailable|unauthori[sz]ed|invalid api key|api key|oauth2\.googleapis\.com/token|forbidden|鉴权|认证'),
    ('rate_limit', r'\b429\b|rate limit|频率限制|quota|too many requests'),
    ('upstream_timeout', r'idle timeout|timed out|timeout|ETIMEDOUT|超时'),
    ('upstream_eof', r'\bEOF\b|connection error|ECONNRESET|ECONNREFUSED|socket hang up|\b50[0234]\b|network|fetch failed|terminated'),
]
ABORT = re.compile(r'aborted|abort', re.I)
AUTO_PREFIX = ('[pinkie-watchdog]', '[pinkie-tier]', '[pinkie-')


def classify(text):
    for key, pat in RULES:
        if re.search(pat, text or '', re.I):
            return key
    return None


def ts_of(o):
    t = o.get('timestamp') or o.get('ts')
    if isinstance(t, (int, float)):
        return t / 1000 if t > 1e11 else t
    if isinstance(t, str):
        try:
            return datetime.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()
        except ValueError:
            return None
    return None


def user_text(m):
    c = m.get('content')
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ''.join(b.get('text', '') for b in c if isinstance(b, dict))
    return ''


def short(s, n=90):
    s = re.sub(r'"requestId":"[^"]+"', '"requestId":"…"', str(s or ''))
    return s.replace('\n', ' ')[:n]


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--state', default=os.path.expanduser('~/.openclaw'))
    ap.add_argument('--last', type=int, default=60)
    ap.add_argument('--since', type=float, default=0)
    ap.add_argument('--json', default='')
    a = ap.parse_args()

    files = glob.glob(os.path.join(a.state, 'agents', '*', 'sessions', '*.jsonl'))
    files = [f for f in files if os.path.getmtime(f) >= a.since]
    files = sorted(files, key=os.path.getmtime, reverse=True)[: a.last]

    replies = 0
    reply_cls = collections.Counter()
    reply_by_model = collections.defaultdict(collections.Counter)
    reply_stop = collections.Counter()
    resumed = collections.Counter()  # 出错 / 中断后碧琪自动续接了的
    samples = collections.defaultdict(collections.Counter)
    pe_cls = collections.Counter()
    pe_by_model = collections.defaultdict(collections.Counter)
    pe_samples = collections.defaultdict(collections.Counter)

    for path in files:
        events = []
        for line in open(path, encoding='utf-8', errors='ignore'):
            try:
                o = json.loads(line)
            except Exception:
                continue
            t = ts_of(o)
            if a.since and (t is None or t < a.since):
                continue
            events.append((t, o))

        prompt_errors = []
        for t, o in events:
            if o.get('type') == 'custom' and o.get('customType') == 'openclaw:prompt-error':
                d = o.get('data') or {}
                err = str(d.get('error') or '')
                key = classify(err) or ('abort_system' if ABORT.search(err) else 'other')
                prompt_errors.append((t, err))
                pe_cls[key] += 1
                pe_by_model[d.get('model')][key] += 1
                pe_samples[key][short(err)] += 1

        for i, (t, o) in enumerate(events):
            m = o.get('message')
            if not isinstance(m, dict) or m.get('role') != 'assistant':
                continue
            replies += 1
            stop = m.get('stopReason')
            if stop not in ('error', 'aborted'):
                continue
            err = str(m.get('errorMessage') or '')
            near = [e for (pt, e) in prompt_errors if t is not None and pt is not None and abs(pt - t) <= 10]
            key = classify(err) or next((classify(e) for e in near if classify(e)), None)
            nxt_user = None
            for t2, o2 in events[i + 1:]:
                m2 = o2.get('message')
                if isinstance(m2, dict) and m2.get('role') == 'user':
                    nxt_user = (t2, user_text(m2))
                    break
            auto_next = bool(nxt_user and nxt_user[1].lstrip().startswith(AUTO_PREFIX))
            if key is None:
                if ABORT.search(err) or stop == 'aborted':
                    quick_user = (nxt_user and not auto_next and t is not None and nxt_user[0] is not None
                                  and nxt_user[0] - t <= 120)
                    key = 'abort_user' if quick_user else 'abort_system'
                else:
                    key = 'other'
            reply_cls[key] += 1
            reply_stop[stop] += 1
            reply_by_model[m.get('model')][key] += 1
            samples[key][short(err)] += 1
            if auto_next:
                resumed[key] += 1

    bad = sum(reply_cls.values())
    out = {
        'sessions': len(files),
        'replies': replies,
        'error_or_aborted': bad,
        'stop_reasons': dict(reply_stop),
        'reply_classes': {k: reply_cls[k] for k, _ in CLASSES if reply_cls[k]},
        'auto_resumed': {k: resumed[k] for k, _ in CLASSES if resumed[k]},
        'reply_classes_by_model': {str(mo): dict(c) for mo, c in reply_by_model.items()},
        'prompt_errors': sum(pe_cls.values()),
        'prompt_error_classes': {k: pe_cls[k] for k, _ in CLASSES if pe_cls[k]},
        'prompt_error_classes_by_model': {str(mo): dict(c) for mo, c in pe_by_model.items()},
        'samples': {k: dict(c.most_common(4)) for k, c in samples.items()},
        'prompt_error_samples': {k: dict(c.most_common(4)) for k, c in pe_samples.items()},
    }

    print(f"会话 {len(files)} 个，模型回复 {replies} 次，出错或中断 {bad} 次"
          f"（error {reply_stop['error']}、aborted {reply_stop['aborted']}）；prompt-error 事件 {out['prompt_errors']} 条")
    print('出错 / 中断的回复：')
    for k, lab in CLASSES:
        if reply_cls[k]:
            print(f'  {lab:<28} {reply_cls[k]:>3}  {reply_cls[k] / bad:.0%}   其后自动续接 {resumed[k]}')
            for s, n in samples[k].most_common(3):
                print(f'      {n}× {s}')
    print('按模型：')
    for mo, c in sorted(reply_by_model.items(), key=lambda x: -sum(x[1].values())):
        print(f'  {mo}: ' + '、'.join(f'{LABEL[k]} {v}' for k, v in c.most_common()))
    print('prompt-error 事件：')
    for k, lab in CLASSES:
        if pe_cls[k]:
            print(f'  {lab:<28} {pe_cls[k]:>3}')
            for s, n in pe_samples[k].most_common(3):
                print(f'      {n}× {s}')
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
