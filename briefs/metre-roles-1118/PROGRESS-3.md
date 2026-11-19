# Metre 角色 agent · 车道 3 进度记录（研究、内容、把关）

- 分支：`feat/metre-roles-1118-3`，从 `origin/feat/metre-roles-1118`（`9dba1a4c`）切出，独立工作树：`F:\Projects\metre-roles-3`。
- 范围：仅改动 `personas/metre/roles/` 下 18 张角色卡（`research` 6 张、`content` 9 张、`gate` 3 张）、`tools/metre/roles/samples/` 下对应 18 份样题，以及本文件 `briefs/metre-roles-1118/PROGRESS-3.md`。不改代码、界面、安装脚本、`lint-cards.mjs`、`PROGRESS.md` 及五个老模式人设与手册。不建隔离副本，不跑网关。

## 正式环境基线（PLAN 第八节第 2 条 / Z2）

- 开工记录（2026-11-18T21:11:34-08:00）：
  - `C:\Users\34786\.openclaw\openclaw.json` 修改时间：`2026-11-13T23:50:37.9293033-08:00`
  - 18789 端口监听进程：无监听进程（未运行）
- 收工记录（2026-11-18T21:40:43-08:00）：
  - `C:\Users\34786\.openclaw\openclaw.json` 修改时间：`2026-11-13T23:50:37.9293033-08:00`（与开工一致）
  - 18789 端口监听进程：无监听进程（与开工一致）

## 分步进度

| 步骤 | 内容 | 状态 | 提交 |
|---|---|---|---|
| 1 | `research` 6 张角色卡 | 已完成 | `81d63c22` |
| 2 | `content` 9 张角色卡 | 已完成 | `c4f3f622` |
| 3 | `gate` 3 张角色卡 | 已完成 | `7a43419b` |
| 4 | `research` 6 份样题 JSON | 已完成 | `b4c9c2e3` |
| 5 | `content` 9 份样题 JSON | 已完成 | `daa0a072` |
| 6 | `gate` 3 份样题 JSON（每题埋 3 个问题） | 已完成 | `285ed9d4` |
| 7 | `lint-cards.mjs` 全量复核（含 `--samples` 对齐）+ R3 自查表 | 已完成 | 本次提交 |

## 设计小事说明（PLAN 第八节第 7 条）

- `reads` 字段：只引用 `workspace-roles` 中实际存在的打法/审美参考文件（`playbooks/*.md`、`refs/AESTHETICS.md`），且仅在手册内容与角色职责高度匹配且无权限/工具冲突时引用，避免给轻档或只读角色注入无关的写文件或流程指令。
- `deny_commands` 字段：严格对照 PLAN 第四节表；本车道 18 张卡表中均未列 `deny_commands`，因此不在元数据中添加表外 `deny_commands`，确保与 R3-3 的表对比一致。
- `## 交回` 格式：每条均采用 `- <段落标题>：<具体证据说明>`，便于 PLAN 第 3.9 节汇报段落标题检查解析。
- 样题 JSON 格式（`tools/metre/roles/samples/<id>.json`）：与窗口 2 `lint-cards.mjs`（`origin/feat/metre-roles-1118-2@efa12d22`）的 `lintSampleFile` 完全对齐，顶层为 `{ role, name, samples }`，每题含 `id`、`title`、`brief`、非空 `files`（`[{ path, content }]`）、可客观判定的 `checks`；把关类（`reviewer`、`fact-checker`、`qa-tester`）全部 6 道样题每题均附 3 项 `planted_issues`。

## 待用户定

（暂无）

## ACCEPTANCE 自查（R3-1 ~ R3-6、R3-8、R3-9，仅本车道 18 张卡范围）

