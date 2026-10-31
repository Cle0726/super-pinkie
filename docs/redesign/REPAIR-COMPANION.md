# REPAIR-COMPANION · Li An 陪伴（动作 / 状态 / 遮挡 / 双 pane）

任务书：`briefs/pinkie-ui-repair-20261018/COMMON.md` + `companion.md`
Worktree：`/Users/Admin/release-superpinkie/wt/repair-companion`，分支 `repair/companion`
起点 commit：`253fc1091d03723954ce6c030a7cbc5fe2771d47`

## 1. 问题 → 修改

### 1.1 猫只有静态换图，原 buddy-rig 的局部动作整段丢失
- **原因**：新版只保留 3 张位图和一个 400ms 轮询；`laolao-buddy-rig.js` 既没被注册，也没有猫版实现。原引擎按「粉色鬃毛」找头发、按蓝色虹膜找眼睛，直接搬到纯黑猫上会全部失效。
- **修改**：新增 `static/legacy/laolao-cat-rig.js`
  - 只用 **alpha 轮廓**判定头/尾：上半部更厚的一侧是头，另一侧下缘是尾。黑猫、白猫、油画、线描都适用，没有颜色假设（`profileFromAlpha`）。
  - 竖条（26 条）局部变形：呼吸 = 以下边缘为锚的纵向压缩；头 = 随视线/打字的横移与点动；尾 = 相位缓慢扫动 + 被戳弹跳；完成 = 整体小跃起再落地压扁。
  - 底边钉住：`drawPlate` 把 `y` 钳在 `H - hgt`，常态下猫不会掉出输入框上沿，只有跃起向上。
  - 眨眼用同目录的闭眼图短暂叠一层（没有闭眼图就不眨），不做逐像素眼皮手术。
  - 性能：默认 30fps，有动作时才 58fps；`IntersectionObserver` + `document.hidden` + `checkVisibility` 暂停；`prefers-reduced-motion` 直接不 attach，退回静态图。
  - 载入：`laolao-companion.js` 会在 rig 未注册时按 `/cle/static/legacy/laolao-cat-rig.js` 自取一次（幂等守卫 `window.__pinkieCatRig`），避免“文件写好但永远不加载”。

### 1.2 猫压住回答末尾（150×102 挡正文）
- **修改**：`--buddy-w: 168px` + `aspect-ratio: 168/90`，与任务书给的原小马尺寸/舒展比例一致；`reserve()` 按**实测**高度（量不到时按比例推算，保底 72px）往所属 pane 写 `--pinkie-safe`，CSS 只在 `[data-pinkie-safe]` 的 pane 上给 `.chat-thread-inner` 加 `padding-bottom` / `scroll-padding-bottom`，所以最后一条回复能滚到猫上方，输入框本身不动。数值不变时不重写样式，避免每 400ms 触发样式重算。
- **追加卡（chat-queue）**：写 `--buddy-lift`，猫整只抬高蹲在卡片上沿，不再压待发内容；卡片消失后变量清除。

### 1.3 单个全局 buddy 在两侧搬来搬去，非活动侧丢菜单/工具
- **修改**：改成 `instances: Map<pane, Buddy>`，**每个可见 pane 一只**，各自持有 menu / bubble / 设置对话框 / 专注计时 / 请求版本号；不再有 `document.querySelector(...)` 取第一个 pane 的写法，取节点统一走 `own()`（只认 `closest(".chat-pane-cache__pane") === pane` 的那一个），避免双栏嵌套时抓到隔壁/内层的元素。
- **生命周期**：
  - 缓存但仍在 DOM 的 pane（`--hidden`）→ 保留实例与菜单，只 `pause()`（停 rig）；再可见时 `resume()`，不重建，切回来不丢工具。
  - pane 真被销毁 → 只 `dispose()` 那一侧，另一侧不动。
  - `loop()` 只推进可见侧的状态；`data-pinkie-running` / `data-pinkie-focus` 按可见侧汇总。
  - 设置对话框：同一时刻只允许一个模态窗，后开的关掉先开的；标题 id 按实例区分。

### 1.4 五状态要可辨认，又不能靠整图不停缩放
- 五个状态各自的动作参数在 `MOODS` 里（呼吸幅度/频率、尾巴幅度、歪头系数、是否眨眼、working 的点头节奏）。
- 没有专属表情图时，**状态的差别交给动作 + 模式小标记**：`.pinkie-buddy__mark` 右上角一个小点，typing 半亮、working 金色呼吸、happy 放大、sleepy 整体淡出；标记本身按房间换线条图标（书页/工具/月亮/书/笔），纸白墨线，没有粉色、没有小马、没有 emoji。
- `FALLBACK` 只保留**横构图**素材（`pet-loaf` / `pet-loaf-closed`）：`pet-sit` 是 314×420 的竖图，塞进 168×90 会缩成一小团，五状态间还会忽大忽小 —— 那正是「用整图缩放冒充动作」，所以不用它当状态图。

