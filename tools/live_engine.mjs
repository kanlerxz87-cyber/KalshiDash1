#!/usr/bin/env node
/**
 * live_engine.mjs — the KalshiDash1 live alert engine.
 *
 * PURPOSE
 * -------
 * Turn the official Kalshi **demo** Trade API into a live alerting system:
 *   1. discover the live events for the five focus topics (gas prices, elections, culture,
 *      crypto, golf) that carry the highest dollar amount,
 *   2. sample their contract prices on a schedule,
 *   3. emit an alert whenever a contract price moves >= $0.10 in either direction,
 *   4. track every tracked market until it resolves (result "yes" / "no"),
 *   5. score each alert with a transparent heuristic so a second feed can show only the
 *      alerts our model rates as high expected ROI.
 *
 * WHY THIS RUNS IN CI AND NOT ONLY IN THE BROWSER
 * ----------------------------------------------
 * The site is static (GitHub Pages), and a static page can only sample the API while a
 * visitor has it open. A GitHub Actions schedule keeps sampling even with nobody
 * watching, so the feed is genuinely continuous and the history survives between visits.
 * The browser additionally polls the API for seconds-level freshness where the network
 * allows it (see alerts/js/*.js). The two layers share the same output format.
 *
 * VERIFIED SOURCES (each rule below is traceable to one of these)
 * --------------------------------------------------------------
 *  S1  Demo environment + recommended/legacy REST & WS roots
 *      https://docs.kalshi.com/getting_started/demo_env
 *  S2  Unauthenticated market data (series, markets, orderbook, candlesticks, trades)
 *      https://docs.kalshi.com/getting_started/quick_start_market_data
 *  S3  GET /series — params category, tags, include_volume; category match is exact and
 *      case-sensitive and matches ANY entry in a series' `categories` list
 *      https://docs.kalshi.com/api-reference/market/get-series-list
 *  S4  GET /markets — filters series_ticker + status, limit <= 1000; `status=settled`
 *      returns finalized markets; `min_settled_ts`/`max_settled_ts` sort by settle time
 *      https://docs.kalshi.com/api-reference/market/get-markets
 *  S5  GET /markets/{ticker} — field list incl. last_price_dollars, yes_bid_dollars,
 *      yes_ask_dollars, yes_bid_size_fp, yes_ask_size_fp, volume_fp, volume_24h_fp,
 *      open_interest_fp, result, settlement_value_dollars, settlement_ts, close_time
 *      https://docs.kalshi.com/api-reference/market/get-market
 *  S6  Orderbook: only bids are returned; best bid is the LAST element; each level is
 *      [price_dollars, count_fp]; a YES ask is $1.00 - best NO bid
 *      https://docs.kalshi.com/getting_started/orderbook_responses
 *  S7  Market lifecycle: active -> closed -> determined (result set) -> finalized;
 *      `result` is "yes" | "no" | "scalar"; status filter values unopened/open/paused/
 *      closed/settled   https://docs.kalshi.com/getting_started/market_lifecycle
 *  S8  Settlement: winning side receives $1 per contract
 *      https://docs.kalshi.com/getting_started/market_settlement
 *  S9  Rate limits: unauthenticated public requests have separate limits; back off on 429
 *      https://docs.kalshi.com/getting_started/rate_limits
 *  S10 Orderbook + markets are cached server-side for a few seconds, so a REST sample can
 *      lag the exchange; candles can lag by a few seconds
 *      https://docs.kalshi.com/getting_started/quick_start_market_data
 *  S11 The live demo tag taxonomy that this engine's topic rules are checked against
 *      https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories
 *  S13 GET /markets/trades — unauthenticated; one record per completed trade with
 *      `yes_price_dollars`, `count_fp`, `created_time`, `trade_id`; filterable by `ticker`
 *      and by `min_ts`/`max_ts` (seconds); `limit` 1..1000; unknown ticker returns 200 with
 *      an empty list   https://docs.kalshi.com/api-reference/market/get-trades
 *
 * HONESTY RULES BAKED INTO THE CODE
 * ---------------------------------
 *  * Nothing is invented: a field the API did not return is stored as null and counted in
 *    `unverified_fields`. There is no default or example value anywhere.
 *  * Every alert row carries `source_url` — the exact API request that produced it.
 *  * `est_traded_dollars` is OUR estimate (volume_fp x price) and is labelled as such in
 *    the site. Kalshi does not publish traded dollars per market in this response.
 *  * The ROI score is a documented heuristic, not a measured return. See modelScore().
 *  * Public endpoints only. No credential is read, stored or logged. Placing orders is
 *    deliberately NOT implemented here (see docs/ALERTS.md, "Not implemented").
 *
 * USAGE
 * -----
 *   node tools/live_engine.mjs                    # one live sample cycle, writes data/live/
 *   node tools/live_engine.mjs --dry-run          # fetch + report, write nothing
 *   node tools/live_engine.mjs --max-series 8     # smaller request budget
 *   node tools/live_engine.mjs --selftest         # offline logic test, no network
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ constants */

export const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
export const LEGACY_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
export const SWING_THRESHOLD = 0.10;          // brief: >= $0.10 in either direction
export const ALERT_COOLDOWN_SECONDS = 1800;   // re-arm a ticker after 30 min
export const HISTORY_RETAIN_SECONDS = 5 * 86400;
export const MAX_SAMPLES_PER_MARKET = 720;    // 5 days at a 10-minute cadence
export const MAX_HISTORY_MARKETS = 4;         // the biggest contracts PER TOPIC keep a series
export const MAX_ALERTS = 600;
export const MAX_RESOLUTIONS = 400;

/**
 * Topic rules.
 *
 * `category`/`tags` come from S3 and are checked against the live tag taxonomy (S11) on
 * every run — if one of them disappears the run fails loudly instead of silently
 * returning an empty table (see checkTaxonomy()).
 *
 * `titleMatch` is the narrowing rule, and it is deliberately visible and narrow:
 *   gas       -> the series title must mention gas. The `Oil & Gas` tag also contains
 *                Brent/WTI crude oil and heating oil, which are oil prices, not gas
 *                prices, so they are excluded by this rule.
 *   golf      -> the official `Sports` tag `Golf`.
 *   elections -> the official `Elections` category (all of it).
 *   culture   -> the official `Culture` category (all of it).
 *   crypto    -> the official `Crypto` category (all of it).
 */
export const TOPICS = [
  {
    id: 'gas',
    label: 'Gas Prices',
    queries: [
      { category: 'Economics', tags: 'Oil and energy' },
      { category: 'Commodities', tags: 'Oil & Gas' },
    ],
    titleMatch: /\bgas\b/i,
    why: 'The AAA gasoline series sit under Economics / "Oil and energy"; natural-gas and TTF-gas series sit under Commodities / "Oil & Gas" (S3, S11). Both tags exist in the live taxonomy.',
  },
  {
    id: 'elections',
    label: 'Elections',
    queries: [{ category: 'Elections' }],
    titleMatch: null,
    why: 'The whole official Elections category (S11 lists its 40 tags).',
  },
  {
    id: 'culture',
    label: 'Culture',
    queries: [{ category: 'Culture' }],
    titleMatch: null,
    why: 'The whole official Culture category.',
  },
  {
    id: 'crypto',
    label: 'Crypto',
    queries: [{ category: 'Crypto' }],
    titleMatch: null,
    why: 'The whole official Crypto category.',
  },
  {
    id: 'golf',
    label: 'Golf',
    queries: [{ category: 'Sports', tags: 'Golf' }],
    titleMatch: null,
    why: 'Sports has a dedicated "Golf" tag (S11).',
  },
];

/* ------------------------------------------------------------------ utilities */

/** Fixed-point string -> number, or null when absent/not-a-number. Never coerces to 0. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function round(x, dp = 4) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/**
 * The price this engine tracks, with the field it came from — or null.
 *
 * A binary book is self-checking. S6 documents the reciprocity that must hold:
 *
 *     yes_ask + no_bid = $1.00      yes_bid + no_ask = $1.00
 *
 * THE MEASURED PROBLEM (2026-11-20, demo API)
 * ------------------------------------------
 * One sampled row for KXPRESPERSON-28-GABB came back with `yes_ask_dollars: 0.8030` while
 * `no_bid_dollars` stayed 0.9970 — 0.803 + 0.997 = 1.80, so that row contradicts itself.
 * Taken at face value it produced fake "$0.80" alerts. A second, single-market read of the
 * same ticker returned the healthy book yes 0.0020/0.0030, no 0.9970/0.9980.
 *
 * A separate trap: KXPRESNOMD-28-JP legitimately has a huge spread (yes bid 0.0100, yes ask
 * 0.9430, with 0.9430 + 0.0570 = 1.00 holding), so the *midpoint* of that book (0.4765) is
 * meaningless. The last traded price (0.9430) is the right answer there. An earlier version of
 * this function wrongly replaced it, which is why reciprocity, not the midpoint, is the test.
 *
 * RULE
 *   1. If the row's reciprocity holds (or too few fields exist to test it), use
 *      `last_price_dollars` when it is a real binary price, else the bid/ask midpoint.
 *   2. If reciprocity fails, the row contradicts itself: take the price from the NO side
 *      (1 − no price), which is the reading the corrupt field was not part of, and mark the
 *      row `book_inconsistent` so the site can show it.
 *   3. If neither yields a price in (0,1), return null. The market is skipped and counted.
 *
 * Nothing is manufactured: every branch returns a published quote or null.
 */
export const RECIPROCITY_TOLERANCE = 0.02;
/* A last traded price is only cross-checked against the book when the book is tight enough to
 * be informative; on a 0.01/0.94 book the midpoint says nothing and the last trade is the best
 * available price. Measured case: KXPRESNOMD-28-JP really trades at 0.943 inside a 0.01–0.94
 * spread, while KXPRESPERSON-28-GABB reported a last price of 0.803 inside a 0.002–0.003 book. */
export const MAX_COHERENT_SPREAD = 0.10;
export const MAX_LAST_PRICE_BOOK_GAP = 0.25;

export function bookReciprocity(m) {
  const yb = num(m.yes_bid_dollars);
  const ya = num(m.yes_ask_dollars);
  const nb = num(m.no_bid_dollars);
  const na = num(m.no_ask_dollars);
  const checks = [];
  if (ya !== null && nb !== null) checks.push(Math.abs(ya + nb - 1));
  if (yb !== null && na !== null) checks.push(Math.abs(yb + na - 1));
  if (!checks.length) return { tested: false, ok: null, worst: null };
  const worst = round(Math.max(...checks), 4);
  return { tested: true, ok: worst <= RECIPROCITY_TOLERANCE, worst };
}

export function trackedPrice(m) {
  const last = num(m.last_price_dollars);
  const yb = num(m.yes_bid_dollars);
  const ya = num(m.yes_ask_dollars);
  const nb = num(m.no_bid_dollars);
  const na = num(m.no_ask_dollars);
  const recip = bookReciprocity(m);

  const directOk = yb !== null && ya !== null && yb > 0 && ya > 0 && yb < 1 && ya < 1 && ya >= yb;
  const impliedOk = nb !== null && na !== null && nb > 0 && na > 0 && nb < 1 && na < 1;

  if (recip.ok !== false) {
    const mid = directOk ? round((yb + ya) / 2) : impliedOk ? round(((1 - na) + (1 - nb)) / 2) : null;
    const spread = directOk ? round(ya - yb, 4) : null;
    if (last !== null && last > 0 && last < 1) {
      // Stale-last-price guard, applied only to a tight book where the midpoint is meaningful.
      if (mid !== null && spread !== null && spread <= MAX_COHERENT_SPREAD && Math.abs(last - mid) > MAX_LAST_PRICE_BOOK_GAP) {
        return {
          price: mid,
          field: `book midpoint (yes ${yb} / ${ya}) — last_price_dollars ${last} is further than $${MAX_LAST_PRICE_BOOK_GAP} from a tight book`,
          book_inconsistent: true,
        };
      }
      return { price: last, field: 'last_price_dollars' };
    }
    if (directOk) return { price: round((yb + ya) / 2), field: 'mid(yes_bid_dollars,yes_ask_dollars)' };
    if (impliedOk) return { price: round(((1 - na) + (1 - nb)) / 2), field: 'mid(1 − no prices)' };
    return { price: null, field: null };
  }

  // Reciprocity failed: the row contradicts itself.
  const impliedMid = impliedOk ? round(((1 - na) + (1 - nb)) / 2) : null;
  if (impliedMid !== null && impliedMid > 0 && impliedMid < 1) {
    return {
      price: impliedMid,
      field: `NO-side reading (1 − no prices) — row failed reciprocity by $${recip.worst}; yes_ask ${ya} vs no_bid ${nb}`,
      book_inconsistent: true,
      reciprocity_error: recip.worst,
    };
  }
  if (last !== null && last > 0 && last < 1) {
    return { price: last, field: `last_price_dollars — row failed reciprocity by $${recip.worst} and no NO side was usable`, book_inconsistent: true, reciprocity_error: recip.worst };
  }
  return { price: null, field: null, book_inconsistent: true, reciprocity_error: recip.worst };
}

/**
 * Corroboration: an alert found by *sampling* must be confirmed by a second published field.
 *
 * WHY: the demo can return a single stale price field (measured: last_price_dollars 0.8030 on
 * a market whose book and previous price were both ~0.003). A per-field guard cannot catch
 * every shape of that, but a claim can always be checked against the other published numbers:
 *
 *   * the book (bid/ask, or 1 − no price) — a real move moves the book with it.
 *
 * An alert is published only if the new price is within `CORROBORATION_GAP` of the book.
 * Trade- and candle-detected alerts are exempt: their price *is* a published trade, so
 * they are already corroborated by the trade record itself.
 *
 * F-86 (session-f7ba69d5, 2026-11-22). `previous_price_dollars` used to be accepted here as a
 * second reading, described in this comment as "the price of the trade before the last one".
 * The official spec says otherwise: "Price for the last traded YES contract on this market
 * **a day ago**" (https://docs.kalshi.com/api-reference/market/get-market). A day-old price is
 * not an observation of the same session, so it can "corroborate" a print that the book
 * contradicts whenever the market moved during the day. Measured on the committed feed of
 * 2026-11-22T02:27Z: `KXBTCY-27JAN0100-B87500` was published as "$0.99 -> $0.02 (down)", score
 * 0.779, high ROI, corroborated by `previous_price_dollars: 0.02` — while the book at detection
 * read yes_bid 0.0100 / yes_ask 0.0200, i.e. a 0.97 move away from the recorded 0.99 baseline.
 * `KXPRESPERSON-28-VRAM` was published as "$0.802 -> $0.003" the same way. Removing the reading
 * leaves the book as the only corroborator, which is exactly the evidence the demo lacks when a
 * print does not hold.
 */
