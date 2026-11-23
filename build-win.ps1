# build-win.ps1 — 构建内置 Node.js、OpenClaw、网关和 WebView2 桌面壳的超級碧琪 Windows App
[CmdletBinding()]
param(
    # onedir avoids PyInstaller's onefile self-extraction (hundreds of MB) on every launch.
    # Pass -LegacyOneFile when a standalone compatibility EXE is also required for releases.
    [switch]$LegacyOneFile,
    # Local developers may use a compatible Node 24.x patch release. CI keeps
    # the manifest's exact version for reproducible release artifacts.
    [switch]$AllowLocalNodeVersion,
    # Build into another folder so a running App is not overwritten. The
    # launcher EXE is mapped while the App is open, so writing into the live
    # dist\<app> folder fails with a sharing violation.
    [string]$DistRoot = "dist"
)
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$coreManifestPath = Join-Path $RepoRoot "core-manifest.json"
$coreManifest = Get-Content $coreManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$coreHelper = Join-Path $RepoRoot "tools\core\manifest.mjs"
$runtimeStage = Join-Path $RepoRoot "build\windows-runtime"
$runtimeBin = Join-Path $runtimeStage "bin"
$runtimeModules = Join-Path $runtimeStage "node_modules"

python -m pip install --disable-pip-version-check --upgrade pip pyinstaller "pywebview==6.2.1" pywin32 edge-tts aiohttp pyyaml
if ($LASTEXITCODE -ne 0) { throw "Python 构建依赖安装失败，请检查本机网络或 Python 3.12 环境" }
python -c "import sqlite3, _sqlite3; print('sqlite3 bundled:', sqlite3.sqlite_version)"
if ($LASTEXITCODE -ne 0) { throw "当前 Python 缺少 sqlite3/_sqlite3，无法构建派对和圆桌服务" }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$coreInfo = (& $node $coreHelper info --root $RepoRoot | Out-String | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or -not $coreInfo) { throw "无法解析 core-manifest.json（请检查 PINKIE_CORE 与清单格式）" }
$nodeVersion = (& $node --version).TrimStart('v')
if ($nodeVersion -ne $coreInfo.node) {
    if (-not $AllowLocalNodeVersion -or $nodeVersion -notmatch '^24\.') {
        throw "Node.js 版本不一致：需要 $($coreInfo.node)，构建机是 $nodeVersion；本机开发构建可加 -AllowLocalNodeVersion（仅接受 Node 24.x）"
    }
    Write-Warning "本机开发构建使用 Node.js $nodeVersion（发行构建仍固定 $($coreInfo.node)）"
}

if (Test-Path $runtimeStage) { Remove-Item $runtimeStage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtimeBin | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeBin "node.exe") -Force

# 碧琪的浏览器的「浏览器节点」：mihomo 内核（GPL-3.0，单独的未修改可执行文件，见 THIRD_PARTY_NOTICES）。
# 固定版本 + SHA256，缓存到 build\cache，离线重建不用再下。只给内置浏览器的 WebView2 用，不碰系统代理。
$mihomoVersion = "v1.19.33"
$mihomoZipName = "mihomo-windows-amd64-compatible-$mihomoVersion.zip"
$mihomoSha256 = "7aaf636a4f2172dcd8ec34ac4f52797b059195e5afd6409508c963e545f8864d"
$buildCache = Join-Path $RepoRoot "build\cache"
New-Item -ItemType Directory -Force -Path $buildCache | Out-Null
$mihomoZip = Join-Path $buildCache $mihomoZipName
if (-not (Test-Path -LiteralPath $mihomoZip) -or (Get-FileHash -LiteralPath $mihomoZip -Algorithm SHA256).Hash.ToLower() -ne $mihomoSha256) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/MetaCubeX/mihomo/releases/download/$mihomoVersion/$mihomoZipName" -OutFile $mihomoZip
}
if ((Get-FileHash -LiteralPath $mihomoZip -Algorithm SHA256).Hash.ToLower() -ne $mihomoSha256) {
    Remove-Item -LiteralPath $mihomoZip -Force
    throw "mihomo 下载校验失败（SHA256 不一致）"
}
$browserVpnStage = Join-Path $runtimeStage "browser-vpn"
New-Item -ItemType Directory -Force -Path $browserVpnStage | Out-Null
$mihomoUnpack = Join-Path $buildCache "mihomo-unpack"
if (Test-Path -LiteralPath $mihomoUnpack) { Remove-Item -LiteralPath $mihomoUnpack -Recurse -Force }
Expand-Archive -LiteralPath $mihomoZip -DestinationPath $mihomoUnpack -Force
$mihomoExe = Get-ChildItem -LiteralPath $mihomoUnpack -Filter "*.exe" -Recurse | Select-Object -First 1
if (-not $mihomoExe) { throw "mihomo 压缩包里没有 exe" }
Copy-Item -LiteralPath $mihomoExe.FullName -Destination (Join-Path $browserVpnStage "mihomo.exe") -Force

