# Metre 角色 agent · 车道 2 接力记录（编码 + 执行 15 张卡、样题与 lint-cards.mjs）

- 分支：`feat/metre-roles-1118-2`（从 `origin/feat/metre-roles-1118` 的 `9dba1a4c` 切出，独立工作树 `F:\Projects\metre-roles-2`）
- 负责范围：
  1. `tools/metre/roles/lint-cards.mjs`（检查全部 33 张卡的第 3.1 节格式、第四节规格表与「不抄手册」40 字连续重复检查）
  2. `personas/metre/roles/<id>.md` 下「编码」9 张 +「执行」6 张，共 15 张角色卡
  3. `tools/metre/roles/samples/<id>.json` 下对应 15 份样题（每张卡 2 道样题，其中 `code-reviewer`、`security-auditor` 的样题各埋 3 个问题）

## 正式环境基线（PLAN 第八节第 2 条 / Z2）

| 时间点 | `~/.openclaw/openclaw.json` 修改时间 | `%LOCALAPPDATA%\Programs\SuperPinkie` 修改时间 | 18789 端口网关进程 |
|---|---|---|---|
| 开工（2026-11-18T21:10-08:00） | `2026-11-13T23:50:37.9293033-08:00` | `2026-11-03T14:57:22.1522954-08:00` | 无（未运行） |
| 收工（2026-11-18T21:36-08:00） | `2026-11-13T23:50:37.9293033-08:00` | `2026-11-03T14:57:22.1522954-08:00` | 无（未运行） |

正式环境与主仓库目录 `F:\Projects\super-pinkie` 全程未触碰，两次时间戳与进程状态完全一致。

## 进度表

| 步骤 | 状态 | 说明 |
|---|---|---|
| 1. `tools/metre/roles/lint-cards.mjs` + 样板卡 `backend-fix.md` | 已完成 | 支持 33 张官方卡格式/表一致性与 40 字不抄手册检查，先行推送供窗口 3 使用（`bb6596e5`） |
| 2. 其余 8 张「编码（coding）」角色卡 | 已完成 | `feature-dev`、`frontend-fix`、`test-engineer`、`code-reviewer`、`refactor`、`perf-tuner`、`security-auditor`、`upgrader` 全部通过 `lint-cards.mjs`（`c7253c09`） |
| 3. 6 张「执行（execution）」角色卡 | 已完成 | `plan-executor`、`batch-runner`、`env-setup`、`automation-builder`、`release-prep`、`web-operator` 全部通过 `lint-cards.mjs`（`50c4766d`） |
| 4. 15 份角色样题（30 道题） | 已完成 | `tools/metre/roles/samples/<id>.json` 全部通过 `lint-cards.mjs --samples`（`efa12d22`） |
| 5. `ACCEPTANCE.md` 逐条自查与收工核对 | 已完成 | R1-2、R3-1..R3-6、R3-8、R3-9 逐条核对并记录如下 |

## 待用户定

（暂无）

---

## ACCEPTANCE 逐条自查（涉及车道 2 的条目）

