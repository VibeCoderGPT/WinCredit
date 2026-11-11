/**
 * WinCredit renderer — Midnight Gold.
 * All card data here is MASKED. Full numbers/CVVs never reach this context:
 * copy and auto-fill are done by the main process via window.wincredit.
 */
'use strict';

const api = window.wincredit;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const state = {
  hasVault: false,
  settings: { autoLockMins: 5, clipClearSecs: 45, openAtLogin: false },
  cards: [],
  currentId: null,
  editId: null,
  clipTimer: null,
  clipTotal: 0,
  clipLeft: 0,
};

/* ------------------------------------------------------------ */
/* Screens                                                       */
/* ------------------------------------------------------------ */
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === id));
  closePopover();
  closeDialog();
}
function screenIs(id) { return $(`.screen[data-screen="${id}"]`).classList.contains('active'); }

/* ------------------------------------------------------------ */
/* Toast                                                         */
/* ------------------------------------------------------------ */
let toastTimer = null;
function toast(msg, kind = 'ok') {
  $('#toast-msg').textContent = msg;
  const t = $('#toast');
  t.className = 'toast show' + (kind === 'warn' ? ' warn' : kind === 'err' ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}

/* ------------------------------------------------------------ */
/* Dialogs                                                       */
/* ------------------------------------------------------------ */
function openDialog({ title, text = '', body = null, actions }) {
  $('#dlg-title').textContent = title;
  $('#dlg-text').textContent = text || '';
  $('#dlg-text').hidden = !text;
  $('#dlg-body').innerHTML = '';
  $('#dlg-body').hidden = !body;
  if (body) $('#dlg-body').appendChild(body);
  const wrap = $('#dlg-actions');
  wrap.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost');
    b.textContent = a.label;
    b.addEventListener('click', () => { closeDialog(); a.onClick && a.onClick(); });
    wrap.appendChild(b);
  }
  $('#dialog-scrim').hidden = false;
}
function closeDialog() { $('#dialog-scrim').hidden = true; }

function confirmDialog(title, text, { okLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    openDialog({
      title, text,
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: okLabel, danger, primary: !danger, onClick: () => resolve(true) },
      ],
    });
  });
}

/* ------------------------------------------------------------ */
/* Card visuals (fixed template, values set via textContent)     */
/* ------------------------------------------------------------ */
function makeCardVisual(card) {
  const root = document.createElement('div');
  root.className = 'ccard ' + card.brand;
  const brandEl = card.brand === 'mc'
    ? '<span class="mc-circles"><span></span><span></span></span>'
    : '<span class="brandtxt">' + card.brand.toUpperCase() + '</span>';
  root.innerHTML =
    '<div class="top"><span class="bank">WinCredit</span>' + brandEl + '</div>' +
    '<div class="num"></div>' +
    '<div class="foot">' +
    '<div><div class="lab">Holder</div><b class="v-holder"></b></div>' +
    '<div class="chip"></div>' +
    '<div><div class="lab">Expiry</div><b class="v-exp"></b></div>' +
    '</div>';
  root.querySelector('.num').textContent =
    card.brand === 'amex' ? '•••• •••••• •' + card.last4 : '•••• •••• •••• ' + card.last4;
  root.querySelector('.v-holder').textContent = card.holder;
  root.querySelector('.v-exp').textContent = card.expiry;
  return root;
}

