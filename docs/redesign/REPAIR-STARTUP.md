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
| 三个图标文件 | **替换字节**为 `static/startup/icon-{32,180}.png` 与矢量 `favicon.svg` | 见"自主发现 #1"：只改 `<link href>` 会被应用在启动时改回去 |
| 三个图标 href | 追加内容指纹 `?cle=<12 hex>` | 见"自主发现 #8"：网关对 `?v=<build-id>` 回 `immutable` 一年，URL 不变则缓存永远命中旧图 |
| 写入目标 | 每次写前 `assertWritableTarget`：拒绝符号链接、比较 **real path** 归属 | 防止软链接把写入带出 root |
| 派生文件 | `.br`/`.gz` 双 twins 与 `asset-manifest.json` 一并备份、同步、还原 | 见"自主发现 #9"：清单只收 `assets/**`，根文件不得写入 |
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

这是本轮按 FUSION 标准自查后**两次修正**的设计问题。

最初的写法把原生欢迎身份块 `visibility:hidden` 且永久生效；一旦 bundle 真的加载失败，用户会一直
看到一块空白。第二次改成 11s 后 `@keyframes` 交还——但那等于**超时后把旧品牌放回来**，既违反
"不漏旧品牌"，也仍在失败路径上留了一段空白。

现在的做法是既**不隐藏、也不交还**，而是原地重建品牌：

```css
html:not([data-cle]) .agent-chat__welcome-avatar {           /* 头像槽 */
  background: #0A0D16 url('/cle/static/art/avatar.webp') center / cover no-repeat;
}
html:not([data-cle]) .agent-chat__welcome-avatar > * { opacity: 0 !important; }
html:not([data-cle]) .agent-chat__welcome-identity-copy > h2 { font-size: 0 !important; }
html:not([data-cle]) .agent-chat__welcome-identity-copy > h2::after {
  content: "C.le."; /* 衬线字标 */
}
```

块本身留在原位，所以布局盒、提示行都不位移；旧文案被 `font-size:0` 压掉、由 `::after` 取代文字，
既不空白也不回旧品牌；`data-cle` 之后整组规则失效，真实 agent 名与房间开场原样接回。
模型未配置的提示（`--setup > h2`）**完全不动**——那是半配置安装唯一的指引。

侧栏工作区的**文字**标识同理（此前只处理了 `<img>`）：`.sidebar-agent-card__name-text` 在
`html:not([data-cle])` 下压字补字，并单独保住 `.sidebar-agent-card__chevron`；作用域是关键，
全局生效会把用户自选的 agent 名也压成 `C.le.`。

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

| 8 | **`?v=<build-id>` 让图标被浏览器缓存一年。** 网关把 `href="./favicon-32.png"` 重写成 `?v=<build-id>` 并回 `Cache-Control: public, max-age=31536000, immutable`。只换文件字节不改 URL，已访问过的浏览器仍会用缓存里的小龙虾——这解释了为什么"换了文件却还看到旧图标" | `server-control-ui-root-*.mjs` 的 `resolveControlUiRootPublicAssets`；`favicon*.png`、`apple-touch-icon.png` | 高（首帧修复在回访时失效） | 给三个图标 href 加内容指纹 `?cle=<12 位十六进制>`（由 donor 字节算出）。网关的重写只匹配裸 href，因此不再套 `?v=`；实测同 URL 换成 `?cle=` 后响应头由 `immutable` 变 `no-cache`。**没有动 build id**——它被解析成 `<base>-<64 hex>`，改了会被判 stale 并触发整树重建 |
| 9 | **清单只收 `assets/**`，给根文件写行会让整份清单不可解析。** `parseControlUiAssetManifest` 要求 `path` 以 `assets/` 开头、键集严格为 `{path,sha256,size}`、且按 `localeCompare` 排序后校验 `generation`。我最初的 `refreshTwins` 会给 `index.html`/图标写行，那会让网关丢弃整份清单 | `server-control-ui-root-*.mjs` 的 `hasExactKeys` / `isControlUiAssetManifestPath` / `hashControlUiAssetManifestEntries` | 高（我引入的缺陷，自查时发现） | `refreshTwins` 现在对非 `assets/` 路径直接返回，不写清单。实测真实包的 1392 条全部在 `assets/` 下、`generation` 可按同公式复算一致 |
| 10 | **无 ledger 时重跑会覆盖旧备份，让 `--revert` 变成静默空操作。** 早前版本只按 `.orig` 是否存在判断，没有 ledger；我在真实包副本上跑"改→还原"，4 个文件没有回到原始字节，正是因为它保留了 09:43 那次运行留下的备份，而我的写入又覆盖了它 | `.pinkie-startup-backup/`；触发：运行时曾被旧版补丁打过 | 高（回滚失效，且不报错） | 备份改为"首次优先"：`.orig` 已存在就绝不覆盖，并补测试锁住该语义 |
| 11 | **欢迎身份块"11 秒后交还"会重新露出旧品牌。** 初版用 `@keyframes cle-brand-return` 在 11s 后恢复 `visibility`，那等于超时后把旧文案放回来，既违反"不漏旧品牌"，也仍然在失败路径上留了一段空白 | `.agent-chat__welcome-identity` | 中（设计性缺陷） | 改为**原地重建品牌**：头像槽换成批准素材 `avatar.webp` 并压掉原生内容，名称行用 `font-size:0` + `::after` 呈 `C.le.`。块本身不隐藏，所以既不空白也不回旧品牌；`data-cle` 后交还给真实 agent 名 |
| 12 | **侧栏工作区的文字标识没有覆盖，只有图像被处理。** 原生 header 在网关尚未给出 display name 时会回落成旧产品名，而此前只替换了 `img.sidebar-workspace-header__mark` | `.sidebar-agent-card__name-text`（`.sidebar-workspace-header` 与 agent 卡共用该类） | 中（刷新时首帧漏字标） | 加**作用域内**的文字覆盖（`html:not([data-cle])`），并单独保留 `.sidebar-agent-card__chevron` 不被压没。作用域是关键：全局生效会把用户自选 agent 名也压成 `C.le.` |

