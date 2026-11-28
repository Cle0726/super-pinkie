# B11 走查表：碧琪项目（project 模式）

截图脚本：`tools/pr-shots/b11-project-walkthrough.mjs`（1440 / 820 × 日 / 夜；首页、设置页、作品库 + 查看器、工作台）。

## 页面怎么进

| 页面 | 怎么进（脚本里） | 负责文件（regions.json） |
| --- | --- | --- |
| 首页 | `home-project` 场景：`laolao:active-mode=project`，新会话，启动首页 | companion-and-home：`laolao-startup-home.css/.js` |
| 设置 | `settings` 场景：侧栏底部「设置」 | settings：`laolao-settings-user.css/.js` 等 |
| 作品库 | `sidebar-expanded` 场景 + `PinkieArtifacts.open()`；查看器 `openViewer(id)` | chat-thread：`laolao-artifacts.css/.js` |
| 工作台 | `sidebar-expanded` 场景 + `__pinkieWorkbench.show()`，打开 `/proj/README.md` | workbench：`laolao-workbench.css/.js` |

`pinkie.artifacts.*` / `pinkie.apps.*` / `pinkie.fs.*` 在页面里答成示例数据，不连网关。

## 判定

- 小字对比度 < 4.5（大字 < 3）
- 控件边框对外底 < 3（且控件自身底对外底也 < 3）；图标对底 < 3
- 元素重叠：两个互不包含的文字 / 控件 / 图标框相交 ≥ 较小者 15%，且相交处一个盖住另一个
- 文字截断：scrollWidth > clientWidth，无省略号、无 title

## 问题表

来源：pr-shots run https://github.com/Cle0726/super-pinkie/actions/runs/45817526204 （头 8237f77fec4cf2dae6b3acabecfe41f76d2001f4，脚本 tools/pr-shots/b11-project-walkthrough.mjs）。
Linux 32 张图全部拍到，四类页面 data-laolao-mode 都是 project，没有出错步骤。数值取自 Linux 的 report.json；Windows 只对比了「截断」一类（与 Linux 完全一致），其余类别没有逐条对比。
看过图的：home-1440-day、library-1440-day、viewer-1440-day、settings-1/2-1440-night、workbench-1440-day。其余格子只有数值。

占用核对：`gh pr list --state open` 里，下表涉及的文件只有 laolao-workbench.css / laolao-workbench.js 被占（#254 #245 #232 #228 #133）；laolao-settings-user.css 被 #179 #236 占。其余文件不在任何开着的 PR 里。

### 真问题（看图确认或数值明确）

