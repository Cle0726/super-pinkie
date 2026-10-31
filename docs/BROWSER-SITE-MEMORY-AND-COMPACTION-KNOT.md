# 浏览器「操作记忆」与上下文整理「收束」动效

2026-10-25，Claude Code。已装入 `/Applications/超級碧琪.app`（签名 deep strict 通过，App 未重启）。

## 给 Codex 的交接（避免互相覆盖）

本轮只改了下面这些文件，没有动学习模式、模型选择器、原生 Swift、聊天 bundle：

| 仓库文件 | 已装到 |
|---|---|
| `services/mode-architecture/app-browser.mjs` | App 内同名文件；`~/.openclaw/extensions/pinkie-mode-architecture/app-browser.mjs`（"Li An" → "碧琪"） |
| `ui/injections/laolao-context-compact.js` | App 内 `ui/injections/` 与 `runtime/openclaw/dist/control-ui/` |
| `ui/injections/laolao-compaction-glyph.js` | 同上（`?v=compactionglyph2`） |
| `installer/macos/apply-theme.sh`、`installer/windows/apply-theme.ps1` | 只把 `contextcompact9` 改成 `contextcompact10`；control-ui `index.html` 同样 |
| 新增 `tests/browser-memory.test.mjs`、`tools/claude-deploy/`、`tools/compaction-preview/` | 仅仓库 |

如果下一次 App 更新用的是 17:16 之前的安装快照，请改用当前安装版做底，否则会把这些文件回退。备份：`~/Library/Application Support/SuperPinkie/backups/claude-browser-memory-20261025-171611`。

## 浏览器：为什么还慢，改了什么

Codex 的 Gemini 实测里，本机动作合计约 1 秒，模型往返约 32 秒（6 回合、每回合只做一个动作）。所以提速要减少回合，而不是加快点击。

- **操作记忆（site memory）**：成功的步骤按「role + 名称 / selector」记下（不存临时 ref），按页面归档（本地端口、查询串、路径里的 id 会忽略）。存在 `~/.openclaw/pinkie-browser/site-memory.json`，权限 0600。密码框只记变量名，不记内容。
  - 回合结束时，两步以上的成功操作会自动记下；在最后一次调用加 `remember:"标题"` 可以起名。
  - 下次 `open` 同一页时，结果里会带上 `known`：之前成功过的步骤和变量。
- **`replay`**：`recipe=id` 加 `vars=[{name,value}]`，一次调用跑完全部步骤；不在那一页时会先打开它。失败会返回 `failedStep`，自动记录失败一次就删除，手动起名的记录失败三次才删除。
- **`fill`**：`fields=[{name,value}]` 加 `submitName`，一次调用填完整张表。它按上一次观察到的控件自动选择：文本用 type，下拉用 select，滑杆用 set_slider，勾选框用 click（已经是目标值的会跳过）。
- **`batch` 可带 `url`**：先打开再操作，一次调用完成。
- 工具说明开头改成「最快路径」三步，明确要求不要一回合只做一个动作。
- 另有 `recipes` 列出本页记录，`forget` 删除记录。

需要**重启网关**（App 重启）才会加载新工具定义。

## 上下文整理：收束

不再照搬 C.le. 签名粒子，只借用它的动画语言：尖头笔笔压、粒子沿笔顺流动、光沿笔画掠过、句点墨晕。

- **整理中**：两侧是一行行「对话细线」，越靠近中间越收窄；粒子沿线流向中间，笔把它们写成一个结，落下句点，光沿笔画掠过，然后淡出，循环约 2.8 秒。
- **完成**：最后再写一次，两侧细线收成一条贯穿的分隔线，结系在线上；约 2.2 秒后停止渲染。
- **失败**：笔画写到一半断开，琥珀色，不落句点，静态显示。
- **布局**：不再是卡片，没有边框和底色，改成时间线里的居中分隔：动画一行，状态加计时一行，说明一行。360px 宽不会横向滚动，高 71px。
- **技术**：Canvas 2D，不再加载 Three.js 和 GSAP；整页只有一个渲染器；离开视野、页面隐藏、整理完成后都会停止渲染；「减少动态效果」时只显示静态画面。白天用墨色加蓝光，夜晚用蓝白（C.le. 配色）。
- **预览**：`node tools/compaction-preview/serve.cjs`，用页面上的按钮切换开始、完成、失败和白天/夜晚。

## 验证

