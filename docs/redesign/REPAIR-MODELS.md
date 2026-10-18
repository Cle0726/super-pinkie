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
