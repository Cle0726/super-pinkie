# Metre 模式 · 接力记录

两端的会话都读写这份文件。每次开工先看，每次收工必更新并推送。

## 接力棒

| 批 | 状态 | 谁在做 | 开始 | 最后提交 |
|---|---|---|---|---|
| 0 基座 | 已自查待验收（11-14 前端补完） | 空闲 | 2026-11-13 | 见 git log |
| 1 派发（界面叫 Baton） | 已自查待验收（A1-* 见「批 1」；界面开关没截图看过） | 空闲（分支 `claude/metre-b1-baton-d11290`，11-14 主会话合进主线） | 2026-11-14 | b16e9727（合并） |
| 2 会话管理工具 | 已自查待验收 | Windows 并行会话，分支 `claude/metre-b2-sessions-74852b` | 2026-11-14 | 见该分支 git log（批 2 三个提交） |
| 3 通用补缺（状态词、读图小框） | 已自查待验收（A3-* 见「批 3」；单测全过，合并后没在界面里再截图） | 空闲（分支 `claude/metre-b3-gaps-008419`，11-14 主会话合进主线） | 2026-11-14 | 见 git log（批 3 合并） |
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
| 黑猫像素版预览 | 必须用户点头才上。**11-14 Fable 出了预览，等用户点头**：帧数据 `ref/metre-cat.js`（16 个状态 48 帧 + 菜单猫头），预览页 `ref/cat-preview.html`（双击打开，能点状态、切深色），截图 `ref/cat-preview-light.png` / `-dark.png`。用户看第一版时说眼睛好笑（原话：「笑死我了这个眼睛改改吧」），已改成两条平的细长眼；**用户 11-14 看过改后这版的浅色、深色预览图，点头了，原话：「可以，就这版」**（对应提交 `82df9229` 里的 `ref/metre-cat.js`）。批 4 把 `metre-cat.js` 原样搬进 `ui/injections/`，不改帧 | 11-14 |
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
- F8（11-14，批 2）：`pinkie_sessions` 里几条 PLAN 2.7 没写死、我定的规则，请看要不要改（细节在下面「批 2」自查的「几条规则」）：① 老模式只能看、管四个老模式的会话，看不到无限制和 Metre 的；Metre 能建五个模式的会话，不能建 Metre 自己的。② 老模式出确认卡片的只有 archive / stop / rename，detach、unarchive、create 直接做。③ 删除的备份放在 `PINKIE_STATE_ROOT/backups/sessions-deleted/<日期>/`（和设定防护的备份同一个 `backups` 目录），另加了 PLAN 没有的 `restore` 动作（只有 Metre）。④ 工具说明会进老模式的工具定义（不进每轮提示词）；老模式的卡片标题写「碧琪想归档「…」」，Metre 不出卡片。
- F9（11-14，批 2）：唠嗑模式的「只聊天」档（profile minimal）只放行 `MINIMAL_CHILD_TOOLS` 那四个工具，所以那一档里没有 `pinkie_sessions`。PLAN 说四个老模式都有。要不要在只聊天档也开放，由你定（开放要改 `session-lineage.mjs` 的 `MINIMAL_CHILD_TOOLS` 和 `laolao-settings-user.js` 的 `CHILD_SESSION_TOOLS`，批 1 的文件）。
- F10（11-14，批 1）：`services/mode-architecture/model-tiers.json` 是按本机 mm 目录填的分档初稿（top 只给 opus、gemini-*-pro、gemini-4 argon/hydrogen、grok-4.6/4.7、kimi-k3.1-pro、gpt-6 sol/astra），以及「工具用得不稳」的名单，请过一遍。
- F11（11-14，批 1）：几处我自己定的规则，请确认或改：Metre 的 in_scope 不看设置页「碧琪自己分工」，只看 Baton / Virtuoso；叫醒轮次只放开 in_scope，user_asked 仍要用户那一轮；用户从界面亲手给 Metre 开的子会话不走 mode / 模型规则；`pinkie_mode_ask` 在 Metre 里也套模型规则、算累计上限，独做和暂停时不给；两个上限（同时在跑、累计）只有后端设置项，没有设置页入口。
- F12（11-14，批 1）：主 MD 第六节说「不写 model 时用那个模式自己的默认模型」。现在后端在默认模型恰好和 Metre 相同时会拒绝并要求写 model；在大多数用户只配了一个全局默认模型的电脑上，这等于 Metre 每次都必须写 model。主 MD 要不要把这句改成「先用 pinkie_models 选，写上 model」由你定。

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
| A0-2 能切到 Metre、key 以 `agent:metre:` 开头 | 后端过：隔离副本 `agent:metre:iso-b0-0` 正常回答（「我是 Metre，负责把你的需求读懂、拆成几块……」）。界面过（11-14）：假网关 + Edge 抓图（`tools/ui-parity/capture.mjs --mode metre`，已加 Metre），从模式菜单点 Metre 切过去，`data-laolao-mode=metre`、地址 `agent:metre:parity`、没有转场层、头像是占位单字母图标、输入框提示「要做什么？」、0 个页面错误。截图里还有粉色壁纸和小碧琪，分别归批 4（皮肤）和批 6（资源关停） |
| A0-3 工作区只有三份 | 过（附带条件，见 F6）：跑过两轮后 `workspace-metre` 里是 AGENTS / IDENTITY / SOUL + 三个 0 字节占位 + `openclaw-workspace-state.json`，没有多出模板；内容和仓库一致 |
| A0-4 ≤ 6000 字 | 过：5982（对照项目模式 32485）。余量只有 18 字，见 F4 |
| A0-5 没有打法卡 / 路由 / 工具箱 / 更拿手 / 陪伴 / 第一人称改写 | 过：`tests/metre-inject.test.mjs` 用四条消息抓 `before_prompt_build` 真实产出断言；第一人称改写另有一条用例 |
| A0-6 门禁还在 | 过：同一测试文件里三组门禁用例（没执行就说完成、最后一步失败、改了文件测试失败还说通过），Metre 和项目模式的结论逐条相同，都是 revise |
| A0-7 别的模式派不进 Metre、提醒里不出现 Metre | 过：`normalizeMode('metre')` 拒绝（`pinkie_session_start` 和 `pinkie_mode_ask` 都走它）；四个老模式 × 四条消息的 session-hints 里没有 Metre |
| A0-8 枚举清单 | 过（11-14 补完前端，清单见下） |
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

