# 确保豆包桌面版在跑，并且带调试端口 9225
# 豆包没带端口就没法被脚本操作；它已经开着但没端口时，只能先退出再重开（托盘也要退）。
# 用法: powershell -ExecutionPolicy Bypass -File ensure-doubao.ps1
$ErrorActionPreference = 'Stop'
$port = 9225

function Test-Cdp {
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2 -UseBasicParsing
    return $true
  } catch { return $false }
}

if (Test-Cdp) {
  Write-Output '{"ok":true,"reused":true}'
  exit 0
}

$candidates = @(
  'F:\Doubao\app\Doubao.exe',
  'C:\Program Files\Doubao\Doubao.exe',
  "$env:LOCALAPPDATA\Doubao\Doubao.exe",
  "$env:LOCALAPPDATA\Programs\Doubao\Doubao.exe"
)
$exe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $exe) {
  $found = Get-ChildItem -Path 'C:\Program Files','F:\' -Filter 'Doubao.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
           Select-Object -First 1 -ExpandProperty FullName
  $exe = $found
}
if (-not $exe) {
  Write-Output '{"ok":false,"error":"找不到豆包。装一个，或把 Doubao.exe 的完整路径告诉碧琪。"}'
  exit 2
}

$running = Get-Process -Name 'Doubao' -ErrorAction SilentlyContinue
if ($running) {
  Write-Output '{"ok":false,"error":"豆包已经开着但没有调试端口。请先完全退出豆包（右下角托盘图标也要退），再重跑这条命令。"}'
  exit 4
}

Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$port"
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 800
  if (Test-Cdp) {
    Write-Output ('{"ok":true,"reused":false,"exe":"' + $exe.Replace('\','\\') + '"}')
    exit 0
  }
}
Write-Output '{"ok":false,"error":"豆包起了但调试端口 9225 没通"}'
exit 3
