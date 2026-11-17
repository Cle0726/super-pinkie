# Metre 真机 UI 修复交接

更新时间：2026-11-16

## 1. 用户要求与验收边界

用户要求修复真实 macOS App「超級碧琪」里的 Metre 模式，不接受只看设计稿或静态测试：

- 展开与收起侧栏的图标、命中区、视觉样式都要符合 Metre。
- “思考了 N 秒”及展开正文不能再用碧琪粉色/碧琪图标。
- 聊天正文、输入框、运行条位置要正确，不能遮挡正文。
- 工具箱、模型选择、思考强度弹层要适配窗口大小，不能出屏或截断。
- `ask_user` 提问卡在 Metre 中不能出现碧琪头像和“回答碧琪的提问”。
- Metre 选中文字后不能出现“问碧琪”。
- Metre 不使用第一人称/替换词插件，包括“我”被替换成“碧琪”等处理。
- 碧琪 → Metre、Metre → 碧琪两个方向的过场都不能在结尾闪回来源模式。
- 必须写入计划，避免漏项；原计划在同目录 `PLAN.md`。

原则：只增加 Metre 作用域的行为，不改变其他模式的既有文案、头像、样式和交互。

## 2. 工作目录与真实 App

- 项目根：`/Users/Admin/release-superpinkie`
- 当前 worktree：`/Users/Admin/release-superpinkie/wt/metre-install`
- 开始时 HEAD：`98b32700`
- 所有修改尚未 Git commit / push；不要误用其他并行 worktree。
- 真实 App：`/Applications/超級碧琪.app`
- App 资源根：`/Applications/超級碧琪.app/Contents/Resources/SuperPinkie`
- 原始运行文件备份：`/Users/Admin/碧琪实测/backup-app-ui-1116/metre-real-app-024100`
- 备份中包含本轮安装前的 10 个原始运行文件，恢复前先确认是否为用户所需版本。

## 3. 已完成代码修改

### 3.1 双向过场顺序

文件：`ui/injections/laolao-mode-switcher.js`

- 根因：原逻辑先 `ui.fx.finish()` 撤覆盖层，外层再清 `modeTransitionTargetId` 和同步目标模式，撤层时可能露出来源模式。
- 已改：目标会话准备完成后，先清 pending，再 `syncModePresentation(mode)`；非减弱动态效果时 `await motion.frames()`，最后 `ui.fx.finish()`。
- 同一完成路径覆盖进入 Metre、返回碧琪和旧版无专属 FX 分支。
- 外层原有同步保留，属于幂等重复。
- 静态测试验证顺序为“提交目标模式 → 等待帧 → 撤覆盖层”。
- 真机只验证了学习模式 → Metre 最终稳定到 Metre；尚未录制逐帧证据，反向过场也未实测。

### 3.2 Metre 跳过第一人称/替换词

后端：`services/first-person-renderer/index.mjs`

- 在 metadata 增加 `agentId`、`sessionKey`。
- Metre 判断：`ctx.agentId === "metre"` 或 `sessionKey` 以 `agent:metre:` 开头。
- `message_sending`、`reply_payload_sending` 在 Metre 直接返回，不做“我 → 碧琪”等改写。
- 其他模式保持原逻辑。

前端：`ui/injections/laolao-first-person.js`

- 增加 Metre 判断。
- Metre 下跳过 `renderText` / `renderTree`，并记录本轮修改过的文本节点。
- 进入 Metre 时尝试恢复可安全还原的文本；离开 Metre 后重新启用。
- 只覆盖通过本插件记录下来的文本节点，不是所有历史碧琪文案的通用清除器。

前端：`ui/injections/laolao-phrases.js`

- 实际现有结构是 `localizeText` / `localizeTree` / `syncBrandChrome` / `localizeToolActivity` 等，不是简单单函数插件。
- 已加入 Metre 跳过、文本/属性修改记录、模式切换恢复与离开后重新本地化。
- 跳过 Metre 初始品牌处理和 chat projection 调度。
- 恢复机制仅覆盖通过 `setLocalizedText` / `setLocalizedAttribute` 接入的修改点，尚未做完整 DOM 行为测试。

