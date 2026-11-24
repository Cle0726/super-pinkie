# M0 返工：堵住棘轮的口子

## 接力卡（最后更新：2026-11-23 19:40 -08:00，Claude-Win-r7m3 @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m0-fix-ratchet`，PR 待开（草稿）
- 依据：`briefs/maintenance-1120/review/M0-precheck.md`（PR #60 分支 `maint/foundation-audit`）的 L1–L7 和 `hotspots.mjs` 浅克隆问题；任务单 `tasks/h.md`。
- 已完成：
  1. 从 `origin/main`（`12b644ea`）建工作区，读完 `measure.mjs`、`ratchet.mjs`、`hotspots.mjs`、棘轮测试和 CI；摸清扫描盲区（见下面「设计」）。
  2. 开工现场快照（只读元数据，2026-11-23 19:08:07 -08:00）：`%LOCALAPPDATA%\Programs\SuperPinkie` 修改时间 2026-11-22 03:43:02；`%LOCALAPPDATA%\SuperPinkie` 2026-11-22 22:54:31；`~/.openclaw` 2026-11-22 16:58:37；`~/.openclaw/openclaw.json` 2026-11-21 21:54:19；18789 端口无监听；C 盘剩 13G。
- 正在做：先在干净 main 上跑一遍全部反例，记下「修之前退出 0」的证据，再改代码。
- 下一步：改 `measure.mjs`（全仓扫描 + 显式第三方清单 + 新写法 + NUL 报错）、`ratchet.mjs`（没用到的例外报错）、`--write-baseline`（只写改善）、新增 `compare-baseline.mjs` 和 `.github/workflows/health.yml`（和目标分支比）、`hotspots.mjs`（浅克隆报错），每个口子一个反例测试。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m0-fix-exec`；临时目录 `C:\tmp\pinkie-m0-exec-*`（待建）；端口不用；后台进程无
- 正在跑的长操作：无
- 踩过的坑：上一个会话进程被杀，接手时工作区干净、分支没推送，从读代码处继续。
- 待用户决定：无

## 设计（打算怎么堵）

| 口子 | 现在的问题 | 打算的做法 |
|---|---|---|
| L1 别的 UI 目录 | `ui/party`、`ui/roundtable`、`ui/launcher-loading.html` 不量 | `ui/` 下除 `ui/injections` 和生成的 `ui/runtime` 外的手写页面单独成一节逐文件量，节名新加，不动已有数字 |
| L2 没扫的目录 | 只扫 7 个根目录 | 超 1500 行检查改成全仓（git 跟踪的文件 + 未跟踪未忽略的新文件），只排除显式清单 |
| L3 排除前缀 | `laolao-vendor-*`、任意名叫 `vendor/` 的目录都跳过 | 改成显式第三方清单，清单外的一律量；清单里写了但不存在的报错 |
| L4a/L4b 写法 | 注释拆开、CSS 转义、`setProperty(...,'important')`、`new window.MutationObserver`、变量传 observe 选项、`window['setInterval']`、`globalThis.__x`、`||=`、拼接版本号 | 补正则；现有文件里已出现的写法（`setProperty` 6 处、变量传选项 2 处）记成新指标，不抬高已有数字 |
| L5a/b | 手改 `baseline.json` / `exceptions.json` 能放行 | CI 新加一项和 PR 目标分支比：基线任何一项不许上升；例外新增或抬高让检查变红并列出来 |
| L5c | 没用到的例外不报错 | 棘轮测试里报错 |
| L6 NUL | 含 NUL 或非 UTF-8 的源码文件静默跳过 | 报错 |
| L7 `--write-baseline` | 有例外就退出 1 | 只写改善的数字，例外的增长不写也不失败，没登记的增长仍然失败 |
| hotspots | 浅克隆静默少算 | 浅克隆直接报错退出 1 |
