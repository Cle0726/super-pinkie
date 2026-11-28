#!/usr/bin/env pwsh
# Undo register-bundled-watchdog.ps1 (B109): remove the scheduled task, the Run
# fallback, the wrapper outside the App folder, and stop the watchdog loop it
# started. Run this before deleting the App folder. (If the folder is deleted
# first, the wrapper removes the task / Run value itself on its next tick.)
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'watchdog-command.ps1')
$taskName = $BundledWatchdogTaskName
$wrapper = Get-BundledWatchdogWrapperPath
$removed = @()
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    $removed += "计划任务 $taskName"
}
if (Get-ItemProperty -Path $BundledWatchdogRunKey -Name $taskName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $BundledWatchdogRunKey -Name $taskName
    $removed += "启动项 $taskName"
}
# Only the loop this wrapper started: match the wrapper path on the command line,
# never every powershell.exe.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($wrapper) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $removed += "进程 $($_.ProcessId)" }
if (Test-Path -LiteralPath $wrapper) {
    Remove-Item -LiteralPath $wrapper -Force
    $removed += $wrapper
}
if ($removed.Count) { Write-Host ("已清掉：" + ($removed -join "、")) } else { Write-Host "没有要清的：$taskName 没注册过" }
