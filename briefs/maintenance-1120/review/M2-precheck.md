# M2 独立复测报告（发版前独立复核）

## 接力卡（最后更新：2026-11-21 18:41 -08:00，Gemini-Win-3b7e @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m2-m4-audit`（草稿 PR 创建中）
- 核对的 main 提交：`fa57fcc7da5e05e259e72d149c67235ebed750c2`
- 已完成：
  1. 从 `origin/main`（`fa57fcc7`）创建独立工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit` 及 C 盘临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`（C 盘剩余 22.74 GB）。
  2. 记录 Z2 开工只读现场快照（`openclaw.json`、`%LOCALAPPDATA%\Programs\SuperPinkie`、`%LOCALAPPDATA%\SuperPinkie`、18789 端口）。
- 正在做：准备推送首个接力卡提交并开启草稿 PR，随后执行护栏反例验证与 M2 各条独立复测（M2-1 ★ ~ M2-5、各安装路径与反例、Z1/Z2/Z4/Z5）。
- 下一步：
  1. 执行 M2-1 ★ 源码零手写版本号核查与反例；
  2. 执行 M2-2 ★ 全安装路径（Windows 安装器、Windows 打包、更新器 bundle、deploy-work-first.py、Mac 脚本核查）1 字节修改只变自身版本号及反例；
  3. 执行 M2-3 ★ 浏览器旧缓存升级拿新文件（端口 5125）及反例；
  4. 执行 M2-4 ★ 双分支 `git merge-tree` 实测与反例；
  5. 执行 M2-5 `tests/windows-self-contained.test.cjs` 双端哈希与漏文件反例。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`；端口 5125–5129；后台进程：无
- 正在跑的长操作：无
- 踩过的坑：无
- 待用户决定：无

---

## Z2 正式环境只读现场快照

### 开工快照（`2026-11-21 18:39:51 -08:00`）

| 检查项 | 路径 / 端口 | 状态 / 修改时间 | 大小 / 进程 |
|---|---|---|---|
| 正式安装目录 | `C:\Users\34786\AppData\Local\Programs\SuperPinkie` | `Exists=True`, `LastWriteTime=2026-11-21T03:36:23.8784727-08:00` | Directory |
| 正式应用数据目录 | `C:\Users\34786\AppData\Local\SuperPinkie` | `Exists=True`, `LastWriteTime=2026-11-21T04:26:46.2369231-08:00` | Directory |
| 正式 `.openclaw` 目录 | `C:\Users\34786\.openclaw` | `Exists=True`, `LastWriteTime=2026-11-21T10:36:03.7046384-08:00` | Directory |
| 正式 `openclaw.json` | `C:\Users\34786\.openclaw\openclaw.json` | `Exists=True`, `LastWriteTime=2026-11-19T23:56:00.7371058-08:00` | `Length=49217` |
| 正式网关端口 | `18789` | 无监听（`Port 18789: no listener`） | 无 |

---

## 逐条核对（进行中）
