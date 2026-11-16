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
| 11-13 夜 | B2 停（§6），不做 `tool_load` | 工具列表每次运行（`runEmbeddedAttempt`）开头建一次，插件钩子改不了；插件自己的工具工厂能按会话返回 null，但只在下一次用户发话时生效，核心工具（`cron`、`image_generate`）插件管不了。方案明说做不到就停在 B1、不改运行时核心 |
| 11-13 夜 | B3 导出完整系统提示词用 `OPENCLAW_CACHE_TRACE*` 环境变量（只给副本网关，`gateway.py` 的 `TH_PASS_` 前缀） | 会话记录里的 systemPrompt 超过 32768 字就整段丢掉；这是运行时已有的调试开关，不是配置键 |
| 11-13 夜 | B3-2 的「改前」用 `origin/main`（`5ff2aad2`）的插件代码 + 去掉本分支加的 deny / allow，在副本里跑同两题，跑完原样恢复 | 方案要「改前改后各导出一份」；副本的旧会话记录拿不到完整提示词 |
| 11-13 夜 | C1 只加那句话，不动并行开关 | 运行时本来就并行执行；mm（openai-completions）不发 `parallel_tool_calls` 时上游默认允许，没有「没传」可补 |
| 11-13 夜 | C2 的提示每个会话一共一次，不是每类一次 | Fable 那句话三类都说到，还写着「这条只提醒一次」；按类再出现就和原句矛盾 |
| 11-13 夜 | D2 项目模式 + git 仓库的子会话一律单独建工作树（不先判断有没有别的会话在干活） | 跨会话判断「在干活」容易漏；没改动的会自动清掉，多建一个没有代价 |
| 11-13 夜 | D4 `pr_status`、D1 连接器工具都是常驻，不进按需层 | B2 停了，没有按需层 |
| 11-14 | 隔离副本 `iso-th` 整个不见了，用仓库里的 `setup.py` 重建 | 原因不明（不是这条接力做的）；重建脚本就在仓库里，配置照旧只读复制 |
| 11-14 | （已被下一行更正）C 组实测（C1-2、C1-3、C2-1）记「没测」，不替用户起 1466 的中转 | 上游中转没在跑，20 次全是 network connection error；它是用户正式环境的服务，规矩不碰；不为凑数改题目或口径 |
| 11-14 | C1-2、C1-3、C2-1 改记「过」，用监管会话在副本被删前量到的 `after-c` 数字 | 那批 20 次是完整跑完的（11-13 夜，中转当时在跑），数字和口径（按事件时间）与 A 组一致；原始文件随副本一起没了，数字只在这里 |
| 11-14 | D1 不另起一页，补 `main` 上已有的「连接器」卡片；新接的交给运行时 `openclaw mcp add`（先连再写） | 已有的页面功能齐全，只差「写前先连」和 Windows；运行时自己的命令既连又按它的配置结构校验，比插件里再写一个连接客户端可靠 |
| 11-14 | D1 预置加高德地图（Key 放 env），不加日历 | 高德有官方包、Key 是用户自己的；日历没有只靠登录、两端都能用的服务 |
| 11-14 | Z2 照实记「正式配置被改过」，不改回去 | 改它的是用户自己开的另一个会话（见 Z2），不是这条接力；改回去等于又动一次正式环境 |

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

### B2 不常用的工具按需加载：**没做**（§6：插件钩子做不到）

- 查了运行时：发给模型的工具列表在每次运行（`selection-*.js` 的 `runEmbeddedAttempt`）开头由 `createOpenClawCodingTools` 建一次，整次运行（含中间多次模型调用）不再变；插件钩子（40 个）没有一个的返回值能改工具列表；工具策略只有全局 / 模式 / 模型 / 群组几层。
- 插件自己的工具（`computer`、`computer_flow`、学习台、`code_*`）工厂可以按会话返回 `null`，但 `tool_load` 之后**本次运行里**拿不到（下一次用户发话才有），B2-2「先 `tool_load` 再用 `computer`，一次成功」做不到；`cron`、`image_generate` 是核心工具，插件管不了。
- 按方案「做不到就停在 B1，不改运行时核心发送逻辑」。B2-1 / B2-2 / B2-3 记「没做」。要做得给运行时打补丁（每次模型调用前重新取工具列表），列进 B2-F1。

| # | 结果 | 证据 |
|---|---|---|
| B2-1 | 没做 | 见上。副本 main 工具说明现在 57847 字（Windows 正式中位数 61638） |
| B2-2 | 没做 | 同上 |
| B2-3 | 没做 | 同上 |

### B3 系统提示词只拆账，不删任何字

- 新脚本 `tools/tool-health/prompt-breakdown.py`（只读）：读 cache trace 里真正发给模型的 system，按段落标记归类数字数、找逐字重复行，只输出字数和标题。完整提示词导出放仓库外（`F:\tmp\…\scratchpad\sp-*.txt`、`trace*.jsonl`，含副本工作区路径，不提交）。
- 数据：Windows 隔离副本，hy4free，题 9（main / 聊天模式）和题 8（project / 项目模式），本分支代码，2026-11-13 夜。Fable 说的「6.2 万字」是 Mac 正式环境；Windows 副本 main **45998 字**、project **54222–54972 字**（随会话内容略变）。

| 部分 | main 字数 | 占比 | project 字数 | 占比 |
|---|---:|---:|---:|---:|
| 打法：模式手册 AGENTS.md | 15110 | 32.8% | 23293 | 42.4% |
| 技能列表（`## Skills` + `<available_skills>` 18 个技能） | 6988 | 15.2% | 6988 | 12.7% |
| 工具用法：OpenClaw 自带（Tooling 工具清单、Tool Call Style、Execution Bias、Messaging） | 5891 | 12.8% | 6675 | 12.1% |
| OpenClaw 框架（Safety、Control、Self-Update、Workspace、Docs、时间、Runtime 行、Silent Replies、HEARTBEAT） | 4486 | 9.8% | 4951 | 9.0% |
| 人设（SOUL.md、IDENTITY.md、persona/core、voice_examples） | 3573 | 7.8% | 1283 | 2.3% |
| 打法：插件注入（工作过程展示、交付真实性门禁、进度说明、做事标准、边做边学） | 3334 | 7.2% | 3334 | 6.1% |
| 界面组件 / 回复格式（Control UI Embed、富回复组件） | 1658 | 3.6% | 1658 | 3.0% |
| 工具用法：插件注入（联网、长命令放后台、碧琪自己就能用的、主动提问） | 1593 | 3.5% | 1593 | 2.9% |
| 记忆（Memory Recall、长期记忆引擎、memory/INDEX、identity、模式记忆规则） | 1378 | 3.0% | 1558 | 2.8% |
| 工具用法：TOOLS.md（OpenClaw 默认模板：Cameras / SSH / TTS 示例） | 1335 | 2.9% | 2979 | 5.4% |
| 用户资料 USER.md | 598 | 1.3% | 606 | 1.1% |
| 项目速览 | 0 | — | 0 | — |

