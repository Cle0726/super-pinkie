# `docs/` 文档索引

本索引区分**当前有效文档**与已归档的历史修复报告（`docs/archive/`）。仓库根目录的必读规矩见 [`CLAUDE.md`](../CLAUDE.md) / [`AGENTS.md`](../AGENTS.md)。

## 一、核心架构与平台文档（有效）

| 文档 | 说明 |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 权威五层架构图、「功能 → 文件 → 测试」总表、M4 拆分模块表及 M2/M3/M4/内核工程规矩 |
| [`FULL_APP.md`](FULL_APP.md) | macOS 独立桌面 App 打包与运行说明 |
| [`WINDOWS.md`](WINDOWS.md) | Windows 桌面 App 架构、打包与 Mac 快照说明 |
| [`WINDOWS-UI-PARITY.md`](WINDOWS-UI-PARITY.md) | Mac / Windows 双端共享 Control UI 校验规范 |
| [`SECURITY.md`](SECURITY.md) | 安全边界、签名与本地防护说明 |
| [`RELEASE-NOTES.md`](RELEASE-NOTES.md) | 历史版本发布说明 |

## 二、功能与子系统设计文档（有效）

| 文档 | 说明 |
|---|---|
| [`METRE-MODE.md`](METRE-MODE.md) | Metre 模式设计与角色协作 |
| [`DEEP-THINK-TIERS.md`](DEEP-THINK-TIERS.md) | 深度思考档位与审议机制 |
| [`CONTEXT-MANAGEMENT.md`](CONTEXT-MANAGEMENT.md) | 上下文压缩与会话续读 |
| [`LONG-TERM-MEMORY.md`](LONG-TERM-MEMORY.md) | 分模式长期记忆隔离设计 |
| [`PROJECT-SCOPE.md`](PROJECT-SCOPE.md) | 项目工作区作用域 |
| [`SESSION-SIDEBAR.md`](SESSION-SIDEBAR.md) | 侧栏会话分组与置顶设计 |
| [`PARTY-SPACE.md`](PARTY-SPACE.md) | 派对空间（18889）设计 |
| [`ROUNDTABLE.md`](ROUNDTABLE.md) | 圆桌讨论（18891）设计 |
| [`WORKBENCH-PROMPT.md`](WORKBENCH-PROMPT.md) | 代码工作台与提示词衔接 |
| [`UI-MOTION.md`](UI-MOTION.md) | 界面动效与减少动态偏好 |
| [`LIVE-PROGRESS.md`](LIVE-PROGRESS.md) | 工具调用进度展示 |
| [`USER-SETTINGS-PRESETS.md`](USER-SETTINGS-PRESETS.md) | 用户设置与预设说明 |
| [`FEEDBACK-SETUP.md`](FEEDBACK-SETUP.md) | 反馈加密与上报配置 |
| [`study-game/WINDOWS-DEV.md`](study-game/WINDOWS-DEV.md) | 学习台游戏 Windows 本地开发与试玩说明 |
| [`INLINE-LEARNING-IMPLEMENTATION.md`](INLINE-LEARNING-IMPLEMENTATION.md) | 学习台内联互动实现说明 |
| [`LEARNING-INTERACTIVE-CHATGPT-LEVEL.md`](LEARNING-INTERACTIVE-CHATGPT-LEVEL.md) | 学习模式互动体验设计 |
| [`LEARNING-INTERACTIONS-ROUND2.md`](LEARNING-INTERACTIONS-ROUND2.md) | 学习互动二期设计 |
| [`LEARNING-PRACTICE-ROUND3.md`](LEARNING-PRACTICE-ROUND3.md) | 学习练习三期设计 |
| [`LEARNING-MODEL-IMPROVEMENTS.md`](LEARNING-MODEL-IMPROVEMENTS.md) | 学习模式模型适配说明 |
| [`LEARNING-INLINE-UPGRADE-ACCEPTANCE.md`](LEARNING-INLINE-UPGRADE-ACCEPTANCE.md) | 学习内联升级验收记录 |
| [`BROWSER-POINTER-AND-COMPACTION-ACCEPTANCE.md`](BROWSER-POINTER-AND-COMPACTION-ACCEPTANCE.md) | 内置浏览器指针与压缩验收说明 |
| [`BROWSER-SITE-MEMORY-AND-COMPACTION-KNOT.md`](BROWSER-SITE-MEMORY-AND-COMPACTION-KNOT.md) | 浏览器站点记忆与压缩边界说明 |
| [`AUDIT-1112-HANDOFF.md`](AUDIT-1112-HANDOFF.md) | 11-12 审计交接参考 |
| [`注入系统与破甲技术全解.md`](注入系统与破甲技术全解.md) / [`破甲方案与方法.md`](破甲方案与方法.md) | Control UI 注入机制技术参考 |

## 三、UI 改版基线（`docs/redesign/`，历史基线参考）

- `docs/redesign/CUTOVER.md`、`FEATURE-PARITY.md`、`TAKEOVER.md`、`MANUALS-REPORT.md`、`RENAME-REPORT.md`、`SIDEBAR-REPORT.md`、`installed-feature-baseline.json` 与 `evidence/*.json` 保留作功能对等基线参考。

## 四、已归档修复报告（`docs/archive/`）

以下已完成的专项修复报告已移入 `docs/archive/`（仅留历史追溯，不再作为当前规范）：

- `docs/archive/CHAT-HISTORY-REPAIR.md`
- `docs/archive/CHAT-ROUTING-AND-PREVIEW-REPAIR.md`
- `docs/archive/CHAT-SURFACE-AND-BROWSER-REPAIR.md`
- `docs/archive/MODE-DUAL-HEADER-REPAIR.md`
- `docs/archive/REASONING-CONTRACT-REPAIR.md`
- `docs/archive/redesign/REPAIR-ACCEPTANCE.md`
- `docs/archive/redesign/REPAIR-BROWSER.md`
- `docs/archive/redesign/REPAIR-COMPANION.md`
- `docs/archive/redesign/REPAIR-EFFECTS.md`
- `docs/archive/redesign/REPAIR-FUSION.md`
- `docs/archive/redesign/REPAIR-LAYOUT.md`
- `docs/archive/redesign/REPAIR-MODELS.md`
- `docs/archive/redesign/REPAIR-RECOVERY.md`
- `docs/archive/redesign/REPAIR-STARTUP.md`
