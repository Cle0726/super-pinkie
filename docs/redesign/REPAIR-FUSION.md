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

---

## 本轮返修（续 ad783aa）：P1 工作台遮挡 + 已移植模块表现层闭环

### 1. P1 覆盖发送/语音 —— 从占位根因修，不再用固定 bottom 凑

`review-fusion-hit-target-1800.md` 记录的现象：1280×720 双栏、约 220 字后 textarea 增高，
`send`（x1235..1271 y517.8..551.8）与 `voice`（x1197..1231 同 y）的中心点命中都是
`.pk-wb-reopen`（rect x1184.5..1266 y532..560）—— 入口 `position:fixed` 浮在输入区上。

修法不是把 `bottom` 挪几个像素，而是换掉**挂载根**：

- `placeReopen()` 逐 pane 找真实 chrome，按优先级依次尝试
  `.agent-chat__composer-controls` → `.agent-chat__composer-footer` →
  `.chat-pane__actions` → `.chat-pane__header`；
- 进 composer 后清掉 `left/top/right/bottom` 全部内联偏移，`position:static`；
- 多 pane 时按当前 active pane 各自插入，不写死第一个；
- 拿不到任何 chrome 才退回 body 固定定位（保留兜底，但正常路径不走）。

因为入口现在是被 composer 布局驱动的，所以**单栏/双栏、宽/窄、多行输入增高、
工作台开/合** 都会自动跟着走，不需要为每种情况再补一个偏移量。

验证（headless Chrome 真几何 + `elementFromPoint`，1280×720，textarea 增到 168px）：

```
GEOMETRY send x709..745 y640.5..674.5
GEOMETRY voice x671..705 y640.5..674.5
REOPEN parent=agent-chat__composer-controls position=static rect x287..348 y669..697
HIT send centre=727,646 -> chat-send-btn ok=true
HIT voice centre=688,646 -> chat-voice-btn ok=true
OVERLAP reopen-vs-send no / reopen-vs-voice no / reopen-vs-textarea no
NARROW / SINGLE / TIGHT / GROWN 四种布局：hitSend=true，parent 仍是 composer-controls
```

### 2. 修掉的"整组阴影进颜色槽"与软色焦点环

`--cle-shadow` / `--cle-shadow-pop` 是整组阴影值，放进颜色槽会整条声明失效。
验收页用真实样式引擎判定（赋值后读 computed），`--cle-shadow-as-colour` 解析为 `none` 即无效：

```
SHADOW --cle-shadow valid=yes
SHADOW --cle-shadow-as-colour valid=no reason=resolved to none
SHADOW combined valid=yes resolved=rgba(20,18,15,.1) 0px 0px 0px 1px inset, …
```

焦点环统一到实色 `--cle-gaze`；`--cle-gaze-soft`（8% 不透明）只允许做底不做描边。
`tests/cle-legacy-surfaces.test.mjs` 现在会静态扫描 9 个样式源文件，任何把
`var(--cle-shadow*)` 写进颜色槽的声明都会失败。

### 3. 12 个模块的表面与文字

| 模块 | 原状 | 现在 |
|---|---|---|
| 记忆匣 | 粉渐变面板 + `#a82f68` 标题 | `--cle-surface` 面板 / `--cle-ink` 文字，夜间 15.92:1 |
| 提问卡 | 珍珠玻璃 `backdrop-filter` + 白字压粉底 | 纸面墨色；禁用态从 2.81:1 修到 5.99:1 |
| 功能面板 | 主按钮丢掉层级（被 `:is()` 通用规则压平） | 通用规则加 `:not(--primary):not(--danger)`，主/危险各走各的 |
| 用量胶囊 | 白字压粉底 3.5:1；夜间胶囊取反 | 纸面胶囊 5.99:1，夜间 6.74/15.92 |
| 定时任务/连接器 | `'⏰'` `'🔌'` emoji 当图标 | 自绘线性图标 |
| deep-think | 深紫 `#57364a`；摘要/页脚 `--cle-ink-3` 只有 2.81:1 | 全 token；摘要/页脚提到 `--cle-ink-2`（`tiers.css` 的 `!important` 也一并改） |
| desensitize | 粉玻璃浮窗 + `#57364a` | 纸面卡片 + `--cle-ink` |
| context-compact | 粉渐变 popover/toast | 纸面/墨底，进度条 `--cle-gaze` |
| web-gpt | 37 处粉紫字面量 | 只剩 3 个语义色回退值（ok/warn/danger） |
| settings-user | 整份 `#63364c`/`#d9518d` 变量组 | 变量直接指向 C.le. token，删掉夜间第二套粉紫 |

