# M0 独立复核报告（Precheck）

## 接力卡（最后更新：2026-11-21 19:12 -08:00，Gemini-Win-4e9a @ Windows）

- 状态：M0 已完成（整批 M0/M1/M7/K0/K1 复核进行中）
- 分支和 PR：`maint/foundation-audit`，PR #60（草稿）
- 核对的 `origin/main` 提交：`fa57fcc7da5e05e259e72d149c67235ebed750c2`（M0 合并提交：`0fc9a318dcaf0caf97bc9a869a67e4641be79b15`，原基线：`2c1fa0bb28d6326d5459376748a8440f155d80ab`）
- 已完成：
  1. M0-1 ★ ～ M0-5、Z4 ★、Z5 ★ 全项独立核验；
  2. M0-3 ★ 四项反例 + `index.mjs` 跨 1500 线反例 + 当前超限文件反例实测与逐字节还原；
  3. 棘轮绕过口子专项审计（6 类 9 项绕过反例实测全部退出 0）；
  4. `tools/health/baseline.json`（10 提交）与 `tools/health/exceptions.json`（6 提交）全历史逐字段审计。
- 正在做：整理 M1 独立复核报告并继续 M7 / K0 / K1 核验
- 下一步：推送 M0/M1 复核结果，完成 M7、K0、K1 核验与收工现场快照
- 没推送的东西：无（即将提交推送）
- 环境：工作区 `%USERPROFILE%\Projects\pinkie-wt\foundation-audit`；临时目录 `%LOCALAPPDATA%\Temp\pinkie-foundation-audit-4e9a`；端口 5105–5109；后台进程 无
- 正在跑的长操作：无
- 踩过的坑：本机默认 `$env:TEMP` 指向 `F:\tmp`，已改建隔离临时目录于 C 盘 `%LOCALAPPDATA%\Temp\pinkie-foundation-audit-4e9a`；`F:\Projects\super-pinkie` 当前为浅克隆（`.git/shallow` 停在 `a85a7449`），暴露出 `tools/health/hotspots.mjs` 不检测浅克隆而静默少算 3 个修复提交的复现缺陷。
- 待用户决定：无

## 开工现场快照（只读元数据，2026-11-21 18:46:36 -08:00）

- C 盘余量：`21.06 GB`（建工作区后 `20.56 GB`，> 8 GB）
- `%LOCALAPPDATA%\Programs\SuperPinkie`：`EXISTS`，`LastWriteTime=2026-11-21T03:36:23.8784727-08:00`，`TopLevelCount=2`
- `%LOCALAPPDATA%\SuperPinkie`：`EXISTS`，`LastWriteTime=2026-11-21T04:26:46.2369231-08:00`，`TopLevelCount=50`
- `~/.openclaw`：`EXISTS`，`LastWriteTime=2026-11-21T10:36:03.7046384-08:00`，`TopLevelCount=45`
- 端口 `18789`：`NONE`

---

## 结论：**带问题通过（基础必过项 M0-1★～M0-3★ 成立，但棘轮存在多处可实测绕过的口子、`--write-baseline` 当前不可用、`hotspots.mjs` 在浅克隆静默错算，建议在发版前/后续维护补强）**

> 判定依据：原执行者自查的 M0-1 ★、M0-2 ★、M0-3 ★、M0-5 均有真实可复现证据，未发现造假；`baseline.json` 10 次历史提交**严格只降不升**。但本次深挖发现了 5 项**重要**级护栏/工具缺陷（含目录盲区、写法绕过、无 CI 约束手改 `baseline.json`/`exceptions.json`、`--write-baseline` 遇非空例外即报错失效、浅克隆下 `hotspots.mjs` 静默输出错数），以及 `exceptions.json` 在常规修复 PR #43 中发生过自行抬高（`910 → 918`）的事实，如实列出供协调者裁决是否返工补强。

---

## 逐条核对（`briefs/maintenance-1120/ACCEPTANCE.md`）

