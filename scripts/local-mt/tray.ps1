<#
.SYNOPSIS
  System-tray controller for the LingoFlux local MT stack (llama-server + bridge).

.DESCRIPTION
  Starts scripts/local-mt/start.mjs hidden in the background, shows its state in the Windows
  notification area, and offers Start / Stop / Restart / Model / Copy base URL / Open log / Quit.
  The Model menu picks which local models are loaded: Gemma 4 E2B, Index-Translate 2B, or both. The choice is
  saved in .local-mt/config.json (also read by `npm run local-mt:start`) and a running stack restarts with it.
  The desktop shortcut created by `npm run local-mt:shortcut` launches this script.
  Output of the stack goes to .local-mt/logs/local-mt.log (git-ignored). Windows PowerShell 5.1+.

.PARAMETER Models
  gemma, index, or all. Empty uses the saved selection (default gemma).

.PARAMETER SelfTest
  Runs start, restart, and stop without any UI and prints the result (used to verify the process logic).
#>
param(
  # Keep in sync with BRIDGE_PORT / LLAMA_PORT in scripts/local-mt/paths.mjs (checked by tests).
  [int]$BridgePort = 37813,
  [int]$LlamaPort = 37814,
  [string]$Quant = 'Q4_K_M',
  [int]$Parallel = 32,
  [string]$Models = '',
  [switch]$SelfTest
)

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalDir = Join-Path $Root '.local-mt'
$LogDir = Join-Path $LocalDir 'logs'
$LogFile = Join-Path $LogDir 'local-mt.log'
$ConfigFile = Join-Path $LocalDir 'config.json'
$BaseUrl = "http://127.0.0.1:$BridgePort/v1"
$AppName = 'LingoFlux Local MT'

# Keep in sync with scripts/local-mt/models.mjs (keys, GGUF file names, llama-server port offsets; checked by tests).
$ModelCatalog = [ordered]@{
  gemma = @{ Label = 'Gemma 4 E2B'; File = "gemma-4-E2B-it-$Quant.gguf"; PortOffset = 0 }
  index = @{ Label = 'Index-Translate 2B'; File = 'Index-Translate-2B.Q8_0.gguf'; PortOffset = 1 }
}
$SelectionLabels = [ordered]@{
  gemma = 'Gemma 4 E2B (fast, best dialogue)'
  index = 'Index-Translate 2B (documents, HTML)'
  all   = 'Both models (load all)'
}

function Get-SelectionKeys([string]$Selection) {
  if ($Selection -eq 'all') { return @($ModelCatalog.Keys) }
  return @($Selection)
}

function Get-Selection {
  if ($SelectionLabels.Contains($script:Selection)) { return $script:Selection }
  $value = ''
  if (Test-Path $ConfigFile) {
    try { $value = [string](Get-Content -Raw -Path $ConfigFile | ConvertFrom-Json).models } catch { $value = '' }
  }
  $value = $value.Trim().ToLowerInvariant()
  if ($SelectionLabels.Contains($value)) { return $value }
  return 'gemma'
}

