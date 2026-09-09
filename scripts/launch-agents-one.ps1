param()

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ElectronPath = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$PortableNpm = if ($NpmCommand) { $NpmCommand.Source } else { $null }

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

$Existing = Get-AgentsOneWindow
if ($Existing) {
  Show-AgentsOneWindow $Existing
  exit 0
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

if (-not (Test-Path -LiteralPath $ElectronPath) -or -not $PortableNpm -or -not (Test-Path -LiteralPath $PortableNpm)) {
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
$env:HERMES_HOME = Join-Path $env:LOCALAPPDATA "hermes"
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

Start-Process $PortableNpm `
  -ArgumentList @("run", "dev") `
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
