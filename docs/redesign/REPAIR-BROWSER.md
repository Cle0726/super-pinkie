# BROWSER 修复报告

worktree：`~/release-superpinkie/wt/repair-browser`（分支 `repair/browser`，起点 `253fc10`）
范围：`desktop/macos/Sources/Launcher.swift`、`BrowserControl.swift`、`MaterialPreview.swift`、`desktop/macos/build.sh`、新增 `desktop/macos/browser-test-host.sh`、`services/cle-studio/static/legacy/laolao-link-viewer.js`、`browser.css`、`laolao-material-preview.js`、测试与本文。
未改：模块注册/主入口/模式后端/原版 `ui/injections` 与 `ui/assets`/美术/`personas`/任何 live 配置或 App。

模型：DeepSeek V4.1 Flash · WB。本报告不含视觉验收结论——我没有也不可能看过截图，最终 GUI 与真实模型验收由主控执行。

---

## 1. 根因（按严重度）

### R1 · 原生浏览器控制器根本没被编译进 App（阻断级）
`desktop/macos/build.sh` 的 `swiftc` 只列出 `MaterialPreview.swift` 和 `Launcher.swift`。
`BrowserControl.swift`（`BrowserControlController` / `BrowserControlEndpoint` / `BrowserActivityIndicator` / `BrowserClickFeedback` / `BrowserControlPolicy`）从未参与编译。

证据：在修复前用构建参数做类型检查会直接失败：

```
Sources/Launcher.swift:1886:43: error: cannot find type 'BrowserActivityIndicator' in scope
Sources/Launcher.swift:1926:34: error: cannot find 'BrowserControlController' in scope
Sources/Launcher.swift:1927:35: error: cannot find 'BrowserControlEndpoint' in scope
```

影响：`laolaoBrowserWorkspace` 的 `show-file`、`chatgpt-control`、模型 `open/click/type/press/scroll/screenshot/status` 全部落空；Agent 控制浏览器与文件预览都没有后端。这解释了"桥在、能力不在"的现象。

修法：`build.sh` 增加 `"$SCRIPT_DIR/Sources/BrowserControl.swift"`。修复后同一组参数 `-typecheck` 零输出（exit 0），产物里 `nm` 能查到 `CleBrowserPalette` 等浏览器符号 297 处。

### R2 · 双栏时一个全局 id 在 pane 间搬动，另一侧丢工具
`laolao-link-viewer.js` 用 `document.getElementById("laolao-browser-workspace-entry")`，且 `mountBrowserLauncher` 只取
`.chat-pane-cache__pane--active .agent-chat__composer-lead`，再把按钮 `insertBefore` 到"当前这个" rail。

影响：切到另一侧时，按钮从旧 pane 上被 `remove()` 后搬走；旧 pane 恢复时按钮要等下一次 1.5s 轮询才可能回来。缓存 pane（`inert`）也会被挂上一个看不见的工具。

修法：入口改为每 pane 各一个 `button.laolao-browser-entry`，不再有全局 id：
- `railFor(pane)` 只在本 pane 内找 composer lead；
- 已存在就只更新 `data-native`，不搬动；
- `inert`（缓存但不可见）pane 跳过；
- 任一侧点击都 `postMessage({action:"open"})` 打开**同一个**原生工作区，页面与登录态仍在单个 `browserWebView` 里。

### R3 · 无原生桥时假装原生，降级提示误导
- 视频卡片按钮固定写"在侧栏打开"，没有桥时仍这样承诺；
- 回退 iframe 的标题是"网页预览"，`aria-label` 也是"网页预览"，无法区分"页内嵌入"与"App 浮窗"；
- iframe 被站点拒绝后提示只说"该网站拒绝了嵌入预览"，容易被理解成原生浏览器坏了。

修法：`isNative()` 区分能力；无桥时入口 `title` 为"页内预览（当前环境无原生浏览器）"、`data-native="false"`，回退面板加 `页内预览 · 未连接原生浏览器` 角标，`aria-label` 写明"页内预览（非原生浏览器）"，拒绝嵌入的说明明确写"这不是原生浮窗失败：当前环境没有 App 浏览器桥，只能页内嵌入"。

### R4 · 原生文件预览可能双开
`laolao-material-preview.js` 的 `requestSidebarPreview` 只等 1500ms，超时就 `resolve(false)`，调用方随即 `openPreview()` 再开一个页内面板。大 PDF、首次加载 `clekk-material` scheme 时很容易超时，结果原生与页内两份预览同时存在。

修法：有桥时超时返回 `"unknown"`（不再等同"原生拒绝"），调用方对 `"unknown"` 也只关闭页内面板，不重复打开；无桥时才 `false`。超时放宽到 8000ms。

### R5 · Agent 活动提示从未显示
`BrowserActivityIndicator` 实例被创建、被赋给 `browserActivityIndicator`、`activityChanged` 也会改它的 `isHidden`，但它从未被加入任何视图层级（`statusStack = NSStackView(views: [loading])`）。

