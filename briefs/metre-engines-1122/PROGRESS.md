# Metre 外部引擎 · 进度

新的一条写在最上面。每条写：做了什么、怎么验的、没验什么、下一步。

---

## 2026-11-23 晚 · 真加了一家注册表引擎：Qwen Code（AWS Quick 经 Quick 跑腿 2）

**做了什么（用户 11-23 同意）**：在隔离的试验目录里用新代码真走了一遍「更多引擎」。引擎服务 0.1.11（程序用 `F:\t3probe\e1\root\versions`），引擎目录 `F:\t3probe\e6probe`（全新的 home，不碰用户的任何登录）。脚本 `build\quick-run\e6\qwen-run.mjs`、`qwen-run2.mjs`，结果 `qwen-run*.json`（链接只记域名和路径）。
- 搜「qwen」→ 只有 qwen-code 0.28.4（Apache-2.0，用 npm 装，没有 sha256，靠注册表的 https）。
- `EngineRegistry.add` 成功，**用了 7 分 17 秒**（`server.prepareAcpRegistryAgent` 走 npm，经本机代理），实例 `acpRegistry_qwen_code`。菜单行：名字「Qwen Code」、`registry: true`、「还没登录」、一个模型 `default`。
- 引擎服务后台查完以后报 `warning`：「Sign in in provider settings using "Use OpenAI API key"」。登录方式**只有一种**：`openai`「Use OpenAI API key」（要设环境变量 `OPENAI_API_KEY`），点了直接失败，原话是英文的「The ACP agent could not complete sign-in. Internal error」。没有浏览器登录。
- 结论：**Qwen Code 0.28.4 在 Metre 里用不了**（碧琪不经手密钥）。所以没发出一句话、没派活。

**据此改的**
- `engines-bridge.mjs`：注册表引擎没登录、引擎服务的话里说要 API key 的，状态叫 `keyonly`，「只能填 API 密钥登录，Metre 里不经手密钥，用不了」（只管注册表引擎，十家照旧）。托管登录失败、它给的方式又全是填密钥的：英文原话换成这句；这类方式标成 `credentials`，设置卡片不会把它当「改用：…」给出来。
- 设置卡片 `keyonly`：说清楚用不了，留「再查一次」和「删掉这个引擎」。点「加上」时提示第一次可能要好几分钟（npm 实测七分钟左右）。`metreengine10` → `11`。文档同步。
- 测试：`metre-engines-registry` 加一条（照真机的原话和字段）。19 个文件全过，ratchet、`git diff --check` 过；全量门禁本次 53、干净副本（f454f538）54，没有新增。

**没验的 / 留给以后**：有浏览器登录的注册表引擎（比如 Gemini CLI、GitHub Copilot、Kimi Code，没查它们各给什么登录方式）还没真走一遍登录和派活。试验目录 `F:\t3probe\e6probe` 里 Qwen Code 的实例和 npm 包还在，不用时可以整个删掉。

**下一步**：如果用户愿意，挑一家有浏览器登录的注册表引擎再试（先只查登录方式，不下载就看不到，所以要先点头）→ E8 同步给碧琪全局。版本号发版前问用户。

## 2026-11-23 晚 · E7 许可声明进关于页（AWS Quick 经 Quick 跑腿 2）

**用户这一段**：push c2ee5a73 + 9beafcc7（已推，`461f9939..9beafcc7`）；NOTICES 放「关于与更新」卡片最后一行「第三方许可」，点「查看」弹出全文；同意挑 Qwen Code 真加一遍注册表引擎（下一条）。

**做了什么**
- 设置「关于与更新」最后一行「第三方许可」+「查看」：弹窗（原生 `<dialog>`，用设置页自己的 `--pinkie-settings-*` 配色）显示全文：引擎服务是 T3 Code 官方发布包（MIT）、OpenMausBot 设计借鉴（Apache-2.0，没搬代码）、更多引擎各按自己的许可证，中英各一份，最后是 MIT 全文。关闭按钮或点外面关。不连网关，五个模式都能看。
- 写法照设置开关：`laolao-settings-user.js` 在同一行 `makeStatus(aboutCard, "usage")` 后面留空位 `.pinkie-user-settings__notices`（带 `row / button`），发 `pinkie:settings-notices`；行数还是 1637。正文和弹窗在 `laolao-metre-engine.js` 的 `NOTICES-BEGIN / NOTICES-END` 段，这是全项目唯一能写对方项目原名的地方；`metre-engine-ui` 的「界面不出现对方名字」那条改成只放过这一段（而且只能有一段）。
- **MIT 全文和版权行「Copyright (c) 2026 T3 Tools Inc.」和 T3 Code 仓库 v0.1.11 标签下的 `LICENSE` 逐字对过**（`git show v0.1.11:LICENSE`，本机只读源码）——草稿里「拿不准」的那条解决了。关于页不写版本号。`NOTICES-draft.md` 的「拿不准」一节改成核对记录。
- 顺手修：上一条 E7 设置开关改了 `laolao-settings-user.js`，但它的 `?v=guard3` 没换，有缓存的用户可能看不到开关。现在 `guard3` → `guard4`；`metreengine9` → `metreengine10`。
- `docs/METRE-MODE.md`「打开和关掉」加一条许可声明在哪。

**怎么验的**：`metre-engine-ui` 新加两条：静态（空位是关于卡片最后一行、MIT 关键句逐字在、settings 换了号）；真浏览器（设置页先建好 / 引擎文件先加载两种顺序都接上、点「查看」弹窗有版权行和致谢、关闭、全程不调网关）。19 个文件全过（`metre-engine-ui` 14 条，Edge）；ratchet、`git diff --check` 过。全量门禁：本次 53 条失败，干净副本（9beafcc7）54 条，没有新增——这次那条不稳的 `session-lineage`「stop-and-archive…」挂在了干净副本上。截图（存根页 + 真设置页 CSS，亮 / 暗）：`build\quick-run\e6\shot-notices-*.png`。

**没验的**：没在真碧琪设置页里截图；Mac 没验。