| 13 | **`lib-precompressed.mjs` 每次刷新资产就追加一段 build-id，累积到超出网关上限。** 已用最小复现确认：每编辑一个受清单跟踪的资产并调用 `refreshPrecompressed`，`indexBuildId` 就 `updated` 一次、长度 +13。连做 4 次得到 120 → 133 → 146 → 159 → **172**（网关正则只允许 1–161），且形状不再是 `^<base>-<64hex>$`。后果是网关正则**完全匹配不到**，`buildId` 取不到 → 判 stale → 触发整棵 Control UI 重建 | `patch/lib-precompressed.mjs:128`；触发：安装器或 `apply-all` 在一次会话里改到 ≥4 个资产 | 高（**跨路，非本路引入**） | **本路未改它**（属 `patch/lib-precompressed.mjs` 所有权）。已核实本补丁单独运行时 build-id 保持 120 字符、形状合法，不参与放大。建议最小修法：先剥掉既有 `-<12hex>` 尾再追加，或固定 `set` 成合法值，使重复运行幂等 |

| 14 | **运行时字标不是"隐藏得晚"，是根本没在被监听的地方改写。** 实测新开页面第一份 AX 仍是 `Main Session — OpenClaw` / `OpenClaw · 工作区菜单`，加载完成后才变 C.le.，打开拆分又短暂回到 `learning — OpenClaw`。根因：`core/brand.js` 只 `observe(document.body, {childList, subtree})`，而标题写在 `<head><title>` 里；且原生 `syncDocumentTitle()` 在 Lit 的 `updated()` 钩子上**每次导航都重写一遍** `${context} — OpenClaw`，再由 `applyControlUiPresentation()` 追加 ` · ${environment.label}`。一次性修补必然被覆盖 | `control-ui-core-9qYjK5B2.js` 的 `updated(e){this.syncDocumentTitle()...}` 与 `Uc()`；`control-ui-boot-shared-xfDhIVun.js` 的 `pu()` | 高（每次导航/拆分都闪回，用户可见） | 观察 `<head>` 与 `<title>`，并把 `syncTitle()` 提到**每个批次都跑**（标题是单次字符串比较，代价可忽略）；调度从 `requestIdleCallback(timeout:400)` 改为微任务，保证在本次任务之后、下一次绘制之前完成 |
| 15 | **侧栏标签从未被覆盖，只处理了文本节点。** `aria-label` 由原生拼成 `${name} · 工作区菜单`，而 name 在网关应答前回落为产品名。`sweep()` 只改文本节点，`aria-label` 是属性，永远不会命中——这正是辅助功能树（AX）里仍读到旧名的原因 | `dv()`、`$h.renderContent()`；`aria-label="${t} · ${j('agentChip.workspaceMenuLabel')}"` | 中高（读屏用户持续看到旧标识） | 新增 `sweepChrome()` 只读侧栏块内的 `[aria-label]`，用 `localLabel()` **只替换前导产品名**；`OpenClaw Notes · 工作区菜单` 这类用户自选名保持原样 |
| 16 | **CSS 侧栏选择器建立在旧类名假设上。** 名字实际是 `span.sidebar-agent-card__name-text.hover-marquee > span.hover-marquee__text`，只压外层仍会让内层用自身字体度量撑开行盒；工作区 mark 有**两个分支**：默认 `img[src=favicon.svg]`，主题 `mascot:"none"` 时是 `span.sidebar-workspace-header__mark--neutral > svg` | `dv()` 与 `jl()`（hover-marquee 助手） | 中（首帧可能残留小字或空圆） | 补 `.hover-marquee__text` 规则；span 分支改为在 span 上铺肖像并把内联 `svg` 设 `opacity:0`（隐藏整个 span 会留下没有标记的表头）；chevron 给回 12px 而不是跟着归零 |
| 17 | **首次激活若触发主题 reload，品牌守卫根本不启动。** `activate()` 里 `if (!ensureTheme()) return () => {}` 在 `startBrandGuard()` 之前；`ensureTheme()` 换主题后会 `location.reload()` 并返回 false，而这一帧仍然会被绘制，标题与标签就留在旧值 | `services/cle-studio/src/main.js:32` | 中（首次安装的第一次会话） | 把 `startBrandGuard()` 提到 `ensureTheme()` 之前，reload 分支返回 `() => controller.abort()` 以正确回收 |
| 18 | **外链黑名单没有锚定域名结尾。** `openclaw\.ai` 会匹配 `openclaw.ai.example.com`，把无关链接当成上游推广隐藏掉——违反"不重写正常链接" | `core/brand.js` 的 `EXTERNAL` | 中（误伤用户内容） | 改为按完整主机名锚定 `(?:[/?#]|$)`；`github.com` 单独按 `github\.com/openclaw` 全路径前缀匹配 |

| 19 | **只改 `aria-label` 时标签实际不会被修。** observer 的 attributes 分支只置 `dirty=true` 然后 `continue`，而 `flush()` 只遍历队列里的节点——属性变更既没有 addedNode 也没有文本变更，队列是空的，`chromeScopeFor`/`sweepChrome` 根本没跑。会话切换时原生把 `OpenClaw · 工作区菜单` 写回来，标签就一直是旧的 | `core/brand.js` 的 MutationObserver 回调 | 高（本轮上一条修复的核心场景仍然失效） | attributes 记录也把 `r.target` 入队；队列仍是有界的（只有一个元素及其所属 chrome 块） |
| 20 | **`localTitle` 会把用户自己的会话名一起改掉。** 原来对整串跑 `replace(WORD)`：用户把会话命名为"关于OpenClaw的笔记"时，原生标题"关于OpenClaw的笔记 — OpenClaw"会被改成"关于C.le.的笔记 — C.le."，上下文被重命名 | `core/brand.js` 的 `localTitle` | 高（篡改用户内容） | 只重写原生填充产品名的位置：裸 `OpenClaw`/`OpenClaw Control`（启动标题）、`<context> — <brand>`（原生尾巴）、以及其后的 ` · <environment>`。上下文里出现该词不动，无原生尾巴的标题原样返回 |

