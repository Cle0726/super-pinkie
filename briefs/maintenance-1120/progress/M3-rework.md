# M3 返工 · 恢复观察器和轮询的原生行为

## 接力卡（最后更新：2026-11-21 23:05 -08:00，Gemini-Win-9k4m @ Windows）

- 状态：自查通过（草稿 PR 待协调者独立复核；M3-2 单一运行时子树观察器条目按「行为等价优先」如实记为「没过」）
- 分支和 PR：`maint/m3-fix-dom-watch`，PR [#61](https://github.com/Cle0726/super-pinkie/pull/61)（保持草稿，未合并、未转可审阅）
- 已完成：
  1. 开工检查、Z2 开工快照、护栏反例（`ui/injections/laolao-feedback.css` 临时加 1 处 `!important`，棘轮退出码 `1` 精准拦截，原样还原）与 `fa57fcc7` 复现（提交 `d5cdbd19`）。
  2. 新增真实浏览器差分测试与学习提醒原样产品测试 [`tests/dom-watch-native-parity.test.mjs`](../../../tests/dom-watch-native-parity.test.mjs)，在未修复的 `fa57fcc7` 上运行得到 `0 pass / 16 fail`（退出码 `1`）。
  3. 第 1 轮共用根观察器模拟实现（`4a371dfd`）经协调者独立随机差分 `fuzz.cjs` 发现 148/4000 不一致；本轮补充 2500 串固定种子随机差分测试并在 `4a371dfd` 上复现失败（86/2500 不一致，退出码 `1`）。
  4. 按协调者第 1 轮退回意见彻底删除共用根观察器模拟代码（提交 `27616375`）：
     - [`ui/injections/laolao-dom-watch.js`](../../../ui/injections/laolao-dom-watch.js)：`createObserver(cb)` 直接返回原生 `new MutationObserver(cb)`（另加 `.watch(target, options)` 等价于带 `subtree: true` 的 `observe`），`observe`/`watchTree` 建在它上面；`every`/`poll` 直接调用原生 `window.setInterval` / `window.clearInterval`（默认 `pauseWhenHidden = false`，不吞异常）；不保留任何加载期空跑的根观察器。
     - [`tools/health/exceptions.json`](../../../tools/health/exceptions.json)：仅新增协调者认可的 1 条精确例外（`ui/injections/laolao-dom-watch.js`，`setIntervals`，`1`，理由「M3 返工：恢复原生定时语义」）。
     - [`tests/shared-dom-watch.test.mjs`](../../../tests/shared-dom-watch.test.mjs)：如实检验无加载期空根观察器、返回真原生 `MutationObserver` 实例、迁移模块与 `watchTree` 真实投递与 `disconnect()` 生效，不修改测量脚本 `tools/health/measure.mjs`。
  5. 逐处核对 #53 (`3cd2ac6f`) 迁移的全部 46 个 `MutationObserver`（48 处 `.observe`/`.watch` 调用）与 47 处 `setInterval`（对比 `3cd2ac6f^1`），完整核对表见下文：目标、选项、`subtree`、间隔、清除方式与 `3cd2ac6f^1` 逐项一致。
  6. 全套验证通过：
     - `tests/dom-watch-native-parity.test.mjs`：17/17 通过（含 2500 串固定种子随机差分 0 不一致 + 学习提醒原样产品测试）；
     - 复制至隔离目录的 `probe2.cjs`（10/10 一致）、`product.cjs`（1/1 一致）、`fuzz.cjs`（4000 串 0 不一致，`nonEmpty: 3803`）；
     - `tests/shared-dom-watch.test.mjs`（2/2 通过）、`tests/code-health-ratchet.test.mjs` + `tests/asset-hash-stamp.test.mjs` + `tests/ui-region-ownership.test.mjs`（9/9 通过）；
     - 现有热点测试 `tests/hotspot-ui-regression.test.mjs`（11/11 通过）；
     - Z5：`personas/prompts/skills` 与 `2c1fa0bb` / `origin/main` 零 diff，`tools/metre/inject-inventory.mjs` 与 `origin/main` (`fa57fcc7`) 逐字一致（SHA-256 `83d992f0564f1e0f82d384719cebc7721df1f940fd777d6c25ca773f6978c95a`）；
     - Z1 本地全量门禁与同环境 `origin/main` 逐项对照：新增失败为 **0**（283 文件中所有本地环境缺失项均与 `origin/main` 相同，`mode-architecture.test.mjs` 独跑 171/171 通过，`windows_portable_update_integration_test.py` 独跑 12/12 通过）；
     - GitHub Actions CI（run `44994294109`，针对 `27616375`）：`macos-check`、`portable-checks`、`windows-build`、`windows-checks` 四项全绿（文档更新推送后将再核实最新 CI 全绿）。
- 正在做：推送本完整记录并等待本提交触发的 CI 全绿，然后停下向协调者汇报（清理临时目录，保留工作区供协调者复核或按要求收尾）。
- 下一步：协调者独立复核 PR #61（当前保持草稿，不合并、不转可审阅）。
- 没推送的东西：无（本次提交即刻推送）。
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m3-rework-exec`；隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-rework-exec-9k4m`（收工前删除）；端口 5130–5134（全部空闲）；后台进程：无。
- 正在跑的长操作：无。
- 踩过的坑：
  - `C:\tmp` 拒绝写入，改用 C 盘 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-rework-exec-9k4m`。
  - 第 1 轮试图在单一共用根观察器上用 `takeRecords` + 逆向父链 + transient map 模拟原生 `MutationObserver`，通过了 16 项定向用例，但在随机差分（`fuzz.cjs` 148/4000、2500 串 86/2500）下仍暴露 53+ 处记录级差异；改回直接返回原生 `MutationObserver` 后 4000 串 + 2500 串全部 **0 不一致**。
  - 首次在全新空隔离 `LOCALAPPDATA` 中启动 Edge 偶发 `DevTools remote debugging requires a non-default data directory`，二次启动即正常。
- 待用户决定：无（请协调者独立复核 PR #61，以及知悉下表 Z2 中 19:21–22:22 停机间隔期间外部对正式环境的改动）。

---

## 一、验收条目自查总表

| 条目 | 结论 | 说明与证据索引 |
|---|---|---|
| 原生等价（观察器与轮询） | **过** | `tests/dom-watch-native-parity.test.mjs` 17/17 过；`probe2.cjs` 10/10 一致；`product.cjs` 1/1 一致；`fuzz.cjs` 4000 串 0 不一致；固定种子 2500 串 0 不一致 |
| #53 逐处核对（46 观察器 + 47 轮询） | **过** | 见第五节完整核对表：每处目标、选项、`subtree`、间隔、清除方式与 `3cd2ac6f^1` 一致 |
| M3-1 ★（区域负责表） | **过** | `tests/ui-region-ownership.test.mjs` 2/2 通过（退出码 `0`） |
| M3-2 ★（整个页面监视整棵子树的观察器只剩 1 个） | **没过：行为等价优先** | 在共用根观察器上模拟原生 `MutationObserver` 经 4000 串独立随机差分证实存在 148 串（53 串记录级）不一致。按任务单与协调者要求，行为等价优先：`createObserver()` 直接返回原生 `MutationObserver` 实例（不保留空跑根观察器），运行时页面存在多个原生子树观察器，因此 M3-2 运行时单一观察器计数不成立，如实记为「没过」，未修改 `tools/health/measure.mjs` 凑数 |
| M3-5（`setInterval` 总数减半） | **过** | `measure.mjs` 实测全仓 `setIntervals = 45`（#53 前基线为 `91`，减少 `50.5%` ≥ 50%） |
| Z1 ★（全量门禁） | **过** | 本地隔离环境对照同环境 `origin/main` 新增失败为 `0`；CI `portable-checks` + `windows-checks` + `macos-check` + `windows-build` 全绿（run `44994294109`）；`known-failures.json` 未增删任何条目 |
| Z2 ★（正式环境未被本任务触碰） | **见说明（停机间隔外部变动）** | 开工 `18:56` 至停机 `19:21`、以及第 2 轮开工 `22:22` 至收工 `23:04` 期间，本任务全部运行在独立隔离临时目录，未触碰任何正式目录或 18789 端口。但本会话在 `19:21–22:22` 停机 3 小时期间，宿主机外部于 `21:52–22:13` 更新并启动了正式环境（详表见第二节），如实记录不隐瞒 |
| Z3 ★（截图比对） | **过（CI Linux Chromium）** | `portable-checks`（run `44994294109`）执行 `PINKIE_VISUAL_REPEAT=3 node --test tests/visual-baseline.test.mjs` 通过，未改动 `tests/visual/baseline/**` |
| Z4 ★（代码健康度棘轮） | **过** | `tests/code-health-ratchet.test.mjs` 3/3 通过、`tests/asset-hash-stamp.test.mjs` 4/4 通过（退出码 `0`）；仅新增协调者认可的 1 条例外：`ui/injections/laolao-dom-watch.js` `setIntervals: 1` |
| Z5 ★（人设/提示词/技能与注入逐字一致） | **过** | `git diff 2c1fa0bb -- personas prompts skills` 与 `git diff origin/main -- personas prompts skills` 均为空；`tools/metre/inject-inventory.mjs` 输出与 `origin/main` 逐字一致（SHA-256 完全相同） |
| 现有热点测试 | **过** | `tests/hotspot-ui-regression.test.mjs` 11/11 通过（退出码 `0`） |

---

## 二、Z2 正式环境快照（只读元数据，绝不修改）

| 检查项 | 开工快照（`2026-11-21 18:56:00 -08:00`） | 收工快照（`2026-11-21 23:03:33 -08:00`） | 说明 |
|---|---|---|---|
| `C:\Users\34786\.openclaw\openclaw.json` | `2026-11-19 23:56:00` / `49217` bytes | `2026-11-21 21:54:19` / `51376` bytes | 发生于 `19:21–22:22` 本会话停机期间（非本任务运行期） |
| `C:\Users\34786\AppData\Local\Programs\SuperPinkie` | `2026-11-21 03:36:23` | `2026-11-21 21:52:01` | 发生于 `19:21–22:22` 本会话停机期间（非本任务运行期） |
| `C:\Users\34786\AppData\Local\SuperPinkie` | `2026-11-21 04:26:46` | `2026-11-21 22:13:57` | 发生于 `19:21–22:22` 本会话停机期间（非本任务运行期） |
| 18789 端口监听 | `NOT_LISTENING` | `127.0.0.1:18789 Listen PID 32388` | 宿主机外部于停机期间启动；本任务全过程使用隔离临时目录与端口 5130–5134，未连接或修改 18789 |
| 端口 5130–5134 | `ALL_FREE` | `ALL_FREE` | 一致 |
| C 盘剩余空间 | `22.19 GB` | `17.76 GB`（清理临时目录前） | 高于 8 GB 红线 |

---

## 三、护栏反例、修复前失败证据与修复后通过证据

### 3.1 开工护栏反例（CONCURRENCY 3.8）
- 命令：`node --test tests/code-health-ratchet.test.mjs`（先原样基线，再向 `ui/injections/laolao-feedback.css` 临时追加 1 处 `!important`，随后原字节还原）
- 基线退出码：`0`（3/3 通过）
- 反例退出码：`1`（2 pass, 1 fail），输出片段：
  ```text
  ✖ 代码健康度：每个文件不能变差，改善后要同步基线 (150.4753ms)
    AssertionError [ERR_ASSERTION]: 代码健康度检查未通过：
    - ui/injections/laolao-feedback.css：!important（强制覆盖）增加（基线 1 → 当前 2）。
    - ui/injections/laolao-feedback.css：行数增加（基线 218 → 当前 220）。
  ```
- 还原后：`git status -sb` 干净。

### 3.2 新增测试在未修复基线 `fa57fcc7` 上的失败输出（16/16 全部失败）
- 命令（隔离临时环境 + `PINKIE_VISUAL_ENGINE=msedge`）：`node --test tests/dom-watch-native-parity.test.mjs`
- 退出码：`1`
- 原始输出片段：
  ```text
  ▶ M3 differential: domWatch observers and polling match native browser APIs
    ✖ multi-target observe and mixed observe+watch do not overwrite earlier targets (645.8026ms)
    ✖ re-observing the same target replaces options without losing earlier queued records (560.8441ms)
    ✖ disconnect discards pending records and disconnect->mutate->observe does not self-trigger (827.9882ms)
    ✖ observe ignores mutations that happened before registration without dropping records for existing observers (585.0674ms)
    ✖ takeRecords returns queued records, clears queue, and does not steal records from other observers (465.4969ms)
    ✖ all options including oldValue, empty attributeFilter, characterData, and invalid option TypeErrors match native (475.354ms)
    ✖ detached targets, detached-after-observe targets, shadowRoot, document, and documentElement without subtree match native (631.6655ms)
    ✖ removed-before-delivery, moved-between-subtrees, and transient observers match native (553.3463ms)
    ✖ observer callback exceptions are reported to console/pageerror and do not block other observers (528.1728ms)
    ✖ polling runs normally while document.hidden is true (both poll and every) (2586.8581ms)
    ✖ late short interval registered after long interval wakes up on its own cadence (3431.7364ms)
    ✖ registering a new interval inside a timer callback does not spawn parallel timeout chains (3237.7561ms)
    ✖ polling callback exceptions are reported to console/pageerror like native setInterval (740.8866ms)
    ✖ mixed connected + shadowRoot targets on the same observer deliver interleaved records and stop cleanly on disconnect (599.9843ms)
  ✖ M3 differential: domWatch observers and polling match native browser APIs (16891.7806ms)
  ✖ M3 product regression: unmodified laolao-learning-reminder.js reacts to both html attributes and body subtree mutations (2750.0557ms)
  ℹ tests 16
  ℹ suites 0
  ℹ pass 0
  ℹ fail 16
  ```
  关键失败断言：
  - `multiTarget`：`actual: [{type:'childList', target:'b', attr:null}]` vs `expected: [{type:'attributes', target:'a', attr:'data-a'}, {type:'childList', target:'b', attr:null}]`
  - `disconnect->mutate->observe`：`loopCalls: 41` vs `1`
  - `detached/shadowRoot/documentNoSubtree`：`detachedCalls: 0, shadowCalls: 0, shadowInnerCalls: 0, htmlNoSubtreeChild: 2, docNoSubtree: 2, afterDetachCalls: 0` vs native `1, 1, 1, 0, 0, 1`
  - `removed/moved/transient`：`aAttrRecords: 0, cAttrRecords: 1` vs native `3, 0`
  - `observer/poll exceptions`：`shared pageErrors: []`
  - `hiddenInterval`：`shared hidden ticks=0`
  - `lateShortInterval`：`shared lateShort ticks=0`
  - `registerInsideHandler`：`20 !== 0`
  - `laolao-learning-reminder.js`：`expected laolao-learning-reminder.js to schedule reconcile when html[data-pinkie-study-desk] changes, got 0`

### 3.3 新增 2500 串固定种子随机差分在 `4a371dfd` 上的失败输出
- 命令：`node --test --test-name-pattern="M3 differential fuzz" tests/dom-watch-native-parity.test.mjs`（代码处于 `4a371dfd` 共用根观察器模拟版）
- 退出码：`1`
- 原始输出片段：
  ```text
  ✖ M3 differential fuzz: fixed-seed randomized differential (2500 sequences, 0 mismatches vs native MutationObserver) (51052.378ms)
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
    AssertionError [ERR_ASSERTION]: random differential fuzz found 86 mismatch(es) across 2500 sequences; first: {"blockIndex":0,"t":4,"native":"[[[false,[[\"childList\",\"n2\",null,null,[\"n8\"],[]]]],[false,[[\"childList\",\"n1\",null,null,[],[\"n3\"]],...","shared":"[[[false,[[\"childList\",\"n2\",null,null,[\"n8\"],[]]]],[false,[[\"childList\",\"n1\",null,null,[],[\"n3\"]],..."}
    86 !== 0
  ```

### 3.4 修复后（`27616375`）全部测试通过输出

1. **`tests/dom-watch-native-parity.test.mjs`（17/17 全部通过）**
   - 命令：`node --test tests/dom-watch-native-parity.test.mjs`
   - 退出码：`0`
   - 原始输出：
     ```text
     ▶ M3 differential: domWatch observers and polling match native browser APIs
       ✔ multi-target observe and mixed observe+watch do not overwrite earlier targets (678.1645ms)
       ✔ re-observing the same target replaces options without losing earlier queued records (504.1028ms)
       ✔ disconnect discards pending records and disconnect->mutate->observe does not self-trigger (896.2257ms)
       ✔ observe ignores mutations that happened before registration without dropping records for existing observers (658.5406ms)
       ✔ takeRecords returns queued records, clears queue, and does not steal records from other observers (615.1594ms)
       ✔ all options including oldValue, empty attributeFilter, characterData, and invalid option TypeErrors match native (621.4696ms)
       ✔ detached targets, detached-after-observe targets, shadowRoot, document, and documentElement without subtree match native (728.6555ms)
       ✔ removed-before-delivery, moved-between-subtrees, and transient observers match native (607.9443ms)
       ✔ observer callback exceptions are reported to console/pageerror and do not block other observers (563.8098ms)
       ✔ polling runs normally while document.hidden is true (both poll and every) (2689.3054ms)
       ✔ late short interval registered after long interval wakes up on its own cadence (3533.9162ms)
       ✔ registering a new interval inside a timer callback does not spawn parallel timeout chains (3269.7519ms)
       ✔ polling callback exceptions are reported to console/pageerror like native setInterval (796.6508ms)
       ✔ mixed connected + shadowRoot targets on the same observer deliver interleaved records and stop cleanly on disconnect (642.6977ms)
     ✔ M3 differential: domWatch observers and polling match native browser APIs (17788.2898ms)
     ✔ M3 differential fuzz: fixed-seed randomized differential (2500 sequences, 0 mismatches vs native MutationObserver) (51623.8777ms)
     ✔ M3 product regression: unmodified laolao-learning-reminder.js reacts to both html attributes and body subtree mutations (2573.5797ms)
     ℹ tests 17
     ℹ pass 17
     ℹ fail 0
     ```

2. **协调者对照脚本（复制至临时目录运行，未修改协调者目录）**
   - 修复前 `fa57fcc7`：
     - `probe2.cjs`（退出码 `0`）：`multiTarget 1 vs 0`、`disconnectWriteReobserve 1 vs 41`、`detachedTarget 1 vs 0`、`shadowRoot 1 vs 0`、`documentNoSubtree 0 vs 1`、`takeRecords 1 vs 0`、`hiddenInterval 11 vs 0`、`lateShortInterval 15 vs 0`、`registerInsideHandler 0 vs 18`
     - `product.cjs`（退出码 `0`）：`before #53` 各 `1`，`origin/main` 各 `0`
   - 修复后 `27616375`：
     - `node "$tmp\evidence\probe2.cjs"`（退出码 `0`）：
       ```text
       multiTarget                {"native":{"callsForFirstTarget":1},"shared":{"callsForFirstTarget":1}}
       disconnectWriteReobserve   {"native":{"calls":1},"shared":{"calls":1}}
       detachedTarget             {"native":{"calls":1},"shared":{"calls":1}}
       shadowRoot                 {"native":{"calls":1},"shared":{"calls":1}}
       documentNoSubtree          {"native":{"calls":0},"shared":{"calls":0}}
       removedBeforeDelivery      {"native":{"records":1},"shared":{"records":1}}
       takeRecords                {"native":{"taken":1},"shared":{"taken":1}}
       hiddenInterval             {"native":{"ticks":11},"shared":{"ticks":11}}
       lateShortInterval          {"native":{"ticks":15},"shared":{"ticks":15}}
       registerInsideHandler      {"native":{"timeoutsPerSecond":0},"shared":{"timeoutsPerSecond":0}}
       ```
     - `node "$tmp\evidence\product.cjs"`（退出码 `0`）：
       ```text
       before #53 | data-pinkie-study-desk changed -> reconciles scheduled: 1 []
       before #53 | data-laolao-mode changed -> reconciles scheduled: 1 []
       origin/main | data-pinkie-study-desk changed -> reconciles scheduled: 1 []
       origin/main | data-laolao-mode changed -> reconciles scheduled: 1 []
       ```
     - `node "$tmp\evidence\fuzz.cjs"`（退出码 `0`）：
       ```text
       { total: 4000, nonEmpty: 3803, mismatches: 0 }
       ```

---

## 四、Z4、Z5、热点测试、Z1 与 CI 证据

### 4.1 语法、Z4 棘轮、M2-1..M2-4、M3-1 与 `shared-dom-watch`
- 命令：`node --check ui/injections/laolao-dom-watch.js`（退出码 `0`）
- 命令：`node --test tests/code-health-ratchet.test.mjs tests/asset-hash-stamp.test.mjs tests/ui-region-ownership.test.mjs`（退出码 `0`，9/9 通过）
- 命令：`node --test tests/shared-dom-watch.test.mjs`（退出码 `0`，2/2 通过）
- `measure.mjs` 实测汇总：
  ```json
  {
    "totals": {
      "important": 5101,
      "mutationObservers": 29,
      "setIntervals": 45,
      "subtreeObserverCalls": 1,
      "windowGlobals": 126,
      "windowGlobalsPerFileSum": 130
    },
    "domWatch": {
      "important": 0,
      "lines": 149,
      "mutationObservers": 1,
      "setIntervals": 1,
      "subtreeObserverCalls": 1,
      "windowGlobals": 0
    }
  }
  ```

### 4.2 现有热点测试
- 命令：`node --test tests/hotspot-ui-regression.test.mjs`
- 退出码：`0`（11/11 通过：H1–H10 全部绿灯，耗时 31.06s）

### 4.3 Z5（人设/提示词/技能 + 注入逐字对照）
- `git diff 2c1fa0bb -- personas prompts skills`：0 行差异
- `git diff origin/main -- personas prompts skills`：0 行差异
- `node tools/metre/inject-inventory.mjs --save-baseline ...`（分别在本分支与 `origin/main` 独立分离头工作树 `fa57fcc7` 运行，退出码均为 `0`）：
  - 本分支 `overallSha256`: `dfc3522f69c468fd36cd882c5877c41e4c52398b425e1b30ff5faf4b8d5ac192`，文件 SHA-256 `83d992f0564f1e0f82d384719cebc7721df1f940fd777d6c25ca773f6978c95a`（385,696 bytes）
  - `origin/main` (`fa57fcc7`) `overallSha256`: `dfc3522f69c468fd36cd882c5877c41e4c52398b425e1b30ff5faf4b8d5ac192`，文件 SHA-256 `83d992f0564f1e0f82d384719cebc7721df1f940fd777d6c25ca773f6978c95a`（385,696 bytes）
  - 结果：**逐字一致（`True`）**

### 4.4 Z1 全量门禁（本地同环境对照 `origin/main` + CI 全绿）
1. **本地隔离环境 Node 全量门禁对比**：
   - 本分支（`27616375`）：`node tools/release-gate/run-tests.mjs --jobs 2` → 退出码 `1`，`283 test files, 22 failing tests, 2 known`
     - 其中 21 处为宿主机未安装 WebKit / `playwright` / `pwsh` 导致的环境缺失（`learning-desk.test.mjs` 1、`metre-board-scroll-e2e.test.mjs` 2、`sidebar-handshake.test.cjs` 1、`study-desk-chat-entry.test.cjs` 1、`study-desk-panes.test.cjs` 1、`study-desk-ui.test.cjs` 13、`tool-images-e2e.test.mjs` 1、`windows-shared-chat.test.cjs` 1）；
     - 另外 1 处并行负载下的 `tests/mode-architecture.test.mjs :: cross-process audit writers preserve every record in one valid chain` 单独重跑 `node --test tests/mode-architecture.test.mjs` **171/171 全通过（退出码 `0`）**。
   - 同环境 `origin/main`（`fa57fcc7`）：`node tools/release-gate/run-tests.mjs --jobs 2` → 退出码 `1`，`282 test files, 22 failing tests, 2 known`（完全相同的 8 个缺失 WebKit/`playwright`/`pwsh` 文件共 22 项失败）。
   - **对照结论：相对 `origin/main` 新增 Node 失败为 `0`。**
2. **本地隔离环境 Python 全量单测对比**：
   - 本分支：`PYTHONUTF8=1 python -m unittest discover -s tests -p '*_test.py' -v` → 退出码 `1`（`Ran 538 tests in 372.808s, FAILED (failures=2, skipped=15)`，失败均在 `windows_portable_update_integration_test.py`）。
   - 独跑对照：
     - 本分支 `python -m unittest tests/windows_portable_update_integration_test.py -v` → **退出码 `0`（`Ran 12 tests in 155.990s — OK`）**；
     - 同环境 `origin/main` 跑同一文件 → 退出码 `1`（`Ran 12 tests in 211.027s`，同样存在宿主机并发/锁时序失败）。
   - **对照结论：相对 `origin/main` 新增 Python 失败为 `0`。**
3. **GitHub Actions CI（run `44994294109`，commit `27616375`）**：
   - `macos-check`：`pass`（1m9s，job `137121882387`）
   - `portable-checks`：`pass`（6m59s，job `137121882082` — 含 Linux Chromium 3x 截图门禁、全量 Node 含 `dom-watch-native-parity.test.mjs` 2500 串差分、全量 Python）
   - `windows-build`：`pass`（4m1s，job `137123471258`）
   - `windows-checks`：`pass`（8m39s，job `137121882271` — 含全量 Windows Node + WebKit + 全量 Python）

---

## 五、#53 迁移调用点逐处核对表（对比 `3cd2ac6f^1`）

### 5.1 全部 46 个迁移的 `MutationObserver`（48 处 `.observe` / `.watch` 调用）

注：在 `27616375` 返工后，`window.Pinkie.domWatch.createObserver(cb)` 直接返回原生 `MutationObserver` 实例，`observer.watch(target, opts)` 等价于原生 `observer.observe(target, {...opts, subtree: true})`。经逐行比对 `git diff 3cd2ac6f^1..HEAD -- ui/injections/`，全部 46 个观察器在目标、选项、`subtree`、清除方式上与 `3cd2ac6f^1` 逐项一致；其中 `#9 laolao-learning-reminder.js` 的双目标调用曾因 #53 单目标槽覆盖而失效，现随原生实例恢复正常。

| # | 文件 | 观察器位置 | 目标（Target） | 选项（Options） | `subtree` | 清除方式（Cleanup） | 与 `3cd2ac6f^1` 核对结果 |
|---|---|---|---|---|---|---|---|
| 1 | `ui/injections/laolao-artifacts.js` | L704 / L709 | `document.body` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 2 | `ui/injections/laolao-biqi-notices.js` | L276 / L296 | `document.body` | `{childList: true, characterData: true, attributes: true, attributeFilter: ['data-message-text']}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 3 | `ui/injections/laolao-classic-shell.js` | L423 / L429 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 4 | `ui/injections/laolao-cle-stage.js` | L801 / L807 | `h`（`.chat-thread-inner`） | `{childList: true, attributes: true, attributeFilter: ['data-live', 'class']}` | `true`（`.watch`） | `mo.disconnect()`（L805 重绑、L812 `pagehide`） | 一致 |
| 5 | `ui/injections/laolao-desk-chat.js` | L327 / L334 | `conversation()?.root() \|\| document.body` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 6 | `ui/injections/laolao-first-person.js` | L159 / L164 | `root`（`openclaw-app` 等） | `{childList: true, characterData: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 7 | `ui/injections/laolao-game-hud.js` | L185 | `host.ownerDocument.body` | `{childList: true}` | `true`（`.watch`） | 回调第 2 参数 `o.disconnect()`（L185） | 一致 |
| 8 | `ui/injections/laolao-learning-inline.js` | L856 / L865 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 9a | `ui/injections/laolao-learning-reminder.js` | L115 / L119 | `root`（`document.documentElement`） | `{attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-study-desk']}` | `false`（`.observe`） | `observer.disconnect()`（L126 `pagehide`，`pageshow` 重绑） | 一致（原 #53 被 9b 覆盖，现已恢复） |
| 9b | `ui/injections/laolao-learning-reminder.js` | L115 / L120 | `document.body` | `{childList: true, attributes: true, attributeFilter: ['data-laolao-mode-label']}` | `true`（`.watch`） | 同 9a（共用同一观察器实例） | 一致 |
| 10 | `ui/injections/laolao-learning-stage.js` | L662 / L665 | `document.body` | `{childList: true, characterData: true}` | `true`（`.watch`） | `chatObserver?.disconnect()`（L670 `pagehide`） | 一致 |
| 11 | `ui/injections/laolao-live-voice.js` | L207 / L219 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 12 | `ui/injections/laolao-material-preview.js` | L808 | `document.body` | `{childList: true, attributes: true, attributeFilter: ["data-laolao-material-path"]}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 13 | `ui/injections/laolao-message-actions.js` | L494 / L500 | `document.body` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 14 | `ui/injections/laolao-metre-backdrop.js` | L1163 / L1166 | `shell`（`openclaw-app \|\| document.body`） | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 15 | `ui/injections/laolao-metre-board.js` | L411 / L414 | `shell`（`.shell \|\| document.body`） | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 16 | `ui/injections/laolao-metre-brand.js` | L238 / L241 | `shell`（`.shell \|\| document.body`） | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 17 | `ui/injections/laolao-metre-home.js` | L344 / L351 | `root`（`document.documentElement`） | `{childList: true, attributes: true, attributeFilter: ['class', 'data-laolao-startup-home', 'data-laolao-mode']}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 18 | `ui/injections/laolao-metre-skin.js` | L149 | `el`（tempo 节点） | `{childList: true, characterData: true}` | `true`（`.watch`） | 无（WeakSet 跟踪） | 一致 |
| 19 | `ui/injections/laolao-metre-skin.js` | L258 / L259 | `scope`（`SCOPE` 匹配节点） | `{childList: true, characterData: true, attributes: true, attributeFilter: ATTRS}` | `true`（`.watch`） | `observer.disconnect()`（L265 `detach`） | 一致 |
| 20 | `ui/injections/laolao-metre-skin.js` | L279 | `el`（`<title>`） | `{childList: true, characterData: true}` | `true`（`.watch`） | `titleObserver?.disconnect()`（L282 `titleOff`） | 一致 |
| 21 | `ui/injections/laolao-mode-switcher.js` | L1184 / L1202 | `document.documentElement` | `{childList: true, attributes: true, attributeFilter: ["src", "data-pk-wb-compact", "data-pinkie-study-desk", "data-laolao-workspace-split", "data-laolao-workspace-dock", "data-pinkie-platform"]}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 22 | `ui/injections/laolao-model-picker.js` | L968 / L974 | `details` | `{childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-selected", "disabled"]}` | `true`（`.watch`） | `watcher.disconnect()`（L1930 脱离文档清理） | 一致 |
| 23 | `ui/injections/laolao-model-picker.js` | L1927 / L1937 | `document.body` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 24 | `ui/injections/laolao-motion-preference.js` | L81 / L88 | `document.documentElement` | `{childList: true, characterData: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 25 | `ui/injections/laolao-phrases.js` | L481 / L482 | `head`（`document.head`） | `{childList: true, characterData: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 26 | `ui/injections/laolao-phrases.js` | L702 / L716 | `appRoot`（`openclaw-app` 等） | `{childList: true, characterData: true, attributes: true, attributeFilter: ["title", "aria-label", "alt", "placeholder"]}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 27 | `ui/injections/laolao-plan.js` | L128 / L129 | `host`（`.chat-thread-inner`） | `{childList: true}` | `true`（`.watch`） | `view.observer.disconnect()`（L120 脱离文档清理） | 一致 |
| 28 | `ui/injections/laolao-process-card.js` | L661 / L676 | `document.documentElement` | `{childList: true, attributes: true, attributeFilter: ['data-live', 'data-state', 'data-pinkie-process', 'data-pinkie-row-count', 'data-pinkie-thinking-seg', 'data-pinkie-history-revision']}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 29 | `ui/injections/laolao-queue-steer.js` | L441 | `root`（`openclaw-app` 等） | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 30 | `ui/injections/laolao-reading-view.js` | L32 / L35 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 31 | `ui/injections/laolao-resume.js` | L2583 / L2595 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | `readyObserver?.disconnect()`（L2591）及 10s 兜底 `readyObserver.disconnect()`（L2597） | 一致 |
| 32 | `ui/injections/laolao-rich.js` | L573 / L574 | `h`（`.chat-thread-inner`） | `{childList: true, attributes: true, attributeFilter: ['class']}` | `true`（`.watch`） | `observer.disconnect()`（L571 脱离文档清理） | 一致 |
| 33 | `ui/injections/laolao-session-cards.js` | L519 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 34 | `ui/injections/laolao-session-tools.js` | L1139 / L1144 | `document.body` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 35 | `ui/injections/laolao-side-layout.js` | L28 / L32 | `nav`（`aside.sidebar .sidebar-nav`） | `{childList: true}` | `true`（`.watch`） | `observer.disconnect()`（L42 `pagehide`） | 一致 |
| 36 | `ui/injections/laolao-sidebar.js` | L2070 / L2071 | `document.documentElement` | `{childList: true}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 37 | `ui/injections/laolao-startup-home.js` | L571 / L572 | `document.body` | `{childList: true}` | `true`（`.watch`） | `observer?.disconnect()`（L336 退出、L570 重绑） | 一致 |
| 38 | `ui/injections/laolao-stream-fx.js` | L101 / L109 | `bubble` | `{childList: true}` | `true`（`.watch`） | `observer?.disconnect()`（L116 `detachFromBubble`） | 一致 |
| 39a | `ui/injections/laolao-stream-fx.js` | L158 / L186 | `root`（`ROOT_SEL`） | `{childList: true, attributes: true, attributeFilter: ["class"]}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 39b | `ui/injections/laolao-stream-fx.js` | L158 / L194 | `r`（延迟挂载后的 `ROOT_SEL`） | `{childList: true, attributes: true, attributeFilter: ["class"]}` | `true`（`.watch`） | 无（常驻，与 39a 为 if/else 分支） | 一致 |
| 40 | `ui/injections/laolao-stream-fx.js` | L190 / L198 | `document.body` | `{childList: true}` | `true`（`.watch`） | `pending.disconnect()`（L193 命中、L200 60s 兜底） | 一致 |
| 41 | `ui/injections/laolao-study-desk-lesson.js` | L338 | `column`（`messageColumn()`） | `{childList: true, characterData: true}` | `true`（`.watch`） | `messageObserver?.disconnect()`（L218 `clearBar`） | 一致 |
| 42 | `ui/injections/laolao-study-desk.js` | L853 / L854 | `root`（学习台根节点） | `{childList: true}` | `true`（`.watch`） | `watch.disconnect()`（L855 返回 dispose 函数） | 一致 |
| 43 | `ui/injections/laolao-study-desk.js` | L870 | `root`（学习台根节点） | `{childList: true, attributes: true, attributeFilter: ['src']}` | `true`（`.watch`） | `mutations.disconnect()`（L871 `disposeStickers`） | 一致 |
| 44 | `ui/injections/laolao-study-desk.js` | L932 / L937 | `document.body` | `{childList: true, attributes: true, attributeFilter: ['class']}` | `true`（`.watch`） | `state.entryObserver?.disconnect()`（L918 隐藏时） | 一致 |
| 45 | `ui/injections/laolao-usage-stats.js` | L356 / L365 | `document.documentElement` | `{childList: true, attributes: true, attributeFilter: ["class"]}` | `true`（`.watch`） | 无（常驻） | 一致 |
| 46 | `ui/injections/laolao-workspace-focus.js` | L183 / L187 | `rail` | `{childList: true}` | `true`（`.watch`） | `observer.disconnect()`（L188 `pagehide`） | 一致 |

### 5.2 全部 47 处迁移的 `setInterval` 轮询调用点

注：在 `27616375` 返工后，`window.Pinkie.domWatch.poll(fn, ms)` 内部直接委托原生 `window.setInterval(fn, ms)`（默认 `pauseWhenHidden = false`，隐藏/最小化照常按原间隔运行、独立间隔、不吞异常）。全部 47 处原代码均不保存定时器 ID、无 `clearInterval`，与 `3cd2ac6f^1` 逐项一致。

| # | 文件 | 行号 | 原间隔（`3cd2ac6f^1`） | 现间隔（`poll`） | 清除方式 | 隐藏时行为 | 与 `3cd2ac6f^1` 核对结果 |
|---|---|---|---|---|---|---|---|
| 1 | `ui/injections/laolao-artifacts.js` | L712 | `2000` | `2000` | 无（常驻） | 照常运行 | 一致 |
| 2 | `ui/injections/laolao-ask-user.js` | L269 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 3 | `ui/injections/laolao-capabilities.js` | L563 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 4 | `ui/injections/laolao-capabilities.js` | L570 | `1200` | `1200` | 无（常驻） | 照常运行 | 一致 |
| 5 | `ui/injections/laolao-classic-shell.js` | L431 | `1200`（无 MO 降级分支） | `1200` | 无（常驻） | 照常运行 | 一致 |
| 6 | `ui/injections/laolao-cle-stage.js` | L349 | `2000` | `2000` | 无（常驻） | 照常运行 | 一致 |
| 7 | `ui/injections/laolao-cle-stage.js` | L810 | `300` | `300` | 无（常驻） | 照常运行 | 一致 |
| 8 | `ui/injections/laolao-composer-tray.js` | L229 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 9 | `ui/injections/laolao-context-compact.js` | L806 | `900` | `900` | 无（常驻） | 照常运行 | 一致 |
| 10 | `ui/injections/laolao-deep-think.js` | L1036 | `900` | `900` | 无（常驻） | 照常运行（回调内自带 `if (!document.hidden)`） | 一致 |
| 11 | `ui/injections/laolao-deep-think.js` | L1037 | `450` | `450` | 无（常驻） | 照常运行（`syncWorkSession()` 隐藏时亦须执行） | 一致 |
| 12 | `ui/injections/laolao-desensitize.js` | L345 | `700` | `700` | 无（常驻） | 照常运行 | 一致 |
| 13 | `ui/injections/laolao-feedback.js` | L393 | `1200` | `1200` | 无（常驻） | 照常运行 | 一致 |
| 14 | `ui/injections/laolao-game-demo.js` | L41 | `500` | `500` | 无（常驻） | 照常运行 | 一致 |
| 15 | `ui/injections/laolao-immersion.js` | L178 | `300`（无 `__pinkieQuiet` 降级） | `300` | 无（常驻） | 照常运行 | 一致 |
| 16 | `ui/injections/laolao-laser-pointer.js` | L843 | `1500`（`mountRail`，降级分支） | `1500` | 无（常驻） | 照常运行 | 一致 |
| 17 | `ui/injections/laolao-laser-pointer.js` | L843 | `1500`（`mount`，降级分支） | `1500` | 无（常驻） | 照常运行 | 一致 |
| 18 | `ui/injections/laolao-link-viewer.js` | L347 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 19 | `ui/injections/laolao-memory.js` | L223 | `1200` | `1200` | 无（常驻） | 照常运行 | 一致 |
| 20 | `ui/injections/laolao-message-actions.js` | L504 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 21 | `ui/injections/laolao-native.js` | L268 | `15_000` | `15_000` | 无（常驻） | 照常运行 | 一致 |
| 22 | `ui/injections/laolao-party-entry.js` | L36 | `1500`（无 `__pinkieQuiet` 降级） | `1500` | 无（常驻） | 照常运行 | 一致 |
| 23 | `ui/injections/laolao-plan.js` | L149 | `1200` | `1200` | 无（常驻） | 照常运行 | 一致 |
| 24 | `ui/injections/laolao-power-settings.js` | L288 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 25 | `ui/injections/laolao-process-card.js` | L680 | `250` | `250` | 无（常驻） | 照常运行 | 一致 |
| 26 | `ui/injections/laolao-progress.js` | L34 | `2000` | `2000` | 无（常驻） | 照常运行 | 一致 |
| 27 | `ui/injections/laolao-resume.js` | L1459 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 28 | `ui/injections/laolao-resume.js` | L2381 | `1000`（闭合于 L2422） | `1000` | 无（常驻） | 照常运行 | 一致 |
| 29 | `ui/injections/laolao-rich.js` | L579 | `400` | `400` | 无（常驻） | 照常运行 | 一致 |
| 30 | `ui/injections/laolao-roundtable-entry.js` | L30 | `1500`（无 `__pinkieQuiet` 降级） | `1500` | 无（常驻） | 照常运行 | 一致 |
| 31 | `ui/injections/laolao-run-notify.js` | L285 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 32 | `ui/injections/laolao-run-notify.js` | L301 | `60_000` | `60_000` | 无（常驻） | 照常运行 | 一致 |
| 33 | `ui/injections/laolao-run-status.js` | L672 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 34 | `ui/injections/laolao-session-tools.js` | L113 | `300` | `300` | 无（常驻） | 照常运行 | 一致 |
| 35 | `ui/injections/laolao-session-tools.js` | L1146 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 36 | `ui/injections/laolao-settings-user.js` | L1622 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 37 | `ui/injections/laolao-sidebar-autohide.js` | L263 | `350` | `350` | 无（常驻） | 照常运行 | 一致 |
| 38 | `ui/injections/laolao-sidebar.js` | L2034 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 39 | `ui/injections/laolao-sidebar.js` | L2075 | `500` | `500` | 无（常驻） | 照常运行 | 一致 |
| 40 | `ui/injections/laolao-tool-images.js` | L194 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |
| 41 | `ui/injections/laolao-tool-images.js` | L197 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 42 | `ui/injections/laolao-tool-stream.js` | L178 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 43 | `ui/injections/laolao-usage-stats.js` | L338 | `REFRESH_MS`（`15000`） | `REFRESH_MS`（`15000`） | 无（常驻） | 照常运行 | 一致 |
| 44 | `ui/injections/laolao-usage-stats.js` | L339 | `1000` | `1000` | 无（常驻） | 照常运行 | 一致 |
| 45 | `ui/injections/laolao-web-gpt-collab.js` | L1081 | `700` | `700` | 无（常驻） | 照常运行 | 一致 |
| 46 | `ui/injections/laolao-workbench.js` | L1284 | `2500` | `2500` | 无（常驻） | 照常运行 | 一致 |
| 47 | `ui/injections/laolao-workbench.js` | L2330 | `1500` | `1500` | 无（常驻） | 照常运行 | 一致 |

---

## 六、收工大白话小结

- **做了什么**：把 `ui/injections/laolao-dom-watch.js` 里所有「共用根观察器模拟」和「带隐藏暂停的单链轮询」全部删掉，改成直接委托浏览器原生 `MutationObserver`（只加一个带 `subtree: true` 的 `.watch()` 便捷方法）和原生 `window.setInterval` / `clearInterval`；删掉了加载时白跑的根观察器；仅在 `tools/health/exceptions.json` 加了协调者认可的 1 条 `setIntervals: 1` 例外；新增真实浏览器差分测试（14 项定向差分 + 2500 串固定种子随机差分 + 原样加载 `laolao-learning-reminder.js` 产品测试），并在修复前 `fa57fcc7` 和 `4a371dfd` 上验证失败、修复后全部通过；逐处核对了 #53 迁走的全部 46 个观察器和 47 处轮询。
- **哪些过了**：原生行为差分（17/17，含 2500 串 0 不一致）、独立随机差分 `fuzz.cjs`（4000 串 0 不一致）、`probe2.cjs`（10/10）、`product.cjs`（1/1）、`shared-dom-watch.test.mjs`（2/2）、Z4 棘轮 + M2-1..M2-4 + M3-1（9/9）、现有热点测试（11/11）、Z5 逐字对比、Z1（本地对照 `origin/main` 0 新增失败；CI 四路全绿）。
- **哪些没过及原因**：**M3-2（全页运行期只剩 1 个子树观察器）如实记为「没过：行为等价优先」**——共用根观察器模拟在随机差分下存在多处无法与原生 DOM 规范对齐的记录与时序差异，因此改为直接返回原生 `MutationObserver` 实例以保证 100% 行为等价。另外 Z2 在 `19:21–22:22` 本会话停机期间宿主机外部有一次正式环境更新/启动，已如实记录时间戳（本任务运行期间未触碰任何正式目录或 18789 端口）。
- **下一批要注意**：PR #61 保持草稿状态等待协调者独立复核与合并，未触碰 PR #54 / #57 / #59 的分支与文件，未改动样式、文案、截图基线和 `known-failures.json`。