**下一步**：Qwen Code 真加一遍（用户 11-23 同意）→ E8。版本号发版前问用户。

## 2026-11-23 晚 · E6 更多引擎（ACP 注册表）+ 引擎台补「新工作树」（AWS Quick 经 Quick 跑腿 2）

**做了什么**
- 引擎菜单底下多一行「＋ 更多引擎」（外部引擎打开时才有）：搜公开的 ACP 注册表，一家一行写说明、许可证、怎么装（下载运行包 / 用 npm 装 / 用 Python 工具装）、来源链接（只放 https）；不取图标（图在别人的网站上）。菜单里已有的十家不重复列（照引擎服务设置页的 `acpRegistryAgentIds`：codex-acp、claude-acp、antigravity-acp、cursor、grok-build、opencode、opencode-v2、pi-acp；另外去掉 muse-code，十家里已有 Muse Code）。点「加上」才下载：`server.prepareAcpRegistryAgent {agentId}` → `server.updateSettings` 建实例 `acpRegistry_<名字>`（driver `acpRegistry`，config `{agentId, distribution: 'auto'}`，id 照引擎服务设置页 `deriveInstanceId` 的规矩，重名加 `_2`）→ `refreshProviders` → 直接进这一家的设置卡片登录。
- 新文件 `services/mode-architecture/engines-registry.mjs`（网关方法 `pinkie.engines.registry {action: search|add}`，要外部引擎开着），已登记进 `setup.py` 和 `installer/macos/apply-theme.sh` 两份复制清单（同一行里加，不加行数）。
- `engines-bridge.mjs` 认 `acpRegistry`：`driverOf('acpRegistry_…')`；登录走托管（`provider.auth.*`，和 Antigravity、Cursor 同一条路，可带 `methodId`）；菜单行带 `registry: true`；引擎服务自带的那个空注册表实例（id 就是 `acpRegistry`，没指定哪一家）不列。删掉走现成的 `pinkie.engines.account remove`，**不替用户退出**它的登录（引擎服务文档：ACP 不分账号，同一台电脑上这家共用一份登录）。注册表加的引擎，设置卡片底下只有「删掉这个引擎」，没有改名字。
- 登录方式是终端或填密钥的：Metre 里接不上，设置卡片说清楚，并列出它别的登录方式（「改用：…」，带 `methodId` 重新开始登录）。
- 引擎台清单剩下的一项（PLAN 3.5「每个会话独立工作树」）：桥早就收 `worktree`、文档也写了有，但界面上没开关。现在还没开对话时，引擎台底下「先出方案」旁边多一颗「新工作树」，按下后第一句话带 `worktree: true`（`workspaceStrategy: worktree`）；对话开了就不再出现；换会话复位。
- `?v=metreengine8` → `metreengine9`。`docs/METRE-MODE.md`「选引擎、登录」加「更多引擎」一条，代码清单加 `engines-registry.mjs`。

**怎么验的**
- 真引擎服务（0.1.11：用 `F:\t3probe\e1\root\versions` 里的程序 + 全新的 `F:\t3probe\e6probe\home`，不碰任何登录）：`server.searchAcpRegistry` 1.4 秒返回 43 家；新代码 `EngineRegistry.search` 剩 34 家，菜单已有的没漏进来，34 家都有来源链接；搜「qwen」只回 qwen-code。脚本 `build\quick-run\e6\probe-registry.mjs`、`real-search.mjs`。
- 新测试 `tests/metre-engines-registry.test.mjs` 4 条：过滤十家和坏 id、只放 https、不带图标、不露引擎服务的名字；加上的顺序（先 prepare 再建实例再 refresh）、重名加 `_2`、拒绝时不下载；实例 id 规矩；注册表行走托管登录、删掉不退出登录。`metre-engine-ui` 新加两条真浏览器（Edge）：更多引擎（搜、描述按文本显示、已加的不能再加、点了才下载、加好直接进登录、删掉点两下、没有改名字）；新工作树（默认关、按下后第一句带 worktree、对话开了就消失）。`metre-engines` 的网关方法清单加 `registry`，并验外部引擎关着时不能搜。
- 隔离 HOME/APPDATA 里 19 个文件全过：`metre-engine-ui` 12（`NODE_PATH` 借 Playwright）、`metre-engines-registry` 4、`metre-engines` 8、`metre-engines-bridge` 16、`metre-engine-task` 13、`user-settings`、`brand-ui`、`plugin-file-lists`、`code-health-ratchet`、`metre-board`、`metre-inject`、`metre-wording`、`metre-dispatch`、`metre-baton`、`metre-roles`、`metre-lock`、`metre-memory`、`metre-quiet`、`delegation-gate`。ratchet、`git diff --check` 过。
- 全量门禁 `tools/release-gate/run-tests.mjs`：本次 54 条失败，同一提交（c2ee5a73）的干净副本 53 条。多出的一条是 `session-lineage` 的「stop-and-archive does not interrupt an active parent and leaves it unarchived on timeout」，单独各跑 4 遍：本次挂 1 遍、干净副本也挂 1 遍——计时不稳，不是这次改的。
- 截图（存根页 + 真 Metre CSS + 真搜索结果，Edge，亮 / 暗）：菜单底下「＋ 更多引擎」、更多引擎列表、搜 qwen。第一版说明和许可证挤在一行，许可证被省略号截掉了，改成两行（说明一行，「许可证 · 怎么装」一行）。图在 `F:\Projects\super-pinkie\build\quick-run\e6\shot-*.png`（暗色里搜索框发白是存根页没设 `--metre-card`，真界面有）。

**没验的**
- 没真「加上」过任何一家（会下载第三方代码，要用户点头）：prepare 要多久、加好以后引擎服务报的状态（installed / setup / 有哪些登录方式）、真登录、真派一件活都没走过，只有单元测试。注册表引擎对话中途要求开网页授权（`server.acceptAcpRegistryUrlAuth`）没接。
- 「新工作树」没在真引擎里开过一段（只有浏览器测试和桥原有的单元测试）。
- 没在真碧琪界面里截图；Mac 没验。

