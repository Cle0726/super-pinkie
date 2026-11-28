# METRE-BOARD-SPEC · 总谱要回答什么（K8-4 前置，草稿）

- 批次：L109（win-coord #96 7231931033），K8-4「总谱重做」的第 1 步。计划原文见 `docs/metre-next-1122` 分支 `briefs/cle-core-1120/METRE-NEXT.md` 第四节 K8-4。
- 范围：只读现有代码、只写本文档，不改任何产品代码。所有结论都对着 `origin/main` 9e50d1e9 的代码写，行号以那次提交为准。
- 读过的文件：
  - 页面骨架 `ui/injections/laolao-metre-board.js`（438 行）
  - 数据层 `ui/injections/laolao-metre-board-data.js`（541 行）
  - 「全部会话」栏 `ui/injections/laolao-session-board.js`（288 行）与数据层 `ui/injections/laolao-session-board-data.js`
  - 后台带 `ui/injections/laolao-metre-backstage.js`（读总谱数据的那部分）
  - 后端 `services/mode-architecture/metre-board.mjs`（468 行）、`session-lineage.mjs`（暂停 / 全停 / busy）、`metre-memory.mjs`、`engines-dispatch.mjs`、`engines-bridge.mjs`、`workbench.mjs`
- 「已实测」与「读代码得出」分开写：本文所有结论都是**读代码得出**，没有在真 App 或浏览器里点过（本批不启动浏览器）。标「疑似」的要由 L110 的按键契约测试确认。

---

## 一、总谱要回答的五个问题，每个只在一处回答

| 问题 | 唯一回答处（K8-4 以后） | 现在回答它的地方（重复的都列出来） | 处理 |
|---|---|---|---|
| **谁在做** | 「声部」：一行一个子会话，左边是名字 + 角色 / 模型，右边是状态记号 | ① 声部每行的状态牌与时间段；② 总览「在奏 / 上限」上面那个数；③ 「此刻」写成「N 个声部在奏」；④ 调音「声部上限：在奏 N / 上限 · 这一轮已开 M / 上限」；⑤ 「全部会话」栏顶上「N 个声部在奏」（**数据源不同**：`sessions.list` 全模式，不是这一个 Metre 父会话）；⑥ 后台带「引擎 N · x 在跑」（只算外部引擎声部） | 只留 ①。「在奏数 / 上限」作为声部卡片标题旁的一个计数，不再单独成格；调音里那行删掉；「全部会话」移出总谱（见第四节）；后台带不属于总谱，保留但只做指针 |
| **做到哪** | 「节目单」：步骤列表，做完 / 进行中 / 卡住 / 停在这一步 | ① 节目单；② 声部时间段（横向是时间）；③ 「奏了多久」 | 节目单回答「做到哪一步」；声部时间段只表达「谁在什么时候干活」，不另写进度文字；「奏了多久」并进节目单标题行 |
| **等我什么** | 「等你」：一条一个，带「去回答」 | ① 等你卡片；② 卡片标题上的数字；③ 侧栏「总谱」入口上的数字；④ 「此刻」写成「等你（N）」；⑤ 「全部会话」栏顶上「等你（N）」（全模式数据源） | 只留 ①。②③ 是指向 ① 的徽标，允许保留（同一个数、同一个来源 `pending.length`）；④ 删掉数字，只说状态词；⑤ 随「全部会话」移出 |
| **改了什么** | 「改谱」：按声部分组的文件和增删行数，点开在工作台看 | 只有改谱一处 | 不动；数据源改成事件流（见第三节） |
| **出了什么错** | 出错的那个声部那一行：红色记号 + 一句原因 | ① 声部行「失败：…」/「没动静」；② 小节里的「出错」条目（带原因）；③ 调音「最近的出错」列表（`runtime.errors`，**同时包含声部的工具出错和一轮出错**）；④ 调音模型健康「出错：…」；⑤ 排练记录里 `run.end ok=false` | 声部的错只在 ① 说原因；② 小节只留一个「出错」记号和时间，点一下定位到那一行，不再重复原因；③ 只留网关 / 模型 / 角色卡这类**基础设施**的错，不再收声部的错；⑤ 排练记录是排查用的原始流水，不算回答（默认收起） |

「此刻」那一格只说一个**状态词**（起拍前 / 在奏 / 等你 / 暂停分谱 / 已收住 / 休止 / 断线 / 没回话），不带任何数字，数字都在各自的卡片上。

视觉语言沿用 METRE-NEXT K8-4 第 1 条：声部 = 一行、小节 = 时间、记号 = 状态。记号只有四种，全板一致：奏完（done）、在奏（run）、出错（fail）、候场 / 收住（wait）。

