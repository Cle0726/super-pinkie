# 碧琪工具体检整改方案（2026-11-13，Fable 定方案，其他模型执行）

> 起因：用户让对比 Claude App 和碧琪，看碧琪缺什么。翻了正式环境最近 60 个会话（1287 次模型回复、1256 次工具调用）后，结论是**碧琪不缺工具，是好几个工具一直在失败，而且每轮背的固定负担太重**。
> 用户 11-13 决定：**除「沙箱 / 权限隔离」不做以外，其余全部做。**
> 执行者先读 `PROMPT.md`（规矩和开工步骤），做完按 `ACCEPTANCE.md` 自查。进度写 `PROGRESS.md`。

---

## 一、基线数字（开工前不用重查）

用 `tools/tool-health/session-stats.py` 量的，原始数字存在 `tools/tool-health/baseline-1113.json`。

| 指标 | 现在 |
|---|---|
| `exec` 占全部工具调用 | 58%（727 / 1256） |
| 一次回复调 2 个以上工具的占比 | 14%（150 / 1048） |
| 出错或中断的回复 | 5.3%（出错 36、中断 32） |
| 系统提示词（中位数） | 约 6.2 万字 |
| 工具说明（中位数） | 约 7.6 万字，65 个工具，每轮全发 |
| 平均每次回复吃的 token | 约 16.6 万 |

工具失败率（失败 / 总数）：

| 工具 | 失败率 | 报错原文 |
|---|---|---|
| `web_fetch` | 9 / 9 | `Blocked: resolves to private/internal/special-use IP address` |
| `memory_search` | 6 / 6 | `openclaw-agent.sqlite uses newer schema version 19; this OpenClaw build supports 1` |
| `pinkie_search` | 2 / 3 | `duckduckgo: 被反机器人验证拦下` |
| `image` | 11 / 19 | `Local media path is not under an allowed directory: /tmp/...` |
| `pdf` | 4 / 8 | 同上（微信文件夹）；`Media exceeds 10MB limit (got 25.42MB)` |
| `process` | 18 / 47 | 多数是「还在后台跑，跑完系统会自动叫你」的提醒被标成了出错 |
| `web_search` | 15 / 47 | `DuckDuckGo returned a bot-detection challenge.` |
| `app_browser` | 17 / 161 | `等待请只填写 text、selector、ref、name 或 ms 之一`、`启动服务请二选一…`、`tab 只有 Windows 版…支持` 等 |

这 60 个会话里实际跑的模型：`deepseek-v4.1-flash` 412、`grok-4.7` 285、`hy4free` 285、`gemini-3.8-flash-tiered` 263。换不换主模型是用户的决定，**不在本方案里**。

---

## 二、已查到的根因

### 1. `web_fetch` 全部被拦

- 本机代理是假地址模式。`www.sohu.com` 解析出两个地址：IPv4 `198.18.0.166`，IPv6 `2001:2::a5`。
- 配置里 `tools.web.fetch.ssrfPolicy.allowRfc2544BenchmarkRange: true` 早就有了，它只放行 IPv4 的 `198.18.0.0/15`。
- IPv6 的 `2001:2::/48` 也是基准测试保留段，不在这个开关的放行范围里；另一个开关 `allowIpv6UniqueLocalRange` 管的是 `fc00::/7`，也不沾边。
- **所以最可能的原因是 IPv6 假地址被拦**。这一条我只做了解析和读代码，没在隔离副本里复现，执行者第一步先复现确认。
- 代码位置：打包运行时 `runtime/openclaw/dist/ssrf-*.js`（判断函数里有 `allowRfc2544BenchmarkRange`），调用在 `openclaw-tools-*.js`。

### 2. `memory_search` 全部失败

