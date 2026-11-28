# M2 独立复测报告（发版前独立复核）

## 接力卡（最后更新：2026-11-21 19:15 -08:00，Gemini-Win-3b7e @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m2-m4-audit`，[PR #58](https://github.com/Cle0726/super-pinkie/pull/58)（草稿）
- 核对的 main 提交：`fa57fcc7da5e05e259e72d149c67235ebed750c2`
- 已完成：
  1. 创建独立工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit` 及 C 盘临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`，记录 Z2 开工只读现场快照并开启草稿 PR #58。
  2. 完成 CONCURRENCY 3.8 M0 棘轮护栏反例（`ui/injections/laolao-night.css` 临时加 1 处 `!important` 退出码 `1`，原字节还原 SHA-256 `8B4FECBD6DB64F09634A7E155571871FB42FC04E3C51089CB200266F653961D4` 后 3/3 通过）。
  3. 完成 **M2-1 ★** 源码零手写版本号核查与反例（`measure.mjs` 手写版本号 `total: 0`，头部清单 202 处 `?v=@hash`，`ui/runtime/index-Bvtt7vVx.js` 2 处 `./chat-page-DrPkxqJK.js?v=@hash`；反例注入 `manual99` 与 `chat99` 后 `healthChanges` 立即报 `手写版本号总数增加（基线 0 → 当前 2）`）。
  4. 完成 **M2-2 ★** 各安装路径（Windows 安装器 `installer/windows/apply-theme.ps1`、Windows 打包 `bundle.py install` + `stamp.mjs`、更新器/启动器 `super_pinkie.py:install_theme`、`tools/claude-deploy/deploy-work-first.py`）1 字节修改仅变自身（与 `laolao-asset-manifest.js`）版本号实测及反例；同时排查出两处历史部署脚本未接入 `stamp.mjs`（`tools/claude-deploy/deploy-browser-memory-compaction.py:35` 与 `tools/study-desk/deploy-game.py:35`）以及静态资源模板残留 4 处 `?v=20260828`（`ui/control-ui.index.html:13` 与 `ui/assets/manifest.webmanifest:11,17,22`）。
  5. 完成 **M2-3 ★** 端口 `5125` 隔离网关 + Edge Chromium（Playwright 同一 `BrowserContext`）旧缓存升级实测与反例（修改后重盖哈希二次访问返回 HTTP `200` 并执行 `v2-upgraded` / `drill-v2-upgraded`，未修改文件返回 HTTP `304`；反例不重盖哈希在强缓存下命中旧缓存 `v2-upgraded` 拿不到 `v3-unstamped`）。
  6. 完成 **M2-4 ★** 双分支 `git merge-tree --write-tree` 零冲突实测与反例（正例退出码 `0`，树 `ca6af23727bc856f42e16b37092bd993209ce9be`；反例模拟 M2 前手写改版本号退出码 `1`，报 `CONFLICT (content): Merge conflict in ui/injections/laolao-head.fragment.html`）。
  7. 完成 **M2-5** `tests/windows-self-contained.test.cjs`（16/16 通过）与 `bundle.py compare` Windows 漏文件新版本反例（退出码 `1`，报 `ValueError: Mac and Windows packaged UI manifests differ`）。
  8. 完成 **Z4 ★** 与 **Z5 ★** 复核。
- 正在做：准备执行 `Z1 ★` 全量门禁（`node tools/release-gate/run-tests.mjs` 与 Python 单元测试）及 `v2.5.53 → main` 隔离升级复测。
- 下一步：运行全量门禁与隔离升级验证，补齐 Z1 与 Z2 收工现场快照并完成最终报告。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`；端口 5125–5129（5125 已释放）；后台进程：无
- 正在跑的长操作：无
- 踩过的坑：`ui/control-ui.index.html` 中 `/assets/index-Bvtt7vVx.js` 的版本号参数位于已有查询串之后（`&v=<10hex>`），解析 HTML 资源版本时需同时匹配 `[?&]v=`。
- 待用户决定：无
