#Requires -Version 5.1
<#
Open five XLSX candidates in the SAME isolated desktop Excel COM instance.
Read-only, no VBA, no auto-repair. Never claim this proves tax accuracy.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ProbeDirectory,
    [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
$dir = (Resolve-Path -LiteralPath $ProbeDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne 'furusato-excel-open-probes/v1') {
    throw 'Unrecognized diagnostic manifest.'
}
$excel = $null
$workbook = $null
$items = @()
$report = [ordered]@{
    schema = 'furusato-excel-open-results/v1'
    status = 'DIAGNOSTIC_ONLY'
    started_utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    finished_utc = ''
    excel_version = ''
    probes = @()
    warning = 'An opened XLSX does not prove XLSM, VBA, or tax correctness.'
}
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    $excel.AutomationSecurity = 3
    $report.excel_version = [string]$excel.Version
    foreach ($probe in $manifest.probes) {
        $name = [string]$probe.file
        if ([IO.Path]::GetFileName($name) -cne $name) { throw 'Unsafe probe filename' }
        $candidate = Join-Path $dir $name
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'Missing diagnostic file' }
        if ((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -cne [string]$probe.sha256) {
            throw 'Diagnostic SHA-256 mismatch'
        }
        $row = [ordered]@{
            id = [string]$probe.id
            sha256 = [string]$probe.sha256
            opened = $false
            sheet_count = 0
            error_type = ''
            hresult = ''
        }
        $workbook = $null
        try {
            $workbook = $excel.Workbooks.Open($candidate, 0, $true)
            if ($null -eq $workbook) { throw 'Null workbook' }
            $row.sheet_count = [int]$workbook.Worksheets.Count
            $row.opened = $true
        } catch {
            $row.error_type = $_.Exception.GetType().Name
            $row.hresult = '0x' + ([int]$_.Exception.HResult).ToString('X8')
        } finally {
            if ($null -ne $workbook) {
                try { $workbook.Close($false) } catch {}
                try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) } catch {}
                $workbook = $null
            }
        }
        $items += [pscustomobject]$row
        Write-Host ("Excel opening probe " + $row.id + ": " + $(if ($row.opened) { 'OPENED' } else { 'REJECTED ' + $row.hresult }))
    }
} finally {
    if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    if ($null -ne $excel) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    $report.probes = @($items)
    $report.finished_utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($EvidencePath, ($report | ConvertTo-Json -Depth 5), $utf8)
}
