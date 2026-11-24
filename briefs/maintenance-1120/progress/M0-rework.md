# M0 返工：堵住棘轮的口子

## 接力卡（最后更新：2026-11-24 01:40 -08:00，Claude-Win-r7m3 @ Windows）

- 状态：**已合并**（[PR #71](https://github.com/Cle0726/super-pinkie/pull/71)，合并提交 `19fb1523`）
- 分支和 PR：`maint/m0-fix-ratchet`，PR #71（草稿），2026-11-24 01:42 -08:00 变基到 `origin/main` `44639398`（#62 合入后）；变基后 `node --test tests/code-health-ratchet.test.mjs tests/code-health-loopholes.test.mjs tests/ui-region-ownership.test.mjs` → `tests 16 | pass 16 | fail 0`，`node tools/health/compare-baseline.mjs --target <origin/main 44639398>` → exit 0。最终提交号见 `status/m0.done`
- 依据：`briefs/maintenance-1120/review/M0-precheck.md`（PR #60 分支 `maint/foundation-audit`）的 L1–L7 和 `hotspots.mjs` 浅克隆问题；任务单 `tasks/h.md`。
- 已完成：
  1. 开工现场快照（只读元数据，2026-11-23 19:08:07 -08:00）：`%LOCALAPPDATA%\Programs\SuperPinkie` 修改时间 2026-11-22 03:43:02；`%LOCALAPPDATA%\SuperPinkie` 2026-11-22 22:54:31；`~/.openclaw` 2026-11-22 16:58:37；`~/.openclaw/openclaw.json` 2026-11-21 21:54:19；18789 端口无监听；C 盘剩 13G。
  2. L5c、L7、hotspots 浅克隆（`35fc015b`/`4490dc90` 起，变基后 `bb70747c`、`6d043955`）。
  3. L1–L4、L5a/b、L6（`0899022c`）、每个口子的反例测试（`71cbf248`）、CI 新工作流 `.github/workflows/health.yml`（`c1346916`）。
  4. PR #71 CI 全绿（head `c1346916`）：run 45360746644 的 macos-check、portable-checks、windows-checks、windows-build 都 pass；run 45360746885 的 ratchet（Code health）pass。
  5. 本机全量门禁（2026-11-24 01:02 起，持有 gate.lock，隔离 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/npm_config_prefix）：`node tools/release-gate/run-tests.mjs` → `gate exit 1`，61 条 NEW FAILURE，全在浏览器类测试；其中 55 处报 `Cannot find module '/Applications/超級碧琪.app/…/playwright-core'`（`tools/study-desk/harness.mjs` 是 gitignore 的本机文件，指向 Mac 路径）。和本 PR 有关的两个测试 `asset-hash-stamp`、`shared-dom-watch` 只在浏览器子测试上失败，原因同样是这个 playwright-core；它们的静态和棘轮子测试（M2-1、M3 static）都 pass。在干净 origin/main（`m0-probe-before`）上跑 `node --test tests/asset-hash-stamp.test.mjs`，报同一个错。门禁结论：本机没过，原因在环境，不是本 PR；CI 上同一套测试全绿。
  6. 本机 Python：`python -m unittest discover -s tests -p '*_test.py'` → `Ran 535 tests`，`FAILED (failures=5, errors=17, skipped=15)`，`python exit 1`。没有一个 Python 测试引用 tools/health。在干净 origin/main 上逐个模块重跑（inapp_browser_scope、mode_architecture_setup、party_service、proxy_gemini_tool_history、proxy_stream、ui_parity、windows_update_assets、release_notes），errors 17 + release_notes failure 1 原样复现，所以和本 PR 无关（多为 Windows 本机 `UnicodeDecodeError: 'charmap'`）。剩下 4 条 `windows_portable_update_integration_test` failure 没在 main 上复跑，因为这个测试会切版本、可能弹窗，这一条记作「没测」。
  7. 收工现场快照（只读元数据，2026-11-24 01:38:18 -08:00）：`%LOCALAPPDATA%\Programs\SuperPinkie` 2026-11-22 03:43:02（没变）；`%LOCALAPPDATA%\SuperPinkie` 2026-11-22 22:54:31（没变）；`~/.openclaw/openclaw.json` 2026-11-21 21:54:19（没变）；`~/.openclaw` 目录时间变成 2026-11-23 22:25:55，比本线开工晚，但本线的所有运行都用隔离 HOME，没读写过这里，像是别的进程动的，请协调者留意；18789 端口无监听；C 盘剩 9.3G。
- 下一步：无，等协调者复核。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m0-fix-exec`；对照工作区 `m0-target-main`、`m0-probe-before`、`m0-probe-after` 已删；隔离 HOME `F:\tmp\pinkie-m0-exec-home` 已删；`F:\tmp\pinkie-m0-exec-scripts` 留着（probe-before-after.mjs、probe-results.txt、gate.log、py.log、py-main.log 是上面的证据原件），协调者复核完可以删；端口不用；后台进程无
- 踩过的坑：上一个会话因额度中断，接手时有两个未提交的改动和两个新文件，从「跑新测量」继续；`ratchet.mjs` 标签里单引号没转义导致语法错，已修。
- 待协调者决定：PR #67 也改 `tools/health/baseline.json`、`exceptions.json`，和本 PR 合并会冲突，需定先后；#73 改 `exceptions.json`（本 PR 不改这个文件）。

## 做法（实际怎么堵的）

| 口子 | 做法 | 新增的数字放哪里（不抬高已有数字） |
|---|---|---|
| L1 别的 UI 目录 | `ui/` 下所有手写文件都量（`ui/runtime` 生成物除外） | 以前没量过的 16 个文件记在新节 `otherUi` / `otherUiTotals`；它们的 `?v=` 记在新节 `pageVersions`（4 处：`ui/control-ui.index.html` 1、`ui/roundtable/index.html` 3） |
| L2 没扫的目录 | 范围改成全仓：`git ls-files --cached --others --exclude-standard`（不是 git 工作树时逐层列目录） | `longFiles` 新增 `tests/mode-architecture.test.mjs` 3294、`tests/resume-ui.test.cjs` 2003 |
| L3 排除前缀 | 删掉按名字跳过 `vendor`、`third-party`、`laolao-katex`、`laolao-vendor-*` 的规则；改成显式清单 `tools/health/third-party.json`（30 条，每条有 kind 和 reason）+ `skills/community-skills.json` 登记的社区技能目录；清单里写了但不存在的路径报错 | `ui/injections/vendor/study-desk-before.js`、`study-desk-after.js`（`regions.json` 归 common 区）、`laolao-vendor-pdf-compat.js`、`laolao-vendor-monaco/worker-boot.js` 是手写的，不进清单，记在 `otherUi` |
| L4a/L4b 写法 | 新文件 `tools/health/patterns.mjs`：注释拆开/转义的 `!important`、`setProperty(..., 'important')`、不以 `new MutationObserver` 字面出现的观察器引用、看不出是否监听子树的 `observe`、不以 `setInterval(` 字面出现的定时器引用、`globalThis`/方括号/`\|\|=`/`defineProperty` 挂 `__` 全局名；`'?v=' + ...` 拼接版本号算进手写版本号 | 新指标 `importantIndirect` 7、`mutationObserverRefs` 20、`observeUnclear` 3、`setIntervalRefs` 9、`windowGlobalsIndirect` 1，各自单独计数，旧的 `important` 等口径不变 |
| L5a/L5b | 新脚本 `tools/health/compare-baseline.mjs` + CI `Code health` 工作流：用本 PR 的量法量 PR 目标分支；目标分支基线已有的数字不许上升、不许删键；新补的数字不许高于目标分支实测；合计必须等于逐文件之和；`exceptions.json` 新增或抬高、不量清单新增条目或盖住目标分支量过的文件都变红并逐条列出 | — |
| L5c | 棘轮测试里没被用到的例外报错 | — |
| L6 NUL | 要量的文件含 NUL、不是 UTF-8 或是符号链接，直接报错；全仓扫描找到的唯一一个（`skills/archify/renderers/shared/diagnostics.mjs` 里 2 个 NUL）在社区技能目录里，不量 | — |
| L7 `--write-baseline` | 只写改善的数字；例外的增长不写也不失败；没登记的增长仍然失败 | — |
| 补基线 | 新开关 `node tools/health/measure.mjs --adopt-unmeasured`：只补基线里没有的键 | 核对：基线里已有的键 0 个改变；diff 里删掉的 231 行全是 `"windowGlobals": N` 行尾加了逗号 |
| hotspots | 浅克隆直接报错退出 1 | — |

## 证据：修之前退出 0、修之后退出 1

命令：`node F:/tmp/pinkie-m0-exec-scripts/probe-before-after.mjs <origin/main 工作树> <HEAD 71cbf248 工作树> <临时 HOME> <干净 origin/main 工作树>`，每个反例同时放进两边，跑 `node --test tests/code-health-ratchet.test.mjs`，修之后另跑 `node tools/health/compare-baseline.mjs --target <干净 origin/main>`，跑完把两个工作树恢复干净（脚本里核对 `git status --porcelain` 为空）。2026-11-24 00:55–00:57 -08:00。

| 口子 | 反例 | 修之前（origin/main 815c0f78） | 修之后（HEAD） |
|---|---|---|---|
| L1 | `ui/party/audit-probe.js`（1600 行 + 全部禁用写法） | exit 0，`tests 3 \| pass 3 \| fail 0` | 棘轮 exit 1，`ui/party/audit-probe.js：!important（强制覆盖）增加（新文件上限 0 → 当前 1）` |
| L2 | `scripts/audit-probe.js`（1600 行） | exit 0，`pass 3 fail 0` | 棘轮 exit 1，`scripts/audit-probe.js：行数增加（新文件上限 1500 → 当前 1600）` |
| L3 | `ui/injections/laolao-vendor-audit-probe.js`（1600 行 + 禁用写法 + `?v=manual99`） | exit 0，`pass 3 fail 0` | 棘轮 exit 1，`…laolao-vendor-audit-probe.js：!important（强制覆盖）增加（新文件上限 0 → 当前 1）` |
| L4a | `laolao-night.css` 首行插入 `.p{color:red!/*x*/important}`（不增行） | exit 0，`pass 3 fail 0` | 棘轮 exit 1，`laolao-night.css：绕开字面的 !important…增加（基线 0 → 当前 1）` |
| L4b | `ui/injections/laolao-audit-alt.js`（setProperty important、`new window.MutationObserver`、变量传选项、`window["setInterval"]`、`globalThis.__`、`\|\|=`、拼接版本号） | exit 0，`pass 3 fail 0` | 棘轮 exit 1，`laolao-audit-alt.js：绕开字面的 !important…增加（新文件上限 0 → 当前 1）` |
| L5a | `laolao-night.css` 加 `!important` 且手改 `baseline.json` 同步抬高 | exit 0，`pass 3 fail 0` | 棘轮仍 exit 0（同一工作树里的基线被改了，预期如此）；compare-baseline exit 1，`基线被抬高：injectionTotals › important（目标分支 5090 → PR 5091）` |
| L5b | `laolao-night.css` 加 `!important` 且往 `exceptions.json` 塞一条 `value: 462` | exit 0，`pass 3 fail 0` | 棘轮仍 exit 0（例外放行，预期如此）；compare-baseline exit 1，`exceptions.json 新增例外，需协调者逐条认可：ui/injections/laolao-night.css 的 important = 462` |
| L5c | `exceptions.json` 追加 `laolao-night.css important=999` | exit 0，`pass 3 fail 0` | 棘轮 exit 1，`…的例外（value 999）没有被用到`；compare-baseline 也 exit 1 |
| L6 | `ui/injections/laolao-audit-null.js`（首行含 `\0`） | exit 0，`pass 3 fail 0` | 棘轮 exit 1，`代码体检没法量完：… 含 NUL 字节`；compare-baseline 也 exit 1 |

自动化反例测试：`tests/code-health-loopholes.test.mjs` 11 个（L1、L2、L3、L4a、L4b、L5a/b、L5c、L6、L7、`--adopt-unmeasured`、hotspots 浅克隆），`node --test tests/code-health-ratchet.test.mjs tests/code-health-loopholes.test.mjs` → `tests 14 | pass 14 | fail 0`；加上 `tests/ui-region-ownership.test.mjs` → `tests 16 | pass 16 | fail 0`。

本 PR 对 origin/main 的基线对比：`node tools/health/compare-baseline.mjs --target <origin/main 815c0f78>` → exit 0，`代码体检基线对比通过：基线没有任何一项高于目标分支，例外和不量清单没有新增或抬高。`
