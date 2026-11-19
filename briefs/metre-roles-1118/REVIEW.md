# Metre 角色 agent · 分阶段验收

验收日期：2026-11-19（Windows）。验收候选：`68e4ef35`，本地 `integration/metre-roles-1118-on-main`。归因以角色改动前的当前主线 `14037f66` 为基线，同时保留原计划基线 `1d83ad3b` 的严格对照。此次只核验、记报告，未改产品代码、未推送、未合并。修复与验收在同一对话，但以下以我亲自重跑的产物为准，不把执行进度当成证据。

## 阶段结论

| 阶段 | 结论 | 主要证据 |
|---|---|---|
| 1. 共通门槛和机制（Z、R0、R1、X） | **局部通过，未通过整阶段** | 真网关能列出、派发用户卡，故意断流后同一子会话完成读取，父会话与看板各有一次成功交回；正式环境没动；全量门禁仍红，另有侧栏截图、固定输入和全停等证据缺口。 |
| 2. 角色卡、安装、看板、文档（R3、R4） | **静态卡和安装子项已核验，未通过整阶段** | 33 张卡、66 道题静态结果齐；用户卡保护、官方卡备份、三张看板样图及文档通过。自长卡没有实现；正式 Windows/Mac 包和模型样题没有验完。 |
| 3. 真模型、发布（R2、R5、P） | **未进入发布签字** | 此轮 0 次真实模型调用，未补跑 48 次或改口径；未用免费模型代顶档，未请求合并。 |

证据根目录：`F:/Projects/metre-roles-review-evidence-1119`。下面的日志文件名相对于该目录。网关运行记录位于 `metre-mock-1795084674886726000/`，不是正式目录。所有命令在候选工作树下运行，明确注明基线时例外。片段只保留核验需要，不贴注入源文或认证数据。

### 重放命令索引

- **GATE**：`node tools/release-gate/run-tests.mjs --jobs 4`（未用 `--update`）。`Z1-gate.txt`；`python -B -X utf8 F:/Projects/metre-roles-review-evidence-1119/z1-recheck.py F:/Projects/metre-roles-review-evidence-1119` 单文件复查，结果 `Z1-recheck.tsv`。
- **NODE**：`node --test --test-concurrency=1 tests/metre-roles.test.mjs tests/session-lineage.test.mjs tests/metre-dispatch.test.mjs tests/metre-board.test.mjs tests/metre-role-navigation.test.cjs tests/sidebar-mode-isolation.test.mjs tests/reasoning-enhance.test.mjs` → `focused-node.txt`。
- **PKG**：`python -B -X utf8 -m unittest discover -s tests -p <文件名>`，分别运行 `metre_roles_install_test.py`、`windows_mode_agents_test.py`、`persona_bundle_test.py`、`mode_architecture_setup_test.py`、`macos_bundled_setup_test.py`；各有同名 .txt。
- **SNAP**：`node tools/metre/inject-inventory.mjs --verify-baseline briefs/metre-roles-1118/main-inject-baseline.json`；细节见 `Z3-current-main.json`。换 `legacy-inject-baseline.json` 得严格旧基线 `Z3-original.json`；`node tools/metre/inject-inventory.mjs metre --json` 得 `R1-28-injection.json`。
- **LIVE**：`python -B -X utf8 F:/Projects/metre-roles-review-evidence-1119/gateway-review.py`，选回环临时端口、只复用已有隔离 runtime 文件、使用纯本地模拟模型。第一次配置校验 45 秒超时，没有启动网关；第二次配置和冒烟皆通过。第二次先用真实 `pinkie_roles` 列出用户卡，再派一次；合格/不合格 34/1，`returned=1`、`failed=0`、角色行 `roleSource=user / reports=1`；只读取一份测试素材。发模型 HTTP 全部是本机模拟；`requests.json` 为 `forwarded=0`、`dispatch=1`、`listed=1`、`watchdogChild=1`、`readCalls=1`、`responses=1`。留有 `board-1.txt`、`cards.txt`、`listed-custom-card.txt` 和 `gateway.log`。
- **CARDS**：`node tools/metre/roles/lint-cards.mjs --all-33 --samples --json`；独立对照计划表 `python -B -X utf8 F:/Projects/metre-roles-review-evidence-1119/card-plan-check.py`，输出 `R3-compare.json`。以及 `node tools/metre/roles/lint-cards.mjs --json F:/Projects/metre-roles-review-evidence-1119/copy-check/backend-fix.md`。
- **DIFF**：`git diff 14037f66..68e4ef35`；按需补路径，如 `-- personas`、`-- ui/injections/laolao-metre-board.css`、`-- tests/session-lineage.test.mjs tests/metre-dispatch.test.mjs tools/release-gate/known-failures.json`。

