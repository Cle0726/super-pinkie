# 工具整改进度（tools-health-1113，Windows 端执行）

执行：Windows 端 Claude（Opus 5.5），按 `WINDOWS-PROMPT.md` 改过的规矩。分支 `fix/tools-health-1113`，工作树 `F:\Projects\tools-health`。

## 开工记录（Z2 基线，2026-11-13 16:50 PST）

| 项 | 开工前 |
|---|---|
| 正式状态目录 | `%USERPROFILE%\.openclaw`（`PINKIE_STATE_ROOT` 未设；App 自己的状态在 `%LOCALAPPDATA%\SuperPinkie`） |
| 正式 `openclaw.json` 修改时间 | `2026-11-12T18:56:21.8899081-08:00` |
| App 安装目录 `%LOCALAPPDATA%\Programs\SuperPinkie` 修改时间 | `2026-11-03T14:57:22.1522954-08:00`（`_internal\VERSION` = 2.5.27） |
| 18789 上的网关 | **没有进程在监听**（正式 App 当时没开） |

## 隔离副本（Windows）

- 位置：`%USERPROFILE%\碧琪实测\iso-th`；脚本 `tools/tool-health/iso-windows/`（`setup.py` 搭建 / 同步插件 / 打补丁，`gateway.py` 起停，`run_eval.py` 批量跑题，`fixtures.py` 造夹具，`questions.json` 题目）。
- 主目录、LOCALAPPDATA、APPDATA、TEMP 全指进副本；端口随机（这次 1425），只绑 127.0.0.1，自己的令牌。
- 运行时 = 已装 App 的 `_internal\runtime` 复制一份 + 叠仓库 `desktop/windows/mac-runtime` 快照（30 个文件，和 build-win.ps1 一样）。插件 = 本分支 `services/` 的复制。
- 模型配置从正式配置只读复制（上游是本机 `127.0.0.1:1466` 的中转），密钥没打印、没进仓库。
- 第一次启动时运行时自己的 doctor 往**副本**里装了 `brave`、`deepseek` 两个插件（正式环境没动）。

## 实测模型（用户 11-13 定）

- 用户 11-13 傍晚：**实测统一用 `mm/workbuddy/hy4free`**，看图让它自己看（配置里它是 `text + image`），或者走 image / pdf 工具用能看图的模型。和 ACCEPTANCE「三个模型各跑 2 遍」不一样，这里以用户为准；各项里的「3 个模型 × 2 遍」都换成「hy4free × 2 遍」，通过线按比例算（如 ≥ 5/6 → ≥ 2/2）。
- 隔离副本配置：`agents.defaults.model` / `imageModel` / `pdfModel` 都是 `{primary: mm/workbuddy/hy4free, fallbacks: []}`：**不设后备**（用户 11-13：hy4std、deepseek-v4.1-flash 不能用）。hy4free 出错就照实算失败，不换模型，各模式去掉单独的 model。`imageModel`、`pdfModel` 是运行时 zod 结构里**已有**的键（`AgentDefaultsSchema`，string 或 `{primary, fallbacks, timeoutMs}`），不是新键；改完网关正常启动。
- Windows 正式环境的 `image` 16/16 失败，原因是没配 `imageModel` 时运行时退到 `google/gemini-2.0-flash` 之类上游没有的模型（`Unknown model`）。正式配置**没改**（规矩：正式环境只读）；要不要在正式碧琪上也这样配，等用户 / Fable 定。
- 之前按三个模型开跑的「改前」批、以及带后备跑的 `before-hy4free` 批都中途停了，作废；重新按只用 hy4free、无后备跑（label `before-h4f`）。

## 自己做的决定（用户 11-13 夜把这一轮交出来：「那你管控一下把任务做完我有事全部交给你了可以自己决定」）

从这之后不再等用户，每个决定和理由记在这里。硬规矩不变（不合 main、不打 tag / 不发版、不装进正式 App、正式环境和 18789 只读、不加 OpenClaw 配置键、不改人格 / 打法、不开子代理、只用 hy4free）。

| 时间 | 决定 | 理由 |
|---|---|---|
| 11-13 夜 | A3、A4 分支合进 `fix/tools-health-1113`（`a52566f5`、`932f0ea5`） | 这一条是**用户亲口同意**的（交出前问过）；两边 progress 都写完，三方合并无冲突，合后相关测试只剩 Windows 本来就红的 |
| 11-13 夜 | `plugins.allow` 加 `document-extract`（`8001f64d`） | A4 实测 pdf 抽取全坏的直接原因；改已有键的值、用户 deny 时不加，可逆；不做 A4 就过不了 |
| 11-13 夜 | A2-2 记「没过」、不修，报 A2-F1 | 根因在运行时记忆管理器，修要打运行时补丁，超出 A2 的范围（§6「要动运行时核心就停下记录」）；和 A2 的库挪动无关 |
| 11-13 夜 | 体检脚本加 `--event-since/--event-until`，改前改后都按事件时间重算 | 副本会话文件里混着作废批和续接的旧事件，按文件修改时间量会多数（HANDOFF-4 提醒过）；旧口径的「改前」表保留不删，两种口径都写明 |
| 11-13 夜 | A3-1 的「另外 20 条中文查询」自己定了题（`questions-search.json`），单独一批 `after-a-search` | 方案没给题目；放进同一批会和其他题的统计混在一起 |
| 11-13 夜 | B1 渠道工具按「这个渠道的消息会落到哪个模式」在模式 `tools.deny` 里收放，不做按会话 | 运行时没有能改工具列表的插件钩子（钩子清单里没有一个返回 tools），按会话只能改运行时核心，方案明确只用已有机制；QQ 落到想法 / 项目模式，和面板会话共用，按模式是已有机制能做到的最细 |
| 11-13 夜 | B1 `gateway` 不拿掉，另外 6 个拿掉 | 方案要求「0 次且普通用户用不到」；`gateway` 在 Windows 正式 60 个会话里调了 11 次 |