保留的品牌件不做 token 化：GitHub/Notion 磁贴保留品牌底色（实测 17.05 / 17.58 / 15.63:1），
工作台 `--wb-accent` 仍跟随宿主 `--accent`。

### 4. 测量方法本身也修了两处，否则会误判

1. `audit-run.mjs` 只读 `#audit`，而工作台场景页的日志容器是 `#log` —— 页面跑完了也读不到
   结果，表现为"超时"。改成两个 id 都读。
2. 验收页里 `color(srgb 0.94 0.91 0.86)` 这种 `color-mix()` 计算值，分量是 0–1 小数。
   按 0–255 解析会把 5.01:1 算成 3.53:1。修了解析器之后 `--cle-warn` 才被正确判定，
   顺带发现它实际是 4.39:1（纸面）不达标，已把 `#8A6A24` 调深到 `#7F5F1B`（纸面 5.15:1）。
3. 组件上有 `transition: background .18s`，切主题后立刻量会读到过渡起点（假 1.07:1）。
   现在等过渡结束再量。

### 5. 仍然交给主控的跨所有权项

- `src/core/brand.js` 的 chrome 品牌残留：正文已排除，属性/ClawHub 仍在（`cle-fusion-seams`
  的 brand 审计用例持续记录，一旦他人修好该用例会失败并提醒更新交接单）。
- 工作台 `--wb-accent` 的粉/蓝取向属于美术决定，本轮不动。

### 验证汇总

```
cle-workbench-reopen     3/3    P1 遮挡：真几何 + elementFromPoint
cle-legacy-surfaces      3/3    token 类型 + 55 行对比度 + 模块内文字 + 焦点环
cle-fusion-seams         9/9    含 brand 审计
cle-presentation-behaviour 2/2
cle-utilities           11/11
memory-ui / ask-user-ui / deep-think-ui / context-compact-ui / context-compaction-ui
web-gpt-collab / user-settings / night-mode   45/45
```

所有对比度断言的下限是 4.5:1，当前最低实测 4.52:1（用量胶囊强调态）。

### 6. 补修：夜间对比度采样的稳定条件（主控并行 73 项时 1 失败）

主控并行跑 73 项时 `cle-legacy-surfaces` 第 1 项失败，5 条夜间样本停在上一主题：

```
NIGHT ASK option strong  contrast=1.06   bg=rgb(244,239,228)  ← 浅色纸面
NIGHT USAGE chip         contrast=2.35   bg=rgb(244,239,228)
NIGHT USAGE cost         contrast=1.07   bg=rgb(21,22,26)
NIGHT CARD primary       contrast=1.07   bg=rgb(21,22,26)
NIGHT MEM primary        contrast=1.07   bg=rgb(21,22,26)
```

单独复跑同一套件 3 项全过 —— 说明不是 CSS 终态错，而是**采样窗口**不稳。
我上一版用 `setTimeout(320)` 等主题过渡，那是等墙上时间，不是等过渡完成。

**先量了真实时序**（无头 Chrome，逐帧记录 `transitionstart`/`transitionend`）：

```
T0   (切主题同步)   opt 仍是浅色，文字已变夜间
T+60ms  started=12 ended=0
T+180ms started=12 ended=0        ← 过渡还在跑
T+240ms started=12 ended=12       ← 这时才真正结束
T+320/500/800ms 数值完全一致       ← 终态稳定，且与 240ms 相同
```

结论：终态 CSS 是对的（`rgb(239,232,218)` 字 / `rgb(10,13,22)` 底 / 15.92:1），
空闲时要 ~240ms，负载下更久。320ms 是余量问题，不是确定性。

**改成确定的稳定条件**（不是加长 sleep、不是跳过夜间、不是降阈值）：

