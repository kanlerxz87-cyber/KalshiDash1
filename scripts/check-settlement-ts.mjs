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
/* The timestamp under test must be DERIVED from the capture, never hard-coded. Measured
 * 2026-11-25 (session-d6ae0eb2, the second failure of this class after F-89): the control
 * hard-coded KXAAAGASW-26NOV16's settlement time, but the scheduled snapshot refresh had
 * moved that event from settled_events[0] to [1] (NOV23 now sorts first), so the page
 * legitimately still rendered the NOV16 time from event [1] and the control failed on
 * origin/main itself. The control now (a) targets the first event that actually carries an
 * official settlement_ts, (b) asserts the time of a DIFFERENT untouched event still renders
 * — so a blank-everything regression cannot pass vacuously, and (c) fails explicitly if the
 * capture no longer has two events with timestamps, rather than weakening silently.
 * The positive control injects a synthetic 2031 value that no 2026-era capture can contain. */
const INJECTED_RAW = '2031-02-14T09:45:12.000000Z';
const WANT = '2031-02-14 09:45:12';

const fmtTs = (raw) => String(raw).replace('T', ' ').slice(0, 19);

function pickTarget(snap) {
  for (const ev of (snap.topics.gas.settled_events || [])) {
    for (const m of (ev.markets || [])) {
      if (m.settlement_ts) return { ev, raw: m.settlement_ts };
    }
  }
  return null;
}

function pickOtherEvent(snap, target) {
  for (const ev of (snap.topics.gas.settled_events || [])) {
    if (ev === target.ev) continue;
    for (const m of (ev.markets || [])) {
      if (m.settlement_ts) return { ev, raw: m.settlement_ts };
    }
  }
  return null;
}

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
let other = null;
try {
  const snapNow = JSON.parse(readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
  other = pickOtherEvent(snapNow, pickTarget(snapNow));
  positiveHtml = generateWith((snap) => {
    const target = pickTarget(snap);
    target.ev.markets[0].settlement_ts = INJECTED_RAW;
  });
  negativeHtml = generateWith((snap) => {
    /* The negative control must remove the value from EVERY market in the event. Measured
     * 2026-11-22: all 12 nested markets of KXAAAGASW-26NOV16 legitimately share this settlement
     * timestamp (they settle together), so nulling only markets[0] left 11 rows still rendering the
     * string and the control failed on a refreshed capture even though the generator was correct.
     * Measured 2026-11-25: the targeted event itself is now picked from the data (see above). */
    const target = pickTarget(snap);
    target.ev.settlement_ts = null;
    target.ev.markets.forEach((m) => { m.settlement_ts = null; });
  });
} catch (e) {
  threw = e;
}

ok('generator runs end-to-end in a scratch tree', threw === null, threw ? String(threw.message || threw) : '');
ok('a settled market with settlement_ts renders "Settled at" from the official field',
  positiveHtml.includes(WANT), 'expected ' + WANT + ' in categories/gas.html');
const target = (() => { try { return pickTarget(JSON.parse(readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'))); } catch { return null; } })();
const targetWant = target ? fmtTs(target.raw) : null;
ok('negative control: a null settlement_ts still renders a blank, never an inferred time',
  negativeHtml !== '' && Boolean(targetWant) && !negativeHtml.includes(targetWant),
  'the targeted event\u2019s own time ' + (targetWant || '(none in capture)') + ' must disappear');
ok('non-vacuity: an untouched settled event still renders its official time',
  Boolean(other) && Boolean(other.raw) && negativeHtml.includes(fmtTs(other.raw)),
  other ? 'expected ' + fmtTs(other.raw) + ' from ' + (other.ev.event_ticker || other.ev.title || 'another event') + ' to survive'
        : 'capture has no second settled event with a timestamp — the control would be vacuous, so this is a failure');
if (other && targetWant && fmtTs(other.raw) === targetWant) {
  failures.push('control design: two distinct settled events share the same second-level timestamp (' + targetWant + '); the assertion cannot distinguish them');
}

console.log(`\nsettlement-ts: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILED — ' + failures.join('; '));
  process.exit(1);
}
