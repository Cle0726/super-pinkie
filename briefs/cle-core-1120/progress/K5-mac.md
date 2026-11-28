# K5 · Mac 升级 / 回退实测（tools/cle-pkg-mac）

## 接力卡（最后更新：2026-11-27 13:20 -08:00，Claude @ Mac wt-macdev1-k5）

- 状态：Mac 隔离环境里 `backup-current.sh` → `install-cle.sh` → `restore.sh` 全流程跑通，6 类资产在升级后、回退后都和升级前一致。两份包装的内核不同（cle@2026.7.1-2-c.3 对 openclaw@2026.7.1-2，见「要先说清的限制」第 1 条），换内核后 6 类资产仍可读。**缺口是 build-info.json 不记内核，脚本只能靠 `CLE_EXPECT_CHANNEL=dev` 放行；本分支已补 build.sh 写 core 字段、cle-pkg-mac 认 core=cle，需要用新 build.sh 打出的包再跑一次才算 K5-1/K5-2 的正式结论。**
- 分支：`mac/k5-mac-upgrade-rollback`（基于 `origin/main` `62760668`），本文件、证据摘要 `K5-mac-evidence-summary.md` 与代码修复一起提交（draft PR）；788KB 原始证据 `K5-mac-evidence/` 只留本机。
- 依据：`ACCEPTANCE.md` K5-1、K5-2。
- 隔离根：`/private/tmp/pk-k5-20261127T160257Z`（跑完已清理，关键证据摘要见本文件和 `K5-mac-evidence-summary.md`）。
- 待用户决定：见末尾「待决定」。

## 隔离做法

- 一切都在 `$R=/private/tmp/pk-k5-20261127T160257Z` 下：`Applications/`（隔离 App）、`home/`（隔离 HOME，含 `.openclaw`）、`state/`、`cache/`、`logs/`、`snap/`、`backups/`、`LaunchAgents/`（空）。
- 脚本经 `$R/cle-run.sh` 调用，导出 `HOME`、`CLE_ISO_ROOT`、`CLE_APP_DIR`、`CLE_BACKUP_DIR`、`CLE_AGENTS_DIR`、`CLE_PKG`；`launchctl`/`pgrep`/`codesign` 换成桩（`fake-launchctl` 只记日志；`fake-pgrep` 恒报「没在运行」；`fake-codesign` 只放行 `--verify`，转给真 `/usr/bin/codesign`）。`lib.sh` 的 `cle_guard_path` / `cle_guard_tool` 确认了所有路径都在隔离根下、没用真命令。
- 隔离网关端口 51038（随机，≠18789），`HOME` / `OPENCLAW_STATE_DIR` / `PINKIE_STATE_ROOT` 全在 `$R` 下。没碰真实 `/Applications/超級碧琪.app`、`~/.openclaw`、`~/Library/LaunchAgents`、`launchctl`、18789。
- 资产由 `seed-assets.py` 合成（不复制任何真实数据）：
  - 1 聊天：`agent:main:dashboard:k5a`「K5 会话甲」、`k5b`「K5 会话乙」，各 3 轮（6 条）
  - 2 设置：`state/sessions/prefs.json`、`session-titles.json`
  - 3 记忆：`USER.md`、`MEMORY.md`、`memory/2026-11-27.md`
  - 4 模型：provider `k5fake`（`http://127.0.0.1:9/v1`，假 key），模型 `k5-model-a`/`k5-model-b`，默认 `k5fake/k5-model-a`
  - 5 技能：`skills/k5-probe`、`pinkie-skills/k5-extra`（extraDirs）
  - 6 连接器：`k5-http`（streamable-http，启用）、`k5-local`（stdio `/usr/bin/true`，停用）

## 两种核对方式

1. 文件快照 `snap.py <label>`：6 类资产的文件清单 + sha256 + 关键字段。
2. 网关读出 `probe.py <label>`：起隔离网关，并行调 `pinkie.connectors.list`、`pinkie.modelSetup.list`、`sessions.list`、`chat.history`（k5a/k5b）、`pinkie.usage.get`、`skills list --json`、`plugins list --enabled --json`，摘要成 `<label>-gw.json`。

## 过程与结果

| 步骤 | 命令 | 结果 |
|---|---|---|
| 备份 | `backup-current.sh --yes` | exit 0，`backups/20261127-084324`（manifest：app.present=1、version 2.5.54、channel dev、commit 6276…、5 个 plist 都是 0） |
| 拒装证据 | `install-cle.sh`（默认期望 channel=cle） | 拒装：包的 channel 是 `dev`，不是 `cle`（`logs/install-cle-noexpect-dry.log`） |
| 升级 | `CLE_EXPECT_CHANNEL=dev install-cle.sh --yes` | exit 0；旧 App 改名 `超級碧琪.app.cle-replaced-20261127-085601`；新 App 与 `dist-cle` 包 `diff -rq` 一致；codesign 调了 1 次 `--verify --deep`，launchctl 0 次 |
| 重装插件 | 4 个 `setup.py` | 全部 exit 0 |
| 升级后核对 | `snap.py after` / `probe.py after` | 文件快照除 label 外完全一致；网关读出 9 项全部 same |
| 回退计划 | `restore.sh` | exit 2，只列计划：现装 App 挪走、`cle-replaced` 那份改名回来（指纹和备份相同）、5 个 plist 都跳过 |
| 回退 | `restore.sh --yes` | exit 0；`Applications/` 只剩 `超級碧琪.app`，inode 101308791 = 原 `cle-replaced` 那份；升级装的 App（inode 101639057）挪到 `after-install/20261127-090146/app`；还原后 App 与备份里的 App `diff -rq` 一致；launchctl 0 次 |
| 回退后核对 | `snap.py restored` / `probe.py restored`（用还原后的 App 起网关） | 文件快照 fields/files 都 same；网关读出 9 项全部 same |

