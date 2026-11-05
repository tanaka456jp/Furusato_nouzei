#Requires -Version 5.1
# Run on a dedicated Windows Excel desktop with VBOM access configured for the build user.
param([Parameter(Mandatory=$true)][string]$Workbook)
$ErrorActionPreference = 'Stop'
$Workbook = (Resolve-Path -LiteralPath $Workbook).Path
$dir = Join-Path ([System.IO.Path]::GetTempPath()) ('FurusatoQA_' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($dir)
$copy = Join-Path $dir 'FurusatoQA.xlsm'
[IO.File]::Copy($Workbook, $copy)
$excel = $null; $book = $null; $home = $null; $settings = $null; $checks = $null; $detail = $null
function Assert-Value($actual, $expected, [string]$label) {
    if ($actual -cne $expected) { throw "$label expected [$expected], got [$actual]" }
}
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    # This process opens only the fresh, locally built test copy.
    $excel.AutomationSecurity = 1
    $book = $excel.Workbooks.Open($copy, 0, $false)
    $excel.AutomationSecurity = 3
    $home = $book.Worksheets.Item('操作画面')
    $settings = $book.Worksheets.Item('設定・税率')
    $checks = $book.Worksheets.Item('自動回帰テスト')
    $detail = $book.Worksheets.Item('計算根拠')
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $checks.Range('B47').Value2 52 'Regression cases'
    Assert-Value $checks.Range('B49').Value2 'PASS' 'Regression verdict'
    Assert-Value $home.Range('B8').Value2 '' 'Blank input hides limit'
    Assert-Value $detail.Visible 2 'Calculation details start hidden'
    foreach ($year in @(2025, 2026)) {
        $settings.Range('B4').Value2 = [double]$year
        $home.Range('B4').Value2 = [double]$year
        $home.Range('B11').Value2 = [double]$year
        $home.Range('B12').Value2 = 7000000.0
        $home.Range('B13').Value2 = 5200000.0
        $home.Range('B14').Value2 = [double]$(if ($year -eq 2025) { 1630000 } else { 1670000 })
        $home.Range('B15').Value2 = 285800.0
        $home.Range('B16').Value2 = 1000000.0
        $home.Range('B17:B18').Value2 = 0.0
        $home.Range('B25').Value2 = 'なし'
        $home.Range('B26').Value2 = '該当なし'
        $home.Range('D22').Value2 = '該当なし'
        $home.Range('D24').Value2 = '確定申告'
        $excel.Run('TaxLawUpdater.RecalculateCase')
        Assert-Value $home.Range('B28').Value2 '正常' "$year status"
        Assert-Value $home.Range('D8').Value2 374500 "$year resident income levy"
        Assert-Value $home.Range('B8').Value2 109000 "$year donation estimate"
    }
    # Exercise the actual GitHub-approved update transaction, not only recalculation.
    # The test runs on an isolated copy; no customer workbook is touched.
    Assert-Value ([bool]($excel.Run('TaxLawUpdater.TaxLawUpdateForTest'))) $true 'Online approved-year update'
    Assert-Value $settings.Range('B4').Value2 2026 'Approved year persisted in memory'
    Assert-Value $home.Range('B29').Value2 '2026-11-05-bundled' 'Revision after update'
    if (-not ([string]$home.Range('B30').Value2).StartsWith('適用済')) {
        throw 'Update status was not recorded'
    }
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $dir 'Furusato_backups') -Filter '*.xlsm' -File)
    if ($backups.Count -ne 1 -or $backups[0].Length -le 20000) {
        throw 'Approved-year update did not produce a usable backup'
    }

    # A non-approved year must be refused *without* modal dialogs or side effects.
    $oldStatus = [string]$home.Range('B30').Value2
    $home.Range('B4').Value2 = 2027.0
    $rejected = $false
    try {
        $null = $excel.Run('TaxLawUpdater.TaxLawUpdateForTest')
    } catch {
        $rejected = $true
    }
    if (-not $rejected) { throw 'Unapproved year was accepted' }
    Assert-Value $settings.Range('B4').Value2 2026 'Unapproved update preserved applied year'
    Assert-Value ([string]$home.Range('B30').Value2) $oldStatus 'Unapproved update preserved status'
    $excel.CalculateFullRebuild()
    Assert-Value $home.Range('B8').Value2 '' 'Selected and applied year mismatch'
    $home.Range('B4').Value2 = 2026.0
    $home.Range('B26').Value2 = '該当あり'
    $excel.CalculateFullRebuild()
    Assert-Value $home.Range('B8').Value2 '' 'Unsupported case'
    $home.Range('B26').Value2 = '該当なし'
    $home.Range('D17:D18').Value2 = 0.0
    $excel.CalculateFullRebuild()
    Assert-Value $home.Range('B8').Value2 '' 'Duplicate spouse'
    $home.Range('D17:D18').ClearContents()
    $excel.CalculateFullRebuild()
    $excel.Run('TaxLawUpdater.ShowDetails')
    Assert-Value $detail.Visible -1 'Details opened by VBA'
    $pdf = Join-Path $dir 'FurusatoQA.pdf'
    $detail.ExportAsFixedFormat(0, $pdf)
    if ((Get-Item -LiteralPath $pdf).Length -eq 0) { throw 'Empty PDF' }
    $excel.Run('TaxLawUpdater.ReturnHome')
    Assert-Value $detail.Visible 2 'Details hidden after return'
    # Reopen the QA copy after a successful case save.
    $home.Range('B26').Value2 = '該当なし'
    $home.Range('B4').Value2 = 2026.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $home.Range('B8').Value2 109000 'Amount before reopen'
    $book.Save()

    # Inject a failed update *after* the applied year changes (test copy only).
    # This proves that rollback is persisted, not merely restored in memory.
    $originalRegressionFormula = [string]$checks.Range('B49').Formula
    $oldUpdateStatus = [string]$home.Range('B30').Value2
    $checks.Range('B49').Formula = '="FAIL"'
    $home.Range('B4').Value2 = 2025.0
    $failedAfterMutation = $false
    try {
        $null = $excel.Run('TaxLawUpdater.TaxLawUpdateForTest')
    } catch {
        $failedAfterMutation = $true
    }
    if (-not $failedAfterMutation) { throw 'Corrupted regression did not abort the transaction' }
    Assert-Value $settings.Range('B4').Value2 2026 'Rollback applied year'
    Assert-Value ([string]$home.Range('B30').Value2) $oldUpdateStatus 'Rollback update status'
    $book.Close($false)
    $book = $null

    # Restore input to approved 2026 and the damaged fixture only AFTER
    # verifying the transaction rollback survived closing without Save.
    $excel.AutomationSecurity = 1
    $book = $excel.Workbooks.Open($copy, 0, $false)
    $excel.AutomationSecurity = 3
    $home = $book.Worksheets.Item('操作画面')
    $settings = $book.Worksheets.Item('設定・税率')
    $checks = $book.Worksheets.Item('自動回帰テスト')
    $detail = $book.Worksheets.Item('計算根拠')
    Assert-Value $settings.Range('B4').Value2 2026 'Rollback persisted across reopen'
    Assert-Value ([string]$home.Range('B30').Value2) $oldUpdateStatus 'Rollback status persisted across reopen'
    $checks.Range('B49').Formula = $originalRegressionFormula
    $home.Range('B4').Value2 = 2026.0
    $excel.CalculateFullRebuild()
    Assert-Value $checks.Range('B49').Value2 'PASS' 'Regression restored after injected fault'
    Assert-Value $home.Range('B12').Value2 7000000 'Salary retained after reopen'
    Assert-Value $home.Range('B8').Value2 109000 'Estimate retained after reopen'
    Assert-Value $detail.Visible 2 'Calculation details remain hidden after reopen'
    $book.Save()
    if ($home.Buttons().Item('btnTaxLawUpdate').OnAction -notmatch 'TaxLawUpdater.TaxLawUpdate') {
        throw 'Tax update button is not wired to its macro'
    }
    if (-not $detail.PageSetup.PrintArea) { throw 'Calculation details lack print area' }
    Write-Output 'PASS: Windows Excel 52 fixtures; 2025/2026 amounts; approved/rejected updates; persisted fault rollback; backup; PDF; save/reopen; button wiring.'
} finally {
    if ($null -ne $book) { $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit() }
    foreach ($obj in @($detail,$checks,$settings,$home,$book,$excel)) {
        if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
        }
    }
    Remove-Item -LiteralPath $dir -Recurse -Force
}
