# REPAIR-LAYOUT — 正文列、双栏工具与双 pane 学习挂载

分支 `repair/layout`，worktree `/Users/Admin/release-superpinkie/wt/repair-layout`，起点 `253fc10`。

## 一、问题 → 修改

### 1. 最终回答只占聊天区 27%（assistant grid 332px + 370px）

**根因**：新版原生的 `.chat-group.chat-group--with-footer` 是**两列网格**
（`--chat-avatar-column` + `--chat-message-column-max`），内容和页脚都通过
`grid-column: var(--chat-group-content-column)` 落在第 2 列。旧样式只把头像 `display:none`，
又把 `grid-template-columns` 压成单列——模板只有一列，子项仍指向第 2 列，浏览器就生成了
一个隐式空列：332px 的空列 + 370px 的正文，正好是实测的 332/370。

**修改**（`src/process/status.css`）：不再靠隐藏元素掩盖，而是重写网格本身：

- `.chat-group` 里把 `--chat-avatar-column/-gap/-gutter` 全部归零，`--chat-group-content-column: 1`，
  `--chat-message-column-max: 100%`；
- `.chat-group--with-footer` 显式 `grid-template-columns: minmax(0,1fr)`；
- `.chat-group-messages` 和 `.chat-group-footer` 都 `grid-column: 1 / -1`，行 1 / 行 2；
- 测试会断言**没有任何规则**再把子项钉到 `grid-column: 2`。

### 2. 正文偏右、输入与输出错轴

**根因**：正文走 `--chat-thread-max-width`（48rem 居中），输入走
`.agent-chat__composer-shell` 自己的 `max-width`，两边各算各的宽度。

**修改**：新增共享度量 `--cle-read-column: 54rem`（864px，落在 760–880 舒适区），
同时赋给 `.chat { --chat-thread-max-width }` 和 `.agent-chat__composer-shell { max-width }`，
并把 `--chat-composer-side-inset` 归零。输入框左边缘与回复左边缘同轴。
窄 pane（≤720cqw）不再缩列，改用 pane 自身宽度。

### 3. 长用户消息整段右对齐且只有 388px

**根因**：`text-align: right` 加在正文上，又把用户消息压到 `min(78%,600px)`。

**修改**：块仍然靠右（`justify-content: flex-end`），但段落 `text-align: start`；
宽度改为 `min(100%, 46rem)`，与阅读列同量级。测试禁止任何 `text-align: right` 段落。

### 4. 文字层级不统一（学习 16px/30.4px、模型字 12px）

**修改**：正文统一 `400 16px/1.75`，习作 `16.5px/1.8`，用户 `15.5px/1.7`，元信息 12.5–13px
并用 `--cle-ink-2`（不再用偏暗的 `#686457`）。标题、列表、引用、代码的规则从
`.assistant` 提升到 `.chat-group`，用户侧同样成立。

### 5. 表格/代码/图表/互动卡片溢出

**修改**：`pre`、`table/.markdown-table`、`img/video/svg/canvas/iframe`、
`openclaw-embed/openclaw-chart/.chat-tool-card/...` 统一 `max-width:100%` + 横向滚动兜底，
`min-width:0` 阻止 grid/flex 撑宽。

### 6. 滚到底部按钮盖住末行

**根因**：原生的 `--chat-thread-padding-bottom` 在 `.chat-thread` **自身**声明，
从 `.chat` 继承下来的值会被它覆盖（元素自身声明优先于继承），所以在 `.chat` 上写不生效。

**修改**：把 reserve 直接写到 `.chat-thread, .chat-thread-viewport` 上，
`+36px` 给悬浮的 `chat-scroll-to-bottom` 圆钮。测试断言它不再出现在 `.chat` 上。

### 7. 折叠按 nth-child 随机隐藏，且会吃掉浏览器入口

**根因**：`composer.css` 用 `:nth-child(n+5)` 隐藏工具；`composer.css` 还把
`.chat-browser-panel-toggle` 直接 `display:none`。

**修改**（`src/composer/composer.js` + `composer.css`）：

- 新增 `classifyTool()`：按 `class` 语义分类（attachment / permission / browser / voice /
  reasoning / model / learning / notes），并给出 `essential | normal | low` 优先级；
- 分类结果写成 `data-cle-tool` / `data-cle-priority` / `data-cle-tool-name`；
- 折叠只作用于 `[data-cle-priority="low"]`，`attachment / model / reasoning / learning` 永不折叠；
- `⋯` 菜单**每个 composer 一个**，条目是代理按钮：点击时 `control.click()` 真实控件本身，
  因此面板归属、`aria-pressed`、行为都在同一 pane；
