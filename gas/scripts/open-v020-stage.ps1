# Opens ONLY the new v0.1.20 private synthetic Web app in normal Edge.
# No Playwright, no automated login, no Google API writes and no URL output.
[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$gas = Split-Path -Parent $PSScriptRoot
$oldPath = Join-Path $gas '.private\furusato\receipt.json'
$newPath = Join-Path $gas '.private\furusato-v020-stage\receipt.json'
function Read-ProtectedJson([string]$path) {
    $dir = Split-Path -Parent $path
    foreach ($entry in @($dir, $path)) {
        $item = Get-Item -LiteralPath $entry -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'STAGE_PATH_UNSAFE'
        }
    }
    $file = Get-Item -LiteralPath $path -Force
    if ($file.Length -lt 3 -or $file.Length -gt 1048576) {
        throw 'STAGE_RECEIPT_INVALID'
    }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}
try {
    $stage = Read-ProtectedJson $newPath
    $old = Read-ProtectedJson $oldPath
    if ($stage.schema -ne 'furusato-v020-stage/v1' -or
        $stage.appVersion -ne 'v0.1.20' -or
        $stage.release -ne 'HOLD' -or
        $stage.oldDeployment -ne 'UNMODIFIED_BY_STAGE' -or
        $stage.owner -ne $old.owner -or
        $stage.scriptId -eq $old.scriptId -or
        $stage.deploymentId -eq $old.deploymentId -or
        $stage.webAppUrl -eq $old.webAppUrl -or
        $stage.webAppUrl -notmatch '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$') {
        throw 'STAGE_RECEIPT_NOT_ISOLATED'
    }
    if ($CheckOnly) {
        Write-Output 'V020_PRIVATE_STAGE_LOCAL_RECEIPT_PASS; GOOGLE_NOT_RECHECKED; RELEASE=HOLD'
        exit 0
    }
    Start-Process -FilePath 'msedge.exe' -ArgumentList @('--new-window', $stage.webAppUrl)
    Write-Output 'V020_PRIVATE_EDGE_OPENED; OWNER_LOGIN_MANUAL; OCR_NOT_TESTED; RELEASE=HOLD'
} catch {
    Write-Error 'V020_PRIVATE_EDGE_HOLD: STAGE_NOT_READY_OR_UNSAFE'
    exit 2
}
