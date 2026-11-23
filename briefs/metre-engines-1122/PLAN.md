# Metre 外部引擎：在现在的 OpenClaw 上接入 T3 Code 和 OpenMausBot

- 计划和执行：Claude（用户 11-22：「这个全部你来做」，不派 Gemini）。接力规矩见第七节。
- 分支：`feat/metre-engines`，从 `fix/metre-session-sync`（v2.5.54 + 11-22 三项修复）切出。main 现在不能发版（M4 阻塞），所以在发版线上做，做完再补回 main。
- 进度和交接：同目录 `PROGRESS.md`。动手前先读它。

---

## 一、用户要什么（原话，11-22）

- 「问题是现在就要先在 OpenClaw 落实 OpenMausBot 和 T3 code」
- 「不一定是使用 Metre 派发，而是像 T3 一样可以在 Metre 使用 Claude 或者 Antigravity 或者 Codex，你自己看看人家的功能融合」
- 「派活也做」
- 「我又想保留 Metre 一部分设计……别人项目的页面功能按键更加完善更加成熟，所以需要吸收回来换个 Metre 的 IP 就行」
- 「本机的 Codex 和 Claude 和 antig 可能都是旧版可以先更新」（已更新，见 PROGRESS）

要做到：

| 编号 | 要做到 | 怎么算做到 |
|---|---|---|
| G1 | 在 Metre 里直接选 Claude Code、Codex、Antigravity（和它们的模型）当这次对话的引擎来用 | Metre 输入框旁有「引擎」选择；选了外部引擎后，对话、流式输出、工具调用、审批、改动差异都在 Metre 里看得到、点得了 |
| G2 | Metre 能把活派给这三家 | Metre 在 Baton（派发）下用工具开外部引擎的子任务；子任务出现在侧栏父会话下面和总谱的声部里；做完自动回报并叫醒 Metre |
| G3 | 吸收 T3 Code 和 OpenMausBot 成熟的功能和按键 | 和原版逐项对照的清单（第四节）每项都有，或写明为什么不要 |
| G4 | 是 Metre 的样子 | 不出现 T3、OpenMausBot 的名字、标志和配色；用 Metre 已定的像素 M、月夜、黑猫、谱纸配色和音乐用词 |
| G5 | 不影响别的模式和现有用户 | 外部引擎默认关闭；不开就不下载、不启动任何东西；五个老模式零改动 |

**不做的事**：不转卖额度；不代用户登录、不读也不存外部账号的凭据（登录一律让用户自己在官方页面完成）；不复制 OpenMausBot 的 `enterprise/` 目录（非开源许可）；不用注入脚本去改 T3 自己的页面。

---

## 二、两个项目是什么（11-22 核对过源码和发布包）

| 项目 | 许可 | 是什么 | 拿什么 |
|---|---|---|---|
| T3 Code `pingdotgg/t3code` 0.1.11 | MIT | 编码智能体的统一控制台。一个本机服务驱动 Claude Code、Codex、Antigravity、OpenCode、Cursor 等；有网页界面、命令行（`t3 thread start/send/show --json`）、MCP 服务、`t3 auth` 签发令牌、`t3 theme set` 换主题 | **整个服务端原样用**（固定版本的官方发布包，校验 SHA-256），当成碧琪的「引擎服务」；网页界面先嵌进 Metre，后面换成自己的 |
| OpenMausBot `milind-soni/OpenMausBot` | Apache-2.0（`enterprise/` 除外） | 「聊天软件里的一队 AI 机器人」：每个机器人有自己的人设、模型、电脑、连接的应用；看它干活、按级别审批 | **借功能和交互**：机器人当联系人、审批分级、看它干活；代码只在需要时按 Apache-2.0 搬，并写进 NOTICE |

为什么不自己写驱动层：T3 的驱动层管着三家各自的登录隔离、版本检查、审批语义、断线续跑（`docs/internals/providers.md`），这正是我们反复出错的那类细节。

---

## 三、做法

### 3.1 引擎服务（碧琪管理的 T3 后台程序）

