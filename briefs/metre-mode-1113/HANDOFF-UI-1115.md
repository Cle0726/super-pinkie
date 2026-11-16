# Metre 页面整改 · 交接（2026-11-15 晚，Mac，Fable）

用户原话（11-15 晚）：
- 「你先看看这个 Metre 页面 UI 设计吧 按键 BUG 一堆 都说页面全部单独做一套 现在里面还是有碧琪用的元素」
- 「你来负责改 直接改 不用写计划给别人了 像素视觉元素没有 Metre 自己的感觉 像素也密度也低 质量太差，整体也没有大厂的氛围和呼吸感」

所以：**Fable 自己直接改代码**，不再写计划派给别的模型。这份文件只是上一个会话上下文用到一半时的交接，新会话读完就动手。

## 在哪干活

- 工作树 `/Users/Admin/release-superpinkie/wt/metre-install`，分支 `fix/metre-native-menu-hit`（在 `feat/metre-mode-1113` 之上）。提交即推送，只推开发分支，不动 main / tag / Release。
- 界面文件都在 `ui/injections/laolao-metre-*.{js,css}`，另有 `laolao-mode-switcher.js`、`laolao-run-status.js`、`laolao-deep-think.js`、`laolao-splash.js` 等里面的 Metre 分支。改了文件要同步 `laolao-head.fragment.html` 里的 `?v=` 版本号。
- **只在隔离副本里看和点**：`/Users/Admin/碧琪实测/iso-thinking`，网关 64560（`python3 -I gateway.py start|stop`），沙箱禁止碰正式 App / `~/.openclaw` / 18789。
  - 本会话已给它补了 `metre` agent（配置备份在 `backup-ui-1115/openclaw.json`），并把它的 control-ui 对齐到已装 App 的版本（metreskin7）。
  - 页面：`http://127.0.0.1:64560/chat?session=agent%3Ametre%3Amain`，token 在 `state/openclaw.json` 的 `gateway.auth.token`（第一次打开带 `?token=`）。
  - 它的界面目录是扁平的 `runtime/openclaw/dist/control-ui/`：改完仓库里的文件，直接把同名文件复制过去刷新即可（index.html 的版本号也要跟着改，或者加一次性查询参数绕缓存）。
  - 内置浏览器截图只有 800×500（1440×900 缩小的），看像素细节要用 `zoom` 或 headless Chrome 整窗截图（`capture-chrome.mjs` 在副本根目录）。
- 人设 MD（`personas/metre/*.md`）只归 Fable 改；这次不涉及。
- 装进正式 App 之前先给用户看截图，用户点头再装（美术按预览原样上）。

## 已经量到的按键 BUG（1440×900，深色，Metre 首页）

用 `elementFromPoint` 逐个按钮做了命中测试，再真点了一遍：

1. **折叠侧边栏按钮点不动**：`button.sidebar-brand__icon`（24,22 30×32）被 `section.sidebar-sessions.laolao-managed-sessions` 盖住，点了侧栏不收。
2. **总控台打开后盖住顶栏右上三个按钮**：「打开工作台」「打开浏览器」「聊天会话菜单」被 `.pk-metre-board__actions` / 关闭键盖住，点不到。
3. **输入框里有一个看不见的 278×32 按钮** `button.laolao-context-viewer__compact`（674,815），被 `.agent-chat__composer-combobox` 盖着，是碧琪那套的残留，应该在 Metre 里不存在或放对位置。
4. **思考强度弹层**：弹出来是碧琪那张粉色玻璃卡（基础档 / 加强档 / 全开档 / 长跑档，带碧琪头像），而且压在输入框上。
5. **模型选择弹层**压在输入框上（从触发键往上弹，底边盖住输入框一半）。
6. **搜索面板**打开后按 Esc 没关（合成按键，要在真键盘焦点下再确认一次）；点遮罩能关。
7. 总控台顶上「暂停派发」「全部停下」当时是 disabled，title 写「待接入：接上派发接口后可用」——当时副本没有 Metre 后端，补了后端以后要重看。
8. 首页提示语和月亮撞在一起：长句换行后「只是」压在月亮上；总控台开着时整行压在月亮上读不清；「临时会话」提示条压在月晕上。
9. 首页底部三块看板（总控台 / 项目记忆 / 运行环境）在 1440×900 没看到，确认是被拿掉了还是没显示。

