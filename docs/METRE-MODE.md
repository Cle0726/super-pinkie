# Metre 模式

Metre 是第六个模式：不聊天、不陪伴，专门把一件事从头管到尾——读懂要什么、拆开、派给合适的模式和模型去做、盯进度、亲自验收、用大白话汇报。方案、验收标准和接力记录在 `briefs/metre-mode-1113/`（PLAN、ACCEPTANCE、PROGRESS、BOARD-HANDOFF、INJECTION-INVENTORY）。

## 身份和手册

- agent id `metre`，工作区 `.openclaw/workspace-metre`，手册 `personas/metre/AGENTS.md`、`IDENTITY.md`、`SOUL.md`，安装和更新时跟随官方版本（和其他模式同一套规则）。`TOOLS.md`、`USER.md`、`HEARTBEAT.md` 是 0 字节占位（不注入，挡住 OpenClaw 自动补的英文模板）。
- 设定防护照旧保护这三份手册：聊天里改不了。用户想调 Metre 的做法写进 `USER.md` / `TOOLS.md` 或项目记忆的 `preferences`。
- 每轮固定文字开销预算 **6500 字**（`node tools/metre/inject-inventory.mjs project metre` 量，`tests/metre-inject.test.mjs` 卡住）。碧琪的人设、陪伴、学习、富回复说明等注入在 Metre 里全部短路；门禁类逻辑不动。项目记忆的档案另算（≤1800 字，没绑文件夹时 0 字）。
- 权限：和无限制模式同一套工具放行，不设确认关卡。

## 派发（Baton）和独做（Virtuoso）

- 输入框下面的开关：Baton = 派发，Virtuoso = 独做（鼠标靠近才显示中文说明）。存在 `pinkie.session.prefs`（字段 `dispatch: dispatch | solo`），每轮注入一行【本轮：派发】/【本轮：独做】。独做时 `pinkie_session_start`、`pinkie_mode_ask` 两个工具直接不提供。
- `session-lineage.mjs` 里所有 Metre 规则都按「父会话是不是 Metre」分支，老模式的数值和行为不变：
  - 子会话必须写 `mode`（chat、project、ideas、learning、unrestricted；只有 Metre 能派无限制模式），不能开在 Metre 里；只能一层。
  - 模型：写 `pinkie_models` 返回的 id；收费模型不能与 Metre 自己相同，标记为免费的同款模型可以；派活时按 `model-tiers.json` 的分档和健康记录检查。
  - `in_scope` 在用户发来的那一轮和被汇报叫醒的那一轮都能用，一轮最多 6 个；同时在跑上限 8，一次用户请求累计上限 24（用户一回话就归零）。
  - 可以带 `folder` 把子会话开到另一个项目文件夹。
- 暂停派发 `pinkie.metre.pause {key, paused}`（已经在跑的照常，新的不开）；全停 `pinkie.metre.stopAll {key}`（停 Metre 这一轮和名下所有在跑的子会话，不归档、不删）；接着做 `pinkie.metre.resume {sessionKey}`（以用户的名义给 Metre 发一句继续）。

## 外部引擎

Metre 的一个会话可以不用 Metre 自己的模型，整段交给外部编码引擎来做：Claude Code、Codex、Antigravity、Cursor、OpenCode、Grok Build、Kiro、Pi、fx、Muse Code。用的是用户自己登录的账号和额度，碧琪不转卖、不代付。方案和接力记录在 `briefs/metre-engines-1122/`（PLAN、PROGRESS）。

### 打开和关掉

- 默认关闭。关着时不下载、不启动任何东西，五个老模式和没打开的用户都不受影响。
- 两处能开：Metre 输入框下面的「引擎」按钮，和设置「连接」里的「外部引擎」（打开 / 关掉）。关掉只在设置里，要点两下：引擎服务会停，正在跑的外部引擎对话和派出去的活也会停；下载过的引擎服务留着，再打开不用重下。
- 第一次打开会下载约 170MB 的引擎服务（固定版本，对照 SHA-256 校验，走碧琪的代理设置，显示进度；下载失败就说清楚，不留半截文件）。
- 引擎服务只在这台电脑上跑、只监听本机（`127.0.0.1`）。开关一关或碧琪退出就停；崩了自动重启，最多 3 次，之后提示。
- 装在碧琪状态目录下的 `engines/`。路径必须是纯英文：用户名是中文时改放 `%LOCALAPPDATA%` 下的英文目录，再不行放 `C:\ProgramData\SuperPinkie\engines`。
- 代码：`services/mode-architecture/engines.mjs`（服务）、`engines-bridge.mjs`（网关方法 `pinkie.engines.*`）、`engines-rpc.mjs`（实时通道）；界面 `ui/injections/laolao-metre-engine.js/.css`，只在 Metre 生效。