### 1.5 五张新美术的接入
- 约定路径 `/cle/static/art/companion-v2/{rest,typing,working,happy,sleepy}.png`，`artFor()` 先探测 v2、失败回退现有素材，探测结果缓存一次；`<img onerror>` 兜底再退一层。Claude 把图放进去即生效，**不需要改代码**。本仓库未生成任何占位图。

### 1.6 菜单/气泡的字体、图标、边缘关系（FUSION 补充项）
- 菜单项、气泡、设置窗的字体全部改走 `var(--cle-sans, …)`，不再写死 `-apple-system`；颜色/边框/阴影全部走 `--cle-*` token，带浅色兜底。
- 设置窗的关闭按钮原来是字符 `×`，改成与气泡一致的墨线 SVG（不再用字符冒充控件）。
- 气泡/菜单出界：`reflow()` 用 `--buddy-shift`（横向）和 `--buddy-shift-y`（纵向）把它们推回**本 pane** 内；很矮的窗口里向上展开会顶出可视区时，往下移并限高滚动（菜单 `overflow: auto`）。没有用 `overflow: hidden` 硬裁（那会连向上展开的菜单一起切掉）。
- 焦点可见：`figure:focus-visible` / 菜单项 `:focus-visible` 有冰蓝描边；`Escape` 关菜单并回焦到猫；方向键/Home/End 在菜单内移动。
- 氛围画布挂在 `.chat-main` 上并 `z-index:-1`，宿主 `isolation: isolate`，不压正文；页面不可见/转场/首屏时停。

## 2. 自测结果

新增 `tests/companion-cat-rig.test.mjs`（11 项，`node --test` 全绿）。它不是对源码做正则，而是用最小 DOM 跑**真实的两个脚本文件**：

| 测试 | 覆盖的真实风险 |
|---|---|
| `cat rig finds the head from the silhouette…` | 头/尾判定只看 alpha：左头、右头、空图三种边界 |
| `head and tail move on their own side; the bottom edge stays pinned` | 头动尾不动、呼吸是纵向压缩且不抬身、跃起会升起并落回 |
| `each visible pane owns its own cat, menu and state` | 两 pane 两只不同节点、重复 mount 不复制不搬家、左侧在跑只有左侧 working、两侧菜单互相独立 |
| `a cached hidden pane keeps its cat alive…` | 缓存侧保留实例但暂停、不再推进状态、恢复后仍是同一只并接回自己的 run、pane 销毁只回收该侧 |
| `chat keeps a real safe gap…` | `--pinkie-safe` 数字合法且 ≥72px、同步到线程、追加卡抬高与清除、销毁后变量回滚 |
| `a long label does not push the menu out of its own pane` | 横向推回 pane 内、纵向顶出可视区时下移 |
| `opening the settings dialog does not throw away an answer already in flight` | 开/关设置不动提问世代号，换房间才作废 |
| `the menu uses the shell type and colour tokens…` | 菜单区无 emoji、颜色走 `--cle-ink`、字体走 `--cle-sans` |
| `the cat attaches the motion rig once the page has settled…` | 首屏未 settle 不编译、settle 后只 attach 一次 |
| `companion-v2 art wins when Claude ships it…` | v2 存在时优先、某状态缺图时该状态仍回退 |
| `asset fallback keeps working when companion-v2 art is absent` | 五状态都能解析到现有素材 |

其他检查：
- `node --check` 三个脚本（companion / cat-rig）通过。
- `cd services/cle-studio && node build.mjs` 通过（复用主仓库 `node_modules`，未安装新依赖）：`ui 1a0183a8b349  js 53.7 KB  css 54.6 KB`。
- 回归：`tests/night-mode.test.cjs` + `tests/model-picker.test.cjs` + 本路测试共 57 项通过。
- 全量 `tests/*.test.*`：831 通过、11 失败，失败全部在 `chat-tool-timeline` / `native-glass` / `material-preview` / `party-room-art` / `sidebar-sessions`，主仓库同一基线同样失败（已核对 `tests/chat-tool-timeline.test.mjs` 在主仓库 7 失败），与本路文件无关。

## 3. 自主发现（FUSION 要求）

