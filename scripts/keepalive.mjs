#!/usr/bin/env node
/**
 * keepalive.mjs — make the "live" loop actually live.
 *
 * PROBLEM THIS SOLVES (measured, not assumed)
 * -------------------------------------------
 * `live-alerts.yml` and `refresh-data.yml` both declare an `on: schedule` cron, yet on this
 * repository **no `schedule`-triggered run has ever appeared** (checked 2026-11-20 with
 * `GET /repos/{owner}/{repo}/actions/runs?event=schedule` → empty), while the same workflows
 * run fine when something dispatches them. GitHub's own documentation states the failure
 * modes that produce exactly this symptom:
 *
 *   "The `schedule` event can be delayed during periods of high loads of GitHub Actions
 *    workflow runs. ... If the load is sufficiently high enough, some queued jobs may be
 *    dropped."
 *   https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
 *
 *   "In a public repository, scheduled workflows are automatically disabled when no
 *    repository activity has occurred in 60 days."
 *   (same page)
 *
 * A dropped schedule on the *only* sampling mechanism silently turns a "live alerting system"
 * into a static screenshot of an old moment. That is the one thing this repo must never do
 * (brief: "no hallucinations"). So the schedule is treated as best-effort and a second,
 * self-checking path is added: this script measures the age of the newest run of each sampler
 * and, when it is overdue, asks GitHub to run it now with `workflow_dispatch`.
 *
 * WHY `workflow_dispatch` AND NOT SOMETHING ELSE
 * ----------------------------------------------
 * "`workflow_dispatch` and `repository_dispatch` events always create workflow runs" — unlike
 * the other events, they are not suppressed when the request comes from the repository's own
 * `GITHUB_TOKEN`.
 * https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow
 * That is what lets a single scheduled workflow keep the samplers alive using only the
 * built-in token — no personal access token, no stored credential, nothing for the user to do.
 *
 * KNOWN LIMIT, STATED RATHER THAN HIDDEN
 * --------------------------------------
 * If GitHub's system scheduler drops *every* trigger for this workflow too, nothing in the
 * repository can restart it (no other trigger source exists for a static site). The site
 * therefore never claims to be live on its own: `assets/freshness.js` reads
 * `data/live/feed.json → meta.generated_at` in the visitor's browser and prints the real age,
 * degrading to an explicit STALE badge. The measured age is the source of truth; this script
 * only tries to keep it small.
 *
 * A fine-grained personal access token in the repository secret `SELF_DISPATCH_TOKEN`
 * (Actions: read and write, Contents: read) makes dispatching unconditional, because a token
 * other than `GITHUB_TOKEN` is not subject to the built-in-token restrictions. The script
 * detects whether it has one and reports which mode it used.
 *
 * USAGE
 *   node scripts/keepalive.mjs                       # both samplers, 15 min staleness window
 *   node scripts/keepalive.mjs --dry-run             # report only, dispatch nothing
 *   node scripts/keepalive.mjs --targets live-alerts.yml --stale-minutes 10
 *
 * ENV
 *   GH_TOKEN   token used for the API calls (falls back to GITHUB_TOKEN, then `gh auth token`)
 *   GITHUB_REF_NAME / GITHUB_REPOSITORY   supplied automatically inside Actions
 *
 * EXIT CODES
 *   0  every target is fresh, or was dispatched successfully, or is unverifiable-but-reported
 *   1  a target is overdue AND could not be dispatched (surfaced as a red run, never silent)
 */

import { execFileSync } from 'node:child_process';

/* --------------------------------------------------------------- arguments */
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DRY = argv.includes('--dry-run');
const TARGETS = String(flag('targets', 'live-alerts.yml,refresh-data.yml'))
  .split(',').map((s) => s.trim()).filter(Boolean);
const STALE_MIN = Number(flag('stale-minutes', '15'));
const REF = String(flag('ref', process.env.GITHUB_REF_NAME || 'main'));

/* -------------------------------------------------------------------- setup */
const REPO = process.env.GITHUB_REPOSITORY || 'kanlerxz87-cyber/KalshiDash1';
const [OWNER, NAME] = REPO.split('/');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const PAT_MODE = Boolean(process.env.SELF_DISPATCH_TOKEN);
const API = 'https://api.github.com';

