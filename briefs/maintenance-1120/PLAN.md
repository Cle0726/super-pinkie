# 碧琪代码维护 · 计划书

- 计划：Windows 端 Opus 5.5，2026-11-20。执行：其他 AI，Mac 端和 Windows 端都可以，通过 `PROGRESS.md` 交接。验收：另一个 AI 按 `ACCEPTANCE.md` 进行。
- 配套文件：`ACCEPTANCE.md`（每一项怎样算过）、`PROGRESS.md`（接力记录，执行者每做完一步就写一行）。
- 基线：写计划时核对的代码都以主线 `2c1fa0bb28d6326d5459376748a8440f155d80ab`（v2.5.51 发版后的 `origin/main`）为准，文中的数字和行号也以这一版为准。动手前先 `git fetch`；行号或数字有变化时，以实际为准，并在 `PROGRESS.md` 里写明。
- 分支：每一批从**最新的 `origin/main`** 切一条短分支（例如 `maint/m2-asset-hash`），批内每个提交都推送，批次做完、自查通过后，由 AI 按 `briefs/program-1120/CONCURRENCY.md` 4.3 自己合并，合并后删除这条分支。**不再开长期的并行主线。**
- **11-20 调整**：用户决定接管 OpenClaw 源码，做自己的内核 C.le.（见 `briefs/cle-core-1120/`）。因此 **M6 取消**，由接管计划的 K3 取代；**M3 收窄**，取消大规模的 CSS 分层改造，因为这一项本身就有改动界面的风险，而用户最在意的就是界面。接管计划的 K2 要等本计划的 M0 和 M5 合进主线后才能开始。

---

## 一、用户要什么

用户原话（11-20）：

- 「之前加东西或者修东西总是那个好了这个又出问题反反复复的」
- 「我完全不懂代码这些，不知道我发现的有没有问题还是属于正常情况」
- 看完评估以后说：「写维护计划」

拆成要做到的事：

| 编号 | 要做到 | 怎么算做到 |
|---|---|---|
| G1 | 修一处不再牵连别处 | 页面上每一块区域都有明确的负责文件，整个页面共用一个观察器（M3）；新代码不能再加「强制覆盖」（M0 棘轮）；热点问题都有真开页面的回归测试（M5） |
| G2 | 修好的东西用户确实能拿到 | 资源版本号改为自动生成（M2）；Windows 运行时快照由接管计划 K3 取消 |
| G3 | 修好的东西不会在合并时丢失或被改回去 | 只有 `main` 一条长期主线，旧分支全部清点完毕（M1） |
| G4 | 接手的 AI 有一份准确的地图 | 新的 `docs/ARCHITECTURE.md` 和仓库根目录的 `CLAUDE.md`（M7） |
| G5 | 混乱程度只降不升 | 「健康度棘轮」测试进入 CI：各项计数只许减少（M0） |
| G6 | 用户感觉不到任何变化 | 整个维护期间不改功能、不改外观：关键画面截图前后一致，全量测试通过 |

**不做的事**（执行者不能自行增加）：

- 不推倒重写，不换框架（不引入 React、打包器等），不更换 OpenClaw 底座。
- 不改功能，不改外观，不改文案；`personas/`、`prompts/`、`skills/` 的内容一个字都不动。
- 不碰本机已安装的 App 和正式配置（`openclaw.json`、正式数据目录）。
- 不发版、不打 tag，除非用户另外说。
- 删除远端分支之前，必须先打存档标签；合并进 `main` 必须满足 `briefs/program-1120/CONCURRENCY.md` 4.3 的全部条件。

---

## 二、现状（代码事实，`2c1fa0bb`）

数字由 11-20 的评估实测得出，M0 的测量脚本要能复现这些数字（允许因统计口径有小的出入，但要在 `PROGRESS.md` 里写明口径）。

### 2.1 底座：在别人的成品上打补丁

