# T3-EVENTS：T3 Code 事件协议 ↔ C.le. 网关现有事件逐个对照（K8-0 · L107）

> 计划：`briefs/cle-core-1120/METRE-NEXT.md` 第四节 K8-0 第 3 条（在 `docs/metre-next-1122` 分支 #462，未合入）。派活：#96 win-coord 7231931033「L107 → T3-EVENTS.md」。
> 只读摸底，不改产品代码。姊妹篇：L105 `T3-MAP.md`（模块与搬不搬）、L106 `T3-LICENSES.md`（许可证）、L108 `T3-RUN.md`（实跑样本）。本篇只管**事件**：对方有什么、我们有什么、怎么对上。

## 〇、对照的是哪两份东西

**T3 Code**：`github.com/pingdotgg/t3code`，浅克隆到临时目录（没进任何仓库，没装依赖，没跑其中任何脚本）。

- 选定提交：`1cb7c46eac3a2914d613641f4b98c4669bef36b9`（2026-11-27T18:02:13-08:00，`fix(web): RTF preview shows text box text (#44598)`）。
- 事件协议全在 `packages/contracts/src/orchestrationV2.ts`（189 729 字节）。下文 `oV2:<行>` 都指这个文件在上面这个提交的行号。
- 网页和服务端之间走一条 WebSocket：`ws://127.0.0.1:<端口>/ws?orchestrationProtocol=2`，消息是 Effect RPC 的 JSON 帧（`Request` / `Chunk` / `Ack` / `Exit` / `Interrupt` / `Ping` / `Pong`）。碧琪的 `services/mode-architecture/engines-rpc.mjs:1-7` 已经按这个格式在连它。

**C.le. 网关**：本仓库能看到的只有裁剪过的 dist `desktop/windows/mac-runtime/openclaw/dist/`（不是完整源码），加上碧琪插件 `services/mode-architecture/` 和界面 `ui/injections/` 里实际收发的事件。dist 里找不到的事件，下文写明「dist 里没有，来源是 ×××」，不猜。

**判定三档**：

- **直接对应**：语义一样，字段改个名就能用。
- **要适配**：C.le. 有近似的东西，但粒度、字段或时机不同，要在 `cle-core` 的 `thread-events`（K8-1）或碧琪里补一层。
- **C.le. 缺**：C.le. 现在没有对应事件。另标「不要」的，是 K8 用不到、建议不补。

## 一、两边的「事件」长什么样

### 1.1 T3：一条带序号、可补发的领域事件流

| 层 | 是什么 | 位置 |
|---|---|---|
| 领域事件 `OrchestrationV2DomainEvent` | 共 49 个 `type`，全部共用一个事件头：`id`、`threadId`，可选 `runId` / `nodeId` / `driver` / `providerInstanceId` / `rawEventId`，必有 `occurredAt`；`payload` 一律是**整条记录的新状态**（不是增量） | oV2:2186-2195（事件头）、2197-2352（全部类型） |
| 落库事件 `OrchestrationV2StoredEvent` | `{sequence, commandId, event}`：全局递增序号 + 触发它的命令 | oV2:2639-2643 |
| 单线程订阅 `orchestration.subscribeThread` | 入参 `threadId` + 可选 `afterSequence`（断线续传）；输出流 `snapshot`（整份投影 + `snapshotSequence`）→ `synchronized` → 逐条 `event {sequence, event}`；不认识的事件类型解成 `unknown-event`，**只推进序号、不报错** | oV2:4345-4355、4426-4456、4458-4481 |
| 外壳订阅 `orchestration.subscribeShell` | 侧栏级别：`snapshot` / `synchronized` / `snapshot-required`（续不上就重拉 HTTP 快照）/ `project.updated` / `project.removed` / `thread.updated` / `thread.removed`，每条带 `sequence` | oV2:2598-2636 |
| 命令 `orchestration.dispatchCommand` | 所有写操作都是一条带 `commandId` 的命令（`message.dispatch`、`run.interrupt`、`runtime-request.respond` …），结果回到上面的事件流 | oV2:3316 起、4779-4787 |
| 命令输出 `orchestration.subscribeCommandOutput` | 单条命令的输出帧 `{kind: replace / append}` | oV2:4136-4146 |
| 全部 RPC 名 | `ORCHESTRATION_V2_WS_METHODS`，23 个 | oV2:4110-4134 |

要点：**序号是全局的，事件是整记录覆盖，客户端靠 `afterSequence` 补发，靠 `unknown-event` 向前兼容。** 这正是 K8-1 要在 `cle-core` 里做的 `thread-events`。

