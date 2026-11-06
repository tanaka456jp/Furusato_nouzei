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
    [string]$UpdaterRoot = '',
    [switch]$PushInSandbox
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
    project_push = 'NOT_RUN'
    post_push_diff = 'NOT_RUN'
    post_push_excel = 'NOT_RUN'
    original_workbook_sha256 = $originalHash
    stage_workbook_sha256 = ''
    stage_post_push_sha256 = ''
    original_preserved = $false
    error_category = ''
    push_failure_codes = @()
    push_failure_stages = @()
    push_failure_safe_excerpt = @()
    post_push_diff_index = -1
    post_push_diff_source_length = -1
    post_push_diff_target_length = -1
    post_push_diff_context = ''
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
        if ($PushInSandbox) {
            # This is deliberately NOT the distributed workbook or a client file.
            # Before any write, re-check that the target is the staged copy.
            if (-not $target.StartsWith($stage + [IO.Path]::DirectorySeparatorChar,
                                       [StringComparison]::OrdinalIgnoreCase)) {
                throw 'VBAUpdater target escaped the disposable staging directory'
            }
            Push-Location -LiteralPath $updater
            try {
                # Capture developer-tool diagnostics only inside the disposable
                # staging directory. Publish no raw output or local paths.
                $pushLog = Join-Path $stage 'push_runtime.log'
                $pushStartedUtc = [DateTime]::UtcNow
                & $cli project-push -ProjectRoot $stage *> $pushLog
                $pushCode = $LASTEXITCODE
                if ($pushCode -ne 0) {
                    $report.project_push = 'FAIL'
                    $rawText = [IO.File]::ReadAllText($pushLog)
                    # Only publish structured codes and sanitized diagnostic
                    # phrases. The raw failure log may contain private Windows
                    # paths and must remain inside disposable staging.
                    $report.push_failure_codes = @(
                        [regex]::Matches($rawText, '(?i)\[(?:ENC|VBA|WB)\d{4}\]|0x800[0-9A-F]{5}', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
                        ForEach-Object { $_.Value.ToUpperInvariant().TrimStart('[') } |
                        Select-Object -Unique
                    )
                    $stageTokens = @('Assert-ProjectVbaSourceEncodingSafe',
                        'Assert-VbaSourceEncodingSafe','Get-ProjectDiff',
                        'New-ProjectRestorePoint','Invoke-ManifestComponentPush',
                        'Invoke-PushStandard','VBComponents.Import',
                        'Invoke-ProjectCompileGate','Write-DifferentialPushJson',
                        'Restore-WorkbookFromVerifiedBackup',
                        'P01 START','P02 START')
                    $report.push_failure_stages = @($stageTokens | Where-Object { $rawText.Contains($_) })
                    $safe = @()
                    foreach ($line in @($rawText -split '\r?\n' | Where-Object {
                        $_ -match '(?i)\[(?:ENC|VBA|WB)\d{4}\]|exception|error|fail|round.trip|could not|access denied|unexpected|復元|失敗|差分' } | Select-Object -Last 6)) {
                        $sanitized = [regex]::Replace([string]$line, '(?i)(?:[A-Z]:[\\/]|\\\\)[^\\r\\n]*', '<LOCAL_PATH_REDACTED>')
                        $sanitized = [regex]::Replace($sanitized, '(?i)[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}', '<EMAIL_REDACTED>')
                        if ($sanitized.Length -gt 220) { $sanitized = $sanitized.Substring(0,220) }
                        $safe += $sanitized
                    }
                    $report.push_failure_safe_excerpt = @($safe)
                    # Collect only the public VBA semantic-diff excerpts.
                    # Never upload the raw CLI log or local Windows paths.
                    $logDir = Join-Path $updater 'logs'
                    if (Test-Path -LiteralPath $logDir -PathType Container) {
                        $recent = @(Get-ChildItem -LiteralPath $logDir -Filter 'project_diff_diagnostic_*.log' -File |
                            Where-Object { $_.LastWriteTimeUtc -ge $pushStartedUtc.AddSeconds(-2) } |
                            Sort-Object LastWriteTimeUtc -Descending)
                        foreach ($file in $recent) {
                            $diagLines = [IO.File]::ReadAllLines($file.FullName)
                            $firstDiff = @($diagLines | Where-Object { $_.Contains('D23 OK Status=changed') } | Select-Object -Last 1)
                            if ($firstDiff.Count -gt 0) {
                                $indexText = ([string]$firstDiff[0]).Split(@('FirstDifference='), [StringSplitOptions]::None)
                                if ($indexText.Count -gt 1) {
                                    $digits = ([string]$indexText[1]).Split(' ')[0].Trim()
                                    if ($digits -match '^[0-9]+$') { $report.post_push_diff_index = [int]$digits }
                                }
                                $contextLine = @($diagLines | Where-Object { $_.Contains('D23 DIFF LeftContext=') } | Select-Object -Last 1)
                                if ($contextLine.Count -gt 0) {
                                    $ctx = [string]$contextLine[0]
                                    $pos = $ctx.IndexOf('D23 DIFF LeftContext=')
                                    if ($pos -ge 0) {
                                        $ctx = $ctx.Substring($pos)
                                        $ctx = [regex]::Replace($ctx, '(?i)[A-Z]:[\\/][^ ;]+', '<REDACTED>')
                                        if ($ctx.Length -gt 180) { $ctx = $ctx.Substring(0,180) }
                                        $report.post_push_diff_context = $ctx
                                    }
                                }
                                break
                            }
                        }
                    }
                    Write-Host ('VBAUpdater post-push difference index: ' + $report.post_push_diff_index)
                    Write-Host ('VBAUpdater post-push difference context: ' + $report.post_push_diff_context)
                    Write-Host ('VBAUpdater staged push phases: ' + (($report.push_failure_stages) -join ','))
                    foreach ($diagnostic in $report.push_failure_safe_excerpt) {
                        Write-Host ('VBAUpdater staged push diagnostic: ' + $diagnostic)
                    }
                    $hints = New-Object System.Collections.Generic.List[string]
                    if ($rawText -match '(?i)compile|syntax') { $hints.Add('VBA_COMPILE') }
                    if ($rawText -match '(?i)trust|permission|access.denied|unauthorized') { $hints.Add('ACCESS_POLICY') }
                    if ($rawText -match '(?i)backup|restore') { $hints.Add('BACKUP_OR_RESTORE') }
                    if ($rawText -match '(?i)workbooks.open|excel.com|0x800a03ec') { $hints.Add('EXCEL_COM') }
                    if ($rawText -match '(?i)module|vbproject') { $hints.Add('MODULE_OR_VBPROJECT') }
                    if ($rawText -match '(?i)timeout|time.out') { $hints.Add('TIMEOUT') }
                    if ($hints.Count -eq 0) { $hints.Add('UNCLASSIFIED') }
                    $report.warning = ('VBAUpdater staging push failed: exit=' +
                                       $pushCode + ';category=' + ($hints -join ',') +
                                       '. No original workbook was changed.')
                    Write-Host ('VBAUpdater staged push exit code: ' + $pushCode +
                                ' / hint: ' + ($hints -join ','))
                    throw 'VBAUpdater project-push failed on disposable copy'
                }
                if (Test-Path -LiteralPath $pushLog) { Remove-Item -LiteralPath $pushLog -Force }
                $report.project_push = 'PASS'
                & $cli project-diff -ProjectRoot $stage *> $null
                if ($LASTEXITCODE -ne 0) {
                    $report.post_push_diff = 'FAIL'
                    throw 'VBAUpdater diff remains after staged project-push'
                }
                $report.post_push_diff = 'PASS'
            } finally {
                Pop-Location
            }
            $report.stage_post_push_sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
            # The existing independent QA tests tax amounts, update rollback,
            # macros, PDF, case save/reopen and data/formula preservation.
            $qaEvidence = Join-Path (Split-Path -Parent $EvidencePath) 'vbaupdater_excel_acceptance.json'
            & (Join-Path $root 'tools/verify_excel.ps1') -Workbook $target -EvidencePath $qaEvidence
            if (-not $?) { throw 'Updated sandbox XLSM failed independent Excel QA' }
            if (-not (Test-Path -LiteralPath $qaEvidence -PathType Leaf)) {
                throw 'Updated sandbox XLSM has no Excel acceptance evidence'
            }
            $qa = Get-Content -LiteralPath $qaEvidence -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($qa.status -ne 'PASS') { throw 'Updated sandbox XLSM Excel QA did not PASS' }
            if ($qa.workbook_sha256 -cne $report.stage_post_push_sha256) {
                throw 'Updated sandbox XLSM QA evidence hash mismatch'
            }
            $report.post_push_excel = 'PASS'
            $report.status = 'STAGED_PUSH_EXCEL_PASS'
            Write-Host 'VBAUpdater: isolated project-push, post-push diff, and independent Excel QA PASS.'
        }
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
)
                            $context = [regex]::Match($diagText, '(?m)^.*D23 DIFF LeftContext=(.*?) RightContext=(.*?)\\s*
                    Write-Host ('VBAUpdater staged push phases: ' + (($report.push_failure_stages) -join ','))
                    foreach ($diagnostic in $report.push_failure_safe_excerpt) {
                        Write-Host ('VBAUpdater staged push diagnostic: ' + $diagnostic)
                    }
                    $hints = New-Object System.Collections.Generic.List[string]
                    if ($rawText -match '(?i)compile|syntax') { $hints.Add('VBA_COMPILE') }
                    if ($rawText -match '(?i)trust|permission|access.denied|unauthorized') { $hints.Add('ACCESS_POLICY') }
                    if ($rawText -match '(?i)backup|restore') { $hints.Add('BACKUP_OR_RESTORE') }
                    if ($rawText -match '(?i)workbooks.open|excel.com|0x800a03ec') { $hints.Add('EXCEL_COM') }
                    if ($rawText -match '(?i)module|vbproject') { $hints.Add('MODULE_OR_VBPROJECT') }
                    if ($rawText -match '(?i)timeout|time.out') { $hints.Add('TIMEOUT') }
                    if ($hints.Count -eq 0) { $hints.Add('UNCLASSIFIED') }
                    $report.warning = ('VBAUpdater staging push failed: exit=' +
                                       $pushCode + ';category=' + ($hints -join ',') +
                                       '. No original workbook was changed.')
                    Write-Host ('VBAUpdater staged push exit code: ' + $pushCode +
                                ' / hint: ' + ($hints -join ','))
                    throw 'VBAUpdater project-push failed on disposable copy'
                }
                if (Test-Path -LiteralPath $pushLog) { Remove-Item -LiteralPath $pushLog -Force }
                $report.project_push = 'PASS'
                & $cli project-diff -ProjectRoot $stage *> $null
                if ($LASTEXITCODE -ne 0) {
                    $report.post_push_diff = 'FAIL'
                    throw 'VBAUpdater diff remains after staged project-push'
                }
                $report.post_push_diff = 'PASS'
            } finally {
                Pop-Location
            }
            $report.stage_post_push_sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
            # The existing independent QA tests tax amounts, update rollback,
            # macros, PDF, case save/reopen and data/formula preservation.
            $qaEvidence = Join-Path (Split-Path -Parent $EvidencePath) 'vbaupdater_excel_acceptance.json'
            & (Join-Path $root 'tools/verify_excel.ps1') -Workbook $target -EvidencePath $qaEvidence
            if (-not $?) { throw 'Updated sandbox XLSM failed independent Excel QA' }
            if (-not (Test-Path -LiteralPath $qaEvidence -PathType Leaf)) {
                throw 'Updated sandbox XLSM has no Excel acceptance evidence'
            }
            $qa = Get-Content -LiteralPath $qaEvidence -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($qa.status -ne 'PASS') { throw 'Updated sandbox XLSM Excel QA did not PASS' }
            if ($qa.workbook_sha256 -cne $report.stage_post_push_sha256) {
                throw 'Updated sandbox XLSM QA evidence hash mismatch'
            }
            $report.post_push_excel = 'PASS'
            $report.status = 'STAGED_PUSH_EXCEL_PASS'
            Write-Host 'VBAUpdater: isolated project-push, post-push diff, and independent Excel QA PASS.'
        }
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
)
                            if ($marker.Success) {
                                $report.post_push_diff_source_length = [int]$marker.Groups[1].Value
                                $report.post_push_diff_target_length = [int]$marker.Groups[2].Value
                                $report.post_push_diff_index = [int]$marker.Groups[3].Value
                                if ($context.Success) {
                                    $left = [string]$context.Groups[1].Value
                                    $right = [string]$context.Groups[2].Value
                                    $clip = 'source=' + $left + '; target=' + $right
                                    # Source/target contexts contain public VBA only;
                                    # strip any accidental local paths and email.
                                    $clip = [regex]::Replace($clip,'(?i)(?:[A-Z]:[\\/]|\\\\)[^; ]+','<PATH>')
                                    $clip = [regex]::Replace($clip,'(?i)[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}','<EMAIL>')
                                    if ($clip.Length -gt 240) { $clip = $clip.Substring(0,240) }
                                    $report.post_push_diff_context = $clip
                                }
                                break
                            }
                        }
                    }
                    Write-Host ('VBAUpdater post-push first diff: ' + $report.post_push_diff_index +
                        ' / source-length=' + $report.post_push_diff_source_length +
                        ' / target-length=' + $report.post_push_diff_target_length)
                    Write-Host ('VBAUpdater post-push diff context: ' + $report.post_push_diff_context)
                    Write-Host ('VBAUpdater staged push codes: ' + (($report.push_failure_codes) -join ','))
                    Write-Host ('VBAUpdater staged push phases: ' + (($report.push_failure_stages) -join ','))
                    foreach ($diagnostic in $report.push_failure_safe_excerpt) {
                        Write-Host ('VBAUpdater staged push diagnostic: ' + $diagnostic)
                    }
                    $hints = New-Object System.Collections.Generic.List[string]
                    if ($rawText -match '(?i)compile|syntax') { $hints.Add('VBA_COMPILE') }
                    if ($rawText -match '(?i)trust|permission|access.denied|unauthorized') { $hints.Add('ACCESS_POLICY') }
                    if ($rawText -match '(?i)backup|restore') { $hints.Add('BACKUP_OR_RESTORE') }
                    if ($rawText -match '(?i)workbooks.open|excel.com|0x800a03ec') { $hints.Add('EXCEL_COM') }
                    if ($rawText -match '(?i)module|vbproject') { $hints.Add('MODULE_OR_VBPROJECT') }
                    if ($rawText -match '(?i)timeout|time.out') { $hints.Add('TIMEOUT') }
                    if ($hints.Count -eq 0) { $hints.Add('UNCLASSIFIED') }
                    $report.warning = ('VBAUpdater staging push failed: exit=' +
                                       $pushCode + ';category=' + ($hints -join ',') +
                                       '. No original workbook was changed.')
                    Write-Host ('VBAUpdater staged push exit code: ' + $pushCode +
                                ' / hint: ' + ($hints -join ','))
                    throw 'VBAUpdater project-push failed on disposable copy'
                }
                if (Test-Path -LiteralPath $pushLog) { Remove-Item -LiteralPath $pushLog -Force }
                $report.project_push = 'PASS'
                & $cli project-diff -ProjectRoot $stage *> $null
                if ($LASTEXITCODE -ne 0) {
                    $report.post_push_diff = 'FAIL'
                    throw 'VBAUpdater diff remains after staged project-push'
                }
                $report.post_push_diff = 'PASS'
            } finally {
                Pop-Location
            }
            $report.stage_post_push_sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
            # The existing independent QA tests tax amounts, update rollback,
            # macros, PDF, case save/reopen and data/formula preservation.
            $qaEvidence = Join-Path (Split-Path -Parent $EvidencePath) 'vbaupdater_excel_acceptance.json'
            & (Join-Path $root 'tools/verify_excel.ps1') -Workbook $target -EvidencePath $qaEvidence
            if (-not $?) { throw 'Updated sandbox XLSM failed independent Excel QA' }
            if (-not (Test-Path -LiteralPath $qaEvidence -PathType Leaf)) {
                throw 'Updated sandbox XLSM has no Excel acceptance evidence'
            }
            $qa = Get-Content -LiteralPath $qaEvidence -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($qa.status -ne 'PASS') { throw 'Updated sandbox XLSM Excel QA did not PASS' }
            if ($qa.workbook_sha256 -cne $report.stage_post_push_sha256) {
                throw 'Updated sandbox XLSM QA evidence hash mismatch'
            }
            $report.post_push_excel = 'PASS'
            $report.status = 'STAGED_PUSH_EXCEL_PASS'
            Write-Host 'VBAUpdater: isolated project-push, post-push diff, and independent Excel QA PASS.'
        }
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