---

## 二、现在总谱的每一个数字

「来源」一栏：`board.X` 指 `pinkie.metre.board` 返回值的字段（`metre-board.mjs` 的 `board()`，第 304–427 行）；「账本」指后端另记的那本 `<状态目录>/metre-board/<哈希>.json`（`journal()`，第 126–141 行）；「血缘」指 `session-lineage` 的 lineage / state；「网关」指 `sessions.list` 那一行（`familyRows`）。

### 2.1 总览条（`data-metre-slot="overview"`，骨架第 184–193 行，数据层 `overview()` 第 332–359 行）

| 数字 | 显示 | 来源 | 重复 | 备注 |
|---|---|---|---|---|
| 此刻 | `overview.state` 文字；断线时换成「连接断了 / 没回话 / 没读到」；Metre 90 秒没动静时换成「Metre N 没动静」 | 血缘 `paused` / `lastStop` + 账本 `pending` + `running` 计数 + 网关 `parentBusy` | 「等你（N）」「N 个声部在奏」与等你卡片、声部卡片重复 | 没有会话时数据层写「还没起拍」 |
| 奏了多久 | `now - overview.startedAt` | 账本 `requestAt`（第一次 `pinkie_session_start` 的时刻；用户在父会话说话清零） | 与节目单无关，但与声部时间段的起点概念重复 | 只算「从第一次分谱起」，不是这件事真正开始的时间 |
| 在奏 / 上限 | `overview.running` / `overview.limit` | `running` = sessions 里 status 为 running 的个数；`limit` = `metreLimits().maxRunning`（默认 8） | 调音「声部上限」一行、「此刻」的「N 个声部在奏」 | |
| 交回 · 出错 | `overview.returned` · `overview.failed` | `returned` = 有汇报卡片且没失败的声部数；`failed` = failed + interrupted 的声部数 | 出错数和声部行的红色记号重复 | 「交回」按声部计，不按汇报张数计；小节里「交回汇报」按张计，两个口径不同 |

### 2.2 各卡片里的数字

| 卡片 | 数字 | 来源 | 重复 / 问题 |
|---|---|---|---|
| 节目单 | 步骤状态 | `plans.plan(parent)`（`plan_update` 的存储）；前端再按「有没有人在跑」把 active 改成「停在这一步」，断线时改成「断线前在做」 | 无重复 |
| 声部 | 时间尺刻度（0 / 25% / … / 100%） | 账本 `spans` 的最早起点到 `now` | — |
| 声部 | 每行时间段 | 账本 `spans[key]`（`before_agent_run` 开、`agent_end` 关）；外部引擎声部是血缘 `engineSince → state.at` 画一整段 | 账本与事件流重复（K8-4 要删） |
| 声部 | 每行用时 | 血缘 `createdAt` 到 `state.at` 或 `now` | 与时间段长度是同一件事的两种写法 |
| 声部 | 用量「x 进 / y 出」或「用量 z」 | 账本 `usage[key]`（`llm_output` 累加），没有就退回网关行 `inputTokens / outputTokens / totalTokens` | 与调音「这件事的用量」是同一组数的分和总；两个来源可能对不上（账本 vs 网关） |
| 声部 | 「N 没有动静」 | `now - lastActiveAt`（账本 `seen` 与 spans 取最大），超过 90 秒 | — |
| 等你 | 条数（标题上、侧栏入口上） | `pending.length` = 账本 `pending`（`ask_user` 工具结果记下，用户在那个会话说话清掉）+ 血缘里未过期的 proposal 卡片 | 「此刻」里的「等你（N）」重复 |
| 小节 | 每条时间 | 账本 `events` + 血缘汇报卡片 + `lastStop` + `pausedAt`，新的在上，最多 60 条 | 「出错」条目与声部行、调音错误列表重复 |
| 改谱 | 文件数、+增 / −删、五格比例条 | 账本 `changes[key][path]`（`after_tool_call` 里写文件类工具按参数估行数） | 无重复；行数是按工具参数估的，不是 git diff |
| 调音 | 上下文百分比 | 网关父会话行 `totalTokens / contextTokens` | 只算 Metre 父会话，不含声部 |
| 调音 | 这件事的用量 + 曲线 | 账本 `usage` 全部声部求和、`points` 合并 | 声部每行用量的总和 |
| 调音 | 网关 已连接 / 断了 | 前端 `__pinkieRunStatus.state.conn` | 后台带「网关」一格读同一份（这是有意统一的，不算重复） |
| 调音 | 每个模型 正常 / 出错 / 还没调用过 | `modelHealth.models` | 声部行的失败原因也可能来自同一个模型出错 |
| 调音 | 声部上限 在奏 N / 上限 · 已开 M / 上限 | `overview.running / limit / started / cap` | 与总览「在奏 / 上限」重复 |
| 调音 | 角色卡 合格 N · 不合格 M | `metre-roles.loadRoles()` | 无重复 |
| 调音 | 最近的出错（最多 8 条） | 账本 `errors`（工具出错 + 一轮出错） | 与声部行、小节重复 |
| 排练记录 | 「展开 N 条事件」 | 账本 `raw`（最多 200 条） | 内容与小节大部分重叠（同一批钩子） |
| 项目记忆 | 「N 条 · 了解 K / 9 类」、每类条数 | `pinkie.metre.memory` stats | 无重复 |
| 全部会话 | 「N 个声部在奏」「等你（N）」、「还有 N 个在跑」、「另有 N 个分身在跑」、每行用时 / 上下文条 | `window.Pinkie.sessionBoard`：`sessions.list` 全模式 + `exec.approval.list` / `plugin.approval.list` | 与总览、声部、等你的数字**同名不同源**：这里是所有模式的会话，总谱其余部分只是这一个 Metre 父会话 |

