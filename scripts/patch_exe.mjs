/**
 * Patch WinCredit.exe: replace the Electron icon with the WinCredit gold W
 * and set version info. Pure JS (resedit), no native tooling.
 * Output is written to a temp file first, then atomically replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as PELibrary from 'pe-library';
import * as ResEdit from 'resedit';

const root = path.resolve(import.meta.dirname, '..');
const exePath = path.join(root, 'dist', 'WinCredit', 'WinCredit.exe');
const icoPath = path.join(root, 'assets', 'icon.ico');

// The product version always follows package.json — never a stale literal.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [maj = 0, min = 0, patch = 0] = String(pkg.version).split('.').map(n => parseInt(n, 10) || 0);

const data = fs.readFileSync(exePath);
const exe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);

// --- replace icons (all existing icon groups, e.g. MAINICON) ---
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
if (groups.length === 0) throw new Error('no icon group found in exe');
for (const g of groups) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, g.id, g.lang, iconFile.icons.map(item => item.data));
}
console.log('replaced', groups.length, 'icon group(s)');

// --- version info ---
const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (viList.length > 0) {
  const vi = viList[0];
  vi.setFileVersion(maj, min, patch, 0, 1033);
  vi.setProductVersion(maj, min, patch, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'WinCredit - encrypted card vault',
    ProductName: 'WinCredit',
    CompanyName: 'WinCredit',
    InternalName: 'WinCredit.exe',
    OriginalFilename: 'WinCredit.exe',
  });
  vi.outputToResourceEntries(res.entries);
  console.log('version info updated ->', pkg.version);
} else {
  console.log('no version info resource (skipped)');
}

res.outputResource(exe);
const out = exe.generate();
const tmp = exePath + '.patched';
fs.writeFileSync(tmp, Buffer.from(out));
fs.rmSync(exePath);
fs.renameSync(tmp, exePath);
console.log('OK ->', exePath, fs.statSync(exePath).size, 'bytes');
