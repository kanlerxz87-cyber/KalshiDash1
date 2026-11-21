#!/usr/bin/env node
/** Offline model migration, NOT a new API capture.
 * Re-score the same published observations in feed.json and state.json with the
 * current engine. Keep sample times, quotes, ids and original model verdicts.
 * Used when integrating PR #72 over a newer main-branch data capture.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { modelScore, num, MODEL_VERSION } from '../tools/live_engine.mjs';

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['data/live/feed.json', 'data/live/state.json'];
for (const file of files) {
  const doc = JSON.parse(await readFile(file, 'utf8'));
  const original = JSON.stringify(doc);
  let changed = 0;
  for (const a of doc.alerts || []) {
    if (!a.model || a.model.score === null || a.model.score === undefined) continue;
    const next = modelScore({ from: a.from, to: a.to, delta: a.delta, direction: a.direction,
      bid: num(a.yes_bid_dollars), ask: num(a.yes_ask_dollars), volume24h: num(a.volume_24h_fp), sampleAgeSeconds: 0 });
    if (a.model.score !== next.score || a.model.highROI !== next.highROI) {
      if (a.model.original_score === null || a.model.original_score === undefined) {
        a.model.original_score = a.model.score;
        a.model.original_highROI = a.model.highROI;
        a.model.original_model_version = doc.meta?.model_version || 'unrecorded';
      }
      Object.assign(a.model, next);
      changed++;
    } else if (a.model.tradeable === undefined) {
      a.model.tradeable = next.tradeable;
    }
  }
  doc.meta = doc.meta || {};
  doc.meta.model_version = MODEL_VERSION;
  doc.meta.offline_model_migration = {
    script: 'scripts/rescore-persisted-model.mjs',
    model: MODEL_VERSION,
    note: 'Model-only recalculation over the recorded quotes. Not a fresh API sample; generated_at and all observed market values are unchanged.',
  };
  if (doc.meta.legacy_unfillable_note) {
    doc.meta.legacy_unfillable_note = 'Rows originally labelled high ROI by the previous model, but not corroborated by their recorded quotes. '
      + 'Current scores are recalculated; original_score and original_highROI preserve the original verdict. No quote is backfilled from a later book.';
  }
  if (original !== JSON.stringify(doc)) await writeFile(file, JSON.stringify(doc, null, 1) + '\n');
  console.log(`${file}: ${changed} verdict(s) changed; sample time unchanged (${doc.meta.generated_at || 'not recorded'})`);
}