| # | 页面 | 文件:选择器 | 现象 | 数值 | 位置被占？ |
| --- | --- | --- | --- | --- | --- |
| 1 | 作品库 | laolao-artifacts.css:8 `.pinkie-art-page__head`（右侧没给窗口键留位） | 右上窗口键胶囊 `#pinkie-native-window-controls` 盖住搜索框右端，关闭钮 × 只露上半截（看图确认） | 窗口键 ×3 压在搜索框上，share 0.5；1440/820 × 日/夜 | 未被占 |
| 2 | 首页/设置/作品库/工作台 侧栏 | laolao-sidebar.css:466 `.pinkie-session-date`（opacity .58）、:467 `.pinkie-session-time`（opacity .56） | 「今天」、会话时间 11:58 / 11:00 / 12:00 太淡（看图确认） | 1.88–2.84（11px，1440 日/夜） | 未被占 |
| 3 | 同上 侧栏 | laolao-sidebar-surface.css:116 `.laolao-group__label`、:125 `.laolao-group__count`（opacity .7） | 「最近」「2」太淡（看图确认） | 2.2–2.99（11–11.5px） | 未被占 |
| 4 | 同上 侧栏 | laolao-sidebar.css:481 `.pinkie-recent-menu`（opacity .65） | 「⋯」菜单键太淡 | 1.94–2.56 | 未被占 |
| 5 | 同上 侧栏 | laolao-session-tools.css:7 `.pinkie-temp-entry`（currentColor 55% + opacity .75） | 「临时」字和图标太淡；按钮绝对定位在「新会话」行里，两个点击区重叠（视觉上不互相压字，低优先级） | 字 1.91–3.34，图标 1.91（1440 日）；重叠 share 1 | 未被占 |
| 6 | 首页 / 工作台对话侧 | `#laolao-project-scope`：laolao-sidebar.css:19（10px #966b84）与 laolao-ui-subtraction.css:85 / :362 都在设，实际 9px | 输入框下「未绑定项目文件夹」9px 且偏淡（看图确认） | 3.07（9px，日） | 未被占 |
| 7 | 作品库 | laolao-artifacts.css:2 `--pa-muted`（--pa-text 55%）→ :21 `.pinkie-art-note`、:33 `.pinkie-art-card__meta`、:57 `.pinkie-art-btn--quiet` | 说明行、卡片来源/时间、查看器「从作品库移除」偏淡（看图确认） | 3.4 / 3.45 / 3.45（12–12.5px，日） | 未被占 |
| 8 | 作品库 / 查看器 | laolao-artifacts.css:12 `.pinkie-art-close`（opacity .6）、:47 `.pinkie-art-versions__dot`（opacity .4） | 关闭 × 偏淡；版本条中间的点很淡 | × 3.97（20px，日）；点 2.28–3.17 | 未被占 |
| 9 | 作品库 / 查看器 | laolao-artifacts.css:2/:3 `--pa-line`（日 rgba(96,50,73,.12)，夜 rgba(255,235,245,.10)）→ :16 `.pinkie-art-chip`、:54 `.pinkie-art-btn`、:10 `.pinkie-art-search` | 分类胶囊、「打开」「在文件夹中显示」、搜索框的边框几乎看不见，底色又和外底相同（fill 1），控件边界只靠字 | 边框 1.22–1.33，搜索框 1.9；夜间搜索框 placeholder 3.42 | 未被占 |
| 10 | 首页 / 工作台 输入框 | laolao-composer-tray.css:27 `.pinkie-tray-btn`；laolao-session-tools.css:95 `.pinkie-chip__caret`（opacity .7）；placeholder 与 `.laolao-context-viewer__percent` 的颜色来源还没定位到文件 | 「工具」「工作程度」「13%」、输入框 placeholder、工作程度下拉箭头偏淡（字 #77999c / #71979b） | 3.07–3.99；箭头 2.14；容量环 svg 1.26–1.33 | 未被占（placeholder / 13% 待定位） |
| 11 | 设置页 | laolao-settings-user.css `.pinkie-user-settings__choice`、`__button--small`、`__model-button`、`__preset`、`__button--primary` 的边框 | 选项胶囊边框很淡；选中态边框 1.96 | 1.26–1.51；选中 1.96；主按钮边框 1.46–1.65 | 别人占着：#179 #236 |
| 12 | 设置页 | laolao-settings-user.css（快捷键行） | 「Ctrl+Alt+Space」和「修改」两个按钮紧贴没间距（看图，低优先级） | — | 别人占着：#179 #236 |
| 13 | 工作台 | laolao-workbench.css / laolao-vendor-monaco 主题（`.line-numbers`） | 编辑器行号 2–10 非常淡，第 10 行几乎看不见（看图确认） | 1.22–2.73（13px，日/夜）；当前行 3.75 | 别人占着：#254 #245 #232 #228 #133 |
| 14 | 工作台 | laolao-workbench.css:324 / :337 `.pk-wb-status__mode .pk-wb-mark` | 状态栏「项目模式」里的小标记和底色一样 | 1.0 | 别人占着：同上 |
| 15 | 工作台 | laolao-workbench.css（`.pk-wb-project__tag`、`.pk-workspace-header__views > button`、`.pk-wb-row__name/__git`、`.pk-wb-status__dirty`、`.codicon-files`） | 「主目录」标签、820「对话」页签、git 黄色 M / src、未保存 *、资源管理器图标偏淡 | 3.24 / 3.25 / 3.5 / 3.47 / 2.98 | 别人占着：同上 |
| 16 | 工作台 | laolao-workbench.css（`.pk-wb-badge`、820 状态栏 `.pk-wb-status__item`） | Git 角标压在图标上（share 0.18，常见做法）；820 状态栏「问题数」和「行 1，列 1」两个按钮框互相压 | share 0.36–1（820 日/夜） | 别人占着：同上 |

