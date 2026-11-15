@echo off
rem WinCredit - dev launcher (double-click to run outside the DSH sandbox).
rem Uses its own folder, so the workspace can live anywhere.
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set WINCREDIT_HOME=%~dp0.dev-profile
set WINCREDIT_DEV=1
start "WinCredit" "%~dp0node_modules\electron\dist\electron.exe" --disable-crash-reporter --user-data-dir="%~dp0.dev-profile" "%~dp0."
