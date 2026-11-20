# Metre 角色 agent · 车道 4 进度

## 2026-11-18 · 开工检查

- 从 `origin/feat/metre-roles-1118` 的 `9dba1a4c` 建独立工作树和车道 4 分支。`git pull --rebase` 返回 `Already up to date.`。已读 PLAN、ACCEPTANCE 和共享进度；共享进度未改。
- F 盘可用 **14,597,189,632 字节（14.60 GB / 13.59 GiB）**，低于 PLAN R0 / ACCEPTANCE R0-4 的 15 GB 停线。暂停实现，未删除任何数据，未建隔离副本，未启动网关。
- 正式环境只读记录（开工及暂停前复查一致）：`C:\Users\34786\.openclaw\openclaw.json` 最后修改 UTC `2026-11-14T07:50:37.9293033Z`；`C:\Users\34786\AppData\Local\SuperPinkie` 最后修改 UTC `2026-11-15T11:20:15.9964807Z`；18789 无监听 PID。
- 未修改产品代码、五个老模式或其他车道的文件。服务 `setup.py` 暂无改动行。

### `git grep -n workspace-metre` 清点（基线行号）

| 路径 | 命中行 |
|---|---|
| `app/super_pinkie.py` | 474, 536 |
| `install.ps1` | 133, 199, 201 |
| `installer/guard/guard.mjs` | 28 |
| `installer/macos/apply-bundled.sh` | 110, 114 |
| `installer/macos/sync-personas.sh` | 61 |
| `services/mode-architecture/memory.mjs` | 14（只清点，不接入角色记忆） |
| `services/mode-architecture/setup.py` | 299 |
| `tests/windows_mode_agents_test.py` | 217 |
| `tools/metre/iso/setup.py` | 248 |
| `briefs/metre-mode-1113/ACCEPTANCE.md` | 17 |
| `briefs/metre-mode-1113/PLAN.md` | 39, 253 |
| `briefs/metre-mode-1113/PROGRESS.md` | 87, 102, 157, 411, 798 |
| `briefs/metre-roles-1118/PLAN.md` | 120, 121, 123 |

`build-win.ps1` 无字面命中，恢复后仍需检查打包入口。

### 待用户定

确认先释放 F 盘空间再继续，或允许车道 4 在低于 15 GB 时仅做代码、文档和假数据截图（不建隔离副本、不跑网关、不构建安装包）。

### 自查（暂停时）

| 条目 | 结果 |
|---|---|
| R1-16 | 没测：尚未实现；实际侧栏需要网关。 |
| R1-18 | 没测：尚未实现；运行一轮后的检查需要网关。 |
| R1-27 | 没测：尚未实现；未生成假数据截图。 |
| R4-1 | 没测：尚未实现；列卡和派活需要网关。 |
| R4-2 | 没测：尚未实现官方卡同步。 |
| R4-4 | 没测：未执行新装、升级或 Mac 快照。 |
| R4-5 | 没测：三份文档尚未改。 |

## 2026-11-18 · 安装资产同步

