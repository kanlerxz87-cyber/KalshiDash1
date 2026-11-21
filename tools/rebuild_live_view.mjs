#!/usr/bin/env node
/* rebuild_live_view.mjs — rebuild the published live view from the committed state,
 * WITHOUT contacting the Kalshi API.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two changes to the alert engine need the committed artifacts to be brought back in line
 * with the current rules before the next live run, and both can be done exactly, offline,
 * from data the repository already holds.
 *
 * 1. DE-DUPLICATION. On 2026-11-20 the committed feed contained 99 alerts and every one of
 *    them came from the single ticker KXPRESNOMD-28-AKLO, which flapped between $0.80 and
 *    $0.00. The "scrolling chat" therefore carried exactly one event, repeated 99 times. The
 *    detector fix (one swing per ticker per 15 minutes, direction-independent) lives in
 *    tools/live_engine.mjs as collapseDuplicates() and applies to every alert the engine
 *    writes from now on, but the already-committed rows were produced before the fix.
 *
 * 2. THE FOLLOWED REGISTRY. The engine can only sample a market while it is still open, so
 *    by the time a market settles it has already left `markets` — which meant every
 *    resolution was dropped as "untracked" and the Resolved-events table stayed empty
 *    (measured on the live feed: 500 settled markets seen, 0 recorded). The engine now keeps
 *    a `followed` registry of every ticker it has ever seen. The committed state predates
 *    that registry, so it is seeded here from the market rows and the price history the
 *    repository already holds.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *   * It never invents, edits or re-prices an alert or a market. Every value it keeps is one
 *     the API produced, including its `source_url`.
 *   * It never touches `meta.generated_at`. The feed still describes the sample it was
 *     actually taken from.
 *   * It contacts no network endpoint.
 *
 * The next successful run of tools/live_engine.mjs performs exactly these steps as part of
 * its normal write, so this tool only makes the committed artifact agree with the current
 * rules *before* that run happens.
 *
 *   node tools/rebuild_live_view.mjs            # rewrite data/live/{state,feed}.json
 *   node tools/rebuild_live_view.mjs --dry-run  # report what would change, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { collapseDuplicates, topMarkets, boardByTopic, slimHistory } from './live_engine.mjs';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'data', 'live');
const dryRun = process.argv.includes('--dry-run');

const statePath = path.join(DIR, 'state.json');
const feedPath = path.join(DIR, 'feed.json');

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

/* ------------------------------------------------------------------ 1. de-duplicate */
const before = Array.isArray(state.alerts) ? state.alerts.length : 0;
const collapsed = collapseDuplicates(state.alerts || []);
const after = collapsed.length;

console.log('de-duplication');
console.log(`  alerts before: ${before}`);
console.log(`  alerts after : ${after}`);
if (before === after) console.log('  no change — the committed feed already satisfies the current rule.');
else console.log(`  removed ${before - after} duplicate row(s) (repeats of the same contract's swing).`);

state.alerts = collapsed;

/* ------------------------------------------------------------------ 2. seed `followed` */
const followed = state.followed || {};
let seeded = 0;
for (const [ticker, m] of Object.entries(state.markets || {})) {
  if (!m) continue;
  const hist = (state.history || {})[ticker];
  const firstSample = Array.isArray(hist) && hist.length ? hist[0][0] : null;
  const lastSample = Array.isArray(hist) && hist.length ? hist[hist.length - 1][0] : null;
  const sampledAt = m.sampled_at ? Date.parse(m.sampled_at) : null;
  const entry = followed[ticker] || {};
  entry.first_seen = Math.min(
    entry.first_seen ?? Infinity,
    firstSample ?? (sampledAt ? Math.floor(sampledAt / 1000) : Infinity),
  );
  entry.last_seen = Math.max(entry.last_seen ?? 0, lastSample ?? (sampledAt ? Math.floor(sampledAt / 1000) : 0));
  entry.series_ticker = m.series_ticker ?? entry.series_ticker ?? null;
  entry.topic = m.topic ?? entry.topic ?? null;
  entry.title = m.title ?? entry.title ?? null;
  entry.close_time = m.close_time ?? entry.close_time ?? null;
  if (!Number.isFinite(entry.first_seen)) entry.first_seen = entry.last_seen;
  followed[ticker] = entry;
  seeded += 1;
}
state.followed = followed;

console.log('followed registry');
console.log(`  tickers followed: ${Object.keys(followed).length} (seeded ${seeded} from the committed market rows)`);

if (dryRun) {
  console.log('--dry-run: nothing written');
  process.exit(0);
}

/* ------------------------------------------------------------------ 3. write */
const stamp = new Date().toISOString();
state.meta = state.meta || {};
state.meta.dedupe_rule = 'one swing per ticker per 15 minutes (direction-independent); cross-detector repeats collapse within 3 minutes';
state.meta.dedupe_reapplied_at = stamp;
state.meta.dedupe_reapplied_note =
  'Alert rows were re-de-duplicated offline with the engine\'s own collapseDuplicates(); no row was '
  + 'invented or re-priced, and meta.generated_at is still the timestamp of the API sample these rows came from. '
  + 'The next tools/live_engine.mjs run performs the same step as part of its normal write.';

fs.writeFileSync(statePath, JSON.stringify(state, null, 1) + '\n');

const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
feed.meta = state.meta;
feed.alerts = state.alerts.slice(0, 200);
feed.resolutions = state.resolutions.slice(0, 100);
feed.markets = topMarkets(state, 60);
feed.by_topic = boardByTopic(state, 24);
feed.topics = state.topics || {};
feed.history = slimHistory(state, 12);
feed.orderbooks = state.meta.orderbooks || {};
fs.writeFileSync(feedPath, JSON.stringify(feed, null, 1) + '\n');

console.log(`wrote ${path.relative(ROOT, statePath)} and ${path.relative(ROOT, feedPath)}`);
