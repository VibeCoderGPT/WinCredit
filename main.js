/**
 * WinCredit main process.
 *
 * Design rules:
 *  - The renderer NEVER sees full card numbers or CVVs. Copy/auto-fill
 *    happen entirely in the main process; the renderer only gets masked views.
 *  - The decrypted vault exists only in main-process memory while unlocked,
 *    and the key buffer is zeroed on lock.
 *  - Every renderer call is validated as untrusted input (types, lengths,
 *    allowlists) before it touches anything.
 */
'use strict';

const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage, powerMonitor, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const vault = require('./vault');
const { FIELDS, validateCardInput, masked, fieldValue } = require('./lib/cards');

/* ------------------------------------------------------------------ */
/* Environment / paths                                                 */
/* ------------------------------------------------------------------ */
const DEV = !!process.env.WINCREDIT_DEV;
const HOME_OVERRIDE = process.env.WINCREDIT_HOME;
if (HOME_OVERRIDE) app.setPath('userData', HOME_OVERRIDE);
app.setAppUserModelId('com.wincredit.vault');

// Chromium's OS-level process sandbox fails to start on some Windows machines
// (the browser process exits with STATUS_BREAKPOINT before any JS runs), which
// made plain double-clicks crash. Disable that layer; the renderer keeps
// webPreferences.sandbox=true, contextIsolation, strict CSP and no remote content.
app.commandLine.appendSwitch('no-sandbox');

const userData = () => app.getPath('userData');
const vaultPath = () => path.join(userData(), 'vault.wcv');
const settingsPath = () => path.join(userData(), 'settings.json');

const DEFAULT_SETTINGS = { autoLockMins: 5, clipClearSecs: 45, openAtLogin: false };
let settings = { ...DEFAULT_SETTINGS };
function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; }
  catch (e) { /* first run */ }
}
function saveSettings() {
  try { fs.mkdirSync(userData(), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('[settings] save failed:', e.message); }
}

/* ------------------------------------------------------------------ */
/* Vault state                                                         */
/* ------------------------------------------------------------------ */
let state = null;           // { key:Buffer, salt:Buffer, cards:[...] }
let lastActivity = Date.now();
let saveChain = Promise.resolve();

function touch() { lastActivity = Date.now(); }

function lockVault(reason) {
  if (state && state.key) state.key.fill(0);
  state = null;
  clearOwnClipboard(true);
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('vault:locked', reason || 'Locked');
  }
}

function persist() {
  const s = state;
  if (!s) return Promise.resolve();
  const doc = { check: 'wincredit', cards: s.cards };
  saveChain = saveChain.then(() => vault.saveVaultFile(vaultPath(), s.key, s.salt, doc))
    .catch(err => console.error('[vault] save failed:', err.message));
  return saveChain;
}

