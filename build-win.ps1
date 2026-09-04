# build-win.ps1 — 构建内置 Node.js、OpenClaw、网关和 WebView2 桌面壳的超級碧琪.exe
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$manifest = Get-Content ".\desktop\windows\runtime-manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$runtimeStage = Join-Path $RepoRoot "build\windows-runtime"
$runtimeBin = Join-Path $runtimeStage "bin"
$runtimeModules = Join-Path $runtimeStage "node_modules"

python -m pip install --disable-pip-version-check --upgrade pip pyinstaller pywebview pywin32 edge-tts aiohttp
python -c "import sqlite3, _sqlite3; print('sqlite3 bundled:', sqlite3.sqlite_version)"
if ($LASTEXITCODE -ne 0) { throw "当前 Python 缺少 sqlite3/_sqlite3，无法构建派对和圆桌服务" }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $node --version).TrimStart('v')
if ($nodeVersion -ne $manifest.node) {
    throw "Node.js 版本不一致：需要 $($manifest.node)，构建机是 $nodeVersion"
}

if (Test-Path $runtimeStage) { Remove-Item $runtimeStage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtimeBin | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeBin "node.exe") -Force

npm install --prefix $runtimeStage --omit=dev --no-audit --no-fund "openclaw@$($manifest.openclaw)"
if ($LASTEXITCODE -ne 0) { throw "OpenClaw 内置运行时下载失败" }
$openclawRoot = Join-Path $runtimeModules "openclaw"
if (-not (Test-Path (Join-Path $openclawRoot "openclaw.mjs"))) {
    throw "OpenClaw 内置运行时不完整"
}

$env:OPENCLAW_ROOT = $openclawRoot
$env:PINKIE_SKIP_APP_BUNDLES = "1"
& ".\installer\windows\apply-theme.ps1"
python -c "from app.super_pinkie import apply_patch; import sys; sys.exit(0 if apply_patch(False, lambda _message: None) else 1)"
if ($LASTEXITCODE -ne 0) { throw "内置 OpenClaw 传输补丁失败" }
Remove-Item Env:OPENCLAW_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:PINKIE_SKIP_APP_BUNDLES -ErrorAction SilentlyContinue

$runtimeInfo = @{
    architecture = $env:PROCESSOR_ARCHITECTURE
    node = $nodeVersion
    openclaw = $manifest.openclaw
    python = (python -c "import platform; print(platform.python_version())")
    webview = (python -c "import importlib.metadata; print(importlib.metadata.version('pywebview'))")
}
$runtimeInfo | ConvertTo-Json | Set-Content (Join-Path $runtimeStage "runtime-manifest.json") -Encoding UTF8

$pyInstallerArgs = @(
    "--noconfirm", "--clean", "--windowed", "--onefile",
    "--name", "超級碧琪",
    "--icon", "ui\assets\favicon.ico",
    "--paths", "app",
    "--hidden-import", "webview.platforms.edgechromium",
    "--hidden-import", "win32com.client",
    "--hidden-import", "pythoncom",
    "--hidden-import", "pywintypes",
    "--hidden-import", "sqlite3",
    "--hidden-import", "_sqlite3",
    # Explicitly collect the native extension and sqlite3.dll.  The service
    # modules are loaded with importlib at runtime, so relying on module
    # analysis alone is fragile on Windows Python builds.
    "--collect-binaries", "sqlite3",
    "--collect-all", "webview",
    "--collect-all", "edge_tts",
    "--collect-all", "aiohttp",
    "--add-binary", "$(Join-Path $runtimeBin 'node.exe');runtime\bin",
    "--add-data", "$runtimeModules;runtime\node_modules",
    "--add-data", "$(Join-Path $runtimeStage 'runtime-manifest.json');runtime",
    "--add-data", "prompts;prompts",
    "--add-data", "proxy;proxy",
    "--add-data", "patch;patch",
    "--add-data", "personas;personas",
    "--add-data", "skills;skills",
    "--add-data", "services;services",
    "--add-data", "ui;ui",
    "--add-data", "installer;installer",
    "--add-data", "scripts;scripts",
    "--add-data", "desktop\windows\THIRD_PARTY_NOTICES.md;runtime",
    "--add-data", "VERSION;.",
    "--add-data", "config.example.json;.",
    "app\super_pinkie.py"
)
pyinstaller @pyInstallerArgs
if ($LASTEXITCODE -ne 0) { throw "Windows EXE 构建失败" }

Write-Host "构建完成: dist\超級碧琪.exe"
