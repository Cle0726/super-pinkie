# Windows 端补充（接在 `PROMPT.md` 后面一起给 Windows 上的 Claude）

你在 Windows 电脑上。先照 `PROMPT.md` 做，下面是只有 Windows 端不同的地方，冲突时以这里为准。

## 一、工作树

主工作区多半停在 `dev/study-game` 上并带着没提交的改动，不要切走它：

```bash
git worktree add ../brain-mode feat/brain-mode-1113
```

## 二、隔离副本

Mac 的隔离副本在仓库外，你那边没有，自己搭一个（如果之前做「工具整改」时已经搭过 `tools/tool-health/iso-windows/`，直接复用它的脚本）：

- 放在仓库外，例如 `%USERPROFILE%\碧琪实测\iso-brain\`，状态目录、配置、工作区、日志、临时目录全在它下面。
- 网关用随机空闲端口，**不能是 18789**，只绑 `127.0.0.1`，自己的令牌。环境变量参照 `tools/windows-smoke/smoke.py` 的 `profile_env`。
- 运行时从仓库产物或已装 App 的运行时目录复制一份再用，不在安装目录里直接跑。
- 模型配置从正式配置只读复制；密钥不打印、不进仓库、不进 `PROGRESS.md`。
- 隔离副本和正式 App 共用上游账号。报 400、鉴权失败、连接断开多半是上游的事，等一会儿重跑，不要改代码迁就。

## 三、正式环境

验收 Z2 的三样换成 Windows 上的：已安装的超級碧琪（安装目录或便携版目录）的修改时间、它的 `openclaw.json`（在 `%USERPROFILE%\.openclaw` 或 `PINKIE_STATE_ROOT` 指的地方，先查清）的修改时间、18789 上网关的进程号。

## 四、哪些批适合在 Windows 上做

| 批 | Windows 上能不能做 | 注意 |
|---|---|---|
| 0 基座 | 能 | `setup.py` 和 Windows 安装脚本两边都要登记主脑；验收 A0-3 在 Windows 的工作区路径上验 |
| 1 派发 | 能 | 纯后端加一个开关，两端一样 |
| 2 会话管理 | 能 | `folder` 参数要认盘符和反斜杠 |
| 3 通用补缺 | **最适合** | 命令分类要包含 `del`、`move`、`ren`、`Remove-Item`、`winget`、`Invoke-WebRequest`；读图小框要过 A3-9 |
| 4 皮肤和黑猫 | 皮肤能做；黑猫要等用户点头 | 字体回退里有 `SimSun`；Windows 的效果必须和 Mac 一致，不许按硬件降级 |
| 5 总控台 | 能 | |
| 6 资源关停 | 能 | CPU 用任务管理器或 `Get-Counter` 量，写明量法；Edge WebView 没有 GPU 时软件渲染会抬高数字，记下是不是这种情况 |
| 7 收尾 | 只能做 Windows 那一半 | 见下 |

## 五、只有 Mac 能验的

- `refresh_mac_runtime.py --check` 要读 Mac 上装好的 App。你新增的运行时补丁照常写在 `patch/`、接进 `patch/apply-all.mjs`、过 `tests/patches-wired.test.mjs`，然后在 `PROGRESS.md` 记「运行时快照待 Mac 端刷新」。
- Mac 原生窗口相关的截图对比（A4-2 的 Mac 那一份）记「没测（需 Mac 端）」。

## 六、和 Mac 端交接

- 开工前 `git pull --rebase`，看 `PROGRESS.md` 的接力棒。别人占着的那一批不要做，挑另一批（看 PLAN 第三节末尾的文件表，选不撞文件的）。
- `index.mjs` 和 `laolao-phrases.js` 同一时间只有一端改。要改之前在接力棒里写明，提交推送后再动手。
- 收工时把 Windows 上量到的数字、截图的结论（截图本身不进仓库）写进 `PROGRESS.md`。