1. 用 `getAnimations({subtree:true})` 等整棵子树里**有限时长**的过渡/动画归零；
2. 再要求连续 3 帧的样式快照完全一致（排除"过渡已结束但首帧被 paint 推迟"）；
3. 有界预算 4000ms，超时**判失败并输出当时还没停的动画名**，不是超时后照旧采样。

这里有两个非显然的坑，也是之前只能靠 sleep 的原因：

- 页面里有 **`laolao-runtime-dot` 1s infinite** 脉冲点（用量胶囊）。若把"所有动画都结束"
  当条件，永远等不到 —— 所以只等 finite 动画，用 `effect.getComputedTiming().endTime` 判有限性。
- 快照不能包含 `opacity`/`transform`：它们被无限脉冲持续改写，会让"稳定"永远不可达。
  只用会因主题切换而过渡的属性（`color`/`background-color`/`border-*`/`box-shadow`/
  `outline-color`/`fill`/`stroke`）。

**复现与验证**：

- 单跑 3 次：全过。
- 并发 6 个 `cle-fusion-seams` + 3 个 `cle-utilities` + 3 个模块套件做重负载，
  同时跑本套件：通过。
- 相关 5 个套件全量复跑：通过。
- 新增断言（防止有人改回 sleep）：
  - 输出里出现 `SETTLE FAILED` 直接失败（要求的是"稳定"，不是"跑完"）；
  - 夜间样本背景亮度必须 < 0.5，覆盖"文字也还停在浅色、对比度恰好不低"的中途采样。
    说明：主控那 5 条本来就会被 4.5 阈值拦住（1.06/2.35/1.07），这条是额外一层。

### 7. 修桥的生命周期：退役 host → 离线 → 重连（本轮新增）

主控在 19789 做真实断线/重连时，dev.logs 里抓到的是**连续 uncaught**，不是偶发告警：
插件 UI activation 退役后 host 的 getter 同步抛
`This plugin UI activation has ended. Use the current activation.`，
而 classic legacy 脚本是 document 常驻、不跟插件退役，
`window.CLE.host` 与 `__laolaoSidebar.currentSessionKey` 的闭包都还攥着旧 host。

根因有三个，都在桥这一层，不在调用点：

1. `shim.js` 把 `host` 闭包进 `currentSessionKey` 与 `gwRequest`，退役后必抛；
2. `gwRequest` 里 `setTimeout` 先建、`host.request` 后调，**同步 throw 会漏掉那个 timer**
   （15s 后再 reject 一个已经没人接收的 promise）；
3. `laolao-sidebar.js:17` 自己定义了 `currentSessionKey`，直接读 `window.CLE?.host`，
   把 shim 提供的安全 getter **覆盖**掉 —— 这就是"改了桥却还在抛"的原因。

#### 改法：把状态收进桥，调用点不再各自防御

- 桥持有 `{host, online, lastSessionKey, round}`，`window.__laolaoSidebar.currentSessionKey`
  改为读缓存。**离线读 selectedKey 完全不触碰 host**，因此不可能再触发同步 throw，
  也不需要靠 try/catch 吞错。
- 所有 getter 的 throw 只在一个地方降级（`readSelectedKey`）。它返回 `null` 表示
  "这次读不到"，用来区分"读到空字符串"。
- `gwRequest` 用 `settled` 闸门 + 单一 `finish()`：同步 throw / 异步 reject / 超时
  三条路径都会 `clearTimeout`，不会漏 timer。
- 离线时 RPC **立即以明确错误失败**：`与 Li An 的连接已断开，操作未执行。等重新连上再试。`
  —— 不是伪装 timeout，不排队，不重放。
- `rebind(newHost, newSignal)` 必须接**新一轮 activation 的 signal**。这点我第一版写错成复用旧
  signal，被测试抓到：重连后一切看似正常，旧 activation 一 abort 就把新桥整体打掉。
  每一轮有独立 `round`，旧 disposer 只可能关掉自己那一轮。
- 绑定 host 时先探活：`readSelectedKey` 返回 `null` 说明 host 已退役，此时**判离线**而不是
  "有对象就当连上了"，否则界面会显示已连接、直到用户点下去才失败。

#### 保留的东西（不编造数据）

- 离线时仍可读**最后已知的选中会话**作为界面归属，但不会凭空造新值；
- 在线/离线状态通过 `isOnline()` / `facade.online` 显式暴露，界面可以如实显示已断开；
- 正常的 session 与房间独立性不变（`syncSelection` 只在 `stillMine()` 时更新）。