### 选引擎、登录

- 「引擎」菜单里十家按「能用 / 没打开 / 没装 / 没登录」分组：没打开的点「打开」；没装的给安装命令（可以复制，也可以点「在终端里装」，点了才开终端）；没登录的给登录。
- 碧琪不经手账号和密码。登录一律在无痕窗口里由用户自己完成（先找 Edge InPrivate，没有就用 Chrome 无痕，都没有才用默认浏览器）；有的引擎在终端里跑官方登录命令（比如 Claude Code 的 `claude auth login`）。Antigravity 有时最后给一串代码，贴回 Metre 的框里就行。要填密钥的登录方式不在 Metre 里做，提示改用浏览器或终端登录。
- 多账号：Claude、Codex、Antigravity、Cursor 一家可以加好几个账号。菜单里「＋ 再加一个账号」→ 起名字 → 选哪一家 → 直接进这个账号的登录。一个账号一行，显示名字和套餐名，不显示邮箱。默认账号不能删，可以关。其余六家用这台电脑上同一份登录。一个账号额度用完了，换同一家的另一个账号接着用。
- 加出来的账号，设置卡片底下可以改名字、删掉（点两下才删）。删 Claude / Codex 的账号时，它的登录文件夹留在磁盘上，不跟着删。
- Metre 的 Claude 账号各用自己的文件夹 `~/.claude-metre-<n>`，不碰用户的 `~/.claude`（Claude 桌面 App 也读它）；Codex 的账号各用一个 `~/.codex-metre-<n>`，和 `~/.codex` 共用对话记录。
- 引擎版本太旧会提示先更新（比如 Codex 要 0.159 以上，旧版直接报错）。
- 账号邮箱不显示、不写日志、不外发；和引擎服务通话的令牌现签现用，只放在内存里。

### 引擎台

选了外部引擎，这个 Metre 会话的正文区就换成「引擎台」。引擎台是 Metre 自己画的，样子和用词都照 Metre：

- 对话流：你说的话、回答、思考（看完自动收起）、跑命令、改文件、搜索、用工具，一行一行，点开看细节。工作状态行用和原生对话同一个 C.le. 思考动画。
- 待批准卡片：批准 / 这次都批准 / 拒绝（可以附一句理由）。提问卡片：点选项，或者自己写。计划清单画成 Metre 的清单和谱纸卡。
- 右侧改动面板：按文件列 +/−，点开看差异。Metre 自己的草稿文件夹第一次用时会 `git init`，好算整段差异；用户绑的项目文件夹不碰。
- 输入框：没在跑时就是发送；正在跑时默认「排队」（这一步做完再递进去），也可以切「插话」（马上递进去）；旁边一颗「停」。
- 开新对话时可以选「在新的工作树里做」，不动当前文件夹里的文件。标题栏可以置顶、归档这段对话。
- 引擎、模型和放手程度在「引擎」按钮里选，按 Metre 会话记住。侧栏还是这一行 Metre 会话，标上账号名（比如「Claude Code · Metre」）。
- Metre 派来的活，引擎台顶上多一行「Metre 派给某某的活，做完会自动交回」，旁边「回到 Metre ›」。

### 放手程度

四档，对话中途可以改，按各家引擎自己的权限来执行：

- **全放手**（默认）：命令和改文件都直接做；真有问题或缺账号才来问你。和 Metre 自己「不设确认关卡」一致。
- **自己判断**：常规操作自己批，拿不准的来问你。
- **改文件不问**：改文件直接做，跑命令等别的事先问你。
- **每步都问**：跑命令、改文件之前都先等你点头。

### 乐手

乐手是一套记好的搭配：名字 + 引擎（哪个账号）+ 模型 + 放手程度 + 可选的 Metre 角色卡。引擎菜单里「乐手」一组一键选用；「＋ 把现在这一套记成乐手」；× 点两下删。存在引擎目录的 `players.json`（`engines-players.mjs`）。带角色卡时，卡的正文放在任务说明前面一起交给引擎（引擎看不到 Metre 的角色系统）。