## Windows 正式环境只读基线（`session-stats.py --state %USERPROFILE%\.openclaw`，最近 60 个会话）

| 指标 | Windows 正式 | Mac 正式（Fable 量的） |
|---|---|---|
| 模型回复 / 工具调用 | 2741 / 2739 | 1287 / 1256 |
| `exec` 占比 | 59% | 58% |
| 一次调多个工具 | 3% | 14% |
| 出错或中断 | 1.2% | 5.3% |
| 系统提示词中位数 | 54622 字 | 约 6.2 万 |
| 工具说明中位数 | 61638 字（46 个工具） | 约 7.6 万（65 个） |
| 平均每次回复 token | 203817 | 约 16.6 万 |

Windows 失败率高的工具：`process` 458/850（54%，例「Termination requested…」「This operation was aborted」）、`image` 16/16（全是图片模型报错：`Unknown model: google/gemini-2.0-flash`、上游 400，**不是**目录白名单问题）、`exec` 147/1608、`read` 6/48、`gateway` 4/11（config.get 太大）。`web_fetch` 只调过 2 次（1 次 404），`web_search` 1 次（Brave 密钥无效）。模型几乎全是 `workbuddy/deepseek-v4.1-flash`（2452）。原始 JSON 没提交（可能含用户信息）。

---

## A 组

### A1 web_fetch 在假地址代理下能用

**复现（Windows，2026-11-13）**：本机 Clash Verge 也是假地址模式：`www.sohu.com` → `198.18.0.16` + `2001:2::e`，`www.moe.gov.cn` → `198.18.0.17` + `2001:2::f`。
用未打补丁的 OpenClaw `2026.7.1-2`（npm 原包）的 `ssrf-BayeDjCv.js` 直接调 `resolvePinnedHostnameWithPolicy(host, {policy: {allowRfc2544BenchmarkRange: true}})`：
IPv4 `isPrivate=false`，IPv6 `2001:2::e isPrivate=true`，结果 `Blocked: resolves to private/internal/special-use IP address`。**和方案判断的原因一致**。

**Windows 上的不同**：Windows 包（以及 10-31 的 Mac 快照）里的 `ssrf-BayeDjCv.js` 已被拿掉了解析检查（`assertAllowedResolvedAddressesOrThrow` 等直接 `return`，`skipPrivateNetworkChecks: true`），不是本仓库任何补丁做的；所以 Windows 正式环境 web_fetch 不会被这条拦（正式配置还开着 `useTrustedEnvProxy`）。Mac 现在装的运行时显然没有这层，所以全被拦。

**修法**：`patch/apply-web-fetch-fakeip-v6.mjs`，只改 `isPrivateIpAddress`：开关为真且地址在 `2001:2::/48` 时放行。没有新配置键。已接进 `installer/macos/apply-theme.sh`（紧跟 image-access）和 `patch/apply-all.mjs`；快照 `desktop/windows/mac-runtime/openclaw/dist/ssrf-BayeDjCv.js` 同步打上，SHA256SUMS 已更新。

打补丁后同一个复现脚本：两个 IPv6 都 `isPrivate=false`，`resolvePinned OK`；再跑一次补丁 `{"changed":false}`（幂等）；`node --check` 过。

| # | 结果 | 证据 |
|---|---|---|
| A1-1 | 过（副本 `after-a` 题 2） | 第 1 遍 5/5 个网址 `web_fetch` 成功；第 2 遍 4/5（广西教育厅 `request timed out` / `fetch failed` / 404，模型改用 curl 读到）。两遍都没有 `special-use IP` 报错。注意副本运行时本来就拿掉了 ssrf 解析检查（见上），这一条在副本里**区分不出补丁前后**，补丁本身的效果靠 A1-2 单测和 npm 原包复现 |
| A1-2 | 过 | `tests/web-fetch-fakeip-v6.test.mjs`：开关为真时 `10.0.0.1`、`192.168.1.1`、`127.0.0.1`、`169.254.169.254`、`fd00::1`、`fc00::1`、`fe80::1`、`::1`、`2001:2:1::1`、`2001:db8::1`、`::ffff:10.0.0.1` 仍判为内网；`2001:2::e` 只在开关为真时放行。测试跑的是本机真实运行时的 ip 判定代码（打补丁的副本写到临时目录，不动原文件），快照版也跑了一遍 |
| A1-3 | 过 | 补丁只改代码；`setup.py patch apply-web-fetch-fakeip-v6.mjs`（`changed: true`）后副本网关 `ready`，端口 1425 在听，`after-a` 20 次都跑完 |
| A1-4 | `patches-wired` 过；`refresh_mac_runtime.py --check` **待 Mac 端跑** | `node --test tests/patches-wired.test.mjs`：pass 1；`python -m unittest tests.windows_mac_snapshot_test`：6 个都过 |