- 位置：碧琪状态目录下 `engines/t3/<版本>/t3.exe`，数据目录 `engines/t3-home`（`T3CODE_HOME`）。**路径必须是纯英文**：T3 自带的启动器用 Windows 的 `tar.exe` 解压，遇到中文路径直接失败（11-22 实测 `F:\碧琪实测` 失败）。所以下载、校验、解压由碧琪自己做（Node 的 zip 解压或 Python `zipfile`），用户名是中文时改放到纯英文的备用位置（`%LOCALAPPDATA%` 下的英文目录，再不行 `C:\ProgramData\SuperPinkie\engines`），并测这种情况。
- 下载：`https://github.com/pingdotgg/t3code/releases/download/v<版本>/t3-<版本>-<平台>.zip`（Mac 是 `.tar.gz`），对照同一发布的 `SHA256SUMS`。走碧琪已有的代理设置；失败给出明确提示，不留半截文件。
- 启动：`t3 serve --host 127.0.0.1 --port <空闲端口> --no-browser`，只监听本机。用户打开「外部引擎」开关才装、才启动；碧琪退出或开关关掉就停。崩溃自动重启（最多 3 次，之后提示）。
- 代码放 `services/mode-architecture/engines.mjs`（Windows 和 Mac 一份）。健康门禁不许大文件变长，新功能写新文件。

### 3.2 桥（网关方法，给界面和 Metre 用）

`pinkie.engines.status | enable | providers | open | threads`，以及给 Metre 工具用的 start / send / show。实现一律调 T3 命令行的 `--json` 输出，不碰它的数据库。

- `providers`：读 `t3-home/caches/<驱动>.json` 的 `status / auth.status / version / models`。**这些文件里有账号邮箱，界面只显示「已登录」和套餐名，邮箱不显示、不写日志、不外发。**
- 登录引导：Claude Code → 让用户在终端运行 `claude auth login`；Codex → 已用用户自己的 ChatGPT 登录；Antigravity → 在 T3 里安装运行包并用 Google 登录（`docs/user/providers-antigravity.md`）。碧琪只打开官方页面或给出命令，不经手凭据。
- 版本要求：Codex ≥ 0.159（11-22 实测旧版直接报错）。检测到旧版就提示更新。

### 3.3 在 Metre 里用外部引擎（G1）——Metre 自己的「引擎台」（11-22 晚按用户两句话改）

用户 11-22 晚：「注意是做融合不是完全按照现在的 Meter（因为现在 Meter 的完善程度没有别人的高大部分都没有如果出现没有的就做一个 meter UI 覆盖就行）」「也不要直接全用，因为本质上也是完善 meter 所有功能」。

所以**不嵌对方的整页**（T3 网页本身也禁止被嵌：`frame-ancestors 'none'`），而是：功能以 T3 / OpenMausBot 为准，做成 Metre 自己的界面。

- 数据：插件里一个 T3 实时通道客户端（`engines-rpc.mjs`）。T3 网页用的就是这条：`ws://127.0.0.1:<端口>/ws?orchestrationProtocol=2`，Effect RPC 的 JSON 消息（`Request / Chunk / Ack / Exit`）。令牌用 `t3 auth session issue --token-only --ttl … --scope …` 现签，只在内存里，到期前换新；不进日志、不给界面。11-22 实测 `server.getConfig`、`orchestration.getThreadProjection`、`orchestration.subscribeShell` 都通。
- 翻译：`engines-bridge.mjs` 把 T3 的对话投影（`turnItems`、`runtimeRequests`、`runs`）翻成 Metre 的一份简单清单：你说的话 / 回答 / 思考 / 跑命令 / 改文件 / 搜索 / 工具 / 计划清单 / 待批准 / 提问 / 报错 / 压缩，外加此刻状态、引擎、模型、放手程度。
- 动作（全部走 `orchestration.dispatchCommand` / `launchThread` 等 T3 自己界面用的命令）：开新对话、继续说、中途递话（插话 `steer_active` / 排队 `queue_after_active`）、停、批准或拒绝（`runtime-request.respond`）、回答提问、换模型（`thread.model-selection.set`）、换放手程度（`thread.runtime-mode.set`）、置顶、归档、看改动（`orchestration.getFullThreadDiff`）。
- 界面（新文件 `laolao-metre-engine.js/.css`，只在 Metre 生效）：
  - Metre 输入框下多一颗「引擎」按钮：Metre（默认）/ Claude Code / Codex / Antigravity，带登录和额度状态；再选模型和放手程度。按 Metre 会话记住（`<引擎目录>/sessions.json`，不改 `session-prefs.mjs`）。
  - 选了外部引擎，这个 Metre 会话的正文区换成「引擎台」：Metre 自己画的对话流（思考看完自动收起、命令和改动一行一行可展开、待批准卡片、提问卡片、计划清单）、Metre 自己的输入框（发送 / 插话 / 排队 / 停）、右侧改动面板。侧栏还是这一行 Metre 会话，标上引擎名。
  - 引擎没开、没登录、额度用完：在引擎台里用大白话说清楚，并给出下一步（打开开关 / 登录指引 / 几点恢复），不显示成程序出错。
