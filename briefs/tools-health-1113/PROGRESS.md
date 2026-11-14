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

| # | 结果 | 证据 |
|---|---|---|
| A2-1 | 单元测试过；隔离网关实测待 | `tests/agent-db-guard.test.mjs`：用 `node:sqlite` 造真库（200 行，`PRAGMA user_version = 19`）+ 随机内容的 `-wal/-shm`，挪完三个文件 sha256 和大小都一致，版本 1 的库不动，第二次启动不再动；60 秒内改过的跳过；挪一半失败整组放回 |
| A2-2 | 待实测（题 7） | |
