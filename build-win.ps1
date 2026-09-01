# build-win.ps1 — 在本机 Windows 上构建 超級碧琪.exe
# 前置：Python 3.10+（勾选 Add to PATH），git
# 用法：.\build-win.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

python -m pip install --upgrade pip pyinstaller

pyinstaller --noconfirm --windowed --onefile --name "超級碧琪" `
  --add-data "prompts;prompts" `
  --add-data "proxy;proxy" `
  --add-data "patch;patch" `
  --add-data "personas;personas" `
  --add-data "services;services" `
  --add-data "ui;ui" `
  --add-data "installer;installer" `
  --add-data "scripts;scripts" `
  --add-data "VERSION;." `
  --add-data "config.example.json;." `
  app/super_pinkie.py

Write-Host "构建完成: dist\超級碧琪.exe"
