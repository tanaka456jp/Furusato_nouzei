<#
 Sign a local Excel VBA project using Microsoft Office SIP + Windows SDK x86 SignTool.
 Local preflight is default; -Execute requires an opt-in and never runs in CI.
 This does not generate, export, import, or upload private signing keys.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourceWorkbook,
    [Parameter(Mandatory=$true)][string]$OutputWorkbook,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$CertificateThumbprint,
    [string]$SignToolX86 = '',
    [string]$TimestampUrl = '',
    [string]$EvidencePath = '',
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedSourceSha256,
    [switch]$Execute,
    [switch]$AllowUntrustedTestCertificate
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-LocalSigningContext {
    if ($Execute -and ($env:CI -eq 'true' -or $env:GITHUB_ACTIONS -eq 'true' -or
                       $env:TF_BUILD -eq 'True')) {
        throw 'SIGNING_IN_CI_FORBIDDEN_USE_PRIVATE_LOCAL_MACHINE'
    }
}
function Find-X86SignTool {
    if ($SignToolX86) {
        $candidate = [IO.Path]::GetFullPath($SignToolX86)
        if ($candidate -notmatch '(?i)[\\/]x86[\\/]signtool\.exe$' -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw 'X86_SIGNTOOL_PATH_INVALID'
        }
        return $candidate
    }
    $programFiles86 = [Environment]::GetFolderPath('ProgramFilesX86')
    if (-not $programFiles86) { throw 'X86_WINDOWS_SDK_NOT_FOUND' }
    $kit = Join-Path $programFiles86 'Windows Kits\10\bin'
    if (-not (Test-Path -LiteralPath $kit -PathType Container)) {
        throw 'X86_WINDOWS_SDK_NOT_FOUND'
    }
    $found = @(Get-ChildItem -LiteralPath $kit -Directory |
        Sort-Object -Property Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'x86\signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    if ($found.Count -eq 0) { throw 'X86_SIGNTOOL_NOT_FOUND' }
    return [string]$found[0]
}
function Require-CodeSigningCertificate([string]$thumbprint) {
    $cert = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $thumbprint) -ErrorAction SilentlyContinue
    if ($null -eq $cert) { throw 'CODE_SIGNING_CERTIFICATE_NOT_FOUND_IN_CURRENT_USER_MY' }
    if (-not $cert.HasPrivateKey) { throw 'SIGNING_PRIVATE_KEY_NOT_ACCESSIBLE' }
    $now = [DateTime]::UtcNow
    if ($now -lt $cert.NotBefore.ToUniversalTime() -or
        $now -ge $cert.NotAfter.ToUniversalTime()) {
        throw 'SIGNING_CERTIFICATE_EXPIRED_OR_NOT_YET_VALID'
    }
    $hasCodeSigningEku = $false
    foreach ($extension in $cert.Extensions) {
        if ($extension.Oid.Value -ne '2.5.29.37') { continue }
        foreach ($eku in $extension.EnhancedKeyUsages) {
            if ($eku.Value -eq '1.3.6.1.5.5.7.3.3') {
                $hasCodeSigningEku = $true
            }
        }
    }
    if (-not $hasCodeSigningEku) { throw 'CODE_SIGNING_EKU_REQUIRED' }
    if (-not $AllowUntrustedTestCertificate) {
        $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
        try {
            $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
            if (-not $chain.Build($cert)) {
                throw 'CERTIFICATE_CHAIN_OR_REVOCATION_NOT_VALIDATED'
            }
        } finally {
            $chain.Reset()
        }
    }
    return $cert
}
function Require-VbaWorkbook([string]$path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $parts = @($archive.Entries | Where-Object { $_.FullName -ceq 'xl/vbaProject.bin' })
        if ($parts.Count -ne 1 -or $parts[0].Length -lt 256) {
            throw 'XLSM_MISSING_UNIQUE_VBA_PROJECT'
        }
        $existingSignature = @($archive.Entries | Where-Object {
            $_.FullName -cmatch '^xl/vbaProjectSignature(?:Agile|V3)?\.bin$'
        })
        if ($existingSignature.Count -gt 0) {
            throw 'SOURCE_WORKBOOK_ALREADY_HAS_VBA_SIGNATURE'
        }
    } finally {
        $archive.Dispose()
    }
}
function Get-VbaProjectSha256([string]$path) {
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $parts = @($archive.Entries | Where-Object { $_.FullName -ceq 'xl/vbaProject.bin' })
        if ($parts.Count -ne 1) { throw 'SIGNED_WORKBOOK_VBA_PROJECT_NOT_UNIQUE' }
        $stream = $parts[0].Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()
        } finally {
            $hasher.Dispose()
            $stream.Dispose()
        }
    } finally {
        $archive.Dispose()
    }
}
function Invoke-OfficeSignTool([string]$tool, [string[]]$arguments, [string]$failureCode) {
    # Do not expose signing-provider diagnostics, user identities or key aliases.
    & $tool @arguments 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw $failureCode }
}
function Assert-OfficeRecognizesSignature([string]$path) {
    $office = $null
    $book = $null
    try {
        $office = New-Object -ComObject Excel.Application -ErrorAction Stop
        $office.Visible = $false
        $office.DisplayAlerts = $false
        $office.EnableEvents = $false
        $office.AskToUpdateLinks = $false
        # Disable macro execution during inspection, even for trusted signatures.
        $office.AutomationSecurity = 3
        $book = $office.Workbooks.Open($path, 0, $true)
        if ($null -eq $book -or $book.HasVBProject -ne $true) {
            throw 'OFFICE_SIGNED_WORKBOOK_VBA_PROJECT_MISSING'
        }
        if ($book.VBASigned -ne $true) {
            throw 'OFFICE_VBA_SIGNATURE_NOT_RECOGNIZED'
        }
    } finally {
        if ($null -ne $book) {
            try { $book.Close($false) } finally {
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book)
            }
        }
        if ($null -ne $office) {
            try { $office.Quit() } finally {
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($office)
            }
        }
    }
}

