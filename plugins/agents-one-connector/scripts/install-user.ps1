param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "AgentsOne\Connector"),
  [string]$AdapterPath,
  [switch]$Startup
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $npm) { throw "npm.cmd 未找到，请先安装用户级 Node.js。" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
& $npm install --prefix $InstallDir --omit=dev $source
if ($LASTEXITCODE -ne 0) { throw "Agents One Connector CLI 安装失败。" }

if ($AdapterPath) {
  $run = Join-Path $InstallDir "run-connector.ps1"
  $cli = Join-Path $InstallDir "node_modules\@agents-one\connector-cli\bin\agents-one-connector.mjs"
  $content = @"
`$ErrorActionPreference = 'Stop'
& node '$cli' run --adapter '$AdapterPath'
"@
  Set-Content -LiteralPath $run -Value $content -Encoding UTF8
  if ($Startup) {
    $startupDir = [Environment]::GetFolderPath('Startup')
    $launcher = Join-Path $startupDir 'Agents-One-Connector.ps1'
    Copy-Item -LiteralPath $run -Destination $launcher -Force
    Write-Output ("用户登录启动已配置：{0}" -f $launcher)
  }
}
Write-Output ("安装完成：{0}" -f $InstallDir)