**下一步**：等用户定 push（c2ee5a73 和这一条）、NOTICES 放关于页哪里、版本号 → 用户同意后挑一家注册表引擎真加一遍、登录、发一句话 → E8 同步给碧琪全局（PLAN 3.8）。

## 2026-11-23 晚 · E7 设置「连接」里的外部引擎总开关（AWS Quick 经 Quick 跑腿）

**做了什么**
- 设置「连接」里，在「Metre 模式下暂停消息渠道」下面加了一行「外部引擎」：打开 / 关掉（PLAN 3.6「引擎菜单和设置里各一处」）。原来只能在引擎菜单里打开，**关掉的入口以前没有，现在只在这里**。关掉要点两下（第一下提示正在跑的外部引擎对话和派出去的活也会停，4 秒内再点才关），走 `pinkie.engines.enable {on: false}`：引擎服务会停，下载过的留着。打开复用引擎台的 `enableEngines()`，第一次下载时这一行写「正在准备……」。
- 写法：`laolao-settings-user.js` 只留一个空位 `.pinkie-user-settings__engines`，带上它自己的 `row / setPressed`，再发 `pinkie:settings-engines` 事件；开关代码在 `laolao-metre-engine.js` 的 `mountSettings`。引擎台文件比设置页后加载时，会扫一遍已经建好的空位。设置页在健康基线上是 1637 行，不能变长：所以把同一文件里一处折成两行的 `element("p", …)` 合回一行，再加这一行，总行数不变。没有新的 `window.__` 全局名。
- `?v=metreengine7` → `metreengine8`。
- `docs/METRE-MODE.md`「打开和关掉」写了两处入口和关掉的后果。

**怎么验的**：`metre-engine-ui` 新加两条：静态检查空位和事件；真浏览器里先建空位、后加载引擎台，验证显示开关时不调 `enable`、点打开发 `{on: true}`、点一次关掉不关、点两次才发 `{on: false}` 并弹提示。`metre-engine-ui` 10 条全过，用的是本机 Edge：Playwright 从 `F:\Projects\super-pinkie\build\windows-runtime\node_modules\openclaw\node_modules` 借（设 `NODE_PATH`，仓库里没装 Playwright，不设的话 7 条浏览器测试会写「Playwright is not installed here」后跳过；上一条记录说的 3 条就是这个原因）。另外在隔离的 HOME/APPDATA 里跑了 15 个文件，全过：`user-settings`、`brand-ui`、`motion-preference`、`tuning`、`run-notify`、四个引擎测试、`plugin-file-lists`、`code-health-ratchet`、`metre-quiet`、`metre-lock`、`metre-board`、`metre-wording`、`metre-inject`。ratchet 和 `git diff --check` 也过了。

**没验的**：没在真碧琪的设置页里截图，也没真下载一遍。

**下一步**：E7 剩下的：NOTICES 放进关于页（放哪还要定）、版本号（发版要用户点头）→ E6 → E8。

## 2026-11-23 晚 · E7 文档和许可声明草稿（AWS Quick 经 Quick 跑腿）

**做了什么**
- `docs/METRE-MODE.md` 在「派发（Baton）和独做（Virtuoso）」后面加了一节「外部引擎」，共 62 行。内容：是什么、打开和关掉、选引擎和登录（无痕窗口、多账号）、引擎台、放手程度四档（说明照 `engines-bridge.mjs` 的 `LEVELS`）、乐手、`pinkie_engine_task` 派活和交回、额度用完和没登录。这一节里不出现对方项目的名字。
- 新建 `briefs/metre-engines-1122/NOTICES-draft.md`：中英各一段许可声明（引擎服务 MIT；OpenMausBot 只借了功能设计，Apache-2.0，没搬 `enterprise/` 也没搬代码），附 MIT 全文。版权行「Copyright (c) 2026 T3 Tools Inc.」取自对方仓库加许可证的提交 4916dad；本机发布包里没有 `LICENSE`，所以没能和 0.1.11 逐字对照。草稿末尾有「拿不准的地方」，放进关于页前删掉。

**怎么验的**：文档里写的功能都对照了代码（置顶归档 `thread.pin/archive`、工作树 `workspaceStrategy`、四档文字、`T3_VERSION = 0.1.11`、几个 `engines-*.mjs` 的路径）。在隔离的 HOME/APPDATA 里跑了 18 个测试文件，全部通过：`metre-engines` 8、`metre-engines-bridge` 16、`metre-engine-task` 13、`metre-engine-ui` 3、`brand-ui` 6、`artifacts-project` 7、`plugin-file-lists`、`code-health-ratchet`、`metre-board` 14、`metre-inject`、`metre-wording`、`metre-dispatch` 19、`metre-baton`、`metre-roles` 17、`metre-lock` 9、`metre-memory`、`metre-quiet`、`delegation-gate`。`tools/health/ratchet.mjs` 和 `git diff --check` 也过了。

**没验的**：`metre-engine-ui` 这次只跑出 3 条（之前是 8 条），多半是隔离环境里找不到浏览器，真浏览器的那几条被跳过了。没跑全量门禁，因为这次只改了文档。

**下一步**：E7 剩下的：设置页里的第二个「外部引擎」开关（现在只在引擎菜单里有）、把 NOTICES 放进关于页（放哪还要定）、版本号（发版前要用户点头）→ E6 更多引擎 → E8。

## 2026-11-23 下午 · 会话 83379188 · E4 派活给外部引擎、E5 乐手、侧栏标引擎名（c19a8b9e）