**还没点过的**（新会话接着点完）：作品、设置、「⋯ 更多工具」、最近会话菜单、右上工作台 / 浏览器 / 会话菜单、Baton / Virtuoso 切换、换一句、上下文圈、真发一条消息后的对话页（状态条、工具卡、思考了、消息操作键）、浅色主题、切换过场、启动闪屏、窄窗口（1100×700）、总控台各区块里的按钮。

## 还留着的碧琪元素

- 文案：`极致思考：让碧琪多想几轮再答`（按钮 title / aria）；`碧琪的进度`（aria-label）；报错条 `碧琪这里碰到一点小状况，没能做完。点「原文」能看到具体信息。`（`.pinkie-biqi-notice`）；报错条关闭键 aria 是英文 `Dismiss error`；窗口标题「超級碧琪」。
- 颜色：`circle.pk-dot` 填充 `rgb(242,138,184)`（碧琪粉）。
- 整块沿用碧琪样式的弹层：思考强度卡（粉玻璃 + 碧琪头像）、工具箱（紫调玻璃，里面有「网页 GPT 协作」「拆分视图」等碧琪项）、搜索面板（紫边玻璃）、模型选择、悬浮提示（粉白底的 tooltip）、报错条。
- 扫描方法：页面里跑一遍「可见文字 / aria / title 含 碧琪|Pinkie|先生」「img / 背景图文件名」「色相 285°–5° 且饱和度 > 0.3 的 color / background / border / fill」。每个弹层打开后都要再扫一次（弹层是点了才进 DOM 的）。对话页、总控台、设置页同样要扫。

**原则**：Metre 里用户看得见的每一个面（弹层、提示、报错、空状态、滚动条、选中色、焦点环）都用 Metre 自己的样式和中性文案（称呼用「Metre」或不带主语），不出现碧琪的图、粉 / 紫玻璃、俏皮话。类名里带 pinkie / laolao 不算（用户看不见），不用改。

## 像素视觉重做（Fable 定的方向）

现状的问题（对着截图看）：
- 题材是月亮 + 山 + 电线杆 + 音符 + 草，照参考视频抄的，没有一样是 Metre 自己的。
- 整屏盖着一层约 8px 的 LED 点阵格，画面发脏；真正的像素画格子又大（约 6–8px 一格），月亮、猫、电线杆都是几十格的小图，密度低，读起来像示意图。
- 场景铺满整页，星星、月晕、音符到处都是，没有一块安静的地方；提示语直接压在画上。

新方向：**「谱台灯」——从指挥台看出去的夜间乐池**。Metre 干的事就是指挥：一个指挥，一排排等着开工的声部。
- 画面只占页面**底部约 28%** 的一条：一排排谱台由近到远，每个谱台上一盏小灯；正中偏右是指挥台，黑猫（C.le. 控制台那只：大尖耳、斜的蓝眼、尾巴绕到前面）坐在上面背对 / 侧对观众；最远处的舞台口是像素 M 节拍器的剪影。
- 上面 70% 是空的：只有一层很细的抖动渐变（大厅的暗），不放星星、月亮、音符。提示语、对话正文都在这片空里，永远不和画重叠。
- **和功能绑在一起**：谱台灯 = 子会话。没有子会话时只有指挥台一盏灯；每派出一个子会话亮一盏（在跑 = 钴蓝，做完 = 暖白渐暗，出错 = 砖红），数据用总控台同一份（`laolao-metre-board-data.js`）。这是别的产品没有的、只属于 Metre 的画面。
- 拍子：只有指挥台的灯和节拍器摆锤按 ♩=72 跳格，别的不动。减少动态效果时静止。
- 质量要求：格子 **2 CSS px**（高 DPI 下按设备像素取整，保持格子锐利），最近邻放大；精灵手摆（猫不小于 40 格高，谱台不小于 14 格高）；每种材质 5–6 级色阶，渐变用 4×4 Bayer 抖动；实心剪影 + 一圈亮边 + 灯下一小片抖动光晕；去掉全屏 LED 点阵格。画完每一帧都放大看一遍，有锯齿错位、孤立像素、脏色就改。
- 浅色主题：同一张画换成谱纸上的墨线版（暖白底、墨色剪影、灯是钴蓝点），不是把深色反相。
- 对话页：同一条画带压得更低更淡（约 16% 高、对比度降一半），输入框后面留实底。
- 切换过场、启动闪屏、总控台空状态里的小图都按同样的格子密度重画，题材统一成谱台 / 指挥台 / 节拍器 M，不再出现月亮山坡。