| 条目 | 结论 | 证据（命令、退出码、输出原文片段、文件路径） | 复现命令 |
|---|---|---|---|
| **M0-1 ★** | **过** | 用 `git archive` 从 `2c1fa0bb28d6326d5459376748a8440f155d80ab` 解出干净目录到 C 盘隔离目录，连续运行两次 `node tools/health/measure.mjs --root <dir>`，退出码均为 `0`，两次输出 SHA-256 均为 `bdf17c8c2821540908c59c1cbb29956bd49cc43a723244f20153692985b17bfc`，且与 M0 首版提交 `6aea039d:tools/health/baseline.json` 逐字节一致（`Run1 === Run2: true`，`Run1 === M0 initial baseline: true`）。 | `git archive --format=tar 2c1fa0bb28d6326d5459376748a8440f155d80ab \| tar -xf - -C <tmp>` 后运行两次 `node tools/health/measure.mjs --root <tmp>` 对比 SHA-256 |
| **M0-2 ★** | **过** | 在干净 `2c1fa0bb` 实测结果与 `briefs/maintenance-1120/PROGRESS.md` §1 逐项核对完全一致：`!important` = `5090`（其中 `.css` 恰好 `5052`，非 CSS 文本 `38`）；`new MutationObserver` = `74`（排除 `laolao-vendor-chart.js`/`laolao-vendor-mermaid.js` 共 4 处，口径已说明）；`setInterval(` = `91`（排除 Mermaid 3 处）；`window.__` = `124`（全仓去重，`windowGlobalsPerFileSum=128`）；头部 `?v=` = `197`（总手写版本 `311`：`head 197 + injections 105 + runtime 2 + tooling 7`）；`>1500` 行手写文件 = `16`；`patch/apply-*.mjs` = `34`；测试文件 = `337`（浏览器 `16`）。 | 同 M0-1，检查输出 JSON 的 `injectionTotals`、`manualVersions`、`longFiles`、`patchApplyFiles`、`tests` |
| **M0-3 ★** | **过（附演进说明）** | 在 `origin/main`（`fa57fcc7`）干净运行 `node --test tests/code-health-ratchet.test.mjs` 退出 `0`（`tests 3 \| pass 3 \| fail 0`）。亲自执行 4 个反例并逐字节还原：<br>• **a（已有 CSS +1 `!important`）**：改 `ui/injections/laolao-night.css` → 退出 `1`，原文 `ui/injections/laolao-night.css：!important（强制覆盖）增加（基线 461 → 当前 462）。`；还原后退出 `0`（3/3）。<br>• **b（新建注入 JS 含 `new MutationObserver`）**：新建 `ui/injections/laolao-audit-probe-b.js` → 退出 `1`，原文 `ui/injections/laolao-audit-probe-b.js：MutationObserver（变化观察器）增加（新文件上限 0 → 当前 1）。`；删除后退出 `0`（3/3）。<br>• **c（`index.mjs` 加 1 行）**：**演进注意**——M4 已将 `services/mode-architecture/index.mjs` 拆至 `1488` 行（低于 1500 阈值并移出 `longFiles`），因此在当前 `main` 上加 1 行退出 `0`；补做两个对照：将 `index.mjs` 加 15 行越过 1500 线（`1503` 行）→ 退出 `1`，原文 `services/mode-architecture/index.mjs：行数增加（新文件上限 1500 → 当前 1503）。`；对当前仍在 `longFiles` 的 `app/super_pinkie.py` 加 1 行 → 退出 `1`，原文 `app/super_pinkie.py：行数增加（基线 1560 → 当前 1562）。`；还原后退出 `0`（3/3）。<br>• **d（删 1 处 `!important` 不改基线）**：删 `ui/injections/laolao-night.css` 一处 `!important` → 退出 `1`，原文 `ui/injections/laolao-night.css：!important（强制覆盖）减少（基线 461 → 当前 460）。` 并附 `SYNC_HINT`；还原后退出 `0`（3/3）。 | `node --test tests/code-health-ratchet.test.mjs`（分别做 a/b/c/c'/d 临时改动后运行并还原） |
| **M0-4** | **部分过（浅克隆静默错算）** | `briefs/maintenance-1120/HOTSPOTS.md` 已生成并写明复现命令 `node tools/health/hotspots.mjs --ref 2c1fa0bb28d6326d5459376748a8440f155d80ab --as-of 2026-11-20`（记录 `293` 个修复提交、`1648` 文件，SHA-256 `962bbae3b53d5dba7a291bafadd53718e565d1d27ba575b166b115b3e6bd5967`）。**实测复现差异**：在本工作区运行同一命令退出 `0`，但输出为 `290` 个修复提交、`1646` 文件，前三名各少 1 次（`55/39/38` vs `56/40/39`），SHA-256 为 `b13993693eaa7b43f935e1c70239e6a720153913c78b9a3345d0514ea37a37b2`。经查根因：`F:\Projects\super-pinkie\.git\shallow` 在 `a85a7449`（PR #31）截断，且 GitHub API 证实其父链中恰好有 3 个修复提交被截断（`af35303e` 改 `index.mjs`、`9131007d` 改 `laolao-head.fragment.html`、`dc06b878` 改 `apply-theme.sh`），补回后精确等于 `293`、`56/40/39`。**问题在于 `tools/health/hotspots.mjs` 未检查 `git rev-parse --is-shallow-repository`，在浅克隆下不报错不告警，静默输出错误热点表。** | `node tools/health/hotspots.mjs --ref 2c1fa0bb28d6326d5459376748a8440f155d80ab --as-of 2026-11-20`；核查 `git rev-parse --is-shallow-repository` |
| **M0-5** | **过** | `briefs/maintenance-1120/PROGRESS.md` §4 已完整记录 `2c1fa0bb` 基线全量门禁结果（273 测试文件、0 失败、2333 通过、26 跳过、157.824 秒）。PR #40 合并前 CI Run [`44879503072`](https://github.com/Cle0726/super-pinkie/actions/runs/44879503072) 与合并后主线 CI Run [`44883651113`](https://github.com/Cle0726/super-pinkie/actions/runs/44883651113) 四项（`windows-checks`/`macos-check`/`portable-checks`/`windows-build`）均为 `success`。 | `gh run view 44879503072 --repo Cle0726/super-pinkie --json conclusion,jobs` |
| **Z1 ★** | **没测（本轮只读不跑全量编译/重测，仅核 CI 与棘轮）** | `tests/code-health-ratchet.test.mjs` 已纳入 `.github/workflows/ci.yml` 的 `portable-checks`（Ubuntu）与 `windows-checks`（Windows），M0 PR #40 CI Run `44879503072`、`44883651113` 全绿；`macos-check` 未运行该测试文件（仅跑 6 个指定文件）。本次未在本地重跑完整 `run-tests.mjs`。 | `gh run view 44883651113 --repo Cle0726/super-pinkie` |
| **Z4 ★** | **过（附历史与漏洞审计）** | 当前 `origin/main` 上 `node --test tests/code-health-ratchet.test.mjs` 退出 `0`（3/3）；`baseline.json` 与 `exceptions.json` 全历史审计见下节。 | `node --test tests/code-health-ratchet.test.mjs` |
| **Z5 ★** | **过（静态目录对照）** | `git diff --stat 2c1fa0bb28d6326d5459376748a8440f155d80ab origin/main -- personas prompts skills` 退出 `0`，输出为空。 | `git diff --stat 2c1fa0bb28d6326d5459376748a8440f155d80ab origin/main -- personas prompts skills` |