/* ------------------------------------------------------------------ */
/* Card helpers (all renderer input is validated)                      */
/* ------------------------------------------------------------------ */
function maskedList() { return state ? state.cards.map(masked) : []; }
function findCard(id) {
  if (!state) return null;
  return state.cards.find(c => c.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Clipboard wipe                                                      */
/* ------------------------------------------------------------------ */
let clipWipeTimer = null;
let clipWrote = null;
function copyToClipboard(text, secs) {
  clipboard.writeText(String(text));
  clipWrote = String(text);
  clearTimeout(clipWipeTimer);
  clipWipeTimer = setTimeout(() => clearOwnClipboard(false), (secs || settings.clipClearSecs) * 1000);
}
function clearOwnClipboard(silent) {
  clearTimeout(clipWipeTimer);
  clipWipeTimer = null;
  const wiped = clipWrote !== null && clipboard.readText() === clipWrote;
  clipWrote = null;
  if (wiped) clipboard.clear();
  if (!silent) {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('clip:cleared');
    }
  }
  return wiped;
}
function clipRemaining() {
  if (!clipWipeTimer) return 0;
  return Math.ceil((clipWipeTimer._idleStart + clipWipeTimer._idleTimeout - Date.now()) / 1000);
}

/* ------------------------------------------------------------------ */
/* Foreground-window capture + auto-paste (PowerShell bridge)          */
/* ------------------------------------------------------------------ */
let lastFgHwnd = 0;
function psRun(script, args = []) {
  try {
    spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args.map(String)],
      { windowsHide: true, stdio: 'ignore' });
  } catch (e) { console.error('[ps] spawn failed:', e.message); }
}
function captureForeground() {
  const out = path.join(userData(), 'fg.tmp');
  const script =
    "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();';" +
    `$h = [W.U]::GetForegroundWindow().ToInt64(); Set-Content -Path '${out.replace(/'/g, "''")}' -Value $h`;
  const p = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, stdio: 'ignore' });
  p.on('close', () => {
    fs.readFile(out, 'utf8', (err, txt) => {
      fs.unlink(out, () => {});
      if (!err) {
        const h = parseInt(txt, 10);
        if (Number.isFinite(h) && h > 0) lastFgHwnd = h;
      }
    });
  });
  p.on('error', () => {});
}
function pasteInto(hwnd) {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms;" +
    "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr h);';" +
    'if ($args[0] -ne 0) { [void][W.U]::SetForegroundWindow([System.IntPtr][int64]$args[0]) }' +
    'Start-Sleep -Milliseconds 180;' +
    '[System.Windows.Forms.SendKeys]::SendWait("^v")';
  psRun(script, [hwnd]);
}
function autoFill(card) {
  copyToClipboard(card.number, settings.clipClearSecs);
  const hwnd = lastFgHwnd || 0;
  const win = BrowserWindow.getAllWindows()[0];
  if (!hwnd) return false; // no known target: keep the window open, let the user paste manually
  if (win) win.hide();
  setTimeout(() => {
    pasteInto(hwnd);
    notifyPasted();
  }, 300);
  return true;
}

function notifyPasted() {
  try {
    new Notification({
      title: 'WinCredit',
      body: 'Fields pasted into the app you were using.\nWinCredit stays in the tray — press Ctrl+Alt+C to reopen.',
      icon: APP_ICON,
    }).show();
  } catch (e) { /* notifications are best-effort */ }
}

/**
 * Browser-checkout fill: paste number, Tab, expiry, Tab, CVV, Tab, name —
 * the same field-by-field mechanism browser autofill uses, driven from outside.
 * The clipboard is cleared at the end.
 */
function fillAllFields(card) {
  const hwnd = lastFgHwnd || 0;
  const win = BrowserWindow.getAllWindows()[0];
  if (!hwnd) return false;
  const esc = s => String(s).replace(/'/g, "''");
  const vals = [card.number, card.expiry, card.cvv, card.holder].map(esc);
  const step = (v, sleepAfter) =>
    `Set-Clipboard -Value '${v}'; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds ${sleepAfter};`;
  const script =
    "Add-Type -AssemblyName System.Windows.Forms;" +
    "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr h);';" +
    'if ($args[0] -ne 0) { [void][W.U]::SetForegroundWindow([System.IntPtr][int64]$args[0]) }' +
    'Start-Sleep -Milliseconds 250;' +
    step(vals[0], 120) + "[System.Windows.Forms.SendKeys]::SendWait('{TAB}');" +
    step(vals[1], 120) + "[System.Windows.Forms.SendKeys]::SendWait('{TAB}');" +
    step(vals[2], 120) + "[System.Windows.Forms.SendKeys]::SendWait('{TAB}');" +
    step(vals[3], 400) +
    "Set-Clipboard -Value ''";
  if (win) win.hide();
  setTimeout(() => {
    psRun(script, [hwnd]);
    notifyPasted();
  }, 300);
  return true;
}

/* ------------------------------------------------------------------ */
/* Window / tray / shortcut                                            */
/* ------------------------------------------------------------------ */
let win = null;
let tray = null;
let quitting = false;

// Icons must be read through Electron's patched fs (nativeImage can't open asar paths).
const APP_ICON = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'assets', 'icon.ico')));
const TRAY_ICON = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'assets', 'tray.png')));

function createWindow() {
  win = new BrowserWindow({
    width: 1020, height: 700, minWidth: 900, minHeight: 620,
    frame: false, roundedCorners: true, backgroundColor: '#0D1424',
    icon: APP_ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    const autoStart = app.getLoginItemSettings().wasOpenedAtLogin;
    if (!autoStart) { win.show(); win.focus(); }
  });
  win.on('focus', touch);
  win.on('blur', () => captureForeground());
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });

  // Hardened navigation: local file only, external links via system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  if (DEV) {
    win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
  }
}

