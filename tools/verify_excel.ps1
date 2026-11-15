#Requires -Version 5.1
# Run on a dedicated Windows Excel desktop with VBOM access configured for the build user.
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [string]$EvidencePath = '',
    [string]$PdfEvidencePath = ''
)
$ErrorActionPreference = 'Stop'
$Workbook = (Resolve-Path -LiteralPath $Workbook).Path
$dir = Join-Path ([System.IO.Path]::GetTempPath()) ('FurusatoQA_' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($dir)
$copy = Join-Path $dir 'FurusatoQA.xlsm'
[IO.File]::Copy($Workbook, $copy)
$excel = $null; $book = $null; $savedCase = $null; $homeSheet = $null; $settings = $null; $checks = $null; $detail = $null
$passed = $false
$splitCases = @()
$failureSummary = ''
$lastVbaUpdateStage = ''
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
    $splitLink = $homeSheet.Range('A2')
    Assert-Value $splitLink.Hyperlinks.Count 1 'Split settings link available at A2'
    Assert-Value ([string]$splitLink.Hyperlinks.Item(1).SubAddress) "'操作画面'!A42" 'Split settings link target'
    $linkBottom = [double]$splitLink.Top + [double]$splitLink.Height
    $controls = $homeSheet.Buttons()
    for ($i=1; $i -le $controls.Count; $i++) {
        $control = $controls.Item($i)
        if ([double]$control.Top -lt $linkBottom -and ([double]$control.Top + [double]$control.Height) -gt [double]$splitLink.Top) {
            throw 'Installed form control obscures the split settings link'
        }
    }
    QA-Stage 'split-settings-link-unobstructed'
    QA-Stage 'initial-recalculate-start'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'initial-recalculate-done'
    Assert-Value $checks.Range('B47').Value2 52 'Regression cases'
    Assert-Value $checks.Range('B49').Value2 'PASS' 'Regression verdict'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Blank input hides limit'
    Assert-Value $detail.Visible 2 'Calculation details start hidden'
    QA-Stage 'initial-regressions-pass'
    # Synthetic live Excel COM regression: the source total is audit-only;
    # the user-typed override persists across unrelated source edits; clearing
    # the override restores computed deductions. No customer data is used.
    QA-Stage 'deduction-override-synthetic-start'
    $homeSheet.Range('B12').Value2 = 7000000.0
    $homeSheet.Range('B15').Value2 = 285800.0
    $homeSheet.Range('B16').Value2 = 1000000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B31').Value2 1670000 'Computed deduction total baseline'
    Assert-Value $homeSheet.Range('B14').Value2 1670000 'Effective deduction without override'
    Assert-Value ([string]$homeSheet.Range('D26').Value2) '自動再計算' 'Automatic deduction mode'
    $homeSheet.Range('D25').Value2 = 1800000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B14').Value2 1800000 'Manual override amount used'
    if ([string]$homeSheet.Range('D26').Value2 -notlike '*上書き中*') {
        throw 'Manual override warning was not displayed'
    }
    $homeSheet.Range('B16').Value2 = 1050000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B31').Value2 1720000 'Automatic amount follows insurance edit'
    Assert-Value $homeSheet.Range('B14').Value2 1800000 'Override must not silently follow edit'
    $homeSheet.Range('D25').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B14').Value2 1720000 'Removing override restores automatic amount'
    Assert-Value ([string]$homeSheet.Range('D26').Value2) '自動再計算' 'Mode restored after clearing override'
    $sourceAudit = $book.Worksheets.Item('例外・分離課税')
    $sourceAudit.Range('B14').Value2 = 1950000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B14').Value2 1720000 'Source document total must not override calculation'
    Assert-Value $homeSheet.Range('D31').Value2 1950000 'Source total retained separately'
    if ([string]$homeSheet.Range('B28').Value2 -notlike '*原票の所得控除合計*') {
        throw 'Unreviewed source/automatic total mismatch did not HOLD'
    }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Unreviewed source discrepancy hides limit'
    # Model the state stored by ReviewWithholding after an EXPLICIT
    # confirmation. A later input edit MUST revoke that exact attestation,
    # even if the review status itself remains VERIFIED_AFTER_CORRECTION.
    $fingerprint = [string]$sourceAudit.Range('B42').Value2
    if ($fingerprint -notmatch '^[0-9]+:' -or $fingerprint.Split('|').Count -lt 165) {
        throw 'Source review snapshot missing length-prefixed fields'
    }
    $sourceAudit.Range('B41').Value2 = $fingerprint
    $sourceAudit.Range('B20').Value2 = 'VERIFIED_AFTER_CORRECTION'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Exact confirmed input snapshot is accepted'
    $homeSheet.Range('B16').Value2 = 1060000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Changing social insurance kept an old PDF confirmation alive'
    }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Edited input revokes confirmed donation limit'
    $homeSheet.Range('B16').Value2 = 1050000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Restoring the exact reviewed input restores consistency'
    $homeSheet.Range('D25').Value2 = 1800000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Manual deduction override reused a prior confirmation'
    }
    $homeSheet.Range('D25').ClearContents()
    $sourceAudit.Range('B14').Value2 = 1940000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Editing the source deduction total reused a prior confirmation'
    }
    $sourceAudit.Range('B20:B20').ClearContents()
    $sourceAudit.Range('B41').ClearContents()
    $sourceAudit.Range('B14').ClearContents()
    $homeSheet.Range('B12').ClearContents()
    $homeSheet.Range('B15').ClearContents()
    $homeSheet.Range('B16').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'deduction-override-synthetic-pass'
    # Independently reconciled, five differently-earning 19-22-year-olds.
    # First three reuse the old user-entry cells and all five share the
    # same explicit eligibility controls.  National and resident tax
    # deductions must not be double-counted when people 4+ are added.
    QA-Stage 'multi-relative-independent-com-start'
    $engineSheet = $book.Worksheets.Item('ふるさと納税限度額計算')
    $relativeSheet = $book.Worksheets.Item('特定親族明細')
    Assert-Value $relativeSheet.Visible -1 '30-person relative detail visible'
    $settings.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B11').Value2 = 2026.0
    $homeSheet.Range('B12').Value2 = 7000000.0
    $homeSheet.Range('B15').Value2 = 285800.0
    $homeSheet.Range('B16').Value2 = 1000000.0
    $homeSheet.Range('B25').Value2 = 'あり'
    $homeSheet.Range('D22').Value2 = '該当なし'
    # Use the one-stop mode for this plain salary-only family fixture.
    # Return-mode cases already carry a separate marginal-tax safety HOLD.
    $homeSheet.Range('D24').Value2 = 'ワンストップ'
    foreach ($p in @(
        @{ Row=4; Income=500000; Age=20; Tax=630000; Levy=450000; Category='特定扶養親族' },
        @{ Row=5; Income=900000; Age=21; Tax=610000; Levy=450000; Category='特定親族特別控除' },
        @{ Row=6; Income=1030000; Age=22; Tax=310000; Levy=310000; Category='特定親族特別控除' },
        @{ Row=7; Income=950001; Age=19; Tax=410000; Levy=410000; Category='特定親族特別控除' },
        @{ Row=8; Income=1230000; Age=20; Tax=30000; Levy=30000; Category='特定親族特別控除' }
    )) {
        $row = [int]$p.Row
        $relativeSheet.Cells.Item($row,2).Value2 = [double]$p.Age
        if ($row -le 6) {
            $homeSheet.Range(('D' + ($row + 10))).Value2 = [double]$p.Income
        } else {
            $relativeSheet.Cells.Item($row,3).Value2 = [double]$p.Income
        }
        $relativeSheet.Cells.Item($row,4).Value2 = '要件確認済'
    }
    $excel.Run('TaxLawUpdater.RecalculateCase')
    foreach ($p in @(
        @{ Row=4; Tax=630000; Levy=450000; Category='特定扶養親族' },
        @{ Row=5; Tax=610000; Levy=450000; Category='特定親族特別控除' },
        @{ Row=6; Tax=310000; Levy=310000; Category='特定親族特別控除' },
        @{ Row=7; Tax=410000; Levy=410000; Category='特定親族特別控除' },
        @{ Row=8; Tax=30000; Levy=30000; Category='特定親族特別控除' }
    )) {
        $row=[int]$p.Row
        Assert-Value $relativeSheet.Cells.Item($row,5).Value2 $p.Tax ('Income-tax relative ' + $row)
        Assert-Value $relativeSheet.Cells.Item($row,6).Value2 $p.Levy ('Resident-tax relative ' + $row)
        Assert-Value ([string]$relativeSheet.Cells.Item($row,7).Value2) $p.Category ('Income-year classification ' + $row)
    }
    Assert-Value $relativeSheet.Range('E35').Value2 1990000 'Five-person income-tax deduction total'
    Assert-Value $relativeSheet.Range('F35').Value2 1650000 'Five-person resident-tax deduction total'
    Assert-Value $engineSheet.Range('F38').Value2 1990000 'Engine includes each relative exactly once'
    Assert-Value $engineSheet.Range('H38').Value2 1650000 'Engine resident deductions do not repeat'
    Assert-Value $homeSheet.Range('B31').Value2 3660000 'Five-person overall income-tax deductions'
    Assert-Value $homeSheet.Range('B14').Value2 3660000 'Five-person applied deduction total'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'All relatives individually reviewed'
    # A G72/G74 source count describes the four SPECIAL relatives only,
    # not the separate 500,000-yen regular special dependent.
    Assert-Value $relativeSheet.Range('E36').Value2 4 'Four special-relatives rather than five relatives total'
    Assert-Value $relativeSheet.Range('E37').Value2 1360000 'Four-special-relative G74 income-tax total'
    $sourceAudit.Range('B38').Value2 = 4.0
    $sourceAudit.Range('B39').Value2 = 1360000.0
    # Exercise the *real VBA* source reconciler rather than copying the
    # verified label/stamp without checking that G72/G74 are coherent.
    Assert-Value ([string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))) 'OK' 'Four-person G72/G74 reconciliation'
    # An EXPLICIT G72=0 means there are no special-relative deductions.
    # It must not be treated like a blank source field; otherwise source
    # verification could silently accept newly entered special relatives.
    $sourceAudit.Range('B38').Value2 = 0.0
    $sourceAudit.Range('B39').Value2 = 0.0
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*人数分*') { throw 'Explicit G72=0 failed to detect four special relatives' }
    $sourceAudit.Range('B38').ClearContents()
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*人数分*') { throw 'Explicit G74=0 without G72 ignored four special relatives' }
    $sourceAudit.Range('B38').Value2 = 0.0
    $relativeSheet.Range('D5:D8').Value2 = '対象外'
    Assert-Value ([string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))) 'OK' 'G72=0 accepts regular special dependent only'
    $relativeSheet.Range('D5:D8').Value2 = '要件確認済'
    $sourceAudit.Range('B38').Value2 = 4.0
    $sourceAudit.Range('B39').Value2 = 1360000.0
    Assert-Value ([string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))) 'OK' 'Source restored after zero-count checks'
    QA-Stage 'special-relative-source-explicit-zero-pass'
    $sourceAudit.Range('B39').Value2 = 1360001.0
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*G74*') {
        throw 'One-yen discrepant G74 source total was not rejected'
    }
    $sourceAudit.Range('B39').Value2 = 1360000.0
    $sourceAudit.Range('B38').Value2 = 5.0
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*人数分*') { throw 'Five asserted G72 but only four confirmed relatives were accepted' }
    $sourceAudit.Range('B38').Value2 = 31.0
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*上限*') { throw 'G72 count 31 was accepted' }
    $sourceAudit.Range('B38').Value2 = 4.5
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*整数*') { throw 'Fractional G72 count was accepted' }
    $sourceAudit.Range('B38').Value2 = 4.0
    $relativeSheet.Range('D8').Value2 = '未確認'
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*未確認*') { throw 'Unconfirmed fifth relative bypassed the source audit' }
    $relativeSheet.Range('D8').Value2 = '要件確認済'
    # Person 30 must be included in both statutory totals and G72/G74,
    # not silently omitted by a hard-coded three-person or five-person loop.
    $relativeSheet.Range('B33').Value2 = 21.0
    $relativeSheet.Range('C33').Value2 = 850000.0
    $relativeSheet.Range('D33').Value2 = '要件確認済'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $relativeSheet.Range('E33').Value2 630000 'Thirtieth relative income-tax amount'
    Assert-Value $relativeSheet.Range('F33').Value2 450000 'Thirtieth relative resident-tax amount'
    Assert-Value $relativeSheet.Range('E35').Value2 2620000 'Thirtieth relative included in national total'
    Assert-Value $relativeSheet.Range('F35').Value2 2100000 'Thirtieth relative included in municipal total'
    $errorText = [string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))
    if ($errorText -notlike '*人数分*') { throw 'Thirtieth relative was omitted from G72 count review' }
    $sourceAudit.Range('B38').Value2 = 5.0
    $sourceAudit.Range('B39').Value2 = 1990000.0
    Assert-Value ([string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))) 'OK' 'Five special relatives including row33'
    $relativeSheet.Range('B33,C33').ClearContents()
    $relativeSheet.Range('D33').Value2 = '未確認'
    $sourceAudit.Range('B38').Value2 = 4.0
    $sourceAudit.Range('B39').Value2 = 1360000.0
    Assert-Value ([string]($excel.Run('TaxLawUpdater.SpecialRelativeSourceCheckForTest'))) 'OK' 'Restored G72/G74 after row33 cleanup'
    QA-Stage 'special-relative-source-g72-g74-person-by-person-pass'
    $sourceAudit.Range('B14').Value2 = 3660000.0
    $sourceAudit.Range('B20').Value2 = 'VERIFIED_AFTER_CORRECTION'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    $sourceAudit.Range('B41').Value2 = [string]$sourceAudit.Range('B42').Value2
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'G72/G74 person-specific source snapshot'
    $relativeSheet.Range('C7').Value2 = 1050000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Changing fourth person revokes verified source snapshot'
    $relativeSheet.Range('C7').Value2 = 950001.0
    $sourceAudit.Range('B14,B20,B38:B39,B41').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Clearing verified source returns to independent calculations'
    # A sixth relative cannot silently become eligible without age/identity review.
    $relativeSheet.Range('C9').Value2 = 600000.0
    $relativeSheet.Range('B9').Value2 = 20.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value ([string]$relativeSheet.Range('G9').Value2) '要確認' 'Unconfirmed sixth relative is held'
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Unconfirmed relative masks donation limit'
    $relativeSheet.Range('D9').Value2 = '要件確認済'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $relativeSheet.Range('E9').Value2 630000 'Sixth person individually calculated'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Sixth person review clears HOLD'
    $relativeSheet.Range('B9').Value2 = 23.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value ([string]$relativeSheet.Range('G9').Value2) '要確認' 'Non-eligible age cannot be confirmed'
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Out-of-range age masks donation limit'
    $relativeSheet.Range('D9').Value2 = '対象外'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $relativeSheet.Range('E9').Value2 0 'Explicitly excluded relative adds zero'
    # A 600,000-yen income is special-relative in 2025 but special-dependent
    # in 2026. Both tax amounts are the same at this boundary, not the label.
    $relativeSheet.Range('B9').Value2 = 20.0
    $relativeSheet.Range('D9').Value2 = '要件確認済'
    $settings.Range('B4').Value2 = 2025.0
    $homeSheet.Range('B4').Value2 = 2025.0
    $homeSheet.Range('B11').Value2 = 2025.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value ([string]$relativeSheet.Range('G9').Value2) '特定親族特別控除' '2025 income limit'
    Assert-Value $relativeSheet.Range('E9').Value2 630000 '2025 independent income-tax boundary'
    Assert-Value $relativeSheet.Range('F9').Value2 450000 '2025 independent resident-tax boundary'
    $settings.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B11').Value2 = 2026.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value ([string]$relativeSheet.Range('G9').Value2) '特定扶養親族' '2026 income limit'
    $relativeSheet.Range('B4:B33,C7:C33').ClearContents()
    $relativeSheet.Range('D4:D33').Value2 = '未確認'
    $homeSheet.Range('D14:D16').ClearContents()
    $homeSheet.Range('B12').ClearContents()
    $homeSheet.Range('B15').ClearContents()
    $homeSheet.Range('B16').ClearContents()
    $homeSheet.Range('B25').Value2 = 'なし'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'multi-relative-independent-com-pass'
    # A household with ONLY special-relative deductions has no regular
    # under-23 dependent; "なし" must not be rejected merely because an
    # individual special relative was entered in the first legacy slot.
    QA-Stage 'special-relative-only-under23-switch-start'
    $homeSheet.Range('B12').Value2 = 7000000.0
    $homeSheet.Range('B15').Value2 = 285800.0
    $homeSheet.Range('B16').Value2 = 1000000.0
    $homeSheet.Range('D14').Value2 = 900000.0
    $relativeSheet.Range('B4').Value2 = 20.0
    $relativeSheet.Range('D4').Value2 = '要件確認済'
    $homeSheet.Range('B25').Value2 = 'なし'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $relativeSheet.Range('G4').Value2 '特定親族特別控除' 'Special-relative only person'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Special-relative-only household requires no regular dependent'
    $homeSheet.Range('D14').Value2 = 500000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Regular 19-22 dependent without under-23 declaration was accepted'
    }
    $homeSheet.Range('D14').ClearContents()
    $relativeSheet.Range('B4').ClearContents()
    $relativeSheet.Range('D4').Value2 = '未確認'
    $homeSheet.Range('B12').ClearContents()
    $homeSheet.Range('B15').ClearContents()
    $homeSheet.Range('B16').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'special-relative-only-under23-switch-pass'
    # Statutory special-relative deduction edge cases, all synthetic.
    $familyBands = @(
        @{ Year=2025; Income=580000; Expected=0 },
        @{ Year=2025; Income=580001; Expected=630000 },
        @{ Year=2026; Income=620000; Expected=0 },
        @{ Year=2026; Income=620001; Expected=630000 },
        @{ Year=2026; Income=850000; Expected=630000 },
        @{ Year=2026; Income=850001; Expected=610000 },
        @{ Year=2026; Income=900001; Expected=510000 },
        @{ Year=2026; Income=1200001; Expected=30000 },
        @{ Year=2026; Income=1230001; Expected=0 }
    )
    foreach ($band in $familyBands) {
        $actual = [double]($excel.Run('TaxLawUpdater.SpecialRelativeTaxDeduction',
                                     [double]$band.Income, [int]$band.Year))
        Assert-Value $actual $band.Expected ('Special relative income ' + $band.Year + ' / ' + $band.Income)
    }
    QA-Stage 'special-relative-income-bands-pass'
    QA-Stage 'print-setup-validation-start'
    Assert-PrintConfiguration $homeSheet 'Home' '\$A\$1:\$D\$39'
    Assert-PrintConfiguration $detail 'Detail' '\$A\$1:\$D\$23'
    QA-Stage 'print-setup-validation-done'
    foreach ($year in @(2025, 2026)) {
        QA-Stage ('synthetic-' + $year + '-input-start')
        $settings.Range('B4').Value2 = [double]$year
        $homeSheet.Range('B4').Value2 = [double]$year
        $homeSheet.Range('B11').Value2 = [double]$year
        $homeSheet.Range('B12').Value2 = 7000000.0
        # Do not overwrite the calculated salary income or deduction total.
        $homeSheet.Range('B15').Value2 = 285800.0
        $homeSheet.Range('B16').Value2 = 1000000.0
        # Paid premiums drive the auto-calculated insurance deduction.
        $homeSheet.Range('B25').Value2 = 'なし'
        if ([string]$homeSheet.Range('B26').Formula -notlike '*B28*') {
            throw 'The automatic eligibility display formula was overwritten'
        }
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
        Assert-Value $homeSheet.Range('B13').Value2 5200000 "$year computed salary income"
        if ($year -eq 2026) {
            # Published R8 source form sample: ¥5m salary -> ¥3.56m income.
            $homeSheet.Range('B12').Value2 = 5000000
            $excel.Run('TaxLawUpdater.RecalculateCase')
            Assert-Value $homeSheet.Range('B13').Value2 3560000 '2026 salary table example'
            # Primary source: NTA No.1410, special 2026 income bands.
            # Exercise the real Excel B13 formula on the disposable copy,
            # including both sides of each statutory boundary.
            $specialSalary2026 = @(
                @{ Gross=690999; Expected=0 }, @{ Gross=691000; Expected=0 },
                @{ Gross=740999; Expected=0 }, @{ Gross=741000; Expected=1000 },
                @{ Gross=2190999; Expected=1450999 },
                @{ Gross=2191000; Expected=1451000 },
                @{ Gross=2192999; Expected=1451000 },
                @{ Gross=2193000; Expected=1453000 },
                @{ Gross=2195999; Expected=1453000 },
                @{ Gross=2196000; Expected=1456000 },
                @{ Gross=2199999; Expected=1456000 },
                @{ Gross=2200000; Expected=1460000 },
                @{ Gross=2200001; Expected=1460000 }
            )
            foreach($sample in $specialSalary2026) {
                $homeSheet.Range('B12').Value2 = [double]$sample.Gross
                $excel.Run('TaxLawUpdater.RecalculateCase')
                Assert-Value $homeSheet.Range('B13').Value2 $sample.Expected ('NTA 2026 salary '+ $sample.Gross)
            }
            QA-Stage 'nta-2026-salary-boundaries-pass'
            $homeSheet.Range('B12').Value2 = 7000000
            $excel.Run('TaxLawUpdater.RecalculateCase')
        }
        Assert-Value $homeSheet.Range('B14').Value2 $(if ($year -eq 2025) { 1630000 } else { 1670000 }) "$year computed total deductions"
        Assert-Value $homeSheet.Range('B8').Value2 109000 "$year donation estimate"
    }
    QA-Stage 'synthetic-years-pass'
    # Regression: certified source subtotals are not invalid just because a
    # simplified entry screen omits special-dependent deduction components.
    # All values below are synthetic and must never contain taxpayer data.
    QA-Stage 'withholding-source-values-start'
    $sourceExtra = $book.Worksheets.Item('例外・分離課税')
    $homeSheet.Range('B12').Value2 = 5100000.0
    $homeSheet.Range('B15').Value2 = 0.0
    $homeSheet.Range('B16').Value2 = 1500000.0
    $sourceExtra.Range('B14').Value2 = 3800000.0
    $sourceExtra.Range('B15').Value2 = 3550000.0
    $sourceExtra.Range('B16').Value2 = 46000.0
    $sourceExtra.Range('B17').Value2 = 17000.0
    foreach ($cell in @('B25', 'D22', 'D24')) {
        $homeSheet.Range($cell).ClearContents()
    }
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B13').Value2 3550000 'Source salary income preferred'
    Assert-Value $homeSheet.Range('B14').Value2 $homeSheet.Range('B31').Value2 'Recalculated total is used, not historical slip total'
    Assert-Value $homeSheet.Range('D31').Value2 3800000 'Original deduction source total remains visible'
    Assert-Value $homeSheet.Range('B17').Value2 46000 'Source life deduction preferred'
    Assert-Value $homeSheet.Range('B18').Value2 17000 'Source earthquake deduction preferred'
    Assert-Value $homeSheet.Range('B25').Value2 'なし' 'Blank dependent indicator normalized'
    Assert-Value $homeSheet.Range('B26').Value2 '追加確認' 'Unreconciled reference requires check'
    Assert-Value $homeSheet.Range('D22').Value2 '該当なし' 'Blank personal allowance normalized'
    Assert-Value $homeSheet.Range('D24').Value2 'ワンストップ' 'Blank filing mode normalized'
    if ([string]$homeSheet.Range('B28').Value2 -eq 'エラー：金額・人数・控除の内訳を源泉徴収票と照合してください') {
        throw 'Withholding source references were incorrectly rejected as invalid fields'
    }
    $sourceExtra.Range('B14:B17').ClearContents()
    $homeSheet.Range('B12').Value2 = 7000000.0
    $homeSheet.Range('B15').Value2 = 285800.0
    $homeSheet.Range('B16').Value2 = 1000000.0
    $homeSheet.Range('D24').Value2 = '確定申告'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Synthetic input restored'
    QA-Stage 'withholding-source-values-pass'
    # Actual Excel recalculation: ordinary pension and miscellaneous income
    # use the native salary+other income engine; no notice/manual tax rate.
    $extraSheet = $book.Worksheets.Item('例外・分離課税')
    $whtSheet = $book.Worksheets.Item('源泉徴収票入力')
    $engineSheet = $book.Worksheets.Item('ふるさと納税限度額計算')
    $residentSheet = $book.Worksheets.Item('住民税再計算')
    QA-Stage 'other-income-start'
    $baseTaxable = [double]$engineSheet.Range('J12').Value2
    $baseResident = [double]$residentSheet.Range('B6').Value2
    $extraSheet.Range('B5').Value2 = 2000000.0
    $extraSheet.Range('B6').Value2 = '65歳以上'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B7').Value2 900000 'Pension income aged 65 plus'
    Assert-Value $extraSheet.Range('B29').Value2 100000 'Salary and pension adjustment'
    Assert-Value $extraSheet.Range('B28').Value2 800000 'Additional income net'
    Assert-Value $engineSheet.Range('J12').Value2 ($baseTaxable + 800000) 'Taxable income includes pension'
    Assert-Value $whtSheet.Range('B11').Value2 800000 'Source income link'
    Assert-Value $residentSheet.Range('B6').Value2 ($baseResident + 800000) 'Resident income includes pension'
    Assert-Value $extraSheet.Range('B22').Value2 $residentSheet.Range('B21').Value2 'Income tax rate auto'
    $extraSheet.Range('B5').ClearContents()
    $extraSheet.Range('B6').ClearContents()
    $extraSheet.Range('B8').Value2 = 300000.0
    $extraSheet.Range('B9').Value2 = 100000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B28').Value2 200000 'Business miscellaneous net income'
    Assert-Value $engineSheet.Range('J12').Value2 ($baseTaxable + 200000) 'Taxable income includes miscellaneous'
    $extraSheet.Range('B8:B9').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    $regularLevy = [double]$residentSheet.Range('B16').Value2
    $regularLimit = [double]$residentSheet.Range('B19').Value2
    # Missing classification remains blocked.
    $extraSheet.Range('B24').Value2 = 1000000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Unclassified split income was accepted'
    }
    $extraSheet.Range('B25').Value2 = '上場株式'
    Assert-Value $extraSheet.Range('B4').Value2 '分離課税' 'Split case classification auto'
    $extraSheet.Range('B33').Value2 = 'なし'
    $homeSheet.Range('D24').Value2 = 'ワンストップ'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('D24').Value2 '確定申告' 'Split income uses tax return'
    Assert-Value $extraSheet.Range('B27').Value2 50000 'Listed shares resident tax 1m'
    Assert-Value $residentSheet.Range('B16').Value2 ($regularLevy+50000) 'Split tax included in resident income levy'
    Assert-Value $residentSheet.Range('B19').Value2 ($regularLimit+10000) 'Split special credit ceiling'
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-016*') { throw 'Legacy input escaped HOLD: Ordinary listed shares declared split case' }
    foreach ($cell in 'B16','B17','B18') {
        Assert-Value ([string]$book.Worksheets.Item('計算根拠').Range($cell).Value2) '' "Legacy split breakdown $cell suppressed during HOLD"
    }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Legacy split input must hide donation amount'
    $extraSheet.Range('B24').Value2 = 500000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B27').Value2 25000 'Screenshot listed shares 500k resident levy'
    Assert-Value $residentSheet.Range('B16').Value2 ($regularLevy+25000) 'Screenshot total resident levy'
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-016*') { throw 'Legacy input escaped HOLD: Screenshot mixed salary plus stocks' }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Legacy split input must hide donation amount'
    $extraSheet.Range('B25').Value2 = '土地建物短期'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B27').Value2 45000 'Standard short land resident levy'
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-016*') { throw 'Legacy input escaped HOLD: Standard short land tax case' }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Legacy split input must hide donation amount'
    $extraSheet.Range('B33').Value2 = 'あり'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Special rate or carryforward mistakenly accepted'
    }
    $extraSheet.Range('B33').Value2 = 'なし'
    $extraSheet.Range('B25').Value2 = 'その他'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Unsupported split tax classification mistakenly accepted'
    }
    $extraSheet.Range('B24:B25').ClearContents()
    $extraSheet.Range('B25').Value2 = 'なし'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B4').Value2 '通常' 'Normal case category restored automatically'
    # Gross income 5.2m, certified non-donation deductions 5.1m:
    # ordinary taxable 100k, split taxable 20m. On a 200k donation
    # the first 100k is deducted from ordinary income, 98k from stock gains.
    QA-Stage 'split-donation-overflow-start'
    $allocation = $book.Worksheets.Item('分離課税寄附控除')
    $homeSheet.Range('D25').Value2 = 5100000.0
    $extraSheet.Range('B24').Value2 = 20000000.0
    $extraSheet.Range('B25').Value2 = '上場株式'
    $extraSheet.Range('B33').Value2 = 'なし'
    $extraSheet.Range('B36').Value2 = 20000000.0
    $homeSheet.Range('B33:B36').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-016*') { throw 'Legacy input escaped HOLD: Ordinary plus split supported' }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Legacy split input must hide donation amount'
    Assert-Value $allocation.Range('B2').Value2 100000 'Ordinary taxable income before donation'
    Assert-Value $allocation.Range('B3').Value2 20000000 'Split taxable income before donation'
    Assert-Value $allocation.Range('F50').Value2 198000 '200k donation deduction'
    Assert-Value $allocation.Range('G50').Value2 0 'Ordinary tax fully eliminated by donation'
    Assert-Value $allocation.Range('H50').Value2 19902000 'Remaining split taxable after spillover'
    Assert-Value $allocation.Range('Q50').Value2 98000 'Donated deduction allocated to split income'
    Assert-Value $allocation.Range('I50').Value2 2985300 'After-donation income tax'
    if ([double]$allocation.Range('J50').Value2 -lt 20113 -or
        [double]$allocation.Range('J50').Value2 -gt 20115) {
        throw 'Income tax delta is missing split-income reduction'
    }
    $candidate = [double]$allocation.Range('B46').Value2
    if ($candidate -lt 2000 -or $candidate -ge 300000) {
        throw "Donation ceiling is outside validated synthetic range: $candidate"
    }
    Assert-Value ([string]$homeSheet.Range('B8').Value2) '' 'Legacy split solver must not publish a donation limit'
    Assert-Value $homeSheet.Range('B26').Value2 '追加確認' 'Legacy mixed case requires migration'
    $homeSheet.Range('D25').ClearContents()
    $extraSheet.Range('B24:B25').ClearContents()
    $extraSheet.Range('B25').Value2 = 'なし'
    $extraSheet.Range('B36').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Ordinary case restored'
    QA-Stage 'split-donation-overflow-pass'
    $extraSheet.Range('B20').Value2 = 'REQUIRES_REVIEW'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Unverified PDF was allowed to show a donation limit'
    }
    $extraSheet.Range('B20').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $engineSheet.Range('J12').Value2 $baseTaxable 'Ordinary additional income reset'
    Assert-Value $homeSheet.Range('B26').Value2 '計算可能' 'Supported case automatically accepted'
    QA-Stage 'auto-eligibility-verdict-start'
    $extraSheet.Range('B21').Value2 = 12000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Unsupported old long-term insurance was accepted without computation'
    }
    Assert-Value $homeSheet.Range('B26').Value2 '追加確認' 'Unmodeled deduction automatically flagged'
    $extraSheet.Range('B21').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B26').Value2 '計算可能' 'Automatic eligibility restores after correcting input'
    QA-Stage 'auto-eligibility-verdict-pass'
    QA-Stage 'other-income-regressions-pass'
    # A spouse deduction is conditional on the recipient's own total income.
    # Adding business income must change F38 AND the computed deduction
    # total, not leave the slip's earlier total frozen. Synthetic only.
    QA-Stage 'spouse-own-income-reassessment-start'
    $homeSheet.Range('D17').Value2 = 0.0
    $extraSheet.Range('B12').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    $spouseBefore = [double]$engineSheet.Range('F38').Value2
    $autoBefore = [double]$homeSheet.Range('B31').Value2
    if ($spouseBefore -le 0) {
        throw 'Zero-income ordinary spouse was not deductible before extra income'
    }
    $extraSheet.Range('B12').Value2 = 6000000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    $spouseAfter = [double]$engineSheet.Range('F38').Value2
    if ($spouseAfter -ge $spouseBefore) {
        throw 'Spouse deduction did not decline when taxpayer income exceeded upper limit'
    }
    $autoAfter = [double]$homeSheet.Range('B31').Value2
    if ($autoAfter -eq $autoBefore) {
        throw 'Computed deduction total ignored spouse and additional-income change'
    }
    Assert-Value $homeSheet.Range('B14').Value2 $autoAfter 'Applied total auto-recalculated after spouse threshold'
    $extraSheet.Range('B12').ClearContents()
    $homeSheet.Range('D17').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'spouse-own-income-reassessment-pass'
    # Mortgage tax credit is routine input. Check the resident-tax credit and
    # every missing/unsupported branch against *real* Excel formula evaluation.
    QA-Stage 'mortgage-normal-start'
    $homeSheet.Range('B33').Value2 = 0.0
    $homeSheet.Range('B34').Value2 = 50000.0
    $homeSheet.Range('B35').Value2 = 2024.0
    $homeSheet.Range('B36').Value2 = 1.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B38').Value2 50000.0 'Mortgage resident credit 2024'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Mortgage ordinary case'
    $homeSheet.Range('B33').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Missing mortgage applied tax credit incorrectly passed'
    }
    $homeSheet.Range('B33').Value2 = 0.0
    $homeSheet.Range('B35').Value2 = 2021.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Unverified old mortgage occupancy year incorrectly passed'
    }
    $homeSheet.Range('B35').Value2 = 2024.0
    $homeSheet.Range('B36').Value2 = 2.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Multiple mortgage credits incorrectly passed'
    }
    $homeSheet.Range('B36').Value2 = 1.0
    $homeSheet.Range('B33').Value2 = 70000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Applied mortgage credit exceeding possible amount passed'
    }
    $homeSheet.Range('B33:B36').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Mortgage case reset'
    QA-Stage 'mortgage-regressions-pass'
    # Independent statutory resident-mortgage tests for the 2025/2026
    # national basic deduction increase and non-salary ordinary income.
    # No customer data; the isolated Excel state is restored afterward.
    QA-Stage 'mortgage-2025-2026-basic-delta-start'
    $homeSheet.Range('D25').Value2 = 5000000.0
    $homeSheet.Range('B33').Value2 = 0.0
    $homeSheet.Range('B34').Value2 = 150000.0
    $homeSheet.Range('B35').Value2 = 2024.0
    $homeSheet.Range('B36').Value2 = 1.0
    foreach ($case in @(
        @{ Year=2025; Basic=630000; Credit=17500 },
        @{ Year=2026; Basic=670000; Credit=19500 }
    )) {
        $settings.Range('B4').Value2 = [double]$case.Year
        $homeSheet.Range('B4').Value2 = [double]$case.Year
        $homeSheet.Range('B11').Value2 = [double]$case.Year
        $excel.Run('TaxLawUpdater.RecalculateCase')
        Assert-Value $homeSheet.Range('B13').Value2 5200000 ('Housing salary '+$case.Year)
        Assert-Value $engineSheet.Range('F15').Value2 $case.Basic ('Housing basic '+$case.Year)
        Assert-Value $engineSheet.Range('J12').Value2 200000 ('Housing taxable '+$case.Year)
        Assert-Value $homeSheet.Range('B38').Value2 $case.Credit ('Housing basic delta '+$case.Year)
    }
    $extraSheet.Range('B8').Value2 = 500000.0
    $extraSheet.Range('B9').Value2 = 0.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $engineSheet.Range('J12').Value2 700000 'Housing ordinary extra-income taxable total'
    Assert-Value $homeSheet.Range('B38').Value2 44500 'Housing with ordinary extra income'
    $homeSheet.Range('B35').Value2 = 2026.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B38').Value2 35000 'Housing 2026 occupancy ordinary 5% base'
    $homeSheet.Range('B35').Value2 = 2022.0
    $mortgageHint = [string]$homeSheet.Range('D35').Validation.InputMessage
    if ($mortgageHint -notlike '*消費税10%*' -or
        $mortgageHint -notlike '*2020/10*' -or
        $mortgageHint -notlike '*2021/11*') {
        throw '2022 mortgage guidance missing legal contract and VAT checks'
    }
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-028*' -or
        [string]$homeSheet.Range('B8').Value2 -ne '' -or
        [string]$homeSheet.Range('B38').Value2 -ne '') {
        throw '2022 unverified mortgage class escaped HOLD'
    }
    $homeSheet.Range('D35').Value2 = '通常5%確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B38').Value2 44500 '2022 ordinary 5-percent mortgage class'
    if ([string]$homeSheet.Range('B28').Value2 -like 'SAFE-TAX-028*') {
        throw '2022 verified 5-percent class still marked unverified'
    }
    $homeSheet.Range('D35').Value2 = '経過措置7%確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B38').Value2 62300 '2022 eligible 7-percent transition'
    if ([string]$homeSheet.Range('B28').Value2 -like 'SAFE-TAX-028*') {
        throw '2022 verified 7-percent class still marked unverified'
    }
    # High-income synthetic boundary scenarios: verify 2022 statutory caps
    # against *actual* Excel formula evaluations; no real taxpayer data.
    QA-Stage 'mortgage-2022-cap-ceilings-start'
    $extraSheet.Range('B8').Value2 = 4500000.0
    $homeSheet.Range('B34').Value2 = 1000000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([double]$engineSheet.Range('J12').Value2 -lt 3000000) {
        throw 'Mortgage 2022 synthetic ceiling test is below intended taxable base'
    }
    Assert-Value $homeSheet.Range('B38').Value2 136500 '2022 verified 7-percent resident ceiling'
    $homeSheet.Range('D35').Value2 = '通常5%確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B38').Value2 97500 '2022 verified 5-percent resident ceiling'
    # Actual Excel statutory rounding immediately BELOW and AT both 2022
    # resident-tax mortgage caps; independently compute national taxable
    # base and the national basic-deduction transition for each tax year.
    QA-Stage 'mortgage-2022-cap-rounding-boundaries-start'
    foreach ($edge in @(
        @{ Year=2025; ExtraBelow=1649000.0; ExtraAt=1650000.0; Basic=580000.0 },
        @{ Year=2026; ExtraBelow=1609000.0; ExtraAt=1610000.0; Basic=620000.0 }
    )) {
        $settings.Range('B4').Value2 = [double]$edge.Year
        $homeSheet.Range('B4').Value2 = [double]$edge.Year
        $homeSheet.Range('B11').Value2 = [double]$edge.Year
        foreach ($row in @(
            @{ Extra=[double]$edge.ExtraBelow; TaxableBase=1949000.0; Five=97450.0; Seven=136430.0 },
            @{ Extra=[double]$edge.ExtraAt; TaxableBase=1950000.0; Five=97500.0; Seven=136500.0 }
        )) {
            $extraSheet.Range('B8').Value2 = [double]$row.Extra
            $homeSheet.Range('D35').Value2 = '経過措置7%確認'
            $excel.Run('TaxLawUpdater.RecalculateCase')
            Assert-Value $engineSheet.Range('F15').Value2 $edge.Basic ('Basic deduction '+$edge.Year)
            $base = [double]$engineSheet.Range('J12').Value2 + [double]$engineSheet.Range('F15').Value2 - 480000.0
            Assert-Value $base $row.TaxableBase ('Housing transitional taxable base '+$edge.Year)
            Assert-Value $homeSheet.Range('B38').Value2 $row.Seven ('Housing 7-percent rounding '+$edge.Year)
            $homeSheet.Range('D35').Value2 = '通常5%確認'
            $excel.Run('TaxLawUpdater.RecalculateCase')
            Assert-Value $homeSheet.Range('B38').Value2 $row.Five ('Housing 5-percent rounding '+$edge.Year)
        }
    }
    # A paste can bypass the Excel drop-down validation; an unrecognised
    # textual confirmation must still fail closed in the tax formula.
    $homeSheet.Range('D35').Value2 = '経過措置7%（未検証）'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-028*' -or
        [string]$homeSheet.Range('B38').Value2 -ne '') {
        throw 'Pasted unsupported 2022 mortgage eligibility escaped HOLD'
    }
    $homeSheet.Range('D35').Value2 = '通常5%確認'
    $extraSheet.Range('B8').Value2 = 4500000.0
    $homeSheet.Range('B33').Value2 = 1000000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B38').Value2 0 'No residual possible credit after full income-tax use'
    QA-Stage 'mortgage-2022-cap-rounding-boundaries-pass'
    $settings.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B4').Value2 = 2026.0
    $homeSheet.Range('B11').Value2 = 2026.0
    $homeSheet.Range('B33').Value2 = 0.0
    $homeSheet.Range('B34').Value2 = 150000.0
    $extraSheet.Range('B8').Value2 = 500000.0
    $homeSheet.Range('D35').Value2 = '未確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-028*' -or
        [string]$homeSheet.Range('B38').Value2 -ne '') {
        throw '2022 ceiling case failed to restore unverified-result HOLD'
    }
    QA-Stage 'mortgage-2022-cap-ceilings-pass'
    $homeSheet.Range('B35').Value2 = 2024.0
    $homeSheet.Range('D35').Value2 = '経過措置7%確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-029*' -or
        [string]$homeSheet.Range('B8').Value2 -ne '') {
        throw 'Stale 2022-specific mortgage class accepted in another year'
    }
    $homeSheet.Range('D35').Value2 = '未確認'
    $homeSheet.Range('B34').Value2 = -1.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$homeSheet.Range('B28').Value2 -eq '正常') {
        throw 'Negative housing possible credit was accepted'
    }
    $homeSheet.Range('D25').ClearContents()
    $extraSheet.Range('B8:B9').ClearContents()
    $homeSheet.Range('B33:B36').ClearContents()
    $homeSheet.Range('D35').Value2 = '未確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Housing statutory corrections restored'
    QA-Stage 'mortgage-2025-2026-basic-delta-pass'
    # Unused split-credit inputs must never silently affect an ordinary
    # estimate. All tests use the isolated synthetic Excel workbook.
    QA-Stage 'ordinary-tax-credit-fail-closed-start'
    foreach ($test in @(
        @('D72', 2024.0), @('D73', 30000000.0), @('D74', 140000.0),
        @('D75', 10000.0), @('D76', 5000.0), @('D77', 100000.0))) {
        $address = [string]$test[0]
        $homeSheet.Range($address).Value2 = [double]$test[1]
        $excel.Run('TaxLawUpdater.RecalculateCase')
        if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-026*' -or
            [string]$homeSheet.Range('B8').Value2 -ne '' -or
            [string]$homeSheet.Range('D8').Value2 -ne '' -or
            [string]$homeSheet.Range('B26').Value2 -ne '追加確認') {
            throw ('Ordinary credit was silently ignored: ' + $address)
        }
        $homeSheet.Range($address).Value2 = 0.0
        $excel.Run('TaxLawUpdater.RecalculateCase')
        Assert-Value $homeSheet.Range('B28').Value2 '正常' ('Credit reset ' + $address)
    }
    foreach ($possible in @($null, 0.0)) {
        $homeSheet.Range('B33').Value2 = 50000.0
        if ($null -eq $possible) { $homeSheet.Range('B34').ClearContents() }
        else { $homeSheet.Range('B34').Value2 = [double]$possible }
        $excel.Run('TaxLawUpdater.RecalculateCase')
        if ([string]$homeSheet.Range('B28').Value2 -notlike 'SAFE-TAX-027*' -or
            [string]$homeSheet.Range('B8').Value2 -ne '') {
            throw 'Mortgage applied credit without possible credit escaped safety gate'
        }
    }
    $homeSheet.Range('B33:B36').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Mortgage missing possible reset'
    QA-Stage 'ordinary-tax-credit-fail-closed-pass'
    # FAIL-14: Excel manual mode with pending formula caches must never leave
    # the old donation amount or a false "計算可能" visible to the operator.
    # Only a freshly owned synthetic workbook and this Excel COM instance
    # are changed; no global Excel options or other processes are touched.
    QA-Stage 'stale-result-manual-calculation-start'
    $originalCalculation = [int]$excel.Calculation
    $originalMortgage = $homeSheet.Range('B34').Value2
    try {
        $excel.EnableEvents = $true
        $excel.Calculation = -4135 # xlCalculationManual
        $homeSheet.Range('B34').Value2 = 300000.0
        if ([string]$homeSheet.Range('B8').Text -ne '') {
            throw 'Old donation amount remains visibly exposed while calculation is manual'
        }
        if ([string]$homeSheet.Range('B26').Text -eq '計算可能') {
            throw 'Stale "計算可能" status remains visible while calculation is manual'
        }
        if ([string]$homeSheet.Range('A9').Text -notlike '*計算未完了*') {
            throw 'Visible recalculation hold message was not shown'
        }
        $blockedPdf = Join-Path $dir 'must-not-export-stale.pdf'
        if ([bool]$excel.Run('TaxLawUpdater.TryExportDetailsToFileForTest', $blockedPdf)) {
            throw 'Stale result was allowed to export as PDF'
        }
        if (Test-Path -LiteralPath $blockedPdf) {
            throw 'Stale result created an unsafe PDF file'
        }
    } finally {
        if ($null -eq $originalMortgage -or [string]$originalMortgage -eq '') {
            $homeSheet.Range('B34').ClearContents()
        } else {
            $homeSheet.Range('B34').Value2 = $originalMortgage
        }
        $excel.Calculation = -4105 # xlCalculationAutomatic
        $excel.Run('TaxLawUpdater.RecalculateCase')
        $excel.EnableEvents = $false
    }
    Assert-Value ([string]$homeSheet.Range('B26').Text) '計算可能' 'Status restored after automatic calculation'
    Assert-Value $homeSheet.Range('B8').Value2 109000 'Amount restored after automatic calculation'
    Assert-Value ([string]$homeSheet.Range('B8').Text) '109,000' 'Actual visible amount restored after automatic calculation'
    QA-Stage 'stale-result-manual-calculation-pass'
    # The new thirty-person detail sheet MUST trigger the exact same
    # Workbook_SheetChange stale-result mask as the original home inputs.
    # Changing an age/income on the relative sheet while Excel is in
    # manual calculation mode must never leave a previously approved
    # donation limit or printable PDF visible.
    QA-Stage 'relative-sheet-manual-stale-result-start'
    $previousCalc = [int]$excel.Calculation
    try {
        $excel.EnableEvents = $true
        $excel.Calculation = -4135 # xlCalculationManual
        $relativeSheet.Range('B33').Value2 = 21.0
        if ([string]$homeSheet.Range('B8').Text -ne '') {
            throw 'Editing the relative age left a stale donation limit visible'
        }
        if ([string]$homeSheet.Range('A9').Text -notlike '*計算未完了*') {
            throw 'Relative age edit did not issue a stale-result warning'
        }
        $relativeSheet.Range('C33').Value2 = 900000.0
        $relativeSheet.Range('D33').Value2 = '要件確認済'
        if ([string]$homeSheet.Range('B8').Text -ne '') {
            throw 'Editing thirtieth-relative income/status exposed an old result'
        }
        if ([string]$homeSheet.Range('B26').Text -eq '計算可能') {
            throw 'Eligibility was shown as valid under manual calculation after editing relatives'
        }
        $blockedRelativePdf = Join-Path $dir 'must-not-export-stale-relative.pdf'
        if ([bool]($excel.Run('TaxLawUpdater.TryExportDetailsToFileForTest', $blockedRelativePdf))) {
            throw 'Edited relative in manual mode allowed a stale PDF'
        }
        if (Test-Path -LiteralPath $blockedRelativePdf) {
            throw 'Edited relative in manual mode wrote an unsafe PDF file'
        }
    } finally {
        $excel.Calculation = $previousCalc
        $excel.Run('TaxLawUpdater.RecalculateCase')
        $excel.EnableEvents = $false
    }
    Assert-Value $relativeSheet.Range('E33').Value2 610000 'Thirtieth-relative tax deduction after auto recalc'
    Assert-Value $relativeSheet.Range('F33').Value2 450000 'Thirtieth-relative municipal deduction after auto recalc'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Thirtieth-relative confirmation restores eligibility'
    $relativeSheet.Range('B33,C33').ClearContents()
    $relativeSheet.Range('D33').Value2 = '未確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B8').Value2 109000 'Normal result restored after clearing test relative'
    QA-Stage 'relative-sheet-manual-stale-result-pass'

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
    $extraSheet.Range('B21').Value2 = 12000.0
    QA-Stage ('full-rebuild-start-after-' + $script:qaStage)
    $excel.CalculateFullRebuild()
    QA-Stage 'full-rebuild-done'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Unsupported old long-term insurance case'
    Assert-Value $homeSheet.Range('B26').Value2 '追加確認' 'Automatic status on unsupported deduction'
    $extraSheet.Range('B21').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B26').Value2 '計算可能' 'Automatic status after removing unsupported deduction'
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

    # Save the case with a real eligible person in the 30th slot.  Check
    # that age, income, eligibility, calculated deductions, and the overall
    # donation result survive SaveCopyAs and reopen. The test is isolated.
    QA-Stage 'relative-thirtieth-case-persistence-start'
    $relativeSheet.Range('B33').Value2 = 21.0
    $relativeSheet.Range('C33').Value2 = 900000.0
    $relativeSheet.Range('D33').Value2 = '要件確認済'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $relativeSheet.Range('G33').Value2 '特定親族特別控除' 'Thirtieth saved-relative classification'
    Assert-Value $relativeSheet.Range('E33').Value2 610000 'Thirtieth saved-relative national deduction'
    Assert-Value $relativeSheet.Range('F33').Value2 450000 'Thirtieth saved-relative resident deduction'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Case is eligible with thirtieth relative'
    $expectedSavedDonation = [double]$homeSheet.Range('B8').Value2
    if ($expectedSavedDonation -le 0) { throw 'Thirty-person case has no valid donation estimate' }
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
        Assert-Value $savedCase.Worksheets.Item('操作画面').Range('B8').Value2 $expectedSavedDonation 'Saved case preserves thirtieth-relative donation estimate'
        $savedRelative = $savedCase.Worksheets.Item('特定親族明細')
        Assert-Value $savedRelative.Range('B33').Value2 21 'Saved case keeps thirtieth-relative age'
        Assert-Value $savedRelative.Range('C33').Value2 900000 'Saved case keeps thirtieth-relative income'
        Assert-Value $savedRelative.Range('D33').Value2 '要件確認済' 'Saved case keeps thirtieth-relative eligibility'
        Assert-Value $savedRelative.Range('E33').Value2 610000 'Saved case recalculates thirtieth-relative national amount'
        Assert-Value $savedRelative.Range('F33').Value2 450000 'Saved case recalculates thirtieth-relative municipal amount'
        Assert-MacroAction ([string]$savedCase.Worksheets.Item('操作画面').Buttons().Item('btnTaxLawUpdate').OnAction) 'case_preservation.xlsm!TaxLawUpdater.TaxLawUpdate' 'Copied case macro ownership'
        Assert-MacroAction ([string]$savedCase.Worksheets.Item('計算根拠').Buttons().Item('btnExportDetails').OnAction) 'case_preservation.xlsm!TaxLawUpdater.ExportDetails' 'Copied case PDF macro ownership'
    } finally {
        $savedCase.Close($false)
    }

    # The saved copy retains the confirmed 30th relative, while the
    # isolated main QA copy returns to the original salary-only baseline.
    $relativeSheet.Range('B33,C33').ClearContents()
    $relativeSheet.Range('D33').Value2 = '未確認'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B8').Value2 109000 'Main QA copy restored after relative case-save'
    QA-Stage 'relative-thirtieth-case-persistence-pass'
    # Reopen the QA copy after a successful case save.
    if ([string]$homeSheet.Range('B26').Formula -notlike '*B28*') {
        throw 'Automatic eligibility formula was lost during save/reopen'
    }
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
    # Electronic home print audit on synthetic data; no real user document.
    QA-Stage 'home-overview-pdf-start'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Home print valid status'
    Assert-Value $homeSheet.Range('B8').Value2 109000 'Home print donation estimate'
    $homePdf = Join-Path $dir 'home-overview.pdf'
    $homeSheet.ExportAsFixedFormat(0, $homePdf, 0, $true, $false)
    if (-not (Test-Path -LiteralPath $homePdf -PathType Leaf) -or
        (Get-Item -LiteralPath $homePdf).Length -lt 500) {
        throw 'Synthetic home overview PDF missing or empty'
    }
    QA-Stage 'home-overview-pdf-pass'
    QA-Stage 'statutory-split-cases-start'
    . (Join-Path $PSScriptRoot 'test_separate_excel.ps1')
    $splitCases = @(Test-SeparateTaxCases -Excel $excel -Book $book -FixturePath (Join-Path $PSScriptRoot '../taxdata/separate-tax-cases-v1.json') -PdfPath (Join-Path $dir 'split-result.pdf'))
    if ($splitCases.Count -ne 70) { throw 'Split evidence is incomplete' }
    QA-Stage 'statutory-split-70-exact-pass'
    QA-Stage 'statutory-split-pdf-and-safety-recovery-pass'
    # Export only this isolated runner's synthetic PDF output for layout QA.
    if (-not [string]::IsNullOrWhiteSpace($PdfEvidencePath)) {
        if (Test-Path -LiteralPath $PdfEvidencePath) {
            throw 'PDF layout evidence destination already exists'
        }
        [void][IO.Directory]::CreateDirectory($PdfEvidencePath)
        foreach ($name in @('FurusatoQA.pdf', 'FurusatoQA_hidden.pdf', 'split-result.pdf', 'split-result.print-inputs.json', 'home-overview.pdf')) {
            $inputPdf = Join-Path $dir $name
            if (-not (Test-Path -LiteralPath $inputPdf -PathType Leaf)) {
                throw ('Synthetic PDF/layout proof is missing: ' + $name)
            }
            Copy-Item -LiteralPath $inputPdf -Destination (Join-Path $PdfEvidencePath $name) -ErrorAction Stop
        }
        QA-Stage 'synthetic-pdf-audit-input-export-pass'
    }
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
    # Release new COM worksheet handles used by pension/other-income QA,
    # otherwise an orphan Excel process can keep the staged XLSM locked
    # when VBAUpdater immediately opens it in the same CI job.
    foreach ($obj in @($extraSheet,$whtSheet,$engineSheet,$residentSheet,
                       $savedCase,$detail,$checks,$settings,$homeSheet,$book,$excel)) {
        try {
            if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    # Only sanitized stage identifiers are collected before deleting the
    # disposable QA directory. Credentials and the workbook are never logged.
    $traceFile = Join-Path $dir '_furusato_tax_update_qa.trace'
    if (Test-Path -LiteralPath $traceFile -PathType Leaf) {
        try {
            $traceItems = @(Get-Content -LiteralPath $traceFile -ErrorAction Stop)
            if ($traceItems.Count -gt 0) {
                $lastVbaUpdateStage = [string]$traceItems[-1]
                Write-Host ('QA_TAX_UPDATE_LAST_STAGE ' + $lastVbaUpdateStage)
            }
        } catch { $lastVbaUpdateStage = 'TRACE_READ_FAILED' }
    }
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
                separate_cases = $splitCases
                failure = $failureSummary
                last_stage = $script:qaStage
                last_tax_update_macro_stage = $lastVbaUpdateStage
            }
            $json = $report | ConvertTo-Json -Depth 8
            $encoding = New-Object System.Text.UTF8Encoding($false)
            [IO.File]::WriteAllText($EvidencePath, $json, $encoding)
        } catch {
            Write-Warning ('Could not write isolated Excel acceptance evidence: ' + $_.Exception.Message)
        }
    }
}