export const CORROBORATION_GAP = 0.10;

export function corroborate({ to, m }) {
  if (to === null || to === undefined) return { ok: false, how: 'no price to corroborate' };
  const yb = num(m.yes_bid_dollars), ya = num(m.yes_ask_dollars);
  const nb = num(m.no_bid_dollars), na = num(m.no_ask_dollars);
  const readings = [];
  if (yb !== null && ya !== null && ya >= yb) readings.push({ v: round((yb + ya) / 2), how: 'book midpoint (yes quotes)' });
  if (nb !== null && na !== null && na >= nb) readings.push({ v: round(((1 - na) + (1 - nb)) / 2), how: 'book midpoint (1 − no quotes)' });
  if (!readings.length) return { ok: false, how: 'no book reading was returned (previous_price_dollars is a day-old value and is not used)' };
  let best = null;
  for (const r of readings) {
    const gap = Math.abs(to - r.v);
    if (!best || gap < best.gap) best = { gap: round(gap, 4), how: r.how, value: r.v };
  }
  return { ok: best.gap <= CORROBORATION_GAP, how: best.how, gap: best.gap, value: best.value };
}

/**
 * Dollar amount ranking. Kalshi's market object does not publish traded dollars, so this
 * is an ESTIMATE from two published fields (S5): contracts traded x last traded price.
 * It is labelled `est_traded_dollars` everywhere and is never presented as exchange data.
 */
export function estimateTradedDollars(m, price) {
  const vol = num(m.volume_fp);
  if (vol === null || price === null) return null;
  return round(vol * price, 2);
}

/**
 * Alert detection.
 *
 * `baseline` is the previous sample's price for the same ticker, or the price of the last
 * alert for that ticker when that alert is newer than ALERT_COOLDOWN_SECONDS (this keeps a
 * slow grind from re-alerting every sample while still reporting a cumulative move).
 *
 * Returns null when the move is smaller than the threshold, otherwise an alert object.
 */
export function detectSwing({ ticker, topic, title, price, baseline, nowSeconds, threshold = SWING_THRESHOLD }) {
  if (price === null || baseline === null || baseline === undefined) return null;
  const delta = round(price - baseline, 4);
  if (Math.abs(delta) + 1e-12 < threshold) return null;
  return {
    ticker,
    topic,
    title,
    direction: delta > 0 ? 'up' : 'down',
    from: round(baseline, 4),
    to: round(price, 4),
    delta,
    abs_delta: round(Math.abs(delta), 4),
    ts: new Date(nowSeconds * 1000).toISOString(),
  };
}

/**
 * The model that decides which alerts go to the "high-ROI" chat.
 *
 * It is an explicit, readable heuristic — NOT a fitted or back-tested model, and it is
 * described as such on the site. Every term is computed from API fields:
 *
 *   0.20 x      price before the move: a +$0.10 move on a $0.20 contract is a large change
 *               in implied probability (more opportunity than 0.80 -> 0.90). This term is
 *               deliberately small, because moves near the extremes are usually noisy.
 *   0.20 x      |delta| / 0.50 — size of the move, normalised.
 *   0.35 x      liquidity score: 1 when the 24h volume is >= 1,000 contracts, scaled
 *               linearly below that. This is the largest single weight: a $0.10 move on an
 *               empty book cannot actually be traded, so it is not a high-ROI signal.
 *   0.25 x      spread score: 1 - spread, where spread = yes_ask - yes_bid and 0 means a
 *               penny-wide book (cheap to enter and exit).
 *   -            staleness: samples older than an hour are halved (S10: REST reads lag).
 *
 * The weights sum to 1.0, so the score is in [0,1]. `highROI` is score >= 0.62.
 * The returned `reasons` are shown next to the row in the site, so a reader can audit it.
 */
export const HIGH_ROI_THRESHOLD = 0.62;
export const MODEL_VERSION = 'heuristic-v2';

/* FOLLOW-THROUGH GATE — measured, not assumed.
 *
 * WHY THIS EXISTS (2026-11-21). The published feed's high-ROI pane was topped by
 * `KXBTCY-27JAN0100-B97500` alerts reading "$0.01 -> $0.97 (up)" with `model.score 0.779`
 * and `highROI: true`, and by `KXPRESNOMD-28-AKLO` reading "$0.803 -> $0.003 (down)" with
 * `model 0.6288`. In both rows the *published* YES ask at detection was the opposite end of
 * the book: `yes_ask_dollars` was $0.0100 on the "up to $0.97" row and $0.8030 on the "down
 * to $0.003" row. So the recorded swing price could not have been bought or sold at the
 * moment it was recorded — the score was ranking millisecond print noise, not an opportunity.
 *
 * The gate is computed only from fields the API returned, and it is a two-sided band, not a
 * one-sided "was it cheap enough" comparison:
 *
 *   up   alert: the executable entry is the YES ask. Require |ask - to| <= tolerance.
 *   down alert: the executable exit  is the YES bid. Require |bid - to| <= tolerance.
 *   either side priced at $0.00 means "no offer to buy" / "no bid to sell into" -> not tradeable.
 *
 * A one-sided comparison was tried first and is wrong: it accepts a claimed $0.97 print whose
 * ask is $0.01 ("cheaper to buy than the print"), which is precisely the phantom this gate
 * exists to reject. The quote has to be *at* the swing price, not merely better than it.
 *
 * Tolerance is FOLLOW_TOLERANCE = $0.02: wider than one price step ($0.01 on the markets this
 * dashboard tracks) so a real but slightly stale quote still passes, and far tighter than the
 * 80–96 cent contradictions observed.
 * When the quote is unknown the alert is NOT called untradeable (the data is missing, not
 * contradictory): it is marked `follow_through: 'unknown'` and scores 0 on the new term, which
 * keeps the published "never invent a value" rule intact.
 *
 * `modelScore` multiplies by this gate rather than subtracting from it, because a swing nobody
 * can trade is not a weak signal — it is not a signal at all.
 */
export const FOLLOW_TOLERANCE = 0.02;

export function followThrough({ direction, to, bid, ask }) {
  if (to === null || to === undefined) return { ok: null, note: 'swing price missing — unverified' };
  if (direction !== 'up' && direction !== 'down') return { ok: null, note: 'direction unknown — unverified' };
  const ref = direction === 'up' ? ask : bid;
  const side = direction === 'up' ? 'ask (the price you would pay)' : 'bid (the price you would receive)';
  if (ref === null || ref === undefined) return { ok: null, note: `no YES ${side} published — unverified` };
  if (ref <= 0) {
    return {
      ok: false,
      gap: round(to - ref, 4),
      note: `YES ${direction === 'up' ? 'ask' : 'bid'} is $${ref.toFixed(2)} — there is no ${direction === 'up' ? 'offer to buy' : 'bid to sell into'}`,
    };
  }
  /* TWO-SIDED BAND, not a one-sided comparison. A claimed $0.97 print whose ask is $0.01 is not
   * "cheaper to buy" — it means the quote fell back and the print did not hold. The published
   * side has to sit where the swing says the price is, within FOLLOW_TOLERANCE. */
  const gap = round(Math.abs(ref - to), 4);
  return {
    ok: gap <= FOLLOW_TOLERANCE + 1e-9,
    gap,
    note: `${side} $${ref.toFixed(2)} vs swing price $${to.toFixed(2)} (gap $${gap.toFixed(2)})`,
  };
}

export function modelScore({ from, delta, direction = null, to = null, bid, ask, volume24h, sampleAgeSeconds = 0 }) {
  const reasons = [];
  if (from === null || from === undefined) {
    return { score: null, highROI: false, tradeable: null, age_penalised: false, reasons: ['no baseline price — unverified'] };
  }

  // 0. REALITY GATE. If the row records which way the price moved and where it landed, the
  //    published book has to agree that the recorded price was reachable. A row that does not
  //    agree is displayed (the move is real data) but it can never be a high-ROI signal.
  const ft = direction && to !== null && to !== undefined
    ? followThrough({ direction, to, bid, ask })
    : { ok: null, note: 'direction/price not supplied to the model' };

  // 1. headroom: how much of the probability range is left to move into
  const headroom = round(Math.max(0, Math.min(from, 1 - from) / 0.5), 4);
  reasons.push(`headroom ${headroom.toFixed(2)} (price was $${from.toFixed(2)})`);

  // 2. move size
  const size = round(Math.min(1, Math.abs(delta) / 0.5), 4);
  reasons.push(`move ${(size * 100).toFixed(0)}% of a $0.50 move`);

  // 3. liquidity
  const v = volume24h === null || volume24h === undefined ? 0 : volume24h;
  const liq = round(Math.min(1, v / 1000), 4);
  reasons.push(`24h volume ${v} contracts -> liquidity ${liq.toFixed(2)}`);

  // 4. spread. THIS TERM WAS THE BUG. A one-sided book (yes_bid 0, yes_ask 0.97) used to score
  //    0.90 "tight" because the code computed ask - bid and never asked whether the bid existed.
  //    A missing or zero bid means there is no buyer to exit into, so the term is 0 and the row
  //    keeps a reason saying so.
  let spreadScore = 0;
  const hasTwoSides = bid !== null && bid !== undefined && ask !== null && ask !== undefined
    && bid > 0 && ask > 0 && ask >= bid;
  if (hasTwoSides) {
    const spread = round(ask - bid, 4);
    spreadScore = round(Math.max(0, 1 - spread * 10), 4);
    reasons.push(`spread $${spread.toFixed(2)} -> ${spreadScore.toFixed(2)}`);
  } else {
    reasons.push('book is one-sided or unpriced (no YES bid and ask) -> 0.00');
  }

  // 5. follow-through: did the published quote still sit where the swing ended?
  const followScore = ft.ok === true ? 1 : 0;
  reasons.push(ft.ok === true
    ? `quote follows the swing: ${ft.note} -> 1.00`
    : ft.ok === false
      ? `NOT tradeable at the swing price: ${ft.note} -> 0.00`
      : `follow-through unverified (${ft.note}) -> 0.00`);

  let score = 0.20 * headroom + 0.20 * size + 0.35 * liq + 0.25 * spreadScore;
  score = round(score, 4);

  const agePenalised = sampleAgeSeconds > 3600;
  if (agePenalised) {
    score = round(score * 0.5, 4);
    reasons.push('sample older than 1h -> score halved (REST reads lag, S10)');
  }
  // Untradeable rows are capped, not merely penalised: the pane is labelled "high ROI", and a
  // price that could not be executed at the moment of detection has no ROI to be high.
  if (ft.ok === false) {
    score = Math.min(score, 0.3);
    reasons.push('capped at 0.30 because the swing was not executable at the recorded price');
  }
  score = round(Math.max(0, Math.min(1, score)), 4);
  return { score, highROI: score >= HIGH_ROI_THRESHOLD, tradeable: ft.ok, age_penalised: agePenalised, reasons };
}

/* RE-SCORE RETAINED ROWS WITH THE CURRENT MODEL.
 *
 * WHY: alerts persist across runs in `data/live/state.json`, so a row scored by an older model kept
 * its old verdict forever — measured in CI run 44947818572, where rows labelled `highROI` by
 * heuristic-v1 survived into a heuristic-v2 sample and the validator (correctly) refused to publish
 * the whole run (F-74).
 *
 * The age penalty is part of the verdict, not noise. `modelScore()` halves a score when the quote
 * it is scoring is more than an hour old, and several published rows were scored that way (a 0.554
 * base published as 0.277). Re-scoring those rows with a fresh-sample assumption would double the
 * published score even though the stored quote is still the same old one — that is why
 * `modelScore()` now returns `age_penalised`, and why this function re-applies it. Rows scored
 * before that field existed are reconstructed exactly: the only two possible verdicts are computed
 * and a stored score matching the halved one within rounding is treated as penalised. No score is
 * guessed: anything that matches neither candidate is re-scored from a fresh assumption, and its
 * original verdict is preserved as `model.original_score`.
 *
 * Prices, arrows, deltas, timestamps and ids are never touched. `original_score`/`original_highROI`
 * are written once, the first time the verdict actually changes. Returns the number of rows whose
 * score or label changed.
 */
export function rescoreAlerts(alerts) {
  let changed = 0;
  for (const a of alerts || []) {
    if (!a.model || a.model.score === null || a.model.score === undefined) continue;
    const inputs = {
      from: a.from, delta: a.delta, direction: a.direction, to: a.to,
      bid: num(a.yes_bid_dollars), ask: num(a.yes_ask_dollars),
      volume24h: num(a.volume_24h_fp),
    };
    let sampleAgeSeconds = 0;
    if (a.model.age_penalised === true) {
      sampleAgeSeconds = 3601;
    } else if (a.model.age_penalised === undefined || a.model.age_penalised === null) {
      const fresh = modelScore({ ...inputs, sampleAgeSeconds: 0 });
      const stale = modelScore({ ...inputs, sampleAgeSeconds: 3601 });
      const near = (x, y) => typeof x === 'number' && Math.abs(x - y) <= 1e-4;
      if (near(a.model.score, stale.score) && !near(a.model.score, fresh.score)) {
        sampleAgeSeconds = 3601;
      } else if (near(a.model.score, fresh.score) && near(a.model.original_score, stale.score)
        && !near(a.model.original_score, fresh.score)) {
        /* A re-score with the fresh-sample assumption already ran and doubled this row (observed
         * on `main`'s 23:13Z sample: score 0.558 / original_score 0.279). The preserved original
         * is the published verdict and is the halved one, so the penalty is restored. */
        sampleAgeSeconds = 3601;
      }
    }
    const v = modelScore({ ...inputs, sampleAgeSeconds });
    const verdictChanged = v.score !== a.model.score || v.highROI !== a.model.highROI;
    if (verdictChanged) {
      if (a.model.original_score === undefined || a.model.original_score === null) {
        a.model.original_score = a.model.score;
        a.model.original_highROI = a.model.highROI;
        a.model.original_model_version = a.model.relabelled_by ? 'heuristic-v1' : (a.model.original_model_version || 'heuristic-v1');
      }
      a.model.score = v.score;
      a.model.highROI = v.highROI;
      a.model.tradeable = v.tradeable;
      a.model.reasons = v.reasons;
      changed += 1;
    } else if (a.model.tradeable === undefined) {
      /* A field added by the model is filled in even when the verdict is unchanged. It does not
       * count as a re-score: the score and the label a reader saw are identical. */
      a.model.tradeable = v.tradeable;
    }
    if (a.model.age_penalised === undefined || a.model.age_penalised === null) a.model.age_penalised = v.age_penalised;
  }
  return changed;
}

