param(
  [string]$NodePath = "",
  [string]$OpenClawEntry = "",
  [int]$Port = 18789,
  [string]$LogPath = "",
  [switch]$Loop
)

$ErrorActionPreference = "SilentlyContinue"
$mutex = New-Object System.Threading.Mutex($false, 'Local\SuperPinkieGatewayWatchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }
if (-not $LogPath) {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:USERPROFILE }
  $LogPath = Join-Path $base "SuperPinkie\logs\gateway-watchdog.log"
}
$logDir = Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$script:lastStart = [DateTime]::MinValue
$script:missCount = 0
function Log([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

function Test-GatewayAlive {
  # A healthy gateway answers /health with a tiny JSON body in milliseconds.
  # We probe /health rather than the root page: the root document is ~17 KB of
  # HTML, and probing it is both slower and a false source of "down" signals
  # whenever the gateway is mid config-reload or drain and briefly slow.
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
  } catch {
    if ($_.Exception.Response) { return $true }
  }
  return $false
}

function Test-PortListening {
  # Only relaunch when nothing is actually bound to the port. A gateway that is
  # merely slow still owns the socket; spawning a second process then dies with
  # EADDRINUSE and leaves a zombie behind, which is exactly what made the old
  # watchdog look dead (it "launched" recovery processes that could never bind).
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return ($null -ne $conn)
}

function Check-GatewayOnce {
  if (Test-GatewayAlive) {
    $script:missCount = 0
    return
  }

  # A single failed probe is not a crash. The gateway can legitimately miss a
  # beat during config reload / restart handoff. Require several consecutive
  # misses before we consider it gone, so we never pile a second gateway on top
  # of one that is still shutting down.
  $script:missCount++
  if ($script:missCount -lt 3) { return }

  # If the socket is still held, the gateway is alive-but-slow, not dead. Do not
  # spawn a doomed sibling; wait for the holder to actually release the port.
  if (Test-PortListening) {
    if ($script:missCount -ge 15) {
      Log "gateway unresponsive for $script:missCount probes but the port is still held; waiting for the holder to release it"
      $script:missCount = 0
    }
    return
  }

  if (-not $NodePath -or -not (Test-Path $NodePath) -or -not $OpenClawEntry -or -not (Test-Path $OpenClawEntry)) {
    Log "gateway listener missing; launch skipped because bundled paths are unavailable"
    $script:missCount = 0
    return
  }

  # Probe every few seconds, but never launch parallel gateways while the last
  # recovery process is still warming up under Defender.
  if (((Get-Date) - $script:lastStart).TotalSeconds -lt 8) { return }
  $script:lastStart = Get-Date
  $script:missCount = 0

  $gatewayArgs = @($OpenClawEntry, "gateway", "run", "--port", "$Port", "--bind", "loopback", "--auth", "none", "--allow-unconfigured")
  try {
    Start-Process -FilePath $NodePath -ArgumentList $gatewayArgs -WorkingDirectory (Split-Path -Parent $OpenClawEntry) -WindowStyle Hidden | Out-Null
    Log "gateway listener missing; started a recovery process"
  } catch {
    Log "gateway recovery start failed: $($_.Exception.Message)"
  }
}

do {
  Check-GatewayOnce
  if (-not $Loop) { break }
  Start-Sleep -Milliseconds 2000
} while ($true)