### 3.3 ask_user 提问卡

文件：`ui/injections/laolao-ask-user.js`、`ui/injections/laolao-ask-user.css`

- Metre 标题使用“需要你的选择”。
- Metre 不插入碧琪头像。
- Metre 回答前缀改为“【回答提问】”；其他模式仍保留“【回答碧琪的提问】”及头像，兼容旧测试。
- 定位使用 `visualViewport`、输入框实际位置和上下剩余空间；限制最大高度、内部滚动，避免卡片被挤出屏幕。
- 尚未通过真实工具结果触发 ask_user，真机未验收。

### 3.4 选中文字“问碧琪”

文件：`ui/injections/laolao-companion.js`、`ui/injections/laolao-metre-skin.css`

- 注册选中文字入口时排除 Metre。
- Metre CSS 额外隐藏该入口。
- 尚未在真机实际选择正文验证。

### 3.5 工具箱与弹层

文件：`ui/injections/laolao-composer-tray.js`

- 使用 `visualViewport` 计算上下空间，选择更合适的一侧。
- 弹层最大高度受视口限制，内部滚动。
- 移除空间不足仍强制 `160px` 最小高度的逻辑。
- 监听可视视口和滚动变化。

文件：`ui/injections/laolao-metre-skin.css`

- 新增工具箱、模型、思考强度弹层的统一 Metre 表面、边框、文字、图标和选中态。
- 模型选择器 JS 本轮未修改；原有实现已有 pane/viewport 边界计算。
- 三类弹层尚未在安装后逐一打开做真机验收。

### 3.6 聊天区与运行条

文件：`ui/injections/laolao-run-status.js`

- 定位运行条时写入 `--metre-run-space`。
- 根据输入框实际位置和运行条显示状态计算聊天区底部留白。

文件：`ui/injections/laolao-metre-skin.css`

- 隐藏运行条圆点及 `.pk-metre-cat--dot`。
- 聊天区 `padding-bottom` / `scroll-padding-bottom` 绑定 `--metre-run-space`，默认 `190px`。
- 尚未在真实长对话、运行中、不同窗口尺寸下验收遮挡是否彻底消失。

### 3.7 侧栏与思考记录

文件：`ui/injections/laolao-metre-skin.css`

- 文件末尾新增“真机回归修复（11-16）”段落，包含侧栏图标、收起态 Metre 黑卡、思考记录中性色/钴蓝、弹层、ask_user、窄窗和矮窗规则。
- 收起态按钮后来改为黑色背景，伪元素通过 mask 显示浅色 M，避免浅色主题中黑 M 落在黑底上。
- 第一轮真机截图发现展开侧栏左上角仍残留旧玻璃圆钮。
- 排查发现实际折叠按钮还涉及 `.sidebar-brand__icon` / `.sidebar-brand__collapse`，不是只写 `.sidebar-collapse` 就能覆盖。
- 顶栏按钮共享 `.sidebar-brand__icon` 的类也会被底栏昼夜切换/更多工具复用，不能统一改成加号；已补底栏 svg/pseudo 恢复规则。
- 最近又加入 `.sidebar-brand__actions button { all: unset !important; ... }` 的 Metre 作用域完整外观重置，并保留按钮及点击事件。
- 该最后一次修改已经安装；`metre-expanded-v4.png/.jpg` 已截取，但读取图片时被用户交接消息打断，因此不能宣称圆钮已消失，下一位应先查看 v4 截图。
- 收起侧栏仍未点击验收；思考记录也未在真机展开核对。

## 4. 测试证据

修改/新增测试：

- `tests/first-person-renderer.test.mjs`
- `tests/mode-session-model.test.cjs`
- `tests/metre-real-app-ui.test.cjs`（新增）