| # | 位置 | 现象 / 触发条件 | 处置 |
|---|---|---|---|
| A1 | `static/legacy/laolao-companion.js` `mount()` | 旧代码只 `document.querySelector(".chat-pane-cache__pane--active …")`，双栏时永远是第一个 pane；缓存 pane 一旦被回收，切回来菜单与专注计时全丢 | 已改为 per-pane 实例 + `own()`，缓存侧只暂停 |
| A2 | 同上，`ensureRig()` | 该函数存在于旧文件但**没有任何调用点**，所以动作引擎即使加载也不会挂上 | 已补 `mount()` 里的调用，并加测试锁住「只 attach 一次」 |
| A3 | 同上，`apply()` 的 `onerror` | 只有 `onload`，图片 404 时静默保留上一张，且旧逻辑会在缺失时留下空 `src` | 已加 `onerror` 回退 + `artFor()` 预探测 |
| A4 | `.agent-chat__composer-shell:has(details[open] …)` | 只处理了 `details` 与设置弹层，`chat-controls__model[open]` 展开时猫仍挡在菜单上 | 已并入同一让位规则 |
| A5 | 设置对话框 | 标题 id 写死 `pinkie-buddy-settings-title`，双栏两只猫会撞 id，`aria-labelledby` 指向第一个 | 已按实例生成 id，并保证同时只有一个模态 |
| A6 | 关闭按钮 | 用字符 `×` 当图标，字号 24px 与其它墨线图标风格不一致 | 已换 SVG 线条图标 |
| A7 | `pet-sit.webp` 314×420 | 竖构图被塞进 168×90 的位子，实际渲染只有一条细窄的猫，与 `pet-loaf` 616×420 交替时尺寸跳变 | 已从状态回退表移除，只留横构图两张；真正五张表情等 Claude |
| A8 | 氛围画布 `z-index: 0` + 未建层叠上下文 | 在部分 pane 里会盖住正文（正文未显式定位时） | 改 `-1` + 宿主 `isolation: isolate` |
| A9 | `data-pinkie-queue` 属性 | 旧脚本写这个属性，但新版没有任何 CSS 读它，等于死代码，猫也不会给追加卡让位 | 改为写 `--buddy-lift` 并同步 `data-pinkie-queue`，真正抬高猫 |
| A10 | `Buddy.requestVersion` | 设置对话框与 explain/summary/clarify 共用一个世代号：打开或关闭设置，会把正在等模型的那条解释结果当成过期丢掉 | 已拆成 `askTicket`（提问）与 `settingsRequest`（设置）；只有换房间才作废在途回答 |
| A11 | 设置窗 `×` 按钮 aria | 只有 `aria-label`，没有 `aria-hidden` 的图标语义，读屏会把 SVG 当图形念 | SVG 已加 `aria-hidden="true"`，文本仅由 `aria-label` 提供 |

### 跨所有权问题（不在本路文件范围，交主控分派）

| 位置 | 问题 | 触发条件 | 最小修法 |
|---|---|---|---|
| `services/cle-studio/src/composer/composer.css:97,105` | 用 `!important` 硬编码 `.pinkie-buddy` 的 `--buddy-w/right`（118/96px、54/46px） | 容器宽度 ≤720/≤520 | 删除这两条，交给 `laolao-companion.css` 的同名 `@container` 规则（已按同值兜底，删掉不会跳变） |
| `services/cle-studio/src/process/status.css:34` | `html[data-cle][data-cle-room="learning"] .chat-group.assistant .chat-text { font-size:16px; line-height:1.9 }` 偏大偏松 | 学习房间 | 与正文统一到 15px/1.75，或只在 `--cle-reading` 场景放大 |
| `services/cle-studio/src/process/status.css:57` | 用户段落 `text-align: right` + `max-width: min(78%,600px)`，1624 宽时只剩 388px | 任意宽度 | 用户段落改左对齐 + 与正文同宽（正文容器 768） |
| `services/cle-studio/src/legacy/modules.js:20` | `companion` 只注册了 `laolao-companion.js`，没有 `laolao-cat-rig.js` | 冷启动 | 在 `companion` 模块的 `js` 前加 `laolao-cat-rig.js`（见下方载入顺序）；已做自取兜底，但正式注册更稳 |
| `services/cle-studio/src/main.js` | 无 `laolao-cat-rig.js` 的预加载/版本号 | 升级后旧缓存 | 与其它 legacy 脚本同样的 `?v=` 版本串 |

## 4. 新脚本顺序与注册需求（主控处理）

```
# src/legacy/modules.js
{id: 'companion', css: ['laolao-companion.css'], js: ['laolao-cat-rig.js', 'laolao-companion.js']},
```