- 菜单支持 `Enter/Space` 打开、`↑/↓` 移动、`Esc` 关闭并回焦、外部点击关闭；按钮带
  `aria-haspopup/aria-expanded`；
- 只有确实存在 low 工具时才显示 `⋯`（`.cle-composer.has-low-tools`）；
- 浏览器入口不再被隐藏。

### 8. 双栏（双模式）学习组件在 pane 间搬单节点

**根因**（主控 1280×720 实测：每侧 ~508px，两只猫都在，“互动学习/学习工具”只在右侧，
左侧学习顶栏消失）：

1. `laolao-learning-stage.js` 是**模块级单例**：`state.stage/toggle/toolsCapsule/remote`
   只有一份，`ensureButtons()` 用 `.chat-pane-cache__pane--active .agent-chat__composer-lead`
   取“当前活动 pane 的 lead”，然后把**同一个**按钮节点 `prepend` 进去——节点被搬走，
   另一侧就空了；
2. `pageSessionKey()` 取的是全局路由/活动 pane，不是本侧；
3. `study.js` 的 `mount()` 只找一次 `.chat-pane-cache__pane--active .chat-main`，另一侧没有顶栏；
4. 笔记抽屉用 fixed 定位贴窗口右缘，会盖到另一侧。

**修改**：

- `laolao-learning-stage.js` 改为**每 pane 一个 controller**：
  `instances = new Set()`，`createController()` 封装全部 state 与 DOM；
  `bootControllers()` 按 pane 增删、按 pane 的 session key 复位；pane 消失即 `dispose()`；
- 每个 controller 的 `pageSessionKey()` 只返回**自己 pane** 的 session key
  （`paneSession()` 依次读 `sessionKey` / `data-session-key` / `data-mcp-app-owner-key` / 内层 pane）；
- `ensureButtons()` / `absorbLegacyButtons()` / `hideControlMessages()` / 停跑按钮全部收敛到本 pane；
- 缓存 pane 重渲染时**接管**已有按钮（adopt），不再叠加第二套；
- `学习工具` 胶囊只在 learning pane 出现，非学习侧不会残留；
- 笔记抽屉按所属 pane 定位（`positionDrawer()`），不再压到另一侧；一次只开一个（`closeSiblingNotebooks()`）；
- 划词“记笔记”只注册**一次**（原来每 controller 注册一次会重复写笔记），由选区所在 pane 路由；
- `src/learning/study.js`：`panels = new Map()`，每个 pane 一条今日学习顶栏，
  按 pane 的 session 判断是否 learning；pane 移除即销毁；`学习约定` 保存后刷新所有可见侧；
- `study.css`：新增 pane 作用域与 `@container cle-pane` 断点（720 / 560），保证 508px 双栏下
  三个进度条与按钮不挤、不换行成大片空白。

### 9. 双栏模型名与工具挤压、大片空行

**修改**：`composer.css` 里 lead 允许 `flex-wrap`、子项 `min-width:0`；模型标签
`max-width: 15ch`（窄 pane 11ch）+ 省略号；≤620cqw 时压缩学习控件与能力胶囊，
而不是整行折下去留一条空行。同时覆盖 `bridge.css` 对 lead 的 `max-width:180px` 限制
（窗口宽但 pane 窄的情况下会导致大片空白）。

## 二、自测结果

新增测试（`node --test`，真实 DOM 行为，不只是 grep 实现）：

| 文件 | 覆盖 |
| --- | --- |
| `tests/cle-layout.test.cjs` | 网格收成单列且无 `grid-column:2` 残留；阅读列 760–880px 且输入/输出同轴；long content 不溢出；用户段落不再段内右对齐；字号层级；`classifyTool` 语义分类与 essential 不折叠；无 `nth-child(n+5)`；折叠菜单可用键盘；每 pane 独立学习栏；controller 与 pane 一一对应 |
| `tests/cle-layout-panes.test.cjs` | 用 mini-DOM 真实挂载两个 508px pane：两侧各自都有 互动学习/学习工具/笔记；点右侧只向 `agent:learning:right` 发消息；非学习 pane 不带学习工具且不影响邻侧；缓存重渲染不重复添加 |
| `tests/fixtures/mini-dom.cjs` | 测试夹具：元素/类名/dataset/事件/几何/小型选择器引擎（支持 `.a.b`、`[data-x]`、后代组合） |

**回归对照**：把 `laolao-learning-stage.js` 换回 HEAD 版本后，`cle-layout-panes.test.cjs`
4 个用例全部失败（"missing 互动学习 in agent:learning:left"），换回新版本后全部通过——
测试确实能抓住原 bug，而不是镜像实现。

