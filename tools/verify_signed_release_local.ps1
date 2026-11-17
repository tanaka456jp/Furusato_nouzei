#Requires -Version 5.1
<#
Offline-only release package signature gate. This script cannot sign anything,
install certificates, bypass trust, distribute a package or approve release.
Use an actual trusted code-signing certificate outside the public runner.
Do NOT use synthetic ReadyToUse_REVIEW_HOLD ZIP for public distribution.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Package,
    [Parameter(Mandatory=$true)][string]$ExpectedPackageSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedSignerThumbprint,
    [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
$packageFile = (Resolve-Path -LiteralPath $Package).Path
$expectedHash = $ExpectedPackageSha256.Trim().ToLowerInvariant()
$expectedSigner = ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()
if ($expectedHash -cnotmatch '^[0-9a-f]{64}$' -or
    $expectedSigner -cnotmatch '^[0-9A-F]{40,64}$') {
    throw 'INVALID_EXPECTED_SIGNATURE_OR_HASH'
}
if (Test-Path -LiteralPath $EvidencePath) {
    throw 'REFUSE_TO_OVERWRITE_RELEASE_EVIDENCE'
}
$actualHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -cne $expectedHash) {
    throw 'INDEPENDENT_PACKAGE_SHA256_MISMATCH'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($packageFile)
$work = Join-Path ([IO.Path]::GetTempPath()) ('furusato_signature_' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($work)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName })
    if (@($names | Select-Object -Unique).Count -ne $names.Count -or
        @($names | Where-Object { $_ -match '(^[\\/]|\.\.|:)' }).Count -gt 0) {
        throw 'UNSAFE_ZIP_ENTRIES'
    }
    if ($names -contains 'NOT_FOR_PUBLIC_RELEASE.txt') {
        throw 'REVIEW_ONLY_ZIP_CANNOT_BE_RELEASED'
    }
    $requiredNames = @('Furusato_nouzei.xlsm','FurusatoDocumentReader.exe','README.txt')
    foreach ($needed in $requiredNames) {
        if ($names -notcontains $needed) { throw 'MISSING_EXPECTED_RELEASE_MEMBER' }
    }
    if ($names.Count -ne $requiredNames.Count) {
        throw 'UNEXPECTED_RELEASE_PACKAGE_CONTENTS'
    }
    $xlsm = @($zip.Entries | Where-Object { $_.FullName -ceq 'Furusato_nouzei.xlsm' })
    if ($xlsm.Count -ne 1 -or $xlsm[0].Length -lt 100000 -or
        $xlsm[0].Length -gt 100000000) {
        throw 'RELEASE_WORKBOOK_SIZE_INVALID'
    }
    # Signed reader EXE and signed Excel VBA are separate trust objects.
    # Container existence is NOT equivalent to signature validity.
    $localXlsm = Join-Path $work 'Furusato_nouzei.xlsm'
    [IO.Compression.ZipFileExtensions]::ExtractToFile($xlsm[0],$localXlsm)
    $xlsmZip = [IO.Compression.ZipFile]::OpenRead($localXlsm)
    try {
        $vba = @($xlsmZip.Entries | Where-Object {
            $_.FullName -ceq 'xl/vbaProject.bin'
        })
        if ($vba.Count -ne 1 -or $vba[0].Length -lt 1024 -or
            $vba[0].Length -gt 30000000) {
            throw 'MACRO_WORKBOOK_VBA_PROJECT_MISSING_OR_INVALID'
        }
        # Check the actual OLE/CFB header even when a detached signature
        # part exists. A signature-looking ZIP entry must not bypass this.
        $localVba = Join-Path $work 'vbaProject.bin'
        [IO.Compression.ZipFileExtensions]::ExtractToFile($vba[0],$localVba)
        $vbaStream = [IO.File]::OpenRead($localVba)
        try {
            [byte[]]$oleHeader = @(0,0,0,0,0,0,0,0)
            [byte[]]$cfbMagic = @(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1)
            if ($vbaStream.Read($oleHeader,0,8) -ne 8) {
                throw 'INVALID_VBA_OLE_CONTAINER'
            }
            for ($byteIndex=0; $byteIndex -lt 8; $byteIndex++) {
                if ($oleHeader[$byteIndex] -ne $cfbMagic[$byteIndex]) {
                    throw 'INVALID_VBA_OLE_CONTAINER'
                }
            }
        } finally {
            $vbaStream.Dispose()
        }
        $signatureParts = @($xlsmZip.Entries | Where-Object {
            $_.FullName -cmatch '^xl/vbaProjectSignature(?:Agile|V3)?\.bin$'
        })
        # An OLE string resembling 'DigitalSignature' is not evidence of a
        # cryptographic VBA signature. Require a linked signature OPC part.
        # Legacy embedded-only projects are conservatively HOLD, pending an
        # independent Office/VBE examination.
        if ($signatureParts.Count -eq 0) {
            throw 'VBA_MACRO_SIGNATURE_NOT_DISCOVERED'
        }
        $signatureNames = @($signatureParts | ForEach-Object {
            $_.FullName.Substring(3)
        })
        if (@($signatureNames | Select-Object -Unique).Count -ne $signatureNames.Count) {
            throw 'DUPLICATE_VBA_SIGNATURE_PART'
        }
        foreach ($signaturePart in $signatureParts) {
            if ($signaturePart.Length -le 128 -or $signaturePart.Length -ge 5000000) {
                throw 'VBA_SIGNATURE_PART_SIZE_INVALID'
            }
        }
        $relsEntry = @($xlsmZip.Entries | Where-Object {
            $_.FullName -ceq 'xl/_rels/vbaProject.bin.rels'
        })
        if ($relsEntry.Count -ne 1 -or $relsEntry[0].Length -lt 50 -or
            $relsEntry[0].Length -gt 65536) {
            throw 'VBA_SIGNATURE_RELATIONSHIP_MISSING'
        }
        $relTypes = @{
            'vbaProjectSignature.bin' = 'http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature'
            'vbaProjectSignatureAgile.bin' = 'http://schemas.microsoft.com/office/2014/relationships/vbaProjectSignatureAgile'
            'vbaProjectSignatureV3.bin' = 'http://schemas.microsoft.com/office/2020/07/relationships/vbaProjectSignatureV3'
        }
        $relsStream = $relsEntry[0].Open()
        $xmlReader = $null
        try {
            $xmlSettings = New-Object System.Xml.XmlReaderSettings
            $xmlSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
            $xmlSettings.XmlResolver = $null
            $xmlSettings.MaxCharactersInDocument = 65536
            $xmlReader = [System.Xml.XmlReader]::Create($relsStream,$xmlSettings)
            $xmlDoc = New-Object System.Xml.XmlDocument
            $xmlDoc.XmlResolver = $null
            $xmlDoc.Load($xmlReader)
        } finally {
            if ($null -ne $xmlReader) { $xmlReader.Dispose() }
            $relsStream.Dispose()
        }
        if ($xmlDoc.DocumentElement.LocalName -cne 'Relationships' -or
            $xmlDoc.DocumentElement.NamespaceURI -cne 'http://schemas.openxmlformats.org/package/2006/relationships') {
            throw 'INVALID_VBA_SIGNATURE_RELATIONSHIPS_XML'
        }
        $connectedTargets = @()
        foreach ($relation in $xmlDoc.DocumentElement.ChildNodes) {
            if ($relation.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
            if ($relation.LocalName -cne 'Relationship' -or
                $relation.NamespaceURI -cne $xmlDoc.DocumentElement.NamespaceURI) {
                throw 'INVALID_VBA_SIGNATURE_RELATIONSHIPS_XML'
            }
            if ([string]$relation.GetAttribute('TargetMode') -cne '') {
                throw 'VBA_SIGNATURE_EXTERNAL_RELATIONSHIP'
            }
            $target = [string]$relation.GetAttribute('Target')
            $type = [string]$relation.GetAttribute('Type')
            if ([string]::IsNullOrEmpty($target) -or
                [string]::IsNullOrEmpty($type)) {
                throw 'INVALID_VBA_SIGNATURE_RELATIONSHIP'
            }
            $isSignatureType = @($relTypes.Values) -ccontains $type
            $isSignatureTarget = $relTypes.ContainsKey($target)
            if (-not $isSignatureType -and -not $isSignatureTarget) { continue }
            if (-not $isSignatureType -or -not $isSignatureTarget -or
                $type -cne $relTypes[$target] -or
                $signatureNames -cnotcontains $target) {
                throw 'INVALID_VBA_SIGNATURE_RELATIONSHIP'
            }
            if ($connectedTargets -ccontains $target) {
                throw 'DUPLICATE_VBA_SIGNATURE_RELATIONSHIP'
            }
            $connectedTargets += $target
        }
        if ($connectedTargets.Count -ne $signatureNames.Count) {
            throw 'VBA_SIGNATURE_PART_NOT_ATTACHED_TO_PROJECT'
        }
    } finally {
        $xlsmZip.Dispose()
    }
    $exe = @($zip.Entries | Where-Object { $_.FullName -ceq 'FurusatoDocumentReader.exe' })
    if ($exe.Count -ne 1 -or $exe[0].Length -lt 10000 -or
        $exe[0].Length -gt 120000000) {
        throw 'READER_EXE_SIZE_OR_COUNT_INVALID'
    }
    $localExe = Join-Path $work 'FurusatoDocumentReader.exe'
    [IO.Compression.ZipFileExtensions]::ExtractToFile($exe[0],$localExe)
    $actualSignature = Get-AuthenticodeSignature -LiteralPath $localExe
    if ($null -eq $actualSignature -or
        $actualSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        $null -eq $actualSignature.SignerCertificate) {
        throw 'READER_EXE_AUTHENTICODE_NOT_TRUSTED'
    }
    $certificate = $actualSignature.SignerCertificate
    if ($certificate.Thumbprint.ToUpperInvariant() -cne $expectedSigner) {
        throw 'SIGNER_CERTIFICATE_MISMATCH'
    }
    if ($certificate.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow) {
        throw 'SIGNER_CERTIFICATE_EXPIRED'
    }
    $evidence = [ordered]@{
        schema = 'furusato-signed-distribution-local/v1'
        archive_sha256 = $actualHash
        reader_exe_sha256 = (Get-FileHash -LiteralPath $localExe -Algorithm SHA256).Hash.ToLowerInvariant()
        authenticode = 'VALID_TRUSTED_EXPECTED_SIGNER'
        certificate_thumbprint_verified = $true
        macro_workbook_signature = 'CONTAINER_DETECTED_CRYPTOGRAPHIC_VALIDITY_NOT_VERIFIED'
        macro_signature_office_validation = 'REQUIRED_BEFORE_RELEASE'
        exact_release_members = 'THREE_EXPECTED_FILES_ONLY'
        manual_publisher_approval = 'REQUIRED'
        release_decision = 'HOLD'
    }
    $target = [IO.Path]::GetFullPath($EvidencePath)
    $parent = [IO.Path]::GetDirectoryName($target)
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        [void][IO.Directory]::CreateDirectory($parent)
    }
    [IO.File]::WriteAllText($target,
        ($evidence | ConvertTo-Json -Depth 3),
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'SIGNATURE_AND_ARCHIVE_HASH_VERIFIED_MANUAL_RELEASE_APPROVAL_REQUIRED'
} finally {
    $zip.Dispose()
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
