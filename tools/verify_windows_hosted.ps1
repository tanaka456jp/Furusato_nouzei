#Requires -Version 5.1
<#
.SYNOPSIS
Checks Windows PowerShell 5.1 syntax, ZIP extraction in a Japanese path,
the exact packaged source files, and OOXML structure on GitHub-hosted Windows.
This script intentionally does not start Excel or attempt to enable macros.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Package)
$ErrorActionPreference = 'Stop'

function Require([bool]$ok, [string]$reason) {
    if (-not $ok) { throw $reason }
}

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packagePath = (Resolve-Path -LiteralPath $Package).Path

foreach ($source in @(
    'tools/setup.ps1',
    'tools/verify_excel.ps1',
    'tools/verify_stale_ui.ps1',
    'tools/register_shared_pc_runner.ps1',
    'tools/verify_windows_hosted.ps1',
    'tools/probe_excel_open.ps1',
    'tools/run_excel_open_probe.ps1',
    'tools/verify_vbaupdater_bridge.ps1'
)) {
    $tokens = $null
    $errors = $null
    $path = Join-Path $root $source
    [System.Management.Automation.Language.Parser]::ParseFile(
        $path, [ref]$tokens, [ref]$errors
    ) | Out-Null
    Require ($errors.Count -eq 0) ("PowerShell 5.1 syntax failure in " + $source + ": " + ($errors | Out-String))
}

# Windows PowerShell 5.1 decodes BOM-less non-ASCII scripts as ANSI.
# The real-device stale-result gate contains Japanese input literals.
$staleBytes = [IO.File]::ReadAllBytes((Join-Path $root 'tools/verify_stale_ui.ps1'))
$hasBom = ($staleBytes.Length -ge 3) -and ($staleBytes[0] -eq 239) -and
          ($staleBytes[1] -eq 187) -and ($staleBytes[2] -eq 191)
Require $hasBom 'Stale-result PowerShell gate must have UTF-8 BOM on Windows PowerShell 5.1'

$testRoot = Join-Path $env:RUNNER_TEMP ('Furusato_受入_日本語_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $extracted = Join-Path $testRoot '配布ファイル'
    Expand-Archive -LiteralPath $packagePath -DestinationPath $extracted
    $actual = @(Get-ChildItem -LiteralPath $extracted -File | ForEach-Object Name | Sort-Object)
    $expected = @(
        'Furusato_nouzei.xlsx', 'README.txt', 'START_SETUP.cmd',
        'TaxLawUpdater.bas', 'setup.ps1', 'withholding_reader.py'
    ) | Sort-Object
    Require (($actual -join '|') -ceq ($expected -join '|')) 'Unexpected files in review ZIP'

    $pairs = @{
        'START_SETUP.cmd' = 'tools/START_SETUP.cmd'
        'setup.ps1' = 'tools/setup.ps1'
        'TaxLawUpdater.bas' = 'vba/TaxLawUpdater.bas'
        'README.txt' = 'docs/user-guide.md'
        'withholding_reader.py' = 'tools/withholding_reader.py'
    }
    foreach ($file in $pairs.Keys) {
        $expectedHash = (Get-FileHash -LiteralPath (Join-Path $root $pairs[$file]) -Algorithm SHA256).Hash
        $actualHash = (Get-FileHash -LiteralPath (Join-Path $extracted $file) -Algorithm SHA256).Hash
        Require ($actualHash -ceq $expectedHash) ("Packaged file differs from repository: " + $file)
    }

    $cmdBytes = [IO.File]::ReadAllBytes((Join-Path $extracted 'START_SETUP.cmd'))
    Require (@($cmdBytes | Where-Object { $_ -gt 127 }).Count -eq 0) 'CMD bootstrap must be ASCII-safe'

    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $bas = [IO.File]::ReadAllText((Join-Path $extracted 'TaxLawUpdater.bas'), $strictUtf8)
    Require ($bas.Contains('Attribute VB_Name = "TaxLawUpdater"')) 'VBA source encoding is damaged'
    Require ($bas.Contains('Public Sub TaxLawUpdate()')) 'VBA tax-update procedure missing'
    Require ($bas.Contains('Public Function ExportDetailsToFile(')) 'VBA PDF export procedure missing'

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $xlsx = [IO.Compression.ZipFile]::OpenRead((Join-Path $extracted 'Furusato_nouzei.xlsx'))
    try {
        $entries = @($xlsx.Entries | ForEach-Object FullName)
        Require ($entries -contains 'xl/workbook.xml') 'XLSX workbook XML missing'
        Require ($entries -contains 'xl/styles.xml') 'XLSX styles XML missing'
        Require ($entries -notcontains 'xl/vbaProject.bin') 'Review XLSX must not claim to contain VBA'
        Require ($entries.Count -gt 20) 'XLSX archive is unexpectedly small'
    } finally {
        $xlsx.Dispose()
    }
    Write-Output 'PASS: GitHub-hosted Windows 5.1 parse; Japanese path/ZIP; ASCII launcher; UTF-8 VBA; source hashes; OOXML structure.'
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
