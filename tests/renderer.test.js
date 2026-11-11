/**
 * Renderer integration test — jsdom + the REAL vault.js / lib/cards.js.
 * A fake main-process API (same surface as preload.js) drives the UI end-to-end:
 * create -> add -> pay -> copy -> edit -> delete -> lock -> unlock, plus edge cases.
 * Run: node tests/renderer.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const vault = require('../vault');
const { masked, validateCardInput } = require('../lib/cards');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-ui-'));
const vaultFile = path.join(tmp, 'vault.wcv');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  \u2713', name); }
  catch (e) { failed++; console.log('  \u2717', name, '->', e.message); }
}

/* ---------------------------------------------------------------- */
/* Fake main process (mirrors preload.js surface, real crypto)       */
/* ---------------------------------------------------------------- */
function makeApi() {
  const state = {
    key: null, salt: null, cards: [], hasVault: false,
    settings: { autoLockMins: 5, clipClearSecs: 45, openAtLogin: false },
    clipValue: null, listeners: {},
  };
  const emit = (name, ...args) => (state.listeners[name] || []).forEach(cb => cb(...args));
  const on = (name, cb) => { (state.listeners[name] = state.listeners[name] || []).push(cb); };
  const maskedList = () => state.cards.map(masked);

  const api = {
    info: async () => ({ version: '0.1.0', hasVault: state.hasVault, unlocked: !!state.key, hotkey: 'Ctrl+Alt+C', settings: state.settings }),
    vault: {
      create: async pwd => {
        const c = await vault.createVaultFile(vaultFile, pwd);
        state.key = c.key; state.salt = c.salt; state.cards = c.doc.cards; state.hasVault = true;
        return { ok: true, cards: maskedList() };
      },
      unlock: async pwd => {
        try {
          const o = await vault.openVaultFile(vaultFile, pwd);
          state.key = o.key; state.salt = o.salt; state.cards = o.doc.cards;
          return { ok: true, cards: maskedList() };
        } catch (e) {
          return { ok: false, error: e.code === 'WRONG_PASSWORD' ? 'Wrong master password.' : 'No vault found.' };
        }
      },
      lock: async () => { if (state.key) state.key.fill(0); state.key = null; state.cards = []; emit('locked', 'Locked'); return { ok: true }; },
      list: async () => maskedList(),
      erase: async () => { fs.rmSync(vaultFile, { force: true }); state.hasVault = false; state.key = null; state.cards = []; emit('locked', 'Vault erased'); return { ok: true }; },
    },
    card: {
      add: async data => {
        const v = validateCardInput(data);
        if (!v.ok) return v;
        const id = 'c' + (state.cards.length + 1);
        if (v.card.isDefault) state.cards.forEach(c => { c.isDefault = false; });
        state.cards.push({ id, createdAt: Date.now(), ...v.card });
        return { ok: true, card: masked(state.cards[state.cards.length - 1]), cards: maskedList() };
      },
      update: async (id, data) => {
        const card = state.cards.find(c => c.id === id);
        if (!card) return { ok: false, error: 'Card not found.' };
        const merged = { ...data };
        if (!(typeof merged.number === 'string' && merged.number.trim())) merged.number = card.number;
        if (!(typeof merged.cvv === 'string' && merged.cvv.trim())) merged.cvv = card.cvv;
        const v = validateCardInput(merged);
        if (!v.ok) return v;
        Object.assign(card, v.card);
        return { ok: true, cards: maskedList() };
      },
      delete: async id => { state.cards = state.cards.filter(c => c.id !== id); return { ok: true, cards: maskedList() }; },
      setDefault: async id => { state.cards.forEach(c => { c.isDefault = c.id === id; }); return { ok: true, cards: maskedList() }; },
    },
    clip: {
      copy: async (id, field) => {
        const card = state.cards.find(c => c.id === id);
        if (!card) return { ok: false, error: 'Unavailable.' };
        const val = field === 'number' ? card.number
          : field === 'expiry' ? card.expiry
            : field === 'cvv' ? card.cvv
              : field === 'holder' ? card.holder
                : (card[field] !== undefined ? card[field] : '');
        state.clipValue = val;
        return { ok: true, secs: 45, field };
      },
      clear: async () => { state.clipValue = null; emit('clipcleared'); return { ok: true }; },
      status: async () => ({ remaining: 0 }),
    },
    autofill: async id => (state.cards.some(c => c.id === id) ? { ok: true, willPaste: false } : { ok: false, error: 'Card not found.' }),
    fillAll: async id => (state.cards.some(c => c.id === id) ? { ok: true, willPaste: false } : { ok: false, error: 'Card not found.' }),
    settings: {
      get: async () => ({ ...state.settings }),
      set: async patch => { state.settings = { ...state.settings, ...patch }; return { ok: true, settings: state.settings }; },
    },
    master: { change: async () => ({ ok: true }) },
    win: { minimize: async () => {}, maximize: async () => {}, close: async () => {} },
    quit: async () => {},
    onLocked: cb => on('locked', cb),
    onClipCleared: cb => on('clipcleared', cb),
    onMaximized: cb => {},
    // test-only helpers (main never exposes these)
    _clipValue: () => state.clipValue,
    _settings: () => ({ ...state.settings }),
    _fullCards: () => state.cards.map(c => ({ ...c })),
  };
  return api;
}

