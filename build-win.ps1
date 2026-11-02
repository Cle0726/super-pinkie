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

python -m pip install --disable-pip-version-check --upgrade pip pyinstaller "pywebview==6.2.1" pywin32 edge-tts aiohttp
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
$env:PINKIE_SKIP_RUNTIME_PATCHES = "1"
& ".\installer\windows\apply-theme.ps1"
python -c "from app.super_pinkie import apply_patch; import sys; sys.exit(0 if apply_patch(False, lambda _message: None) else 1)"
if ($LASTEXITCODE -ne 0) { throw "内置 OpenClaw 传输补丁失败" }

# 后台网关继续采用已验证的 Mac 兼容快照；完整浏览器 UI 统一来自 ui/。
# 所有覆盖及清理结束后，必须再装公共入口、渲染器和资源，不能恢复旧页面。
$overlayRoot = Join-Path $RepoRoot "desktop\windows\mac-runtime"
$sums = Join-Path $overlayRoot "SHA256SUMS"
if (-not (Test-Path -LiteralPath $sums)) { throw "缺少本机 Mac 运行时快照 desktop\windows\mac-runtime" }
$serviceStage = Join-Path $runtimeStage "bundled-services"
$personaStage = Join-Path $runtimeStage "bundled-personas"
$uiStage = Join-Path $runtimeStage "bundled-ui"
$windowsInstallerStage = Join-Path $runtimeStage "bundled-windows-installer"
$managedSkillStage = Join-Path $runtimeStage "bundled-skills"
foreach ($stage in @($serviceStage, $personaStage, $uiStage, $windowsInstallerStage, $managedSkillStage)) {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
}
Copy-Item -Path (Join-Path $RepoRoot "services\*") -Destination $serviceStage -Recurse -Force
$cleStudio = Join-Path $serviceStage "cle-studio"
if (Test-Path -LiteralPath $cleStudio) { Remove-Item -LiteralPath $cleStudio -Recurse -Force }
Copy-Item -Path (Join-Path $RepoRoot "personas\*") -Destination $personaStage -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "ui\*") -Destination $uiStage -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "installer\windows\*") -Destination $windowsInstallerStage -Recurse -Force
foreach ($skill in @("deep-think", "pinkie-deep-research", "web-gpt-collab")) {
    $source = Join-Path $RepoRoot "skills\$skill"
    if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) { throw "缺少打包技能 $skill" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $managedSkillStage $skill) -Recurse -Force
}

function Install-MacSnapshot([string]$Relative, [string]$Destination, [string]$Expected) {
    $source = Join-Path $overlayRoot ($Relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $source)) { throw "快照缺少 $Relative" }
    $parent = Split-Path -Parent $Destination
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $Destination -Force
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $Expected) { throw "快照校验失败 $Relative" }
}

