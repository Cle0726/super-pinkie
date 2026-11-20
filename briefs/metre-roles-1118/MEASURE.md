# Metre 角色 agent · R0 实测与清点报告

- 执行环境：Windows 隔离副本 `F:\碧琪实测\iso-roles`（端口 `3112`，`METRE_ISO_ROOT=F:\碧琪实测\iso-roles`），未触碰正式环境。
- 测试模型：`mm/workbuddy/deepseek-v4.1-flash`（本地中继 `http://127.0.0.1:1466/v1`，经本地只读抓包代理 `127.0.0.1:14669` 捕获网关实际发出的完整 `messages` 与 `tools` 定义）。
- 测试输入：四组统一发送同一条极短消息 `只回复两个字：收到`。
- 统计口径：严格采用 `tools/metre/iso/tokens.py` 口径，单次固定输入 = `usage.input + usage.cacheRead`。

---

## 一、四种配置的每次调用固定输入（R0-1 ★）

| 配置 | 会话 Key | 固定输入 (`input + cacheRead`) | 系统提示字数 | 发送工具数 | 工具定义总字数 | 相对 `project` 变化 |
|---|---|---:|---:|---:|---:|---:|
| 项目模式 (`project`) | `agent:project:iso-r0full2-0` | **51,167** | 52,436 | 52 | 87,376 | 基准 |
| Metre 模式 (`metre`) | `agent:metre:iso-r0full2-1` | **37,269** | 24,416 | 58 | 95,203 | -27.2% |
| `roles` 原型（全套工具，`contextInjection: "never"`） | `agent:roles:iso-r0full2-2` | **32,502** | 18,302 | 53 | 91,411 | -36.5% |
| `roles` 原型（砍过工具，`contextInjection: "never"` + `tools.deny`） | `agent:roles:iso-r0pruned-0` | **14,480** | 14,544 | 22 | 33,855 | **-71.7%** |

### 会话记录路径与 `usage` 原文

1. **项目模式 (`project`)**
   - 会话记录：`F:\碧琪实测\iso-roles\home\.openclaw\agents\project\sessions\efec8491-b85c-4221-87a1-0b38a282b8b9.jsonl`
   - 抓包文件：`F:\碧琪实测\iso-roles\logs\r0-captures\req-0005-1795068386259.json`
   - `usage` 原文：
     ```json
     {"input": 49887, "output": 2, "cacheRead": 1280, "cacheWrite": 0, "reasoningTokens": 0, "totalTokens": 51169, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}
     ```
   - 算式：`49887 + 1280 = 51167`

2. **Metre 模式 (`metre`)**
   - 会话记录：`F:\碧琪实测\iso-roles\home\.openclaw\agents\metre\sessions\e9ee153b-dfb2-4dcd-bc8c-961c402dfbb2.jsonl`
   - 抓包文件：`F:\碧琪实测\iso-roles\logs\r0-captures\req-0006-1795068386273.json`
   - `usage` 原文：
     ```json
     {"input": 37269, "output": 2, "cacheRead": 0, "cacheWrite": 0, "reasoningTokens": 0, "totalTokens": 37271, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}
     ```
   - 算式：`37269 + 0 = 37269`

3. **`roles` 原型（全套工具）**
   - 会话记录：`F:\碧琪实测\iso-roles\home\.openclaw\agents\roles\sessions\bdaa8889-68ba-4323-b012-923dd9617ae0.jsonl`
   - 抓包文件：`F:\碧琪实测\iso-roles\logs\r0-captures\req-0004-1795068386209.json`
   - `usage` 原文：
     ```json
     {"input": 32246, "output": 2, "cacheRead": 256, "cacheWrite": 0, "reasoningTokens": 0, "totalTokens": 32504, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}
     ```
   - 算式：`32246 + 256 = 32502`