已通过：

```bash
node --check ui/injections/laolao-mode-switcher.js
node --check ui/injections/laolao-first-person.js
node --check ui/injections/laolao-phrases.js
node --check ui/injections/laolao-ask-user.js
node --check ui/injections/laolao-companion.js
node --check ui/injections/laolao-composer-tray.js
node --check ui/injections/laolao-run-status.js
node --check services/first-person-renderer/index.mjs

node --test tests/first-person-renderer.test.mjs tests/metre-real-app-ui.test.cjs
# 2 files，14 tests，14 pass

node --test tests/mode-session-model.test.cjs
# 5 tests，5 pass
```

首次跑旧测试时出现的 2 个失败来自新增测试自身的正则/源码切片写错，已修正，不是运行时代码失败。

`git diff --check` 曾通过；最后追加侧栏样式后应再跑一次。

## 5. 真实 App 当前状态

已将本轮文件安装到真实 App，并逐文件 `cmp` 验证。完成 ad-hoc 重签、`codesign --verify --deep --strict`，重启后 Launcher 和网关正常，网关 `127.0.0.1:18789` 曾返回 HTTP 200。

安装文件：

- `laolao-ask-user.css`
- `laolao-ask-user.js`
- `laolao-companion.js`
- `laolao-composer-tray.js`
- `laolao-first-person.js`
- `laolao-metre-skin.css`
- `laolao-mode-switcher.js`
- `laolao-phrases.js`
- `laolao-run-status.js`
- `services/first-person-renderer/index.mjs`

最后一次只更新了 `laolao-metre-skin.css` 并重签，其他文件仍是此前已安装版本。

真机操作记录：

- 真机最初处于学习模式。
- 通过 AX 展开侧栏、打开模式菜单并选择 Metre。
- 切换中的瞬时 AX 显示 URL 已进入 Metre、来源学习页仍在覆盖层下，并存在“正在切换到 Metre”；这是覆盖层未撤时的中间态，不等同最终闪回。
- 随后稳定到 Metre 首页，最终 URL 会话为 `agent:metre:dashboard:c65a6c31-e5c7-4d53-94d9-e2114247edd0`。
- 窗口 id：`15477`。
- 最后已关闭模式菜单，App 停留在 Metre 展开侧栏首页。
- AX 中仍可读“碧琪的首页”“碧琪听着呢”等名称；需区分无障碍容器名称和用户可见残留，继续清查。

GCU 注意事项：

- 工具名：`general_computer_use`；使用对应 Skill，不要凭记忆调用。
- AX 索引会随页面重绘变化，操作前重新观察。
- 原始 Retina PNG / GCU 截图可能超过模型 5 MiB 限制。已采用：
  `screencapture -x -l 15477 <png>`，再 `sips -Z 1600 -s format jpeg ...`，然后 Read JPG。
- 曾遇到 `USER_CONTROL_ACTIVE` 和 Python binding reset；不要重放未确认输入，先重新 `get_app` / `get_state`。
- 强刷新后出现窗口几何变化和模式菜单打开，最后菜单已用 Escape 关闭。

## 6. 真机截图

同目录：

- `expanded-learning.png/.jpg`：学习模式展开侧栏。
- `metre-expanded.png/.jpg`：首次 Metre 首页，左上角旧玻璃圆钮明显。
- `metre-expanded-v2.png/.jpg`：补类名后的效果，仍有残留。
- `metre-expanded-v3.png/.jpg`：强制刷新后的效果，仍有残留。
- `metre-expanded-v4.png/.jpg`：最后 `all: unset` 完整重置后的截图，尚未查看，接手后优先检查。

## 7. 接手后的建议顺序

