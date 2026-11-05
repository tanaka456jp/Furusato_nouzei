#Requires -Version 5.1
# Run on a dedicated Windows Excel desktop with VBOM access configured for the build user.
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [string]$EvidencePath = ''
)
$ErrorActionPreference = 'Stop'
$Workbook = (Resolve-Path -LiteralPath $Workbook).Path
$dir = Join-Path ([System.IO.Path]::GetTempPath()) ('FurusatoQA_' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($dir)
$copy = Join-Path $dir 'FurusatoQA.xlsm'
[IO.File]::Copy($Workbook, $copy)
$excel = $null; $book = $null; $savedCase = $null; $homeSheet = $null; $settings = $null; $checks = $null; $detail = $null
$passed = $false
$failureSummary = ''
$excelVersion = ''
$sourceSha256 = (Get-FileHash -LiteralPath $Workbook -Algorithm SHA256).Hash
$startedUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
function Assert-Value($actual, $expected, [string]$label) {
    if ($actual -cne $expected) { throw "$label expected [$expected], got [$actual]" }
}
function Assert-PrintConfiguration($sheet, [string]$label, [string]$rangePattern) {
    $page = $sheet.PageSetup
    $area = [string]$page.PrintArea
    if ($area -notmatch $rangePattern) {
        throw "$label print area is unexpected"
    }
    Assert-Value ([int]$page.PaperSize) 9 "$label A4 paper"
    Assert-Value ([int]$page.Orientation) 1 "$label portrait orientation"
    Assert-Value ([int]$page.FitToPagesWide) 1 "$label fit to one page wide"
    Assert-Value ([int]$page.FitToPagesTall) 1 "$label fit to one page tall"
    Assert-Value ([bool]$page.CenterHorizontally) $true "$label print centered"
}
function Assert-MacroAction([string]$actual, [string]$expected, [string]$label) {
    # Excel may normalize OnAction by removing quotes around an ASCII
    # workbook name. Ownership is validated after lexical normalization.
    $normalized = $actual
    if ($actual -match "^'([^']+)'!(.+)$") {
        $normalized = $Matches[1] + '!' + $Matches[2]
    }
    Assert-Value $normalized $expected $label
}
$script:qaStage = 'initializing'
function QA-Stage([string]$stage) {
    $script:qaStage = $stage
    Write-Host ('QA_STAGE ' + [DateTime]::UtcNow.ToString('HH:mm:ss') + ' ' + $stage)
}
QA-Stage 'start'
try {
    QA-Stage 'excel-com-create'
    $excel = New-Object -ComObject Excel.Application
    $excelVersion = [string]$excel.Version
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    # This process opens only the fresh, locally built test copy.
    $excel.AutomationSecurity = 1
    QA-Stage 'qa-workbook-open-start'
    $book = $excel.Workbooks.Open($copy, 0, $false)
    QA-Stage 'qa-workbook-open-done'
    $excel.AutomationSecurity = 3
    $homeSheet = $book.Worksheets.Item('操作画面')
    $settings = $book.Worksheets.Item('設定・税率')
    $checks = $book.Worksheets.Item('自動回帰テスト')
    $detail = $book.Worksheets.Item('計算根拠')
    QA-Stage 'worksheet-handles-acquired'
    # This is a renamed test COPY, so bind its buttons to the test workbook.
    $excel.Run('TaxLawUpdater.BindButtons')
    Assert-MacroAction ([string]$homeSheet.Buttons().Item('btnTaxLawUpdate').OnAction) 'FurusatoQA.xlsm!TaxLawUpdater.TaxLawUpdate' 'Main case macro ownership'
    QA-Stage 'initial-recalculate-start'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'initial-recalculate-done'
    Assert-Value $checks.Range('B47').Value2 52 'Regression cases'
    Assert-Value $checks.Range('B49').Value2 'PASS' 'Regression verdict'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Blank input hides limit'
    Assert-Value $detail.Visible 2 'Calculation details start hidden'
    QA-Stage 'initial-regressions-pass'
    QA-Stage 'print-setup-validation-start'
    Assert-PrintConfiguration $homeSheet 'Home' '\$A\$1:\$D\$31'
    Assert-PrintConfiguration $detail 'Detail' '\$A\$1:\$D\$15'
    QA-Stage 'print-setup-validation-done'
    foreach ($year in @(2025, 2026)) {
        QA-Stage ('synthetic-' + $year + '-input-start')
        $settings.Range('B4').Value2 = [double]$year
        $homeSheet.Range('B4').Value2 = [double]$year
        $homeSheet.Range('B11').Value2 = [double]$year
        $homeSheet.Range('B12').Value2 = 7000000.0
        $homeSheet.Range('B13').Value2 = 5200000.0
        $homeSheet.Range('B14').Value2 = [double]$(if ($year -eq 2025) { 1630000 } else { 1670000 })
        $homeSheet.Range('B15').Value2 = 285800.0
        $homeSheet.Range('B16').Value2 = 1000000.0
        $homeSheet.Range('B17:B18').Value2 = 0.0
        $homeSheet.Range('B25').Value2 = 'なし'
        $homeSheet.Range('B26').Value2 = '該当なし'
        $homeSheet.Range('D22').Value2 = '該当なし'
        $homeSheet.Range('D24').Value2 = '確定申告'
        QA-Stage ('synthetic-' + $year + '-recalculate-start')
        $excel.Run('TaxLawUpdater.RecalculateCase')
        QA-Stage ('synthetic-' + $year + '-recalculate-done')
        # If the synthetic fixture is inconsistent, log only deterministic
        # synthetic values. Never bypass the taxpayer input consistency gate.
        if ([string]$homeSheet.Range('B28').Value2 -ne '正常') {
            $engineSheet = $book.Worksheets.Item('ふるさと納税限度額計算')
            $familySheet = $book.Worksheets.Item('追加人的控除')
            $fields = @('B12','B13','B14','B15','B16','B17','B18',
                        'B19','B20','B21','B22','B23','B24','B25','B26',
                        'D11','D12','D13','D14','D15','D16','D17','D18',
                        'D19','D20','D21','D22','D23','D24','D25')
            $pairs = @($fields | ForEach-Object {
                $_ + '=' + [string]$homeSheet.Range($_).Value2
            })
            $reference = @('F15','F24','F25','F38','D15') | ForEach-Object {
                $_ + '=' + [string]$engineSheet.Range($_).Value2
            }
            Write-Output ('SYNTHETIC_ONLY_INPUT_DIAGNOSTIC year=' + $year +
                ' fields=' + ($pairs -join ';') +
                ' engine=' + ($reference -join ';') +
                ' family_C12=' + [string]$familySheet.Range('C12').Value2 +
                ' status=' + [string]$homeSheet.Range('B28').Value2)
        }
        Assert-Value $homeSheet.Range('B28').Value2 '正常' "$year status"
        Assert-Value $homeSheet.Range('D8').Value2 374500 "$year resident income levy"
        Assert-Value $homeSheet.Range('B8').Value2 109000 "$year donation estimate"
    }
    QA-Stage 'synthetic-years-pass'
    # Exercise the actual GitHub-approved update transaction, not only recalculation.
    # The test runs on an isolated copy; no customer workbook is touched.
    QA-Stage 'approved-update-start'
    Assert-Value ([bool]($excel.Run('TaxLawUpdater.TaxLawUpdateForTest'))) $true 'Online approved-year update'
    QA-Stage 'approved-update-done'
    Assert-Value $settings.Range('B4').Value2 2026 'Approved year persisted in memory'
    Assert-Value $homeSheet.Range('B29').Value2 '2026-11-05-bundled' 'Revision after update'
    if (-not ([string]$homeSheet.Range('B30').Value2).StartsWith('適用済')) {
        throw 'Update status was not recorded'
    }
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $dir 'Furusato_backups') -Filter '*.xlsm' -File)
    if ($backups.Count -ne 1 -or $backups[0].Length -le 20000) {
        throw 'Approved-year update did not produce a usable backup'
    }

    # A non-approved year must be refused *without* modal dialogs or side effects.
    QA-Stage 'approved-update-backup-check-done'
    $oldStatus = [string]$homeSheet.Range('B30').Value2
    $homeSheet.Range('B4').Value2 = 2027.0
    QA-Stage 'unsupported-year-update-start'
    $rejected = -not [bool]($excel.Run('TaxLawUpdater.TaxLawUpdateForTest'))
    QA-Stage 'unsupported-year-update-done'
    if (-not $rejected) { throw 'Unapproved year was accepted' }
    $reason = [string]($excel.Run('TaxLawUpdater.TaxLawUpdateLastFailure'))
    if (-not $reason.Contains('承認対象年')) {
        throw 'Unapproved year returned no expected refusal reason'
    }
    Assert-Value $settings.Range('B4').Value2 2026 'Unapproved update preserved applied year'
    Assert-Value ([string]$homeSheet.Range('B30').Value2) $oldStatus 'Unapproved update preserved status'
    QA-Stage ('full-rebuild-start-after-' + $script:qaStage)
    $excel.CalculateFullRebuild()
    QA-Stage 'full-rebuild-done'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Selected and applied year mismatch'
    $homeSheet.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B26').Value2 = '該当あり'
    QA-Stage ('full-rebuild-start-after-' + $script:qaStage)
    $excel.CalculateFullRebuild()
    QA-Stage 'full-rebuild-done'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Unsupported case'
    $homeSheet.Range('B26').Value2 = '該当なし'
    $homeSheet.Range('D17:D18').Value2 = 0.0
    QA-Stage ('full-rebuild-start-after-' + $script:qaStage)
    $excel.CalculateFullRebuild()
    QA-Stage 'full-rebuild-done'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Duplicate spouse'
    $homeSheet.Range('D17:D18').ClearContents()
    QA-Stage ('full-rebuild-start-after-' + $script:qaStage)
    $excel.CalculateFullRebuild()
    QA-Stage 'full-rebuild-done'
    QA-Stage 'show-details-start'
    $excel.Run('TaxLawUpdater.ShowDetails')
    QA-Stage 'show-details-done'
    Assert-Value $detail.Visible -1 'Details opened by VBA'
    $pdf = Join-Path $dir 'FurusatoQA.pdf'
    QA-Stage 'pdf-export-first-start'
    Assert-Value ([bool]($excel.Run('TaxLawUpdater.ExportDetailsToFile', $pdf))) $true 'VBA PDF export'
    QA-Stage 'pdf-export-first-done'
    if ((Get-Item -LiteralPath $pdf).Length -lt 500) { throw 'Empty or corrupt PDF' }
    $pdfSignature = -join ((Get-Content -LiteralPath $pdf -Encoding Byte -TotalCount 5) | ForEach-Object { [char]$_ })
    Assert-Value $pdfSignature '%PDF-' 'PDF header'
    Assert-Value $detail.Visible -1 'User remains on detail screen after PDF export'
    $originalPdfHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pdf).Hash
    QA-Stage 'pdf-overwrite-rejection-start'
    $mustRejectPdfOverwrite = -not [bool](
        $excel.Run('TaxLawUpdater.TryExportDetailsToFileForTest', $pdf)
    )
    QA-Stage 'pdf-overwrite-rejection-done'
    if (-not $mustRejectPdfOverwrite) { throw 'Existing PDF was overwritten' }
    Assert-Value ((Get-FileHash -Algorithm SHA256 -LiteralPath $pdf).Hash) $originalPdfHash 'PDF not modified on refusal'
    $excel.Run('TaxLawUpdater.ReturnHome')
    Assert-Value $detail.Visible 2 'Details hidden after return'
    $hiddenPdf = Join-Path $dir 'FurusatoQA_hidden.pdf'
    QA-Stage 'pdf-export-hidden-start'
    Assert-Value ([bool]($excel.Run('TaxLawUpdater.ExportDetailsToFile', $hiddenPdf))) $true 'PDF export from home screen'
    QA-Stage 'pdf-export-hidden-done'
    Assert-Value $detail.Visible 2 'Details returned to hidden after home-screen PDF export'
    if (@(Get-ChildItem -LiteralPath $dir -Filter '_furusato_pdf_*.pdf' -File).Count -ne 0) {
        throw 'Temporary PDF remained after success or rejected overwrite'
    }

    # Save a separate case file, verify its content, and reject accidental overwrite.
    $casePath = Join-Path $dir 'case_preservation.xlsm'
    QA-Stage 'case-save-start'
    Assert-Value ([bool]($excel.Run('TaxLawUpdater.SaveCaseToFile', $casePath))) $true 'Case save command'
    QA-Stage 'case-save-done'
    if (-not (Test-Path -LiteralPath $casePath)) { throw 'Case save did not create file' }
    if ((Get-Item -LiteralPath $casePath).Length -lt 20000) { throw 'Case save produced a suspiciously small file' }
    $originalCaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $casePath).Hash
    if (@(Get-ChildItem -LiteralPath $dir -Filter '_furusato_case_*.xlsm' -File).Count -ne 0) {
        throw 'Temporary case file remained after successful save'
    }
    QA-Stage 'case-overwrite-rejection-start'
    $mustRejectOverwrite = -not [bool](
        $excel.Run('TaxLawUpdater.TrySaveCaseToFileForTest', $casePath)
    )
    QA-Stage 'case-overwrite-rejection-done'
    if (-not $mustRejectOverwrite) { throw 'Existing case file was overwritten' }
    Assert-Value ((Get-FileHash -Algorithm SHA256 -LiteralPath $casePath).Hash) $originalCaseHash 'Case not modified after overwrite refusal'
    if (@(Get-ChildItem -LiteralPath $dir -Filter '_furusato_case_*.xlsm' -File).Count -ne 0) {
        throw 'Temporary case file remained after failed save'
    }
    $excel.AutomationSecurity = 1
    $excel.EnableEvents = $true
    try {
        QA-Stage 'case-reopen-start'
        $savedCase = $excel.Workbooks.Open($casePath, 0, $true)
        QA-Stage 'case-reopen-done'
    } finally {
        $excel.EnableEvents = $false
        $excel.AutomationSecurity = 3
    }
    try {
        Assert-Value $savedCase.Worksheets.Item('操作画面').Range('B12').Value2 7000000 'Separate case preserves salary'
        Assert-Value $savedCase.Worksheets.Item('操作画面').Range('B8').Value2 109000 'Separate case preserves result'
        Assert-MacroAction ([string]$savedCase.Worksheets.Item('操作画面').Buttons().Item('btnTaxLawUpdate').OnAction) 'case_preservation.xlsm!TaxLawUpdater.TaxLawUpdate' 'Copied case macro ownership'
        Assert-MacroAction ([string]$savedCase.Worksheets.Item('計算根拠').Buttons().Item('btnExportDetails').OnAction) 'case_preservation.xlsm!TaxLawUpdater.ExportDetails' 'Copied case PDF macro ownership'
    } finally {
        $savedCase.Close($false)
    }

    # Reopen the QA copy after a successful case save.
    $homeSheet.Range('B26').Value2 = '該当なし'
    $homeSheet.Range('B4').Value2 = 2026.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B8').Value2 109000 'Amount before reopen'
    $book.Save()

    # Inject a failed update *after* the applied year changes (test copy only).
    # This proves that rollback is persisted, not merely restored in memory.
    $originalRegressionFormula = [string]$checks.Range('B49').Formula
    $oldUpdateStatus = [string]$homeSheet.Range('B30').Value2
    QA-Stage 'rollback-injection-start'
    $checks.Range('B49').Formula = '="FAIL"'
    $homeSheet.Range('B4').Value2 = 2025.0
    $failedAfterMutation = -not [bool](
        $excel.Run('TaxLawUpdater.TaxLawUpdateForTest')
    )
    QA-Stage 'rollback-injection-done'
    if (-not $failedAfterMutation) { throw 'Corrupted regression did not abort the transaction' }
    $reason = [string]($excel.Run('TaxLawUpdater.TaxLawUpdateLastFailure'))
    if (-not $reason.Contains('内蔵回帰試験')) {
        throw 'Regression injection returned no expected refusal reason'
    }
    Assert-Value $settings.Range('B4').Value2 2026 'Rollback applied year'
    Assert-Value $homeSheet.Range('B4').Value2 2026 'Rollback selected year'
    Assert-Value ([string]$homeSheet.Range('B30').Value2) $oldUpdateStatus 'Rollback update status'
    $book.Close($false)
    $book = $null

    # Restore input to approved 2026 and the damaged fixture only AFTER
    # verifying the transaction rollback survived closing without Save.
    $excel.AutomationSecurity = 1
    $book = $excel.Workbooks.Open($copy, 0, $false)
    $excel.AutomationSecurity = 3
    $homeSheet = $book.Worksheets.Item('操作画面')
    $settings = $book.Worksheets.Item('設定・税率')
    $checks = $book.Worksheets.Item('自動回帰テスト')
    $detail = $book.Worksheets.Item('計算根拠')
    QA-Stage 'rollback-reopen-done'
    Assert-Value $settings.Range('B4').Value2 2026 'Rollback persisted across reopen'
    Assert-Value $homeSheet.Range('B4').Value2 2026 'Selected year rollback persisted across reopen'
    Assert-Value ([string]$homeSheet.Range('B30').Value2) $oldUpdateStatus 'Rollback status persisted across reopen'
    $checks.Range('B49').Formula = $originalRegressionFormula
    $homeSheet.Range('B4').Value2 = 2026.0
    QA-Stage ('full-rebuild-start-after-' + $script:qaStage)
    $excel.CalculateFullRebuild()
    QA-Stage 'full-rebuild-done'
    Assert-Value $checks.Range('B49').Value2 'PASS' 'Regression restored after injected fault'
    Assert-Value $homeSheet.Range('B12').Value2 7000000 'Salary retained after reopen'
    Assert-Value $homeSheet.Range('B8').Value2 109000 'Estimate retained after reopen'
    Assert-Value $detail.Visible 2 'Calculation details remain hidden after reopen'
    $book.Save()
    $excel.Run('TaxLawUpdater.BindButtons')
    Assert-MacroAction ([string]$homeSheet.Buttons().Item('btnTaxLawUpdate').OnAction) 'FurusatoQA.xlsm!TaxLawUpdater.TaxLawUpdate' 'Reloaded case macro ownership'
    if (-not $detail.PageSetup.PrintArea) { throw 'Calculation details lack print area' }
    QA-Stage 'all-acceptance-checks-pass'
    $passed = $true
    Write-Output 'PASS: Windows Excel 52 fixtures; 2025/2026 amounts; approved/rejected updates; persisted fault rollback; backup; VBA PDF/hidden UI/no-overwrite; isolated no-overwrite case-save; save/reopen; button wiring.'
} catch {
    $failureSummary = $_.Exception.Message
    Write-Host ('QA_FAIL_AT_STAGE ' + $script:qaStage + ': ' + $failureSummary)
    throw
} finally {
    # Cleanup is best-effort and must not mask the original test failure.
    # Only the Excel instance created above is quit; other user sessions remain untouched.
    if ($null -ne $savedCase) { try { $savedCase.Close($false) } catch {} }
    if ($null -ne $book) { try { $book.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($savedCase,$detail,$checks,$settings,$homeSheet,$book,$excel)) {
        try {
            if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    try { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop }
    catch { Write-Warning ('QA temporary folder cleanup failed: ' + $_.Exception.Message) }
    # Only synthetic test identifiers are recorded. Do not log machine names,
    # local user names, case contents, registration tokens or environment secrets.
    if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) {
        try {
            $result = if ($passed) { 'PASS' } else { 'FAIL' }
            $report = [ordered]@{
                schema = 'furusato-excel-acceptance/v1'
                status = $result
                started_utc = $startedUtc
                finished_utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
                workbook_sha256 = $sourceSha256
                excel_version = $excelVersion
                executed_checks = @(
                    '52 Excel regression fixtures', '2025 and 2026 synthetic salary reference',
                    'approved-year update and backup', 'unapproved 2027 rejection',
                    'persisted failed-update rollback', 'VBA PDF export and no-overwrite',
                    'case save and reopen', 'workbook-specific macro buttons',
                    'A4 one-page print configuration, without actual printer output'
                )
                not_covered = @(
                    'anonymous real withholding or residence tax documents',
                    'physical printing', 'three desktop display conditions',
                    'product signature and production deployment'
                )
                failure = $failureSummary
                last_stage = $script:qaStage
            }
            $json = $report | ConvertTo-Json -Depth 4
            $encoding = New-Object System.Text.UTF8Encoding($false)
            [IO.File]::WriteAllText($EvidencePath, $json, $encoding)
        } catch {
            Write-Warning ('Could not write isolated Excel acceptance evidence: ' + $_.Exception.Message)
        }
    }
}
