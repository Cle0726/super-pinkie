# 交接 3（Windows 端，2026-11-13 夜）

先读 `WINDOWS-PROMPT.md`（规矩）、`PLAN.md`、`ACCEPTANCE.md`、`PROGRESS.md`，再读 `HANDOFF-1.md`（隔离副本用法、查到的事实）、`HANDOFF-2.md`（hy4free、A3/A4 并行会话），最后读这份。

## 用户新定的工作方式（11-13 夜）

- **做完一项就自己开一个新会话接棒**（没有上下文的新会话，带这份交接做简报），避免上下文太高。新会话照做：每做完一项，写下一份 `HANDOFF-<n>.md`、推送，再开下一个会话接着做，然后停下。
- 并行会话：用户允许最多另开两个**解绑**的会话（不回报、不唤醒）。A3、A4 已经在跑（见 HANDOFF-2），别再为 A3/A4 开新的。
- 实测只用 `mm/workbuddy/hy4free`，不设后备。

## 本分支（`fix/tools-health-1113`，都已推）

… → `1c1a148e` A5 → `b6dc68d1` 交接 2 → `c8105fc1` 改前数字 → `5074a28a` A6 → 本文件。

A 组状态：A1 ✅（代码 + 测试；`refresh_mac_runtime.py --check` 待 Mac）、A2 ✅（代码 + 测试；副本实测待做）、A3 ⏳ 解绑会话、A4 ⏳ 解绑会话、A5 ✅（插件层，剩余一截写在 PROGRESS）、A6 ✅（单测；题 6 和 Mac tab 真机没测）、**A7 没做**。

已知 Windows 本来就红（基线也红，不算本分支）：`mode-architecture` 的 `computer tool discovers…`、`browser-fast` 的 `aborting a socket request…`、`browser-memory` 的 `a remembered trail…`。

## 下一项：A7（只查不改）

- 数据两处：隔离副本 `%USERPROFILE%\碧琪实测\iso-th\home\.openclaw\agents\*\sessions\*.jsonl`（`before-h4f` 那批起，`--since` 用 `iso-th\evals\before-h4f\results.json` 的 `started`），Windows 正式 `%USERPROFILE%\.openclaw\agents\*\sessions\*.jsonl`（**只读**，最近 60 个会话，和 session-stats 一样的取法）。
- 数：assistant 消息 `stopReason` 为 `error` / `aborted` 的条数，和 `type` 为 `openclaw:prompt-error`（或类似 custom 事件）的条数；按原因分：上游超时、鉴权、上下文超长、上游断流（`unexpected EOF`）、用户 / 系统中断、其他。看 `errorMessage` 字段。
- 结果写进 PROGRESS「A7」一节（表格，注明哪台机器、哪批数据）；占比最高的一类如果是碧琪这边能修的，**另开一项报给 Fable，不要顺手改**。分类脚本放 `tools/tool-health/`（只读，不含用户信息）可以提交；原始数字不提交用户内容。
- 做完 → 写 HANDOFF-4（下一项见下）→ 推 → 开新会话接棒。

## 之后的顺序

1. A2-1 副本实测（假版本 19 库 → `setup.py sync` + 重启网关 → 看是否被挪、网关正常；方法见 HANDOFF-2）。
2. 查 A3 / A4 分支是否完成（`git fetch origin && git branch -r | grep tools-health-1113-a`，读各自 `briefs/tools-health-1113/progress/A3.md` / `A4.md`）→ **问用户能否合进** `fix/tools-health-1113`。
3. 合进后：`setup.py sync`、`setup.py patch apply-web-fetch-fakeip-v6.mjs`（+ A4 的补丁）、重启网关 → 跑「改后」批（`run_eval.py --label after-a --repeat 2 --jobs 8`）→ 填 A 组表（A1-1、A2-2、A3-1、A4-1/3、A5-1、A6-1）。
4. B 组（B1 → B2 → B3），C 组，D 组，每组一个或几个接棒会话。
