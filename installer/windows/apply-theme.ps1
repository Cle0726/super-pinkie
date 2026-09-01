# apply-theme.ps1 — Windows 版：把 来啦～老弟 皮肤注入 OpenClaw UI 目录
#
# 用法：
#   .\installer\windows\apply-theme.ps1
#   PINKIE_SKIP_APP_BUNDLES=1 .\installer\windows\apply-theme.ps1   # 只注入 nvm UI，跳过 app 包
#
# 环境变量覆盖：
#   $env:PINKIE_SKIP_APP_BUNDLES  = "1"  → 跳过打包 app 内的 UI

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$AssetRoot  = Join-Path $RepoRoot "ui\assets"
$InjectRoot = Join-Path $RepoRoot "ui\injections"
$UserHome   = $env:USERPROFILE
$NvmRoot    = Join-Path $UserHome ".nvm\versions\node"
$SkipApp    = $env:PINKIE_SKIP_APP_BUNDLES -eq "1"

$Assets = @(
    "laolao-avatar.png",
    "laolao-mode-chat.png",
    "laolao-mode-project.png",
    "laolao-mode-thinking.png",
    "laolao-mode-unrestricted.png",
    "laolao-mode-chat-hd.png",
    "laolao-mode-project-hd.png",
    "laolao-mode-thinking-hd.png",
    "laolao-mode-unrestricted-hd.png",
    "laolao-mode-transition-chat.png",
    "laolao-mode-transition-project.png",
    "laolao-mode-transition-thinking.png",
    "laolao-mode-transition-unrestricted.png",
    "laolao-mode-chat.svg",
    "laolao-mode-project.svg",
    "laolao-mode-thinking.svg",
    "laolao-mode-unrestricted.svg",
    "laolao-wallpaper.png",
    "laolao-wallpaper-project.png",
    "laolao-wallpaper-thinking.png",
    "laolao-wallpaper-unrestricted.png",
    "laolao-splash.png",
    "laolao-theme.css",
    "laolao-motion.js",
    "laolao-sidebar.css",
    "laolao-sidebar.js",
    "laolao-usage-stats.css",
    "laolao-usage-stats.js",
    "laolao-quota.json",
    "laolao-splash.css",
    "laolao-splash.js",
    "laolao-handoff-bootstrap.js",
    "laolao-phrases.js",
    "laolao-progress.js",
    "laolao-session-list.js",
    "laolao-live-voice.js",
    "laolao-mode-switcher.js",
    "laolao-image-viewer.js",
    "laolao-stream-fx.js",
    "laolao-link-viewer.js",
    "laolao-tool-stream.js",
    "laolao-tool-stream.css",
    "laolao-party-entry.js",
    "laolao-party-avatar-v1.png",
    "laolao-roundtable-entry.js",
    "laolao-resume.js",
    "laolao-roundtable-entry-v2.png",
    "laolao-roundtable-entry-v2-clean.png",
    "favicon.svg",
    "favicon-32.png",
    "favicon.ico"
)

function Copy-IfChanged {
    param([string]$Src, [string]$Dst)
    if (-not (Test-Path $Src)) { return }
    $dstDir = Split-Path $Dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    if (-not (Test-Path $Dst) -or ((Get-FileHash $Src).Hash -ne (Get-FileHash $Dst).Hash)) {
        Copy-Item $Src $Dst -Force
    }
}

