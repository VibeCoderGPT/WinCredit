$ErrorActionPreference = 'Stop'
$out = 'D:\WinCredit\.ps-bridge-report.txt'
$r = @()

# 1. powershell.exe (Windows PowerShell 5.1) present?
$r += 'ps51=' + [bool](Get-Command powershell.exe -ErrorAction SilentlyContinue)

# 2. Compile the exact capture bridge from main.js (GetForegroundWindow P/Invoke)
try {
  Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
  $r += 'getfg-compile=OK'
} catch { $r += 'getfg-compile=FAIL ' + $_.Exception.Message }

# 3. Compile the exact paste bridge (SetForegroundWindow P/Invoke) - never called
try {
  Add-Type -Namespace W2 -Name U2 -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'
  $r += 'setfg-compile=OK'
} catch { $r += 'setfg-compile=FAIL ' + $_.Exception.Message }

# 4. SendKeys availability (Windows Forms)
try {
  Add-Type -AssemblyName System.Windows.Forms
  $r += 'sendkeys=OK (' + [System.Windows.Forms.SendKeys].FullName + ')'
} catch { $r += 'sendkeys=FAIL ' + $_.Exception.Message }

# 5. Actually read the current foreground window (harmless, read-only)
try {
  $h = [W.U]::GetForegroundWindow().ToInt64()
  $r += 'getfg-call=OK hwnd=' + $h
} catch { $r += 'getfg-call=FAIL ' + $_.Exception.Message }

$r | Set-Content $out
$r
