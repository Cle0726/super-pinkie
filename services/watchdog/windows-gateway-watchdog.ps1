param(
  [string]$NodePath = "",
  [string]$OpenClawEntry = "",
  [int]$Port = 18789,
  [string]$LogPath = ""
)

$ErrorActionPreference = "SilentlyContinue"
if (-not $LogPath) {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:USERPROFILE }
  $LogPath = Join-Path $base "SuperPinkie\logs\gateway-watchdog.log"
}
$logDir = Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Log([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

# Any HTTP response (including 401/403) proves that a listener is alive.
$alive = $false
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
  $alive = $true
} catch {
  if ($_.Exception.Response) { $alive = $true }
}
if ($alive) { exit 0 }
if (-not $NodePath -or -not (Test-Path $NodePath) -or -not $OpenClawEntry -or -not (Test-Path $OpenClawEntry)) {
  Log "gateway listener missing; launch skipped because bundled paths are unavailable"
  exit 0
}

$args = @($OpenClawEntry, "gateway", "run", "--port", "$Port", "--bind", "loopback", "--auth", "none", "--allow-unconfigured")
try {
  Start-Process -FilePath $NodePath -ArgumentList $args -WorkingDirectory (Split-Path -Parent $OpenClawEntry) -WindowStyle Hidden | Out-Null
  Log "gateway listener missing; started a recovery process"
} catch {
  Log "gateway recovery start failed: $($_.Exception.Message)"
}
