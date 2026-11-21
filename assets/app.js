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

  var STRATEGIES = [
    { id: 'momentum', label: 'Momentum',
      rule: 'Go long YES when the reference price rose at least $0.05 across the last 3 observations; exit when it falls at least $0.05.' },
    { id: 'mean-reversion', label: 'Mean reversion',
      rule: 'Buy YES when the price is at or below $0.25 and the last move was down; buy NO when the price is at or above $0.75 and the last move was up.' },
    { id: 'favorite', label: 'Favorite (liquidity)',
      rule: 'Buy YES in the most liquid market of the topic when its ROI score is at least 70 and the price is at least $0.80.' },
    { id: 'longshot', label: 'Longshot',
      rule: 'Buy NO in markets priced at or below $0.15 whose ROI score is at least 60 (cheap optionality, capped size).' },
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
    try { return JSON.parse(localStorage.getItem(TRADES_KEY) || '[]'); } catch (e) { return []; }
  }
  function setTrades(t) { try { localStorage.setItem(TRADES_KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } }

  /* ================================================================== alerts */
  var ALERTS_KEY = 'kalshidash:v1:alerts';
  function getAlerts() {
    try { return JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch (e) { return []; }
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
    seenAlerts: {}              // dedupe key -> ts
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
      status: m.status || null,
      result: (m.result && m.result !== '') ? m.result : null,
      last_price_dollars: m.last_price_dollars === undefined ? null : Number(m.last_price_dollars),
      previous_price_dollars: m.previous_price_dollars === undefined ? null : Number(m.previous_price_dollars),
      yes_bid_dollars: m.yes_bid_dollars === undefined ? null : Number(m.yes_bid_dollars),
      yes_ask_dollars: m.yes_ask_dollars === undefined ? null : Number(m.yes_ask_dollars),
      no_bid_dollars: m.no_bid_dollars === undefined ? null : Number(m.no_bid_dollars),
      no_ask_dollars: m.no_ask_dollars === undefined ? null : Number(m.no_ask_dollars),
      yes_bid_size_fp: m.yes_bid_size_fp === undefined ? null : Number(m.yes_bid_size_fp),
      yes_ask_size_fp: m.yes_ask_size_fp === undefined ? null : Number(m.yes_ask_size_fp),
      volume_fp: m.volume_fp === undefined ? null : Number(m.volume_fp),
      volume_24h_fp: m.volume_24h_fp === undefined ? null : Number(m.volume_24h_fp),
      open_interest_fp: m.open_interest_fp === undefined ? null : Number(m.open_interest_fp),
      notional_value_dollars: m.notional_value_dollars === undefined ? null : Number(m.notional_value_dollars),
      close_time: m.close_time || null,
      expected_expiration_time: m.expected_expiration_time || null,
      latest_expiration_time: m.latest_expiration_time || null,
      settlement_ts: m.settlement_ts || null,
      settlement_value_dollars: m.settlement_value_dollars === undefined ? null : Number(m.settlement_value_dollars),
      rules_primary: m.rules_primary || '',
      source_url: sourceUrl || null
    };
  }

  function ingestSnapshot(snap) {
    if (!snap) return;
    (snap.markets || []).forEach(function (m) {
      state.markets[m.ticker] = m;
      if (m.last_price_dollars !== null && m.last_price_dollars !== undefined) {
        state.lastRef[m.ticker] = m.last_price_dollars;
        state.history[m.ticker] = [{ t: Math.floor(Date.now() / 1000), v: m.last_price_dollars }];
      }
      if (m.status) state.status[m.ticker] = m.status;
      if (m.series_ticker && m.settlement_sources) state.settlementSources[m.series_ticker] = m.settlement_sources;
    });
    Object.keys(snap.orderbooks || {}).forEach(function (t) {
      state.orderbooks[t] = snap.orderbooks[t];
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
        var from = Number(candles[i - 1][1]), to = Number(candles[i][1]);
        if (!isFinite(from) || !isFinite(to)) continue;
        var delta = to - from;
        if (Math.abs(delta) < s.threshold) continue;
        seeded.push({
          id: 'seed-' + ticker + '-' + i,
          type: 'swing', ts: Number(candles[i][0]),
          ticker: ticker, topic: m ? m.topic : null,
          title: m ? m.title : ticker,
          from: from, to: to, delta: delta,
          roi: m ? roiOf(m).score : null,
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
        var old = state.markets[m.ticker];
        state.markets[m.ticker] = m;
        if (old && old.last_price_dollars !== null && m.last_price_dollars === null) {
          m.last_price_dollars = old.last_price_dollars;
        }
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
    return Object.keys(state.markets).filter(function (t) {
      var m = state.markets[t];
      return m.status !== 'finalized' && m.status !== 'settled' && m.status !== 'closed';
    });
  }

  function pollPrices() {
    if (state.mode === 'snapshot') return Promise.resolve(null);
    var tickers = trackedTickers();
    if (!tickers.length) return Promise.resolve(null);
    var chunks = [];
    for (var i = 0; i < tickers.length; i += 40) chunks.push(tickers.slice(i, i + 40));

    return Promise.all(chunks.map(function (chunk) {
      return apiGet('/markets?tickers=' + encodeURIComponent(chunk.join(','))).catch(function () { return { markets: [] }; });
    })).then(function (responses) {
      var swings = [];
      responses.forEach(function (r) {
        (r.markets || []).forEach(function (m) {
          var prev = state.markets[m.ticker];
          var row = normMarket(m, prev ? prev.topic : null, state.base + '/markets?tickers=…', prev ? prev.series_ticker : null, prev ? prev.settlement_sources : []);
          if (prev) {
            row.topic = prev.topic;
            row.series_ticker = prev.series_ticker;
            row.settlement_sources = prev.settlement_sources;
          }
          var swing = detectSwing(m.ticker, row);
          if (swing) swings.push(swing);
          var resolved = detectResolution(m.ticker, row);
          if (resolved) swings.push(resolved);
          state.markets[m.ticker] = row;
        });
      });
      state.lastRefresh = Date.now();
      emit('poll');
      swings.forEach(function (s) { handleSwing(s); });
      return swings;
    });
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
    hist.push({ t: Math.floor(Date.now() / 1000), v: ref });
    if (hist.length > 4000) hist.splice(0, hist.length - 4000);
    if (prev === undefined || prev === null) return null;

    var s = settings();
    var dTrade = ref - prev;
    var dMid = (mid !== null && state.history[ticker].length > 1) ? 0 : 0;
    if (Math.abs(dTrade) < s.threshold) return null;

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
    var prevStatus = state.status[ticker];
    var st = (m.status || '').toLowerCase();
    var resolvedStates = ['determined', 'finalized', 'settled', 'closed'];
    if (prevStatus && resolvedStates.indexOf(st) >= 0 && prevStatus !== st) {
      if (m.result === 'yes' || m.result === 'no') {
        return { type: 'resolve', ticker: ticker, market: m, result: m.result, ts: Math.floor(Date.now() / 1000) };
      }
    }
    if (m.status) state.status[ticker] = m.status;
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
    var prev = state.lastRef[m.ticker];
    var vol = Math.abs((prev !== undefined && ref !== null) ? (ref - prev) : 0);

    var parts = {
      liquidity: clamp01(touchSize / 300),
      depth: depth === null ? 0 : clamp01(depth / 1200),
      tightness: spread === null ? 0.25 : clamp01(1 - spread / 0.10),
      volume: clamp01((m.volume_24h_fp || 0) / 20000),
      volatility: clamp01(vol / 0.30)
    };
    var score = 0;
    Object.keys(w).forEach(function (k) { score += w[k] * parts[k]; });
    return { score: Math.round(score * 100), parts: parts, spread: spread, touchSize: touchSize, depth: depth, ref: ref };
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
      links: candidateLinks(m),
      source_url: m.source_url || null
    };
    state.alerts.push(msg);
    setAlerts(state.alerts);
    emit('alert', msg);
  }

  /* ============================================================ paper trading */
  function openTrades() { return getTrades().filter(function (t) { return t.status === 'open'; }); }

  function autoTradeStep() {
    var s = settings();
    if (!s.autoTrade) return;
    var trades = getTrades();
    var open = trades.filter(function (t) { return t.status === 'open'; });
    var openKeys = {};
    open.forEach(function (t) { openKeys[t.ticker + '|' + t.strategy] = true; });

    var priceHistory = state.history;
    STRATEGIES.forEach(function (strat) {
      if (!s.strategies[strat.id]) return;
      Object.keys(state.markets).forEach(function (ticker) {
        var m = state.markets[ticker];
        if (!m || m.status === 'finalized' || m.status === 'settled') return;
        if (openKeys[ticker + '|' + strat.id]) return;
        var ref = refPrice(m);
        if (ref === null || ref <= 0 || ref >= 1) return;
        var hist = priceHistory[ticker] || [];
        var roi = roiOf(m);
        var signal = null;

        if (strat.id === 'momentum') {
          if (hist.length >= 3) {
            var d = ref - hist[hist.length - 3].v;
            if (d >= 0.05) signal = { side: 'yes', why: 'up ' + d.toFixed(2) + ' over 3 ticks' };
            else if (d <= -0.05) signal = { side: 'no', why: 'down ' + Math.abs(d).toFixed(2) + ' over 3 ticks' };
          }
        } else if (strat.id === 'mean-reversion') {
          var lastMove = hist.length >= 2 ? ref - hist[hist.length - 2].v : 0;
          if (ref <= 0.25 && lastMove < 0) signal = { side: 'yes', why: 'price ' + ref.toFixed(2) + ' and falling' };
          else if (ref >= 0.75 && lastMove > 0) signal = { side: 'no', why: 'price ' + ref.toFixed(2) + ' and rising' };
        } else if (strat.id === 'favorite') {
          if (roi.score >= 70 && ref >= 0.80) signal = { side: 'yes', why: 'ROI ' + roi.score + ', price ' + ref.toFixed(2) };
        } else if (strat.id === 'longshot') {
          if (ref <= 0.15 && roi.score >= 60) signal = { side: 'no', why: 'price ' + ref.toFixed(2) + ', ROI ' + roi.score };
        } else if (strat.id === 'catalyst') {
          var oi = m.open_interest_fp || 0, v24 = m.volume_24h_fp || 0;
          if (oi > 0 && v24 / oi >= 5 && roi.score >= 60) signal = { side: 'yes', why: '24h vol ' + num(v24) + ' vs OI ' + num(oi) };
        }

        if (!signal) return;
        var fill = signal.side === 'yes'
          ? (m.yes_ask_dollars !== null && m.yes_ask_dollars > 0 ? m.yes_ask_dollars : ref)
          : (m.no_bid_dollars !== null && m.no_bid_dollars > 0 ? m.no_bid_dollars : 1 - ref);
        var qty = s.contracts;
        trades.push({
          id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
          ts: new Date().toISOString(),
          ticker: ticker, title: m.title, topic: m.topic,
          side: signal.side, price: fill, qty: qty,
          strategy: strat.id, status: 'open', result: null, exit_price: null, pnl: null,
          roi: roi.score, why: signal.why, simulated: true,
          source_url: m.source_url || null
        });
        openKeys[ticker + '|' + strat.id] = true;
      });
    });
    if (trades.length !== getTrades().length) { setTrades(trades); emit('trades'); }
  }

  /* Settle simulated positions once the market resolves (result yes / no). */
  function settleTrades() {
    var trades = getTrades();
    var changed = false;
    trades.forEach(function (t) {
      if (t.status !== 'open') return;
      var m = state.markets[t.ticker];
      if (!m) return;
      var st = (m.status || '').toLowerCase();
      if (['determined', 'finalized', 'settled'].indexOf(st) < 0) return;
      if (m.result !== 'yes' && m.result !== 'no') return;
      var payout = (t.side === m.result) ? 1 : 0;
      t.result = m.result;
      t.status = 'settled';
      t.exit_price = payout;
      t.pnl = (payout - t.price) * t.qty;
      t.settled_ts = m.settlement_ts || new Date().toISOString();
      changed = true;
    });
    if (changed) { setTrades(trades); emit('trades'); }
  }

  function portfolioStats(trades) {
    var st = { realized: 0, wins: 0, losses: 0, open: 0, openExposure: 0, unrealized: 0, byStrategy: {}, byTopic: {} };
    trades.forEach(function (t) {
      var key = t.strategy || 'manual';
      if (!st.byStrategy[key]) st.byStrategy[key] = { label: key, trades: 0, wins: 0, losses: 0, pnl: 0, open: 0 };
      if (!st.byTopic[t.topic || 'other']) st.byTopic[t.topic || 'other'] = { label: t.topic || 'other', trades: 0, wins: 0, losses: 0, pnl: 0, open: 0 };
      if (t.status === 'settled') {
        var p = t.pnl || 0;
        st.realized += p;
        st.byStrategy[key].trades++; st.byStrategy[key].pnl += p;
        st.byTopic[t.topic || 'other'].trades++; st.byTopic[t.topic || 'other'].pnl += p;
        if (p > 0) { st.wins++; st.byStrategy[key].wins++; st.byTopic[t.topic || 'other'].wins++; }
        else { st.losses++; st.byStrategy[key].losses++; st.byTopic[t.topic || 'other'].losses++; }
      } else {
        st.open++;
        st.openExposure += (t.price * t.qty);
        st.byStrategy[key].open++; st.byTopic[t.topic || 'other'].open++;
        var m = state.markets[t.ticker];
        var ref = m ? refPrice(m) : null;
        if (ref !== null) {
          var mv = (t.side === 'yes' ? ref : 1 - ref);
          st.unrealized += (mv - t.price) * t.qty;
        }
      }
    });
    st.winRate = (st.wins + st.losses) ? st.wins / (st.wins + st.losses) : null;
    return st;
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
        if (state.mode === 'live') { modeEl.className = 'badge live'; modeEl.textContent = 'LIVE · demo API'; }
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
      if (state.mode === 'live' || state.mode === 'legacy') {
        el.className = 'notice good';
        el.innerHTML = '<strong>Live data.</strong> Connected to the official Kalshi demo Trade API (<code>' + esc(state.base) + '</code>). ' +
          'Tables and charts refresh from it. The committed ' + dt(state.snapshot && state.snapshot.meta ? state.snapshot.meta.captured_at : null) +
          ' snapshot stays available as a verified reference.';
      } else if (state.mode === 'snapshot') {
        el.className = 'notice warn';
        el.innerHTML = '<strong>Snapshot mode.</strong> This browser could not reach the demo API (' + esc(state.lastError || 'network or CORS policy') + '). ' +
          'Showing the verified snapshot committed to <code>data/snapshot.json</code> with per-row source links. ' +
          'The live alert feed stays idle until the API is reachable — nothing is invented. ' +
          'To refresh the snapshot yourself run <code>node scripts/fetch-snapshot.mjs</code> from a machine that can reach the API.';
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
        (a.roi !== undefined && a.roi !== null ? '<span class="badge neutral">ROI ' + a.roi + '</span>' : '') + '</div>';
      var body;
      if (a.type === 'resolve') {
        body = '<div class="m-title"><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(a.ticker) + '">' + esc(a.title) + '</a> resolved <b class="' + (a.result === 'yes' ? 'up' : 'down') + '">' + esc(a.result).toUpperCase() + '</b></div>' +
          '<div class="m-body">Settlement published by the exchange. YES holders receive $1.00 per contract, NO holders $1.00 per contract.</div>';
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
      if (useRoi && a.type === 'swing' && (a.roi === undefined || a.roi === null || a.roi < feedState.roiCut)) return false;
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
            '<td class="num">' + num(x.r.touchSize) + '</td></tr>';
        }).join('') : '<tr><td colspan="10" class="muted">No rows yet.</td></tr>';
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
        ? '<span class="badge ' + (m.result === 'yes' ? 'good' : 'bad') + '">resolved ' + esc(m.result) + '</span>'
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
      var trade = $('#trade-form');
      if (trade) trade.hidden = !m;
    }

    function drawChart() {
      var m = state.markets[ticker];
      if (!m) return;
      // shared with startUniverseRefresh() so the chart can follow the poller while the tab is open
      var pts = (state.history[ticker] || []).slice();
      var snapCandles = state.snapshot && state.snapshot.candlesticks && state.snapshot.candlesticks[ticker];
      if (snapCandles) {
        var c = (windowSec <= 3600 ? snapCandles.m1 : snapCandles.m60);
        (c.candles || []).forEach(function (k) {
          if (!Array.isArray(k)) return;
          var close = Number(k[1]);
          if (isFinite(close)) pts.push({ t: Number(k[0]), v: close });
        });
      }
      if (window.KDChart) {
        KDChart.line($('#price-chart'), pts, {
          windowSeconds: windowSec, zoom: false, threshold: settings().threshold, color: '#00dd94'
        });
      }
      var roi = roiOf(m);
      $('#m-roi').textContent = roi.score;
      var roi2 = $('#m-roi2');
      if (roi2) roi2.textContent = roi.score;
      $('#m-liquidity').textContent = num(roi.touchSize) + ' contracts at the touch';
    }

    function drawBook() {
      var ob = state.orderbooks[ticker];
      var el = $('#book-body');
      if (!el) return;
      if (!ob) {
        el.innerHTML = '<tr><td colspan="5" class="muted">Order book not loaded yet.</td></tr>';
        return;
      }
      var yes = (ob.yes_dollars || []).map(function (l) { return [Number(l[0]), Number(l[1])]; })
        .sort(function (a, b) { return b[0] - a[0]; });
      var no = (ob.no_dollars || []).map(function (l) { return [Number(l[0]), Number(l[1])]; })
        .sort(function (a, b) { return b[0] - a[0]; });
      var max = Math.max(1, Math.max.apply(null, yes.concat(no).map(function (l) { return l[1]; }).concat([1])));
      var rows = [];
      var n = Math.max(yes.length, no.length);
      for (var i = 0; i < Math.min(n, 12); i++) {
        var y = yes[i], d = no[i];
        rows.push('<tr class="ask"><td class="p">' + (d ? d[0].toFixed(4) : '') + '</td><td class="num">' + (d ? num(d[1]) : '') + '</td>' +
          '<td class="p">' + (y ? y[0].toFixed(4) : '') + '</td><td class="num">' + (y ? num(y[1]) : '') + '</td>' +
          '<td class="bar"><i style="width:' + (d ? Math.round((d[1] / max) * 100) : 0) + '%"></i></td></tr>');
      }
      el.innerHTML = rows.join('') || '<tr><td colspan="5" class="muted">Order book is empty for this market.</td></tr>';
      var tot = yes.concat(no).reduce(function (s, l) { return s + l[1]; }, 0);
      var totEl = $('#book-total');
      if (totEl) totEl.textContent = num(tot) + ' contracts across ' + (yes.length + no.length) + ' price levels';
    }

    function loadMarket() {
      if (!ticker) return;
      if (state.markets[ticker]) {
        title(state.markets[ticker]);
        drawChart();
        drawBook();
      }
      apiGet('/markets/' + encodeURIComponent(ticker)).then(function (r) {
        if (!r || !r.market) return;
        var m = normMarket(r.market, (state.markets[ticker] || {}).topic, state.base + '/markets/' + encodeURIComponent(ticker),
          (state.markets[ticker] || {}).series_ticker, (state.markets[ticker] || {}).settlement_sources);
        state.markets[ticker] = m;
        seriesTicker = m.series_ticker;
        title(m);
        drawChart();
      }).catch(function (e) {
        if (!state.markets[ticker]) {
          var t = $('#m-title'); if (t) t.textContent = 'Could not load market: ' + e.message;
        }
      });
      apiGet('/markets/' + encodeURIComponent(ticker) + '/orderbook?depth=20').then(function (r) {
        if (r && r.orderbook_fp) {
          state.orderbooks[ticker] = { yes_dollars: r.orderbook_fp.yes_dollars || [], no_dollars: r.orderbook_fp.no_dollars || [], source_url: state.base + '/markets/' + encodeURIComponent(ticker) + '/orderbook?depth=20' };
          drawBook();
        }
      }).catch(function () { /* orderbook may be empty */ });
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
        var qty = parseInt($('#t-qty').value, 10) || 1;
        var strat = $('#t-strategy').value;
        var price = side === 'yes'
          ? (m.yes_ask_dollars || m.last_price_dollars)
          : (m.no_bid_dollars !== null && m.no_bid_dollars !== undefined && m.no_bid_dollars > 0 ? m.no_bid_dollars : 1 - (m.last_price_dollars || 0));
        var trades = getTrades();
        trades.push({
          id: 'm' + Date.now(), ts: new Date().toISOString(), ticker: ticker, title: m.title, topic: m.topic,
          side: side, price: price, qty: qty, strategy: strat, status: 'open', result: null, pnl: null,
          simulated: true, why: 'manual', roi: roiOf(m).score, source_url: m.source_url || null
        });
        setTrades(trades);
        var out = $('#trade-msg');
        if (out) out.innerHTML = '<span class="badge good">simulated</span> Recorded ' + qty + ' ' + side + ' @ ' + cents(price) + '. No real order was sent.';
        emit('trades');
      });
    }

    state.listeners.push(function () {
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
      drawBook();
    };
  };

  /* --------------------------------------------------------- portfolio page */
  pages.portfolio = function () {
    var tradesBody = tbodyOf('portfolio-trades');
    var statsEl = $('#portfolio-stats');
    var curve = $('#equity-chart');

    function paint() {
      var trades = getTrades();
      var st = portfolioStats(trades);
      if (statsEl) {
        statsEl.innerHTML =
          '<div class="stat"><div class="label">Realized P&amp;L</div><div class="value ' + (st.realized >= 0 ? 'up' : 'down') + '">' + usd(st.realized) + '</div><div class="note">settled simulated trades</div></div>' +
          '<div class="stat"><div class="label">Win rate</div><div class="value">' + (st.winRate === null ? '—' : pct(st.winRate, 1)) + '</div><div class="note">' + st.wins + ' wins / ' + st.losses + ' losses</div></div>' +
          '<div class="stat"><div class="label">Open exposure</div><div class="value">' + usd(st.openExposure) + '</div><div class="note">' + st.open + ' open positions</div></div>' +
          '<div class="stat"><div class="label">Mark-to-market</div><div class="value ' + (st.unrealized >= 0 ? 'up' : 'down') + '">' + usd(st.unrealized) + '</div><div class="note">against the latest observed price</div></div>';
      }
      if (tradesBody) {
        var rows = trades.slice().reverse();
        tradesBody.innerHTML = rows.length ? rows.map(function (t) {
          var m = state.markets[t.ticker];
          var live = m ? (m.last_price_dollars !== null && m.last_price_dollars !== undefined ? cents(m.last_price_dollars) : '—') : '—';
          var strat = STRATEGIES.filter(function (s) { return s.id === t.strategy; })[0];
          return '<tr><td>' + dt(t.ts) + '</td>' +
            '<td><a href="' + rootHref('market.html?ticker=') + encodeURIComponent(t.ticker) + '">' + esc(t.title || t.ticker) + '</a><br><span class="ticker">' + esc(t.ticker) + '</span></td>' +
            '<td><span class="tag ' + esc(topicOf(t.topic).id) + '">' + esc(topicOf(t.topic).label) + '</span></td>' +
            '<td>' + esc(t.side) + '</td>' +
            '<td class="num">' + num(t.qty) + '</td>' +
            '<td class="num">' + cents(t.price) + '</td>' +
            '<td class="num">' + live + '</td>' +
            '<td>' + esc(strat ? strat.label : (t.strategy || 'manual')) + '</td>' +
            '<td>' + (t.status === 'settled'
              ? '<span class="badge ' + (t.pnl >= 0 ? 'good' : 'bad') + '">' + usd(t.pnl) + '</span>'
              : '<span class="badge neutral">open</span>') + '</td>' +
            '<td>' + (t.result ? '<span class="badge ' + (t.result === 'yes' ? 'good' : 'bad') + '">' + esc(t.result) + '</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td class="src">' + (t.source_url ? '<a href="' + esc(t.source_url) + '" target="_blank" rel="noopener">row</a>' : '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="11" class="muted">No simulated trades yet. Enable the auto-trader below, or place one from the Market page.</td></tr>';
      }
      if (curve) {
        var pts = [];
        var cum = 0;
        trades.filter(function (t) { return t.status === 'settled'; })
          .sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); })
          .forEach(function (t) {
            cum += t.pnl || 0;
            pts.push({ t: Math.floor(new Date(t.ts).getTime() / 1000), v: cum });
          });
        if (window.KDChart) KDChart.line(curve, pts, { windowSeconds: Math.max(3600, 86400 * 30), zoom: true, fill: true, color: '#4c9aff', hover: false });
      }
    }
    state.listeners.push(paint);
    paint();

    var auto = $('#auto-trade');
    if (auto) {
      auto.checked = settings().autoTrade;
      auto.addEventListener('change', function () { saveSettings({ autoTrade: auto.checked }); });
    }
    var reset = $('#reset-trades');
    if (reset) reset.addEventListener('click', function () {
      if (confirm('Delete all simulated trades stored in this browser?')) { setTrades([]); paint(); emit('trades'); }
    });
  };

  /* ----------------------------------------------------------- analysis page */
  pages.analysis = function () {
    var body = $('#analysis-body');
    var stratBody = tbodyOf('strategy-stats');
    var topicBody = tbodyOf('topic-stats');

    function paint() {
      var trades = getTrades();
      var st = portfolioStats(trades);
      if (stratBody) {
        var keys = Object.keys(st.byStrategy);
        stratBody.innerHTML = keys.length ? keys.map(function (k) {
          var v = st.byStrategy[k];
          var label = (STRATEGIES.filter(function (s) { return s.id === k; })[0] || {}).label || k;
          var wr = (v.wins + v.losses) ? (v.wins / (v.wins + v.losses)) : null;
          return '<tr><td><strong>' + esc(label) + '</strong><br><span class="small muted">' + esc(k) + '</span></td>' +
            '<td class="num">' + v.trades + '</td><td class="num">' + v.open + '</td>' +
            '<td class="num">' + (wr === null ? '—' : pct(wr, 1)) + '</td>' +
            '<td class="num ' + (v.pnl >= 0 ? 'up' : 'down') + '">' + usd(v.pnl) + '</td>' +
            '<td class="num">' + (v.trades ? usd(v.pnl / v.trades) : '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="muted">No simulated trades categorised yet.</td></tr>';
      }
      if (topicBody) {
        var tkeys = Object.keys(st.byTopic);
        topicBody.innerHTML = tkeys.length ? tkeys.map(function (k) {
          var v = st.byTopic[k];
          var wr = (v.wins + v.losses) ? (v.wins / (v.wins + v.losses)) : null;
          return '<tr><td><span class="tag ' + esc(k) + '">' + esc(topicOf(k).label) + '</span></td>' +
            '<td class="num">' + v.trades + '</td><td class="num">' + v.open + '</td>' +
            '<td class="num">' + (wr === null ? '—' : pct(wr, 1)) + '</td>' +
            '<td class="num ' + (v.pnl >= 0 ? 'up' : 'down') + '">' + usd(v.pnl) + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">No simulated trades categorised yet.</td></tr>';
      }
      if (body) {
        var rows = trades.slice().reverse();
        body.innerHTML = rows.length ? rows.map(function (t) {
          var strat = (STRATEGIES.filter(function (s) { return s.id === t.strategy; })[0] || {}).label || t.strategy;
          return '<tr><td>' + dt(t.ts) + '</td><td>' + esc(t.title || t.ticker) + '</td>' +
            '<td><span class="tag ' + esc(topicOf(t.topic).id) + '">' + esc(topicOf(t.topic).label) + '</span></td>' +
            '<td>' + esc(strat) + '</td><td>' + esc(t.side) + '</td><td class="num">' + num(t.qty) + '</td>' +
            '<td class="num">' + cents(t.price) + '</td>' +
            '<td>' + (t.status === 'settled' ? '<span class="badge ' + (t.pnl >= 0 ? 'good' : 'bad') + '">' + usd(t.pnl) + '</span>' : '<span class="badge neutral">open</span>') + '</td>' +
            '<td>' + (t.result ? esc(t.result) : '—') + '</td>' +
            '<td class="small">' + esc(t.why || '') + '</td></tr>';
        }).join('') : '<tr><td colspan="10" class="muted">No simulated trades yet — run the auto-trader from the Portfolio page and come back.</td></tr>';
      }
    }
    state.listeners.push(paint);
    paint();
  };

  /* ============================================================== lifecycle */
  function startPolling() {
    stopPolling();
    var s = settings();
    state.pollTimer = setInterval(function () {
      pollPrices().then(function () {
        settleTrades();
        autoTradeStep();
        emit('poll-done');
      });
    }, Math.max(2000, s.pollMs));
    pollPrices().then(function () { settleTrades(); autoTradeStep(); emit('poll-done'); });
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  function startUniverseRefresh() {
    state.universeTimer = setInterval(function () { refreshUniverse(); }, 10 * 60 * 1000);

    /* Chart accumulation while the tab is open. detectSwing() records one [time, price] point per
     * market per poll, but the market page only redrew the chart after an explicit action (window
     * button, ticker change, resize). A trader watching a market therefore saw a chart that did
     * not move even though the poller was collecting points behind it. This redraws the chart and
     * the book ~5 times a second at most, only when this is the market page and only if it exists,
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
    loadSnapshot().then(function () {
      if (pages[page]) pages[page]();
    });

    probe().then(function (live) {
      emit('mode');
      if (live) {
        return refreshUniverse().then(function () {
          startPolling();
          startUniverseRefresh();
          emit('universe');
        });
      }
    });

    window.addEventListener('resize', function () {
      emit('resize');
    });

    /* expose for debugging and for the QA logic test */
    window.KD = {
      CFG: CFG, STRATEGIES: STRATEGIES, state: state, fmt: { usd: usd, cents: cents, num: num, pct: pct, esc: esc },
      api: { get: apiGet },   /* no signed/browser-side key handling: keys never reach the browser (see demo-account) */
      roi: roiOf, portfolioStats: portfolioStats, settings: settings, saveSettings: saveSettings,
      getTrades: getTrades, setTrades: setTrades, getAlerts: getAlerts, setAlerts: setAlerts,
      refPrice: refPrice, detectSwing: detectSwing, emit: emit
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