## 排版和留白

- 首页只留三样：提示语、输入框、底部画带。提示语上面那行「Reflective Prompts ♩=72 ····  换一句」收成一行很小的灰字，或者只在悬停时出现。
- 提示语最多两行，左右各留出至少一栏宽的空，行高放松；总控台开着时提示语跟着变窄但不换成三行（字号降一级）。
- 输入框下面那一排（Baton / Virtuoso、模型、强度、极致思考、上下文圈、项目未跟随提示）现在是碧琪的工具条原样搬来的，挤成一串：分成左（Baton / Virtuoso）右（模型 · 强度 · 上下文）两组，中间空开；「项目未跟随…」那行小字移走或只在有事时出现。
- 弹层统一：一种圆角、一种边框、一种阴影，实底不透明（不要玻璃），从触发键旁边弹出且不盖住输入框。
- 侧栏、顶栏、总控台的间距对齐到 8 的倍数，标题和内容之间留够空，总控台各区块之间不要挤。

## 顺序

1. 修按键 BUG 1–6，补点完没点过的按钮，有新的记到这份文件末尾。
2. 清碧琪元素（文案 → 颜色 → 各弹层）。
3. 重画背景（先首页深色 → 浅色 → 对话页 → 过场 / 闪屏）。
4. 排版留白。
5. 隔离副本里逐页截图（深 / 浅、首页 / 对话 / 总控台 / 各弹层、1440×900 和 1100×700），跑 `tests/` 里 Metre 相关单测（`metre-skin-cat`、`mode-switcher`、`mode-menu-fx`、`run-status-ui`、`motion` 等，断言跟着新设计改）。
6. 提交推送；把截图发给用户看，用户点头后再装进 App。更新 `PROGRESS.md`。

---

# 接力 2（11-15 深夜，Fable）：做到哪了、下一个会话从哪接

**用户新说的一句（最要紧）**：「像素细节要高，不要像之前一样，你自己看着办」。——现在这一稿「谱台灯」只算底稿：格子是 2px 了、题材对了，但精灵偏平、偏小、细节少。下一步先把细节加上去再做别的美术（见下面「美术还差什么」）。怎么画自己定，不用再问用户方向。

## 已经做了并推送的