**做了什么**
- **侧栏标引擎名**：用外部引擎的 Metre 会话，行里标账号名（「Claude Code · Metre」）；Metre 派出去的活标「引擎 · 模型」（「Antigravity · Gemini 3.8 Flash」），在跑的左边一道强调色。做法是按 `data-session-key` 写一张样式表 `style#pk-eng-side`（标签是标题那一行的 `::after`，地方不够时标签先让），**没碰 `laolao-session-list.js`**。数据：新网关方法 `pinkie.engines.sessions`。写在 `laolao-metre-engine.js` 里（没开新文件，省得 head 再加行）。
- **E4 `pinkie_engine_task`**（新文件 `engines-task.mjs`）：只在 Baton 下、外部引擎打开时出现；子会话里不出现。`engines` 列能用的引擎、模型、乐手；`start` 开一件活：在 Metre 父会话下面建一个子会话 `agent:metre:pinkie-child:…`（血缘 `kind: 'external'`，绑同一个项目文件夹），引擎台的 `sessions.json` 记好引擎和对话，所以**侧栏挂在父会话下、点开就是它的引擎台、总谱里是一个声部，全用现成的**；`launchThread` 不等。`say / stop / show`。和 `pinkie_session_start` 共用：在跑上限、一次请求上限、一轮 6 个、「不是用户这一轮不能派」、暂停分谱、Virtuoso 不给。
- **守望**：每 5 秒看在跑的外部活（`setTimeout` 链，没活就停）。做完 → 汇报卡片（最后的回话 + 改了哪些文件）+ 叫醒 Metre（`lineage.report` + `defer`）；没做成 → 失败卡片（额度、原因大白话）、侧栏出错；等人批准/回答 → 一张「等你」卡片、侧栏「等你」；全体收住 → 也停它；开了 90 秒没起跑、引擎服务停了约 1 分钟 → 算没做成。用户在这件活的引擎台或总谱「发消息」递话 → 重新盯着，做完再交一次。
- **血缘只改了两行（同一行里改，不加行数）**：`busy()` 认外部活（`externalBusy`），所以在跑上限、看门狗等子会话、总谱「在奏」都对；`isChildDelegation` 认 `pinkie_engine_task`（交付门禁不把「交给引擎了」当成没干活）。Baton 把它算真的派出去；Virtuoso 拦它。角色子会话不给它。Metre 给外部活发 `pinkie_session_message` 会被拦下，指到 `pinkie_engine_task say`。
- **总谱**：外部声部写「引擎 · 模型」、在做什么（「改 e4.md」「跑 printf …」），时间条从交出去到交回一整段；「发消息」走 `pinkie.engines.say`（原来是 `chat.send`，会在子会话里跑一轮 Metre）。
- **引擎台**：派来的活顶上一行「Part · Metre 派给 X 的活，做完会自动交回」+「回到 Metre ›」。
- **E5 乐手**（新文件 `engines-players.mjs`，存 `<引擎目录>/players.json`）：名字 + 引擎（账号）+ 模型 + 放手程度 + 可选的 Metre 角色卡。引擎菜单里「乐手」一组一键选用，「＋ 把现在这一套记成乐手」，× 点两下删。派活写 `player`（名字或 id）就用它那一套；另写了别的引擎就不带乐手的模型。角色卡的正文放在简报前面（引擎看不到 Metre 的角色系统）；血缘里记 `metreRolePersona`，不记 `metreRole`（那是 roles 代理子会话的检查）。放手程度四档 E3 已有。
- 顺手修：`metre-lock` 测试一直挂着一条（`registerMetreBoard` 没有状态目录时 `path.dirname(undefined)`）；现在没有状态目录就不建引擎服务。

**怎么验的**
- 测试 16 个文件全过：`metre-engines` 8、`metre-engines-bridge` 16、**`metre-engine-task` 13（新）**、`metre-engine-ui` 8（新加侧栏标签、乐手菜单两条真浏览器）、`metre-board` 14、`plugin-file-lists`、`code-health-ratchet`、`metre-roles` 17、`metre-baton` 7、`metre-dispatch` 19、`delegation-gate` 11、`metre-lock` 9、`metre-inject`、`metre-memory`、`metre-quiet`、`metre-wording`；`node tools/health/ratchet.mjs` 过。
- **隔离碧琪真派一件活**（会话草稿 `e4run.py`）：对 `agent:metre:e4-test2` 说「用 pinkie_engine_task 交给 Antigravity · gemini-3.8-flash 新建 e4.md」。Metre（`mm/workbuddy/hy4flash-free`）27 秒交出去 → 子会话出现在父会话下 → `pinkie.engines.sessions` 报 running、在做「想」→ 总谱声部「Antigravity · Gemini 3.8 Flash · 改 e4.md」→ **91 秒汇报卡片回来**（「E4 派活测试 做完一轮」）→ 总谱「已交回」→ 叫醒 Metre 的那一轮发出去了。
- 真界面截图（Edge，`e4shot.mjs`，亮/暗）：侧栏子行带「Antigravity · Gemini…」标签、子任务的引擎台、总谱声部。和原版的并排图：`side-session-notes/…/e4-compare-sidebar.png`（原版每条对话一张卡、状态字 + 引擎小图标；Metre 标「引擎 · 模型」文字）。只在本机，含对方标志，不进仓库。

**没验的 / 发现**
- 叫醒的那一轮在隔离副本里**没跑起来**：副本的默认模型 `mm/workbuddy/hy4free` 不在本机模型池的 Key 范围里（404），CLI 那一轮是用 `--model hy4flash-free` 跑的，叫醒用的是默认模型。不是派活代码的问题；以后在副本里跑先把默认模型换成 `hy4flash-free`（或给会话 `sessions.patch` 一个模型）。`drive.py` 的默认 `METRE_ISO_MODEL` 是 `mm/claude-opus-4-7`，跑之前要设成免费的。
- 等人批准/回答、失败、全体收住、乐手派活：只有单元测试，没在真引擎里走（要「每步都问」的真审批，额度也要花）。
- 侧栏子行地方窄：标签常被截成「Antigravit…」；全名在总谱和引擎台里。
- Mac 没验。

**下一步**：E6「更多引擎」（ACP 注册表：`server.searchAcpRegistry` / `server.prepareAcpRegistryAgent`，搜到再加进菜单）+ 引擎台清单剩下的项 → E7 设置开关 / 关于页许可 / `docs/METRE-MODE.md`「外部引擎」一节（**用户 11-23 问能不能让一个只能跑 Python 的 Opus 窗口帮忙省额度：E7 的文档和许可文字适合交给它**——写一份完整说明文件放会话备注目录，用户在那个窗口贴一句「读这个文件照着做」，做完 Claude 检查、跑测试）→ E8 同步给碧琪全局。

