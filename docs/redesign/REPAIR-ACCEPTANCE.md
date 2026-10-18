# 并发修复验收记录 · 2026-10-18

**整体未通过，尚未交付。** 代码进入 redesign/cle 不等于功能或观感验收通过。美术保持 Claude 原作，原版18789与安装包没有修改。

## 当前已整合

| 范围 | 主分支提交 | 验证与结论 |
|---|---|---|
| 原生浏览器、每 pane 入口、隔离宿主 | 974a898、cd87558 | 针对性21项测试通过；干净环境的构建隔离检查通过。CUA实际加载网页、停靠/铺满、关闭再开保留页面通过；完整参数/交互仍待后续实机复核 |
| 猫动作、菜单、多 pane 与安全区 | 7a93ef6、45c8f80、e1e3262 | 11项行为测试通过；CUA两侧各一个rig/菜单，菜单b1/b2均可独立打开；单栏正文padding-bottom实测106px、猫168×90。全状态/模式仍未验全，未改图片 |
| 运行特效与生命周期 | 00f1a34 | 19项测试通过，但主控审查发现chat事件接线、幽灵run、双侧收尾/旧错误残留问题，已发回返修，不通过 |
| 恢复/内部消息展示 | 6a716f2 | 17项测试通过，但纯文本引用误藏、真实故障被隐藏、失败重试退避有缺口，已发回。**未接入main.js挂载**，测试页面仍露出原内部消息，不能声称已修好 |
| 模型菜单与眼睛/档位 | b252b3b | 60项相关测试通过；CUA实测368×440菜单，无旧灰块，Gemini/DeepSeek图标正确，搜索DeepSeek V4.1仅留精确WB路由。未修改用户会话模型。思考滑杆仍粗亮蓝胶囊、刻度偏小，观感不通过，已准备返修要求 |
| 启动首帧/图标/推广 | f33f5fb | 19项测试通过；仅将补丁写到明确19789 staging runtime且另存完整备份。HTTP与CUA均证实运行网关仍从内存缓存返回旧index，无startup style，**首帧未验收通过**。补丁的路径、twins/manifest还原、11s恢复旧品牌问题已发回 |

## 仍在实施 / 不可直接合并

- layout：已有未提交代码。真实双栏时学习工具和学习顶栏仍在两侧搬动；已扩展其所有权到学习挂载与响应式适配。正文370px/16px/30.4px的旧基线仍未被新交付替换。
- fusion：功能面板/演示/桥接样式正在实施，尚无可合并提交。
- oc/restyle：已完成但主控发现大量 `0 3px 14px var(--cle-shadow)` 等把完整阴影token放入颜色槽的无效CSS，另有夜间深紫字。没有合并。由fusion后续逐项审查，不能盲目整体搬回。

## 本轮实际 UI 证据

独立隐藏 IAB 验收页与独立 native Browser Test.app，均连19789。没有在原版App做GUI操作。native宿主完成检查后已退出。

- `/Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/验收/第一轮-陪伴菜单.png`
- `/Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/验收/第一轮-双栏实际挂载.png`
- `/Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/验收/第二轮-模型菜单.png`
- `/Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/验收/第二轮-思考档位.png`
- `/Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/验收/第二轮-原生悬浮浏览器.png`

## 调度与下一步

原版无限模式会话的部分新返修run由 `agent.wait` 返回 `timeoutPhase=gateway_draining`，ACK started不能算已执行。不要重启原版网关或反复重发。等其收尾恢复后，只续接缺失增量。

工作清单与待发审查在 `/Users/Admin/Documents/Codex/2026-10-18/new-chat/work/REPAIR-HANDOFF.md`、`pending-reviews.json`。继续10分钟回访。逐项修订、主控实机复验、保存证据后，才能结束验收。
