# 两套自定义档位怎么执行（2026-11-02 按活儿种类改版；2026-11-09 升级逻辑重写）

两套档位是一个整体：

- **思考等级（输入框滑块九档）= 想多深。** 每一档先按当前模型原生支持的等级就近发送；原生够不到时由碧琪补：往上补是拆题 / 独立起草 / 打开成品审稿，往下补是让回答更快（动手的活仍做必要的一次验证）。代码在 `services/mode-architecture/reasoning.mjs`。
- **思考强度（✦ 按钮四档）= 做事多严、证据多硬、能跑多久。** 先认清是哪种活，照这种活的打法做，再按档位要证据、多做几版或写计划做到完。代码在 `services/mode-architecture/index.mjs`，活儿种类和证据规则在 `services/mode-architecture/work-kinds.mjs`（纯函数，两套共用）。

两套档位每一级到底多做什么，只写在一个文件里：`services/mode-architecture/run-contract.mjs` 的 `DEPTH_LADDER`（九档）和 `RIGOR_LADDER`（四档）。`reasoning.mjs`、`index.mjs`、`work-kinds.mjs` 都从那里取数，不各留一份。

## 升级逻辑的五条规矩（2026-11-09）

照「一个认真的人会怎么加码」定的。每条在 `tests/tier-ladder.test.mjs` 里至少有一条测试。

1. **力气跟着活走，档位只定上限。**「谢谢」「晚安」这类寒暄在任何档位都不拆题、不派独立做法、不验收（`messageWeight` → `social`）。只说「继续」「好的」「可以」时（`carry`），要核对的是它接着做的那件事：往回找最近一条真的在提要求的消息，按那件事认种类、写独立做法、做验收；找不到就不派独立做法，只留交付核对。
2. **往上一级是多一种做法，不是同一种做法多来几遍。** 先弄懂（Medium）→ 交之前自己逐条核一遍（High）→ 一份没看过答案的独立做法 + 审稿员打开成品（XHigh）→ 第二份、第三份换做法的对照（Max、Ultra）。梯子是累加的：Max / Ultra 在原生够不到时也带上下面几级。打回不是越多越好：打回后的复核先追上一轮指出的问题，新问题只报三种（结果错了、漏了硬要求、把没做的说成做了）。
3. **两套档位是一个决定。** 验收只在整件事做完后做一次，打回轮数取大。独立做法取大、同一份不做两遍：全开档这种活自己派出去的几版（`independentViews`：求解、独立起草、独立复算）先算数——它们交付前就能用上；九档只在后台补还差的份数，做法从没用过的那种开始；模型没派出来的，验收时补做。选了更快的思考等级又选了带验收的档位时，`brevity` 变成 `concise`：话写短，核对一步不省。
4. **证据是实的，仪式是虚的。** 缺证据（没打开看过、没跑过、没重算）会一直推到补上、如实说明或用完续跑上限。缺仪式（没派子任务、终稿少一句「对比 / 交给你选 / 出处」）最多提醒一次（`RIGOR_LADDER` 的 `rolePushes`、`finalPushes`），之后放行，进度面板上那一行标成已放行。基础档不设门禁。以前仪式和证据一样一直推到续跑上限，没有派子任务工具的模型每次都被推到停机，用户看到的就是「选了档位反而不干活」。
5. **推不动了就把成品交出去，照实说哪几步还没亲眼核对。** 续跑上限、连续两次没有新证据、没说明换了什么做法这三种停机，只要上一版回复够长（不少于 40 个字），就把它完整交给用户，后面附一句「有几步碧琪还没能亲眼核对：……」；不再报「本轮未完成」、把成品当参考附在后面。长跑档还有没勾的里程碑、终稿两次只有几个字、如实报告卡住、偏离任务，仍按原来的方式报告。

无限制模式不走这五条，保持原来的语义。

## 四档思考强度

