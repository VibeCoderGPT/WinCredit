/**
 * Card validation & views — pure Node, no Electron imports.
 * Renderer input is untrusted: everything is re-validated here.
 */
'use strict';

const FIELDS = Object.freeze(['number', 'expiry', 'cvv', 'holder', 'street', 'city', 'region', 'zip', 'country']);

function luhnOk(num) {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

function brandOf(digits) {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mc';
  if (/^3[47]/.test(digits)) return 'amex';
  return 'card';
}

/**
 * Validate a card from renderer input. Returns {ok:true, card} or {ok:false, error}.
 * The returned card never contains anything beyond what was validated.
 */
function validateCardInput(d) {
  if (!d || typeof d !== 'object') return { ok: false, error: 'Invalid request.' };
  const nickname = typeof d.nickname === 'string' ? d.nickname.trim().slice(0, 60) : '';
  const holder = typeof d.holder === 'string' ? d.holder.trim().toUpperCase().slice(0, 80) : '';
  const number = typeof d.number === 'string' ? d.number.replace(/[\s-]/g, '') : '';
  const expiry = typeof d.expiry === 'string' ? d.expiry.trim() : '';
  const cvv = typeof d.cvv === 'string' ? d.cvv.trim() : '';
  const isDefault = !!d.isDefault;
  const street = typeof d.street === 'string' ? d.street.trim().slice(0, 120) : '';
  const city = typeof d.city === 'string' ? d.city.trim().slice(0, 80) : '';
  const region = typeof d.region === 'string' ? d.region.trim().slice(0, 80) : '';
  const zip = typeof d.zip === 'string' ? d.zip.trim().slice(0, 20) : '';
  const country = typeof d.country === 'string' ? d.country.trim().slice(0, 60) : '';

  if (!nickname) return { ok: false, error: 'Give the card a nickname (e.g. Battle.net).' };
  if (!holder || holder.length < 2) return { ok: false, error: 'Enter the name on the card.' };
  if (!/^\d{13,19}$/.test(number)) return { ok: false, error: 'Card number must be 13 to 19 digits.' };
  if (!luhnOk(number)) return { ok: false, error: 'That card number fails the checksum — check for a typo.' };
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) return { ok: false, error: 'Expiry must look like MM/YY (e.g. 09/28).' };
  if (!/^\d{3,4}$/.test(cvv)) return { ok: false, error: 'CVV must be 3 or 4 digits.' };
  return {
    ok: true,
    card: {
      nickname, holder, number, expiry, cvv, isDefault,
      street, city, region, zip, country,
      brand: brandOf(number), last4: number.slice(-4),
    },
  };
}

/** Renderer-safe view: never contains number or CVV. Address is included so it can be shown and copied. */
function masked(card) {
  return {
    id: card.id, nickname: card.nickname, brand: card.brand, last4: card.last4,
    holder: card.holder, expiry: card.expiry, isDefault: !!card.isDefault,
    street: card.street || '', city: card.city || '', region: card.region || '',
    zip: card.zip || '', country: card.country || '',
    createdAt: card.createdAt,
  };
}

function fieldValue(card, field) {
  if (!FIELDS.includes(field)) throw new Error('bad field');
  return card[field];
}

module.exports = { FIELDS, luhnOk, brandOf, validateCardInput, masked, fieldValue };
