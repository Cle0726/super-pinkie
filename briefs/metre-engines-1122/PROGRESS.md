# Metre 外部引擎 · 进度

新的一条写在最上面。每条写：做了什么、怎么验的、没验什么、下一步。

---

## 2026-11-22 夜 · 会话 31ea3b09 · E2 收尾 + E3 引擎台第一版（用户额度快用完，主动停在这里）

**用户这一段的三句话（都已写进 PLAN 3.3）**
- 「注意是做融合不是完全按照现在的 Meter……如果出现没有的就做一个 meter UI 覆盖就行」「也不要直接全用，因为本质上也是完善 meter 所有功能」→ 不嵌 T3 的整页，Metre 自己画「引擎台」，功能照 T3 / OpenMausBot。
- 「不要有 T3 code 的 ip 标志 还有记得保留 "C.le." 思考动画 three.js」→ 界面上不出现 T3 的名字、标志、链接（引擎传回的话里也替换掉）；原计划「Antigravity 安装登录借用 T3 设置页 + 转发口」**作废**，改成 Metre 自己做（见下一步）；引擎台的工作状态行用和原生对话同一个 C.le. 粒子签名。

**做了什么（提交见 git log，分支 feat/metre-engines）**
- `engines-rpc.mjs`：T3 网页用的实时通道 `ws://127.0.0.1:<端口>/ws?orchestrationProtocol=2`（Effect RPC：Request / Chunk+Ack / Exit / Interrupt / Ping），令牌用 `t3 auth session issue --token-only --ttl 12h --scope …` 现签，只在内存。
- `engines-bridge.mjs`：把 `orchestration.getThreadProjection` 的 `visibleTurnItems`（每行 `{position, item}`）翻成 Metre 的行（you / reply / thinking / command / edit / search / web / tool / todo / plan / approval / question / error / note）；命令：`launchThread`（开对话）、`message.dispatch`（空闲 `start_immediately`、在跑时 `queue_after_active` 或插话 `steer_active`）、`runtime-request.respond`（批准 / 回答）、`thread.stop`、`thread.model-selection.set` / `runtime-mode.set` / `interaction-mode.set`、`thread.pin/archive`、`getFullThreadDiff`（要 `toTurnCount` = 检查点最大 `ordinalWithinScope`）。额度、没登录说成大白话；邮箱和 T3 字样（`brandless`）都去掉。按会话记引擎选择：`<引擎目录>/sessions.json`。网关方法：`pinkie.engines.catalog / session / choose（含 newThread）/ say / thread / respond / stop / organize / diff / signin`（signin 只会在用户点按钮时开一个命令行窗口跑 `claude auth login` / `codex login`，碧琪不经手账号）。顺手修了 `threads` 少 `--project` 的错。
- 界面 `laolao-metre-engine.js/.css`（已登记进 head，`?v=metreengine1`）：Metre 输入框下多一颗「引擎」按钮（菜单：Metre / Claude Code / Codex / Antigravity + 登录和额度状态 + 模型 + 放手程度四档）；选了外部引擎，正文区换成引擎台：对话流、命令和改文件一行一行可展开、待批准卡片（批准 / 这次都批准 / 不行 + 附一句）、提问卡片、计划清单、方案卡（「照这个方案做」）、右侧改动面板、自己的输入框（排队 / 插话 / 停）、「先出方案」开关、置顶 / 归档 / 换一段新对话。思考按「思考了」规矩：想时 68px 小窗，放完停 1.8–3.6 秒自己收成「思考了 N 秒」，打开页面时已想完的收着。最底下一行是 C.le. 粒子签名（`import('/laolao-cle-space.js?v=8')`，和 cle-stage 同一份模块），每一步换形状，做完落款、拆掉 WebGL。
- 健康门禁：head 多 2 行、版本号 +3 已写进 `tools/health/exceptions.json`（带理由）；新文件不加 window 全局。

**怎么验的**
- 测试 37 过：`metre-engines`、`metre-engines-bridge`（9 条，含假 WebSocket）、`metre-engine-ui`（静态 3 条）、`metre-board`、`plugin-file-lists`、`code-health-ratchet`。
- 真引擎（试验服务 `F:\t3probe\e1\root`，端口 3791，脚本在会话草稿 `bridgeprobe.mjs`）：catalog 读到 Claude 未登录、Codex 已登录但额度用完（11-27 01:44Z 恢复）；Codex、Claude 各开一个真对话，行和大白话报错都对。
- 截图（`tools/ui-parity/capture.mjs --mode metre --rpc 场景.json`，Edge）：亮 / 暗、引擎菜单、运行中、思考中（C.le. ∞ 小标真的在 WebGL 里动）、同一个真对话和 T3 原版并排（T3 原版图用 `t3shot.mjs` 配对链接截的，只在本机）。

