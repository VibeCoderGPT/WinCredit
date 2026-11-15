@echo off
rem WinCredit - push changes to GitHub.
rem The credential manager keeps the login, so this runs silently.
cd /d "%~dp0"
git push origin main
echo.
pause
