# REPAIR · MODELS（模型选单与思考档位）

分支 `repair/models`，worktree `/Users/Admin/release-superpinkie/wt/repair-models`，起点 `253fc10`。
负责范围：`src/composer/gaze.js`、新建 `src/composer/models.css` 与 `src/composer/gaze-levels.js`、
`static/legacy/laolao-model-picker.js`、复制进 `static/legacy/brand/` 的 provider SVG、新增两个测试与本报告。
**未改动** `composer.css`、`src/main.js`、`legacy/modules.js`、其它 legacy JS/CSS，未改原版 `ui/`、运行中配置、GUI。

## 一、根因：为什么会出现“图标消失 / 灰色大片空白 / 控件不统一”

新版 `services/cle-studio` 跑在 OpenClaw **2026.10.4**，模型选单的 DOM 与旧版 `ui/injections` 完全不同。
我核对了运行时产物 `dist/control-ui/assets/control-ui-boot-shared-D3oo_6Fq.js` 与配套 CSS，确认：

| 项目 | 旧版（脚本仍按它写） | 2026.10.4（实际渲染） |
|---|---|---|
| 选单根 | `details.chat-controls__model` | `details.chat-controls__model-picker` |
| 菜单 | `.chat-controls__inline-select-menu--combined` | `wa-popup` 内 `.chat-controls__model-menu` |
| 列表 | `.chat-controls__model-browser`（左侧 provider 竖列 + 右侧扁平列表） | `.chat-controls__model-search-wrap` + `.chat-controls__model-options` + 每 provider 一个 `.chat-controls__provider-model-group` + `.chat-controls__provider-model-list` |
| 行 | `.chat-controls__combined-model-option` | `.chat-controls__model-option`（内含 `-option-provider / -copy / -title / -name / -meta / -action`） |
| 品牌图标 | 主题里 `mask` + 我们自己的 `::before` | 原生已有 `.provider-brand-icon`（`--provider-icon-url` mask）与 `.chat-controls__model-option-provider` |
| 思考档 | 与模型共用一个 combined 菜单 | 独立 `details.chat-controls__effort-picker` + `.chat-controls__effort-menu`，档位是 `input.chat-controls__reasoning-range` |

由此产生三个真实故障：

1. **灰色大片空白**：旧脚本的 `sync()` 认不到 2026.10 的 `browser` 节点，于是回退目录
   `renderFallbackCatalog()` 把自带的一份“品牌 tab + 模型行”塞进原生 `.chat-controls__model-options`，
   而 `syncFrame()` 又往菜单里插两层 `laolao-reasoning-frame-*.png` 底板并写内联
   `background-image`。原生菜单同时保留自己的 `padding: 0` 与 `wa-popup` 默认外框，
   结果就是“原生列表 + 我们重复的列表 + 一张灰白渐变图”叠在一个没有主题边框的容器里。
2. **品牌图标不存在**：旧主题的 `--pinkie-brand-icon` 指向站点根 `/laolao-provider-*.svg` 与
   `/provider-icons/...`，新版静态资源走 `/cle/static/legacy/`，路径全部 404；同时 2026.10 的
   行内已经有一个 `.chat-controls__model-option-provider`，所以即使路径正确也会出现两个图标位。
3. **档位只剩普通蓝轨、眼睛 18px 静态**：`gaze.js` 只处理 `.chat-controls__effort-trigger` 的
   `aria-valuetext`，而 2026.10 的真实档位在 `data-chat-thinking-value` 与
   `data-chat-thinking-values` 上；眼睛还被塞进 `.chat-controls__effort-gauge`，而该元素在
   桌面端是 `display: none`（只有 `--mobile-toolbar` 才显示）。此外旧 `composer.css` 把 label
   在 ≤520px 直接 `display: none`，等于“只有一只眼睛、没有档位名”。

## 二、修改

### 1. `src/composer/gaze-levels.js`（新，纯逻辑）
- 十个档位的唯一事实源：`off / minimal / low / medium / high / xhigh / max / ultra / adaptive / fast`，
  每档带 `open`（眼睛开合）、`tier`（标准英文档名）、`zh`（短中文）、`hint`。
- `levelOf()` 同时接受英文 id 与 zh-CN 已翻译标签（`高 / 最高 / 极限 / 自适应 …`），未知文本返回 `null`
  而不是默认成 Medium —— 避免“标签不认识就当成中档”的错误反馈。
- `eyeSvg(level)`：杏仁形猫眼，`open=0` 是带三根睫线的闭合眼，`open≥0.8` 虹膜转冰蓝并出现光晕，
  `ultra` 有睫毛高光；`adaptive` 带自适应小十字。
- `stopIndex()`：按真实 `min/max/value/count` 折算索引，**不按固定阶梯推断**。

### 2. `src/composer/gaze.js`（重写，仍只做表现）
- 眼睛改挂在 `summary` 自身（原生 gauge 桌面端 `display:none`），不再消失。
- 档位名永不替换：原生 label 文本节点保持 Lit 所有，标准档名（`High/Max/Ultra`）通过
  `data-cle-tier` + `data-cle-word` 以 CSS 后缀显示“High 高”。**没有一处写 `textContent` 到原生 label。**
- `renderStops()`：按 `data-chat-thinking-values` 渲染该模型**真实可用**的档位；只有一档时显示
  “此模型只有一个思考档位 · Medium”，绝不伪造 Max/Ultra。
