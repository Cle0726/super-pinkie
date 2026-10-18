# OpenClaw 2026.10.4 补丁试跑报告

- 目标版本：`openclaw@2026.10.4`（`~/release-superpinkie/sandbox/openclaw-pristine`，只读）
- 试跑方式：每个补丁单个跑，且每次都从 pristine 用 `rsync -a --delete` 复制到全新 `sandbox/try/` 再跑
  `OPENCLAW_ROOT=~/release-superpinkie/sandbox/try node patch/apply-xxx.mjs`
- 脚本：`patch/trial-all.mjs`（配套 `patch/trial-run.mjs`），逐补丁记录退出码、stdout/stderr、前后文件 sha256 差异（`node_modules` 不计入）
- 「改文件」列：是否真的写入了不同内容（sha256 变化 / 新增文件）
- 状态说明：
  - **已生效**：跑通且确实改了文件
  - **未匹配**：定位到了目标文件，但锚点/结构对不上，文件未改
  - **报错**：因为文件定位规则本身失效（找不到目标模块）而直接抛错，没走到锚点
  - **无效**：跑通但什么都没改（且原因不是「已打过」）
- 第一步（本报告首次提交）时 16 个补丁 **0 个已生效**：新版把所有 `dist/*.js` 改名成 `*.mjs`、Control UI 的 `chat-page-*.js` 被打包成 `control-ui-boot-chat-*.js`，几乎所有补丁的「找文件」规则都失效了。
- 第二步的移植进展见文末「最终结果」和各行的「移植后」列。

## 总表（第一步试跑原始结果）

