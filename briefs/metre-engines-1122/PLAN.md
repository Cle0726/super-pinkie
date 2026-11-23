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

### 3.3 在 Metre 里用外部引擎（G1）

- 输入框旁加「引擎」选择：Metre（默认）/ Claude Code / Codex / Antigravity，选了外部引擎再选模型。按会话记住（`pinkie.session.prefs` 加 `engine`）。
- 第一版：Metre 主区换成嵌入的引擎视图（T3 网页，经 `t3 auth pairing` 换来的本机会话），外面是 Metre 的框（标题、返回 Metre、引擎和模型选择）；用 `t3 theme set` 装一套 Metre 主题。T3 自己的标志如果主题盖不掉，就在第二版换掉（3.6）。
- 外部引擎的对话也要出现在 Metre 侧栏（一行，标引擎名），点开回到同一个视图。

### 3.4 Metre 派活给外部引擎（G2）

- 新工具 `pinkie_engine_task`（只在 Baton 下提供）：`provider`、`model`、`task`、可选 `folder`。调 `t3 thread start <项目> <任务> --provider --model --json`（不等），记进血缘（`session-lineage.json`，类型 `external`），计入 Metre 的在跑上限。
- 守望：每 5 秒 `t3 thread show --json`，结束（完成、失败、等人回答）后用现有的汇报卡片和叫醒链条回报 Metre；等人回答时在 Metre 里出「等你」。
- 总谱声部里显示「引擎名 · 模型」，可以打开、停止、递一句话（`thread send`）。

### 3.5 吸收的功能清单（G3，做完逐项打勾）

T3 Code：切换模型和引擎；每个会话独立工作树；改动差异审阅；审批（按引擎自己的权限模式）；会话列表（置顶、归档）；中途递话不打断（`thread send`）；用量和额度显示（caches 里的 `usageLimits`）。
OpenMausBot：机器人当联系人（Metre 的角色卡 = 带引擎和模型的机器人）；审批分级（`docs/approval-levels.md`）；「看它干活」的实时视图；连接的应用改用碧琪已有的连接器（不用 Composio 的云服务）。

### 3.6 第二版：自己的 Metre 前台

嵌入视图稳定以后，基于 T3 网页端（MIT）和 OpenMausBot 的界面（Apache-2.0）做 Metre 自己的前台，连同一个引擎服务。保留许可声明，换掉全部品牌。这一步也是 C.le. 计划 K8 的落地。

---

## 四、分批

| 批 | 内容 | 验收 |
|---|---|---|
| E1 | 引擎服务：下载、校验、解压（中文路径）、启动、停止、状态、崩溃重启 | 单元测试；隔离目录里真装一遍；中文用户名路径的测试 |
| E2 | 桥：网关方法、引擎和登录状态、版本检查 | 测试；隔离网关里调用 |
| E3 | Metre 引擎选择 + 嵌入视图 + Metre 主题 | 真界面截图，和 T3 原版并排对比 |
| E4 | `pinkie_engine_task` 派活、守望、回报、总谱声部 | 隔离网关里派一件真活（用户额度可用的引擎） |
| E5 | OpenMausBot 的机器人和审批分级 | 对照清单 |
| E6 | 自己的 Metre 前台（3.6） | 对照清单 + 截图 |
| E7 | 设置开关、关于页许可声明、文档（`docs/METRE-MODE.md`）、版本号 | 发版要用户点头 |

---

## 五、风险

- 外部账号额度：11-22 用户的 Codex（ChatGPT Plus）额度到 11-26 才恢复；测试要挑有额度的引擎，额度用完要在界面上说清楚，不能显示成程序出错。
- T3 升级很快：固定版本，升级另做一批并重跑全部测试。
- 发布包 170MB：只在用户打开开关时下载，显示进度。

---

## 七、接力规矩（用户 11-22）

上下文到 50% 左右（`get_usage` 看，不能提前）：提交并推送，更新 `PROGRESS.md`，开一个全新的会话（不带上文），写清楚从哪继续，立刻解绑；新会话照同样规矩，一直到全部做完。
