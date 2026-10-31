# REPAIR — RECOVERY（恢复 / 追加 / 排队 / 失败）

日期：2026-10-18 · 分支 `repair/recovery` · worktree `wt/repair-recovery`
基线 `253fc1091d03723954ce6c030a7cbc5fe2771d47`，目标运行时 OpenClaw 2026.10.4（插件 `cle-studio`）。

范围：新增 `services/cle-studio/src/recovery/recovery.js`、`queue-copy.js`、测试 `tests/recovery.test.mjs`、冒烟 `tools/recovery-smoke.mjs`。**未改** `src/main.js`、`src/legacy/modules.js`、任何后端、`personas/`、原版 `ui/injections`、美术或 live 配置。

---

## 一、原版行为 → 新版现状 → 补丁

### 1. 内部续跑命令整段出现在聊天里（最高优先）

| | |
|---|---|
| 原行为 | `laolao-phrases.js` 在聊天区按 `data-message-text` 识别 `[pinkie-watchdog]`、`[pinkie-tier-control]`、`[pinkie-tier…]`、U+2063 与重启恢复提示，把整轮标为 `data-pinkie-internal-recovery` 并连组隐藏；`laolao-resume.js` 另有一段同样的历史过滤（`isRenderableHistoryMessage`）。 |
| 新版现状 | 2026.10.4 **完全没有这层过滤**。实测 `control-ui-boot-chat-XcDaYmck.js` / `-BPMc7uzL.js` 中 `pinkie`、`watchdog`、`tier-control` 出现次数均为 0。注意：live 的 2026.7.1 补丁构建里存在 `pinkieAcceptFinalMessage` 等，那是**另一个构建**，不能当作新版已有能力。 |
| 补丁 | `recovery.js` 读 `data-message-text`（属性，未经翻译/截断）判断**完整控制消息形状**，给气泡打 `data-cle-internal-turn`，整组命中时给组打 `data-cle-internal-only`；样式由模块自己注入。**只做展示折叠**：消息数据、历史、日志、`data-message-text` 一律原样保留。 |

**保守识别的依据**（`review-recovery-1537.md` 第 1 条）。真正的控制消息不是“以某前缀开头的一段话”，而是机器生成、带固定脚手架的三段式：

```
[pinkie-watchdog]      <正文>           这是当前用户轮次的内部续跑命令，先生看不到这条消息；不要回复 NO_REPLY，也不要在回复里提到这条命令。
[pinkie-tier-control]  <正文>           这是当前用户轮次的内部续跑命令。
[pinkie-tier-control]  <正文>           这是当前用户轮次的内部续跑命令。立即用 sessions_spawn 补齐缺失角色…绝对不得输出 NO_REPLY 规避缺口。
```

取自 `services/mode-architecture/index.mjs` 的 `watchdogControlMessage()`（225 行）与 `tierControlMessage()`（288–290 行），与实际发出的字节一致。因此判定条件是 **行首前缀 + 行尾脚手架同时成立**，长度阈值只是廉价前置过滤（40 字符），不作为证据。

由此产生的结果，全部有测试：

| 输入 | 结果 | 原因 |
|---|---|---|
| `[pinkie-watchdog] 这个是什么意思` | **显示** | 行尾没有脚手架 |
| `[pinkie-tier-control] 又跑了一遍？` | **显示** | 同上 |
| `[pinkie-tier] 报告` | **显示** | 同上 |
| `[pinkie-watchdog] 继续完成当前这一轮先生交代的工作` | **显示** | 只有前缀，无收尾 |
| 助手复述「[pinkie-watchdog] 是网关内部续跑用的前缀，我自己不会发。」 | **显示** | 不是行首，且无脚手架 |
| 真实 `watchdogControlMessage()` 全文 | 折叠 | 前缀 + 尾句均命中 |
| 真实 `tierControlMessage()` 两种形态 | 折叠 | 同上 |
| 单独 U+2063 | 折叠 | 旧哨兵，无可读文本 |

**证据不足一律保留显示**：任何未同时命中“前缀 + 尾句”的文本都返回 `false`，不猜。

#### 外层引用看来源，不看 DOM 里有没有代码（`review-recovery-real-code-1804.md`）

