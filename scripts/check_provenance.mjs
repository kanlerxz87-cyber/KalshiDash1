#!/usr/bin/env node
/**
 * check_provenance.mjs — proves the home page can never present a committed-snapshot row as
 * a live one (flag F-41, fixed in session-444e829d).
 *
 * THE BUG THIS LOCKS DOWN
 * -----------------------
 * `assets/app.js` serves the committed `data/snapshot.json` whenever the browser cannot reach
 * the demo API, and it counted `Object.keys(state.markets).length` — which includes those
 * snapshot rows — while labelling the number "live from the demo API". On `index.html` that
 * produced "Markets tracked 200 / live from the demo API" in a browser that had reached
 * nothing. That is a fabricated live figure, the exact class of error the brief forbids.
 *
 * THE RULE
 *   * every market row read from the snapshot is tagged provenance='snapshot';
 *   * every market row read from the API is tagged provenance='live';
 *   * the card counts by provenance and says how many of each.
 *
 * HOW IT IS TESTED (no network; deterministic)
 *   1. Render index.html in jsdom with the real assets/app.js.
 *   2. Mock `fetch` so the API probe FAILS (network unreachable) and the snapshot succeeds.
 *      Assert the card shows the snapshot count and says the API is not reachable, and that the
 *      word "live" does not appear in that note.
 *   3. Mock `fetch` so the probe SUCCEEDS and `/markets` returns two markets, while the snapshot
 *      has N markets. Assert the card counts snapshot rows separately from live rows.
 *
 * Run: node scripts/check_provenance.mjs          (skips cleanly if jsdom is not installed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  console.log('check_provenance: jsdom not installed — skipping (CI installs it).');
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');

const snapshot = {
  meta: { captured_at: '2026-11-20T19:16:02.879Z', api_root: 'https://external-api.demo.kalshi.co/trade-api/v2' },
  markets: [
    { ticker: 'SNAP-A', title: 'snapshot row A', status: 'active', last_price_dollars: 0.42, series_ticker: 'S1', settlement_sources: [] },
    { ticker: 'SNAP-B', title: 'snapshot row B', status: 'active', last_price_dollars: 0.13, series_ticker: 'S1', settlement_sources: [] },
    { ticker: 'SNAP-C', title: 'snapshot row C', status: 'active', last_price_dollars: 0.71, series_ticker: 'S1', settlement_sources: [] }
  ],
  orderbooks: {},
  topics: {},
  candlesticks: {}
};

const liveMarkets = [
  { ticker: 'LIVE-1', title: 'live row 1', status: 'active', series_ticker: 'KXTEST', last_price_dollars: 0.55, yes_bid_dollars: 0.54, yes_ask_dollars: 0.56, volume_24h_fp: 10, volume_fp: 20, open_interest_fp: 5 },
  { ticker: 'LIVE-2', title: 'live row 2', status: 'active', series_ticker: 'KXTEST', last_price_dollars: 0.22, yes_bid_dollars: 0.21, yes_ask_dollars: 0.23, volume_24h_fp: 10, volume_fp: 20, open_interest_fp: 5 }
];

let assertions = 0;
function check(name, cond, detail = '') {
  assertions++;
  if (!cond) {
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${name}`);
  }
}

/* Build a fake fetch: `live` toggles whether the API answers. */
function makeFetch({ live }) {
  return async (url) => {
    const u = String(url);
    if (u.includes('snapshot.json')) {
      return { ok: true, json: async () => JSON.parse(JSON.stringify(snapshot)) };
    }
    if (!live) throw new TypeError('network unreachable (simulated)');
    if (u.includes('/exchange/status')) return { ok: true, json: async () => ({ exchange_active: true, trading_active: true }) };
    if (u.includes('/series')) {
      return {
        ok: true,
        json: async () => ({ series: [{ ticker: 'KXTEST', title: 'test series', volume_fp: '10.00', settlement_sources: [] }], cursor: '' })
      };
    }
    if (u.includes('/markets?series_ticker=')) return { ok: true, json: async () => ({ markets: liveMarkets, cursor: '' }) };
    if (u.includes('/markets?tickers=')) return { ok: true, json: async () => ({ markets: liveMarkets, cursor: '' }) };
    if (u.includes('/markets')) return { ok: true, json: async () => ({ markets: liveMarkets, cursor: '' }) };
    if (u.includes('/events')) return { ok: true, json: async () => ({ events: [], cursor: '' }) };
    return { ok: true, json: async () => ({}) };
  };
}

async function render({ live }) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    url: 'https://example.test/KalshiDash1/index.html',
    runScripts: 'outside-only',
    virtualConsole: vc,
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.fetch = makeFetch({ live });
  w.AbortController = w.AbortController || class { abort() {} get signal() { return undefined; } };
  /* let timers/fetch promises settle */
  w.eval(appJs);
  await new Promise((r) => setTimeout(r, 400));
  const card = [...w.document.querySelectorAll('.stat')].find((el) => /Markets tracked/i.test(el.textContent));
  return { dom, card: card ? card.textContent.replace(/\s+/g, ' ').trim() : '(card missing)' };
}

console.log('provenance test — "Markets tracked" must never label snapshot rows as live\n');

/* ---- case 1: API unreachable -> snapshot rows only, label must say so ---- */
{
  const { dom, card } = await render({ live: false });
  console.log('case 1 (API unreachable): ' + card);
  check('card exists', card !== '(card missing)');
  check('counts the 3 snapshot rows', /Markets tracked3/.test(card), card);
  check('states the API is not reachable', /not reachable/i.test(card), card);
  check('does NOT claim the count is live', !/live from the demo API/i.test(card), card);
  const badge = dom.window.document.querySelector('#mode-badge');
  check('mode badge says SNAPSHOT', /SNAPSHOT/i.test((badge && badge.textContent) || ''), (badge && badge.textContent) || '');
  dom.window.close();
}

/* ---- case 2: API answers -> snapshot + live rows are counted separately ---- */
{
  const { dom, card } = await render({ live: true });
  console.log('case 2 (API reachable): ' + card);
  check('card exists', card !== '(card missing)');
  check('reports live rows as live', /2 live/i.test(card), card);
  check('reports the 3 snapshot rows separately', /3 from the snapshot/i.test(card), card);
  check('total is 5 (2 live + 3 snapshot)', /Markets tracked5/.test(card), card);
  dom.window.close();
}

console.log(`\nprovenance test: ${assertions} assertions, ${process.exitCode ? 'FAILED' : 'all passed'}`);
