# OpenClaw 2026.10.4 补丁移植报告

- 目标版本：`openclaw@2026.10.4`（`~/release-superpinkie/sandbox/openclaw-pristine`，只读）
- 工作方式：每个补丁在干净副本上单独试跑；移植后同样在干净副本上重跑，并跑对应测试、`node --check` 被改文件。
  全部补丁最后用 `patch/apply-all.mjs`（顺序取自 `installer/macos/apply-theme.sh` + `install.sh`）在干净副本上按安装顺序串跑。
- 脚本：
  - `patch/trial-all.mjs` + `patch/trial-run.mjs`：逐补丁试跑、记录退出码/输出/sha256 差异
  - `patch/trial-one.mjs <补丁> [--keep]`：单个补丁在干净副本上重跑
  - `patch/apply-all.mjs [--keep]`：按安装顺序全量跑 + `node --check` + 校验 `.br/.gz` 与 `asset-manifest.json`
  - `patch/lib-precompressed.mjs`：改 Control UI 资源后重生成 `.br/.gz`、同步 `asset-manifest.json` 并推进 `index.html` 构建号
- 提交节奏：第一步试跑报告 1 次提交；第二步每个补丁 1 次提交（含 chat-linebreaks 时一并落地 `lib-precompressed.mjs`）。

## 最终结果

状态说明：**已移植** = 新版上确实改到文件并生效；**上游已解决** = 新版已自带该行为，补丁检测到后原样跳过并标注；**需人工** = 未把握，不做硬改。

