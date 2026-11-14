"""系统提示词拆账（tools-health B3，只读，不改任何提示词）。

  python -I -X utf8 tools/tool-health/prompt-breakdown.py <cache-trace.jsonl> [--json out.json]

输入是 OpenClaw 的 cache trace（隔离网关用 TH_PASS_OPENCLAW_CACHE_TRACE=1、
TH_PASS_OPENCLAW_CACHE_TRACE_SYSTEM=1、TH_PASS_OPENCLAW_CACHE_TRACE_FILE=<文件> 启动，见 iso-windows/gateway.py）。
取每个会话最后一条 stream:context 的 system（真正发给模型的那份），按段落标记切块、归类、数字数，
再找逐字重复的行。只输出字数、标题和重复行的前 40 字，不输出整段原文。
"""
import argparse, collections, json, re, sys

# (正则, 类别)：按出现位置切块，块一直延伸到下一个标记。
MARKERS = [
    (r'^## Tooling$', '工具用法（OpenClaw 自带）'),
    (r'^## Tool Call Style$', '工具用法（OpenClaw 自带）'),
    (r'^## Execution Bias$', '工具用法（OpenClaw 自带）'),
    (r'^## Safety$', 'OpenClaw 框架'),
    (r'^## OpenClaw Control$', 'OpenClaw 框架'),
    (r'^## Skills', '技能列表'),
    (r'^## Memory Recall$', '记忆'),
    (r'^## OpenClaw Self-Update$', 'OpenClaw 框架'),
    (r'^## Workspace$', 'OpenClaw 框架'),
    (r'^## Documentation$', 'OpenClaw 框架'),
    (r'^## Current Date & Time$', 'OpenClaw 框架'),
    (r'^## Workspace Files \(injected\)$', 'OpenClaw 框架'),
    (r'^## Assistant Output Directives$', 'OpenClaw 框架'),
    (r'^# Project Context$', 'OpenClaw 框架'),
    (r'^## .*[\\/]AGENTS\.md$', '打法（AGENTS.md 模式手册）'),
    (r'^## .*[\\/]SOUL\.md$', '人设'),
    (r'^## .*[\\/]IDENTITY\.md$', '人设'),
    (r'^## .*[\\/]USER\.md$', '用户资料（USER.md）'),
    (r'^## .*[\\/]TOOLS\.md$', '工具用法（TOOLS.md 模板）'),
    (r'^## .*[\\/]HEARTBEAT\.md$', 'OpenClaw 框架'),
    (r'^## .*[\\/]MEMORY\.md$', '记忆'),
    (r'^## .*[\\/][A-Z_]+\.md$', '项目速览 / 其他工作区文件'),
    (r'^## Silent Replies$', 'OpenClaw 框架'),
    (r'^## Control UI Embed$', '界面组件 / 回复格式'),
    (r'^## Messaging$', '工具用法（OpenClaw 自带）'),
    (r'^## Runtime$', 'OpenClaw 框架'),
    (r'^OpenClaw plugin-injected system context', 'OpenClaw 框架'),
    (r'^【工作过程展示】', '打法（插件注入）'),
    (r'^【联网】', '工具用法（插件注入）'),
    (r'^聊天已支持富回复', '界面组件 / 回复格式'),
    (r'^【全局交付真实性门禁】', '打法（插件注入）'),
    (r'^【工具调用前的进度说明】', '打法（插件注入）'),
    (r'^【长时间命令放后台】', '工具用法（插件注入）'),
    (r'^做事标准', '打法（插件注入）'),
    (r'^碧琪自己就能用的', '工具用法（插件注入）'),
    (r'^【主动提问】', '工具用法（插件注入）'),
    (r'^【独立模块：边做边学】', '打法（插件注入）'),
    (r'^【当前模式独立长期记忆', '记忆'),
    (r'^【独立长期记忆引擎', '记忆'),
    (r'^--- persona/', '人设'),
    (r'^--- memory/', '记忆'),
    (r'^【模式记忆运行规则', '记忆'),
    (r'^【[^】]+】', '其他插件注入'),
]


def blocks(text):
    hits = []
    for pattern, category in MARKERS:
        for m in re.finditer(pattern, text, re.M):
            hits.append((m.start(), category, m.group(0).strip()[:40]))
    # 同一位置只留第一条命中的规则
    seen, ordered = set(), []
    for pos, cat, title in sorted(hits, key=lambda h: h[0]):
        if pos not in seen:
            seen.add(pos)
            ordered.append((pos, cat, title))
    if not ordered or ordered[0][0] > 0:
        ordered.insert(0, (0, '开头', '(开头)'))
    out = []
    for i, (pos, cat, title) in enumerate(ordered):
        end = ordered[i + 1][0] if i + 1 < len(ordered) else len(text)
        out.append({'category': cat, 'title': title, 'chars': end - pos})
    return out


def repeated_lines(text, min_len=30):
    counts = collections.Counter(line.strip() for line in text.splitlines() if len(line.strip()) >= min_len)
    return [{'line': line[:40], 'chars': len(line), 'times': n} for line, n in counts.items() if n > 1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('trace')
    ap.add_argument('--json')
    args = ap.parse_args()
    prompts = {}
    for raw in open(args.trace, encoding='utf-8'):
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        if e.get('stage') == 'stream:context' and isinstance(e.get('system'), str):
            prompts[e.get('sessionKey') or '?'] = e['system']
    report = {}
    for key, text in prompts.items():
        parts = blocks(text)
        by_cat = collections.Counter()
        for p in parts:
            by_cat[p['category']] += p['chars']
        report[key] = {'chars': len(text), 'categories': dict(by_cat.most_common()), 'blocks': parts,
                       'repeated_lines': repeated_lines(text)}
        print(f'== {key}  共 {len(text)} 字')
        for cat, n in by_cat.most_common():
            print(f'  {cat:<24} {n:>6}  {n / len(text):5.1%}')
        rep = report[key]['repeated_lines']
        if rep:
            print('  逐字重复的行：')
            for r in rep:
                print(f"    ×{r['times']} {r['chars']:>4} 字  {r['line']}")
    keys = list(prompts)
    if len(keys) > 1:
        sets = [set(l.strip() for l in prompts[k].splitlines() if len(l.strip()) >= 30) for k in keys]
        common = set.intersection(*sets)
        print(f'== {len(keys)} 个会话共有的整行（≥30 字）：{len(common)} 行，{sum(len(l) for l in common)} 字')
        report['_shared_across_sessions'] = {'lines': len(common), 'chars': sum(len(l) for l in common)}
    if args.json:
        json.dump(report, open(args.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    sys.exit(main())