1. 碧琪运行在 OpenClaw 之上。`patch/` 下有 35 个 `apply-*.mjs`，用法是在 OpenClaw 打包好的 `dist/*.js` 里**按一段原文找锚点，然后替换**（共用逻辑见 `patch/lib-apply-dist.mjs`）。
2. 上一次升级（`patch/PORT-REPORT-2026.10.md`）里：`apply-chat-math.mjs` 标为「需人工」，处理方式是「不匹配就原样跳过」，也就是**静默失效**；`apply-chat-timeline.mjs` 只迁移了一部分。
3. 补丁的执行顺序是**手写的**，而且写了两份：`installer/macos/apply-theme.sh:486-552` 一份，`install.sh:29-60` 一份。`patch/apply-all.mjs` 再从这两处抄出顺序。
4. Windows 包不跑补丁，而是带一份 Mac 上已经打好补丁的副本 `desktop/windows/mac-runtime/`（19 个 dist 文件加 `SHA256SUMS`，由 `build-win.ps1:88-90` 读取）。`docs/WINDOWS.md` 自己写着：快照过期时，Mac 上修好的问题在 Windows 上依然存在。两个月内有 34 个修复提交改过这份 `SHA256SUMS`。

### 2.2 界面：近 200 个文件叠在同一个页面上

5. `ui/injections/laolao-head.fragment.html` 把 121 个脚本和 76 个样式表加载进同一个页面。非第三方代码约 6 万行 JS、2.5 万行 CSS。
6. 有 56 个文件共创建 78 个 `MutationObserver`，其中很多监视整个页面子树（例如 `laolao-metre-skin.js` 8 个、`laolao-study-desk.js` 4 个、`laolao-stream-fx.js` 3 个）；`setInterval` 有 94 处（例如 `laolao-quiet.js` 6 处、`laolao-resume.js` 5 处）；`window.__*` 全局变量有 129 个。
7. 样式表里共有 **5052 处 `!important`**：`laolao-metre-skin.css` 2281 处、`laolao-theme.css` 557 处、`laolao-night.css` 461 处、`laolao-sidebar-surface.css` 186 处。
8. **版本号是手写的**：头部清单里 197 个 `?v=xxxN`；另外还有 9 个插件文件在懒加载其他文件时手写版本号（`laolao-study-desk.js`、`laolao-workbench.js`、`laolao-rich.js`、`laolao-context-compact.js`、`laolao-cle-stage.js`、`laolao-learning-devices.js`、`laolao-learning-library.js`、`laolao-mode-menu-fx.css` 等）；`tools/ui-parity/bundle.py`、`tools/claude-deploy/deploy-work-first.py` 里还有表格形式的版本号；`ui/runtime/index-*.js` 里聊天分块的缓存键也是手动刷新的（例如 `eeeaf671`、`138106da`、`1c9eb1c6`）。`tests/windows-self-contained.test.cjs:11-30` 用来检查 Windows 的版本号不比 Mac 旧。
9. 头部清单是两个月里修复提交改得最多的文件（58 次）。用 `git merge-tree` 试合 `audit/pinkie-1112` 和 `main`，**唯一的冲突就出在这个文件上**。

### 2.3 巨无霸文件

10. 超过 1500 行的手写文件：`services/mode-architecture/index.mjs` 7949 行（约 174 个函数，23 个 `api.on`，15 个 `registerGatewayMethod`，两个月里被 42 个修复提交改过）、`app/windows_desktop.py` 5775 行（8 个大类：`WindowsUpdater:1234`、`ElevatedProcess:2487`、`BundledRuntime:2736`、`DesktopControlNode:2802`、`GatewaySupervisor:3023`、`LocalServices:3415`、`NativeBridge:3653`、`UpdateHealthReporter:5089`）、`desktop/macos/pinkie/Sources/Launcher.swift` 5746 行、`laolao-theme.css` 5389 行、`laolao-resume.js` 2611 行、`laolao-metre-skin.css` 2592 行、`learning.mjs` 2501 行、`laolao-workbench.js` 2352 行、`laolao-sidebar.js` 2143 行、`laolao-model-picker.js` 2049 行、`patch/apply-chat-timeline.mjs` 1978 行、`session-lineage.mjs` 1894 行、`laolao-settings-user.js` 1637 行、`app/super_pinkie.py` 1560 行。
11. `tools/native-pointer-fix/src/Launcher.swift` 和 `tools/native-pointer-fix/base/Launcher.swift` 各有 4888 行，是 Mac 启动器的旧副本。

