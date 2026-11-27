# 超級碧琪（Super Pinkie）仓库必读规矩

开工前请配合阅读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与多 AI 协作规矩 [`briefs/program-1120/CONCURRENCY.md`](briefs/program-1120/CONCURRENCY.md)。

## 1. 分支与并行协作
- `main` 是唯一长期主线；一项任务一条短分支。两台机器开工前先 `git fetch origin`，从最新 `origin/main` 切分支。
- 严禁推送基于 2026-11 历史改写前的旧本机分支（推送前查 `git rev-list --count origin/main..HEAD`）。
- 超过 3 天未合并的分支每天变基 `origin/main`；合并后删除分支；删除远端分支前必须先打存档标签 `archive/2026-11/<原分支名>`。
- 多个 AI 并行时，先看 `gh pr list --state open`、`PROGRESS.md` 总表与 `briefs/<计划>/progress/<批号>.md` 接力卡，不碰他人认领的独占文件和工作区。

## 2. 界面与注入规矩（M2 / M3 / M5）
- **禁止手写版本号（M2）**：`ui/injections/laolao-head.fragment.html` 统一用 `?v=@hash`，JS 懒加载统一用 `window.__pinkieAsset('<file>')`，由 `tools/assets/stamp.mjs` 自动生成内容哈希。
- **区域负责表（M3）**：新增或修改注入文件必须遵守 `ui/injections/REGIONS.md` 与 `regions.json`（如改侧栏背景色只改 `ui/injections/laolao-sidebar-surface.css`），非负责 CSS 禁止以其他区域的根选择器开头；新文件必须登记进 `regions.json`。
- **不新增 `!important`、观察器与旧全局变量**：全页只保留 1 个子树 `MutationObserver`（`ui/injections/laolao-dom-watch.js`，通过 `window.__pinkieDom.watch` 注册）；新全局变量一律挂 `window.Pinkie.<region>`，不再新增 `window.__*`。
- **不破坏外观**：严禁为了测试通过而擅自更新 `tests/visual/baseline/` 截图基线（除非用户明确点头的文案/外观改动）。

## 3. 代码体量与补丁边界（M0 / M4 / 内核）
- **1500 行上限**：新文件不得超过 1500 行；已有超限文件只许变小，改善后同步 `tools/health/baseline.json`。
- 拆出 `services/mode-architecture/*.mjs` 新模块须同步 `setup.py` 与 `installer/macos/apply-theme.sh`；`app/windows_*.py` 须使用顶层导入优先 + `from app.<mod>` 兜底。
- **补丁与内核**：K5 切换前，修改 `patch/apply-*.mjs` 后必须在 Mac 运行 `tools/windows-package/refresh_mac_runtime.py` 刷新 `desktop/windows/mac-runtime/` 快照，Windows 包才会生效。自有内核 C.le. 源码在私有仓库 `Cle0726/cle-core` 开发，发版后在碧琪更新 `core-manifest.json`。
- **不再新增补丁（PLAN 7.1-6，11-27 起）**：从现在起改内核行为一律去 `cle-core` 改、发新的内核小版本，碧琪只更新 `core-manifest.json` 里的版本号；碧琪不再新增任何 `patch/apply-*.mjs`。现有补丁按名字登记在 `tools/health/patch-files.json`，只许删、不许加（棘轮测试与 CI 目标分支对比都会拦）；补丁搬进 `cle-core` 后删文件时同一 PR 删掉对应行，现有补丁文件留到 K5 清理。
- **社区技能**：放入 `skills/<name>/SKILL.md` 并登记到 `skills/community-skills.json`。

## 4. 测试与复发防护
- **修 bug 必带复发测试**：每个复发型问题必须补一个能抓住它复发的自动化测试。
- **常用验证命令**（均在隔离环境运行，绝不碰正式 App、`~/.openclaw` 与 18789 正式网关）：
  - 全量 Node 门禁：`node tools/release-gate/run-tests.mjs`（严禁往 `tools/release-gate/known-failures.json` 新增条目）
  - Python 单元测试：`python -m unittest discover -s tests -p '*_test.py'`
  - 健康度棘轮：`node --test tests/code-health-ratchet.test.mjs`
  - 区域负责检查：`node --test tests/ui-region-ownership.test.mjs`
  - 视觉与热点回归：`node --test tests/visual-baseline.test.mjs tests/hotspot-ui-regression.test.mjs`

## 5. 合并与发版权限
- **合并**：计划内批次自查通过、CI 全绿、满足 `CONCURRENCY.md` 4.3 全部条件即可由 AI 自动合并（禁止 `--admin`，禁止强推 `main`）。
- **必须用户明确点头**：发正式版、打 release tag、K5 默认内核切换与旧路清理、以及计划外改动。
