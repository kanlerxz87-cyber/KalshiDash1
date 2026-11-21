#!/usr/bin/env node
/* recollapse_feed.mjs — re-apply the engine's alert de-duplication to the committed
 * live feed, WITHOUT contacting the Kalshi API.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-11-20 the committed feed contained 99 alerts and every one of them came from the
 * single ticker KXPRESNOMD-28-AKLO, which flapped between $0.80 and $0.00. The "scrolling chat"
 * therefore carried exactly one event, repeated 99 times. The detector fix (one swing per
 * ticker per 15 minutes, direction-independent) lives in tools/live_engine.mjs and applies to
 * every alert the engine writes from now on, but the already-committed rows were produced
 * before the fix.
 *
 * This tool applies the SAME exported function the engine itself uses
 * (`collapseDuplicates`) to the alerts already recorded in data/live/state.json and rewrites
 * both published files in exactly the shape the engine writes them.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *   * It never invents, edits or re-prices an alert. Every row it keeps is byte-for-byte the
 *     row the API produced, including its `source_url`.
 *   * It never touches `meta.generated_at`. The feed still describes the sample it was
 *     actually taken from; only the de-duplication is re-applied.
 *   * It contacts no network endpoint.
 *
 * The next successful run of tools/live_engine.mjs performs exactly this step as part of its
 * normal write, so this tool only makes the committed artifact agree with the current rule
 * *before* that run happens.
 *
 *   node tools/recollapse_feed.mjs            # rewrite data/live/{state,feed}.json
 *   node tools/recollapse_feed.mjs --dry-run  # report what would change, write nothing
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
const before = Array.isArray(state.alerts) ? state.alerts.length : 0;
const collapsed = collapseDuplicates(state.alerts || []);
const after = collapsed.length;

console.log(`alerts before: ${before}`);
console.log(`alerts after : ${after}`);
if (before === after) console.log('no change — the committed feed already satisfies the current rule.');
else console.log(`removed ${before - after} duplicate row(s) (repeats of the same contract's swing).`);

if (dryRun) {
  console.log('--dry-run: nothing written');
  process.exit(0);
}

state.alerts = collapsed;

/* Record the fact in the feed's own metadata, so a reader of the published file can see that
 * the de-duplication was re-applied offline and is not a fresh API sample. */
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
