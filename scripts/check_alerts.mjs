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
 *  6. The high-ROI flag is consistent with the model score and the threshold, AND the swing it
 *     labels was executable at the recorded price according to the published bid/ask
 *     (followThrough gate, added 2026-11-21 after the pane was measured to be topped by
 *     unfillable $0.01 -> $0.97 prints).
 *  7. Every sample timestamp is a real ISO date in the past.
 *  8. F-90 (session-f7ba69d5, 2026-11-22): no published alert may cite
 *     `previous_price_dollars` as its corroborating evidence. The official spec defines that
 *     field as the last traded YES price **a day ago**
 *     (https://docs.kalshi.com/api-reference/market/get-market), so it is a day-over-day
 *     comparison, not a same-session observation, and it must never be presented as proof that
 *     an intraday print was real. The gate is mechanical because the wrong definition survived
 *     an earlier review in a source comment; a later edit cannot silently restore it.
 *
 * Exit code 1 on any violation, so a bad sample can never be committed.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { collapseDuplicates, followThrough, modelScore, MODEL_VERSION, HIGH_ROI_THRESHOLD } from '../tools/live_engine.mjs';

const FEED = process.env.ALERTS_FEED || 'data/live/feed.json';
const OFFICIAL_HOSTS = ['external-api.demo.kalshi.co', 'demo-api.kalshi.co'];
const THRESHOLD = 0.10;
const EPS = 1e-9;

const problems = [];
const unfillableHighROI = [];
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
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
      /* 6b. Follow-through. A high-ROI label on a swing that the published book says was not
       * reachable is the exact defect measured on 2026-11-21 (the pane was topped by
       * "$0.01 -> $0.97" rows whose YES ask was $0.01). This is now a hard failure, so such a
       * row can never be committed again. Rows already in the feed from before the fix are
       * reported as warnings with the count, and named in meta.legacy_unfillable_high_roi. */
      const ft = followThrough({ direction: a.direction, to: a.to, bid: num(a.yes_bid_dollars), ask: num(a.yes_ask_dollars) });
      if (a.model.tradeable !== undefined && a.model.tradeable !== null) {
        if ((a.model.tradeable === true) !== (ft.ok === true) && ft.ok !== null) {
          fail(`${w}: model.tradeable=${a.model.tradeable} disagrees with the published quote (${ft.note})`);
        }
      }
      if (a.model.highROI && ft.ok === false) {
        unfillableHighROI.push({ id: a.id, ticker: a.ticker, ts: a.ts, note: ft.note });
      }
    } else {
      warn(`${w}: no model block (row will not reach the high-ROI feed)`);
    }
  }

  // 6c. Every alert that can reach the high-ROI pane must have been executed at its price...
  for (const u of unfillableHighROI) {
    if (feed.meta?.model_version === MODEL_VERSION && !(feed.meta?.legacy_unfillable_high_roi || []).some((x) => x.id === u.id)) {
      fail(`alert ${u.id || u.ticker}: labelled high-ROI but NOT executable at the swing price (${u.note}). ` +
        'The model must cap these at 0.30 — see followThrough() in tools/live_engine.mjs.');
    } else {
      warn(`alert ${u.id || u.ticker}: historical high-ROI row not executable at its swing price (${u.note}); ` +
        'recorded in meta.legacy_unfillable_high_roi, not re-labelled.');
    }
  }
  /* ...and a legacy exemption list may only contain rows that really are unfillable, so it can
   * never be used to whitelist a row that a later run would have scored as tradeable. */
  for (const x of feed.meta?.legacy_unfillable_high_roi || []) {
    const row = (feed.alerts || []).find((a) => a.id === x.id);
    if (row) {
      const ft = followThrough({ direction: row.direction, to: row.to, bid: num(row.yes_bid_dollars), ask: num(row.yes_ask_dollars) });
      if (ft.ok !== false) fail(`meta.legacy_unfillable_high_roi lists ${x.id} but its book does corroborate the swing (${ft.note})`);
      if (row.model && row.model.highROI) fail(`meta.legacy_unfillable_high_roi lists ${x.id} but the row is still labelled highROI`);
    }
  }

  /* F-90: `previous_price_dollars` is the last traded YES price A DAY AGO per the official
   * schema, so it can never be published as corroboration of an intraday swing. The assertion is
   * mechanical: whichever code path writes `a.corroboration`, the value must be the live book.
   *
   * Alerts published BEFORE the fix keep their recorded evidence — recorded data is never
   * rewritten — but each one must be listed in `meta.legacy_day_old_corroboration` by
   * scripts/annotate-legacy-day-old-corroboration.mjs, which also records, per row, whether the
   * live book independently corroborates it. That keeps the published claim honest without
   * deleting history. */
  const DAY_OLD_EVIDENCE = /previous_price/i;
  const legacyDayOld = new Set((feed.meta?.legacy_day_old_corroboration || []).map((x) => x.id));
  for (const a of feed.alerts || []) {
    const c = a.corroboration;
    if (!c || typeof c.by !== 'string') continue;
    if (/book midpoint/.test(c.by)) continue;
    if (DAY_OLD_EVIDENCE.test(c.by)) {
      if (!legacyDayOld.has(a.id)) {
        fail(`alert ${a.id}: corroboration.by names "${c.by}", a day-old field (F-90) and the row is not `
          + 'in meta.legacy_day_old_corroboration — run scripts/annotate-legacy-day-old-corroboration.mjs');
      }
      continue;
    }
    fail(`alert ${a.id}: corroboration.by "${c.by}" is not a same-session book reading — F-90`);
  }
  /* The provenance list may not name a row that does not exist, and may not be used to excuse a
   * row whose evidence is in fact the book. */
  for (const x of feed.meta?.legacy_day_old_corroboration || []) {
    const row = (feed.alerts || []).find((a) => a.id === x.id);
    if (!row) { warn(`meta.legacy_day_old_corroboration lists ${x.id}, which is not in this feed`); continue; }
    if (!/previous_price/i.test(String(row.corroboration && row.corroboration.by))) {
      fail(`meta.legacy_day_old_corroboration lists ${x.id} but the row does not cite the day-old field`);
    }
    if (typeof x.book_also_corroborates !== 'boolean') {
      fail(`meta.legacy_day_old_corroboration entry ${x.id} must record book_also_corroborates (true/false)`);
    }
  }

  /* ...and the provenance list may not silently lose a row. The engine rebuilds the feed's `meta`
   * from `state.json` on every sample; the list was only ever written into `feed.json`, so the
   * next sample published an empty list while the re-scored rows still carried
   * `original_highROI` (measured 2026-11-21T23:18Z, F-79). */
  const legacyIds = new Set((feed.meta?.legacy_unfillable_high_roi || []).map((x) => x.id));
  for (const a of feed.alerts || []) {
    if (a.model && a.model.original_highROI === true && a.model.highROI !== true && !legacyIds.has(a.id)) {
      fail(`alert ${a.id}: carries model.original_highROI but is missing from meta.legacy_unfillable_high_roi — `
        + 'run scripts/annotate-legacy-unfillable.mjs data/live/feed.json data/live/state.json');
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

  const resolvedTickers = new Set((feed.resolutions || []).map((r) => r.ticker));

  // 6a. When the feed carries the awaiting list it must also be consistent with the alerts it
  // was derived from: the same rule the engine applies (alert tickers minus resolved tickers).
  if (feed.awaiting) {
    const expected = [...new Set((feed.alerts || []).map((a) => a.ticker))]
      .filter((t) => !resolvedTickers.has(t));
    const listed = new Set(feed.awaiting.map((a) => a.ticker));
    const missing = expected.filter((t) => !listed.has(t));
    // The engine caps the list (40 rows), so only a shortfall beyond that cap is a failure.
    if (missing.length > 0 && (feed.awaiting.length >= 40) === false) {
      fail(`awaiting: ${missing.length} alerted ticker(s) missing from the list, e.g. ${missing.slice(0, 3).join(', ')}`);
    }
  }

  // 6b. awaiting-resolution list (followed, not yet answered). Every row must be a real alert
  // ticker with a source, and must NOT already appear as resolved — otherwise the page would
  // claim something is pending after the exchange has answered it.
  for (const a of feed.awaiting || []) {
    const w = `awaiting ${a.ticker || '?'}`;
    if (!a.ticker) fail(`${w}: no ticker`);
    if (resolvedTickers.has(a.ticker)) fail(`${w}: already resolved, so it must not be listed as awaiting`);
    // Deliberately NOT asserted: that the ticker appears in feed.alerts. That list is capped at
    // the 200 newest rows by the engine, and a market can be alerted on, then settle, long before
    // this list is published, so absence proves nothing. The property that matters — never
    // presenting a resolved market as pending — is asserted above.
    checkOfficialUrl(a.source_url, w);
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

  // 8. chat readability / flap-suppression guard: no ticker may appear twice within 15 minutes
  {
    const byTicker = {};
    for (const a of feed.alerts || []) {
      if (!a.ticker || !a.ts) continue;
      (byTicker[a.ticker] = byTicker[a.ticker] || []).push(Date.parse(a.ts));
    }
    for (const [ticker, times] of Object.entries(byTicker)) {
      times.sort((x, y) => x - y);
      for (let i = 1; i < times.length; i++) {
        if (times[i] - times[i - 1] <= 15 * 60 * 1000) {
          fail(`chat readability: ${ticker} has two alerts ${Math.round((times[i] - times[i - 1]) / 1000)}s apart (must be > 15 min)`);
          break;
        }
      }
    }
  }

  // report
  const nA = (feed.alerts || []).length;
  const nR = (feed.resolutions || []).length;
  const nM = (feed.markets || []).length;
  const nW = (feed.awaiting || []).length;
  const nH = (feed.alerts || []).filter((a) => a.model && a.model.highROI).length;
  console.log(`feed: ${nA} alerts (${nH} high-ROI), ${nR} resolutions, ${nW} awaiting resolution, ${nM} market rows, ${Object.keys(obs).length} orderbooks`);
  if (nA) console.log(`largest recorded move: $${maxDelta.toFixed(2)}`);

  for (const w of warnings) console.log(`warn: ${w}`);

  /* Chat-readability invariant. A concentration threshold is not an integrity test: a real
   * market can produce most of the recorded moves. Instead, compare the published rows with the
   * engine's direction-independent, per-ticker deduplication rule. If another application of
   * that rule would remove a row, the feed still contains a flap/cross-detector duplicate.
   * This directly covers the 2026-11-20 $0.80 <-> $0.00 one-ticker flood without suppressing
   * distinct swings more than the documented deduplication windows apart. */
  {
    const rows = feed.alerts || [];
    const deduped = collapseDuplicates(rows);
    if (deduped.length !== rows.length) {
      fail(`chat readability: ${rows.length - deduped.length} alert row(s) still match the engine's duplicate rule; `
        + 'collapseDuplicates should have removed the repeated swing(s) before publication');
    }
  }

  // All checks, including the chat-readability invariant above, must run before deciding
  // whether the feed is publishable. Keeping this gate last makes every collected violation fatal.
  if (problems.length) {
    console.error(`\nFAILED — ${problems.length} violation(s):`);
    for (const p of problems) {
      console.error('  ✗ ' + p);
      /* The raw job log is not always downloadable (measured 2026-11-21: the Actions log endpoint
       * returned EOF in this environment). Workflow annotations are readable through the API, so
       * every violation is also emitted as one — a failing gate has to be diagnosable. */
      if (process.env.GITHUB_ACTIONS === 'true') console.error(`::error title=feed validation::${p}`);
    }
    process.exit(1);
  }
  console.log('OK: every alert, market, resolution and orderbook row passed the source and threshold checks.');
}

main().catch((e) => { console.error('checker crashed:', e); process.exit(1); });