- 各模式的 `~/.openclaw/agents/<模式>/agent/openclaw-agent.sqlite` 是 9 月初由更新的 OpenClaw 写的（结构版本 19），现在 App 自带的是 `2026.7.1-2`，只认版本 1，一打开就报错。
- 文件大小：project 86 MB、unrestricted 129 MB、main 9.6 MB、thinking 4.8 MB、learning 0.1 MB（learning 是 10-30 新建的，可能正常，要单独查）。
- 另外 `agents.defaults.memorySearch.provider` 是 `none`，就算库能打开，也没有向量检索可用。
- 工具现在仍然发给模型，模型每调一次就白费一轮。

### 3. 搜索被反机器人验证拦

- 内置 `web_search` 的搜索源是 `duckduckgo`，上限 8 条。
- 碧琪自己的 `pinkie_search`（`services/mode-architecture/web-search-fallback.mjs`）免 Key 搜索源只有 DuckDuckGo 一个，同样被拦，然后提示模型改用浏览器搜。

### 4. `image` / `pdf` 读不了文件

- 代码：`runtime/openclaw/dist/local-media-access-*.js` 的 `assertLocalMediaAllowed`，只认默认的几个目录；`/tmp`、微信文件夹、其他模式的 `workspace-*` 都不行。仓库里已有 `patch/apply-image-access.mjs`，先看它现在放开到哪。
- 大小上限 10 MB 在 `web-media-*.js`。扫描版教材 PDF 普遍 25–60 MB，带了 `pages: "1-15"` 也照样整本拒掉。

### 5. `process` 的提醒被当成出错

- `services/mode-architecture/background-jobs.mjs`：模型反复轮询后台任务时，返回一段「别再查了，先干别的」的提醒，但结果带了出错标记。模型看到出错，会以为任务挂了。

### 6. `app_browser` 参数太挑

- `services/mode-architecture/app-browser.mjs`。三种常见写法都被拒：
  - `wait` 同时给 `name` 和 `ms`（模型是想「等这个元素，最多 4 秒」）；
  - `serve` 同时给 `dir` 和 `port`；
  - Mac 上调 `tab`（只有 Windows 支持）。

### 7. 每轮固定负担

- 65 个工具全量发，其中飞书 13 个（`feishu_*`）、QQ 2 个（`qqbot_*`），没接渠道的会话也带着；还有 `nodes`、`gateway`、`agents_list` 这类普通会话用不到的。
- 运行时里的「工具延迟加载」（`deferLoading`）只给 Codex 那条路用，其他模型没有。
- 系统提示词 6.2 万字里各部分占多少还没拆，执行者先拆再动。

### 8. 外部连接器

- 运行时本身支持 MCP（配置键 `mcp.servers.*`，带 `toolFilter`、`supportsParallelToolCalls`），只是 `openclaw.json` 里 `mcp` 是空的，App 里也没有入口。

---

## 三、要做的事

分四组，**按 A → B → C → D 的顺序做，每组做完验完再做下一组**。每一项单独提交。

### A 组　修故障（最先做，收益最大）

**A1　`web_fetch` 在假地址代理下能用**
1. 在隔离副本里复现：同一个网址，先看解析出的地址，再调 `web_fetch`，确认是 IPv6 那个地址被拦。不是的话把真实原因写进 `PROGRESS.md` 再定修法。
2. 修法：新增补丁 `patch/apply-web-fetch-fakeip-v6.mjs`，让 `allowRfc2544BenchmarkRange` 为真时同时放行 IPv6 的 `2001:2::/48`。
3. **不许新增配置键**。2.5.36 那次事故就是往配置里写了运行时不认的键，网关直接起不来（见记忆 `ssrf-policy-update-bug-2536`）。只在已有开关的含义上扩一段地址。
4. 其他内网段（`10.*`、`192.168.*`、`127.*`、`fc00::/7`、链路本地）保持被拦，要有测试证明。
5. 补丁要接进 `apply-all.mjs`，并过 `patches-wired` 那条测试（见记忆 `unwired-patches-1113`：测试过了但补丁没真正跑的事出过一次）。

