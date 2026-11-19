# Metre 角色 agent · 独立验收

- 日期：2026-11-19（Pacific Time）。审查对象：远端 `origin/feat/metre-roles-1118` 在开工时的 `9dba1a4c6c47238527c4fbc56f913babc496d12e`；基线：`1d83ad3b6e5001880143fea68392161897c4c1a7`。报告提交不改变被测代码。
- **结论：不通过。** 四条执行分支都已推送，但成果没有汇入指定总分支。指定分支只新增三份文档，没有角色 agent、角色卡、样题或角色测试。不能拿其他分支的可运行代码替它通过验收。
- 只引用 Git、实测日志、快照和采样原始 `usage`；`PROGRESS*.md` 只用于找证据。没有可供本轮正式抽签的 R2/R3 记录和可验收的产品构建，**没有进行模型判分**，也没有把定向单测、静态校验或执行者自评当成异厂判分。补测须记录执行与判分两侧的实际模型 ID 和厂家，先确认不同厂家再打分。
- 验收人与执行者分开：本次只增写本报告，不改产品代码、不变更验收阈值、不合并任何分支。问题见文末交接表。

## 交付去向（独立核对，不计入总分支的通过项）

`git ls-remote --heads origin 'feat/metre-roles-1118*' '*metre*role*'` 查到五条远端分支，HEAD 如下。对 `-1` 至 `-4` 分别执行 `git merge-base --is-ancestor <执行分支的远端 SHA> 9dba1a4c`，全部退出 `1`。对本机 `7334a743` 做同样的祖先检查，四条都退出 `0`。`gh pr list --repo Cle0726/super-pinkie --state all --limit 100 --json number,headRefName,baseRefName,state,title,url` 返回 26 个 PR；按源/目标分支和 Metre roles/角色标题检查，未匹配相关 PR。

| 远端执行分支 | 实际提交 | 核对到的交付 |
|---|---|---|
| `feat/metre-roles-1118-1` | `a6d2d998`（领先总分支 7 个提交） | R0 测量、旧模式注入基准；读卡、派发、每轮注入、选模及拦截机制和单测。前置归档 `d58d37e2` 早于产品实现 `d713f082`。读取原隔离会话 `4d082840-8de9-4d59-a6a8-e9a383782d35.jsonl`，`usage.input=14480`、`cacheRead=0`、`cacheWrite=0`，精简原型固定输入复算得 14,480；不是本次目标的成品测量。 |
| `feat/metre-roles-1118-2` | `5544f045`（5 个提交） | 15 张编码/执行卡、15 份样题文件（30 题）、格式/抄手册/样题校验器。 |
| `feat/metre-roles-1118-3` | `aebb3aaf`（7 个提交） | 18 张研究/内容/把关卡、18 份样题文件（36 题），把关样题含预埋问题。 |
| `feat/metre-roles-1118-4` | `882e5ce2`（5 个提交） | 角色资产安装和备份、看板、三份文档及三张看板夹具截图。截图不是正式 App 新装和升级实测。 |

本机有两份整合：`7334a743` 是原基线上的四分支合并；`fc525a6e` 是在当时的 `main`（`14037f66`）上重新整合的版本，已有本地交接和一份旧 `REVIEW.md`，并非四条提交的 Git 原样合并。未发现这两个整合提交由远端分支承载。开工时 `origin/main=99c3716a`，原 Metre 基线已在 `main`；`git rev-list --left-right --count origin/main...fc525a6e` 得 `36  9`。不能把旧本地整合版当作已对齐最新 `main` 的候选。

对 `fc525a6e` 做了只读抽检（**不是本次签字对象**）：

