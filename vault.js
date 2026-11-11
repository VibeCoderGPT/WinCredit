/**
 * WinCredit vault — encrypted card storage.
 * Pure Node.js (no Electron imports) so it can be tested standalone.
 *
 * Format (vault.wcv, JSON):
 *   { magic:"WCV1", kdf:{N,r,p}, salt:<b64>, data:<b64 nonce|ciphertext|tag> }
 *
 * Security notes:
 *  - Key: scrypt(masterPassword, salt, N=2^15, r=8, p=1) -> 32 bytes.
 *  - Cipher: AES-256-GCM, fresh 12-byte random nonce on EVERY save
 *    (never reused, so the fixed salt is safe).
 *  - A wrong password fails GCM tag verification -> "wrong password".
 *  - The plaintext contains a check string as a canary.
 *  - The full vault only ever exists decrypted in main-process memory.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = 'WCV1';
const CHECK = 'wincredit';
const KDF_PARAMS = Object.freeze({ N: 32768, r: 8, p: 1, keyLen: 32 });

class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultError';
    this.code = code; // 'WRONG_PASSWORD' | 'CORRUPT' | 'IO'
  }
}

function deriveKey(password, salt, params = KDF_PARAMS) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, params.keyLen,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function encryptJSON(key, obj) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]).toString('base64');
}

function decryptJSON(key, b64) {
  const blob = Buffer.from(b64, 'base64');
  if (blob.length < 12 + 16 + 16) throw new VaultError('CORRUPT', 'Vault data is truncated.');
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  let pt;
  try {
    pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch (e) {
    throw new VaultError('WRONG_PASSWORD', 'Wrong master password.');
  }
  let obj;
  try {
    obj = JSON.parse(pt.toString('utf8'));
  } catch (e) {
    throw new VaultError('CORRUPT', 'Vault data is unreadable.');
  }
  if (!obj || obj.check !== CHECK || !Array.isArray(obj.cards)) {
    throw new VaultError('CORRUPT', 'Vault data is unreadable.');
  }
  return obj;
}

async function createVaultFile(filePath, password) {
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(password, salt);
  const doc = { check: CHECK, cards: [] };
  const data = encryptJSON(key, doc);
  const file = {
    magic: MAGIC,
    kdf: { N: KDF_PARAMS.N, r: KDF_PARAMS.r, p: KDF_PARAMS.p },
    salt: salt.toString('base64'),
    data,
  };
  await atomicWrite(filePath, JSON.stringify(file));
  return { key, salt, params: KDF_PARAMS, doc };
}

async function openVaultFile(filePath, password) {
  let file;
  try {
    file = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new VaultError('IO', 'No vault found.');
    throw new VaultError('CORRUPT', 'Vault file is unreadable.');
  }
  if (!file || file.magic !== MAGIC || !file.salt || !file.data) {
    throw new VaultError('CORRUPT', 'Not a WinCredit vault file.');
  }
  const salt = Buffer.from(file.salt, 'base64');
  const params = file.kdf && Number.isInteger(file.kdf.N)
    ? { ...KDF_PARAMS, ...file.kdf }
    : KDF_PARAMS;
  const key = await deriveKey(password, salt, params);
  const doc = decryptJSON(key, file.data); // throws WRONG_PASSWORD on bad key
  return { key, salt, params, doc };
}

async function saveVaultFile(filePath, key, salt, doc) {
  const file = {
    magic: MAGIC,
    kdf: { N: KDF_PARAMS.N, r: KDF_PARAMS.r, p: KDF_PARAMS.p },
    salt: Buffer.from(salt).toString('base64'),
    data: encryptJSON(key, doc),
  };
  await atomicWrite(filePath, JSON.stringify(file));
}

async function atomicWrite(filePath, text) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp-' + crypto.randomBytes(4).toString('hex');
  await fs.promises.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.promises.rename(tmp, filePath);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
}

module.exports = {
  VaultError,
  KDF_PARAMS,
  deriveKey,
  encryptJSON,
  decryptJSON,
  createVaultFile,
  openVaultFile,
  saveVaultFile,
};
