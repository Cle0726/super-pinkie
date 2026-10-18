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
| 补丁 | `recovery.js` 读 `data-message-text`（属性，未经翻译/截断）判断前缀，给气泡打 `data-cle-internal-turn`，整组命中时给组打 `data-cle-internal-only`；样式由模块自己注入（`.chat-bubble[data-cle-internal-turn="1"]{display:none!important}`）。**只做展示折叠**：消息数据、历史、日志、`data-message-text` 一律原样保留。 |

保守匹配，明确不动的三类：
- **正文里提到前缀**（`为什么这里会出现 [pinkie-watchdog]`）不匹配——只认行首，且 U+2063 单独成串才认。
- **引用/代码块**：气泡内含 `pre`/`code`/`blockquote` 时一律不折叠（用户是在展示这段文字，不是网关发送）。
- **正常用户消息、助手回复、工具输出**：不进入任何替换路径；没有全局字符串替换。

### 2. 队列/追加/失败的可见提示不统一

| | |
|---|---|
| 原行为 | `laolao-phrases.js` 维护一张手写中英对照表（`Steer queued message → 立即追加这条消息` 等），并只改文本节点值，绝不写 `textContent`（否则删掉 Lit 的注释标记，pane 停止提交新回复）。 |
| 新版现状 | 2026.10.4 已有完整 zh-CN 语言包，绝大多数文案自带中文，**旧的中英对照表整体不再需要**（强行移植会与语言包打架）。但仍有三处缝隙：① `chat.queue.steer` 译成「引导」，与同屏「待发送 / 重试」不成一套词汇，且「引导」在中文里读不出“插到当前运行里”；② 「已引导」徽标和按钮共用同一个词，用户分不清是状态还是动作；③ 网关原始 `sendError` 是英文（`Message will send when the Gateway reconnects.` 等），中文界面里直接露英文。 |
| 补丁 | `queue-copy.js`：只作用于 `.chat-queue` 子树，只写文本节点值（`node.nodeValue`），不碰 `textContent`/`innerHTML`/`replaceChildren`。词表统一为：动作「立即追加」、状态「已追加」、等待「等待重新连接」、结果「未发送」。英文 `sendError` 译成一句人话，**原文写进该元素的 `title`**，可悬停核对。未知词一律原样返回 `null`，不猜。 |

明确排除：`.chat-queue__text`（用户自己排队的原话）和 `.chat-queue__edit-input`（正在编辑的草稿）不参与替换——一条内容恰好写着「引导」的排队消息，保持原样。

### 3. 断线后卡住的队列项不会自己恢复

| | |
|---|---|
| 原行为 | `laolao-resume.js` 的 `resumeQueuedChatMessages`：先确认后端**明确**无活动运行，再把卡住的项交回原生 `retryQueuedChatMessage`；已出现在历史里的项用原生 `removeQueuedMessage` 移除，绝不重发。`laolao-queue-steer.js` 只在原生队列项出现后委托原生 steer，不自己发 `chat.send`。 |
| 新版现状 | 原生**没有**“连接恢复后主动补发”的路径。核对 2026.10.4：`waiting-reconnect` 只在**发送动作内部**被赋值与消费（`control-ui-boot-shared-D3oo_6Fq.js` 的发送封装里），连接回调只做 `kC()`（把 `sending/submitting` 改标为 `waiting-reconnect`）和重新拉历史。原生提供了 `retryQueuedChatMessage` / `removeQueuedMessage` / `steerQueuedChatMessage`（在 `openclaw-chat-pane` 元素上），但需要有人在该 pane 空闲后调用它们。这正是旧层补的缺口。 |
| 补丁 | `recovery.js::recoverPane`：每个 pane 用**自己的** session key（`dataset.mcpAppOwnerKey` 第二段），四项前置条件全部满足才动手：① pane 自有状态空闲（`chatRunId`/`chatSending`/`chatStream`/`chatRunStartup`/`chatRunStatus.phase`/可见且可用的停止键全空）；② `sessions.list` 里**该 key 那一行**明确返回终端状态；③ 队列项属于同一 session；④ 该行没有 `hasActiveRun`。然后：已在历史 → 移除卡片；否则调该 pane 自己的原生重试，**一次一项**，等它自己的队列排空。 |

不越界的三条硬约束（都有测试）：
- **不合成停止**：任何“忙”的信号都直接 return，绝不点停止键、不中断健康运行。
- **不重发已完成请求**：`appearsInTranscript` 要求 runId 相同，或文本相同**且**时间戳在 10 分钟内；拿不到时间戳就不认投递（宁可留卡片）。
- **不串会话**：session key 不符、pane 与 state 不符、`await` 后 pane/state 变过，全部放弃本次恢复。

### 4. 恢复/失败提示的“统一性”检查