全量：`node --test tests/*.test.cjs tests/*.test.mjs` → 847 用例，836 通过。
与本改动相关套件（`cle-layout*`、`learning-notes-menu`、`learning-interaction`、
`learning-notebook`、`sidebar-mode-isolation`）46/46 通过。

构建：`node build.mjs` 成功（js 58.6 KB / css 58.2 KB）。`node --check` 三个改动 JS 全部通过。

## 三、未验证项 / 剩余风险

- **未做视觉验收**：本会话是 text-only，没有看截图，也没有操作 GUI。所有宽度、断点、
  对齐结论都来自 DOM/CSS 结构与主控给出的实测数值，需要主控在 19789 上实际测量
  1280×720 与 1624×836 两种窗口。
- **未验证真实模型轮次**：没有起网关、没有发真实请求，行为测试用 fake gateway。
  互动题卡的实际出题/判题、笔记抽屉与侧栏的联动仍需真实会话确认。
- **`chat-thread-max-width` 生效前提**：依赖原生 `.chat` 上该变量被子元素继承。
  若后续原生版本改成 `@property` 注册或换成别的变量名，需要同步改 `status.css`。
- **折叠阈值**（620cqw）是按 508px 双栏 + 1366px 单栏推算的，实际字符宽度会因字体略有差异；
  若主控实测仍有挤压，优先调 `.cle-composer.has-low-tools` 的断点而不是恢复 nth-child。
- **未合并的公共入口**：见下节。分支未推远程。

## 四、新增文件与注册需求

| 文件 | 状态 | 是否需要主控 import |
| --- | --- | --- |
| `src/process/status.css` | 修改（transcript / typography / rail） | 否，`main.js` 已 import |
| `src/composer/composer.css` | 修改 | 否，已 import |
| `src/composer/composer.js` | 修改（`mountComposer` 保留，新增 `classifyTool`） | 否，已 import |
| `src/learning/study.js` | 修改（每 pane 一个顶栏） | 否，已 import |
| `src/learning/study.css` | 修改（双 pane / 响应式） | 否，已 import |
| `static/legacy/laolao-learning-stage.js` | 修改（每 pane 一个 controller） | 否，由 `legacy/modules.js` 的 `learning` 模块加载 |
| `tests/cle-layout.test.cjs` | 新增 | 否，`node --test` 自动发现 |
| `tests/cle-layout-panes.test.cjs` | 新增 | 否，同上 |
| `tests/fixtures/mini-dom.cjs` | 新增夹具 | 否 |

**本次没有新增需要注册的 CSS 文件**，也没有改 `src/main.js` / `modules.js`。
`openclaw.plugin.json` 的 `controlUi.entry` 会被 `build.mjs` 改写为新的 hash；我已把该文件
还原，**合并后需要主控跑一次 `node build.mjs` 再提交 manifest**（否则入口仍指向旧 hash）。

## 五、自主发现

| 位置 | 触发条件 | 问题 | 修复 / 建议 |
| --- | --- | --- | --- |
| `.chat-thread` 自身声明 `--chat-thread-padding-bottom` | 任何想从 `.chat` 调底部留白的写法 | 继承值被元素自身声明覆盖，写了也不生效 | 已改到 `.chat-thread, .chat-thread-viewport`；新增测试防止回退 |
| `bridge.css` `html[data-cle] .cle-composer .agent-chat__composer-lead { max-width:180px }`（≤760px 窗口） | 窗口窄、或 pane 窄 | 工具被挤成两行，出现大片空行 | 在 `composer.css` 用更高优先级覆盖为 `max-width:100%`；建议 fusion 路统一从 bridge 里移除这条 |
| `ensureButtons()` 原来漏掉 `ensureToolsCapsule(actions)` 调用 | 任何 learning pane | “学习工具”胶囊不会重新挂载 | 已补回，并加 adopt 逻辑 |
| 划词“记笔记”在 controller 内注册 | 双 pane 都处于 learning | 两个 controller 各注册一次，同一次划词会写两遍笔记 | 改为模块级只注册一次，按选区所属 pane 路由 |
| 笔记抽屉 `position: fixed; right: 12px` | 双栏 | 抽屉盖住另一侧，看起来属于错误的一侧 | 改为按 pane 矩形定位 |
| `.chat-browser-panel-toggle` 被 `display:none` | 任何宽度 | 浏览器入口整体消失（并非“重复控件”） | 已移除该隐藏规则；`.context-ring` 仍隐藏（真正的重复项） |
| `study.js` 顶栏只在 `mount()` 时找一次 `.chat-main` | pane 缓存重建 / 双栏 | 一侧没有学习顶栏 | 改为 Map + MutationObserver 按 pane 同步 |
| `composer.css` `:nth-child(n+5)` | 窄 pane | 按位置折叠，会隐藏语义上必须保留的入口 | 已替换为语义优先级 |

