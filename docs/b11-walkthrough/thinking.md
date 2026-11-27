# B11 全页面走查：深度思考模式（thinking）

脚本：`tools/pr-shots/b11-thinking-walkthrough.mjs`（结构同 `b11-learning-walkthrough.mjs`；`PINKIE_SHOTS_ENGINE=webkit` 切 WebKit，WebKit 下截图走 `wkshotBuffer`）。

拍的页面（1440 / 820 × 日 / 夜，共 32 页）：

| 组 | 怎么进 | 页面 |
| --- | --- | --- |
| `home` | 场景 `home-thinking` | 深度思考模式首页（新会话启动页） |
| `settings` | 首页点侧栏「设置」 | 设置页 |
| `chat-live` | 首页发一句，假网关 `window.__fake.auto('narrated', {thinking: true, gap: 700, once: true})` | 会话进行中：过程卡 `.chat-group--process[data-pinkie-process]` + 思考框 `.pinkie-thinking` |
| `chat-thought` | 同上，点 `.pinkie-thinking__head` 展开 | 展开思考内容 |
| `chat-done` | 同上，等到【最终回复】且过程卡收起 | 跑完 |
| `deepthink-menu` | 跑完后点输入框 `.laolao-deep-think-btn` | 思考强度菜单 `#laolao-deep-think-menu` |
| `picker-model` / `picker-effort` | 点模型选择器，再点 `.pinkie-effort-trigger` | 模型选择器 / 思考强度面板 |

量法（`report.json`，每页一行；`shots.jsonl` 每张图记 browser 与 sha256）：

- `text` / `ui` / `overlap` / `trunc` 判据同 learning.md。
- 底色只叠背景色；叠在背景图 / 半透明渐变上的记 `approx`，需看图复核。
- `.pinkie-external-tier` 与 cle-status 状态字等用 `background-clip:text` 画的字，按 #96 里 [ui] 18:12Z 的提醒改为按截图像素量（`method: 'pixels'`）。#354 还没合，脚本里先内联了同思路的 `clipTextInk`，#354 合了再改成 import。

## 问题表

数据来源：本机 WebKit（playwright 1.65.1，隔离目录），头 `6e0b451e9a50b78eb473473e57b2fdcbfac8ebe9`（origin/main），持 `browser.lock.d` 18:49:53Z–18:53:29Z，EXIT 0，跑完 `tests/visual/baseline/` 无改动。日志第一行原文：

```
PW-RESOLVE playwright=/Users/Admin/pinkie-mac/pw/node_modules/playwright/package.json@1.65.1 playwright-core=/Users/Admin/pinkie-mac/pw/node_modules/playwright-core/package.json@1.65.1 
```

32 页都没有出错项、pageErrors 都是 0；截断（trunc）32 页都是 0。截图人工看过：`deepthink-menu-820-day`、`deepthink-menu-1440-night`、`chat-live-1440-day`、`picker-effort-1440-night`。

上面 32 页里没有运行状态条（`section.pk-run`）：假网关跑 narrated 时不会出现它。运行状态条单独补拍，见下一节。

### 运行状态条 `section.pk-run` 补拍

- 怎么拍：`PINKIE_WALK_ONLY=run` 只跑这一组。场景用 `home-thinking`（sessionKey `agent:thinking:dashboard:harness0001`），注入 `scripts/chat-ui-harness/run-status-shots.js`，沿用它的 11 个状态（同一条 `pinkie:gateway-event` 事件流，加上 `__fakeRunStatus` / `__fakePlan`），逐个状态调用 `window.__runStatusShot(i)` 后截图。
- 拍了多少：1440 / 820 / 480 三种宽度 × 日 / 夜 × 11 个状态，共 66 张。480 宽是 dot 布局，脚本会先点开 `.pk-run__dot` 再量。
- 数据来源：本机 Chromium（playwright 1.65.1，隔离目录），头 `a91942993fd2020434be44a030e9b95f645ba62b`（origin/main），持 `browser.lock.d` 从 10:35Z 起，EXIT 0，pageErrors 全部为 0。
- 每张图记的字段：`runBar` / `runLayout` / `runOpen` / `runSummary`，以及 `runText`（条内每段文字的前景色、底色和对比度）。

| 状态 | 条是否出现 | 说明 |
| --- | --- | --- |
| steps / background / second-version / reviewer / make-up / asking / stopped / reconnecting | 出现（66 张里都和预期一致） | 1440 / 820 为 bar 布局，480 为 dot 布局且已展开 |
| thinking / done | 隐藏（符合预期） | 非 Metre 下按设计隐藏 plain 与 done（`laolao-run-status.js:208` / `:171`） |
| slower-than-usual | 出现，但显示成审稿态 | 真页面 harness 冻结了 Date（固定在 2026-11-20T04:00Z），`phaseFor` 恒为 0，「比平时慢」的 slow 判定永远达不到，条上只显示成 review 态（「审稿员在打开成品核对 · 已用 1 秒 · 平时约 1 秒」）。slow 色调在真页面下测不到，只能靠单测覆盖 |