## 2026-11-23 · 会话 42f0bde1 · 隔离碧琪里真界面跑通 Antigravity 和 Claude（18940636）

**隔离副本**：`METRE_ISO_ROOT=F:\metreiso\eng`，网关端口 8712（`tools/metre/iso/setup.py` 建，`gateway.py start|stop`，改了插件 `setup.py sync`，改了界面 `tools/ui-parity/bundle.py install --control-ui F:\metreiso\eng\runtime\node_modules\openclaw\dist\control-ui`）。
- **引擎目录在 `F:\metreiso\eng\local\SuperPinkie\engines`**（副本的 `PINKIE_STATE_ROOT` 是 `<ROOT>\local\SuperPinkie`，不是 `home\AppData\Local`——第一次拷错了地方）。从 `F:\t3probe\e1\root` 拷了 `versions` 和 `home`（含 Antigravity 登录和 `claudeAgent-2` 实例），`prefs.json` 写 `{"enabled":true}`，所以不用重下、不用重登。
- 直接调网关方法：会话草稿 `isocall.py <方法> [json]`（借 `drive.py` 的 `gateway call`，邮箱打码）。真界面截图：会话草稿 `isoshot.mjs`（Edge 1280×820，网址带副本令牌 `#token=`）。内置浏览器面板被藏起来时截图是旧的、画不出浮层，看真界面用 `isoshot.mjs`。

**在真引擎台里做的**：会话 `agent:metre:engine-test`。Antigravity · Gemini 3.8 Flash：新建 `hello.md` 写一行，45 秒做完（you / note / 思考了 3 秒 / 改 hello.md / 回话）。换一段新对话交给「Claude Code · Metre」· Haiku 5.5：末尾加一行，40 秒（跑命令 / 用 Read / 思考 / 改 / 回话）；再加「第三行」，10 秒，Claude 用 `printf >>` 改的。改动面板显示 `hello.md +1 −0` 和真差异。

**真界面里发现并修了（都有测试，61→64 条相关测试全过）**
- 菜单说「外部引擎没打开」：`pinkie.engines.catalog` 等只带了 `service.status()`，没带总开关。现在 `registerEngineBridge` 收 `isEnabled`，所有返回引擎清单的方法都带 `enabled`。（测试原来一直手写 `enabled: true`，漏掉了。）
- Antigravity 显示「额度用完了」：它按模型分额度条（「Gemini 4 Argon · Weekly」满了，Gemini 整体 73%、Claude & GPT 50%）。`quota(usageLimits, models)` 现在分清整个账号的条和某几个模型的条：只有某几个模型满了，整家照常能用，模型菜单里把那几个模型放暗、写「额度用完了，几号恢复」；所有模型都满了才算整家用完。
- Antigravity 报的路径是 `/F:/…`、不给行数：去掉斜杠、显示相对会话文件夹的路径；没行数的写「1 个文件」/「改了」，不写 +0 −0。
- Claude、Antigravity 在非 git 文件夹里都只报文件名、没有差异：Metre 自己的草稿文件夹现在第一次用时 `git init` + 一个空提交（用户绑的项目文件夹不碰），引擎服务就能按检查点算整段差异；改动面板的文件清单和 +/− 从差异里数（覆盖用命令改文件、没有「改文件」那一行的情况）。
- 回话里 `[hello.md](file:///…)` 显示成文件名，不放打不开的链接。
- 改动面板开着时底下一排挤得字断行：改成排不下换到第二排，字不断。

**还没做 / 发现**
- 改动按钮在差异读回来之前写「改动」（只有命令改文件时，条目里没有文件）；点开就有。以后可以跑完自动读一次差异。
- 用户登录的 Claude 和这个 Claude Code 会话是同一个 Pro 账号，额度共用（11-23 用了 41%→59%，大部分是这个会话自己）。
- 副本还开着（网关 8712 + 引擎服务 3790）；不用时 `gateway.py stop`。

**下一步**：侧栏标引擎名、和对方原版的并排对比图 → E4 `pinkie_engine_task`（Metre 派活给外部引擎）→ E5 乐手 → E6 「更多引擎」→ E7 → E8。

## 2026-11-23 上午 · 会话 42f0bde1 · Claude 多账号真登录、真回话

- 用户在 Edge 无痕窗口里登录了 Claude（Pro 订阅），登录进的是 Metre 自己的账号文件夹 `~/.claude-metre-2`（实例 `claudeAgent-2`，「Claude Code · Metre」）。用户的 `~/.claude` 没动（登录文件里还是只有设备令牌）。
- 报上来 14 个模型（claude-opus-5-5 默认、sonnet-5-5、fable-5-2 …、haiku-5-5、haiku-4-5）。用最便宜的 claude-haiku-5-5 发「只回复两个字：收到」，约 6 秒回「收到」。
- 到现在有两个能跑真活的引擎：Antigravity（默认账号）和 Claude（`claudeAgent-2`），都在试验目录 `F:\t3probe\e1\root` 的引擎服务里，不在用户装的碧琪里。Codex 额度 11-26 17:44 恢复。
- 脚本在会话草稿 `claudeprobe.mjs`。

**下一步（按顺序）**
1. 在引擎台界面里用 Antigravity / Claude 真跑一段（隔离网关 `tools/metre/iso`，`METRE_ISO_ROOT` 放 F: 纯英文路径；把 `F:\t3probe\e1\root\versions` 拷过去省得重下）——验对话流、改文件、待批准卡片、改动面板；用户的登录要在隔离副本里重登一次（或把副本的引擎目录指到 `F:\t3probe\e1\root`）。
2. 侧栏标引擎名、和对方原版的并排对比图。
3. E4 `pinkie_engine_task` → E5 乐手 → E6 「更多引擎」（ACP 注册表）→ E7 → E8 同步给碧琪全局。

## 2026-11-23 上午 · 会话 42f0bde1 · 多账号 + 登录一律开无痕窗口（923f3b8a）

