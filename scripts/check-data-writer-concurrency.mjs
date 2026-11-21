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
 *   1. all three data writers committed overlapping regenerated files, and the retry loop
 *      re-ran the SAME `git rebase` that had just conflicted — it can never succeed;
 *   2. the writers declared three DIFFERENT concurrency groups, although `keepalive.yml`'s
 *      comment claimed they were shared, so nothing serialised them;
 *   3. a "successful" push was trusted by exit code, so a no-op could exit 0 having published
 *      nothing.
 *
 * This test is static (no network, no git) and asserts the properties that make the publishing
 * path correct, so a future edit cannot quietly reintroduce any of the three.
 *
 * Run: node scripts/check-data-writer-concurrency.mjs
 * Sources: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency
 *          https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsrun
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const WRITERS = [
  '.github/workflows/keepalive.yml',
  '.github/workflows/live-alerts.yml',
  '.github/workflows/refresh-data.yml',
];

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) { pass += 1; } else { fails.push(label); } };

const docs = Object.fromEntries(WRITERS.map((f) => [f, parse(readFileSync(f, 'utf8'))]));

/* ------------------------------------------------------------------------------------------
 * 1. One concurrency group shared by every data writer, and it must not cancel in progress.
 *    A cancellation mid-push is another way to lose a sample.
 * ---------------------------------------------------------------------------------------- */
const groups = new Set();
for (const f of WRITERS) {
  const c = docs[f].concurrency || {};
  ok(typeof c.group === 'string' && c.group.length > 0, `${f}: declares a concurrency group`);
  ok(c['cancel-in-progress'] === false, `${f}: does not cancel an in-progress writer`);
  groups.add(c.group);
}
ok(groups.size === 1, `all three data writers share ONE concurrency group (found ${groups.size}: ${[...groups].join(', ')})`);

/* The group must be per-branch: a fixed group name would serialise unrelated branches too. */
const only = [...groups][0];
ok(/\$\{\{\s*github\.ref\s*\}\}/.test(only), `the shared group is branch-scoped (${only})`);

/* ------------------------------------------------------------------------------------------
 * 2. Every "commit / push" step must verify the ref actually moved, instead of trusting the
 *    push exit code. The marker is the comparison of HEAD against the freshly fetched tip.
 * ---------------------------------------------------------------------------------------- */
const stepsOf = (doc) => Object.values(doc.jobs).flatMap((j) => j.steps || []);
/* Select the step that actually publishes: it must both push and commit. Written this way because
 * the three steps are named differently ("Commit and push…", "Commit the new sample",
 * "Commit refreshed data"), so matching on the step NAME would silently skip one of them. */
const pushSteps = (doc) => stepsOf(doc).filter((s) => s.run && /git commit/.test(s.run) && /git push/.test(s.run));

for (const f of WRITERS) {
  const steps = pushSteps(docs[f]);
  ok(steps.length > 0, `${f}: has a commit/push step`);
  for (const s of steps) {
    ok(/git rev-parse HEAD/.test(s.run) && /git rev-parse FETCH_HEAD/.test(s.run),
      `${f}: "${s.name}" verifies the remote tip against its own HEAD`);
    ok(/git rebase --abort/.test(s.run),
      `${f}: "${s.name}" aborts a conflicting rebase instead of retrying it blindly`);
  }
}

/* ------------------------------------------------------------------------------------------
 * 3. On conflict the derived data must be REGENERATED, not text-merged. Each writer must re-run
 *    its own generator inside the retry loop and hard-reset to the remote tip.
 * ---------------------------------------------------------------------------------------- */
const GENERATOR = {
  '.github/workflows/keepalive.yml': /node tools\/live_engine\.mjs/,
  '.github/workflows/live-alerts.yml': /node tools\/live_engine\.mjs/,
  '.github/workflows/refresh-data.yml': /node scripts\/fetch-snapshot\.mjs/,
};
for (const f of WRITERS) {
  const step = pushSteps(docs[f])[0];
  ok(GENERATOR[f].test(step.run), `${f}: re-runs its generator inside the retry loop`);
  ok(/git reset --hard FETCH_HEAD/.test(step.run), `${f}: discards the derived commit on conflict`);
  ok(/::error::/.test(step.run), `${f}: fails loudly instead of exiting 0 when nothing published`);
}

/* ------------------------------------------------------------------------------------------
 * 4. The syntax gate must cover ALL THREE writers, not only the two that originally had the
 *    missing-`fi` bug.
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