---

## 三、现在总谱的每一个按键

「真 / 假」的判断：点下去有没有调后端或产生可见变化。「测试」一栏只列 `tests/metre-board*.test.mjs`、`tests/session-board*.test.mjs`、`tests/metre-backstage-sync.test.mjs` 里搜得到的那个接口名，**搜得到不等于有契约测试**，L110 要逐个补。

### 3.1 总谱头部

| 按键 | 位置 | 调用 | 后端变化 | 界面变化 | 真 / 假 | 测试 |
|---|---|---|---|---|---|---|
| 暂停分谱 ↔ 继续分谱 | 骨架第 173–177 行；数据层第 343 行 | `pinkie.metre.pause {key, paused: !overview.paused}` → `lineage.setPaused` | 血缘 state `paused` / `pausedAt`；暂停时 `metreGate` 拒绝新派发 | 刷新后按钮字、`aria-pressed`、「此刻」变「暂停分谱」、小节多一条 | 真。数据没到或断线时禁用（`enableActions({})`） | 无 |
| 全体收住 ↔ 接着奏 | 骨架第 173–177 行；数据层第 344–352 行 | 收住：`pinkie.metre.stopAll {key}`（20 秒）；接着奏：`pinkie.metre.resume {sessionKey}`（12 秒） | 收住：停 Metre 这一轮和所有在跑的子会话（外部引擎先 `bridge.stop`），写 `lastStop`；接着奏：取消暂停 + 以用户身份 `chat.send` 一句「接着做…」 | 按钮字互换、「此刻」变「已收住」、小节多一条；失败时 toast | 真 | `pinkie.metre.resume` 有 |
| 收起（×） | 骨架第 178–181 行 | 无 | 无 | 滑出 300ms 后隐藏，对话区收回宽度，派发 `pinkie:metre-board-closed` | 真（纯前端） | 无 |
| 左边沿拖条（拖 / 双击） | 骨架第 210–230 行 | 无 | 无 | 改停靠宽度，存 `localStorage['pk.metre.board.width']`；双击回默认 | 真（纯前端） | 无 |
| Esc | 骨架第 421–425 行 | 无 | 无 | 浮层或焦点在面板里时收起 | 真（纯前端） | 无 |

### 3.2 卡片里的按键