影响：模型操作浏览器时工具栏没有任何"碧琪正在使用浏览器"反馈，用户只知道页面自己在动。

修法：`statusStack = NSStackView(views: [loading, activity])`；`updateBrowserToolbarLayout` 改为两个子视图都隐藏时才隐藏整个 stack（`detachesHiddenViews` 已开启，不会留空白）；`activityChanged` 里补一次工具栏布局刷新。

### R6 · 原生 chrome 仍是旧粉色皮肤，与新版割裂
浏览器面板底、工具栏底、地址栏、边缘收纳手柄、悬浮/停靠/铺满的选中态、模型点击反馈点、起始页、错误页、`clekk-material` 文件预览页，全部是旧粉色（`systemPink`、`#fffafd`/`#70425b`、`#fb8`…）。

修法：新增 `CleBrowserPalette`（纸白/墨黑/金/冰蓝 + 夜间对应值），上述所有位置改用它；起始页与错误页改成 `color-scheme` + `prefers-color-scheme` 的同一套变量；文件预览页同样改纸白/墨黑。品牌文案 `碧琪正在使用浏览器` → `碧琪正在使用浏览器`，起始页标题改为 `碧琪的浏览器`。

### R7 · 没有可复用的隔离验收宿主
任务要求为主控提供独立测试宿主，仓库里既没有脚本也没有隔离入口。

修法：新增 `desktop/macos/browser-test-host.sh`（`--build` / `--run` / `--print-env`）与 `Launcher` 的 `PINKIE_TEST_HOST=1` 分支。

---

## 2. 测试宿主的设计与安全边界

`browser-test-host.sh` 复用**同一份** `Launcher.swift` / `BrowserControl.swift` / `MaterialPreview.swift`，不复刻浏览器：

| 项 | live App | 测试宿主 |
|---|---|---|
| bundle id | `com.cle0726.super-pinkie` | `com.cle0726.super-pinkie.browser-test` |
| 网关 | 18789（自管） | 只连 `127.0.0.1:19789`，**只 attach，不 spawn/kill** |
| 状态/日志 | `~/Library/Application Support/SuperPinkie` | `.../SuperPinkie/browser-test` |
| CUA 桌面执行器 | 启动 | **不启动、不回收** |
| TTS/派对/圆桌 | 启动 | 不启动 |
| 捆绑安装脚本 | 首次运行执行 | 不执行 |
| 自动更新 | 可用 | 关闭且菜单项直接返回 |

`RuntimeConfig.gatewayURL` 在测试模式下会拒绝非 loopback 和 `18789`，直接回落到 `19789` 并打日志——即使有人误传了 live 地址，也连不到 live 网关。

已实际执行 `--build`（只编译，不启动 GUI），产物 `dist/browser-test/C.le. Browser Test.app`：

```
$ /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' .../Info.plist
com.cle0726.super-pinkie.browser-test
$ codesign -dvv ... | grep Identifier
Identifier=com.cle0726.super-pinkie.browser-test
$ nm -C .../MacOS/Launcher | grep -c BrowserControl
297
```

主控命令：

```
cd ~/release-superpinkie/wt/repair-browser
./desktop/macos/browser-test-host.sh --print-env   # 先确认路径
./desktop/macos/browser-test-host.sh --build
./desktop/macos/browser-test-host.sh --run         # 连 19789，不碰 live
```

前提：19789/profile cle 的测试网关需已在运行（当前实测 `/healthz` 返回 200）。网关没起时宿主只显示恢复提示，不会自行拉起。

---

## 3. 原能力逐项对照

| 原能力 | 状态 | 说明 / 证据 |
|---|---|---|
| 悬浮小窗、拖动 | 保留 | `BrowserPanelDragHandle`/`moveBrowserFloating` 未改；geometry 测试覆盖越界钳制 |
| 停靠侧边（`.side`） | 保留 | `changeBrowserPresentation(.side)` 未改；宽度约束测试覆盖 860–4036pt |
| 铺满工作区（`.full`） | 保留 | 同上 |
| 四边+四角缩放 | 保留 | `BrowserResizeEdges.allHandles` 已由 Swift 子进程测试覆盖 |
| 贴边收纳 / hover 露半幅 / 拖出 | 保留 | `edgeDockedFrame`/`updateBrowserEdgeHover` 未改；测试覆盖 `revealed` 两态 |
| 适应窗口 / 恢复 100% | 保留 | `browserToggleFit` / `browserActualSize` 未改 |
| 网页强制深色 | 保留 | `browserForceDarkScript` 未改；菜单项与状态保留 |
| 同一 WKWebView 保留页面与登录 | 保留 | `configuration.websiteDataStore = .default()`；`detachBrowserWorkspace` 不清 `browserWebView`/`lastBrowserURL`（测试断言其不含 `= nil`） |
| 前进/后退/刷新/外部打开 | 保留 | 未改；`createWebViewWith` 把 `target=_blank` 接进工作区 |
| 模型操作提示 | **已修** | 活动指示器进栈（R5），文案改碧琪 |
| 点击反馈 / 真人操作让行 | 保留 | `BrowserClickFeedback` + `userDidInteract` 10s 窗口未改；反馈点配色并入新版 |
| ChatGPT 网页协作 | 保留 | `chatgpt-control` / `reset-chatgpt-session` 分支与前端 `laolao-web-gpt-collab.js` 对接未改 |
| 本地文件/服务预览 | **已修** | 双开问题（R4）；预览页配色并入新版 |
| 双栏每侧入口 | **已修** | 每 pane 独立按钮（R2），切分屏时由 MutationObserver 立即补齐而非等 1.5s |
| 无桥时友好提示 | **已修** | 入口/角标/回退文案区分 native 与页内（R3） |

