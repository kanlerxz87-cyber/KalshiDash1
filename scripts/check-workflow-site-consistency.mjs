#!/usr/bin/env node
/**
 * check-workflow-site-consistency.mjs — offline guard for the data writers.
 *
 * WHY THIS EXISTS (measured 2026-11-21, session-08b1c207)
 * -------------------------------------------------------
 * `live-alerts.yml` committed `data/live/` without the generated pages. The canonical pages
 * embed `feed.meta.generated_at` in their header (`data-asof`), so every engine sample made the
 * site stale while committing none of it. Measured on `main`:
 *
 *   017bd63  build-site --check: FRESH   feed 17:42:16Z  index data-asof 17:42:16Z
 *   82d70f8  build-site --check: STALE   feed 23:12:17Z  index data-asof 17:42:16Z
 *   c39c52f  build-site --check: STALE   feed 23:12:17Z  index data-asof 17:42:16Z
 *   14bfb12  build-site --check: STALE   feed 23:13:08Z  index data-asof 17:42:16Z
 *
 * The `Site build check` workflow should have caught it, but those commits are pushed by
 * workflows using the default `GITHUB_TOKEN`, and GitHub does not create workflow runs for such
 * pushes, so the check never ran on them. A guard that only exists in CI which does not run is
 * not a guard, hence this explicit offline test. Two PRs fixed the writer (F-78, F-80); this
 * file is what stops it coming back — including the subtle half, a *best-effort* rebuild
 * (`node ... || true`) that leaves the run green while the pages stay stale.
 *
 * WHAT IT CHECKS
 * --------------
 *  1. Every workflow that commits regenerated DATA also stages the site output generated FROM
 *     that data (here: `live-alerts.yml` must stage `*.html`, `assets`, `categories`).
 *  2. Every such workflow rebuilds the site before staging, so the staged pages match the data.
 *  3. That rebuild is MANDATORY: a `|| true` / `|| echo warning` guard on it fails the check.
 *  4. `live-alerts.yml` re-checks staleness AFTER its push, so a regression fails that run.
 *  5. Negative controls: the pre-fix shapes are reconstructed and run through the same
 *     predicates. If any of them stops failing, this script errors out rather than passing.
 *
 * Run: node scripts/check-workflow-site-consistency.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}

const read = (p) => readFileSync(resolve(root, p), 'utf8');
const codeOnly = (body) => body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** The `run:` body of a named step, as text. Throws if the step is absent. */
function stepBody(yaml, stepName) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start === -1) throw new Error(`step not found: ${stepName}`);
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s{6}- name: /.test(lines[i])) break; // next step at the same level
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * Does this commit step stage and commit the site OUTPUT generated from the data it commits?
 * `git add -A` / `--all` count because they stage everything.
 */
