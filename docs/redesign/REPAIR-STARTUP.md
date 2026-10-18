# STARTUP 任务报告 — 首帧清理与启动流程融合

worktree：`/Users/Admin/release-superpinkie/wt/repair-startup`，分支 `repair/startup`。
范围：`services/cle-studio/static/startup.css`、`services/cle-studio/scripts/apply-startup.mjs`、
`services/cle-studio/scripts/serve-startup-fixture.mjs`、`services/cle-studio/static/startup/*`、
`patch/apply-startup.mjs`、`patch/apply-all.mjs`（只加一行顺序）、
`installer/macos/apply-theme.sh`（只加调用段）、`tests/cle-startup.test.mjs`、本报告。
未改 `main.js`、`modules.js`、美术、`ui/injections`、live 配置。

---

## 一、根因（不是"隐藏得晚"，是根本不是同一个渲染阶段）

首帧问题的真实成因有三层，逐层核对过源码与实测响应：

1. **旧品牌写在 `index.html` 里，不在 bundle 里。** 测试网关 19789 返回的
   `<head>` 自带 `<title>OpenClaw Control</title>`、`favicon.svg` / `favicon-32.png` /
   `apple-touch-icon.png` 三个小龙虾图标、`theme-color #faf9f7 / #0e1015`。这些字节在
   任何 JS 执行前就已经到达浏览器，所以"插件加载完再隐藏"永远慢一帧。
2. **`shell.css` 的隐藏规则是插件的一部分。** `.sidebar-shell__invite,
   .community-invite-card, aside.invite { display:none }` 在 `dist/control-ui/<hash>/index.css`
   里，随插件 bundle 异步加载；同时 `src/core/brand.js` 的文本清扫也只在 `activate()` 之后。
3. **原生骨架屏的错误面板用的是同一套令牌。** `.connect-splash`、`.skeleton`、
   `.mount-fallback` 全部读 `--bg / --card / --text / --skeleton-base`。CSP 是
   `style-src 'self' 'unsafe-inline'` —— 允许内联样式、**不允许内联脚本**，所以可行的修复
   只有一种：把清理与首帧令牌以内联 `<style>` 写进 HTML 本身。

实测 CSP（`curl -sI http://127.0.0.1:19789/`）确认 `'unsafe-inline'` 在 `style-src` 内；
`script-src` 只有带哈希的两段内联脚本，因此没有走内联 JS 的方案。

---

## 二、做法

`patch/apply-startup.mjs` → `services/cle-studio/scripts/apply-startup.mjs`（真实实现）：

| 面 | 处理 | 为什么 |
|---|---|---|
| `index.html` `<title>` | `OpenClaw Control` → `C.le.` | 窗口标题在任何渲染之前就生效 |
| 三个图标文件 | **替换字节**为 `static/startup/icon-{32,180}.png` 与矢量 `favicon.svg` | 见下方"自主发现 #1"：只改 `<link href>` 会被应用在启动时改回去 |
| `theme-color` | 纸白 `#F4EFE4` / 夜黑 `#0A0D16` | 与 `themes/cle.json` 的 `background` 一致 |
| `</head>` 前内联样式 | `startup.css`（带 `pinkie-cle-startup:v1` 标记与前后分隔注释） | 首帧解析即生效；幂等替换而非堆叠 |
| `sw.js` 的 `OFFLINE_BOOT.html` | 同一份文档同样注入，并**重算 `OFFLINE_BOOT.id`** | 离线导航走的是 worker 里的副本；id 是缓存名的一部分，不重算会让旧 shell 继续赢 |
| `manifest.webmanifest` | 名称 `C.le.`、两色改纸白、图标 type 校正 | 安装窗口的名字与底色在 HTML 之前读取 |
| 失败面板 eyebrow | `OpenClaw Control UI` → `C.le. Studio` | 该面板是静态标记，插件**永远到不了**（bundle 挂了才会显示） |

`startup.css` 分两层，生命周期刻意不同：

