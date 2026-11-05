@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0初回セットアップ.ps1"
if errorlevel 1 (
 echo.
 echo セットアップに失敗しました。READMEとエラー内容を確認してください。
 pause
 exit /b 1
)
pause
