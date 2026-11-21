#!/usr/bin/env node
/** Offline regression tests. Test quotes below are SYNTHETIC fixtures, never published data. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../assets/paper.js');
let count = 0;
function test(label, fn) { fn(); count++; console.log('ok   ' + label); }
const now = Date.parse('2026-11-21T22:00:00Z');
const url = 'https://external-api.demo.kalshi.co/trade-api/v2/markets/FIXTURE';
const market = (patch = {}) => ({ ticker: 'FIXTURE', topic: 'crypto', data_mode: 'live', observed_at: now,
  status: 'active', market_type: 'binary', notional_value_dollars: 1,
  yes_bid_dollars: 0.6, yes_ask_dollars: 0.62, no_bid_dollars: 0.38, no_ask_dollars: 0.4,
  yes_bid_size_fp: 12, yes_ask_size_fp: 7, last_price_dollars: 0.61, source_url: url, ...patch });
const quote = (m = market(), side = 'yes', qty = 5, context = {}) => P.quote(m, side, qty, { now, mode: 'live', ...context });
const trade = (patch = {}) => ({ execution_model: P.VERSION, simulated: true, ticker: 'FIXTURE', topic: 'crypto',
  strategy: 'momentum', ts: new Date(now).toISOString(), qty: 5, side: 'no', price: 0.4, status: 'open', quote: quote(market(), 'no'), ...patch });

test('YES purchases use the ask, never last price or the bid', () => assert.equal(quote().price, 0.62));
test('NO purchases use the NO ask ($0.40), not the old erroneous NO bid ($0.38)', () => assert.equal(quote(market(), 'no').price, 0.4));
test('NO ask quantity is the complementary YES bid quantity', () => {
  assert.equal(quote(market(), 'no', 12).ok, true);
  assert.equal(quote(market(), 'no', 13).ok, false);
  assert.match(quote(market(), 'no').size_field, /yes_bid_size_fp/);
});
test('full requested YES count must fit at the observed ask', () => {
  assert.equal(quote(market(), 'yes', 7).ok, true);
  assert.equal(quote(market(), 'yes', 8).ok, false);
});
test('strategies share a quote-depth budget instead of each reusing the whole touch', () => assert.equal(quote(market(), 'yes', 5, { consumed: 3 }).ok, false));
for (const value of [null, undefined, '', ' ', NaN, Infinity, 'not a number', true]) {
  test('unconfirmed numeric field stays null: ' + String(value), () => assert.equal(P.number(value), null));
}
test('published zero stays zero (not confused with a missing field)', () => assert.equal(P.number('0.0000'), 0));
for (const bad of [0, -1, 1.5, NaN, Infinity, '5', 1001]) {
  test('invalid paper count rejected: ' + String(bad), () => assert.equal(quote(market(), 'yes', bad).ok, false));
}
for (const bad of [null, '', 0, 1]) {
  test('missing/boundary ask never falls back to last trade: ' + String(bad), () => assert.equal(quote(market({ yes_ask_dollars: bad })).ok, false));
}
for (const bad of [null, '', 0, -1]) {
  test('unknown or empty ask depth cannot support a fill: ' + String(bad), () => assert.equal(quote(market({ yes_ask_size_fp: bad })).ok, false));
}
test('snapshot, even recently loaded, is view-only', () => assert.equal(quote(market({ data_mode: 'snapshot' })).ok, false));
test('browser snapshot mode cannot record a live fill', () => assert.equal(quote(market(), 'yes', 5, { mode: 'snapshot' }).ok, false));
test('15-second operating freshness boundary is inclusive', () => {
  assert.equal(quote(market({ observed_at: now - 15000 })).ok, true);
  assert.equal(quote(market({ observed_at: now - 15001 })).ok, false);
});
test('future and unknown quote observation times rejected', () => {
  assert.equal(quote(market({ observed_at: now + 1 })).ok, false);
  assert.equal(quote(market({ observed_at: null })).ok, false);
});
for (const status of ['closed', 'determined', 'inactive', 'initialized', 'amended', 'disputed', 'finalized']) {
  test('no paper entry into non-active market: ' + status, () => assert.equal(quote(market({ status })).ok, false));
}
test('scalar/non-$1/unknown contract types cannot borrow the binary payout assumption', () => {
  for (const patch of [{ market_type: 'scalar' }, { market_type: null }, { notional_value_dollars: null }, { notional_value_dollars: 10 }]) {
    assert.equal(quote(market(patch)).ok, false);
  }
});
test('contradictory reciprocal quotes and crossed books rejected', () => {
  assert.equal(quote(market({ no_bid_dollars: 0.1 })).ok, false);
  assert.equal(quote(market({ yes_bid_dollars: 0.7 })).ok, false);
});
test('missing NO size corroboration never defaults to an inferred quantity', () => assert.equal(quote(market({ yes_bid_dollars: null }), 'no').ok, false));
test('source URL must be an exact official DEMO endpoint, not a placeholder or production host', () => {
  for (const source_url of ['', 'javascript:alert(1)', 'https://example.org/markets/X', url.replace('.demo.kalshi.co', '.kalshi.com'), url + '?tickers=…']) {
    assert.equal(quote(market({ source_url })).ok, false);
  }
});
test('project risk limits cap total open entries without pretending to know account cash', () => {
  assert.equal(P.risk(Array.from({ length: 50 }, () => trade()), 1) !== null, true);
  assert.equal(P.risk([trade({ qty: 1000, price: 0.99 })], 11) !== null, true);
  assert.equal(P.risk([], 10), null);
});
test('determined is NOT finalized; it can be disputed, so realised P&L stays open', () => assert.equal(P.settlement(trade(), market({ status: 'determined', result: 'yes' })), null));
test('finalized NO result pays a NO purchase $1, with exact gross P&L', () => {
  const settled = P.settlement(trade(), market({ status: 'finalized', result: 'no' }));
  assert.equal(settled.pnl, 3); assert.equal(settled.exit_price, 1); assert.equal(settled.settled_ts, null);
});
test('finalized YES result pays a NO purchase zero', () => assert.equal(P.settlement(trade(), market({ status: 'finalized', result: 'yes' })).pnl, -2));
test('unknown and scalar outcomes are never converted to yes/no', () => {
  for (const result of ['', null, 'scalar']) assert.equal(P.settlement(trade(), market({ status: 'finalized', result })), null);
});
test('legacy fills remain in history but cannot be certified retroactively', () => {
  assert.equal(P.certified(trade({ execution_model: undefined })), false);
  const stats = P.stats([trade({ execution_model: undefined, status: 'settled', pnl: 999 })], {}, now);
  assert.equal(stats.realized, 0); assert.equal(stats.excluded, 1);
});
test('NO valuation uses the NO bid, not the YES last price', () => assert.equal(P.mark(trade(), market(), now).pnl, -0.1));
test('unknown/unavailable exit depth leaves the WHOLE unrealised total unknown, not zero', () => {
  const stats = P.stats([trade()], { FIXTURE: market({ yes_ask_size_fp: null }) }, now);
  assert.equal(stats.unrealized, null); assert.equal(stats.unpricedOpen, 1);
});
test('final settlement accounting recomputes and validates rather than trusting stored P&L', () => {
  const closed = { ...trade(), ...P.settlement(trade(), market({ status: 'finalized', result: 'no' })), status: 'settled' };
  const stats = P.stats([closed, { ...closed, pnl: 100000 }], {}, now);
  assert.equal(stats.realized, 3); assert.equal(stats.wins, 1); assert.equal(stats.excluded, 1);
  assert.equal(stats.byTopic.crypto.pnl, 3); assert.equal(stats.byStrategy.momentum.trades, 1);
});
console.log(`\npaper model: ${count} regression cases passed. All test quotes are synthetic; no API orders sent.`);