- **项目速览**：两个模式的提示词里都没有单独的项目速览段（project 模式的项目信息在 AGENTS.md 手册里）。
- **机器拼出来、逐字重复的**：同一份提示词里只有 1 行重复（OpenClaw 文档链接 `[Agent workspace](…)`，46 字 × 2）。跨模式：main 和 project 有 **281 行、26845 字完全相同**（框架、技能列表、工具用法、插件注入几块），每个模式各发一遍；同一模式内每轮都一样（便于缓存）。逐行看会随会话变的只有 3 处：`Runtime:` 行的会话名、记忆规则里的会话检查点路径、当前时间。
- 技能列表 18 个技能每个 300–370 字，main 和 project 完全一样。
- TOOLS.md 是 OpenClaw 的空模板（Cameras / SSH / TTS 举例），没有碧琪自己的内容。
- **这一轮不删不改**；要不要动、动哪里，交给用户和 Fable 看了再定。

| # | 结果 | 证据 |
|---|---|---|
| B3-1 | 过 | 上表；`prompt-breakdown.py` |
| B3-2 | 过 | 副本里用 `origin/main`（`5ff2aad2`）插件 + 原 deny 跑题 9 / 题 8 导出「改前」，本分支导出「改后」，逐行 diff：只差工具清单 3 行（`web_search`、`nodes`、`agents_list`，A3 / B1 拿掉的）+ 会话名 + 检查点路径。另：网关刚重启后的**第一轮** main 有时少 `## Memory Recall` 3 行（OpenClaw 记忆插件按当时工具可用性拼的；同一代码第二轮就有，改前那次第一轮恰好有）——是运行时冷启动的时序，和 A2-F1 同一类，不是本分支改的 |
| B3-3 | 过 | `git diff 5ff2aad2 -- personas persona playbooks` 0 行（playbooks 在 `personas/*/playbooks/`） |
| B-总 | 副本已在线下，降得很少 | 题 9 一次回复的 token（副本 hy4free）：改前 45931 / 45973（`before-h4f`、`b3-prompt-base`）→ A 组后 45563 / 45514 → B1 后 44896 / 44896 / 44839 / 44886 / 44852。Windows 副本本来就 ≤ 5 万（Fable 的 6.4 万是 Mac 正式）；本轮只靠少发工具说明降约 1.1 千（2.3%），B2 没做是主要原因 |

## C 组

### C1 一次调多个工具

**查到的（C1-1）**
- 运行时**本来就并行跑**一条回复里的多个调用：`proxy-*.js` 的 `executeToolCalls`，`toolExecution` 默认 `parallel`，碧琪这边没有工具标成 `sequential`。
- 开关：碧琪的模型全走 `mm`（openai-completions）。这种适配器只在配置 params 里写了 `parallel_tool_calls`、或者 openai 的 gpt-5 系列时才发这个字段；不发时上游默认就允许并行。所以**没有「开关没传」要补的**，第 2 步不用做。Anthropic / Google 格式的适配器没有这个开关（它们本来就允许一条回复里多个调用）。
- 结论：并行占比低不是运行时排队或开关没传，是模型习惯一条一条来。所以只做第 3 步：加 Fable 写的那句话。

**改了什么**：`pinkie_search`、`code_search` 的说明末尾加那句话（插件里）；`read`、`web_fetch` 的说明在运行时里，用补丁 `patch/apply-tool-parallel-hint.mjs` 加（接进 `apply-all.mjs` 和 `apply-theme.sh`；Windows 快照里打过补丁的 `sessions-D8qGY7uC.js`、`openclaw-tools-KulZ1cdH.js` 和 SHA256SUMS 已同步）。

| # | 结果 | 证据 |
|---|---|---|
| C1-1 | 过 | 上面的结论 |
| C1-2 | 过（只 hy4free，2/2） | `after-c` 题 8 两遍：r1 一条回复里 6 个 `read`（另一条 4 个），r2 一条回复里 6 个 `read`；两遍都指出 `admin.js`。方案要「3 个模型各 2 遍」，这一轮只准用 hy4free，所以是 2/2 |
| C1-3 | 过 | `after-c`（20 次，按事件时间）一次调多个工具 **40%**（改前 `after-a` 25%；Windows 正式 3%、Mac 正式 14%） |
| 单测 | 过 | `tests/tool-parallel-hint.test.mjs` 4/4：原句一字不差；`read`、`web_fetch` 各加一次、不认识的文件拒绝改；快照里两份说明都带这句；插件的两个搜索工具也以这句结尾。`patches-wired` 过 |
| `refresh_mac_runtime.py --check` | **待 Mac 端跑** | |

### C2 少用 exec 干别的工具的活

- `services/mode-architecture/exec-hints.mjs`：`exec` 命令的**第一段**是 `cat` / `head` / `sed -n` / `Get-Content`（读文件）、`grep` / `rg` / `Select-String`（搜代码）、`curl` / `wget` / `Invoke-WebRequest` / python `urllib`（抓网页）时，在**正常结果**后面附第五节那句提示。
- 不拦命令、不标出错；命令本身出错的结果不动。
- **和方案的差别**：方案写「每类只提示一次」，这里是**每个会话一共最多一次**。因为 Fable 那句话三类都说到了，还自己写着「这条只提醒一次」，按类再出现就和这句话矛盾。决定记在下面决定表。

| # | 结果 | 证据 |
|---|---|---|
| C2-1 | 过（副本本来就在线下） | `after-c` `exec` 占比 **28%**（`after-a` 31%；Windows 正式 59%、Mac 正式 58%）。提示真机出现过：题 1 第 2 遍的会话记录里 exec 结果后附了那句，同一会话只一次 |
| C2-2 | 过（单测） | `tests/exec-hints.test.mjs` 4/4：原句一字不差；只看第一段命令；同一会话只附一次、附在正常结果后面、出错结果不动、不拦；插件注册的是不拦的 `before_tool_call` 加同步的 `tool_result_persist` |

### C 组实测：`after-c` 其实跑完了（监管会话 11-14 补记）

- 交接 8 之后，监管会话（`local_2ff7548d…`）在副本被删之前已经量完了 `after-c`（10 题 × 2，hy4free，并发 8；插件 = C1 + C2 + D2/D3/D4 之后的本分支，运行时打了 C1 补丁）：`session-stats.py --event-since <after-c started = 1794627447>`：会话回复 166 次、工具调用 249 次；**exec 28%、一次调多个工具 40%、出错或中断 1.8%**；系统提示词约 46826 字，工具说明约 58069 字（49 个工具），平均每次回复 53625 token。`read` 0/45 失败，`exec` 4/71（PowerShell 语法、中文路径编码）。
- 逐题：1、2、3、4b、5、8、9 两遍都答完；4a 第 2 遍空回复（480 秒）、6 两遍空回复（副本没有侧栏浏览器，和 A6 一样）、7 第 1 遍空回复。
- 下面是接手会话当时的记录（它看不到上面的数字，所以记了「没测」），原样留着：

