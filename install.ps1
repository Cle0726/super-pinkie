# install.ps1 — Windows 一键安装脚本（超級碧琪 接 API 即用版）
#
# 做了什么：
#   1. 把 prompts\*.txt 复制到 %USERPROFILE%\.openclaw\（可用 UR_PROMPTS_DIR 覆盖）
#   2. 打双传输层补丁（rewrite + context-budget）via node
#   3. 安装 context 策略服务
#   4. 安装人格文件到各工作区（chat / project / thinking / neutral）
#   5. 注入 来啦～老弟 皮肤到 OpenClaw UI
#   6. 以计划任务启动代理 Proxy（登录自启）
#   7. 可选：把指定 Provider 指向代理
#
# 用法（PowerShell，以管理员身份运行）：
#   .\install.ps1                     # 全量安装
#   .\install.ps1 -Provider mm        # 同时把 mm 提供商指向代理
#   .\install.ps1 -SkipTheme          # 跳过 UI 皮肤注入
#   .\install.ps1 -Remove             # 卸载：移除补丁、停止代理、删除计划任务
#
# 环境变量覆盖：
#   $env:UR_PROMPTS_DIR, $env:UR_PROXY_LISTEN, $env:UR_PROXY_UPSTREAM_PORT, $env:OPENCLAW_ROOT

param(
  [string]$Provider   = "",
  [switch]$Remove     = $false,
  [switch]$SkipTheme  = $false
)

$ErrorActionPreference = "Stop"
$RepoDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$PromptsDir   = if ($env:UR_PROMPTS_DIR) { $env:UR_PROMPTS_DIR } else { Join-Path $env:USERPROFILE ".openclaw" }
$ProxyPort    = if ($env:UR_PROXY_LISTEN) { $env:UR_PROXY_LISTEN } elseif ($env:UR_PROXY_PORT) { $env:UR_PROXY_PORT } else { "1467" }
$UpstreamPort = if ($env:UR_PROXY_UPSTREAM_PORT) { $env:UR_PROXY_UPSTREAM_PORT } elseif ($env:UR_UPSTREAM_PORT) { $env:UR_UPSTREAM_PORT } else { "1466" }
$ProxyScript  = Join-Path $RepoDir "proxy\mm-retry-proxy.py"
$PatchScript  = Join-Path $RepoDir "patch\reapply-unrestricted-patch.mjs"
$TaskName     = "OpenClawURProxy"
$GatewayWatchdogTask = "OpenClawGatewayWatchdog"
$GatewayWatchdog = Join-Path $RepoDir "services\watchdog\windows-gateway-watchdog.ps1"
$UserHome     = $env:USERPROFILE

function Resolve-PythonWindowless {
  $candidate = Get-Command "pythonw.exe" -ErrorAction SilentlyContinue
  if ($candidate) { return $candidate.Source }
  $candidate = Get-Command "python.exe" -ErrorAction SilentlyContinue
  if ($candidate) { return $candidate.Source }
  throw "找不到 Python（需要 pythonw.exe 或 python.exe）"
}

# ── 卸载模式 ──────────────────────────────────────────────────────────────
if ($Remove) {
  Write-Host "==> stripping transport patches"
  node $PatchScript --remove
  Write-Host "==> stopping proxy + removing scheduled task"
  Stop-ScheduledTask    -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Stop-ScheduledTask    -TaskName $GatewayWatchdogTask -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $GatewayWatchdogTask -Confirm:$false -ErrorAction SilentlyContinue
  Get-Process -Name "python*" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -like "*mm-retry-proxy*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "done. Config baseUrl changes (if any) must be reverted manually."
  exit 0
}

# ── 1/6  提示词 ───────────────────────────────────────────────────────────
Write-Host "==> 1/6  copying prompts -> $PromptsDir"
New-Item -ItemType Directory -Force -Path $PromptsDir | Out-Null
Copy-Item (Join-Path $RepoDir "prompts\unrestricted-prompt-*.txt") $PromptsDir -Force
$count = (Get-ChildItem (Join-Path $RepoDir "prompts\unrestricted-prompt-*.txt")).Count
Write-Host "    $count prompt files installed"

