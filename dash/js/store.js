/* store.js — localStorage-backed state: paper trades, suggestion reviews, settings.
 * IMPORTANT: everything here is SIMULATED. Real demo-account trading requires API
 * credentials (docs.kalshi.com/getting_started/demo_env.md, api_keys.md) which this
 * static site cannot and must not handle. See questions.html. */
(function () {
  'use strict';
  var NS = 'kalshidash:v1:';

  function getJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function setJSON(key, val) {
    try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch (e) { console.warn('localStorage unavailable', e); }
  }

  /* ---------- paper trades ---------- */
  var STRATEGIES = [
    { id: 'hold-to-resolution', label: 'Hold to resolution', desc: 'Buy a side and hold until the market determines yes/no. Payout $1 per winning contract (docs: market_settlement).' },
    { id: 'momentum', label: 'Momentum', desc: 'Enter in the direction of recent price movement; exit on reversal or time stop.' },
    { id: 'mean-reversion', label: 'Mean reversion', desc: 'Fade extreme prices near 0 or 1 when liquidity is thin and the event is not resolved.' },
    { id: 'liquidity-provision', label: 'Liquidity provision', desc: 'Rest bids/asks inside the spread to earn the spread; inventory risk is the cost.' },
    { id: 'event-catalyst', label: 'Event catalyst', desc: 'Position ahead of a scheduled data release or event (e.g. AAA gas price publish, election certification).' }
  ];

  function seedTrades() {
    return [
      { id: 'seed-1', ts: '2026-11-20T10:15:00Z', ticker: 'KXDEMOFUTHOURLY-26NOV20H11-UP', title: 'Demo BTC at or above 61580.32 USD', topic: 'crypto', side: 'yes', price: 0.55, qty: 10, strategy: 'momentum', status: 'settled', result: 'yes', exit_price: 1, pnl: 4.50, fee: 0, seed: true },
      { id: 'seed-2', ts: '2026-11-20T10:40:00Z', ticker: 'KXDEMOFUTHOURLY-26NOV20H11-UP', title: 'Demo BTC at or above 61580.32 USD', topic: 'crypto', side: 'no', price: 0.40, qty: 5, strategy: 'mean-reversion', status: 'settled', result: 'yes', exit_price: 0, pnl: -2.00, fee: 0, seed: true },
      { id: 'seed-3', ts: '2026-11-19T14:02:00Z', ticker: 'KXAAAGASDSD-26NOV14-3.7400', title: 'Will average gas prices be above $3.7400?', topic: 'gas', side: 'no', price: 0.85, qty: 20, strategy: 'hold-to-resolution', status: 'settled', result: 'no', exit_price: 1, pnl: 3.00, fee: 0, seed: true },
      { id: 'seed-4', ts: '2026-11-18T16:45:00Z', ticker: 'KXELECTIONEMERGENCY-27JAN01', title: 'Trump executive action re: election emergency before Jan 1 2027', topic: 'elections', side: 'yes', price: 0.09, qty: 100, strategy: 'event-catalyst', status: 'open', result: '', exit_price: null, pnl: null, fee: 0, seed: true },
      { id: 'seed-5', ts: '2026-11-18T11:30:00Z', ticker: 'KXDEMOFUTHOURLY-26NOV20H12-UP', title: 'Demo BTC at or above 61985.83 USD', topic: 'crypto', side: 'yes', price: 0.35, qty: 30, strategy: 'liquidity-provision', status: 'open', result: '', exit_price: null, pnl: null, fee: 0, seed: true },
      { id: 'seed-6', ts: '2026-11-17T09:12:00Z', ticker: 'KXPGAR1T5-25NOV16-T5', title: 'PGA round-1 top-5 finish (example market)', topic: 'golf', side: 'yes', price: 0.20, qty: 25, strategy: 'hold-to-resolution', status: 'settled', result: 'no', exit_price: 0, pnl: -5.00, fee: 0, seed: true },
      { id: 'seed-7', ts: '2026-11-16T18:20:00Z', ticker: 'KXXBANNEDGROK-26', title: 'Will Grok be banned this year', topic: 'culture', side: 'no', price: 0.70, qty: 15, strategy: 'mean-reversion', status: 'open', result: '', exit_price: null, pnl: null, fee: 0, seed: true },
      { id: 'seed-8', ts: '2026-11-15T13:55:00Z', ticker: 'KXNEXTNATOSECGEN-99-KIOH', title: 'Will Klaus Iohannis be the next Secretary General of NATO?', topic: 'elections', side: 'yes', price: 0.03, qty: 50, strategy: 'liquidity-provision', status: 'settled', result: 'no', exit_price: 0, pnl: -1.50, fee: 0, seed: true }
    ];
  }

  function getTrades() {
    var t = getJSON('trades', null);
    if (!t) { t = seedTrades(); setJSON('trades', t); }
    return t;
  }
  function addTrade(tr) {
    var t = getTrades();
    tr.id = 'tr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    tr.ts = tr.ts || new Date().toISOString();
    tr.status = tr.status || 'open';
    tr.seed = false;
    t.unshift(tr);
    setJSON('trades', t);
    return tr;
  }
  function updateTrade(id, patch) {
    var t = getTrades().map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
    setJSON('trades', t);
    return t;
  }
  function settleTrades(marketResults) {
    /* marketResults: {ticker: 'yes'|'no'} — settles open paper trades against known results. */
    var changed = false;
    var t = getTrades().map(function (x) {
      if (x.status === 'open' && marketResults[x.ticker]) {
        var result = marketResults[x.ticker];
        var won = result === x.side;
        var exit = won ? 1 : 0;
        changed = true;
        return Object.assign({}, x, {
          status: 'settled', result: result, exit_price: exit,
          pnl: (exit - x.price) * x.qty - (x.fee || 0)
        });
      }
      return x;
    });
    if (changed) setJSON('trades', t);
    return changed;
  }

  function computeStats(trades) {
    var settled = trades.filter(function (t) { return t.status === 'settled'; });
    var open = trades.filter(function (t) { return t.status === 'open'; });
    var wins = settled.filter(function (t) { return t.pnl > 0; }).length;
    var realized = settled.reduce(function (a, t) { return a + (t.pnl || 0); }, 0);
    var openExposure = open.reduce(function (a, t) { return a + t.price * t.qty; }, 0);
    var fees = trades.reduce(function (a, t) { return a + (t.fee || 0); }, 0);
    return {
      total: trades.length, settled: settled.length, open: open.length,
      wins: wins, losses: settled.length - wins,
      winRate: settled.length ? wins / settled.length : null,
      realized: realized, openExposure: openExposure, fees: fees
    };
  }

  /* ---------- suggestions review ---------- */
  function getSuggestions() {
    var s = getJSON('suggestions', null);
    if (!s) {
      s = [
        { id: 'S-01', title: 'Wire real demo-account portfolio sync (requires user API keys)', impact: 'high', effort: 'medium', status: 'proposed',
          body: 'Portfolio, fills, and settlement tracking can be read live from GET /portfolio/balance, /positions, /fills, /settlements once demo API keys are provided by the account holder. The static site never handles credentials; a local runner (scripts/fetch_snapshot.mjs) can sync a signed data file instead.',
          rationale: 'Current portfolio page is SIMULATED only; real performance tracking was requested but needs credentials that cannot be requested or stored in this session.',
          source: 'https://docs.kalshi.com/getting_started/demo_env' },
        { id: 'S-02', title: 'Add WebSocket streaming once keys exist', impact: 'high', effort: 'medium', status: 'proposed',
          body: 'The dashboard currently polls public REST endpoints. The official WebSocket (wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2) requires an authenticated session even for public market-data channels (ticker, trade, market_lifecycle_v2). With keys, price ticks would land at sub-second cadence instead of 10s polls.',
          rationale: 'Verified in docs: WS session auth is required; public channels only skip per-channel authorization.',
          source: 'https://docs.kalshi.com/getting_started/quick_start_websockets' },
        { id: 'S-03', title: 'Server-side ranking of highest-dollar events', impact: 'high', effort: 'low', status: 'proposed',
          body: 'The demo API has no volume-sorted market listing (Get Markets sorts by creation time). A small scheduled job (GitHub Actions cron) could scan all open markets, rank events by dollar volume, and commit a JSON the site loads instantly — giving true "highest dollar" rankings without browser-side paging.',
          rationale: 'Verified from Get Markets doc: ordering rules do not include volume.',
          source: 'https://docs.kalshi.com/api-reference/market/get-markets' },
        { id: 'S-04', title: 'Track resolution watchlist with market_lifecycle notifications', impact: 'medium', effort: 'medium', status: 'proposed',
          body: 'Markets move through initialized → active → closed → determined → finalized. A watchlist page could poll status for tracked events and alert when result becomes yes/no, logging resolution time vs expected_expiration_time.',
          rationale: 'Lifecycle statuses verified in Get Market schema; tracking until resolution was an explicit requirement.',
          source: 'https://docs.kalshi.com/getting_started/market_lifecycle' },
        { id: 'S-05', title: 'Fee-aware P&L', impact: 'medium', effort: 'low', status: 'proposed',
          body: 'Paper P&L currently assumes zero fees. Series carry fee_type (quadratic etc.) and fee_multiplier; the fee schedule PDF is linked from the API. Applying documented fee math would sharpen strategy comparisons.',
          rationale: 'Fee fields verified in Get Series List schema; fee schedule referenced there.',
          source: 'https://docs.kalshi.com/api-reference/market/get-series-list' },
        { id: 'S-06', title: 'Candlestick backfill for week/month views', impact: 'medium', effort: 'low', status: 'proposed',
          body: 'Fetch 60m/1440m candlesticks on page load (permitted: 5,000 periods per request) so the 24h and 7d windows have full history immediately instead of only session-accumulated points.',
          rationale: 'Verified in Get Market Candlesticks doc.',
          source: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks' },
        { id: 'S-07', title: 'Liquidity score per event', impact: 'medium', effort: 'low', status: 'proposed',
          body: 'Combine best bid/ask size and full orderbook depth into a single liquidity score per market ("contracts available at a price" is already shown on the ladder). Rank events by liquidity as well as volume to avoid entering illiquid strikes.',
          rationale: 'Orderbook depth endpoint verified; sizes at best bid/ask verified in market schema.',
          source: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook' },
        { id: 'S-08', title: 'Category mapping cleanup for "culture"', impact: 'low', effort: 'low', status: 'proposed',
          body: 'Kalshi\'s API category "Culture" currently lists only X-ban series; entertainment/culture-adjacent products live under "Entertainment" and "Mentions". A mapping table (documented on api.html) keeps the user-facing topic stable as Kalshi re-categorizes.',
          rationale: 'Verified live: /series?category=Culture returned 2 series; "Entertainment" and "Mentions" are separate categories.',
          source: 'https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture&limit=50' }
      ];
      setJSON('suggestions', s);
    }
    return s;
  }
  function updateSuggestion(id, patch) {
    var s = getSuggestions().map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
    setJSON('suggestions', s);
    return s;
  }

  window.Store = {
    getJSON: getJSON, setJSON: setJSON,
    getTrades: getTrades, addTrade: addTrade, updateTrade: updateTrade, settleTrades: settleTrades,
    computeStats: computeStats, STRATEGIES: STRATEGIES,
    getSuggestions: getSuggestions, updateSuggestion: updateSuggestion
  };
})();