function Apply-UISkin {
    param([string]$UiRoot)
    $IndexFile = Join-Path $UiRoot "index.html"
    if (-not (Test-Path $IndexFile)) { return }

    foreach ($asset in $Assets) {
        $injectSrc = Join-Path $InjectRoot $asset
        $assetSrc  = Join-Path $AssetRoot  $asset
        $dst       = Join-Path $UiRoot $asset
        if (Test-Path $injectSrc) {
            Copy-IfChanged $injectSrc $dst
        } elseif (Test-Path $assetSrc) {
            Copy-IfChanged $assetSrc $dst
        }
    }

    # apple-touch-icon 和 manifest
    Copy-IfChanged (Join-Path $AssetRoot "laolao-avatar.png")       (Join-Path $UiRoot "apple-touch-icon.png")
    Copy-IfChanged (Join-Path $AssetRoot "manifest.webmanifest")    (Join-Path $UiRoot "manifest.webmanifest")

    # 注入 <head> fragment
    $headFrag = Join-Path $InjectRoot "laolao-head.fragment.html"
    $bodyFrag = Join-Path $InjectRoot "laolao-body.fragment.html"
    $handoff  = Join-Path $InjectRoot "laolao-handoff-bootstrap.js"
    Copy-IfChanged $handoff (Join-Path $UiRoot "laolao-handoff-bootstrap.js")

    $html = Get-Content $IndexFile -Raw -Encoding UTF8
    if ((Test-Path $headFrag) -and -not ($html -match "laolao-head")) {
        $frag = Get-Content $headFrag -Raw -Encoding UTF8
        $html = $html -replace "(?i)(<head[^>]*>)", "`$1`n$frag"
    }
    if ((Test-Path $bodyFrag) -and -not ($html -match "laolao-body")) {
        $frag = Get-Content $bodyFrag -Raw -Encoding UTF8
        $html = $html -replace "(?i)(</body>)", "$frag`n`$1"
    }
    if ($html -notmatch "laolao-handoff-bootstrap") {
        $html = $html -replace "(?i)(<openclaw-app>)", "    <script src=""./laolao-handoff-bootstrap.js?v=handoff3""></script>`n    `$1"
    }
    $html | Set-Content $IndexFile -Encoding UTF8
    Write-Host "  patched: $IndexFile"
}

# ── 1. 注入 nvm 管理的 OpenClaw UI ────────────────────────────────────────
$didAny = $false
if (Test-Path $NvmRoot) {
    Get-ChildItem $NvmRoot -Directory | ForEach-Object {
        $uiRoot = Join-Path $_.FullName "lib\node_modules\openclaw\ui"
        if (Test-Path $uiRoot) {
            Write-Host "==> applying skin to $uiRoot"
            Apply-UISkin $uiRoot
            $didAny = $true
        }
    }
}

if (-not $didAny) {
    # fallback：搜索 AppData\Roaming\npm\node_modules\openclaw
    $npm = Join-Path $env:APPDATA "npm\node_modules\openclaw\ui"
    if (Test-Path $npm) {
        Write-Host "==> applying skin to $npm"
        Apply-UISkin $npm
        $didAny = $true
    }
}

if (-not $didAny) {
    Write-Warning "找不到 OpenClaw UI 目录，皮肤注入跳过。请确认 OpenClaw 已全局安装。"
}

# ── 2. 写入头像到各工作区 ────────────────────────────────────────────────
$workspaces = @(
    @{ Path = "$UserHome\.openclaw\workspace";             Asset = "laolao-mode-chat-hd.png";         Name = "pinkie-pie.png" },
    @{ Path = "$UserHome\.openclaw\workspace-project";     Asset = "laolao-mode-project-hd.png";      Name = "pinkie-pie.png" },
    @{ Path = "$UserHome\.openclaw\workspace-thinking";    Asset = "laolao-mode-thinking-hd.png";     Name = "pinkie-pie.png" },
    @{ Path = "$UserHome\.openclaw\workspace-unrestricted";Asset = "laolao-mode-unrestricted-hd.png"; Name = "unrestricted-mode.png" }
)
foreach ($ws in $workspaces) {
    $avatarDir = Join-Path $ws.Path "avatars"
    if (Test-Path $ws.Path) {
        New-Item -ItemType Directory -Force -Path $avatarDir | Out-Null
        Copy-IfChanged (Join-Path $AssetRoot $ws.Asset) (Join-Path $avatarDir $ws.Name)
    }
}

Write-Host ""
Write-Host "皮肤注入完成。如果 OpenClaw 正在运行，请重启 Gateway 使更改生效。"