### 1.2 C.le.：按「事件名 + 载荷」广播，没有统一序号

网关帧是 `{type: 'event', event, payload}`（`laolao-sidebar.js:122` 在这样读），界面统一转成 `pinkie:gateway-event`（`laolao-sidebar.js:117-124`，见 `briefs/program-1120/设计-S6.md` 〇节）。能确认的事件：

| 事件 | 载荷要点 | 出处 |
|---|---|---|
| `chat` | `{runId, sessionKey, seq, state: delta / final / error / aborted, message, errorMessage}`；`seq` 按 run 计数，`final` / `error` 之后整个 run 的计数被删 | dist `chat-pg-BxhF6.js:1954-1979`（final）、`:2000-2029`（error）；delta 形状见 `scripts/chat-ui-harness/fake-gateway.js:437-442` |
| `chat.side_result` | 旁问（btw）结果 | dist `chat-pg-BxhF6.js:1983-1999` |
| `agent` | `{runId, sessionKey, stream, seq, ts, data}`，`stream` 见下表 | dist `selection-JInn13lc.js`、`agent-runner.runtime-DtdxZiBX.js` 里的 `emitAgentEvent` |
| `session.tool` | 和 `agent` 的 `tool` 流同一份载荷，发给**别的**订阅了会话的连接（发起方收 `agent`） | dist 里没有；形状见 `fake-gateway.js:429-436`，界面在 `laolao-run-status.js:356`、`laolao-ask-user.js:223` 等处听 |
| `session.message` | 落库的一条消息 `{sessionKey, message, messageId, messageSeq, …}` | dist 里没有；`fake-gateway.js:419-422`，界面 `laolao-ask-user.js:232`、`laolao-context-compact.js:553` |
| `session.operation` | `{…, ts}`，只发给会话订阅者、`dropIfSlow`；界面在等 `operation === 'compact'` | dist `sessions-UcKjjh_n.js:127-133`，界面 `laolao-context-compact.js:571` |
| `sessions.changed` | 调用处只见 `{sessionKey, reason}`（`send` / `steer` / `cleanup`，碧琪自己发 `pinkie-session-sidebar`） | 核心发送文件 `session-change-event-*.js` 不在 dist 里（S6 〇-4）；碧琪 `session-lineage.mjs:372` |
| `exec.approval.requested` / `exec.approval.resolved`、`plugin.approval.requested` / `plugin.approval.resolved` | `{id, request: {command, sessionKey}}` | dist 里没有发送处；界面 `laolao-session-board-data.js:505-510`、`laolao-metre-perm.js`，测试 `tests/metre-perm.test.mjs:252` |
| `terminal.data` / `terminal.exit` | 终端输出 / 退出 | 方法在 dist `server-methods-NpEcZnvp.js:103-113`；界面 `laolao-workbench-term.js:139-140` |
| `plugin.pinkie.lsp.message`、`plugin.pinkie.ai.scan`、`plugin.pinkie.ext.progress` | 碧琪插件自定义事件（网关只放行 `plugin.` 开头的自定义事件，`workbench-lsp.mjs:4`） | `services/mode-architecture/workbench.mjs:797`、`:813`、`:819` |
| `connect.challenge`、`hello-ok` 里的 `tick` / `presence` / `health` | 连接与心跳 | `tests/sidebar-handshake.test.cjs:34`、`fake-gateway.js:280-288` |

`agent` 事件的 `stream` 取值（dist 里 `stream: "…"` 全部出现过的）：

| `stream` | `data` 要点 | 出处 |
|---|---|---|
| `lifecycle` | `phase: start`（带 `startedAt`）；`phase: end / error / finishing`（带 `endedAt`、`stopReason`、`aborted`、`livenessState`、`replayInvalid`、`error`） | `selection-JInn13lc.js:3890-3908`、`:3978-4017` |
| `assistant` | `{text, delta}` | `selection-JInn13lc.js:4411-4415` |
| `thinking` | 思考文字 | `selection-JInn13lc.js:4981` |
| `tool` | `phase: start / update / result`，`name`、`toolCallId`、`meta`、`isError`、`result` | `selection-JInn13lc.js:1763-1884`、`:2082-2095` |
| `item` | 跟踪项 `{itemId, phase: start / end, kind: tool / command / patch, title, status, startedAt, endedAt, summary, error}` | `selection-JInn13lc.js:1326`、`:2097-2110` |
| `command_output` | `{itemId, phase: delta / end, output, status, exitCode, durationMs, cwd}` | `selection-JInn13lc.js:1907-1924`、`:2188-2208` |
| `approval` | `{phase: requested / resolved, kind: exec, status: pending / unavailable / denied / failed, approvalId, approvalSlug, command, host}` | `selection-JInn13lc.js:2126-2152`、`:2211-2229` |
| `patch` | `{itemId, added, modified, deleted, summary}`（只有改了哪些文件，没有差异正文） | `selection-JInn13lc.js:2252-2272` |
| `compaction` | `phase: start`；`phase: end`（`willRetry`、`completed`） | `selection-JInn13lc.js:3777-3785`、`:3844-3860` |