1. **新背景 `laolao-metre-backdrop.js` 整个重写**（月亮 / 山 / 电线杆 / 音符 / 草 / 星星 / LED 缝全删）：
   - 纯函数 `buildScene({cols, rows, band, dark, home, lamps, quiet, dim})` 画静的一层，`paintMoving()` 叠会动的两样（指挥台灯、节拍器摆锤，♩=72 半拍一步）；挂在 `globalThis.__pinkieMetreScene`，node 里可以直接 `require` 出图。
   - 精灵都是文件里一格一格写死的字符画：`CAT`（36×44）、`STAND_NEAR`（23×30）、`STAND_MID`（17×22）、`STAND_FAR`（11×16）、`STAND_LEAD`（指挥台上背对我们的谱台）、`LOGO`（像素 M，按舞台口高矮放大 1–3 倍）。
   - 灯 = 子会话：`lampStates(window.__pinkieMetreBoardData.data.sessions)` → `run / done / fail / wait`，离指挥台最近的谱台先亮；每拍对一次签名，变了就重画静层。验收 / 截图用 `window.__pinkieMetreBackdrop.preview(['run','run','done','fail'])`（传 `null` 恢复）。
   - 画布贴底：首页场景高约 28%（184–300px），对话页约 16%（112–168px）且颜色往底色退一半；上面再留一段只有抖动渐变的过渡。场景高写进 `--metre-band`（CSS 可以用它保证正文不压画）。格子按设备像素取整（`cellDev = round(2*dpr)`）。
   - 对话页用 `quiet`（输入框那一栏的格范围）把舞台口和指挥台让到两边空地，输入框后面不放谱台。
   - **`laolao-metre-backdrop.css` 还没动**（旧的透明链路还能用；`--bd-*` 变量已经没人用，可以删；画布现在自己设 `bottom:0; top:auto`）。
   - **首页看板三块（`.pk-metre-quick`，在 `laolao-metre-board.js` 357 行附近建的）还在页面上，会压在新画带上**：按「首页只留三样」把它拿掉（总控台侧栏入口里这三样都有）。旧背景里画看板图、鼠标悬停变亮的代码已删。
2. **离线出图**：`node briefs/metre-mode-1113/ref/render-backdrop.cjs out.png dark|light home|chat 倍数 run,run,done,fail [列数] [场景行数]`，`CROP=x,y,w,h`（单位：格）裁一块放大看。每改一次精灵就出图、放大 6 倍看一遍。草稿：`ref/v11-draft1-band-dark.png`、`ref/v11-draft1-band-light.png`（只有画带，不是整页）。
3. **按键 BUG 6（搜索面板 Esc 关不掉）**：`laolao-session-list.js` 的 `openSearch` 加了文档级捕获的 Esc（关的时候摘掉）。还没在隔离副本里复测。
4. **碧琪文案**（Metre 下换成平实说法，其他模式不变）：极致思考按钮 title / aria、「碧琪在回答」「已叫醒碧琪」（`laolao-deep-think.js`）；状态条 aria「运行进度」「看看在做什么」、审批提示（`laolao-run-status.js`，注意 aria 是 `build()` 时定的，条子若先在碧琪模式建好再切 Metre 不会变——可在 `render()` 里顺手更新）；首页 aria（`laolao-startup-home.js`）；模式菜单 aria（`laolao-mode-switcher.js`）；整理上下文提示（`laolao-context-compact.js`）；思考强度的说明文字（`laolao-model-picker.js` 的 `routeDescription` 包了一层）；报错条 28 条规则各配了一句平实版 `PLAIN`（`laolao-biqi-notices.js`，下标和 `RULES` 一一对应，改规则要两边一起改）。
5. `laolao-head.fragment.html` 的 `?v=` 已同步（backdrop3、deepthink31、runstatus6、mode50、notices3 等）；`tests/mode-switcher.test.mjs` 里钉的版本跟着改成 mode50。

**单测现状**：`metre-skin-cat` 15 过 / **2 条没过**（「Metre backdrop: exists only…」和「Metre v6 home: … board art drawn on the backdrop」——断言还是旧设计的，要跟着新背景改）；`run-status-ui` 13、`mode-switcher` 3、`mode-menu-fx` 9、`motion` 14、`brand-ui` 6、`tool-kind-words` 11、`metre-wording` 1、`metre-board` 12、`model-picker` 37、`sidebar-splash-polish` 8 全过。

