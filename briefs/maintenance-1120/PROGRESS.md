# 碧琪代码维护 · 接力记录

先读 `PLAN.md` 第七节「接手规矩」。每做完一步，在下表补一行状态，并在后面加一节记录：做了什么、怎么验证的、`ACCEPTANCE.md` 对应条目的自查结果（过 / 没过 / 没测和原因）。

| 批 | 状态 | 谁在做 | 更新日期 | 分支 / PR |
|---|---|---|---|---|
| M0 量和护栏 | 已合并（本 PR 进入 main 后生效） | Codex-Win-5eac（Windows） | 2026-11-20 | [#40](https://github.com/Cle0726/super-pinkie/pull/40) |
| M1 收分支 | 已合并（本 PR 进入 main 后生效） | Gemini-Win-4e9b（Windows，接手 Codex-Win-4d8c） | 2026-11-21 | [#42](https://github.com/Cle0726/super-pinkie/pull/42) / [#44](https://github.com/Cle0726/super-pinkie/pull/44) |
| M2 版本号自动生成 | 已合并（本 PR 进入 main 后生效） | Gemini-Win-4e9b（Windows + CI macos-latest） | 2026-11-21 | [#51](https://github.com/Cle0726/super-pinkie/pull/51) |
| M5 真页面回归测试 | 未开始 | | | |
| M3 页面规矩（收窄版） | 未开始 | | | |
| M4 拆巨无霸文件 | 未开始 | | | |
| M6 上游补丁管理 | 已取消（由 C.le. 内核接管计划的 K3 取代） | | 2026-11-20 | |
| M7 地图和规矩 | 未开始 | | | |

## 正在改的文件（并行时互相避让）

M3 和 M4 可以同时进行。开工时在这里写明这一批会改哪些文件，收工后删掉这一行。

## 用户的决定

- 2026-11-20：用户在看完结构评估以后说「写维护计划」。
- 2026-11-20：用户决定接管 OpenClaw 源码，做自己的内核 C.le.（见 `briefs/cle-core-1120/`）；最在意的是界面不能变。因此 M6 取消，M3 取消样式分层改造。

## 执行者的决定

（计划没有写到、由执行者自己决定的细节，写在这里：日期、决定、理由。）

- 2026-11-20 / M0：测量读工作树而非 Git 索引，未暂存的新注入文件也能被拦。只对 UTF-8 文本作行数/字面计数；子树数是 `.observe` 里直接写 `subtree: true` / `!0` 的调用点，不是浏览器运行时创建数。巨文件只统计源码、脚本和模板，不把生成的报告、测试夹具数据算作代码。
- 2026-11-20 / M0：已有注入文件的行数也受棘轮约束；新注入文件以 1500 行为上限，四类风险计数和子树调用从 0 起。长文件、各注入指标和手写版本号总量入棘轮；补丁个数、测试个数和版本号坐标仅供盘点，避免拦住新增测试或移动版本位置。
- 2026-11-20 / M0：`exceptions.json` 用 `file`（仓库相对路径）、`metric`、`value`（该文件允许的准确计数）、`reason`；手写版本号例外也按具体文件审核。现在为空。`--write-baseline` 不会把例外或其他增长写入基线；如确需和例外同时交付改善，应审查基线差异，只改小真正改善的字段。不可用手改基线放行增长。
- 2026-11-21 / M1（Z5 新对照基准，依 `ACCEPTANCE.md` 基线节）：学习台游戏 v4（[#44](https://github.com/Cle0726/super-pinkie/pull/44)）合入主线提交 `bc4262d33bca99589e8976e62f404a7ecf8383e1` 后，M1 结束时的 Z5 注入对照基准更新为该提交（本 PR #42 仅清理旧目录/文档，不改动产品运行逻辑或人设/提示词/技能）。在 `M1-exec` 上实测 `tools/metre/inject-inventory.mjs` 六模式（五个老模式 + Metre）各 3 条共 18 条样例，输出 `386635` 字节，SHA-256 `896fbadec7b4d0759196b4faea038c6a00dd3294a07884aaf270ec3582443c17`，供 M2 及后续批次作为 Z5 对照。
- 2026-11-21 / M2（M2-3 开工前调研结论与缓存方案）：
  1. `dist/control-ui/asset-manifest.json` 仅由上游 OpenClaw 2026.10+ 构建期为 `assets/*` 原生 chunk 及其预压缩 `.br`/`.gz` 生成；碧琪的 `laolao-*` 注入文件、`vendor/*`、`fonts/*`、`study-desk/*`、`study-game/*` 及新生成的 `laolao-asset-manifest.js` 均不在 `asset-manifest.json` 中，也没有 `.br`/`.gz` 预压缩副本。
  2. `patch/lib-precompressed.mjs` 的 `refreshPrecompressed()` 仅在同目录存在 `.br`/`.gz` 与 `asset-manifest.json` 对应条目时才刷新，对不存在的条目安全跳过；因此注入文件不需要修改 `patch/lib-precompressed.mjs`。当 `tools/assets/stamp.mjs` 更新 `assets/index-*.js`（为 `./chat-page-*.js` 写入 10 位内容哈希）时，若目标 `control-ui` 下存在 `asset-manifest.json`，`stamp.mjs` 会顺带调用 `refreshPrecompressed()` 保持原生入口的 `.br`/`.gz` 与 `asset-manifest.json` 同步。
  3. `patch/apply-control-ui-cache.mjs` 在网关静态文件响应上按文件大小与 `mtimeMs` 计算 `ETag: "pk-<size36>-<mtimeMs36>"` 并维持 `Cache-Control: no-cache`。文件内容变更时，不仅 URL 查询串 `?v=<sha256[:10]>` 改变，文件 ETag 也随之改变，浏览器必然发起新请求并拿到 `200 OK` 的新内容，故 `patch/apply-control-ui-cache.mjs` 无需修改。
  4. `laolao-asset-manifest.js` 在安装/打包步骤由 `tools/assets/stamp.mjs`（及 `tools/ui-parity/bundle.py`）写入目标 `control-ui` 目录，不提交到仓库 `ui/injections/`，并在 `index.html` 的 `<head>` 中紧跟 `laolao-night.js` 同步加载，在所有懒加载脚本执行前提供 `window.__pinkieAsset(path)` 与 `window.__pinkieAssetManifest`。

## M0 执行记录（2026-11-20，待验收）

### 1. 起点和数字（M0-1 / M0-2）

- `git fetch origin` 后确认 [PR #39](https://github.com/Cle0726/super-pinkie/pull/39) 未合并，故从 `origin/docs/maintenance-plan-1120`（`504616c5`，仅多两个文档提交）切分支。开工时 `git diff --stat 2c1fa0bb28d6326d5459376748a8440f155d80ab HEAD -- . ':(exclude)briefs'` 无输出。
- 工具从独立、干净的 `2c1fa0bb28d6326d5459376748a8440f155d80ab` 工作树读取代码；在 M0 工作树执行 `node tools/health/measure.mjs --root <基线工作树>` 两次，输出逐字相同，也等于提交的 `tools/health/baseline.json`。两次 SHA-256：

  ```text
  A  bdf17c8c2821540908c59c1cbb29956bd49cc43a723244f20153692985b17bfc
  B  bdf17c8c2821540908c59c1cbb29956bd49cc43a723244f20153692985b17bfc
  ```

| 计数 | 计划 §2 | M0 基线 | 差异说明 |
|---|---:|---:|---|
| `!important` | 5052 | **5090** | CSS 内恰好 5052；额外 38 处来自其他注入文本（例如 JS 内嵌样式）。 |
| `new MutationObserver` | 78 | **74** | 重新把顶层第三方 JS 算进去得到 78：Chart 2 处、Mermaid 2 处。本次排除它们。另有 47 处项目自己的子树监听调用点。 |
| `setInterval(` | 94 | **91** | 顶层第三方 Mermaid JS 有 3 处；加回后为 94。 |
| `window.__` 全局名 | 129 | **124** | 项目自己的全局名全仓去重是 124，每文件去重后相加是 128。顶层第三方 JS 的 1 个也纳入按文件相加时，复算得 129。等号判断不计。 |
| 头部清单的 `?v=` | 197 | **197** | 一致。手写版本维护位置合计 311：头部 197、注入 JS/CSS 105、工具 7、运行时聊天分块 2。运行时两处都是 `v=clekk-history59`；旁边的 `h` 由打包脚本生成，不列为手写值。 |
| 超过 1500 行的手写文件 | 16 | **16** | 一致，含 `tools/native-pointer-fix` 的两份 Swift 副本。 |
| `patch/apply-*.mjs` | 35 | **34** | `git ls-files 'patch/apply-*.mjs'` 复核为 34 个（含 `apply-all.mjs`）；没有计划原始命令可进一步核对。 |
| 测试文件 / 浏览器文件 | 274 / 16 | **337 / 16** | 273 个门禁 Node 文件、63 个 Python `*_test.py`、1 个另外命名为 `.test.py` 的文件。若只数 `.test.*` 正好是 274；浏览器按字面匹配、不是运行结果。 |

### 2. 棘轮反例（M0-3 / Z4）

执行 `node --test tests/code-health-ratchet.test.mjs`。以下每条仅改独立的 M0 临时工作树，测试文件退出码均为 1。每次都按原字节还原，再跑均退出 0（3 通过、0 失败）。产品文件未提交。附测试错误原文：

```text
a. 已有 CSS 多一处 !important
代码健康度检查未通过：
- ui/injections/laolao-theme.css：!important（强制覆盖）增加（基线 557 → 当前 558）。

b. 新增带观察器的注入 JS
代码健康度检查未通过：
- ui/injections/laolao-m0-ratchet-probe.js：MutationObserver（变化观察器）增加（新文件上限 0 → 当前 1）。

c. 巨文件多一行
代码健康度检查未通过：
- services/mode-architecture/index.mjs：行数增加（基线 7949 → 当前 7950）。

d. 删掉一处 !important 但不更新基线
代码健康度检查未通过：
- ui/injections/laolao-theme.css：!important（强制覆盖）减少（基线 557 → 当前 556）。
数字变好了，请运行 `node tools/health/measure.mjs --write-baseline` 同步基线，并与本次改善一起提交。
```

另在反例 a 验证了 `--write-baseline` 拒绝增长且不写文件；反例 d 用该命令同步后测试恢复通过，再把 CSS 和基线均还原。测试同时覆盖 LF/CRLF、全局去重、`subtree:!0`、手写版本值、例外和新巨文件上限。

### 3. 热点（M0-4）

见 [HOTSPOTS.md](HOTSPOTS.md)。按文档命令重跑逐字一致，SHA-256 `962bbae3b53d5dba7a291bafadd53718e565d1d27ba575b166b115b3e6bd5967`。UTC 窗口 2026-09-22 至 2026-11-20，共识别 293 个修复提交；头三名是头部清单（56）、macOS 安装主题脚本（40）、模式架构入口（39）。

### 4. Windows 全量门禁（M0-5 / Z1）

在各自的临时工作树运行原命令 `node tools/release-gate/run-tests.mjs`，不加 `--update`。Node 24.16.0、Playwright 1.64.1、`ws` 8.23.0；浏览器依赖、伪网关及 HOME/APPDATA/TEMP 都在隔离环境（Chrome 使用系统二进制和临时浏览器配置）。只汇总子进程 TAP 计数，未修改门禁脚本、既有测试条件或现有失败名单。

| 工作树 | 测试文件（退出 0 / 非 0） | 用例通过 | 失败 | 跳过 | 门禁耗时 |
|---|---:|---:|---:|---:|---:|
| 原基线 `2c1fa0bb` | 273 / 0 | 2333 | 0 | 26 | 157.824 秒 |
| M0 `56c6b1bc` | 274 / 0 | 2336 | 0 | 26 | 144.624 秒 |

两轮失败文件均为无；原来的 273 个文件逐一对照，退出码和各项用例计数完全相同，仅新增的棘轮测试贡献 3 条通过。用户提示的 Windows 浏览器限制单列如下，避免误把老问题算作本次引入：

| 已知限制 | 基线实测（这次没有复现所列失败） |
|---|---|
| `sidebar-handshake.test.cjs` | 在临时目录装好 WebKit，1 通过。 |
| `learning-notes-menu.test.cjs` | 当前版本实际用 Chrome，2 通过。 |
| `study-desk-ui.test.cjs` | 25 通过、2 跳过；需完整构建好的 `control-ui`，隔离环境未提供。这两项是原有 `known-failures.json` 条目。 |
| 之前会超时的 `learning-desk.test.mjs`、`study-builtin-model-ui.test.cjs`、`study-desk-chat-entry.test.cjs`、`study-desk-conversation.test.cjs`、`study-desk-panes.test.cjs`、`study-explain-ui.test.cjs` | 本次分别 29、4、2、1、5、1 通过；没有超时。 |

另有 24 个用例按原测试条件跳过，涉及 `browser-fast`、`browser-workspace`、`fake-ip-benchmark-v6`、`learning-devices`、`learning-drill`、`learning-materials`、`learning-practice`、`native-brand-isolation`、`pinkie-toolbox`、`ui-polish-mac-update-browser`。不是失败或已通过；本批未改相关 Python 代码，也未改 CI。跨平台全量结果以 PR 的 Linux CI 为准。

### 5. 正式环境和注入对照（Z2 / Z5）

| 现场项 | 开工（UTC） | 收工（UTC） |
|---|---|---|
| `%USERPROFILE%\.openclaw\openclaw.json` 的 `LastWriteTimeUtc` | `2026-11-20T07:56:00.7371058Z` | `2026-11-20T07:56:00.7371058Z` |
| `%LOCALAPPDATA%\Programs\SuperPinkie` 的 `LastWriteTimeUtc` | `2026-11-21T03:12:31.9611495Z` | `2026-11-21T03:12:31.9611495Z` |
| `Get-NetTCPConnection -LocalPort 18789` | 无连接、无 PID（`CmdletizationQuery_NotFound_LocalPort`） | 无连接、无 PID（同左） |

`git diff 2c1fa0bb -- personas prompts skills` 无输出。隔离环境用现有 `tools/metre/inject-inventory.mjs` 的 `collectBaseline({modes:[...LEGACY_MODES,'metre'],prompts:BASELINE_PROMPTS})`，通过 `PINKIE_INVENTORY_SOURCE_ROOT` 分别指向基线和 M0 工作树，比较 `JSON.stringify` 原始输出。`main`、`project`、`thinking`、`learning`、`unrestricted`、`metre` 各 3 条（18 条）；两份各 385824 字节，逐字相同，SHA-256 `c7c88f6a6c81031d9358341a166cb8b4a512463c28d7208a7ba06d2f1c4921bf`。

### ACCEPTANCE 自查表

| 条目 | 自查 | 证据或未测原因 |
|---|---|---|
| M0-1 ★ | 过 | 两次基线测量的 SHA-256 相同，代码测试覆盖换行符等价。 |
| M0-2 ★ | 过 | §1 逐项核对计划数字和实际口径。 |
| M0-3 ★ | 过 | 四个反例均失败，逐一还原都通过，错误原文见 §2。 |
| M0-4 | 过 | 从固定提交和日期重跑，热点表逐字相同。 |
| M0-5 | 过 | 基线上完整运行门禁，见 §4。 |
| Z1 ★ | 过 | Windows 两轮门禁通过，见 §4；失败名单不变。本机未另外运行 Python 套件（M0 没有 Python 改动）；Linux 的 `portable-checks` 在 PR 上复核。 |
| Z2 ★ | 过 | 见 §5，开工/收工三个现场项一致。未启动/修改正式 App 或数据。 |
| Z3 ★ | 没测 | M5 合并以后才适用；M0 不采集或修改截图基线。 |
| Z4 ★ | 过 | 新棘轮本机通过，例外为空；M0-3 对反例实测。没有 macOS 本机；现有 macOS CI 只跑指定测试，不单跑这条新测试。 |
| Z5 ★ | 过 | 人设、提示词、技能无差异，18 条注入样例逐字相同。 |
| Z6 | 没测（部分） | PR #39 未合并，按任务规定使用仅多两个文档提交的分支；CI 看 PR Checks。合并和删分支不属于本次授权。 |

### 6. 合并复核（2026-11-20，美国太平洋时间）

- 用户在确认先合 #39、复查后再合 #40 时的原话：「合」。仅合并，不发版、不打 tag、不删除分支。
- 合并认领：Codex-Win-5eac；文档 #39 已先合并，M0 两个提交已对齐主线 `56fcb177`，重新检出后的树与本地验证候选完全相同；没有改动产品文件、测试代码或既有失败名单。
- 重跑：健康度棘轮 3/3；原基线连续两次与提交的基线 JSON 字节一致；四个反例逐一按预期失败、原字节还原后逐一通过；热点文件逐字复现；五个老模式及 Metre 的 18 份注入样例一致。
- Z3 在 M5 合并后才适用，本批不适用。合并前必须等 Windows 隔离环境的全量门禁复跑、#39 合并后主线 CI 与 #40 新一轮 CI 全部通过；结果见 [#40](https://github.com/Cle0726/super-pinkie/pull/40)。实际结果见下节。

### 7. 复跑完成，停止合并（2026-11-20 23:13 -08:00，Codex-Win-5eac）

- 状态：**卡住：正式网关现场变化。** #40 未合并。在原验收范围内，两轮 GitHub CI 全绿（#39 合并后主线 44870298510、#40 候选 44870370206）。这里仅更新接力记录。
- Z1 ★：过。候选 `11b13fc2` 在隔离 HOME、APPDATA 与 TEMP 下执行 `node tools/release-gate/run-tests.mjs --jobs 1`：274 个测试文件，0 失败，2 个原有跳过（需完整 control-ui），退出 0。并行轮中超时的两个浏览器测试文件在原基线、候选上分别单跑均 2/2 通过；未改测试、超时和已知失败名单。
- Z2 ★：未过该合并窗口的一致性检查。开始及 21:33 中途检查时 18789 无监听；最终检查有 PID 8728（node）监听 127.0.0.1:18789，监听创建于 22:59:03，早于 23:02 的串行对照和全量复跑。正式配置和 App 安装目录时间没变。这里只读系统端口元数据，不调用网关、不停止该进程；现有证据不能断定由谁启动。
- 证据保留于 `F:\tmp\pinkie-m0-merge-5eac`：`release-gate-serial.log`、`prod-before.json`、`prod-after.json`。接力工作区 `F:\Projects\pinkie-wt\m0-final-5eac`，暂无后台门禁进程。
- 待用户决定：确认 22:59 的网关启动是否属于预期的日常使用。确认后，重新建立只读现场基线并按第 4.3 节复查；不随意停正式网关或跳过检查。

### 8. 恢复合并复查（2026-11-20 23:16 -08:00，Codex-Win-5eac）

- 用户确认在约 22:59 打开过碧琪；对「你在 22:59 左右有打开碧琪吗？」回复原话：「有」。第 7 节保留当时观测，不再将该次已说明的变化作为未决事项。
- 未启动、停止或调用正式网关。重新记录只读现场：18789 无监听进程；正式配置和 App 目录修改时间分别为 2026-11-20T07:56:00.7371058Z 和 2026-11-21T03:12:31.9611495Z（UTC）。新基线 prod-resume-before.json，合并前记录 prod-resume-after.json；不要求用户关闭应用。
- 本提交只更新接力记录。重跑隔离棘轮和串行全量门禁，运行结果保留在 F:\tmp\pinkie-m0-merge-5eac\release-gate-resume.log；预计约 10–15 分钟。确认这轮现场不变，并等本提交的 CI 与主线 CI 全绿后才合并，证据记入 #40 讨论。不删分支、不打 tag、不发版。

## 复发记录

（维护完成后一个月内，同一个问题又出现时记在这里：日期、现象、涉及文件、为什么没被测试拦住。）