- 禁用时读原生 `title` / `aria-disabled` / `data-chat-thinking-disabled`，在滑杆下方给出
  “会话运行中，暂不可调整”一类**真实原因**；我们自己写的说明不会覆盖原生原因（`data-cle-own-title` 区分）。
- MutationObserver 只观察 `childList`（不看 `characterData`），事件走 `input/change/click/toggle` 委托，
  `abort` 时全部解绑；避免流式输出时每 token 重扫全文档。

### 3. `src/composer/models.css`（新，约 550 行，全部使用 `--cle-*` token）
- 菜单容器：纸白/墨黑底、`--cle-line-strong` 描边、14px 圆角、`--cle-shadow-pop`；
  显式 `::before/::after { content: none }` 清掉旧玻璃扫光。
- 强制隐藏旧脚本可能插入的 `.pinkie-model-frame / .pinkie-model-current / .pinkie-model-brand-tabs /
  .pinkie-fallback-catalog`，杜绝重复列表。
- 搜索框、provider 分组、行高 38px、hover/选中（冰蓝左缘 + `--cle-gaze-soft`）/禁用（ink-2 + 0.78 不透明）、
  默认徽标、能力警告（金色）、kbd 快捷键、空态、catalog 错误态。
- 品牌图标**两条独立通道**：
  `--pinkie-brand-mono`（mask，单色 openai/codex/grok/groq/kimi/zai/ollama，跟随 ink）
  与 `--pinkie-brand-img`（原图，彩色 gemini/claude/deepseek/minimax/hunyuan/alibaba/mistral/doubao/perplexity）。
  未知品牌回落 `crossmodel.svg`，不会是空框。彩色品牌**不进 mask 通道**，保留原几何与品牌色。
  同时隐藏行内原生 `.chat-controls__model-option-provider` 与 trigger 的 `.chat-controls__trigger-provider-icon`，避免双图标。
- 思考档：20px 眼睛、滑杆 6px 轨 + 16px 拇指、档位刻度条（当前档冰蓝 + 2px 光晕）、
  禁用态刻度转灰 + 原因文案；标题、Speed 段、选项按钮统一。
- 窄窗：≤430px 菜单跟随 `cqw`；≤520px 保留标准档名（覆盖 `composer.css` 隐藏规则，
  同特异性且后加载），只去掉中文后缀。
- `prefers-reduced-motion` 下停掉浮动与过渡。

### 4. `static/legacy/laolao-model-picker.js`（外科式修改）
- 新增 `isModernPicker()`；2026.10 走 `syncModern()`：只写 `data-pinkie-brand`（trigger + 行），
  **绝不**建“当前模型”按钮、底图、品牌 tab，也不隐藏原生 provider 分组。
- 原生目录保持权威：`syncModelBrands(menu, false)` 不再给原生行打“退役隐藏”，避免与原生计数、
  搜索、1-9 快捷键打架。
- 现代选单不接管 click-away / Escape / input / change —— 全由原生处理，避免双重保存与
  “关闭时回滚选择”。旧版 combined 菜单的原有逻辑一字未动。

### 5. `static/legacy/brand/`
从原版 `repo/ui/assets/laolao-provider-*.svg` 复制 16 个品牌图 + `crossmodel.svg` + LICENSE，
走 `/cle/static/legacy/brand/`，几何与品牌色原样保留（未重绘、未染色）。

## 三、自测结果（可复现）

代码与结构：
- `node --check services/cle-studio/static/legacy/laolao-model-picker.js` 通过。
- `node build.mjs` 通过：`js 58.9 KB / css 75.0 KB`（`dist/` 被 gitignore，按主控方式不入库）。
- `node --test tests/model-controls-repair.test.cjs` → **8/8 通过**
  （档名映射含中文、眼睛开合单调、标准档名不被诗意词替代、短档位不冒充 Ultra、
  CSS 无硬编码色值/旧玻璃/底图、品牌文件存在且彩色不被 mask、现代选单不重建不双驱、trigger 图标在菜单关闭时也已写入）。
- `node --test tests/gaze-dom.test.cjs` → **5/5 通过**（自建最小 DOM）：
  眼睛插入且 `data-cle-open=0.68`、原生 label 文本零改写、
  真实四档 `Off/Low/High/Max` 且当前档唯一、禁用时输出原生原因、
  单档模型只显示说明不画假刻度、中文标签 `最高` 仍解析为 `max`。
- 既有回归：`tests/model-picker.test.cjs` **38/38**、`brand-ui` **6/6**、`quiet-controls` **3/3** 全通过。

浏览器实测（本地静态预览，同一份 DOM 结构与构建后的 CSS/JS，非真实 App）：
- 浅色：菜单 `344×207`、底色 `rgb(251,248,241)`、1px 描边、14px 圆角（灰色空白消失）。
- 深色：菜单底 `rgb(17,21,34)`；模型名对比度 **14.92:1**、次级信息 **6.74:1**。
- 浅色模型名 **17.05:1**；未选中档位名 **6.48:1**（原设计 ink-3 只有 2.8:1，已上调）。
- 品牌：`deepseek` 行 `::before` 为 16×16 且 `background-image` 命中 `/brand/deepseek.svg`、
  `mask: none`（彩色未被压成剪影）；`openai` 行走 mask 通道；`data-pinkie-brand` 正确归为
  `deepseek/gemini/claude/openai`；trigger 关闭状态也带品牌标记。
