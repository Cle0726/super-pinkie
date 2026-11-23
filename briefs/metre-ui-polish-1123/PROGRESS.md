# Metre UI 打磨（在现有设计上优化，不推倒重来）

## 接力卡（最后更新：2026-11-23 20:55，Quick-Win-r5ui @ Windows，交接给新会话）

- 状态：进行中（补丁三轮已提交推送、自查都过了；**整页动画在重新设计，第三版「总谱」原型用户说「方向对，细节要调」，还没落进代码**）
- 分支和 PR：`feat/metre-ui-polish`，草稿 PR #67（https://github.com/Cle0726/super-pinkie/pull/67）。提交 `5824a665`（三轮补丁 + ref 截图）、本次提交（接力卡 + `prototype/`）。
- 已完成：
  1. 接手时发现 worktree `C:\Users\34786\Projects\pinkie-wt\metre-ui` 已经建好（11-23 01:24，停在 `402f2dc2`、干净、补丁没打）；main 没动过，直接在上面 `git apply --3way` 了上一个会话的补丁（12 个文件，反向检查通过，`git diff --check` 干净），截图拷进 `ref/`。
  2. 相关测试（隔离：HOME / USERPROFILE / APPDATA / LOCALAPPDATA / TEMP 都指到 `build\quick-run\mui\iso\`）：`metre-skin-cat` 30/30、`metre-real-app-ui` 7/7、`metre-ui-wording` 3/3、`metre-board` 14/14、`metre-quiet` 7/7、`code-health-ratchet` 3/3。
  3. 浏览器测试：`metre-switch-e2e` 1/1、`metre-sidebar-e2e` 3/3（本机 Chrome；`NODE_PATH` 指到 `build\windows-runtime\node_modules\openclaw\node_modules`）。`metre-board-scroll-e2e` 只认 WebKit，这台机器没装 WebKit：**没测（需 Mac）**。
  4. 全量门禁（隔离方式和 cle 会话 11-23 在 `402f2dc2` 上跑的对照门禁 `build\quick-run\polish-gate-base.txt` 一样）：284 个文件，63 条失败；对照 61 条。只在这次出现的 2 条单独重跑：`mode-architecture` 的「cross-process audit writers…」在 main 副本上同样失败（与本批无关）；`session-lineage` 的「stop-and-archive…」本批和 main 单独跑都过（并发负载下的偶发）。**本批新增失败 0。**
  5. 注入对照：改前（未打补丁的同一 worktree）和改后各跑 `node tools/metre/inject-inventory.mjs --json main project thinking learning unrestricted metre`，六个模式逐字一致（只有随机临时目录名不同）。
  6. 截图：`visual-baseline` 在 Windows 上只渲染不比对，所以另用仓库自己的截图工具（`tests/visual/lib/harness.mjs`）在 main 副本和本批各截 24 张，逐像素比：**24 张全部 0 px**；本批连截两遍也是 0 px。截图基线不用动。
  7. 护栏反例：在 `laolao-night.css` 加一处 `!important`，棘轮测试报「461 → 462」失败，马上还原、`git diff` 干净。`measure.mjs --write-baseline` 拒绝写入（列出 dom-watch / game-* 等靠例外放行的增长），**main 副本上一模一样**，不是本批的问题；棘轮测试用上一个会话手算的基线是过的，基线不用再改。
  8. 预览页（真 App 的原生界面 + 本 worktree 注入 + 假网关）给用户在 Chrome 里看了补丁里的进场 / 换会话。用户：「和 Son Daven 比设计不怎么样」。
  9. 研究参考站：Awwwards 那页的 5 段亮点视频逐帧看过（它用 GSAP + SplitText + Lenis + Barba；整站一套从自己 IP 长出来的「竖线」语言：电平表式竖条换页、竖线网点画图、文字散开归位、两色）。
  10. 第二版（照搬竖线）被用户否了：「完全就是抄袭，根据 IP 自己设计一套，这个线条明显不合适」。**只学方法（一套从自己 IP 长出来的图形语言、一次一个大动作、慢而稳），不学外形。**
  11. 第三版「总谱」（全用 Metre 自己的东西：五线谱、小节线、音符、指挥棒、像素 M 当谱号、谱台灯、♩=72）：原型在 `briefs/metre-ui-polish-1123/prototype/`（说明见那里的 README）。用户 11-23 20:54 的反馈：
     - 切进 Metre：「可以不错，但是还可以让人眼前一亮，设计挺新颖」；**小猫去掉**；再稍微优化一下。
     - 换会话：「太白了，没有设计感」——要重做。
     - 首页亮灯、引导语：没提意见（保留现在的做法）。
- 正在做：交接。
- 下一步：
  1. 读 `prototype/README.md`，在本机 `F:\Projects\super-pinkie\build\quick-run\mui\` 里起预览服务（见交接提示词「怎么用跑腿」），在 Chrome 里打开 `v=3` 看现状。
  2. 改原型（只改 `build\quick-run\mui\v3.js / v3.css`，不碰仓库）：
     - 切进 Metre：去掉小猫；想一两个让人「眼前一亮」的点（例如落拍那一下要有一个真正的高潮），节奏再打磨。
     - 换会话：重做，不能再是白底 + 一根线。仍用总谱语言，要有画面感（例如整页像谱纸翻到下一页、谱线和小节号做主角、旧内容被「收进」上一小节）。先给用户两三个方向选（决策卡），再做。
  3. 每改一版：无头录帧（`film-ours.js`）自己先看，再在 Chrome 里给用户看；用户点头才落进代码。
  4. 落进代码时：`laolao-metre-transition.js`（行数锁在基线上，要在同文件里删等量旧代码）、`laolao-metre-home.js`、skin；指挥台位置改读 `buildScene` 的锚点，不从像素里猜；减少动效时全不做；每个已有注入文件不许变长，新文件要进 head fragment（`feat/metre-engines` 也在改 head fragment，会冲突，先看它合了没有）。然后重跑全套自查（见「已完成」2–7），截图、更新本卡、推送。
  5. 用户还定了：总谱「做完」和「其他」两个颜色**拉开**（还没改，等动画定了一起做）。
- 没推送的东西：预览原型的活副本和录帧在 `F:\Projects\super-pinkie\build\quick-run\mui\`（`build\` 不进 git；存档已拷进 `prototype/`）。参考站的逐帧拼图在 `mui\film\_sheets\`、视频在 `mui\film\awww\`（别人的作品，不进仓库）。第二版（作废）在 `mui\v2.js / v2.css`。
- 环境：本会话（AWS Quick）不能直接起进程，靠自己拉起的三个跑腿窗口：`build\quick-run\runner-ui\`（顺序）、`runner-ui2\`（门禁）、`runner-uic\`（并行，最多 4 个）。窗口标题带「metre-ui-polish」，关掉窗口就停。main 的只读副本 `C:\Users\34786\Projects\pinkie-wt\metre-ui-base`（分离头 `402f2dc2`，对照用，收工时 `git worktree remove`）。预览服务开在 127.0.0.1 的 5191 / 5192 / 5193（一小时后自己停）；没碰 18789。
- 正在跑的长操作：无。
- 踩过的坑（本会话）：
  - 浏览器测试不能把 USERPROFILE / HOME / LOCALAPPDATA 指到隔离目录（Chrome 直接退出、Edge 要求非默认资料目录），只隔离 TEMP 和 APPDATA；`metre-board-scroll-e2e` 只认 WebKit，这台机器没有，记「没测（需 Mac）」。
  - 全量门禁的口径要和 `build\quick-run\polish-gate-base.txt` 一样（只改 HOME / USERPROFILE / APPDATA / TEMP / TMP，不带 NODE_PATH），否则对不上。
  - 跑腿在跑任务时 `alive.json` 不一定刷新，以 `results\` 里有没有结果文件为准；别往别的会话的跑腿队列里放东西。
  - 预览页刚打开会先闪一下再进场（旧版也有），落进代码时一起修。
  - 和用户说中文：本会话两次不小心用英文回复，用户只回了「？」。
- 待用户决定：
  - 首页画带在很矮的窗口里最矮 144px，够不够。
  - 换会话的新方向（下一步 2 里先给选项）。

## 前三轮的接力卡（Quick-Win-m7u3，原样保留）


- 状态：进行中（第一轮打磨四项 + 第二轮局部动效六项 + 第三轮整页进场 / 换页都做完了，补丁待应用；node 测试、真页面截图、注入对照还没跑）
- 分支和 PR：`feat/metre-ui-polish`（从 origin/main `402f2dc2` 切；还没建、没推、没开 PR）
- 已完成（都在补丁 `metre-ui-polish.patch` 里，还没提交）：
  1. 颜色收拢：`laolao-metre-skin.css` 里 9 段日间、9 段深色反复覆盖的根变量块，合并成「第六版『总谱』」那里的日间一段 + 深色一段，只留最后生效的值。2592 → 2461 行，`!important` 2281 → 2261。
  2. 首页画带：首页地平线以上（后墙、舞台口、大厅的暗）往底色退一档（深色 0.22、浅色 0.3，谱台 / 椅子 / 指挥台本身不退，舞台口里会动的摆锤跟着退）；浅色地板的倒影、舞台口落地的光、远处木缝不再抖动，改成平平地淡；首页画带高度不超过输入框（连 Baton 那一排）下沿 16px 以下，最矮 144px。
  3. 总谱：区块标题改成衬线 17px + 英文等宽大写小注记（原来是中文粗体 + 英文斜体衬线）；「做完」从灰绿换成背景谱台灯的暗暖白（日 `#8A8478` / 夜 `#938D7E`）；声部每行的「打开 / 停止 / 发消息」有鼠标时悬停或键盘移进来才出现（触屏照旧）；声部标题、节目单步骤不再截成「…」；内边距对齐 8 的倍数。只改 CSS。
  4. 节拍统一：背景摆锤的下一步对齐 `Date.now()` 的半拍格子；猫点头的帧由 `Date.now()` 在这一拍里的位置决定；标志页的摆和拍点也按 `Date.now()`。三处是同一个钟。
  5. 测试：`tests/metre-skin-cat.test.cjs` 的 A4-1 色值改成现在真正生效的「谱纸」色板（旧的 PLAN 2.10 色合并时被删掉了）；新加一条「Metre 11-23 polish」。
  6. `tools/health/baseline.json`：只改了皮肤这一个文件的行数和 `!important`，以及总数 5090 → 5070（按 measure.mjs 的口径手算，应用后请用 `node tools/health/measure.mjs --write-baseline` 复核，数字应一致）。