| 档位 | 卡片 | 实际流程 | 自动续跑上限 |
|---|---|---|---:|
| 基础档 | 按活儿种类走对的做法 | 分类 → 运行单让碧琪读对应打法、照打法自己的验收做；有标准答案和取舍题自己换一种做法对一遍，想派求解可以派；**不设门禁**（不推、不拦，查事实的两个来源也只写在运行单里） | 3 次 |
| 加强档 | 说做完，就要有真凭据 | 基础档 + `evidenceGaps` 按种类核对本轮工具记录（缺什么就推一句具体缺口）+ 查事实要两个来源、有标准答案的题要一次验算 + 整轮结束后一次带只读工具的交付验收，打回最多 1 轮；终稿少一句套话只提醒一次 | 6 次 |
| 全开档 | 多做几版，挑出最好的 | 加强档 + 必须多做几版：`kindRoles` 按种类派「独立起草 / 看图审稿 / 独立复算 / 用户视角试用」，有标准答案和取舍题派 2–3 个求解（没派提醒一次，之后放行）+ 更严的证据（手机宽度截图、文档每页转图、修前失败输出）+ 审稿批评，打回最多 2 轮 | 10 次 |
| 长跑档 | 写好计划，一直做到完 | 全开档的证据标准，不强派子任务；检查点里程碑「- [ ] 里程碑 — 验证：…」由引擎核对，全部勾完后一轮全开档式终审（审稿员打开成品） | 40 次 |

## 活儿种类（`WORK_KINDS`）

18 种 + 没见过的活兜底（`craft`，照 `crafts.md` 五步），和 `personas/*/playbooks/` 的打法一一对应：写代码、网页、App/游戏/接 AI、自动化、视频、文档、数据图表、海报印刷、文案、点子、排错、电脑环境、发布、有标准答案的题、取舍、查事实、讲题辅导、简单问答。

- **分类**（`classifyWorkKind`）：附件扩展名 + 每种活一组中英文说法（带权重）+ 当前模式（学习模式默认讲题，明确要做东西才按那种活）。粘贴来翻译/润色的原文只按那句指令分；否定句（「不要做成网页」）里的词不算；只说「继续」时沿用上一条真实请求；问档位本身按简单问答。一条请求多种活：主活 + 附带活，证据取并集。
- **过程中改判**（`refineKinds`）：做出 .pptx → 文档，出了 .mp4 → 视频，注册了定时 → 自动化；只往更具体的方向改，进度面板跟着更新。
- 旧运行状态没有 `workKinds` 时按旧五类（`taskType`）换算；无限制模式只用旧五类和旧运行单（`legacyDeliberationPlan`），不读打法、不加新门禁。

## 证据怎么认（`evidenceSignals`）

只认工具记录，不认回复里的自述；拿不准的宁可不认。记录存的是模型看到的正文（`toolResultText`：content 里的文字，不要 `{content, details}` 外壳——外壳里的 exitCode、durationMs 会被当成「算出来的数字」），输出过长时头尾都留（`clipToolOutput`）。

| 信号 | 从哪认 |
|---|---|
| `mutation` / `produced:<类>` | write / edit；保存调用、`-o`、重定向、ffmpeg/magick 的输出参数、输出里的「已保存到 …」（读回检查不算又做了一次） |
| `test` / `run` / `failed_*` | 测试命令、真运行（含 `…/agent-env/bin/python3 x.py`）；后台命令等 `process poll` 回来的退出码再认（`linkBackgroundRuns`） |
| `screenshot` / `mobile_screenshot` / `image_viewed` | look-page、截图脚本（输出「截图：x.png」）、浏览器截图；之后用 read / image 打开图片才算看过 |
| `opened_deliverable:<扩展名>` / `doc_render` | look-doc、python-pptx/docx 读回、pdf 工具、soffice / PowerPoint COM / Keynote 导出、pdf2image |
| `render_probe` / `frames_extracted` | ffprobe、look-video、ffmpeg 抽帧拼图 |
| `recomputed` | python/node/sqlite 等真算出数字 |
| `schedule_registered` | launchctl load、crontab 写入、schtasks /create、Register-ScheduledTask、cron 工具；只查看的要有内容才算 |
| `public_url_ok` / `deploy` | 公网地址被 web_fetch / curl / 浏览器打开（本机地址不算）；vercel、gh-pages、rsync 等 |
| `machine_probe` / `print_probe` | machine-check、版本和配置命令；sips -g、identify、pdfinfo 看尺寸分辨率 |

多数要求「在最后一次产物改动之后」：改完页面再截图才算，改完 PPT 再打开才算。

## 九档补强（`reasoning.mjs`）

