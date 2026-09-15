param(
  [Parameter(Mandatory = $true)]
  [string]$DistDirectory,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
$dist = (Resolve-Path -LiteralPath $DistDirectory).Path
$unpacked = Join-Path $dist "win-unpacked"
$executable = Join-Path $unpacked "agents-one.exe"
$appAsar = Join-Path $unpacked "resources\app.asar"
$trayIcon = Join-Path $unpacked "resources\app.asar.unpacked\resources\icon.png"
$setup = Join-Path $dist "agents-one-$ExpectedVersion-setup.exe"
$portable = Join-Path $dist "agents-one-$ExpectedVersion-portable.exe"

foreach ($required in @($executable, $appAsar, $trayIcon, $setup, $portable)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required Windows package resource is missing: $required"
  }
  if ((Get-Item -LiteralPath $required).Length -le 0) {
    throw "Required Windows package resource is empty: $required"
  }
}

# A missing asset produces an empty Electron nativeImage without throwing, so
# a process and NotifyIcon host may exist while Windows has no visible tray
# icon. Verify both the PNG signature and non-zero image dimensions here.
$trayIconBytes = [System.IO.File]::ReadAllBytes($trayIcon)
$pngSignature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
if ($trayIconBytes.Length -lt 24) {
  throw "Packaged tray image is too small to be a valid PNG: $trayIcon"
}
foreach ($index in 0..7) {
  if ($trayIconBytes[$index] -ne $pngSignature[$index]) {
    throw "Packaged tray image has an invalid PNG signature: $trayIcon"
  }
}
$width = [System.Net.IPAddress]::NetworkToHostOrder(
  [System.BitConverter]::ToInt32($trayIconBytes, 16)
)
$height = [System.Net.IPAddress]::NetworkToHostOrder(
  [System.BitConverter]::ToInt32($trayIconBytes, 20)
)
if ($width -le 0 -or $height -le 0) {
  throw "Packaged tray image has invalid dimensions ${width}x${height}: $trayIcon"
}
Write-Host "Packaged tray image passed (${width}x${height}, $($trayIconBytes.Length) bytes)."

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())

function Remove-SmokeDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $resolved = [System.IO.Path]::GetFullPath($Path)
  $normalizedTempRoot = $tempRoot.TrimEnd("\")
  $parent = [System.IO.Path]::GetDirectoryName($resolved.TrimEnd("\"))
  if (-not $parent.Equals($normalizedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a smoke directory outside the direct temp root: $resolved"
  }
  if (-not (Test-Path -LiteralPath $resolved)) {
    return
  }
  foreach ($attempt in 1..5) {
    try {
      Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 5) {
        throw
      }
      Start-Sleep -Seconds 1
    }
  }
}

function Invoke-StartupSmoke {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Target,

    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds
  )

  $smokeRoot = Join-Path $tempRoot ("agents-one-package-smoke-" + [guid]::NewGuid().ToString("N"))
  $userData = Join-Path $smokeRoot "user-data"
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $launcher = $null
  $matchingProcesses = @()
  $portableExtractionRoots = @()

  try {
    $launcher = Start-Process -FilePath $Target -ArgumentList "--user-data-dir=$userData" -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $startupEvidence = $false
    $rendererStarted = $false
    do {
      if (
        (Test-Path -LiteralPath $userData -PathType Container) -and
        (Get-ChildItem -LiteralPath $userData -Force | Select-Object -First 1)
      ) {
        $startupEvidence = $true
      }
      # Writing a Preferences file only proves that Electron created its
      # profile. A main-process import failure can still leave a resident
      # browser process with no BrowserWindow, tray, or renderer. Require a
      # renderer process tied to this exact isolated invocation as well.
      try {
        $rendererStarted = $null -ne (
          Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object {
              $_.Name -like "agents-one*.exe" -and
              $_.CommandLine -and
              $_.CommandLine.IndexOf($userData, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
              $_.CommandLine -match "(?:^|\s)--type=renderer(?:\s|$)"
            } |
            Select-Object -First 1
        )
      } catch {
        Write-Warning "Could not inspect renderer startup state: $($_.Exception.Message)"
      }
      if ($startupEvidence -and $rendererStarted) {
        break
      }
      $launcher.Refresh()
      if ($launcher.HasExited) {
        $childStillRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
          Where-Object {
            $_.Name -like "agents-one*.exe" -and
            $_.CommandLine -and
            $_.CommandLine.IndexOf($userData, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
          } |
          Select-Object -First 1
        if (-not $childStillRunning) {
          throw "$Label exited during startup smoke test with code $($launcher.ExitCode)"
        }
      }
      Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $startupEvidence) {
      throw "$Label did not write startup data to the isolated userData path within $TimeoutSeconds seconds"
    }
    if (-not $rendererStarted) {
      throw "$Label did not start a renderer process for the isolated userData path within $TimeoutSeconds seconds"
    }
    Write-Host "$Label startup passed for Agents One $ExpectedVersion (launcher PID $($launcher.Id))."
  } finally {
    # Portable packages extract and launch a child executable. Match only
    # processes carrying this invocation's unique userData argument so an
    # unrelated Agents One session can never be terminated by the smoke test.
    try {
      $matchingProcesses = @(
        Get-CimInstance Win32_Process -ErrorAction Stop |
          Where-Object {
            $_.Name -like "agents-one*.exe" -and
            $_.CommandLine -and
            $_.CommandLine.IndexOf($userData, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
          }
      )
    } catch {
      Write-Warning "Could not enumerate smoke-test child processes: $($_.Exception.Message)"
    }
    $portableExtractionRoots = @(
      $matchingProcesses |
        Where-Object { $_.Name -eq "agents-one.exe" -and $_.ExecutablePath } |
        ForEach-Object { [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($_.ExecutablePath)) } |
        Where-Object {
          [System.IO.Path]::GetDirectoryName($_.TrimEnd("\")).Equals(
            $tempRoot.TrimEnd("\"),
            [System.StringComparison]::OrdinalIgnoreCase
          )
        } |
        Select-Object -Unique
    )
    foreach ($item in $matchingProcesses) {
      Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($launcher -and -not $launcher.HasExited) {
      Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue
    }
    if ($launcher) {
      $launcher.WaitForExit(5000) | Out-Null
    }
    foreach ($extractionRoot in $portableExtractionRoots) {
      Remove-SmokeDirectory -Path $extractionRoot
    }
    Remove-SmokeDirectory -Path $smokeRoot
  }
}

Invoke-StartupSmoke -Target $executable -Label "Unpacked application" -TimeoutSeconds 30
Invoke-StartupSmoke -Target $portable -Label "Portable package" -TimeoutSeconds 60