| 21 | **首屏标题的窗口不在插件内，而在 plugin 之前。** 实机第一份 AX 是 `New session — OpenClaw`，插件加载后才变 C.le.；断线时更是一直保持 `(已断开连接) … — OpenClaw` 直到重连。原因是 `syncDocumentTitle()` 在 Lit 的 `updated()` 里、模块求值后立刻跑，而 `brand.js` 要等 `activate()`——这两段都在窗口之后；断线时插件卸载还会 `disconnect` 掉它的 observer | `control-ui-core-*` 的 `updated()` / `Uc()`；插件 `activate`/teardown | 高（用户第一眼就看到旧品牌，断线期间持续） | 先查了原生是否提供品牌入口：**没有**。`Uc()` 把产品名硬编码为 `${context} — OpenClaw`，`theme.branding` 只在插件主题渲染时下发给客户端，走不到这条路径。改用同源外部脚本 `/cle-early.js`（`script-src 'self'` 允许，未放宽 CSP）：以 classic script 放在 module 入口之前，解析期即执行；页面级存活，不受插件卸载影响 |
| 22 | **离线壳引用了早期脚本，但 worker 没预缓存它。** 只把 `<script>` 写进 `OFFLINE_BOOT.html` 的话，断线重载会向网络要一个不存在的文件，守护静默失效——恰好是最需要它的时刻 | `sw.js` 的 `precacheOfflineShell()`；它遍历 `OFFLINE_BOOT.assets` 并校验 `integrity` | 高（断线路径等于没修） | 把 `cle-early.js` 同时加入 `OFFLINE_BOOT.assets`（带真实 sha256 integrity）与 `publicAssets`，并按上游的**普通码点序**插入（不是 `localeCompare`，我一开始写错并用真实清单核对后改正） |

| 23 | **预缓存行只新增不更新，脚本改动后 integrity 是旧的。** 主控隔离复现：只在 donor 的 `early-guard.js` 追加一行注释（CSS/HTML 不变）再 apply，结果 `earlyGuard=patched` 但 `integrityMatchesBytes=false`、`cacheIdChanged=false`、`offlineShell=unchanged`。根因是 `boot.assets` 只做"不存在才添加"，没做 upsert；而 `boot.id` 只 hash `offline.html`，脚本改了 HTML 没改，缓存名不动 | `apply-startup.mjs` 的 SW 分支 | 高（脚本更新后 worker 仍取旧缓存，守护静默失效） | 行改为 **upsert**（字节变了就更新 integrity）；缓存代际改为 hash **文档 + 脚本字节**；id 仍是输入的确定性摘要——同内容再跑 `changed=false`，不靠随机 id 换新鲜度。`result.changed` 计入 `earlyGuard === 'patched'` |
| 24 | **缺早期脚本时先写了 index，再抛错。** donor 只有 `startup.css`、没有 `early-guard.js` 时，`index.html` 已被写入带 `data-cle-early` 的引用，随后才在缺源检查处抛错，留下指向不存在脚本的半部署页面（`missingSourceMutatedIndex=true`） | `apply-startup.mjs` 的写入顺序 | 高（半部署页面 = 404 + 标题窗口重新打开） | 改为**先规划后提交**：任何写入前先校验脚本源存在/非空/形状正确、三个图标 donor 存在且格式正确，并对 `index.html`、`cle-early.js`、`sw.js`、`manifest.webmanifest`、`asset-manifest.json` 全部过 `assertWritableTarget`（拒绝符号链接与越界）。被拒绝的目标同样在零写入下失败 |

| 25 | **登录页旧名只是被压成 0 号字，辅助功能树仍会念出来。** 用真实浏览器核对部署产物时发现：未登录卡片的 AX 快照第一条文本仍是 `OpenClaw`。`font-size:0` 只去掉字形，文本节点还在可访问性树里，读屏会照读——单测只比对 CSS 文本，看不到这一层 | `startup.css` 的 `.login-gate__brand-name` | 中（读屏用户仍听到旧品牌；视觉上已正确） | 改为 `display:none`，同时移出布局与 AX 树；品牌改由父级 `.login-gate__brand` 提供：`::before` 用已批准肖像、`::after` 用 `C.le.` 字标。**没有新造图形**，全表唯一 `url()` 仍是 `/cle/static/art/avatar.webp` |

| 26 | **插件一退役，产品侧栏的 aria-label 就回到旧名。** 实机断线时首份 AX 可见 `OpenClaw · 工作区菜单`。原因：`brand.js` 随插件退役，而原生按钮的 `aria-label` 由 `${name} · 工作区菜单` 拼成、name 在网关未应答时回落为产品名；退役后无人维护该属性 | `control-ui-boot-shared-*` 的 `dv()` / `renderContent()` | 高（断线是常用状态，用户会看到旧品牌） | 由**页面级** `early-guard.js` 接管（不随 `activate` 退役）：只处理侧栏 header/card 白名单，`localLabel()` 只替换前导产品名；`OpenClaw Notes · …` 这类用户自选名与第三方标签原样保留 |
| 27 | **首帧层的侧栏规则挂在 `html:not([data-cle])` 上，与"退役保留 data-cle"的新契约冲突。** 保留 `data-cle` 后这些规则在退役期不再生效；而 `rooms.css` 在 `[data-cle]` 下已隐藏原生 header 文本、把 mark 收成透明块，插件的 `.cle-brandmark` 又随 abort 消失——左上只剩空金圈 | `startup.css` 侧栏段 + `rooms.css:2-8` | 中高（退役/加载阶段没有可读品牌） | 规则改挂在回退状态标记 `data-cle-fallback` 上：两个 guard 在"仍显示产品回退名"时打标、拿到用户自选名时清除。这样品牌不依赖插件存活，且不会压掉用户命名（无条件规则会把名字也压平，这是陷阱）。另按主控契约 `html[data-cle]:not([data-cle-active])` 补退役态字标：`.sidebar-brand::before` 真实文本 `C.le.`（22px 墨色）、header 按钮补视觉隐藏的可访问名；活跃实例存在时两者都让位（实测均返回 `none`） |