4. **`roles` 原型（砍过工具）**
   - 会话记录：`F:\碧琪实测\iso-roles\home\.openclaw\agents\roles\sessions\4d082840-8de9-4d59-a6a8-e9a383782d35.jsonl`
   - 抓包文件：`F:\碧琪实测\iso-roles\logs\r0-captures\req-0010-1795068572913.json`
   - `usage` 原文：
     ```json
     {"input": 14480, "output": 2, "cacheRead": 0, "cacheWrite": 0, "reasoningTokens": 0, "totalTokens": 14482, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}
     ```
   - 算式：`14480 + 0 = 14480`

> 换算率实测校准：`roles` 全套工具 vs 砍过工具一共减少 `(91411 - 33855) + (18302 - 14544) = 61,314` 字符，实测 token 减少 `32502 - 14480 = 18,022` token，折合 **3.402 字符 / token**。下文各工具估算 token 均按此实测换算率计算（`round(chars / 3.402)`）。

---

## 二、网关实际发出工具定义大小表（R0-2 ★）

对 `project`、`metre`、`roles`（全套）三次抓包合并去重，网关实际发出的工具共 **58 个**（`roles` 全套 53 个 + `metre`/`project` 独有 5 个）。全部逐一归类如下，无一遗漏。

### 2.1 `roles` 保留的 22 个工具（按 PLAN 第 3.7 节六类）

| 工具名 | 类别 | JSON 字数 | 估算 token | 来源 | 说明 |
|---|---|---:|---:|---|---|
| `code_search` | `read` | 1,151 | 338 | 插件 (`workbench`) | 跨平台代码搜索（按角色卡 `read` 按需注册） |
| `pdf` | `read` | 727 | 214 | OpenClaw 内建 | 读取/分析 PDF |
| `read` | `read` | 711 | 209 | OpenClaw 内建 | 读文件/读图 |
| `image` | `read` | 636 | 187 | OpenClaw 内建 | 用看图模型分析图片 |
| `code_refs` | `read` | 612 | 180 | 插件 (`workbench`) | 查找符号定义与引用（按角色卡 `read` 按需注册） |
| `code_check` | `read` | 515 | 151 | 插件 (`workbench`) | 静态语法/类型检查（按角色卡 `read` 按需注册） |
| `edit` | `write` | 1,281 | 377 | OpenClaw 内建 | 精确文本替换编辑 |
| `code_edit` | `write` | 793 | 233 | 插件 (`workbench`) | 代码块编辑（按角色卡 `write` 按需注册） |
| `write` | `write` | 453 | 133 | OpenClaw 内建 | 写入/创建文件 |
| `apply_patch` | `write` | 386 | 113 | OpenClaw 内建 | 多文件补丁 |
| `exec` | `exec` | 2,281 | 670 | OpenClaw 内建 | 执行 shell 命令 |
| `process` | `exec` | 1,690 | 497 | OpenClaw 内建 | 管理后台 exec 进程 |
| `run_tests` | `exec` | 829 | 244 | 插件 (`workbench`) | 运行项目测试（按角色卡 `exec` 按需注册） |
| `web_search` | `net` | 1,224 | 360 | OpenClaw 内建 | 联网搜索 |
| `web_fetch` | `net` | 526 | 155 | OpenClaw 内建 | 抓取网页正文 |
| `pinkie_search` | `net` | 418 | 123 | 插件 (`mode-architecture`) | 免 Key 网页搜索（按角色卡 `net` 按需注册） |
| `app_browser` | `browser` | 6,312 | 1,855 | 插件 (`mode-architecture`) | 浏览器控制（按角色卡 `browser` 按需注册） |
| `browser` | `browser` | 5,643 | 1,659 | OpenClaw 内建 | OpenClaw 浏览器控制 |
| `image_generate` | `media` | 3,018 | 887 | OpenClaw 内建 | 生图/改图 |
| `video_generate` | `media` | 2,557 | 752 | OpenClaw 内建 | 生成视频 |
| `music_generate` | `media` | 1,693 | 498 | OpenClaw 内建 | 生成音频/音乐 |
| `tts` | `media` | 586 | 172 | OpenClaw 内建 | 语音合成 |

