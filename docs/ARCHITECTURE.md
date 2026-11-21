# 超級碧琪（Super Pinkie）架构地图

本文档是仓库的权威结构说明与「功能 → 文件 → 测试」总索引，与根目录 [`CLAUDE.md`](../CLAUDE.md) / [`AGENTS.md`](../AGENTS.md) 配套阅读。

## 一、五层架构总览

```text
1. 桌面壳（Desktop Shell）
   ├─ macOS: desktop/macos/pinkie/Sources/Launcher.swift（WKWebView / 原生语音 / 更新 / 网关监管）
   └─ Windows: app/windows_desktop.py + 8 个拆分模块（WebView2 / 原生托盘与玻璃 / 更新器 / 网关监管）
            │  拉起内置 Node + OpenClaw（或 C.le.）网关（18789）与本地配套服务
            ▼
2. 网关与内核层（Gateway & Kernel）
   ├─ 上游 OpenClaw 运行时 + patch/apply-*.mjs 补丁集（K5 切换前默认）
   │    └─ Windows 打包目前复用 Mac 预打补丁快照 desktop/windows/mac-runtime/（SHA256SUMS）
   ├─ 自有内核仓库 Cle0726/cle-core（K2 起接入 core-manifest.json，K3–K5 逐步替代补丁与快照）
   └─ 本地重试代理 proxy/mm-retry-proxy.py（1467）
            │  加载 OpenClaw 插件与 Control UI 静态资源
            ▼
3. 业务插件与本地服务层（Services）
   ├─ services/mode-architecture/（主入口 index.mjs + M4 拆出的 7 个核心模块 + 各子功能模块）
   ├─ services/project-scope/（工作区作用域）
   ├─ services/party/（派对空间 18889）
   └─ services/roundtable/（圆桌讨论 18891）
            │  注入 Control UI 页面脚本、样式与原生桥接
            ▼
4. 控制台界面与注入层（Control UI & Injections）
   ├─ ui/control-ui.index.html + ui/runtime/（共享聊天渲染入口）
   ├─ ui/injections/laolao-head.fragment.html（所有注入文件清单，使用 ?v=@hash 自动版本号）
   ├─ ui/injections/REGIONS.md & ui/injections/regions.json（区域负责表，防插件样式打架）
   └─ ui/injections/laolao-dom-watch.js（全页唯一共用子树 MutationObserver）
            │  按模式加载对应人格与技能手册
            ▼
5. 人设与技能层（Personas & Skills）
   ├─ personas/（chat / project / thinking / learning / neutral / metre，不经模板转换）
   └─ skills/（内置技能 + skills/community-skills.json 登记的社区技能 + skills/THIRD_PARTY_SKILLS.md）
```

---

## 二、功能 → 文件 → 测试 对照表

> 下表所列全部路径均为仓库真实路径（M7-1 ★ 自动校验）。