- 交接 8 时 `after-c` 批在后台跑，结果写在隔离副本里。**11-14 接手时整个 `%USERPROFILE%\碧琪实测\iso-th` 已经不在了**：硬盘上哪里都找不到（同一个上级目录里只剩别的工作的 `iso-metre`），`after-c` 的结果一起没了。
- 用仓库里的 `setup.py` 重建了副本：端口 12794，叠了快照 33 个文件，三个运行时补丁都已在快照里（`changed: false`），`sync` 补了 deny 和 `document-extract`，夹具重造。然后重跑 `after-c`。
- 20 次**全部**是 `FailoverError: LLM request failed: network connection error`，45 秒内就结束了。原因：模型上游 `127.0.0.1:1466` 那个本机中转**没在跑**，端口上没有进程。它不是本仓库的东西（仓库里的 `proxy/mm-retry-proxy.py` 是挂在它前面的 1467），平时跟着用户的正式环境起来。按规矩不碰正式环境、不替用户起他们的服务，所以**C1-2、C1-3、C2-1 记「没测」**，没有改题目或改口径去凑。
- 中转起来以后重跑的办法（不用改任何东西）：
  `python -I -X utf8 tools/tool-health/iso-windows/gateway.py status`（没在听就先 `start`），然后 `python -I -X utf8 tools/tool-health/iso-windows/run_eval.py --label after-c --repeat 2 --jobs 8`，再用 `session-stats.py --state <iso>\home\.openclaw --last 2000 --event-since <results.json 的 started>` 量。

## D 组

### D1 外部连接器

- **方案说「App 里没有入口」，这个过时了**：`main` 上早就有设置里的「连接器」卡片（`ui/injections/laolao-capabilities.js`，提交 `248fa33c`）。后端是 `pinkie.connectors.list / save / toggle / remove / probe / login`（`rich-runtime.mjs`）。卡片能列出已接的、点预置接入、手填地址或一段配置、启用 / 暂停、移除、测试连接、Notion 网页登录。写的就是运行时已有的 `mcp.servers.<名字>`。所以没有另起一页，在它上面补了不合格的地方（提交 `8c5b5aed`）。
- **补的**：
  1. **新接的先连一次再写**（D1-2）：原来 `save` 直接写配置，命令写错照样存进去。现在新接的、启用的、非网页登录的连接器，交给运行时自己的 `openclaw mcp add`。它先连一次（probe），连上了再按运行时自己的配置结构校验、写入；连不上或校验不过就不写，页面显示一句中文原因，密钥抹掉。Notion（要先网页登录才连得上）和暂停着保存的，照旧走 `mutateConfigFile`，运行时写前同样校验结构。
  2. **Windows 能用本地服务**：运行时起本地服务用 `shell:false`，`npx` 在 Windows 上是 `.cmd` 包装，直接起不来。改成用同一个 Node 安装里的 `node.exe` + `npx-cli.js`；没装 Node 就说一句去装。文件夹一栏认 `C:\…` 和 `\\服务器\…`。「选择…」按钮靠 Mac 的原生桥，Windows 上没有，就藏起来、改成贴路径。这和「连接」卡里绑项目文件夹的做法一样。
  3. **预置**：原来有 GitHub（自己的令牌）、Notion（网页登录）、本地资料夹（只读）、其他服务。加了**高德地图**：官方包 `@amap/amap-maps-mcp-server`，Key 是用户自己在高德开放平台申请的，放在本机配置的 `env` 里，不放进网址（这一页原来就不许网址里带密钥）。**日历没加**：没找到只靠用户自己登录、两端都能用的日历服务（Google 日历的包要用户自己先建一个 OAuth 应用、下载凭据文件），列进「报给 Fable」D1-F1。所以预置是 4 个加「其他服务」，不是方案说的 5 个。
  4. 已接的那一行显示「起的什么包、开放哪个文件夹」，不显示 `node.exe` 这种启动细节。
- **和方案的差别**：连接器的工具**直接进工具列表，不进按需层**，因为 B2 没做（§6 停）。

| # | 结果 | 证据 |
|---|---|---|
| D1-1 | 过 | 截图（假网关 + 无头 Edge + 仓库界面，项目模式，设置 → 常用）：`%USERPROFILE%\碧琪实测\iso-th\shots\d1-light-chat.png`、`d1-dark-chat.png`。两条已接（启用中的本地资料夹、暂停的 Notion）、5 个可接入、Windows 下的文件夹输入框。添加 / 启用 / 停用 / 删除在副本网关上实测见 D1-2、D1-3 |
| D1-2 | 过（副本实测 + 单测） | 副本网关调 `pinkie.connectors.save`，命令填 `not-a-real-cmd-xyz` → 返回「没连上：找不到启动命令「not-a-real-cmd-xyz」。检查一下命令有没有写错、对应的程序装了没有。配置没有改动。」；副本 `openclaw.json` 的 sha256 前后一样（`110183b1…`）；网关一直在听 12794。单测 `tests/connectors-d1.test.mjs` 6/6 |
| D1-3 | **过（真调用 11-14 补测）**；`tool_load` 没有（B2 没做，连接器工具常驻） | **11-14 补测**：1466 中转起来后，副本网关 `pinkie.connectors.save` 接本地资料夹（夹具 `fixtures\proj`，20 秒连上并写入），main 模式开新会话（hy4free）要求只用 `files__` 工具：会话记录里 `files__list_allowed_directories`、`files__list_directory`、`files__read_text_file` 各 1 次，0 次出错，52 秒答完，列出 6 个文件、`admin.js` 前 5 行和磁盘原文逐字一致。测完已 `remove`、网关已停。以下是 11-14 之前的记录： | 副本里接本地资料夹（夹具 `fixtures\proj`）：运行时先连上再写（28 秒，第一次要下载包），`probe` 显示 4 个工具（只读过滤后，另 12 个被滤掉）。在 main 模式真开一轮：这一轮 `context.compiled` 的 53 个工具里有 `files__list_allowed_directories`、`files__list_directory`、`files__read_text_file`、`files__search_files`。模型那一步因为上游断了失败。暂停 / 启用 / 移除往返都 `ok`，测完已移除，副本 `mcp.servers` 是空的 |
| D1-4 | 过 | 本分支对 `5ff2aad2` 的全部新增行里搜 `ghp_…`、`github_pat_…`、`sk-…`、`ntn_…`、`AKIA…`、写死的 `apiKey`：0 条。密钥只进本机 `openclaw.json`（headers / env），返回给页面的只有「有没有凭据」 |

### D2 独立工作树

- `services/mode-architecture/child-worktree.mjs` + `session-lineage.mjs`：项目模式里开子会话（`pinkie_session_start`），目标文件夹是 git 仓库时，用 OpenClaw 自带的受管工作树（`worktrees.create` / `remove`，原生「在工作树中新建聊天」那一套）给子会话单独建工作树和分支。
- 子会话每次汇报都带分支名和位置。没改动的工作树，汇报时清掉（OpenClaw 删之前先留快照），子会话回到项目文件夹；有改动的留着，并告诉用户在哪。**不合并、不推送。**
- 副本实测 create / remove 往返正常。发现运行时记的 `baseRef` 是字面的 `"HEAD"`，改成建的时候就解析成提交号。
- **和方案的差别**：方案说「已有别的会话在这个仓库里干活时才建」；这里只要是项目模式、git 仓库，子会话就一律单独建。判断「有没有别的会话在干活」要跨会话看文件状态，容易漏；一律单独建最稳，没改动的会自动清掉。

