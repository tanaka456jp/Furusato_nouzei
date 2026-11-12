#Requires -Version 5.1
<#
  PRIVATE, offline, five-person numerical acceptance.
  The PDF and private oracle CSV must stay on the user's Windows PC.
  Do NOT add the oracle, PDF, workbook output, raw amounts, or source hashes
  to GitHub Actions or diagnostic logs. This test checks calculations under
  explicit QA assumptions; it is not a taxpayer attestation.
  Only a disposable copy of the workbook/reader is modified.
#>
[CmdletBinding()]
param(
    [string]$Pdf = '',
    [string]$Workbook = '',
    [string]$Reader = '',
    [string]$OracleCsv = '',
    [ValidateRange(1,20)][int]$ExpectedPages = 5,
    [switch]$QaAssumeNoOutsideIncome
)
$ErrorActionPreference = 'Stop'
$stage = 'inputs'
$excel = $null; $book = $null; $batch = $null
$temp = ''
$pass = $false
$verifiedRows = @()
try {
    if (-not $QaAssumeNoOutsideIncome) {
        throw 'QA_ASSUMPTION_REQUIRED'
    }
    if (-not $Pdf) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = 'Private five-person PDF test'
        $dialog.Filter = 'PDF (*.pdf)|*.pdf'
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
            throw 'SOURCE_NOT_SELECTED'
        }
        $Pdf = $dialog.FileName
    }
    if (-not $Workbook) { $Workbook = Join-Path $PSScriptRoot 'Furusato_nouzei.xlsm' }
    if (-not $Reader) { $Reader = Join-Path $PSScriptRoot 'FurusatoDocumentReader.exe' }
    if (-not $OracleCsv) { $OracleCsv = Join-Path $PSScriptRoot 'private_5person_oracle.csv' }
    foreach ($file in @($Pdf,$Workbook,$Reader,$OracleCsv)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'LOCAL_FILE_MISSING' }
    }
    if ([IO.Path]::GetExtension($Pdf).ToLowerInvariant() -ne '.pdf') {
        throw 'INVALID_PDF'
    }
    if ([IO.Path]::GetExtension($OracleCsv).ToLowerInvariant() -ne '.csv') {
        throw 'INVALID_ORACLE'
    }
    if ((Get-Item -LiteralPath $Pdf).Length -gt 25MB -or
        (Get-Item -LiteralPath $OracleCsv).Length -gt 16KB) {
        throw 'INPUT_SIZE_INVALID'
    }
    $sourceHash = (Get-FileHash -LiteralPath $Workbook -Algorithm SHA256).Hash
    $oracle = @(Import-Csv -LiteralPath $OracleCsv -Encoding ASCII)
    if ($oracle.Count -ne $ExpectedPages) { throw 'ORACLE_PAGE_COUNT' }
    $columns = [ordered]@{
        year='C'; salary_gross='D'; salary_income='K'
        deductions_total='L'; tax_withheld='M'; social_insurance='N'
        life_deduction='O'; earthquake_deduction='P'
        spouse_tax_deduction='AG'; spouse_flag='AH'
        elderly_spouse_flag='AI'; secondary_spouse_flag='AR'
        spouse_income='AJ'; under16_count='AB'
        mortgage_credit='Q'; mortgage_possible_credit='R'
        mortgage_occupancy_year='S'; mortgage_claim_count='T'
    }
    for ($i=0; $i -lt $oracle.Count; $i++) {
        $rec = $oracle[$i]
        if ([string]$rec.page -cne [string]($i+1)) { throw 'ORACLE_PAGE_ORDER' }
        foreach ($columnName in $columns.Keys) {
            $raw = [string]($rec.$columnName)
            if ($raw -cne 'BLANK' -and $raw -cnotmatch '^(0|[1-9][0-9]{0,11})$') {
                throw 'ORACLE_FIELD_INVALID'
            }
        }
        $status = [string]$rec.expect_status
        $limit = [string]$rec.expect_limit
        if ($status -cnotin @('ESTIMATE','HOLD')) { throw 'ORACLE_STATUS_INVALID' }
        if (($status -ceq 'HOLD' -and $limit -cne 'BLANK') -or
            ($status -ceq 'ESTIMATE' -and $limit -cnotmatch '^[1-9][0-9]{0,11}$')) {
            throw 'ORACLE_LIMIT_INVALID'
        }
        if ([string]$rec.year -cne '2025') { throw 'ORACLE_YEAR_UNAPPROVED' }
    }
    $stage = 'isolated-copy'
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('FurusatoPrivateOracle_' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temp)
    $tempBook = Join-Path $temp 'FurusatoPrivateOracle.xlsm'
    Copy-Item -LiteralPath $Workbook -Destination $tempBook -Force
    Copy-Item -LiteralPath $Reader -Destination (Join-Path $temp 'FurusatoDocumentReader.exe') -Force

    $stage = 'excel-open'
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    # Enable macros ONLY for this local, disposable QA workbook.
    $excel.AutomationSecurity = 1
    $book = $excel.Workbooks.Open($tempBook, 0, $false)
    $excel.AutomationSecurity = 3
    $batch = $book.Worksheets.Item('一括試算一覧')
    $home = $book.Worksheets.Item('操作画面')
    $settings = $book.Worksheets.Item('設定・税率')
    $checks = $book.Worksheets.Item('自動回帰テスト')
    if (-not [bool]($excel.Run('BatchWithholding.BatchReadyForTest'))) {
        throw 'BATCH_MODULE_MISSING'
    }

    $stage = '2025-master'
    # QA copy only. Year-switch coverage is already exercised separately
    # by the normal Windows Excel acceptance workflow.
    $settings.Range('B4').Value2 = 2025.0
    $home.Range('B4').Value2 = 2025.0
    $excel.Run('TaxLawUpdater.RecalculateCase')
    $checks.Calculate()
    if ([string]$checks.Range('B49').Value2 -ne 'PASS') {
        throw 'TAX_MASTER_REGRESSION_FAIL'
    }

    $stage = 'private-pdf-import'
    if (-not [bool]($excel.Run('BatchWithholding.BatchImportLocalFile',$Pdf))) {
        throw 'IMPORT_FAIL'
    }
    if ([int]$excel.WorksheetFunction.CountA($batch.Range('A7:A26')) -ne $ExpectedPages) {
        throw 'IMPORTED_PAGE_COUNT'
    }

    $stage = 'source-field-reconciliation'
    for ($i=0; $i -lt $oracle.Count; $i++) {
        $stage = 'source-field-reconciliation-page-' + [string]($i+1)
        $rec = $oracle[$i]
        $row = $i+7
        if ([int]$batch.Range('A'+$row).Value2 -ne $i+1) {
            throw 'IMPORTED_PAGE_ORDER'
        }
        if ([string]$batch.Range('F'+$row).Value2 -cne 'HOLD' -or
            $null -ne $batch.Range('E'+$row).Value2 -or
            [string]$batch.Range('H'+$row).Value2 -cne '未確認' -or
            [string]$batch.Range('I'+$row).Value2 -cne '未確認') {
            throw 'PREMATURE_APPROVAL'
        }
        foreach ($field in $columns.Keys) {
            $expected = [string]($rec.$field)
            $actual = $batch.Range($columns[$field] + $row).Value2
            if ($expected -ceq 'BLANK') {
                if ($null -ne $actual -and [string]$actual -cne '') {
                    throw 'SOURCE_FIELD_MISMATCH'
                }
            } elseif ($null -eq $actual -or [string]$actual -ceq '' -or
                      -not ($actual -is [ValueType]) -or
                      [decimal]$actual -ne [decimal]::Parse($expected, [Globalization.CultureInfo]::InvariantCulture)) {
                throw 'SOURCE_FIELD_MISMATCH'
            }
        }
        # These two flags are QA assumptions only. The source PDF cannot
        # certify undeclared income, additional deductions or filing mode.
        if ([string]$rec.expect_status -ceq 'ESTIMATE') {
            if ([string]$batch.Range('AE'+$row).Value2 -cne 'READY_FOR_EXCEL_CROSSCHECK') {
                throw 'SOURCE_REQUIRES_REVIEW'
            }
            $batch.Range('H'+$row).Value2 = '照合済'
            $batch.Range('I'+$row).Value2 = '未対応条件なし'
        }
    }

    $stage = 'excel-calculate'
    if (-not [bool]($excel.Run('BatchWithholding.BatchCalculateForTest'))) {
        throw 'EXCEL_BATCH_FAIL'
    }
    $stage = 'compare-private-oracle'
    for ($i=0; $i -lt $oracle.Count; $i++) {
        $stage = 'compare-private-oracle-page-' + [string]($i+1)
        $rec = $oracle[$i]
        $row = $i+7
        $status = [string]$batch.Range('F'+$row).Value2
        $amount = $batch.Range('E'+$row).Value2
        if ([string]$rec.expect_status -ceq 'HOLD') {
            if ($status -cne 'HOLD' -or
                ($null -ne $amount -and [string]$amount -cne '')) {
                throw 'EXPECTED_HOLD_NOT_ENFORCED'
            }
            $verifiedRows += [pscustomobject]@{page=$i+1; result='SAFE_HOLD'}
        } else {
            if ($status -cne '概算' -or
                $null -eq $amount -or
                [decimal]$amount -ne [decimal]::Parse([string]$rec.expect_limit, [Globalization.CultureInfo]::InvariantCulture)) {
                throw 'ESTIMATE_DIFFERENCE'
            }
            $verifiedRows += [pscustomobject]@{page=$i+1; result='ESTIMATE_MATCH'}
        }
    }
    $stage = 'original-preservation'
    if ((Get-FileHash -LiteralPath $Workbook -Algorithm SHA256).Hash -cne $sourceHash) {
        throw 'SOURCE_WORKBOOK_CHANGED'
    }
    $pass = $true
}
catch {
    # Exception detail might include filenames, PDF contents, or monetary data.
    Write-Output ('PRIVATE_5PERSON_NUMERIC_ACCEPTANCE_HOLD; stage=' + $stage)
}
finally {
    if ($null -ne $book) {
        try { $book.Close($false) } catch {}
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) } catch {}
    }
    if ($null -ne $batch) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($batch) } catch {}
    }
    if ($null -ne $excel) {
        try { $excel.AutomationSecurity = 3; $excel.Quit() } catch {}
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($temp -and (Test-Path -LiteralPath $temp)) {
        try { Remove-Item -LiteralPath $temp -Recurse -Force } catch {
            Write-Output 'PRIVATE_5PERSON_CLEANUP_HOLD'
            $pass = $false
        }
    }
}
if (-not $pass) { exit 1 }
# Publish PASS only after original integrity check AND temporary-file cleanup.
Write-Output 'PRIVATE_5PERSON_NUMERIC_ACCEPTANCE_PASS'
[pscustomobject]@{
    incomeYear=2025
    pageCount=$ExpectedPages
    results=$verifiedRows
    oracleSource='LOCAL_PRIVATE_CSV'
    noOutsideIncome='QA_ASSUMPTION_ONLY'
    actualTaxpayerEligibility='NOT_CERTIFIED'
    personalDataUploaded=$false
    originalWorkbookModified=$false
} | ConvertTo-Json -Depth 4
exit 0
