# Metre 模式 · 接力记录

两端的会话都读写这份文件。每次开工先看，每次收工必更新并推送。

## 接力棒

| 批 | 状态 | 谁在做 | 开始 | 最后提交 |
|---|---|---|---|---|
| 0 基座 | 进行中（后端、安装、清点、测试已完成；前端模式菜单在做，见「批 0 剩下的」） | Windows，Opus 5.5（11-14 起改 `ui/injections/` 含 `laolao-phrases.js`，不动 `index.mjs`） | 2026-11-13 | 见 git log |
| 1 派发（界面叫 Baton） | 已自查待验收（A1-* 见「批 1」；界面开关没截图看过） | Windows，Opus 5.5，分支 `claude/metre-b1-baton-d11290`（`index.mjs` 只动了 registerSessionLineage 那一处 + import） | 2026-11-14 | 见 git log |
| 2 会话管理工具 | 未开始（等批 0） | | | |
| 3 通用补缺（状态词、读图小框） | 未开始（随时可做） | | | |
| M 项目记忆（PLAN 6.2） | 未开始（等批 0；看板部分随批 5） | | | |
| 4 皮肤、黑猫、Baton/Virtuoso 开关、空状态引导语 | 未开始（等批 0；黑猫等用户点头） | | | |
| 5 总控台 | 未开始（等批 1、批 4） | | | |
| 6 资源关停 | 未开始（等批 4） | | | |
| 7 两端收尾 | 未开始 | | | |

状态只用这几个词：未开始 / 进行中 / 已自查待验收 / 验收通过 / 打回。

## 已完成

- 2026-11-13（Windows，Opus 5.5）：记下用户第二轮的三点（PLAN 第六节、ACCEPTANCE 批 M 和 A4-9～12）；批 0 后端、安装、清点、隔离副本和测试做完，前端没做。
- 2026-11-13（Mac，Fable 5.2）：需求拆解、方案、主 MD（`personas/metre/AGENTS.md`、`IDENTITY.md`、`SOUL.md`）、计划书、验收标准、两端接手提示词。代码一行没动。同日按用户的四条回复改过一轮：改名 Metre、权限全开、可调无限制模式、黑猫以 C.le.控制台图标为原型。

## 用户的决定

| 事项 | 结论 | 来源 |
|---|---|---|
| 名字 | **Metre** | 11-13 用户原话：「名字叫Metre」 |
| 无限制模式 | 可以被 Metre 调用 | 11-13 用户原话：「无限模式也可以调用」 |
| 权限 | 全部没有限制，不设确认关卡 | 11-13 用户原话：「权限我不同意是我说的是全部没有限制」 |
| 黑猫形象 | C.le.控制台 App 图标上的黑猫，参考图 `ref/cle-cat.png` | 11-13 用户原话：「黑猫C.le.控制台的app图片就是黑猫」 |
| 黑猫像素版预览 | 必须用户点头才上 | 还没出预览 |
| Metre 模式下消息渠道照常 | 按默认做（照常，设置里留开关） | 用户没回复这一条 |
| 派发 / 独做的名字 | 界面改成 **Baton / Virtuoso**，不显示中文，鼠标靠近才显示中文意思和作用（PLAN 6.1） | 11-13 Windows 用户原话：「“派发/独做”改成“Baton/Virtuoso”不要有显示中文当鼠标靠近才显示中文意思和功能作用」 |
| 项目记忆 | 新增工作重心：在用户选的文件夹里越干越了解项目，换文件夹不串记忆；可视化要详细丰富（看板），前后端都不漏，不重复（PLAN 6.2，新批 M） | 11-13 Windows 用户原话：「加一个工作重心就是这个模式的记忆功能要强一点，特别是对用户选择的文件夹中工作时越来越了解项目！但是也要避免在用户又开了一个文件夹的情况出现记忆污染情况，然后可视化程度一点要详细清楚和丰富（没有就做不够丰富就加看板什么的）但是不要重复，前后端都不能遗漏」 |
| 空状态引导语 | 五类提问（启发式 / 苏格拉底式 / 反思性 / 强有力 / 机锋），用户给的 40 句原样收入，实现者扩写到 ≥120；彩蛋按最近记忆、天气、节假日、季节；字有动画、关键词突出；换句频率按时段，工作时段更勤（PLAN 6.3） | 11-13 Windows 用户原话（节选）：「这个模式的 “空状态引导语”用……可以加一些彩蛋方法比如根据对用户的最近记忆来生成和天气/节假日/季节等等」「具体让负责模型加多写一些显示更换的频率根据时间段高一些」 |
| 新的批次顺序 | 0 → 3 → 1 → 2 → M → 4 → 5 → 6 → 7（Windows 半边） | 用户给的 0→3→1→2→4→5→6→7，批 M 插在 4 之前（PLAN 6.4） |

