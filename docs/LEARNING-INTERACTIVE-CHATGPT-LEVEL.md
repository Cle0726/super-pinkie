# 碧琪学习模式：ChatGPT 级消息内交互（专升本）

参照：OpenAI 2026-03-10《在 ChatGPT 中学习数学和科学的新方式》。ChatGPT 的做法是：用户问一个核心知识点，
回复里除了讲解，还直接嵌一个可操作的模块——公式、可拖的变量、实时更新的图和结果；不用开关，不是每条都放。
OpenAI 首批 70 多个概念里与专升本直接相关的有：欧姆定律、库仑定律、指数衰减、线性方程、斜截式、三角函数、
周期与频率。碧琪按广西专升本（电子与信息大类）考纲把同样的形态铺到电工电子、高数、计网、C、英语。

## 触发

- T1 互动默认开启。新会话里碧琪不用等按钮或用户开口，讲到能“动手看变化”的考点时自己调用 learning_activity present。
- T2 一条回复最多一个组件；闲聊、问事实、一句话定义不放。
- T3 用户点「互动学习」关闭后，碧琪不再主动放题卡和演示；单题、小测被服务器拒绝；用户明确要的演示和整卷仍可出。
- T4 关闭状态按会话保存；旧版本（v1）里“默认关”的会话按开启读，但不复活旧题卡。

## 组件形态（每个实验类组件都要满足）

- F1 公式条：显示公式，并把当前数值代进去（例如 `I = U / R = 12 V / 3 kΩ = 4 mA`）。
- F2 实时图：SVG 原理图、波形或坐标图，不用 ASCII；拖动滑杆时 1 帧内重绘，不需要点“运行/核对”。
- F3 读数：关键结果以带单位的读数块显示，自动换算 m/k/μ 前缀，有效数字 3–4 位。
- F4 控件：连续量用滑杆（标签 + 当前值 + 单位），离散量用分段按钮；键盘可操作，有 aria-label。
- F5 讲解提示：一行“注意看”，随状态变化（例如进入饱和区、谐振、超前/滞后）。
- F6 问碧琪：一键把当前参数交给碧琪解释；操作不算掌握。
- F7 状态保存：参数改动 220ms 内去抖保存，重开会话恢复；服务器校验范围，越界拒绝。
- F8 外观：白天/夜间两套配色；360px 宽无横向溢出；字体与聊天一致；数值等宽。
- F9 安全：定义只是数据，不执行模型写的脚本或 HTML。

## 专升本覆盖（考点 → 组件）

| 考点 | 组件 |
|---|---|
| ee1/ee2 欧姆定律、串联分压、并联分流 | concept_lab: ohm / series_divider / parallel_divider |
| ee3 正弦量三要素、相位差、有效值 | concept_lab: sine_ac |
| ee3 RLC 串联、阻抗、谐振 | concept_lab: rlc_series |
| ee4 RC / RL 暂态、时间常数 | concept_lab: rc_transient / rl_transient |
| ee5 整流滤波 | concept_lab: rectifier |
| ee6 共射放大、静态工作点、三个区 | concept_lab: bjt_bias |
| ee7 反相/同相比例运放 | concept_lab: opamp |
| ee8/ee9 逻辑函数、真值表、卡诺图化简 | logic_lab |
| ee10 触发器、计数器时序 | timing_lab |
| m1 重要极限 | concept_lab: limit |
| m2/m3 导数、切线、单调与极值 | concept_lab: derivative |
| m4 定积分（黎曼和） | concept_lab: integral |
| m5 一阶微分方程 | concept_lab: ode |
| net4 子网划分（二进制位） | concept_lab: subnet |
| net5 三次握手、四次挥手；net6 DNS | sequence_lab |
| C 程序阅读 | c_program（真实编译 + 逐步变量） |
| 英语长难句/阅读/写作 | sentence_parse / english_reading / english_writing |
| 知识点确认 | 题卡（bank, count=1） |

## 验收方式

- 单元测试：`node --test tests/learning*.test.*` 全过；新组件的定义校验、状态保存、越界拒绝各有测试。
- 画廊：`node tools/learning-interactive/gallery.mjs` 在真实聊天界面里渲染所有组件，白天、夜间、360px 三套截图，
  无页面错误、无横向溢出；交互脚本拖滑杆后读数变化正确（与手算值比对）。
- 真实模型：Gemini 3.8 在真实 App 里问 6 个专升本问题（串联分压、RC 时间常数、子网 /27、三次握手、导数切线、
  逻辑函数化简），至少 5 个回复自己放了对应组件且没在正文重复组件内容；问一个纯事实问题不放组件。

## 验收记录（2026-10-25）

- 单元测试：学习相关 151 项全过（含新增 `tests/learning-explore.test.mjs`）。全量 1452 项里 11 项失败，都是之前就有的
  browser/native/party/sidebar/self-contained/workbench 版本问题，与学习模式无关。
- 画廊：30 种卡片 × 白天/夜间/360px 全部渲染，无页面错误、无横向溢出；交互脚本核对串联分压（R₂ 拖到 1 kΩ → U₂ = 6 V）、
  RC（t = 3τ → u_C = 9.5 V）、子网（/26 → 255.255.255.192、可用 62）、三极管饱和、运放饱和 −12 V、逻辑开关与卡诺图、
  JK 触发器翻格、TCP 第 2 步 ack=101、题卡作答标绿。
- 真实模型（Gemini 3.8 Flash，Extra high，新会话，未点任何按钮）：

| 问题 | 碧琪自己放的组件 | 初值 |
|---|---|---|
| 串联 10V、2kΩ、3kΩ 求 U₂ | concept_lab series_divider | U=10, R1=2000, R2=3000 |
| RC 10kΩ、100μF 时间常数 | concept_lab rc_transient | R=10, C=100 |
| 192.168.10.34/27 | concept_lab subnet | ip, prefix=27 |
| TCP 三次握手 seq/ack | sequence_lab tcp_handshake | — |
| x³−3x 在 1.5 处切线 | concept_lab derivative | fn=x3, x0=1.5 |
| 卡诺图化简 AB+A'C+BC | logic_lab | 原式 |
| 桥式整流电容滤波 U2=20V | concept_lab rectifier | bridge, cap, U2=20 |
| 电阻的单位（一句话） | 不放组件 ✓ | — |

  前两轮里有两条回复把卡诺图、报文表又用 Markdown 表格画了一遍；已在提示词里禁止，之后的整流题没有再出现。
