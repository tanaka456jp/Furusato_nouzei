@echo off
setlocal
cd /d "%~dp0"
echo Furusato Excel open diagnostic ONLY. Never use probes for tax calculation.
powershell.exe -NoProfile -File "%~dp0run_excel_open_probe.ps1"
set "CODE=%ERRORLEVEL%"
echo JSON result: excel_open_results.json
pause
exit /b %CODE%
