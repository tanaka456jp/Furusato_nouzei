#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourceWorkbook,
    [Parameter(Mandatory=$true)][string]$OutputWorkbook,
    [Parameter(Mandatory=$true)][string]$EvidencePath,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedSourceSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedHeadSha
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'office_vba_signature_common.ps1')

$source = (Resolve-Path -LiteralPath $SourceWorkbook).Path
$destination = [IO.Path]::GetFullPath($OutputWorkbook)
$evidence = [IO.Path]::GetFullPath($EvidencePath)
if (([IO.Path]::GetExtension($source) -ine '.xlsm') -or
    ([IO.Path]::GetExtension($destination) -ine '.xlsm') -or
    $source -ieq $evidence -or $destination -ieq $evidence -or
    (Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $evidence) -or
    -not (Test-Path -LiteralPath (Split-Path -Parent $destination) -PathType Container) -or
    -not (Test-Path -LiteralPath (Split-Path -Parent $evidence) -PathType Container)) {
    throw 'PRIVATE_SIGNING_OUTPUT_OR_EVIDENCE_PATH_INVALID'
}
function Assert-AcceptedInput {
    $actual = Get-SignatureFileSha256 $source
    if ($actual -cne $ExpectedSourceSha256) { throw 'SOURCE_WORKBOOK_SHA256_NOT_ACCEPTED' }
}
Assert-AcceptedInput

$availability = 'SIGNING_NOT_CONFIGURED'
$thumb = $env:FURUSATO_SIGNING_THUMBPRINT
$timestamp = $env:FURUSATO_SIGNING_TIMESTAMP_URL
$approvedHead = $env:FURUSATO_SIGNING_APPROVED_HEAD
if ($thumb -or $timestamp -or $approvedHead -or $env:FURUSATO_SIGNTOOL_X86) {
    if ($thumb -notmatch '^[0-9a-fA-F]{40}$' -or -not $timestamp -or
        $approvedHead -cne $ExpectedHeadSha) {
        throw 'PRIVATE_RUNNER_SIGNING_CONFIG_INVALID_OR_NOT_APPROVED_FOR_HEAD'
    }
    $signer = Join-Path $PSScriptRoot 'sign_excel_vba_local.ps1'
    $signing = @{
        SourceWorkbook = $source
        OutputWorkbook = $destination
        EvidencePath = $evidence
        CertificateThumbprint = $thumb
        TimestampUrl = $timestamp
        ExpectedSourceSha256 = $ExpectedSourceSha256
        ExpectedHeadSha = $ExpectedHeadSha
        PrivateSelfHostedRunner = $true
    }
    if ($env:FURUSATO_SIGNTOOL_X86) { $signing.SignToolX86 = $env:FURUSATO_SIGNTOOL_X86 }
    $availability = 'AVAILABLE'
    try {
        & $signer @signing
    } catch {
        $code = $_.Exception.Message
        if ($code -cnotin @(
            'CODE_SIGNING_CERTIFICATE_NOT_FOUND_IN_CURRENT_USER_MY',
            'SIGNING_PRIVATE_KEY_NOT_ACCESSIBLE',
            'X86_WINDOWS_SDK_NOT_FOUND', 'X86_SIGNTOOL_NOT_FOUND', 'X86_OFFICE_SIP_NOT_REGISTERED'
        )) { throw 'PRIVATE_RUNNER_SIGNING_PREFLIGHT_FAILED' }
        $availability = $code
    }
    if ($availability -ceq 'AVAILABLE') {
        # Any failure after credential/tool preflight fails the job. It cannot silently switch modes.
        & $signer @signing -Execute
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf) -or
            -not (Test-Path -LiteralPath $evidence -PathType Leaf)) {
            throw 'PRIVATE_RUNNER_SIGNED_OUTPUT_OR_EVIDENCE_MISSING'
        }
        Assert-AcceptedInput
        Write-Host 'EXCEL_RELEASE_SIGNING_STATE=SIGNED'
        return
    }
}

# The UNSIGNED route is explicit, with an unchanged accepted workbook and no signed output.
Assert-AcceptedInput
if (Test-Path -LiteralPath $destination) { throw 'UNSIGNED_ROUTE_HAS_SIGNED_OUTPUT' }
$record = [ordered]@{
    schema = 'furusato-local-vba-signing/v2'
    head_sha = $ExpectedHeadSha
    signing_state = 'UNSIGNED'
    availability = $availability
    source_workbook_sha256 = $ExpectedSourceSha256
    signed_workbook_sha256 = $null
}
$file = [IO.File]::Open($evidence, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Depth 3) + "`n")
    $file.Write($bytes, 0, $bytes.Length)
} finally {
    $file.Dispose()
}
Write-Host "EXCEL_RELEASE_SIGNING_STATE=UNSIGNED; SIGNING_AVAILABILITY=$availability"
