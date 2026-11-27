#!/usr/bin/env node
/**
 * check_build_staleness.mjs — pin what "the committed site is stale" means.
 *
 * WHY THIS EXISTS (measured, not hypothetical)
 * --------------------------------------------
 * 2026-11-21T23:14Z, on `main`: the scheduled data writers had just committed a fresh
 * `data/live/feed.json` (`generated_at 2026-11-21T23:13:08Z`) while the committed HTML still carried
 * `data-asof="2026-11-21T17:42:16.000Z"` from the last site build. `node scripts/build-site.mjs
 * --check` exited **1** and listed all 22 pages:
 *
 *   Committed site is stale for: categories/gas.html, categories/elections.html, ... 404.html
 *
 * Nothing in a template or in any published table had changed — only the alert sample clock, which
 * the scheduled engine rewrites every ~10 minutes. The Pages workflow used to run `build-site.mjs`
 * and then fail on a dirty `git status`, so the next push-triggered run would have gone red for a
 * reason the push could not fix.
 *
 * The fix: the comparison ignores the contents of the `#feed-asof` element (the sample timestamp in
 * the page header) and nothing else. This test proves both halves, so the exception cannot be
 * widened later without failing here:
 *
 *   1. a fresh render of the committed tree passes `--check`                      (baseline)
 *   2. changing ONLY the feed's `generated_at` still passes `--check`,
 *      and `--check` writes nothing                                               (the exception)
 *   3. changing a template's visible text still FAILS `--check`                  (the guard)
 *   4. changing a number in a published data table still FAILS `--check`         (the guard)
 *
 * Runs offline. No network, no fixtures outside a temp directory.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass += 1; else fails.push(label); };

const dir = mkdtempSync(path.join(tmpdir(), 'kalshi-stale-'));
const copy = (rel) => cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true });
copy('scripts');
copy('templates');
copy('assets');
copy('data');

function run(args) {
  try {
    const out = execFileSync('node', ['scripts/build-site.mjs', ...args], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const feedPath = path.join(dir, 'data', 'live', 'feed.json');
const tplPath = path.join(dir, 'templates', 'index.tpl');
const snapPath = path.join(dir, 'data', 'snapshot.json');
const readFeed = () => JSON.parse(readFileSync(feedPath, 'utf8'));
const writeFeed = (f) => writeFileSync(feedPath, JSON.stringify(f, null, 1));

/* ---- 0. build once, so a committed site exists in the temp tree -------------------------- */
const built = run([]);
ok(built.code === 0, `the generator must build the temp tree (exit ${built.code})\n${built.out.slice(-800)}`);

/* ---- 1. baseline: a fresh render passes ------------------------------------------------ */
const base = run(['--check']);
ok(base.code === 0, `a freshly built site must pass --check (exit ${base.code})\n${base.out.slice(-800)}`);

/* ---- 2. a new sample timestamp alone must NOT be stale --------------------------------- */
const before = readFeed();
ok(Boolean(before.meta && before.meta.generated_at), 'the temp feed carries meta.generated_at');
before.meta.generated_at = '2030-01-01T00:00:00.000Z';
writeFeed(before);
const afterFeed = run(['--check']);
ok(afterFeed.code === 0,
  `a changed feed timestamp alone must not count as stale (exit ${afterFeed.code})\n${afterFeed.out.slice(-800)}`);
const htmlAfter = readFileSync(path.join(dir, 'index.html'), 'utf8');
ok(htmlAfter.includes('data-asof="'), '--check must not rewrite the committed HTML (as-of attribute still present)');
ok(!htmlAfter.includes('2030-01-01'), '--check must not write the new timestamp into the committed HTML');

/* ---- 3. a template change must still fail --------------------------------------------- */
const tpl = readFileSync(tplPath, 'utf8');
writeFileSync(tplPath, tpl.replace('</body>', '<p>stale-check probe</p>\n</body>'));
const afterTpl = run(['--check']);
ok(afterTpl.code === 1, `a template change that was not rebuilt must fail --check (exit ${afterTpl.code})`);
ok(/stale for: .*index\.html/.test(afterTpl.out), 'the failure must name index.html: ' + afterTpl.out.trim().slice(-300));
writeFileSync(tplPath, tpl);

