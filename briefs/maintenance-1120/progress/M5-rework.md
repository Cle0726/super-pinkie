# M5 返工 · 让界面护栏测试真实页面

## 接力卡（最后更新：2026-11-21 23:42 -08:00，Gemini-Win-m5r8 @ Windows）

- 状态：进行中（WIP 已提交并推送至草稿 PR #59）
- 分支和 PR：`maint/m5-fix-real-page`，草稿 PR `#59`（[https://github.com/Cle0726/super-pinkie/pull/59](https://github.com/Cle0726/super-pinkie/pull/59)）
- 已完成：
  1. `git -C F:\Projects\super-pinkie fetch origin`，新建隔离工作区 `C:\Users\34786\Projects\pinkie-wt\m5-rework-exec`（分支 `maint/m5-fix-real-page`）与隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m5-rework-exec-m5r8`。
  2. 记录 Z2 开工现场快照（`openclaw.json`、安装目录、数据目录修改时间及 18789 / 5150–5154 端口监听状态）。
  3. 执行 CONCURRENCY 3.8 开工反例：`ui/injections/laolao-night.css` 临时追加 `!important` 后 `tests/code-health-ratchet.test.mjs` 退出码 1 拦截，还原后 SHA-256 一致（`8B4FECBD6DB64F09634A7E155571871FB42FC04E3C51089CB200266F653961D4`）且复跑 3/3 通过。
  4. 定位 `sidebar-collapsed-day` 6px 抖动根因并修复 `tests/visual/lib/harness.mjs`（不放宽容差、不改 `tests/visual/baseline/**`）：
     - 根因：`openScenePage` 仅检查 `img.complete` 而未调用 `img.decode()`；未等待 CSS `background-image`（如 `body::before` 1.61MB `laolao-wallpaper-project.png`）解码；未在 `fonts.ready` + 解码后等待双 `requestAnimationFrame` 合成提交；`renderSceneBody` 始终先输出 `data-theme-mode="light"` 再加载后翻属性；未传 `--num-raster-threads=1`。
  5. 将真实页面护栏主交付移入仓库工作区（WIP）：
     - `tests/visual/lib/real-harness.mjs`：读取 `desktop/windows/runtime-manifest.json` 的 `openclaw` 版本（`2026.7.1-2`），在隔离目录用 `npm pack` + `tar` 提取上游 `dist/control-ui`，再调用仓库自带 `tools/ui-parity/bundle.py install` + `tools/assets/stamp.mjs` + `bundle.py check`，配 `scripts/chat-ui-harness/fake-gateway.js` 和 `app/windows_bridge_scripts.py`（`BRIDGE_SCRIPT`）启动本地服务（优先端口 `5150–5154`）打开真实 `dist/control-ui/index.html`（无手写骨架）。
     - `tests/visual-real-baseline.test.mjs`：12 画面 × 日夜（24 张）真实页面基线（仅指向 `tests/visual/real-baseline/`）与 3 次 0px 抖动检测。
     - `tests/hotspot-real-ui-regression.test.mjs`：10 个热点模块（H1–H10）面向真实页面的回归测试。
- 正在做：在本地单浏览器串行验证 `tests/visual/lib/harness.mjs`（旧基线 3× 0px）、`tests/hotspot-real-ui-regression.test.mjs`、真实页面 24 画面 3× 0px 自洽性，并补齐 `tests/shared-dom-watch.test.mjs` 真实页面检查（不改 `ui/injections/laolao-dom-watch.js`，不把 main 已知错误行为写成期望）。
- 下一步：
  1. 逐项跑通并校准 `tests/hotspot-real-ui-regression.test.mjs`、`tests/visual-real-baseline.test.mjs`（自洽性）与 `tests/shared-dom-watch.test.mjs`（真实页面）。
  2. 对真实产品文件做至少 5 个反例（侧栏宽度、标题栏按钮区遮挡、模式切换失效、输入框浮层、删除已安装 control-ui 运行时分块），每个都验证测试失败，原字节还原并贴 SHA-256。
  3. **等待 PR #61 合并并 rebase 后**，再通过临时 workflow 在 Linux Chromium 采集正式 `tests/visual/real-baseline/*.png`（24 张），随后删除临时 workflow。
  4. 跑 Windows Edge 校验（M5-5）、全量门禁，以及同一最终提交在 CI 连续 3 次全绿，记录 Z2 收工快照并清理本人临时目录。
- 临时目录内容清单（`C:\Users\34786\AppData\Local\Temp\pinkie-m5-rework-exec-m5r8`，均为临时缓存/探针，任务结束前清理）：
  - `node-deps/`：隔离安装的 `playwright@1.64.1`、`ws@8.23.0`（供本地 `NODE_PATH` 使用）
  - `oc-probe/`：探针阶段预提取的 `openclaw@2026.7.1-2` 副本
  - `home/`、`appdata/`、`localappdata/`、`npm-prefix/`、`temp/`：隔离环境变量目录
  - `z2-opening.json`：Z2 开工现场快照 JSON
  - `probe-*.mjs`、`inspect-*.mjs`、`check-*.mjs`、`test-repeat.mjs`、`probe-shots/`、`pr-body.md`：前期调研探针脚本与临时截图（不属于最终交付，核心逻辑已收口进 `tests/visual/lib/real-harness.mjs`）
- 协调约束：
  - PR `#61`（`maint/m3-fix-dom-watch`）正在修复 `ui/injections/laolao-dom-watch.js`，本分支不碰该文件，且在 `#61` 合并并 rebase 前不采正式 Linux 真实页面基线。
  - 机器内存偏紧：浏览器测试与全量门禁一次只跑一个，用完立即关闭。
- 没推送的东西：即将推送本次 WIP 提交。
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m5-rework-exec`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m5-rework-exec-m5r8`；端口 5150–5154；后台进程：无
- 正在跑的长操作：无
- 踩过的坑：
  - `C:\tmp` 需管理员权限，改用 `%TEMP%\pinkie-m5-rework-exec-m5r8`；Windows 隔离 `USERPROFILE` 下需预建 `AppData\Local` / `LocalLow` / `Roaming`，否则 Edge/Chrome 报 `PathService` 错误。
  - 真实页面冷启动 `/chat` 会触发 `laolao-startup-home.js` 建空白草稿会话；非首页场景需预置 `sessionStorage['laolao:startup-home-seen']='1'`，首页场景需在 `sessions.list` 提供匹配当前 `SK` 的空白会话 `新会话` 且固定 `Date`/`Math.random`/`performance.now` 才能 0px 稳定。
- 待用户决定：无（等待 PR #61 合并后再采正式 Linux 基线）

---

## 一、Z2 开工 / 收工现场快照

| 检查项 | 开工快照（2026-11-22T02:44:09.8459739Z） | 收工快照 | 结果 |
|---|---|---|---|
| `%USERPROFILE%\.openclaw\openclaw.json` LastWriteTimeUtc | `2026-11-20T07:56:00.7371058Z` | 待收工记录 | 进行中 |
| `%USERPROFILE%\.openclaw` LastWriteTimeUtc / 文件数 | `2026-11-21T18:36:03.7046384Z` / `3557` | 待收工记录 | 进行中 |
| `%LOCALAPPDATA%\Programs\SuperPinkie` LastWriteTimeUtc / 文件数 | `2026-11-21T11:36:23.8784727Z` / `41629` | 待收工记录 | 进行中 |
| `%LOCALAPPDATA%\SuperPinkie` LastWriteTimeUtc / 文件数 | `2026-11-21T12:26:46.2369231Z` / `3472` | 待收工记录 | 进行中 |
| 18789 端口监听 PID | `[]`（无监听） | 待收工记录 | 进行中 |
| 5150–5154 端口监听 PID | `[]`（无监听） | 待收工记录 | 进行中 |
| C 盘剩余空间 | `22.76 GB`（> 8 GB） | 待收工记录 | 进行中 |

---

## 二、CONCURRENCY 3.8 开工护栏反例

- 目标文件：`ui/injections/laolao-night.css`
- 修改前 SHA-256：`8B4FECBD6DB64F09634A7E155571871FB42FC04E3C51089CB200266F653961D4`
- 临时改动：末尾追加 `/* probe */ .m5-rework-probe { color: red !important; }`
- 执行命令：`node --test tests/code-health-ratchet.test.mjs`
- 退出码：`1`
- 失败输出片段：
  ```text
  ✖ 代码健康度：每个文件不能变差，改善后要同步基线 (5633.753ms)
    AssertionError [ERR_ASSERTION]: 代码健康度检查未通过：
    - ui/injections/laolao-night.css：!important（强制覆盖）增加（基线 461 → 当前 462）。
    - ui/injections/laolao-night.css：行数增加（基线 543 → 当前 545）。
  ```
- 还原后 SHA-256：`8B4FECBD6DB64F09634A7E155571871FB42FC04E3C51089CB200266F653961D4`（完全一致）
- 还原后复跑：`node --test tests/code-health-ratchet.test.mjs` 退出码 `0`（`pass 3, fail 0`）。