- 第二轮：动画（用户 11-23：「动画呢」，六项都要，第 6 项明确同意改批 6「不留常驻动画」）：
  1. 谱台灯换状态（`laolao-metre-backdrop.js` 的 `LAMP_SEQ` / `shownLamps`）：派出 = 先闪两下再亮稳（380ms），做完 = 一拍里分两档暗下去（新的 `dim1` / `dim2` 色，在奏和做完之间插值），出错 = 砖红闪两下。只在真数据变化时做；预览（`preview()`）和减少动效时直接换。
  2. 总谱滑入滑出（`laolao-metre-board.js` 的 `close`、skin 末尾「11-23 动画」）：停靠时半拍从右边滑进来，浮层从上面落下来；关的时候 300ms 滑回去，滑完才 `hidden`、对话区才收回宽度。滑出途中 `isOpen` 已经是 false，这时再点打开会直接停在打开的样子。
  3. 总谱刷新（`laolao-metre-board-data.js`）：新的声部行、新的小节淡入上浮 4px；声部条从上一次的位置长过去（`--mb-dx` / `--mb-s`，transform），「现在」那条线移过去（只有一轮不到一分钟、线还没到最右边时看得出来）。第一次画不动；只动 opacity / transform，`keepPlace` 不受影响。
  4. 弹层（skin）：`[data-metre-pop]` 那条原来是 `animation: none !important`，改成 ¼ 拍淡入 + 往上浮 4px（用 `translate`，因为它的 `transform` 被 !important 锁着）；`.laolao-menu`、`.laolao-footer-overflow`、`.pinkie-session-search-dialog` 同样。
  5. 关键词那排点（skin + `laolao-metre-home.js` 写 `--metre-reveal`）：整句浮现完以后从左往右一颗颗亮（clip-path，520ms）；悬停照旧补那道线。
  6. 空闲呼吸（backdrop）：没在奏时一拍一步，舞台口的天幕按 8 拍一个来回在 4 档里明暗（只照天幕本身，中间亮、两边淡；M、谱台、指挥台不动）；每拍 1/12 的机会一盏空谱台的灯闪 160ms。一分钟没人碰键盘鼠标就停在当前这一帧，一动又接着；标志页开着、页面藏起来、减少动效时都没有。
  - 测试：`metre-skin-cat` 的 A4-12（引导语动画只许动 opacity / transform）放行 `translate` 和 `clip-path`；背景那条「空闲没有定时器」改成「空闲没有半拍的定时器、有一拍一步的呼吸，减少动效时都没有」；新加一条「Metre 11-23 motion」。
  - 健康度：皮肤 2517 行、`!important` 2266（main 是 2592 / 2281）；其余改过的文件行数和各项计数与基线一致；没加 setInterval、观察器、全局名、新文件；backdrop 的 rAF 还是只有点击那一处。
  - 验证（还不是 node 测试）：背景的沙盒测试（假 setTimeout）翻成浏览器 JS 跑：空闲有呼吸、在奏半拍、减少动效全停、换成真数据的「在奏」会排灯的过渡；四条波纹测试照旧全过；`dim1` / `dim2` 是中间色；呼吸只改天幕里的像素、breath = 0 时和原来逐像素相同。总谱在真浏览器里开、刷新、关、滑出途中再开都对；弹层、关键词、总谱的动画名在 Metre 下对、减少动效下是 none、离开 Metre 是 none。