### 2.4 分支

12. 远端有 125 条分支，其中 47 条没有合进 `main`（清单见附录 A）。**学习台游戏 v4 的 4 个提交只存在于 `audit/pinkie-1112`（`unify/pinkie-1112` 与它相同）**，这条分支落后 `main` 330 个提交。`fix/tools-health-1113` 有 50 个提交按补丁内容不在 `main` 里。
13. 11-20 远端历史被改写过（`fetch` 显示 `forced-update`，分叉点在 `004abbf0`，2026-09-14）。在那之前切出的本机分支，提交号与远端不同，**不能直接推送**，否则约 800 个重复提交会回到远端。

### 2.5 测试和文档

14. 底子是好的：`tests/` 下有 274 个测试文件；`tools/release-gate/run-tests.mjs` 会逐个文件运行，并和 `known-failures.json` 对照（目前只有 4 条，且都写了原因）；`.github/workflows/ci.yml` 在推送到 `main` 和每个 PR 上都会全量运行。
15. 但测试大多是「读源文件，检查里面有没有某段文字」。直接打开浏览器页面的测试文件只有十几个（`grep -lE "\.launch\(|newPage\("` 得到 16 个），也没有截图比对。所以「两个插件在屏幕上打架」这类问题，测试基本发现不了。现成的工具：`scripts/chat-ui-harness/`（假网关 `fake-gateway.js` 加 `run-status-shots.js`）。
16. `docs/ARCHITECTURE.md` 只有 31 行，还写着「四模式」，只列了 6 个插件文件。仓库根目录没有 `CLAUDE.md` 或 `AGENTS.md`，接手的 AI 没有一份统一的必读规矩。

---

## 三、总体做法

1. **只改结构，不改行为。** 每一步都必须能证明「改之前和改之后，用户看到的一样」：全量测试、截图比对、注入清点三者都要过。
2. **先装护栏，再动手。** M0 先把数字量出来，并把「只许减少」的检查放进 CI；M5 的真页面测试要排在 M3、M4 之前。
3. **小步快合。** 一批拆成多个小提交，每个提交都能单独通过测试。一批最长不超过 3 天，做完就合，避免再出现长期分叉。
4. **每修一个复发型 bug，就加一个能抓住它复发的测试。** 这条规矩从 M0 开始生效，并且一直保留。

---

## 四、分批

顺序：M0 → M1 → M2 → M5 → (M3 ∥ M4) → M7。M3 和 M4 改的是不同的文件，可以由两个执行者同时做；其余各批按顺序进行。M6 已取消（见文件开头的「11-20 调整」）。

### M0 · 量和护栏（只加工具和测试，不改产品代码）

1. 新增 `tools/health/measure.mjs`，输出一份 JSON，包含：
   - 每个注入文件的行数、`!important` 数、`new MutationObserver` 数（以及其中 `subtree: true` 的个数）、`setInterval(` 数、`window.__xxx =` 赋值数；
   - 所有手写版本号的位置（`?v=`、表格形式、`ui/runtime/index-*.js` 的缓存键）；
   - 超过 1500 行的手写文件清单（排除 `vendor`、`ui/runtime`、`desktop/windows/mac-runtime`、`build/`）；
   - `patch/apply-*.mjs` 的个数；
   - 测试文件总数，以及其中真正打开浏览器的个数。
   口径写在脚本开头的注释里。同一个提交运行两次，输出要逐字相同。