- 思考档：滑杆 `value=3` 时 `Max` 唯一高亮；改成两档 `off,medium` 后刻度立即变 `Off/Medium`；
  重复开合 `cle-eye` 仍只有 1 个（无叠加）。
- 禁用：`data-chat-thinking-disabled="true"` 时眼睛与档名转 ink-3，刻度区 `data-disabled`，
  原因显示 **“会话运行中，暂不可调整”**（未被档位说明覆盖）。
- 窄窗 300px：label 仍显示 `Max`（10.5px，宽 21px），未变成只剩眼睛。
- 聚焦：`outline: 2px solid rgb(42,99,232)`。

## 三点五、第二轮返修（主控 CUA 实测后）

主控在 19789 实测确认模型菜单已通过（368×440、灰块消失、品牌路径正确、搜索保留精确路由），
但思考菜单未过观感：368×117 面板里滑杆是很粗的亮蓝胶囊加强辉光，档位文字又非常小。
本轮只修这一处根因，不加末尾 `!important` 补丁。

### 根因：这一个控件被原生样式画了三个地方

我直接读了 2026.10.4 的 `control-ui-boot-shared-styles-*.css`，三条规则叠加：

| # | 选择器 | 它做了什么 | 视觉后果 |
|---|---|---|---|
| 1 | `.chat-controls__reasoning-slider:has([data-effort-boost=max],[data-effort-boost=ultra])` | 给**整个 30px 容器**铺 220% 宽的蓝色 `linear-gradient`，`border-radius: var(--radius-full)`，再加 `animation: chat-effort-flow 6s/4s infinite alternate` | 这一条才是“粗亮蓝胶囊”，和轨道无关；只要停在 Max/Ultra 就出现 |
| 2 | `.chat-controls__reasoning-range[data-effort-boost=max]` / `[=ultra]` | `box-shadow: 0 0 0 1px …accent 45%, 0 0 12px …24%`（ultra 再加 18px 与 inset） | range 自身发光，叠在 1 上面 |
| 3 | `::-webkit-slider-runnable-track` / `::-webkit-slider-thumb` | 26px 高胶囊轨 + 28×20 拇指 | 轨道本身就很粗 |

上一版只改了 3 的尺寸与颜色，没有复位 1 和 2，所以无论轨道多细，容器仍是一整块亮蓝。

### 修改

- `models.css`：`html[data-cle]` 前缀天然高于原生选择器，逐条复位而不加 `!important`：
  - 容器：`background/background-image: none`、`animation: none`、`box-shadow: none`（含 `:has([data-effort-boost])` 变体）；
  - range：`box-shadow: none`、`background: none`、`filter: none`（含 `[data-effort-boost=max]`、`[=ultra]`）；
  - 轨道：3px、圆角 3px，已填充部分 ink 72%、未填充 ink 14%——一条可见的细线，不是色块；
  - 拇指：11×11 墨点 + 1.5px 纸色描边，`margin-top: -4px` 精确坐落在细线上；
  - 焦点：环画在墨点上（纸环 + 冰蓝外环），不再整条控件发光。
- 停点改为**独立刻度**：2×7px 竖向 tick，当前档 2×9px 且取冰蓝**纯色**（`box-shadow: none`），
  不再是会连成一片的横向色条；已过的档位 tick 加深到 ink 52%。
- 档位字号：常见 508px 双栏此前落在 `@container (max-width: 520px)` 里被压到 9px——
  这正是主控说的“文字非常小”。改为 10.5px；仅当模型真的暴露 6–7 档降到 10px、8–10 档降到 9.5px
  （由 `gaze.js` 写入 `data-cle-stops`），按档数分级而不是一刀切。
- `gaze.js`：新增 `host.dataset.cleStops = String(values.length)`，供上面的分级使用；原生 range、
  `min/max/step/value`、键盘、`disabled` 全部未动，未伪造任何档位。

### 本轮自测

- 结构测试新增 2 条（共 10 条）全通过：三条注入点都有对应复位规则、track 3px / thumb 11px、
  当前档 tick 是纯色且无 `box-shadow`、520px 容器查询不再出现 9px、`data-cle-stops` 被写入。
- 既有 38 条 picker 测试 + 5 条 DOM 测试 + 13 条结构测试全通过。
- 浏览器实测（本地原生 CSS + 构建 CSS 同层加载）：
  - `data-effort-boost=max` 时容器 `background-image: none`、`animation: none`、range `box-shadow: none`；
  - 档位字号 10.5px（4 档）/ 9.5px（8 档），8 档时最宽名 35px、容器 316px 无截断；
  - 眼睛随档位 0 → 0.34 → 0.93 → 1 开合，Max/Ultra 点亮虹膜；
  - 方向键改变档位时停点高亮跟随（Low → Medium）；
  - 对比度：当前档 17.05:1（深色 14.92:1）、未选中 6.48:1（深色 6.74:1）、刻度说明 6.48:1（深色 6.74:1）。

### 遗留 / 交主控

- 更亮的 `--cle-gaze` 只在“当前档 tick”与“聚焦环”出现，不再有大面积蓝色；若主控仍觉得蓝色偏艳，
  改 `--cle-gaze` 一处即可，不需要动结构。
- 我未看图。以上是层叠规则 + computed style + 几何测量，观感仍需主控 CUA 判定。