**用户这一段**：「最好支持多账号登入，比如 Anti 我有几个 Pro，还有 Claude 也是」；「要登入 Claude 你开一个无痕浏览器给我登入，不要用我的浏览器」。

**做了什么**
- 一个账号 = 引擎服务里一个实例，id「<家>-<n>」（`ACCOUNTS` 表，`engines-bridge.mjs`）：Claude 每个账号一个 `~/.claude-metre-<n>` 文件夹（实例配置 `homePath` = `CLAUDE_CONFIG_DIR`）；Codex 每个账号一个 `~/.codex-metre-<n>` 影子文件夹（`shadowHomePath`，共用 `~/.codex` 的对话，照源码 `providers-codex.md`）；Antigravity、Cursor 由引擎服务按实例各自托管登录。其余六家用这台电脑上同一份登录，不给加。
- 动作：`pinkie.engines.account {action: add|rename|remove}`。加：`providerInstanceMutation: create`，名字可填（邮箱去掉），文件夹已有旧登录就换个新名字；删：托管登录的先 `provider.auth.logout`，再 `remove`，Claude / Codex 的登录文件夹留在磁盘上；默认账号不能删（可以关）。`turnOn / install / signin / setup` 都认实例 id（`resolve` 从引擎服务的设置里查是哪一家）。加出来的 Claude / Codex 账号登录时，终端里带上它自己的文件夹（Windows 用 spawn 的 env，Mac 写在命令前面），菜单里显示、复制的那一行也带文件夹。
- 无痕窗口：`privateBrowser()` 找 Edge（`--inprivate`），没有找 Chrome（`--incognito`），都没有才用默认浏览器。托管登录直接开；终端登录给一个 `private-browser.cmd/.sh` 启动器当 `BROWSER`（11-23 实测 `claude auth login` 认 `BROWSER`；Codex 等别的命令行认不认没验）。
- 界面（`?v=metreengine3`）：一个账号一行（同一家挨着，默认在前），「＋ 再加一个账号」→ 起名字 → 点哪一家 → 直接进这个新账号的登录；加出来的账号设置卡片底下「改名字 / 删掉这个账号」（点两下才删）。各处名字用引擎服务报的账号名。

**怎么验的**：测试 61 过（`metre-engines-bridge` 12，新加多账号和无痕窗口两条；`metre-engine-ui` 6，新加真浏览器里加账号、删账号一条；其余同上）；ratchet 过；截图看过菜单、加账号、账号设置卡片（亮 / 暗）。真机：建了 `claudeAgent-2`（「Claude Code · Metre」，文件夹 `~/.claude-metre-2`），登录终端开了，等用户在无痕窗口里登录——结果见下一条（如果这里没有下一条，就是还没登上）。
- 为什么 Claude 不登进 `~/.claude`：这台电脑上的 Claude Code 桌面 App 也读这个文件夹，往里写登录可能影响 App 自己的账号，所以 Metre 的 Claude 一律用自己的账号文件夹。

## 2026-11-23 上午 · 会话 42f0bde1 · Antigravity 真登录、真回话（第一次有引擎跑通整条）

**结果**：用户的 Antigravity Pro（Google 账号）经 Metre 桥真登录成功，报上来 9 个模型（gemini-4-neon / argon / hydrogen、gemini-pro-orchestrator-neon / g1-pro、gemini-3.8-flash、claude-opus-5-5、claude-sonnet-5-5、gpt-oss-120b-medium（默认））；用最便宜的 gemini-3.8-flash 开一段对话「只回复两个字：收到」，约 30 秒回「收到」，对话流是 you / note / reply。额度只花了这一句。

**真机发现并修了两个毛病（都有测试）**
- 刚打开 Antigravity 时引擎服务报 `status: ready`，原话是「装好了、Google 账号还没查」，没有模型。Metre 原来当成「能用」。改成：能在浏览器里登录的（`setup.canAuthenticate`）没登录就是「还没登录」。
- 这台电脑上 Antigravity 走「贴代码」登录：引擎服务给的是一个 `credentials` 交互，只有一个不保密的 `code` 框（源码 `AntigravityAuth.ts`）。原来 Metre 把它当「要填密钥」挡掉了。改成识别为贴代码一步，代码走 `provider.auth.respond {response: {type: 'credentials', values: {code}}}`（回调地址才走 `complete`）；界面提示「最后页面上会给一串代码，贴到下面」。
- 本机不用下载 Antigravity 运行包：引擎服务直接用了 winget 装的 `agy` 1.5.14（要求 ≥ 1.5）。

**测试方式（会话草稿 `antiprobe.mjs` + `codeprompt.ps1`）**：脚本开引擎服务、打开 Antigravity、开始登录、用系统浏览器打开登录页，并在用户桌面弹一个 PowerShell 小窗让用户自己贴代码，脚本读到就交给引擎服务、删掉临时文件、不打印——Claude 不经手代码。用户在聊天里发过一次代码，没用（那次登录作废重来）。
- 坑：`TaskStop` 只停了外层 shell，node 探针还活着，而且引擎服务被杀后它按「崩溃自动重启」又拉起来一个，导致下一次启动报 78。以后停探针要查 `node.exe` 命令行里的脚本名一起停。

**现在的状态**：试验目录 `F:\t3probe\e1\root` 里 Antigravity 已打开并登录（用户的一个 Google 账号），不在用户装的碧琪里。Cursor 已关回去。

**下一步**：多账号（PLAN 3.7 最后一条，用户有几个 Antigravity Pro 和 Claude）→ 在引擎台界面里用 Antigravity 真跑一段（隔离网关）→ 侧栏标引擎名、并排对比图 → E4。

## 2026-11-23 · 会话 42f0bde1 · E3b 十家引擎全部进菜单：打开、安装、登录

**用户这一段的两句话**
- 「把人家支持的都加上比如 Cursor 等这些都加」→ 做了，见下。PLAN 3.7、分批 E3b。
- 「T3 和 bot 这种主要功能是给 Metre 的，但是里面也有很成熟的工具 / 功能 / 可视化命令前端功能按键……也可以同步给碧琪（全局）」→ 写进 PLAN 3.8、分批 E8（Metre 里验过的部件写成不绑 Metre 的通用部件，再按碧琪的样子接到全局；不动老模式已有行为）。还没动手。

