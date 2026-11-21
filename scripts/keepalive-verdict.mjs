/**
 * keepalive-verdict.mjs — decide whether a scheduled sampler is *actually* healthy.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * It used to live inline in `scripts/keepalive.mjs` and it judged a workflow purely by the AGE
 * of its newest run. Measured consequence on 2026-11-21 06:38Z, on `main`:
 *
 *     · live-alerts.yml
 *         newest run:       2026-11-21T06:27:20Z   → 1 min ago
 *         newest SCHEDULED: 2026-11-21T02:54:41Z   → 3.6 h ago
 *         verdict:          fresh (1 min ago)          <-- WRONG
 *
 * Every scheduled run of that workflow had failed (exit 2, missing `fi`), and the "1 min ago"
 * run was an unrelated `push` triggered by another session's commit. The monitor printed
 * "fresh" directly above its own evidence that the sampler had not succeeded in 3.6 hours.
 * A monitor that reports a dead sampler as fresh is worse than no monitor: it is the thing the
 * "the site must never claim to be live on its own" guarantee depends on.
 *
 * THE RULE
 * --------
 * Freshness is a property of a *successful* run, never of any run:
 *   * `fresh`    — the newest concluded run succeeded AND is younger than the threshold;
 *   * `FAILING`  — the newest concluded run did not succeed. Reported even when that run is
 *                  seconds old, because "the job just ran and broke" is not freshness;
 *   * `overdue`  — the newest concluded run succeeded but is older than the threshold;
 *   * `never run`— no concluded run exists.
 * Runs that are still queued or in progress are ignored when picking "newest", because a run
 * that has not finished cannot be evidence that anything worked.
 *
 * Run conclusions are the ones GitHub documents on the workflow-run object:
 * https://docs.github.com/en/rest/actions/workflow-runs  (conclusion: success | failure |
 * cancelled | neutral | skipped | timed_out | action_required | stale | startup_failure)
 */

export const ACTIVE_STATUSES = new Set(['in_progress', 'queued', 'requested', 'waiting', 'pending']);

export function humanAge(min) {
  if (min === null || min === undefined) return 'never';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 2880) return `${(min / 60).toFixed(1)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

function ageMinutes(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/**
 * @param {Array} runs  GitHub workflow_run objects, newest first (as the API returns them).
 * @param {{staleMinutes?: number, now?: number}} opts
 */
export function assessRuns(runs, { staleMinutes = 20, now = Date.now(), expectSchedule = true } = {}) {
  const concluded = (Array.isArray(runs) ? runs : []).filter((r) => r && !ACTIVE_STATUSES.has(r.status));

  const newest = concluded[0] || null;
  const newestSuccess = concluded.find((r) => r.conclusion === 'success') || null;
  const newestScheduled = concluded.find((r) => r.event === 'schedule') || null;
  const newestScheduledSuccess =
    concluded.find((r) => r.event === 'schedule' && r.conclusion === 'success') || null;

  const newestAge = newest ? ageMinutes(newest.created_at, now) : null;
  const successAge = newestSuccess ? ageMinutes(newestSuccess.created_at, now) : null;
  const scheduledAge = newestScheduled ? ageMinutes(newestScheduled.created_at, now) : null;
  const scheduledSuccessAge = newestScheduledSuccess
    ? ageMinutes(newestScheduledSuccess.created_at, now)
    : null;

  let verdict;
  let failing = false;
  let scheduledStale = false;

  if (!newest) {
    verdict = 'never run';
  } else if (newest.conclusion !== 'success') {
    /* The most recent attempt did not succeed. This is the case that used to be mislabelled
     * "fresh"; it is always reported as failing, whatever its age. */
    failing = true;
    const lastOk = newestSuccess
      ? `last success ${humanAge(successAge)}`
      : 'no successful run on record';
    verdict = `FAILING — latest run ${newest.conclusion || 'unknown'} ${humanAge(newestAge)}; ${lastOk}`;
  } else if (newestAge !== null && newestAge < staleMinutes) {
    verdict = `fresh (${humanAge(newestAge)})`;
  } else {
    verdict = `overdue (${humanAge(newestAge)})`;
  }

  /* A workflow whose *scheduled* runs are all failing is not publishing, even when some
   * unrelated `push` run of it happened to succeed. Measured on 2026-11-21: `live-alerts.yml`
   * had `newest run → 2 min ago (success)` while `newest SCHEDULED → 3.6 h ago (failure)`.
   * Reporting that as a healthy sampler is the same mistake as reporting a failed run as fresh,
   * one level up. So a scheduled sampler that is expected to run on a cron but whose newest
   * scheduled attempt is older than the window is a problem, regardless of push-run success.
   * (A workflow that declares no cron is not penalised: pass `expectSchedule: false`.) */
  scheduledStale = Boolean(
    expectSchedule && (!newestScheduled || (scheduledAge !== null && scheduledAge >= staleMinutes))
  );

  if (scheduledStale && !failing && newest) {
    verdict += newestScheduled
      ? ` · scheduled run ${humanAge(scheduledAge)} (${newestScheduled.conclusion})`
      : ' · no scheduled run on record';
  }


  /* `ok` is the gate: the sampler itself succeeded within the window. A concurrently running
   * copy of the workflow doing the observing is excluded by the caller — a workflow cannot
   * observe its own success while it is still running. */
  const ok = !failing && !scheduledStale && successAge !== null && successAge < staleMinutes;

  return {
    newest: newest ? newest.created_at : null,
    newestAge,
    newestConclusion: newest ? newest.conclusion : null,
    newestEvent: newest ? newest.event : null,
    newestSuccess: newestSuccess ? newestSuccess.created_at : null,
    newestSuccessAge: successAge,
    newestScheduled: newestScheduled ? newestScheduled.created_at : null,
    newestScheduledAge: scheduledAge,
    newestScheduledConclusion: newestScheduled ? newestScheduled.conclusion : null,
    newestScheduledSuccess: newestScheduledSuccess ? newestScheduledSuccess.created_at : null,
    newestScheduledSuccessAge: scheduledSuccessAge,
    failing,
    scheduledStale,
    ok,
    verdict,
  };
}