2. 在基线 `2c1fa0bb` 上运行一次，存为 `tools/health/baseline.json`。
3. 新增 `tests/code-health-ratchet.test.mjs`：拿当前测量结果和 `baseline.json` 对比，**每个文件的每一项都只许持平或减少**；新文件的 `!important`、观察器、定时器、全局变量必须为 0，否则测试失败。数字减少时，必须在同一个提交里把 `baseline.json` 同步改小，否则也算失败（做法和 `known-failures.json` 一样：只能往好的方向走）。确实需要增加时，在 `tools/health/exceptions.json` 里写明原因，验收人逐条审核。
4. 新增 `tools/health/hotspots.mjs`：统计近 60 天修复类提交（提交说明以 `fix` 开头，或者包含「修」「repair」「regress」「restore」）改得最多的 30 个文件，结果写进 `briefs/maintenance-1120/HOTSPOTS.md`。M5 从这份清单里挑测试对象。
5. 在基线上完整运行一次 `node tools/release-gate/run-tests.mjs`，把结果（通过数、失败数、耗时）记进 `PROGRESS.md`，作为后面各批「没有变差」的参照。

### M1 · 收分支（不改代码，只合并和清理）

1. 重新统计一遍附录 A（用 `git cherry origin/main <分支>` 判断哪些提交不在主线里；因为有过压缩合并和改写历史，补丁号不同时，要再用 `git diff origin/main...<分支>` 看实际内容）。每条分支归入以下一类，写成 `briefs/maintenance-1120/BRANCHES.md` 里的一张表：
   - **A 已全部在主线**（附录 A 中 `unique=0` 的 13 条，以及核对后发现内容已经进了主线的）：建议删除。
   - **B 还有用、应该进主线**：至少包括 `audit/pinkie-1112`（学习台游戏 v4）。`fix/tools-health-1113`（50 个提交，最后一条写着「B1-2 交给 Mac 端」）、`fix/real-thinking-only`（10 个）、`fix/windows-learning-worker-1119`（1 个）要逐条看内容再判断。
   - **C 已被别的方式取代**（例如 `feat/metre-roles-1118-1…4` 这几条分支，主线已经通过 #29 合入了 Metre 角色）：先打存档标签 `archive/2026-11/<原分支名>`，再建议删除。
   - **D 别人正在用**（例如今天刚建的 `diagnose/*`、`release/2.5.50-*`）：不动，只记录负责人。
2. B 类每条单独开 PR 合进主线。`audit/pinkie-1112` 唯一的冲突在 `laolao-head.fragment.html`，按「两边的条目都保留，同一文件取较大的版本号」解决。如果 M2 先完成了，这个冲突就会自然消失。合并以后在 Windows 上用学习台游戏的试玩脚本（`tools/study-game/play.mjs`）跑一遍。
3. 删除 A 类和 C 类的远端分支之前，每一条都先打存档标签 `archive/2026-11/<原分支名>`（A 类也打，这样删错了随时能找回）。打好标签就可以删，不用再问用户（见 `briefs/program-1120/CONCURRENCY.md` 9.7）。
4. 本机（Windows 和 Mac 两边）的旧分支：凡是基于改写前历史的，一律不推送。还有用的内容，用 `git cherry-pick` 挑到从新主线切出的分支上。
5. 检查 `tools/native-pointer-fix/` 是否还有地方在用（`grep` 仓库，并查看最近的提交）；没有用就在 PR 里删除（删除记录留在 git 历史里，随时能找回）。
6. 新规矩写进 `CLAUDE.md`（M7 会正式整理，这里先写一个最小版本）：只有 `main` 是长期主线；一项任务对应一条短分支，从最新主线切出；超过 3 天没合的，每天变基一次；合并后删除分支。两台机器开工前都要先 `git fetch`，然后从 `origin/main` 切分支。

