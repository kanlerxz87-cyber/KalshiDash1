#!/usr/bin/env node
/* annotate-legacy-unfillable.mjs — record, in the committed feed, every PRE-FIX high-ROI row
 * whose swing the published book did not corroborate.
 *
 * WHY: on 2026-11-21 the feed's high-ROI pane was topped by `$0.01 -> $0.97` and
 * `$0.803 -> $0.003` rows whose YES ask/bid sat at the opposite end of the book. The model is
 * fixed (followThrough gate in tools/live_engine.mjs), but the already-published rows are real
 * recorded data and must not be silently rewritten or deleted. They are labelled here, in
 * `meta.legacy_unfillable_high_roi`, so the page can mark them and `check_alerts.mjs` can
 * require an entry for each one.
 *
 * This script changes NOTHING about a row: no price, no arrow, no timestamp, no score. It only
 * appends a provenance list. Re-running it is idempotent.
 *
 *   node scripts/annotate-legacy-unfillable.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { followThrough, modelScore } from '../tools/live_engine.mjs';

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['data/live/feed.json'];

for (const file of files) {
  const feed = JSON.parse(await readFile(file, 'utf8'));
  const rows = (feed.alerts || []).filter((a) => a.model && a.model.highROI);
  const legacy = [];
  let relabelled = 0;
  /* Candidate rows are (a) anything currently labelled high ROI, (b) anything previously
   * relabelled by this script and (c) anything whose ORIGINAL (pre-fix) verdict was high ROI,
   * which is how `scripts/rescore-feed.mjs` records a re-score. (b) and (c) are what make a re-run
   * idempotent: without them a second run would see highROI:false, skip the row, and then publish
   * an empty legacy list, silently dropping the provenance record. (Found by running the script
   * twice; (c) added by session-4b5ddd87 after a model re-score moved the rows out of (a).) */
  const candidates = (feed.alerts || []).filter((a) => a.model
    && (a.model.highROI || a.model.relabelled_by || a.model.original_highROI === true));
  rows.length = 0;
  rows.push(...candidates);
  for (const a of rows) {
    const ft = followThrough({ direction: a.direction, to: a.to, bid: num(a.yes_bid_dollars), ask: num(a.yes_ask_dollars) });
    if (ft.ok === false) {
      /* The data must stop CLAIMING high ROI, not merely be filtered in the view: otherwise
       * `model.highROI` would be a false statement, and the feed is the published artifact.
       * The original score and label are preserved verbatim for audit. */
      /* Preserve the v1 numbers verbatim (never overwritten), then replace the live score with
       * what the CURRENT model returns for the same row. Recomputing rather than forcing a
       * number keeps the published score consistent with the score-vs-label check in
       * scripts/check_alerts.mjs: a capped 0.30 cannot be labelled high ROI. */
      if (a.model.original_score === undefined || a.model.original_score === null) {
        a.model.original_highROI = a.model.highROI;
        a.model.original_score = a.model.score;
        a.model.original_model_version = 'heuristic-v1';
      }
      const v2 = modelScore({
        from: a.from, delta: a.delta, direction: a.direction, to: a.to,
        bid: num(a.yes_bid_dollars), ask: num(a.yes_ask_dollars),
        volume24h: num(a.volume_24h_fp), sampleAgeSeconds: 0,
      });
      const changed = a.model.score !== v2.score || a.model.highROI !== v2.highROI;
      a.model.score = v2.score;
      a.model.highROI = v2.highROI;
      a.model.tradeable = v2.tradeable;
      a.model.reasons = v2.reasons;
      a.model.relabelled_by = 'scripts/annotate-legacy-unfillable.mjs (2026-11-21)';
      if (changed) relabelled += 1;
      legacy.push({
        id: a.id,
        ticker: a.ticker,
        ts: a.ts,
        direction: a.direction,
        from: a.from,
        to: a.to,
        yes_bid_dollars: a.yes_bid_dollars ?? null,
        yes_ask_dollars: a.yes_ask_dollars ?? null,
        published_score: a.model.original_score,
        reason: ft.note,
        detected_by: 'scripts/annotate-legacy-unfillable.mjs',
      });
    }
  }
  feed.meta = feed.meta || {};
  const before = JSON.stringify(feed.meta.legacy_unfillable_high_roi || []);
  /* Idempotency: if the list is already current AND nothing needs relabelling, do not rewrite. */
  const already = before === JSON.stringify(legacy) && relabelled === 0;
  feed.meta.legacy_unfillable_high_roi = legacy;
  feed.meta.legacy_unfillable_note =
    'High-ROI rows published by model heuristic-v1 before the follow-through gate existed. '
    + 'The published bid/ask at detection did not corroborate the swing price, so these rows are kept '
    + 'as recorded history but are marked "not tradeable" on the page and excluded from the live '
    + 'high-ROI ranking. Their score is the ORIGINAL v1 score and is labelled as such.';
  if (already) {
    console.log(`${file}: unchanged (${legacy.length} legacy unfillable high-ROI row(s) already annotated)`);
  } else {
    await writeFile(file, JSON.stringify(feed, null, 1) + '\n');
    console.log(`${file}: annotated ${legacy.length} legacy row(s); relabelled ${relabelled} out of the high-ROI pane`);
  }
  for (const l of legacy) console.log(`  ${l.id}  score ${l.published_score}  ${l.reason}`);
}
