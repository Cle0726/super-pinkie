# 并发修复验收记录 · 2026-10-18 · 第五轮

## 第六轮 · 主控交接给 Claude（2026-10-18 18:10 起；本段优先于下文）

Codex 额度用完，主控改由 Claude 担任；八路修复会话、分工与边界不变（仍在原版无限模式、DeepSeek V4.1 WB）。

| 项 | 结果 |
|---|---|
| 合入 | layout 71cd496 → 54555ad；browser 273e834 → (cherry-pick)；均先审查 |
| 审出并修 | layout 的「退役外壳兜底」选择器没限定退役态，插件在线时 `.agent-chat__input` 本就在 `.agent-chat__composer-shell` 里，`!important` 规则会压到在线输入框 → 限定 `:not([data-cle-active])`（c20ff52） |
| 审出并修 | browser 把描述符清理写进 applicationWillTerminate，挤出 self-contained-app 断言窗口；行为没错，抽成 helper（347c6ac），Swift typecheck 通过 |
| 自己的回归 | 线描陪伴在无 DOM 的测试里用了 MutationObserver，companion 10 项失败 → 已修，11/11（347c6ac） |
| **新 P1（已修）** | 断线时整页卡死：侧栏会话列表首屏请求失败不留缓存，finally 立刻重渲染又请求 → 微任务死循环，主线程 100%+，重连后也不恢复（Chrome 与 WebKit 均复现，CDP 暂停定位到 fetchMode↔renderNow）。修：失败记为空缓存、每模式单飞、8 秒后重试、每次断线只提示一次（63a9d6b） |
| 实测（真实停/启 19789） | 断线中页面可响应；重连后 data-cle-active=1、学习条 1、输入框 1、会话列表自动回填 3 行、无 activation 英文、无 OpenClaw |
| 全量测试 | 1168 项，失败回到已知基线 11 项（另 1 项 utilities 在全量负载下偶发超时，单跑 3/3 通过） |
| 已发返修 | fusion：工作台把 gaze 蓝当图标色铺满（页签实底、5 个操作图标、胶囊、模糊光斑）；侧栏底部用户名被挤成「C.l」（work/review-fusion-claude-1.md） |

仍未验：麦克风参数展开态（需真实键盘 focus-visible，脚本 focus 不触发）；原生浏览器真实模型端到端（需带描述符重启 19789，见 REPAIR-BROWSER.md）。

**整体未通过，原会话继续返修。以下是最新状态，优先于全部历史记录。** 测试限定19789，未修改原版App/18789、权限、无限模式、全局模型或Claude艺术。

| 范围 | 本轮实际通过 | 新发现 / 仍待处理 |
|---|---|---|
| 正文与输入比例 | 1280窗口中pane1022、正文与输入外壳均864px，已从原370px偏列恢复；学习正文16.5px/29.7px，6列表格864、长代码局部滚动、页面不横溢 | 麦克风参数通过键盘展开28px后，actions81→109，压文字17px；已带截图/测量交原layout修，设备选择功能保留 |
| 分栏与入口交接 | 双栏各508，权限32px；菜单首项键盘焦点、已吸收工具不重复；真实开/关分栏后仍1只眼睛、1个功能入口、864px排版 | host实际先新activate后old dispose，旧main会抹新根标记，主控已用document lease修97826cd；不能拿旧失败截图当新通过 |
| 模型与思考 | 0ae26ed已合；右High→Medium时真实参数、cle-level与eyeOpen=.52同步，左High/.68独立；已恢复自己的两QA High。思考强度4档菜单实际打开、未改档 | 真实工具运行中标签短暂变mm/deepseek-v4.1-flash，结束回WB；原models继续修可读名称，不改真实路由 |
| 工作台与融合面板 | 多行实际点发送得到「收到」，工作台入口已在composer controls文档流中、没有盖send/voice；深浅功能面板620×688、记忆空态与思考菜单实看 | 全部legacy入口尚未穷举。常驻legacy拿退役host持续报错，原fusion的桥修订3992a8c又丢modechange/记忆关闭并重复刷新，审查退回未合 |
| 断线与内部消息 | 1703字带代码、1778字无代码内部续跑两group，真实断线始终display:none/aria-hidden=true，正常答案保留；标题保持(已断开连接)…—C.le. | 学习条的已排队rAF在abort后重新挂DOM并暴露activation英文错误，重连会累积；原layout正在修，不冒充完整恢复通过。第4轮离线投递仅一份成功证据仍有效，本轮没重复 |
| 离线表现 | 主控908945e保留document-owned CSS，实断线仅1份留存link，正文/输入外壳864px与配色字号保持；b317524加data-cle-active区分静态皮肤与活跃host | 退役后native composer内排版仍变矩形，侧栏原房间入口移除后空圈；已分别交layout/startup。不能靠保留皮肤假装在线或冻结旧操作 |
| 启动与品牌 | 已合early guard、重复部署integrity/cache更新及preflight修订；明确stage根apply，同源/cle-early.js实际200；刷新首AX标题与断线标题C.le. | 首屏/断线工作区aria仍OpenClaw · 工作区菜单；startup扩展page lifetime chrome guard。一次goto的tab元数据瞬时旧名但同次AX已新名，未据此冒称可见帧闪烁 |
| 真实特效与工具 | 本轮新增一次指定本地fixture的真实read工具，14秒返回CUA_TOOL_STATE_CHECK_20261018，结束live/停止按钮已清除；此前两侧并发及独立停止实际证据保留 | 本次采到think与read工具记录，未采到转瞬read视觉帧；暂停/性能/全阶段还不能声称实机穷举 |
| 陪伴与原生浏览器 | 前轮五模式归属、各pane猫/rig、菜单/设置、native小窗四边四角/半幅AX键盘/fit/dark/本机存储持久证据有效 | 全陪伴动作/素材完整性、纯hover、真实第三方登录、模型协作/真人让行仍未完整实际覆盖；美术继续保留Claude成果 |