## 通用门槛和 R0

| 编号 | 判定 | 我核对的证据或没测原因 |
|---|---|---|
| Z1 ★ | **没过** | GATE 退出 1：266 个测试文件、79 个失败项、34 个未列为已知的失败、8 个已知项未匹配；未改已知失败清单。对 22 个涉及文件分别在候选、主线、原基线上重跑（66 条，缺文件/超时单列）。确认候选独有的 `session-cross-mode-ui` 断言回归（见阻塞表，未断定实际 UI 退化）。`metre-lock` 两条在当前主线同样失败；`computer`、`reasoning-enhance` 有基线失败。PKG 的安装、Windows mode、persona bundle 分别 2/2、19/19、3/3；mode setup 12/13、Mac shell fixture 2/8；后二者在此 Windows 的当前主线失败集合一致，不是 Mac 实机验收。 |
| Z2 ★ | **过** | 开工和收工只读记录一致：正式配置 UTC 2026-11-14T07:50:37.9293033Z；App 目录 UTC 2026-11-03T22:57:22.1522954Z；18789 监听 PID 无。 |
| Z3a ★ | **过（当前主线）/ 严格旧快照有差异** | SNAP：5 模式 × 3 条，与当前主线一致，`diffs=[]`；仅归一已知 profile 路径，原始总哈希不同。原档直接对比 `diffs=19`，主线上已有改动，不把这个结果说成相对 `1d83ad3b` 逐字一致。 |
| Z3b ★ | **过（当前主线）** | 两个独立新测试 profile，用完全相同五个 agent 的种子设置调用两版安装器，归一各自工作区目录，`Z3-agent-config.txt` 五项均 `true`。 |
| Z3c ★ | **过（当前主线）** | SNAP 同时核对五套 `pinkie_session_start`/ `pinkie_mode_ask` 快照，无角色参数、用词差异。 |
| Z3d ★ | **没过** | 旧血缘、派活测试文件没改且针对性测试通过，但全部旧测试没有全绿（Z1），跨模式卡片有候选独有的源代码断言失败。 |
| Z3e ★ | **没测** | 本轮未用真实模型逐个复查五个模式回答和口吻；之前车道的截图不是这次独立验收。Z3 整体不能记过。 |
| Z4 ★ | **过（按重基后的主线归因）** | DIFF 排除角色目录后只有计划允许的 Metre 第七节和 R4 明文要求的 `personas/README.md` 文档；五个旧模式的人设和 playbooks 无差异。原基线到主线的历史变更另列，不算本候选产生。 |
| Z5 | **没过** | 车道分支已有推送，本地最新集成候选未推到总分支；本次验收未发布、未合并。 |
| Z6 ★ | **过** | LIVE 捕获 5 份角色请求，均核对有角色卡；7 份无限制提示各挑 5 段 30 字原文，仅记录样段哈希，35 段全未命中，`OPENCLAW_UR_INJECT=0`。重放后执行 `python -B -X utf8 F:/Projects/metre-roles-review-evidence-1119/z6.py F:/Projects/metre-roles-review-evidence-1119`（运行脚本中路径指向该次捕获目录）；`Z6-capture-scan.json`。 |
| Z7 | **没测** | 旧车道有第一轮记录；本轮没有把四题重跑两次，不追加模型调用。 |
| R0-1 ★ | **过** | MEASURE 四组输入/路径/usage 均列出；亲自读原 `F:/碧琪实测/iso-roles/home/.openclaw/agents/roles/sessions/4d082840-8de9-4d59-a6a8-e9a383782d35.jsonl` 中 assistant.usage：`14480 + 0 = 14480`。 |
| R0-2 ★ | **没过（按字面规则）** | `R0-R1-readiness.txt`：四份原抓包工具数 52/58/53/22，并集 58，表 58，未漏名；但表有多项「非六类 / 禁用」，不符合每个工具都归六类之一。应明确是否接受「内部禁用」作为例外，不能直接算过。 |
| R0-3 ★ | **过** | `git show -s d58d37e2 ebe8f299`：前者存原档，后者才提交 MEASURE；MEASURE 第三节有基准和哈希。 |
| R0-4 | **过（检查留档）** | MEASURE 第四节和工作交接记载原始 14.60GB 时先停、补空间后启动；本次独立检查 F: 26.66GiB，C: 不到 1GiB，测试文件置 F:，未删备份。 |
| R0-5 | **过** | 按复算的 14,480 ≤ 30,000，R0 的「继续做」结论成立；不代表当前成品三角色固定输入已过。 |