---

## 专项核查一：`baseline.json` 与 `exceptions.json` 全历史（是否只降不升）

### 1. `tools/health/baseline.json`（共 10 次提交）：**严格只降不升**

对 `git log --reverse -- tools/health/baseline.json` 全部 10 次提交逐文件逐指标对比（含 `injections`、`longFiles`、`manualVersions`）：

| 提交 | 说明 | 指标上升数 | 指标下降摘要 |
|---|---|---:|---|
| `6aea039d` | M0 初始基线 | — | `inj=219`, `longFiles=16`, `manualVersions=311`, `!important=5090`, `MO=74`, `setInterval=91`, `subtree=47`, `globals=124` |
| `13b390f8` | M1 移除 `tools/native-pointer-fix` | **0** | `longFiles` -2（两份 4888 行旧 `Launcher.swift`）；仅非棘轮信息项 `tests.total` `337 → 338` |
| `271b8892` | M2 手写版本号清零 | **0** | `manualVersions` `311 → 0` |
| `8be3fbc0` | M3-2 Batch A | **0** | `MO` `74 → 67`，`subtree` `47 → 40`（10 项下降） |
| `f20d20e0` | M3-2 Batch B | **0** | `MO` `67 → 58`，`subtree` `40 → 31`（14 项下降） |
| `1663cd80` | M3-2 Batch C | **0** | `MO` `58 → 48`，`subtree` `31 → 20`，`laolao-phrases.js` 行数 `750 → 747`（13 项下降） |
| `d74dae40` | M3-2 Batch D | **0** | `MO` `48 → 39`，`subtree` `20 → 11`，`laolao-mode-switcher.js` 行数 `1248 → 1245`（19 项下降） |
| `1dc4f4cc` | M3-2 Batch E | **0** | `MO` `39 → 28`，`subtree` `11 → 0`，`laolao-biqi-notices.js` 行数 `305 → 303`（25 项下降） |
| `6eac8ce6` | M3-5 定时器合并 | **0** | `setIntervals` `91 → 44`（36 项下降） |
| `18aaf471` | M4 移除拆完的巨无霸 | **0** | `longFiles` -2（`app/windows_desktop.py` 5775、`services/mode-architecture/index.mjs` 7949） |

