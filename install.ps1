# install.ps1 — Windows installer for the 超级碧琪 unrestricted-prompt kit
#
# What it does:
#   1. Copies prompts\*.txt into %USERPROFILE%\.openclaw\ (UR_PROMPTS_DIR overrides)
#   2. Patches the OpenClaw model transports (both layers) via node
#   3. Starts the rewrite proxy; installs a Scheduled Task for auto-start at login
#   4. Optionally points a provider at the proxy (-Provider mm)
#
# Usage (PowerShell):
#   .\install.ps1                     # prompts + patch + proxy + scheduled task
#   .\install.ps1 -Provider mm        # also point provider "mm" at the proxy
#   .\install.ps1 -Remove             # uninstall: strip patches, stop proxy, remove task
#
# Environment overrides:
#   $env:UR_PROMPTS_DIR, $env:UR_PROXY_PORT, $env:UR_UPSTREAM_PORT, $env:OPENCLAW_ROOT

param(
  [string]$Provider = "",
  [switch]$Remove = $false
)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PromptsDir = if ($env:UR_PROMPTS_DIR) { $env:UR_PROMPTS_DIR } else { Join-Path $env:USERPROFILE ".openclaw" }
$ProxyPort = if ($env:UR_PROXY_PORT) { $env:UR_PROXY_PORT } else { "1467" }
$UpstreamPort = if ($env:UR_UPSTREAM_PORT) { $env:UR_UPSTREAM_PORT } else { "1466" }
$ProxyScript = Join-Path $RepoDir "proxy\ur-rewrite-proxy.py"
$PatchScript = Join-Path $RepoDir "patch\reapply-unrestricted-patch.mjs"
$TaskName = "OpenClawURProxy"

if ($Remove) {
  Write-Host "==> stripping transport patches"
  node $PatchScript --remove
  Write-Host "==> stopping proxy + removing scheduled task"
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "*ur-rewrite-proxy*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "done. Config baseUrl changes (if any) must be reverted manually."
  exit 0
}

Write-Host "==> 1/4 copying prompts -> $PromptsDir"
New-Item -ItemType Directory -Force -Path $PromptsDir | Out-Null
Copy-Item (Join-Path $RepoDir "prompts\unrestricted-prompt-*.txt") $PromptsDir -Force
$count = (Get-ChildItem (Join-Path $RepoDir "prompts\unrestricted-prompt-*.txt")).Count
Write-Host "    $count prompt files installed"

Write-Host "==> 2/4 patching OpenClaw transports"
node $PatchScript

Write-Host "==> 3/4 installing proxy as scheduled task '$TaskName' (port $ProxyPort -> $UpstreamPort)"
$action = New-ScheduledTaskAction -Execute "python" -Argument "`"$ProxyScript`" $ProxyPort" -WorkingDirectory (Split-Path $ProxyScript)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$env2 = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $env2 -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ProxyPort/health" -TimeoutSec 5
  Write-Host "    proxy healthy: $($health | ConvertTo-Json -Compress)"
} catch {
  Write-Host "    WARNING: proxy health check failed: $_"
}

if ($Provider -ne "") {
  $Cfg = Join-Path $PromptsDir "openclaw.json"
  if (Test-Path $Cfg) {
    Write-Host "==> 4/4 pointing provider '$Provider' at the proxy"
    $cfg = Get-Content $Cfg -Raw -Encoding UTF8 | ConvertFrom-Json
    $cfg.models.providers.$Provider.baseUrl = "http://127.0.0.1:$ProxyPort/v1"
    $cfg | ConvertTo-Json -Depth 20 | Set-Content $Cfg -Encoding UTF8
    Write-Host "    done. Restart the openclaw gateway for it to take effect."
  } else {
    Write-Host "==> 4/4 (skipped) openclaw.json not found at $Cfg"
  }
}

Write-Host ""
Write-Host "All set. Restart the openclaw gateway, then send the verification token"
Write-Host "in an unrestricted-mode session to confirm the injection is live (see README.md)."
