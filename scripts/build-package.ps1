<#
  Rebuild the WinCredit package after code changes.
  Syncs the staged app dir and repacks resources\app.asar.
  (WinCredit.exe only needs scripts\patch_exe.mjs again if the exe itself was replaced.)
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root '.build\app'
$dist = Join-Path $root 'dist\WinCredit'

New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $root 'main.js'), (Join-Path $root 'preload.js'),
          (Join-Path $root 'vault.js'), (Join-Path $root 'package.json'),
          (Join-Path $root 'README.md') $stage -Force
Copy-Item (Join-Path $root 'lib') (Join-Path $root 'src') (Join-Path $root 'assets') $stage -Recurse -Force

& node (Join-Path $root 'node_modules\@electron\asar\bin\asar.mjs') pack $stage (Join-Path $dist 'resources\app.asar')
if ($LASTEXITCODE -ne 0) { throw 'asar pack failed' }
Write-Host 'Package rebuilt:' (Join-Path $dist 'resources\app.asar')
