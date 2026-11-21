#Requires -Version 5.1
# Isolated synthetic workbook only. Never capture the whole desktop.
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [ValidatePattern('^[a-f0-9]{40}$')][string]$SourceHead
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Workbook -ErrorAction Stop).Path
if ([IO.Path]::GetFileName($source) -cne 'Furusato_nouzei.xlsm') {
    throw 'Display QA accepts only the generated synthetic review workbook'
}
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $source.StartsWith($runnerTemp,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Display QA source must be inside the isolated runner temporary directory'
}
if (Test-Path -LiteralPath $EvidenceDirectory) {
    throw 'Refusing to overwrite existing display evidence'
}
[void][IO.Directory]::CreateDirectory($EvidenceDirectory)
$excel = $null
$book = $null
$status = 'UNVERIFIED'
$reason = ''
$display = $null
$measured = $null
$pictures = @()
$commands = @()
$worksheetReadback = @()
$workbookHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()

function Measure-Commands($book, [double]$pixelsPerPoint) {
    $checks = @(
        @{ Sheet = 1; Cell = 'A5'; Macro = 'TaxLawUpdate' },
        @{ Sheet = 1; Cell = 'A7'; Macro = 'NewCase' },
        @{ Sheet = 1; Cell = 'B7'; Macro = 'SaveCase' },
        @{ Sheet = 1; Cell = 'C7'; Macro = 'ShowDetails' },
        @{ Sheet = 1; Cell = 'D7'; Macro = 'RecalculateCase' },
        @{ Sheet = 1; Cell = 'B5'; Macro = 'ShowAdvanced' },
        @{ Sheet = 1; Cell = 'B3'; Macro = 'ImportWithholding' },
        @{ Sheet = 1; Cell = 'C3'; Macro = 'ReviewWithholding' },
        @{ Sheet = 1; Cell = 'D3'; Macro = 'ImportWithholdingBatch' },
        @{ Sheet = 2; Cell = 'A17'; Macro = 'ReturnHome' },
        @{ Sheet = 2; Cell = 'B17'; Macro = 'PrintDetails' },
        @{ Sheet = 2; Cell = 'C17'; Macro = 'ExportDetails' },
        @{ Sheet = 3; Cell = 'B2'; Macro = 'ReturnFromAdvanced' },
        @{ Sheet = 4; Cell = 'B4'; Macro = 'ClearBatchOverviewWithConfirm' },
        @{ Sheet = 4; Cell = 'K4'; Macro = 'ExportAllBatchReferencePDFs' }
    )
    $sheets = @($book.Worksheets.Item(1), $book.Worksheets.Item('計算根拠'),
        $book.Worksheets.Item('例外・分離課税'),
        $book.Worksheets.Item('一括計算一覧'))
    if ($sheets[0].Name -cne '操作画面' -or
        $sheets[0].Buttons().Count -ne 9 -or $sheets[1].Buttons().Count -ne 3 -or
        $sheets[2].Buttons().Count -ne 1 -or $sheets[3].Buttons().Count -ne 2) {
        throw 'UNEXPECTED_WORKSHEET_COMMAND_COUNT'
    }
    $surface = [Drawing.Bitmap]::new(1,1)
    $graphics = [Drawing.Graphics]::FromImage($surface)
    try {
        foreach ($check in $checks) {
            $sheet = $sheets[$check.Sheet - 1]
            $cell = $sheet.Range($check.Cell)
            $button = $sheet.Buttons().Item('btn'+$check.Macro)
            $left = [double]$button.Left
            $top = [double]$button.Top
            $width = [double]$button.Width
            $height = [double]$button.Height
            # The commands occupy distinct anchor cells. Containment also
            # ensures they cannot obscure adjacent editable cells or links.
            if ($left -lt [double]$cell.Left -or $top -lt [double]$cell.Top -or
                $left + $width -gt [double]$cell.Left + [double]$cell.Width -or
                $top + $height -gt [double]$cell.Top + [double]$cell.Height) {
                throw ('COMMAND_OVERLAP_OR_CLIP_' + $check.Macro)
            }
            # Same exact, workbook-qualified check as Excel QA. Preserve
            # quote semantics instead of stripping every apostrophe.
            $onAction = [string]$button.OnAction
            if ($onAction -match "^'([^']+)'!(.+)$") {
                $onAction = $Matches[1] + '!' + $Matches[2]
            }
            if ($onAction -cne ('Furusato_nouzei.xlsm!TaxLawUpdater.' + $check.Macro)) {
                # Safe diagnostic category only; do not expose workbook paths.
                $kind = if ([string]::IsNullOrWhiteSpace($onAction)) {
                    'EMPTY'
                } elseif ($onAction -match '^[^!]+!TaxLawUpdater\.[A-Za-z0-9_]+
            $characters = $button.Characters()
            $caption = [string]$characters.Text
            $points = [double]$characters.Font.Size
            if ([string]::IsNullOrWhiteSpace($caption) -or $points -lt 8) {
                throw ('COMMAND_CAPTION_NOT_READABLE_' + $check.Macro)
            }
            $style = if ([bool]$characters.Font.Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
            $font = [Drawing.Font]::new([string]$characters.Font.Name,
                [single]($points * $pixelsPerPoint), $style, [Drawing.GraphicsUnit]::Pixel)
            try {
                $size = $graphics.MeasureString($caption, $font, [Drawing.PointF]::Empty,
                    [Drawing.StringFormat]::GenericTypographic)
            } finally { $font.Dispose() }
            $spareWidth = [int][Math]::Floor($width * $pixelsPerPoint) - [int][Math]::Ceiling($size.Width)
            $spareHeight = [int][Math]::Floor($height * $pixelsPerPoint) - [int][Math]::Ceiling($size.Height)
            if ($spareWidth -lt 6 -or $spareHeight -lt 4) {
                throw ('COMMAND_CAPTION_CLIPS_' + $check.Macro)
            }
            [ordered]@{
                command = $check.Macro
                anchor = $check.Cell
                inside_anchor = $true
                expected_action = $true
                font_points = $points
                spare_pixels = @($spareWidth, $spareHeight)
            }
        }
    } finally {
        $graphics.Dispose()
        $surface.Dispose()
    }
}
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FurusatoWindowCapture {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rectangle);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
    // Screen.Bounds can be DPI-virtualized. Ask Windows for the CURRENT
    // display device mode; this is not the physical panel native mode.
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public int dmPositionX, dmPositionY;
        public uint dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags,
            dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType,
            dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
}
'@
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 3 # ForceDisable; no workbook macros run.
    $excel.Visible = $true
    $book = $excel.Workbooks.Open($source,0,$true)
    if ($excel.Workbooks.Count -ne 1 -or
        -not [string]::Equals([string]$book.FullName,$source,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'UNEXPECTED_EXCEL_WORKBOOK'
    }
    $homeSheet = $book.Worksheets.Item(1)
    $homeSheet.Activate()
    $excel.ActiveWindow.Zoom = 85
    $excel.WindowState = -4137 # xlMaximized for this Excel instance.
    Start-Sleep -Milliseconds 750
    $hwnd = [IntPtr]([int]$excel.Hwnd)
    if ($hwnd -eq [IntPtr]::Zero) { throw 'NO_EXCEL_WINDOW_HANDLE' }
    $screen = [Windows.Forms.Screen]::FromHandle($hwnd)
    if ($null -eq $screen) { throw 'NO_INTERACTIVE_SCREEN' }
    # Screen bounds in this process can be DPI-virtualized. We record them
    # as observed, never as a certification of physical panel dimensions.
    $width = [int]$screen.Bounds.Width
    $height = [int]$screen.Bounds.Height
    $display = [ordered]@{
        reported_width = $width
        reported_height = $height
        dpi_virtualization_possible = $true
        display_mode_source = 'EnumDisplaySettingsW'
        current_mode_pixels = $null
        display_mode_observed = $false
        physical_resolution_verified = $false
    }
    # Get the active display mode via EnumDisplaySettingsW instead of
    # inferring device pixels from Screen.Bounds * DPI. Never promote this
    # observation to human visual acceptance on its own.
    $deviceMode = New-Object FurusatoWindowCapture+DEVMODE
    $deviceMode.dmSize = [UInt16][Runtime.InteropServices.Marshal]::SizeOf(
        [type][FurusatoWindowCapture+DEVMODE])
    $modeOk = [FurusatoWindowCapture]::EnumDisplaySettings(
        [string]$screen.DeviceName, -1, [ref]$deviceMode)
    if ($modeOk -and $deviceMode.dmPelsWidth -ge 640 -and
        $deviceMode.dmPelsWidth -le 8192 -and $deviceMode.dmPelsHeight -ge 480 -and
        $deviceMode.dmPelsHeight -le 4320) {
        $display.current_mode_pixels = @([int]$deviceMode.dmPelsWidth,
                                          [int]$deviceMode.dmPelsHeight)
        $display.display_mode_observed = $true
    }
    $rect = New-Object FurusatoWindowCapture+RECT
    if (-not [FurusatoWindowCapture]::GetWindowRect($hwnd,[ref]$rect)) {
        throw 'EXCEL_WINDOW_GEOMETRY_UNAVAILABLE'
    }
    $pxw = [int]($rect.Right-$rect.Left)
    $pxh = [int]($rect.Bottom-$rect.Top)
    $dpi = [int][FurusatoWindowCapture]::GetDpiForWindow($hwnd)
    $display.excel_window_dpi = $dpi
    $display.excel_window_size = @($pxw,$pxh)
    $display.observed_scale_percent = if ($dpi -ge 72 -and $dpi -le 384) {
        [int][Math]::Round(100*$dpi/96)
    } else { $null }
    # Only the current DEVMODE width/height can identify the observed
    # Windows output mode. This STILL is not visual sign-off or a guarantee
    # of the monitor panel's native resolution.
    $measured = $null
    if ($display.display_mode_observed -and
        $display.observed_scale_percent -in @(100,125,150)) {
        $pixels = @($display.current_mode_pixels)
        $scenario = "$($pixels[0])x$($pixels[1])@$($display.observed_scale_percent)"
        if ($scenario -in @('1920x1080@100','1920x1080@125','1366x768@150')) {
            $measured = $scenario
        }
    }
    if ($pxw -lt 500 -or $pxh -lt 400 -or $pxw -gt 6000 -or $pxh -gt 4000) {
        throw 'IMPLAUSIBLE_EXCEL_WINDOW_DIMENSIONS'
    }
    if ($null -eq $measured) { throw 'UNSUPPORTED_OR_UNMEASURED_DISPLAY_MODE' }
    # Microsoft Excel Forms-control COM can momentarily return
    # HRESULT 0x800A01A8 while rebuilding form-button references.
    # Retry only that transient error on the SAME isolated workbook;
    # all command bounds/captions/action checks remain mandatory.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $commands = @(Measure-Commands $book ($dpi * 0.85 / 72))
            if ($commands.Count -ne 15) {
                throw 'DISPLAY_COMMAND_MEASUREMENT_INCOMPLETE'
            }
            break
        } catch {
            if ($attempt -eq 3 -or $_.Exception.Message -notmatch '0x800A01A8') {
                throw
            }
            Start-Sleep -Milliseconds (500 * $attempt)
            $homeSheet.Activate()
        }
    }
    $link = $homeSheet.Range('A2').Hyperlinks.Item(1)
    if ([string]$link.Address -or [string]$link.SubAddress -cne "'操作画面'!A42") {
        throw 'UNEXPECTED_WORKSHEET_LINK_TARGET'
    }
    $link.Follow()
    if ([int]$excel.ActiveCell.Row -ne 42 -or [int]$excel.ActiveCell.Column -ne 1) {
        throw 'WORKSHEET_LINK_DID_NOT_NAVIGATE'
    }
    # On this runner a 180px crop left the ribbon and formula bar visible.
    # Limit evidence to worksheet-only regions. Include the advanced
    # municipality field that gates calculations when the rules differ.
    # No desktop-wide screenshots.
    $top = [Math]::Min(350,[int]($pxh - 300))
    $left = 20
    $cropWidth = $pxw - 40
    $cropHeight = $pxh - $top - 20
    if ($top -lt 170 -or $cropWidth -lt 420 -or $cropHeight -lt 250) {
        throw 'EXCEL_SHEET_REGION_TOO_SMALL'
    }
    foreach ($capture in @(
        @{ row = 1; focus = 'B4'; last = 12; name = 'review_excel_window_sheet_only.png' },
        @{ row = 12; focus = 'B12'; last = 24; name = 'review_excel_window_lower_section.png' },
        @{ row = 24; focus = 'D33'; last = 39; name = 'review_excel_window_mortgage_and_projection.png' },
        @{ row = 42; focus = 'D51'; last = 51; name = 'review_excel_window_municipality.png' }
    )) {
        $homeSheet.Range($capture.focus).Select()
        if ([string]$excel.ActiveCell.Address($false,$false) -cne $capture.focus) {
            throw 'WORKSHEET_INPUT_NOT_FOCUSABLE'
        }
        $excel.ActiveWindow.ScrollColumn = 1
        $excel.ActiveWindow.ScrollRow = [int]$capture.row
        Start-Sleep -Milliseconds 450
        $visible = $excel.ActiveWindow.VisibleRange
        $firstRow = [int]$visible.Row
        $lastRow = $firstRow + [int]$visible.Rows.Count - 1
        # Require an extra row and column because VisibleRange includes
        # partially visible trailing rows or columns.
        if ($firstRow -ne [int]$capture.row -or $lastRow -le [int]$capture.last -or
            [int]$visible.Column -ne 1 -or [int]$visible.Columns.Count -lt 5) {
            throw ('WORKSHEET_CONTENT_CLIPPED_BY_VIEWPORT_AT_' + $capture.row +
                '_OBSERVED_' + $firstRow + '_' + $lastRow)
        }
        # Excel/Windows compositor can return a solid-colour frame even
        # when PrintWindow reports success. Retry only this same Excel HWND:
        # never capture the desktop, never waive viewport/content gates.
        # Both supported PrintWindow modes must meet the original >=8-colour
        # worksheet proof; an all-blank run remains a release-blocking FAIL.
        $captured = $false
        $everPrinted = $false
        $captureFlags = -1
        $captureAttempt = 0
        $colors = [Collections.Generic.HashSet[int]]::new()
        for ($attempt = 1; $attempt -le 3 -and -not $captured; $attempt++) {
            $homeSheet.Activate()
            $excel.ScreenUpdating = $true
            Start-Sleep -Milliseconds (450 * $attempt)
            foreach ($flags in @(2,0)) {
                $bitmap = New-Object System.Drawing.Bitmap($pxw,$pxh)
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                try {
                    $hdc = $graphics.GetHdc()
                    try {
                        $printed = [FurusatoWindowCapture]::PrintWindow($hwnd,$hdc,[uint32]$flags)
                    } finally {
                        $graphics.ReleaseHdc($hdc)
                    }
                    if (-not $printed) { continue }
                    $everPrinted = $true
                    $crop = New-Object System.Drawing.Bitmap($cropWidth,$cropHeight)
                    try {
                        $cropGraphics = [Drawing.Graphics]::FromImage($crop)
                        try {
                            $destination = New-Object Drawing.Rectangle(0,0,$cropWidth,$cropHeight)
                            $sourceRect = New-Object Drawing.Rectangle($left,$top,$cropWidth,$cropHeight)
                            $cropGraphics.DrawImage($bitmap,$destination,$sourceRect,[Drawing.GraphicsUnit]::Pixel)
                        } finally {
                            $cropGraphics.Dispose()
                        }
                        $colors.Clear()
                        for ($x=5; $x -lt $cropWidth; $x+=31) {
                            for ($y=5; $y -lt $cropHeight; $y+=23) {
                                [void]$colors.Add($crop.GetPixel($x,$y).ToArgb())
                            }
                        }
                        if ($colors.Count -ge 8) {
                            $crop.Save((Join-Path $EvidenceDirectory $capture.name),[Drawing.Imaging.ImageFormat]::Png)
                            $captured = $true
                            $captureFlags = $flags
                            $captureAttempt = $attempt
                            break
                        }
                    } finally {
                        $crop.Dispose()
                    }
                } finally {
                    $graphics.Dispose()
                    $bitmap.Dispose()
                }
            }
        }
        if (-not $captured) {
            if (-not $everPrinted) { throw 'EXCEL_WINDOW_CAPTURE_NOT_SUPPORTED' }
            throw 'EXCEL_CAPTURE_BLANK_OR_UNRENDERED'
        }
        $pictures += [ordered]@{
            file = [string]$capture.name
            sha256 = (Get-FileHash -LiteralPath (Join-Path $EvidenceDirectory $capture.name) -Algorithm SHA256).Hash.ToLowerInvariant()
            sampled_colors = $colors.Count
            printwindow_flags = $captureFlags
            render_attempt = $captureAttempt
            pixels = @($cropWidth, $cropHeight)
        }
        $worksheetReadback += [ordered]@{
            first_row = $firstRow
            last_row = $lastRow
            first_column = [int]$visible.Column
            column_count = [int]$visible.Columns.Count
            focused_cell = [string]$capture.focus
        }
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $workbookHash) {
        throw 'DISPLAY_WORKBOOK_CHANGED_DURING_CAPTURE'
    }
    $status = 'MEASURED'
} catch {
    $reason = [string]$_.Exception.Message
    if ($reason -match 'UNEXPECTED_EXCEL_WORKBOOK|generated synthetic|isolated runner') {
        throw # Any possibility of capturing customer data must fail closed.
    }
    $status = 'UNVERIFIED'
} finally {
    if ($null -ne $book) { try { $book.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($book,$excel)) {
        try {
            if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    $report = [ordered]@{
        schema = 'furusato-display-review/v2'
        status = $status
        source_head = $SourceHead
        workbook_sha256 = $workbookHash
        display_observation = $display
        mode = $measured
        excel_zoom_percent = 85
        commands = @($commands)
        worksheet_readback = @($worksheetReadback)
        screenshots = @($pictures)
        inside_workbook_link = if ($status -eq 'MEASURED') { 'A2->A42' } else { $null }
        failure_category = if ($reason) { ($reason -replace '[^A-Z0-9_]','_').Substring(0,[Math]::Min(80,($reason -replace '[^A-Z0-9_]','_').Length)) } else { '' }
    }
    $json = $report | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'display_review.json'),
        $json,[Text.UTF8Encoding]::new($false))
    Write-Host ('DISPLAY_REVIEW_'+$status)
}
) {
                    'WRONG_OWNER_OR_PROCEDURE'
                } elseif ($onAction -match '^TaxLawUpdater\.[A-Za-z0-9_]+
            $characters = $button.Characters()
            $caption = [string]$characters.Text
            $points = [double]$characters.Font.Size
            if ([string]::IsNullOrWhiteSpace($caption) -or $points -lt 8) {
                throw ('COMMAND_CAPTION_NOT_READABLE_' + $check.Macro)
            }
            $style = if ([bool]$characters.Font.Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
            $font = [Drawing.Font]::new([string]$characters.Font.Name,
                [single]($points * $pixelsPerPoint), $style, [Drawing.GraphicsUnit]::Pixel)
            try {
                $size = $graphics.MeasureString($caption, $font, [Drawing.PointF]::Empty,
                    [Drawing.StringFormat]::GenericTypographic)
            } finally { $font.Dispose() }
            $spareWidth = [int][Math]::Floor($width * $pixelsPerPoint) - [int][Math]::Ceiling($size.Width)
            $spareHeight = [int][Math]::Floor($height * $pixelsPerPoint) - [int][Math]::Ceiling($size.Height)
            if ($spareWidth -lt 6 -or $spareHeight -lt 4) {
                throw ('COMMAND_CAPTION_CLIPS_' + $check.Macro)
            }
            [ordered]@{
                command = $check.Macro
                anchor = $check.Cell
                inside_anchor = $true
                expected_action = $true
                font_points = $points
                spare_pixels = @($spareWidth, $spareHeight)
            }
        }
    } finally {
        $graphics.Dispose()
        $surface.Dispose()
    }
}
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FurusatoWindowCapture {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rectangle);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
    // Screen.Bounds can be DPI-virtualized. Ask Windows for the CURRENT
    // display device mode; this is not the physical panel native mode.
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public int dmPositionX, dmPositionY;
        public uint dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags,
            dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType,
            dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
}
'@
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 3 # ForceDisable; no workbook macros run.
    $excel.Visible = $true
    $book = $excel.Workbooks.Open($source,0,$true)
    if ($excel.Workbooks.Count -ne 1 -or
        -not [string]::Equals([string]$book.FullName,$source,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'UNEXPECTED_EXCEL_WORKBOOK'
    }
    $homeSheet = $book.Worksheets.Item(1)
    $homeSheet.Activate()
    $excel.ActiveWindow.Zoom = 85
    $excel.WindowState = -4137 # xlMaximized for this Excel instance.
    Start-Sleep -Milliseconds 750
    $hwnd = [IntPtr]([int]$excel.Hwnd)
    if ($hwnd -eq [IntPtr]::Zero) { throw 'NO_EXCEL_WINDOW_HANDLE' }
    $screen = [Windows.Forms.Screen]::FromHandle($hwnd)
    if ($null -eq $screen) { throw 'NO_INTERACTIVE_SCREEN' }
    # Screen bounds in this process can be DPI-virtualized. We record them
    # as observed, never as a certification of physical panel dimensions.
    $width = [int]$screen.Bounds.Width
    $height = [int]$screen.Bounds.Height
    $display = [ordered]@{
        reported_width = $width
        reported_height = $height
        dpi_virtualization_possible = $true
        display_mode_source = 'EnumDisplaySettingsW'
        current_mode_pixels = $null
        display_mode_observed = $false
        physical_resolution_verified = $false
    }
    # Get the active display mode via EnumDisplaySettingsW instead of
    # inferring device pixels from Screen.Bounds * DPI. Never promote this
    # observation to human visual acceptance on its own.
    $deviceMode = New-Object FurusatoWindowCapture+DEVMODE
    $deviceMode.dmSize = [UInt16][Runtime.InteropServices.Marshal]::SizeOf(
        [type][FurusatoWindowCapture+DEVMODE])
    $modeOk = [FurusatoWindowCapture]::EnumDisplaySettings(
        [string]$screen.DeviceName, -1, [ref]$deviceMode)
    if ($modeOk -and $deviceMode.dmPelsWidth -ge 640 -and
        $deviceMode.dmPelsWidth -le 8192 -and $deviceMode.dmPelsHeight -ge 480 -and
        $deviceMode.dmPelsHeight -le 4320) {
        $display.current_mode_pixels = @([int]$deviceMode.dmPelsWidth,
                                          [int]$deviceMode.dmPelsHeight)
        $display.display_mode_observed = $true
    }
    $rect = New-Object FurusatoWindowCapture+RECT
    if (-not [FurusatoWindowCapture]::GetWindowRect($hwnd,[ref]$rect)) {
        throw 'EXCEL_WINDOW_GEOMETRY_UNAVAILABLE'
    }
    $pxw = [int]($rect.Right-$rect.Left)
    $pxh = [int]($rect.Bottom-$rect.Top)
    $dpi = [int][FurusatoWindowCapture]::GetDpiForWindow($hwnd)
    $display.excel_window_dpi = $dpi
    $display.excel_window_size = @($pxw,$pxh)
    $display.observed_scale_percent = if ($dpi -ge 72 -and $dpi -le 384) {
        [int][Math]::Round(100*$dpi/96)
    } else { $null }
    # Only the current DEVMODE width/height can identify the observed
    # Windows output mode. This STILL is not visual sign-off or a guarantee
    # of the monitor panel's native resolution.
    $measured = $null
    if ($display.display_mode_observed -and
        $display.observed_scale_percent -in @(100,125,150)) {
        $pixels = @($display.current_mode_pixels)
        $scenario = "$($pixels[0])x$($pixels[1])@$($display.observed_scale_percent)"
        if ($scenario -in @('1920x1080@100','1920x1080@125','1366x768@150')) {
            $measured = $scenario
        }
    }
    if ($pxw -lt 500 -or $pxh -lt 400 -or $pxw -gt 6000 -or $pxh -gt 4000) {
        throw 'IMPLAUSIBLE_EXCEL_WINDOW_DIMENSIONS'
    }
    if ($null -eq $measured) { throw 'UNSUPPORTED_OR_UNMEASURED_DISPLAY_MODE' }
    # Microsoft Excel Forms-control COM can momentarily return
    # HRESULT 0x800A01A8 while rebuilding form-button references.
    # Retry only that transient error on the SAME isolated workbook;
    # all command bounds/captions/action checks remain mandatory.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $commands = @(Measure-Commands $book ($dpi * 0.85 / 72))
            if ($commands.Count -ne 15) {
                throw 'DISPLAY_COMMAND_MEASUREMENT_INCOMPLETE'
            }
            break
        } catch {
            if ($attempt -eq 3 -or $_.Exception.Message -notmatch '0x800A01A8') {
                throw
            }
            Start-Sleep -Milliseconds (500 * $attempt)
            $homeSheet.Activate()
        }
    }
    $link = $homeSheet.Range('A2').Hyperlinks.Item(1)
    if ([string]$link.Address -or [string]$link.SubAddress -cne "'操作画面'!A42") {
        throw 'UNEXPECTED_WORKSHEET_LINK_TARGET'
    }
    $link.Follow()
    if ([int]$excel.ActiveCell.Row -ne 42 -or [int]$excel.ActiveCell.Column -ne 1) {
        throw 'WORKSHEET_LINK_DID_NOT_NAVIGATE'
    }
    # On this runner a 180px crop left the ribbon and formula bar visible.
    # Limit evidence to worksheet-only regions. Include the advanced
    # municipality field that gates calculations when the rules differ.
    # No desktop-wide screenshots.
    $top = [Math]::Min(350,[int]($pxh - 300))
    $left = 20
    $cropWidth = $pxw - 40
    $cropHeight = $pxh - $top - 20
    if ($top -lt 170 -or $cropWidth -lt 420 -or $cropHeight -lt 250) {
        throw 'EXCEL_SHEET_REGION_TOO_SMALL'
    }
    foreach ($capture in @(
        @{ row = 1; focus = 'B4'; last = 12; name = 'review_excel_window_sheet_only.png' },
        @{ row = 12; focus = 'B12'; last = 24; name = 'review_excel_window_lower_section.png' },
        @{ row = 24; focus = 'D33'; last = 39; name = 'review_excel_window_mortgage_and_projection.png' },
        @{ row = 42; focus = 'D51'; last = 51; name = 'review_excel_window_municipality.png' }
    )) {
        $homeSheet.Range($capture.focus).Select()
        if ([string]$excel.ActiveCell.Address($false,$false) -cne $capture.focus) {
            throw 'WORKSHEET_INPUT_NOT_FOCUSABLE'
        }
        $excel.ActiveWindow.ScrollColumn = 1
        $excel.ActiveWindow.ScrollRow = [int]$capture.row
        Start-Sleep -Milliseconds 450
        $visible = $excel.ActiveWindow.VisibleRange
        $firstRow = [int]$visible.Row
        $lastRow = $firstRow + [int]$visible.Rows.Count - 1
        # Require an extra row and column because VisibleRange includes
        # partially visible trailing rows or columns.
        if ($firstRow -ne [int]$capture.row -or $lastRow -le [int]$capture.last -or
            [int]$visible.Column -ne 1 -or [int]$visible.Columns.Count -lt 5) {
            throw ('WORKSHEET_CONTENT_CLIPPED_BY_VIEWPORT_AT_' + $capture.row +
                '_OBSERVED_' + $firstRow + '_' + $lastRow)
        }
        # Excel/Windows compositor can return a solid-colour frame even
        # when PrintWindow reports success. Retry only this same Excel HWND:
        # never capture the desktop, never waive viewport/content gates.
        # Both supported PrintWindow modes must meet the original >=8-colour
        # worksheet proof; an all-blank run remains a release-blocking FAIL.
        $captured = $false
        $everPrinted = $false
        $captureFlags = -1
        $captureAttempt = 0
        $colors = [Collections.Generic.HashSet[int]]::new()
        for ($attempt = 1; $attempt -le 3 -and -not $captured; $attempt++) {
            $homeSheet.Activate()
            $excel.ScreenUpdating = $true
            Start-Sleep -Milliseconds (450 * $attempt)
            foreach ($flags in @(2,0)) {
                $bitmap = New-Object System.Drawing.Bitmap($pxw,$pxh)
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                try {
                    $hdc = $graphics.GetHdc()
                    try {
                        $printed = [FurusatoWindowCapture]::PrintWindow($hwnd,$hdc,[uint32]$flags)
                    } finally {
                        $graphics.ReleaseHdc($hdc)
                    }
                    if (-not $printed) { continue }
                    $everPrinted = $true
                    $crop = New-Object System.Drawing.Bitmap($cropWidth,$cropHeight)
                    try {
                        $cropGraphics = [Drawing.Graphics]::FromImage($crop)
                        try {
                            $destination = New-Object Drawing.Rectangle(0,0,$cropWidth,$cropHeight)
                            $sourceRect = New-Object Drawing.Rectangle($left,$top,$cropWidth,$cropHeight)
                            $cropGraphics.DrawImage($bitmap,$destination,$sourceRect,[Drawing.GraphicsUnit]::Pixel)
                        } finally {
                            $cropGraphics.Dispose()
                        }
                        $colors.Clear()
                        for ($x=5; $x -lt $cropWidth; $x+=31) {
                            for ($y=5; $y -lt $cropHeight; $y+=23) {
                                [void]$colors.Add($crop.GetPixel($x,$y).ToArgb())
                            }
                        }
                        if ($colors.Count -ge 8) {
                            $crop.Save((Join-Path $EvidenceDirectory $capture.name),[Drawing.Imaging.ImageFormat]::Png)
                            $captured = $true
                            $captureFlags = $flags
                            $captureAttempt = $attempt
                            break
                        }
                    } finally {
                        $crop.Dispose()
                    }
                } finally {
                    $graphics.Dispose()
                    $bitmap.Dispose()
                }
            }
        }
        if (-not $captured) {
            if (-not $everPrinted) { throw 'EXCEL_WINDOW_CAPTURE_NOT_SUPPORTED' }
            throw 'EXCEL_CAPTURE_BLANK_OR_UNRENDERED'
        }
        $pictures += [ordered]@{
            file = [string]$capture.name
            sha256 = (Get-FileHash -LiteralPath (Join-Path $EvidenceDirectory $capture.name) -Algorithm SHA256).Hash.ToLowerInvariant()
            sampled_colors = $colors.Count
            printwindow_flags = $captureFlags
            render_attempt = $captureAttempt
            pixels = @($cropWidth, $cropHeight)
        }
        $worksheetReadback += [ordered]@{
            first_row = $firstRow
            last_row = $lastRow
            first_column = [int]$visible.Column
            column_count = [int]$visible.Columns.Count
            focused_cell = [string]$capture.focus
        }
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $workbookHash) {
        throw 'DISPLAY_WORKBOOK_CHANGED_DURING_CAPTURE'
    }
    $status = 'MEASURED'
} catch {
    $reason = [string]$_.Exception.Message
    if ($reason -match 'UNEXPECTED_EXCEL_WORKBOOK|generated synthetic|isolated runner') {
        throw # Any possibility of capturing customer data must fail closed.
    }
    $status = 'UNVERIFIED'
} finally {
    if ($null -ne $book) { try { $book.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($book,$excel)) {
        try {
            if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    $report = [ordered]@{
        schema = 'furusato-display-review/v2'
        status = $status
        source_head = $SourceHead
        workbook_sha256 = $workbookHash
        display_observation = $display
        mode = $measured
        excel_zoom_percent = 85
        commands = @($commands)
        worksheet_readback = @($worksheetReadback)
        screenshots = @($pictures)
        inside_workbook_link = if ($status -eq 'MEASURED') { 'A2->A42' } else { $null }
        failure_category = if ($reason) { ($reason -replace '[^A-Z0-9_]','_').Substring(0,[Math]::Min(80,($reason -replace '[^A-Z0-9_]','_').Length)) } else { '' }
    }
    $json = $report | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'display_review.json'),
        $json,[Text.UTF8Encoding]::new($false))
    Write-Host ('DISPLAY_REVIEW_'+$status)
}
) {
                    'UNQUALIFIED'
                } else { 'OTHER' }
                throw ('UNEXPECTED_COMMAND_ACTION_' + $check.Macro + '_' + $kind)
            }
            $characters = $button.Characters()
            $caption = [string]$characters.Text
            $points = [double]$characters.Font.Size
            if ([string]::IsNullOrWhiteSpace($caption) -or $points -lt 8) {
                throw ('COMMAND_CAPTION_NOT_READABLE_' + $check.Macro)
            }
            $style = if ([bool]$characters.Font.Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
            $font = [Drawing.Font]::new([string]$characters.Font.Name,
                [single]($points * $pixelsPerPoint), $style, [Drawing.GraphicsUnit]::Pixel)
            try {
                $size = $graphics.MeasureString($caption, $font, [Drawing.PointF]::Empty,
                    [Drawing.StringFormat]::GenericTypographic)
            } finally { $font.Dispose() }
            $spareWidth = [int][Math]::Floor($width * $pixelsPerPoint) - [int][Math]::Ceiling($size.Width)
            $spareHeight = [int][Math]::Floor($height * $pixelsPerPoint) - [int][Math]::Ceiling($size.Height)
            if ($spareWidth -lt 6 -or $spareHeight -lt 4) {
                throw ('COMMAND_CAPTION_CLIPS_' + $check.Macro)
            }
            [ordered]@{
                command = $check.Macro
                anchor = $check.Cell
                inside_anchor = $true
                expected_action = $true
                font_points = $points
                spare_pixels = @($spareWidth, $spareHeight)
            }
        }
    } finally {
        $graphics.Dispose()
        $surface.Dispose()
    }
}
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FurusatoWindowCapture {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rectangle);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
    // Screen.Bounds can be DPI-virtualized. Ask Windows for the CURRENT
    // display device mode; this is not the physical panel native mode.
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public int dmPositionX, dmPositionY;
        public uint dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags,
            dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType,
            dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
}
'@
    $excel = New-Object -ComObject Excel.Application
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 3 # ForceDisable; no workbook macros run.
    $excel.Visible = $true
    $book = $excel.Workbooks.Open($source,0,$true)
    if ($excel.Workbooks.Count -ne 1 -or
        -not [string]::Equals([string]$book.FullName,$source,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'UNEXPECTED_EXCEL_WORKBOOK'
    }
    $homeSheet = $book.Worksheets.Item(1)
    $homeSheet.Activate()
    $excel.ActiveWindow.Zoom = 85
    $excel.WindowState = -4137 # xlMaximized for this Excel instance.
    Start-Sleep -Milliseconds 750
    $hwnd = [IntPtr]([int]$excel.Hwnd)
    if ($hwnd -eq [IntPtr]::Zero) { throw 'NO_EXCEL_WINDOW_HANDLE' }
    $screen = [Windows.Forms.Screen]::FromHandle($hwnd)
    if ($null -eq $screen) { throw 'NO_INTERACTIVE_SCREEN' }
    # Screen bounds in this process can be DPI-virtualized. We record them
    # as observed, never as a certification of physical panel dimensions.
    $width = [int]$screen.Bounds.Width
    $height = [int]$screen.Bounds.Height
    $display = [ordered]@{
        reported_width = $width
        reported_height = $height
        dpi_virtualization_possible = $true
        display_mode_source = 'EnumDisplaySettingsW'
        current_mode_pixels = $null
        display_mode_observed = $false
        physical_resolution_verified = $false
    }
    # Get the active display mode via EnumDisplaySettingsW instead of
    # inferring device pixels from Screen.Bounds * DPI. Never promote this
    # observation to human visual acceptance on its own.
    $deviceMode = New-Object FurusatoWindowCapture+DEVMODE
    $deviceMode.dmSize = [UInt16][Runtime.InteropServices.Marshal]::SizeOf(
        [type][FurusatoWindowCapture+DEVMODE])
    $modeOk = [FurusatoWindowCapture]::EnumDisplaySettings(
        [string]$screen.DeviceName, -1, [ref]$deviceMode)
    if ($modeOk -and $deviceMode.dmPelsWidth -ge 640 -and
        $deviceMode.dmPelsWidth -le 8192 -and $deviceMode.dmPelsHeight -ge 480 -and
        $deviceMode.dmPelsHeight -le 4320) {
        $display.current_mode_pixels = @([int]$deviceMode.dmPelsWidth,
                                          [int]$deviceMode.dmPelsHeight)
        $display.display_mode_observed = $true
    }
    $rect = New-Object FurusatoWindowCapture+RECT
    if (-not [FurusatoWindowCapture]::GetWindowRect($hwnd,[ref]$rect)) {
        throw 'EXCEL_WINDOW_GEOMETRY_UNAVAILABLE'
    }
    $pxw = [int]($rect.Right-$rect.Left)
    $pxh = [int]($rect.Bottom-$rect.Top)
    $dpi = [int][FurusatoWindowCapture]::GetDpiForWindow($hwnd)
    $display.excel_window_dpi = $dpi
    $display.excel_window_size = @($pxw,$pxh)
    $display.observed_scale_percent = if ($dpi -ge 72 -and $dpi -le 384) {
        [int][Math]::Round(100*$dpi/96)
    } else { $null }
    # Only the current DEVMODE width/height can identify the observed
    # Windows output mode. This STILL is not visual sign-off or a guarantee
    # of the monitor panel's native resolution.
    $measured = $null
    if ($display.display_mode_observed -and
        $display.observed_scale_percent -in @(100,125,150)) {
        $pixels = @($display.current_mode_pixels)
        $scenario = "$($pixels[0])x$($pixels[1])@$($display.observed_scale_percent)"
        if ($scenario -in @('1920x1080@100','1920x1080@125','1366x768@150')) {
            $measured = $scenario
        }
    }
    if ($pxw -lt 500 -or $pxh -lt 400 -or $pxw -gt 6000 -or $pxh -gt 4000) {
        throw 'IMPLAUSIBLE_EXCEL_WINDOW_DIMENSIONS'
    }
    if ($null -eq $measured) { throw 'UNSUPPORTED_OR_UNMEASURED_DISPLAY_MODE' }
    # Microsoft Excel Forms-control COM can momentarily return
    # HRESULT 0x800A01A8 while rebuilding form-button references.
    # Retry only that transient error on the SAME isolated workbook;
    # all command bounds/captions/action checks remain mandatory.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $commands = @(Measure-Commands $book ($dpi * 0.85 / 72))
            if ($commands.Count -ne 15) {
                throw 'DISPLAY_COMMAND_MEASUREMENT_INCOMPLETE'
            }
            break
        } catch {
            if ($attempt -eq 3 -or $_.Exception.Message -notmatch '0x800A01A8') {
                throw
            }
            Start-Sleep -Milliseconds (500 * $attempt)
            $homeSheet.Activate()
        }
    }
    $link = $homeSheet.Range('A2').Hyperlinks.Item(1)
    if ([string]$link.Address -or [string]$link.SubAddress -cne "'操作画面'!A42") {
        throw 'UNEXPECTED_WORKSHEET_LINK_TARGET'
    }
    $link.Follow()
    if ([int]$excel.ActiveCell.Row -ne 42 -or [int]$excel.ActiveCell.Column -ne 1) {
        throw 'WORKSHEET_LINK_DID_NOT_NAVIGATE'
    }
    # On this runner a 180px crop left the ribbon and formula bar visible.
    # Limit evidence to worksheet-only regions. Include the advanced
    # municipality field that gates calculations when the rules differ.
    # No desktop-wide screenshots.
    $top = [Math]::Min(350,[int]($pxh - 300))
    $left = 20
    $cropWidth = $pxw - 40
    $cropHeight = $pxh - $top - 20
    if ($top -lt 170 -or $cropWidth -lt 420 -or $cropHeight -lt 250) {
        throw 'EXCEL_SHEET_REGION_TOO_SMALL'
    }
    foreach ($capture in @(
        @{ row = 1; focus = 'B4'; last = 12; name = 'review_excel_window_sheet_only.png' },
        @{ row = 12; focus = 'B12'; last = 24; name = 'review_excel_window_lower_section.png' },
        @{ row = 24; focus = 'D33'; last = 39; name = 'review_excel_window_mortgage_and_projection.png' },
        @{ row = 42; focus = 'D51'; last = 51; name = 'review_excel_window_municipality.png' }
    )) {
        $homeSheet.Range($capture.focus).Select()
        if ([string]$excel.ActiveCell.Address($false,$false) -cne $capture.focus) {
            throw 'WORKSHEET_INPUT_NOT_FOCUSABLE'
        }
        $excel.ActiveWindow.ScrollColumn = 1
        $excel.ActiveWindow.ScrollRow = [int]$capture.row
        Start-Sleep -Milliseconds 450
        $visible = $excel.ActiveWindow.VisibleRange
        $firstRow = [int]$visible.Row
        $lastRow = $firstRow + [int]$visible.Rows.Count - 1
        # Require an extra row and column because VisibleRange includes
        # partially visible trailing rows or columns.
        if ($firstRow -ne [int]$capture.row -or $lastRow -le [int]$capture.last -or
            [int]$visible.Column -ne 1 -or [int]$visible.Columns.Count -lt 5) {
            throw ('WORKSHEET_CONTENT_CLIPPED_BY_VIEWPORT_AT_' + $capture.row +
                '_OBSERVED_' + $firstRow + '_' + $lastRow)
        }
        # Excel/Windows compositor can return a solid-colour frame even
        # when PrintWindow reports success. Retry only this same Excel HWND:
        # never capture the desktop, never waive viewport/content gates.
        # Both supported PrintWindow modes must meet the original >=8-colour
        # worksheet proof; an all-blank run remains a release-blocking FAIL.
        $captured = $false
        $everPrinted = $false
        $captureFlags = -1
        $captureAttempt = 0
        $colors = [Collections.Generic.HashSet[int]]::new()
        for ($attempt = 1; $attempt -le 3 -and -not $captured; $attempt++) {
            $homeSheet.Activate()
            $excel.ScreenUpdating = $true
            Start-Sleep -Milliseconds (450 * $attempt)
            foreach ($flags in @(2,0)) {
                $bitmap = New-Object System.Drawing.Bitmap($pxw,$pxh)
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                try {
                    $hdc = $graphics.GetHdc()
                    try {
                        $printed = [FurusatoWindowCapture]::PrintWindow($hwnd,$hdc,[uint32]$flags)
                    } finally {
                        $graphics.ReleaseHdc($hdc)
                    }
                    if (-not $printed) { continue }
                    $everPrinted = $true
                    $crop = New-Object System.Drawing.Bitmap($cropWidth,$cropHeight)
                    try {
                        $cropGraphics = [Drawing.Graphics]::FromImage($crop)
                        try {
                            $destination = New-Object Drawing.Rectangle(0,0,$cropWidth,$cropHeight)
                            $sourceRect = New-Object Drawing.Rectangle($left,$top,$cropWidth,$cropHeight)
                            $cropGraphics.DrawImage($bitmap,$destination,$sourceRect,[Drawing.GraphicsUnit]::Pixel)
                        } finally {
                            $cropGraphics.Dispose()
                        }
                        $colors.Clear()
                        for ($x=5; $x -lt $cropWidth; $x+=31) {
                            for ($y=5; $y -lt $cropHeight; $y+=23) {
                                [void]$colors.Add($crop.GetPixel($x,$y).ToArgb())
                            }
                        }
                        if ($colors.Count -ge 8) {
                            $crop.Save((Join-Path $EvidenceDirectory $capture.name),[Drawing.Imaging.ImageFormat]::Png)
                            $captured = $true
                            $captureFlags = $flags
                            $captureAttempt = $attempt
                            break
                        }
                    } finally {
                        $crop.Dispose()
                    }
                } finally {
                    $graphics.Dispose()
                    $bitmap.Dispose()
                }
            }
        }
        if (-not $captured) {
            if (-not $everPrinted) { throw 'EXCEL_WINDOW_CAPTURE_NOT_SUPPORTED' }
            throw 'EXCEL_CAPTURE_BLANK_OR_UNRENDERED'
        }
        $pictures += [ordered]@{
            file = [string]$capture.name
            sha256 = (Get-FileHash -LiteralPath (Join-Path $EvidenceDirectory $capture.name) -Algorithm SHA256).Hash.ToLowerInvariant()
            sampled_colors = $colors.Count
            printwindow_flags = $captureFlags
            render_attempt = $captureAttempt
            pixels = @($cropWidth, $cropHeight)
        }
        $worksheetReadback += [ordered]@{
            first_row = $firstRow
            last_row = $lastRow
            first_column = [int]$visible.Column
            column_count = [int]$visible.Columns.Count
            focused_cell = [string]$capture.focus
        }
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $workbookHash) {
        throw 'DISPLAY_WORKBOOK_CHANGED_DURING_CAPTURE'
    }
    $status = 'MEASURED'
} catch {
    $reason = [string]$_.Exception.Message
    if ($reason -match 'UNEXPECTED_EXCEL_WORKBOOK|generated synthetic|isolated runner') {
        throw # Any possibility of capturing customer data must fail closed.
    }
    $status = 'UNVERIFIED'
} finally {
    if ($null -ne $book) { try { $book.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in @($book,$excel)) {
        try {
            if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj)
            }
        } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    $report = [ordered]@{
        schema = 'furusato-display-review/v2'
        status = $status
        source_head = $SourceHead
        workbook_sha256 = $workbookHash
        display_observation = $display
        mode = $measured
        excel_zoom_percent = 85
        commands = @($commands)
        worksheet_readback = @($worksheetReadback)
        screenshots = @($pictures)
        inside_workbook_link = if ($status -eq 'MEASURED') { 'A2->A42' } else { $null }
        failure_category = if ($reason) { ($reason -replace '[^A-Z0-9_]','_').Substring(0,[Math]::Min(80,($reason -replace '[^A-Z0-9_]','_').Length)) } else { '' }
    }
    $json = $report | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'display_review.json'),
        $json,[Text.UTF8Encoding]::new($false))
    Write-Host ('DISPLAY_REVIEW_'+$status)
}