### 2. `tools/health/exceptions.json`（共 6 次提交）：**非只降不升（0 → 20 条，且存在常规 PR 自行抬高例外）**

| 提交 | PR / 批次 | 变更 | 说明 |
|---|---|---|---|
| `6aea039d` | #40 / M0 | `0` 条（`[]`） | 初始为空 |
| `b1d95a55` | #43 / `fix/metre-children-under-parent` | `+2` 条（0 → 2） | `laolao-process-card.js` `lines=718`（基线 708）、`laolao-session-list.js` `lines=910`（基线 885）；**普通修复 PR 自行添加，PR #43 无独立审阅评论** |
| `e695c0f8` | #43 / 同上 | **修改抬高 1 条**（`910 → 918`） | `laolao-session-list.js` `lines` 从 `910` 再次抬高至 `918` |
| `0321d5da` | #44 / M1 B 类 | `+17` 条（2 → 19） | 合并学习台游戏 v4（`audit/pinkie-1112`），符合 `ACCEPTANCE.md` M1 例外规则；但实测使全仓 `!important` 从 `5090 → 5101`（+11）、`window.__` 从 `124 → 126`（+2） |
| `271b8892` | #51 / M2 | `-1` 条（19 → 18） | 移除 `laolao-head.fragment.html` `manualVersions=201` |
| `4cde32d9` | #53 / M3 | `+2` 条（18 → 20） | `laolao-dom-watch.js` `mutationObservers=1`、`subtreeObserverCalls=1`（全页唯一共用观察器） |

核对结果：当前 20 条例外全部处于生效状态（每条 `current === exception.value > baseline`），无已失效残留条目。但需要注意：**`exceptions.json` 实际上承载了所有净增长**（含 PR #43 非计划批次的行数抬高 `885 → 910 → 918`），且无任何自动化防线拦阻新 PR 自行添加或调大例外。

---

## 专项核查二：棘轮绕过口子实测（全部反例实测退出 `0`、`3/3 pass`）

在隔离工作树上逐项构造临时反例，运行 `node --test tests/code-health-ratchet.test.mjs`，全部退出 `0`（均已逐字节还原，`git status --short` 为空）：