## 三点六、aa4ad65 的范围回归（主控发现，已修）

主控核对 aa4ad65 时指出：该 commit 还整段删掉了 `models.css` 里
`.chat-controls__reasoning-panel`、`.chat-controls__effort-heading/value`、
`reasoning-default/option`、`speed-panel/options/option` 等控件区样式，而报告没有解释，
且这并非改 track/thumb 所必需。

**这是我的实现错误，不是设计决定。** 上一轮用「取起点/终点索引后整段替换」的方式重写滑杆块，
结束锚点落在 `/* very narrow` 而不是 `/* headings … */`，于是把夹在两者之间的整个控件区一并吞掉。
`git show 7f12598:…models.css | grep -c` 与当前文件的对比可直接复现（reasoning-panel 1→0、
speed-option 5→0 等）。

### 恢复内容（只撤去与新细轨确实冲突的部分；实际一条都不冲突）

全部按 7f12598 原文恢复，并按 2026.10 的真实 DOM 补强：

| 规则 | 恢复后职责 |
|---|---|
| `.chat-controls__reasoning-panel` | 内边距 11/12/12、`border-top` 分隔线、透明底（避免在纸白菜单里叠出第二层灰） |
| `.chat-controls__effort-heading` | 10.5px mono、大写、`--cle-ink-2`（“推理强度 / 速度”两处小标题） |
| `.chat-controls__effort-value`、`.chat-controls__reasoning-value` | 当前档实时值，12px、`--cle-ink` |
| `.chat-controls__reasoning-option` | 单档模型用按钮代替滑杆：30px 高、纸底、描边 |
| `…--selected` / `[aria-pressed=true]` | 冰蓝底 + 冰蓝描边，明确“已选”，不用粗发光 |
| `…:disabled` / `:focus-visible` | 0.55 不透明 + 冰蓝 2px 环 |
| `.chat-controls__speed-panel` / `-options` / `-option` | 速度组：分隔线、10px 圆角容器、28px 按钮 |
| `…[aria-checked=true]` | 选中为纸白抬升；`ultrafast` 选中才用冰蓝底 |
| `…:focus-visible` / `:disabled` | 键盘环与禁用态 |

补充：`reasoning-value` 是本轮新增的并列选择器（模型菜单里那处实时值），原生 2026.10 给
`effort-value` 的是 `--accent` 蓝色，这里统一为墨色。

### 用原生 DOM 证明这些规则不是死代码

直接对 2026.10.4 的 `control-ui-boot-shared-D3oo_6Fq.js` 中 effort 菜单渲染块做字符串核对：

| 选择器 | 在原生模板中 |
|---|---|
| `chat-controls__reasoning-panel` | 出现 1 次 |
| `chat-controls__effort-heading` | 2 次（推理强度 + 速度） |
| `chat-controls__effort-value` | 1 次 |
| `chat-controls__reasoning-option` | 2 次（含 `--selected`） |
| `chat-controls__speed-panel` / `-options` / `-option` | 各 1 / 1 / 2 次 |

两个**不**存在于 2026.10.4 产物的选择器，已在 CSS 注释中明确标注为旧版兼容，不再当作现行能力：

- `.chat-controls__reasoning-default`：全产物 0 次。
- `.chat-controls__reasoning-scale`（“更快 / 更智能”）：全产物 0 次。
  两者仅用于同一份脚本仍服务的旧版 combined 菜单，注释已写明依据。

### 实测（原生 CSS 与构建 CSS 同层）

- effort 菜单：容器 `background-image: none` / `animation: none`、range `box-shadow: none`、
  track 3px、thumb 11×11、panel padding `11px 12px 12px`、档位名 10.5px、速度按钮 28px 高。
- 模型菜单注入同构面板后：panel padding 同上、标题 10.5px、实时值 17.05:1、
  选中项 `rgba(42,99,232,.08)` + 冰蓝描边 + 30px 高、禁用项 `opacity .55 / not-allowed`。
- 深色：标题 6.74:1、实时值 14.92:1、选中 14.92:1、速度项 14.92 / 6.74:1。
- 既有能力未动：原生 range 的 value/min/max/step、方向键、`aria-checked` 单选语义、`disabled` 全部保留。

### 测试

新增 1 条（共 11 条）按名钉住上述 12 条规则，任何一条再次被整段吞掉都会失败。
62 → **63 项**相关测试全通过。

## 三点七、第四轮：品牌图标错位与单侧缺眼（主控验收发现）

主控在 1280×720、每 pane 508px、左 learning 右 project 的双栏下发现两个真实缺口；
细轨、V4.1 六档、方向键、搜索精确 WB 已通过，本轮不做改动。

### 缺口 1：品牌图标浮到文字左上角

主控给的几何：`summary` 为 `(485.523, 673.898, 181.227, 32)`，
文字 rect `(485.523, 682.398, 161.227, 15)` —— **两者左边界完全相同**，说明图标没有占位；
`::before` computed 为 `position: absolute; left: 0; top: 0`，16×16。

**层叠根因（不是我的规则写错位置，是少了一条复位）**：
原生 2026.10 的 composer 模板里 `agent-chat__input--mobile-toolbar` 是**硬编码常量**
（`control-ui-boot-chat-XcDaYmck.js`，无宽度条件），而该形态的 CSS 有一条：

