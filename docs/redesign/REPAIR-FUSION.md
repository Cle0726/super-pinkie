# FUSION 修复报告：移植功能的整体衔接

分支 `repair/fusion`，worktree `/Users/Admin/release-superpinkie/wt/repair-fusion`。
模型：DeepSeek V4.1 Flash · WB。角色：Li An（他）／五模式雅叙·营造·堇思·习作·挥洒。

## 一句话结论

功能面板（记忆／空间／演示／用量／定时任务／连接器）的入口、骨架、状态反馈和卡片表面
已经在**组件层**统一到纸白／墨黑／暖金＋冰蓝焦点；演示工具保留全部工具、快捷键、撤销与
画笔颜色参数，只重做界面接缝。`brand.js` 之后仍有三处 chrome 品牌残留（`ClawHub`、
`aria-label`/`title` 里的 `OpenClaw`），已定位并给出修法，属于 `src/core/brand.js`
（主控所有），未擅自修改。

---

## 问题 → 修改 → 自测

### 1. 功能入口是一个文字胶囊，挤在原生图标条里

原实现（`src/legacy/utilities.js`，HEAD `3108e3a`）生成
`button.cle-utilities-entry`，文字为「功能」，11px 字体、自带边框与纸面底色，
挂在 `.sidebar-footer-bar` 里和 30×30 的原生图标并排。

改为复用原生类名 `sidebar-footer-icon`，30×30 命中区、16px 线性 SVG、透明底，
按下态用 `--cle-gaze-soft`。**实测**（headless Chrome，计算样式）：

```
ENTRY size 30x30 native 30x30
ENTRY aligns yes heightMatch yes
ENTRY color rgb(92, 90, 87)  ← --cle-ink-2
ENTRY pinkish no
ENTRY text ""                ← 不再有文字占位
```

### 2. 面板骨架、分组、状态反馈在旧样式里没有对应规则

旧 `bridge.css` 只覆盖了 `#cle-utilities`、`.cle-utilities__head/__close/__memory/__usage`，
新结构里的 `.cle-utilities__titles`、`__sub`、`__status`、`__group`、`__group-title`、
`__hint`、`__actions`、`__action`、`__row`、`__row-copy`、`__glyph` 全部没有样式，
实际渲染是浏览器默认按钮＋默认字号。

按新结构补齐作用域规则（全部走 token），并把**唯一的异步反馈出口**定为
`.cle-utilities__status`（`role=status` + `aria-live=polite`），取代原来「把按钮文字
改成『演示工具正在加载』」的做法——那种做法会永久破坏按钮文案。

### 3. 异步移植模块缺席时是静默空白

被移植模块是经典脚本、顺序加载（`src/legacy/loader.js`），面板可能先于它们出现。
原来 `open()` 里 `window.__pinkieCapabilities?.mount(cards)` 一次不成功就再无第二次，
`__laolaoLaser?.toggle` 缺失时只改文字、`__clekkMemoryUI?.open` 缺失时什么都不发生——
用户看到的是「点了没反应」。

现在三条路径都有节流重试＋可读降级，且**不伪造成功**：

| 依赖 | 缺席时 |
|---|---|
| `__pinkieCapabilities` | 10 次 × 400ms 重试；仍未到则「定时任务和连接器没能加载，关掉这个面板再打开试一次。」 |
| `__laolaoUsage` | 同上；失败文案「统计源暂时读不到，先不显示数字。」 |
| `__clekkMemoryUI` | 「记忆匣还没准备好，稍等一下再试。」，面板保持打开（不吞掉这次点击） |
| `__laolaoLaser` | 保持按钮文案，短暂禁用防连点，提示「演示工具还在加载」 |

### 4. 空间入口的降级没有说明

`#pinkie-party-entry` 的原生桥是 `webkit.messageHandlers.laolaoParty`，网页环境没有。
原来只是「如果没有桥就让它当普通链接」，用户不知道会新开标签页、也不知道为什么可能打不开。

现在入口带 `data-native` 标记（0/1），无桥时标题写明「在新标签页打开，需要 App 内置服务
正在运行」，并整组给一句环境说明；有点击时的状态提示。**实测**：

```
PARTY present native=0 target=_blank
PARTY bg rgb(244, 239, 228) pinkish no
```

### 5. 演示工具的界面还是粉色玻璃

