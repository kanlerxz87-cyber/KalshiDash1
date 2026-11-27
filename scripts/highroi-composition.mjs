#!/usr/bin/env node
/* highroi-composition.mjs — measure what the "high ROI" chat pane actually contains.
 *
 * WHY THIS EXISTS (F-94, session-1b163877, 2026-11-27)
 * ----------------------------------------------------
 * The second scrolling chat is the site's selective pane: the events "our model likes as high
 * ROI". Until this script existed, nothing on the site said how many events reach it or what
 * kind of event they are — a reader saw a scrolling list and had to infer the selection from
 * the weights table.
 *
 * The measurement matters because the score's own published terms saturate on exactly the
 * swings that F-91 documents:
 *   * `size`  = min(1, |delta| / 0.50)  -> 1.00 for every move of $0.50 or more;
 *   * `liq`   = min(1, volume_24h / 1000) -> 1.00 for every ticker with 1,000+ contracts;
 * so for a large move on a busy ticker the published score collapses to
 *   0.775 + 0.20 x headroom + 0.25 x (spread term - 0.90),
 * i.e. it is almost entirely a function of how near an extreme the price already was and how
 * tight the book is. That is arithmetic from the published formula, not a judgement.
 *
 * It reports; the two assertions it enforces are the model's own published invariants.
 * It does not re-weight anything, invent a term, or change a verdict: re-weighting without a
 * back-test would be a guess, which is the one thing this project refuses to publish.
 *
 *   node scripts/highroi-composition.mjs                     # report the committed feed
 *   node scripts/highroi-composition.mjs --check             # exit 1 only on a broken invariant
 *   node scripts/highroi-composition.mjs path/to/feed.json   # any feed file
 *
 * Offline: reads a committed JSON file, no network, no clock.
 */
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const files = args.filter((a) => a !== '--check');
const target = files.length ? files[0] : 'data/live/feed.json';
/* Published boundaries, the same ones the console's method table states. */
const EXTREME = 0.05;          // "within $0.05 of an extreme" — the no-headroom band
const SIZE_CAP = 0.50;         // the |delta| at which the size term saturates
const LIQ_CAP = 1000;          // the 24h volume at which the liquidity term saturates

const feed = JSON.parse(await readFile(target, 'utf8'));
const alerts = Array.isArray(feed.alerts) ? feed.alerts : [];
const threshold = Number(feed.meta && feed.meta.high_roi_threshold);
const high = alerts.filter((a) => a.model && a.model.highROI === true);

const failures = [];
const fail = (m) => failures.push(m);

/* ---- the model's own published invariants (hard failures) ---- */
for (const a of high) {
  const s = a.model.score;
  if (typeof s !== 'number') fail(`${a.id}: highROI with a non-numeric score (${s})`);
  else if (Number.isFinite(threshold) && s < threshold) fail(`${a.id}: highROI but score ${s} < threshold ${threshold}`);
  if (a.model.tradeable !== true) fail(`${a.id}: highROI but tradeable=${a.model.tradeable} (the follow-through gate must cap these at 0.30)`);
}

/* ---- composition ---- */
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const byDir = { up: 0, down: 0 };
const byTopic = {};
const byTicker = {};
let extreme = 0;
let sizeSaturated = 0;
let liqSaturated = 0;
const scores = [];
for (const a of high) {
  byDir[a.direction] = (byDir[a.direction] || 0) + 1;
  byTopic[a.topic] = (byTopic[a.topic] || 0) + 1;
  byTicker[a.ticker] = (byTicker[a.ticker] || 0) + 1;
  if (Number(a.from) <= EXTREME || Number(a.from) >= 1 - EXTREME) extreme += 1;
  if (Math.abs(Number(a.delta)) >= SIZE_CAP) sizeSaturated += 1;
  if (Number(a.volume_24h_fp) >= LIQ_CAP) liqSaturated += 1;
  if (typeof a.model.score === 'number') scores.push(a.model.score);
}
scores.sort((x, y) => x - y);

/* The arithmetic of saturation, computed from the published weights — not asserted as a
 * verdict, printed so a reader can check it against docs/ALERTS.md §3.4. */
const floorScore = 0.20 * 0 + 0.20 * 1 + 0.35 * 1 + 0.25 * 0.90;
const saturated = sizeSaturated === high.length && liqSaturated === high.length && high.length > 0;

console.log(`high-ROI composition — ${target}`);
console.log(`  sample generated:      ${(feed.meta && feed.meta.generated_at) || 'unknown'}`);
console.log(`  model version:         ${(feed.meta && feed.meta.model_version) || 'unknown'}`);
console.log(`  threshold:             ${Number.isFinite(threshold) ? threshold : 'unknown'}`);
console.log(`  alerts in feed:        ${alerts.length}`);
console.log(`  high-ROI rows:         ${high.length} (${pct(high.length, alerts.length)}% of the feed)`);
console.log(`  direction:             up ${byDir.up} / down ${byDir.down}`);
console.log(`  topics:                ${Object.keys(byTopic).length ? Object.entries(byTopic).map(([k, v]) => `${k} ${v}`).join(', ') : '—'}`);
console.log(`  distinct tickers:      ${Object.keys(byTicker).length}`);
console.log(`  premised within $${EXTREME.toFixed(2)} of an extreme (${EXTREME} or ${(1 - EXTREME).toFixed(2)}): ${extreme} (${pct(extreme, high.length)}%)`);
console.log(`  size term saturated (|delta| >= $${SIZE_CAP.toFixed(2)}):      ${sizeSaturated} (${pct(sizeSaturated, high.length)}%)`);
console.log(`  liquidity term saturated (24h >= ${LIQ_CAP}):  ${liqSaturated} (${pct(liqSaturated, high.length)}%)`);
if (scores.length) {
  console.log(`  score range:           ${scores[0]} .. ${scores[scores.length - 1]} (median ${scores[Math.floor(scores.length / 2)]})`);
}
if (saturated) {
  console.log(`  NOTE: both terms are saturated on every row. Because size and liquidity each equal 1.00,`);
  console.log(`        the published formula reduces to 0.775 + 0.20 x headroom + 0.25 x (spread - 0.90),`);
  console.log(`        so headroom 0 with a penny-wide book already scores ${floorScore.toFixed(4)} — above the`);
  console.log(`        ${threshold} threshold. Raising the threshold therefore cannot separate these rows:`);
  console.log(`        see F-94 on flagged.html. No re-weighting is applied without a back-test.`);
}

if (failures.length) {
  console.log('');
  for (const f of failures.slice(0, 20)) console.log(`  FAIL ${f}`);
  if (failures.length > 20) console.log(`  … ${failures.length - 20} more`);
  console.error(`high-ROI composition: ${failures.length} invariant failure(s)`);
  process.exit(1);
}
console.log('');
console.log(checkOnly
  ? 'high-ROI composition: invariants OK.'
  : 'high-ROI composition: invariants OK (report only — composition is published, not scored).');
