# update.ps1 — 拉取最新 超級碧琪 并重新应用
# 用法：.\update.ps1
# 注意：需要是 git clone 的目录，不能是 zip 解压版
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Test-Path ".git")) {
  Write-Host "error: 这不是一个 git 仓库。请用 git clone 克隆后再运行更新。"
  exit 1
}

$before = git rev-parse HEAD 2>$null
Write-Host "==> 当前版本: $(Get-Content VERSION -ErrorAction SilentlyContinue) ($($before.Substring(0,7)))"
Write-Host "==> 拉取更新 from origin/main"

git fetch origin
$behind = git rev-list HEAD..origin/main --count 2>$null
if ($behind -eq "0") {
  Write-Host "    已是最新，无需更新。"
  exit 0
}

try {
  git pull --ff-only origin main
} catch {
  Write-Host "    本地有未提交改动，暂存后重试"
  git stash push -m "super-pinkie-update-$(Get-Date -Format 'yyyyMMddHHmmss')" | Out-Null
  git pull --ff-only origin main
  git stash pop | Out-Null
}

$after = git rev-parse HEAD 2>$null
Write-Host "==> 更新到: $(Get-Content VERSION -ErrorAction SilentlyContinue) ($($after.Substring(0,7)))"
Write-Host ""
Write-Host "==> 重新应用提示词、补丁、人格与皮肤"
& .\install.ps1
Write-Host ""
Write-Host "更新完成。如果 OpenClaw Gateway 正在运行，请重启："
Write-Host "    openclaw gateway restart"