- 用户 11-23 两个决定：①「总谱行下面那条空白：收掉」——没有说明文字的声部行，下面那一行（`.pk-mb-score__line.is-empty`，`laolao-metre-board-data.js` 打的标记）不再占高度，有鼠标时悬停 / 键盘移进来，「打开 / 发消息」浮在这一行的右边（盖住状态和用时那一栏），触屏照旧单独一行；行高 68 → 49px。②「空闲时闪哪盏灯：保持闪空谱台」——不改。
- 第三轮：整页进场 / 换页（用户 11-23：「不对我一开始不是叫你搞动画吗怎么搞到UI按键了？」→ 选了「整页的进场和换页动画（像 Son Daven）」，前两轮的改动「都留着」）：
  - 触发（`laolao-metre-home.js` 的 `enter` / `onSwitch`）：① 进 Metre：预备拍转场在「落拍」指挥线开始扫的那一刻发 `pinkie:metre-sweep`（`laolao-metre-transition.js` 只多了这一句，转场长度不变）；② 换会话 / 新会话：`pinkie:session-selected` 后等新内容到了（第一组消息换了、或者出了欢迎页，最多 600ms）；③ 刚打开 App 第一次出首页（等启动闪屏的 `data-laolao-splash-metre` 拿掉，最多 5 秒）。给根元素放 `data-metre-enter="home|chat"`，1.7 秒后拿掉。
  - 样子（skin 末尾「11-23 整页进场」，按 ♩=72）：0 起画带（和对话页的正文）按 16 格竖条从左往右半拍显完；208ms 速度记号那一行从左划出；417ms 引导语从第一个字重新逐字浮现、输入框从下面浮起 16px；625ms 输入框下面那一排淡入（这三样只在首页）。换会话时另有一根 2px 钴蓝指挥线（`.pk-metre-sweep`，临时加到 body、完了就拿掉）跟着竖条的边一格格扫过内容区；进 Metre 时预备拍自己有这根线，不另画。
  - 减少动效、页面藏起来、预备拍还盖着时都不做；不加观察器、定时器循环、rAF、全局名、新文件。
  - 测试：新加「Metre 11-23 page entrance」。
  - 验证（浏览器里用真的 home / backdrop / prompts 脚本 + 新皮肤搭的假页面，不是真 App）：首页在 104 / 208 / 520ms 定格截图（日间），300ms（夜间）；对话页换会话在 160ms 定格（新内容在线左边、线在边上）；减少动效时不放标记、不出线。截图时我拦了两个定时器（1.7s 收尾、417ms 引导语）才定得住画面——这是截图手段，代码里没改。
  - 健康度：皮肤 2562 行 / `!important` 2267；home.js 356 行（比 main 少 1，基线同步了）；transition.js 行数不变。
