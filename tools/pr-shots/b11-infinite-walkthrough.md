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

（截图跑完后填写）
