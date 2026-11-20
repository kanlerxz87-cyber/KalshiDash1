#!/usr/bin/env node
/* fetch_snapshot.mjs — refresh docs/data/snapshot.json from the official Kalshi demo API.
 * No dependencies (Node 18+). Public endpoints only — no keys required for the default mode.
 *
 *   node scripts/fetch_snapshot.mjs                     # refresh the snapshot
 *   node scripts/fetch_snapshot.mjs --out /tmp/s.json   # custom output
 *
 * OPTIONAL demo-portfolio export (your own keys; they NEVER leave your machine):
 *   KALSHI_KEY_ID=... KALSHI_PRIVATE_KEY_PATH=/path/key.pem \
 *     node scripts/fetch_snapshot.mjs --portfolio
 * writes docs/data/portfolio.json with balance/positions/fills/settlements — the real
 * demo-account inputs the static site cannot fetch itself (see flagged.html F-02).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = process.env.KALSHI_API_ROOT || 'https://external-api.demo.kalshi.co/trade-api/v2';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : path.join(process.cwd(), 'docs', 'data', 'snapshot.json');
const wantPortfolio = args.includes('--portfolio');

async function get(pathname) {
  const res = await fetch(API + pathname);
  if (!res.ok) throw new Error(`GET ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

function sign(key, timestamp, method, pathname) {
  const msg = Buffer.from(timestamp + method + pathname);
  if (key.asymmetricKeyType === 'ed25519') return crypto.sign(null, msg, key).toString('base64');
  return crypto.sign('sha256', msg, {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }).toString('base64');
}

async function getAuth(pathname) {
  const keyId = process.env.KALSHI_KEY_ID;
  const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !keyPath) throw new Error('--portfolio needs KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PATH');
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const ts = String(Date.now());
  const signature = sign(key, ts, 'GET', pathname);
  const res = await fetch(API + pathname, {
    headers: {
      'KALSHI-ACCESS-KEY': keyId,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': signature
    }
  });
  if (!res.ok) throw new Error(`GET ${pathname} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---- public snapshot pipeline (mirrors docs/js/data.js) ---- */
const TOPICS = [
  { id: 'gas', label: 'Gas Prices',
    seriesQueries: ['/series?category=Economics&tags=Oil%20and%20energy&include_volume=true&limit=50', '/series?category=Economics&limit=50'],
    match: (s) => /\bgas\b|gasoline|fuel price|SPR\b/i.test(s.title || '') || /GAS|SPR/.test(s.ticker || '') },
  { id: 'elections', label: 'Elections',
    seriesQueries: ['/series?category=Elections&include_volume=true&limit=50'],
    match: (s) => /elect|senate|house|president|mayor|governor|speaker|vote|pope|nato|primary/i.test(s.title || '') },
  { id: 'culture', label: 'Culture',
    seriesQueries: ['/series?category=Culture&limit=50'],
    match: () => true },
  { id: 'crypto', label: 'Crypto',
    seriesQueries: ['/series?category=Crypto&include_volume=true&limit=50'],
    match: () => true },
  { id: 'golf', label: 'Golf',
    seriesQueries: ['/series?category=Sports&tags=Golf&include_volume=true&limit=50'],
    match: () => true }
];

function marketRow(m, topic, sourceUrl) {
  return { ticker: m.ticker, event_ticker: m.event_ticker, title: m.title || m.yes_sub_title, topic,
    status: m.status, result: m.result || '', last_price_dollars: m.last_price_dollars,
    previous_price_dollars: m.previous_price_dollars, yes_bid_dollars: m.yes_bid_dollars,
    yes_ask_dollars: m.yes_ask_dollars, no_bid_dollars: m.no_bid_dollars, no_ask_dollars: m.no_ask_dollars,
    yes_bid_size_fp: m.yes_bid_size_fp, yes_ask_size_fp: m.yes_ask_size_fp,
    volume_fp: m.volume_fp, volume_24h_fp: m.volume_24h_fp, open_interest_fp: m.open_interest_fp,
    notional_value_dollars: m.notional_value_dollars, close_time: m.close_time,
    expected_expiration_time: m.expected_expiration_time, latest_expiration_time: m.latest_expiration_time,
    rules_primary: m.rules_primary || '', settlement_ts: m.settlement_ts || null,
    settlement_value_dollars: m.settlement_value_dollars || null, source_url: sourceUrl };
}

