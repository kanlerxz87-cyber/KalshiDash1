#!/usr/bin/env node
/**
 * check_rescore_retained.mjs — a persisted alert must always carry the CURRENT model's verdict.
 *
 * WHY THIS EXISTS (measured, not hypothetical)
 * --------------------------------------------
 * On 2026-11-21 the follow-through gate landed in `tools/live_engine.mjs` and a strict validator
 * in `scripts/check_alerts.mjs`. `live-alerts` run **44947818572** (push, branch
 * `arena/e7260519-kalshidash1`) then failed at the "Validate the feed" step, with:
 *
 *   ✗ alert trade:KXPRESPERSON-28-VRAM@1795292123: labelled high-ROI but NOT executable at the
 *     swing price (YES bid is $0.00 — there is no bid to sell into).
 *   … and the same for @1795290320 and @1795289416.
 *
 * The engine was right about the *new* rows; the failure was on rows that had been scored by the
 * previous model and carried forward by the state file. A model change could therefore never
 * publish, because old verdicts outlive the model that produced them.
 *
 * The fix is a re-score pass in `applySample()`. This test pins it offline, using the real failing
 * state as the fixture:
 *
 *   1. build a feed from state whose rows still carry the OLD high-ROI verdict
 *      → `scripts/check_alerts.mjs` must FAIL (proves the guard is live, not a tautology);
 *   2. run one `applySample()` with no new markets (so only the re-score pass can change anything)
 *      → every retained row must carry the CURRENT verdict, the validator must PASS, and
 *      prices / arrows / timestamps / ids must be byte-identical.
 *
 * Runs offline. No network, no fixtures on disk.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applySample, EMPTY_STATE, MODEL_VERSION } from '../tools/live_engine.mjs';

const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass += 1; else fails.push(label); };

/* ---- the fixture: the two row shapes that were persisted in the real failing state -------- */
const ISO = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const market = (ticker, bid, ask, price) => ({
  ticker, event_ticker: ticker.split('-').slice(0, 2).join('-'), series_ticker: ticker.split('-')[0],
  topic: 'crypto', title: ticker, status: 'active', result: '',
  price, price_field: 'last_price_dollars', book_inconsistent: false, reciprocity_error: null,
  yes_bid_dollars: bid, yes_ask_dollars: ask, yes_bid_size_fp: '0.00', yes_ask_size_fp: '0.00',
  no_bid_dollars: (1 - Number(ask)).toFixed(4), no_ask_dollars: (1 - Number(bid)).toFixed(4),
  volume_fp: '1000.00', volume_24h_fp: '500.00', open_interest_fp: '100.00',
  est_traded_dollars: null, close_time: '2027-01-01T00:00:00Z', rules_primary: 'rule',
  settlement_sources: [], contract_terms_url: null, source_url: `${BASE}/markets/${ticker}`,
});
const alertRow = (id, ticker, from, to, direction, bid, ask) => ({
  id, ts: ISO(60), ticker, topic: 'crypto', title: ticker, direction, from, to,
  delta: Math.round((to - from) * 10000) / 10000, abs_delta: Math.abs(Math.round((to - from) * 10000) / 10000),
  threshold: 0.1, baseline_kind: 'previous trade within 30 min', detection: 'trade',
  yes_bid_dollars: bid, yes_ask_dollars: ask, volume_24h_fp: '500.00', volume_fp: '1000.00',
  close_time: '2027-01-01T00:00:00Z', source_url: `${BASE}/markets/trades?ticker=${ticker}&limit=1000`,
  /* the OLD verdict, exactly as it was persisted */
  model: { score: 0.787, highROI: true, reasons: ['v1: one-sided book scored as tight'] },
});

const state = structuredClone(EMPTY_STATE);
state.meta = { ...(state.meta || {}), generated_at: ISO(60), model_version: 'heuristic-v1', base_url: BASE };
state.alerts = [
  alertRow('trade:KXA@1', 'KXA-1', 0.802, 0.003, 'down', '0.0000', '0.8020'),  // the CI failure shape
  alertRow('trade:KXB@1', 'KXB-1', 0.802, 0.003, 'down', '0.0000', '0.8020'),  // x2, as three rows failed
  alertRow('trade:KXC@1', 'KXC-1', 0.44, 0.55, 'up', '0.5400', '0.5500'),      // a genuinely tradeable move
];
state.markets = {
  'KXA-1': market('KXA-1', '0.0000', '0.8020', 0.003),
  'KXB-1': market('KXB-1', '0.0000', '0.8020', 0.003),
  'KXC-1': market('KXC-1', '0.5400', '0.5500', 0.55),
};
state.resolutions = [];