- `node tools/metre/roles/lint-cards.mjs --all-33 --samples --json` 退出 0：`ok: true`、`count: 33`、`globalErrors: []`，33 份双题 JSON 共 66 道。另从 `personas/project/playbooks/debugging.md` 取 48 字插入临时 `backend-fix.md`，针对该副本运行 `node tools/metre/roles/lint-cards.mjs --json <临时卡>`，退出 1：`正文存在与 playbooks/debugging.md 连续 40 字以上完全相同的片段`。这两项都是静态检查。
- `node --test --test-concurrency=1 tests/metre-roles.test.mjs tests/metre-role-navigation.test.cjs tests/metre-board.test.mjs`：`tests 26 / pass 26 / fail 0`。`python -B -X utf8 -m unittest discover -s tests -p metre_roles_install_test.py -v`：`Ran 2 tests`、`OK`。后者是临时目录安装测试，不是正式安装包。
- `node --test tests/session-cross-mode-ui.test.cjs` 在 `fc525a6e` 得 8/10，失败包括 `the card names the other mode` 与 `the changed scripts are served under new cache names`；在开工时的 `origin/main` 得 10/10，指定分支则为 8/9（旧缓存名断言红）。这是源代码断言的证据，不等于抓到真实桌面故障。
- `git show fc525a6e:services/mode-architecture/session-lineage.mjs` 中 `registerMetreRolesTool` 的工具调用只有 `{id: {type: 'string'}}`，执行只走 `rolesInfo`；未找到计划 3.12 的第三次提示、`draft` 与采用/不要流程。`git ls-tree -r fc525a6e -- tools/metre/roles/compose.mjs` 也为空。在检查的分支中没有完整 48 轮记录、66 道通过或真实平台发布证据，不能说已经做到验收可合并。

## 复现与证据索引

工作树 `target/`、`base/`、`local-candidate/`、`current-main/` 均为钉住 SHA 的隔离工作树；日志和脚本仅留本机，不把会话原文、提示原文或凭据提交到仓库。证据根目录：`C:/Users/34786/Documents/Codex/2026-11-19/origin-feat-metre-roles-1118-briefs/work/acceptance-20261119-110426`。下表日志名相对于此目录。

| 索引 | 在目标工作树的复现命令 / 观察到的输出 |
|---|---|
| **GIT** | `git diff --name-status 1d83ad3b 9dba1a4c` 只出 `A` 的 `briefs/metre-roles-1118/{ACCEPTANCE,PLAN,PROGRESS}.md`（见 `target-diff.txt`）。`git ls-tree -r --name-only 9dba1a4c -- services/mode-architecture/metre-roles.mjs personas/metre/roles tools/metre/roles briefs/metre-roles-1118/MEASURE.md` 输出为空。后面的 `R1/R2/R3/R4` 不使用旁支文件替代。 |
| **GATE** | `node tools/release-gate/run-tests.mjs`（无 `--update`）→ `Z1-gate.txt`/`Z1-gate.exit`。以同一 Node `v24.16.0`、Python `3.12.10`、临时 profile 做单文件对照；Python：`python -B -X utf8 -m unittest discover -s tests -p <文件名> -v`，Node：`node --test --test-reporter=tap tests/<文件名>`，见 `z1-related/summary.json` 与 `z1-failed/summary.json`。 |
| **HOST** | 开工/收工各 `Get-Item -LiteralPath "$HOME\.openclaw\openclaw.json", "$env:LOCALAPPDATA\Programs\SuperPinkie"` 取 `LastWriteTimeUtc`；`netstat.exe -ano -p tcp` 查本地 `:18789` 的 `LISTENING` PID，输出 `Z2-before.json`、`Z2-after.json`。 |
| **SNAP** | 用 `git show d58d37e2:tools/metre/inject-inventory.mjs` 和同提交的 `legacy-inject-baseline.json` 重跑 R0 的三样例版核对工具（目标的初版只支持单样例）。仅把临时工具的 `REPO` 指到两份工作树，不改待测代码：`python -B -X utf8 <本机 work/review-z3.py> <证据根目录>` 调 `node <r0-inventory.mjs> --save-baseline <当前快照>` 和 `--verify-baseline <历史快照>`。`z3/Z3.json`：`targetEqualsFreshBase: true`，目标和基线的 15 条注入和工具快照全等，整体哈希均 `d752478a537749a64a2e40e1b3b5fa2fd736abe7abff90c904595199932898c6`；历史快照哈希 `293054e40619ddac97fffee51571d01e3e8999c848f337f960c6998e6c003fba`。 |
| **CONFIG** | SNAP 同时在两个临时 profile 放同样的五 agent 种子（含 tools / deny / workspace / model），用各版 `services/mode-architecture/setup.py` 的 `install(Path(<临时Home>))` 实际生成配置，只把各副本自己的工作区路径前缀替换为 `<HOME>` 后比较。`z3/Z3.json` 五项 `matchesBase: true`；目标 `targetInstalledIds` 是 `main,project,thinking,learning,unrestricted`，无 `roles`。 |
| **UNIT** | `node --test tests/metre-roles.test.mjs` → `R1-target-role-test.txt`：退出 1，`Could not find 'tests/metre-roles.test.mjs'`。`node --test tests/session-lineage.test.mjs`、`node --test tests/metre-dispatch.test.mjs` 分别 38/38、16/16。`node --test tests/session-hints.test.mjs` 8/8。 |
| **MODES** | 快照两工具的 schema 中五个旧模式均没有 `role`；在目标用 `node --input-type=module` 导入 `normalizeMode` 和 `sessionHintBlock`，分别按 `chat/project/ideas/learning/none/metre` 检查 `normalizeMode('roles', {metre})` 和三类问句（派活、并行、咨询）。`R1-target-legacy-modes.txt` 6 行均 `mode=roles rejected; role-less session hints (3 prompts)`。 |
| **CARDS** | `node tools/metre/roles/lint-cards.mjs --all-33 --samples` → `R3-target-lint.txt`：退出 1，`Cannot find module '…\tools\metre\roles\lint-cards.mjs'`；GIT 确认卡和样题均 0。 |