- 顺序：**cat-rig 必须在 companion 之前**（companion 挂载时会读 `window.__pinkieCatRig`）。
- 若主控暂时不改 `modules.js`：companion 会在检测不到 `window.__pinkieCatRig` 时按 `/cle/static/legacy/laolao-cat-rig.js` 自行载入一次（`async=false` + 幂等守卫），功能可用，但会多一次网络往返。
- 无新增 CSS 文件；`laolao-companion.css` 仍是唯一样式入口，已在 `modules.js` 现有条目里。
- 无需改主入口；`data-pinkie-safe` / `data-pinkie-buddy` / `data-pinkie-queue` 只写在挂载了猫的 pane 上。

## 5. 原能力对应（旧 → 新）

| 原版能力 | 新版状态 |
|---|---|
| 呼吸 / 头尾局部动作 | 已恢复（`cat-rig`，轮廓分区而非粉鬃毛） |
| 视线跟随（鼠标 / 正在写的回复 / 正在打的字） | 已恢复（`gaze()` + `attend()`，逐 pane） |
| 每次打字反馈 | 已恢复（`input` → `impulse("key")`，只作用事件所在侧） |
| 完成小跃起 + 点缀 | 已恢复（`happy` + `burstFrom(figure,"done")`） |
| 睡眠 + 睡醒伸懒腰 | 已恢复（10 分钟无操作 → `sleepy`，醒来 `impulse("wake")` + 星点） |
| hover / 点击反馈 | 已恢复（CSS hover 高亮 + `boop` 压缩 + 尾巴弹） |
| 点开功能菜单（4 项 + 氛围/播报/设置） | 已恢复，逐 pane 各自一份 |
| 右键 / Shift+F10 打开模型与参数 | 已保留（RPC 仍是 `pinkie.companion.status/settings.set/test`） |
| 解释 / 总结 / 澄清（真实 RPC，含「用这个」回填） | 已保留，请求按 pane 隔离，模式变了就丢弃旧结果 |
| 专注 25 分钟（含 learning 账本 RPC） | 已保留，进度线/小时间按 pane 独立 |
| 进度播报（工具名翻译） | 已保留（只读本 pane 的 `.pinkie-process`） |
| 选中文字「问 Li An」 | 已保留（接到当前聚焦 pane 的实例） |
| 发送点缀 + 输入框回弹 | 已保留 |
| 五模式氛围（花瓣/金箔/微光/斜光/∞） | 已保留，只挂在活动 pane |
| 25 张（5×5）姿态 | **未恢复图像**：等 Claude 的 `companion-v2` PNG；代码路径与回退已就绪 |

## 6. 未验证项 / 剩余风险

- **未做视觉验收**：本会话是 text-only，没有看过任何截图；168×90 的实际观感、墨线清晰度、阴影与纸白底的关系需要主控用 CUA 截图确认。
- **未在真实 WebKit/网关里跑**：测试用的是最小 DOM；`ResizeObserver` 触发的重排、`container query` 在 `chat-pane-cache__pane` 上的实际命中、以及 `--pinkie-safe` 与虚拟列表（如果 native 用了虚拟滚动）的叠加，需要在 19789 测试网关上确认。若 native 采用 `.chat-virtual-row` 的绝对定位，`padding-bottom` 可能不足以留白，需要改用末尾 spacer 节点（当前实现未插入 spacer）。
- **猫的定位依赖 `.agent-chat__composer-shell`**：如果某些房间（如 learning 学习舞台）用别的容器渲染输入框，`shellOf()` 会找不到而不挂猫；需要在真实页面确认每个房间的 composer 类名。
- **`companion-v2` 尚未存在**：五状态目前共用两张横构图 + 动作/标记区分；`happy` 与 `working` 的静态形象仍相同。
- **`pet-loaf-closed` 作为眨眼图**：只在 `rest` 状态传入，其它状态的眨眼依赖 v2 闭眼图；如果 Claude 的 v2 没有闭眼帧，`typing/happy` 等状态不会眨眼（这是有意的降级，不会闪错图）。
- **未改 `modules.js`**：按任务边界由主控注册；未注册时靠自取兜底，多一次请求。
- **性能未实测**：26 条 `drawImage`/帧、30–58fps 的理论开销很小，但没有在真实设备上用 `__perf` 量过。

## 7. Commit

见 `git log --oneline -1` 于 `repair/companion`（提交信息：`fix(companion): per-pane Li An with a silhouette-driven cat rig, real safe space, five-state cues`）。

改动文件：
- `services/cle-studio/static/legacy/laolao-companion.js`（重写）
- `services/cle-studio/static/legacy/laolao-companion.css`（重写）
- `services/cle-studio/static/legacy/laolao-cat-rig.js`（新增）
- `tests/companion-cat-rig.test.mjs`（新增）
- `docs/redesign/REPAIR-COMPANION.md`（本文件）

未提交：`services/cle-studio/dist/`、`openclaw.plugin.json` 的构建产物变化（构建会改写这两处，属于生成物，按共同规则不入库）。
