# Metre 角色 agent · 接力记录

先读 `PLAN.md` 第八节「接手规矩」。每做完一步，在这里补一行状态，并在下面加一节记录：做了什么、怎么验证的、`ACCEPTANCE.md` 对应条目的自查结果（过 / 没过 / 没测和原因）。

| 批 | 状态 | 谁在做 | 更新日期 | 提交 |
|---|---|---|---|---|
| R0 量和清点 | 原始测量与基线已汇入，补齐 58 工具分类；待验收 | 执行 | 2026-11-19 | `d58d37e2`、`ebe8f299`、`9b5453b3` |
| R1 机制 + 4 张试点卡 | 机制已合入候选，定向测试过，完整门禁及实测项未全过 | 执行 | 2026-11-19 | `9b5453b3` |
| R2 试点对比 | 已准备 48 条待跑计划；完整实跑和异厂复判没测 | 执行 | 2026-11-19 | `9b5453b3` |
| R3 余下 29 张卡 | 33 卡／66 题静态检查过；真模型题和独立评分没测 | 执行 | 2026-11-19 | `9b5453b3` |
| R4 用户卡、自长卡、安装更新、文档 | 权限、启用和安装夹具验证完成；正式包和 Mac 待验 | 执行 | 2026-11-19 | `9b5453b3` |
| R5 Metre 真实流程 | 没测；保持原模型额度，不用本地模拟或免费模型代替顶档 | | 2026-11-19 | |

## 待用户定

- 用户已确认保持此前模型限制，先交验收候选。未补足 `ACCEPTANCE.md` 的合并条件，不合进 `main`；同意「验收通过再合并」不是越过未通过项目的许可。

## 11-19 执行收尾 · 候选，非验收签字

- 在最新可见的 `origin/main=99c3716a` 上重放本地整合 `fc525a6e`，解两处冲突时保留新 `dispatchFor` 和侧栏主线的状态、日期、点击逻辑。`85cf2a76` 保留已上交的独立 [REVIEW.md](REVIEW.md) 原件：它的审查对象仍是 `9dba1a4c`，不拿那份报告当本候选的验收。
- `9b5453b3`：恢复旧跨模式卡片的模式名、更新变动资源的缓存版本；新增角色侧栏测试保留主线状态，未改 `session-cross-mode-ui.test.cjs`、`session-lineage.test.mjs`、`metre-dispatch.test.mjs`。安装重复执行原会在第二次才补 Metre 空文件，修正为在第一次按正确顺序创建；旧安装断言原样重跑。
- PLAN 3.12：成功派出的无角色任务按父会话绑定项目和种类，滚动 14 天第 3 次提示，重复派发不累计。`pinkie_roles` 只负责校验、暂存；同会话的用户决定 RPC 才能采用／丢弃。校验失败不落盘，待采用文件不进角色枚举，不覆盖已有自定义卡，草稿变更/角色开关关闭/Metre 锁定都不能误启。待审批的角色派活提案也不能绕过关闭开关。
- `of` 指向不存在、不同父会话或认不出厂家的记录时拒绝。显式选了认不出厂家的复核模型也拒绝；优先用实际回复的模型元数据，遇到没有元数据的记录不会为正式验收伪造厂商凭证。
- `compose.mjs --matrix <已授权的子会话模型 ID>` 准备 8 题 × 3 组 × 2 次，同题每组使用同简报哈希、同执行模型；输出 `prepared-not-run`。实跑要从干净夹具开始，两侧实际模型厂家确认不同才判分。本次外部模型调用 **0**。

### 复跑证据

记录根目录（执行机本地）：`C:/Users/34786/Documents/Codex/2026-11-19/origin-feat-metre-roles-1118-briefs/work/finish-20261119-113345`。只提交源码和说明，不提交模型请求、测试状态或凭据。