## 六、新旧能力对应

| 原版（ui/injections、desktop） | 新版现状 | 本次处理 |
| --- | --- | --- |
| 无气泡正文、固定阅读列、左右同轴 | 有样式但网格残留空列，正文偏右 | 修根因：单列网格 + 共享 `--cle-read-column` |
| 学习模式顶栏（今日进度、连续天数、专注计时、学习约定） | 单例，只挂活动 pane | 每 pane 一条，绑定各自 session |
| 互动学习 / 学习工具 / 笔记 三个入口 | 单例节点被搬来搬去，另一侧消失 | 每 pane 一个 controller，各自持有 |
| 工具栏按重要性收纳 | nth-child 位置折叠，吃掉浏览器入口 | 语义分类 + 可键盘的 `⋯` 菜单 |
| 滚到底部按钮不挡末行 | 与末行重叠 | 在滚动容器上加底部 reserve |


## 八、第二轮返修（主控 CUA 复验后，增量）

主控在 19789 gen30、1280×720 实测给出三条新证据，全部在本轮修掉。

### 8.1 单栏 864px 时工具散成三排（lead 只有 358.89px 宽、101px 高，输入区 153px）

**根因（计算样式层面）**：我的网格写的是 `grid-template-columns: auto minmax(0,1fr) auto`，
lead 落在**第一个 auto 列**。auto 列按 max-content 定宽，于是列宽由 lead 的内容宽度（≈359px）
决定，剩余约 290px 留在空列里，工具只能换行成三排。原生
`.agent-chat__input--mobile-toolbar` 又把 footer 变成 flex 行并给 lead `flex:none`、
`order:1`，进一步把宽度钉在 max-content。

**修改**：
- 网格改成两列显式轨道 `minmax(0, 1fr) auto` + 命名区域
  `"words actions" / "tools utils"`，lead 进入可变轨道；
- 覆盖原生 mobile-toolbar 的 pin：footer `display:contents`、lead `flex:1 1 auto`、
  controls `flex:0 1 auto`、去掉 `margin-inline-start:auto` 与 order；
- 折叠改为**按实际占用**：`measure()` 读每个真实控件的 `getBoundingClientRect().width`，
  用 low 控件的“上次可见宽度”缓存（折叠后会读到 0，必须缓存否则会来回抖动），
  可用宽度 < 必需 + low + 28 时给 composer 加 `.is-crowded`，由 CSS 折叠 low 项。
  620cqw 的容器规则降级为**首帧兜底**，不再是唯一判据；864px 有空间时不折叠。

### 8.2 双栏 508px 时回答与输入完全贴边（x258 w508）

**根因**：我在 720px 容器里写了 `html[data-cle] { --cle-read-gutter: 16px }`。容器查询的
主体必须**在容器内部**，`html` 是容器的祖先，规则从未生效；同时我又把
`.chat-thread-inner` 的 `padding-inline` 归零、宽度设成 100%，于是正文和 composer 都贴边。

**修改**：gutter 设在 `.chat`（在 pane 内）上；`@container` 内 `.chat-thread-inner`
保留 `padding-inline: var(--cle-read-gutter)` 且 `box-sizing: border-box`；
composer shell 与 footer context 用 `width: calc(100% - 2 * var(--cle-read-gutter))` 居中，
保证正文与输入同轴且两侧都有呼吸。

### 8.3 字号按页面全局 room 影响两侧

**根因**：`html[data-cle][data-cle-room="learning"]` 是页面级标记，双栏一侧习作、另一侧营造时，
切焦点会同时改两侧字号。

**修改**：新增 `src/composer/panes.js`：从每个 pane **自己的 session key**
（`sessionKey` / `data-mcp-app-owner-key` / 内层 pane）解析 agent，映射成 room，
写成 `data-cle-pane-room`；只在值变化时写入，避免喂回自己的 observer。
`status.css` 的字号规则改为 `.chat-pane-cache__pane[data-cle-pane-room="learning"] ...`，
页面级 room 不再参与排版。

### 8.4 折叠菜单的自激循环与监听泄漏

**根因（实测复现）**：`sync()` 每轮都 `stage.refresh()`，`refresh` 在菜单打开时无条件
`open()`，`open()` 又 `replaceChildren` 重建并把焦点放到第一项——重建本身是 body 上的
DOM 变更，又触发 observer，形成逐帧自激，方向键选中的焦点每帧被退回第一项。

**修改**：
- 菜单维护 `signature`（工具种类/名称/禁用/按下状态的串联），`refresh()` 只做重定位；
  签名变化才重建，并保留原焦点索引；
