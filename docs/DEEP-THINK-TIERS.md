# 两套自定义档位怎么执行（2026-11-02 按活儿种类改版）

两套档位是一个整体：

- **思考等级（输入框滑块九档）= 想多深。** 每一档先按当前模型原生支持的等级就近发送；原生够不到时由碧琪补：往上补是拆题 / 独立起草 / 打开成品审稿，往下补是让回答更快（动手的活仍做必要的一次验证）。代码在 `services/mode-architecture/reasoning.mjs`。
- **思考强度（✦ 按钮四档）= 做事多严、证据多硬、能跑多久。** 先认清是哪种活，照这种活的打法做，再按档位要证据、多做几版或写计划做到完。代码在 `services/mode-architecture/index.mjs`，活儿种类和证据规则在 `services/mode-architecture/work-kinds.mjs`（纯函数，两套共用）。

## 四档思考强度

| 档位 | 卡片 | 实际流程 | 自动续跑上限 |
|---|---|---|---:|
| 基础档 | 按活儿种类走对的做法 | 分类 → 运行单让碧琪读对应打法、照打法自己的验收做；有标准答案和取舍题派 2–3 个求解；不加硬门禁 | 3 次 |
| 加强档 | 说做完，就要有真凭据 | 基础档 + `evidenceGaps` 按种类核对本轮工具记录（缺什么就推一句具体缺口）+ 整轮结束后一次带只读工具的交付验收，打回最多 1 轮 | 6 次 |
| 全开档 | 多做几版，挑出最好的 | 加强档 + `kindRoles` 按种类派「独立起草 / 看图审稿 / 独立复算 / 用户视角试用」+ 更严的证据（手机宽度截图、文档每页转图、修前失败输出）+ 审稿批评，打回最多 2 轮 | 10 次 |
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
- **Adaptive**：动手的活、报错、写代码按 XHigh 路线；一句话聊天按 Low；其余按原来的难度分（保留「恰好 N 个字」按难题）。
- **补强提示**（`briefContext`）：答题类「拆要求、找易错、想验证」；动手的活「先列验收清单，做完逐条用工具核对」；往下补（更快）也要做最必要的一次验证。
- **Max / Ultra**：独立份数 2 / 3、打回 2 / 3 轮不变，内容按上面变用途。
- **和四档合并**：同一会话 10 分钟内先后登记的档位（`armTier`）和九档（`prepare`）合并成一个验收：独立份数、打回轮数取大，批评任一要就要，仍在整个档位任务结束后只审一次。
- **打回只发更正**（`fixMessage`）：用户已经看到上一条了，一句话说改了什么 + 改正后的那部分；下一轮审稿把「之前已交的回复 + 这次更正」一起审。

## 门禁、续跑、停机（`index.mjs`）

- 缺口按种类报具体的中文（「交出去的文件本身还没打开或转成图片核对过」），续跑提示也用这句，要求只补做缺的那一步。
- 被拦下的终稿不进记录：续跑提示附上上一版回复原文，要求这一版完整替代它、不改的内容沿用原文、不写两遍。
- 做了 ≥5 次工具调用、终稿不到 10 个字：推一次要完整终稿；第二次还是几个字就如实停下（第二次是明确的「做好了」就照常交付）。
- 被系统停下时，停止报告附上一版回复；如实报告未完成时用碧琪自己的话。
- 文案、起名、点子类只交文字，不按「执行型修改任务」要文件变化。
- 工作模式里只在「这一轮没有任何新证据、又没说换了什么」时因为没说「这次和上次不同」而停；长跑档接着做下一个里程碑不算重试。

## 改动文件

- `services/mode-architecture/work-kinds.mjs`（新）、`index.mjs`（接入点见 `briefs/custom-tiers-upgrade/INDEX-PORT.md`）、`reasoning.mjs`。
- 安装清单：`services/mode-architecture/setup.py`、`installer/macos/apply-theme.sh`、`desktop/macos/build.sh`、`desktop/windows/mac-runtime/services/mode-architecture/setup.py`（+ `SHA256SUMS`）都要带上 `work-kinds.mjs`，否则插件加载失败；`tests/mode-architecture.test.mjs` 有打包清单测试。
- 界面：`ui/injections/laolao-deep-think.js`（卡片文案、进度面板「活儿种类」一行）、`laolao-model-picker.js`（补强说明），缓存键 `deepthink29` / `modelpicker50`。
- 文档：`skills/deep-think/SKILL.md`、本文件、四个模式 `AGENTS.md` 档位段、`playbooks/crafts.md`「选了思考强度档位时」、`playbooks/environment.md`「推送来的工具和技能在这台电脑用不了时」。
- 测试：`tests/work-kinds.test.mjs`（新）、`mode-architecture`、`reasoning-enhance`、`deep-think-ui`、`model-picker-route`。

## 回滚

`work-kinds.mjs` 是新文件，删掉并恢复 `index.mjs` / `reasoning.mjs` 的接入点即可；`index.mjs` 被多个并行任务共用，不能整文件回退，按 `INDEX-PORT.md` 逐处撤销。安装清单里的 `work-kinds.mjs` 要和代码一起撤。
