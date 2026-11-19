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
| 1 | `research` 6 张角色卡 | 已完成 | 待写入 |
| 2 | `content` 9 张角色卡 | 未开始 | |
| 3 | `gate` 3 张角色卡 | 未开始 | |
| 4 | `research` 6 份样题 JSON | 未开始 | |
| 5 | `content` 9 份样题 JSON | 未开始 | |
| 6 | `gate` 3 份样题 JSON（每题埋 3 个问题） | 未开始 | |
| 7 | `lint-cards.mjs` 检查（如已推送）+ 全量自查与 R3 核对表 | 未开始 | |

## 设计小事说明（PLAN 第八节第 7 条）

- `reads` 字段：只引用 `workspace-roles` 中实际存在的打法/审美参考文件（`playbooks/*.md`、`refs/AESTHETICS.md`），且仅在手册内容与角色职责高度匹配且无权限/工具冲突时引用，避免给轻档或只读角色注入无关的写文件/建流程指令。
- `deny_commands` 字段：严格对照 PLAN 第四节表；本车道 18 张卡表中均未列 `deny_commands`，因此不在元数据中添加表外 `deny_commands`，确保与 R3-3 的表对比一致。
- `## 交回` 格式：每条均采用 `- <段落标题>：<具体证据说明>`，便于 PLAN 第 3.9 节汇报段落标题检查解析。

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
