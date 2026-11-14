# Windows 开工提示词（整段复制给 Windows 上的 Claude）

你在 Windows 电脑上接手「碧琪」（Super Pinkie，基于 OpenClaw 的桌面助手 App，Mac 和 Windows 共用一个仓库）的新功能 **Metre 模式**。方案和主 MD 已由 Fable 5.2 写好并推到 origin，代码一行还没动。Mac 端额度用完了，现在由你从头开始实现。

## 第一步：拿代码

主工作区如果停在别的分支上、带着没提交的改动，不要动它，另开一个工作树：

```bash
git fetch origin
```

```bash
git worktree add ../metre-mode feat/metre-mode-1113
```

## 第二步：按顺序读（都在 `briefs/metre-mode-1113/` 下）

1. `PROGRESS.md`：接力棒和用户已经定的事。
2. `PROMPT.md`：接手的硬规矩。
3. `WINDOWS-PROMPT.md`：Windows 端和 Mac 不同的地方（隔离副本怎么搭、哪些只有 Mac 能验）。
4. `PLAN.md`：需求、设计、8 批怎么分。
5. `personas/metre/AGENTS.md`：主 MD。实现要让它里面写的每一件事都成立。
6. `ACCEPTANCE.md`：每一批怎样算过。

## 第三步：开工

Mac 端暂时不会动这个分支，所有批都归你，按这个顺序做：**批 0 → 批 3 → 批 1 → 批 2 → 批 4 → 批 5 → 批 6**。批 7 里只做 Windows 那一半。

每一批：先在 `PROGRESS.md` 的接力棒里登记并推送，再写测试、实现、跑全量测试、在隔离副本里实际走一遍验收项，把逐条结果和量到的数字写回 `PROGRESS.md`，提交并推送。做完一批再开下一批。

## 几条最要紧的（细则在 `PROMPT.md`）

- 测试只在你自己搭的隔离副本里做，不碰已安装的超級碧琪、18789 端口上的网关和正式的状态目录。
- 五个老模式（唠嗑、项目、想法、学习、无限制）的行为一个字都不能变，新行为全部按「是不是 Metre」分支。
- `personas/` 下除 `personas/metre/` 以外的文件不许改。`personas/metre/*.md` 只有当你自己是 Fable 5.2 时才能改；不是的话，发现 MD 和实现对不上就记进 `PROGRESS.md` 的「给 Fable」一栏。
- Metre 的权限是用户定的「全部没有限制」：不要自作主张加确认弹窗或拦截。
- 黑猫：参考图是 `briefs/metre-mode-1113/ref/cle-cat.png`。你是 Fable 5.2 的话，到批 4 时按 PLAN 2.11 画出逐帧稿、做好本地预览页，然后停下来把截图给用户看，用户点头才接进去。不是 Fable 5.2 的话只用占位图标，在 `PROGRESS.md` 里记「黑猫待 Fable 画」。
- 每次提交都立刻 `git push origin feat/metre-mode-1113`。不合并到 `main`，不打标签，不发布。
- 不用子代理。实测一批跑完，不要一题一题地等。
- 没跑的测试写「没测」和原因，不许写成过。
- 上下文用到一半左右、后面还有不少活时，更新 `PROGRESS.md` 并推送，然后告诉用户开一个新会话接着做。

## 每做完一批对用户说

用平常的话：这批做成了什么、怎么验的、哪些没过或没测、下一批是什么。
