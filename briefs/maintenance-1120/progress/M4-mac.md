# M4-Mac · 拆 `Launcher.swift`（纯搬家，不改逻辑）· 执行记录

## 接力卡（最后更新：2026-11-24 18:52，Gemini-Mac-m4k2 @ macOS）

- 状态：**自查通过（草稿 PR 待合）** — 本分支所有纯搬家提交、接线、单测、棘轮基线、视觉/热点回归与本地隔离 `.app` 打包签名校验均已完成；保持为 **Draft PR** 以避免与 [PR #54](https://github.com/Cle0726/super-pinkie/pull/54)（`build.sh` / `apply-theme.sh` / `ci.yml` 不同区块）及在途 UI 草稿 PR（`tools/health/baseline.json` `longFiles` 区块）撞车，待协调者或用户在合入顺序确定后一键变基合并。
- 分支和 PR：`maint/m4-mac-launcher`（基于 `origin/main` `47d027da`），草稿 [PR #93](https://github.com/Cle0726/super-pinkie/pull/93)
- 已完成：
  1. 建工作区 `/Users/Admin/release-superpinkie/wt/m4-mac-launcher`，记录 Z2 开工只读现场
  2. 完成 `CONCURRENCY.md` 3.8 两道护栏反例确认并逐字节还原（M0 棘轮测试与 M5 截图回归测试均退出码 `1` 精准拦截）
  3. 前置可见性提交 `b4c52f6c`：仅将跨文件共享的 166 处声明从 `private` 放宽为同模块 `internal`（行数变化 `0`，不改任何表达式与控制流）
  4. 按单文件逐提交纯搬家拆分 `desktop/macos/pinkie/Sources/Launcher.swift`（`5746` 行 → `989` 行），拆出 6 个子模块全部 ≤ 1500 行，**全部 6 个拆分提交在 `git diff --color-moved=zebra --color-moved-ws=ignore-all-space` 下非搬家正文行为 `0`**，每提交均单独通过 `xcrun swiftc -parse-as-library -typecheck`
  5. 同步接线 `desktop/macos/build.sh`、`installer/macos/apply-theme.sh`（`LAUNCHER_SUPPORT_SOURCES` 与 `sync_launcher_resources`）及 `.github/workflows/ci.yml`，并在 `tests/native-brand-isolation.test.cjs` 补齐 `sync_launcher_resources` 源文件一致性断言
  6. 同步更新直读 `Launcher.swift` 源码的 11 个测试文件，14 个 Mac 原生契约测试文件（12 个 Node + 2 个 Python）100% 通过
  7. 更新 `docs/ARCHITECTURE.md`（补充 `3.3 macOS 桌面壳` 7 模块对照表与拆分规矩，M7-1 路径检查本批新增路径 `missing: 0`）
  8. **Z4 ★ 通过**：`node tools/health/measure.mjs --write-baseline` 从 `longFiles` 移除 `desktop/macos/pinkie/Sources/Launcher.swift`（14 → 13），`tests/code-health-ratchet.test.mjs`、`tests/code-health-loopholes.test.mjs`、`tests/ui-region-ownership.test.mjs` 16/16 通过，`compare-baseline.mjs` 通过
  9. **M4-3 ★ / Z5 ★ 通过**：`tools/metre/inject-inventory.mjs --save-baseline`（`origin/main` `47d027da`）与本分支 `--verify-baseline` 6 模式 × 3 样例 SHA-256 逐字一致（`6c9dd86f8b99baa307eb21e81461e36e1b89b1e6aa4095fe93fd30d8422287c4`，`diffs: []`）；`git diff 47d027da -- personas prompts skills ui/injections services/mode-architecture` 为空
  10. **Z3 ★ 通过**：`tests/visual-baseline.test.mjs`（24 张画面确定性渲染）+ `tests/hotspot-ui-regression.test.mjs`（10 项热点）在 Mac 上全部通过
  11. **M4-4 ★ 隔离打包与签名验证通过**：在隔离目录 `/private/tmp/pinkie-mac-1124-m4k2/dist-m4-mac` 完整跑通 `./desktop/macos/build.sh`（退出码 `0`），`Mac mode plugin fresh-install import OK`、`shared UI check OK: 211 entries, 1699 resources`、`codesign --verify --deep --strict` 校验通过（`designated => identifier "com.cle0726.super-pinkie"`），包内 `Contents/Resources/SuperPinkie/desktop/macos/pinkie/Sources/` 收录全部 11 个 `.swift` 文件，`Contents/MacOS/Launcher`（`arm64` Mach-O）符号完整；构建产物已清理
  12. **Z2 ★ 核对通过**：正式环境只读元数据与签名 100% 一致
- 正在做：推送分支并创建草稿 PR，等待远程 CI 全绿
- 下一步：待 PR #54 或在途 UI 分支合入 `main` 后，零冲突（或一行级）变基并转为 Ready 合并
- 没推送的东西：无（提交后立即推送）
- 环境：工作区 `/Users/Admin/release-superpinkie/wt/m4-mac-launcher`（推送后收工清理）；临时目录 `/private/tmp/pinkie-mac-1124-m4k2`（收工清理）；端口无占用；后台进程无
- 正在跑的长操作：无
- 踩过的坑：
  - Swift 的 `private` 在同一文件不同 `extension` 间可见，但拆到同模块不同 `.swift` 文件后必须改为默认 `internal`；单独用前置提交 `b4c52f6c` 精确放宽跨文件引用的 166 处声明，从而保证后续 6 个拆文件提交每一个都是 100% 纯搬家（`non-moved body lines = 0`）。
  - `installer/macos/apply-theme.sh` 除了第 12 行单行 `LAUNCHER_SUPPORT_SOURCES=(...)` 外，第 154 行 `sync_launcher_resources` 还维护了一份拷入 `.app` 包内的原生源码名单；两处均已补齐并在 `tests/native-brand-isolation.test.cjs` 加上自动一致性检查。
- 待用户决定：无（保持草稿 PR，待与 #54 排定先后顺序即可合入）

---

## 一、正式环境只读现场对比（Z2 ★）

| 现场项 | M4-Mac 开工前基线 | M4-Mac 收工核对 | 结果 |
|---|---|---|---|
| `/Users/Admin/.openclaw/openclaw.json` `st_mtime_ns` | `1795516469014822765` | `1795516469014822765` | 一致 |
| `/Applications/超級碧琪.app` 签名与 `CDHash` | `codesign --verify --deep --strict` 通过（`3d00b24379b79ff6de7de4b22a33eaa301ea6018`） | `codesign --verify --deep --strict` 通过（`3d00b24379b79ff6de7de4b22a33eaa301ea6018`） | 一致 |
| `launchd` `ai.openclaw.watchdog` | `/Users/Admin/Library/LaunchAgents/ai.openclaw.watchdog.plist` | `/Users/Admin/Library/LaunchAgents/ai.openclaw.watchdog.plist` | 一致 |
| `18789` 端口监听进程 | `node` PID `6381` | `node` PID `6381` | 一致 |

## 二、护栏确认（CONCURRENCY 3.8）

1. **M0 棘轮护栏反例**：在 `ui/injections/laolao-night.css` 临时追加 1 处 `!important`，运行 `node --test tests/code-health-ratchet.test.mjs` 退出码 `1` 精准拦截；`git checkout` 还原后 SHA-256 `8b4fecbd6db64f09634a7e155571871fb42fc04e3c51089cb200266f653961d4` 一致，复跑 3/3 通过。
2. **M5 截图护栏反例**：在 `ui/injections/laolao-theme.css` 临时追加 `button { transform: translate(12px, 12px); }`，在 `PINKIE_VISUAL_COMPARE=1` 下运行 `node --test tests/visual-baseline.test.mjs` 退出码 `1`，报错：`home-chat-day exceeded visual threshold: 2.2740% > 0.1% (23286/1024000 px)`；还原后 SHA-256 `4ff0ac29980d7a87e68b9431b314563a71f0a4d9acde2abe009ffcd43edeec49` 一致，清理 `tests/visual/diff` 后复跑 `tests/visual-baseline.test.mjs` 2/2 通过、`tests/hotspot-ui-regression.test.mjs` 10/10 通过。

## 三、拆分结果与 `--color-moved` 验证（M4-1 ★ / M4-2 ★）

`desktop/macos/pinkie/Sources/Launcher.swift`：**5746 行 → 989 行**（全部 7 个模块均 ≤ 1500 行）：

| 提交 | 模块 | 行数 | `--color-moved=zebra --color-moved-ws=ignore-all-space` 非搬家正文行 | `swiftc -typecheck` |
|---|---|---:|---:|---|
| `b4c52f6c` | 前置：166 处跨文件声明 `private` → `internal` | 5746 | 0 行增删（仅修饰符） | 退出码 `0` |
| `f920b17e` | `desktop/macos/pinkie/Sources/LauncherRuntime.swift` | 966 | **0** | 退出码 `0` |
| `d89dc870` | `desktop/macos/pinkie/Sources/LauncherViews.swift` | 316 | **0** | 退出码 `0` |
| `12a607bd` | `desktop/macos/pinkie/Sources/LauncherServices.swift` | 925 | **0** | 退出码 `0` |
| `b1d3ac36` | `desktop/macos/pinkie/Sources/LauncherBrowser.swift` | 1202 | **0** | 退出码 `0` |
| `38f325f0` | `desktop/macos/pinkie/Sources/LauncherWorkspace.swift` | 557 | **0** | 退出码 `0` |
| `554c27d0` | `desktop/macos/pinkie/Sources/LauncherWebBridge.swift` | 853 | **0** | 退出码 `0` |
| — | `desktop/macos/pinkie/Sources/Launcher.swift`（主入口） | 989 | — | 退出码 `0` |

## 四、验收自查表（ACCEPTANCE.md）

| 条目 | 状态 | 证据 |
|---|---|---|
| **Z1 ★** | **过（本地 Mac 契约集 + 待远程全平台 CI 确认）** | 14 个 Mac 原生契约测试文件（12 Node + 2 Python）全绿；`known-failures.json` 未改；远程 PR CI 将跑全量 `portable-checks` / `macos-check` / `windows-build` / `windows-checks` / `ratchet` |
| **Z2 ★** | **过** | 正式环境 `openclaw.json`、`/Applications/超級碧琪.app`（`CDHash`）、`ai.openclaw.watchdog` 与 `18789` 进程完全未动 |
| **Z3 ★** | **过** | Mac 本地 `visual-baseline.test.mjs` 2/2、`hotspot-ui-regression.test.mjs` 10/10 全过；未改任何 `ui/` 或 `services/` 代码 |
| **Z4 ★** | **过** | `tools/health/baseline.json` `longFiles` 移除 `Launcher.swift`（5746），`code-health-ratchet` + `code-health-loopholes` + `ui-region-ownership` 16/16 通过，`compare-baseline.mjs` 通过 |
| **Z5 ★** | **过** | `git diff 47d027da -- personas prompts skills` 为空；`inject-inventory.mjs --verify-baseline` 6 模式 × 3 样例 SHA-256 逐字一致（`6c9dd86f8b99baa307eb21e81461e36e1b89b1e6aa4095fe93fd30d8422287c4`，`diffs: []`） |
| **Z6** | **过（草稿待合）** | 基于最新 `origin/main`（`47d027da`）切短分支 `maint/m4-mac-launcher` |
| **M4-1 ★** | **过** | `Launcher.swift` 989 行 ≤ 1500 行，拆出的 6 个 `Launcher*.swift` 模块（316–1202 行）及同目录其余 4 个 `.swift` 文件全部 ≤ 1500 行 |
| **M4-2 ★** | **过** | 6 个拆文件提交逐个 `--color-moved=zebra --color-moved-ws=ignore-all-space` 非搬家正文行为 `0`，每提交单独 `swiftc -typecheck` 退出码 `0` |
| **M4-3 ★** | **过** | 见 Z5 ★ |
| **M4-4 ★** | **过** | 隔离执行 `./desktop/macos/build.sh` 成功产出完整签名的 `超級碧琪.app`，`codesign --verify --deep --strict` 通过，包内含全部 11 个 `.swift` 源文件与完整 `arm64` `Launcher` 可执行文件 |
| **M4-5** | **过** | 6 个新模块顶部均写明职责注释，已补入 `docs/ARCHITECTURE.md` §3.3 对照表及第四节规矩 |
