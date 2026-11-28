# Shared by register-bundled-watchdog.ps1 and unregister-bundled-watchdog.ps1 (B109).
#
# The App is a portable folder: "uninstall" is deleting it. The task used to run
# the watchdog straight from that folder (and start in it), so after a delete it
# failed every minute for ten years and nothing ever removed it. Now the task and
# the Run fallback run a small wrapper kept OUTSIDE the App folder
# (%LOCALAPPDATA%\SuperPinkie\watchdog). The wrapper runs the watchdog while the
# App is there; once the whole install folder is gone it removes the task, the Run
# value and itself. Not while an update is mid-swap: then the folder is still
# there, or the updater's <name>.previous-<token> backup sits next to it (also
# while a failed update waits for the restore at the next sign-in).

$BundledWatchdogTaskName = 'SuperPinkieGatewayWatchdog'
$BundledWatchdogRunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Get-BundledWatchdogPaths([string]$InstallRoot) {
    $resourceRoot = if (Test-Path -LiteralPath (Join-Path $InstallRoot '_internal')) { Join-Path $InstallRoot '_internal' } else { $InstallRoot }
    @{
        Watchdog = Join-Path $resourceRoot 'services\watchdog\windows-gateway-watchdog.ps1'
        Node     = Join-Path $resourceRoot 'runtime\bin\node.exe'
        OpenClaw = Join-Path $resourceRoot 'runtime\node_modules\openclaw\openclaw.mjs'
    }
}

function Get-BundledWatchdogWrapperPath {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:USERPROFILE }
    $stateRoot = if ($env:PINKIE_STATE_ROOT) { $env:PINKIE_STATE_ROOT } else { Join-Path $base 'SuperPinkie' }
    Join-Path $stateRoot 'watchdog\run-bundled-watchdog.ps1'
}

function ConvertTo-PsLiteral([string]$Text) {
    # PowerShell also ends '...' at the curly single quotes, so double those too (B33).
    "'" + ($Text -replace "['‘-‛]", '$0$0') + "'"
}

function New-BundledWatchdogScript([string]$InstallRoot, $Paths) {
    $root = (Resolve-Path -LiteralPath $InstallRoot).ProviderPath.TrimEnd('\')
    @(
        '# Written by register-bundled-watchdog.ps1. Removes itself once the App folder is gone.'
        '$w = ' + (ConvertTo-PsLiteral $Paths.Watchdog)
        'if (Test-Path -LiteralPath $w) { & $w -NodePath ' + (ConvertTo-PsLiteral $Paths.Node) + ' -OpenClawEntry ' + (ConvertTo-PsLiteral $Paths.OpenClaw) + ' -Port 18789 -Loop; exit }'
        '$root = ' + (ConvertTo-PsLiteral $root)
        'if (Test-Path -LiteralPath $root) { exit }'
        'if (Get-ChildItem -LiteralPath (Split-Path -Parent $root) -Directory -Filter ((Split-Path -Leaf $root) + ''.previous-*'') -ErrorAction SilentlyContinue) { exit }'
        'Unregister-ScheduledTask -TaskName ' + (ConvertTo-PsLiteral $BundledWatchdogTaskName) + ' -Confirm:$false -ErrorAction SilentlyContinue'
        'Remove-ItemProperty -Path ' + (ConvertTo-PsLiteral $BundledWatchdogRunKey) + ' -Name ' + (ConvertTo-PsLiteral $BundledWatchdogTaskName) + ' -ErrorAction SilentlyContinue'
        'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue'
    ) -join "`n"
}

function Write-BundledWatchdogWrapper([string]$InstallRoot, $Paths) {
    $wrapper = Get-BundledWatchdogWrapperPath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $wrapper) | Out-Null
    # UTF-8 with BOM: Windows PowerShell 5.1 reads a BOM-less script as ANSI and
    # a Chinese install path would turn into mojibake.
    [IO.File]::WriteAllText($wrapper, (New-BundledWatchdogScript $InstallRoot $Paths) + "`n", (New-Object Text.UTF8Encoding($true)))
    $wrapper
}

function New-BundledWatchdogArguments([string]$Wrapper) {
    "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Wrapper`""
}