`laolao-laser-pointer.js` 用内联 `<style>` 写死了 `#f067a4 → #d13a7d` 渐变、
`rgba(255,250,253,.96)` 背景、粉色描边。这是模块自己的样式，`presentation.css` 原本
只覆盖了 `#pinkie-laser-entry` 和外壳，没有覆盖工具条按钮、提示条和设置面板。

重写 `presentation.css`，覆盖：入口按下态、左缘工具条、底部提示、设置面板表面、
`h4/h5/label/output`、滑块轨道与滑块头、色板边框与选中环、焦点环、夜间、reduced-motion。
**关键点：色板预设色不改**——它是写进 canvas 描边的功能参数。**实测**：

```
LASER entry size 30x30 color rgb(92, 90, 87) pinkish no
LASER settings bg rgb(251, 248, 241) color rgb(21, 22, 26) contrast 17.05 pinkish no
LASER output bg rgb(244, 239, 228) color rgb(21, 22, 26) contrast 15.77
LASER swatch bg rgb(224, 64, 127) border rgb(251, 248, 241) preservesPreset yes
LASER range accent #2A63E8
```

其中 `accent #2A63E8` 是关键：滑块填充与读数徽标引用 `--accent`，默认值 `#e94f91`
会让整块在改完外框后仍然回到粉色。设置面板上显式把 `--accent` 指向 `--cle-gaze`。

工具行为未动，并新增**真实行为测试**（`tests/cle-presentation-behaviour.test.mjs`，
vm + DOM/Canvas 桩）：1-5 切工具、`⌘Z` 撤销、输入框内不劫持撤销、`Esc` 退出后画布与工具条
都被移除、footer 入口按下态与引擎状态一致。

### 6. 记忆匣：桥接把主次按钮压成同一张纸

`bridge.css` 原有
`html[data-cle] :is(.laolao-memory-button, …) { background: var(--cle-paper); … }`
同时命中 `.laolao-memory-button--primary`，导致「保存记忆」「＋新增」和「取消」外观完全
相同，主次层级丢失。**实测发现**（主按钮 `bg rgb(244,239,228)`、`bgImage none`）。

修法：用 `.laolao-memory-button.laolao-memory-button--primary`（双类，特异性更高）
恢复墨底纸字；`--danger` 保留红色语义；输入框焦点环统一到冰蓝；遮罩从粉色玻璃改成中性
`--pk-scrim`。**实测**：

```
MEMORY panel present
MEMORY bg rgb(251, 248, 241) color rgb(21, 22, 26) contrast 17.05 pinkish no
MEMORY primary color rgb(244, 239, 228) bg rgb(21, 22, 26) contrast 15.77
MEMORY search contrast 15.77
```

### 7. 分组小标题在纸面上只有 2.81:1（本轮浏览器实测发现）

`.cle-utilities__group-title` 我最初用了 `--cle-ink-3`（`#9A958B`），headless 实测
`contrast 2.81`，低于 4.5:1。改用 `--cle-ink-2` 后 `6.48`。这条是**先测出来再改**的，
不是凭感觉调色。

### 8. 重新打开面板看到的是上一次的数据

`laolao-capabilities.js` 的两个面板内部都有 `loaded` 闸门，`mount()` 第二次进来直接
返回。原来 `utilities.js` 只在第一次打开时挂载，所以关掉再开，定时任务的状态、下次运行
时间、连接器测试结果全都停在旧值。

现在每次打开都清空卡片容器再挂载（`cards.replaceChildren()` + `mount`），并补测试
「重新打开面板会重建卡片容器」。这是**在我不修改对方文件的前提下**能修的正确层级：
容器生命周期归编排层，数据读取归模块。

### 9. 重复激活会留下第二个入口

插件热重载会让 `activate` 再跑一次，而原生 Lit 重渲染不会带走外来节点。
`mountUtilities` 现在先摘掉同名的孤儿入口与层，测试覆盖「重复挂载只有一入口/一层」。

---

## 自主发现（含跨所有权）

### 已在我范围内修好

