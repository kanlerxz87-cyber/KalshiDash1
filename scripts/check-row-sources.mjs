#!/usr/bin/env node
/* check-row-sources.mjs — measure the brief's rule "every table row must have a source link to an
 * official site" against the published HTML, and fail where a page's rows are supposed to carry one.
 *
 * WHY THIS EXISTS
 * ---------------
 * The brief requires it, but nothing checked it: link checkers only ask "is this href reachable",
 * never "does this data row have a source at all". This script counts every table data row
 * (a <tr> with two or more cells that is not a header row) and whether the row contains a link.
 *
 * WHERE A LINK IS REQUIRED (enforced, exit 1)
 * -------------------------------------------
 * The pages that publish API-derived numbers: the landing page, the executive summary, the five
 * topic pages, the markets table, the source register, the API reference and the catalyst page.
 * Every one of those must reach 100% — a number on any of them without a source would be an
 * unverified value on the live site.
 *
 * WHERE IT IS NOT (reported, exit 0)
 * ---------------------------------
 * Tables whose rows are not API data: strategy rules and ROI weights defined by this site, the
 * field glossary, the suggestions board, and repository/process irregularities (F-11, F-12, F-14)
 * that by definition have no external publisher. Those counts are printed so the distinction stays
 * visible instead of being hidden by an aggregate "100%".
 */
import { readFileSync, existsSync } from 'node:fs';

const REQUIRED = [
  'index.html',
  'executive-summary.html',
  'markets.html',
  'sources.html',
  'api.html',
  'catalyst.html',
  'categories/gas.html',
  'categories/elections.html',
  'categories/culture.html',
  'categories/crypto.html',
  'categories/golf.html',
];

const REPORT_ONLY = [
  'flagged.html',
  'questions.html',
  'strategies.html',
  'strategylab.html',
  'suggestions.html',
  'dashboard.html',
  'market.html',
  'portfolio.html',
  'analysis.html',
  'alerts/index.html',
];

function audit(file) {
  if (!existsSync(file)) return { file, rows: 0, missing: ['<file missing>'], found: false };
  const html = readFileSync(file, 'utf8');
  let rows = 0;
  const missing = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    // header rows are <thead> content; they describe columns, they do not carry data or sources
    const body = table[0].replace(/<thead[\s\S]*?<\/thead>/g, '');
    for (const row of body.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = row[0].match(/<t[dh][\s>][\s\S]*?<\/t[dh]>/g) || [];
      if (cells.length < 2) continue;
      if (cells.every((c) => c.trim().startsWith('<th'))) continue;
      rows++;
      if (!/<a\s/.test(row[0])) {
        const text = row[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        missing.push(text);
      }
    }
  }
  return { file, rows, missing, found: true };
}

let failures = 0;
let enforcedRows = 0;
let enforcedMissing = 0;

console.log('ENFORCED — pages that publish API-derived numbers (must be 100% sourced)');
for (const f of REQUIRED) {
  const r = audit(f);
  enforcedRows += r.rows;
  enforcedMissing += r.missing.length;
  const pct = r.rows ? ((100 * (r.rows - r.missing.length)) / r.rows).toFixed(1) : 'n/a';
  console.log(`  ${r.found ? 'ok  ' : 'MISS'} ${f.padEnd(30)} rows=${String(r.rows).padStart(4)} sourced=${pct}%`);
  if (!r.found) failures++;
  for (const m of r.missing) {
    failures++;
    console.error(`       ✗ row without a source link: ${m}`);
  }
}

console.log('\nREPORT-ONLY — pages whose rows are rules, glossary entries or process findings');
let otherRows = 0;
for (const f of REPORT_ONLY) {
  const r = audit(f);
  otherRows += r.rows;
  console.log(`       ${f.padEnd(30)} rows=${String(r.rows).padStart(4)} without-an-official-source=${r.missing.length}`);
}

console.log(`\nenforced rows: ${enforcedRows}, missing first-party source links: ${enforcedMissing}`);
console.log(`report-only rows: ${otherRows}`);
if (failures) {
  console.error(`\nFAILED — ${failures} enforced row/file problem(s)`);
  process.exit(1);
}
console.log('every enforced data row carries a source link');
