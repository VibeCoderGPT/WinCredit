/** Download latin woff2 subsets of Fraunces (600) and Inter (400/500/600/700). */
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap';
const outDir = path.join(__dirname, '..', 'assets', 'fonts');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const res = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('css2 request failed: ' + res.status);
  const css = await res.text();

  const faces = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const body = m[1];
    const fam = (body.match(/font-family:\s*'([^']+)'/) || [])[1];
    const weight = ((body.match(/font-weight:\s*([0-9 ]+)/) || [])[1] || '').trim().replace(/\s+/g, ' ');
    const range = ((body.match(/unicode-range:\s*([^;]+);/) || [])[1] || '').trim();
    const url = (body.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/) || [])[1];
    if (!url || !/^U\+0000-00FF/.test(range)) continue; // latin subset only
    faces.push({ fam, weight, url });
  }

  const faceCss = [];
  for (const f of faces) {
    const slug = f.fam.replace(/\s+/g, '').toLowerCase();
    const w = f.weight.replace(/\s+/g, '-');
    const file = path.join(outDir, `${slug}-${w}.woff2`);
    if (!fs.existsSync(file)) {
      const r = await fetch(f.url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('font download failed: ' + f.url);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      console.log('got', `${slug}-${w}.woff2`);
    }
    faceCss.push(`@font-face { font-family: '${f.fam}'; font-style: normal; font-weight: ${f.weight}; font-display: swap; src: url('${slug}-${w}.woff2') format('woff2'); }`);
  }
  fs.writeFileSync(path.join(outDir, 'fonts.css'), faceCss.join('\n'));
  console.log('--- fonts.css ---\n' + faceCss.join('\n'));
})();
