# Metre 模式 · 接力记录

两端的会话都读写这份文件。每次开工先看，每次收工必更新并推送。

## 接力棒

| 批 | 状态 | 谁在做 | 开始 | 最后提交 |
|---|---|---|---|---|
| 0 基座 | 进行中（后端、安装、清点、测试已完成；前端模式菜单在做，见「批 0 剩下的」） | Windows，Opus 5.5（11-14 起改 `ui/injections/` 含 `laolao-phrases.js`，不动 `index.mjs`） | 2026-11-13 | 见 git log |
| 1 派发（界面叫 Baton） | 未开始（等批 0） | | | |
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
| Metre 自己的手册 | 设定防护照旧保护，聊天里改不了；不算权限限制（F7） | 11-14 用户原话：「保留保护」 |
| 新的批次顺序 | 0 → 3 → 1 → 2 → M → 4 → 5 → 6 → 7（Windows 半边） | 用户给的 0→3→1→2→4→5→6→7，批 M 插在 4 之前（PLAN 6.4） |

## 给 Fable 的（实现中发现的、需要方案方定的事）

- F1（11-13）：用户把界面上的「派发 / 独做」改成 Baton / Virtuoso。实现保留注入标记 `【本轮：派发】/【本轮：独做】` 以对齐主 MD 第四节。主 MD 要不要加一句「界面上叫 Baton / Virtuoso」由你定。
- F2（11-13）：新增项目记忆（PLAN 6.2）和 `metre_memory` 工具，主 MD 现在没有提到。需要你在主 MD 里加一节：什么时候 `recall`、什么值得 `remember`（验收确认过的事实、定下的决定、用户偏好、踩过的坑）、不记什么（临时念头、子会话没验过的说法、密钥）、跨项目只在用户明说时读。
- F3（11-13）：空状态引导语的题库扩写部分（实现者写的 ≥80 句）请你过一遍文风。
- F4（11-13，批 0）：**预算几乎用完**。Metre 一轮 5982 / 6000 字，其中主 MD 4988。批 1 的【本轮：派发】一行放进去约 5992。F2 要在主 MD 加项目记忆一节就一定超。请定：放宽预算（例如 7000），还是从主 MD 挪内容出去。
- F5（11-13，批 0）：为了进预算，Metre 不注入【工具调用前的进度说明】【主动提问】富回复说明【工作过程展示】，因为主 MD 第二、三、九节讲了同样的事（进度说明那条和主 MD 第九节是相反的）。【长时间命令放后台】压成一句。门禁原文没动。详见 `INJECTION-INVENTORY.md`。如果你认为哪条该留，告诉我放回。
- F6（11-13，批 0）：OpenClaw 会往新工作区补 TOOLS / USER / HEARTBEAT 三份英文模板（缺了又会注入一行 `[MISSING]`），按 agent 关的 `skipBootstrap` 在 2026.7 配置校验里报错（实测 `agents.list.5: Invalid input`）。现在用空文件占位（空文件不注入，0 字）。A0-3 说「只有三份文件」，实际是三份 + 三个空占位 + OpenClaw 自己的 `openclaw-workspace-state.json`。请确认可以。
- F7（11-13，批 0）：设定防护（`settings-guard.mjs`）现有规则会把 `workspace-metre` 当产品工作区保护（聊天改不了 Metre 自己的手册），和群聊 agent 一样。没改代码。是否算「权限限制」由你定。

### Fable 的答复（11-14，用户原话：「Fable你决定一下关于 F4（以及 F2、F5–F7）」）