- 正在做：交接。这个会话停在这里（用户 11-23：额度原因换新会话）。三轮改动都在补丁里，没应用、没提交、没推送；交接提示词在 `F:\Projects\super-pinkie\.git\qw-tmp\HANDOFF-PROMPT.md`。
- 最后一个问题还没回答：「接下来？」——① 应用补丁、跑测试、真 App 看效果；② 先调整动画节奏 / 样子；③ 再加整页动画的时刻（例如打开总谱、发第一条消息）。
- 下一步：
  1. `git -C F:\Projects\super-pinkie fetch origin`，`git -C F:\Projects\super-pinkie worktree add C:\Users\34786\Projects\pinkie-wt\metre-ui -b feat/metre-ui-polish origin/main`。
  2. 在新工作区 `git apply F:\Projects\super-pinkie\.git\qw-tmp\metre-ui-polish.patch`，把 `F:\Projects\super-pinkie\.git\qw-tmp\ref\` 里的截图拷进 `briefs/metre-ui-polish-1123/ref/`。
  3. 跑：`node --test tests/metre-skin-cat.test.cjs tests/metre-real-app-ui.test.cjs tests/metre-ui-wording.test.cjs tests/metre-quiet.test.mjs tests/metre-board.test.mjs tests/code-health-ratchet.test.mjs`，再跑 `tests/metre-board-scroll-e2e.test.mjs`、`tests/metre-switch-e2e.test.mjs`、`tests/metre-sidebar-e2e.test.mjs`、`tests/visual-baseline.test.mjs`。
  4. 注入对照：改前改后各跑一次 `node tools/metre/inject-inventory.mjs`（五个老模式应逐字不变；这次没碰任何非 Metre 文件）。
  5. 隔离环境里截日间 / 夜间首页、对话页、总谱（悬停一行），和 ref 里的「before」对比。
  6. 都过了：提交、推送、开草稿 PR，PR 正文写这一批的文件清单（见下）。
- 没推送的东西：补丁和截图在 `F:\Projects\super-pinkie\.git\qw-tmp\`（git 不跟踪这个目录，不影响主工作区的状态）。
- 环境：这一轮的会话（AWS Quick）在用户电脑上**执行不了命令**（没有 git、node、shell），只能读写 `F:\Projects\super-pinkie` 和调用电脑上的浏览器。所以没建 worktree、没跑任何 node 测试。没开端口、没起进程。
- 正在跑的长操作：无。
- 已经做过的验证（不是 node 测试）：
  - 颜色合并：在真浏览器里分别加载新旧 `laolao-metre-skin.css`，读 `<html data-laolao-mode="metre">` 上 84 个属性（全部 `--metre-*`、给原生界面的变量、`background-color`、`color-scheme`）在日间、`data-theme="dark"`、`data-pinkie-night` 三种状态下的计算值：**0 处不同**。
  - 背景：把 `metre-skin-cat` 里 v12、11-16 night、night 2、night 3 四条测试的断言原样翻成浏览器里的 JS，新旧两版都跑：全过；另加日 / 夜 × 首页 / 对话页点击后不留残影：全过。
  - 正则断言：A4-1/A4-2（作用域、色值、`backdrop-filter`）、v6、`metre-real-app-ui` 引用的段落标记、`metre-ui-wording` 的括号配平和 `--mode-button-ink`、idle CPU 的几条，在 Python 里按同样的正则核对过：全过。
  - 语法：改过的 `laolao-metre-backdrop.js`、`-cat.js`、`-brand.js` 在浏览器里加载无报错。
  - 行数和计数：皮肤以外改过的文件行数、`!important`、观察器、定时器、`window.__` 与基线一致；没有新文件；head fragment 没动（不用改 `?v=`，main 上已经是 `@hash`）。
- 踩过的坑：
  - 先做了一版「竖条」设计预览（参考 Son Daven），用户说「不是大改，是在现在的基础上优化」，作废，没有进补丁。
  - 浏览器工具在页面上按钮少时会自动在截图上画红框（悬停才出现的按钮正好触发它）；`ref/board-after-*.png` 是去掉红框后的。
  - 主工作区还在 `release/2.5.53`，比 origin/main 旧：Metre 有 6 个文件 main 上已经改用 `Pinkie.domWatch`，head 里的版本号已经是 `@hash`。补丁是按 origin/main 做的，别在主工作区上打。
- 待用户决定：
  - 总谱的「做完」现在是暗暖白，和「其他」（暖灰 `#7A7468`）有点接近；要不要再拉开。
  - 首页画带被限制在输入框下沿以下以后，窗口很矮时画带最矮 144px；要不要更矮也行。