### M2 · 资源版本号自动生成

目标：开发者不需要再手写任何版本号；文件内容一变，网址自动跟着变。

1. 源码里统一写一个占位符：头部清单写 `src="/laolao-night.js?v=@hash"`，JS 里懒加载其他文件时调用 `window.__pinkieAsset('laolao-study-desk-drill.js')`。这个函数由一个新的、最先加载的小文件 `laolao-asset-manifest.js` 提供，文件里只有「文件名 → 哈希」一张表。这个文件**由安装或打包步骤生成，不提交到仓库**；仓库里只提交生成脚本。
2. 新增 `tools/assets/stamp.mjs`：按文件内容计算 sha256，取前 10 位，写进安装目录里的 `laolao-head.fragment.html` 和 `laolao-asset-manifest.js`。调用它的地方：`installer/macos/apply-theme.sh`、`installer/windows/apply-theme.ps1`、`tools/ui-parity/bundle.py`、`tools/claude-deploy/deploy-work-first.py`，以及 `build-win.ps1` 打包流程中的对应步骤。
3. 开工前先查清楚：这些注入文件是否在 OpenClaw 的 `dist/control-ui/asset-manifest.json` 里，`patch/lib-precompressed.mjs` 和 `patch/apply-control-ui-cache.mjs` 会不会因此需要同步修改。查到的结论写进 `PROGRESS.md`。
4. `ui/runtime/index-*.js` 里聊天分块的缓存键同样改由脚本生成。如果这个文件是从上游拷贝来的，就在补丁步骤里生成，并补上测试。
5. 改写 `tests/windows-self-contained.test.cjs` 里的版本号比较：不再比较「谁的数字大」，而是比较「同一个文件，在 Mac 和 Windows 上算出的哈希一样」。
6. 删除源码里所有手写版本号。`measure.mjs` 统计到的手写版本号数应为 0，并把这一项加入棘轮测试。

### M5 · 真页面回归测试（护栏，排在 M3 和 M4 之前）

1. 截图基线：用 `scripts/chat-ui-harness/` 的假网关，加上 Playwright，在 Linux Chromium（CI 上能跑的环境）上固定窗口大小、字体和动画（启用 `laolao-motion-preference` 的「减少动态」，冻结时间），截取以下画面：五个模式的首页、侧栏展开和收起、模型选择菜单、设置页、学习台、Metre 看板、一段带工具卡片的长对话，日间和夜间各一份。截图存放在 `tests/visual/baseline/`，新增 `tests/visual-baseline.test.mjs` 做像素比对（差异像素不超过 0.1%，并输出差异图）。
2. 热点测试：从 `HOTSPOTS.md` 里挑出前 10 个**用户能看到的**反复出问题的地方（例如 Windows 标题栏按钮区、侧栏、模式切换、输入框浮层、续读历史、学习台、Metre 皮肤），每个写一个真开页面的测试，断言用户能看到的结果：元素可见、没有被遮挡（比较位置框）、点击后的状态，以及关键的计算样式。
3. Windows 上用 Edge（`channel:'msedge'`）跑同一套测试，作为本机检查；CI 上只跑 Linux Chromium。
4. 截图测试和热点测试都加入 `ci.yml`，也会被 `run-tests.mjs` 收进去。

### M3 · 页面规矩（插件之间不再打架）

