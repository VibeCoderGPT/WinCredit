@echo off
rem WinCredit - one-click dev environment setup.
rem The workspace only stores the source code; this rebuilds the engine on demand.
cd /d "%~dp0"
echo ============================================
echo  WinCredit - preparation de l'environnement
echo  (2-3 minutes, automatique)
echo ============================================
set ELECTRON_RUN_AS_NODE=
set ELECTRON_CACHE=%~dp0.electron-cache
set electron_config_cache=%~dp0.electron-cache
call npm install --loglevel=error
if errorlevel 1 (
  echo.
  echo [ECHEC] Verifie ta connexion internet puis relance ce script.
  pause
  exit /b 1
)
echo.
echo [OK] Environnement pret !
echo   - Run-WinCredit-dev.bat   lance l'app en mode developpement
echo   - npm test                lance les 44 tests
echo   - Push.bat                envoie les modifications sur GitHub
echo.
pause