---

## 4. 自主发现（本轮新增，非任务书列出）

| # | 发现 | 位置 / 触发 | 修法 | 状态 |
|---|---|---|---|---|
| D1 | `BrowserControl.swift` 未被任何构建脚本编译，全部浏览器控制符号缺失 | `build.sh:169` | 加入编译列表 | 已修，类型检查+符号核对通过 |
| D2 | 活动指示器创建后从未入视图层级，Agent 提示永远不可见 | `makeBrowserPanel()` `statusStack` | 放入 stack 并修可见性联动 | 已修，编译通过 |
| D3 | 状态栈隐藏条件只看 spinner，activity 显示时整栈仍可能被隐藏 | `updateBrowserToolbarLayout` | 两子视图均隐藏才隐藏整栈 | 已修 |
| D4 | 原生文件预览 1.5s 超时被当成"拒绝"，导致页内面板叠加 | `laolao-material-preview.js:216` | 有桥时返回 `"unknown"` | 已修，语法检查通过 |
| D5 | 无桥时视频按钮仍写"在侧栏打开" | `mountMediaWorkspaceActions` | 按能力改文案 | 已修 |
| D6 | 双栏/切模式后新 pane 最多 1.5s 没有入口 | `setInterval(...,1500)` 单一通道 | 加 `MutationObserver`，仅缺失时补 | 已修，含专门测试 |
| D7 | 浏览器相关原生 UI 全部旧粉色（面板/工具栏/地址栏/手柄/选中态/起始页/错误页/文件预览页） | `Launcher.swift`、`MaterialPreview.swift` | `CleBrowserPalette` 统一 | 已改，编译通过 |
| D8 | 悬浮 resize 手柄与边缘 tab 用 `systemPink`，夜间下与新版冲突 | `BrowserEdgeTab.draw`、`applyNightAppearance` | 并入 palette，夜间取冰蓝 | 已修 |
| D9 | 起始页没有说明浏览器会保留登录态与快捷键 | `loadBrowserStartPage` | 补一行说明（⌘⇧B / 登录保留） | 已改 |
| D10 | 测试宿主若误配 live 端口会直连 live 网关 | `RuntimeConfig.gatewayURL` | 测试模式硬拒绝 18789 与非 loopback | 已修，含测试断言 |

---

## 5. 自测结果（真实执行）

```
$ cd desktop/macos && xcrun swiftc -parse-as-library -typecheck \
    Sources/BrowserControl.swift Sources/MaterialPreview.swift Sources/Launcher.swift \
    -framework AppKit -framework AVFoundation -framework Foundation -framework Speech -framework WebKit
（无输出，exit 0）

$ ./desktop/macos/browser-test-host.sh --build
built: .../dist/browser-test/C.le. Browser Test.app
（bundle id = com.cle0726.super-pinkie.browser-test，nm 命中 BrowserControl 符号 297 处）

$ node --test tests/browser-entry-panes.test.cjs tests/browser-test-host.test.cjs tests/browser-workspace.test.cjs
ℹ tests 16   pass 16   fail 0

$ cd services/cle-studio && node build.mjs
cle-studio ui 1a0183a8b349  js 53.7 KB  css 54.6 KB

$ node --check services/cle-studio/static/legacy/{laolao-link-viewer,laolao-material-preview}.js
OK
```

新增测试只覆盖真实风险，不镜像实现：
- `browser-entry-panes.test.cjs`：双栏两个 pane 各一个按钮且不是同一个节点；`inert` 缓存 pane 不挂工具；重复挂载不叠加；无桥时 `data-native="false"` 且回退面板自称页内预览；分屏新 pane 由观察器立即补齐。
- `browser-test-host.test.cjs`：构建必须包含 `BrowserControl.swift`；测试模式拒绝 live 端口；`start`/`repair`/`attach` 不 spawn、不 kill、不 terminate；测试宿主不启动 CUA/TTS/派对/圆桌/安装脚本。

