#!/usr/bin/env node
/* check_resolution_logic_test.mjs — proves resolution tracking survives the market cap and
 * that settled results are retrieved with the documented query.
 *
 * WHY THIS EXISTS (F-66 on flagged.html)
 * --------------------------------------
 * The brief says "track live events until the events have resolved". Two defects made the
 * published feed contradict it, and both were silent:
 *   1. applySample() capped the market map at 300 rows ranked by estimated dollars, and a market
 *      evicted before its result was published had the result discarded as "untracked".
 *   2. collectResolutions() read a single page of ?status=settled sorted by *creation* time, so a
 *      market that settled recently could sit past page 1; Get Markets documents
 *      min_settled_ts/max_settled_ts as the settlement-time ordering and limit ≤ 1000.
 * This test drives the exported pure functions offline, with an in-memory API client, so the
 * behaviour is pinned without network access.
 *
 * Usage: node tools/check_resolution_logic_test.mjs   (exit 0 = pass)
 */
import {
  applySample, collectResolutions, collectDirectResolutions, computeResolutionSince,
  publishedResolutions, awaitingResolutions, SETTLE_OVERLAP_SECONDS,
} from '../tools/live_engine.mjs';

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); else console.log('ok   ' + msg); };

const EMPTY = { meta: {}, alerts: [], history: {}, markets: {}, resolutions: [], run: {} };
const mk = (ticker, price, volume) => ({
  raw: {
    ticker, title: 'T ' + ticker, status: 'active', result: '',
    last_price_dollars: price.toFixed(4),
    yes_bid_dollars: (price - 0.01).toFixed(4), yes_ask_dollars: (price + 0.01).toFixed(4),
    volume_fp: String(volume), volume_24h_fp: String(volume), open_interest_fp: '50.00',
    close_time: '2026-12-01T00:00:00Z',
  },
  topic: 'crypto', series_ticker: 'SER', series: {}, source_url: 'https://example.invalid/m',
});

/* 1. A followed market keeps its result even when it is far outside the 300-row cap. */
const baseline = applySample(structuredClone(EMPTY), { nowSeconds: 1000, markets: [mk('FOLLOWED', 0.30, 1)], runId: 'r1' });
const crowded = [mk('FOLLOWED', 0.45, 1)];
for (let i = 0; i < 400; i += 1) crowded.push(mk('BIG' + i, 0.50, 1000000));
const sampled = applySample(baseline, { nowSeconds: 2000, markets: crowded, runId: 'r2' });
ok(sampled.alerts.some((a) => a.ticker === 'FOLLOWED'), 'the followed market alerts inside a 401-row sample');
ok(Object.keys(sampled.markets).length <= 301, `the 300-row cap still bounds the map (${Object.keys(sampled.markets).length} rows)`);

const resolved = applySample(sampled, {
  nowSeconds: 3000, markets: [],
  resolutions: [{ ticker: 'FOLLOWED', result: 'no', status: 'finalized', settlement_ts: '2026-11-21T07:00:00Z', settlement_value_dollars: '0.0000' }],
  runId: 'r3',
});
ok(resolved.resolutions.length === 1 && resolved.resolutions[0].result === 'no',
  'a resolution for a followed market that fell outside the cap is recorded, not discarded');
ok(resolved.markets.FOLLOWED && resolved.markets.FOLLOWED.result === 'no',
  'the resolved row keeps the exchange result for the market page');
ok(resolved.markets.FOLLOWED.settlement_value_dollars === '0.0000',
  'the resolved row keeps settlement_value_dollars verbatim');

const untracked = applySample(resolved, {
  nowSeconds: 3100, markets: [],
  resolutions: [{ ticker: 'NEVER-TRACKED', result: 'yes', status: 'finalized', settlement_ts: '2026-11-21T07:05:00Z' }],
  runId: 'r4',
});
ok(untracked.resolutions.length === 1 && untracked.run.untracked_settled_seen >= 1,
  'a settled market this engine never followed is counted, not stored');