**`pinkie.*` 不是事件**：碧琪的 `pinkie.metre.board`、`pinkie.engines.*`、`pinkie.run.status` 等都是插件注册的**网关方法**（`registerGatewayMethod` / `register`，见 `services/mode-architecture/index.mjs:826-1053`、`engines-bridge.mjs:942-998`），界面靠 `chat` / `agent` 事件触发后再去调。碧琪真正往外推的事件只有上表三条 `plugin.pinkie.*` 和一条 `sessions.changed`。

## 二、总结论（先看这里）

1. **最大的缺口是信封，不是事件名**：C.le. 没有全局序号、没有「从第 N 条往后补发」、没有快照 + 增量的订阅、不认识的事件也没有统一跳过规则。`chat.seq` 只在一个 run 内计数且 run 结束就删（`chat-pg-BxhF6.js:1978`）。这一层 C.le. 整体缺，就是 K8-1 `thread-events` 要补的；「突然空白」「不叫醒」都出在这。
2. **一轮对话的过程大多能对上**：T3 的 `turn-item.updated`（消息、思考、命令、改文件、审批、压缩、出错）在 C.le. 的 `agent` 各 `stream` 和 `chat` 里基本都有近似物，属于「要适配」：C.le. 是「开始 / 增量 / 结束」三段式，T3 是「整条记录每次覆盖」。
3. **运行状态要补**：T3 的 run 有 10 种状态（`preparing` / `queued` / `starting` / `running` / `waiting` / `completed` / `interrupted` / `failed` / `cancelled` / `rolled_back`，oV2:719-730），C.le. 事件里只有「开始 / 结束 / 出错 / 中止」，排队和等人只能从 `sessions.list` 的 `status` 或审批事件里拼。
4. **C.le. 明确缺的**：检查点与回滚、待办请求清单（打开前就在等的审批拿不到，S6 〇-1）、运行重试（attempt）、执行节点树、上下文交接、改文件的差异正文。
5. **K8 不要的**：PR / issue 关联、访客分享、置顶 / 暂缓 / 标签 / 已读、项目克隆这些 T3 自己产品的功能，不进 `thread-events`。

## 三、逐个对照：T3 领域事件 → C.le.

49 个 `type` 全列（oV2:2197-2352 的顺序；`thread.*` 里 23 个共用一个结构的写在一行或几行里）。

### 3.1 线程（会话）本身

| T3 事件 | 载荷 | C.le. 对应 | 判定 | 说明 |
|---|---|---|---|---|
| `thread.created` | 整条 `AppThread` | `sessions.changed`（`sessions.create` 之后） | 要适配 | C.le. 只给 `{sessionKey, reason}`，界面要再读 `sessions.list` 才知道标题、模式、父会话。`thread-events` 里要带整行 |
| `thread.metadata-updated` | 同上 | `sessions.changed` + `sessions.patch` | 要适配 | 改标题等 |
| `thread.model-selection-updated` | 同上 | `sessions.patch` 之后的 `sessions.changed` | 要适配 | C.le. 没有专门的「换模型」事件 |
| `thread.provider-switched` | 同上 | 无 | C.le. 缺 | C.le. 只有一个内置运行时，外部智能体换家是 K8-2 `agents-bridge` 的事 |
| `thread.runtime-mode-updated` | 同上 | 无（`exec.approvals.set` 是按智能体配，不是按会话，`server-methods-NpEcZnvp.js:217-220`） | 要适配 | 「放手程度」现在在碧琪 Metre 自己记 |
| `thread.interaction-mode-updated` | 同上（plan / default） | 无 | C.le. 缺 | 计划模式碧琪是靠工具 `plan_update` + `pinkie.plan.get` 方法 |
| `thread.archived` / `thread.unarchived` | 同上 | 无（碧琪归档在 `session-lineage.mjs` 自己管，再发 `sessions.changed`） | 要适配 | |
| `thread.deleted` | 同上 | `sessions.delete` 之后的 `sessions.changed` | 要适配 | |
| `thread.settled` / `thread.unsettled` / `thread.snoozed` / `thread.unsnoozed` / `thread.auto-settle-set` | 同上 | 无 | 不要 | T3 的收件箱式整理 |
| `thread.pinned` / `thread.unpinned` / `thread.pin-reordered` / `thread.active-reordered` | 同上 | 无 | 不要 | 侧栏排序，碧琪自己存 |
| `thread.tags-updated` / `thread.visited` / `thread.marked-unread` / `thread.visit-recorded` | 同上 / `ThreadVisit` | 无 | 不要 | |
| `thread.pull-request-synced` / `thread.pull-request-link-updated` / `thread.issue-synced` | 同上 / `ThreadPullRequestLink` | 无（碧琪 `pr-flow.mjs` 是方法不是事件） | 不要 | |
| `thread.guest-share-updated` | 同上 | 无 | 不要 | |

