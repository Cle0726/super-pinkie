# B11 全页面走查：学习模式

脚本：`tools/pr-shots/b11-learning-walkthrough.mjs`（经 `.github/workflows/pr-shots.yml` 在 Linux / Windows runner 上跑，本机不开浏览器）。

拍的页面（1440 / 820 × 日 / 夜）：

| 组 | 怎么进 | 页面 |
| --- | --- | --- |
| `home` | 场景 `home-learning` | 学习模式首页（新会话启动页） |
| `settings` | 学习模式下点侧栏「设置」 | 设置页 |
| `desk-*` | 场景 `study-desk`，再 `window.__pinkieStudyDesk.go(<view>)` | 学习台：`today`（今日/营地）、`board`（看板）、`library`（书架）、`notes`（笔记本）、`vocab`（生词本）、`drill`（背一背）、`gamepractice`（刷题）、`chat`（对话） |

量法（`report.json`，每页一行）：

- `text`：小字对比度 < 4.5（大字 ≥24px 或粗体 ≥18.66px 时 < 3）
- `ui`：图标（svg）或输入框 / 按钮边框对比度 < 3（边框和自身底色都不够才算）
- `overlap`：两段不相干的文字框交叠 ≥ 25% 小框面积
- `trunc`：文字被 overflow 裁掉（scrollWidth > clientWidth）且无省略号、无 title
- 底色只叠背景色；叠在背景图 / 纸纹上的记 `approx: true`，需看图复核

## 问题表

数据来源：pr-shots run https://github.com/Cle0726/super-pinkie/actions/runs/45816212756 （PR #250 头 `a5db536c739d32fb998e1f89a65e58ce80198b2d`），Linux 与 Windows 各 40 页，两边数值一致。截图人工看过：`desk-today-1440-day`、`desk-today-820-day`、`desk-today-1440-night`、`desk-vocab-1440-day`、`desk-drill-1440-day`。截断（trunc）四十页都是 0。

「占用」一列按 11-26 12:46 UTC 的 `gh pr list --state open` 与 `open-pr-touched-files.tsv` 核对。

### 学习台自己的问题（学习模式专属文件）

