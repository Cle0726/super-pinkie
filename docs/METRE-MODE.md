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
