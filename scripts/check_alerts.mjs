#!/usr/bin/env node
/**
 * check_alerts.mjs — validates the alert engine output before it is published.
 *
 * These are the invariants the "no hallucinations" rule depends on, so they are enforced
 * mechanically rather than by inspection:
 *
 *  1. data/live/feed.json is valid JSON with the expected top-level shape.
 *  2. Every alert has: a ticker, a timestamp, a direction in {up,down}, |delta| >= 0.10,
 *     from/to values that actually match that delta, and a source_url pointing at the
 *     official demo API.
 *  3. No invented numbers: a price of null is allowed (unknown), but a price that is present
 *     must be within [0,1] for a binary contract.
 *  4. Every market row keeps its source_url.
 *  5. Every resolution has result in {yes,no,scalar} and a source_url.
 *  6. The high-ROI flag is consistent with the model score and the threshold.
 *  7. Every sample timestamp is a real ISO date in the past.
 *
 * Exit code 1 on any violation, so a bad sample can never be committed.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FEED = process.env.ALERTS_FEED || 'data/live/feed.json';
const OFFICIAL_HOSTS = ['external-api.demo.kalshi.co', 'demo-api.kalshi.co'];
const THRESHOLD = 0.10;
const EPS = 1e-9;

const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

function checkOfficialUrl(url, where) {
  if (!url) { fail(`${where}: missing source_url`); return; }
  let u;
  try { u = new URL(url); } catch (e) { fail(`${where}: source_url is not a URL: ${url}`); return; }
  if (!OFFICIAL_HOSTS.includes(u.hostname)) {
    fail(`${where}: source_url host "${u.hostname}" is not an official Kalshi demo host`);
  }
  if (!u.pathname.startsWith('/trade-api/v2')) {
    fail(`${where}: source_url is not under /trade-api/v2: ${url}`);
  }
}

function checkPrice(v, where) {
  if (v === null || v === undefined) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) { fail(`${where}: price is not a finite number (${v})`); return; }
  if (v < 0 || v > 1) fail(`${where}: binary price outside [0,1]: ${v}`);
}

async function main() {
  if (!existsSync(FEED)) {
    console.error(`No feed at ${FEED}. The engine has not run yet — nothing to validate.`);
    // An absent feed is not a broken site; it means "no sample yet". Say so and pass.
    process.exit(0);
  }

  const raw = await readFile(FEED, 'utf8');
  let feed;
  try {
    feed = JSON.parse(raw);
  } catch (e) {
    console.error(`FAIL: ${FEED} is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  // 1. shape
  for (const k of ['meta', 'alerts', 'resolutions', 'markets']) {
    if (!(k in feed)) fail(`feed: missing top-level "${k}"`);
  }
  if (!Array.isArray(feed.alerts)) fail('feed.alerts is not an array');
  if (!Array.isArray(feed.resolutions)) fail('feed.resolutions is not an array');
  if (feed.markets && !Array.isArray(feed.markets)) fail('feed.markets is not an array');

  if (feed.meta) {
    if (feed.meta.threshold !== THRESHOLD) fail(`meta.threshold is ${feed.meta.threshold}, expected ${THRESHOLD}`);
    const gen = Date.parse(feed.meta.generated_at);
    if (!Number.isFinite(gen)) fail('meta.generated_at is not a date');
    else if (gen > Date.now() + 120000) fail('meta.generated_at is in the future');
  }

  // 2-3. alerts
  const ids = new Set();
  let maxDelta = 0;
  for (const a of feed.alerts || []) {
    const w = `alert ${a.id || a.ticker || '?'}`;
    if (!a.ticker) fail(`${w}: no ticker`);
    if (!a.id) fail(`${w}: no id`);
    if (a.id && ids.has(a.id)) fail(`${w}: duplicate id`);
    ids.add(a.id);

    const ts = Date.parse(a.ts);
    if (!Number.isFinite(ts)) fail(`${w}: ts is not a date (${a.ts})`);
    else if (ts > Date.now() + 120000) fail(`${w}: ts is in the future`);

    if (a.direction !== 'up' && a.direction !== 'down') fail(`${w}: direction is "${a.direction}"`);
    const absDelta = a.abs_delta;
    if (typeof absDelta !== 'number' || !Number.isFinite(absDelta)) {
      fail(`${w}: abs_delta is not a number`);
    } else {
      if (absDelta + EPS < THRESHOLD) fail(`${w}: |delta| ${absDelta} is below the $0.10 threshold`);
      maxDelta = Math.max(maxDelta, absDelta);
    }

    checkPrice(a.from, `${w}.from`);
    checkPrice(a.to, `${w}.to`);
    if (typeof a.from === 'number' && typeof a.to === 'number') {
      const implied = Math.round((a.to - a.from) * 10000) / 10000;
      if (typeof a.delta === 'number' && Math.abs(implied - a.delta) > 1e-6) {
        fail(`${w}: delta ${a.delta} does not match to-from (${implied})`);
      }
      if (a.direction === 'up' && a.to < a.from) fail(`${w}: direction up but price fell`);
      if (a.direction === 'down' && a.to > a.from) fail(`${w}: direction down but price rose`);
    }

    checkOfficialUrl(a.source_url, w);

    // 6. model consistency
    if (a.model) {
      const s = a.model.score;
      if (s !== null) {
        if (typeof s !== 'number' || s < 0 || s > 1) fail(`${w}: model.score outside [0,1]: ${s}`);
        const expectHigh = s >= (feed.meta?.high_roi_threshold ?? 0.62);
        if (a.model.highROI !== expectHigh) {
          fail(`${w}: model.highROI=${a.model.highROI} but score ${s} vs threshold ${feed.meta?.high_roi_threshold}`);
        }
      } else if (a.model.highROI) {
        fail(`${w}: highROI is true with no score`);
      }
    } else {
      warn(`${w}: no model block (row will not reach the high-ROI feed)`);
    }
  }

  // 4. markets
  for (const m of feed.markets || []) {
    const w = `market ${m.ticker || '?'}`;
    if (!m.ticker) fail(`${w}: no ticker`);
    checkPrice(m.price, `${w}.price`);
    checkOfficialUrl(m.source_url, w);
    if (m.est_traded_dollars !== null && m.est_traded_dollars !== undefined) {
      if (typeof m.est_traded_dollars !== 'number' || m.est_traded_dollars < 0) {
        fail(`${w}: est_traded_dollars must be a non-negative number or null`);
      }
    }
  }

  // 5. resolutions
  for (const r of feed.resolutions || []) {
    const w = `resolution ${r.ticker || '?'}`;
    if (!r.ticker) fail(`${w}: no ticker`);
    if (!['yes', 'no', 'scalar'].includes(r.result)) fail(`${w}: result "${r.result}" is not yes/no/scalar`);
    checkOfficialUrl(r.source_url, w);
  }

  // 7. orderbooks (when present)
  const obs = (feed.orderbooks) || {};
  for (const [ticker, ob] of Object.entries(obs)) {
    const w = `orderbook ${ticker}`;
    checkOfficialUrl(ob.source_url, w);
    for (const side of ['yes_bids', 'no_bids']) {
      const levels = ob[side] || [];
      for (let i = 1; i < levels.length; i++) {
        if (levels[i].price < levels[i - 1].price) {
          fail(`${w}.${side}: levels are not in ascending price order (documented contract)`);
          break;
        }
      }
      for (const l of levels) {
        checkPrice(l.price, `${w}.${side} level price`);
        if (typeof l.count !== 'number' || l.count < 0) fail(`${w}.${side}: level count must be a non-negative number`);
      }
    }
    // implied ask must be the documented derivation: $1 - best opposite bid
    if (ob.best_no_bid !== null && ob.implied_yes_ask !== null && ob.implied_yes_ask !== undefined) {
      const expect = Math.round((1 - ob.best_no_bid) * 10000) / 10000;
      if (Math.abs(expect - ob.implied_yes_ask) > 1e-6) {
        fail(`${w}: implied_yes_ask ${ob.implied_yes_ask} != 1 - best_no_bid (${expect})`);
      }
    }
  }

  // report
  const nA = (feed.alerts || []).length;
  const nR = (feed.resolutions || []).length;
  const nM = (feed.markets || []).length;
  const nH = (feed.alerts || []).filter((a) => a.model && a.model.highROI).length;
  console.log(`feed: ${nA} alerts (${nH} high-ROI), ${nR} resolutions, ${nM} market rows, ${Object.keys(obs).length} orderbooks`);
  if (nA) console.log(`largest recorded move: $${maxDelta.toFixed(2)}`);

  /* Chat readability guard. This MUST run before the exit check below: in the first version
   * it was appended after `process.exit(1)`, so its finding was recorded in `problems` and
   * never read — a dead check that printed "OK" on a flooded feed (flagged as F-63).
   *
   * The invariant comes from the engine's own dedupe window: collapseDuplicates keeps at most
   * one alert per ticker per 15 minutes, so a healthy feed can hold at most 4 alerts from one
   * contract in any rolling hour (5 with boundary skew). More than that means the detector
   * re-published the same flapping contract, which is what made the live chat unreadable on
   * 2026-11-20 (99 of 99 rows from KXPRESNOMD-28-AKLO). Threshold: 6/hour — one row of slack
   * above the theoretical maximum, still far below the 37/hour measured on the broken feed.
   */
  {
    const MAX_PER_HOUR = 6;
    const byTicker = {};
    for (const a of feed.alerts || []) {
      const ts = Date.parse(a.ts) || 0;
      (byTicker[a.ticker] = byTicker[a.ticker] || []).push(ts);
    }
    for (const [ticker, times] of Object.entries(byTicker)) {
      times.sort((x, y) => x - y);
      for (let i = 0; i < times.length; i++) {
        let n = 0;
        for (let j = i; j < times.length && times[j] - times[i] < 3600000; j++) n++;
        if (n > MAX_PER_HOUR) {
          fail(`chat readability: ${ticker} has ${n} alerts inside one rolling hour `
            + `(limit ${MAX_PER_HOUR}); collapseDuplicates should keep at most one per 15 min`);
          break;
        }
      }
    }
    // Dominance is reported, not fatal: with a two-contract demo feed a legitimate market can
    // own most rows. The per-hour cap above is the enforceable invariant.
    const worst = Object.entries(byTicker)
      .map(([t, ts]) => [t, ts.length])
      .sort((x, y) => y[1] - x[1])[0];
    if ((feed.alerts || []).length >= 10 && worst && worst[1] > (feed.alerts || []).length / 2) {
      warn(`chat readability: ${worst[1]} of ${(feed.alerts || []).length} alerts come from one ticker (${worst[0]})`);
    }
  }

  for (const w of warnings) console.log(`warn: ${w}`);
  if (problems.length) {
    console.error(`\nFAILED — ${problems.length} violation(s):`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
  }

  console.log('OK: every alert, market, resolution and orderbook row passed the source and threshold checks.');

}

main().catch((e) => { console.error('checker crashed:', e); process.exit(1); });
