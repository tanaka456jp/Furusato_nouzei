#Requires -Version 5.1
<#
Operator-only physical printer acceptance: never called by CI.
Use a reviewed, synthetic-data workbook on a Windows PC with installed Excel.
Shows interactive Excel print preview then sends at most ONE page to the
explicitly selected physical printer. This cannot inspect the printed paper;
the output records a HOLD requiring independent human inspection.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [Parameter(Mandatory=$true)][string]$ExpectedWorkbookSha256,
    [Parameter(Mandatory=$true)][long]$ExpectedDisplayedLimitYen,
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$EvidencePath,
    [switch]$SyntheticDataReviewed,
    [switch]$AllowOnePagePrint
)
$ErrorActionPreference = 'Stop'
# This operator-only action MUST never run in GitHub Actions or another
# unattended/noninteractive session, even if flags are supplied by mistake.
if ($env:CI -or $env:GITHUB_ACTIONS -or
    -not [Environment]::UserInteractive) {
    throw 'PHYSICAL_PRINT_REQUIRES_LOCAL_INTERACTIVE_OPERATOR'
}
if ($ExpectedDisplayedLimitYen -lt 2000 -or
    $ExpectedDisplayedLimitYen -gt 100000000) {
    throw 'INVALID_SYNTHETIC_EXPECTED_DONATION_LIMIT'
}
if (-not $SyntheticDataReviewed -or -not $AllowOnePagePrint) {
    throw 'EXPLICIT_SYNTHETIC_DATA_AND_PHYSICAL_PRINT_CONSENT_REQUIRED'
}
$expected = $ExpectedWorkbookSha256.Trim().ToLowerInvariant()
if ($expected -cnotmatch '^[0-9a-f]{64}$' -or
    [string]::IsNullOrWhiteSpace($PrinterName)) {
    throw 'INVALID_EXPECTED_HASH_OR_PRINTER'
}
if (Test-Path -LiteralPath $EvidencePath) {
    throw 'REFUSE_TO_OVERWRITE_PAPER_EVIDENCE'
}
$input = (Resolve-Path -LiteralPath $Workbook).Path
if ([IO.Path]::GetExtension($input).ToLowerInvariant() -ne '.xlsm') {
    throw 'ONLY_APPROVED_SYNTHETIC_XLSM_ALLOWED'
}
$sha = (Get-FileHash -LiteralPath $input -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sha -cne $expected) {
    throw 'REVIEWED_SYNTHETIC_WORKBOOK_HASH_MISMATCH'
}
# No default fallback: an exact installed Windows printer must be supplied.
# Exclude virtual/fax/file-based printers; physical/network printers can have
# WSD, TCP/IP, USB, or a managed print server port.
$printers = @(Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop |
    Where-Object { $_.Name -ceq $PrinterName })
