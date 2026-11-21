/* paper.js — deterministic, dependency-free paper execution/accounting rules.
 * This is a PROJECT MODEL, not an exchange fill or a profitability prediction.
 * Official field semantics: https://docs.kalshi.com/api-reference/market/get-market
 * Complementary sizes/prices: https://docs.kalshi.com/getting_started/orderbook_responses
 * Final settlement: https://docs.kalshi.com/getting_started/market_lifecycle
 */
(function (root) {
  'use strict';
  var VERSION = 'observed-ask-v2';
  /* Project operating limits, NOT exchange limits or an account's balance. */
  var LIMITS = { quoteAgeMs: 15000, openPositions: 50, openCost: 1000, orderContracts: 1000 };

  function number(v) {
    if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function price(v) { var n = number(v); return n !== null && n > 0 && n < 1 ? n : null; }
  function round(v) { return Math.round((v + Number.EPSILON) * 100000000) / 100000000; }
  function official(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' && ['external-api.demo.kalshi.co', 'demo-api.kalshi.co'].indexOf(u.hostname) >= 0
        && /^\/trade-api\/v2\/markets(?:\/|\?|$)/.test(u.pathname + u.search) && !/[\u2026<>]/.test(url);
    } catch (e) { return false; }
  }
  function certified(t) {
    return !!t && t.execution_model === VERSION && t.simulated === true && ['yes', 'no'].indexOf(t.side) >= 0
      && price(t.price) !== null && Number.isSafeInteger(t.qty) && t.qty > 0 && t.qty <= LIMITS.orderContracts
      && t.quote && t.quote.ok === true && t.quote.qty === t.qty && t.quote.price === t.price
      && number(t.quote.available) >= t.qty && official(t.quote.source_url) && number(t.quote.observed_at) !== null;
  }
  function quote(m, side, qty, context) {
    context = context || {};
    var now = number(context.now);
    if (now === null) now = Date.now();
    function reject(reason) { return { ok: false, reason: reason }; }
    if (!m || ['live', 'legacy'].indexOf(context.mode) < 0 || m.data_mode !== 'live') {
      return reject('Waiting for a fresh public API quote. Snapshot data is view-only; no paper fill is assumed.');
    }
    if (m.status !== 'active') return reject('Market is not active. Closed, paused or determined markets cannot open a paper position.');
    if (m.market_type !== 'binary' || number(m.notional_value_dollars) !== 1) return reject('Only exchange-confirmed $1 binary contracts are supported by this simulator.');
    var observed = number(m.observed_at);
    if (observed === null || now < observed || now - observed > LIMITS.quoteAgeMs) return reject('Quote is stale or its observation time is unverified (15-second project limit).');
    if (['yes', 'no'].indexOf(side) < 0) return reject('Choose a YES or NO purchase.');
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > LIMITS.orderContracts) return reject('Contract count must be a positive whole number, at most 1,000 per paper order.');
    if (!official(m.source_url)) return reject('An exact official demo-market source URL is required.');

    var ask = price(side === 'yes' ? m.yes_ask_dollars : m.no_ask_dollars);
    var complement = price(side === 'yes' ? m.no_bid_dollars : m.yes_bid_dollars);
    var size = number(side === 'yes' ? m.yes_ask_size_fp : m.yes_bid_size_fp);
    if (ask === null) return reject('No executable ' + side.toUpperCase() + ' ask was published. Last trade and bid prices are never used as a buy fill.');
    if (complement !== null && Math.abs(ask + complement - 1) > 0.00010001) return reject('The quote contradicts binary bid/ask reciprocity; fill withheld for review.');
    var bid = price(side === 'yes' ? m.yes_bid_dollars : m.no_bid_dollars);
    if (bid !== null && bid > ask) return reject('The book is crossed; fill withheld for review.');
    /* A NO ask has the SAME quantity as the complementary YES bid. The API
     * publishes no no_ask_size_fp field; never substitute the NO bid's size. */
    if (side === 'no' && complement === null) return reject('The complementary YES bid needed to confirm NO ask size is unavailable.');
    if (size === null || size <= 0) return reject('Contracts available at this ask are unverified or zero; no fill is assumed.');
    var consumed = number(context.consumed) || 0;
    if (qty > size - consumed + 1e-9) return reject('Not enough observed contracts at this ask for the whole order. No partial or deeper-book fill is invented.');
    return { ok: true, price: ask, qty: qty, available: size, observed_at: observed,
      source_url: m.source_url, price_field: side + '_ask_dollars',
      size_field: side === 'yes' ? 'yes_ask_size_fp' : 'yes_bid_size_fp (complementary NO ask quantity)' };
  }
  function risk(trades, cost) {
    var open = (trades || []).filter(function (t) { return t && t.status === 'open'; });
    var total = open.reduce(function (sum, t) { return sum + ((number(t.price) || 0) * (number(t.qty) || 0)); }, 0);
    if (open.length >= LIMITS.openPositions) return 'Project paper-risk cap: at most 50 open positions.';
    if (total + cost > LIMITS.openCost + 1e-9) return 'Project paper-risk cap: at most $1,000 of open entry cost (not account cash).';
    return null;
  }
  function settlement(t, m) {
    if (!certified(t) || !m || m.status !== 'finalized' || m.market_type !== 'binary'
        || number(m.notional_value_dollars) !== 1 || ['yes', 'no'].indexOf(m.result) < 0 || !official(m.source_url)) return null;
    var payout = t.side === m.result ? 1 : 0;
    return { result: m.result, exit_price: payout, pnl: round((payout - t.price) * t.qty),
      settled_ts: m.settlement_ts || null, settlement_source_url: m.source_url };
  }
  function mark(t, m, now) {
    if (!certified(t) || !m || m.data_mode !== 'live' || m.status !== 'active') return null;
    var observed = number(m.observed_at);
    if (observed === null || now < observed || now - observed > LIMITS.quoteAgeMs) return null;
    var bid = price(t.side === 'yes' ? m.yes_bid_dollars : m.no_bid_dollars);
    var size = number(t.side === 'yes' ? m.yes_bid_size_fp : m.yes_ask_size_fp);
    if (bid === null || size === null || size < t.qty) return null;
    return { price: bid, pnl: round((bid - t.price) * t.qty) };
  }
  function isSettled(t) {
    return certified(t) && t.status === 'settled' && official(t.settlement_source_url)
      && ['yes', 'no'].indexOf(t.result) >= 0 && number(t.pnl) !== null
      && Math.abs(t.pnl - ((t.side === t.result ? 1 : 0) - t.price) * t.qty) <= 1e-7;
  }
  function stats(trades, markets, now) {
    now = number(now) === null ? Date.now() : now;
    var st = { realized: 0, wins: 0, losses: 0, breakeven: 0, open: 0, openExposure: 0,
      unrealized: 0, unpricedOpen: 0, excluded: 0, byStrategy: {}, byTopic: {} };
    function bucket(map, key) {
      if (!map[key]) map[key] = { label: key, trades: 0, wins: 0, losses: 0, breakeven: 0, pnl: 0, open: 0 };
      return map[key];
    }
    (trades || []).forEach(function (t) {
      if (!certified(t) || (t.status === 'settled' && !isSettled(t))) { st.excluded++; return; }
      var strategy = bucket(st.byStrategy, t.strategy || 'manual');
      var topic = bucket(st.byTopic, t.topic || 'unverified');
      if (t.status === 'settled') {
        /* Only this model's final settlements enter realised performance. */
        if (!official(t.settlement_source_url) || ['yes', 'no'].indexOf(t.result) < 0 || number(t.pnl) === null
            || Math.abs(t.pnl - ((t.side === t.result ? 1 : 0) - t.price) * t.qty) > 1e-7) { st.excluded++; return; }
        st.realized = round(st.realized + t.pnl);
        strategy.trades++; topic.trades++;
        strategy.pnl = round(strategy.pnl + t.pnl); topic.pnl = round(topic.pnl + t.pnl);
        var key = t.pnl > 0 ? 'wins' : t.pnl < 0 ? 'losses' : 'breakeven';
        st[key]++; strategy[key]++; topic[key]++;
      } else if (t.status === 'open') {
        st.open++; strategy.open++; topic.open++;
        st.openExposure = round(st.openExposure + t.price * t.qty);
        var current = mark(t, (markets || {})[t.ticker], now);
        if (!current) st.unpricedOpen++;
        else st.unrealized = round(st.unrealized + current.pnl);
      }
    });
    /* A partial sum is NOT the portfolio's P&L. Leave unknown valuation blank. */
    if (st.unpricedOpen) st.unrealized = null;
    st.winRate = st.wins + st.losses ? st.wins / (st.wins + st.losses) : null;
    return st;
  }
  var api = { VERSION: VERSION, LIMITS: LIMITS, number: number, quote: quote, risk: risk,
    certified: certified, isSettled: isSettled, settlement: settlement, mark: mark, stats: stats, official: official };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KDPaper = api;
})(typeof window !== 'undefined' ? window : globalThis);
