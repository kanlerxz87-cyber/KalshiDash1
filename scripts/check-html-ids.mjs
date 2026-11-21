#!/usr/bin/env node
/* check-html-ids.mjs — fail if any published HTML file repeats an element id.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Flagged for Review page has carried duplicate anchors three times in this project's
 * history — F-27…F-31 (two different flag sets), then F-54 twice (an upstream-API finding and an
 * environment finding), then a `#F-28` link that pointed at the wrong row. Every one of those was
 * found by hand, after publication, because nothing in CI looked for it. Duplicate ids are invalid
 * HTML and silently break every in-page anchor that names them, which matters on a page whose
 * whole purpose is being linked from other pages.
 *
 * WHAT IT CHECKS
 * --------------
 * Every *.html file under the published tree (repository root, categories/, alerts/, dash/, docs/,
 * archive/, templates/ excluded because .tpl is not published) is scanned for id="…" attributes.
 * An id repeated inside one file is an error; ids are namespaced per file, so the same id in two
 * different pages is fine.
 *
 * Exit code 1 on any duplicate, so it can gate a merge.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'templates', 'verification', 'audit']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(ROOT).sort();
let filesWithIssues = 0;
let duplicates = 0;
let idCount = 0;

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const seen = new Map();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    const id = m[1];
    idCount++;
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1);
  if (dup.length === 0) continue;
  filesWithIssues++;
  const rel = path.relative(ROOT, file);
  for (const [id, n] of dup) {
    duplicates += n - 1;
    console.error(`${rel}: id="${id}" appears ${n} times`);
  }
}

console.log(`checked ${files.length} published HTML files, ${idCount} ids`);
if (duplicates) {
  console.error(`\nFAILED — ${duplicates} duplicate id occurrence(s) in ${filesWithIssues} file(s)`);
  process.exit(1);
}
console.log('no duplicate element ids');
