# Metre 整页动画原型（预览页专用，不是产品代码）

这里是 11-23 在 Chrome 预览页里做的「总谱」版整页动画原型（第三版），用户看过后的结论是「方向对，细节要调」。**还没有落进 `ui/injections/`**，产品代码里跑的仍是补丁里的第三轮进场。

## 文件

- `v3.js` / `v3.css`：原型本体。在预览页里覆盖 `window.PinkieMetreTransition`，并接管换会话、首页亮灯、引导语四个时刻。`sessionStorage pv-ver=1` 时不生效（= 旧版）。
- `preview-server.mjs`：预览服务。原生 control-ui（`build\windows-runtime\node_modules\openclaw\dist\control-ui`）+ worktree 的 `laolao-*` 注入 + 页面内假网关（`scripts/chat-ui-harness/fake-gateway.js`）。只在发给浏览器的假网关副本里让 `pinkie.guard.metre*` 回答「不用密码」，仓库代码和解锁门槛不动。
- `preview-init.js`：网址参数 → 日夜（`night=0|1`）、首页 / 对话页（`empty=1|0`）、版本（`v=1` 旧版 / `v=3` 总谱版）；放假会话和假消息。
- `preview.js`：右上角的预览面板（重放切进 Metre、换会话、首页进场；切日夜、首页 / 对话页、新旧版）。
- `film-ours.js`：无头 Chrome 录三段（首页进场、切进 Metre、换会话），每 60–70ms 一张。
- `preview-check.js`：打开一次、记状态和报错、截一张。`probe-lights.js`：首页亮灯三个时刻截画带。
- `capture.mjs` / `compare.mjs`：用仓库自己的 `tests/visual/lib/harness.mjs` 截 24 张、逐像素比（Windows 上 `visual-baseline` 只渲染不比对，靠这两个补上）。
- `open-chrome.js`：在用户桌面开一个独立资料目录的 Chrome 窗口看预览。
- `shots/`：总谱版的逐帧拼图（日间 / 夜间）。

这些脚本里写死了本机路径（`F:\Projects\super-pinkie\build\quick-run\mui\`），活的副本在那个目录里；这里是存档。

## 总谱版四个时刻（v3）

1. 切进 Metre：两半谱纸合上（380ms）→ 五线从左往右划出、像素 M 当谱号一列列亮 → 指挥棒每拍（250ms）落在一个音符上、拍间上弹、留钴蓝轨迹，四个音往上走，谱号里的摆跟拍 → 小猫坐在小节线后（**用户 11-23：去掉**）→ 落拍时谱纸从中缝上下翻开（420ms），发 `pinkie:metre-sweep`。
2. 换会话：旧内容左移淡出（208ms）→ 一根小节线带小节号从右往左划（520ms），新内容从右进来。**用户 11-23：「太白了，没有设计感」，要重做。**
3. 首页亮灯：像素舞台不改；天幕从中间往两边亮 → 地板上 8 盏灯按三十二分音符一盏盏亮（每盏一圈三档的光）→ 指挥台最后亮（1.25 拍），之后整台全开。指挥台位置目前从画面里找（最深最实的一段），落进代码时要改成读 `buildScene` 的锚点。
4. 引导语：每个词先停在不同高度（像音高，6px 一级），再按拍子依次落回、轻弹一下；动的是叠在上面的拷贝，原文排版不变；落定后关键词下面那排点亮。