| 功能模块 | 核心文件 | 对应测试 |
|---|---|---|
| **五个老模式（唠嗑/项目/想法/学习/无限）** | `services/mode-architecture/index.mjs`、`services/mode-architecture/mode-architecture-core.mjs`、`services/mode-architecture/mode-constants.mjs`、`personas/chat/SOUL.md`、`personas/project/SOUL.md`、`personas/thinking/SOUL.md`、`personas/learning/SOUL.md`、`personas/neutral/SOUL.md` | `tests/mode-architecture.test.mjs`、`tests/mode-names.test.mjs`、`tests/tier-ladder.test.mjs`、`tests/tier-interplay.test.mjs` |
| **Metre 模式** | `services/mode-architecture/metre-roles.mjs`、`services/mode-architecture/metre-board.mjs`、`services/mode-architecture/metre-memory.mjs`、`services/mode-architecture/metre-lock.mjs`、`ui/injections/laolao-metre-skin.js`、`ui/injections/laolao-metre-skin.css`、`personas/metre/SOUL.md` | `tests/metre-inject.test.mjs`、`tests/metre-roles.test.mjs`、`tests/metre-lock.test.mjs` |
| **侧栏与会话列表** | `ui/injections/laolao-sidebar-surface.css`（**侧栏背景色与表面样式负责文件**）、`ui/injections/laolao-sidebar.js`、`ui/injections/laolao-session-list.js`、`services/mode-architecture/session-titles.mjs`、`services/mode-architecture/session-lineage.mjs` | `tests/ui-region-ownership.test.mjs`、`tests/hotspot-ui-regression.test.mjs`、`tests/visual-baseline.test.mjs` |
| **学习台（Study Desk）** | `services/mode-architecture/learning.mjs`、`services/mode-architecture/learning-desk.mjs`、`services/mode-architecture/learning-drill.mjs`、`services/mode-architecture/learning-pact.mjs`、`ui/injections/laolao-study-desk.js`、`ui/injections/laolao-study-desk.css` | `tests/learning-desk.test.mjs`、`tests/study-desk-ui.test.cjs`、`tests/study-desk-panes.test.cjs` |
| **学习台游戏（Study Game）** | `services/mode-architecture/learning-game.mjs`、`services/mode-architecture/learning-game-world.mjs`、`services/mode-architecture/learning-game-exam.mjs`、`ui/injections/laolao-game-hud.js`、`ui/injections/laolao-game-battle.js`、`tools/study-game/play.mjs` | `tests/learning-game.test.mjs`、`tests/learning-game-world.test.mjs`、`tests/learning-game-exam.test.mjs` |
| **派对空间（Party Space）** | `services/party/server.py`、`services/party/live.py`、`services/party/openclaw-live.mjs`、`ui/injections/laolao-party-entry.js` | `tests/party_service_test.py`、`tests/party_stream_test.py`、`tests/party-entry.test.cjs` |
| **圆桌（Roundtable）** | `services/roundtable/server.py`、`ui/injections/laolao-roundtable-entry.js` | `tests/roundtable_service_test.py`、`tests/roundtable_ui.test.cjs` |
| **内置浏览器（In-App Browser）** | `app/inapp_browser.py`、`app/inapp_browser_host.py`、`app/inapp_browser_pages.py`、`app/browser_proxy.py`、`services/mode-architecture/app-browser.mjs` | `tests/app-browser-windows-fallback.test.mjs`、`tests/inapp_browser_scope_test.py`、`tests/browser_proxy_test.py` |
| **更新器（Windows / macOS）** | `app/windows_updater.py`、`app/windows_update_guard.py`、`app/windows_ps_templates.py`、`desktop/macos/pinkie/Sources/Launcher.swift` | `tests/windows_update_test.py`、`tests/windows_update_ui_test.py`、`tests/windows_update_health_test.py`、`tests/guard_update_signature_test.py` |
| **资源版本自动哈希（M2）** | `tools/assets/stamp.mjs`、`ui/injections/laolao-head.fragment.html`、`tools/ui-parity/bundle.py`、`installer/macos/apply-theme.sh`、`installer/windows/apply-theme.ps1`、`build-win.ps1` | `tests/windows-self-contained.test.cjs`、`tests/self-contained-app.test.cjs`、`tests/code-health-ratchet.test.mjs` |
| **页面区域与共用观察器（M3）** | `ui/injections/REGIONS.md`、`ui/injections/regions.json`、`ui/injections/laolao-dom-watch.js` | `tests/ui-region-ownership.test.mjs`、`tests/shared-dom-watch.test.mjs` |
| **视觉基线与热点护栏（M5）** | `tests/visual/lib/harness.mjs`、`tests/visual/lib/png-diff.mjs`、`tests/visual/baseline/home-chat-day.png` | `tests/visual-baseline.test.mjs`、`tests/hotspot-ui-regression.test.mjs` |
| **健康度棘轮（M0）** | `tools/health/measure.mjs`、`tools/health/ratchet.mjs`、`tools/health/baseline.json`、`tools/health/exceptions.json` | `tests/code-health-ratchet.test.mjs` |
| **技能路由与社区技能** | `services/mode-architecture/skill-routes.mjs`、`skills/community-skills.json`、`skills/THIRD_PARTY_SKILLS.md` | `tests/skill-routes.test.mjs` |
| **补丁与 Windows 快照** | `patch/apply-all.mjs`、`patch/lib-apply-dist.mjs`、`tools/windows-package/refresh_mac_runtime.py`、`desktop/windows/mac-runtime/SHA256SUMS` | `tests/windows-self-contained.test.cjs`、`tests/windows_runtime_files_test.py` |

