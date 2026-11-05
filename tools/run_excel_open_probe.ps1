#Requires -Version 5.1
# One-click Windows Excel read-only diagnostic; no customer data is changed.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$manifest = Join-Path $PSScriptRoot 'manifest.json'
$probe = Join-Path $PSScriptRoot 'probe_excel_open.ps1'
$evidence = Join-Path $PSScriptRoot 'excel_open_results.json'
$confirmation = Join-Path $PSScriptRoot 'Furusato_nouzei_Excel読込確認用.xlsx'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Missing manifest.json. Extract the complete ZIP.' }
if (-not (Test-Path -LiteralPath $probe)) { throw 'Missing probe_excel_open.ps1. Extract the complete ZIP.' }
if (Test-Path -LiteralPath $confirmation -PathType Leaf) {
    & $probe -ProbeDirectory $PSScriptRoot -EvidencePath $evidence -ConfirmationWorkbook $confirmation
} else {
    Write-Host 'Previous confirmation XLSX not found. Testing five built-in XLSX files and native Excel control.'
    & $probe -ProbeDirectory $PSScriptRoot -EvidencePath $evidence
}
if (-not (Test-Path -LiteralPath $evidence)) { throw 'Excel diagnostic evidence was not written.' }
$report = Get-Content -LiteralPath $evidence -Raw -Encoding UTF8 | ConvertFrom-Json
if ($report.status -ne 'DIAGNOSTIC_ONLY') { throw 'Unexpected diagnostic status.' }
Write-Host 'Diagnosis finished. See excel_open_results.json. Product acceptance stays HOLD.'
