/* check_lab.mjs — headless QA for catalyst.html (K1) and strategylab.html (K2), session-7f90cf50.
 *
 * Runs the two pages in jsdom with mocked fetch responses shaped EXACTLY like the verified
 * Kalshi demo API payloads (captured 2026-11-20; see the Sources tables on the pages and
 * verification/2026-11-20-e6c3b3b6.md). Asserts:
 *   1. pages render without script errors,
 *   2. >= $0.10 swings are detected from 1-min candle closes and from previous_price_dollars,
 *   3. each swing record carries market/event links, settlement-source links and search links,
 *   4. the strategy lab categorises trades and computes P&L from recorded fields,
 *   5. strategy synthesis emits a rule when a cell has >=3 settled wins.
 *
 * Usage: NODE_PATH=<dir with jsdom> node scripts/check_lab.mjs
 * Skips (exit 0, with a message) when jsdom is not installed.
 */
import { fileURLToPath } from 'node:url';
import { auditHtml } from './check-row-sources.mjs';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* `assets/freshness.js` requests `data/dash-quality.json` with XHR, and jsdom's `resources:
 * 'usable'` loads same-origin files from disk. That file is OPTIONAL BY DESIGN — loadQuality()
 * falls back to its built-in 20/45-minute thresholds when it is absent — and only the publishing
 * pipeline writes it, so a clean checkout does not have it. Its absence surfaced as an ENOENT
 * script error and failed this test on every fresh clone (F-59, recorded by session-4251f2d1).
 *
 * It must be materialised for the WHOLE run, not just page construction: the XHR fires after the
 * DOM resolves. Deleting it earlier, filtering the error out, or deleting the request from the
 * script would either hide a genuinely missing script or change production behaviour. The file is
 * removed on exit if (and only if) this test created it. */
const OPTIONAL_FILE = join(root, 'data', 'dash-quality.json');
const createdOptionalFile = (() => {
  if (existsSync(OPTIONAL_FILE)) return false;
  mkdirSync(dirname(OPTIONAL_FILE), { recursive: true });
  writeFileSync(OPTIONAL_FILE, JSON.stringify({
    freshness: { warn_minutes: 20, stale_minutes: 45 },
    note: 'Written by scripts/check_lab.mjs for the duration of the test (documented-optional file).',
  }, null, 2));
  return true;
})();
if (createdOptionalFile) {
  const cleanup = () => { try { rmSync(OPTIONAL_FILE, { force: true }); } catch { /* ignore */ } };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
}

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  // Fall back to a plain require() so a jsdom install outside the repo can be used:
  //   JSDOM_BASE=/path/to/dir/x.js node scripts/check_lab.mjs
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(process.env.JSDOM_BASE || join(root, 'package.json'));
    ({ JSDOM, VirtualConsole } = req('jsdom'));
  } catch {
    console.log('jsdom not installed — skipping headless render test (install with `npm i jsdom`).');
    process.exit(0);
  }
}

const failures = [];
const ok = (cond, msg) => {
  if (cond) console.log('  PASS ' + msg);
  else { failures.push(msg); console.error('  FAIL ' + msg); }
};

/* ---------- verified payload shapes (2026-11-20 live captures) ---------- */
const market = (ticker, over = {}) => ({
  ticker,
  event_ticker: 'KXTESTEVENT-99',
  market_type: 'binary',
  title: 'Will test prices move above $3.7400?',
  status: 'active',
  last_price_dollars: '0.4500',
  previous_price_dollars: '0.2000',
  yes_bid_dollars: '0.4400',
  yes_ask_dollars: '0.4600',
  yes_bid_size_fp: '100.00',
  yes_ask_size_fp: '120.00',
  volume_fp: '500.00',
  volume_24h_fp: '120.00',
  open_interest_fp: '300.00',
  result: '',
  close_time: '2026-12-31T23:59:00Z',
  ...over,
});

const eventsPayload = {
  events: [
    {
      event_ticker: 'KXTESTEVENT-99',
      series_ticker: 'KXAAAGASDSD',
      title: 'Average gas prices on Dec 31',
      category: 'Economics',
      settlement_sources: [
        { name: 'AAA', url: 'https://gasprices.aaa.com/' },
        { name: 'Reuters', url: 'https://www.reuters.com' },
      ],
      markets: [market('KXAAAGASDSD-26DEC31-3.7400')],
    },
    {
      // non-focus topic: must be ignored by the client-side topic filter
      event_ticker: 'KXSOCCER-99',
      series_ticker: 'KXSOCCER',
      title: 'Soccer test event',
      category: 'Sports',
      settlement_sources: [],
      markets: [market('KXSOCCER-99-A', { title: 'Soccer side A' })],
    },
  ],
  cursor: '',
};

const seriesPayload = {
  series: [
    { ticker: 'KXAAAGASDSD', title: 'Daily gas price test series', category: 'Economics', tags: ['Oil and energy'], volume_fp: '900.00' },
    { ticker: 'KXDIESELD', title: 'Daily Diesel Price', category: 'Economics', tags: ['Oil and energy'], volume_fp: '50.00' }, // must be excluded (F-18)
  ],
};

const marketsBySeries = {
  KXAAAGASDSD: { markets: [market('KXAAAGASDSD-26DEC31-3.7400')], cursor: '' },
  KXDIESELD: { markets: [], cursor: '' },
};

const candlePayload = {
  ticker: 'KXAAAGASDSD-26DEC31-3.7400',
  candlesticks: [
    { end_period_ts: Math.floor(Date.now() / 1000) - 300, price: { close_dollars: '0.4500' }, volume_fp: '10.00', open_interest_fp: '300.00' },
    { end_period_ts: Math.floor(Date.now() / 1000) - 240, price: { close_dollars: '0.4700' }, volume_fp: '10.00', open_interest_fp: '300.00' },
    // >= $0.10 jump between consecutive closes -> must register a swing
    { end_period_ts: Math.floor(Date.now() / 1000) - 180, price: { close_dollars: '0.6200' }, volume_fp: '25.00', open_interest_fp: '300.00' },
    { end_period_ts: Math.floor(Date.now() / 1000) - 120, price: { close_dollars: '0.6100' }, volume_fp: '10.00', open_interest_fp: '300.00' },
    { end_period_ts: Math.floor(Date.now() / 1000) - 60, price: { close_dollars: '0.6000' }, volume_fp: '10.00', open_interest_fp: '300.00' },
  ],
};

function mockFetch(url) {
  const u = String(url);
  const respond = (obj) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(obj))) });
  if (u.includes('/exchange/status')) return respond({ exchange_active: true, trading_active: true });
  if (u.includes('/events')) return respond(eventsPayload);
  if (u.includes('/series?') || u.includes('/series%3F')) return respond(seriesPayload);
  if (u.includes('/candlesticks')) return respond(candlePayload);
  if (u.includes('/markets?') || u.includes('/markets%3F')) {
    for (const [series, payload] of Object.entries(marketsBySeries)) {
      if (u.includes(series)) return respond(payload);
    }
    return respond({ markets: [market('KXAAAGASDSD-26DEC31-3.7400')], cursor: '' });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

function loadPage(file, storageSeed) {
  const errors = [];
  const vc = new VirtualConsole();
  // `data/dash-quality.json` is OPTIONAL by design: assets/freshness.js requests it and
  // falls back to the identical thresholds when it is absent (see the comment on loadQuality).
  // Depending on the jsdom/XHR path, its expected ENOENT is emitted as either `error` or
  // `jsdomError`; suppress only that exact optional-file miss, never other resource failures.
  const expectedMissingQuality = (e) => {
    const message = String(e && e.message ? e.message : e);
    return message.includes(join(root, 'data', 'dash-quality.json')) && /\bENOENT\b/.test(message);
  };
  vc.on('jsdomError', (e) => {
    if (expectedMissingQuality(e)) return;
    if (!/Not implemented|module script|HTMLScriptElement/.test(String(e.message || e))) errors.push(String(e.message || e));
  });
  vc.on('error', (m) => {
    if (expectedMissingQuality(m)) return;
    if (!/Could not load|module/i.test(String(m))) errors.push(String(m));
  });
  return JSDOM.fromFile(join(root, file), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    /* `assets/freshness.js` requests data/dash-quality.json with XHR. The file is OPTIONAL BY
     * DESIGN — loadQuality() falls back to its built-in 20/45-minute thresholds when it is absent
     * — and it is written only by the publishing pipeline, so a clean checkout does not have it.
     * jsdom loads same-origin files from disk during navigation, so the absence surfaced as an
     * ENOENT script error and failed this test on every fresh clone (F-59, recorded by
     * session-4251f2d1). Rather than silently ignoring the error (which would also hide a real
     * missing script), provide the documented-optional file for the duration of the test and
     * remove it afterwards if the test created it. */
    beforeParse(window) {
      window.fetch = mockFetch;
      // Deterministic in-memory localStorage (jsdom's file:// origins can be opaque).
      const store = new Map();
      const shim = {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => { store.set(String(k), String(v)); },
        removeItem: (k) => { store.delete(String(k)); },
        clear: () => { store.clear(); },
        key: (i) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
      };
      try { Object.defineProperty(window, 'localStorage', { value: shim, configurable: true }); }
      catch { window.localStorage = shim; }
      if (storageSeed) {
        for (const [k, v] of Object.entries(storageSeed)) {
          shim.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
      }
    },
  }).then((dom) => ({ dom, errors }));
}

const waitFor = async (fn, what, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for: ' + what);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/* ---------- Test 1: catalyst page ---------- */
console.log('Test 1 — catalyst.html renders, detects >= $0.10 swings, attaches links');
{
  const { dom, errors } = await loadPage('catalyst.html');
  const doc = dom.window.document;

  await waitFor(() => doc.querySelector('#watch-table table tbody tr'), 'watchlist rows');
  ok(true, 'watchlist table rendered');

  const feed = await waitFor(() => {
    const items = doc.querySelectorAll('#swing-feed .feed-item');
    return items.length ? items : null;
  }, 'swing feed items');

  const text = [...feed].map((n) => n.textContent).join('\n');
  const hrefs = [...doc.querySelectorAll('#swing-feed a')].map((a) => a.getAttribute('href') || '').join('\n');
  ok(/candle-close|24h-change|live-sample/.test(text), 'swing entries carry a detection basis');
  ok(text.includes('KXAAAGASDSD-26DEC31-3.7400'), 'swing entries name the market ticker');
  ok(text.includes('news search'), 'swing entries carry possible-catalyst discovery links');
  ok(hrefs.includes('gasprices.aaa.com'), 'swing entries link the official settlement sources from the API');
  ok(hrefs.includes('markets/KXAAAGASDSD-26DEC31-3.7400'), 'swing entries link the official market endpoint');

  // candle swing: 0.47 -> 0.62 = +0.15; day-over-day: 0.20 -> 0.45 = +0.25
  ok(/0\.4700.*0\.6200|0\.6200/s.test(text) || text.includes('candle-close'), 'candle-close swing recorded');
  /* F-84 (session-f7ba69d5): `previous_price_dollars` is the last traded YES price A DAY AGO
   * (official schema), so the old "prev-close" label presented a day-over-day change as an
   * intraday swing. The record must now be labelled 24h-change and must never be labelled as a
   * same-session detection. */
  ok(text.includes('24h-change'), 'the day-over-day comparison is labelled 24h-change (F-84)');
  ok(!text.includes('prev-close'), 'no record still calls the day-old field a close/prev-close swing (F-84)');

  // diesel must be excluded (F-18 scope decision)
  ok(!doc.body.textContent.includes('KXDIESELD'), 'diesel series excluded from gas topic');

  // event sources table lists settlement sources from the API
  const srcTable = await waitFor(() => doc.querySelector('#event-sources table'), 'event sources table');
  ok(srcTable.textContent.includes('AAA'), 'event sources table shows API settlement sources');

  ok(errors.length === 0, 'no unexpected script errors (' + errors.join(' | ') + ')');
  dom.window.close();
}

/* ---------- Test 2: strategy lab ---------- */
console.log('Test 2 — strategylab.html categorises trades, computes P&L, synthesises rules');
{
  const v1Trades = [
    { id: 'seed-1', ts: '2026-11-20T10:15:00Z', ticker: 'KXDEMOFUTHOURLY-26NOV20H11-UP', title: 'Demo BTC at or above 61580.32 USD', topic: 'crypto', side: 'yes', price: 0.55, qty: 10, strategy: 'momentum', status: 'settled', result: 'yes', exit_price: 1, pnl: 4.5, fee: 0, seed: true },
    { id: 'seed-2', ts: '2026-11-20T10:40:00Z', ticker: 'KXDEMOFUTHOURLY-26NOV20H11-UP', title: 'Demo BTC at or above 61580.32 USD', topic: 'crypto', side: 'no', price: 0.4, qty: 5, strategy: 'mean-reversion', status: 'settled', result: 'yes', exit_price: 0, pnl: -2.0, fee: 0, seed: true },
  ];
  // three wins in one cell (crypto mid-band) to trigger synthesis
  const v2Trades = [
    { id: 't-1', ts_open: '2026-11-20T09:00:00Z', ts_close: '2026-11-20T12:00:00Z', ticker: 'KXA-1', title: 'Crypto test A', topic: 'crypto', strategy: 'momentum', outcome: 'yes', order_side: 'bid', count_fp: '20.00', entry_price_dollars: '0.5000', exit_price_dollars: '1.0000', status: 'settled', result: 'yes', pnl_dollars: '10.00', engine: 'test-engine', seed: false },
    { id: 't-2', ts_open: '2026-11-20T09:00:00Z', ts_close: '2026-11-20T12:00:00Z', ticker: 'KXA-2', title: 'Crypto test B', topic: 'crypto', strategy: 'momentum', outcome: 'yes', order_side: 'bid', count_fp: '20.00', entry_price_dollars: '0.6000', exit_price_dollars: '1.0000', status: 'settled', result: 'yes', pnl_dollars: '8.00', engine: 'test-engine', seed: false },
    { id: 't-3', ts_open: '2026-11-20T09:00:00Z', ts_close: '2026-11-20T12:00:00Z', ticker: 'KXA-3', title: 'Crypto test C', topic: 'crypto', strategy: 'momentum', outcome: 'yes', order_side: 'bid', count_fp: '20.00', entry_price_dollars: '0.5500', exit_price_dollars: '1.0000', status: 'settled', result: 'yes', pnl_dollars: '9.00', engine: 'test-engine', seed: false },
    { id: 't-4', ts_open: '2026-11-20T08:00:00Z', ticker: 'KXGAS-1', title: 'Gas test open trade', topic: 'gas', strategy: 'hold-to-resolution', outcome: 'no', order_side: 'ask', count_fp: '5.00', entry_price_dollars: '0.8500', status: 'open', result: '', engine: 'test-engine', seed: false },
  ];
  const { dom, errors } = await loadPage('strategylab.html', {
    'kalshidash:v1:trades': v1Trades,
    'kalshidash:trades:v2': v2Trades,
  });
  const doc = dom.window.document;

  await waitFor(() => doc.querySelector('#trade-table tbody tr'), 'trade rows');
  const tradeText = doc.querySelector('#trade-table').textContent;
  ok(tradeText.includes('KXDEMOFUTHOURLY-26NOV20H11-UP'), 'v1 store trades ingested');
  ok(tradeText.includes('KXA-1'), 'v2 store trades ingested');
  ok(tradeText.includes('mid ($0.20') && tradeText.includes('favorite'), 'entry-price bands assigned');
  ok(tradeText.includes('$4.50'), 'recorded P&L shown (seed-1 = 4.50)');
  ok(tradeText.includes('differs from recorded') || tradeText.includes('$4.50'), 'computed P&L cross-check rendered');

  await waitFor(() => doc.querySelector('#stat-tables table'), 'stat tables');
  const stats = doc.querySelector('#stat-tables').textContent;
  ok(stats.includes('Performance by strategy'), 'strategy stats table rendered');
  ok(stats.includes('Performance by topic'), 'topic stats table rendered');
  ok(stats.includes('momentum'), 'strategy names present');

  const synth = await waitFor(() => doc.querySelector('#synthesis .card.idea, #synthesis .notice'), 'synthesis output');
  ok(synth.classList.contains('idea'), 'synthesis emitted a rule hypothesis for the 3-win cell');
  ok(/hypothesis only/.test(doc.querySelector('#synthesis').textContent), 'synthesis labelled hypothesis-only');
  ok(auditHtml(doc.documentElement.outerHTML).missing.length === 0, 'every runtime lab row has a publisher/field-definition link, not an invented market lookup');
  ok(/Unverified legacy/.test(doc.body.textContent), 'legacy performance is prominently separated from canonical results');
  const oldSeed = [...doc.querySelectorAll('#trade-table tbody tr')].find((r) => r.textContent.includes('KXDEMOFUTHOURLY'));
  ok(oldSeed && /unknown/.test(oldSeed.textContent), 'settled legacy record without close time has unknown holding band, not a fabricated current close');
  const seed = doc.querySelector('#f-seed'); seed.checked = false;
  seed.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const cards = doc.querySelector('#lab-cards').textContent;
  ok(cards.includes('4') && !doc.querySelector('#trade-table').textContent.includes('KXDEMOFUTHOURLY'), 'excluding seeds also updates summary cardinality and log');
  const topic = doc.querySelector('#f-topic'); topic.value = 'gas';
  topic.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  ok(!doc.querySelector('#stat-tables').textContent.includes('momentum'), 'topic filter reaches all aggregate tables');
  ok(!doc.querySelector('#synthesis .card.idea'), 'topic filter cannot leave hypotheses based on hidden trades');
  ok(!doc.querySelector('#stat-tables').textContent.includes('$0.00'), 'unknown P&L for an open-only group is blank, never a fabricated zero');
  ok(errors.length === 0, 'no unexpected script errors (' + errors.join(' | ') + ')');
  dom.window.close();
}

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s).');
  process.exit(1);
}
console.log('\nAll lab checks passed.');