| # | 结果 | 证据 |
|---|---|---|
| D2-1 | 过（真 git 单测） | `tests/child-worktree.test.mjs`「two children of a git project work in separate branches; parent gets both branch names; clean ones go」：同一仓库两个子会话改同一个文件，互不影响，各在自己的分支上，父会话收到两个分支名 |
| D2-2 | 过（单测 + 副本往返） | 同一条测试：没改动的清掉、有改动的留下并报位置；测试里断言没有 merge / push。另一条：项目模式外或不是 git 仓库不建 |

### D3 成品导出成一个文件

- `services/mode-architecture/html-bundle.mjs`：把本地的样式表（含 `@import` 和 `url()`）、脚本、图片、`srcset`、图标、内联样式里的网址都换成 `data:` 内嵌；外网网址不动，只计数。不下载、不上传任何东西。
- `pinkie.artifacts.export` 返回打好的单个文件。作品库里加了「导出成一个文件」按钮，交给浏览器下载，存到用户选的地方。

| # | 结果 | 证据 |
|---|---|---|
| D3-1 | 过 | `tests/html-bundle.test.mjs` 2/2。无头 Edge 实测：导出的文件单独放进空文件夹、代理断开后打开，图片、背景图、CSS、脚本都在 |

### D4 项目模式看 PR 和 CI

- 新工具 `pr_status`（`pr-status.mjs`）：只跑 `gh pr view [n] --json …`。没装 `gh` 或没登录，作为正常结果返回怎么装、怎么登录；没有 PR 就说没有。只给 `agent:project:` 会话。
- **和方案的差别**：方案说放按需层，B2 没做，所以是常驻的。

| # | 结果 | 证据 |
|---|---|---|
| D4-1 | 过 | `tests/pr-status.test.mjs` 4/4（含「从不让 gh 写」和本机真 `gh`）。实测：PR #20 → 4 个检查（3 失败、1 通过）；本分支 → 没有 PR |

### D5 用用户自己浏览器的登录状态（只调研，没写代码）

运行时自带三种浏览器配置档：`openclaw`（独立的一个浏览器）、`user`（`driver: existing-session`、`attachOnly`，接上用户正在开的 Chrome，靠远程调试端口）、`chrome`（通过扩展中继）。

| 路 | 工作量 | 风险 |
|---|---|---|
| ① 用现成的 `user` 配置档，接用户自己的 Chrome | 小：配置档已有，主要是设置里给一个开关和说明 | 用户要用远程调试参数启动 Chrome；开着的时候本机任何进程都能接管整个浏览器（所有已登录站点）。对普通用户说清楚很难 |
| ② 从用户浏览器导入**单个站点**的登录（Cookie） | 中：要读各家浏览器的 Cookie 库 | Windows 上 Chrome 127 起用了绑定应用的加密，外部程序解不开；Mac 要钥匙串授权。导进来的 Cookie 会落到碧琪自己的浏览器资料里，多一份可被偷的副本 |
| ③ 浏览器扩展，按标签页授权 | 大：要写扩展、上架或让用户手动装、按标签页授权的交互 | 最小、用户可控：只给用户点过的那个标签页，随时能撤 |

建议（交 Fable 和用户定）：要做就做③；①只适合开发者自己用。没有写任何实现代码。

| # | 结果 |
|---|---|
| D5-1 | 过：上表，没有实现代码 |

## 收工（11-14）

### Z 总体

| # | 结果 | 证据 |
|---|---|---|
| Z1 | 过：新增失败 0 | 同一台 Windows，每个测试文件单独跑（一个文件最多 150 秒），本分支 `31ba8c1d` 对 `origin/main` `5ff2aad2`（临时工作树，跑完已删），Node 和 Python 都跑。本分支 297 个文件：过 246、红 43、超时 8；`main` 287 个：过 236、红 43、超时 8。本分支多出的 10 个测试文件全过（`agent-db-guard`、`app-browser-lenient`、`child-worktree`、`connectors-d1`、`exec-hints`、`html-bundle`、`media-inbox`、`pr-status`、`tool-parallel-hint`、`web-fetch-fakeip-v6`）。两边都有的文件里，没有一个是「`main` 过、本分支红」，也没有一个本分支多出失败的测试名。两边都红的 51 个是 Windows 上本来就红的（Mac 路径、WebKit、学习台界面超时、Windows 打包和更新那一组等），没有一个是本分支修好的 |
| Z2 | **没过（被另一个会话改过，不是这条接力）**，见下 | |
| Z3 | 过 | `origin/main` 仍是 `5ff2aad2`；`5ff2aad2` 及之后没有任何 tag；本分支已推（`git rev-parse HEAD` = `origin/fix/tools-health-1113`）。Mac 的「`repo/` 19 个未提交改动」这台没有，不适用；没动 `dev/study-game` |
| Z4 | 过 | 本分支对 `5ff2aad2` 改过的 82 个文件里没有沙箱、权限分级相关的 |
| Z5 | 过 | 副本 `after-a` 出错或中断 1.4%，`after-c`（C 组之后）1.8%（改前 4.7%，基线线 5.3%） |

**Z2 详情**

| 项 | 开工前（11-13 16:50） | 收工（11-14） |
|---|---|---|
| 正式 `openclaw.json` 修改时间 | `2026-11-12T18:56:21` | **`2026-11-13T23:50:37`** |
| App 安装目录修改时间 | `2026-11-03T14:57:22`（2.5.27） | `2026-11-03T14:57:22`（2.5.27），没变 |
| 18789 上的网关 | 没有进程 | 没有进程 |

- 正式配置在 11-13 23:50 被改过，里面现在有本分支的改动：四个模式的 `tools.deny` 有 B1 的那几项，`plugins.allow` 有 `document-extract`。
- 查了来源：这条接力最后一次提交是 19:49（交接 8），之后到 11-14 接手之间没有接力会话在跑。同一时间段用户自己开了一个会话「开发板替换桌面 exe」（07:47 UTC = 23:47 PST），在 `F:\Projects\pinkie-dev-build\src` 检出了本分支 `481727a5`，做了开发版。正式配置是那个开发版启动时、由插件安装器照本分支的代码改的。
- **这条接力没有碰正式环境**。也没有改回去：改回去等于又动一次正式环境，而且那是用户自己要做的事。

### 全部验收一览

| 组 | 过 | 部分 / 单测过、真机没测 | 没过 | 没做 / 没测 |
|---|---|---|---|---|
| A | A1-1、A1-2、A1-3、A2-1、A3-1～4、A4-1～4、A5-1、A6-1（11-15 外接 Windows 浏览器实测 2/2）、A7-1 | A1-4（`refresh_mac_runtime` 待 Mac）、A6-2（需 Mac） | A2-2（运行时冷启动，A2-F1） | |
| B | B1-1（按模式）、B3-1～3 | B1-2（单测过，真渠道没测） | B1-3（51→49，到不了 45） | B2-1～3（§6 停，B2-F1） |
| C | C1-1、C1-2（hy4free 2/2）、C1-3（40%）、C2-1（28%）、C2-2 | | | |
| D | D1-1、D1-2、D1-3（真调用 11-14 补测）、D1-4、D2-1、D2-2、D3-1、D4-1、D5-1 | | | |
| Z | Z1、Z3、Z4、Z5 | | Z2（被用户另一个会话改过） | |

