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
$smokeRoot = Join-Path $tempRoot ("agents-one-package-smoke-" + [guid]::NewGuid().ToString("N"))
$userData = Join-Path $smokeRoot "user-data"
New-Item -ItemType Directory -Path $userData -Force | Out-Null
$process = $null

try {
  $process = Start-Process -FilePath $executable -ArgumentList "--user-data-dir=$userData" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 12
  $process.Refresh()
  if ($process.HasExited) {
    throw "Packaged Agents One exited during startup smoke test with code $($process.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $userData -PathType Container)) {
    throw "Packaged Agents One did not initialize the isolated userData path"
  }
  if (-not (Get-ChildItem -LiteralPath $userData -Force | Select-Object -First 1)) {
    throw "Packaged Agents One did not write startup data to the isolated userData path"
  }
  Write-Host "Packaged startup passed for Agents One $ExpectedVersion (PID $($process.Id))."
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }
  $resolvedSmoke = [System.IO.Path]::GetFullPath($smokeRoot)
  if ($resolvedSmoke.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedSmoke)) {
    Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force
  }
}