# 打包不碰构建机上真实的用户目录：内核安装（npm 安装脚本）、皮肤注入（会往 ~\.openclaw\workspace*
# 写头像）和补丁都在 build\home 里跑，跑完恢复。npm 仍读构建机自己的 .npmrc（代理、镜像）。
$isolatedHome = Join-Path $RepoRoot "build\home"
$isolatedUserEnv = [ordered]@{
    HOME = Join-Path $isolatedHome "home"
    USERPROFILE = Join-Path $isolatedHome "home"
    APPDATA = Join-Path $isolatedHome "appdata"
    LOCALAPPDATA = Join-Path $isolatedHome "localappdata"
    OPENCLAW_HOME = Join-Path $isolatedHome "home"
    OPENCLAW_STATE_DIR = Join-Path $isolatedHome "openclaw-state"
}
$savedUserEnv = @{}
foreach ($name in @($isolatedUserEnv.Keys) + @('npm_config_userconfig')) {
    $savedUserEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
function Restore-BuildUserEnv {
    foreach ($name in $savedUserEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedUserEnv[$name], 'Process') }
}
# trap 对整个脚本生效（包括这一段之前），所以不依赖上面的函数，只在已保存过时才恢复。
trap { if ($savedUserEnv) { foreach ($name in @($savedUserEnv.Keys)) { [Environment]::SetEnvironmentVariable($name, $savedUserEnv[$name], 'Process') } }; break }
if (Test-Path -LiteralPath $isolatedHome) { Remove-Item -LiteralPath $isolatedHome -Recurse -Force }
foreach ($name in $isolatedUserEnv.Keys) {
    New-Item -ItemType Directory -Force -Path $isolatedUserEnv[$name] | Out-Null
    [Environment]::SetEnvironmentVariable($name, $isolatedUserEnv[$name], 'Process')
}
if (-not $savedUserEnv['npm_config_userconfig'] -and $savedUserEnv['USERPROFILE']) {
    $env:npm_config_userconfig = Join-Path $savedUserEnv['USERPROFILE'] '.npmrc'
}

