#Requires -Version 5.1
# Isolated synthetic workbook only. Never capture the whole desktop.
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory
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
$pictureName = $null
$measured = $null
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
}
'@
    $screen = [Windows.Forms.Screen]::PrimaryScreen
    if ($null -eq $screen) { throw 'NO_INTERACTIVE_SCREEN' }
    # Screen bounds in this process can be DPI-virtualized. We record them
    # as observed, never as a certification of physical panel dimensions.
    $width = [int]$screen.Bounds.Width
    $height = [int]$screen.Bounds.Height
    $display = [ordered]@{ reported_width = $width; reported_height = $height; dpi_virtualization_possible = $true }
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
    $book.Worksheets.Item(1).Activate()
    $excel.ActiveWindow.Zoom = 85
    $excel.WindowState = -4143 # xlNormal
    $excel.Width = [Math]::Min(1000,[Math]::Max(650,$width - 120))
    $excel.Height = [Math]::Min(760,[Math]::Max(550,$height - 120))
    $excel.Left = 20
    $excel.Top = 20
    Start-Sleep -Milliseconds 750
    $hwnd = [IntPtr]([int]$excel.Hwnd)
    if ($hwnd -eq [IntPtr]::Zero) { throw 'NO_EXCEL_WINDOW_HANDLE' }
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
    $measured = if ($width -eq 1920 -and $height -eq 1080 -and
                       $display.observed_scale_percent -in @(100,125)) {
        "$($width)x$($height)@$($display.observed_scale_percent)"
    } elseif ($width -eq 1366 -and $height -eq 768 -and
              $display.observed_scale_percent -eq 150) {
        '1366x768@150'
    } else { $null }
    if ($pxw -lt 500 -or $pxh -lt 400 -or $pxw -gt 6000 -or $pxh -gt 4000) {
        throw 'IMPLAUSIBLE_EXCEL_WINDOW_DIMENSIONS'
    }
    $bitmap = New-Object System.Drawing.Bitmap($pxw,$pxh)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $hdc = $graphics.GetHdc()
        try {
            $printed = [FurusatoWindowCapture]::PrintWindow($hwnd,$hdc,2)
        } finally {
            $graphics.ReleaseHdc($hdc)
        }
        if (-not $printed) {
            throw 'EXCEL_WINDOW_CAPTURE_NOT_SUPPORTED'
        }
        # Strip title/ribbon and taskbar to exclude account names or other
        # application UI. PrintWindow captures only this Excel HWND.
        $left = 20
        $top = [Math]::Min(180,[int]($pxh/3))
        $cropWidth = $pxw - 40
        $cropHeight = $pxh - $top - 20
        if ($cropWidth -lt 420 -or $cropHeight -lt 250) {
            throw 'EXCEL_SHEET_REGION_TOO_SMALL'
        }
        $crop = New-Object System.Drawing.Bitmap($cropWidth,$cropHeight)
        $cropGraphics = [Drawing.Graphics]::FromImage($crop)
        try {
            $destination = New-Object Drawing.Rectangle(0,0,$cropWidth,$cropHeight)
            $sourceRect = New-Object Drawing.Rectangle($left,$top,$cropWidth,$cropHeight)
            $cropGraphics.DrawImage($bitmap,$destination,$sourceRect,[Drawing.GraphicsUnit]::Pixel)
        } finally {
            $cropGraphics.Dispose()
        }
        try {
            $colors = [Collections.Generic.HashSet[int]]::new()
            for ($x=5; $x -lt $cropWidth; $x+=31) {
                for ($y=5; $y -lt $cropHeight; $y+=23) {
                    [void]$colors.Add($crop.GetPixel($x,$y).ToArgb())
                }
            }
            if ($colors.Count -lt 8) {
                throw 'EXCEL_CAPTURE_BLANK_OR_UNRENDERED'
            }
            $pictureName = 'review_excel_window_sheet_only.png'
            $crop.Save((Join-Path $EvidenceDirectory $pictureName),[Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $crop.Dispose()
        }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    $status = 'CAPTURED_REQUIRES_VISUAL_REVIEW'
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
        schema = 'furusato-display-review/v1'
        status = $status
        release_approved = $false
        generated_workbook_sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        display_observation = $display
        scenario_observed_not_certified = $measured
        screenshot = $pictureName
        unverified_scenarios = @('1920x1080@100','1920x1080@125','1366x768@150')
        limitation = 'Observed runner display only; no display configuration changed; visual inspection and other resolutions remain HOLD'
        failure_category = if ($reason) { ($reason -replace '[^A-Z0-9_]','_').Substring(0,[Math]::Min(80,($reason -replace '[^A-Z0-9_]','_').Length)) } else { '' }
    }
    $json = $report | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'display_review.json'),
        $json,[Text.UTF8Encoding]::new($false))
    Write-Host ('DISPLAY_REVIEW_'+$status)
}
