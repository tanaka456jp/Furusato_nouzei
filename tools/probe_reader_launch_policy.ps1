#Requires -Version 5.1
# Read-only diagnostics: NEVER change application trust, policy or ACLs.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ReaderExecutable,
      [Parameter(Mandatory=$true)][string]$EvidencePath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$exe=(Resolve-Path -LiteralPath $ReaderExecutable).Path
if ([IO.Path]::GetExtension($exe) -ine '.exe') { throw 'DIAGNOSTIC_EXE_REQUIRED' }
$output=[IO.Path]::GetFullPath($EvidencePath)
if ((Test-Path -LiteralPath $output) -or
    -not (Test-Path -LiteralPath (Split-Path -Parent $output) -PathType Container)) {
    throw 'DIAGNOSTIC_OUTPUT_INVALID'
}
$signature='QUERY_FAILED'
try {
    $signature=[string](Get-AuthenticodeSignature -LiteralPath $exe -ErrorAction Stop).Status
} catch {}
$zone='QUERY_FAILED'
try {
    $streams=@(Get-Item -LiteralPath $exe -Stream Zone.Identifier -ErrorAction SilentlyContinue)
    $zone=if ($streams.Count -gt 0) { 'PRESENT' } else { 'ABSENT' }
} catch {}
$acl='QUERY_FAILED'
try {
    $aclValue=Get-Acl -LiteralPath $exe -ErrorAction Stop
    if ($null -ne $aclValue) { $acl='READABLE' }
} catch {}
$leaf=[IO.Path]::GetFileName($exe)
$since=(Get-Date).AddMinutes(-20)
$logs=@(
    @{key='APPLOCKER';name='Microsoft-Windows-AppLocker/EXE and DLL';ids=@(8003,8004,8006,8007)},
    @{key='CODE_INTEGRITY';name='Microsoft-Windows-CodeIntegrity/Operational';ids=@(3033,3076,3077,3089)},
    @{key='DEFENDER';name='Microsoft-Windows-Windows Defender/Operational';ids=@(1116,1117,1121,1122)}
)
$signals=@()
foreach ($log in $logs) {
    try {
        $events=@(Get-WinEvent -FilterHashtable @{LogName=$log.name;StartTime=$since} -MaxEvents 128 -ErrorAction Stop)
        $matched=@()
        foreach ($event in $events) {
            if ($log.ids -notcontains [int]$event.Id) { continue }
            $message=[string]$event.Message
            if ($message.IndexOf($leaf,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $matched += [int]$event.Id
            }
        }
        foreach ($id in @($matched | Sort-Object -Unique)) {
            $count=@($matched | Where-Object { $_ -eq $id }).Count
            $signals+=@{category=$log.key;event_id=[int]$id;count=[int]$count}
        }
    } catch {
        # Get-WinEvent returns NoMatchingEventsFound when the channel can be
        # read but no events exist in the 20-minute window. It must not be
        # misreported as a channel permission failure.
        $eventCode=[string]$_.FullyQualifiedErrorId
        if ($eventCode -like '*NoMatchingEventsFound*') {
            $signals+=@{category=$log.key;observation='NO_RECENT_EVENTS'}
        } else {
            $signals+=@{category=$log.key;observation='QUERY_FAILED'}
        }
    }
}
# Additional read-only effective-policy indicators. Do not serialize rules,
# security principals, signer identities or any private directories.
$appLocker='NOT_AVAILABLE'
$appLockerExeRuleCount=$null
try {
    if (Get-Command -Name Get-AppLockerPolicy -ErrorAction SilentlyContinue) {
        $effective=Get-AppLockerPolicy -Effective -ErrorAction Stop
        $collection=@($effective.RuleCollections | Where-Object { $_.RuleCollectionType -eq 'Exe' })
        $appLockerExeRuleCount=[int]@($collection | ForEach-Object { $_.Count }).Count
        $appLocker='QUERY_COMPLETED'
    }
} catch { $appLocker='QUERY_FAILED' }
$deviceGuard='NOT_AVAILABLE'
$deviceGuardEnforcement=$null
try {
    $dg=Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
    if ($null -ne $dg) {
        $deviceGuard='QUERY_COMPLETED'
        $deviceGuardEnforcement=[int]$dg.UsermodeCodeIntegrityPolicyEnforcementStatus
    }
} catch { $deviceGuard='QUERY_FAILED' }
$defenderMode='NOT_AVAILABLE'
$defenderRealTime=$null
try {
    if (Get-Command -Name Get-MpComputerStatus -ErrorAction SilentlyContinue) {
        $mp=Get-MpComputerStatus -ErrorAction Stop
        $defenderMode='QUERY_COMPLETED'
        $defenderRealTime=[bool]$mp.RealTimeProtectionEnabled
    }
} catch { $defenderMode='QUERY_FAILED' }
$record=[ordered]@{
    schema='furusato-reader-winerror5-diagnostic/v1'
    observed_failure='WINERROR_5_EXECUTION_DENIED'
    exe_sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    authenticode=$signature
    zone_identifier=$zone
    acl_query=$acl
    event_scope='LAST_20_MINUTES_BASENAME_MATCH_INDICATIVE_ONLY'
    event_indicators=@($signals)
    applocker_effective_query=$appLocker
    applocker_exe_rule_collection_count=$appLockerExeRuleCount
    device_guard_query=$deviceGuard
    device_guard_usermode_ci_enforcement=$deviceGuardEnforcement
    defender_status_query=$defenderMode
    defender_realtime_enabled=$defenderRealTime
    policy_changed=$false
    private_paths_recorded=$false
    release_approved=$false
}
[IO.File]::WriteAllText($output,($record|ConvertTo-Json -Depth 6),
                       (New-Object Text.UTF8Encoding($false)))
Write-Host ('READER_WINERROR5_DIAGNOSTIC_READY signature='+$signature+
            ' zone='+$zone+' signals='+@($signals).Count)