## 给 Fable 的（实现中发现的、需要方案方定的事）

- F1（11-13）：用户把界面上的「派发 / 独做」改成 Baton / Virtuoso。实现保留注入标记 `【本轮：派发】/【本轮：独做】` 以对齐主 MD 第四节。主 MD 要不要加一句「界面上叫 Baton / Virtuoso」由你定。
- F2（11-13）：新增项目记忆（PLAN 6.2）和 `metre_memory` 工具，主 MD 现在没有提到。需要你在主 MD 里加一节：什么时候 `recall`、什么值得 `remember`（验收确认过的事实、定下的决定、用户偏好、踩过的坑）、不记什么（临时念头、子会话没验过的说法、密钥）、跨项目只在用户明说时读。
- F3（11-13）：空状态引导语的题库扩写部分（实现者写的 ≥80 句）请你过一遍文风。
- F4（11-13，批 0）：**预算几乎用完**。Metre 一轮 5982 / 6000 字，其中主 MD 4988。批 1 的【本轮：派发】一行放进去约 5992。F2 要在主 MD 加项目记忆一节就一定超。请定：放宽预算（例如 7000），还是从主 MD 挪内容出去。
- F5（11-13，批 0）：为了进预算，Metre 不注入【工具调用前的进度说明】【主动提问】富回复说明【工作过程展示】，因为主 MD 第二、三、九节讲了同样的事（进度说明那条和主 MD 第九节是相反的）。【长时间命令放后台】压成一句。门禁原文没动。详见 `INJECTION-INVENTORY.md`。如果你认为哪条该留，告诉我放回。
- F6（11-13，批 0）：OpenClaw 会往新工作区补 TOOLS / USER / HEARTBEAT 三份英文模板（缺了又会注入一行 `[MISSING]`），按 agent 关的 `skipBootstrap` 在 2026.7 配置校验里报错（实测 `agents.list.5: Invalid input`）。现在用空文件占位（空文件不注入，0 字）。A0-3 说「只有三份文件」，实际是三份 + 三个空占位 + OpenClaw 自己的 `openclaw-workspace-state.json`。请确认可以。
- F7（11-13，批 0）：设定防护（`settings-guard.mjs`）现有规则会把 `workspace-metre` 当产品工作区保护（聊天改不了 Metre 自己的手册），和群聊 agent 一样。没改代码。是否算「权限限制」由你定。

- F8（11-14，批 1）：预算现在 **5990 / 6000**（加了【本轮：派发】一行，只用一个换行接在联网那句后面）。F4 的决定更急了：再加任何一行都会超。
- F9（11-14，批 1）：`services/mode-architecture/model-tiers.json` 是按本机 mm 目录填的分档初稿（top 只给 opus、gemini-*-pro、gemini-4 argon/hydrogen、grok-4.6/4.7、kimi-k3.1-pro、gpt-6 sol/astra），以及「工具用得不稳」的名单，请过一遍。
- F10（11-14，批 1）：几处我自己定的规则，请确认或改：Metre 的 in_scope 不看设置页「碧琪自己分工」，只看 Baton / Virtuoso；叫醒轮次只放开 in_scope，user_asked 仍要用户那一轮；用户从界面亲手给 Metre 开的子会话不走 mode / 模型规则；`pinkie_mode_ask` 在 Metre 里也套模型规则、算累计上限，独做和暂停时不给；两个上限（同时在跑、累计）只有后端设置项，没有设置页入口。
- F11（11-14，批 1）：主 MD 第六节说「不写 model 时用那个模式自己的默认模型」。现在后端在默认模型恰好和 Metre 相同时会拒绝并要求写 model；在大多数用户只配了一个全局默认模型的电脑上，这等于 Metre 每次都必须写 model。主 MD 要不要把这句改成「先用 pinkie_models 选，写上 model」由你定。

