@echo off
rem WinCredit - dev launcher (double-click to run outside the DSH sandbox)
cd /d "D:\WinCredit"
set ELECTRON_RUN_AS_NODE=
set WINCREDIT_HOME=D:\WinCredit\.dev-profile
set WINCREDIT_DEV=1
start "WinCredit" "D:\WinCredit\node_modules\electron\dist\electron.exe" --disable-crash-reporter --user-data-dir="D:\WinCredit\.dev-profile" "D:\WinCredit"