#### 主控接线（main.js 属主控，这里只给导出）

`shim.js` 现在导出 `hostFacade`，把 `window.CLE.host` 从 raw host 换成 facade 即可
（否则 legacy 脚本里那 4 处 `window.CLE?.host?.sessions?.selectedKey` 仍会抛）：

```js
import {installLegacyShim, makeHostFacade} from './legacy/shim.js';

// activate 里，installLegacyShim 之后
safe('shim', () => installLegacyShim(host, controller.signal));
// ...
window.CLE = Object.assign(window.CLE || {}, {
  version: VERSION, rooms, blink, legacy, composer, utilities,
  host: makeHostFacade(),            // ← 唯一改动：raw host → 安全 facade
});
```

重新 activate 时补一次 rebind（新 host + 新 signal）：

```js
window.__cleBridge?.rebind(nextHost, nextController.signal);
```

facade 只做两件事：读 `selectedKey` 走缓存，其余方法离线时立刻明确失败、在线时原样转发。
`installLegacyShim` 的返回值同样带 `{gwRequest, rebind, goOffline, isOnline,
currentSessionKey, hostFacade}`，主控也可以直接用返回值而不是 `window.__cleBridge`。

#### 仍是主控所有权的读取点（本轮未越界改）

`laolao-learning-library.js:8`、`laolao-learning-stage.js:71`、
`laolao-session-list.js:46`、`laolao-session-list.js:1169`、`laolao-workbench.js:286`
都直接读 `window.CLE?.host`。接上 facade 后这四处自动转为安全读，不需要逐个改。

#### 测试（`tests/cle-bridge-lifecycle.test.mjs`，9 项）

用的是**比真机更严**的 host fixture：退役后任何属性访问/方法调用/订阅都同步 throw。

1. 退役后读 key 返回最后已知值，且**零 host 访问**（用调用计数与 getter 访问日志断言）；
2. 退役后 `gwRequest` 立即明确失败，不打旧 host，重连后也不补发；
3. `host.request` 同步 throw：真实原因原样上报，且**没有遗留 timer**（直接盯 live timer 集合）；
4. 在途请求被网关拒绝：调用方拿到真实错误；
5. 重连指向新 host，旧 disposer 晚到**不得**覆盖或打掉新桥；
6. facade 离线只读不抛、写操作明确失败、重连后原样转发；
7. 绑定已退役的 host **不会假装在线**；
8. `laolao-sidebar` 兼容入口不再直接读 raw host（静态契约 + 行为契约双断言）；
9. 重连后正常请求只发一次，旧请求不重放。

### 8. 按主控审查返修桥（3992a8c 之后，不宣称可验收）

主控对 `3992a8c` 的审查指出：桥根因找对了，但增量丢了旧行为，还有资源与换代缺口。
以下逐条对应，全部用行为测试锁住（`tests/cle-bridge-lifecycle.test.mjs`，19 项）。

#### 1) P1 消息风暴与功能回退（已修）

我上一版把 `syncSelection` 写成了「每次 `host.subscribe` 都无条件发 `sessions-changed`」，
而且把 `laolao:modechange` 与"scope 变更关闭记忆编辑器"整段删掉了。后果是真实的：
`laolao-session-list.js:1171` 监听 `sessions-changed` 会 `fetchMode(..., true)` 拉会话，
等于每次运行事件都强制刷新。

现在恢复旧的精确变化判定：
- `mode !== lastMode` 才发 `laolao:modechange`（6 个真实消费者：session-list / plan /
  learning-library / companion / memory / utilities）；
- `key !== lastSessionKey` 才发 `laolao:sessions-changed`，并 `__clekkMemoryUI?.close()`。

测试：同 key 同 mode 连发 12 次 → `sessions-changed` 与 `modechange` 均为 0 次；
key 变化 → 只发 1 次且关闭记忆 1 次；同 key 再发 → 不重复；mode 变化 → 只发 1 次。

#### 2) P1 document 常驻桥并未跨 bundle 版本稳定（已修）

`const bridge` 在模块级，每个 ESM 副本各一份。热更新后旧 classic 捕获的 `gwRequest`/facade
永远指向旧 host —— 之前的 rebind 测试证明不了这一点，因为它只在同一模块内 rebind。

