# M3 独立复测报告：共用观察器和轮询迁移真实页面回归审计

## 接力卡（最后更新：2026-11-21 18:41，Gemini-Win-9c4b @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m3-real-page-audit`（草稿 PR 待创建后回填编号）
- 已完成：
  1. 抓取 `origin`，核对 `briefs/program-1120/CONCURRENCY.md`、`briefs/maintenance-1120/PLAN.md`、`briefs/maintenance-1120/ACCEPTANCE.md` 及 PR #53、PR #54 变更范围
  2. 记录开工现场快照（正式环境 `%LOCALAPPDATA%\Programs\SuperPinkie`、`%LOCALAPPDATA%\SuperPinkie`、`~/.openclaw`、`18789` 端口，以及 `5135–5139` 端口空闲状态）
  3. 从 `origin/main`（`fa57fcc7da5e05e259e72d149c67235ebed750c2`）建立独立工作树 `C:\Users\34786\Projects\pinkie-wt\m3-review` 与隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`
- 正在做：推送首个认领提交并创建草稿 PR，随后在隔离目录安装 M3 合并前基线（`dbc49e4b4c03986b1139aca1d0fad65fc75ad147`）与最新 `origin/main`（`fa57fcc7da5e05e259e72d149c67235ebed750c2`）两套真实页面（`npm openclaw@2026.7.1-2` + 仓库界面安装流程 + 假网关）
- 下一步：
  1. 完成两套隔离真实页面安装与至少 3 个 M3 中间提交（`8be3fbc0`、`1663cd80`、`1dc4f4cc` / `6eac8ce6`）的真实页面抽查
  2. 逐项实测对比 11 类交互场景、运行中整树观察器数量（M3-2）、CPU/长任务/控制台错误
  3. 对 47 处 `setInterval` 迁移逐个核对（间隔、首次执行时机、隐藏页面行为、异常/慢回调隔离、取消有效性）并输出 47 行核对表及最小复现脚本
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m3-review`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`；端口 `5135–5139`；后台进程 无
- 正在跑的长操作：无
- 踩过的坑：`C:\tmp` 根目录在当前权限下拒绝新建子目录，改为使用 C 盘临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`（C 盘剩余空间 22.76 GB > 8 GB）
- 待用户决定：无

---

## 一、现场快照（Z2 隔离与正式环境零触碰证据）

### 1.1 开工现场快照（2026-11-21 18:39:37 -08:00）

- 命令与退出码（`exit 0`）：
  ```text
  === 开工现场快照 (2026-11-21 18:39:37 -08:00) ===
  PATH: C:\Users\34786\AppData\Local\Programs\SuperPinkie | Exists: True | LastWriteTime: 2026-11-21 03:36:23.878
  PATH: C:\Users\34786\AppData\Local\SuperPinkie | Exists: True | LastWriteTime: 2026-11-21 04:26:46.236
  PATH: C:\Users\34786\.openclaw | Exists: True | LastWriteTime: 2026-11-21 10:36:03.704
  PATH: C:\Users\34786\.openclaw\openclaw.json | Exists: True | LastWriteTime: 2026-11-19 23:56:00.737
  PORT 18789: No active listener/connection
  PORT 5135: FREE
  PORT 5136: FREE
  PORT 5137: FREE
  PORT 5138: FREE
  PORT 5139: FREE
  ```
- C 盘剩余空间检查：`22.76 GB`（高于 8 GB 阈值）。
