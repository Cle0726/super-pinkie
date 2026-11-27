# #157 菜单对比度测试偶发红 · 接力卡

新的一条写在最上面。

## 接力卡（最后更新：2026-11-26 10:25 UTC，macdev4 @ Mac）

- 状态：**自查通过**（等协调者复核、改 ready、合并；本线按 `open-macdev4.md` 不执行 `gh pr ready` / `gh pr merge`）
- 分支和 PR：`mac/menu-contrast-flaky`，PR #157（草稿，base main）。按 mac-coord 2026-11-26 10:03:45Z 口径属 ①「只改测试 / 只加新文件」。
- 已完成：
  1. `8803be43` 改法：`tests/metre-engine-menu-contrast.test.mjs` 去掉固定 300ms 等待，改成 `waitForFunction(..., {polling: 'raf', timeout: 10000})`，等悬停行处于 `:hover`、底色 alpha=255、连续两帧取色不变再量对比度。净改动只有这一个测试文件 +12/-1，不碰产品代码。
  2. `a1c06f4b`、`bb05fc61`、`264baa23` 三次普通 `git merge origin/main`（不 rebase、不 force）；三次前后本 PR 净改动 patch-id 都是 `b224cc6239719142f94a9c49c6375a194dfdfdc1`，未变。
  3. 原因：webkit-suite 偶发红（run 45758071126、45749129144 第 94 行），菜单行 hover 过渡没走完就取色。
  4. 本机复跑：Chromium 10/10 过、WebKit 10/10 过。
  5. 反例（真做、做完还原、未提交）：给菜单行加 `transition-delay: 1s`——旧写法（固定 300ms）两个引擎都红，新写法两个引擎都绿。
  6. CI @`264baa23` 六项全过（run 45777053321 / 45777053395 / 45777053399）；macwatch 已严审通过（a1c06f4b 两引擎各 2/2 + delay1s 反例真红）。
- 自查（ACCEPTANCE §一）：
  - CI 全绿：过（见上）。
  - 全量门禁：本线规矩「CI 是准，本机不跑全量门禁」，以 CI 为准，本机未跑。
  - 健康度棘轮：CI ratchet 过；本 PR 不新增、不加长任何产品文件。
  - 截图 / 视觉回归：CI webkit-suite、portable 过；未改 `ui/`，未动 `tests/visual/baseline/`，不需要 pr-shots。
  - known-failures.json：未改。
  - 正式环境：没碰正式 App、`~/.openclaw`、18789 网关。
- 正在做：无。
- 下一步：协调者转 ready → [merge]；合入后 macdev4 删 `wt-macdev4-157` 工作区，#155 普通 merge 一次 origin/main。
- 没推送的东西：无（反例改动已还原）。
- 环境：工作区 `/Users/Admin/pinkie-mac/wt-macdev4-157`；浏览器单测持 `$HOME/pinkie-mac/status/browser.lock.d`。
- 正在跑的长操作：无。
- 踩过的坑：固定时长等待在 WebKit 上不可靠，要等状态而不是等时间。
- ★ 条目：本计划 PLAN / PROGRESS 里没有带 ★ 的自查条目；按 ACCEPTANCE §一 的必做项逐条记在上面，全部通过，没有「没测（需 Mac/Windows）」项。
- 待用户决定：无（ready / 合并由协调者做）。
- 备注：本卡是本 PR 唯一新增的文件，只是文档；测试文件 patch-id 仍是 `b224cc62`。