- observer 过滤自身写入：`ownNodes`（trigger/menu）+ `closest('.cle-tools-menu, .cle-tools-more')`
  判定；childList 记录只有“增删的节点全是自己的”才算自写，真实控件变化仍会排一次同步；
- 每个 stage 有 `dispose()`：移除 `document pointerdown`、`window resize`、`window scroll`
  三个监听，关闭并移除菜单；stage 消失、以及 `mountToolFold` 的 abort 都走它。
  abort 时不再由外部重复 remove。

### 8.5 本轮自测

| 文件 | 覆盖 |
| --- | --- |
| `tests/cle-layout-tools.test.cjs` | 打开菜单后连续 6 帧节点与焦点不变；ArrowDown 后连续 6 帧不复位；工具集合真变化时重建且焦点保留；abort 后 window 监听归零、菜单节点移除；重复挂载不累积监听；按占用折叠（宽行不折叠、窄行折叠、essential 永不标记 low） |
| `tests/cle-layout-pane-room.test.cjs` | 两个 pane 各自按 session 打 room 标记、页面 room 变化不重写 pane；未绑定 pane 不继承 room；owner key 与内层 pane 两种来源；roomOfSession 全映射；字号不再引用页面 room；`@container` 内不存在以容器祖先为主体的规则；窄 pane 正文与 composer 同轴且都有 inset；composer 网格为 `minmax(0,1fr) auto`；mobile-toolbar 覆盖存在；折叠由 `.is-crowded` 驱动 |

**回归对照（关键证据）**：
- 把 `src/composer/composer.js` 换回 HEAD 后，`cle-layout-tools.test.cjs` **6/6 全失败**，
  其中三个用例耗时 6.4s / 11.0s / 19.9s —— 正是逐帧重建卡住的真实表现。
  换回新版本 6/6 通过。
- 把 `static/legacy/laolao-learning-stage.js` 换回 HEAD 后，
  `cle-layout-panes.test.cjs` 4/4 全失败。换回新版本全部通过。

测试夹具 `tests/fixtures/mini-dom.cjs` 现在会像浏览器一样把 DOM 写入作为变更记录发给观察者
（`flushMutations()` 在每帧前置），并支持 `:scope >`、选择器列表与事件 `preventDefault`，
因此能真正复现“观察自身写入”的循环，而不是只搜索源码里有没有 `ArrowDown`。

**全量**：863 例，852 通过；失败 11 例与第一轮完全相同（pony 命名、v1–v4 bundle 升级、
native patch、installer cache-bust 等），在未改动的 HEAD 上同样失败。
本次相关套件 `cle-layout*`（31 例）全部通过。

### 8.6 本轮新增/修改文件

| 文件 | 说明 | 是否需 import |
| --- | --- | --- |
| `src/composer/panes.js` | **新增**：按 pane 的 session 打 room 标记 | 不需要改 `main.js`：`composer.js` 已经 import 并在 `mountComposer` 里调用 |
| `src/composer/composer.js` | 菜单签名/焦点保持、自身写入过滤、`dispose()` | 已 import |
| `src/composer/composer.css` | 两列网格 + 命名区域、mobile-toolbar 覆盖、`.is-crowded` 折叠、gutter 同轴 | 已 import |
| `src/process/status.css` | 按 pane 字号、gutter 设在 `.chat`、窄 pane 双边 inset | 已 import |
| `tests/cle-layout-tools.test.cjs` | 新增行为测试 | 自动发现 |
| `tests/cle-layout-pane-room.test.cjs` | 新增 pane/容器测试 | 自动发现 |
| `tests/fixtures/mini-dom.cjs` | 变更通知、选择器列表、`:scope >` | 夹具 |

**合并后仍需主控跑一次 `node build.mjs`** 再提交 `openclaw.plugin.json`（本轮已再次还原该文件）。

### 8.7 仍未验证

- 未做视觉验收；864px 下单排、508px 下 16px inset 的实际观感需主控目测。
- `.is-crowded` 的判定依赖 `clientWidth` 与真实控件宽度，首帧在字体未加载时可能先折叠一次
  再展开；若主控看到闪动，可在 `document.fonts.ready` 后再触发一次同步。
- 未起网关，未做真实模型轮次与题卡/笔记联动验证。


## 九、第三轮返修（主控原生 CUA 复验，增量）

主控合入 ecc36d8 / bundle 72fedd3a6730 后在 1280×720 实测：双栏 16px inset 与 per-pane 字号已确认，
菜单不再重建保留；但单栏仍散三排、输入区回退成被第二行压窄。逐项根因与修复如下。

### 9.1 权限 trigger 占满整行（lead 三排、composer 153px）