| 条目 | 执行自查（不代替独立验收） |
|---|---|
| Z1 | **没过**。`node tools/release-gate/run-tests.mjs --jobs 4`：候选 `270 test files, 44 failing tests, 53 known`，当前主线 `267 test files, 44 failing tests, 53 known`，均退出 1；失败/已知项状态原文逐项相同（`gate-serial-check/`）。之前 16 并发时 14 个涉及文件单文件对照结果一致：`session-search` 单跑两端皆过；候选一次并行另见 10ms 的 `stop-and-archive` 超时，该函数与主线字节一致，目标和主线各单文件重跑 5 次每次 40/40。仍不宣称总门禁过。 `known-failures.json` 与 `99c3716a` 未变。Windows 源码安装 Python：模式安装 13/13、角色安装 2/2、Windows agent 19/19、打包加载夹具 2/2、人设 2 过 1 跳过；Mac shell 夹具在 Windows 2 过 6 跳过，不当作 Mac 实测。 |
| Z2 | **过（非正式环境）**：`Z2-before.json` / `Z2-after.json` 两次 UTC `11/19/2026 11:33:46` / `11/19/2026 12:12:27`，配置修改时间 `11/14/2026 07:50:37`、App 修改时间 `11/03/2026 22:57:22`，18789 两次无监听。 正式 `openclaw.json`、正式 App 安装目录、18789 监听 PID 只读记录；未安装正式 App、未起用正式网关。 |
| Z3a–d / Z4 | `z3/Z3.json`：`99c3716a` 和候选的五模式 × 3 条注入、工具说明/参数，重跑在相同环境逐字一致；整体 SHA-256 `18891994f8751d2a328fa6c9ddceb5e45131d2c5bf556e971d84ec44da0a2dc3`，五项隔离配置一致。旧档仍保留：与原 `1d83ad3b` 的历史快照不是全等，不能把当前主线比对替代字面 Z3a；旧完整测试见 Z1。与当前主线相比，角色目录外只改 `personas/metre/AGENTS.md` 第七节和 R4 要求的 `personas/README.md`，其他 persona、playbooks 没动。 |
| Z3e / Z7 | 没测。没有五个旧模式各一轮真实模型口吻，以及 S2/S5/S7/S9 两轮新对照。 |
| Z5 | 以 Git 远端对象为准；此候选保留独立报告历史，交 `feat/metre-roles-1118`，未合进 `feat/metre-mode-1113` 或 `main`。 |
| Z6 | **过（隔离链路子项）**。`isolated-gateway-final/result.json`：草稿采用前不可派，采用后文件字节一致，角色真实读取夹具并回报，丢弃无留档；0 外部模型请求。抓 2 份完整 request 各检查 7 个文件×5 段原文和 `OPENCLAW_UR_INJECT`，0 命中。请求 SHA-256：`87bd9b04eb6f1095e09590f757c25ca4c2f278388d993949b36054ca02a083b0`、`19305ee1be9863a6f78ccf0a1391742a42a8d3ddace54c859fa2a72034ae5bff`；实捕 14 个唯一工具都可归类。 命令：`python -B -X utf8 tools/metre/roles/smoke-isolated.py --runtime-root <已有隔离运行时> --out <空证据目录>`。这是真网关、模拟模型；只验传输和注入，不验模型质量。 |
| R0-1–5 | 旧四组 usage、入口文件、时间和原 Git 顺序见 [MEASURE.md](MEASURE.md)。此次按原输入清点 58 工具，分类和禁止开关独立检查；没有重造旧测量。此轮开始 F 盘 28,837,199,872 字节，超过门槛，未删备份。 |
| R1-1–7、9–15、20–26、28、30–31 / X1–3、X5 | `focus-final.txt` 定向 Node 110/110。重跑读卡、未知卡/禁用、版本快照、旧模式无 `role`、用户卡覆盖、角色拦截、厂商/选模、每轮注入、压缩，旧跨模式断言通过。X1 为工具和参数单测，不把它记作真实网关上三种输入都已归档；X2/X3 和离线走单测。R1-20 禁用的工具也有明确类别，类别始终不放开禁用。R1-31 的全量套件不等于这些定向测试。 |
| R1-8、16–19、27、29 | 主 MD 加注入实测 6,498 字（`candidate-metre-inventory.json`），角色导航、运行状态、看板和全停机制有定向测试；当前候选仍缺三角色真实 usage、同口径 Metre 增量、实际 App 深浅侧栏与菜单、真实 15 秒全停计时及执行/写入无确认。R1-18 实跑后另有上游 `openclaw-workspace-state.json`，没有 `memory/` 或新生成的人设；不算严格文件清单全过。Windows Chrome 的三条 E2E 在候选与 `main` 均未能启动，不冒充真实 App。 |
| R2-1–5 | 没测：仅有 48 条离线计划。没有完整使用同一子模型的原始会话、有证据的四项门槛或另一厂家做的 6 条复判。 |
| R3-1–4、6、9 | `node tools/metre/roles/lint-cards.mjs --all-33 --samples`：33/33；33 个样题文件含 66 题，符合静态格式。角色正文的逐卡独立核对和六项判分不能由执行者签字。 |
| R3-5、7–8 | 没测独立六项评分、66 题实跑、10 题分层抽测及审查题的真实召回/误报；不把预埋问题的存在当作模型找出来了。 |
| R4-1–3、5 | 用户/草稿目录保护和官方备份用磁盘、源安装单测；起草、采用前拒派、采用后回报、丢弃另有隔离网关证据见 Z6，三份操作文档更新。 |
| R4-4 / P1–2 | 没测 Windows 正式包的新装、上一版升级及实际桌面截图，也无打好包的 Mac 真机快照。上述临时配置或导入测试不替代。 |
| R5 / X4 | 没测真实模型。纯本地模拟不用于 R5、角色越权的模型行为验收或评分。 |
| P3–4 | 更新稿已写；用户同意在独立验收通过后合并。合并条件未达到，不做合并和发布。 |

