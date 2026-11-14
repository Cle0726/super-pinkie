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
| A1-1 | 待实测（「改后」那批） | |
| A1-2 | 过 | `tests/web-fetch-fakeip-v6.test.mjs`：开关为真时 `10.0.0.1`、`192.168.1.1`、`127.0.0.1`、`169.254.169.254`、`fd00::1`、`fc00::1`、`fe80::1`、`::1`、`2001:2:1::1`、`2001:db8::1`、`::ffff:10.0.0.1` 仍判为内网；`2001:2::e` 只在开关为真时放行。测试跑的是本机真实运行时的 ip 判定代码（打补丁的副本写到临时目录，不动原文件），快照版也跑了一遍 |
| A1-3 | 没新增配置键：过；网关启动：待 | 补丁只改代码；副本配置是正式配置的复制 |
| A1-4 | `patches-wired` 过；`refresh_mac_runtime.py --check` **待 Mac 端跑** | `node --test tests/patches-wired.test.mjs`：pass 1；`python -m unittest tests.windows_mac_snapshot_test`：6 个都过 |

### A2 memory_search 要么能用，要么不出现

- Windows 正式环境 4 个模式库都是结构版本 1，`memory_search` 0/4 失败；Mac 的「版本 19」问题这边没有。
- **走第一条路（留着）**：Windows 正式会话里（只读看的），库能打开、`provider: none` 时 `memory_search` 走关键词检索，能返回 `memory/INDEX.md`、`memory/2026-11-07.md` 这类命中（另有 3 次 0 条）。所以库重建后不用把工具拿掉，也没用到第五节那句「记忆检索暂时停用」。
- 实现：`services/mode-architecture/agent-db-guard.mjs` + `index.mjs` 里 `gateway_start` 钩子。读 SQLite 文件头第 60 字节的 `user_version`（不打开库、不加依赖），和运行时打包代码里的 `OPENCLAW_AGENT_SCHEMA_VERSION` 比；更新的就把库和 `-wal/-shm/-journal` 一起 `rename` 到 `<状态目录>/backups/agent-db-<日期>/<模式>/`。最近 60 秒有改动的不动；任何一个文件挪不动（Windows 上被占用改名会失败）就整组放回。只挪不删，不降级。
- 和方案的差别：运行时认的版本号读不到时什么都不做（不猜）。
- **实测发现（11-13，Windows 副本）**：运行时在网关启动早期（插件加载之前，比 `gateway_start` 早约 8 秒）就会打开每个模式库，读到版本 19 报错后关掉，不占着文件（改名探测三个文件都能改），但这一下已经重写了 `-shm`。原来的「60 秒内改过就不动」把 `-shm` 也算上，所以每次启动都是 `skipped-busy`，**永远挪不动**。修法：判断「有人在写」只看库本身和 `-wal` / `-journal`（真写入一定动这两个），`-shm` 不算；被占用改名失败整组放回的保护不变。同一处 Mac 也会中（打开库就会动 `-shm`），Mac 副本没测。

| # | 结果 | 证据 |
|---|---|---|
| A2-1 | 过（Windows 副本实测，修了一处后） | `tests/agent-db-guard.test.mjs`：用 `node:sqlite` 造真库（200 行，`PRAGMA user_version = 19`）+ 随机内容的 `-wal/-shm`，挪完三个文件 sha256 和大小都一致，版本 1 的库不动，第二次启动不再动；60 秒内改过的跳过；挪一半失败整组放回 | 5 条全过（新增「-shm 刚被重写不算在写」）。**副本实测 11-13**：learning 模式放假库（版本 19，库 77824 B / -wal 4096 B / -shm 32768 B，mtime 5 分钟前）→ `setup.py sync` + 重启。第一次：日志 `agent db learning: schema 19 > 1, skipped-busy`，没挪（原因见上「实测发现」）；修后再 sync + 重启：`agent db learning: schema 19 > 1, moved -> …\iso-th\home\.openclawackupsgent-db-20261113\learning`，库和 -wal 的大小、sha256 与放进去时一致（`11a2dca6…` / `baf2ad89…`），-shm 与挪之前磁盘上的一致（`fd4c9fda…`，运行时第一次启动已重写过它），模式目录里只剩 `models.json`；网关 `ready`、端口 1425 在听；第三次启动没有 `agent db` 日志（没东西可挪） |
| A2-2 | 待实测（题 7） | |

### A5 process 的提醒不算出错

