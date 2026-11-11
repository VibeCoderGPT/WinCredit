@echo off
rem WinCredit — push changes to GitHub.
rem The first run opens a GitHub login page once; after that it's automatic.
cd /d "D:\WinCredit"
git push origin main
echo.
pause
