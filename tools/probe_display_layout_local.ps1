#Requires -Version 5.1
<#
Explicit operator-only review of a PRIVATE synthetic Excel workbook.
Do not use this to capture customer records or the entire desktop.
Never changes resolution or screen scale.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [switch]$SyntheticDataReviewed,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceHead,
    [Parameter(Mandatory=$true)][ValidateSet('1920x1080@100','1920x1080@125','1366x768@150')][string]$ExpectedMode
)
$ErrorActionPreference = 'Stop'
if ($env:CI -or $env:GITHUB_ACTIONS -or -not [Environment]::UserInteractive) {
    throw 'LOCAL_DISPLAY_REVIEW_REQUIRES_INTERACTIVE_OPERATOR'
}
if (-not $SyntheticDataReviewed) {
    throw 'EXPLICIT_ANONYMOUS_SYNTHETIC_WORKBOOK_REVIEW_REQUIRED'
}
$source = (Resolve-Path -LiteralPath $Workbook -ErrorAction Stop).Path
if ([IO.Path]::GetExtension($source) -cne '.xlsm' -or
    $source.StartsWith('\\') -or
    -not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'PRIVATE_DISPLAY_SOURCE_MUST_BE_LOCAL_XLSM'
}
if (Test-Path -LiteralPath $EvidenceDirectory) {
    throw 'DISPLAY_EVIDENCE_DIRECTORY_ALREADY_EXISTS'
}
$length = (Get-Item -LiteralPath $source).Length
if ($length -lt 100000 -or $length -gt 100000000) {
    throw 'PRIVATE_DISPLAY_SOURCE_SIZE_OUT_OF_SCOPE'
}
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$originalRunnerTemp = $env:RUNNER_TEMP
$root = Join-Path ([IO.Path]::GetTempPath()) ('furusato_private_display_' + [Guid]::NewGuid().ToString('N'))
$isolatedWorkbook = Join-Path $root 'Furusato_nouzei.xlsm'
New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
try {
    Copy-Item -LiteralPath $source -Destination $isolatedWorkbook -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $isolatedWorkbook -Algorithm SHA256).Hash -cne $sourceHash) {
        throw 'PRIVATE_DISPLAY_STAGING_SHA256_MISMATCH'
    }
    # This environment variable is changed only for the current process;
    # the CI-only collector retains all its own safety guards and remains
    # restricted to the isolated location below.
    $env:RUNNER_TEMP = $root
    & (Join-Path $PSScriptRoot 'probe_display_layout.ps1') -Workbook $isolatedWorkbook -EvidenceDirectory $EvidenceDirectory -SourceHead $SourceHead
    if (-not $?) {
        throw 'LOCAL_DISPLAY_CAPTURE_FAILED'
    }
    $reportPath = Join-Path $EvidenceDirectory 'display_review.json'
    $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($report.schema -cne 'furusato-display-review/v2' -or $report.status -cne 'MEASURED') {
        throw ('LOCAL_DISPLAY_CAPTURE_UNVERIFIED_' + [string]$report.failure_category)
    }
    if ($report.source_head -cne $SourceHead -or
        $report.workbook_sha256 -cne $sourceHash.ToLowerInvariant() -or
        $report.mode -cne $ExpectedMode) {
        throw 'LOCAL_DISPLAY_WRONG_HEAD_HASH_OR_MODE'
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne $sourceHash) {
        throw 'PRIVATE_DISPLAY_SOURCE_CHANGED_DURING_CAPTURE'
    }
    Write-Host 'LOCAL_SYNTHETIC_EXCEL_DISPLAY_OBSERVED_SOURCE_BINDING_REQUIRED_RELEASE_HOLD'
} finally {
    $env:RUNNER_TEMP = $originalRunnerTemp
    if (Test-Path -LiteralPath $root) {
        for ($i=0; $i -lt 5; $i++) {
            try {
                Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
                break
            } catch {
                if ($i -eq 4) {
                    Write-Warning 'ISOLATED_SYNTHETIC_DISPLAY_COPY_REQUIRES_LOCAL_CLEANUP'
                } else {
                    Start-Sleep -Seconds 2
                }
            }
        }
    }
}