| 28 | **冷启动时 chrome observer 根本没装上。** 脚本是 `<head>` 内同步 classic，执行时 parser 还没创建 `<body>`，`document.body` 为 `null`；而安装代码写成 `if (document.body) { observe(...) }` 且没有后续安装分支。于是冷启动只跑了一次空树的 `syncChromeLabels()`，此后整个 document 的 chrome 变化永远无人 observe——插件活着时被 `brand.js` 遮住，断线退役后立刻暴露 | `early-guard.js` 的安装段 | 高（首屏与退役两条路径都失效，且被在线状态掩盖） | 改为观察 **`documentElement`**（解析期一定存在），`rootNode = documentElement \|\| document.body` 兼容两种形状；记录按 chrome 相关性过滤后才调度，避免全树文本替换；补一次初始 pass 与 `DOMContentLoaded` pass（后者在 deferred module 之前，不漏首轮渲染），不依赖任何 sleep |
| 29 | **重渲染替换名字文本时，回退标记不会清除。** 真实语义下 `textContent =` 产生的是目标为名字槽本身的 childList 记录，而过滤逻辑只看 `addedNodes`，于是切到用户自选名后标记仍在、字标继续压住真名 | `early-guard.js` 的 `touchesChrome()` | 中（用户命名被覆盖） | 增加"记录目标本身就是名字槽"的分支；测试用 `textContent` 赋值走真实语义 |
| 30 | **测试桩无法表达真实 MutationRecord，掩盖了上面两类缺陷。** 早期桩没有 `attributeName` / `attributeFilter`，`textContent` 赋值也不产生记录，且默认 body 一定存在——所以"解析期无 body"与"属性单独更新"两条路径从来没被真正覆盖 | `tests/cle-early-guard.test.mjs` 的 DOM 桩 | 中（测试过度宽松） | 桩补齐 `attributeName`、`attributeFilter`、`textContent` 替换语义，并支持 `{withBody: false}` 与 `_appendBody()` 复现真实解析顺序 |

### 需要主控协调（超出本路所有权）### 需要主控协调（超出本路所有权）

| 问题 | 准确位置 | 触发条件 | 最小修法 |
|---|---|---|---|
| 插件静态路由在测试网关返回 404 | `GET /cle/static/startup/*`、`/cle/static/startup.css` 均 404，而 `/cle/static/art/avatar.webp` 200 | 网关服务的是插件**发布快照**（`~/.openclaw-cle/tmp/plugin-captures/...`），不是 `extensions/cle-studio/static` | 重新发布 cle-studio 插件（或把 `startup/` 与 `startup.css` 纳入发布清单）。本路已把文件放进扩展目录，但未重启/重配网关——按任务书不操作 live |
| build-id 累加超限 | `patch/lib-precompressed.mjs:128` | 安装器/`apply-all` 每运行一次 | 改为幂等：先归一化再写，见"自主发现 #13"；否则每次安装都会再加 13 字符，最终让网关判 stale 并重建整树 |
| 首帧层的安装入口 | `installer/macos/apply-theme.sh` 约 1500 行处已加非致命调用；`patch/apply-all.mjs` 末尾已加一条 | 全量安装 / 补丁演练 | macOS 已接；**Windows 安装器（`installer/windows/apply-theme.ps1`）未接，留给主控**。注意：以 App 内 runtime 为目标时该步会被路径保护拒绝（见第六节） |
| `sw.js` 的 `OFFLINE_BOOT` 与浏览器已注册的 service worker | 用户已装过旧 worker 的会话 | 首次部署本补丁后 | 首帧层的 `id` 变化会让 `CACHE_NAME` 改变，新 worker 安装后旧缓存按 `CONTROL_CACHE_LIMIT = 3` 自然淘汰；如需立刻生效可 `unregister` 一次，属验收动作，交主控 |

---

## 四、原能力对应（旧版能力 → 新版状态）

| 旧版能力 | 新版状态 | 说明 |
|---|---|---|
| 启动即品牌（标题、图标、底色） | **已恢复** | 原来靠安装期 `apply-theme.sh` 的 `perl` 改写 + 注入，新版插件化后缺少这一层；本补丁补回，并且不依赖运行时 |
| 启动不露推广/邀请 | **已恢复且更强** | 规则进入 HTML 首帧，不再等插件；同时覆盖登录页（插件触达不到） |
| 真实错误提示 | **保留** | `#openclaw-mount-fallback` 的全部文案、`Try again` / `Keep waiting`、排障链接原样；只换表面 |
| 欢迎身份区 | **保留并重建品牌** | 块不隐藏、不空白、不超时回退；头像换批准素材、名称呈 `C.le.`，插件接管后交还真实 agent 名 |
| 侧栏工作区标识（图像+文字） | **覆盖** | 图像用 `content:url()` 替换（不留空圆），文字在作用域内压字补字，chevron 保留 |
| 图标缓存正确性 | **修复** | 内容指纹 `?cle=` 让回访不再命中一年期 immutable 的旧图 |
| 加载状态 | **保留并换了皮** | 原生骨架屏继续工作，令牌改为纸白/墨黑；只在挂载点为空的窗口加一个 `C.le.` 字标 |
| 首次启动 / 刷新 / 热重载 / 五模式路由 | **覆盖** | 首帧层在所有路由的同一份文档上；`html:not([data-cle])` 让热重载回到正确基线；深路由由 SPA fallback 返回同一文档（已实测 `/`） |
| 双栏入口 | 未改 | 双栏是挂载后的布局，不属首帧；本路未触碰 |
| Claude 的开场美术 | **未动** | `src/splash/*` 与 `static/splash/*` 一字未改 |

