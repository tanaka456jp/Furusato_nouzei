<#
 Owner-approved isolated synthetic Google OCR acceptance.
 PreflightOnly is offline/read-only. CreateAndTest is the only Google-write mode.
 No existing script/sheet adoption. No credentials/IDs/URLs in public artifacts.
#>
[CmdletBinding()]
param([switch]$PreflightOnly,[switch]$CreateAndTest,[string]$ProtectedRoot='')
$ErrorActionPreference='Stop'
if (($PreflightOnly -and $CreateAndTest) -or (-not $PreflightOnly -and -not $CreateAndTest)) {
  throw 'Exactly one mode is required: -PreflightOnly or -CreateAndTest.'
}
$gasRoot=Split-Path -Parent $PSScriptRoot
$repoRoot=Split-Path -Parent $gasRoot
$branch='feature/gas-workflow-20261106'
$privateRoot=Join-Path $gasRoot '.private\furusato'
$oldChannel=$env:FURUSATO_BROWSER_CHANNEL
function Confirm-Exit([string]$stage){
  if($LASTEXITCODE -ne 0){throw ($stage+' failed: release HOLD. Do not retry fresh after any Google creation attempt.')}
}
Push-Location -LiteralPath $repoRoot
try {
  & node gas/deployment/private-gas.cjs preflight
  Confirm-Exit 'Static private installation preflight'
  & node gas/tests/test-live-ocr-readiness.cjs
  Confirm-Exit 'Synthetic safety regression'
  if($PreflightOnly){
    Write-Output 'PRIVATE_LIVE_OCR_LAUNCHER_PREFLIGHT=PASS; Google not accessed; release HOLD'
    return
  }
  if($env:CI){throw 'Live Google acceptance prohibited inside CI.'}
  $active=(& git branch --show-current).Trim()
  Confirm-Exit 'Git branch'
  if($active -cne $branch){throw 'Wrong dedicated worktree/branch.'}
  $dirty=@(& git status --porcelain --untracked-files=no)
  Confirm-Exit 'Git status'
  if($dirty.Count -gt 0){throw 'Tracked worktree changes; STOP.'}
  & git pull --ff-only origin $branch
  Confirm-Exit 'Git fast-forward'
  $head=(& git rev-parse HEAD).Trim()
  Confirm-Exit 'Git HEAD'
  $remote=(& git rev-parse ('origin/'+$branch)).Trim()
  Confirm-Exit 'Remote branch'
  if($head -cne $remote -or $head -notmatch '^[a-f0-9]{40}$'){
    throw 'Git HEAD differs from remote branch tip.'
  }
  $dirty=@(& git status --porcelain --untracked-files=no)
  Confirm-Exit 'Post-pull Git status'
  if($dirty.Count -gt 0){throw 'Tracked files changed; STOP.'}
  if([string]::IsNullOrWhiteSpace($ProtectedRoot)){
    $ProtectedRoot=Join-Path (Split-Path -Parent $repoRoot) 'HousingERP'
  }
  $ProtectedRoot=[IO.Path]::GetFullPath($ProtectedRoot)
  foreach($name in @('.clasp.json','appsscript.json','project.json')){
    if(-not (Test-Path -LiteralPath (Join-Path $ProtectedRoot $name) -PathType Leaf)){
      throw 'Protected HousingERP config unavailable; STOP.'
    }
  }
  $authFile=Join-Path $privateRoot 'auth.json'
  $authState=& node -e "const s=require('./gas/scripts/check-live-ocr-readiness.cjs');process.stdout.write(s.inspectIsolatedAuth(process.argv[1]));" $authFile
  Confirm-Exit 'Dedicated OAuth format'
  if($authState -cne 'VALID'){throw 'Dedicated auth missing or malformed; STOP.'}
  foreach($p in @(
    (Join-Path $privateRoot 'receipt.json'),
    (Join-Path $privateRoot 'creation-journal.json'),
    (Join-Path $privateRoot 'project\.clasp.json'),
    (Join-Path $privateRoot 'install.lock')
  )){
    if(Test-Path -LiteralPath $p){
      throw 'Existing/unfinished private installation; do not create again.'
    }
  }
  if(-not (Test-Path -LiteralPath (Join-Path $gasRoot 'node_modules\playwright\package.json'))){
    & npm ci --prefix gas --ignore-scripts --no-audit --no-fund
    Confirm-Exit 'Local Node dependencies'
  }
  $pyTarget=Join-Path $gasRoot '.qa-python'
  if(-not (Test-Path -LiteralPath (Join-Path $pyTarget 'pypdf\__init__.py') -PathType Leaf)){
    & python -m pip install --target $pyTarget 'pypdf==6.1.3' --disable-pip-version-check
    Confirm-Exit 'Isolated PDF checker install'
  }
  & python -c "import sys;sys.path.insert(0,sys.argv[1]);import pypdf;assert pypdf.__version__=='6.1.3'" $pyTarget
  Confirm-Exit 'PDF checker readiness'
  # First Google write begins in guarded install --fresh, after all local checks.
  Write-Output 'OWNER_APPROVED_NEW_PRIVATE_GOOGLE_SYNTHETIC_CREATION: beginning guarded installation'
  & node gas/deployment/private-gas.cjs install --fresh --deploy --protected-root $ProtectedRoot
  Confirm-Exit 'Private project creation, source upload, and immutable deployment'
  & node gas/deployment/private-gas.cjs verify --attest-head --protected-root $ProtectedRoot
  Confirm-Exit 'Post-deploy owner/source/access/protected-resource verification'
  $env:FURUSATO_BROWSER_CHANNEL='msedge'
  & node gas/scripts/check-live-ocr-readiness.cjs --run-synthetic --ack-temporary-google-docs --protected-root $ProtectedRoot
  Confirm-Exit 'Real Google PDF/PNG/JPEG OCR and cleanup'
  & node gas/deployment/private-gas.cjs verify --attest-head --protected-root $ProtectedRoot
  Confirm-Exit 'Post-OCR HousingERP + source/deployment protection verification'
  $evidencePath=Join-Path $privateRoot 'evidence\browser-evidence.json'
  if(-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)){
    throw 'Private browser evidence missing; HOLD.'
  }
  $e=Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
  if($e.status -cne 'PASS' -or $e.environment -cne 'REAL_GOOGLE_WEB_APP' -or
     $e.googleAcceptance -cne 'PASS' -or $e.release -cne 'HOLD' -or $e.sourceCommit -cne $head){
    throw 'Real Google evidence provenance/status mismatch; HOLD.'
  }
  foreach($id in @('TAX-700','PRINT-PDF','MOBILE','HOLD-MORTGAGE','GOOGLE-DRIVE-API',
    'GOOGLE-OCR-PNG','GOOGLE-OCR-PDF','GOOGLE-OCR-JPEG')){
    $row=@($e.tests | Where-Object {$_.id -ceq $id -and $_.status -ceq 'PASS'})
    if($row.Count -ne 1){throw 'Required acceptance evidence missing; HOLD.'}
    if($id -like 'GOOGLE-OCR-*' -and $row[0].cleanup -cne 'PASS'){
      throw 'Temporary Google OCR document cleanup unverified; HOLD.'
    }
  }
  Write-Output 'PRIVATE_REAL_GOOGLE_OCR=PASS: PDF PNG JPEG, candidate amounts, HOLD, zero temporary files'
  Write-Output 'IPHONE_PHYSICAL_SAFARI=NOT_TESTED; release HOLD; IDs and web URL remain local'
}finally{
  $env:FURUSATO_BROWSER_CHANNEL=$oldChannel
  Pop-Location
}
