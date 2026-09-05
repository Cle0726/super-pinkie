# Windows 10/11 使用指南

## 推荐：使用快速启动版（onedir）

从 GitHub Releases 下载并解压 `super-pinkie-windows-<版本>-portable.zip`，运行 `超級碧琪\\超級碧琪.exe`。成品已内置固定版本的 Node.js、OpenClaw、Python 依赖、网关和全部本机服务，不需要安装 Git、Node.js、Python 或 OpenClaw。onedir 版本把运行时放在程序目录旁，不会像旧单文件 EXE 那样在每次启动时把数百 MB 解压到 `_MEI*` 临时目录，因此启动明显更快。

Release 中仍提供 `super-pinkie-windows-<版本>.exe` 兼容版；它便于单文件分发，但每次启动都需要解压内置运行时，启动较慢。

### 可选：后台网关看门狗

App 打开时已经自带看门狗。如果希望关闭窗口后仍自动检查内置 Gateway，可在程序目录执行一次：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "F:\SuperPinkie\_internal\installer\windows\register-bundled-watchdog.ps1" -InstallRoot "F:\SuperPinkie"
```

它注册的是独立的 `SuperPinkieGatewayWatchdog` 任务，只在监听缺失时启动内置网关，不会终止正在冷启动的进程，也不会复用旧的 `OpenClaw Gateway` 任务。

### 会话中 API 断链的自动续接

会话级看门狗与上面的进程看门狗是两层机制：模型请求在首字节前会由代理自动重试；
如果流式响应中途断开，Gateway 会在父会话结束事件后自动注入隐藏的续接指令，并按约
2 秒、4 秒、8 秒、12 秒的间隔高频重试。已经完成的工具写入不会因为续接而重复执行，
成功或手动继续后，旧的重试定时器会自动取消，因此不需要反复发送“继续”。默认覆盖
自定义 `agentId` 的普通会话；如需兼容旧的“仅四种模式”行为，可设置：

```powershell
$env:PINKIE_WATCHDOG_ALL = "0"
```

首次打开会完整播放一次开屏视频，并在后台准备网关；如果准备时间较长，画面会停在视频尾帧而不是循环。准备好后直接进入 App 内的聊天页面。

用户自己的模型 Key、配置、聊天记录和工作区仍保存在 `%USERPROFILE%\.openclaw`，派对和圆桌记录保存在 `%LOCALAPPDATA%\SuperPinkie`。替换程序目录（兼容版则替换 EXE）不会删除这些资料；桌面 App 只补缺少的默认人格和提示词，已有内容（包括手动修改）不会被改回去。配置层发生必要的兼容迁移时仍会先备份到 `%LOCALAPPDATA%\SuperPinkie\backups`。

若 Windows 缺少 WebView2 Runtime，安装微软 WebView2 Runtime 后重新打开；Windows 11 通常已预装。

## 源码部署（开发者可选）

只有修改源码、自己构建或维护旧环境时才需要 Git、Node.js 24.20.0 和 Python 3.12。

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

## EXE 说明与排障

- 日志位于 `%LOCALAPPDATA%\SuperPinkie\logs`，网关异常会由 App 内的看门狗自动重启。
- 想打开保留的旧维护界面，可运行 `超級碧琪.exe --control-center`。
- 模型服务商的 API Key 仍需由用户自行配置；EXE 不会内置、上传或替换私人 Key。

## 源码模式说明与排障

- 代理默认监听 `127.0.0.1:1467`，转发到 `127.0.0.1:1466`（你的模型中继）。端口不符时用环境变量：
  ```powershell
  $env:UR_PROXY_PORT = "1467"
  $env:UR_UPSTREAM_PORT = "1466"
  ```
- 代理日志在计划任务输出里：任务计划程序 → OpenClawURProxy → 操作 → 查看日志；或 `Get-ScheduledTask -TaskName OpenClawURProxy | Get-ScheduledTaskInfo`。
- 防火墙弹窗询问 python 联网时**允许**（代理要访问 127.0.0.1，本机回环一般不会弹）。
- `install.ps1 -Remove` 一键卸载（撤补丁、停代理、删计划任务）。
- 升级 OpenClaw 后补丁会失效，重跑一次 `.\install.ps1` 即可（幂等）。
