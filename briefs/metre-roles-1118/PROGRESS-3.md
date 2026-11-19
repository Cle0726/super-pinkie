# Metre 角色 agent · 车道 3 进度记录（研究、内容、把关）

- 分支：`feat/metre-roles-1118-3`，从 `origin/feat/metre-roles-1118`（`9dba1a4c`）切出，独立工作树：`F:\Projects\metre-roles-3`。
- 范围：仅改动 `personas/metre/roles/` 下 18 张角色卡（`research` 6 张、`content` 9 张、`gate` 3 张）、`tools/metre/roles/samples/` 下对应 18 份样题，以及本文件 `briefs/metre-roles-1118/PROGRESS-3.md`。不改代码、界面、安装脚本、`lint-cards.mjs`、五个老模式人设与手册。不建隔离副本，不跑网关。

## 正式环境基线（PLAN 第八节第 2 条 / Z2）

- 开工记录（2026-11-18T21:11:34-08:00）：
  - `C:\Users\34786\.openclaw\openclaw.json` 修改时间：`2026-11-13T23:50:37.9293033-08:00`
  - 18789 端口监听进程：无监听进程（未运行）
- 收工记录：待收工时复核。

## 分步进度

| 步骤 | 内容 | 状态 | 提交 |
|---|---|---|---|
| 1 | `research` 6 张角色卡 | 已完成 | `81d63c22` |
| 2 | `content` 9 张角色卡 | 已完成 | `c4f3f622` |
| 3 | `gate` 3 张角色卡 | 已完成 | `7a43419b` |
| 4 | `research` 6 份样题 JSON | 已完成 | `b4c9c2e3` |
| 5 | `content` 9 份样题 JSON | 已完成 | 待写入 |
| 6 | `gate` 3 份样题 JSON（每题埋 3 个问题） | 未开始 | |
| 7 | `lint-cards.mjs` 检查（如已推送）+ 全量自查与 R3 核对表 | 未开始 | |

## 设计小事说明（PLAN 第八节第 7 条）

- `reads` 字段：只引用 `workspace-roles` 中实际存在的打法/审美参考文件（`playbooks/*.md`、`refs/AESTHETICS.md`），且仅在手册内容与角色职责高度匹配且无权限/工具冲突时引用，避免给轻档或只读角色注入无关的写文件/建流程指令。
- `deny_commands` 字段：严格对照 PLAN 第四节表；本车道 18 张卡表中均未列 `deny_commands`，因此不在元数据中添加表外 `deny_commands`，确保与 R3-3 的表对比一致。
- `## 交回` 格式：每条均采用 `- <段落标题>：<具体证据说明>`，便于 PLAN 第 3.9 节汇报段落标题检查解析。
- 样题 JSON 格式（`tools/metre/roles/samples/<id>.json`）：`{ role, samples: [{ id, title, brief, files: [{ path, content }], checks: [...] }] }`；把关类（`reviewer`、`fact-checker`、`qa-tester`）每题另附 `planted_issues` 数组记录故意埋入的 3 个问题（含 `id`、`severity`、`location`、`description`、`evidence`），便于客观计算召回与误报。

## 待用户定

（暂无）

## 记录

### 2026-11-18 步骤 1：`research` 6 张角色卡

- 新增 6 张卡：`researcher.md`、`deep-reader.md`、`domain-expert.md`、`advisor.md`、`data-analyst.md`、`competitor-analyst.md`。
- 自检结果（`origin/feat/metre-roles-1118-2` 尚未推送 `lint-cards.mjs`，按 PLAN 第 3.1 节与第四节逐条脚本核对）：
  - 全部为 LF 换行，无 `\r`。
  - 元数据字段与 PLAN 第四节表逐项一致，`name` 3–5 字（≤8），`when` 6–18 字（≤30），`tools` 只读卡均不含 `write`。
  - 正文固定三节（`## 做法`、`## 边界`、`## 交回`），总字数 593–699（去空白 558–666），全部在 300–1200 范围内。
  - 无禁用词（「碧琪」「先生」「老板」「注意质量」「认真细致」）；对照全部 `playbooks/*.md` 与 `AESTHETICS.md` 检查连续重叠，最大重叠 19 字符（仅文件名 `data-and-charts.md`），远低于 40 字符红线。

### 2026-11-18 步骤 2：`content` 9 张角色卡