/* ---- 4. a published table value must still fail --------------------------------------- */
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
/* Find any market row with a numeric price and change it — the category tables render these. */
const markets = (snap.markets || snap.market_rows || []);
const row = Array.isArray(markets) ? markets.find((m) => m && m.ticker && m.last_price_dollars !== undefined) : null;
if (row) {
  const original = row.last_price_dollars;
  row.last_price_dollars = (Number(original) === 0.99 ? 0.98 : 0.99).toFixed(4);
  writeFileSync(snapPath, JSON.stringify(snap, null, 1));
  const afterData = run(['--check']);
  ok(afterData.code === 1,
    `a data change that alters a published table must fail --check (exit ${afterData.code})\n${afterData.out.slice(-500)}`);
} else {
  /* The capture has no markets array in this shape: state it, do not pretend the check ran. */
  ok(false, 'no market row with last_price_dollars in data/snapshot.json — the table guard could not be exercised');
}

/* ---- 5. every COMMITTED page must quote THIS tree's data clocks -------------------------
 * Measured failure this pins (code F-CHART-03, 2026-11-27): a page was committed carrying the
 * previous data sample's `Snapshot captured` clock and alert `#feed-asof` stamp, `--check` did not
 * report it (the as-of exception is matched by content, and a page that embeds an older content
 * value simply looks like a page the exception does not cover), and the GitHub Pages builds for
 * 4f11cbb and 66e9af0 went red on `main`. That is how it was found: by the deploy failing.
 *
 * The guard reads the REAL committed files, not the temp rebuild — a rebuild in a scratch copy
 * erases exactly the defect being looked for. Every published page must quote the committed feed's
 * `meta.generated_at` and the committed snapshot's `meta.captured_at`; anything else means the page
 * was not regenerated with the data it sits next to. */
{
  const feed = JSON.parse(readFileSync(path.join(REPO, 'data', 'live', 'feed.json'), 'utf8'));
  const snap = JSON.parse(readFileSync(path.join(REPO, 'data', 'snapshot.json'), 'utf8'));
  const wantAsof = feed.meta && feed.meta.generated_at;
  const wantSnap = snap.meta && snap.meta.captured_at;
  ok(Boolean(wantAsof) && Boolean(wantSnap), 'the committed data files carry their own clocks');
  const rendered = (iso) => String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').replace('Z', '');
  const asofOf = (html) => { const m = html.match(/data-asof="([^"]*)"/); return m ? m[1] : null; };
  /* Scoped to the generated <footer> on purpose: the Flagged page QUOTES a stale clock in its own
   * evidence prose, and a whole-page match reports that quotation as the defect it documents. */
  const clockOf = (html) => {
    const f = html.match(/<footer[\s\S]*?<\/footer>/);
    if (!f) return null;
    const m = f[0].match(/Snapshot captured (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC/);
    return m ? m[1] : null;
  };
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) {
      if (['node_modules', '.git', 'archive'].includes(n)) continue;
      const p = path.join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out); else if (n.endsWith('.html')) out.push(p);
    }
    return out;
  };
  const staleClocks = [];
  let pagesChecked = 0;
  for (const file of walk(REPO)) {
    const rel = path.relative(REPO, file);
    /* The earlier builds under dash/ and docs/ are static and are not regenerated by build-site. */
    if (rel.startsWith('dash/') || rel.startsWith('docs/') || rel.startsWith('alerts/')) continue;
    const html = readFileSync(file, 'utf8');
    if (!html.includes('id="feed-asof"') && !/<footer[\s\S]*?Snapshot captured/.test(html)) continue;
    pagesChecked += 1;
    const a = asofOf(html);
    const c = clockOf(html);
    if (a && a !== wantAsof) staleClocks.push(`${rel}: data-asof ${a} != feed generated_at ${wantAsof}`);
    if (c && c !== rendered(wantSnap)) staleClocks.push(`${rel}: footer clock ${c} != snapshot captured_at ${rendered(wantSnap)}`);
  }
  ok(pagesChecked > 20, `the committed-clock guard inspected the published pages (${pagesChecked})`);
  ok(staleClocks.length === 0, `every committed page quotes this tree's data clocks: ${staleClocks.slice(0, 5).join('; ')}`);
}

rmSync(dir, { recursive: true, force: true });

console.log(`\ncheck_build_staleness — ${pass} assertion(s) passed`);
if (fails.length) {
  console.error(`FAILED — ${fails.length} violation(s):`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('the staleness check ignores the sample clock and nothing else.');
