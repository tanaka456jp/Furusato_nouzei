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
    $home.Range('B4').Value2 = 2027.0
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
    $book.Save()
    Write-Output 'PASS: Windows Excel workbook calculation, 52 fixtures, two reference cases, fail-closed display and PDF.'
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
