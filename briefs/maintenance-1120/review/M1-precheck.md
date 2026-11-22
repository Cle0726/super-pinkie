# M1 独立复核报告（Precheck）

## 接力卡（最后更新：2026-11-21 19:12 -08:00，Gemini-Win-4e9a @ Windows）

- 状态：M1 已完成（整批 M0/M1/M7/K0/K1 复核进行中）
- 分支和 PR：`maint/foundation-audit`，PR #60（草稿）
- 核对的 `origin/main` 提交：`fa57fcc7da5e05e259e72d149c67235ebed750c2`（M1 合并提交：PR #44 `bc4262d33bca99589e8976e62f404a7ecf8383e1`、PR #42 `1851ade8`）
- 已完成：
  1. `BRANCHES.md` 清点覆盖度核验（对照 `PLAN.md` 附录 A 全量分支）；
  2. 23 条被删远端分支逐条 `git ls-remote` 核对存档标签、完整 40 位 SHA、远端删除状态与独有提交是否丢失；
  3. 3 条随机存档标签在隔离空裸库中只读拉取验证精确还原原头（不向远端恢复或删除任何引用）；
  4. 学习台游戏 v4（`audit/pinkie-1112`，`f33c4186`）4 提交 165 个改动文件逐文件核对 + Windows 隔离 Chrome 实开 `tools/study-game/play.mjs` 五入口（`wardrobe`/`gacha`/`hunt`/`exam`/`map`）验证 + 41 项定向测试通过；
  5. 当前远端 116 条分支全量未合并扫描（M1-5）与 `CLAUDE.md` 分支规矩核对（M1-6）。
- 正在做：整理 M7 复核结果并开始 K0 / K1 核验
- 下一步：推送 M0/M1 复核结果，完成 M7、K0、K1 核验
- 环境：工作区 `%USERPROFILE%\Projects\pinkie-wt\foundation-audit`；临时目录 `%LOCALAPPDATA%\Temp\pinkie-foundation-audit-4e9a`；端口 5115（已释放）；后台进程 无

---

## 结论：**通过（全部 ★ 必过项实测成立；无远端分支缺失存档标签、无独有提交丢失、学习台游戏 v4 完整进入 main 且五入口真浏览器可用；仅发现 1 项次要信息规范问题）**

---

## 逐条核对（`briefs/maintenance-1120/ACCEPTANCE.md`）