/* ---------------------------------------------------------------- */
const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('WinCredit renderer tests\n');

  const dom = new JSDOM(html, { url: 'file://' + path.join(root, 'src', 'renderer', 'index.html'), runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const api = makeApi();
  window.wincredit = api;
  const ready = new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  window.eval(appJs);
  await ready;
  await tick();

  t('boot without vault shows create mode (no double form)', () => {
    assert.ok($('.screen[data-screen="unlock"]').classList.contains('active'));
    assert.strictEqual($('#unlock-form').hidden, true);
    assert.strictEqual($('#create-form').hidden, false);
  });

  t('create form rejects short password', async () => {
    $('#cp1').value = 'short';
    $('#cp2').value = 'short';
    $('#create-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(30);
    assert.strictEqual($('#create-error').hidden, false);
  });

  t('create vault -> vault screen with empty state', async () => {
    $('#cp1').value = 'master-password-1';
    $('#cp2').value = 'master-password-1';
    $('#create-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(80);
    assert.ok($('.screen[data-screen="vault"]').classList.contains('active'));
    assert.strictEqual($('#empty-state').hidden, false);
    assert.strictEqual($$('#cards-grid .cardtile').length, 0);
  });

  const fillAndSubmit = async (data) => {
    $('#btn-add').click(); await tick(20);
    $('#f-nick').value = data.nickname || '';
    $('#f-name').value = data.holder || '';
    $('#f-num').value = data.number || '';
    $('#f-num').dispatchEvent(new window.Event('input'));
    $('#f-exp').value = data.expiry || '';
    $('#f-cvv').value = data.cvv || '';
    $('#f-street').value = data.street || '';
    $('#f-city').value = data.city || '';
    $('#f-region').value = data.region || '';
    $('#f-zip').value = data.zip || '';
    $('#f-country').value = data.country || '';
    $('#card-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(60);
  };

  t('add valid card -> tile rendered masked, back on vault', async () => {
    await fillAndSubmit({ nickname: 'Battle.net', holder: 'mike', number: '4242 4242 4242 4242', expiry: '09/28', cvv: '123', street: '1234 Main Street, Apt 5', city: 'Montréal', region: 'QC', zip: 'H1A 0A1', country: 'Canada' });
    assert.ok($('.screen[data-screen="vault"]').classList.contains('active'));
    const tiles = $$('#cards-grid .cardtile');
    assert.strictEqual(tiles.length, 1);
    assert.strictEqual(tiles[0].querySelector('.tile-name b').textContent, 'Battle.net');
    assert.strictEqual(tiles[0].querySelector('.ccard .num').textContent, '•••• •••• •••• 4242');
    assert.strictEqual($('#empty-state').hidden, true);
  });

  t('bad checksum rejected with inline error, no card added', async () => {
    await fillAndSubmit({ nickname: 'Bad', holder: 'mike', number: '4242 4242 4242 4241', expiry: '09/28', cvv: '123' });
    assert.strictEqual($('#card-error').hidden, false);
    assert.ok(/checksum/.test($('#card-error').textContent));
    assert.strictEqual($$('#cards-grid .cardtile').length, 1);
  });

  t('tile click opens pay screen with masked fields', async () => {
    $$('#cards-grid .cardtile')[0].click();
    await tick(20);
    assert.ok($('.screen[data-screen="pay"]').classList.contains('active'));
    assert.strictEqual($('#pay-title').textContent, 'Battle.net');
    assert.strictEqual($('#p-num').textContent, '•••• 4242');
    assert.strictEqual($('#p-holder').textContent, 'MIKE');
  });

  t('pay screen shows the 5 address fields separately and copies each', async () => {
    assert.strictEqual($('#p-street').textContent, '1234 Main Street, Apt 5');
    assert.strictEqual($('#p-city').textContent, 'Montréal');
    assert.strictEqual($('#p-region').textContent, 'QC');
    assert.strictEqual($('#p-zip').textContent, 'H1A 0A1');
    assert.strictEqual($('#p-country').textContent, 'Canada');
    $('.copy-chip[data-copy-field="city"]').click();
    await tick(20);
    assert.strictEqual(api._clipValue(), 'Montréal');
    $('.copy-chip[data-copy-field="zip"]').click();
    await tick(20);
    assert.strictEqual(api._clipValue(), 'H1A 0A1');
  });

  t('copy chip sends (id, field) to main and starts countdown', async () => {
    $('.copy-chip[data-copy-field="number"]').click();
    await tick(20);
    assert.strictEqual(api._clipValue(), '4242424242424242');
    assert.ok($('#clip-status').classList.contains('on'));
    assert.strictEqual($('#clip-label').textContent, 'Clipboard has card data');
  });

  t('no Fill buttons remain (simple copy-only app)', () => {
    assert.strictEqual(document.querySelector('#btn-autofill'), null);
    assert.strictEqual(document.querySelector('#btn-fillall'), null);
    const tileFill = document.querySelector('#cards-grid .tile-actions .btn svg use[href="#i-zap"]');
    assert.strictEqual(tileFill, null);
  });

  t('pay screen Edit button opens the edit form', async () => {
    $('#btn-edit-pay').click();
    await tick(20);
    assert.ok($('.screen[data-screen="add"]').classList.contains('active'));
    assert.ok($('#add-title').textContent.includes('Battle.net'));
    assert.strictEqual($('#f-street').value, '1234 Main Street, Apt 5'); // address prefilled
    $('#btn-cancel-add').click(); await tick(10);
  });

  t('clip:cleared event resets the clipboard UI', async () => {
    await api.clip.clear();
    await tick(20);
    assert.ok(!$('#clip-status').classList.contains('on'));
    assert.strictEqual($('#clip-label').textContent, 'Clipboard empty');
  });

  t('search filters and shows no-match state', async () => {
    $('#btn-back-vault').click(); await tick(10);
    $('#search').value = 'zzz';
    $('#search').dispatchEvent(new window.Event('input'));
    await tick(10);
    assert.strictEqual($$('#cards-grid .cardtile')[0].style.display, 'none');
    assert.strictEqual($('#empty-state').hidden, false);
    assert.ok($('#empty-title').textContent.includes('No match'));
    $('#search').value = '';
    $('#search').dispatchEvent(new window.Event('input'));
    await tick(10);
  });

  t('edit keeps stored number when number left blank', async () => {
    const tile = $$('#cards-grid .cardtile')[0];
    tile.querySelector('.tile-menu').click();
    await tick(20);
    assert.ok(document.querySelector('.tile-menu-pop'));
    document.querySelector('.tile-menu-pop button').click(); // Edit
    await tick(20);
    assert.ok($('.screen[data-screen="add"]').classList.contains('active'));
    assert.ok($('#add-title').textContent.includes('Battle.net'));
    $('#f-nick').value = 'Battle.net renommé';
    $('#card-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(60);
    assert.strictEqual($$('#cards-grid .cardtile').length, 1);
    assert.strictEqual($$('#cards-grid .cardtile')[0].querySelector('.tile-name b').textContent, 'Battle.net renommé');
    assert.strictEqual(api._fullCards()[0].number, '4242424242424242'); // never exposed, still intact
  });

  t('delete via menu + confirm removes the card', async () => {
    const tile = $$('#cards-grid .cardtile')[0];
    tile.querySelector('.tile-menu').click();
    await tick(20);
    const del = Array.from(document.querySelectorAll('.tile-menu-pop button')).find(b => b.textContent.includes('Delete'));
    del.click();
    await tick(20);
    const confirmBtn = Array.from($('#dlg-actions').querySelectorAll('button')).find(b => b.textContent === 'Delete');
    confirmBtn.click();
    await tick(60);
    assert.strictEqual($$('#cards-grid .cardtile').length, 0);
    assert.strictEqual($('#empty-state').hidden, false);
  });

  t('XSS: nickname rendered as text, never as HTML', async () => {
    await fillAndSubmit({ nickname: '<img src=x onerror=alert(1)>', holder: 'mike', number: '4242 4242 4242 4242', expiry: '09/28', cvv: '123' });
    const tile = $$('#cards-grid .cardtile')[0];
    assert.strictEqual(tile.querySelectorAll('img').length, 0);
    assert.ok(tile.querySelector('.tile-name b').textContent.includes('<img'));
    await api.card.delete(api._fullCards()[0].id);
    await tick(20);
  });

  t('lock event returns UI to unlock screen (auto-lock path)', async () => {
    await api.vault.lock();
    await tick(30);
    assert.ok($('.screen[data-screen="unlock"]').classList.contains('active'));
    assert.strictEqual($('#unlock-form').hidden, false);
    assert.strictEqual($('#create-form').hidden, true);
    assert.strictEqual($$('#cards-grid .cardtile').length, 0);
  });

  t('unlock with wrong password shows error', async () => {
    $('#pwd').value = 'wrong-password';
    $('#unlock-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(80);
    assert.strictEqual($('#unlock-error').hidden, false);
  });

  t('unlock with right password restores cards', async () => {
    $('#pwd').value = 'master-password-1';
    $('#unlock-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(80);
    assert.ok($('.screen[data-screen="vault"]').classList.contains('active'));
    assert.ok($$('#cards-grid .cardtile').length >= 1);
  });

  t('settings change reaches main', async () => {
    $('#btn-settings').click(); await tick(10);
    const sel = $('#set-clip');
    sel.value = '90';
    sel.dispatchEvent(new window.Event('change'));
    await tick(30);
    assert.strictEqual(api._settings().clipClearSecs, 90);
  });

  window.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('HARNESS FAILURE:', e);
  process.exit(1);
});
