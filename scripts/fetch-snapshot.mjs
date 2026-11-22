#!/usr/bin/env node
/* fetch-snapshot.mjs — capture a verified point-in-time snapshot of the Kalshi
 * DEMO exchange for the five focus topics, using only public (unauthenticated)
 * Trade API endpoints.
 *
 *   node scripts/fetch-snapshot.mjs                      # -> data/snapshot.json
 *   node scripts/fetch-snapshot.mjs --out /tmp/s.json
 *
 * Every row written here carries the exact endpoint URL it came from
 * (`source_url`). Fields the API did not return are written as `null` and are
 * never guessed. Sources: docs.kalshi.com/api-reference/... (see data/sources.json).
 *
 * Only these endpoints are used (all documented as unauthenticated):
 *   GET /exchange/status
 *   GET /search/tags_by_categories
 *   GET /series?category=&tags=&include_volume=
 *   GET /markets?series_ticker=&status=open
 *   GET /events?series_ticker=&status=settled&with_nested_markets=true
 *   GET /markets/{ticker}/orderbook?depth=
 *   GET /markets/{ticker}/candlesticks?start_ts=&end_ts=&period_interval=
 */
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.KALSHI_API_ROOT || 'https://external-api.demo.kalshi.co/trade-api/v2';
const API_LEGACY = 'https://demo-api.kalshi.co/trade-api/v2';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : path.join(process.cwd(), 'data', 'snapshot.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usedEndpoints = [];

async function get(p, tries = 3) {
  const url = API + p;
  usedEndpoints.push(url);
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { data: await res.json(), url };
    } catch (e) {
      if (i === tries - 1) { console.warn('  ! GET', p, '->', e.message); return { data: null, url }; }
      await sleep(700 * (i + 1));
    }
  }
  return { data: null, url };
}

/* ------------------------------------------------------------------ topics */
/* Topic -> series query + the documented rule used to keep a series in the topic.
 * Rules are stated in plain words on the site's Methodology/Sources pages so a
 * reviewer can re-run them. */
const TOPICS = [
  {
    id: 'gas', label: 'Gas Prices',
    query: '/series?category=Economics&tags=Oil%20and%20energy&include_volume=true',
    rule: 'Keep a series when its ticker starts with "KXAAAGAS" (AAA gasoline price series) or its title contains "gas price". Verified against GET /series?category=Economics&tags=Oil and energy — every kept series settles against AAA (gasprices.aaa.com).',
    keep: (s) => /^KXAAAGAS/.test(s.ticker || '') || /gas price/i.test(s.title || '')
  },
  {
    id: 'elections', label: 'Elections',
    query: '/series?category=Elections&include_volume=true',
    rule: 'Category query only: every series whose categories list contains "Elections" is in this topic.',
    keep: () => true
  },
  {
    id: 'culture', label: 'Culture',
    query: '/series?category=Culture&include_volume=true',
    rule: 'Category query only: every series whose categories list contains "Culture" is in this topic.',
    keep: () => true
  },
  {
    id: 'crypto', label: 'Crypto',
    query: '/series?category=Crypto&include_volume=true',
    rule: 'Category query only: every series whose categories list contains "Crypto" is in this topic.',
    keep: () => true
  },
  {
    id: 'golf', label: 'Golf',
    query: '/series?category=Sports&tags=Golf&include_volume=true',
    rule: 'Category "Sports" plus the official tag "Golf" (verified in GET /search/tags_by_categories -> Sports -> ["Golf"]).',
    keep: (s) => (s.tags || []).includes('Golf') || /golf|pga|masters|ryder|open championship/i.test(s.title || '')
  }
];

/* NOTE on the series endpoint: Get Series List documents `category`, `tags`,
 * `include_product_metadata`, `include_volume` and `min_updated_ts` — there is
 * no `limit` parameter, so a category query returns every series in that
 * category. We rank the result locally by volume_fp and keep the top slice. */

const MAX_SERIES_PER_TOPIC = 30;   // ranked by series volume_fp (total contracts traded)
const MAX_MARKETS_PER_SERIES = 200;
const MAX_TOPIC_MARKET_ROWS = 60;  // rows stored per topic (the site ranks live anyway)
const ORDERBOOK_TOP_N = 14;
const CANDLE_TOP_N = 8;

const fp = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

