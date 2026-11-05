#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$WorkbookPath = (Join-Path $PSScriptRoot 'ふるさと納税限度額計算_ワンクリック更新.xlsx')
)
$ErrorActionPreference = 'Stop'
$workbookPathFull = [IO.Path]::GetFullPath($WorkbookPath)
$modulePath = Join-Path $PSScriptRoot 'TaxLawUpdater.bas'
if (!(Test-Path -LiteralPath $workbookPathFull -PathType Leaf)) { throw "Excelファイルがありません: $workbookPathFull" }
if (!(Test-Path -LiteralPath $modulePath -PathType Leaf)) { throw "VBAモジュールがありません: $modulePath" }
$outPath = [IO.Path]::ChangeExtension($workbookPathFull, '.xlsm')
if (Test-Path -LiteralPath $outPath) { throw "同名の.xlsmが既にあります。既存ファイル保護のため停止: $outPath" }
$excel = $null; $book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $book = $excel.Workbooks.Open($workbookPathFull, 0, $false)
  if ($null -eq $book.Worksheets.Item('操作画面')) { throw '操作画面シートがありません。' }
  try { $null = $book.VBProject.VBComponents.Count }
  catch { throw 'Excelの「VBAプロジェクト オブジェクトモデルへのアクセスを信頼する」を有効化してください。' }
  $book.SaveAs($outPath, 52)
  $module = $book.VBProject.VBComponents.Import($modulePath)
  if ($null -eq $module) { throw 'VBAモジュールの組み込みに失敗しました。' }
  $sheet = $book.Worksheets.Item('操作画面')
  $r = $sheet.Range('A8:C9')
  $btn = $sheet.Buttons().Add($r.Left + 4, $r.Top + 2, $r.Width - 8, $r.Height - 4)
  $btn.Name = 'btnTaxLawUpdate'
  $btn.OnAction = "'" + $book.Name + "'!TaxLawUpdater.TaxLawUpdate"
  $btn.Characters().Text = '税制を更新'
  $btn.Font.Size = 13
  $btn.Font.Bold = $true
  foreach ($entry in @(@('B17','源泉徴収票入力'), @('B18','ふるさと納税限度額計算'), @('B19','追加人的控除'), @('B20','住民税再計算'), @('B21','整合性チェック'))) {
    $cell = $sheet.Range($entry[0])
    [void]$sheet.Hyperlinks.Add($cell, '', "'" + $entry[1] + "'!A1", '', [string]$cell.Value2)
  }
  $book.Worksheets.Item('操作画面').Activate()
  # Reduce clipping of the compact 4-column home screen on high-DPI Windows displays.
  $excel.ActiveWindow.Zoom = 75
  $visibleTabs = @('操作画面','源泉徴収票入力','ふるさと納税限度額計算','追加人的控除','住民税再計算','整合性チェック')
  foreach ($ws in $book.Worksheets) {
    if ($visibleTabs -contains [string]$ws.Name) { $ws.Visible = -1 }
    else { $ws.Visible = 2 }
  }
  $book.Save()
  Write-Host "作成完了: $outPath" -ForegroundColor Green
  Write-Host '以後は操作画面の適用年を選び「税制を更新」を押してください。'
}
catch {
  if ($book -ne $null) { try { $book.Close($false) } catch {} ; $book = $null }
  if (Test-Path -LiteralPath $outPath) { Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue }
  throw
}
finally {
  if ($book -ne $null) { try { $book.Close($true) } catch {} }
  if ($excel -ne $null) { try { $excel.Quit() } catch {} }
  foreach ($o in @($btn, $r, $sheet, $module, $book, $excel)) {
    if ($null -ne $o -and [Runtime.InteropServices.Marshal]::IsComObject($o)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($o)
    }
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}