const twice = applySample(resolved, {
  nowSeconds: 3200, markets: [],
  resolutions: [{ ticker: 'FOLLOWED', result: 'no', status: 'finalized', settlement_ts: '2026-11-21T07:00:00Z' }],
  runId: 'r5',
});
ok(twice.resolutions.length === 1, 'a resolution is never stored twice');

/* 2. The settled query: pending only, newest close first, documented window and limit. */
const calls = [];
const client = (pages) => ({
  base: 'https://example.invalid/trade-api/v2',
  async getJson(p) {
    calls.push(p);
    const series = (p.match(/series_ticker=([^&]+)/) || [])[1];
    const cursor = (p.match(/cursor=([^&]+)/) || [])[1] || '';
    const list = pages[series] || [];
    const page = cursor === 'p2' ? 1 : 0;
    return { cursor: page === 0 && list.length > 1 ? 'p2' : '', markets: list[page] || [] };
  },
});
const state = {
  meta: { generated_at: '2026-11-21T07:00:00Z' },
  alerts: [{ ticker: 'RECENT', ts: '2026-11-21T06:00:00Z' }, { ticker: 'OLD', ts: '2026-11-01T00:00:00Z' }, { ticker: 'DONE', ts: '2026-10-01T00:00:00Z' }],
  markets: {
    RECENT: { ticker: 'RECENT', series_ticker: 'S_RECENT', topic: 'crypto', close_time: '2026-11-21T06:00:00Z', status: 'active' },
    OLD: { ticker: 'OLD', series_ticker: 'S_OLD', topic: 'gas', close_time: '2026-11-21T02:00:00Z', status: 'active' },
    DONE: { ticker: 'DONE', series_ticker: 'S_DONE', topic: 'golf', close_time: '2026-10-01T00:00:00Z', status: 'active' },
  },
  resolutions: [{ ticker: 'DONE', result: 'yes', settlement_ts: '2026-10-01T01:00:00Z' }],
};
const found = await collectResolutions(client({
  S_RECENT: [[{ ticker: 'OTHER', result: 'yes' }], [{ ticker: 'RECENT', result: 'yes', status: 'finalized', settlement_ts: '2026-11-21T07:02:00Z', settlement_value_dollars: '1.0000' }]],
  S_OLD: [[{ ticker: 'OLD', result: 'no', status: 'finalized', settlement_ts: '2026-11-21T03:00:00Z' }]],
}), state, { maxSeries: 12, nowSeconds: Date.parse('2026-11-21T07:10:00Z') / 1000 });

ok(found.length === 2 && found.some((r) => r.ticker === 'RECENT') && found.some((r) => r.ticker === 'OLD'),
  'settled results are found past page 1 and only for markets still awaiting an answer');
ok(!calls.some((p) => p.includes('S_DONE')), 'a series whose followed markets all resolved is not polled again');
ok(calls[0].includes('S_RECENT'), 'the series whose tracked market closed most recently is polled first');
ok(calls.every((p) => p.includes('limit=1000')), 'every settled page asks for the documented maximum of 1000 rows');
const window = calls[0].match(/min_settled_ts=(\d+)/);
ok(window && Number(window[1]) === Date.parse('2026-11-21T07:00:00Z') / 1000 - SETTLE_OVERLAP_SECONDS,
  'the settlement window starts one overlap before the previous sample (Get Markets sorts by settlement time)');
ok(found.every((r) => r.source_url.startsWith('https://example.invalid/trade-api/v2/markets?')),
  'every resolution carries the API URL it was read from');

/* 3. The published follow list: alerted + unresolved, with what it is waiting for. */
const awaiting = awaitingResolutions({
  alerts: [{ ticker: 'RECENT', ts: '2026-11-21T06:00:00Z', delta: -0.12 }],
  markets: state.markets, resolutions: [],
}, 10);
ok(awaiting.length === 1 && awaiting[0].ticker === 'RECENT', 'the follow list holds alerted, unresolved markets');
ok(awaiting[0].last_alert_delta === -0.12 && awaiting[0].close_time === '2026-11-21T06:00:00Z',
  'each followed row carries its last alert and its close time');