上一版用 `isQuoted = bubble.querySelector('pre, code, blockquote')` 当作“用户在引用”。真实 CUA 运行证明这是错的：watchdog 的控制消息会内嵌**上一版最终回复草稿**，而草稿里恰好有 ` ```javascript ` 代码块。于是：

- 真正的内部命令 → 被误判为“用户引用” → 不折叠 → **整段提醒 + 草稿 leaked 到界面和 AX**（P1）；
- 而它本来是我唯一想隐藏的那一类。

实测现场（主控提供，仅该 QA 会话）：`rawLength 1489`、`canonicalTail true`、`codeElements 1`、`data-cle-internal-turn null`、`display block`。

修正：判断依据换成**原始 markdown 的首字符**，不看渲染后的标签。真实控制消息一定以 `[pinkie-` 开头，所以只要源文本以引用/围栏标记开头，就是读者在展示它：

```js
const QUOTE_OPEN = /^(?:>|```|~~~|["“「『])/u;   // blockquote / fence / 引号
export const isExternallyQuoted = (raw) => QUOTE_OPEN.test(String(raw || '').trimStart());
```

这样两类样本在 DOM 上完全同形（都含 `<pre><code>`），但判定相反：

| 源文本 | DOM | 结果 |
|---|---|---|
| `[pinkie-watchdog] … ```javascript … ``` … 内部续跑命令。`（真实 fixture，1489 字符） | 含 `<pre><code>` | **折叠** |
| ` ```\n[pinkie-watchdog] … 内部续跑命令。\n``` `（用户整体引用） | 含 `<pre><code>`（同形！） | **显示** |
| `> [pinkie-watchdog] …` | 含 `<blockquote>` | **显示** |
| `“[pinkie-watchdog] …”` / `「…」` | 引号文本 | **显示** |
| `[pinkie-watchdog] 这个是什么意思` | 纯文本 | **显示** |

回归 fixture 使用主控保存的真实控制文本（`tests/fixtures/qa-watchdog-with-code.txt`，仅该 QA 会话），断言就建在这个字节串上，不是手写的理想样本。

不动的内容：正常用户消息、助手回复、工具输出，以及真实错误（见下节）。

### 2. 真实失败不再被吞掉（`review-recovery-1537.md` 第 2 条）

上一版把 `SESSION_FENCE`（`⚠️ Agent failed before reply: … session file changed while embedded prompt lock was released`）也当内部轮次整轮隐藏，这违背“保留真实错误”。现在：

| 文本 | 处理 | 理由 |
|---|---|---|
| `[System] Your previous turn was interrupted by a gateway restart…`（逐字整句） | 折叠 | 这是给模型的内部指令，读者无需据此行动 |
| `⚠️ Agent failed before reply: …session file changed…` | **保留，完整可读** | 这是真实故障，读者需要知道发生了什么 |
| 任何人写的“gateway restart 之后这轮就断了” | 保留 | 不是上游逐字原句 |

配套的组级保护：`syncGroup` 只在该组**每个**气泡都被标记内部时才隐藏整组。真实失败气泡永远不会被标记，所以含失败的同组即使其余气泡被折，整组仍留在屏幕上（`data-cle-internal-only` 不落、`aria-hidden` 不落）。这三条都有测试。

### 3. 队列/追加/失败的可见提示不统一

| | |
|---|---|
| 原行为 | `laolao-phrases.js` 维护一张手写中英对照表（`Steer queued message → 立即追加这条消息` 等），并只改文本节点值，绝不写 `textContent`（否则删掉 Lit 的注释标记，pane 停止提交新回复）。 |
| 新版现状 | 2026.10.4 已有完整 zh-CN 语言包，绝大多数文案自带中文，**旧的中英对照表整体不再需要**（强行移植会与语言包打架）。但仍有三处缝隙：① `chat.queue.steer` 译成「引导」，与同屏「待发送 / 重试」不成一套词汇，且「引导」在中文里读不出“插到当前运行里”；② 「已引导」徽标和按钮共用同一个词，用户分不清是状态还是动作；③ 网关原始 `sendError` 是英文（`Message will send when the Gateway reconnects.` 等），中文界面里直接露英文。 |
| 补丁 | `queue-copy.js`：只作用于 `.chat-queue` 子树，只写文本节点值（`node.nodeValue`），不碰 `textContent`/`innerHTML`/`replaceChildren`。词表统一为：动作「立即追加」、状态「已追加」、等待「等待重新连接」、结果「未发送」。英文 `sendError` 译成一句人话，**原文写进该元素的 `title`**，可悬停核对。未知词一律原样返回 `null`，不猜。 |

明确排除：`.chat-queue__text`（用户自己排队的原话）和 `.chat-queue__edit-input`（正在编辑的草稿）不参与替换——一条内容恰好写着「引导」的排队消息，保持原样。

### 4. 断线后卡住的队列项不会自己恢复

| | |
|---|---|
| 原行为 | `laolao-resume.js` 的 `resumeQueuedChatMessages`：先确认后端**明确**无活动运行，再把卡住的项交回原生 `retryQueuedChatMessage`；已出现在历史里的项用原生 `removeQueuedMessage` 移除，绝不重发。`laolao-queue-steer.js` 只在原生队列项出现后委托原生 steer，不自己发 `chat.send`。 |
| 新版现状 | 原生**没有**“连接恢复后主动补发”的路径。核对 2026.10.4：`waiting-reconnect` 只在**发送动作内部**被赋值与消费（`control-ui-boot-shared-D3oo_6Fq.js` 的发送封装里），连接回调只做 `kC()`（把 `sending/submitting` 改标为 `waiting-reconnect`）和重新拉历史。原生提供了 `retryQueuedChatMessage` / `removeQueuedMessage` / `steerQueuedChatMessage`（在 `openclaw-chat-pane` 元素上），但需要有人在该 pane 空闲后调用它们。这正是旧层补的缺口。 |
| 补丁 | `recovery.js::recoverPane`：每个 pane 用**自己的** session key（`dataset.mcpAppOwnerKey` 第二段），四项前置条件全部满足才动手：① pane 自有状态空闲（`chatRunId`/`chatSending`/`chatStream`/`chatRunStartup`/`chatRunStatus.phase`/可见且可用的停止键全空）；② `sessions.list` 里**该 key 那一行**明确返回终端状态；③ 队列项属于同一 session；④ 该行没有 `hasActiveRun`。然后：已在历史 → 移除卡片；否则调该 pane 自己的原生重试，**一次一项**，等它自己的队列排空。 |

不越界的三条硬约束（都有测试）：
- **不合成停止**：任何“忙”的信号都直接 return，绝不点停止键、不中断健康运行。
- **不重发已完成请求**：`appearsInTranscript` 要求 runId 相同，或文本相同**且**时间戳在 10 分钟内；拿不到时间戳就不认投递（宁可留卡片）。
- **不串会话**：session key 不符、pane 与 state 不符、`await` 后 pane/state 变过，全部放弃本次恢复。

### 5. 恢复/失败提示的“统一性”检查

- 原生 `sendState` 家族（`sending`/`submitting`/`waiting-model`/`waiting-idle`/`waiting-reconnect`/`unconfirmed`/`held`/`failed`）只有 `waiting-reconnect` 会自动重试。理由是：`unconfirmed`/`held` 表示网关**可能已经收到**，原生在这里设计成让用户看完再决定（`chat.queue.checkDelivery`），自动重发会制造重复消息；`failed` 带着真实错误，必须留给用户看见。**不把所有失败都藏起来**——只有明确是内部续跑的轮次被折叠。
- 上游品牌：语言包里 `chat.placeholder`、`chat.thinking`、`chat.requestFailed` 仍带 `OpenClaw`，而品牌守卫 `brand.js` 的 `CONTENT` 排除 `.chat-group`（正确地避免改用户正文），所以这三句会漏出。`localizeRecoveryChrome` 只按**精确整串**改 `placeholder`，共三条，不碰回复正文。

### 6. 失败退避：真实尝试即退避（`review-recovery-1537.md` 第 3 条）

上一版只在 `recoverPane` **返回非空**时才记冷却。原生重试同步 throw 或 Promise reject 时，调用已经真实发生、但返回值是空，于是下一批 DOM/重连事件可以立刻再来一次——连不上网关时就是一秒多次的重试风暴。

现在 `recoverPaneDetailed` 返回 `{retried, removed, attempted}`，`attempted` 只要**触碰到原生动作**（重试或移除）就为 `true`，与成败无关。`pass()` 用 `attempted` 而非 `retried.length` 记冷却，冷却期内连 `sessions.list` 都不发。

同时区分了两类“没动手”，它们**不**触发冷却，否则一次瞬时忙碌会把恢复冻结好几秒：

| 情形 | `attempted` | 记冷却 | 理由 |
|---|---|---|---|
| 重试成功 | `true` | 是 | 已发起新运行 |
| 重试同步 throw | `true` | 是 | 动作已发生 |
| 重试 Promise reject | `true` | 是 | 同上 |
| 移除已投递卡片 | `true` | 是 | 同属恢复动作 |
| pane 忙 / 状态未知 / 无卡住项 / 会话变了 | `false` | 否 | 没有触碰网关，瞬时状态 |

原有两条硬约束没变：仍不重发 `unconfirmed`/`held`（可能已送达），仍不合成停止。

### 7. 「看门狗状态丝带」「改为结束后发」——原生已有等价能力（第 4 条）

上一版报告把这两项列为“未移植缺口”，这个判断是错的。核对 2026.10.4 实际 bundle 后：

| 旧能力 | 原生等价物 | 证据 |
|---|---|---|
| 看门狗进行中的状态丝带 | 运行状态条：`agent-chat__run-status agent-chat__run-status--interrupted`，中文「已中断」（`chat.composer.runInterrupted`），5 秒窗口内显示 | `control-ui-boot-chat-XcDaYmck.js` `vT()`；`zh-CN-DUWCwJ3h.js` `runInterrupted:\`已中断\`` |
| 「改为结束后发」（把已追加的消息降级为排队） | 「智能体工作时的后续消息」设置：`followUpMode` = `steer`（引导当前运行，即立即追加）/ `queue`（排队等待本次运行结束）；`alternateFollowUpMode` 由 Enter/⌘Enter 切换 | `zh-CN-DUWCwJ3h.js` `followUpMode`、`followUpModeQueue:\`排队等待本次运行结束\``、`followUpModeSteer`；bundle 中 `e.followUpMode===\`steer\`?\`queue\`:\`steer\`` |

因此本路**不重新造一套**状态条或降级按钮：重复实现会与原生 `followUpMode` 争夺同一状态，反而制造两个真相。原生已覆盖“运行中断可见”和“运行中追加/排队的切换”。

真正的缺口是**原生文案与新版词汇不一致**（`引导当前运行` 与队列徽标 `已追加` 不同源），这属于语言包而非本路可改文件，已列入自主发现 #3。

---

## 二、依赖顺序（主控注册）

入口由主控接，本路不碰 `main.js`。挂载顺序：

```js
import {mountRecovery} from './recovery/recovery.js';
// 在 safe('status', …) 之后、safe('shim', …) 之前即可；
// 与 status 无依赖，只需早于任何真实聊天交互。
safe('recovery', () => mountRecovery(host, controller.signal));
```

- `recovery.js` 自行注入样式，**不需要**改 CSS 导入顺序。
- 只用 `host.onEvent('agent')`、`host.subscribe()`、`host.connection.connected`、`host.request('sessions.list')`，均为 `control-ui.d.ts` 已声明接口。
- 与 `process/status.js` 复用同一个 `visiblePanes()`，两 pane 各自独立，无共享可变状态。

---

## 三、自测结果

```
node --test tests/recovery.test.mjs
ℹ tests 30   ℹ pass 30   ℹ fail 0
```

覆盖的真实风险（不是镜像实现）：

| 测试 | 防的是什么 |
|---|---|
| **真实 fixture（1489 字符，含 ```javascript）被折叠** | P1：内部命令因草稿含代码而漏出（本次 review 1804） |
| **同一 fixture 加 `>` / fence / 双引号 / 「」外层引用后保持显示** | 矫正过度：把读者引用也当内部命令 |
| 同形 DOM（都含 `<pre><code>`）的两个相反结果 | 证明依据是源文本而非标签 |
| 真实 `Agent failed before reply` 与折叠项同组 | 真实故障被连带隐藏 |
| 真实两段控制消息（含 yield 变体）被折叠 | 主页丢内部命令 |
| `[pinkie-watchdog] 这个是什么意思`、`[pinkie-tier] 报告`、`[pinkie-tier-control] 又跑了一遍？` | 用户无围栏提问被隐藏（本次审查第 1 条） |
| 助手复述内部前缀（带前缀、带词、无脚手架） | 正常回复被当成内部命令 |
| 真实 `Agent failed before reply` 与同组内部消息共存 | 真实故障被吞（本次审查第 2 条） |
| 组内整轮内部 → 整组折叠；补了正文 → 只折那一条 | 空白头像行与误折真实消息 |
| 代码块里的前缀保持可见 | 用户贴日志/引用被吞 |
| 重试同步 throw / Promise reject 均 `attempted: true` | 失败时不退避、形成重试风暴（第 3 条） |
| `shouldAttempt` 在 0/50/400/2000/5999ms 全拒、6000ms 放行；未尝试过立即可试 | 退避窗口本身写错 |
| 只有 `waiting-reconnect` 自动重试 | 把“可能已送达”的消息重发成两条 |
| 同文本但 1 小时前、助手说同样的话、无时间戳 | 误判投递 |
| 另一 pane 有活动运行 / 本 pane 有 run / 状态字段缺失 / 请求抛错 | 打断健康运行、串会话 |
| 已投递 → 只移除不重试 | 重复消息 |
| 队列文案：动作/状态分开；未知词返回 null | 用户原文被改、误翻译 |
| 品牌名只在精确 placeholder 上 | 回复正文被改品牌 |

真实浏览器冒烟（headless Chrome，真实样式引擎，不截图、不做视觉判断）：

```
node tools/recovery-smoke.mjs
ok   control turn folded: none
ok   the folded control turn really contained code: true
ok   quoted control text kept visible: true
ok   ordinary message kept visible: true
ok   a short question about the prefix stays visible: true
ok   a real failure stays visible: true
ok   control group marked internal: 1
recovery smoke: all checks passed
```

> 这一步两次抓到单测抓不到的真问题：① `projectPane` 被单独调用时样式还没注入，组被打了标记但 `display` 仍是 `block`；② 冒烟原样本是短句，收紧识别后应不再折叠——冒烟及时暴露了旧样本已过期。单测没有样式引擎，这两类只能靠真实浏览器。

构建：`node build.mjs` 通过（`js 53.7 KB / css 54.6 KB`），`esbuild --bundle` 无警告，四文件 `node --check` 均通过。

---

## 四、自主发现（超出本路所有权，交主控分派）

| # | 文件 / 选择器 | 触发条件 | 现象 | 最小修法 |
|---|---|---|---|---|
| 1 | `services/cle-studio/src/core/brand.js` 的 `CONTENT` 与 `WORD` | 任意中文界面首次渲染 | 语言包里 139 处 `OpenClaw`，其中仅聊天区可见的 3 处被本路补丁兜住；侧栏/设置/更新页仍显示 upstream 名 | 在 `brand.js` 增加“非正文 chrome”白名单：`[aria-label]`、`.chat-divider`、设置页 `.settings-*` 前缀；正文仍靠 `CONTENT` 排除 |
| 2 | `static/legacy/laolao-workbench.css:500,503` | 工作台开启 (`data-pinkie-wb="on"`) | 用 `!important` 强改 `.chat-queue` 宽度，与本路新队列文案无冲突，但会让队列卡片与输入框不同宽 | 主控合并时确认这条是否仍需 `!important`；若保留，改成变量 |
| 3 | 原生 `chat.queue.steer` / `chat.followUpModeSteer` 语言键（zh-CN bundle）；`services/mode-architecture/index.mjs:225,288-290` 控制消息尾句 | 队列里有已追加消息 / 打开“后续消息”设置 / 后端改控制消息文案 | ① 徽标与按钮共用「引导」；② 设置项叫「引导当前运行」，与队列的「已追加」不成一套词汇，用户看不出两者是同一件事；③ 本路识别依赖控制消息尾句，后端改文案则识别失效 | ① 本路已在 DOM 层区分状态/动作；② 根治需在语言包把 `followUpModeSteer` 也改成「立即追加到当前运行」；③ mode-architecture 改尾句时同步通知本路更新 tail 正则。前两项属运行时/后端文件，**不在本路范围** |
| 4 | `src/process/status.js:39` `current()` | 双栏时 | 只用 `host.sessions.selectedKey` 取运行，非活动 pane 的状态条靠 `runs` Map 兜；若两个 pane 同 agent 不同 session，可能显示对方的动词 | 改为 `paneSessionKey(pane)` 取；属 status 路 |
| 5 | `static/legacy/laolao-companion.js:323,553` | 双栏 | 用 `document.querySelector` 取“第一个” `.chat-group.assistant`，非活动 pane 可能读到另一侧 | 统一走 `visiblePanes()` 作用域；属 companion 路 |
| 6 | `src/rooms/split.js:14` `visiblePanes()` | 三栏或 pane 缓存在但未标记 visible | 只匹配 `--visible`/`--active`，缓存但未呈现的 pane 不会被恢复扫描 | 若出现三栏，加 `.chat-pane-cache__pane` 兜底；需主控确认布局 |

均已核对：不是“文件没加载”就断言缺失，而是按 2026.10.4 的 bundle 反查了实际能力。

---

## 五、未验证项与剩余风险

1. **未做真实网关/真实模型验收**。本路禁止操作 GUI 和 live，`recoverPane` 的端到端行为（真实断线 → 真重连 → 真补发）需要主控在 19789 测试网关用 CUA 验一次。单测用的是可控 stub。
2. **`state.chatLoading` 字段**：按 2026.10.4 bundle 中 `chatLoading` 存在来写，若某次构建改名，只会让恢复更保守（不重试），不会误发。
3. **`stop.offsetParent !== null` 兜底**：`offsetParent` 在 `position:fixed` 祖先下可能为 null，此时视为“没在忙”，随后仍会被 `sessions.list` 的显式状态拦住，不会误发。
4. **`.chat-queue__badge--steered` 类名**：取自 2026.10.4 实际模板；若上游改名，状态词会回落为「立即追加」（读起来像按钮，不会造成数据问题）。
5. **`data-cle-internal-only` 与原生 `aria-hidden`**：本路会给整组加 `aria-hidden="true"`，与原生 `chat-pane-cache__pane` 上的同名属性互不干扰；如需读屏逐条核对，主控验收时确认一次。
6. **未验证 2026.10.4 之外的构建**。`pinkieAcceptFinalMessage` 等 live 补丁逻辑未在本路重复实现——目标构建里没有这些符号，重复实现会与主控后续补丁冲突。
7. **chrome 品牌替换只覆盖 3 条**。语言包其余 `OpenClaw` 出现在侧栏/设置/更新页，属 fusion 与 brand 的范围（见自主发现 #1）。
8. **控制消息识别绑定当前脚手架文案**。尾句取自 `mode-architecture` 当前的 `watchdogControlMessage()` / `tierControlMessage()`。若后端改写这句话，识别会失效——失效方向是**保留显示**（多一条噪声），而非误藏内容，符合“证据不足就保留”的要求。后端改文案时需同步更新 `WATCHDOG_TAIL` / `TIER_TAIL` / `TIER_TAIL_YIELD`；建议主控在 mode-architecture 侧改动时一并告知。
9. **重试风暴退避只做到 pane 级 6 秒**。两个 pane 各自计时，不与全局共享；极端情况下两侧同时故障会有两次尝试/6 秒，仍然有界。若要更严可提到全局单例，但会牺牲分屏独立性，本路未做。
10. **「已中断」状态条只有 5 秒窗口**（原生 `vT()` 里 `Date.now()-e.occurredAt>=5e3`），超时即消失。这是原生行为，本路未延长——延长会变成“假进度”式常驻提示。
11. **P1 修复待主控在现存真实会话复验**。本路已用主控保存的同一字节串做单测、也在 headless Chrome 里确认含 `<pre><code>` 的真实控制消息被折叠；但本路不能操作 GUI/live，19789 gen30 上那条已存在的 QA 气泡需要主控重载后直接看：期望 `data-cle-internal-turn="1"`、`display:none`、AX 不再读出内部提醒。
12. **`isExternallyQuoted` 假设控制消息总以 `[pinkie-` 开头**。若后端将来改成别的引导词，需同步扩展 `QUOTE_OPEN` 之外的判定；失效方向仍是“可能误折外层引用”，因此后端改引导词时要一并告知本路。
13. **断线展示修复待主控复验**。本路已用行为测试坐实 abort 不再撤标记/删样式，并在真实浏览器确认折叠存活；但 19789 上“真实断线 → 激活退役 → 重连”的整链路必须由主控重载后复验（截图 `第四轮-真实断线待重连队列.png` 那个场景）。
14. **折叠标记在 abort 后会残留于 DOM**（这是有意设计）。若主控将来需要“彻底卸载不留痕迹”的语义，必须同时接受“退役瞬间重新公开控制消息”的代价；本路选择保留展示结论。

---

## 六、旧能力对应

| 原能力 | 新版落点 | 状态 |
|---|---|---|
| `laolao-phrases.js` 内部轮次隐藏 | `recovery.js` `isInternalTurnText` / `projectPane` | 已实现；单测 + 浏览器冒烟通过 |
| `laolao-phrases.js` 中英对照表 | 由 zh-CN 语言包取代；仅保留队列词汇 + 英文 `sendError` | 有意缩减，理由见 §1.3 |
| `laolao-phrases.js` Lit 安全写文本 | `queue-copy.js` 只写 `node.nodeValue` | 已实现，有测试断言不碰 `textContent`/`replaceChildren` |
| `laolao-resume.js` 断线恢复、未聚焦分屏、卡生成 | `recovery.js` `recoverPaneDetailed` + `sessionIdle` | 已实现；端到端待主控验收 |
| `laolao-resume.js` 失败哨兵本地化 | 原生已合并失败摘要（`formatFailureSummary`），**不重复实现**；真实失败**更不被本路隐藏** | 已核对 |
| `laolao-resume.js` 看门狗状态丝带 | 原生已有 `agent-chat__run-status--interrupted`（「已中断」） | 已核对，不重复造 |
| `laolao-queue-steer.js` 忙时追加委托 | 原生自带 steer + 队列动作，无需重复 | 已核对，不改 |
| `laolao-queue-steer.js` 「改为结束后发」 | 原生已有 `followUpMode` = `steer` / `queue`（「引导当前运行」/「排队等待本次运行结束」），Enter/⌘Enter 切换 | 已核对，不重复造；文案统一见自主发现 #3 |
| `laolao-resume.js` 渲染守卫（Lit 标记自愈） | 属 timeline/patch 路 | 不在本路 |

---

## 七、本轮（review-recovery-1537）修正记录

上一 commit `ef1d63d` 被主控审查指出四条边界，本 commit 逐条处理：

| # | 审查意见 | 本轮做法 | 证据 |
|---|---|---|---|
| 1 | 短前缀即隐藏，无围栏的用户提问会被吞 | 改为“行首前缀 + 行尾脚手架”双条件；单独 U+2063 与逐字重启句另列；长度仅作 40 字符前置过滤；证据不足一律显示 | `WATCHDOG_TAIL` / `TIER_TAIL` / `TIER_TAIL_YIELD` / `RESTART_EXACT`；测试覆盖 4 种无围栏提问与 2 种助手复述 |
| 2 | `SESSION_FENCE` 把真实故障整轮隐藏 | 删除对 `SESSION_FENCE` 的隐藏；`Agent failed before reply` 完整保留；组级折叠加“全部气泡都被标记内部”的前提 | `isInternalTurnText(FENCE) === false`；同组共存测试 |
| 3 | 失败的重试不退避，会形成风暴 | `recoverPaneDetailed` 返回 `attempted`；失败（throw / reject）也置 `true`；`pass()` 改用 `attempted` 记冷却；未触碰网关的情形不记，避免瞬时忙碌冻结恢复 | `shouldAttempt` 边界测试 + throw/reject 两路 `attempted` 断言 |
| 4 | 两项“未移植缺口”是否真缺 | 核对 2026.10.4：原生已有「已中断」状态条与 `followUpMode`（steer/queue）切换，**不再重复实现**；原报告判断已更正 | 见 §1.7 证据表 |

审查文件本身也是证据来源：`/Users/Admin/Documents/Codex/2026-10-18/new-chat/work/review-recovery-1537.md`。

### 补充轮次（review-recovery-real-code-1804）

主控在实际 CUA 运行中复现了 P1：控制消息的草稿里带 ` ```javascript `，于是气泡渲染出 `<pre><code>`，旧的 `isQuoted` 判定把整段内部提醒放行了。修法与证据见 §1.1「外层引用看来源，不看 DOM 里有没有代码」。

| # | 审查意见 | 本轮做法 | 证据 |
|---|---|---|---|
| 5 | 真实内部命令因草稿含 code 而漏出（P1，实际 DOM 复现） | 判定依据从「DOM 里有 pre/code」改为「源文本以引用/围栏/引号开头」；`isExternallyQuoted` | 真实 fixture 折叠 + 四种外层包装显示，单测与浏览器冒烟各一组 |

审查文件：`/Users/Admin/Documents/Codex/2026-10-18/new-chat/work/review-recovery-real-code-1804.md`；fixture：`tests/fixtures/qa-watchdog-with-code.txt`（仅该 QA 会话）。

### 补充轮次（断线 / 热重载生命周期）

主控在 19789 的真实断线演练中确认了**投递**这条路径：停掉测试网关 → 用户离线发一条 → 发件箱出现「正在等待重新连接」→ 重启网关自动送出、无需点重试 → 结果 667 到达 → `chat.history` 里用户消息 1 份、667 回复 1 份。**这一项本路不重做、也不声称亲自操作过 GUI**。

但同一轮暴露了**展示**回退（P1）：host activation 结束时重新露出了 322 字控制消息与 437 字上一稿，旧蓝色气泡/头像与猫的位置也回退。

根因不是我“在线时没识别”，而是 abort 清理方向错了：

```js
// 旧代码（有问题）
for (const el of document.querySelectorAll('[data-cle-internal-turn], ...')) {
  delete el.dataset.cleInternalTurn;      // ← 把已经证实的折叠撤掉了
  el.removeAttribute('aria-hidden');
}
document.getElementById(STYLE_ID)?.remove();   // ← 连折叠规则一起删掉
```

激活退役时，原生历史 DOM 里的消息**原样还在**；撤标记 + 删样式 = 立刻重新公开。断线、热重载、插件重挂都会走这条路径。

修正为「停止行为，保留结论」：

| 类别 | abort 时 | 理由 |
|---|---|---|
| 观察器 / 轮询 / 事件订阅 / 所有定时器 / 待执行 rAF | **全部停止并释放** | 退役的激活不得再调度、写 DOM、发请求 |
| 已证实的 `data-cle-internal-turn` / `-internal-only` / `aria-hidden` | **保留** | 这是静态、幂等的展示结论；撤销它才是泄漏 |
| `#cle-recovery-style` 折叠规则 | **保留** | 同上；下次激活会重新计算同一个答案 |
| 普通消息、引用、代码、真实故障 | 从不标记，故始终可见 | 与之前一致 |

不做全局强隐藏、不改会话数据：标记只落在本模块**正面识别**过的行上；新激活会重新读 `data-message-text`，判错也能自行纠正。

同时补齐了此前确实存在的生命周期漏洞（不是仅搜源码）：

| 位置 | 旧问题 | 现在 |
|---|---|---|
| `start()` 的 900ms timeout | abort 后仍会执行，写 placeholder | 走 `after()`，触发时再查 `aborted` |
| terminal 事件 700ms 回调 | abort 后仍会 `schedule()` | 同上 |
| `requestAnimationFrame` | 只置 `frame = 0`，未取消 | `cancelAnimationFrame` |
| `schedule()` 的 pane 定时器 | 逐个清 `timers`，漏掉已排队的独立 timeout | 统一 `timeouts` 集合，abort 全清 |
| `DOMContentLoaded` 监听 | abort 早于加载时会残留 | 保存 handle，abort 时 `removeEventListener` |
| `await` 中的恢复请求 | 只在外层 `pass()` 检查，内层仍可调用原生 retry | `recoverPaneDetailed` 接受 `isActive()`，await 前后各查一次 |

**验证**（29 项单测 + 13 项真实浏览器）：

- `abort keeps proven internal rows folded and leaves no live work behind`：abort 后标记、`aria-hidden`、样式仍在；observer 已 disconnect；无 interval、无 rAF、无存活 timer。
- `a retired activation cannot retry the gateway or touch the DOM again`：abort 后推进 60 秒，零重试、零 `sessions.list`。
- `abort during an in-flight recovery request does not arm a cooldown or repaint`：请求挂起时 abort，再 resolve——**不重试**（这条抓到了真实缺陷并已修）。
- `terminal callbacks scheduled before abort never run`、`a hot reload leaves exactly one live activation, not two`。
- 浏览器冒烟新增 6 项 abort 检查，含「折叠行 abort 后仍 `display:none`」「规则未删」「引用与普通消息仍可见」。

**仍未验证**：本路不能操作 GUI/live，19789 上真实的“断线 → 激活退役 → 重连”全过程需要主控重载后复验；我能提供的证据是同一 abort 代码路径的行为测试与真实浏览器样式结果，不是亲眼观察。

### 补充轮次（pre-aborted signal 零资源）

主控指出最后一个边界：`mountRecovery(host, alreadyAbortedSignal)` 时，旧代码只把 `aborted = true`，**之后仍然**创建 `MutationObserver`、`host.onEvent`、`host.subscribe`、`setInterval`。回调里虽然都因 `aborted` 直接返回，但这些句柄本身没有释放路径——`addEventListener('abort')` 在已中止的 signal 上不会再触发，所以 observer / interval 会活到页面结束。

修法：在分配任何句柄之前早退。

```js
export function mountRecovery(host, signal) {
  ensureStyle();                                  // 静态折叠规则，保留
  if (signal?.aborted) return () => {};            // 已退役：不创建任何句柄
  let aborted = false;
  ...
}
```

顺序有意为之：`ensureStyle()` 在前，所以“已验证的折叠样式”仍在；早退在**所有** `new MutationObserver`、`onEvent`、`subscribe`、`setInterval`、`setTimeout`、`requestAnimationFrame` 之前。没有恢复旧的在卸载时删除 markers 的做法。

**验证**（沿用已有 lifecycle harness，不新建夹具）：

`mounting with an already-aborted signal allocates nothing`

| 断言 | 结果 |
|---|---|
| `MutationObserver` 实例数 | 0 |
| `setInterval` 存活数 | 0 |
| `setTimeout` 存活数 | 0 |
| `requestAnimationFrame` 存活数 | 0 |
| `host.onEvent` 订阅数 | 0 |
| `host.subscribe` 订阅数 | 0 |
| 推进 60 秒后的 `sessions.list` 调用 | 0 |
| 原生重试调用 | 0 |
| 候选内部行是否被写标记 | 未被写（证明早退后未做投影） |
| `#cle-recovery-style` | 仍存在 |

**反向验证这条测试真的有效**：临时把代码还原成旧的 `let aborted = Boolean(signal?.aborted)`（去掉早退），该测试立刻失败（29 pass / 1 fail），恢复修复后 30/30 通过。所以它断言的是行为，不是实现细节。