**A2　`memory_search` 要么能用，要么不出现**
1. 网关启动时检查每个模式的 `openclaw-agent.sqlite`：结构版本比本运行时新，就把它连同 `-shm`、`-wal` 改名挪到 `~/.openclaw/backups/agent-db-<日期>/<模式>/`，让运行时重建。**只挪不删**，挪之前先确认网关没在写它。
2. 重建后检查没有向量检索（`provider: none`）时 `memory_search` 的表现：
   - 能按关键词查到 `memory/` 下的文件 → 留着；
   - 还是报错或永远空 → 用模式的 `tools.deny` 把 `memory_search`、`memory_get` 从工具列表里拿掉，并在 `PROGRESS.md` 里写明，等以后有向量服务再放回来。碧琪自己的 `clekk_memory` 不受影响（13 次调用 0 失败）。
3. 用户的旧库不要尝试降级转换，备份留着就行。

**A3　搜索不再被一家卡死**
1. `pinkie_search` 的免 Key 搜索源从一个扩成一条链：按顺序试，一个被拦就换下一个，全部失败才报错。候选：必应中国版、搜狗、360、百度的结果页，加上原来的 DuckDuckGo。每个源单独一个解析函数、单独测试、带 8 秒超时。
2. 所有源都失败时，**由工具自己**用应用内浏览器打开搜索页取结果再返回，不要把「你去用浏览器搜」这句话丢给模型。
3. 内置 `web_search` 和 `pinkie_search` 只留一个给模型：优先让 `web_search` 这个名字走到新的链上（模型更熟这个名字）；做不到就在各模式 `tools.deny` 里拿掉内置的那个。两个搜索工具同时摆着，模型会两头都试。
4. 结果条数上限提到 10，每条带标题、网址、摘要、来源是哪一家。
5. 同一个搜索源 60 秒内连续失败 2 次，后面 10 分钟先跳过它。

**A4　`image` / `pdf` 能读用户给的文件**
1. 路径不在允许目录时，工具层自己把文件复制到当前模式工作区的 `media/inbox/` 下再读，读完保留 24 小时后清理。对模型透明，不报错。先看 `patch/apply-image-access.mjs` 现在怎么做的，在它上面改，不要另起一套。
2. 仍然拒绝的：`~/.ssh`、钥匙串、`~/.openclaw/credentials`、`~/.config/super-pinkie`（设定防护的私钥在这）这类目录。
3. PDF 超过 10 MB：
   - 带了 `pages` 的，先用 App 自带的 Python 把这几页抽成一个小文件再送；
   - 没带 `pages` 的，返回页数和目录（有的话），并明确告诉模型「请用 pages 指定要读的页，一次最多 N 页」，**这条算正常结果，不标出错**。
4. 图片超限：先缩到上限以内再送，不要直接拒。

**A5　`process` 的提醒不算出错**
- `background-jobs.mjs` 里那段提醒改成正常结果返回，文字不动。真正的失败（任务不存在、进程崩了）仍然标出错。同步改 `tests/background-jobs.test.mjs`。

**A6　`app_browser` 宽容一点**
1. `wait`：给了 `text / selector / ref / name` 之一再加 `ms`，把 `ms` 当成最长等待时间；只给 `ms` 就是纯等待。上限 15 秒不变。
2. `serve`：`dir` + `port` 合法（用这个端口起静态服务）；`dir` 和 `command` 同时给才报错。
3. Mac 上的 `tab`：`op: "new"` 等价于 `open`，其他操作返回一句明确的「Mac 版只有一个页面，直接用 open 换网址」，不标出错。
4. 工具说明里的参数描述同步改，让模型第一次就能写对。
5. 证书无效这类报错，把英文系统原话换成一句中文，并给出下一步（换 http、换别的来源）。

**A7　出错和中断的回复（只查不改）**
- 60 个会话里有 32 条 `openclaw:prompt-error`、36 次回复以出错结束。按原因分类计数（上游超时、鉴权、上下文超长、其他），写进 `PROGRESS.md`。占比最高的一类如果是碧琪这边能修的，另开一项报给 Fable，不要顺手改。

