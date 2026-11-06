#Requires -Version 5.1
<#
.SYNOPSIS
Registers a NEW Furusato_nouzei repository-scoped runner on an existing Windows PC.
Does not change, stop, or reuse any other repository's runner registration.
.EXAMPLE
.\tools\register_shared_pc_runner.ps1 -Role PC1 -RunnerZip "C:\Downloads\actions-runner-win-x64.zip" -StartNow
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('PC1', 'PC2')]
    [string]$Role,
    [Parameter(Mandatory = $true)]
    [string]$RunnerZip,
    [string]$InstallRoot = (Join-Path $env:USERPROFILE 'GitHubRunners'),
    [string]$RunnerZipSha256 = '',
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/tanaka456jp/Furusato_nouzei'
$name = $env:COMPUTERNAME + '-Furusato-' + $Role
$folder = Join-Path $InstallRoot ('Furusato_nouzei-' + $Role)
$token = $null

if ($env:OS -ne 'Windows_NT') { throw 'Windows PowerShell 5.1 on a Windows desktop is required.' }
if (-not [Environment]::UserInteractive) { throw 'Run interactively as the Windows Excel user, not as a service.' }
if (-not [IO.File]::Exists($RunnerZip)) { throw "Runner ZIP missing: $RunnerZip" }
if ($RunnerZipSha256) {
    $actual = (Get-FileHash -LiteralPath $RunnerZip -Algorithm SHA256).Hash
    if ($actual -ine $RunnerZipSha256) { throw 'Runner ZIP SHA-256 does not match the expected GitHub checksum.' }
}
if (Test-Path -LiteralPath $folder) {
    throw "Refusing to modify an existing runner folder: $folder. No existing runner is ever overwritten."
}
if (-not (Test-Path -LiteralPath $InstallRoot)) {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}

# Accept only a GitHub Actions Windows runner bundle. The source of the
# archive must be verified by the user; supplying RunnerZipSha256 is recommended.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $RunnerZip).Path)
try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName })
    if ('config.cmd' -notin $entries -or 'run.cmd' -notin $entries) {
        throw 'ZIP is missing GitHub Actions Windows runner entrypoints.'
    }
} finally {
    $zip.Dispose()
}

# Check the COM class registration without starting/quitting any Excel process.
# The acceptance job later tests an isolated, newly created Excel instance.
$excelComClass = [Type]::GetTypeFromProgID('Excel.Application')
if ($null -eq $excelComClass) { throw 'Microsoft Excel COM registration was not found.' }
Write-Host 'Microsoft Excel COM registration detected (no Excel process was touched).'

# Never change existing runner processes/services, VBA Trust Center, other
# Excel instances, customer files, firewall settings or Windows policies.
Expand-Archive -LiteralPath $RunnerZip -DestinationPath $folder -ErrorAction Stop
Write-Host ('New runner folder: ' + $folder)
Write-Host ('Runner name: ' + $name)
Write-Host 'Get a temporary runner token from:'
Write-Host ($repo + '/settings/actions/runners')
Write-Host 'Select New self-hosted runner > Windows > x64.'
Write-Host 'Paste only the TOKEN (not the config command). Do not put it in chat or logs.'
$secureToken = Read-Host 'Temporary registration token (input hidden)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $secureToken = $null
}
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Runner registration token is empty.' }

Push-Location $folder
try {
    $configArgs = @('--unattended', '--url', $repo, '--token', $token, '--name', $name,
                    '--labels', ('furusato-excel,' + $Role.ToLowerInvariant()), '--work', '_work')
    & (Join-Path $folder 'config.cmd') @configArgs
    $status = $LASTEXITCODE
    $token = $null
    $configArgs = $null
    if ($status -ne 0) { throw "GitHub runner configuration failed (exit code $status)." }
    Write-Host 'Registration completed; no existing runner was changed.'
    if ($StartNow) {
        Write-Host 'Starting the new runner in this interactive Windows session.'
        Write-Host 'Leave this window open for Excel acceptance. Ctrl+C stops only this new runner.'
        & (Join-Path $folder 'run.cmd')
        if ($LASTEXITCODE -ne 0) { throw "GitHub runner stopped with exit code $LASTEXITCODE." }
    } else {
        Write-Host ('Run this command to start only the new runner: ' + (Join-Path $folder 'run.cmd'))
    }
} finally {
    $token = $null
    $configArgs = $null
    Pop-Location
}