export function stagesGeneratedSite(body) {
  if (/git add\s+(?:-A|--all)\b/.test(body)) return true;
  return body
    .split('\n')
    .filter((l) => /git add\b/.test(l))
    .some((l) => /\*\.html\b/.test(l) || /\bcategories\b/.test(l) || /(^|\s)assets(\s|$|')/.test(l));
}

/**
 * Rebuild the site before committing, so the staged output matches the staged data.
 * Comment lines are stripped first: the step documents the old `git add data/live/` shape in
 * prose, and reading a comment as the command would mislocate the first real `git add`.
 */
export function buildsSiteBeforeCommit(body) {
  const lines = codeOnly(body).split('\n');
  // The `git add` that stages the DATA is the one that matters: a step may stage data/live/
  // first (to test whether anything changed) and the pages later.
  const dataAddIdx = lines.findIndex((l) => /git add\b/.test(l) && /data\//.test(l));
  const addIdx = dataAddIdx === -1 ? lines.findIndex((l) => /git add\b/.test(l)) : dataAddIdx;
  if (addIdx === -1) return false;
  return /build-site\.mjs/.test(lines.slice(0, addIdx).join('\n'));
}

/**
 * Is the rebuild REQUIRED rather than best-effort?
 *
 * Tolerating a failed rebuild (`|| true`, `|| echo warning`) is the subtle half of this defect:
 * the sample still lands, the pages do not, and the run is green. A rebuild of this site is
 * deterministic and offline (it reads committed JSON only), so a failure is a real defect and
 * must stop the run. Returns false if any rebuild invocation is guarded by `||`.
 */
export function rebuildIsMandatory(body) {
  const lines = codeOnly(body)
    .split('\n')
    .filter((l) => /node scripts\/build-site\.mjs/.test(l));
  if (!lines.length) return false;
  return lines.every((l) => /^\s*if ! node scripts\/build-site\.mjs/.test(l) || !/\|\|/.test(l));
}

/**
 * Is there a `build-site.mjs --check` that runs only AFTER the push? A pre-push check compares
 * freshly staged pages with freshly staged data inside one working tree and can always pass.
 */
export function postPushStalenessGuard(body) {
  const lines = codeOnly(body).split('\n');
  const pushIdx = lines.findIndex((l) => /git push\b/.test(l));
  if (pushIdx === -1) return false;
  return /build-site\.mjs\s+--check/.test(lines.slice(pushIdx).join('\n'));
}

/* ---------------------------------------------------------------- the live workflow */

const alerts = read('.github/workflows/live-alerts.yml');
const commitStep = stepBody(alerts, 'Commit the new sample');

ok(stagesGeneratedSite(commitStep), 'live-alerts.yml stages the generated pages with the data it commits');
ok(buildsSiteBeforeCommit(commitStep), 'live-alerts.yml rebuilds the site before committing data/live/');
ok(rebuildIsMandatory(commitStep), 'live-alerts.yml requires that rebuild to succeed (no `|| true` on it)');
ok(postPushStalenessGuard(commitStep), 'live-alerts.yml re-checks staleness after the push (fails loudly on a stale site)');

/* ---------------------------------------------- every other data writer must be consistent */

const writers = {
  '.github/workflows/refresh-data.yml': /git add data\/snapshot\.json/,
  '.github/workflows/keepalive.yml': /git add data\//,
};

for (const [file, marker] of Object.entries(writers)) {
  const yaml = read(file);
  ok(marker.test(yaml), `${file} still commits regenerated data (writer detected)`);
  ok(
    /git add[^\n]*'\*\.html'|git add[^\n]*\*\.html|git add -A|git add --all/.test(yaml),
    `${file} also stages the generated pages (no data-only commit)`,
  );
  ok(/node scripts\/build-site\.mjs/.test(yaml), `${file} regenerates the site before committing`);
}

/* ------------------------------------------------------------------- negative controls */

/* The exact pre-fix shape from main@14bfb12: stage only data/live/, commit, rebase, push. */
const PREFIX_BODY = [
  'git add data/live/',
  'PUSHED=false',
  'for attempt in 1 2 3 4 5; do',
  '  git commit -m "data(live): engine sample $STAMP" >/dev/null 2>&1 || true',
  '  git fetch origin "$TARGET_BRANCH"',
  '  git rebase FETCH_HEAD',
  '  git push origin "HEAD:$TARGET_BRANCH"',
  'done',
].join('\n');

ok(stagesGeneratedSite(PREFIX_BODY) === false, 'negative control: a data/live-only commit step is rejected');
ok(buildsSiteBeforeCommit(PREFIX_BODY) === false, 'negative control: a step with no site rebuild is rejected');
ok(rebuildIsMandatory(PREFIX_BODY) === false, 'negative control: a step with no rebuild cannot be mandatory');
ok(postPushStalenessGuard(PREFIX_BODY) === false, 'negative control: a step with no post-push check is rejected');

/* The subtle shape: rebuild present but tolerated, so a failure still publishes. */
const BEST_EFFORT_BODY = [
  'node scripts/build-site.mjs >/dev/null 2>&1 || true',
  "git add data/ '*.html' assets categories",
  'git commit -m "data(live): engine sample $STAMP"',
  'git push origin "HEAD:$TARGET_BRANCH"',
].join('\n');

ok(stagesGeneratedSite(BEST_EFFORT_BODY) === true, 'a best-effort rebuild still stages the pages (so staging alone cannot catch it)');
ok(rebuildIsMandatory(BEST_EFFORT_BODY) === false, 'negative control: `node build-site || true` is rejected as best-effort');

/* Accepted shapes. */
ok(stagesGeneratedSite('git add -A\ngit commit -m x') === true, 'git add -A is accepted as staging the site output');
ok(stagesGeneratedSite("git add assets\ngit commit -m x") === true, 'staging assets/ counts as staging site output');
ok(stagesGeneratedSite('git add data/live/\ngit commit -m x') === false, 'staging only data/live/ still fails');
ok(
  rebuildIsMandatory('if ! node scripts/build-site.mjs; then\n  exit 1\nfi\ngit add data/') === true,
  '`if ! node build-site.mjs; then exit 1` is accepted as mandatory',
);

/* ----------------------------------------------------------------------------- verdict */

console.log('');
if (failures.length) {
  console.error(`${pass} passed, ${failures.length} failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${pass}/${pass} checks passed — every data writer keeps the generated site in sync.`);
