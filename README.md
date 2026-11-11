# WinCredit

Encrypted credit-card vault for Windows with one-click payment filling.
Your cards stay yours: they are stored encrypted under your master password,
and neither the developer nor anyone else can read them.

## What it does

1. **Store your card once** — WinCredit saves it encrypted (AES-256-GCM, key
   derived from your master password with scrypt N=2^15, r=8, p=1).
2. **Pay anywhere in two clicks** — while paying in any app (Battle.net,
   League of Legends, Steam, …), press `Ctrl+Alt+C`, click your card, and:
   - **Copy** puts the number on the clipboard (wiped automatically after
     the configured delay), or
   - **Auto-paste** switches back to the app you were using and pastes the
     number for you.
3. **Nothing leaks** — full numbers and CVVs never leave the main process.
   The UI only ever sees masked values (`•••• 4242`).

## Security model

| Concern | Design |
|---|---|
| Storage | `%APPDATA%\WinCredit\vault.wcv` — encrypted JSON, AES-256-GCM |
| Key | scrypt(master password, random salt) — never written to disk |
| Nonces | Fresh 12-byte random nonce on **every** save (no reuse) |
| Wrong password | Fails GCM tag verification → clean "Wrong password" |
| Memory | Decrypted vault only in main-process memory; key buffer zeroed on lock |
| Renderer | `contextIsolation`, `sandbox`, no node integration; masked data only |
| Clipboard | Auto-wipe after N seconds (default 45), only if still our value |
| Auto-lock | Configurable idle timeout + locks on Windows session lock/suspend |
| CSP | `default-src 'self'`, local bundled fonts, no remote code |

## Layout

```
main.js              Electron main process: window, tray, hotkey, clipboard
                     wipe, auto-paste bridge, IPC, vault state
preload.js           contextBridge API (the only renderer↔main channel)
vault.js             Crypto + vault file format (pure Node, testable)
src/renderer/        UI (unlock, vault, pay, add/edit, settings)
assets/              Icon, tray icon, bundled fonts (offline-safe)
tests/crypto.test.js Standalone crypto/vault tests
design-system/       Design tokens (Midnight Gold) from ui-ux-pro-max
mockups/             The interactive mockup used to pick the visual direction
```

## Development

The PC keeps only the source code; everything is versioned on GitHub.

```powershell
Dev-Setup.bat        # one click: rebuilds the dev engine (npm install)
Run-WinCredit-dev.bat# launch the app in dev mode
npm test             # crypto + card + UI tests (43)
Push.bat             # send changes to GitHub (browser login once, then automatic)
```

Dev convenience: `WINCREDIT_HOME=<dir>` redirects the user-data folder
(vault + settings), and `WINCREDIT_DEV=1` logs renderer console messages
to the terminal.

## Packaging

The installable package lives in `dist\WinCredit\`:

- `WinCredit.exe` — the Electron runtime, icon + version info patched
  (gold W, via `scripts\patch_exe.mjs`, pure-JS resedit)
- `resources\app.asar` — the whole app (packed with `@electron/asar`)
- `WinCredit.ico` — icon reused by the installer shortcuts

`Install-WinCredit.bat` (double-click) runs `scripts\install-wincredit.ps1`,
which copies the package to `%LOCALAPPDATA%\Programs\WinCredit`, creates
Start Menu + Desktop shortcuts, and drops an uninstaller next to the app.
The uninstaller removes the app but deliberately keeps the encrypted vault
(`%APPDATA%\WinCredit\vault.wcv`).

### Important launch notes (this machine)

- **Never launch from inside `D:\WinCredit`.** This workspace folder carries
  the extended attribute `$KERNEL.SMARTLOCKER.ORIGINCLAIM` (set by the DSH
  environment), so Windows Smart App Control blocks any `.exe`/`.lnk`
  launched from it ("Dangerous file extension from the web"). Use the
  installed shortcuts instead — the installed copy has no such attribute.
- The shortcuts pass `--no-sandbox --disable-crash-reporter`. On this
  machine Chromium's OS-level sandbox and crashpad fail to start (the
  browser process dies with STATUS_BREAKPOINT), so those two layers are
  disabled. The renderer keeps `webPreferences.sandbox=true`,
  `contextIsolation`, a strict CSP and no remote content.
- The tray icon is read from the asar through Electron's patched fs
  (`nativeImage.createFromBuffer`) — `createFromPath` cannot open asar paths.

Rebuild after code changes:

```powershell
pwsh -File scripts\build-package.ps1   # syncs .build\app + repacks app.asar
node scripts\patch_exe.mjs             # only if the exe was replaced
```