/* ---- feed builder + validator runner ------------------------------------------------------ */
const dir = mkdtempSync(path.join(tmpdir(), 'kalshi-rescore-'));
const feedPath = path.join(dir, 'feed.json');
function asFeed(s) {
  writeFileSync(feedPath, JSON.stringify({
    meta: { ...(s.meta || {}), model_version: MODEL_VERSION },
    run: s.run || {}, alerts: s.alerts || [], resolutions: s.resolutions || [],
    markets: Object.values(s.markets || {}), by_topic: {}, history: s.history || {},
    orderbooks: (s.meta || {}).orderbooks || {},
  }, null, 1));
  return feedPath;
}
function validate() {
  /* stdio is captured, never inherited: step 1 EXPECTS this validator to fail, and printing that
   * failure verbatim into a green CI log reads like a real violation. The output is asserted on
   * and echoed only if an assertion fails. */
  try {
    const out = execFileSync('node', ['scripts/check_alerts.mjs'], {
      cwd: process.cwd(), env: { ...process.env, ALERTS_FEED: feedPath }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/* ---- 1. the guard must reject the pre-fix state ------------------------------------------ */
const before = validate(asFeed(state));
ok(before.code === 1, `the validator must REJECT persisted rows carrying a stale high-ROI verdict (exit ${before.code})`);
ok(/KXA@1/.test(before.out) && /NOT executable/.test(before.out),
  'the rejection must name the unfillable row, not fail silently: ' + before.out.split('\n').find((l) => /KXA@1/.test(l)));
ok(!/KXC@1/.test(before.out), 'the genuinely tradeable row must not be named as a violation');

/* ---- 2. one sample re-scores every retained row ------------------------------------------ */
const next = applySample(state, { nowSeconds: Math.floor(Date.now() / 1000), markets: [], runId: 'rescore-test' });
ok(next.meta.rescored_by_current_model >= 2, `at least the 2 unfillable rows must be re-scored (got ${next.meta.rescored_by_current_model})`);
ok(next.alerts.filter((a) => a.model.highROI).length === 1,
  'exactly one retained row may stay high-ROI after re-scoring (the tradeable one)');
ok(next.alerts.find((a) => a.id === 'trade:KXC@1').model.highROI === true,
  'the genuinely tradeable row keeps its high-ROI label across the re-score');
ok(next.alerts.find((a) => a.id === 'trade:KXA@1').model.original_score === 0.787,
  'the old verdict is preserved for audit, not overwritten');

const after = validate(asFeed(next));
ok(after.code === 0, `the validator must PASS once the rows carry the current verdict (exit ${after.code})\n${after.out}`);

/* ---- 3. nothing about the recorded market data may change -------------------------------- */
const fingerprint = (s) => JSON.stringify((s.alerts || []).map((a) => [a.id, a.ticker, a.from, a.to, a.delta, a.ts]));
ok(fingerprint(state) === fingerprint(next), 'prices, arrows, deltas and timestamps must be byte-identical after a re-score');
ok(JSON.stringify(Object.keys(state.markets)) === JSON.stringify(Object.keys(next.markets)), 'the re-score must not add or drop markets');

/* ---- 4. idempotent: a second sample changes nothing ------------------------------------- */
const again = applySample(next, { nowSeconds: Math.floor(Date.now() / 1000) + 60, markets: [], runId: 'rescore-test-2' });
ok(again.meta.rescored_by_current_model === 0, 'a second sample must not re-score anything (idempotent)');
ok(fingerprint(again) === fingerprint(next), 'the second sample must leave the rows untouched');

rmSync(dir, { recursive: true, force: true });

console.log(`\ncheck_rescore_retained — ${pass} assertion(s) passed`);
if (fails.length) {
  console.error(`FAILED — ${fails.length} violation(s):`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('a persisted alert always carries the current model verdict, and its prices never move.');