---

## 五、自测（真实执行，非声称）

```
node --test tests/cle-startup.test.mjs        → 33 pass / 0 fail
node --test tests/<其余 38 个 .mjs>           → 全通过（chat-tool-timeline 的 7 项失败在 HEAD 上
                                                 复现，与本路改动无关：该测试不 import 任何本路文件）
node patch/apply-all.mjs --keep               → 17 patches, patches failed: 0
apply-startup 二次运行 → {"changed":false,…} （幂等）
apply-startup --revert  → 7 个文件字节级还原（干净副本上实测 true）
```

**真实包闭环（`/tmp` 副本，未碰 live）**

```
run1 changed: true  index: patched  offline: patched  icons: 0
title ok: true
build-id preserved: true          ← 未改，避免被判 stale 触发整树重建
icon token present: true
manifest untouched: true          ← 根文件不入清单
manifest still parses upstream rules: true
run2 changed: false               ← 幂等
offline shell branded: true  id moved: true
byte-exact restore on clean real package: true
```

**新旧实现对照（同一组故障，旧代码 vs 新代码）**

| 场景 | 旧实现 | 新实现 |
|---|---|---|
| 相对路径 `dist/control-ui` | `ACCEPTED (bug)` | `control-ui path must be absolute` |
| 符号链接 → `~/.openclaw` | `ACCEPTED (bug)` | `refusing the live ~/.openclaw profile` |
| `changed` 字段 | `ABSENT (bug)` | `true`，图标单独更新也计入 |
| twins 还原 | `NOT RESTORED (bug)` | `restored`（字节级） |
| 清单行 | 会为根文件写入（不可解析） | 不动清单 |

**真实网关 HTTP 实测（19789，只读请求）**

| URL | 状态 | 缓存策略 |
|---|---|---|
| `/favicon-32.png` | 200 | `no-cache` |
| `/favicon-32.png?v=<build-id>` | 200 | `public, max-age=31536000, immutable`（**旧图上会命中一年**） |
| `/favicon-32.png?cle=<token>` | 200 | `no-cache` ← 首帧改用这个 |

计算属性核验（对真实包跑补丁后读回 `index.html`）：

| 检查 | 结果 |
|---|---|
| 首帧层位置 | 在 core 样式表之后（10240 < 16037）、`</head>` 之前（16507） |
| 令牌作用域 | 含 `html:not([data-cle])` |
| 旧品牌超时回退 | 已移除（无 `cle-brand-return`） |
| 欢迎头像 | 指向 `avatar.webp` |
| 侧栏文字标识 | 有 `sidebar-agent-card__name-text::after` |
| 失败面板 | 从未 `display:none` |
| `<head>` 区域旧品牌字样 | 无（仅错误面板正文保留上游产品名，属必须保留的真实错误说明） |

补丁执行后 `data-openclaw-control-ui-build-id` 保持原值（`…829c0937…` 64 位十六进制后缀完整）。

### 品牌守卫（本轮扩展所有权：`services/cle-studio/src/core/brand.js`）

```
node --test tests/cle-brand-guard.test.mjs   → 16 pass / 0 fail
同一套测试在 HEAD 的旧实现上            → 16 fail / 0 fail pass（证明用例真的抓得住缺陷）
node --test tests/cle-startup.test.mjs       → 34 pass / 0 fail
node patch/apply-all.mjs --keep              → 17 patches, patches failed: 0
```

守卫的边界与代价（都有对应用例）：

| 约束 | 做法 | 验证 |
|---|---|---|
| 即时性 | 微任务调度，不依赖 `requestIdleCallback`；`syncTitle()` 每批次都跑 | 「written after activation is corrected on the next microtask batch」 |
| 覆盖 `<head>` | 单独观察 `<title>`（childList + characterData）与 `<head>` childList | 「the environment suffix appended to the title is corrected too」 |
| 不整页扫描 | 批次只重读该变更所属的侧栏块 + 该节点子树，`<body>` 上零次 `querySelectorAll` | 「does not scan the whole body…」「a batch only re-reads the chrome block it belongs to」 |
| 卸载回收 | `AbortSignal` → `disconnect()` + 丢弃队列 | 「stops observing once the plugin unloads」「drops queued work」 |
| 不碰用户内容 | `.chat-group/.chat-text/pre/code/textarea/[contenteditable]/.monaco-editor` 等一律跳过 | 「message bodies, code and documents are never rewritten」 |
| 不碰用户自选名 | 只替换前导产品名，`OpenClaw Notes` 保留 | 「a user-chosen agent name is never rewritten」 |
| 不误伤链接 | 主机名完整锚定 | 「promotion links are matched by full host」 |

CSS 侧栏选择器已对照 core 实际 DOM 重写（发现 #16）：名字是
`span.sidebar-agent-card__name-text.hover-marquee > span.hover-marquee__text`，
mark 是 `img` / `span--neutral > svg` 两个分支，测试直接断言这两条规则存在且只引用
`/cle/static/art/avatar.webp`（无新造图形）。真实包注入后实测四个探针全部命中。

### 早期标题守护（本轮新增：`services/cle-studio/static/early-guard.js`）

```
node --test tests/cle-early-guard.test.mjs   → 12 pass / 0 fail
node --test tests/cle-brand-guard.test.mjs   → 21 pass / 0 fail
node --test tests/cle-startup.test.mjs       → 42 pass / 0 fail
node --test tests/brand-ui.test.cjs          →  6 pass / 0 fail
合计 81 项（前轮 55 项全部保留且通过）
node patch/apply-all.mjs --keep              → 17 patches, patches failed: 0
```