外壳流（侧栏）：T3 `subscribeShell` 的 `thread.updated` 每次带整条 `ThreadShell`（标题、状态、`pendingRuntimeRequest`、`latestVisibleMessage`、`pendingBackgroundTasks`、`lastError`、`usageLimitResetAt` …，oV2:2418-2503）。C.le. 对应的是「`sessions.changed` 到了就重读 `sessions.list`」（S6 一节、`laolao-session-list.js:916`）。判定：**要适配**——`thread-events` 里加一类「会话行变了」并带整行，界面就不用每次重读列表。

### 3.2 一轮运行（run）

| T3 事件 | 载荷 | C.le. 对应 | 判定 | 说明 |
|---|---|---|---|---|
| `run.created` | 整条 `Run`（`status`、`queuePosition`、`requestedAt` …） | `sessions.changed`（`reason: send`）+ `agent` `lifecycle start` | 要适配 | C.le. 排队的那一刻没有事件，开跑才有 `lifecycle start` |
| `run.updated` | 同上，状态 10 种 | `agent` `lifecycle` `start / end / error / finishing`；`chat` `final / error / aborted` | 要适配 | `queued` / `waiting` / `interrupted` / `rolled_back` 没有对应；`lifecycle` 已带 `startedAt` / `endedAt`（S6 八-4 的答案：带开始时间戳） |
| `run.background-work-cancelled` | 被取消的后台子任务、命令、监视清单 | 无 | C.le. 缺 | 后台命令被杀时界面只能等 `lifecycle end` |
| `run.output-submitted` | 本轮按 JSON Schema 交回的结构化结果 | 无 | 不要 | K8 用不到 |
| `run-attempt.created` / `run-attempt.updated` | 一轮里的第几次尝试（`initial` / `steering_restart` / `retry` / `provider_recovery`） | 无（dist 里只有内部的 `auto_retry_start`，`selection-JInn13lc.js:8475`，不外发；`lifecycle` 带 `lifecycleGeneration`） | C.le. 缺 | 「重连、重试后界面一致」（K8-1、K8-2 的测试）需要它 |
| `node.updated` | 执行节点（`root_turn` / `tool_call` / `approval_request` / `subagent` …，带 `parentNodeId`） | `agent` `item` 流（`itemId`、`kind`、`status`） | 要适配 | C.le. 的 item 是平的，没有父子树；子任务嵌套靠会话键 `:subagent:` 和 `spawnedBy` |
| `subagent.updated` | 子智能体（`origin: provider_native / app_owned`、`childThreadId`、`status`） | `sessions_spawn` 工具结果 + 子会话自己的事件 | 要适配 | 碧琪 `pinkie.metre.board` 现在自己拼（`metre-board.mjs:320-360`） |

### 3.3 外部智能体那一层（provider）

| T3 事件 | C.le. 对应 | 判定 | 说明 |
|---|---|---|---|
| `provider-session.attached` / `provider-session.updated` / `provider-session.detached` | 无 | C.le. 缺（K8-2 用） | 外部智能体进程的接上 / 断开 |
| `provider-thread.updated` | 无 | C.le. 缺（K8-2 用） | 外部智能体自己的对话编号与状态 |
| `provider-turn.updated` | 无事件；用量只有方法 `sessions.usage`（`server-methods-NpEcZnvp.js:451-459`，慢，S6 二节） | 要适配 | T3 每轮带 `tokenUsage` / `turnTokenUsage` / 实际模型；C.le. 要在 `lifecycle end` 或新事件里带用量 |