- 原生 `sendState` 家族（`sending`/`submitting`/`waiting-model`/`waiting-idle`/`waiting-reconnect`/`unconfirmed`/`held`/`failed`）只有 `waiting-reconnect` 会自动重试。理由是：`unconfirmed`/`held` 表示网关**可能已经收到**，原生在这里设计成让用户看完再决定（`chat.queue.checkDelivery`），自动重发会制造重复消息；`failed` 带着真实错误，必须留给用户看见。**不把所有失败都藏起来**——只有明确是内部续跑的轮次被折叠。
- 上游品牌：语言包里 `chat.placeholder`、`chat.thinking`、`chat.requestFailed` 仍带 `OpenClaw`，而品牌守卫 `brand.js` 的 `CONTENT` 排除 `.chat-group`（正确地避免改用户正文），所以这三句会漏出。`localizeRecoveryChrome` 只按**精确整串**改 `placeholder`，共三条，不碰回复正文。

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
ℹ tests 17   ℹ pass 17   ℹ fail 0
```

覆盖的真实风险（不是镜像实现）：

| 测试 | 防的是什么 |
|---|---|
| 只认行首前缀，`\u2063` 单独成立 | 内部命令与用户讨论内部命令 |
| 组内整轮内部 → 整组折叠；补了正文 → 只折那一条 | 空白头像行与误折真实消息 |
| 代码块里的前缀保持可见 | 用户贴日志/引用被吞 |
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
ok   quoted control text kept visible: true
ok   ordinary message kept visible: true
ok   control group marked internal: 1
recovery smoke: all checks passed
```

> 这一步抓到一个真 bug：`projectPane` 被单独调用时样式还没注入，组被打了标记但 `display` 仍是 `block`。已改为模块求值时就注入样式。单测发现不了，因为单测没有样式引擎。

构建：`node build.mjs` 通过（`js 53.7 KB / css 54.6 KB`），`esbuild --bundle` 无警告。

---

## 四、自主发现（超出本路所有权，交主控分派）

| # | 文件 / 选择器 | 触发条件 | 现象 | 最小修法 |
|---|---|---|---|---|
| 1 | `services/cle-studio/src/core/brand.js` 的 `CONTENT` 与 `WORD` | 任意中文界面首次渲染 | 语言包里 139 处 `OpenClaw`，其中仅聊天区可见的 3 处被本路补丁兜住；侧栏/设置/更新页仍显示 upstream 名 | 在 `brand.js` 增加“非正文 chrome”白名单：`[aria-label]`、`.chat-divider`、设置页 `.settings-*` 前缀；正文仍靠 `CONTENT` 排除 |
| 2 | `static/legacy/laolao-workbench.css:500,503` | 工作台开启 (`data-pinkie-wb="on"`) | 用 `!important` 强改 `.chat-queue` 宽度，与本路新队列文案无冲突，但会让队列卡片与输入框不同宽 | 主控合并时确认这条是否仍需 `!important`；若保留，改成变量 |
| 3 | 原生 `chat.queue.steer` 语言键（zh-CN bundle） | 队列里有已追加消息 | 徽标与按钮共用「引导」一词 | 本路已在 DOM 层区分（状态/动作）。根治需改语言包，属运行时文件，**不在本路范围** |
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

---

## 六、旧能力对应

| 原能力 | 新版落点 | 状态 |
|---|---|---|
| `laolao-phrases.js` 内部轮次隐藏 | `recovery.js` `isInternalTurnText` / `projectPane` | 已实现，单测 + 浏览器冒烟通过 |
| `laolao-phrases.js` 中英对照表 | 由 zh-CN 语言包取代；仅保留队列词汇 + 英文 `sendError` | 有意缩减，理由见 §1.2 |
| `laolao-phrases.js` Lit 安全写文本 | `queue-copy.js` 只写 `node.nodeValue` | 已实现，有测试断言不碰 `textContent`/`replaceChildren` |
| `laolao-resume.js` 断线恢复、未聚焦分屏、卡生成 | `recovery.js` `recoverPane` + `sessionIdle` | 已实现；端到端待主控验收 |
| `laolao-resume.js` 失败哨兵本地化 | 原生已合并失败摘要（`formatFailureSummary`），**不重复实现** | 有意不移植 |
| `laolao-resume.js` 看门狗状态丝带 | 原生没有等价物；本路不另造 UI | 未实现，记录为缺口 |
| `laolao-queue-steer.js` 忙时追加委托 | 原生自带 steer + 队列动作，无需重复 | 已核对，不改 |
| `laolao-queue-steer.js` 「改为结束后发」 | 原生无此控件 | 未移植，记录为待办 |
| `laolao-resume.js` 渲染守卫（Lit 标记自愈） | 属 timeline/patch 路 | 不在本路 |
