// List colour utility classes in src that name a colour FORGE's palette does
// not define (stock Tailwind families, or stops our families lack).
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const OURS = {
  scales: { cobalt: [200, 300, 400, 500, 600, 700], brass: [200, 300, 400, 500, 600, 700], green: [200, 300, 400, 500, 600, 700], red: [200, 300, 400, 500, 600, 700], indigo: [200, 300, 400, 500, 600, 700], plum: [300, 400, 500, 600] },
  alias: { teal: 'cobalt', sky: 'cobalt', gold: 'brass', hazard: 'brass', amber: 'brass', emerald: 'green', signal: 'green', rose: 'red', blood: 'red', violet: 'indigo', magenta: 'plum' },
};
const STOCK = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const PREFIX = '(?:text|bg|border(?:-[xytrblse])?|ring(?:-offset)?|divide|placeholder|from|via|to|fill|stroke|outline|decoration|caret|accent|shadow)';
const RE = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*${PREFIX}-([a-z]+)-(\\d{2,3})(?:\\/[\\w.\\[\\]]+)?(?![\\w-])`, 'g');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(tsx?|css)$/.test(e.name)) files.push(f); } })(path.join(root, 'src'));
const hits = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      const [cls, fam, stopS] = m; const stop = Number(stopS);
      if (!STOCK.includes(fam) && !OURS.scales[fam] && !OURS.alias[fam]) continue;
      const base = OURS.alias[fam] ?? fam;
      const ok = OURS.scales[base]?.includes(stop) || (fam === 'signal' && false);
      if (!ok) hits.push(`${path.relative(root, f)}:${i + 1}  ${cls}`);
    }
  });
}
console.log(hits.join('\n'));
console.log(`\n${hits.length} classes`);
