#!/usr/bin/env node
/* check-settlement-ts.mjs — the "Settled at" column must be fillable from the official API.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured on 2026-11-22 (session-2a42fa01): every one of the 475 `settlement_ts` fields in
 * data/snapshot.json was null, so the category pages' "Settled at" column rendered an em dash for
 * all 100 resolved rows on categories/gas.html alone. The value IS published by the official demo
 * API — `GET /events?series_ticker=…&status=settled&with_nested_markets=true` returns
 * `settlement_ts` on each nested market (verified live for KXAAAGASW-26NOV16-3.8000:
 * "2026-11-16T14:32:51.060078Z"). The event object itself has no such field, so reading it from
 * the event (what the generator did) can only ever produce null.
 *
 * The project rule is: a value that an official source provides is not left blank. This checker
 * guards the two code paths that were missing it and proves the generator end-to-end with the real
 * templates and a patched copy of the real snapshot, so a regression fails offline.
 *
 * Exit code 1 on any failure, so it can gate a merge.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
let pass = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

/* 1. The capture script must copy settlement_ts off the nested market, not just the event.
 *    Match the settled-event mapping block specifically: marketRow() also reads m.settlement_ts,
 *    so a bare regex would still pass after the settled mapping was removed (measured). */
const fetchSrc = readFileSync(path.join(ROOT, 'scripts', 'fetch-snapshot.mjs'), 'utf8');
const settledBlock = fetchSrc.match(
  /markets:\s*\(ev\.markets\s*\|\|\s*\[\]\)\.slice\(0,\s*12\)\.map\(\(m\)\s*=>\s*\(\{([\s\S]*?)\}\)\)/);
ok('fetch-snapshot.mjs maps settlement_ts from the nested settled market',
  Boolean(settledBlock && /settlement_ts:\s*m\.settlement_ts/.test(settledBlock[1])),
  'the settled-event market mapping must read m.settlement_ts');

/* 2. The generator already falls back to the market field; keep that fallback. */
const buildSrc = readFileSync(path.join(ROOT, 'scripts', 'build-site.mjs'), 'utf8');
ok('build-site.mjs resolvedTable reads r.m.settlement_ts',
  /r\.ev\.settlement_ts\s*\|\|\s*r\.m\.settlement_ts/.test(buildSrc),
  'the Settled-at cell must fall back to the market-level field');

/* 3. End-to-end: run the real generator in a scratch tree with a patched real snapshot. */
/* A synthetic SENTINEL timestamp that appears nowhere in data/snapshot.json or in the generated
 * pages (verified 2026-11-25). Using a real capture value made the negative control depend on
 * which event happens to be first: on 2026-11-25 settled_events[0] is KXAAAGASW-26NOV23, but
 * settled_events[1] (KXAAAGASW-26NOV16) legitimately carries 2026-11-16 14:32:51 on all 12 markets,
 * so the page-wide "must be absent" check failed with the generator working correctly (F-89 class). */
const SETTLED = '1999-12-31T23:59:59.000001Z';
const WANT = '1999-12-31 23:59:59';

function generateWith(patch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kd-settle-'));
  try {
    cpSync(path.join(ROOT, 'templates'), path.join(dir, 'templates'), { recursive: true });
    cpSync(path.join(ROOT, 'scripts', 'build-site.mjs'), path.join(dir, 'build-site.mjs'));
    mkdirSync(path.join(dir, 'data'), { recursive: true });
    cpSync(path.join(ROOT, 'data', 'sources.json'), path.join(dir, 'data', 'sources.json'));
    const snap = JSON.parse(readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
    patch(snap);
    writeFileSync(path.join(dir, 'data', 'snapshot.json'), JSON.stringify(snap));
    execFileSync(process.execPath, ['build-site.mjs'], { cwd: dir, stdio: 'pipe' });
    return readFileSync(path.join(dir, 'categories', 'gas.html'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let threw = null;
let positiveHtml = '';
let negativeHtml = '';
try {
  positiveHtml = generateWith((snap) => {
    const ev = snap.topics.gas.settled_events[0];
    ev.markets[0].settlement_ts = SETTLED;
  });
  negativeHtml = generateWith((snap) => {
    /* The negative control must remove the value from EVERY market in the event. Measured
     * 2026-11-22: all 12 nested markets of KXAAAGASW-26NOV16 legitimately share this settlement
     * timestamp (they settle together), so nulling only markets[0] left 11 rows still rendering the
     * string and the control failed on a refreshed capture even though the generator was correct. */
    const ev = snap.topics.gas.settled_events[0];
    ev.settlement_ts = null;
    ev.markets.forEach((m) => { m.settlement_ts = null; });
  });
} catch (e) {
  threw = e;
}

ok('generator runs end-to-end in a scratch tree', threw === null, threw ? String(threw.message || threw) : '');
ok('a settled market with settlement_ts renders "Settled at" from the official field',
  positiveHtml.includes(WANT), 'expected ' + WANT + ' in categories/gas.html');
ok('negative control: a null settlement_ts still renders a blank, never an inferred time',
  negativeHtml !== '' && !negativeHtml.includes(WANT));

console.log(`\nsettlement-ts: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILED — ' + failures.join('; '));
  process.exit(1);
}
