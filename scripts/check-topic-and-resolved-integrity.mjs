#!/usr/bin/env node
/**
 * Offline regression gate for three snapshot / generator data-integrity fixes
 * (session-c23c0f31, 2026-11-27):
 *
 *   F-GAS-01      Gas Prices AAA filter must keep AAA retail gasoline series
 *                 (KXAAAGAS* / AAAGAS*) and reject EIA natural-gas futures
 *                 (KXNGASMAX / NGASMAX / "Natural gas price peak") and diesel.
 *   F-RESOLVED-01 Partially-settled events (e.g. KXAAAGASMINCA-26DEC31) must
 *                 never render still-active / unresolved strikes (result null/"")
 *                 inside the "Resolved events (yes / no)" table.
 *   F-VOL-01      Topic summary "24h volume ($)" must sum all captured open
 *                 markets when `live_volume_24h_notional_total` is present, and
 *                 label the `top N of M` scope explicitly when reading an older
 *                 snapshot that omits the full-topic total.
 *
 * Runs offline against the real `scripts/fetch-snapshot.mjs` helpers, `assets/app.js`,
 * a patched copy of `data/snapshot.json` fed through the real `scripts/build-site.mjs`,
 * and the committed generated pages.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isGasPriceSeries,
  isResolvedMarket,
  sumVolume24hNotional,
} from './fetch-snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

console.log('check-topic-and-resolved-integrity (F-GAS-01, F-RESOLVED-01, F-VOL-01)');

/* ---------------------------------------------------------------- F-GAS-01 */
check('F-GAS-01 positive: keeps KXAAAGAS*, legacy AAAGAS*, and retail gas price titles', () => {
  const mustKeep = [
    { ticker: 'KXAAAGASW', title: 'US gas price up' },
    { ticker: 'KXAAAGASM', title: 'US gas price' },
    { ticker: 'KXAAAGASD', title: 'US gas price up' },
    { ticker: 'KXAAAGASMINCA', title: 'California lowest gas price yearly' },
    { ticker: 'KXAAAGASMINTX', title: 'Texas lowest gas price yearly' },
    { ticker: 'AAAGASM', title: 'US gas price' },
    { ticker: 'AAAGASMAX', title: 'US highest gas price yearly' },
    { ticker: 'RETAILGAS', title: 'US regular gas price weekly' },
  ];
  for (const s of mustKeep) {
    assert.equal(isGasPriceSeries(s), true, `expected keep for ${s.ticker} (${s.title})`);
  }
});

check('F-GAS-01 negative: rejects EIA natural gas (KXNGASMAX / NGASMAX), diesel, crude oil', () => {
  const mustReject = [
    { ticker: 'KXNGASMAX', title: 'Natural gas price peak' },
    { ticker: 'NGASMAX', title: 'Natural gas price peak' },
    { ticker: 'KXNGASW', title: 'Henry Hub natural gas price weekly' },
    { ticker: 'KXDIESELD', title: 'US diesel gas price daily' },
    { ticker: 'KXWTI', title: 'WTI crude oil price' },
    { ticker: 'KXSPRLVL', title: 'Strategic Petroleum Reserve level' },
  ];
  for (const s of mustReject) {
    assert.equal(isGasPriceSeries(s), false, `expected reject for ${s.ticker} (${s.title})`);
  }
});

