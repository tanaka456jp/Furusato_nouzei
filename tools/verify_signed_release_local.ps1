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
    [ValidateSet('SIGNED','UNSIGNED')][string]$ExpectedReaderSigningState = 'SIGNED',
    [ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedReaderSignerThumbprint,
    [string]$SignToolX86 = '',
    [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'office_vba_signature_common.ps1')
$packageFile = (Resolve-Path -LiteralPath $Package).Path
$expectedHash = $ExpectedPackageSha256.Trim().ToLowerInvariant()
$expectedSigner = ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()
if ($expectedHash -cnotmatch '^[0-9a-f]{64}$' -or
    $expectedSigner -cnotmatch '^[0-9A-F]{40}$' -or
    ($ExpectedReaderSigningState -ceq 'UNSIGNED' -and $ExpectedReaderSignerThumbprint)) {
    throw 'INVALID_EXPECTED_SIGNATURE_OR_HASH'
}
if ((Get-Item -LiteralPath $packageFile).Length -gt 150000000) { throw 'ARCHIVE_SIZE_INVALID' }
if (Test-Path -LiteralPath $EvidencePath) {
    throw 'REFUSE_TO_OVERWRITE_RELEASE_EVIDENCE'
}
$actualHash = Get-SignatureFileSha256 $packageFile
if ($actualHash -cne $expectedHash) {
    throw 'INDEPENDENT_PACKAGE_SHA256_MISMATCH'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($packageFile)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$work = [IO.Path]::GetFullPath((Join-Path $tempRoot ('furusato_signature_' + [Guid]::NewGuid().ToString('N'))))
if (-not $work.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $zip.Dispose()
    throw 'SIGNATURE_TEMP_PATH_INVALID'
}
[void][IO.Directory]::CreateDirectory($work)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName })
    $totalUncompressedSize = 0
    foreach ($entry in $zip.Entries) {
        $totalUncompressedSize += $entry.Length
        $maximum = 120000000
        if ($entry.FullName -ceq 'README.txt') { $maximum = 1048576 }
        $kind = ($entry.ExternalAttributes -shr 16) -band 0xf000
        if ($entry.Length -lt 1 -or $entry.Length -gt $maximum -or
            $entry.CompressedLength -lt 1 -or $entry.Length -gt $entry.CompressedLength * 1000 -or
            $kind -notin @(0, 0x8000) -or ($entry.ExternalAttributes -band 0x410)) {
            throw 'UNSAFE_ZIP_ENTRIES'
        }
    }
    if (@($names | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique).Count -ne $names.Count -or
        @($names | Where-Object { $_ -match '([\\/]|\.\.|:)' }).Count -gt 0 -or
        $totalUncompressedSize -gt 150000000) {
        throw 'UNSAFE_ZIP_ENTRIES'
    }
    if ($names -contains 'NOT_FOR_PUBLIC_RELEASE.txt') {
        throw 'REVIEW_ONLY_ZIP_CANNOT_BE_RELEASED'
    }
    $requiredNames = @('Furusato_nouzei.xlsm','FurusatoDocumentReader.exe','README.txt')
    foreach ($needed in $requiredNames) {
        if ($names -cnotcontains $needed) { throw 'MISSING_EXPECTED_RELEASE_MEMBER' }
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
        $innerNames = @($xlsmZip.Entries | ForEach-Object { $_.FullName })
        if (@($innerNames | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique).Count -ne $innerNames.Count) {
            throw 'DUPLICATE_XLSM_PACKAGE_ENTRY'
        }
        $innerTotal = 0
        foreach ($entry in $xlsmZip.Entries) {
            $innerTotal += $entry.Length
            $kind = ($entry.ExternalAttributes -shr 16) -band 0xf000
            if ($entry.FullName -match '(^/|[\\:]|(?:^|/)\.{1,2}(?:/|$)|//|/$)' -or
                $entry.Length -lt 1 -or $entry.Length -gt 100000000 -or
                $entry.CompressedLength -lt 1 -or $entry.Length -gt $entry.CompressedLength * 1000 -or
                $kind -notin @(0, 0x8000) -or ($entry.ExternalAttributes -band 0x410)) {
                throw 'UNSAFE_XLSM_PACKAGE_ENTRY'
            }
        }
        if ($innerNames.Count -gt 5000 -or $innerTotal -gt 200000000) {
            throw 'UNSAFE_XLSM_PACKAGE_ENTRY'
        }
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
        # Check that the VBA project is actually referenced by the workbook.
        # Unattached ZIP parts cannot establish any Excel macro trust.
        $wbXml = @($xlsmZip.Entries | Where-Object { $_.FullName -ceq 'xl/workbook.xml' })
        $wbRels = @($xlsmZip.Entries | Where-Object {
            $_.FullName -ceq 'xl/_rels/workbook.xml.rels'
        })
        if ($wbXml.Count -ne 1 -or $wbXml[0].Length -le 10 -or
            $wbRels.Count -ne 1 -or $wbRels[0].Length -lt 50 -or
            $wbRels[0].Length -gt 131072) {
            throw 'VBA_PROJECT_WORKBOOK_RELATIONSHIP_MISSING'
        }
        $wbStream = $wbRels[0].Open()
        $wbReader = $null
        try {
            $wbSettings = New-Object System.Xml.XmlReaderSettings
            $wbSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
            $wbSettings.XmlResolver = $null
            $wbSettings.MaxCharactersInDocument = 131072
            $wbReader = [System.Xml.XmlReader]::Create($wbStream,$wbSettings)
            $wbDocument = New-Object System.Xml.XmlDocument
            $wbDocument.XmlResolver = $null
            $wbDocument.Load($wbReader)
        } finally {
            if ($null -ne $wbReader) { $wbReader.Dispose() }
            $wbStream.Dispose()
        }
        $wbNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
        if ($wbDocument.DocumentElement.LocalName -cne 'Relationships' -or
            $wbDocument.DocumentElement.NamespaceURI -cne $wbNs) {
            throw 'INVALID_VBA_PROJECT_WORKBOOK_RELATIONSHIPS_XML'
        }
        $requiredWbType = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject'
        $vbaLinkCount = 0
        foreach ($node in $wbDocument.DocumentElement.ChildNodes) {
            if ($node.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
            if ($node.LocalName -cne 'Relationship' -or
                $node.NamespaceURI -cne $wbNs) {
                throw 'INVALID_VBA_PROJECT_WORKBOOK_RELATIONSHIPS_XML'
            }
            $target = [string]$node.GetAttribute('Target')
            $type = [string]$node.GetAttribute('Type')
            $vbaTarget = ($target -ceq 'vbaProject.bin' -or
                          $target -ceq '/xl/vbaProject.bin')
            if ($type -cne $requiredWbType -and -not $vbaTarget) { continue }
            if ([string]$node.GetAttribute('TargetMode') -cne '') {
                throw 'VBA_PROJECT_WORKBOOK_EXTERNAL_RELATIONSHIP'
            }
            if ($type -cne $requiredWbType -or -not $vbaTarget) {
                throw 'INVALID_VBA_PROJECT_WORKBOOK_RELATIONSHIP'
            }
            $vbaLinkCount++
        }
        if ($vbaLinkCount -ne 1) {
            throw 'VBA_PROJECT_WORKBOOK_RELATIONSHIP_MISSING_OR_DUPLICATE'
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
            'vbaProjectSignatureAgile.bin' = 'http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignatureAgile'
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
        # OPC content types determine whether Office recognizes these parts.
        # A linked and present signature-looking file is not enough.
        $typeEntries = @($xlsmZip.Entries | Where-Object {
            $_.FullName -ceq '[Content_Types].xml'
        })
        if ($typeEntries.Count -ne 1 -or $typeEntries[0].Length -lt 60 -or
            $typeEntries[0].Length -gt 131072) {
            throw 'VBA_SIGNATURE_CONTENT_TYPES_MISSING'
        }
        $ctStream = $typeEntries[0].Open()
        $ctReader = $null
        try {
            $ctSettings = New-Object System.Xml.XmlReaderSettings
            $ctSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
            $ctSettings.XmlResolver = $null
            $ctSettings.MaxCharactersInDocument = 131072
            $ctReader = [System.Xml.XmlReader]::Create($ctStream,$ctSettings)
            $ctDoc = New-Object System.Xml.XmlDocument
            $ctDoc.XmlResolver = $null
            $ctDoc.Load($ctReader)
        } finally {
            if ($null -ne $ctReader) { $ctReader.Dispose() }
            $ctStream.Dispose()
        }
        $ctNs = 'http://schemas.openxmlformats.org/package/2006/content-types'
        if ($ctDoc.DocumentElement.LocalName -cne 'Types' -or
            $ctDoc.DocumentElement.NamespaceURI -cne $ctNs) {
            throw 'INVALID_VBA_SIGNATURE_CONTENT_TYPES_XML'
        }
        $defaults = @{}
        $overrides = @{}
        foreach ($node in $ctDoc.DocumentElement.ChildNodes) {
            if ($node.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
            if ($node.NamespaceURI -cne $ctNs) {
                throw 'INVALID_VBA_SIGNATURE_CONTENT_TYPES_XML'
            }
            if ($node.LocalName -ceq 'Default') {
                $key = [string]$node.GetAttribute('Extension')
                if (-not $key -or $defaults.ContainsKey($key)) {
                    throw 'DUPLICATE_OR_INVALID_CONTENT_TYPE_DEFAULT'
                }
                $defaults[$key] = [string]$node.GetAttribute('ContentType')
            } elseif ($node.LocalName -ceq 'Override') {
                $key = [string]$node.GetAttribute('PartName')
                if (-not $key -or -not $key.StartsWith('/') -or
                    $overrides.ContainsKey($key)) {
                    throw 'DUPLICATE_OR_INVALID_CONTENT_TYPE_OVERRIDE'
                }
                $overrides[$key] = [string]$node.GetAttribute('ContentType')
            } else {
                throw 'INVALID_VBA_SIGNATURE_CONTENT_TYPES_XML'
            }
        }
        $expectedTypes = @{
            'xl/vbaProject.bin' = 'application/vnd.ms-office.vbaProject'
            'xl/vbaProjectSignature.bin' = 'application/vnd.ms-office.vbaProjectSignature'
            'xl/vbaProjectSignatureAgile.bin' = 'application/vnd.ms-office.vbaProjectSignatureAgile'
            'xl/vbaProjectSignatureV3.bin' = 'application/vnd.ms-office.vbaProjectSignatureV3'
        }
        foreach ($partName in @('xl/vbaProject.bin') + @(
            $signatureParts | ForEach-Object { $_.FullName }
        )) {
            $partKey = '/' + $partName
            if ($overrides.ContainsKey($partKey)) {
                $actualType = [string]$overrides[$partKey]
            } elseif ($defaults.ContainsKey('bin')) {
                $actualType = [string]$defaults['bin']
            } else {
                $actualType = ''
            }
            if ($actualType -cne [string]$expectedTypes[$partName]) {
                throw 'VBA_SIGNATURE_CONTENT_TYPE_MISMATCH'
            }
        }
    } finally {
        $xlsmZip.Dispose()
    }
    # Verify the independent EXE Authenticode trust and expected publisher first.
    # This allows the unsigned synthetic negative tests to run on hosted Windows
    # without Excel, while signed candidates still require the Office/VBA gate.
    $exe = @($zip.Entries | Where-Object { $_.FullName -ceq 'FurusatoDocumentReader.exe' })
    if ($exe.Count -ne 1 -or $exe[0].Length -lt 10000 -or
        $exe[0].Length -gt 120000000) {
        throw 'READER_EXE_SIZE_OR_COUNT_INVALID'
    }
    $localExe = Join-Path $work 'FurusatoDocumentReader.exe'
    [IO.Compression.ZipFileExtensions]::ExtractToFile($exe[0],$localExe)
    $actualSignature = Get-LocalAuthenticodeSignature $localExe
    if ($ExpectedReaderSigningState -ceq 'SIGNED') {
        if ($null -eq $actualSignature -or
            $actualSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
            $null -eq $actualSignature.SignerCertificate) {
            throw 'READER_EXE_AUTHENTICODE_NOT_TRUSTED'
        }
        $readerThumb = $expectedSigner
        if ($ExpectedReaderSignerThumbprint) { $readerThumb = $ExpectedReaderSignerThumbprint.ToUpperInvariant() }
        $certificate = $actualSignature.SignerCertificate
        if ($certificate.Thumbprint.ToUpperInvariant() -cne $readerThumb) { throw 'SIGNER_CERTIFICATE_MISMATCH' }
        $readerState = 'VALID_TRUSTED_EXPECTED_SIGNER'
    } else {
        if ($null -eq $actualSignature -or
            $actualSignature.Status -ne [Management.Automation.SignatureStatus]::NotSigned) {
            throw 'UNSIGNED_READER_EXE_STATE_MISMATCH'
        }
        $readerState = 'UNSIGNED'
    }
    $tool = Find-X86SignTool $SignToolX86
    Require-X86OfficeSip
    Assert-VerifiedOfficeVbaSignature $tool $localXlsm $expectedSigner
    # Office recognition complements the independent SIP trust/timestamp verification.
    # Never enable macros or run unattended VBE automation in this check.
    $office = $null
    $signedBook = $null
    $officeVbaSigned = $false
    try {
        try {
            $office = New-Object -ComObject Excel.Application -ErrorAction Stop
        } catch {
            throw 'OFFICE_EXCEL_COM_UNAVAILABLE_FOR_SIGNATURE_REVIEW'
        }
        $office.Visible = $false
        $office.DisplayAlerts = $false
        $office.AskToUpdateLinks = $false
        $office.EnableEvents = $false
        $office.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
        $signedBook = $office.Workbooks.Open($localXlsm,0,$true)
        if ($null -eq $signedBook -or $office.Workbooks.Count -ne 1 -or
            -not [string]::Equals([string]$signedBook.FullName,$localXlsm,
                [StringComparison]::OrdinalIgnoreCase)) {
            throw 'OFFICE_VBA_SIGNATURE_UNEXPECTED_WORKBOOK'
        }
        if ($signedBook.HasVBProject -ne $true) {
            throw 'OFFICE_VBA_SIGNATURE_PROJECT_NOT_RECOGNIZED'
        }
        if ($signedBook.VBASigned -ne $true) {
            throw 'OFFICE_VBA_SIGNATURE_NOT_RECOGNIZED'
        }
        $officeVbaSigned = $true
    } finally {
        if ($null -ne $signedBook) {
            try { $signedBook.Close($false) } finally {
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($signedBook)
            }
        }
        if ($null -ne $office) {
            try { $office.Quit() } finally {
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($office)
            }
        }
    }
    if ((Get-SignatureFileSha256 $packageFile) -cne $actualHash) {
        throw 'ARCHIVE_CHANGED_DURING_SIGNATURE_VERIFICATION'
    }
    $evidence = [ordered]@{
        schema = 'furusato-signed-distribution-local/v2'
        archive_sha256 = $actualHash
        signed_workbook_sha256 = Get-SignatureFileSha256 $localXlsm
        signed_vba_project_sha256 = Get-SignatureFileSha256 $localVba
        reader_exe_sha256 = Get-SignatureFileSha256 $localExe
        reader_authenticode = $readerState
        vba_certificate_thumbprint_verified = $true
        macro_workbook_signature = 'OFFICE_SIP_CRYPTOGRAPHICALLY_VERIFIED'
        office_vba_signed_property = 'OFFICE_RECOGNIZED_SIGNED_PROJECT'
        timestamp_verified = $true
        exact_release_members = 'THREE_EXPECTED_FILES_ONLY'
        signature_gate = 'PASS'
    }
    $target = [IO.Path]::GetFullPath($EvidencePath)
    $parent = [IO.Path]::GetDirectoryName($target)
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        [void][IO.Directory]::CreateDirectory($parent)
    }
    $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($evidence | ConvertTo-Json -Depth 3) + "`n")
        $output.Write($bytes, 0, $bytes.Length)
    } finally {
        $output.Dispose()
    }
    Write-Host 'EXCEL_SIGNED_ARCHIVE_SIGNATURE_GATE_PASS'
} catch {
    $code = $_.Exception.Message
    if ($code -cnotmatch '^[A-Z0-9_]+$') { $code = 'LOCAL_SIGNATURE_VERIFICATION_FAILED' }
    throw $code
} finally {
    $zip.Dispose()
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
