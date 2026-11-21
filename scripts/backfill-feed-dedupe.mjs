#!/usr/bin/env node
/* backfill-feed-dedupe.mjs — apply the engine's own dedupe rule to alert history that was
 * recorded BEFORE that rule existed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The alert engine (tools/live_engine.mjs) re-collapses its stored alerts on every run
 * (`next.alerts = collapseDuplicates(next.alerts)`), so a new rule reaches old rows on the
 * next sample automatically. Two things still needed this script on 2026-11-21:
 *
 *   1. The merged fix (one alert per ticker per 15 min) had not sampled yet, so the committed
 *      data/live/feed.json still carried the pre-fix backlog: 173 rows, of which 99 came from
 *      KXPRESNOMD-28-AKLO and 74 from KXBTCY-27JAN0100-B97500. Those are two demo contracts
 *      flipping between ~$0.80 and ~$0.00, i.e. 173 rows describing two markets — the chat was
 *      unreadable, which is exactly what the fix addresses.
 *   2. CI validates the COMMITTED feed (`alerts-qa` → scripts/check_alerts.mjs). The new
 *      readability guard fails a feed that publishes more than 6 alerts from one contract in a
 *      rolling hour, so the backlog had to be collapsed before the next push.
 *
 * WHAT IT DOES — nothing invented
 * -------------------------------
 * It imports `collapseDuplicates` from tools/live_engine.mjs (the same function the engine runs)
 * and rewrites ONLY the `alerts` arrays of data/live/feed.json and data/live/state.json. No
 * price, timestamp, ticker, source_url or model field is created, changed or dropped from a kept
 * row; dropped rows are duplicates under the engine's own rule, and their ids are listed in the
 * `dedupe_backfill` record it writes into both files' `meta` so the removal is auditable.
 *
 * It is idempotent: running it again on an already-collapsed feed changes nothing.
 *
 *   node scripts/backfill-feed-dedupe.mjs            # apply
 *   node scripts/backfill-feed-dedupe.mjs --dry-run  # report only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { collapseDuplicates } from '../tools/live_engine.mjs';

const DRY = process.argv.includes('--dry-run');
const FILES = ['data/live/feed.json', 'data/live/state.json'];

let before = null;
let after = null;
const removed = [];

for (const file of FILES) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const alerts = Array.isArray(doc.alerts) ? doc.alerts : [];
  const kept = collapseDuplicates(alerts.slice());
  const keptIds = new Set(kept.map((a) => a.id));
  const dropped = alerts.filter((a) => !keptIds.has(a.id)).map((a) => a.id);
  if (before === null) before = alerts.length;
  after = kept.length;
  removed.push(...dropped);
  console.log(`${file}: ${alerts.length} → ${kept.length} alerts (${dropped.length} collapsed)`);
  if (DRY || alerts.length === kept.length) continue;
  doc.alerts = kept;
  doc.meta = doc.meta || {};
  doc.meta.dedupe_backfill = {
    applied_at: new Date().toISOString(),
    rule: 'tools/live_engine.mjs collapseDuplicates (one alert per ticker per 15 min; 3 min across detectors)',
    alerts_before: alerts.length,
    alerts_after: kept.length,
    removed_ids: dropped,
    why: 'Pre-fix backlog recorded before the 15-minute dedupe rule was merged (PR #39); collapsed with the engine\'s own function. No kept row was altered.',
  };
  writeFileSync(file, JSON.stringify(doc, null, 1) + '\n');
  console.log(`${file}: written`);
}

console.log(DRY
  ? `dry run: ${before} → ${after} alerts`
  : `alerts: ${before} → ${after} (${removed.length} duplicate rows collapsed)`);
