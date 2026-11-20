#!/usr/bin/env node
/* check_workflows.mjs — static contract check for the repository's GitHub Actions workflows.
 *
 * WHY THIS EXISTS
 * ---------------
 * A commit bot that cannot push, or a `schedule:` that never fires, fails *silently*: the
 * site keeps serving old data and every page still says "live". Two such defects were found
 * in this repository on 2026-11-20 (published as F-39/F-40 on the Flagged page):
 *
 *   * `Refresh demo data snapshot` failed at its commit/push step on `main`
 *     (run 44752211268, job `refresh`, step 7 = failure) even though every data step passed;
 *   * **no scheduled run had ever happened** — 0 of the last 100 runs were `schedule`, so the
 *     10-minute alert engine and the 2-hour snapshot refresh only ever ran when a human pushed.
 *
 * This checker encodes the rules that make those failures visible in CI instead of in the
 * published data. It parses the workflow YAML with a deliberately small parser (no dependency)
 * and asserts the facts below. It is a *static* check: it cannot prove GitHub will schedule a
 * cron, only that the file matches the documented requirements for one to be eligible.
 *
 * OFFICIAL SOURCES FOR EVERY RULE
 * -------------------------------
 *  W1  `schedule` workflows run on the default branch only, and GitHub may delay or drop runs
 *      under load; `cron` is POSIX 5-field and the shortest practical interval is 5 minutes.
 *      https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
 *      (repo also mirrors it: .github/workflows/live-alerts.yml header)
 *  W2  A push trigger that lists `branches` must list the branches it intends to run on; a
 *      stale `arena/**` wildcard fires on every session branch, burning the shared schedule
 *      concurrency group and racing other sessions' commits.
 *      https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#push
 *  W3  `permissions: contents: write` is required before `git push` can work with GITHUB_TOKEN,
 *      and the default may be read-only.
 *      https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
 *  W4  A commit step must configure `user.name` + `user.email`, must compare the staged diff
 *      before committing (otherwise the run fails on "nothing to commit" or empty commits),
 *      and must push to an explicit branch — never a bare `git push` that relies on upstream.
 *
 * EXIT CODE: 0 = every workflow passes, 1 = at least one contract violation (printed).
 */
import fs from 'node:fs';
import path from 'node:path';

const WF_DIR = path.join(process.cwd(), '.github', 'workflows');
const failures = [];
const notes = [];

/* ------------------------------------------------------------------ tiny YAML read */
/* We only need: the top-level keys, the `on:` block, and the raw text of `run:` steps.
 * Rather than pull in a YAML dependency (the site has none, and CI must stay dependency-free
 * for this check), read the file as text and answer the specific questions below. This is
 * honest about its limits: it is a linter for known failure shapes, not a YAML parser. */
function read(name) {
  return fs.readFileSync(path.join(WF_DIR, name), 'utf8');
}

function files() {
  return fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
}