- **永久层**：推广卡/邀请卡、`.agent-chat__welcome-clawd`（原生欢迎页的小龙虾）、登录页
  的龙虾 logo 与 "OpenClaw" 字名。这些任何时候都不该出现。
- **仅插件接管前**：`html:not([data-cle])` 下的纸白/墨黑令牌、空挂载点的 `C.le.` 等待字。
  插件 `activate()` 第一件事就是 `html.dataset.cle = VERSION`，令牌随即让位给真调色板；
  插件热重载去掉 `data-cle` 时，这一层又立刻回来，不会出现一段裸 claw 深色。

`html:not([data-cle])` 的具体度是 (0,1,1)，高于原生 `:root`，而样式块又在核心样式表之后，
因此在层叠里稳定胜出；插件真正应用到 `<html>` 的内联调色板优先级更高，交接无跳变。

### 不让"长时间空白"替代错误

这是本轮按 FUSION 标准自查后**主动修正**的一处设计错误。最初的写法把原生欢迎身份块
`visibility:hidden` 且永久生效；一旦 bundle 真的加载失败，用户会一直看到一块空白，
这正好违反"不能让长时间空白替代错误"。现在改为：

```css
.agent-chat__welcome-identity {
  visibility: hidden;
  animation: cle-brand-return 0s linear 11s forwards;
}
@keyframes cle-brand-return { to { visibility: visible; } }
```

11s 与原生 `data-openclaw-mount-timeout-ms="12000"` 的预算对齐：插件正常时早已接管（规则失效），
插件失败时原生身份与原生错误面板都回来。模型未配置的提示（`--setup > h2`）**完全不动**，
那是半配置安装唯一的指引。

引导标记 `openclaw-app:empty::before` 只在挂载点为空时出现；`body.openclaw-mount-fallback-active`
时显式 `display:none`，所以真实错误绝不会被"C.le."字标盖住。

---

## 三、自主发现（FUSION 要求：完整路径主动审查）

| # | 发现 | 位置 / 触发条件 | 严重度 | 处理 |
|---|---|---|---|---|
| 1 | **只改 `<link href>` 会被应用改回小龙虾。** 应用启动执行 `document.querySelector('link[rel="icon"][type="image/png"]')` 并把 href 重设为 `favicon-32.png`，`apple-touch-icon` 同理。实测：注入后 DOM 里仍是 `/favicon-32.png?v=…`，旧图标一秒后复活 | `control-ui-core-*.js` 内 `KS()`（boot 序列）；触发：每次页面加载 | 高（首帧修复被静默回滚） | 改为**替换图标文件字节**，让应用的重写落在他的脸上。已用真实 HTTP 验证三个资源都是 PNG/SVG 的 C.le. 版本 |
| 2 | 失败面板的 eyebrow 是静态标记 `OpenClaw Control UI`，插件无法触及 | `index.html` 的 `#openclaw-mount-fallback`；触发：bundle 404/语法错误 | 中（旧标识在错误路径漏出） | HTML 级替换为 `C.le. Studio`，错误正文与两个按钮原样保留 |
| 3 | 离线 shell 是独立副本，只改 `index.html` 时离线仍回旧首帧 | `sw.js` 的 `OFFLINE_BOOT.html`；触发：断网导航到 `/chat` | 中 | 同步注入并重算 `id`（缓存名），已验证 worker 仍能 `node --check` 通过 |
| 4 | 安装窗口的 `manifest.webmanifest` 名称/底色仍是 OpenClaw / `#0a0a0a` | `/manifest.webmanifest`；触发：安装为应用、Dock 标题 | 低 | 一并改名改色，图标 type 校正 |
| 5 | 原生欢迎页的小龙虾 `openclaw-mascot` 已由插件隐藏，但容器 `.agent-chat__welcome-clawd` 未被任何规则覆盖 | `control-ui-boot-shared-*.js` 的 `JB()`；触发：新会话空态 | 中 | 永久层直接 `display:none` 容器 |
| 6 | 原生侧栏工作区标记可能是 `<img src=favicon.svg>` 而不是插件假设的 `<span>` | `sidebar-workspace-header__mark`；触发：主题 `mascot` 非 `none` 或原生默认 | 中 | 用 `content: url('/cle/static/art/avatar.webp')` **替换**而非隐藏；隐藏会留下一个空圆（这条我最初写成永久 `display:none`，自查时发现并改掉） |
| 7 | 文件里 `favicon` 等字面量若出现在 CSS 注释中，会让"是否还残留旧图标"这类扫描误判 | `startup.css` 注释 | 低 | 注释改写为不含文件名/标签的描述，测试改为只查 href 属性 |