## R1 · 机制

| 编号 | 判定 | 证据或没测原因 |
|---|---|---|
| R1-1 ★ | **过** | NODE 卡校验用例细读并重跑，各必填字段、坏格式、大小、路径、降级、覆盖与重载通过。 |
| R1-2 ★ | **过** | CARDS 全部通过；我从 debugging 手册复制 48 字进外部 fixture，退出 1：`正文存在与 playbooks/debugging.md 连续 40 字以上完全相同的片段`。 |
| R1-3 | **过** | NODE 确认坏卡不进 enum、工具报告原因；LIVE 条目 `bad-review.md`、34 合格/1 不合格，报告缺元数据分隔。 |
| R1-4 ★ | **过** | NODE 断言角色派发、忽略 mode、来源、64 字符 SHA-256；LIVE `session-lineage.json`、`board-1.txt` 真实 `agent:roles:pinkie-child:`。 |
| R1-5 ★ | **过** | NODE 按无角色仍要求 mode、原血缘及派活测试通过；DIFF 两个测试文件未改。 |
| R1-6 ★ | **过** | NODE 模式参数、提示、旧模式工具无角色；`mode:roles` 被拒。 |
| R1-7 | **过** | NODE 找不到角色时报错并返回可用角色。 |
| R1-8 ★ | **没测（固定输入）** | 33 张官方段实测 594 字；再加 40 张用户卡 585 字并提示「还有 6 张官方与 40 张自定义角色」，见 `R1-tool-budget.txt`；当前候选对比原版的真实固定输入 ≤+1k 未跑，旧车道结果不替代。 |
| R1-9 | **过** | NODE 列表、详情、独做收起和老模式不可见；LIVE 真网关列表中出现用户卡及来源。 |
| R1-10 | **过（机制测试）** | NODE 角色版咨询通过实际 lineage 模块走 roles、返回给提问方，不绕过角色工具限制。 |
| R1-11 ★ | **过** | NODE 关闭后 role/of/工具消失，与当前主线不启用时的快照相同。 |
| R1-12 ★ | **过** | NODE 比较注入 1/2/3 轮及首简报，LIVE 捕获也有角色卡。 |
| R1-13 ★ | **过** | NODE 手工触发压缩 hook 后第一轮仍含卡；验收明许用单测。 |
| R1-14 ★ | **过** | NODE 改文件后旧会话仍用旧快照、新会话哈希更新。 |
| R1-15 ★ | **过** | NODE 注入禁词与边界检查；`ROLES_BASE` 295 字。比的是插件注入，不把网关协议或工具声明算人设。 |
| R1-16 ★ | **没测** | NODE 模式/侧栏路由、角色名和点击 key 断言通过；缺真正 App 模式菜单和侧栏浅/深两图。R1-27 的看板不是这两张。 |
| R1-17 ★ | **没测** | 当前候选未采三种卡的真实 usage；模拟模型 token 不能作为实测。 |
| R1-18 | **没过（严格文件清单）** | 逐文件比对 playbooks 和视觉规范一致，无 memory/，无新增人设；真实跑一轮后 OpenClaw 写出 `openclaw-workspace-state.json` 并移除空 BOOTSTRAP，占位人设未被重写。严格「只有计划文件」不满足；需确认是否允许上游元数据。 |
| R1-19 | **没测** | 本轮 LIVE 走只读卡，没跑允许写/执行的角色，无确认弹窗的行为不能据此判定。 |
| R1-20 ★ | **过（已实捕范围）** | NODE 对内置清单断言；LIVE 实捕 14 个不同工具名逐个对照映射，加假工具明确失败，见 `R1-tool-budget.txt`。R0-2 的历史表口径缺口另记。 |
| R1-21 ★ | **过（机制测试）** | NODE 按 researcher 卡逐字验证 write/exec 被拒的原因，不执行命令。 |
| R1-22 ★ | **过（机制测试）** | NODE 的命令前缀及词边界断言重跑通过；不在任何真实仓库执行这些命令。 |
| R1-23 | **过（机制测试）** | NODE 使用临时文件验证只读卡审计列出文件，并写入实际报告卡片正文。 |
| R1-24 ★ | **过** | NODE 五个选模条件、健康排序、缺项错误。 |
| R1-25 ★ | **过** | NODE 14 个厂家样例、不同前缀和跨厂检查、无 of 的提醒。 |
| R1-26 | **过（汇报功能）** | 用实际 `SessionLineage.report` 复查，`R1-26-report-check.txt` 缺 3 段逐项提醒，完整回复一字未加；LIVE 完整汇报入父会话。定向交付门禁用例通过；全项目门禁仍看 Z1。 |
| R1-27 | **过** | 目检浅色、深色、700×1440 三张存档：角色名+模型、自定义和张数、展开原因可见；真实 LIVE RPC 返回对应字段；CSS 新增只引用现有变量，无新色值。三张图为 fixture，不冒充 App 截图。 |
| R1-28 ★ | **过** | DIFF 仅第七节规定句与第 6 条压缩；SNAP 实测 6,498 ≤ 6,500。 |
| R1-29 ★ | **没测（15 秒实测）** | NODE 上限/计数/全停通过；这次隔离实测未同时启动多个角色测 15 秒。 |
| R1-30 | **过** | NODE 确认角色没有项目记忆工具、提示和文件；LIVE 角色工作区无 memory/。 |
| R1-31 | **没过** | 角色数据独立于极致思考；但 NODE 的 `reasoning-enhance` 旧验收提示用例未全绿，两个基线均复现；不为此放宽。 |

