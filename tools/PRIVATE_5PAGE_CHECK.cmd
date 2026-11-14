@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "%~dp0Furusato_nouzei.xlsm" (
 echo ERROR: First execute START_SETUP.cmd to generate Furusato_nouzei.xlsm.
 goto :fail
)
if not exist "%~dp0FurusatoDocumentReader.exe" (
 echo ERROR: Use the complete Windows REVIEW ZIP with the local PDF reader.
 goto :fail
)
if not exist "%~dp0private_batch_excel_acceptance.ps1" (
 echo ERROR: Missing offline private verification script.
 goto :fail
)
echo PRIVATE LOCAL REVIEW: select the five-page PDF using the file dialog.
echo No slip, names, or amounts will be sent to GitHub or the network.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0private_batch_excel_acceptance.ps1" -Workbook "%~dp0Furusato_nouzei.xlsm" -Reader "%~dp0FurusatoDocumentReader.exe" -ExpectedPages 5
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" goto :fail
echo Local PDF import acceptance finished. No original file was changed.
pause
exit /b 0
:fail
echo Local review HOLD. Do not publish or trust unreviewed amounts.
pause
exit /b 1