# ── 2/6  传输层补丁 ───────────────────────────────────────────────────────
Write-Host "==> 2/6  patching OpenClaw transports"
node $PatchScript
if ($LASTEXITCODE -ne 0) { throw "Transport patch failed" }
node (Join-Path $RepoDir "patch\apply-context-budget.mjs")
if ($LASTEXITCODE -ne 0) { throw "Context protection patch failed" }
python (Join-Path $RepoDir "services\context\setup.py")
if ($LASTEXITCODE -ne 0) { throw "Context policy setup failed" }

# 本地回环网关不应被浏览器 token 欢迎页拦住；保留 token 字段，只收口启动方式。
$ConfigPath = Join-Path $PromptsDir "openclaw.json"
if (Test-Path $ConfigPath) {
  $configRaw = Get-Content $ConfigPath -Raw -Encoding UTF8
  $config = $configRaw | ConvertFrom-Json
  $configChanged = $false
  if (-not $config.gateway) { $config | Add-Member -NotePropertyName gateway -NotePropertyValue ([pscustomobject]@{}); $configChanged = $true }
  if ($config.gateway.mode -ne "local") { $config.gateway.mode = "local"; $configChanged = $true }
  if ($config.gateway.bind -ne "loopback") { $config.gateway.bind = "loopback"; $configChanged = $true }
  if (-not $config.gateway.auth) { $config.gateway | Add-Member -NotePropertyName auth -NotePropertyValue ([pscustomobject]@{}); $configChanged = $true }
  if ($config.gateway.auth.mode -eq "token" -or -not $config.gateway.auth.mode) { $config.gateway.auth.mode = "none"; $configChanged = $true }
  if (-not $config.gateway.controlUi) { $config.gateway | Add-Member -NotePropertyName controlUi -NotePropertyValue ([pscustomobject]@{}); $configChanged = $true }
  if ($config.gateway.controlUi.allowInsecureAuth -ne $true) { $config.gateway.controlUi.allowInsecureAuth = $true; $configChanged = $true }
  if ($configChanged) {
    $backupRoot = Join-Path $env:LOCALAPPDATA "SuperPinkie\backups"
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Copy-Item -LiteralPath $ConfigPath -Destination (Join-Path $backupRoot ("openclaw-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")) -Force
    $config | ConvertTo-Json -Depth 100 | Set-Content $ConfigPath -Encoding UTF8
  }
}

# ── 3/6  人格文件安装 ─────────────────────────────────────────────────────
Write-Host "==> 3/6  installing personas"
$personaMap = @{
  "chat"      = "$UserHome\.openclaw\workspace"
  "project"   = "$UserHome\.openclaw\workspace-project"
  "thinking"  = "$UserHome\.openclaw\workspace-thinking"
  "neutral"   = "$UserHome\.openclaw\workspace-unrestricted"
}
foreach ($mode in $personaMap.Keys) {
  $srcDir = Join-Path $RepoDir "personas\$mode"
  $dstDir = $personaMap[$mode]
  if (Test-Path $srcDir) {
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    foreach ($f in @("SOUL.md","IDENTITY.md")) {
      $src = Join-Path $srcDir $f
      $dst = Join-Path $dstDir $f
      if (Test-Path $src) {
        if (Test-Path $dst) {
          Write-Host "    [$mode] keeping existing $f"
          continue
        }
        Copy-Item $src $dst
      }
    }
    Write-Host "    [$mode] -> $dstDir"
  }
}

# 注册 project agent（如果 openclaw 可用）
$ocBin = Get-Command "openclaw" -ErrorAction SilentlyContinue
if ($null -ne $ocBin) {
  $agentList = & openclaw agents list --json 2>$null | Out-String
  if ($agentList -notmatch '"id"\s*:\s*"project"') {
    Write-Host "    registering project agent"
    & openclaw agents add project --non-interactive --workspace "$UserHome\.openclaw\workspace-project" 2>$null
  }
  & openclaw agents set-identity --agent project --identity-file "$UserHome\.openclaw\workspace-project\IDENTITY.md" 2>$null
}

