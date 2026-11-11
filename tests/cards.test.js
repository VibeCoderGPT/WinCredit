/** Card validation tests — run with: node tests/cards.test.js */
'use strict';
const assert = require('assert');
const { luhnOk, brandOf, validateCardInput, masked, fieldValue } = require('../lib/cards');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  \u2713', name); }
  catch (e) { failed++; console.log('  \u2717', name, '->', e.message); }
}

console.log('WinCredit card tests\n');

t('luhn: valid Visa test number', () => assert.ok(luhnOk('4242424242424242')));
t('luhn: valid Amex test number', () => assert.ok(luhnOk('378282246310005')));
t('luhn: valid Mastercard test number', () => assert.ok(luhnOk('5555555555554444')));
t('luhn: transposition rejected', () => assert.ok(!luhnOk('4242424242424241')));
t('luhn: garbage rejected', () => assert.ok(!luhnOk('abc')));

t('brand: visa', () => assert.strictEqual(brandOf('4242'), 'visa'));
t('brand: mastercard 51-55', () => assert.strictEqual(brandOf('5500'), 'mc'));
t('brand: mastercard 2-series', () => assert.strictEqual(brandOf('2720'), 'mc'));
t('brand: amex', () => assert.strictEqual(brandOf('3782'), 'amex'));
t('brand: unknown falls back to card', () => assert.strictEqual(brandOf('1234'), 'card'));

const good = {
  nickname: '  Battle.net  ', holder: 'michael tremblay', number: '4242 4242 4242 4242',
  expiry: '09/28', cvv: '123', isDefault: true,
  street: '  1234 Main Street, Apt 5 ', city: 'Montréal', region: 'QC', zip: 'H1A 0A1', country: 'Canada',
};
t('validate: good input normalizes', () => {
  const r = validateCardInput(good);
  assert.ok(r.ok);
  assert.strictEqual(r.card.nickname, 'Battle.net');
  assert.strictEqual(r.card.holder, 'MICHAEL TREMBLAY');
  assert.strictEqual(r.card.last4, '4242');
  assert.strictEqual(r.card.brand, 'visa');
  assert.strictEqual(r.card.street, '1234 Main Street, Apt 5');
  assert.strictEqual(r.card.city, 'Montréal');
  assert.strictEqual(r.card.region, 'QC');
  assert.strictEqual(r.card.zip, 'H1A 0A1');
  assert.strictEqual(r.card.country, 'Canada');
});
t('validate: address optional, overlong values truncated', () => {
  const r = validateCardInput({ ...good, street: '', city: '', region: '', zip: '', country: '' });
  assert.ok(r.ok);
  assert.strictEqual(r.card.street, '');
  const long = validateCardInput({ ...good, street: 'x'.repeat(500) });
  assert.ok(long.ok);
  assert.strictEqual(long.card.street.length, 120);
});
t('validate: bad checksum rejected', () => {
  assert.ok(!validateCardInput({ ...good, number: '4242 4242 4242 4241' }).ok);
});
t('validate: bad expiry rejected', () => {
  assert.ok(!validateCardInput({ ...good, expiry: '13/99' }).ok);
});
t('validate: short cvv rejected', () => {
  assert.ok(!validateCardInput({ ...good, cvv: '12' }).ok);
});
t('validate: missing nickname rejected', () => {
  assert.ok(!validateCardInput({ ...good, nickname: '   ' }).ok);
});
t('validate: non-object rejected', () => {
  assert.ok(!validateCardInput('4242').ok);
});

const view = masked({ id: 'x', nickname: 'Steam', brand: 'mc', last4: '5432', holder: 'A B', expiry: '11/27', isDefault: false, number: '5555555555554444', cvv: '999', street: '1 Rue Test', city: 'MTL', region: 'QC', zip: 'H0H', country: 'CA' });
t('masked view strips number and cvv but keeps address', () => {
  assert.ok(!('number' in view));
  assert.ok(!('cvv' in view));
  assert.strictEqual(view.last4, '5432');
  assert.strictEqual(view.street, '1 Rue Test');
  assert.strictEqual(view.city, 'MTL');
});
t('fieldValue serves every field individually', () => {
  const c = { number: '5555555555554444', expiry: '11/27', cvv: '999', holder: 'A B', street: '1 Rue Test, Apt 2', city: 'MTL', region: 'QC', zip: 'H0H', country: 'Canada' };
  assert.strictEqual(fieldValue(c, 'number'), '5555555555554444');
  assert.strictEqual(fieldValue(c, 'cvv'), '999');
  assert.strictEqual(fieldValue(c, 'street'), '1 Rue Test, Apt 2');
  assert.strictEqual(fieldValue(c, 'city'), 'MTL');
  assert.strictEqual(fieldValue(c, 'region'), 'QC');
  assert.strictEqual(fieldValue(c, 'zip'), 'H0H');
  assert.strictEqual(fieldValue(c, 'country'), 'Canada');
  assert.throws(() => fieldValue(c, 'password'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