/* Derive the published provenance list from the rows themselves.
 *
 * WHY (measured 2026-11-21T23:18Z, F-79): the list used to be written only into the derived
 * `feed.json`, which the engine rebuilds from `state.json` on every sample — so the next sample
 * published an empty list while the rows still carried `original_highROI`. Deriving it here means
 * the record travels with the data and cannot be lost by a rebuild. Entries for rows that are no
 * longer in the feed are kept: they are history, not current claims.
 */
export function deriveLegacyUnfillable(alerts, existing = []) {
  const byId = new Map((Array.isArray(existing) ? existing : []).filter((x) => x && x.id).map((x) => [x.id, x]));
  for (const a of alerts || []) {
    const m = a.model || {};
    if (m.original_highROI !== true || m.highROI === true) continue;
    const ft = followThrough({
      direction: a.direction, to: a.to,
      bid: num(a.yes_bid_dollars), ask: num(a.yes_ask_dollars),
    });
    if (!ft || ft.ok !== false) continue;
    byId.set(a.id, {
      id: a.id,
      ticker: a.ticker,
      ts: a.ts,
      direction: a.direction,
      from: a.from,
      to: a.to,
      yes_bid_dollars: a.yes_bid_dollars ?? null,
      yes_ask_dollars: a.yes_ask_dollars ?? null,
      published_score: m.original_score ?? null,
      reason: ft.note,
      detected_by: m.relabelled_by || 'model re-score (tools/live_engine.mjs)',
    });
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------------ http */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeClient({ base = BASE, fetchImpl = globalThis.fetch, timeoutMs = 20000, maxRetries = 3, delayMs = 250, log = () => {} } = {}) {
  const stats = { requests: 0, retries: 0, errors: [] };

  async function getJson(pathAndQuery) {
    let attempt = 0;
    // Exponential backoff on 429 per S9.
    for (;;) {
      attempt += 1;
      stats.requests += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(base + pathAndQuery, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        clearTimeout(timer);
        if (res.status === 429) {
          if (attempt > maxRetries) throw new Error(`429 rate limited after ${attempt} attempts: ${pathAndQuery}`);
          stats.retries += 1;
          const wait = 500 * 2 ** (attempt - 1);
          log(`  429 on ${pathAndQuery} — backing off ${wait}ms (S9)`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} ${res.statusText} for ${pathAndQuery}${body ? ' — ' + body.slice(0, 200) : ''}`);
        }
        const json = await res.json();
        await sleep(delayMs); // be polite: unauthenticated limits are undocumented (S9)
        return json;
      } catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') {
          if (attempt > maxRetries) throw new Error(`timeout after ${attempt} attempts: ${pathAndQuery}`);
          stats.retries += 1;
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        // Surface the underlying cause (DNS, TLS, proxy) instead of a bare "fetch failed",
        // so a failed run says what actually went wrong.
        const cause = e && e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : null;
        const detail = `${e && e.message ? e.message : e}${cause ? ` [${cause}]` : ''}`;
        if (attempt > maxRetries) throw new Error(`network error reaching ${base}${pathAndQuery}: ${detail}`);
        stats.retries += 1;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }

  return { getJson, stats, base };
}

export function seriesQueryUrl(q) {
  const p = new URLSearchParams();
  if (q.category) p.set('category', q.category);
  if (q.tags) p.set('tags', q.tags);
  p.set('include_volume', 'true');
  p.set('limit', '200');
  return `/series?${p.toString()}`;
}

export function marketsQueryUrl(seriesTicker, extra = {}) {
  const p = new URLSearchParams();
  p.set('series_ticker', seriesTicker);
  if (extra.status) p.set('status', extra.status);
  if (extra.minSettledTs) p.set('min_settled_ts', String(extra.minSettledTs));
  if (extra.maxSettledTs) p.set('max_settled_ts', String(extra.maxSettledTs));
  p.set('limit', String(extra.limit || 200));
  if (extra.cursor) p.set('cursor', extra.cursor);
  return `/markets?${p.toString()}`;
}

/* ------------------------------------------------------------------ discovery */

/**
 * Checks each configured category/tag pair against the live taxonomy (S11).
 *
 * A *hard* failure is raised only when the taxonomy positively contradicts the config: the
 * category exists and its tag list is present, but the tag is not in it (or the tag list is
 * null, which means "no tags advertised" and would silently empty a tag filter).
 *
 * When a category is absent from tags_by_categories we do NOT fail. The live demo API shows
 * that this taxonomy is incomplete: `GET /series?category=Culture` returns series whose
 * `category` is "Culture", while `/search/tags_by_categories` has no "Culture" key at all
 * (verified 2026-11-20; recorded as irregularity F-A1 in docs/ALERTS.md). The authoritative
 * behaviour is the `category` filter on Get Series List (S3), so an absent key is recorded as
 * a note and the discovery step itself proves whether the category works.
 */
export function checkTaxonomy(taxonomyJson, topics = TOPICS) {
  const map = (taxonomyJson && taxonomyJson.tags_by_categories) || {};
  const problems = [];
  const notes = [];
  for (const t of topics) {
    for (const q of t.queries) {
      if (!q.category) continue;
      if (!(q.category in map)) {
        notes.push(`topic ${t.id}: category "${q.category}" is not keyed in tags_by_categories; verified against GET /series?category=${q.category} instead`);
        continue;
      }
      if (q.tags) {
        const tags = map[q.category];
        if (tags === null || tags === undefined) {
          problems.push(`topic ${t.id}: category "${q.category}" advertises no tags, so the tag filter "${q.tags}" would return nothing`);
        } else if (!tags.includes(q.tags)) {
          problems.push(`topic ${t.id}: tag "${q.tags}" is not listed under category "${q.category}"`);
        }
      }
    }
  }
  return { problems, notes };
}

export async function discoverSeries(client, { maxSeries = 12, log = () => {} } = {}) {
  const byTopic = {};
  const seen = new Set();
  for (const t of TOPICS) {
    const rows = [];
    for (const q of t.queries) {
      const path = seriesQueryUrl(q);
      const data = await client.getJson(path);
      for (const s of data.series || []) {
        if (seen.has(s.ticker)) continue;      // a series can carry several categories (S3)
        if (t.titleMatch && !t.titleMatch.test(s.title || '')) continue;
        seen.add(s.ticker);
        rows.push({
          series_ticker: s.ticker,
          title: s.title || null,
          category: s.category || null,
          categories: s.categories || [],
          tags: s.tags || [],
          volume_fp: s.volume_fp === undefined ? null : num(s.volume_fp),
          contract_terms_url: s.contract_terms_url || null,
          contract_url: s.contract_url || null,
          settlement_sources: s.settlement_sources || [],
          topic: t.id,
          source_url: client.base + path,
        });
      }
    }
    rows.sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0));
    byTopic[t.id] = rows;
    log(`  ${t.id}: ${rows.length} series matched`);
  }
  return byTopic;
}

/** Collect open markets for the highest-volume series, within a request budget. */
export async function collectMarkets(client, seriesByTopic, { maxSeries = 12, log = () => {} } = {}) {
  const flat = [];
  for (const t of TOPICS) {
    for (const s of seriesByTopic[t.id] || []) flat.push({ ...s, topic: t.id });
  }
  flat.sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0));

  /* The brief requires the five topics to stay separate and all to be covered, so the
   * request budget is shared round-robin: the top series of each topic first, then the next
   * tier, and only then whatever is left. A pure global ranking lets one high-volume topic
   * (golf, in the first live run) consume every slot and leave gas/culture empty. */
  const perTopicCap = Math.max(1, Math.ceil(maxSeries / TOPICS.length));
  const chosen = [];
  const picked = new Set();
  for (let tier = 0; tier < perTopicCap; tier++) {
    for (const t of TOPICS) {
      if (chosen.length >= maxSeries) break;
      const rows = (seriesByTopic[t.id] || []).slice().sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0));
      const s = rows[tier];
      if (!s || picked.has(s.series_ticker)) continue;
      picked.add(s.series_ticker);
      chosen.push({ ...s, topic: t.id });
    }
  }
  // Any remaining budget goes to the highest-volume series not yet chosen.
  for (const s of flat) {
    if (chosen.length >= maxSeries) break;
    if (picked.has(s.series_ticker)) continue;
    picked.add(s.series_ticker);
    chosen.push(s);
  }

  const seriesMap = {};
  for (const s of flat) seriesMap[s.series_ticker] = s;

  const markets = [];
  for (const s of chosen) {
    const path = marketsQueryUrl(s.series_ticker, { status: 'open' });
    const data = await client.getJson(path);
    for (const m of data.markets || []) {
      markets.push({
        raw: m,
        topic: s.topic,
        series_ticker: s.series_ticker,
        series: s,
        source_url: client.base + path,
      });
    }
    log(`  ${s.series_ticker}: ${(data.markets || []).length} open markets`);
  }
  return { markets, chosenSeries: chosen, seriesMap };
}

/* ------------------------------------------------------------------ state */

export const EMPTY_STATE = {
  meta: {
    generated_at: null,
    engine: 'tools/live_engine.mjs',
    model_version: MODEL_VERSION,
    base_url: BASE,
    threshold: SWING_THRESHOLD,
    high_roi_threshold: HIGH_ROI_THRESHOLD,
  },
  markets: {},      // ticker -> latest sample
  history: {},      // ticker -> [{t,p,bid,ask,vol24}]
  alerts: [],       // newest first
  resolutions: [],  // newest first
  topics: {},       // topic id -> series rows found this run
  run: {},          // last run stats
};

export async function loadState(dir) {
  const file = path.join(dir, 'state.json');
  if (!existsSync(file)) return structuredClone(EMPTY_STATE);
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { ...structuredClone(EMPTY_STATE), ...parsed };
  } catch (e) {
    // A corrupt state file must not stop the engine; it restarts from empty and says so.
    const st = structuredClone(EMPTY_STATE);
    st.meta.recovered_from_corrupt_state = String(e.message);
    return st;
  }
}

/**
 * Applies one sample cycle to the state. Pure: no I/O, no clock — everything is passed in,
 * which is what makes it testable offline (see --selftest).
 */
export function applySample(state, { nowSeconds, markets, resolutions = [], topicsFound = {}, runId = null }) {
  const next = structuredClone(state);
  next.alerts = next.alerts || [];
  next.history = next.history || {};
  next.markets = next.markets || {};
  next.resolutions = next.resolutions || [];
  // Every ticker this engine has ever tracked, so a resolution is still recognised after the
  // 300-row market cap evicts a small row (F-66). Tiny: ticker -> topic.
  next.settled_markets = next.settled_markets || {};

  // Merged, not reset: runOnce() calls applySample() twice (samples, then resolutions) and a
  // reset would report "0 markets sampled" for a run that sampled dozens.
  // Counters accumulate across the calls that make up ONE run (samples, then resolutions),
  // and start from zero for a new run. runId identifies the run.
  const prevRun = next.run || {};
  const sameRun = runId !== null && prevRun.run_id === runId;
  const carry = sameRun ? prevRun : {};
  next.run = {
    run_id: runId !== null ? runId : (prevRun.run_id || null),
    sampled_at: new Date(nowSeconds * 1000).toISOString(),
    markets_sampled: 0,
    markets_without_price: 0,
    alerts_created: 0,
    candle_alerts_added: carry.candle_alerts_added || 0,
    untracked_settled_seen: carry.untracked_settled_seen || 0,
  };

  // ---- latest alert timestamp per ticker, used to decide the alert baseline
  const lastAlertAt = {};
  for (const a of next.alerts) {
    const t = Date.parse(a.ts) / 1000;
    if (!Number.isFinite(t)) continue;
    if (!lastAlertAt[a.ticker] || t > lastAlertAt[a.ticker].t) {
      lastAlertAt[a.ticker] = { t, price: a.to };
    }
  }

  const newAlerts = [];
  for (const entry of markets) {
    const m = entry.raw;
    const ticker = m.ticker;
    if (!ticker) continue;

    const { price, field, book_inconsistent, reciprocity_error } = trackedPrice(m);
    const bid = num(m.yes_bid_dollars);
    const ask = num(m.yes_ask_dollars);
    const vol24 = num(m.volume_24h_fp);

    const row = {
      ticker,
      event_ticker: m.event_ticker || null,
      series_ticker: entry.series_ticker || null,
      topic: entry.topic,
      title: m.title || m.yes_sub_title || null,
      status: m.status || null,
      result: m.result || '',
      price,
      price_field: field,
      book_inconsistent: !!book_inconsistent,
      reciprocity_error: reciprocity_error ?? null,
      yes_bid_dollars: m.yes_bid_dollars ?? null,
      yes_ask_dollars: m.yes_ask_dollars ?? null,
      yes_bid_size_fp: m.yes_bid_size_fp ?? null,
      yes_ask_size_fp: m.yes_ask_size_fp ?? null,
      no_bid_dollars: m.no_bid_dollars ?? null,
      no_ask_dollars: m.no_ask_dollars ?? null,
      last_price_dollars: m.last_price_dollars ?? null,
      previous_price_dollars: m.previous_price_dollars ?? null,
      volume_fp: m.volume_fp ?? null,
      volume_24h_fp: m.volume_24h_fp ?? null,
      open_interest_fp: m.open_interest_fp ?? null,
      est_traded_dollars: estimateTradedDollars(m, price),
      close_time: m.close_time || null,
      expected_expiration_time: m.expected_expiration_time || null,
      rules_primary: m.rules_primary || null,
      settlement_ts: m.settlement_ts || null,
      settlement_value_dollars: m.settlement_value_dollars ?? null,
      contract_terms_url: entry.series?.contract_terms_url || null,
      contract_url: entry.series?.contract_url || null,
      settlement_sources: entry.series?.settlement_sources || [],
      source_url: entry.source_url,
      sampled_at: new Date(nowSeconds * 1000).toISOString(),
    };

    next.markets[ticker] = row;
    next.run.markets_sampled += 1;
    if (price === null) {
      next.run.markets_without_price += 1;
      continue; // never guess a price (see trackedPrice)
    }

    // ---- history
    // Stored as a compact [timestamp, price] pair: the file is committed on every run, so a
    // verbose object per sample multiplied by dozens of markets made state.json grow to
    // several megabytes. Bid/ask/volume live on the latest row in `markets`, not in history.
    const hist = next.history[ticker] || [];
    hist.push([nowSeconds, price]);
    next.history[ticker] = hist.slice(-MAX_SAMPLES_PER_MARKET);

    // ---- baseline: previous sample, or the last alert inside the cooldown window
    const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
    let baseline = prev ? prev[1] : null;
    let baselineKind = 'previous sample';
    const la = lastAlertAt[ticker];
    if (la && nowSeconds - la.t <= ALERT_COOLDOWN_SECONDS) {
      baseline = la.price;
      baselineKind = 'last alert (within 30 min)';
    }

    const swing = detectSwing({
      ticker,
      topic: entry.topic,
      title: row.title,
      price,
      baseline,
      nowSeconds,
    });
    if (swing) {
      // A sampled price must be corroborated by another published field before it is published
      // as an alert. Uncorroborated rows are suppressed and counted, never shown.
      const corr = corroborate({ to: swing.to, m });
      if (!corr.ok) {
        next.run.uncorroborated_suppressed = (next.run.uncorroborated_suppressed || 0) + 1;
        continue; // skip this market only — never abort the whole sample
      }
      const model = modelScore({
        from: swing.from,
        delta: swing.delta,
        direction: swing.direction,
        to: swing.to,
        bid,
        ask,
        volume24h: vol24,
        sampleAgeSeconds: 0,
      });
      newAlerts.push({
        id: `${ticker}@${nowSeconds}`,
        ts: swing.ts,
        ticker,
        event_ticker: row.event_ticker,
        series_ticker: row.series_ticker,
        topic: swing.topic,
        title: swing.title,
        direction: swing.direction,
        from: swing.from,
        to: swing.to,
        delta: swing.delta,
        abs_delta: swing.abs_delta,
        threshold: SWING_THRESHOLD,
        baseline_kind: baselineKind,
        yes_bid_dollars: row.yes_bid_dollars,
        yes_ask_dollars: row.yes_ask_dollars,
        yes_bid_size_fp: row.yes_bid_size_fp,
        yes_ask_size_fp: row.yes_ask_size_fp,
        volume_24h_fp: row.volume_24h_fp,
        volume_fp: row.volume_fp,
        open_interest_fp: row.open_interest_fp,
        est_traded_dollars: row.est_traded_dollars,
        close_time: row.close_time,
        rules_primary: row.rules_primary,
        contract_terms_url: row.contract_terms_url,
        contract_url: row.contract_url,
        settlement_sources: row.settlement_sources,
        model: model,
        corroboration: { by: corr.how, gap: corr.gap, value: corr.value },
        book_inconsistent: !!book_inconsistent,
        source_url: row.source_url,
      });
    }
  }

  // ---- resolutions (result is "yes" | "no" | "scalar"; S7/S8)
  //
  // Only markets this engine actually tracks are kept, because that is what the brief asks
  // to follow ("track live events until the events have resolved"). A settled series can
  // return thousands of historical strikes; storing all of them would bury the tracked ones
  // and bloat the file. Everything else is counted, not dropped silently.
  const tracked = new Set(Object.keys(next.markets || {}));
  let untracked = 0;
  for (const r of resolutions) {
    if (!r || !r.ticker) continue;
    if (r.result !== 'yes' && r.result !== 'no' && r.result !== 'scalar') continue;
    if (next.resolutions.some((x) => x.ticker === r.ticker)) continue;
    // A tracked market can be evicted from `next.markets` by the 300-row cap below (or by the
    // earlier prune of a previous run) before its result is published. It is still a market this
    // engine followed, and `settled_markets` remembers that, so its resolution is not dropped.
    // Anything never tracked stays a count, not a row (see F-66).
    if (!tracked.has(r.ticker) && !next.settled_markets?.[r.ticker]) { untracked += 1; continue; }
    next.resolutions.push(r);
    // Keep the resolved row itself: `result`/`settlement_value_dollars` are the exchange's own
    // yes/no answer, and the site reads them on the market page after the market leaves the
    // open-market boards.
    if (next.markets?.[r.ticker]) {
      next.markets[r.ticker].result = r.result;
      next.markets[r.ticker].status = r.status || next.markets[r.ticker].status;
      next.markets[r.ticker].settlement_ts = r.settlement_ts ?? next.markets[r.ticker].settlement_ts;
      next.markets[r.ticker].settlement_value_dollars = r.settlement_value_dollars ?? next.markets[r.ticker].settlement_value_dollars;
    }
    if (next.alerts.some((a) => a.ticker === r.ticker)) {
      next.history[r.ticker] = next.history[r.ticker] || [];
    }
  }
  // A market that is no longer on an open board is still on this engine's follow list until its
  // result is known; if the sample moved it here, restore it so the row keeps its final answer.
  for (const r of next.resolutions) {
    if (!next.markets[r.ticker] && next.settled_markets[r.ticker]) {
      next.markets[r.ticker] = {
        ticker: r.ticker, event_ticker: r.event_ticker || null, series_ticker: r.series_ticker || null,
        topic: r.topic || next.settled_markets[r.ticker], title: r.title || null,
        status: r.status || 'finalized', result: r.result,
        price: r.last_price_dollars === null || r.last_price_dollars === undefined ? null : Number(r.last_price_dollars),
        close_time: r.close_time || null, settlement_ts: r.settlement_ts || null,
        settlement_value_dollars: r.settlement_value_dollars ?? null,
        rules_primary: r.rules_primary || null, contract_terms_url: r.contract_terms_url || null,
        source_url: r.source_url || null, resolved: true,
      };
    }
  }

  next.run.untracked_settled_seen = (next.run.untracked_settled_seen || 0) + untracked;
  next.resolutions.sort((a, b) => String(b.settlement_ts || '').localeCompare(String(a.settlement_ts || '')));
  next.resolutions = next.resolutions.slice(0, MAX_RESOLUTIONS);

  // ---- merge alerts: newest first, de-duplicated by id
  const known = new Set(next.alerts.map((a) => a.id));
  for (const a of newAlerts) if (!known.has(a.id)) next.alerts.push(a);

  /* Every retained row is re-scored with the current model (F-74), via the exported helper so
   * `scripts/rescore-feed.mjs` applies exactly the same rule to the committed feed. The helper
   * preserves the age penalty that was part of the published verdict and keeps the old verdict as
   * `model.original_score`/`original_highROI`. Prices, arrows, timestamps and ids are untouched. */
  next.meta = next.meta || {};
  next.meta.rescored_by_current_model = rescoreAlerts(next.alerts);
  next.meta.model_version = MODEL_VERSION;
  next.meta.legacy_unfillable_high_roi = deriveLegacyUnfillable(next.alerts, next.meta.legacy_unfillable_high_roi);

  next.alerts.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  next.alerts = next.alerts.slice(0, MAX_ALERTS);
  next.run.alerts_created = (carry.alerts_created || 0) + newAlerts.length;
  next.run.markets_sampled = (carry.markets_sampled || 0) + next.run.markets_sampled;
  next.run.markets_without_price = (carry.markets_without_price || 0) + next.run.markets_without_price;

  // ---- prune history
  const cutoff = nowSeconds - HISTORY_RETAIN_SECONDS;
  for (const [ticker, hist] of Object.entries(next.history)) {
    const kept = hist.filter((smp) => Array.isArray(smp) && smp[0] >= cutoff).slice(-MAX_SAMPLES_PER_MARKET);
    if (kept.length) next.history[ticker] = kept;
    else delete next.history[ticker];
  }

  // Keep history only for the biggest contracts, and bound the market map, so the committed
  // state stays small enough to update every 10 minutes.
  const keep = new Set(topMarketsByTopic(next, MAX_HISTORY_MARKETS).map((m) => m.ticker));
  for (const ticker of Object.keys(next.history)) if (!keep.has(ticker)) delete next.history[ticker];

  // Remember what is tracked BEFORE the cap below evicts rows, so a later resolution for an
  // evicted market is still attributed to this engine (F-66).
  for (const [ticker, m] of Object.entries(next.markets)) {
    if (m && m.topic) next.settled_markets[ticker] = m.topic;
  }
  // Markets the engine follows to the end are never evicted while they are still waiting for a
  // result: evicting them is what silently broke resolution tracking. They are few (only
  // markets that produced at least one alert), so they are kept outside the 300-row budget.
  const resolvedAt = new Map((next.resolutions || []).map((r) => [r.ticker, Date.parse(r.settlement_ts || '') / 1000]));
  // "Followed" = this engine published at least one alert for the market. Those are the markets
  // the brief asks to carry to a yes/no answer, and there are only a handful of them.
  const followed = new Set(
    next.alerts.map((a) => a.ticker).filter((t) => {
      const at = resolvedAt.get(t);
      if (at !== undefined) return Number.isFinite(at) ? nowSeconds - at < 7 * 86400 : true;
      // Not resolved yet: keep it only while the question is still live, so a market the demo API
      // never settles cannot grow this file without limit.
      const close = Date.parse(next.markets[t]?.close_time || '') / 1000;
      return !Number.isFinite(close) || close > nowSeconds - 30 * 86400;
    }),
  );
  const marketTickers = Object.keys(next.markets);
  const budget = 300;
  if (marketTickers.length > budget) {
    const keepMarkets = new Set(topMarkets(next, budget).map((m) => m.ticker));
    for (const ticker of marketTickers) {
      if (keepMarkets.has(ticker) || followed.has(ticker)) continue;
      delete next.markets[ticker];
    }
  }

  // Only a compact discovery summary is kept: the raw series rows carry long prohibition
  // texts and settlement lists that made state.json several megabytes for no benefit. The
  // full rows are still returned by the API and linked from the site.
  const summary = {};
  for (const [tid, rows] of Object.entries(topicsFound || {})) {
    summary[tid] = {
      count: (rows || []).length,
      top: (rows || []).slice(0, 8).map((r) => ({
        series_ticker: r.series_ticker,
        title: r.title,
        volume_fp: r.volume_fp,
        source_url: r.source_url,
      })),
    };
  }
  next.topics = summary;
  next.meta.generated_at = new Date(nowSeconds * 1000).toISOString();
  return next;
}

/* ------------------------------------------------------------------ resolutions */

/**
 * For every tracked market that is no longer open, read its settled state.
 * Uses GET /markets?series_ticker=..&status=settled (S4) and GET /markets/{ticker} (S5).
 *
 * Two properties this must keep, both measured as defects on 2026-11-21 (F-66):
 *  1. A series can publish far more settled strikes than one page holds (`limit` is capped at
 *     1000 by S4). Requesting `status=settled` alone sorts by *creation* time, newest first, so
 *     the page is full of recently created strikes rather than recent settlements, and a market
 *     that resolved this hour can be missed. S4 documents that `min_settled_ts`/`max_settled_ts`
 *     sort by settlement time, latest first, and are the filters compatible with `status=settled`;
 *     the request below therefore uses `min_settled_ts` (with an overlap window) and still follows
 *     the cursor within a fixed budget.
 *  2. Only markets still waiting for an answer are requested, and series whose tracked markets
 *     closed most recently are looked at first, so the request budget is spent where a
 *     resolution can actually exist. Previously the first 12 series in insertion order were
 *     polled forever, even after every one of their tracked markets had resolved.
 */
export const SETTLE_OVERLAP_SECONDS = 900;

export async function collectResolutions(client, state, { maxSeries = 12, maxPages = 2, nowSeconds = null, since = null, log = () => {} } = {}) {
  const now = nowSeconds === null ? Math.floor(Date.now() / 1000) : nowSeconds;
  const resolvedTickers = new Set((state.resolutions || []).map((r) => r.ticker));
  const pending = Object.values(state.markets || {}).filter((m) => m && m.series_ticker && !resolvedTickers.has(m.ticker));
  const pendingTickers = new Set(pending.map((m) => m.ticker));

  const bySeries = new Map();
  for (const m of pending) {
    if (!bySeries.has(m.series_ticker)) bySeries.set(m.series_ticker, []);
    bySeries.get(m.series_ticker).push(m);
  }
  const lastClose = (rows) => rows.reduce((acc, r) => {
    const t = Date.parse(r.close_time || '') / 1000;
    return Number.isFinite(t) && t <= now && t > acc ? t : acc;
  }, 0);
  const list = [...bySeries.entries()]
    .map(([series_ticker, rows]) => ({ series_ticker, rows, closedAt: lastClose(rows) }))
    // A tracked market that has already passed close_time is the likeliest to have settled.
    .sort((a, b) => (b.closedAt - a.closedAt) || (b.rows.length - a.rows.length))
    .slice(0, maxSeries)
    .map((s) => s.series_ticker);

  // Only settlements newer than the previous sample (plus an overlap) are relevant; without this
  // the newest page can be entirely older settlements for a busy series.
  const previousRun = Date.parse(state.meta?.generated_at || '') / 1000;
  const minSettledTs = Number.isFinite(since)
    ? since
    : (Number.isFinite(previousRun) ? Math.max(0, Math.floor(previousRun) - SETTLE_OVERLAP_SECONDS) : null);

  const out = [];
  for (const st of list) {
    let data;
    let cursor = '';
    let pages = 0;
    do {
      const path = marketsQueryUrl(st, {
        status: 'settled', limit: 1000, minSettledTs, cursor: cursor || null,
      });
      try {
        data = await client.getJson(path);
      } catch (e) {
        log(`  settled lookup failed for ${st}: ${e.message}`);
        data = null;
        break;
      }
      pages += 1;
      cursor = data.cursor || '';
      for (const m of data.markets || []) {
        if (!pendingTickers.has(m.ticker)) continue;      // counted as untracked below
        if (m.result !== 'yes' && m.result !== 'no' && m.result !== 'scalar') continue;
        out.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker || null,
        series_ticker: st,
        topic: (state.markets?.[m.ticker] || {}).topic || null,
        title: m.title || null,
        result: m.result,
        status: m.status || null,
        settlement_value_dollars: m.settlement_value_dollars ?? null,
        settlement_ts: m.settlement_ts || null,
        last_price_dollars: m.last_price_dollars ?? null,
        volume_fp: m.volume_fp ?? null,
        close_time: m.close_time || null,
        rules_primary: m.rules_primary || null,
        contract_terms_url: (state.markets?.[m.ticker] || {}).contract_terms_url || null,
        source_url: client.base + path,
      });
        log(`  resolved: ${m.ticker} -> ${m.result}`);
      }
    } while (cursor && pages < maxPages);
  }
  return out;
}

/* ------------------------------------------------------------------ orderbook */

/**
 * Liquidity ladder from the official orderbook (S6). Bids only — a YES ask is derived as
 * $1.00 - best NO bid, exactly as documented. Returns both raw and derived numbers so the
 * site can show which is which.
 */
export function buildLadder(orderbookJson) {
  const ob = (orderbookJson && orderbookJson.orderbook_fp) || (orderbookJson && orderbookJson.orderbook) || null;
  if (!ob) return { yes_bids: [], no_bids: [], best_yes_bid: null, best_no_bid: null, implied_yes_ask: null, implied_no_ask: null, source: 'orderbook_fp' };
  const toLevels = (arr) =>
    (arr || [])
      .map((lvl) => ({ price: num(lvl[0]), count: num(lvl[1]) }))
      .filter((l) => l.price !== null && l.count !== null)
      .sort((a, b) => a.price - b.price);           // documented ascending, best bid last
  const yes = toLevels(ob.yes_dollars);
  const no = toLevels(ob.no_dollars);
  return {
    yes_bids: yes,
    no_bids: no,
    best_yes_bid: yes.length ? yes[yes.length - 1].price : null,
    best_no_bid: no.length ? no[no.length - 1].price : null,
    implied_yes_ask: no.length ? round(1 - no[no.length - 1].price, 4) : null,
    implied_no_ask: yes.length ? round(1 - yes[yes.length - 1].price, 4) : null,
    cumulative_contracts: {
      yes: round(yes.reduce((s, l) => s + l.count, 0), 2),
      no: round(no.reduce((s, l) => s + l.count, 0), 2),
    },
    source: ob.yes_dollars ? 'orderbook_fp' : 'orderbook',
  };
}

export async function collectOrderbooks(client, state, { maxMarkets = 8, log = () => {} } = {}) {
  const ranked = Object.values(state.markets || {})
    .filter((m) => m && m.price !== null && m.ticker)
    .sort((a, b) => (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0))
    .slice(0, maxMarkets);
  const out = {};
  for (const m of ranked) {
    const path = `/markets/${encodeURIComponent(m.ticker)}/orderbook`;
    try {
      const data = await client.getJson(path);
      out[m.ticker] = { ...buildLadder(data), ticker: m.ticker, source_url: client.base + path, sampled_at: new Date().toISOString() };
      log(`  orderbook ${m.ticker}: yes levels ${out[m.ticker].yes_bids.length}`);
    } catch (e) {
      log(`  orderbook failed for ${m.ticker}: ${e.message}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ candle swings */

/**
 * Candle-based swing detection.
 *
 * Sampling REST every few minutes can miss a swing that happens entirely between two
 * runs. The candlesticks endpoint (S12) gives per-period OHLC of *traded* prices
 * (`price.high_dollars` / `price.low_dollars`, both nullable when nothing traded in the
 * period), so one request per market can reveal a >= $0.10 move that no pair of samples
 * saw.
 *
 * Rules, all traceable:
 *   * a candle with no trades has null OHLC -> it is skipped, never treated as a price;
 *   * an "up" event is (close - low) >= threshold, a "down" event is (high - close) >=
 *     threshold, using the traded extremes inside the candle;
 *   * consecutive candles reporting the same move are collapsed to the first one, so a
 *     quiet market does not emit one alert per candle for the same swing.
 * Returns candle-alert objects that applySample() merges under their own id prefix.
 */
export function candleSwings({ ticker, topic, title, candlesticks, threshold = SWING_THRESHOLD, sourceUrl = null, meta = {} }) {
  const out = [];
  let lastSig = null;
  for (const c of candlesticks || []) {
    const price = c.price || {};
    const high = num(price.high_dollars);
    const low = num(price.low_dollars);
    const close = num(price.close_dollars);
    if (high === null || low === null || close === null) continue;   // no trades in this period
    const upMove = round(close - low, 4);
    const downMove = round(high - close, 4);
    let direction = null;
    let delta = 0;
    let from = null;
    if (upMove >= threshold && upMove >= downMove) {
      direction = 'up'; delta = upMove; from = low;
    } else if (downMove >= threshold) {
      direction = 'down'; delta = -downMove; from = high;
    }
    if (!direction) { lastSig = null; continue; }
    const sig = `${direction}:${from}:${close}`;
    if (sig === lastSig) continue;                                   // same swing, next candle
    lastSig = sig;
    const endTs = num(c.end_period_ts);
    out.push({
      id: `candle:${ticker}@${endTs}`,
      ts: endTs ? new Date(endTs * 1000).toISOString() : null,
      ticker,
      topic,
      title,
      direction,
      from: round(from, 4),
      to: round(close, 4),
      delta: round(delta, 4),
      abs_delta: round(Math.abs(delta), 4),
      threshold,
      baseline_kind: 'candlestick traded range',
      detection: 'candle',
      candle: { end_period_ts: endTs, high, low, close, volume_fp: c.volume_fp ?? null, open_interest_fp: c.open_interest_fp ?? null },
      ...meta,
      source_url: sourceUrl,
    });
  }
  return out;
}

/** Fetch 1-minute candles for a market, respecting the documented 5,000-period cap (S12). */
export async function fetchCandles(client, { seriesTicker, ticker, lookbackMinutes = 180, maxPeriods = 2000 }) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.min(lookbackMinutes, maxPeriods) * 60;
  const p = new URLSearchParams({ start_ts: String(start), end_ts: String(end), period_interval: '1' });
  const path = `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks?${p.toString()}`;
  const data = await client.getJson(path);
  return { candlesticks: data.candlesticks || [], source_url: client.base + path };
}

/** Attach candle-detected swings to the state. De-duplicated by id, newest first. */
export function mergeCandleAlerts(state, candleAlerts) {
  const next = structuredClone(state);
  next.alerts = next.alerts || [];
  const known = new Set(next.alerts.map((a) => a.id));
  let added = 0;
  for (const a of candleAlerts) {
    if (!a.id || known.has(a.id)) continue;
    // Score it with the same model, using the market row we already sampled for context.
    const m = next.markets[a.ticker] || {};
    a.model = modelScore({
      from: a.from,
      delta: a.delta,
      direction: a.direction,
      to: a.to,
      bid: num(m.yes_bid_dollars),
      ask: num(m.yes_ask_dollars),
      volume24h: num(m.volume_24h_fp),
      sampleAgeSeconds: a.ts ? Math.max(0, (Date.now() - Date.parse(a.ts)) / 1000) : 0,
    });
    a.est_traded_dollars = m.est_traded_dollars ?? null;
    a.volume_24h_fp = m.volume_24h_fp ?? null;
    a.volume_fp = m.volume_fp ?? null;
    a.yes_bid_dollars = m.yes_bid_dollars ?? null;
    a.yes_ask_dollars = m.yes_ask_dollars ?? null;
    /* Carried so the chat can answer "how many contracts are at this price" (brief requirement).
     * Measured 2026-11-21: 37 of 38 published rows had no size at all because these two fields
     * were never copied here, even when the sampled market row had them. */
    a.yes_bid_size_fp = m.yes_bid_size_fp ?? null;
    a.yes_ask_size_fp = m.yes_ask_size_fp ?? null;
    a.open_interest_fp = m.open_interest_fp ?? null;
    a.close_time = m.close_time ?? null;
    a.rules_primary = m.rules_primary ?? null;
    next.alerts.push(a);
    known.add(a.id);
    added += 1;
  }
  next.alerts.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
  next.alerts = next.alerts.slice(0, MAX_ALERTS);
  next.run = { ...(next.run || {}), candle_alerts_added: added };
  return next;
}


/* ------------------------------------------------------------------ trade swings */

/**
 * Trade-level swing detection (S13).
 *
 * This is the sharpest public, unauthenticated view of price: every completed trade carries
 * its own price and timestamp, so a swing that happened between two 10-minute samples is
 * still visible — and visible at the exact trade that caused it.
 *
 * Rules:
 *   * trades are sorted oldest-first by `created_time`;
 *   * a trade is compared with the most recent *earlier* trade inside `windowSeconds`
 *     (default 30 min). Comparing across a long gap would report unrelated prices as a swing;
 *   * any |Δ| >= threshold fires, in the direction of the move;
 *   * consecutive trades carrying the same repeated move are collapsed to the first one.
 *
 * `yes_price_dollars` is the only price used, because the contract price displayed everywhere
 * else is the YES price (S5); `no_price_dollars` is its complement and would double-count.
 */
export function tradeSwings({ ticker, topic, title, trades, threshold = SWING_THRESHOLD, windowSeconds = 1800,
  sourceUrl = null, meta = {} }) {
  const parsed = (trades || [])
    .map((t) => ({
      ts: Date.parse(t.created_time) / 1000,
      price: num(t.yes_price_dollars),
      count: num(t.count_fp),
      id: t.trade_id || null,
    }))
    .filter((t) => Number.isFinite(t.ts) && t.price !== null && t.price > 0 && t.price < 1)
    .sort((a, b) => a.ts - b.ts);

  const out = [];
  let lastSig = null;
  for (let i = 1; i < parsed.length; i++) {
    const cur = parsed[i];
    // most recent earlier trade inside the window
    let ref = null;
    for (let j = i - 1; j >= 0; j--) {
      if (cur.ts - parsed[j].ts > windowSeconds) break;
      ref = parsed[j];
      break;
    }
    if (!ref) { lastSig = null; continue; }
    const delta = round(cur.price - ref.price, 4);
    if (Math.abs(delta) + 1e-12 < threshold) { lastSig = null; continue; }
    const direction = delta > 0 ? 'up' : 'down';
    const sig = `${direction}:${ref.price}:${cur.price}`;
    if (sig === lastSig) continue;
    lastSig = sig;
    out.push({
      id: `trade:${ticker}@${Math.floor(cur.ts)}`,
      ts: new Date(cur.ts * 1000).toISOString(),
      ticker,
      topic,
      title,
      direction,
      from: round(ref.price, 4),
      to: round(cur.price, 4),
      delta,
      abs_delta: round(Math.abs(delta), 4),
      threshold,
      baseline_kind: 'previous trade within 30 min',
      detection: 'trade',
      trade: { trade_id: cur.id, count_fp: cur.count, at: new Date(cur.ts * 1000).toISOString(), ref_at: new Date(ref.ts * 1000).toISOString() },
      ...meta,
      source_url: sourceUrl,
    });
  }
  return out;
}

/** Trades for one market since `minTs` (S13). Returns raw trades plus the exact request URL. */
export async function fetchTrades(client, { ticker, minTs, limit = 1000 }) {
  const p = new URLSearchParams();
  p.set('ticker', ticker);
  if (minTs) p.set('min_ts', String(Math.floor(minTs)));
  p.set('limit', String(limit));
  const path = `/markets/trades?${p.toString()}`;
  const data = await client.getJson(path);
  return { trades: data.trades || [], source_url: client.base + path, cursor: data.cursor || '' };
}

/**
 * Collapse alerts that describe the same swing or rapid quote-flapping on the same ticker,
 * keeping the most precise detector (trade > candle > sample) and, on ties, the earliest leg
 * of the run.
 *
 * Enforces one swing per ticker per 15-minute window regardless of direction or detector
 * (preventing both rapid up/down flapping and 3-14m trade/candle cross-detector floods such
 * as observed on KXBTCY-27JAN0100-B97500 and KXPRESNOMD-28-AKLO).
 */
export const DUP_WINDOW_SAME_DIR_MS = 3 * 60 * 1000;
export const DUP_WINDOW_SAME_TICKER_MS = 15 * 60 * 1000;

export function collapseDuplicates(alerts) {
  const precision = { trade: 3, candle: 2, sample: 1 };
  const rank = (a) => precision[a.detection || 'sample'] || 1;
  const kept = [];
  /* Most precise detector first, then oldest first: the *first* leg of a run is the one worth
   * keeping, so a flap collapses to its opening move rather than to whichever arrived last. */
  for (const a of [...alerts].sort((x, y) => (rank(y) - rank(x))
    || ((Date.parse(x.ts) || 0) - (Date.parse(y.ts) || 0)))) {
    const dup = kept.find((k) =>
      k.ticker === a.ticker &&
      Math.abs((Date.parse(k.ts) || 0) - (Date.parse(a.ts) || 0)) <= DUP_WINDOW_SAME_TICKER_MS);
    if (!dup) kept.push(a);
  }
  kept.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
  return kept;
}

/* ------------------------------------------------------------------ run */


export async function runOnce({ dir = 'data/live', maxSeries = 12, candleMarkets = 6, tradeMarkets = 10, candleLookbackMinutes = 180, dryRun = false, log = console.log } = {}) {
  const started = Math.floor(Date.now() / 1000);
  log(`KalshiDash1 live engine — ${new Date(started * 1000).toISOString()}`);
  log(`  base: ${BASE} (S1)  threshold: $${SWING_THRESHOLD}  max series: ${maxSeries}  candle markets: ${candleMarkets}`);

  const client = makeClient({ log });
  const state = await loadState(dir);
  let taxonomyNotes = [];

  // 0. taxonomy guard (S11)
  const tax = await client.getJson('/search/tags_by_categories');
  const { problems, notes } = checkTaxonomy(tax);
  if (problems.length) {
    throw new Error('topic configuration no longer matches the live tag taxonomy:\n  ' + problems.join('\n  '));
  }
  notes.forEach((n) => log('  taxonomy note: ' + n));
  taxonomyNotes = notes;
  log(`  taxonomy check: OK (${notes.length} note(s), no contradictions)`);

  // 1. discovery
  const seriesByTopic = await discoverSeries(client, { maxSeries, log });

  // 2. markets
  const { markets, chosenSeries } = await collectMarkets(client, seriesByTopic, { maxSeries, log });

  // 3. sample + detect
  const now = Math.floor(Date.now() / 1000);
  const runId = new Date(now * 1000).toISOString();
  let next = applySample(state, { nowSeconds: now, markets, topicsFound: seriesByTopic, runId });

  // 4. resolutions
  const resolutions = await collectResolutions(client, next, { maxSeries, log });
  if (resolutions.length) next = applySample(next, { nowSeconds: now, markets: [], resolutions, topicsFound: seriesByTopic, runId });

  // 4b. trade-level swings on the biggest rows of each topic (sharpest public view, S13).
  // Only trades since the last run are read, so the request is small and nothing is re-reported.
  const tradeAlerts = [];
  const perTopicTrades = Math.max(1, Math.ceil(tradeMarkets / TOPICS.length));
  const tradeTargets = topMarketsByTopic(next, perTopicTrades).slice(0, tradeMarkets);
  const tradeLookback = Math.max(1800, Math.min(6 * 3600, (now - (Date.parse(state.meta?.generated_at || 0) / 1000) || 3600) + 600));
  for (const m of tradeTargets) {
    try {
      const { trades, source_url } = await fetchTrades(client, { ticker: m.ticker, minTs: now - tradeLookback });
      const found = tradeSwings({
        ticker: m.ticker, topic: m.topic, title: m.title, trades, sourceUrl: source_url,
        meta: { event_ticker: m.event_ticker, series_ticker: m.series_ticker, contract_terms_url: m.contract_terms_url },
      });
      tradeAlerts.push(...found);
      log(`  trades ${m.ticker}: ${trades.length} in ${Math.round(tradeLookback / 60)} min, ${found.length} swing(s)`);
    } catch (e) {
      log(`  trades failed for ${m.ticker}: ${e.message}`);
    }
  }
  if (tradeAlerts.length) next = mergeCandleAlerts(next, tradeAlerts); // same merge/score path
  next.meta.trade_markets_checked = tradeTargets.length;
  next.meta.trade_lookback_seconds = tradeLookback;

  // 5. candle-based swings on the biggest rows (catches moves between sparse samples, S12)
  const candleAlerts = [];
  // Spread the candle budget across the five topics: ranking globally would spend every
  // candle request on the highest-volume topic (elections) and never look at crypto/golf.
  const perTopicCandles = Math.max(1, Math.ceil(candleMarkets / TOPICS.length));
  const candleTargets = topMarketsByTopic(next, perTopicCandles).slice(0, candleMarkets);
  for (const m of candleTargets) {
    if (!m.series_ticker) continue;
    try {
      const { candlesticks, source_url } = await fetchCandles(client, {
        seriesTicker: m.series_ticker,
        ticker: m.ticker,
        lookbackMinutes: candleLookbackMinutes,
      });
      const found = candleSwings({
        ticker: m.ticker, topic: m.topic, title: m.title, candlesticks, sourceUrl: source_url,
        meta: { event_ticker: m.event_ticker, series_ticker: m.series_ticker, contract_terms_url: m.contract_terms_url },
      });
      candleAlerts.push(...found);
      log(`  candles ${m.ticker}: ${candlesticks.length} periods, ${found.length} swing(s)`);
    } catch (e) {
      log(`  candles failed for ${m.ticker}: ${e.message}`);
    }
  }
  if (candleAlerts.length) next = mergeCandleAlerts(next, candleAlerts);
  next.meta.candle_markets_checked = candleTargets.length;

  // 6. orderbooks for the biggest rows
  const orderbooks = await collectOrderbooks(client, next, { log });

  // 6b. SCORE SWINGS THAT DO NOT COME FROM A SAMPLED MARKET ROW.
  //
  // Trade and candle detectors publish swings for markets that are not in `next.markets`
  // (the sampler keeps a ranked subset). Those rows reached the feed with NO model block at
  // all, which is why the high-ROI pane could only ever show a handful of samplers. Quoting
  // each one now, from the official single-market endpoint, lets every swing be scored on the
  // same terms — and, more importantly, lets the follow-through gate see the real book.
  next.meta.model_inputs_fetched = 0;
  next.meta.model_inputs_failed = 0;
  const unscored = next.alerts.filter((a) => !a.model || typeof a.model.score !== 'number');
  const quoteCache = new Map();
  for (const a of unscored.slice(0, 20)) {
    try {
      if (!quoteCache.has(a.ticker)) {
        const data = await client.getJson(`/markets/${encodeURIComponent(a.ticker)}`);
        quoteCache.set(a.ticker, (data && data.market) || null);
      }
      const q = quoteCache.get(a.ticker);
      if (!q) { next.meta.model_inputs_failed += 1; continue; }
      const bid = num(q.yes_bid_dollars);
      const ask = num(q.yes_ask_dollars);
      a.yes_bid_dollars = q.yes_bid_dollars ?? a.yes_bid_dollars ?? null;
      a.yes_ask_dollars = q.yes_ask_dollars ?? a.yes_ask_dollars ?? null;
      a.yes_bid_size_fp = q.yes_bid_size_fp ?? a.yes_bid_size_fp ?? null;
      a.yes_ask_size_fp = q.yes_ask_size_fp ?? a.yes_ask_size_fp ?? null;
      a.volume_24h_fp = q.volume_24h_fp ?? a.volume_24h_fp ?? null;
      a.volume_fp = q.volume_fp ?? a.volume_fp ?? null;
      a.model = modelScore({
        from: a.from,
        delta: a.delta,
        direction: a.direction,
        to: a.to,
        bid,
        ask,
        volume24h: num(q.volume_24h_fp),
        sampleAgeSeconds: a.ts ? Math.max(0, (Date.now() - Date.parse(a.ts)) / 1000) : 0,
      });
      a.model.quote_source_url = client.base + `/markets/${encodeURIComponent(a.ticker)}`;
      a.model.quote_sampled_at = new Date().toISOString();
      next.meta.model_inputs_fetched += 1;
    } catch (e) {
      next.meta.model_inputs_failed += 1;
      log(`  quote failed for ${a.ticker}: ${e.message}`);
    }
  }

  // One swing can be seen by three detectors; keep only the most precise row.
  const beforeDedupe = next.alerts.length;
  next.alerts = collapseDuplicates(next.alerts);
  next.meta.duplicates_collapsed = beforeDedupe - next.alerts.length;
  next.meta.high_roi_alerts = next.alerts.filter((a) => a.model && a.model.highROI).length;
  next.meta.untradeable_high_roi_blocked = next.alerts.filter(
    (a) => a.model && a.model.tradeable === false && a.model.score >= HIGH_ROI_THRESHOLD,
  ).length;

  next.meta.base_url = BASE;
  next.meta.legacy_base_url = LEGACY_BASE;
  next.meta.threshold = SWING_THRESHOLD;
  next.meta.high_roi_threshold = HIGH_ROI_THRESHOLD;
  next.meta.model_version = MODEL_VERSION;
  next.meta.requests_this_run = client.stats.requests;
  next.meta.retries_this_run = client.stats.retries;
  next.meta.series_checked = chosenSeries.map((s) => s.series_ticker);
  next.meta.topic_rules = TOPICS.map(({ id, label, queries, why }) => ({ id, label, queries, why }));
  next.meta.taxonomy_notes = taxonomyNotes;
  // A topic that returned no series is reported, never silently shown as an empty board.
  next.meta.topics_without_series = TOPICS
    .filter((t) => !((next.topics || {})[t.id] || {}).count)
    .map((t) => t.id);
  next.meta.orderbooks = orderbooks;

  log(`  sampled ${next.run.markets_sampled} markets, ${next.run.markets_without_price} without a usable price`);
  log(`  new alerts: ${next.run.alerts_created} (total kept: ${next.alerts.length})`);
  log(`  resolutions known: ${next.resolutions.length}`);
  log(`  requests: ${client.stats.requests}, retries: ${client.stats.retries}`);

  if (!dryRun) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'state.json'), JSON.stringify(next, null, 1) + '\n');
    // Published views — small files the static site fetches directly.
    await writeFile(
      path.join(dir, 'feed.json'),
      JSON.stringify(
        {
          meta: next.meta,
          run: next.run,
          alerts: next.alerts.slice(0, 200),
          resolutions: next.resolutions.slice(0, 100),
          awaiting: awaitingResolutions(next, 40),
          markets: topMarkets(next, 60),
          by_topic: boardByTopic(next, 24),
          topics: next.topics || {},
          history: slimHistory(next, 12),
          orderbooks: next.meta.orderbooks || {},
        },
        null,
        1,
      ) + '\n',
    );
    log(`  wrote ${path.join(dir, 'state.json')} and ${path.join(dir, 'feed.json')}`);
  } else {
    log('  --dry-run: nothing written');
  }
  return next;
}

/** Highest-dollar rows per topic: one topic can never starve the others. */
export function topMarketsByTopic(state, perTopic = 4) {
  const out = [];
  for (const t of TOPICS) {
    const rows = Object.values(state.markets || {})
      .filter((m) => m && m.topic === t.id && m.price !== null)
      .sort((a, b) => (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0))
      .slice(0, perTopic);
    out.push(...rows);
  }
  return out;
}

/** Per-topic board, so topics stay separate and each one ranks its own top contracts. */
export function boardByTopic(state, perTopic = 24) {
  const out = {};
  for (const t of TOPICS) {
    out[t.id] = {
      label: t.label,
      rows: Object.values(state.markets || {})
        .filter((m) => m && m.topic === t.id)
        .sort((a, b) => (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0))
        .slice(0, perTopic),
    };
  }
  return out;
}

/**
 * Markets the engine has alerted on and is still following to a yes/no answer. This is the
 * published evidence for "track live events until the events have resolved": each row says what
 * it is waiting for (`waiting_for`: close_time / settlement) and links the API row behind it.
 */
export function awaitingResolutions(state, limit = 40) {
  const resolved = new Set((state.resolutions || []).map((r) => r.ticker));
  const alerted = [...new Set((state.alerts || []).map((a) => a.ticker))];
  return alerted
    .filter((t) => !resolved.has(t))
    .map((t) => {
      const m = state.markets?.[t];
      if (!m) return null;
      const lastAlert = (state.alerts || []).find((a) => a.ticker === t) || {};
      return {
        ticker: t, title: m.title || null, topic: m.topic || null,
        event_ticker: m.event_ticker || null, series_ticker: m.series_ticker || null,
        close_time: m.close_time || null, expected_expiration_time: m.expected_expiration_time || null,
        status: m.status || null, last_price_dollars: m.last_price_dollars ?? null,
        last_alert_ts: lastAlert.ts || null, last_alert_delta: lastAlert.delta ?? null,
        tracking_since: (state.alerts || []).filter((a) => a.ticker === t).slice(-1)[0]?.ts || null,
        source_url: m.source_url || null, rules_primary: m.rules_primary || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.close_time || '9999').localeCompare(String(b.close_time || '9999')))
    .slice(0, limit);
}

/** Highest estimated traded dollars first — the brief's "highest dollar amount" ranking. */
export function topMarkets(state, limit = 60) {
  return Object.values(state.markets || {})
    .filter(Boolean)
    .sort((a, b) => (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0))
    .slice(0, limit);
}

/** Keep the history of only the most relevant markets so feed.json stays small. */
export function slimHistory(state, limit = 12) {
  const top = topMarkets(state, limit).map((m) => m.ticker);
  const out = {};
  for (const t of top) if (state.history[t]) out[t] = state.history[t].slice(-400);  // [[t, price], ...]
  return out;
}

/* ------------------------------------------------------------------ selftest */

/**
 * Offline check of the pure logic. No network. Exits non-zero on any failed assertion,
 * so CI catches a regression in threshold handling or scoring.
 */
export async function selftest() {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  // num / trackedPrice
  ok(num('0.4200') === 0.42, 'num parses fixed-point string');
  ok(num('') === null && num(null) === null && num('abc') === null, 'num never coerces garbage to 0');
  ok(trackedPrice({ last_price_dollars: '0.3400' }).price === 0.34, 'trackedPrice prefers last traded price');
  ok(trackedPrice({ last_price_dollars: '0.0000', yes_bid_dollars: '0.2000', yes_ask_dollars: '0.3000' }).price === 0.25, 'trackedPrice falls back to bid/ask mid when last price is 0');
  ok(trackedPrice({ last_price_dollars: '0.0000', yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000' }).price === null, 'trackedPrice returns null rather than inventing a price');
  // The measured demo defect: yes_ask corrupted to 0.8030 while no_bid stayed 0.9970.
  const corruptRow = trackedPrice({
    last_price_dollars: '0.8030', previous_price_dollars: '0.0030',
    yes_bid_dollars: '0.0020', yes_ask_dollars: '0.8030',
    no_bid_dollars: '0.9970', no_ask_dollars: '0.9980', result: '',
  });
  ok(corruptRow.price === 0.0025, 'a row that fails reciprocity is priced from the NO side (got ' + corruptRow.price + ')');
  ok(corruptRow.book_inconsistent === true, 'the contradictory row is marked');
  // The healthy single-market read of the same ticker must give its real 0.0030 price.
  const healthyRow = trackedPrice({
    last_price_dollars: '0.0030', previous_price_dollars: '0.0030',
    yes_bid_dollars: '0.0020', yes_ask_dollars: '0.0030',
    no_bid_dollars: '0.9970', no_ask_dollars: '0.9980', result: '',
  });
  ok(healthyRow.price === 0.003 && healthyRow.book_inconsistent !== true, 'a healthy row keeps its real last price (0.0030)');
  // A legitimately wide but reciprocal book must NOT be replaced by its meaningless midpoint.
  const wideBook = trackedPrice({
    last_price_dollars: '0.9430', previous_price_dollars: '0.9350',
    yes_bid_dollars: '0.0100', yes_ask_dollars: '0.9430',
    no_bid_dollars: '0.0570', no_ask_dollars: '0.9900', result: '',
  });
  ok(wideBook.price === 0.943, 'a wide but reciprocal book keeps the last traded price, not the midpoint (got ' + wideBook.price + ')');
  ok(bookReciprocity({ yes_ask_dollars: '0.9430', no_bid_dollars: '0.0570', yes_bid_dollars: '0.0100', no_ask_dollars: '0.9900' }).ok === true, 'reciprocity passes for the wide book');
  ok(bookReciprocity({ yes_ask_dollars: '0.8030', no_bid_dollars: '0.9970' }).ok === false, 'reciprocity fails for the corrupt book');
  // A stale last price inside a TIGHT, reciprocal book must be replaced by the book.
  const staleOnTight = trackedPrice({
    last_price_dollars: '0.8030', previous_price_dollars: '0.0030',
    yes_bid_dollars: '0.0020', yes_ask_dollars: '0.0030',
    no_bid_dollars: '0.9970', no_ask_dollars: '0.9980', result: '',
  });
  ok(staleOnTight.price === 0.0025, 'a stale last price on a tight book is replaced by the book (got ' + staleOnTight.price + ')');
  ok(staleOnTight.book_inconsistent === true, 'the replaced row is flagged');
  const coherent = trackedPrice({ last_price_dollars: '0.4400', yes_bid_dollars: '0.4300', yes_ask_dollars: '0.4500', no_bid_dollars: '0.5500', no_ask_dollars: '0.5700' });
  ok(coherent.price === 0.44 && coherent.field === 'last_price_dollars', 'a coherent last price is preferred over the midpoint');

  // threshold: exactly $0.10 must alert; $0.09 must not
  const up = detectSwing({ ticker: 'T', topic: 'crypto', title: 'x', price: 0.44, baseline: 0.34, nowSeconds: 1000 });
  ok(up && Math.abs(up.delta - 0.10) < 1e-9 && up.direction === 'up', 'a +$0.10 move alerts (boundary is inclusive)');
  const down = detectSwing({ ticker: 'T', topic: 'crypto', title: 'x', price: 0.30, baseline: 0.40, nowSeconds: 1000 });
  ok(down && down.direction === 'down' && Math.abs(down.delta + 0.10) < 1e-9, 'a -$0.10 move alerts');
  ok(detectSwing({ ticker: 'T', topic: 'crypto', title: 'x', price: 0.43, baseline: 0.34, nowSeconds: 1000 }) === null, 'a $0.09 move does not alert');
  ok(detectSwing({ ticker: 'T', topic: 'crypto', title: 'x', price: 0.44, baseline: null, nowSeconds: 1000 }) === null, 'no baseline -> no alert (never guessed)');

  // floating point: 0.34 -> 0.44 is exact 0.10 in dollars but not in binary floats
  ok(detectSwing({ ticker: 'T', topic: 'gas', title: 'x', price: 0.44, baseline: 0.34, nowSeconds: 1 }) !== null, 'float rounding does not drop a boundary alert');

  // model
  const strong = modelScore({ from: 0.20, delta: 0.12, direction: 'up', to: 0.32, bid: 0.31, ask: 0.33, volume24h: 5000, sampleAgeSeconds: 0 });
  ok(strong.score !== null && strong.highROI === true, 'a large move on a liquid, tight market scores as high-ROI');
  const weak = modelScore({ from: 0.90, delta: 0.10, bid: 0.01, ask: 0.99, volume24h: 5, sampleAgeSeconds: 0 });
  ok(weak.score !== null && weak.highROI === false, 'a small-headroom move on an illiquid, wide market does not');
  ok(modelScore({ from: null, delta: 0.1 }).score === null, 'no baseline -> no score');

  /* FOLLOW-THROUGH GATE (added 2026-11-21 after the high-ROI pane was measured to be topped by
   * unfillable swings). Each case below is a row shape that actually appeared in the published
   * feed, with the book fields copied from the official API response for that market. */
  const phantomUp = modelScore({            // feed: KXBTCY-27JAN0100-B97500 "@...B97500@1795282837"
    from: 0.01, delta: 0.96, direction: 'up', to: 0.97,
    bid: 0.00, ask: 0.01, volume24h: 69487.15, sampleAgeSeconds: 0,
  });
  ok(phantomUp.tradeable === false, 'a $0.01 -> $0.97 print with a $0.01 ask is marked NOT tradeable');
  ok(phantomUp.highROI === false, 'the phantom $0.96 "up" swing can never reach the high-ROI pane (score ' + phantomUp.score + ')');
  ok(phantomUp.score <= 0.3, 'an untradeable row is capped at 0.30, not merely docked');
  ok(phantomUp.reasons.some((r) => /NOT tradeable/.test(r)), 'the reason is stated in plain words on the row');

  const phantomDown = modelScore({          // feed: KXPRESNOMD-28-AKLO "@...AKLO@1795190944"
    from: 0.803, delta: -0.80, direction: 'down', to: 0.003,
    bid: 0.00, ask: 0.803, volume24h: 62382.75, sampleAgeSeconds: 0,
  });
  ok(phantomDown.tradeable === false, 'a $0.803 -> $0.003 print with no YES bid is marked NOT tradeable');
  ok(phantomDown.highROI === false, 'the phantom $0.80 "down" swing can never reach the high-ROI pane');

  const oneSided = modelScore({ from: 0.50, delta: 0.12, direction: 'up', to: 0.62, bid: 0, ask: 0.62, volume24h: 5000, sampleAgeSeconds: 0 });
  ok(oneSided.reasons.some((r) => /one-sided/.test(r)), 'a zero YES bid is called out as a one-sided book, not scored as a tight spread');

  const unknownQuote = modelScore({ from: 0.30, delta: 0.12, direction: 'up', to: 0.42, bid: null, ask: null, volume24h: 5000, sampleAgeSeconds: 0 });
  ok(unknownQuote.tradeable === null, 'a missing quote is reported as UNVERIFIED, never as untradeable');
  ok(unknownQuote.highROI === false, 'an unverified quote cannot earn the high-ROI label either');

  const tradableMove = modelScore({ from: 0.44, delta: 0.11, direction: 'up', to: 0.55, bid: 0.54, ask: 0.55, volume24h: 5000, sampleAgeSeconds: 0 });
  ok(tradableMove.tradeable === true && tradableMove.highROI === true, 'a real, tight, liquid move still scores high (score ' + tradableMove.score + ')');
  ok(modelScore({ from: 0.44, delta: 0.11, direction: 'up', to: 0.55, bid: 0.20, ask: 0.80, volume24h: 5000, sampleAgeSeconds: 0 }).tradeable === false,
    'a 60-cent-wide book does not corroborate an 11-cent move');

  // applySample end-to-end on a synthetic cycle
  const st = structuredClone(EMPTY_STATE);
  const mk = (ticker, price, vol) => ({
    raw: {
      ticker, event_ticker: 'E', title: ticker, status: 'active', result: '',
      last_price_dollars: price.toFixed(4), yes_bid_dollars: (price - 0.01).toFixed(4),
      yes_ask_dollars: (price + 0.01).toFixed(4), yes_bid_size_fp: '100.00', yes_ask_size_fp: '100.00',
      volume_fp: String(vol), volume_24h_fp: String(vol), open_interest_fp: '50.00', close_time: '2026-12-01T00:00:00Z',
      rules_primary: 'rule', settlement_ts: null,
    },
    topic: 'crypto', series_ticker: 'SER', series: { contract_terms_url: 'https://example.invalid/c.pdf', settlement_sources: [] },
    source_url: BASE + '/markets?series_ticker=SER&status=open',
  });
  const s1 = applySample(st, { nowSeconds: 1000, markets: [mk('T1', 0.30, 1000)] });
  ok(s1.alerts.length === 0, 'first sample of a market never alerts (no baseline)');
  const s2 = applySample(s1, { nowSeconds: 2000, markets: [mk('T1', 0.30, 1000)] });
  ok(s2.alerts.length === 0, 'an unchanged price never alerts');
  const s3 = applySample(s2, { nowSeconds: 3000, markets: [mk('T1', 0.41, 1000)] });
  ok(s3.alerts.length === 1 && s3.alerts[0].direction === 'up' && Math.abs(s3.alerts[0].delta - 0.11) < 1e-9, 'a +$0.11 sample creates one alert');
  ok(s3.alerts[0].source_url.startsWith(BASE), 'every alert carries its API source_url');
  ok(s3.alerts[0].model && typeof s3.alerts[0].model.score === 'number', 'every alert carries a model score');
  const s4 = applySample(s3, { nowSeconds: 3300, markets: [mk('T1', 0.41, 1000)] });
  ok(s4.alerts.length === 1, 'no duplicate alert when the price is unchanged after an alert');
  const s5 = applySample(s4, { nowSeconds: 12000, markets: [mk('T1', 0.41, 1000)] });
  ok(s5.alerts.length === 1, 'cooldown expiry alone does not re-alert without another move');

  // sizes are carried onto an alert (they were silently dropped before 2026-11-21)
  const withSize = s3.alerts[0] || {};
  ok(withSize.yes_bid_size_fp === '100.00' && withSize.yes_ask_size_fp === '100.00',
    'a swing keeps the contract counts behind each quote (got ' + withSize.yes_bid_size_fp + '/' + withSize.yes_ask_size_fp + ')');

  /* A retained row scored by the OLD model must be re-scored on the next run. This is the defect
   * that failed CI run 44947818572: persisted rows kept a stale highROI label, so the strict
   * validator refused to publish the whole fresh sample. */
  const staleState = structuredClone(s3);
  staleState.alerts[0].model = { score: 0.79, highROI: true, reasons: ['v1: one-sided book scored as tight'] };
  /* The persisted book is the shape that actually failed CI: the stored row says the swing landed
   * at $0.41 while its own quote is a $0.00 bid / $0.01 ask. */
  staleState.alerts[0].yes_bid_dollars = '0.0000';
  staleState.alerts[0].yes_ask_dollars = '0.0100';
  const rescored = applySample(staleState, { nowSeconds: 3100, markets: [mk('T1', 0.41, 1000)] });
  ok(rescored.alerts[0].model.highROI === false, 'a retained row labelled highROI by the old model is corrected on the next run');
  ok(rescored.alerts[0].model.tradeable === false, 'the corrected row is marked not tradeable');
  ok(rescored.alerts[0].model.score <= 0.3, 'the corrected row is capped, got ' + rescored.alerts[0].model.score);
  ok(rescored.alerts[0].model.original_score === 0.79 && rescored.alerts[0].model.original_highROI === true,
    'the old verdict is preserved for audit, not overwritten');

  /* ...and a re-score must not discard the published AGE PENALTY (F-75). The model halves a score
   * when the quote being scored was more than an hour old; re-scoring with a fresh-sample
   * assumption doubled six published rows (0.277 -> 0.554) although their quote was unchanged. */
  const penal = modelScore({ from: 0.80, delta: 0.10, direction: 'down', to: 0.70, bid: 0.69, ask: 0.71, volume24h: 500, sampleAgeSeconds: 7200 });
  const freshSame = modelScore({ from: 0.80, delta: 0.10, direction: 'down', to: 0.70, bid: 0.69, ask: 0.71, volume24h: 500, sampleAgeSeconds: 0 });
  ok(penal.age_penalised === true && freshSame.age_penalised === false,
    'modelScore reports whether the 1h age penalty was applied');
  ok(Math.abs(penal.score - freshSame.score / 2) <= 1e-4,
    `the 1h age penalty halves the score (${freshSame.score} -> ${penal.score})`);
  const legacyPenal = [{ id: 'trade:P@1', ticker: 'P-1', ts: '2026-11-21T12:00:00Z', direction: 'down', from: 0.80, to: 0.70, delta: -0.10,
    yes_bid_dollars: '0.6900', yes_ask_dollars: '0.7100', volume_24h_fp: '500.00',
    model: { score: penal.score, highROI: penal.highROI, reasons: ['v1 incl. 1h penalty'] } }];
  ok(rescoreAlerts(legacyPenal) === 0 && legacyPenal[0].model.score === penal.score,
    `a legacy row published with the 1h penalty keeps its score through a re-score (got ${legacyPenal[0].model.score})`);
  ok(legacyPenal[0].model.age_penalised === true, 'the reconstructed penalty is recorded on the row');
  /* The shape actually observed on `main` after the buggy pass: the current score is the doubled
   * one and the published (halved) verdict survives in original_score. It must be restored. */
  const doubled = [{ ...structuredClone(legacyPenal[0]), model: {
    score: freshSame.score, highROI: freshSame.highROI, tradeable: true,
    original_score: penal.score, original_highROI: penal.highROI, reasons: ['doubled by the fresh-sample re-score'],
  } }];
  ok(rescoreAlerts(doubled) === 1 && doubled[0].model.score === penal.score,
    `a row already doubled must be restored to its published penalised score (got ${doubled[0].model.score}, want ${penal.score})`);
  ok(rescored.alerts[0].to === s3.alerts[0].to && rescored.alerts[0].ts === s3.alerts[0].ts && rescored.alerts[0].from === s3.alerts[0].from,
    're-scoring never changes a price, an arrow or a timestamp');
  /* The provenance list is derived from the rows, so a rebuild cannot silently drop it (F-79). */
  ok((rescored.meta.legacy_unfillable_high_roi || []).some((x) => x.id === rescored.alerts[0].id),
    'a row re-scored out of high-ROI is listed in meta.legacy_unfillable_high_roi automatically');

  // resolutions
  const s6 = applySample(s5, {
    nowSeconds: 13000, markets: [],
    resolutions: [{ ticker: 'T1', result: 'yes', settlement_ts: '2026-11-20T00:00:00Z', settlement_value_dollars: '1.0000' }],
  });
  ok(s6.resolutions.length === 1 && s6.resolutions[0].result === 'yes', 'a resolution is recorded with its yes/no result');
  const s7 = applySample(s6, { nowSeconds: 14000, markets: [], resolutions: [{ ticker: 'T1', result: 'yes' }, { ticker: 'BAD', result: '' }] });
  ok(s7.resolutions.length === 1, 'resolutions de-duplicate and never store an empty result');

  // resolution tracking survives the market cap (F-66).
  // A market that produced an alert is small next to hundreds of bigger rows; before the fix the
  // 300-row cap evicted it and its later yes/no result was discarded as "untracked".
  const baseline = applySample(structuredClone(EMPTY_STATE), { nowSeconds: 19900, markets: [mk('SMALL', 0.30, 1)], runId: 'cap0' });
  const many = [mk('SMALL', 0.45, 1)];
  for (let i = 0; i < 400; i += 1) many.push(mk('BIG' + i, 0.50, 1000000));
  const cappedAlerted = applySample(baseline, { nowSeconds: 20000, markets: many, runId: 'cap1' });
  ok(cappedAlerted.alerts.some((a) => a.ticker === 'SMALL'), 'the followed market alerts inside the crowded sample');
  ok(Object.keys(cappedAlerted.markets).length <= 301, `the 300-row market cap still bounds the map (${Object.keys(cappedAlerted.markets).length})`);
  const cappedResolved = applySample(cappedAlerted, {
    nowSeconds: 20200, markets: [],
    resolutions: [{ ticker: 'SMALL', result: 'no', status: 'finalized', settlement_ts: '2026-11-21T07:00:00Z' }], runId: 'cap2',
  });
  ok(cappedResolved.resolutions.length === 1 && cappedResolved.resolutions[0].result === 'no',
    'a resolution is kept for a tracked market that no longer fits the market map');
  ok(cappedResolved.markets.SMALL && cappedResolved.markets.SMALL.result === 'no',
    'the resolved row itself keeps the exchange result for the market page');
  ok(cappedResolved.settled_markets && cappedResolved.settled_markets.SMALL === 'crypto',
    'the ticker stays remembered as tracked after eviction');
  const never = applySample(cappedResolved, {
    nowSeconds: 20300, markets: [],
    resolutions: [{ ticker: 'NEVER-SEEN', result: 'yes', status: 'finalized', settlement_ts: '2026-11-21T07:00:00Z' }], runId: 'cap3',
  });
  ok(never.resolutions.length === 1 && never.run.untracked_settled_seen >= 1,
    'a settled market this engine never followed stays a count, not a row');

  // collectResolutions: paging + pending-only + newest-close first (F-66)
  const fakeClient = (pages) => {
    const calls = [];
    return {
      base: 'https://example.invalid/trade-api/v2',
      calls,
      async getJson(path) {
        calls.push(path);
        const series = (path.match(/series_ticker=([^&]+)/) || [])[1];
        const cursor = (path.match(/cursor=([^&]+)/) || [])[1] || '';
        const page = cursor === 'p2' ? 1 : 0;
        const p = pages[series];
        if (!p) return { cursor: '', markets: [] };
        return { cursor: page === 0 && p.length > 1 ? 'p2' : '', markets: p[page] || [] };
      },
    };
  };
  const cState = {
    markets: {
      // closed an hour ago -> should be looked at first
      LATE: { ticker: 'LATE', series_ticker: 'S_LATE', topic: 'crypto', close_time: '2026-11-21T06:00:00Z', status: 'active' },
      // still open, and settled results exist for it only on page 2
      OPEN2: { ticker: 'OPEN2', series_ticker: 'S_OPEN', topic: 'gas', close_time: '2027-01-01T00:00:00Z', status: 'active' },
      DONE: { ticker: 'DONE', series_ticker: 'S_DONE', topic: 'golf', close_time: '2026-11-01T00:00:00Z', status: 'active' },
    },
    resolutions: [{ ticker: 'DONE', result: 'yes' }],
    alerts: [],
    meta: { generated_at: '2026-11-21T07:00:00Z' },
  };
  const cClient = fakeClient({
    S_LATE: [
      [{ ticker: 'OTHER', result: 'yes' }],
      [{ ticker: 'LATE', result: 'yes', status: 'finalized', settlement_ts: '2026-11-21T07:00:00Z', settlement_value_dollars: '1.0000' }],
    ],
    S_OPEN: [[{ ticker: 'OTHER2', result: 'no' }], [{ ticker: 'OPEN2', result: 'no', status: 'finalized', settlement_ts: '2026-11-21T07:00:00Z' }]],
  });
  const found = await collectResolutions(cClient, cState, { maxSeries: 12, maxPages: 5, nowSeconds: Date.parse('2026-11-21T07:10:00Z') / 1000 });
  ok(found.length === 2 && found.some((r) => r.ticker === 'LATE') && found.some((r) => r.ticker === 'OPEN2'),
    `settled results are found past page 1 and only for pending tickers (got ${found.map((r) => r.ticker).join(',') || 'none'})`);
  ok(cClient.calls.every((p) => !p.includes('S_DONE')), 'a series whose tracked markets all resolved is no longer polled');
  ok(cClient.calls[0].includes('S_LATE'), 'the series with the most recent close_time is polled first');
  ok(cClient.calls.every((p) => p.includes('limit=1000')), 'the settled page is requested at the documented 1000-row maximum');
  ok(cClient.calls.every((p) => p.includes('min_settled_ts=')), 'settled lookups sort by settlement time via min_settled_ts (S4)');
  const sinceState = { ...cState, meta: { generated_at: '2026-11-21T07:00:00Z' } };
  const sinceClient = fakeClient({ S_LATE: [[]] });
  await collectResolutions(sinceClient, sinceState, { maxSeries: 12, maxPages: 1, nowSeconds: Date.parse('2026-11-21T07:10:00Z') / 1000 });
  const m = sinceClient.calls[0].match(/min_settled_ts=(\d+)/);
  ok(m && Number(m[1]) === Date.parse('2026-11-21T07:00:00Z') / 1000 - SETTLE_OVERLAP_SECONDS,
    `the settled window starts one overlap before the previous sample (got ${m && m[1]})`);

  // ladder
  const ladder = buildLadder({ orderbook_fp: { yes_dollars: [['0.0100', '200.00'], ['0.4200', '13.00']], no_dollars: [['0.5600', '17.00']] } });
  ok(ladder.best_yes_bid === 0.42, 'best yes bid is the LAST element (documented ascending order)');
  ok(ladder.implied_yes_ask === 0.44, 'implied yes ask is 1 - best no bid');
  ok(ladder.cumulative_contracts.yes === 213, 'cumulative depth sums the levels');

  // candle swings
  const candles = [
    { end_period_ts: 100, price: { high_dollars: '0.3000', low_dollars: '0.2800', close_dollars: '0.3000' }, volume_fp: '5.00' },
    { end_period_ts: 160, price: { high_dollars: '0.4200', low_dollars: '0.3000', close_dollars: '0.4100' }, volume_fp: '9.00' },
    { end_period_ts: 220, price: { high_dollars: '0.4300', low_dollars: '0.4000', close_dollars: '0.4100' }, volume_fp: '1.00' },
    { end_period_ts: 280, price: { open_dollars: null, high_dollars: null, low_dollars: null, close_dollars: null }, volume_fp: '0.00' },
  ];
  const cs = candleSwings({ ticker: 'C1', topic: 'gas', title: 'c', candlesticks: candles, sourceUrl: 'https://example.invalid/c' });
  ok(cs.length === 1, 'a single candle range produces exactly one swing (no repeat across candles)');
  ok(cs[0].direction === 'up' && Math.abs(cs[0].abs_delta - 0.11) < 1e-9, 'candle low -> close of $0.11 is an up swing');
  ok(candleSwings({ ticker: 'C2', topic: 'gas', title: 'c', candlesticks: [candles[0], candles[3]] }).length === 0, 'candles with null OHLC (no trades) never alert');
  ok(candleSwings({ ticker: 'C3', topic: 'gas', title: 'c', candlesticks: [{ end_period_ts: 1, price: { high_dollars: '0.5000', low_dollars: '0.2000', close_dollars: '0.3800' } }] }).length === 1, 'a candle that spans the threshold both ways yields one (larger) move');

  const withCandles = mergeCandleAlerts(s5, cs);
  ok(withCandles.alerts.length === 2, 'candle alert merges alongside a sample alert');
  ok(withCandles.alerts.every((a) => a.model && typeof a.model.score === 'number'), 'merged candle alerts also carry a model score');
  ok(mergeCandleAlerts(withCandles, cs).alerts.length === 2, 'candle alerts are de-duplicated by id');

  // corroboration: the measured fake crash must be rejected, a genuine move kept
  const fakeMove = corroborate({ to: 0.803, m: { yes_bid_dollars: '0.0020', yes_ask_dollars: '0.0030', no_bid_dollars: '0.9970', no_ask_dollars: '0.9980', previous_price_dollars: '0.8030' } });
  ok(fakeMove.ok === false, 'a price contradicted by the book is not corroborated even when the day-old previous price agrees with it (F-86)');
  const realMove = corroborate({ to: 0.943, m: { yes_bid_dollars: '0.9350', yes_ask_dollars: '0.9430', no_bid_dollars: '0.0570', no_ask_dollars: '0.0650' } });
  ok(realMove.ok === true, 'a real move is corroborated by its book');
  const dayOldTrap = corroborate({ to: 0.97, m: { yes_bid_dollars: '0.0100', yes_ask_dollars: '0.0200', no_bid_dollars: '0.9800', no_ask_dollars: '0.9900', previous_price_dollars: '0.9700' } });
  ok(dayOldTrap.ok === false, 'previous_price_dollars (a day ago) can never corroborate a print the book contradicts (F-86)');
  ok(dayOldTrap.how !== 'previous_price_dollars', 'the corroboration reason never names the day-old field (F-86)');
  ok(corroborate({ to: 0.5, m: {} }).ok === false, 'no second field -> no corroboration -> not published');
  ok(/day-old/.test(corroborate({ to: 0.5, m: { previous_price_dollars: '0.5000' } }).how), 'a row that only returns the day-old price reports why it cannot be used (F-86)');
  // and end to end: a fake sample swing never reaches the feed
  const stFake = applySample(structuredClone(EMPTY_STATE), { nowSeconds: 5000, markets: [mk('F1', 0.003, 100)], runId: 'r1' });
  const stFake2 = applySample(stFake, { nowSeconds: 5100, markets: [{ raw: { ...mk('F1', 0.003, 100).raw, last_price_dollars: '0.8030', previous_price_dollars: '0.0030' }, topic: 'crypto', series_ticker: 'SER', series: {}, source_url: BASE + '/x' }], runId: 'r1' });
  ok(stFake2.alerts.length === 0, 'the fake 0.803 sample swing is suppressed end to end');
  ok((stFake2.run.uncorroborated_suppressed || 0) >= 1, 'the suppression is counted, not silent');

  // trade swings
  const nowT = 1_760_000_000;
  const tr = (sec, price, id) => ({ trade_id: id, created_time: new Date((nowT + sec) * 1000).toISOString(), yes_price_dollars: price.toFixed(4), count_fp: '10.00' });
  const tradeRows = [tr(-600, 0.30, 'a'), tr(-300, 0.32, 'b'), tr(-120, 0.45, 'c'), tr(-60, 0.45, 'd')];
  const ts1 = tradeSwings({ ticker: 'T', topic: 'crypto', title: 'x', trades: tradeRows, sourceUrl: 'https://example.invalid/t' });
  ok(ts1.length === 1, 'trade walk finds exactly one >= $0.10 jump');
  ok(ts1[0].direction === 'up' && Math.abs(ts1[0].abs_delta - 0.13) < 1e-9, 'trade swing measures the real jump ($0.32 -> $0.45)');
  ok(ts1[0].detection === 'trade' && ts1[0].trade && ts1[0].trade.trade_id === 'c', 'trade swing names the trade that caused it');
  ok(tradeSwings({ ticker: 'T', topic: 'crypto', title: 'x', trades: [tr(-600, 0.30, 'a'), tr(-540, 0.35, 'b')] }).length === 0, 'a $0.05 trade move does not alert');
  ok(tradeSwings({ ticker: 'T', topic: 'crypto', title: 'x', trades: [tr(-99999, 0.10, 'a'), tr(-10, 0.95, 'b')] }).length === 0, 'a jump across a gap wider than the window is not reported as one swing');
  ok(tradeSwings({ ticker: 'T', topic: 'crypto', title: 'x', trades: [] }).length === 0, 'no trades -> no alerts');

  // duplicate collapsing keeps the most precise detector
  const collapsed = collapseDuplicates([
    { id: 's', ticker: 'T', direction: 'up', ts: new Date(nowT * 1000).toISOString(), detection: 'sample' },
    { id: 'c', ticker: 'T', direction: 'up', ts: new Date((nowT + 60) * 1000).toISOString(), detection: 'candle' },
    { id: 't', ticker: 'T', direction: 'up', ts: new Date((nowT + 30) * 1000).toISOString(), detection: 'trade' },
    { id: 'o', ticker: 'U', direction: 'up', ts: new Date(nowT * 1000).toISOString(), detection: 'sample' }
  ]);
  ok(collapsed.length === 2, 'the same swing from three detectors becomes one row (plus the other ticker)');
  ok(collapsed.some((a) => a.id === 't') && !collapsed.some((a) => a.id === 's'), 'the trade-level row is the one kept');

  // regression: a market flapping $0.80 <-> $0.00 every pulse must not flood the chat.
  const flapStart = nowT * 1000;
  const flapped = collapseDuplicates([
    { id: 'f1', ticker: 'V', direction: 'down', ts: new Date(flapStart).toISOString(), detection: 'trade' },
    { id: 'f2', ticker: 'V', direction: 'up', ts: new Date(flapStart + 120000).toISOString(), detection: 'trade' },
    { id: 'f3', ticker: 'V', direction: 'down', ts: new Date(flapStart + 240000).toISOString(), detection: 'trade' },
    { id: 'f4', ticker: 'V', direction: 'up', ts: new Date(flapStart + 360000).toISOString(), detection: 'trade' }
  ]);
  ok(flapped.length === 1, `a flapping market collapses to one row, got ${flapped.length}`);
  // a genuine second swing after the 15-min window is kept
  const later = collapseDuplicates([
    { id: 'g1', ticker: 'W', direction: 'up', ts: new Date(flapStart).toISOString(), detection: 'trade' },
    { id: 'g2', ticker: 'W', direction: 'down', ts: new Date(flapStart + 20 * 60000).toISOString(), detection: 'trade' }
  ]);
  ok(later.length === 2, 'two swings more than the 15-min window apart are both kept');
  // different tickers are never collapsed together
  const twoTickers = collapseDuplicates([
    { id: 'h1', ticker: 'X', direction: 'up', ts: new Date(flapStart).toISOString(), detection: 'trade' },
    { id: 'h2', ticker: 'Y', direction: 'down', ts: new Date(flapStart + 60000).toISOString(), detection: 'trade' }
  ]);
  ok(twoTickers.length === 2, 'different tickers never collapse into each other');

  // taxonomy guard: an unkeyed category is a note (the live taxonomy is incomplete), but a
  // contradiction inside a keyed category is a hard failure.
  const taxEmpty = checkTaxonomy({ tags_by_categories: {} });
  ok(taxEmpty.problems.length === 0 && taxEmpty.notes.length > 0, 'categories missing from the taxonomy become notes, not silent passes');
  const taxBadTag = checkTaxonomy({ tags_by_categories: { Sports: ['Soccer'], Elections: ['US Elections'], Crypto: ['BTC'] } });
  ok(taxBadTag.problems.some((p) => p.includes('Golf')), 'a tag that is not listed under a keyed category is a hard failure');
  const taxNullTags = checkTaxonomy({ tags_by_categories: { Sports: null } });
  ok(taxNullTags.problems.some((p) => p.includes('advertises no tags')), 'a keyed category with null tags is a hard failure for a tag filter');

  if (fails.length) {
    console.error('\nSELFTEST FAILED:');
    for (const f of fails) console.error('  ✗ ' + f);
    return 1;
  }
  console.log('selftest: all assertions passed');
  return 0;
}

/* ------------------------------------------------------------------ cli */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    // selftest is async only because it awaits collectResolutions with an in-memory client.
    process.exit(await selftest());
  }
  const maxSeriesArg = args.indexOf('--max-series');
  const maxSeries = maxSeriesArg >= 0 ? parseInt(args[maxSeriesArg + 1], 10) : 12;
  const dirArg = args.indexOf('--dir');
  const dir = dirArg >= 0 ? args[dirArg + 1] : 'data/live';
  const candleArg = args.indexOf('--candle-markets');
  const candleMarkets = candleArg >= 0 ? parseInt(args[candleArg + 1], 10) : 6;
  const tradeArg = args.indexOf('--trade-markets');
  const tradeMarkets = tradeArg >= 0 ? parseInt(args[tradeArg + 1], 10) : 10;
  runOnce({ dir, maxSeries, candleMarkets, tradeMarkets, dryRun: args.includes('--dry-run') })
    .then((st) => {
      // Exit code 0 even with zero alerts: "no swings right now" is a valid, healthy state.
      console.log('done. alerts in state:', st.alerts.length);
    })
    .catch((e) => {
      console.error('ENGINE FAILED:', e && e.message ? e.message : e);
      process.exitCode = 1;
    });
}