---

## 6. 未验证项与剩余风险

1. **GUI 与真实模型验收未做**（我按约定不操作 GUI，也看不到图像）。需主控在测试宿主里确认：拖拽/四角缩放/贴边收纳手感、深浅色下的对比度、地址栏与工具按钮在 360pt 窄面板下的排布、`⌘⇧B` 行为。
2. **原生浮窗里 agent 活动的实际观感未验证**：代码路径已通，但没有真实模型回合驱动过它。
3. **ChatGPT 登录持久与换号未实测**：`WKWebsiteDataStore.default()` 与 `reset-chatgpt-session` 逻辑未改，只确认了接线；需要真实登录环境验证。
4. **`clekk-material` 文件预览的视觉未验证**：配色已换，未在 WebKit 里实际渲染确认。
5. **双栏与原生浮窗同时打开时的层级**：`updateWorkspaceZOrder` 未改动，未在真实分屏下验证遮挡关系。
6. **测试宿主依赖外部网关**：19789 未运行时宿主只提示、不自启；这是刻意设计，但主控需先确保测试网关在线。
7. **`dist/browser-test` 属构建产物**，已在 `.gitignore` 的 `dist/` 规则内，未提交。

---

## 7. 跨所有权问题（交主控分派，我未改）

| 位置 | 问题 | 最小修法 |
|---|---|---|
| `services/cle-studio/src/composer/composer.css` `@container cle-pane (max-width:520px)` | composer lead 用 `:nth-child(n+5)` 折进 ⋯，我新加的 `.laolao-browser-entry` 若排在第五位会被一并折起 | 主控确认后把入口显式列为不折叠（`:not(.laolao-browser-entry)`），属 composer 所有权 |
| `services/cle-studio/static/legacy/laolao-material-preview.js` `RAIL` 常量 | 仍只匹配 `.chat-workbench > .chat-workspace-rail`；若新版 rail 层级变化，文件菜单会失效 | 与侧栏任务统一 rail 选择器；本轮未改以免与其冲突 |
| 原版 `ui/injections/laolao-link-viewer.js` | 仍是全局 id 版本（原版 App 并行运行，不能动） | 主控合并时以本 worktree 的 `static/legacy` 版本为准，原版保持原样 |

---

## 8. 融合修订（增量 commit，主控验收前补做）

### 8.1 测试产物天然隔离（阻断级，优先于外观）
问题：上一版只有 shell 的 `--run` 注入 `PINKIE_TEST_HOST`/`PINKIE_STATE_ROOT`。
直接双击 .app、或经 Finder / CUA / LaunchServices 打开，会走生产分支：读 live 配置、写 live 状态、默认连 18789。这会让"不碰 live"的边界取决于操作者是否记得环境变量。

修法：把隔离编译进二进制。
- 测试构建加 `-D CLE_BROWSER_TEST_HOST`；`RuntimeConfig.isTestHost` 在该构建 **恒为 true**，与环境变量无关。
- 测试构建的默认值同时改为：stateRoot 落在 `.../SuperPinkie/browser-test`、gateway 默认 `127.0.0.1:19789`、配置只读自身 state 目录下的 `config.json`。
- 生产构建（无该 flag）保持原默认：18789、live state、`.config/super-pinkie/config.json`。
- 环境变量仍可显式覆盖，但不再是唯一保险；即使误传 18789 也会被拒绝并回落到 19789。
- 新增 `--browser-test-self-check`：用 `env -i`（清空环境）运行真实二进制，打印解析结果后退出，不开窗口、不启服务。这就是 Finder/CUA 打开时会走的同一段代码。

可核查证据（本轮实测）：

```
$ ./desktop/macos/browser-test-host.sh --check
  ok   test-host compiled in (marker present)
  ok   bundle id com.cle0726.super-pinkie.browser-test
  ok   default state root stays under browser-test
  ok   default gateway port 19789 (never 18789)
  ok   runtime self-check (clean environment)
       isTestHost=true
       marker=CLE_BROWSER_TEST_HOST_ALWAYS=1
       gateway=http://127.0.0.1:19789/
       state=/Users/Admin/Library/Application Support/SuperPinkie/browser-test
exit=0

# 同一份源码、不带 flag 的生产构建，同样清空环境：
isTestHost=false
marker=CLE_BROWSER_TEST_HOST_ALWAYS=0
gateway=http://127.0.0.1:18789/
state=/Users/Admin/Library/Application Support/SuperPinkie
exit=1   ← 正确地“不是测试宿主”
```

产物内不含旧品牌与旧粉底，且含新 token 与官方字形（`strings` 核对）：
`efcbd3`=0、`超級碧琪`=0、`#F4EFE4`=1、`#0A0D16`=1、签名路径 `M55 25C53 17 44 13 34 16`=1。

主控从 CUA 直接打开 `.app` 即可，无需 shell、无需 AppleScript、无需任何环境变量。

