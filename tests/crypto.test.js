/**
 * WinCredit crypto/vault tests — run with: node tests/crypto.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vault = require('../vault');

let passed = 0;
const fails = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log('  \u2713', name); })
    .catch(err => { fails.push({ name, err }); console.log('  \u2717', name, '->', err.message); });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'));
const file = path.join(tmp, 'vault.wcv');

(async () => {
  console.log('WinCredit crypto tests\n');

  await test('create vault, wrong password is rejected', async () => {
    await vault.createVaultFile(file, 'correct horse battery staple');
    await assert.rejects(
      () => vault.openVaultFile(file, 'wrong password here'),
      e => e.code === 'WRONG_PASSWORD'
    );
  });

  await test('create + reopen round-trips card data', async () => {
    const { key, salt } = await vault.createVaultFile(file, 'mypassword');
    const doc = { check: 'wincredit', cards: [{ id: 'c1', number: '4242424242424242', cvv: '123' }] };
    await vault.saveVaultFile(file, key, salt, doc);
    const opened = await vault.openVaultFile(file, 'mypassword');
    assert.strictEqual(opened.doc.cards.length, 1);
    assert.strictEqual(opened.doc.cards[0].number, '4242424242424242');
    assert.strictEqual(opened.doc.cards[0].cvv, '123');
  });

  await test('ciphertext on disk contains no plaintext bytes', async () => {
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('4242424242424242'));
    assert.ok(!raw.includes('mypassword'));
    assert.ok(!raw.includes('wincredit'));
    assert.ok(!raw.includes('MICHAEL'));
  });

  await test('every save uses a fresh nonce (no reuse)', async () => {
    const { key, salt } = await vault.createVaultFile(file, 'mypassword');
    const doc = { check: 'wincredit', cards: [] };
    await vault.saveVaultFile(file, key, salt, doc);
    const f1 = JSON.parse(fs.readFileSync(file, 'utf8'));
    const n1 = Buffer.from(f1.data, 'base64').subarray(0, 12).toString('hex');
    await vault.saveVaultFile(file, key, salt, doc);
    const f2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    const n2 = Buffer.from(f2.data, 'base64').subarray(0, 12).toString('hex');
    assert.notStrictEqual(n1, n2);
  });

  await test('tampered ciphertext is rejected (GCM tag)', async () => {
    await vault.createVaultFile(file, 'mypassword');
    const f = JSON.parse(fs.readFileSync(file, 'utf8'));
    const blob = Buffer.from(f.data, 'base64');
    blob[20] ^= 0xFF;
    f.data = blob.toString('base64');
    fs.writeFileSync(file, JSON.stringify(f));
    await assert.rejects(() => vault.openVaultFile(file, 'mypassword'), e => e.code === 'WRONG_PASSWORD' || e.code === 'CORRUPT');
  });

  await test('missing file reports IO error', async () => {
    await assert.rejects(() => vault.openVaultFile(path.join(tmp, 'nope.wcv'), 'x'), e => e.code === 'IO');
  });

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${fails.length} failed`);
  if (fails.length) {
    for (const f of fails) console.error('FAIL:', f.name, f.err);
    process.exit(1);
  }
})();
