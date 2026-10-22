// Inventory of colour that bypasses the token system, per file.
const fs = require('fs'), path = require('path');
const ROOT = '/home/user/FORGE/src';
const files = [];
(function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx|ts|css)$/.test(n)) files.push(p); } })(ROOT);
const OUR = new Set(['cobalt','brass','green','red','indigo','plum','teal','sky','gold','hazard','amber','emerald','signal','rose','blood','violet','magenta']);
const OUR_STOPS = { plum: [300,400,500,600], sky: [200,300,400] };
const DEFAULT_STOPS = [200,300,400,500,600,700];
const PREFIX = '(?:bg|text|border|border-[trblxy]|ring|ring-offset|from|to|via|fill|stroke|divide|outline|decoration|placeholder|caret|accent|shadow)';
const rules = {
  tailwindDefaultFamily: new RegExp(`\\b${PREFIX}-(gray|slate|zinc|neutral|stone|orange|yellow|lime|cyan|blue|purple|fuchsia|pink)-(\\d{2,3})\\b`, 'g'),
  offScaleStop: new RegExp(`\\b${PREFIX}-(${[...OUR].join('|')})-(\\d{2,3})\\b`, 'g'),
  arbitraryColor: /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|shadow)-\[(?:#|rgb|rgba|hsl)[^\]]*\]/g,
  hexLiteral: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F-])/g,
  whiteBlack: /\b(?:bg|text|border|from|to|via|ring|fill|stroke)-(?:white|black)(?:\/\[?[0-9.]+\]?)?\b/g,
  hexAlphaOnVar: /\$\{[^}]+\}[0-9A-Fa-f]{2}(?=[`'"\s,)])/g,
  undefinedTokens: /\btext-foreground\b|var\(--(?:text|muted|paper|canvas|cobalt|accent)\)/g,
  gradient: /\bbg-gradient-to-[a-z]+\b|linear-gradient\(/g,
  glowShadow: /\bshadow-(?:glow[a-z-]*|2xl|xl|lg)\b/g,
  heavyWeight: /\bfont-(?:semibold|bold|extrabold|black)\b/g,
  monoTiny: /\btext-\[(?:7|8|9)px\]/g,
};
const out = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = f.replace('/home/user/FORGE/', '');
  const hits = {};
  for (const [k, re] of Object.entries(rules)) {
    let m; const arr = [];
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      if (k === 'offScaleStop') { const fam = m[1], stop = Number(m[2]); const ok = (OUR_STOPS[fam] || DEFAULT_STOPS).includes(stop); if (ok) continue; }
      if (k === 'hexLiteral' && /\.css$/.test(f)) continue;
      arr.push(m[0]);
    }
    if (arr.length) hits[k] = arr;
  }
  if (Object.keys(hits).length) out[rel] = hits;
}
const totals = {};
for (const h of Object.values(out)) for (const [k, a] of Object.entries(h)) totals[k] = (totals[k] || 0) + a.length;
fs.writeFileSync(process.argv[2], JSON.stringify({ totals, files: out }, null, 1));
console.log(JSON.stringify(totals));
const byFile = Object.entries(out).map(([f, h]) => [f, Object.entries(h).filter(([k]) => !['heavyWeight', 'monoTiny', 'gradient'].includes(k)).reduce((s, [, a]) => s + a.length, 0)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
console.log('files with off-token colour:', byFile.length); console.log(byFile.slice(0, 25).map(([f, n]) => `${n}\t${f}`).join('\n'));