## Z · 通用

| 编号 | 判定 | 抽核、输出 / 复现 |
|---|---|---|
| Z1 ★ | **没过** | GATE 退出 1，原文 `244 test files, 90 failing tests, 53 known`，37 条 `NEW FAILURE`（未列入清单，不等于本次引入）。将 32 个涉及文件在目标与 `1d83ad3b` 分别单文件重跑，32/32 的退出与已输出失败名一致；其中 9 个文件两边都触发单文件复跑的 18 秒上限，不能据此宣称已重现基线的 10 分钟挂起。37 条清单外失败中 36 条以单文件 TAP 复现，剩余 `mode-architecture` 用 `node --test --test-reporter=tap --test-name-pattern "computer tool discovers the complete driver surface" tests/mode-architecture.test.mjs` 定向重跑，两端均为期待 `尚未连接`、实际缺 Windows 桌面执行器（`z1-failed/*-driver-only.tap`）。仍不算门禁过。 `git rev-parse 1d83ad3b:tools/release-gate/known-failures.json 9dba1a4c:tools/release-gate/known-failures.json` 两次均 `706164d38b288e6c77851858514c1b19a72b4d22`，没有新增已知失败。六份相关 Python 单文件依次为模式安装 9/10、Windows agent 18/18、人设打包 3/3、Mac shell 夹具 2/8、Mac 打包加载夹具 1/1、签名测试导入失败 `No module named 'release_notes'`；两端坏项名称完全相同。Windows 上跑的 Mac 夹具不算 Mac 平台验收。 |
| Z2 ★ | **过** | HOST：UTC `2026-11-19T11:04:26.6588048Z` 开工与 `2026-11-19T11:27:37.0076728Z` 收工一致：配置修改时间 `2026-11-14T07:50:37.9293033Z`，App 安装目录修改时间 `2026-11-03T22:57:22.1522954Z`，`18789` 两次均没有监听 PID。 |
| Z3a ★ | **历史原始哈希没过，实测差异仅路径** | SNAP。目标 vs 新跑的同环境 `1d83ad3b`：15/15 逐字一致。目标 vs 历史 R0 有 9 处原文差异（项目、学习、无限制各 3 条），在 `当前项目/默认工作目录` 与 `当前模式自己的工作区` 两行：`"<历史 HOME>\\.openclaw\\workspace-…"` → `"<临时 HOME>\\.openclaw\\workspace-…"`。只替换这两个位置上的隔离目录前缀，15/15 与历史档相同；不是模式正文改动，不把归一化后的结果写成历史原文相等。 |
| Z3b ★ | **过（隔离安装配置）** | CONFIG：五个旧 agent 的完整对象对比一致，包含工具、deny、工作区、模型。 |
| Z3c ★ | **过（工具定义）** | SNAP：五组 `pinkie_session_start` / `pinkie_mode_ask` 都存在；参数+说明与历史档和基线一致，每组同一 SHA-256 `b92b908d63553356db47ab4d82fe86f7b8dc64091c8bb79bd7220e69bdd676df`。 |
| Z3d ★ | **没过** | `git diff --name-only 1d83ad3b 9dba1a4c -- tests` 为空；五份重点旧模式相关单测合计 70/70，但 `tests/session-cross-mode-ui.test.cjs` 8/9，`the changed scripts are served under new cache names` 同样在原基线重现；全套也没有全绿（Z1）。 |
| Z3e ★ | **没测** | 无五个独立隔离会话真实模型回复记录；注入快照和单测不等于口吻实测。复测：隔离网关给五个旧模式各发同一条可辨认口吻的消息，留会话原文或截图。**Z3 总项不通过。** |
| Z4 ★ | **没过（未交付规定的一句）** | `git diff 1d83ad3b 9dba1a4c -- personas ':!personas/metre/roles'` 全空：没改旧人设，但也没加第七节指定句；不把“没有产品改动”算完成。 |
| Z5 | **没过** | 上面 Git 远端/祖先检查；四条执行分支推送了各自成果，未归入总分支。`main` 和 `feat/metre-mode-1113` 也不是角色实现的交付分支。 |
| Z6 ★ | **没测（不可捕获）** | 亲自检查安装目标和派活入口：CONFIG 中没有 `roles`，SNAP 的 Metre `pinkie_session_start` 只有 `title,prompt,initiation,mode,model,folder`，无 `role`；UNIT 缺失。无法生成一份角色真实请求体。不能扫空日志得到「0 命中」。复测：候选建成后，隔离网关抓一份角色请求；对 `git ls-tree -r --name-only HEAD -- prompts` 所列 7 份 `unrestricted-prompt*.txt` 各取 5 个 ≥20 字片段，以及 `OPENCLAW_UR_INJECT` 作本地逐字扫描，报告只留计数和采样标识。 |
| Z7 | **没测** | 没有 S2/S5/S7/S9 的本轮两次隔离新会话，旁支首轮不能替代。用 `tools/metre/iso/drive.py` 按 `briefs/metre-mode-1113/PROGRESS.md` 批 7 的输入和口径各跑两遍再对照原始记录。 |

