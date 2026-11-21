"""PowerShell UI, progress window, and repair script templates for the Windows desktop shell."""

# Brings a WPF window to the screen even when its process was started with
# SW_HIDE: Windows applies the startup show state to a process's FIRST
# ShowWindow call, so a later explicit SW_SHOWNORMAL is what makes it visible.
FOREGROUND_PS = r'''function Show-Foreground($Window) {
  try {
    if (-not ('Pinkie.Win32' -as [type])) {
      Add-Type -Namespace Pinkie -Name Win32 -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
"@
    }
    $handle = (New-Object System.Windows.Interop.WindowInteropHelper $Window).Handle
    [void][Pinkie.Win32]::ShowWindow($handle, 1)
    [void][Pinkie.Win32]::SetForegroundWindow($handle)
    [void]$Window.Activate()
  } catch {}
}
'''

# Shared look for every update window: a soft pink card with 碧琪 herself on
# it, instead of a gray system dialog. The art is copied into
# <state>/updates/art by the App before the update starts, because the install
# folder is renamed away while these windows are open.
PINKIE_WPF_PS = r'''function Get-PinkieArt([string]$Name) {
  try {
    # <state>/updates/art first. An update started by an older version (2.5.37
    # and earlier) never copied the art there, and the failure card showed an
    # empty circle instead of 碧琪, so fall back to the install folders. OnLoad
    # caching closes each file at once, so no folder rename is ever blocked.
    $file = 'laolao-pinkie-status-' + $Name + '.png'
    $path = $null
    foreach ($folder in @(@($script:PinkieArtDir) + @($script:PinkieArtFallbacks))) {
      if (-not $folder) { continue }
      $candidate = Join-Path $folder $file
      if (Test-Path -LiteralPath $candidate) { $path = $candidate; break }
    }
    if (-not $path) { return $null }
    $image = New-Object Windows.Media.Imaging.BitmapImage
    $image.BeginInit()
    $image.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $image.UriSource = New-Object System.Uri ([IO.Path]::GetFullPath($path))
    $image.EndInit()
    $image.Freeze()
    return $image
  } catch { return $null }
}
function Set-PinkieArt($Target, [string]$Name) {
  if ($script:PinkieArtShown -eq $Name) { return }
  $art = Get-PinkieArt $Name
  if ($art) { $Target.Source = $art; $script:PinkieArtShown = $Name }
}
function Start-PinkieBob($Target) {
  try {
    $bob = New-Object Windows.Media.Animation.DoubleAnimation
    $bob.From = 0; $bob.To = -6
    $bob.Duration = New-Object Windows.Duration ([TimeSpan]::FromMilliseconds(1100))
    $bob.AutoReverse = $true
    $bob.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
    $bob.EasingFunction = New-Object Windows.Media.Animation.SineEase
    $Target.RenderTransform.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, $bob)
  } catch {}
}
function New-PinkieWindow([string]$Title, [string]$Body) {
  $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="@@TITLE@@" Width="520" SizeToContent="Height" WindowStartupLocation="CenterScreen"
        Topmost="True" ShowInTaskbar="True" ResizeMode="NoResize" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent"
        FontFamily="Microsoft YaHei UI, Microsoft YaHei, Segoe UI" TextOptions.TextFormattingMode="Display">
  <Window.Resources>
    <Style x:Key="Pill" TargetType="Button">
      <Setter Property="Foreground" Value="#7A3F5E"/>
      <Setter Property="Background" Value="#FFFFFFFF"/>
      <Setter Property="BorderBrush" Value="#FFE9A9C4"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Padding" Value="18,8,18,8"/>
      <Setter Property="Margin" Value="0,0,8,8"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Face" CornerRadius="17" Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1.2" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Face" Property="Opacity" Value="0.86"/></Trigger>
              <Trigger Property="IsPressed" Value="True"><Setter TargetName="Face" Property="Opacity" Value="0.72"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="PillPrimary" TargetType="Button" BasedOn="{StaticResource Pill}">
      <Setter Property="Foreground" Value="#FFFFFFFF"/>
      <Setter Property="Background" Value="#FFC25B8A"/>
      <Setter Property="BorderBrush" Value="#FFC25B8A"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
    </Style>
  </Window.Resources>
  <Border Margin="22" CornerRadius="26" BorderBrush="#FFFFFFFF" BorderThickness="1.5" Padding="22,20,24,16">
    <Border.Background>
      <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
        <GradientStop Color="#FFFFF8FB" Offset="0"/>
        <GradientStop Color="#FFFBDDEA" Offset="1"/>
      </LinearGradientBrush>
    </Border.Background>
    <Border.Effect>
      <DropShadowEffect BlurRadius="30" ShadowDepth="6" Direction="270" Color="#FF7B3F5D" Opacity="0.30"/>
    </Border.Effect>
    <Grid>
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="116"/>
        <ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>
      <Grid Grid.Column="0" VerticalAlignment="Top" Width="108" Height="108">
        <Ellipse Fill="#FFFFFFFF" Opacity="0.8"/>
        <Image x:Name="Mascot" Margin="4" RenderOptions.BitmapScalingMode="HighQuality">
          <Image.RenderTransform><TranslateTransform/></Image.RenderTransform>
        </Image>
      </Grid>
      <StackPanel Grid.Column="1" Margin="16,2,0,0">
        <Border HorizontalAlignment="Left" CornerRadius="9" Background="#FFF7CADC" Padding="10,2,10,3">
          <TextBlock Text="超級碧琪 · 更新" FontSize="11" Foreground="#FFA24B76"/>
        </Border>
        <TextBlock x:Name="Heading" Margin="0,9,0,0" FontSize="19" FontWeight="Bold" Foreground="#FF6E3A57" TextWrapping="Wrap"/>
        <TextBlock x:Name="Line" Margin="0,6,0,0" FontSize="13" Foreground="#FF8A5A72" TextWrapping="Wrap" LineHeight="20"/>
        <StackPanel x:Name="ProgressArea">
          <Grid Margin="0,14,0,0">
            <Border x:Name="Track" Height="12" CornerRadius="6" Background="#FFF5CEDD"/>
            <Border x:Name="Fill" Height="12" Width="0" CornerRadius="6" HorizontalAlignment="Left">
              <Border.Background>
                <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                  <GradientStop Color="#FFF793C0" Offset="0"/>
                  <GradientStop Color="#FFC25B8A" Offset="1"/>
                </LinearGradientBrush>
              </Border.Background>
            </Border>
          </Grid>
          <UniformGrid x:Name="Steps" Rows="1" Columns="5" Margin="0,8,0,0"/>
        </StackPanel>
        <TextBlock x:Name="Result" Margin="0,10,0,0" FontSize="12.5" Foreground="#FFC2410C" TextWrapping="Wrap" Visibility="Collapsed"/>
        <WrapPanel x:Name="Buttons" Margin="0,14,0,0" Visibility="Collapsed"/>
        <Grid Margin="0,12,0,0">
          <TextBlock x:Name="Hint" FontSize="11.5" Foreground="#FF9A6F85" TextWrapping="Wrap" Margin="0,0,76,0" LineHeight="17"/>
          <TextBlock x:Name="Clock" HorizontalAlignment="Right" VerticalAlignment="Bottom" FontSize="11.5" Foreground="#FFB07B95"/>
        </Grid>
      </StackPanel>
    </Grid>
  </Border>
</Window>
'@
  $xaml = $xaml.Replace('@@TITLE@@', [Security.SecurityElement]::Escape($Title))
  $window = [Windows.Markup.XamlReader]::Parse($xaml)
  $window.FindName('Heading').Text = $Body
  # No title bar: the whole card is the handle.
  $window.Add_MouseLeftButtonDown({ param($sender, $e) try { $sender.DragMove() } catch {} })
  return $window
}
function Format-PinkieElapsed([int]$Seconds) {
  if ($Seconds -lt 60) { return "已用 $Seconds 秒" }
  return ('已用 {0} 分 {1:00} 秒' -f [int][Math]::Floor($Seconds / 60), ($Seconds % 60))
}
'''