本轮整合源：layout5f5cdf2、models0ae26ed、recovery2bd713c/7704a5f、fusion4f2c82c/8accc4c/bd844fc、startup07ce6e9/e100681/3ac6479/c493f5f/76f910d/e4cf6fb；公共入口97826cd/908945e/b317524。3992a8c桥**未合**：主控独立行为复现同key10次publish产生10次刷新、mode通知0、记忆关闭0、pre-aborted仍分配observer/订阅且online=true、跨ESM revision旧facade仍指向旧key。证据workspace outputs/bridge-review-fifth.json。

验证记录：

- layout相关41/41、models75/75（本轮早段）；recovery29+浏览器13，随后补pre-aborted修订并与activation/brand/startup合跑103/103；独立early guard12/12。
- 融合旧并行73项有1项夜间采样波动；bd844fc改为等真实有限动画与3帧稳定，主控相关4套26/26复跑通过。没有降对比度阈值，也不冒称旧73/73。
- 公共activation旧实现3项回归失败，修后3/3；后续skin与activation6/6通过。全量仍有历史11项基线失败，未声称全量绿。

当前stage bundle **50553a5fede7**，日志stage-fifth-checkpoint.log；包含b317524活动标记。CUA实测active=1、retained link1、composer/眼睛/功能入口各1、空草稿、停止按钮0，检查点qa-checkpoint-fifth.json。热更期间仍有一次旧host失效toast，桥修订尚未通过。

当前测试网关在线，live18789监听PID32067全程未变。每次只停官方完整20会话无active且cwd/PID核对通过的19789；测试PID96479→49385→52550→61201。未启动native Test.app或19894 fixture。原8个修复会话模型仍workbuddy/deepseek-v4.1-flash；layout/startup/models/fusion在原会话修新缺陷，不建替代会话，不反复重发原单。ACK见workspace manifest.cuaReviews。

证据根目录：`/Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/`。主要测量qa-activation-fifth.json、qa-typography-fifth.json、qa-expanded-mic-fifth.json、qa-panels-fifth.json、qa-recovery-fifth.json、qa-offline-skin-fifth.json、qa-tool-phase-fifth.json、startup-http-fifth.json；汇总acceptance-measurements-round5.json。实际截图在验收/第五轮-*；其中“第五轮-单栏排版.png”为早先失败证据，通过图是“第五轮-交接修复后单栏.png”。

后续先审查新增量与旧行为保留，补main公共桥接，再部署到19789并CUA复验。不收报告当通过，不生成改图。自动化保持ACTIVE，全部授权修复与实际验收完成后才停止回访。

## 第四轮历史记录（以下不是最新状态）

**整体未通过，继续修复与验收。下表优先于后面的历史记录。** Claude美术、原版18789、安装包、权限和无限模式配置保持原样。