## R0 · 量和清点

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R0-1 ★ | **没过（目标缺产物）** | GIT 无 `MEASURE.md`；`git show 9dba1a4c:briefs/metre-roles-1118/MEASURE.md` 失败。旁支确有 4 组表，且原隔离日志中亲自抽算了一组，见交接表；不计入目标。 |
| R0-2 ★ | **没过（目标缺产物）** | 同 `git show …:MEASURE.md`；没有本目标的工具大小/归类表可与网关逐个对照。 |
| R0-3 ★ | **没过（未入目标）** | `git ls-tree -r 9dba1a4c -- briefs/metre-roles-1118/legacy-inject-baseline.json` 为空；`git show -s d58d37e2 d713f082` 和 SNAP 证明另一分支前置档实际存在且先于代码。 |
| R0-4 | **没测（原始开工）** | `PROGRESS.md` 的旧磁盘数字不是本轮见证。HOST 的本次开工 F 盘 `28,393,832,448` 字节（26.44 GiB），超过停线；本轮没有删除旧备份。原执行者是否按规定先停再继续，不能仅凭其汇报给过。 |
| R0-5 | **没过（目标无结论）** | `git show 9dba1a4c:briefs/metre-roles-1118/MEASURE.md` 无文件；R0 未在该分支完成。「14,480 ≤ 30,000」只证明旁支抽到的精简原型测量，不是目标交付。 |