量到的文字对比度（要求 4.5；日间条底是半透明珍珠玻璃，脚本按白底叠色，记为 approx）：

| # | 文件:选择器 | 主题 / 状态 | 前景 / 底 | 数值 | 占用 |
| --- | --- | --- | --- | --- | --- |
| R1 | `laolao-run-status.css:51`：`.pk-run__meta`（「已用 1 秒」「· 平时约 1 秒」） | 日，除 stopped 外的全部出现态，三种宽度 | `#a36b82` / 白玻璃（`#fffdfe`→`#fff7fb`）；asking 态底为 `#ffe6f0` | 白底 4.21，玻璃渐变 4.00~4.16，asking 态 3.58 | 无 |
| R2 | `laolao-run-status.css:75`：`.pk-run__btn[data-act="answer"]`（「去确认」） | 日，asking，三种宽度 | `#fff` / `#e94f91`（悬停 `#c2457c` 4.73） | 3.50 | 无 |

其余文字都够：日间正文 `#623247` 10.16，reconnecting 正文 `#c2457c` 4.73，「停下」`#805269` 6.31；夜间正文 13.86~15.68，meta `#a8959f` 5.22~5.91，「停下」10.97~11.03，「去确认」`#fff6fa` / `#b0466f` 5.01。R1、R2 都只出现在日间，夜间已经够。

「占用」一列按 11-26 19:05:48 UTC 的 `gh pr list --state open --limit 200 --json number,headRefName,files`（117 个开着的 PR）核对。

### 深度思考模式自己的问题

| # | 文件:选择器 | 页面 / 主题 / 宽度 | 现象 | 数值 | 占用 |
| --- | --- | --- | --- | --- | --- |
| T1 | `laolao-deep-think.js`（菜单 CSS 字符串 626–657 行）× `laolao-night.css:251` | deepthink-menu，夜，1440/820 | 夜间思考强度菜单被铺成深底，但菜单里的字仍是日间深紫：标题「思考强度」、档位说明（summary）、提示（hint）、页脚几乎看不见（见 deepthink-menu-1440-night.png）。来源：菜单容器带 `role="menu"`（`laolao-deep-think.js:437`），被 `laolao-night.css:251` 的夜间通用浮层规则 `[role="menu"]` 刷成 `rgba(44,34,50,.98)` 深底；`laolao-deep-think.js:657` 只给 `html[data-theme-mode="dark"]` 保留浅色玻璃底，`html[data-pinkie-night]` 没覆盖到，内文 `rgba(87,54,74,.43~.72)` 也没有夜间色 | head 1.32、summary 1.23、hint 1.26、footer 1.17（要 4.5）；approx | 无 |
| T2 | `laolao-deep-think.js`：`.laolao-deep-think-menu__summary`、`__hint`、`__footer` | deepthink-menu，日，1440/820 | 日间菜单里档位说明、提示、页脚灰粉字偏淡（8.5–10.5px） | summary 2.83、hint 3.56、footer 2.27；半透明玻璃底 approx | 无 |
| T3 | `laolao-deep-think.js`：`.laolao-deep-think-menu__recommended`（「推荐」）、`.laolao-deep-think-menu__numeral`（「Ⅰ」…） | deepthink-menu，日/夜，1440/820 | 档位卡角标白字落在浅橙 / 浅粉底上，7–8px 小字 | 推荐 2.11（白 / `rgb(226,166,117)`）、numeral 2.89（白 / `rgb(224,117,165)`） | 无 |
| T4 | `laolao-deep-think.js`：`.laolao-deep-think-menu__item` 边框 | deepthink-menu，日（夜 2.5），1440/820 | 日间档位卡边框 `rgba(255,255,255,.28)` 落在白玻璃底上几乎看不出；夜间 2.5 也不到 3 | 1 / 2.5（要 3）；approx，卡片有渐变底能分辨，修前看图复核 | 无 |
| T5 | `laolao-deep-think.js:623` × `laolao-night.css:202`：`.laolao-deep-think-btn__spark` | 输入框，夜，1440/820 | 夜间输入框火花按钮是一块浅灰方块，图标 `rgb(205,189,198)` 落在 `rgb(181,180,182)` 上看不出（见 deepthink-menu-1440-night.png 右下「关闭」旁） | 1.15（要 3） | 无 |
| T6 | `laolao-cle-stage.css:64 / 65 / 73 / 127`：`.cle-status b`（「思考中」「正在执行」「完成」）、`.cle-status > span > em`（「3 个步骤」「ls tests」）、`.cle-status i`（「0 秒」） | chat / deepthink / picker，日/夜，1440/820 | 过程卡标题行状态字偏淡；日间 `--cle-mute` 实测 `rgb(147,146,154)` 落白底 | b 日 2.92~3.89、夜 3.59~3.82；em 日 2.33~3.08；i 日 3.08、夜 3.82（要 4.5）；进行中的按像素量 | 无 |
| T7 | `laolao-process-card.css:79 / 81`：`.pinkie-thinking__chev`（「›」）、`.pinkie-thinking__label`（「正在思考 · 0s」） | chat，日，1440/820 | 思考框展开箭头 `#a36b82` 和进行中标签（shimmer）略淡 | chev 4.21、label 3.91（按像素量，见 chat-live-1440-day.png） | 无 |