- ~~借用 T3 设置页 + 转发口~~（11-22 夜作废）。用户：「不要有 T3 code 的 ip 标志 还有记得保留 “C.le.” 思考动画 three.js」。所以 Antigravity 的运行包安装和 Google 登录也由 Metre 自己做（T3 的 `provider.install.*`、`provider.auth.*` 命令），界面上任何地方都不出现 T3 的名字、标志、链接；引擎台的工作状态行用和原生对话同一个 C.le. 粒子签名（three.js）。

### 3.4 Metre 派活给外部引擎（G2）

- 新工具 `pinkie_engine_task`（只在 Baton 下提供）：`engine`、`model`、`task`、可选 `folder`、`level`、`player`（乐手，见 3.5）。走 `launchThread`（不等），记进血缘（类型 `external`），计入 Metre 的在跑上限。
- 守望：插件每 5 秒看一次在跑的外部子任务；结束（完成、失败、等人回答）后用现有的汇报卡片和叫醒链条回报 Metre；等人回答时在 Metre 里出「等你」。
- 侧栏父会话下面、总谱声部里显示「引擎名 · 模型」和此刻在做什么，点开就是这条子任务的引擎台（可以停、递一句话、批准）。

### 3.5 吸收的功能清单（G3，做完逐项打勾）

| 来源 | 功能 | Metre 里怎么做 |
|---|---|---|
| T3 | 切换引擎和模型 | 引擎按钮 + 模型菜单；对话中途换模型走 `thread.model-selection.set` |
| T3 | 中途递话不打断 | 引擎台输入框：运行中发送默认排队，可切「插话」 |
| T3 | 审批（按引擎自己的权限模式） | 待批准卡片：批准 / 这次都批准 / 拒绝（可附一句理由） |
| T3 | 提问卡片 | 选项 + 自己写；回答走 `runtime-request.respond` |
| T3 | 改动差异审阅 | 右侧改动面板，按文件列 +/−，点开看差异 |
| T3 | 会话列表（置顶、归档） | 引擎台标题栏的置顶 / 归档；侧栏标引擎名 |
| T3 | 每个会话独立工作树 | 开新对话时可选「在新的工作树里做」（`workspaceStrategy: worktree`） |
| T3 | 用量和额度 | 引擎菜单和引擎台顶部显示额度状态、恢复时间（`usageLimits`） |
| T3 | 计划清单 / 方案 | `todo_list`、`proposed_plan` 画成 Metre 的清单和谱纸卡 |
| OpenMausBot | 审批分级 | 「放手程度」四档：全放手 / 自己判断 / 改文件不问 / 每步都问（= T3 的 full-access / auto / auto-accept-edits / approval-required），默认全放手，对话中途可改 |
| OpenMausBot | 机器人当联系人 | 「乐手」：名字 + 引擎 + 模型 + 放手程度 + 可选的 Metre 角色卡；引擎菜单里能直接选，派活时 `player` 指定 |
| OpenMausBot | 看它干活 | 引擎台本身实时刷新；总谱声部显示此刻在做什么 |
| OpenMausBot | 连接的应用 | 不做：用碧琪已有的连接器，不用对方的云服务 |

### 3.6 设置、许可、文档（E7）

- 「外部引擎」总开关在引擎菜单和设置里各一处；关着时不下载、不启动。
- 关于页加许可声明：T3 Code（MIT）、OpenMausBot（Apache-2.0，借的是功能设计，没有搬 `enterprise/`）。`docs/METRE-MODE.md` 加「外部引擎」一节。

### 3.7 对方支持的引擎全部接上（用户 11-22 深夜）