### 8.2 原生 palette 与真实 tokens 同步
问题：上一版我自造了暖棕夜间（paper `#161412`、surface `#1f1c19`），与 `src/styles/tokens.css` / `themes/cle.json` 的 `#0A0D16` / `#111522` / gaze `#5AA8FF` 明显割裂，等于在旧粉和新版之外又造了第三套。

修法：`CleBrowserPalette` 按 token 的当前值重写（白天 `#F4EFE4` / `#FBF8F1` / ink `#15161A` / gaze `#2A63E8` / gold `#A9842F`；夜间 `#0A0D16` / `#111522` / ink `#EFE8DA` / gaze `#5AA8FF` / gold `#C9A24A`），并补 `ink3`、`gold` 两档。
起始页、错误页、`clekk-material` 文件预览页三处不再各自写色值，统一注入 `CleBrowserPalette.cssVariables`。

防再漂移：新增 `tests/browser-palette-tokens.test.cjs`，解析 `tokens.css` 与 Swift 常量逐通道比对（容差 0.003），并检查三处内嵌页面都引用同一张表。已用"故意改回暖棕"验证它会失败并报出确切差异，随后恢复。

### 8.3 起始页品牌图形
`◷` 时钟字符已移除。改用仓库内既有的 C.le. 签名几何（`static/legacy/laolao-cle-signature.js` 与 `static/splash/signature.js` 的同一组中心线、同一 12° 斜度、同两个点），只换渲染方式：AppKit 无法测量路径，故以固定笔宽的描边呈现，不新造图标、不画猫、不生成占位图。

### 8.4 启动页不再闪旧品牌
问题：`showStartupScreen` 仍加载 `ui/launcher-loading.html`（旧粉色小马视频 + `超級碧琪正在准备`），fallback 也是 `#efcbd3` 粉底。第七路只负责新版 web 首屏，不拥有 `Launcher.swift`。

修法（限定在测试宿主分支，live App 路径不变）：
- `RuntimeConfig.isTestHost` 时直接渲染 `startupPlaceholderHTML`：纸白/墨黑 + 官方签名 + 一条极细进度线 + `C.le.` 小字，**完全不加载**旧 loading 页，因此不会有旧资产闪现。
- 同一张占位页也替换了原先的粉色 fallback 字符串，所以生产环境在缺少 bundled 页面时同样不会退回旧粉底。
- Claude 的新开场仍由 web 首屏负责，这里只是启动前的原生过渡，没有复制或覆盖任何美术资源。

### 8.5 融合修订后的自测
```
xcrun swiftc -typecheck（三源文件）        → 无输出，exit 0
./browser-test-host.sh --build             → 成功签名
./browser-test-host.sh --check             → 5 项全 ok，exit 0
node --test browser-entry-panes / browser-test-host / browser-palette-tokens / browser-workspace
                                            → tests 21  pass 21  fail 0
cd services/cle-studio && node build.mjs   → ui 1a0183a8b349
```

### 8.6 本轮新增未验证项
1. **CUA 实际打开 .app 的观感未验证**：隔离已由无环境变量的运行时自检证明；窗口渲染、启动占位页是否存在一帧旧内容、签名在两档外观下的比例，仍需主控目视。
2. **`-D` 构建与生产构建的二进制差异只核对了标记与解析值**，未做二进制逐字节比对（不必要，也不稳定）。
3. **签名在 start page 的静态描边**是几何复用而非笔压轮廓，视觉粗细需目视确认；若主控认为太粗/太细，只调 `stroke-width`，不要重画路径。
4. 启动占位页与 Claude 新版首屏的衔接时序（谁先消失、是否重叠）未验证。

---

## 9. 主控 CUA 验收后的返修（第三轮 commit）

主控用 CUA 从隔离 `.app` 直接启动，确认真打开的是原生浏览器而非 IAB/iframe：悬浮/停靠/铺满、适应窗口、100%、强制深色、外部打开均在，停靠与铺满已操作，加载 example.com 后切模式、关闭再开页面保留。

### 9.1 起始页字标被判定为“厚块”（返修）
上一版我按签名模块的中心线自拼了一个 SVG：把 200×96 的细笔手写字形按 199px 宽度放大。真实渲染实测：

| | 包围盒 | 墨量 | 每行墨量 | 填充率 |
|---|---|---|---|---|
| 旧自拼 SVG | 170×32 | 1628 px | 50.9 | 0.299 |
| 新版文字 | 199×95 | 5071 px | 53.4 | 0.268 |

两条路径的笔触密度其实相近（50.9 vs 53.4），问题在**宽高比**：细笔迹被横向撑到 199px、又压在 32px 高里，看起来就是一排厚块。这不是几何写错了，而是把“手写笔迹”当“字标”用在了一个不适合的比例上。

