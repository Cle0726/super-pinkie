# REPAIR · EFFECTS — 思考/运行状态特效

范围：`services/cle-studio/src/process/`（status.js、particles.js、新增 model.js / focus.js / effects.css）、
`tests/cle-effects-*.test.mjs`、`services/cle-studio/.harness/`（自测用，非运行时资源）。
未改：原版 `ui/injections`、`ui/assets`、`src/rooms/split.js`、`composer/`、`companion/`、`main.js` 的模块注册顺序（只加了一行 CSS import）。

分支 `repair/effects`，起点 `253fc1091d03723954ce6c030a7cbc5fe2771d47`。

---

## 一、问题 → 修改

### 1. 状态编排没有真正搬过来，只加载了一个画布

原版 `laolao-cle-stage.js` 的编排是：网关事件 → 步骤队列 → 每步至少停 1400 ms → 动词/命令标签/用时 → 粒子形态跟着步骤变 → 结束落款 → 回到签名。新版 `status.js` 只做了「事件来就改文字」，没有队列、没有节拍、没有落款时机、没有失败收束。

**修改**：把编排抽成无 DOM 的 `model.js`（`applyEvent` / `pace` / `holdFor` / `stateFor` / `argText` / `kindOf`），视图只负责画。参数与原版对齐：`MIN_STEP=1400`、`DONE_HOLD=6900`、`STOP_HOLD=1200`；动词表与原版一致（含 `plan`、`ask`）。

### 2. 粒子视口比例与可辨识度

原版是 `fitW:10.2, fitH:5.4` 固定值，标记盒 46×22。新版盒子 84×44，仍用固定 fitW，比例失配导致签名被裁。

**修改**：`fitH` 固定 5.4（保持原构图），`fitW` 按标记盒实际宽高比推导并设下限 9.6；CSS 标记盒改为 52×26（贴近原版 46×22 的观感，同时容纳粒子），窄容器再降到 44×24。

### 3. 深浅背景颜色

`laolao-cle-space.js` 的调色板按 `data-pinkie-night` 切换。新版把原生主题映射成该属性（`main.js` 已有），但状态行文字/标签/扫光没有配套的深色值。

**修改**：`effects.css` 为 `:root[data-theme-mode="dark"]` 单独给扫光渐变与标签底色；粒子本身沿用 `cle` 调色板的 night/day。

### 4. 扫光与动词/文件标签

原版扫光是「动词 + 命令」同一节拍、命令晚 0.22 s，且只在运行时生效，完成后停止。

**修改**：`data-live="1"` 时才跑 `cle-sweep`；标签用等宽 chip，换步骤时浮入；完成后去掉扫光，文字回到 `ink-2` 保证可读（不是三级灰）。

### 5. 工具切换不跟手

**问题**：`thinking` / `assistant` 事件每一帧都触发重绘；`applyEvent` 对未变化的状态也返回 true。

**修改**：背景步骤只在真正变化时返回 true；视图层用签名比对，签名没变就不碰 DOM。

### 6. 出错/停止/完成后的收束

**问题（真实缺陷）**：原版在 indicator 消失后把状态行挂到 turn recap 上落款。新版只在 `.chat-working-indicator` 里画线，运行一结束 indicator 被移除，线随之消失 —— 落款根本没有发生的地方。

**修改**：锚点降级链 `indicator → turn-recap → 最后一个 activity row → 该回合 group`。结束到重绘之间留 `GRACE=2500 ms` 不放弃（否则那一瞬间的空窗会把落款丢掉）。完成后若历史定论是「已中断」（`adopt` 语义），撤回已写的「完成」，改为安静收束。

### 7. 相对原版的真实缺陷：GPU 实例与自激

- **GPU**：每次 `attach` 都可能新建 `CleSpace`，双 pane 各自一套，缓存 pane 也算「可见」，实测到 3 个上下文。
  **修改**：`createGlyphPool` 按 session 复用，上限 2；只服务真正呈现的 pane（过滤 `inert` / `aria-hidden`）；淘汰时优先淘汰已静止的；`webglOK()` 的探测上下文用完立刻 `loseContext()`。
- **自激**：`MutationObserver` 观察 `document.body`，自己的写入会再次触发 → 无限重扫 + 不断建实例。
  **修改**：只观察 pane；`shouldRescan()` 排除 `.cle-status` 内的记录与「只有我们节点」的记录。这条有专门测试。

### 8. 运行时聚焦与压暗

原版运行中把侧栏、栅栏、环境画布、以及**所有**早先回合一起压暗并 `blur`，长时间运行时整页发灰。

