# M1 · 远端分支清点

**这是开工快照，不是删除记录。** 此稿不创建存档、不删分支，B 类尚未合并。动手前重新读远端头、保护规则、未结 PR 和工作树使用情况，不使用快照盲删。

快照 UTC：2026-11-21T08:15:10+00:00；主线 `0fc9a318dcaf0caf97bc9a869a67e4641be79b15`。共 129 个分支（含 main），79 个非 main 分支头已可达，49 个未合并；归类 A=14、B=2、C=6、D=27。B 的两个名字只对应一个分支头。

## 口径与复查

- 只统计快照时 `git ls-remote --heads origin` 返回的远端分支。`git fetch origin` 后校验本机对象与快照 SHA 相同。「未合并」指分支头不是 `main` 的祖先，不表示补丁都还没交付。
- `git rev-list --left-right --count <main>...<head>` 的独有提交数含合并。`git cherry <main> <head>` 的 `+` 是未发现等价补丁、`-` 是找到等价补丁，不计合并提交。`git diff --name-status --no-renames <main>...<head>` 列涉及路径；再逐路径比两端 blob 和 Git mode（含增删），得到当前不同的路径数。
- A：补丁等价，或实际触及内容都在主线；B：应合进主线；C：旧实现已由主线取代；D：活跃或保留待确认。D 不表示猜测还在做，依据不足就保留。D 的旧提交作者为仓库维护者 Cle0726，不能从作者字段推断当前负责人；有实际认领的单独标注。
- 计划点名的分支逐条看提交内容。已可达的旧分支不在以下未合并表中；[#40](https://github.com/Cle0726/super-pinkie/pull/40) 已合并且本次不动其远端分支。

## 所有未合并远端分支

| 分支 | 快照头 | 落后 / 独有 | cherry + / − | 涉及 / 与主线不同 | 类别 | 依据与处理 |
|---|---|---:|---:|---:|:---:|---|
| `audit/pinkie-1112` | `f33c4186dc69` | 343 / 4 | 4 / 0 | 165 / 165 | B | 学习台游戏 v4 的四条提交：`0d5e410e`、`8f889550`、`f5f487a1`、`f33c4186`。单开 PR；试合唯一冲突在头部清单。 |
| `claude/tools-health-1113-a3-03a2ac` | `dcdf8baac1c3` | 293 / 10 | 10 / 0 | 37 / 37 | D | A3 头 `dcdf8baa` 已在 `fix/tools-health-1113`，部分实现尚不在主线；与父分支一起保留。 |
| `claude/tools-health-1113-a4-7640b6` | `128cfbc554fe` | 293 / 10 | 10 / 0 | 35 / 35 | D | A4 头 `128cfbc5` 已在 `fix/tools-health-1113`，但旧运行时快照和媒体入口不能整条移植；保留。 |
| `core/k0-baseline` | `3b49a89c1690` | 6 / 15 | 15 / 0 | 4 / 4 | D | [K0 #41](https://github.com/Cle0726/super-pinkie/pull/41) 在做；不碰。 |
| `dev/study-game` | `3f56135f9849` | 682 / 8 | 6 / 2 | 36 / 24 | D | 独有提交实际是头像、通知、会话追加/自动重试、进度卡，不是游戏 v4；24 个触及路径仍不同，不能只凭分支名处理。 |
| `diagnose/legacy-2.5.50` | `b6929b7e8a08` | 21 / 1 | 1 / 0 | 2 / 2 | D | 旧版 Windows 候选包的诊断；计划明确保留诊断分支。 |
| `diagnose/macos-activation` | `a51b6a5d08d1` | 17 / 3 | 3 / 0 | 3 / 3 | D | Mac 成品 WebKit 激活的隔离诊断；保留。 |
| `diagnose/macos-auth-preparation` | `7f319de881f6` | 15 / 1 | 1 / 0 | 2 / 2 | D | Mac 原生 WebKit 身份启动诊断；保留。 |
| `feat/metre-roles-1118-1` | `a6d2d9989b2b` | 222 / 7 | 7 / 0 | 19 / 16 | C | Metre 角色执行路径由 [#29](https://github.com/Cle0726/super-pinkie/pull/29) 整体取代；当前有 `metre-roles.mjs` 和角色测试。早期测量记录留在档案。 |
| `feat/metre-roles-1118-2` | `5544f045fa2e` | 222 / 5 | 5 / 0 | 32 / 0 | A | 32 个触及路径的 blob 和模式均与主线相同；[#29](https://github.com/Cle0726/super-pinkie/pull/29) 落地角色卡与样例。 |
| `feat/metre-roles-1118-3` | `aebb3aaf9a94` | 222 / 7 | 7 / 0 | 37 / 4 | C | 37 路径中 33 个完全相同；其余两张角色卡及各自样例已按 [#29](https://github.com/Cle0726/super-pinkie/pull/29) 后的主线版本处理。 |
| `feat/metre-roles-1118-4` | `882e5ce27095` | 222 / 5 | 5 / 0 | 24 / 18 | C | 角色包安装、看板接入由 [#29](https://github.com/Cle0726/super-pinkie/pull/29) 候选及后续主线取代；不回滚到旧支截图和发布说明。 |
| `feat/study-desk-drill` | `f2882820c2f1` | 766 / 4 | 3 / 1 | 17 / 10 | D | 三条独有补丁是头像、系统通知、会话追加，不是 v4；尚未证明全部被取代。 |
| `feat/windows-browser-pointer-autonode` | `3ccfbfa5dc2c` | 664 / 2 | 2 / 0 | 8 / 4 | C | 需求已由 [#20](https://github.com/Cle0726/super-pinkie/pull/20)（主线 `34bfff41`）交付；端点测试完全相同，浏览器实现和打包快照已有更新。 |
| `feat/windows-inapp-browser-vpn` | `1d6433cf661b` | 670 / 6 | 1 / 5 | 18 / 10 | C | 主实现经 [#17](https://github.com/Cle0726/super-pinkie/pull/17)（`675c7055`）落地；唯一 `+` 是节点切换，随后由 [#20](https://github.com/Cle0726/super-pinkie/pull/20) 落地。 |
| `fix/real-thinking-only` | `728e5ca93112` | 293 / 10 | 10 / 0 | 18 / 11 | C | 真实思考的播放/收折、分段、历史卡测试在主线通过；模型改用新配置、资源按当前缓存键。详见下文。 |
| `fix/state-root-sandbox` | `2a609d33738b` | 1149 / 14 | 0 / 14 | 27 / 24 | A | 14 张补丁均等价；[#2](https://github.com/Cle0726/super-pinkie/pull/2) 已合并。 |
| `fix/tools-health-1113` | `f7deff4721f1` | 293 / 52 | 50 / 0 | 83 / 83 | D | 50 个非合并提交加两次整合，混有评测、交付和未移植改动；B1-2 明确交给 Mac，不能整枝合并或删除。详见下文。 |
| `fix/uninstall-proxy-filter` | `13f163895813` | 1149 / 16 | 0 / 16 | 27 / 24 | A | [#4](https://github.com/Cle0726/super-pinkie/pull/4) 已关闭；不是按 PR 状态认定，16 张补丁全部在主线有等价。 |
| `fix/update-download-resume` | `7868ea76131b` | 1149 / 17 | 0 / 17 | 27 / 24 | A | 17 张补丁都等价；[#6](https://github.com/Cle0726/super-pinkie/pull/6) 已合并。 |
| `fix/update-suite-state-isolation` | `4b2605065807` | 1149 / 17 | 0 / 17 | 27 / 24 | A | 17 张补丁都等价；[#5](https://github.com/Cle0726/super-pinkie/pull/5) 已合并。 |
| `fix/updater-download-integrity` | `b78976409c78` | 1149 / 13 | 0 / 13 | 22 / 20 | A | 13 张补丁都等价；[#1](https://github.com/Cle0726/super-pinkie/pull/1) 已合并。 |
| `fix/windows-2.5.46-study-game` | `6d3662db4d52` | 599 / 5 | 3 / 1 | 2090 / 298 | D | 与 `release/study-game` 同头 `6d3662db`，是 2.5.46 发行快照，不是 v4；保留。 |
| `fix/windows-learning-worker-1119` | `67135e69a8d7` | 88 / 1 | 1 / 0 | 2 / 0 | A | 虽是 `+`，实际只改提取器和 Windows worker 测试，两路径 blob 均相同；`069a7fc3` 已交付，实测通过。 |
| `install/all-1113-live` | `eff7d1969344` | 315 / 5 | 4 / 0 | 165 / 165 | D | 含四条 v4，和 `audit` 的 165 个触及路径只剩头部清单不同；旧安装上下文不作为 B 类再次合并。 |
| `integration/all-fixes` | `5ae10d81f397` | 1124 / 6 | 0 / 0 | 9 / 9 | D | `git cherry` 空不等于等价：6 个合并的第二父已在主线，但 `2a53bcda` 有一处独立冲突处理差异，先留。 |
| `maint/m1-branch-inventory` | `f35f230e1930` | 0 / 2 | 2 / 0 | 2 / 2 | D | 本批 [#42](https://github.com/Cle0726/super-pinkie/pull/42) 在做，不计入旧分支清理。 |
| `oc/brand` | `05c4ee0d27ce` | 1049 / 4 | 4 / 0 | 24 / 22 | D | 旧 C.le. 外观、模型分层和本地工作快照混合，22 个触及路径不同；不覆盖当前外观。 |
| `oc/legacy-chat` | `7d0d6bebaba7` | 1043 / 1 | 1 / 0 | 34 / 34 | D | 提交说明明确是待接手的旧聊天迁移；34 路径不同，保留。 |
| `oc/restyle` | `6bf766df955e` | 982 / 14 | 14 / 0 | 24 / 24 | D | 旧外观迁移，14 张补丁无等价，合并会改变界面；保留供对应工作判断。 |
| `oc/sidebar` | `e1ad513ef1af` | 993 / 5 | 1 / 4 | 22 / 9 | D | 唯一无等价补丁 `8473da28` 涉及旧侧栏模块注册；未证实等价。 |
| `refactor/one-state-root` | `c23661967b44` | 1149 / 14 | 0 / 14 | 27 / 24 | A | 14 张补丁均等价；[#3](https://github.com/Cle0726/super-pinkie/pull/3) 已合并。 |
| `release/study-game` | `6d3662db4d52` | 599 / 5 | 3 / 1 | 2090 / 298 | D | 与 `fix/windows-2.5.46-study-game` 同头；含旧发行和打包，不用它移植 v4。 |
| `repair/browser` | `d87b9b3f088f` | 893 / 7 | 6 / 0 | 5 / 5 | D | 原生验收壳与测试上下文，含独立合并；未证明旧工具可丢。 |
| `repair/companion` | `7dd8ebe375e3` | 971 / 2 | 0 / 2 | 5 / 5 | A | 2 张补丁均等价，且无独立合并。 |
| `repair/effects` | `bf500836894f` | 971 / 2 | 0 / 2 | 17 / 16 | A | 2 张补丁均等价，且无独立合并。 |
| `repair/fusion` | `cf8ddd0468fd` | 965 / 7 | 1 / 6 | 35 / 35 | D | `445f29e9` 旧插件接合与回退逻辑没有等价补丁；不能因为另外六条等价就删。 |
| `repair/layout` | `d4d63f95d9c1` | 971 / 4 | 0 / 4 | 15 / 13 | A | 4 张补丁均等价，且无独立合并。 |
| `repair/models` | `476b1110dd7b` | 971 / 6 | 0 / 6 | 27 / 26 | A | 6 张补丁均等价，且无独立合并。 |
| `repair/recovery` | `f8ed58f8b814` | 971 / 5 | 0 / 5 | 6 / 4 | A | 5 张补丁均等价，且无独立合并。 |
| `repair/startup` | `b171e3467aad` | 965 / 16 | 2 / 14 | 17 / 16 | D | `4919e519`、`fbdc31b6` 两个旧窗口标题/品牌改动未证明被替代；先保留。 |
| `repair/workbench-gaze` | `97460b6f2e91` | 903 / 1 | 0 / 1 | 7 / 7 | A | 1 张补丁有等价，且无独立合并。 |
| `test/desk-win-probe` | `d4faf4bd0095` | 867 / 1 | 1 / 0 | 4 / 2 | D | Windows runner 独立 PowerShell 测试探针；未证明已重复，保留。 |
| `unify/pinkie-1112` | `f33c4186dc69` | 343 / 4 | 4 / 0 | 165 / 165 | B | 和 `audit/pinkie-1112` 同对象、同四提交；只开一张 PR，不重复移植。 |
| `wip-snapshot-1111/feat/study-builtin-model-redesign` | `09bb36e507cd` | 695 / 1 | 1 / 0 | 4 / 4 | D | 未审、未安装的学习模式模型界面快照。 |
| `wip-snapshot-1111/feat/study-desk-drill` | `d9604be1eea6` | 766 / 1 | 1 / 0 | 18 / 14 | D | 未审、未安装的练习台工作树快照。 |
| `wip-snapshot-1111/feat/template-library` | `4b29f5e8bbab` | 688 / 1 | 1 / 0 | 42 / 42 | D | 未审、未安装的模板库快照，42 路径都不同。 |
| `wip-snapshot-1111/fix/windows-2.5.24` | `64fdae63a83b` | 797 / 1 | 1 / 0 | 6 / 6 | D | 未审、未安装的旧 Windows 修复快照。 |
| `wip-snapshot-1111/oc/brand` | `a53dda92a49b` | 1049 / 5 | 5 / 0 | 26 / 24 | D | 含 `oc/brand` 四条及一条未审现场快照。 |

### 容易误读的对照

- **学习台游戏 v4**：`audit/pinkie-1112` 与 `unify/pinkie-1112` 同头。`install/all-1113-live` 的第二父提交就是该头；逐路径比较其 165 个涉及路径，只有 `ui/injections/laolao-head.fragment.html` 还有 15 行新增 / 13 行删除，来自旧安装上下文的手写版本号及型号设置入口。`git merge-tree --write-tree --name-only <main> <audit头>` 的唯一冲突是同一头部清单；单独 B 类 PR 保留主线其他入口。
- **工具健康**：逐条看过 `fix/tools-health-1113` 的 50 个普通提交和 2 个合并。A1–A7 涉搜索、媒体、数据库保护、工具回执、原生浏览器和评测；B1–B3 涉工具入口与提示，B1-2 明确留给 Mac；C1–C2 涉独立调用提示；D1–D4 涉连接器、工作树、HTML 导出、PR 状态。主线 `e1a6295b` 已有回退搜索，`36e5eafe` 只取了 11-13 阻塞项，也有自己的图片和浏览器端点测试。`agent-db-guard.mjs`、`child-worktree.mjs`、`pr-status.mjs` 等仍不在主线，故不记成「已合」，也不拿旧快照覆盖当前产品。候选应与原任务确认 Mac 验证和现行产品行为。
- **真实思考**：十条工作的分组为禁止伪思路、模型推理配置、真实思考播放/折叠、样式与长内容、分段滚动、缓存键、历史卡。同一份 `tests/ui-real-thinking-only.test.mjs` 在主线 4/4 通过，覆盖真实流、伪思路、长文本、分段/历史卡；`5a2d9658`、`252ac423` 已改为按模型设置，`eeeaf671` 有主线缓存键。旧模型设置和旧打包文件不覆盖现行方案。
- **Windows 学习提取器**：`git diff <main> <worker头> -- services/mode-architecture/learning-materials-extract.mjs tests/learning-materials-windows-worker.test.mjs` 为空。同一 Windows worker 用例在主线实际通过（与真实思考一起 `node --test tests/learning-materials-windows-worker.test.mjs tests/ui-real-thinking-only.test.mjs` 共 5/5）。
- **合并提交的例外**：`integration/all-fixes` 每次合并的第二父都已在主线；`git show --remerge-diff --format= --name-only 2a53bcda` 仍列一处自定义冲突解决路径。先保留，不能只因为 `+` 是零就删；无合并提交且补丁全等价的 A 类没有这个问题。

## 实际存档和删除

尚未执行。实际删除需逐项记录原分支、完整旧头、远端存档标签、删除时间及验证方式；未核对的头不删除。

<details>
<summary>本表的完整分支头（用于重跑清点）</summary>

```text
f33c4186dc69249e6804a218a9850be4edca1128 audit/pinkie-1112
dcdf8baac1c3a8eb3bbbb2b920d2f071cf7006ee claude/tools-health-1113-a3-03a2ac
128cfbc554feba8e1e50c8aebf697c6d4a4ced41 claude/tools-health-1113-a4-7640b6
3b49a89c1690bdbbe9c4b1deda379b32c27165f4 core/k0-baseline
3f56135f98494aaec140f800bc5cbf30a04dae48 dev/study-game
b6929b7e8a082d0b567883b69b5b537e8f4d1669 diagnose/legacy-2.5.50
a51b6a5d08d1c2d4c98e8397a2ca8f051728f709 diagnose/macos-activation
7f319de881f6cf9ea0dc997b525137a5ac4898af diagnose/macos-auth-preparation
a6d2d9989b2b129ab916ae5c024b3391754e7b21 feat/metre-roles-1118-1
5544f045fa2e76f211ef08c85b7ee52d49b7d51a feat/metre-roles-1118-2
aebb3aaf9a942da8af1527f1892bbb652aafd1c1 feat/metre-roles-1118-3
882e5ce2709501d1f02db467d27d8e227dcd4384 feat/metre-roles-1118-4
f2882820c2f15fbc688b7d169b07fe7fd5302da0 feat/study-desk-drill
3ccfbfa5dc2c5744417330c6780b8b429061865c feat/windows-browser-pointer-autonode
1d6433cf661b3b9b66f999b3e4ad9086b7ebbda0 feat/windows-inapp-browser-vpn
728e5ca931126dbb750529bd3f25da265ad1968d fix/real-thinking-only
2a609d33738b18ab17b6b8b06c05c7943be49017 fix/state-root-sandbox
f7deff4721f1d448cac75f9ca580314fea588cc3 fix/tools-health-1113
13f163895813c2e1b82ea71929d55863eb6762c8 fix/uninstall-proxy-filter
7868ea76131b365b7bffdedb6d420f33616b0341 fix/update-download-resume
4b2605065807245d741eaffbcf37e8551daa1165 fix/update-suite-state-isolation
b78976409c788b9c40d063d75bd1873397f554d7 fix/updater-download-integrity
6d3662db4d527feefcc0ca3acea06cd52663570c fix/windows-2.5.46-study-game
67135e69a8d7a4a1a96bbb808266d07f27168627 fix/windows-learning-worker-1119
eff7d1969344f1f359e81b4c0a0f4c85652d423e install/all-1113-live
5ae10d81f397bb958978ac6ffce1f985646dc991 integration/all-fixes
f35f230e19301c2a0e27d0e746e8aa9c99155dfd maint/m1-branch-inventory
05c4ee0d27ce9f115b037ba019109613b518b1aa oc/brand
7d0d6bebaba73cc2eb1919fe2291386a1cf8250a oc/legacy-chat
6bf766df955ecaf8a3d7f0502bbb19faf06e9253 oc/restyle
e1ad513ef1af6536d5735038fc6cdcaa39301463 oc/sidebar
c23661967b449766281006855901d324eb8fb2b4 refactor/one-state-root
6d3662db4d527feefcc0ca3acea06cd52663570c release/study-game
d87b9b3f088fc88f7bf3fc2fbf0f171913a90f45 repair/browser
7dd8ebe375e3232b4ac5dabff9cbc86fc1f50b19 repair/companion
bf500836894fcecac7a2453c0da47388ce0c41ba repair/effects
cf8ddd0468fdcdcde8cbd4feac6444ea95faf36e repair/fusion
d4d63f95d9c15901541f20d2b0625b64e4b48659 repair/layout
476b1110dd7baa16a7e2994cf5ff7c55c1da14df repair/models
f8ed58f8b81437a8d231c47df2b4cea342eed230 repair/recovery
b171e3467aadc55c14600d18a5fc2c850d90d0dd repair/startup
97460b6f2e91a7b06a311c54d0f5e63090a17600 repair/workbench-gaze
d4faf4bd00958404af9a944e628412cb203af614 test/desk-win-probe
f33c4186dc69249e6804a218a9850be4edca1128 unify/pinkie-1112
09bb36e507cdcadb4a9e0074f27faf0e0812c710 wip-snapshot-1111/feat/study-builtin-model-redesign
d9604be1eea6b45c3b47ef1007cee6e69fa1d3b7 wip-snapshot-1111/feat/study-desk-drill
4b29f5e8bbab4611e1aa77012e2632106e56b4cf wip-snapshot-1111/feat/template-library
64fdae63a83b6c3dd6e0892e38fa11dc45b11172 wip-snapshot-1111/fix/windows-2.5.24
a53dda92a49b2c49d38211607cf98c983735572a wip-snapshot-1111/oc/brand
```

</details>
