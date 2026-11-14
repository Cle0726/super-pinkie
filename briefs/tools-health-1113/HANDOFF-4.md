# 交接 4（Windows 端，2026-11-13 夜）

先读 `WINDOWS-PROMPT.md`（规矩）、`PLAN.md`、`ACCEPTANCE.md`、`PROGRESS.md`，再读 `HANDOFF-1.md`（隔离副本用法、查到的事实）、`HANDOFF-2.md`（hy4free、A3/A4 并行会话）、`HANDOFF-3.md`（做完一项就接棒的工作方式），最后读这份。

## 工作方式（不变，见 HANDOFF-3）

- 做完一项 → 写下一份 `HANDOFF-<n>.md` → 推 → 自己开一个新会话（`F:\Projects\tools-health`，不新建工作树，能解绑就解绑）接棒 → 停下。
- 实测只用 `mm/workbuddy/hy4free`，不设后备。不开子代理。
- A3、A4 已有解绑会话在做，**不要再为它们开会话**；合它们的分支前**先问用户**。

## 本分支（`fix/tools-health-1113`，都已推）

… → `5074a28a` A6 → `9534eeef` 交接 3 → `df97ce8c` A7 → 本文件。

A 组状态：A1 ✅（`refresh_mac_runtime.py --check` 待 Mac）、A2 ✅（代码 + 单测；副本实测待做）、A3 ⏳ 解绑会话、A4 ⏳ 解绑会话、A5 ✅、A6 ✅（单测；题 6 和 Mac tab 真机没测）、**A7 ✅**。

## A7 做了什么

- 新脚本 `tools/tool-health/error-classes.py`（只读；按事件时间过滤 `--since`，只输出报错原文和计数）。
- PROGRESS「A7」一节有分类表：副本 `before-h4f` 批 12 次出错（5.0%），上游断流 10；Windows 正式最近 60 个会话 33 次（1.2%），断流 9、限流 8、超时 7、鉴权 6、中断 3；两边都没有上下文超长。
- 最大一类是上游「出字前断流」，根因在上游，但原地重试是碧琪这边能做的 → 已写成 PROGRESS「报给 Fable 的另开项」**A7-F1**，**没改代码**。
- 注意：副本会话文件里混着作废批的旧事件，session-stats 只按文件修改时间过滤会多数（376 vs 238 次回复）。以后量「改后」批，数字最好也按事件时间核一遍（`error-classes.py` 已经这么做；session-stats 没改）。

## 并行分支现状（11-13 夜 `git fetch` 时）

- `origin/claude/tools-health-1113-a3-03a2ac` 已在 origin（A3），是否做完看该分支的 `briefs/tools-health-1113/progress/A3.md`。
- A4 分支当时还没推到 origin。

## 下一项（照 HANDOFF-3「之后的顺序」）

1. **A2-1 副本实测**：在副本 learning 模式的 agentDir 放一个结构版本 19 的假库（造法见 `tests/agent-db-guard.test.mjs`，mtime 改到 1 分钟前）→ `setup.py sync` + 重启副本网关 → 看日志 `agent db learning: schema 19 > 1, moved`、文件到了 `home\.openclaw\backups\agent-db-<日期>\learning\`、网关正常。结果填 PROGRESS A2 表。做完写 HANDOFF-5，接棒。
2. 查 A3 / A4 分支是否完成（`git fetch origin && git branch -r | grep tools-health-1113-a`，读各自 `progress/A3.md` / `A4.md`）→ **问用户能否合进** `fix/tools-health-1113`。
3. 合进后：`setup.py sync`、`setup.py patch apply-web-fetch-fakeip-v6.mjs`（+ A4 的补丁）、重启网关 → 跑「改后」批（`run_eval.py --label after-a --repeat 2 --jobs 8`）→ 填 A 组表（A1-1、A2-2、A3-1、A4-1/3、A5-1、A6-1）。
4. B 组（B1 → B2 → B3），C 组，D 组，每组一个或几个接棒会话。