### Metre 派活给引擎（`pinkie_engine_task`）

- 只在 Baton（派发）下、外部引擎打开时提供；Virtuoso 和子会话里都没有。代码 `engines-task.mjs`。
- 动作：`engines`（列出能用的引擎、模型、乐手）、`start`（开一件活：`engine`、`model`、`task`，可选 `folder`、`level`、`player`）、`say`（递一句话）、`stop`、`show`。`start` 不等引擎做完就返回。
- 活挂在父会话下面：侧栏父会话下多一行，标「引擎 · 模型」（比如「Antigravity · Gemini 3.8 Flash」），点开就是这件活的引擎台；总谱里是一个声部，写此刻在做什么（比如「改 e4.md」），时间条从交出去一直画到交回。在总谱这个声部里点「发消息」，话直接递给引擎，不会在子会话里跑一轮 Metre。
- 用户在这件活的引擎台或总谱里递了话，Metre 会重新盯着，做完再交回一次。
- 自动交回并叫醒 Metre：做完是汇报卡片（最后的回话 + 改了哪些文件）；没做成是失败卡片，原因用大白话；要批准或回答时出「等你」卡片，侧栏也写「等你」。开了 90 秒还没起跑、或者引擎服务停了约 1 分钟，算没做成。全体收住时这些活一起停。
- 和别的子会话共用在跑上限：同时最多 8 个，一轮最多派 6 个，一次用户请求累计 24 个；暂停派发时也不开新的。给这件活递话用 `say`，不用 `pinkie_session_message`。

### 额度用完、没登录

- 引擎没开、没登录、额度用完，菜单和引擎台里都用大白话说清楚，并给出下一步（打开 / 去登录 / 几点恢复），不当成程序出错。
- 有的引擎按模型分额度（比如 Antigravity）：只是某几个模型满了，这家照常能用，模型菜单里把那几个放暗，写「额度用完了，几号恢复」；所有模型都满了才算整家用完。

测试：`metre-engines`、`metre-engines-bridge`、`metre-engine-task`、`metre-engine-ui`。

## 工具

| 工具 | 文件 | 说明 |
|---|---|---|
| `pinkie_models` | `metre-models.mjs`、`model-tiers.json` | 只读本机模型目录和健康记录，带档次、能否看图、工具稳不稳、是不是自己 |
| `pinkie_sessions` | `session-manage.mjs` | 列、搜、读、新建、改名、解绑、归档、停、删（先备份）、找回。Metre 全部直接生效；老模式动别人的会话（archive / stop / rename / detach）先出确认卡片，delete / restore 只有 Metre 有 |
| `metre_memory` | `metre-memory.mjs` | 按文件夹隔离的项目记忆：recall / remember / update / forget；每轮注入当前文件夹的档案 |

Metre 看到的工具说明里不叫「先生」「碧琪」（`ask.mjs` 的 `metreWording`）。

## 总控台

- 页面 `ui/injections/laolao-metre-board.js/.css`（骨架），数据 `laolao-metre-board-data.js`，后端 `metre-board.mjs`。入口：侧栏「总谱」。
- `pinkie.metre.board {sessionKey}` 一次返回 overview / plan / sessions / pending / timeline / changes / runtime / raw。后端自己记一本小账（`<状态目录>/metre-board/`）：每个子会话干活的时间段（画成总谱）、此刻在做什么、改过的文件和行数、时间线、等用户回答的提问、用量、最近 200 条事件；其余从血缘、计划清单、模型健康、网关会话列表拼。
- 前端只在 `pinkie:gateway-event` 来时刷新，每秒最多一次，关着不拉整份；断线时变灰并写「连接断了，正在重连」。项目记忆区读 `pinkie.metre.memory`，可钉住、编辑、删除、搜索。

## 角色

角色卡给 Metre 的子任务规定做法和汇报格式。比如可以说「把接口报错交给后端修 bug 的角色，最后核对回归测试」。角色不是第七个模式，不能从模式菜单切进去，也不改变碧琪的五个旧模式。

以下派活接口是 [角色计划](../briefs/metre-roles-1118/PLAN.md) 各车道合入后的约定。完整验收仍以计划的测试证据为准。

