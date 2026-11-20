# Metre 角色 agent · 修复后复验

**结论：未达到合并条件，不合并 `main`。** 以用户确认的 8 轮免费模型口径复验；模型目录未能满足视觉和异厂判分两项，真实执行、独立判分均为 0/8。技术结果和模型结果分开列。

- 复验源码 `5212d2558c40e6330fbd750ae0c6279315ac9c44`，[草稿 PR #29](https://github.com/Cle0726/super-pinkie/pull/29)。包的专项检查固定在 `069a7fc3239575e496213c71dc6b47207732039f`；后续差异仅测试、验收用的矩阵／代理、台账与记录（`git diff --name-only 069a7fc3 5212d255`）。不将包检查冒称为另一个 HEAD。
- 前次逐条报告原件：[候选 `afcb2386` 的 REVIEW（提交 `60750876`）](https://github.com/Cle0726/super-pinkie/blob/607508760c5eea688f5d45cb377a7ce3547b998d/briefs/metre-roles-1118/REVIEW.md)。本文件只更新本轮可重新确认的结论，不把执行者的 `PROGRESS.md` 当作证据。
- 当前回归对照固定 `99c3716a30370f74c371f981083522eb18af4e31`。原基线 `1d83ad3b` 及 R0 归档完整保留：15 条历史注入与候选不等、原历史人设差别计 27 路径；这在 60750876 已有复现，不改成相同。用户只更改实际回归参照与模型试验规模，并未批准跳过未过的门槛。
- 本地复现证据根：`C:/Users/34786/Documents/Codex/2026-11-19/origin-feat-metre-roles-1118-briefs/work/fix-20261119-061053`。下列文件名相对该目录；原提示、完整模型请求及配置不上传。

## 实际复验

| 门槛 | 本轮证据及复现 |
|---|---|
| **Z1 · 全量** | **本机门禁过**：在干净 `5212d255`、新的隔离 profile，`gate-final.txt` 原文 `271 test files, 0 failing tests, 2 known`、`gate-final.exit=0`。两条已知控制台用例仍为明确跳过，没记过。先用仓库所钉 Playwright，系统 Chrome 拒绝本机调试配置，故本机显式使用同版 Chromium Headless Shell + WebKit；CI Windows 实际用 Chrome。6 个浏览器环节单独实跑 `6 pass, 0 fail, 0 skipped`（`browser-bundled.txt`）。命令 `node tools/release-gate/run-tests.mjs --jobs 2`，没有 `--update`。旧台账 42 条确证通过、8 条旧超时未复现、1 条在主线已改名且新名单跑过（`renamed-known-test.txt`），共删除 51 条，未新增或更改任何剩余豁免。 |
| **Z1 · Python 与 CI** | 用 `python -B -X utf8 -m unittest discover -s tests -p <文件> -v` 逐一重跑 7 套相关测试，49 个案例：42 过、7 个平台依赖明确跳过，0 败（`final-*_test.py.txt`）。[打包输入 069a7fc3 的 CI 44639706045](https://github.com/Cle0726/super-pinkie/actions/runs/44639706045) Linux、Windows、macOS 与 Windows 打包均通过。[复验源码 5212d255 的 CI 44641296534](https://github.com/Cle0726/super-pinkie/actions/runs/44641296534) 的 Windows / macOS 已通过；记录时 Linux 仍在安装浏览器依赖，没记为通过。 |
| **Z2** | 真网关隔离复跑前后 UTC `23:45:28`、`23:52:42` 的正式配置及 App 安装目录修改时间相同，18789 前后均无监听。`Z2-before-smoke.json`、`Z2-after.json`；`Get-Item` + `netstat.exe -ano -p tcp`。没有用本机正式 App 跑安装或模型。 |
| **Z3a–d / Z4** | 从独立固定主线工作树运行 `PINKIE_INVENTORY_SOURCE_ROOT=<99c3716a checkout> node tools/metre/inject-inventory.mjs --save-baseline <临时 JSON>`，清除源码覆盖后候选运行 `node tools/metre/inject-inventory.mjs --verify-baseline <临时 JSON>`：15 份与工具快照整体 SHA-256 都为 `b2db9ecccd1a2484d12756e2c10347ea787c8967a15bc87355605cd0ca89e4fe`，`diffs=[]`、路径等价替换 0，见 `main-compare-after.json`。五老模式隔离配置见前次报告的准确两树对照；本轮没有相关产品改动。`git diff 99c3716a -- tests/session-lineage.test.mjs tests/metre-dispatch.test.mjs tests/session-cross-mode-ui.test.cjs` 为空；`git diff --name-only 99c3716a -- personas ':!personas/metre/roles'` 只有 `personas/README.md` 和 `personas/metre/AGENTS.md` 第 7 节。 |
| **Z3e / Z7** | 用户确认的八轮门槛不含额外旧模式真实话术和八次综合回归。后续，未记为过。 |
| **Z6 / R4-3** | 受控模拟模型 + 真网关：草稿未采用不可派，采用字节一致，读取夹具并汇报，丢弃无残留。复现 `python -B -X utf8 tools/metre/roles/smoke-isolated.py --runtime-root <现有隔离运行时> --out <新目录>`。本轮 `isolated-repaired/result.json` 两份角色请求分别 SHA-256 `20291dfd80b3317fff0e4cd1569b723c0d6706f33293f1bdd2bf0ee513bc40d1`、`21db8d6f4619d0a6ff145bb2027c37bf346276f4cc6ca28c313de8a03a5da8c0`，检查 7×5 个原文片段与标记，命中 0；`upstreamRequests=0`。 |
| **R1 定向及 X1–3 / X5** | 读卡、血缘、模式隐藏、卡权限/命令拒绝、选模与异厂机制的定向检查参加了全量；复现 `node --test tests/metre-roles.test.mjs tests/metre-role-navigation.test.cjs tests/metre-role-pilot.test.mjs`。X1 本轮再用真实网关确认非法路径形态、空值、超长值三个工具结果 `isError: true`，父请求状态仍 `ok` 且没新增子会话（`X1-repaired.json`，原始 transcript 第 25–27 行；以 transcript 校核纠正模拟量具过滤漏计）。 |
| **R1-17 / R1-19** | **没测完整**：没有这次真实 C 组的实际 usage 和可写角色现场记录；本地模拟不顶正式的 30k 上限证据。 |
| **R1-18** | **过（新清单）**：包初始快照有空 `BOOTSTRAP.md`；真角色一轮后它被上游消耗，出现明列的 `openclaw-workspace-state.json`。没有额外人设、非空占位或 `memory/`，工作区手册和视觉规范内容同源；`role-workspace-repaired.json`，用 `tools/metre/roles/package-receipt.py` 的 `snapshot` 在隔离目录重算。 |
| **R1-29** | 三个子会话实在运行，`pinkie.metre.stopAll` 报停止 3 个，看板 `3→0`，网关 RPC `4304ms`；含新启 Node CLI 的调用整体 `16531ms`（`review-stop.json`）。前者是实际停机操作，不把后者写成 15 秒内。并发与累计上限亦在单测中。 |
| **R2 / R3-7 / X4** | **没测：0/8**。以原隔离配置对本机认证模型目录做只读 GET，HTTP 200 列 75 项，只有 `workbuddy/hy4flash-free` 明确是免费条目，配置输入只有 `text`；旧配置标为可看图的 `workbuddy/hy4free` 不在返回目录（`free-route-catalog.json`，不含凭据）。不能同时满足可看图执行和异厂免费判分，不消耗试跑、不自动回退、不用模拟补结果。 |
| **R3 静态** | `node tools/metre/roles/lint-cards.mjs --all-33 --samples --json` 33/33；`final-plan-check.json` 的 `metadataMismatch=[]`、66 题、310 检查项。单来源已明确只可列「未证实」，视觉两题的出图规格、对比维度和取值明确；不声称 33 张卡已有异厂 6 项正式评分（R3-5 未测）。 |
| **R4-4 / P1 / R1-16 · Windows** | **待证据**：实际 Windows 包构建过；[同包 Windows smoke](https://github.com/Cle0726/super-pinkie/actions/runs/44639696039/job/135968814091) 已进 `Run smoke test`（以前一正式版 `v2.5.49` 做升级输入），记录时未返回专项结果或新装／升级、真实侧栏／看板截图。源代码安装夹具 Windows 19/19、角色安装 2/2，不替代真包证据。复现：`gh workflow run ui-parity.yml --ref feat/metre-roles-1118 -f old_tag=v2.5.49 -f metre_roles=true`，对照实际运行 SHA。 |
| **R4-4 / P2 · macOS** | **过（实际包内运行时快照）**：[UI parity `44639696039`](https://github.com/Cle0726/super-pinkie/actions/runs/44639696039) macOS runner 实际打包、临时 profile 安装并导入 `index.mjs`，日志 `Mac mode plugin fresh-install import OK`。工件 `ui-parity-macos/macos-metre-roles-runtime.json`：`roles`、33 张卡字节一致、无 memory，SHA-256 `fc037dd2160617d0e6f1ebdf35d3395ae7d4fa21fdddec4b18f714642646ce5c`。复现 `python tools/macos-package/check_runtime.py --resource-root <包内 SuperPinkie> --node <包内 node> --metre-roles-snapshot <输出>`。额外的打包 UI WebKit 截图步骤在 `document.fonts.status` 等待超时，并未称 UI parity 整绿。 |
| **R5 / P4** | 顶档是后续，不拿免费模型替代首版实验，也不是本次 8 轮新增的硬门槛。按用户「通过才合并」执行，当前不合并、不发布。 |

## 仍阻塞的事项

| 严重程度 | 位置 | 复现与建议 |
|---|---|---|
| 阻塞 | R2、R1-17、R3-5/7、X4 | 核对 `free-route-catalog.json`、再用 `node tools/metre/roles/compose.mjs --release-matrix <免费执行路由> <异厂免费判分路由>` 预备四题配对。可补接一家非腾讯、可看图的免费执行路由，再确认原腾讯免费路由可用作独立判分。钉住实际路由和预算，八轮每组从新夹具开始，贴原始会话、工具记录、现场文件和实际 usage；`prepared-not-run` 不算实跑。 |
| 待复核 | 平台 / 远端 CI | 取 Windows smoke 的 fresh/upgrade 字节比较、实际角色派活及看板图；最后留存相同源码的 CI 结果并核对 Linux 依赖步骤。能构建不等于已经实际运行。 |
| 重要 | Mac WebKit 截图 | [同包工作流](https://github.com/Cle0726/super-pinkie/actions/runs/44639696039)，`tools/ui-parity/capture.mjs:155` 等待字体 20 秒超时。补采在途字体和资源状态，不能直接取消判据。 |

**总判定：没有任何真实模型或异厂判分被记过。候选仍不满足合并条件；主线不动。**
