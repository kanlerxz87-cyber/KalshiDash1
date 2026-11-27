#!/usr/bin/env node
/**
 * check-console-chart.mjs — offline regression gate for F-CHART-02.
 *
 * THE DEFECT THIS PINS DOWN (measured 2026-11-27). The alert console's chart offered 5-minute
 * and 1-hour windows but was fed only by `feed.history` (one point per engine run) and by
 * samples the visitor's tab recorded. In the committed feed `data/live/feed.json`
 * (meta.generated_at 2026-11-27T17:34:38Z) NONE of the 25 highest-dollar chart candidates had
 * two points inside either window, so two of the five advertised windows could never draw a
 * line. The engine's declared every-10-minutes cron is delivered far less often than declared
 * (F-83). The exchange, however, publishes exactly the missing resolution:
 *
 *   GET /series/{series_ticker}/markets/{ticker}/candlesticks?start_ts=&end_ts=&period_interval=
 *   https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *
 *   * period_interval is restricted by the official schema to 1, 60 or 1440 minutes;
 *   * one request spans at most 5,000 periods, otherwise 400 bad_request;
 *   * start_ts / end_ts are Unix SECONDS (milliseconds are rejected);
 *   * price.close_dollars is the last TRADED YES price in the period and is null when nothing
 *     traded — so a null must be skipped, never filled.
 *
 * WHAT THIS GATE ASSERTS. Every check runs in jsdom against the real, unmodified
 * alerts/js/alerts-live.js with a mocked official API, so it is deterministic and offline:
 *
 *   A. the five brief granularities (seconds … days) are offered by the page;
 *   B. the candlestick request uses the documented interval for each window and never exceeds
 *      the documented 5,000-period cap;
 *   C. a null traded close is skipped and an out-of-range price is rejected — no value is ever
 *      invented;
 *   D. official traded closes and recorded samples merge, de-duplicate, and the official print
 *      wins on a timestamp collision;
 *   E. a failed request leaves an honest error and an empty series, not a fabricated one;
 *   F. POSITIVE CONTROL: an official 1-minute series fills the 5-minute and 1-hour windows that
 *      the feed alone could not (this is the defect);
 *   G. NEGATIVE CONTROL: with the candlestick request blocked, a 1-hour window still shows
 *      fewer than two points — proving check F is caused by the official data, not by the test.
 *
 * Run: node scripts/check-console-chart.mjs
 */
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
const failures = [];
let passes = 0;
const check = (cond, msg) => {
  if (cond) { passes += 1; return; }
  failures.push(msg);
};

const html = await readFile('alerts/index.html', 'utf8');
const liveSrc = await readFile('alerts/js/alerts-live.js', 'utf8');

/* ------------------------------------------------------------------ harness */

/**
 * Boot alerts-live.js in jsdom with a mocked demo API.
 * `candles` maps "ticker|interval" to a payload, or to the string 'FAIL' to simulate an error.
 */