/* ------------------------------------------------------------ */
/* Vault                                                         */
/* ------------------------------------------------------------ */
function renderVault(filter = '') {
  const grid = $('#cards-grid');
  grid.innerHTML = '';
  const q = filter.trim().toLowerCase();
  const list = state.cards.filter(c =>
    !q || (c.nickname + ' ' + c.brand + ' ' + c.last4).toLowerCase().includes(q));
  const empty = $('#empty-state');
  empty.hidden = list.length > 0;
  if (list.length === 0) {
    if (q) {
      $('#empty-title').textContent = 'No match';
      $('#empty-text').textContent = 'No card matches “' + q + '”.';
      $('#empty-state .btn').hidden = true;
    } else {
      $('#empty-title').textContent = 'No cards yet';
      $('#empty-text').textContent = 'Add your first card and paying in any app becomes two clicks.';
      $('#empty-state .btn').hidden = false;
    }
    return;
  }

  for (const card of list) {
    const tile = document.createElement('div');
    tile.className = 'cardtile';
    tile.dataset.id = card.id;

    const name = document.createElement('div');
    name.className = 'tile-name';
    const b = document.createElement('b');
    b.textContent = card.nickname;
    const right = document.createElement('div');
    right.className = 'right';

    const star = document.createElement('button');
    star.className = 'tile-star' + (card.isDefault ? ' on' : '');
    star.innerHTML = '<svg class="ic"><use href="#i-star"/></svg>';
    star.setAttribute('aria-label', card.isDefault ? 'Default card' : 'Make default card');
    star.title = card.isDefault ? 'Default card' : 'Make default card';
    star.addEventListener('click', async e => {
      e.stopPropagation();
      const r = await api.card.setDefault(card.id);
      if (r.ok) { state.cards = r.cards; renderVault($('#search').value); }
    });

    const menu = document.createElement('button');
    menu.className = 'tile-menu';
    menu.innerHTML = '<svg class="ic"><use href="#i-dots"/></svg>';
    menu.setAttribute('aria-label', 'Card options');
    menu.addEventListener('click', e => { e.stopPropagation(); openTileMenu(menu, card); });

    right.append(star, menu);
    name.append(b, right);
    tile.appendChild(name);
    tile.appendChild(makeCardVisual(card));

    const actions = document.createElement('div');
    actions.className = 'tile-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-ghost btn-sm';
    copyBtn.innerHTML = '<svg class="ic"><use href="#i-copy"/></svg> Copy';
    copyBtn.addEventListener('click', e => { e.stopPropagation(); copyField(card.id, 'number', 'Card number'); });
    actions.appendChild(copyBtn);
    tile.appendChild(actions);

    tile.addEventListener('click', () => openPay(card));
    grid.appendChild(tile);
  }
}

let popoverEl = null;
function openTileMenu(anchor, card) {
  closePopover();
  popoverEl = document.createElement('div');
  popoverEl.className = 'tile-menu-pop';
  const mk = (label, icon, onClick, danger = false) => {
    const btn = document.createElement('button');
    if (danger) btn.className = 'danger';
    btn.innerHTML = '<svg class="ic"><use href="#i-' + icon + '"/></svg>';
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', () => { closePopover(); onClick(); });
    return btn;
  };
  popoverEl.appendChild(mk('Edit', 'pencil', () => openEdit(card)));
  popoverEl.appendChild(mk(card.isDefault ? 'Remove default' : 'Make default', 'star', async () => {
    const r = await api.card.setDefault(card.id);
    if (r.ok) { state.cards = r.cards; renderVault($('#search').value); }
  }));
  popoverEl.appendChild(mk('Delete', 'trash', async () => {
    const yes = await confirmDialog('Delete card', 'Delete “' + card.nickname + '” from the vault? You can add it again anytime.', { okLabel: 'Delete', danger: true });
    if (!yes) return;
    const r = await api.card.delete(card.id);
    if (r.ok) {
      state.cards = r.cards;
      if (state.currentId === card.id) state.currentId = null;
      renderVault($('#search').value);
      toast('Card deleted');
    }
  }, true));
  const tile = anchor.closest('.cardtile');
  popoverEl.style.position = 'absolute';
  popoverEl.style.right = '8px';
  popoverEl.style.top = '40px';
  tile.appendChild(popoverEl);
  document.addEventListener('click', closePopover, { once: true, capture: true });
}
function closePopover() { if (popoverEl) { popoverEl.remove(); popoverEl = null; } }

