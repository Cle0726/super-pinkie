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

待 pr-shots 结果回来后填写。
