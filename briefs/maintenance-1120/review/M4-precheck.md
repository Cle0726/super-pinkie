# M4 独立复测报告（发版前独立复核）

## 接力卡（最后更新：2026-11-21 18:41 -08:00，Gemini-Win-3b7e @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m2-m4-audit`（草稿 PR 创建中）
- 核对的 main 提交：`fa57fcc7da5e05e259e72d149c67235ebed750c2`
- 已完成：
  1. 从 `origin/main`（`fa57fcc7`）创建独立工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit` 及 C 盘临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`（C 盘剩余 22.74 GB）。
  2. 记录 Z2 开工只读现场快照。
- 正在做：准备推送首个接力卡提交并开启草稿 PR，随后对 M4 拆分进行 AST 语法树级函数体一致性证明、拆分特有隐患排查及 M4-1 ★ ~ M4-5、v2.5.53 → main 隔离升级、Z1/Z2/Z4/Z5 复测。
- 下一步：
  1. 编写并运行 Python (`ast`) 与 JS (Acorn/Node AST) 脚本，在语法树层面比对拆分前（M4 父提交 `3cd2ac6f`）与拆分后（`fa57fcc7`）每个函数/方法体是否一致；
  2. 逐项专项排查拆分特有问题：可变全局状态裂变为两份、循环导入、初始化顺序、monkeypatch/测试替身失效、`__file__` 和 `import.meta.url` 的相对路径、打包清单与 Mac 文件复制清单漏文件（`installer/macos/apply-theme.sh`、`desktop/macos/build.sh`、`build-win.ps1`、spec）；
  3. 逐条重做 M4-1 ★ ~ M4-5，以及 v2.5.53 → 最新 main 的隔离升级（验证会话、设置、模式保留）与临时 venv 隔离打包 + Windows 冒烟测试。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`；端口 5145–5149；后台进程：无
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
