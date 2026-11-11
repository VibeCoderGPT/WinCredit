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
  vi.setFileVersion(0, 1, 0, 0, 1033);
  vi.setProductVersion(0, 1, 0, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'WinCredit - encrypted card vault',
    ProductName: 'WinCredit',
    CompanyName: 'WinCredit',
    InternalName: 'WinCredit.exe',
    OriginalFilename: 'WinCredit.exe',
  });
  vi.outputToResourceEntries(res.entries);
  console.log('version info updated');
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