### A2 memory_search 要么能用，要么不出现

- Windows 正式环境 4 个模式库都是结构版本 1，`memory_search` 0/4 失败；Mac 的「版本 19」问题这边没有。
- **走第一条路（留着）**：Windows 正式会话里（只读看的），库能打开、`provider: none` 时 `memory_search` 走关键词检索，能返回 `memory/INDEX.md`、`memory/2026-11-07.md` 这类命中（另有 3 次 0 条）。所以库重建后不用把工具拿掉，也没用到第五节那句「记忆检索暂时停用」。
- 实现：`services/mode-architecture/agent-db-guard.mjs` + `index.mjs` 里 `gateway_start` 钩子。读 SQLite 文件头第 60 字节的 `user_version`（不打开库、不加依赖），和运行时打包代码里的 `OPENCLAW_AGENT_SCHEMA_VERSION` 比；更新的就把库和 `-wal/-shm/-journal` 一起 `rename` 到 `<状态目录>/backups/agent-db-<日期>/<模式>/`。最近 60 秒有改动的不动；任何一个文件挪不动（Windows 上被占用改名会失败）就整组放回。只挪不删，不降级。
- 和方案的差别：运行时认的版本号读不到时什么都不做（不猜）。
- **实测发现（11-13，Windows 副本）**：运行时在网关启动早期（插件加载之前，比 `gateway_start` 早约 8 秒）就会打开每个模式库，读到版本 19 报错后关掉，不占着文件（改名探测三个文件都能改），但这一下已经重写了 `-shm`。原来的「60 秒内改过就不动」把 `-shm` 也算上，所以每次启动都是 `skipped-busy`，**永远挪不动**。修法：判断「有人在写」只看库本身和 `-wal` / `-journal`（真写入一定动这两个），`-shm` 不算；被占用改名失败整组放回的保护不变。同一处 Mac 也会中（打开库就会动 `-shm`），Mac 副本没测。

| # | 结果 | 证据 |
|---|---|---|
| A2-1 | 过（Windows 副本实测，修了一处后） | `tests/agent-db-guard.test.mjs`：用 `node:sqlite` 造真库（200 行，`PRAGMA user_version = 19`）+ 随机内容的 `-wal/-shm`，挪完三个文件 sha256 和大小都一致，版本 1 的库不动，第二次启动不再动；60 秒内改过的跳过；挪一半失败整组放回 | 5 条全过（新增「-shm 刚被重写不算在写」）。**副本实测 11-13**：learning 模式放假库（版本 19，库 77824 B / -wal 4096 B / -shm 32768 B，mtime 5 分钟前）→ `setup.py sync` + 重启。第一次：日志 `agent db learning: schema 19 > 1, skipped-busy`，没挪（原因见上「实测发现」）；修后再 sync + 重启：`agent db learning: schema 19 > 1, moved -> …\iso-th\home\.openclaw\backups\agent-db-20261113\learning`，库和 -wal 的大小、sha256 与放进去时一致（`11a2dca6…` / `baf2ad89…`），-shm 与挪之前磁盘上的一致（`fd4c9fda…`，运行时第一次启动已重写过它），模式目录里只剩 `models.json`；网关 `ready`、端口 1425 在听；第三次启动没有 `agent db` 日志（没东西可挪） |
| A2-2 | **没过**（运行时问题，没改，见下「A2-F1」） | `after-a` 题 7：`memory_search` 5 次里 2 次报错，都是 `corpus: "all"`，返回 `disabled: true, error: "index metadata is missing"`；同一轮里几毫秒后 `corpus: "sessions"` / 不带 corpus 的调用都正常（`provider: none`，0 条）。复查 `after-a-pdf`（网关重启后，题 7 × 2）：6 次里 1 次，又是重启后第一次 `corpus: "all"`；之后的 `all` 正常。改前 `before-h4f` 0/4（那时网关已跑了一阵）。 |

**A2-2 查到的**：报错来自运行时 `manager-*.js` 的 `resolveMemoryIndexIdentityState`：管理器刚建好时身份状态默认 `missing`，要等第一次同步把 `memory_index_meta` 读进来；`corpus: "all"` 要连「记忆文件」那一路，网关刚起来的第一次调用正好撞上，后面就好了（副本 main 库里 `memory_index_meta` 是有的：`fts-only` / `none`）。不是 A2 的库挪动造成的（这次只挪过 learning，main 库没动），插件层也拦不住（钩子不能改工具结果）。照 WINDOWS-PROMPT §6「要动运行时核心就停下记录」，没修，报给 Fable：见「报给 Fable 的另开项」A2-F1。