| 补丁 | 作用一句话 | 最终状态 | 新版落点 / 说明 |
| --- | --- | --- | --- |
| `apply-chat-linebreaks.mjs` | 单个换行和中文加粗紧跟标点能正确渲染 | **已移植** | 渲染规则在 `control-ui-boot-shared-*.js`，新锚点 `e.renderer.rules[Hi]=(e,t)=>{let n=e[t];…}`；只在 `<br>` 单 token 时输出换行，markdown-it 实例位置改由 `let e=new Y({html:!0,breaks:!0,linkify:!0});` 定位。旧锚点保留 |
| `apply-chat-math.mjs` | Markdown 保留 TeX 交给 KaTeX | **需人工** | 新版不再用 markdown-it 预设创建实例（`new Fl({html:!0,…})` 已不在渲染管线里），TeX 保护需要按新的解析器重写规则；没有把握就没有硬改，补丁保持「不匹配即原样跳过」 |
| `apply-chat-timeline.mjs` | 聊天页每个用户轮次按时间顺序呈现步骤/工具卡片 | **部分移植（2026.10 走 DOM 投影）** | 新版聊天页在 `control-ui-boot-chat-*.js`，消息管线与 2026.7 完全不同（第三方白名单、内部消息过滤、事件处理都已重写）。2026.10 路径改为稳定标记投影：给消息组加 `data-timeline-group-id`，运行时把 `id="toolmsg:…"` 的工具卡折进所属消息下方的 `.chat-timeline-tool-row`，工具预览块标记 `chat-group--timeline-tools`，CSS 写入 `laolao-theme.css`；不逐一搬 2026.7 的 process-card/overflow 分支。旧版（v1–v16 升级链）逻辑原样保留 |
| `apply-compaction-boundary-recovery.mjs` | 压缩准备为空时把边界回退到最近轮次，避免整段历史被保留 | **已移植（v3）** | 保护逻辑移到 `dist/builtin-openclaw-*.mjs`：注入按「最近轮次 + 窗口一半」估算的边界解析器，替换空分支与 `compactionResult()` 的返回边界；旧锚点保留 |
| `apply-composer-drafts.mjs` | 草稿即时保存、不按条数淘汰、页面隐藏前刷写 | **已移植** | 草稿库重写为 `pending` 快照 + IndexedDB 镜像（`control-ui-boot-shared-*.js`）：`persistChangedState` 改为即时发布，`start/stop` 挂载/卸载 `visibilitychange` 兜底刷写，原生 pending/durable 校验不动；旧版锚点保留 |
| `apply-computer-v2.mjs` | 首轮暴露 Computer Use v2 动作；修正 macOS bring_to_front 误报 | **已移植** | `computer-tool-*.mjs`（并排除同前缀的 control/outcome/shared 模块）；`extensions/cua-computer/index.js` 锚点不变 |
| `apply-context-budget.mjs` | 统一压缩预算：reserve/keepRecent/触发阈值/会话窗口 | **已移植** | 目标是 `.mjs`：`agent-settings-*`、`agent-runner-memory-*` 锚点不变；`sessions.list` 改为在 `session-utils-list-*.mjs` 的 `listProjectedSessions` 里补 `contextTokens` 与 `pinkieCompactionBudget`（新 `sessions:v3` 标记） |
| `apply-control-ui-file-delivery.mjs` | 本地 MEDIA 渲染成成品卡片 | **已移植** | `control-ui-boot-chat-*.js`：本地成品从视频预览与附件条中剔除，成品卡片挂在消息插槽旁；新增测试 |
| `apply-control-ui-workspace-media.mjs` | 前端附件预检放宽到用户主目录 | **上游已解决** | 2026.10 预检改为 `&meta=1` / `&allow=1` 向网关要元数据与票据（`dist/control-ui/assets/control-ui-boot-shared-D3oo_6Fq.js`：`t?.available===!1` → `outside-allowed-folders`），浏览器端不再有白名单；补丁识别该结构后原样跳过（`upstream: true`，标记升级到 v3 防误报） |
| `apply-image-access.mjs` | 网关放行桌面/下载/文档/.workbuddy/workspace* | **已移植** | `local-media-access-*.mjs`（同名再导出壳不选）；放行逻辑收敛到 `resolveLocalMediaBoundary`：托管引用解析前放行额外根目录，并把额外根并入 `getDefaultMediaLocalRoots()` 列表 |
| `apply-local-unrestricted-policy.mjs` | 桌面回环网关不再因「非 owner」摘工具 | **已移植** | `agent-tools-*.mjs`：新版用 `input.senderIsOwner === false ? GATEWAY_OWNER_ONLY_CORE_TOOLS.filter(…)`，只把 owner-only 门改成受 `CLE_KK_LOCAL_UNRESTRICTED=1` 控制，portal/sessions/automations 例外原样保留 |
| `apply-loopback-model-reliability.mjs` | 回环中继不进 SDK 重复重试 | **已移植** | `@openclaw/ai/dist/openai-completions-transport-*.mjs`：SDK 请求选项改由 `buildOpenAISdkRequestOptions` 统一生成（无 maxRetries 字段），改为在 completions 的 `create(...)` 前对回环 `baseUrl` 置 `maxRetries=0`；显式 `options.maxRetries` 优先 |
| `apply-material-preview-csp.mjs` | CSP 允许壳内 `clekk-material:` 协议 | **已移植** | `control-ui-*.mjs`：新版 `img-src` 带 `https:`、`frame-src` 已有 `http:`/`https:`，改为在既有指令后追加 `clekk-material:`，不再重复声明 frame-src；v2 标记可原地升级 |
| `apply-same-session-recovery.mjs` | 压缩失败提示「当前会话已保留」而非先劝 `/new` | **已移植（v2）** | `agent-runner.runtime-*.mjs` 的 `buildContextOverflowRecoveryText` 单段字符串；保留心跳/换模型提示后缀；`apply` 只挑真正含该文案的 runtime 块 |
| `apply-work-thinking.mjs` | 空 `tool_calls` 不切断思考文本 | **上游已解决** | `@openclaw/ai/dist/openai-completions-transport-*.mjs` 已是 `if (delta.tool_calls && delta.tool_calls.length > 0) {`；补丁 `apply()` 识别后原样跳过（`upstream: true`），旧锚点仍可用 |
| `reapply-unrestricted-patch.mjs` | 传输层注入「无限制模式」系统提示 | **已移植** | `dist/openai-transport-stream-*.mjs` 只剩再导出壳；注入改到 `@openclaw/ai/dist/openai-completions-transport-*.mjs`（completions 与原生 responses 两个 payload 钩子），`--remove` 可完整还原 |

## 与任务书/旧假设的偏差（需要知道）