| 编号 | 绕过类型 | 实测反例内容 | 退出码 / 测试输出 | 仓库现状印证 |
|---|---|---|---|---|
| **L1** | 别的 UI 目录 | 新建 `ui/party/audit-probe.js`（1600 行，含 `!important`、`new MutationObserver`、`setInterval`、`window.__bypassL1 = 1`） | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | 仓库现存 `ui/party/party.{css,js}`、`ui/roundtable/*.{css,js}`、`ui/launcher-loading.html` 共含 **34 处 `!important`、1 处 `setInterval`、3 处 `window.__`**，均不在 `measure.mjs` 扫描范围内 |
| **L2** | 未扫描目录 | 新建 `scripts/audit-probe.js`（1600 行） | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | `SCAN_ROOTS` 不含 `desktop/windows/`、`scripts/`、`proxy/`、`skills/` 与根目录脚本（`build-win.ps1`/`install.ps1`/`install.sh`） |
| **L3** | `ui/injections/` 内排除前缀/目录 | 新建 `ui/injections/laolao-vendor-audit-probe.js`（1600 行 + `!important` + `new MutationObserver` + `observe(...,{subtree:true})` + `setInterval` + `window.__` + `?v=manual99`） | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | `measure.mjs:39` 无条件跳过 `laolao-vendor-*`，第 30 行跳过 `vendor/`、`third-party/`、`laolao-katex/`、`dist/`、`build/` |
| **L4a** | CSS 注释拆分写法 | 在 `ui/injections/laolao-night.css` 首行内插入 `.p{color:red!/*x*/important}`（不增行数） | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | `/!\s*important\b/gi` 不识别合法 CSS 注释 `!/*x*/important` 或转义 `!\69 mportant` |
| **L4b** | JS 替代写法 | 新建 `ui/injections/laolao-audit-alt.js`，同文件写入：`el.style.setProperty("color","red","important")`、`const opts={subtree:true}; new window.MutationObserver(fn).observe(document.documentElement, opts)`、`window["setInterval"](fn,100)`、`globalThis.__bypassA = 1`、`window.__bypassB \|\|= 1`、`'foo.js?v=' + 'hand123'` | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | 仓库中**已真实存在**：`ui/injections/laolao-model-picker.js`（1 处）与 `ui/injections/laolao-phrases.js`（5 处）使用 `setProperty(..., 'important')`；`laolao-phrases.js`（1 处）使用 `globalThis.__* =`；`laolao-dom-watch.js` 使用 `handle.observe(target, options)` 变量传参 |
| **L5a** | 手改 `baseline.json` 抬高 | `laolao-night.css` 同行加 `!important` 且手改 `baseline.json` 将 `461 → 462` | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | `code-health-ratchet.test.mjs` 只对比同工作树里的 `baseline.json`，CI 无对比 `origin/main` 禁止抬高基线的门禁 |
| **L5b** | 任意往 `exceptions.json` 加条目 | `laolao-night.css` 同行加 `!important` 且往 `exceptions.json` 塞一条 `value: 462` | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | 无 CI 审核卡点或允许名单校验 |
| **L5c** | `exceptions.json` 塞入过期/闲置条目 | 往 `exceptions.json` 追加 `laolao-night.css important=999` | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | `ratchet.mjs` 不校验每条例外是否被用到，允许留存休眠豁免项 |
| **L6** | 含 NUL 字节静默跳过整文件 | 新建 `ui/injections/laolao-audit-null.js`（首行注释含 `\x00`，后跟全部禁用写法） | `exit 0` (`tests 3 \| pass 3 \| fail 0`) | `measure.mjs:49` 对含 `\0` 或非 UTF-8 文件返回 `null` 直接跳过而不报错 |
| **L7** | `--write-baseline` 当前彻底不可用 | 在干净 `origin/main` 运行 `node tools/health/measure.mjs --write-baseline` | `exit 1`（输出：`不能把增长（含例外）写进基线：- ui/injections/laolao-dom-watch.js：...`） | `measure.mjs:184` 调用 `healthChanges(current, readJson(file))` 未传入 `exceptions`，导致自 PR #43 引入例外后，测试失败提示 `SYNC_HINT` 指导的 `--write-baseline` 命令始终报错，迫使后续 M1–M4 全部手工/脚本改写 `baseline.json` |

---

## 发现的问题

