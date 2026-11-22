# M3 返工 · 恢复观察器和轮询的原生行为

## 接力卡（最后更新：2026-11-21 19:00 -08:00，Gemini-Win-9k4m @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m3-fix-dom-watch`，草稿 PR 待创建
- 已完成：
  1. 开工检查与基线复现：确认 C 盘剩余 22.19 GB（> 8 GB）；记录 Z2 开工只读现场快照；核对 PR #54 / #57 / #59 文件清单避免冲突。
  2. 护栏反例确认（CONCURRENCY 3.8）：在 `ui/injections/laolao-feedback.css` 临时追加 1 处 `!important`，`node --test tests/code-health-ratchet.test.mjs` 退出码 `1` 并精准报 `!important（强制覆盖）增加（基线 1 → 当前 2）`；原样还原后工作树干净。
  3. 在隔离临时环境复跑复制出来的 `probe2.cjs` 与 `product.cjs`（Edge），在 `origin/main` (`fa57fcc7`) 完整复现 6 类回归与学习提醒失效。
- 正在做：创建草稿 PR，随后逐行审计 #53 (`3cd2ac6f`) 迁移的每一处 `MutationObserver` 与 `setInterval`（对比 `3cd2ac6f^1`），并先在未修复的 `fa57fcc7` 上编写差分测试与学习提醒产品测试、采集失败证据。
- 下一步：
  1. 逐处审计 `git diff 3cd2ac6f^1..3cd2ac6f` 里的每一处 `MutationObserver` 和 `setInterval` 调用点，输出完整核对表并识别所有偏差；
  2. 新增真实浏览器原生 API vs `domWatch` 差分测试与学习提醒原样产品测试，先在 `fa57fcc7` 跑出失败证据；
  3. 返工 `ui/injections/laolao-dom-watch.js` 及有偏差的调用点，使轮询和观察器行为与原生完全等价；
  4. 重跑差分测试、学习提醒测试、现有热点测试、Z1、Z4、Z5，并记录收工 Z2 快照。
- 没推送的东西：无（本文件提交后立即推送并开草稿 PR）。
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m3-rework-exec`；隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-rework-exec-9k4m`；端口 5130–5134；后台进程：无。
- 正在跑的长操作：无。
- 踩过的坑：
  - `C:\tmp` 拒绝写入，改用 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-rework-exec-9k4m`（位于 C 盘）。
  - 首次在全新的空隔离 `LOCALAPPDATA` 中启动 Edge 时偶发 `DevTools remote debugging requires a non-default data directory`（退出码 1），紧接着第二次启动即恢复正常；复测时需注意一次只开一个浏览器实例并在日志中如实记录。
- 待用户决定：无。

---

## Z2 正式环境快照（只读，绝不修改）

| 检查项 | 开工（2026-11-21 18:56:00 -08:00） | 收工 | 一致 |
|---|---|---|---|
| `C:\Users\34786\.openclaw\openclaw.json` 修改时间与大小 | `11/19/2026 11:56:00 PM` / `49217` bytes | 待收工核对 | 待核对 |
| `C:\Users\34786\AppData\Local\Programs\SuperPinkie` 修改时间 | `11/21/2026 3:36:23 AM` | 待收工核对 | 待核对 |
| `C:\Users\34786\AppData\Local\SuperPinkie` 修改时间 | `11/21/2026 4:26:46 AM` | 待收工核对 | 待核对 |
| 18789 端口监听 | `NOT_LISTENING` | 待收工核对 | 待核对 |

## 开工护栏反例与基线复现（`fa57fcc7`）

### 1. 棘轮反例（`tests/code-health-ratchet.test.mjs`）
- 基线运行：退出码 `0`（3/3 通过）。
- 反例（`ui/injections/laolao-feedback.css` 追加 1 处 `!important`）：退出码 `1`，报错：
  - `ui/injections/laolao-feedback.css：!important（强制覆盖）增加（基线 1 → 当前 2）。`
  - `ui/injections/laolao-feedback.css：行数增加（基线 218 → 当前 220）。`
- 还原后：`git status -sb` 干净。

### 2. 对照脚本复现（复制至隔离临时目录运行，未修改协调者目录）
- `probe2.cjs`（退出码 `0`）：
  ```text
  multiTarget                {"native":{"callsForFirstTarget":1},"shared":{"callsForFirstTarget":0}}
  disconnectWriteReobserve   {"native":{"calls":1},"shared":{"calls":41}}
  detachedTarget             {"native":{"calls":1},"shared":{"calls":0}}
  shadowRoot                 {"native":{"calls":1},"shared":{"calls":0}}
  documentNoSubtree          {"native":{"calls":0},"shared":{"calls":1}}
  removedBeforeDelivery      {"native":{"records":1},"shared":{"records":1}}
  takeRecords                {"native":{"taken":1},"shared":{"taken":0}}
  hiddenInterval             {"native":{"ticks":11},"shared":{"ticks":0}}
  lateShortInterval          {"native":{"ticks":15},"shared":{"ticks":0}}
  registerInsideHandler      {"native":{"timeoutsPerSecond":0},"shared":{"timeoutsPerSecond":18}}
  ```
- `product.cjs`（退出码 `0`）：
  ```text
  before #53 | data-pinkie-study-desk changed -> reconciles scheduled: 1 []
  before #53 | data-laolao-mode changed -> reconciles scheduled: 1 []
  origin/main | data-pinkie-study-desk changed -> reconciles scheduled: 0 []
  origin/main | data-laolao-mode changed -> reconciles scheduled: 0 []
  ```
