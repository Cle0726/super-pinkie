# 给 Windows 端 Claude 的提示词（整段复制过去）

你在 Windows 电脑上接手「碧琪」（Super Pinkie，基于 OpenClaw 的桌面助手 App，Mac 和 Windows 两端共用一个仓库）的一轮**工具整改**。方案由 Fable 定好，你负责实现和自查，Fable 最后验收。

方案原本是写给 Mac 端执行者的，里面的 Mac 路径、Mac 隔离副本、Mac 正式 App 你那边都没有。**凡是和下面「Windows 端改动」冲突的地方，以本文件为准。** 其他内容（要做什么、做到什么程度、Fable 写好的原文）一律照方案。

## 一、拿代码

```bash
git fetch origin
git switch fix/tools-health-1113      # 已在 origin 上，基于 origin/main（v2.5.49，5ff2aad2，已包含 install/all-1113-live）
git pull --ff-only
```

如果你的主工作区有别的分支和未提交改动（比如 `dev/study-game`），**不要切走它**，另开一个工作树：

```bash
git worktree add ../tools-health fix/tools-health-1113
```

## 二、先读这些文件（都在仓库里）

1. `briefs/tools-health-1113/PLAN.md`：问题、根因、要做的事、Fable 写好的文字（第五节，原样用）。
2. `briefs/tools-health-1113/ACCEPTANCE.md`：每一项怎样算过。
3. `briefs/tools-health-1113/PROMPT.md`：给 Mac 执行者的原版规矩。硬规矩全部适用，只有路径和测试环境按本文件改。
4. `tools/tool-health/`：体检脚本 `session-stats.py`、Mac 正式环境的基线 `baseline-1113.json`、`iso-reference-mac/`（Mac 端隔离副本的三个脚本，仅供参照）。

## 三、Windows 端改动（覆盖原方案里对应的说法）

### 1. 隔离副本：你自己搭一个

Mac 的 `tools/work-first-eval/isolated` 在仓库外，你那边没有。照 `tools/tool-health/iso-reference-mac/` 的思路在 Windows 上搭一个：

