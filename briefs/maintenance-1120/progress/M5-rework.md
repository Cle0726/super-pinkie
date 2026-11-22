# M5 返工 · 让界面护栏测试真实页面

## 接力卡（最后更新：2026-11-21 18:45 -08:00，Gemini-Win-m5r8 @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m5-fix-real-page`（即将创建草稿 PR）
- 已完成：
  1. `git -C F:\Projects\super-pinkie fetch origin`，新建隔离工作区 `C:\Users\34786\Projects\pinkie-wt\m5-rework-exec`（分支 `maint/m5-fix-real-page`）与隔离临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m5-rework-exec-m5r8`。
  2. 记录 Z2 开工现场快照（`openclaw.json`、安装目录、数据目录修改时间及 18789 / 5150–5154 端口监听状态）。
  3. 执行 CONCURRENCY 3.8 开工反例：在 `ui/injections/laolao-night.css` 临时追加一处 `!important`，`node --test tests/code-health-ratchet.test.mjs` 退出码 1 拦截成功，原字节还原后 SHA-256 一致（`8B4FECBD6DB64F09634A7E155571871FB42FC04E3C51089CB200266F653961D4`）且复跑 3/3 通过。
- 正在做：排查并修复 `sidebar-collapsed-day` 6px 渲染抖动根因，搭建基于隔离安装 `openclaw@2026.7.1-2` + `tools/ui-parity/bundle.py` + `tools/assets/stamp.mjs` + `fake-gateway.js` 的真实 `dist/control-ui/index.html` 视觉与热点回归护栏。
- 下一步：
  1. 定位并修复 CI Run `44973781202` Attempt 1 中 `sidebar-collapsed-day` 出现 6px 抖动的根因（不放宽容差）。
  2. 实现 `tests/visual/lib/real-harness.mjs`：读取 `desktop/windows/runtime-manifest.json` 的 `openclaw` 版本（`2026.7.1-2`），在隔离目录安装 npm 包并用 `bundle.py install` + `stamp.mjs` 装入碧琪界面，打开真实 `dist/control-ui/index.html`。
  3. 编写 `tests/visual-real-baseline.test.mjs`、`tests/hotspot-real-ui-regression.test.mjs` 并更新 `tests/shared-dom-watch.test.mjs` 覆盖真实页面。
  4. 通过临时 workflow 在 Linux Chromium 采集 `tests/visual/real-baseline/*.png`（24 张），验证 3 次 0px 抖动后删除临时 workflow。
  5. 对真实产品文件做至少 5 个反例（侧栏宽度、标题栏按钮区遮挡、模式切换失效、输入框浮层、删除运行时分块），全部验证失败后还原并记录 SHA-256。
  6. 在同一提交上连续触发/验证 3 次 CI 运行全绿。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m5-rework-exec`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m5-rework-exec-m5r8`；端口 5150–5154；后台进程：无
- 正在跑的长操作：无
- 踩过的坑：无
- 待用户决定：无

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