# registry.npmjs.org stalled here for minutes at a time (15 idle
# connections, zero CPU) while the mirror finished the same install in
# six minutes. Only this build step is pointed at the mirror; the
# core selection (openclaw / cle), version, URL and SHA-256 all come
# from core-manifest.json.
$npmRegistry = if ($env:PINKIE_NPM_REGISTRY) { $env:PINKIE_NPM_REGISTRY } else { "https://registry.npmmirror.com" }
$coreCache = Join-Path $buildCache "core"
Write-Host "==> installing core '$($coreInfo.core)' ($($coreInfo.version)) from core-manifest.json"
& $node $coreHelper install --root $RepoRoot --prefix $runtimeStage --registry $npmRegistry --cache-dir $coreCache
if ($LASTEXITCODE -ne 0) { throw "内置内核（$($coreInfo.core)@$($coreInfo.version)）下载或校验失败" }
$openclawRoot = Join-Path $runtimeModules "openclaw"
if (-not (Test-Path (Join-Path $openclawRoot "openclaw.mjs"))) {
    throw "内置内核运行时不完整：$openclawRoot"
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
Copy-Item -Path (Join-Path $RepoRoot "personas\*") -Destination $personaStage -Recurse -Force
# The workspace installer and its reference file must come from shared source.
foreach ($asset in @(
    (Join-Path $serviceStage "mode-architecture\metre_role_assets.py"),
    (Join-Path $personaStage "thinking\AESTHETICS.md"),
    (Join-Path $personaStage "project\playbooks\toolbox.mjs")
)) {
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) { throw "缺少 Metre 角色资源 $asset" }
}
$officialRoles = Join-Path $RepoRoot "personas\metre\roles"
if (Test-Path -LiteralPath $officialRoles -PathType Container) {
    foreach ($card in (Get-ChildItem -LiteralPath $officialRoles -File -Filter '*.md')) {
        $bundledCard = Join-Path $personaStage ("metre\roles\" + $card.Name)
        if (-not (Test-Path -LiteralPath $bundledCard -PathType Leaf) -or
            (Get-FileHash -LiteralPath $bundledCard).Hash -ne (Get-FileHash -LiteralPath $card.FullName).Hash) {
            throw "Metre 官方角色卡未正确打包 $($card.Name)"
        }
    }
}
Copy-Item -Path (Join-Path $RepoRoot "ui\*") -Destination $uiStage -Recurse -Force
if ($env:PINKIE_RELEASE_BUILD -eq '1') {
    Copy-Item -LiteralPath (Join-Path $RepoRoot "ui\assets\laolao-splash-release.mp4") -Destination (Join-Path $uiStage "assets\laolao-splash.mp4") -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot "ui\assets\laolao-splash-video-poster-release.png") -Destination (Join-Path $uiStage "assets\laolao-splash-video-poster.png") -Force
}
Copy-Item -Path (Join-Path $RepoRoot "installer\windows\*") -Destination $windowsInstallerStage -Recurse -Force
# 社区技能按 skills/community-skills.json 一起打包；技能路由（skill-routes.mjs）把路径直接给模型。
$skillManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepoRoot "skills\community-skills.json") | ConvertFrom-Json
$communitySkills = @(@($skillManifest.own) + @($skillManifest.skills) | Where-Object { $_ } | ForEach-Object { $_.name })
if ($communitySkills.Count -eq 0) { throw "社区技能清单是空的" }
foreach ($skill in @("deep-think", "pinkie-deep-research", "web-gpt-collab", "pinkie-skill-library") + $communitySkills) {
    $source = Join-Path $RepoRoot "skills\$skill"
    if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) { throw "缺少打包技能 $skill" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $managedSkillStage $skill) -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $RepoRoot "skills\THIRD_PARTY_SKILLS.md") -Destination (Join-Path $managedSkillStage "THIRD_PARTY_SKILLS.md") -Force

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
    if ($rel -match '^services/mode-architecture/(index\.mjs|setup\.py|metre-roles\.mjs|metre-board\.mjs|metre_role_assets\.py)$') {
        throw "模式引擎和 Metre 角色资源必须使用公共源码，不能由快照覆盖：$rel"
    }
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
& $node (Join-Path $RepoRoot 'tools\assets\stamp.mjs') --root $RepoRoot --control-ui $controlUi --manifest (Join-Path $runtimeStage 'windows-ui-manifest.json')
if ($LASTEXITCODE -ne 0) { throw "Windows Control UI asset hash stamping failed" }
& (Join-Path $RepoRoot "tools\windows-package\check_shared_chat.ps1") `
    -SourceRuntime (Join-Path $RepoRoot "ui\runtime") `
    -PackagedAssets (Join-Path $openclawRoot "dist\control-ui\assets")
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
Restore-BuildUserEnv