### A3 搜索不再被一家卡死（分支 `claude/tools-health-1113-a3-03a2ac`，用户 11-13 同意后合进，合并提交 `a52566f5`）

改法、单测和逐家实测见 `progress/A3.md`。合进后副本：`setup.py sync` 现在会照 `services/mode-architecture/setup.py` 把四个模式的 `tools.deny` 补上 `web_search`（副本配置是建副本时复制的，正式 App 由插件安装器补，副本以前不会）。

| # | 结果 | 证据 |
|---|---|---|
| A3-1 | 过 | 题 1（`after-a` × 2）：`pinkie_search` 12/12 成功，都给出 3 个来源和原文。另 20 条中文查询（`tools/tool-health/iso-windows/questions-search.json`，批 `after-a-search`，× 2 = 40 次）：`pinkie_search` 187 次里 183 次有结果（**97.9%**），40 次里 39 次至少一次搜到（没搜到的那次模型没调搜索、直接答了天气）。4 次失败都是 `site:` 限定或很窄的查询，必应「没有解析到结果」、其余几家在跳过期。来源：必应 170、360 9、DuckDuckGo 3、搜狗 1 |
| A3-2 | 过（单测） | `progress/A3.md`：必应给验证页 → 搜狗答，`source: 'sogou'` |
| A3-3 | 过 | 副本 `after-a` 题 7 会话的 `trajectory.jsonl` 里 `context.compiled.tools`（51 个）：搜网页的只有 `pinkie_search`，没有 `web_search`（另有 `code_search`、`memory_search` 是别的用途）；整批 `web_search` 0 次调用（改前 3/3 报 `disabled or no provider`） |
| A3-4 | 过（单测） | `progress/A3.md`：五家全坏 + 假浏览器 → 工具自己开必应页取回 |

**顺带看到（不是 A3 的通过线，记下）**：`after-a-search` 40 次里 10 次撞上评测脚本 480 秒上限：模型搜到后又连读很多页（整批 `web_fetch` 332 次、102 次失败），一次「给 2 个来源网址」的简单查询读了十几页。属于「一次做多少就收手」的问题，留给 B/C 组看（不在 A 组改）。

### A4 image / pdf 能读用户给的文件（分支 `claude/tools-health-1113-a4-7640b6`，同上合进，合并提交 `932f0ea5`）

改法、单测和端到端见 `progress/A4.md`。合进后副本：`setup.py patch apply-image-access.mjs` → v5，副本运行时的三个文件和快照逐字节一致。

**实测发现 + 修了一处（提交 `8001f64d`）**：`after-a` 里目录拦截没了（没有一条 `not under an allowed directory`），但 `pdf` 带 pages（以及模型自己把 `maxBytesMb` 调大的那次）一律报 `PDF extraction disabled or unavailable: enable the document-extract plugin`。原因：运行时自带的 `document-extract` 插件默认开，但 `plugins.allow` 一旦是清单（正式和副本都是只有三个碧琪插件），不在清单里的自带插件就不加载；mm 走 openai-completions，不能直接读 PDF，只能靠它抽文字和页图。**正式 Windows 配置也是这样**，所以正式碧琪 `pdf` 遇到需要抽取的情况也会坏。修法：`services/mode-architecture/setup.py` 新增 `NEEDED_BUNDLED_PLUGINS = ("document-extract",)`，只往**已有的** `plugins.allow` 清单里加，用户 deny 了就不加；不加新键、不加 `entries`。单测 `test_pdf_extraction_plugin_joins_an_allow_list_unless_denied`。**决定理由**：这是 A4「pdf 能读」的必要条件，改的是已有键里的值（和插件把自己加进 allow 是同一段代码），可逆；setup.py 指纹变了，用户下次启动 App 会拿到。

| # | 结果 | 证据 |
|---|---|---|
| A4-1 | 过 | `after-a` 题 3 两遍：`image` 都没出错，三张图的字全对（发票号 TH-2026-0381 / ¥486.00、B302 周四 14:00、取件码 7-3-1906），没有 `not under an allowed directory` |
| A4-2 | 过（单测） | `tests/media-inbox.test.mjs`（Mac + Windows 两套拒绝目录） |
| A4-3 | 过（修上面那处后） | 复查批 `after-a-pdf`（题 4a / 4b / 7 × 2）。不指定页：题 4b 第 2 遍 `pdf` 返回「这份 PDF 有 30 页、34.9 MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 20 页。」，`isError: false`、`details.needsPages: true`；改后批 `after-a` 题 4b 第 2 遍同样。指定页：题 4a 第 1 遍 `pages: "1-15"` → 抽页后仍超上限，只送前 8 页并带「（PDF 太大，这次只读了第 1-8 页；第 9-15 页请再用 pages 分开读。）」，模型接着读 9-15，目录 6 章全对；第 2 遍 `pdf` 报 `PDF model returned no text (mm/workbuddy/hy4free)`（上游空回复），模型自己把页渲染成图读出了目录。题 4b 第 2 遍按 1-10 / 9-16 / 17-24 / 25-30 分段读完全书 |
| A4-4 | 过（单测） | `tests/media-inbox.test.mjs` |
| `refresh_mac_runtime.py --check` | **待 Mac 端跑** | |

