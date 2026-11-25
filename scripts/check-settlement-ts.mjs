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

/* 3. End-to-end: run the real generator in a scratch tree with a patched real snapshot.
 *
 * FIXTURE INDEPENDENCE (session-3dd2b218, 2026-11-25). The fixture used to hard-code a real
 * settlement instant taken from the 2026-11-22 capture (`2026-11-16T14:32:51.060078Z`, the
 * KXAAAGASW-26NOV16 event) and asserted that the generated gas page no longer contained that
 * instant after the negative control removed it. That made the control depend on WHICH settled
 * event the capture happens to list first: the control removed the value from
 * `settled_events[0]`, but the hard-coded instant belonged to a different event whenever the
 * capture ordered them differently. Measured on the 2026-11-25 capture, `settled_events[0]` is
 * KXAAAGASW-26NOV23 and the hard-coded instant belongs to `settled_events[1]`, so the control
 * blanked the wrong event and failed even though the generator was correct.
 *
 * The fixture is now order-independent in two ways:
 *   a) the positive control uses a SENTINEL instant that occurs nowhere in the snapshot, so the
 *      assertion can never be satisfied by a real captured row;
 *   b) the negative control removes `settlement_ts` from EVERY settled event of EVERY topic
 *      (the event field and every nested market's field) — the only way to assert "no official
 *      value anywhere => no time rendered anywhere".
 * The generator, the capture script and every published page are untouched by this change. */
const SETTLED = '2031-01-02T03:04:05.678901Z';
const WANT = '2031-01-02 03:04:05';

/* Read the "Settled at" cell (the 6th cell) of every row of the resolved-events table.
 * The generator renders it as `<span class="muted">—</span>` when no official value exists, and
 * as "<iso> UTC" when one does. Extracting the cell — rather than searching the whole page — is
 * what makes the negative control able to catch ANY inferred time, not just one hard-coded
 * string. (Measured 2026-11-25: a generator mutated to fall back to a constant time still
 * passed a "the sentinel is absent" assertion, because the inferred value was a different
 * string. This cell-level check fails on that mutation.) */
function settledCells(html) {
  const body = html.slice(html.indexOf('id="resolved-body"'));
  const rows = body.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  return rows.map((row) => {
    const cells = row.match(/<td[\s\S]*?<\/td>/g) || [];
    return cells.length >= 6 ? cells[5] : '';
  });
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
try {
  positiveHtml = generateWith((snap) => {
    const ev = snap.topics.gas.settled_events[0];
    ev.markets[0].settlement_ts = SETTLED;
  });
  negativeHtml = generateWith((snap) => {
    /* The negative control must remove the value from EVERY settled event and EVERY market.
     * Two independent observations led here, both measured:
     *   - 2026-11-22 (session-13a3df7d, PR #113): gas renders 12 settled events, so nulling only
     *     settled_events[0] left the other 11 rows still rendering their timestamps and the control
     *     failed even though the generator was correct;
     *   - 2026-11-25 (session-3dd2b218): the hard-coded instant belonged to a settled event other
     *     than settled_events[0], so nulling only event 0 left the string on the page.
     * Nulling every event and every nested market of EVERY topic is the only way to test
     * "no official value anywhere => blank cell everywhere". */
    for (const topic of Object.values(snap.topics || {})) {
      for (const ev of topic.settled_events || []) {
        ev.settlement_ts = null;
        for (const m of ev.markets || []) m.settlement_ts = null;
      }
    }
  });
} catch (e) {
  threw = e;
}

ok('generator runs end-to-end in a scratch tree', threw === null, threw ? String(threw.message || threw) : '');
/* The sentinel must not already exist in the capture, otherwise the positive control could be
 * satisfied by a row the fixture never touched. */
const rawSnapshot = readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8');
ok('the positive-control sentinel does not occur in the committed snapshot',
  !rawSnapshot.includes(SETTLED) && !rawSnapshot.includes('2031-01-02'),
  'the sentinel instant must be unique to the fixture');
const positiveCells = settledCells(positiveHtml);
ok('a settled market with settlement_ts renders "Settled at" from the official field',
  positiveHtml.includes(WANT) && positiveCells.some((c) => c.includes(WANT)),
  'expected ' + WANT + ' in the Settled-at cell of categories/gas.html');
const negativeCells = settledCells(negativeHtml);
const inferred = negativeCells.filter((c) => !/class="muted">/.test(c) && /\d{4}-\d{2}-\d{2}/.test(c));
ok('negative control: a null settlement_ts still renders a blank, never an inferred time',
  negativeHtml !== '' && negativeCells.length > 0 && inferred.length === 0,
  inferred.length
    ? 'the generator rendered an inferred settlement time in ' + inferred.length + ' row(s): ' + inferred[0]
    : (negativeCells.length ? '' : 'no resolved rows were generated, so the control proved nothing'));

console.log(`\nsettlement-ts: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILED — ' + failures.join('; '));
  process.exit(1);
}