1. 查看 `metre-expanded-v4.jpg`，确认左上角玻璃圆钮是否消失；若仍在，先通过真实 DOM/计算样式确认元素，不要继续盲加选择器。
2. 真机点击折叠/展开侧栏，检查按钮是否可用、是否重复、命中区是否至少约 32px，底栏昼夜切换和更多工具是否未被加号规则误伤。
3. 打开真实 Metre 会话并展开“思考了 N 秒”，检查图标、标题、正文、背景、边框均为 Metre 配色。
4. 逐一打开工具箱、模型、思考强度弹层，在正常、窄、矮窗口验证边界、滚动、层级、裁切和关闭行为。
5. 用真实工具结果触发 ask_user，验证无碧琪头像、标题、视口定位、滚动、回答前缀及聚焦/关闭。
6. 在 Metre 选中正文，确认没有“问碧琪”；离开 Metre 后确认其他模式原能力仍在。
7. 用长正文和运行条验证聊天区底部留白，收起侧栏后再测一次。
8. 实测碧琪 → Metre、Metre → 碧琪两个方向，最好录屏逐帧确认覆盖层撤下前目标模式已提交，不能只凭最终页面判断。
9. 检查前后端替换词门控和模式切换恢复；避免把恢复机制误当成清理所有历史文案的通用功能。
10. 最后重跑语法、相关测试、`git diff --check`，确认真实 App 文件与 worktree 一致，更新 `PLAN.md` 验收项和本交接文档；用户未验收前不要宣称全部完成。

## 8. 明确未完成

- 展开侧栏最后残留是否由最新规则消除：未确认。
- 收起侧栏视觉和交互：未真机验收。
- 思考记录：未真机验收。
- 三类弹层：未真机验收。
- ask_user：未真机触发。
- 选中文字：未真机验证。
- 聊天区/输入区多尺寸布局：未完整验证。
- 双向过场逐帧与反向实测：未完成。
- 最终测试记录、最终结果文档、Git 提交、用户验收：均未完成。

---

## 9. 接力补记（2026-11-16 05:40–06:00，会话「Metre real app UI 交接」）

### 9.1 Metre 消失事故与恢复（已完成）
- 原因：03:49 与 04:16 有人（用户称是豆包）把 `fix/real-thinking-only` 分支的旧构建（无 Metre）覆盖到真实 App 的 `ui/injections/laolao-head.fragment.html` 与 `runtime/openclaw/dist/control-ui/`，并改了 `services/mode-architecture/setup.py`（删 Metre 部分、加 `reasoningDefault: "stream"`）。`~/.openclaw/openclaw.json` 里 metre agent 一直在。
- 用户决定：恢复 Metre；「思考了」的显示**不改，保持现状**。
- 做法：把 `fix/real-thinking-only` 相对 merge-base 的改动用 `git apply -3` 带进本 worktree（**未提交、无 merge commit**）。唯一冲突是 head.fragment 里 `laolao-cle-stage.js` 版本号，取 `clestage28`。合并后 process-card.js/.css、cle-stage.css、tool-rows.css 与当时线上字节一致。
- 安装：备份到 `/Users/Admin/碧琪实测/backup-app-ui-1116/before-metre-restore-054959`；rsync worktree `ui/injections`、`ui/runtime`、`ui/control-ui.index.html`、`services/mode-architecture/setup.py` 进 App；`python3 tools/ui-parity/bundle.py install --root . --control-ui "<App>/runtime/openclaw/dist/control-ui"` → OK（192 entries / 1598 resources），`check` OK；ad-hoc 重签 + `codesign --verify --deep --strict` 通过。
- 注意：**以后改 UI 要用 bundle.py install 部署到 dist/control-ui**，只改 App 的 `ui/injections` 不会生效（网关从 dist/control-ui 读）。
- 真机：App 已重启（Launcher 新 PID 3156），主窗口 id 当时为 `17989`（会变，用 CGWindowList 找宽>800 的窗口）。截图 `after-reload.jpg`：Metre 首页正常、模式菜单有 Metre 项。
- 截图仍可见：左上角旧玻璃圆钮 + 旁边一个 `+`，侧栏右上一个灰方块（约 303,107）——这就是 PLAN 的首要残留。