**做了什么**
- `engines-bridge.mjs`：`ENGINES` 从 3 家扩到 10 家（Claude Code、Codex、Antigravity、Cursor、OpenCode、Grok Build、Kiro、Pi、fx、Muse Code），每家带官方安装命令（win / mac / any，官方没给的系统只给链接）、登录命令、说明链接、要付费之类的提示。`engineState` 把每家说成大白话：能用 / 还没打开 / 这台电脑上还没装 / 还没登录 / 别的毛病（引擎服务的英文原话里 “disabled in T3 Code settings” 这类不再露出来）。引擎服务没报上来的（Antigravity 从没打开过时）也列出来，算「还没打开」。
- 新动作：`turnOn`（照引擎服务自己设置页的做法 upsert 这一家的实例配置、保留原有配置，再 `server.refreshProviders {instanceId}`）；`install`（Antigravity 走托管 `provider.install.start` + 订阅进度；其余给官方命令，用户点了才开终端）；`signin`（Antigravity、Cursor 走托管 `provider.auth.start` + 订阅；其余开终端跑官方登录命令）；`signinStep`（open：要同意的先替用户点同意，再用系统浏览器打开登录页，只放 https；paste：把登录页给的代码转给 `provider.auth.complete`，不存；cancel）。要填密钥的登录方式不在 Metre 里做。终端只跑表里写死的命令；Windows 上 `irm … | iex` 开 PowerShell，其余开命令行窗口（npm 的 .ps1 常被执行策略挡）。网关方法：`pinkie.engines.turnOn / install / setup`，`signin` 改成新的。`engines.mjs` 拆出 `readProviderFiles`。
- 界面 `laolao-metre-engine.js/.css`（`?v=metreengine2`）：引擎菜单分「能用」和「还要设置一下」两组；没设置好的一家一行（名字左、状态右、›），点进去是这一家的设置卡片：打开 → 装（命令 + 复制 + 在终端里装 / 托管进度条）→ 登录（终端命令，或托管的「打开登录页 / 贴代码 / 取消」）→ 选模型。引擎台顶上的旧「登录 Claude」卡片换成同一张设置卡片（同一个引擎复用同一张，刷新不会冲掉正在登录的那一步）。

**怎么验的**
- 测试 59 过：`metre-engines` 8、`metre-engines-bridge` 11（新加：十家顺序和状态、托管登录一步步、开关保留原配置、终端白名单、浏览器链接只放 https）、`metre-engine-ui` 5（**真浏览器那条这次跑起来了**，另加一条真点菜单：十家分组、打开 Cursor、在终端里装、Antigravity 贴代码）、`metre-board` 14、`plugin-file-lists`、`code-health-ratchet`、`metre-roles` 17；`tools/health/ratchet.mjs` 过。
  - 浏览器测试的跑法：`npm install playwright-core@1.49.1 --proxy http://127.0.0.1:7897` 装到会话草稿的 `deps/`，然后 `NODE_PATH=<deps>/node_modules node --test tests/metre-engine-ui.test.mjs`（用本机 Edge）。
- 真引擎服务（`F:\t3probe\e1\root`，脚本在会话草稿 `probe.mjs` / `authprobe.mjs` / `watchprobe.mjs`，只打印 id 和状态）：十家都列出；Cursor 真打开 → 变成「还没登录」→ 真关回去；Cursor 托管登录真走到「等你在浏览器登录」并拿到 https 登录页，取消也对。
- 截图（存根页 + 真 Metre CSS，Edge，亮 / 暗）：菜单、Cursor 安装卡、Antigravity 登录卡，看过并修了两处（托管按钮撑满一行、一家一行的箭头和状态位置）。

**发现**
- 本机的 Claude Code 命令行**其实没登录**：`~/.claude/.credentials.json` 里只有设备令牌，`claude auth status` 是 `loggedIn: false`（那是桌面 App 自己的登录，命令行用不了）。之前「Claude 没登录」不是 HOME 的问题——E1 服务代码用的就是用户的 HOME。
- Codex 已登录但额度用完（11-26 17:44 本地时间恢复）。其余八家本机都没装或没打开。所以目前没有一个引擎能跑真活：要么用户跑一次 `claude auth login`（之后用最便宜的模型发一句话验证，额度花得很少），要么等 Codex 恢复。

**没验的**
- 没在用户的真碧琪界面里点（只在存根页和测试里）；隔离网关整条走一遍还没做。
- 托管安装（Antigravity 运行包）没真装——没打开 Antigravity；终端安装命令没真跑（不替用户装东西）。
- Mac 上的终端命令只有单元测试。

**下一步（按顺序）**
1. **多账号**（用户 11-23 刚提，PLAN 3.7 最后一条）：Antigravity、Claude 一个账号一个实例，菜单里「加一个账号」。和下面第 2 条可以一起做。
2. 用户登录 Claude Code 后：用 Haiku 之类最便宜的模型在引擎台真发一句话，验对话流和改动面板；然后侧栏标引擎名、拼并排对比图。
3. 隔离网关真调一遍（`tools/metre/iso`，`METRE_ISO_ROOT` 放 F: 纯英文路径；把 `F:\t3probe\e1\root\versions` 拷过去省得重下）。
4. E4 `pinkie_engine_task` → E5 乐手 → E6 「更多引擎」（ACP 注册表）→ E7 → E8 同步给碧琪全局。

## 2026-11-22 深夜 · 会话 42f0bde1 · 查清「把对方支持的引擎都加上」（只查没写代码，用户额度到了）

**用户这一句**：「记得把人家支持的都加上比如Cursor 等这些都加」→ 引擎菜单不止 Claude Code / Codex / Antigravity，T3 支持的全部要有。

**T3 一共 11 家**（`packages/contracts/src/model.ts` 的 `PROVIDER_DISPLAY_NAMES`，实例 id = 驱动名）：