## R2 · 模型对照

| 编号 | 判定 | 理由 |
|---|---|---|
| R2-1 ★ | **没测** | 没做 48 轮；按降额约定不擅自启动。 |
| R2-2 ★ | **没测** | 无三组相同简报及相同模型的原始记录；当前仓库也没有计划指明的 `tools/metre/roles/compose.mjs`（`git ls-files -- tools/metre/roles/compose.mjs` 为空）。 |
| R2-3 ★ | **没测** | 原统计口径四条无完整输入，不能从一次冒烟或静态 token 推断。 |
| R2-4 ★ | **没测** | 不足六条和三组可用原始会话，不进行重新判分。 |
| R2-5 ★ | **没测** | reviewer 两题均有 3 处预埋问题，未进行异厂评分的运行。 |

## R3 · 卡和样题

| 编号 | 判定 | 证据或原因 |
|---|---|---|
| R3-1 ★ | **过** | 独立解析 PLAN：33 个 ID 与文件名集合完全相同，无导员。 |
| R3-2 ★ | **过** | CARDS 自跑，33 张格式和不抄手册检查通过。 |
| R3-3 ★ | **过** | `R3-compare.json` 独立对照计划表：档/看图/工具及 review、deny_commands 差异 0。 |
| R3-4 ★ | **过（卡正文静态）** | 逐张对照 PLAN「必须做到」「交回要带」，见下表。不是运行质量验收。 |
| R3-5 ★ | **过（卡正文静态）** | 下表依次为可检查/证据/边界/篇幅/无套话/无主 MD 冲突；静态得分不替代真实任务。 |
| R3-6 ★ | **过（题面静态）** | 66 题、309 条 checks；全部有简报、夹具、验证项，检查项含输出、路径、报告段落、命令行为或具体边界；对非客观高风险措辞扫描 0。 |
| R3-7 ★ | **没测** | 没有全 66 题通过记录；未新增 10 道真实样题重跑。 |
| R3-8 ★ | **没测** | 静态 5 张 × 2 题，每题都有 3 个 planted_issues；未测真实运行的 2/3 和 0 误报。 |
| R3-9 ★ | **过** | CARDS 和独立元数据对照均确认列出的 10 张只读卡不含 write。 |

### R3-4/5 逐张静态核对

下表的「✓」只指正文列出了要求；输出是否真做到另由 R3-7/8 检查。4 分表示仍需人工判断或严格依赖给定边界，未发现缺项。