| 编号 | 结论 | 证据与说明 |
|---|---|---|
| **R1-2 ★** | **过** | 「不抄手册」检查脚本 `tools/metre/roles/lint-cards.mjs` 已实现。对本车道 15 张卡运行 `node tools/metre/roles/lint-cards.mjs` 15/15 通过；联合车道 3 的 18 张卡运行 `node tools/metre/roles/lint-cards.mjs personas/metre/roles ../metre-roles-3/personas/metre/roles --all-33` 33/33 通过。用故意从 `playbooks/debugging.md` 抄了 40 个字的临时卡调用 `lintCardFile()`，脚本返回 `ok: false` 并报错：`正文存在与 playbooks/debugging.md 连续 40 字以上完全相同的片段：「 自己把出错的那一步跑一遍，亲眼看到错误。复现不了就先别改——问用户是怎么操作的」`。 |
| **R3-1 ★** | **过（本车道 15 张；跨车道联查 33 张全过）** | 本车道「编码」9 张（`feature-dev`、`frontend-fix`、`backend-fix`、`test-engineer`、`code-reviewer`、`refactor`、`perf-tuner`、`security-auditor`、`upgrader`）和「执行」6 张（`plan-executor`、`batch-runner`、`env-setup`、`automation-builder`、`release-prep`、`web-operator`）的 `id` 与 PLAN 第四节的表完全一致；无「导员」或任何辅导类的卡。 |
| **R3-2 ★** | **过（本车道 15 张；跨车道联查 33 张全过）** | 15 张卡全部通过第 3.1 节格式检查（LF 换行、必填项、字数 461–725 字、固定三节、无禁词）和「不抄手册」40 字检查；并补齐了 `refs/AESTHETICS.md` → `personas/thinking/AESTHETICS.md` 的仓库路径回退映射，跨车道 33 张卡一次全过。 |
| **R3-3 ★** | **过（本车道 15 张）** | `lint-cards.mjs` 内置 PLAN 第四节 `ROLE_SPECS` 逐张比对 `tier`、`vision`、`tools`、`review`、`deny_commands`，15 张卡与 PLAN 第四节表 100% 一致（输出附后）。 |
| **R3-4 ★** | **过（本车道 15 张）** | 每张卡的正文均完整包含 PLAN 第四节表里「必须做到」和「交回要带」列出的每一项（15 张卡逐项核对表附后）。 |
| **R3-5 ★** | **过（本车道 15 张执行者自查；待验收人打分）** | 逐张自查六项指标：① 每步做法均可由文件 diff、命令输出或截图客观检查；② `## 交回` 每段写明具体证据（行号、路径、最多 30 行输出原文、截图、校验值）；③ `## 边界` 写清禁止事项及与简报冲突时的处理；④ 正文篇幅 461–725 字，紧凑无赘述；⑤ 0 处人设词或空话；⑥ 与 Metre `AGENTS.md` 及 `ROLES_BASE` 无冲突（不向用户直接发问、不再开子会话）。 |
| **R3-6 ★** | **过（本车道 15 份样题 / 30 道题）** | `tools/metre/roles/samples/<id>.json` 下 15 份样题文件，每张卡配 2 道样题，均含 `brief`、`files`、`checks`；检查项全部基于具体文件改动、返回值、退出码、输出文本、截图文件与汇报段落，不含「写得好」「质量高」等主观措辞。运行 `node tools/metre/roles/lint-cards.mjs --samples` 15/15 通过。 |
| **R3-7 ★** | **没测（原因：需等车道 1 的 `roles` agent 与派活机制合入后，在隔离副本网关上真跑）** | 按任务规矩，样题要等机制做完才能真跑，本次如实记「没测」，不写成过。 |
| **R3-8 ★** | **过（样题埋题部分）/ 没测（真跑召回与误报部分）** | 本车道涉及的审查类角色 `code-reviewer`、`security-auditor` 的每道样题（共 4 道题）均各埋入 3 个具体问题（记录在 JSON 的 `planted_issues` 字段，指明文件、行号、严重程度和原因），并在 `checks` 中写明「至少找到 3 个里的 2 个，误报为 0」；真跑召回率与误报率需等 `roles` agent 机制就绪后实测，真跑部分记「没测」。 |
| **R3-9 ★** | **过（本车道 15 张；跨车道联查 33 张全过）** | 本车道只读角色 `code-reviewer`（`[read, exec]`）、`security-auditor`（`[read, exec, net]`）、`web-operator`（`[read, browser, net]`）的 `tools` 均不含 `write`，且 `lint-cards.mjs` 对 PLAN 列出的全部 10 张只读卡强制断言不含 `write`。 |

---

## R3-2 / R3-3 / R3-6 脚本检查输出原文

命令：`node tools/metre/roles/lint-cards.mjs --samples`

