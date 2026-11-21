#!/usr/bin/env node
/**
 * check-keepalive-verdict.mjs — offline regression test for the monitor's freshness verdict.
 *
 * The fixtures below are REAL workflow-run histories read from the GitHub API on 2026-11-21,
 * not invented shapes, because the bug being pinned was invisible to the old logic: a push
 * triggered a run that failed within a minute, and "newest run = 1 min ago" was reported as
 * `fresh` while every scheduled run of the same workflow had failed and the last successful run
 * was hours old.
 *
 * Run: node scripts/check-keepalive-verdict.mjs        (no network, no dependencies)
 */
import { assessRuns, humanAge } from './keepalive-verdict.mjs';

const NOW = Date.parse('2026-11-21T06:38:00Z');
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) { pass += 1; } else { fails.push(label); } };

/* ------------------------------------------------------------------------------------------
 * Fixture 1 — live-alerts.yml as actually observed at 06:38Z on 2026-11-21.
 * Newest run: a push run that was created 06:27:20Z and did not succeed.
 * Newest SCHEDULED run: 02:54:41Z, failed.
 * ---------------------------------------------------------------------------------------- */
const liveAlerts = [
  { event: 'push', status: 'completed', conclusion: 'failure', created_at: '2026-11-21T06:27:20Z' },
  { event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-21T02:54:41Z' },
  { event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-20T21:52:18Z' },
  { event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-11-20T19:44:59Z' },
];

const a = assessRuns(liveAlerts, { staleMinutes: 20, now: NOW });
ok(a.failing === true, 'a failing newest run is reported as failing');
ok(a.ok === false, 'a failing newest run is never "ok"');
ok(/^FAILING/.test(a.verdict), `verdict starts with FAILING (got: ${a.verdict})`);
ok(!/^fresh/.test(a.verdict), 'the old bug — calling a dead sampler "fresh" — cannot recur');
ok(a.newestAge === 11, `newest run age is the measured 11 min (got ${a.newestAge})`);
ok(a.verdict.includes('11 min ago'), 'verdict quotes the measured age');
ok(a.newestScheduledConclusion === 'failure', 'the newest scheduled conclusion is kept for the summary');
ok(a.newestScheduledSuccess === null, 'no scheduled run has ever succeeded in this fixture');
/* 02:54:41Z → 06:38:00Z is 223 min = 3.717 h, which formats as "3.7 h ago". The point of the
 * assertion is that the newest SCHEDULED failure is hours old while the newest *run* was a
 * minute old — the discrepancy the old verdict ignored. */
ok(humanAge(a.newestScheduledAge) === '3.7 h ago',
  `newest scheduled run age is measured as 3.7 h (got ${humanAge(a.newestScheduledAge)})`);

/* ------------------------------------------------------------------------------------------
 * Fixture 2 — the same workflow once the `fi` repair lands on main and a scheduled run succeeds.
 * ---------------------------------------------------------------------------------------- */
const recovered = [
  { event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-11-21T06:30:00Z' },
  { event: 'push', status: 'completed', conclusion: 'failure', created_at: '2026-11-21T06:27:20Z' },
  { event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-21T02:54:41Z' },
];
const b = assessRuns(recovered, { staleMinutes: 20, now: NOW });
ok(b.ok === true, 'a successful recent scheduled run is ok');
ok(b.failing === false, 'not failing when the newest run succeeded');
ok(b.scheduledStale === false, 'a recent successful scheduled run is not scheduled-stale');
ok(/^fresh/.test(b.verdict), `verdict is fresh (got: ${b.verdict})`);

/* ------------------------------------------------------------------------------------------
 * Fixture 2b — THE case measured at 06:38Z on 2026-11-21, one level up from fixture 1.
 * `live-alerts.yml` had a push run that SUCCEEDED 2 minutes earlier (the merge run) while its
 * newest SCHEDULED attempt was a failure 3.6 h old. Calling that "fresh" would be the same
 * mistake as calling a failed run fresh: the cron-driven sampler is not publishing.
 * ---------------------------------------------------------------------------------------- */
const pushOnlyRecent = [
  { event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-11-21T06:28:38Z' },
  { event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-21T02:54:41Z' },
];
const b2 = assessRuns(pushOnlyRecent, { staleMinutes: 20, now: NOW });
ok(b2.ok === false, 'a recent successful PUSH run does not make a dead cron healthy');
ok(b2.scheduledStale === true, 'scheduled-stale is detected when the cron attempt is old/failed');
ok(/scheduled run 3\.7 h ago \(failure\)/.test(b2.verdict),
  `verdict names the stale scheduled attempt (got: ${b2.verdict})`);
ok(!/dispatched/.test(b2.verdict), 'no action is fabricated in the verdict text');

/* A workflow with no cron must not be punished for having no scheduled runs. */
const b3 = assessRuns(
  [{ event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-11-21T06:28:38Z' }],
  { staleMinutes: 20, now: NOW, expectSchedule: false }
);
ok(b3.ok === true, 'expectSchedule:false keeps a non-cron workflow healthy');

/* ------------------------------------------------------------------------------------------
 * Fixture 3 — in-progress runs must not be treated as evidence of anything.
 * A run that is still queued cannot prove the sampler works, and counting it as "newest"
 * would let a permanently-stuck queue look busy forever.
 * ---------------------------------------------------------------------------------------- */
const inFlight = [
  { event: 'push', status: 'in_progress', conclusion: null, created_at: '2026-11-21T06:37:00Z' },
  { event: 'schedule', status: 'queued', conclusion: null, created_at: '2026-11-21T06:36:00Z' },
  { event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-21T02:54:41Z' },
];
const c = assessRuns(inFlight, { staleMinutes: 20, now: NOW });
ok(c.newest === '2026-11-21T02:54:41Z', 'unfinished runs are ignored when picking the newest concluded run');
ok(c.failing === true, 'a failed last concluded run is failing even while others are queued');
ok(c.ok === false, 'queued runs do not make an unhealthy sampler healthy');

/* ------------------------------------------------------------------------------------------
 * Fixture 4 — edges.
 * ---------------------------------------------------------------------------------------- */
const d = assessRuns([], { now: NOW });
ok(d.verdict === 'never run' && d.ok === false, 'no runs at all → "never run", not ok');

const e = assessRuns(
  [{ event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-11-21T05:00:00Z' }],
  { staleMinutes: 20, now: NOW }
);
ok(e.ok === false && /^overdue/.test(e.verdict), 'a successful but old run is overdue, not fresh');

const f = assessRuns(
  [{ event: 'schedule', status: 'completed', conclusion: 'cancelled', created_at: '2026-11-21T06:37:00Z' }],
  { staleMinutes: 20, now: NOW }
);
ok(f.ok === false, 'a cancelled (non-success) conclusion is not fresh');
ok(f.verdict.startsWith('FAILING'), 'a cancelled newest run is reported, not glossed over');

/* A missing/unparseable timestamp must never become "fresh". */
const g = assessRuns([{ event: 'schedule', status: 'completed', conclusion: 'success', created_at: 'nonsense' }],
  { staleMinutes: 20, now: NOW });
ok(g.ok === false, 'an unparseable timestamp cannot pass the freshness gate');
ok(g.newestAge === null, 'an unparseable timestamp yields null age, never a default of 0');

console.log(`\nkeepalive verdict checks: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('All keepalive verdict checks passed.');
