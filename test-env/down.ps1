<#
Stop the plugin test environment.

  .\down.ps1          stop and remove the containers, keep the data
  .\down.ps1 -Reset   also delete the volumes and .secrets (next up.ps1 seeds from scratch)
#>
param([switch]$Reset)
# Native tools write progress to stderr; with 'Stop' PowerShell 5.1 would
# treat that as an error once output is redirected. Exit codes are checked.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

if ($Reset) {
    & docker compose --profile ai down --volumes --remove-orphans
    if (Test-Path '.secrets') { Remove-Item -Recurse -Force '.secrets' }
} else {
    & docker compose --profile ai down --remove-orphans
}
if ($LASTEXITCODE -ne 0) { throw "docker compose down failed ($LASTEXITCODE)" }
