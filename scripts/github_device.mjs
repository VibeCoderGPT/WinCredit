/**
 * GitHub device flow helper (no gh CLI needed).
 * Usage:
 *   node scripts/github_device.mjs start            -> prints user_code + URL, saves device_code
 *   node scripts/github_device.mjs poll             -> polls until the user authorizes, saves token
 *   node scripts/github_device.mjs create-and-push  -> creates the private repo and pushes main
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLIENT_ID = '178c6fc778ccc68e1d6a'; // GitHub CLI OAuth app (public)
const stateFile = path.resolve(import.meta.dirname, '..', '.github-device.json');
const cmd = process.argv[2] || 'start';
const REPO = 'WinCredit';
const ACCOUNT = process.argv[3] || 'VibeCoderGPT';

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'WinCredit-cli' },
    body: JSON.stringify(body),
  });
  return r.json();
}

if (cmd === 'start') {
  const res = await post('https://github.com/login/device/code', { client_id: CLIENT_ID, scope: 'repo' });
  if (res.error) { console.error('START FAIL:', res); process.exit(1); }
  fs.writeFileSync(stateFile, JSON.stringify({ device_code: res.device_code, interval: res.interval || 5 }, null, 2));
  console.log('VERIFICATION_URI=' + res.verification_uri);
  console.log('USER_CODE=' + res.user_code);
  console.log('EXPIRES_MIN=' + Math.round(res.expires_in / 60));
} else if (cmd === 'poll') {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const res = await post('https://github.com/login/oauth/access_token', {
    client_id: CLIENT_ID, device_code: st.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (res.error) {
    if (res.error === 'authorization_pending') { console.log('PENDING'); process.exit(2); }
    if (res.error === 'slow_down') { console.log('SLOW_DOWN'); process.exit(3); }
    console.error('POLL FAIL:', res); process.exit(1);
  }
  fs.writeFileSync(stateFile, JSON.stringify({ ...st, token: res.access_token }, null, 2));
  console.log('TOKEN_OK');
} else if (cmd === 'create-and-push') {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!st.token) { console.error('no token yet'); process.exit(1); }
  const token = st.token;
  const who = await (await fetch('https://api.github.com/user', { headers: { Authorization: 'token ' + token, 'User-Agent': 'WinCredit-cli' } })).json();
  const owner = who.login || ACCOUNT;
  // Create repo if missing
  let create = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: 'token ' + token, 'User-Agent': 'WinCredit-cli', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: REPO, private: true, description: 'Encrypted credit-card vault for Windows — one-click payment filling (copy/fill), AES-256-GCM under a master password.', auto_init: false }),
  });
  if (create.status === 422) {
    console.log('REPO_EXISTS');
  } else if (!create.ok) {
    const b = await create.json();
    console.error('CREATE FAIL:', create.status, JSON.stringify(b).slice(0, 300)); process.exit(1);
  } else {
    console.log('REPO_CREATED private');
  }
  // Push (token only on the command line, never stored in git config or files)
  const url = `https://x-access-token:${token}@github.com/${owner}/${REPO}.git`;
  execFileSync('git', ['push', url, 'main'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'inherit' });
  // Clean, token-free remote for future use
  execFileSync('git', ['remote', 'remove', 'origin'], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', `https://github.com/${owner}/${REPO}.git`], { stdio: 'ignore' });
  console.log('PUSHED=https://github.com/' + owner + '/' + REPO);
} else {
  console.error('unknown command');
  process.exit(1);
}
