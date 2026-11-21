#!/usr/bin/env node
/** Canonical chart + paper UI regression tests. ALL market values here are synthetic test fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
let checks = 0;
function check(label, fn) { fn(); checks++; console.log('ok   ' + label); }
const NOW = Date.parse('2026-11-21T22:00:00Z');
const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
const raw = { ticker: 'FIXTURE', event_ticker: 'FIXTURE-EVENT', market_type: 'binary', title: 'SYNTHETIC TEST MARKET',
  yes_sub_title: 'TEST', status: 'active', result: '', last_price_dollars: '0.6100', notional_value_dollars: '1.0000',
  yes_bid_dollars: '0.6000', yes_ask_dollars: '0.6200', no_bid_dollars: '0.3800', no_ask_dollars: '0.4000',
  yes_bid_size_fp: '12.00', yes_ask_size_fp: '7.00', volume_fp: '1000.00', volume_24h_fp: '100.00', open_interest_fp: '200.00',
  close_time: '2027-01-01T00:00:00Z', rules_primary: 'SYNTHETIC TEST RULE' };
const snapshot = { meta: { captured_at: new Date(NOW - 3600000).toISOString() },
  markets: [{ ...raw, last_price_dollars: 0.3, topic: 'crypto', series_ticker: 'TESTSERIES', source_url: BASE + '/markets/FIXTURE' }],
  orderbooks: {}, topics: { crypto: { series: [] } }, candlesticks: {} };
const source = (file) => readFileSync(file, 'utf8');
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

async function boot(page, live, fixture = {}) {
  let currentMarket = { ...raw };
  const errors = [], requests = [], intervals = [], draws = [], labels = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(source(page + '.html'), { url: 'https://site.invalid/KalshiDash1/' + page + '.html?ticker=FIXTURE',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
  w.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  w.clearInterval = () => {};
  w.console.error = (error) => errors.push(String(error));
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({
    fillText(text) { labels.push(String(text)); }, measureText() { return { width: 100 }; },
    createLinearGradient() { return { addColorStop() {} }; },
  }, { get(target, key) { return target[key] || (() => {}); }, set(target, key, value) { target[key] = value; return true; } });
  w.localStorage.setItem('kalshidash:v1:settings', JSON.stringify({ autoTrade: false }));
  w.fetch = async (url) => {
    url = String(url); requests.push(url);
    let data;
    if (url.includes('data/snapshot.json')) data = structuredClone(fixture.snapshot || snapshot);
    else if (!live) throw new Error('TEST OFFLINE');
    else if (url.includes('/exchange/status')) data = { exchange_active: true, trading_active: true };
    else if (url.includes('/candlesticks?')) data = { candlesticks: [
      { end_period_ts: NOW / 1000 - 180, price: { close_dollars: null } },
      { end_period_ts: NOW / 1000 - 120, price: { close_dollars: '0.4000' } },
      { end_period_ts: NOW / 1000 - 60, price: { close_dollars: '0.5000' } },
    ] };
    else if (url.includes('/orderbook?')) data = { orderbook_fp: { yes_dollars: [['0.6000', '12.00']], no_dollars: [['0.3800', '7.00']] } };
    else if (url.includes('/series?')) data = { series: url.includes('category=Crypto') ? [{ ticker: 'TESTSERIES', title: 'TEST', volume_fp: '1000.00' }] : [] };
    else if (url.includes('/markets?')) data = { markets: [{ ...currentMarket }] };
    else if (url.endsWith('/markets/FIXTURE')) data = { market: { ...currentMarket } };
    else throw new Error('Unexpected test request: ' + url);
    return { ok: true, status: 200, json: async () => data };
  };
  w.eval(source('assets/paper.js'));
  w.eval(source('assets/chart.js'));
  const draw = w.KDChart.line;
  w.KDChart.line = (canvas, points, options) => { draws.push({ canvas: canvas.id, points, options }); draw(canvas, points, options); };
  w.eval(source('assets/app.js'));
  await pause(); await pause();
  return { dom, w, errors, requests, intervals, draws, labels, setLive(value) { live = value; }, setMarket(patch) { currentMarket = { ...raw, ...patch }; } };
}

const offline = await boot('market', false);
try {
  const { w, draws } = offline;
  check('snapshot history retains CAPTURE time, never a fabricated current timestamp', () => assert.equal(w.KD.state.history.FIXTURE[0].t, (NOW - 3600000) / 1000));
  check('snapshot chart explicitly pins its axis to capture time', () => {
    const last = draws.filter((d) => d.canvas === 'price-chart').at(-1);
    assert.equal(last.options.now, (NOW - 3600000) / 1000);
    assert.match(w.document.querySelector('#chart-status').textContent, /SNAPSHOT VIEW/);
  });
  check('manual snapshot request is rejected without inventing a trade', () => {
    w.document.querySelector('#trade-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(w.KD.getTrades().length, 0);
    assert.match(w.document.querySelector('#trade-msg').textContent, /Snapshot|fresh/);
  });
  check('pure chart input sorts/deduplicates observations and never converts null candles into zero', () => {
    const points = w.KDChart.preparePoints([{ t: 3, v: null }, { t: 2, v: 0.2 }, { t: 1, v: 0.1 }, { t: 2, v: 0.3 }, { t: 4, v: '' }]);
    assert.equal(JSON.stringify(points.map((p) => [p.t, p.v])), '[[1,0.1],[2,0.3]]');
  });
  check('exact 10-cent jumps in BOTH directions survive floating point boundaries', () => {
    const events = w.KDChart.jumps([{ t: 1, v: 0.4 }, { t: 2, v: 0.5 }, { t: 3, v: 0.4 }], 0.1);
    assert.equal(events.length, 2); assert.equal(events[1].delta, -0.1);
  });
  check('equity chart supports negative losses and P&L above $1 without binary-price clamping', () => {
    const canvas = w.document.querySelector('#price-chart');
    w.KDChart.line(canvas, [{ t: NOW / 1000 - 2, v: -20 }, { t: NOW / 1000, v: 30 }], { binary: false, zoom: true, windowSeconds: 60 });
    assert.ok(offline.labels.some((s) => /^-\$/.test(s)));
    assert.ok(offline.labels.some((s) => /^\$(?:[2-9]\d|1\d\d)\./.test(s)));
    w.KDChart.line(canvas, [], {});
    assert.equal(canvas.onmousemove, null); assert.equal(canvas.onclick, null);
  });
  offline.setLive(true);
  offline.intervals.find((i) => i.ms === 60000).fn();
  await pause(); await pause();
  check('offline data access recovers automatically without asking the trader to reload', () => assert.equal(w.KD.state.mode, 'live'));
  check('offline canonical market renderer has no unexpected script errors', () => assert.deepEqual(offline.errors, []));
} finally { offline.dom.window.close(); }

const online = await boot('market', true);
try {
  const { w, requests, intervals } = online;
  // Discovery and quote reads may complete in either order; exercise the quote path explicitly.
  await w.KD.pollPrices();
  check('live market normalization does not coerce unconfirmed numeric fields into zero', () => {
    const norm = w.KD.normMarket({ ...raw, yes_bid_dollars: null, yes_ask_dollars: '' }, 'crypto', BASE + '/markets/FIXTURE', 'TESTSERIES', []);
    assert.equal(norm.yes_bid_dollars, null); assert.equal(norm.yes_ask_dollars, null); assert.equal(norm.no_ask_dollars, 0.4);
  });
  check('live market poll source links retain the EXACT query, not a placeholder ellipsis', () => {
    assert.equal(w.KD.state.markets.FIXTURE.source_url, BASE + '/markets?tickers=FIXTURE');
    assert.equal(w.KD.state.markets.FIXTURE.data_mode, 'live');
  });
  check('snapshot-to-live handoff establishes a baseline instead of announcing an old snapshot as a sudden swing', () => assert.equal(w.KD.state.alerts.filter((a) => !a.replay).length, 0));
  check('historical live chart requests use documented one-minute candles and Unix seconds', () => {
    const u = new URL(requests.find((u) => u.includes('/candlesticks?')));
    assert.equal(u.searchParams.get('period_interval'), '1');
    assert.ok(Number(u.searchParams.get('end_ts')) < 1e11);
  });
  check('gold jump observations have an official source and leave causation unverified', () => {
    const rows = [...w.document.querySelectorAll('#price-events tr')];
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => /cause unverified/.test(r.textContent)));
    assert.ok(rows.every((r) => r.querySelector('a[href^="' + BASE + '"]')));
    assert.ok(w.document.querySelector('#price-chart').onclick);
  });
  check('manual NO entry is at ask with confirmed complementary quantity, and persists its evidence', () => {
    w.document.querySelector('#t-side').value = 'no'; w.document.querySelector('#t-qty').value = '5';
    w.document.querySelector('#trade-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    const t = w.KD.getTrades()[0];
    assert.equal(t.price, 0.4); assert.equal(t.quote.available, 12); assert.equal(t.execution_model, w.KDPaper.VERSION);
    assert.match(t.quote.size_field, /yes_bid_size_fp/);
  });
  check('a second paper order cannot reuse already-consumed quantity from the same observation', () => {
    w.document.querySelector('#t-qty').value = '8';
    w.document.querySelector('#trade-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(w.KD.getTrades().length, 1);
    assert.match(w.document.querySelector('#trade-msg').textContent, /Not enough/);
  });
  check('closed and absent open-position markets remain polled until finalization', () => {
    w.KD.state.markets.FIXTURE.status = 'closed';
    assert.ok(w.KD.trackedTickers().includes('FIXTURE'));
    w.KD.setTrades([...w.KD.getTrades(), { ticker: 'STORED-ONLY', status: 'open' }]);
    assert.ok(w.KD.trackedTickers().includes('STORED-ONLY'));
  });
  check('provisional result is not realized; final result settles once at the official payout', () => {
    const m = w.KD.state.markets.FIXTURE;
    m.status = 'determined'; m.result = 'yes'; w.KD.paper.settle();
    assert.equal(w.KD.getTrades()[0].status, 'open');
    m.status = 'finalized'; w.KD.paper.settle(); w.KD.paper.settle();
    assert.equal(w.KD.getTrades()[0].pnl, -2); assert.equal(w.KD.getTrades()[0].status, 'settled');
    assert.equal(w.KD.getTrades()[0].settled_ts, null);
  });
  check('automated strategies execute without user entry only when a fresh ask and whole size exist', () => {
    const m = w.KD.state.markets.FIXTURE;
    m.status = 'active'; m.result = ''; m.last_price_dollars = 0.9;
    w.KD.state.history.FIXTURE = [{ t: NOW / 1000 - 10, v: 0.7 }, { t: NOW / 1000 - 5, v: 0.8 }];
    w.KD.state.quoteUsed = {}; w.KD.setTrades([]);
    w.KD.saveSettings({ autoTrade: true, contracts: 10, strategies: { momentum: false, 'mean-reversion': true, favorite: false, longshot: false, catalyst: false } });
    w.KD.paper.step(); assert.equal(w.KD.getTrades().length, 1); assert.equal(w.KD.getTrades()[0].side, 'no');
    w.KD.setTrades([]); m.data_mode = 'snapshot'; w.KD.paper.step(); assert.equal(w.KD.getTrades().length, 0);
  });
  check('book rows carry an exact source, quantities, and timestamped provenance', () => {
    assert.ok(w.document.querySelector('#book-body a[href*="/orderbook?depth=20"]'));
    assert.match(w.document.querySelector('#book-total').textContent, /API book observed/);
  });
  online.setMarket({ last_price_dollars: null });
  intervals.find((i) => i.ms === 600000).fn();
  await pause(); await pause();
  check('missing discovery prices remain blank, never copied from an older observation', () => assert.equal(w.KD.state.markets.FIXTURE.last_price_dollars, null));
  check('browser score measures the last interval and cannot rank empty/missing touches as eligible', () => {
    const m = { ...w.KD.state.markets.FIXTURE, status: 'active', last_price_dollars: 0.5 };
    w.KD.state.history.FIXTURE = [{ t: NOW / 1000 - 5, v: 0.4 }, { t: NOW / 1000, v: 0.5 }];
    assert.ok(w.KD.roi(m).parts.volatility > 0.33);
    assert.equal(w.KD.roi({ ...m, yes_bid_size_fp: null }).eligible, false);
    assert.equal(w.KD.roi({ ...m, yes_ask_dollars: null }).parts.tightness, 0);
    assert.ok(w.KD.roi({ ...m, yes_ask_dollars: null }).score <= 30);
  });
  check('market redraw and quote polling both run at five-second cadence', () => assert.ok(intervals.filter((i) => i.ms === 5000).length >= 2));
  check('online canonical market renderer has no unexpected script errors', () => assert.deepEqual(online.errors, []));
} finally { online.dom.window.close(); }


const replay = await boot('dashboard', false, { snapshot: { ...snapshot, candlesticks: { FIXTURE: { m1: {
  source_url: BASE + '/series/TESTSERIES/markets/FIXTURE/candlesticks?period_interval=1',
  candles: [[NOW / 1000 - 3600, null], [NOW / 1000 - 3540, 0.2], [NOW / 1000 - 3480, 0.3], [NOW / 1000 - 3420, 0.2]],
} } } } });
try {
  check('snapshot replay skips missing closes and retains exact 10-cent changes in both directions', () => {
    const alerts = replay.w.KD.state.alerts;
    assert.equal(alerts.length, 2);
    assert.ok(alerts.every((a) => a.from > 0 && a.to > 0 && a.roi === null));
    assert.match(replay.w.document.querySelector('#chat-all .log').textContent, /snapshot replay/);
    assert.ok(!replay.w.document.querySelector('#chat-roi .log .msg'));
  });
  check('browser ranking rows have an official API link, not just an internal market link', () => {
    const rows = [...replay.w.document.querySelectorAll('#roi-table tr')];
    assert.ok(rows.length > 0 && rows.every((r) => r.querySelector('a[href^="' + BASE + '"]')));
  });
  check('canonical dashboard has no unexpected script errors', () => assert.deepEqual(replay.errors, []));
} finally { replay.dom.window.close(); }

for (const page of ['portfolio', 'analysis']) {
  const view = await boot(page, false);
  try {
    view.w.KD.setTrades([{ ticker: 'LEGACY', title: 'UNVERIFIED TEST LEGACY', side: 'no', qty: 10, price: 0.1, status: 'settled', pnl: 999, topic: 'crypto' }]);
    view.w.KD.emit('trades');
    check(page + ': legacy history is kept visibly, never counted as verified model profit', () => {
      assert.match(view.w.document.body.textContent, /legacy\s*\/\s*unverified/i);
      assert.equal(view.w.KD.portfolioStats(view.w.KD.getTrades()).realized, 0);
      assert.equal(view.w.KD.portfolioStats(view.w.KD.getTrades()).excluded, 1);
    });
    check(page + ': no unexpected script errors', () => assert.deepEqual(view.errors, []));
  } finally { view.dom.window.close(); }
}
console.log(`\ncanonical chart + paper UI: ${checks} regression cases passed (offline, synthetic fixtures only).`);