真实浏览器实测（fixture server，无网关；用 `app_browser` 读回 AX 与 `document.title`）：

| 写入的原始标题 | 实测结果 |
|---|---|
| `New session — OpenClaw` | `New session — C.le.` |
| `(已断开连接) Codex独立验收·右栏状态 — OpenClaw` | `(已断开连接) Codex独立验收·右栏状态 — C.le.` |
| `关于OpenClaw的笔记 — OpenClaw` | `关于OpenClaw的笔记 — C.le.` |
| `Codex独立验收·右栏状态 — OpenClaw · Production` | `Codex独立验收·右栏状态 — C.le. · Production` |
| 重复加载 `/cle-early.js` 后再写 `New session — OpenClaw` | `New session — C.le.`（未因双 observer 出错） |

同时确认原生错误面板（`#openclaw-mount-fallback`，真实文案 "无法连接到 Gateway"）全程可见，
没有被任何覆盖层挡住——没有用隐藏页面来伪造成功。

**为什么不是"在插件里更早 mount"**：`activate()` 要等 bundle 求值后才跑，而断线时插件卸载会
断掉它的 observer；观察到的断线场景需要页面级的所有者。插件内的 guard 仍负责侧栏标签与内容清扫。

### 重复部署闭环（本轮修正，响应第五轮复现）

```
node --test tests/cle-startup.test.mjs     → 48 pass / 0 fail
node --test tests/cle-early-guard.test.mjs → 12 pass / 0 fail
node --test tests/cle-brand-guard.test.mjs → 21 pass / 0 fail
node --test tests/brand-ui.test.cjs        →  6 pass / 0 fail
合计 87 项
```

隔离复现结果（用主控同一套 fixture 形状，`/tmp` 临时目录，未写 19789/App/live）：

| 场景 | 修正前 | 修正后 |
|---|---|---|
| donor 只追加一行注释再 apply | `integrityMatchesBytes=false`、`cacheIdChanged=false`、`offlineShell=unchanged` | `true` / `true` / `patched`，且 `rowCount=1`（upsert 不追加） |
| 相同内容再 apply（第三次） | — | `changed=false`、`early=unchanged`、`offline=unchanged`（id 不变） |
| donor 缺 `early-guard.js` | `missingSourceMutatedIndex=true` | `false`，且 `indexHasEarlyRef=false`，连备份目录都不建 |
| 图标目标为越界符号链接 | 会先写 index | 抛错，`index.html` 字节不变，链接目标未被写入 |

新增 6 项回归，其中 **4 项在 07ce6e9 上失败**（existing row upsert、脚本-only 代际移动、
缺源零写入、越界目标零写入），说明它们锚定缺陷而非复述实现；另 2 项覆盖既有正确性
（同内容幂等、twin/ledger 闭环）。

真实包副本另测：首次 patch → 二次 `changed=false` → 预缓存 integrity 与落盘字节一致 →
`--revert` 八个文件逐字节还原。全链 `apply-all`：17 补丁 0 失败。

### 浏览器实测（本轮，fixture server + 真实浏览器）

用打过补丁的真实包起 fixture（无网关），用侧栏浏览器打开并读回 AX 与计算样式：

| 检查 | 结果 |
|---|---|
| `document.title` | `C.le.` |
| 首份 AX 文本开头 | 真实错误正文「无法连接到 Gateway…」，**不再以 OpenClaw 开头** |
| 可见且含 `OpenClaw` 的文本节点 | 0 个 |
| `.login-gate__brand-name` 的 `display` | `none`（同时移出 AX 树） |
| `.login-gate__brand::after` | `"C.le."`，13px |
| 原生错误面板 | 仍可见，文案与按钮原样保留 |

这一轮发现的 #25 正是靠"真的打开页面看一遍"才暴露——字节级断言与单测都通过，但读屏文本是
另一层。

### 生命周期边界（本轮：插件退役后品牌仍成立）

浏览器实测（fixture server + 真实 DOM/CSS，按主控 b317524 的标记契约）：

| 状态 | 观察结果 |
|---|---|
| 退役（保留 `data-cle`、移除 `data-cle-active`） | `.sidebar-brand::before` = `"C.le."`，22px，`rgb(21,22,26)`，渲染 744×40 |
| 同上，header 按钮 | `::after` = `"C.le."`，视觉隐藏（`clip-path: inset(50%)`），仍在 AX 树 |
| 活跃（`data-cle-active=1` + 插件 `.cle-brandmark` 存在） | 两个 fallback 均返回 `none`（完全让位） |

标签生命周期（真实 DOM 观察）：

| 阶段 | `aria-label` | 名字槽 |
|---|---|---|
| 首帧 | `C.le. · 工作区菜单` | 标记回退，显示 `C.le.` 字标 |
| 退役后原生恢复旧标签 | `C.le. · 工作区菜单`（守卫仍在） | 仍标记 |
| 重连、网关给出用户自选名 | `碧琪的工作区 · 工作区菜单` | 标记清除，14px，无字标 |
| 二次断线回落 | `C.le. · 工作区菜单` | 重新标记并显示字标 |

**所有权**：未改 `rooms.css`、`composer.css`、`main.js`、Launcher、recovery 模块与 Claude 美术。
本轮为本地验证临时改过 `composer.css`，交付前已 `git checkout` 撤回，未进入任何提交；
生成的 `openclaw.plugin.json` 同样保持在 pre-build 状态。

### 解析时序（本轮：`<body>` 尚不存在时就要生效）

本轮先用**真实发布形状**复现再修：脚本在 `<head>` 内同步执行时 `document.body === null`。

