#Requires -Version 5.1
<#
Prepare a disposable VBAUpdater v4.18 project. When installed, run the
read-only preflight and diff CLI against that copy. No project-push or sync.
The original reviewed XLSM and canonical BAS are never modified.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [Parameter(Mandatory=$true)][string]$StagingRoot,
    [Parameter(Mandatory=$true)][string]$EvidencePath,
    [string]$UpdaterRoot = ''
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$inputPath = (Resolve-Path -LiteralPath $Workbook).Path
$originalHash = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash
$stage = [IO.Path]::GetFullPath($StagingRoot)
$report = [ordered]@{
    schema = 'furusato-vbaupdater-readonly/v1'
    status = 'NOT_STARTED'
    stage_prepared = $false
    project_preflight = 'NOT_RUN'
    project_diff = 'NOT_RUN'
    original_workbook_sha256 = $originalHash
    stage_workbook_sha256 = ''
    original_preserved = $false
    error_category = ''
    warning = 'Never interprets a staging PASS as product VBAUpdater deployment/compile acceptance.'
}
try {
    & python (Join-Path $root 'tools/prepare_vbaupdater_project.py') --workbook $inputPath --destination $stage
    if ($LASTEXITCODE -ne 0) { throw 'Isolated VBAUpdater staging failed' }
    $report.stage_prepared = $true
    $target = Join-Path $stage 'target/Furusato_nouzei.xlsm'
    $report.stage_workbook_sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($report.stage_workbook_sha256 -cne $originalHash) {
        throw 'Staging changed the verified workbook'
    }
    if (-not $UpdaterRoot) {
        if ($env:VBAUPDATER_ROOT) {
            $UpdaterRoot = $env:VBAUPDATER_ROOT
        } else {
            foreach ($candidate in @(
                (Join-Path $env:USERPROFILE 'Development/VBAUpdater'),
                (Join-Path $env:USERPROFILE 'VBAUpdater')
            )) {
                if (Test-Path -LiteralPath (Join-Path $candidate 'vba.cmd') -PathType Leaf) {
                    $UpdaterRoot = $candidate
                    break
                }
            }
        }
    }
    if (-not $UpdaterRoot -or -not (Test-Path -LiteralPath (Join-Path $UpdaterRoot 'vba.cmd') -PathType Leaf)) {
        $report.status = 'PREPARED_UPDATER_NOT_FOUND'
        $report.project_preflight = 'SKIPPED_NO_UPDATER'
        $report.project_diff = 'SKIPPED_NO_UPDATER'
        Write-Host 'VBAUpdater: staging validated; external CLI unavailable (not counted as acceptance).'
    } else {
        $updater = (Resolve-Path -LiteralPath $UpdaterRoot).Path
        $cli = Join-Path $updater 'vba.cmd'
        # The CLI requires its own directory to resolve its private modules.
        # Silence output to avoid leaking runner file paths into public CI logs.
        Push-Location -LiteralPath $updater
        try {
            & $cli project-preflight -ProjectRoot $stage *> $null
            if ($LASTEXITCODE -ne 0) {
                $report.project_preflight = 'FAIL'
                throw 'VBAUpdater project-preflight returned a failure'
            }
            $report.project_preflight = 'PASS'
            & $cli project-diff -ProjectRoot $stage *> $null
            if ($LASTEXITCODE -ne 0) {
                $report.project_diff = 'FAIL'
                throw 'VBAUpdater read-only project-diff returned a failure'
            }
            $report.project_diff = 'PASS'
        } finally {
            Pop-Location
        }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -cne $originalHash) {
            throw 'Read-only VBAUpdater commands unexpectedly modified staged XLSM'
        }
        $report.status = 'READONLY_PREFLIGHT_DIFF_PASS'
        Write-Host 'VBAUpdater: project-preflight and read-only project-diff PASS on isolated XLSM.'
    }
} catch {
    $report.status = 'FAIL'
    $report.error_category = $_.Exception.GetType().Name
    Write-Host ('VBAUpdater bridge failure category: ' + $report.error_category)
    throw
} finally {
    $report.original_preserved = (
        (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -ceq $originalHash
    )
    if (-not $report.original_preserved) {
        $report.status = 'FAIL'
        $report.error_category = 'OriginalWorkbookChecksumMismatch'
    }
    $evidenceDir = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $evidenceDir)) {
        [void][IO.Directory]::CreateDirectory($evidenceDir)
    }
    [IO.File]::WriteAllText($EvidencePath,
        ($report | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false)))
}
if ($report.status -eq 'FAIL') { exit 1 }
