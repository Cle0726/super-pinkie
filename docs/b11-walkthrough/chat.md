# B11 全页面走查：日常聊天模式（chat）

脚本：`tools/pr-shots/b11-chat-walkthrough.mjs`（约定同 `tools/pr-shots/minimal.mjs`：`node <脚本> --out <目录>`，写 PNG + `shots.jsonl` + `report.json`）。本机在浏览器锁内用 headless WebKit 跑（`PINKIE_VISUAL_ENGINE=webkit`），隔离 HOME / TMPDIR / OPENCLAW_STATE_DIR，不连网关、不碰用户会话。

拍的页面（1440 / 820 × 日 / 夜）：

| 组 | 怎么进 | 页面 |
| --- | --- | --- |
| `home` | 场景 `home-chat` | 唠嗑模式首页（新会话启动页） |
| `model-menu` | 点输入框下方模型牌（`details.chat-controls__model > summary`） | 模型 / 思考强度合并菜单 |
| `mode-menu` | 点模式切换（`button.laolao-mode-switcher` / `.laolao-mode-dock-trigger`） | 模式菜单 |
| `sidebar-collapsed` | 仅 1440：点侧栏折叠按钮 | 侧栏收起后的首页 |
| `sidebar-open` | 仅 820：点「展开侧栏」 | 窄屏侧栏展开 |
| `settings` | 点侧栏「设置」 | 设置页 |
| `chat` | 首页点「最近会话」第一项，历史由 initScript 覆盖 `__fakeSeedHistory` 种 4 条（含标题、加粗、列表、行内代码、引用、表格、代码块） | 对话页 |

820 宽时模式按钮在收起的侧栏里（在视口外，`isVisible` 为真但点不到），所以 820 先点「展开侧栏」再点模式按钮，拍完如果侧栏被收回就再展开一次，然后进设置。

量法（`report.json`，每页一行）：

- `text`：小字对比度 < 4.5（大字 ≥24px 或粗体 ≥18.66px 时 < 3）
- `ui`：图标（svg）或输入框 / 按钮边框对比度 < 3（边框和自身底色都不够才算）
- `overlap`：两段不相干的文字框交叠 ≥ 25% 小框面积
- `trunc`：文字被 overflow 裁掉（scrollWidth > clientWidth）且无省略号、无 title
- 底色只叠背景色；叠在背景图 / 渐变上的记 `approx: true`，需看图复核
- `pixels`：`background-clip:text` 画的字（字色透明、墨色在背景渐变里，如思考强度牌 `.pinkie-external-tier`）读 computed style 量不出来，改按像素量：同一块区域拍「有字」和「把字藏掉」两张裁剪图，取差异像素当字墨，和藏字后的底色比对比度，`ratio` 取渐变最浅那段，记 `method: 'pixels'`；每页全部量值在 `row.clipText`。量法照 #354（`tools/pr-shots/clip-text-ink.mjs`）原样内联。

## 问题表

数据来源：本机 2026-11-26 20:34–20:37 UTC 在浏览器锁内跑一次，`mac/b11-walk-chat@952038cc`，darwin / WebKit，24 页（1440 / 820 × 日 / 夜 × 6 组）。24 页 `pageErrors` 全为 0，`overlap` 和 `trunc` 全为 0；每页 `text` 0~8 条、`ui` 1~4 条，去重后 20 条，下面按归属拆开。截图人工看过：`home-1440-day`、`mode-menu-1440-night`、`mode-menu-820-day`、`chat-1440-day`。

「占用」一列按 11-26 20:43 UTC 的 `gh pr list --state open --json files` 核对。

### 日常聊天模式自己的问题（chat 专属文件）

唠嗑模式没有独占的注入文件：对话页的气泡、表格、代码块走 chat-thread 区，这次没量出问题。唠嗑首页（新会话启动页）是这个模式的主要页面，它的样式在 `laolao-startup-home.css`（companion-and-home 区），所以记在这里。

| # | 文件:选择器 | 页面 / 主题 / 宽度 | 现象 | 数值 | 占用 |
| --- | --- | --- | --- | --- | --- |
| C1 | `laolao-startup-home.css`：`.laolao-startup-home__icon > svg`（「继续之前的工作」每行左边的对话图标） | home / model-menu / mode-menu / sidebar-collapsed，日，1440/820 | 粉色图标 `rgb(233,79,145)` 放在浅粉方块 `rgb(252,230,239)` 上，差一点够 | 2.96（要 3） | 无 |

### 看图判为误报 / 需复核（不修）