function seriesRow(s, topic, url) {
  return {
    ticker: s.ticker ?? null,
    title: s.title ?? null,
    category: s.category ?? null,
    categories: s.categories ?? null,
    tags: s.tags ?? null,
    frequency: s.frequency ?? null,
    volume_fp: fp(s.volume_fp),
    contract_terms_url: s.contract_terms_url ?? null,
    contract_url: s.contract_url ?? null,
    settlement_sources: (s.settlement_sources || []).slice(0, 12).map((x) => ({ name: x.name ?? null, url: x.url ?? null })),
    last_updated_ts: s.last_updated_ts ?? null,
    topic,
    source_url: url
  };
}

function marketRow(m, topic, url, seriesTicker, settlementSources) {
  return {
    ticker: m.ticker ?? null,
    event_ticker: m.event_ticker ?? null,
    title: m.title ?? m.yes_sub_title ?? null,
    yes_sub_title: m.yes_sub_title ?? null,
    series_ticker: seriesTicker ?? null,
    settlement_sources: (settlementSources || []).slice(0, 8).map((x) => ({ name: x.name ?? null, url: x.url ?? null })),
    status: m.status ?? null,
    result: m.result && m.result !== '' ? m.result : null,
    last_price_dollars: fp(m.last_price_dollars),
    previous_price_dollars: fp(m.previous_price_dollars),
    yes_bid_dollars: fp(m.yes_bid_dollars),
    yes_ask_dollars: fp(m.yes_ask_dollars),
    no_bid_dollars: fp(m.no_bid_dollars),
    no_ask_dollars: fp(m.no_ask_dollars),
    yes_bid_size_fp: fp(m.yes_bid_size_fp),
    yes_ask_size_fp: fp(m.yes_ask_size_fp),
    volume_fp: fp(m.volume_fp),
    volume_24h_fp: fp(m.volume_24h_fp),
    open_interest_fp: fp(m.open_interest_fp),
    notional_value_dollars: fp(m.notional_value_dollars),
    close_time: m.close_time ?? null,
    expected_expiration_time: m.expected_expiration_time ?? null,
    latest_expiration_time: m.latest_expiration_time ?? null,
    open_time: m.open_time ?? null,
    settlement_ts: m.settlement_ts ?? null,
    settlement_value_dollars: fp(m.settlement_value_dollars),
    rules_primary: (m.rules_primary || '').slice(0, 700) || null,
    price_level_structure: m.price_level_structure ?? null,
    topic,
    source_url: url
  };
}

/* ------------------------------------------------------------------- build */
const snap = {
  meta: {
    captured_at: new Date().toISOString(),
    environment: 'demo',
    api_root: API,
    api_root_legacy: API_LEGACY,
    generator: 'scripts/fetch-snapshot.mjs',
    capture_method: 'Direct HTTPS GET against the official Kalshi demo Trade API using public (unauthenticated) endpoints.',
    note: 'Point-in-time snapshot. Every row carries the exact endpoint URL in source_url. Fields the API did not return are null and are listed as unverified on the Flagged for Review page. Nothing on this site is inferred.'
  },
  topics: {},
  markets: [],
  orderbooks: {},
  candlesticks: {}
};

const statusRes = await get('/exchange/status');
snap.exchange_status = statusRes.data ? { value: statusRes.data, source_url: statusRes.url } : { value: null, source_url: statusRes.url };
await sleep(150);

const tagsRes = await get('/search/tags_by_categories');
snap.tags_by_categories = tagsRes.data ? { value: tagsRes.data.tags_by_categories, source_url: tagsRes.url } : { value: null, source_url: tagsRes.url };
await sleep(150);

const allMarkets = [];
const seenTicker = new Set();