### 低优先级 / 待核对（没看图或接近阈值）

| # | 页面 | 文件:选择器 | 现象 | 数值 | 位置被占？ |
| --- | --- | --- | --- | --- | --- |
| 17 | 首页 / 设置 | `.dashboard-header__breadcrumb`（上游 Control UI 结构，文件未定位） | 面包屑「C.le. › 碧琪 › 聊天 / 设置」scrollWidth 比 clientWidth 多 4px，没有省略号；图里没看出被切，待核对 | sw 65 / cw 61（Linux、Windows 一致） | 待定位 |
| 18 | 首页 | `aside.chat-workspace-rail--collapsed`（laolao-classic-shell.css:411 附近） | 收起的右侧竖栏文字多 4px；图里竖排标签显示完整，待核对 | sw 40 / cw 36 | 未被占 |
| 19 | 设置页 | `openclaw-config-page .qs-segmented__btn`、`.page-title`（文件未定位） | 「高级」页签、「设置」大标题（22px 不算大字）略低于阈值 | 3.7 / 3.77 | 待定位 |
| 20 | 设置页 | laolao-settings-user.css `.pinkie-user-settings__status` | 「还没有连接微信。」11px 略低于阈值 | 4.18 | 已修：mac/b11-settings-status-contrast（默认 #487560、busy #83653f，卡片底 5.13 / 5.25） |
| 21 | 侧栏 / 工作台 | `.laolao-mode-button__label` | 「项目模式」12px 略低于阈值 | 4.26–4.29 | 模式切换区，文件未定位 |
| 22 | 作品库 | laolao-artifacts.css `.pinkie-art-icon` | 无缩略图卡片的占位图标偏淡（装饰性） | 2.19 | 未被占 |

### 判为误报（不进修复）

- 输入框「关闭」思考强度 1.02：底色按插画背景算错，图里是清楚的深色字。
- 设置页夜间「＋ 添加服务商 / 配对移动设备 / 连接微信」2.71：底色按暗卡片算，图里是浅色胶囊配粉字，清楚可读。
- 截断 `div.pk-wb`（多 2px）与 Monaco 滚动层（scrollWidth 16777216）：测量口径问题，不是文字被切。
- 模式头像 `.laolao-mode-button__halo` 1.0：装饰光圈，不是图标。
- 页面报错 `SecurityError: Failed to read the 'localStorage' ... sandboxed`（作品库 4 次 / 查看器 8 次）：截图夹具的初始化脚本跑进了无 allow-same-origin 的预览 iframe，页面本身没问题。
- 设置页「读取失败：无法读取当前设置版本」、默认模型「正在读取…」：假网关没答设置版本请求。
- 查看器「恢复这个版本」灰：当前已是最新版本，按钮禁用，不计对比度。

### 后续小 PR（只开未被占文件）

1. 作品库头部给窗口键留位（#1，laolao-artifacts.css）。
2. 侧栏日期 / 时间 / 分组标题 / ⋯ / 临时入口对比度（#2–#5，laolao-sidebar.css、laolao-sidebar-surface.css、laolao-session-tools.css）。
3. 作品库 muted 字与 --pa-line 边框（#7–#9，laolao-artifacts.css）。
4. 「未绑定项目文件夹」字号与颜色（#6）、输入框 muted 字（#10），先定位到唯一负责文件再动。
每个都要先有 pr-shots 改前 / 改后数值才开。#11–#16、#20 等占用方 PR 合并后再看。

本轮测试用到的上游：无。
