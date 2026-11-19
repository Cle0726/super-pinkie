# Metre 角色 agent · 最终验收报告

**最终判定：不通过，不合并 `main`。** 角色机制和草稿链路有实测证据；全量门禁未绿，原基线逐字要求未达，真实模型与正式安装验收仍缺证据。

- 日期：2026-11-19（Pacific Time）。被测源码：`afcb23869f8ca1a6229de405bd476d7d9e161c46`，远端 `feat/metre-roles-1118`、[草稿 PR #29](https://github.com/Cle0726/super-pinkie/pull/29)。对照：原基线 `1d83ad3b6e5001880143fea68392161897c4c1a7`，重基主线 `99c3716a30370f74c371f981083522eb18af4e31`。上一份对仅含文档的分支的验收保留在 `68d6d732`；不把它当本候选的结果。
- 这次另建干净工作树亲自复跑。不把任何 `PROGRESS*.md` 的判定当证据。本轮仅写验收报告，不修产品。用户保留原模型限制；本轮没有外部模型调用、没有提交任何同厂或身份无法核实的判分。模拟模型只用来验证代码路径，不作为作者、独立判分方或真实 usage。

## 证据与命令

本机证据根目录：`C:/Users/34786/Documents/Codex/2026-11-19/origin-feat-metre-roles-1118-briefs/work/final-review-20261119-123915`。下文证据文件相对于此目录。`target/` 是被测提交；原始提示、会话及请求体留在隔离证据目录，不提交。复现命令在对应的工作树运行，使用临时的 HOME、OpenClaw、App 和临时目录。

| 索引 | 本轮亲自复跑与原文 |
|---|---|
| **GATE** | 候选、当前主线分别运行 `node tools/release-gate/run-tests.mjs --jobs 4`，没有 `--update`。日志 `gate-finished.txt` / `gate-baseline.txt`。单文件对照 `node --test --test-reporter=tap tests/<文件>` → 当前主线 `z1-failed/summary.json`，原基线 `z1-original-baseline/z1-failed/summary.json`；Python 用 `python -B -X utf8 -m unittest discover -s tests -p <文件>`，六份 `pkg-*.txt`。 |
| **NODE** | `node --test --test-reporter=tap --test-concurrency=1 tests/metre-roles.test.mjs tests/metre-role-pilot.test.mjs tests/metre-role-navigation.test.cjs tests/session-cross-mode-ui.test.cjs tests/metre-dispatch.test.mjs tests/session-lineage.test.mjs tests/session-hints.test.mjs tests/metre-board.test.mjs tests/metre-inject.test.mjs tests/sidebar-mode-isolation.test.mjs tests/delivery-soft-gates.test.mjs tests/reasoning-enhance.test.mjs` → `focused-node.txt`：`tests 156 / pass 156 / fail 0 / skipped 0`。这不是全量门禁。 |
| **SNAP** | 用 `d58d37e2:tools/metre/inject-inventory.mjs` 的 5×3 量具在同一个空隔离 HOME 针对每对源码重跑（工作目录参数是临时脚本唯一修改）。`review-z3.py <证据根> <target> <99c3716a 工作树>` 生成 `z3/Z3.json`；再以 `1d83ad3b` 重跑到 `z3-original-baseline/z3/Z3.json`；同时对照 `legacy-inject-baseline.json`。`Z3-historical.patch` 是 15 条不同的原文 diff；仅将机器路径差异分开列，不删除内容差异。用各版 `services/mode-architecture/setup.py` 的 `install(Path(<临时Home>))` 重跑同样种子配置。 |
| **LIVE** | `python -B -X utf8 tools/metre/roles/smoke-isolated.py --runtime-root <已有隔离运行时> --out <新的隔离目录>`，不读取正式配置。`isolated-gateway/result.json`：`pendingNotDispatched / adoptedBytesEqual / rejectedNoFile / reportReturned = true`，`upstreamRequests=0`。按回环代理收到的完整角色请求做检查。附加负向输入与全停检查见 **EXTRA**。 |
| **EXTRA** | `python -B -X utf8 <work/final-review-runtime-extra.py> --target <target> --runtime-root <已有隔离运行时> --out <新的隔离目录>`。只扩充本机模拟模型与验证逻辑，不改产品。初跑漏写量具状态路径的 `sessions/`，修正后从空副本重跑。X1 以 `CHECK-INVALIDS.txt` 指向的原网关会话为准，`python -B -X utf8 <work/review-x1-transcript.py> <额外隔离目录>` 将工具输入与结果按标识连接；全停看 `additional-gateway-r2/review-stop.json`。 |
| **CARDS** | `node tools/metre/roles/lint-cards.mjs --all-33 --samples --json` → `cards-33.json`（33/33，`globalErrors=[]`）。再用不依赖量具解析器的 `card-plan-check.py` 逐一比较 PLAN 元数据 → `R3-plan.json`，`metadataMismatch=[]`、66 题、309 检查项；33 张正文又逐张和 PLAN 表比对，见下表。 |
| **R0** | `python -B -X utf8 <work/review-r0-evidence.py> <target>` 只读 `MEASURE.md` 引用的原始会话和抓包，`R0-evidence.json`；另用 `git show d58d37e2:briefs/metre-roles-1118/legacy-inject-baseline.json` 对照当前 blob 及前置历史。 |

## Z · 通用门槛

| 编号 | 判定 | 实测与复现 |
|---|---|---|
| Z1 ★ | **没过** | GATE：候选 `270 test files, 44 failing tests, 53 known`，当前主线 `267 test files, 44 failing tests, 53 known`，均退出 1，`NEW FAILURE / NOW PASSING / MISSING / SKIPPED` 项一致。13 个失败文件单独重跑，44 个失败用例的名称和各文件退出码与当前主线一致。按原标准再对照 `1d83ad3b`：13 份中只有 1 份完整一致，8 份旧版到本轮每文件 30 秒限时仍未退出（已有部分 TAP），3 份旧版不存在，余下 `learning-materials` 有同名失败但失败集合不同。由此只能证明和当前主线相同，不能把原基线验证签为通过。两基线的 `git diff <基线> afcb2386 -- tools/release-gate/known-failures.json` 都为空。六份相关 Python：模式安装 13/13、角色安装 2/2、Windows agent 19/19、打包加载夹具 2/2、人设 2 过 1 跳过、Mac shell 2 过 6 跳过。 |
| Z2 ★ | **过** | 本轮起止 UTC `12:39:15` → `13:01:36`；正式配置 `LastWriteTimeUtc=2026-11-14T07:50:37.9293033Z`、App 目录 `2026-11-03T22:57:22.1522954Z` 均未变，18789 前后均无监听 PID。复现：两次 `Get-Item` 取修改时间，`netstat.exe -ano -p tcp` 取监听 PID；证据 `Z2-{before,after}.json`。 |
| Z3a ★ | **原门槛没过**；与当前主线一致 | SNAP：同隔离 HOME 下候选和 `99c3716a` 的 15 条原文逐字相同，整体 SHA-256 `d6c0a941b2b599861cddfd829af374d12468f2c76909046bfe9b1f692fb3e22e`。对照原 R0 档，替换机器路径后 15/15 条仍不同；例如新文本有 `【少走几步】每调一次工具就要重新请求一次模型，所以：`（详 `Z3-historical.patch`）。由于当前主线重跑就已不同，不能归为角色功能引入，但也不能自行换掉验收的原基线。 |
| Z3b ★ | **过** | SNAP：安装器在临时 profile 中生成 `main/project/thinking/learning/unrestricted`；五项配置对两基线均 `matchesBase: true`（工具、deny、工作区、模型）。候选另有 `roles`。 |
| Z3c ★ | **过** | 再读 `z3/Z3.json`：五组 `pinkie_session_start` / `pinkie_mode_ask` 定义均 `matchesBase: true, matchesHistorical: true`，SHA-256 都为 `b92b908d63553356db47ab4d82fe86f7b8dc64091c8bb79bd7220e69bdd676df`。 |
| Z3d ★ | **没过** | `git diff --stat 1d83ad3b afcb2386 -- tests/session-lineage.test.mjs tests/metre-dispatch.test.mjs tests/session-cross-mode-ui.test.cjs`：3 文件、+124/−14；改以 `99c3716a` 对照则为空，NODE 定向通过。但旧模式全量失败还在 Z1，原基准的零改动要求也不满足。 |
| Z3e ★ | **没测** | 没有本轮对五个旧模式各发一条并核对真实回复口吻，不能用快照或模拟替代。补测：同一隔离配置下发五条，保存原文及模式。 |
| Z4 ★ | **严格原命令没过** | `git diff --name-only 1d83ad3b afcb2386 -- personas ':!personas/metre/roles'` 有 27 个路径。改比较基准为 `99c3716a` 只剩 `personas/metre/AGENTS.md` 第七节与 R4 要求的 `personas/README.md`。都留证，未经用户确认不放宽成「以重基为准」。 |
| Z5 | **过（本候选交付）** | `git ls-remote --heads origin main feat/metre-roles-1118 feat/metre-mode-1113`：功能 `afcb2386` 已到远端，`main=99c3716a`、`feat/metre-mode-1113=1d83ad3b`、PR 仍开且为草稿；确认未合并或发布。提交及验证说明见 `git log 99c3716a..afcb2386`。 |
| Z6 ★ | **过** | LIVE：真实网关角色请求体 2 份；脚本枚举 `prompts/unrestricted-prompt*.txt`，每个文件取 5 个去重长行片段（每段 28–40 字符），在 JSON 全部字符串字段做字面查找（`any(marker in part for part in parts)`）并额外查 `OPENCLAW_UR_INJECT`。结果 `promptFiles=7, promptSegments=35, unrestrictedHits=0`，且请求中确有角色卡。请求 SHA-256 `e010651e147f11e4fa2aed4cb5d23295b98352ee11f5f040dacd479c847f32a6` / `45b2f30f89a1fbc58d07b97800f9e35a6afaf1f95a4c654c70b4b3986c920a90`；复现命令见 LIVE，不公布提示原文。 |
| Z7 | **没测** | 本轮没有 S2/S5/S7/S9 各两遍真实模型记录；`tools/metre/iso/drive.py` 与旧批 7 的同题复跑留待额度授权，旧侧首轮不能代替。 |

### CI 与平台证据（同一候选 SHA）

- [候选 CI `44521891652`](https://github.com/Cle0726/super-pinkie/actions/runs/44521891652) 的 `headSha=afcb2386`，结论 `failure`。Windows 的定向 Chrome UI 步骤过，但全执行套件退出 1：`chromium: new learning chats stay in chat; explicit desk views remain session-local` 和 `desk conversation is independent; ordinary learning chat has no tonight strip or collect controls`。对照相同基准 [主线 CI `44492211209`](https://github.com/Cle0726/super-pinkie/actions/runs/44492211209)，该两条也失败，不能据此归为角色新回归。重现日志：`gh run view 44521891652 --job 135552336293 --log-failed --repo Cle0726/super-pinkie` 和 `gh run view 44492211209 --job 135450434845 --log-failed --repo Cle0726/super-pinkie`。
- `portable-checks` 在 `Install browser regression dependencies` 阶段报 `E: Failed to fetch`，可见 Ubuntu 包源连接失败/503；没跑到可移植测试。`macos-check=cancelled`，`windows-build=skipped`，该候选 CI 工件列表 `total_count=0`（`gh api repos/Cle0726/super-pinkie/actions/runs/44521891652/artifacts`）。Ubuntu 网络问题不等于产品缺陷，也不能把其它提交的 Mac 或 Windows 包拿来签收候选。

## R0 · 量和清点

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R0-1 ★ | **过** | R0，四组复算 `49887+1280=51167`、`37269+0=37269`、`32246+256=32502`、`14480+0=14480`，与表值相同；原 `usage` 路径见 `MEASURE.md`。实测口径是短简报首次模型调用的 `input + cacheRead`，不把原型数冒充新候选 R1-17。 |
| R0-2 ★ | **过（明示估算口径）** | R0，四抓包的工具数 `52/58/53/22`，并集 58，测量表 58 行，缺漏 `[]`，每行有字符数、估算 token 和六类之一。工具被禁用不等于不归类。 |
| R0-3 ★ | **过** | `git merge-base --is-ancestor d58d37e2 d713f082` 退出 0。`git rev-parse afcb2386:briefs/metre-roles-1118/legacy-inject-baseline.json d58d37e2:briefs/metre-roles-1118/legacy-inject-baseline.json` 均 `3cecfe90522ddd614a3b133df9c08bd597b801e1`。 |
| R0-4 | **原执行过程没测** | `Z2-before.json` 本轮 F 盘 `59,090,567,168` 字节并且未删文件；无法独立证实早期磁盘不足时的原用户授权与暂停过程，不把交接文字视为现场证据。 |
| R0-5 | **过** | R0 的 `14,480 ≤ 30,000` 支持 R0 原型继续做；不代替真实实验。 |

## R1 · 机制

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R1-1 ★ | **过** | NODE 的读卡用例：六必填字段逐个、格式、长度、工具、路径、技能缺失、用户覆盖和更新重读。 |
| R1-2 ★ | **过** | CARDS。另从 `personas/project/playbooks/debugging.md` 复制 48 字到临时 `backend-fix.md`，`node tools/metre/roles/lint-cards.mjs --json <临时卡>` 退出 1，`正文存在与 playbooks/debugging.md 连续 40 字以上完全相同的片段`（`copy-negative.json`）。 |
| R1-3 | **过（机制）** | NODE 中坏卡不进合法枚举，返回原因并和看板卡数对照。 |
| R1-4 ★ | **过** | NODE 断言 `agent:roles:pinkie-child:`、卡来源、64 个十六进制字符的哈希、可不填 mode、带 mode 时提示不起作用；LIVE 的 `TRY-ADOPTED` 能派活并回报。 |
| R1-5 ★ | **过（当前主线对照）** | NODE 原血缘与派活测试未相对主线改动，Metre 无角色仍要求 mode；按历史基线的测试修改另见 Z3d。 |
| R1-6 ★ | **过** | NODE + SNAP：老模式工具无 role，`mode:roles` 被拒，`session-hints` 无 roles。 |
| R1-7 | **过** | NODE：不存在角色的错误含合法值列表。 |
| R1-8 ★ | **没测完整** | `budgets.json`：真实 33 张官方卡的新增段 594 字，造 40 张用户卡后 585 字，有「还有 N 张」。缺以同一真实模型同一口径对照的固定输入 ≤+1k token。 |
| R1-9 | **过** | NODE 确认单详情/整列表、Metre 专属、独做收起；LIVE 的真实网关在采用后才把新卡纳入 role 枚举。 |
| R1-10 | **过（机制）** | NODE：`pinkie_mode_ask` 带 role 走 roles 及卡权限，旧模式不变。 |
| R1-11 ★ | **过（当前主线快照）** | NODE：`metreRoles=false` 后 `role`、`of`、`pinkie_roles` 消失，恢复当前主线定义；已有未确认角色提案也不得绕过。 |
| R1-12 ★ | **过** | NODE 前 3 轮 `before_prompt_build` 的卡格式与首条简报断言；首消息不带 `REPORT_NOTE`，LIVE 真请求也含卡。 |
| R1-13 ★ | **过** | NODE 用压缩后首轮测试卡还在，属于标准允许的单测模拟。 |
| R1-14 ★ | **过** | NODE 改盘后旧会话哈希/正文不变，新会话使用新版。 |
| R1-15 ★ | **过（注入单测）** | NODE 白名单/禁词断言；`budgets.json` 中 `ROLES_BASE_chars=295`。没有把工具定义或网关协议消息算成角色人设。 |
| R1-16 ★ | **没测完整** | NODE 角色挂在 Metre、保留运行状态、点击跳转、没有 roles 模式；CI Windows Chrome 有定向回归。没取得已安装 App 的浅/深模式菜单及侧栏截图；`ref/board-roles-*.png` 是看板演示，不顶侧栏。 |
| R1-17 ★ | **没测** | 没有候选 `researcher/backend-fix/ui-replicator` 三次真实 usage。LIVE 的本地模拟 token 不采用。 |
| R1-18 | **没过（指定文件清单）** | LIVE 一轮后工作区无 `memory/`，只是上游生成 `openclaw-workspace-state.json` 并去掉空 `BOOTSTRAP.md`；`playbooks` 及视觉规范隔离安装有拷贝校验，不把额外元数据隐去。 |
| R1-19 | **没测完整** | LIVE 用的是只读卡，执行命令与写文件是否免确认未在本轮实际 App/隔离用户流程验证。 |
| R1-20 ★ | **过（实捕和清单覆盖）** | `budgets.json` 中 LIVE 的 14 个唯一工具都分类；R0 原捕获 58 个全覆盖；NODE 新增一个无归类假工具必失败。 |
| R1-21 ★ | **过（单测）** | NODE 的 `researcher` write/exec 被拦和 `blockReason` 逐字断言。 |
| R1-22 ★ | **过（单测）** | NODE 重跑命令边界、大/小写、空格及管道/连接词用例；只验证拦截逻辑，不在实际仓库执行这些命令。 |
| R1-23 | **过（隔离单测）** | NODE 的只读角色可写命令的违规审计模拟，汇报必须列出现场变动文件。 |
| R1-24 ★ | **过** | NODE 按档位、视觉、工具、健康、自身逐个断言及缺项错误。 |
| R1-25 ★ | **过（机制）** | NODE 的 14 厂家/routing 格式、同厂拒绝、无 `of` 警告；未知模型厂家或错误 `of` 也拒绝。这不是 R2/R3 的实际异厂判分。 |
| R1-26 | **过（机制）** | NODE 缺交回段落时提示，齐全不多加；`delivery-soft-gates` 定向绿，LIVE 真网关报告正常返回。 |
| R1-27 | **过（看板夹具）** | 亲自查看 `ref/board-roles-{light,dark,700}.png`：有角色名、模型、自定义标记、`合格 34 张 · 不合格 1 张` 和原因。CSS `git diff 99c3716a afcb2386 -- ui/injections/laolao-metre-board.css` 查新增 hex/rgb/hsl 为零。演示数字不当成用户当天数据。 |
| R1-28 ★ | **过（相对重基主线）** | `budgets.json`：`metreChars=6498`；`git diff 99c3716a afcb2386 -- personas/metre/AGENTS.md` 只改第七节，绝对基线见 Z4。 |
| R1-29 ★ | **过（单测与隔离实测）** | NODE 核并发、累计限制与全停。EXTRA 让三个角色子会话实际停留在本机模拟模型请求里，再调 `pinkie.metre.stopAll`：看板运行 `3→0`，返回 `stopped=3, ok=true`；服务端 `3402ms`、含命令行调用 `14016ms`，均低于 15 秒；见 `review-stop.json` 和前后 `board-*.json`。 |
| R1-30 | **过（机制）** | NODE 无角色项目记忆工具、提示和读取；LIVE 的角色工作区无 `memory/`。 |
| R1-31 | **过（定向）** | NODE 的 `reasoning-enhance.test.mjs` 通过，新的角色字段使用 `metreRole`/`metre-roles`，未拿极致思考 `childRoles` 复用。 |

## R2 · 试点

| 编号 | 判定及证据 |
|---|---|
| R2-1 ★ | **没过（缺证据）**：`MEASURE.md` 只有 R0，不含 48 个实验原始会话。`node tools/metre/roles/compose.mjs --matrix <模型 id>` 产出 `prepared-not-run`，不是完成记录。 |
| R2-2 ★ | **没测实际运行**：NODE 验出三组定义的简报哈希一致，实际执行方的会话和模型标识都未齐，不能验实际是否一样。 |
| R2-3 ★ | **没测**：没有原始数据重算完成数、证据差值、固定输入和 reviewer 召回/误报。 |
| R2-4 ★ | **没测**：无可核的 48 项总体，抽样和异厂判分均 0/6；不从离线计划虚抽。 |
| R2-5 ★ | **没测**：`R3-plan.json` 可证实 reviewer 两题各预埋 3 问题，不是它实际检出了至少 2 个且无误报。 |

## R3 · 卡与样题

| 编号 | 判定及证据 |
|---|---|
| R3-1 ★ | **过**：CARDS，33 个 ID 与 PLAN 集合相等，无导员。 |
| R3-2 ★ | **过**：CARDS + R1-2，官方全过、故意抄写卡被拒。 |
| R3-3 ★ | **过**：`R3-plan.json` 逐字段比较 `tier/vision/tools/review/deny_commands`，`metadataMismatch=[]`。 |
| R3-4 ★ | **没过**：逐张实读如下。`researcher` 允许不足两个独立来源的条目进「结论清单」，与 PLAN 要求的至少两个独立来源不符；同一例外进入样题评分。 |
| R3-5 ★ | **没测正式评分**：没调用独立判分模型，不为 33 张卡填执行者同源分数。静态阅读见 `visual-designer.md:15` 额外要求「无 AI 模板味」无操作化标准，应先改成能核对的条件。 |
| R3-6 ★ | **没过（结构齐，可核性有缺口）**：CARDS/`R3-plan.json` 33 份 × 2，简报、夹具、309 个检查项齐。`visual-designer.json:17,36` 的「实质区分／本质不同」有排除项或示例，但没有明确的通过线；两位验收人可能对同一组图给不同结果。 |
| R3-7 ★ | **没测**：没有 66 题全部通过的独立原始记录，也没有真实模型按五组 2 题的复跑；0/10。 |
| R3-8 ★ | **没测**：`R3-plan.json` 五张审查卡各两题、每题三处预埋；没有独立跑出逐题 2/3、0 误报的数据。 |
| R3-9 ★ | **过**：CARDS 与 PLAN 对照的 10 张只读卡均无 `write`。 |

逐卡正文核对（`personas/metre/roles/<id>.md` 的「做法」「边界」「交回」；✓ 是所列条款存在，不是运行判分）：

| 角色 | 条款核对 |
|---|---|
| `feature-dev` | ✓ 约定/现有测试、按惯例实现、命令输出与未覆盖项。 |
| `frontend-fix` | ✓ 浏览器修前复现、根因/控制台、修后桌面和 375 截图。 |
| `backend-fix` | ✓ 样板的最小复现、只修根因、修前后命令与输出。 |
| `test-engineer` | ✓ 测试先红、边界清单、只改测试/问题只报。 |
| `code-reviewer` | ✓ 只读核实、不挑风格，位置严重程度与出错场景。 |
| `refactor` | ✓ 同套双测、不改接口、输出和改动统计。 |
| `perf-tuner` | ✓ 同方法至少三次、收益目标、不快撤回、数表与命令。 |
| `security-auditor` | ✓ 四类检查、只读、不打外部、打码和修法。 |
| `upgrader` | ✓ 读迁移日志、逐一升级与测试、回退原因。 |
| `plan-executor` | ✓ 不跳步、逐步输出和不符时停手。 |
| `batch-runner` | ✓ 清单、前三试跑、CSV、备份、熔断、跳过已成功。 |
| `env-setup` | ✓ 用户空间、镜像、账本、装后验证与卸载。 |
| `automation-builder` | ✓ dry-run/真跑证据、日志、撤回与停机方式。 |
| `release-prep` | ✓ 本地包/哈希/更新稿、发布操作只交回命令。 |
| `web-operator` | ✓ 截图、拒绝登录/支付、提交受授权限制。 |
| `researcher` | 待修：有双来源、事实/推断、矛盾与查不到项；第 12/20 行却让不足两来源的项写进「结论清单」，需要标未证实、不计已证实结论。 |
| `deep-reader` | ✓ 每份读完、行/页证据、未读范围和完成表。 |
| `domain-expert` | ✓ 权威出处、地区日期、确定/推断/不知、专业风险。 |
| `advisor` | ✓ 2–3 个不同路线、四维对比、推荐及改选条件。 |
| `data-analyst` | ✓ 输入/去重口径、可重跑、原始行、结论图。 |
| `competitor-analyst` | ✓ 功能/价格/定位，有一手链接、查看日和图。 |
| `visual-designer` | ✓ 读审美规范、2–3 方向渲染、两尺寸和文件。附加「无 AI 模板味」的问题另列。 |
| `ui-replicator` | ✓ 并排图、尺寸/颜色数据、明暗和视口。 |
| `viral-creator` | ✓ 平台字数/钩子/标题/封面/标签和来源，禁刷量。 |
| `writer` | ✓ 提纲/口吻/±10%/出处与交付路径。 |
| `editor` | ✓ 保留文风、待核事实、原文/改后/理由。 |
| `translator` | ✓ 术语/格式/本地化、三段回译和无法转译项。 |
| `doc-maker` | ✓ 按手册、结论标题、最终文件逐页预览。 |
| `motion-video` | ✓ 磁盘检查、配音先行、低清、抽帧、实测响度及来源。 |
| `modeler-3d` | ✓ 程序化 `.glb`、四视角、体积与外部素材授权。 |
| `reviewer` | ✓ 异厂元数据、自己核实、逐条证据、只挑不改。 |
| `fact-checker` | ✓ 异厂元数据、逐项数字日期人名引语、三态和出处。 |
| `qa-tester` | ✓ 主流程加六边界，问题截图/复现与场景列表。 |

## R4 / R5 / 对抗 / 发布

| 编号 | 判定及证据 |
|---|---|
| R4-1 ★ | **过（隔离与安装夹具）**：LIVE 采用后新用户卡进入角色枚举、给出实回报，解析器标「自定义」。`windows_mode_agents_test.py` 重装/升级夹具比字节；不代表正式包。 |
| R4-2 ★ | **过（资产同步夹具）**：`windows_mode_agents_test.py` 的覆盖/退役备份测试，退出 0，并确认更新不覆盖用户卡。 |
| R4-3 ★ | **过（机制/隔离）**：NODE 按项目同类第三次提醒、坏卡不落盘、采用前禁派与用户动作；LIVE 的真实请求从待采用到可派活和丢弃无文件。真 App 证据另看 P1。 |
| R4-4 ★ | **没测完整**：Windows 安装与升级夹具绿；不是正式包。候选 `windows-build=skipped`，`macos-check=cancelled`，没有候选平台产物及真机快照。 |
| R4-5 | **过**：核 `docs/METRE-MODE.md`、`personas/README.md`、`briefs/metre-mode-1113/RELEASE-NOTES-DRAFT.md`：模式非用户菜单项→导航测试；读卡/派活→NODE；草稿用户决定→LIVE；官方备份/用户保护→安装夹具；角色名/自定义/计数→已看三图和看板测试。 |
| R5（R-1～R-7） | **每题都没测**：R-1 简报缩减、R-2 三分工/异厂、R-3 不硬派、R-4 只读拦截的真实流程、R-5 实际用户卡交办、R-6 用户说停的真实流程、R-7 伪授权汇报均无两轮真实模型证据。本轮不查改号池，不用免费或模拟模型代顶档。 |
| X1 ★ | **过（真实隔离网关）**：EXTRA 按次向 `pinkie_session_start` 传 `../x`、空串、81 字符串。按工具调用 ID 直接对照会话原文第 25–27 行，三个都是 `isError: true`、`role: must be equal to one of the allowed values`；无新子会话，网关会话状态 `ok`，之后仍能派活并全停。早期量具过滤器把连字符当下划线，故报 0/3；更正以可重算的原文 `X1-transcript.json` 为准。 |
| X2 ★ | **过（单测）**：NODE 的一万字卡拒绝、无注入。 |
| X3 ★ | **过（两实例单测）**：NODE 两实例共用文件、下一次派活读新卡。 |
| X4 ★ | **没测**：没有真实模型的只读/可写角色分别处理带指令的隔离资料的执行和前后文件证据。不能用规定好回答的模拟模型打安全行为分。 |
| X5 | **过（机制）**：NODE 禁止联网 fetch，角色仍可列可选模型；LIVE 无外部模型请求。 |
| P1 ★ | **没测**：没有 Windows 正式候选安装和真桌面界面截图（CI Chrome fixture 不等于 App）。 |
| P2 ★ | **没测**：候选 Mac 检查取消，无 Mac 包运行时快照。 |
| P3 | **过（草稿）**：`RELEASE-NOTES-DRAFT.md` 包含角色派活、看板、自定义卡保护和草稿确认。 |
| P4 ★ | **合并条件未达成**：用户同意「验收通过后」合并。当前没有无条件授权，且多个必过项未过，所以保持草稿，不发布。 |

## 交回执行者的问题

| 严重程度 | 位置 | 复现与建议 |
|---|---|---|
| 阻塞 | Z1、两条平台链 | GATE 与候选、主线两次真实 CI 的失败同项对照。先清理主线已有的学习 UI Windows 失败，给通用 job 可用 apt 依赖；在同一候选完整跑 Win/Mac。不要增大已知失败表或把跳过当过。 |
| 阻塞 | Z3a / Z3d / Z4 原基准 | SNAP、`git diff 1d83ad3b ... -- personas` 和 Z3d 测试文件。重基后主线已有差异；请明确用哪个基准签字，保留两份结果。未经批准不按新口径自动签过。 |
| 阻塞 | R1 实测、R2、R3、R5、X4 | 候选的离线计划与本地模拟不是模型效果。按已授权范围、在可用模型池重跑，保存两侧厂商和原始记录；重点补 R1-17、R2 择六、R3 分层十题，以及顶档流程与对抗。 |
| 阻塞 | R4-4、P1、P2 | `windows-build=skipped`、`macos-check=cancelled`、工件零。交付与候选 SHA 对应的 Windows 包：隔离新装/上一正式版升级/桌面截图；Mac 交实际 App 运行时快照。 |
| 阻塞 | R3-4、R3-6：`researcher.md:12,20`、`samples/researcher.json:19`；`samples/visual-designer.json:17,36` | 对读卡和 PLAN §4，把单来源移到未证实项，不计为核实结论，样题同改。视觉样题要求交回可比布局表和对应图，并预先列出必须在哪两个维度不同，避免临时判断「本质不同」。 |
| 重要 | `visual-designer.md:15` | 将「无 AI 模板味」改成可核的布局/视觉条件，再交独立评分。 |
| 次要 | R1-18 工作区清单 | LIVE 后实际多 `openclaw-workspace-state.json`。是上游元数据，不建议为过验收删除运行状态；明确是否接受该文件例外。 |

**总判定：候选 `afcb2386` 不通过；阻塞为 Z1 全量红、Z3/Z4 原基准差异、R3 卡与样题标准未满足、真实模型及异厂评分证据不齐、Windows/Mac 正式安装及快照缺失。保持草稿，不合并主线。**