```css
.agent-chat__input--mobile-toolbar
  :is(.chat-controls__model-trigger, .chat-controls__effort-trigger)::before {
    content: ""; background: 0 0; border-radius: var(--radius-full);
    position: absolute; inset: 0;
  }
```

我上一版的共享绘图规则只设了 `display: block` / `flex: 0 0 16px`，没有复位
`position`。伪元素因此仍是**绝对定位**：脱离 flex 行、`left/top: 0` 贴到 summary
左上角，而文字从下一行同一 x 开始 —— 正是主控看到的“鲸鱼在第一行左上、文字第二行”。

**修复**：在**同一宿主类作用域内**复位，不做全局 `summary::before` 粗改：

- 触发器：`position: static; inset: auto; left/top/right/bottom: auto; margin: 0;
  transform: none; align-self: center` —— 图标回到 flex 行内，占 16px 槽位并与文字同 baseline；
- 同时把原生该形态强制的 `min-width/min-height: 44px` 收回为 `27px`，否则 16px 图标会在
  44px 盒子里居中偏移；
- 行（`[data-chat-model-option]`）与 brand tab 保持各自的 absolute 定位不动 —— 它们本来就是
  按行内偏移设计的，只统一 16×16 与 `background/mask` 双通道；
- 未改任何厂牌色：彩色仍走 `--pinkie-brand-img`，单色仍走 `--pinkie-brand-mono`。

**实测（原生 CSS 与构建 CSS 同层，且 composer 带 `--mobile-toolbar`）**：

| 对象 | position | 尺寸 | 与文字关系 |
|---|---|---|---|
| trigger（deepseek） | `static` | 16×16 | 文字相对 summary 左移 27px = 16 图标 + 6 gap + 内边距，垂直居中 |
| 4 个模型行 | `static` | 16×16 | 文字偏移一致 34px，四行 `centered: true` |

### 缺口 2：刷新后两侧 eyes=0，点开右侧才出现 1 个

**根因**：`mountGaze` 的观察器有两个缺陷：

1. `for (const node of addedNodes) if (nodeType===1) { schedule(node); return; }`
   —— **遇到第一个元素就 return**，同一批 mutation 里其余的 pane/summary 直接丢弃；
2. `schedule()` 用单个布尔 `queued`，`queued === true` 时**后续 root 被丢掉**；
3. 首帧只扫 `document` 一次，之后若 Lit 重建 summary 或 picker 晚一帧出现，
   就没有任何机制补扫 —— 所以“必须点一下”才出现眼睛。

**修复**（仍不逐 token 全扫）：

- `pickersFor(node)`：把每个新增节点归一化成它所属的 picker（`closest(PICKER)`，
  否则在自身/子树里找），**不再丢 root**；
- `pending: Set<picker>` 去重收集，一帧合并 flush；flush 时**先快照再遍历**，
  防止装饰过程中新增节点改变集合；
- 自建节点（eye / stop 行 / tick / 原因行）全部打 `data-cle-owned="1"`，
  观察器跳过它们，**杜绝自观察循环**；
- `abort` 时 `disconnect()` + `cancelAnimationFrame(frame)` + `pending.clear()`，
  abort 后不再写 DOM；
- 仍只观察 `childList`，不观察 `characterData`，长回复流式输出不会重复全扫。

**实测**：清空所有 `.cle-eye` 后 `mountGaze` → 两帧后 `eyes 0 → 2`，
左 pane `high/open .68`、右 pane `max/open .93`，无需任何点击；重复 mount 仍为每侧 1 个（无叠加）。

### 本轮测试

新增 `tests/gaze-mount.test.cjs`（5 项，带 childList MutationObserver + rAF 的最小 DOM）：

1. `mount` 时已存在的 picker **无需点击**即被装饰；
2. **先 mount、后异步出现两个 picker**，且同一帧多条 mutation / 多 root，两侧都装饰；
3. 原生 summary **被整体重建**后重新装饰；
4. 自建节点不触发新的调度帧；
5. abort 取消 pending 帧，之后不再写 DOM。

`tests/model-controls-repair.test.cjs` 再增 2 条：图标必须 `position: static` 且作用域限定在
picker 的 summary（禁止全局 `summary::before`）、`mountGaze` 必须是 `Set` 收集 + `cancelAnimationFrame`
+ 跳过 `cleOwned` 且不观察 `characterData`。

相关测试 63 → **70 项全通过**；构建 `js 59.7 KB / css 77.6 KB`。

## 三点八、第五轮：方向键改档后眼睛不跟随（主控 CUA 复现）

图标流内复位与双栏自动挂载已通过主控验收（`::before` position static、16×16、
文字偏移 22px；单栏/双栏刷新后两个 picker 各 1 只眼睛），本轮只修参数同步，未改动已通过项。

### 现象（主控给的实测序列）

左学习 QA 保持 High；右项目 QA 打开思考菜单，原生 range 4 → 按 Left 变 3：

- **原生已提交**：AX/参数 = Medium，`summary data-chat-thinking-value=medium`、label=Medium、title=Medium；
- **我们没跟上**：`data-cle-level` 仍是 `high`，`.cle-eye` 仍 `data-cle-open=0.68`、`data-cle-sig=high|0`；
- 隔一帧及后续独立 DOM 读取仍相同 —— **不是瞬态**，而是再也不会更新。

### 根因

`mountGaze` 的观察器只订阅 `childList`：

```js
mo.observe(document.body, {childList: true, subtree: true});
```