| # | 文件:选择器 | 页面 / 主题 / 宽度 | 现象 | 数值 | 占用 |
| --- | --- | --- | --- | --- | --- |
| L1 | `laolao-game-hud.css`：`.pkg-who__meta > b` 与 `> small` | desk-today，日/夜，820 | 营地顶栏「日常碧琪」和「亲密度 Lv.1」两行文字压在一起（820 宽时 Lv.1 被挤到下一行，和名字叠住）；1440 下两段也贴死无间隔 | 交叠 0.6~0.81，811px²，位置 167,47 | 无 |
| L2 | `laolao-game-hud.css`：营地日间弱字（`.pkg-who__meta small`、`.pkg-purse .pkg-cell small`、`.pkg-entries .pkg-entry small` / `.pkg-entry__sub`、`.pkg-kicker`、`.pkg-jar small`、`.pkg-loop__n`、`.pkg-seg button`、`.pkg-sec__meta`、`.pkg-q__meta .pkg-num`、`.pkg-target__n`） | desk-today，日，1440/820 | 灰紫弱字 `rgb(154,140,156)` 落在纸色上偏淡，9.5–12.5px 的小字 | 2.95~3.08（要 4.5）；纸纹底 approx | 无 |
| L3 | `laolao-game-hud.css`：`.pkg-stage__tag small`（「N FORM」）、`.pkg-stage__tag span`（「元气：每天第一组 +10」） | desk-today，日/夜，1440/820 | 舞台右上角形态牌上 10px 灰字看不清 | 1.87 / 3.58 | 无 |
| L4 | `laolao-game-hud.css`：`.pkg-entry__sub` em（「小雪限定」）、`.pkg-target__t em`（「冲刺期·估」） | desk-today，夜，1440/820 | 夜间粉色 `rgb(219,31,116)` 小字落在深底上不够 | 3.59 / 3.38~4.24 | 无 |
| L5 | `laolao-game-hud.css`：`.pkg-target`（「加一场考试」虚线按钮） | desk-today，日/夜，1440 | 虚线边框太淡 | 边框 1.46~1.55（要 3） | 无 |
| L6 | `laolao-game-practice.css`：`.pkb-kicker`（「DRILL · 真题题库」） | desk-gamepractice，日，1440/820 | 同 L2 的弱字色 | 2.95 | 无 |
| L7 | `laolao-study-desk-ink.css` / `laolao-study-desk-board.css` / `-vocab.css` / `-notes.css` / `laolao-learning-library.css`（同一种日间弱字色，具体由哪条规则给色待修复 PR 定位）：`.pk-kicker`、`.b-sub`、`.b-ranges button`、`.b-adopt-row small`、`.pk-pageno`、`.n-subtitle`、`.v-count`、`.v-filters button`、`.v-model`、`.v-add-hint`、`.v-layout button`、`.pk-note small`、`.pinkie-library__eyebrow`、`.pinkie-library__status`、`.pinkie-library__empty` | desk-board / notes / vocab / library，日，1440/820 | 学习台各页副标题、说明、筛选按钮统一用 `rgb(135,120,141)`，日间纸色上不到 4.5；夜间全部过 | 3.83（要 4.5）；纸纹底 approx | 无（规则落在 `laolao-study-desk-ink.css`，类名定义在 board/vocab/notes 与 `laolao-learning-library.css`） |
| L8 | `laolao-learning-library.css`：`.pinkie-library__search`、`.pinkie-library__primary` | desk-library，日/夜，1440/820 | 书架搜索框和「＋ 打开电子书」按钮边框几乎看不出 | 边框 1.43~1.46（要 3） | 无 |
| L9 | `laolao-study-desk-board.js:77`（`data.answered.independentRate`） | desk-board 起每页 pageErrors | 看板数据缺 `answered` 时直接抛 `TypeError: Cannot read properties of undefined (reading 'independentRate')` | — | 无 |
| L10 | `laolao-study-desk-vocab.js`（`.v-count` 文案） | desk-vocab，日/夜 | 生词本标题上方直接显示 JS 异常原文「Cannot read properties of undefined (reading 'due')」（见 desk-vocab-1440-day.png） | — | 无 |
| L11 | `laolao-game-hud.css`：`.pkg-purse .pkg-cell .pkg-glyph[data-kind="stars"] svg`（钱包星星，`#D99A1E`） | desk-today / desk-gamepractice，日，1440/820 | 日间钱包里的星星图标偏淡（#474 取色修正后复测发现） | 2.27（像素 2.21~2.25，要 3） | 本单：`mac/b11-purse-stars-day` |
| L12 | `laolao-desk-reward.css`：`.pk-drill-nib svg`（`color:var(--pink)` 落在 `--hair` 上） | desk-drill，日，1440/820 | 日间刷题进度笔尖图标偏淡 | 2.75（像素 3.3，要 3） | 无 |
| L13 | `laolao-context-compact.js`：`.laolao-context-viewer summary svg`（上下文圆环，`#bd73a2`） | home / desk-chat，日，1440/820 | 日间上下文圆环偏淡；DOM 3.42 过线，但抗锯齿后像素只有 2.08~2.79，修之前要定按哪个算 | 3.42（像素 2.08~2.79） | 无 |

L11~L13 说明：派单只要求夜间三组 SVG 闭环，这三项是日间新发现、且落在 desk-reward / context-compact 等其他文件，不在本单范围，登记待派。形态牌（`.pkg-stage__tag`）里的日间星星 1.84 与夜间主题 + 白天舞台 1.02 同一根因，已在 `mac/b11-night-svg-audit` 一并修（日舞台深金 `#7A5518`、夜舞台亮金 `#F2C14E`）。

L9 / L10 说明：harness 的假网关不应答看板、生词本的 RPC，所以数据是空的；真网关下多半不会出现。但界面在数据缺字段时把异常原文显示给用户，这算健壮性问题，修之前要先在真数据形状下复核。

### 看图判为误报 / 需复核（不修）