### B 组　减轻每轮固定负担

**B1　按模式、按场合发工具**
1. 飞书 13 个、QQ 2 个工具：只在该会话确实绑了对应渠道时才发。用已有机制（各模式 `agents.list[].tools.deny`，或插件的发工具前钩子），**不新增配置键**。
2. `nodes`、`gateway`、`agents_list`、`dir_fetch`、`dir_list`、`file_fetch`、`file_write`：逐个查最近 60 个会话的调用次数，是 0 且普通用户用不到的，默认不发。拿掉任何一个之前，先确认没有打法文档或代码在指望它。
3. 目标：普通会话的工具数从 65 降到 45 以下。

**B2　不常用的工具按需加载**
1. 把工具分成「常驻」和「按需」两层。常驻：读写改、`exec`、`process`、搜索、抓网页、浏览器、计划、提问、看图、PDF、会话、记忆。按需：`computer` / `computer_flow`、`cron`、`chart`、`image_generate`、代码检查那几个、学习台工具（学习模式下常驻）、以后的 MCP 工具。
2. 按需层只在系统提示词里列「名字 + 一句话用途」。新增一个常驻工具 `tool_load`，参数是工具名或组名；调用后这一组的完整说明从**下一次模型调用起**加入本会话，之后一直留着（来回增减会让上游缓存失效）。
3. 先确认插件钩子能按会话改发出去的工具列表。**做不到就停在 B1，把原因写进 `PROGRESS.md`，不要为此去改运行时的核心发送逻辑。**
4. 目标：工具说明从约 7.6 万字降到 4 万字以下。

**B3　系统提示词只拆账，不删任何字**
1. 把 6.2 万字拆开：人设、打法、技能列表、工具用法、项目速览、记忆各占多少字，哪些段落是机器拼出来且逐字重复的，写进 `PROGRESS.md`。
2. **这一项不许删、不许改、不许缩写系统提示词里的任何内容。** 弱模型靠这些打法和规矩撑着，砍了只会更差（用户 11-13 的意见）。
3. 要不要动、动哪里，由用户和 Fable 看了拆账结果再定，不在这一轮里做。

### C 组　让模型把工具用对

**C1　一次调多个工具**
1. 先查原因：各模型的上游适配有没有把「可以并行调工具」的开关传过去；运行时收到一条回复里多个调用时是并行跑还是排队跑。结论写进 `PROGRESS.md`。
2. 开关没传的补上。
3. 在 `read`、搜索、`code_search`、`web_fetch` 的工具说明末尾加同一句话（下面第五节 Fable 写好的原文）。
4. 目标：并行占比从 14% 提到 30% 以上。

**C2　少用 `exec` 干别的工具的活**
1. A 组修完后先重新量一次，很多 `exec` 是因为搜索和抓网页坏了才绕过去的。
2. 还高的话：`exec` 的命令明显是 `cat` / `head` / `sed -n`（读文件）、`grep` / `rg`（搜代码）、`curl` / `urllib`（抓网页）时，在**正常结果**后面附一行提示，指出对应的专用工具。每个会话每类只提示一次，不拦命令、不标出错。
3. 目标：`exec` 占比从 58% 降到 45% 以下。

### D 组　补缺的机制

**D1　外部连接器（MCP）**
1. 设置里加一页「连接器」：列表、添加、启用 / 停用、删除、连接状态。添加方式两种：从预置清单里点；或手填命令 / 网址。
2. 写入的就是运行时已有的 `mcp.servers.*`。**写之前用运行时自己的配置校验跑一遍**，不通过就不写。
3. 预置清单先放 5 个不需要密钥或只需要用户自己登录的：本地文件夹、GitHub、Notion、高德 / 百度地图、日历。密钥只存在用户本机，仓库里不出现。
4. 连接器带进来的工具一律进 B2 的按需层。
5. 界面文案用碧琪口吻（见记忆 `release-notes-biqi-voice`、三份「我→碧琪」规则）。

