#!/usr/bin/env node
/**
 * keepalive.mjs — report (and optionally nudge) the scheduled samplers.
 *
 * `keepalive.yml` now does the sampling inline, so this script's job is narrower than it first
 * was: it is the *monitor*, not the driver. It answers one question with measurements rather
 * than assertions — "when did each sampler last actually run, and is that recent enough?" — and
 * it prints the answer in a form that ends up in the Actions run summary.
 *
 * WHY A MONITOR IS NEEDED AT ALL
 * ------------------------------
 * Measured 2026-11-20 on this repository: `GET /repos/{owner}/{repo}/actions/runs?event=schedule`
 * returned nothing even though three workflows declare a cron, and `data/live/feed.json` was
 * hours old while the site said LIVE. GitHub documents both causes:
 *   * `schedule` runs can be delayed and queued jobs dropped under load;
 *   * scheduled workflows are disabled in public repos after 60 days without activity.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
 * The fix cannot be "trust the cron". It has to be "measure the cron, and make the website print
 * the measurement". `assets/freshness.js` does the second half in the browser; this does the
 * first half in CI.
 *
 * A NOTE ON DISPATCH (kept because the conclusion is evidence)
 * -----------------------------------------------------------
 * The first version listened for staleness and dispatched the other workflows. Measured result:
 * the dispatch call returned 204, but no run was created. `GITHUB_TOKEN`-created dispatches do
 * not fan out into other workflows, and a workflow file added on a non-default branch is not
 * registered at all (no entry in `GET /actions/workflows`, no runs on the branch). That is why
 * `--dispatch` is off by default and why keepalive.yml samples inline instead. Keep the flag for
 * a repository that has added the optional `SELF_DISPATCH_TOKEN` secret (a fine-grained PAT with
 * Actions: write), which is not subject to the built-in-token restriction:
 * https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
 *
 * USAGE
 *   node scripts/keepalive.mjs                          # report only
 *   node scripts/keepalive.mjs --stale-minutes 20       # change the threshold
 *   node scripts/keepalive.mjs --dispatch               # also dispatch when overdue (needs PAT)
 *   node scripts/keepalive.mjs --json                   # machine-readable
 *
 * EXIT CODES
 *   0  everything is fresh, or nothing could be verified (stated, never silent)
 *   1  something is overdue and `--dispatch` was requested but refused
 *   (This script never fails a run for staleness alone — `tools/freshness_check.mjs` owns that
 *    decision, so there is exactly one gate and not two disagreeing ones.)
 */

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const TARGETS = String(flag('targets', 'keepalive.yml,live-alerts.yml,refresh-data.yml'))
  .split(',').map((s) => s.trim()).filter(Boolean);
const STALE_MIN = Number(flag('stale-minutes', '20'));
const REF = String(flag('ref', process.env.GITHUB_REF_NAME || 'main'));
const DISPATCH = argv.includes('--dispatch');
const JSON_OUT = argv.includes('--json');

const REPO = process.env.GITHUB_REPOSITORY || 'kanlerxz87-cyber/KalshiDash1';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

