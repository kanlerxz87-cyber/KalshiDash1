#!/usr/bin/env node
/**
 * freshness_check.mjs — the staleness gate for the "live" claim.
 *
 * The alert feed is a committed JSON file that a scheduled job refreshes. The failure mode that
 * matters is not a crash (crashes are loud) but a *silent stall*: the file stops changing and the
 * site keeps calling itself live. This script makes the stall loud.
 *
 * WHAT IT CHECKS
 *   1. `data/live/feed.json` parses and carries `meta.generated_at` (the engine always writes it;
 *      see tools/live_engine.mjs).
 *   2. Its age against the *current* clock is within the stale limit.
 *   3. Every alert in the feed keeps its provenance: a `source_url` and, when the engine recorded
 *      one, a `market`/`ticker`. An alert without a source is a bug, not a row.
 *   4. No alert sits below the $0.10 swing threshold. The product promise is "≥ $0.10 in either
 *      direction"; a row under it would be a false alert.
 *   5. No NaN / undefined / "null" leaked into a numeric field (renders as a fake price).
 *
 * NETWORK IS OPTIONAL. When `--branch` is supplied and a token is available, the script also
 * compares the committed file with the version on that branch, so a run that is about to pass
 * because it read a locally stale checkout cannot do so. When the API is unreachable it says so
 * and checks the local file only — it never silently passes a network check.
 *
 * EXIT CODES
 *   0  fresh + structurally valid
 *   1  stale, malformed, or an alert that breaks the product promise
 *
 * SOURCES for the rules implemented here:
 *   * Swing threshold and alert shape: this project's brief + tools/live_engine.mjs thresholds.
 *   * `result` is "yes" | "no" | "scalar" and settlement pays $1 per winning contract:
 *     https://docs.kalshi.com/getting_started/market_settlement
 *   * Market lifecycle (active → closed → determined → finalized):
 *     https://docs.kalshi.com/getting_started/market_lifecycle
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const BRANCH = flag('branch', process.env.GITHUB_REF_NAME || '');
const WARN = Number(flag('warn-minutes', '20'));
const STALE = Number(flag('stale-minutes', '45'));
const THRESHOLD = 0.10;
const FEED_PATH = 'data/live/feed.json';

const problems = [];
const notes = [];

function readJsonLocal(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/* Prefer the branch copy when we can get it: a checkout can be behind origin. */
function readFeed() {
  if (BRANCH && process.env.GH_TOKEN) {
    try {
      const out = execFileSync('curl', ['-sS', '-f', '-H', 'Accept: application/vnd.github.raw',
        '-H', `Authorization: Bearer ${process.env.GH_TOKEN}`,
        `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || 'kanlerxz87-cyber/KalshiDash1'}/contents/${FEED_PATH}?ref=${BRANCH}`],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      notes.push(`read the feed from origin/${BRANCH} via the API`);
      return JSON.parse(out);
    } catch (e) {
      notes.push(`could not read origin/${BRANCH} via the API (${String(e.message).split('\n')[0].slice(0, 120)}); `
        + 'checked the local checkout instead');
    }
  } else {
    notes.push('no branch/token supplied; checked the local checkout only');
  }
  return readJsonLocal(FEED_PATH);
}

/* ------------------------------------------------------------------- checks */
let feed;
try {
  feed = readFeed();
} catch (e) {
  console.error(`FRESHNESS FAIL: ${FEED_PATH} could not be parsed — ${e.message}`);
  process.exit(1);
}

const meta = feed.meta || {};
if (!meta.generated_at) {
  problems.push('meta.generated_at is missing; the age of the data cannot be established');
}
const genMs = meta.generated_at ? Date.parse(meta.generated_at) : NaN;
if (meta.generated_at && !isFinite(genMs)) {
  problems.push(`meta.generated_at is not a parseable timestamp: ${JSON.stringify(meta.generated_at)}`);
}
const ageMin = isFinite(genMs) ? (Date.now() - genMs) / 60000 : null;
const negative = ageMin !== null && ageMin < -5;
if (negative) {
  problems.push(`meta.generated_at is ${(-ageMin).toFixed(1)} min in the future; the clock or the stamp is wrong`);
}

const alerts = Array.isArray(feed.alerts) ? feed.alerts : [];
if (!Array.isArray(feed.alerts)) problems.push('feed.alerts is not an array');

alerts.forEach((a, i) => {
  const id = a && (a.ticker || a.market || a.market_ticker) || `alerts[${i}]`;
  if (!a || typeof a !== 'object') { problems.push(`alerts[${i}] is not an object`); return; }
  if (!a.source_url) problems.push(`${id}: alert has no source_url (every row must link to the official endpoint)`);
  const d = Math.abs(Number(a.delta));
  if (!isFinite(d)) problems.push(`${id}: delta is not a number (${JSON.stringify(a.delta)})`);
  else if (d + 1e-9 < THRESHOLD) {
    problems.push(`${id}: recorded swing ${d} is below the published $${THRESHOLD.toFixed(2)} threshold`);
  }
  ['price_before', 'price_after', 'delta'].forEach((k) => {
    if (a[k] === undefined || a[k] === null) return;
    if (String(a[k]) === 'NaN' || String(a[k]) === 'null' || String(a[k]) === 'undefined') {
      problems.push(`${id}: ${k} rendered as ${String(a[k])}`);
    }
  });
});

/* Resolutions must carry the exchange's own answer, never an inference. */
const resolutions = Array.isArray(feed.resolutions) ? feed.resolutions : [];
resolutions.forEach((r, i) => {
  if (!r || typeof r !== 'object') { problems.push(`resolutions[${i}] is not an object`); return; }
  if (r.result !== 'yes' && r.result !== 'no') {
    problems.push(`${(r.ticker || `resolutions[${i}]`)}: result is ${JSON.stringify(r.result)}, expected "yes" or "no"`);
  }
  if (!r.source_url) problems.push(`${r.ticker || `resolutions[${i}]`}: resolution has no source_url`);
});

/* ------------------------------------------------------------------- report */
const ageText = ageMin === null ? 'unknown' : `${ageMin.toFixed(1)} min`;
console.log('freshness_check');
console.log(`  feed:            ${FEED_PATH}`);
console.log(`  generated_at:    ${meta.generated_at || '(missing)'}  → age ${ageText}`);
console.log(`  thresholds:      warn ≥ ${WARN} min, stale ≥ ${STALE} min, swing ≥ $${THRESHOLD.toFixed(2)}`);
console.log(`  alerts:          ${alerts.length}`);
console.log(`  resolutions:     ${resolutions.length}`);
console.log(`  notes:           ${notes.join(' · ')}`);

if (ageMin !== null && ageMin >= STALE) {
  problems.push(`the published feed is ${ageMin.toFixed(1)} min old, beyond the ${STALE}-minute stale limit `
    + '— the scheduled sampler has stalled');
} else if (ageMin !== null && ageMin >= WARN) {
  console.log(`  WARNING: feed is ${ageMin.toFixed(1)} min old (warn at ${WARN}); still within the stale limit.`);
}

const summary = [
  '### freshness check — alert engine',
  '',
  `Feed \`${FEED_PATH}\` · generated **${meta.generated_at || '(missing)'}** · age **${ageText}** `,
  `(warn ≥ ${WARN} min · stale ≥ ${STALE} min) · ${alerts.length} alerts · ${resolutions.length} resolutions`,
  '',
  problems.length ? `**${problems.length} problem(s):**\n\n${problems.map((p) => `- ${p}`).join('\n')}` : 'No problems: the feed is within the freshness limit and every alert keeps its source link.',
  '',
  ...notes.map((n) => `> ${n}`),
  ''
].join('\n');
console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch { /* convenience only */ }
}

if (problems.length) {
  console.error(`\nFRESHNESS FAIL: ${problems.length} problem(s)`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log('\nFRESHNESS OK');
