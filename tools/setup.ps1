#Requires -Version 5.1
# Encoding: UTF-8 BOM (PowerShell 5.1). First-run installer on Excel 365 Windows.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$phase = '初期化'
$folder = $PSScriptRoot
$source = Join-Path $folder 'Furusato_nouzei.xlsx'
$final = Join-Path $folder 'Furusato_nouzei.xlsm'
$moduleUtf8 = Join-Path $folder 'TaxLawUpdater.bas'
$logFile = Join-Path $folder 'setup.log'
$utf8 = New-Object System.Text.UTF8Encoding($true)
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$excel = $null; $workbook = $null; $tempBook = $null
$button = $null; $sheet = $null; $anchor = $null; $component = $null
try { [System.IO.File]::WriteAllText($logFile, ('Furusato_nouzei setup v4 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "`r`n"), $utf8) }
catch { Write-Host ('Unable to create setup.log: ' + $_.Exception.Message); exit 10 }
function Log([string]$message) {
    $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] [' + $script:phase + '] ' + $message
    [System.IO.File]::AppendAllText($script:logFile, $line + "`r`n", $script:utf8)
    Write-Host $line
}
function Assert([bool]$ok, [string]$message) {
    if (-not $ok) { throw [System.Exception]::new($message) }
}
$code = 1
try {
    Log '開始。入力ファイルは上書きしません。'
    $phase = 'ファイル存在確認'
    Assert (Test-Path -LiteralPath $source -PathType Leaf) "Furusato_nouzei.xlsx が見つかりません。"
    Assert (Test-Path -LiteralPath $moduleUtf8 -PathType Leaf) "TaxLawUpdater.bas が見つかりません。"
    Assert (-not (Test-Path -LiteralPath $final)) "同名の出力ブックが既に存在します（上書きしません）。"
    $phase = 'VBA Unicode読込'
    Log 'UTF-8 VBAをUnicodeのまま読み込みます。WindowsのANSIコードページには依存しません。'
    $sourceVba = [System.IO.File]::ReadAllText($moduleUtf8, $strictUtf8)
    if ($sourceVba.Length -gt 0 -and $sourceVba[0] -eq [char]0xFEFF) {
        $sourceVba = $sourceVba.Substring(1)
    }
    Assert ($sourceVba.StartsWith('Attribute VB_Name = "TaxLawUpdater"')) 'VBAソースの属性名が不正です。'
    $sourceBody = [System.Text.RegularExpressions.Regex]::Replace(
        $sourceVba, '^Attribute VB_Name = "TaxLawUpdater"\r?\n', '')
    Assert (-not $sourceBody.StartsWith('Attribute VB_Name')) 'VBA属性行の取り除きに失敗しました。'
    Assert ($sourceBody.Contains('Public Sub TaxLawUpdate()')) '税制更新の実行プロシージャがありません。'
    $phase = 'Excel起動'
    Log 'Microsoft Excel (COM) を起動します。'
    $excel = New-Object -ComObject Excel.Application
    Assert ($null -ne $excel) 'ExcelのCOM起動に失敗しました。'
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    $excel.AutomationSecurity = 3
    $phase = '入力ブック読込'
    Log 'Excelブックを読込中です。'
    $workbook = $excel.Workbooks.Open($source, 0, $true)
    Assert ($null -ne $workbook) 'Excelブックを開けませんでした。'
    $phase = 'VBAプロジェクト権限'
    try {
        $count = $workbook.VBProject.VBComponents.Count
        Log ('VBAプロジェクトへのアクセス: OK（コンポーネント ' + $count + '個）')
    } catch {
        throw [System.Exception]::new('VBAプロジェクトへのアクセスが拒否されました。Excel [ファイル]→[オプション]→[トラストセンター]→[トラストセンターの設定]→[マクロの設定]→[VBAプロジェクト オブジェクトモデルへのアクセスを信頼する] を確認してください。組織で禁止されている場合は管理者に相談してください。内部エラー: ' + $_.Exception.Message)
    }
    $phase = '一時xlsm保存'
    $tempBook = Join-Path $folder ('_furusato_build_' + [Guid]::NewGuid().ToString('N') + '.xlsm')
    $workbook.SaveAs($tempBook, 52)
    Assert (Test-Path -LiteralPath $tempBook -PathType Leaf) 'Excelの.xlsm保存に失敗しました。'
    $phase = 'VBA Unicodeモジュール登録'
    Log 'Unicode VBAを標準モジュールへ登録します。'
    $component = $workbook.VBProject.VBComponents.Add(1) # vbext_ct_StdModule
    Assert ($null -ne $component) 'VBA標準モジュールを作成できませんでした。'
    $component.Name = 'TaxLawUpdater'
    $component.CodeModule.AddFromString($sourceBody)
    Assert ($component.CodeModule.CountOfLines -gt 50) 'VBAソースを登録できませんでした。'
    Assert ([string]$component.Name -eq 'TaxLawUpdater') ('予期しないVBAモジュール名です: ' + $component.Name)
    $phase = '再計算イベント登録'
    $eventCode = @'

Private Sub Workbook_Open()
    TaxLawUpdater.ReturnHome
    Application.Calculate
End Sub

Private Sub Workbook_SheetChange(ByVal Sh As Object, ByVal Target As Range)
    If Sh Is Me.Worksheets(1) Then Application.Calculate
End Sub
'@
    $bookModule = $workbook.VBProject.VBComponents.Item($workbook.CodeName).CodeModule
    try { $bookModule.AddFromString($eventCode) }
    finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($bookModule) }
    $phase = '操作ボタン登録'
    function Add-WorkbookButton($target, [string]$address, [string]$caption, [string]$macro) {
        $area = $null; $control = $null
        try {
            $area = $target.Range($address)
            $control = $target.Buttons().Add($area.Left + 2, $area.Top + 2, $area.Width - 4, $area.Height - 4)
            $control.Name = 'btn' + $macro
            $control.OnAction = 'TaxLawUpdater.' + $macro
            $control.Characters().Text = $caption
        } finally {
            foreach ($obj in @($control, $area)) {
                if ($null -ne $obj) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj) }
            }
        }
    }
    $sheet = $workbook.Worksheets.Item('操作画面')
    Add-WorkbookButton $sheet 'A5' '税制を更新' 'TaxLawUpdate'
    Add-WorkbookButton $sheet 'A7' '新規入力' 'NewCase'
    Add-WorkbookButton $sheet 'B7' '案件保存' 'SaveCase'
    Add-WorkbookButton $sheet 'C7' '計算根拠' 'ShowDetails'
    Add-WorkbookButton $sheet 'D7' '計算' 'RecalculateCase'
    $details = $workbook.Worksheets.Item('計算根拠')
    try {
        Add-WorkbookButton $details 'A17' 'メイン画面に戻る' 'ReturnHome'
        Add-WorkbookButton $details 'B17' '印刷' 'PrintDetails'
        Add-WorkbookButton $details 'C17' 'PDF出力' 'ExportDetails'
    } finally {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($details)
    }
    $sheet.Activate()
    $excel.ActiveWindow.Zoom = 85
    $excel.CalculateFullRebuild()
    Assert ($workbook.Worksheets.Item('自動回帰テスト').Range('B49').Value2 -ceq 'PASS') 'Excelでの内蔵回帰試験が不合格です。'
    $phase = 'VBA実行スモーク'
    Log 'マクロを実際に実行して、Excel/VBA連携を検査します。'
    $excel.Run('TaxLawUpdater.RecalculateCase')
    Assert ($workbook.Worksheets.Item('自動回帰テスト').Range('B49').Value2 -ceq 'PASS') 'マクロの実行後、回帰試験が不合格です。'
    $phase = 'ファイル確定保存'
    Log 'マクロ付きブックを保存します。'
    $workbook.Save()
    $workbook.Close($false)
    Assert ((Test-Path -LiteralPath $tempBook -PathType Leaf)) '一時ブックがありません。'
    Assert ((Get-Item -LiteralPath $tempBook).Length -gt 20000) '一時ブックのサイズが不正です。'
    $phase = 'xlsm構造確認'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($tempBook)
    try {
       $names = @($archive.Entries | ForEach-Object { $_.FullName })
       Assert ($names -contains 'xl/vbaProject.bin') 'xlsm内にVBAプロジェクトがありません。'
       Assert ($names -contains 'xl/workbook.xml') 'xlsm内にExcelブックがありません。'
    } finally { $archive.Dispose() }
    $phase = '完成ファイル配置'
    Assert (-not (Test-Path -LiteralPath $final)) '出力先に既存ファイルが出現しました。上書きしません。'
    [System.IO.File]::Move($tempBook, $final)
    $tempBook = $null
    Log ('成功：' + $final)
    Log '以後は生成した.xlsmを開いて操作画面の「税制を更新」を実行してください。'
    $code = 0
} catch {
    $what = $_.Exception.ToString()
    try { Log ('失敗の原因：' + $what) } catch { Write-Host $what }
    $code = 1
} finally {
    if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($button, $anchor, $sheet, $component, $workbook, $excel)) {
        if ($null -ne $obj) {
            try {
                if ([System.Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
                }
            } catch {}
        }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($null -ne $tempBook -and (Test-Path -LiteralPath $tempBook)) {
        try { Remove-Item -LiteralPath $tempBook -Force } catch {}
    }

}
exit $code
