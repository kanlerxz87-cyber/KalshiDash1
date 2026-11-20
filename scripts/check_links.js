#!/usr/bin/env node
/* check_links.js — internal link & asset checker for docs/ (no dependencies).
 * Usage: node scripts/check_links.js   (exit 0 = all internal links resolve) */
'use strict';
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'dash');
let errors = 0, checked = 0;

function walk(dir) {
  let out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(DOCS);
const htmlFiles = files.filter(f => f.endsWith('.html'));
const allNames = new Set(files.map(f => path.relative(DOCS, f)));

for (const file of htmlFiles) {
  const rel = path.relative(DOCS, file);
  const rawSrc = fs.readFileSync(file, 'utf8');
  // strip inline <script> blocks so JS string concatenations aren't scanned as links
  const src = rawSrc.replace(/<script[\s\S]*?<\/script>/g, '');
  const re = /(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const raw = m[1];
    if (/^(https?:|mailto:|#|javascript:)/.test(raw)) continue; // external or in-page
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) continue;
    checked++;
    const target = path.normalize(path.join(path.dirname(rel), clean));
    if (!allNames.has(target) && !allNames.has(clean)) {
      console.error(`BROKEN ${rel} -> ${raw}`);
      errors++;
    }
  }
}

// JSON validity
for (const f of files.filter(f => f.endsWith('.json'))) {
  checked++;
  try { JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.error(`INVALID JSON ${path.relative(DOCS, f)}: ${e.message}`); errors++; }
}

console.log(`checked ${checked} internal links/assets across ${htmlFiles.length} pages — ${errors} broken`);
process.exit(errors ? 1 : 0);
