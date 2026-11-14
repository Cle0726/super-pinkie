# 交接 5（Windows 端，2026-11-13 夜）

先读 `WINDOWS-PROMPT.md`（规矩）、`PLAN.md`、`ACCEPTANCE.md`、`PROGRESS.md`，再读 `HANDOFF-1.md`（隔离副本用法、查到的事实）、`HANDOFF-2.md`（hy4free、A3/A4 并行会话）、`HANDOFF-3.md`（做完一项就接棒）、`HANDOFF-4.md`，最后读这份。

## 工作方式（不变）

- 做完一项 → 写下一份 `HANDOFF-<n>.md` → 推 → 自己开一个新会话（`F:\Projects\tools-health`，不新建工作树，能解绑就解绑）接棒 → 停下。
- 实测只用 `mm/workbuddy/hy4free`，不设后备。不开子代理。
- A3、A4 已有解绑会话，**不要再为它们开会话**；合它们的分支前**先问用户**。

## 本分支（`fix/tools-health-1113`，都已推）

… → `df97ce8c` A7 → `0341616c` 交接 4 → `f821aa31` A2-1 实测 + 修 → `d1b7632d` PROGRESS 路径笔误 → 本文件。

A 组状态：A1 ✅（`refresh_mac_runtime.py --check` 待 Mac）、**A2 ✅（A2-1 副本实测过；A2-2 待「改后」批题 7）**、A3 ⏳、A4 ⏳、A5 ✅、A6 ✅（题 6 和 Mac tab 没测）、A7 ✅。

## A2-1 做了什么

- 副本 learning 模式放了版本 19 的假库 → `sync` + 重启：**第一次没挪**（`skipped-busy`）。原因：运行时在插件 `gateway_start` 之前约 8 秒就打开每个模式库，读到版本太新报错关掉（不占文件），但已重写了 `-shm`，而「60 秒内改过不动」把 `-shm` 也算上了 → 永远挪不动。
- 修：`agent-db-guard.mjs` 判断「在写」只看库、`-wal`、`-journal`；新增单测（5 条全过）。再实测：挪到 `iso-th\home\.openclaw\backups\agent-db-20261113\learning\`，库和 -wal 校验值一致，网关 ready；第三次启动不再动。细节在 PROGRESS A2。
- **副本插件已 sync 到本分支最新代码**（A1–A7 都在里面），网关在 1425 跑着；A1 运行时补丁**还没**打进副本运行时。

## 并行分支现状（11-13 夜 `git fetch`）

- A3 `origin/claude/tools-health-1113-a3-03a2ac`：已推，`progress/A3.md` 写完（搜索链 5 家 + `web_search` 在四个模式 deny），看起来做完了。
- A4 `origin/claude/tools-health-1113-a4-7640b6`：已推两条代码提交（`1a92241b`、`afa5ebf6`），**还没有 `progress/A4.md`**，可能还在做。

## 下一项

1. **查 A3 / A4 是否完成**（`git fetch origin`，读各自 `briefs/tools-health-1113/progress/A3.md` / `A4.md`）→ 两个都完成就**问用户能否合进** `fix/tools-health-1113`（用 `AskUserQuestion`，不要自己合）。A4 没写完就等，或先问用户是否只合 A3。
2. 合进后：`setup.py sync`、`setup.py patch apply-web-fetch-fakeip-v6.mjs`（+ A4 的补丁）、重启网关 → 跑「改后」批（`run_eval.py --label after-a --repeat 2 --jobs 8`）→ 填 A 组表（A1-1、A2-2、A3-1、A4-1/3、A5-1、A6-1）。量数字按事件时间核一遍（HANDOFF-4 的提醒）。
3. B 组（B1 → B2 → B3），C 组，D 组，每组一个或几个接棒会话。