| 补丁 | 作用一句话 | 退出码 | 改文件 | 结果 | 原因 / 锚点 |
| --- | --- | --- | --- | --- | --- |
| `apply-chat-linebreaks.mjs` | 让 Markdown 里的单个换行和中文加粗紧跟标点（`**某**，`）能正确渲染 | 0 | 无 | 未匹配 | 新版 Markdown 渲染器不再使用 `markdown-it`，`markdown-runtime-ORQpioyT.js` 只是 markdown-it 词法核心；`html_inline` 规则锚点（`\.renderer\.rules\.html_inline=(\w+),(\w+)=>`）在 `control-ui-boot-shared-xfDhIVun.js` 里已变成 `e.use(Ii,{isStructuralHtmlInline:e=>e.meta?.taskListPlugin===!0})` + `e.renderer.rules[Hi]=(e,t)=>{let n=e[t];return n?xC(n.content):``}`。旧脚本只 print `HTML renderer not found` 之外不输出任何东西（原补丁在非 changed 分支静默），已补上原因输出 |
| `apply-chat-math.mjs` | 让 Markdown 保留 TeX（`$…$`、`$$…$$`、`\(…\)`），交给 KaTeX 排版 | 0 | 无 | 未匹配 | 输出 `chat-math: nothing to patch`。锚点 `var X=new Y({html:!0,breaks:!0,linkify:!0}),…;`（markdown-it 实例创建）在新版已经不出现，渲染管线换成了自研/新库，需要人工确认后重写 |
| `apply-chat-timeline.mjs` | 把聊天页每个用户轮次渲染成有界、按时间顺序的时间线（含过程卡片、折叠等） | 0 | 无 | 报错 | 输出 `{"changed":false,"skipped":true,"reason":"expected one chat-page chunk, found 0"}`：`dist/control-ui/assets/chat-page-*.js` 不存在了，聊天页现在在 `control-ui-boot-chat-*.js`（`control-ui-boot-chat-XcDaYmck.js` 含 31 处 `chat-group`） |
| `apply-compaction-boundary-recovery.mjs` | 压缩保护在「准备阶段拿到空内容」时，把压缩边界回退到最近几轮用户消息，避免整段历史被保留 | 1 | 无 | 报错 | `OpenClaw 压缩保护模块无法唯一确认`：找的是 `dist/attempt.model-diagnostic-events-*.js` 且内容包含 `Compaction safeguard: using session branch messages after compaction preparation omitted real conversation content.`，新版该逻辑已搬到 `dist/builtin-openclaw-*.mjs`（扩展被打进内置插件包），且文案改成 `Compaction safeguard: summarizing the boundary-scoped preparation range after compaction preparation omitted real conversation content.` |
| `apply-composer-drafts.mjs` | 原生草稿存储改为立即保存、不按条数淘汰，并加上 `pagehide`/`visibilitychange` 兜底刷写 | 1 | 无 | 报错 | `原生草稿保存结构已变化，未覆盖`。模块能定位（`openclaw.control.chatComposer.v1:` 在 `control-ui-boot-shared-DJkUdZmL.js`），但旧锚点 `let X=Object.entries(Y.sessions).toSorted(…).slice(0,N);`（queue 淘汰）和 `persistChangedState(){…}`/`start(){…}`/`stop(){…}` 都不存在了；新版草稿走 `chat-outbox`（`Object.entries(e.sessions)` + `Object.keys(e.sessions).length<20` 的入队限制、`delete e.draft`） |
| `apply-computer-v2.mjs` | 首轮就把 Computer Use v2 的动作表（list_apps / list_windows / accessibility 等）暴露给模型；并把 macOS 驱动「已聚焦但结果标记未验证」的误报当作成功 | 1 | 无 | 报错 | `no computer-tool chunk found`：chunk 现在是 `dist/computer-tool-*.mjs`（`.mjs` 不是 `.js`）。锚点本身还在：`computer-tool-xn2S9vJM.mjs` 里 `const COMPUTER_TOOL_ACTIONS = COMPUTER_USE_V1_ACTION_NAMES;` |
| `apply-context-budget.mjs` | 用统一的预算函数（`services/context/budget.mjs`）接管压缩的 reserve / keepRecent / 触发阈值 / 会话窗口 | 1 | 无 | 报错 | `无法唯一确认压缩模块：agent-settings-`：三个目标都是 `.mjs` 后缀，`agent-settings-*.mjs` 里 `configuredReserveTokens` 已不存在（只剩 `targetReserveTokens`/`contextTokenBudget`）；preflight 在 `agent-runner-memory-*.mjs`（`resolveCompactionThreshold({…})` 仍在）；sessions 的 `"sessions.list": async` 名字也换了 |
| `apply-control-ui-file-delivery.mjs` | 本地绝对路径的 MEDIA 附件渲染成「成品卡片」（走桌面壳校验），远端媒体保持原样 | 1 | 无 | 报错 | `无法唯一确认聊天页模块：`（没找到 `chat-page-*.js`）；内部锚点 `function pS(e){`、`if(tS(n,r))continue;let e=nS(n,r)?…` 等压缩变量名也全部变化，需要重写 |
| `apply-control-ui-workspace-media.mjs` | 前端附件预检放宽到普通用户主目录文件（排除 `.ssh`/Keychains/`~/.openclaw` 非 workspace 目录） | 1 | 无 | 报错 | 同上，`无法唯一确认 Control UI chat-page 模块` 无候选；锚点 `function zS(e,t){if(FS(e))return!0;` 也随压缩变量名改变 |
| `apply-image-access.mjs` | 网关 `assertLocalMediaAllowed` 额外放行桌面/下载/文档/.workbuddy/WorkBuddy 和 `~/.openclaw/workspace*` | 1 | 无 | 报错 | `无法唯一确认 local-media-access 模块`：文件已改名 `local-media-access-DCO0_HKe.mjs`（`.mjs`）；另外 `assertLocalMediaAllowed` 现在只剩一行 `await resolveLocalMediaBoundary(...)`，放行逻辑搬进了 `resolveLocalMediaBoundary`（`const roots = localRoots ?? getDefaultMediaLocalRoots();`），锚点 `resolveInboundMediaReference … return;` / `const roots = localRoots ?? getDefaultLocalRootsCore();` 都已不在 |
| `apply-local-unrestricted-policy.mjs` | 桌面 App（回环网关、属于用户本人）不再因为「非 owner 发送者」把 gateway/node/cron 工具摘掉 | 1 | 无 | 报错 | `无法唯一确认 agent-tools 模块`：只有 `agent-tools-BaId9x8Y.mjs` 含 `ownerOnlyCoreToolDenylist`，但旧整行 `const ownerOnlyCoreToolDenylist = options?.senderIsOwner === false ? [...GATEWAY_OWNER_ONLY_CORE_TOOLS] : [];` 换成了 `input.senderIsOwner` + `.filter((name) => (name !== "portal" || !sessionPortalTarget) && …)` |
| `apply-loopback-model-reliability.mjs` | 回环中继模型不走 OpenAI SDK 的重复重试（避免一次恢复窗口被放大成几分钟） | 1 | 无 | 报错 | `无法唯一确认 OpenAI completions 传输模块：none`：`@openclaw/ai` 里 `openai-completions-*.mjs` 现在只是薄壳（真正实现在 `openai-completions-transport-QYABn8Uz.mjs`），旧锚点 `...options?.maxRetries !== void 0 ? { maxRetries: options.maxRetries } : {}` 没有任何文件包含 |
| `apply-material-preview-csp.mjs` | Control UI 的 CSP 允许 `clekk-material:` 这个壳内协议加载图片/PDF | 1 | 无 | 报错 | `无法唯一确认 control-ui 模块`：含 `buildControlUiCspHeader` 的 `control-ui-*.mjs` 因为 `.mjs` 后缀不匹配 `^control-ui-…\.js$`；新版 CSP 里 `img-src` 是 `"img-src 'self' data: blob: https:"`，`frame-src` 是 `"frame-src 'self' blob: http: https:"`，锚点文本也不同 |
| `apply-same-session-recovery.mjs` | 压缩失败时提示「当前会话已保留，稍后重试」，不要一上来就建议 `/new` | 1 | 无 | 报错 | `OpenClaw runner bundle cannot be uniquely identified`：找 `agent-runner.runtime-*.js`，现在是 `agent-runner.runtime-DAmI9Uuu.mjs`；而且旧文案 `Context is too large and auto-compaction could not recover this turn…` / `params.preserveSessionMapping ? …` 都已被上游改写为 `buildContextOverflowRecoveryText(params)` 等（`agent-runner.runtime-*.mjs`、`commentary-progress-owner-*.mjs`），需要按新文案重做 |
| `apply-work-thinking.mjs` | 空 `tool_calls` 数组是心跳元数据，不应被当作思考文本的分段边界 | 1 | 无 | 报错 | `无法唯一确认 OpenAI 思考解析模块`：`@openclaw/ai/dist/openai-completions-*.mjs` 仍是薄壳，锚点 `if (choiceDelta.tool_calls) {` 在新版全库都不出现（新解析器用 `if (delta.tool_calls && delta.tool_calls.length > 0)`） |
| `reapply-unrestricted-patch.mjs` | 在模型传输层注入「无限制模式」系统提示（仅在 session 带 `OPENCLAW_UR_INJECT`/`agent=unrestricted` 时） | 1 | 无 | 报错 | `dist transport chunk not found; cannot patch.`：`dist/openai-transport-stream-*.js` 现在是 `openai-transport-stream-DHZHLAv2.mjs`，而且已经退化成 449 字节的再导出壳；`createOpenAICompletionsClient` 这个锚点在 `dist` 里彻底没有了（实际入口变成 `node_modules/@openclaw/ai/dist/openai-completions-transport-QYABn8Uz.mjs` 里的 `streamOpenAICompletionsRequest`，而且旧锚点 `const nextParams = await options?.onPayload?.(params, model);\nif (nextParams !== void 0) params = nextParams;\nfirstEventAbort = …` 也已改写） |