- **派给角色。** Baton（派发）状态下，Metre 可用 `pinkie_roles` 查看合格角色、来源和不合格原因，也可以按 `id` 看整张卡。派活工具 `pinkie_session_start` 用 `role` 指定角色，例如 `backend-fix`；带角色时 `mode` 不生效，不带角色则仍须指定 `mode`。只想当场问一个问题，可用 `pinkie_mode_ask` 指定角色。独做时不提供这些派活工具。
- **任务怎么跑。** `roles` 是 Metre 专用的后台 agent，子会话不能再派子会话。卡每轮都会带上，卡允许的工具类别决定这单能做什么；没指定模型时，Metre 后端按角色要求筛选模型。工作区是 `~/.openclaw/workspace-roles`，里面的打法和视觉规范供按需读取，不会当做人设注入，也不存项目记忆。
- **放自定义卡。** 在 `~/.openclaw/workspace-metre/roles/user/` 创建或保存一个 Markdown 文件，文件名须与卡的 `id` 一致（如 `log-check.md`）。可参考官方卡，保留开头的元数据和「做法」「边界」「交回」三节，完整格式见计划第 3.1 节。有同 `id` 的合格自定义卡时，优先用自定义卡。不合格的卡不参与派活。
- **让 Metre 起草。** 同一项目在 14 天内第 3 次把同类任务不带角色派出去时，Metre 会收到起草提示。合格草稿只存到 `roles/drafts/`，你可以在会话中看完整草稿，点「采用」后才进 `roles/user/` 并可用于派活，点「不要」会删除草稿。采用不会覆盖已有的同 ID 自定义卡。
- **安装与更新。** 官方卡跟随版本安装到 `~/.openclaw/workspace-metre/roles/` 的顶层；被换掉或退役的本机旧卡先存入安装器的 `backups/`，不会直接丢掉。安装和更新不进入 `roles/user/`，也不会改里面的文件。要长期保留自行修改的卡，应放到 `roles/user/`，不要直接改官方卡。
- **去哪看。** 总谱「声部」显示「角色名 · 模型」，自定义卡另标「自定义」；「调音」显示合格、不合格的张数，不合格原因可以点开看。无角色的任务仍显示原模式和模型。
- **怎么关闭。** 如果需要排查角色问题，可关掉后端设置 `metreRoles`，回到只按模式派发。这个开关不在设置页，不需要删除卡文件。

## 界面

- `laolao-metre-skin.js/.css`：进 Metre 时停用碧琪的装饰样式表，换成素净的版式（对照 Claude 桌面版截图做，见 `briefs/metre-mode-1113/ref/`）；离开时恢复。
- 像素黑猫（`laolao-metre-cat.js`，帧数据 `laolao-metre-cat-frames.js`，用户点过头的版本）在状态条里随运行状态换动作，旁边是项目记忆的芯片。
- 空状态引导语 `laolao-metre-home.js` + `laolao-metre-prompts.js`（当前 54 类、590 句；以题库为准），彩蛋数据来自 `pinkie.metre.today`。

## 资源关停

- 前端 `laolao-quiet.js`：模式变成 metre 时调各模块登记的 `suspend()`，离开时 `resume()`，不用刷新。现在登记的：小碧琪（状态循环停、WebGL 画布销毁并还回上下文）、打盹和自动减负、三维状态小标（three.js 用到才加载；Metre 运行时也可显示，结束后释放 WebGL）、沉浸、激光笔、派对和圆桌入口、学习资料库。量具 `tools/metre/resource-meter.js`（配合 `capture.mjs --init`）。
- 后端 `quiet-mode.mjs`：界面告诉网关现在是 Metre（`pinkie.quiet.set`，30 分钟不续就作废），且没有别的模式的会话在跑时，心跳、学习提醒、学习资料的排队轮询停下；网关、模型同步、看门狗、子会话调度照常。消息渠道默认照常，设置「连接」里可以打开「Metre 模式下暂停消息渠道」。

## 测试

`metre-inject`、`metre-dispatch`、`metre-memory`、`metre-board`、`metre-quiet`、`metre-wording`、`metre-skin-cat`、`session-manage`、`session-lineage`。真模型实测用隔离副本：`tools/metre/iso/`（`setup.py` 建 / `sync` 同步插件，`gateway.py start|stop`，`drive.py` 跑 ACCEPTANCE 批 7 的九道题）。副本放 F 盘：`METRE_ISO_ROOT=F:\碧琪实测\iso-…`。
