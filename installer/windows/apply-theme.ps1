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

function Copy-IfChanged {
    param([string]$Src, [string]$Dst)
    if (-not (Test-Path $Src)) { return }
    $dstDir = Split-Path $Dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    if (-not (Test-Path $Dst) -or ((Get-FileHash $Src).Hash -ne (Get-FileHash $Dst).Hash)) {
        Copy-Item $Src $Dst -Force
    }
}

# Set-Content 每次写回都会再补一个行尾，重复应用会让文件不断变长；而 -Encoding
# UTF8 在 Windows PowerShell 5.1 下又总是写 BOM。这里统一精确写回，BOM 由调用方
# 决定：sw.js 和 minified JS 保持无 BOM（macOS 侧的 perl 同样原样保留），
# index.html 保留 BOM（里面的中文靠它表意）。
function Write-Utf8 {
    param([string]$Path, [string]$Text, [bool]$WithBom = $false)
    $encoding = New-Object System.Text.UTF8Encoding($WithBom)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    Write-Utf8 $Path $Text $false
}

function Apply-UISkin {
    param([string]$UiRoot)
    if (-not (Test-Path (Join-Path $UiRoot 'index.html'))) { return }
    # The same byte-preserving resource/entry generator as macOS.
    python (Join-Path $RepoRoot 'tools\ui-parity\bundle.py') install --root $RepoRoot --control-ui $UiRoot
    if ($LASTEXITCODE -ne 0) { throw 'Shared Control UI installation failed' }
    $serviceWorker = Join-Path $UiRoot 'sw.js'
    if (Test-Path $serviceWorker) {
        $worker = Get-Content $serviceWorker -Raw -Encoding UTF8
        $worker = $worker.Replace('OpenClaw', 'CLE Kk')
        # 打了补丁的原生块沿用上游的哈希文件名，cache-first 会一直把补丁前的
        # 渲染器喂回来。给本地 UI 改网络优先，并给它那份可丢弃的缓存打版本号；
        # 离线回退仍然保留。
        $worker = [regex]::Replace($worker, '-clekk-history-render-[0-9]+', '')
        $worker = [regex]::Replace(
            $worker,
            '(const EMBEDDED_CACHE_VERSION = "[^"]*)(";)',
            '$1-clekk-history-render-59$2'
        )
        $worker = $worker.Replace(
            '// Cache-first for hashed assets; network-first for HTML/other.',
            '// Network-first for all UI files; cached copies remain an offline fallback.'
        )
        $cacheFirst = "caches.match(event.request).then(`n        (cached) =>`n          cached ||`n          fetch(event.request).then((response) => {`n            if (response.ok) {`n              const clone = response.clone();`n              void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));`n            }`n            return response;`n          }),`n      )"
        $networkFirst = "fetch(event.request)`n        .then((response) => {`n          if (response.ok) {`n            const clone = response.clone();`n            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));`n          }`n          return response;`n        })`n        .catch(() => caches.match(event.request))"
        $worker = $worker.Replace($cacheFirst, $networkFirst)
        Write-Utf8NoBom $serviceWorker $worker
    }
    Write-Host "  patched shared UI: $UiRoot"
}

# ── 1. 定位当前 OpenClaw（新版 dist/control-ui + 旧版 ui）──────────────
$didAny = $false
$packageRoots = [System.Collections.Generic.List[string]]::new()
if ($env:OPENCLAW_ROOT) { $packageRoots.Add($env:OPENCLAW_ROOT) }
try {
    $npmRoot = (& npm root -g 2>$null | Select-Object -First 1).Trim()
    if ($npmRoot) { $packageRoots.Add((Join-Path $npmRoot 'openclaw')) }
} catch {}
$packageRoots.Add((Join-Path $env:APPDATA 'npm\node_modules\openclaw'))
if (Test-Path $NvmRoot) {
    Get-ChildItem $NvmRoot -Directory | ForEach-Object {
        $packageRoots.Add((Join-Path $_.FullName 'lib\node_modules\openclaw'))
        $packageRoots.Add((Join-Path $_.FullName 'node_modules\openclaw'))
    }
}

$seenUi = @{}
foreach ($packageRoot in $packageRoots) {
    foreach ($relativeUi in @('dist\control-ui', 'ui')) {
        $uiRoot = Join-Path $packageRoot $relativeUi
        if ((Test-Path (Join-Path $uiRoot 'index.html')) -and -not $seenUi.ContainsKey($uiRoot)) {
            $seenUi[$uiRoot] = $true
            Write-Host "==> applying skin to $uiRoot"
            # 发行包由 build-win.ps1 安装后台快照，之后再装完整公共 UI。
            if ($env:PINKIE_SKIP_RUNTIME_PATCHES -eq "1") {
                Write-Host "  runtime patches skipped; build-win.ps1 overlays the installed Mac runtime"
                Apply-UISkin $uiRoot
                $didAny = $true
                continue
            }
            $node = Get-Command node -ErrorAction SilentlyContinue
            $runtimePatches = @(
                'apply-context-budget.mjs',
                'apply-compaction-boundary-recovery.mjs',
                'apply-loopback-model-reliability.mjs',
                'apply-work-thinking.mjs',
                'apply-thinking-capabilities.mjs',
                'apply-image-access.mjs',
                'apply-material-preview-csp.mjs',
                'apply-local-unrestricted-policy.mjs',
                'apply-computer-v2.mjs'
            ) | ForEach-Object { Join-Path $RepoRoot "patch\$_" } | Where-Object { Test-Path $_ }
            if ($node -and $runtimePatches.Count -gt 0) {
                $previousRoot = $env:OPENCLAW_ROOT
                try {
                    $env:OPENCLAW_ROOT = $packageRoot
                    foreach ($runtimePatch in $runtimePatches) {
                        & $node.Source $runtimePatch
                        if ($LASTEXITCODE -ne 0) {
                            Write-Warning "runtime patch failed: $runtimePatch exit $LASTEXITCODE"
                        }
                    }
                } finally {
                    $env:OPENCLAW_ROOT = $previousRoot
                }
            }
            Apply-UISkin $uiRoot
            $didAny = $true
        }
    }
}

if (-not $didAny) {
    Write-Warning "找不到 CLE Kk UI 目录，皮肤注入跳过。请先运行一键安装 / 修复。"
}

# ── 2. 写入头像到各工作区 ────────────────────────────────────────────────
$workspaces = @(
    @{ Path = "$UserHome\.openclaw\workspace";             Asset = "laolao-mode-chat-hd.png";         Name = "pinkie-pie.png" },
    @{ Path = "$UserHome\.openclaw\workspace-project";     Asset = "laolao-mode-project-hd.png";      Name = "pinkie-pie.png" },
    @{ Path = "$UserHome\.openclaw\workspace-thinking";    Asset = "laolao-mode-thinking-hd.png";     Name = "pinkie-pie.png" },
    @{ Path = "$UserHome\.openclaw\workspace-learning";    Asset = "laolao-mode-learning-hd.png";     Name = "pinkie-pie.png" },
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
Write-Host "皮肤注入完成。如果 CLE Kk 正在运行，请重启网关使更改生效。"