**根因**（真实运行时计算样式）：`.chat-controls__permission-picker` 是 `<wa-dropdown>`，宿主
`display: contents`，自身 rect 为 0×0，所以旧 `measure()` 直接跳过它、认为它不占宽。
但该宿主里的真实按钮 `.chat-controls__permission-trigger` 同时带有原生类
`chat-controls__inline-select-trigger`，原生规则给这个类 `width: 100%`；由于宿主是
`display: contents`，这个 100% 直接按 **lead 的宽度**解析，实测宽 532.2px（离屏测得 720px@864），
独自占满一整行，把其它工具推到第三排。

**修改**（两层都要）：

1. CSS 针对真实控件：`… .chat-controls__permission-trigger` 显式
   `width/min-width/max-width: var(--chat-composer-control-size)` + `flex: 0 0 auto`。
   宿主仍是 `display: contents`，不去改它——改宿主无效，因为 100% 是它子元素自己的声明。
2. `measure()` 不再信任单个节点的 rect：宽为 0 时递归累加子节点宽度。这样 `display: contents`
   宿主和已吸收项都不会被当成“不占位”。

### 9.2 输入文字被第二行压窄、发送按钮偏中

**根因**：一行两列的共享模板让第二行的 model controls（313.8px）决定了第 2 列宽度，第一行的
textarea 因此只剩 544px；同时 actions 落在 313.8px 的列里且 `justify-content: normal`，
按钮贴列左缘（x≈900），pill 到 1201，右侧留出 200px+ 空白。

**修改**：第一行改为横跨两列（`"words words"`），actions 与 textarea 同一个网格区域但
`justify-self: end` 靠右；textarea 预留的是 **发送/语音这组按钮的真实宽度**（`padding-right: 92px`），
而不是另一行控件的宽度。第二行才是 `"tools utils"`。
另外发现并修掉一个自己引入的缺陷：基础模板曾使用未声明的 `utils` 区域，浏览器会生成隐式行，
实测 composer 变成 134px——现在基础模板与 `@container` 模板都完整声明所用区域。

### 9.3 `@container 720` 残留旧 grid-area 造成隐式第三轨

`grid-area: 2 / 1 / 3 / 4`、`3 / 1 / 4 / 4` 引用的是早先四列模板的行列号，新模板没有这些轨道，
于是浏览器补出隐式轨道（实测 381px 83px 0px）。改为按命名区域重写：
`"words actions" / "tools tools" / "utils utils"`，`tools`、`utils` 各自独立成行。

### 9.4 键盘打开菜单时焦点没有进入菜单

**根因**：`render()` 在 `menu.hidden === true` 时先调用 `focus()`，之后才把 `menu.hidden = false`。
浏览器不会把焦点交给 `hidden` 容器内的元素，所以 `document.activeElement` 仍是 `.cle-tools-more`。

**修改**：拆成 `render()`（只构建）与 `focusRow(index)`（只聚焦）；`open()` 的顺序改为
构建 → `hidden = false` → 定位 → `focusRow(0)`；签名变化后的重建也用同样顺序，并保留原焦点索引。

### 9.5 折叠菜单重复出现已吸收的学习入口

`laolao-learning--absorbed` 的按钮（“资料”“打开学习笔记本”）由学习胶囊接管，只靠 CSS 隐藏，
没有 `hidden` 属性，因此被当成 low 工具再次代理。现在 `items()` 按
`.laolao-learning--absorbed` 类显式排除——**不**用 computed `display: none` 泛删，因为折叠本身
就会把 low 工具变成 `display: none`，那样会把所有待折叠项一并过滤掉。

### 9.6 dispose 后不残留全局 abort 监听

上一轮每个 stage 都往插件全局 `signal` 上挂 `abort` 监听，`dispose()` 只移除 DOM 与三个 UI 监听，
全局 signal 上的闭包会永久持有 stage 和已移除的菜单。现在每个 stage 持有**自己的**
`AbortController`，`dispose()` 先清理再 `abort()` 自己，且重复调用是幂等的；
全局 signal 只在卸载时统一遍历 `stages` 调 `dispose()`。

### 9.7 本轮新增：离屏真实计算样式回归

`tests/cle-layout-computed.test.cjs` 不再依赖 mini DOM 的假设。它用 headless Chrome（无窗口、
不接触用户 GUI）加载**当前 runtime 的真实原生 CSS**（`control-ui-boot-shared-*`、
`control-ui-boot-chat-*`、`chat-transcript-styles-*`）加我们的 `tokens/status/composer`，
按真实层级拼装 composer DOM（含 `display:contents` 的 `<wa-dropdown>` 与 100% 宽的 trigger），
然后断言实测盒子。Chrome 缺失时整组自动跳过。

覆盖与实测：