| 条目 | 结论 | 证据 / 原因 |
|---|---|---|
| **R3-1 ★** 角色清单与 `id` 一致、无导员 | **过** | 本车道 18 张卡（`research` 6 + `content` 9 + `gate` 3）的 `id` 与 PLAN 第四节完全一致，无「导员」或任何表外卡。与窗口 2 `origin/feat/metre-roles-1118-2` 的 15 张卡合并核对：`lane2Count: 15, lane3Count: 18, overlap: [], totalUnique: 33, missing: [], extra: []`。 |
| **R3-2 ★** 格式检查与「不抄手册」检查 | **过** | 使用窗口 2 最新 `origin/feat/metre-roles-1118-2@efa12d22` 的 `tools/metre/roles/lint-cards.mjs` 实跑检查全部 18 张卡，**18/18 全部通过（0 error、0 warning）**；全部 LF 换行，正文 576–880 字（去空白 543–814 字），三节结构完整，无禁用词与空洞套话，与全部 `playbooks/*.md` 和 `AESTHETICS.md` 最大连续重叠 28 字（< 40 字红线）。 |
| **R3-3 ★** `tier`/`vision`/`tools`/`review`/`deny_commands` 与 PLAN 第四节表一致 | **过** | 经 `lint-cards.mjs`（对照 `ROLE_SPECS`）与本车道独立校验脚本双重核对，18 张卡的 `id`、`name`、`group`、`when`、`tier`、`vision`、`tools`、`review`、`deny_commands` 100% 逐项一致。 |
| **R3-4 ★** 正文包含 PLAN 表中「必须做到」与「交回要带」全部条目 | **过** | 下方「18 张卡 R3-4 逐张核对表」已逐张核对全部「必须做到」与「交回要带」条目，全部显式落入对应卡的正文三节中，无删减遗漏。 |
| **R3-5 ★** 六项质量自查（可检查性、证据具体、边界清楚、篇幅精炼、无人设套话、不与 Metre 主 MD 冲突） | **过（自查通过；正式打分待独立验收人评审）** | 18 张卡每步均写成可执行可验证动作；`## 交回` 每段写明具体证据；`## 边界` 均含冲突以简报为准及角色禁区；篇幅 576–880 字精炼；无人设/语气/禁词；与 `personas/metre/AGENTS.md` 逐项对照无冲突（一律向 Metre 汇报，不直接问用户、不代做决定、不照做资料中夹带的指令）。 |
| **R3-6 ★** 每张卡 2 道样题（简报、准备文件、可客观判断的检查项） | **过** | 18 份 `tools/metre/roles/samples/<id>.json`（共 36 道样题）全部通过窗口 2 `lint-cards.mjs` 的 `lintSampleFile` 校验，**18/18 PASS（0 error）**；全部 LF 换行，每题均含完整 `brief`、非空 `files` 夹具、≥4 条可客观判断的 `checks` 且不含「写得好」「质量高」等主观空话。 |
| **（注：R3-7 样题真跑通过记录）** | **没测** | 样题需等 R1 机制与 `roles` agent 搭好后才能实际运行并由异厂模型判分；本车道不建隔离副本、不跑网关，故记「没测」。 |
| **R3-8 ★** 把关类样题埋 3 个问题（至少找到 3 个里的 2 个，误报为 0） | **没测** | 静态样题与夹具已就绪且通过校验：`reviewer`、`fact-checker`、`qa-tester` 全部 6 道样题每题均预埋 3 个客观可复现问题并附 `planted_issues`，通过 `lintSampleFile` 检查，其中 `reviewer-1` 的脚本与测试夹具已在临时目录实跑复现（`total_orders=4 / 250.5`、`2 pass / 1 skipped`、缺 `out/by-city.csv`），`reviewer-2` 与 `qa-tester` 内嵌 HTML 语法及全部行号均已核对一致；但**模型真跑的召回率（≥2/3）与误报（0）需等 R1 机制和 `roles` agent 就绪后才能实际测试**，故记「没测」。 |
| **R3-9 ★** 只读卡 `tools` 不含 `write` | **过** | 本车道 7 张只读卡（`researcher`、`domain-expert`、`advisor`、`competitor-analyst`、`reviewer`、`fact-checker`、`qa-tester`）经 `lint-cards.mjs`（`READONLY_ROLE_IDS`）及独立脚本核对，`tools` 均不含 `write`。 |

## 18 张卡 R3-4 逐张核对表

