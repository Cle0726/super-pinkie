# M3 独立复测报告：共用观察器和轮询迁移真实页面回归审计

## 接力卡（最后更新：2026-11-21 19:02，Gemini-Win-9c4b @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m3-real-page-audit`，PR #57（草稿）
- 已完成：
  1. 抓取 `origin`，核对 `briefs/program-1120/CONCURRENCY.md`、`briefs/maintenance-1120/PLAN.md`、`briefs/maintenance-1120/ACCEPTANCE.md` 及 PR #53、PR #54 变更范围（提交 `6232e579`）
  2. 记录开工现场快照，并在隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b` 下载 `openclaw@2026.7.1-2`（`shasum: 4583b987ea7277230ce1c7b2b8535d3e219f57ac`），分别按 M3 合并前基线 `dbc49e4b4c03986b1139aca1d0fad65fc75ad147` 与最新 `origin/main` `fa57fcc7da5e05e259e72d149c67235ebed750c2` 完成 `apply-theme.ps1` + `bundle.py` + `stamp.mjs` 真实 Control UI 安装（202 / 203 项注入，1683 / 1686 项资源）
  3. 完成 47 处 `MutationObserver` 迁移与 47 处 `setInterval` 迁移的静态走查，定位到多处设计缺陷（如 `createObserver` 单 `sub` 覆盖导致 `laolao-learning-reminder.js` 丢失 `<html>` 属性监听、`scheduleTimerTick` 长周期定时器阻塞后续短周期定时器首次调度、`pauseWhenHidden: true` 默认关闭后台状态/通知/心跳/消息窗口保护、无 `visibilitychange` 唤醒等）
- 正在做：在端口 `5135–5139` 启动假网关真实页面，用 Playwright 执行 11 项真实交互对比、整树观察器运行时统计（M3-2）、CPU/长任务/控制台错误对比、3+ 个 M3 中间提交抽查，以及 47 处 `domWatch.poll` 迁移的自动化复现实验
- 下一步：把全部实测证据、47 行核对表、最小复现脚本与修复建议写入本文件并推送，随后记录收工现场快照并清理临时目录与进程
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m3-review`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`；端口 `5135–5139`；后台进程 无
- 正在跑的长操作：无
- 踩过的坑：`C:\tmp` 根目录在当前权限下拒绝新建子目录，改用 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`
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
