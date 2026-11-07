<#
.SYNOPSIS
  Isolated Furusato installer. Default: offline read-only preflight.
.DESCRIPTION
  Never adopts an existing Script ID or spreadsheet. Creates its own synthetic
  sheet; verifies HousingERP denylist and live metadata before each push.
  OAuth and receipt stay in gas/.private/furusato; global clasp auth is untouched.
#>
[CmdletBinding()]
param(
  [switch]$Login,
  [switch]$Diagnose,
  [switch]$CreateProject,
  [switch]$PushSource,
  [switch]$DeployPrivate,
  [string]$ProtectedRoot = ''
)
$ErrorActionPreference = 'Stop'
$entry = Join-Path (Split-Path -Parent $PSScriptRoot) 'deployment/private-gas.cjs'
if ($Login -and ($CreateProject -or $PushSource -or $DeployPrivate)) { throw 'Run Login separately.' }
if ($Diagnose -and ($Login -or $CreateProject -or $PushSource -or $DeployPrivate)) { throw 'Run Diagnose separately: read-only mode.' }
$mode = 'preflight'
if ($Login) { $mode = 'login' }
if ($Diagnose) { $mode = 'diagnose' }
if ($CreateProject -or $PushSource -or $DeployPrivate) { $mode = 'install' }
$nodeArgs = @($entry, $mode)
if ($DeployPrivate) { $nodeArgs += '--deploy' }
if ($ProtectedRoot) { $nodeArgs += @('--protected-root', $ProtectedRoot) }
& node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw 'Furusato installer stopped. Formal release HOLD.' }