$runtimeInfo = @{
    architecture = $env:PROCESSOR_ARCHITECTURE
    core = $coreInfo.core
    coreVersion = $coreInfo.version
    node = $nodeVersion
    openclaw = $coreInfo.version
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
    "--add-data", "$(Join-Path $runtimeStage 'browser-vpn');runtime\browser-vpn",
    "--add-data", "desktop\macos\pinkie\Sources\BrowserControl.js;inapp-browser",
    "--add-data", "prompts;prompts",
    "--add-data", "proxy;proxy",
    "--add-data", "patch;patch",
    "--add-data", "$personaStage;personas",
    "--add-data", "$managedSkillStage;bundled-skills",
    "--add-data", "$serviceStage;services",
    "--add-data", "$uiStage;ui",
    "--add-data", "$windowsInstallerStage;installer\windows",
    "--add-data", "installer\guard;installer\guard",
    "--add-data", "tools\ui-parity;tools\ui-parity",
    "--add-data", "tools\assets;tools\assets",
    "--add-data", "tools\core;tools\core",
    "--add-data", "core-manifest.json;.",
    "--add-data", "scripts;scripts",
    "--add-data", "desktop\windows\THIRD_PARTY_NOTICES.md;runtime",
    "--add-data", "VERSION;.",
    "--add-data", "update-mirrors.json;.",
    "--add-data", "desktop\windows\release-notes.md;.",
    "--add-data", "config.example.json;.",
    "app\super_pinkie.py"
)

$guardChannel = if ($env:PINKIE_RELEASE_BUILD -eq '1') { 'release' } else { 'dev' }
$guardCommitRaw = (git rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $guardCommitRaw) { $guardCommitRaw = '' }
$guardCommit = "$guardCommitRaw".Trim()
$guardVersion = (Get-Content -LiteralPath (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
# 先给暂存目录里的人设写入不可见来源标记，确保 onedir 和 LegacyOneFile 打包到同一份内容，和 guard-manifest.json 哈希一致。
& (Join-Path $runtimeBin 'node.exe') (Join-Path $RepoRoot 'installer\guard\guard.mjs') stamp-personas $personaStage --version $guardVersion --commit $guardCommit --channel $guardChannel
if ($LASTEXITCODE -ne 0) { throw '人设来源标记写入失败' }

# Build the fast-starting directory layout by default.  PyInstaller keeps all
# resources next to the launcher, so Windows no longer has to unpack ~700 MB
# into a temporary _MEI directory before showing the window.
pyinstaller @pyInstallerCommonArgs --onedir --distpath $DistRoot
if ($LASTEXITCODE -ne 0) { throw "Windows EXE 构建失败" }
if (-not (Test-Path -LiteralPath (Join-Path $DistRoot '超級碧琪\超級碧琪.exe'))) {
    throw "Windows onedir 构建产物缺失"
}
$packageDir = Join-Path $DistRoot '超級碧琪'

# 产品设定防护开关：写死在包里（build-info.json），运行时只认这个文件，不读环境变量。
# CI 发版（release.yml 设 PINKIE_RELEASE_BUILD=1，并给 PINKIE_GUARD_SIGNING_KEY_FILE）→ 正式版，防护开、清单签名；
# 其它（本机开发构建）→ 开发版，防护关。Windows 用户只装 CI 打的包，不在本机重新打包。
$bundleRoot = Join-Path $packageDir '_internal'
if ($guardChannel -eq 'release') {
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'ui\assets\laolao-splash-release.mp4') -Destination (Join-Path $bundleRoot 'ui\assets\laolao-splash.mp4') -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'ui\assets\laolao-splash-video-poster-release.png') -Destination (Join-Path $bundleRoot 'ui\assets\laolao-splash-video-poster.png') -Force
}
$buildInfo = [ordered]@{ guard = ($guardChannel -eq 'release'); channel = $guardChannel; version = $guardVersion; commit = $guardCommit }
if ($guardChannel -eq 'release') {
    $fb = [ordered]@{}
    if ($env:PINKIE_FEEDBACK_REPO) { $fb.repo = $env:PINKIE_FEEDBACK_REPO.Trim() }
    if ($env:PINKIE_FEEDBACK_PUBLIC_KEY) { $fb.publicKey = $env:PINKIE_FEEDBACK_PUBLIC_KEY.Trim() }
    if ($env:PINKIE_FEEDBACK_TOKEN) { $fb.token = $env:PINKIE_FEEDBACK_TOKEN.Trim() }
    if ($env:PINKIE_FEEDBACK_RELAY_URL) { $fb.endpoint = $env:PINKIE_FEEDBACK_RELAY_URL.Trim() }
    if ($fb.Count -gt 0) { $buildInfo.feedback = $fb }
}
[System.IO.File]::WriteAllText((Join-Path $bundleRoot 'build-info.json'), ($buildInfo | ConvertTo-Json -Depth 4) + "`n", (New-Object System.Text.UTF8Encoding($false)))
& (Join-Path $runtimeBin 'node.exe') (Join-Path $RepoRoot 'installer\guard\guard.mjs') manifest $bundleRoot --commit $guardCommit
if ($LASTEXITCODE -ne 0) { throw '设定防护清单生成失败' }
if ($env:PINKIE_GUARD_SIGNING_KEY_FILE) {
    & (Join-Path $runtimeBin 'node.exe') (Join-Path $RepoRoot 'installer\guard\guard.mjs') sign $bundleRoot $env:PINKIE_GUARD_SIGNING_KEY_FILE
    if ($LASTEXITCODE -ne 0) { throw '设定防护清单签名失败' }
} elseif ($guardChannel -eq 'release') {
    throw '正式版打包缺少防护签名私钥（PINKIE_GUARD_SIGNING_KEY_FILE）'
}
$guardStage = Join-Path $RepoRoot 'build\windows-guard'
if (Test-Path $guardStage) { Remove-Item $guardStage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $guardStage | Out-Null
foreach ($name in @('build-info.json', 'guard-manifest.json', 'guard-manifest.sig')) {
    $file = Join-Path $bundleRoot $name
    if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $guardStage $name) -Force }
}