### A5 process 的提醒不算出错

- 根因比方案说的深一层：这段「还在后台跑，先干别的」的提醒是 `background-jobs.mjs` 在 `before_tool_call` 里用 `block` 送出去的；运行时把被拦的调用做成 `details.status: "blocked"`，再由 `isToolResultError`（`tool-result-error-*.js`）判成出错。插件钩子的返回值经过 `runBeforeToolCall` 合并时只留 `params / block / blockReason / requireApproval`，**插件这一层没法让它不标出错**。Windows 正式会话里这条提醒 481 条，全部 `isError: true`（占 process 458 次失败的绝大多数）。
- 做法（不改运行时核心）：`background-jobs.mjs` 新增 `isWaitNudgeResult` / `softenWaitNudge`，`index.mjs` 注册同步钩子 `tool_result_persist`：只认这段提醒（`deniedReason: plugin-before-tool-call` + 提醒原文），写进会话记录前改成 `isError: false`、`status: deferred`、`ok: true`，**文字一字不动**。任务不存在、进程崩了、别的插件 / 循环检测的拦截都不碰，照旧是出错。
- 剩下的一截（照实写）：同一轮里运行时内存中的那条结果仍是出错。碧琪现在的模型都走 `mm`（openai-completions），这种格式**根本不把出错标记发给模型**，模型只看到文字，所以对模型无影响；会话记录、界面、体检统计、下一轮的上下文都已是正常结果。若以后走 Anthropic / Google 格式（会带 `is_error`），要彻底去掉得做一个三处的运行时补丁（钩子合并保留一个字段、veto 分支带出去、`buildBlockedToolResult` 写 `ok: true`）——没做，报给 Fable 定。

| # | 结果 | 证据 |
|---|---|---|
| A5-1 | 过（单元测试 + 副本 `after-a` 题 5：两遍 `process` 0/8 出错，都答出 5050 和 `done-40s`；整批 `process` 失败从改前 7/14 降到 2/14，剩下 2 条是题 6 里模型自己终止进程和 PowerShell 写错） | `tests/background-jobs.test.mjs` 8/8：提醒去掉出错标记且内容不变；任务不存在、其他拦截、循环检测、进程崩溃仍是出错 |

## 体检数字（隔离副本，hy4free 无后备）

### 改前：`before-h4f`（10 题 × 2 遍 = 20 次，并发 8，2026-11-13 晚；插件 = A1 之前的代码，运行时没打 A1 补丁）

`session-stats.py --state <iso>\home\.openclaw --since <started> --last 500`（含碧琪自己叫醒的后续轮，共 56 个会话文件）：

| 指标 | 改前（副本） |
|---|---|
| 模型回复 / 工具调用 | 362 / 466 |
| `exec` 占比 | 30% |
| 一次调多个工具 | 26% |
| 出错或中断 | 5.0% |
| 系统提示词中位数 | 47370 字 |
| 工具说明中位数 | 61320 字（52 个工具） |
| 平均每次回复 token | 53423 |

工具失败：`pdf` 9/9（全是 `Local media path is not under an allowed directory`，A4）、`web_search` 7/7（`disabled or no provider`）、`pinkie_search` 11/14（`duckduckgo: 被反机器人验证拦下`，A3）、`browser` 17/17（`browser control disabled`，副本里没开浏览器控制）、`process` 15/22（几乎全是「还在后台跑…」提醒，A5）、`app_browser` 16/27（例「启动服务请二选一：填写 dir，或同时填写 command、cwd、port。」，A6；另有副本没有侧栏浏览器端点）、`image` 19/51（`hy4free: unexpected EOF`、60 秒超时——上游问题）、`web_fetch` 10/77（重定向循环、429 等，**没有一条 special-use IP**：副本运行时本来就拿掉了 ssrf 解析检查，见 A1）、`exec` 15/142、`memory_search` 0/4。