### 9.2 未做
- 全量测试 `node --test tests/*.test.mjs tests/*.test.cjs` + `pytest tests/mode_architecture_setup_test.py tests/ui_parity_test.py` 在合并后**跑到一半被停掉，无结果**，新会话要先重跑。
- 第 7 节清单全部仍未完成（从「左上角圆钮/灰方块」开始，先查真实 DOM/计算样式再改）。
- 修改后部署流程：改 worktree → 跑测试 → bundle.py install 到 App → 重签 → 在 App 内 ⌘R（本 App 的 ⌘R 会整体重启）→ 截图核对。
- 提交：用户未要求，不要提交/推送。

---

## 10. 收尾会话（2026-11-16 06:00–07:00，会话「Metre 真机 UI 收尾」）

验收清单与证据见 `PLAN.md` 末尾「11-16 下午验收结果」。要点：

### 10.1 本轮改的文件（全部只在 Metre 作用域生效）
- `ui/injections/laolao-metre-skin.css`：末尾新增「真机核对（11-16 下午）」各段——侧栏顶部三件（分屏钮 / 折叠钮 / 临时会话）、悬停卡片与窄窗抽屉压过运行条、思考记录与工具步骤调色板、思考强度滑条、`::selection`、`canvas.pinkie-burst`、发送 / 语音键。
- `ui/injections/laolao-metre-skin.js`：弹层尺寸变化时重新定位（ResizeObserver）；从 Metre 切往碧琪模式时先放出 `laolao-mode-transition-fx.css`。
- `ui/injections/laolao-metre-cat.js/.css`：猫坐到输入框右上沿 `.pk-metre-perch`，空闲小动作（不改帧文件）。
- `ui/injections/laolao-run-status.js`：额外观察聊天卡片尺寸，侧栏开合时运行条立即跟随。
- `ui/injections/laolao-mode-switcher.js`：完成过场时，涉及 Metre 就在撤层前重画模式按钮、放弃头像换装动效。
- `ui/injections/laolao-phrases.js`：修正上一轮 Metre 跳过改动导致的 6 个原有测试失败（`document` 缺失时安全、空白节点早退顺序、整页本地化合成一个函数）；恢复记录超过 4000 条时清理已脱离的节点。
- `tests/metre-real-app-ui.test.cjs`：侧栏真机钩子测试。

### 10.2 部署要点（纠正第 9 节）
- **⌘R 在这个 App 里没有绑定**（Launcher.swift 注释写明不占用 ⌘R），按了不会重载。要让真机吃到新文件：`bundle.py install` → `codesign --force --deep --sign -` → `osascript -e 'tell application "超級碧琪" to quit'` → `open -a /Applications/超級碧琪.app`。
- `bundle.py install` 会拒绝 App 里被别人直接改过的 `assets/*`（另一会话 06:18 曾直接改 App）；不要强装覆盖，先协调。
- 原生壳会给 `<html>` 加 `data-pinkie-native-glass="1"` 并注入 webkit 桥；分屏入口 `.laolao-mode-dock-trigger` 只在有桥时出现。浏览器里复现：设 `window.webkit = {messageHandlers: {laolaoWorkspaceDock: {postMessage(){}}}}` 后派发 `pinkie-native-bridge-ready`。
- 真机自动点击：`cliclick`，坐标 = 窗口原点 + 截图坐标 × 0.8；侧栏顶部是原生拖拽区，点击可能拖动窗口。
- 部署前备份：`/Users/Admin/碧琪实测/backup-app-ui-1116/before-dock-fix-055840`、`before-install-*`。

### 10.3 测试
- 合并后全量（开工时）：2165 个 / 43 失败；对照 HEAD 干净副本，其中 28 个 HEAD 上就失败（学习台、backdrop、v6 首页等，与本任务无关）。
- 本轮修掉：phrases 相关 6 个、`metre-real-app-ui` 1 个。
- `tests/tuning.test.cjs` 的 `process.maxText 8000≠32000` 来自 `laolao-process-card.js`（另一会话负责），未动。
- pytest 未安装，Python 测试未跑。
- 最终全量结果见 10.4。