**D2　独立工作树**
1. 项目模式开子会话（`pinkie_session_start`）时，目标文件夹是 git 仓库且已有别的会话在这个仓库里干活，就给新会话建一个独立工作树和分支，互不踩文件。
2. OpenClaw 原生有「在工作树中新建聊天」，11-11 只是从侧边栏拿掉了入口，功能还在，优先复用它。
3. 子会话结束时把分支名报回父会话。工作树没有改动就自动清掉，有改动就留着并告诉用户在哪。**不自动合并、不自动推送。**

**D3　成品能导出成一个文件**
- 工作台里的成品页面加「导出」：打成一个自带样式和图片的单个 HTML 文件，存到用户选的位置。不做在线托管，不上传任何地方。

**D4　项目模式看 PR 和 CI**
- 新工具 `pr_status`：靠本机的 `gh` 读当前分支的 PR、检查结果、评论。没装 `gh` 或没登录时返回一句怎么装、怎么登录。只读，不建 PR、不合并。放按需层。

**D5　用用户自己浏览器的登录状态（只调研）**
- 调研三条路：现有 `browser` 工具的配置档、从用户浏览器导入单个站点的登录、浏览器扩展。写清各自的工作量和风险，交 Fable 和用户定，不实现。

**不做**：沙箱和权限分级（用户 11-13 明确不要）。

---

## 四、分支、测试、交付

- 基线分支：`install/all-1113-live`（正式环境现在跑的就是它，`91ce747a`）。
- 新分支：`fix/tools-health-1113`，工作区 `wt/tools-health`（`git worktree add`）。主工作区 `repo/` 现在停在 `feat/study-desk-drill`，有 19 个未提交改动，**不要碰**。
- 每次提交后立刻推到 origin（见记忆 `push-after-commit`）。不合 `main`、不打 tag、不发版、不装进正式 App；这些等 Fable 验收后由 Fable 做。
- 改到运行时补丁的，跑 `refresh_mac_runtime.py --check`（Windows 用的是 Mac 运行时快照，见记忆 `windows-mac-runtime-snapshot`）。
- 所有实测只在隔离副本做：`tools/work-first-eval/isolated`（独立端口和状态目录）。**不碰正式 App、18789 端口、`~/.openclaw`。**
- 实测一批跑完再看结果，`--repeat 2`，并发 8，不要一条一条唤醒（见记忆 `batch-eval-runs`）。隔离副本和正式 App 共用上游账号，报 400 / 鉴权错时先看记忆 `iso-bench-shares-upstream`。

---

## 五、Fable 写好的文字（原样用，不要改写）

**加在 `read`、搜索、`code_search`、`web_fetch` 工具说明末尾：**

> 互不依赖的几次调用，放在同一条回复里一起发，不要一条一条来。

**`exec` 结果后的提示（C2）：**

> 提示：读文件用 read，搜代码用 code_search，抓网页用 web_fetch，会比命令行省事。这条只提醒一次。

**PDF 超限且没带 pages 时的返回（A4）：**

> 这份 PDF 有 {页数} 页、{大小} MB，太大了没法整本读。请用 pages 指定要读的页，一次最多 {N} 页。{有目录时：目录如下……}

**`memory_search` 被拿掉时写进工具用法的一句（A2，仅在走第二条路时）：**

> 记忆检索暂时停用；要找以前说过的话，用 clekk_memory 或 sessions_history。

**MCP 工具和按需工具在系统提示词里的列法（B2）：**

> 下面这些工具要先 tool_load 才能用，加载后本会话一直有效：
> - {名字}：{一句话用途}

其他需要新写的提示文字、任何进 `personas/` 的内容，列到 `PROGRESS.md` 的「待 Fable 写」里，不要自己写。
