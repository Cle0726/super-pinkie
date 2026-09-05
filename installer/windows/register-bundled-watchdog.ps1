#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [string]$InstallRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)
$ErrorActionPreference = 'Stop'
$taskName = 'SuperPinkieGatewayWatchdog'
$resourceRoot = if (Test-Path -LiteralPath (Join-Path $InstallRoot '_internal')) { Join-Path $InstallRoot '_internal' } else { $InstallRoot }
$watchdog = Join-Path $resourceRoot 'services\watchdog\windows-gateway-watchdog.ps1'
$node = Join-Path $resourceRoot 'runtime\bin\node.exe'
$openclaw = Join-Path $resourceRoot 'runtime\node_modules\openclaw\openclaw.mjs'
if (-not (Test-Path -LiteralPath $watchdog) -or -not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $openclaw)) {
    throw "找不到内置网关文件，请确认 InstallRoot 指向 onedir 程序目录"
}
$ps = (Get-Command powershell.exe).Source
$args = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`" -NodePath `"$node`" -OpenClawEntry `"$openclaw`" -Port 18789"
$action = New-ScheduledTaskAction -Execute $ps -Argument $args -WorkingDirectory (Split-Path -Parent $watchdog)
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    # Task Scheduler rejects TimeSpan::MaxValue in XML; ten years is
    # effectively continuous and remains within the supported range.
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Write-Host "已注册 $taskName（仅检查监听，不会 taskkill 正在启动的网关）"
} catch {
    # Some managed Windows installs deny Task Scheduler writes to standard
    # users. Fall back to the per-user Run key with the same safe check loop.
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $loopArgs = "$args -Loop"
    New-Item -Path $runKey -Force | Out-Null
    New-ItemProperty -Path $runKey -Name $taskName -PropertyType String -Value "`"$ps`" $loopArgs" -Force | Out-Null
    Start-Process -FilePath $ps -ArgumentList $loopArgs -WindowStyle Hidden | Out-Null
    Write-Host "计划任务不可写，已改用当前用户启动项 $taskName"
}
