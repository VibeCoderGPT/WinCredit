<#
  Rebuild the WinCredit package after code changes.

  - Seeds dist\WinCredit from the local Electron engine when the package
    skeleton is missing (after a cleanup, or on a fresh clone).
  - Patches the exe icon + version when the skeleton is (re)seeded.
  - Syncs the staged app dir and repacks resources\app.asar every time.
#>
$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$dist  = Join-Path $root 'dist\WinCredit'
$stage = Join-Path $root '.build\app'
$engine = Join-Path $root 'node_modules\electron\dist'

# ---- 1. package skeleton (Electron runtime + patched exe) ----
if (-not (Test-Path (Join-Path $dist 'WinCredit.exe'))) {
  if (-not (Test-Path (Join-Path $engine 'electron.exe'))) {
    throw "Electron engine missing: run Dev-Setup.bat first ($engine)"
  }
  Write-Host 'Seeding dist\WinCredit from the local Electron engine...'
  if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  Copy-Item (Join-Path $engine '*') $dist -Recurse -Force
  Rename-Item (Join-Path $dist 'electron.exe') 'WinCredit.exe'
  # The packaged app replaces default_app.asar; keep only resources\app.asar.
  Remove-Item (Join-Path $dist 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $root 'assets\icon.ico') (Join-Path $dist 'WinCredit.ico') -Force
  & node (Join-Path $root 'scripts\patch_exe.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'exe patch failed' }
}

# ---- 2. keep the exe version in sync with package.json ----
$pkgVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$exeVersion = (Get-Item (Join-Path $dist 'WinCredit.exe')).VersionInfo.FileVersion
if ("$pkgVersion.0" -ne $exeVersion) {
  Write-Host "Exe version $exeVersion -> $pkgVersion, re-patching..."
  & node (Join-Path $root 'scripts\patch_exe.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'exe patch failed' }
}

# ---- 3. app payload ----
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Get-ChildItem $stage -Force | Remove-Item -Recurse -Force
Copy-Item (Join-Path $root 'main.js'), (Join-Path $root 'preload.js'),
          (Join-Path $root 'vault.js'), (Join-Path $root 'package.json'),
          (Join-Path $root 'README.md') $stage -Force
$payload = @('lib', 'src', 'assets') | ForEach-Object { Join-Path $root $_ }
Copy-Item -Path $payload -Destination $stage -Recurse -Force

# ---- 4. asar ----
$asar = Join-Path $dist 'resources\app.asar'
New-Item -ItemType Directory -Force -Path (Split-Path $asar) | Out-Null
if (Test-Path $asar) { Remove-Item $asar -Force }
& node (Join-Path $root 'node_modules\@electron\asar\bin\asar.mjs') pack $stage $asar
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $asar)) { throw 'asar pack failed' }

$kb = [math]::Round((Get-Item $asar).Length / 1KB)
Write-Host "Package rebuilt: $asar ($kb KB)"