| 按键 | 位置 | 调用 | 界面变化 | 真 / 假 | 测试 |
|---|---|---|---|---|---|
| 声部「打开」 | 数据层第 120 行 | `__laolaoSidebar.navigateSession(key)` | 跳到子会话（跨模式时整页切换） | 真 | 无 |
| 声部「停止」 | 数据层第 121 行，仅 status=running | `chat.abort {sessionKey, preserveSideRuns:false}` | 按钮禁用，`refreshSoon()` | 网关会话：真。**外部引擎声部：疑似假**——`engines-dispatch.mjs` 第 293 行注释写「外部子活不吃 chat.abort」，停外部声部要走 `bridge.stop({threadId})`（`stopChild` 第 176 行），这里没走 | 无 |
| 声部「发消息」→ 发送 | 数据层第 122、141–159 行 | 网关声部 `chat.send`；外部引擎声部 `pinkie.engines.say` | 发出后输入框消失，`refreshSoon()`；失败时输入框报「没发出去」 | 真 | 无 |
| 等你「去回答」 | 数据层第 167–170 行 | `navigateSession(item.sessionKey)` | 跳到提问的会话；proposal 卡片跳到 Metre 父会话 | 真（只跳转，不在总谱里直接答） | 无 |
| 改谱文件名 | 数据层第 198–199 行 | `__pinkieWorkbench.open(path, {pinned:true})` | 工作台打开文件 | 真 | 无（`__pinkieWorkbench` 只出现在规矩文件那条测试里） |
| 调音「查看不合格原因」 | 数据层第 228–238 行 | 无（`<details>`） | 展开原因列表，重画时保持展开 | 真（纯前端） | 无 |
| 排练记录「展开 N 条事件」 | 数据层第 249–253 行 | 无（`<details>`） | 展开流水 | 真（纯前端） | 无 |
| 项目记忆 搜索（回车） | 数据层第 294 行 | `pinkie.metre.memory {action:'search', query}` | 列表换成搜索结果 | 真 | 无 |
| 项目记忆 钉住 / 取消钉住 | 数据层第 303 行 | `pinkie.metre.memory {action:'pin'}` | 重读列表 | 真；失败被吞掉，界面无提示 | 无 |
| 项目记忆 编辑（回车保存 / Esc 取消） | 数据层第 304–312 行 | `pinkie.metre.memory {action:'edit'}` | 重读列表 | 真；失败被吞掉 | 无 |
| 项目记忆 删除 → 确定删除 | 数据层第 313–318 行 | 第二次点才 `pinkie.metre.memory {action:'delete'}` | 重读列表 | 真；失败被吞掉 | 无 |
| 项目规矩文件名 | 数据层第 265–266 行 | `pinkie.fs.stat` 决定显示哪几个；点击 `__pinkieWorkbench.open(name)` | 工作台打开 | 真 | `metre-board-rules-e2e` |

### 3.3 「全部会话」栏（`laolao-session-board.js` 填进 `all` 卡片）

| 按键 | 调用 | 界面变化 | 真 / 假 |
|---|---|---|---|
| 点一行 / 回车 | `sessionBoard.open(key)` → `__pinkieNativeBridge.openSession`（`laolao-native.js` 第 69–90 行：同模式 `navigateSession`，跨模式 `location.assign` 整页切，Metre 先解锁） | 跳过去 | 真 |
| 行尾「›」展开 / 方向键左右 | `sessions.usage {key}`（15 秒） | 行下展开标题 / 模型 / 开始 / 令牌 / 最近工具 / 花费 | 真 |
| 「另有 N 个分身在跑」 | 无 | 在行下插入子会话行 | 真（纯前端） |
| 「还有 N 个在跑」 | 无 | 只给容器加 `is-unfolded` 类 | **假**：没有任何 CSS 用 `is-unfolded`；而且被折掉的行在数据层（`MAX_VISIBLE = 12`）和界面层（`listHtml` 的 `slice(0, MAX_ROWS)`）都已经截掉，不在页面里，点了什么都不会多出来 |

### 3.4 总谱入口（不在面板里，但都打开总谱）

| 入口 | 调用 | 备注 |
|---|---|---|
| 侧栏「总谱」 | `__pinkieMetreBoard.toggle()` | 上面挂等你数字；关着时数字靠 `refreshBadge` 拉**整份** `pinkie.metre.board` 只为取 `pending.length`（最多 5 秒一次） |
| 首页「谱架」：打开总谱 + 三张卡（总谱 / 项目记忆 / 调音） | `open('')` / `open('memory')` / `open('runtime')` | 卡片上的小图（`MINI`）是抽象示意，没有数据，见第四节 |
| 侧栏「在跑 N」胶囊（Metre 皮） | `toggle('all')` | 数字来自 `sessions.list` 全模式 |
| 命令面板「打开总谱」 | 点侧栏按钮（`laolao-metre-workspace.js` 第 257 行） | |

---

## 四、示例图、占位、假按键