1. **区域负责表**：新增 `ui/injections/REGIONS.md`（附一份机器可读的 `regions.json`），列出页面的每一块区域（标题栏、侧栏、输入框、消息列表、模式菜单、设置、学习台、Metre 皮肤、夜间主题……）由哪个文件负责。只有负责文件可以改这块区域的结构和样式，其他文件要改，必须调用负责文件提供的接口或事件。新增测试：非负责文件的样式选择器不能以别的区域的根选择器开头（按 `regions.json` 检查）。
2. **共用观察器**：新增 `laolao-dom-watch.js`，排在最前面加载。整个页面只放一个观察器，各个文件通过 `__pinkieDom.watch(selector, handler)` 注册回调，回调在每一帧里批量执行。先迁移监视整棵子树的那些（`laolao-metre-skin.js`、`laolao-study-desk.js`、`laolao-stream-fx.js`、`laolao-phrases.js`、`laolao-model-picker.js` 等），每迁移一个文件就是一个提交，M5 的测试都要通过。目标：整棵子树的观察器从现在的数量降到 1 个；`setInterval` 能改成事件的就改掉，目标是减少一半。
3. **样式分层（11-20 取消）**：原计划用 CSS 分层把 5052 处 `!important` 降到 500 以下。这一项会大面积改动样式，有改坏界面的风险，所以取消。现有的 `!important` 维持原样，由 M0 的棘轮测试保证不再增加；以后由接管计划的 K6 把界面搬进内核源码时一块一块消化。
4. **全局变量**：老的 129 个不迁移（测试和试玩脚本依赖其中一部分）。新代码一律挂在 `window.Pinkie.<区域>` 下。棘轮测试保证 `window.__*` 不再增加。

### M4 · 拆巨无霸文件（纯搬家，不改逻辑）

1. `services/mode-architecture/index.mjs` 按职责拆成同目录下的多个模块。拆分边界由执行者读代码后确定，并先写进 `PROGRESS.md`，参考划分：证据和回执、交付把关（`createDeliveryGuardTool` 一带）、运行约定、深度思考审计（`auditDeliberation` 一带）、工作区文件读取、本地安装失败处理。`index.mjs` 最后只保留插件注册，以及 `api.on` / `registerGatewayMethod` 的接线，目标是 1500 行以内。
2. `app/windows_desktop.py` 按类拆开：`windows_updater.py`（`WindowsUpdater`、`UpdateHealthReporter`）、`windows_elevated.py`、`windows_runtime.py`（`BundledRuntime`、`DesktopControlNode`）、`windows_gateway.py`（`GatewaySupervisor`、`LocalServices`）、`windows_bridge.py`（`NativeBridge`）。同步更新 `超級碧琪.spec` 的模块列表，以及 `.github/workflows/windows-smoke.yml` 涉及的检查。
3. **怎么证明是纯搬家**：每个提交只搬一块，并用 `git diff --color-moved=zebra --color-moved-ws=ignore-all-space` 检查，除了 `import`/`export` 行，不能有新增或删除的行。把检查命令和结果贴进 `PROGRESS.md`。
4. `tools/metre/inject-inventory.mjs` 对五个老模式和 Metre 各跑 3 条样例，输出要和拆分前逐字一致（`index.mjs` 参与拼提示词）。
5. Mac 端的 `Launcher.swift`（5746 行）由 Mac 端执行者按同样的规矩拆分，可以排在本计划最后做；Windows 端不做。
6. 新规矩加入棘轮测试：新文件不能超过 1500 行；已经超过 1500 行的文件，只许变小。

### M6 · 上游补丁管理（11-20 取消）

**本批取消**：用户决定接管 OpenClaw 源码，补丁会在接管计划的 K3 里全部变成内核源码里的正常改动，Windows 快照也会一起退休。下面的原内容只留作参考，不执行。