| 严重程度 | 位置 | 复现步骤 | 建议 |
|---|---|---|---|
| **重要** | `tools/health/ratchet.mjs`、`.github/workflows/ci.yml` | 同时在 `ui/injections/laolao-night.css` 同行加 `!important` 并把 `tools/health/baseline.json` 对应值从 `461` 改为 `462`（或往 `exceptions.json` 增条目），运行 `node --test tests/code-health-ratchet.test.mjs` 退出 `0`；另在 `exceptions.json` 加未用条目（如 `value: 999`）也退出 `0`。 | 在 CI 中增加对 `origin/main` 的 `baseline.json` 单调性检查（禁止任何已存在键增大或删键放宽）、对 `exceptions.json` 任何变更输出显式审阅门禁，并在 `ratchet.mjs` 中把未命中/过期的 `exceptions.json` 条目判为失败。 |
| **重要** | `tools/health/measure.mjs:182-186` | 在干净 `origin/main` 运行 `node tools/health/measure.mjs --write-baseline`，退出 `1` 并报 `不能把增长（含例外）写进基线`。 | 让 `--write-baseline` 仅同步「确实比基线更小」的字段（跳过已登记例外的增长字段，拒绝未登记例外的增长），避免被迫手改 `baseline.json`。 |
| **重要** | `tools/health/measure.mjs:28-44,49` | 分别在 `ui/party/`、`scripts/`、或 `ui/injections/laolao-vendor-probe.js`、或含 `\0` 的 `ui/injections/*.js` 中加入 1600 行与禁用写法，运行 `node --test tests/code-health-ratchet.test.mjs` 均退出 `0`。 | 将 `ui/party`、`ui/roundtable`、`ui/launcher-loading.html`、`scripts`、`proxy`、`desktop/windows`（排除 `mac-runtime`）及根目录构建安装脚本纳入扫描；`laolao-vendor-*` 改为显式允许名单而非任意前缀豁免；对 `ui/injections/` 中含 `\0` 的 `.js/.css/.html` 报错而非静默跳过。 |
| **重要** | `tools/health/measure.mjs:33-34,72-83` | 在 `ui/injections/` 写入 `!/*x*/important`、`setProperty(...,'important')`、`new window.MutationObserver`、变量传入 `.observe(el, opts)`、`window['setInterval']`、`globalThis.__x =`、`window.__x \|\|=`、`'a.js?v=' + '1'`，运行棘轮测试退出 `0`。 | 补齐正则：去除 CSS 注释后再数 `!important` 并新增 `setProperty(..., 'important')` 检查；`MutationObserver` 覆盖 `(?:window\|globalThis\|self)\.` 与标识符引用；`window.__` 覆盖 `globalThis`/`self` 及 `\|\|=`/`??=`；对非字面对象参数的 `.observe(x, var)` 给出告警或纳入审计。 |
| **重要** | `tools/health/hotspots.mjs:33-35` | 在当前浅克隆工作区（`git rev-parse --is-shallow-repository` 为 `true`）运行 `HOTSPOTS.md` 记载的复现命令 `node tools/health/hotspots.mjs --ref 2c1fa0bb28d6326d5459376748a8440f155d80ab --as-of 2026-11-20`，退出 `0` 但输出 `290` 而非 `293`（丢掉 3 个被 `.git/shallow` 截断的提交）。 | 在 `hotspots.mjs` 开头检查 `git rev-parse --is-shallow-repository`，若为 `true` 则报错退出或明确打印告警要求完整历史。 |
| **次要** | `tools/health/ratchet.mjs:61-67` | 新建的 `ui/injections/` 文件（如 M1 的 `laolao-game-stage.js`、M3 的 `laolao-dom-watch.js`）未进入 `baseline.json`，在 `1..1500` 行内可任意增长不触发棘轮。 | 在基线同步机制修复后，将新增注入文件纳入 `baseline.json` 锁定行数上限。 |

---

## 没测的条目

| 条目 | 原因 | 需要谁、在哪台机器补测 |
|---|---|---|
| Z1 ★（本机重跑全量 `run-tests.mjs`） | 本次任务单明确只做只读复核、不跑重编译/打包，且 M0 PR #40 已有双轮 CI 全绿证据（`44879503072`、`44883651113`） | 第一次统一验收 `summary` 组在最新 `main` 上统一跑全量门禁 |
| Z3 ★（M5 截图基线） | M0 合并时 M5 尚未落地，不适用 | — |
