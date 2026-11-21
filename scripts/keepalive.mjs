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
import { assessRuns, humanAge } from './keepalive-verdict.mjs';

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
/* --strict makes an unhealthy sampler fail the run (used by keepalive.yml's own pulse).
 * --exclude-self drops the workflow that is currently executing from the gate, because a
 * workflow cannot observe its own successful completion while it is still running; it would
 * otherwise always look "overdue" to itself. */
const STRICT = argv.includes('--strict');
const EXCLUDE_SELF = argv.includes('--exclude-self');
const SELF = process.env.KEEPALIVE_SELF || 'keepalive.yml';

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
const human = humanAge;

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
  /* The verdict is no longer "how old is the newest run". It is "did a run actually SUCCEED
   * recently", computed in scripts/keepalive-verdict.mjs and covered by an offline test.
   * The measured reason for the change: on 2026-11-21 06:38Z this monitor reported
   * `live-alerts.yml` and `refresh-data.yml` as `fresh (1 min ago)` while every scheduled run of
   * both had failed and their last successful runs were hours old. See that module's header. */
  const isSelf = EXCLUDE_SELF && target === SELF;
  const v = assessRuns(list, { staleMinutes: STALE_MIN, now });

  let verdict = isSelf && v.verdict.startsWith('overdue')
    ? `${v.verdict} (this workflow is still running — not self-gating)`
    : v.verdict;
  let action = 'none';

  const unhealthy = !v.ok && !isSelf;
  if (unhealthy && DISPATCH) {
    const res = call('POST', `/repos/${REPO}/actions/workflows/${id}/dispatches`, { ref: REF });
    const dispatched = res.status === 204 || res.status === 200;
    action = dispatched ? `dispatched on ${REF} (HTTP ${res.status})` : `dispatch refused (HTTP ${res.status})`;
    if (!dispatched) hardFail = true;
  }
  /* A dispatch cannot repair a failing *script*; it only re-runs it. So strict mode reports the
   * failure rather than pretending the dispatch fixed it. */
  if (unhealthy && STRICT) hardFail = true;

  report.push({ workflow: target, newest: v.newest, newestAge: v.newestAge,
    newestConclusion: v.newestConclusion,
    scheduled: v.newestScheduled, scheduledAge: v.newestScheduledAge,
    scheduledConclusion: v.newestScheduledConclusion,
    newestSuccess: v.newestSuccess, newestSuccessAge: v.newestSuccessAge,
    failing: v.failing, scheduledStale: v.scheduledStale, ok: v.ok, verdict, action });
}

const neverScheduled = report.every((r) => r.scheduled === null);
const failingCount = report.filter((r) => r.failing || r.scheduledStale).length;

if (JSON_OUT) {
  console.log(JSON.stringify({ ref: REF, stale_minutes: STALE_MIN, generated_at: new Date().toISOString(),
    never_scheduled: neverScheduled, unhealthy: failingCount, strict: STRICT, report }, null, 2));
} else {
  console.log(`keepalive monitor · ${REPO} · ref ${REF} · overdue at ${STALE_MIN} min · `
    + `${TOKEN ? 'authenticated' : 'anonymous'}${DISPATCH ? ' · dispatch enabled' : ''}`
    + `${STRICT ? ' · strict (fails on an unhealthy sampler)' : ''}\n`);
  for (const r of report) {
    console.log(`· ${r.workflow}`);
    console.log(`    newest run:      ${r.newest ? `${r.newest} → ${human(r.newestAge)} (${r.newestConclusion})` : 'none'}`);
    console.log(`    newest SUCCESS:  ${r.newestSuccess ? `${r.newestSuccess} → ${human(r.newestSuccessAge)}` : 'none on record'}`);
    console.log(`    newest SCHEDULED:${r.scheduled ? ` ${r.scheduled} → ${human(r.scheduledAge)} (${r.scheduledConclusion})` : ' never fired on this repo'}`);
    console.log(`    verdict:         ${r.verdict}${r.action !== 'none' ? ` → ${r.action}` : ''}`);
  }
  if (failingCount) {
    console.log(`\n${failingCount} of ${report.length} workflows are not publishing as scheduled `
      + '(failing, or no recent successful scheduled run). See the FAILING rows above.');
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
  '| Workflow | Newest run | Newest **successful** run | Newest *scheduled* run | Verdict |',
  '| --- | --- | --- | --- | --- |',
  ...report.map((r) => `| \`${r.workflow}\` | ${r.newest ? `${human(r.newestAge)} (${r.newestConclusion})` : 'never'} | `
    + `${r.newestSuccess ? human(r.newestSuccessAge) : '**none**'} | `
    + `${r.scheduled ? `${human(r.scheduledAge)} (${r.scheduledConclusion})` : 'never'} | `
    + `${r.verdict}${r.action !== 'none' ? ` → ${r.action}` : ''} |`),
  '',
  ...(report.some((r) => r.failing)
    ? ['> **A scheduled sampler is FAILING.** A run that ran and failed is not freshness: the '
      + 'rows marked `FAILING` above ran recently but did not succeed, so the data they were '
      + 'supposed to publish may not have advanced. This monitor previously reported those rows '
      + 'as `fresh` because it looked only at run age. See `scripts/keepalive-verdict.mjs`.']
    : []),
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
