<#
Run official v4.18.2 Excel COM comparisons using synthetic cases only.
A new Excel instance is created; macros/events disabled; no Google access.
#>
[CmdletBinding()]
param([string]$ReleaseZip='', [string]$OutputPath='', [switch]$PreflightOnly)
$ErrorActionPreference='Stop'
$expectedZipSha='f534882f56461ea23a75474f24e68ad364d557091609c994341c179e9a655f25'
$caseFile=Join-Path $PSScriptRoot 'cases.cjs'
$comparison=Join-Path $PSScriptRoot 'compare-excel.cjs'
if(-not (Test-Path -LiteralPath $caseFile -PathType Leaf)){throw 'Synthetic cases file missing'}
if(-not (Test-Path -LiteralPath $comparison -PathType Leaf)){throw 'Comparison program missing'}
$node=Get-Command node -ErrorAction SilentlyContinue
if(-not $node){throw 'Node 22+ required'}
$raw=& $node.Source $caseFile --ndjson
if($LASTEXITCODE -ne 0){throw 'Could not generate synthetic cases'}
$cases=@(foreach($line in $raw){ConvertFrom-Json -InputObject ([string]$line)})
if($cases.Count -ne 41){throw 'Synthetic case count mismatch'}
$unique=@($cases | ForEach-Object {$_.id} | Select-Object -Unique)
if($unique.Count -ne $cases.Count){throw 'Duplicate case IDs'}
if($PreflightOnly){
 Write-Output ('EXCEL_PARITY_PREFLIGHT_PASS: synthetic cases='+$cases.Count+'; no Excel or Google accessed')
 return
}
if([string]::IsNullOrWhiteSpace($ReleaseZip)){throw 'Official -ReleaseZip is required'}
$zipPath=(Resolve-Path -LiteralPath $ReleaseZip).Path
if((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedZipSha){
 throw 'Official ReadyToUse ZIP SHA-256 mismatch: STOP'
}
if(-not $OutputPath){$OutputPath=Join-Path $env:TEMP ('FurusatoParity_'+[guid]::NewGuid().ToString('N')+'.json')}
$outputFull=[System.IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $outputFull){throw 'Output already exists; refusing overwrite'}
$parent=Split-Path -Parent $outputFull
if(-not (Test-Path -LiteralPath $parent -PathType Container)){throw 'Output parent folder missing'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workdir=Join-Path $env:TEMP ('FurusatoParityIsolated_'+[guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($workdir)
$workbookPath=Join-Path $workdir 'Furusato_nouzei.xlsm'
$excel=$null;$book=$null;$sheet=$null;$results=@()
try {
 $archive=[System.IO.Compression.ZipFile]::OpenRead($zipPath)
 try{
  $entries=@($archive.Entries | Where-Object {$_.Name -ceq 'Furusato_nouzei.xlsm'})
  if($entries.Count -ne 1){throw 'Expected one official XLSM entry in ZIP'}
  $read=$entries[0].Open();$write=[System.IO.File]::Create($workbookPath)
  try{$read.CopyTo($write)}finally{$write.Dispose();$read.Dispose()}
 }finally{$archive.Dispose()}
 $bookHash=(Get-FileHash -LiteralPath $workbookPath -Algorithm SHA256).Hash.ToLowerInvariant()
 # Excel sheet and option strings encoded in Unicode for PowerShell 5.1.
 $sheetName=-join @([char]0x64CD,[char]0x4F5C,[char]0x753B,[char]0x9762)
 $normal=-join @([char]0x6B63,[char]0x5E38)
 $oneStop=-join @([char]0x30EF,[char]0x30F3,[char]0x30B9,[char]0x30C8,[char]0x30C3,[char]0x30D7)
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false
 $excel.DisplayAlerts=$false
 $excel.EnableEvents=$false
 $excel.AskToUpdateLinks=$false
 $excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open($workbookPath,0,$true)
 $sheet=$book.Worksheets.Item($sheetName)
 foreach($case in $cases){
  if($case.year -ne 2025 -and $case.year -ne 2026){throw 'Invalid year'}
  if($case.filing -cne 'one-stop'){throw 'Invalid filing'}
  $sheet.Range('B4').Value2=[string]$case.year
  $sheet.Range('B11').Value2=[string]$case.year
  $sheet.Range('B12').Value2=[double]$case.salaryGross
  $sheet.Range('B15').Value2=[double]0
  $sheet.Range('B16').Value2=[double]$case.socialInsurance
  $sheet.Range('D24').Value2=$oneStop
  $excel.CalculateFullRebuild()
  $ticks=0
  while([int]$excel.CalculationState -ne 0 -and $ticks -lt 300){
   Start-Sleep -Milliseconds 100;$ticks++
  }
  if([int]$excel.CalculationState -ne 0){throw 'Excel calculation timeout'}
  $state=[string]$sheet.Range('B28').Value2
  if($state -ceq $normal){
   $amount=$sheet.Range('B8').Value2
   $salary=$sheet.Range('B13').Value2
   $levy=$sheet.Range('D8').Value2
   foreach($n in @($amount,$salary,$levy)){
    if($null -eq $n -or -not ($n -is [double] -or $n -is [int] -or $n -is [long]) -or
      $n -lt 0 -or $n -gt 1000000000000 -or $n -ne [Math]::Truncate($n)){
     throw ('Invalid Excel numeric output for '+$case.id)
    }
   }
   $results += [pscustomobject]@{id=$case.id;year=[int]$case.year;
    salaryGross=[long]$case.salaryGross;socialInsurance=[long]$case.socialInsurance;
    filing='one-stop';status='NORMAL';donationLimitYen=[long]$amount;
    salaryIncomeYen=[long]$salary;residentIncomeLevyYen=[long]$levy}
  }else{
   $results += [pscustomobject]@{id=$case.id;year=[int]$case.year;
    salaryGross=[long]$case.salaryGross;socialInsurance=[long]$case.socialInsurance;
    filing='one-stop';status='HOLD';donationLimitYen=$null;
    salaryIncomeYen=$null;residentIncomeLevyYen=$null}
  }
 }
 if($results.Count -ne $cases.Count){throw 'Incomplete Excel oracle'}
 $oracle=[ordered]@{schema='furusato-excel-oracle/v1';source='OFFICIAL_RELEASE';
  releaseTag='v4.18.2';releaseZipSha256=$expectedZipSha;
  excelWorkbookSha256=$bookHash;calculationProvider='EXCEL_COM';macrosDisabled=$true;results=@($results)}
 $json=ConvertTo-Json -InputObject $oracle -Depth 8
 [System.IO.File]::WriteAllText($outputFull,$json,([System.Text.UTF8Encoding]::new($false)))
}finally{
 if($null -ne $book){try{$book.Close($false)}catch{}}
 if($null -ne $excel){try{$excel.Quit()}catch{}}
 if($null -ne $sheet){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)}
 if($null -ne $book){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)}
 if($null -ne $excel){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
 [GC]::Collect();[GC]::WaitForPendingFinalizers()
 if(Test-Path -LiteralPath $workdir){Remove-Item -LiteralPath $workdir -Recurse -Force}
}
Write-Output ('EXCEL_ORACLE_CREATED: '+$outputFull+' (synthetic only)')
& $node.Source $comparison --oracle $outputFull
if($LASTEXITCODE -ne 0){throw 'EXCEL_PARITY_HOLD: mismatches or invalid oracle; tax engine unchanged'}
Write-Output 'COVERED_CASES_MATCH only; full acceptance remains HOLD'