/* Return the indented block that follows `key:` at top level (until the next top-level key). */
function topBlock(src, key) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*(#.*)?$`).test(l.trim() === key + ':' ? l : l));
  const idx = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `) || l.startsWith(`${key}:`));
  if (idx === -1) return null;
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^[A-Za-z_][\w-]*:/.test(l)) break; // next top-level key
    out.push(l);
  }
  return { header: lines[idx], body: out.join('\n'), line: idx + 1, all: lines };
}

/* A crude but sufficient "is this inside `on:`" check for the triggers we care about. */
function hasTrigger(src, trigger) {
  const on = topBlock(src, 'on');
  if (!on) return false;
  return new RegExp(`^\\s{2}${trigger}:`, 'm').test(on.body) || new RegExp(`^${trigger}:`, 'm').test(on.body);
}

function triggerBlock(src, trigger) {
  const on = topBlock(src, 'on');
  if (!on) return null;
  const lines = on.body.split('\n');
  const idx = lines.findIndex((l) => new RegExp(`^\\s{2}${trigger}:`).test(l));
  if (idx === -1) return null;
  const indent = lines[idx].match(/^\s*/)[0].length;
  const out = [lines[idx]];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { out.push(l); continue; }
    const ind = l.match(/^\s*/)[0].length;
    if (ind <= indent) break;
    out.push(l);
  }
  return out.join('\n');
}

function runSteps(src) {
  /* Every `run: |` block, plus single-line `run:` commands. */
  const lines = src.split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-?\s*run:\s*(.*)$/);
    if (!m) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    if (m[2] && !/^[|>]/.test(m[2])) { steps.push({ line: i + 1, cmd: m[2] }); continue; }
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { out.push(''); continue; }
      if (l.match(/^\s*/)[0].length <= indent) break;
      out.push(l);
    }
    steps.push({ line: i + 1, cmd: out.join('\n') });
  }
  return steps;
}

/* ------------------------------------------------------------------------ checks */
const CRON = /^\s*-\s*cron:\s*'?"?([^'"\n]+?)'?"?\s*(#.*)?$/;

function check(src, label, failures) {

  /* ---- W3: any workflow that pushes must grant contents: write at job or workflow level. */
  const pushes = /git\s+push/.test(src);
  if (pushes && !/^\s*contents:\s*write/m.test(src)) {
    failures.push(`${label}: runs \`git push\` but never grants \`contents: write\` (W3). The push will fail with a read-only GITHUB_TOKEN.`);
  }

  /* ---- W1: every cron must be 5 fields, and no interval shorter than 5 minutes. */
  for (const line of src.split('\n')) {
    const m = line.match(CRON);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/);
    if (parts.length !== 5) {
      failures.push(`${label}: cron "${m[1]}" has ${parts.length} fields; POSIX cron needs 5 (W1).`);
      continue;
    }
    const [min] = parts;
    const stepMatch = min.match(/^\*\/(\d+)$/);
    if (stepMatch && Number(stepMatch[1]) < 5) {
      failures.push(`${label}: cron "${m[1]}" runs more often than every 5 minutes, which GitHub cannot honour (W1).`);
    }
    if (min === '*') {
      failures.push(`${label}: cron "${m[1]}" fires every minute, which GitHub cannot honour (W1).`);
    }
  }

  /* ---- W1b: a scheduled workflow that also commits should not run on a schedule from a
   *           non-default branch — that is impossible, so flag a `branches:` list inside a
   *           schedule block (a common misunderstanding). */
  const sched = triggerBlock(src, 'schedule');
  if (sched && /branches:/.test(sched)) {
    failures.push(`${label}: \`schedule:\` cannot take a \`branches:\` filter; scheduled runs always use the default branch (W1).`);
  }

  /* ---- W2: push triggers must not use a session-branch wildcard. */
  const push = triggerBlock(src, 'push');
  if (push && /arena\//.test(push)) {
    failures.push(`${label}: push trigger matches session branches (${push.match(/arena[^\n]*/)[0].trim()}). These are ephemeral; a push trigger must target \`main\` only (W2).`);
  }

  /* ---- W4: commit steps must be complete and safe. */
  if (pushes) {
    for (const s of runSteps(src)) {
      if (!/git\s+push/.test(s.cmd)) continue;
      const where = `${label} (run block starting line ${s.line})`;
      if (!/git config user\.name/.test(s.cmd)) failures.push(`${where}: pushes without \`git config user.name\` (W4).`);
      if (!/git config user\.email/.test(s.cmd)) failures.push(`${where}: pushes without \`git config user.email\` (W4).`);
      if (!/git diff --(cached|staged) --quiet/.test(s.cmd)) failures.push(`${where}: commits without checking \`git diff --cached --quiet\` first, so an unchanged run fails or creates an empty commit (W4).`);
      if (/(^|\n)\s*git push\s*(\n|$)/.test(s.cmd)) failures.push(`${where}: uses a bare \`git push\`; push an explicit refspec instead (W4).`);
      if (/git pull --rebase/.test(s.cmd) && /git pull --rebase[^\n]*\|\|\s*true/.test(s.cmd)) {
        failures.push(`${where}: swallows a failed \`git pull --rebase\` with \`|| true\`, then pushes over whatever history it has (W4).`);
      }
    }
  }

  /* ---- W5 (house rule): a workflow that commits generated data must validate it first. */
  if (pushes && /data\/live\/|data\/snapshot\.json/.test(src)) {
    if (!/check_alerts\.mjs|check-links\.mjs|fetch-snapshot\.mjs/.test(src)) {
      failures.push(`${label}: commits data/* without running a validator in the same job (W5).`);
    }
  }
}

