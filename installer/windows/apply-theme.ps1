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
    "laolao-mode-transition-chat-mask.png",
    "laolao-mode-transition-chat-plate.webp",
    "laolao-mode-transition-chat-plate-soft.png",
    "laolao-mode-transition-chat-char-soft.png",
    "laolao-mode-transition-project-mask.png",
    "laolao-mode-transition-project-plate.webp",
    "laolao-mode-transition-project-plate-soft.png",
    "laolao-mode-transition-project-char-soft.png",
    "laolao-mode-transition-thinking-mask.png",
    "laolao-mode-transition-thinking-plate.webp",
    "laolao-mode-transition-thinking-plate-soft.png",
    "laolao-mode-transition-thinking-char-soft.png",
    "laolao-mode-transition-learning-mask.png",
    "laolao-mode-transition-learning-plate.webp",
    "laolao-mode-transition-learning-plate-soft.png",
    "laolao-mode-transition-learning-char-soft.png",
    "laolao-mode-transition-unrestricted-mask.png",
    "laolao-mode-transition-unrestricted-plate.webp",
    "laolao-mode-transition-unrestricted-plate-soft.png",
    "laolao-mode-transition-unrestricted-char-soft.png",
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
    "laolao-wallpaper-soft.jpg",
    "laolao-wallpaper-soft-project.jpg",
    "laolao-wallpaper-soft-thinking.jpg",
    "laolao-wallpaper-soft-learning.jpg",
    "laolao-wallpaper-soft-unrestricted.jpg",
    "laolao-splash.png",
    "laolao-splash-mask.png",
    "laolao-splash-plate.webp",
    "laolao-splash-plate-soft.png",
    "laolao-splash-char-soft.png",
    "laolao-theme.css",
    "laolao-provider-openai.svg",
    "laolao-provider-codex.svg",
    "laolao-provider-gemini.svg",
    "laolao-provider-claude.svg",
    "laolao-provider-grok.svg",
    "laolao-provider-deepseek.svg",
    "laolao-provider-kimi.svg",
    "laolao-provider-zai.svg",
    "laolao-provider-minimax.svg",
    "laolao-provider-alibaba.svg",
    "laolao-provider-mistral.svg",
    "laolao-provider-ollama.svg",
    "laolao-provider-doubao.svg",
    "laolao-provider-perplexity.svg",
    "laolao-provider-groq.svg",
    "laolao-provider-hunyuan.svg",
    "laolao-provider-icons-LICENSE.txt",
    "laolao-reasoning-off.svg",
    "laolao-reasoning-minimal.svg",
    "laolao-reasoning-low.svg",
    "laolao-reasoning-medium.svg",
    "laolao-reasoning-high.svg",
    "laolao-reasoning-xhigh.svg",
    "laolao-reasoning-adaptive.svg",
    "laolao-reasoning-max.svg",
    "laolao-reasoning-ultra.svg",
    "laolao-reasoning-frame-off.png",
    "laolao-reasoning-frame-minimal.png",
    "laolao-reasoning-frame-low.png",
    "laolao-reasoning-frame-medium.png",
    "laolao-reasoning-frame-high.png",
    "laolao-reasoning-frame-xhigh.png",
    "laolao-reasoning-frame-adaptive.png",
    "laolao-reasoning-frame-max.png",
    "laolao-reasoning-frame-ultra.png",
    "laolao-reasoning-party-off.svg",
    "laolao-reasoning-party-minimal.svg",
    "laolao-reasoning-party-low.svg",
    "laolao-reasoning-party-medium.svg",
    "laolao-reasoning-party-high.svg",
    "laolao-reasoning-party-xhigh.svg",
    "laolao-reasoning-party-adaptive.svg",
    "laolao-reasoning-party-max.svg",
    "laolao-reasoning-party-ultra.svg",
    "laolao-classic-shell.css",
    "laolao-reading-view.css",
    "laolao-reading-view.js",
    "laolao-sidebar-surface.css",
    "laolao-sidebar-autohide.js",
    "laolao-material-preview.css",
    "laolao-startup-home.css",
    "laolao-startup-home.js",
    "laolao-workspace-focus.css",
    "laolao-classic-shell.js",
    "laolao-side-layout.css",
    "laolao-side-layout.js",
    "laolao-memory.css",
    "laolao-memory.js",
    "laolao-learning-inline.css",
    "laolao-learning-inline.js",
    "laolao-learning-practice.js",
    "laolao-learning-practice.css",
    "laolao-learning-explore.js",
    "laolao-learning-explore.css",
    "laolao-learning-devices.js",
    "laolao-learning-devices.css",
    "laolao-learning-devices-engine.js",
    "laolao-learning-stage.css",
    "laolao-learning-stage.js",
    "laolao-study-desk.js",
    "laolao-study-desk.css",
    "laolao-study-desk-board.js",
    "laolao-study-desk-board.css",
    "laolao-study-desk-lesson.js",
    "laolao-study-desk-lesson.css",
    "laolao-desk-kit.css",
    "laolao-desk-kit.js",
    "laolao-study-desk-split.css",
    "laolao-study-desk-split.js",
    "laolao-study-desk-vocab.css",
    "laolao-study-desk-vocab.js",
    "laolao-study-desk-notes.css",
    "laolao-study-desk-notes.js",
    "laolao-desk-chat.css",
    "laolao-desk-chat.js", "laolao-study-desk-conversation.js",
    "laolao-study-desk-handbook.css",
    "laolao-study-desk-handbook.js",
    "laolao-study-desk-ink.css",
    "laolao-study-desk-panes.css",
    "laolao-learning-reminder.js",
    "laolao-learning-reminder.css",
    "laolao-learning-library.css",
    "laolao-learning-library.js",
    "laolao-vendor-epub.LICENSE.txt",
    "laolao-vendor-epub.mjs",
    "laolao-vendor-fflate.LICENSE.txt",
    "laolao-vendor-pdf-worker.mjs",
    "laolao-vendor-pdf-compat.js",
    "laolao-vendor-pdf.LICENSE.txt",
    "laolao-vendor-pdf.mjs",
    "laolao-learning-question.png",
    "laolao-motion.js",
    "laolao-sidebar.css",
    "laolao-sidebar.js",
    "laolao-usage-stats.css",
    "laolao-usage-stats.js",
    "laolao-quota.json",
    "laolao-splash.css",
    "laolao-splash.js",
    "laolao-splash-fx.js",
    "laolao-handoff-bootstrap.js",
    "laolao-phrases.js",
    "laolao-progress.js",
    "laolao-session-list.js",
    "laolao-live-voice.js",
    "laolao-mode-transition-fx.js",
    "laolao-mode-switcher.js",
    "laolao-model-picker.js",
    "laolao-model-picker.css",
    "laolao-image-viewer.js",
    "laolao-material-preview.js",
    "laolao-workspace-focus.js",
    "laolao-page-warmup.js",
    "laolao-stream-fx.js",
    "laolao-link-viewer.js",
    "laolao-tool-stream.js",
    "laolao-tool-stream.css",
    "laolao-settings-user.css",
    "laolao-settings-user.js",
    "laolao-ask-user.css",
    "laolao-ask-user.js",
    "laolao-process-card.css",
    "laolao-process-card.js",
    "laolao-selection-actions.js",
    "laolao-companion.css",
    "laolao-buddy-rig.js",
    "laolao-companion.js",
    "laolao-redesign.css",
    "laolao-immersion.js",
    "laolao-night.css",
    "laolao-night.js",
    "laolao-pinkie-buddy-chat-rest.png",
    "laolao-pinkie-buddy-chat-typing.png",
    "laolao-pinkie-buddy-chat-working.png",
    "laolao-pinkie-buddy-chat-happy.png",
    "laolao-pinkie-buddy-chat-sleepy.png",
    "laolao-pinkie-buddy-project-rest.png",
    "laolao-pinkie-buddy-project-typing.png",
    "laolao-pinkie-buddy-project-working.png",
    "laolao-pinkie-buddy-project-happy.png",
    "laolao-pinkie-buddy-project-sleepy.png",
    "laolao-pinkie-buddy-thinking-rest.png",
    "laolao-pinkie-buddy-thinking-typing.png",
    "laolao-pinkie-buddy-thinking-working.png",
    "laolao-pinkie-buddy-thinking-happy.png",
    "laolao-pinkie-buddy-thinking-sleepy.png",
    "laolao-pinkie-buddy-learning-rest.png",
    "laolao-pinkie-buddy-learning-typing.png",
    "laolao-pinkie-buddy-learning-working.png",
    "laolao-pinkie-buddy-learning-happy.png",
    "laolao-pinkie-buddy-learning-sleepy.png",
    "laolao-pinkie-buddy-unrestricted-rest.png",
    "laolao-pinkie-buddy-unrestricted-typing.png",
    "laolao-pinkie-buddy-unrestricted-working.png",
    "laolao-pinkie-buddy-unrestricted-happy.png",
    "laolao-pinkie-buddy-unrestricted-sleepy.png",
    "laolao-pinkie-status-thinking.png",
    "laolao-pinkie-status-working.png",
    "laolao-pinkie-status-writing.png",
    "laolao-pinkie-status-done.png",
    "laolao-pinkie-status-oops.png",
    "laolao-pinkie-status-asking.png",
    "laolao-motion-system.css",
    "laolao-mode-menu-fx.css",
    "laolao-mode-transition-fx.css",
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
    "laolao-laser-pointer.js",
    "laolao-web-gpt-collab.js",
    "laolao-context-compact.js",
    "laolao-compaction-glyph.js",
    "laolao-resume.js",
    "laolao-queue-steer.js",
    "laolao-perf.js",
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

    # Study desk libraries/textures are nested; keep licenses and directory names.
    foreach ($resource in @(@{ Root = $InjectRoot; Name = 'vendor' }, @{ Root = $AssetRoot; Name = 'study-desk' })) {
        $resourceRoot = Join-Path $resource.Root $resource.Name
        if (Test-Path $resourceRoot) {
            Get-ChildItem $resourceRoot -Recurse -File | ForEach-Object {
                $relative = $_.FullName.Substring($resource.Root.Length + 1)
                $destination = Join-Path $UiRoot $relative
                New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
                Copy-IfChanged $_.FullName $destination
            }
        }
    }

    # Local PDF auxiliary assets, including font/CMap/wasm licenses, plus workbench Monaco/icons.
    foreach ($vendorName in @(
        "laolao-vendor-pdf-cmaps",
        "laolao-vendor-pdf-standard-fonts",
        "laolao-vendor-pdf-wasm",
        "laolao-vendor-monaco",
        "laolao-vendor-codicons",
        "laolao-vendor-fileicons"
    )) {
        $vendorRoot = Join-Path $InjectRoot $vendorName
        if (Test-Path $vendorRoot) {
            Get-ChildItem $vendorRoot -Recurse -File | ForEach-Object {
                $relative = $_.FullName.Substring($InjectRoot.Length + 1)
                $destination = Join-Path $UiRoot $relative
                New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
                Copy-IfChanged $_.FullName $destination
            }
        }
    }

    $katexRoot = Join-Path $InjectRoot "laolao-katex"
    if (Test-Path $katexRoot) {
        Get-ChildItem $katexRoot -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($InjectRoot.Length + 1)
            $destination = Join-Path $UiRoot $relative
            New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
            Copy-IfChanged $_.FullName $destination
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
        $html = $html -replace "(?i)(<openclaw-app>)", "    <script src=""./laolao-handoff-bootstrap.js?v=handoff7""></script>`n    `$1"
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
    # Rebuild the book's tags together: upgrading an older package cannot leave new dependencies after their users.
    $html = [regex]::Replace($html, '\s*<(?:script|link)\b[^>]*(?:src|href)="(?:\./|/)(?:vendor/lucide/icons\.js|vendor/study\-desk\-before\.js|vendor/gsap/gsap\.min\.js|vendor/gsap/SplitText\.min\.js|vendor/gsap/DrawSVGPlugin\.min\.js|vendor/canvas\-confetti/confetti\.browser\.min\.js|vendor/study\-desk\-after\.js|laolao\-desk\-kit\.css|laolao\-desk\-kit\.js|laolao\-study\-desk\.css|laolao\-study\-desk\-board\.css|laolao\-study\-desk\.js|laolao\-study\-desk\-board\.js|laolao\-study\-desk\-vocab\.css|laolao\-study\-desk\-vocab\.js|laolao\-study\-desk\-lesson\.css|laolao\-study\-desk\-lesson\.js|laolao\-learning\-reminder\.css|laolao\-learning\-reminder\.js|laolao\-study\-desk\-split\.css|laolao\-study\-desk\-split\.js|laolao\-study\-desk\-vocab\.css|laolao\-study\-desk\-vocab\.js|laolao\-study\-desk\-notes\.css|laolao\-study\-desk\-notes\.js|laolao\-desk\-chat\.css|laolao\-desk\-chat\.js|laolao\-study\-desk\-handbook\.css|laolao\-study\-desk\-handbook\.js|laolao\-study\-desk\-ink\.css|laolao\-study\-desk\-panes\.css)(?:\?v=[^"]*)?"[^>]*>(?:</script>)?', '')
    $headTags = @(
        '<script defer src="./vendor/lucide/icons.js?v=lucide04602"></script>',
        '<script defer src="./vendor/study-desk-before.js?v=studydesk2"></script>',
        '<script defer src="./vendor/gsap/gsap.min.js?v=gsap3130"></script>',
        '<script defer src="./vendor/gsap/SplitText.min.js?v=gsap3130"></script>',
        '<script defer src="./vendor/gsap/DrawSVGPlugin.min.js?v=gsap3130"></script>',
        '<script defer src="./vendor/canvas-confetti/confetti.browser.min.js?v=confetti193"></script>',
        '<script defer src="./vendor/study-desk-after.js?v=studydesk2"></script>',
        '<link rel="stylesheet" href="./laolao-desk-kit.css?v=deskfinal6">',
        '<script defer src="./laolao-desk-kit.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk.css?v=deskcards2">',
        '<link rel="stylesheet" href="./laolao-study-desk-board.css?v=deskfinal6">',
        '<script defer src="./laolao-study-desk.js?v=deskcards3"></script>',
        '<script defer src="./laolao-study-desk-board.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk-vocab.css?v=deskfinal6">',
        '<script defer src="./laolao-study-desk-vocab.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk-lesson.css?v=deskfinal6">',
        '<script defer src="./laolao-study-desk-lesson.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-learning-reminder.css?v=deskfinal6">',
        '<script defer src="./laolao-learning-reminder.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk-split.css?v=deskcards1">',
        '<script defer src="./laolao-study-desk-split.js?v=deskcards1"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk-notes.css?v=deskfinal6">',
        '<script defer src="./laolao-study-desk-notes.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-desk-chat.css?v=deskfinal6">',
        '<script defer src="./laolao-study-desk-conversation.js?v=deskfinal6"></script>',
        '<script defer src="./laolao-desk-chat.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk-handbook.css?v=deskfinal6">',
        '<script defer src="./laolao-study-desk-handbook.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-study-desk-ink.css?v=deskfinal6">',
        '<link rel="stylesheet" href="./laolao-study-desk-panes.css?v=deskcards1">',
        '<link rel="stylesheet" href="./laolao-learning-library.css?v=deskfinal6">',
        '<script defer src="./laolao-learning-library.js?v=deskfinal6"></script>',
        '<script src="./laolao-selection-actions.js?v=deskfinal6"></script>',
        '<link rel="stylesheet" href="./laolao-sidebar.css?v=sidebar18">',
        '<link rel="stylesheet" href="./laolao-classic-shell.css?v=classic19">',
        '<link rel="stylesheet" href="./laolao-reading-view.css?v=readingview3">',
        '<script defer src="./laolao-reading-view.js?v=readingview2"></script>',
        '<link rel="stylesheet" href="./laolao-sidebar-surface.css?v=sidebarsurface7">',
        '<script defer src="./laolao-sidebar-autohide.js?v=sidebarautohide8"></script>',
        '<link rel="stylesheet" href="./laolao-side-layout.css?v=side21">',
        '<link rel="stylesheet" href="./laolao-ui-subtraction.css?v=subtraction14">',
        '<link rel="stylesheet" href="./laolao-divider.css?v=divider1">',
        '<link rel="stylesheet" href="./laolao-cle-stage.css?v=clestage21">',
        '<link rel="stylesheet" href="./laolao-tool-rows.css?v=toolrows8">',
        '<script defer src="./laolao-vendor-gsap.min.js?v=gsap3150"></script>',
        '<script defer src="./laolao-cle-signature.js?v=clesig1"></script>',
        '<script type="module" src="./laolao-cle-stage.js?v=clestage22"></script>',
        '<link rel="stylesheet" href="./laolao-material-preview.css?v=material4">',
        '<link rel="stylesheet" href="./laolao-startup-home.css?v=startuphome6">',
        '<script src="./laolao-startup-home.js?v=startuphome9"></script>',
        '<link rel="stylesheet" href="./laolao-workspace-focus.css?v=workspacefocus2">',
        '<link rel="stylesheet" href="./laolao-memory.css?v=memory1">',
        '<link rel="stylesheet" href="./laolao-learning-inline.css?v=learninginline5">',
        '<link rel="stylesheet" href="./laolao-learning-stage.css?v=learning13">',
        '<link rel="stylesheet" href="./laolao-usage-stats.css?v=stats8">',
        '<link rel="stylesheet" href="./laolao-tool-stream.css?v=toolstream3">',
        '<link rel="stylesheet" href="./laolao-settings-user.css?v=settingsuser3">',
        '<link rel="stylesheet" href="./laolao-ask-user.css?v=askuser1">',
        '<link rel="stylesheet" href="./laolao-process-card.css?v=processcard6">',
        '<link rel="stylesheet" href="./laolao-motion-system.css?v=motionsys1">',
        '<link rel="stylesheet" href="./laolao-mode-menu-fx.css?v=modemenufx1">',
        '<link rel="stylesheet" href="./laolao-mode-transition-fx.css?v=modetransitionfx4">',
        '<link rel="stylesheet" href="./laolao-companion.css?v=companion5">',
        '<link rel="stylesheet" href="./laolao-redesign.css?v=redesign8">',
        '<link rel="stylesheet" href="./laolao-night.css?v=night3">',
        '<link rel="stylesheet" href="./laolao-model-picker.css?v=modelpicker15">',
        '<script src="./laolao-sidebar.js?v=sidebar38"></script>',
        '<script src="./laolao-session-list.js?v=sessions11"></script>',
        '<script src="./laolao-usage-stats.js?v=stats16"></script>',
        '<script defer src="./laolao-classic-shell.js?v=classic20"></script>',
        '<script src="./laolao-side-layout.js?v=side12"></script>',
        '<script defer src="./laolao-memory.js?v=memory2"></script>',
        '<link rel="stylesheet" href="/laolao-learning-practice.css?v=learningpractice5">',
        '<script defer src="/laolao-learning-practice.js?v=learningpractice5"></script>',
        '<link rel="stylesheet" href="./laolao-learning-explore.css?v=learningexplore1">',
        '<script defer src="./laolao-learning-explore.js?v=learningexplore1"></script>',
        '<link rel="stylesheet" href="./laolao-learning-devices.css?v=learningdevices1">',
        '<script defer src="./laolao-learning-devices.js?v=learningdevices1"></script>',
        '<script defer src="./laolao-learning-inline.js?v=deskfinal6"></script>',
        '<script defer src="./laolao-learning-stage.js?v=learning20"></script>',
        '<script defer src="./laolao-mode-transition-fx.js?v=modetransitionfx6"></script>',
        '<script defer src="./laolao-model-picker.js?v=modelpicker49"></script>',
        '<script defer src="./laolao-party-entry.js?v=party4"></script>',
        '<script defer src="./laolao-roundtable-entry.js?v=roundtable3"></script>',
        '<script defer src="./laolao-laser-pointer.js?v=laser9"></script>',
        '<script defer src="./laolao-stream-fx.js?v=stream4"></script>',
        '<script defer src="./laolao-link-viewer.js?v=link6"></script>',
        '<script defer src="./laolao-tool-stream.js?v=toolstream5"></script>',
        '<script defer src="./laolao-deep-think.js?v=deepthink27"></script>',
        '<script defer src="./laolao-web-gpt-collab.js?v=webgpt33"></script>',
        '<script defer src="./laolao-context-compact.js?v=contextcompact10"></script>',
        '<script defer src="./laolao-resume.js?v=resume54"></script>',
        '<script defer src="./laolao-queue-steer.js?v=queuesteer3"></script>',
        '<script defer src="./laolao-perf.js?v=perf4"></script>',
        '<script defer src="./laolao-material-preview.js?v=material6"></script>',
        '<script defer src="./laolao-workspace-focus.js?v=workspacefocus2"></script>',
        '<script defer src="./laolao-page-warmup.js?v=warmup1"></script>',
        '<link rel="stylesheet" href="./laolao-rich.css?v=rich5">',
        '<script defer src="./laolao-rich.js?v=rich4"></script>',
        '<script defer src="./laolao-plan.js?v=plan3"></script>',
        '<script defer src="./laolao-capabilities.js?v=capabilities4"></script>',
        '<link rel="stylesheet" href="./laolao-workbench.css?v=workbench14">',
        '<script defer src="./laolao-workbench.js?v=workbench16"></script>',
        '<script defer src="./laolao-settings-user.js?v=settingsuser4"></script>',
        '<script defer src="./laolao-ask-user.js?v=askuser2"></script>',
        '<script defer src="./laolao-process-card.js?v=processcard12"></script>',
        '<script defer src="./laolao-desensitize.js?v=desensitize1"></script>',
        '<script defer src="./laolao-buddy-rig.js?v=buddyrig2"></script>',
        '<script defer src="./laolao-companion.js?v=companion6"></script>',
        '<script defer src="./laolao-immersion.js?v=immersion2"></script>',
        '<script defer src="./laolao-splash-fx.js?v=splashfx2"></script>',
        '<script defer src="./laolao-splash.js?v=splash28"></script>'
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
        'laolao-selection-actions.js' = 'deskfinal6';
        'laolao-theme.css' = 'theme91'; 'laolao-splash.css' = 'splash21'; 'laolao-sidebar.css' = 'sidebar18';
        'laolao-sidebar.js' = 'sidebar38'; 'laolao-session-list.js' = 'sessions11'; 'laolao-usage-stats.js' = 'stats16';
        'laolao-phrases.js' = 'phrases30'; 'laolao-live-voice.js' = 'voice4'; 'laolao-stream-fx.js' = 'stream4';
        'laolao-mode-transition-fx.js' = 'modetransitionfx6'; 'laolao-mode-transition-fx.css' = 'modetransitionfx4';
        'laolao-mode-menu-fx.css' = 'modemenufx1'; 'laolao-mode-switcher.js' = 'mode45'; 'laolao-model-picker.js' = 'modelpicker49'; 'laolao-model-picker.css' = 'modelpicker15'; 'laolao-splash.js' = 'splash28'; 'laolao-splash-fx.js' = 'splashfx2';
        'laolao-handoff-bootstrap.js' = 'handoff7'; 'laolao-motion.js' = 'motion6'; 'laolao-resume.js' = 'resume54';
        'laolao-queue-steer.js' = 'queuesteer3';
        'laolao-perf.js' = 'perf4';
        'laolao-tool-stream.css' = 'toolstream3';
        'laolao-progress.js' = 'progress5';
        'laolao-settings-user.css' = 'settingsuser3'; 'laolao-settings-user.js' = 'settingsuser4';
        'laolao-ask-user.css' = 'askuser1'; 'laolao-ask-user.js' = 'askuser2';
        'laolao-process-card.css' = 'processcard6'; 'laolao-process-card.js' = 'processcard12';
        'laolao-desensitize.js' = 'desensitize1';
        'laolao-ui-subtraction.css' = 'subtraction14'; 'laolao-usage-stats.css' = 'stats8';
        'laolao-material-preview.css' = 'material4'; 'laolao-material-preview.js' = 'material6';
        'laolao-startup-home.css' = 'startuphome6'; 'laolao-startup-home.js' = 'startuphome9';
        'laolao-workspace-focus.css' = 'workspacefocus2'; 'laolao-workspace-focus.js' = 'workspacefocus2';
        'laolao-page-warmup.js' = 'warmup1'; 'laolao-motion-system.css' = 'motionsys1';
        'laolao-link-viewer.js' = 'link6';
        'laolao-sidebar-surface.css' = 'sidebarsurface7'; 'laolao-sidebar-autohide.js' = 'sidebarautohide8';
        'laolao-companion.css' = 'companion5'; 'laolao-buddy-rig.js' = 'buddyrig2'; 'laolao-companion.js' = 'companion6'; 'laolao-redesign.css' = 'redesign8'; 'laolao-immersion.js' = 'immersion2';
        'laolao-night.css' = 'night3'; 'laolao-night.js' = 'night2';
        'laolao-classic-shell.css' = 'classic19'; 'laolao-classic-shell.js' = 'classic20';
        'laolao-side-layout.css' = 'side21'; 'laolao-side-layout.js' = 'side12';
        'laolao-memory.css' = 'memory1'; 'laolao-memory.js' = 'memory2';
        'vendor/lucide/icons.js' = 'lucide04602';
        'vendor/study-desk-before.js' = 'studydesk2';
        'laolao-study-desk-panes.css' = 'deskcards1';
        'laolao-study-desk-ink.css' = 'deskfinal6';
        'laolao-study-desk-handbook.js' = 'deskfinal6';
        'laolao-study-desk-handbook.css' = 'deskfinal6';
        'laolao-study-desk-conversation.js' = 'deskfinal6'; 'laolao-desk-chat.js' = 'deskfinal6';
        'laolao-desk-chat.css' = 'deskfinal6';
        'laolao-study-desk-notes.js' = 'deskfinal6';
        'laolao-study-desk-notes.css' = 'deskfinal6';
        'laolao-study-desk-split.js' = 'deskcards1';
        'laolao-study-desk-split.css' = 'deskcards1';
        'laolao-study-desk-vocab.js' = 'deskfinal6';
        'laolao-study-desk-vocab.css' = 'deskfinal6';
        'laolao-desk-kit.js' = 'deskfinal6';
        'laolao-desk-kit.css' = 'deskfinal6';
        'vendor/gsap/gsap.min.js' = 'gsap3130';
        'vendor/gsap/SplitText.min.js' = 'gsap3130';
        'vendor/gsap/DrawSVGPlugin.min.js' = 'gsap3130';
        'vendor/canvas-confetti/confetti.browser.min.js' = 'confetti193';
        'vendor/study-desk-after.js' = 'studydesk2';
        'laolao-study-desk.css' = 'deskcards2';
        'laolao-study-desk-board.css' = 'deskfinal6';
        'laolao-study-desk.js' = 'deskcards3';
        'laolao-study-desk-board.js' = 'deskfinal6';
        'laolao-study-desk-lesson.css' = 'deskfinal6';
        'laolao-study-desk-lesson.js' = 'deskfinal6';
        'laolao-learning-reminder.css' = 'deskfinal6';
        'laolao-learning-reminder.js' = 'deskfinal6';
        'laolao-learning-library.js' = 'deskfinal6'; 'laolao-learning-library.css' = 'deskfinal6';
        'laolao-learning-practice.css' = 'learningpractice5'; 'laolao-learning-practice.js' = 'learningpractice5'; 'laolao-learning-inline.css' = 'learninginline5'; 'laolao-learning-inline.js' = 'deskfinal6'; 'laolao-learning-explore.css' = 'learningexplore1'; 'laolao-learning-explore.js' = 'learningexplore1';
        'laolao-learning-stage.css' = 'learning13'; 'laolao-learning-stage.js' = 'learning20';
        'laolao-deep-think.js' = 'deepthink27'; 'laolao-web-gpt-collab.js' = 'webgpt33';
        'laolao-rich.js' = 'rich4'; 'laolao-rich.css' = 'rich5'; 'laolao-plan.js' = 'plan3'; 'laolao-capabilities.js' = 'capabilities4';
        'laolao-workbench.js' = 'workbench16'; 'laolao-workbench.css' = 'workbench14';
        'laolao-divider.css' = 'divider1'; 'laolao-tool-rows.css' = 'toolrows8';
        'laolao-cle-signature.js' = 'clesig1'; 'laolao-cle-stage.css' = 'clestage21'; 'laolao-cle-stage.js' = 'clestage22';
        'laolao-vendor-gsap.min.js' = 'gsap3150';
        'laolao-context-compact.js' = 'contextcompact10'
    }
    foreach ($entry in $versions.GetEnumerator()) {
        # 版本号字符集收紧，避免第二次运行时贪婪越过版本号把后续内容吃掉。
        $pattern = '((?:\./|/)' + [regex]::Escape($entry.Key) + ')(?:\?v=[A-Za-z0-9_.-]*)?'
        $html = [regex]::Replace($html, $pattern, ('$1?v=' + $entry.Value))
    }
    # Hide old history before the native deferred module can paint it.
    $html = [regex]::Replace($html,
        '(?is)<script\b[^>]*src="(?:\./|/)laolao-startup-home\.js(?:\?v=[^"]*)?"[^>]*>\s*</script>',
        '<script src="./laolao-startup-home.js?v=startuphome9"></script>')

    # A legacy page can already contain the switcher before the newly added FX
    # module. Deferred scripts still respect source order, so normalise just
    # this pair before the document is written back.
    $html = [regex]::Replace(
        $html,
        '(?is)(<script\b[^>]*\bsrc="(?:\./|/)laolao-mode-switcher\.js(?:\?v=[^"]*)?"[^>]*>\s*</script>)\s*(<script\b[^>]*\bsrc="(?:\./|/)laolao-mode-transition-fx\.js(?:\?v=[^"]*)?"[^>]*>\s*</script>)',
        "`$2`n`$1"
    )

    # Some legacy heads keep other tags between FX and the switcher. Move the
    # former beside the latter so deferred execution order is reliable.
    $fxTag = '<script defer src="./laolao-mode-transition-fx.js?v=modetransitionfx6"></script>'
    $switcherTag = '<script defer src="./laolao-mode-switcher.js?v=mode45"></script>'
    $fxPattern = '(?is)\s*<script\b[^>]*\bsrc="(?:\./|/)?laolao-mode-transition-fx\.js(?:\?v=[^"]*)?"[^>]*>\s*</script>\s*'
    $html = [regex]::Replace($html, $fxPattern, "`n")
    $switcherPattern = '(?is)<script\b[^>]*\bsrc="(?:\./|/)?laolao-mode-switcher\.js(?:\?v=[^"]*)?"[^>]*>\s*</script>'
    $switcherMatch = [regex]::Match($html, $switcherPattern)
    if ($switcherMatch.Success) {
        $html = $html.Substring(0, $switcherMatch.Index) + "    $fxTag`n    " + $html.Substring($switcherMatch.Index)
    } else {
        $html = $html -replace "(?i)(</head>)", "    $fxTag`n    $switcherTag`n`$1"
    }

    # The native timeline patch checks the renderer structure as one unit and
    # leaves unknown OpenClaw bundles byte-for-byte untouched.

    # Give both the entry module and its lazy chat chunk a revisioned URL.
    # This bypasses an already-running cache-first worker immediately.
    $html = [regex]::Replace(
        $html,
        '(src="(?:\./|/)assets/index-[^"?]+\.js)(?:\?([^"]*))?"',
        [System.Text.RegularExpressions.MatchEvaluator]{ param($match)
            $extra = @($match.Groups[2].Value -split '&' | Where-Object { $_ -and $_ -notmatch '^v=' })
            $query = '?v=clekk-history59'
            if ($extra.Count -gt 0) { $query += '&' + ($extra -join '&') }
            return $match.Groups[1].Value + $query + '"'
        }
    )
    Get-ChildItem (Join-Path $UiRoot 'assets') -Filter 'index-*.js' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $entryBundle = Get-Content $_.FullName -Raw -Encoding UTF8
        $entryBundle = [regex]::Replace(
            $entryBundle,
            '(\./chat-page-[A-Za-z0-9_-]+\.js)(?:\?v=[^`"'']*)?',
            '$1?v=clekk-history59'
        )
        $entryBundle | Set-Content $_.FullName -Encoding UTF8 -NoNewline
    }

    # 开关总是先执行，样式总是最后覆盖；已有 fragment 也要重新定位。
    $html = [regex]::Replace($html, '(?is)\n?[ \t]*<script\b[^>]*\bsrc="(?:\./|/)?laolao-night\.js[^"]*"[^>]*>\s*</script>', '')
    $html = [regex]::Replace($html, '(?is)\n?[ \t]*<link\b[^>]*\bhref="(?:\./|/)?laolao-night\.css[^"]*"[^>]*>', '')
    $html = $html -replace '(?i)(<head[^>]*>)', "`$1`n    <script src=`"./laolao-night.js?v=night2`"></script>"
    $html = $html -replace '(?i)\s*(</head>)', "`n    <link rel=`"stylesheet`" href=`"./laolao-night.css?v=night3`">`n`$1"

    # 绝对到站点根目录，设置/概览等嵌套路由不再把头像和皮肤解析到
    # /settings/laolao-*，从而避免黑屏、裂图和透明度闪一下。
    $html = $html.Replace('"./laolao-', '"/laolao-')
    $html = $html.Replace('"./assets/', '"/assets/')
    $html = $html.Replace('"./favicon-32.png', '"/favicon-32.png')
    $html = $html.Replace('"./manifest.webmanifest', '"/manifest.webmanifest')
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
                'apply-chat-timeline.mjs',
                'apply-chat-math.mjs',
                'apply-chat-linebreaks.mjs',
                'apply-composer-drafts.mjs',
                'apply-context-budget.mjs',
                'apply-compaction-boundary-recovery.mjs',
                'apply-loopback-model-reliability.mjs',
                'apply-work-thinking.mjs',
                'apply-thinking-capabilities.mjs',
                'apply-image-access.mjs',
                'apply-material-preview-csp.mjs',
                'apply-control-ui-workspace-media.mjs',
                'apply-control-ui-file-delivery.mjs',
                'apply-local-unrestricted-policy.mjs',
                'apply-computer-v2.mjs'
            ) | ForEach-Object { Join-Path $RepoRoot "patch\$_" } | Where-Object { Test-Path $_ }
            if ($node -and $runtimePatches.Count -gt 0) {
                $previousRoot = $env:OPENCLAW_ROOT
                try {
                    $env:OPENCLAW_ROOT = $packageRoot
                    foreach ($runtimePatch in $runtimePatches) {
                        try { & $node.Source $runtimePatch | Out-Null } catch {}
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