```text
PASS  automation-builder   (570 字)  personas/metre/roles/automation-builder.md
PASS  backend-fix          (461 字)  personas/metre/roles/backend-fix.md
PASS  batch-runner         (590 字)  personas/metre/roles/batch-runner.md
PASS  code-reviewer        (557 字)  personas/metre/roles/code-reviewer.md
PASS  env-setup            (687 字)  personas/metre/roles/env-setup.md
PASS  feature-dev          (651 字)  personas/metre/roles/feature-dev.md
PASS  frontend-fix         (659 字)  personas/metre/roles/frontend-fix.md
PASS  perf-tuner           (553 字)  personas/metre/roles/perf-tuner.md
PASS  plan-executor        (517 字)  personas/metre/roles/plan-executor.md
PASS  refactor             (534 字)  personas/metre/roles/refactor.md
PASS  release-prep         (604 字)  personas/metre/roles/release-prep.md
PASS  security-auditor     (725 字)  personas/metre/roles/security-auditor.md
PASS  test-engineer        (630 字)  personas/metre/roles/test-engineer.md
PASS  upgrader             (539 字)  personas/metre/roles/upgrader.md
PASS  web-operator         (588 字)  personas/metre/roles/web-operator.md

PASS  sample:automation-builder  tools/metre/roles/samples/automation-builder.json
PASS  sample:backend-fix    tools/metre/roles/samples/backend-fix.json
PASS  sample:batch-runner   tools/metre/roles/samples/batch-runner.json
PASS  sample:code-reviewer  tools/metre/roles/samples/code-reviewer.json
PASS  sample:env-setup      tools/metre/roles/samples/env-setup.json
PASS  sample:feature-dev    tools/metre/roles/samples/feature-dev.json
PASS  sample:frontend-fix   tools/metre/roles/samples/frontend-fix.json
PASS  sample:perf-tuner     tools/metre/roles/samples/perf-tuner.json
PASS  sample:plan-executor  tools/metre/roles/samples/plan-executor.json
PASS  sample:refactor       tools/metre/roles/samples/refactor.json
PASS  sample:release-prep   tools/metre/roles/samples/release-prep.json
PASS  sample:security-auditor  tools/metre/roles/samples/security-auditor.json
PASS  sample:test-engineer  tools/metre/roles/samples/test-engineer.json
PASS  sample:upgrader       tools/metre/roles/samples/upgrader.json
PASS  sample:web-operator   tools/metre/roles/samples/web-operator.json

合计：15/15 张通过
```

---

## R3-3 与 R3-4 逐卡核对表（本车道 15 张卡）

| id | group | tier / vision | tools | deny_commands | 「必须做到」覆盖核对 | 「交回要带」覆盖核对 |
|---|---|---|---|---|---|---|
| `feature-dev` | `coding` | `mid` / `false` | `read, write, exec, net` | `-` | ✓ 先读项目的约定（README、AGENTS.md、CLAUDE.md、已有测试）；照现有写法；补测试；跑测试和检查 | ✓ 改动清单、测试命令和输出原文、没覆盖到的情况 |
| `frontend-fix` | `coding` | `mid` / `true` | `read, write, exec, browser, net` | `-` | ✓ 先在浏览器里复现并截图；找根因；修好后在桌面宽度和 375 宽度各截一张；控制台没有新报错 | ✓ 修前修后截图、控制台输出、根因（带文件和行号） |
| `backend-fix` | `coding` | `mid` / `false` | `read, write, exec, net` | `git push, npm publish` | ✓ 照第 3.1 节样板卡：先复现、找根因、写失败测试或复现脚本、最小改动、重跑 | ✓ 结论、根因（带文件和行号）、改动清单、证据（最多 30 行）、没做的和拿不准的 |
| `test-engineer` | `coding` | `mid` / `false` | `read, write, exec` | `-` | ✓ 只改测试文件；每条测试先证明会失败；边界情况列表 | ✓ 新测试清单、失败到通过的输出、发现的产品代码问题（只报不修） |
| `code-reviewer` | `coding` | `mid` / `false` | `read, exec` | `-` | ✓ 只读；每个问题都要读代码或跑一下核实过；不挑格式毛病 | ✓ 问题清单（严重程度、文件和行号、出错场景、建议改法）；没找到问题也要写查过哪些 |
| `refactor` | `coding` | `mid` / `false` | `read, write, exec` | `-` | ✓ 改前改后跑同一组测试，结果完全一致；不改对外接口 | ✓ 改前改后的测试输出、改动统计、行为没变的依据 |
| `perf-tuner` | `coding` | `mid` / `false` | `read, write, exec` | `-` | ✓ 先量（同一方法至少跑 3 次）；定目标；改完用同一方法再量；没变快就撤回 | ✓ 前后数字表、测量命令、改了什么 |
| `security-auditor` | `coding` | `mid` / `false` | `read, exec, net` | `-` | ✓ 只读；查密钥泄露、注入、路径穿越、依赖漏洞（`npm audit`、`pip-audit`）；不攻击任何外部系统；输出里的密钥打码 | ✓ 问题清单：严重程度、位置、证据、修法 |
| `upgrader` | `coding` | `mid` / `false` | `read, write, exec, net` | `-` | ✓ 先读更新日志里的不兼容改动；一次只升一个；每升一个跑一次测试 | ✓ 升了什么、每一步的测试结果、没升成的和原因 |
| `plan-executor` | `execution` | `mid` / `false` | `read, write, exec, net` | `-` | ✓ 严格按计划的顺序做；每一步留下证据；遇到和计划不符的情况先停下，不自己发挥 | ✓ 每一步：做了没有、证据；停下的位置和原因 |
| `batch-runner` | `execution` | `light` / `false` | `read, write, exec` | `-` | ✓ 对象清单来自简报或指定文件；先试前 3 个；动手前先备份；逐个记日志（CSV）；前 10 个里失败超过 2 个就停；重跑时跳过已经成功的 | ✓ 成功和失败的数量、日志路径、备份路径、失败的原因 |
| `env-setup` | `execution` | `mid` / `false` | `read, write, exec, net` | `-` | ✓ 装进用户空间或项目虚拟环境；国内网络先换镜像；装完跑一次验证；记进下载账本；要管理员权限或改系统设置的，只报告不做 | ✓ 装了什么、装在哪、验证输出、怎么卸载 |
| `automation-builder` | `execution` | `mid` / `false` | `read, write, exec, net` | `-` | ✓ 有试运行模式；写明怎么停、怎么撤回、日志在哪；真跑一次 | ✓ 脚本路径、试运行和真跑的输出、停止和撤回的方法 |
| `release-prep` | `execution` | `mid` / `false` | `read, write, exec, net` | `git push, npm publish, gh release` | ✓ 打包并跑发版检查；写更新说明；推送、发布、部署命令只写好交给 Metre，自己不执行 | ✓ 产物路径和校验值、检查结果、待执行的命令 |
| `web-operator` | `execution` | `mid` / `true` | `read, browser, net` | `-` | ✓ 每个关键步骤截图；不输入密码和支付信息；不点提交、发送、发布（除非简报写死对象内容并写明用户已同意）；遇到登录或验证码就停下汇报 | ✓ 每一步的截图、停下的位置和原因 |