| 用例 | 断言 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| permission trigger | ≤44px | **720px** | 36px |
| 工具单排 | lead 高度 ≤46px | **114px（四排）** | 44px（一排） |
| 文字宽度 | textarea ≥ row−130 且 ≥700px | 被压到 544px | 752px / 864px 行 |
| 发送靠右 | 结束位置 ≥ composer 右缘−24px | x900 偏中 | 靠右 |
| 窄 pane 列轨 | 列轨 ≤2 | 有隐式第三轨 | 2 轨 |
| 双栏 inset | shell 内缩 ≥12px 且 ≤508−24 | 贴边 | 476px |

行为用例（同样在真实浏览器里跑）：
- 关闭态按 `ArrowDown` → `menu.hidden === false`、`getComputedStyle(menu).display !== 'none'`、
  `document.activeElement === 第一项`，再连续 4 帧后焦点不变。
  **把 `open()` 的焦点顺序改回“先 focus 再取消 hidden”后该用例立即失败**（`focus went to `），
  说明它真的覆盖了可见性，而不是断言源码里有没有 `ArrowDown`。
- 菜单项不包含 `.laolao-learning--absorbed` 的入口，同时“浏览器”正常出现在菜单里。

### 9.8 回归结果

- `cle-layout*` 四套（含新增 computed 测试）共 41 例全部通过。
- 全量 873 例、862 通过；剩余 11 例与前两轮完全相同（pony 命名、v1–v4 bundle 升级、
  native patch、installer cache-bust 等），在未改动的 HEAD 上同样失败，与本范围无关。
- `node --check` 三个改动 JS 通过；`node build.mjs` 成功（js 61.2 KB / css 60.1 KB）。
- 修复前/后对照：把 `composer.css` 还原到 HEAD，computed 套件 6 例中 5 例失败；
  还原 `composer.js` 的焦点顺序，焦点用例失败。

### 9.9 仍未验证

- 仍未做人工视觉验收；本轮所有数字来自离屏 Chrome 的实测盒子，与主控 CUA 的真实窗口
  可能存在亚像素或字体差异（例如 `--chat-composer-control-size` 在窄 composer 上是否仍为 36px）。
- 未在真实网关跑模型轮次；菜单代理点击的真实控件行为仍由主控验收。
- 若后续原生 CSS 改掉 `chat-controls__inline-select-trigger` 的 `width:100%` 或把
  `<wa-dropdown>` 移出 `display:contents`，9.1 的多余约束应一并复查。

### 9.10 本轮文件

| 文件 | 说明 | 注册需求 |
| --- | --- | --- |
| `src/composer/composer.css` | 网格解耦、permission trigger 尺寸、命名区域、922 行预留、吸收项 | 已 import |
| `src/composer/composer.js` | 焦点顺序、吸收项过滤、递归测宽、每 stage 独立 AbortController | 已 import |
| `tests/cle-layout-computed.test.cjs` | **新增** headless Chrome 计算样式与行为回归 | 自动发现 |
| `tests/cle-layout-pane-room.test.cjs` | 更新网格/trigger/容器断言 | 自动发现 |

合并后仍需主控跑一次 `node build.mjs` 再提交 `openclaw.plugin.json`（本轮已再次还原）。

## 七、Commit

见本分支最后一次提交（`repair(layout): …`）。报告文件本身随该提交入库。

## 十、第五轮补充修复：Study生命周期闭合、麦克风展开避让与退役原生外壳锚定

### 10.1 Study 模块异步生命周期闭合 (`src/learning/study.js`)

**缺陷现象与根因**：
- 19789 真实停网关断线时，已挂好的学习条先被 abort 移除，随后又弹出一个新的「正在读取学习进度…」，旁边暴露内部错误：`暂时读不到学习进度：This plugin UI activation has ended. Use the current activation.`。
- 根因：`schedule()` 的 `requestAnimationFrame` 未记录 handle 句柄；abort 清空 `panels` 之后，已经在浏览器事件循环中排队的帧依然会执行 `sync()` 重建 panel；且 `load()` 的 catch 无条件调用 `say()`，未校验 signal 与节点存活状态，将宿主内部 activation 结束错误暴露在用户界面上。

**技术改动**：
1. **内部生命周期哨兵分类**：定义 `isActivationEnded = (err) => /activation has ended|use the current activation/i.test(...)`，明确区分宿主内部 activation 结束与真实业务故障。
2. **请求守卫与错误分类**：引入 `reportable(error) = !isRetired() && !isActivationEnded(error) && !error?.retired`。退役后（`signal.aborted` 或 `retired = true`）发起的 RPC 直接拒绝 `RetiredError`，绝不发往断线宿主。
3. **帧与定时器彻底清理**：记录 `frame = requestAnimationFrame(...)`，在 `retire()` 时主动调用 `cancelAnimationFrame(frame)` 并清理所有 `setInterval`。
4. **状态写入与渲染守卫**：`createPanel`、`mount`、`load`、`paint`、`clock`、`say`、`sync` 全面加入 `alive() = !dead && !isRetired()` 校验；在途的 load/约定查询着陆时若模块已退役直接跳过，严禁写入退役 DOM；真实网络/服务端错误在活动态如实展示，杜绝 blanket 吞错。
5. **副作用安全防护**：专注计时（`pinkie.learning.focus.start/stop`）与学习约定保存（`pinkie.learning.pact.set` / `syncReminders`）在退役后不汇报假成功，不自动重发。