**修改**：分成两层——装饰（环境画布、猫、位置轨、侧栏、工作区栏）退让，只降透明度、不 blur、悬停即恢复；当前回合打标，只有它**之前**的回合轻降至 0.72。**不活动 pane 完全不压暗**，正在读的回合永不压暗。`prefers-reduced-motion` 下所有退让取消。

### 9. 无障碍

**问题**：`.chat-working-indicator` 与 `.chat-turn-recap` 自身都是 `role="status"`，再嵌一个 live region 会导致重复播报。

**修改**：状态行 `aria-hidden="true"`，只做视觉层；信息由原生 region 播报。

---

## 二、自测结果（结构/生命周期，非视觉验收）

### 单元/回归测试

```
node --test tests/cle-effects-model.test.mjs tests/cle-effects-view.test.mjs
→ tests 19 / pass 19 / fail 0
```

覆盖：每步最少停留、快速工具不被吞、队列保序、prep 阶段去重、未变化不重绘、end/error/abort 三态、`stateFor` 值域、用时格式、审批 → 等你确认、观察器自激、双 pane 独立 run、非当前会话的事件不被挪用、长跑背景步骤。

### 真实浏览器（headless Chrome + CDP，本地临时页）

`.harness/run.mjs`、`.harness/perf.html`、`.harness/probe-reduce.mjs`。跑的是真实 `src/process/*` 与 `static/legacy/*` 渲染器，不是复制品。

| 检查 | 结果 |
| --- | --- |
| 运行时状态行出现、动词=正在执行、命令标签正确 | `present` / `正在执行` / `npm test -- --watch=false` |
| 原生 indicator 内容被隐藏（不留双份文字） | `display: none` |
| 结束后落款落到 recap | `DONE_LINE present`、`kind=done`、`verb=完成` |
| indicator 消失到重绘的空窗 | 线仍存在（`GLYPHS_WHILE_GAP 1`） |
| 单 pane 存活 WebGL 上下文 | **1** |
| 双 pane 存活 WebGL 上下文 | **2**（未超过上限） |
| reduced-motion | 上下文 **0**、`mode=static`、静态签名可见、`animation: none` |
| 200 步长跑 + 200 次重绘 | 1 条线、1 个 canvas、1 个存活上下文、耗时 8.5 s |

### 构建

`node build.mjs` 成功：`js 61.6 KB / css 59.8 KB`。生成物已还原（`openclaw.plugin.json` 由主控改）。

### 全量回归

改动前基线：832 项 / 通过 821 / 失败 11。
改动后：851 项 / 通过 840 / 失败 11。
新增 19 项全部通过；那 11 项失败在基线上完全相同，属既有问题（原版 bundle patch、installer、pony 命名等），不在本任务范围。

---

## 三、自主发现（本轮主动审查新增）

| # | 发现 | 位置 | 触发条件 | 处理 |
| --- | --- | --- | --- | --- |
| A1 | 落款无落点：运行结束 indicator 被移除，线随之消失 | `status.js` | 任意一轮运行结束 | 已修：锚点降级链 |
| A2 | 结束到重绘空窗会丢落款 | `status.js` | 历史重渲染慢于 1 帧 | 已修：`GRACE=2500ms` |
| A3 | 缓存 pane 被当作可见，额外建渲染器 | `status.js` `/` `split.js` 的 `visiblePanes` | 单 pane 但存在缓存 pane | 已修（本文件内过滤，未改 `split.js`） |
| A4 | `webglOK()` 探测上下文泄漏 | `particles.js` | 首次需要动画时 | 已修：`loseContext()` |
| A5 | 实例池淘汰可能淘汰正在工作的实例 | `particles.js` | 池满 | 已修：优先淘汰静止实例 |
| A6 | `applyEvent` 对未变化状态返回 true → 每帧重绘 | `model.js` | `thinking`/`assistant` 流 | 已修 |
| A7 | prep 阶段重复入队 | `model.js` | 同一 phase 连续到达 | 已修 |
| A8 | 嵌套 live region 重复播报 | `status.js` | 任意 | 已修：`aria-hidden` |
| A9 | 完成态用三级灰，可读性不足 | `effects.css` | 运行结束 | 已修 |
| A10 | `focus.turnOf` 把工具组误当回合容器 | `focus.js` | 有工具活动时 | 已修：按 indicator 祖先定位 |

### 跨所有权问题（记录，未改）