| 检查 | 修正前 | 修正后 |
|---|---|---|
| observer 挂载点 | 无（`if (document.body)` 直接跳过） | `documentElement`（解析期存在） |
| 冷启动首个 aria | 不修 | 修（`C.le. · 工作区菜单`） |
| 插件从未激活 / 退役后属性更新 | 不修 | 修 |
| 消息文本 / 第三方标签 | — | 不动（白名单过滤，无全树文本替换） |
| 5 次无关插入触发的 chrome pass | — | 0 |
| `DOMContentLoaded` pass | — | 存在且不重复改写，早于 deferred module |

浏览器实测（fixture，guard version 3）：加载后插入侧栏 → 标签变 `C.le. · 工作区菜单`、标记
`data-cle-fallback`、字形 0px；退役后原生恢复旧标签 → 再次被修正；重连给出 `碧琪的工作区` →
标签保留该名、14px、无字标。

新增 5 项行为测试，其中 **3 项在 5528c47 上失败**（observer 未挂载、冷启动退役不守、
`DOMContentLoaded` pass 缺失）。测试桩同步补齐真实 `MutationRecord` 语义——此前桩无法表达
"仅属性变更"的记录，正是这类缺陷被放过的原因。

## 六、部署范围与限制（必须明确）

**本路的目标只有 19789 staging（`dev/cle-stage`），不是全平台交付。**

1. **macOS 安装器调用会被 App 路径保护拒绝。** `installer/macos/apply-theme.sh` 会以
   `OPENCLAW_ROOT` 指向 App 内 runtime（`/Applications/超級碧琪.app/…/runtime/openclaw`）运行本补丁，
   而 `refuseReason` 明确拒绝该路径，因此这一段会失败并打印
   `warning: first-paint startup layer skipped`。**这是有意保留的保护，我没有放宽它，也没有写入
   live。** 安装脚本对该步用的是非致命分支（`if ! … then echo warning`），所以其余补丁流程不会因此中断；
   但首帧层在 App 目标上**不会生效**。要在 App 内生效，需要主控决定是另设受控目标，还是显式授权某条
   白名单路径——本路不擅自改这条边界。
2. **Windows 安装器未接调用。** `installer/windows/apply-theme.ps1` 需要照抄 macOS 那段非致命调用；
   属主控归属，**因此不能声称全平台交付**。
3. **插件静态路由 404 未在本路解决**（见协调表）。图标已改为物理替换 + `?cle=` 指纹，不依赖该路由。

## 七、未验证 / 剩余风险

1. **没有做首帧录帧或像素验收。** 我是文本模型，按任务书不声称看过画面。以上结论来自 HTTP 响应字节、
   DOM 属性、计算样式与真实包上的补丁运行结果；"第一帧有没有闪"需主控在自己的完整备份上实测。
2. **`?cle=` 的浏览器侧效果未在真实浏览器里跑过**：服务端行为已实测（200 + `no-cache`），但"旧缓存
   是否真的被绕过"需要一次带既有缓存的浏览器会话验证。
3. **service worker 换代时序**未在真实浏览器跑过（会改动我无权操作的 live 状态）。
4. **失败面板深色对比度与窄屏（<560px）字距**未逐项实测。
5. **`favicon.svg` 内嵌 `/cle/static/art/avatar.webp`** 在部分 WebKit 版本可能被禁用，届时退回深色底 +
   金环的矢量标记（保证非空白）。目标版本未实测。
6. **`chat-tool-timeline.test.mjs` 的 7 项失败**在 HEAD 上原样复现（我用 `git archive HEAD` 到干净目录专门
   复核过），与本路改动无关，未在本路修复。

## 八、提交

```
分支 repair/startup
新增  services/cle-studio/scripts/apply-startup.mjs
新增  services/cle-studio/scripts/serve-startup-fixture.mjs
新增  services/cle-studio/static/startup.css
新增  services/cle-studio/static/startup/{icon-32,icon-180,icon-256}.png, favicon.svg
新增  patch/apply-startup.mjs
修改  patch/apply-all.mjs          （补丁顺序末尾加一条）
修改  installer/macos/apply-theme.sh（非致命调用段）
新增  tests/cle-startup.test.mjs   （33 tests）
新增  docs/redesign/REPAIR-STARTUP.md

补充 commit（本轮，响应主控五项）：
  services/cle-studio/scripts/apply-startup.mjs  绝对路径/realpath 校验、写入目标守卫、
                                                  ledger 化备份+首次优先、twins/manifest 闭环、
                                                  图标联动 refreshTwins、changed 统计、?cle= 指纹
  patch/apply-startup.mjs                        不再预先 path.resolve；拒绝符号链接候选根；透传 changed
  services/cle-studio/static/startup.css         欢迎身份原地重建品牌（去掉 11s 回退）、侧栏文字标识、
                                                 注释去掉旧品牌字样
  tests/cle-startup.test.mjs                     33 项（含 symlink 拒绝、twins+清单还原、
                                                 图标单独更新、备份不覆盖、身份/文字标识策略）
```

补充 commit（本轮，运行时字标与侧栏所有权扩展）：

```
services/cle-studio/src/core/brand.js   观察 head/title、每批次同步标题、微任务调度、
                                        sweepChrome 覆盖 aria-label、只替换前导产品名、
                                        外链主机名完整锚定、abort 回收
services/cle-studio/src/main.js         品牌守卫提到 ensureTheme() 之前（首次激活 reload 也生效）
services/cle-studio/static/startup.css  按真实 DOM 补 hover-marquee__text 与 mark--neutral 分支
tests/cle-brand-guard.test.mjs          新增 16 项（专用回归，含旧实现反向验证）
tests/cle-startup.test.mjs              34 项（新增"选择器对照真实 DOM"一节）
```

未验证项（不虚构）：

- **第一份 AX 的实际取值**需要主控在新开页面上读一次；本轮只验证了「原生写入后同一批次内被改写」的
  时序与语义，微任务在绘制前完成是基于任务队列语义的推断，没有在真实 WebKit 上录帧。