**隔离副本里还什么都没装**：`runtime/openclaw/dist/control-ui/` 里仍是旧文件。装法：把改过的同名文件复制过去，并把那边 `index.html` 里对应的 `?v=` 改掉（那份 index.html 每个地址后面还带 `&h=…`，留着不用管）。探针已经放在那边 `zz-metre-probe.js`（仓库里的副本：`ref/metre-probe.js`），页面里先 `await new Promise(r=>{const s=document.createElement('script');s.src='/zz-metre-probe.js';s.onload=r;document.head.append(s)})`，然后：
- `MP.bad()` → 被别的东西盖住的按钮（模态遮罩盖住的另计 `masked`）；`MP.scan(根元素)` → 碧琪文案 / 图 / 粉紫色；`MP.info(sel)`、`MP.tree(el)`、`MP.over(a, b)`。
- **探针输出一定要短**：上一轮我把搜索遮罩没关时的整份命中清单打了出来，一次吃掉几万字上下文。每次只打 `bad` 和 `scan`，弹层逐个开、开一个关一个，关不掉就先刷新页面。
- 页面 token 已经在浏览器里记住了，直接开 `http://127.0.0.1:64560/chat?session=agent%3Ametre%3Amain` 就行；内置浏览器 `resize_window` 设 1440×900 + `colorScheme: dark`。

## 已经量清楚、还没改的（照着改就行）

**按键 BUG**
- **1 折叠侧边栏点不动**：`.sidebar-brand` 高度是 0、`position: static`，里面的 `.sidebar-brand__actions` 绝对定位在 (24,22)；后面的 `section.sidebar-sessions`（`position: relative`，盒子从 y=22 开始）盖在它上面。改法：Metre 下 `.sidebar-brand { position: relative; z-index: 5 }`。
- **2 总控台盖住顶栏右上三个按钮**：停靠态 `.pk-metre-board.is-docked { inset: 0 0 0 auto; z-index: 260 }` 从页面最顶开始。改法：停靠态 `top` 让出顶栏高度（或把那三个按钮挪到总控台左边），`laolao-metre-board.css` 409 行。
- **3 输入框里看不见的按钮**：本轮没复现（上下文弹层关着时按钮是 0×0）。它是上下文圈弹层里的「现在整理上下文」，弹层打开时会被挪到 body 下（`.is-floating`，fixed）。开一次、关一次上下文圈再用 `MP.bad()` 看；若关掉后弹层还留着尺寸，查 `laolao-metre-skin.css` 228 行那条给 `.laolao-context-viewer__popover` 的规则是否把关着的也显示出来了。
- **4 极致思考卡**：`div.laolao-deep-think-menu`（挂在 body，fixed，`laolao-deep-think.js` 里 `openMenu` 用 `rect.top - menuH - 8` 定位 → Metre 的按钮在输入框下面那一排，所以弹出来正好压住输入框）。结构：`__head`（svg 星 + 「思考强度」）/ `__choices` > `button.__item[data-tier]` >（`__icon` >`img.__poster` + `video.__art` + `__orbit` + `__numeral`）+（`__copy` > `__label` + `__summary`）+ `__recommended` / `__hint` / `__footer`。样式写在 js 文件 618–650 行的内置 `<style>` 里，全是粉玻璃。Metre 版：藏掉 `__poster / __art / __orbit`（碧琪的图和视频），`__numeral`（Ⅰ–Ⅳ）当图标；实底、细边、`__summary` 现在才 8.5px 要放大。
- **5 模型选择**：`div.chat-controls__inline-select-menu--combined`，`position: absolute; z-index: 30`，在 `details.chat-controls__session` 里往上弹，盖住输入框。「思考强度」按钮（`button.pinkie-effort-trigger`）开的也是这同一个弹层（里面的 `chat-controls__reasoning-panel`）。里面 `span.pinkie-reasoning-stop` 是粉的 `rgb(244,155,216)`。
- **弹层位置的统一规则（我定的）**：触发键在输入框下面那一排的（模型、强度、极致思考、上下文圈）——下面放得下就往下弹，放不下就弹到输入框上沿之上；触发键在输入框里面的（工具箱 `button.pinkie-tray-btn` → `div.pinkie-tray`，fixed 挂 body）——弹到输入框上沿之上，上面不够高再往下。都不许盖输入框。输入框的可见框 = `.agent-chat__input` 矩形的上面一段（首页 1440×900 时矩形是 532,458,656×140，可见框到 y≈558，下面 568–598 是 Baton / 模型那一排）。做法建议：新开一个小文件 `laolao-metre-popover.js`，弹层出现时（body 的 childList、`details` 的 `toggle` 捕获）量好位置写进 CSS 变量，皮肤里用 `top: var(--mp-top) !important; left: var(--mp-left) !important; bottom: auto !important`（各自的脚本会反复写行内 `top/left/bottom`，直接改行内值会被盖回去）。

