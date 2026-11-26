# B11 走查表：无限制模式（unrestricted）

脚本：`tools/pr-shots/b11-infinite-walkthrough.mjs`（`node <脚本> --out <目录>`，在 pr-shots 工作流里跑）。

## 怎么进入、拍了哪些页面

- 进入：模式菜单里的「无限制模式」（`ui/injections/laolao-mode-switcher.js`，`id: "unrestricted"`），会话都在 `agent:unrestricted:` 下。
  走查用真页面场景 `home-unrestricted`（`tests/visual/lib/real-harness.mjs`），不连真网关。
- 首页 `home`：`laolao-startup-home.js` 的问候语 + 「继续之前的工作」。
- 会话 `chat`：离开首页后的空会话；输入区多一个无限制模式独有的「脱敏」按钮（`laolao-desensitize.js`）。
- 作品库 `artifacts`：侧栏「作品」→ `laolao-artifacts.js` 的 `.pinkie-art-page`。
- 工作台 `workbench`：输入区右侧「工作台」按钮（`.pk-wb-reopen`，`laolao-workbench.js`，别人占着）。
- 设置 `settings`：侧栏底部齿轮 → `/settings`。

1440 / 820 × 日 / 夜，共 20 张。阈值：小字对比度 < 4.5、边框 / 图标 < 3、可点元素重叠、文字截断（`scrollWidth > clientWidth` 且无省略号 / title）。

## 问题表

数据来源：pr-shots run 45825296178（头 53ea963b），linux 与 windows 两份 report.json 计数一致，下表数值取 linux。
「IMG」表示底下是壁纸或渐变，对比度按纯色底估算，要对照截图看。

| # | 文件:选择器 | 现象 | 数值 | 出现在 | 位置是否在被占文件里 | 处理 |
|---|---|---|---|---|---|---|
| 1 | `laolao-artifacts.css`: `.pinkie-art-page__head` 里的 `.pinkie-art-close`、`.pinkie-art-search` | Windows 窗口按钮组（`#pinkie-native-window-controls`，fixed，层级最高）压在作品库头部：关闭键「×」上半被盖，搜索框右端被「更新 / 全屏 / 最小化」三个键盖住 | 关闭键被盖 223 + 209 px²；搜索框被盖 3 × 479 px² | artifacts 1440/820 日/夜 | 否（未被占） | 单开小 PR 修 |
| 2 | `laolao-artifacts.css`: `.pinkie-art-note`、`.pinkie-art-empty` | 说明文字、空态文字偏淡 | 3.39（12.5 / 13px） | artifacts 日 | 否 | 候选小 PR |
| 3 | `laolao-artifacts.css`: `.pinkie-art-chip`（7 个类型筛选键） | 未选中的筛选键只有一圈很淡的描边 | 边框 1.22 | artifacts 日/夜 | 否 | 记表（键内有字，描边不是唯一识别手段） |
| 4 | `laolao-artifacts.css`: `.pinkie-art-search` | 搜索框描边 | 2.05 | artifacts 日 | 否 | 记表 |
| 5 | `laolao-artifacts.css`: `.pinkie-art-close` | 「×」opacity .6 | 3.9（20px） | artifacts 日 | 否 | 记表 |
| 6 | `laolao-artifacts.css`: `.pinkie-art-chip[aria-pressed=true]`「全部」 | 选中键的字 | 3.99 | artifacts 日 | 否 | 记表 |
| 7 | `laolao-sidebar.css` / `laolao-sidebar-surface.css`: `.pinkie-session-time`、`.laolao-group__label`、`.laolao-group__count`、`.laolao-group__action`「⋯」、`.pinkie-session-date` | 侧栏时间、分组名、计数、⋯ 偏淡 | 2.19 / 2.25 / 2.25 / 1.97 / 3.08（IMG） | 1440 日/夜各页 | 否 | 记表：所有碧琪模式共用侧栏，不是无限制模式自己的样式，超出本批范围 |
| 8 | `laolao-session-tools.css`: `.pinkie-temp-entry`「临时」 | 文字和图标偏淡；与「新会话」行重叠 1652 px² | 2.13（IMG） | 1440 日/夜 | 否 | 记表：重叠是有意的布局（`::after` 让出 54px）；颜色问题同第 7 条，属共用侧栏 |
| 9 | `laolao-theme.css`: 输入区 `.pinkie-tray-btn`「工具」、`.laolao-desensitize-btn`「脱敏」、`.laolao-deep-think-btn`、`.laolao-context-viewer__percent` | 输入区小按钮的字 | 3.81 | 日各页 | 否 | 记表：颜色来自共用输入区规则，「脱敏」自带的 #8c4a6a 被它盖掉 |
| 10 | `laolao-theme.css`: `.laolao-mode-dock-trigger` | 分屏键描边 | 1.45（IMG） | 1440 日/夜 | 否 | 记表（共用） |
| 11 | `openclaw-tooltip > button.topbar-search`（原生） | 820 宽顶栏搜索键描边 | 1.23（IMG） | 820 日/夜 | 否（原生） | 记表 |
| 12 | `.pinkie-effort-trigger > .pinkie-external-tier`「关闭」 | 量到 1.33，但截图里的字清楚可读 | 1.33 | 各页 | 否 | 待复核：疑似量法把按钮底色算错 |
| 13 | `.laolao-context-viewer` summary 里的容量圈 svg | 圈的底槽 | 1.26 | 各页 | 否 | 待复核：底槽是装饰，进度弧没有单独量 |
| 14 | `laolao-workbench.*`: `.pk-wb-open-project` 描边 1.26、`.pk-wb-project__tag`「未打开」3.25（10px）、夜间 `.pk-wb-open-project` 字 4.25、`.pk-workspace-header__views`「对话」4.31 | 工作台空态 | 见左 | workbench | **是**：别人占着 #133 / #228 / #232 | 只记表，不改 |
| 15 | `laolao-settings-user.css`: `.pinkie-user-settings__choice` | 设置页分段键描边 | 1.26（「默认」1.96） | settings 1440 日/夜 | **是**：别人占着 #179 / #236 | 只记表，不改 |
| 16 | 设置页 `.page-title`「设置」 | 22px 标题 | 3.99 | settings 1440 日 | 否 | 记表 |

### 量法误报（已在脚本里修，不算问题）

- `footer.lcv-actions > button.laolao-context-viewer__compact`「现在整理上下文」：它在收起的 `<details>` 里，看不见，却被算作与输入框重叠 3141 px²、描边 1.34。脚本现在跳过收起的 `<details>` 里 summary 以外的元素。
- 作品库铺满视口时，压在它底下的顶栏按钮也被算作重叠或对比度不足。脚本现在遇到铺满视口的弹层时，只量弹层里的元素，以及中心点露在最上面的元素。
- `h2.pk-wb-side__title.pk-wb-sr` 截断 97 > 1：这是读屏专用的隐藏标题，不是截断。
- `settings-820-*` 两格超时：820 宽时工作台占满主区，侧栏齿轮点不到。脚本现在先收起工作台，再进设置页。
