/* app.js — KalshiDash1 runtime.
 *
 * Everything in this file is dependency-free and runs in the visitor's browser.
 * It talks to the official Kalshi DEMO Trade API over public (unauthenticated)
 * endpoints and falls back to the bundled, verified snapshot in data/snapshot.json
 * when the browser cannot reach the API (offline, network policy or CORS).
 *
 * IMPORTANT: the Kalshi WebSocket endpoint requires API-key authentication
 * (docs.kalshi.com/websockets/websocket-connection.md), so the live alert feed
 * here is REST-polled. REST responses are cached server-side for a few seconds,
 * so quotes can lag the exchange slightly.
 */
(function () {
  'use strict';

  /* Page-depth-aware site root. app.js always lives in <root>/assets/, so its own script
   * URL tells us where the site root is. Pages under subdirectories (categories/*.html)
   * must load data/snapshot.json and link market.html relative to the root, not to their
   * own folder — a bare 'data/snapshot.json' resolves to categories/data/snapshot.json
   * there and 404s, which used to wipe the baked fallback rows. */
  var APP_ROOT = '';
  try {
    var s = document.currentScript;
    if (s && s.src) APP_ROOT = new URL('../', s.src).href;
  } catch (e) { APP_ROOT = ''; }
  function rootHref(p) { return APP_ROOT + p; }

  /* ==================================================================== config */
  var CFG = {
    endpoints: {
      primary: 'https://external-api.demo.kalshi.co/trade-api/v2',
      legacy: 'https://demo-api.kalshi.co/trade-api/v2',
      wsPrimary: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
      wsLegacy: 'wss://demo-api.kalshi.co/trade-api/ws/v2',
      web: 'https://demo.kalshi.co'
    },
    docs: {
      demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
      environments: 'https://docs.kalshi.com/getting_started/api_environments',
      marketData: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
      auth: 'https://docs.kalshi.com/getting_started/quick_start_authenticated_requests',
      apiKeys: 'https://docs.kalshi.com/getting_started/api_keys',
      settlement: 'https://docs.kalshi.com/getting_started/market_settlement',
      lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
      rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits',
      fixedPoint: 'https://docs.kalshi.com/getting_started/fixed_point_migration',
      series: 'https://docs.kalshi.com/api-reference/market/get-series-list',
      markets: 'https://docs.kalshi.com/api-reference/market/get-markets',
      market: 'https://docs.kalshi.com/api-reference/market/get-market',
      orderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
      candlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
      events: 'https://docs.kalshi.com/api-reference/events/get-events',
      createOrder: 'https://docs.kalshi.com/api-reference/orders/create-order-v2',
      balance: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
      positions: 'https://docs.kalshi.com/api-reference/portfolio/get-positions',
      websocket: 'https://docs.kalshi.com/websockets/websocket-connection'
    },
    topics: [
      { id: 'gas', label: 'Gas Prices', color: '#f5a524',
        query: '/series?category=Economics&tags=Oil%20and%20energy&include_volume=true',
        rule: 'Series whose ticker starts with KXAAAGAS, or whose title contains "gas price". All settle against AAA (gasprices.aaa.com).' },
      { id: 'elections', label: 'Elections', color: '#4c9aff',
        query: '/series?category=Elections&include_volume=true',
        rule: 'Every series whose categories list contains "Elections".' },
      { id: 'culture', label: 'Culture', color: '#a78bfa',
        query: '/series?category=Culture&include_volume=true',
        rule: 'Every series whose categories list contains "Culture".' },
      { id: 'crypto', label: 'Crypto', color: '#ffb020',
        query: '/series?category=Crypto&include_volume=true',
        rule: 'Every series whose categories list contains "Crypto".' },
      { id: 'golf', label: 'Golf', color: '#35d07f',
        query: '/series?category=Sports&tags=Golf&include_volume=true',
        rule: 'Category "Sports" filtered by the official tag "Golf" (GET /search/tags_by_categories).' }
    ],
    /* Live swing-alert threshold in dollars (the brief asks for >= $0.10). */
    swingThreshold: 0.10,
    pollMs: 5000,
    maxTracked: 45,
    seriesPerTopic: 6,
    /* ROI model weights (sum = 1). Documented on strategies.html. */
    roiWeights: { liquidity: 0.26, depth: 0.16, tightness: 0.22, volume: 0.14, volatility: 0.22 },
    roiCut: 55,
    autoTrade: true,
    contractSize: 10
  };

  var PAPER = window.KDPaper;
  function nullableNumber(v) {
    if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null;
    return Number.isFinite(Number(v)) ? Number(v) : null;
  }

  var STRATEGIES = [
    { id: 'momentum', label: 'Momentum',
      rule: 'Buy YES after a rise of at least $0.05 over the last 3 observations; buy NO after an equivalent fall. Hold to final settlement.' },
    { id: 'mean-reversion', label: 'Mean reversion',
      rule: 'Buy YES when the price is at or below $0.25 and the last move was down; buy NO when the price is at or above $0.75 and the last move was up.' },
    { id: 'favorite', label: 'Favorite (liquidity)',
      rule: 'Buy YES in the most liquid market of the topic when its ROI score is at least 70 and the price is at least $0.80.' },
    { id: 'longshot', label: 'Low-YES NO buyer',
      rule: 'Buy NO when the YES reference is at or below $0.15 and the score is at least 60. This is not cheap NO optionality. Hold to final settlement.' },
    { id: 'catalyst', label: 'Volume catalyst',
      rule: 'Buy YES in a market whose 24h contract volume is at least 5x its total open interest and whose ROI score is at least 60.' }
  ];

  /* ==================================================================== utils */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, dp) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp === undefined ? 0 : dp });
  }
  function usd(v, dp) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: dp === undefined ? 2 : dp, maximumFractionDigits: dp === undefined ? 2 : dp });
  }
  function cents(v) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
    return '$' + Number(v).toFixed(4);
  }
  function pct(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (Number(v) * 100).toFixed(dp === undefined ? 1 : dp) + '%';
  }
  function clock(sec) {
    var d = new Date(sec * 1000);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0');
  }
  function dt(iso) {
    if (!iso) return '—';
    return String(iso).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '') + ' UTC';
  }
  function topicOf(id) {
    for (var i = 0; i < CFG.topics.length; i++) if (CFG.topics[i].id === id) return CFG.topics[i];
    return { id: id, label: id, color: '#7b8a9c' };
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  /* Table body by id: the id may sit on the <tbody> itself or on a wrapper/table that contains it. */
  function tbodyOf(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    return el.tagName === 'TBODY' ? el : el.querySelector('tbody');
  }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ================================================================ settings */
  var SET_KEY = 'kalshidash:v1:settings';
  var defaults = {
    threshold: CFG.swingThreshold,
    roiCut: CFG.roiCut,
    pollMs: CFG.pollMs,
    autoTrade: CFG.autoTrade,
    contracts: CFG.contractSize,
    strategies: STRATEGIES.reduce(function (o, s) { o[s.id] = true; return o; }, {})
  };
  function settings() {
    var s = Object.assign({}, defaults);
    try {
      var raw = localStorage.getItem(SET_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        Object.keys(p).forEach(function (k) { s[k] = p[k]; });
        s.strategies = Object.assign({}, defaults.strategies, p.strategies || {});
      }
    } catch (e) { /* storage unavailable — defaults are fine */ }
    return s;
  }
  function saveSettings(patch) {
    var s = settings();
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return s;
  }

  /* ================================================================== trades */
  var TRADES_KEY = 'kalshidash:v1:trades';
  function getTrades() {
    try { var trades = JSON.parse(localStorage.getItem(TRADES_KEY) || '[]'); return Array.isArray(trades) ? trades.filter(function (t) { return t && typeof t === 'object'; }) : []; } catch (e) { return []; }
  }
  function setTrades(t) { try { localStorage.setItem(TRADES_KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } }

  /* ================================================================== alerts */
  var ALERTS_KEY = 'kalshidash:v1:alerts';
  function getAlerts() {
    try { var rows = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); return Array.isArray(rows) ? rows.filter(function (a) { return a && typeof a === 'object'; }) : []; } catch (e) { return []; }
  }
  function setAlerts(a) {
    if (a.length > 400) a = a.slice(a.length - 400);
    try { localStorage.setItem(ALERTS_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ }
  }

  /* ===================================================================== api */
  var state = {
    mode: 'probing',            // 'live' | 'legacy' | 'snapshot'
    base: CFG.endpoints.primary,
    snapshot: null,
    snapshotError: null,
    markets: {},                // ticker -> market row
    orderbooks: {},             // ticker -> {yes_dollars, no_dollars, source_url}
    seriesByTopic: {},
    settlementSources: {},      // series_ticker -> [{name,url}]
    lastRef: {},                // ticker -> last reference price
    history: {},                // ticker -> [{t,v}] rolling price history
    status: {},                 // ticker -> last seen status
    pollTimer: null,
    universeTimer: null,
    listeners: [],
    lastError: null,
    lastRefresh: null,
    charts: {},                 // ticker -> {points, candles}
    alerts: [],                 // in-memory alert log (session)
    seenAlerts: {},             // dedupe key -> ts
    quoteUsed: {},               // ticker+side -> consumption within a single observed quote
    paperStatus: 'Waiting for a fresh live quote with confirmed ask quantity.',
    pollInFlight: false
  };

  function emit(evt) { state.listeners.forEach(function (fn) { try { fn(evt, state); } catch (e) { console.error(e); } }); }

  function fetchJSON(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 9000);
    return fetch(url, ctrl ? { signal: ctrl.signal, headers: { accept: 'application/json' } } : { headers: { accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
        return res.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  function apiGet(p) { return fetchJSON(state.base + p); }

  function probe() {
    var bases = [CFG.endpoints.primary, CFG.endpoints.legacy];
    function attempt(i) {
      if (i >= bases.length) {
        state.mode = 'snapshot';
        state.lastError = 'The demo API could not be reached from this browser (network policy or CORS).';
        emit('mode');
        return Promise.resolve(false);
      }
      state.base = bases[i];
      return fetchJSON(bases[i] + '/exchange/status', 7000)
        .then(function () {
          state.mode = (i === 0) ? 'live' : 'legacy';
          emit('mode');
          return true;
        })
        .catch(function () { return attempt(i + 1); });
    }
    return attempt(0);
  }

  function loadSnapshot() {
    if (state.snapshot) return Promise.resolve(state.snapshot);
    return fetchJSON(rootHref('data/snapshot.json'), 12000)
      .then(function (snap) {
        state.snapshot = snap;
        ingestSnapshot(snap);
        return snap;
      })
      .catch(function (e) { state.snapshotError = e.message; return null; });
  }

  function normMarket(m, topic, sourceUrl, seriesTicker, settlementSources) {
    return {
      ticker: m.ticker || null,
      event_ticker: m.event_ticker || null,
      title: m.title || m.yes_sub_title || m.ticker || '',
      yes_sub_title: m.yes_sub_title || null,
      topic: topic || null,
      series_ticker: seriesTicker || null,
      settlement_sources: settlementSources || [],
      market_type: m.market_type || null,
      data_mode: 'live',
      observed_at: Date.now(),   // local API-response observation, NOT a trade timestamp
      status: m.status || null,
      result: (m.result && m.result !== '') ? m.result : null,
      last_price_dollars: nullableNumber(m.last_price_dollars),
      previous_price_dollars: nullableNumber(m.previous_price_dollars),
      yes_bid_dollars: nullableNumber(m.yes_bid_dollars),
      yes_ask_dollars: nullableNumber(m.yes_ask_dollars),
      no_bid_dollars: nullableNumber(m.no_bid_dollars),
      no_ask_dollars: nullableNumber(m.no_ask_dollars),
      yes_bid_size_fp: nullableNumber(m.yes_bid_size_fp),
      yes_ask_size_fp: nullableNumber(m.yes_ask_size_fp),
      volume_fp: nullableNumber(m.volume_fp),
      volume_24h_fp: nullableNumber(m.volume_24h_fp),
      open_interest_fp: nullableNumber(m.open_interest_fp),
      notional_value_dollars: nullableNumber(m.notional_value_dollars),
      close_time: m.close_time || null,
      expected_expiration_time: m.expected_expiration_time || null,
      latest_expiration_time: m.latest_expiration_time || null,
      settlement_ts: m.settlement_ts || null,
      settlement_value_dollars: nullableNumber(m.settlement_value_dollars),
      rules_primary: m.rules_primary || '',
      source_url: sourceUrl || null
    };
  }

  function ingestSnapshot(snap) {
    if (!snap) return;
    (snap.markets || []).forEach(function (m) {
      if (state.markets[m.ticker] && state.markets[m.ticker].data_mode === 'live') return;
      var capturedAt = Date.parse(snap.meta && snap.meta.captured_at);
      state.markets[m.ticker] = Object.assign({}, m, { data_mode: 'snapshot', observed_at: Number.isFinite(capturedAt) ? capturedAt : null });
      if (m.last_price_dollars !== null && m.last_price_dollars !== undefined) {
        state.lastRef[m.ticker] = m.last_price_dollars;
        state.history[m.ticker] = Number.isFinite(capturedAt) ? [{ t: Math.floor(capturedAt / 1000), v: m.last_price_dollars, source_url: m.source_url, basis: 'snapshot observation' }] : [];
      }
      if (m.status) state.status[m.ticker] = m.status;
      if (m.series_ticker && m.settlement_sources) state.settlementSources[m.series_ticker] = m.settlement_sources;
    });
    Object.keys(snap.orderbooks || {}).forEach(function (t) {
      state.orderbooks[t] = Object.assign({}, snap.orderbooks[t], { data_mode: 'snapshot', observed_at: Date.parse(snap.meta && snap.meta.captured_at) || null });
    });
    Object.keys(snap.topics || {}).forEach(function (tid) {
      var t = snap.topics[tid];
      state.seriesByTopic[tid] = t.series || [];
      (t.series || []).forEach(function (s) {
        if (s.ticker) state.settlementSources[s.ticker] = s.settlement_sources || [];
      });
    });
    state.snapshotMarkets = (snap.markets || []).slice();
    seedAlertsFromSnapshot(snap);
  }

  /* Reconstruct the swing alerts that the captured 1-minute candles imply, so the
   * two chat panes still show real, sourced moves when the browser cannot reach
   * the live API. These messages are labelled "snapshot replay". */
  function seedAlertsFromSnapshot(snap) {
    if (!snap || !snap.candlesticks) return;
    var existing = getAlerts();
    if (existing.length) { state.alerts = existing; return; }
    var s = settings();
    var seeded = [];
    Object.keys(snap.candlesticks).forEach(function (ticker) {
      var m = state.markets[ticker];
      var candles = (snap.candlesticks[ticker].m1 || {}).candles || [];
      for (var i = 1; i < candles.length; i++) {
        var from = nullableNumber(candles[i - 1][1]), to = nullableNumber(candles[i][1]);
        if (from === null || to === null || from < 0 || from > 1 || to < 0 || to > 1) continue;
        var delta = to - from;
        if (Math.round(Math.abs(delta) * 10000) < Math.round(s.threshold * 10000)) continue;
        seeded.push({
          id: 'seed-' + ticker + '-' + i,
          type: 'swing', ts: Number(candles[i][0]),
          ticker: ticker, topic: m ? m.topic : null,
          title: m ? m.title : ticker,
          from: from, to: to, delta: delta,
          roi: null, // no bid/ask/size evidence at this historical candle time; never backfill today's score
          roiParts: null,
          links: m ? candidateLinks(m) : [],
          source_url: (snap.candlesticks[ticker].m1 || {}).source_url || null,
          replay: true
        });
      }
    });
    seeded.sort(function (a, b) { return a.ts - b.ts; });
    seeded = seeded.slice(-120);
    state.alerts = seeded;
    setAlerts(seeded);
  }

  /* Refresh the tracked universe from the live API (series + open markets). */
  function refreshUniverse() {
    if (state.mode === 'snapshot') return Promise.resolve([]);
    var all = [];
    var chain = Promise.resolve();
    CFG.topics.forEach(function (topic) {
      chain = chain.then(function () {
        return apiGet(topic.query).catch(function () { return { series: [] }; }).then(function (res) {
          var kept = (res.series || []).filter(function (s) {
            if (topic.id === 'gas') return /^KXAAAGAS/.test(s.ticker || '') || /gas price/i.test(s.title || '');
            if (topic.id === 'golf') return (s.tags || []).includes('Golf');
            return true;
          });
          kept.sort(function (a, b) { return (Number(b.volume_fp) || 0) - (Number(a.volume_fp) || 0); });
          kept = kept.slice(0, CFG.seriesPerTopic);
          state.seriesByTopic[topic.id] = kept.map(function (s) {
            state.settlementSources[s.ticker] = s.settlement_sources || [];
            s.source_url = state.base + topic.query;
            return s;
          });
          var inner = Promise.resolve();
          kept.forEach(function (s) {
            inner = inner.then(function () {
              return apiGet('/markets?series_ticker=' + encodeURIComponent(s.ticker) + '&status=open&limit=200')
                .catch(function () { return { markets: [] }; })
                .then(function (r) {
                  (r.markets || []).forEach(function (m) {
                    all.push(normMarket(m, topic.id, state.base + '/markets?series_ticker=' + encodeURIComponent(s.ticker) + '&status=open&limit=200', s.ticker, s.settlement_sources || []));
                  });
                });
            });
          });
          return inner;
        });
      });
    });
    return chain.then(function () {
      all.forEach(function (m) {
        state.markets[m.ticker] = m;
        if (state.lastRef[m.ticker] === undefined && m.last_price_dollars !== null) {
          state.lastRef[m.ticker] = m.last_price_dollars;
        }
      });
      emit('universe');
      return all;
    });
  }

  /* ----------------------------------------------------------- price polling */
  function trackedTickers() {
    var ids = Object.keys(state.markets).filter(function (t) {
      return state.markets[t].status !== 'finalized';
    });
    getTrades().forEach(function (t) { if (t.status === 'open' && t.ticker && ids.indexOf(t.ticker) < 0) ids.push(t.ticker); });
    return ids;
  }

  function pollPrices() {
    if (state.mode === 'snapshot' || state.pollInFlight) return Promise.resolve(null);
    var tickers = trackedTickers();
    if (!tickers.length) return Promise.resolve(null);
    state.pollInFlight = true;
    var chunks = [];
    for (var i = 0; i < tickers.length; i += 40) chunks.push(tickers.slice(i, i + 40));
    return Promise.all(chunks.map(function (chunk) {
      var url = state.base + '/markets?tickers=' + encodeURIComponent(chunk.join(','));
      return fetchJSON(url).then(function (r) { return { data: r, url: url }; })
        .catch(function (e) { return { error: e.message }; });
    })).then(function (responses) {
      var swings = [], received = 0, errors = [];
      responses.forEach(function (response) {
        if (response.error) { errors.push(response.error); return; }
        (response.data.markets || []).forEach(function (m) {
          var prev = state.markets[m.ticker];
          var stored = prev || getTrades().filter(function (t) { return t.ticker === m.ticker; })[0] || {};
          var row = normMarket(m, stored.topic, response.url, stored.series_ticker, stored.settlement_sources);
          if (!prev || prev.data_mode !== 'live') state.lastRef[m.ticker] = refPrice(row);
          var swing = detectSwing(m.ticker, row);
          if (swing) swings.push(swing);
          var resolved = detectResolution(m.ticker, row);
          if (resolved) swings.push(resolved);
          state.markets[m.ticker] = row;
          received++;
        });
      });
      state.lastError = errors.length ? errors.length + ' market request(s) failed. Older quotes remain timestamped; stale paper fills are blocked.' : (received ? null : 'No market quotes returned.');
      if (received) state.lastRefresh = Date.now();
      emit('poll');
      swings.forEach(function (s) { handleSwing(s); });
      return received ? swings : null;
    }).finally(function () { state.pollInFlight = false; });
  }

  /* Reference price = last trade price, or the mid of the touch when there is no trade. */
  function refPrice(m) {
    if (m.last_price_dollars !== null && m.last_price_dollars !== undefined && m.last_price_dollars > 0) return m.last_price_dollars;
    if (m.yes_bid_dollars !== null && m.yes_ask_dollars !== null && m.yes_bid_dollars > 0 && m.yes_ask_dollars > 0) {
      return (m.yes_bid_dollars + m.yes_ask_dollars) / 2;
    }
    return null;
  }
  function midPrice(m) {
    if (m.yes_bid_dollars !== null && m.yes_ask_dollars !== null && m.yes_bid_dollars > 0 && m.yes_ask_dollars > 0) {
      return (m.yes_bid_dollars + m.yes_ask_dollars) / 2;
    }
    return null;
  }

  function detectSwing(ticker, m) {
    var ref = refPrice(m);
    if (ref === null) return null;
    var prev = state.lastRef[ticker];
    state.lastRef[ticker] = ref;
    var mid = midPrice(m);
    var hist = state.history[ticker] || (state.history[ticker] = []);
    hist.push({ t: Math.floor(Date.now() / 1000), v: ref, source_url: m.source_url, basis: 'browser poll observation' });
    if (hist.length > 4000) hist.splice(0, hist.length - 4000);
    if (prev === undefined || prev === null) return null;

    var s = settings();
    var dTrade = ref - prev;
    if (Math.round(Math.abs(dTrade) * 10000) < Math.round(s.threshold * 10000)) return null;

    var key = ticker + '|' + (dTrade > 0 ? 'up' : 'down');
    var now = Date.now();
    if (state.seenAlerts[key] && now - state.seenAlerts[key] < 60000) return null;
    state.seenAlerts[key] = now;

    return {
      type: 'swing', ticker: ticker, market: m,
      from: prev, to: ref, delta: dTrade,
      ts: Math.floor(now / 1000)
    };
  }

  function detectResolution(ticker, m) {
    var previous = state.status[ticker];
    if (m.status) state.status[ticker] = m.status;
    if (m.status === 'finalized' && previous !== 'finalized' && (m.result === 'yes' || m.result === 'no')) {
      return { type: 'resolve', ticker: ticker, market: m, result: m.result, ts: Math.floor(Date.now() / 1000) };
    }
    return null;
  }

  /* ================================================================= ROI model */
  /* Transparent heuristic. Every component is derived from fields the Kalshi API
   * returns, and the weights are published on strategies.html. */
  function bookDepth(ticker) {
    var ob = state.orderbooks[ticker];
    if (!ob) return null;
    var total = 0;
    (ob.yes_dollars || []).forEach(function (l) { total += Number(l[1]) || 0; });
    (ob.no_dollars || []).forEach(function (l) { total += Number(l[1]) || 0; });
    return total;
  }
  function roiOf(m) {
    var w = CFG.roiWeights;
    var spread = (m.yes_ask_dollars !== null && m.yes_bid_dollars !== null && m.yes_ask_dollars > 0 && m.yes_bid_dollars > 0)
      ? (m.yes_ask_dollars - m.yes_bid_dollars) : null;
    var touchSize = (m.yes_bid_size_fp || 0) + (m.yes_ask_size_fp || 0);
    var depth = bookDepth(m.ticker);
    var ref = refPrice(m);
    var hist = state.history[m.ticker] || [];
    var vol = hist.length >= 2 ? Math.abs(hist[hist.length - 1].v - hist[hist.length - 2].v) : 0;

    var parts = {
      liquidity: clamp01(touchSize / 300),
      depth: depth === null ? 0 : clamp01(depth / 1200),
      tightness: spread === null ? 0 : clamp01(1 - spread / 0.10),
      volume: clamp01((m.volume_24h_fp || 0) / 20000),
      volatility: clamp01(vol / 0.30)
    };
    var score = 0;
    Object.keys(w).forEach(function (k) { score += w[k] * parts[k]; });
    // Project eligibility gate: an unconfirmed, one-sided or contradictory touch is not high ROI.
    var eligible = m.status === 'active' && m.yes_bid_dollars > 0 && m.yes_ask_dollars < 1
      && spread !== null && spread >= 0 && m.yes_bid_size_fp > 0 && m.yes_ask_size_fp > 0
      && (m.no_bid_dollars === null || Math.abs(m.yes_ask_dollars + m.no_bid_dollars - 1) <= 0.00010001)
      && (m.no_ask_dollars === null || Math.abs(m.yes_bid_dollars + m.no_ask_dollars - 1) <= 0.00010001);
    return { score: eligible ? Math.round(score * 100) : Math.min(30, Math.round(score * 100)),
      eligible: eligible, parts: parts, spread: spread, touchSize: touchSize, depth: depth, ref: ref };
  }

  /* ============================================================== alert feed */
  function candidateLinks(m) {
    var links = [];
    if (m.ticker) links.push({ label: 'Kalshi market', url: CFG.endpoints.web + '/markets/' + encodeURIComponent(m.ticker) });
    if (m.event_ticker) links.push({ label: 'Event ' + m.event_ticker, url: CFG.endpoints.web + '/markets/' + encodeURIComponent(m.event_ticker) });
    (m.settlement_sources || []).slice(0, 4).forEach(function (s) {
      if (s && s.url) links.push({ label: s.name || 'Official source', url: s.url });
    });
    if (m.source_url) links.push({ label: 'API row', url: m.source_url });
    return links;
  }

  function handleSwing(s) {
    var m = s.market;
    var roi = roiOf(m);
    var msg = {
      id: 'a' + Date.now() + Math.random().toString(36).slice(2, 7),
      type: s.type,
      ts: s.ts,
      ticker: s.ticker,
      topic: m.topic,
      title: m.title,
      from: s.from, to: s.to, delta: s.delta,
      result: s.result || null,
      roi: roi.score,
      roiParts: roi.parts,
      roiEligible: roi.eligible,
      links: candidateLinks(m),
      source_url: m.source_url || null
    };
    state.alerts.push(msg);
    setAlerts(state.alerts);
    emit('alert', msg);
  }

  /* ============================================================ paper trading */
  function openTrades() { return getTrades().filter(function (t) { return t.status === 'open'; }); }

  function recordPaperTrade(m, side, qty, strategy, why, trades) {
    trades = trades || getTrades();
    if (!PAPER) return { ok: false, reason: 'Paper execution module unavailable; no fill recorded.' };
    var key = m.ticker + '|' + side;
    var used = state.quoteUsed[key];
    var consumed = used && used.observed_at === m.observed_at ? used.qty : 0;
    var fill = PAPER.quote(m, side, qty, { now: Date.now(), mode: state.mode, consumed: consumed });
    if (!fill.ok) { state.paperStatus = fill.reason; return fill; }
    var risk = PAPER.risk(trades, fill.price * qty);
    if (risk) { state.paperStatus = risk; return { ok: false, reason: risk }; }
    var trade = {
      id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7), ts: new Date().toISOString(),
      ticker: m.ticker, title: m.title, topic: m.topic, series_ticker: m.series_ticker,
      side: side, price: fill.price, qty: qty, strategy: strategy, status: 'open',
      result: null, exit_price: null, pnl: null, roi: roiOf(m).score, why: why,
      simulated: true, execution_model: PAPER.VERSION, quote: fill, source_url: fill.source_url,
      assumptions: 'Observed ask and whole size only; no exchange execution, trading fees, queue, impact or latency model.'
    };
    trades.push(trade);
    state.quoteUsed[key] = { observed_at: m.observed_at, qty: consumed + qty };
    state.paperStatus = 'Paper model running on fresh quotes. No order sent; gross results exclude fees and market impact.';
    return { ok: true, trade: trade };
  }

  function autoTradeStep() {
    var s = settings();
    if (!s.autoTrade || !PAPER) return;
    var trades = getTrades(), before = trades.length, openKeys = {}, favorites = {};
    trades.forEach(function (t) { if (t.status === 'open') openKeys[t.ticker + '|' + t.strategy] = true; });
    Object.keys(state.markets).forEach(function (ticker) {
      var m = state.markets[ticker];
      if (m.status !== 'active') return;
      var current = favorites[m.topic];
      if (!current || roiOf(m).touchSize > roiOf(current).touchSize) favorites[m.topic] = m;
    });
    STRATEGIES.forEach(function (strat) {
      if (!s.strategies[strat.id]) return;
      Object.keys(state.markets).forEach(function (ticker) {
        var m = state.markets[ticker];
        if (!m || m.status !== 'active' || !CFG.topics.some(function (t) { return t.id === m.topic; })) return;
        if (openKeys[ticker + '|' + strat.id]) return;
        var ref = refPrice(m), hist = state.history[ticker] || [], roi = roiOf(m), signal = null;
        if (ref === null || ref <= 0 || ref >= 1) return;
        if (strat.id === 'momentum' && hist.length >= 3) {
          var d = ref - hist[hist.length - 3].v;
          if (d >= 0.05) signal = { side: 'yes', why: 'up ' + d.toFixed(2) + ' over 3 observations' };
          else if (d <= -0.05) signal = { side: 'no', why: 'down ' + Math.abs(d).toFixed(2) + ' over 3 observations' };
        } else if (strat.id === 'mean-reversion') {
          var lastMove = hist.length >= 2 ? ref - hist[hist.length - 2].v : 0;
          if (ref <= 0.25 && lastMove < 0) signal = { side: 'yes', why: 'low YES reference and falling' };
          else if (ref >= 0.75 && lastMove > 0) signal = { side: 'no', why: 'high YES reference and rising' };
        } else if (strat.id === 'favorite' && favorites[m.topic] === m && roi.score >= 70 && ref >= 0.80) {
          signal = { side: 'yes', why: 'largest observed touch in topic, score ' + roi.score };
        } else if (strat.id === 'longshot' && ref <= 0.15 && roi.score >= 60) {
          signal = { side: 'no', why: 'low YES reference, score ' + roi.score };
        } else if (strat.id === 'catalyst' && m.open_interest_fp > 0 && m.volume_24h_fp / m.open_interest_fp >= 5 && roi.score >= 60) {
          signal = { side: 'yes', why: '24h contracts >= 5x open interest, score ' + roi.score };
        }
        if (!signal) return;
        var result = recordPaperTrade(m, signal.side, Number(s.contracts), strat.id, signal.why, trades);
        if (result.ok) openKeys[ticker + '|' + strat.id] = true;
      });
    });
    if (trades.length !== before) { setTrades(trades); emit('trades'); }
  }

  function settleTrades() {
    if (!PAPER) return;
    var trades = getTrades(), changed = false;
    trades.forEach(function (t) {
      if (t.status !== 'open') return;
      var result = PAPER.settlement(t, state.markets[t.ticker]);
      if (!result) return;
      Object.assign(t, result, { status: 'settled', settlement_observed_at: new Date().toISOString() });
      changed = true;
    });
    if (changed) { setTrades(trades); emit('trades'); }
  }

  function portfolioStats(trades) { return PAPER.stats(trades, state.markets, Date.now()); }
  function paperStatusHtml() {
    return esc(state.mode === 'snapshot' ? 'Snapshot is view-only. Paper trading waits for fresh live asks and confirmed quantities.' : state.paperStatus) +
      ' <a href="' + rootHref('flagged.html#F-PAPER-01') + '">Model limits / legacy trades</a>';
  }

  /* ============================================================== rendering */
  function marketRowHtml(m, opts) {
    opts = opts || {};
    var t = topicOf(m.topic);
    var roi = roiOf(m);
    var spread = (m.yes_ask_dollars !== null && m.yes_bid_dollars !== null && m.yes_ask_dollars > 0 && m.yes_bid_dollars > 0)
      ? (m.yes_ask_dollars - m.yes_bid_dollars) : null;
    /* Dollar columns = contracts x the contract's published settlement value.
     * If the API did not return notional_value_dollars the dollar cell stays blank
     * instead of assuming $1.00 (see flagged item F-03). */
    var notional = (m.notional_value_dollars === null || m.notional_value_dollars === undefined) ? null : m.notional_value_dollars;
    var vol24 = (m.volume_24h_fp === null || notional === null) ? null : m.volume_24h_fp * notional;
    var vol = (m.volume_fp === null || notional === null) ? null : m.volume_fp * notional;
    var oi = (m.open_interest_fp === null || notional === null) ? null : m.open_interest_fp * notional;
    var res = m.result ? '<span class="badge ' + (m.result === 'yes' ? 'good' : 'bad') + '">' + esc(m.result) + '</span>' : '<span class="muted">—</span>';
    var status = m.status || '—';
    return '<tr' + (opts.tickerAttr ? ' data-ticker="' + esc(opts.tickerAttr) + '"' : '') + '>' +
      '<td><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(m.ticker) + '">' + esc(m.title || m.ticker) + '</a>' +
        '<br><span class="ticker">' + esc(m.ticker) + '</span></td>' +
      '<td><span class="tag ' + esc(t.id) + '">' + esc(t.label) + '</span></td>' +
      '<td class="num">' + cents(m.last_price_dollars) + '</td>' +
      '<td class="num">' + cents(m.yes_bid_dollars) + ' / ' + cents(m.yes_ask_dollars) + '</td>' +
      '<td class="num">' + (spread === null ? '<span class="muted">—</span>' : cents(spread)) + '</td>' +
      '<td class="num">' + num(vol24) + '</td>' +
      '<td class="num">' + num(vol) + '</td>' +
      '<td class="num">' + num(oi) + '</td>' +
      '<td class="num">' + roi.score + '</td>' +
      '<td>' + esc(status) + '</td>' +
      '<td>' + res + '</td>' +
      '<td class="src">' + (m.source_url ? '<a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">source</a>' : '<span class="muted">—</span>') + '</td>' +
      '</tr>';
  }

  function marketTableHead() {
    return '<tr><th>Market</th><th>Topic</th><th class="num">Last</th><th class="num">Bid / Ask</th>' +
      '<th class="num">Spread</th><th class="num">24h vol ($)</th><th class="num">Total vol ($)</th>' +
      '<th class="num">Open int ($)</th><th class="num">ROI</th><th>Status</th><th>Result</th><th>Source</th></tr>';
  }

  function ensureRoiHeader(tbodyEl) {
    /* marketRowHtml emits an ROI score cell (see marketTableHead). Some baked page headers
     * predate it (11 columns); without this repair every rendered row shifts one column.
     * Adds the missing ROI column once at paint time; no-op where the header already has it. */
    if (!tbodyEl || !tbodyEl.parentNode) return;
    var ths = tbodyEl.parentNode.querySelectorAll('thead th');
    if (!ths.length) return;
    for (var i = 0; i < ths.length; i++) if (ths[i].textContent.trim() === 'ROI') return;
    var th = document.createElement('th');
    th.className = 'num';
    th.textContent = 'ROI';
    var before = null;
    for (var j = 0; j < ths.length; j++) {
      if (ths[j].textContent.trim() === 'Status') { before = ths[j]; break; }
    }
    if (!before) before = ths[ths.length - 1];
    ths[0].parentNode.insertBefore(th, before);
  }

  function sortedMarkets(filterFn) {
    var list = Object.keys(state.markets).map(function (t) { return state.markets[t]; });
    if (filterFn) list = list.filter(filterFn);
    list.sort(function (a, b) {
      return (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0) || (b.volume_fp || 0) - (a.volume_fp || 0);
    });
    return list;
  }

  /* ================================================================== pages */
  var pages = {};
  var drawMarketChart = null;   // set by the market page, driven by startUniverseRefresh()

  function currentPage() {
    var attr = document.body.getAttribute('data-page');
    if (attr) return attr;
    var seg = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/i, '');
    return seg || 'index';
  }

  /* ---------------------------------------------------------- shared header */
  function renderChrome() {
    var page = currentPage();
    var nav = $('#nav') || $('nav.site');
    if (nav) {
      $$('a', nav).forEach(function (a) {
        var href = a.getAttribute('href');
        var cur = location.pathname.split('/').pop() || 'index.html';
        var here = (href || '').split(/[?#]/)[0].split('/').pop() === cur;
        if (here) a.classList.add('active');
      });
    }
    var clockEl = $('#clock');
    if (clockEl) {
      var tick = function () {
        clockEl.textContent = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      };
      tick();
      setInterval(tick, 1000);
    }
    var modeEl = $('#mode-badge');
    if (modeEl) {
      var paint = function () {
        if ((state.mode === 'live' || state.mode === 'legacy') && state.lastError) { modeEl.className = 'badge warn'; modeEl.textContent = 'DEGRADED · market data'; }
        else if (state.mode === 'live') { modeEl.className = 'badge live'; modeEl.textContent = 'LIVE · demo API'; }
        else if (state.mode === 'legacy') { modeEl.className = 'badge live'; modeEl.textContent = 'LIVE · shared demo host'; }
        else if (state.mode === 'snapshot') { modeEl.className = 'badge warn'; modeEl.textContent = 'SNAPSHOT · API unreachable'; }
        else { modeEl.className = 'badge warn'; modeEl.textContent = 'probing…'; }
      };
      emit('mode');
      state.listeners.push(paint);
      paint();
    }
  }

  function statusNotice(el) {
    if (!el) return;
    var paint = function () {
      if ((state.mode === 'live' || state.mode === 'legacy') && state.lastError) {
        el.className = 'notice warn'; el.textContent = state.lastError + ' Last successful quote batch: ' + (state.lastRefresh ? new Date(state.lastRefresh).toISOString() : 'not yet received');
      } else if (state.mode === 'live' || state.mode === 'legacy') {
        el.className = 'notice good';
        el.innerHTML = '<strong>Live data.</strong> Connected to the official Kalshi demo Trade API (<code>' + esc(state.base) + '</code>). ' +
          'Tables and charts refresh from it. The committed ' + dt(state.snapshot && state.snapshot.meta ? state.snapshot.meta.captured_at : null) +
          ' snapshot stays available as a verified reference.';
      } else if (state.mode === 'snapshot') {
        el.className = 'notice warn';
        el.innerHTML = '<strong>Snapshot mode.</strong> This browser could not reach the demo API (' + esc(state.lastError || 'network or CORS policy') + '). ' +
          'Showing the timestamped capture in <code>data/snapshot.json</code> with per-row source links. ' +
          'Captured replay may remain visible; new live alerts resume automatically after public API access recovers. No snapshot trade fill is assumed.';
      } else {
        el.className = 'notice';
        el.innerHTML = 'Probing the official demo API…';
      }
    };
    state.listeners.push(paint);
    paint();
  }

  /* ------------------------------------------------------------ index page */
  pages.index = function () {
    var notice = $('#mode-notice');
    statusNotice(notice);
    var cards = $('#status-cards');
    var topBody = tbodyOf('top-table-body');
    var topicBody = tbodyOf('topic-table');   /* topic overview is generated statically; no live body on this page */

    function paint() {
      var hasData = !!state.snapshot || Object.keys(state.markets).length > 0;
      if (!hasData) return; /* no snapshot and no live universe: keep the rows the build baked in */
      ensureRoiHeader(topBody);
      var rows = sortedMarkets(function (m) { return m.status !== 'finalized' && m.status !== 'settled'; }).slice(0, 12);
      if (topBody) {
        topBody.innerHTML = rows.length
          ? rows.map(function (m) { return marketRowHtml(m); }).join('')
          : '<tr><td colspan="12" class="muted">No open focus-topic markets available right now.</td></tr>';
      }
      if (topicBody) {
        topicBody.innerHTML = CFG.topics.map(function (t) {
          var list = Object.keys(state.markets).map(function (k) { return state.markets[k]; })
            .filter(function (m) { return m.topic === t.id; })
            .sort(function (a, b) { return (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0); });
          var open = list.filter(function (m) { return m.status !== 'finalized' && m.status !== 'settled'; });
          var best = open[0];
          var vol = list.reduce(function (s, m) { return s + (m.volume_24h_fp || 0); }, 0);
          return '<tr><td><strong><a href="categories/' + t.id + '.html">' + esc(t.label) + '</a></strong></td>' +
            '<td class="num">' + (state.seriesByTopic[t.id] || []).length + '</td>' +
            '<td class="num">' + open.length + '</td>' +
            '<td class="num">' + num(vol) + '</td>' +
            '<td>' + (best ? '<a href="' + rootHref('market.html?ticker=') + encodeURIComponent(best.ticker) + '">' + esc(best.title) + '</a>' : '<span class="muted">no open market right now</span>') + '</td>' +
            '<td class="src">' + (state.seriesByTopic[t.id] && state.seriesByTopic[t.id][0] && state.seriesByTopic[t.id][0].source_url
              ? '<a href="' + esc(state.seriesByTopic[t.id][0].source_url) + '" target="_blank" rel="noopener">series query</a>'
              : '<span class="muted">—</span>') + '</td></tr>';
        }).join('');
      }
      if (cards) {
        var snapMeta = (state.snapshot && state.snapshot.meta) || {};
        var liveCount = Object.keys(state.markets).length;
        cards.innerHTML =
          '<div class="stat"><div class="label">Environment</div><div class="value">Demo</div><div class="note">mock funds · separate credentials</div></div>' +
          '<div class="stat"><div class="label">Focus topics</div><div class="value">5</div><div class="note">gas · elections · culture · crypto · golf</div></div>' +
          '<div class="stat"><div class="label">Markets tracked</div><div class="value">' + liveCount + '</div><div class="note">' + (state.mode === 'snapshot' ? 'from the committed snapshot' : 'live from the demo API') + '</div></div>' +
          '<div class="stat"><div class="label">Snapshot captured</div><div class="value" style="font-size:15px">' +
            esc(String(snapMeta.captured_at || '—').replace('T', ' ').slice(0, 19)) + '</div><div class="note">' +
            (snapMeta.api_root ? '<a href="' + esc(snapMeta.api_root) + '/exchange/status" target="_blank" rel="noopener">source endpoint</a>' : '—') + '</div></div>';
      }
    }
    state.listeners.push(paint);
    paint();
  };

  /* --------------------------------------------------------- dashboard page */
  pages.dashboard = function () {
    statusNotice($('#mode-notice'));
    var s = settings();
    var feedState = { topic: 'all', dir: 'all', minSwing: s.threshold, roiCut: s.roiCut };
    var logA = $('#chat-all .log'), logB = $('#chat-roi .log');
    var cntA = $('#chat-all .count'), cntB = $('#chat-roi .count');
    var moversBody = tbodyOf('movers');

    /* seed the feed from the persisted alert log so the panes are never empty */
    state.alerts = getAlerts();

    function msgHtml(a) {
      var t = topicOf(a.topic);
      var cls = a.type === 'resolve' ? 'resolve' : (a.type === 'system' ? 'system' : (a.delta > 0 ? 'up' : 'down'));
      var head = '<div class="m-head"><span class="m-time">' + clock(a.ts) + ' UTC</span>' +
        (a.topic ? '<span class="tag ' + esc(t.id) + '">' + esc(t.label) + '</span>' : '') +
        (a.replay ? '<span class="badge info">snapshot replay</span>' : '') +
        (a.roiEligible !== undefined && a.roi !== null ? '<span class="badge neutral">research score ' + a.roi + (a.roiEligible ? '' : ' · ineligible') + '</span>' : '<span class="badge warn">historical score unverified</span>') + '</div>';
      var body;
      if (a.type === 'resolve') {
        body = '<div class="m-title"><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(a.ticker) + '">' + esc(a.title) + '</a> resolved <b class="' + (a.result === 'yes' ? 'up' : 'down') + '">' + esc(a.result).toUpperCase() + '</b></div>' +
          '<div class="m-body">Final outcome published by the exchange. Only holders of the winning side receive $1.00 per contract.</div>';
      } else if (a.type === 'system') {
        body = '<div class="m-body">' + esc(a.title) + '</div>';
      } else {
        body = '<div class="m-title"><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(a.ticker) + '">' + esc(a.title) + '</a></div>' +
          '<div class="m-body"><b class="' + (a.delta > 0 ? 'up' : 'down') + '">' + (a.delta > 0 ? '▲ +' : '▼ ') + a.delta.toFixed(2) + '</b> ' +
          cents(a.from) + ' → <b>' + cents(a.to) + '</b> · threshold ' + usd(feedState.minSwing, 2) + '</div>';
      }
      var links = (a.links || []).slice(0, 5).map(function (l) {
        return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
      }).join('');
      return '<div class="msg ' + cls + '">' + head + body + (links ? '<div class="m-links">' + links + '</div>' : '') + '</div>';
    }

    function passes(a, useRoi) {
      if (feedState.topic !== 'all' && a.topic !== feedState.topic) return false;
      if (feedState.dir !== 'all' && a.type === 'swing') {
        if (feedState.dir === 'up' && a.delta <= 0) return false;
        if (feedState.dir === 'down' && a.delta >= 0) return false;
      }
      if (a.type === 'swing' && (nullableNumber(a.delta) === null || Math.round(Math.abs(a.delta) * 10000) < Math.round(feedState.minSwing * 10000))) return false;
      if (useRoi && a.type === 'swing' && (a.replay || a.roiEligible !== true || a.roi === undefined || a.roi === null || a.roi < feedState.roiCut)) return false;
      return true;
    }

    function paint() {
      var all = state.alerts.filter(function (a) { return passes(a, false); });
      var roi = state.alerts.filter(function (a) { return passes(a, true); });
      if (logA) logA.innerHTML = all.length ? all.slice(-120).map(msgHtml).join('') : '<div class="empty">Waiting for a move of at least ' + usd(feedState.minSwing, 2) + '…</div>';
      if (logB) logB.innerHTML = roi.length ? roi.slice(-120).map(msgHtml).join('') : '<div class="empty">No market clears the ROI filter (' + feedState.roiCut + '+) yet.</div>';
      if (cntA) cntA.textContent = all.length + ' message' + (all.length === 1 ? '' : 's');
      if (cntB) cntB.textContent = roi.length + ' message' + (all.length === 1 ? '' : 's');
      if (logA) logA.scrollTop = logA.scrollHeight;
      if (logB) logB.scrollTop = logB.scrollHeight;
      var hasData = !!state.snapshot || Object.keys(state.markets).length > 0;
      if (moversBody && hasData) {
        ensureRoiHeader(moversBody);
        var rows = sortedMarkets(function (m) { return m.status !== 'finalized' && m.status !== 'settled'; }).slice(0, 15);
        moversBody.innerHTML = rows.length ? rows.map(function (m) { return marketRowHtml(m); }).join('')
          : '<tr><td colspan="12" class="muted">No open focus-topic markets available right now.</td></tr>';
      }
      var rt = tbodyOf('roi-table');
      if (rt && hasData) {
        var rr = Object.keys(state.markets).map(function (k) { return state.markets[k]; })
          .filter(function (m) { return m.status !== 'finalized' && m.status !== 'settled'; })
          .map(function (m) { return { m: m, r: roiOf(m) }; })
          .sort(function (a, b) { return b.r.score - a.r.score; })
          .slice(0, 15);
        rt.innerHTML = rr.length ? rr.map(function (x) {
          var p = x.r.parts;
          return '<tr><td><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(x.m.ticker) + '">' + esc(x.m.title) + '</a>' +
            '<br><span class="ticker">' + esc(x.m.ticker) + '</span></td>' +
            '<td><span class="tag ' + esc(topicOf(x.m.topic).id) + '">' + esc(topicOf(x.m.topic).label) + '</span></td>' +
            '<td class="num">' + x.r.score + '</td>' +
            '<td class="num">' + Math.round(p.liquidity * 100) + '</td>' +
            '<td class="num">' + Math.round(p.depth * 100) + '</td>' +
            '<td class="num">' + Math.round(p.tightness * 100) + '</td>' +
            '<td class="num">' + Math.round(p.volume * 100) + '</td>' +
            '<td class="num">' + Math.round(p.volatility * 100) + '</td>' +
            '<td class="num">' + (x.r.spread === null ? '—' : cents(x.r.spread)) + '</td>' +
            '<td class="num">' + num(x.r.touchSize, 2) + '</td><td class="src"><a href="' + esc(x.m.source_url || CFG.docs.market) + '" target="_blank" rel="noopener">API fields</a></td></tr>';
        }).join('') : '<tr><td colspan="11" class="muted">No rows yet.</td></tr>';
      }
    }

    /* controls */
    var topicChips = $('#topic-chips');
    if (topicChips) {
      [{ id: 'all', label: 'All topics' }].concat(CFG.topics).forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'tab' + (t.id === 'all' ? ' on' : '');
        b.textContent = t.label;
        b.addEventListener('click', function () {
          feedState.topic = t.id;
          $$('.tab', topicChips).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          paint();
        });
        topicChips.appendChild(b);
      });
    }
    var dirSel = $('#dir-filter');
    if (dirSel) dirSel.addEventListener('change', function () { feedState.dir = dirSel.value; paint(); });

    var thr = $('#threshold-input');
    if (thr) {
      thr.value = s.threshold;
      thr.addEventListener('change', function () {
        var v = parseFloat(thr.value);
        if (!isNaN(v) && v > 0 && v <= 0.5) { feedState.minSwing = v; saveSettings({ threshold: v }); }
        thr.value = feedState.minSwing;
        paint();
      });
    }
    var roiIn = $('#roi-input');
    if (roiIn) {
      roiIn.value = s.roiCut;
      roiIn.addEventListener('change', function () {
        var v = parseInt(roiIn.value, 10);
        if (!isNaN(v) && v >= 0 && v <= 100) { feedState.roiCut = v; saveSettings({ roiCut: v }); }
        roiIn.value = feedState.roiCut;
        paint();
      });
    }
    var pauseBtn = $('#pause-btn');
    if (pauseBtn) {
      var paused = false;
      pauseBtn.addEventListener('click', function () {
        paused = !paused;
        pauseBtn.textContent = paused ? 'Resume feed' : 'Pause feed';
        pauseBtn.classList.toggle('primary', paused);
        if (paused) { stopPolling(); } else { startPolling(); }
      });
    }

    state.listeners.push(paint);
    paint();
  };

  /* ------------------------------------------------------------ markets page */
  pages.markets = function () {
    var f = { topic: 'all', status: 'open', q: '' };
    var body = $('#markets-body');
    var head = $('#markets-head');
    if (head) head.innerHTML = marketTableHead();

    function paint() {
      var rows = Object.keys(state.markets).map(function (k) { return state.markets[k]; }).filter(function (m) {
        if (f.topic !== 'all' && m.topic !== f.topic) return false;
        if (f.status === 'open' && (m.status === 'finalized' || m.status === 'settled' || m.status === 'closed')) return false;
        if (f.status === 'resolved' && !(m.result === 'yes' || m.result === 'no')) return false;
        if (f.q && String(m.title || '').toLowerCase().indexOf(f.q.toLowerCase()) < 0 &&
            String(m.ticker || '').toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
        return true;
      });
      rows.sort(function (a, b) {
        var d = (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0);
        if (f.status === 'resolved') d = String(b.settlement_ts || '').localeCompare(String(a.settlement_ts || ''));
        return d;
      });
      var hasData = !!state.snapshot || Object.keys(state.markets).length > 0;
      if (body && hasData) {
        ensureRoiHeader(body);
        body.innerHTML = rows.length ? rows.map(function (m) { return marketRowHtml(m); }).join('')
          : '<tr><td colspan="12" class="muted">No markets match this filter.</td></tr>';
      }
      var c = $('#markets-count');
      if (c && hasData) c.textContent = rows.length + ' market' + (rows.length === 1 ? '' : 's');
    }

    var chips = $('#markets-topic-chips');
    if (chips) {
      [{ id: 'all', label: 'All topics' }].concat(CFG.topics).forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'tab' + (t.id === 'all' ? ' on' : '');
        b.textContent = t.label;
        b.addEventListener('click', function () {
          f.topic = t.id;
          $$('.tab', chips).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          paint();
        });
        chips.appendChild(b);
      });
    }
    var stSel = $('#status-filter');
    if (stSel) stSel.addEventListener('change', function () { f.status = stSel.value; paint(); });
    var qIn = $('#search-input');
    if (qIn) qIn.addEventListener('input', function () { f.q = qIn.value.trim(); paint(); });

    state.listeners.push(paint);
    paint();
  };

  /* ---------------------------------------------------------- category page */
  pages.category = function () {
    var topicId = document.body.getAttribute('data-topic');
    var topic = topicOf(topicId);
    var seriesBody = $('#series-body'), marketBody = $('#market-body'), resolvedBody = $('#resolved-body');

    function paint() {
      var hasData = !!state.snapshot || Object.keys(state.markets).length > 0;
      if (!hasData) return; /* no snapshot and no live universe: keep the rows the build baked in */
      if (seriesBody) {
        var list = (state.seriesByTopic[topicId] || []).slice();
        seriesBody.innerHTML = list.length ? list.map(function (s) {
          var src = (s.settlement_sources || []).map(function (x) {
            return x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + '</a>' : esc(x.name || '—');
          }).join(', ');
          return '<tr><td><code>' + esc(s.ticker) + '</code></td>' +
            '<td>' + esc(s.title || '—') + '</td>' +
            '<td>' + esc(s.category || '—') + '</td>' +
            '<td>' + esc((s.tags || []).join(', ') || '—') + '</td>' +
            '<td class="num">' + num(s.volume_fp) + '</td>' +
            '<td>' + (src || '<span class="muted">—</span>') + '</td>' +
            '<td class="src">' + (s.source_url ? '<a href="' + esc(s.source_url) + '" target="_blank" rel="noopener">series query</a>' : '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="7" class="muted">No series captured for this topic.</td></tr>';
      }
      if (marketBody) {
        ensureRoiHeader(marketBody);
        var rows = Object.keys(state.markets).map(function (k) { return state.markets[k]; })
          .filter(function (m) { return m.topic === topicId; })
          .sort(function (a, b) { return (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0); });
        marketBody.innerHTML = rows.length ? rows.map(function (m) { return marketRowHtml(m); }).join('')
          : '<tr><td colspan="12" class="muted">No open markets for this topic right now.</td></tr>';
      }
      if (resolvedBody) {
        var snap = state.snapshot;
        var resolved = [];
        if (snap && snap.topics && snap.topics[topicId]) {
          (snap.topics[topicId].settled_events || []).forEach(function (ev) {
            (ev.markets || []).forEach(function (m) {
              resolved.push({ ev: ev, m: m });
            });
          });
        }
        resolvedBody.innerHTML = resolved.length ? resolved.map(function (r) {
          return '<tr><td>' + esc(r.ev.title || r.ev.event_ticker) + '<br><span class="ticker">' + esc(r.ev.event_ticker) + '</span></td>' +
            '<td>' + esc(r.m.yes_sub_title || '—') + '<br><span class="ticker">' + esc(r.m.ticker) + '</span></td>' +
            '<td>' + (r.m.result ? '<span class="badge ' + (r.m.result === 'yes' ? 'good' : 'bad') + '">' + esc(r.m.result) + '</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td class="num">' + cents(r.m.settlement_value_dollars) + '</td>' +
            '<td class="num">' + num(r.m.volume_fp) + '</td>' +
            '<td>' + dt(r.ev.settlement_ts || (r.m.settlement_ts)) + '</td>' +
            '<td>' + ((r.ev.settlement_sources || []).map(function (x) {
              return x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + '</a>' : esc(x.name || '—');
            }).join(', ') || '<span class="muted">—</span>') + '</td>' +
            '<td class="src"><a href="' + esc(r.ev.source_url) + '" target="_blank" rel="noopener">events query</a></td></tr>';
        }).join('') : '<tr><td colspan="8" class="muted">No settled event captured for this topic yet — run <code>node scripts/fetch-snapshot.mjs</code> to refresh.</td></tr>';
      }
    }
    state.listeners.push(paint);
    paint();
  };

  /* ----------------------------------------------------------- market page */
  pages.market = function () {
    var ticker = new URLSearchParams(location.search).get('ticker') || '';
    if (!ticker) {
      var topM = sortedMarkets(function (m) { return m.status !== 'finalized' && m.status !== 'settled'; })[0] || sortedMarkets()[0];
      if (topM && topM.ticker) ticker = topM.ticker;
    }
    var winSel = $('#window-btns');
    var windowSec = 3600;
    var seriesTicker = null;
    var bookPending = false, lastBookRequest = 0;

    var WINDOWS = [
      { id: '30s', label: '30 s', sec: 30 },
      { id: '1m', label: '1 min', sec: 60 },
      { id: '5m', label: '5 min', sec: 300 },
      { id: '15m', label: '15 min', sec: 900 },
      { id: '1h', label: '1 h', sec: 3600 },
      { id: '6h', label: '6 h', sec: 21600 },
      { id: '1d', label: '24 h', sec: 86400 }
    ];

    function title(m) {
      $('#m-title').textContent = (m && m.title) || ticker || 'Market';
      $('#m-ticker').textContent = ticker;
      var topic = topicOf(m && m.topic);
      $('#m-topic').innerHTML = '<span class="tag ' + esc(topic.id) + '">' + esc(topic.label) + '</span>';
      $('#m-status').innerHTML = (m && m.status) ? '<span class="badge neutral">' + esc(m.status) + '</span>' : '<span class="muted">—</span>';
      $('#m-result').innerHTML = (m && m.result)
        ? '<span class="badge neutral">' + (m.status === 'finalized' ? 'final result ' : 'provisional result ') + esc(m.result) + '</span>'
        : '<span class="muted">not resolved yet</span>';
      /* Resolution block. Values come only from the API row (result, settlement_value_dollars,
       * settlement_ts, rules_primary); a missing field stays an em dash, never a guess. */
      var rc = $('#m-result-cell');
      if (rc) {
        rc.innerHTML = (m && m.result)
          ? '<span class="badge ' + (m.result === 'yes' ? 'good' : (m.result === 'no' ? 'bad' : 'neutral')) + '">' + esc(m.result) + '</span>'
          : '<span class="muted">not published by the exchange yet</span>';
      }
      var sv = $('#m-settle-value');
      if (sv) sv.textContent = (m && m.settlement_value_dollars !== null && m.settlement_value_dollars !== undefined)
        ? cents(m.settlement_value_dollars) : '—';
      var st = $('#m-settle-ts');
      if (st) st.textContent = (m && m.settlement_ts) ? m.settlement_ts : '—';
      var rr = $('#m-rule-text');
      if (rr) rr.textContent = (m && m.rules_primary) ? m.rules_primary : '—';
      var ss = $('#m-settle-src');
      if (ss) {
        ss.innerHTML = (m && m.source_url)
          ? '<a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">API row</a>' +
            (m.contract_terms_url ? ' · <a href="' + esc(m.contract_terms_url) + '" target="_blank" rel="noopener">contract terms</a>' : '')
          : '—';
      }
      $('#m-last').textContent = cents(m && m.last_price_dollars);
      $('#m-bid').textContent = cents(m && m.yes_bid_dollars);
      $('#m-ask').textContent = cents(m && m.yes_ask_dollars);
      $('#m-vol').textContent = num(m && m.volume_24h_fp);
      $('#m-oi').textContent = num(m && m.open_interest_fp);
      $('#m-rules').textContent = (m && m.rules_primary) || '—';
      $('#m-close').textContent = dt(m && (m.close_time || m.latest_expiration_time));
      $('#m-settle').textContent = dt(m && m.settlement_ts);
      var src = $('#m-sources');
      if (src) {
        var links = [];
        if (m && m.source_url) links.push('<a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">API row</a>');
        if (m && m.settlement_sources) {
          m.settlement_sources.forEach(function (x) {
            if (x && x.url) links.push('<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + '</a>');
          });
        }
        if (m && m.event_ticker) links.push('<a href="' + CFG.endpoints.web + '/markets/' + encodeURIComponent(m.event_ticker) + '" target="_blank" rel="noopener">Kalshi event page</a>');
        src.innerHTML = links.join(' ') || '<span class="muted">—</span>';
      }
      $$('.market-field-source').forEach(function (cell) {
        cell.innerHTML = '<a href="' + esc(m && m.source_url || CFG.docs.market) + '" target="_blank" rel="noopener">API field</a>';
      });
      var trade = $('#trade-form');
      if (trade) trade.hidden = !m;
    }

    function loadCandles(m) {
      if (!m || !m.series_ticker || ['live', 'legacy'].indexOf(state.mode) < 0) return;
      var period = windowSec <= 3600 ? 1 : 60, key = ticker + '|' + period;
      var cached = state.charts[key];
      var span = Math.max(windowSec, 3600);
      if (cached && (cached.pending || (Date.now() - cached.requested_at < 60000 && cached.span >= span))) return;
      var end = Math.floor(Date.now() / 1000);
      var url = state.base + '/series/' + encodeURIComponent(m.series_ticker) + '/markets/' + encodeURIComponent(ticker) +
        '/candlesticks?start_ts=' + (end - span) + '&end_ts=' + end + '&period_interval=' + period;
      state.charts[key] = Object.assign({}, cached || {}, { pending: true, requested_at: Date.now(), span: span });
      fetchJSON(url).then(function (r) {
        state.charts[key].points = (r.candlesticks || []).map(function (c) {
          return { t: nullableNumber(c.end_period_ts), v: nullableNumber(c.price && c.price.close_dollars),
            source_url: url, basis: period + '-minute published trade candle close' };
        });
        state.charts[key].error = null;
      }).catch(function (e) { state.charts[key].error = e.message; })
        .finally(function () { state.charts[key].pending = false; drawChart(); });
    }

    function drawChart() {
      var m = state.markets[ticker];
      if (!m || !window.KDChart) return;
      seriesTicker = m.series_ticker;
      loadCandles(m);
      var pts = [];
      var snapCandles = state.snapshot && state.snapshot.candlesticks && state.snapshot.candlesticks[ticker];
      var captured = state.snapshot && state.snapshot.meta && state.snapshot.meta.captured_at;
      if (snapCandles) {
        var c = (windowSec <= 3600 ? snapCandles.m1 : snapCandles.m60) || {};
        (c.candles || []).forEach(function (k) {
          if (Array.isArray(k)) pts.push({ t: nullableNumber(k[0]), v: nullableNumber(k[1]), source_url: c.source_url,
            basis: 'snapshot ' + (windowSec <= 3600 ? '1' : '60') + '-minute candle close' });
        });
      }
      var live = state.charts[ticker + '|' + (windowSec <= 3600 ? 1 : 60)] || {};
      pts = KDChart.preparePoints(pts.concat(live.points || [], state.history[ticker] || []));
      var snapshotView = m.data_mode !== 'live';
      var anchor = snapshotView ? Date.parse(captured) / 1000 : Math.floor(Date.now() / 1000);
      if (!Number.isFinite(anchor)) anchor = pts.length ? pts[pts.length - 1].t : Math.floor(Date.now() / 1000);
      var events = KDChart.jumps(pts, 0.10).filter(function (ev) { return ev.t >= anchor - windowSec && ev.t <= anchor; });
      KDChart.line($('#price-chart'), pts, { now: anchor, windowSeconds: windowSec, zoom: false, color: '#00dd94', events: events,
        onEvent: function (event) {
          var row = document.getElementById('jump-' + Math.floor(event.t));
          if (row) { row.focus(); if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        } });
      var note = $('#chart-status');
      if (note) note.textContent = (snapshotView ? 'SNAPSHOT VIEW — axis ends at capture ' + (captured || 'time unverified') :
        'REST observations — seconds are browser observation times, not exchange trade timestamps') +
        '. Historical candles are at least 1 minute. ' + (live.error ? 'Live candles unavailable; timestamped captured history is retained.' : 'Hover for values; click a gold marker for its sourced row.');
      var jumpBody = $('#price-events');
      if (jumpBody) jumpBody.innerHTML = events.length ? events.slice(-12).reverse().map(function (ev) {
        var source = ev.source_url || m.source_url || CFG.docs.market;
        return '<tr id="jump-' + Math.floor(ev.t) + '" tabindex="-1"><td>' + dt(new Date(ev.t * 1000).toISOString()) + '</td>' +
          '<td class="num">' + cents(ev.from) + ' → ' + cents(ev.to) + '</td><td class="num">' + (ev.delta > 0 ? '+' : '') + cents(ev.delta) + '</td>' +
          '<td class="small">' + esc(ev.basis) + '</td><td>— <span class="muted">cause unverified</span></td>' +
          '<td class="src"><a href="' + esc(source) + '" target="_blank" rel="noopener">observations</a>' +
          (m.event_ticker ? ' · <a href="' + CFG.endpoints.web + '/markets/' + encodeURIComponent(m.event_ticker) + '" target="_blank" rel="noopener">event</a>' : '') +
          ' · <a href="' + rootHref('catalyst.html') + '">research (not causation)</a></td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">No observed ≥ $0.10 change in this window. No cause or price point is invented.</td></tr>';
      var roi = roiOf(m);
      $('#m-roi').textContent = roi.score;
      var roi2 = $('#m-roi2'); if (roi2) roi2.textContent = roi.score;
      $('#m-liquidity').textContent = num(roi.touchSize, 2) + ' observed contracts at the touch';
    }

    /* The exchange quotes a YES bid and a NO bid; a YES ask is 1 - (best NO bid). The old
     * ladder showed only the raw yes_dollars/no_dollars arrays side by side, which HID the
     * side a trader actually has to hit: on KXBTCY-27JAN0100-B97500 the yes_dollars array is
     * empty while no_dollars holds 2,991,498.81 contracts at $0.0300 — i.e. a $0.97 YES ask
     * with real size behind it (measured 2026-11-21 through the official orderbook endpoint).
     * So both executable sides are now derived and shown, and the raw levels are labelled. */
    function drawBook() {
      var ob = state.orderbooks[ticker];
      var el = $('#book-body');
      if (!el) return;
      if (!ob) {
        el.innerHTML = '<tr><td colspan="8" class="muted">Order book not loaded; quantities unverified.</td></tr>';
        return;
      }
      function levels(input) {
        return (input || []).filter(Array.isArray).map(function (l) { return [nullableNumber(l[0]), nullableNumber(l[1])]; })
          .filter(function (l) { return l[0] !== null && l[0] > 0 && l[0] < 1 && l[1] !== null && l[1] > 0; })
          .sort(function (a, b) { return b[0] - a[0]; });
      }
      var yes = levels(ob.yes_dollars), no = levels(ob.no_dollars);
      var invalidLevels = (ob.yes_dollars || []).length + (ob.no_dollars || []).length - yes.length - no.length;
      var bestYesBid = yes.length ? yes[0] : null;
      var bestNoBid = no.length ? no[0] : null;
      var yesAsk = bestNoBid ? [Math.round((1 - bestNoBid[0]) * 10000) / 10000, bestNoBid[1]] : null;
      var max = Math.max(1, Math.max.apply(null, yes.concat(no).map(function (l) { return l[1]; }).concat([1])));
      var rows = [];
      var n = Math.max(yes.length, no.length);
      for (var i = 0; i < Math.min(n, 12); i++) {
        var y = yes[i], d = no[i];
        rows.push('<tr class="ask">' +
          '<td class="p">' + (y ? y[0].toFixed(4) : '—') + '</td><td class="num">' + (y ? num(y[1], 2) : '—') + '</td>' +
          '<td class="p">' + (y ? (1 - y[0]).toFixed(4) : '—') + '</td>' +
          '<td class="p">' + (d ? d[0].toFixed(4) : '—') + '</td><td class="num">' + (d ? num(d[1], 2) : '—') + '</td>' +
          '<td class="p">' + (d ? (1 - d[0]).toFixed(4) : '—') + '</td>' +
          '<td class="bar"><i style="width:' + (d ? Math.round((d[1] / max) * 100) : 0) + '%"></i></td>' +
          '<td class="src"><a href="' + esc(ob.source_url || CFG.docs.orderbook) + '" target="_blank" rel="noopener">book</a></td></tr>');
      }
      el.innerHTML = rows.join('') || '<tr><td colspan="8" class="muted">The exchange returned no resting orders for this market. That is a real, reportable state: there is nothing to trade against right now.</td></tr>';
      var tot = yes.concat(no).reduce(function (s, l) { return s + l[1]; }, 0);
      var totEl = $('#book-total');
      if (totEl) {
        totEl.innerHTML = (ob.data_mode === 'live' ? 'API book observed ' : 'SNAPSHOT book captured ') +
          (ob.observed_at ? dt(new Date(ob.observed_at).toISOString()) : 'time unverified') + '. ' + (invalidLevels ? invalidLevels + ' malformed level(s) omitted; values unverified. ' : '') + num(tot, 2) + ' contracts across ' + (yes.length + no.length) + ' price levels. ' +
          'Best YES bid <b>' + (bestYesBid ? '$' + bestYesBid[0].toFixed(2) + ' × ' + num(bestYesBid[1]) : 'none') + '</b> · ' +
          'Best YES ask <b>' + (yesAsk ? '$' + yesAsk[0].toFixed(2) + ' × ' + num(yesAsk[1]) + ' (from the NO bid)' : 'none') + '</b>. ' +
          (yesAsk ? '' : '<span class="warn">No YES offer is visible in this captured book; execution is unverified.</span>');
      }
    }

    function loadBook() {
      if (!ticker || bookPending || Date.now() - lastBookRequest < 5000) return;
      bookPending = true; lastBookRequest = Date.now();
      var url = state.base + '/markets/' + encodeURIComponent(ticker) + '/orderbook?depth=20';
      fetchJSON(url).then(function (r) {
        if (!r || !r.orderbook_fp || !Array.isArray(r.orderbook_fp.yes_dollars) || !Array.isArray(r.orderbook_fp.no_dollars)) throw new Error('Unverified orderbook response shape');
        state.orderbooks[ticker] = { yes_dollars: r.orderbook_fp.yes_dollars, no_dollars: r.orderbook_fp.no_dollars,
          source_url: url, observed_at: Date.now(), data_mode: 'live' };
        drawBook();
      }).catch(function () { /* Retain the timestamped snapshot/last book, never relabel it live. */ })
        .finally(function () { bookPending = false; });
    }
    function loadMarket() {
      if (!ticker) return;
      if (state.markets[ticker]) { title(state.markets[ticker]); drawChart(); drawBook(); }
      var url = state.base + '/markets/' + encodeURIComponent(ticker);
      fetchJSON(url).then(function (r) {
        if (!r || !r.market) return;
        var old = state.markets[ticker] || {};
        var m = normMarket(r.market, old.topic, url, old.series_ticker, old.settlement_sources);
        state.markets[ticker] = m;
        state.lastRef[ticker] = refPrice(m);
        var ref = refPrice(m);
        if (ref !== null) (state.history[ticker] || (state.history[ticker] = [])).push({ t: Math.floor(m.observed_at / 1000), v: ref, source_url: url, basis: 'browser poll observation' });
        title(m); drawChart();
      }).catch(function (e) {
        if (!state.markets[ticker]) { var titleEl = $('#m-title'); if (titleEl) titleEl.textContent = 'Market unverified: ' + e.message; }
      });
      loadBook();
    }

    if (winSel) {
      WINDOWS.forEach(function (w) {
        var b = document.createElement('button');
        b.className = 'btn small' + (w.sec === windowSec ? ' primary' : '');
        b.textContent = w.label;
        b.addEventListener('click', function () {
          windowSec = w.sec;
          $$('button', winSel).forEach(function (x) { x.classList.remove('primary'); });
          b.classList.add('primary');
          drawChart();
        });
        winSel.appendChild(b);
      });
    }

    /* paper trade */
    var form = $('#trade-form');
    var stratSel = $('#t-strategy');
    if (stratSel) {
      STRATEGIES.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id; o.textContent = s.label;
        stratSel.appendChild(o);
      });
      var manual = document.createElement('option');
      manual.value = 'manual'; manual.textContent = 'Manual (no rule)';
      stratSel.appendChild(manual);
    }
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var m = state.markets[ticker];
        if (!m) return;
        var side = $('#t-side').value;
        var qty = Number($('#t-qty').value);
        var trades = getTrades();
        var result = recordPaperTrade(m, side, qty, $('#t-strategy').value, 'manual paper request', trades);
        var out = $('#trade-msg');
        if (!result.ok) {
          if (out) out.textContent = result.reason;
          return;
        }
        setTrades(trades);
        if (out) out.textContent = 'PAPER ONLY: recorded ' + qty + ' ' + side.toUpperCase() + ' at observed ask ' + cents(result.trade.price) + '. No exchange order sent.';
        emit('trades');
      });
    }

    state.listeners.push(function () {
      if (!ticker) {
        var first = sortedMarkets()[0];
        if (first) { ticker = first.ticker; loadMarket(); }
      }
      var m = state.markets[ticker];
      if (m) { title(m); drawChart(); drawBook(); }
    });
    loadMarket();

    /* Hand the chart drawer to the shared 5-second timer (startUniverseRefresh) so the price
     * chart keeps up with the poller while this tab is open, instead of only redrawing on a click. */
    drawMarketChart = function () {
      var m = state.markets[ticker];
      if (!m) return;
      title(m);
      drawChart();
      if (state.mode !== 'snapshot') loadBook();
      drawBook();
    };
  };

  /* --------------------------------------------------------- portfolio page */
  function tradePnlHtml(t) {
    if (!PAPER.certified(t)) return '<span class="badge warn">legacy / unverified</span>';
    if (t.status !== 'settled') return '<span class="badge neutral">open — awaiting finalization</span>';
    if (!PAPER.isSettled(t)) return '<span class="badge warn">settlement unverified</span>';
    return '<span class="badge ' + (t.pnl >= 0 ? 'good' : 'bad') + '">' + usd(t.pnl) + ' gross</span>';
  }
  function tradeSourceHtml(t) {
    var url = t.quote && t.quote.source_url || t.source_url;
    return url && PAPER.official(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">API fields</a>' :
      '<a href="' + CFG.docs.market + '" target="_blank" rel="noopener">fields (row unverified)</a>';
  }
  pages.portfolio = function () {
    var tradesBody = tbodyOf('portfolio-trades'), statsEl = $('#portfolio-stats'), curve = $('#equity-chart');
    statusNotice($('#mode-notice'));
    function paint() {
      var trades = getTrades(), st = portfolioStats(trades), notice = $('#paper-notice');
      if (notice) notice.innerHTML = paperStatusHtml() + (st.excluded ? ' ' + st.excluded + ' legacy/unverified record(s) kept below but excluded from totals.' : '');
      if (statsEl) statsEl.innerHTML =
        '<div class="stat"><div class="label">Realized gross P&amp;L</div><div class="value ' + (st.realized >= 0 ? 'up' : 'down') + '">' + usd(st.realized) + '</div><div class="note">finalized paper positions only; excludes fees</div></div>' +
        '<div class="stat"><div class="label">Win rate</div><div class="value">' + (st.winRate === null ? '—' : pct(st.winRate, 1)) + '</div><div class="note">' + st.wins + ' wins / ' + st.losses + ' losses / ' + st.breakeven + ' flat</div></div>' +
        '<div class="stat"><div class="label">Open entry cost</div><div class="value">' + usd(st.openExposure) + '</div><div class="note">' + st.open + ' modeled positions · not account cash</div></div>' +
        '<div class="stat"><div class="label">Unrealized gross P&amp;L</div><div class="value">' + usd(st.unrealized) + '</div><div class="note">' + (st.unpricedOpen ? st.unpricedOpen + ' open position(s) lack fresh exit depth; total unverified' : 'at the side-specific observed bid; not an exchange fill') + '</div></div>';
      if (tradesBody) tradesBody.innerHTML = trades.length ? trades.slice().reverse().map(function (t) {
        var mark = PAPER.mark(t, state.markets[t.ticker], Date.now());
        var strat = STRATEGIES.filter(function (s) { return s.id === t.strategy; })[0];
        return '<tr><td>' + dt(t.ts) + '</td><td><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(t.ticker) + '">' + esc(t.title || t.ticker) + '</a><br><span class="ticker">' + esc(t.ticker) + '</span></td>' +
          '<td><span class="tag ' + esc(topicOf(t.topic).id) + '">' + esc(topicOf(t.topic).label) + '</span></td>' +
          '<td>' + esc(t.side) + '</td><td class="num">' + num(t.qty) + '</td><td class="num">' + cents(t.price) + '</td>' +
          '<td class="num">' + (mark ? cents(mark.price) : '—') + '</td><td>' + esc(strat ? strat.label : t.strategy || 'manual') + '</td>' +
          '<td>' + tradePnlHtml(t) + '</td><td>' + esc(t.result || '—') + '</td><td class="src">' + tradeSourceHtml(t) + '</td></tr>';
      }).join('') : '<tr><td colspan="11" class="muted">No paper trades recorded. Strategies run automatically while this tab is open and fresh, sufficiently sized quotes meet a rule. Snapshot data never creates a fill.</td></tr>';
      if (curve && window.KDChart) {
        var cumulative = 0;
        var closed = trades.filter(function (t) { return PAPER.isSettled(t); })
          .map(function (t) { return { trade: t, time: Date.parse(t.settled_ts || t.settlement_observed_at) / 1000 }; })
          .filter(function (t) { return Number.isFinite(t.time); }).sort(function (a, b) { return a.time - b.time; });
        var pts = closed.map(function (row) { cumulative += row.trade.pnl; return { t: row.time, v: cumulative }; });
        KDChart.line(curve, pts, { windowSeconds: pts.length ? Math.max(3600, Date.now() / 1000 - pts[0].t + 60) : 86400,
          binary: false, zoom: true, fill: true, color: '#4c9aff', hover: true });
      }
    }
    state.listeners.push(paint); paint();
    var auto = $('#auto-trade');
    if (auto) { auto.checked = settings().autoTrade; auto.addEventListener('change', function () { saveSettings({ autoTrade: auto.checked }); paint(); }); }
    var reset = $('#reset-trades');
    if (reset) reset.addEventListener('click', function () {
      if (confirm('Delete all simulated trades stored in this browser?')) { setTrades([]); paint(); emit('trades'); }
    });
  };

  /* ----------------------------------------------------------- analysis page */
  pages.analysis = function () {
    var body = $('#analysis-body'), stratBody = tbodyOf('strategy-stats'), topicBody = tbodyOf('topic-stats');
    statusNotice($('#mode-notice'));
    function paint() {
      var trades = getTrades(), st = portfolioStats(trades), note = $('#analysis-notice');
      if (note) note.textContent = 'Computed paper-model results only, not account performance. Gross P&L excludes fees. ' + st.excluded + ' legacy/unverified record(s) are excluded from summaries and kept in the log.';
      function performance(map, topic) {
        return Object.keys(map).map(function (key) {
          var v = map[key];
          var name = topic ? topicOf(key).label : (STRATEGIES.filter(function (s) { return s.id === key; })[0] || {}).label || key;
          var wr = v.wins + v.losses ? v.wins / (v.wins + v.losses) : null;
          return '<tr><td>' + esc(name) + '</td><td class="num">' + v.trades + '</td><td class="num">' + v.open + '</td>' +
            '<td class="num">' + (wr === null ? '—' : pct(wr, 1)) + '</td><td class="num">' + usd(v.pnl) + '</td>' +
            (topic ? '' : '<td class="num">' + (v.trades ? usd(v.pnl / v.trades) : '—') + '</td>') +
            '<td class="src"><a href="' + CFG.docs.settlement + '" target="_blank" rel="noopener">payout rule</a></td></tr>';
        }).join('') || '<tr><td colspan="' + (topic ? '6' : '7') + '" class="muted">No supported paper-model results yet.</td></tr>';
      }
      if (stratBody) stratBody.innerHTML = performance(st.byStrategy, false);
      if (topicBody) topicBody.innerHTML = performance(st.byTopic, true);
      if (body) body.innerHTML = trades.length ? trades.slice().reverse().map(function (t) {
        var strat = (STRATEGIES.filter(function (s) { return s.id === t.strategy; })[0] || {}).label || t.strategy;
        return '<tr><td>' + dt(t.ts) + '</td><td>' + esc(t.title || t.ticker) + '</td><td>' + esc(topicOf(t.topic).label) + '</td>' +
          '<td>' + esc(strat) + '</td><td>' + esc(t.side) + '</td><td class="num">' + num(t.qty) + '</td><td class="num">' + cents(t.price) + '</td>' +
          '<td>' + tradePnlHtml(t) + '</td><td>' + esc(t.result || '—') + '</td><td class="small">' + esc(t.why || '') + '</td>' +
          '<td class="src">' + tradeSourceHtml(t) + '</td></tr>';
      }).join('') : '<tr><td colspan="11" class="muted">No simulated trades yet. The automatic paper model needs a fresh, executable quote and a matching strategy signal.</td></tr>';
    }
    state.listeners.push(paint); paint();
  };

  /* ============================================================== lifecycle */
  function startPolling() {
    stopPolling();
    var s = settings();
    state.pollTimer = setInterval(function () {
      pollPrices().then(function (result) {
        if (result !== null) { settleTrades(); autoTradeStep(); }
        emit('poll-done');
      });
    }, Math.max(2000, s.pollMs));
    pollPrices().then(function (result) { if (result !== null) { settleTrades(); autoTradeStep(); } emit('poll-done'); });
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  function startUniverseRefresh() {
    if (state.universeTimer) clearInterval(state.universeTimer);
    if (state.chartTimer) clearInterval(state.chartTimer);
    state.universeTimer = setInterval(function () { refreshUniverse(); }, 10 * 60 * 1000);

    /* Chart accumulation while the tab is open. detectSwing() records one [time, price] point per
     * market per poll, but the market page only redrew the chart after an explicit action (window
     * button, ticker change, resize). A trader watching a market therefore saw a chart that did
     * not move even though the poller was collecting points behind it. This redraws the chart and
     * the book once per 5 seconds at most, only when this is the market page and only if it exists,
     * and it never re-renders the tables (which would fight the reader's own scrolling). */
    if (currentPage() === 'market') {
      state.chartTimer = setInterval(function () {
        try {
          if (drawMarketChart && document.getElementById('price-chart')) drawMarketChart();
        } catch (e) { /* a redraw must never take the page down */ }
      }, 5000);
    }
  }

  function init() {
    renderChrome();
    var page = currentPage();

    /* Each page renderer binds its own controls and listeners, so it must run exactly once.
     * It runs after the snapshot is available (the snapshot is the fallback when the live API is unreachable). */
    var connecting = false;
    function connect() {
      if (connecting) return Promise.resolve(false);
      connecting = true;
      return probe().then(function (live) {
        if (!live) return false;
        startPolling(); startUniverseRefresh();
        return refreshUniverse().then(function () { emit('universe'); return true; });
      }).finally(function () { connecting = false; });
    }
    loadSnapshot().then(function () {
      if (pages[page]) pages[page]();
      return connect();
    });
    state.recoveryTimer = setInterval(function () {
      if (state.mode === 'snapshot') connect();
    }, 60000);

    window.addEventListener('resize', function () {
      emit('resize');
    });

    /* expose for debugging and for the QA logic test */
    window.KD = {
      CFG: CFG, STRATEGIES: STRATEGIES, state: state, fmt: { usd: usd, cents: cents, num: num, pct: pct, esc: esc },
      api: { get: apiGet },   /* no signed/browser-side key handling: keys never reach the browser (see demo-account) */
      roi: roiOf, portfolioStats: portfolioStats, settings: settings, saveSettings: saveSettings,
      getTrades: getTrades, setTrades: setTrades, getAlerts: getAlerts, setAlerts: setAlerts,
      refPrice: refPrice, detectSwing: detectSwing, emit: emit, normMarket: normMarket,
      paper: { record: recordPaperTrade, step: autoTradeStep, settle: settleTrades },
      pollPrices: pollPrices, trackedTickers: trackedTickers
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