### 需要主控协调（超出本路所有权）

| 问题 | 准确位置 | 触发条件 | 最小修法 |
|---|---|---|---|
| 插件静态路由在测试网关返回 404 | `GET /cle/static/startup/*`、`/cle/static/startup.css` 均 404，而 `/cle/static/art/avatar.webp` 200 | 网关服务的是插件**发布快照**（`~/.openclaw-cle/tmp/plugin-captures/...`），不是 `extensions/cle-studio/static` | 重新发布 cle-studio 插件（或把 `startup/` 与 `startup.css` 纳入发布清单）。本路已把文件放进扩展目录，但未重启/重配网关——按任务书不操作 live |
| 首帧层的安装入口 | `installer/macos/apply-theme.sh` 第 1497 行附近新增调用；`patch/apply-all.mjs` 末尾新增一条 | 全量安装 / 补丁演练 | 已加；Windows 安装器（`installer/windows/apply-theme.ps1`）如也要覆盖，需照抄同一段调用（本路未改 Windows 侧，避免越界） |
| `sw.js` 的 `OFFLINE_BOOT` 与浏览器已注册的 service worker | 用户已装过旧 worker 的会话 | 首次部署本补丁后 | 首帧层的 `id` 变化会让 `CACHE_NAME` 改变，新 worker 安装后旧缓存按 `CONTROL_CACHE_LIMIT = 3` 自然淘汰；如需立刻生效可 `unregister` 一次，属验收动作，交主控 |

---

## 四、原能力对应（旧版能力 → 新版状态）

| 旧版能力 | 新版状态 | 说明 |
|---|---|---|
| 启动即品牌（标题、图标、底色） | **已恢复** | 原来靠安装期 `apply-theme.sh` 的 `perl` 改写 + 注入，新版插件化后缺少这一层；本补丁补回，并且不依赖运行时 |
| 启动不露推广/邀请 | **已恢复且更强** | 规则进入 HTML 首帧，不再等插件；同时覆盖登录页（插件触达不到） |
| 真实错误提示 | **保留** | `#openclaw-mount-fallback` 的全部文案、`Try again` / `Keep waiting`、排障链接原样；只换表面 |
| 加载状态 | **保留并换了皮** | 原生骨架屏继续工作，令牌改为纸白/墨黑；只在挂载点为空的窗口加一个 `C.le.` 字标 |
| 首次启动 / 刷新 / 热重载 / 五模式路由 | **覆盖** | 首帧层在所有路由的同一份文档上；`html:not([data-cle])` 让热重载回到正确基线；深路由由 SPA fallback 返回同一文档（已实测 `/`） |
| 双栏入口 | 未改 | 双栏是挂载后的布局，不属首帧；本路未触碰 |
| Claude 的开场美术 | **未动** | `src/splash/*` 与 `static/splash/*` 一字未改 |

---

## 五、自测（真实执行，非声称）

```
node --test tests/cle-startup.test.mjs        → 19 pass / 0 fail
node --test tests/brand-ui.test.cjs tests/laser-pointer.test.cjs → 11 pass / 0 fail
node patch/apply-all.mjs --keep               → 17 patches, patches failed: 0
  ok apply-startup.mjs {"index":"patched","offlineShell":"patched","manifest":"patched",
                        "icons":["favicon-32.png","apple-touch-icon.png","favicon.svg"]}
  node --check: all changed .js/.mjs pass; precompressed twins all ok
apply-startup 二次运行 → {"changed":false,…} （幂等）
apply-startup --revert  → index.html / sw.js / manifest.webmanifest / 三个图标 字节级还原
拒绝路径：/Applications/超級碧琪.app/... → "refusing the bundled SuperPinkie runtime"
          ~/.openclaw/...                → "refusing the live ~/.openclaw profile"
          缺 --control-ui                → "--control-ui <path> is required"
```