**粉 / 紫 / 碧琪图（扫描结果）**
- 图标：`circle.pk-dot.pk-f` 填充、`path.pk-sweep.pk-a` 描边、工具箱里 `path.pk-a / .pk-f` 都是 `rgb(242,138,184)`（`laolao-icons.js` 的强调色类 `.pk-a` 描边、`.pk-f` 填充）→ Metre 下改成 `currentColor`。
- 极致思考卡：整张（见上）；`#laolao-deep-think-toast`、`#laolao-deep-think-status` 也是粉玻璃。
- 工具箱 `div.pinkie-tray`：底 `rgb(42,32,39)`（紫调）；结构 `__group > __title + __tiles > __row > button.__item >（__icon + __body > __name…）`；里面有「网页 GPT 协作」「拆分视图」等碧琪项，Metre 下该不该留逐项看。
- 搜索：遮罩 `div.pinkie-session-search-mask` 底 `rgba(33,22,30,.28)`；`section.pinkie-session-search-dialog` 字色 `rgb(247,234,240)`；里面 `input.pinkie-session-search-input`、`label.pinkie-session-search-filter`、`.pinkie-session-search-status`、`.pinkie-session-search-results > button.pinkie-session-search-result >（__title / __snippet / __time）`。
- 「⋯ 更多工具」`div.laolao-footer-overflow`：字 `rgb(119,60,89)`、底 `rgba(255,250,253,.94)`、边 `rgba(218,120,161,.18)`；项 `button.laolao-footer-overflow__item`（`__page` 是页面跳转项）、`__divider`。
- 通用菜单 `div.laolao-menu`（最近会话菜单、右上会话菜单、连接状态菜单都是它）：边 `rgba(255,255,255,.58)`、圆角 16、阴影 `rgba(84,42,65,.18)`；`button.laolao-menu__item`，危险项 `--danger` 是 `rgb(183,47,103)`（玫红）→ 换砖红。
- 上下文弹层 `.laolao-context-viewer__popover`（`.lcv-*`）、报错条 `.callout` / `.pinkie-biqi-notice-*`、悬浮提示 `openclaw-tooltip`（自定义元素，可能有 shadow DOM，没细看）、上游自带的英文 `aria-label="Dismiss error"`（在 `ui/runtime/chat-page-*.js` 里，别改上游文件；在 `laolao-biqi-notices.js` 扫到时改成「关闭」）：都还没处理。
- 模式菜单 `div.laolao-mode-menu` 已经是 Metre 实底（`rgb(35,35,33)`），不用动。
- 皮肤里现有的弹层规则只有 `laolao-metre-skin.css` 301 行那一条（圆角 12 + 阴影），`laolao-deep-think-menu / pinkie-session-search / laolao-footer-overflow / laolao-menu / pinkie-model-filter / openclaw-tooltip / pinkie-biqi-notice` 在皮肤里一条规则都没有。统一样式：底 `var(--metre-surface)` 不透明、`1px solid var(--metre-line-strong)`、圆角 10、一种阴影、不要 `backdrop-filter`。新规则追加在皮肤文件末尾，选择器前缀比前面的多一个 `:not(#_m3)` 就能压过旧规则，不用回头读那 1400 行。

**还没点过的按钮**（原清单里剩下的）：作品、设置、Baton / Virtuoso 切换、换一句、真发一条消息后的对话页（状态条、工具卡、「思考了」、消息操作键）、浅色主题、切换过场、启动闪屏、1100×700、总控台各区块里的按钮。已点过且能开的：极致思考、思考强度、模型、工具箱、上下文圈、搜索、更多工具、最近会话菜单、右上会话菜单、连接状态、模式菜单。

## 美术还差什么（先做这个）

