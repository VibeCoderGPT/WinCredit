# Download the latin subsets of Fraunces (600) and Inter (400/500/600/700) as woff2.
$ErrorActionPreference = 'Stop'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
$cssUrl = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap'
$css = (Invoke-WebRequest -Uri $cssUrl -Headers @{ 'User-Agent' = $ua } -UseBasicParsing).Content
$outDir = 'D:\WinCredit\assets\fonts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$blocks = [regex]::Matches($css, '@font-face\s*\{[^}]*\}') | ForEach-Object { $_.Value }
$faceCss = @()
foreach ($b in $blocks) {
  $fam = [regex]::Match($b, "font-family:\s*'([^']+)'").Groups[1].Value
  $weight = [regex]::Match($b, 'font-weight:\s*([0-9 ]+)').Groups[1].Value.Trim() -replace '\s+', ' '
  $range = [regex]::Match($b, 'unicode-range:\s*([^;]+);').Groups[1].Value.Trim()
  $url = [regex]::Match($b, "url\((https://fonts\.gstatic\.com/[^)]+)\)").Groups[1].Value
  if (-not $url -or $range -notmatch '^U\+0000-00FF') { continue }   # latin subset only
  $slug = ($fam -replace '\s+', '').ToLower()
  $w = $weight -replace '\s+', '-'
  $file = "$outDir\$slug-$w.woff2"
  if (Test-Path $file) { continue }
  Invoke-WebRequest -Uri $url -Headers @{ 'User-Agent' = $ua } -UseBasicParsing -OutFile $file
  Write-Host "got $slug-$w.woff2"
  $faceCss += "@font-face { font-family: '$fam'; font-style: normal; font-weight: $weight; font-display: swap; src: url('fonts/$slug-$w.woff2') format('woff2'); }"
}
$faceCss | Set-Content "$outDir\fonts.css"
Write-Host '--- fonts.css ---'
$faceCss