- `node --test tests/browser-memory.test.mjs tests/browser-fast.test.mjs tests/browser-pointer.test.mjs tests/context-compact-ui.test.cjs`：21 项全部通过。
- 预览页和真实聊天页（18789，只在本地派发事件，不碰会话）里检查了：白天、夜晚、360px、完成后停止渲染。

## Gemini 3.8 真实测试（2026-10-25，用户重启后）

用 Codex round-7 的同一套测试页、同一个原生 WKWebView 测试宿主、同一段系统提示，只换成新的 app_browser。操作记忆用独立文件，不写入用户真实的记忆。脚本在 `tools/browser-memory-bench/`，原始记录是 `run1-all.json` 和 `run2-lab.json`。

| 场景 | Codex 基线 | 首次访问（无记忆） | 再次访问（有记忆，换新值） |
|---|---|---|---|
| 表单 + 精确滑杆 | 3 回合 / 22.4 秒 | 3 / 21.0 秒 | 3 / 18.8 秒（看到记录，但用了等价的一次 batch） |
| 悬停菜单 + Canvas 拖拽 | 6 / 36.3 秒 | 5 / 28.3 秒 | **3 / 17.6 秒（replay）** |
| 长表格内部定位 | 7 / 51.8 秒 | 6 / 32.5 秒 | **3 / 18.9 秒（replay，值改为 57）** |
| 合计 | 16 回合 / 110.5 秒 | 14 / 81.8 秒 | **9 / 55.3 秒** |

- 六个场景都通过，由页面自身的核对确认（值正确、只保存一次、Canvas 节点对齐、原生输入 isTrusted、网页本身没有滚动）。
- 3 回合（打开 → 一次操作 → 汇报）已是这套流程的下限。再次访问三个场景都到了下限。
- **注意**：第一次整轮测试里，悬停/Canvas 场景两次都失败，页面收到的鼠标移动是 0。之后单独探测，在测试窗口处于前台时悬停正常，重跑也通过了。原因是测试窗口失去焦点后，WebKit 不再接受模拟的鼠标移动。这是原生层（Swift）的问题，和本次 Node 层改动无关。但碧琪的窗口在后台时，悬停和拖拽也可能这样失败，值得在原生层加兜底。

## 原生修复：窗口在后台时悬停 / 拖拽失效（2026-10-25）

**原因**：WebKit 只把模拟的鼠标输入交给它认为处于活动状态的窗口，判断依据是 `isKeyWindow`。用户在别的 App 里工作时，碧琪的悬浮浏览器窗口不是 key window，悬停和拖拽就完全送不进网页（页面收到的鼠标移动为 0）。

**修复**：`BrowserControl.swift` 新增 `BrowserAgentActivation`。
- 碧琪做一次指针动作期间，只让这一个浏览器窗口对 WebKit 报告为 key，并发送 didBecomeKey 通知，让 WebKit 重新判断窗口状态。
- 最后一次动作后保持 1.5 秒，让「悬停 → 点菜单」在一批操作里连得上；之后发 didResignKey，恢复真实状态。
- 用户接管（`userDidInteract`）时立即恢复。
- 不会把窗口调到前台，不抢键盘焦点，也不影响其他窗口。改动在 `deliverMouse` 入口，共 57 行。

**验证**（`tools/native-pointer-fix/`）：

| 检查 | 结果 |
|---|---|
| Finder 在前台、浏览器在后台，原版 | 悬停失败，点击和拖拽连带失败，鼠标移动 0 |
| 同样情况，修复版 | 悬停、点菜单、Canvas 拖拽都成功，鼠标移动 20，isTrusted=true |
| `document.hasFocus()` | 动作前 false，动作中 true，2.2 秒后恢复 false；前台始终是 Finder |
| Codex 的原生指针验收 NativeCursorAcceptance | 56/56 通过（与基线相同） |

**安装**：用的是安装版 App 自带的源码。先确认用这份源码按 Codex 的路径重新编译，`__TEXT,__text` 与已安装的 Launcher 逐字节相同（`a2ba993a…`），所以没有回退任何原生改动。替换的 3 个文件：`Contents/MacOS/Launcher`、`desktop/macos/Sources/BrowserControl.swift`、`_CodeSignature/CodeResources`。签名 deep strict 通过；需要重启 App 才生效。备份在 `~/Library/Application Support/SuperPinkie/backups/claude-native-pointer-20261025-180011`。

**给 Codex**：以后的原生改动请以安装版 App 里的 `desktop/macos/Sources/BrowserControl.swift` 为底，它已包含这次修复。仓库里的 C.le. 版 `BrowserControl.swift` 也打了同样的补丁，类型检查通过。