$destinationCreated = $false
$destination = $null
try {
    Require-LocalSigningContext
    $source = (Resolve-Path -LiteralPath $SourceWorkbook -ErrorAction Stop).Path
    $destination = [IO.Path]::GetFullPath($OutputWorkbook)
    if ([IO.Path]::GetExtension($source) -ine '.xlsm' -or
        [IO.Path]::GetExtension($destination) -ine '.xlsm') {
        throw 'XLSM_ONLY'
    }
    if ([string]::Equals($source, $destination,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw 'SIGNING_MUST_NOT_MODIFY_ORIGINAL_WORKBOOK'
    }
    if (Test-Path -LiteralPath $destination) { throw 'REFUSE_TO_OVERWRITE_SIGNED_OUTPUT' }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $destination) -PathType Container)) {
        throw 'SIGNED_OUTPUT_PARENT_MISSING'
    }
    if ($AllowUntrustedTestCertificate -and
        -not ([IO.Path]::GetFileName($destination) -match '(?i)_TEST_ONLY\.xlsm$')) {
        throw 'UNTRUSTED_TEST_SIGNATURE_REQUIRES_TEST_ONLY_FILENAME'
    }
    if ($EvidencePath) {
        $evidence = [IO.Path]::GetFullPath($EvidencePath)
        if (Test-Path -LiteralPath $evidence) {
            throw 'REFUSE_TO_OVERWRITE_SIGNATURE_EVIDENCE'
        }
        if ([string]::Equals($evidence, $source, [StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($evidence, $destination, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'SIGNATURE_EVIDENCE_OVERLAPS_WORKBOOK'
        }
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $evidence) -PathType Container)) {
            throw 'SIGNATURE_EVIDENCE_PARENT_MISSING'
        }
    }
    Require-VbaWorkbook $source
    $sourceSha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceSha -cne $ExpectedSourceSha256.ToLowerInvariant()) {
        throw 'SOURCE_WORKBOOK_SHA256_NOT_ACCEPTED'
    }
    $originalVbaSha = Get-VbaProjectSha256 $source
    if (-not $AllowUntrustedTestCertificate) {
        $uri = $null
        if (-not [Uri]::TryCreate($TimestampUrl, [UriKind]::Absolute, [ref]$uri) -or
            $null -eq $uri -or $uri.Scheme -ne 'https') {
            throw 'HTTPS_RFC3161_TIMESTAMP_URL_REQUIRED'
        }
    }
    $tool = Find-X86SignTool
    $thumb = $CertificateThumbprint.ToUpperInvariant()
    $cert = Require-CodeSigningCertificate $thumb
    if (-not $Execute) {
        Write-Host 'EXCEL_VBA_SIGNING_PREFLIGHT_PASS_EXECUTION_NOT_REQUESTED'
        return
    }
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
    $destinationCreated = $true
    $arguments = @('sign', '/sha1', $thumb, '/s', 'My', '/fd', 'SHA256')
    if ($TimestampUrl) { $arguments += @('/tr', $TimestampUrl, '/td', 'SHA256') }
    $arguments += @($destination)
    Invoke-OfficeSignTool $tool $arguments 'OFFICE_SIP_SIGNTOOL_SIGN_FAILED'
    if (-not $AllowUntrustedTestCertificate) {
        Invoke-OfficeSignTool $tool @('verify','/pa',$destination) 'OFFICE_SIP_SIGNTOOL_VERIFY_FAILED'
    }
    Assert-OfficeRecognizesSignature $destination
    $signedSha = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($signedSha -eq $sourceSha) { throw 'SIGNING_DID_NOT_CHANGE_WORKBOOK_BYTES' }
    $signedVbaSha = Get-VbaProjectSha256 $destination
    if ($signedVbaSha -cne $originalVbaSha) {
        throw 'SIGNED_VBA_PROJECT_DIFFERS_FROM_ACCEPTED_INPUT'
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sourceSha) {
        throw 'ACCEPTED_SOURCE_WORKBOOK_CHANGED_DURING_SIGNING'
    }
    if ($EvidencePath) {
        $record = [ordered]@{
            schema = 'furusato-local-vba-signing/v1'
            source_workbook_sha256 = $sourceSha
            signed_workbook_sha256 = $signedSha
            accepted_vba_project_sha256 = $originalVbaSha
            signed_vba_project_sha256 = $signedVbaSha
            signing_certificate_eku = 'CODE_SIGNING'
            certificate_thumbprint_matched = $true
            office_vba_signed_property = 'OFFICE_RECOGNIZED_SIGNED_PROJECT'
            signtool_verified = (-not $AllowUntrustedTestCertificate)
            certificate_chain_verified = (-not $AllowUntrustedTestCertificate)
            test_only = [bool]$AllowUntrustedTestCertificate
            release_approved = $false
        }
        $record | ConvertTo-Json -Depth 5 |
            Set-Content -LiteralPath $evidence -Encoding UTF8 -ErrorAction Stop
    }
    if ($AllowUntrustedTestCertificate) {
        Write-Host 'EXCEL_VBA_SIGNED_LOCAL_TEST_ONLY_NOT_FOR_DISTRIBUTION'
    } else {
        Write-Host 'EXCEL_VBA_SIGNED_OFFICE_RECOGNIZED_RELEASE_STILL_HOLD'
    }
} catch {
    if ($destinationCreated -and $destination -and
        (Test-Path -LiteralPath $destination)) {
        Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    }
    $code = $_.Exception.Message
    if ($code -notmatch '^[A-Z0-9_]+$') { $code = 'LOCAL_SIGNING_FAILED' }
    throw $code
}