| 东西 | 在哪 | 什么时候露出来 | K8-4 处理 |
|---|---|---|---|
| 九张卡的「示例」内容（`SAMPLE`，骨架第 31–99 行）+ 右上角「示例 · 待接入」标签 + 顶上「示例 数据还没接」说明 | 骨架 `placeholder()` | 数据层在时：打开面板就换成「正在读取…」（数据层 `renderLoading()`，第 523–529 行），**只换前八张，不换「全部会话」**；没有 Metre 会话时 `renderNoSession()` 换前七张，项目记忆另填 | 删掉 `SAMPLE` 与标签、说明；数据没到一律「正在读取」 |
| 「全部会话」卡的示例（三行假会话） | 骨架第 98 行 | `window.Pinkie.sessionBoard` 没加载、或还没出第一份 view 时一直是示例 | 同上；且这张卡不回答五个问题里的任何一个（它是 S6 的全模式看板），建议移出总谱，留在侧栏胶囊 |
| 示例里「等你」的选项（保留英文 / 加中文 / 你定 / 打开看看 / 直接继续） | 骨架第 58–59 行 | 同上 | 这是 `<span>`，长得像按键、点了没反应：**假按键**，随示例一起删 |
| 首页三张卡的小图（`MINI`） | 骨架第 101–115 行 | Metre 首页一直显示 | 换成真数据的缩略（或去掉图只留字）；现在的图和数据无关，属于示例图 |
| 「还有 N 个在跑」 | `laolao-session-board.js` 第 80、117 行 | 全模式在跑超过 12 个时 | **假按键**（见 3.3） |
| 外部引擎声部的「停止」 | 数据层第 121 行 | 有外部引擎声部在跑时 | **疑似假按键**（见 3.2），L110 先写契约测试确认 |
| 暂停 / 收住在断线、读失败时 | 数据层第 430 行 | 断线时 | 已禁用，不是假按键；K8-4 保持「做不了就不放 / 禁用并说明」 |

---

## 五、数据从哪来：账本与事件流的重叠

K8-4 第 2 条要「数据全部来自 `thread-events`，删掉账本里和事件流重复的部分」。现在账本每个字段对应的钩子，和它在 `thread-events`（K8-1）里应该对应的事件：

| 账本字段 | 现在由哪个钩子写 | 事件流里的对应 | K8-4 以后 |
|---|---|---|---|
| `spans` | `before_agent_run` / `agent_end` | 每个声部的一轮开始 / 结束 | 由事件流算，删 |
| `seen`（最后动静） | 上面几个钩子 + `after_tool_call` + `llm_output` | 任一事件的时间 | 由事件流算，删 |
| `doing` | `after_tool_call` → `describeTool` | 工具调用事件 | 由事件流算，删 |
| `changes` | `after_tool_call` → `changeOf` | 工具调用事件（写文件类） | 由事件流算，删；行数估算规则保留在算法里 |
| `events`（小节） | `after_tool_call`（派发 / 问模式 / 发消息 / 记忆 / 停）+ `agent_end` | 对应事件本身 | 由事件流算，删 |
| `pending`（ask_user） | `after_tool_call` 记、`message_received` 清 | 提问事件 + 用户消息事件 | 由事件流算，删 |
| `errors` | `after_tool_call` 出错、`agent_end` 出错 | 对应事件的错误字段 | 由事件流算，删 |
| `usage` / `points` | `llm_output` | 用量事件 | 由事件流算，删；同时不再退回网关行，避免两个来源对不上 |
| `raw` | 所有钩子 | 事件流本身 | 直接显示事件流，删 |
| `requestAt` | `pinkie_session_start` 首次、`message_received` 清零 | 第一条派发事件 | 由事件流算，删 |

账本之外仍要读的：节目单（`plan_update` 存储）、血缘（父子关系、汇报卡片、proposal 卡片、`paused`、`lastStop`）、模型健康、角色卡、上限配置、项目记忆。这些不是重复，K8-4 保留。

另外两处同一份数据被读两次，K8-4 一并收：

- 侧栏数字关着时拉整份 `pinkie.metre.board` 只取 `pending.length`：改成事件流里提问 / 回答事件的计数。
- 后台带的引擎声部（`laolao-metre-backstage.js` 第 168–169 行）读 `__pinkieMetreBoardData.data.sessions` 里 `external` 的行：K8-4 以后改读事件流，不再依赖总谱是否刷新过。

---

## 六、交给 L110（按键契约测试）与 K8-4 的清单

1. 每个第三节标「真」的按键各一条契约测试：点下去 → 调了哪个接口、参数 → 后端状态变了什么 → 界面哪里变了。现有测试只搜得到 `pinkie.metre.resume` 和 `__pinkieWorkbench`。
2. 先确认的两个可能的真 bug（读代码得出，未实测）：
   - 「全部会话」的「还有 N 个在跑」点了没有任何效果（3.3）。
   - 外部引擎声部的「停止」走 `chat.abort`，可能停不下来（3.2）。
   确认后按 CLAUDE.md 第 4 节各带复发测试修。
3. 项目记忆的钉住 / 编辑 / 删除失败时界面没有提示，K8-4 重做时补「没成功」的提示。
4. 五个问题各只在第一节表里那一处回答；其余位置的数字删掉或改成指向那一处的徽标（同数同源）。
5. 示例内容、示例标签、首页示意小图全部删掉；数据没到显示「正在读取」。
