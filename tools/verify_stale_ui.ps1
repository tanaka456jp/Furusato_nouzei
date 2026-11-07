#Requires -Version 5.1
# Dedicated Windows self-hosted Excel runner: synthetic, isolated and no network.
param([Parameter(Mandatory=$true)][string]$Workbook)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Workbook).Path
$folder = Join-Path ([IO.Path]::GetTempPath()) ('furusato-stale-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($folder)
$copy = Join-Path $folder 'StaleSafety.xlsm'
[IO.File]::Copy($source,$copy)
$excel=$null;$book=$null;$home=$null;$settings=$null
$passed=$false
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $excel.Visible = $false
    $excel.AutomationSecurity = 1
    $excel.EnableEvents = $false
    $excel.Calculation = -4105 # automatic
    $book = $excel.Workbooks.Open($copy,0,$false)
    $excel.AutomationSecurity = 3
    $home = $book.Worksheets.Item('操作画面')
    $settings = $book.Worksheets.Item('設定・税率')
    $settings.Range('B4').Value2 = 2026.0
    $home.Range('B4').Value2 = 2026.0
    $home.Range('B11').Value2 = 2026.0
    $home.Range('B12').Value2 = 7000000.0
    $home.Range('B15').Value2 = 285800.0
    $home.Range('B16').Value2 = 1000000.0
    $home.Range('B25').Value2 = 'なし'
    $home.Range('D22').Value2 = '該当なし'
    $home.Range('D24').Value2 = '確定申告'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$home.Range('B28').Value2 -ne '正常' -or [int]$home.Range('B8').Value2 -ne 109000) {
        throw 'Baseline synthetic result was not 109000'
    }
    $excel.EnableEvents = $true
    $excel.Calculation = -4135 # manual
    $home.Range('B34').Value2 = 300000.0
    if ([string]$home.Range('B8').Text -ne '') { throw 'Stale donation still displayed while manual' }
    if ([string]$home.Range('B26').Text -eq '計算可能') { throw 'Stale eligibility still displayed' }
    if ([string]$home.Range('A9').Text -notlike '*計算未完了*') { throw 'Missing recalculation warning' }
    $badPdf = Join-Path $folder 'unsafe.pdf'
    if ([bool]$excel.Run('TaxLawUpdater.TryExportDetailsToFileForTest',$badPdf)) {
        throw 'PDF permitted without verified calculation'
    }
    if (Test-Path -LiteralPath $badPdf) { throw 'Unexpected stale PDF created' }
    $home.Range('B34').ClearContents()
    $excel.Calculation = -4105
    $excel.Run('TaxLawUpdater.RecalculateCase')
    if ([string]$home.Range('B26').Text -ne '計算可能' -or
        [int]$home.Range('B8').Value2 -ne 109000 -or
        [string]$home.Range('B8').Text -ne '109,000') {
        throw 'Automatic calculation did not safely restore output'
    }
    $passed=$true
    Write-Output 'STALE_RESULTS_REAL_EXCEL_PASS: manual masked, PDF refused, auto restored; synthetic only'
} finally {
    if ($null -ne $book) { try { $book.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($settings,$home,$book,$excel)) {
        try {
            if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not $passed) { throw 'Stale output safety gate failed' }