## R1 · 机制

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R1-1 ★ | **没过（未交付）** | UNIT：卡加载用例文件不存在；GIT：`metre-roles.mjs` 也不存在，必填项/边界/覆盖/热加载无法在目标重跑。 |
| R1-2 ★ | **没过（未交付）** | CARDS：无脚本、无卡。旁支整合上故意抄 48 字的负例退出 1，见上文，不能记到目标。 |
| R1-3 | **没测** | CONFIG + UNIT；没有卡目录、`pinkie_roles` 和看板诊断入口来核对坏卡。 |
| R1-4 ★ | **没过（未交付）** | SNAP 的 Metre 开工参数缺 `role`、`of` 且 `mode` 必填；CONFIG 无角色 agent；没有 role key、来源或哈希血缘。 |
| R1-5 ★ | **过（仅旧路径）** | UNIT，`git diff 1d83ad3b 9dba1a4c -- tests/session-lineage.test.mjs tests/metre-dispatch.test.mjs` 为空；原用例断言 Metre 不写 mode 报 `要写 mode`。 |
| R1-6 ★ | **过（旧路径和模式防线）** | SNAP 五旧模式无 `role`；MODES 运行 mode 校验和 session hints 无 `roles`。不是角色路径存在的证明。 |
| R1-7 | **没测** | 根本无角色枚举（SNAP），不存在可触发的「未知角色 + 合法值列表」。 |
| R1-8 ★ | **没过（未交付）** | SNAP 确认说明没有角色段；CARDS/UNIT 不存在，不能造 40 张卡量该功能；无新增固定输入实测。 |
| R1-9 | **没过（未交付）** | `node tools/metre/inject-inventory.mjs --json metre` 的工具名中没有 `pinkie_roles`。 |
| R1-10 | **没过（未交付）** | SNAP 的 `pinkie_mode_ask` schema 为 `mode,question,background,model`，不接 `role`，不能触发角色工具管控。 |
| R1-11 ★ | **没过（未交付）** | `git grep -n metreRoles 9dba1a4c -- services/mode-architecture` 无结果；没有开关/开关前后两态。 |
| R1-12 ★ | **没测** | CONFIG/UNIT。没有角色可派，无法重跑第 1/2/3 轮的卡注入与 `REPORT_NOTE` 断言。 |
| R1-13 ★ | **没测** | UNIT 缺角色压缩恢复测试；没有可压缩的角色会话。 |
| R1-14 ★ | **没测** | UNIT/CARDS，无法在运行中改卡比哈希。 |
| R1-15 ★ | **没测** | `git grep -n ROLES_BASE 9dba1a4c -- services` 无结果；不存在可查纯度和字数的角色注入。 |
| R1-16 ★ | **没测** | CONFIG 无 agent；未生成角色子会话，菜单没有 `roles` 不是“角色能挂在 Metre 下”的验证。无浅色/深色实图。 |
| R1-17 ★ | **没测** | CONFIG/CARDS；三张角色不存在，无法得到三份 `usage` 与会话。 |
| R1-18 | **没测** | CONFIG 的隔离安装没有 `workspace-roles`；无一轮结束后清单可比。 |
| R1-19 | **没测** | 无角色会话，不能观察执行/写入是否会弹确认。 |
| R1-20 ★ | **没测** | UNIT/CONFIG 缺角色工具表与真实请求；无法加未知工具重跑完整性测试。 |
| R1-21 ★ | **没测** | UNIT/CARDS，无 `researcher` 拦截可跑。 |
| R1-22 ★ | **没测** | UNIT/CARDS，无 `deny_commands` 角色拦截器可跑；不在实际仓库执行用例列出的命令。 |
| R1-23 | **没测** | UNIT；没有角色命令审计及角色汇报供对照。 |
| R1-24 ★ | **没测** | UNIT；原 Metre 通用选模已存在，但找不到 `chooseRoleModel`，无法做角色五条件及缺项测试。 |
| R1-25 ★ | **没测** | `git grep -n 'function vendorOf' 9dba1a4c -- services/mode-architecture` 无结果；UNIT 缺厂家与 `of` 测试。 |
| R1-26 | **没测** | UNIT；无法送缺段/齐段的角色报告进入真实交付门禁。 |
| R1-27 | **没过（未交付）** | `git ls-tree -r 9dba1a4c -- briefs/metre-roles-1118/ref` 无输出；没有本目标的看板角色行、张数和三种图。 |
| R1-28 ★ | **没过（未交付）** | Z4 的 diff 为空。`node tools/metre/inject-inventory.mjs --json metre`（`target-metre-inventory.json`）的 `workspace['AGENTS.md'] = 5428` 是文件计数，不是新增角色句后的实测注入。 |
| R1-29 ★ | **没测** | UNIT/CONFIG；旧上限测试不等于角色计入上限，不能跑多个角色及 15 秒全停。 |
| R1-30 | **没测** | UNIT/CONFIG，无角色会话的记忆读写可断言。 |
| R1-31 | **没过** | GIT 无新角色代码可查命名；`node --test tests/reasoning-enhance.test.mjs` 单文件为 25/26，`the reviewer is told which folder the files were made in and that file deliverables need no pasted source` 在目标和基线都失败（`z1-leads/` 的原始 TAP）。 |

