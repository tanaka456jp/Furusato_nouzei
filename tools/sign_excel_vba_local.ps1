<#
 Sign a local Excel VBA project using Microsoft Office SIP + Windows SDK x86 SignTool.
 Local preflight is default. CI execution requires an explicitly approved,
 exact-HEAD private signing context on the repository's self-hosted runner.
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
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedHeadSha,
    [switch]$Execute,
    [switch]$PrivateSelfHostedRunner,
    [switch]$AllowUntrustedTestCertificate
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'office_vba_signature_common.ps1')

function Require-LocalSigningContext {
    if (-not $PrivateSelfHostedRunner -and $Execute -and
        ($env:CI -eq 'true' -or $env:GITHUB_ACTIONS -eq 'true' -or $env:TF_BUILD -eq 'True')) {
        throw 'SIGNING_IN_CI_FORBIDDEN_USE_PRIVATE_LOCAL_MACHINE'
    }
    if (-not $PrivateSelfHostedRunner) { return }
    $branch = 'fix/excel-2026-salary-nta-20261107'
    $repository = 'tanaka456jp/Furusato_nouzei'
    if ($AllowUntrustedTestCertificate -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'self-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        $env:GITHUB_REPOSITORY -cne $repository -or $ExpectedHeadSha -cnotmatch '^[0-9a-f]{40}$' -or
        $env:FURUSATO_SIGNING_APPROVED_HEAD -cne $ExpectedHeadSha -or
        $env:FURUSATO_SIGNING_THUMBPRINT -ine $CertificateThumbprint -or
        $env:FURUSATO_SIGNING_TIMESTAMP_URL -cne $TimestampUrl) {
        throw 'PRIVATE_RUNNER_SIGNING_CONTEXT_NOT_APPROVED'
    }
    if ($env:GITHUB_EVENT_NAME -ceq 'pull_request') {
        $event = Get-Content -LiteralPath $env:GITHUB_EVENT_PATH -Raw | ConvertFrom-Json
        if ($event.number -ne 5 -or $event.pull_request.head.repo.full_name -cne $repository -or
            $event.pull_request.head.ref -cne $branch -or $event.pull_request.head.sha -cne $ExpectedHeadSha) {
            throw 'PRIVATE_RUNNER_SIGNING_PR_NOT_APPROVED'
        }
    } elseif ($env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
              $env:GITHUB_REF -cne "refs/heads/$branch" -or $env:GITHUB_SHA -cne $ExpectedHeadSha) {
        throw 'PRIVATE_RUNNER_SIGNING_BRANCH_NOT_APPROVED'
    }
    $checkedOut = [string](& git -C (Split-Path -Parent $PSScriptRoot) rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $checkedOut -cne $ExpectedHeadSha) {
        throw 'PRIVATE_RUNNER_SIGNING_CHECKED_OUT_HEAD_MISMATCH'
    }
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
        if (($cert.SubjectName.RawData -join ':') -ceq ($cert.IssuerName.RawData -join ':')) {
            throw 'SELF_ISSUED_CERTIFICATE_NOT_ALLOWED_FOR_RELEASE'
        }
        $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
        try {
            $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
            [void]$chain.ChainPolicy.ApplicationPolicy.Add((New-Object Security.Cryptography.Oid('1.3.6.1.5.5.7.3.3')))
            $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(15)
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
    $sourceSha = Get-SignatureFileSha256 $source
    if ($sourceSha -cne $ExpectedSourceSha256.ToLowerInvariant()) {
        throw 'SOURCE_WORKBOOK_SHA256_NOT_ACCEPTED'
    }
    $originalVbaSha = Get-VbaProjectSha256 $source
    if (-not $AllowUntrustedTestCertificate) {
        $uri = $null
        if (-not [Uri]::TryCreate($TimestampUrl, [UriKind]::Absolute, [ref]$uri) -or
            $null -eq $uri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or
            $uri.Query -or $uri.Fragment -or $uri.IsLoopback) {
            throw 'HTTPS_RFC3161_TIMESTAMP_URL_REQUIRED'
        }
    }
    $thumb = $CertificateThumbprint.ToUpperInvariant()
    $cert = Require-CodeSigningCertificate $thumb
    $tool = Find-X86SignTool $SignToolX86
    Require-X86OfficeSip
    if (-not $Execute) {
        Write-Host 'EXCEL_VBA_SIGNING_PREFLIGHT_PASS_EXECUTION_NOT_REQUESTED'
        return
    }
    [IO.File]::Copy($source, $destination, $false)
    $destinationCreated = $true
    if ((Get-SignatureFileSha256 $destination) -cne $sourceSha) {
        throw 'SIGNING_COPY_DIFFERS_FROM_ACCEPTED_INPUT'
    }
    $arguments = @('sign', '/sha1', $thumb, '/s', 'My', '/fd', 'SHA256')
    if ($TimestampUrl) { $arguments += @('/tr', $TimestampUrl, '/td', 'SHA256') }
    $arguments += @($destination)
    Invoke-OfficeSignTool $tool $arguments 'OFFICE_SIP_SIGNTOOL_SIGN_FAILED'
    if (-not $AllowUntrustedTestCertificate) {
        Assert-VerifiedOfficeVbaSignature $tool $destination $thumb
    }
    Assert-OfficeRecognizesSignature $destination
    $signedSha = Get-SignatureFileSha256 $destination
    if ($signedSha -eq $sourceSha) { throw 'SIGNING_DID_NOT_CHANGE_WORKBOOK_BYTES' }
    $signedVbaSha = Get-VbaProjectSha256 $destination
    if ($signedVbaSha -cne $originalVbaSha) {
        throw 'SIGNED_VBA_PROJECT_DIFFERS_FROM_ACCEPTED_INPUT'
    }
    if ((Get-SignatureFileSha256 $source) -cne $sourceSha) {
        throw 'ACCEPTED_SOURCE_WORKBOOK_CHANGED_DURING_SIGNING'
    }
    if ($EvidencePath) {
        $record = [ordered]@{
            schema = 'furusato-local-vba-signing/v2'
            head_sha = $ExpectedHeadSha
            signing_state = $(if ($AllowUntrustedTestCertificate) { 'TEST_ONLY' } else { 'SIGNED' })
            availability = 'AVAILABLE'
            source_workbook_sha256 = $sourceSha
            signed_workbook_sha256 = $signedSha
            accepted_vba_project_sha256 = $originalVbaSha
            signed_vba_project_sha256 = $signedVbaSha
            signing_certificate_eku = 'CODE_SIGNING'
            certificate_thumbprint_matched = $true
            office_vba_signed_property = 'OFFICE_RECOGNIZED_SIGNED_PROJECT'
            signtool_verified = (-not $AllowUntrustedTestCertificate)
            certificate_chain_verified = (-not $AllowUntrustedTestCertificate)
            timestamp_verified = (-not $AllowUntrustedTestCertificate)
            test_only = [bool]$AllowUntrustedTestCertificate
            release_approved = $false
        }
        $evidenceFile = [IO.File]::Open($evidence, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Depth 5) + "`n")
            $evidenceFile.Write($bytes, 0, $bytes.Length)
        } finally {
            $evidenceFile.Dispose()
        }
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
