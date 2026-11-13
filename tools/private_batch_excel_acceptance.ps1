#Requires -Version 5.1
<#
  Offline, private, READ-ONLY acceptance for a real multi-page payslip PDF.
  Does not send, persist, print, or log names, money, PDF bytes, paths,
  source hash, OCR text or Excel cell values. Uses a disposable XLSM+EXE copy.
  The source PDF and original XLSM are opened read-only/copy-only.
  Run on a Windows desktop with Excel 365 and the unpacked review ZIP.
#>
[CmdletBinding()]
param(
    [string]$Pdf = '',
    [string]$Workbook = '',
    [string]$Reader = '',
    [ValidateRange(1,20)][int]$ExpectedPages = 5
)
$ErrorActionPreference = 'Stop'
$stage = 'preflight'
$excel = $null; $book = $null; $batch = $null
$temp = ''
$pass = $false
try {
    if ([string]::IsNullOrWhiteSpace($Pdf)) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = 'ローカル検証：複数ページの源泉徴収票PDFを選択'
        $dialog.Filter = 'PDF (*.pdf)|*.pdf'
        $dialog.Multiselect = $false
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
            Write-Output 'PRIVATE_BATCH_CANCELLED: ファイル選択なし'
            return
        }
        $Pdf = $dialog.FileName
    }
    if ([string]::IsNullOrWhiteSpace($Workbook)) {
        $Workbook = Join-Path $PSScriptRoot 'Furusato_nouzei.xlsm'
    }
    if ([string]::IsNullOrWhiteSpace($Reader)) {
        $Reader = Join-Path $PSScriptRoot 'FurusatoDocumentReader.exe'
    }
    if (-not (Test-Path -LiteralPath $Pdf -PathType Leaf) -or
        -not (Test-Path -LiteralPath $Workbook -PathType Leaf) -or
        -not (Test-Path -LiteralPath $Reader -PathType Leaf)) {
        throw 'INPUT_MISSING'
    }
    if ([IO.Path]::GetExtension($Pdf).ToLowerInvariant() -ne '.pdf') {
        throw 'NOT_PDF'
    }
    if ((Get-Item -LiteralPath $Pdf).Length -gt 25MB) {
        throw 'FILE_TOO_LARGE'
    }
    # Do not open or modify the actual workbook in the user's work folder.
    $stage = 'isolated-copy'
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('FurusatoPrivateReview_' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temp)
    $tempBook = Join-Path $temp 'FurusatoPrivateReview.xlsm'
    Copy-Item -LiteralPath $Workbook -Destination $tempBook -Force
    Copy-Item -LiteralPath $Reader -Destination (Join-Path $temp 'FurusatoDocumentReader.exe') -Force

    $stage = 'excel-open'
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 1  # Low ONLY during open of isolated local QA copy
    $book = $excel.Workbooks.Open($tempBook, 0, $false)
    $excel.AutomationSecurity = 3  # Disable any macros from later workbooks
    $batch = $book.Worksheets.Item('一括試算一覧')
    if ($null -eq $batch) { throw 'BATCH_SHEET_MISSING' }

    $stage = 'local-reader-and-vba-import'
    # This procedure invokes ONLY the adjacent local reader EXE and reads
    # its ASCII numeric bridge. No cloud/browser request or GitHub upload.
    if (-not [bool]($excel.Run('BatchWithholding.BatchImportLocalFile', $Pdf))) {
        throw 'BATCH_IMPORT_REJECTED'
    }

    $stage = 'check-all-person-rows'
    $records = @()
    $fields = @(
        @{col='D'; name='支払金額'},
        @{col='K'; name='給与所得控除後'},
        @{col='L'; name='所得控除の合計'},
        @{col='M'; name='源泉徴収税額'},
        @{col='N'; name='社会保険料等'}
    )
    for ($i = 7; $i -le 26; $i++) {
        $rawPage = $batch.Range('A' + $i).Value2
        if ($null -eq $rawPage -or [string]$rawPage -eq '') { break }
        $index = $i - 6
        if ([int]$rawPage -ne $index) { throw 'PAGE_ORDER_MISMATCH' }
        $taxYear = $batch.Range('C' + $i).Value2
        $sourceYear = $batch.Range('AX' + $i).Value2
        if ($null -eq $sourceYear -or [int]$sourceYear -notin @(2025,2026)) { throw 'SOURCE_YEAR_UNVERIFIED' }
        $missing = @()
        foreach ($field in $fields) {
            $raw = $batch.Range($field.col + $i).Value2
            if ($null -eq $raw -or [string]$raw -eq '') {
                $missing += $field.name
            }
        }
        # Never accept any estimate before independent human review.
        if ([string]$batch.Range('F' + $i).Value2 -ne 'HOLD' -or
            $null -ne $batch.Range('E' + $i).Value2 -or
            [string]$batch.Range('H' + $i).Value2 -ne '未確認' -or
            [string]$batch.Range('I' + $i).Value2 -ne '未確認') {
            throw 'AUTO_APPROVAL_DETECTED'
        }
        # Only enumerated status and field presence; no personal details.
        $state = [string]$batch.Range('AE' + $i).Value2
        if ($state -notin @('READY_FOR_EXCEL_CROSSCHECK','REQUIRES_REVIEW')) {
            throw 'UNKNOWN_SOURCE_STATUS'
        }
        $records += [pscustomobject]@{
            page = $index
            targetTaxYear = [int]$taxYear
            referenceSlipYear = [int]$sourceYear
            fieldMissing = @($missing)
            sourceReview = $(if ($state -eq 'READY_FOR_EXCEL_CROSSCHECK') {'PROVISIONAL'} else {'REVIEW'})
            estimate = 'HOLD'
        }
    }
    if ($records.Count -ne $ExpectedPages) { throw 'EXPECTED_PAGE_COUNT_MISMATCH' }
    $pass = $true
    Write-Output 'PRIVATE_BATCH_LOCAL_ACCEPTANCE_PASS'
    # Neither names, numerical amounts, original PDF bytes, file paths nor
    # PDF hash are ever printed. Reporting contains only field presence.
    [pscustomobject]@{
        pageCount = $records.Count
        rows = $records
        originalWorkbookModified = $false
        privateDataUploaded = $false
        allEstimatesHeldUntilHumanVerification = $true
    } | ConvertTo-Json -Depth 5
}
catch {
    # The exception could embed a local path or a source parser error.
    # Show only a fixed stage marker; do not leak exception details.
    Write-Output ('PRIVATE_BATCH_LOCAL_ACCEPTANCE_HOLD; stage=' + $stage)
    $global:LASTEXITCODE = 1
}
finally {
    $stage = 'cleanup'
    if ($null -ne $book) {
        try { $book.Close($false) } catch {}
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) } catch {}
    }
    if ($null -ne $batch) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($batch) } catch {}
    }
    if ($null -ne $excel) {
        try { $excel.AutomationSecurity = 3 } catch {}
        try { $excel.Quit() } catch {}
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($temp -ne '' -and (Test-Path -LiteralPath $temp)) {
        try { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction Stop } catch {
            Write-Output 'PRIVATE_BATCH_CLEANUP_HOLD: 一時コピーを手動削除してください。'
        }
    }
}
if (-not $pass) { exit 1 }
