# 摸清这台电脑（Windows）：配置、现在的余量、已有工具，并给出建议档位。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File machine-check.ps1          只看结果
#       powershell -NoProfile -ExecutionPolicy Bypass -File machine-check.ps1 -Save    同时写进各模式工作区的 TOOLS.md（只替换自动检测那一段）
#       加 -Net 顺便测国内镜像和 GitHub 通不通（每个最多等 4 秒）
# 只读检测，不安装、不修改任何东西（-Save 只改 TOOLS.md 里标记好的那一段）。
# 本文件要保存成带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 在中文系统上会把中文读乱。
param([switch]$Save, [switch]$Net)
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpus = @(Get-CimInstance Win32_Processor)
$cpuName = ($cpus | Select-Object -First 1).Name
if ($cpuName) { $cpuName = $cpuName.Trim() } else { $cpuName = '未知' }
$cores = ($cpus | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
$availGB = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 1)
$osName = "$($os.Caption) $($os.Version)"
$arch = $env:PROCESSOR_ARCHITECTURE

# ---------- 显卡：先看 NVIDIA，再读注册表里的显存（Win32_VideoController 的显存最多只报 4 GB）
$gpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name } | Where-Object { $_ })
$gpu = ($gpuNames -join ' / ')
$gpuKind = 'integrated'
$vramGB = 0
$nvsmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvsmi) {
  $nv = (& $nvsmi.Source --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
  if ($nv) {
    $parts = $nv -split ',\s*'
    $vramGB = [math]::Round([double]$parts[1] / 1024)
    $gpu = "$($parts[0])（显存 $vramGB GB）"
    $gpuKind = 'nvidia'
  }
}
if ($gpuKind -ne 'nvidia') {
  $classKey = 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*'
  $maxBytes = 0
  Get-ItemProperty -Path $classKey -ErrorAction SilentlyContinue | ForEach-Object {
    $v = $_.'HardwareInformation.qwMemorySize'
    if ($v -and [double]$v -gt $maxBytes) { $maxBytes = [double]$v }
  }
  if ($maxBytes -gt 0) {
    $vramGB = [math]::Round($maxBytes / 1GB)
    $gpu = "$gpu（显存约 $vramGB GB）"
    if ($vramGB -ge 2 -and $gpu -notmatch 'Intel') { $gpuKind = 'discrete' }
  }
}

# ---------- 硬盘、供电
$drive = $env:USERPROFILE.Substring(0, 1)
$diskGB = [math]::Round((Get-PSDrive -Name $drive).Free / 1GB)
$bat = Get-CimInstance Win32_Battery | Select-Object -First 1
if (-not $bat) { $power = '插电（没有电池，可能是台式机）' }
elseif ($bat.BatteryStatus -eq 2) { $power = "插电（电量 $($bat.EstimatedChargeRemaining)%）" }
else { $power = "用电池（$($bat.EstimatedChargeRemaining)%）" }

# ---------- 已有工具（应用商店里的 python 占位不算装了）
$tools = @()
foreach ($t in 'python', 'py', 'uv', 'node', 'npm', 'git', 'ffmpeg', 'magick', 'winget', 'scoop', 'soffice', 'blender') {
  $c = Get-Command $t -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { continue }
  if ($c.Source -like '*WindowsApps*' -and $t -eq 'python') { $tools += 'python（应用商店占位，没真正装）'; continue }
  $tools += $t
}
$apps = @()
$appChecks = [ordered]@{
  'Chrome' = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  'Edge' = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  'LibreOffice' = @("$env:ProgramFiles\LibreOffice\program\soffice.exe")
  'Blender' = @("$env:ProgramFiles\Blender Foundation")
}
foreach ($name in $appChecks.Keys) {
  foreach ($p in $appChecks[$name]) { if ($p -and (Test-Path $p)) { $apps += $name; break } }
}
$appPaths = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths'
if (Test-Path "$appPaths\POWERPNT.EXE") { $apps += 'PowerPoint' }
if (Test-Path "$appPaths\WINWORD.EXE") { $apps += 'Word' }
if ((Test-Path "$appPaths\wps.exe") -or (Test-Path "$env:LOCALAPPDATA\Kingsoft\WPS Office")) { $apps += 'WPS' }

$enc = ''
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ff) {
  $found = (& $ff.Source -hide_banner -encoders 2>$null | Select-String -Pattern 'h264_nvenc|hevc_nvenc|h264_qsv|h264_amf' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Sort-Object -Unique)
  $enc = ($found -join '、')
}