1. **只写一份顺序**：新增 `patch/order.json`。`installer/macos/apply-theme.sh`、`install.sh`、`patch/apply-all.mjs` 都从这份文件读取顺序，删掉各自的手写列表。新增测试检查：三处实际执行的顺序和 `order.json` 一致。
2. **不再静默失效**：每个补丁结束时只能报告四种结果之一：`applied`（已打上）、`already`（之前打过）、`upstream`（上游已经自带）、`no-match`（没找到锚点）。安装步骤把所有结果汇总写入 `patch-status.json`；出现 `no-match` 时，安装日志里要有醒目的一行，App 的健康检查也要显示提示。新增 CI 测试：在固定版本的干净 OpenClaw 上运行 `apply-all.mjs`，出现不在 `patch/allowed-no-match.json`（每条写明原因，目前只有 `apply-chat-math.mjs`）里的 `no-match`，测试就失败。
3. **Windows 快照不能过期**：`desktop/windows/mac-runtime/SHA256SUMS` 的开头记录生成这份快照时的「补丁集哈希」（即 `patch/*.mjs` 和 `order.json` 的合并哈希）。`build-win.ps1` 和 Windows 冒烟测试发现哈希对不上，就停止打包，并提示到 Mac 上运行 `refresh_mac_runtime.py`。
4. 新增 `patch/UPGRADING.md`：把升级 OpenClaw 的步骤（`trial-all` → 逐个移植 → `apply-all` → 测试 → 刷新 Windows 快照）写成一张检查单，基于 `PORT-REPORT-2026.10.md` 的做法整理。
5. 只列清单，不动手：哪些补丁可以改用 OpenClaw 的插件接口（`api.on`、`registerGatewayMethod` 这类）来实现，写进 `UPGRADING.md` 的附录，供以后另立计划。

### M7 · 地图和规矩

1. 重写 `docs/ARCHITECTURE.md`：分层图（桌面壳 → OpenClaw 网关加补丁 → `services/mode-architecture` 插件 → 控制台界面加注入 → 人设和技能），一张「功能 → 文件 → 测试」对照表（覆盖五个模式、Metre、学习台、学习台游戏、派对空间、圆桌、内置浏览器、更新器），以及 M2、M3、M6 的规矩。
2. 在仓库根目录新增 `CLAUDE.md`（同时放一份内容相同的 `AGENTS.md`，供其他 AI 读取），控制在 80 行以内，只写必读规矩：分支规矩、不手写版本号、区域负责表、不新增 `!important` 和观察器、新文件不超过 1500 行、修 bug 必须带复发测试、怎么运行测试、发版和合并需要用户点头。
3. 在 `docs/` 下把已经完成的修复报告类文档（例如 `*-REPAIR.md`、`docs/redesign/REPAIR-*.md`）移到 `docs/archive/`，并在 `docs/README.md` 里列一张索引，说明哪些文档仍然有效。

---

## 五、风险

| 风险 | 后果 | 怎么防 |
|---|---|---|
| 迁移到共用观察器时漏掉回调 | 某个界面效果不再触发 | M3 每迁移一个文件一个提交；截图和热点测试每个提交都要通过 |
| 拆文件时悄悄改了逻辑 | 行为变化 | M4 用 `--color-moved` 证明只是搬家，并做注入逐字对比 |
| 维护期间其他功能开发也改同一批文件 | 冲突和返工 | 一批最长 3 天；M3/M4 开工时在 `PROGRESS.md` 写明「正在改哪些文件」，其他任务避开这些文件，或者等这一批合并后再变基 |
| 删错分支丢失工作 | 无法找回 | M1 删除前用户点头；C 类先打存档标签；只删除远端分支，不删本机分支 |
| 推送了改写前历史的旧分支 | 远端重复出现约 800 个提交 | 规矩写进 `CLAUDE.md`；推送前先看 `git rev-list --count origin/main..HEAD`，超过 100 就停下来检查是不是旧历史 |
| 截图测试因字体、动画不稳定 | 误报，大家开始忽略它 | 固定字体、关闭动画、冻结时间；同一提交连续跑 3 次结果一致，才能进 CI |

---

## 六、待用户点头

- 合并和删分支都不用再问：自查通过的 PR 由 AI 按 `briefs/program-1120/CONCURRENCY.md` 4.3 自己合并；删分支前先打存档标签（用户 11-20 的决定）。
- 还需要用户点头的事，见 `briefs/program-1120/CONCURRENCY.md` 9.7。
- 其余的设计细节由执行者按本计划自己决定，不需要问用户。