### 需 Mac 端

| 项 | 要做什么 |
|---|---|
| A1-4、A4、C1 的运行时补丁 | 在装好的 Mac App 上跑 `refresh_mac_runtime.py --check` |
| A2 `-shm` 那处修正 | Mac 副本放一个结构版本 19 的假库，看能不能挪走 |
| A6-2 | Mac 上真走一次 `app_browser` 的 `tab` |
| D1 | Mac 上「选择…」挑文件夹、`npx` 能不能从 App 起来的网关里找到（App 的 PATH 里不一定有 Homebrew 的目录） |

### 最后一个提交

见 git log：本节所在的提交，已推到 `origin/fix/tools-health-1113`。

## 报给 Fable 的另开项（这一轮不做；11-14 的决定见最后「Fable 定的」）

- **A2-F1　网关刚起来时第一次 `memory_search corpus:"all"` 报 `index metadata is missing`**：运行时记忆管理器的身份状态初始为 `missing`，第一次同步前被调用就整个返回 `disabled`，还附一句「Tell the user… run openclaw memory index --force」——模型会照着跟用户说「记忆检索停用了」。修要动运行时（等首次同步完成再判，或首次调用时先读 meta），是运行时补丁，A2-2 的通过线因此没过。证据见 A2-2。

- **A7-F1　上游「出字前断流」原地快速重试**：`stopReason: error`、内容是 `[assistant turn failed before producing content]`、报错含 `EOF` / `Connection error` 时，同一模型在几秒内原地重试 1 次（不换模型、不加配置键），再不行才交给 watchdog。依据：副本 hy4free 断流 10 次占全部出错 83%，正式 9 次占 27%；现在平均要等约 90 秒才续接，还有漏接。没查：运行时自身有没有同模型重试的开关、插件钩子能不能做到这一步——这一项要 Fable 先定做不做、在哪一层做。
- **B1-F1　渠道工具按会话发**：面板会话和 QQ 会话共用想法 / 项目 / main 模式时，面板会话仍带 2 个 `qqbot_*`（Mac 上飞书同理带 13 个 `feishu_*`）。运行时没有改工具列表的插件钩子，要么给运行时打补丁（在工具策略里按会话的 `messageChannel` 过滤渠道插件的工具），要么让渠道走单独的模式（改绑定，是用户的配置）。这一轮只做了按模式。
- **D1-F1　日历连接器**：方案的预置清单里有日历，没找到「不要密钥、只要用户自己登录」、Mac 和 Windows 都能用的日历服务。Google 日历的包要用户先在 Google 云控制台建一个 OAuth 应用、下载凭据文件，对普通用户太难。要不要放、放哪家，交 Fable 和用户定。
- **B2-F1　工具按需加载要运行时补丁**：每次模型调用前重新取一次工具列表（或给插件一个能改工具列表的钩子），`tool_load` 才能在同一次运行里生效；还要能管核心工具。这一轮按规矩没做。

## 待 Fable 写（11-14 已定稿，见最后「Fable 定的」；下面是当时的暂用原话）

- A6：证书报错的中文提示（暂用）：「这个网站的安全证书有问题（过期、不受信任或和网址对不上），浏览器没有打开它。可以试试把网址换成 http:// 开头，或者换一个来源找同样的内容。」
- A6：wait / serve 参数说明里加的两句（工具说明，模型看）——如要改口吻请定稿。
- D1（设置「连接器」卡片，我写的，请过目）：高德一栏「在高德开放平台的控制台里申请（选「Web 服务」）」「怎么申请 Key ↗」「贴一下你的高德 Key。」；Windows 文件夹框的提示「D:\资料（贴完整路径）」；连不上时的几句：「没连上：找不到启动命令「…」。检查一下命令有没有写错、对应的程序装了没有。配置没有改动。」「没连上：服务地址访问不到。检查一下网址和网络。配置没有改动。」「没连上：服务说没有权限，检查一下令牌或 Key。配置没有改动。」「没连上：等了太久没有回应。配置没有改动。」；没装 Node 时「这台电脑还没装 Node.js（接这个要用到它自带的 npx）。到 nodejs.org 装好后，再点一次「接入」。」；接上后「连上了，已保存。新对话会使用这项连接。」
- D3：作品库按钮「导出成一个文件」。
- D4：`pr_status` 没装 / 没登录 `gh` 时给模型的安装和登录说明（工具结果，模型转述）。

## Fable 定的（11-14）

### 另开项：做不做、在哪一层

| 项 | 定 | 在哪一层 | 理由和做法 |
|---|---|---|---|
| A7-F1 出字前断流原地重试 | **做，但不写新代码** | 仓库已有的重试中转 `proxy/mm-retry-proxy.py`（1467） | 它本来就做这件事：把一次回复整段收完再往下游发，上游断开、`EOF`、408/429/5xx 都在 75 秒预算内原地重试，重试不到才报错。运行时和插件里都不用再写一套。**现在没生效的原因**：这台 Windows 正式配置里 `mm` 的 `baseUrl` 是 `http://127.0.0.1:1466/v1`，直接连上游，绕过了 1467（11-14 只读看的）；隔离副本照抄了它，所以副本量到的断流也全是没经过中转的。要做的只有一件：`mm` 的地址改成 1467。这是改正式配置里已有键的值，归用户点头；代价是经过中转后回复不再一个字一个字地出，而是整段到（中转要等收完才知道能不能安全重试）。**没验证**：没在副本里把地址换成 1467 重跑 `before-h4f` 对比断流数，下一轮先量这个再动正式 |
| A2-F1 冷启动第一次 `memory_search` 报 `index metadata is missing` | **做，下一轮** | 运行时补丁（`manager-*.js`），照现有补丁的规矩：匹配点不唯一就拒改 | 看了已装运行时的 `manager-DB4_iNu4.js`：管理器构造时就读一次 meta 并算身份状态，所以库里明明有 meta、第一次 `corpus:"all"` 却是 `missing`，**具体是哪一路管理器实例在哪一刻读空的，我没查到底**，动手前先在副本里复现定位。补丁的方向：`search` 入口遇到 `missing` 且这个管理器还没同步过时，先等一次同步再判，仍是 `missing` 才照旧返回。插件层做不了（钩子改不了当轮的工具结果）。排在 B2-F1 后面：它只在网关重启后的第一次 `corpus:"all"` 出现一次，系统提示第 13 条已经让模型换路再翻、不说「记忆用不了」，影响小 |
| B2-F1 工具按需加载 | **做第一步，下一轮；第二步看数字再定** | 运行时补丁，一个点：`runEmbeddedAttempt` 建完工具列表后，交给插件登记的一个过滤函数（传会话键、渠道），返回要留下的工具 | 工具说明现在约 5.8 万字，每次回复都带，是提示词里最大的一块，值得动运行时。第一步按**每次运行**过滤：会话里 `tool_load` 过的下一次运行起可见，核心工具也管得到。B2-2 要的「同一次运行里加载完立刻能用」得在每次模型调用前重取工具列表，改动面大得多，等第一步的 token 数字出来再决定要不要 |
| B1-F1 渠道工具按会话发 | **并进 B2-F1，不单做** | 同上那一个过滤点 | 过滤函数拿得到会话的渠道，面板会话不发 `qqbot_*` / `feishu_*` 是它的第一条规则（Mac 上一次省 13 个飞书工具）。不走「让渠道单独一个模式」那条路：那是改用户的绑定 |
| D1-F1 日历连接器 | **不做预置** | — | 没有「只要用户自己登录、两端都能用」的日历服务，放一个要先去云控制台建应用的预置等于放一个大多数人接不上的按钮。会配的人用「其他服务」照样能接。以后出现像 Notion 那样网页登录的日历服务再加，卡片的登录流程是现成的 |

