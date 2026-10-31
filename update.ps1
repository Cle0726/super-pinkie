# update.ps1 — 拉取最新 超級碧琪 并重新应用（支持人格模板同步与开机自动拉取计划任务）
# 用法：
#   .\update.ps1                        # 自动拉取当前分支更新并同步最新人格模板与皮肤（保留 USER.md / 记忆 / 会话）
#   .\update.ps1 -Branch main           # 指定拉取分支
#   .\update.ps1 -RegisterAutoUpdate    # 注册 Windows 登录自动拉取更新计划任务
#   .\update.ps1 -UnregisterAutoUpdate  # 取消自动拉取更新计划任务
# 注意：需要是 git clone 的目录，不能是 zip 解压版
param(
  [string]$Branch               = "",
  [switch]$SyncPersonas         = $true,
  [switch]$RegisterAutoUpdate   = $false,
  [switch]$UnregisterAutoUpdate = $false
)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoDir
$AutoUpdateTaskName = "SuperPinkieAutoUpdate"

if ($UnregisterAutoUpdate) {
  Stop-ScheduledTask -TaskName $AutoUpdateTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $AutoUpdateTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "==> 已取消自动拉取更新计划任务 ($AutoUpdateTaskName)"
  exit 0
}

if ($RegisterAutoUpdate) {
  $ps = (Get-Command powershell.exe).Source
  $scriptPath = Join-Path $RepoDir "update.ps1"
  $action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`"" -WorkingDirectory $RepoDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
  Register-ScheduledTask -TaskName $AutoUpdateTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "==> 已注册自动拉取更新计划任务 ($AutoUpdateTaskName)：每次登录 Windows 时后台自动检查并拉取最新维护更新。"
  if (-not (Test-Path ".git")) { exit 0 }
}

if (-not (Test-Path ".git")) {
  Write-Host "error: 这不是一个 git 仓库。请用 git clone 克隆后再运行更新。"
  exit 1
}

if (-not $Branch) {
  $detectedBranch = (git rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  $Branch = if ($detectedBranch -and $detectedBranch -ne "HEAD") { $detectedBranch } else { "main" }
}

$before = git rev-parse HEAD 2>$null
Write-Host "==> 当前版本: $(Get-Content VERSION -ErrorAction SilentlyContinue) ($($before.Substring(0,7)))"
Write-Host "==> 拉取更新 from origin/$Branch"

git fetch origin $Branch
$behind = (git rev-list "HEAD..origin/$Branch" --count 2>$null | Out-String).Trim()
if ($behind -eq "0") {
  Write-Host "    已是最新，无需更新。"
  if ($SyncPersonas) {
    Write-Host "==> 同步人格模板与最新 UI 皮肤（保留个人 USER.md / 记忆 / 会话）"
    & .\install.ps1 -SyncPersonas
  }
  exit 0
}

try {
  git pull --ff-only origin $Branch
} catch {
  Write-Host "    本地有未提交改动，暂存后重试"
  git stash push -m "super-pinkie-update-$(Get-Date -Format 'yyyyMMddHHmmss')" | Out-Null
  git pull --ff-only origin $Branch
  git stash pop | Out-Null
}

$after = git rev-parse HEAD 2>$null
Write-Host "==> 更新到: $(Get-Content VERSION -ErrorAction SilentlyContinue) ($($after.Substring(0,7)))"
Write-Host ""
Write-Host "==> 重新应用提示词、补丁、人格与皮肤（保留个人 USER.md / 记忆 / 会话）"
if ($SyncPersonas) {
  & .\install.ps1 -SyncPersonas
} else {
  & .\install.ps1
}
Write-Host ""
Write-Host "更新完成。如果 CLE Kk 网关正在运行，请重启："
Write-Host "    openclaw gateway restart"