| 卡 | 核对记录 | 六项分 |
|---|---|---|
| feature-dev | ✓ 项目约定、验收、测试原文和未覆盖项 | 5/5/5/5/5/5 |
| frontend-fix | ✓ 复现截图、桌面/375、根因和控制台 | 5/5/5/4/5/5 |
| backend-fix | ✓ 样板卡，修前红修后绿；文件和行号 | 5/5/5/5/5/5 |
| test-engineer | ✓ 只改测试、反例、发现代码问题只报 | 5/5/5/4/5/5 |
| code-reviewer | ✓ 现场核实、严重程度、场景、改法、已查范围 | 5/5/5/4/5/5 |
| refactor | ✓ 同组测试两跑、不改接口、行为与改动统计 | 5/5/5/5/5/5 |
| perf-tuner | ✓ 同条件至少三次、数字与命令、没变快撤回 | 5/5/5/5/5/5 |
| security-auditor | ✓ 只读排查、依赖清单、打码、证据和修法 | 5/5/5/4/5/5 |
| upgrader | ✓ 一次一个、按步骤升级/检查/回退 | 5/5/5/5/5/5 |
| plan-executor | ✓ 不跳步、逐项证据、发现不符先停 | 5/5/5/5/5/5 |
| batch-runner | ✓ 前三试跑、备份、CSV、熔断及断点 | 5/5/5/5/5/5 |
| env-setup | ✓ 用户空间、镜像、账本、版本验证和卸载 | 5/5/5/4/5/5 |
| automation-builder | ✓ dry run、真跑、日志和撤回 | 5/5/5/5/5/5 |
| release-prep | ✓ 本地包、摘要和哈希、对外操作只列命令 | 5/5/5/5/5/5 |
| web-operator | ✓ 逐步截图、登录停手、授权对象与提交限制 | 5/5/5/4/5/5 |
| researcher | ✓ 两条独立出处、日期、矛盾、不确定 | 5/5/5/5/5/5 |
| deep-reader | ✓ 逐份读、行页码和未读范围 | 5/5/5/5/5/5 |
| domain-expert | ✓ 权威出处、地区日期、确定/推断/未知 | 4/5/5/5/5/5 |
| advisor | ✓ 2–3 个真实不同的方案、四维、反转条件 | 4/5/5/5/5/5 |
| data-analyst | ✓ 逐行口径、脚本复跑、对账与图 | 5/5/5/4/5/5 |
| competitor-analyst | ✓ 功能价格定位、一手出处和截图 | 5/5/5/5/5/5 |
| visual-designer | ✓ 多方向、实际渲染、目标尺寸和可读性 | 4/5/5/4/5/5 |
| ui-replicator | ✓ 多宽度明暗并排、具体像素/颜色 | 5/5/5/4/5/5 |
| viral-creator | ✓ 按平台、首句/前两秒、多个角度、反刷量 | 4/5/5/4/5/5 |
| writer | ✓ 提纲、±10%、来源、文件 | 4/5/5/5/5/5 |
| editor | ✓ 改前改后理由、事实标待核、不改文风 | 4/5/5/5/5/5 |
| translator | ✓ 术语、本地化、保格式、三段回译 | 5/5/5/4/5/5 |
| doc-maker | ✓ 按手册、逐页实际渲染和结论标题 | 5/5/5/4/5/5 |
| motion-video | ✓ 配音、低清、逐帧、-14 LUFS 和空间块 | 5/5/5/4/5/5 |
| modeler-3d | ✓ GLB、四视角、面数和授权 | 5/5/5/4/5/5 |
| reviewer | ✓ 逐条判分、自己核验、只挑不改；跨厂元数据 | 5/5/5/4/5/5 |
| fact-checker | ✓ 数字、引语、逐条出处；跨厂元数据 | 5/5/5/5/5/5 |
| qa-tester | ✓ 主流程、六类边界、截图和复现 | 5/5/5/4/5/5 |

## R4 / R5 / X / 发布