## 新版共同变化（供后续移植参考）

1. `dist/` 下绝大多数打包文件从 `*.js` 变成 `*.mjs`；带 `*.runtime-<hash>.mjs` + 指针文件 `*.runtime.js` 的形式也存在。所有补丁的「按扩展名 / 前缀找文件」规则都要同时接受 `.mjs`。
2. Control UI 不再是 `chat-page-*.js`：聊天页 = `dist/control-ui/assets/control-ui-boot-chat-<hash>.js`（另有 `control-ui-boot-chat-*.css`、`control-ui-boot-shared-*.js`、`control-ui-boot-new-*.js`）。同一个逻辑可能分在 boot-chat / boot-new / boot-shared 三份里。
3. 压缩保护的扩展代码从 `attempt.model-diagnostic-events-*.js` 迁到 `dist/builtin-openclaw-*.mjs`，压缩边界相关逻辑大量重写（`collectPreparationRangeMessages`、`compactionSafeguardExtension`、`compactionResult()`）。
4. `@openclaw/ai` 的 `openai-completions-*.mjs` 变成薄壳，实现位于 `openai-completions-transport-*.mjs`；`maxRetries` 默认值在 `openai-responses-shared-*.mjs` 的 `buildOpenAISdkRequestOptions`。
5. `dist/control-ui/assets/*.js` 旁有预压缩的 `.js.br` / `.js.gz`，并且有 `dist/control-ui/asset-manifest.json` 记录每个资源（含 `.br`/`.gz`）的 sha256/size，网关启动时会按清单校验。改完 `.js` 必须重生成同目录 `.js.br`/`.js.gz` 并更新清单，否则网关可能继续发旧的压缩版。→ 已抽成公共函数 `patch/lib-precompressed.mjs`，供所有改 Control UI 资源的补丁调用。
6. 多个补丁的 doc-comment 消失了（构建器不再保留 `/** … */`，只剩 `//` 或 `//#region` 注释），凡是靠注释文本做锚点的都要换。

## 最终结果（第二步完成后更新）

见下表，逐补丁一行。

| 补丁 | 移植后 |
| --- | --- |
| （待更新） | （待更新） |
