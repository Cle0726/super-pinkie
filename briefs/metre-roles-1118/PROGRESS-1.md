# Metre 角色 agent · 车道 1（机制）接力记录

先读 `PLAN.md` 第八节「接手规矩」。每做完一步，在这里补一行状态，并在下面加一节记录：做了什么、怎么验证的、`ACCEPTANCE.md` 对应条目的自查结果（过 / 没过 / 没测和原因）。

| 批 | 状态 | 谁在做 | 更新日期 | 提交 |
|---|---|---|---|---|
| R0 量和清点 | 完成（`roles` 精简原型 14,480 tok < 30k，通过门槛） | Windows 车道 1 | 2026-11-18 | 见下方记录 |
| R1 机制（3.3–3.9、3.11） | 进行中 | Windows 车道 1 | 2026-11-18 | |

## 正式环境基线（Z2 开工记录）

- 开工检查时间：`2026-11-18T21:36:42-08:00`
- 正式 `openclaw.json`（`C:\Users\34786\.openclaw\openclaw.json`）修改时间：`2026-11-13T23:50:37.9293033-08:00`
- App 安装目录（`C:\Users\34786\AppData\Local\Programs\SuperPinkie`）修改时间：`2026-11-03T14:57:22.1522954-08:00`
- 18789 端口网关进程号：`无监听进程（none）`

## 开工磁盘剩余（R0-4）

- 首次检查时间：`2026-11-18T21:35:22-08:00`
  - `F:` 剩余：`14,598,283,264` bytes（`13.60 GiB` / `14.60 GB`），**不到 15GB**。按规矩停下报告用户，未建 `iso-roles`，未擅自删除任何文件（提交 `d9f259c6`）。
  - `C:` 剩余：`12,110,286,848` bytes（`11.28 GiB` / `12.11 GB`）。
- 用户查看占用清单后明确指令「全部清」清理 `F:\tmp` 旧临时文件（保留 3 小时内活跃项）。清理后检查时间：`2026-11-18T21:45:54-08:00`
  - `F:` 剩余：`37,400,641,536` bytes（`34.83 GiB` / `37.40 GB`），满足 ≥15GB 要求后创建隔离副本 `F:\碧琪实测\iso-roles`（端口 `3112`）。

## 待用户定

（暂无；F 盘空间问题已由用户确认清理解决）

## 对外接口

（R1 实现完成后填入全部导出函数名、字段名、`setup.py` 修改行号和 `git grep` 清单，供车道 4 和合并窗口对齐）

## R0 自查结果（ACCEPTANCE.md）

| 条目 | 结论 | 证据 |
|---|---|---|
| R0-1 ★ | 过 | `briefs/metre-roles-1118/MEASURE.md` 第一节给出 4 组实测：`project`=51,167、`metre`=37,269、`roles` 全套=32,502、`roles` 砍工具=14,480，均附会话 `.jsonl` 路径与 `usage` 原文 |
| R0-2 ★ | 过 | `MEASURE.md` 第二节给出网关实际发出 58 个工具的完整字数、实测校准 token（3.402 chars/tok）及六类归类表，无遗漏 |
| R0-3 ★ | 过 | `briefs/metre-roles-1118/legacy-inject-baseline.json` 在任何产品代码改动前生成并提交（提交 `d58d37e2`），总 SHA-256 `293054e40619ddac97fffee51571d01e3e8999c848f337f960c6998e6c003fba`，`--verify-baseline` 通过 |
| R0-4 | 过 | 开工 F 盘 `13.60 GiB` < 15GB 时停下询问用户（`d9f259c6`），获用户明确回复「全部清」后清理 `F:\tmp` 旧文件到 `34.83 GiB` 再建副本 |
| R0-5 | 过 | `roles` 精简原型 `14,480 tok <= 30,000 tok`，`MEASURE.md` 第四节给出明确往下做结论 |

## 记录

### 11-18 开工检查（Windows 车道 1，`d9f259c6`）

- 从 `origin/feat/metre-roles-1118`（`9dba1a4c`）切出工作树 `F:\Projects\metre-roles-1`（分支 `feat/metre-roles-1118-1`）。
- 记录正式环境三项基线（`openclaw.json` 修改时间、App 安装目录修改时间、18789 端口进程号）。
- 检查 F 盘剩余空间为 `14,598,283,264` bytes（`13.60 GiB` / `14.60 GB`），低于 15GB 门槛；按规矩停下报告用户，未建隔离副本、未删除任何文件。

### 11-18 R0 基准存档与原型实测（Windows 车道 1，`d58d37e2` + 本次提交）

- 扩展 `tools/metre/inject-inventory.mjs` 支持 `--save-baseline` / `--verify-baseline`（5 老模式 × 3 条样例 + 工作区文件 + `pinkie_session_start`/`pinkie_mode_ask` 快照 + Metre 工具基线快照），在不改任何产品代码前生成并提交 `briefs/metre-roles-1118/legacy-inject-baseline.json`（`d58d37e2`）。
- 获用户确认清理 `F:\tmp` 后新建隔离副本 `F:\碧琪实测\iso-roles`（端口 `3112`），备份 5 老模式 agent 配置快照，手工搭建 `roles` 原型（`contextInjection: "never"`），经本地只读代理抓取 4 组真实调用与全部 58 个网关工具定义，完成 `briefs/metre-roles-1118/MEASURE.md`。
- 结果：`project` 51,167 tok / `metre` 37,269 tok / `roles` 全套 32,502 tok / `roles` 精简 14,480 tok，远低于 30k 门槛，进入 R1。
