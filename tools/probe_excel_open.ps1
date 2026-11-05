#Requires -Version 5.1
<#
Test differential diagnostic XLSX files in one isolated desktop Excel instance.
Optionally supply the exact separately-created confirmation workbook with
-ConfirmationWorkbook. Read-only, no macro execution, never a tax acceptance.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ProbeDirectory,
    [Parameter(Mandatory=$true)][string]$EvidencePath,
    [string]$ConfirmationWorkbook = ''
)
$ErrorActionPreference = 'Stop'
$dir = (Resolve-Path -LiteralPath $ProbeDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne 'furusato-excel-open-probes/v1') { throw 'Unexpected manifest schema' }
$excel = $null
$workbook = $null
$controlPath = $null
$items = @()
$report = [ordered]@{
    schema = 'furusato-excel-open-results/v2'
    status = 'DIAGNOSTIC_ONLY'
    started_utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    finished_utc = ''
    excel_version = ''
    native_excel_control = $null
    probes = @()
    warning = 'Neither opening a probe nor the native control establishes tax accuracy, XLSM or VBA acceptance.'
}
function ErrorChain($err) {
    $found = @()
    $current = $err
    $depth = 0
    while ($null -ne $current -and $depth -lt 6) {
        $h = '0x' + ([int]$current.HResult).ToString('X8')
        if ($found -notcontains $h) { $found += $h }
        $current = $current.InnerException
        $depth++
    }
    return ,$found
}
function ReadOnlyProbe([string]$id, [string]$path, [string]$expectedHash = '') {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Missing diagnostic input' }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($expectedHash -and $hash -cne $expectedHash) { throw 'Diagnostic input SHA-256 mismatch' }
    $item = [ordered]@{
        id = $id
        sha256 = $hash
        opened = $false
        sheet_count = 0
        exception_chain_hresult = @()
    }
    $openedBook = $null
    try {
        $openedBook = $script:excel.Workbooks.Open($path, 0, $true)
        if ($null -eq $openedBook) { throw 'Excel returned a null workbook' }
        $item.sheet_count = [int]$openedBook.Worksheets.Count
        $item.opened = $true
    } catch {
        $item.exception_chain_hresult = @(ErrorChain $_.Exception)
    } finally {
        if ($null -ne $openedBook) {
            try { $openedBook.Close($false) } catch {}
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($openedBook) } catch {}
        }
    }
    Write-Host ('Excel opening probe ' + $id + ': ' + $(if ($item.opened) { 'OPENED' } else { 'REJECTED' }))
    return [pscustomobject]$item
}
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    $excel.AutomationSecurity = 3
    $report.excel_version = [string]$excel.Version

    # A same-instance Excel-native workbook is the non-tax control.
    # It proves whether the COM host can save/read XLSX independently.
    $controlDir = Join-Path ([IO.Path]::GetTempPath()) ('Furusato_Control_' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($controlDir)
    $controlPath = Join-Path $controlDir 'excel_native_control.xlsx'
    $created = $null
    try {
        $created = $excel.Workbooks.Add()
        $created.SaveAs($controlPath, 51)
        $created.Close($false)
        $created = $null
        $report.native_excel_control = ReadOnlyProbe 'excel_native_control' $controlPath
    } catch {
        $report.native_excel_control = [pscustomobject]@{
            id = 'excel_native_control'
            opened = $false
            exception_chain_hresult = @(ErrorChain $_.Exception)
        }
    } finally {
        if ($null -ne $created) { try { $created.Close($false) } catch {} }
    }

    foreach ($probe in $manifest.probes) {
        $name = [string]$probe.file
        if ([IO.Path]::GetFileName($name) -cne $name) { throw 'Unsafe filename in manifest' }
        $items += ReadOnlyProbe ([string]$probe.id) (Join-Path $dir $name) ([string]$probe.sha256)
    }

    if (-not [string]::IsNullOrWhiteSpace($ConfirmationWorkbook)) {
        # This opt-in probes the *exact* alternative file from the earlier build.
        # No path or workbook data is written to public CI evidence.
        $confirmPath = (Resolve-Path -LiteralPath $ConfirmationWorkbook).Path
        $items += ReadOnlyProbe 'external_confirmation_xlsx' $confirmPath
    }
} finally {
    if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    if ($null -ne $excel) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($null -ne $controlPath) {
        try { Remove-Item -LiteralPath (Split-Path -Parent $controlPath) -Recurse -Force } catch {}
    }
    $report.probes = @($items)
    $report.finished_utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($EvidencePath, ($report | ConvertTo-Json -Depth 6), $utf8)
}