---

## 三、核心模块对照表（M4 拆分）

### 3.1 模式架构插件（`services/mode-architecture/`）

| 模块 | 职责 |
|---|---|
| `services/mode-architecture/index.mjs` | 插件注册入口、`api.on` / `registerGatewayMethod` 接线与工具工厂（`createDeliveryGuardTool`、`createLongTermMemoryTool`、`createCuaComputerTool`） |
| `services/mode-architecture/mode-constants.mjs` | 模式常量、任务分类（`classifyDeliberationTask`）、本地安装失败处理（`localSetupFailure`）与上游故障/瞬态失败判定 |
| `services/mode-architecture/evidence-rules.mjs` | 工作约定、交付证据/回执辅助、交付物检查规则（`WORK_STANDARD_RULES`、`TOOL_BATCH_RULES`、`promiseWithoutActionReason` 等） |
| `services/mode-architecture/completion-integrity.mjs` | `CompletionIntegrityGuard` 与回合交付真实性把关 |
| `services/mode-architecture/clekk-supervisor.mjs` | `CleKkAuditLog` 哈希链审计日志与 `CleKkSupervisor` 轮次裁决引擎 |
| `services/mode-architecture/watchdog-runtime.mjs` | `WatchdogJobStore`、`FileRunStore`、`CompactionHandoffStore`、`ModelUsageLedger`、`UpstreamWatchdog`、`TierContinuation` |
| `services/mode-architecture/deliberation-audit.mjs` | 深度思考审计（`auditDeliberation`）、验证证据采集、工作区文件读取与重试计划（`buildDeliberationPlan`） |
| `services/mode-architecture/mode-architecture-core.mjs` | `ModeArchitecture` 核心运行控制器（人设/记忆提示词拼装、档位编排与生命周期钩子） |

### 3.2 Windows 桌面壳（`app/`）

| 模块 | 职责 |
|---|---|
| `app/windows_desktop.py` | Windows 桌面壳主入口（`run_desktop`、`finish_exit`、`install_native_bridge`）与子模块统一重导出 |
| `app/windows_ps_templates.py` | PowerShell UI、进度窗口与修复脚本模板常量（`FOREGROUND_PS`、`PINKIE_WPF_PS`、`PROGRESS_WINDOW_PS`、`REPAIR_PS`、`UPDATE_LOG_PS`、`UPDATE_UI_PS`） |
| `app/windows_update_guard.py` | 发布元数据解析、Ed25519 更新签名校验与防护告警辅助 |
| `app/windows_updater.py` | `WindowsUpdater` 自更新器与 `UpdateHealthReporter` 更新后健康上报 |
| `app/windows_elevated.py` | `ElevatedProcess`、`start_elevated`、`hidden_process_kwargs` 及原生圆角/缩放/毛玻璃窗口控制 |
| `app/windows_runtime.py` | `BundledRuntime` 内置运行时布局与 `DesktopControlNode` 桌面控制节点管理 |
| `app/windows_gateway.py` | `GatewaySupervisor` 网关监管与 `LocalServices` 本地配套服务管理 |
| `app/windows_bridge.py` | `NativeBridge` 桌面桥接与附件/通知辅助函数 |
| `app/windows_bridge_scripts.py` | 注入 WebView2 的前端桥接与原生阅读面脚本（`BRIDGE_SCRIPT`、`NATIVE_READING_SCRIPT`） |