/* ------------------------------------------------------------ */
/* Clipboard countdown                                           */
/* ------------------------------------------------------------ */
function fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function startClip(secs, total) {
  stopClip();
  state.clipLeft = secs;
  state.clipTotal = total || secs;
  const status = $('#clip-status');
  status.classList.add('on');
  $('#clip-label').textContent = 'Clipboard has card data';
  $('#clip-clear').hidden = false;
  updateClip();
  state.clipTimer = setInterval(() => {
    state.clipLeft--;
    if (state.clipLeft <= 0) resetClip('Clipboard cleared automatically');
    else updateClip();
  }, 1000);
}
function updateClip() {
  $('#clip-time').textContent = fmt(Math.max(state.clipLeft, 0));
  $('#clip-bar').style.transform = 'scaleX(' + Math.max(state.clipLeft / state.clipTotal, 0) + ')';
}
function stopClip() { clearInterval(state.clipTimer); state.clipTimer = null; }
function resetClip(msg) {
  stopClip();
  state.clipLeft = 0;
  const status = $('#clip-status');
  status.classList.remove('on');
  $('#clip-label').textContent = 'Clipboard empty';
  $('#clip-time').textContent = '0:00';
  $('#clip-bar').style.transform = 'scaleX(0)';
  $('#clip-clear').hidden = true;
  if (msg) toast(msg);
}
async function copyField(id, field, label) {
  const r = await api.clip.copy(id, field);
  if (!r.ok) { toast(r.error || 'Unavailable', 'err'); return; }
  toast(label + ' copied — wipes itself in ' + r.secs + ' s');
  startClip(r.secs, state.settings.clipClearSecs);
  const chip = $(`.copy-chip[data-copy-field="${field}"]`);
  if (chip) {
    chip.classList.add('copied');
    setTimeout(() => chip.classList.remove('copied'), 1500);
  }
}

/* ------------------------------------------------------------ */
/* Pay                                                            */
/* ------------------------------------------------------------ */
function openPay(card) {
  state.currentId = card.id;
  $('#pay-title').textContent = card.nickname;
  $('#pay-num').textContent = card.brand === 'amex' ? '•••• •••••• •' + card.last4 : '•••• •••• •••• ' + card.last4;
  $('#pay-holder').textContent = card.holder;
  $('#pay-exp').textContent = card.expiry;
  $('#p-num').textContent = (card.brand === 'amex' ? '•••• •' : '•••• ') + card.last4;
  $('#p-exp').textContent = card.expiry;
  $('#p-holder').textContent = card.holder;
  const addr = [card.street, [card.city, card.region].filter(Boolean).join(', ') + (card.zip ? ' ' + card.zip : ''), card.country]
    .filter(Boolean).join('\n');
  $('#p-addr').textContent = addr || 'No address saved';
  $('#p-addr').classList.toggle('empty', !addr);
  const c = $('#pay-ccard');
  c.className = 'ccard ' + card.brand;
  const isMc = card.brand === 'mc';
  $('#pay-brand').hidden = isMc;
  $('#pay-mc').hidden = !isMc;
  if (!isMc) $('#pay-brand').textContent = card.brand.toUpperCase();
  showScreen('pay');
  api.clip.status().then(r => { if (r && r.remaining > 0) startClip(r.remaining, state.settings.clipClearSecs); });
}

