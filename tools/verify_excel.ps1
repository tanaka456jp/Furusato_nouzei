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
function Assert-BlankTaxAmount($actual, [string]$label) {
    # Excel COM Empty can be marshaled as null (not an empty string).
    # Both represent truly blank cells; numeric zero is NOT blank.
    if ($null -ne $actual -and [string]$actual -ne '') {
        throw "$label expected an empty amount, got [$actual]"
    }
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
    $excel.Run('BatchWithholding.BindButtons')
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchReadyForTest'))) $true 'Batch VBA module installed'
    $batchSheet = $book.Worksheets.Item('一括試算一覧')
    Assert-Value $batchSheet.Visible 2 'Batch sheet is hidden until explicitly requested'
    Assert-MacroAction ([string]$homeSheet.Buttons().Item('btnShowBatch').OnAction) 'FurusatoQA.xlsm!BatchWithholding.ShowBatch' 'Batch entry button ownership'
    $excel.Run('BatchWithholding.ShowBatch')
    Assert-Value $batchSheet.Visible -1 'Batch sheet visible after explicit opening'
    $excel.Run('BatchWithholding.BatchReturnHome')
    Assert-Value $batchSheet.Visible 2 'Batch sheet hidden after return'
    Assert-MacroAction ([string]$homeSheet.Buttons().Item('btnTaxLawUpdate').OnAction) 'FurusatoQA.xlsm!TaxLawUpdater.TaxLawUpdate' 'Main case macro ownership'
    QA-Stage 'initial-recalculate-start'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    QA-Stage 'initial-recalculate-done'
    Assert-Value $checks.Range('B47').Value2 52 'Regression cases'
    Assert-Value $checks.Range('B49').Value2 'PASS' 'Regression verdict'
    Assert-Value $homeSheet.Range('B8').Value2 '' 'Blank input hides limit'
    Assert-Value $detail.Visible 2 'Calculation details start hidden'
    QA-Stage 'initial-regressions-pass'
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
    Assert-PrintConfiguration $detail 'Detail' '\$A\$1:\$D\$19'
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
            $homeSheet.Range('B12').Value2 = 7000000
            $excel.Run('TaxLawUpdater.RecalculateCase')
        }
        Assert-Value $homeSheet.Range('B14').Value2 $(if ($year -eq 2025) { 1630000 } else { 1670000 }) "$year computed total deductions"
        Assert-Value $homeSheet.Range('B8').Value2 109000 "$year donation estimate"
    }
    QA-Stage 'synthetic-years-pass'

    QA-Stage 'private-batch-import-invalid-path-start'
    # The private local acceptance entry point must fail quietly on an
    # invalid local source and never mutate the user's original workbook.
    $invalidSource = Join-Path $dir ('does_not_exist_' + [Guid]::NewGuid().ToString('N') + '.pdf')
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchImportLocalFile', $invalidSource))) $false 'Private batch rejects absent PDF without a dialog'
    Assert-Value ([int]$excel.Worksheets.Item('一括試算一覧').Range('A7').Value2) 0 'Failed private import leaves batch list empty'
    QA-Stage 'private-batch-import-invalid-path-pass'
    QA-Stage 'synthetic-five-page-ascii-bridge-import-start'
    # End-to-end VB parser + worksheet transfer using a fictional local
    # bridge, generated in the disposable QA directory. No actual clients.
    $bridgeFile = Join-Path $dir 'fictional_five_pages.tsv'
    $fixtureLines = [Collections.Generic.List[string]]::new()
    for ($ordinal = 1; $ordinal -le 5; $ordinal++) {
        $fixtureLines.Add("PAGE" + "`t" + [string]$ordinal)
        $fixtureLines.Add("STATUS" + "`t" + $(if ($ordinal -eq 4) { "REQUIRES_REVIEW" } else { "READY_FOR_EXCEL_CROSSCHECK" }))
        $fixtureLines.Add("YEAR" + "`t" + "2025")
        $fixtureLines.Add("WARNINGS" + "`t" + $(if ($ordinal -eq 4) { "INCOMPLETE_OR_UNVERIFIED" } else { "" }))
        $fixtureLines.Add("salary_gross" + "`t" + [string](5100000 + $ordinal * 100000))
        $fixtureLines.Add("salary_reference" + "`t" + [string](3600000 + $ordinal * 90000))
        $fixtureLines.Add("deductions_reference" + "`t" + "1400000")
        $fixtureLines.Add("income_tax_withheld" + "`t" + "100000")
        if ($ordinal -ne 4) { $fixtureLines.Add("social_insurance" + "`t" + "800000") }
        $fixtureLines.Add("ENDPAGE" + "`t" + [string]$ordinal)
    }
    [IO.File]::WriteAllText($bridgeFile, ($fixtureLines -join "`n") + "`n",
                            [System.Text.Encoding]::ASCII)
    $batch = $book.Worksheets.Item('一括試算一覧')
    $batch.Range('A7:AW26').ClearContents()
    if (-not [bool]($excel.Run('BatchWithholding.BatchImportBridgeForTest', $bridgeFile))) {
        $batchCode = [string]($excel.Run('BatchWithholding.BatchImportFailureCode'))
        throw ('Valid fictional 5-page bridge failed through VBA (' + $batchCode + ')')
    }
    for ($row = 7; $row -le 11; $row++) {
        Assert-Value $batch.Range('A'+$row).Value2 ([double]($row-6)) ('Bridge page '+($row-6))
        Assert-Value $batch.Range('C'+$row).Value2 2025.0 ('Bridge tax year '+($row-6))
        Assert-Value $batch.Range('F'+$row).Value2 'HOLD' ('Imported source held '+($row-6))
        Assert-BlankTaxAmount $batch.Range('E'+$row).Value2 ('No automatic limit '+($row-6))
    }
    Assert-Value $batch.Range('AE10').Value2 'REQUIRES_REVIEW' 'Fourth page requires review'
    Assert-BlankTaxAmount $batch.Range('N10').Value2 'Fourth page social insurance cannot be borrowed'
    Assert-Value $batch.Range('AE11').Value2 'READY_FOR_EXCEL_CROSSCHECK' 'Fifth page independent'
    $batch.Range('A7:AW26').ClearContents()
    QA-Stage 'synthetic-five-page-ascii-bridge-import-pass'
    QA-Stage 'synthetic-batch-restore-and-hold-start'
    # Only fictional money amounts in a throwaway QA XLSM. No real PDF.
    $batch = $book.Worksheets.Item('一括試算一覧')
    $baseBefore = @{}
    foreach ($addr in @('B4','B11','B12','B15','B16','B25','D22','D24')) {
        $baseBefore[$addr] = [string]$homeSheet.Range($addr).Formula
    }
    $extraCase = $book.Worksheets.Item('例外・分離課税')
    $extraBefore = @{}
    foreach ($addr in @('B14','B15','B19','B20','B32')) {
        $extraBefore[$addr] = [string]$extraCase.Range($addr).Formula
    }
    $batch.Range('A7:AW26').ClearContents()
    foreach ($row in @(7,8)) {
        $batch.Range('A'+$row).Value2 = [double]($row-6)
        $batch.Range('C'+$row).Value2 = 2026.0
        $batch.Range('D'+$row).Value2 = 7000000.0
        $batch.Range('K'+$row).Value2 = 5200000.0
        $batch.Range('L'+$row).Value2 = 1670000.0
        $batch.Range('M'+$row).Value2 = 285800.0
        $batch.Range('N'+$row).Value2 = 1000000.0
        $batch.Range('AG'+$row).Value2 = 0.0
        $batch.Range('AH'+$row).Value2 = 2.0
        $batch.Range('AI'+$row).Value2 = 2.0
        $batch.Range('AR'+$row).Value2 = 2.0
        $batch.Range('AE'+$row).Value2 = 'READY_FOR_EXCEL_CROSSCHECK'
        $batch.Range('AF'+$row).Value2 = ''
        $batch.Range('J'+$row).Value2 = '確定申告'
        $batch.Range('H'+$row).Value2 = '未確認'
        $batch.Range('I'+$row).Value2 = '未確認'
    }
    # A valid fictional taxpayer gets an amount; an unverified taxpayer
    # in the same PDF must never inherit the first person's attestation.
    $batch.Range('H7').Value2 = '照合済'
    $batch.Range('I7').Value2 = '未対応条件なし'
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Nonmodal batch calculation completed'
    Assert-Value $batch.Range('E7').Value2 109000 'Independent synthetic page 1 estimate'
    Assert-Value $batch.Range('F7').Value2 '概算' 'Page 1 calculation status'
    Assert-BlankTaxAmount $batch.Range('E8').Value2 'Unconfirmed page 2 has no tax amount'
    Assert-Value $batch.Range('F8').Value2 'HOLD' 'Page 2 remains HOLD'
    foreach ($addr in $baseBefore.Keys) {
        Assert-Value ([string]$homeSheet.Range($addr).Formula) $baseBefore[$addr] ('Original single-person input restored: '+$addr)
    }
    foreach ($addr in $extraBefore.Keys) {
        Assert-Value ([string]$extraCase.Range($addr).Formula) $extraBefore[$addr] ('Original advanced input restored: '+$addr)
    }
    $batch.Range('C7').Value2 = 2025.0
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Year mismatch evaluated safely'
    Assert-BlankTaxAmount $batch.Range('E7').Value2 'Mismatched-year page hides prior amount'
    Assert-Value $batch.Range('F7').Value2 'HOLD' 'Mismatched-year page is HOLD'
    $batch.Range('C7').Value2 = 2026.0
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Fresh batch restored for invalidation check'
    Assert-Value $batch.Range('E7').Value2 109000 'Recovered page can calculate again'
    $excel.Run('BatchWithholding.BatchInvalidate', $batch.Range('A7'))
    Assert-BlankTaxAmount $batch.Range('E7').Value2 'Editing source page ID invalidates estimate'
    Assert-Value $batch.Range('F7').Value2 'HOLD' 'Editing source page ID sets HOLD'
    Assert-Value $batch.Range('H7').Value2 '未確認' 'Source edits revoke prior attestation'
    Assert-Value $batch.Range('I7').Value2 '未確認' 'Source edits revoke applicability check'
    $batch.Range('A7:AW26').ClearContents()
    QA-Stage 'synthetic-five-page-batch-start'
    # Synthetic-only five-page acceptance mirrors a missing social-insurance
    # field in page 4 without embedding real source amounts or person names.
    foreach ($row in @(7,8,9,10,11)) {
        $batch.Range('A'+$row).Value2 = [double]($row-6)
        $batch.Range('C'+$row).Value2 = 2026.0
        $batch.Range('D'+$row).Value2 = 7000000.0
        $batch.Range('K'+$row).Value2 = 5200000.0
        $batch.Range('L'+$row).Value2 = 1670000.0
        $batch.Range('M'+$row).Value2 = 285800.0
        $batch.Range('AG'+$row).Value2 = 0.0
        $batch.Range('AH'+$row).Value2 = 2.0
        $batch.Range('AI'+$row).Value2 = 2.0
        $batch.Range('AR'+$row).Value2 = 2.0
        if ($row -ne 10) {
            $batch.Range('N'+$row).Value2 = 1000000.0
            $batch.Range('AE'+$row).Value2 = 'READY_FOR_EXCEL_CROSSCHECK'
        } else {
            $batch.Range('AE'+$row).Value2 = 'REQUIRES_REVIEW'
            $batch.Range('AF'+$row).Value2 = 'INCOMPLETE_OR_UNVERIFIED'
        }
        $batch.Range('J'+$row).Value2 = '確定申告'
        $batch.Range('H'+$row).Value2 = '照合済'
        $batch.Range('I'+$row).Value2 = '未対応条件なし'
    }
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Synthetic five-person batch completed'
    foreach ($row in @(7,8,9,11)) {
        Assert-Value $batch.Range('E'+$row).Value2 109000 ('Synthetic page '+($row-6)+' estimated separately')
        Assert-Value $batch.Range('F'+$row).Value2 '概算' ('Synthetic page '+($row-6)+' accepted status')
    }
    Assert-BlankTaxAmount $batch.Range('E10').Value2 'Missing social insurance page 4 must be HOLD'
    Assert-Value $batch.Range('F10').Value2 'HOLD' 'Missing social insurance page 4 status'
    $batch.Range('N10').Value2 = 1000000.0
    # A manual correction must never silently inherit the old checks.
    $batch.Range('H10').Value2 = '照合済'
    $batch.Range('I10').Value2 = '未対応条件なし'
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Reverified page 4 accepted for recomputation'
    Assert-Value $batch.Range('E10').Value2 109000 'Reverified synthetic fourth person receives own estimate'
    QA-Stage 'batch-mortgage-source-regression-start'
    # A standard residence-credit entry on a withholding slip is ordinary
    # tax data, not an unsupported deduction. Page 2 has a fictional 2024
    # occupancy year and one claim, with non-zero possible credit.
    $batch.Range('Q8').Value2 = 0.0
    $batch.Range('R8').Value2 = 5000.0
    $batch.Range('S8').Value2 = 2024.0
    $batch.Range('T8').Value2 = 1.0
    $batch.Range('AE8').Value2 = 'READY_FOR_EXCEL_CROSSCHECK'
    $batch.Range('AF8').Value2 = ''
    $batch.Range('H8').Value2 = '照合済'
    $batch.Range('I8').Value2 = '未対応条件なし'
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Ordinary mortgage batch calculation completed'
    Assert-Value $batch.Range('F8').Value2 '概算' 'Source-documented mortgage must not be blanket-HOLD'
    if ([double]$batch.Range('E8').Value2 -le 0) { throw 'Normal 2024 mortgage produced no estimate' }
    # A previously missing mortgage field can be filled from the source,
    # without remaining permanently blocked by its stale OCR warning.
    $batch.Range('AE8').Value2 = 'REQUIRES_REVIEW'
    $batch.Range('AF8').Value2 = 'MORTGAGE_APPLIED_CREDIT_MISSING;INCOMPLETE_OR_UNVERIFIED'
    $batch.Range('H8').Value2 = '照合済'
    $batch.Range('I8').Value2 = '未対応条件なし'
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Reconciled mortgage credit calculation completed'
    Assert-Value $batch.Range('F8').Value2 '概算' 'Reconciled mortgage can calculate after verification'
    # Multiple housing claims and older-year treatment require separate
    # evidence and must stay HOLD rather than guessed from year alone.
    $batch.Range('AF8').Value2 = 'MULTIPLE_MORTGAGE_CREDITS_REQUIRE_REVIEW;INCOMPLETE_OR_UNVERIFIED'
    $batch.Range('H8').Value2 = '照合済'
    $batch.Range('I8').Value2 = '未対応条件なし'
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Multiple mortgage review test completed'
    Assert-Value $batch.Range('F8').Value2 'HOLD' 'Multiple residence credits require review'
    Assert-BlankTaxAmount $batch.Range('E8').Value2 'No amount for unsupported multiple residence credits'
    QA-Stage 'batch-mortgage-source-regression-pass'
    $batch.Range('A7:AW26').ClearContents()
    QA-Stage 'synthetic-five-page-batch-pass'
    QA-Stage 'spouse-and-dependent-fail-closed-start'
    # Taxpayer 2 has a family deduction that is present in the source slip
    # but not yet carried through to resident-tax personal-deduction logic.
    # A synthetic confirmed input MUST NOT produce an incorrect limit.
    $batch.Range('A7').Value2 = 1.0
    $batch.Range('C7').Value2 = 2026.0
    $batch.Range('D7').Value2 = 7000000.0
    $batch.Range('K7').Value2 = 5200000.0
    $batch.Range('L7').Value2 = 1670000.0
    $batch.Range('M7').Value2 = 285800.0
    $batch.Range('N7').Value2 = 1000000.0
    $batch.Range('J7').Value2 = '確定申告'
    $batch.Range('H7').Value2 = '照合済'
    $batch.Range('I7').Value2 = '未対応条件なし'
    $batch.Range('AE7').Value2 = 'REQUIRES_REVIEW'
    $batch.Range('AF7').Value2 = 'FAMILY_DEDUCTION_NOT_TRANSFERRED;INCOMPLETE_OR_UNVERIFIED'
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true 'Family flag evaluated'
    Assert-Value $batch.Range('F7').Value2 'HOLD' 'Unmapped spouse/dependent case HOLD'
    Assert-BlankTaxAmount $batch.Range('E7').Value2 'Unmapped family cannot show donation estimate'
    $batch.Range('A7:AW26').ClearContents()
    QA-Stage 'spouse-and-dependent-fail-closed-pass'
    QA-Stage 'batch-standard-family-automatic-calculation-start'
    $batch.Range('A7:AW26').ClearContents()
    foreach ($case in @('spouse','general')) {
        $batch.Range('A7:AW26').ClearContents()
        $batch.Range('A7').Value2 = 1.0
        $batch.Range('C7').Value2 = 2026.0
        $batch.Range('D7').Value2 = 7000000.0
        $batch.Range('K7').Value2 = 5200000.0
        $batch.Range('L7').Value2 = 2100000.0
        $batch.Range('M7').Value2 = 220000.0
        $batch.Range('N7').Value2 = 1000000.0
        $batch.Range('J7').Value2 = '確定申告'
        $batch.Range('H7').Value2 = '照合済'
        $batch.Range('I7').Value2 = '未対応条件なし'
        $batch.Range('AE7').Value2 = 'READY_FOR_EXCEL_CROSSCHECK'
        $batch.Range('AF7').Value2 = ''
        $batch.Range('AG7').Value2 = 0.0
        $batch.Range('AH7').Value2 = 2.0
        $batch.Range('AI7').Value2 = 2.0
        $batch.Range('AR7').Value2 = 2.0
        if ($case -eq 'spouse') {
            # Regular year-end-adjusted spouse deduction, not spouse
            # SPECIAL deduction; matching source applied tax amount.
            $batch.Range('AG7').Value2 = 380000.0
            $batch.Range('AH7').Value2 = 1.0
            $batch.Range('AJ7').Value2 = 300000.0
        } else {
            $batch.Range('AN7').Value2 = 1.0
        }
        Assert-Value ([bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) $true ('Synthetic '+$case+' batch returned')
        Assert-Value $batch.Range('F7').Value2 '概算' ('Supported '+$case+' should not be held')
        $donation=[double]$batch.Range('E7').Value2
        if ($donation -lt 2000.0) {
            throw ('Supported '+$case+' yielded an invalid donation estimate')
        }
    }
    $batch.Range('A7:AW26').ClearContents()
    QA-Stage 'batch-standard-family-automatic-calculation-pass'

    # Regression: Excel must distinguish numeric zero from an empty spouse
    # income cell. A regular spouse with income 0 still receives the normal
    # 380k income-tax and 330k resident-tax deductions. Synthetic-only.
    QA-Stage 'zero-income-spouse-tax-table-start'
    $savedMasterYear = $settings.Range('B4').Value2
    $savedHomeYear = $homeSheet.Range('B4').Value2
    $savedIncomeYear = $homeSheet.Range('B11').Value2
    $savedSalary = $homeSheet.Range('B12').Value2
    $savedSpouse = $homeSheet.Range('D17').Value2
    $savedElderSpouse = $homeSheet.Range('D18').Value2
    try {
        $settings.Range('B4').Value2 = 2025.0
        $homeSheet.Range('B4').Value2 = 2025.0
        $homeSheet.Range('B11').Value2 = 2025.0
        $homeSheet.Range('B12').Value2 = 7600000.0
        $homeSheet.Range('D18').ClearContents()
        $calcSheet = $book.Worksheets.Item('ふるさと納税限度額計算')
        foreach ($spouseIncome in @(0.0, 300000.0)) {
            $homeSheet.Range('D17').Value2 = $spouseIncome
            $excel.CalculateFull()
            Assert-Value ([double]$calcSheet.Range('F36').Value2) 380000.0 ('Ordinary spouse income-tax deduction / ' + $spouseIncome)
            Assert-Value ([double]$calcSheet.Range('H36').Value2) 330000.0 ('Ordinary spouse resident-tax deduction / ' + $spouseIncome)
        }
    }
    finally {
        $settings.Range('B4').Value2 = $savedMasterYear
        $homeSheet.Range('B4').Value2 = $savedHomeYear
        $homeSheet.Range('B11').Value2 = $savedIncomeYear
        $homeSheet.Range('B12').Value2 = $savedSalary
        $homeSheet.Range('D17').Value2 = $savedSpouse
        $homeSheet.Range('D18').Value2 = $savedElderSpouse
        $excel.CalculateFull()
    }
    QA-Stage 'zero-income-spouse-tax-table-pass'

    QA-Stage 'synthetic-batch-restore-and-hold-pass'

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
    Assert-Value $homeSheet.Range('B14').Value2 3800000 'Source deduction total preferred'
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
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Ordinary listed shares declared split case'
    $extraSheet.Range('B24').Value2 = 500000.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B27').Value2 25000 'Screenshot listed shares 500k resident levy'
    Assert-Value $residentSheet.Range('B16').Value2 ($regularLevy+25000) 'Screenshot total resident levy'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Screenshot mixed salary plus stocks'
    $extraSheet.Range('B25').Value2 = '土地建物短期'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $extraSheet.Range('B27').Value2 45000 'Standard short land resident levy'
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Standard short land tax case'
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
    $sourceExtra.Range('B14').Value2 = 5100000.0
    $extraSheet.Range('B24').Value2 = 20000000.0
    $extraSheet.Range('B25').Value2 = '上場株式'
    $extraSheet.Range('B33').Value2 = 'なし'
    $extraSheet.Range('B36').Value2 = 20000000.0
    $homeSheet.Range('B33:B36').ClearContents()
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert-Value $homeSheet.Range('B28').Value2 '正常' 'Ordinary plus split supported'
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
    Assert-Value $homeSheet.Range('B8').Value2 $candidate 'Donation ceiling uses the split solver'
    Assert-Value $homeSheet.Range('B26').Value2 '計算可能' 'Mixed case was automatically accepted'
    $sourceExtra.Range('B14').ClearContents()
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
    $excel.Run('BatchWithholding.BindButtons')
    Assert-Value ([bool]($excel.Run('BatchWithholding.BatchReadyForTest'))) $true 'Reopened batch macro ownership'
    Assert-MacroAction ([string]$homeSheet.Buttons().Item('btnShowBatch').OnAction) 'FurusatoQA.xlsm!BatchWithholding.ShowBatch' 'Reloaded batch entry macro'
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