ok(awaitingResolutions({ alerts: [{ ticker: 'DONE' }], markets: state.markets, resolutions: [{ ticker: 'DONE', result: 'yes' }] }, 10).length === 0,
  'a resolved market never appears in the follow list');

/* 4. F-95 regressions: pre-sample min_settled_ts + direct unpaged GET /markets?tickers=... +
 *    publishedResolutions slice consistency. */
const prevTs = Date.parse('2026-11-23T12:00:00Z') / 1000;
const delayedNow = Date.parse('2026-11-23T17:00:00Z') / 1000; // 5-hour cron gap (F-83)
const beforeSample = {
  meta: { generated_at: '2026-11-23T12:00:00Z' },
  alerts: [{ ticker: 'KXAAAGASW-26NOV23-3.6400', ts: '2026-11-22T16:55:38Z', delta: -0.82 }],
  markets: {
    'KXAAAGASW-26NOV23-3.6400': {
      ticker: 'KXAAAGASW-26NOV23-3.6400', series_ticker: 'KXAAAGASW', topic: 'gas',
      close_time: '2026-11-23T04:59:00Z', status: 'active',
    },
  },
  resolutions: [], history: {}, run: {},
};
const capturedSince = computeResolutionSince(beforeSample);
const afterSample = applySample(structuredClone(beforeSample), { nowSeconds: delayedNow, markets: [], runId: 'delayed' });
ok(afterSample.meta.generated_at === '2026-11-23T17:00:00.000Z',
  'applySample advances meta.generated_at to now (the overwrite that collapsed min_settled_ts in F-95)');
ok(capturedSince === prevTs - SETTLE_OVERLAP_SECONDS,
  'computeResolutionSince preserves pre-sample generated_at minus 900s overlap across a 5-hour cron gap');

const f95SeriesCalls = [];
const f95SeriesClient = {
  base: 'https://example.invalid/trade-api/v2',
  async getJson(p) { f95SeriesCalls.push(p); return { cursor: '', markets: [] }; },
};
await collectResolutions(f95SeriesClient, afterSample, { maxSeries: 12, nowSeconds: delayedNow, since: capturedSince });
const f95MinTs = Number((f95SeriesCalls[0].match(/min_settled_ts=(\d+)/) || [])[1]);
ok(f95MinTs === prevTs - SETTLE_OVERLAP_SECONDS,
  'collectResolutions honours explicit pre-sample since instead of overwritten next.meta.generated_at');

