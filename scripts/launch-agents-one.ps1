param([switch]$EnableExperimentalWebAgents)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ElectronPath = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
$ViteCli = Join-Path $ProjectRoot "node_modules\electron-vite\bin\electron-vite.js"
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$PortableNode = if ($NodeCommand) { $NodeCommand.Source } else { $null }
if (-not $PortableNode -and (Test-Path -LiteralPath 'D:\efunds\nodejs\node.exe')) {
  $PortableNode = 'D:\efunds\nodejs\node.exe'
}
$LogDirectory = Join-Path $ProjectRoot '.agents-one\launcher'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
trap {
  ('{0:o} {1}' -f (Get-Date), $_.Exception.Message) | Add-Content -LiteralPath (Join-Path $LogDirectory 'launcher.error.log')
  exit 1
}
if ($EnableExperimentalWebAgents) { $env:AGENTS_ONE_ENABLE_EXPERIMENTAL_WEB_AGENTS = '1' }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AgentsOneWindow {
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function Get-AgentsOneWindow {
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne 0 -and
      $_.MainWindowTitle -eq "Agents One" -and
      $_.Path -eq $ElectronPath
    } |
    Select-Object -First 1
}

function Show-AgentsOneWindow($Process) {
  [AgentsOneWindow]::ShowWindow($Process.MainWindowHandle, 9) | Out-Null
  [AgentsOneWindow]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
}

function Assert-AgentsOneRenderer([int]$Port = 0) {
  if (-not $Port) {
    $Renderer = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $ElectronPath -and $_.CommandLine -match '--remote-debugging-port=\d+' } |
      Select-Object -First 1
    if ($Renderer) { $Port = [int]([regex]::Match($Renderer.CommandLine, '--remote-debugging-port=(\d+)').Groups[1].Value) }
  }
  if (-not $Port) { throw 'The running development app has no page health endpoint. Window presence alone cannot confirm a successful launch.' }
  $Result = & $PortableNode (Join-Path $ProjectRoot 'scripts\check-launcher-renderer.mjs') --port $Port
  $Result | Add-Content -LiteralPath (Join-Path $LogDirectory 'renderer-health.log')
  if ($LASTEXITCODE -ne 0) { throw 'Agents One window exists but the workspace did not render. Check renderer-health.log and agents-one.error.log.' }
}

$Existing = Get-AgentsOneWindow
if ($Existing) {
  Assert-AgentsOneRenderer
  Show-AgentsOneWindow $Existing
  exit 0
}

# A tray-hidden main process has no MainWindowHandle. Ask the application's
# existing second-instance handler to show it instead of terminating its tasks.
$ExistingMain = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -eq $ElectronPath -and $_.CommandLine -notmatch '--type=' } |
  Select-Object -First 1
if ($ExistingMain) {
  $env:ELECTRON_RUN_AS_NODE = $null
  Start-Process -FilePath $ElectronPath -ArgumentList @($ProjectRoot) -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
  $WakeDeadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 300
    $Existing = Get-AgentsOneWindow
    if ($Existing) { Assert-AgentsOneRenderer; Show-AgentsOneWindow $Existing; exit 0 }
  } while ((Get-Date) -lt $WakeDeadline)
  throw 'Agents One is running but its window could not be restored. Use its tray icon; the running process was preserved.'
}

# A terminated dev session can leave Electron helpers or the Vite host behind.
# Limit cleanup to this repository so unrelated Electron/Node apps are untouched.
Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $ElectronPath } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine.Contains($ProjectRoot) -and
    $_.CommandLine.Contains("electron-vite")
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Milliseconds 500

if (
  -not (Test-Path -LiteralPath $ElectronPath) -or
  -not (Test-Path -LiteralPath $ViteCli) -or
  -not $PortableNode -or
  -not (Test-Path -LiteralPath $PortableNode)
) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Agents One dependencies are not ready. Run npm install in the project directory first.",
    "Agents One",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

# This launcher is for the user's real Agents One workspace. The sandbox
# launcher deliberately uses isolated config/history and must only be used by
# automated tests, otherwise configured runtimes and prior records appear to
# disappear.
# Hermes installation discovery remains optional; do not force its home as
# an application-wide desktop data location.
$env:AGENTS_ONE_SANDBOX = $null
$env:AGENTS_ONE_USER_DATA_DIR = $null
$env:AGENTS_ONE_DEFAULT_API_PORT = $null
$env:AGENTS_ONE_PORT_RANGE_START = $null
$env:AGENTS_ONE_PORT_RANGE_END = $null
$env:AGENTS_ONE_RENDERER_PORT = $null
$env:HERMES_DESKTOP_SANDBOX = $null
$env:HERMES_DESKTOP_USER_DATA_DIR = $null
$env:HERMES_DESKTOP_DEFAULT_API_PORT = $null
$env:HERMES_DESKTOP_PORT_RANGE_START = $null
$env:HERMES_DESKTOP_PORT_RANGE_END = $null
$env:HERMES_DESKTOP_RENDERER_PORT = $null
$env:VITE_AGENTS_ONE_APP_NAME = "Agents One"

$CdpPort = 19232
while (
  $CdpPort -lt 19242 -and
  (Get-NetTCPConnection -State Listen -LocalPort $CdpPort -ErrorAction SilentlyContinue)
) {
  $CdpPort += 1
}

$env:ENABLE_CDP = "1"
$env:CDP_PORT = "$CdpPort"

$LogDirectory = Join-Path $ProjectRoot ".agents-one\launcher"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$StandardOutput = Join-Path $LogDirectory "agents-one.out.log"
$StandardError = Join-Path $LogDirectory "agents-one.error.log"

$QuotedViteCli = '"' + $ViteCli + '"'
Start-Process $PortableNode `
  -ArgumentList @($QuotedViteCli, "dev") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $StandardOutput `
  -RedirectStandardError $StandardError | Out-Null

$Deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 500
  $Started = Get-AgentsOneWindow
  if ($Started) {
    Start-Sleep -Seconds 1
    $Started.Refresh()
    if (-not $Started.HasExited -and $Started.MainWindowHandle -ne 0) {
      Assert-AgentsOneRenderer $CdpPort
      Show-AgentsOneWindow $Started
      exit 0
    }
  }
} while ((Get-Date) -lt $Deadline)

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
  "Agents One did not start within 45 seconds. Check $StandardError",
  "Agents One",
  "OK",
  "Warning"
) | Out-Null
exit 1
