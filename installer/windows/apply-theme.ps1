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
    "laolao-mode-learning.png",
    "laolao-mode-unrestricted.png",
    "laolao-mode-chat-hd.png",
    "laolao-mode-project-hd.png",
    "laolao-mode-thinking-hd.png",
    "laolao-mode-learning-hd.png",
    "laolao-mode-unrestricted-hd.png",
    "laolao-mode-transition-chat.png",
    "laolao-mode-transition-project.png",
    "laolao-mode-transition-thinking.png",
    "laolao-mode-transition-learning.png",
    "laolao-mode-transition-unrestricted.png",
    "laolao-mode-chat.svg",
    "laolao-mode-project.svg",
    "laolao-mode-thinking.svg",
    "laolao-mode-learning.svg",
    "laolao-mode-unrestricted.svg",
    "laolao-wallpaper.png",
    "laolao-wallpaper-project.png",
    "laolao-wallpaper-thinking.png",
    "laolao-wallpaper-learning.png",
    "laolao-wallpaper-unrestricted.png",
    "laolao-splash.png",
    "laolao-theme.css",
    "laolao-classic-shell.css",
    "laolao-classic-shell.js",
    "laolao-side-layout.css",
    "laolao-side-layout.js",
    "laolao-memory.css",
    "laolao-memory.js",
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
    "laolao-deep-think-base.png",
    "laolao-deep-think-boost.png",
    "laolao-deep-think-full.png",
    "laolao-deep-think-marathon.png",
    "laolao-deep-think-base.webm",
    "laolao-deep-think-boost.webm",
    "laolao-deep-think-full.webm",
    "laolao-deep-think-marathon.webm",
    "laolao-roundtable-entry.js",
    "laolao-context-compact.js",
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

    # 新旧 OpenClaw 的 UI 目录名不同，但它们都可以直接承载同一套静态
    # 覆盖文件。复制完整资源，避免 Windows 发行版漏掉后来增加的圆桌、
    # 流式工具和会话管理素材。
    foreach ($sourceRoot in @($AssetRoot, $InjectRoot)) {
        Get-ChildItem $sourceRoot -File | ForEach-Object {
            Copy-IfChanged $_.FullName (Join-Path $UiRoot $_.Name)
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
    if ((Test-Path $headFrag) -and -not ($html -match "laolao-theme\.css")) {
        $frag = Get-Content $headFrag -Raw -Encoding UTF8
        $html = $html -replace "(?i)(<head[^>]*>)", "`$1`n$frag"
    }
    if ((Test-Path $bodyFrag) -and -not ($html -match 'id="laolao-splash"')) {
        $frag = Get-Content $bodyFrag -Raw -Encoding UTF8
        $html = $html -replace "(?i)(<body[^>]*>)", "`$1`n$frag"
    }
    if ($html -match 'laolao-splash__video') {
        $html = [regex]::Replace(
            $html,
            '\s*<video class="laolao-splash__video"(?:(?!</video>)[\s\S])*?</video>',
            ''
        )
    }
    if ($html -notmatch "laolao-handoff-bootstrap") {
        $html = $html -replace "(?i)(<openclaw-app>)", "    <script src=""./laolao-handoff-bootstrap.js?v=handoff5""></script>`n    `$1"
    }

    # One controller only. Older packages placed this script in both the head
    # and body, which created duplicate timers and duplicate recovery buttons.
    $html = [regex]::Replace(
        $html,
        '\s*<script\b[^>]*src="[^"]*laolao-splash\.js(?:\?[^"]*)?"[^>]*></script>\s*',
        ''
    )

    # 旧 fragment 只包含基础脚本；下面补齐工作流、派对、圆桌和恢复层。
    $headTags = @(
        '<link rel="stylesheet" href="./laolao-sidebar.css?v=sidebar17">',
        '<link rel="stylesheet" href="./laolao-classic-shell.css?v=classic12">',
        '<link rel="stylesheet" href="./laolao-side-layout.css?v=side13">',
        '<link rel="stylesheet" href="./laolao-ui-subtraction.css?v=subtraction1">',
        '<link rel="stylesheet" href="./laolao-memory.css?v=memory1">',
        '<link rel="stylesheet" href="./laolao-usage-stats.css?v=stats7">',
        '<link rel="stylesheet" href="./laolao-tool-stream.css?v=toolstream1">',
        '<script src="./laolao-sidebar.js?v=sidebar16"></script>',
        '<script src="./laolao-session-list.js?v=sessions5"></script>',
        '<script src="./laolao-usage-stats.js?v=stats15"></script>',
        '<script defer src="./laolao-classic-shell.js?v=classic12"></script>',
        '<script src="./laolao-side-layout.js?v=side12"></script>',
        '<script defer src="./laolao-memory.js?v=memory2"></script>',
        '<script defer src="./laolao-party-entry.js?v=party4"></script>',
        '<script defer src="./laolao-roundtable-entry.js?v=roundtable3"></script>',
        '<script defer src="./laolao-stream-fx.js?v=stream3"></script>',
        '<script defer src="./laolao-link-viewer.js?v=link1"></script>',
        '<script defer src="./laolao-tool-stream.js?v=toolstream3"></script>',
        '<script defer src="./laolao-deep-think.js?v=deepthink16"></script>',
        '<script defer src="./laolao-context-compact.js?v=contextcompact3"></script>',
        '<script defer src="./laolao-resume.js?v=resume14"></script>',
        '<script defer src="./laolao-splash.js?v=splash25"></script>'
    )
    foreach ($tag in $headTags) {
        $fileName = [regex]::Match($tag, 'laolao-[^?"'']+').Value
        if ($fileName -and $html -notmatch [regex]::Escape($fileName)) {
            $html = $html -replace "(?i)(</head>)", "    $tag`n`$1"
        }
    }

    $versions = @{
        'laolao-theme.css' = 'theme39'; 'laolao-splash.css' = 'splash18'; 'laolao-sidebar.css' = 'sidebar17';
        'laolao-sidebar.js' = 'sidebar16'; 'laolao-session-list.js' = 'sessions5'; 'laolao-usage-stats.js' = 'stats15';
        'laolao-phrases.js' = 'phrases20';
        'laolao-mode-switcher.js' = 'mode31'; 'laolao-splash.js' = 'splash25';
        'laolao-handoff-bootstrap.js' = 'handoff5'; 'laolao-motion.js' = 'motion5'; 'laolao-resume.js' = 'resume14';
        'laolao-ui-subtraction.css' = 'subtraction1';
        'laolao-classic-shell.css' = 'classic12'; 'laolao-classic-shell.js' = 'classic12';
        'laolao-side-layout.css' = 'side13'; 'laolao-side-layout.js' = 'side12';
        'laolao-memory.css' = 'memory1'; 'laolao-memory.js' = 'memory2';
        'laolao-deep-think.js' = 'deepthink16'; 'laolao-context-compact.js' = 'contextcompact3'
    }
    foreach ($entry in $versions.GetEnumerator()) {
        $pattern = [regex]::Escape("./$($entry.Key)") + '(?:\?v=[^"'']*)?'
        $html = [regex]::Replace($html, $pattern, "./$($entry.Key)?v=$($entry.Value)")
    }

    # 7.1 的历史接口会返回完整分页，但原生渲染层仍限制 100 条/24 万字符。
    # 只放宽显示窗口；不改会话数据，也不展开工具调用正文。
    Get-ChildItem (Join-Path $UiRoot 'assets') -Filter 'chat-page-*.js' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $chatBundle = Get-Content $_.FullName -Raw -Encoding UTF8
        if (($chatBundle.Split('Showing last ${c} messages').Count - 1) -eq 1) {
            $chatBundle = $chatBundle.Replace(
                'function Zb(e){return typeof e!=`number`||!Number.isFinite(e)?100:Math.max(1,Math.min(100,Math.floor(e)))}',
                'function Zb(e){return 5000}'
            )
            $chatBundle = $chatBundle.Replace(
                'function Zb(e){return typeof e!=`number`||!Number.isFinite(e)?5000:Math.max(1,Math.min(5000,Math.floor(e)))}',
                'function Zb(e){return 5000}'
            )
            $chatBundle = $chatBundle.Replace('i+c>24e4)break', 'i+c>16e6)break')
            $chatBundle | Set-Content $_.FullName -Encoding UTF8 -NoNewline
        }
    }

    # Give both the entry module and its lazy chat chunk a revisioned URL.
    # This bypasses an already-running cache-first worker immediately.
    $html = [regex]::Replace(
        $html,
        '(src="\./assets/index-[^"?]+\.js)(?:\?v=[^"]*)?"',
            '$1?v=clekk-history14"'
    )
    Get-ChildItem (Join-Path $UiRoot 'assets') -Filter 'index-*.js' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $entryBundle = Get-Content $_.FullName -Raw -Encoding UTF8
        $entryBundle = [regex]::Replace(
            $entryBundle,
            '(\./chat-page-[A-Za-z0-9_-]+\.js)(?:\?v=[^`"'']*)?',
            '$1?v=clekk-history14'
        )
        $entryBundle | Set-Content $_.FullName -Encoding UTF8 -NoNewline
    }

    # 绝对到站点根目录，设置/概览等嵌套路由不再把头像和皮肤解析到
    # /settings/laolao-*，从而避免黑屏、裂图和透明度闪一下。
    $html = $html.Replace('"./laolao-', '"/laolao-')
    $html = $html.Replace('OpenClaw', 'CLE Kk')
    $html | Set-Content $IndexFile -Encoding UTF8
    $serviceWorker = Join-Path $UiRoot 'sw.js'
    if (Test-Path $serviceWorker) {
        $worker = Get-Content $serviceWorker -Raw -Encoding UTF8
        $worker = $worker.Replace('OpenClaw', 'CLE Kk')
        $worker = [regex]::Replace($worker, '-clekk-history-render-[0-9]+', '')
        $worker = [regex]::Replace(
            $worker,
            '(const EMBEDDED_CACHE_VERSION = "[^"]*)(";)',
            '$1-clekk-history-render-14$2'
        )
        $worker = $worker.Replace(
            '// Cache-first for hashed assets; network-first for HTML/other.',
            '// Network-first for all UI files; cached copies remain an offline fallback.'
        )
        $cacheFirst = @'
caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          }),
      )
'@
        $networkFirst = @'
fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
'@
        $worker = $worker.Replace($cacheFirst.Trim(), $networkFirst.Trim())
        $worker | Set-Content $serviceWorker -Encoding UTF8
    }
    Write-Host "  patched: $IndexFile"
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