---

## 四、关键工程规矩（M2 / M3 / M4 / 内核与补丁）

1. **资源版本号自动生成（M2）**：
   - 源码中**禁止手写任何 `?v=xxx`**。`ui/injections/laolao-head.fragment.html` 统一写 `?v=@hash`；JS 内懒加载资源一律调用 `window.__pinkieAsset('<filename>')`。
   - 安装或打包时由 `tools/assets/stamp.mjs` 与 `tools/ui-parity/bundle.py` 按内容 SHA-256 前 10 位自动生成版本号和 `laolao-asset-manifest.js`（该文件不提交进仓库）。
2. **新增注入文件的完整步骤（M2 + M3）**：
   1. 将新文件放入 `ui/injections/`，不手写版本号，保持 ≤ 1500 行、0 新增 `!important`、0 新增 `MutationObserver`（DOM 监听改用 `window.__pinkieDom.watch(selector, handler)`）、0 新增 `window.__*`（挂在 `window.Pinkie.<region>`）。
   2. 在 `ui/injections/laolao-head.fragment.html` 以 `?v=@hash` 引入（或懒加载时用 `window.__pinkieAsset(...)`）。
   3. 在 `ui/injections/regions.json`（及 `ui/injections/REGIONS.md`）登记该文件的归属区域，严禁在非负责 CSS 中以其他区域的根选择器开头（例如改侧栏背景色只能改 `ui/injections/laolao-sidebar-surface.css`）。
   4. 运行 `tests/ui-region-ownership.test.mjs`、`tests/code-health-ratchet.test.mjs`、`tests/visual-baseline.test.mjs` 验证通过。
3. **文件体量与纯搬家拆分（M0 + M4）**：
   - 新文件不得超过 **1500 行**；已有超过 1500 行的文件只许变小，改善后同步更新 `tools/health/baseline.json`。
   - 拆出 `services/mode-architecture/*.mjs` 新模块时，必须同步加入 `services/mode-architecture/setup.py` 和 `installer/macos/apply-theme.sh` 的文件清单。
   - 拆出 `app/windows_*.py` 新模块时，兄弟模块导入必须采用「顶层导入优先 + `except ImportError: from app.<mod>` 兜底」，确保 PyInstaller `--paths app` 冻结包不缺模块（由 `tests/windows_frozen_imports_test.py` 把关）。
4. **内核、补丁与 Windows 快照边界（M6 已由 K3 取代）**：
   - **K5 切换前（当前 OpenClaw 补丁路径）**：修改 `patch/apply-*.mjs` 后，Windows 打包使用 `desktop/windows/mac-runtime/` 中的 Mac 预打补丁快照，必须在 Mac 上运行 `python3 tools/windows-package/refresh_mac_runtime.py` 刷新 `desktop/windows/mac-runtime/` 与 `SHA256SUMS`，否则 Windows 端不会拿到补丁修复。
   - **自有内核路径（C.le.，`Cle0726/cle-core`）**：内核源码改动全部在私有仓库 `Cle0726/cle-core` 中开发、跑三平台编译与反向 CI、发布 `.tgz` Release，然后在碧琪仓库更新 `core-manifest.json` 的版本号与 SHA-256 即可让碧琪用上；K5 切换后旧补丁与 Windows 快照同步退休。
5. **社区技能安装与登记**：
   - 将技能目录放入 `skills/<name>/SKILL.md`，在 `skills/community-skills.json` 登记并在 `skills/THIRD_PARTY_SKILLS.md` 注明来源；`services/mode-architecture/skill-routes.mjs` 与双端打包脚本会自动收录。
6. **多 AI 并行协作**：
   - 开工前执行 `git fetch origin`，查看 `gh pr list --state open`、两份 `PROGRESS.md` 总表及对应批次的 `briefs/<计划>/progress/<批号>.md` 接力卡，完整规矩见 `briefs/program-1120/CONCURRENCY.md`。
