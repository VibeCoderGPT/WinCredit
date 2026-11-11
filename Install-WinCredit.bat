@echo off
rem WinCredit installer - double-click to install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-wincredit.ps1"
echo.
pause