- 根因比方案说的深一层：这段「还在后台跑，先干别的」的提醒是 `background-jobs.mjs` 在 `before_tool_call` 里用 `block` 送出去的；运行时把被拦的调用做成 `details.status: "blocked"`，再由 `isToolResultError`（`tool-result-error-*.js`）判成出错。插件钩子的返回值经过 `runBeforeToolCall` 合并时只留 `params / block / blockReason / requireApproval`，**插件这一层没法让它不标出错**。Windows 正式会话里这条提醒 481 条，全部 `isError: true`（占 process 458 次失败的绝大多数）。
- 做法（不改运行时核心）：`background-jobs.mjs` 新增 `isWaitNudgeResult` / `softenWaitNudge`，`index.mjs` 注册同步钩子 `tool_result_persist`：只认这段提醒（`deniedReason: plugin-before-tool-call` + 提醒原文），写进会话记录前改成 `isError: false`、`status: deferred`、`ok: true`，**文字一字不动**。任务不存在、进程崩了、别的插件 / 循环检测的拦截都不碰，照旧是出错。
- 剩下的一截（照实写）：同一轮里运行时内存中的那条结果仍是出错。碧琪现在的模型都走 `mm`（openai-completions），这种格式**根本不把出错标记发给模型**，模型只看到文字，所以对模型无影响；会话记录、界面、体检统计、下一轮的上下文都已是正常结果。若以后走 Anthropic / Google 格式（会带 `is_error`），要彻底去掉得做一个三处的运行时补丁（钩子合并保留一个字段、veto 分支带出去、`buildBlockedToolResult` 写 `ok: true`）——没做，报给 Fable 定。

| # | 结果 | 证据 |
|---|---|---|
| A5-1 | 过（单元测试）；题 5 实测待「改后」批 | `tests/background-jobs.test.mjs` 8/8：提醒去掉出错标记且内容不变；任务不存在、其他拦截、循环检测、进程崩溃仍是出错 |

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

### A6 app_browser 宽容一点

改的都在 `services/mode-architecture/app-browser.mjs`：
1. `wait`：`text / selector / ref / name` 四选一，可再加 `ms` → `ms` 换成 `timeout_ms` 传给原生侧（原生侧不会把它当成先睡 ms 毫秒），就是最长等待；只给 `ms` 是纯等待；上限 15 秒不变；两个目标一起给仍报错。
2. `serve`：`dir + port` 合法，静态服务就起在这个端口；`dir` 和 `command / cwd` 一起给才报错。
3. Mac 上 `tab`：`op: new` 带 `url` 等价 `open`；其他 tab 操作（含不带 url 的 new）返回「Mac 版只有一个页面，直接用 open 换网址。」，`ok: true`，不标出错。
4. 工具说明里补了 wait 和 serve 的参数写法（`name+ms=4000`、「静态页填dir（可加port指定端口）」）。
5. 证书无效类报错（`ERR_CERT_*`、`ERR_SSL_*`、certificate、self-signed…）换成一句中文 + 下一步（换 http、换来源）。这句是我写的，列进「待 Fable 写」请过目。

| # | 结果 | 证据 |
|---|---|---|
| A6-1 | 单元测试过；题 6 实测：副本没有侧栏浏览器端点，**没测**（需在真 App 里走） | `tests/app-browser-lenient.test.mjs` 4/4：wait name+ms 传给原生侧的是 `timeout_ms: 4000`、请求超时 4 秒；serve dir+port 真的在该端口起服务并取回页面 |
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

## 报给 Fable 的另开项（这一轮不做）

- **A7-F1　上游「出字前断流」原地快速重试**：`stopReason: error`、内容是 `[assistant turn failed before producing content]`、报错含 `EOF` / `Connection error` 时，同一模型在几秒内原地重试 1 次（不换模型、不加配置键），再不行才交给 watchdog。依据：副本 hy4free 断流 10 次占全部出错 83%，正式 9 次占 27%；现在平均要等约 90 秒才续接，还有漏接。没查：运行时自身有没有同模型重试的开关、插件钩子能不能做到这一步——这一项要 Fable 先定做不做、在哪一层做。

## 待 Fable 写

- A6：证书报错的中文提示（暂用）：「这个网站的安全证书有问题（过期、不受信任或和网址对不上），浏览器没有打开它。可以试试把网址换成 http:// 开头，或者换一个来源找同样的内容。」
- A6：wait / serve 参数说明里加的两句（工具说明，模型看）——如要改口吻请定稿。