/* ------------------------------------------------------------ */
/* Add / Edit form                                               */
/* ------------------------------------------------------------ */
function detectBrand(digits) {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mc';
  if (/^3[47]/.test(digits)) return 'amex';
  return digits ? 'card' : '';
}
function paintBrand(digits) {
  const el = $('#brand-detect');
  const b = detectBrand(digits);
  el.className = 'brand-detect' + (b ? ' ' + b : '');
  el.textContent = { visa: 'VISA', mc: 'MASTERCARD', amex: 'AMEX', card: 'OTHER CARD' }[b] || 'No brand detected';
}
function openAdd() {
  state.editId = null;
  $('#add-title').textContent = 'Add a card';
  $('#card-form').reset();
  $('#card-error').hidden = true;
  $('#f-num').placeholder = '4242 4242 4242 4242';
  $('#f-num').disabled = false;
  $('#f-cvv').placeholder = '•••';
  $('#num-hint').textContent = 'Number is checksum-validated before saving.';
  paintBrand('');
  showScreen('add');
  $('#f-nick').focus();
}
function openEdit(card) {
  state.editId = card.id;
  $('#add-title').textContent = 'Edit “' + card.nickname + '”';
  $('#card-error').hidden = true;
  $('#f-nick').value = card.nickname;
  $('#f-name').value = card.holder;
  $('#f-num').value = '';
  $('#f-num').placeholder = '•••• •••• •••• ' + card.last4 + '  (leave blank to keep)';
  $('#f-cvv').value = '';
  $('#f-cvv').placeholder = '••• (leave blank to keep)';
  $('#f-exp').value = card.expiry;
  $('#f-default').checked = card.isDefault;
  $('#f-street').value = card.street || '';
  $('#f-city').value = card.city || '';
  $('#f-region').value = card.region || '';
  $('#f-zip').value = card.zip || '';
  $('#f-country').value = card.country || '';
  $('#num-hint').textContent = 'The stored number is never shown. Leave blank to keep it, or type a new one.';
  paintBrand('');
  showScreen('add');
  $('#f-nick').focus();
}
async function submitCard(e) {
  e.preventDefault();
  const err = $('#card-error');
  err.hidden = true;
  const data = {
    nickname: $('#f-nick').value,
    holder: $('#f-name').value,
    number: state.editId ? '' : $('#f-num').value,
    expiry: $('#f-exp').value,
    cvv: state.editId ? '' : $('#f-cvv').value,
    isDefault: $('#f-default').checked,
    street: $('#f-street').value,
    city: $('#f-city').value,
    region: $('#f-region').value,
    zip: $('#f-zip').value,
    country: $('#f-country').value,
  };
  if (state.editId) {
    if ($('#f-num').value.trim()) data.number = $('#f-num').value;
    if ($('#f-cvv').value.trim()) data.cvv = $('#f-cvv').value;
  }
  const r = state.editId ? await api.card.update(state.editId, data) : await api.card.add(data);
  if (!r.ok) {
    err.textContent = r.error || 'Something went wrong.';
    err.hidden = false;
    return;
  }
  state.cards = r.cards;
  renderVault($('#search').value);
  toast(state.editId ? 'Card updated' : 'Card saved — encrypted ✓');
  showScreen('vault');
}

/* ------------------------------------------------------------ */
/* Unlock / create                                               */
/* ------------------------------------------------------------ */
function strengthScore(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, Math.max(1, s - 1 + (pw.length >= 8 ? 0 : 0)) || (pw ? 1 : 0));
}
function updateStrength() {
  const pw = $('#cp1').value;
  const score = strengthScore(pw);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  $('#strength').dataset.score = score;
  $('#strength-label').textContent = labels[score] || '—';
}
function setUnlockMode(mode) {
  $('#unlock-sub').textContent = mode === 'create'
    ? 'First run — pick a master password. It never leaves this PC and can’t be recovered.'
    : 'Your cards, encrypted. Only you hold the key.';
  $('#unlock-form').hidden = mode !== 'unlock';
  $('#create-form').hidden = mode !== 'create';
  if (mode === 'unlock') $('#pwd').focus();
  else $('#cp1').focus();
}

/* ------------------------------------------------------------ */
/* Settings                                                      */
/* ------------------------------------------------------------ */
function fillSettings() {
  $('#set-autolock').value = String(state.settings.autoLockMins);
  $('#set-clip').value = String(state.settings.clipClearSecs);
  $('#set-startup').checked = !!state.settings.openAtLogin;
}
async function applySetting(patch) {
  const r = await api.settings.set(patch);
  if (r.ok) { state.settings = r.settings; toast('Settings saved'); }
}

/* ------------------------------------------------------------ */
/* Locked event                                                  */
/* ------------------------------------------------------------ */
function handleLock(reason) {
  state.cards = [];
  state.currentId = null;
  state.editId = null;
  resetClip();
  setUnlockMode(state.hasVault ? 'unlock' : 'create');
  showScreen('unlock');
  if (reason) toast(reason, 'warn');
}

