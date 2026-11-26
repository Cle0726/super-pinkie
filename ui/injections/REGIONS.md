# Control UI 注入区域负责表（M3-1）

机器可读清单见同目录 [`regions.json`](regions.json)，由 [`tests/ui-region-ownership.test.mjs`](../../tests/ui-region-ownership.test.mjs) 在每次 CI 中强制校验。

## 规矩

1. **`laolao-head.fragment.html` 中的每个注入文件**都必须归属 `regions.json` 中的至少一块区域，或标记为 `common`（公共基础）。
2. **禁止越界改样式**：非负责文件的 CSS 选择器不能以别的区域的根选择器开头（例如在设置或反馈 CSS 里直接写 `.sidebar-shell`）。跨区域公共主题层（`commonCrossCuttingCss`）与历史显式豁免项（`allowedCrossRegionCss`）只收不增。
3. **跨区域协作走接口或事件**：其他模块需要影响某块区域的结构或状态时，应调用该区域暴露的 `window.Pinkie.<region>` 接口或派发自定义事件，不得直接篡改 DOM 或硬写覆盖样式。
4. **新增全局变量**：新代码一律挂在 `window.Pinkie.<region>` 下，不再新增 `window.__*`（由 M0 棘轮测试把关）。

## 区域总览

| 区域 ID | 负责范围 | 根选择器 |
|---|---|---|
| `common` | 公共基础（主题、动效、调度、共用 DOM 观察器与第三方库） | （跨区域基础层） |
| `sidebar` | 侧栏、会话列表与角色栏 | `.sidebar-shell`, `.sidebar-brand`, `.sidebar-footer-bar`, `.laolao-sidebar` |
| `mode-switcher` | 模式切换菜单与转场入口 | `.laolao-mode-switcher`, `.laolao-mode-menu` |
| `model-picker` | 模型选择菜单与思考强度滑块 | `.chat-controls__model`, `.chat-controls__inline-select-menu` |
| `composer` | 底部输入框、托盘与上下文压缩 | `.agent-chat__composer-combobox`, `.laolao-composer-tray` |
| `chat-thread` | 消息列表、富文本、工作过程卡片与运行状态 | `.chat-tool-card`, `.laolao-process-card`, `.laolao-tool-rows`, `.laolao-rich` |
| `settings` | 设置页、记忆、权限、模型配置与更新弹窗 | `.laolao-settings-user`, `.laolao-power-settings`, `.laolao-model-setup`, `.laolao-feedback`, `.laolao-update-dialog` |
| `metre` | Metre 皮肤、看板与小猫 | `[data-metre-board]`, `.metre-board`, `.metre-cat` |
| `workbench` | 代码工作台与工作区聚焦 | `.laolao-workbench`, `.laolao-workspace-focus` |
| `study-desk` | 学习台、题库、复习、笔记本与学习内联 | `.pk-desk`, `.laolao-study-desk` |
| `study-game` | 学习台游戏（HUD、对战、商店、地图、模考） | `.laolao-game-hud`, `.laolao-game-battle`, `.laolao-game-shop`, `.laolao-game-world`, `.laolao-game-exam`, `.laolao-game-loadout`, `.laolao-game-stage`, `.laolao-game-practice` |
| `companion-and-home` | 陪伴小马、启动首页与开屏 | `.laolao-companion`, `.laolao-startup-home`, `.laolao-splash` |
| `whiteboard` | 白板（想法模式）：画布、工具条、入口键 | `.pk-whiteboard`, `.pk-whiteboard-entry` |