for (const t of TOPICS) {
  console.log(`topic ${t.id}: ${t.query}`);
  const sRes = await get(t.query);
  const rawSeries = (sRes.data && sRes.data.series) || [];
  const kept = rawSeries.filter(t.keep).map((s) => seriesRow(s, t.id, sRes.url));
  kept.sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0));
  const series = kept.slice(0, MAX_SERIES_PER_TOPIC);
  await sleep(150);

  const live = [];
  for (const s of series) {
    const q = `/markets?series_ticker=${encodeURIComponent(s.ticker)}&status=open&limit=${MAX_MARKETS_PER_SERIES}`;
    const r = await get(q);
    for (const m of (r.data && r.data.markets) || []) {
      const row = marketRow(m, t.id, r.url, s.ticker, s.settlement_sources);
      live.push(row);
      if (!seenTicker.has(row.ticker)) { seenTicker.add(row.ticker); allMarkets.push(row); }
    }
    await sleep(120);
  }
  live.sort((a, b) => (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0) || (b.volume_fp || 0) - (a.volume_fp || 0));

  /* settled events (resolution evidence: result yes / no) */
  const settled = [];
  for (const s of series.slice(0, 6)) {
    const q = `/events?series_ticker=${encodeURIComponent(s.ticker)}&status=settled&with_nested_markets=true&limit=2`;
    const r = await get(q);
    for (const ev of (r.data && r.data.events) || []) {
      settled.push({
        event_ticker: ev.event_ticker ?? null,
        title: ev.title ?? null,
        series_ticker: ev.series_ticker ?? null,
        category: ev.category ?? null,
        settlement_ts: ev.settlement_ts ?? null,
        settlement_sources: (ev.settlement_sources || []).map((x) => ({ name: x.name ?? null, url: x.url ?? null })),
        topic: t.id,
        source_url: r.url,
        markets: (ev.markets || []).slice(0, 12).map((m) => ({
          ticker: m.ticker ?? null,
          yes_sub_title: m.yes_sub_title ?? null,
          status: m.status ?? null,
          result: m.result && m.result !== '' ? m.result : null,
          /* The event object itself carries no settlement_ts; the nested market does
           * (verified live: GET /events/{ticker} returns settlement_ts only on the market).
           * Store it here so the category pages can show "Settled at" instead of a blank. */
          settlement_ts: m.settlement_ts ?? null,
          settlement_value_dollars: fp(m.settlement_value_dollars),
          last_price_dollars: fp(m.last_price_dollars),
          volume_fp: fp(m.volume_fp),
          open_interest_fp: fp(m.open_interest_fp),
          rules_primary: m.rules_primary ?? null
        }))
      });
    }
    await sleep(120);
  }

  snap.topics[t.id] = {
    label: t.label,
    series_query: API + t.query,
    selection_rule: t.rule,
    series_count_returned: rawSeries.length,
    series_count_kept: kept.length,
    series,
    live_markets: live.slice(0, MAX_TOPIC_MARKET_ROWS),
    live_markets_total: live.length,
    settled_events: settled
  };
  console.log(`  -> ${series.length} series, ${live.length} open markets (${settled.length} settled events)`);
}

/* global ranking by 24h dollar volume (contracts x $1 notional per market) */
allMarkets.sort((a, b) => (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0) || (b.volume_fp || 0) - (a.volume_fp || 0));
snap.markets = allMarkets.slice(0, 200);
snap.markets_count_all = allMarkets.length;

/* orderbook snapshots for the most-traded open markets (liquidity readout) */
const nowSec = Math.floor(Date.now() / 1000);
for (const m of snap.markets.slice(0, ORDERBOOK_TOP_N)) {
  const q = `/markets/${encodeURIComponent(m.ticker)}/orderbook?depth=20`;
  const r = await get(q);
  const ob = r.data && r.data.orderbook_fp ? r.data.orderbook_fp : null;
  snap.orderbooks[m.ticker] = {
    yes_dollars: (ob && ob.yes_dollars) || [],
    no_dollars: (ob && ob.no_dollars) || [],
    source_url: r.url
  };
  await sleep(120);
}

/* candlesticks. Official path (docs.kalshi.com/api-reference/market/get-market-candlesticks):
 *   GET /series/{series_ticker}/markets/{ticker}/candlesticks?start_ts=&end_ts=&period_interval=
 * period_interval is 1, 60 or 1440 minutes. Stored compactly as [end_period_ts, close_dollars]. */
for (const m of snap.markets.slice(0, CANDLE_TOP_N)) {
  if (!m.series_ticker) continue;
  const base = `/series/${encodeURIComponent(m.series_ticker)}/markets/${encodeURIComponent(m.ticker)}/candlesticks`;
  const q1 = `${base}?start_ts=${nowSec - 6 * 3600}&end_ts=${nowSec}&period_interval=1`;
  const q60 = `${base}?start_ts=${nowSec - 7 * 86400}&end_ts=${nowSec}&period_interval=60`;
  const r1 = await get(q1);
  const r60 = await get(q60);
  const compact = (r) => ((r.data && r.data.candlesticks) || []).map((c) => [
    c.end_period_ts,
    c.price && c.price.close_dollars !== undefined && c.price.close_dollars !== null ? Number(c.price.close_dollars) : null
  ]).filter((x) => x[1] !== null);
  snap.candlesticks[m.ticker] = {
    series_ticker: m.series_ticker,
    m1: { candles: compact(r1), source_url: r1.url },
    m60: { candles: compact(r60), source_url: r60.url }
  };
  await sleep(120);
}

snap.meta.endpoints_used = [...new Set(usedEndpoints)];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snap, null, 1));
console.log(`wrote ${OUT} — ${snap.markets_count_all} open markets, ${Object.keys(snap.orderbooks).length} orderbooks, ${Object.keys(snap.candlesticks).length} candle sets`);