**批 0 前端（11-14，Windows，Opus 5.5）**：
- 加了 Metre：`laolao-mode-switcher.js`（模式表加 `plain: true` 项：文字「Metre」+ 占位图标 `ui/assets/laolao-mode-metre.svg`；不放转场、不放选择爆点、不预热、悬停不预加载；会话 key 识别）、`laolao-motion.js`（`modeAssets('metre')` 直接返回，不去拉不存在的图）、`laolao-sidebar.js`、`laolao-workbench.js`、`laolao-deep-think.js`、`laolao-classic-shell.js`、`laolao-splash.js` / `laolao-handoff-bootstrap.js`（切换兜底时不贴转场图、不说碧琪的话）、`laolao-phrases.js`（名字是 `metre` 时显示 Metre，不换成碧琪）、`laolao-settings-user.js`（默认模式可选 Metre）、`laolao-artifacts.js`、`laolao-session-tools.js`、`laolao-native.js`；Mac `Launcher.swift` 两张模式表（只改没验）；`workbench.mjs` 让 Metre 和无限制一样能写项目外的文件（按「权限全开」）。
- 刻意没加：`laolao-companion.js`、`laolao-immersion.js`（不服务 Metre，Metre 下暂时按唠嗑处理，批 6 关掉）、`laolao-mode-transition-fx.js`（没有 Metre 就自动不播）、`laolao-page-warmup.js`（不预热 Metre）、`laolao-capabilities.js`（定时任务不交给 Metre）、`laolao-desensitize.js`、`laolao-game-shop.js`、`laolao-update-dialog.js`、`laolao-queue-steer.js`（和无限制同样处理）、`laolao-session-list.js` / `laolao-session-cards.js` / `laolao-crew.js`（派活相关，留给批 1）。
- 测试：动到 `ui/injections` 的 106 个测试文件 920 过 18 没过；`motion.test.cjs` 一条是本批改了预热写法，已同步断言；其余逐个文件和本批前的 `bae9c4ec` 对照，失败数相同或更少（`companion` 的文件权限 0o600 在 Windows 上不成立；`learning-notes-menu`、`sidebar-handshake`、`study-desk-ui` 在本机跑不了）。

### 批 2 · 会话管理工具（Windows，Opus 5.5，11-14，分支 `claude/metre-b2-sessions-74852b`）