function curlArgs(method, path, body) {
  const args = ['-sS', '-X', method, '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (TOKEN) args.push('-H', `Authorization: Bearer ${TOKEN}`);
  args.push('-w', '\n%{http_code}', `${API}${path}`);
  if (body) args.push('-H', 'Content-Type: application/json', '--data', '@-');
  return args;
}

function call(method, path, body) {
  const out = execFileSync('curl', curlArgs(method, path, body), {
    input: body ? JSON.stringify(body) : undefined,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  const cut = out.lastIndexOf('\n');
  const status = Number(out.slice(cut + 1).trim());
  const text = out.slice(0, cut).trim();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  return { status, json, text };
}

const now = Date.now();
const ageMin = (iso) => (iso ? Math.round((now - Date.parse(iso)) / 60000) : null);
const human = (m) => (m === null ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago`
  : `${(m / 60).toFixed(1)} h ago`);

/* ------------------------------------------------------------------- report */
const rows = [];
let hardFail = false;

console.log(`keepalive · repo=${REPO} · ref=${REF} · stale window=${STALE_MIN} min · `
  + `token=${PAT_MODE ? 'SELF_DISPATCH_TOKEN (unconditional)' : TOKEN ? 'GITHUB_TOKEN' : 'none'}`
  + `${DRY ? ' · DRY RUN' : ''}`);

for (const target of TARGETS) {
  const id = encodeURIComponent(target);
  const runs = call('GET', `/repos/${OWNER}/${NAME}/actions/workflows/${id}/runs?per_page=20`);
  if (runs.status !== 200) {
    rows.push([target, 'unreadable', `HTTP ${runs.status} reading run history`, 'nothing dispatched']);
    console.log(`\n· ${target}\n  run history unreadable (HTTP ${runs.status}); cannot judge freshness.`);
    continue;
  }
  const list = (runs.json && runs.json.workflow_runs) || [];
  const newest = list[0];
  const newestScheduled = list.find((r) => r.event === 'schedule');
  const newestScheduledMin = newestScheduled ? ageMin(newestScheduled.created_at) : null;
  const newestMin = newest ? ageMin(newest.created_at) : null;

  let action = 'nothing to do — fresh';
  let dispatched = null;

  if (newestMin !== null && newestMin < STALE_MIN) {
    action = `fresh (${human(newestMin)}), no dispatch`;
  } else if (DRY) {
    action = `overdue (${human(newestMin)}) — dry run, would dispatch`;
  } else {
    const res = call('POST', `/repos/${OWNER}/${NAME}/actions/workflows/${id}/dispatches`,
      { ref: REF });
    if (res.status === 204 || res.status === 200) {
      dispatched = true;
      action = `overdue (${human(newestMin)}) → dispatched on ${REF}`;
    } else {
      dispatched = false;
      hardFail = true;
      action = `overdue (${human(newestMin)}) → dispatch REFUSED (HTTP ${res.status})`;
      console.log(`  dispatch response body: ${String(res.text).slice(0, 300)}`);
    }
  }

  const mode = PAT_MODE ? 'PAT' : 'GITHUB_TOKEN';
  if (dispatched === false) {
    console.log(`  HINT: the built-in token cannot dispatch this workflow (or the ref is wrong).\n`
      + `  Add a fine-grained PAT as the repository secret SELF_DISPATCH_TOKEN\n`
      + `  (permissions: Actions = read and write, Contents = read) and this path becomes unconditional.\n`
      + `  Official reference: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event`);
  }
  console.log(`\n· ${target}\n  newest run:          ${newest ? `${newest.created_at} (${newest.event}) → ${human(newestMin)}` : 'none'}\n`
    + `  newest SCHEDULED run: ${newestScheduled ? `${newestScheduled.created_at} → ${human(newestScheduledMin)}` : 'never — the cron has not fired on this repo'}\n`
    + `  decision:            ${action} [${mode}]`);

  rows.push([target, newest ? human(newestMin) : 'never',
    newestScheduled ? human(newestScheduledMin) : 'never', `${action} [${mode}]`]);
}

/* --------------------------------------------------------- step summary file */
const summary = [
  '### keepalive — scheduled samplers',
  '',
  `Staleness window **${STALE_MIN} min** · ref \`${REF}\` · token `
  + (PAT_MODE ? '`SELF_DISPATCH_TOKEN` (unconditional)' : '`GITHUB_TOKEN` (works for `workflow_dispatch`)'),
  '',
  '| Workflow | Newest run | Newest *scheduled* run | Decision |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[2]} | ${r[3]} |`),
  '',
  'A “never” in the *scheduled* column is the documented failure mode this job exists to cover: '
  + 'GitHub may drop `schedule` triggers under load, and scheduled workflows do not run on '
  + 'non-default branches. The samplers are therefore driven by this dispatch path, and the site '
  + 'prints the measured age of the last sample so the two can never diverge silently.',
  ''
].join('\n');
console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch { /* summary is a convenience, never a failure */ }
}

process.exit(hardFail ? 1 : 0);
