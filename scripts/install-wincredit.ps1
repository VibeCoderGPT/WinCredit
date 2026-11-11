<#
  WinCredit installer
  Copies the packaged app to %LOCALAPPDATA%\Programs\WinCredit,
  creates Start Menu + Desktop shortcuts with the gold-W icon,
  and drops an uninstall script next to the app.

  All paths are overridable so the script can be dry-run tested.
#>
param(
  [string]$Source = '',
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Programs\WinCredit'),
  [string]$StartMenuDir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [string]$DesktopDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

if (-not $Source) { $Source = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\WinCredit' }
$Source = (Resolve-Path $Source).Path
if (-not (Test-Path (Join-Path $Source 'WinCredit.exe'))) {
  throw "WinCredit.exe not found in $Source"
}

Write-Host 'WinCredit installer'
Write-Host "  from : $Source"
Write-Host "  to   : $Target"

# Close a running instance of the installed app (the dev instance is a different exe).
Stop-Process -Name WinCredit -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item (Join-Path $Source '*') $Target -Recurse -Force

# ---- shortcuts ----
$shortcutDir = Join-Path $StartMenuDir 'WinCredit'
New-Item -ItemType Directory -Force -Path $shortcutDir, $DesktopDir | Out-Null
$ws = New-Object -ComObject WScript.Shell

$app = $ws.CreateShortcut((Join-Path $shortcutDir 'WinCredit.lnk'))
$app.TargetPath = Join-Path $Target 'WinCredit.exe'
$app.Arguments = '--no-sandbox --disable-crash-reporter'
$app.WorkingDirectory = $Target
$app.IconLocation = (Join-Path $Target 'WinCredit.ico') + ',0'
$app.Description = 'WinCredit - encrypted card vault'
$app.Save()

$un = $ws.CreateShortcut((Join-Path $shortcutDir 'Uninstall WinCredit.lnk'))
$un.TargetPath = 'powershell.exe'
$un.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Target 'uninstall-wincredit.ps1') + '"'
$un.WorkingDirectory = $Target
$un.IconLocation = (Join-Path $Target 'WinCredit.ico') + ',0'
$un.Save()

$desk = $ws.CreateShortcut((Join-Path $DesktopDir 'WinCredit.lnk'))
$desk.TargetPath = Join-Path $Target 'WinCredit.exe'
$desk.Arguments = '--no-sandbox --disable-crash-reporter'
$desk.WorkingDirectory = $Target
$desk.IconLocation = (Join-Path $Target 'WinCredit.ico') + ',0'
$desk.Description = 'WinCredit - encrypted card vault'
$desk.Save()

# ---- uninstaller (written next to the app) ----
$uninstaller = @'
param(
  [string]$StartMenuDir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [string]$DesktopDir = [Environment]::GetFolderPath('Desktop')
)
$ErrorActionPreference = 'SilentlyContinue'
$target = Split-Path -Parent $MyInvocation.MyCommand.Path
Stop-Process -Name WinCredit -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Remove-Item (Join-Path $StartMenuDir 'WinCredit') -Recurse -Force
Remove-Item (Join-Path $DesktopDir 'WinCredit.lnk') -Force
# The app folder holds this running script, so it is removed by cmd after we exit.
$cmdLine = 'timeout /t 2 /nobreak >nul & rmdir /s /q "' + $target + '"'
Start-Process cmd.exe -ArgumentList @('/c', $cmdLine) -WindowStyle Hidden
Write-Host 'WinCredit removed.'
Write-Host 'Your encrypted vault was kept: ' (Join-Path $env:APPDATA 'WinCredit\vault.wcv')
Write-Host 'Delete that file manually if you also want the data gone.'
'@
Set-Content -Path (Join-Path $Target 'uninstall-wincredit.ps1') -Value $uninstaller -Encoding UTF8

Write-Host 'Done.'
Write-Host "  Start Menu : $shortcutDir"
Write-Host "  Desktop    : $DesktopDir"
Write-Host 'Launch WinCredit and create your vault.'