原生在会话 patch 完成后**只改 summary 的属性与 label 文本节点**，没有任何节点新增，
所以观察器收不到任何记录。`input`/`change` 回调又发生在异步提交之前，那一刻
`data-chat-thinking-value` 还是旧值，读到 Old 属正常；而提交后没有任何补扫 ——
于是眼睛永久停在旧档位。

### 修复

1. **只观察精确属性白名单**（仍在 picker 子树内，不碰正文）：

   ```js
   const WATCHED_ATTRS = ['data-chat-thinking-value', 'data-chat-thinking-values',
     'data-chat-thinking-disabled', 'aria-disabled', 'aria-label', 'title'];
   mo.observe(document.body, {childList: true, subtree: true,
     attributes: true, attributeFilter: WATCHED_ATTRS});
   ```

   流式正文只改文本节点、不改这些属性，因此长回复不会触发扫描；`characterData` 始终未观察。
2. **属性记录归一化到所属 picker**：`target.closest(PICKER)` 后入 `pending: Set`，
   与 childList 路径共用同一帧 flush、同样去重、同样在 `abort` 时取消。
3. **自写属性不回声**：`data-cle-*`、`class` 均不在白名单；`title` 若是我们自己写的
   描述（`data-cle-own-title` 相等）则跳过，避免“写 title → 触发观察 → 再写”的循环。
4. **禁用原因以原生为准**：`reasonFor()` 先读实时 `title`；若它仍是我们自己的档位描述，
   才回落到此前捕获的原生原因，否则给出诚实的通用说明。绝不把 “High 认真推敲”
   当成锁定理由。

### 新增行为测试（按真实顺序，不假定异步已完成）

`tests/gaze-mount.test.cjs` 增 3 条：

| 测试 | 覆盖 |
|---|---|
| `a level committed after input, with no added element, still reaches the eye` | 先 dispatch input 但 summary 仍 High（眼睛保持 0.68、不提前编造档位）→ 稍后**只改** `data-chat-thinking-value=medium` 与 label 文本（无 addedNodes）→ 眼睛最终 `0.52`、`sig` 为 `medium` 档 |
| `reverting to High updates only that pane, and abort leaves the DOM alone` | 反向恢复 High 生效；另一侧不再被波及；abort 后再改属性不写 DOM |
| `the observer watches only the picker attribute whitelist, not document text` | 订阅确实带 `attributeFilter`，且不含 `data-cle-*` / `class`，也没有 `characterData` |

`tests/gaze-dom.test.cjs` 增 2 条并修好测试夹具（属性 ↔ `dataset` 反射、`title` property 反射）：

- 我们自己写的档位描述永远不会被当作锁定原因；
- 原生没有给出原因时，给出的是一句诚实的通用说明，而不是档位提示。

**反向验证**：把 `observe` 退回只有 `childList` 后，上述 3 条立即失败（5 pass / 3 fail），
确认它们真的锁住了这个根因，而不是跟着实现走的空断言。

### 实测（原生 CSS 与构建 CSS 同层）

- 主控序列复现：`max/.93` → 原生 input（属性未变，保持 `.93`）→ 只改属性为 medium
  → **`medium/.52`，`sig` 为 `medium` 档**。
- 六档往返 High → XHigh → Medium → Max → Ultra → High：
  眼睛依次 `0.68 → 0.82 → 0.52 → 0.93 → 1 → 0.68`，`sig` 与原生属性逐档一致。
- 单侧变化不影响另一侧；重复装饰不叠加眼睛（仍每侧 1 个，无自观察循环）。
- 禁用切换：`data-chat-thinking-disabled=true` 时显示原生 “会话运行中，暂不可调整”，
  解除后原因消失、`data-disabled` 清除。

相关测试 70 → **75 项全通过**；构建 `js 60.2 KB / css 77.6 KB`。
High 等真实标签、原生 range 参数、禁用理由、厂牌色、已通过的图标与挂载行为均未改动。

## 三点九、第六轮：运行中的模型按钮暴露 provider 内部 id

### 现象（主控在 19789 真实运行路径看到）

选定 `DeepSeek V4.1 Flash · WB` / High 发一次只读 read 工具请求：

- **运行中**：模型按钮变成 `聊天模型: mm/deepseek-v4.1-flash`，文字裸露 provider 内部 id；
- **结束后**：又回到 `DeepSeek V4.1 Flash · WB`；
- run 已结束、答案正常、停止按钮与 live 标记均回收，没有重发。
  证据：`outputs/qa-tool-phase-fifth.json`（busy 阶段 `working` 有值，finish 阶段
  `model` 已是可读名）。

### 根因

原生 `CV()` 的标签是 `triggerStatusLabel ?? triggerModelLabel`，而运行期
`triggerModelLabel = OV(Ce)`、`Ce` 由 `DV(t.entry(ie || l), …)` 得出：

- 运行中的选择值 `ie` 是 `mm/deepseek-v4.1-flash`；
- 目录里这条模型存的是 `mm/workbuddy/deepseek-v4.1-flash`；
- `t.entry("mm/deepseek-v4.1-flash")` 查不到条目 → `DV(undefined, ie)` → 原样输出 id。

所以这是**目录查找键不匹配**，不是 CSS 或截断问题；原生在 run 结束后自己会恢复。

### 修复：只改展示，不改路由