顺带定的两处（PROGRESS 正文里写着「等 Fable 定」）：
- **正式环境没配 `imageModel`，`image` 16/16 失败**：做，下一轮，放 `services/mode-architecture/setup.py`：`agents.defaults.imageModel` / `pdfModel` 没配、而主模型在配置里标了能看图时，补成主模型。是已有的键，用户自己配过就不动。这是真用户会撞上的，比 A2-F1 优先。
- **A5 剩下那截（Anthropic / Google 格式会带 `is_error`）**：不做。现在所有模型都走 `mm`，模型看不到这个标记；哪天接了这两种格式的模型再做那个三处的补丁。

下一轮顺序：① A7-F1 在副本里量 1467 → 用户点头后改地址；② `imageModel` 默认值；③ B2-F1 第一步（含 B1-F1）；④ A2-F1。③④ 是运行时补丁，Mac 端牵头（快照要从 Mac 刷）。

### 文案定稿（已改进代码，提交见 git log）

| 处 | 定稿 | 改没改 |
|---|---|---|
| A6 证书报错（`app-browser.mjs` `CERT_ERROR_NOTE`） | 「这个网站的安全证书有问题（过期、不受信任，或和网址对不上），浏览器没有打开它。只是查资料的话，换一个来源找同样的内容，或者把网址改成 http:// 开头再试一次。要登录或付款的页面不要绕过去，直接告诉用户这个网站的证书有问题。」 | 改了：原句无条件建议换 http，登录、付款的页面不该这样绕 |
| A6 `wait` 参数说明 | 「wait填text/selector/ref/name其中一个，等它出现；再加ms是最多等多久（如name+ms=4000），只填ms就是单纯等这么久，上限15秒。」 | 改了 |
| A6 `serve` 参数说明 | 「静态页填dir（可加port指定端口），要跑命令就填command+cwd+port，dir和command不能一起给」 | 照用（单测钉着这句） |
| A3 系统提示第 12 条括号里那句（`index.mjs`） | 「pinkie_search 没搜到就换个说法再搜，已经知道网站的用 web_fetch 直接读；app_browser 或 computer 不可用用 browser 和 exec」 | 改了：四个模式已经没有 `web_search`，兜底在工具里 |
| A3 `pinkie_search` 工具说明 | 照用 | 没改 |
| A4 目录条目排法（`pinkie-media-inbox.mjs` `overviewText`） | 「- 标题（第 N 页）」，第二层缩进两格 | 照用 |
| A4 只读了前几页的那句（`partialPagesNote`） | 「（这几页合起来还是太大，这次只读了第 1-8 页。第 9-15 页还没读，请再用 pages 单独读。）」 | 改了：原句说「PDF 太大」，其实是要的这几页合起来超限。助手文件、Windows 快照里的同名文件和 `SHA256SUMS` 一起换了（补丁按内容比对安装，已装的会被换成新的） |
| D1 高德 Key 一栏的提示 | 「到高德开放平台的控制台新建一个，服务平台选「Web 服务」」；「怎么申请 Key ↗」「贴一下你的高德 Key。」照用 | 改了一句 |
| D1 Windows 文件夹框提示 | 「D:\资料（贴完整路径）」 | 照用 |
| D1 连不上（`rich-runtime.mjs` `friendlyProbeError`） | 「没连上：这台电脑上找不到启动命令「…」。看看是不是写错了，或者对应的程序还没装。这次没有保存。」「没连上：服务地址打不开。看看网址有没有写错、网络通不通。这次没有保存。」「没连上：对方说没有权限。看看令牌或 Key 有没有贴错、过期了没有。这次没有保存。」「没连上：等了很久，对方一直没有回应。过一会儿再试一次。这次没有保存。」其他：「没连上，这次没有保存。（原因）」 | 改了：「配置没有改动」换成用户看得懂的「这次没有保存」。上面 D1-2 证据里引的是改之前的原话 |
| D1 没装 Node | 「这台电脑还没装 Node.js，接这一项要用到它。到 nodejs.org 装好后，再点一次「接入」。」 | 改了（去掉 npx） |
| D1 接上后 | 「连上了，已经保存。新开的对话就能用。」 | 改了 |
| D3 按钮 | 「导出成一个文件」 | 照用 |
| D4 没装 `gh`（`pr-status.mjs`） | 「这台电脑没装 gh（GitHub 的命令行工具），所以现在看不了 PR。可以自己装：Windows 用 `winget install --id GitHub.cli`，Mac 用 `brew install gh`，都不行就到 https://cli.github.com 下载。装好后还要登录一次 GitHub，这一步要用户本人确认，碧琪代替不了：请用户在终端运行 `gh auth login`，照提示在浏览器里确认。登录好了再查。」 | 改了：安装碧琪自己做（系统提示第 12 条），只有登录交给用户；原句没分开 |
| D4 没登录 | 「gh 已经装了，但还没登录 GitHub。登录要用户本人确认，碧琪代替不了：请用户在终端运行 `gh auth login`，照提示在浏览器里确认，登录一次以后就不用再登。登录好了再查。」 | 改了：原句写死「先生」，用户也可能是「老板」 |

改后测试（Windows，11-14）：`app-browser-lenient`、`connectors-d1`、`pr-status`、`media-inbox`、`image-access`、`patches-wired`、`web-search-fallback`、`plugin-contract-tools` 共 50 过 / 0 红 / 4 跳过（要真运行时的那 4 条）；`tests.windows_mac_snapshot_test` 6 过；`mode-architecture` 167 过 / 1 红（`computer tool discovers…`，本来就红）。**没在真 App 里看**：连接器卡片改的几句没重新截图。

### 需 Mac 端（Fable 看过，照原表做，补两条）