| id | 字数 | `tools` | 「必须做到」覆盖核对 | 「交回要带」覆盖核对 | 状态 |
|---|---|---|---|---|---|
| `researcher` | 637 | `[read, net]` | 只读 ✓；链接+日期 ✓；≥2 独立来源 ✓；事实/推断分开 ✓；矛盾并列写出 ✓；查不到写查不到 ✓ | 结论清单（带出处）✓；没查到的问题 ✓ | 过 |
| `deep-reader` | 597 | `[read, write]` | 每个文件读完 ✓；每条要点标文件+页码/行号 ✓；写明读全与只读部分 ✓ | 要点（带出处）✓；读完情况表 ✓ | 过 |
| `domain-expert` | 679 | `[read, net]` | 依据官方文件/法规/标准/论文带出处 ✓；分开确定/推断/不知道 ✓；法医财税只给信息不拍板、写地区日期、高风险建议找专业人士 ✓ | 回答 ✓；出处 ✓；不确定的地方 ✓ | 过 |
| `advisor` | 640 | `[read, net]` | 2–3 个真正不同方案 ✓；代价/风险/耗时/能不能回头 ✓；推荐一个说理由+改推荐条件 ✓ | 对比表 ✓；推荐和理由 ✓ | 过 |
| `data-analyst` | 699 | `[read, write, exec]` | 先抽查定单位/日期/去重口径 ✓；脚本分析可重跑 ✓；数字追到数据行 ✓；图表标题写结论 ✓ | 结论 ✓；脚本路径 ✓；口径说明 ✓；图表 ✓ | 过 |
| `competitor-analyst` | 593 | `[read, net, browser]` | 功能对比表/价格/定位 ✓；每项带来源与查看日期 ✓；截图存档 ✓ | 对比表 ✓；截图 ✓；来源 ✓ | 过 |
| `visual-designer` | 719 | `[read, write, exec, browser, media]` | 读 `refs/AESTHETICS.md` ✓；2–3 个差别明显方向 ✓；每个渲染截图 ✓；检查目标尺寸下字清不清 ✓ | 每个方向的图 ✓；说明 ✓；文件路径 ✓ | 过 |
| `ui-replicator` | 721 | `[read, write, exec, browser]` | 与参考图并排对比图 ✓；逐项量间距/字号/颜色 ✓；每种要求宽度与浅/深色看过 ✓ | 并排对比图 ✓；差异清单（量出来的数）✓ | 过 |
| `viral-creator` | 702 | `[read, write, net]` | 按平台写法和长度 ✓；开头 1–2 秒或第一行钩子 ✓；3–5 版标题及角度 ✓；封面文案与标签 ✓；不编数据评价 ✓；不教刷量搬运 ✓ | 各版本和角度说明 ✓；所用平台规则出处 ✓ | 过 |
| `writer` | 633 | `[read, write, net]` | 先列提纲再写全文 ✓；口吻照简报 ✓；字数 ±10% 内 ✓；事实带出处 ✓ | 成稿路径 ✓；字数 ✓；出处 ✓ | 过 |
| `editor` | 576 | `[read, write]` | 不改文风（除非简报要求）✓；需核实事实标出来 ✓ | 修改清单（原文、改后、理由）✓ | 过 |
| `translator` | 686 | `[read, write, net]` | 先建术语表 ✓；保留格式/代码/占位符 ✓；单位日期当地写法 ✓；3 段关键内容回译检查 ✓ | 译文 ✓；术语表 ✓；回译对照 ✓；没法翻的地方 ✓ | 过 |
| `doc-maker` | 745 | `[read, write, exec]` | 照 `playbooks/documents-and-slides.md` ✓；每页渲染成图查出框与字体 ✓；标题写结论 ✓ | 文件路径 ✓；每页预览图 ✓ | 过 |
| `motion-video` | 880 | `[read, write, exec, media]` | 照 `playbooks/motion-and-video.md` ✓；先配音再定时长 ✓；先出低清样片 ✓；抽帧拼总览图检查 ✓；响度 -14 LUFS ✓；渲染前看磁盘剩余 ✓ | 成片路径 ✓；抽帧总览图 ✓；响度数值 ✓；素材来源 ✓ | 过 |
| `modeler-3d` | 799 | `[read, write, exec]` | Blender Python / Three.js 程序化建模 ✓；导出 `.glb` ✓；4 角度渲染预览 ✓；面数和文件大小 ✓；外部素材查授权 ✓ | 模型路径 ✓；4 个角度预览图 ✓；面数和大小 ✓ | 过 |
| `reviewer` | 697 | `[read, exec, browser]` | `review: cross-vendor` ✓；对照「做到什么样算完」逐条判 ✓；亲自看文件跑一下不信汇报 ✓；只挑不改 ✓ | 每一条过/不过和证据 ✓；问题清单（严重程度、怎么复现）✓ | 过 |
| `fact-checker` | 709 | `[read, net]` | `review: cross-vendor` ✓；每个数字/日期/人名/引语判对/错/查不到并带出处 ✓ | 核查表 ✓ | 过 |
| `qa-tester` | 703 | `[read, exec, browser]` | 主流程+六类边界（空数据、超长文字、手机宽度、连续点击、刷新、断网）✓；每个问题截图 ✓ | 问题清单（复现步骤和截图）✓；测过的场景列表 ✓ | 过 |