| # | 位置 | 触发条件 | 问题依据 | 修复 | 验证 |
|---|---|---|---|---|---|
| 1 | `.cle-utilities__group-title` | 打开功能面板 | 实测对比度 2.81:1 < 4.5:1 | 改用 `--cle-ink-2` | 实测 6.48:1 |
| 2 | `.cle-utilities__action:disabled` | 演示工具未就绪 | `--cle-ink-3` + 禁用态双重压暗，几乎不可读 | 改 `--cle-ink-2` + `opacity:.7` | 实测通过 |
| 3 | `.laolao-memory-button--primary` | 打开记忆匣 | 桥接选择器把主/次按钮压平，实测 `bgImage none` | 双类选择器恢复墨底 | 实测 15.77:1 |
| 4 | 功能面板重开 | 关闭再打开 | 卡片 `loaded` 闸门导致数据陈旧 | 打开时重建容器 | 行为测试 + 实测 |
| 5 | `.pk-cap__idea` | 定时任务空状态 | 虚线框 `rgba(217,81,141,.38)` 仍是粉色 | 改 `--cle-line-strong` / 悬停 `--cle-gaze` | 实测 `pinkish no` |
| 6 | `.pk-tile--files/--custom` | 连接器列表 | 橙紫渐变与纸墨金体系冲突 | 收到纸面+描边；GitHub/Notion 品牌色保留 | 实测品牌渐变完整 |
| 7 | `.pk-cap__confirm` / `.pk-job__history` | 删除确认、历史记录 | 粉色警告块与绿色成功字直接取自旧皮肤 | 映射到 `--cle-danger` / `--cle-ok` | 配色对 5.58/5.78:1 |
| 8 | `#cle-utilities` 语义色 | 深浅主题 | 只有装饰色，没有状态色 | 新增 `--cle-ok/--cle-danger/--cle-warn`，两套主题 | 测试断言两套都存在 |
| 9 | `.laolao-memory-layer` | 打开记忆匣 | 粉色半透明遮罩 + blur，压不住底下的内容层次 | 改 `--pk-scrim`、去 blur | 实测面板对比 17.05:1 |

### 交给主控（我不能改的文件）

| # | 文件 / 选择器 | 触发路径 | 依据 | 最小修法 |
|---|---|---|---|---|
| A | `src/core/brand.js` `WORD = /OpenClaw(?:\s+Control)?/g` | 任意页面加载 | 只替换 `OpenClaw`，`ClawHub`、`clawhub.ai` 原样留在技能来源、工具提示里。实测：设置页技能卡片显示「来源 ClawHub · 从 clawhub.ai 安装」 | 在 `WORD` 之外加一条 `ClawHub` → `C.le.` 的替换（仅 chrome，`CONTENT` 保护区不变） |
| B | `src/core/brand.js` `sweep()` 只走文本节点 | 同上 | `aria-label="OpenClaw"`、`title="OpenClaw docs"`、`alt="OpenClaw"` 都不在文本节点里。实测：`TOPBAR-BRAND aria="OpenClaw"`、`SIDEBAR-NATIVE-BRAND alt="OpenClaw"`、`LOGIN-LOGO alt="OpenClaw"`、`TOOLTIP aria="OpenClaw 文档"` | 在 `sweep()` 里加一段：对 `[aria-label],[title],[alt],[placeholder]` 属性做同一个 `WORD` 替换（跳过 `CONTENT` 子树） |
| C | `src/core/brand.js` `sweep()` 只处理 `a[href]` | 首屏 / 配置页 | 原生 docs 图标是 `a[href="https://docs.openclaw.ai"]`，靠 `EXTERNAL` 命中后 `hidden=true`；实测该节点确实消失，但**没有文案解释**，用户会以为功能丢了 | 若希望保留入口，改成重写 `href`/`aria-label`；若确认不要，维持隐藏但在报告里写明这是主动移除 |
| D | `.sidebar-native-brand`（原生模板，无插件规则） | macOS 原生窗口 | `alt="OpenClaw"` 且 `display:inline`，图标仍是 `favicon.svg`（小龙虾） | 加 `html[data-cle] .sidebar-native-brand { content: url('/cle/static/art/avatar.webp'); }`（与 `.chat-avatar.assistant` 同法），并把 `alt` 交给 B 处理 |
| E | `static/legacy/laolao-settings-user.css`（`oc/restyle`） | 与 `oc/restyle` 合并后 | 合并版把 `--pinkie-settings-muted` 写成 `#886b7c`：纸面 4.12:1、墨面 3.85:1；`--pinkie-settings-card: var(--cle-ink)` 会让卡片变成墨块（当前被我的 `html[data-cle] #cle-utilities` 更高特异性挡住） | `--pinkie-settings-muted: var(--cle-ink-2)`；`--pinkie-settings-card: var(--cle-surface)`；`--pinkie-settings-soft: var(--cle-gaze-soft)` |
| F | `static/legacy/laolao-settings-user.css` `#cle-utilities { position: fixed; bottom: 0; z-index: 8 }` | 合并后 | 与 `bridge.css` 的面板定位冲突，靠特异性才没出事 | 删掉该块里的 `position/right/bottom/z-index`，位置交给 `bridge.css` |
| G | `static/legacy/laolao-capabilities.js:113,339` | 打开功能面板 | 卡片标题用 `⏰`、`🔌` emoji 充当图标 | 换成内联 SVG（同 `src/legacy/utilities.js` 的 `ICONS`），或给 `card()` 增加 `iconSvg` 参数 |
| H | `static/legacy/laolao-desensitize.js:97,102,154,164` | 打开脱敏弹层 | `⚡ 改写`、`✓ 填入输入框`、`✅ 已填入输入框` 用 emoji/符号当控件文字 | 换 SVG 或去掉符号，保留文字 |
| I | `static/legacy/laolao-link-viewer.js:161,217,223` | 打开链接预览 | `🌐` 兜底图标、`✓ 已复制` | 同上 |
| J | `static/legacy/laolao-material-preview.js:361,372,616` | 打开素材预览 | `⛶`/`↙`/`▧▷♫▤⌘≡` 用 Unicode 拼图当文件类型图标 | 换 codicons（`laolao-vendor-codicons` 已随包） |
| K | `static/legacy/laolao-learning-stage.css` 等 | 习作模式 | 仍有 153 处粉色/紫罗兰字面量（最大单文件） | 归 `oc/restyle` 继续清扫；本路不跨改 |
| L | `services/cle-studio/src/process/effects.css:151-159` | 运行中 | `html[data-cle-live]` 把 `.chat-workspace-rail` 压到 `opacity:.6`——空间入口站在该栏里，运行时会变淡 | 若要保留空间入口的可读性，把 rail 里的入口排除在退让之外（`:not(:has(#pinkie-party-entry))` 或单独提亮） |