## R2 · 对比试点

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R2-1 ★ | **没过（缺记录）** | GIT `MEASURE.md` 缺失，无 48 个原始会话路径、失败重跑记录可抽。 |
| R2-2 ★ | **没测** | `git ls-tree -r 9dba1a4c -- tools/metre/roles/compose.mjs` 无输出；无 A/B/C 的简报哈希或三组同模型记录。 |
| R2-3 ★ | **没测** | R2-1/2 阻塞。无总通过数、证据齐全率差、固定输入上限和 reviewer 命中/误报分母。 |
| R2-4 ★ | **没测** | R2-1 无 48 轮抽样总体，抽 0/6；无执行侧厂家，不能做独立异厂复判。 |
| R2-5 ★ | **没测** | CARDS，无 reviewer 两题的交回和现场，不能逐条核实召回/误报。 |

## R3 · 卡质量

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R3-1 ★ | **没过** | `git ls-tree -r --name-only 9dba1a4c -- personas/metre/roles` 为空，实际 0/33。 |
| R3-2 ★ | **没过** | CARDS，不能跑 33 张卡的格式及抄手册检查。 |
| R3-3 ★ | **没过** | CARDS，无 33 张元数据可与 PLAN 对照。 |
| R3-4 ★ | **没过** | GIT，预期逐卡清单见下；33 张正文均缺，无可打勾项。 |
| R3-5 ★ | **没测** | GIT，无正文；不生成六维分数或伪造「未达标」名单。 |
| R3-6 ★ | **没过** | `git ls-tree -r 9dba1a4c -- tools/metre/roles/samples` 为空，0/66 道，无法核对客观检查项。 |
| R3-7 ★ | **没测** | CARDS 无题面或通过记录，重跑 0/10；五组无法抽样。 |
| R3-8 ★ | **没测** | CARDS，无五张审查卡的预埋题与结果。 |
| R3-9 ★ | **没过** | 预期 10 张只读卡均缺；不能以「没找到 write」算权限正确。 |

| 角色 ID（PLAN §4） | 本目标正文 |
|---|---|
| `feature-dev` | 缺 |
| `frontend-fix` | 缺 |
| `backend-fix` | 缺 |
| `test-engineer` | 缺 |
| `code-reviewer` | 缺 |
| `refactor` | 缺 |
| `perf-tuner` | 缺 |
| `security-auditor` | 缺 |
| `upgrader` | 缺 |
| `plan-executor` | 缺 |
| `batch-runner` | 缺 |
| `env-setup` | 缺 |
| `automation-builder` | 缺 |
| `release-prep` | 缺 |
| `web-operator` | 缺 |
| `researcher` | 缺 |
| `deep-reader` | 缺 |
| `domain-expert` | 缺 |
| `advisor` | 缺 |
| `data-analyst` | 缺 |
| `competitor-analyst` | 缺 |
| `visual-designer` | 缺 |
| `ui-replicator` | 缺 |
| `viral-creator` | 缺 |
| `writer` | 缺 |
| `editor` | 缺 |
| `translator` | 缺 |
| `doc-maker` | 缺 |
| `motion-video` | 缺 |
| `modeler-3d` | 缺 |
| `reviewer` | 缺 |
| `fact-checker` | 缺 |
| `qa-tester` | 缺 |

## R4 · 用户卡、安装和文档

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| R4-1 ★ | **没测** | CONFIG/UNIT，无 `pinkie_roles` 或角色派活入口，无法验证采用自定义卡和新装/升级字节一致。 |
| R4-2 ★ | **没测** | CONFIG/CARDS，无官方卡资产或升级路径；无法从新旧包比对备份。 |
| R4-3 ★ | **没过（未交付）** | GIT，连 `pinkie_roles` 都无。另查 `fc525a6e` 的工具定义也只有 `id`，自长卡仍未交付。 |
| R4-4 ★ | **没测** | CONFIG 无角色 agent；没有可接受的 Windows 角色安装包、上一版升级记录、Mac 实际运行时快照。GATE 的 Windows 测试不替代这三项。 |
| R4-5 | **没过** | `git diff 1d83ad3b 9dba1a4c -- docs/METRE-MODE.md personas/README.md briefs/metre-mode-1113/RELEASE-NOTES-DRAFT.md` 为空；角色文档改动只在别的分支。 |

## R5 · 真实流程