**没验的 / 没做的**
- `metre-engine-ui` 里真浏览器那条在这台机器上被跳过（harness 的 `require('playwright')` 找不到 NODE_PATH 里的包）——下次先让它跑起来。
- 没在隔离网关里整条走一遍（E2 原定的「真网关里调用」）：要建 `tools/metre/iso` 副本（`METRE_ISO_ROOT=F:\metreiso\eng` 纯英文），把 `F:\t3probe\e1\root\versions` 拷到副本的 `local\SuperPinkie\engines\versions` 省得重下 170MB。
- 侧栏这一行还没标引擎名（`laolao-session-list.js` 的行有 `data-session-key`，用新文件补一个小标，别改那个文件）。
- 并排对比图还没拼成一张交给用户。
- 没有一个有额度的引擎能跑完一整件真活（Codex 额度 11-27 恢复；Claude 要用户自己 `claude auth login`）。

**下一步（按顺序）**
1. 让 `metre-engine-ui` 的浏览器测试真跑；侧栏标引擎名；拼并排对比图。
2. Antigravity 的安装和登录改成 Metre 自己做：T3 的 `provider.install.start/subscribe`、`provider.auth.start/respond/complete/subscribe`（`packages/contracts/src/rpc.ts` 的 WS_METHODS，源码只读参考在 `F:\t3probe\src\t3code`）。**不要嵌 T3 页面**（用户 11-22 明确不要 T3 标志）。`pinkie.engines.open`（配对链接）界面不再用。
3. 隔离网关真调一遍（见上）。
4. E4 `pinkie_engine_task`（PLAN 3.4）→ E5 乐手 → E7 设置 / 许可 / 文档。

## 2026-11-22 · 会话 847a9261 · E2 网关方法 · 前半完成

- `engines.mjs` 末尾的 `registerEngines(api, {base, register})`：引擎服务全网关只建一个（`Symbol.for('pinkie.engines.v1')`，插件会被加载好几份）；开关存在 `<碧琪状态目录>/engines/prefs.json`，默认关；网关启动时开关是开的就自动启动；进程退出时停。方法：`pinkie.engines.status`（含 providers，已去邮箱）、`pinkie.engines.enable {on}`、`pinkie.engines.threads {folder}`。
- 挂在 `metre-board.mjs` 的 `registerMetreBoard` 里（`index.mjs` 受健康门禁限制不能变长；`metre-board.mjs` 是新文件上限 1500 行）。`register` 传的是 `registerSessionMethod`，所以 Metre 锁照样生效。
- 验证：`metre-engines`（8 条）、`metre-board`、`plugin-file-lists`、`code-health-ratchet`、`metre-roles` 共 43/43。没在真网关里调过。
- `pinkie.engines.open` 已做：`t3 auth pairing create --ttl 5m --json` 返回的 `pairUrl`（必须是本机引擎地址开头才给），权限收窄到 8 项（不给终端、远程访问管理）。测试 12/12。
- **E2 还剩**：`pinkie.engines.signin {provider}` 打开官方登录（Claude 是终端 `claude auth login`，Antigravity 在 T3 设置里）；在 T3 里启用 `claudeAgent`、`antigravity` 实例（看 `t3 --help` 有没有开关命令，没有就查 `home/userdata` 的设置怎么写）。然后在隔离网关里真调一遍（`tools/metre/iso/`，副本放 F: 纯英文路径）。
- 已查清的命令（11-22）：
  - 配对链接：`t3 auth pairing create --ttl 5m --label metre --base-url http://127.0.0.1:<端口> --json`，返回里有 `/pair#token=...` 链接，界面用它嵌入并换到浏览器会话。默认权限很大（含 `terminal:operate`、`access:write`、`relay:*`），用 `--scope` 收窄到 `orchestration:read/operate`、`settings:write`、`providers:manage`、`filesystem:read`、`source-control:write`、`preview:operate`、`diagnostics:read`。令牌只交给界面，不进日志。
  - 程序用的令牌：`t3 auth session issue --token-only --ttl 1h --scope ...`（以后要直接连它的 WebSocket / MCP 时用）。
  - **更正（11-22 晚）**：Claude 的实例 id 是 `claudeAgent`，它本来就是开着的；之前「disabled」是我把 id 写成了 `claude`。实测 `--provider claudeAgent --model claude-opus-5-5` 返回「Claude could not authenticate…run `claude auth login`」——只差用户本人登录。Antigravity 的运行包要在 T3 设置页的 Providers 里装并用 Google 登录（用户在嵌入的引擎界面里点），不需要碧琪改 settings.json。所以 E2 剩下的只有 `signin` 引导：Claude 显示「在终端运行 `claude auth login`」并提供复制按钮；Antigravity 和别的引擎指向嵌入界面的设置页。
  - （备查）启用引擎实例：T3 服务端的 `settings.json`（在 `T3CODE_HOME/userdata/`，改过设置才生成）里 `providerInstances.<id>`；`t3 policy settings` 列出全部可设路径。实例 id：`claudeAgent`、`codex`、`antigravity`、`opencode`。先用 `t3 policy settings` 看清格式再写，写完重启引擎服务。