> A/B/D 三项合起来就是「`brand.js` 排除聊天正文之后的其它 chrome 品牌残留」的完整答案：
> 文本节点已覆盖，属性与 `ClawHub` 未覆盖，原生侧栏 logo 图片根本不是文本。

---

## 载入顺序与作用域

`main.js` 的顺序未改（本路不允许改）：

```
tokens.css → shell.css → rooms.css → composer.css → bridge.css
→ status.css → study.css → tiers.css → line.css
```

`presentation.css` 由 `src/legacy/modules.js` 里 `{id:'presentation'}` 在
`loadLegacy()` 时以 `<link>` 追加到 `<head>` 末尾，因此在 `bridge.css` 之后生效；
两者都限定 `html[data-cle]:not(#p1):not(#p2):not(#p3)`（presentation）或
`html[data-cle]`（bridge），不覆盖原生无 `data-cle` 的状态。

`#cle-utilities` 内部变量在 `bridge.css` 用 `html[data-cle] #cle-utilities`
（0-1-1 + 属性）定义，特异性高于旧皮肤的 `#cle-utilities`（0-1-0），
所以即便 `oc/restyle` 的改动合并进来、把变量改回粉色或墨色，面板仍然取到 token。
**这一点已在真实合并树上验证**（见下）。

## 合并 oc/restyle 后的实测

在 `/tmp` 的临时 worktree 里把 `oc/restyle` 合并进来（0 冲突），跑同一套 headless 测量：

```
PANEL bg rgb(251, 248, 241) contrast 17.05
CARD surface bg rgb(251, 248, 241) tokenCard #FBF8F1 tokenSoft rgba(42, 99, 232, .08) tokenMuted #5C5A57
CARD muted contrast 6.48
MEMORY primary contrast 15.77
LASER settings contrast 17.05 / swatch preservesPreset yes
```