| 编号 | 判定 | 证据或没测原因 |
|---|---|---|
| R4-1 ★ | **过（安装入口＋隔离网关）** | LIVE 新 ID `review-probe` 实际列出、派发、回报，`roleSource=user`；重装同一 profile 用户文件字节和 mtime 不变。PKG 升级 fixture 独立用版差验证用户卡不变，正式包另看 R4-4。 |
| R4-2 ★ | **过（安装入口）** | PKG `test_role_assets_install_reinstall_and_upgrade_without_touching_user_cards` 核对旧内容与退休卡字节进入同一个备份目录、重装不生成多余备份。 |
| R4-3 ★ | **没过：缺实现** | `registerMetreRolesTool` 的实际工具参数只有 id，说明和执行都只列/读卡；没有 draft 路径、第三次提示、采用/不要或相应实测。复查 `rg -n 'draft|第 3 次' services/mode-architecture/session-lineage.mjs services/mode-architecture/metre-roles.mjs ui/injections/laolao-session-cards.js`。 |
| R4-4 ★ | **没测** | 候选实际源安装成功，但未用正式 Windows 安装包做新装和上个版本升级；没有 Mac 运行时快照。Windows 的 Mac 壳 fixture 不算实机。 |
| R4-5 | **过** | docs/METRE-MODE.md、personas/README.md、RELEASE-NOTES-DRAFT.md 三份都在。核对五项：角色专属入口（lineage 注册）、不另设用户模式（mode switcher）、用户覆盖且坏卡不派（loader）、旧版/退役卡备份（metre_role_assets.py）、看板标记/张数（board & injection）。 |
| R5（七题） | **没测** | 目前没有在授权范围内验证可用顶档模型，不以免费或模拟模型替代，不跑额外模型调用。 |
| X1 ★ | **没测（真网关）** | NODE 的非法角色名拒绝链通过；未在独立真网关送全部非法输入。 |
| X2 ★ | **过（单测）** | NODE 用超大卡 fixture，判无效，不进入可选/可注入卡。 |
| X3 ★ | **过（双实例 fixture）** | NODE 两实例共享文件，修改后新派活得到新版本；进行中的旧快照不变。 |
| X4 ★ | **没测（真模型）** | 不把早期别的提交证据或模拟回复当当前候选的模型安全实测。 |
| X5 | **过（断网单测）** | NODE 注入禁止联网的 fetch 后，列表和模型选择照样工作；LIVE 本轮未出回环。 |
| P1 ★ | **没测** | 缺 Windows 正式包接口和真实桌面截图，不以源码安装或看板 fixture 代替。 |
| P2 ★ | **没测** | 需要 Mac 运行时快照。 |
| P3 | **过** | 更新说明草稿包含角色派活、看板及保护自定义卡。 |
| P4 ★ | **没过** | 授权做验收不是授权合并；本次没有推送或合并。 |

## 交回执行者的问题

| 严重程度 | 位置与现象 | 如何复现 / 建议 |
|---|---|---|
| 阻塞 | R4-3：自长卡未实现。 | 检查 `registerMetreRolesTool` schema 仅 id；先实现计划 3.12 的第三次提示、草稿校验及用户确认，再测生效前不可派。 |
| 阻塞 | Z1：旧跨模式汇报卡片的源代码断言在候选新失败，主线同断言过。 | 两个工作树分别运行 `node --test tests/session-cross-mode-ui.test.cjs`。候选报 `the card names the other mode`；保留旧卡片分支及既有测试，增加角色分支的行为断言，不能直接忽略失败。另一条老缓存名断言在两个基线也失败。 |
| 阻塞 | R1-16/17/29、R2、R3-7/8、R4-4、X1/X4、P1/P2 证据不足。 | 先补低成本的真实桌面截图、隔离全停及平台包，再按额度授权补真模型证据；补跑只用获准模型，不替代 R5 顶档。 |
| 重要 | R0-2 表用「非六类 / 禁用」口径；R1-18 实际运行多了上游元数据文件；R2 缺 compose 脚本。 | 分别确认是否批准这两个计划例外（或修正实现/清单），并先补同简报 A/B/C 驱动后再消耗模型额度。 |
| 重要 | PLAN 3.9 原写「交付真实性门禁一行不改」。现为修只读任务误判，已限定在角色简报去掉固定头；不是放开门禁。 | 同步此计划偏差的验收口径；核对 `R1-26-report-check.txt` 与 NODE 的「没有读取 / 只读冒充写入仍失败」两条边界。 |

**总结论：阶段性机制、看板、用户卡和安装入口已取得有效证据；候选整体验收未通过，暂不建议合并。阻塞为 R4-3 缺实现、Z1 候选回归及上表未完成的必过证据；R5 单独记没测。**