`static/legacy/laolao-model-picker.js` 新增运行期名称解析：

1. **只在触发器显示原始 id 时介入**（`looksLikeRawModelId`：`ns/path` 形态），
   正常可读名一律不动。
2. **同模型别名判定** `sameModel(raw, candidate)`：仅当 provider 相同且 candidate 的 id
   以 raw 的 id 作为完整尾段时才视为同一条模型
   （`mm/deepseek-v4.1-flash` ↔ `mm/workbuddy/deepseek-v4.1-flash`）。
   不同变体（`…-pro`）、不同 provider 一律不匹配 —— **不把 fallback 伪装成原模型**。
3. **未命中就保持诚实**：目录里没有该模型时不生成任何名字，原生 id 原样保留。
   （已实测：`mm/some-unlisted-model-9b` 不会被替换。）
4. **展示层兄弟节点**：原生标签文本节点归 Lit 所有，绝不赋值；新增
   `.pinkie-model-name` 兄弟承载可读名并隐藏原生文本，run 结束后兄弟移除、原生文本回来。
5. **精确 id 仍可核对**：写入 `data-pinkie-exact-id`，并在 `title` 给出
   `运行中 · DeepSeek V4.1 Flash · WB（mm/deepseek-v4.1-flash）`；run 结束一并撤掉，
   不残留过期 tooltip。
6. **不改真实配置**：`data-chat-select-value`（真实路由）、session、参数档位、
   全局模型配置全部保持原值；`aria-label` 也未被改动，屏幕阅读器仍能读到原生表述。

配套：给现代 picker 的 `summary` 加了一个**范围极小的观察器**（只该 summary 的
childList/characterData + `aria-label`/`title`/`data-chat-select-value` 三个属性，
带 `attributeOldValue`），因为运行期只改文本与 aria/title、不新增节点。自写的
`.pinkie-model-name` 与自写 title 都会被过滤，不产生观察循环。目录按 picker 惰性加载
一次（5 分钟缓存），失败时静默退回原生显示。

### 新增行为测试 `tests/model-trigger-name.test.cjs`（4 项）

覆盖 selected → runtime → done 的真实顺序：

| 测试 | 覆盖 |
|---|---|
| `a running model id is shown as its readable catalog name, never the raw id` | 运行期原生文本变 `mm/deepseek-v4.1-flash` → 兄弟节点显示 `DeepSeek V4.1 Flash · WB`；原生文本节点未被改写；精确 id 在 dataset 与 title 里；`data-chat-select-value` 保持真实运行值 |
| `when the run settles the native readable label comes back and our override is removed` | run 结束 → 兄弟节点移除、原生可读名回来、`data-pinkie-model-label` 与 tooltip 一起清掉 |
| `an unknown running model keeps an honest readable name instead of borrowing another one` | 目录无此模型 → 不替换、不借名，原始 id 保留 |
| `sameModel accepts the workbuddy alias and rejects a different model` | 接受 WB 别名；拒绝 `…-pro` 变体与不同 provider |

**反向验证**：把 `presentTriggerName` 调用去掉后，前两条立即失败（2 pass / 2 fail），
说明它们锁的是这个行为而不是实现细节。

### 实测（真实 DOM，非模板假设）

预览页同层加载构建 CSS + 运行期脚本，走 `selected → running → done → unknown` 四段：

| 阶段 | 原生文本 | 兄弟节点 | title | select-value |
|---|---|---|---|---|
| done | DeepSeek V4.1 Flash · WB | 无 | 无 | `mm/workbuddy/deepseek-v4.1-flash` |
| **running** | `mm/deepseek-v4.1-flash` | **DeepSeek V4.1 Flash · WB** | 含精确 id | `mm/deepseek-v4.1-flash`（未改） |
| after | DeepSeek V4.1 Flash · WB | 无 | **已清除** | `mm/workbuddy/deepseek-v4.1-flash` |
| unknown | `mm/some-unlisted-model-9b` | 无 | 无 | 原值 |

- **长名截断**：兄弟节点继承原生同层规则（`nowrap` + `overflow:hidden` +
  `text-overflow:ellipsis`，`flex-shrink:1`），216px 触发器内 158px 文本不裁剪、不撑破；
  超长目录名同样落在同一省略号规则内。
- **运行中 disabled 态**：`aria-disabled`/`--disabled` 类存在时，可读名仍显示、颜色随原生
  禁用样式转灰（`rgb(154,149,139)`），原生文本保持隐藏，`innerText` 只有一份，不重影。

新增测试 4 项全通过；全量 449 项中 445 通过，4 项失败（`simulated assistant replay`、
`installer cache-busts`、`six frontend pony names`、`folder project duplicate`）在本次改动
**之前就已失败**（stash 后同样 4 条失败），与模型显示无关。

## 四、自主发现（本轮新增，非任务书原文）