说明：合并版里 `oc/restyle` 的 `--pinkie-settings-muted: #886b7c` 会被我的
`html[data-cle] #cle-utilities { --pinkie-settings-muted: var(--cle-ink-2) }` 覆盖，
但那只覆盖 `#cle-utilities` 这一棵子树；设置页其它位置仍在用它，所以仍列为交接项 E。

---

## 旧能力对应

| 原 App 能力 | 旧实现 | 新版现状 | 改动 |
|---|---|---|---|
| 功能入口（记忆/定时/连接器/用量） | `laolao-capabilities.js` + 设置页卡片 | 同一个模块，挂进 footer | 入口改为原生图标按钮；面板骨架按真实 DOM 重写 |
| 派对空间 | `ui/injections/laolao-party-entry.js`，`webkit.messageHandlers.laolaoParty`，端口 18889 | 桥接与地址都在；网页环境无桥 | 保留真实地址 + `data-native` 标记 + 环境说明 |
| 灵感圆桌 | 同上，`laolaoRoundtable`，端口 18891 | 同上 | 同上 |
| 演示工具 5 件套 | `laolao-laser-pointer.js`（812 行） | 引擎原样 | 只改 `presentation.css`；快捷键/撤销/色板参数不动，并有行为测试 |
| 记忆匣 | `laolao-memory.js` | 模块原样 | 桥接补主次层级、焦点环、遮罩 |
| 本机用量 | `laolao-usage-stats.js` | 模块原样 | 胶囊改为纸面 + 描边，数字用 `--cle-ink` |
| 定时任务/连接器卡片 | `laolao-capabilities.js` | 模块原样 | 表面、状态色、空态、主按钮走 token |

## 未验证项 / 剩余风险

1. **没有目测过任何画面**。本路是 text-only，报告里所有视觉结论都来自 headless Chrome
   的计算样式与几何测量，不是审美验收。最终目测由主控做。
2. 真实网关下的**卡片数据**未验证：我用桩 `gwRequest` 让 capabilities 挂载，验证的是表面与
   状态反馈；`cron.list`/`pinkie.connectors.list` 的真实返回、连接器的 OAuth 流程、
   `cron.run` 的即时执行属于既有模块行为，本路未改也未验。
3. **双栏**：功能面板是单实例（footer 全局入口），不随 pane 变化。这是既有设计
   （记忆/连接器是全局资源，不是 per-pane）；如果主控要求每侧独立，需要另一个任务书。
4. `#cle-utilities` 的 `z-index: 11000` 与 `.pinkie-selection-actions`（12000）、
   记忆层（2147483600）、演示工具条（10004/10005）不冲突；但与原生对话框的相对层级
   没有实测（原生 dialog 走 top-layer，CSS z-index 不参与比较）。
5. 夜间主题只测了功能面板与动作按钮的对比度；记忆匣、演示工具面板的夜间值未逐一测量。
6. `oc/restyle` 仍在改 `static/legacy/*`，E/F 两项在合并后可能已被它自己修掉；主控合并时
   以实际文件为准。

## 需要主控注册

无新增模块。仅：

- `services/cle-studio/openclaw.plugin.json` 的 `controlUi` 指向新构建
  `dist/control-ui/0faf48248dd7/`（构建产物不入库，主控重跑 `npm run build` 即可）。
- 测试文件：`tests/cle-utilities.test.mjs`、`tests/cle-presentation-behaviour.test.mjs`、
  `tests/cle-fusion-seams.test.mjs`（后者会拉起 headless Chrome，`CLE_SKIP_BROWSER=1` 可跳过）。
- 浏览器 harness 在 `services/cle-studio/.harness/`（`serve-fusion.mjs` + `run-fusion.mjs`
  + `fusion.html` + `brand-audit.html`），只在 127.0.0.1 起本地静态服务，不碰 live 网关。

## 自测汇总

```
node --test tests/cle-utilities.test.mjs                11 pass
node --test tests/cle-presentation-behaviour.test.mjs    2 pass
node --test tests/cle-fusion-seams.test.mjs              8 pass（含 headless 实测）
CLE_TOOLBOX_SOURCE=… node --test tests/laser-pointer.test.cjs   5 pass
node --test tests/cle-sidebar.test.cjs tests/brand-ui.test.cjs tests/memory-ui.test.cjs tests/party-usage-ui.test.cjs   19 pass
npm run build                                           cle-studio ui 0faf48248dd7  js 58.7 KB  css 65.5 KB
```