# The progress window. The App starts it itself (CREATE_NO_WINDOW, no SW_HIDE)
# just before it closes, so the moment the old window goes this one is already
# on screen. The replacer starts it only if the App could not.
PROGRESS_WINDOW_PS = r'''param([string]$Status, [int]$Owner, [string]$Version)
Add-Type -AssemblyName PresentationFramework
''' + FOREGROUND_PS + PINKIE_WPF_PS + r'''$script:PinkieArtDir = Join-Path (Split-Path -Parent $Status) 'art'
$heading = if ($Version) { "碧琪正在换上 $Version" } else { '碧琪正在换上新版' }
$hintText = '窗口会关上一到两分钟。请不要点击桌面上的碧琪，也不要关机。换好后会自己打开，记忆和设置不会丢。'
try {
  $window = New-PinkieWindow '超級碧琪更新' $heading
  $mascot = $window.FindName('Mascot'); $line = $window.FindName('Line'); $track = $window.FindName('Track')
  $fill = $window.FindName('Fill'); $clock = $window.FindName('Clock'); $stepsRow = $window.FindName('Steps')
  $window.FindName('Hint').Text = $hintText
  Set-PinkieArt $mascot 'working'
  Start-PinkieBob $mascot
  $script:stepLabels = @()
  foreach ($label in @('关旧版', '核对', '解压', '替换', '打开')) {
    $block = New-Object Windows.Controls.TextBlock
    $block.Text = $label; $block.FontSize = 11.5; $block.HorizontalAlignment = 'Center'
    [void]$stepsRow.Children.Add($block); $script:stepLabels += $block
  }
} catch {
  # The designed window failed to build (an old .NET, a broken font cache):
  # a plain window still beats none.
  $window = New-Object Windows.Window
  $window.Title = '超級碧琪更新'; $window.Width = 400; $window.SizeToContent = 'Height'
  $window.WindowStartupLocation = 'CenterScreen'; $window.Topmost = $true; $window.ResizeMode = 'NoResize'
  $panel = New-Object Windows.Controls.StackPanel; $panel.Margin = '22,18,22,18'
  $title = New-Object Windows.Controls.TextBlock; $title.FontSize = 15; $title.FontWeight = 'SemiBold'; $title.Text = $heading
  $line = New-Object Windows.Controls.TextBlock; $line.Margin = '0,10,0,0'; $line.TextWrapping = 'Wrap'
  $hint = New-Object Windows.Controls.TextBlock; $hint.Margin = '0,10,0,0'; $hint.Foreground = 'Gray'; $hint.TextWrapping = 'Wrap'; $hint.Text = $hintText
  foreach ($node in @($title, $line, $hint)) { [void]$panel.Children.Add($node) }
  $window.Content = $panel
  $mascot = $null; $track = $null; $fill = $null; $clock = $null; $script:stepLabels = @()
}
$line.Text = '正在准备…'
$window.Add_Loaded({ Show-Foreground $window })
$started = Get-Date
# Rough length of each step, only so the bar keeps creeping forward inside a
# long step instead of sitting still for a minute.
$script:expected = @{ 1 = 6; 2 = 6; 3 = 60; 4 = 20; 5 = 60 }
$script:lastStep = 0
$script:stepStarted = Get-Date
$script:shownFraction = 0.0
function Update-PinkieProgress([int]$Step, [int]$Total, [string]$State) {
  if ($Step -ne $script:lastStep) { $script:lastStep = $Step; $script:stepStarted = Get-Date }
  $inStep = ((Get-Date) - $script:stepStarted).TotalSeconds
  $guess = $script:expected[$Step]; if (-not $guess) { $guess = 30 }
  $part = if ($State -eq 'done') { 1.0 } else { 0.9 * (1 - [Math]::Exp(-$inStep / $guess)) }
  $fraction = [Math]::Min(1.0, [Math]::Max(0.02, ($Step - 1 + $part) / [double]$Total))
  if ($fraction -lt $script:shownFraction) { $fraction = $script:shownFraction }
  if ($fill -and $track -and $track.ActualWidth -gt 0 -and [Math]::Abs($fraction - $script:shownFraction) -gt 0.002) {
    $grow = New-Object Windows.Media.Animation.DoubleAnimation
    $grow.To = $track.ActualWidth * $fraction
    $grow.Duration = New-Object Windows.Duration ([TimeSpan]::FromMilliseconds(450))
    $grow.EasingFunction = New-Object Windows.Media.Animation.QuadraticEase
    $fill.BeginAnimation([Windows.FrameworkElement]::WidthProperty, $grow)
    $script:shownFraction = $fraction
  }
  for ($i = 0; $i -lt $script:stepLabels.Count; $i++) {
    $block = $script:stepLabels[$i]
    if ($i + 1 -lt $Step -or ($i + 1 -eq $Step -and $State -eq 'done')) {
      $block.Text = '✓ ' + @('关旧版', '核对', '解压', '替换', '打开')[$i]; $block.Foreground = '#FFC25B8A'; $block.FontWeight = 'Normal'
    } elseif ($i + 1 -eq $Step) {
      $block.Foreground = '#FF6E3A57'; $block.FontWeight = 'Bold'
    } else {
      $block.Foreground = '#FFCDA8BA'; $block.FontWeight = 'Normal'
    }
  }
}
# The App opens this window before the replacer exists (-Owner 0); the
# replacer then writes its own PID into the status file.
$script:ownerId = $Owner
$script:closeAt = $null
$script:ownerGoneAt = $null
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  if ($clock) { $clock.Text = Format-PinkieElapsed $seconds }
  try {
    $data = Get-Content -LiteralPath $Status -Raw -Encoding UTF8 | ConvertFrom-Json
    $line.Text = "第 $($data.step)/$($data.total) 步 · $($data.text)"
    Update-PinkieProgress ([int]$data.step) ([int]$data.total) ([string]$data.state)
    if ($mascot) {
      if ($data.state -eq 'done') { Set-PinkieArt $mascot 'done' }
      elseif ($data.state -eq 'failed') { Set-PinkieArt $mascot 'oops' }
    }
    # The failure window has taken over; it is already on screen.
    if (-not $script:ownerId -and $data.owner) { $script:ownerId = [int]$data.owner }
    if ($data.state -eq 'problem') { $window.Close() }
  } catch {}
  # Stay up until the replacer has exited AND an App window is on screen (or
  # 90 s later). Closing earlier left people with nothing to look at while the
  # restored or new version was still opening, and they clicked the desktop
  # icon in the middle of the swap.
  $ownerAlive = $seconds -lt 30
  if ($script:ownerId) {
    try { $ownerAlive = [bool](Get-Process -Id $script:ownerId -ErrorAction SilentlyContinue) } catch { $ownerAlive = $false }
  }
  if (-not $ownerAlive) {
    if (-not $script:ownerGoneAt) { $script:ownerGoneAt = Get-Date; $line.Text = '马上就好，正在打开碧琪…' }
    $appShown = $false
    try { $appShown = [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '超級碧琪' } | Select-Object -First 1) } catch {}
    if ($appShown -and -not $script:closeAt) { $script:closeAt = (Get-Date).AddSeconds(2) }
    if (((Get-Date) - $script:ownerGoneAt).TotalSeconds -gt 90) { $window.Close() }
  }
  if ($script:closeAt -and (Get-Date) -ge $script:closeAt) { $window.Close() }
  if ($seconds -gt 1500) { $window.Close() }
})
$timer.Start()
# The App waits for this file before it tells the replacer not to open a second
# card. If we never get here, the replacer still opens one.
try { Set-Content -LiteralPath ($Status + '.shown') -Value '1' -Encoding ascii } catch {}
[void]$window.ShowDialog()
Remove-Item -LiteralPath $Status -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'''

