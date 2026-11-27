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
 *   2. nothing serialised the writers, and `keepalive.yml`'s comment claimed a shared concurrency
 *      group that did not exist;
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
 * 1. THE WRITERS MUST **NOT** SHARE ONE CONCURRENCY GROUP.
 *
 *    This is the opposite of the first attempt, and the reversal is measured rather than
 *    theoretical. A single push to `main` triggers `keepalive`, `live-alerts` AND `refresh-data`
 *    at the same instant (verified: all three created at 2026-11-21T06:49:01Z). When all three
 *    shared `data-writers-<ref>`, GitHub cancelled the ones that were still pending — run
 *    44877328396 (`keepalive`) completed `cancelled`, i.e. **a dropped market sample**. Losing
 *    samples is the exact failure this project's "live" guarantee exists to prevent, so
 *    serialising them is worse than the race it was meant to remove.
 *
 *    The race itself is handled where it belongs, in the publish step (items 2 and 3): derived
 *    data is regenerated on the new tip and the pushed ref is verified. So the requirement here
 *    is that no two writers share a group, and that none cancels an in-progress run.
 * ---------------------------------------------------------------------------------------- */
const groups = new Map();
for (const f of WRITERS) {
  const ls = lines[f];
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
  ok(cancel === 'false', `${f}: never cancels an in-progress writer (got ${cancel})`);
  if (group) groups.set(f, group);
}

/* NOTE: `groups` is keyed by file, so its size is always the number of writers. The property being
 * checked is the number of DISTINCT group values — this assertion was written with `groups.size`
 * first and silently passed while two writers shared a group (caught by its own negative test). */
const distinctGroups = new Set(groups.values());
ok(distinctGroups.size === WRITERS.length,
  `each data writer keeps its OWN group — sharing one cancels samples `
  + `(found ${distinctGroups.size} distinct groups for ${WRITERS.length} writers: `
  + `${[...distinctGroups].join(' | ')})`);

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
/* session-1a950f57: this used to grep the shell-checker's SOURCE for each file name, which only
 * worked while that checker hard-coded its file list. The checker now discovers every workflow, so
 * a name-grep would assert the implementation detail rather than the outcome (and its own header
 * explains why discovery is the point). Execute the checker instead: it must exit 0 and print a
 * shell-checked count for every writer. That is the property this repository actually needs. */
{
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync(process.execPath, ['scripts/check-data-workflow-shells.mjs'], { encoding: 'utf8' });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  ok(run.status === 0, 'scripts/check-data-workflow-shells.mjs exits 0');
  for (const f of WRITERS) {
    const name = f.split('/').pop();
    ok(new RegExp(`${name.replace('.', '\\.')}:\\d+`).test(output),
      `scripts/check-data-workflow-shells.mjs shell-checks ${f}`);
  }
}

console.log(`\ndata-writer publish checks: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('All data-writer publish checks passed.');