| 位置 | 现象 | 最小修法 |
| --- | --- | --- |
| `src/rooms/split.js` `visiblePanes()` | 返回缓存 pane，其它模块若直接用它遍历会重复处理 | 增加 `presentedPanes()`（过滤 `inert`/`aria-hidden`）并让调用方改用；本任务已在 `status.js` 内自建过滤，未改动该文件 |
| `src/composer/composer.css:88` | `container: cle-pane / inline-size` 是状态行容器查询的唯一来源 | 若该文件被改写，`effects.css` 里的 `@container cle-pane` 会静默失效；建议保留容器名 |
| 原生 `.chat-working-indicator` | 自带 `role="status"` 与 `openclaw-working-phrase` | 我们只隐藏其视觉子节点；若上游改结构，`> :not(.cle-status)` 需复核 |
| `static/legacy/laolao-cle-space.js` | `dispose()` 未 `renderer.forceContextLoss()` | 频繁销毁重建时上下文回收依赖 GC；建议加一行 `this.renderer.forceContextLoss()`（属 legacy 静态资源，本任务未改） |

---

## 四、原能力对应

| 原版能力（`laolao-cle-stage`） | 新版状态 | 说明 |
| --- | --- | --- |
| 网关事件驱动（lifecycle/thinking/tool/assistant/plan） | 保留 | `model.js applyEvent`，另加 `run_status`、`execution` 审批 |
| 工具名 → 动词/形态 | 保留 | `kindOf` 规则逐条对齐（含 `code_check` 仍归 exec 的原行为） |
| 命令/路径/搜索词标签 | 保留 | `argText`，含 `~/` 缩写与行号范围 |
| 每步最少停留 1400 ms | 保留 | `MIN_STEP` |
| 扫光（动词 + 命令错拍） | 保留 | 仅运行时 |
| 用时显示 | 保留 | `fmtElapsed`（秒 / 分） |
| 完成落款 6.9 s | 保留 | 粒子 `done` 时间线 |
| 中断安静收束 | 保留 | `STOP_HOLD=1200`，粒子 `idle` |
| 重绘后落款接管、定论撤回 | 保留 | `GRACE` + `endedAsStopped` |
| 运行中焦点/装饰退让 | 保留但**减弱为只降透明度** | 见问题 8，按 FUSION 要求避免长时间压暗 |
| 工具参数持久化（localStorage） | **未移植** | 原版为历史卡片补参数；新版工具行由原生渲染，不需要该缓存 |
| 工具组折叠成一行「已运行 N 个命令」 | **未移植** | 属过程卡片渲染（`pinkie-process`），新版 DOM 无对应结构；记录给主控 |
| 「思路」长文折叠 | **未移植** | 同上，跨模块 |
| 静态签名小标（不耗性能） | 保留 | `signatureMark()`，reduced-motion / 无 WebGL 时使用 |

---

## 五、未验证项 / 剩余风险

1. **真实视觉未验收**。以上全部是结构、生命周期、上下文数量的机器验证；签名像素是否对齐、粒子在 52×26 盒里的观感、扫光速度是否合适，需要主控用真实窗口和真实模型看。我不声称看过截图。
2. **事件字段以现有实现为准**。`applyEvent` 认 `lifecycle.phase`、`tool.phase`、`chat.state`；若 2026.10.4 之后字段改名，需要同步。已对 `tool`/`execution`/`plan` 做了宽松兼容，但没有逐个字段与线上抓包比对。
3. **落款落点依赖 recap 的稳定性**。`chat-turn-recap` 目前在 continuation 形态出现；纯文本回合会降级到回合 group 作为独立一行。真实观感需要目视。
4. **双 pane 的 GPU 上限是 2**。若将来支持三 pane，`MAX_GLYPHS` 需要同步调整，否则第三侧会走静态签名。
5. **`endedAsStopped` 的选择器**基于 `.chat-tasks-status` / `.chat-group--error`。上游若换 class，撤回逻辑会失效（不会误报完成，只是不再撤回）。
6. **harness 不是产品代码**。`.harness/` 只用于本任务自测，未打包进 dist；主控可删。

---

## 六、需要主控注册

`src/process/effects.css` 的载入顺序（已在 `main.js` 加一行，仍需确认合并时保留）：

```
import './process/status.css';    // 排版（另一任务负责）
import './process/effects.css';   // 本任务：动效/配色/标记，必须在其后
```

`effects.css` 对同名属性是覆盖关系，放在 `status.css` 之前会失效。

---

## 七、Commit

见本轮提交（`repair/effects`）。报告随代码一并提交。

---

# 补充提交 · 真实协议接线与双 pane 收尾

主控审查 `d35e038` 后指出三类问题。以下为补充差异。

## 一、真实 chat payload（原实现读错了字段）