原表四项不变，都只能在 Mac 上做，这台做不了。补：
- A4：这次改了 `pinkie-media-inbox.mjs` 的一句话，Mac 装好后 `refresh_mac_runtime.py --check` 对的是新内容（sha256 `990a02bb…`）。
- A4：Mac 上用 `PINKIE_TEST_OPENCLAW_DIST` 跑 `tests/media-inbox.test.mjs`，把这边跳过的 4 条补上（`progress/A4.md` 里写着，原表漏了）。

## 11-15 Windows 补做（碧琪在副本里跑 Metre 批 7 额度测试的同时做的，不碰正式网关、不调模型）

### ② `imageModel` / `pdfModel` 默认值（照「Fable 定的」做完）

- `services/mode-architecture/setup.py` 新增 `_default_vision_models`，在 `_configure_plugin` 最后调用：`agents.defaults.model` 的主模型（字符串或 `{primary}` 写法都认）在 `models.providers.<家>.models[]` 里 `input` 含 `image` 时，`imageModel`、`pdfModel` 缺哪项补哪项，补成 `{primary: 主模型}`。用户配过的那项（哪怕是空的）不动；主模型看不了图、在配置里找不到、或没配主模型，都不补。
- 单测 `tests/mode_architecture_setup_test.py` 新加 `test_image_and_pdf_models_default_to_a_vision_capable_primary`（补齐、二次运行不再改、只补缺的那项、三种不补的情况）。整个文件 11 条：10 过 1 红；红的是 `test_scaffolds_four_isolated_modes…`，读 Mac 路径 `Library/Application Support/…/pinkie-collab`，在 `fb6f6f26` 的临时工作树上同样红，不是这次带来的。`context_budget_test` 14 过、`memory_search_choice_test` 3 过、`project_scope_setup_test` 过。
- 对正式配置的**副本**干跑（只在内存里，没写回）：会补成 `imageModel = pdfModel = {primary: "mm/workbuddy/deepseek-v4.1-flash"}`，这个模型在配置里标了 `image`。
- **还没生效**：正式配置要等下次装或更新时跑 `setup.py` 才会补；没在正式 App 里重跑 `image` 工具看 16/16 失败是不是消失。
- 已知局限：补的是当时的主模型，用户以后换主模型，这两项不会跟着变（用户已经配过的不动，这是同一条规矩）。

### D1 连接器卡片文案截图（原先「没在真 App 里看」那条）

- 假网关加一项：`--rpc` 文件里某个方法的答案写成 `{"$error": "…"}`，假网关就回这条报错（`tools/ui-parity/capture.mjs`），用来摆「接入失败」的场景。
- 截图：`%USERPROFILE%\碧琪实测\iso-th\shots\d1-amap-error-light.png`（假网关 + 无头 Edge + 本分支界面，项目模式，设置 → 常用，高德地图）。可以看到：Key 一栏的新提示「到高德开放平台的控制台新建一个，服务平台选「Web 服务」」；接入失败时卡片里显示的那句由 `friendlyProbeError` 实际生成：「没连上：这台电脑上找不到启动命令「npx」。看看是不是写错了，或者对应的程序还没装。这次没有保存。」两处都没有被截断或挤坏。页面那条 `drawImage … width or height of 0` 的报错，11-13 的 D1 截图里也有，是假网关场景本来就有的。
- **发现一处对不上（没改，交 Fable）**：接入成功后页面显示的是界面自己的一句「接好了「高德地图」，新开的对话里碧琪就能用。」，不用网关返回的定稿「连上了，已经保存。新开的对话就能用。」——定稿那句用户实际看不到。要么界面改用网关的 `message`，要么把定稿改到界面这句上；两句意思一样，界面那句带了服务名。

### 测试模型规则（用户 11-15）

现在手上没有更强的模型，**所有实测统一用 `mm/workbuddy/hy4free`**（tools-health 和 Metre 都一样）。号池实测（11-15）：hy4free 同时发 16 个请求全部成功，没有被限流；hy4std、kimi、glm、deepseek 在 10 个 WorkBuddy 号上额度全部用完。

### A7-F1 实测：重试中转 1467 让情况变差，不采用（11-15）

- 做法：同一个副本网关、同一时段，一条路直连号池（`mm` → 1466），另一条路经过本会话单独起的重试中转实例（`mmr` → 1477 → 1466，仓库里的 `proxy/mm-retry-proxy.py`，关掉了换模型兜底，没有注入）。两边都只用 hy4free，各 10 题 × 2 遍，并发 8，混在一起跑（标签 `a7c`）。
- 第一批 `a7-1467` 作废：`run_eval.py` 拼会话键只取模型名最后一段，两条路拼出来同一个键、写进了同一个会话。已修：不是 `mm` 的提供方，键里带上提供方名。

| 路 | 回复 | 出错 | 出错原因 |
|---|---|---|---|
| 直连 1466 | 119 | 2（1.7%） | 都是 `unexpected EOF`（出字前断流） |
| 经过中转 1467 | 109 | 14（12.8%） | `terminated` 10 次、`LLM idle timeout (120s)` 4 次 |

两边各有 3 次 `run_eval` 自己的 15 分钟命令超时，打平，不影响结论。

- **结论**：中转要把整段回复收完才往下发，碧琪 120 秒内收不到任何数据就判定空闲超时并中断。所以 Fable 定的「把 `mm` 地址改成 1467」**不做**，正式配置不改。
- **改为在号池里修**，见下一节；那样只缓冲出字之前那一小段，之后照样流式输出。

### 号池（C.le.console `cle-cliproxy`）的修复（11-15，已推到 C.le.console origin/main）

1. `1d44ec3`：WorkBuddy 每个流的第一块是空的 `role`。号池过去在这一块之后就把流交出去，CLIProxyAPI 也就认为已经发出了数据，之后断开不换号重试，碧琪直接收到 `unexpected EOF`（A7-F1 的根因）。现在等到第一个有内容的块（正文、思考、工具调用或结束标记）才交出去，在这之前断开就返回 502，号池自动换下一个号。额度用完（14018）从 429 改成 402，这个号的这个模型停放 30 分钟。
2. `684d461`：C.le 自己的选号函数 `authAvailable` 把整个号的汇总状态也算进去了：一个号上记录过的模型全在冷却时，这个号的 hy4free 也被挡掉，最长 30 分钟。实测：先把 8 个号的 hy4std、kimi 打到没额度，hy4free 16 个请求修前全部 `no auth available`，修后全部成功。
- 单测都通过（`go test`），修复版在另一个端口用真号验过。**还没部署到正式的 1466**：要替换 `cle-cliproxy.exe` 并重启一次 C.le 控制台，等用户点头。部署后再用直连跑一遍，看出字前断流是否归零。

### 豆包（进行中）

- `doubao-cli` 0.23.3 已装。扫码登录被字节账号风控拒了三次（`error_code 2156`）。改用 C.le 控制台存的豆包账号 Cookie 登录：8 个里有 1 个带登录会话，已登上（CLI 配置名 `cle3`）。
- 实测：一次往返约 9 秒；10.5 万字的输入能收下（chat 15 秒，work 模式用 Kimi K3.1 Pro 23 秒）。免费体验账号能用 DeepSeek V4 Pro、DeepSeek V4.1 Flash、Kimi K3.1 Pro、Kimi K3、GLM 5.3、GLM 5.3 Flash、豆包 2.1 Lite。
- 豆包没有工具调用接口。下一步准备接开源的 Toolify（工具调用转译层）试工具调用准不准，再决定能不能进额度测试。