网关读出（升级前 = 升级后 = 回退后）：

- 1-chat：2 个会话，k5a 6 条、k5b 6 条
- 4-models：`k5fake`，hasKey=true，`[k5-model-a, K5 Model A]`、`[k5-model-b, K5 Model B]`；defaultModel `k5fake/k5-model-a`
- 5-skills：`[k5-extra, k5-probe]`
- 6-connectors：`k5-http`（url `http://127.0.0.1:9/mcp`，streamable-http，enabled true）、`k5-local`（command `/usr/bin/true`，stdio，enabled false）
- plugins：`pinkie-first-person-renderer`、`pinkie-mode-architecture`、`pinkie-project-scope`
- usage-ok：true
- 2-settings、3-memory 网关没有读接口，靠文件快照（sha256 全同）

证据里扫过网关令牌和假 provider key，均无命中。

## 要先说清的限制

1. **两份包内核不同，但 build-info 不记内核**（此条已更正：之前写成「同一份内核」是错的）。
   - 构建日志证实内核不同：`build-cle.log:10` 装的是 `cle@2026.7.1-2-c.3`（sha256 `4418ab09…ce59f`），`build-openclaw.log:15` 装的是 `openclaw@2026.7.1-2`（sha256 null）；两份日志都以 `build exit=0` 结尾。文件数 44811 对 44805。
   - 真正的缺口：build.sh 生成 build-info.json 只写 guard/channel/version/commit，两份包 build-info 完全一样（channel `dev`、2.5.54、commit `62760668508d30dc8283cc1d70c0698aef2776ac`、sha 前缀 `a455a667e94c6dbf`）。所以 `install-cle.sh` 只能用 `CLE_EXPECT_CHANNEL=dev` 装，`installs.tsv` 新旧指纹都是 `4242819991-120`。
   - 本分支的修复：build.sh 截取 `manifest.mjs install` 最后一行，在 build-info.json 里追加 `core` / `coreVersion` / `coreSha256`（`GUARD_CHANNEL` 与原四字段不变，channel 仍只有 dev / release 给 guard.mjs 用）；cle-pkg-mac 见到 core 字段默认只要求 core=cle，显式设 `CLE_EXPECT_CHANNEL` 才另核 channel；没有 core 字段的老包照旧要求 channel=cle。
   - 本次实测资产结论成立；K5-1/K5-2 正式结论要用新 build.sh 打出的包（build-info 带 core=cle、不需要 `CLE_EXPECT_CHANNEL`）再跑一次。
2. LaunchAgents 路径：本次隔离实测里 5 个 plist 都不存在，`restore_plist` / `restore_plist_away` 走「跳过」分支，launchctl 0 次。已在 `tests/cle_pkg_mac_test.py` 用假 plist + 假 launchctl 补单测：`test_core_pkg_with_launch_agents_and_bootstrap_failure` 覆盖 core=cle 包 + 放回 plist + 挪走多出的 plist + bootstrap 失败提示分支（原 `test_full_cycle_backup_install_restore` 已覆盖 bootout/bootstrap 正常路径）。真机 launchd 仍没测。
3. 没有截图（K5-1 写「逐项截图或贴出数据对比」，这里只有数据对比）。
4. Windows 没测（K5-1 要求 Mac 和 Windows 各一次）。

## 顺带发现

- **隔离漏点**：隔离网关的日志写进了共享的 `/tmp/openclaw/openclaw-2026-11-27.log`（网关启动日志里写着 `log file: /tmp/openclaw/...`），该文件里有 105 行带隔离根路径。日志目录没跟 `HOME`/`OPENCLAW_STATE_DIR` 走，以后的隔离脚本要另设日志目录。共享日志没删。
- **modelSetup 对 input 做了规范化**：种子里 `k5-model-a` 的 `input` 只有 `["text"]`，`pinkie.modelSetup.list` 读出来是 `["text","image"]`、`vision: true`。升级前后、回退后一致，不是回归，但「模型配置原样保留」要以文件快照为准。
- **偶发 exit 1**：有一轮 probe 8 个调用全部 exit 1、输出为空，单独调用正常；加了 stderr 记录后重跑全部正常、stderr 为空，没复现。疑似和同时进行的其他调用冲突。
- probe 早期问题（已在脚本里解决，非产品问题）：CLI 冷启动慢，串行调用会超时 → 改并行、单次 300 秒；`iso-gateway.py cli` 截断 stdout 到 6000 字符导致 skills/plugins JSON 解析失败 → `K5_FULL=1` 输出全文。

## 待决定

1. 用新 build.sh 打出带 core=cle 的 Mac 包，由谁、什么时候打，用来重跑 K5-1/K5-2。
2. 是否给隔离脚本补「日志目录也隔离」（例如设 OpenClaw 日志目录到 `$R/logs`）。