## 量到的数字

**批 0 · 固定文字开销**（`node tools/metre/inject-inventory.mjs project metre`，口径和逐段明细见 `INJECTION-INVENTORY.md`）：

| | 工作区文件 | 插件注入 | 合计 |
|---|---|---|---|
| 项目模式 | 24505 | 7980 | **32485** |
| Metre | 5228 | 754 | **5982**（预算 6000，只剩 18 字） |

工具：Metre 的插件工具 22 个，和项目模式同一套；OpenClaw 自带工具不加 deny（项目模式 deny 了 6 类不用的），所以总数比项目模式多。

（批 6：资源占用前后对照。）

## 各批自查结果

（按 `ACCEPTANCE.md` 的编号逐条填：过 / 没过 / 没测（原因））

### 批 0 · 基座（Windows，Opus 5.5，11-13，后端做完，前端没做 → 状态仍是「进行中」）

隔离副本：`%USERPROFILE%\碧琪实测\iso-metre`，脚本 `tools/metre/iso/`（`setup.py` 建副本并按产品安装器顺序装 Metre；`gateway.py start|stop|status`；`ask.py agent:消息 ...` 一批并行发）。网关端口 1287，只绑 127.0.0.1，模型统一 `mm/workbuddy/hy4free`。第一次起网关要先跑 OpenClaw 的启动迁移，约 3 分钟；被打断会留一把约 10 分钟的锁（`startup migrations are already running`），等它过期再起。

| 项 | 结果 |
|---|---|
| A0-1 清点 | 过：`INJECTION-INVENTORY.md` |
| A0-2 能切到 Metre、key 以 `agent:metre:` 开头 | 后端过：隔离副本 `agent:metre:iso-b0-0` 正常回答（「我是 Metre，负责把你的需求读懂、拆成几块……」）。**界面没做**：模式菜单还没有 Metre 项（见下「批 0 剩下的」） |
| A0-3 工作区只有三份 | 过（附带条件，见 F6）：跑过两轮后 `workspace-metre` 里是 AGENTS / IDENTITY / SOUL + 三个 0 字节占位 + `openclaw-workspace-state.json`，没有多出模板；内容和仓库一致 |
| A0-4 ≤ 6000 字 | 过：5982（对照项目模式 32485）。余量只有 18 字，见 F4 |
| A0-5 没有打法卡 / 路由 / 工具箱 / 更拿手 / 陪伴 / 第一人称改写 | 过：`tests/metre-inject.test.mjs` 用四条消息抓 `before_prompt_build` 真实产出断言；第一人称改写另有一条用例 |
| A0-6 门禁还在 | 过：同一测试文件里三组门禁用例（没执行就说完成、最后一步失败、改了文件测试失败还说通过），Metre 和项目模式的结论逐条相同，都是 revise |
| A0-7 别的模式派不进 Metre、提醒里不出现 Metre | 过：`normalizeMode('metre')` 拒绝（`pinkie_session_start` 和 `pinkie_mode_ask` 都走它）；四个老模式 × 四条消息的 session-hints 里没有 Metre |
| A0-8 枚举清单 | 后端和安装脚本过（清单见下）；前端 19 个文件没做 |
| A0-9 权限 | 过：插件工具 22 个和项目模式同一套；`openclaw.json` 里 `metre` 和 `unrestricted` 一样没有 `tools` 键（项目模式有 6 类 deny），对比：`project: tools.deny=[workboard_*, wiki_*, skill_workshop, canvas, llm-task, node_inference]`，`unrestricted: 无 tools`，`metre: 无 tools`；无限制模式另有 `contextInjection: never`，Metre 不带（它要读自己的手册）。本机放行补丁 `apply-local-unrestricted-policy.mjs` 按网关环境变量对所有本地模式生效，Metre 自动在内。隔离副本里让 Metre 删文件 + 跑 `echo metre-ok`：直接执行，没有确认，文件确实没了，它还按主 MD 第十一节先留了备份 |
| A0-10 没有无限制的运行时标记 | 过：测试断言注入里没有 `OPENCLAW_UR_INJECT`；工作区文件里也没有 |
| Z1 全量测试 | **没过（判断不是本批引起）**：`node tools/release-gate/run-tests.mjs` 报 232 个文件、81 条失败、53 条已知、28 条「新失败」，分布在 18 个文件（browser、learning-materials、web-gpt-connection 等，和 Metre 无关的居多）。把这 18 个文件在基线提交 `e16a36f8`（本批之前）和本分支上各单独跑一遍：两边都是 0 条失败。所以这 28 条是全量并行跑时的相互干扰（当时用户的 App 也在启动），不是本批的改动。没在安静的机器上重跑全量。新增的 `tests/metre-inject.test.mjs` 7 条全过；`windows_mode_agents_test.py` 18 条全过；`mode_architecture_setup_test.py` 新增 2 条过，原有的 `test_scaffolds_four_isolated_modes…` 在 Windows 上报错（找不到 `Library/Application Support/...web-gpt-collab`，是 Mac 路径，和本批无关，不在全量门禁里） |
| Z2 正式环境 | 开工：`openclaw.json` 2026-11-12T18:56:21，安装目录 2026-11-03T14:57:22，18789 没有监听。收工：前两样不变；18789 在 23:28:33 有了网关（PID 33320），是用户自己打开的已安装 App（`超級碧琪.exe` PID 36320，同一秒启动）起的，本会话没碰它 |
| Z3 老模式不变 | 过：隔离副本五个模式各一条「你好，用一句话介绍你自己」，口吻正常（唠嗑 / 想法 / 学习称先生、项目称老板）。老模式相关测试只改了 `windows_mode_agents_test.py` 里「注册了哪些 agent」的期望（多了 metre），没有改任何老模式行为的断言 |
| Z4 personas | 过：没改 `personas/` 下任何文件 |
| Z5 推送 | 过 |