| # | 文件 / 选择器 | 触发条件 | 问题依据 | 修复 | 验证 |
|---|---|---|---|---|---|
| 1 | `composer.css:62` + 旧 `gaze.js` | 桌面端打开思考档 | 原生 `.chat-controls__effort-gauge` 在非 mobile-toolbar 下 `display:none`，眼睛被塞进去等于不显示 | 眼睛改挂 `summary` 直接子节点 | 预览实测 `cle-eye` 20×20 可见 |
| 2 | `composer.css:103` | pane ≤520px | label 整条 `display:none !important`，只剩眼睛无法区分 High/Max | 同特异性、后加载的覆盖规则保留档名 | 300px 实测 label `Max` 可见 |
| 3 | `laolao-model-picker.js syncModelBrands` | 原生目录 | 给 2026.10 原生行打 `data-pinkie-hidden-model` 会造成“行被隐藏但 provider 计数不变、搜索仍命中、1-9 指向隐藏行” | 原生目录传 `hideRetired=false`，退役过滤仅保留在旧列表 | 单测 + 代码断言 |
| 4 | 旧菜单注入 | 打开模型菜单 | `syncFrame` 的 `background-image` 内联两层 PNG + 回退目录 = 灰色空白 | 容器级清 `::before/::after`，隐藏旧 frame/current/tabs/fallback | 构建 CSS 无 `reasoning-frame`，实测菜单为 token 底色 |
| 5 | `models.css` 初版 | 深色主题 | 彩色品牌若走 `mask` 通道会被压成单色剪影（第一版真实踩到） | 拆成 `--pinkie-brand-mono`（mask）与 `--pinkie-brand-img`（原图）两条通道 | 实测彩色行 `mask: none` + `url(...deepseek.svg)` |
| 6 | `gaze.js reasonFor()` | 禁用档位 | 我加的档位说明 `title` 会覆盖原生“会话运行中不可调整”，用户看不到真正原因 | 用 `data-cle-native-title` 保存原生原因，优先级更高 | DOM 测试 + 预览实测 |
| 7 | `models.css` ink-3 用法 | 深/浅色菜单 | `--cle-ink-3` 在 surface 上只有 2.6–3.1:1，用于可读文字不达 4.5:1 | 档位名、后缀、kbd、auth、default 说明统一改 `--cle-ink-2`（6.48:1） | 脚本计算对比度 |
| 8 | `models.css` 菜单选择器 | 打开**思考档位**菜单 | 2026.10 的思考菜单是 `.chat-controls__effort-menu`，初版只匹配 `--combined` 与 `--model-menu`，导致该菜单只有 97px 宽、无底色、刻度被挤到 16px | 容器选择器补入 effort 菜单 | 预览实测 344→344px、刻度 78px、底色正确 |

跨所有权（不在我的文件内，交主控）：
- `composer.css:103` 的窄窗隐藏档名规则本身对“只有眼睛”的旧方案合理，但对新方案不利；
  我在 `models.css` 用同特异性后加载覆盖，**建议主控在合并时把该行改成只隐藏中文后缀**，从根上去掉依赖。
- 2026.10 的 `wa-popup` 使用 shadow part 渲染，我用 `::part(popup)` 清掉默认 padding/边框；
  若后续运行时升级改变了 part 名，这一条会失效（不影响功能，只影响外框）。

## 五、未验证项 / 剩余风险

- **我没有真实 App 的视觉与交互验收**：text-only，无法看图；上述“实测”是本地同构预览页的
  computed style / 几何测量，不是主控的 CUA 目测。
- 未在真实 2026.10 网关下点击真实模型切换：`syncModern()` 只读 DOM、只写 `data-*`，
  但真实 `data-chat-select-value` 在部分语言下可能为“待定模型”占位，此时 trigger 品牌会回落到
  crossmodel，属可接受降级。
- 真实目录里 `provider` 名称可能是 `mm` / `clekk` / `workbuddy`，我的 `modelBrand()` 依据**模型 id**
  判品牌（`deepseek-*` → deepseek 等），`workbuddy/*` 走 crossmodel；若产品要 WorkBuddy 专属图标需补图。
- 未测 VoiceOver 逐项朗读顺序；`cle-gaze-stops` 已带 `role=list`/`aria-current`，但原生 range 的
  `aria-valuetext` 仍由上游提供，我没有改写。
- `docs/redesign/REPAIR-MODELS.md` 为本报告；`dist/` 未入库，需主控构建后确认 `openclaw.plugin.json`
  的 hash 指向。

## 六、新旧能力对应

| 旧版能力 | 新版接续 | 状态 |
|---|---|---|
| 品牌 SVG 图标（触发器和每个模型行） | `static/legacy/brand/*.svg` + `models.css` 双通道 | 已接续，路径/几何/品牌色保持 |
| 按 provider 分组的品牌 tab | 原生 `provider-model-group` + `--toggle` 折叠（不再自造 tab） | 已接续，且不破坏原生搜索 |
| 会话独立模型选择 / 真实 id 与路由 | 全部交回原生 `onModelSelect` + `commitValue` | 保留，未改上游规则 |
| 默认项、能力徽标、登录告警 | 原生 `-state-label--default` / `-auth-warning` / `-capability-badge`，我们只上色 | 保留 |
| 搜索 + 键盘（/、↑↓、Enter、1-9、Esc） | 原生实现，我们不再拦截 | 保留（关键修复点） |
| 旧版 9 档思考滑杆与档位名 | 2026.10 独立 effort 菜单 + 真实档位刻度 | 已接续，按模型真实档位 |
| 眼睛随档位开合 / Max·Ultra 光效 | `eyeSvg()` + `data-lit` + 冰蓝虹膜 | 已接续 |
| 禁用原因提示 | 原生 `title`/`aria-disabled` → 滑杆下方原因行 | 已接续（新增可读性） |
| 会话运行中禁止改档 | 原生 `disabled`，我们只呈现 | 保留 |