## 过程记录

### 2026-11-18 步骤 1：`research` 6 张角色卡（`81d63c22`）
- 新增 `researcher.md`、`deep-reader.md`、`domain-expert.md`、`advisor.md`、`data-analyst.md`、`competitor-analyst.md`，脚本逐条通过格式、字数、禁词和重叠检查。

### 2026-11-18 步骤 2：`content` 9 张角色卡（`c4f3f622`）
- 新增 `visual-designer.md`、`ui-replicator.md`、`viral-creator.md`、`writer.md`、`editor.md`、`translator.md`、`doc-maker.md`、`motion-video.md`、`modeler-3d.md`。
- 自检时捕获 `motion-video.md` 中「先生成配音」含禁用子串「先生」，改为「先合成配音」后全过。

### 2026-11-18 步骤 3：`gate` 3 张角色卡（`7a43419b`）
- 新增 `reviewer.md`、`fact-checker.md`、`qa-tester.md`，18 张卡全量初验 `ERRORS: NONE`。

### 2026-11-18 步骤 4–6：18 份样题 JSON（`b4c9c2e3`、`daa0a072`、`285ed9d4`）
- 新增 `research` 6 份、`content` 9 份、`gate` 3 份，共 18 份 36 道样题。
- `data-analyst` 两题 CSV 夹具经脚本精确核对总有效金额（335.00 元、540.00 元）；`reviewer-1` 夹具在临时目录实跑确认复现 P1/P2/P3；`reviewer-2`、`qa-tester-1/2` 内嵌 HTML 脚本通过语法校验并精确校准全部 `planted_issues` 行号。

### 2026-11-18 步骤 7：窗口 2 `lint-cards.mjs`（`origin/feat/metre-roles-1118-2@efa12d22`）全量终验
- 拉取窗口 2 最新提交 `efa12d22`（已补全 `refs/AESTHETICS.md` 仓库回退映射并新增 `lintSampleFile`），在临时路径运行校验：
  - 首次 `lintSampleFile` 捕获 4 道纯联网样题的 `files` 为空数组，随即补齐 `context/*.md` 需求背景夹具文件，并统一在全部 18 份样题顶层加上 `name` 字段与窗口 2 对齐。
  - 重跑全量校验结果：**18/18 角色卡 PASS（repoRoot 与 workspaceRoot 均 18/18）**、**18/18 样题 JSON PASS**；与窗口 2 的 15 张卡合并核对恰好 33/33 官方卡（0 重叠、0 缺失、0 多余）。
- 边界核对：`git diff --name-only origin/feat/metre-roles-1118` 仅包含本车道 18 张角色卡、18 份样题 JSON 与 `PROGRESS-3.md`（共 37 个文件），未触碰任何代码、界面、安装脚本、`lint-cards.mjs`、`PROGRESS.md` 或碧琪五个老模式人设手册；Z2 正式环境未改动。