function createTray() {
  tray = new Tray(TRAY_ICON);
  tray.setToolTip('WinCredit');
  tray.on('click', () => { captureForeground(); if (win) { win.show(); win.focus(); } });
  rebuildTrayMenu();
}
function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open WinCredit', click: () => { captureForeground(); win && win.show(), win && win.focus(); } },
    state ? { label: 'Lock vault', click: () => lockVault('Locked from tray') } : { label: 'Vault locked', enabled: false },
    { type: 'separator' },
    { label: 'Quit WinCredit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function toggleFromHotkey() {
  if (!win) return;
  if (win.isVisible()) { win.hide(); }
  else { captureForeground(); win.show(); win.focus(); }
}
function registerHotkey() {
  const ok = globalShortcut.register('Control+Alt+C', toggleFromHotkey);
  if (!ok) console.error('[hotkey] Ctrl+Alt+C registration failed');
  return ok;
}

function autoLockTick() {
  if (!state || !settings.autoLockMins) return;
  const idle = Date.now() - lastActivity;
  if (idle > settings.autoLockMins * 60 * 1000) {
    lockVault('Auto-locked after ' + settings.autoLockMins + ' min of inactivity');
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    hasVault: fs.existsSync(vaultPath()),
    unlocked: !!state,
    hotkey: 'Ctrl+Alt+C',
    settings,
  }));

  ipcMain.handle('vault:create', async (_e, password) => {
    touch();
    if (typeof password !== 'string' || password.length < 8) {
      return { ok: false, error: 'Master password must be at least 8 characters.' };
    }
    if (fs.existsSync(vaultPath())) {
      return { ok: false, error: 'A vault already exists on this PC.' };
    }
    try {
      const created = await vault.createVaultFile(vaultPath(), password);
      state = { key: created.key, salt: created.salt, cards: created.doc.cards };
      rebuildTrayMenu();
      return { ok: true, cards: maskedList() };
    } catch (err) {
      return { ok: false, error: 'Could not create the vault: ' + err.message };
    }
  });

  ipcMain.handle('vault:unlock', async (_e, password) => {
    touch();
    if (typeof password !== 'string' || !password) {
      return { ok: false, error: 'Enter your master password.' };
    }
    try {
      const opened = await vault.openVaultFile(vaultPath(), password);
      state = { key: opened.key, salt: opened.salt, cards: opened.doc.cards };
      rebuildTrayMenu();
      return { ok: true, cards: maskedList() };
    } catch (err) {
      if (err.code === 'WRONG_PASSWORD') return { ok: false, error: 'Wrong master password.' };
      if (err.code === 'IO') return { ok: false, error: 'No vault found.' };
      return { ok: false, error: 'The vault file is damaged or unreadable.' };
    }
  });

  ipcMain.handle('vault:lock', () => { lockVault('Locked'); rebuildTrayMenu(); return { ok: true }; });
  ipcMain.handle('vault:list', () => maskedList());

  ipcMain.handle('card:add', async (_e, data) => {
    touch();
    if (!state) return { ok: false, error: 'Locked' };
    const v = validateCardInput(data);
    if (!v.ok) return v;
    const card = { id: crypto.randomUUID(), createdAt: Date.now(), ...v.card };
    if (card.isDefault) state.cards.forEach(c => { c.isDefault = false; });
    state.cards.push(card);
    await persist();
    return { ok: true, card: masked(card), cards: maskedList() };
  });

  ipcMain.handle('card:update', async (_e, id, data) => {
    touch();
    const card = findCard(id);
    if (!card) return { ok: false, error: 'Card not found.' };
    if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid request.' };
    // Editing never reveals the stored number/CVV: blank fields mean "keep".
    const merged = { ...data };
    if (!(typeof merged.number === 'string' && merged.number.trim())) merged.number = card.number;
    if (!(typeof merged.cvv === 'string' && merged.cvv.trim())) merged.cvv = card.cvv;
    const v = validateCardInput(merged);
    if (!v.ok) return v;
    Object.assign(card, v.card);
    if (card.isDefault) state.cards.forEach(c => { if (c.id !== card.id) c.isDefault = false; });
    await persist();
    return { ok: true, card: masked(card), cards: maskedList() };
  });

  ipcMain.handle('card:delete', async (_e, id) => {
    touch();
    if (!state) return { ok: false, error: 'Locked' };
    const idx = state.cards.findIndex(c => c.id === id);
    if (idx === -1) return { ok: false, error: 'Card not found.' };
    state.cards.splice(idx, 1);
    await persist();
    return { ok: true, cards: maskedList() };
  });

  ipcMain.handle('card:setDefault', async (_e, id) => {
    touch();
    const card = findCard(id);
    if (!card) return { ok: false, error: 'Card not found.' };
    state.cards.forEach(c => { c.isDefault = c.id === id; });
    await persist();
    return { ok: true, cards: maskedList() };
  });

  ipcMain.handle('clip:copy', (_e, id, field) => {
    touch();
    const card = findCard(id);
    if (!card || !FIELDS.includes(field)) return { ok: false, error: 'Unavailable.' };
    copyToClipboard(fieldValue(card, field), settings.clipClearSecs);
    return { ok: true, secs: settings.clipClearSecs, field };
  });

  ipcMain.handle('clip:clear', () => { clearOwnClipboard(false); return { ok: true }; });
  ipcMain.handle('clip:status', () => ({ remaining: clipRemaining() }));

  ipcMain.handle('autofill', (_e, id) => {
    touch();
    const card = findCard(id);
    if (!card) return { ok: false, error: 'Card not found.' };
    const willPaste = autoFill(card);
    return { ok: true, willPaste };
  });

  ipcMain.handle('fillall', (_e, id) => {
    touch();
    const card = findCard(id);
    if (!card) return { ok: false, error: 'Card not found.' };
    const willPaste = fillAllFields(card);
    return { ok: true, willPaste };
  });

  ipcMain.handle('settings:get', () => ({ ...settings }));
  ipcMain.handle('settings:set', (_e, patch) => {
    touch();
    if (!patch || typeof patch !== 'object') return { ok: false, error: 'Invalid settings.' };
    const next = { ...settings };
    if ('autoLockMins' in patch) {
      const v = Number(patch.autoLockMins);
      if ([0, 1, 2, 5, 10, 30].includes(v)) next.autoLockMins = v;
    }
    if ('clipClearSecs' in patch) {
      const v = Number(patch.clipClearSecs);
      if ([15, 30, 45, 60, 90].includes(v)) next.clipClearSecs = v;
    }
    if ('openAtLogin' in patch) next.openAtLogin = !!patch.openAtLogin;
    settings = next;
    saveSettings();
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: ['--no-sandbox'] });
    return { ok: true, settings };
  });

  ipcMain.handle('master:change', async (_e, oldPw, newPw) => {
    touch();
    if (typeof newPw !== 'string' || newPw.length < 8) {
      return { ok: false, error: 'New password must be at least 8 characters.' };
    }
    try {
      const opened = await vault.openVaultFile(vaultPath(), oldPw); // verifies old password
      const salt = crypto.randomBytes(16);
      const key = await vault.deriveKey(newPw, salt);
      if (state && state.key) state.key.fill(0);
      state = { key, salt, cards: opened.doc.cards };
      await vault.saveVaultFile(vaultPath(), key, salt, opened.doc);
      return { ok: true };
    } catch (err) {
      if (err.code === 'WRONG_PASSWORD') return { ok: false, error: 'Current password is wrong.' };
      return { ok: false, error: 'Could not change password: ' + err.message };
    }
  });

  ipcMain.handle('vault:erase', async () => {
    touch();
    try { await fs.promises.unlink(vaultPath()); } catch (e) { /* already gone */ }
    lockVault('Vault erased');
    rebuildTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('win:minimize', () => { win && win.minimize(); });
  ipcMain.handle('win:maximize', () => { win && (win.isMaximized() ? win.unmaximize() : win.maximize()); });
  ipcMain.handle('win:close', () => { win && win.hide(); });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  app.whenReady().then(() => {
    loadSettings();
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    registerHotkey();
    registerIpc();
    setInterval(autoLockTick, 10000);
    powerMonitor.on('lock-screen', () => lockVault('Windows session locked'));
    powerMonitor.on('suspend', () => lockVault('System suspended'));
  });

  app.on('will-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    if (state && state.key) state.key.fill(0);
  });

  app.on('window-all-closed', () => { /* stay in tray */ });
}