**核对依据**：从运行时 `dist/chat-broadcast-*.mjs`、`chat-abort-*.mjs`、`chat-send-handler-*.mjs` 查到的实际广播帧是

```js
{runId, sessionKey, agentId?, seq, state, message?, text?, stopReason?, errorMessage?}
```

`state ∈ delta | final | error | aborted`。**没有 `stream` 字段**。旧 `applyEvent` 只在 `p.stream === 'chat'` 时处理，等于真实终端帧全部丢弃，运行永不结束。

**修改**（`model.js`）：
- 新增 `normalizeChat(p)`：顶层 `state` 归一化成 `{stream:'chat', data:{state}}`；非 chat 帧返回 `null`。
- 新增 `isLiveEvent(p)`：只有真正表示「正在工作」的事件才允许创建 run。

## 二、幽灵 run

**问题**：`onAgent` 在 `applyEvent` 返回 false **之前**就 `newRun()`。任何带 `sessionKey` 的未知事件（`usage`、裸 `final`）都会留下 `on: true` 的 run，帧循环永不停止。

**修改**（`status.js`）：
- 未知/终端事件不再创建 run（`isLiveEvent` 门控）。
- 新增墓碑 `tombstones`：run 结束后，DOM 里残留的 working indicator 不会被误判为新一轮（`RESUME_AFTER = 8000ms` 后或真实 `start` 才允许重建）。这是本轮最重要的修复 —— 没有它，每次运行结束都会立刻生出新的忙态。

## 三、双 pane 收尾

**问题**：`focus.set(runs)` 只在「所有 run 都不 live」时清空所有 pane。左侧完成、右侧继续时，左侧的 `data-cle-focus-run` / `data-cle-focus` 永远留着。`focus.clear` 从未被调用。

**修改**：
- `focus.set(liveKeys)` 改为按 pane 自己的 session key 逐个释放，不再等全局静止。
- 根节点 `data-cle-live` 由「仍有标记的 pane 数」决定，缓存/不可见 pane 不再钉住它。
- `focus.note` 不再依赖整秒节流（原来同一秒内的重渲染会整秒跳过标焦点）。
- pane 标记不再依赖能否立刻找到 turn：turn 尚未渲染时仍会先打 pane 标记，下次再补。

## 四、旧历史污染当前轮

**问题**：`endedAsStopped` 查整个 pane，历史里任何 `.chat-group--error` 都会让之后成功的一轮误报「已中断」。

**修改**：run 自行记录它真正拥有过的 turn 集合（`run.turns`），只有这些 turn 上的停止/错误标记才算定论。

## 五、本轮新增测试

真实浏览器双 pane 行为测试 `.harness/panes.html`（18 项）：

| 断言 | 结果 |
| --- | --- |
| 两 pane 同时工作时根节点 live | PASS |
| 两 pane 各自获得焦点标记 | PASS |
| 两条线各自落在自己的 indicator 内 | PASS |
| 左侧结束后根节点仍 live（右侧在工作） | PASS |
| 左侧结束后释放自己的 run/turn 标记 | PASS |
| 旧错误不污染后续成功轮（`kind=done`） | PASS |
| 全部结束 → 根节点释放、无 pane 残留标记 | PASS |
| 裸 `final`/`aborted` chat 帧不产生忙态 | PASS |
| 未知 stream 不产生幽灵 run | PASS |
| 真实 `chat final` 能结束运行 | PASS |
| 空闲后帧循环不空转（600ms 内 2 帧） | PASS |

模型层新增 4 项（`cle-effects-model.test.mjs`，共 16 项）：chat 帧归一化、真实终端帧结束运行、aborted/error/final 三态、`isLiveEvent` 门控。

合计：`node --test` 23 项全通过；`.harness` 三个页面（effects / perf / panes）全通过；`node build.mjs` 成功（62.9 KB / 59.8 KB）。

## 六、本轮未验项

1. `RESUME_AFTER = 8000ms` 是经验值。真实场景中「页面中途打开、indicator 已在」的恢复依赖它；若原生 indicator 的生命周期短于该值，可能漏接一次恢复。需要主控用真实窗口观察刷新后的首屏状态。
2. `run.turns` 依赖 `anchor.closest('.chat-thread-inner > .chat-group')` 能命中。若上游改变回合容器层级，撤回逻辑会退化为「不撤回」（不会误报停止，但也不会纠正）。
3. 双 pane 测试用的是自建 DOM，结构和 class 按当前 `control-ui` 产物抄写；上游改 class 名会失效。
4. 视觉仍未经我目测：本轮所有结论来自 DOM 状态与计数，不涉及观感。
