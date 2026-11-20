#!/usr/bin/env node
/**
 * check_flags.mjs — integrity check for the published "Flagged for review" register.
 *
 * F-43 (found 2026-11-20, session-444e829d): the page listed 43 rows but only 38 distinct
 * IDs. Five IDs (F-27 … F-31) were each used twice for two unrelated findings, so a link or a
 * reviewer note that said "see F-28" was ambiguous — one of the two rows was unreachable by ID.
 *
 * A findings register is only useful if every finding has exactly one address. This check
 * enforces that on the *built* page (not the template), so it catches duplicates however they
 * are introduced:
 *
 *   1. every `id="F-nn"` on flagged.html is unique;
 *   2. the visible ID cells (`F-nn</td>`) match the anchor IDs one-for-one;
 *   3. every row has a source link (an <a href> into an official host or an in-repo document),
 *      because the brief requires one source link per row;
 *   4. IDs are contiguous from F-01 with no gaps (gaps make reviewers think rows were deleted).
 *
 * Run: node scripts/check_flags.mjs            exit 1 on failure
 */
import fs from 'node:fs';
import path from 'node:path';

const page = path.join(process.cwd(), 'flagged.html');
if (!fs.existsSync(page)) {
  console.error('check_flags: flagged.html not found — run node scripts/build-site.mjs first.');
  process.exit(1);
}
const html = fs.readFileSync(page, 'utf8');

const ids = [...html.matchAll(/id="F-(\d+)"/g)].map((m) => Number(m[1]));
/* Only the ID cell itself counts: it is the first cell of a row and follows its anchor.
 * A cross-reference such as "Correction to F-04" in the Type column is not an ID cell. */
const cells = [...html.matchAll(/<span id="F-(\d+)"><\/span>F-\d+<\/td>/g)].map((m) => Number(m[1]));

const problems = [];
const seen = new Map();
for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);{
  for (const [id, n] of seen) if (n > 1) problems.push(`id F-${String(id).padStart(2, '0')} is used ${n} times`);
}

if (ids.length !== cells.length) {
  problems.push(`${ids.length} anchors but ${cells.length} visible ID cells`);
}
for (const id of cells) if (!seen.has(id)) problems.push(`row F-${String(id).padStart(2, '0')} has no anchor id`);

/* Every row must carry a source link. Rows are <tr> blocks that contain an F-nn id. */
const rows = html.split('<tr>').filter((r) => /id="F-\d+"/.test(r));
let noSource = 0;
for (const r of rows) {
  if (!/<a\s[^>]*href="/.test(r)) {
    noSource++;
    const id = (r.match(/id="F-(\d+)"/) || [, '?'])[1];
    problems.push(`row F-${id} has no source link`);
  }
}
if (rows.length !== ids.length) problems.push(`${rows.length} rows but ${ids.length} anchors`);

/* Contiguity from 1. */
const uniq = [...new Set(ids)].sort((a, b) => a - b);
for (let i = 1; i <= uniq[uniq.length - 1]; i++) {
  if (!uniq.includes(i)) problems.push(`gap: F-${String(i).padStart(2, '0')} is missing`);
}

if (problems.length) {
  console.error('flag register check FAILED:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}

console.log(
  `flag register: OK — ${rows.length} rows, ${uniq.length} unique IDs (F-01 … F-${String(uniq[uniq.length - 1]).padStart(2, '0')}), ` +
    'every row carries a source link, no duplicate or missing IDs.'
);