if ($printers.Count -ne 1) { throw 'EXPLICIT_PRINTER_NOT_INSTALLED_OR_AMBIGUOUS' }
$printer = $printers[0]
if ($printer.WorkOffline -or [string]$printer.PortName -match '(?i)^(?:FILE:|PORTPROMPT:|NUL:|XPSPORT:)' -or
    [string]$printer.Name -match '(?i)pdf|xps|fax|one.?note|virtual|document.writer' -or
    [string]$printer.DriverName -match '(?i)pdf|xps|fax|one.?note|virtual|document.writer') {
    throw 'PHYSICAL_PRINTER_NOT_VERIFIED'
}
function Assert-ExplicitActivePrinter {
    param([string]$Actual,[string]$Expected)
    if (-not $Actual.StartsWith($Expected,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'EXCEL_ACTIVE_PRINTER_DOES_NOT_MATCH_EXPLICIT_SELECTION'
    }
    $suffix = $Actual.Substring($Expected.Length)
    if ($suffix -ne '' -and $suffix -notmatch '^\s+(?:on|で)\s+') {
        throw 'EXCEL_ACTIVE_PRINTER_DOES_NOT_MATCH_EXPLICIT_SELECTION'
    }
}
$original = $sha
$excel = $null
$book = $null
$previewWasInvoked = $false
$printWasSubmitted = $false
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
    $excel.Visible = $true
    $book = $excel.Workbooks.Open($input,0,$true)
    if ($book.ReadOnly -ne $true -or
        -not [string]::Equals([string]$book.FullName,$input,
                             [StringComparison]::OrdinalIgnoreCase) -or
        $excel.Workbooks.Count -ne 1) {
        throw 'UNEXPECTED_EXCEL_OR_WORKBOOK_MODE'
    }
    # Recalculate the reviewed synthetic scenario in the owned Excel
    # process so stale cached values cannot be printed as accepted results.
    $excel.CalculateFullRebuild()
    $poll = 0
    while ([int]$excel.CalculationState -ne 0 -and $poll -lt 120) {
        Start-Sleep -Milliseconds 250
        $poll++
    }
    if ([int]$excel.CalculationState -ne 0) {
        throw 'EXCEL_CALCULATION_NOT_COMPLETE'
    }
    $home = $book.Worksheets.Item('操作画面')
    if ($null -eq $home -or [string]$home.Range('B28').Value2 -cne '正常') {
        throw 'PRINT_SCENARIO_CALCULATION_NOT_VERIFIED'
    }
    $calculatedLimit = $home.Range('B8').Value2
    if ($null -eq $calculatedLimit -or
        [double]$calculatedLimit -ne [double]$ExpectedDisplayedLimitYen) {
        throw 'DISPLAYED_DONATION_LIMIT_MISMATCH'
    }
    $sheet = $book.Worksheets.Item('計算根拠')
    if ($null -eq $sheet) { throw 'PRINT_DETAILS_SHEET_MISSING' }
    if ($sheet.Visible -ne -1) { $sheet.Visible = -1 } # read-only copy only
    $sheet.Activate()
    if ($null -eq $sheet.Range('B14').Value2 -or
        [double]$sheet.Range('B14').Value2 -ne [double]$ExpectedDisplayedLimitYen) {
        throw 'PRINT_DETAILS_LIMIT_MISMATCH'
    }
    $sheet.PageSetup.PaperSize = 9 # xlPaperA4
    $sheet.PageSetup.Orientation = 1 # xlPortrait
    # Excel's ActivePrinter may include a localized port suffix (NeXX:).
    # Refuse to fall back to any other default printer.
    Assert-ExplicitActivePrinter -Actual ([string]$excel.ActivePrinter) -Expected $PrinterName
    # PrintPreview is interactive and blocks until the operator closes it.
    # The operator must visually inspect the page, then CLOSE (not Print).
    $previewWasInvoked = $true
    [void]$sheet.PrintPreview()
    Assert-ExplicitActivePrinter -Actual ([string]$excel.ActivePrinter) -Expected $PrinterName
    # Preview may contain its own Print button. Do not print automatically
    # when the window closes; ask the human to explicitly reconfirm that
    # they used Close, NOT Print, in Excel's preview window.
    $confirmation = Read-Host 'Did you CLOSE preview without printing? Type PRINT-ONE-PAGE to submit one physical page'
    if ($confirmation -cne 'PRINT-ONE-PAGE') {
        throw 'PHYSICAL_PRINT_NOT_RECONFIRMED_AFTER_PREVIEW'
    }
    if ([string]$home.Range('B28').Value2 -cne '正常' -or
        [double]$home.Range('B8').Value2 -ne [double]$ExpectedDisplayedLimitYen -or
        [double]$sheet.Range('B14').Value2 -ne [double]$ExpectedDisplayedLimitYen) {
        throw 'PRINT_SCENARIO_CHANGED_AFTER_PREVIEW'
    }
    # One print command, one page, one copy, specified active printer only.
    [void]$sheet.PrintOut(1,1,1,$false)
    $printWasSubmitted = $true
} finally {
    if ($null -ne $book) { try { $book.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($book,$excel)) {
        try {
            if ($null -ne $obj -and
                [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ((Get-FileHash -LiteralPath $input -Algorithm SHA256).Hash.ToLowerInvariant() -cne $original) {
        throw 'ORIGINAL_SYNTHETIC_WORKBOOK_CHANGED'
    }
}
if (-not $previewWasInvoked -or -not $printWasSubmitted) {
    throw 'PRINT_COMMAND_NOT_COMPLETED'
}
# No printer name/hostname, personal data, path, or paper contents in evidence.
$result = [ordered]@{
    schema = 'furusato-physical-paper-review/v1'
    workbook_sha256 = $expected
    expected_limit_yen_verified = $true
    excel_tax_status_normal = $true
    post_preview_operator_reconfirmed = $true
    synthetic_data_reviewed = $true
    installed_printer_explicitly_selected = $true
    excel_print_preview_invoked = $true
    one_page_print_command_submitted = $true
    paper_physically_observed = $false
    paper_readability_reviewed = $false
    release_decision = 'HOLD'
    note = 'Paper output must be physically inspected and separately approved. A spool command is not a paper quality proof.'
}
$target = [IO.Path]::GetFullPath($EvidencePath)
$parent = [IO.Path]::GetDirectoryName($target)
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    [void][IO.Directory]::CreateDirectory($parent)
}
[IO.File]::WriteAllText($target,($result | ConvertTo-Json -Depth 3),
    (New-Object Text.UTF8Encoding($false)))
Write-Host 'PHYSICAL_PRINT_SUBMITTED_PAPER_VISUAL_SIGNOFF_REQUIRED_RELEASE_HOLD'