- **独立 pass 按种类变用途**（`solverPrompt` + `solverModeFor`）：答题类独立解答（三种角度）；动手的活写验收清单 + 最可能翻车的地方 + 怎么核对；文案点子独立写一版作对照。独立 pass 不带工具。
- **审稿员能看成品**：批评 / 交付验收 pass 带 `toolsAllow: ['read','image','pdf','web_fetch','web_search']`（不给 exec、write、edit、browser），工作目录用会话真正的项目目录，提示里列出本轮做出来的文件和截图路径（`artifactPaths`），要求打开交付物本身核对；超时 300 秒记「未核对」，不挡交付。
- **Adaptive 分三段**（`adaptiveBand`）：动手的活、报错、写代码、有标准答案的难题按 XHigh 路线；一句话聊天按 Low；文案、点子、取舍、查事实、讲题至少按 Medium；种类和消息本身的难度分取高的（保留「恰好 N 个字」按难题）。
- **补强提示**（`briefContext`）：答题类「拆要求、找易错、想验证」，High 起再加「写完先别交，逐条核一遍」；动手的活「先列验收清单，做完逐条用工具核对」；往下补（更快）也要做最必要的一次验证；和带验收的做事档位同时选时只把话写短。
- **Max / Ultra**：独立份数 2 / 3、打回 2 / 3 轮不变，内容按上面变用途；原生够不到这一档时也带「先弄懂、交前自查」。
- **和四档合并**：按请求分开登记（`ReviewStore` 每个请求一份），不再用时间窗口猜；合并规则只在 `mergeLayers`：独立份数、打回轮数取大，批评任一要就要，仍在整个档位任务结束后只审一次。消息和种类都知道之后由 `settleRecipe` 定下谁做哪几份独立做法（`tierViews` 是做事档位自己派的，`engineSolvers` 是九档补的）。
- **复核收敛**（`auditPrompt` 的 `previous`）：打回后的复核把上一轮的问题列给审稿员，先核对改了没有，新问题只报会让结果出错的三种。
- **打回只发更正**（`fixMessage`）：用户已经看到上一条了，一句话说改了什么 + 改正后的那部分；下一轮审稿把「之前已交的回复 + 这次更正」一起审。

## 门禁、续跑、停机（`index.mjs`）

- 缺口按种类报具体的中文（「交出去的文件本身还没打开或转成图片核对过」），续跑提示也用这句，要求只补做缺的那一步。
- 被拦下的终稿不进记录：续跑提示附上上一版回复原文，要求这一版完整替代它、不改的内容沿用原文、不写两遍。
- 做了 ≥5 次工具调用、终稿不到 10 个字：推一次要完整终稿；第二次还是几个字就如实停下（第二次是明确的「做好了」就照常交付）。
- 被系统停下时：成品已经有了、差的只是核对，就把上一版回复完整交出去并附一句还没核对什么（规矩 5）；长跑档里程碑没做完等情况仍报「本轮未完成」并附上一版回复。如实报告未完成时用碧琪自己的话。
- 文案、起名、点子类只交文字，不按「执行型修改任务」要文件变化。
- 工作模式里只在「这一轮没有任何新证据、又没说换了什么」时因为没说「这次和上次不同」而停；长跑档接着做下一个里程碑不算重试。

## 改动文件

- `services/mode-architecture/run-contract.mjs`（两套档位的梯子、合并、合同、推不动时的说明）、`work-kinds.mjs`、`index.mjs`（接入点见 `briefs/custom-tiers-upgrade/INDEX-PORT.md`）、`reasoning.mjs`。
- 安装清单：`services/mode-architecture/setup.py`、`installer/macos/apply-theme.sh`、`desktop/macos/build.sh`、`desktop/windows/mac-runtime/services/mode-architecture/setup.py`（+ `SHA256SUMS`）都要带上 `work-kinds.mjs`，否则插件加载失败；`tests/mode-architecture.test.mjs` 有打包清单测试。
- 界面：`ui/injections/laolao-deep-think.js`（卡片文案、进度面板「活儿种类」一行）、`laolao-model-picker.js`（补强说明），缓存键 `deepthink29` / `modelpicker51`。
- 文档：`skills/deep-think/SKILL.md`、本文件、四个模式 `AGENTS.md` 档位段、`playbooks/crafts.md`「选了思考强度档位时」、`playbooks/environment.md`「推送来的工具和技能在这台电脑用不了时」。
- 测试：`tests/tier-ladder.test.mjs`（五条规矩）、`run-contract`、`tier-interplay`、`work-kinds`、`mode-architecture`、`reasoning-enhance`、`deep-think-ui`、`model-picker-route`。
- 真实模型实测清单：`briefs/biqi-method-1109/TIER-LADDER-REAL-MODEL-TESTS.md`（单测只证明逻辑，不证明真实模型照做）。

## 回滚

`work-kinds.mjs` 是新文件，删掉并恢复 `index.mjs` / `reasoning.mjs` 的接入点即可；`index.mjs` 被多个并行任务共用，不能整文件回退，按 `INDEX-PORT.md` 逐处撤销。安装清单里的 `work-kinds.mjs` 要和代码一起撤。