整批 **没测**：目标缺角色实现且未运行外部模型。本轮未验证号池能否提供顶档模型，不声称号池可用或不可用；不以免费或本地模拟替代。每条按 `ACCEPTANCE.md` 原题隔离复现两次，再做关闭 `metreRoles` 的对照。

| 编号 | 判定及阻塞 |
|---|---|
| R-1 | 没测：无前端角色派活、简报或开关对照。 |
| R-2 | 没测：无三路角色派活和异厂 `of` 记录。 |
| R-3 | 没测：无带角色版本可核查未硬派角色。 |
| R-4 | 没测：无 reviewer 和角色写拦截。 |
| R-5 | 没测：无自定义角色和看板标记。 |
| R-6 | 没测：无三个实际角色子会话。 |
| R-7 | 没测：无角色报告可供隔离测试。 |

## X · 对抗；P · 发布

| 编号 | 判定 | 证据 / 复现 |
|---|---|---|
| X1 ★ | **没测** | SNAP 未暴露 `role`、UNIT 缺测试；不能把拒绝 `mode: roles` 当成三种非法 `role` 输入的网关行为。候选就绪后在隔离网关送 `../x`、空值及过长值。 |
| X2 ★ | **没测** | UNIT/CARDS，无用户卡加载器；不能核查万字卡不进可选列表/注入。 |
| X3 ★ | **没测** | UNIT，无读卡机制；无法用两个插件实例重跑同文件更新。 |
| X4 ★ | **没测** | CONFIG/CARDS，不能对只读/可写角色各跑一遍故意夹带指令的临时文件；不得用旧模式或真实工作区代替。 |
| X5 | **没测** | 目标无 `pinkie_roles` 与角色选模；未运行离线角色调用，不能从「没有流量」推断通过。 |
| P1 ★ | **没测** | 无待验 Windows 包与角色真机截图；旁支看板夹具图不算。 |
| P2 ★ | **没测** | 无待验 Mac 包或 Mac 快照；Windows 上的导入夹具不是 Mac 实测。 |
| P3 | **没过** | `git diff 1d83ad3b 9dba1a4c -- briefs/metre-mode-1113/RELEASE-NOTES-DRAFT.md` 为空，角色更新说明只存在旁支。 |
| P4 ★ | **没过（未进入合并批准）** | 用户授权核对与推送报告，不等于批准将未过的功能合并；没有发版或主线写入。 |

## 交回执行者的问题

| 严重程度 | 位置 | 复现步骤及输出 | 建议 |
|---|---|---|---|
| 阻塞 | 指定总分支，Z5 / R0–R5 | `git diff --name-status 1d83ad3b 9dba1a4c` 只有三份文档，四条执行分支均不在目标历史；GitHub PR 无匹配。 | 保留已推送产物；由执行者对齐最新 `origin/main`，整理独立远端验收候选，明确交付 SHA，不要把未验收实现直接合进 `main`。 |
| 阻塞 | Z1 / Z3d，`tests/session-cross-mode-ui.test.cjs` | GATE 及单文件对照；`fc525a6e` 有 `the card names the other mode` 和缓存名断言失败，当前 `origin/main` 10/10。 | 在最新基线上隔离重跑旧跨模式界面测试，保留旧行为和断言，区分既有红项和新增回归；不加 `known-failures.json` 条目规避。 |
| 阻塞 | R4-3，整合版 `registerMetreRolesTool` | 在 `fc525a6e` 查看 tool schema 和执行分支，只有 `id`/`rolesInfo`。 | 实现第 3 次提示、草稿校验、用户采用/拒绝；增加真实隔离验证，确认采用前不可派。 |
| 阻塞 | Z6 / R2 / R3-7/8 / R4-4 / R5 / X / P | 查目标的 role runtime、原始记录以及可发布安装包，全缺；旁支静态和夹具结果不足。 | 先交明确候选和公开可复现的、不含凭据的证据索引，再按原条款跑。异厂身份可验证才评分；模型额度和跨平台安排先遵从用户限制。 |
| 重要 | Z3a，历史基准 | SNAP 9 个历史哈希差异全部只由采集 profile 路径造成。 | 以后归档时固定测试 profile 或把确切路径字段单列，保留完整原文和旧哈希，不覆盖旧档。 |

**总判定：指定分支不通过；阻塞为四项：实施成果未汇交、门禁和跨模式断言未全绿、自长卡未实现、真机与模型验收证据不齐。**
