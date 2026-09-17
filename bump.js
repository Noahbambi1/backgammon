#!/usr/bin/env node
// Bump the app version everywhere that matters for cache busting, then commit & push as usual.
//   node bump.js          -> increments the version number
//   node bump.js 12       -> sets it to 12
const fs = require('fs'), path = require('path');
const root = __dirname;
const verFile = path.join(root, 'version.json');
const cur = JSON.parse(fs.readFileSync(verFile, 'utf8')).v;
const next = process.argv[2] || String(parseInt(cur, 10) + 1);

function edit(file, fn) { const p = path.join(root, file); const s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('updated', file); } }
edit('version.json', () => JSON.stringify({ v: next }) + '\n');
edit('index.html', s => s.replace(/\?v=\d+/g, '?v=' + next).replace(/window\.APP_VERSION = '\d+'/, `window.APP_VERSION = '${next}'`));
edit('sw.js', s => s.replace(/const VERSION = '\d+'/, `const VERSION = '${next}'`));
console.log(`version ${cur} -> ${next}`);
