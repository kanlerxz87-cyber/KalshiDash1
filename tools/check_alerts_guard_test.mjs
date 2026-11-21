#!/usr/bin/env node
/* check_alerts_guard_test.mjs — proves the "chat readability" guard in scripts/check_alerts.mjs
 * actually fails a flooded feed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The guard was first written AFTER the checker's `process.exit(1)` block. `fail()` only pushes
 * to an array, so the guard recorded a violation nobody read: a feed with 99 of 99 alerts from
 * one flapping contract printed "OK" and exited 0 (published as F-63 on flagged.html). A test
 * that feeds a real flood through the real checker is the only way to keep that from recurring.
 *
 * HOW IT WORKS (offline, no network)
 * ----------------------------------
 * The committed, already-collapsed data/live/feed.json is the valid baseline. Case A asserts the
 * baseline passes. Case B clones one real alert until one ticker exceeds the 6-per-rolling-hour
 * cap — every field is copied from a real row, so nothing is invented — and asserts the checker
 * exits 1 with a "chat readability" failure. Case C proves the boundary: an alert moved more than
 * an hour later is no longer a flood.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHECKER = 'scripts/check_alerts.mjs';
const BASE = 'data/live/feed.json';
const dir = mkdtempSync(path.join(tmpdir(), 'alerts-guard-'));
const base = JSON.parse(readFileSync(BASE, 'utf8'));

if (!Array.isArray(base.alerts) || base.alerts.length === 0) {
  console.error(`SKIP/FAIL: ${BASE} has no alerts to derive a flood from`);
  process.exit(1);
}

function run(feed, name) {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(feed, null, 1));
  const r = spawnSync(process.execPath, [CHECKER], {
    env: { ...process.env, ALERTS_FEED: file },
    encoding: 'utf8',
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
};

// A. the committed feed is valid
const a = run(base, 'clean');
check(a.status === 0, `committed feed passes the checker (exit ${a.status})`);

// B. one ticker with 8 alerts inside 45 minutes must be rejected
// The oldest row is used as the seed so every synthetic timestamp stays in the recent past
// (the checker rejects a timestamp in the future, which is an unrelated assertion).
const seed = [...base.alerts].sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts))[0];
const t0 = Date.parse(seed.ts);
const flood = {
  ...base,
  alerts: [
    ...base.alerts,
    ...Array.from({ length: 8 }, (_, i) => ({
      ...seed,
      id: `${seed.id}#flood-test-${i}`,
      // 8 rows inside 45 minutes: a flood the engine's 15-minute rule cannot produce
      ts: new Date(t0 + 2 * 60 * 1000 + i * 6 * 60 * 1000).toISOString(),
    })),
  ],
};
const b = run(flood, 'flood');
check(b.status === 1, `flooded feed fails the checker (exit ${b.status})`);
check(/chat readability/.test(b.out), 'failure names the chat-readability guard');
check(/limit 6/.test(b.out), 'failure states the per-hour limit');

// C. the same count spread one per hour is not a flood: the cap is a rolling window, not a total
const gentler = {
  ...base,
  alerts: Array.from({ length: 8 }, (_, i) => ({
    ...seed,
    id: `${seed.id}#spread-test-${i}`,
    ts: new Date(t0 - i * 60 * 60 * 1000).toISOString(),
  })),
};
const c = run(gentler, 'spread');
check(c.status === 0, `rows spread past the one-hour window still pass (exit ${c.status})`);

if (failures) {
  console.error(`\n${failures} guard assertion(s) failed`);
  process.exit(1);
}
console.log('\nall chat-readability guard assertions passed');