function call(method, path, body) {
  const args = ['-sS', '-X', method, '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (TOKEN) args.push('-H', `Authorization: Bearer ${TOKEN}`);
  args.push('-w', '\n%{http_code}', `https://api.github.com${path}`);
  if (body) args.push('-H', 'Content-Type: application/json', '--data', '@-');
  const out = execFileSync('curl', args, {
    input: body ? JSON.stringify(body) : undefined,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  const cut = out.lastIndexOf('\n');
  const status = Number(out.slice(cut + 1).trim());
  const text = out.slice(0, cut).trim();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status, json, text };
}

const now = Date.now();
const ageMin = (iso) => (iso ? Math.round((now - Date.parse(iso)) / 60000) : null);
const human = (m) => (m === null ? 'never' : m < 1 ? 'just now'
  : m < 60 ? `${m} min ago` : m < 2880 ? `${(m / 60).toFixed(1)} h ago` : `${Math.round(m / 1440)} d ago`);

const report = [];
let hardFail = false;

for (const target of TARGETS) {
  const id = encodeURIComponent(target);
  const runs = call('GET', `/repos/${REPO}/actions/workflows/${id}/runs?per_page=20`);
  if (runs.status !== 200) {
    report.push({ workflow: target, newest: null, scheduled: null,
      verdict: `run history unreadable (HTTP ${runs.status})`, action: 'none' });
    continue;
  }
  const list = (runs.json && runs.json.workflow_runs) || [];
  const newest = list[0];
  const newestMin = newest ? ageMin(newest.created_at) : null;
  const scheduled = list.find((r) => r.event === 'schedule');
  const scheduledMin = scheduled ? ageMin(scheduled.created_at) : null;

  let verdict;
  let action = 'none';
  if (newestMin !== null && newestMin < STALE_MIN) {
    verdict = `fresh (${human(newestMin)})`;
  } else if (newestMin === null) {
    verdict = 'never run';
  } else {
    verdict = `overdue (${human(newestMin)})`;
    if (DISPATCH) {
      const res = call('POST', `/repos/${REPO}/actions/workflows/${id}/dispatches`, { ref: REF });
      const ok = res.status === 204 || res.status === 200;
      action = ok ? `dispatched on ${REF} (HTTP ${res.status})` : `dispatch refused (HTTP ${res.status})`;
      if (!ok) hardFail = true;
    }
  }
  report.push({ workflow: target, newest: newest ? newest.created_at : null, newestAge: newestMin,
    scheduled: scheduled ? scheduled.created_at : null, scheduledAge: scheduledMin, verdict, action });
}

const neverScheduled = report.every((r) => r.scheduled === null);

if (JSON_OUT) {
  console.log(JSON.stringify({ ref: REF, stale_minutes: STALE_MIN, generated_at: new Date().toISOString(),
    never_scheduled: neverScheduled, report }, null, 2));
} else {
  console.log(`keepalive monitor · ${REPO} · ref ${REF} · overdue at ${STALE_MIN} min · `
    + `${TOKEN ? 'authenticated' : 'anonymous'}${DISPATCH ? ' · dispatch enabled' : ''}\n`);
  for (const r of report) {
    console.log(`· ${r.workflow}`);
    console.log(`    newest run:      ${r.newest ? `${r.newest} → ${human(r.newestAge)}` : 'none'}`);
    console.log(`    newest SCHEDULED:${r.scheduled ? ` ${r.scheduled} → ${human(r.scheduledAge)}` : ' never fired on this repo'}`);
    console.log(`    verdict:         ${r.verdict}${r.action !== 'none' ? ` → ${r.action}` : ''}`);
  }
  if (neverScheduled) {
    console.log('\nNo `schedule` run has ever fired for these workflows. That is why '
      + 'keepalive.yml samples inline instead of relying on the cron, and why every page prints '
      + 'the measured age of the last sample.');
  }
}

const summary = [
  '### keepalive monitor — when did the samplers last actually run?',
  '',
  `Overdue threshold **${STALE_MIN} min** · ref \`${REF}\``,
  '',
  '| Workflow | Newest run | Newest *scheduled* run | Verdict |',
  '| --- | --- | --- | --- |',
  ...report.map((r) => `| \`${r.workflow}\` | ${r.newest ? human(r.newestAge) : 'never'} | `
    + `${r.scheduled ? human(r.scheduledAge) : 'never'} | ${r.verdict}${r.action !== 'none' ? ` → ${r.action}` : ''} |`),
  '',
  ...(neverScheduled ? ['> **No scheduled run has ever fired on this repository.** '
    + '`keepalive.yml` therefore samples the API inline rather than trusting the cron, and '
    + '`assets/freshness.js` prints the measured age of the last sample in the site header, so a '
    + 'stall can never be mistaken for liveness.'] : []),
  ''
].join('\n');

console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch { /* convenience only */ }
}

process.exit(hardFail ? 1 : 0);
