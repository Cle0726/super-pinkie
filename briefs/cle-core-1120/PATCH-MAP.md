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
| Computer Use | **用到**：碧琪自己的桌面桥接与上游 computer 工具/节点能力并存，不是上游独立桌面 App。 | `services/mode-architecture/index.mjs:6947,7144-7146`、`patch/apply-computer-v2.mjs:88`；后者处理 `extensions/cua-computer` 编译件。 |
| 微信、飞书、QQ | **用到**：这三项是渠道例外，不能把「各种聊天渠道」全部当成未使用。 | `services/wechat-connect/gateway.mjs:8`、`services/wechat-connect/README.md:3`；`services/messaging-connect/gateway.mjs:26-29,60`、`services/messaging-connect/README.md:5`。渠道 SDK、绑定和扩展 ABI 需要保留。 |
| 其他上游渠道 | **未发现碧琪内建入口，不等于可删**：不据此推断用户原有配置没有某个渠道，不能提前裁剪共享 SDK 或加载器。 | `git grep -n -i -E 'discord|telegram|whatsapp|imessage' -- services/messaging-connect services/wechat-connect` 未命中；上行三种渠道有正证据。只检查本产品自带连接器，不读取正式配置。 |
| 上游 Android/iOS 和原生 macOS App | **未进入本项目的发行打包链路**：碧琪的壳是自有 Swift / Python，独立 App 与共享协议、网关接口须分开判断。 | `git grep -n -I -E 'apps/(android\|ios\|macos)\|\.apk\b\|\.ipa\b\|xcodebuild' -- build-win.ps1 desktop/macos/build.sh .github/workflows/release.yml installer` 无命中；两端实际 CLI 启动点见首行。 |
| 发布/测试通道 | **未找到正式更新器的独立测试 feed**：包内 `channel` 是构建/防护标识，不能当成发布测试通道。 | `tools/release/release_assets.py:54-83` 与 `.github/workflows/release.yml:217-255` 操作同一个签名 `latest.json`；`.github/workflows/release-candidate.yml:3-6` 明示候选包只供验证、不发布索引或镜像。实测 `v2.5.51/latest.json` 也无独立 `channel` 字段。 |

**留给 K1 的边界：** 先保留上游原样。若后续考虑移除独立 App 或未接入的渠道，须在第二次提交用三平台编译、构建入口和运行测试证明不缺依赖；不能从本表直接得出「删除即可」。

## 补丁对照（K0-4，待固定上游 tag 后补全）

以 `git ls-files 'patch/apply-*.mjs' 'patch/reapply-*.mjs'` 为准：34 个 `apply`（含调度器 `apply-all.mjs`）和 1 个 `reapply`，共 35 个文件。其中 34 个是具体补丁入口；`apply-all.mjs` 是碧琪自己的调度/核查工具，没有单独的上游落点。聊天渠道适配器另在 `services/messaging-connect` / `services/wechat-connect`；本表的覆盖数不把它们混进 `patch/`。