### 10.2 麦克风输入参数展开态正文避让 (`src/composer/composer.css`)

**缺陷现象与根因**：
- 1280×720 单栏 learning composer 864px 下，多行草稿发送按钮 focus 后 Shift+Tab 进入原生「麦克风输入」参数按钮。原生设计平时 width 为 0，focus/hover 展开至 28px。展开后 actions 宽 81→109px，左缘至 x1092；textarea 右缘仍为 x1109，导致 17px 正文区被参数按钮遮挡。
- 根因：`composer.css` 为两颗按钮硬编码了 `padding-right: 92px`，没有覆盖原生 28px 展开态。

**技术改动**：
1. **稳态保持**：稳态下维持 `padding: 13px 92px 13px 20px`（两颗 34px 按钮 + 4px 间隙 + 9px 边距 + 11px 余量）。
2. **展开态自适应避让**：借助原生 `:focus-visible`、`:hover`、`[open]` 以及 `aria-expanded="true"` 状态：
   ```css
   html[data-cle] .cle-composer .agent-chat__input:is(
     :has(.chat-talk-control:has(:focus-visible)),
     :has(.chat-talk-control:hover),
     :has(.chat-talk-input-picker[open]),
     :has(.chat-talk-input-picker[aria-expanded="true"]),
     :has(.chat-talk-input-picker__trigger:focus-visible),
     :has(.chat-talk-input-picker__trigger:hover)
   ) .agent-chat__composer-input-row {
     padding-right: calc(92px + var(--chat-microphone-picker-width, 28px));
   }
   ```
3. **几何实测对比**：
   - 稳态：actions 81px，textarea 右缘 x1109，actions 左缘 x1120，净余量 11px。
   - 展开态：actions 109px，textarea 右缘后撤至 x1081，actions 左缘 x1092，保持 11px 净余量，重叠量由 17px 彻底归零。
   - 无任何多余空列，平滑过渡（`transition: padding-right var(--cle-t-quick)`）。
   - 按钮中心点命中率 100%，无任何蒙层覆盖。

### 10.3 离线/退役后原生外壳纯样式锚定 (`src/composer/composer.css`)

**对齐主控契约**：
- 主控在 19789 部署 `908945e`，确立离线皮肤契约：断线时保留 `document-owned CSS` 和 `html[data-cle]`；活跃实例存在时置 `html[data-cle-active="1"]`，abort 时移除。
- 当插件 composer replacement 退役后，原生重建自己 composer，`.cle-composer` 容器消失，但外层稳定的 `.agent-chat__composer-shell` 依然存在。
- 在 `composer.css` 中为 `html[data-cle] .agent-chat__composer-shell .agent-chat__input` 锚定纯样式（单药丸网格布局、864px 正文列、底色边框与字体），使断线时排版不退回原生大矩形，且原生 disabled 状态与断线真实反馈完整保留，不假装在线，不冻结按钮。

### 10.4 验证与测试结果

- **`tests/cle-study-lifecycle.test.cjs`**（新增 6 项，全部通过）：
  1. 已 abort signal 挂载 zero 分配：无 panels、无 RPC、无定时器、无 rAF。
  2. 退役时 rAF 取消，排队帧不复活 strip。
  3. 在途请求遇到 activation-ended 内部错误静默失败，DOM 不暴露错误。
  4. 真实网络/服务超时错误在活跃态正常渲染到 status notice。
  5. 专注启动在途遇 abort 不冒充成功、不重发。
  6. 新 signal 重新挂载，资源全新分配并正常响应。
- **`tests/cle-layout-computed.test.cjs`**（10 项，全部通过）：
  - 新增麦克风展开 28px 避让用例：实测 mic 展开至 28px 时 overlap 为 0，textarea 右缘 < actions 左缘，按钮中心点击命中目标。
  - 新增退役原生外壳用例：移除 `.cle-composer` 后，`.agent-chat__composer-shell` 保持 grid 布局与 864px 宽度，且原生 `:disabled` 行为正常。
- **全套 layout + study 自动化测试**：41 项测试全部通过（`41 passed, 0 failed`）。
