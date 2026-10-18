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

## 七、Commit

见本分支最后一次提交（`repair(layout): …`）。报告文件本身随该提交入库。