function Save-Selection([string]$Selection) {
  New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
  # UTF-8 without BOM so Node's JSON.parse reads it.
  [System.IO.File]::WriteAllText($ConfigFile, "{`n  `"models`": `"$Selection`"`n}`n")
  $script:Selection = $Selection
}

function Get-SelectionText([string]$Selection) {
  return ((Get-SelectionKeys $Selection) | ForEach-Object { $ModelCatalog[$_].Label }) -join ' + '
}

$script:Selection = ''
if ($Models) { $script:Selection = $Models.Trim().ToLowerInvariant() }
$script:Selection = Get-Selection

$script:Proc = $null
$script:StopRequested = $false
$script:LastState = ''

function Test-Health([int]$Port) {
  try {
    $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/health")
    $request.Timeout = 800
    $request.Proxy = $null
    $response = $request.GetResponse()
    $ok = [int]$response.StatusCode -eq 200
    $response.Close()
    return $ok
  } catch {
    return $false
  }
}

function Get-PortOwnerIds {
  $ids = @()
  $ports = @($BridgePort) + @($ModelCatalog.Values | ForEach-Object { $LlamaPort + $_.PortOffset })
  foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) { $ids += [int]$connection.OwningProcess }
  }
  return @($ids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Test-OwnProcessAlive {
  return [bool]($script:Proc -and -not $script:Proc.HasExited)
}

function Get-StackState {
  if (Test-OwnProcessAlive) {
    if (Test-Health $BridgePort) { return 'Running' }
    return 'Starting'
  }
  if (Test-Health $BridgePort) { return 'External' }
  return 'Stopped'
}

function Start-Stack {
  if (Test-OwnProcessAlive) { return 'already-running' }
  if ((Get-PortOwnerIds).Count -gt 0) { return 'port-busy' }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 'node-missing' }
  $selection = Get-Selection
  foreach ($key in Get-SelectionKeys $selection) {
    if (-not (Test-Path (Join-Path $LocalDir "models\$($ModelCatalog[$key].File)"))) { return 'not-set-up' }
  }

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $startScript = Join-Path $Root 'scripts\local-mt\start.mjs'
  $nodeArgs = "`"$startScript`" --models $selection --quant $Quant --parallel $Parallel --port $BridgePort --llama-port $LlamaPort"
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $env:ComSpec
  # cmd /s strips the outer quotes; output of node and llama-server is appended to the log file.
  $info.Arguments = "/d /s /c `"`"$($node.Source)`" $nodeArgs > `"$LogFile`" 2>&1`""
  $info.WorkingDirectory = $Root
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $script:StopRequested = $false
  $script:Proc = [System.Diagnostics.Process]::Start($info)
  return 'started'
}

function Stop-Stack {
  $script:StopRequested = $true
  if (Test-OwnProcessAlive) {
    & taskkill.exe /PID $script:Proc.Id /T /F | Out-Null
    $script:Proc.WaitForExit(5000) | Out-Null
  }
  $script:Proc = $null
  # Leftovers from a tray that was killed: stop only node / llama-server processes listening on our ports.
  foreach ($id in Get-PortOwnerIds) {
    $process = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($process -and @('node', 'llama-server') -contains $process.ProcessName) {
      & taskkill.exe /PID $id /T /F | Out-Null
    }
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-PortOwnerIds).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
}

function Wait-State([string]$Wanted, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-StackState) -eq $Wanted) { return $true }
    if ($Wanted -ne 'Stopped' -and -not (Test-OwnProcessAlive)) { return $false }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-StartMessage([string]$Result) {
  switch ($Result) {
    'port-busy' { return "Port $BridgePort, $LlamaPort, or $($LlamaPort + 1) is already in use. Use Stop to clear leftovers." }
    'node-missing' { return 'Node.js was not found on PATH.' }
    'not-set-up' { return "Model not downloaded. Run: npm run local-mt:setup -- --models $(Get-Selection)" }
    default { return '' }
  }
}

if ($SelfTest) {
  $failed = $false
  $result = Start-Stack
  Write-Output "start: $result"
  if ($result -ne 'started') { exit 1 }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $ok = Wait-State 'Running' 180
  $llamaOk = (Get-SelectionKeys (Get-Selection) | ForEach-Object { Test-Health ($LlamaPort + $ModelCatalog[$_].PortOffset) }) -notcontains $false
  Write-Output ("running: {0} after {1:n1} s (models {2}, bridge {3}, llama {4})" -f $ok, $sw.Elapsed.TotalSeconds, (Get-SelectionText (Get-Selection)), (Test-Health $BridgePort), $llamaOk)
  if (-not $ok) { $failed = $true }
  $oldPid = $script:Proc.Id
  Stop-Stack
  Write-Output "restart: $(Start-Stack)"
  $ok = Wait-State 'Running' 180
  Write-Output ("running after restart: {0}, new process: {1}" -f $ok, ($script:Proc.Id -ne $oldPid))
  if (-not $ok) { $failed = $true }
  Stop-Stack
  $owners = Get-PortOwnerIds
  Write-Output ("stopped: state {0}, listeners left {1}" -f (Get-StackState), $owners.Count)
  if ($owners.Count -gt 0) { $failed = $true }
  if ($failed) { exit 1 }
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\LingoFluxLocalMTTray', [ref]$createdNew)
if (-not $createdNew) {
  [System.Windows.Forms.MessageBox]::Show("$AppName is already running in the system tray.", $AppName) | Out-Null
  exit 0
}

$baseImagePath = Join-Path $Root 'src\assets\icons\icon32.png'
$script:BaseImage = $null
if (Test-Path $baseImagePath) { $script:BaseImage = [System.Drawing.Image]::FromFile($baseImagePath) }

function New-StatusIcon([System.Drawing.Color]$Color) {
  $bitmap = New-Object System.Drawing.Bitmap 32, 32
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  if ($script:BaseImage) {
    $graphics.DrawImage($script:BaseImage, 0, 0, 32, 32)
  } else {
    $graphics.FillRectangle([System.Drawing.Brushes]::SteelBlue, 2, 2, 28, 28)
  }
  $graphics.FillEllipse([System.Drawing.Brushes]::White, 17, 17, 15, 15)
  $brush = New-Object System.Drawing.SolidBrush $Color
  $graphics.FillEllipse($brush, 19, 19, 11, 11)
  $brush.Dispose()
  $graphics.Dispose()
  return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$Icons = @{
  Running  = New-StatusIcon ([System.Drawing.Color]::FromArgb(34, 197, 94))
  External = New-StatusIcon ([System.Drawing.Color]::FromArgb(34, 197, 94))
  Starting = New-StatusIcon ([System.Drawing.Color]::FromArgb(245, 158, 11))
  Stopped  = New-StatusIcon ([System.Drawing.Color]::FromArgb(148, 163, 184))
  Error    = New-StatusIcon ([System.Drawing.Color]::FromArgb(239, 68, 68))
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $Icons.Stopped
$notify.Text = $AppName

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('Status: stopped')
$statusItem.Enabled = $false
$urlItem = $menu.Items.Add($BaseUrl)
$urlItem.Enabled = $false
[void]$menu.Items.Add('-')
$startItem = $menu.Items.Add('Start')
$stopItem = $menu.Items.Add('Stop')
$restartItem = $menu.Items.Add('Restart')
$modelMenu = New-Object System.Windows.Forms.ToolStripMenuItem 'Model'
$modelItems = @{}
foreach ($key in $SelectionLabels.Keys) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem $SelectionLabels[$key]
  $item.Tag = $key
  [void]$modelMenu.DropDownItems.Add($item)
  $modelItems[$key] = $item
}
[void]$menu.Items.Add($modelMenu)
[void]$menu.Items.Add('-')
$copyItem = $menu.Items.Add('Copy base URL')
$logItem = $menu.Items.Add('Open log')
$docsItem = $menu.Items.Add('Open setup guide')
[void]$menu.Items.Add('-')
$quitItem = $menu.Items.Add('Quit (stop server)')
$notify.ContextMenuStrip = $menu

function Show-Balloon([string]$Text, [System.Windows.Forms.ToolTipIcon]$Kind = [System.Windows.Forms.ToolTipIcon]::Info) {
  $notify.ShowBalloonTip(4000, $AppName, $Text, $Kind)
}

function Update-ModelMenu {
  $selection = Get-Selection
  foreach ($key in $modelItems.Keys) { $modelItems[$key].Checked = ($key -eq $selection) }
  $modelMenu.Text = "Model: $(Get-SelectionText $selection)"
}

function Update-Tray {
  $state = Get-StackState
  if ($script:Proc -and $script:Proc.HasExited -and -not $script:StopRequested) {
    $script:Proc = $null
    $state = 'Error'
    Show-Balloon 'The local translation server stopped unexpectedly. See Open log.' ([System.Windows.Forms.ToolTipIcon]::Error)
  }
  if ($state -eq $script:LastState) { return }
  if ($state -eq 'Running' -and $script:LastState -eq 'Starting') {
    Show-Balloon "Ready at $BaseUrl ($(Get-SelectionText (Get-Selection)))"
  }
  $script:LastState = $state

  $label = @{
    Running  = 'running'
    External = 'running (started elsewhere)'
    Starting = 'starting...'
    Stopped  = 'stopped'
    Error    = 'stopped with an error'
  }[$state]
  $notify.Icon = $Icons[$state]
  # NotifyIcon.Text is limited to 63 characters.
  $tip = "$AppName - $label"
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
  $notify.Text = $tip
  $statusItem.Text = "Status: $label"
  $alive = @('Running', 'Starting') -contains $state
  $startItem.Enabled = -not $alive -and $state -ne 'External'
  $stopItem.Enabled = $alive -or $state -eq 'External'
  $restartItem.Enabled = $alive -or $state -eq 'External'
}

function Invoke-Start {
  $result = Start-Stack
  $message = Get-StartMessage $result
  if ($message) { Show-Balloon $message ([System.Windows.Forms.ToolTipIcon]::Warning) }
  Update-Tray
}

$startItem.Add_Click({ Invoke-Start })
$stopItem.Add_Click({
    Stop-Stack
    Update-Tray
  })
$restartItem.Add_Click({
    Stop-Stack
    Invoke-Start
  })
foreach ($item in $modelItems.Values) {
  $item.Add_Click({
      param($sender)
      $key = [string]$sender.Tag
      if ($key -eq (Get-Selection)) { return }
      Save-Selection $key
      Update-ModelMenu
      $state = Get-StackState
      if (@('Running', 'Starting', 'External') -contains $state) {
        Show-Balloon "Switching to $(Get-SelectionText $key)..."
        Stop-Stack
        Invoke-Start
      } else {
        Update-Tray
      }
    })
}
$copyItem.Add_Click({
    [System.Windows.Forms.Clipboard]::SetText($BaseUrl)
    Show-Balloon "Copied $BaseUrl"
  })
$logItem.Add_Click({ if (Test-Path $LogFile) { Start-Process notepad.exe -ArgumentList "`"$LogFile`"" } })
$docsItem.Add_Click({ Start-Process (Join-Path $Root 'docs\LOCAL_MT.md') })
$quitItem.Add_Click({
    $timer.Stop()
    Stop-Stack
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
  })
$notify.Add_MouseDoubleClick({ Show-Balloon "Status: $($statusItem.Text.Substring(8)) - $BaseUrl" })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-Tray })

$notify.Visible = $true
Update-ModelMenu
Invoke-Start
$timer.Start()
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