用户：「记得把人家支持的都加上比如 Cursor 等这些都加」。引擎菜单不止三家，T3 支持的十家都列出：Claude Code、Codex、Antigravity、Cursor、OpenCode、Grok Build、Kiro、Pi、fx、Muse Code（实例 id 和安装、登录命令见 PROGRESS 11-22 深夜那条）。ACP 注册表里的其他引擎（「更多引擎」，搜到再加）放到 E6 后面。

- 每家在菜单里按「能用 / 没打开 / 没装 / 没登录」分组；没打开的给「打开」，没装的给安装命令（复制 + 「在终端里装」，用户点了才开终端），没登录的给登录（引擎服务能托管的走托管：Antigravity 装和登，Cursor 浏览器登录；其余开终端跑官方登录命令）。
- 碧琪不经手凭据：要填密钥的登录方式不在 Metre 里做，提示改用浏览器或终端登录。

### 3.8 成熟的东西也同步给碧琪全局（用户 11-23）

用户：「T3 和 bot 这种主要功能是给 Metre 的，但是里面也有很成熟的工具 / 功能 / 可视化命令前端功能按键 / 更出色的成熟的技术和功能按键，也可以同步给碧琪（全局）」。

- 做法：Metre 里先做好、验过的部件，写成不绑 Metre 的通用部件（不读 `agent:metre:` 会话键、不用 Metre 专用配色变量），再在碧琪全局界面接上；碧琪那边按碧琪自己的样子换皮，不出现 Metre 的像素 M、谱纸用语。
- 候选（做 Metre 时顺手标出，E8 逐项定）：命令行和改文件一行一行可展开的执行记录；待批准卡片（批准 / 这次都批准 / 不行 + 附一句）；提问卡片；计划清单和方案卡；右侧改动差异面板；运行中排队 / 插话 / 停的输入框；「思考了」自动收起；额度和恢复时间的大白话提示；多引擎选择（碧琪全局也能把一次对话交给 Claude Code / Codex / Cursor 等）。
- 规矩：不动五个老模式已有的行为，只加；每接一项都要老模式的回归测试和截图；健康门禁照旧（新功能写新文件）。

---

## 四、分批

| 批 | 内容 | 验收 |
|---|---|---|
| E1 | 引擎服务：下载、校验、解压（中文路径）、启动、停止、状态、崩溃重启 | 单元测试；隔离目录里真装一遍；中文用户名路径的测试 |
| E2 | 桥：网关方法、引擎和登录状态、版本检查 | 测试；隔离网关里调用 |
| E3 | 实时通道客户端 + 翻译 + 引擎台（引擎按钮、对话流、输入框、审批、提问、改动面板） | 测试；真界面截图，和 T3 原版并排对比 |
| E4 | `pinkie_engine_task` 派活、守望、回报、总谱声部 | 隔离网关里派一件真活（用户额度可用的引擎） |
| E5 | 放手程度四档、乐手 | 对照清单 |
| E6 | Antigravity 安装和登录由 Metre 自己做（不嵌 T3 页面），引擎台补齐清单剩下的项 | 对照清单 + 截图 |
| E3b | 对方支持的十家引擎全部进菜单：打开、安装、登录（3.7） | 测试；真引擎服务里十家都列出、能打开 |
| E7 | 设置开关、关于页许可声明、文档（`docs/METRE-MODE.md`）、版本号 | 发版要用户点头 |
| E8 | 把 Metre 里验过的成熟部件同步给碧琪全局（3.8） | 逐项：老模式回归测试 + 碧琪样子的截图 |

---

## 五、风险

- 外部账号额度：11-22 用户的 Codex（ChatGPT Plus）额度到 11-26 才恢复；测试要挑有额度的引擎，额度用完要在界面上说清楚，不能显示成程序出错。
- T3 升级很快：固定版本，升级另做一批并重跑全部测试。
- 发布包 170MB：只在用户打开开关时下载，显示进度。

---

## 七、接力规矩（用户 11-22）

- 不用一直盯着上下文，偶尔用 `get_usage` 看一眼就行；到 50% 左右交接，到 60% 也可以（11-22 夜用户更新）。
- 交接时：提交并推送，更新 `PROGRESS.md`，开一个全新的会话（不带上文），写清楚从哪继续，立刻解绑；新会话照同样规矩，一直到全部做完。
- 用户说额度不够、要停时，就停在当前一小段，记好 PROGRESS，等用户自己在新窗口唤醒计划。