const directCalls = [];
const directClient = {
  base: 'https://example.invalid/trade-api/v2',
  async getJson(p) {
    directCalls.push(p);
    return {
      cursor: '',
      markets: [
        {
          ticker: 'KXAAAGASW-26NOV23-3.6400', event_ticker: 'KXAAAGASW-26NOV23',
          title: 'Will average gas prices be above $3.6400?',
          status: 'finalized', result: 'no', settlement_ts: '2026-11-23T15:06:33.579832Z',
          settlement_value_dollars: '0.0000', last_price_dollars: '0.0200', volume_fp: '51761.17',
        },
        {
          ticker: 'KXPGATOUR-THRC26-MPEN', event_ticker: 'KXPGATOUR-THRC26',
          title: 'The RSM Classic: Marco Penge wins',
          status: 'finalized', result: 'yes', settlement_ts: '2026-11-23T19:58:03.108438Z',
          settlement_value_dollars: '1.0000', last_price_dollars: '0.0630', volume_fp: '462081.71',
        },
        {
          ticker: 'DETERMINED-ONLY', event_ticker: 'DET-EV',
          title: 'In dispute timer', status: 'determined', result: 'yes',
          close_time: '2026-11-23T15:00:00Z', last_price_dollars: '0.9900',
        },
      ],
    };
  },
};
const directState = {
  alerts: [
    { ticker: 'KXAAAGASW-26NOV23-3.6400', ts: '2026-11-22T16:55:38Z', delta: -0.82 },
    { ticker: 'KXPGATOUR-THRC26-MPEN', ts: '2026-11-21T17:43:00Z', delta: 0.20 },
  ],
  resolutions: [],
  markets: {
    'KXAAAGASW-26NOV23-3.6400': {
      ticker: 'KXAAAGASW-26NOV23-3.6400', series_ticker: 'KXAAAGASW', topic: 'gas',
      close_time: '2026-11-23T04:59:00Z', expected_expiration_time: '2026-11-23T15:00:00Z', status: 'active',
    },
    'KXPGATOUR-THRC26-MPEN': {
      ticker: 'KXPGATOUR-THRC26-MPEN', series_ticker: 'KXPGATOUR', topic: 'golf',
      close_time: '2026-12-06T00:00:00Z', expected_expiration_time: '2026-11-22T00:00:00Z', status: 'active',
    },
    'DETERMINED-ONLY': {
      ticker: 'DETERMINED-ONLY', series_ticker: 'KXTEST', topic: 'crypto',
      close_time: '2026-11-23T15:00:00Z', status: 'active',
    },
    'STILL-OPEN': {
      ticker: 'STILL-OPEN', series_ticker: 'KXBTCY', topic: 'crypto',
      close_time: '2027-01-01T05:00:00Z', expected_expiration_time: '2027-01-01T05:00:00Z', status: 'active',
    },
  },
};
const directOut = await collectDirectResolutions(directClient, directState, {
  openTickers: new Set(['STILL-OPEN']),
  nowSeconds: Date.parse('2026-11-27T14:24:49Z') / 1000,
});
ok(directCalls.length === 1 && directCalls[0].startsWith('/markets?tickers=') && !directCalls[0].includes('status=') && !directCalls[0].includes('STILL-OPEN'),
  'collectDirectResolutions queries only overdue/alerted/missing-from-open tickers using unpaged plural tickers');
ok(directOut.resolutions.length === 2
  && directOut.resolutions.some((r) => r.ticker === 'KXAAAGASW-26NOV23-3.6400' && r.result === 'no' && r.settlement_value_dollars === '0.0000')
  && directOut.resolutions.some((r) => r.ticker === 'KXPGATOUR-THRC26-MPEN' && r.result === 'yes' && r.settlement_value_dollars === '1.0000'),
  'collectDirectResolutions recovers both overdue gas and early-closed golf settlements');
ok(directOut.resolutions.every((r) => r.source_url.startsWith('https://example.invalid/trade-api/v2/markets?tickers=')),
  'direct resolution rows carry the exact official plural-tickers endpoint URL');
ok(directOut.statusUpdates.length === 1 && directOut.statusUpdates[0].ticker === 'DETERMINED-ONLY' && directOut.statusUpdates[0].status === 'determined',
  'determined (non-finalized) markets remain pending and emit a truthful status update');

const dedupOut = await collectDirectResolutions(directClient, directState, {
  openTickers: new Set(['STILL-OPEN']),
  alreadyFound: new Set(['KXAAAGASW-26NOV23-3.6400', 'KXPGATOUR-THRC26-MPEN']),
  nowSeconds: Date.parse('2026-11-27T14:24:49Z') / 1000,
});
ok(dedupOut.resolutions.length === 0, 'collectDirectResolutions skips tickers already resolved by the series pass');

const bigRes = Array.from({ length: 120 }, (_, i) => ({
  ticker: i === 115 ? 'ALERTED-OLD' : `OTHER-${i}`,
  result: 'no',
  settlement_ts: `2026-11-${String(27 - Math.floor(i / 10)).padStart(2, '0')}T00:00:00Z`,
}));
const pub = publishedResolutions({ alerts: [{ ticker: 'ALERTED-OLD' }], resolutions: bigRes }, 100);
ok(pub.length === 100 && pub.some((r) => r.ticker === 'ALERTED-OLD'),
  'publishedResolutions retains resolved alerted tickers inside the 100-row feed slice so awaiting stays consistent');

if (fails.length) {
  console.error('\nRESOLUTION LOGIC TEST FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\nall resolution-logic assertions passed');
