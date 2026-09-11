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
$setup = Join-Path $dist "agents-one-$ExpectedVersion-setup.exe"
$portable = Join-Path $dist "agents-one-$ExpectedVersion-portable.exe"

foreach ($required in @($executable, $appAsar, $setup, $portable)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required Windows package resource is missing: $required"
  }
  if ((Get-Item -LiteralPath $required).Length -le 0) {
    throw "Required Windows package resource is empty: $required"
  }
}

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
    [int]$WaitSeconds
  )

  $smokeRoot = Join-Path $tempRoot ("agents-one-package-smoke-" + [guid]::NewGuid().ToString("N"))
  $userData = Join-Path $smokeRoot "user-data"
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $launcher = $null
  $matchingProcesses = @()
  $portableExtractionRoots = @()

  try {
    $launcher = Start-Process -FilePath $Target -ArgumentList "--user-data-dir=$userData" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds $WaitSeconds
    $launcher.Refresh()
    if ($launcher.HasExited) {
      throw "$Label exited during startup smoke test with code $($launcher.ExitCode)"
    }
    if (-not (Test-Path -LiteralPath $userData -PathType Container)) {
      throw "$Label did not initialize the isolated userData path"
    }
    if (-not (Get-ChildItem -LiteralPath $userData -Force | Select-Object -First 1)) {
      throw "$Label did not write startup data to the isolated userData path"
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

Invoke-StartupSmoke -Target $executable -Label "Unpacked application" -WaitSeconds 12
Invoke-StartupSmoke -Target $portable -Label "Portable package" -WaitSeconds 20