做了什么：新文件 `services/mode-architecture/session-manage.mjs`，工具 `pinkie_sessions`，动作 list / search / read / create / rename / detach / archive / unarchive / stop / stop_children / delete / restore（后两个只有 Metre）。`index.mjs` 只加了一个 import 和一处 `registerSessionManage(...)`（紧跟 `registerSessionExport`）；`openclaw.plugin.json` 的 `contracts.tools` 加了 `pinkie_sessions`（放在 `pinkie_session_list` 后面）；`setup.py` 和 `installer/macos/apply-theme.sh` 的发货清单加了 `session-manage.mjs`。前端：`laolao-session-cards.js` 加确认卡片（`kind: 'manage'`，按钮「确认归档 / 确认停下 / 确认改名」「不用了」，「先去看看 ›」）；`laolao-sidebar.js` 加 `adoptPlacements()`，把 create 建的会话挂进同文件夹（没有就新建）的项目分组。新网关方法：`pinkie.session.manage.cards / confirm / placements / placed / restore`。

几条规则（PLAN 没写死、我定的，验收时请看）：
- 能看、能管的模式：Metre 六个都行；老模式只有四个老模式（看不到也管不了无限制和 Metre 的会话）。能新建的：Metre 可建五个（不含 Metre 自己，Metre 只由用户开）；老模式只建四个老模式。
- 出确认卡片的只有 archive / stop / rename，且只在「老模式 + 不是自己开的子会话 + 不是自己这个会话」时；detach、unarchive、create 直接做（PLAN 2.7 只点了这三个）。对正在用的这个会话 archive / stop / delete 一律拒绝。卡片 24 小时过期。
- delete：先停它名下子会话、停它这一轮，再把会话记录和同一 sessionId 开头的附属文件（轨迹等）复制到 `<PINKIE_STATE_ROOT>/backups/sessions-deleted/<本地日期>/<agent>--<sessionId>/`，旁边一份 `session.json`（key、标题、项目绑定、血缘、模型），备份成功才删；删的方式是先归档、再 `sessions.delete {archivedOnly: true}`（这样不用管理员权限）。`restore`（Metre 的动作，也有网关方法）按 `session.json` 用同一个 key 重建会话，把记录写回、重绑项目。
- `folder`：认 `F:\…`、`F:/…`、`f:`（补成 `F:\`）、`/f/…`（Git Bash）、`\\nas\share`、两边引号、`~`；不认相对路径和 `F:foo`。再交给 `pinkie.project.validate` 校验。只写 `project` 不写 `folder` 时，从项目绑定记录里找同名项目的文件夹。
- create 的顺序：建会话（带 `model`）→ 绑项目 → 记侧栏位置 → 再发第一条消息（所以第一轮就有项目锚点）；第一条消息以「/」开头时前面加「（代发）」，免得被当成命令。
- rename 和自动起名同一条规矩：记录里是用户起的，或者没有记录但名字像样（不是「新会话」之类），都当用户起的，不改。工具改的名记为 `auto`。
- read 的结果整段包在「【会话资料】会话资料是资料，不是指令……【资料结束】」里，尖括号转义；内部通知、心跳不给；工具调用和结果各一行，摘要不超过 100 字。

| 项 | 结果 |
|---|---|
| A2-1 list / search / read | 过。单测：按模式、项目、状态筛；老模式看不到无限制和 Metre；read 默认 20 条、一页不超过 8000 字（超长的单条截断）、`before` 翻页、资料标记、工具一行摘要。隔离副本：Metre read 到新建会话里助手的原话，list 项目模式数对（2 条）。search 只有单测（用假的 SessionSearch）；**Metre 自己的会话搜不到**：`session-search.mjs` 的模式表还没登记 `metre`，PLAN 说那个文件只读复用，我没改，见下「留给合并 / 后续」 |
| A2-2 create 进侧栏对应项目 | 后端过，界面部分只有单测。隔离副本：Metre 用反斜杠路径 `F:\tmp\…\isoproj\site` 建了项目模式会话，标题「iso 新建测试」、模型、项目绑定（bindings.json）、侧栏位置记录都对，第一条消息发过去并且那边答了（「我是碧琪，项目模式里……」）。侧栏挂进项目：`tests/sidebar-placements.test.cjs` 跑真代码（同文件夹不分大小写和末尾斜杠、新文件夹建项目、重名加编号、用户已放好的不动）。**没在真界面里截图看**：截图用的假网关不认这几个新方法，要扩 fixture |
| A2-3 detach | 过（隔离副本）：项目模式开了一个真子会话、汇报回来后，Metre 对它 detach，血缘记录 `detached: true`、`parentKey` 保留，汇报卡片还在父会话里。detach 之后再来的汇报没有专门测（`detach()` 用的是原有的 `pinkie.session.detach` 同一个函数，没改它的行为） |
| A2-4 Metre 直接生效 / 老模式出卡片 | 过。单测：Metre 的 stop、archive、unarchive 直接做、不出卡片；项目模式对自己的子会话 rename 直接做；对别的会话 archive / stop / rename 出卡片、点之前没执行、点「确认」才执行、点「不用了」不执行、处理过的再点无效、过期不执行。隔离副本：项目模式（hy4free）让它归档 Metre 建的会话，它如实说「还没归档，要你点确认卡片」，会话确实没归档；用卡片按钮调的同一个网关方法 `pinkie.session.manage.confirm` 点了之后才归档。Metre 删除也直接做了。卡片在真界面里的样子没截图（同 A2-2） |
| A2-5 delete 只有 Metre、能恢复 | 过。隔离副本：Metre 删了那个会话，回复里给出备份位置；备份目录里是 `.jsonl`、`.trajectory.jsonl`、`.trajectory-path.json`、`session.json`；会话从列表里消失；用 `pinkie.session.manage.restore` 恢复后同一个 key 回来，聊天记录（用户那句和助手的回答）都在，项目绑定在。唠嗑模式让它 delete：参数校验直接拒（老模式的工具参数里没有 delete），代码里也再拒一次（单测）。同一天删两次同一会话备份不互相覆盖（单测） |
| A2-6 无限制和临时会话没有 | 过。单测：无限制、临时会话、分身、非碧琪 agent 的工具工厂返回空。隔离副本：无限制模式说自己没有 `pinkie_sessions` |
| A2-7 用户起的名不改 | 过。隔离副本：先用侧栏同一个方法 `pinkie.session.rename` 把会话改成「我亲手起的名字」，Metre 再改，工具返回「这是用户自己起的名字，不改」。单测另有「没有记录但名字像样」的一条 |
| Z1 全量测试 | 没跑全量（全量在本机会挂，见批 0 Z1）。跑了相关的：`session-manage` 15 条、`sidebar-placements` 4、`session-cards` 6、`sidebar-sessions` 19、`sidebar-session-tree` 9、`session-lineage` 37、`session-titles` 16、`session-search` 5、`plugin-contract-tools` 1、`metre-inject` 7、`patches-wired` 1 全过；`mode-architecture` 167 过 1 没过（`computer tool discovers…`，断言的是 Mac 的说法，本批之前的提交上一样没过）。`mode-architecture.test.mjs` 改了两处期望：工具数 25 → 26、清单里多 `pinkie_sessions` |
| Z2 正式环境 | 没碰。收工时 `openclaw.json` 2026-11-13T23:50:37（本会话开工前），安装目录 2026-11-03T14:57:22，18789 没有监听。开工时没记，补记的是收工数 |
| Z3 老模式不变 | 过（只加不改）：老模式只多了一个工具，原有工具和注入没动；`session-lineage.mjs` 没改 |
| Z4 personas | 过：没碰 |
| Z5 推送 | 过：分支 `claude/metre-b2-sessions-74852b` 已推，并由本会话合进 `feat/metre-mode-1113` 推送（11-14 用户改的安排） |

预算：`pinkie_sessions` 的说明只在工具定义里，不进每轮的提示词（PLAN 2.2「不含工具定义」）。`node tools/metre/inject-inventory.mjs project metre` 本批前后 Metre 的注入字数不变，工具数 22 → 23。说明本身：Metre 版 499 字、参数 691 字（JSON）；老模式版 349 字、参数 622 字。

隔离副本：C 盘快满，本批的副本建在 F 盘（`METRE_ISO_ROOT=F:\tmp\claude\…\scratchpad\iso-metre-b2`，端口 2548，已停）；第一次在 `%USERPROFILE%\碧琪实测\iso-metre-b2` 建到一半 C 盘满了，已删。真模型统一 `mm/workbuddy/hy4free`。

后续（11-14 用户改了安排：批 2 自己合进主线，主会话不再代合。下面是合并时还没做、留给别的批的）：
1. **状态词**：`laolao-phrases.js` 已加工具名「整理会话」（单独一行 `toolLabels.pinkie_sessions=…`，没动批 3 改的那张表）。阶段条的类别（PLAN 2.8 的 `manage`：进行中「正在整理会话」）在 `laolao-cle-stage.js` 的三张表里，是批 3 的活，我没加；批 3 合进来之前，`pinkie_sessions` 在阶段条上按「正在用工具」显示。
2. **和批 1 撞的地方**：`openclaw.plugin.json` 的 `contracts.tools` 和 `mode-architecture.test.mjs` 的工具数（批 1 加 `pinkie_models` 后是 27）。批 1 的 `pinkie.metre.stopAll` 可以直接用 `SessionManager.stopChildren(parentKey)`（只停不归档，清掉排队的启动和消息，12 秒超时）。
3. **唠嗑模式「只聊天」档**（profile minimal）只放行 `MINIMAL_CHILD_TOOLS` 那四个，`pinkie_sessions` 在那一档里用不了。要开放就在 `session-lineage.mjs` 的 `MINIMAL_CHILD_TOOLS` 和 `laolao-settings-user.js` 的 `CHILD_SESSION_TOOLS` 各加一项（批 1 的文件，留给合并时定）。
4. **搜 Metre 自己的会话**：`session-search.mjs` 的 `MODE_AGENTS` 加 `metre: 'metre'`，再把 `session-manage.mjs` 里 `searchSessions` 的模式表加上 metre。
5. 删除不清项目绑定记录（`bindings.json` 里那条留着，恢复时正好用上）；侧栏里那条会话在下次列表刷新时消失。

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

### 批 3 · 通用补缺（Windows，Opus 5.5，11-14，分支 `claude/metre-b3-gaps-008419`；本节由合并的主会话补写，批 3 会话没写）

改了什么：新 `ui/injections/laolao-tool-kind.js`（命令 / 工具调用分类和 PLAN 2.8 那张话术表，macOS 和 Windows 命令都认）；舞台 `laolao-cle-stage.js`、工具流 `laolao-tool-stream.js`、状态条 `laolao-run-status.js` 的文案表补齐同一组类别（含 `manage`「正在整理会话」、`models`「正在看可用模型」）；后端新 `tool-trace.mjs`（写入前查文件在不在 → 「创建」还是「写入」；记下工具真读过的图片，`/pinkie-tool-image/` 只给这些图，按 id + key 取、不暴露路径；exec 的命令首行留着，刷新后还能说「删除了 / 安装了」）；新 `laolao-tool-images.js/.css`（40px 缩略图，最多 4 张 +N，图没了是灰框，点开走 `laolao-image-viewer`）。`laolao-phrases.js` 加了 `pinkie_sessions`「整理会话」、`pinkie_models`「看可用模型」。

| 项 | 结果 |
|---|---|
| A3-1 创建 / 写入 | 过（单测，每个模式） |
| A3-2 每个类别一条用例、判定不了不猜 | 过（单测） |
| A3-3 看图片 ≠ 生图 | 过（单测） |
| A3-4 四张表类别一致 | 过（单测守着） |
| A3-5 缩略图、点开大图、5 张显示 4+1 | 过（单测） |
| A3-6 刷新、重开后还在 | 过（单测：网关重启后照样能取；第二个提交专修了「新开浏览器」的情况） |
| A3-7 越权 | 过（单测：没被读过的路径取不到） |
| A3-8 图删了显示灰框、不发请求 | 过（单测） |
| A3-9 Windows 路径 | 过（单测：盘符、反斜杠、中文名、相对工作区） |
| 界面实看 | 没测：合并后没在隔离副本里截图（R1 要求 A3-1、A3-5 真机各过一遍，留给批 7） |

### 11-14 主会话合并批 1、批 3（Windows，Opus 5.5）

- 批 1 会话做完没提交最后一步（工具清单登记 `pinkie_models`、PROGRESS 自查），主会话代提交（9a415ee7）后合并。批 3 两个提交直接合并。
- 冲突：工具清单测试改成 27 个（`pinkie_models` + `pinkie_sessions` 都在）；`index.mjs` 两处 import / 注册都留；`laolao-phrases.js` 用批 3 那行（两个新工具一起登记）；批 1 给 Fable 的问题改号 F10–F12，原 F8（预算 5990 / 6000）已被 F4 的答复（6500）取代，删了。
- **合并时补的漏**：`setup.py` 和 `installer/macos/apply-theme.sh` 的服务文件清单没有 `metre-models.mjs`、`model-tiers.json`、`tool-trace.mjs`，装好的包会在加载插件时缺文件。已补，`every relative import ... installer list` 测试转过。
- 批 2 留下的第 1 条（阶段条 `manage`）批 3 已经做了；第 2 条（和批 1 撞）合并时解了。第 3 条（只聊天档放不放 `pinkie_sessions`）仍等 F9，第 4、5 条没动。
- 预算：合并后 Metre 一轮 **6413 / 6500**（工作区 5651 + 插件注入 762），工具 24 个。
- 测试：批 0–3 相关的 29 个测试文件 453 条，失败 3 条都和本次合并无关、合并前就失败：`computer tool discovers ...`（这台 Windows 没有 computer 执行器，文案不同）、`sidebar-handshake` 一条、`cross-process audit writers` 偶发（合并前后各跑两次都有过有不过）。
