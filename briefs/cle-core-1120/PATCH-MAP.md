# K0 · OpenClaw 使用面与补丁对照

> 碧琪代码固定为 `2c1fa0bb28d6326d5459376748a8440f155d80ab`。本文件用于决定保留的源码，不改变产品、权限或运行方式。发布包与构建证据见 [K0 接力记录](progress/K0.md)。

## 使用面（K0-5）

| 上游能力 / 目录 | 碧琪的关系 | 可复核依据 |
|---|---|---|
| Gateway / CLI | **用到**：两个桌面壳启动包内 CLI，网关提供 RPC、扩展注册、事件。 | `app/windows_desktop.py:2741,3167`、`desktop/macos/pinkie/Sources/Launcher.swift:41,1081`；插件 RPC 示例 `services/mode-architecture/index.mjs:7271`。 |
| Control UI / 静态资源 | **用到**：不是独立重写的控制台；把上游页面、脚本与本项目注入文件一起打包。 | `build-win.ps1:189-200`、`desktop/macos/build.sh:295-296`、`tools/ui-parity/bundle.py:102-121,205-209`。 |
| 对话 runner、上下文、工具和插件 API | **用到**：产品扩展通过 SDK 注册工具、提示词注入与网关事件；重试、压缩和流式更新另有运行时补丁。 | `services/mode-architecture/index.mjs:7144-7167,7619`；`patch/apply-retry-user-preservation.mjs`、`patch/apply-context-budget.mjs`。已检入带 `openclaw.extensions` 声明的 5 个服务清单。 |
| 模型与传输 | **用到**：按现有模型/provider 配置调用上游传输，包含本地中继兼容和思考能力映射。 | `services/mode-architecture/index.mjs:7509-7523`、`services/mode-architecture/setup.py:420-433`；`patch/apply-loopback-model-reliability.mjs`、`patch/apply-thinking-capabilities.mjs`、`patch/reapply-unrestricted-patch.mjs`。 |
| MCP / 连接器 | **用到**：产品扩展改 `mcp.servers`，不自建完整 MCP 运行时。 | `services/mode-architecture/rich-runtime.mjs:403,461-481`。 |
| 技能加载与发现 | **用到**：App 打包自己的技能，OpenClaw 的解析、发现及插件技能入口都需保留。 | `desktop/macos/build.sh:236-238`、`build-win.ps1:95,248`、`patch/apply-pinkie-managed-skills.mjs:7-23`。 |
| 会话、状态、媒体 | **用到**：调用上游 `sessions.list/create`、`chat.history/send`；会话键、上下文预算、文件/图片处理都与上游并存。 | `ui/injections/laolao-native.js:129,144,224-228`、`services/mode-architecture/openclaw-paths.mjs:37`；`patch/apply-history-image-thumbnails.mjs`。 |
| Computer Use | **用到**：碧琪自己的 computer 桌面桥接与上游节点能力并存。基线发布包没带补丁寻找的上游 CUA 模块，不能把两者当成一套。 | `services/mode-architecture/index.mjs:6947,7144-7146`、`patch/apply-computer-v2.mjs:88`；后者查找 `extensions/cua-computer` 等编译件；基线缺件证据见其补丁行。 |
| 微信、飞书、QQ | **用到**：这三项是渠道例外，不能把「各种聊天渠道」全部当成未使用。 | `services/wechat-connect/gateway.mjs:8`、`services/wechat-connect/README.md:3`；`services/messaging-connect/gateway.mjs:26-29,60`、`services/messaging-connect/README.md:5`。渠道 SDK、绑定和扩展 ABI 需要保留。 |
| 其他上游渠道 | **未发现碧琪内建入口，不等于可删**：不据此推断用户原有配置没有某个渠道，不能提前裁剪共享 SDK 或加载器。 | `git grep -n -i -E 'discord|telegram|whatsapp|imessage' -- services/messaging-connect services/wechat-connect` 未命中；上行三种渠道有正证据。只检查本产品自带连接器，不读取正式配置。 |
| 上游 Android/iOS 和原生 macOS App | **未进入本项目的发行打包链路**：碧琪的壳是自有 Swift / Python，独立 App 与共享协议、网关接口须分开判断。 | `git grep -n -I -E 'apps/(android\|ios\|macos)\|\.apk\b\|\.ipa\b\|xcodebuild' -- build-win.ps1 desktop/macos/build.sh .github/workflows/release.yml installer` 无命中；两端实际 CLI 启动点见首行。 |
| 发布/测试通道 | **未找到正式更新器的独立测试 feed**：包内 `channel` 是构建/防护标识，不能当成发布测试通道。 | `tools/release/release_assets.py:54-83` 与 `.github/workflows/release.yml:217-255` 操作同一个签名 `latest.json`；`.github/workflows/release-candidate.yml:3-6` 明示候选包只供验证、不发布索引或镜像。实测 `v2.5.51/latest.json` 也无独立 `channel` 字段。 |

