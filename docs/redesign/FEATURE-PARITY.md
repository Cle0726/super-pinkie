# 现有功能保留与迁移验收

2026-10-18 用户补充：原 App 很多功能已经很好，粒子状态动效和浏览器直接复用；不能为了改版舍弃成熟功能。

基线来自实际安装的 App，而不是只看改版任务书。原始脚本、加载顺序和 SHA-256 见 `installed-feature-baseline.json`。原有 `ui/injections/` 与 macOS 原生浏览器实现仍完整保留；新版在独立测试 profile 接续，不覆盖正式 App。

“已接入”只代表入口/代码在测试版；必须有对应行为验收才能记“通过”。没有验收的项保留待办，不能从清单删除。

| 功能 | 保留的实现/接口 | 新版接续状态 |
|---|---|---|
| 五模式与会话/模型/档位独立 | mode-architecture、原生 agent/session API | 模式选择适配已接入；隔离回归待全量验收 |
| 会话分组、项目目录、置顶、搜索、归档恢复 | sidebar/session-list、原生会话接口 | 原实现保留；新版入口逐项核对 |
| C.le. 粒子思绪流、阅读、羽毛笔、落款 | cle-space + cle-signature + 原 Three.js/GSAP | 已复用原渲染器，替换眼睛状态；真实运行验收中 |
| 实时思考/叙述/工具过程、折叠和历史展开 | 原时间线补丁、process-card、tool-stream、cle-stage | 原实现保留；对齐新版原生过程视图，避免重复渲染 |
| 开屏、模式切换、昼夜 | 原开屏/模式切换能力 + C.le. 品牌绘画 | 能力保留，品牌素材替换；视觉验收待完成 |
| 输入框伙伴及解释/总结/提问改写/专注/独立模型设置 | companion + pinkie.companion.* | 原交互与后台保留；迁回新版输入框 |
| 内置浏览器、独立登录状态、多模式共用、导航与拖拽 | 原 Launcher/BrowserControl + link-viewer | 原生层保留，网页入口已迁入测试版 |
| agent 控制 App 浏览器、网页预览、文件展示 | app-browser + material-preview | 后台保留，前端桥已接入；原生环境联调待验收 |
| 图表、流程图、公式、可排序表格 | rich + Chart.js/Mermaid/KaTeX | 原后台保留，聊天迁移任务的改动待整合 |
| 小应用、交互组件、追问、计划卡 | rich-runtime + rich/plan/ask-user | 完整保留；前端迁移/新版挂载待验收 |
| 学习题卡、作答判分与笔记 | learning-stage + learning.* | 已接入，真实 Gemini 3.8 出题通过，作答链路验收中 |
| 学习笔记整理、复习、考纲题库、错题雷达 | learning-stage + 原后台 | 入口已接入，逐项行为验收待完成 |
| PDF/EPUB/网页资料库与伴读 | learning-library + 本地 PDF/EPUB vendors | 原实现与授权文件已迁入；阅读验收待完成 |
| 学习约定、真实进度、专注、提醒 | 新 learning-pact + study UI | 后台已整合，38 项相关检查通过；界面联调中 |
| VS Code 式工作台、文件/Git/搜索/回收与撤销 | 原 workbench + pinkie.fs.* | 已迁入；项目/无限保持入口，学习可主动打开 |
| 补全、诊断、多语言运行、终端、AI 辅助、扩展 | workbench-code + 原 LSP/terminal 后台 | 原实现和资源保留；新版实际编辑/运行待验收 |
| ipynb 编辑、内核与单元执行 | workbench-notebook + 原内核服务 | 已迁入，执行验收待完成 |
| 深度思考四档、多角色协作、续跑 | deep-think + mode-architecture | 原实现保留；新版入口迁回中 |
| 深度研究、连接器、定时任务与推送目标 | capabilities + rich-runtime/cron | 后台保留；旧设置卡片与开关迁回中 |
| ChatGPT 协作与内置浏览器联动 | web-gpt-collab + web-gpt-* 后台 | 原实现保留；新版入口迁回中 |
| 当前模式独立长期记忆 | memory UI + memory.* | 原实现保留；新版入口迁回中 |
| 手动压缩/容量、断线恢复、停止与同会话续跑 | context-compact/resume + 对应补丁 | 原实现保留；新版 API 和恢复行为待验收 |
| 忙碌时排队/追加/重试、草稿 | queue-steer + 原生 composer | 保留；核对新版原生能力，不能重复发送 |
| 语音输入与按需朗读 | live-voice + 原生语音桥 | 原生层/前端保留，入口迁回中 |
| 用量统计、脱敏、选择文本操作、图片查看 | usage/desensitize/selection-actions/image-viewer | 原实现保留，入口迁回中 |
| 派对空间、圆桌、激光指示等独立能力 | party/roundtable/laser-pointer | 保留其功能与服务，品牌入口适配待验收 |

## 验收边界

- 品牌变化不能成为删除功能、隐藏入口或降低能力的理由。
- 有新版原生替代时要验证原来的使用场景，不能只因为“新版应该支持”就标完成。
- WebKit 截图与真实模型调用分别记录；静态检查不代替真实出题/执行/生成。
- 不改无限模式规则文件或用户自写权限段，不新增该模式的确认步骤。
- 正式 App 保持现有功能可用，待新版逐项验收后再做安装交付。