改为把状态、facade、外部订阅所有权放进 document 上的单例 slot（`__cleBridgeSlot_v1`，
`defineProperty` 不可枚举），模块本身不持有任何 host 引用。

测试**真的 import 两个 revision**（同一份源码 + 一处注释差异 → 两个 ESM 实例），
A 装旧 host 后 classic 捕获 `gwRequest`，B 接管新 host：
旧句柄读到的 key 变成 v2、旧 `gwRequest` 发到新 host；随后 A 的 disposer 晚到，
新轮仍在线。这直接覆盖了热更新场景。

#### 3) pending timer 未在退役回收（已修）

`round.dispose` 原来只收订阅/observer，`gwRequest` 的 timer 不在任何所有权里；
`host.request` 永不 settle 时，abort/rebind 仍会挂 15s。

现在 pending 请求登记在单例槽的 `pending` 集合里，`abortPending` 统一处理：
取消计时器、结算调用方、忽略旧结果、绝不重发。

并且区分两种诚实语义：
- **发送前就离线** → `与 Li An 的连接已断开，操作未执行。`
- **已发出后断线** → `连接在请求发出后断开，这次操作的结果未确认。重连后请先确认再重试。`
  不能声称"未执行"，因为副作用可能已经发生。

测试：永不 settle 的请求 + abort → 调用方收到"未确认"，且 live timer 集合归零；
另有专门用例断言"发送前说未执行、发出后说未确认"。

#### 4) 已 aborted 的 signal 仍装全部资源（已修）

原实现会照常 `observe`/`subscribe` 并置 `online=true`，而 abort 监听再也不会触发。
现在提前返回：零 observer、零订阅、直接离线，但句柄仍可用（否则调用方连查在线状态都做不到）。

测试：先 abort 再 install → 未断开的 observer 为 0、`subs` 为 0、`eventOffs` 为 0、
`isOnline()` 为 false、请求报"未执行"。

#### 5) facade 订阅换代后丢失（已修）

原来 `facade.subscribe/onEvent` 直接返回原 host 句柄；classic 只在 boot 订阅一次，
换 host 后旧订阅就丢了，也不会重绑。

现在桥自己持有外部订阅（`externals`）：退役时解绑旧 host，重连时按新 host 重绑，
外部 `unsubscribe` 始终有效（且重复调用安全）。

测试：第一轮的 facade 订阅在第二次 activation 后仍收到新变化；旧 host 的老回调
被手动触发后 `pinkie:gateway-event` **零次**进入；新 host 的事件正常转达；
`unsubscribe` 后桥不再绑定。

#### 6) 同步 throw 未封 Promise / 发明空 UI 实现 / raw host 外泄 / 空 key（已修）

- `sessions.open/create` 现在把同步 throw 封成 rejected Promise，**真实业务错误原样传回**
  （测试用 `session is locked by another pane` 断言 message 完全一致）；
- 删掉凭空发明的 `ui.registerReplacement` noop —— classic 不需要就不提供，
  免得"返回 noop 假装成功"（测试断言 `facade.ui === undefined`）；
- `__cleGateway` 不再挂 raw host，只留 `{request, isOnline}`；
  全仓已无 `__cleGateway.host` 读者；
- 读到空 key 时如实记为空字符串，不再沿用上一个 session
  （`readSelectedKey` 用 `{ok, key}` 区分"读不到"与"读到空"，且只有 `ok=false` 才判离线）。

#### 边界

`main.js` 接线仍由主控持有；`laolao-*` 中直接读 `window.CLE?.host` 的 4 处
（learning-library:8 / learning-stage:71 / session-list:46,1169 / workbench:286）
接上 `makeHostFacade()` 后自动变安全读，本轮未越界改。
未操作 GUI/live/权限/美术，未改 `data-cle-active` 静态皮肤逻辑。

### 9. 最后一轮资源边界（959bfc6 之后）

主控审查 959bfc6 指出三处资源边界没修到底。全部补上，测试增至 23 项。

#### 1) reinstall 的"替换失败"路径没有回收

`installOn` 的已 aborted 分支只做了 `detachRound` + `host=null` + `online=false`，
**没有** `abortPending` 与 `unbindExternals`。这不是只有"空文档 preaborted"才出现：