### 3.4 等人：审批与提问

| T3 事件 | C.le. 对应 | 判定 | 说明 |
|---|---|---|---|
| `runtime-request.updated`（`kind` 含审批类、`user_input`、`dynamic_tool_call`、`auth_refresh`；`status: pending / resolved / expired / cancelled`） | 审批：`exec.approval.requested` / `.resolved`、`plugin.approval.requested` / `.resolved`，以及 `agent` `approval` 流；提问：`ask_user` 工具的 `tool start / result` | 要适配 | 三个来源要合成一种「待办请求」；C.le. 没有 `expired` / `cancelled`；**没有「列出当前所有待办」的方法**（dist 只有 `exec.approvals.get / set`，那是放手程度配置，S6 〇-1），`thread-events` 补发可以解决「打开前就在等的看不到」 |

### 3.5 消息与过程条目

| T3 事件 | C.le. 对应 | 判定 | 说明 |
|---|---|---|---|
| `message.updated`（整条对话消息） | `session.message`（落库）+ `chat` `final` | 要适配 | C.le. 两条路：本连接收 `chat`，订阅者收 `session.message` |
| `plan.updated`（`proposed_plan` / `todo_list`） | `plan_update` 工具事件 + 方法 `pinkie.plan.get`（`laolao-plan.js:142-143`） | 要适配 | |
| `checkpoint-scope.created` / `checkpoint.captured` / `checkpoint.rollback-requested` | 无 | C.le. 缺 | 差异审阅、撤回到某一步都靠它；C.le. 的 `patch` 流只有文件名计数 |
| `context-handoff.updated` / `context-transfer.created` / `context-transfer.updated` | 部分：`compaction` 流、`session.operation`、方法 `sessions.compaction.branch / restore` | 要适配 / 缺 | 换模型、分叉时带过去的上下文 C.le. 没有事件；压缩算「记录更换」，K8-1 要求它也成事件 |

`turn-item.updated` 的 `payload` 是一个过程条目（oV2:1914-2151），逐类：

| 条目 `type` | C.le. 对应 | 判定 |
|---|---|---|
| `user_message` | `session.message`（用户那条） | 直接对应 |
| `assistant_message`（`streaming`） | `chat` `delta` / `final`，`agent` `assistant` | 要适配（C.le. 发增量，T3 发整段覆盖） |
| `reasoning` | `agent` `thinking` | 直接对应 |
| `command_execution`（`input`、`output`、`exitCode`、`monitor`、`completionWake`） | `agent` `tool`（exec）+ `command_output` + `item`（`kind: command`） | 要适配（后台命令做完叫醒 `completionWake` C.le. 缺） |
| `file_change`（`diffStr` / `oldStr` / `newStr`） | `agent` `patch`（只有增删改文件数）+ `tool` 结果 | 要适配（差异正文 C.le. 缺） |
| `file_search` / `web_search` / `dynamic_tool` | `agent` `tool`（通用工具调用） | 直接对应 |
| `approval_request` | `agent` `approval` + `exec.approval.requested` | 要适配（见 3.4） |
| `user_input_request` | `ask_user` 工具 | 要适配 |
| `proposed_plan` / `todo_list` | `plan_update` 工具 | 要适配 |
| `compaction`（前后令牌数） | `agent` `compaction` + `session.operation` | 要适配（C.le. 不带前后令牌数） |
| `error`（`failure` 分类 + `retry`） | `chat` `error`、`lifecycle error` | 要适配（C.le. 没有失败分类和重试信息） |
| `run_interrupt_request` / `run_interrupt_result`（含 `unresponsiveAt`） | `chat` `aborted`、`lifecycle end` 的 `aborted` | 要适配（「停不下来、要强停」C.le. 缺） |
| `checkpoint` | 无 | C.le. 缺 |
| `handoff` / `fork` / `thread_created` | 分叉：碧琪 `session-lineage.mjs` + `sessions.changed`；新会话：`sessions.create` | 要适配 |
| `subagent` | `sessions_spawn` 工具结果 | 要适配 |
| `notification` / `system_notice` | 无（碧琪 `laolao-run-notify.js` 自己从 `lifecycle` 拼） | C.le. 缺 |
| `secret_request` / `link_request` / `feedback_request` | 无 | 不要（K8-2 规定不经手登录信息） |

## 四、反过来：C.le. 有、T3 事件流里没有的

