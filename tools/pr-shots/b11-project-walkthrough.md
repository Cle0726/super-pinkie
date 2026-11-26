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

待 pr-shots 结果回来后填写（文件:选择器 / 现象 / 数值 / 位置是否在被占文件里）。