复跑定向 Node：`node --test --test-reporter=tap --test-concurrency=1 tests/metre-roles.test.mjs tests/metre-role-pilot.test.mjs tests/metre-role-navigation.test.cjs tests/session-cross-mode-ui.test.cjs tests/metre-dispatch.test.mjs tests/session-lineage.test.mjs tests/session-hints.test.mjs tests/metre-board.test.mjs`。相关 Python 单文件用 `python -B -X utf8 -m unittest discover -s tests -p <测试文件.py> -v`。全量使用 `node tools/release-gate/run-tests.mjs --jobs <并发数>`，**未**用 `--update`。

## 11-19 复修 · 执行记录，不是独立验收

- `e4a28ec0`：调研卡和题目不准把单一来源当结论；修正 PATCH 的标准出处；视觉样题以结构、媒介等选项和原图／小图对照判定。33 卡与 66 题静态 linter 通过；未用模型判分。
- `6d7758b3`：修复 Windows 资料抽取依赖 POSIX `nice` 的问题，用不含 Git Bash 的 PATH 验证，原有资料搜索／缓存断言保留。用 Windows CI 有界并发完整重跑，原两个 Chromium 失败均恢复；[CI 44542940731](https://github.com/Cle0726/super-pinkie/actions/runs/44542940731) 中 Windows 和 macOS 检查过，Ubuntu 仍失败在旧模式跨平台快照（不是待测模型质量）。
- 用户确认以 `99c3716a` 判实际回归，并保留 `1d83ad3b` 与 R0 为历史对照。Linux CI 改为在同一 runner 使用同一量具，从固定主线重采比较输入，不覆盖历史或 Windows 归档；Windows 本机同一隔离 HOME 两端重放的 15 条及工具快照整体 SHA-256 均为 `b2db9ecccd1a2484d12756e2c10347ea787c8967a15bc87355605cd0ca89e4fe`，`diffs=[]`、路径等价替换 0 次。新 Node 定向 31 过、0 败、6 个外部资料工具依赖项跳过。
- 新增真正打包用的角色收据检查：Mac 对包内插件和 33 张卡做临时 profile 快照；Windows 工作流对真实桌面侧栏、看板、33 张卡、上一版升级与用户字节保存取证。Windows 本机 Python 的 Mac 包结构夹具 2/2（含故意缺卡拒绝）、Windows mode agent 19/19、角色安装 2/2，回环测试桩能分别发旧方式和新角色两种调用。实际发行包没有动用正式本机配置，由 CI 另跑，夹具通过不能代替桌面实测。
- 用户确认缩成 8 轮且模型都免费。此条不是任何真实轮次完成证明；需要四题 A/C 成对证据、真实 usage 和异厂免费判分。顶档流程和原扩展规模留作后续。本轮任何必过项未齐仍不合并。

## 记录

### 11-18 计划（Windows，Opus 5.5）

- 从 `origin/feat/metre-mode-1113` 的 `1d83ad3b` 切出 `feat/metre-roles-1118`，写了 `PLAN.md`、`ACCEPTANCE.md` 和这份文件，只有文档，没有改代码。
- 本机 `F:\Projects\metre-mode` 和 `origin/feat/metre-mode-1113` 已经分叉（本地多 915 个提交、少 900 个），里面还有别的会话没提交的改动。不要在那个目录上做这批活，另开工作树从 `origin/feat/metre-roles-1118` 检出。
- 写计划时 F 盘只剩约 6GB，C 盘约 7GB。用户说 Metre 收尾后会删碧琪的旧备份。R0 开工前先看磁盘。
