# 接手提示词（Mac、Windows 通用，整段复制给新会话）

你接手「碧琪」（Super Pinkie，基于 OpenClaw 的桌面助手 App，Mac 和 Windows 共用一个仓库）的一个新功能：**Metre 模式**。方案和主 MD 由 Fable 5.2 定好，你负责实现和自查，Fable 最后验收。这件事分 8 批，可能由 Mac 端和 Windows 端的会话轮流做，靠仓库里的 `PROGRESS.md` 交接。

Windows 端另外要读 `WINDOWS-PROMPT.md`，和本文件冲突的地方以它为准。

## 一、拿代码

```bash
git fetch origin
```

```bash
git worktree add ../metre-mode feat/metre-mode-1113
```

已经有这个工作树就进去 `git pull --rebase`。主工作区里别的分支和没提交的改动不要动。

## 二、按顺序读

1. `briefs/metre-mode-1113/PROGRESS.md`：现在做到哪、接力棒在谁手里、上一位留了什么话。**从这里决定你做哪一批。**
2. `briefs/metre-mode-1113/PLAN.md`：需求、设计、分批。
3. `personas/metre/AGENTS.md`：主 MD。实现要让它里面说的每一件事都成立（工具名、参数、【本轮：派发】这样的标记）。
4. `briefs/metre-mode-1113/ACCEPTANCE.md`：你这一批怎样算过。

只读你这一批用得到的代码。`services/mode-architecture/index.mjs` 有 7600 行，用搜索定位，不要整个读。

## 三、硬规矩

1. **测试只在隔离副本里做。** 不碰正式的 App、18789 端口上的网关、正式的状态目录。开工先记下验收 Z2 的三样，收工再对。
2. **不许改的文件**：`personas/` 下除 `personas/metre/` 以外的一切；破甲相关的文档不读不改。`personas/metre/*.md` 只有当你自己就是 Fable 5.2 时才能改；不是的话，发现 MD 和实现对不上，记进 `PROGRESS.md` 的「给 Fable」一栏，不要自己改 MD，也不要为了迁就而改设计。
3. **老模式一个字的行为都不变。** 新行为全部按「是不是 Metre」分支。老模式的测试不改。
4. **门禁、谨慎规则、续跑上限不简化。** 关注入时拿不准的一律留，记下来等 Fable 定。
5. **黑猫的美术**：没有用户点头的记录之前，只用占位图标。
6. **提交就推送。** 每完成一小步就提交并 `git push origin feat/metre-mode-1113`；推之前 `git pull --rebase`。不合并到 `main`，不打标签，不发布。
7. **不用子代理**，除非用户在对话里明说。实测一批跑完，不要一题一题地等。
8. **如实记录。** 没跑的测试写「没测」和原因；失败的贴出失败的输出。
9. 上下文用到一半左右、后面还有不少活时，更新 `PROGRESS.md`、推送，然后请用户开一个新会话接着做，不要硬撑。

## 四、每一批的做法

1. 在 `PROGRESS.md` 的接力棒里写上：你是哪一端、做哪一批、开始时间。提交并推送（让另一端知道这批有人了）。
2. 先写或补测试，再实现。测试放 `tests/`，和现有的同名风格一致（`*.test.mjs` / `*.test.cjs`）。
3. 跑相关测试，再跑全量：`node tools/release-gate/run-tests.mjs`。
4. 在隔离副本里实际走一遍这批的验收项。界面类的要截图自己看，不要只看代码。
5. 把验收逐条的结果、量到的数字、遗留问题写进 `PROGRESS.md`，接力棒改成「空闲」，提交并推送。

## 五、做完一批之后对用户说什么

用平常的话：这批做成了什么、你怎么验的、哪些没过或没测、下一批是什么。不要贴大段日志。
