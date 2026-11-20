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
 * A binary book gives two independent ways to read the same quotes (S6, documented):
 *
 *   direct  : yes bid = yes_bid_dollars,  yes ask = yes_ask_dollars
 *   implied : yes bid = 1 − no_ask_dollars, yes ask = 1 − no_bid_dollars
 *
 * On a healthy market both describe the same book. The live demo does not always do that
 * (measured 2026-11-20, KXPRESPERSON-28-GABB): one read returned
 * last_price_dollars 0.8030 with yes 0.0020 / yes_ask 0.8030, while no_bid 0.9970 /
 * no_ask 0.9980 imply a yes book of 0.002 / 0.003 and previous_price_dollars was 0.0030.
 * Taking any of those numbers at face value produced fake "$0.80" alerts.
 *
 * So the rule is:
 *   1. build both readings; a reading is usable only if 0 < bid <= ask < 1;
 *   2. if both are usable and agree within MAX_BOOK_DISAGREEMENT, the book is healthy:
 *      use last_price_dollars when it sits within MAX_LAST_PRICE_BOOK_GAP of the midpoint,
 *      otherwise the midpoint (the last trade may be stale);
 *   3. if they disagree, the read is internally contradictory. Use the reading that agrees
 *      with previous_price_dollars; if that cannot decide it, use the implied (NO-side)
 *      reading. Either way the row records which reading was used and why;
 *   4. if neither reading is usable, return null: the market is skipped and counted.
 *
 * Nothing is manufactured: every branch returns a published quote, a published previous
 * price, or null.
 */
export const MAX_LAST_PRICE_BOOK_GAP = 0.25;
export const MAX_BOOK_DISAGREEMENT = 0.05;

function usablePair(bid, ask) {
  return bid !== null && ask !== null && bid > 0 && ask > 0 && bid < 1 && ask < 1 && ask >= bid;
}

