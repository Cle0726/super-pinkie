# C.le. 内核接管 · 接力记录

先读 `briefs/program-1120/CONCURRENCY.md`，再读 `PLAN.md` 第九节「接手规矩」和第四节「和维护计划的关系」。

- 本文件只放总表和全局的决定。每一批的详细记录写在 `progress/<批号>.md`，最上面放接力卡（格式见 `CONCURRENCY.md` 第〇节），边做边更新、边推送。
- 总表只改自己那一行，并且只在自己这一批的 PR 里改。

| 批 | 状态 | 谁在做 | 更新日期 | 分支 / PR |
|---|---|---|---|---|
| K0 摸底 | 已合并（本 PR 进入 main 后生效） | Gemini-Win-9c2a（接手 Codex-Win-4d8c） | 2026-11-21 | [PR #41](https://github.com/Cle0726/super-pinkie/pull/41) |
| K1 建内核仓库 | 已合并（本 PR 进入 main 后生效） | Gemini-Win-9c2a | 2026-11-21 | [PR #50](https://github.com/Cle0726/super-pinkie/pull/50) |
| K2 换成自己编译的内核 | 未开始（要等维护计划 M0、M5 合进主线） | | | |
| K3 补丁搬进源码 | 进行中（第 3/34 个，「易」档完成：apply-same-session-recovery db2e27bb、apply-loopback-model-reliability f218c65b、apply-work-thinking 90c8b6ab 已在 cle-core 本机提交；12-01 前 cle-core 不推送，见 progress/K3.md） | Claude Code（m4 线，Windows） | 2026-11-24 | 分支 core/k3-patches |
| K4 显示名字改为 C.le. | 进行中（草稿 PR；用户可见处 84 处已改，24 处因文件被 #54/#67/#74 占用延后，见 progress/K4.md） | Claude-Win-r7m3（Windows） | 2026-11-24 | [PR #77](https://github.com/Cle0726/super-pinkie/pull/77) |
| K5 正式切换 | 未开始（发版要用户点头） | | | |
| K6 界面搬进源码 | 未开始（要等维护计划 M3 收窄版完成） | | | |
| K7 DeepSeek Harness 插件兼容 | 未开始（要等 K5） | | | |

## 用户的决定

- 2026-11-20：想要自己的 harness，不想一直挂靠别人的产品；尽量沿用 OpenClaw 的现有结构，不推倒重来。
- 2026-11-20：内核开新仓库，因为现在的碧琪还有用户在用。
- 2026-11-20：用户原话「还有新开仓库哦不要在碧琪做因为碧琪可能还需要不停更新给用户使用但是Cle框架也要同步的」。K1 新建私有仓库 `cle-core` 已获同意；碧琪照常更新，C.le. 跟着同步。
- 2026-11-20：用户原话「他们做完不会自己合吗？难道每次都问你？」。自查通过、满足 `briefs/program-1120/CONCURRENCY.md` 4.3 的 PR，由 AI 自己合并，不用再问。
- 2026-11-20：内核对用户显示的名字是「C.le.」（没用 Meter，因为它和 Metre 模式太像）。技术名字由执行者定为 `cle-core`。
- 2026-11-20：最怕换了以后界面不适配；DeepSeek Harness 不做底座，只是以后要能兼容它的插件。
- 2026-11-21：用户询问「建好不用转到新仓库吗？」并明确指示原话：「先主要在Windiws完成所有工作」。K0 的 Mac 源码编译在 `Cle0726/cle-core` 的 GitHub Actions `macos-latest` 完成验证并合并 K0（#41），K1 将 `v2026.7.1-2` 基准源码转入 `Cle0726/cle-core` 并完成三平台编译测试与 `cle-core-v2026.7.1-2-c.1` 发布。

## 执行者的决定

（计划没有写到、由执行者自己决定的细节，写在这里：日期、决定、理由。）