1. **加细节**（用户刚强调的）。底稿的问题：猫是一块纯黑剪影加一圈边；谱台只有框、纸、线三种颜色；地面只有三道线；舞台口是一道细线拱加一团光；整幅画东西偏小（猫 88px 高）。往上加的方向（自己取舍）：猫画大一档（56–64 格高），身上分三四档明暗（背光面、受光面的毛边、胸口和爪子的分界、耳朵内侧、胡须、瞳孔高光），尾巴有形；谱台的金属杆有高光和节，谱面上有真的音符和小节线（不同谱台不一样），灯罩有形状、灯下谱纸上有一圈亮；地板有木纹拼缝和灯落在地上的光斑；舞台口加幕布褶子、台唇、脚灯；椅子 / 空座位；节拍器 M 的刻度。每种材质 5–6 档色阶现在大多只用了 2–3 档。画完每一处都用 `CROP` 放大看，孤立像素、锯齿错位、脏色当场改。
2. 浅色主题的墨线版跟着加（不是反相）。
3. 对话页那一条（`chat`）还没出过图：`node …/render-backdrop.cjs out.png dark chat 2`。
4. 切换过场（`laolao-metre-transition.js`）、启动闪屏（`laolao-splash.js` 里 Metre 那一支 + `laolao-metre-brand.css`）、总控台空状态小图：还是旧的 8px 点阵 / 休止符，按同样的 2px 密度、同一套题材（谱台、指挥台、猫、M）重画。
5. 排版留白（原文件「排版和留白」一节）一条都还没做。

## 收尾要求（不变）

隔离副本里逐页看、逐个按钮点；`ref/v11-*.png` 存整页截图（深 / 浅 × 首页 / 对话 / 总控台 / 各弹层，1440×900 和 1100×700），用 SendUserFile 发给用户；改单测断言并跑全；`PROGRESS.md` 加一节；每次提交立刻推送 `fix/metre-native-menu-hit`；不装正式 App、不碰 `~/.openclaw` 和 18789、不动 main / tag。

---

# 接力 3（11-15 深夜，Fable，额度用完被迫停）

**只做完了顺序里的第 1 步（背景加细节），已提交推送。第 2–6 步一条都没动。**

- `laolao-metre-backdrop.js` 调色板到 `paintMoving` 整段重写（`?v=metrebackdrop4`）：
  - 猫不再是字符画，改成 `buildCat()` 一层一层摆（躯干 / 后腿 / 后爪 / 两前腿 / 尾 / 头耳），56×62 格；左轮廓暖亮边 + 往里抖动渐暗，顶和右冷边，层间形体线；斜的蓝眼（瞳孔、高光、蓝光晕）、口鼻、胡须、耳内、胸毛、趾缝。改姿势就改 `fill(...)` 那几行的椭圆 / 三角。
  - 谱台改成 `drawStand(cx, baseY, depth, state, seed)` 程序画，大小在 `STAND_SIZES`：夹灯、框的明暗、两页谱纸 + 折缝、谱线 / 音符 / 小节线（按 seed 每个不同）、托沿、立杆高光、箍、三脚、地上光斑。
  - 舞台口：三层框、束腰侧幕（褶子）、檐幕（垂弧 + 穗）、四档台内光 + 顶光束、台唇、脚灯、M 带亮边和影子。地板：朝舞台口收拢的木条缝 + 接头 + 两道台阶沿。指挥台：台面受光、正面嵌板、猫影。指挥谱台（背面，带筋和铆钉）在 `paintMoving` 里。
  - 三排间距：远 60 / 中 60（错半格）/ 近 120；远排不进舞台口；指挥台左右各让 50 格。
