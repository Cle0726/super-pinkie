# DSH-COMPAT：dsh 插件兼容层可行性评估（PLAN K7-3）

> 依据：`briefs/cle-core-1120/PLAN.md` 第五节第 3 条、`ACCEPTANCE.md` K7-3。
> 评估日期：2026-11-27。只读源码，未安装、未运行任何插件。

## 结论（先看这里）

- **0 / 10** 个插件只用到「工具注册（`ctx.tools`）/ 凭据（`ctx.credentials`）/ 文件（`ctx.fs`）/ 网络（`ctx.web`）」这四类服务，**远低于 PLAN 要求的 ≥ 6 个**。
- 即使把宿主 HTTP 服务 `ctx.webServer` 也宽松地算作「网络」，结果仍是 0 / 10：每个插件都至少还用到界面插槽（`slots` / `layout` / `theme` 等）、会话（`sessions` / `sessionController`）、模型（`llm`）、系统提示词（`systemPrompt`）或主循环钩子（`agent/pre-step`）里的一项。
- 原因很集中：按星数排前 10 的「真正要 dsh 才能跑」的插件，全部属于 PLAN 第 162 行明确不支持的类别——**模型接入、桌面壳 / 界面、插件市场、替换主循环或会话**。
- 因此**按计划不做 `packages/dsh-compat`**。PLAN「六、待用户点头」第 171 行：达不到标准时做还是不做，由用户决定。本文件只给依据，不做决定。

## 1. 评估方法

