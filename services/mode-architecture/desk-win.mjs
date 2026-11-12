// Windows 上的电脑操控执行器：一段 PowerShell，读一份 JSON 步骤清单，按顺序做完，把每一步的结果写回 JSON。
// 整段只用 ASCII（Windows 自带的 PowerShell 5.1 会把没有 BOM 的脚本当成本地编码读，中文会乱）；
// 中文参数走 UTF-8 的 JSON 文件，不走命令行。只用 5.1 支持的语法（没有三元运算符和 ??）。
export const DESK_PS1 = String.raw`param([string]$InPath, [string]$OutPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class PkWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[void][PkWin]::SetProcessDPIAware()
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Get-Wins {
  $out = @()
  foreach ($p in Get-Process) {
    if ($p.MainWindowHandle -ne [IntPtr]::Zero -and $p.MainWindowTitle) {
      $out += [pscustomobject]@{ title = $p.MainWindowTitle; app = $p.ProcessName; pid = $p.Id; handle = $p.MainWindowHandle }
    }
  }
  return $out
}
function Fore-Title {
  $sb = New-Object System.Text.StringBuilder 512
  [void][PkWin]::GetWindowText([PkWin]::GetForegroundWindow(), $sb, 512)
  return $sb.ToString()
}
function Find-Win([string]$q) {
  $wins = @(Get-Wins)
  if (-not $q) {
    $fg = [PkWin]::GetForegroundWindow()
    $hit = @($wins | Where-Object { $_.handle -eq $fg })
    if ($hit.Count) { return $hit[0] }
    throw 'NO_WINDOW: no window name given and the foreground window is not a normal app window'
  }
  $hit = @($wins | Where-Object { $_.title -eq $q -or $_.app -eq $q })
  if (-not $hit.Count) { $hit = @($wins | Where-Object { $_.title -like "*$q*" -or $_.app -like "*$q*" }) }
  if (-not $hit.Count) {
    $names = ($wins | ForEach-Object { $_.app + ': ' + $_.title }) -join ' | '
    throw "NO_WINDOW: no open window matches '$q'. Open windows: $names"
  }
  return $hit[0]
}
function Focus-Win($w) {
  if ([PkWin]::IsIconic($w.handle)) { [void][PkWin]::ShowWindow($w.handle, 9) }
  [PkWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [PkWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][PkWin]::SetForegroundWindow($w.handle)
  Start-Sleep -Milliseconds 150
}
function Press-Combo($vks) {
  foreach ($vk in $vks) { [PkWin]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 30
  for ($i = $vks.Count - 1; $i -ge 0; $i--) { [PkWin]::keybd_event([byte]$vks[$i], 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 60
}
function Paste-Text([string]$text) {
  $old = $null
  try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $old = [System.Windows.Forms.Clipboard]::GetText() } } catch {}
  [System.Windows.Forms.Clipboard]::SetText($text)
  Start-Sleep -Milliseconds 60
  Press-Combo @(0x11, 0x56)
  Start-Sleep -Milliseconds 150
  if ($old) { try { [System.Windows.Forms.Clipboard]::SetText($old) } catch {} }
}
function Click-At([int]$x, [int]$y, [string]$button, [bool]$double) {
  [void][PkWin]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 40
  $down = 2; $up = 4
  if ($button -eq 'right') { $down = 8; $up = 16 }
  $times = 1; if ($double) { $times = 2 }
  for ($i = 0; $i -lt $times; $i++) {
    [PkWin]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [PkWin]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 70
  }
}
function El-Info($e) {
  $r = $e.Current.BoundingRectangle
  $box = $null
  if (-not $r.IsEmpty) { $box = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height) }
  return [pscustomobject]@{ name = $e.Current.Name; type = ($e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''); id = $e.Current.AutomationId; enabled = $e.Current.IsEnabled; rect = $box }
}
function Find-Els($w, [string]$name, [string]$type) {
  $root = $AE::FromHandle($w.handle)
  $all = $root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $exact = @(); $loose = @()
  foreach ($e in $all) {
    try {
      $n = $e.Current.Name; $t = ($e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''); $id = $e.Current.AutomationId
      if ($type -and $t -ne $type) { continue }
      if (-not $name) { $loose += $e; continue }
      if ($n -eq $name -or $id -eq $name) { $exact += $e } elseif ($n -like "*$name*") { $loose += $e }
    } catch {}
  }
  if ($exact.Count) { return $exact }
  return $loose
}
function Act-El($e, $w) {
  $p = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return 'invoke' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return 'select' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); return 'toggle' }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Expand(); return 'expand' }
  $r = $e.Current.BoundingRectangle
  if ($r.IsEmpty) { throw 'NOT_CLICKABLE: the element has no position on screen' }
  Focus-Win $w
  Click-At ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2)) 'left' $false
  return 'mouse'
}
function Resolve-App([string]$q) {
  if (Test-Path -LiteralPath $q) { return @{ kind = 'path'; target = $q } }
  try {
    $apps = @(Get-StartApps | Where-Object { $_.Name -eq $q })
    if (-not $apps.Count) { $apps = @(Get-StartApps | Where-Object { $_.Name -like "*$q*" }) }
    if ($apps.Count) { return @{ kind = 'startapp'; target = ('shell:AppsFolder\' + $apps[0].AppID); name = $apps[0].Name } }
  } catch {}
  $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", [Environment]::GetFolderPath('Desktop'))
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    $lnk = @(Get-ChildItem -Path $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -like "*$q*" })
    if ($lnk.Count) { return @{ kind = 'shortcut'; target = $lnk[0].FullName; name = $lnk[0].BaseName } }
  }
  return @{ kind = 'command'; target = $q }
}

function Run-Step($s) {
  switch ($s.op) {
    'windows' { return @{ windows = @(Get-Wins | ForEach-Object { @{ title = $_.title; app = $_.app } }) } }
    'open_app' {
      $r = Resolve-App $s.name
      Start-Process -FilePath $r.target | Out-Null
      return @{ launched = $r.target; via = $r.kind; found = $r.name }
    }
    'open' { Start-Process -FilePath $s.target | Out-Null; return @{ opened = $s.target } }
    'close_app' {
      $w = Find-Win $s.name
      $proc = Get-Process -Id $w.pid
      if (-not $proc.CloseMainWindow()) { throw 'CLOSE_FAILED: the app did not accept the close request' }
      return @{ closed = $w.app }
    }
    'focus' { $w = Find-Win $s.window; Focus-Win $w; return @{ focused = $w.title } }
    'wait_window' {
      $limit = 10000; if ($s.timeout) { $limit = [int]$s.timeout }
      $sw = [Diagnostics.Stopwatch]::StartNew()
      while ($sw.ElapsedMilliseconds -lt $limit) {
        $hit = @(Get-Wins | Where-Object { $_.title -like "*$($s.window)*" -or $_.app -like "*$($s.window)*" })
        if ($hit.Count) { return @{ window = $hit[0].title; waited = [int]$sw.ElapsedMilliseconds } }
        Start-Sleep -Milliseconds 250
      }
      throw "TIMEOUT: no window matching '$($s.window)' appeared within $limit ms"
    }
    'window_set' {
      $w = Find-Win $s.window
      if ($s.state -eq 'maximize') { [void][PkWin]::ShowWindow($w.handle, 3) }
      elseif ($s.state -eq 'minimize') { [void][PkWin]::ShowWindow($w.handle, 6) }
      elseif ($s.state -eq 'restore') { [void][PkWin]::ShowWindow($w.handle, 9) }
      if ($null -ne $s.w -and $null -ne $s.h) {
        $x = 0; $y = 0; if ($null -ne $s.x) { $x = [int]$s.x }; if ($null -ne $s.y) { $y = [int]$s.y }
        [void][PkWin]::MoveWindow($w.handle, $x, $y, [int]$s.w, [int]$s.h, $true)
      }
      $rc = New-Object PkWin+RECT; [void][PkWin]::GetWindowRect($w.handle, [ref]$rc)
      return @{ window = $w.title; rect = @($rc.L, $rc.T, ($rc.R - $rc.L), ($rc.B - $rc.T)) }
    }
    'keys' {
      if ($s.window) { Focus-Win (Find-Win $s.window) }
      foreach ($combo in $s.vk) { Press-Combo @($combo) }
      return @{ pressed = $s.keys }
    }
    'type' {
      if ($s.window) { Focus-Win (Find-Win $s.window) }
      Paste-Text ([string]$s.text)
      return @{ typed = ([string]$s.text).Length }
    }
    'click' { Click-At ([int]$s.x) ([int]$s.y) ([string]$s.button) ([bool]$s.double); return @{ clicked = @([int]$s.x, [int]$s.y) } }
    'ui' {
      $w = Find-Win $s.window
      $max = 120; if ($s.max) { $max = [int]$s.max }
      $els = @(Find-Els $w ([string]$s.filter) ([string]$s.type))
      $list = @()
      foreach ($e in $els) {
        try {
          $i = El-Info $e
          if (-not $i.name -and -not $i.id) { continue }
          if ($i.type -in @('Pane', 'Group', 'Custom', 'Image', 'Separator', 'ScrollBar', 'Thumb', 'TitleBar') -and -not $s.all) { continue }
          $list += $i
          if ($list.Count -ge $max) { break }
        } catch {}
      }
      return @{ window = $w.title; total = $els.Count; elements = $list }
    }
    'ui_click' {
      $w = Find-Win $s.window
      $els = @(Find-Els $w ([string]$s.name) ([string]$s.type))
      if (-not $els.Count) { throw "NO_ELEMENT: nothing named '$($s.name)' in window '$($w.title)'. Run the ui op to list what is there." }
      $idx = 0; if ($null -ne $s.index) { $idx = [int]$s.index }
      if ($idx -ge $els.Count) { throw "NO_ELEMENT: only $($els.Count) elements match '$($s.name)'" }
      $how = Act-El $els[$idx] $w
      return @{ clicked = $els[$idx].Current.Name; how = $how; matches = $els.Count }
    }
    'ui_set' {
      $w = Find-Win $s.window
      $els = @(Find-Els $w ([string]$s.name) ([string]$s.type))
      if (-not $els.Count) { throw "NO_ELEMENT: nothing named '$($s.name)' in window '$($w.title)'. Run the ui op to list what is there." }
      $idx = 0; if ($null -ne $s.index) { $idx = [int]$s.index }
      $e = $els[$idx]; $p = $null
      if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p) -and -not $p.Current.IsReadOnly) { $p.SetValue([string]$s.value); return @{ set = $e.Current.Name; how = 'value' } }
      Focus-Win $w; $e.SetFocus(); Start-Sleep -Milliseconds 80
      Press-Combo @(0x11, 0x41); Paste-Text ([string]$s.value)
      return @{ set = $e.Current.Name; how = 'paste' }
    }
    'clipboard_get' { $t = ''; if ([System.Windows.Forms.Clipboard]::ContainsText()) { $t = [System.Windows.Forms.Clipboard]::GetText() }; return @{ text = $t } }
    'clipboard_set' { [System.Windows.Forms.Clipboard]::SetText([string]$s.text); return @{ set = $true } }
    'screenshot' {
      if ($s.window) {
        $w = Find-Win $s.window; Focus-Win $w
        $rc = New-Object PkWin+RECT; [void][PkWin]::GetWindowRect($w.handle, [ref]$rc)
        $x = $rc.L; $y = $rc.T; $cw = $rc.R - $rc.L; $ch = $rc.B - $rc.T
      } else {
        $v = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $x = $v.X; $y = $v.Y; $cw = $v.Width; $ch = $v.Height
      }
      $bmp = New-Object System.Drawing.Bitmap $cw, $ch
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $cw, $ch))
      $dir = Split-Path -Parent $s.path
      if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      $bmp.Save($s.path, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
      return @{ path = $s.path; origin = @($x, $y); size = @($cw, $ch) }
    }
    'wait' { Start-Sleep -Milliseconds ([int]$s.ms); return @{ waited = [int]$s.ms } }
    default { throw "UNKNOWN_OP: $($s.op)" }
  }
}

$steps = @((Get-Content -LiteralPath $InPath -Raw -Encoding UTF8 | ConvertFrom-Json).steps)
$results = @()
foreach ($s in $steps) {
  try {
    $r = Run-Step $s
    $r.op = $s.op; $r.ok = $true
    $results += $r
  } catch {
    $results += @{ op = $s.op; ok = $false; error = $_.Exception.Message }
    break
  }
  if ($null -ne $s.after) { Start-Sleep -Milliseconds ([int]$s.after) }
}
$out = @{ results = $results; foreground = (Fore-Title) } | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($OutPath, $out, (New-Object System.Text.UTF8Encoding $false))
`;

const VK = Object.freeze({
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5B, cmd: 0x11, mod: 0x11,
  enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20, backspace: 0x08, delete: 0x2E, del: 0x2E,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28, insert: 0x2D,
  ',': 0xBC, '.': 0xBE, '/': 0xBF, ';': 0xBA, "'": 0xDE, '[': 0xDB, ']': 0xDD, '\\': 0xDC, '-': 0xBD, '=': 0xBB, '`': 0xC0,
});

// "ctrl+shift+s" → [0x11, 0x10, 0x53]。认不出的键抛错，不瞎按。
export function comboToVk(combo = '') {
  return String(combo).toLowerCase().split('+').map(part => part.trim()).filter(Boolean).map(key => {
    if (VK[key] != null) return VK[key];
    if (/^f([1-9]|1[0-2])$/.test(key)) return 0x6F + Number(key.slice(1));
    if (/^[a-z]$/.test(key)) return key.toUpperCase().charCodeAt(0);
    if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
    throw new Error(`不认识的按键「${key}」。可用：ctrl、shift、alt、win、enter、tab、esc、space、backspace、delete、方向键 left/right/up/down、home、end、pageup、pagedown、f1–f12、字母和数字。`);
  });
}
