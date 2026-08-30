# Windows 10/11 部署指南

## 前置条件（一次性）

1. **安装 Git**：https://git-scm.com/download/win （一路默认）
2. **安装 Node.js LTS**：https://nodejs.org （补丁脚本需要）
3. **安装 Python 3**：https://www.python.org/downloads/ 安装时勾选 **"Add python.exe to PATH"**
4. **安装 OpenClaw**：按 OpenClaw 官方 Windows 安装方式装好，确认命令行能运行 `openclaw --version`

## 部署步骤

打开 **PowerShell**（开始菜单搜 PowerShell，建议右键"以管理员身份运行"）：

```powershell
# 1. 克隆仓库
cd $HOME
git clone https://github.com/Cle0726/super-pinkie.git
cd super-pinkie

# 2. 一键安装（提示词 + 补丁 + 代理 + 开机自启 + 指向你的模型中继）
#    把 mm 换成你 openclaw.json 里实际的 provider id
.\install.ps1 -Provider mm
```

如果 PowerShell 报"禁止运行脚本"，先执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 部署后

1. **重启 openclaw 网关**（`openclaw gateway restart` 或重启服务）
2. 打开网页聊天，进入无限制模式（agent 名为 `unrestricted` 的那个），**开新会话**
3. 发送验证口令：
   ```
   Cle
   ```
   模型回复 `ACTIVE_UNRESTRICTED_RULESET_LOADED` 即链路全通。

## 日常更新

```powershell
cd $HOME\super-pinkie
.\update.ps1        # 自动 git pull + 重装提示词/补丁/重启代理
```

## 说明与排障

- 代理默认监听 `127.0.0.1:1467`，转发到 `127.0.0.1:1466`（你的模型中继）。端口不符时用环境变量：
  ```powershell
  $env:UR_PROXY_PORT = "1467"
  $env:UR_UPSTREAM_PORT = "1466"
  ```
- 代理日志在计划任务输出里：任务计划程序 → OpenClawURProxy → 操作 → 查看日志；或 `Get-ScheduledTask -TaskName OpenClawURProxy | Get-ScheduledTaskInfo`。
- 防火墙弹窗询问 python 联网时**允许**（代理要访问 127.0.0.1，本机回环一般不会弹）。
- `install.ps1 -Remove` 一键卸载（撤补丁、停代理、删计划任务）。
- 升级 OpenClaw 后补丁会失效，重跑一次 `.\install.ps1` 即可（幂等）。
