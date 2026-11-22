#Requires -Version 5.1
# Operator-controlled pre-EXE gate. No AV/policy change and no reader execution.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceHead)
$ErrorActionPreference = 'Stop'
$repo = 'tanaka456jp/Furusato_nouzei'
$prNumber = 5
$owner = 'tanaka456jp'
if ($env:GITHUB_ACTIONS -cne 'true' -or
    $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
    $env:GITHUB_REF -cne 'refs/heads/fix/excel-2026-salary-nta-20261107' -or
    $env:GITHUB_REPOSITORY -cne $repo -or
    $env:GITHUB_SHA -cne $SourceHead -or
    $env:RUNNER_NAME -cne 'PC1-Furusato-Excel' -or
    $env:GITHUB_ACTOR -cne $owner -or -not $env:GITHUB_TOKEN) {
    throw 'PC1_OPERATOR_READINESS_MANUAL_RUN_ONLY_RELEASE_HOLD'
}
[long]$runId = 0
[int]$attempt = 0
if (-not [long]::TryParse($env:GITHUB_RUN_ID, [ref]$runId) -or
    -not [int]::TryParse($env:GITHUB_RUN_ATTEMPT, [ref]$attempt) -or
    $runId -le 0 -or $attempt -lt 1) { throw 'INVALID_OPERATOR_RUN_ID' }
$base = "https://api.github.com/repos/$repo"
$headers = @{
    Authorization = 'Bearer ' + $env:GITHUB_TOKEN
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'Furusato-PC1-Operator-Readiness'
}
function Assert-PRHead {
    $pr = Invoke-RestMethod -Method Get -Uri "$base/pulls/$prNumber" -Headers $headers -TimeoutSec 20
    if ($pr.state -cne 'open' -or
        $pr.head.ref -cne 'fix/excel-2026-salary-nta-20261107' -or
        $pr.head.sha -cne $SourceHead -or
        $pr.head.repo.full_name -cne $repo) {
        throw 'PC1_OPERATOR_PR_HEAD_CHANGED_RELEASE_HOLD'
    }
}
function Post-Notice([string]$body) {
    $payload = @{ body = $body } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post -Uri "$base/issues/$prNumber/comments" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 20
    if ($null -eq $result -or [long]$result.id -lt 1) {
        throw 'PC1_OPERATOR_NOTIFICATION_NOT_POSTED_RELEASE_HOLD'
    }
    return $result
}
Assert-PRHead
$command = "START EXE $runId-$attempt"
$message = "@$owner PC1 reader EXE is PAUSED immediately before launch for run $runId attempt $attempt; HEAD $SourceHead." +
    "`nPlease go to PC1 now. Apex One may show a brief approval popup." +
    "`nOnly when physically ready at PC1, reply to this PR with EXACT text: $command" +
    "`nThe EXE will NOT start without a NEW comment from the repository owner." +
    "`nThis is not approval of the software release or any security-policy change."
$notice = Post-Notice $message
$afterId = [long]$notice.id
$since = [uri]::EscapeDataString(([DateTimeOffset]::Parse([string]$notice.created_at)).ToString('yyyy-MM-ddTHH:mm:ssZ'))
Write-Host 'PC1_READER_NOTIFICATION_POSTED_WAITING_FOR_OPERATOR'
$deadline = [DateTime]::UtcNow.AddMinutes(10)
$ready = $false
while ([DateTime]::UtcNow -lt $deadline) {
    $comments = @(Invoke-RestMethod -Method Get -Uri "$base/issues/$prNumber/comments?per_page=100&since=$since" -Headers $headers -TimeoutSec 20)
    foreach ($comment in $comments) {
        if ($null -ne $comment -and [long]$comment.id -gt $afterId -and
            $comment.user.login -ceq $owner -and
            $comment.user.type -ceq 'User' -and
            $comment.author_association -ceq 'OWNER' -and
            ([string]$comment.body).Trim() -ceq $command) {
            $ready = $true; break
        }
    }
    if ($ready) { break }
    Start-Sleep -Seconds 5
}
if (-not $ready) { throw 'PC1_OPERATOR_READY_TIMEOUT_NO_EXE_EXECUTION_RELEASE_HOLD' }
Assert-PRHead
[void](Post-Notice ("@$owner PC1 operator READY received for run $runId attempt $attempt." +
    "`nEXE execution is scheduled to begin after a 30-second local warning. Please watch PC1 for Apex One. Release remains HOLD."))
Write-Host 'PC1_OPERATOR_READY_ACKNOWLEDGED_30_SECOND_WARNING'
Start-Sleep -Seconds 30
Assert-PRHead
Write-Host 'PC1_OPERATOR_READY_TO_START_READER_EXE_NEXT_STEP'
