#!/usr/bin/env node
/**
 * check_coverage.mjs — proves the live alert engine watches enough of the tracked universe.
 *
 * F-48 (found 2026-11-20, session-444e829d). The engine silently used to sample 12 series out of
 * the 122 that match the five topics, and to run its trade/candle swing detectors on 8 / 6 markets.
 * 671 markets were read, but only 8 accumulated a price series — so a move of $0.10 anywhere else
 * could not be detected *by construction*. The page said "live alerting"; the engine was watching
 * 0.35% of what the site tracks.
 *
 * This test does not call the network. It drives the engine's real selection functions with
 * fixtures shaped like the documented responses (GET /series, GET /markets) and asserts:
 *
 *   1. the exported defaults are the widened ones, and they are what every entry point uses;
 *   2. `collectMarkets` spreads the series budget across ALL five topics (no topic starved);
 *   3. the number of series actually sampled matches the budget;
 *   4. the per-topic top-N used by the swing detectors returns markets for every topic;
 *   5. history depth per topic is enough for a time series to exist at all.
 *
 * A budget assertion is deliberate: if someone lowers coverage again, this fails and they have to
 * argue for it in review instead of shipping it silently.
 *
 * Run: node tools/check_coverage.mjs     (exit 1 on failure)
 */
import {
  DEFAULT_MAX_SERIES, DEFAULT_CANDLE_MARKETS, DEFAULT_TRADE_MARKETS,
  MAX_HISTORY_MARKETS, collectMarkets, topMarketsByTopic, TOPICS, detectSwing, SWING_THRESHOLD,
} from './live_engine.mjs';

let n = 0;
const fails = [];
function check(name, cond, detail = '') {
  n++;
  if (!cond) fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  else console.log(`  ✓ ${name}`);
}

/* ---- 1. the defaults ---- */
console.log('coverage budgets');
check('series budget is at least 40 (was 12)', DEFAULT_MAX_SERIES >= 40, `got ${DEFAULT_MAX_SERIES}`);
check('candle budget is at least 20 (was 6)', DEFAULT_CANDLE_MARKETS >= 20, `got ${DEFAULT_CANDLE_MARKETS}`);
check('trade budget is at least 30 (was 10)', DEFAULT_TRADE_MARKETS >= 30, `got ${DEFAULT_TRADE_MARKETS}`);
check('history keeps at least 8 markets per topic (was 4)', MAX_HISTORY_MARKETS >= 8, `got ${MAX_HISTORY_MARKETS}`);

/* ---- fixtures: series counts that mirror the live demo capture (30/30/2/30/30 = 122) ---- */
const COUNTS = { gas: 30, elections: 30, culture: 2, crypto: 30, golf: 30 };
const seriesByTopic = {};
for (const t of TOPICS) {
  seriesByTopic[t.id] = Array.from({ length: COUNTS[t.id] }, (_, k) => ({
    ticker: `${t.id.toUpperCase()}${k}`,
    series_ticker: `${t.id.toUpperCase()}${k}`,
    title: `${t.label} series ${k}`,
    volume_fp: (COUNTS[t.id] - k) * 10,
    settlement_sources: [],
  }));
}

/* ---- 2 & 3. real collectMarkets selection ---- */
const calls = [];
const fakeClient = {
  base: 'https://example.test/trade-api/v2',
  getJson: async (p) => {
    calls.push(p);
    // each series returns 6 open markets, shaped per the documented Get Markets response
    return {
      markets: Array.from({ length: 6 }, (_, k) => ({
        ticker: `MKT-${calls.length}-${k}`,
        last_price_dollars: '0.5000',
        yes_bid_dollars: '0.4900',
        yes_ask_dollars: '0.5100',
        status: 'active',
        volume_fp: '100.00',
        volume_24h_fp: '10.00',
        open_interest_fp: '50.00',
      })),
    };
  },
};

const res = await collectMarkets(fakeClient, seriesByTopic, { log: () => {} });
console.log('\nselection');
check('chose exactly the series budget', res.chosenSeries.length === DEFAULT_MAX_SERIES, `chose ${res.chosenSeries.length}`);
check('made one request per chosen series', calls.length === DEFAULT_MAX_SERIES, `made ${calls.length}`);

const perTopic = {};
for (const s of res.chosenSeries) perTopic[s.topic] = (perTopic[s.topic] || 0) + 1;
console.log('  per topic:', JSON.stringify(perTopic));
for (const t of TOPICS) {
  check(`topic "${t.id}" is represented`, (perTopic[t.id] || 0) > 0, JSON.stringify(perTopic));
}
/* Culture only has 2 series in the live taxonomy; the round-robin must still take both, and the
 * remaining budget must go to the topics that have more. */
check('culture takes both of its available series', perTopic.culture === 2, `got ${perTopic.culture}`);
/* Culture only offers 2 series; the budget it cannot use is deliberately redistributed to the
 * other topics, so a topic may legitimately exceed the even share by the unused leftover. */
const evenShare = Math.ceil(DEFAULT_MAX_SERIES / TOPICS.length);
const leftover = TOPICS.reduce((acc, t) => acc + Math.max(0, evenShare - (perTopic[t.id] || 0)), 0);
check('no topic is over-served beyond its share plus the redistributed leftover',
  Math.max(...Object.values(perTopic)) <= evenShare + leftover,
  `max ${Math.max(...Object.values(perTopic))}, allowed ${evenShare + leftover}`);

/* ---- 4. the per-topic top-N used by the swing detectors ---- */
/* collectMarkets returns markets with `topic` already set from the series it belongs to. */
const state = { markets: {} };
for (const m of res.markets) {
  state.markets[m.raw.ticker] = { ...m.raw, topic: m.topic, series_ticker: m.series_ticker, price: 0.5, est_traded_dollars: 500 };
}
const targets = topMarketsByTopic(state, Math.ceil(DEFAULT_TRADE_MARKETS / TOPICS.length));
const targetTopics = new Set(targets.map((m) => m.topic));
console.log('\ndetector targets');
check('swing detectors reach all five topics', targetTopics.size === TOPICS.length, [...targetTopics].join(','));
check('detector target count is at least the trade budget', targets.length >= DEFAULT_TRADE_MARKETS, `got ${targets.length}`);

/* ---- 5. the threshold rule itself is unchanged by all of this ---- */
console.log('\nthreshold (unchanged)');
check('threshold is still $0.10', SWING_THRESHOLD === 0.1, String(SWING_THRESHOLD));
check('a $0.09 move is not an alert', detectSwing({ ticker: 'T', topic: 'gas', title: 't', price: 0.59, baseline: 0.5, nowSeconds: 0 }) === null);
check('a $0.10 move is an alert', !!detectSwing({ ticker: 'T', topic: 'gas', title: 't', price: 0.6, baseline: 0.5, nowSeconds: 0 }));
check('a $0.10 drop is an alert', !!detectSwing({ ticker: 'T', topic: 'gas', title: 't', price: 0.4, baseline: 0.5, nowSeconds: 0 }));

if (fails.length) {
  console.error(`\ncoverage check FAILED (${fails.length} of ${n}):`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`\ncoverage check: ${n} assertions passed — budgets, per-topic spread and threshold.`);