1. **`asset-manifest.json` 必须同步**：网关启动时按 `dist/control-ui/asset-manifest.json` 的 sha256/size 校验资源，并优先发 `.br`/`.gz`。只改 `.js` 不同步压缩件和清单，改动不会到达浏览器。因此 `lib-precompressed.mjs` 除了重写 `.br`/`.gz`，还重算受影响的清单条目、`generation`（按 path/size/sha256 排序求 sha256，与上游 builder 一致），并在 `index.html` 的 `data-openclaw-control-ui-build-id` 追加 generation 前缀，避免网关拿旧的预压缩副本。
2. **`apply-chat-timeline.mjs` 在 2026.10 不是 1:1 移植**：新版没有 `pinkieBuildTimeline` 可挂的渲染点，改为 DOM 投影（见上表）。它保住「每个轮次按时间顺序、工具卡跟随所属消息」的核心，但没有搬 process-card 折叠、80 行溢出等 2026.7 细节。若需要完整行为，需要单独按新渲染器重写。
3. **`apply-chat-math.mjs` 卡在解析器换代**：新版渲染管线不再暴露 markdown-it 实例创建点，`$…$` 保护需要新的解析器扩展点；没把握，标「需人工」。
4. **条件式安装脚本**：`install.sh` 里 `OPENCLAW_ROOT="${OPENCLAW_ROOT:-}" node …apply-same-session-recovery.mjs` 在未显式设置 `OPENCLAW_ROOT` 时会把空串当作根目录并报错；本次只在 `sandbox/try` 下试跑，未改 `installer/`/`install.sh`（任务书限定只改 `patch/*.mjs` 与 `tests/`）。

## 验收命令与结果

### 1. 按安装顺序全量跑（`node patch/apply-all.mjs`，输出原文）

```text
# apply order
ok   apply-chat-timeline.mjs  {"changed":true,"backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups","file":"control-ui-boot-chat-XcDaYmck.js","mode":"2026-dom"}
ok   apply-chat-math.mjs  chat-math: nothing to patch
ok   apply-chat-linebreaks.mjs  chat-linebreaks: patched control-ui-boot-shared-xfDhIVun.js
ok   apply-composer-drafts.mjs  {"changed":true,"files":["/Users/Admin/release-superpinkie/sandbox/try/dist/control-ui/assets/control-ui-boot-shared-D3oo_6Fq.js"],"backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups"}
ok   apply-context-budget.mjs  {"changed":true,"backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups","files":["agent-settings-Cfa6SYMN.mjs","agent-runner-memory-BQ2oNmBL.mjs","session-utils-list-BT-CGa6u.mjs"]}
ok   apply-compaction-boundary-recovery.mjs  {"changed":true,"file":"/Users/Admin/release-superpinkie/sandbox/try/dist/builtin-openclaw-qVsnLx0N.mjs","backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups"}
ok   apply-loopback-model-reliability.mjs  {"changed":true,"backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups","file":"openai-completions-transport-QYABn8Uz.mjs"}
ok   apply-work-thinking.mjs  {"file":"/Users/Admin/release-superpinkie/sandbox/try/node_modules/@openclaw/ai/dist/openai-completions-transport-QYABn8Uz.mjs","changed":false,"upstream":true}
ok   apply-image-access.mjs  {"changed":true,"backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups","file":"local-media-access-DCO0_HKe.mjs"}
ok   apply-control-ui-workspace-media.mjs  {"changed":false,"file":"control-ui-boot-shared-D3oo_6Fq.js","upstream":true}
ok   apply-control-ui-file-delivery.mjs  {"changed":true,"file":"control-ui-boot-chat-XcDaYmck.js","backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups"}
ok   apply-material-preview-csp.mjs  {"changed":true,"file":"control-ui-Cz76kKHy.mjs"}
ok   apply-local-unrestricted-policy.mjs  {"changed":true,"file":"/Users/Admin/release-superpinkie/sandbox/try/dist/agent-tools-BaId9x8Y.mjs","backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups"}
ok   apply-computer-v2.mjs  [computer-v2] computer-tool-xn2S9vJM.mjs: enabled | [computer-v2] cua-computer: focused bring_to_front fallback enabled
ok   reapply-unrestricted-patch.mjs  openclaw root: /Users/Admin/release-superpinkie/sandbox/try | [dist] openai-transport-stream-DHZHLAv2.mjs: re-export shim in this version; injection is applied on @openclaw/ai.
ok   apply-same-session-recovery.mjs  {"changed":true,"file":"/Users/Admin/release-superpinkie/sandbox/try/dist/agent-runner.runtime-DAmI9Uuu.mjs","backup":"/var/folders/rr/lgvmqlrn2w53qt3tz1rn_c5r0000gp/T/pinkie-apply-all-backups"}

# changed files
changed dist/agent-runner-memory-BQ2oNmBL.mjs
changed dist/agent-runner.runtime-DAmI9Uuu.mjs
changed dist/agent-settings-Cfa6SYMN.mjs
changed dist/agent-tools-BaId9x8Y.mjs
changed dist/builtin-openclaw-qVsnLx0N.mjs
changed dist/computer-tool-xn2S9vJM.mjs
changed dist/control-ui/assets/control-ui-boot-chat-XcDaYmck.js
changed dist/control-ui/assets/control-ui-boot-shared-D3oo_6Fq.js
changed dist/control-ui/assets/control-ui-boot-shared-xfDhIVun.js
changed dist/control-ui/index.html
changed dist/control-ui-Cz76kKHy.mjs
changed dist/extensions/cua-computer/index.js
changed dist/local-media-access-DCO0_HKe.mjs
changed dist/session-utils-list-BT-CGa6u.mjs
added   dist/pinkie-context-budget.mjs

# node --check
all changed .js/.mjs pass node --check

# precompressed twins
ok   dist/control-ui/assets/control-ui-boot-chat-XcDaYmck.js.br
ok   dist/control-ui/assets/control-ui-boot-chat-XcDaYmck.js.gz
ok   dist/control-ui/assets/control-ui-boot-shared-D3oo_6Fq.js.br
ok   dist/control-ui/assets/control-ui-boot-shared-D3oo_6Fq.js.gz
ok   dist/control-ui/assets/control-ui-boot-shared-xfDhIVun.js.br
ok   dist/control-ui/assets/control-ui-boot-shared-xfDhIVun.js.gz

patches failed: 0
```

