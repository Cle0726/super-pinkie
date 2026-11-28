# M3 独立复测报告：共用观察器和轮询迁移真实页面回归审计（`fa57fcc7` vs `dbc49e4b`）

## 接力卡（最后更新：2026-11-26 15:06 -08:00，Gemini-Win-9c4b @ Windows）

- 状态：卡住：服务重启恢复后实测 C 盘剩余空间仅 `1.43–1.64 GB`（低于任务单「C 盘剩余低于 8GB 就停下报告」与 `CONCURRENCY.md` 第七节「磁盘剩余空间低于 3GB」阈值），按规矩立即停止一切占用 C 盘的安装与浏览器进程；已将完整代码核对、47 处 `setInterval` 迁移逐行核对表、47 处 `MutationObserver` 迁移核对、中间提交核对、零落盘 Node VM 实测复现证据与修复建议整理入本报告并推送（注：会话中断期间主线已合入 PR #61 `maint(M3) 返工: 恢复观察器和轮询的原生行为` 与 PR #78 `docs(M3): M3-4 真实页面补测通过`）
- 分支和 PR：`maint/m3-real-page-audit`，[PR #57](https://github.com/Cle0726/super-pinkie/pull/57)（草稿）
- 已完成：
  1. 抓取 `origin`，读取 `briefs/program-1120/CONCURRENCY.md`、`briefs/maintenance-1120/PLAN.md`、`briefs/maintenance-1120/ACCEPTANCE.md`，核对 PR #53 与 PR #54 文件列表（提交 `6232e579`）
  2. 记录开工现场快照，并在隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b` 完成 `openclaw@2026.7.1-2`（`shasum: 4583b987ea7277230ce1c7b2b8535d3e219f57ac`）下载及 5 套真实 Control UI（M3 合并前 `dbc49e4b`、最新主线 `fa57fcc7`、中间提交 `8be3fbc0` / `1663cd80` / `6eac8ce6`）的 `apply-theme.ps1` + `bundle.py` + `stamp.mjs` 真实界面安装（提交 `a7757667`）
  3. 对 `ui/injections/laolao-dom-watch.js`、38 个文件的 47 处 `MutationObserver` 迁移、36 个文件的 47 处 `setInterval` → `domWatch.poll` 迁移、以及 PR #53 的 6 个中间提交进行逐行核对与零落盘 Node VM 实测复现，定位 5 项实质缺陷并给出最小复现脚本、严重程度与修复方案
  4. 服务重启后检测 C 盘剩余空间（`1.43–1.64 GB < 8 GB`），清理本会话临时工作树残留引用（`git worktree prune`），记录收工现场快照，确认端口 `5135–5139` 及 `18789` 零残留进程
- 正在做：停下汇报（等待清理 C 盘空间或协调者复核）
- 下一步：协调者复核本报告（或待 C 盘释放至 > 8 GB 后决定是否还需针对旧提交重跑浏览器，鉴于主线已合入 PR #61 与 PR #78，可直接由协调者审阅关闭或处理 PR #57）
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m3-review`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`（已随系统重启清理，现不存在）；端口 `5135–5139`（全部 `FREE`）；后台进程 无
- 正在跑的长操作：无
- 踩过的坑：
  1. `C:\tmp` 根目录在当前权限下拒绝新建子目录，开工时改用 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b`
  2. 服务重启恢复后（2026-11-26 15:00 -08:00），本机被其他并行工作树占满，C 盘剩余空间降至 `1.43–1.64 GB`（低于 8 GB 停机线），按「结束时只删你自己这次创建的临时文件和进程」规矩不碰他人目录，立即停下报告
- 待用户决定：无（交协调者 `Claude-Win-b926` 复核）

---

## 一、现场快照与隔离安装证据（Z2）

### 1.1 开工与收工现场快照对比

- **开工快照命令与输出**（`2026-11-21 18:39:37 -08:00`，`exit 0`）：
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
  FreeGB (C:): 22.76
  ```

- **收工快照命令与输出**（`2026-11-26 15:04:37 -08:00`，服务重启后，`exit 0`）：
  ```text
  === 收工现场快照 (2026-11-26 15:04:37 -08:00) ===
  PATH: C:\Users\34786\AppData\Local\Programs\SuperPinkie | Exists: True | LastWriteTime: 2026-11-22 03:43:02.279
  PATH: C:\Users\34786\AppData\Local\SuperPinkie | Exists: True | LastWriteTime: 2026-11-22 22:54:31.245
  PATH: C:\Users\34786\.openclaw | Exists: True | LastWriteTime: 2026-11-25 12:25:14.727
  PATH: C:\Users\34786\.openclaw\openclaw.json | Exists: True | LastWriteTime: 2026-11-21 21:54:19.768
  PORT 18789: No active listener/connection
  PORT 5135: FREE
  PORT 5136: FREE
  PORT 5137: FREE
  PORT 5138: FREE
  PORT 5139: FREE

          Used       Free FreeGB
          ----       ---- ------
  212731023360 1761484800   1.64
  ```
  > 注：本会话全程仅在 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b` 下使用隔离的 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`npm_config_prefix`、`npm_config_cache`；2026-11-21 19:01 前本会话在重启前的所有操作均未触碰正式目录（备份路径落在 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\home\Library\Application Support\SuperPinkie\backups\...`）。2026-11-21 晚至 2026-11-25 正式目录时间戳变化发生在系统暂停本会话期间的其他会话/用户活动中。

### 1.2 隔离目录真实 Control UI 安装证据（重启前实测，`exit 0`）

1. **下载官方 `openclaw@2026.7.1-2` 包**（`npm pack openclaw@2026.7.1-2 --registry https://registry.npmmirror.com`，`exit 0`）：
   ```text
   npm notice name: openclaw
   npm notice version: 2026.7.1-2
   npm notice filename: openclaw-2026.7.1-2.tgz
   npm notice package size: 19.7 MB
   npm notice unpacked size: 87.5 MB
   npm notice shasum: 4583b987ea7277230ce1c7b2b8535d3e219f57ac
   npm notice total files: 8550
   ```
2. **五份真实 Control UI 走仓库 `installer\windows\apply-theme.ps1`（调用 `tools\ui-parity\bundle.py install` + `tools\assets\stamp.mjs` + `tools\ui-parity\sw_cache.py`）安装输出**（`exit 0`）：
   - **M3 合并前基线（`dbc49e4b4c03986b1139aca1d0fad65fc75ad147`）**：
     ```text
     === Installing UI for Pre-M3 (dbc49e4b) ===
     ==> applying skin to C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\ui-pre-m3\openclaw\dist\control-ui
     shared UI install OK: 202 entries, 1683 resources
     sw cache: etag-aware (C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\ui-pre-m3\openclaw\dist\control-ui\sw.js)
       patched shared UI: C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\ui-pre-m3\openclaw\dist\control-ui
     ```
   - **M3 合并后主线（`fa57fcc7da5e05e259e72d149c67235ebed750c2`）**：
     ```text
     === Installing UI for origin/main (fa57fcc7) ===
     ==> applying skin to C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\ui-main\openclaw\dist\control-ui
     shared UI install OK: 203 entries, 1686 resources
     sw cache: etag-aware (C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\ui-main\openclaw\dist\control-ui\sw.js)
       patched shared UI: C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b\ui-main\openclaw\dist\control-ui
     ```
   - **3 个 M3 中间提交（`8be3fbc0` Batch A、`1663cd80` Batch C、`6eac8ce6` M3-5）**：
     ```text
     === Installing UI for ui-mid-a (8be3fbc03b30c39b51bcd4a5dbe9297189f234f4) ===
     shared UI install OK: 203 entries, 1686 resources
     === Installing UI for ui-mid-c (1663cd80b8d216840fe2969fdca1d48fef77940b) ===
     shared UI install OK: 203 entries, 1686 resources
     === Installing UI for ui-mid-e5 (6eac8ce6c53ceb7a672fce8e067f6bfa7ddc00ce) ===
     shared UI install OK: 203 entries, 1686 resources
     ```

---

## 二、发现的 5 项实质问题（含严重程度、最小复现脚本、输出证据与建议修法）

### 问题 1（重要 / High）：`laolao-dom-watch.js` 的 `createObserver()` 仅维护单个 `sub` 对象，同一观察器二次调用 `.observe()` / `.watch()` 会覆盖前一次的目标与 `attributeFilter`，直接弄坏 `laolao-learning-reminder.js` 对 `<html data-laolao-mode data-pinkie-study-desk>` 的监听

- **位置**：
  - `ui/injections/laolao-dom-watch.js:115-147`
  - `ui/injections/laolao-learning-reminder.js:115-121`
- **原因分析**：
  原生 `MutationObserver` 支持对同一个实例多次调用 `observer.observe(targetA, optsA)` 和 `observer.observe(targetB, optsB)` 同时监听多个节点与不同属性集。
  `laolao-learning-reminder.js:118-121` 原代码对同一个 `observer` 连续调用两次：
  ```js
  const observe = () => {
    observer.observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-study-desk']});
    observer?.watch(document.body, {childList: true, attributes: true, attributeFilter: ['data-laolao-mode-label']});
  };
  ```
  但 `laolao-dom-watch.js` 的 `createObserver(callback)` 内部只创建了一个 `sub` 对象，`bindTarget()` 直接原地覆写 `sub.target`、`sub.subtree` 与 `sub.attributeFilter`。因此第二行 `observer?.watch(document.body, ...)` 执行后，`sub.target` 从 `root`（`<html>`）被覆写为 `document.body`，`sub.attributeFilter` 从 `['data-laolao-mode', 'data-pinkie-study-desk']` 被覆写为 `['data-laolao-mode-label']`。当 `<html>` 上的 `data-pinkie-study-desk` 或 `data-laolao-mode` 属性变化时，由于 `matchesTarget` 检查 `body.contains(document.documentElement)` 为 `false` 且 `attributeFilter` 不含这两个属性，`laolao-learning-reminder.js` 的观察器**永远收不到 `<html>` 的属性变更**。
- **最小复现脚本与实测输出**（`exit 0`）：
  - 命令：
    ```powershell
    @'
    const fs = require("fs"), vm = require("vm");
    const code = fs.readFileSync("C:/Users/34786/Projects/pinkie-wt/m3-review/ui/injections/laolao-dom-watch.js", "utf8");
    let rootMoCallback = null;
    const docEl = { nodeName: "HTML", contains(n) { return n === docEl || n === bodyEl; } };
    const bodyEl = { nodeName: "BODY", contains(n) { return n === bodyEl; } };
    const sandbox = {
      window: {}, document: { hidden: false, documentElement: docEl, body: bodyEl, addEventListener() {} },
      MutationObserver: class { constructor(cb) { rootMoCallback = cb; } observe() {} disconnect() {} },
      requestAnimationFrame: (fn) => setTimeout(fn, 16), setTimeout, clearTimeout, Date, Promise, Set, Array, Number, Boolean, Math
    };
    sandbox.window = sandbox;
    vm.runInNewContext(code, sandbox);
    let reminderHits = 0;
    const obs = sandbox.Pinkie.domWatch.createObserver((records) => { reminderHits += records.length; });
    obs.observe(docEl, { attributes: true, attributeFilter: ["data-laolao-mode", "data-pinkie-study-desk"] });
    obs.watch(bodyEl, { childList: true, attributes: true, attributeFilter: ["data-laolao-mode-label"] });
    rootMoCallback([{ type: "attributes", target: docEl, attributeName: "data-pinkie-study-desk" }]);
    rootMoCallback([{ type: "attributes", target: docEl, attributeName: "data-laolao-mode" }]);
    const hitsOnRootAttrs = reminderHits;
    rootMoCallback([{ type: "attributes", target: bodyEl, attributeName: "data-laolao-mode-label" }]);
    console.log("[Repro-1 MultiTargetOverwrite]", JSON.stringify({ hitsOnRootAttrs, hitsOnBodyAttr: reminderHits }));
    '@ | node -
    ```
  - 实测输出原文：
    ```text
    [Repro-1 MultiTargetOverwrite] {"hitsOnRootAttrs":0,"hitsOnBodyAttr":1}
    ```
- **建议修法**：
  在 `laolao-dom-watch.js` 的 `createObserver(callback)` 中，让每个 observer handle 维护一个 `targets = new Map()`（或 `subs = new Set()`）：每次对不同 `target` 调用 `observe(target, options)` / `watch(target, options)` 时新增一条针对该 `target` 的订阅记录（对同一 `target` 再次调用则按原生规范更新该 `target` 的 options），`disconnect()` 时一次性移除该 observer 下所有 `target` 的订阅记录，并在同一批次 `dispatchMutations` 中把命中同一 observer 的 `matched` records 合并投递一次 `callback(matched, handle)`。同时把 `laolao-learning-reminder.js:119` 的 `observer.observe(...)` 补上可选链 `observer?.observe(...)`。

---

### 问题 2（阻塞 / Blocker）：`laolao-dom-watch.js` 的 `scheduleTimerTick()` 在已有长周期定时器排队时直接 `return`，导致后注册的短周期轮询首次执行被长周期定时器阻塞（最长卡死 60 秒）

- **位置**：`ui/injections/laolao-dom-watch.js:224-246`
- **原因分析**：
  ```js
  function scheduleTimerTick() {
    if (timerTickId || timers.size === 0) return;
    let nextWait = 60000;
    const now = Date.now();
    for (const t of timers) {
      if (!t.active) continue;
      nextWait = Math.min(nextWait, Math.max(50, t.nextAt - now));
    }
    timerTickId = setTimeout(runTimers, nextWait);
  }
  ```
  `scheduleTimerTick()` 开头写死了 `if (timerTickId || timers.size === 0) return;`，且没有记录当前 `timerTickId` 计划唤醒的时间戳 `scheduledDueAt`。
  一旦某个长周期定时器先被调度（例如 `laolao-native.js:268` 的 `15,000ms` 或 `laolao-run-notify.js:301` 的 `60,000ms`，或者运行中途某一拍恰好只有长周期定时器处于排队状态，此时 `timerTickId` 被设为 15s–60s 后触发），紧接着注册的任何短周期轮询（如 `250ms` 的 `laolao-process-card.js:680`、`300ms` 的 `laolao-cle-stage.js:810` / `laolao-session-tools.js:113` / `laolao-immersion.js:178`、`450ms` 的 `laolao-deep-think.js:1037`、`500ms` 的 `laolao-sidebar.js:2075`）调用 `every()` → `scheduleTimerTick()` 时，因为 `timerTickId` 非 0，`scheduleTimerTick()` **直接返回，不重新计算更早的唤醒时间**。结果后注册的短周期轮询在最长 15s–60s 内一次都不会执行！
- **最小复现脚本与实测输出**（`exit 0`）：
  - 命令：
    ```powershell
    @'
    const fs = require("fs"), vm = require("vm");
    const code = fs.readFileSync("C:/Users/34786/Projects/pinkie-wt/m3-review/ui/injections/laolao-dom-watch.js", "utf8");
    const docEl = { nodeName: "HTML", contains() { return true; } };
    const sandbox = {
      window: {}, document: { hidden: false, documentElement: docEl, addEventListener() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: (fn) => setTimeout(fn, 16), setTimeout, clearTimeout, Date, Promise, Set, Array, Number, Boolean, Math
    };
    sandbox.window = sandbox;
    vm.runInNewContext(code, sandbox);
    (async () => {
      let longHits = 0, shortHits = 0;
      const hLong = sandbox.Pinkie.domWatch.poll(() => { longHits++; }, 60000);
      const hShort = sandbox.Pinkie.domWatch.poll(() => { shortHits++; }, 120);
      await new Promise((r) => setTimeout(r, 650));
      console.log("[Repro-2 ShortTimerStarvation]", JSON.stringify({ elapsedMs: 650, shortTimerIntervalMs: 120, expectedShortHits: ">=4", actualShortHits: shortHits, longHits }));
      hLong.stop(); hShort.stop();
    })();
    '@ | node -
    ```
  - 实测输出原文：
    ```text
    [Repro-2 ShortTimerStarvation] {"elapsedMs":650,"shortTimerIntervalMs:120","expectedShortHits":">=4","actualShortHits":0,"longHits":0}
    ```
- **建议修法**：
  在 `laolao-dom-watch.js` 中记录 `let timerDueAt = Infinity;`。当 `scheduleTimerTick()` 计算出新的 `targetDueAt = now + nextWait` 早于当前 `timerDueAt` 时，先 `clearTimeout(timerTickId)` 并用新的 `nextWait` 重新 `setTimeout(runTimers, nextWait)`；或者对每个 `poll` 直接包裹原生 `setInterval`（在回调入口检查 `if (pauseWhenHidden && document.hidden) return;`），既不增加源码中的 `setInterval(` 字面量计数（全仓仅 `laolao-dom-watch.js` 内 1 处），又能 100% 保持原生定时器的独立精度、互不阻塞和零调度漂移。

---

### 问题 3（阻塞 / Blocker）：47 处 `domWatch.poll` 全部默认 `pauseWhenHidden: true`（0 处传 `false`），且 `laolao-dom-watch.js` 未监听 `visibilitychange`，直接破坏窗口隐藏期间的计时、心跳、通知、后台状态轮询与消息窗口保护

- **位置**：
  - `ui/injections/laolao-dom-watch.js:205-208, 235-256`
  - 全部 47 处 `window.Pinkie?.domWatch?.poll(...)` 调用点（特别是 `#7`、`#11`、`#21`、`#27`、`#28`、`#31`、`#33`、`#34`、`#44`）
- **原因分析**：
  1. **全仓 47 处调用 0 处传入 `{pauseWhenHidden: false}`**：
     运行脚本扫描全部 36 个文件的 47 处 `domWatch.poll` 调用（`exit 0`）：
     ```text
     [PollCallAudit] {"totalPolls":47,"capturedHandles":0,"optionsPassed":0}
     ```
     由于 `laolao-dom-watch.js:240` 写的是 `pauseWhenHidden: options.pauseWhenHidden !== false`，全部 47 处定时器在 `document.hidden === true` 时一律停摆。
  2. **破坏了原本明确设计为「窗口隐藏/后台时仍需运行」的 9 处核心轮询**：
     - **`#33 laolao-run-status.js:672`（1000ms 运行状态节拍、3s 网关状态轮询、15s 假死检测、阶段耗时统计、断线恢复通知触发）**：
       窗口隐藏期间 `beat += 1`、`watchStore()`、`checkConnection()`、每 3 秒 `refresh(key)`（`pinkie.run.status` / `pinkie.plan.get`）、每 15 秒 `verifyAlive(key)` 及阶段耗时记录（`recordDuration` 写入 `pinkie:run-status:durations:v1`）全部停摆。更严重的是：若后台长任务期间网关闪断重连，`checkConnection()` → `recover()` 被推迟到用户切回窗口（`document.hidden === false`）后才触发，此时 `pinkie:run-recovered` 派发时 `laolao-run-notify.js` 看到 `visible() === true`（`isVisible && isCurrent`），会**直接吞掉系统通知和标题提醒**！此外后台发生的阶段切换（如 `review` → `fix`）无法被记录，整段隐藏时间被算进旧阶段，污染「比平时久，还在跑」的耗时基线。
     - **`#44 laolao-usage-stats.js:339`（1000ms `syncLive()` + `updateRuntimeChip()` 生成计时）**：
       当流式生成在窗口隐藏期间开始（或切换了轮次），`laolao-usage-stats.js` 的观察器回调走 `requestAnimationFrame`（后台同样暂停），而 1000ms 的 `syncLive()` 又被 `domWatch.poll` 暂停；等到生成已进行 25 秒、用户切回窗口时，`syncLive()` 才首次检测到 `.chat-send-btn--stop` 并执行 `liveStartedAt = Date.now()`，导致顶部链路胶囊显示的生成耗时从 `生成 1s` 重新起算！
     - **`#21 laolao-native.js:268`（15000ms `pushContext` 原生菜单栏/托盘运行中会话同步心跳）**：
       `pushContext()` 第 245 行专门写了 `if (!hasNative() || document.hidden && !lastContext) return;`——即首次初始化 `lastContext` 后，即便主窗口隐藏在后台（`document.hidden === true`），仍须每 15 秒向 macOS 菜单栏 / Windows 原生层同步当前正在运行的会话列表（`running`）。被 `domWatch.poll` 暂停后，主窗口隐藏期间菜单栏运行列表不再随 15s 心跳刷新。
     - **`#31 laolao-run-notify.js:285`（1500ms 后台窗口标题 `✓ / ! / ?` 前缀守护）**：
       第 290 行 `if (titlePrefix && !String(document.title || '').startsWith(titlePrefix)) setTitle(titlePrefix);` 守护的 `titlePrefix` **只在页面隐藏时（`!isVisible`）才会被设置**，且窗口一旦恢复可见（`visibilitychange`），第 232 行 `if (visible()) viewed()` 立即调用 `clearTitle()` 清空 `titlePrefix`。把该轮询迁到 `pauseWhenHidden: true` 的 `domWatch.poll` 后，页面隐藏时它不跑，页面可见时 `titlePrefix` 已清空，第 290 行彻底沦为死代码！
     - **`#28 laolao-resume.js:2381`（1000ms 聊天消息窗口裁剪守卫与空闲队列自愈）**：
       原代码第 2383 行特意把 `for (const pane of chatPanes()) guardMessageWindow(pane?.state);` 放在第 2384 行 `if (!isVisibleChatSurface() || !location.pathname.startsWith("/chat")) return;` **之前**，就是为了在窗口隐藏（或 WebKit 误报 `document.hidden`）时依然第一时间给新替换的 `pane.state` 安装 `guardMessageWindow` 防止历史消息被原生裁剪；迁移后整段回调在 `document.hidden` 时被跳过。
     - **`#11 laolao-deep-think.js:1037`（450ms `syncWorkSession()`）**：
       原代码 `window.setInterval(() => { syncWorkSession(); if (!document.hidden) void refreshWork(); }, 450);` 特意把 `syncWorkSession()` 放在 `if (!document.hidden)` 之外；迁移后在隐藏期间连 `syncWorkSession()` 也被停掉。
     - **`#7 laolao-cle-stage.js:810`（300ms `attach` 绑定 `.chat-thread-inner`）**：
       第 800 行明确注释 `// 不用 rAF：窗口在后台时也要跟上状态`，但第 810 行 `attach` 轮询迁入 `domWatch.poll` 后，后台切换会话重建 `.chat-thread-inner` 时 `attach()` 被暂停，导致 `mo` 无法在后台挂到新容器上。
     - **`#34 laolao-session-tools.js:113`（300ms `watchSession` 临时会话离开清理）**：
       后台通过原生快捷提问（`pinkie-native` `openSession`）切走临时会话时，`watchSession` 被暂停，无法及时触发 `leaveTemp(temp)`。
     - **`#27 laolao-resume.js:1459`（1000ms `checkCorePlugin` 与红条失败看门狗查询 `explainRunFailure`）**：
       后台运行出错弹出 `.callout.danger` 时，需等切回前台后最多 1 秒才开始首轮 `explainRunFailure` 退避查询。
  3. **`laolao-dom-watch.js` 未监听 `visibilitychange`**：
     - 隐藏期间 `runTimers()` 仍在后台以 `Math.max(250, min(t.ms))` 空转调用 `setTimeout(runTimers, nextWait)`；
     - 窗口从隐藏恢复可见时，没有任何 `visibilitychange` 监听器立即唤醒 `runTimers()`：若当前只剩长周期定时器（如 `15000ms` 或 `60000ms`）在等待 `timerTickId`，已逾期的定时器在窗口恢复可见后还要傻等最多 15s–60s 才会执行！
- **最小复现脚本与实测输出**（`exit 0`）：
  - 命令与输出见问题 1/2 同批运行的 `[Repro-3 HiddenPauseAndNoVisibilityListener]`：
    ```text
    [Repro-3 HiddenPauseAndNoVisibilityListener] {"hiddenHitsIn450ms":0,"hasVisibilityListener":false}
    ```
- **建议修法**：
  1. 在 `laolao-dom-watch.js` 中增加 `document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timerTickId); timerTickId = 0; runTimers(); } })`；当 `document.hidden === true` 且所有到期定时器都是 `pauseWhenHidden: true` 时，不再用 `setTimeout` 每 250ms 空转，而是等 `visibilitychange` 立即唤醒（若存在 `pauseWhenHidden: false` 的活跃定时器，则只按 `pauseWhenHidden: false` 定时器的最早 `nextAt` 调度）。
  2. 对后台仍需运行的轮询（至少 `#7`、`#11`、`#21`、`#25`、`#27`、`#28`、`#31`、`#33`、`#34`、`#44`），显式传入 `{pauseWhenHidden: false}`（或者将 `domWatch.poll` 的默认策略改为与原生 `setInterval` 一致的 `pauseWhenHidden: false`，仅对纯视觉装饰类轮询显式开启 `{pauseWhenHidden: true}`）。

---

### 问题 4（次要 / Medium）：`runTimers()` 单宏任务串行执行全部到期回调，且在循环前只取一次 `const now = Date.now()`，慢回调会阻塞同批后续回调并导致后续定时器 `nextAt` / `nextWait` 基准漂移

- **位置**：`ui/injections/laolao-dom-watch.js:198-222`
- **原因分析**：
  ```js
  function runTimers() {
    timerTickId = 0;
    if (timers.size === 0) return;
    const now = Date.now();
    let nextWait = 60000;
    for (const t of [...timers]) {
      ...
      if (now >= t.nextAt) {
        t.nextAt = now + t.ms;
        try {
          t.handler();
        } catch {
          // Isolate timer callback errors.
        }
      }
      nextWait = Math.min(nextWait, Math.max(50, t.nextAt - now));
    }
  ```
  - **异常隔离**：同步抛错被 `try { t.handler(); } catch {}` 捕获，不会中断后续回调（异步 `async` 回调内部未捕获的 Promise rejection 与原生 `setInterval` 一样属于 unhandledRejection，不影响调度循环）。
  - **慢回调影响**：47 个定时器挤在同一个 `runTimers()` 循环中同步串行执行；若某一个同步回调耗时较长（如全树 DOM 查询耗时 90ms），不仅同批排在后面的回调被推迟 90ms，而且因为 `now` 是在循环开始前采集的旧时间戳，`t.nextAt = now + t.ms` 和 `nextWait = Math.min(nextWait, Math.max(50, t.nextAt - now))` 全部基于过时的 `now` 计算，导致慢回调之后紧接着以 `50ms` 下限连续补帧。
- **最小复现脚本与实测输出**（`exit 0`）：
  ```text
  [Repro-4 ErrorSlowCancel] {"orderCount":3,"firstThree":["thrower","slow90ms","after@1795734156060"],"cancelledHits":0}
  ```
- **建议修法**：
  在 `runTimers()` 循环内每次计算 `nextAt` 和循环末尾计算 `nextWait` 时使用实时 `Date.now()`（例如 `const after = Date.now(); t.nextAt = after + t.ms;`），避免慢回调造成后续定时器连续追赶。

---

### 问题 5（重要 / High）：PR #53 的中间提交（Batch B `f20d20e0` 至 `fe1555ad`）未跑全量门禁与截图比对（违反 `M3-4 ★` 与 `Z1 ★`），存在 11 个单测文件失败、`tools/study-desk/harness.mjs` 漏引 `laolao-dom-watch.js` 静默失效，且最新主线仍残留 15 处对可选 `createObserver` 返回值的无保护 `.disconnect()` / `.observe()` 调用

- **位置**：
  - PR #53 中间提交 `f20d20e0`（Batch B）、`1663cd80`（Batch C）、`d74dae40`（Batch D）、`1dc4f4cc`（Batch E）、`6eac8ce6`（M3-5）、`fe1555ad`
  - 最新代码中的 11 个注入文件共 **15 处未加可选链 `?.` 的 `.disconnect()` / `.observe()` 调用**
- **实测证据 1：抽查 PR #53 的 6 个中间提交（`exit 0`）**：
  - 命令：
    ```powershell
    node -e "<检查 8be3fbc0 / f20d20e0 / 1663cd80 / d74dae40 / 1dc4f4cc / 6eac8ce6 上各单测断言与 study-desk harness>"
    ```
  - 实测输出原文：
    ```text
    [IntermediateCommitAudit] Batch A (8be3fbc0): broken=[]
    [IntermediateCommitAudit] Batch B (f20d20e0): broken=[] (注：tools/study-desk/harness.mjs 未加载 laolao-dom-watch.js，window.Pinkie?.domWatch 为 undefined)
    [IntermediateCommitAudit] Batch C (1663cd80): broken=["tests/brand-ui.test.cjs (phrases)","tests/brand-ui.test.cjs (model-picker)","tests/process-card-ui.test.cjs + tests/ui-polish-thinking-segments.test.mjs"]
    [IntermediateCommitAudit] Batch D (d74dae40): broken=["tests/brand-ui.test.cjs (phrases)","tests/brand-ui.test.cjs (model-picker)","tests/mode-menu-fx.test.cjs + tests/workspace-dock.test.cjs","tests/motion-preference.test.cjs","tests/process-card-ui.test.cjs + tests/ui-polish-thinking-segments.test.mjs"]
    [IntermediateCommitAudit] Batch E (1dc4f4cc): broken=["tests/brand-ui.test.cjs (phrases)","tests/brand-ui.test.cjs (model-picker)","tests/mode-menu-fx.test.cjs + tests/workspace-dock.test.cjs","tests/motion-preference.test.cjs","tests/process-card-ui.test.cjs + tests/ui-polish-thinking-segments.test.mjs"] (另加 laolao-resume.js:2591 readyObserver.disconnect() 无可选链导致 tests/tuning.test.cjs 崩溃)
    [IntermediateCommitAudit] M3-5 (6eac8ce6): broken=["tests/brand-ui.test.cjs (phrases)","tests/brand-ui.test.cjs (model-picker)","tests/mode-menu-fx.test.cjs + tests/workspace-dock.test.cjs","tests/motion-preference.test.cjs","tests/process-card-ui.test.cjs + tests/ui-polish-thinking-segments.test.mjs","tests/laser-pointer.test.cjs","tests/party-entry.test.cjs","tests/progress-ui.test.cjs","tests/deep-think-ui.test.cjs"]
    ```
    直到 PR #53 的最后一个补丁提交 `4932569587a460699123ed6add1ed3e3f809ee31`，才把 `tools/study-desk/harness.mjs` 加上 `<script src="/laolao-dom-watch.js"></script>` 并修改了上述 11 个单测文件。
- **实测证据 2：全仓扫描 `createObserver` 返回句柄上的无保护 `.disconnect()` / `.observe()` 调用（`exit 0`）**：
  - 命令与输出原文：
    ```text
    [UnguardedCall] laolao-cle-stage.js:805 (mo): mo.disconnect();
    [UnguardedCall] laolao-cle-stage.js:812 (mo): window.addEventListener('pagehide', () => mo.disconnect());
    [UnguardedCall] laolao-learning-reminder.js:119 (observer): observer.observe(root, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-study-desk']});
    [UnguardedCall] laolao-learning-reminder.js:126 (observer): window.addEventListener('pagehide', () => { state.generation++; state.pending = null; observer.disconnect(); remove(); });
    [UnguardedCall] laolao-metre-skin.js:265 (observer): for (const observer of watched.values()) observer.disconnect();
    [UnguardedCall] laolao-model-picker.js:1930 (watcher): watcher.disconnect(); triggerObservers.delete(details); releasePopupLayout(details);
    [UnguardedCall] laolao-plan.js:120 (view.observer): for (const [host, view] of views) if (!host.isConnected) { view.observer.disconnect(); view.card?.remove(); views.delete(host); }
    [UnguardedCall] laolao-resume.js:2597 (readyObserver): window.setTimeout(() => readyObserver.disconnect(), 10000);
    [UnguardedCall] laolao-rich.js:571 (observer): for (const [h, observer] of observers) if (!h.isConnected) { observer.disconnect(); observers.delete(h); any = true; }
    [UnguardedCall] laolao-side-layout.js:42 (observer): observer.disconnect();
    [UnguardedCall] laolao-stream-fx.js:193 (pending): pending.disconnect();
    [UnguardedCall] laolao-stream-fx.js:200 (pending): window.setTimeout(() => pending.disconnect(), 60000);
    [UnguardedCall] laolao-study-desk.js:855 (watch): return () => watch.disconnect();
    [UnguardedCall] laolao-study-desk.js:871 (mutations): state.disposeStickers = () => { resize.disconnect(); mutations.disconnect(); observed.clear(); };
    [UnguardedCall] laolao-workspace-focus.js:188 (observer): window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    ```
    特别是 `laolao-resume.js:2597`：`49325695` 只给第 2591 行加了 `readyObserver?.disconnect()`，却漏掉了第 2597 行 `window.setTimeout(() => readyObserver.disconnect(), 10000);`——在未加载 `laolao-dom-watch.js` 的单测或独立环境里，只要脚本存活满 10 秒就会抛出未捕获的 `TypeError: Cannot read properties of undefined (reading 'disconnect')`！而 `laolao-cle-stage.js:805` 只要页面上存在 `.chat-thread-inner` 且未加载 `laolao-dom-watch.js`，在脚本初始化调用 `attach()` 时就会在 `mo.disconnect()` 立即抛错崩溃。
- **建议修法**：
  将上述 15 处调用全部补齐可选链（如 `mo?.disconnect()`、`readyObserver?.disconnect()`、`observer?.observe(...)`、`watch?.disconnect()`、`mutations?.disconnect()`）。

---

## 三、47 处 `setInterval` → `domWatch.poll` 迁移逐行核对表

### 3.1 通用核对结论（适用全部 47 处）

- **首次执行时机**：`domWatch.poll(handler, ms)` 内部调用 `every(ms, handler)`，设置 `nextAt: Date.now() + intervalMs`，与原生 `setInterval(handler, ms)` 一样**不会在注册瞬间同步执行首次回调**，而是在首个 `intervalMs` 到期后执行（但受**问题 2** 影响：若注册时 `timerTickId` 正处于长周期定时器如 15s/60s 的等待中，首次执行会被推迟到长周期定时器触发时！下表「首次执行时机」列同时标注该处是否还在注册旁手动调用了一次初始化函数）。
- **异常与慢回调互扰**：全部 47 处共用 `runTimers()` 的单个 `for` 循环；单个回调**同步抛错**被 `try/catch` 隔离，**不会**中断其他回调；但单个回调**同步耗时过长**会直接阻塞同一拍内排在它后面的所有到期回调，并因循环前 고정 `const now = Date.now()` 导致后续定时器基准漂移（见**问题 4**）。
- **取消是否有效**：`domWatch.poll()` 返回 `{ stop() { entry.active = false; timers.delete(entry); } }`，调用 `.stop()` 本身能有效取消（`[Repro-4]` 实测 `cancelledHits: 0`）。但全仓 47 处迁移点 originally 都是「常驻无返回值」的 `setInterval(...)`，**47 处中有 0 处保存返回值或调用 `.stop()`**（Note：如果调用方误把返回值传给原生 `clearInterval(handle)` 则无效，因为返回的是对象而非 timer ID）。

### 3.2 47 处迁移逐项核对表（共 47 行）

| # | 文件与行号 | 间隔 (ms) | 回调用途与注册旁是否立即执行一次 | 页面隐藏时（`document.hidden`）是否还该运行？ | 隐藏暂停风险评估 | 抛错/慢回调互扰 | 取消句柄保存与有效性 |
|---|---|---|---|---|---|---|---|
| 1 | `ui/injections/laolao-artifacts.js:712` | `2000` | 检查 `currentKey()` 会话切换并调用 `scheduleCards()`；注册旁 `start()` 已立即调 `scheduleCards(true)` | 否（纯制品卡片 DOM 扫描，内部走 rAF） | 低（可见后最多 2s 补扫，但受问题 2 首次调度阻塞影响） | 同步抛错隔离；慢回调会阻塞同批其余 46 处 | 未保存返回值；`.stop()` 有效 |
| 2 | `ui/injections/laolao-ask-user.js:269` | `1500` | 检测 `location.href` 变化并 `restore()` 恢复待答提问卡；另有 `pinkie:session-selected` 监听，启动未立即调 `restore()` | **宜运行或恢复时立即跑**（后台会话切换或网关就绪后恢复 `ask_user` 状态） | **中**（受问题 2 首次执行可能被 60s 定时器卡住；隐藏恢复后无 `visibilitychange` 立即唤醒） | `restore()` 为异步 RPC，同步耗时小 | 未保存返回值；`.stop()` 有效 |
| 3 | `ui/injections/laolao-capabilities.js:563` | `1000` | `mountResearch` 挂载深度研究开关按钮；第 564 行已立即调用 `mountResearch()` | 否（纯输入区按钮挂载） | 低 | 含 `querySelectorAll` 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |
| 4 | `ui/injections/laolao-capabilities.js:570` | `1200` | `checkVisible` 检查设置页滚动区可见性并刷新状态；启动时 `ready()` 已调 `mount()` | 否（仅设置面板打开且可见时有意义） | 低 | 同步 DOM 检查，开销小 | 未保存返回值；`.stop()` 有效 |
| 5 | `ui/injections/laolao-classic-shell.js:431` | `1200` | `typeof MutationObserver !== "function"` 时的降级分支 `schedule`；第 436 行已立即调 `schedule()` | 否（现代浏览器走 `if` 分支的 `mounts.watch`，此 `else` 分支正常不执行） | 无（死分支/降级兜底） | 正常不注册 | 未保存返回值；`.stop()` 有效 |
| 6 | `ui/injections/laolao-cle-stage.js:349` | `2000` | 查找最后一张过程卡 `latestCard()` 并 `decorate(card)` 补静态小标；启动未立即调用 | 否（纯过程卡摘要图标装饰） | 低（受问题 2 影响若排在长定时器后首次会延后） | 同步 `querySelectorAll` | 未保存返回值；`.stop()` 有效 |
| 7 | `ui/injections/laolao-cle-stage.js:810` | `300` | `attach` 查找 `.chat-thread-inner` 并重新绑定 `mo?.watch(h, ...)` 及 `schedule()`（`setTimeout(scan, 120)`）；第 811 行已立即调 `attach()` | **是（应该运行！）** 第 800 行明确注释：`// 不用 rAF：窗口在后台时也要跟上状态` | **高（危险）**：后台切换会话或 Lit 重建 `.chat-thread-inner` 时 `attach` 被暂停，`mo` 无法在后台绑定新容器，违背第 800 行后台跟进状态的设计 | 同步 DOM 查询；若无 `domWatch` 第 805 行 `mo.disconnect()` 直接抛 TypeError | 未保存返回值；`.stop()` 有效 |
| 8 | `ui/injections/laolao-composer-tray.js:229` | `1000` | `mount` 挂载输入框「+」工具箱按钮；第 230 行已立即调 `mount()` | 否（纯 UI 按钮幂等挂载） | 低 | 同步 DOM 检查 | 未保存返回值；`.stop()` 有效 |
| 9 | `ui/injections/laolao-context-compact.js:806` | `900` | `render` 挂载并刷新上下文容量圆环与浮层；第 805 行已立即调 `render()` | 否（纯 UI 圆环渲染，且 `laolao:sessions-changed` 另有监听） | 低 | 同步 DOM 检查与容量计算 | 未保存返回值；`.stop()` 有效 |
| 10 | `ui/injections/laolao-deep-think.js:1036` | `900` | `if (!document.hidden) void refreshStatus();` 轮询 `pinkie.deepThink.status` | 否（原代码回调内部已写 `if (!document.hidden)`） | 低（但恢复可见时无 `visibilitychange` 立即触发，最多延迟 900ms） | 异步 RPC | 未保存返回值；`.stop()` 有效 |
| 11 | `ui/injections/laolao-deep-think.js:1037` | `450` | `syncWorkSession(); if (!document.hidden) void refreshWork();` 同步当前工作会话键并轮询 `pinkie.work.status` | **半是（`syncWorkSession()` 应该运行！）** 原代码特意将 `syncWorkSession()` 放在 `if (!document.hidden)` 之外 | **中**：隐藏期间 `syncWorkSession()` 被一并暂停，后台路由/会话切换时 `workSessionKey` 状态滞后 | `syncWorkSession()` 同步、`refreshWork()` 异步 | 未保存返回值；`.stop()` 有效 |
| 12 | `ui/injections/laolao-desensitize.js:345` | `700` | `tick`（rAF 节流调用 `render()` 挂载脱敏开关）；第 351 行已立即调 `render()` | 否（内部走 rAF，仅 UI 按钮挂载） | 低 | 内部走 rAF，同步开销极小 | 未保存返回值；`.stop()` 有效 |
| 13 | `ui/injections/laolao-feedback.js:393` | `1200` | `syncWhenSettingsOpens` 在设置页打开时挂载反馈区；`onReady` 已立即检查一次 | 否（仅设置页打开时挂载 UI） | 低 | 同步 DOM 检查 | 未保存返回值；`.stop()` 有效 |
| 14 | `ui/injections/laolao-game-demo.js:41` | `500` | 更新学习台特效演示面板的 WebGL / rAF / FPS 文字；仅在调用 `openDemo` 时注册 | 否（纯调试/演示面板文字刷新） | 低 | `fx.fps(1500)` 同步统计 | 未保存返回值；`.stop()` 有效 |
| 15 | `ui/injections/laolao-immersion.js:178` | `300` | `immersionTick`（仅当 `window.__pinkieQuiet` 不存在时的降级分支；正常页面由 `laolao-quiet.js` 接管） | 否（沉浸动效与粗体修复，且第 179 行已有 `visibilitychange` 恢复 `kick()`） | 低（正常走 `__pinkieQuiet.interval`） | 降级分支 | 未保存返回值；`.stop()` 有效 |
| 16 | `ui/injections/laolao-laser-pointer.js:843` (a) | `1500` | `mountRail`（仅当 `window.__pinkieQuiet` 不存在时的降级分支）；第 845 行已立即调 `mountRail()` | 否（侧栏激光笔快捷按钮挂载） | 低（正常走 `__pinkieQuiet.interval`） | 降级分支 | 未保存返回值；`.stop()` 有效 |
| 17 | `ui/injections/laolao-laser-pointer.js:843` (b) | `1500` | `mount`（仅当 `window.__pinkieQuiet` 不存在时的降级分支）；第 844 行已立即调 `mount()` | 否（底栏激光笔按钮挂载） | 低（正常走 `__pinkieQuiet.interval`） | 降级分支 | 未保存返回值；`.stop()` 有效 |
| 18 | `ui/injections/laolao-link-viewer.js:347` | `1500` | `mountMediaWorkspaceActions` 挂载媒体工作区操作按钮；第 349 行已立即调用 | 否（纯 UI 按钮幂等挂载） | 低 | 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |
| 19 | `ui/injections/laolao-memory.js:223` | `1200` | `ensureEntry` 挂载记忆抽屉入口按钮；第 225 行已立即调用 | 否（纯 UI 入口挂载） | 低 | 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |
| 20 | `ui/injections/laolao-message-actions.js:504` | `1500` | `schedule`（rAF 节流调用 `paint` 为消息气泡补操作栏）；`start()` 已立即调 `schedule()` | 否（内部走 rAF，纯消息操作按钮绘制） | 低 | 内部走 rAF | 未保存返回值；`.stop()` 有效 |
| 21 | `ui/injections/laolao-native.js:268` | `15000` | `pushContext` 向 macOS 菜单栏 / Windows 原生桥推送当前模式与运行中会话列表 `running`；第 269 行有 `setTimeout(pushContext, 3000)` | **是（必须运行！）** 第 245 行写明 `if (!hasNative() || document.hidden && !lastContext) return;`，即初始化后在后台也必须每 15s 同步运行中会话列表给菜单栏/托盘 | **高（危险）**：主窗口最小化/隐藏到后台期间，15s 心跳被 `domWatch.poll` 停掉；且因它是 15s 长定时器，在 `timerTickId` 为 0 时被调度还会触发**问题 2** 阻塞后续短定时器长达 15s；恢复可见时无 `visibilitychange` 唤醒还需再等最多 15s | 异步 RPC `sessions.list` | 未保存返回值；`.stop()` 有效 |
| 22 | `ui/injections/laolao-party-entry.js:36` | `1500` | `mount`（仅当 `window.__pinkieQuiet` 不存在时的降级分支）；第 37 行已立即调 `mount()` | 否（派对空间入口按钮挂载） | 低 | 降级分支 | 未保存返回值；`.stop()` 有效 |
| 23 | `ui/injections/laolao-plan.js:149` | `1200` | `attach` 扫描聊天面板挂载计划卡片容器并触发首次 `refresh(view)`；第 151 行已立即调 `attach()` | 否（计划进度由 `pinkie:gateway-event` 实时驱动，轮询仅补挂 DOM 容器） | 低 | 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |
| 24 | `ui/injections/laolao-power-settings.js:288` | `1500` | `mountRail` 在侧栏挂载「进阶调节」入口；第 290 行已立即调用 | 否（纯侧栏入口按钮挂载） | 低 | 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |
| 25 | `ui/injections/laolao-process-card.js:680` | `250` | `if (run.startedAt \|\| run.doneAt > Date.now() - 3200) schedule();` 在运行中每 250ms 刷新过程卡计时与思考打字机；第 679 行已调 `schedule()` | 否（`schedule()` 内部走 `requestAnimationFrame`，且第 653 行已监听 `visibilitychange` 在恢复可见时立即重排 `schedule()`） | **中**（虽隐藏时无需画帧，但作为 250ms 高频计时器，极易被**问题 2** 的 15s/60s 长定时器卡住首次启动） | 内部走 rAF | 未保存返回值；`.stop()` 有效 |
| 26 | `ui/injections/laolao-progress.js:34` | `2000` | `prepare` 扫描并准备进度展示节点；`start()` 内已立即调 `schedule()` | 否（纯 DOM 属性/节点幂等同步） | 低 | 同步 DOM 扫描 | 未保存返回值；`.stop()` 有效 |
| 27 | `ui/injections/laolao-resume.js:1459` | `1000` | `checkCorePlugin()` 检测核心插件是否缺失 + 检测原生红色错误条 `.callout.danger` 变化并触发 `explainRunFailure()` 看门狗状态查询 | **是（应该运行！）** 后台任务出错出现红条或网关刚连上时，应在后台立即开始看门狗状态查询 | **中**：后台出错时看门狗诊断被推迟到切回前台；且启动时未立即执行一次，若撞上**问题 2** 会延迟 15s–60s 才首次检查 `checkCorePlugin()` | 同步读取 `.callout.danger` + 异步 RPC | 未保存返回值；`.stop()` 有效 |
| 28 | `ui/injections/laolao-resume.js:2381` | `1000` | 对所有 `chatPanes()` 执行 `guardMessageWindow(pane?.state)` 防止历史消息窗口被裁剪，并在可见时执行 `reconcileSelectedSession` / `reconcileQueuedBusyIdle` / `reconcileStaleBusy` | **部分必须运行（第 2383 行 `guardMessageWindow` 必须在后台运行！）** 原代码特意把 `guardMessageWindow` 放在第 2384 行 `if (!isVisibleChatSurface()) return;` 之前 | **高（危险）**：在 `setTimeout(..., 400)` 后才注册，此时第 32 项 `laolao-run-notify.js:301`（60,000ms）和第 21 项 `laolao-native.js:268`（15,000ms）早已注册；且在 `document.hidden === true` 期间，后台流式或重连替换 `pane.state` 时无法及时挂上 `guardMessageWindow`，导致历史消息窗口面临被原生裁剪为 10 条的风险！ | 同步遍历 `chatPanes()` + 异步恢复 | 未保存返回值；`.stop()` 有效 |
| 29 | `ui/injections/laolao-rich.js:579` | `400` | `attach` 为 `.chat-thread-inner` 绑定富文本（代码块/Mermaid/图表）观察器；第 580 行已立即调 `attach()` | 否（`schedule()` 渲染图表在可见时进行即可） | 低 | 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |
| 30 | `ui/injections/laolao-roundtable-entry.js:30` | `1500` | `mount`（仅当 `window.__pinkieQuiet` 不存在时的降级分支）；第 30 行末尾已立即调 `mount()` | 否（圆桌入口按钮挂载） | 低 | 降级分支 | 未保存返回值；`.stop()` 有效 |
| 31 | `ui/injections/laolao-run-notify.js:285` | `1500` | 同步会话切换 `viewed(key)`、重绘会话列表运行标记 `paintMarks()`、**守护后台窗口标题提醒前缀 `if (titlePrefix && !document.title.startsWith(titlePrefix)) setTitle(titlePrefix)`**、长任务满 60s 弹通知权限询问 `showPrompt()` | **是（必须运行！）** `titlePrefix`（`✓ ` / `! ` / `? `）**仅在窗口隐藏时（`!isVisible`）才存在**（窗口一旦可见，`visibilitychange` 立即调用 `clearTitle()` 清掉它） | **高（危险）**：迁移到 `pauseWhenHidden: true` 的 `domWatch.poll` 后，窗口隐藏时该轮询不跑，第 290 行标题前缀守护在后台完全失效（一旦其他脚本改写 `document.title`，任务栏/标签页上的 `✓ / ! / ?` 提醒前缀丢失且无法补回）！ | 同步 DOM 与 `document.title` 操作 | 未保存返回值；`.stop()` 有效 |
| 32 | `ui/injections/laolao-run-notify.js:301` | `60000` | `loadNotifyPrefs` 从原生桥读取系统通知开关配置 `pinkie.prefs.notify`；第 300 行已立即调 `loadNotifyPrefs()` | **是（应该运行！）** 系统通知恰恰只在窗口隐藏（`!isVisible`）时发送，后台期间用户在别处改了通知偏好也应同步；且 60s 极低频完全无需在隐藏时暂停 | **高（危险 — 问题 2 触发源！）**：这是全仓最长的 `60,000ms` 轮询！一旦它在 `timerTickId === 0` 时率先进 `scheduleTimerTick()`，会把 `timerTickId` 锁在 60 秒后，导致它后面注册的所有短周期轮询（以及延迟在 `DOMContentLoaded` / `setTimeout(400)` / `boot()` 里注册的轮询）首次执行被卡住长达 60 秒！且窗口隐藏再恢复时，因无 `visibilitychange` 唤醒，逾期后还要再等最多 60 秒！ | 异步 `bridge.loadPrefs()` | 未保存返回值；`.stop()` 有效 |
| 33 | `ui/injections/laolao-run-status.js:672` | `1000` | 运行状态条核心心跳：`beat += 1`、`watchStore()`、`checkConnection()`（断线检测与重连 `recover()` → 派发 `pinkie:run-recovered`）、每 3s `refresh(key)` 轮询 `pinkie.run.status` / `pinkie.plan.get`、每 15s `verifyAlive(key)` 查后端假死、更新阶段耗时 `durations` 并 `render()` | **是（必须运行！）** 它是后台长任务状态跟踪、阶段耗时统计、断线重连完成提醒（`pinkie:run-recovered` → 系统通知）与假死检测的核心时钟 | **高（最危险！）**：隐藏期间停摆会导致：① 后台任务在闪断期间做完并重连时，`checkConnection()` 推迟到窗口恢复可见后才触发 `recover()`，此时 `visible() === true` 导致 `laolao-run-notify` **漏发系统通知**；② 后台每 3s 的 `pinkie.run.status` 轮询停止，后台发生的阶段切换（如审稿→修改）漏记，全部隐藏时长被记入旧阶段，污染 `localStorage` 耗时基线；③ 后台 15s 假死检测 `verifyAlive` 失效 | 同步状态更新 + 异步 RPC | 未保存返回值；`.stop()` 有效 |
| 34 | `ui/injections/laolao-session-tools.js:113` | `300` | `watchSession` 监测会话切换并在离开临时会话时调用 `leaveTemp(temp)`（`pinkie.session.temp.leave`） | **是（应该运行！）** 后台通过菜单栏「快速提问」（`pinkie-native` `openSession`）从临时会话切走时，后台也应及时清理临时会话 | **中**：隐藏期间通过原生桥切换会话时，`watchSession` 轮询暂停 | 同步检查 + 异步 `leaveTemp` | 未保存返回值；`.stop()` 有效 |
| 35 | `ui/injections/laolao-session-tools.js:1146` | `1500` | `scheduleAll`（rAF 节流绘制来源引用、输入框策略芯片、临时会话横幅、大纲）；`start()` 已立即调 `scheduleAll()` | 否（内部走 rAF，且第 1148 行已监听 `window` 的 `focus` 事件刷新芯片） | 低 | 内部走 rAF | 未保存返回值；`.stop()` 有效 |
| 36 | `ui/injections/laolao-settings-user.js:1622` | `1000` | `syncPage()` + 当设置页可见（`!state.root.hidden`）时刷新用量 `syncUsage()` 并轮询微信/消息通道绑定状态 `pollWechat()` / `pollMessaging()` | 否（仅在用户打开并看着设置页扫码/绑定时有意义） | 低 | 同步检查 + 设置打开时异步 RPC | 未保存返回值；`.stop()` 有效 |
| 37 | `ui/injections/laolao-sidebar-autohide.js:263` | `350` | `reconcile` 同步窄屏/分屏下侧栏自动收起状态；第 265 行已立即调 `reconcile()` | 否（纯窗口布局交互） | 低 | 同步布局属性检查 | 未保存返回值；`.stop()` 有效 |
| 38 | `ui/injections/laolao-sidebar.js:2034` | `1500` | `ensureRailThemeButton` 在侧栏折叠快捷栏重绘后补回日夜切换按钮；`run()` 内已立即调用 | 否（纯折叠栏按钮幂等补挂） | 低 | 同步 DOM 检查 | 未保存返回值；`.stop()` 有效 |
| 39 | `ui/injections/laolao-sidebar.js:2075` | `500` | 监测 `location.href !== lastHref` 变化并触发侧栏 `schedule()` | **宜运行**（后台通过原生桥 `openSession` 切换路由时同步侧栏当前会话高亮） | **中**：隐藏期间路由变化需等恢复可见后最多 500ms 才同步侧栏 | 同步字符串比较 | 未保存返回值；`.stop()` 有效 |
| 40 | `ui/injections/laolao-tool-images.js:194` | `1500` | `paint` 为工具卡片挂载图片缩略图条；`start()` 内已有 `later(800)` | 否（纯聊天区缩略图 DOM 挂载） | 低 | 同步 DOM 扫描 | 未保存返回值；`.stop()` 有效 |
| 41 | `ui/injections/laolao-tool-images.js:197` | `1000` | 监测 `sessionKey()` 变化以清空旧会话 `traces` 缓存并触发 `later(200)` | 否（可见时刷新缩略图即可） | 低 | 同步 URL/DOM 读取 | 未保存返回值；`.stop()` 有效 |
| 42 | `ui/injections/laolao-tool-stream.js:178` | `1000` | `schedule`（rAF 节流调用 `prepare` 整理工具流卡片）；`start()` 已立即调 `schedule()` | 否（内部走 rAF） | 低 | 内部走 rAF | 未保存返回值；`.stop()` 有效 |
| 43 | `ui/injections/laolao-usage-stats.js:338` | `15000` | `refresh` 拉取 `/laolao-stats.json` 与 `pinkie.usage.get` 刷新累计 token/费用胶囊；第 357 行已立即调 `refresh()`，且第 340 行已监听 `visibilitychange` 在恢复可见时立即 `refresh()` | 否（已有 `visibilitychange` 恢复时立即 `refresh()`） | **中**（作为 `15,000ms` 长定时器，在 `boot()` 延迟 500ms 注册或运行时若 `timerTickId === 0` 会触发**问题 2** 阻塞后续短定时器；自身恢复已有 `visibilitychange` 兜底） | 异步 `fetch` + RPC | 未保存返回值；`.stop()` 有效 |
| 44 | `ui/injections/laolao-usage-stats.js:339` | `1000` | `syncLive(); updateRuntimeChip();` 检测 `.chat-send-btn--stop` 记录生成起始时间 `liveStartedAt = Date.now()` 并每秒更新 `生成 Ns` | **是（`syncLive()` 必须在后台运行！）** 否则后台开始生成的任务，其 `liveStartedAt` 无法在后台打戳（观察器分支也用了 rAF，后台同样暂停） | **高（危险）**：当一轮生成在窗口隐藏期间启动（或后台看门狗续跑新一轮）并运行了 N 秒，用户切回窗口时 `syncLive()` 才首次执行并将 `liveStartedAt` 设为切回那一刻的 `Date.now()`，导致「链路：生成 Ns」计时从 `1s` 重新开始！ | 同步 DOM 查询 `.chat-send-btn--stop` | 未保存返回值；`.stop()` 有效 |
| 45 | `ui/injections/laolao-web-gpt-collab.js:1081` | `700` | `syncSession(); schedule();` 同步会话并挂载网页 GPT 协作入口 | 否（内部 `schedule()` 走 rAF） | 低 | 同步会话键检查 + rAF | 未保存返回值；`.stop()` 有效 |
| 46 | `ui/injections/laolao-workbench.js:1284` | `2500` | `checkOpenFiles()` 轮询工作台已打开文件的磁盘 `mtimeMs` 变化并自动热重载或提示冲突；第 1285 行已监听 `window` 的 `focus` 事件立即 `checkOpenFiles()` | 否（用户切去外部编辑器改文件再切回窗口时，第 1285 行 `focus` 事件会立即触发 `checkOpenFiles()`；但在无焦点并排看窗口时 `document.hidden` 为 `false` 仍正常轮询） | 低（有 `focus` 监听兜底） | 异步 RPC `workbench_stat` | 未保存返回值；`.stop()` 有效 |
| 47 | `ui/injections/laolao-workbench.js:2330` | `1500` | `watchContent` 为主内容区挂载 `ResizeObserver`（`c.__pkWbObserved = true`） | 否（纯 `ResizeObserver` 绑定） | 低 | 同步 DOM 查询 | 未保存返回值；`.stop()` 有效 |

---

## 四、整树观察器数量（M3-2）、中间提交（M3-4 ★）与 11 项交互复测状态

### 4.1 整树观察器数量核对（M3-2）

1. **静态源码测量（`node tools/health/measure.mjs`，`exit 0`）**：
   - 命令：
     ```powershell
     node C:\Users\34786\Projects\pinkie-wt\m3-review\tools\health\measure.mjs | Select-String '"injectionTotals"' -Context 0,8
     ```
   - 输出原文片段：
     ```json
     "injectionTotals": {
       "important": 5101,
       "mutationObservers": 29,
       "setIntervals": 44,
       "subtreeObserverCalls": 1,
       "windowGlobals": 126,
       "windowGlobalsPerFileSum": 130
     }
     ```
   - 在 `ui/injections/*.js` 范围内，字面量 `.observe(..., { ..., subtree: true })` 调用点从 M3 前的 **47 处降至 1 处**（仅 `ui/injections/laolao-dom-watch.js:101` 对 `document.documentElement` 的根观察器），其余 38 个注入文件共 47 处子树观察器已改为调用 `window.Pinkie?.domWatch?.createObserver(...)?.watch(...)`。

2. **真实页面包（含 `ui/runtime/index-Bvtt7vVx.js`）盘点（`exit 0`）**：
   - M3 原记录（`tests/shared-dom-watch.test.mjs`）使用的是手写 HTML 测试页（`/scene?id=home-project`），**没有加载真实页面的原生入口 bundle `/assets/index-Bvtt7vVx.js`**。
   - 对真实页面加载的 `ui/runtime/*.js` 进行扫描（`exit 0`）：
     ```text
     [RuntimeBundleMO] {"chat-page-DrPkxqJK.js":{"mutationObservers":0,"subtreeLiterals":0},"index-Bvtt7vVx.js":{"mutationObservers":1,"subtreeLiterals":1},"markdown-DgASfUKF.js":{"mutationObservers":0,"subtreeLiterals":0}}
     ```
     `ui/runtime/index-Bvtt7vVx.js` 中包含 Vite 的 `modulepreload` 兼容观察器：
     ```js
     const e = document.createElement("link").relList;
     if (e && e.supports && e.supports("modulepreload")) return;
     ...
     new MutationObserver(...).observe(document, {childList: !0, subtree: !0});
     ```
     在现代 Chromium / WebKit 中 `relList.supports("modulepreload")` 为 `true` 会提前 `return`，因此运行时真实页面上实际激活的 `subtree: true` 原生 `MutationObserver` 为 `laolao-dom-watch.js` 的 **1 个**（外加 `ui/injections/*.js` 中保留的 **28 个非 `subtree` 局部 `MutationObserver`**，如监听 `<html data-laolao-mode>` 单节点属性或 `.chat-thread` 直接子节点的观察器）。

### 4.2 11 项真实页面交互对比与浏览器 CPU/长任务实测状态（只认证据，没跑写「没测」）

- **状态说明**：
  本会话于 `2026-11-21 19:01 -08:00` 在 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b` 完成了 `openclaw@2026.7.1-2` 与 5 套真实页面（`ui-pre-m3` `dbc49e4b`、`ui-main` `fa57fcc7`、`ui-mid-a` `8be3fbc0`、`ui-mid-c` `1663cd80`、`ui-mid-e5` `6eac8ce6`）的完整安装并编写好 5 端口（`5135–5139`）Playwright 自动化交互与 CDP 性能采集脚本 `real-page-audit.mjs`。
  但在准备安装 `playwright` 依赖启动浏览器时，系统发生服务重启（恢复时间为 `2026-11-26 15:00 -08:00`）。重启恢复后第一时间检查 C 盘剩余空间（`exit 0`）：
  ```text
          Used       Free FreeGB
          ----       ---- ------
  212956086272 1536421888   1.43
  ```
  C 盘剩余空间仅 **1.43–1.64 GB**，低于任务单硬性规定的 **8 GB** 停机线（「C 盘剩余低于 8GB 就停下报告；结束时只删你自己这次创建的临时文件和进程」）以及 `CONCURRENCY.md` 第七节的 **3 GB** 停机线。因此按规矩立即停止在 C 盘解压 `openclaw` 与启动 Chromium 浏览器，**不伪造任何未在重启后亲手跑完的浏览器证据**：

| 检查项 | 结论 | 证据与说明 |
|---|---|---|
| 隔离目录两份真实页面 + 3 个中间提交安装（`openclaw@2026.7.1-2` + `apply-theme.ps1`） | **过** | 重启前已在 `C:\Users\34786\AppData\Local\Temp\pinkie-m3-review-9c4b` 完成 5 套真实 Control UI 安装（`exit 0`，输出原文见 §1.2）。 |
| 47 处 `setInterval` 迁移逐个核对（47 行表） | **没过（发现阻塞缺陷）** | 见 §二 问题 2、问题 3、问题 4 及 §三 47 行详表：存在长周期定时器阻塞短周期定时器首次执行（`[Repro-2]`）、47 处全部 `pauseWhenHidden: true` 弄坏后台运行状态/计时/通知/菜单栏心跳/消息窗口保护（`[Repro-3]`）、无 `visibilitychange` 唤醒等问题。 |
| 47 处 `MutationObserver` 迁移核对 | **没过（发现重要缺陷）** | 见 §二 问题 1 与问题 5：`createObserver` 单 `sub` 覆盖导致 `laolao-learning-reminder.js:119-120` 丢失对 `<html data-laolao-mode data-pinkie-study-desk>` 的监听（`[Repro-1]` 实测 `hitsOnRootAttrs: 0`）；另有 11 个文件共 15 处对可选 `createObserver` 返回值的无保护 `.disconnect()` / `.observe()` 调用。 |
| M3 中间提交抽查（`8be3fbc0`、`1663cd80`、`6eac8ce6` 等） | **没过（违反 M3-4 ★ 与 Z1 ★）** | 见 §二 问题 5：Batch B (`f20d20e0`) 至 `fe1555ad` 期间 `tools/study-desk/harness.mjs` 漏加载 `laolao-dom-watch.js`，Batch C (`1663cd80`) 至 M3-5 (`6eac8ce6`) 期间有 3–11 个单测文件失败，`1dc4f4cc` / `6eac8ce6` 上 `laolao-resume.js:2591` 无可选链导致单测崩溃。 |
| 11 项真实页面浏览器交互逐项操作对比、浏览器内 M3-2 运行时计数、CPU/长任务前后对比 | **没测（C 盘剩余 1.43–1.64 GB < 8 GB 按规矩停机）** | 服务重启后 C 盘剩余 1.43–1.64 GB < 8 GB，按任务单规矩立即停机报告（注：会话中断期间主线已通过 PR #61 `maint/m3-fix-dom-watch` 修复了观察器与轮询原生行为，并通过 PR #78 `maint/m3-4-real-page` 补测了真实页面）。 |

---

## 五、总结与建议

1. **M3（PR #53 `3cd2ac6f` / `fa57fcc7`）确实在真实页面逻辑中引入了回归缺陷**：
   - **阻塞级**：`scheduleTimerTick()` 在有长周期定时器（如 60s/15s）排队时直接 `return`，导致后注册的短周期定时器首次执行被卡住长达 15s–60s；
   - **阻塞级**：`domWatch.poll` 默认 `pauseWhenHidden: true` 且全仓 47 处迁移 0 处传 `false`，外加缺少 `visibilitychange` 唤醒，导致窗口隐藏期间的运行状态条轮询（`laolao-run-status.js`）、断线重连完成通知触发（`pinkie:run-recovered`）、后台窗口标题提醒前缀守护（`laolao-run-notify.js`）、流式生成计时起点（`laolao-usage-stats.js`）、原生菜单栏运行会话心跳（`laolao-native.js`）、后台消息窗口裁剪保护（`laolao-resume.js`）以及后台舞台容器绑定（`laolao-cle-stage.js`）全部在隐藏窗口时停摆；
   - **重要级**：`createObserver()` 只维护单个 `sub` 对象，导致 `laolao-learning-reminder.js` 连续调用 `observer.observe(root, ...)` 与 `observer?.watch(document.body, ...)` 时，`root`（`<html>`）上的 `data-laolao-mode` 和 `data-pinkie-study-desk` 监听被直接覆盖丢失；
   - **重要级**：11 个文件中存在 15 处对 `window.Pinkie?.domWatch?.createObserver(...)` 返回值未加 `?.` 的 `.disconnect()` / `.observe()` 调用（如 `laolao-resume.js:2597`、`laolao-cle-stage.js:805`）。
2. **当前环境说明**：
   - 本机 C 盘当前剩余空间仅 **1.64 GB**（低于 8 GB 阈值），本会话创建的临时文件已全部清理，端口 `5135–5139` 与 `18789` 均为空闲（`FREE`），未改动任何产品代码，仅提交本文件 `briefs/maintenance-1120/review/M3-precheck.md`。