| C.le. 事件 | T3 那边 | 处理 |
|---|---|---|
| `chat.side_result`（旁问） | 无 | 碧琪保留 |
| `session.operation` | 并入 `compaction` 条目 / `context-transfer` | `thread-events` 里改成「记录更换」事件 |
| `terminal.data` / `terminal.exit` | T3 终端是单独的 RPC（`terminal.open / attach / observe …`、`subscribeTerminalMetadata`，`packages/contracts/src/rpc.ts`），不在领域事件流里 | 不进 `thread-events`，保留现状 |
| `plugin.pinkie.lsp.message` / `.ai.scan` / `.ext.progress` | 无 | 碧琪工作台专用，保留 |
| `connect.challenge`、`tick`、`presence`、`health` | Effect RPC 自带 `Ping` / `Pong` | 传输层，不对照 |

## 五、命令对照（写操作，供 K8-2 参考）

T3 的写操作都走 `orchestration.dispatchCommand`（oV2:3316 起）。碧琪 `engines-bridge.mjs:851-913` 已经在用其中一部分驱动 T3：

| T3 命令 | C.le. 方法 | 判定 |
|---|---|---|
| `message.dispatch`（`dispatchMode`: `start_immediately` / `queue_after_active` / `steer_active` / `restart_active` / `defer_start`） | `chat.send`、`sessions.send`、`sessions.steer` | 要适配（C.le. 没有「排在后面」和「重开这一轮」） |
| `run.interrupt` / `thread.stop` | `chat.abort`、`sessions.abort` | 直接对应 |
| `runtime-request.respond` | `exec.approval.resolve` / `plugin.approval.resolve`（界面在 `laolao-metre-perm.js` 调，见 S6 三节） | 要适配 |
| `thread.create` / `thread.delete` | `sessions.create` / `sessions.delete` | 直接对应 |
| `thread.fork` | `sessions.compaction.branch` + 碧琪分叉 | 要适配 |
| `thread.model-selection.set` | `sessions.patch` | 直接对应 |
| `thread.runtime-mode.set` | `exec.approvals.set`（按智能体） | 要适配 |
| `queued-run.start / reorder / cancel / edit`、`queued-message.promote-to-steer`、`queue.resume` | 无 | C.le. 缺 |
| `checkpoint.rollback` | 无 | C.le. 缺 |
| `subagent.stop` | 无（子会话各自 `sessions.abort`） | 要适配 |

## 六、给 K8-1 `thread-events` 的建议清单

按「先解决空白和不叫醒」的顺序，只列事件形状，不定实现：

1. **信封**：`{sequence, commandId?, event: {id, sessionKey, runId?, type, occurredAt, payload}}`；订阅带 `afterSequence`；先 `snapshot` 再 `synchronized` 再增量；不认识的 `type` 只推进序号。照 T3 oV2:2639-2643、4345-4481 写，不搬代码（许可证见 L106）。
2. **记录更换**（K8-1 第 2 条）：压缩、凌晨 4 点换记录、用户点新会话三种，合成一类事件，载荷写清旧记录、新记录、原因。现在分散在 `compaction` 流、`session.operation`、`sessions.changed`。
3. **后台命令**（K8-1 第 2 条）：对齐 T3 `command_execution` 的 `monitor` / `completionWake` 和 `run.background-work-cancelled`；现在只有 `command_output` 和 `lifecycle end`。
4. **运行状态**：`run.updated` 带完整状态（至少补 `queued`、`waiting`、`interrupted`）和用量。
5. **待办请求**：审批、提问合成一类，有 `pending` / `resolved` / `expired` / `cancelled`，靠补发就能拿到打开前的待办。
6. 其余（检查点、尝试、节点树、上下文交接）等 K8-2 / K8-3 需要时再加；第三节标「不要」的不加。

## 七、本篇没做到的

- C.le. 的 `sessions.changed`、`session.message`、`session.tool`、`exec.approval.*`、`plugin.approval.*` 发送处都不在裁剪 dist 里，载荷形状取自界面监听代码和 `scripts/chat-ui-harness/fake-gateway.js`；完整字段要在 `Cle0726/cle-core` 源码里再核一遍。
- 没跑 T3（那是 L108）。上面全是读契约文件得到的，没有真事件流样本。
- T3 服务端怎么把外部智能体的原始事件翻成这些领域事件（`apps/server`、`packages/provider-*`），属于 L105 的模块地图，本篇没展开；`packages/contracts/src/providerRuntime.ts` 只是那一层的公共类型（`RuntimeItemStatus` 等）。
