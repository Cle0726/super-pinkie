# K5 · Mac 实测证据摘要

原始证据（构建/安装/回退日志、快照原文、隔离脚本，共约 788KB）留在本机 `K5-mac-evidence/`，不进仓库。本文件只摘关键数据，结论见 `K5-mac.md`。

时间线（2026-11-27，-08:00）：openclaw 包构建 08:16 → cle 包构建 08:20 → 备份 08:44 → 安装 08:56 → 回退 09:01 → 拷证据 09:06。隔离根 `/private/tmp/pk-k5-20261127T160257Z`（已清理）。

## 1. 两份包装的内核不同

`tools/core/manifest.mjs install` 最后一行的输出：

| 包 | 日志行 | core | version | sha256 |
|---|---|---|---|---|
| cle | `logs/build-cle.log:10` | `cle` | `2026.7.1-2-c.3` | `4418ab09b2f159672c77ede94a3899a2f0574b797853d3460ce07a27c65ce59f` |
| openclaw | `logs/build-openclaw.log:15` | `openclaw` | `2026.7.1-2` | `null` |

两份日志都以 `build exit=0` 结尾。两份包的 build-info.json 却完全一样（channel `dev`、version 2.5.54、commit `62760668508d30dc8283cc1d70c0698aef2776ac`），因为 build.sh 只写 guard/channel/version/commit，不写内核；所以 `installs.tsv` 里新旧指纹都是 `4242819991-120`。

## 2. 备份 manifest（`backup-manifest.txt`）

```
version=1
created=2026-11-27T16:44:44Z
stamp=20261127-084324
app=<隔离根>/Applications/超級碧琪.app
app.present=1
app.version=2.5.54
app.channel=dev
app.commit=62760668508d30dc8283cc1d70c0698aef2776ac
plist.ai.openclaw.watchdog=0
plist.com.super-pinkie.tts=0
plist.com.super-pinkie.reapply=0
plist.com.openclaw.urproxy=0
plist.ai.openclaw.gateway=0
```

## 3. 安装与回退记录

- `installs.tsv`：`20261127-085601  <隔离根>/Applications/超級碧琪.app.cle-replaced-20261127-085601  4242819991-120  4242819991-120`
- `restore.txt`：`backup=<隔离根>/backups/20261127-084324`、`at=2026-11-27T17:01:46Z`、`app=<隔离根>/Applications/超級碧琪.app`
- 回退后 App inode 101308791 = 原 `cle-replaced` 那份；升级装的 App（inode 101639057）挪到 `after-install/20261127-090146/app`；launchctl 0 次。

## 4. 三次快照对比

文件快照（`snap/{before,after,restored}.json`，结构 `fields` + `files` + `label`）：

- `files` 覆盖 6 类：1-chat、2-settings、3-memory、4-models、5-skills、6-connectors（文件清单 + sha256）
- `fields` 覆盖 1-chat、2-settings、4-models、6-connectors、gateway 的关键字段
- before = after = restored（除 `label` 外逐字节相同）

网关读出（`snap/{before,after,restored}-gw.json`）9 项：`1-chat`、两个会话的 `chat.history`、`4-models`、`4-models-defaultModel`、`5-skills`、`6-connectors`、`plugins`、`usage-ok`，三次完全相同。

## 5. 敏感信息

快照里只有假 provider key 的 `apiKeySha`（合成数据），没有网关令牌，也没有真实凭据。
