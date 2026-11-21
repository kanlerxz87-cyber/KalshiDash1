#!/usr/bin/env node
/**
 * rescore-feed.mjs — make the committed alert data carry the CURRENT model's verdict.
 *
 * WHY
 * ---
 * `tools/live_engine.mjs` re-scores retained alerts on every sample (F-74), because alerts persist
 * in `data/live/state.json` and a row scored by an older model would otherwise keep its verdict
 * forever. That pass only runs when the engine runs — and the committed `data/live/feed.json` is
 * what the published site reads. If the model changes and the next engine run is delayed (the
 * scheduled workflow can be late or dropped: F-55/F-58), the site keeps publishing old verdicts
 * under a new `MODEL_VERSION`. This script applies exactly the same re-score rule to the committed
 * files, and `--check` fails when they are out of date.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It never touches a price, an arrow, a delta, a timestamp or an id. It never deletes a row or
 * invents a quote. Where the verdict changes, the published one is preserved as
 * `model.original_score` / `model.original_highROI`. The age penalty that was part of the published
 * verdict is re-applied (see `rescoreAlerts()`), so a stale quote is not silently re-scored as if
 * it were fresh.
 *
 * USAGE
 * -----
 *   node scripts/rescore-feed.mjs            # rewrite data/live/feed.json and state.json in place
 *   node scripts/rescore-feed.mjs --check    # exit 1 if either file is not current (used by CI)
 *   node scripts/rescore-feed.mjs path...    # explicit files
 *
 * Offline: no network, no clock.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { rescoreAlerts, deriveLegacyUnfillable, MODEL_VERSION } from '../tools/live_engine.mjs';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const files = args.filter((a) => a !== '--check');
const targets = files.length ? files : ['data/live/feed.json', 'data/live/state.json'];

const fmt = (obj) => JSON.stringify(obj, null, 1) + '\n';
const diffOf = (a, b) => {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) out.push(`row ${i} (${a[i]?.id || b[i]?.id || '?'})`);
  }
  return out;
};

let stale = 0;
for (const file of targets) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    console.error(`✗ ${file}: cannot read (${e.code || e.message})`);
    process.exitCode = 1;
    continue;
  }
  const data = JSON.parse(raw);
  if (!Array.isArray(data.alerts)) {
    console.log(`${file}: no alerts array — nothing to re-score`);
    continue;
  }
  const before = data.alerts.map((a) => JSON.stringify(a.model ?? null));
  const next = structuredClone(data);
  const changed = rescoreAlerts(next.alerts);

  next.meta = next.meta || {};
  const previousVersion = next.meta.model_version || null;
  const versionChanged = previousVersion !== MODEL_VERSION;
  if (versionChanged && previousVersion) next.meta.model_version_previous = previousVersion;
  next.meta.model_version = MODEL_VERSION;
  /* The provenance list travels with the rows (F-77): state.json is what the engine copies forward,
   * so it has to be here as well as in feed.json or the next sample would drop it. */
  next.meta.legacy_unfillable_high_roi = deriveLegacyUnfillable(next.alerts, next.meta.legacy_unfillable_high_roi);

  const after = next.alerts.map((a) => JSON.stringify(a.model ?? null));
  const changedRows = diffOf(before, after);
  const versionAlone = versionChanged && changed === 0 && changedRows.length === 0 && fmt(next) !== fmt(data);
  const isStale = changed > 0 || versionAlone;

  if (!isStale) {
    console.log(`${file}: current (${data.alerts.length} alert row(s), model ${MODEL_VERSION})`);
    continue;
  }

  if (checkOnly) {
    stale += 1;
    console.error(`✗ ${file}: ${changed} alert row(s) do not carry ${MODEL_VERSION}'s verdict`
      + (changedRows.length ? ` — ${changedRows.slice(0, 5).join(', ')}${changedRows.length > 5 ? ', …' : ''}` : '')
      + (versionChanged ? ` (meta.model_version is ${previousVersion || 'absent'})` : ''));
    continue;
  }

  await writeFile(file, fmt(next));
  console.log(`${file}: re-scored ${changed} row(s) to ${MODEL_VERSION}`
    + (versionChanged ? ` (was ${previousVersion || 'absent'})` : '')
    + '; prices, arrows, timestamps and ids unchanged');
  for (const a of next.alerts) {
    if (a.model && a.model.original_score !== undefined) {
      console.log(`  ${a.id}  ${a.model.original_score} -> ${a.model.score}  highROI ${a.model.original_highROI} -> ${a.model.highROI}`);
    }
  }
}

if (checkOnly && stale) {
  console.error(`\nFAILED — ${stale} file(s) carry a verdict from a previous model.`);
  console.error('Run: node scripts/rescore-feed.mjs');
  process.exit(1);
}
if (process.exitCode) process.exit(process.exitCode);
console.log(checkOnly
  ? `the committed alert data carries ${MODEL_VERSION}'s verdict.`
  : 'done.');