# 「用管理员权限修复」: runs elevated (UAC) from the failure window. Stops what
# still runs from the install, copies the previous (or else the new) copy back
# with robocopy's backup mode, which reads past ACLs, and starts the App again
# through Explorer so it runs as the signed-in user, never as administrator.
REPAIR_PS = r'''param(
  [string]$Mode = 'dir',
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$TargetExe,
  [string]$Backup = '',
  [string]$Failed = '',
  [Parameter(Mandatory=$true)][string]$LogPath
)
$ErrorActionPreference = 'Stop'
try { $Host.UI.RawUI.WindowTitle = '超級碧琪 · 管理员修复' } catch {}
function Write-RepairLog([string]$Message) {
  try { Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] admin repair: $Message" } catch {}
}
function Stop-Owned([string]$Root) {
  if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return }
  $prefix = (Get-Item -LiteralPath $Root).FullName.TrimEnd('\') + '\'
  foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessId -ne $PID -and $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) })) {
    try { & taskkill.exe /PID $process.ProcessId /F | Out-Null } catch {}
  }
}
try {
  Write-Host '正在用管理员权限修复超級碧琪，大约一分钟，请不要关闭这个窗口……'
  Write-RepairLog "started (mode $Mode, target $Target)"
  $source = $null
  foreach ($candidate in @($Backup, $Failed)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { $source = $candidate; break }
  }
  if ($Mode -eq 'file') {
    if ($source) { Copy-Item -LiteralPath $source -Destination $TargetExe -Force; Write-RepairLog "restored $TargetExe from $source" }
  } else {
    foreach ($root in @($Target, $Backup, $Failed)) { Stop-Owned $root }
    if ($source) {
      Write-RepairLog "copying $source -> $Target"
      & robocopy.exe $source $Target /E /B /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
      $code = $LASTEXITCODE
      if ($code -ge 8) {
        Write-RepairLog "robocopy /B exit code $code, retrying without backup mode"
        & robocopy.exe $source $Target /E /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        $code = $LASTEXITCODE
      }
      if ($code -ge 8) { throw "robocopy exit code $code" }
    }
  }
  if (-not (Test-Path -LiteralPath $TargetExe -PathType Leaf)) { throw '找不到可以恢复的版本' }
  Write-RepairLog 'repaired; starting the App as the signed-in user'
  Write-Host '修好了，正在打开碧琪……'
  & explorer.exe $TargetExe
  Start-Sleep -Seconds 2
} catch {
  Write-RepairLog "failed: $($_.Exception.Message)"
  try {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show("管理员修复也没有完成：$($_.Exception.Message)`n`n可以重新下载便携版，解压到原来的位置，记忆和设置不受影响。`n`n详细记录：$LogPath", '超級碧琪更新', 'OK', 'Warning')
  } catch {}
}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'''

