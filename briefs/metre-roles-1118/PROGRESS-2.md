# Metre 角色 agent · 车道 2 接力记录（编码 + 执行 15 张卡、样题与 lint-cards.mjs）

- 分支：`feat/metre-roles-1118-2`（从 `origin/feat/metre-roles-1118` 的 `9dba1a4c` 切出，独立工作树 `F:\Projects\metre-roles-2`）
- 负责范围：
  1. `tools/metre/roles/lint-cards.mjs`（检查全部 33 张卡的第 3.1 节格式、第四节规格表与「不抄手册」40 字连续重复检查）
  2. `personas/metre/roles/<id>.md` 下「编码」9 张 +「执行」6 张，共 15 张角色卡
  3. `tools/metre/roles/samples/<id>.json` 下对应 15 份样题（每张卡 2 道样题，其中 `code-reviewer`、`security-auditor` 的样题各埋 3 个问题）

## 正式环境基线（PLAN 第八节第 2 条）

- 开工时间：2026-11-18T21:10-08:00
- `~/.openclaw/openclaw.json` 修改时间：`2026-11-13T23:50:37.9293033-08:00`
- `%LOCALAPPDATA%\Programs\SuperPinkie` 修改时间：`2026-11-03T14:57:22.1522954-08:00`
- 18789 端口网关进程：无（未启动，本车道不建隔离副本、不跑网关）

## 进度表

| 步骤 | 状态 | 说明 |
|---|---|---|
| 1. `tools/metre/roles/lint-cards.mjs` + 样板卡 `backend-fix.md` | 已完成 | 支持 33 张官方卡格式/表一致性与 40 字不抄手册检查，先行推送供窗口 3 使用 |
| 2. 其余 8 张「编码（coding）」角色卡 | 已完成 | `feature-dev`、`frontend-fix`、`test-engineer`、`code-reviewer`、`refactor`、`perf-tuner`、`security-auditor`、`upgrader` 全部通过 `lint-cards.mjs` |
| 3. 6 张「执行（execution）」角色卡 | 进行中 | `plan-executor`、`batch-runner`、`env-setup`、`automation-builder`、`release-prep`、`web-operator` |
| 4. 15 份角色样题（30 道题） | 待开始 | `tools/metre/roles/samples/<id>.json` |
| 5. `ACCEPTANCE.md` 逐条自查与收工核对 | 待开始 | R1-2、R3-1..R3-6、R3-8、R3-9 |

## 记录

### Step 1：完成 `tools/metre/roles/lint-cards.mjs` 与 `personas/metre/roles/backend-fix.md`

- 编写 `tools/metre/roles/lint-cards.mjs`：
  - 校验第 3.1 节规定的元数据字段、取值范围、数组/标量无第三方库语法、LF 换行。
  - 校验正文必须且只能依次包含 `## 做法`、`## 边界`、`## 交回` 三节，字数 300..1200 字，不含人设词（「碧琪」「先生」「老板」「导员」）及空话（「注意质量」「认真细致」等）。
  - 校验 `reads` 路径安全性（禁止 `..` 与绝对路径）并解析工作区手册文件，检查正文任何连续 40 个字以上不得原样出现在引用文件或工作区手册中。
  - 内置 PLAN 第四节全部 33 张角色卡的规格表（`id`、`name`、`group`、`when`、`tier`、`vision`、`tools`、`review`、`deny_commands`）以及 R3-9 只读角色无 `write` 规则。
- 写入 `personas/metre/roles/backend-fix.md` 并通过 `node tools/metre/roles/lint-cards.mjs` 验证；同时用故意从 `playbooks/debugging.md` 复制 40 字的临时卡验证脚本能准确报错拦截。

### Step 2：完成「编码（coding）」全部 9 张角色卡

- 新增 8 张角色卡：`feature-dev.md`、`frontend-fix.md`、`test-engineer.md`、`code-reviewer.md`、`refactor.md`、`perf-tuner.md`、`security-auditor.md`、`upgrader.md`。
- 逐张核对 PLAN 第四节表格中的 `when`、`tier`、`vision`、`tools`、「必须做到」与「交回要带」全部覆盖，只读卡 `code-reviewer`、`security-auditor` 的 `tools` 均不含 `write`。
- 运行 `node tools/metre/roles/lint-cards.mjs`，9/9 张全部 PASS。