真实序列是「活跃 host 上有一个永不 settle 的请求 + 一条 facade 订阅 →
`rebind(newHost, alreadyAbortedSignal)`」。旧 `round.dispose` 不含 pending 与外部订阅，
结果 timer 继续挂、调用方永不 settle、外部订阅还活在新界面上。

现在该分支依次执行 `generation++ / abortPending / detachRound / clearExternals`。
与正常 abort 的区别是**清空登记**而不是只解绑：这一次安装根本没活下来，
不该把订阅留着等"同一代的稍后重连"（重连是另一次安装）。

测试用真实序列断言：在途请求收到"未确认"、live timer 归零、旧 wrapper 解绑且零进入、
登记清空、新 host 一个资源都没装、`isOnline()` 为 false。

#### 2) 正常 abort 没解绑外部订阅；wrapper 没有代际守卫

原来 `facade.subscribe/onEvent` 把**外部原件**直接绑到 host。`off` 被调用之前，
旧一代已排队的回调仍可能被 host 触发，直接作用到新/离线界面。

现在绑到 host 的永远是 wrapper，带三重守卫：
`externals.has(record)`（未被 unsubscribe）、`generation` 相同、`host` 相同且 `online`。

关键取舍：**正常 abort 只解绑、保留登记**。因为生产上 classic 只在 boot 订阅一次
（我核对了全仓，目前没有生产代码通过 facade 订阅），若 abort 就丢弃登记，
重连后订阅会永久消失。旧 wrapper 不会因此复活——它的 generation/host 守卫已失效。

`goOffline()` 仍走 `clearExternals`：显式下线没有"稍后重连同一代"。

测试不再用 `host.subs.includes(originalFn)` 这种只能证明"函数被存了"的断言，
而是取出**退役前真正绑到 host 的那个 wrapper** 并调用它：
换代后旧 wrapper 零进入、新 wrapper 正常送达、unsubscribe 后两个都不进入。
并验证 abort 后重连，同一个外部订阅会被重绑并再次生效。

#### 3) modechange 先 dispatch 后更新 key 的竞态

原来顺序是「发 modechange → 再更新 `lastSessionKey`」，监听者在 modechange 回调里
通过 facade 读到的还是上一轮的旧 key。

现在先把这一轮的 mode/key **快照提交**，再按变化各通知一次（每个变化仍只发一次）。
测试在 modechange 监听器内部读 `facade.sessions.selectedKey`，断言已是新 key。

另外 `lastMode` 从"每次安装的局部变量"移到单例槽：
离线期间 mode 变了、又没有触发任何 publish 时，重装也应补一次正确通知，
不能等下一次无关事件。首次安装只建立基线（不凭空发通知），重装才补发。
测试分两段断言：离线期间零通知；重装后正好一次且是新 mode。

#### 未改

`main.js` 接线仍归主控；4 处直接读 `window.CLE?.host` 的点接上 `makeHostFacade()` 后自动安全。
未动 `data-cle-active` 静态皮肤、艺术、GUI/live/权限。

---

## 工作台 gaze 滥用的修复（Claude 主控交接后第一轮）

主控在 19789 WebKit 实拍（营造模式日间 1440×900）看到 gaze（#2A63E8）被当成普通图标色
铺满工作台。品牌规则是：**gaze 是唯一强调色，只给「此刻正在被看/正在发生」的一处用**
（焦点、运行中、选中指示的一条细线），不能当通用图标色，更不能当实心底。

### 根因

`src/styles/bridge.css` 里 `html[data-cle] .pk-wb` 把四个变量一起指向了 gaze：

```css
--wb-accent: var(--cle-gaze);   /* 活动栏选中底、主按钮、徽标… */
--wb-cle: var(--cle-gaze);      /* 图标、标签、胶囊… */
--wb-hover: var(--cle-gaze-soft);
--wb-sig: var(--cle-gaze);
```

于是所有通过 `--wb-accent` / `--wb-cle` 取色的规则（活动栏选中实底 18%、状态栏胶囊 14%、
「未打开」标签 12%、五个操作图标、扩展图标、徽标…）整片变蓝。

### 改法：重新分配 token，只留一条线

`bridge.css`：