for (const f of files()) check(read(f), `.github/workflows/${f}`, failures);

/* ---- Repo-level: stale session-branch push triggers elsewhere are caught above; report the
 *      workflows that intentionally have no schedule so the published "live" claim is honest. */
const scheduled = files().filter((f) => hasTrigger(read(f), 'schedule'));
notes.push(`Workflows with a schedule: ${scheduled.length ? scheduled.join(', ') : 'none'}`);
notes.push('NOTE: a schedule only fires from the default branch (W1); the run history proves whether it fired at all.');

/* ---------------------------------------------------------------------- selftest */
/* Each fixture is a minimal workflow that violates exactly one rule. The checker must reject
 * every one of them and accept a correct workflow, otherwise it is not actually checking. */
if (process.argv.includes('--selftest')) {
  const bad = {
    'no contents:write': 'name: x\non:\n  workflow_dispatch:\njobs:\n  a:\n    steps:\n      - run: |\n          git config user.name a\n          git config user.email a@b\n          git diff --cached --quiet || git commit -m x\n          git push origin HEAD:main\n',
    'session-branch push trigger': 'name: x\non:\n  push:\n    branches: [main, \'arena/**\']\njobs:\n  a:\n    steps:\n      - run: echo hi\n',
    'sub-5-minute cron': 'name: x\non:\n  schedule:\n    - cron: \'*/2 * * * *\'\njobs:\n  a:\n    steps:\n      - run: echo hi\n',
    'bare git push': 'name: x\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  a:\n    steps:\n      - run: |\n          git config user.name a\n          git config user.email a@b\n          git diff --cached --quiet || git commit -m x\n          git push\n',
    'swallowed rebase': 'name: x\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  a:\n    steps:\n      - run: |\n          git config user.name a\n          git config user.email a@b\n          git diff --cached --quiet || git commit -m x\n          git pull --rebase origin main || true\n          git push origin HEAD:main\n'
  };
  const good = 'name: ok\non:\n  workflow_dispatch:\n  schedule:\n    - cron: \'*/10 * * * *\'\n  push:\n    branches: [main]\npermissions:\n  contents: write\njobs:\n  a:\n    steps:\n      - run: node scripts/check_alerts.mjs\n      - run: |\n          git config user.name a\n          git config user.email a@b\n          git add data/live/\n          git diff --cached --quiet && exit 0\n          git commit -m x\n          git push origin HEAD:main\n';
  let ok = 0, badCount = 0;
  for (const [name, src] of Object.entries(bad)) {
    const f = [];
    check(src, name, f);
    if (f.length) ok++; else { badCount++; console.error(`  ✗ selftest: fixture "${name}" was NOT rejected`); }
  }
  const gf = [];
  check(good, 'good', gf);
  if (gf.length) { badCount++; for (const g of gf) console.error('  ✗ selftest: good fixture rejected: ' + g); }
  else ok++;
  if (badCount) { console.error(`selftest FAILED (${badCount} wrong).`); process.exit(1); }
  console.log(`selftest: ${ok} assertions passed (every violation fixture rejected, valid fixture accepted).`);
  process.exit(0);
}

if (failures.length) {
  console.error('workflow contract check FAILED:');
  for (const f of failures) console.error('  ✗ ' + f);
  console.error(`\n${failures.length} violation(s).`);
  process.exit(1);
}
for (const n of notes) console.log('  · ' + n);
console.log(`workflow contract check: OK (${files().length} workflow files).`);
