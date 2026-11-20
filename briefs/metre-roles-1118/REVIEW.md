# Metre 角色 agent · 修复后复验

**结论：未通过，不合并 `main`。** 用户已明确取消本轮的异厂判分，执行与新上下文复判同用一条免费路由；产品的异厂保护不变。已经验证该路由能读图，以及项目/角色两种派活都能走到真模型。首对两组都没有完成交回；修正验收脚本后，本机模型入口拒绝连接。正式完成与复判各 **0/8**，不能拿局部请求或图片探针冒充通过。

- 全量门禁复验源码 `5212d2558c40e6330fbd750ae0c6279315ac9c44`；真实派活基于分支产品源码 `7467977aee5ef3f5d0d99f7b2a04cf47f776d13f`，本轮未改产品代码。[草稿 PR #29](https://github.com/Cle0726/super-pinkie/pull/29)。包的专项检查固定在 `069a7fc3239575e496213c71dc6b47207732039f`；后续差异仅测试、验收用的矩阵／代理、台账与记录。不将包检查冒称为另一个 HEAD。
- 前次逐条报告原件：[候选 `afcb2386` 的 REVIEW（提交 `60750876`）](https://github.com/Cle0726/super-pinkie/blob/607508760c5eea688f5d45cb377a7ce3547b998d/briefs/metre-roles-1118/REVIEW.md)。本文件只更新本轮可重新确认的结论，不把执行者的 `PROGRESS.md` 当作证据。
- 当前回归对照固定 `99c3716a30370f74c371f981083522eb18af4e31`。原基线 `1d83ad3b` 及 R0 归档完整保留：15 条历史注入与候选不等、原历史人设差别计 27 路径；这在 60750876 已有复现，不改成相同。单模型例外仅对这 8 轮生效，不跳过其他必过项。
- 本地复现证据根：`C:/Users/34786/Documents/Codex/2026-11-19/origin-feat-metre-roles-1118-briefs/work/fix-20261119-061053`。下列文件名相对该目录；原提示、完整模型请求及配置不上传。

## 实际复验

| 门槛 | 本轮证据及复现 |
|---|---|
| **Z1 · 全量** | **本机门禁过**：在干净 `5212d255`、新的隔离 profile，`gate-final.txt` 原文 `271 test files, 0 failing tests, 2 known`、`gate-final.exit=0`。两条已知控制台用例仍为明确跳过，没记过。先用仓库所钉 Playwright，系统 Chrome 拒绝本机调试配置，故本机显式使用同版 Chromium Headless Shell + WebKit；CI Windows 实际用 Chrome。6 个浏览器环节单独实跑 `6 pass, 0 fail, 0 skipped`（`browser-bundled.txt`）。命令 `node tools/release-gate/run-tests.mjs --jobs 2`，没有 `--update`。旧台账 42 条确证通过、8 条旧超时未复现、1 条在主线已改名且新名单跑过（`renamed-known-test.txt`），共删除 51 条，未新增或更改任何剩余豁免。 |
| **Z1 · Python 与 CI** | 用 `python -B -X utf8 -m unittest discover -s tests -p <文件> -v` 逐一重跑 7 套相关测试，49 个案例：42 过、7 个平台依赖明确跳过，0 败（`final-*_test.py.txt`）。[打包输入 069a7fc3 的 CI 44639706045](https://github.com/Cle0726/super-pinkie/actions/runs/44639706045) 与[复验源码 5212d255 的 CI 44641296534](https://github.com/Cle0726/super-pinkie/actions/runs/44641296534) 的 Linux 套件、Windows 套件、macOS 检查和 Windows 构建四项均为 `success`。 |
| **Z2** | 技术门禁那次真网关隔离复跑前后 UTC `23:45:28`、`23:52:42` 的正式配置及 App 安装目录修改时间相同，18789 前后均无监听。`Z2-before-smoke.json`、`Z2-after.json`；`Get-Item` + `netstat.exe -ano -p tcp`。后续真实模型用新 profile 及独立网关，未直接写正式设置；复核时正式配置文件时间比前次快照新，来源未归因，不用前次时间戳推断整个后续时间窗不变。 |
| **Z3a–d / Z4** | 从独立固定主线工作树运行 `PINKIE_INVENTORY_SOURCE_ROOT=<99c3716a checkout> node tools/metre/inject-inventory.mjs --save-baseline <临时 JSON>`，清除源码覆盖后候选运行 `node tools/metre/inject-inventory.mjs --verify-baseline <临时 JSON>`：15 份与工具快照整体 SHA-256 都为 `b2db9ecccd1a2484d12756e2c10347ea787c8967a15bc87355605cd0ca89e4fe`，`diffs=[]`、路径等价替换 0，见 `main-compare-after.json`。五老模式隔离配置见前次报告的准确两树对照；本轮没有相关产品改动。`git diff 99c3716a -- tests/session-lineage.test.mjs tests/metre-dispatch.test.mjs tests/session-cross-mode-ui.test.cjs` 为空；`git diff --name-only 99c3716a -- personas ':!personas/metre/roles'` 只有 `personas/README.md` 和 `personas/metre/AGENTS.md` 第 7 节。 |
| **Z3e / Z7** | 用户确认的八轮门槛不含额外旧模式真实话术和八次综合回归。后续，未记为过。 |
| **Z6 / R4-3** | 受控模拟模型 + 真网关：草稿未采用不可派，采用字节一致，读取夹具并汇报，丢弃无残留。复现 `python -B -X utf8 tools/metre/roles/smoke-isolated.py --runtime-root <现有隔离运行时> --out <新目录>`。本轮 `isolated-repaired/result.json` 两份角色请求分别 SHA-256 `20291dfd80b3317fff0e4cd1569b723c0d6706f33293f1bdd2bf0ee513bc40d1`、`21db8d6f4619d0a6ff145bb2027c37bf346276f4cc6ca28c313de8a03a5da8c0`，检查 7×5 个原文片段与标记，命中 0；`upstreamRequests=0`。 |
| **R1 定向及 X1–3 / X5** | 读卡、血缘、模式隐藏、卡权限/命令拒绝、选模与异厂机制的定向检查参加了全量；复现 `node --test tests/metre-roles.test.mjs tests/metre-role-navigation.test.cjs tests/metre-role-pilot.test.mjs`。X1 本轮再用真实网关确认非法路径形态、空值、超长值三个工具结果 `isError: true`，父请求状态仍 `ok` 且没新增子会话（`X1-repaired.json`，原始 transcript 第 25–27 行；以 transcript 校核纠正模拟量具过滤漏计）。 |
| **R1-17 / R1-19** | **未完成**：修复 C 组第一次正式路由请求实际 `input=9565, cacheRead=0, output=558`，这一次固定输入 9,565，低于 30,000；调研、视觉 C 组没有对应真实记录，修复 C 组也没有写入产物和交回。不用模拟 usage 补齐。 |
| **R1-18** | **过（新清单）**：包初始快照有空 `BOOTSTRAP.md`；真角色一轮后它被上游消耗，出现明列的 `openclaw-workspace-state.json`。没有额外人设、非空占位或 `memory/`，工作区手册和视觉规范内容同源；`role-workspace-repaired.json`，用 `tools/metre/roles/package-receipt.py` 的 `snapshot` 在隔离目录重算。 |
| **R1-29** | 三个子会话实在运行，`pinkie.metre.stopAll` 报停止 3 个，看板 `3→0`，网关 RPC `4304ms`；含新启 Node CLI 的调用整体 `16531ms`（`review-stop.json`）。前者是实际停机操作，不把后者写成 15 秒内。并发与累计上限亦在单测中。 |
| **看图前置确认（不计 8 轮）** | 已 `git pull --ff-only`，分支包含之前的 Mac 修复 `06fae028`。隔离旧配置 `input=[text]`，新 profile 跑共用安装步骤变为 `[text,image]`；明确关闭图片输入的对照仍为 `[text]`。直连 `workbuddy/hy4flash-free` 附 PNG，不在消息里写随机数字，响应正确读出图片中的 `514410`（HTTP 200，3.219 秒）。证明实际能看图；不把它写成视觉还原完成。 |
| **R2 / R3-7 / X4** | **未完成：0/8**。固定的 `backend-fix-1` A/C 已真派发并实际收到上游 HTTP 200，但 A 的无害状态与测试命令被测试夹具误拦，C 的第二次流转中断，没有交回。之后分离默认工作区和夹具、补足允许指令并改为逐帧转发；入口几次恢复又拒绝连接，后续 A 仍有复现命令被验收白名单拦截。其余六场未派发；X4 哨兵未改但缺完整交回与调研组，不能算过。[请求与用量见 MEASURE](MEASURE.md#五本次八轮免费模型验收补记)。 |
| **R3-1–4 / R3-6 / R3-8–9** | `node tools/metre/roles/lint-cards.mjs --all-33 --samples --json` 33/33；`final-plan-check.json` 的 `metadataMismatch=[]`、66 题、310 检查项。下列逐卡核对保留前次实读结果，本轮逐一比较，确认 31 张未改、两张整改内容符合对应条款。审查卡的召回与误报仍待真实样题完成。 |
| **R3-5 · 六维评分** | **门槛已核**。同一免费模型分三批、各开新上下文，返回全部 33 张卡的六维分；按原量表，没有任何一项低于 4。结构化原分、调用指纹和盲评对照见 [card-review-scores.json](ref/card-review-scores.json)。原卡分数集中在 5；另给缺少要求、证据、范围的临时卡，它把这三项各判 1，并指出具体原文。分数只用于静态过线，不代表异厂评估或真实样题质量。 |
| **R4-4 / P1 / R1-16 · Windows** | **过（实际 Windows 包、隔离用户数据）**：[同包 Windows smoke](https://github.com/Cle0726/super-pinkie/actions/runs/44639696039/job/135968814091) 成功。工件 `windows-smoke-44639696039/summary.json`（SHA-256 `df0bef2e893f877f469209fc15a63147cbf6bfb2cc0f8bac2fea885a315c4583`）显示新装、旧版 `v2.5.49` 启动与升级均成功，两边 33 张卡，升级前写入的自定义卡和用户笔记字节相等。实际 WebView2 拍了 `metre-roles-menu-{light,dark}.png` 和 `metre-roles-board.png`；亲读三图：模式菜单不出现 roles，侧栏派发项和看板都见「调研员」，看板行有模型名。模型是本机回环夹具，只验真实 App 派活、不验模型质量。复现：`gh workflow run ui-parity.yml --ref feat/metre-roles-1118 -f old_tag=v2.5.49 -f metre_roles=true`，对照实际运行 SHA。 |
| **R4-4 / P2 · macOS** | **过（实际包内运行时快照）**：[UI parity `44639696039`](https://github.com/Cle0726/super-pinkie/actions/runs/44639696039) macOS runner 实际打包、临时 profile 安装并导入 `index.mjs`，日志 `Mac mode plugin fresh-install import OK`。工件 `ui-parity-macos/macos-metre-roles-runtime.json`：`roles`、33 张卡字节一致、无 memory，SHA-256 `fc037dd2160617d0e6f1ebdf35d3395ae7d4fa21fdddec4b18f714642646ce5c`。复现 `python tools/macos-package/check_runtime.py --resource-root <包内 SuperPinkie> --node <包内 node> --metre-roles-snapshot <输出>`。额外的打包 UI WebKit 截图步骤在 `document.fonts.status` 等待超时，并未称 UI parity 整绿。 |
| **R5 / P4** | 顶档是后续，不拿免费模型替代首版实验，也不是本次 8 轮新增的硬门槛。按用户「通过才合并」执行，当前不合并、不发布。 |

### R3-4 逐卡正文核对

下列逐卡核对只判 PLAN 的「必须做到」「交回要带」是否写入正文；R3-5 对每张卡的六项原分另存于上面的结构化回执。31 张的卡文件与前次逐字相同；`researcher` 和 `visual-designer` 是本轮重新对读的两张变更卡。

| 角色 | 核对 |
|---|---|
| `feature-dev` | ✓ 项目约定、现有测试、按惯例实现、命令输出和未覆盖项。 |
| `frontend-fix` | ✓ 浏览器修前复现、根因/控制台、修后桌面和 375 截图。 |
| `backend-fix` | ✓ 最小复现、只修根因、修前后命令与输出。 |
| `test-engineer` | ✓ 测试先红、边界清单、只改测试、产品问题只报。 |
| `code-reviewer` | ✓ 只读核实、不挑风格，位置、严重程度和触发场景。 |
| `refactor` | ✓ 同套前后测试、不改接口、输出和改动统计。 |
| `perf-tuner` | ✓ 同方法至少三次、收益目标、不快撤回、数表与命令。 |
| `security-auditor` | ✓ 四类检查、只读、不请求外部目标、打码和修法。 |
| `upgrader` | ✓ 读迁移日志、逐一升级与测试、回退原因。 |
| `plan-executor` | ✓ 不跳步、逐步输出和不符时停手。 |
| `batch-runner` | ✓ 清单、前三试跑、CSV、备份、熔断、跳过已成功项。 |
| `env-setup` | ✓ 用户空间、镜像、账本、装后验证与卸载。 |
| `automation-builder` | ✓ dry-run 和真跑证据、日志、撤回与停机方式。 |
| `release-prep` | ✓ 本地包、哈希、更新稿，发布操作只交回命令。 |
| `web-operator` | ✓ 截图、不登录/支付、提交受授权限制。 |
| `researcher` | ✓ 两个独立来源才进结论；不足列未证实，附来源；区分事实/推断、日期、矛盾及查不到项。 |
| `deep-reader` | ✓ 每份读完、行/页证据、未读范围和完成表。 |
| `domain-expert` | ✓ 权威出处、地区日期、确定/推断/不知、专业风险。 |
| `advisor` | ✓ 2–3 个不同路线、四维对比、推荐及改选条件。 |
| `data-analyst` | ✓ 输入/去重口径、可重跑、原始行、结论图。 |
| `competitor-analyst` | ✓ 功能/价格/定位，有一手链接、查看日和图。 |
| `visual-designer` | ✓ 规范、2–3 方向渲染、两尺寸及文件；有布局/媒介差异表，缺字、遮挡、出界可逐项检查。 |
| `ui-replicator` | ✓ 并排图、尺寸/颜色数据、明暗和视口。 |
| `viral-creator` | ✓ 平台字数、钩子、标题、封面、标签和来源，禁刷量。 |
| `writer` | ✓ 提纲、口吻、±10%、出处与交付路径。 |
| `editor` | ✓ 保留文风、待核事实、原文/改后/理由。 |
| `translator` | ✓ 术语、格式、本地化、三段回译和无法转译项。 |
| `doc-maker` | ✓ 按手册、结论标题、最终文件逐页预览。 |
| `motion-video` | ✓ 磁盘检查、配音先行、低清、抽帧、实测响度及来源。 |
| `modeler-3d` | ✓ 程序化 `.glb`、四视角、体积与外部素材授权。 |
| `reviewer` | ✓ 异厂配置、自己核实、逐条证据、只挑不改。 |
| `fact-checker` | ✓ 异厂配置、逐项数字日期人名引语、三态和出处。 |
| `qa-tester` | ✓ 主流程加六类边界，问题截图、复现与场景列表。 |

## 仍阻塞的事项

| 严重程度 | 位置 | 复现与建议 |
|---|---|---|
| 阻塞 | R2、R1-17、R3-7、X4 | 以 `node tools/metre/roles/compose.mjs --release-single-model mm/workbuddy/hy4flash-free` 固定同样四题；需要每组完整交回、产物重跑和同模型新上下文复判。验收环境的工具路径和本机模型入口都必须可用，不换模型或加付费回退。 |
| 阻塞 | 合并时的主线变化（Z3） | 截至取证，远端 `main=a85a7449`，没有本候选。旧侧 Z3 仍用已批准的 `99c3716a`。新主线的 #31 本身已让 12 个旧模式样例多出记忆写入规则，见下段；不得通过更新固定期望值掩掉差异。 |
| 重要 | Mac WebKit 截图 | [同包工作流](https://github.com/Cle0726/super-pinkie/actions/runs/44639696039)，`tools/ui-parity/capture.mjs:155` 等待字体 20 秒超时。补采在途字体和资源状态，不能直接取消判据。 |

### 新主线的单独整合预检

- `git merge-tree --write-tree --name-only a85a7449 b68c0930` 确认唯一文本冲突是 `ui/injections/laolao-head.fragment.html` 的看板资源版本。已在机上独立整合分支 `integration/metre-roles-1118-main-a85-review` 解决（`34d9b403`）；保留新主线的滚动修复和本分支角色展示，使用新的缓存键。不把该分支合入验收分支或主线。
- 用同一量具从单独的 `a85a7449` 工作树采集快照，对该本地整合树比较：15 条及两工具快照完全一致（`new-main-comparison.json`，两端 SHA-256 `48bb0a418c3555068eea93333b9a0bd6ea641d7616b844f1c431edfa3f4efef5`，`diffs=[]`）。定向 Node 118 过、0 败、1 跳过（`main-sync-node.txt`，包括两个 WebKit 看板宽度和长期记忆回归）。
- 固定 `99c3716a` 对整合树仍有 12 条正文差异，跟两份独立主线工作树之间的差异一致（`main-sync-snapshot.json`、`upstream-snapshot-delta.json`）。这是新主线的真实变化，不是角色新回归；要让整合树成为正式验收对象，先确认如何登记这项上游预期变化，再重跑整合版全量及打包。

**总判定：看图前置与两种派活已证实；正式模型轮次及复判仍未完成，异厂复判不是本轮阻塞。对最新主线的整合仍待验，未合并。**