/* ------------------------------------------------------------ */
/* Boot                                                          */
/* ------------------------------------------------------------ */
async function boot() {
  let info;
  try { info = await api.info(); }
  catch (e) { return; }
  state.hasVault = info.hasVault;
  state.settings = info.settings || state.settings;
  $('#about-version').textContent = 'v' + info.version;
  fillSettings();
  if (info.unlocked) {
    state.cards = await api.vault.list();
    renderVault();
    showScreen('vault');
  } else {
    setUnlockMode(info.hasVault ? 'unlock' : 'create');
    showScreen('unlock');
  }
}

/* ------------------------------------------------------------ */
/* Wire-up                                                       */
/* ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {

  /* titlebar */
  $('#btn-min').addEventListener('click', () => api.win.minimize());
  $('#btn-max').addEventListener('click', () => api.win.maximize());
  $('#btn-close').addEventListener('click', () => { api.win.close(); toast('WinCredit keeps running in the tray', 'warn'); });
  api.onMaximized(isMax => {
    $('#max-icon use').setAttribute('href', isMax ? '#i-restore' : '#i-max');
    $('#btn-max').setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
  });
  api.onLocked(reason => handleLock(reason));

  /* unlock */
  $('#unlock-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#unlock-error');
    err.hidden = true;
    const btn = $('#unlock-form button[type=submit]');
    btn.disabled = true;
    const r = await api.vault.unlock($('#pwd').value);
    btn.disabled = false;
    if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
    $('#pwd').value = '';
    state.cards = r.cards;
    renderVault();
    showScreen('vault');
  });

  /* create */
  $('#cp1').addEventListener('input', updateStrength);
  $('#create-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#create-error');
    err.hidden = true;
    const pw1 = $('#cp1').value, pw2 = $('#cp2').value;
    if (pw1.length < 8) { err.textContent = 'Use at least 8 characters.'; err.hidden = false; return; }
    if (pw1 !== pw2) { err.textContent = 'Passwords don’t match.'; err.hidden = false; return; }
    const btn = $('#create-form button[type=submit]');
    btn.disabled = true;
    const r = await api.vault.create(pw1);
    btn.disabled = false;
    if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
    $('#cp1').value = ''; $('#cp2').value = ''; updateStrength();
    state.hasVault = true;
    state.cards = r.cards;
    renderVault();
    toast('Vault created — your cards are encrypted now ✓');
    showScreen('vault');
  });

  /* eye toggles */
  $$('[data-eye]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $('#' + btn.dataset.eye);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide' : 'Show');
      btn.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
    });
  });

  /* vault */
  $('#search').addEventListener('input', e => renderVault(e.target.value));
  $('#btn-add').addEventListener('click', openAdd);
  $$('#empty-state .btn').forEach(b => b.addEventListener('click', openAdd));
  $('#btn-lock-now').addEventListener('click', () => api.vault.lock());

  /* pay */
  $('#btn-back-vault').addEventListener('click', () => showScreen('vault'));
  $('#btn-edit-pay').addEventListener('click', () => {
    const card = state.cards.find(c => c.id === state.currentId);
    if (card) openEdit(card);
  });
  $('#btn-copy-number').addEventListener('click', () => { if (state.currentId) copyField(state.currentId, 'number', 'Card number'); });
  $$('.copy-chip').forEach(chip => chip.addEventListener('click', () => {
    if (state.currentId) copyField(state.currentId, chip.dataset.copyField, chip.closest('.fieldrow').querySelector('.lab').textContent);
  }));
  $('#clip-clear').addEventListener('click', () => { resetClip('Clipboard cleared'); api.clip.clear(); });
  api.onClipCleared(() => resetClip());

  /* add / edit */
  $('#btn-back-add').addEventListener('click', () => showScreen('vault'));
  $('#btn-cancel-add').addEventListener('click', () => showScreen('vault'));
  $('#card-form').addEventListener('submit', submitCard);
  $('#f-num').addEventListener('input', e => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
    paintBrand(digits);
  });
  $('#f-exp').addEventListener('input', e => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (d.length > 2) d = d.slice(0, 2) + '/' + d.slice(2);
    e.target.value = d;
  });
  $('#f-cvv').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

  /* settings */
  $('#btn-settings').addEventListener('click', () => { fillSettings(); showScreen('settings'); });
  $('#btn-back-settings').addEventListener('click', () => showScreen('vault'));
  $('#set-autolock').addEventListener('change', e => applySetting({ autoLockMins: Number(e.target.value) }));
  $('#set-clip').addEventListener('change', e => applySetting({ clipClearSecs: Number(e.target.value) }));
  $('#set-startup').addEventListener('change', e => applySetting({ openAtLogin: e.target.checked }));
  $('#btn-lock-now2').addEventListener('click', () => api.vault.lock());

  $('#btn-change-pwd').addEventListener('click', () => {
    const body = document.createElement('div');
    const mk = (label, id, ph) => {
      const wrap = document.createElement('div');
      const l = document.createElement('label');
      l.textContent = label;
      l.htmlFor = id;
      const inp = document.createElement('input');
      inp.className = 'input'; inp.type = 'password'; inp.id = id; inp.placeholder = ph;
      inp.autocomplete = 'off';
      wrap.append(l, inp);
      body.appendChild(wrap);
      return inp;
    };
    const cur = mk('Current password', 'dlg-cp-old', 'Current master password');
    const nw = mk('New password', 'dlg-cp-new', 'At least 8 characters');
    const cf = mk('Confirm new password', 'dlg-cp-conf', 'Type it again');
    const errEl = document.createElement('p');
    errEl.className = 'form-error'; errEl.hidden = true;
    body.appendChild(errEl);
    openDialog({
      title: 'Change master password',
      text: 'The whole vault is re-encrypted with the new password.',
      body,
      actions: [
        { label: 'Cancel', onClick: () => {} },
        {
          label: 'Change', primary: true,
          onClick: async () => {
            if (nw.value.length < 8) { errEl.textContent = 'Use at least 8 characters.'; errEl.hidden = false; return; }
            if (nw.value !== cf.value) { errEl.textContent = 'New passwords don’t match.'; errEl.hidden = false; return; }
            const r = await api.master.change(cur.value, nw.value);
            if (!r.ok) {
              errEl.textContent = r.error || 'Could not change password.';
              errEl.hidden = false;
              return;
            }
            toast('Master password changed ✓');
          },
        },
      ],
    });
    setTimeout(() => cur.focus(), 50);
  });

  $('#btn-erase').addEventListener('click', async () => {
    const body = document.createElement('div');
    const l = document.createElement('label');
    l.textContent = 'Type ERASE to confirm';
    l.htmlFor = 'dlg-erase-txt';
    const inp = document.createElement('input');
    inp.className = 'input'; inp.id = 'dlg-erase-txt'; inp.placeholder = 'ERASE';
    body.append(l, inp);
    const yes = await new Promise(resolve => {
      openDialog({
        title: 'Erase the vault',
        text: 'Every saved card is deleted forever, and WinCredit returns to first-run. This cannot be undone.',
        body,
        actions: [
          { label: 'Cancel', onClick: () => resolve(false) },
          { label: 'Erase everything', danger: true, onClick: () => resolve(inp.value.trim() === 'ERASE') },
        ],
      });
      setTimeout(() => inp.focus(), 50);
    });
    if (!yes) { toast('Erase cancelled'); return; }
    const r = await api.vault.erase();
    if (r.ok) {
      state.hasVault = false;
      state.cards = [];
      handleLock('Vault erased');
    }
  });

  $('#btn-quit').addEventListener('click', () => api.quit());

  /* globals */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDialog(); closePopover(); }
  });
  $('#dialog-scrim').addEventListener('click', e => { if (e.target === $('#dialog-scrim')) closeDialog(); });

  boot();
});