按要求不再另拼字标，改用应用**自己已有的**文字字标：`src/rooms/rooms.css` 的 `.cle-brandmark { font: italic 400 22px/1 var(--cle-serif); letter-spacing: -.015em }`。原生页用同一字体栈（ui-serif / New York / Songti SC）、同样斜体与 -0.015em 字距渲染 `C.le.`，起始页 64px、启动占位页 44px。`CleWordmark.startPageSVG` 与整段自拼路径已从源码删除，产物中 `M55 25C53 17 44 13 34 16` 计数为 0。

核验方式：用真实 WKWebView 离屏渲染起始页并做像素分析（不是目测）：字标 199×95、未贴边裁切、每列墨量中位 20/95 行——细笔文字而非实心块。

### 9.2 整个测试窗口外沿仍是旧粉色描边（返修）
源头在 `applicationDidFinishLaunching`：窗口 `contentView.layer.borderColor` 硬编码为 `NSColor(srgbRed: 217/255, green: 89/255, blue: 143/255, alpha: 0.24)`，即旧皮肤粉色，与洞内任何页面无关，所以只改浏览器面板看不到变化。

改为 `CleBrowserPalette.line(nightAppearance)`，与新版所有发丝线同一 token；全文件 `systemPink` 与 `217/89/143` 已清零。

### 9.3 语音入口仍叫“碧琪听着呢”（返修）
源头是 `nativeDictationBridge` 注入的 `textForState`，以及麦克风/语音识别的错误文案。可见入口与用户可读提示改为 `碧琪听着呢`、`碧琪还没有麦克风权限` 等。

**刻意保留** `超级碧琪` 的位置：`NSMicrophoneUsageDescription`、语音识别权限提示、`NSMenu` 应用名、网关恢复提示、CUA 显示名。这些是 macOS 授权与 bundle 身份，改名会让用户在系统设置里找不到对应开关，属于“不能改声音、权限”的范围。

### 9.4 本轮验证
```
xcrun swiftc -typecheck（三源文件）              → exit 0
browser-test-host.sh --check                    → 5 项 ok，干净环境 isTestHost=true / 19789 / browser-test
node --test（4 个浏览器测试文件）                → tests 22  pass 22  fail 0
cd services/cle-studio && node build.mjs         → ui 1a0183a8b349
产物字节扫描：旧粉 0 / 旧厚块 SVG 0 / 旧语音 0 / 新语音 1 / 新标题 1 / token 在
```

### 9.5 主控明确未验证、我也没有声称通过的项目
拖拽与四角缩放、贴边收纳与 hover 半幅、适应窗口/100% 的实际比例、强制深色、真实账号登录持久、模型协作、真人让行。
我也无法做视觉验收：本模型看不到图像，上述像素分析只证明了几何与笔触密度，不证明“好看”。

### 9.6 本轮自主发现（新增）
| # | 发现 | 影响 | 修法 |
|---|---|---|---|
| D11 | `strings` 默认不输出中文，我先前的“中文串存在性”核对其实是空测 | 会给出假的通过结论 | 改为按 UTF-8 字节扫描二进制后再判断 |
| D12 | 起始页 `.mark` 原有 `width:74px` 约束会裁切字标 | 字标被切边 | 改为 `width:auto` 并只留底部间距 |
| D13 | 启动占位页同时有字标与 `C.le.` 文字，重复品牌 | 观感冗余 | 副标题改为 `碧琪` |
| D14 | 旧厚块的真正成因是宽高比而非路径错误 | 只调 stroke-width 治不好 | 直接弃用自拼 SVG，改用应用既有文字字标 |

---

## 10. 第四轮：收纳标签可访问性 + under-page 配色（主控新报告）

主控 CUA 已实测通过：新字标清楚、无旧粉外框、语音文案为碧琪、本机页 744 CSSpx 真实 100% → 适应窗口 1942 CSSpx、forceDark 黑白真实切换、拖动与四边四角缩放、右/顶/底向外推收纳并拖回、关闭再开保留页面与输入。

### 10.1 `BrowserEdgeTab` 声明为按钮却没有 press 实现（已修）
问题（主控准确指出，是代码缺口而非自动化怪癖）：标签 `setAccessibilityRole(.button)`，但只要 `drag`/`mouseDown`/`mouseUp` 与 `mouseEntered`/`mouseExited`。没有 `accessibilityPerformPress`，不能成为第一响应者，也没有 keyDown —— 对 VoiceOver 与 CUA 激活都是空操作。CUA 点击无展开、原地 2px 拖动无半幅，正是因为“点击”在这条路径上根本不存在。

修法：
- `accessibilityPerformPress() -> Bool` → 走与 hover 相同的开关。
- `acceptsFirstResponder` + Space / Return 触发同一动作。
- 自定义 `mouseDown`/`mouseDragged`/`mouseUp`：位移 ≤3pt 视为点击，>3pt 才交给拖拽基类。这样点击不再被拖拽生命周期吞掉，也不给自动化留任何后门。
- 焦点态在 `draw` 里画 token 色描边，键盘用户能看见焦点。
- 状态变化 `NSAccessibility.post(.valueChanged)` 播报。