| 项 | 决定 | 理由 | 实现者要做的 |
|---|---|---|---|
| F4 预算 | **放宽到 6500，主 MD 不挪内容。** 之后主 MD 再加字，先从主 MD 里省出同样多，不再放宽 | 6000 是我定方案时估的数，不是量出来的。现在 6358，是项目模式（32485）的五分之一，这个模式要的「轻」已经做到；为了 358 字去删手册里读懂人、写简报、验收的内容，是拿它最值钱的部分换一个估出来的数。只放到 6500 而不是 7000，是不想留出随手往里加的余地 | 已改：PLAN 2.2、ACCEPTANCE A0-4、`tests/metre-inject.test.mjs`（6000 → 6500）。批 1 加【本轮】一行后约 6368，余 132 |
| F2 项目记忆 | **已写进主 MD，第十五节「项目记忆」，376 字**（放在末尾，前面各节的编号不动） | 写了五件事：档案是线索、和文件对不上以文件为准；什么时候 `recall`；什么值得 `remember`；不记什么；事实变了用 `update` / `forget`；别的项目只在用户明说时读 | 批 M 的工具说明和「做完提醒一次」的那句话照这一节的说法写，别另起一套。用户级偏好（`_user`）怎么写入由工具说明讲，主 MD 不提 |
| F5 去掉的注入 | **都同意，一条不放回** | 【工具调用前的进度说明】和主 MD 第九节相反；【工作过程展示】第九节已覆盖；【主动提问】里手册没有的运行时事实（调用后本轮停下、答案作为下一条消息发来）在 `ask_user` 的工具说明和工具结果里都有（`ask.mjs:70`、`:49`）；富回复说明里要紧的只有 `plan_update`，第三节讲了；【后台命令】一句够，「没跑完不能说成做完」由门禁和第十一节管 | 不用改。顺带记一处（不急，批 3 或批 7 顺手做）：`ask_user` 等插件工具的说明里写的是「先生」「碧琪」，Metre 看到的工具说明最好按模式换成「用户」 |
| F6 空占位 | **可以** | 空文件 0 字、不注入，比报错的 `skipBootstrap` 稳；安装脚本已经做到「用户写过的同名文件不动」。`TOOLS.md`、`USER.md` 就是用户给 Metre 留话的地方 | 已改：PLAN 2.1 和 ACCEPTANCE A0-3 的说法（三份有内容的 + 三个 0 字节占位 + `openclaw-workspace-state.json`） |
| F7 设定防护 | **保留，不算权限限制，代码不动** | 用户说的「全部没有限制」是指替他办事时不设确认关卡；手册是产品文件，安装和 `guard.mjs` 本来就会按官方版本盖回去，聊天里改了也留不住，不如当场说清楚改不了。更要紧的是：Metre 没有确认关卡，又整天读弱模型的汇报和网页，它自己的手册是唯一不能让这些文字改写的东西。用户想调 Metre 的做法有路：`workspace-metre` 的 `USER.md` / `TOOLS.md`（不受保护，写了就注入）和项目记忆里的 `preferences` | 不用改。**用户 11-14 已确认：「保留保护」** |

改后数字：Metre 一轮 **6358 / 6500**（工作区 5604：`AGENTS.md` 5364、`IDENTITY.md` 136、`SOUL.md` 104；插件注入 754）。`INJECTION-INVENTORY.md` 第二节是批 0 当时的数（5982 / 6000），没改它。F1、F3 见下。

**F1、F3（11-14，用户原话：「F3我不是给过了吗你自己决定啊不要什么都问我」）**

| 项 | 决定 | 理由 | 实现者要做的 |
|---|---|---|---|
| F1 Baton / Virtuoso | **主 MD 第四节加了一句**：「界面上这两个选项叫 Baton（派发）和 Virtuoso（独做），用户这样说时指的就是它们。」 | 用户在界面上只看得到这两个英文词，他在对话里说「切到 Virtuoso」时 Metre 得听得懂 | 注入标记不变（`【本轮：派发】/【本轮：独做】`） |
| F3 引导语 | **不走「实现者写、Fable 审」了，80 句由 Fable 直接写完**，连同用户的 40 句存在 `ref/metre-prompts.json`，共 120 句、每类 24 句、关键词已标 | 用户的 40 句就是文风标准，他已经给过；这 40 句此前只在聊天记录里，仓库里没有，批 4 的新会话拿不到。文风的活由写方案的一方直接写，比写完再审少一个来回 | 批 4 把这份数据原样放进 `laolao-metre-prompts.js`，不改句子；细则见 PLAN 6.3「题库」 |

改后数字：Metre 一轮 **6405 / 6500**（`AGENTS.md` 5411）；批 1 加【本轮】一行后约 6415。「给 Fable」的 F1–F7 到此全部答完。

## 量到的数字

**批 0 · 固定文字开销**（`node tools/metre/inject-inventory.mjs project metre`，口径和逐段明细见 `INJECTION-INVENTORY.md`）：

| | 工作区文件 | 插件注入 | 合计 |
|---|---|---|---|
| 项目模式 | 24505 | 7980 | **32485** |
| Metre（批 0 当时） | 5228 | 754 | **5982**（当时预算 6000） |
| Metre（11-14 主 MD 加第十五节和 Baton 一句后） | 5651 | 754 | **6405**（预算 6500） |

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
