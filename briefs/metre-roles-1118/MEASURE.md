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

| 工具名 | 归类（3.7 节对照 / 角色不给原因） | JSON 字数 | 估算 token | 来源 |
|---|---|---:|---:|---|
| `cron` | 非六类 / 角色禁用（定时任务） | 14,750 | 4,336 | OpenClaw 内建 |
| `learning_activity` | 非六类 / 角色禁用（学习模式专用） | 13,264 | 3,899 | 插件 |
| `message` | 非六类 / 角色禁用（外部渠道发消息） | 6,498 | 1,910 | OpenClaw 内建 |
| `skill_workshop` | 非六类 / 角色禁用（`UNUSED_OPENCLAW_TOOLS`） | 2,675 | 786 | OpenClaw 内建 |
| `computer_flow` | `exec`（桌面自动化 / 角色不给） | 2,248 | 661 | 插件 |
| `nodes` | 非六类 / 角色禁用（配对节点） | 2,182 | 641 | OpenClaw 内建 |
| `sessions_spawn` | 非六类 / 角色禁用（禁止多层派活） | 1,926 | 566 | OpenClaw 内建 |
| `gateway` | 非六类 / 角色禁用（网关控制） | 1,367 | 402 | OpenClaw 内建 |
| `metre_memory` | 非六类 / 角色禁用（Metre 专属项目记忆） | 1,180 | 347 | 插件 |
| `pinkie_sessions` | 非六类 / 角色禁用（会话管理） | 1,149 | 338 | 插件 |
| `pinkie_session_start` | 非六类 / 角色禁用（禁止多层派活） | 1,110 | 326 | 插件 |
| `memory_search` | 非六类 / 角色禁用（记忆工具不给） | 974 | 286 | OpenClaw 内建 |
| `ask_user` | 非六类 / 角色禁用（用户看不到角色子会话） | 819 | 241 | 插件 |
| `sessions_list` | 非六类 / 角色禁用（会话工具不给） | 758 | 223 | OpenClaw 内建 |
| `workbench_read` | `read`（工作台专用 / 角色已有 `read`/`code_search`） | 750 | 220 | 插件 |
| `computer` | `exec`（桌面操控 / 角色不给） | 749 | 220 | 插件 |
| `pinkie_mode_ask` | 非六类 / 角色禁用（禁止多层派活） | 717 | 211 | 插件 |
| `sessions_send` | 非六类 / 角色禁用（会话工具不给） | 680 | 200 | OpenClaw 内建 |
| `clekk_memory` | 非六类 / 角色禁用（记忆工具不给） | 665 | 195 | 插件 |
| `plan_update` | 非六类 / 角色禁用（计划工具不给） | 643 | 189 | 插件 |
| `memory_get` | 非六类 / 角色禁用（记忆工具不给） | 597 | 175 | OpenClaw 内建 |
| `delivery_guard` | 非六类 / 角色禁用（内部门禁工具） | 584 | 172 | 插件 |
| `create_goal` | 非六类 / 角色禁用（目标管理） | 528 | 155 | OpenClaw 内建 |
| `update_goal` | 非六类 / 角色禁用（目标管理） | 528 | 155 | OpenClaw 内建 |
| `pinkie_models` | 非六类 / 角色禁用（Metre 专属） | 479 | 141 | 插件 |
| `session_status` | 非六类 / 角色禁用（会话工具不给） | 472 | 139 | OpenClaw 内建 |
| `sessions_history` | 非六类 / 角色禁用（会话工具不给） | 468 | 138 | OpenClaw 内建 |
| `web_gpt_activity` | 非六类 / 角色禁用（网页 GPT 协作） | 413 | 121 | 插件 |
| `subagents` | 非六类 / 角色禁用（禁止多层派活） | 356 | 105 | OpenClaw 内建 |
| `workbench_show` | 非六类 / 角色禁用（工作台 UI） | 340 | 100 | 插件 |
| `pinkie_session_message` | 非六类 / 角色禁用（会话工具不给） | 307 | 90 | 插件 |
| `pinkie_session_title` | 非六类 / 角色禁用（会话工具不给） | 261 | 77 | 插件 |
| `sessions_yield` | 非六类 / 角色禁用（禁止多层派活） | 239 | 70 | OpenClaw 内建 |
| `pinkie_session_list` | 非六类 / 角色禁用（会话工具不给） | 202 | 59 | 插件 |
| `get_goal` | 非六类 / 角色禁用（目标管理） | 196 | 58 | OpenClaw 内建 |
| `agents_list` | 非六类 / 角色禁用（禁止多层派活） | 193 | 57 | OpenClaw 内建 |

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
