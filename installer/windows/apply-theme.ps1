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
    "laolao-classic-shell.css",
    "laolao-material-preview.css",
    "laolao-workspace-focus.css",
    "laolao-classic-shell.js",
    "laolao-side-layout.css",
    "laolao-side-layout.js",
    "laolao-memory.css",
    "laolao-memory.js",
    "laolao-learning-stage.css",
    "laolao-learning-stage.js",
    "laolao-learning-question.png",
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
    "laolao-material-preview.js",
    "laolao-workspace-focus.js",
    "laolao-page-warmup.js",
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
    "laolao-web-gpt-collab.js",
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
    # 这份列表里的 ?v= 必须与下面的 $versions 表逐条一致：它是给缺少这些标签
    # 的旧 fragment 补票用的，若写成偏低的版本号，WebView2 会继续用旧的缓存
    # 副本，界面看起来"升了级却没变化"。两端一致性由
    # tests/windows-self-contained.test.cjs 守着。
    $headTags = @(
        '<link rel="stylesheet" href="./laolao-sidebar.css?v=sidebar17">',
        '<link rel="stylesheet" href="./laolao-classic-shell.css?v=classic17">',
        '<link rel="stylesheet" href="./laolao-side-layout.css?v=side20">',
        '<link rel="stylesheet" href="./laolao-ui-subtraction.css?v=subtraction11">',
        '<link rel="stylesheet" href="./laolao-material-preview.css?v=material2">',
        '<link rel="stylesheet" href="./laolao-workspace-focus.css?v=workspacefocus2">',
        '<link rel="stylesheet" href="./laolao-memory.css?v=memory1">',
        '<link rel="stylesheet" href="./laolao-learning-stage.css?v=learning3">',
        '<link rel="stylesheet" href="./laolao-usage-stats.css?v=stats8">',
        '<link rel="stylesheet" href="./laolao-tool-stream.css?v=toolstream1">',
        '<script src="./laolao-sidebar.js?v=sidebar26"></script>',
        '<script src="./laolao-session-list.js?v=sessions10"></script>',
        '<script src="./laolao-usage-stats.js?v=stats16"></script>',
        '<script defer src="./laolao-classic-shell.js?v=classic15"></script>',
        '<script src="./laolao-side-layout.js?v=side12"></script>',
        '<script defer src="./laolao-memory.js?v=memory2"></script>',
        '<script defer src="./laolao-learning-stage.js?v=learning3"></script>',
        '<script defer src="./laolao-party-entry.js?v=party4"></script>',
        '<script defer src="./laolao-roundtable-entry.js?v=roundtable3"></script>',
        '<script defer src="./laolao-stream-fx.js?v=stream4"></script>',
        '<script defer src="./laolao-link-viewer.js?v=link4"></script>',
        '<script defer src="./laolao-tool-stream.js?v=toolstream4"></script>',
        '<script defer src="./laolao-deep-think.js?v=deepthink17"></script>',
        '<script defer src="./laolao-web-gpt-collab.js?v=webgpt13"></script>',
        '<script defer src="./laolao-context-compact.js?v=contextcompact3"></script>',
        '<script defer src="./laolao-resume.js?v=resume22"></script>',
        '<script defer src="./laolao-material-preview.js?v=material2"></script>',
        '<script defer src="./laolao-workspace-focus.js?v=workspacefocus2"></script>',
        '<script defer src="./laolao-page-warmup.js?v=warmup1"></script>',
        '<script defer src="./laolao-splash.js?v=splash26"></script>'
    )
    foreach ($tag in $headTags) {
        $fileName = [regex]::Match($tag, 'laolao-[^?"'']+').Value
        if ($fileName -and $html -notmatch [regex]::Escape($fileName)) {
            $html = $html -replace "(?i)(</head>)", "    $tag`n`$1"
        }
    }

    # 缓存击穿版本号。这些数字必须与 installer/macos/apply-theme.sh 保持一致：
    # 两端注入的是同一份 ui\injections\ 资源，版本号低于资产的实际代次时，
    # WebView2 会继续用旧的缓存副本，升级后界面看着"没变化"。
    # 下表由 tests/windows-self-contained.test.cjs 中的对照测试守着。
    $versions = @{
        'laolao-theme.css' = 'theme46'; 'laolao-splash.css' = 'splash18'; 'laolao-sidebar.css' = 'sidebar17';
        'laolao-sidebar.js' = 'sidebar26'; 'laolao-session-list.js' = 'sessions10'; 'laolao-usage-stats.js' = 'stats16';
        'laolao-phrases.js' = 'phrases21'; 'laolao-live-voice.js' = 'voice4'; 'laolao-stream-fx.js' = 'stream4';
        'laolao-mode-switcher.js' = 'mode36'; 'laolao-splash.js' = 'splash26';
        'laolao-handoff-bootstrap.js' = 'handoff5'; 'laolao-motion.js' = 'motion5'; 'laolao-resume.js' = 'resume22';
        'laolao-ui-subtraction.css' = 'subtraction11'; 'laolao-usage-stats.css' = 'stats8';
        'laolao-material-preview.css' = 'material2'; 'laolao-material-preview.js' = 'material2';
        'laolao-workspace-focus.css' = 'workspacefocus2'; 'laolao-workspace-focus.js' = 'workspacefocus2';
        'laolao-page-warmup.js' = 'warmup1';
        'laolao-link-viewer.js' = 'link4';
        'laolao-classic-shell.css' = 'classic17'; 'laolao-classic-shell.js' = 'classic15';
        'laolao-side-layout.css' = 'side20'; 'laolao-side-layout.js' = 'side12';
        'laolao-memory.css' = 'memory1'; 'laolao-memory.js' = 'memory2';
        'laolao-learning-stage.css' = 'learning3'; 'laolao-learning-stage.js' = 'learning3';
        'laolao-deep-think.js' = 'deepthink17'; 'laolao-web-gpt-collab.js' = 'webgpt13';
        'laolao-context-compact.js' = 'contextcompact3'
    }
    foreach ($entry in $versions.GetEnumerator()) {
        # 版本号字符集收紧，避免第二次运行时贪婪越过版本号把后续内容吃掉。
        $pattern = [regex]::Escape("./$($entry.Key)") + '(?:\?v=[A-Za-z0-9_.-]*)?'
        $html = [regex]::Replace($html, $pattern, "./$($entry.Key)?v=$($entry.Value)")
    }

    # 完整记录留在网关/SQLite；前端 live DOM 只保留最后五条可见聊天消息。
    # 有界倒扫避免为整段 transcript 创建临时 filter 数组；工具桥接仍由原生
    # 组件维护，不能在这里裁掉正在运行的工具状态。
    Get-ChildItem (Join-Path $UiRoot 'assets') -Filter 'chat-page-*.js' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $chatBundle = Get-Content $_.FullName -Raw -Encoding UTF8
        if (($chatBundle.Split('Showing last ${c} messages').Count - 1) -eq 1) {
            $chatBundle = $chatBundle.Replace(
                'function Zb(e){return typeof e!=`number`||!Number.isFinite(e)?100:Math.max(1,Math.min(100,Math.floor(e)))}',
                'function Zb(e){return 5}'
            )
            $chatBundle = $chatBundle.Replace(
                'function Zb(e){return typeof e!=`number`||!Number.isFinite(e)?5000:Math.max(1,Math.min(5000,Math.floor(e)))}',
                'function Zb(e){return 5}'
            )
            $chatBundle = $chatBundle.Replace('function Zb(e){return 5000}', 'function Zb(e){return 5}')
            $chatBundle = [regex]::Replace(
                $chatBundle,
                'r=\(Array\.isArray\(e\.messages\)\?e\.messages:\[\]\)\.filter\(e=>!Li\(e\)\);r=r\.slice\(-(?:n|5|100|5000)\),',
                'r=(()=>{let t=[],n=Array.isArray(e.messages)?e.messages:[];for(let e=n.length-1;e>=0&&t.length<5;e--){let r=n[e];Li(r)||t.unshift(r)}return t})(),'
            )
            $chatBundle = $chatBundle.Replace('i+c>16e6)break', 'i+c>24e4)break')
            $chatBundle | Set-Content $_.FullName -Encoding UTF8 -NoNewline
        }
    }

    # Give both the entry module and its lazy chat chunk a revisioned URL.
    # This bypasses an already-running cache-first worker immediately.
    $html = [regex]::Replace(
        $html,
        '(src="\./assets/index-[^"?]+\.js)(?:\?v=[^"]*)?"',
            '$1?v=clekk-history18"'
    )
    Get-ChildItem (Join-Path $UiRoot 'assets') -Filter 'index-*.js' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $entryBundle = Get-Content $_.FullName -Raw -Encoding UTF8
        $entryBundle = [regex]::Replace(
            $entryBundle,
            '(\./chat-page-[A-Za-z0-9_-]+\.js)(?:\?v=[^`"'']*)?',
            '$1?v=clekk-history18'
        )
        $entryBundle | Set-Content $_.FullName -Encoding UTF8 -NoNewline
    }

    # 绝对到站点根目录，设置/概览等嵌套路由不再把头像和皮肤解析到
    # /settings/laolao-*，从而避免黑屏、裂图和透明度闪一下。
    $html = $html.Replace('"./laolao-', '"/laolao-')
    $html = $html.Replace('OpenClaw', 'CLE Kk')
    # 精确写回：Set-Content 每次都会再补一个行尾，重复应用会让文件不断长长。
    # index.html 里全是中文，保留 BOM。
    Write-Utf8 $IndexFile $html $true
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
            '$1-clekk-history-render-18$2'
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
            $node = Get-Command node -ErrorAction SilentlyContinue
            $runtimePatches = @(
                'apply-image-access.mjs',
                'apply-material-preview-csp.mjs',
                'apply-control-ui-workspace-media.mjs'
            ) | ForEach-Object { Join-Path $RepoRoot "patch\$_" } | Where-Object { Test-Path $_ }
            if ($node -and $runtimePatches.Count -gt 0) {
                $previousRoot = $env:OPENCLAW_ROOT
                try {
                    $env:OPENCLAW_ROOT = $packageRoot
                    foreach ($runtimePatch in $runtimePatches) {
                        & $node.Source $runtimePatch | Out-Null
                    }
                } finally {
                    $env:OPENCLAW_ROOT = $previousRoot
                }
            }
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