### 2. 测试（`node --test` 补丁相关测试）

```text
ℹ tests 104
ℹ pass 86
ℹ fail 18
```

18 个失败全部来自 `tests/chat-tool-timeline.test.mjs`（该文件的 9 个 2026.7 渲染管线/升级链用例，以及 9 个时间线纯函数用例）。
已在**未改动的 HEAD 版本**上复跑同一测试文件，失败集合完全相同（6 通过 / 18 失败），属于既有状态，不是本次移植引入；
本次新增的 2026.10 投影用例 3 个全部通过。其余 15 个测试文件全部通过（86 通过）。

## 测试

| 测试 | 覆盖 |
| --- | --- |
| `tests/chat-linebreaks.test.mjs` | 两版渲染器锚点、`<br>` 单 token、压缩件/清单刷新 |
| `tests/composer-drafts.test.mjs` | 2026.7 旧结构与 2026.10 pending 快照/页面隐藏刷写（vm 跑真实压缩代码） |
| `tests/computer-v2.test.mjs` | `.js`/`.mjs` 两版、同前缀模块不被误改、拒绝半截补丁 |
| `tests/control-ui-file-delivery.test.mjs` | 成品卡片、路径白名单、选块与压缩件 |
| `tests/control-ui-workspace-media.test.mjs` | 旧预检补丁、v1→v3、2026.10 判定为上游已解决 |
| `tests/image-access.test.mjs` | 旧/新边界结构、再导出壳排除、v1/v2 升级 |
| `tests/local-unrestricted.test.mjs` | 两版 owner 门、`CLE_KK_LOCAL_UNRESTRICTED` 开关、例外保留 |
| `tests/loopback-model-reliability.test.mjs` | 旧 maxRetries 锚点、2026.10 create 前改写、显式值优先 |
| `tests/material-preview-csp.test.mjs` | 两版 CSP、frame-src 不重复、v2 升级 |
| `tests/work-thinking-parser.test.mjs` | 空数组/真实工具调用、上游已解决识别 |
| `tests/reapply-unrestricted.test.mjs` | 2026.10 两处注入、幂等、`--remove`、旧版 dist 路径 |
| `tests/context-budget.test.mjs` + `tests/context-budget-2026.test.mjs` | 预算函数、三处 `.mjs` 目标、原子写入 |
| `tests/compaction-boundary-recovery.test.mjs` | v1/v2 升级、2026.10 边界替换、同会话文案 |
| `tests/chat-tool-timeline.test.mjs` | 时间线纯函数、2026.10 DOM 投影 |