**顺带发现的真实缺陷**：按下后面板从指针下方滑出，标签随之移动，`mouseExited` 立刻触发 0.22s 后的收回，把刚展开的半幅撤销掉。因此引入 `browserEdgePinned`：显式激活时置位，hover 退出路径在置位期间不收回；指针真正进入面板/标签时清除。`clearBrowserEdgeDock` 与重新贴边都会重置它。hover 离开照样收回，向内拖出照样恢复悬浮——两者未被破坏。

几何核验（真实枚举代码，非重写）：
```
right  collapsed=0.0 revealed=320.0   （面板宽 640）
top    collapsed=0.0 revealed=260.0   （面板高 520）
bottom collapsed=0.0 revealed=260.0
```
四种位置（内置、贴右、贴顶、贴底）全部成立。

### 10.2 `underPageBackgroundColor` 仍是第三套色（已修）
`makeBrowserWebView` 里硬编码暗 `0.10/0.075/0.115`、浅 `1/.985/.993`。这是 WebKit 在加载中与弹性滚动时露出的底色，落在任何 token 之外。改为 `CleBrowserPalette.paper(nightAppearance).withAlphaComponent(0.97)`。

全文件已无手写 `srgbRed: … green: …` 组合，`systemPink`、`217/89/143`、`efcbd3`、旧厚块路径均为 0。

### 10.3 本轮验证
```
xcrun swiftc -typecheck（三源文件）      → exit 0
browser-test-host.sh --build/--check     → 构建并 5 项隔离检查 ok
node --test（4 个浏览器测试文件）        → tests 25  pass 25  fail 0
```
新增测试（真实风险，非镜像实现）：
- `edge-docked reveal exposes exactly half and collapsed exposes none`：编译并运行真实 `edgeDockedFrame`，断言收起可见 0、展开恰好半幅。
- `the edge tab is a real activatable control`：press/AX/keyDown/焦点/点击与拖拽分离/pinned 存在性。
- `the browser under-page colour follows the same tokens`。

### 10.4 仍然不声称通过
主控列出尚未验证的：cookie 跨 App 重启（不是真实账号登录）、拖拽手感细节、贴边收纳在真实鼠标 hover 下的自动露出（CUA 可能不派发 tracking 事件）。标签的键盘/AX 路径我只能从代码与几何上证明，真实 VoiceOver 播报与 CUA 点击仍要主控验。

---

## 11. 第五轮：真实模型浏览器 + 真人让行验收通路（端点接线）

### 11.1 先核对主控的事实：成立
主控判断准确。逐条核对如下：

| 事实 | 核对结果 |
|---|---|
| 测试宿主的 `startTestHostServices` 只 `attachToExisting`，不 spawn 网关 | 成立（`Gateway.attachToExisting` 仅轮询 `readyz`） |
| `BrowserControlEndpoint.authorizeGateway` 只在 `BundledRuntime` 成功 `task.run` 之后调用 | 成立（`Gateway.start()` 内，测试宿主不进入该分支） |
| `PINKIE_APP_BROWSER_ENDPOINT` 只在那里注入子网关 | 成立 |
| 因此 19789 的真实模型拿不到端点 | 成立（见 11.2 的实测证据） |
| `allowedPeer` 没有测试网关 root | 成立（`gatewayPID` 从未被设置，一律 `false`） |

额外实测：当前 19789 的监听者是 `openclaw-gateway`（PID 84617，ppid=1），
可执行文件是 `~/.nvm/versions/node/v24.20.0/bin/node`，
state 在 `~/.openclaw-cle`，cwd 是 `.../SuperPinkie/dev/cle-stage`。
它**既不是** App 捆绑 Node（`isCLEKkBundledNode` 为 false），**也不是**本进程的子进程。
所以：只靠原有父子校验或原有捆绑路径判据，都不可能合法绑定它。

### 11.2 已实现的接线（不放松任何原有约束）

**（a）端点侧：一次性只读握手**
`BrowserControlEndpoint` 新增 `adoptExistingGateway(pid)` 与 `setAdoptedExecutable(path)`。
`serve()` 里新增唯一例外分支：

- 仍然先过 `getpeereid`（同 uid）+ `LOCAL_PEERPID` + `allowedPeer(peer)`；
- 只有在 `isAdoptedGateway()` 为真、且 `adoptedPeerIsVerifiedGateway(peer)` 为真时，
  才回应 `{"op":"handshake"}`；
- `adoptedPeerIsVerifiedGateway` 要求：peer 的可执行文件仍等于登记的那个、且该 PID 仍是
  对应监听者；
- 握手只发凭证，不执行任何动作；token 对每个真实 action 仍然是必需的。