check('F-GAS-01 browser parity: assets/app.js applies the same natural-gas/diesel guard', () => {
  const appSrc = readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  assert.match(appSrc, /function\s+isGasPriceSeries\s*\(/, 'assets/app.js must define isGasPriceSeries');
  assert.match(appSrc, /if\s*\(topic\.id\s*===\s*'gas'\)\s*return\s+isGasPriceSeries\(s\)/, 'refreshUniverse must use isGasPriceSeries');
  assert.match(appSrc, /natural\\s\+gas/, 'assets/app.js gas filter must exclude natural gas');
  assert.match(appSrc, /diesel/i, 'assets/app.js gas filter must exclude diesel');
});

/* ----------------------------------------------------------- F-RESOLVED-01 */
check('F-RESOLVED-01 predicate: accepts yes/no/scalar and rejects active/blank results', () => {
  assert.equal(isResolvedMarket({ status: 'finalized', result: 'yes' }), true);
  assert.equal(isResolvedMarket({ status: 'finalized', result: 'no' }), true);
  assert.equal(isResolvedMarket({ status: 'finalized', result: 'scalar' }), true);
  assert.equal(isResolvedMarket({ status: 'active', result: null }), false);
  assert.equal(isResolvedMarket({ status: 'active', result: '' }), false);
  assert.equal(isResolvedMarket({ status: 'closed', result: '   ' }), false);
  assert.equal(isResolvedMarket(null), false);
});

check('F-RESOLVED-01 browser parity: assets/app.js filters #resolved-body with isResolvedMarket', () => {
  const appSrc = readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  assert.match(appSrc, /function\s+isResolvedMarket\s*\(/, 'assets/app.js must define isResolvedMarket');
  assert.match(appSrc, /if\s*\(isResolvedMarket\(m\)\)\s*resolved\.push\(\{\s*ev:\s*ev,\s*m:\s*m\s*\}\)/,
    'pages.category must filter settled_events markets via isResolvedMarket');
});

/* ---------------------------------------------------------------- F-VOL-01 */
check('F-VOL-01 math: sumVolume24hNotional includes markets beyond the 60-row slice', () => {
  const top60 = Array.from({ length: 60 }, () => ({ volume_24h_fp: 100, notional_value_dollars: 1 }));
  const tail5 = Array.from({ length: 5 }, () => ({ volume_24h_fp: 500, notional_value_dollars: 1 }));
  assert.equal(sumVolume24hNotional(top60), 6000);
  assert.equal(sumVolume24hNotional([...top60, ...tail5]), 8500);
});

/* ------------------------------------------ end-to-end build-site sandbox */
function renderInSandbox(mutateSnap) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kalshidash-integrity-'));
  try {
    mkdirSync(path.join(dir, 'data', 'live'), { recursive: true });
    mkdirSync(path.join(dir, 'categories'), { recursive: true });
    cpSync(path.join(ROOT, 'templates'), path.join(dir, 'templates'), { recursive: true });
    cpSync(path.join(ROOT, 'data', 'sources.json'), path.join(dir, 'data', 'sources.json'));
    cpSync(path.join(ROOT, 'data', 'live', 'feed.json'), path.join(dir, 'data', 'live', 'feed.json'));
    cpSync(path.join(ROOT, 'scripts', 'build-site.mjs'), path.join(dir, 'build-site.mjs'));

    const snap = JSON.parse(readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
    mutateSnap(snap);
    writeFileSync(path.join(dir, 'data', 'snapshot.json'), JSON.stringify(snap));

    execFileSync(process.execPath, ['build-site.mjs'], { cwd: dir, stdio: 'pipe' });
    return {
      gasHtml: readFileSync(path.join(dir, 'categories', 'gas.html'), 'utf8'),
      indexHtml: readFileSync(path.join(dir, 'index.html'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function resolvedBodyHtml(html) {
  const start = html.indexOf('id="resolved-body"');
  assert.ok(start >= 0, 'resolved-body must exist');
  const end = html.indexOf('</tbody>', start);
  return html.slice(start, end);
}

check('F-RESOLVED-01 end-to-end: build-site excludes active KXAAAGASMINCA-26DEC31 strikes from #resolved-body while keeping finalized -4.20', () => {
  const { gasHtml } = renderInSandbox((snap) => {
    snap.topics.gas.settled_events = [
      {
        event_ticker: 'KXAAAGASMINCA-26DEC31',
        title: 'How low will gas prices in California get this year?',
        series_ticker: 'KXAAAGASMINCA',
        settlement_ts: null,
        settlement_sources: [{ name: 'AAA', url: 'https://gasprices.aaa.com/' }],
        source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXAAAGASMINCA&status=settled&with_nested_markets=true&limit=2',
        markets: [
          { ticker: 'KXAAAGASMINCA-26DEC31-4.20', yes_sub_title: 'Below $4.20', status: 'finalized', result: 'yes', settlement_ts: '2026-01-22T02:49:56.06907Z', settlement_value_dollars: 1, volume_fp: 2299 },
          { ticker: 'KXAAAGASMINCA-26DEC31-4.10', yes_sub_title: 'Below $4.10', status: 'active', result: null, settlement_ts: null, settlement_value_dollars: null, volume_fp: 100 },
          { ticker: 'KXAAAGASMINCA-26DEC31-4.00', yes_sub_title: 'Below $4.00', status: 'active', result: '', settlement_ts: null, settlement_value_dollars: null, volume_fp: 200 },
          { ticker: 'KXAAAGASMINCA-26DEC31-SCALAR', yes_sub_title: 'Scalar test', status: 'finalized', result: 'scalar', settlement_ts: '2026-01-22T02:49:56.06907Z', settlement_value_dollars: 0.5, volume_fp: 50 },
        ],
      },
    ];
  });
  const body = resolvedBodyHtml(gasHtml);
  assert.ok(body.includes('KXAAAGASMINCA-26DEC31-4.20'), 'finalized strike -4.20 must remain in #resolved-body');
  assert.ok(!body.includes('KXAAAGASMINCA-26DEC31-4.10'), 'active strike -4.10 (null result) must be excluded from #resolved-body');
  assert.ok(!body.includes('KXAAAGASMINCA-26DEC31-4.00'), 'active strike -4.00 (empty result) must be excluded from #resolved-body');
  assert.ok(body.includes('<span class="badge neutral">scalar</span>'), 'scalar outcome must use neutral badge');
});

check('F-VOL-01 end-to-end: build-site prefers live_volume_24h_notional_total and otherwise labels top-N scope', () => {
  const { indexHtml: withFull } = renderInSandbox((snap) => {
    snap.topics.crypto.live_markets_total = 1753;
    snap.topics.crypto.live_volume_24h_notional_total = 987654;
  });
  assert.ok(withFull.includes('987,654'), 'index.html must display live_volume_24h_notional_total when present');
  assert.ok(!withFull.includes('top 60 of 1,753'), 'index.html must not show truncation badge when full total is present');

  const { indexHtml: legacy } = renderInSandbox((snap) => {
    delete snap.topics.crypto.live_volume_24h_notional_total;
    snap.topics.crypto.live_markets_total = 1753;
  });
  assert.ok(legacy.includes('top 60 of 1,753'), 'index.html must label top-60 scope when full-topic total is absent');
});

check('Committed categories/*.html: zero unresolved/blank-result rows in any #resolved-body', () => {
  for (const topic of ['gas', 'elections', 'culture', 'crypto', 'golf']) {
    const html = readFileSync(path.join(ROOT, 'categories', `${topic}.html`), 'utf8');
    const body = resolvedBodyHtml(html);
    for (const [row] of body.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      if (row.includes('colspan="8"')) continue;
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      assert.ok(cells.length >= 3, `${topic}.html resolved row should have >= 3 cells`);
      assert.match(cells[2], />\s*(yes|no|scalar)\s*</i,
        `${topic}.html resolved row has unresolved Result cell: ${cells[1]} -> ${cells[2]}`);
    }
  }
});

console.log(`check-topic-and-resolved-integrity: ${passed} checks passed.`);