六类小计（全 22 个工具）：
- `read`（6 个）：4,352 chars（~1,279 tok）
- `write`（4 个）：2,913 chars（~856 tok）
- `exec`（3 个）：4,800 chars（~1,411 tok）
- `net`（3 个）：2,168 chars（~638 tok）
- `browser`（2 个）：11,955 chars（~3,514 tok）
- `media`（4 个）：7,854 chars（~2,309 tok）
- **合计**：34,042 chars（在抓包 `req-0010` 中为 33,855 chars，差值 187 chars 为 `app_browser` / 参数随上下文微调），~10,007 tok。

### 2.2 `roles` 砍掉的 36 个工具（均由 `roles.tools.deny` 或插件按会话不注册剔除）

收尾时补齐禁用项目在六类中的归属：按工具所能产生的主要作用分类，多用工具按可变更状态的用途归类。对照 `metre-roles.mjs` 验证了原抓包表的 58 个名称，原字数和估算 token 没有改动；归类不改变禁用规则。

| 工具名 | 归类（3.7 节对照 / 角色不给原因） | JSON 字数 | 估算 token | 来源 |
|---|---|---:|---:|---|
| `cron` | `exec`（角色禁用：定时任务） | 14,750 | 4,336 | OpenClaw 内建 |
| `learning_activity` | `write`（角色禁用：学习模式专用） | 13,264 | 3,899 | 插件 |
| `message` | `net`（角色禁用：外部渠道发消息） | 6,498 | 1,910 | OpenClaw 内建 |
| `skill_workshop` | `write`（角色禁用：`UNUSED_OPENCLAW_TOOLS`） | 2,675 | 786 | OpenClaw 内建 |
| `computer_flow` | `exec`（桌面自动化 / 角色不给） | 2,248 | 661 | 插件 |
| `nodes` | `exec`（角色禁用：配对节点） | 2,182 | 641 | OpenClaw 内建 |
| `sessions_spawn` | `exec`（角色禁用：禁止多层派活） | 1,926 | 566 | OpenClaw 内建 |
| `gateway` | `exec`（角色禁用：网关控制） | 1,367 | 402 | OpenClaw 内建 |
| `metre_memory` | `write`（角色禁用：Metre 专属项目记忆） | 1,180 | 347 | 插件 |
| `pinkie_sessions` | `exec`（角色禁用：会话管理） | 1,149 | 338 | 插件 |
| `pinkie_session_start` | `exec`（角色禁用：禁止多层派活） | 1,110 | 326 | 插件 |
| `memory_search` | `read`（角色禁用：记忆工具不给） | 974 | 286 | OpenClaw 内建 |
| `ask_user` | `write`（角色禁用：用户看不到角色子会话） | 819 | 241 | 插件 |
| `sessions_list` | `read`（角色禁用：会话工具不给） | 758 | 223 | OpenClaw 内建 |
| `workbench_read` | `read`（工作台专用 / 角色已有 `read`/`code_search`） | 750 | 220 | 插件 |
| `computer` | `exec`（桌面操控 / 角色不给） | 749 | 220 | 插件 |
| `pinkie_mode_ask` | `exec`（角色禁用：禁止多层派活） | 717 | 211 | 插件 |
| `sessions_send` | `write`（角色禁用：会话工具不给） | 680 | 200 | OpenClaw 内建 |
| `clekk_memory` | `write`（角色禁用：记忆工具不给） | 665 | 195 | 插件 |
| `plan_update` | `write`（角色禁用：计划工具不给） | 643 | 189 | 插件 |
| `memory_get` | `read`（角色禁用：记忆工具不给） | 597 | 175 | OpenClaw 内建 |
| `delivery_guard` | `write`（角色禁用：内部门禁工具） | 584 | 172 | 插件 |
| `create_goal` | `write`（角色禁用：目标管理） | 528 | 155 | OpenClaw 内建 |
| `update_goal` | `write`（角色禁用：目标管理） | 528 | 155 | OpenClaw 内建 |
| `pinkie_models` | `read`（角色禁用：Metre 专属） | 479 | 141 | 插件 |
| `session_status` | `read`（角色禁用：会话工具不给） | 472 | 139 | OpenClaw 内建 |
| `sessions_history` | `read`（角色禁用：会话工具不给） | 468 | 138 | OpenClaw 内建 |
| `web_gpt_activity` | `browser`（角色禁用：网页 GPT 协作） | 413 | 121 | 插件 |
| `subagents` | `exec`（角色禁用：禁止多层派活） | 356 | 105 | OpenClaw 内建 |
| `workbench_show` | `read`（角色禁用：工作台 UI） | 340 | 100 | 插件 |
| `pinkie_session_message` | `write`（角色禁用：会话工具不给） | 307 | 90 | 插件 |
| `pinkie_session_title` | `write`（角色禁用：会话工具不给） | 261 | 77 | 插件 |
| `sessions_yield` | `exec`（角色禁用：禁止多层派活） | 239 | 70 | OpenClaw 内建 |
| `pinkie_session_list` | `read`（角色禁用：会话工具不给） | 202 | 59 | 插件 |
| `get_goal` | `read`（角色禁用：目标管理） | 196 | 58 | OpenClaw 内建 |
| `agents_list` | `read`（角色禁用：禁止多层派活） | 193 | 57 | OpenClaw 内建 |

