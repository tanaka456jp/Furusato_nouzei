#Requires -Version 5.1
<#
  Live numerical observations from an isolated, already-accepted v4.18.3 XLSM.
  A separate pinned GAS engine checks the results. Customer files are never used.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Workbook,
  [Parameter(Mandatory=$true)][string]$GasCheckout,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
$expectedCommit='347aae5756b90c05a10b2ffe6123b0ce09e3fc01'
$workbookPath=(Resolve-Path -LiteralPath $Workbook).Path
$gasPath=(Resolve-Path -LiteralPath $GasCheckout).Path
$node=Get-Command node -ErrorAction Stop
$actualCommit=[string](& git -C $gasPath rev-parse HEAD)
if($LASTEXITCODE -ne 0 -or $actualCommit.Trim() -cne $expectedCommit){
  throw 'GAS reference commit differs from approved pinned SHA'
}
$casePath=Join-Path $gasPath 'gas\parity\cases.cjs'
$enginePath=Join-Path $gasPath 'gas\Engine.gs'
if(-not (Test-Path -LiteralPath $casePath -PathType Leaf) -or
   -not (Test-Path -LiteralPath $enginePath -PathType Leaf)) {
  throw 'Pinned GAS reference files missing'
}
$caseLines=@(& $node.Source $casePath --ndjson)
if($LASTEXITCODE -ne 0){throw 'Cannot load GAS synthetic cases'}
$cases=@(foreach($line in $caseLines){ConvertFrom-Json -InputObject ([string]$line)})
if($cases.Count -ne 41){throw 'Expected exactly 41 GAS synthetic cases'}
if(@($cases | ForEach-Object {$_.id} | Select-Object -Unique).Count -ne 41){
  throw 'Duplicate synthetic case IDs'
}
$anchor7=@($cases | Where-Object {$_.id -ceq 'Y2026_G7000000'})
$anchor5=@($cases | Where-Object {$_.id -ceq 'Y2026_G5000000'})
if($anchor7.Count -ne 1 -or $anchor5.Count -ne 1) {
  throw 'Missing synthetic ABA anchors'
}
$out=[IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $out){throw 'Refusing overwrite of existing evidence'}
if(-not (Test-Path -LiteralPath (Split-Path $out -Parent) -PathType Container)){
  throw 'Evidence folder must already exist'
}
$workbookSha=(Get-FileHash -LiteralPath $workbookPath -Algorithm SHA256).Hash.ToLowerInvariant()
$engineSha=(Get-FileHash -LiteralPath $enginePath -Algorithm SHA256).Hash.ToLowerInvariant()
$excel=$null;$book=$null;$screenSheet=$null;$master=$null;$ownsExcel=$false
$observed=@();$probes=@()
try {
  # Never attach to, modify or terminate an already-running Excel session.
  $existing=@(Get-Process -Name EXCEL -ErrorAction SilentlyContinue |
    ForEach-Object {[uint32]$_.Id})
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FurusatoExcelParityPidV4183 {
 [DllImport("user32.dll")]
 public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint pid);
}
'@
  $excel=New-Object -ComObject Excel.Application
  [uint32]$excelPid=0
  [void][FurusatoExcelParityPidV4183]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd,[ref]$excelPid)
  if($excelPid -eq 0 -or $existing -contains $excelPid){
    throw 'Excel COM is shared or its process could not be identified'
  }
  $ownsExcel=$true
  $excel.Visible=$false
  $excel.DisplayAlerts=$false
  $excel.EnableEvents=$false
  $excel.AskToUpdateLinks=$false
  $excel.AutomationSecurity=3
  $book=$excel.Workbooks.Open($workbookPath,0,$true)
  if(-not $book.ReadOnly){throw 'Accepted XLSM must open read-only'}
  $screenSheet=$book.Worksheets.Item('操作画面')
  $master=$book.Worksheets.Item('設定・税率')
  if([string]$screenSheet.Range('A1').Value2 -notmatch 'v4\.18\.(?:1[0-5]|[3-9])'){
    throw 'Workbook is not an approved v4.18.3/4 review build'
  }
  # Manual mode is applied only to this newly-owned Excel instance.
  $excel.Calculation=-4135
  $excelRevision = [regex]::Match([string]$screenSheet.Range('A1').Value2, 'v4\.18\.(?:1[0-5]|[3-9])').Value + '-review'
  $sequence=@($anchor7[0],$anchor5[0],$anchor7[0]) + @($cases)
  $counter=0
  foreach($case in $sequence){
    $counter++
    if($case.year -ne 2025 -and $case.year -ne 2026){throw 'Unexpected test year'}
    if($case.filing -cne 'one-stop'){throw 'Unsupported filing mode in reference cases'}
    $master.Range('B4').Value2=[int]$case.year
    $screenSheet.Range('B4').Value2=[string]$case.year
    $screenSheet.Range('B11').Value2=[string]$case.year
    $screenSheet.Range('B12').Value2=[double]$case.salaryGross
    $screenSheet.Range('B15').Value2=[double]0
    $screenSheet.Range('B16').Value2=[double]$case.socialInsurance
    $screenSheet.Range('D24').Value2='ワンストップ'
    $excel.Calculate()
    $state=[int]$excel.CalculationState
    for($attempt=0;$attempt -lt 12 -and $state -eq 1;$attempt++){
      Start-Sleep -Milliseconds 100
      $state=[int]$excel.CalculationState
    }
    if($state -ne 0 -and $state -ne 2){
      throw ('Excel calculation not safe to observe: '+$case.id+'; state='+$state)
    }
    $active=[string]$screenSheet.Range('D4').Value2
    if($active -cne [string]$case.year){
      throw ('Tax master year mismatch: '+$case.id)
    }
    $status=[string]$screenSheet.Range('B28').Value2
    if($status -cne '正常'){throw ('Excel did not return NORMAL for '+$case.id+'; '+$status)}
    $income=$screenSheet.Range('B13').Value2
    $levy=$screenSheet.Range('D8').Value2
    $limit=$screenSheet.Range('B8').Value2
    foreach($val in @($income,$levy,$limit)){
      if($null -eq $val -or
         -not ($val -is [double] -or $val -is [int] -or $val -is [long]) -or
         $val -lt 0 -or $val -gt 1000000000000 -or
         $val -ne [Math]::Truncate([double]$val)){
        throw ('Non-integral/missing Excel financial output: '+$case.id)
      }
    }
    $record=[pscustomobject]@{
      id=[string]$case.id;year=[int]$case.year;salaryGross=[long]$case.salaryGross
      socialInsurance=[long]$case.socialInsurance;filing='one-stop'
      status='NORMAL';statusText=$status;calcState=$state
      salaryIncomeYen=[long]$income
      residentIncomeLevyYen=[long]$levy
      donationLimitYen=[long]$limit
    }
    if($counter -le 3){$probes+= $record}
    else{$observed+= $record}
    Write-Output ('EXCEL_GAS_COM_41 '+$counter+'/44 '+$record.id+
      ' gross='+$record.salaryGross+'; income='+$record.salaryIncomeYen+
      '; residentLevy='+$record.residentIncomeLevyYen+
      '; limit='+$record.donationLimitYen+'; state='+$state)
  }
  $changed=($probes[0].salaryIncomeYen -ne $probes[1].salaryIncomeYen) -and
           ($probes[0].donationLimitYen -ne $probes[1].donationLimitYen)
  $restored=($probes[0].salaryIncomeYen -eq $probes[2].salaryIncomeYen) -and
            ($probes[0].donationLimitYen -eq $probes[2].donationLimitYen)
  if(-not $changed -or -not $restored -or
     $probes[0].donationLimitYen -ne 109000 -or
     $probes[1].donationLimitYen -ne 51000){
    throw 'Excel ABA dynamic recalculation proof failed'
  }
  if($observed.Count -ne 41){throw 'Missing Excel comparison cases'}
  # Diagnostic only: 'forceFullCalc' is stored as 1 in the generated XLSM.
  # In this read-only, owned Excel COM instance, disable it in memory
  # after the evidence cases are collected. Never save the workbook.
  $calcDiagnostic=[ordered]@{
    schema='furusato-excel-calc-state-diagnostic/v1'
    baselinePendingCount=@($observed | Where-Object {$_.calcState -eq 2}).Count
    initialForceFullCalculation=$null
    initialFullCalculationOnLoad=$null
    initialCalculationState=[int]$excel.CalculationState
    forceFullCalculationAfterDisable=$null
    calculationStateAfterDisableAndCalculate=$null
    transitions=@()
    stateVerdict='NOT_TESTED'
    readOnly=$true;persistedToWorkbook=$false
  }
  try {
    $calcDiagnostic.initialForceFullCalculation=[bool]$book.ForceFullCalculation
    $calcDiagnostic.initialFullCalculationOnLoad=[bool]$book.FullCalculationOnLoad
    $book.ForceFullCalculation=$false
    $calcDiagnostic.forceFullCalculationAfterDisable=[bool]$book.ForceFullCalculation
    $excel.Calculate()
    $calcDiagnostic.calculationStateAfterDisableAndCalculate=[int]$excel.CalculationState
    $calcTransitions=@()
    foreach($gross in @(7000000,5000000,7000000)){
      $master.Range('B4').Value2=2026
      $screenSheet.Range('B4').Value2='2026'
      $screenSheet.Range('B11').Value2='2026'
      $screenSheet.Range('B12').Value2=[double]$gross
      $screenSheet.Range('B15').Value2=[double]0
      $screenSheet.Range('B16').Value2=[double]1000000
      $screenSheet.Range('D24').Value2='ワンストップ'
      $excel.Calculate()
      $cState=[int]$excel.CalculationState
      $incomeVal=$screenSheet.Range('B13').Value2
      $limitVal=$screenSheet.Range('B8').Value2
      $calcTransitions+= [pscustomobject]@{
        salaryGrossYen=[long]$gross;calculationState=$cState
        salaryIncomeYen=if($null -eq $incomeVal){$null}else{[long]$incomeVal}
        donationLimitYen=if($null -eq $limitVal){$null}else{[long]$limitVal}
        statusText=[string]$screenSheet.Range('B28').Value2
      }
    }
    $calcDiagnostic.transitions=@($calcTransitions)
    $anchorGood=($calcTransitions[0].salaryIncomeYen -eq 5200000) -and
      ($calcTransitions[1].salaryIncomeYen -eq 3560000) -and
      ($calcTransitions[2].salaryIncomeYen -eq 5200000) -and
      ($calcTransitions[0].donationLimitYen -eq 109000) -and
      ($calcTransitions[1].donationLimitYen -eq 51000) -and
      ($calcTransitions[2].donationLimitYen -eq 109000) -and
      (@($calcTransitions | Where-Object {$_.statusText -cne '正常'}).Count -eq 0)
    if(-not $anchorGood){
      $calcDiagnostic.stateVerdict='DYNAMIC_VALUES_UNVERIFIED'
    } elseif(@($calcTransitions | Where-Object {$_.calculationState -ne 0}).Count -eq 0) {
      $calcDiagnostic.stateVerdict='XL_DONE_AFTER_DISABLE_FORCE_FULL'
    } else {
      $calcDiagnostic.stateVerdict='PENDING_REMAINS_AFTER_DISABLE_FORCE_FULL'
    }
  }
  catch {
    $calcDiagnostic.stateVerdict='DIAGNOSTIC_ERROR'
    $calcDiagnostic.errorMessage=[string]$_.Exception.Message
  }
  Write-Output ('EXCEL_CALC_STATE_DIAG: forceFullInitial='+
    $calcDiagnostic.initialForceFullCalculation+'; stateBefore='+
    $calcDiagnostic.initialCalculationState+'; afterDisable='+
    $calcDiagnostic.calculationStateAfterDisableAndCalculate+'; verdict='+
    $calcDiagnostic.stateVerdict+'; release=HOLD')
  $evidence=[ordered]@{
    schema='furusato-excel-gas-v4183/v1'
    source='EXCEL_COM_V4_18_3_REVIEW'
    excelRevision=$excelRevision
    officialExcelSource=$false
    workbookSha256=$workbookSha
    gasCommitSha=$expectedCommit
    gasEngineSha256=$engineSha
    macrosDisabled=$true;readOnly=$true
    dynamicABA=$true;existingExcelPidsProtected=$true
    calculationDiagnostics=$calcDiagnostic
    releaseVerdict='HOLD'
    results=@($observed)
  }
  [IO.File]::WriteAllText($out,(ConvertTo-Json -InputObject $evidence -Depth 8),
      ([System.Text.UTF8Encoding]::new($false)))
  Write-Output ('EXCEL_GAS_41_OBSERVED: cases='+$observed.Count+
    '; globalPending='+@($observed | Where-Object {$_.calcState -eq 2}).Count+
    '; release=HOLD; file='+$out)
}
finally {
  if($null -ne $book){try{$book.Close($false)}catch{}}
  if($ownsExcel -and $null -ne $excel){try{$excel.Quit()}catch{}}
  if($null -ne $master){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($master)}
  if($null -ne $screenSheet){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($screenSheet)}
  if($null -ne $book){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)}
  if($null -ne $excel){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