1. **对接的 dsh 版本**：`deepseek-ai/deepseek-harness` 标签 `dsh-v0.2.2-rc.5`（提交 `9c2670d3bce5275e0d1610272958121af87787bb`，PLAN 第 57 行记的 11-20 最新版）。评估当天上游已有 `v0.2.3-alpha.2`（2026-11-22，预发布），本文不跟进。
2. **服务名对照**：在 dsh 源码里找每个 `declare module ... interface Context { ... }` 扩展，确认各类服务挂在 `ctx` 上的名字（见第 2 节）。
3. **选插件**：`gh search repos --topic dsh-plugin --sort stars`（2026-11-27 取前 100），按星数从高到低，排除技能（SKILL.md）、MCP 服务、独立软件、清单 / 镜像仓库，取前 10 个。判断「真要 dsh」的依据是仓库里有 Cordis 插件入口：`package.json` 的 `dsh` 字段 / `cordis.patch.yml`，以及对 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-*` 的依赖。
4. **列服务**：对每个插件，以源码里的 Cordis 注入声明（`export const inject = [...]`、`cordis.patch.yml` 的 `inject:`、`ctx.inject([...])`）为准，再用 `ctx.<服务>.<方法>` 调用点和 `ctx.on('<事件>')` 事件钩子补充。下表「源码依据」都是 `仓库内路径:行号`，对应下面记录的提交。
5. **不计入的东西**：Cordis 框架自带成员（`effect` / `on` / `emit` / `get` / `inject` / `provide` / `plugin` / `logger` / `loader` 等）；canvas 2D 上下文里同样叫 `ctx` 的变量（`fillStyle`、`drawImage` 等）；测试、文档、示例、打包产物里的出现。

### 1.1 本次读过的源码版本

| 仓库 | 提交 |
|---|---|
| deepseek-ai/deepseek-harness（标签 dsh-v0.2.2-rc.5） | `9c2670d3bce5275e0d1610272958121af87787bb` |
| Ebony-Vinyl/dsh-our-free-model | `e72860ed266851465516e761fa021cfbccb0be87` |
| anywhere-labs/dsh-desktop | `737373896069590dfa531d68b32901730c3a5e34` |
| dataelement/dsh-desktop | `947e92763f129529a17f836519487e3f024058be` |
| dsh-market/dsh-market | `18004a19b1c5bca1cd3ea405e2171a5fb3c089ce` |
| kingcharleslzy-ai/dsh-purge | `52677937eeea01eb15d3f65f55c1b23b1eb1ed83` |
| zhu1090093659/dsh-web | `a0ec7fffd7583611a9931f001c25a08502b1ead3` |
| Fei-Craft/DS-Bot | `ca0116af3bde8888e13910df2bb9add3800f390a` |
| ccch1mneyyy/dsh-TUI | `bf8a23c717c7b066190ceb39420cb80614fbc184` |
| elysia395/dsh-wallpaper-engine | `6047dcd29c06004960528cf7d3a4a711869c1f26` |
| MeteorNOX/DeepSeek-Balance-Whale-Widget | `5247dd6813d6e4430728f39ccc63d43cda046022` |

## 2. dsh 宿主服务与「允许类」

判断标准里的四类服务在 dsh-v0.2.2-rc.5 上的名字：

| 类别 | `ctx` 上的名字 | dsh 源码依据 |
|---|---|---|
| 工具注册 | `tools` | `packages/core/tools/src/index.ts:33` |
| 凭据 | `credentials`（另有 `authorization`） | `packages/credentials/credentials/src/index.ts:149`、`packages/credentials/authorization/src/index.ts:44` |
| 文件 | `fs` | `packages/fs/fs/src/index.ts:54` |
| 网络 | `web`（搜索 / 抓取提供方） | `packages/web/web/src/index.ts:42` |

常见的**不在允许类**里的服务（出现任一项即不达标）：

| 服务 | 含义 | dsh 源码依据 |
|---|---|---|
| `llm` | 模型接入 / 模型调用 | `packages/llm/llm/src/index.ts:59` |
| `systemPrompt` | 系统提示词 | `packages/core/system-prompt/src/index.ts:14` |
| `agentLoop`（及 `agent/pre-step` 等事件） | 对话主循环 | `packages/core/agent-loop/src/index.ts:176` |
| `sessions` | 会话记录 | `packages/core/session/src/index.ts:39` |
| `sessionController` / `sessionTitle` / `sessionPersistence` | 会话控制与持久化 | `packages/api/session-controller/src/index.ts`、`packages/session/session-persistence/src/index.ts` |
| `webServer` | 宿主 HTTP 服务（挂页面、挂路由） | `packages/host/webserver/src/index.ts:31` |
| `subprocess` / `shell` | 执行命令 | `packages/subprocess/subprocess/src/index.ts:90`、`packages/shell/shell/src/index.ts:31` |
| `commands` | 斜杠命令 | `packages/interaction/commands/src/index.ts:114` |
| `settings` | 插件设置表单 | `packages/settings/settings/src/index.ts:39` |
| `workspaceRegistry` | 工作区 | `packages/workspace/workspace/src/index.ts:114` |
| `slots` / `locale` / `layout` / `theme` / `uiConversation` / `uiWorkspace` 等 | 客户端界面 | `packages/client/*`（例如 `packages/client/locale/src/client/index.ts`） |

`webServer` 只有在第 4 节「宽松口径」里才被算进「网络」。

## 3. 选出的 10 个插件

| # | 仓库 | 星数（11-27） | 类型 | 为什么算「真要 dsh」 |
|---|---|---|---|---|
| 1 | Ebony-Vinyl/dsh-our-free-model | 89077 | 模型接入 | `index.js:115` 声明 Cordis `inject`，入口靠 `ctx.llm` 注册模型 |
| 2 | anywhere-labs/dsh-desktop | 36961 | 桌面壳 | `dsh-plugin-desktop/package.json:4`：「an Electron shell composed as a DeepSeek Harness Cordis plugin」 |
| 3 | dataelement/dsh-desktop | 20280 | 桌面壳 | `package.json:4`：「A cross-platform desktop shell for DeepSeek Harness.」，子包都是 Cordis 插件 |
| 4 | dsh-market/dsh-market | 13669 | 插件市场 | 「The plugin market inside DeepSeek Harness」，`src/client/index.ts:128` 声明 `inject` |
| 5 | kingcharleslzy-ai/dsh-purge | 13208 | 改主循环 / 提示词 | `package.json:87` 的 `dsh` 字段、`peerDependencies` 里的 `@deepseek-ai/cordis`（`package.json:129-130`） |
| 6 | zhu1090093659/dsh-web | 10668 | Web 界面插件合集 | `packages/*` 下 20 个子包都依赖 `@deepseek-ai/dsh-*` |
| 7 | Fei-Craft/DS-Bot | 9143 | 多机器人 + 桌面 / 移动端 | `app/engine/package.json:21` 的 `dsh` 字段，钉 `@deepseek-ai/dsh-*` 0.2.2-rc.5 |
| 8 | ccch1mneyyy/dsh-TUI | 8360 | 终端界面 | `cordis.patch.yml:401`、`:412` 的 `inject:` |
| 9 | elysia395/dsh-wallpaper-engine | 8301 | 界面皮肤 | `package.json:149` 的 `dsh` 字段，`lib/index.js:175` 声明 `inject` |
| 10 | MeteorNOX/DeepSeek-Balance-Whale-Widget | 7488 | 界面挂件 | `package.json:31` 的 `dsh` 字段，`lib/index.js:749` 的 `root.inject([...])` |

### 3.1 星数更高、但被排除的仓库

| 仓库 | 星数 | 排除原因 | 怎么判断的 |
|---|---|---|---|
| morluto/rea | 480980 | CLI + MCP 服务，不依赖 dsh | 读了源码：`package.json:5`「one CLI and MCP server」，没有 `dsh` 字段，也没有 `@deepseek-ai/*` 依赖 |
| deepseek-ai/deepseek-harness | 288020 | 宿主本身 | — |
| ccch1mneyyy/dsh-Go | 33273 | 独立的 Flutter 手机 App | 读了源码：`README.md:267` 用 flutter 构建；仓库根目录没有 Cordis 插件入口，只有 `market/package.json:15` 一个市场索引 |
| awesome-dsh-plugin/awesome-dsh-plugin | 25781 | 精选清单 | 按仓库描述 |
| mmparko/dsh-purge | 6140 | 是 dsh-purge 的镜像，和第 5 名重复 | 按仓库描述 |
| tt-a1i/archify、alchaincyf/nuwa-skill、mvanhorn/last30days-skill、freestylefly/awesome-gpt-image-2、alchaincyf/huashu-design、titanwings/distilly、anbeime/skill、Tencent/BrowserSkill | — | 技能 / 提示词库 | 按仓库描述（PLAN 第 58 行也把 archify、nuwa-skill 归到技能） |
| nexu-io/open-design、tw93/Mole、reactive-resume、volcengine/OpenViking、Tencent/WeKnora、DayuanJiang/next-ai-draw-io、esengine/DeepSeek-Reasonix、rohitg00/agentmemory、yikart/AiToEarn、Molunerfinn/PicGo、walkinglabs/learn-harness-engineering、nocobase、nexu-io/openmotion、EverMind-AI/EverOS、MemTensor/MemOS、dataelement/bisheng、superdesigndev/treg、kunkundi/crossdesk、YaoApp/yao、plastic-labs/honcho、lingfengQAQ/webnovel-writer、Devin-AXIS/iPolloWork | — | 独立软件 / MCP / 记忆库 / 教程，只是为了曝光打了标签 | **只看了仓库描述，没有克隆源码** |

> 注意：最后两行只看了描述。如果其中某个其实是 Cordis 插件，它会挤进前 10。要让这份排名更稳，需要补读这些仓库的 `package.json`。由于前 10 名的结论是 0 个达标、离 6 个差得很远，这个误差不会改变结论。

## 4. 逐个插件：用到的 `ctx.*` 服务和源码依据

图例：✅ 允许类（`tools` / `credentials` / `fs` / `web`）；❌ 不在允许类。路径都是相对插件仓库根目录。

### 4.1 Ebony-Vinyl/dsh-our-free-model —— 模型接入（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `llm` | ❌ 模型接入 | `index.js:115` `export const inject = ['llm']`；`index.js:524` `ctx.llm.registerAdapter`；`:525` `registerConfigurableProviders`；`:534` `registerModelDiscovery` |
| `credentials` | ✅ | `vendor/channel-pack/src/index.ts:124` `inject = ['credentials', 'commands', 'llm']` |
| `commands` | ❌ | 同上 |
| `schedule` | ❌ | `vendor/channel-pack/src/loop-recovery.ts:35` |
| `slots` / `locale` | ❌ 界面 | `client.js:9940`、`client.js:9748` |

另外：仓库描述是「完全免费，不限量」使用各家前沿模型，正好是 PLAN 第 164 行点名的「来路不明的模型接入插件」，不能进任何推荐清单。

### 4.2 anywhere-labs/dsh-desktop —— Electron 桌面壳（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `webServer` / `appExit` / `settings` / `connection` | ❌ | `dsh-plugin-desktop/src/index.ts:84` |
| `slots` / `locale` / `connection` / `remote` / `sessions` / `theme` / `uiRenderer` | ❌ 界面 / 会话 | `dsh-plugin-desktop/src/client/index.ts:120-129` |
| `subprocess` | ❌ 执行命令 | `dsh-plugin-desktop/src/pnpm.ts:258` |
| `sessionController` / `workspaceRegistry` | ❌ 会话 | `dsh-acp-bridge/src/index.ts:17` |
| `profileContext` | ❌ | `dsh-desktop-next/src/extensions.ts:24` |
| `tools` / `systemPrompt` | ✅ / ❌ | `dsh-desktop-next/src/host/computer-use-command.ts:224`、`:228` |

### 4.3 dataelement/dsh-desktop —— 桌面壳（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `credentials` / `tools` | ✅ | `packages/dsh-image-generation/index.js:13`；`tools` 调用见同文件 `:85` |
| `connection` / `skills` / `systemPrompt` / `sandboxPolicy` / `sandbox` / `subprocess` / `sessionController` | ❌ | `packages/dsh-image-generation/index.js:13` |
| `agentPresets` | ❌ | `packages/dsh-desktop-client-ui/index.js:5` |
| `skills` | ❌ | `packages/dsh-desktop-office/index.js:10` |
| `slots` / `layout` / `uiWorkspace` / `sessions` | ❌ 界面 / 会话 | `packages/dsh-desktop-client-ui/client.js:338`；`packages/dsh-desktop-workbenches/client.js:615`、`:616`、`:1300` |
| `webServer` | ❌ | `src/host/index.ts:120` |

连其中最像工具的子包（生图）也要用到沙盒、命令执行、系统提示词和会话控制。

### 4.4 dsh-market/dsh-market —— 插件市场（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `slots` / `locale` / `theme` | ❌ 界面 | `src/client/index.ts:128` |
| `hmr` | ❌ 热重载宿主插件 | `src/self-reload.ts:14` |
| `shell` | ❌ 执行命令 | `src/dsh-cli.ts:6` |
| `configForms` | ❌ 界面 | `src/verify.ts:852` |

它本身就是 dsh 插件系统的管理界面，和碧琪自己的技能 / 连接器目录功能重复。

### 4.5 kingcharleslzy-ai/dsh-purge —— 改主循环与提示词（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `tools` | ✅ | `lib/index.js:61` `inject = ["systemPrompt", "tools"]`；`ctx.tools.register` 在 `lib/index.js:1717`、`:1738`、`:1774` |
| `systemPrompt`（及 `system-prompt/assemble` 事件） | ❌ | `lib/index.js:61`；`lib/index.js:764` `ctx.on("system-prompt/assemble", ...)` |
| 主循环事件 `agent/pre-step` | ❌ 替换主循环 | `lib/index.js:547`（`{ global: true, prepend: true }`）、`:860` |
| 会话事件 `session/created` / `session/event` | ❌ 会话 | `lib/index.js:683`、`:684`、`:709`、`:842` |
| `llm`（`llm/stream` 拦截） | ❌ 模型 | `lib/index.js:1492` `ctx.on("llm/stream", ...)`、`:1493` `ctx.llm.stream` |
| `agentPresets` | ❌ | `lib/identity.js:501` |
| `subprocess` | ❌ | `lib/core.js:425` |
| `webServer` | ❌ | `lib/redteam/ui.js:156` `inject = ['redteam', 'webServer']` |
| `slots` / `locale` | ❌ 界面 | `packages/purge-panel/src/entry.js:22` |

它确实注册工具，但核心做法是全局拦截主循环的每一步、系统提示词组装和模型流（仓库自称「破甲」，`mmparko/dsh-purge` 描述）。这正是 PLAN 第 162 行要拒绝的「替换对话主循环」类插件，也碰到 K7-5 的安全红线。

### 4.6 zhu1090093659/dsh-web —— Web 界面插件合集（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `slots` / `locale` / `sessions` / `workspaces` / `connection` / `configForms` / `remote` / `uiWorkspace` / `layout` | ❌ 界面 / 会话 | `packages/dsh-task-board/src/client/index.ts:148` |
| `systemPrompt` / `typertGateway` / `workspaceRegistry` / `webServer` / `agents` / `commands` | ❌ | `packages/dsh-task-board/src/index.ts:45` |
| `webServer` / `tools` | ❌ / ✅ | `packages/dsh-browser-view/src/index.ts:45` |
| `tools` / `subprocess` | ✅ / ❌ | `packages/dsh-win-bash/src/index.ts:134` |
| `tools` / `shell` / `shellEnv` / `systemPrompt` | ✅ / ❌ | `market/shell/src/host/jsh-tool.ts:45` |
| `typertGateway` / `webServer` / `tools` | ❌ / ✅ | `packages/dsh-remote-bridge/src/index.ts:148` |

20 个子包里没有一个只用允许类服务；主体是 dsh 的 Web 界面。

### 4.7 Fei-Craft/DS-Bot —— 多机器人协作 + 自带桌面 / 移动端（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `llm` / `tools` / `systemPrompt` / `sessionController` / `sessions` / `sessionTitle` / `workspaceRegistry` / `connection` | ❌（`tools` ✅） | `ds-bot/src/host/entry.js:4` |
| `sessions` / `uiWorkspace` / `uiConversation` / `slots` / `theme` / `layout` | ❌ 界面 / 会话 | `ds-bot/src/client/index.js:91` |
| `tools` / `systemPrompt` / `ptcRuntime` | ✅ / ❌ | `ds-bot/src/host/code-mode.js:8` |
| `webServer` / `connection` | ❌ | `app/engine/index.js:15` |
| `web` | ✅ | `ds-bot/web-search.js:14` `inject = ['web']` |
| `credentials` | ✅ | `app/engine/cordis.patch.yml:100` |

`ds-bot/web-search.js` 这个子模块只用到 `web`，单独拿出来能算工具类；但插件整体是一个自带主循环、会话和界面的 App 组合（`app/engine/package.json:5`：「engine layer of the DS Bot desktop app profile」）。

### 4.8 ccch1mneyyy/dsh-TUI —— 终端界面（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `llm` / `commands` | ❌ | `cordis.patch.yml:401` |
| `workspaceRegistry` / `agents` / `tuiWorkspaces` / `tuiScenes` / `tuiPanels` / `tuiDialogs` / `tuiStatus` / `tuiShortcuts` / `tuiRenderers` / `tuiThemes` | ❌ 界面 | `cordis.patch.yml:412` |
| `agents` | ❌ | `src/dsh-adapter/index.ts:33` |
| `sessionPersistence` / `sessions` | ❌ 会话 | `src/dsh-adapter/channel/subagent-transcript.ts:6`、`:15` |
| `subprocess` / `tools` | ❌ / ✅ | `presets/winbash.mjs:45` |

它替换的是 dsh 的整个用户界面。

### 4.9 elysia395/dsh-wallpaper-engine —— 界面皮肤（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `webServer` | ❌ | `lib/index.js:175` `inject = ['webServer']` |
| `webServer` / `wallpaperEngineHost`（插件自己提供的服务） | ❌ | `packages/glass/lib/index.js:37`；about-notice / fonts / mascot-avatar / media-bridge / pet-link 子包同样两项；fx / parallax 只注入 `wallpaperEngineHost`（`packages/fx/lib/index.js:27`、`packages/parallax/lib/index.js:27`） |
| `slots` | ❌ 界面 | `src/client.js:6234` |
| `sidebarRightTabs` | ❌ 界面 | `src/sidebar-right.js:10` |
| `theme` | ❌ 界面 | `src/styles/base.js:195` |

### 4.10 MeteorNOX/DeepSeek-Balance-Whale-Widget —— 余额挂件（❌）

| 服务 | 类别 | 源码依据 |
|---|---|---|
| `credentials` | ✅ | `lib/index.js:749` `root.inject(['webServer', 'credentials', 'connection'], ...)`；`ctx.credentials.resolve` 在 `lib/index.js:1296`，`ctx.credentials.set` 在 `:2946` |
| `webServer`（含 `tapIndex` 改页面、`webserver/index-inject` 事件） | ❌ 界面注入 | `lib/index.js:749`、`:884`、`:4903`；`lib/index.js:735` |
| `connection` | ❌ | `lib/index.js:749`、`:805` |
| `deepseekAccount`（可选） | ❌ | `lib/index.js:1189` |
| `sessionTitle`（可选）、`session/event` / `session/disposed` 事件 | ❌ 会话 | `lib/index.js:1007`、`:1128`、`:1134` |

## 5. 汇总

| # | 插件 | 用到的允许类 | 用到的非允许类（举例） | 达标？ |
|---|---|---|---|---|
| 1 | dsh-our-free-model | credentials | llm、commands、schedule、slots | ❌ |
| 2 | anywhere-labs/dsh-desktop | tools | webServer、slots、sessions、subprocess、sessionController | ❌ |
| 3 | dataelement/dsh-desktop | credentials、tools | sandbox、subprocess、systemPrompt、sessionController、slots | ❌ |
| 4 | dsh-market | — | slots、theme、hmr、shell | ❌ |
| 5 | dsh-purge | tools | systemPrompt、agent/pre-step、llm/stream、session 事件、subprocess | ❌ |
| 6 | dsh-web | tools | slots、sessions、systemPrompt、webServer、subprocess、shell | ❌ |
| 7 | DS-Bot | tools、web、credentials | llm、systemPrompt、sessionController、slots、webServer | ❌ |
| 8 | dsh-TUI | tools | llm、agents、tui*、sessionPersistence、subprocess | ❌ |
| 9 | dsh-wallpaper-engine | — | webServer、slots、theme、sidebarRightTabs | ❌ |
| 10 | Balance-Whale-Widget | credentials | webServer（改页面）、connection、session 事件 | ❌ |

**达标数：0 / 10**（标准是 ≥ 6）。宽松口径（`webServer` 也算网络）下仍是 0 / 10。

## 6. 给用户决策的补充信息（不是结论）

如果用户仍然想做兼容层，下面这些是这次读源码时顺带看到的、**更接近工具类**的候选。它们都不在前 10 名里，星数低很多，**只看了注入声明，没有逐行核对所有调用点**：

| 仓库 | 星数 | 看到的注入声明 | 备注 |
|---|---|---|---|
| sixtysevenlf/dsh-blender-plugin | 2314 | `src/plugin.ts:36` `inject = ['tools']` | 全文 `ctx.*` 计数里还出现了 `sessions` / `jobs` / `skills`，用途没有核实 |
| DDDMUC/dsh-free-search | 1753 | 往 `ctx.web` 注册搜索提供方（`cordis.patch.yml:2` 的注释、`lib/activity.js:6`） | 客户端还用到 `slots`（`lib/client.js:5329` 起） |
| shanliuling/dsh-image-gen | 1790 | 宿主侧 `src/index.ts:60` `inject = ['tools', 'attachments', 'credentials']` | 客户端 `src/client/index.tsx:214` 用到 `slots` / `connection` / `remote` / `locale`；`attachments` 不在允许类 |
| Fei-Craft/DS-Bot 的 `ds-bot/web-search.js` | — | `:14` `inject = ['web']` | 只是大插件里的一个子模块 |

这些插件的宿主侧代码比较接近「工具 + 凭据 + 网络」，但它们**大多也带界面**，热门程度也远低于前 10。对碧琪用户来说，同样的能力多半已经能通过 K7-1（技能）和 K7-2（MCP）拿到。

可选方向（由用户决定）：

1. **不做兼容层**（按 PLAN 默认）：K7 只交付 K7-1 技能、K7-2 MCP；K7-4 / K7-6 不启动。
2. **缩小范围试做**：只针对第 6 节这类宿主侧插件，提供 `tools` / `credentials` / `web` / `fs` 的替身，客户端部分一律不加载。验收需要另定（K7-4 要求「至少 3 个真实的工具类插件能被调用」，现在候选不到 3 个确定能用的）。
3. **以后再评估**：等 dsh 退出预览期、接口稳定后，用同样方法重跑一次。

## 7. 未覆盖 / 局限

- 只读源码，没有安装或运行任何插件，所以「用到的服务」是静态分析结果。运行时用 `ctx.get('<名字>')` 按需读取的可选服务可能有遗漏（已经看到的已列出，例如 Whale Widget 的 `deepseekAccount`、`sessionTitle`）。
- 第 3.1 节有一部分仓库只按描述排除，没读源码（已在表里标注）。
- 只在 dsh-v0.2.2-rc.5 上对了服务名；插件自己声明支持的 dsh 版本范围各不相同（例如 anywhere-labs/dsh-acp-bridge 已经跟到 0.2.3-alpha.2，DS-Bot 钉在 0.2.2-rc.5）。
- 这里的星数是 2026-11-27 的快照，排名会变。