- 试验目录：`F:\t3probe\e1\root`（E1 真装的那份，`home` 里已加项目 `F:\t3probe\work`）；`F:\t3probe\home`（最早手动试的一份，可以删）。

## 2026-11-22 · 会话 847a9261 · E1 引擎服务 · 完成

- `services/mode-architecture/engines.mjs`：`EngineService` 的 install（curl 走本机 7897/7890 代理下载固定版本 → 对照 `SHA256SUMS` → Windows 用 PowerShell `Expand-Archive`、Mac 用 tar 解压 → 放进 `engineRoot()` 选出的纯英文目录 → 清掉下载临时目录）、start（空闲端口、只监听 127.0.0.1、等「server is ready」、10 分钟内最多自动重启 3 次）、stop（Windows `taskkill /T`）、status、providers（读 `home/caches/*.json`，**去掉邮箱**）、cli（解析 `--json` 输出；错误取 `ERROR (#n):` 那句）、addProject（已存在算成功）、startThread / send / show（消息走标准输入，引号换行不出错）。
- 已加进两份插件复制清单：`setup.py` 和 `installer/macos/apply-theme.sh`。新测试 `tests/plugin-file-lists.test.mjs` 从 `index.mjs` 顺着 import 核对两份清单（反向验证过：删掉一个文件就变红）。**index.mjs 还没 import engines.mjs**，E2 接上以后这条测试会自动盯住它。
- 验证：`tests/metre-engines.test.mjs` 7/7；健康门禁过；真实流程（`F:\t3probe\e1\run.mjs`，数据在 `F:\t3probe\e1\root`）：真下载校验解压 → 启动在 3790 → providers 读到 codex 已登录 0.171、claudeAgent 未登录 → `startThread` 交给 Codex，正确返回「额度用完」→ `show` 返回 `{thread, messages}` → stop。
- 没验：Mac；中文用户名的电脑（只有单元测试）；崩溃自动重启（只有代码，没真杀进程试）。
- 下一步 E2：在 `index.mjs` 里建一个 `EngineService`（logger 用 `api.logger`），注册网关方法 `pinkie.engines.status / enable / disable / providers / threads / open`；开关存在插件状态目录；`open` 用 `t3 auth pairing` 生成本机配对链接给界面嵌入（命令先 `t3 auth pairing --help` 看清用法）。

## 2026-11-22 · 会话 847a9261（Opus 5.5）· 摸底和打通

**环境（已做）**
- 本机命令行全部升到最新：Codex 0.146.0 → 0.171.0、Claude Code 2.1.322 → 2.1.330（都是 `npm -g`，前缀 `F:\npm-global`）；Antigravity CLI 1.1.5 → 1.5.14、Antigravity IDE 2.5.5 → 2.8.0（winget）。
- Clash Verge 全局节点按实测下载速度换成「🇺🇸美国中转2」（1.64 MB/s；原「美国直连3」0.78 MB/s）。只能换美国节点。控制器 127.0.0.1:9097，密钥在 Clash Verge 的 config.yaml，不打印。

**T3 试验（已打通）**
- 试验目录 `F:\t3probe`（纯英文）：`node_modules/t3`（npm 启动器 0.1.11）、`home`（`T3CODE_HOME`，里面 `runtime/versions/0.1.11/t3.exe`）、`work`（试验项目，git 仓库）、`tools`（多装的一份 Codex 0.171，现在用不着了）。
- 启动：`T3CODE_HOME=F:/t3probe/home t3.exe serve --port 3790 --host 127.0.0.1 --no-browser`，日志 `F:\t3probe\serve.log`。
- 已证实：`t3 project add .`、`t3 thread start . "<话>" --provider codex --model gpt-5.6-luna --wait --json` 走通，返回 `{threadId, runId, status, reply, error}`。
- 中文路径坑：T3 启动器用 Windows `tar.exe` 解压，`F:\碧琪实测\...` 直接失败。碧琪必须自己解压。
- 三家现状：
  - Codex：已登录（用户的 ChatGPT Plus），版本够了；**额度用完，11-26 17:43 恢复**。
  - Claude Code：已装，**没登录**，要用户自己运行 `claude auth login`。T3 里的实例 id 是 `claudeAgent`，默认是关的。
  - Antigravity：T3 里默认关；要在 T3 里装它的运行包并用 Google 登录（用户自己点）。
  - 实例 id 看 `home/caches/*.json` 的 `instanceId`；这些文件含账号邮箱，不要打印、不要外传。

**计划**：本目录 `PLAN.md`。C.le. 计划那边的 K8（分支 `docs/metre-next-1122`）指向这里。

**下一步**：E1 引擎服务（`services/mode-architecture/engines.mjs` + 测试）。