浏览器实核（`app_browser` + 计算样式，不是目测截图）：

| 检查 | 结果 |
|---|---|
| `document.title` | `C.le.` |
| 深色首帧 `--bg` / `--accent` | `#0A0D16` / `#5AA8FF`（claw 原为 `#ff5c5c`） |
| 浅色首帧 `--bg` / `--accent` / `--text` | `#F4EFE4` / `#2A63E8` / `#15161A` |
| 应用启动后 `link[rel=icon][type=image/png]` 指向 | `/favicon-32.png?v=…`，而该 URL 返回的字节是 PNG 且等于 `icon-32.png` |
| `favicon.svg` | 返回 `<svg … aria-label="C.le.">`，不再是 `lobster-gradient` |
| 正常态挂载 | `openclaw-app` 有子节点，`::before` 为 `none`（等待字标已退出） |
| 破坏 bundle 后 | `body.openclaw-mount-fallback-active`、`#openclaw-mount-fallback` 可见、标题 `Control UI did not start`、正文可见；等待字标被显式隐藏 |
| 横向溢出 | `scrollWidth == innerWidth`（744 == 744） |

补充：CI 之外我还用 `scripts/serve-startup-fixture.mjs`（新增，仅测试用）在 20889/20890/20891
三个端口起了真实 HTTP 服务，带与网关一致的 CSP，用来复现"无网关""bundle 损坏""正常"三种现场。
它不属于发布物，不进 manifest。

---

## 六、未验证 / 剩余风险

1. **没有做首帧录帧或像素截图验收。** 我是文本模型，按任务书不声称看过画面。上面所有结论来自
   HTTP 响应字节、DOM 属性与 `getComputedStyle`，属性层面的首帧正确；真正的"第一帧有没有闪"
   需要主控用 CUA 录帧确认。
2. **插件静态路由 404 未在本路解决**（见协调表）。也就是说：图标文件替换已生效，
   但若未来把图标改回 `/cle/static/...` 引用会 404；当前实现刻意不依赖该路由。
3. **Windows 安装器未接调用**。macOS 已接；Windows 侧要我改会越过 `installer/windows/` 的
   归属，按要求留给主控。
4. **原生失败面板的样式改动只做到"不遮不hide"**，没有逐条核对深色下的对比度数值；
   `.mount-fallback__eyebrow` 改成等宽字体后字距在窄屏（<560px）未实测。
5. **service worker 换代**：`id` 变更会让新 worker 安装，但旧页面若正被旧 worker 控制，
   要等其 `controllerchange`；这段时序没有在真实浏览器里跑过（会改动我无权操作的 live 状态）。
6. **`favicon.svg` 内嵌 `<image href="/cle/static/art/avatar.webp">`**：Safari 对 SVG 内嵌
   外部图片的支持在部分版本被禁用，届时会退回深色底 + 金环的矢量标记（已保证不是空白）。
   这一点没有在目标 WebKit 版本上实测。

---

## 七、提交

```
分支 repair/startup
新增  services/cle-studio/scripts/apply-startup.mjs
新增  services/cle-studio/scripts/serve-startup-fixture.mjs
新增  services/cle-studio/static/startup.css
新增  services/cle-studio/static/startup/{icon-32,icon-180,icon-256}.png, favicon.svg
新增  patch/apply-startup.mjs
修改  patch/apply-all.mjs          （补丁顺序末尾加一条）
修改  installer/macos/apply-theme.sh（调用段）
新增  tests/cle-startup.test.mjs   （19 tests）
新增  docs/redesign/REPAIR-STARTUP.md
```

commit 见文末回执。
