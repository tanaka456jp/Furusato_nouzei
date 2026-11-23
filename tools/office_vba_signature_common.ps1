# Read-only Office SIP tooling. Installation and trust settings belong to the administrator.
function Get-SignatureFileSha256([string]$path) {
    $stream = [IO.File]::OpenRead($path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $hash.Dispose()
        $stream.Dispose()
    }
}

function Get-LocalAuthenticodeSignature([string]$path) {
    # A nested Windows PowerShell can inherit PSModulePath from pwsh.
    $manifest = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
    if (Test-Path -LiteralPath $manifest -PathType Leaf) {
        Import-Module -Name $manifest -ErrorAction Stop
    }
    return Get-AuthenticodeSignature -LiteralPath $path
}

function Find-X86SignTool([string]$explicitPath) {
    if ($explicitPath) {
        $candidate = [IO.Path]::GetFullPath($explicitPath)
        if ($candidate -notmatch '(?i)[\\/]x86[\\/]signtool\.exe$' -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw 'X86_SIGNTOOL_PATH_INVALID'
        }
    } else {
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
        $candidate = $found[0]
    }
    $binary = New-Object IO.BinaryReader([IO.File]::OpenRead($candidate))
    try {
        if ($binary.ReadUInt16() -ne 0x5a4d) { throw 'X86_SIGNTOOL_NOT_NATIVE_PE' }
        $binary.BaseStream.Position = 0x3c
        $peOffset = $binary.ReadUInt32()
        if ($peOffset -lt 64 -or $peOffset -gt $binary.BaseStream.Length - 6) {
            throw 'X86_SIGNTOOL_NOT_NATIVE_PE'
        }
        $binary.BaseStream.Position = $peOffset
        if ($binary.ReadUInt32() -ne 0x00004550 -or $binary.ReadUInt16() -ne 0x014c) {
            throw 'X86_SIGNTOOL_NOT_NATIVE_PE'
        }
    } finally {
        $binary.Dispose()
    }
    $signature = Get-LocalAuthenticodeSignature $candidate
    if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
        throw 'X86_SIGNTOOL_MICROSOFT_SIGNATURE_REQUIRED'
    }
    return $candidate
}

function Require-X86OfficeSip {
    $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry32)
    $providers = $null
    try {
        $providers = $registry.OpenSubKey('SOFTWARE\Microsoft\Cryptography\OID\EncodingType 0\CryptSIPDllGetSignedDataMsg')
        if ($null -ne $providers) {
            foreach ($name in $providers.GetSubKeyNames()) {
                $provider = $providers.OpenSubKey($name)
                if ($null -eq $provider) { continue }
                try {
                    $dll = [Environment]::ExpandEnvironmentVariables([string]$provider.GetValue('Dll'))
                    if ([IO.Path]::GetFileName($dll) -ieq 'msosipx.dll' -and
                        [IO.Path]::IsPathRooted($dll) -and
                        (Test-Path -LiteralPath $dll -PathType Leaf)) {
                        $signature = Get-LocalAuthenticodeSignature $dll
                        if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
                            $null -eq $signature.SignerCertificate -or
                            $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
                            throw 'X86_OFFICE_SIP_MICROSOFT_SIGNATURE_REQUIRED'
                        }
                        return
                    }
                } finally {
                    $provider.Dispose()
                }
            }
        }
    } finally {
        if ($null -ne $providers) { $providers.Dispose() }
        $registry.Dispose()
    }
    throw 'X86_OFFICE_SIP_NOT_REGISTERED'
}

function Invoke-OfficeSignTool([string]$tool, [string[]]$arguments, [string]$failureCode) {
    # Native stderr is diagnostic-only and can contain private certificate/provider details.
    $originalPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $tool @arguments 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw $failureCode }
    } finally {
        $ErrorActionPreference = $originalPreference
    }
}

function Assert-VerifiedOfficeVbaSignature([string]$tool, [string]$path, [string]$thumbprint) {
    # /tw returns a warning when the timestamp is absent. Treat warnings as failure.
    Invoke-OfficeSignTool $tool @('verify', '/pa', '/all', '/tw', $path) 'OFFICE_SIP_SIGNTOOL_VERIFY_FAILED'

    # Match the actual CMS signer, independently of the certificate selection at sign time.
    # MS-OSHARED DigSigBlob contains the offset and length of the PKCS#7 bytes.
    try { Add-Type -AssemblyName System.Security.Cryptography.Pkcs -ErrorAction Stop }
    catch { Add-Type -AssemblyName System.Security }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $parts = @($archive.Entries | Where-Object {
            $_.FullName -cmatch '^xl/vbaProjectSignature(?:Agile|V3)?\.bin$'
        })
        if ($parts.Count -eq 0 -or $parts.Count -gt 3) { throw 'OFFICE_SIP_SIGNATURE_PART_MISSING_OR_DUPLICATE' }
        if (@($parts.FullName | Select-Object -Unique).Count -ne $parts.Count) {
            throw 'OFFICE_SIP_SIGNATURE_PART_MISSING_OR_DUPLICATE'
        }
        foreach ($part in $parts) {
            if ($part.Length -lt 129 -or $part.Length -gt 5000000) { throw 'OFFICE_SIP_SIGNATURE_PART_INVALID' }
            $entry = $part.Open()
            $buffer = New-Object IO.MemoryStream
            try {
                $entry.CopyTo($buffer)
                $bytes = $buffer.ToArray()
            } finally {
                $buffer.Dispose()
                $entry.Dispose()
            }
            $serializedOffset = [BitConverter]::ToUInt32($bytes, 4)
            if ($serializedOffset -ne 8) { throw 'OFFICE_SIP_SIGNATURE_PART_INVALID' }
            $cmsSize = [BitConverter]::ToUInt32($bytes, $serializedOffset)
            $cmsOffset = [BitConverter]::ToUInt32($bytes, $serializedOffset + 4)
            if ($cmsOffset -lt $serializedOffset + 36 -or $cmsSize -lt 128 -or
                [long]$cmsOffset + [long]$cmsSize -gt $bytes.Length) {
                throw 'OFFICE_SIP_SIGNATURE_PART_INVALID'
            }
            $cmsBytes = New-Object byte[] $cmsSize
            [Array]::Copy($bytes, [int]$cmsOffset, $cmsBytes, 0, [int]$cmsSize)
            $cms = New-Object Security.Cryptography.Pkcs.SignedCms
            try {
                $cms.Decode($cmsBytes)
                $cms.CheckSignature($true)
            } catch {
                throw 'OFFICE_SIP_SIGNATURE_CMS_INVALID'
            }
            if ($cms.SignerInfos.Count -ne 1 -or $null -eq $cms.SignerInfos[0].Certificate -or
                $cms.SignerInfos[0].Certificate.Thumbprint.ToUpperInvariant() -cne $thumbprint) {
                throw 'OFFICE_SIP_VBA_SIGNER_CERTIFICATE_MISMATCH'
            }
        }
    } finally {
        $archive.Dispose()
    }
}