# ---------- 档位：先按配置定，再按现在的余量提醒
$ramI = [int][math]::Round($ramGB)
$tier = '轻'
if ($ramI -ge 32 -and $vramGB -ge 8) { $tier = '重' }
elseif ($vramGB -ge 12 -and $ramI -ge 16 -and $gpuKind -ne 'integrated') { $tier = '重' }
elseif ($ramI -ge 16 -and $cores -ge 8) { $tier = '中' }
$budget = @{
  '轻' = '视频先出 480p 样片、成片默认 720p（1080p 先实测估时）；同一时间只跑一个重活；不在本机跑大模型（语音转字幕用 small 及以下）；3D 网页像素比封顶 1.5；批量处理分批。'
  '中' = '视频样片 540p、成片 1080p；可以同时跑两个重活；语音转字幕可用 medium / turbo；本地小模型能跑但慢，先实测。'
  '重' = '成片 1080p–4K 都可以；可以并行；语音转字幕用 large；本地 7B–14B 模型、补帧、Blender 渲染可以试，先跑一小段估时。'
}[$tier]
$notes = ''
if ($availGB -gt 0 -and $availGB -lt 2) { $notes += '现在可用内存不到 2 GB：重活前先关掉不用的程序，或者再降一档。' }
if ($power -like '用电池*') { $notes += '正在用电池：长时间渲染或转码前提醒插电，不插电就降一档。' }
if ($diskGB -lt 10) { $notes += '硬盘剩余不到 10 GB：渲染、装大软件前先说清要占多少空间。' }
if ($ramI -le 4) { $notes += '内存只有 4 GB 左右：浏览器截图、渲染都要一次一个，处理大文件要分块。' }

$netLine = ''
if ($Net) {
  function Probe($url) {
    try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 4; if ($r.StatusCode -lt 400) { '通' } else { '不通' } } catch { '不通' }
  }
  $netLine = "npm 国内镜像 $(Probe 'https://registry.npmmirror.com/')；pip 清华镜像 $(Probe 'https://pypi.tuna.tsinghua.edu.cn/simple/pip/')；GitHub $(Probe 'https://github.com')；HuggingFace 国内镜像 $(Probe 'https://hf-mirror.com')"
}

$date = Get-Date -Format 'yyyy-MM-dd'
$lines = @(
  "## 这台电脑（machine-check 自动检测，$date）",
  '',
  "- 系统：$osName（$arch）",
  "- 处理器：$cpuName，$cores 个线程",
  "- 内存：$ramGB GB（检测时可用约 $availGB GB）",
  "- 显卡：$gpu",
  "- 硬盘：$drive 盘剩余约 $diskGB GB",
  "- 供电：$power",
  "- 视频硬件编码：$(if ($enc) { $enc } else { '没有（或没装 ffmpeg）' })",
  "- 已有命令：$(if ($tools.Count) { $tools -join '、' } else { '（都没找到）' })"
)
if ($apps.Count) { $lines += "- 已有应用：$($apps -join '、')" }
if ($netLine) { $lines += "- 网络：$netLine" }
$lines += "- **建议档位：$tier**。$budget"
if ($notes) { $lines += "- **现在要注意：**$notes" }
$lines += '- 档位只是起点：重活先跑一小段量时间再估总时长（见 playbooks/machine.md），实测速度另记在 TOOLS.md 的「实测速度」一节（写在这段外面，重新检测不会冲掉）。'
$report = $lines -join "`r`n"
Write-Output $report

if ($Save) {
  $state = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  foreach ($ws in 'workspace', 'workspace-project', 'workspace-thinking', 'workspace-learning') {
    $dir = Join-Path $state $ws
    if (-not (Test-Path $dir)) { continue }
    $f = Join-Path $dir 'TOOLS.md'
    $text = '# TOOLS.md - 本机说明'
    if (Test-Path $f) { $text = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8) }
    $text = [regex]::Replace($text, '(?s)<!-- machine-check:start -->.*?<!-- machine-check:end -->', '')
    $text = $text.TrimEnd() + "`r`n`r`n<!-- machine-check:start -->`r`n$report`r`n<!-- machine-check:end -->`r`n"
    [System.IO.File]::WriteAllText($f, $text, $utf8)
    Write-Output "已写入：$f"
  }
}