# ── 4/6  UI 皮肤注入 ──────────────────────────────────────────────────────
if (-not $SkipTheme) {
  Write-Host "==> 4/6  applying 来啦～老弟 skin"
  $themeScript = Join-Path $RepoDir "installer\windows\apply-theme.ps1"
  if (Test-Path $themeScript) {
    & $themeScript
  } else {
    Write-Warning "apply-theme.ps1 not found, skin injection skipped"
  }
} else {
  Write-Host "==> 4/6  (skipped) skin injection"
}

# ── 5/6  代理计划任务 ─────────────────────────────────────────────────────
Write-Host "==> 5/6  installing proxy as scheduled task '$TaskName' (port $ProxyPort -> $UpstreamPort)"
$pythonw   = Resolve-PythonWindowless
$action   = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$ProxyScript`" $ProxyPort $UpstreamPort" -WorkingDirectory (Split-Path $ProxyScript)
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$env2     = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $env2 -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ProxyPort/health" -TimeoutSec 5
  Write-Host "    proxy healthy: $($health | ConvertTo-Json -Compress)"
} catch {
  Write-Host "    WARNING: proxy health check failed: $_"
}

# 网关冷启动可能超过半分钟；巡检脚本只拉起缺失监听，不 taskkill 正在冷启动的网关。
if (Test-Path $GatewayWatchdog) {
  $nodeBin = if ($env:PINKIE_NODE_BIN) { $env:PINKIE_NODE_BIN } else { (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
  $openclawEntry = if ($env:PINKIE_OPENCLAW_ENTRY) { $env:PINKIE_OPENCLAW_ENTRY } else { Join-Path $env:APPDATA "npm\node_modules\openclaw\openclaw.mjs" }
  if ($nodeBin -and (Test-Path $nodeBin) -and (Test-Path $openclawEntry)) {
    $ps = (Get-Command powershell.exe).Source
    $watchAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$GatewayWatchdog`" -NodePath `"$nodeBin`" -OpenClawEntry `"$openclawEntry`" -Port 18789" -WorkingDirectory (Split-Path $GatewayWatchdog)
    $watchTrigger = New-ScheduledTaskTrigger -AtLogOn
    $watchTrigger2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)
    Register-ScheduledTask -TaskName $GatewayWatchdogTask -Action $watchAction -Trigger @($watchTrigger,$watchTrigger2) -Settings $settings -Principal $env2 -Force | Out-Null
    Start-ScheduledTask -TaskName $GatewayWatchdogTask
  } else { Write-Warning "找不到 node/openclaw，网关巡检任务暂不注册" }
}

# ── 6/6  Provider 指向代理（可选）────────────────────────────────────────
if ($Provider -ne "") {
  $Cfg = Join-Path $PromptsDir "openclaw.json"
  if (Test-Path $Cfg) {
    Write-Host "==> 6/6  pointing provider '$Provider' at the proxy"
    $cfg = Get-Content $Cfg -Raw -Encoding UTF8 | ConvertFrom-Json
    $cfg.models.providers.$Provider.baseUrl = "http://127.0.0.1:$ProxyPort/v1"
    $cfg | ConvertTo-Json -Depth 20 | Set-Content $Cfg -Encoding UTF8
    Write-Host "    done. Restart the openclaw gateway for it to take effect."
  } else {
    Write-Host "==> 6/6  (skipped) openclaw.json not found at $Cfg"
  }
} else {
  Write-Host "==> 6/6  (skipped) no -Provider specified"
}

Write-Host ""
Write-Host "========================================"
Write-Host "安装完成！"
Write-Host "接下来："
Write-Host "  1. 在 OpenClaw 配置中填入你的 API Key（openclaw.json 的 providers）"
Write-Host "  2. 重启 OpenClaw Gateway（openclaw gateway restart）"
Write-Host "  3. 在无限制模式会话中发送验证令牌确认注入生效（见 README.md）"
Write-Host "========================================"
