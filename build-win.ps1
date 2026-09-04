# build-win.ps1 — 构建内置 Node.js、OpenClaw、网关和 WebView2 桌面壳的超級碧琪 Windows App
[CmdletBinding()]
param(
    # onedir avoids PyInstaller's onefile self-extraction (hundreds of MB) on every launch.
    # Pass -LegacyOneFile when a standalone compatibility EXE is also required for releases.
    [switch]$LegacyOneFile,
    # Local developers may use a compatible Node 24.x patch release. CI keeps
    # the manifest's exact version for reproducible release artifacts.
    [switch]$AllowLocalNodeVersion
)
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$manifest = Get-Content ".\desktop\windows\runtime-manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$runtimeStage = Join-Path $RepoRoot "build\windows-runtime"
$runtimeBin = Join-Path $runtimeStage "bin"
$runtimeModules = Join-Path $runtimeStage "node_modules"

python -m pip install --disable-pip-version-check --upgrade pip pyinstaller pywebview pywin32 edge-tts aiohttp
if ($LASTEXITCODE -ne 0) { throw "Python 构建依赖安装失败，请检查本机网络或 Python 3.12 环境" }
python -c "import sqlite3, _sqlite3; print('sqlite3 bundled:', sqlite3.sqlite_version)"
if ($LASTEXITCODE -ne 0) { throw "当前 Python 缺少 sqlite3/_sqlite3，无法构建派对和圆桌服务" }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $node --version).TrimStart('v')
if ($nodeVersion -ne $manifest.node) {
    if (-not $AllowLocalNodeVersion -or $nodeVersion -notmatch '^24\.') {
        throw "Node.js 版本不一致：需要 $($manifest.node)，构建机是 $nodeVersion；本机开发构建可加 -AllowLocalNodeVersion（仅接受 Node 24.x）"
    }
    Write-Warning "本机开发构建使用 Node.js $nodeVersion（发行构建仍固定 $($manifest.node)）"
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

$pyInstallerCommonArgs = @(
    "--noconfirm", "--clean", "--windowed",
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

# Build the fast-starting directory layout by default.  PyInstaller keeps all
# resources next to the launcher, so Windows no longer has to unpack ~700 MB
# into a temporary _MEI directory before showing the window.
pyinstaller @pyInstallerCommonArgs --onedir
if ($LASTEXITCODE -ne 0) { throw "Windows EXE 构建失败" }
if (-not (Test-Path -LiteralPath 'dist\超級碧琪\超級碧琪.exe')) {
    throw "Windows onedir 构建产物缺失"
}

if ($LegacyOneFile) {
    pyinstaller @pyInstallerCommonArgs --onefile
    if ($LASTEXITCODE -ne 0) { throw "Windows 兼容 EXE 构建失败" }
    if (-not (Test-Path -LiteralPath 'dist\超級碧琪.exe')) {
        throw "Windows onefile 构建产物缺失"
    }
}

Write-Host "构建完成: dist\超級碧琪\超級碧琪.exe"
if ($LegacyOneFile) { Write-Host "兼容构建完成: dist\超級碧琪.exe" }