- 放在仓库外，例如 `%USERPROFILE%\碧琪实测\iso-th\`，状态目录、配置、工作区、日志、临时目录全在它下面。
- 网关用自己的端口（随机空闲端口，**不能是 18789**），只绑 `127.0.0.1`，自己的令牌。环境变量参照 `tools/windows-smoke/smoke.py` 的 `profile_env`（`PINKIE_STATE_ROOT`、`OPENCLAW_CONFIG_PATH`、`OPENCLAW_ROOT` 等）。
- 运行时从仓库产物或已装 App 的运行时目录**复制一份**再用，不在 App 安装目录里直接跑。
- 真实模型配置可以从正式配置**只读复制**过来；密钥只复制、不打印、不写进仓库、不写进 `PROGRESS.md`。
- 搭好后把搭建脚本提交到 `tools/tool-health/iso-windows/`（脚本里不能有密钥），写清用法。
- 隔离副本和正式 App 共用上游账号：报 400、鉴权失败、连接断开，多半是上游的事，等一会儿重跑，不要改代码迁就。

### 2. 正式环境一律不碰

原方案里的「`~/.openclaw`、`/Applications/超級碧琪.app`、18789」在你那边换成：Windows 上已安装的超級碧琪（安装目录 / 便携版目录）、它的状态目录（`%USERPROFILE%\.openclaw` 或 `PINKIE_STATE_ROOT` 指向的地方，先查清楚）、18789 端口上的网关。

- 开工前记下三样（验收 Z2）：正式 `openclaw.json` 的修改时间、App 安装目录的修改时间、18789 上网关的进程号。收工时再对一遍，写进 `PROGRESS.md`。
- 读正式会话记录做统计可以，只读：`python tools/tool-health/session-stats.py --state <正式状态目录> --json win-live-baseline.json`。这份 Windows 基线**不提交**（可能含用户信息），只把数字抄进 `PROGRESS.md`。
- 不往正式 App 里装任何东西，不重启它。

### 3. 测试题目里的 Mac 路径换成 Windows 的

- 题 3 的 `/tmp/th-test/` 换成 `%TEMP%\th-test\`。
- A4-2 仍要拒绝的目录，Mac 那几个保留（代码两端共用），再加 Windows 的对应位置：`%USERPROFILE%\.ssh`、正式状态目录下的 `credentials`、设定防护的私钥目录（先在代码里查 Windows 版放在哪）、Windows 凭据管理器相关路径。单元测试两套都要有。
- A2 的备份目录放在**隔离副本**状态目录下的 `backups\agent-db-<日期>\<模式>\`。假的「结构版本 19」库自己造，不拿用户的真库。
- A4 的 PDF 抽页用 App 自带的 Python；Windows 包里的 Python 在哪先查清楚，两端都要能跑。

### 4. 只有 Mac 才能验的项

- **A6-2（Mac 上的 `tab`）**：代码照做，写单元测试；真机实测记「没测（需 Mac 端）」。
- **运行时补丁**：`refresh_mac_runtime.py --check` 要读 Mac 上装好的 App，你那边跑不了。做法：
  1. 补丁照常写在 `patch/`，接进 `patch/apply-all.mjs`，过 `tests/patches-wired.test.mjs`；
  2. Windows 包用的是 `desktop/windows/mac-runtime/` 快照，同一处改动要同步到快照里对应的打包文件，并写一条测试证明快照里也生效；
  3. `PROGRESS.md` 里记「`refresh_mac_runtime.py --check` 待 Mac 端跑」，不要写成过。
- 方案里提到的 Mac 正式环境数据（60 个会话、库文件大小等）是 Fable 在 Mac 上量的，你不用复查；A7 的出错分类用你隔离副本和 Windows 正式环境（只读）的数据做，写明数据来自哪台机器。

### 5. 全量测试对照

验收 Z1 的对照基线换成 `origin/main`（`5ff2aad2`）：同一台 Windows 上，基线和你的分支各跑一遍 Node 和 Python 全量测试，只比较**新增**失败。Windows 上本来就红的那些照旧记下，不算你的。

### 6. 协作记录

- 进度写 `briefs/tools-health-1113/PROGRESS.md`（新建）。
- 在仓库的 `briefs/COORDINATION.md` 末尾加一节：Windows 端、分支 `fix/tools-health-1113`、工作树位置、会改哪些文件。
- Mac 端这期间可能也在 `services/mode-architecture/` 上改别的分支，你只动方案里列的文件。

## 四、顺序

A 组 → B 组 → C 组 → D 组。每组做完，跑那一组的验收，结果填进 `PROGRESS.md`，再做下一组。

**每一项单独提交，提交后立刻 `git push origin fix/tools-health-1113`。** 两台电脑在合作，不推送对面就看不到。

A1 先在隔离副本里复现确认原因再动手。Windows 那边的代理不一定是假地址模式，复现不出来就照实写，并用单元测试证明 `2001:2::/48` 在开关为真时放行、其他内网段仍被拦。

## 五、硬规矩（和原版一样，重复一遍）

1. 只在隔离副本里测，正式环境只读。
2. **不新增 OpenClaw 配置键**。运行时不认的键会让网关起不来（2.5.36 出过事故）。
3. **不改** `personas/**/*.md`、`persona/*.md`、playbooks、破甲相关文档。需要新文字先看 `PLAN.md` 第五节，没有就列进 `PROGRESS.md` 的「待 Fable 写」。
4. **系统提示词一个字都不许删、不许改、不许缩写**（技能列表、打法、规矩、门禁、续跑上限都算）。B3 只拆账。B2 往里**加**按需工具清单不算违反。
5. 不做沙箱和权限分级。
6. 不合 `main`、不打 tag、不发版、不装进正式 App；不动 `dev/study-game`。
7. 补丁接进 `apply-all.mjs` 并过 `patches-wired`。
8. 不开子代理，不另开会话，除非用户让你开。
9. 实测一批跑完再看：`--repeat 2`，并发 8，一批一次汇报。
10. 用户能看到的界面文字用碧琪的口吻，参照仓库里三份「我→碧琪」规则。
11. 不要让用户去跑脚本。
12. 上下文用到一半左右、后面还有大段活，就把进度、提交号、未完成项、验证方法写进 `briefs/tools-health-1113/HANDOFF-<n>.md`，推上去，换新会话接着做。

## 六、遇到这些就停下来，写进 PROGRESS.md

- B2 的按会话改工具列表，插件钩子做不到：停在 B1，不改运行时核心发送逻辑。
- 要删的工具或提示词段落有别的代码或文档在依赖。
- 任何一步需要动用户的真实数据。
- Windows 上做不了、只有 Mac 能验的：照做代码和测试，实测记「没测（需 Mac 端）」。

## 七、收工时交什么

`PROGRESS.md` 里要有：

1. `ACCEPTANCE.md` 每一条的结果（过 / 没过 / 没测），附证据：命令输出、会话记录位置、截图路径（截图放仓库外，可能含用户信息）。
2. 体检脚本改前改后的两份数字（隔离副本），以及 Windows 正式环境的只读基线数字。
3. 没做完的、做不到的、和方案不一样的地方，各写一句原因；「需 Mac 端」的单独列一张表。
4. 「待 Fable 写」的文字清单。
5. 分支最后一个提交号，确认已推到 origin。

没通过的照实写，不要为了让数字好看去改题目或改统计口径。