const snapshot = {
  meta: {
    captured_at: new Date().toISOString(),
    environment: 'demo',
    capture_method: 'scripts/fetch_snapshot.mjs against the official demo Trade API (public endpoints)',
    api_root: API,
    note: 'Point-in-time snapshot; every row carries the exact endpoint URL it came from. Null = not returned by the query (never inferred).'
  },
  topics: {}
};

for (const t of TOPICS) {
  const seriesSeen = new Map();
  for (const q of t.seriesQueries) {
    const url = API + q;
    const data = await get(q).catch(e => { console.warn('warn', q, e.message); return { series: [] }; });
    for (const s of data.series || []) {
      if (t.match(s) && !seriesSeen.has(s.ticker)) {
        seriesSeen.set(s.ticker, {
          ticker: s.ticker, title: s.title, category: s.category, tags: s.tags || [],
          volume_fp: s.volume_fp ?? null, contract_terms_url: s.contract_terms_url || null,
          settlement_source: (s.settlement_sources || []).map(x => `${x.name} (${x.url})`).join('; ') || null,
          source_url: url
        });
      }
    }
  }
  const series = [...seriesSeen.values()].sort((a, b) => (parseFloat(b.volume_fp) || 0) - (parseFloat(a.volume_fp) || 0));
  const live = [];
  for (const s of series.slice(0, 8)) {
    const q = `/markets?series_ticker=${encodeURIComponent(s.ticker)}&status=open&limit=50`;
    const data = await get(q).catch(() => ({ markets: [] }));
    for (const m of data.markets || []) live.push(marketRow(m, t.id, API + q));
  }
  live.sort((a, b) => (parseFloat(b.volume_24h_fp) || 0) - (parseFloat(a.volume_24h_fp) || 0)
    || (parseFloat(b.volume_fp) || 0) - (parseFloat(a.volume_fp) || 0));

  // one settled event per topic for the resolution log
  const settled = [];
  for (const s of series.slice(0, 4)) {
    const q = `/events?series_ticker=${encodeURIComponent(s.ticker)}&status=settled&with_nested_markets=true&limit=2`;
    const data = await get(q).catch(() => ({ events: [] }));
    for (const ev of (data.events || []).slice(0, 1)) {
      settled.push({
        event_ticker: ev.event_ticker, title: ev.title, series_ticker: ev.series_ticker,
        settlement_ts: (ev.markets || [])[0]?.settlement_ts || null,
        settlement_source: (ev.settlement_sources || []).map(x => `${x.name} (${x.url})`).join('; ') || null,
        source_url: API + q,
        markets: (ev.markets || []).slice(0, 10).map(m => ({
          ticker: m.ticker, strike: m.yes_sub_title, result: m.result,
          settlement_value_dollars: m.settlement_value_dollars, volume_fp: m.volume_fp,
          open_interest_fp: m.open_interest_fp, status: m.status, rules_primary: m.rules_primary
        }))
      });
    }
    if (settled.length) break;
  }

  snapshot.topics[t.id] = {
    label: t.label,
    series_query: API + t.seriesQueries[0],
    series, live_markets: live, settled_events: settled,
    live_note: live.length ? `${live.length} open markets captured.` : 'No open markets for queried series at capture time.'
  };
  console.log(`topic ${t.id}: ${series.length} series, ${live.length} live markets, ${settled.length} settled events`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
console.log('wrote', OUT);

if (wantPortfolio) {
  const [balance, positions, fills, settlements] = await Promise.all([
    getAuth('/portfolio/balance'),
    getAuth('/portfolio/positions'),
    getAuth('/portfolio/fills?limit=200'),
    getAuth('/portfolio/settlements?limit=200')
  ]);
  const out = path.join(path.dirname(OUT), 'portfolio.json');
  fs.writeFileSync(out, JSON.stringify({ captured_at: new Date().toISOString(), balance, positions, fills, settlements }, null, 2));
  console.log('wrote', out, '(contains your account data — do NOT commit it)');
}