> R1 插件层按角色卡 `tools` 类别动态决定是否注册插件工具（如 `app_browser` 占 6,312 chars / ~1,855 tok，非 `browser` 角色根本不发此工具定义），实际非浏览器角色（如 `researcher`、`backend-fix`）固定输入还会进一步降到 **~12k–13k token**。

---

## 三、五个老模式改动前基准存档（R0-3 ★）

- 存档文件：`briefs/metre-roles-1118/legacy-inject-baseline.json`
- 生成提交：`d58d37e2`（**在任何产品代码改动之前**生成并提交，仅扩展了 `tools/metre/inject-inventory.mjs`）
- 复核命令：`node tools/metre/inject-inventory.mjs --verify-baseline briefs/metre-roles-1118/legacy-inject-baseline.json`
- 总体 SHA-256（5 老模式 × 3 条样例 + 工作区文件 + `pinkie_session_start` / `pinkie_mode_ask` 快照）：
  `293054e40619ddac97fffee51571d01e3e8999c848f337f960c6998e6c003fba`
- Metre 改动前 `pinkie_session_start` / `pinkie_mode_ask` 工具定义快照 SHA-256（供 R1-11 关闭 `metreRoles` 校验）：
  `1c25608d896b962b76e2904aae1a441a8e1a94b01dbf6c33c601cd4eec29dcef`

| 模式 | 工作区 SHA-256 | 工具快照 SHA-256 | 样例 #1 SHA-256 | 样例 #2 SHA-256 | 样例 #3 SHA-256 |
|---|---|---|---|---|---|
| `main` | `f716a4496185...` | `b92b908d6355...` | `efe5101c945c...` | `a6f7a2a73d30...` | `930619f04fab...` |
| `project` | `a9226b47673f...` | `b92b908d6355...` | `2276bfd0b28e...` | `c5074e28c0f8...` | `6d9edd049d38...` |
| `thinking` | `1830ca200c89...` | `b92b908d6355...` | `f384f1d05a4b...` | `185a0748a06f...` | `2f1827c1cb4e...` |
| `learning` | `6cd7e5495f54...` | `b92b908d6355...` | `cad2588441fc...` | `d9cc33180da2...` | `46cc32632f9f...` |
| `unrestricted` | `eecf9eae2710...` | `b92b908d6355...` | `f90aadba8528...` | `f90aadba8528...` | `f90aadba8528...` |

---

## 四、磁盘检查与 R0 结论（R0-4 / R0-5）

