# 学习台 · Windows 开发交接（2026-11-11 晚）

学习台（碧琪上岸记游戏 + 笔记本 / 生词本 / 背一背）从 Mac 搬到 Windows 继续开发。
**还在开发阶段，没验收**。之后由 Fable 5.2 验收；验收通过之前：不合 main、不打 tag、不发版、不推给用户。

## 分支

公开仓库 `Cle0726/super-pinkie`，分支 **`dev/study-game`**，头见 `git log`（交接时 `7291ccf` + 本说明）。
Mac 上所有学习台相关的东西（包括以前没让推的）都已经合进这一条：

| 来源 | 内容 | 状态 |
|---|---|---|
| `feat/study-desk-drill`（069c5cc） | 背一背 + 奖励层 | 11-06 装进 Mac App（drill2） |
| `feat/study-game-core` / `feat/study-game-fx` | 游戏系统、特效引擎、立体书、考场 | 早已在分支里 |
| `review/study-game` 到 `7bb8982` | 评审修正、刷题版式、形态 v3、营地抠像、真题题库 | Mac App 最后一次安装 = game14 = `7bb8982` |
| `29f10e1` | 12 个形态的欢呼 / 委屈头像，刷题和战斗页小改 | **没装进过 App** |
| `9bdcfe4` | 「讲」用学习模式的碧琪口吻（`learning-explain-voice.mjs`，实时读学习模式的 USER/SOUL 规则），练习 / 背 / 考场小改 | **没装进过 App** |
| `1898249`（经 `dfd6062` 合入） | 笔记本 / 生词本「过几天」架子（`restingReview`）、学习提醒样式重做 | Mac App 里早就有（live-only），仓库里一直没提交 |
| `2ddb209`（经 `7291ccf` 合入） | 学习台所有后台任务（含游戏）共用一个「内置模型」设置 `builtinModel` | **没装进过 App**；合并时 `learning.mjs` 有一处冲突，已手工解决 |

合完后跑过：
```
node --test tests/learning-game*.test.mjs tests/learning-drill.test.mjs tests/learning-explain-voice.test.mjs tests/learning-builtin-model.test.mjs tests/learning-vocab.test.mjs tests/learning-notes-v2.test.mjs tests/learning-interaction.test.mjs tests/learning-notes-model.test.mjs
```
168 项，0 失败（Mac，Node 22）。

分支基于 2.5.45 前后的 main，落后现在的 main（2.5.48）。验收之后再处理合并。

## 已知坑

- `desktop/windows/mac-runtime/` 是 Windows 版用的「冻结的 Mac 运行时快照」，里面的 `learning.mjs` 等**没有**游戏 / 背一背后台。Windows 版 App 想跑学习台游戏，要把 `services/mode-architecture/learning*.mjs` 同步进快照（用 `tools/windows-package/refresh_mac_runtime.py`，先带 `--check` 看），改完对 `SHA256SUMS`。
- `tools/study-game/` 的美术管线写死过 Mac 路径：大多已支持环境变量 `STUDY_GAME_ART`；`magick` 路径、`real-papers-prep.mjs` 的 U 盘路径（`--usb=`）、一个脚本里的 Codex playwright 路径要改成参数 / 环境变量。
- `tools/study-game/deploy*.sh`、`tools/study-desk/deploy-*.py` 是 Mac App 安装脚本（3-way merge 到 `~/Library/Application Support/SuperPinkie`），Windows 上不能直接用；Windows 上要写对应的安装 / 热替换脚本，原则一样：**不要整文件覆盖用户 App 里的文件，用 3-way merge**。

## 不在 git 里的资料（压缩包另传）

1. `study-game-materials-20261111.zip`（847 MB）：美术源文件 `art/study-game/`（设 `STUDY_GAME_ART` 指过去）、26 套 B 级真题 / 模拟卷 `papers/`（**有版权，绝不能提交到这个公开仓库**，放到 SuperPinkie 数据目录的 `learning/game/papers/`）、`briefs/study-desk-game/` 全部设计书 + 截图 `qa-redo/`。
2. `study-desk-briefs-extra-20261111.zip`（626 KB）：更早的学习台设计书 `study-desk/`、`study-desk-v2/`（视觉语言）、`study-desk-drill/`、`study-desk-learn/`，以及 `WINDOWS-DEV-HANDOFF.md`。

## 先读（在 briefs/study-desk-game/ 里）

1. `REDO-1109-PLAN.md` / `REDO-1109-EXEC.md` / `REDO-1109-ART.md`：当前这一版的方向（Fable 管美术 + 内容策划，执行模型照做）。
2. `REDO-1109-PROGRESS.md`：做到哪了。
3. `VFX.md`：特效要成年人、工作室级，不要幼稚粒子。
4. `FORMS-V2.md`、`ECONOMY.md`、`CONTRACT.md`、`REVIEW.md`。

## 用户定下的规矩

- 美术图一律来自网页版 ChatGPT（用户的 GPT 会员），不用 Codex image_gen；不许裁旧图、复用旧图冒充新图。
- 出题、讲题、地图、资料分析都走内置模型，不写死内容。
- 特效在每台机器上一样，不按硬件 / 系统自动降级；只有用户自己在设置里选档位。
- 答题页是常见刷题版式：题目在上，选项全宽，反馈紧跟选项。
- 用户看不到真实界面就不算做完：每一屏都要截图自己看过。
