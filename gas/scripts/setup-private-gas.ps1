<#
.SYNOPSIS
  Conservative installer for the owner's PRIVATE Google Apps Script test project.
.DESCRIPTION
  The default operation is read-only - no OAuth, API calls or deployment.
  CreateProject and PushSource are explicit user options and require an existing
  Google-account authorization performed interactively. This script NEVER
  creates an internet-accessible web deployment. Confirm script manifest access
  MYSELF / USER_DEPLOYING in Apps Script before any test deployment.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\gas\scripts\setup-private-gas.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\gas\scripts\setup-private-gas.ps1 -SpreadsheetId <Google-Sheet-ID> -CreateProject -PushSource
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_-]{20,120}$')]
    [string]$SpreadsheetId = '',
    [switch]$CreateProject,
    [switch]$PushSource,
    [switch]$OpenProject,
    [switch]$AllowExistingProject
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sourceFiles = @('Code.gs', 'Engine.gs', 'Index.html', 'appsscript.json')
$expected = @('**/**', '!Code.gs', '!Engine.gs', '!Index.html', '!appsscript.json')

foreach ($file in $sourceFiles) {
    $path = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required GAS source is missing: $file"
    }
}
$ignoreFile = Join-Path $root '.claspignore'
if (-not (Test-Path -LiteralPath $ignoreFile -PathType Leaf)) {
    throw "Missing .claspignore. Deployment is blocked."
}
$actual = @(Get-Content -LiteralPath $ignoreFile -Encoding UTF8 | Where-Object { $_.Trim() -ne '' })
if ($actual.Count -ne $expected.Count) {
    throw "Unsafe .claspignore: an unexpected file may be uploaded."
}
for ($i = 0; $i -lt $expected.Count; $i++) {
    if ($actual[$i] -cne $expected[$i]) {
        throw "Unsafe .claspignore pattern in line $($i + 1)."
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $root 'appsscript.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.webapp.access -cne 'MYSELF' -or $manifest.webapp.executeAs -cne 'USER_DEPLOYING') {
    throw "The Apps Script manifest is not restricted to MYSELF / USER_DEPLOYING."
}
$scopes = @($manifest.oauthScopes)
if ($scopes.Count -ne 1 -or $scopes[0] -cne 'https://www.googleapis.com/auth/spreadsheets.currentonly') {
    throw "Unexpected OAuth scopes in Apps Script manifest."
}
Write-Output 'PREFLIGHT_PASS: GAS source, publish allowlist, self-only access and OAuth scope verified.'
$performWrite = [bool]($CreateProject -or $PushSource -or $OpenProject)
if (-not $performWrite) {
    Write-Output 'READ_ONLY: No Google login, project creation, code upload or deployment attempted.'
    Write-Output 'For private setup: install Node 20+, run npm install -g @google/clasp, and use -SpreadsheetId ... -CreateProject -PushSource.'
    return
}
if ([string]::IsNullOrWhiteSpace($SpreadsheetId)) {
    throw 'A target -SpreadsheetId is mandatory for Google operations.'
}
$clasp = Get-Command clasp -ErrorAction SilentlyContinue
if (-not $clasp) {
    throw 'clasp was not found. Install Node 20+ then npm install -g @google/clasp.'
}
$cfg = Join-Path $root '.clasp.json'
if ((Test-Path -LiteralPath $cfg) -and $CreateProject) {
    throw 'A .clasp.json is already present; refuse to create another project over it.'
}
if (-not (Test-Path -LiteralPath $cfg) -and -not $CreateProject) {
    throw 'There is no .clasp.json; use -CreateProject first, or work from the original configured directory.'
}
if ($PushSource -and -not $CreateProject -and -not $AllowExistingProject) {
    throw 'Existing Apps Script content may be overwritten. Re-run with -AllowExistingProject only after verifying the script ID.'
}
Push-Location $root
try {
    if ($CreateProject) {
        Write-Output 'A Google browser login may be required. Confirm the correct Google account and enable Apps Script API access.'
        & clasp create-script --title 'Furusato GAS private review' --parentId $SpreadsheetId
        if ($LASTEXITCODE -ne 0) { throw 'clasp create-script failed. No code was pushed.' }
        if (-not (Test-Path -LiteralPath $cfg)) { throw 'No .clasp.json after create-script.' }
        Write-Output 'PROJECT_CREATED: Check the bound spreadsheet and script ID before any deployment.'
    }
    if ($PushSource) {
        & clasp show-file-status
        if ($LASTEXITCODE -ne 0) { throw 'clasp source review failed.' }
        & clasp push
        if ($LASTEXITCODE -ne 0) { throw 'clasp push failed; test project was not accepted.' }
        Write-Output 'SOURCE_PUSHED: No web app deployed. Confirm self-only permissions manually in Google Apps Script.'
    }
    if ($OpenProject) {
        & clasp open-script
        if ($LASTEXITCODE -ne 0) { throw 'Could not open the script editor.' }
    }
} finally {
    Pop-Location
}
