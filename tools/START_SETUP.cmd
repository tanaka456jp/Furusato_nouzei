@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "LAUNCHER=%~dp0setup_launcher.log"
>"%LAUNCHER%" echo Furusato_nouzei setup launcher - ASCII-safe v4.10
>>"%LAUNCHER%" echo Folder: %CD%
echo.
echo Furusato_nouzei - First-time Excel setup v4
echo Input workbook is preserved. Output: Furusato_nouzei.xlsm
if not exist "%~dp0setup.ps1" (
  echo ERROR: setup.ps1 missing.
  >>"%LAUNCHER%" echo ERROR: setup.ps1 missing.
  goto :fail
)
if not exist "%~dp0Furusato_nouzei.xlsx" (
  echo ERROR: Furusato_nouzei.xlsx missing.
  >>"%LAUNCHER%" echo ERROR: Furusato_nouzei.xlsx missing.
  goto :fail
)
if not exist "%~dp0TaxLawUpdater.bas" (
  echo ERROR: TaxLawUpdater.bas missing.
  >>"%LAUNCHER%" echo ERROR: TaxLawUpdater.bas missing.
  goto :fail
)
if not exist "%~dp0BatchWithholding.bas" (
  echo ERROR: BatchWithholding.bas missing.
  >>"%LAUNCHER%" echo ERROR: BatchWithholding.bas missing.
  goto :fail
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Windows PowerShell is unavailable.
  >>"%LAUNCHER%" echo ERROR: powershell.exe not found.
  goto :fail
)
echo Starting Windows Excel automation...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" >>"%LAUNCHER%" 2>&1
set "PS_RC=%ERRORLEVEL%"
>>"%LAUNCHER%" echo PowerShell exit code: %PS_RC%
if not "%PS_RC%"=="0" goto :fail
if not exist "%~dp0Furusato_nouzei.xlsm" (
  echo ERROR: installer returned success but no .xlsm file exists.
  >>"%LAUNCHER%" echo ERROR: missing output xlsm.
  goto :fail
)
echo.
echo SUCCESS: Furusato_nouzei.xlsm was created.
echo Details: setup.log / setup_launcher.log
explorer.exe /select,"%~dp0Furusato_nouzei.xlsm"
exit /b 0
:fail
echo.
echo FAILED: Please attach setup.log AND setup_launcher.log.
echo Both logs are in this folder. They capture errors before VBA installation.
echo.
echo.
echo To identify the cause, open setup.log in Notepad.
echo Long error details are preserved in setup_launcher.log.
echo If Excel cannot open the .xlsx, check the original ZIP Properties
echo for an Unblock button, then extract to a NEW folder.
echo Do not disable all Microsoft Excel Protected View settings.
echo.
pause
exit /b 1
