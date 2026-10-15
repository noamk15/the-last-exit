// Cache busting: stamps ?v=<version> on every local script/style import so browsers
// fetch new files right after a deploy (GitHub Pages caches for 10 minutes).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const v = process.argv[2] || Date.now().toString(36);
const stamp = (file, re) => {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(re, (m, pre, name) => `${pre}${name}?v=${v}`);
  if (after !== before) writeFileSync(file, after);
};
stamp('index.html', /(href=")(\.\/css\/style\.css)(?:\?v=[^"]*)?/g);
stamp('index.html', /(src=")(\.\/js\/main\.js)(?:\?v=[^"]*)?/g);
for (const f of readdirSync('js')) if (f.endsWith('.js')) stamp(`js/${f}`, /(from ')(\.\/[a-z]+\.js)(?:\?v=[^']*)?/g);
console.log('version', v);