| 文件:选择器 | 数值 | 原因 |
| --- | --- | --- |
| `laolao-game-hud.css`：`.pkg-hello`（「下午好。」）、`.pkg-line` | 1.15 / 2.83 | 量到的底色是外层深色块 `rgb(36,24,15)`，实际文字压在浅色插画天空上，截图里清楚 |
| `laolao-game-hud.css`：`.pkg-boss__copy *`（「巴别兽」、天数、「还没考过…」、BOSS kicker） | 1.03~1.46 | Boss 卡是深色渐变 / 图底，脚本只叠了纸色；截图里白字在深底上清楚 |
| `laolao-game-stage.css`：`.pkq-plate__row b / small`（背一背顶部「日常碧琪」「气势」） | 1.05~1.08 | 名牌是半透明深底叠在场景图上，脚本没算进去；截图里可读 |
| ~~夜间 svg 图标：`.laolao-context-viewer summary svg`、`.pkg-glyph svg`、`.pk-drill-nib svg`~~ **已复测闭环** | ~~1.18~1.41~~ → 夜：圆环 4.51、nib 5.08、glyph 7.95~10.56 | 原读数是脚本把填充默认值 `rgb(0,0,0)` 当图标色。#474 修正取色（只量子图形，stroke / fill 各按自己的 opacity，跳过 `none` / `url()`）后，用 `tools/pr-shots/b11-night-svg-audit.mjs` 在 Chromium + WebKit、1440/820 复测（两引擎读数一致，像素复核相符），确认是误报。唯一真低：desk-today 夜间主题 + 白天舞台时，形态牌里的星星只有 1.02（夜间 stars 规则特异性压过牌子规则，亮黄落在浅色牌上）。本单 `mac/b11-night-svg-audit` 改为让牌子里的 glyph 跟舞台昼夜取色（`--st-glyph`），反例见 `tests/b11-stage-tag-glyph-contrast.test.mjs`。日间顺带发现的三项另登记为 L11~L13 |

### 学习模式页面里出现、但属于全局外壳的问题（不在学习模式文件里）

首页、设置页、学习台「对话」页都带着侧栏和输入框，这些不是学习模式自己的样式，留给对应区域。

| 文件:选择器 | 页面 / 主题 / 宽度 | 现象 | 数值 | 占用 |
| --- | --- | --- | --- | --- |
| `laolao-composer-tray.css`：`.pinkie-tray-btn span`（「工具」） | home / desk-chat，日 | 输入框工具按钮字淡 | 3.4 | 无 |
| `laolao-context-compact.js`（样式在 `laolao-theme.css` 一带）：`.laolao-context-viewer__percent`（「13%」） | home / desk-chat，日 | 上下文百分比字淡 | 3.4 | 无 |
| ~~`laolao-model-picker.css`：`.pinkie-external-tier`（「关闭」）~~ **误报** | home / desk-chat，日/夜 | ~~思考强度牌字和底几乎同色~~ 字用 `background-clip:text` 画，`backgroundColor` 就是墨色，脚本拿墨色当底色算错了；脚本已改按像素量（`tools/pr-shots/clip-text-ink.mjs`），真页面日 4.68–5.33、夜 5.32–5.55，不改样式（协调者 11-26 09:45 划掉） | ~~1.04~4.11~~ | — |
| `laolao-session-tools.css`：`.pinkie-temp-entry`（「临时」及图标） | home / settings / desk-chat，日，1440 | 侧栏「临时」入口文字和图标都淡 | 2.51 | 无 |
| `laolao-sidebar.css` / `laolao-sidebar-surface.css`：`.laolao-group__label`、`.laolao-group__count`、`.laolao-group__action`、`.pinkie-session-time` | home / settings / desk-chat，日，1440 | 侧栏分组标题、计数、时间字淡 | 3.39 / 3.61~4.22 | 无 |
| `laolao-theme.css` / `laolao-mode-switcher.js`：`.laolao-mode-dock-trigger` | home / settings / desk-chat，日/夜，1440 | 分屏按钮边框淡 | 1.46 → 日 ≥3.80 / 夜 ≥6.88（静态） | 已修：#461 `mac/b11-dock-followup-edge` |
| `laolao-motion-system.css`：`.topbar-search` | home / settings / desk-chat，日/夜，820 | 顶栏命令面板按钮边框和底色都贴背景 | 1.24~1.26 | 无 |
| `laolao-settings-user.js`（`.page-title`「设置」、`.qs-segmented__btn`「高级」） | settings，日 | 标题 / 分段按钮字略淡 | 4.09 / 4.2 | 无 |
| `laolao-settings-user.css`：`.pinkie-user-settings__choice` | settings，日/夜 | 模式选择按钮边框淡 | 1.26~1.52 | 别人占着：#179 |

后续按「一个问题一个小 PR」修学习模式专属的 L1–L8（L9/L10 先复核）；每个修复 PR 都要附 pr-shots 改前 / 改后数值。本 PR 只含走查脚本和这张表，不改界面。