$aiCopied = $false
Get-Content -LiteralPath $sums | ForEach-Object {
    if (-not $_.Trim()) { return }
    $parts = $_ -split '  ', 2
    $expect = $parts[0].ToLower()
    $rel = $parts[1].Trim()
    if ($rel.StartsWith("openclaw/")) {
        Install-MacSnapshot $rel (Join-Path $openclawRoot ($rel.Substring(9) -replace '/', '\')) $expect
    } elseif ($rel.StartsWith("services/")) {
        Install-MacSnapshot $rel (Join-Path $serviceStage ($rel.Substring(9) -replace '/', '\')) $expect
    } elseif ($rel.StartsWith("personas/")) {
        # 人格只以仓库 personas/ 为准；快照里的旧人格会盖掉新版本。
        throw "快照不能带人格文件 $rel"
    } elseif ($rel.StartsWith("ai/")) {
        $name = Split-Path -Leaf $rel
        $dirs = @(
            (Join-Path $openclawRoot "node_modules\@openclaw\ai\dist"),
            (Join-Path $runtimeModules "@openclaw\ai\dist")
        ) | Where-Object { Test-Path -LiteralPath $_ }
        if (-not $dirs) { throw "找不到 @openclaw/ai，无法覆盖 $name" }
        foreach ($dir in $dirs) {
            Install-MacSnapshot $rel (Join-Path $dir $name) $expect
        }
        $script:aiCopied = $true
    } else {
        throw "无法识别的快照路径 $rel"
    }
}
if (-not $aiCopied) { throw "Mac 快照没有覆盖 @openclaw/ai" }
$env:OPENCLAW_ROOT = $openclawRoot
& $node ".\patch\apply-pinkie-managed-skills.mjs"
if ($LASTEXITCODE -ne 0) { throw "内置技能的分模式加载补丁失败" }
# The shared model picker requests this neutral "other provider" icon. The
# pinned runtime does not ship it, so include the Pinkie asset explicitly.
$providerIcons = Join-Path $openclawRoot "dist\control-ui\provider-icons"
New-Item -ItemType Directory -Force -Path $providerIcons | Out-Null
Copy-Item -LiteralPath "ui\assets\ProviderIcon-crossmodel.svg" -Destination (Join-Path $providerIcons "ProviderIcon-crossmodel.svg") -Force
$controlUi = Join-Path $openclawRoot "dist\control-ui"
Copy-Item -LiteralPath "ui\assets\ProviderIcon-crossmodel.svg" -Destination (Join-Path $controlUi "ProviderIcon-crossmodel.svg") -Force
python tools/windows-package/clean_ui.py --ui $uiStage --control-ui $controlUi --installer $windowsInstallerStage
if ($LASTEXITCODE -ne 0) { throw "Windows 资源隔离失败" }
# The runtime snapshot owns backend chunks only. Rebuild the final browser UI from
# the shared repository source AFTER all overlays and package cleanup.
python tools/ui-parity/bundle.py install --control-ui $controlUi --output (Join-Path $runtimeStage 'windows-ui-manifest.json')
if ($LASTEXITCODE -ne 0) { throw "Mac/Windows shared UI installation failed" }
$chat = Get-ChildItem -Path (Join-Path $openclawRoot "dist\control-ui\assets") -Filter "chat-page-*.js" | Select-Object -First 1
if (-not $chat) { throw "缺少聊天页" }
$chatText = Get-Content -LiteralPath $chat.FullName -Raw
if ($chatText -notmatch 'pinkie-chat-timeline:v26' -or $chatText -notmatch 'pinkie-thinking-segments:v1') { throw "聊天页不是本机 Mac 的完整时间线 v26" }
$indexText = Get-Content -LiteralPath (Join-Path $openclawRoot "dist\control-ui\index.html") -Raw
foreach ($needle in @('pinkie-surface=6', 'pinkie-browser=3', 'pinkie-learning=8')) {
    if ($indexText -notlike "*$needle*") { throw "页面入口缺少 $needle" }
}
$modeIndex = Join-Path $serviceStage "mode-architecture\index.mjs"
$modeText = Get-Content -LiteralPath $modeIndex -Raw
if ($modeText -like '*C.le. 执行控制层*') { throw "Windows 包带上了 C.le. 控制层" }

Remove-Item Env:OPENCLAW_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:PINKIE_SKIP_APP_BUNDLES -ErrorAction SilentlyContinue
Remove-Item Env:PINKIE_SKIP_RUNTIME_PATCHES -ErrorAction SilentlyContinue

$runtimeInfo = @{
    architecture = $env:PROCESSOR_ARCHITECTURE
    node = $nodeVersion
    openclaw = $manifest.openclaw
    python = (python -c "import platform; print(platform.python_version())")
    webview = (python -c "import importlib.metadata; print(importlib.metadata.version('pywebview'))")
}
$runtimeInfo | ConvertTo-Json | Set-Content (Join-Path $runtimeStage "runtime-manifest.json") -Encoding UTF8

$pyInstallerCommonArgs = @(
    "--noconfirm", "--clean", "--windowed", "--uac-admin",
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
    "--add-data", "$personaStage;personas",
    "--add-data", "$managedSkillStage;bundled-skills",
    "--add-data", "$serviceStage;services",
    "--add-data", "$uiStage;ui",
    "--add-data", "$windowsInstallerStage;installer\windows",
    "--add-data", "tools\ui-parity;tools\ui-parity",
    "--add-data", "scripts;scripts",
    "--add-data", "desktop\windows\THIRD_PARTY_NOTICES.md;runtime",
    "--add-data", "VERSION;.",
    "--add-data", "update-mirrors.json;.",
    "--add-data", "desktop\windows\release-notes.md;.",
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
python tools/windows-package/clean_ui.py --check-package 'dist\超級碧琪'
if ($LASTEXITCODE -ne 0) { throw "Windows 包含其他产品的素材或缺少安装器" }
python tools/ui-parity/bundle.py check --control-ui 'dist\超級碧琪\_internal\runtime\node_modules\openclaw\dist\control-ui' --output 'dist\windows-ui-manifest.json'
if ($LASTEXITCODE -ne 0) { throw 'Packaged Control UI differs from the shared source' }
python tools/windows-package/check_runtime.py --package 'dist\超級碧琪'
if ($LASTEXITCODE -ne 0) { throw "Windows 包缺少运行时文件，或打过补丁的文件被改回去了" }

if ($LegacyOneFile) {
    pyinstaller @pyInstallerCommonArgs --onefile
    if ($LASTEXITCODE -ne 0) { throw "Windows 兼容 EXE 构建失败" }
    if (-not (Test-Path -LiteralPath 'dist\超級碧琪.exe')) {
        throw "Windows onefile 构建产物缺失"
    }
}

Write-Host "构建完成: dist\超級碧琪\超級碧琪.exe"
if ($LegacyOneFile) { Write-Host "兼容构建完成: dist\超級碧琪.exe" }
