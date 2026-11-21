#!/usr/bin/env node
/* backfill-awaiting.mjs — add the derived `awaiting` list to data/live/feed.json.
 *
 * WHY: `tools/live_engine.mjs` now publishes `awaitingResolutions(state)` in the feed so the
 * alerts page can show every followed contract until the exchange answers yes/no (F-66). The
 * feed last written before that change has no such key, and the engine cannot be re-run from
 * this sandbox (no outbound access to the demo API). This script applies the SAME exported pure
 * function to the committed `data/live/state.json`, which already holds those markets, alerts and
 * resolutions. Nothing is inferred and no value is invented: every column comes from the
 * committed state file, and each row keeps the API `source_url` it was sampled from.
 *
 * Usage: node scripts/backfill-awaiting.mjs [--check]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { awaitingResolutions } from '../tools/live_engine.mjs';

const FEED = 'data/live/feed.json';
const STATE = 'data/live/state.json';
const checkOnly = process.argv.includes('--check');

const state = JSON.parse(await readFile(STATE, 'utf8'));
const feedText = await readFile(FEED, 'utf8');
const feed = JSON.parse(feedText);

const awaiting = awaitingResolutions(state, 40);
const next = { ...feed };
// Keep key order stable so the diff is readable: insert `awaiting` right after resolutions.
const rebuilt = {};
for (const [k, v] of Object.entries(feed)) {
  rebuilt[k] = v;
  if (k === 'resolutions') rebuilt.awaiting = awaiting;
}
if (!('awaiting' in rebuilt)) rebuilt.awaiting = awaiting;

const out = JSON.stringify(rebuilt, null, 1) + '\n';
if (checkOnly) {
  const same = JSON.stringify(feed.awaiting) === JSON.stringify(awaiting);
  console.log(same ? `awaiting: up to date (${awaiting.length} rows)` : 'awaiting: STALE (feed differs from state)');
  process.exit(same ? 0 : 1);
}
await writeFile(FEED, out);
console.log(`awaiting: wrote ${awaiting.length} row(s) derived from ${STATE}`);
for (const a of awaiting) console.log(`  ${a.ticker} closes ${a.close_time || '—'}`);