改过的枚举位置（A0-8）：
- 后端：`index.mjs`（`MODE_BY_AGENT`、`PERSONA_FILES`、会话 key 校验三处、`workFirstContext`、`architecture.prompt` 的 Metre 分支、回复不做第一人称改写）、`memory.mjs`（工作区和 agent 映射、会话校验）、`reasoning.mjs`、`background-jobs.mjs`、`work-status.mjs`、`web-gpt-activity.mjs`、`web-gpt-connection.mjs`、`workbench.mjs`（工具开放、规则不注入）、`session-prefs.mjs`（联网一句话版）、`rich-runtime.mjs`（不给富回复说明）、`project-scope/index.mjs`（会话校验；不给工作过程展示）。
- 刻意没加的：`session-lineage.mjs` 的 `MODE_AGENTS`（Metre 不能被派活，批 1 再加 Metre 父会话的规则）；`companion.mjs`（陪伴不服务 Metre）；`session-hints.mjs`（Metre 根本不走路由）；`work-kinds.mjs`（同上）；`settings-guard.mjs`（现有规则已自动覆盖，见 F7）；`setup.py` 的 `MODE_WORKSPACES`（会往工作区建 persona/ 和 memory/）。
- 安装：`app/super_pinkie.py`（`MODE_AGENTS`、`install_personas` + 空占位）、`app/windows_desktop.py`（分屏会话表）、`install.ps1`、`installer/macos/sync-personas.sh`、`installer/macos/apply-bundled.sh`（Mac 没测）、`installer/guard/guard.mjs`（Metre 手册按官方版本守护）、`services/mode-architecture/setup.py`（模板换空占位）。
- `tools/pinkie-toolbox/sync.mjs`、`build-win.ps1`、`personas/README.md` 没有按模式枚举的地方，不用改（`personas/README.md` 也不许改）。

**批 0 剩下的（下一个会话接着做）**：
1. 前端登记 Metre（PLAN 三节批 0 第 6 条，A0-2 界面部分、A0-8 前端部分）：`grep -ln "agent:unrestricted:\|'unrestricted'\|\"unrestricted\"" ui/injections/*.js` 列出的 19 个文件，重点 `laolao-mode-switcher.js`（`modes` 数组、`modeFromSession`、`modeIdForSession`、`modeSignatureAnimation`）、`laolao-sidebar.js`、`laolao-session-tools.js`、`laolao-phrases.js`、`laolao-page-warmup.js`、`laolao-splash.js`、`laolao-handoff-bootstrap.js`、`laolao-deep-think.js`、`laolao-classic-shell.js`。Metre 项先用文字「Metre」+ 一个素净的占位小图标，不放转场、不放立绘、不预加载别的模式素材。Mac 的 `desktop/macos/pinkie/Sources/Launcher.swift`（2090 行附近的模式表）也要加，Windows 上只能改不能验。
2. 在隔离副本里用界面切一次 Metre（Edge + 隔离网关，做法见记忆里的 UI render check），截图看。
3. 补完后把批 0 接力棒改成「已自查待验收」。