逐题（20 次）：6 次整轮以 `FailoverError: unexpected EOF` 结束（题 1、2、4b、5、6×2 各一次）——hy4free 上游断流，没有后备就直接失败；按规矩不为它改代码。题 3 两遍都读对；题 8 两遍都指出 `admin.js`；题 9 正常。题 7 两遍都是从**副本里实测会话的存档**里还原出「技能大赛」——记忆库里没有，答案被前面几批实测污染了，这一题的结果要打折看。
原始结果在副本 `evals\before-h4f\`（results.json、stats.json），没提交。

### 改后：`after-a`（同 10 题 × 2 遍，2026-11-13 夜；插件 = A1–A7 + A3 + A4 合并后，运行时打了 A1 补丁和 image-access v5；document-extract 还没加进 allow）

这次**按事件时间**量（`session-stats.py --event-since <started> --event-until <下一批开始>`，选项是这次加的，默认行为不变），改前那批也按同样口径重算一遍（上面「改前」那张表是旧口径：按文件修改时间，混进了作废批的事件）：

| 指标 | 改前 `before-h4f`（事件时间） | 改后 `after-a`（事件时间） |
|---|---|---|
| 模型回复 / 工具调用 | 257 / 329 | 213 / 267 |
| `exec` 占比 | 30% | 31% |
| 一次调多个工具 | 28% | 25% |
| 出错或中断 | 4.7% | **1.4%** |
| 系统提示词中位数 | 47426 字 | 47315 字 |
| 工具说明中位数 | 61320 字（52 个） | 60194 字（51 个，少了 `web_search`） |
| 平均每次回复 token | 57308 | 52602 |

工具失败（改前 → 改后）：`pdf` 6/6 → 3/4（目录拦截没了，剩下的是 document-extract，已修，见 A4）、`pinkie_search` 6/9 → **0/13**、`web_search` 3/3 → 不再出现、`process` 7/14 → 2/14、`image` 17/48 → 3/22（剩下的是 60 秒超时，上游）、`web_fetch` 6/51 → 9/36（超时、fetch failed、404，没有 special-use IP）、`memory_search` 0/4 → 2/5（见 A2-2）、`app_browser` 8/12 → 7/11（副本没侧栏浏览器、夹具在假主目录外）、`browser` 7/7 → 3/3（副本没开浏览器控制）。改前窗口里还混着网关重启后续接的几轮旧会话（gemini / grok / deepseek-v4-pro 共 11 次回复），改后只有 hy4free（另 3 次 gemini 也是续接旧会话）。

逐题（`after-a`）：题 1 两遍都给出 3 个真实来源和原文；题 2 两遍（第 1 遍最后一轮 `LLM idle timeout`，正文已读完）；题 3 两遍全对；题 4a 第 2 遍、4b 两遍完成（第 1 遍 4a 空回复，靠模型自己渲染页图）；题 5 两遍对；题 6 第 2 遍答对（绕开 app_browser）；题 7 第 1 遍 `unexpected EOF`、第 2 遍答出（仍是从副本里历次实测的会话存档还原的，打折看）；题 8 两遍都指出 `admin.js`；题 9 正常。

复查批 `after-a-pdf`（加 document-extract 后，题 4a / 4b / 7 × 2）和搜索批 `after-a-search` 的数字见 A3、A4、A2-2。原始结果在副本 `evals\<批名>\`（results.json、stats-event.json），没提交。

### A6 app_browser 宽容一点

改的都在 `services/mode-architecture/app-browser.mjs`：
1. `wait`：`text / selector / ref / name` 四选一，可再加 `ms` → `ms` 换成 `timeout_ms` 传给原生侧（原生侧不会把它当成先睡 ms 毫秒），就是最长等待；只给 `ms` 是纯等待；上限 15 秒不变；两个目标一起给仍报错。
2. `serve`：`dir + port` 合法，静态服务就起在这个端口；`dir` 和 `command / cwd` 一起给才报错。
3. Mac 上 `tab`：`op: new` 带 `url` 等价 `open`；其他 tab 操作（含不带 url 的 new）返回「Mac 版只有一个页面，直接用 open 换网址。」，`ok: true`，不标出错。
4. 工具说明里补了 wait 和 serve 的参数写法（`name+ms=4000`、「静态页填dir（可加port指定端口）」）。
5. 证书无效类报错（`ERR_CERT_*`、`ERR_SSL_*`、certificate、self-signed…）换成一句中文 + 下一步（换 http、换来源）。这句是我写的，列进「待 Fable 写」请过目。

| # | 结果 | 证据 |
|---|---|---|
| A6-1 | 单元测试过；题 6 实测：副本没有侧栏浏览器端点，**没测**（需在真 App 里走）。`after-a` 题 6 两遍：`app_browser` 报「只能打开用户主目录里的文件」（夹具在副本假主目录 `iso-th\home` 外面）和「没有侧栏浏览器」，模型改走别的路，第 2 遍答对 | `tests/app-browser-lenient.test.mjs` 4/4：wait name+ms 传给原生侧的是 `timeout_ms: 4000`、请求超时 4 秒；serve dir+port 真的在该端口起服务并取回页面 |
| A6-2 | 单元测试过；真机**没测（需 Mac 端）** | 同上：Mac 下 `tab op=new url` 发出去的是 `open`，其他 4 种 tab 调用 `isError: false` 且只返回说明 |

回归：`app-browser-windows-endpoint`、`app-browser-windows-fallback`、`browser-pointer` 全过；`browser-fast`、`browser-memory` 各 1 条红，**基线（改前）同样红**，不是这次的；`mode-architecture` 只剩 Windows 上本来就红的 `computer tool discovers…`。

### A7 出错和中断的回复（只查不改）

脚本：`tools/tool-health/error-classes.py`（只读，只输出报错原文和计数，不输出用户内容）。数两样：assistant 消息 `stopReason` 为 `error` / `aborted` 的条数（和 session-stats「出错或中断」同口径），以及 `openclaw:prompt-error` 事件条数。分类看运行时记的报错原文；同一会话 10 秒内有 prompt-error 时用它补原因；「中断」里，120 秒内用户自己发了话的算「用户停止」，其余算「系统 / 原因不明」。「其后自动续接」= 下一条用户消息是碧琪的 `[pinkie-watchdog]` / `[pinkie-tier]`。

数据（2026-11-13 夜量，都在这台 Windows 上）：
- **副本**：隔离副本 `iso-th`，`before-h4f` 批起（`--since 1794621066.8`，即 results.json 的 `started`，2026-11-14 01:51 UTC），之后没有别的批次；最后一条回复 02:09 UTC（批次结束后 watchdog 续接的几轮）。**按事件时间过滤**：同一批会话文件里还混着作废批（`before`、`before-hy4free`）的旧事件，不过滤的话 session-stats 会数成 376 次回复，过滤后是 238 次。全部 `mm/workbuddy/hy4free`，无后备。
- **Windows 正式**：`%USERPROFILE%\.openclaw` 最近 60 个会话（只读，和 session-stats 一样的取法）。原始 JSON 没提交。

**出错 / 中断的回复**

| 原因 | 副本 `before-h4f`（238 次回复） | 其后自动续接 | Windows 正式（2741 次回复） | 其后自动续接 |
|---|---|---|---|---|
| 上游断流（`unexpected EOF`、`502 Post …copilot.tencent.com…: EOF`、`Connection error.`） | **10（83%）** | 9 | **9（27%）** | 5 |
| 上游限流（`429 {"code":6004,"msg":"您的使用量已超出频率限制…"}`） | 0 | — | 8（24%） | 4 |
| 上游超时（`LLM idle timeout (120s)`；`Request was aborted` + prompt-error `request timed out`） | 2（17%） | 2 | 7（21%） | 3 |
| 鉴权（`503 auth_unavailable: no auth available` 5、`502 Post "https://oauth2.googleapis.com/token": EOF` 1） | 0 | — | 6（18%） | 4 |
| 上下文超长 | 0 | — | 0 | — |
| 中断：用户停止（`This operation was aborted`，之后 120 秒内用户重发 / 说「继续」） | 0 | — | 2（6%） | 0 |
| 中断：系统 / 原因不明（`This operation was aborted`，之后是后台任务完成的自动续接） | 0 | — | 1（3%） | 1 |
| 其他 | 0 | — | 0 | — |
| **合计** | **12（5.0%）**：error 10、aborted 2 | 11 | **33（1.2%）**：error 23、aborted 10 | 17 |

按模型：副本全是 hy4free（断流 10、超时 2）。Windows 正式：`deepseek-v4.1-flash` 断流 8、限流 8、鉴权 5、中断 2；`gemini-3.8-flash-tiered` 超时 4、鉴权 1、用户停止 1；`hy4free` 超时 3、断流 1。

**`openclaw:prompt-error` 事件**：副本 2 条（`request timed out` 1、`LLM idle timeout (120s)` 1）；Windows 正式 10 条（`LLM idle timeout (120s)` 7、`This operation was aborted | 20` 3）。运行时只在「这一轮没跑完」（超时 / 中断）时记它，上游直接回 4xx / 5xx / EOF 的那几类不记，所以它比出错回复少，两边的数不能直接相加。

和 Mac 的差别：Fable 在 Mac 上量的是 32 条 prompt-error、36 次出错回复（5.3%）；Windows 正式只有 1.2%，副本（hy4free 无后备）5.0%。三边都**没有一条上下文超长**。

**结论**
- 两边占比最高的都是**上游断流**。根因在上游（hy4free / 腾讯中转 copilot.tencent.com 在出第一个字之前断开），不在碧琪。
- 但有一截是碧琪这边能改的：这类回复全部是 `[assistant turn failed before producing content]`（一个字都没出），可以安全地原地重试；现在要等 `pinkie-watchdog` 续接，副本里出错到续接间隔 10–123 秒（中位数约 90 秒），且 1 次没被续接（那次评测直接以 `FailoverError: unexpected EOF` 结束）。**另开一项报给 Fable（见下「报给 Fable 的另开项」A7-F1），这一轮没改。**
- 限流（429）和鉴权（`auth_unavailable`）都是本机中转 `127.0.0.1:1466` 后面的账号问题，碧琪修不了；要不要给正式环境配后备模型是用户的决定（同 PLAN 一、「换不换主模型不在本方案里」）。
- 上游超时都是 `LLM idle timeout (120s)`，已由 watchdog 续接一部分，不建议动 120 秒这个值（没有证据说明更短会更好）。

| # | 结果 | 证据 |
|---|---|---|
| A7-1 | 过 | 上表；`python tools/tool-health/error-classes.py --state <状态目录> [--since <秒> --last 500]` |

## B 组

### B1 按模式、按场合发工具

- **按会话做不到，按模式做**：运行时的插件钩子（`hook-runner-global-*.js` 里 40 个）没有一个能改发给模型的工具列表；工具策略只有全局 / 模式 / 模型 / 群组（只对渠道群会话）这几层。QQ 的工具是 `@openclaw/qqbot` 插件对所有会话一律注册的（`api.registerTool({name:"qqbot_channel_api"})`，没看渠道）。所以用已有的 `agents.list[].tools.deny`：渠道的消息会落到的模式才发它的工具。
- **怎么算落到哪个模式**（`services/mode-architecture/setup.py` 的 `_channel_modes`）：`bindings` 里 `match.channel` 是这个渠道的 → 那些模式；某个账号没被「按账号整个接走」（只有 `channel`+`accountId` 的绑定才算，带 peer / 群的细分不算）→ 还会落到默认模式（`default: true` 的，没有就是列表第一个）。渠道关了或没配 → 哪个模式都不发。`CHANNEL_TOOLS = {qqbot: qqbot_*, feishu: feishu_*}` 这几个名字归这段代码管：渠道接进来了就从该模式 deny 里拿掉，用户自己的 deny 条目只加不删。无限制模式不动（和原来一样）。
- **0 次调用的工具**：`nodes`、`agents_list`、`dir_fetch`、`dir_list`、`file_fetch`、`file_write` 加进 `UNUSED_OPENCLAW_TOOLS`（Mac 基线 `baseline-1113.json` 60 个会话全是 0；Windows 正式 60 个会话也是 0，后四个在 Windows 根本没有）。代码、打法、手册、技能里没有指望它们的（`skills/` 里的 `nodes` 都是图表节点，不是这个工具）。`gateway` 在 Windows 正式调了 11 次，留着。
- 副本 `setup.py sync` 照读这两个常量；副本没配渠道，所以四个模式都 deny 了 `qqbot_*`、`feishu_*`。

| # | 结果 | 证据 |
|---|---|---|
| B1-1 | 过（单测）；按会话**部分**：按模式 | `tests/mode_architecture_setup_test.py::test_channel_tools_only_reach_modes_the_channel_lands_in`：照 Windows 正式的 QQ 绑定（idea*→想法、proj*→项目、顶层账号没绑）算下来 learning 不发 `qqbot_*`，main / 想法 / 项目照发；四个模式都不发 `feishu_*`；账号全绑走时 main 也不发；后来把 QQ 接进学习模式，自动从 deny 拿掉、用户自己的 `browser` 不动；按群细分的绑定不算接走。**限制**：Windows 正式的面板会话在 main / 想法 / 项目模式里仍会看到 2 个 QQ 工具（同模式也接 QQ）。要做到按会话得改运行时核心，按规矩不做，报 B1-F1 |
| B1-2 | 单测过；真机没测 | 绑了渠道的模式 deny 里没有该渠道工具（同一条测试）。真发 QQ / 飞书消息要用用户的真实机器人账号，不碰 |
| B1-3 | **没过**（B1 单靠自己到不了 45） | 副本 main 模式题 9（`after-b1`，2 遍）：51 → **49** 个工具，工具说明 60092 → 57847 字。Windows 正式 main 估算 49 → 47。剩下的要靠 B2（按需加载） |

全量：`python -X utf8 -m unittest tests.mode_architecture_setup_test` 10 条，1 条错（`test_scaffolds_four_isolated_modes…`，找不到 `Library/Application Support/SuperPinkie/web-gpt-collab`，Mac 路径；不改代码时同样错，Windows 本来就红）。

## 报给 Fable 的另开项（这一轮不做）

- **A2-F1　网关刚起来时第一次 `memory_search corpus:"all"` 报 `index metadata is missing`**：运行时记忆管理器的身份状态初始为 `missing`，第一次同步前被调用就整个返回 `disabled`，还附一句「Tell the user… run openclaw memory index --force」——模型会照着跟用户说「记忆检索停用了」。修要动运行时（等首次同步完成再判，或首次调用时先读 meta），是运行时补丁，A2-2 的通过线因此没过。证据见 A2-2。

- **A7-F1　上游「出字前断流」原地快速重试**：`stopReason: error`、内容是 `[assistant turn failed before producing content]`、报错含 `EOF` / `Connection error` 时，同一模型在几秒内原地重试 1 次（不换模型、不加配置键），再不行才交给 watchdog。依据：副本 hy4free 断流 10 次占全部出错 83%，正式 9 次占 27%；现在平均要等约 90 秒才续接，还有漏接。没查：运行时自身有没有同模型重试的开关、插件钩子能不能做到这一步——这一项要 Fable 先定做不做、在哪一层做。
- **B1-F1　渠道工具按会话发**：面板会话和 QQ 会话共用想法 / 项目 / main 模式时，面板会话仍带 2 个 `qqbot_*`（Mac 上飞书同理带 13 个 `feishu_*`）。运行时没有改工具列表的插件钩子，要么给运行时打补丁（在工具策略里按会话的 `messageChannel` 过滤渠道插件的工具），要么让渠道走单独的模式（改绑定，是用户的配置）。这一轮只做了按模式。

## 待 Fable 写

- A6：证书报错的中文提示（暂用）：「这个网站的安全证书有问题（过期、不受信任或和网址对不上），浏览器没有打开它。可以试试把网址换成 http:// 开头，或者换一个来源找同样的内容。」
- A6：wait / serve 参数说明里加的两句（工具说明，模型看）——如要改口吻请定稿。
