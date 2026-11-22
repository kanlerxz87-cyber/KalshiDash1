#!/usr/bin/env node
/* annotate-legacy-day-old-corroboration.mjs — record, in the committed feed, every PRE-FIX row
 * whose published corroboration came from `previous_price_dollars`.
 *
 * WHY (F-86, session-f7ba69d5, 2026-11-22)
 * ----------------------------------------
 * `tools/live_engine.mjs` accepted `previous_price_dollars` as a second "published field" that
 * could corroborate a sampled swing, and a code comment described it as "the price of the trade
 * before the last one". The official schema says otherwise — "Price for the last traded YES
 * contract on this market **a day ago**"
 * (https://docs.kalshi.com/api-reference/market/get-market) — so on a market that moved during
 * the day, a day-old value can agree with a print that the live book contradicts. The engine now
 * uses only the same-session book (see `corroborate()`), and `scripts/check_alerts.mjs` fails any
 * published alert that names the day-old field.
 *
 * The rows already published are real recorded data and must not be silently rewritten or
 * deleted. This script labels them, in `meta.legacy_day_old_corroboration`, so the page can mark
 * them and the validator can require an entry for each one.
 *
 * MEASURED SCOPE — read before quoting this file
 * ----------------------------------------------
 * On the committed sample of 2026-11-22T02:27:14Z, 3 of 40 alerts cited the day-old field and all
 * 3 were ALSO corroborated by their own live book when re-checked; 0 alerts were admitted by the
 * day-old field alone. So on that sample the defect is a **false provenance claim and a latent
 * hole**, not a demonstrated false alert. The script records that measurement verbatim per row
 * (`book_also_corroborates`) instead of asserting a stronger claim than the data supports.
 *
 * WHAT IT CHANGES: only `meta` on the feed (and `state` when given). No price, arrow, delta,
 * timestamp, score or id is touched. Re-running is idempotent.
 *
 *   node scripts/annotate-legacy-day-old-corroboration.mjs [files...]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { corroborate } from '../tools/live_engine.mjs';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['data/live/feed.json', 'data/live/state.json'];
const fmt = (o) => JSON.stringify(o, null, 1) + '\n';
const DAY_OLD = /previous_price/i;

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.error(`skip ${file}: ${e.message}`);
    continue;
  }
  const alerts = doc.alerts || [];
  const list = [];
  for (const a of alerts) {
    const by = a && a.corroboration && a.corroboration.by;
    if (typeof by !== 'string' || !DAY_OLD.test(by)) continue;
    const book = corroborate({
      to: a.to,
      m: {
        yes_bid_dollars: a.yes_bid_dollars,
        yes_ask_dollars: a.yes_ask_dollars,
        no_bid_dollars: a.no_bid_dollars,
        no_ask_dollars: a.no_ask_dollars,
      },
    });
    list.push({
      id: a.id,
      ticker: a.ticker,
      recorded_corroboration: by,
      recorded_gap: a.corroboration.gap ?? null,
      book_also_corroborates: book.ok === true,
      book_reading: book.how,
      note: book.ok === true
        ? 'The live book also corroborated this swing when re-checked; only the recorded evidence label was wrong.'
        : 'The live book does NOT corroborate this swing; this row was admitted by the day-old field alone.',
      model_highROI_at_publication: a.model ? a.model.highROI === true : null,
    });
  }
  // Preserve any previously written record so a re-run cannot shrink the published provenance.
  const prior = (doc.meta && doc.meta.legacy_day_old_corroboration) || [];
  const byId = new Map();
  for (const r of prior) byId.set(r.id, r);
  for (const r of list) byId.set(r.id, r);
  const merged = [...byId.values()];

  doc.meta = doc.meta || {};
  if (merged.length) {
    doc.meta.legacy_day_old_corroboration = merged;
    doc.meta.legacy_day_old_corroboration_note =
      'F-86: these rows were published before 2026-11-22 with corroboration.by = previous_price_dollars, '
      + 'which the official schema defines as the last traded YES price a day ago '
      + '(https://docs.kalshi.com/api-reference/market/get-market). The engine now corroborates only with '
      + 'the same-session book. Prices, arrows, deltas, timestamps and scores are unchanged.';
  }
  await writeFile(file, fmt(doc));
  console.log(`${file}: ${merged.length} row(s) annotated${merged.length ? '' : ' (none found)'}; `
    + `${merged.filter((r) => !r.book_also_corroborates).length} not corroborated by the live book`);
}