| 文件:选择器 | 数值 | 原因 |
| --- | --- | --- |
| 夜间 svg 图标：`.laolao-context-viewer summary > svg`（「13%」前的圆环） | 1.36 | 量到的图标色是 `rgb(0,0,0)`（填充默认值，实际用 currentColor 画），截图里圆环清楚。和 learning.md 误报表「夜间 svg 图标」那行是同一个脚本取色问题，需改脚本后复测 |
| `laolao-mode-menu-fx.css` 一带：`.laolao-mode-menu--fx > .laolao-mode-menu__option` 边框 | 1~1.37（approx） | 模式菜单选项底是半透明玻璃渐变，脚本只叠了白 / 深底。截图（`mode-menu-1440-night`、`mode-menu-820-day`）里每个选项都有清楚的描边和投影，可以分辨 |
| 侧栏会话列表（`chat-1440-day`）：两行「新会话 12:00」同时高亮；「最近」计数还是 2，下面却有 4 行 | — | harness 进对话页时，种历史又建了一个会话，看起来是假网关造出来的状态，不像真实界面。真网关下要复核是否会出现「两个高亮行」和「计数与行数不一致」，确认后再决定要不要开 PR |

### chat 页面里出现、但属于全局外壳的问题

首页、设置页、对话页都带着侧栏、输入框和顶栏，这些不是 chat 模式自己的样式，留给对应区域；和学习模式走查（`docs/b11-walkthrough/learning.md`）重合的项只标编号不重复展开。learning.md 外壳表没有编号，这里按它的行首文件名引用，写作「同 learning 外壳表 <文件>」。

| # | 文件:选择器 | 页面 / 主题 / 宽度 | 现象 | 数值 | 占用 |
| --- | --- | --- | --- | --- | --- |
| S1 | `laolao-composer-tray.css`：`.pinkie-tray-btn > span`（「工具」） | home / model-menu / mode-menu / sidebar-collapsed / chat，日，1440/820 | 同 learning 外壳表 `laolao-composer-tray.css` | 3.63 | 别人占着：#349 |
| S2 | `laolao-context-compact.js`：`.laolao-context-viewer__percent`（「13%」） | 同 S1 | 同 learning 外壳表 `laolao-context-compact.js` | 3.63 | 无 |
| S3 | `laolao-model-picker.css`：`.pinkie-external-tier`（「关闭」） | model-menu / chat，日，1440 | 同 learning 外壳表 `laolao-model-picker.css`。这次用像素量：24 页里 22 页 ≥4.54，只有菜单打开时和对话页 1440 日间低于 4.5 | 4.01~4.47（像素法） | 别人占着：#355 |
| S4 | `laolao-session-tools.css`：`.pinkie-temp-entry`（「临时」及图标） | home / model-menu / mode-menu / settings / chat / sidebar-open，日，1440/820 | 同 learning 外壳表 `laolao-session-tools.css` | 字 2.85、图标 2.85（approx） | 别人占着：#349 |
| S5 | `laolao-sidebar.css` / `laolao-sidebar-surface.css`：`.laolao-group__label`（「最近」）、`.laolao-group__count`、`.laolao-group__action`（「⋯」）、`.pinkie-session-time` | home / model-menu / settings / chat / sidebar-open，日，1440/820；时间只在 chat-1440-day 的高亮行 | 同 learning 外壳表 `laolao-sidebar.css`。新多出一项：高亮行里粉色时间 `rgb(233,79,145)` 放在粉底 `rgb(251,237,243)` 上 | 3.4；时间 3.09（approx） | 别人占着：#346（`laolao-sidebar-surface.css`） |
| S6 | `laolao-theme.css` / `laolao-mode-switcher.js`：`.laolao-mode-dock-trigger` | 除 sidebar-collapsed 与 820 首页 / 菜单 / 对话外全部，日/夜 | 同 learning 外壳表 `laolao-theme.css` | 1.46（approx） | 别人占着：#320（`laolao-theme.css`） |
| S7 | `laolao-motion-system.css`：`.topbar-search` | home / model-menu / settings / chat，日/夜，820 | 同 learning 外壳表 `laolao-motion-system.css` | 1.24~1.26（approx） | 无 |
| S8 | `laolao-settings-user.js`：`.page-title`（「设置」） | settings，日，1440/820 | 同 learning 外壳表 `laolao-settings-user.js`；chat 下标题是粉色 `rgb(233,79,145)` 放在白底上 | 3.5 | 别人占着：#328 |
| S9 | `laolao-settings-user.css`：`.pinkie-user-settings__choice` | settings，日/夜，1440/820 | 同 learning 外壳表 `laolao-settings-user.css` | 1.26~1.52 | 别人占着：#179、#294 |
| S10 | 模式菜单文字（mode-switcher 区，具体由哪条规则给色待修复 PR 定位；候选 `laolao-mode-menu-fx.css`、`laolao-theme.css`、`laolao-workbench.css`）：`.laolao-mode-switcher .laolao-mode-button__label`（「唠嗑模式」）、`.laolao-mode-menu__option .laolao-mode-button__label`（「项目模式」青绿 `rgb(62,133,132)`） | mode-menu / sidebar-open，日，1440/820 | 模式名在玻璃底上差一点够，learning.md 没记到 | 4.36 / 4.29（approx） | 候选里 `laolao-theme.css` 被 #320 占，`laolao-workbench.css` 被 #133 占 |

后续按「一个问题一个小 PR」修；每个修复 PR 都要附 pr-shots 改前 / 改后数值。本 PR 只含走查脚本和这张表，不改界面。
