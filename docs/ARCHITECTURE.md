# 架构说明

```text
超級碧琪.app
  ├─ WKWebView 桌面窗口
  ├─ 原生语音听写 / 音频播放
  ├─ 原生文件夹选择 / Finder 定位
  └─ 首次启动应用 UI 与人格
           │
           ▼
CLE Kk Control UI
  ├─ laolao-theme.css             透明玻璃与交互
  ├─ laolao-sidebar.js            置顶、项目、目录管理
  ├─ laolao-mode-switcher.js      四模式无缝切换
  ├─ laolao-live-voice.js         语音回合与摘要朗读
  ├─ laolao-image-viewer.js       图片放大
  ├─ laolao-phrases.js            中文人格状态话术
  └─ splash / transition assets   启动与切换动画
           │
           ▼
CLE Kk Gateway ── mm-retry-proxy ── 模型上游
           └────── transport patch ─────┘
```

## 更新边界

- Git 仓库是发布源。
- `update-full.sh` 拉取源码并重新安装。
- LaunchAgent 每 15 分钟检查一次本机 CLE Kk UI，内核更新覆盖 UI 后会自动重新应用。
- 人格文件不经过模板、变量替换或构建转换。
- 本机路径只存在于安装后生成的 `install.env` 和 LaunchAgent，不进入仓库。

## 核心模块对照表（M4 拆分）

### 模式架构插件（`services/mode-architecture/`）

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

### Windows 桌面壳（`app/`）

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