- **拆分开场 `learning — OpenClaw`** 同样走 `syncDocumentTitle()`，理论上已被同一路径覆盖，
  但没有对拆分路由单独做端到端观察。
- 守卫的 `sweep()` 仍保留既有行为：命中黑名单的推广链接会被移除 `href`；黑名单现已锚定，
  但「哪些链接算推广」是产品判断，未扩大范围。

补充 commit #2（6480642，响应主控两处代码缺口）：

```
services/cle-studio/src/core/brand.js   attributes 记录把 r.target 入队（只改 aria-label 也能修）；
                                       localTitle 只重写原生品牌位置，保留会话上下文中的用户字样
tests/cle-brand-guard.test.mjs         21 项（+4：属性-only 修复、非 chrome 属性忽略、
                                       标题上下文保留表 13 例、真实会话名端到端）
```

两处缺陷都用"退回旧逻辑"验证过：在临时副本里分别还原 attributes 分支与旧 `localTitle`，
新增用例均失败，说明用例锚定的是缺陷而不是实现。

`openclaw.plugin.json` 保持 bc1ed9c 的取值：打包产物由主控最终 build 生成，
不在每次源提交里带 dist 引用。`main.js` 的挂载列表与 bc1ed9c 逐项一致
（12 个 `safe()` 调用，已 diff 核对），只调整了 guard 的注册位置。

首帧视觉仍由主控验，本路不声称已通过视觉验收。

补充 commit #3（07ce6e9，首屏标题时序）：

```
services/cle-studio/static/early-guard.js   新增：同源 classic 脚本，解析期接管标题
services/cle-studio/scripts/apply-startup.mjs
    注入 <script data-cle-early> 于 module 入口之前；写入 cle-early.js 到服务根；
    离线壳同步注入；OFFLINE_BOOT.assets 增加带 integrity 的预缓存行 + publicAssets；
    备份/回滚/twins/changed 一并纳入
tests/cle-early-guard.test.mjs              新增 12 项
tests/cle-startup.test.mjs                  42 项（+3 注入顺序/预缓存/幂等）
```

未验证项（不虚构）：

- 主控 19789 的实际首份 AX 仍需实测；本轮在 fixture server + 真实浏览器里验证了标题规则与
  observer 生命周期，但没有在网关真实断线场景下录帧。
- 断线期间的重载路径依赖 SW 预缓存，已按上游 `assets` + `integrity` 结构写入并在本地校验
  hash 正确；真实 worker 的预缓存成功与否需要一次实际断线重载确认。
- service worker 换代时序（`OFFLINE_BOOT.id` 变化 → 新 worker 安装）仍未在真实浏览器跑过。
- **首帧视觉与首份 AX 仍需主控在 19789 用网关 + CUA 实测。** 本轮所有结论来自 fixture、真实包
  副本、单测与本地浏览器；`install()` 之后浏览器是否真的先显示 C.le.，本路不声称已验证。
- **主控报告的一次 CUA `tab` 元数据瞬时记录 `New session — OpenClaw`**：同次首份 AX 已是
  `New session — C.le.`，后续标题全部正确。该记录来自标签页元数据的一次抓取，不是可见帧证据；
  按现有证据**判断不需要为此再加修补**（早期脚本已在 module 之前接管标题），但记为待观察项：
  若后续出现可见帧级别的时间戳证据，再评估是否需要在 `document.title` 之外补偿。本轮不声称
  已看渲染帧。
- **退役态 composer 排版**属 layout 会话（`.agent-chat__composer-shell` 重锚定）。本路为本地
  验证临时改过 `composer.css`，已撤回、未提交；如需生产差异由 layout 合入。

补充 commit #4（3ac6479，重复部署闭环）：

```
services/cle-studio/scripts/apply-startup.mjs
    预缓存行 upsert（字节变则 integrity 变）；缓存代际 = hash(文档 + 脚本字节)；
    changed 计入早期脚本；所有输入与写入目标在首次写入前完成校验
tests/cle-startup.test.mjs   48 项（+6：upsert / 脚本-only 代际 / 同内容幂等 /
                             缺源零写入 / 越界目标零写入 / twin-ledger）
```

补充 commit #5（76f910d，登录页可访问性）：

```
services/cle-studio/static/startup.css   .login-gate__brand-name 改 display:none；
                                         品牌由父级 ::before（批准肖像）+ ::after（C.le.）提供
tests/cle-startup.test.mjs               49 项（+1：登录页规则不得再用纯像素隐藏）
```

补充 commit #6（5528c47，插件退役后的品牌生命周期）：

```
services/cle-studio/static/early-guard.js   新增侧栏 chrome 标签接管（页面级，不随 activate 退役）
services/cle-studio/src/core/brand.js       localLabel 与 guard 对齐；维护 data-cle-fallback 标记
services/cle-studio/static/startup.css      字标规则改挂 data-cle-fallback；按 data-cle-active 补退役态 fallback
tests/cle-early-guard.test.mjs              19 项（+7：首帧标签 / 退役恢复 / 属性-only /
                                           回退标记跟随 / 用户命名 / 两实现一致 / 正文与第三方不动）
tests/cle-startup.test.mjs                  52 项（+3：退役 fallback 契约与 :has() 约束）
```

补充 commit #7（0007a46，解析时序）：

```
services/cle-studio/static/early-guard.js   观察 documentElement；记录按 chrome 相关性过滤；
                                            补初始/DOMContentLoaded pass；头部说明更新为 v3 职责
services/cle-studio/static/startup.css      顶部注释改为三层生命周期（含退役层与 active 契约）
tests/cle-early-guard.test.mjs              24 项（+5：无 body 冷启动、退役后仍守、
                                            正文不动、无关插入零 pass、DOMContentLoaded 不重复）
```