- 用户确认继续；复测 F 盘 37,400,276,992 字节（37.40 GB），超过停线。仍不构建安装包、不建隔离副本、不启动网关。
- Windows 入口（install.ps1、App 安装/更新）、Mac 源安装及 App（sync-personas.sh、apply-bundled.sh，兼容热修脚本），以及以后使用的 iso 脚本均复用 metre_role_assets.py；guard 的通用恢复循环跳过整个 metre/roles 子树。打包核对官方卡字节和角色工作区资源；未构建包。
- 官方顶层 Markdown 同字节不重写；不同文件先备份；源目录存在时退休的官方卡移到备份。旧包没有 roles 源目录时不当成全量删除；不进入 user/ 或 drafts/。工作区只复制项目打法、想法视觉规范并创建空占位，不复制人格和 memory/。
- 本提交 services/mode-architecture/setup.py **502–504、550–553、591**：调用资产复制、把其他车道提供的 metre-roles.mjs 加入插件安装复制、调用工作区同步。没有改 agent 配置或工具。
- 正式 App 安装目录补记：C:/Users/34786/AppData/Local/Programs/SuperPinkie，最后修改 UTC 2026-11-03T22:57:22.1522954Z；此前记录的 SuperPinkie 同名目录是 App 状态目录。
- 验证：Windows 临时文件夹测试 19/19、persona bundle 3/3、Node self-contained-app 25/25 通过；Shell/PowerShell/guard 语法检查、git diff --check 通过。Mac 包安装/导入检查用 Windows 的 Node 对当前源码根运行（返回 Mac mode plugin fresh-install import OK），**不是打包后的 Mac 快照**。
- 既有 mode_architecture_setup_test.py 在 Windows 为 9/10：第 45 行硬编码 Mac 状态目录，曾在 9dba1a4c 原版 setup.py 上单独重跑并得到同一 FileNotFoundError；未改老测试。macos_bundled_setup_test.py 初跑在 Windows 默认编码（cp1252）读取/写入中文 fixture 时失败，不作为 Mac 验收证据。
- R4-2 的覆盖、退休两种备份均在临时 fixture 通过。R4-1 只验证重装/升级时同 ID 用户卡字节、修改时间不变；列卡、派活待网关。R1-18 只验证初装工作区内容及复制哈希，运行一轮后检查仍待网关。下一步：看板和三种截图。

## 2026-11-18 · 看板