### 10.4 最终测试（07:00 左右）
- `node --test tests/*.test.mjs tests/*.test.cjs`：2167 个，34 失败；随后修了 `first-person-renderer` 里钉死旧写法的 1 条（上一轮新写的测试，与更早的 reading-layout 测试互相矛盾）。
- 剩下的失败全部在 HEAD `98b32700` 干净副本上同样失败（学习台 / study-desk / backdrop / v6 首页 / model-picker 文案 / splash / windows 包等），或单独跑能过的偶发项（`model-health` 的 "no auth available"）。没有本轮引入的失败。
- `git diff --check` 通过。未提交、未推送。

### 10.5 留给下一位 / 待用户决定
- ask_user 真实提问卡仍未在真机出现过（模型那一轮失败）；测试会话「这是界面测试：请直接调用…」可删。
- 过程卡标题已由另一会话修好（Metre：正在处理 / 工作过程），07:10 前后与 tuning 默认值修复一起 install + check 通过并重签；App 尚未重启，下次启动生效。历史消息里的「【回答碧琪的提问】」是旧前缀写进存储的原文，不是界面文案。
- 三类弹层、思考记录、选中文字只有浏览器证据。
- 首页点引导语填进输入框是原设计，用户觉得像 bug，待定。
- 状态条里的 `Interrupted` 等英文在 Metre 下不再被碧琪化翻译，显示英文原文，是否要给 Metre 中性中文待定。

## 11. 排版与重复提示（2026-11-16 晚，会话「Metre 真机 UI 排版与重复问题」）

用户截图指出：模式黑卡的方灯掉在卡外；「折叠侧边栏」同时出三个提示；临时会话虚线圆单独掉到第二行；会话行悬停重复弹出完整标题；对话页宽度/样式要照 Claude 的单列排法；「New messages」是英文。

- `laolao-metre-skin.css` 末尾「真机回归 2」：黑卡定宽 128px（原生壳底栏最前面还有一个全屏按钮，140px 会压上去），方灯收进卡内右上角；展开态 `.sidebar-brand` 恢复 0 高（1752 行的 `min-height: 48px` 把会话区整体压下 48px，是虚线圆掉行的根因），临时会话放在收起键右边（x92），右端留给原生分屏钮；对话列：组左右各 6px、回复铺满整列、过程卡去掉 46px 头像缩进 → 正文左边、用户气泡右边、输入框两边对齐。
- `laolao-sidebar.js`：按钮外面已有 openclaw-tooltip 时不再弹自己的提示；提示文字就是已完整显示的文字（标题没截断）时不弹。
- `laolao-sidebar-autohide.js`：不再给折叠钮写 `title`，改为更新外层 openclaw-tooltip 的 `content`。
- `laolao-phrases.js`：Metre 下不再整体关掉本地化，只丢弃会显示「碧琪/Pinkie」的改写（`blockedInMetre`），英文界面字（New messages 等）照常译成中文；进入 Metre 只恢复含碧琪的改写。
- 版本：metreskin13、sidebar metre1116、sidebar-autohide ui1116。测试 `tests/first-person-renderer.test.mjs` 断言随之更新。
- 已 bundle.py install 到 App 的 dist/control-ui 并重签；浏览器 127.0.0.1:18789 刷新核对通过（含模拟原生分屏钮）。App 未重启。
- 备份：`/Users/Admin/碧琪实测/backup-app-ui-1116/before-layout-dedupe-*`。
- 追加（同晚）：黑卡宽度改回 128px（原生壳底栏最前面有「全屏」按钮）；运行条 `.pk-run__body` 去掉描边/圆角（注意元素没有 `id="pk-run"`，1853 起写 `#pk-run` 的规则从未生效）；Metre 下运行 / 完成 / 等你确认时运行条只留 ◆ 芯片，不再重复「思考中 · 已用 N 秒 · 停下」（过程卡和输入框停止键已有），变慢 / 警告 / 中断 / 已停下仍显示。输入框下原生的「Metre is responding… / Done」（.agent-chat__run-status / .agent-chat__composer-progress 的 in-progress、done）在 Metre 隐藏，Interrupted 保留。版本 metreskin16。App 已重签并重启。