| 范围 | 当前整合 | 主控已验 | 仍未通过或未验 |
|---|---|---|---|
| 正文、输入、双栏 | 82beb2f / ecc36d8 | 回答864px，与输入同轴；508px双栏留16px边距，正文和输入476px；学习16px、项目15.5px随焦点保持独立；31项测试通过 | 单栏权限trigger实际532px占整排，测宽跳过display:contents包装；发送按钮偏中，文字区被压到544px；折叠菜单首开没进入第一项、已吸收工具重复出现，已退回 |
| 模型品牌、思考档位 | b252b3b / 505f45c / 4e41bc9 / 945f7b7 | 本轮70项通过；细轨深浅色、V4.1真实六档、键盘改真实参数与精确WB搜索保留；修复品牌伪元素absolute叠字，16×16、文字偏移22px；单/双栏刷新不点控件也各1只眼睛 | 调档异步提交后native已Medium，眼睛仍High/.68，已发原会话返修；目录90模型无单档样例，速度与其它能力仍未实机验全；用户Main参数未改 |
| 陪伴与安全区 | 7a93ef6 / 45c8f80 / e1e3262 | 五模式归属与单实例挂载已查，双栏各1只猫/rig；单栏168×90；学习/堇思/挥洒菜单、方向键、设置窗口及Escape返回原猫实测；未保存或改参数 | 全动作、真实模型解释/总结及素材齐备度未验全；保留Claude美术 |
| 真实运行特效 | 153dd11 | 23项测试通过；真实双侧并发，右侧19秒完成而左侧继续；随后只停止左侧，右侧结果和完成状态保留；另有18秒完成和27秒续跑反馈；切模式和焦点后无旧run复活 | 全部工具阶段、暂停和性能路径仍未穷举，不能以模拟测试代替实际覆盖 |
| 内部消息与恢复 | aee63f9 / a509864挂载 / 22de722 | 本轮24项+浏览器7检查通过；1489字带代码内部草稿实际隐藏，正常答案保留；真实断线输入1条待重连消息，自动恢复得667，官方历史用户消息和答案各1份，无手动重试 | 断线时activation.abort清标记/样式，内部322字控制消息重新露出，已退回；卸载后pending任务的生命周期也需修 |
| 启动和旧品牌 | c3963a0 / a509864 / 03e4304 / 8698207 | 前轮55项guard/startup及controller8项通过；HTTP title C.le.与startup style到达，多次刷新与双栏完成后标题正确，用户上下文保留 | 一次正常刷新首份AX仍New session — OpenClaw；断线期间整个标题持续旧名，插件内guard不够早；原会话正做CSP允许的同源early guard，未验收 |
| 原生浏览器 | 974a898 / cd87558 / 6f3f743 / 42f0cd5 | 前轮25项及隔离自检通过；本轮新边缘button实际AX点击/space/Return展开收起半幅，向内拖出保留页面；之前拖动、四边四角、右/顶/底收纳、fit/100%、forceDark、关闭再开与本机Cookie/localStorage跨启动证据保留 | 纯hover未证明；真实第三方账号、模型协作和真人让行未验全。Cookie一小时过期后显示无属于测试设置预期，不能当登录失败 |
| 全移植入口融合 | a007f2a | 22项测试通过；浅色功能面板实际打开，Shift+Tab循环、Escape返回入口；原空间和演示入口保留 | 多行输入时工作台覆盖发送/语音，实际点击误开工作台，已退回；更多legacy表现层仍在同一fusion会话修订 |

测试仅19789/profile cle staging。当前bundle为b116011d85ba，插件generation3（测试网关重启后计数）；本轮两次stage成功。此前reload曾有一个旧调用超过5秒退休预算，不能以本轮成功就声称全部生命周期已过。全量套件有已知11项基线失败，未声称全量通过。

真实断线测试前官方sessions.list确认20个stage会话均无active；只停测试PID80076并重启到96479，live18789监听PID32067保持不变。独立原生Test.app已退出，本机fixture19894已停止；19789在线。新增证据在workspace的outputs/actual-queue-recovery-fourth.json、staging-queue-check.json、qa-model-decoration-fourth.json，以及outputs/验收/第四轮-*。

原状态工具存在判读陷阱：过期未知runId也会被agent.wait回成queue/providerStarted=false；这不是仍在排队的证据。核对sessions.list.hasActiveRun与记录后，已仅对原layout空闲会话与原fusion失败会话续接各一次，保留现有代码，未另开修复会话。最新startup、recovery、layout、fusion、models均在原会话继续；跟进和去重ACK在manifest。

仅自己的QA会话发送测试内容：agent:learning:dashboard:codex-ui-acceptance-20261018-1755，以及右栏agent:project:dashboard:codex-ui-right-20261018，均V4.1WB/high。这些是功能验收数据，不是替代修复会话。本机浏览器存储测试不是第三方账号登录测试。

新增CUA截图位于 /Users/Admin/Documents/Codex/2026-10-18/new-chat/outputs/验收/：

- 第三轮-工作台遮挡发送.png、第三轮-真实运行开始.png
- 第三轮-排版二改仍散排.png、第三轮-学习项目独立状态.png
- 第三轮-浅色正文与代码.png、第三轮-浅色功能面板.png
- 第三轮-原生浏览器新字标.png、第三轮-浏览器100比例浅色.png
- 第三轮-浏览器适应比例深色.png、第三轮-浏览器边缘收纳.png
- 第三轮-浏览器状态保留.png、第三轮-浏览器跨启动存储.png
- 第三轮-双侧真实并发开始.png、第三轮-右侧完成左侧继续.png、第三轮-独立停止左侧右侧保留.png
- 第三轮-细轨思考档位浅色.png、第三轮-细轨思考档位深色.png、第三轮-V4.1真实搜索.png

新增审查和ACK在workspace manifest各路cuaReviews。recovery的18:03审查run已核实error/aborted、会话killed且无assistant动作，已在同一会话续接一次并记resumeAfterVerifiedAbort1819，不反复补发。继续原八路修复和10分钟回访；未全部实际验收前，自动化保持ACTIVE。

## 前两轮历史记录（下文不是当前状态）

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