## 这一批改的文件

- `ui/injections/laolao-metre-skin.css`
- `ui/injections/laolao-metre-board.css`
- `ui/injections/laolao-metre-backdrop.js`
- `ui/injections/laolao-metre-cat.js`
- `ui/injections/laolao-metre-brand.js`
- `ui/injections/laolao-metre-board.js`、`ui/injections/laolao-metre-board-data.js`、`ui/injections/laolao-metre-home.js`（第二轮；home.js 第三轮又改）
- `ui/injections/laolao-metre-transition.js`（第三轮：只加了一句发事件，长度不变）
- `tests/metre-skin-cat.test.cjs`
- `tools/health/baseline.json`
- `briefs/metre-ui-polish-1123/PROGRESS.md`（本文件）、`briefs/metre-ui-polish-1123/ref/*`

转场的长度和画面没动（用户 11-23 的决定）、`laolao-metre-cat-frames.js`（帧受测试保护）、`laolao-cle-*`、`.claude/worktrees/cle-ink-motion`、解锁门槛、截图基线、head fragment。

## 和进行中的分支

- `feat/metre-engines`：它改 head fragment、`exceptions.json`、新增 `laolao-metre-engine.*`、后端 `metre-board.mjs`。这一批一个都没碰，没有文本冲突。它的引擎台用到 `.agent-chat__composer-controls`；首页画带现在会读这个元素的下沿来让位，选外部引擎、引擎台接管正文区时如果这个元素变高，画带会跟着变矮，属于预期。
- `fix/metre-session-sync`、`docs/metre-next-1122`：没有文件交集。
- `cle-ink-motion`：没有文件交集。