没有 allow-all、没有跳过 token、没有放宽 uid、没有读取或借用 live 端点。

**（b）宿主侧：可拒绝的认领判据**
`testGatewayAdoptionDecision(port:)`：

1. `port == 19789`，否则 `.refuse`；
2. 用 lsof 找到该端口的监听 PID（只读）；
3. 要求该 PID **当前打开着** `<测试 state 根>/state/openclaw.sqlite`（`listenerOwnsState`）。
   这条把"只是占了端口"与"真的是这个 profile 的网关"区分开；
4. state 根默认 `~/.openclaw-cle`，可用 `CLE_TEST_GATEWAY_STATE_DIR` 显式覆盖；
   比较用 **规范化后完全相等**，不做前缀匹配。

全程不 spawn、不 signal、不 restart。

**（c）凭证传递：私有描述符**
`browser-endpoint.json` 写在 `~/Library/Application Support/SuperPinkie/browser-test/`，
目录 0700、文件 0600，退出时删除。内含一次性 token，**不打印、不写日志、不进命令行**。

实测（`--browser-test-endpoint-check`）：
```
endpoint=started
hasDescriptor=true
descriptorMode=600
dirMode=700
```

**（d）越权对照实测**
用普通 python 进程（非被认领网关）连该 socket：
```
unauthorised handshake -> (空响应，连接被直接关闭)
token leaked (unauthorised): False
no-token action        -> (空响应)
token leaked (action):   False
```
即未授权 peer 既拿不到 token，也执行不了 action。

**（e）认领判据实测**
```
$ Launcher --browser-test-attach-check        # 干净环境
isTestHost=true / port=19789 / stateRoot=.../.openclaw-cle
decision=adopt / gatewayPid=84617 / exit=0

$ CLE_TEST_GATEWAY_STATE_DIR=~/.openclaw ...  # 指向 live profile
decision=refuse
reason=listener 84617 does not own /Users/Admin/.openclaw/state/openclaw.sqlite
exit=3

$ PINKIE_GATEWAY_URL=http://127.0.0.1:18789/ ...
日志：拒绝连接到非测试网关；仍回落 19789，未触碰 live
```

### 11.3 端到端还差的一步（由主控完成，我不执行）

理由：网关只从**自身进程环境**读取 `PINKIE_APP_BROWSER_ENDPOINT`
（`appBrowserEndpoint(this.environment)`），工具参数无法注入。所以要让真实模型用上，
必须让 19789 进程带着这个 env 重新启动并来握手。这一步涉及重启空闲测试网关，
按约定由主控做。

确切步骤：

1. 主控启动隔离宿主（CUA 或 `--run` 均可，隔离已编译进二进制）：
   ```
   ./desktop/macos/browser-test-host.sh --run
   ```
   宿主会认领 19789、启动端点并写出私有描述符。

2. 读取描述符（只在本机终端，勿贴进日志/报告/聊天）：
   ```
   cat "$HOME/Library/Application Support/SuperPinkie/browser-test/browser-endpoint.json"
   ```

3. 让**空闲**的 19789 带着该值重启（profile `cle`，state `~/.openclaw-cle`），
   env 名为 `PINKIE_APP_BROWSER_ENDPOINT`，值为上一文件内容原文。
   重启后网关首次调用 `app_browser` 时会：
   - 通过 socket 权限校验（目录 0700、socket 0600、同 uid）；
   - 带 `{"op":"handshake"}` 连接；
   - 端点校验它是被认领的 PID 与登记的可执行文件后，返回 `socketPath` + `token`；
   - 之后所有 `app_browser` 调用使用该 token。

4. 主控自建本机 fixture 页面（例如 `~/…/fixture.html`，含一个可读标记与一个输入框），
   让模型 `app_browser` 依次 `open` → `snapshot` → `type`，用 CUA 对照页面实际内容。

5. 真人让行验证：在面板内真实点击/输入一次，随后 10 秒内让模型再 `type`，
   预期返回 `用户正在操作浏览器`；等过 10 秒再 `type`，预期成功。

6. 结束：关闭宿主会删除描述符；若 19789 需要恢复原状，用不带该 env 的方式重启即可。

### 11.4 本轮边界与未验证
- 未启动/停止/接管 19789，未改 live 18789、未动原版 App，未操作 GUI。
- 未执行模型调用，因此**真实模型端到端仍未验证**；本轮交付的是通路、判据与拒绝证据。
- ChatGPT 真实第三方登录不在本次范围，也未要求任何用户凭证。
- 顺手修掉一个真实泄漏面：异常退出的宿主会在 `/tmp` 留下 `pinkie-browser-*` 目录
  （含 0600 socket）。新增 `removeStaleDirectories()`，只清理**同 uid、0700、且 connect()
  返回 ECONNREFUSED** 的目录；实测 8 → 1，保留的那个确认仍有进程在监听。