### 批 1 · 派发（Windows，Opus 5.5，11-14，分支 `claude/metre-b1-baton-d11290`）

改了什么：`session-lineage.mjs`（所有新规则都按「父会话是不是 Metre」分支，老模式数值、说明、工具清单不变）、`session-prefs.mjs`（`metre: dispatch/solo` 字段、两个上限 `metreMaxRunning` 2–12 默认 8、`metreRequestCap` 默认 24 / 0 不封顶）、新 `metre-models.mjs` + `model-tiers.json`、`openclaw.plugin.json`（登记 `pinkie_models`）、`index.mjs`（只在 `registerSessionLineage(...)` 那一处多传 `modelHealth`、`config`，紧跟一行 `registerMetreModelsTool`，加一个 import）、`ui/injections/laolao-session-tools.js/.css`（Baton｜Virtuoso 两段开关）。测试：新 `tests/metre-dispatch.test.mjs` 15 条；`tests/mode-architecture.test.mjs` 两处「插件工具清单 / 个数」的期望加了 `pinkie_models`（25→26），这两条是插件整体的工具清单，不是老模式行为。

隔离副本：C 盘满了（11-14 一度 0 字节），批 1 的副本建在 `F:\碧琪实测\iso-metre-b1`（`METRE_ISO_ROOT` 指过去，端口 6170），没碰 `iso-metre`、18789。上游账号当天：hy4free 偶发 120 秒无响应、sonnet-5-5 被 403、kimi-k2.7 503；能用的是 glm-5.3、hy4free、hy4std、deepseek-v4-pro、grok-4.6。注意：`ask.py` 的 `--model` 只管那一次调用，被汇报叫醒的轮次会回到会话默认模型；要让 Metre 全程用某个模型，先 `sessions.create {key, agentId:'metre', model}` 把模型钉在会话上（实测 r3 就是叫醒轮回到了 hy4free，后端按 hy4free 判「和自己相同」是对的）。

