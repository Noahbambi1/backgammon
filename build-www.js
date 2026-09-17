#!/usr/bin/env node
// Copies the web app into www/ for Capacitor (only what the app needs; no node_modules, tests, native dirs).
const fs = require('fs'), path = require('path');
const root = __dirname, out = path.join(root, 'www');
const include = ['index.html', 'manifest.webmanifest', 'version.json', 'privacy.html', 'css', 'js', 'vendor', 'icons'];
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
for (const item of include) {
  const src = path.join(root, item); if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(out, item), { recursive: true });
}
// Native builds do not use the service worker (assets are bundled); nothing else to change.
console.log('www/ built from', include.filter(i => fs.existsSync(path.join(root, i))).join(', '));