| 条目 | 结论 | 证据（命令、退出码、输出原文片段、文件路径） | 复现命令 |
|---|---|---|---|
| **M1-1 ★** | **过** | 核对 `briefs/maintenance-1120/BRANCHES.md` 覆盖 `PLAN.md` 附录 A 全部 47 条未合并旧分支（`wip-snapshot-1111/*` 5 条已逐条展开）及快照时 2 条活跃计划分支，共 49 条，每条均附完整 40 位快照头 SHA、落后/独有数、`git cherry +/-`、涉及/差异路径数、A/B/C/D 分类与理由；PR #43 后快照复查补充了 3 条新增分支并将 `integration/all-fixes` 复核证据记入正文。 | 检查 `briefs/maintenance-1120/BRANCHES.md` 对照 `PLAN.md` 附录 A |
| **M1-2 ★** | **过** | **① 代码完整性（逐文件核对）**：`archive/2026-11/audit/pinkie-1112`（`f33c4186dc69249e6804a218a9850be4edca1128`）相对共同祖先 `f5a1917f` 共有 4 个提交（`0d5e410e`、`8f889550`、`f5f487a1`、`f33c4186`），共触及 **165** 个文件。逐 blob 对比 M1 合并提交 `bc4262d3`：**159/165 完全逐字节一致**；仅剩 6 个差异文件全部为合理保留主线较新改动：<br>  - `services/mode-architecture/learning-game-content.mjs`、`learning-game-exam.mjs`、`ui/injections/laolao-game-battle.js`、`laolao-game-hud.js`：主线晚于 v4 的称呼更新（`先生` → `用户`）；<br>  - `tools/study-desk/harness.mjs`：主线较新的 `launchWithHarness` 与隔离路径保护 + 端口参数；<br>  - `ui/injections/laolao-head.fragment.html`：保留主线后续模块条目，并完整合入 v4 的 4 个新资源（`laolao-game-loadout.{css,js}`、`laolao-game-stage.{css,js}`，当前 `origin/main` 第 197–200 行均在且已随 M2 转为 `?v=@hash`）。<br>对比当前 `origin/main`（`fa57fcc7`）仅另多 1 个 `tests/learning-game.test.mjs`（后续维护改动），v4 功能无丢失。<br>**② 定向测试**：运行 `node --test tests/learning-game.test.mjs tests/learning-game-v4.test.mjs tests/learning-game-battle.test.mjs tests/ui-real-thinking-only.test.mjs tests/learning-materials-windows-worker.test.mjs` → 退出 `0`（`tests 41 \| pass 41 \| fail 0`）。<br>**③ 真浏览器五入口实测（Chrome 隔离试玩，端口 5115）**：启动 `node tools/study-game/play.mjs --port=5115 --papers=<空目录>`，使用独立安装的 `playwright-core@1.64.1` 驱动系统 Chrome 访问 `http://127.0.0.1:5115/chat`，4 个 v4 新资源全部返回 HTTP `200`，零页面错误/零控制台错误（`PAGE_ERRORS: []`, `CONSOLE_ERRORS: []`），逐一点开五入口全部可见并落盘截图（存隔离目录，收工清理）：<br>  - `wardrobe`：`.pks-wardrobe .pks-tile` `visible=true, count=24`（截图 `1,115,132 B`, SHA-256 前 16 位 `e25cfb463aa4c314`）<br>  - `gacha`：`.pks-gacha .pks-pull` `visible=true, count=2`（截图 `484,547 B`, `4c2a4827b474722b`）<br>  - `hunt`：`.pkb-hunt .pkb-mon` `visible=true, count=6`（截图 `740,726 B`, `5e1a6f522f106d9f`）<br>  - `exam`：`.pke-page .pke-ftable .pke-frow` `visible=true, count=6`（截图 `698,078 B`, `159cb50065748baf`）<br>  - `map`：`.pkw-page .pkw-tab` `visible=true, count=7`（截图 `811,744 B`, `215b0ba2ed78d1b6`）<br>结束后试玩进程、`tools/study-desk/isolated-*` 与端口 5115 全部释放。 | `git diff --name-status f5a1917f..f33c4186` 逐文件比对 `bc4262d3`；隔离运行 `node tools/study-game/play.mjs --port=5115` + Playwright 点击五入口；`node --test tests/learning-game*.test.mjs` |
| **M1-3 ★** | **过** | 运行 `git ls-remote --tags origin "refs/tags/archive/*"` 与 `git ls-remote --heads origin`（退出 `0`）：`BRANCHES.md` 删除表全部 **23** 条被删分支（15 A + 6 C + 2 已合 B）均满足：① 远端 `refs/tags/archive/2026-11/<原分支>` 存在（`tagMissing: 0`，无多余标签 `extraTags: []`）；② 标签 SHA 与 `BRANCHES.md` 记录的 40 位原头完全一致（`shaMismatch: 0`）；③ 远端原分支已删除（`branchStillExists: 0`）；④ 23 个提交对象全部完整存在（`missingLocal: 0`）。<br>**独有提交丢失核查**：对全部 23 个归档头逐条执行 `git cherry bc4262d3 <sha>` 与路径对比：<br>  - 12 条 A 类：`cherry = +0/-N`（所有补丁在 `main` 已有等价提交；其中 6 条 `repair/*` 修改的 `services/cle-studio/` 属旧架构目录，对应补丁已并入后随 `cle-studio` 整体下线）；<br>  - 2 条 A 类（`feat/metre-roles-1118-2`、`fix/windows-learning-worker-1119`）：因压缩合并显示 `+`，但逐路径比对 `bc4262d3` 差异文件数均为 **`0`**（32/32、2/2 逐字节一致）；<br>  - 1 条 A 类（`integration/all-fixes`）：`cherry = +0/-0`，独立核查其 6 个合并提交的第二父（`b35196af`、`f4d16b2e`、`8cd4b045`、`cb518a19`、`30f06a80`、`59a6b0fa`）**6/6 均为 `origin/main` 祖先**；<br>  - 6 条 C 类（`feat/metre-roles-1118-{1,3,4}`、`feat/windows-browser-pointer-autonode`、`feat/windows-inapp-browser-vpn`、`fix/real-thinking-only`）：核对其全部独有提交标题与主线替代实现（#29 Metre 角色、#17/#20 内置浏览器、主线 `tests/ui-real-thinking-only.test.mjs` 4/4 通过），确属被替代分支且归档标签完好；<br>  - 2 条已合 B 类（`audit/pinkie-1112`、`unify/pinkie-1112`）：同头 `f33c4186`，见 M1-2 核验完整入主线。**结论：未发现独有提交丢失。** | `git ls-remote --tags origin "refs/tags/archive/*"`；`git ls-remote --heads origin`；逐条 `git cherry bc4262d3 <sha>` |
| **M1-4 ★** | **过** | `BRANCHES.md` §实际存档和删除 逐条列出全部 23 条的分支名、类别、40 位旧头、存档标签、UTC 删除时间（`2026-11-21T12:32:16Z` 与 `2026-11-21T13:52:56Z`）。在隔离临时空裸库（不碰 `origin` 和主仓库，验完即删）中随机抽取 3 条从 GitHub 直接只读拉取验证（与原执行者抽样的 3 条不同）：<br>  - `archive/2026-11/audit/pinkie-1112` → `f33c4186dc69249e6804a218a9850be4edca1128`（`match=True`）<br>  - `archive/2026-11/feat/metre-roles-1118-3` → `aebb3aaf9a942da8af1527f1892bbb652aafd1c1`（`match=True`）<br>  - `archive/2026-11/repair/models` → `476b1110dd7baa16a7e2994cf5ff7c55c1da14df`（`match=True`） | 在临时裸库执行 `git fetch --depth=1 --filter=blob:none https://github.com/Cle0726/super-pinkie.git refs/tags/<tag>:refs/tags/<tag>` 并核对 `git rev-parse refs/tags/<tag>^{commit}` |
| **M1-5** | **过** | 扫描当前远端全部 `116` 个分支头（退出 `0`，`Unknown obj: 0`）：相对 `origin/main`（`fa57fcc7`）未合并的远端分支共 **30** 条，逐条核对为：`BRANCHES.md` 记录的 **24** 条 D 类保留分支 + 当前进行中的 **6** 条计划/复核/返工活跃分支（`core/k2-dual-core` #54、`maint/m3-real-page-audit` #57、`maint/m2-m4-audit` #58、`maint/m5-fix-real-page` #59、`maint/foundation-audit` #60、以及 `2026-11-21T19:00:21-08:00` 新开的 `maint/m3-fix-dom-watch`）。无任何漏清的 A/B/C 类未合并分支。另已核实 `tools/native-pointer-fix/` 已在 `origin/main` 删除（`exists: False`）。 | `git ls-remote --heads origin` + 逐条 `git merge-base --is-ancestor <sha> origin/main` |
| **M1-6** | **过** | 查 M1 合并提交 `git show 1851ade8:CLAUDE.md`（退出 `0`）：已落地最小版分支规矩（`main` 唯一长期主线、开工 `git fetch origin`、禁推改写前历史、超 3 天每日变基、合并后清分支、删前核实归属与存档并链接 `BRANCHES.md`），后在 M7 整合为正式 34 行 `CLAUDE.md`。 | `git show 1851ade8:CLAUDE.md` |
| **Z1/Z6（CI 复核）** | **过** | PR #44（合并提交 `bc4262d3`）与 PR #42（合并提交 `1851ade8`）四项 CI（`portable-checks`/`macos-check`/`windows-checks`/`windows-build`）全部 `SUCCESS`；合并后任务分支均已删除。 | `gh pr view 42 --json statusCheckRollup`; `gh pr view 44 --json statusCheckRollup` |

---

## 发现的问题

| 严重程度 | 位置 | 复现步骤 | 建议 |
|---|---|---|---|
| **次要** | `briefs/maintenance-1120/BRANCHES.md:91,121`、`briefs/maintenance-1120/progress/M1.md:28,54,83,103,129,159,177` | 查看上述行号可见公开仓库文档中写入了本机 Windows 绝对路径（含用户目录名）及本地已清理临时路径。 | 后续文档维护时改为相对/环境变量占位路径（如 `%LOCALAPPDATA%\Temp\...`），避免在公开仓库暴露本机用户目录名。 |

---

## 没测的条目

| 条目 | 原因 | 需要谁、在哪台机器补测 |
|---|---|---|
| Z1 ★（全量 `run-tests.mjs` 本地重跑） | 任务单限定只读复核、不跑重编译；已本地实跑 41 项学习游戏/M1 相关单测全过，并核验 PR #42/#44 四路 CI 全绿 | 统一验收 `summary` 组在最新 `main` 统一复跑 |
| Z3 ★（M5 截图基线） | M1 合并时 M5 尚未落地，不适用 | — |