## 截图（ref/）

- `board-before-day.png` / `board-after-day.png`、`board-before-night.png` / `board-after-night.png`：总谱，同一份假数据（roles 批的 `board-fixture.html`，另加一行长标题声部和一个长步骤），917×640 窗口。
- `band-day-before-after.png`、`band-night-before-after.png`：首页画带，上 = main，下 = 这一批（580×239 格，2 倍）。
- `floor-day-zoom.png`、`floor-night-zoom.png`：地板局部放大，左 = main，右 = 这一批。
- 首页「画带让开输入框」要在真页面上看（离线出图没有输入框），还没截。
- `board-row-hover-day.png`：没有说明文字的那一行，悬停时按钮浮在右边（截图里用一个临时样式把悬停状态定住）。
- 第三轮（`ref/enter/`）：`home-day-sequence.png`（首页进场 104 / 208 / 520ms）、`enter-home-night-300.png`、`switch-chat-day-160.png`（换会话，指挥线扫到一半）。
- 第二轮（`ref/motion/`）：`lamp-dispatch-*` / `lamp-done-*` / `lamp-fail-*`（谱台灯过渡逐帧，4 倍）、`breath-*`（天幕呼吸四档）、`board-refresh-mid-day.png`（刷新动画停在 150ms）、`keyword-dots-day.png`（那排点 0 / 140 / 280 / 420 / 520ms）。
