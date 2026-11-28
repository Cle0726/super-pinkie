# T3-MAP · T3 Code 源码摸底（K8-0 / L105）

- 计划出处：`briefs/cle-core-1120/METRE-NEXT.md`（分支 `docs/metre-next-1122`，PR #462）第四节 K8-0；分工见 issue #96 win-coord 7231931033。
- 本文只回答三件事：服务端驱动外部智能体的模块、事件协议、网页端的会话/线程/子任务嵌套/差异审阅/审批/模型切换组件，各自入口文件和依赖；最后给结论：哪些搬、哪些照着写、哪些不要。
- 同批另有三份，互不重叠：许可证清单 `T3-LICENSES.md`（L106）、事件与 C.le. 网关逐个对照 `T3-EVENTS.md`（L107）、隔离环境实跑与事件流样本 `T3-RUN.md`（L108）。本文涉及许可和事件对照的地方只给首判，以那三份为准。
- 放在 `briefs/cle-core-1120/`：仓库里没有现成的 T3 文档目录，win-coord 指定 K8-0 各文档都放这里。

## 0. 选定版本与读法

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/pingdotgg/t3code` |
| 标签 | `v0.1.11`（和 `services/mode-architecture/engines.mjs` 固定的引擎版本一致） |
| 提交 | `59651c1761f6c63e9b6056839067066968e6a406` |
| 提交时间 | 2026-11-19T22:25:10-08:00 |
| 提交说明 | `fix(web): Retry on the Pull Requests list only refetches the environments that failed (#39536)` |
| 根许可 | `LICENSE`：MIT，`Copyright (c) 2026 T3 Tools Inc.` |

- 读法：`git clone --depth 1 --branch v0.1.11` 到 `mktemp -d` 的临时目录，只读源码。没有 install 依赖、没有运行其中任何脚本、没有启动服务，也没有放进任何仓库。
- 注意：该标签下 `apps/server/package.json` 与 `apps/web/package.json` 的 `version` 字段写的是 `0.1.10`，和标签名差一位。以提交号为准。
- 规模（`git ls-files` 计数）：共 32705 个文件；其中 `.repos/alchemy-effect` 21119、`.repos/effect` 3007（上游 vendored 的 Effect 源码，不是产品代码），`apps/web` 2140、`apps/mobile` 1889、`apps/server` 1733、`packages/client-runtime` 453、`apps/desktop` 328、`packages/shared` 271、`packages/contracts` 113。
- 下文行数都是该提交下文件的总行数（含注释和空行），用来判断「能不能整文件搬」。

## 1. 总体架构（T3 自己的说法）

出自 `docs/internals/overview.md`、`docs/internals/providers.md`、`docs/internals/adding-a-provider.md`：

1. **执行都在服务端。** 智能体进程、终端、Git、项目文件归服务端；网页、桌面、手机只通过鉴权的 RPC 控制。共享的连接和领域状态在 `packages/client-runtime`，各客户端只出界面。
2. **状态是事件决定的。** v2 编排器 `apps/server/src/orchestration-v2/Orchestrator.ts` 串行处理命令、产生事件，自己不做智能体或文件 I/O。`EventSink.ts` 在**一个数据库事务**里提交事件、投影、命令回执和待办副作用（outbox）；订阅者在提交之后才收到事件。命令的确认只代表「意图已记录」，不代表智能体做完。
3. **副作用后做。** `EffectWorker.ts` 在意图记录之后执行副作用，再把结果作为命令喂回编排器。
4. **事件日志只保留约一天**（`ProjectionMaintenance.ts` 删旧事件），投影才是真相；客户端游标落在已删范围以下就改发快照。
5. **智能体差异只在适配器里。** 编排层只认归一化的命令和事件，加新智能体不该在编排和客户端里加分支；客户端读能力标志（capabilities），不读驱动种类。
6. **一个驱动种类可以有多个实例**（不同账号），会话、模型目录、凭据都按实例隔离。

这几条正好对着 METRE-NEXT 第二节查到的根子 1、3、4（记录换了界面不知道、模式即智能体、注入脚本各读各的）。

## 2. 服务端：驱动外部智能体的模块

### 2.1 适配器契约（最该看懂的一层）

| 文件 | 行数 | 作用 |
|---|---|---|
| `packages/provider-core/src/server/ProviderAdapter.ts` | 836 | `ProviderAdapterV2` 服务定义；`ProviderAdapterV2Event` 联合类型（适配器 → 编排的全部事件，见 3.1）；`ProviderAdapterV2SessionRuntime` 方法表；各类错误 |
| `packages/provider-core/src/server/driver.ts` | 133 | `ProviderDriver`：一种智能体的注册入口 |
| `packages/provider-core/src/server/adapterDriver.ts` | 37 | 驱动挂适配器 |
| `packages/provider-core/src/server/ProviderHost.ts` | 65 | 适配器访问服务端的唯一入口（路径、设置、后台需求、版本策略、附件、存储的凭据） |
| `packages/provider-core/src/server/ProviderContinuationRequests.ts` | 58 | 智能体自己起的后台工作完成后叫醒父线程 |
| `packages/provider-core/src/server/subagentProjection.ts` | 578 | 子智能体投影 |

`ProviderAdapterV2SessionRuntime` 必须实现：`ensureThread`、`resumeThread`、`startTurn`、`steerTurn`、`interruptTurn`、`respondToRuntimeRequest`、`readThreadSnapshot`、`rollbackThread`、`forkThread`、`events`（事件流）。可选：`subscribeEvents`、`hasPendingBackgroundWork(ForThread)`、`injectHistory`、`resumeTurn`、`compactThread`、`applyModelSelection`、`applyThreadTitle`、`stopTask`、`awaitBackgroundTasks`、`stopSubagent`、`unloadThread`、`uploadFeedback`、`mcpApps`、`getModelContextWindow` 等。

`ProviderAdapterV2RuntimePolicy`：`runtimeMode`、`interactionMode`、`cwd`、`approvalPolicy`、`sandboxPolicy`、`maxRuntimeMode`（管理员上限）。

### 2.2 三家的适配器与驱动（N1 要的 Claude Code / Codex / Antigravity）

| 智能体 | 适配器 | 行数 | 驱动 / 状态探测 | 怎么连 |
|---|---|---|---|---|
| Claude Code | `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` | 14913 | `apps/server/src/provider/Drivers/ClaudeDriver.ts`、`ClaudeExecutable.ts`、`ClaudeHome.ts`、`ClaudeSkills.ts`；`apps/server/src/provider/ClaudeProvider.ts` | npm 包 `@anthropic-ai/claude-agent-sdk`（`^0.3.321`）；进程由 `spawnClaudeProcessGroup`（`ClaudeAdapterV2.ts:428`）经 `/bin/sh -c` 看门脚本起成独立进程组，服务端崩了也能回收 |
| Codex | `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` | 9111 | `Drivers/CodexDriver.ts`、`CodexHomeLayout.ts`、`CodexManagedProvider.ts`；`provider/CodexProvider.ts` | 起 `codex app-server` 子进程，走 `packages/effect-codex-app-server`（JSON-RPC 客户端） |
| Antigravity | `apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.ts` | 329 | `Drivers/AntigravityDriver.ts`；`provider/AntigravityProvider.ts`；`provider/acp/Antigravity*.ts`（8 个） | ACP 协议，薄薄一层叠在共享 ACP 适配器 `packages/provider-acp/src/server/adapter.ts`（10611 行）上，协议库 `packages/effect-acp` |

其余驱动（本轮不要，见第 6 节）：Cursor（`@cursor/sdk`）、OpenCode、Pi、Grok、Kiro、Muse（`@muse-code/sdk`）、Fx、ACP Registry，各在 `packages/provider-*`。

注册与公共部分：

- `apps/server/src/provider/builtInDrivers.ts`：内置驱动注册表。
- `apps/server/src/provider/providerStatusCache.ts`：状态顺序与缓存；`model-manifest.json`：各驱动兼容版本策略（`broken` 区间拒新会话）。
- `apps/server/src/provider/providerMaintenanceRunner.ts`：只在能证明「谁装的」时才代为更新。
- `apps/server/src/provider/ProviderInstanceRegistry*.ts`：实例注册与热更新。
- 登录相关（第 6 节判为不要）：`AntigravityAuth.ts`、`antigravityAuthSupport.ts`、`CodexChatGptAuth.ts`、`CodexChatGptHandoff.ts`、`CodexManagedTokenBroker.ts`、`ProviderCredentialStore.ts`、`ProviderAuthService.ts`。

### 2.3 协议库

| 包 | 主要文件（行数） | 内容 |
|---|---|---|
| `packages/effect-acp` | `client.ts` 1435、`protocol.ts` 1141、`agent.ts` 568、`compat.ts` 461、`errors.ts` 454、`rpc.ts` 415 | ACP（Agent Client Protocol）JSON-RPC 客户端与 schema |
| `packages/effect-codex-app-server` | `client.ts` 321、`protocol.ts` 586、`replay.ts` 578、`errors.ts` 380 | Codex app-server 协议客户端，含回放 |

两个包都基于 `effect`，都没有自己的 `license` 字段（仓库里只有 `apps/server/package.json` 写了 `"license": "MIT"`），按根 `LICENSE` 理解为 MIT，L106 核定。

### 2.4 编排核心（事件从哪来、到哪去）

| 文件 | 行数 | 作用 |
|---|---|---|
| `orchestration-v2/Orchestrator.ts` | 17032 | 命令 → 事件的决策，串行 |
| `orchestration-v2/EventSink.ts` | 1338 | 事件 + 投影 + 回执 + outbox 同一事务提交 |
| `orchestration-v2/EventStore.ts` | 156 | 事件存取 |
| `orchestration-v2/EffectWorker.ts` | 1126 | 记录后执行副作用 |
| `orchestration-v2/ProjectionStore.ts` | 9806 | 投影表（SQL；迁移在 `persistence/Migrations`，114 个文件） |
| `orchestration-v2/ProjectionMaintenance.ts` | — | 删旧事件，保留各流最新一条等 |
| `orchestration-v2/ProviderSessionManager.ts` | 3495 | 智能体会话生命周期 |
| `orchestration-v2/ProviderEventIngestor.ts` | 892 | 适配器事件 → 编排命令 |
| `orchestration-v2/RunExecutionService.ts` | 2381 | 一次运行的执行 |
| `orchestration-v2/ThreadLaunchService.ts` | 1617 | 建线程 / 起运行 |
| `orchestration-v2/ProviderContinuationService.ts` | 350 | 后台工作完成后续跑 |
| `orchestration-v2/RuntimeRequestService.ts` | 142 | 审批 / 提问的应答 |
| `orchestration-v2/ProviderSwitchService.ts` | 196 | 线程内换智能体（靠上下文交接摘要） |
| `orchestration-v2/modelSwitch.ts` | 55 | 线程内换模型 |
| `orchestration-v2/ThreadForkService.ts` | 178 | 分叉线程 |
| `orchestration-v2/NativeChildWorkQuery.ts` | 127 | 智能体原生子任务查询 |
| `orchestration-v2/DelegatedTaskQuestionReactor.ts` | 280 | 子任务提问上浮到父线程 |
| `orchestration-v2/CheckpointService.ts` | 625 | 检查点（隐藏 Git ref，不往用户分支加提交） |
| `orchestration-v2/ThreadStream.ts` | 118 | 订阅时「补发还是发快照」的判定，见 3.4 |
| `orchestration-v2/WireProjection.ts` | 428 | 投影瘦身后上线 |
| `orchestration-v2/ThreadLiveEventCoalescer.ts` | 259 | 合并实时事件 |

### 2.5 传输

- `apps/server/src/ws.ts`：WebSocket 上的 Effect RPC（`RpcServer.makeProtocolWithHttpEffectWebsocket`，第 3662 行；序列化 `RpcSerialization.layerJson`，第 3697 行）。
- `subscribeOrchestrationV2Thread`：第 909–1140 行，线程订阅的全部逻辑（见 3.4）。
- `layerWsRpc`：第 1433 行起；`dispatchCommand` 处理在第 1995 行，`subscribeThread` 在第 2324 行。

## 3. 事件协议

全部定义在 `packages/contracts/src/orchestrationV2.ts`（4690 行，Effect Schema）与 `packages/contracts/src/rpc.ts`（2493 行）。和 C.le. 网关事件的逐个对照由 L107 写进 `T3-EVENTS.md`。

### 3.1 适配器 → 编排（`ProviderAdapterV2Event`，`ProviderAdapter.ts:83–207`）

`app_thread.created`、`provider_session.updated`、`provider_thread.updated`（带 `pendingBackgroundWork`）、`provider_turn.updated`、`node.updated`、`subagent.updated`、`message.updated`、`turn_item.updated`、`steer.updated`（pending / completed / cancelled）、`background_work.updated`、`command_output.delta`（不落库，只给正在看那一行的客户端）、`prompt_suggestion.updated`（不落库）、`runtime_request.updated`、`plan.updated`、`turn.terminal`（两种：completed / interrupted / cancelled，或 failed 带 `failure`、`retry`；都带 `threadDisposition: reusable | broken`）。

### 3.2 RPC 方法

`ORCHESTRATION_V2_WS_METHODS`（`orchestrationV2.ts:3890–3914`，23 个）：

`orchestration.dispatchCommand`、`getTurnDiff`、`getFullThreadDiff`、`searchThreads`、`searchThread`、`searchThreadStream`、`getArchivedShellSnapshot`、`getThreadFamily`、`getThreadTitles`、`getThreadLinkMetadata`、`getWorktreeThreadIds`、`getOlderSettledThreads`、`getThreadProjection`、`getWorkflowScript`、`getNativeChildWork`、`stopWorkflow`、`forceStopThread`、`getTurnItem`、`launchThread`、`subscribeShell`（侧栏用的线程列表流）、`subscribeThread`（单线程流）、`subscribeCommandOutput`、`subscribePromptSuggestion`。

`WS_METHODS`（`rpc.ts:443–674`）里和本题相关的：`provider.auth.start / respond / complete / cancel / logout / subscribe / removeMethod`、`provider.install.start / cancel / subscribe / remove`、`review.getBranchCommits / getDiffPreview / getDiffFileContents`、`server.refreshProviders`、`server.updateProvider`、`server.getSettings / updateSettings`。其余（PR、issue、终端、预览、设备、云中继、定时任务等）和 Metre 无关。

### 3.3 命令（`OrchestrationV2Command`，`orchestrationV2.ts:3125` 起）

和本题相关的：`thread.create`、`thread.stop`、`message.dispatch`（带派发方式：`defer_start` / `steer_active` / `restart_active` / `queue_after_active` / `start_immediately`）、`run.interrupt`、`runtime-request.respond`、`thread.user-input.dismiss`、`thread.model-selection.set`、`thread.runtime-mode.set`、`thread.interaction-mode.set`、`provider.switch`、`provider-session.detach`、`subagent.stop`、`delegated_task.request`、`delegated_task.wake-policy`、`delegated_task.completion-delivery.acknowledge / dispose`、`thread.fork`、`thread.merge_back`、`checkpoint.rollback`、`queued-run.start / reorder / cancel / edit`、`queued-message.promote-to-steer`。内部命令（`orchestrationV2.ts:3742` 起）还有 `delegated_task.remote.*`、`thread.background-work.settle`、`thread.interrupt.unresponsive` 等。

### 3.4 线程订阅流（N2 的核心）

入参 `OrchestrationV2SubscribeThreadInput`（`orchestrationV2.ts:4125`）：`threadId`、`afterSequence`（可选，断线续传游标）、`requestCompletionMarker`、以及几个「客户端能接受压缩格式」的开关（`acceptBoundedSnapshot`、`acceptDeferredWork`、`acceptCompactTurnItems`、`acceptDedupedBodies`、`acceptCompactIds`）。

出参 `OrchestrationV2ThreadStreamItem`（`orchestrationV2.ts:4238–4261`），四种：

| kind | 含义 |
|---|---|
| `snapshot` | 整份投影 + `snapshotSequence`；可带 `historyCursor` / `hasMoreHistory` 表示只是一个窗口，旧的按页拉 |
| `synchronized` | 「补发到此为止，后面是实时」的标记 |
| `event` | `sequence` + 一条领域事件 |
| `unknown-event` | 客户端解不出的新事件类型：跳过但推进游标（向前兼容） |

服务端判定（`ws.ts:1036–1138`、`ThreadStream.ts`）：

- 先订阅再读存量，两段重叠由客户端按 `sequence` 去重。
- 没给 `afterSequence` → 快照 + 实时。
- 给了：游标大于最新序号，或小于已删除到的序号 → 快照；待补事件超过 128 条（`THREAD_RESUME_MAX_REPLAY_EVENTS`）或超过 1 MiB → 快照；否则补发区间事件，接 `synchronized`，再接实时。
- 读补发期间如果清理任务删了旧事件，读完再查一次，被删就改发快照。

### 3.5 领域事件与投影

领域事件类型（`orchestrationV2.ts:2028–2172`；`2975–3119` 还有一组同名定义，本轮没细读两者差别，L107 核）：

`thread.created`、`thread.pull-request-link-updated`、`thread.visit-recorded`、`run.created`、`run.updated`、`run.background-work-cancelled`、`run-attempt.created`、`run-attempt.updated`、`node.updated`、`subagent.updated`、`provider-session.detached`、`provider-thread.updated`、`provider-turn.updated`、`runtime-request.updated`、`message.updated`、`turn-item.updated`、`plan.updated`、`checkpoint-scope.created`、`checkpoint.captured`、`checkpoint.rollback-requested`、`context-handoff.updated`、`context-transfer.created`、`context-transfer.updated`。

时间线条目 `turn item` 类型（`orchestrationV2.ts:1753–1971`）：`notification`、`user_message`、`assistant_message`、`reasoning`、`proposed_plan`、`todo_list`、`user_input_request`、`file_change`、`command_execution`、`file_search`、`web_search`、`approval_request`、`checkpoint`、`run_interrupt_request`、`run_interrupt_result`、`system_notice`、`error`、`compaction`、`handoff`、`fork`、`thread_created`、`subagent`、`dynamic_tool`。

线程投影 `OrchestrationV2ThreadProjection`（`orchestrationV2.ts:2178–2203`）：`thread`、`runs`、`attempts`、`nodes`、`subagents`、`providerSessions`、`providerThreads`、`providerTurns`、`runtimeRequests`、`messages`、`plans`、`turnItems`、`checkpointScopes`、`checkpoints`、`contextHandoffs`、`contextTransfers`、`visibleTurnItems`、`updatedAt`。

和 Metre 痛点直接相关的几个结构：

- **子任务就是线程里的一个节点**：`OrchestrationV2ExecutionNode`（第 837 行）有 `parentNodeId` / `rootNodeId`，`kind` 含 `subagent`；`OrchestrationV2Subagent`（第 963 行）有 `parentNodeId`、`origin: provider_native | app_owned`、`childThreadId`、`providerInstanceId`、`modelSelection`、`completionWake: always | settled_only`、`status`。不用「切模式」就能挂在父线程下（对应根子 3）。
- **一个应用线程可以换过多个智能体线程**：`OrchestrationV2AppThread`（第 472 行）有 `activeProviderThreadId`、`lineage`、`forkedFrom`、`delegatedFrom`；`OrchestrationV2ProviderThread`（第 1172 行）有 `handoffIds`、`forkedFrom`、`pendingBackgroundTasks`、`contextUsage`。名字（应用线程）和记录（智能体线程）是两层，换记录有 `context-handoff.*` / `compaction` 事件可见（对应根子 1）。
- **审批 / 提问**：`OrchestrationV2RuntimeRequest`（第 1322 行）有 `status: pending | resolved | expired | cancelled` 和 `responseCapability: live | message | not_resumable`。Codex 的异步提问是 `message` 型：用一条新用户消息回答，跨回合、跨重启都保留（`providers.md` 「Protocol traps」）。

## 4. 网页端组件

技术栈（`apps/web/package.json`）：React + `@tanstack/react-router`、状态用 `@effect/atom-react` 与 `zustand`、Tailwind、控件基于 `@base-ui/react`、图标 `lucide-react`、国际化 `gt-react`、编辑器 `@tiptap/*`、长列表 `@legendapp/list`、拖拽 `@dnd-kit/*`、差异 `@pierre/diffs` / `@pierre/trees`。`apps/web/src` 下每个文件必须能被 React Compiler 编译，lint 禁止 `useMemo` / `useCallback`（`docs/internals/web-ui.md`）。

数据层在 `packages/client-runtime`（网页和手机共用）：`state/orchestrationV2Projection.ts`（468，事件应用到投影）、`state/threadDetail.ts`（649）、`state/threadHistoryMerge.ts`（230，分页历史合并）、`state/threadState.ts`（43）、`state/threadSubagents.ts`（126）、`state/threadRelationships.ts`、`state/threadFamilies.ts`、`state/threadRequests.ts`（416，待审批 / 待回答）、`state/checkpointDiff.ts`（25）、`connection/supervisor.ts`（1458，断线重连）、`rpc/session.ts`（491）。

| 功能 | 入口文件（行数） | 相关文件 | 依赖 / 调的接口 |
|---|---|---|---|
| 会话（线程）列表 / 侧栏 | `apps/web/src/components/Sidebar.tsx`（3728） | `sidebar/SidebarThreadRow.tsx`（1981）、`sidebar/SidebarThreadHeader.tsx`、`Sidebar.logic.ts`、`Sidebar.motion.ts`、`Sidebar.drag.ts`、`AppSidebarLayout.tsx` | `@dnd-kit/*`、`@tanstack/react-router`；`orchestration.subscribeShell`；client-runtime `state/thread-sort`、`thread-search`、`thread-inbox` |
| 线程主视图 / 时间线 | `ThreadRouteView.tsx`（238）→ `ChatView.tsx`（4157） | `chat/MessagesTimeline.tsx`（1930）、`chat/ThreadTimeline.tsx`（60）、`chat/TimelineWorkGroupRows.tsx`（741）、`chat/TimelineV2EventRow.tsx`、`chat/V2LifecycleRow.tsx`、`chat/BackgroundWorkDetails.tsx`、`chat/CommandOutputPanel.tsx`、`chat/ChatComposer.tsx`（3949） | `@legendapp/list`、`@tiptap/*`；`orchestration.subscribeThread`、`subscribeCommandOutput`、`dispatchCommand`（`message.dispatch`） |
| 子任务嵌套 | `chat/ThreadRelationshipsControl.tsx`（1126） | `chat/ProviderSubagentBar.tsx`（87）、`chat/SubagentTooltipContent.tsx`（218）、`chat/NativeChildWorkDialog.tsx`（146）、`chat/SideChatPane.tsx`（166）、`chat/ChatRightPanel.tsx`（51）、`chat/ThreadLineageWorkflowRow.tsx`、`chat/WorkflowOpeningBlock.tsx` | client-runtime `state/threadSubagents.ts`、`thread-execution`、`subagent-display`；`getThreadFamily`、`getNativeChildWork`、`subagent.stop` |
| 差异审阅 | `DiffPanel.tsx`（1608）、`DiffPanelShell.tsx` | `diffs/StyledDiffCodeView.tsx`（269）、`diffs/DiffFileTree.tsx`（260）、`diffs/AnnotatableCodeView.tsx`、`diffs/DiffCommentAnnotation.tsx`、`chat/ChangedFilesTree.tsx`（437）、`chat/DiffStatLabel.tsx`、`DiffWorkerPoolProvider.tsx` | `@pierre/diffs`、`@pierre/trees`；`getTurnDiff`、`getFullThreadDiff`、`review.getDiffPreview`、`review.getDiffFileContents`；`checkpoint.rollback` |
| 审批 / 提问 | `chat/ComposerPendingApprovalActions.tsx`（161） | `chat/TimelinePendingApprovalRow.tsx`（132）、`chat/ChildThreadApprovals.tsx`（104，子线程的审批上浮到父线程）、`chat/ComposerPendingUserInputPanel.tsx`（370）、`chat/ProposedPlanCard.tsx`、`chat/runtimeModeConfig.ts` | client-runtime `state/threadRequests.ts`；`runtime-request.respond`、`thread.user-input.dismiss`、`thread.runtime-mode.set` |
| 模型 / 智能体切换 | `chat/ProviderModelPicker.tsx`（505） | `chat/ModelPickerContent.tsx`（1241）、`chat/ModelPickerSidebar.tsx`、`chat/ModelListRow.tsx`、`chat/ComposerModelEffort.tsx`（726）、`chat/TraitsPicker.tsx`、`chat/useApplyThreadModelPick.ts`、`chat/ProviderInstanceIcon.tsx` | `@effect/atom-react`；`thread.model-selection.set`、`provider.switch` |

## 5. 依赖与许可首判（以 L106 `T3-LICENSES.md` 为准）

| 对象 | 本轮看到的 | 首判 |
|---|---|---|
| T3 Code 本体 | 根 `LICENSE` MIT（T3 Tools Inc.）；`apps/server/package.json` MIT；其余工作区包无 `license` 字段 | 可搬，保留版权声明，登记 `NOTICE` |
| `.repos/effect` | MIT（Effectful Technologies Inc） | 可用；它是整个服务端和客户端的地基 |
| `.repos/alchemy-effect` | Apache-2.0 | 可用，但是基础设施代码，Metre 用不上 |
| `native/libghostty-vt` | MIT（Mitchell Hashimoto, Ghostty contributors） | 终端，用不上 |
| `@pierre/diffs`、`@pierre/trees` | 本轮只在 `third-party-licenses.config.json` 看到 `@pierre/theming` 被覆写为 Apache-2.0；另两个包未装、未核 | 待 L106 |
| `@anthropic-ai/claude-agent-sdk`、`@cursor/sdk`、`@muse-code/sdk` | 依赖声明里有，未装，本轮没看到它们的许可文本 | 待 L106；在核清之前，依赖这些 SDK 的代码按「不能搬」处理 |
| 有没有 GPL / AGPL | 本轮只看了仓库自带的 4 个 LICENSE 文件和许可覆写配置，没有展开传递依赖 | 待 L106 |

T3 自己的许可流程（`docs/internals/open-source-licenses.md`）：构建时跟随生产依赖生成 `third-party-licenses.json`，缺许可就构建失败；人工例外写在根目录 `third-party-licenses.config.json`。L106 可以直接从这份配置入手。

## 6. 结论：哪些搬、哪些照着写、哪些不要

总前提：T3 服务端和客户端整个建在 `effect`（Effect-TS）上，Schema、RPC、流、依赖注入全是它。**「搬」的前提是 `cle-core` 接受 `effect` 作依赖**；不接受的话，下表「搬」一列全部降为「照着写」。这件事要在 K8-1 开工前定下来。

### 6.1 搬（固定在 `59651c17`，放 `vendor/t3code/`，保留 LICENSE，改动集中在适配层）

| 什么 | 为什么 |
|---|---|
| `packages/effect-acp` | ACP 客户端是协议实现，和 T3 业务无关；Antigravity 和以后任何 ACP 智能体都走它（K8-2） |
| `packages/effect-codex-app-server` | 同上，Codex app-server 协议；带回放，测试能用 |
| `packages/provider-core/src/server/ProviderAdapter.ts` 的契约部分（事件联合、`SessionRuntime` 方法表、错误类型、`RuntimePolicy`） | 这就是 METRE-NEXT 说的「驱动外部智能体那一层」的边界；照它定 `agents-bridge` 的接口，以后合上游修复最省事 |
| `packages/contracts/src/orchestrationV2.ts` 里线程流相关的 schema 子集：`ThreadStreamItem`、`SubscribeThreadInput`、turn item 各类型、`ExecutionNode`、`Subagent`、`RuntimeRequest` | `thread-events`（K8-1）的线格式直接用它，`unknown-event` 的向前兼容也一起带过来。整文件 4690 行超过 1500 行上限，只能按需拆出子集 |
| `apps/server/src/orchestration-v2/ThreadStream.ts`（118 行） | 补发 / 快照判定是纯函数，小，正好是 N2「断网重连逐条一致」要的东西 |
| client-runtime 的纯逻辑：`state/orchestrationV2Projection.ts`、`state/threadHistoryMerge.ts` | 「事件应用到投影」「分页历史合并」是前台只按事件画的关键，和界面无关 |

### 6.2 照着写（看做法，自己写；原文件太大、和 T3 内部耦合、或界面不能带 T3 的样子）

| 什么 | 照它的哪一点 |
|---|---|
| `Orchestrator.ts`（17032）、`EventSink.ts`、`EffectWorker.ts`、`ProjectionStore.ts`（9806，配 114 个 SQL 迁移） | 命令 → 事件 → 同一事务提交投影和 outbox → 提交后才广播 → 副作用后做再回喂。`cle-core` 的 `thread-events` 按这个顺序写，不搬实现 |
| `ws.ts` 的 `subscribeOrchestrationV2Thread`（909–1140） | 先订阅再读存量、按序号去重、128 条 / 1 MiB 上限、清理后改发快照、`synchronized` 标记 |
| `ClaudeAdapterV2.ts`（14913）、`CodexAdapterV2.ts`（9111） | 太大且直接读写编排内部结构；按 6.1 的契约重写三家适配器，`adding-a-provider.md`「Traps several providers hit」逐条当验收清单（停止在回合开始前、智能体自己起的后台工作要能叫醒父线程、子任务比父回合活得久、失败或停止后不留打开的审批、额度用完归为 `usage_limit` 等），正好对着 K8-2 第 5 条的「中途停止、重连、额度用完」 |
| `spawnClaudeProcessGroup` 的进程组 + 看门脚本 | 服务端崩了子进程也能回收；Windows 要另写 |
| `ProviderContinuationService.ts`、`ProviderContinuationRequests.ts` | 「后台命令跑完叫醒 Metre」的根治做法：适配器报 `hasPendingBackgroundWork`，会话不当成空闲释放 |
| `DelegatedTaskQuestionReactor.ts`、`ChildThreadApprovals.tsx` | 子会话的审批 / 提问上浮到父会话，接碧琪现有确认卡片（K8-2 第 4 条） |
| 网页端第 4 节全部组件 | N4 要求 Metre 自己的样子、不留 T3 的名字标志配色；组件又都是几千行、绑 `gt-react` 和 React Compiler 规则。`apps/metre-web`（K8-3）按它们的**按键清单和交互**重写：侧栏嵌套、右侧分栏打开子任务、审批卡、模型选择、差异文件树 + 代码视图。交界面活时附「T3 原版 / Metre 新版」对比图 |
| 差异审阅 | 若 L106 判 `@pierre/diffs` / `@pierre/trees` 许可可用，就直接当 npm 依赖用库，组件照着写；不行就换别的差异库 |

### 6.3 不要

| 什么 | 为什么 |
|---|---|
| 登录与凭据流程：`AntigravityAuth.ts`、`CodexChatGptAuth.ts`、`CodexChatGptHandoff.ts`、`CodexManagedTokenBroker.ts`、`ProviderCredentialStore.ts`、`provider.auth.*`、`provider.chatgpt.*` | 违反「不读、不存、不转发登录信息」「不代管用户在外部智能体上的登录」。只照着写「检测装没装、登没登」，没登录就告诉用户去哪里登录 |
| 安装与更新：`AntigravityInstallation.ts`、`providerMaintenanceRunner.ts`、`provider.install.*` | 碧琪不替用户装外部智能体；只检测 |
| 依赖 `@anthropic-ai/claude-agent-sdk`、`@cursor/sdk`、`@muse-code/sdk` 的代码 | 许可未核（见第 5 节）；核清前不搬 |
| Cursor、OpenCode、Pi、Grok、Kiro、Muse、Fx、ACP Registry 驱动 | 本计划只接三家；ACP 走 6.1 的 `effect-acp`，以后要加再说 |
| `apps/mobile`、`apps/desktop`、`apps/marketing`、`infra/*` | 和碧琪无关 |
| 云中继 / T3 Connect / 远程环境 / 访客分享 / 设备 / 预览 / 语音 / 终端（ghostty）/ 遥测 / Clerk 登录 | 和 Metre 无关 |
| PR、issue、各家代码托管（`source-control-*`、`pullRequest`、`issue-tracker-linear`）、定时任务、1Password 密钥 | 和 Metre 无关；体量大 |
| T3 的名字、标志、图标、配色、截图 | N4 与 METRE-NEXT「不做的事」明确不要 |
| 把 T3 网页嵌进现在的控制台 | METRE-NEXT「不做的事」第一条 |

## 7. 本文没做的

- 没装依赖、没跑起来、没录事件流样本（K8-0 第 4 步，归 L108；L108 待隔离环境）。
- 没展开传递依赖的许可（L106）。
- 没和 C.le. 网关的 `chat`、`agent`、`sessions.*`、`pinkie.*` 逐个对照（L107）。
- 第 3.5 节两组同名领域事件定义（`2028–2172` 与 `2975–3119`）的差别没细读。
- 文中行数和行号只对 `59651c17` 有效，换提交要重数。