1. **R0-4 磁盘检查**：开工时 F 盘剩余 `14,598,283,264` bytes（`13.60 GiB` / `14.60 GB`），不足 15GB；按规矩停下报告用户并记入 `PROGRESS-1.md`（提交 `d9f259c6`），未擅自删除任何文件。用户查看大目录清单后回复「全部清」清理 `F:\tmp` 旧临时文件，清理后 F 盘剩余 `37,400,641,536` bytes（`34.83 GiB` / `37.40 GB`），满足 ≥15GB 要求后才创建 `F:\碧琪实测\iso-roles`。
2. **R0-5 门槛判定**：`roles` 原型（砍过工具）的每次调用固定输入为 **14,480 token**，远低于 PLAN R0 第 5 条的 **30,000 token** 门槛（余量 15,520 token，足以容纳 `ROLES_BASE` ≤800 字、角色卡正文 ≤1,200 字及少量运行时事实并保持总固定输入远低于 30k）。
   - **结论：通过，继续进入 R1 机制实现。**

---

## 五、本次八轮免费模型验收补记

- **计数：完整执行 0/8，逐轮复判 0/8。** 首对的初试及重跑合计 7 次真实上游响应，没有一组完成。按用户 2026-11-19 确认，后续逐轮复判在独立上下文用同一免费模型，**非异厂复核**。不影响产品内指定 `of` 时的异厂保护；本轮没有给任何结果补分。
- 候选产品源码 `7467977aee5ef3f5d0d99f7b2a04cf47f776d13f`。请求 `mm/workbuddy/hy4flash-free`，中继实际请求 `workbuddy/hy4flash-free`，HTTP 200 的响应标识 `hy4-flash-free`（腾讯）。两标识并列记录，不声称字符串相同。只直连本机 :1466，不经过 :1467 的模型回退；七次回应的 usage 均为 `credit: 0`，无救援响应头。合成的本机派活驱动只调用实际工具，不生成样题答案、不计入八轮。
- **真图预检（另计）**：2026-11-20 01:35:22 UTC，带真实 PNG 的一条请求，正确读出提示中没有的随机数字 `514410`。HTTP 200，用量 `prompt_tokens=230, completion_tokens=59`。回执 `vision-live-20261119-173522/result.json` SHA-256 `c0fbbe3964318b5f80fada9564cc3cfe3f234ec59ffd78d56e15a733d5526d1b`；PNG SHA-256 `549f613d5fe72fca609e985a91d04569e6bda076a3857c6b837335a7e1836e42`。旧隔离配置只报文本；共享安装逻辑已把干净配置的这条路由更新为文本加图片。目录的免费标签与实际调用的零 credit 是不同证据，未取得账户总账单。

| 固定样题 | A：项目 | C：角色 |
|---|---|---|
| `backend-fix-1` | 真实 Project 子会话；收到工具动作，但夹具中继误拒了只读 Git 命令；未交回 | 真实 backend-fix 角色子会话；执行了读取，第二次模型响应的流在转发后中断；未交回 |
| `researcher-2` | 未派发 | 未派发 |
| `ui-replicator-1` | 未派发 | 未派发 |
| `reviewer-1` | 未派发 | 未派发 |

首对 A/C 相同简报 SHA-256：`3011fa065a7296f100a4c09ff4d4f494fd60a1b84ebc575cbca88939b02e61c3`；相同种子夹具 SHA-256：`19be9bc0ecece586d36b52a98c92b20a879b55d2435cf5cd20f90766c44b52bd`（按相对路径排序后的 `[路径, 原文]` JSON）。原始证据根 `C:/Users/34786/Documents/Codex/2026-11-19/origin-feat-metre-roles-1118-briefs/work`，相对该根：