---

## 七、接手规矩（执行者必读）

0. **先读 `briefs/program-1120/CONCURRENCY.md`**：多个 AI 同时干活的规矩，以及随时可能中断时怎么写接力卡。它和下面各条冲突时，以它为准。
1. 开工前先 `git fetch`，从最新的 `origin/main` 切分支。读完本文件和 `ACCEPTANCE.md`，再看 `PROGRESS.md` 的最新状态。
2. 每做完一步，就在 `PROGRESS.md` 里补一行，写明做了什么、怎么验证的、`ACCEPTANCE.md` 对应条目的自查结果（过 / 没过 / 没测和原因）。
3. 计划没有写到、但又必须决定的细节，自己决定，写进 `PROGRESS.md` 的「执行者的决定」；只有第六节列出的事情才需要问用户。
4. 发现计划里的代码事实和实际不符时，以实际为准，写明差异，不要硬套计划。
5. 不碰正式环境（本机已安装的 App、正式配置和数据目录）。所有运行和截图都在隔离环境里进行：假网关加临时数据目录。
6. 结束时清理自己产生的临时安装、日志和截图（`PROGRESS.md` 引用的证据除外）。C 盘和 F 盘的空间都很紧张。

---

## 附录 A · 11-20 统计的未合并分支

`unique` 表示按补丁内容不在 `main` 里的提交数 / 比 `main` 多出的提交总数。M1 执行时要重新统计。

| 日期 | unique | 分支 |
|---|---|---|
| 11-20 | 3/3 | `diagnose/macos-activation` |
| 11-20 | 1/1 | `diagnose/macos-auth-preparation` |
| 11-20 | 1/1 | `diagnose/legacy-2.5.50` |
| 11-19 | 1/1 | `fix/windows-learning-worker-1119` |
| 11-18 | 7/7、7/7、5/5、5/5 | `feat/metre-roles-1118-1`、`-2`、`-3`、`-4` |
| 11-16 | 10/10 | `fix/real-thinking-only` |
| 11-15 | 50/52 | `fix/tools-health-1113` |
| 11-13 | 4/5 | `install/all-1113-live` |
| 11-13 | 4/4 | `audit/pinkie-1112`、`unify/pinkie-1112`（学习台游戏 v4） |
| 11-13 | 10/10 | `claude/tools-health-1113-a3-03a2ac`、`claude/tools-health-1113-a4-7640b6` |
| 11-12 | 6/8 | `dev/study-game` |
| 11-12 | 3/4 | `feat/study-desk-drill` |
| 11-11 | 5/5、1/1 ×4 | `wip-snapshot-1111/*`（5 条） |
| 11-11 | 1/1 | `test/desk-win-probe` |
| 11-08 | 3/5 | `release/study-game`、`fix/windows-2.5.46-study-game` |
| 11-06 | 2/2 | `feat/windows-browser-pointer-autonode` |
| 11-06 | 1/6 | `feat/windows-inapp-browser-vpn` |
| 11-02 | 4/4 | `oc/brand` |
| 10-20 | 6/7 | `repair/browser` |
| 10-18 | 14/14 | `oc/restyle` |
| 10-18 | 2/16、1/7、1/5、1/1 | `repair/startup`、`repair/fusion`、`oc/sidebar`、`oc/legacy-chat` |
| 10-18 | 0 | `repair/models`、`repair/recovery`、`repair/layout`、`repair/effects`、`repair/companion`、`repair/workbench-gaze` |
| 09-13/14 | 0 | `integration/all-fixes`、`fix/update-suite-state-isolation`、`fix/update-download-resume`、`fix/uninstall-proxy-filter`、`refactor/one-state-root`、`fix/state-root-sandbox`、`fix/updater-download-integrity` |
