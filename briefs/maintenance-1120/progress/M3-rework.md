# M3 返工 · 恢复观察器和轮询的原生行为

## 接力卡（最后更新：2026-11-21 22:32 -08:00，Gemini-Win-9k4m @ Windows）

- 状态：进行中（第 2 轮返工：已按协调者退回意见简化为原生等价实现并通过 4000 串随机差分、2500 串固定种子差分、17 项差分/产品测试、Z4 棘轮、M2-1、M3-1、11 项热点测试；正在跑 Z1 全量门禁与补充逐处核对表及收工快照）
- 分支和 PR：`maint/m3-fix-dom-watch`，PR [#61](https://github.com/Cle0726/super-pinkie/pull/61)（草稿）
- 已完成：
  1. 开工检查、Z2 开工快照、护栏反例（`!important` +1 拦住）与 `fa57fcc7` 基线复现（`d5cdbd19`）。
  2. 新增 16 项差分与学习提醒产品回归测试并采集 `fa57fcc7` 全部失败证据（`0 pass / 16 fail`）；第 1 轮共用根观察器模拟实现（`4a371dfd`）在 4000 串 `fuzz.cjs` 中暴露不一致、在新增 2500 串固定种子随机差分中失败（86 mismatches / 2500 sequences）。
  3. 按协调者第 1 轮退回意见彻底放弃根观察器模拟：
     - [`ui/injections/laolao-dom-watch.js`](../../../ui/injections/laolao-dom-watch.js)：`createObserver(cb)` 直接返回原生 `new MutationObserver(cb)`（附加 `.watch(target, options)` 等价于带 `subtree: true` 的 `observe`），删除全部 transient/提升/队列模拟代码与加载期空跑根观察器；`every`/`poll` 直接委托原生 `window.setInterval`/`clearInterval`。
     - [`tools/health/exceptions.json`](../../../tools/health/exceptions.json)：仅新增 1 条协调者认可的例外（`ui/injections/laolao-dom-watch.js` `setIntervals: 1`，理由「M3 返工：恢复原生定时语义」）。
     - [`tests/shared-dom-watch.test.mjs`](../../../tests/shared-dom-watch.test.mjs)：如实检验无加载期空根观察器、返回真原生 `MutationObserver` 与真实页面变更投递；M3-2 单一运行时观察器指标如实标为「没过：行为等价优先」。
     - [`tests/dom-watch-native-parity.test.mjs`](../../../tests/dom-watch-native-parity.test.mjs)：补充 2500 串固定种子随机差分（已在 `4a371dfd` 验证失败 86 处），修复后 17/17 全部通过。
  4. 本地验证通过：Z4 棘轮 + M2-1..M2-4 + M3-1（9/9）、`tests/shared-dom-watch.test.mjs`（2/2）、`tests/dom-watch-native-parity.test.mjs`（17/17，含 2500 串 0 不一致）、复制出的 `probe2.cjs`（10/10 一致）、`product.cjs`（1/1 一致）、`fuzz.cjs`（4000 串 0 不一致，nonEmpty=3803）、`tests/hotspot-ui-regression.test.mjs`（11/11）、Z5 `personas/prompts/skills` 零 diff。
- 正在做：运行本地 Z1 全量门禁（并与同环境 `origin/main` 对比），补齐逐处核对表（46 个观察器 / 48 处 observe 调用 + 47 处 `setInterval` 对比 `3cd2ac6f^1`）、Z5 逐字对比、Z2 收工快照，并验证 PR #61 CI 全绿。
- 下一步：
  1. 在隔离环境跑完 Z1（`node tools/release-gate/run-tests.mjs --jobs 2` 与 `python -m unittest discover -s tests -p '*_test.py' -v`），若有任何失败则在同一环境对照 `origin/main` 核实新增失败为 0；
  2. 在 `origin/main` 独立工作树跑 `inject-inventory.mjs` 与本分支逐字核对 Z5；
  3. 把逐处核对表与全部命令/退出码/输出原文片段、CI 运行编号与 Z2 收工快照写入本文件并推送，确认 PR #61 保持草稿且 CI 全绿后停下汇报。
- 没推送的东西：无。
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m3-rework-exec`；隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-rework-exec-9k4m`；端口 5130–5134；后台进程：无。
- 正在跑的长操作：即将运行 Z1 全量门禁（预计 3–6 分钟，日志写入 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-rework-exec-9k4m\z1-branch.log`）。
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