export function trackedPrice(m) {
  const last = num(m.last_price_dollars);
  const prev = num(m.previous_price_dollars);
  const yb = num(m.yes_bid_dollars);
  const ya = num(m.yes_ask_dollars);
  const nb = num(m.no_bid_dollars);
  const na = num(m.no_ask_dollars);
  const settled = !!(m.result && m.result !== '');

  const directOk = usablePair(yb, ya);
  const impliedOk = usablePair(na === null ? null : round(1 - na, 4), nb === null ? null : round(1 - nb, 4));

  const direct = directOk ? { mid: round((yb + ya) / 2), how: 'yes quotes' } : null;
  const implied = impliedOk
    ? { mid: round(((1 - na) + (1 - nb)) / 2), how: 'no quotes (1 − no price)' }
    : null;

  let book = null;
  if (direct && implied) {
    if (Math.abs(direct.mid - implied.mid) <= MAX_BOOK_DISAGREEMENT) {
      book = { mid: round((direct.mid + implied.mid) / 2), how: 'yes and no quotes agree', healthy: true };
    } else {
      // Contradictory read: prefer whichever reading agrees with the published previous price.
      if (prev !== null && Math.abs(direct.mid - prev) < Math.abs(implied.mid - prev)) {
        book = { mid: direct.mid, how: `yes quotes (no quotes disagreed by $${Math.abs(direct.mid - implied.mid).toFixed(2)}; chose the reading matching previous_price_dollars)`, healthy: false };
      } else {
        book = { mid: implied.mid, how: `no quotes (yes quotes disagreed by $${Math.abs(direct.mid - implied.mid).toFixed(2)}; chose the reading matching previous_price_dollars or the NO side)`, healthy: false };
      }
    }
  } else if (direct) {
    book = { mid: direct.mid, how: direct.how, healthy: null };
  } else if (implied) {
    book = { mid: implied.mid, how: implied.how, healthy: null };
  }

  if (book && last !== null && last > 0 && last < 1) {
    if (settled || Math.abs(last - book.mid) <= MAX_LAST_PRICE_BOOK_GAP) {
      return { price: last, field: 'last_price_dollars' };
    }
    return {
      price: book.mid,
      field: `book midpoint from ${book.how} — last_price_dollars ${last} rejected as incoherent`,
      book_inconsistent: book.healthy === false,
    };
  }
  if (book) {
    return { price: book.mid, field: `book midpoint from ${book.how}`, book_inconsistent: book.healthy === false };
  }
  // No usable book at all: the last traded price is still published information about this
  // contract, so it is used (labelled), rather than dropping a market that has traded.
  if (last !== null && last > 0 && last < 1) {
    return { price: last, field: 'last_price_dollars (no usable book to cross-check against)' };
  }
  return { price: null, field: null };
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
export const MODEL_VERSION = 'heuristic-v1';

export function modelScore({ from, delta, bid, ask, volume24h, sampleAgeSeconds = 0 }) {
  const reasons = [];
  if (from === null || from === undefined) return { score: null, highROI: false, reasons: ['no baseline price — unverified'] };

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

  // 4. spread
  let spreadScore = 0;
  if (bid !== null && ask !== null && bid !== undefined && ask !== undefined && ask >= bid && ask > 0) {
    const spread = round(ask - bid, 4);
    spreadScore = round(Math.max(0, 1 - spread * 10), 4); // $0.00 -> 1, $0.10 -> 0
    reasons.push(`spread $${spread.toFixed(2)} -> ${spreadScore.toFixed(2)}`);
  } else {
    reasons.push('spread unknown (bid/ask not both returned) -> 0.00');
  }

  let score = 0.20 * headroom + 0.20 * size + 0.35 * liq + 0.25 * spreadScore;

  if (sampleAgeSeconds > 3600) {
    score *= 0.5;
    reasons.push('sample older than 1h -> score halved (REST reads lag, S10)');
  }
  score = round(Math.max(0, Math.min(1, score)), 4);
  return { score, highROI: score >= HIGH_ROI_THRESHOLD, reasons };
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

    const { price, field } = trackedPrice(m);
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
      const model = modelScore({
        from: swing.from,
        delta: swing.delta,
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
    if (!tracked.has(r.ticker)) { untracked += 1; continue; }
    if (next.resolutions.some((x) => x.ticker === r.ticker)) continue;
    next.resolutions.push(r);
  }
  next.run.untracked_settled_seen = (next.run.untracked_settled_seen || 0) + untracked;
  next.resolutions.sort((a, b) => String(b.settlement_ts || '').localeCompare(String(a.settlement_ts || '')));
  next.resolutions = next.resolutions.slice(0, MAX_RESOLUTIONS);

  // ---- merge alerts: newest first, de-duplicated by id
  const known = new Set(next.alerts.map((a) => a.id));
  for (const a of newAlerts) if (!known.has(a.id)) next.alerts.push(a);
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

  const marketTickers = Object.keys(next.markets);
  if (marketTickers.length > 300) {
    const ordered = topMarkets(next, 300).map((m) => m.ticker);
    const keepMarkets = new Set(ordered);
    for (const ticker of marketTickers) if (!keepMarkets.has(ticker)) delete next.markets[ticker];
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
 */
export async function collectResolutions(client, state, { maxSeries = 12, log = () => {} } = {}) {
  const trackedSeries = new Set();
  for (const m of Object.values(state.markets || {})) {
    if (m && m.series_ticker) trackedSeries.add(m.series_ticker);
  }
  const out = [];
  const list = [...trackedSeries].slice(0, maxSeries);
  for (const st of list) {
    const path = marketsQueryUrl(st, { status: 'settled', limit: 100 });
    let data;
    try {
      data = await client.getJson(path);
    } catch (e) {
      log(`  settled lookup failed for ${st}: ${e.message}`);
      continue;
    }
    for (const m of data.markets || []) {
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
 * Collapse alerts that describe the same swing from different detectors, keeping the most
 * precise one (trade > candle > sample). Without this, one $0.10 move could appear three
 * times in the feed and look like three separate events.
 */
export function collapseDuplicates(alerts) {
  const precision = { trade: 3, candle: 2, sample: 1 };
  const rank = (a) => precision[a.detection || 'sample'] || 1;
  const kept = [];
  for (const a of [...alerts].sort((x, y) => rank(y) - rank(x))) {
    const dup = kept.find((k) =>
      k.ticker === a.ticker &&
      k.direction === a.direction &&
      Math.abs((Date.parse(k.ts) || 0) - (Date.parse(a.ts) || 0)) <= 180000);
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

  // One swing can be seen by three detectors; keep only the most precise row.
  const beforeDedupe = next.alerts.length;
  next.alerts = collapseDuplicates(next.alerts);
  next.meta.duplicates_collapsed = beforeDedupe - next.alerts.length;

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
export function selftest() {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  // num / trackedPrice
  ok(num('0.4200') === 0.42, 'num parses fixed-point string');
  ok(num('') === null && num(null) === null && num('abc') === null, 'num never coerces garbage to 0');
  ok(trackedPrice({ last_price_dollars: '0.3400' }).price === 0.34, 'trackedPrice prefers last traded price');
  ok(trackedPrice({ last_price_dollars: '0.0000', yes_bid_dollars: '0.2000', yes_ask_dollars: '0.3000' }).price === 0.25, 'trackedPrice falls back to bid/ask mid when last price is 0');
  ok(trackedPrice({ last_price_dollars: '0.0000', yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000' }).price === null, 'trackedPrice returns null rather than inventing a price');
  // The measured demo defect: yes_ask was corrupted to 0.8030, contradicting no_bid 0.9970.
  const inconsistent = trackedPrice({
    last_price_dollars: '0.8030', previous_price_dollars: '0.0030',
    yes_bid_dollars: '0.0020', yes_ask_dollars: '0.8030',
    no_bid_dollars: '0.9970', no_ask_dollars: '0.9980', result: '',
  });
  ok(inconsistent.price === 0.0025, 'a contradictory book resolves to the NO-side reading, not to the corrupt ask (got ' + inconsistent.price + ')');
  ok(inconsistent.book_inconsistent === true, 'the row is marked as coming from a contradictory book');
  // and with the real single-market read, where yes_ask is sane but last_price is stale
  const staleLast = trackedPrice({
    last_price_dollars: '0.8030', previous_price_dollars: '0.0030',
    yes_bid_dollars: '0.0020', yes_ask_dollars: '0.0030',
    no_bid_dollars: '0.9970', no_ask_dollars: '0.9980', result: '',
  });
  ok(staleLast.price === 0.0025, 'a stale last price on a healthy book is replaced by the midpoint');
  ok(/rejected/.test(staleLast.field), 'the row records why the last price was not used');
  const settledFar = trackedPrice({ last_price_dollars: '0.9500', yes_bid_dollars: '0.0100', yes_ask_dollars: '0.0200', result: 'yes' });
  ok(settledFar.price === 0.95, 'a settled market keeps its own last price (no book coherence rule)');
  const coherent = trackedPrice({ last_price_dollars: '0.4400', yes_bid_dollars: '0.4300', yes_ask_dollars: '0.4500' });
  ok(coherent.price === 0.44 && coherent.field === 'last_price_dollars', 'a coherent last price is still preferred over the midpoint');

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
  const strong = modelScore({ from: 0.20, delta: 0.12, bid: 0.31, ask: 0.33, volume24h: 5000, sampleAgeSeconds: 0 });
  ok(strong.score !== null && strong.highROI === true, 'a large move on a liquid, tight market scores as high-ROI');
  const weak = modelScore({ from: 0.90, delta: 0.10, bid: 0.01, ask: 0.99, volume24h: 5, sampleAgeSeconds: 0 });
  ok(weak.score !== null && weak.highROI === false, 'a small-headroom move on an illiquid, wide market does not');
  ok(modelScore({ from: null, delta: 0.1 }).score === null, 'no baseline -> no score');

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

  // resolutions
  const s6 = applySample(s5, {
    nowSeconds: 13000, markets: [],
    resolutions: [{ ticker: 'T1', result: 'yes', settlement_ts: '2026-11-20T00:00:00Z', settlement_value_dollars: '1.0000' }],
  });
  ok(s6.resolutions.length === 1 && s6.resolutions[0].result === 'yes', 'a resolution is recorded with its yes/no result');
  const s7 = applySample(s6, { nowSeconds: 14000, markets: [], resolutions: [{ ticker: 'T1', result: 'yes' }, { ticker: 'BAD', result: '' }] });
  ok(s7.resolutions.length === 1, 'resolutions de-duplicate and never store an empty result');

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
    process.exit(selftest());
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