- 每个子会话带 role / roleName / roleSource；老会话仍显示模式和模型。有派发快照名时优先用快照，没快照才从同来源目录找名字；看板时间线汇报也带角色名。运行环境接角色卡校验统计，原因可展开；目录读不到会标「暂时读不到」，不伪报零张。
- 交接给窗口 1：看板默认调用 metre-roles.mjs 导出的 loadRoles()，期望结果 roles（卡对象数组或 Map，卡有 id/name/source）、invalid（不合格项数组，包含 file 或 filename、reason 或 error、source）。可选 validCount 指明合格张数；如窗口 1 的读卡需要依赖，可在 registerMetreBoard 的参数传入同口径 metreRoleCatalog 回调。血缘/排队记录可写 metreRoleName 来保留派发时的名称。实际读卡接线、侧栏角色名、汇报卡和 pinkie_session_list 仍待窗口 1 的代码；本车道不改 index.mjs、session-lineage.mjs 或共用旧模式注入。
- \`node --test tests/metre-board.test.mjs tests/metre-skin-cat.test.cjs\`：31/31；Node 语法和 \`git diff --check\` 通过。新增 CSS 用既有 --metre-*，\`git diff -U0 -- ui/injections/laolao-metre-board.css\` 的新增行无十六进制或 rgb/hsl 颜色。
- \`ref/board-fixture.html\` 调用真实页面骨架及数据渲染，假 RPC，不连网关；打开时带 \`?session=agent:metre:main&theme=light\`（深色用 dark）。Chrome headless 用 \`--force-device-scale-factor=1 --virtual-time-budget=1500\`，\`--dump-dom\` 检查 data-fixture="passed" 和布局类；分别用 \`--window-size=1360,1120\`（两种主题）和 \`--window-size=700,1440\` 截图。三张 PNG 均目检：角色名与模型、自定义标记、合格/不合格数量和展开原因在同一画面内。
- 下一步：移植并校对旧草稿、验收表收尾。

## 2026-11-18 · 文档

- 先读取 F:/Projects/_saved/metre-mode-uncommitted-1118 的两份旧稿，再用 git ls-tree 对照远端基线 9dba1a4c：远端没有这两个同名路径，只有 Metre 原计划及过程文档。移入有用的身份、派发、总控台、资源关停和用户可感知的更新说明，修正旧稿「子会话总要写 mode」和「看板只靠事件刷新」；实际已实施的安装/看板与待其他窗口合入的派活接口在文档中分开。
- 三处：docs/METRE-MODE.md 新增「角色」；personas/README.md 登记独立的 roles agent、卡目录和单向复制；briefs/metre-mode-1113/RELEASE-NOTES-DRAFT.md 更新说明（保留版本号占位，未改正式发布稿）。
- R4-5 抽核五处：① 本机覆盖前备份（metre_role_assets.py:61–69）；② 官方退役挪进备份、用户/草稿不进入（同文件 80–101）；③ 工作区打法和视觉规范及空占位（同文件 104–129；实测仓库 31 个 playbook 的 SHA-256 逐一一致、视觉规范字节相同、7 空占位、无 memory/、重跑不改）；④ 非用户模式（app/super_pinkie.py 的 MODE_AGENTS 没有 roles）；⑤ 看板自定义、合格/不合格及原因（laolao-metre-board-data.js:96–100、223–240；Chrome fixture 通过）。
- 用 app/release_notes.py 给更新稿临时填当前版本号、在内存跑 lint，通过；未改版本号或已发布文件。

## 2026-11-18 · 车道自查（最终）

| 条目 | 结果 | 证据或原因 |
|---|---|---|
| R1-16 | 没测 | 静态确认未把 roles 加入模式枚举；真实模式切换、侧栏筛选和角色子会话显示需其他车道的血缘接线及网关，未拍真实侧栏截图。 |
| R1-18 | 没测 | 磁盘子项已过：真实源的 31 个 playbook、视觉规范一致，7 个空占位、无 memory/；未跑一轮，不能确认运行后不会新增文件。 |
| R1-27 | 过 | 本车道的仿真检查：看板 RPC 单测、Chrome 假数据浅色/深色/700px 三张图、角色名和模型/自定义标识/统计与原因均可见，无新增 CSS 色值。真实读卡接线未测。 |
| R4-1 | 没测 | 重装和更新 fixture 的同 ID 用户卡字节及 mtime 一致；pinkie_roles 能否列出、派活仍待网关。 |
| R4-2 | 过 | Windows 安装入口的临时 fixture 中，临时旧内容已入 backups，退役卡字节相同且离开官方目录；重装不产生重复备份。 |
| R4-4 | 没测 | 未打包、未测 Windows 真机新装及上一版升级，也未在 Mac 跑包内快照；Windows 上跑的是源代码安装/导入检查，不替代平台验收。 |
| R4-5 | 过 | 已改三份文档，五处核对见文档段落；发布说明草稿格式检查通过。 |

- 收工复查：正式 openclaw.json（2026-11-14T07:50:37.9293033Z）、正式 App 安装目录（2026-11-03T22:57:22.1522954Z）、App 状态目录（2026-11-15T11:20:15.9964807Z）修改时间与前次只读记录相同，18789 仍没有监听 PID。没跑真网关、没建运行时隔离副本、没打包、没有改五个旧模式的人设/手册/注入/工具。
- 最后离线回归：Metre Node 测试加 guard-startup/self-contained-app 共 102/102；Windows persona 安装 19/19、persona bundle 3/3；git diff --check 通过。
- 全量 Node gate（不带 --update）未跑完：四个学习浏览器测试长时间没有退出（learning-desk、learning-notes-menu、study-builtin-model-ui、study-desk-chat-entry，仓库 known-failures 已列各自超时），本次停止自己的测试进程，**不记 Z1 通过**。未改 known-failures.json。单跑 windows-self-contained 遇到快照条目只有 18，既有测试要求至少 30；确认该测试及 SHA256SUMS 相对基线未变，9dba1a4c 同样 18 条。Mac mock 脚本改用 UTF-8 复查后，8 条里 6 处旧断言还只认项目/学习，与基线 9dba1a4c 在同一 fixture 重跑的失败集合完全相同。
- 下一步：等窗口 1 的读卡/血缘/agent 配置和其他车道的官方卡合入后，按上面的看板接口验证真实接线，再补 Windows/Mac 完整验收。本车道不合并上游分支。