| id | 显示名 | 默认模型 | 怎么装 | 怎么登录 |
|---|---|---|---|---|
| claudeAgent | Claude Code | claude-opus-5-5 | `npm i -g @anthropic-ai/claude-code` | `claude auth login` |
| codex | Codex | （服务给的 isDefault） | 引擎服务托管安装，或 `npm i -g @openai/codex` | `codex login`（或 ChatGPT 托管登录） |
| antigravity | Antigravity | antigravity-default | **托管**：`provider.install.start/subscribe` | **托管**：`provider.auth.*`（浏览器 + 回贴代码） |
| cursor | Cursor | auto | Win `irm 'https://cursor.com/install?win32=true' \| iex`；Mac `curl https://cursor.com/install -fsS \| bash`（可执行文件叫 `cursor-agent`） | **托管浏览器登录**（`setup.canAuthenticate: true`），或 `agent login`；要付费 Cursor 套餐 |
| opencode | OpenCode | openai/gpt-5 | `npm i -g @opencode/cli`（2.x）或 opencode.ai | `opencode auth login` |
| grok | Grok Build | grok-build | x.ai/cli（命令待查准） | `grok login` |
| kiro | Kiro | default | Win `irm 'https://cli.kiro.dev/install.ps1' \| iex`；Mac `curl -fsSL https://cli.kiro.dev/install \| bash` | `kiro-cli login` |
| pi | Pi | default | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`（Node ≥ 22.19） | 终端跑 `pi` 再输 `/login` |
| fx | fx | default | `curl -fsSL https://fx.sh/setup.sh \| bash`（Windows 待查） | `fx login` |
| muse | Muse Code | default | dev.meta.ai/docs/muse-code | `muse login` |
| acpRegistry | 更多引擎（ACP 注册表） | default | `server.searchAcpRegistry` / `server.prepareAcpRegistryAgent`（搜到再加） | 各家自己的 |

（资料：T3 源码 `docs/user/install.md#providers`、`providers-*.md`、`cursor.md`；源码在 `F:\t3probe\src\t3code`，只读。）

**已查清的命令（下一步直接用）**
- 每家的状态里有 `setup: {canInstall, canAuthenticate}`：现在只有 Cursor `canAuthenticate`；Antigravity / Codex 的托管安装在 `apps/server/src/provider/providerInstallation.ts`（只这两家）。其余七家：**开开关 + 本机装命令行 + 终端登录**。
- 开 / 关一个引擎：`server.updateSettings {patch: {}, providerInstanceMutation: {operation: 'upsert', instanceId, instance: {...旧的 settings.providerInstances[id] ?? {driver: id}, enabled: true}}}`，然后 `server.refreshProviders {instanceId}`（照 T3 `WelcomePage.tsx` 的 `turnOn`）。旧配置从 `server.getConfig` 返回的 `settings.providerInstances` 读。要 `providers:manage` 权限（令牌里已有）。
- 托管登录：`provider.auth.subscribe {instanceId}`（流）给出 `phase / methods / interaction`；`provider.auth.start {instanceId, methodId?}`；`interaction` 四种：`browser {url}`（在用户浏览器打开）、`deviceCode {url, userCode}`（显示代码）、`terminal`（我们不用，改开自己的登录终端）、`credentials {fields}`（要用户填密钥——**不做**，计划写了碧琪不经手凭据，提示用户改用浏览器或终端登录）；回贴代码走 `provider.auth.complete {instanceId, flowId, callbackUrl}`；取消 `provider.auth.cancel`。合同在 `packages/contracts/src/providerSetup.ts`。
- 托管安装：`provider.install.start {instanceId}` + `provider.install.subscribe`（`phase downloading/extracting/verifying/succeeded/failed`，`downloadedBytes / totalBytes` 做进度条）。
- 试验服务 `F:\t3probe\e1\root\home\caches` 已经有 cursor / opencode / grok / kiro / pi / fx / muse 的缓存，都是 `status: disabled`、`installed: false`；没有 antigravity 和 acpRegistry 的缓存（没开过）。
- **可疑点，先查**：claudeAgent 缓存的 `continuation.groupKey` 指向 `F:\t3probe\e1\tmphome\.claude`——E1 试验时引擎服务的 HOME 被换成了临时目录，所以「Claude 没登录」可能只是读不到用户真正的登录。查 `engines.mjs` 启动时是否改了 `HOME / USERPROFILE`；真用户环境下引擎服务必须用用户自己的 HOME，否则所有终端登录都对不上。

**下一步（按顺序）**
1. `engines-bridge.mjs`：`ENGINES` 扩成上表 10 家（不含 acpRegistry），每家带 `install: {win, mac, link}`、`signin: {how: 'terminal'|'managed'|'both', command}`；`summarizeProviders` 带上 `setup`、`enabled`；`openLoginTerminal` 的命令白名单放宽到上表的登录命令（现在的正则 `^[a-z]+ (?:auth )?login$` 挡不住 `kiro-cli login`、`pi`）。新网关方法：`pinkie.engines.turnOn {engine, on}`、`pinkie.engines.install {engine}`（托管的走 `provider.install.*`，命令行的开终端跑安装命令，**跑之前界面要让用户点头**）、`pinkie.engines.signin` 托管分支（`provider.auth.start` → 把 `browser` 的链接 / `deviceCode` 交给界面，回贴代码走 `complete`）。
2. 界面 `laolao-metre-engine.js`：引擎菜单按「能用 / 没开 / 没装 / 没登录」分组，没开的显示「打开」，没装的显示安装命令 + 复制 + 「在终端里装」，托管的显示进度条；界面上不出现 T3 字样（`brandless` 已管服务传回的话，新加的「disabled in T3 Code settings」这类要换成「还没打开」）。
3. 测试：`metre-engines-bridge` 加「10 家都在菜单里、顺序固定」「turnOn 发的是 upsert + refresh」「托管登录的浏览器链接只放 https」；然后接回上一条的下一步（浏览器测试、侧栏标引擎名、并排对比图、隔离网关真调）。

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
