# WinCredit

Encrypted credit-card vault for Windows with individual field copying.

## What it does

1. **Store and edit cards** — encrypted with AES-256-GCM under your master
   password (scrypt N=2^15, r=8, p=1).
2. **Copy individual fields** — press `Ctrl+Alt+C`, select a card, and copy
   its number, expiry, CVV, holder, or an address field. Paste it manually
   into your browser or Windows app. There is no automatic form filling.
3. **Edit billing addresses** — street/apartment, city, province/region,
   postal code and country are separate, individually copyable fields.
4. **Masked card views** — stored full numbers and CVVs are not sent back
   to the UI. New or replacement values are entered in the UI and sent to
   the main process for validation and storage.

## Security model

| Concern | Design |
|---|---|
| Storage | `%APPDATA%\WinCredit\vault.wcv` — encrypted JSON, AES-256-GCM |
| Key | scrypt(master password, random salt) — never written to disk |
| Nonces | Fresh 12-byte random nonce on **every** save (no reuse) |
| Wrong password | Fails GCM tag verification → clean "Wrong password" |
| Memory | Decrypted vault only in main-process memory; key buffer zeroed on lock |
| Renderer | `contextIsolation`, `sandbox`, no node integration; stored number/CVV masked in responses |
| Clipboard | Auto-wipe after N seconds (default 45), only if still our value |
| Auto-lock | Configurable idle timeout + locks on Windows session lock/suspend |
| CSP | `default-src 'self'`, local bundled fonts, no remote code |

## Layout

```
main.js              Electron main process: window, tray, hotkey, clipboard
                     wipe, IPC, vault state
preload.js           contextBridge API (the only renderer↔main channel)
vault.js             Crypto + vault file format (pure Node, testable)
lib/cards.js         Card model: fields, Luhn/expiry validation, masking
src/renderer/        UI (unlock, vault, pay, add/edit, settings)
assets/              Icon, tray icon, bundled fonts (offline-safe)
tests/crypto.test.js Standalone crypto/vault tests
design-system/       Design tokens (Midnight Gold) from ui-ux-pro-max
mockups/             The interactive mockup used to pick the visual direction
```

## Development

Source code is versioned on GitHub. Dependencies, packaged builds and local
vault data are excluded from Git.

```powershell
Dev-Setup.bat        # one click: rebuilds the dev engine (npm install)
Run-WinCredit-dev.bat# launch the app in dev mode
npm test             # crypto + card + UI tests (44)
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

- **Workspace move.** The project used to live in `D:\WinCredit`. That folder
  carried the extended attribute `$KERNEL.SMARTLOCKER.ORIGINCLAIM` (set by the
  DSH environment), so Windows Smart App Control blocked any `.exe`/`.lnk`
  launched from it ("Dangerous file extension from the web"). The workspace is
  now `D:\Onedrive\Workspace\DEV\Apps\WinCredit`; should a launch ever be
  blocked that way, run the installed shortcuts from
  `%LOCALAPPDATA%\Programs\WinCredit` instead.
- The shortcuts pass `--no-sandbox --disable-crash-reporter`. On this
  machine Chromium's OS-level sandbox and crashpad fail to start (the
  browser process dies with STATUS_BREAKPOINT), so those two layers are
  disabled. This reduces process isolation: `webPreferences.sandbox=true`
  does not restore the disabled OS sandbox. Context isolation, a strict
  CSP and local-only content remain enabled.
- The tray icon is read from the asar through Electron's patched fs
  (`nativeImage.createFromBuffer`) — `createFromPath` cannot open asar paths.

Rebuild + reinstall after code changes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-wincredit.ps1
```

`build-package.ps1` recreates `dist\WinCredit` from the local Electron engine
(`node_modules\electron\dist`) when the folder is missing — after a cleanup or
on a fresh clone — and patches the exe icon/version on that first run. Later
runs only repack `resources\app.asar`, so `dist\` stays disposable: delete it
whenever you want the ~360 MB back, the next build recreates it.

