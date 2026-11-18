#Requires -Version 5.1
<#
 Local-only Authenticode signing for the accepted offline PDF reader EXE.
 Dry-run is the default. No key/certificate creation, import, export, or upload.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourceExe,
    [Parameter(Mandatory=$true)][string]$OutputExe,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSourceSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CertificateThumbprint,
    [Parameter(Mandatory=$true)][string]$TimestampUrl,
    [string]$SignToolPath = '',
    [string]$EvidencePath = '',
    [switch]$Execute
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function FileSha([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Assert-Pe([string]$path) {
    $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 1024 -or $stream.Length -gt 120000000) { throw 'READER_EXE_SIZE_INVALID' }
        $r=New-Object IO.BinaryReader($stream)
        try {
            if ($r.ReadUInt16() -ne 0x5a4d) { throw 'READER_EXE_MZ_INVALID' }
            [void]$stream.Seek(0x3c,[IO.SeekOrigin]::Begin)
            $pos=$r.ReadInt32()
            if ($pos -lt 64 -or $pos -gt 65536 -or $pos+4 -gt $stream.Length) {
                throw 'READER_EXE_PE_OFFSET_INVALID'
            }
            [void]$stream.Seek($pos,[IO.SeekOrigin]::Begin)
            if ($r.ReadUInt32() -ne 0x00004550) { throw 'READER_EXE_PE_SIGNATURE_INVALID' }
        } finally { $r.Dispose() }
    } finally { $stream.Dispose() }
}
function Assert-PrivatePath([string]$path) {
    $root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
    if ($path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($root,$path,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'READER_SIGNING_PRIVATE_OUTPUT_REQUIRED'
    }
}
function Get-TrustedSigner([string]$thumb) {
    $cert=Get-Item -LiteralPath ('Cert:\CurrentUser\My\'+$thumb) -ErrorAction SilentlyContinue
    if ($null -eq $cert) { throw 'READER_CODE_SIGNING_CERTIFICATE_NOT_FOUND' }
    if (-not $cert.HasPrivateKey) { throw 'READER_PRIVATE_KEY_UNAVAILABLE' }
    $now=[DateTime]::UtcNow
    if ($now -lt $cert.NotBefore.ToUniversalTime() -or
        $now -ge $cert.NotAfter.ToUniversalTime()) { throw 'READER_CERTIFICATE_OUTSIDE_VALIDITY' }
    $found=$false
    foreach ($ext in $cert.Extensions) {
        if ($ext.Oid.Value -ne '2.5.29.37') { continue }
        foreach ($eku in $ext.EnhancedKeyUsages) {
            if ($eku.Value -eq '1.3.6.1.5.5.7.3.3') { $found=$true }
        }
    }
    if (-not $found) { throw 'READER_CODE_SIGNING_EKU_MISSING' }
    if (($cert.SubjectName.RawData -join ':') -ceq ($cert.IssuerName.RawData -join ':')) {
        throw 'READER_SELF_SIGNED_CERTIFICATE_UNTRUSTED'
    }
    $chain=New-Object Security.Cryptography.X509Certificates.X509Chain
    try {
        $chain.ChainPolicy.RevocationMode=[Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.UrlRetrievalTimeout=[TimeSpan]::FromSeconds(15)
        [void]$chain.ChainPolicy.ApplicationPolicy.Add(
            (New-Object Security.Cryptography.Oid('1.3.6.1.5.5.7.3.3')))
        if (-not $chain.Build($cert)) { throw 'READER_SIGNER_TRUST_CHAIN_FAILED' }
    } finally { $chain.Reset() }
    return $cert
}
function Find-SignTool([string]$explicit) {
    if ($explicit) {
        $tool=(Resolve-Path -LiteralPath $explicit -ErrorAction Stop).Path
        if ([IO.Path]::GetFileName($tool) -ine 'signtool.exe') {
            throw 'READER_SIGNTOOL_NAME_INVALID'
        }
        return $tool
    }
    $base=[Environment]::GetFolderPath('ProgramFilesX86')
    $kits=Join-Path $base 'Windows Kits\10\bin'
    if (-not (Test-Path -LiteralPath $kits -PathType Container)) {
        throw 'READER_WINDOWS_SDK_NOT_INSTALLED'
    }
    $tools=@(Get-ChildItem -LiteralPath $kits -Filter signtool.exe -File -Recurse |
        Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
        Sort-Object FullName -Descending)
    if ($tools.Count -eq 0) { throw 'READER_WINDOWS_SDK_NOT_INSTALLED' }
    return $tools[0].FullName
}
$created=$false
$target=$null
try {
    # This is a manual operator task, not an Actions signing path.
    if ($Execute -and ($env:CI -eq 'true' -or $env:GITHUB_ACTIONS -eq 'true' -or
                       $env:TF_BUILD -eq 'True')) {
        throw 'READER_SIGNING_IN_CI_FORBIDDEN'
    }
    $source=(Resolve-Path -LiteralPath $SourceExe -ErrorAction Stop).Path
    $target=[IO.Path]::GetFullPath($OutputExe)
    if ([IO.Path]::GetExtension($source) -ine '.exe' -or
        [IO.Path]::GetExtension($target) -ine '.exe') {
        throw 'READER_SIGNING_REQUIRES_EXE'
    }
    if ([string]::Equals($source,$target,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'READER_SIGNING_SOURCE_OVERWRITE_FORBIDDEN'
    }
    Assert-PrivatePath $target
    if ((Test-Path -LiteralPath $target) -or
        -not (Test-Path -LiteralPath (Split-Path -Parent $target) -PathType Container)) {
        throw 'READER_SIGNING_OUTPUT_PATH_INVALID'
    }
    if ($EvidencePath) {
        $evidence=[IO.Path]::GetFullPath($EvidencePath)
        Assert-PrivatePath $evidence
        if ((Test-Path -LiteralPath $evidence) -or
            [string]::Equals($evidence,$source,[StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($evidence,$target,[StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath (Split-Path -Parent $evidence) -PathType Container)) {
            throw 'READER_SIGNING_EVIDENCE_PATH_INVALID'
        }
    }
    Assert-Pe $source
    $sourceSha=FileSha $source
    if ($sourceSha -cne $ExpectedSourceSha256.ToLowerInvariant()) {
        throw 'READER_SOURCE_SHA256_NOT_ACCEPTED'
    }
    if ((Get-AuthenticodeSignature -LiteralPath $source).Status -ne
        [Management.Automation.SignatureStatus]::NotSigned) {
        throw 'READER_SOURCE_SIGNATURE_NOT_CLEAN'
    }
    $uri=$null
    if (-not [Uri]::TryCreate($TimestampUrl,[UriKind]::Absolute,[ref]$uri) -or
        $null -eq $uri -or $uri.Scheme -cne 'https' -or $uri.UserInfo -or
        $uri.Query -or $uri.Fragment -or $uri.IsLoopback) {
        throw 'READER_HTTPS_RFC3161_TIMESTAMP_REQUIRED'
    }
    $thumb=$CertificateThumbprint.ToUpperInvariant()
    $cert=Get-TrustedSigner $thumb
    $tool=Find-SignTool $SignToolPath
    if (-not $Execute) {
        Write-Host 'READER_SIGNER_PREFLIGHT_OK_NOT_EXECUTED'
        return
    }
    [IO.File]::Copy($source,$target,$false)
    $created=$true
    if ((FileSha $target) -cne $sourceSha) { throw 'READER_SIGNING_COPY_CHANGED' }
    & $tool sign /sha1 $thumb /s My /fd SHA256 /tr $TimestampUrl /td SHA256 $target 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'READER_SIGNTOOL_SIGN_FAILED' }
    & $tool verify /pa /all /tw $target 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'READER_SIGNTOOL_VERIFY_FAILED' }
    $signature=Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Thumbprint -ine $thumb -or
        $null -eq $signature.TimeStamperCertificate) {
        throw 'READER_AUTHENTICODE_TRUST_OR_TIMESTAMP_INVALID'
    }
    $signedSha=FileSha $target
    if ($signedSha -ceq $sourceSha -or (FileSha $source) -cne $sourceSha) {
        throw 'READER_SIGNING_OUTPUT_OR_SOURCE_INTEGRITY_FAILED'
    }
    if ($EvidencePath) {
        $record=[ordered]@{
            schema='furusato-reader-authenticode-local/v1'
            signing_state='SIGNED'
            source_exe_sha256=$sourceSha
            signed_exe_sha256=$signedSha
            signer_certificate_verified=$true
            signer_chain_verified=$true
            timestamp_verified=$true
            release_approved=$false
        }
        $file=[IO.File]::Open($evidence,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
        try {
            $bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Depth 3)+[Environment]::NewLine)
            $file.Write($bytes,0,$bytes.Length)
        } finally { $file.Dispose() }
    }
    Write-Host 'READER_EXE_SIGNED_LOCALLY_RELEASE_STILL_HOLD'
} catch {
    if ($created -and $target -and (Test-Path -LiteralPath $target)) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    }
    $code=$_.Exception.Message
    if ($code -cnotmatch '^[A-Z0-9_]+$') { $code='READER_LOCAL_SIGNING_FAILED' }
    throw $code
}