# Shared by both replacers (injected at "#@@UPDATE_UI@@").
UPDATE_LOG_PS = r'''function Write-UpdateLog([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  # Readers and the App's own writer can briefly deny access on Windows.
  # Retry sharing/lock violations only; an unavailable diagnostic log must
  # never throw into the file swap, readiness check, or rollback path.
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    try { Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value $line -ErrorAction Stop; return }
    catch {
      $cause = $_.Exception
      while ($cause.InnerException) { $cause = $cause.InnerException }
      if ($attempt -eq 3 -or ($cause.HResult -band 0xFFFF) -notin @(32, 33)) { break }
      Start-Sleep -Milliseconds 80
    }
  }
  try { [Console]::Error.WriteLine($line) } catch {}
}
'''

UPDATE_UI_PS = r'''$ProgressFile = Join-Path $UpdateRoot ('progress-' + $Token + '.json')
$script:PinkieArtDir = Join-Path $UpdateRoot 'art'
$script:repairStarted = $false
function Set-UpdateProgress([int]$Step, [string]$Text, [string]$State = 'running') {
  try {
    @{ step = $Step; total = 5; text = $Text; state = $State; owner = $PID } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath $ProgressFile -Encoding UTF8
  } catch {}
}
function ConvertTo-Argument([string]$Value) { '"' + $Value + '"' }
function Start-UpdateProgressWindow {
  # The App normally opens the progress window itself before it closes. If it
  # could not, open it here -- with CREATE_NO_WINDOW only. Start-Process
  # -WindowStyle Hidden (2.5.36) passed SW_HIDE, and Windows applies that to
  # the WPF window's first ShowWindow: the window existed but nobody saw it.
  if ($ProgressShown -or -not $ProgressScript -or -not (Test-Path -LiteralPath $ProgressScript)) { return }
  try {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $PSHOME 'powershell.exe'
    $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -STA -File ' + (ConvertTo-Argument $ProgressScript) +
      ' -Status ' + (ConvertTo-Argument $ProgressFile) + ' -Owner ' + $PID + ' -Version ' + (ConvertTo-Argument $Version)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    [void][System.Diagnostics.Process]::Start($info)
  } catch { Write-UpdateLog "could not show update progress: $($_.Exception.Message)" }
}
''' + FOREGROUND_PS + PINKIE_WPF_PS + r'''function Start-AsUser([string]$Exe, [string]$HealthToken = '') {
  if (-not $LaunchAsUser) {
    if ($HealthToken) { return Start-Process -FilePath $Exe -ArgumentList "--update-health-token=$HealthToken" -PassThru }
    return Start-Process -FilePath $Exe -PassThru
  }
  # This helper runs elevated. The App must not: Explorer starts it as the
  # signed-in user. Explorer passes no arguments, so the token goes by file.
  if ($HealthToken) {
    @{ token = $HealthToken; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath (Join-Path $UpdateRoot 'health\pending-launch.json') -Encoding UTF8
  }
  $since = (Get-Date).AddSeconds(-2)
  $full = [IO.Path]::GetFullPath($Exe)
  & explorer.exe $full
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    foreach ($item in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $full, [System.StringComparison]::OrdinalIgnoreCase) })) {
      $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
      if ($process -and $process.StartTime -ge $since) { return $process }
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}
function Show-UpdateProblem([string]$Text) {
  # Last resort when no App window will come back to explain what happened.
  # A real window with a way out, not just an OK box: the admin button copies
  # the previous version back even where this user may not write.
  $offer = [bool]($RepairScript -and (Test-Path -LiteralPath $RepairScript))
  Write-UpdateLog ('showing the update problem window' + $(if ($offer) { ' (admin repair offered)' } else { '' }))
  try {
    Add-Type -AssemblyName PresentationFramework
    try {
      $script:problemWindow = New-PinkieWindow '超級碧琪更新 · 没有装上' '这次更新没有装好'
      $script:problemWindow.Width = 600  # room for the three buttons on one row
      $body = $script:problemWindow.FindName('Line')
      $script:problemResult = $script:problemWindow.FindName('Result')
      $row = $script:problemWindow.FindName('Buttons'); $row.Visibility = 'Visible'
      $script:problemWindow.FindName('ProgressArea').Visibility = 'Collapsed'
      $script:problemWindow.FindName('Hint').Text = '需要帮忙的话，把上面的详细记录发给我们。'
      Set-PinkieArt ($script:problemWindow.FindName('Mascot')) 'oops'
      $primaryStyle = $script:problemWindow.FindResource('PillPrimary'); $pillStyle = $script:problemWindow.FindResource('Pill')
    } catch {
      Write-UpdateLog "designed problem window unavailable, using a plain one: $($_.Exception.Message)"
      $script:problemWindow = New-Object Windows.Window
      $script:problemWindow.Title = '超級碧琪更新 · 没有装上'; $script:problemWindow.Width = 480; $script:problemWindow.SizeToContent = 'Height'
      $script:problemWindow.WindowStartupLocation = 'CenterScreen'; $script:problemWindow.Topmost = $true; $script:problemWindow.ResizeMode = 'NoResize'
      $panel = New-Object Windows.Controls.StackPanel; $panel.Margin = '22,18,22,18'
      $heading = New-Object Windows.Controls.TextBlock; $heading.FontSize = 15; $heading.FontWeight = 'SemiBold'; $heading.Text = '这次更新没有装好'
      $body = New-Object Windows.Controls.TextBlock; $body.Margin = '0,10,0,0'
      $script:problemResult = New-Object Windows.Controls.TextBlock; $script:problemResult.Margin = '0,10,0,0'; $script:problemResult.Foreground = 'Firebrick'
      $row = New-Object Windows.Controls.WrapPanel; $row.Margin = '0,14,0,0'
      foreach ($node in @($heading, $body, $row, $script:problemResult)) { [void]$panel.Children.Add($node) }
      $script:problemWindow.Content = $panel
      $primaryStyle = $null; $pillStyle = $null
    }
    $body.TextWrapping = 'Wrap'; $body.Text = $Text
    $script:problemResult.TextWrapping = 'Wrap'
    function New-ProblemButton([string]$Label, $Style) {
      $button = New-Object Windows.Controls.Button; $button.Content = $Label
      if ($Style) { $button.Style = $Style } else { $button.Padding = '14,6,14,6'; $button.Margin = '0,0,8,0' }
      return $button
    }
    if ($offer) {
      $admin = New-ProblemButton '用管理员权限修复' $primaryStyle; $admin.IsDefault = $true
      $admin.Add_Click({
        try {
          Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -ArgumentList $script:RepairArguments | Out-Null
          $script:repairStarted = $true
          Write-UpdateLog 'admin repair started'
          $script:problemWindow.Close()
        } catch {
          Write-UpdateLog "admin repair not started: $($_.Exception.Message)"
          $script:problemResult.Visibility = 'Visible'
          $script:problemResult.Text = '没有拿到管理员权限（可能点了「否」）。可以再点一次，或者点「打开文件夹」按上面的说明处理。'
        }
      })
      [void]$row.Children.Add($admin)
    }
    $open = New-ProblemButton '打开文件夹' $(if ($offer) { $pillStyle } else { $primaryStyle })
    $open.Add_Click({ try { Start-Process -FilePath explorer.exe -ArgumentList (ConvertTo-Argument $script:ProblemFolder) | Out-Null } catch {} })
    $close = New-ProblemButton '关闭' $pillStyle; $close.IsCancel = $true
    $close.Add_Click({ $script:problemWindow.Close() })
    foreach ($node in @($open, $close)) { [void]$row.Children.Add($node) }
    $script:problemWindow.Add_Loaded({ Show-Foreground $script:problemWindow; Set-UpdateProgress 5 '没有装上' 'problem' })
    [void]$script:problemWindow.ShowDialog()
  } catch {
    Write-UpdateLog "could not show update problem window: $($_.Exception.Message)"
    Set-UpdateProgress 5 '没有装上' 'problem'
    try { [void][System.Windows.MessageBox]::Show($Text, '超級碧琪更新', 'OK', 'Warning') } catch {}
  }
}
function Remove-UnusedRepairScript {
  if (-not $script:repairStarted -and $RepairScript) { Remove-Item -LiteralPath $RepairScript -Force -ErrorAction SilentlyContinue }
}
'''
