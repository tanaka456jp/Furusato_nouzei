@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "%~dp0Furusato_nouzei.xlsm" (
 echo ERROR: Run START_SETUP.cmd first.
 goto :fail
)
if not exist "%~dp0FurusatoDocumentReader.exe" (
 echo ERROR: Local document reader EXE is missing.
 goto :fail
)
if not exist "%~dp0private_5person_oracle_acceptance.ps1" (
 echo ERROR: Private numerical acceptance script is missing.
 goto :fail
)
if not exist "%~dp0private_5person_oracle.csv" (
 echo ERROR: Put the separately supplied PRIVATE oracle CSV next to this CMD.
 echo Never upload that private CSV or any tax slips to GitHub or CI.
 goto :fail
)
echo PRIVATE LOCAL FIVE-PERSON NUMERICAL ACCEPTANCE
echo Assumption: no other income, extra deductions or earlier donations.
echo Select the five-page PDF in the local dialog.
echo No source PDF, financial figures or personal identifiers are uploaded.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0private_5person_oracle_acceptance.ps1" -Workbook "%~dp0Furusato_nouzei.xlsm" -Reader "%~dp0FurusatoDocumentReader.exe" -OracleCsv "%~dp0private_5person_oracle.csv" -ExpectedPages 5 -QaAssumeNoOutsideIncome
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" goto :fail
echo PRIVATE numerical comparison PASS. The original workbook was not modified.
echo This is not certification of real tax-return eligibility.
pause
exit /b 0
:fail
echo HOLD: do not publish or certify any mismatched amounts.
pause
exit /b 1