```css
--wb-accent: var(--cle-ink-2);   /* 原来 = gaze */
--wb-cle:    var(--cle-ink-3);   /* 原来 = gaze */
--wb-hover:  color-mix(in srgb, var(--cle-ink) 6%, transparent);
--wb-sig:    var(--cle-gaze);    /* 唯一保留 */
```

`laolao-workbench.css` 里 `--wb-sig` 也不再由 accent 派生，改为直连 gaze。

### 主控点名的四处

| 位置 | 原状 | 现在 |
|---|---|---|
| 「文件」活动栏选中 | accent 18% 实底 + 蓝色图标 | 墨字 + 7% 中性底 + 左侧 2px gaze 细线 |
| 5 个操作图标 | `--wb-accent` 染色 | `--wb-mute`（悬停 `--wb-text`） |
| 「未打开」标签 | cle 字 + 12% 实底胶囊 | 无底 + 1px 墨色描边 + ink-2 字 |
| 状态栏「营造模式」 | accent 14% 实底胶囊 | 无底小字（ink-2） |
| 欢迎区光斑 | radial-gradient + blur(4px) + 呼吸动画 | `content: none`，不换装饰 |

### 连带处理（同样属于"蓝色当通用色"）

活动栏选中指示线、徽标数字底、软徽标、快速项选中、菜单 hover、toast 动作按钮、
搜索命中高亮、行内重命名输入框、diff 数字、编辑器闪烁、问题清单 info 级、空态图标、
扩展 chip / 筛选 / 安装按钮、路由 chip 与首行高亮、底栏工具 is-on、分隔线渐变、
toast 左侧色条、终端 `--accent`。

保留 gaze 的两处（符合规则）：
- 选中页签/面板页签底部那条 1px 指示线；
- 底部状态栏「运行中」的脉冲点，以及进度条的细线。

### 第 2 条：侧栏底部名字被挤成 30px

`src/styles/shell.css` 新增：名字槽 `min-width: 8em`（约等于 8 个汉字宽），
按钮容器 `flex: 0 0 auto` 且 `overflow-x: auto`（窄时按钮先横向收，不压缩名字）；
`.sidebar-footer-icon` 强制 `background: transparent`，去掉灰色实底贴片。

**顺带发现的真缺陷**：那些按钮只画 SVG，字符图标（⊞）会继承纯黑，
夜间在深底上只有 **1.15:1**，等于看不见。已显式给 `color: var(--cle-ink-2)`。

### 第 3 条：其它面板自查

| 面板 | 是否有 iOS 蓝 / 实底胶囊 | 处理 |
|---|---|---|
| 搜索面板 | 无 iOS 蓝；命中高亮原为 cle 30% 蓝底 | 改中性 12% 底 |
| Git 面板 | 无 iOS 蓝；M/U/D 用 `--wb-git-*` 语义色 | **不动**（状态语义色，非品牌强调） |
| 扩展页签 | chip/筛选/安装按钮原为 accent 实底 | 改描边或墨底纸字 |
| 底部状态栏 | 「营造模式」实底胶囊 | 改无底小字 |
| 终端 | `--accent` 跟随 `--wb-accent`（原为蓝） | 改跟 `--wb-text` |
| 计数徽标 | accent 10~24% 底 | 改墨色系 |
| 分隔/吸附条 | accent→cle 渐变 | 改单色 `--wb-line` |

### 验证（`tests/cle-workbench-gaze.test.mjs`）

- 静态：`--wb-accent`/`--wb-cle` 不得指向 gaze、`--wb-sig` 必须保留 gaze、
  光斑伪元素必须是 `content: none` 且不得用别的渐变/blur 替代。
- 真实计算样式（无头 Chrome 1440×900，日/夜两段）：被点名的元素不得出现
  `BG=GAZE` / `FG=GAZE`，光斑不得复活为渐变，名字槽 `≥ 8em`，三个底栏按钮底
  必须是 `rgba(0,0,0,0)`。

实测数值：名字槽 186.9px / 13px ≈ **14.4em**；「未打开」与底栏按钮日间 6.48:1、
夜间 6.74:1；活动栏选中 17.05 / 14.92。

### 说明

我是 text-only，以上都是计算样式与几何数值，**不代表观感通过**；
日夜两套的实际观感仍需主控在 19789 实拍确认。