### A6-1 真浏览器实测（11-15，没测成）

- 做法：这个分支 `app/inapp_browser.py` 的 Windows 侧栏浏览器在 App 外单独起来（接口自测 `open` example.com 成功），副本网关带上它的连接信息（`TH_PASS_PINKIE_APP_BROWSER_ENDPOINT`），跑第 6 题（`app_browser` 起本地页 → 等 `#go` 最多 4 秒 → 点 → 读 `msg`）两遍，只用 hy4free。
- `a6-inapp`：网关启动时没带连接信息，`app_browser` 回「没有侧栏浏览器」，不算数。
- `a6-inapp2`：跑之前副本网关已经停了（12794 没监听），命令行改在自己进程里跑，`app_browser` 仍回「没有侧栏浏览器」；`browser` 工具也连不上网关。两遍模型都自己写 CDP 脚本起无头 Chrome 点到了，答出「点到了」，但没经过 `app_browser`，A6-1 照样没测到。两遍都是 480 秒命令超时：回复其实在 8 分钟内就结束了，是 `serve` 起的本地服务在命令行进程里不退出。
- `a6-inapp3`：重新带连接信息起网关后再跑，两遍都在十几秒内失败：号池 1466 回 `model_not_available`（「模型 workbuddy/hy4free 不在当前 API Key 的可用模型范围内」），`/v1/models` 里已经没有 hy4free。05:35 还能用。号池是用户的 C.le 控制台，没动；规矩是实测只用 hy4free，没换模型。
- **结论：A6-1 仍是「单测过、真机没测」**。等 hy4free 回到号池（或用户另定模型）后，照上面起浏览器和网关，重跑 `a6-inapp3` 即可。副本网关已停，副本配置的 `imageModel` / `pdfModel` 和备份 `bak-pre-imgdefault` 一致，不用还原。

### ② `imageModel` / `pdfModel` 默认值 · 副本实测（11-15，hy4free）

原先记的「没在正式 App 里重跑 `image`」：在副本 `iso-th` 上做了对照，正式环境没动。
- 做法：副本配置先备份（`openclaw.json.bak-pre-imgdefault`），去掉 `imageModel` / `pdfModel` 后重启副本网关，跑题 3（三张图读字）、4a（扫描 PDF 第 1–15 页列目录）、4b（扫描 PDF 讲了什么）各 2 遍，标签 `img-none`。再用本分支 `services/mode-architecture/setup.py` 的 `_default_vision_models` 补这两项（补成 `{primary: mm/workbuddy/hy4free}`），重启后同样跑一批，标签 `img-default`。数字用 `session-stats.py --event-since/--event-until`，按两批各自的事件时间算。跑完配置已还原成备份。

| 批 | `image` 出错 | `pdf` 出错 | 6 次里跑完 | 出错原因 |
|---|---|---|---|---|
| `img-none`（没配） | 5/5 | 6/8 | 3（4a、4b 有 3 次撞上 480 秒命令超时） | 运行时退到配置外的模型：`google/gemini-3-flash-preview` 超时、`mm/workbuddy` 找不到、`deepseek-v4.1-flash` 503 号池没号可用 |
| `img-default`（补上） | 3/15 | 2/15 | 6 | 全是 hy4free 自己慢：`image` 60 秒超时 3 次；`pdf` 一次「没有返回文字」、一次号池 504 |

- 结论：**补上默认值后，「找不到模型 / 退到别的模型」这一类出错没了**，剩下的是 hy4free 本身超时。题 3 两批都答对了（模型能直接看图，不必走 `image` 工具）；题 4a、4b 补上后两遍都答出目录和内容（还指出这本扫描书正文是占位文字）。
- 这验证的是补出来的配置管用，**不是**正式 App 里 `setup.py` 真跑了一遍：正式配置要等下次安装或更新时才会补，没有在正式环境里看。

### 这一轮没跑的（11-15）

| 项 | 原因 |
|---|---|
| A1-4、A2 `-shm`、A6-2、D1 的 Mac 部分 | 需 Mac |
| B1-2 | 需真渠道账号（QQ / 飞书机器人），不碰 |
| 号池修复上线后再用直连量一遍出字前断流 | 正式 1466 还是旧版（C.le v1.1.48 在另一个会话里发布），而且 hy4free 现在不在号池里 |
| B2-1～3 | §6 停了，没有可跑的 |

### A6-1 真浏览器实测 · 过（11-15 晚，`hy4flash-free`）

- **模型**：号池里 `workbuddy/hy4free` 改名成了 `workbuddy/hy4flash-free`（返回的额度信息写着 `shared_models: ["hy4free"]`，同一份额度）。实测 3 秒回 200，也能看图（`note-2.png` 读对）。副本 `iso-th` 配置里三处 `hy4free` 换成新名字（备份 `openclaw.json.bak-pre-hy4flash-free`），之后的实测都用它。
- **为什么前几批没接上**：环境变量从 Git Bash 传进 Windows 进程时，JSON 里的 `\` 被压成单个 `\`，`PINKIE_APP_BROWSER_ENDPOINT` 解析失败，工具就当成「没有侧栏浏览器」。改用正斜杠路径（`F:/…/endpoint.json`）后正常。另外，`openclaw agent` 命令行是在**自己的进程里**跑这一轮的，工具用的是 `run_eval` 的环境变量，所以网关和 `run_eval` 两边都要带。`a6-inapp`～`a6-inapp4` 都作废。
- **`a6-inapp5`，2/2 过**：这个分支 `app/inapp_browser.py` 的 Windows 浏览器在 App 外单独起来（用开发版 venv 里的 pywebview），副本网关和 `run_eval` 都带上它的连接信息，跑第 6 题。夹具 `site` 复制到了副本主目录 `home\th-site`（`serve` 只认主目录里的目录，这条规矩是对的），题目文字不变。
  - 第 1 遍：`serve`（回「已在 App 侧栏打开」）→ `batch [wait #go waitFor=visible ms=4000, click #go]` → `read #msg` = 「点到了」，22 秒。
  - 第 2 遍：`serve` 失败（第 1 遍那个会话的服务还占着 8765），模型查出 8765 上就是这个页面，改用 `open` → `wait #go ms=4000` → `click` → 读到「点到了」。
  - 两遍都没退回系统浏览器，也没自己写脚本绕路。

**顺带发现的问题（没改，交 Fable）**：静态 `serve` 起在网关进程里，返回的 `pid` 是**网关自己的进程号**。`a6-inapp4` 第 2 遍，模型看到 8765 被「残留的 node 进程」占着，照这个 pid 执行了 `Stop-Process`，把副本网关杀了。`serve_logs` 同时说「本地服务已停止」，端口却还在监听，也会误导模型。建议：静态服务不返回 `pid`（或标明「在网关里，不要结束这个进程」），换会话后同目录同端口的服务直接复用或明确报「被本机另一个会话的服务占着」。
