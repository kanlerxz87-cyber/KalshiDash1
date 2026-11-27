#!/usr/bin/env node
/** Canonical table-source gate. An internal link is NOT an official-source link.
 * Checks publisher identity/URL presence, not reachability or semantic truth.
 * API observations, project rules and historical findings must still be labelled honestly.
 * Runtime-populated rows are checked by the DOM tests; archived suites are not recertified.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const REQUIRED = [
  'index.html', 'executive-summary.html', 'markets.html', 'sources.html', 'api.html', 'catalyst.html',
  ...['gas', 'elections', 'culture', 'crypto', 'golf'].map((topic) => `categories/${topic}.html`),
  'flagged.html', 'questions.html', 'strategies.html', 'strategylab.html', 'suggestions.html',
  'dashboard.html', 'market.html', 'portfolio.html', 'analysis.html', 'demo-account.html',
  'requirements.html',
  'alerts/index.html', 'audit/index.html',
];

// Named publishers only. A lookalike suffix, query string or internal navigation link cannot pass.
const PUBLISHERS = new Set([
  'docs.kalshi.com', 'external-api.demo.kalshi.co', 'demo-api.kalshi.co', 'demo.kalshi.co',
  'kalshi.com', 'assets.kalshi.com', 'gasprices.aaa.com',
  'docs.github.com', 'api.github.com',
  'html.spec.whatwg.org', 'fetch.spec.whatwg.org', 'notifications.spec.whatwg.org',
]);
export function officialPublisher(href) {
  try {
    const u = new URL(href.replace(/&amp;/g, '&'));
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    // The project's own GitHub pages are authoritative for its code/process, NOT exchange fills.
    return PUBLISHERS.has(u.hostname) || (u.hostname === 'github.com' && u.pathname.startsWith('/kanlerxz87-cyber/KalshiDash1/'));
  } catch { return false; }
}

export function auditHtml(html) {
  let rows = 0;
  const missing = [];
  for (const [table] of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const body = table.replace(/<thead[\s\S]*?<\/thead>/gi, '');
    for (const [row] of body.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = row.match(/<t[dh][\s>][\s\S]*?<\/t[dh]>/gi) || [];
      if (cells.length < 2 || cells.every((cell) => /^<th[\s>]/i.test(cell.trim()))) continue;
      rows++;
      const hrefs = [...row.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      if (!hrefs.some(officialPublisher)) {
        missing.push(row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150));
      }
    }
  }
  return { rows, missing };
}

function selftest() {
  const row = (href) => `<table><thead><tr><th>Heading</th><th>Source</th></tr></thead><tbody><tr><td>TEST ONLY</td><td><a href="${href}">source</a></td></tr></tbody></table>`;
  let n = 0;
  for (const href of ['market.html?ticker=TEST', '#internal', 'https://example.org/', 'https://docs.kalshi.com.evil.invalid/', 'http://docs.kalshi.com/', 'https://u:p@docs.kalshi.com/']) {
    assert.equal(auditHtml(row(href)).missing.length, 1, `not an approved publisher: ${href}`); n++;
  }
  for (const href of ['https://docs.kalshi.com/api-reference/market/get-market', 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=TEST', 'https://github.com/kanlerxz87-cyber/KalshiDash1/blob/main/assets/paper.js']) {
    const result = auditHtml(row(href)); assert.equal(result.rows, 1); assert.equal(result.missing.length, 0); n++;
  }
  assert.equal(auditHtml('<table><tr><td colspan="3">No confirmed data</td></tr></table>').rows, 0); n++;
  console.log(`source gate: ${n} offline positive/negative checks passed; internal-only/lookalike links are rejected.`);
}

function check() {
  let failures = 0, rows = 0;
  console.log('ENFORCED — every canonical table row must link an approved official publisher (including project/code definitions)');
  for (const file of REQUIRED) {
    if (!existsSync(file)) { failures++; console.error(`MISS ${file}`); continue; }
    const result = auditHtml(readFileSync(file, 'utf8')); rows += result.rows;
    console.log(`  ${result.missing.length ? 'FAIL' : 'ok  '} ${file.padEnd(30)} rows=${String(result.rows).padStart(4)} official-link=${result.rows ? ((result.rows - result.missing.length) / result.rows * 100).toFixed(1) + '%' : 'n/a'}`);
    for (const item of result.missing) { failures++; console.error(`       ✗ missing publisher link: ${item}`); }
  }
  console.log('\nSOURCE-PARAMETER — Get Markets uses plural `tickers`; singular `ticker` would silently return unrelated rows');
  for (const file of [...REQUIRED, 'data/live/feed.json', 'data/snapshot.json']) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const urls = file.endsWith('.json')
      ? [...text.matchAll(/"(https?:[^"]+)"/g)].map((m) => m[1])
      : [...text.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const url of urls) {
      try {
        const u = new URL(url.replace(/&amp;/g, '&'));
        if (u.pathname === '/trade-api/v2/markets' && u.searchParams.has('ticker')) {
          failures++; console.error(`       ✗ ${file}: unsupported singular market query: ${url}`);
        }
      } catch { /* Relative links are not API queries. */ }
    }
  }
  console.log(`\ncanonical static rows checked: ${rows}; problems: ${failures}`);
  console.log('Publisher links are provenance pointers, not proof of a return, a recommendation or current data. External URLs are not fetched by this offline gate.');
  if (failures) process.exitCode = 1;
  else console.log('Every enforced canonical row has an approved publisher link.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest();
  else check();
}
