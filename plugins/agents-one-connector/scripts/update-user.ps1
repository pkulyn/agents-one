param([string]$InstallDir = (Join-Path $env:LOCALAPPDATA "AgentsOne\Connector"))
$ErrorActionPreference = "Stop"
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $npm) { throw "npm.cmd 未找到。" }
& $npm install --prefix $InstallDir --omit=dev '@agents-one/connector-cli@latest'
if ($LASTEXITCODE -ne 0) { throw "更新失败；现有用户目录未被主动删除。" }
Write-Output "Agents One Connector CLI 已更新。"