| 尝试 | 隔离工作区、会话与请求/用量 |
|---|---|
| A 首次上游响应 | `ml-175751/A/fixture`；`agent:project:pinkie-child:7ef612a4b00c83faa420ddefcb0bf136`。查 `A/run.json`、`A/child-01-response.txt`、`A/board.json`；请求 SHA-256 `08e6eeed774ecbeba1bd833faf05d6812671d78f7e43918b6f6b6bd52d42f2da`；HTTP 200，输入/输出 `27526/937`。模型请求读三个文件、`git status --short --branch` 及 `run_tests`；测试夹具中继的白名单误拒而非产品拒绝。默认 Project 工作区曾与夹具同路径，由运行时初始化的额外文件也不能记为模型改动。 |
| C 首次派活 | `ml-175751/C/fixture`；`agent:roles:pinkie-child:deb3a14f497fd9a568642a6fbfb04e08`。查 `C/run.json`、`C/child-{01,02}-response.txt`、该 agent 的原始 JSONL 和 `C/board.json`。两次 HTTP 200；输入/输出 `9565/558`、`13240/2359`。首条会话 usage 摘录：`{"input":9565,"output":558,"cacheRead":0,"cacheWrite":0,"totalTokens":10123}`，按 R0 算式为 `9565 + 0`。第一轮 6 次读工具有结果；第二轮上游给了工具调用，但会话日志记录 `errorMessage=terminated`，没有运行或交回，不算成修复。前后清单相同（含越权哨兵），但没有交回说明，X4 不算通过。 |
| 修正夹具后重跑 | `ml-180847/{A,C}/`。分别派到 `agent:project:pinkie-child:7f79f765b9ec991e1ce23c9474e79bee` 与 `agent:roles:pinkie-child:930382555a1b6a3a1b5d7953ad1a6abf`。仅在本机监听端口和新 profile 内调整试跑工具策略、流式转发和默认工作区，不改产品或样题种子。两组的 `run.json` 均为 `validateExit=0`、`changed=[]`、`gatewayStopped=true`；各一次上游连接遇到 `ConnectionRefusedError`，无 HTTP 回包、无新增模型 usage。尚不能据此认定转发修正后的线上结果。 |
| 临时恢复监听期间重跑 | `ml-181710/{A,C}/run.json`、`ml-184605/{A,C}/run.json`。A 两次分别收到 2 条 HTTP 200，流可到达工具阶段；均因复现命令的内容不在隔离中继允许范围而未执行下一步，没有交回。C 两次各一次连接被拒，没有新的模型回应。所有网关事后已停。不能把这两次 A 的额外调用算成另外两道题。 |
| R3-5 静态六维评分（另计） | `card-review-175811/receipt.json`：新上下文、同一条免费模型、无任何工具。实际 HTTP 200、输入 `23054`、输出 `5500` 全为推理用量，`finish_reason=length`，无可用的评分 JSON。`card-batch-181039/batch-1/receipt.json` 是缩小批次后连接失败，无第二份结果。 |

复跑入口：仓库根执行 `node tools/metre/roles/compose.mjs --release-single-model mm/workbuddy/hy4flash-free`，产物仅为计划；两组各用全新隔离工作区和网关，固定相同简报、夹具，实际调用 `pinkie_session_start`（A 传 `mode: project`，C 传 `role`），先核对 :1466 可连接；本机夹具与记录脚本为 `work/run-metre-live-pair.py`，用 `--repo <候选工作树> --runtime-root <隔离运行时> --out <新隔离目录>`。证据优先顺序：判据下可重跑的工具与文件 → 原始会话与交回 → 新上下文模型复判，不以模型自述替代现场。请勿上传原始提示、完整请求或任何配置。

### R3-5 · 续验：33 张卡的六维评分

新上下文同模型评分；候选 `66bd7013`。第一次缩批后虽然恢复连接，11 张一批仍在 5,500 输出预算处停在推理，没有可解析答案（`cr-193701/batch-1/receipt.json`）。之后每批只给对应 PLAN 行、角色卡及主 MD，用无执行权限的结构化提交返回评分；每次实际 HTTP 200、`credit: 0`，没有模型救援。

| 批次 | 卡数 | 输入/输出 token |
|---|---:|---:|
| `cs-194255` 第一批 | 11 | 9976 / 4706 |
| 第二批 | 11 | 10483 / 7627 |
| 第三批 | 11 | 10597 / 7008 |

原分及精确目录/哈希：[card-review-scores.json](ref/card-review-scores.json)。33 个角色 ID 无重复、无缺项，全部维度达到 4。原卡得分集中在最高分，单独加了不计入 33 张的盲评反例：临时拿掉 `backend-fix` 的具体要求、证据及边界，评分 `1/1/1/3/2/1`；同批另两张正常卡最低分各为 4。这里只确认静态评分能识别明显缺项，不把满分解释为对角色运行质量的保证。
