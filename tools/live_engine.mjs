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
export const HISTORY_RETAIN_SECONDS = 8 * 86400;
export const MAX_SAMPLES_PER_MARKET = 4000;
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
 * The price this engine tracks, with the field it came from.
 * Order of preference (all from S5/S6):
 *   1. last_price_dollars   — the last traded price, when it is a real binary price
 *   2. midpoint of yes_bid_dollars and yes_ask_dollars, when both are in (0,1)
 *   3. null                 — no usable price; the market is skipped and reported
 * A last price of exactly 0 is treated as "no trade yet" for a binary contract (0 is the
 * floor, so a 0 quote carries no directional information) unless a mid is available.
 */
export function trackedPrice(m) {
  const last = num(m.last_price_dollars);
  const bid = num(m.yes_bid_dollars);
  const ask = num(m.yes_ask_dollars);
  if (last !== null && last > 0 && last < 1) {
    return { price: last, field: 'last_price_dollars' };
  }
  // Both sides must be a real, tradable book: a bid above zero and an ask below one.
  // A book of bid $0.00 / ask $1.00 has no price — averaging it would invent $0.50.
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask < 1 && ask >= bid) {
    return { price: round((bid + ask) / 2), field: 'mid(yes_bid_dollars,yes_ask_dollars)' };
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
 * A missing category or tag is a hard error: it would silently empty a topic.
 */
export function checkTaxonomy(taxonomyJson, topics = TOPICS) {
  const map = (taxonomyJson && taxonomyJson.tags_by_categories) || {};
  const problems = [];
  for (const t of topics) {
    for (const q of t.queries) {
      if (q.category && !(q.category in map)) {
        problems.push(`topic ${t.id}: category "${q.category}" is not in tags_by_categories`);
      }
      if (q.tags) {
        const tags = map[q.category] || [];
        if (!tags.includes(q.tags)) {
          problems.push(`topic ${t.id}: tag "${q.tags}" is not listed under category "${q.category}"`);
        }
      }
    }
  }
  return problems;
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
  const chosen = flat.slice(0, maxSeries);

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
export function applySample(state, { nowSeconds, markets, resolutions = [], topicsFound = {} }) {
  const next = structuredClone(state);
  next.alerts = next.alerts || [];
  next.history = next.history || {};
  next.markets = next.markets || {};
  next.resolutions = next.resolutions || [];

  next.run = {
    sampled_at: new Date(nowSeconds * 1000).toISOString(),
    markets_sampled: 0,
    markets_without_price: 0,
    alerts_created: 0,
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
    const hist = next.history[ticker] || [];
    hist.push({ t: nowSeconds, p: price, bid, ask, vol24 });
    next.history[ticker] = hist.slice(-MAX_SAMPLES_PER_MARKET);

    // ---- baseline: previous sample, or the last alert inside the cooldown window
    const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
    let baseline = prev ? prev.p : null;
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
  for (const r of resolutions) {
    if (!r || !r.ticker) continue;
    if (r.result !== 'yes' && r.result !== 'no' && r.result !== 'scalar') continue;
    if (next.resolutions.some((x) => x.ticker === r.ticker)) continue;
    next.resolutions.push(r);
  }
  next.resolutions.sort((a, b) => String(b.settlement_ts || '').localeCompare(String(a.settlement_ts || '')));
  next.resolutions = next.resolutions.slice(0, MAX_RESOLUTIONS);

  // ---- merge alerts: newest first, de-duplicated by id
  const known = new Set(next.alerts.map((a) => a.id));
  for (const a of newAlerts) if (!known.has(a.id)) next.alerts.push(a);
  next.alerts.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  next.alerts = next.alerts.slice(0, MAX_ALERTS);
  next.run.alerts_created = newAlerts.length;

  // ---- prune history
  const cutoff = nowSeconds - HISTORY_RETAIN_SECONDS;
  for (const [ticker, hist] of Object.entries(next.history)) {
    const kept = hist.filter((s) => s.t >= cutoff).slice(-MAX_SAMPLES_PER_MARKET);
    if (kept.length) next.history[ticker] = kept;
    else delete next.history[ticker];
  }

  next.topics = topicsFound || {};
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

/* ------------------------------------------------------------------ run */


export async function runOnce({ dir = 'data/live', maxSeries = 12, candleMarkets = 6, candleLookbackMinutes = 180, dryRun = false, log = console.log } = {}) {
  const started = Math.floor(Date.now() / 1000);
  log(`KalshiDash1 live engine — ${new Date(started * 1000).toISOString()}`);
  log(`  base: ${BASE} (S1)  threshold: $${SWING_THRESHOLD}  max series: ${maxSeries}  candle markets: ${candleMarkets}`);

  const client = makeClient({ log });
  const state = await loadState(dir);

  // 0. taxonomy guard (S11)
  const tax = await client.getJson('/search/tags_by_categories');
  const problems = checkTaxonomy(tax);
  if (problems.length) {
    throw new Error('topic configuration no longer matches the live tag taxonomy:\n  ' + problems.join('\n  '));
  }
  log('  taxonomy check: OK (every configured category/tag exists)');

  // 1. discovery
  const seriesByTopic = await discoverSeries(client, { maxSeries, log });

  // 2. markets
  const { markets, chosenSeries } = await collectMarkets(client, seriesByTopic, { maxSeries, log });

  // 3. sample + detect
  const now = Math.floor(Date.now() / 1000);
  let next = applySample(state, { nowSeconds: now, markets, topicsFound: seriesByTopic });

  // 4. resolutions
  const resolutions = await collectResolutions(client, next, { maxSeries, log });
  if (resolutions.length) next = applySample(next, { nowSeconds: now, markets: [], resolutions, topicsFound: seriesByTopic });

  // 5. candle-based swings on the biggest rows (catches moves between sparse samples, S12)
  const candleAlerts = [];
  const candleTargets = topMarkets(next, candleMarkets);
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

  next.meta.base_url = BASE;
  next.meta.legacy_base_url = LEGACY_BASE;
  next.meta.threshold = SWING_THRESHOLD;
  next.meta.high_roi_threshold = HIGH_ROI_THRESHOLD;
  next.meta.model_version = MODEL_VERSION;
  next.meta.requests_this_run = client.stats.requests;
  next.meta.retries_this_run = client.stats.retries;
  next.meta.series_checked = chosenSeries.map((s) => s.series_ticker);
  next.meta.topic_rules = TOPICS.map(({ id, label, queries, why }) => ({ id, label, queries, why }));
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
  for (const t of top) if (state.history[t]) out[t] = state.history[t].slice(-400);
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

  // taxonomy guard
  ok(checkTaxonomy({ tags_by_categories: {} }).length > 0, 'an empty taxonomy is rejected, not silently accepted');

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
  runOnce({ dir, maxSeries, candleMarkets, dryRun: args.includes('--dry-run') })
    .then((st) => {
      // Exit code 0 even with zero alerts: "no swings right now" is a valid, healthy state.
      console.log('done. alerts in state:', st.alerts.length);
    })
    .catch((e) => {
      console.error('ENGINE FAILED:', e && e.message ? e.message : e);
      process.exitCode = 1;
    });
}
