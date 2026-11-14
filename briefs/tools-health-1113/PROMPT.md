# 给执行模型的提示词（整段复制过去）

你要接手「碧琪」（Super Pinkie，一个基于 OpenClaw 的桌面助手 App）的一轮工具整改。方案已经定好，你负责实现和自查。

## 先读这三个文件

1. `/Users/Admin/release-superpinkie/briefs/tools-health-1113/PLAN.md`：问题、根因、要做的事、写好的文字。
2. `/Users/Admin/release-superpinkie/briefs/tools-health-1113/ACCEPTANCE.md`：每一项怎样算过。
3. `/Users/Admin/release-superpinkie/briefs/COORDINATION.md` 最后几节：现在谁在改什么。

## 开工步骤

```bash
cd /Users/Admin/release-superpinkie/repo
git fetch origin
git worktree add ../wt/tools-health -b fix/tools-health-1113 origin/install/all-1113-live
cd ../wt/tools-health
```

然后在 `briefs/tools-health-1113/PROGRESS.md` 开一个进度文件，在 `briefs/COORDINATION.md` 末尾加一节，写明你用的工作区、分支、会改哪些文件。

开工前记下三样东西，收工时再对一遍（验收 Z2）：`~/.openclaw/openclaw.json` 的修改时间、`/Applications/超級碧琪.app` 的修改时间、`openclaw-gateway` 的进程号。

## 顺序

A 组 → B 组 → C 组 → D 组。每组做完，跑那一组的验收，结果填进 `PROGRESS.md`，再做下一组。每一项单独提交，提交后立刻 `git push origin fix/tools-health-1113`。

A1 先在隔离副本里复现确认原因，再动手；原因和方案里写的不一样，就把真实原因记下来，按真实原因修。

## 硬规矩

1. **只在隔离副本里测**：`/Users/Admin/release-superpinkie/tools/work-first-eval/isolated`（有自己的端口和状态目录）。不碰正式 App、18789 端口、`~/.openclaw` 下的任何文件。读正式环境的会话记录做统计可以，只读。
2. **不新增 OpenClaw 配置键**。运行时不认的键会让网关起不来，出过事故。要新行为，用已有的键或者写补丁。
3. **不改这些文件**：`personas/**/*.md`、`persona/*.md`、playbooks、破甲相关文档。需要新文字时，先看 `PLAN.md` 第五节有没有写好的；没有就列进 `PROGRESS.md` 的「待 Fable 写」。
4. **系统提示词一个字都不许删、不许改、不许缩写**，包括技能列表、打法、规矩、门禁、续跑上限。B3 只做字数拆账。B2 往里**加**一段按需工具清单不算违反。
5. **不做沙箱和权限分级**，用户明确不要。
6. 不合 `main`、不打 tag、不发版、不往正式 App 里装。
7. 不动 `repo/` 主工作区（它停在别的分支上，有未提交的改动）。
8. 补丁要接进 `patch/apply-all.mjs` 并通过 `patches-wired` 测试；改了运行时补丁要跑 `refresh_mac_runtime.py --check`。
9. 不开子代理，不另开会话，除非用户让你开。
10. 实测一批跑完再看：`--repeat 2`，并发 8，一批一次汇报。
11. 用户能看到的界面文字用碧琪的口吻，参照仓库里三份「我→碧琪」规则。
12. 不要让用户去跑脚本。

## 遇到这些情况就停下来写进 PROGRESS.md

- B2 的按会话改工具列表，插件钩子做不到。停在 B1，不要改运行时的核心发送逻辑。
- 要删的工具或提示词段落，有别的代码或文档在依赖。
- 隔离副本报 400、鉴权失败、连接断开：它和正式 App 共用上游账号，多半是上游的事，等一会儿重跑，不要改代码去迁就。
- 任何一步需要动用户的真实数据（比如正式环境的记忆库）。这一轮只在隔离副本里用假库验证，正式环境的迁移留到安装时做，并且要先备份。

## 收工时交什么

`PROGRESS.md` 里要有：

1. `ACCEPTANCE.md` 每一条的结果（过 / 没过 / 没测），附证据：命令输出、会话记录位置、截图路径。
2. 体检脚本改前改后的两份数字。
3. 没做完的、做不到的、和方案不一样的地方，各写一句原因。
4. 「待 Fable 写」的文字清单。
5. 分支最后一个提交号，确认已推到 origin。

没通过的项照实写，不要为了让数字好看去改题目或改统计口径。