python tools/windows-package/clean_ui.py --check-package $packageDir
if ($LASTEXITCODE -ne 0) { throw "Windows 包含其他产品的素材或缺少安装器" }
$controlUiPackage = Join-Path $packageDir '_internal\runtime\node_modules\openclaw\dist\control-ui'
$uiManifest = Join-Path $DistRoot 'windows-ui-manifest.json'
python tools/ui-parity/bundle.py check --control-ui $controlUiPackage --output $uiManifest
if ($LASTEXITCODE -ne 0) { throw 'Packaged Control UI differs from the shared source' }
python tools/windows-package/check_runtime.py --package $packageDir
if ($LASTEXITCODE -ne 0) { throw "Windows 包缺少运行时文件，或打过补丁的文件被改回去了" }

if ($LegacyOneFile) {
    # 单文件版带同一份 build-info / 签名清单（内容和 onedir 的 _internal 一致）。
    $guardData = @()
    foreach ($item in Get-ChildItem -LiteralPath $guardStage -File) { $guardData += @('--add-data', "$($item.FullName);.") }
    pyinstaller @guardData @pyInstallerCommonArgs --onefile --distpath $DistRoot
    if ($LASTEXITCODE -ne 0) { throw "Windows 兼容 EXE 构建失败" }
    if (-not (Test-Path -LiteralPath (Join-Path $DistRoot '超級碧琪.exe'))) {
        throw "Windows onefile 构建产物缺失"
    }
}

Write-Host "构建完成: dist\超級碧琪\超級碧琪.exe"
if ($LegacyOneFile) { Write-Host "兼容构建完成: dist\超級碧琪.exe" }
