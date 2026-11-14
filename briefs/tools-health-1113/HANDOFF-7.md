# 交接 7（Windows 端，2026-11-13 深夜，监管会话自己接着做）

先读 `WINDOWS-PROMPT.md`（规矩）、`PLAN.md`、`ACCEPTANCE.md`、`PROGRESS.md`（先看「自己做的决定」），再读 `HANDOFF-1.md` … `HANDOFF-6.md`，最后读这份。

## 用户交出来了（原样抄下去）

The user is away and has handed the whole tools-health-1113 round over: their words were "那你管控一下把任务做完我有事全部交给你了可以自己决定". So from now on don't wait on the user. Decide yourself, write each decision and its reason into PROGRESS.md, and keep the relay going (one item, then HANDOFF-<n>, push, new fresh session) through A (after-a batch + table), B1→B2→B3, C and D, and finally the closing step: full Node+Python test diff against origin/main, Z2 re-check, final PROGRESS summary, last commit pushed. Hard rules still hold: no merge to main, no tag/release, nothing installed into the production App, prod state/port 18789 read-only, no new OpenClaw config keys, no persona/playbook edits, no subagents, hy4free only. Stop-and-record cases from WINDOWS-PROMPT §6 stay "write it in PROGRESS and move on to the next item", not "ask the user". Copy this paragraph into every HANDOFF so each successor knows it. Whichever session finishes the last item, or gets truly blocked (needs the user's real data, or a decision that is irreversible outside the branch), must SendMessage to `local_2ff7548d-899a-47a4-a2fb-cacbd658c102` (the supervising session) with the final commit and a short status.

## 为什么这份是监管会话写的

接棒会话（HANDOFF-6 那个）开新会话被应用拒了（「只能凭用户自己的话开会话」）；监管会话由别的会话的消息唤醒时也开不了。所以 B 组起由监管会话 `local_2ff7548d…` 自己在 `F:\Projects\tools-health` 接着做。若之后由用户亲手开的新会话接手，照下面「下一项」做。

## 本分支（`fix/tools-health-1113`，都已推）

… → `359494f4` 交接 6 → `89b85b3b` B1 → `dea71293` B2 停 + B3 拆账 → 本文件。

B 组：B1 ✅（按模式，按会话做不到 → B1-F1；B1-3 没到 45：副本 51→49）、B2 没做（§6，B2-F1）、B3 ✅（拆账表、改前改后 diff 一致、personas 零改动）。

## 隔离副本现状

- 网关 1425，插件 = 本分支；配置 = 本分支 deny（含 B1 的 6 个 + `qqbot_*`/`feishu_*`）+ `document-extract`。
- 当前网关是带 cache trace 启动的（写到监管会话的 scratchpad）；下次重启不带 `TH_PASS_*` 就关了。
- 新工具：`tools/tool-health/prompt-breakdown.py <trace.jsonl>`；`gateway.py` 认 `TH_PASS_<变量>`（只给副本网关的环境变量）。

## 下一项

C1（并行调工具）→ C2（exec 提示）→ D1–D5 → 收工（全量测试对照 `origin/main`、Z2 复核、PROGRESS 总结、推送）。第五节原文：C1 一句加在 `read`、搜索、`code_search`、`web_fetch` 说明末尾；C2 提示原文见 PLAN 第五节。