## 12. 真机第三轮（2026-11-16 夜，会话「Metre 背景：平面 3D」接着做）

用户截图 6 张 + 原话：「页面 UI 有一些还是用的碧琪的素材没有改干净，思考滑块太过简陋，Metre 模式下老是有按键涂层不对，鼠标靠近显示重复按键介绍（这个没有必要），控制台同步优化一下要有自己的语言不要叫“总控台”“派发”等等」。

- 碧琪残留：删除会话等确认框（`laolao-sidebar.js` showModal → `.laolao-modal*`）、轻提示（`__laolaoToast` → `.laolao-toast`，切 Baton/Virtuoso 时那个粉胶囊就是它）、侧栏提示（`.pinkie-sidebar-tooltip`）都没有 Metre 皮肤 → `laolao-metre-skin.css` 末尾「真机第三轮」1–3。
- 按键涂层：模式黑卡的 `box-shadow: 3px 3px 0 cobalt`（展开 / 收起 / 悬停 / 按下四处）在真机上像错位的蓝色涂层 → 去掉，悬停只把描边变钴蓝（4）。其他模式菜单里的 Metre 黑卡没动。
- 思考滑块 = 节拍器速度（5）：`laolao-metre-skin.js` 按档位写 `data-metre-tempo / data-metre-meta`（off→Prestissimo 208 … high→Andante 88、xhigh→Adagio 66、adaptive→Rubato、max→Lento 52、ultra→Grave 40），弹层上一行衬线斜体速度 + 「♩ = 88 · High」，下一行标尺刻度（原生档长、补出的档短、走过的墨色）+ 钴蓝的杆 + 像素梯形摆锤滑块；输入框下那格也写速度。注意三处冲突（已在 CSS 末尾补）：model-picker 把滑条排在第 2 列、碧琪主题给滑块套了菱形 `-webkit-mask`、那格的 `::before` 被强制 `content: none`。
- 重复的悬停介绍：Metre 下指针进到「已经完整写着字」的元素时先收起它的 `title`、出去再放回（不改别的脚本的属性）；侧栏自己的提示同样判断（`laolao-sidebar.js` showSidebarTooltip）。字被截断的、只有图标的照旧有提示。总谱入口的 title 删了。
- 控制台的话（`laolao-metre-board.js`、`-board-data.js`、`services/mode-architecture/metre-board.mjs`、brand、猫的状态名）：总控台→**总谱**、派发→**分谱**、子会话→**声部**、在跑→在奏、全部停下→**全体收住**、接着做→接着奏、还没派过活→**还没起拍**、空闲→休止、已停→已收住；分区：计划→节目单、时间线→小节、改动→改谱、运行环境→调音、原始记录→排练记录；首页「看板」→**谱架**。模型看到的工具文案（session-lineage.mjs）没改。
- 版本：metreskin17 / metre-skin.js metreskin4 / sidebar metre1116b / metreboard4（两个）/ metrebrand4。测试：`metre-real-app-ui` 加一条；Metre 相关 108 条全过。
- 浏览器核对（127.0.0.1:18789，往页面里注入新 CSS / JS，没装进 App）：滑条、输入框下「Andante」、确认框、轻提示、黑卡无投影都看过。没看：总谱面板的新字（要装进 App 才有）、悬停不弹原生提示（WebView 的原生提示截不到）。
- 没装进 App、没提交。App 里现在仍是：背景「落拍」版、旧猫、旧皮肤。