T1 说明：菜单的 `role="menu"` 读屏要用，不宜去掉；更像是在 `laolao-deep-think.js` 里给 `html[data-pinkie-night]` 补和 657 行同样的浅色底，或给菜单内文补夜间色。`laolao-night.css` 与 `laolao-deep-think.js` 现在都没人占，修复 PR 自己定，并附改前 / 改后数值。

### 看图判为误报 / 需复核（不修）

| 文件:选择器 | 数值 | 原因 |
| --- | --- | --- |
| deepthink-menu 820 日/夜：`div.chat-text > p`（「基线测试全部通过…【最终回复】」）对 `.laolao-deep-think-menu__head > span`（「思考强度」） | overlap 0.99，48×16 @382,526 | 思考强度菜单是弹出浮层，本来就盖在正文上（见 deepthink-menu-820-day.png），不是排版问题 |
| 夜间 `summary > svg`（`.laolao-context-viewer summary svg`） | 1.36 | 量到的图标色是 `rgb(0,0,0)`（填充默认值，实际用 currentColor 画），同 learning.md，属脚本取色不准 |
| `approx` 各项（T2、T4、cle-status em / i 等） | — | 底色是半透明玻璃 / 渐变，脚本只叠了背景色；数值仅作排序，修前看图复核 |

### 深度思考模式页面里出现、但属于全局外壳的问题（不在深度思考模式文件里）

| 文件:选择器 | 页面 / 主题 / 宽度 | 现象 | 数值 | 占用 |
| --- | --- | --- | --- | --- |
| `laolao-composer-tray.css`：`.pinkie-tray-btn > span`（「工具」） | 日，1440/820 | 同 learning.md | 3.36 | 别人占着：#349 |
| `laolao-context-compact.js`（样式在 `laolao-theme.css` 一带）：`.laolao-context-viewer__percent`（「13%」） | 日，1440/820 | 同 learning.md | 3.36 | 别人占着：#320（`laolao-theme.css`） |
| `laolao-session-tools.css`：`.pinkie-chip--mode > span`（「想法取向」） | 日，1440/820 | 输入框取向按钮字淡 | 3.55 | 已修：#457 `mac/b11-mode-chip-contrast`（日间默认态改用 `--pt-quiet`，≥4.5） |
| `laolao-session-tools.css`：`.pinkie-temp-entry`（「临时」及图标） | 日，1440 | 同 learning.md | 字 2.67、图标 2.67 | 别人占着：#349 |
| `laolao-sidebar.css` / `laolao-sidebar-surface.css`：`.laolao-group__label` / `__count` / `__action`、`time.pinkie-session-time` | 日，1440 | 同 learning.md | 3.45 / 4.16 | `laolao-sidebar-surface.css` 别人占着：#346；`laolao-sidebar.css` 无 |
| `laolao-theme.css`：`.laolao-mode-dock-trigger` | 日/夜，1440 | 同 learning.md | 1.46 → 日 ≥3.80 / 夜 ≥6.88（静态） | 本单：`mac/b11-dock-followup-edge` |
| `laolao-theme.css`：`button.laolao-followup-mode-btn` 边框 | chat-live / chat-thought，日/夜，1440/820 | 进行中输入框追问方式按钮边框淡 | 1.42 / 1.73 → 日 ≥3.80 / 夜 ≥6.88（静态） | 本单：`mac/b11-dock-followup-edge` |
| `laolao-run-status.css` / `laolao-metre-chat.css`：`button.chat-new-messages`（「有新消息」）边框 | chat-done / deepthink / picker，日/夜 | 「有新消息」胶囊边框贴底 | 1.27~1.29 | 无 |
| `laolao-motion-system.css`：`.topbar-search` | 日/夜，820 | 同 learning.md | 1.24~1.26 | 无 |
| `laolao-settings-user.js`：`.qs-segmented__btn`（「高级」） | settings，日 | 同 learning.md | 4.13 | 别人占着：#328 |
| `laolao-settings-user.css`：`.pinkie-user-settings__choice` | settings，日/夜 | 同 learning.md | 1.26~1.52 | 别人占着：#179、#294 |
| `laolao-model-picker.css`：`.pinkie-external-tier`（「关闭」）、`button.pinkie-effort-trigger` 边框 | 输入框 / picker-effort，日/夜，1440/820 | 思考强度牌按像素量后字 4.04~4.39（learning.md 里按 color 量的 1.04 属 background-clip:text 误报，以本表为准）；触发按钮边框 1.21~1.31 | 字 4.04~4.39、边框 1.21~1.31 | 别人占着：#355 |

后续按「一个问题一个小 PR」修深度思考模式专属的 T1–T7（T1 优先：夜间菜单基本不可读），运行状态条的 R1、R2 另开单修（`laolao-run-status.css` 现在没人占）；每个修复 PR 都要附改前 / 改后数值。本 PR 只含走查脚本和这张表，不改界面。