function boot(candles) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(html, {
    url: 'https://kanlerxz87-cyber.github.io/KalshiDash1/alerts/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  const requestedCandles = [];
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('data/live/feed.json')) {
      return { ok: true, status: 200, json: async () => ({ meta: { generated_at: new Date().toISOString() }, alerts: [], markets: [], history: {} }) };
    }
    if (u.startsWith(BASE)) {
      const path = u.slice(BASE.length);
      const m = path.match(/^\/series\/([^/]+)\/markets\/([^/]+)\/candlesticks\?/);
      if (m) {
        requestedCandles.push({ ticker: decodeURIComponent(m[2]), path, url: u });
        const q = new URLSearchParams(path.split('?')[1]);
        const key = decodeURIComponent(m[2]) + '|' + q.get('period_interval');
        const payload = candles[key];
        if (payload === 'FAIL') return { ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' };
        const body = payload || { ticker: decodeURIComponent(m[2]), candlesticks: [] };
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
      }
      launchSeries(path);
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  };
  window.AbortController = window.AbortController || class { constructor() { this.signal = null; } abort() {} };
  window.eval(liveSrc);
  return { dom, window, requestedCandles, errors };
}

/* A live-poll response is irrelevant to this gate; answer the documented shapes emptily. */
function launchSeries() { /* no-op: every series query returns 404 above, which pollLive tolerates */ }

/* A market row exactly as the engine/browser stores it (series_ticker is what the candle
 * endpoint needs for its path). */
function seedMarket(window, row) {
  const AL = window.AL;
  AL.state.live.markets[row.ticker] = Object.assign({
    ticker: row.ticker, series_ticker: row.series_ticker, topic: 'crypto', title: row.ticker,
    status: 'active', result: '', price: 0.5, source_url: BASE + '/markets?series_ticker=' + row.series_ticker
  }, row);
}

/* Official candle payload builder. close=null models a period with no trade. */
function candlePayload(ticker, points) {
  return {
    ticker,
    candlesticks: points.map(([t, close]) => ({
      end_period_ts: t,
      price: { open_dollars: null, high_dollars: close === null ? null : String(close), low_dollars: null,
        close_dollars: close === null ? null : String(close), mean_dollars: null, previous_dollars: null }
    }))
  };
}

/* ------------------------------------------------------------------ A. windows */

const domA = boot({});
const htmlButtons = [...domA.window.document.querySelectorAll('#chart-window-btns button')].map((b) => b.textContent.trim());
const liveSrcStatic = liveSrc;
/* The buttons are built by alerts-page.js, which this gate does not load (it needs a full
 * page render). Assert the declarations in the source instead, and assert the page's script
 * really is the one that renders them. */
check(/id="chart-window-btns"/.test(html), 'A1: the page carries the chart window control');
const pageSrc = await readFile('alerts/js/alerts-page.js', 'utf8');
const defs = [...pageSrc.matchAll(/\{ s: (\d+), l: '([^']+)'/g)].map((m) => ({ s: Number(m[1]), label: m[2] }));
const secs = defs.map((d) => d.s);
check(secs.length >= 5, 'A2: at least five selectable windows are offered, got ' + secs.length);
check(secs.includes(60), 'A3: a seconds-granularity window (60 s) is offered — brief asks for seconds');
check(secs.includes(300) && secs.includes(900), 'A4: minute-granularity windows are offered (5 min, 15 min)');
check(secs.includes(3600) && secs.includes(21600) && secs.includes(86400), 'A5: hour-granularity windows are offered (1 h, 6 h, 24 h)');
check(secs.includes(604800), 'A6: a multi-day window is offered (7 d)');
domA.window.close();

/* ------------------------------------------------------------------ B. request contract */

const nowSec = Math.floor(Date.now() / 1000);
const intervalCases = [
  { window: 60, interval: 1 }, { window: 300, interval: 1 }, { window: 900, interval: 1 },
  { window: 3600, interval: 1 }, { window: 21600, interval: 1 }, { window: 86400, interval: 1 },
  { window: 604800, interval: 60 }
];
for (const c of intervalCases) {
  const d = boot({});
  const got = d.window.AL.candleIntervalFor(c.window);
  check(got === c.interval, `B1: ${c.window}s window must request the documented period_interval ${c.interval}, got ${got}`);
  check([1, 60, 1440].includes(got), `B2: period_interval ${got} must be one of the official enum values (1, 60, 1440)`);
  d.window.close();
}

/* Every request must stay inside the documented 5,000-period cap and send seconds. */
{
  const payloadFor = (ticker, n) => candlePayload(ticker, Array.from({ length: n }, (_, i) => [nowSec - (n - i) * 60, 0.5]));
  const d = boot({ 'KXT-1|1': payloadFor('KXT-1', 5), 'KXT-1|60': payloadFor('KXT-1', 5) });
  seedMarket(d.window, { ticker: 'KXT-1', series_ticker: 'KXS' });
  for (const w of [60, 300, 3600, 86400, 604800]) {
    d.window.AL.state.live.candles = {};
    d.window.AL.fetchCandles('KXT-1', w, { force: true });
  }
  d.window.AL.state.live.candles = {};
  const p = d.window.AL.fetchCandles('KXT-1', 604800, { force: true });
  await p;
  const req = d.requestedCandles[d.requestedCandles.length - 1];
  check(!!req, 'B3: a 7-day window must issue a candlestick request');
  if (req) {
    const q = new URLSearchParams(req.path.split('?')[1]);
    const start = Number(q.get('start_ts'));
    const end = Number(q.get('end_ts'));
    const interval = Number(q.get('period_interval'));
    check(Number.isInteger(start) && Number.isInteger(end), 'B4: start_ts/end_ts must be integer Unix seconds');
    check(!String(q.get('start_ts')).match(/\d{13}$/), 'B5: timestamps must not be milliseconds (documented 400)');
    check(end > start, 'B6: end_ts must be after start_ts');
    check((end - start) / 60 / interval <= 5000,
      `B7: request spans ${Math.round((end - start) / 60 / interval)} periods, over the documented 5,000 cap`);
    check(req.path.includes('/series/KXS/markets/KXT-1/candlesticks'),
      'B8: the request must use the documented /series/{series}/markets/{ticker}/candlesticks path');
  }
  d.window.close();
}

/* ------------------------------------------------------------------ C. no invented prices */

{
  const pts = [
    [nowSec - 240, 0.40],
    [nowSec - 180, null],          // no trade in this period -> must be skipped
    [nowSec - 120, 0.52],
    [nowSec - 60, 1.40]            // impossible for a binary contract -> must be rejected
  ];
  const d = boot({ 'KXGAP-1|1': candlePayload('KXGAP-1', pts) });
  seedMarket(d.window, { ticker: 'KXGAP-1', series_ticker: 'KXGAP' });
  await d.window.AL.fetchCandles('KXGAP-1', 300, { force: true });
  const entry = d.window.AL.candles('KXGAP-1');
  check(entry && Array.isArray(entry.points), 'C1: the candlestick payload must cache a points array');
  const values = (entry.points || []).map((p) => p.p);
  check(values.length === 2, `C2: a null traded close and an out-of-range price must be dropped, kept ${values.length}`);
  check(values.includes(0.4) && values.includes(0.52), 'C3: the two real traded closes are kept verbatim');
  check(!values.some((v) => v > 1 || v < 0), 'C4: no price outside the $0–$1 binary range is ever plotted');
  check(values.every((v) => v !== 0.46), 'C5: a null close must never be filled with an interpolated midpoint');
  check(entry.points.every((p) => p.t % 1 === 0), 'C6: points carry integer epoch seconds');
  d.window.close();
}

/* ------------------------------------------------------------------ D. merge + dedupe */

{
  const t1 = nowSec - 300, t2 = nowSec - 120;
  const d = boot({ 'KXM-1|1': candlePayload('KXM-1', [[t1, 0.60], [t2, 0.70]]) });
  seedMarket(d.window, { ticker: 'KXM-1', series_ticker: 'KXM' });
  await d.window.AL.fetchCandles('KXM-1', 3600, { force: true });
  /* The engine feed and this tab are cheaper, non-official observations. */
  d.window.AL.state.live.history['KXM-1'] = [[t2, 0.66], [nowSec - 60, 0.72]];
  const series = d.window.AL.chartSeries('KXM-1', 3600, nowSec);
  check(series.points.length === 3, `D1: official closes and samples merge without duplicates, got ${series.points.length}`);
  check(series.official === 2, `D2: exactly the two official prints are labelled official, got ${series.official}`);
  const atT2 = series.points.find((p) => p.t === t2);
  check(atT2 && atT2.p === 0.70 && atT2.official === true,
    'D3: on a timestamp collision the official traded close wins over the sampled price');
  check(series.points.every((p, i, a) => i === 0 || a[i - 1].t < p.t), 'D4: points are strictly ordered by time');
  check(series.basis && /official 1-minute traded close/.test(series.basis), 'D5: the series names its official basis');
  check(series.source_url && series.source_url.startsWith(BASE + '/series/KXM/markets/KXM-1/candlesticks'),
    'D6: the series keeps the exact official request URL for provenance');
  d.window.close();
}

/* ------------------------------------------------------------------ E. honest failure */

{
  const d = boot({ 'KXFAIL-1|1': 'FAIL' });
  seedMarket(d.window, { ticker: 'KXFAIL-1', series_ticker: 'KXFAIL' });
  await d.window.AL.fetchCandles('KXFAIL-1', 3600, { force: true });
  const series = d.window.AL.chartSeries('KXFAIL-1', 3600, nowSec);
  check(!!series.error, 'E1: a failed candlestick request must be reported, not swallowed');
  check(series.points.length === 0, 'E2: a failed request must not produce a fabricated point');
  check(series.official === 0, 'E3: a failed request must not be labelled official data');
  d.window.close();
}

/* ------------------------------------------------------------------ F/G. controls */

/* The committed feed's own history for the 25 highest-dollar candidates: one point per engine
 * run, nothing near the last hour. Reproduce that shape and prove the official series is what
 * makes the short windows renderable. */
const feedNow = nowSec;
const feedHistory = {};   // one sample per engine run, ~10 h apart, as F-83 delivers it
for (const tk of ['KXBTCY-27JAN0100-B97500', 'KXPRESNOMD-28-GPLA', 'KXETHY-27JAN0100-B4999.99']) {
  feedHistory[tk] = [[feedNow - 36000, 0.50], [feedNow - 25200, 0.50]];
}

async function shortWindowPoints(blockCandles) {
  const d = boot(blockCandles
    ? {}
    : { 'KXBTCY-27JAN0100-B97500|1': candlePayload('KXBTCY-27JAN0100-B97500',
      Array.from({ length: 60 }, (_, i) => [feedNow - (60 - i) * 60, 0.50 + (i % 5) * 0.01])) });
  const AL = d.window.AL;
  AL.state.feed = { meta: {}, alerts: [], markets: [], history: feedHistory };
  seedMarket(d.window, { ticker: 'KXBTCY-27JAN0100-B97500', series_ticker: 'KXBTCY' });
  if (!blockCandles) await AL.fetchCandles('KXBTCY-27JAN0100-B97500', 300, { force: true });
  const fiveMin = AL.chartSeries('KXBTCY-27JAN0100-B97500', 300, feedNow).points.length;
  const oneHour = AL.chartSeries('KXBTCY-27JAN0100-B97500', 3600, feedNow).points.length;
  d.window.close();
  return { fiveMin, oneHour };
}

const withoutCandles = await shortWindowPoints(true);
check(withoutCandles.fiveMin < 2 && withoutCandles.oneHour < 2,
  `G1 NEGATIVE CONTROL: feed history alone must leave the 5-min/1-hour windows empty `
  + `(got ${withoutCandles.fiveMin}/${withoutCandles.oneHour}) — proves F below is the official data`);

const withCandles = await shortWindowPoints(false);
check(withCandles.fiveMin >= 2,
  `F1: official 1-minute candles must fill the 5-minute window (got ${withCandles.fiveMin} points)`);
check(withCandles.oneHour >= 2,
  `F2: official 1-minute candles must fill the 1-hour window (got ${withCandles.oneHour} points)`);

/* ------------------------------------------------------------------ page wiring */

check(/A\.fetchCandles\(/.test(pageSrc), 'H1: the console chart must request official candles when drawing');
check(/A\.chartSeries\(/.test(pageSrc), 'H2: the console chart must draw from the shared merged series');
check(/chart-note/.test(pageSrc) && /official traded close/.test(pageSrc),
  'H3: the chart caption must state how many points are official traded closes');
check(/candlestick request failed/.test(pageSrc), 'H4: a failed candlestick request must be named on the page');
check(/get-market-candlesticks/.test(html), 'H5: the page must link the official candlestick documentation');
check(/F-CHART-02/.test(html), 'H6: the page must cite the finding it fixes');
check(/export/.test('') === false && /function fetchCandles/.test(liveSrcStatic), 'H7: the fetch lives in the data layer');
/* The suggestions board must not still describe the candle chart as unimplemented. The page's
 * own preamble says "Nothing here is implemented yet unless it says so", so S-05 has to say so. */
check(/Candle-based chart for every window[\s\S]{0,200}Implemented 2026-11-27/.test(html),
  'H8: suggestion S-05 must be marked implemented now that the chart sources official candles');

/* ------------------------------------------------------------------ report */

if (failures.length) {
  console.error(`\ncheck-console-chart FAILED — ${failures.length} assertion(s):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`check-console-chart: ${passes} checks passed (F-CHART-02 console chart, offline).`);