- 新增 9 张卡：`visual-designer.md`、`ui-replicator.md`、`viral-creator.md`、`writer.md`、`editor.md`、`translator.md`、`doc-maker.md`、`motion-video.md`、`modeler-3d.md`。
- 自检结果：
  - 全部为 LF 换行，无 `\r`。
  - 元数据字段（`id`、`name`、`group`、`when`、`tier`、`vision`、`tools`、`reads`）与 PLAN 第四节表逐项核对一致。
  - 正文固定三节，总字数 576–880（去空白 543–814），均在 300–1200 范围内。
  - 自检时捕获 `motion-video.md` 中「先生成配音」包含禁用子串「先生」，已改为「先合成配音」并重验全部 15 张卡无禁用子串。
  - 对照全部 `playbooks/*.md` 与 `AESTHETICS.md` 检查连续重叠，最大重叠 28 字符（仅路径字符串 `` `playbooks/design-review.md` ``），远低于 40 字符红线。

### 2026-11-18 步骤 3：`gate` 3 张角色卡及 18 张卡全量初验

- 新增 3 张卡：`reviewer.md`、`fact-checker.md`、`qa-tester.md`。
- 18 张卡全量脚本核对结果（`ERRORS: NONE`）：
  - 数量：18 张（`research` 6 + `content` 9 + `gate` 3），无「导员」或表外卡。
  - 元数据：`id`、`name`、`group`、`when`、`tier`、`vision`、`tools`、`review`、`deny_commands` 与 PLAN 第四节表逐项一致；7 张只读卡（`researcher`、`domain-expert`、`advisor`、`competitor-analyst`、`reviewer`、`fact-checker`、`qa-tester`）的 `tools` 均不含 `write`。
  - `reads` 路径全部在 `workspace-roles` 合法相对路径内，无 `..` 或绝对路径。
  - 换行与正文：全部 LF，固定三节，正文长度 576–880 字（去空白 543–814 字），全在 300–1200 字范围内；无禁用词与空洞套话；与全部 `playbooks/*.md` 和 `AESTHETICS.md` 最大连续重叠 28 字（远小于 40 字）。

### 2026-11-18 窗口 2 `lint-cards.mjs` 首次联调（`origin/feat/metre-roles-1118-2@50c4766d`）

- 在临时路径调用窗口 2 推送的 `tools/metre/roles/lint-cards.mjs` 检查本车道全部 18 张卡（未改动本分支的 `lint-cards.mjs`）：
  - 直接按 `repoRoot` 运行：17/18 通过，唯一报错为 `visual-designer` 的 `reads 引用的文件在角色工作区中不存在：refs/AESTHETICS.md`。
  - 原因定位：`lint-cards.mjs` 的 `resolveReadFile()`（第 301 行）和 `collectAllWorkspaceManuals()`（第 336 行）按 `personas/thinking/refs/AESTHETICS.md` 查找，而仓库实际源文件在 `personas/thinking/AESTHETICS.md`，安装时才按 PLAN 第 3.6 节复制到 `workspace-roles/refs/AESTHETICS.md`；PLAN 第四节也明确要求 `visual-designer` 读 `refs/AESTHETICS.md`。
  - 用临时 `workspaceRoot` 放置 `refs/AESTHETICS.md`（从 `personas/thinking/AESTHETICS.md` 复制）调用 `lintCardFile('personas/metre/roles/visual-designer.md', {repoRoot, workspaceRoot})` 复测：`ok: true, errors: [], warnings: []`（18/18 全部通过，含对 `AESTHETICS.md` 的 40 字不抄检查）。
  - 备注：按边界不修改 `lint-cards.mjs`，合并或窗口 2 维护时建议在 `lint-cards.mjs` 补充 `refs/<file>` → `personas/thinking/<file>` 的仓库回退映射。

### 2026-11-18 步骤 4：`research` 6 份样题 JSON

- 新增 6 份样题（共 12 题）：`researcher.json`、`deep-reader.json`、`domain-expert.json`、`advisor.json`、`data-analyst.json`、`competitor-analyst.json`。
- 自检结果：全部为合法 JSON、LF 换行；每份 2 题，含 `brief`、`files`、`checks`；全部检查项无主观词；`data-analyst` 两题的 CSV 夹具与期望汇总数经脚本精确核验一致（Q3 门店总有效 335.00 元；渠道总有效 540.00 元）。

### 2026-11-18 步骤 5：`content` 9 份样题 JSON

- 新增 9 份样题（共 18 题）：`visual-designer.json`、`ui-replicator.json`、`viral-creator.json`、`writer.json`、`editor.json`、`translator.json`、`doc-maker.json`、`motion-video.json`、`modeler-3d.json`。
- 自检结果：15 份样题 JSON 全部合法解析、LF 换行；内嵌 SVG 与 JSON 夹具均合法；每题检查项 ≥ 4 条且全部可客观判断，无主观措辞。
