#!/usr/bin/env node
/**
 * check-data-writer-concurrency.mjs — offline regression test for the data-writer publish path.
 *
 * WHY
 * ---
 * On 2026-11-21T06:37:33Z the `keepalive` workflow failed on `main` with
 * "could not push after 3 attempts" (run 44876422837). Two pull requests had merged three seconds
 * apart, so a second writer had already published by the time the first tried to push. Three
 * separate, real defects were involved and all three are pinned here:
 *
 *   1. all three data writers commit overlapping regenerated files, and the retry loop
 *      re-ran the SAME `git rebase` that had just conflicted — it can never succeed;
 *   2. the writers declared three DIFFERENT concurrency groups, although `keepalive.yml`'s
 *      comment claimed they were shared, so nothing serialised them;
 *   3. a "successful" push was trusted by exit code, so a no-op could exit 0 having published
 *      nothing.
 *
 * NO DEPENDENCIES ON PURPOSE. This repository's published site has no build step and no runtime
 * dependencies, and its checkers must keep working on a bare checkout (a first version of this
 * test imported the `yaml` package and failed in CI, where only `jsdom` is installed ad-hoc).
 * The workflow files are therefore read with the same small indentation-based extractor that
 * `check-data-workflow-shells.mjs` uses.
 *
 * Run: node scripts/check-data-writer-concurrency.mjs
 * Sources: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency
 *          https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsrun
 */
import { readFileSync } from 'node:fs';

const WRITERS = [
  '.github/workflows/keepalive.yml',
  '.github/workflows/live-alerts.yml',
  '.github/workflows/refresh-data.yml',
];

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) { pass += 1; } else { fails.push(label); } };

const source = Object.fromEntries(WRITERS.map((f) => [f, readFileSync(f, 'utf8')]));
const lines = Object.fromEntries(WRITERS.map((f) => [f, source[f].split('\n')]));

/**
 * Every `run: |` block in the file, as { line, script }. Only block-form steps are used by the
 * writers' publish path, and those are the only ones this test needs.
 */
function runBlocks(file) {
  const out = [];
  const ls = lines[file];
  for (let i = 0; i < ls.length; i++) {
    const m = /^(\s*)run:\s*\|[-+]?\s*$/.exec(ls[i]);
    if (!m) continue;
    const minIndent = m[1].length + 1;
    const body = [];
    let j = i + 1;
    while (j < ls.length) {
      const next = ls[j];
      if (next.trim() && (next.match(/^ */)[0].length < minIndent)) break;
      body.push(next);
      j++;
    }
    out.push({ line: i + 1, script: body.join('\n') });
    i = j - 1;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------
 * 1. One concurrency group shared by every data writer, branch-scoped, and not cancelling.
 *    A cancellation mid-push is another way to lose a sample.
 * ---------------------------------------------------------------------------------------- */
const groups = new Map();
for (const f of WRITERS) {
  const ls = lines[f];
  /* The top-level `concurrency:` block (column 0) is the workflow-level one. Job-level blocks are
   * indented; the writers only use the workflow-level form. */
  const ci = ls.findIndex((l) => /^concurrency:\s*$/.test(l));
  ok(ci !== -1, `${f}: declares a workflow-level concurrency block`);
  if (ci === -1) continue;

  let group = null;
  let cancel = null;
  for (let i = ci + 1; i < ls.length; i++) {
    const l = ls[i];
    if (l.trim() && !/^\s/.test(l)) break;             // next top-level key
    const g = /^\s+group:\s*(.+?)\s*$/.exec(l);
    if (g) group = g[1].replace(/^['"]|['"]$/g, '');
    const c = /^\s+cancel-in-progress:\s*(.+?)\s*$/.exec(l);
    if (c) cancel = c[1];
  }
  ok(Boolean(group), `${f}: concurrency group is set`);
  ok(cancel === 'false', `${f}: does not cancel an in-progress writer (got ${cancel})`);
  if (group) groups.set(f, group);
}

const distinct = new Set(groups.values());
ok(distinct.size === 1,
  `all three data writers share ONE concurrency group (found ${distinct.size}: ${[...distinct].join(' | ')})`);

const only = [...distinct][0] || '';
ok(/\$\{\{\s*github\.ref\s*\}\}/.test(only),
  `the shared group is branch-scoped so unrelated branches do not serialise (${only || 'none'})`);

/* ------------------------------------------------------------------------------------------
 * 2. The step that publishes must (a) verify the ref actually moved instead of trusting the push
 *    exit code, and (b) abort a conflicting rebase instead of retrying it blindly.
 * ---------------------------------------------------------------------------------------- */
function publishBlocks(file) {
  return runBlocks(file).filter((b) => /git commit/.test(b.script) && /git push/.test(b.script));
}

for (const f of WRITERS) {
  const blocks = publishBlocks(f);
  ok(blocks.length > 0, `${f}: has a step that both commits and pushes`);
  for (const b of blocks) {
    ok(/git rev-parse HEAD/.test(b.script) && /git rev-parse FETCH_HEAD/.test(b.script),
      `${f}:${b.line}: verifies the remote tip against its own HEAD after pushing`);
    ok(/git rebase --abort/.test(b.script),
      `${f}:${b.line}: aborts a conflicting rebase instead of retrying it`);
  }
}

/* ------------------------------------------------------------------------------------------
 * 3. On conflict, derived data must be REGENERATED rather than text-merged: each writer re-runs
 *    its own generator inside the retry loop and hard-resets to the remote tip.
 * ---------------------------------------------------------------------------------------- */
const GENERATOR = {
  '.github/workflows/keepalive.yml': /node tools\/live_engine\.mjs/,
  '.github/workflows/live-alerts.yml': /node tools\/live_engine\.mjs/,
  '.github/workflows/refresh-data.yml': /node scripts\/fetch-snapshot\.mjs/,
};
for (const f of WRITERS) {
  const b = publishBlocks(f)[0];
  if (!b) continue;
  ok(GENERATOR[f].test(b.script), `${f}: re-runs its generator inside the retry loop`);
  ok(/git reset --hard FETCH_HEAD/.test(b.script), `${f}: discards the derived commit on conflict`);
  ok(/::error::/.test(b.script), `${f}: fails loudly instead of exiting 0 when nothing published`);
}

/* ------------------------------------------------------------------------------------------
 * 4. The shell-syntax gate must cover ALL THREE writers, not only the two that originally had the
 *    missing-`fi` bug (that omission is exactly how keepalive's own breakage went unnoticed).
 * ---------------------------------------------------------------------------------------- */
const shellCheck = readFileSync('scripts/check-data-workflow-shells.mjs', 'utf8');
for (const f of WRITERS) {
  ok(shellCheck.includes(f), `scripts/check-data-workflow-shells.mjs covers ${f}`);
}

console.log(`\ndata-writer publish checks: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('All data-writer publish checks passed.');
