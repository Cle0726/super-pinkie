# build-win.ps1 — 在本机 Windows 上构建 超级碧琪.exe
# 前置：Python 3.10+（勾选 Add to PATH），git
# 用法：.\build-win.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
python -m pip install --upgrade pip pyinstaller
pyinstaller --noconfirm --windowed --onefile --name "超级碧琪" `
  --add-data "prompts;prompts" `
  --add-data "proxy/ur-rewrite-proxy.py;proxy" `
  app/super_pinkie.py
Write-Host "构建完成: dist\超级碧琪.exe"