**留给 K1 的边界：** 先保留上游原样。若后续考虑移除独立 App 或未接入的渠道，须在第二次提交用三平台编译、构建入口和运行测试证明不缺依赖；不能从本表直接得出「删除即可」。

## 补丁对照（K0-4）

以 `git ls-files 'patch/apply-*.mjs' 'patch/reapply-*.mjs'` 为准：34 个 `apply`（含调度器 `apply-all.mjs`）和 1 个 `reapply`，共 35 个文件。其中 34 个是具体补丁入口；`apply-all.mjs` 是碧琪自己的调度/核查工具，没有单独的上游落点。聊天渠道适配器另在 `services/messaging-connect` / `services/wechat-connect`；本表的覆盖数不把它们混进 `patch/`。

源码定位来自 OpenClaw `v2026.7.1-2`（`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`）。行号相对此版本的**上游仓库根目录**；标「行为落点」的是从该版本的压缩产物追到未压缩组件/函数，不把 Pinkie 新增符号说成上游已有代码。**易**为单点规则；**中**为同一管线多个点；**难**为跨层、状态或权限边界，需要专项测试。此处未执行补丁、未改变权限。

| 碧琪补丁 | 改什么 | 上游源码落点 / 核对情况 | 难度 |
|---|---|---|---|
| `apply-all.mjs` | 测试时按安装顺序执行并检查补丁产物 | 碧琪自有调度器 `patch/apply-all.mjs`，来源 `installer/macos/apply-theme.sh`；没有内核改动。 | 不适用 |
| `apply-chat-linebreaks.mjs` | 单换行和中文标点旁的加粗呈现 | `ui/src/components/markdown.ts:938,1342` 的 `md`、`toSanitizedMarkdownHtml`；MarkdownIt 的 `breaks` 与渲染规则。 | 中 |
| `apply-chat-math.mjs` | 保留 TeX 给碧琪渲染层 | `ui/src/components/markdown.ts:938,1081,1342` 的 MarkdownIt 初始化、规则注册和渲染入口。移植报告的「需人工」针对 **2026.10**，不等同于这个基准的解析器。 | 中 |
| `apply-chat-timeline.mjs` | 把用户轮次、过程与工具结果组成有顺序的时间线 | 行为落点：`ui/src/pages/chat/chat-thread.ts:235,861`（`groupMessages` / `buildChatItems`）；`chat-gateway.ts:155` 流式事件；`chat-history.ts:777` 历史读取；`components/chat-message.ts:674` 渲染。 | 难 |
| `apply-compaction-boundary-recovery.mjs` | 压缩准备为空时保留合理的上下文边界 | `src/agents/agent-hooks/compaction-safeguard.ts:899-938` 的 `compactionSafeguardExtension` 和空准备分支；npm 产物的区域也指向该文件。 | 难 |
| `apply-composer-drafts.mjs` | 刷新/退出前保存草稿，不因草稿条数淘汰 | `ui/src/pages/chat/composer-persistence.ts:346,373,492,541`（`loadChatComposerSnapshot`、`persistChatComposerState`、`ChatComposerPersistenceController.persistNow`）。包里可见同一个键前缀。 | 中 |
| `apply-computer-v2.mjs` | 兼容某些内核的 Computer Use 动作与错误呈现 | **基准无该补丁的直接目标。** 两个发布包与 npm 文件列表均无 `dist/computer-tool-*` 和 `dist/extensions/cua-computer/`；固定 tag 无 `extensions/cua-computer`。实际使用面是碧琪 `createCuaComputerTool` 及上游 `src/agents/tools/nodes-tool.ts:131,202` 的 `createNodesTool`；这些不是旧补丁可直接搬入的代码。 | 难；直接落点不适用 |
| `apply-context-budget.mjs` | 统一压缩预算与会话列表的剩余上下文信息 | `src/agents/agent-settings.ts:47-95`（`applyAgentCompactionSettingsFromConfig`）、`src/auto-reply/reply/agent-runner-memory.ts:707,889`（`runPreflightCompactionIfNeeded`）、`src/gateway/server-methods/sessions.ts:770`（`sessions.list`）；预算模块是碧琪自己的。 | 难 |
| `apply-control-ui-cache.mjs` | 静态资源缓存和验证器 | `src/gateway/control-ui.ts:790` 的 `serveResolvedFile` 和同文件 `handleControlUiHttpRequest`；另需与资源清单/预压缩生命周期核对。 | 中 |
| `apply-control-ui-file-delivery.mjs` | 聊天窗口把本地成品显示为附件卡片 | 行为落点：`ui/src/pages/chat/components/chat-message.ts:531,674,1651`（`extractTranscriptAttachments`、`renderMessageGroup`、`renderAssistantAttachments`）。 | 中 |
| `apply-control-ui-workspace-media.mjs` | 前端本地附件预检与网关策略配合 | 行为落点：`ui/src/pages/chat/components/chat-message.ts:1316-1374`（`resolveHomeCandidatesFromRoots`、`isLocalAttachmentPreviewAllowed`、`buildAssistantAttachmentUrl`）；网关仍独立校验。 | 难 |
| `apply-fake-ip-benchmark-v6.mjs` | 保留已有配置约束的测试网络兼容 | `packages/net-policy/src/ip.ts:316`（`isBlockedSpecialUseIpv6Address`）和 `src/infra/net/ssrf.ts:264`（`resolveIpv6SpecialUseBlockOptions`）。是网络策略边界，迁移需负例审核。 | 难 |
| `apply-history-image-thumbnails.mjs` | 大图片历史保留文字以及合适缩图 | `src/gateway/session-utils.fs.ts:316,827`（转录大小及 `readSessionMessagesPageWithStatsAsync`），`src/gateway/server-methods/chat.ts:1637,3217`（`replaceOversizedChatHistoryMessages` 和历史组装）。 | 难 |
| `apply-image-access.mjs` | 产品允许的媒体根与上游签发/显示配合 | `src/media/local-media-access.ts:62`（`assertLocalMediaAllowed`）；网关调用见 `src/gateway/control-ui.ts`。不得在迁移时扩大权限边界。 | 难 |
| `apply-local-unrestricted-policy.mjs` | 本地受管运行时的工具策略兼容 | `src/agents/agent-tools.ts:385,886`（`createOpenClawCodingTools` 的 owner-only 策略分支）；需要保守核对授权边界。 | 难 |
| `apply-loopback-model-reliability.mjs` | 避免本地中继与 SDK 重复重试 | `packages/ai/src/providers/openai-completions.ts:141,174-182`（`streamOpenAICompletions` 和请求选项）。 | 易 |
| `apply-material-preview-csp.mjs` | 支持桌面壳中的本地讲义预览 | `src/gateway/control-ui-csp.ts:38`（`buildControlUiCspHeader`）；迁移要验证其他 CSP 策略不变。 | 中 |
| `apply-metre-lock.mjs` | Metre 的服务端锁定兜底 | `src/gateway/server-methods.ts:722`（`handleGatewayRequest` 授权边界）；锁的业务逻辑仍是碧琪自己的。 | 难 |
| `apply-optimistic-user-reconcile.mjs` | 按发送标识对账，避免乐观回显重复或吞字 | 行为落点：`ui/src/pages/chat/chat-history.ts:777`（`loadChatHistory`）、`chat-send.ts:339`（`appendUserChatMessage`）、`chat-thread.ts:861`（`buildChatItems`）。碧琪的实现依赖时间线补丁。 | 难 |
| `apply-overflow-compaction-events.mjs` | 回传运行中溢出压缩的开始/结果 | `src/agents/embedded-agent-runner/run.ts:624,2787`（`runEmbeddedAgent` 溢出重试分支）；事件发布由 `src/infra/agent-events.ts` 提供。 | 中 |
| `apply-pinkie-managed-skills.mjs` | App 的打包技能参与上游搜寻 | `src/skills/loading/workspace.ts:885,1170`（`loadSkillEntries` 合并附加目录）。 | 中 |
| `apply-preflight-compaction-events.mjs` | 发送前的压缩状态通知 | `src/auto-reply/reply/agent-runner-memory.ts:707,906`（`runPreflightCompactionIfNeeded` 的 `notifyCompaction`）。 | 中 |
| `apply-queue-unconfirmed.mjs` | 把尚未确认送达的队列项与失败、成功明确区分 | 行为落点：`ui/src/pages/chat/chat-queue.ts:110-128`（`updateQueuedMessageForSession` / `persistQueuedMessagesForSession`）、`chat-send.ts:556,1030`（`sendQueuedChatMessage` / `flushChatQueue`）、`composer-persistence.ts:441`（`persistStoredChatComposerQueue`）。 | 难 |
| `apply-retry-single-user.mjs` | 回复前失败重试时不重复写同一条真人输入 | `src/agents/embedded-agent-runner/run/attempt.ts:854,4273-4290`（`runEmbeddedAttempt`、会话叶和重试/合并处）。 | 难 |
| `apply-retry-user-preservation.mjs` | 重试时不丢首次真实用户记录 | `src/agents/embedded-agent-runner/run/attempt.ts:673,854,4273`（`flushSessionManagerFile` / `runEmbeddedAttempt`）和 `src/agents/embedded-agent-runner/session-manager-init.ts:102`（`prepareSessionManagerForRun`）。 | 难 |
| `apply-same-session-recovery.mjs` | 压缩故障继续用原会话时给出准确提示 | `src/auto-reply/reply/agent-runner-execution.ts:1463` 的 `buildContextOverflowRecoveryText`；`reply-delivery.ts` 是调用侧，不是定义。 | 易 |
| `apply-steer-fallback-wait.mjs` | 立即追加时等待同一会话中的确认，防止重复落盘 | `src/auto-reply/reply/agent-runner.ts:1130,1268-1282`（`runReplyAgent` 接管发送）和 `src/gateway/server-methods/chat.ts:4622`（`persistFallback` 调用）。 | 难 |
| `apply-steer-identity.mjs` | 追加和队列复用同一发送标识 | 行为落点：`ui/src/pages/chat/chat-send.ts:266-275,385,986`（发送参数、`sendSteerChatMessage`、`steerQueuedChatMessage`）。 | 中 |
| `apply-steer-images.mjs` | 追加时携带当前轮图片 | `src/auto-reply/reply/agent-runner.ts:1268`、`src/agents/embedded-agent-runner/runs.ts:408`（队列接口）、`src/agents/embedded-agent-runner/run/attempt.queue-message.ts:130,247`（`steerAndWaitForTranscriptCommit`）。 | 难 |
| `apply-stream-survive-steer.mjs` | 追加消息不清掉正在显示的回复 | 行为落点：`ui/src/pages/chat/chat-send.ts:556,704-706`（发送确认与 `chatRunId`），`chat-gateway.ts:155`（`handleChatEvent`）。 | 中 |
| `apply-thinking-capabilities.mjs` | 尊重显式配置的模型思考能力 | `src/auto-reply/thinking.ts:79,181`（`resolveThinkingPolicyContext` / `resolveThinkingProfile`）、`packages/ai/src/model-utils.ts:45,68`、`packages/ai/src/providers/openai-completions.ts:584,597`（`streamSimpleOpenAICompletions`）。 | 难 |
| `apply-work-first-chat.mjs` | 当前轮的成品镜像与原答复正确归并 | 行为落点：`ui/src/pages/chat/chat-thread.ts:508-556,861`（`isSameSourceRelayNativeDuplicate`、`collapseSequentialDuplicateMessages`、`buildChatItems`）。补丁使用的是碧琪时间线/乐观对账新增的符号。 | 难 |
| `apply-work-first-media-gate.mjs` | 写入 Webchat 媒体前复核交付状态 | `src/gateway/server-methods/chat.ts:4634,4729`（`appendWebchatAgentMediaTranscriptIfNeeded`、`deliver` 回调）；保护顺序需要回归。 | 难 |
| `apply-work-thinking.mjs` | 空工具数组不截断思考文本 | `packages/ai/src/providers/openai-completions.ts:141,478`（`streamOpenAICompletions` 的流增量分支）；同基准的原生传输 `src/agents/openai-transport-stream.ts:3196` 已有长度检查，不能混为同一处。 | 易 |
| `reapply-unrestricted-patch.mjs` | 碧琪模式提示在既有模型传输中兼容 | `src/agents/openai-transport-stream.ts:2008,2054,2748,2779`（原生 Responses / Completions 的 payload 钩子）及 `packages/ai/src/providers/openai-completions.ts:141,174`（workspace 的 AI 包）。 | 难 |

### 独立复核建议

- 在上游固定 tag 下，任选三处，例如 `git grep -n -F 'function serveResolvedFile' -- src/gateway/control-ui.ts`、`git grep -n -F 'const mergedExtraDirs' -- src/skills/loading/workspace.ts`、`git grep -n -F 'async function handleGatewayRequest' -- src/gateway/server-methods.ts`；对照对应补丁的匹配点。
- CUA 缺件用 `git ls-files '*cua-computer*' '*computer-tool*'` 和两个包的 dist 相对路径清单交叉查证。两端安装脚本确实列出这条兼容补丁（`installer/macos/apply-theme.sh:532`、`installer/windows/apply-theme.ps1:120`），不等于这个版本一定应用成功。不要在 K0 凭较新版报告添加不存在的模块。
- 表中的「行为落点」是迁移调查入口，不证明全部压缩锚点在发布包上命中。这是 K3 才要逐项证明的事。