---

## 分步记录

### Step 1：完成 `tools/metre/roles/lint-cards.mjs` 与 `personas/metre/roles/backend-fix.md`

- 编写 `tools/metre/roles/lint-cards.mjs`，支持全部 33 张卡的第 3.1 节格式检查、第四节表格核对与 40 字「不抄手册」检查。
- 写入 `personas/metre/roles/backend-fix.md` 并通过检查；用故意从 `playbooks/debugging.md` 复制 40 字的坏卡验证负向拦截。

### Step 2：完成「编码（coding）」全部 9 张角色卡

- 新增 8 张角色卡：`feature-dev.md`、`frontend-fix.md`、`test-engineer.md`、`code-reviewer.md`、`refactor.md`、`perf-tuner.md`、`security-auditor.md`、`upgrader.md`，9/9 通过 `lint-cards.mjs`。

### Step 3：完成「执行（execution）」全部 6 张角色卡

- 新增 6 张角色卡：`plan-executor.md`、`batch-runner.md`、`env-setup.md`、`automation-builder.md`、`release-prep.md`、`web-operator.md`，15/15 通过 `lint-cards.mjs`。

### Step 4：完成 15 份角色样题（30 道样题）

- 新增 `tools/metre/roles/samples/<id>.json` 共 15 份样题文件（30 道题），`code-reviewer` 与 `security-auditor` 的每道题均埋入 3 个问题。
- 为 `lint-cards.mjs` 增加 `--samples` 校验以及 `refs/AESTHETICS.md` → `personas/thinking/AESTHETICS.md` 的仓库路径回退映射，15 张卡与 15 份样题（及跨车道 33 张卡）全部通过。

### Step 5：ACCEPTANCE 自查与收工核对

- 核对 `git diff --name-status origin/feat/metre-roles-1118`：仅新增 `personas/metre/roles/` 下 15 张卡、`tools/metre/roles/samples/` 下 15 份样题、`tools/metre/roles/lint-cards.mjs` 和 `briefs/metre-roles-1118/PROGRESS-2.md`（共 32 个新文件），其余文件 0 改动。