- 出图看过：深 / 浅首页、深色对话页。草稿 `ref/v11-draft2-band-{dark,light}.png`。
- **已知没收拾的**：对话页（`chat`）左边小舞台口会被一个中排谱台挡住一角（`rowOf` 里给对话页加一条「不挡舞台口」即可）；浅色对话页没出图看；`SPRITES` 现在只剩 `LOGO` 和 `CAT`（剪影字符行），`STAND_*` 没了。
- **没验证**：没装进隔离副本、没在真页面里看、单测没重跑（`metre-skin-cat` 那两条旧断言仍然不过）。
- 接下来照任务原顺序从第 2 步开始：过场、闪屏、总控台空状态 → 按键 BUG 1–5 和弹层 → 排版 → 隔离副本复测和单测 → 整页截图发用户、`PROGRESS.md`。

---

# 接力 4（11-16，Fable）：按键、弹层、点击动画做完

用户 11-16：「黑猫不用画了，对话框已经有了，再画就重复」「这个画面很不错，再加鼠标点击背景有“特别”的像素动画」「重点放在 UI 设计上，简单测试就行」。

- **背景**（`metrebackdrop5`）：猫整段删掉（`buildCat` / `CAT`），指挥台收窄、谱台居中；首页舞台口矮一档（离输入框那排远一点）；对话页中排谱台不再挡舞台口。
- **点击动画**：在 `main.content` 的空白处点一下 → 临时小画布（2px 格，0.9 秒后拿掉）：三圈菱形波 + 四颗小星 + 五颗音符往上飘；点在画带里，最近的谱台灯亮一拍（`buildScene` 的 `flash`，状态 `tap`）。按钮、输入框、正文、侧栏、总控台、弹层上不触发；减少动态效果时不出现。验收：`__pinkieMetreBackdrop.tap(x, y)`。
- **按键**（皮肤末尾「第十二稿」，前缀多一个 `:not(#_m3)`）：
  - 1 折叠侧栏：`.sidebar-brand` 是弹性子项、z-index 1 自成一层被 `.sidebar-shell__body` 盖住 → 抬到 5，页脚抬到 6（连接状态圆点）。
  - 2 总控台停靠：`header.topbar` 右内边距让出 `--metre-board-w`；`aside.chat-workspace-rail--collapsed`（工作台 / 浏览器两个键，fixed）跟着左移。
  - 3 是探针误报（关着的 `<details>` 内容仍有尺寸）；探针已改用 `checkVisibility`。
  - 窄窗口（851–1100）：外壳把侧栏收成抽屉，旧规则留下 280 空列 → 改 `0 1fr`；工作台键再让 44px。
- **弹层位置**：`laolao-metre-skin.js`（`metreskin3`）的 `placePops()` 量位置写 `--mp-top / --mp-left / --mp-max`，皮肤 `[data-metre-pop]` 接管。思考档位、模型 / 强度、上下文、工具箱都不压输入框（首页、对话页都测过）。
- **弹层样子**：思考档位卡（去掉碧琪图，Ⅰ–Ⅳ 当图标，单列）、模型、工具箱、搜索、通用菜单、更多工具、上下文、报错条、待发送队列、悬浮提示统一实底细边圆角 10；`.pk-a / .pk-f` 跟字色；危险项砖红；选中色 / 焦点环钴蓝。
- **首页**：看板三块、`#laolao-project-scope` 小字隐藏；「换一句」悬停才出现；提示语 `text-wrap: balance`。
- **闪屏 / 过场**：只去掉了整屏的熄灭点阵（`metrebrand4`、`metretransition2`），动画本身没重画。
- 探针 `MP.bad()` 在深 / 浅首页、对话页、总控台、1100×700 全部为空；Metre 相关单测 55 条全过。全量 1374 条里有 4 条学习台 / 笔记本的不过，和这次改动的文件无关，没查。
- **没做 / 没验**：隔离副本发不出消息（「工作台现场尚未同步」，和模型无关），所以真对话页的状态条、工具卡、「思考了」、消息操作键没看；过场和闪屏没按谱台题材重画；总控台空状态小图没动；设置页、作品页没点；没装进正式 App。
- 截图：`ref/v12-{dark,light}-{home,think,tap,board}.png`、`ref/v12-1100-dark-home.png`。无头截图脚本在会话草稿区，没进仓库（做法：playwright 打开 64560，先带 token 进一次，清 sessionStorage 再进才是首页）。
