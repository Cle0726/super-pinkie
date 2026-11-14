# 交接 6（Windows 端，2026-11-13 深夜）

先读 `WINDOWS-PROMPT.md`（规矩）、`PLAN.md`、`ACCEPTANCE.md`、`PROGRESS.md`（先看「自己做的决定」一节），再读 `HANDOFF-1.md`（隔离副本用法）、`HANDOFF-2.md` … `HANDOFF-5.md`，最后读这份。

## 用户交出来了（监管会话转来的原话，每份交接都要原样抄下去）

The user is away and has handed the whole tools-health-1113 round over: their words were "那你管控一下把任务做完我有事全部交给你了可以自己决定". So from now on don't wait on the user. Decide yourself, write each decision and its reason into PROGRESS.md, and keep the relay going (one item, then HANDOFF-<n>, push, new fresh session) through A (after-a batch + table), B1→B2→B3, C and D, and finally the closing step: full Node+Python test diff against origin/main, Z2 re-check, final PROGRESS summary, last commit pushed. Hard rules still hold: no merge to main, no tag/release, nothing installed into the production App, prod state/port 18789 read-only, no new OpenClaw config keys, no persona/playbook edits, no subagents, hy4free only. Stop-and-record cases from WINDOWS-PROMPT §6 stay "write it in PROGRESS and move on to the next item", not "ask the user". Copy this paragraph into every HANDOFF so each successor knows it. Whichever session finishes the last item, or gets truly blocked (needs the user's real data, or a decision that is irreversible outside the branch), must SendMessage to `local_2ff7548d-899a-47a4-a2fb-cacbd658c102` (the supervising session) with the final commit and a short status.

## 工作方式（不变）

- 做完一项 → 写下一份 `HANDOFF-<n>.md`（含上面那段）→ 推 → 自己开一个新会话（`F:\Projects\tools-health`，不新建工作树，能解绑就解绑）接棒 → 停下。
- 实测只用 `mm/workbuddy/hy4free`，不设后备。不开子代理。每个决定写进 PROGRESS「自己做的决定」表。

## 本分支（`fix/tools-health-1113`，都已推）

… → `0f8afbf3` 交接 5 → `a52566f5` 合 A3 → `932f0ea5` 合 A4 → `8001f64d` document-extract 进 allow + 体检脚本按事件时间 + 副本 sync 补 deny/allow → `845f2f61` A 组结果 → 本文件。

**A 组完成**：A1 ✅、A2 ✅ 但 **A2-2 没过**（运行时冷启动问题，报 A2-F1）、A3 ✅、A4 ✅（修了 document-extract 后）、A5 ✅、A6 ✅（题 6 / Mac tab 没测）、A7 ✅。`refresh_mac_runtime.py --check` 待 Mac。详见 PROGRESS。

## 隔离副本现状

- 网关在 1425 跑着（pid 会变，用 `gateway.py status`），插件 = 本分支 `8001f64d` 的 `services/`，运行时打了 A1 补丁 + image-access v5，配置四个模式 deny 了 `web_search`、`plugins.allow` 加了 `document-extract`。
- `setup.py sync` 现在会顺带照 `services/mode-architecture/setup.py` 补四个模式的 `tools.deny` 和 `plugins.allow`（只加不删），改了插件就 `gateway.py stop` → `setup.py sync` → `gateway.py start`。
- 批次：`before-h4f`（改前）、`after-a`（改后，A 组）、`after-a-search`（A3-1 的 20 条 × 2）、`after-a-pdf`（复查 4a/4b/7）。量数字用 `session-stats.py --state <iso>\home\.openclaw --last 2000 --event-since <这批 started> --event-until <下一批 started>`（按事件时间；文件修改时间那套会混进别的批）。逐会话看：按 `results.json` 的 `sessionKey` 在 `agents\<agent>\sessions\sessions.json` 里找 `sessionId`，工具列表在同名 `.trajectory.jsonl` 的 `context.compiled.tools`。
- `run_eval.py` 必须在后台跑（`run_in_background`），一批 20 次约 12 分钟；搜索批 40 次约 25 分钟。

## 下一项：B1（照 PLAN / ACCEPTANCE 的 B 组）

1. 读 PLAN B 组和 ACCEPTANCE B 组。HANDOFF-1「已查明的事实」里有 B1 用得上的：插件工具 `api.registerTool(ctx => …, {name})` 的工厂可以按会话返回 `null`（`index.mjs` 约 6935 行起）；核心工具要么找发工具前的钩子，要么走 `agents.list[].tools.deny`（已有键）。
2. B2 若插件钩子做不到按会话改工具列表 → 停在 B1，写进 PROGRESS（§6），继续 B3。
3. 系统提示词一个字都不许删改（规矩 4）；B3 只拆账。
4. 每项单独提交并推；做完 B1 写 HANDOFF-7，接棒。

## 顺带看到、留给 B / C 组的

- `after-a-search` 40 次里 10 次撞 480 秒上限：简单的「给 2 个来源」查询模型也连读十几页（整批 `web_fetch` 332 次）。看 PLAN 里有没有对应项；没有就记进 PROGRESS「报给 Fable 的另开项」。
- 副本里 `exec` 常见失败：模型在 PowerShell 里用 `&&`、`p = rC:\…` 这类没加引号的路径——不是这一轮的项，除非 PLAN 有。