| 项 | 结果 |
|---|---|
| A1-1 8 个 / 第 9 个拒 / 项目仍 4 | 过（单测）：第 9 个报「已有 8 个子会话在跑」；设置改 10 后能开；13、1 被拒；项目模式第 5 个仍报「已有 4 个」。真模型没开满 8 个（上游不稳） |
| A1-2 叫醒那一轮能 in_scope | 过：单测（叫醒轮 6 个、第 7 个拒；项目模式同轮拒；心跳、记忆整理轮 Metre 也拒；叫醒轮的 user_asked 仍拒）。真模型：r3、r4 都是在被第 3 份汇报叫醒的那一轮自己开了第二批（r4：chat · glm-5.3 合成 summary.txt） |
| A1-3 累计上限、用户回话归零 | 过（单测）：第 25 个报「已经开了 24 个……先停下来……等用户回话」；用户发消息后 `metreStarts` 归零。真模型没跑到 24 |
| A1-4 模型规则 | 过：单测覆盖自己的模型、省提供方前缀、只写名字、思考强度后缀（opus-5-5-high 对 -low）、不在列表、生图模型、不健康、目标默认和自己相同没写 model。真模型 r3：传自己的 glm-5.3 被拒（「同一个模型，不能派给自己」）、传 kimi-k2.7 被拒（「最近调用失败（503 auth_unavailable…）」）、叫醒轮里 chat 默认 = 自己 被拒（「必须写 model」）；r4：编造的 `deepseek-v4-pro-high` 被拒（不在列表） |
| A1-5 子会话真的用了指定模型 | 过（真模型）：r4 子会话的 sessions.json 记录 project 子会话 `model=workbuddy/glm-5.3`、unrestricted 子会话 `grok-4.6`，而那两个模式的默认是 hy4free；learning 子会话 `modelOverride=workbuddy/hy4std`。指定的模型网关不认时如实报错、不退回默认（单测） |
| A1-6 folder | 过：真模型 r4 unrestricted 子会话绑 `F:\tmp\b1-real\other`、c.txt 写在那里；单测覆盖带引号和末尾反斜杠的 Windows 写法、大小写和正斜杠、不存在、相对路径被拒 |
| A1-7 pinkie_models | 过：真模型 r4 调了 4 次，第一次 103 个里列 40 个（top 14 / mid 14 / light 12），恰好一个 `self`（deepseek-v4-pro）；单测断开 fetch 照样返回、不健康的排最后带原因、40 个上限里 self 一定在。注意：健康记录在网关内存里，重启后清空（r4 时列表里没有不健康项，因为刚重启过）。`model-tiers.json` 是按本机 mm 目录填的初稿，等 Fable 过 |
| A1-8 独做 | 过：真模型 `iso-solo-0` 设 solo 后，Metre 自报 pinkie_ 工具只有 search / session_list / session_message / session_title（没有 start、mode_ask），系统提示里是「【本轮：独做】」；单测覆盖默认派发、切回派发后两个工具和【本轮：派发】恢复、后端也拒（防旧工具）。界面开关：代码在 `laolao-session-tools.js`，**没截图看过**（没测：没跑 Edge 界面截图） |
| A1-9 暂停 | 过：真模型 `iso-pause-0` 暂停后 Metre 拿到原文「用户暂停了派发：已经在跑的子会话照常，新的先不开……」；单测覆盖在跑的不受影响、取消后恢复、只有 Metre 能暂停 |
| A1-10 全停 | 过：真模型 `iso-stop-0`，Metre 这一轮 + 2 个在跑的子会话（第 3 个已交回）13 秒内停下（含 CLI 启动）；sessions.json 里是 killed、都没有 archivedAt；血缘记录完整，返回每个子会话停前状态。单测：3 个在跑 + 1 个已交回 |
| A1-11 每份汇报都叫醒、忙时合并 | 过：单测（另外 4 个还在跑也叫醒；忙时到的 3 份合并成 1 次、三份都注入；超过老模式 3 次的上限照样叫）。真模型 r3：三份汇报分三次叫醒（wakes=3）；r4：两份几乎同时到，合并成一次，第三份再叫一次（wakes 合计 3，含第二批） |
| A1-12 卡片和列表带模型 | 过：真模型 r4 卡片 `model` 分别是 grok-4.6 / glm-5.3 / hy4std / glm-5.3；单测覆盖 `pinkie_session_list` 和注入给 Metre 的汇报里的「模型」 |
| A1-13 unrestricted | 过：真模型 r3、r4 都开到无限制模式并收到汇报；单测：四个老模式传 unrestricted 仍报「模式只能是…」，谁传 metre 都拒 |
| A1-14 默认 24、设 0 不封顶 | 过（单测）：设 0 后连开 31 个 |
| 预算（PROGRESS F4） | 加了【本轮：派发】一行（和联网那句之间只用一个换行）后 Metre 一轮 **5990 / 6000**，在预算内，没改预算 |
| Z1 全量测试 | 见下 |
| Z2 正式环境 | 没碰：只用 F 盘副本；18789 上的网关不是本会话起的，没连过 |
| Z3 老模式不变 | 过：`tests/session-lineage.test.mjs` 一条没改、全过；真模型四个老模式各一句自我介绍，口吻正常（先生 / 老板） |
| Z4 personas | 过：没改 |
| Z5 推送 | 推到 `origin/claude/metre-b1-baton-d11290`（主会话负责合进 `feat/metre-mode-1113`） |

几处我自己定的、请 Fable 看：
- Metre 的 in_scope 不看设置页「碧琪自己分工」（它的开关是 Baton / Virtuoso）。
- 叫醒轮次里只放开 in_scope；user_asked 仍然要求用户那一轮（那一轮不是用户说的话）。
- 用户从界面亲手给 Metre 会话开的子会话不走模型 / mode 规则（不强制写 mode、不查模型）。
- `pinkie_mode_ask` 在 Metre 里也套同样的模型规则、算进累计上限；独做、暂停时同样不给。
- 汇报卡片、`pinkie_session_list`、血缘记录的 `model` 只在 Metre 子会话上记（老模式的记录没加字段）。
- 两个上限只有后端（`pinkie.prefs.set` 的 `metreMaxRunning`、`metreRequestCap`），设置页没有入口；暂停 / 全停的按钮在批 5 看板。
