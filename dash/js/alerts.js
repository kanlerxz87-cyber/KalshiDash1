/* alerts.js — merged live alerting engine for dash/alerts.html.
 *
 * Lineage (reconciliation recorded in COORDINATION.md, session arena-f89b55f7):
 *  - arena/815b546d: trade-by-trade swing detection (GET /markets/trades — Get Trades docs),
 *    snapshot trades_sample replay, catalyst links from series settlement sources,
 *    resolutions in the feed, the normalized ROI-proxy model (modelScore/computeNorms),
 *    the `window.Alerts` API consumed by dash/js/autotrade.js and tools/qa_alert_test.mjs.
 *  - arena-f89b55f7: batched quote polling (GET /markets?tickers=… — 1 request per cycle),
 *    stale-baseline guard + same-direction dedup, transparent 4-component ROI model with a
 *    "likes ≥ 70" filter, automated simulated strategies (momentum-10c / fade-jump) wired into
 *    Store → Portfolio/Analysis, chart with jump markers, liquidity ladder, cause-research links,
 *    the `window.AlertsEngineCore` pure API consumed by tools/alerts-qa.mjs.
 *
 * Merged behavior: each poll cycle (1) one batched quote request updates every tracked market;
 * (2) the four highest-dollar tracked markets are additionally walked trade-by-trade, each trade
 * processed exactly once (dedup by created_time — fixes the re-fire loop the standalone trade-walk
 * had), so alerts carry exact trade timestamps. Snapshot mode replays the verified trades_sample.
 *
 * Verified mechanics (dash/sources.html): prices in dollars 0..1 tick $0.01; NO = 1 − YES;
 * `tickers`-only requests return every matching market in one response; REST responses are cached
 * briefly (alert timestamps can lag fills — flagged F-08); unauthenticated requests have separate
 * rate limits — the engine issues ~5 requests per 15 s cycle with exponential backoff.
 */
(function () {
  'use strict';

  /* =====================================================================
   * PART 1 — pure decision core (window.AlertsEngineCore; tested by tools/alerts-qa.mjs)
   * ===================================================================== */

  var DEFAULTS = {
    alertThreshold: 0.10,        /* $0.10 — the brief's swing threshold, both directions */
    staleMs: 15 * 60 * 1000,     /* observation gap > 15 min ⇒ re-baseline (no swing across the gap) */
    dedupMs: 60 * 1000,          /* same-direction duplicate alert suppression window */
    modelLike: 70,               /* score ≥ 70 ⇒ "model likes" */
    weights: { liquidity: 0.35, spread: 0.20, momentum: 0.25, band: 0.20 },
    liquidityRef: 2000,          /* 24h $ volume mapping to liquidity=1 (log scale; calibrated to the 2026-11-20 demo snapshot top rows) */
    tradeNotional: 5,            /* simulated $ committed per automated entry */
    maxOpen: 3,                  /* max simultaneous automated positions (this engine) */
    exitDelta: 0.10,             /* take-profit / stop-loss distance ($) */
    timeoutMs: 15 * 60 * 1000,   /* time stop for automated positions */
    perTopic: 6,                 /* tracked markets per focus topic (highest dollar first) */
    cap: 40,                     /* overall tracked-market cap */
    tradeWalkN: 4                /* highest-dollar markets additionally walked trade-by-trade */
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function detectSwing(prev, next, cfg, nowMs) {
    cfg = cfg || DEFAULTS;
    var now = nowMs || Date.now();
    if (!prev || !next) return null;
    var p = num(prev.price), n = num(next.price);
    if (p === null || n === null) return null;
    if (!prev.tsMs || (now - prev.tsMs) > cfg.staleMs) return null;
    var delta = round4(n - p);
    if (Math.abs(delta) + 1e-9 < cfg.alertThreshold) return null;
    return { from: p, to: n, delta: delta, dir: delta > 0 ? 'up' : 'down' };
  }

  function shouldAlert(lastAlertMeta, dir, cfg, nowMs) {
    cfg = cfg || DEFAULTS;
    var now = nowMs || Date.now();
    if (!lastAlertMeta || lastAlertMeta.dir !== dir) return true;
    return (now - lastAlertMeta.tsMs) > cfg.dedupMs;
  }

  function volOf(m) {
    var v = num(m && m.volume_24h_fp);
    if (v === null) v = num(m && m.volume_fp);
    return v || 0;
  }

  function scoreMarket(m, ctx, cfg) {
    cfg = cfg || DEFAULTS;
    ctx = ctx || {};
    var vol = volOf(m);
    var liquidity = clamp(Math.log10(1 + Math.max(0, vol)) / Math.log10(1 + cfg.liquidityRef), 0, 1);
    var bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars);
    var spreadPart;
    if (bid === null || ask === null) spreadPart = 0.25;
    else {
      var sp = Math.max(0, ask - bid);
      spreadPart = clamp(1 - (sp - 0.01) / 0.09, 0, 1);
    }
    var mom = clamp(Math.abs(ctx.recentDelta || 0) / cfg.alertThreshold, 0, 1);
    var mid = (bid !== null && ask !== null) ? (bid + ask) / 2 : num(m.last_price_dollars);
    var band = 0;
    if (mid !== null) {
      if (mid >= 0.15 && mid <= 0.85) band = 1;
      else if (mid < 0.15) band = clamp((mid - 0.02) / 0.13, 0, 1);
      else band = clamp((0.98 - mid) / 0.13, 0, 1);
    }
    var score = Math.round(100 * (
      cfg.weights.liquidity * liquidity +
      cfg.weights.spread * spreadPart +
      cfg.weights.momentum * mom +
      cfg.weights.band * band
    ));
    return {
      score: score,
      liked: score >= cfg.modelLike,
      parts: { liquidity: liquidity, spread: spreadPart, momentum: mom, band: band },
      inputs: { volume_24h: vol, bid: bid, ask: ask, mid: mid, recentDelta: ctx.recentDelta || 0 }
    };
  }

  function tradeable(m) {
    var r = m.result || '';
    return !r && (m.status === 'active' || m.status === 'open' || m.status === 'initialized');
  }

  function pickTracked(rows, cfg) {
    cfg = cfg || DEFAULTS;
    var byTopic = {};
    rows.filter(tradeable).forEach(function (m) {
      var t = m.topic || 'other';
      byTopic[t] = byTopic[t] || [];
      byTopic[t].push(m);
    });
    var out = [];
    Object.keys(byTopic).forEach(function (t) {
      byTopic[t].sort(function (a, b) { return volOf(b) - volOf(a); });
      out = out.concat(byTopic[t].slice(0, cfg.perTopic));
    });
    out.sort(function (a, b) { return volOf(b) - volOf(a); });
    return out.slice(0, cfg.cap);
  }

  function planEntry(alert, scored, state, cfg) {
    cfg = cfg || DEFAULTS;
    if ((state && state.openCount || 0) >= cfg.maxOpen) return null;
    if (state && state.byTicker && state.byTicker[alert.ticker]) return null;
    var ask = num(alert.yes_ask), bid = num(alert.yes_bid);
    var noBid = num(alert.no_bid), noAsk = num(alert.no_ask);
    function ok(p) { return p !== null && p >= 0.02 && p <= 0.95; }
    function qty(p) { return Math.max(1, Math.floor(cfg.tradeNotional / p)); }
    if (alert.dir === 'up') {
      if (scored.liked && ok(ask)) {
        return { strategy: 'momentum-10c', side: 'yes', price: round4(ask), qty: qty(ask),
                 reason: 'model likes it (score ' + scored.score + '): enter with the ≥$0.10 jump at the ask' };
      }
      if (!scored.liked && ok(noBid)) {
        return { strategy: 'fade-jump', side: 'no', price: round4(noBid), qty: qty(noBid),
                 reason: 'fade: the model does not like this jump (score ' + scored.score + '); buy NO at its bid' };
      }
      return null;
    }
    if (scored.liked && ok(noAsk)) {
      return { strategy: 'momentum-10c', side: 'no', price: round4(noAsk), qty: qty(noAsk),
               reason: 'model likes it (score ' + scored.score + '): ride the ≥$0.10 drop on the NO side at its ask' };
    }
    if (!scored.liked && ok(ask)) {
      return { strategy: 'fade-jump', side: 'yes', price: round4(ask), qty: qty(ask),
               reason: 'fade: the model does not like this drop (score ' + scored.score + '); buy YES at its ask' };
    }
    return null;
  }

  function planExit(pos, lastPrice, cfg, nowMs) {
    cfg = cfg || DEFAULTS;
    var now = nowMs || Date.now();
    if (!pos || pos.status !== 'open') return null;
    var entry = num(pos.price), last = num(lastPrice);
    if (entry === null || last === null) return null;
    var cur = pos.side === 'no' ? round4(1 - last) : last;
    var d = round4(cur - entry);
    var reason = null;
    if (d >= cfg.exitDelta) reason = 'take-profit ≥ $' + cfg.exitDelta.toFixed(2);
    else if (d <= -cfg.exitDelta) reason = 'stop-loss ≥ $' + cfg.exitDelta.toFixed(2);
    else if (pos.openedMs && (now - pos.openedMs) >= cfg.timeoutMs) reason = 'time-stop (15 min)';
    if (!reason) return null;
    return { exitPrice: cur, pnl: round4((cur - entry) * pos.qty), reason: reason };
  }

  window.AlertsEngineCore = {
    DEFAULTS: DEFAULTS,
    num: num, round4: round4, clamp: clamp,
    detectSwing: detectSwing, shouldAlert: shouldAlert,
    scoreMarket: scoreMarket, pickTracked: pickTracked, tradeable: tradeable,
    planEntry: planEntry, planExit: planExit
  };

  /* =====================================================================
   * PART 2 — normalized ROI proxy (arena/815b546d, kept verbatim for
   * dash/js/autotrade.js and tools/qa_alert_test.mjs compatibility)
   * ===================================================================== */

  function modelScore(m, norms) {
    var fp = num;
    var vol = fp(m.volume_24h_fp) || 0, oi = fp(m.open_interest_fp) || 0;
    var price = fp(m.last_price_dollars);
    if (price === null) return null;
    var liq = (norms && norms.liq && norms.liq[m.ticker]) || 0;
    var oiN = (norms && norms.oi && norms.oi[m.ticker]) || 0;
    var opp = Math.abs(0.5 - price) * 2;
    return {
      score: Math.round((0.40 * liq + 0.30 * oiN + 0.30 * opp) * 1000) / 1000,
      roiYes: Math.round((1 - price) * (0.5 + liq) * 1000) / 1000,
      roiNo: Math.round(price * (0.5 + liq) * 1000) / 1000
    };
  }

  function computeNorms(rows) {
    var maxVol = 1, maxOi = 1;
    (rows || []).forEach(function (m) {
      maxVol = Math.max(maxVol, num(m.volume_24h_fp) || 0);
      maxOi = Math.max(maxOi, num(m.open_interest_fp) || 0);
    });
    var liq = {}, oi = {};
    (rows || []).forEach(function (m) {
      liq[m.ticker] = (num(m.volume_24h_fp) || 0) / maxVol;
      oi[m.ticker] = (num(m.open_interest_fp) || 0) / maxOi;
    });
    return { liq: liq, oi: oi };
  }

  /* =====================================================================
   * PART 3 — engine state + persistence
   * ===================================================================== */

  var K = window.K, Data = window.Data;
  /* Store must be looked up lazily: dash/js/autotrade.html and the Node harnesses load this file
   * BEFORE store.js, so a load-time capture would freeze null. */
  function Store() { return window.Store || null; }
  var NS_A = 'kalshidash:alerts:v1:';      /* feed/baseline namespace (arena/815b546d) */
  var POLL_MS = 15000, MAX_POLL_MS = 60000, FEED_CAP = 300;

  function aGet(key, fb) {
    try { var raw = localStorage.getItem(NS_A + key); return raw ? JSON.parse(raw) : fb; }
    catch (e) { return fb; }
  }
  function aSet(key, v) { try { localStorage.setItem(NS_A + key, JSON.stringify(v)); } catch (e) {} }

  var state = {
    /* public feed surface (arena/815b546d shape, superseted fields added) */
    feed: aGet('feed', null) || [],
    baseline: aGet('baseline', {}),          /* ticker -> last YES price (number) */
    lastTradeTs: aGet('lasttrade', {}),      /* ticker -> newest processed trade created_time */
    paused: false,
    live: false,
    stats: { alerts: 0, up: 0, down: 0, resolutions: 0 },
    /* extended engine state (arena-f89b55f7) */
    obs: {},                                 /* ticker -> {price, tsMs} for the stale guard */
    alertMeta: {},                           /* ticker -> {dir, tsMs} dedup */
    history: {},                             /* ticker -> [{t(sec), v}] */
    simfeed: [],
    polls: 0,
    fails: 0,
    pollMs: POLL_MS,
    autoTrade: true,
    tracked: [],
    pollList: [],
    norms: { liq: {}, oi: {} },
    seriesMap: {},
    selected: null,
    selectedRow: null,
    seriesTicker: null,
    candles: { 1: [], 60: [] },
    windowId: '5m',
    stopped: false,
    snapshotNote: false
  };
  if (!state.feed.length) state.feed = [];
  if (Store()) {
    state.simfeed = Store().getJSON('simfeed', []) || [];
    state.autoTrade = Store().getJSON('autotrade', true);
  }
  state.stats = aGet('stats', state.stats) || state.stats;

  function saveAll() {
    aSet('feed', state.feed.slice(0, FEED_CAP));
    aSet('baseline', state.baseline);
    aSet('lasttrade', state.lastTradeTs);
    aSet('stats', state.stats);
    aSet('obs', state.obs);
    aSet('alertmeta', state.alertMeta);
    aSet('pricehist', pruneHistory());
    if (Store()) {
      Store().setJSON('simfeed', state.simfeed.slice(0, 300));
      Store().setJSON('autotrade', state.autoTrade);
    }
  }
  function pruneHistory() {
    var cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
    var out = {};
    Object.keys(state.history).forEach(function (tk) {
      out[tk] = state.history[tk].filter(function (p) { return p.t >= cutoff; }).slice(-800);
      if (!out[tk].length) delete out[tk];
    });
    return out;
  }

  /* ---------- catalyst links (settlement sources; both lineages) ---------- */
  function parseSettlement(s) {
    var out = [], re = /([^;\(]+?)\s*\((https?:[^)]+)\)/g, m;
    while ((m = re.exec(String(s || ''))) !== null) out.push({ name: m[1].trim(), url: m[2] });
    return out;
  }
  function catalystsFor(seriesTicker) {
    if (!seriesTicker) return [];
    if (state.seriesMap[seriesTicker]) return state.seriesMap[seriesTicker];
    var out = [];
    Object.keys(Data.cache.series || {}).forEach(function (tid) {
      (Data.cache.series[tid] || []).forEach(function (s) {
        if (s.ticker !== seriesTicker) return;
        parseSettlement(s.settlement_source).forEach(function (c) { out.push(c); });
      });
    });
    return out;
  }
  function newsUrl(title) {
    return 'https://news.google.com/search?q=' + encodeURIComponent(title || '');
  }
  function buildSeriesMap() {
    return Promise.all((K.cfg.topics || []).map(function (t) {
      return Data.loadTopicSeries(t.id).then(function (rows) {
        rows.forEach(function (s) {
          var src = parseSettlement(s.settlement_source);
          if (src.length) state.seriesMap[s.ticker] = src;
        });
      }).catch(function () {});
    }));
  }

  /* =====================================================================
   * PART 4 — feed entries
   * ===================================================================== */

  function makeEntry(m, hit, kind, extras) {
    extras = extras || {};
    var roi = extras.roi !== undefined ? extras.roi : null;
    return {
      id: 'al-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      ts: extras.ts || new Date().toISOString(),
      tsMs: extras.tsMs || Date.parse(extras.ts || new Date().toISOString()),
      ticker: m.ticker,
      title: m.title || m.ticker,
      topic: m.topic || 'other',
      event_ticker: m.event_ticker || null,
      series_ticker: m.series_ticker || null,
      side: hit.side,                      /* 'up' | 'down' (arena/815b546d vocabulary) */
      from: hit.from, to: hit.to,
      delta: extras.delta !== undefined ? extras.delta : round4(hit.to - hit.from),
      kind: kind,                          /* 'swing' | 'resolution' */
      roi: roi === null ? null : roi.score,
      roiYes: roi ? roi.roiYes : null,
      roiNo: roi ? roi.roiNo : null,
      score: extras.score !== undefined ? extras.score : null,
      liked: extras.liked !== undefined ? extras.liked : null,
      yes_bid: m.yes_bid_dollars || null, yes_ask: m.yes_ask_dollars || null,
      no_bid: m.no_bid_dollars || null, no_ask: m.no_ask_dollars || null,
      vol24: m.volume_24h_fp || null, oi: m.open_interest_fp || null,
      catalysts: catalystsFor(m.series_ticker),
      source: extras.source || m.source_url || (K.state.base + '/markets/' + encodeURIComponent(m.ticker)),
      resolved: m.result || '',
      replay: extras.replay || false
    };
  }

  function pushEntry(e) {
    state.feed.unshift(e);
    if (state.feed.length > FEED_CAP) state.feed.length = FEED_CAP;
    if (e.kind === 'resolution') state.stats.resolutions++;
    else {
      state.stats.alerts++;
      if (e.side === 'up') state.stats.up++; else state.stats.down++;
    }
    if (pageBooted) {
      feedPrepend(e);
      if (e.ticker === state.selected) { renderDetailHeader(); renderCause(); }
      tickChats();
    }
    return e;
  }

  function latestAlertFor(ticker) {
    for (var i = 0; i < state.feed.length; i++) {
      if (state.feed[i].ticker === ticker && state.feed[i].kind === 'swing') return state.feed[i];
    }
    return null;
  }

  /* =====================================================================
   * PART 5 — watch set (highest-dollar per focus topic) + ROI norms
   * ===================================================================== */

  function buildPollList() {
    var seen = {}, list = [];
    state.tracked.forEach(function (m) {
      if (!seen[m.ticker]) { seen[m.ticker] = 1; list.push(m.ticker); }
    });
    openAutoTrades().forEach(function (t) {   /* pin open positions so exits are evaluated */
      if (!seen[t.ticker]) { seen[t.ticker] = 1; list.push(t.ticker); }
    });
    state.pollList = list.slice(0, 45);
  }

  function buildTrackSet(force) {
    return Data.allMarkets({ force: !!force, topN: DEFAULTS.perTopic }).then(function (rows) {
      state.tracked = pickTracked(rows, DEFAULTS);
      state.norms = computeNorms(state.tracked);
      buildPollList();
      if (pageBooted) renderModelTable();
      return state.tracked;
    });
  }

  function refresh() { return buildTrackSet(false); }  /* arena/815b546d public API */

  function openAutoTrades() {
    return Store().getTrades().filter(function (t) {
      return t.status === 'open' && !t.seed &&
        (t.strategy === 'momentum-10c' || t.strategy === 'fade-jump');
    });
  }

  function recentDeltaOf(ticker, nowMs) {
    var pts = state.history[ticker] || [];
    var now = nowMs || Date.now();
    var win = now - 30 * 60 * 1000;
    var max = 0;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].t * 1000 < win) continue;
      var d = Math.abs(pts[i].v - pts[i - 1].v);
      if (d > max) max = d;
    }
    return round4(max);
  }

  /* =====================================================================
   * PART 6 — detection
   * ===================================================================== */

  function pollQueryUrl() {
    return K.state.base + '/markets?tickers=' + state.pollList.map(encodeURIComponent).join(',');
  }

  function processRows(markets, nowMs) {
    var now = nowMs || Date.now();
    var topicByTicker = {}, tradeByTicker = {};
    state.tracked.forEach(function (m) { topicByTicker[m.ticker] = m.topic; });
    if (Store) Store().getTrades().forEach(function (t) { tradeByTicker[t.ticker] = t.topic; });

    var rowsByTicker = {};
    (markets || []).forEach(function (m) {
      rowsByTicker[m.ticker] = m;
      var v = num(m.last_price_dollars);
      if (v === null) return;                       /* never invent a price */
      var tSec = Math.floor(now / 1000);
      var h = state.history[m.ticker] = state.history[m.ticker] || [];
      var lastPt = h[h.length - 1];
      if (!lastPt || lastPt.t !== tSec || lastPt.v !== v) h.push({ t: tSec, v: v });
      if (h.length > 1600) state.history[m.ticker] = h.slice(-800);

      /* resolution tracking (tracked markets are unresolved; the result field flipping is
       * how "how the event was resolved — yes or no" is observed) */
      if (m.result && !state.baseline['res:' + m.ticker]) {
        state.baseline['res:' + m.ticker] = m.result;
        pushEntry(makeEntry(m, { side: m.result === 'yes' ? 'up' : 'down', from: 0, to: 1 },
          'resolution', { roi: modelScore(m, state.norms), source: m.source_url || pollQueryUrl() }));
        if (Store) Store().settleTrades((function (o) { o[m.ticker] = m.result; return o; })({}));
      }

      var prev = state.obs[m.ticker];
      state.obs[m.ticker] = { price: v, tsMs: now };
      state.baseline[m.ticker] = v;

      var swing = prev ? detectSwing(prev, { price: v, tsMs: now }, DEFAULTS, now) : null;
      if (!swing) return;
      if (!shouldAlert(state.alertMeta[m.ticker], swing.dir, DEFAULTS, now)) return;
      state.alertMeta[m.ticker] = { dir: swing.dir, tsMs: now };

      fireSwing(m, swing, { recentDelta: recentDeltaOf(m.ticker, now) },
        { source: pollQueryUrl(), tsMs: now, ts: new Date(now).toISOString() });
    });

    evaluateExits(rowsByTicker, now);
    if (pageBooted) {
      if (state.selected && rowsByTicker[state.selected]) {
        state.selectedRow = rowsByTicker[state.selected];
        renderDetailHeader();
      }
      saveAll();
      renderStatus();
    }
    return rowsByTicker;
  }

  function fireSwing(m, swing, ctx, extras) {
    var scored = scoreMarket(m, ctx, DEFAULTS);
    var roi = modelScore(m, state.norms);
    var e = pushEntry(makeEntry(m, { side: swing.dir, from: swing.from, to: swing.to },
      'swing', {
        roi: roi, score: scored.score, liked: scored.liked,
        source: extras && extras.source, ts: extras && extras.ts, tsMs: extras && extras.tsMs,
        delta: swing.delta
      }));
    maybeAutoTrade(m, scored, swing, extras && extras.tsMs);
    return e;
  }

  /* trade-by-trade walk over the highest-dollar tracked markets
   * (arena/815b546d detector; each trade processed exactly once via lastTradeTs) */
  function tradeWalk(nowMs) {
    var now = nowMs || Date.now();
    var top = state.tracked.slice().sort(function (a, b) { return volOf(b) - volOf(a); })
      .slice(0, DEFAULTS.tradeWalkN).filter(function (m) { return !m.fromSnapshot; });
    return Promise.all(top.map(function (m) {
      var q = '/markets/trades?ticker=' + encodeURIComponent(m.ticker) + '&limit=100';
      var url = K.state.base + q;
      return K.get(q, { timeoutMs: 9000 }).then(function (r) {
        var trades = (r.data.trades || []).filter(function (t) { return num(t.yes_price_dollars) !== null; });
        trades.sort(function (a, b) { return String(b.created_time).localeCompare(String(a.created_time)); });
        var lastTs = state.lastTradeTs[m.ticker];
        var newest = trades.length ? trades[0] : null;
        /* process oldest→newest among trades newer than the last processed one */
        var fresh = lastTs
          ? trades.filter(function (t) { return String(t.created_time).localeCompare(String(lastTs)) > 0; })
          : trades.slice(0, 1); /* first run: baseline on the newest trade only (no historical spam) */
        fresh.reverse().forEach(function (t) {
          var p = num(t.yes_price_dollars);
          var prev = state.baseline[m.ticker];
          if (typeof prev === 'number' && Math.abs(p - prev) + 1e-9 >= DEFAULTS.alertThreshold) {
            var ctx = { recentDelta: recentDeltaOf(m.ticker, now) };
            fireSwing(m, { dir: p > prev ? 'up' : 'down', from: prev, to: p, delta: round4(p - prev) }, ctx,
              { source: url, ts: t.created_time, tsMs: Date.parse(t.created_time) });
          }
          state.baseline[m.ticker] = p;
          state.lastTradeTs[m.ticker] = t.created_time;
        });
        if (newest) state.obs[m.ticker] = { price: num(newest.yes_price_dollars), tsMs: now };
      }).catch(function () {});
    }));
  }

  function maybeAutoTrade(m, scored, swing, nowMs) {
    if (!state.autoTrade || !Store) return;
    var now = nowMs || Date.now();
    var st = { openCount: openAutoTrades().length, byTicker: {} };
    openAutoTrades().forEach(function (t) { st.byTicker[t.ticker] = true; });
    var plan = planEntry({
      ticker: m.ticker, dir: swing.dir,
      yes_ask: m.yes_ask_dollars, yes_bid: m.yes_bid_dollars,
      no_bid: m.no_bid_dollars, no_ask: m.no_ask_dollars
    }, scored, st, DEFAULTS);
    if (!plan) return;
    var topic = m.topic || 'other';
    var tr = Store().addTrade({
      ticker: m.ticker, title: m.title || m.ticker, topic: topic,
      side: plan.side, price: plan.price, qty: plan.qty,
      strategy: plan.strategy, fee: 0, auto: true
    });
    var sim = { kind: 'entry', tsMs: now, ticker: m.ticker, title: m.title || m.ticker, topic: topic,
                side: plan.side, price: plan.price, qty: plan.qty, strategy: plan.strategy,
                reason: plan.reason, score: scored.score, id: tr.id };
    state.simfeed.push(sim);
    if (pageBooted) { simPrepend(sim); tickChats(); }
  }

  function evaluateExits(rowsByTicker, nowMs) {
    if (!Store) return;
    var now = nowMs || Date.now();
    openAutoTrades().forEach(function (t) {
      var m = rowsByTicker && rowsByTicker[t.ticker];
      if (!m) return;
      var last = num(m.last_price_dollars);
      if (last === null) return;
      var exit = planExit({ side: t.side, price: t.price, qty: t.qty, openedMs: Date.parse(t.ts), status: 'open' },
        last, DEFAULTS, now);
      if (!exit) return;
      Store().updateTrade(t.id, {
        status: 'settled', exit_price: exit.exitPrice, pnl: exit.pnl,
        exit_reason: exit.reason, result: t.result || ''
      });
      var sim = { kind: 'exit', tsMs: now, ticker: t.ticker, title: t.title, topic: t.topic,
                  exitPrice: exit.exitPrice, pnl: exit.pnl, reason: exit.reason, strategy: t.strategy };
      state.simfeed.push(sim);
      if (pageBooted) { simPrepend(sim); tickChats(); }
    });
  }

  /* snapshot replay (arena/815b546d): verified trades_sample through the same detector */
  function replay() {
    return Data.snapshot().then(function (snap) {
      var ts = snap.trades_sample;
      if (!ts || !ts.trades) return null;
      var m = state.tracked.filter(function (r) { return r.ticker === ts.ticker; })[0] ||
              Object.assign({ topic: 'crypto', source_url: ts.source_url }, { ticker: ts.ticker, title: ts.ticker });
      var byTs = ts.trades.slice().sort(function (a, b) { return String(b.created_time).localeCompare(String(a.created_time)); });
      var priced = byTs.filter(function (t) { return num(t.yes_price_dollars) !== null; });
      if (priced.length < 2) return null;
      for (var i = 1; i < priced.length; i++) {
        var a = num(priced[i - 1].yes_price_dollars), b = num(priced[i].yes_price_dollars);
        if (Math.abs(a - b) + 1e-9 >= DEFAULTS.alertThreshold) {
          var already = state.feed.some(function (x) {
            return x.ticker === ts.ticker && x.kind === 'swing' && x.replay;
          });
          if (already) return null;
          var e = makeEntry(m, { side: a > b ? 'up' : 'down', from: b, to: a }, 'swing', {
            roi: modelScore(m, state.norms), ts: priced[0].created_time,
            source: ts.source_url, replay: true, delta: round4(a - b)
          });
          pushEntry(e);
          if (pageBooted) { saveAll(); renderFeeds(); }
          return e;
        }
      }
      return null;
    });
  }

  /* =====================================================================
   * PART 7 — poll loop
   * ===================================================================== */

  function poll() {
    if (state.stopped) return;
    if (state.paused || document.hidden) { schedule(); return; }
    if (!state.pollList.length) {
      buildTrackSet(false).then(function () {
        if (state.pollList.length) pollOnce(); else schedule();
      }).catch(function () { schedule(); });
      return;
    }
    pollOnce();
    function pollOnce() {
      K.get('/markets?tickers=' + state.pollList.map(encodeURIComponent).join(','), { timeoutMs: 9000 })
        .then(function (r) {
          state.polls++; state.fails = 0; state.pollMs = POLL_MS;
          state.live = K.state.mode === 'live' || K.state.mode === 'legacy';
          processRows((r.data && r.data.markets) || [], Date.now());
          return tradeWalk(Date.now()).then(function () {
            onPollSuccess();
            if (pageBooted && state.selected && !document.hidden) loadDetail(state.selected);
            schedule();
          });
        })
        .catch(function (e) {
          state.fails++;
          state.pollMs = Math.min(MAX_POLL_MS, POLL_MS * Math.pow(2, state.fails));
          onPollFail(e);
          if (pageBooted) renderStatus();
          schedule();
        });
    }
  }
  function schedule() {
    if (state.stopped) return;
    setTimeout(function () { poll(); }, state.pollMs);
  }

  function onPollSuccess() {
    if (!pageBooted) return;
    document.getElementById('engine-notice').className = 'notice good';
    document.getElementById('engine-notice').innerHTML =
      '<strong>Live alert engine running.</strong> Per cycle: one batched <code>GET /markets?tickers=…</code> quote poll on ' +
      K.esc(K.state.base) + ' plus a trade-by-trade walk (<a href="https://docs.kalshi.com/api-reference/market/get-trades" target="_blank" rel="noopener">Get Trades</a>) of the ' +
      DEFAULTS.tradeWalkN + ' highest-dollar tracked markets. Alerts fire on moves ≥ $0.10 in either direction. REST responses are cached briefly per the docs, ' +
      'so timestamps can lag fills by the cache lag + one poll cycle (<a href="flagged.html">F-08</a>).';
  }
  function onPollFail(e) {
    if (!pageBooted) { if (K.state.mode === 'snapshot') stopEngine(); return; }
    if (K.state.mode === 'snapshot') { stopEngine(); return; }
    document.getElementById('engine-notice').className = 'notice warn';
    document.getElementById('engine-notice').innerHTML =
      '<strong>Poll failed (' + K.esc(String(e && e.message || e)) + ')</strong> — retrying with backoff. ' +
      'Unauthenticated requests have separate rate limits; the engine backs off on failures ' +
      '(<a href="https://docs.kalshi.com/getting_started/rate_limits" target="_blank" rel="noopener">docs</a>).';
  }
  function stopEngine() {
    state.stopped = true;
    state.snapshotNote = true;
    if (!pageBooted) return;
    document.getElementById('engine-notice').className = 'notice warn';
    document.getElementById('engine-notice').innerHTML =
      '<strong>Snapshot mode — live alerting is off.</strong> Your browser could not reach the demo API directly ' +
      '(likely CORS or network policy). Nothing is simulated to fill the gap: the feeds show alerts already stored in this ' +
      'browser plus the verified snapshot trades replay below (labeled <em>replay</em>), and the model table shows the ' +
      'verified snapshot rows. For live data run <code>node scripts/local-proxy.mjs</code> locally (see README) — ' +
      'see <a href="flagged.html">F-04/F-08</a>.';
  }

  /* =====================================================================
   * PART 8 — rendering (page-only; guarded so Node harnesses can load this file)
   * ===================================================================== */

  var pageBooted = false;

  function hhmmss(tsMs) {
    var d = new Date(tsMs);
    return d.toISOString().substr(11, 8) + 'Z';
  }

  function feedPrepend(e) {
    var host = e.liked ? document.getElementById('chat-model') : null;
    var el = document.getElementById('chat-all');
    if (el) {
      el.appendChild(alertRow(e));
      while (el.children.length > 120) el.removeChild(el.firstChild);
    }
    if (host) {
      host.appendChild(alertRow(e, true));
      while (host.children.length > 120) host.removeChild(host.firstChild);
    }
    tickChats();
  }
  function simPrepend(s) {
    var host = document.getElementById('chat-model');
    if (!host) return;
    host.appendChild(simRow(s));
    while (host.children.length > 120) host.removeChild(host.firstChild);
    tickChats();
  }

  function alertRow(e, modelChat) {
    var d = document.createElement('div');
    d.className = 'chat-row' + (e.liked ? ' liked' : '') + (e.replay ? ' replay' : '');
    if (e.kind === 'resolution') {
      d.innerHTML =
        '<span class="t">' + hhmmss(e.tsMs) + '</span>' +
        '<span class="arrow ' + (e.resolved === 'yes' ? 'up' : 'down') + '">resolved ' + String(e.resolved || '?').toUpperCase() + '</span>' +
        '<span class="topic">' + K.esc(App.topicLabel(e.topic)) + '</span>' +
        '<a href="' + K.marketUrl(e.ticker) + '" class="tk">' + K.esc((e.title || e.ticker).slice(0, 64)) + '</a>' +
        '<span class="px">resolution logged from the API result field</span>' +
        '<button class="btn tiny" data-detail="' + K.esc(e.ticker) + '">why / chart</button>';
    } else {
      var arrow = e.side === 'up' ? '▲' : '▼';
      var cents = (e.delta >= 0 ? '+' : '−') + Math.round(Math.abs(e.delta) * 100) + '¢';
      var badges = '';
      if (e.liked) badges += ' <span class="score-badge">model ' + e.score + '</span>';
      if (e.roi !== null && e.roi !== undefined) badges += ' <span class="roi-badge" title="normalized ROI proxy (liquidity 0.40 / open interest 0.30 / opportunity 0.30) — heuristic, not an official Kalshi model (F-09)">ROI ' + Number(e.roi).toFixed(2) + '</span>';
      if (e.replay) badges += ' <span class="badge warn" title="replayed from the verified snapshot trades capture">replay</span>';
      var cat = (e.catalysts || []).slice(0, 2).map(function (c) {
        return '<a href="' + K.esc(c.url) + '" target="_blank" rel="noopener" title="official settlement source">' + K.esc(c.name) + '</a>';
      }).join(' · ');
      d.innerHTML =
        '<span class="t">' + hhmmss(e.tsMs) + '</span>' +
        '<span class="arrow ' + e.side + '">' + arrow + ' ' + cents + '</span>' +
        '<span class="topic">' + K.esc(App.topicLabel(e.topic)) + '</span>' +
        '<a href="' + K.marketUrl(e.ticker) + '" class="tk">' + K.esc((e.title || e.ticker).slice(0, 64)) + '</a>' +
        '<span class="px">' + K.usd4(String(e.from)) + ' → <strong>' + K.usd4(String(e.to)) + '</strong></span>' +
        badges +
        (cat ? '<span class="cat small muted">catalysts: ' + cat + '</span>' : '') +
        '<button class="btn tiny" data-detail="' + K.esc(e.ticker) + '">why / chart</button>';
    }
    var btn = d.querySelector('[data-detail]');
    if (btn) btn.addEventListener('click', function () { selectAlert(e.ticker); });
    return d;
  }

  function simRow(s) {
    var d = document.createElement('div');
    d.className = 'chat-row sim';
    if (s.kind === 'entry') {
      d.innerHTML =
        '<span class="t">' + hhmmss(s.tsMs) + '</span>' +
        '<span class="arrow sim">SIM ▶</span>' +
        '<span class="topic">' + K.esc(App.topicLabel(s.topic)) + '</span>' +
        '<a href="' + K.marketUrl(s.ticker) + '" class="tk">' + K.esc((s.title || s.ticker).slice(0, 56)) + '</a>' +
        '<span class="px"><strong>' + K.esc(s.strategy) + '</strong>: buy ' + s.qty + ' ' +
          s.side.toUpperCase() + ' @ ' + K.usd4(String(s.price)) + ' <span class="small muted">(' + K.esc(s.reason) + ')</span></span>';
    } else {
      var good = s.pnl >= 0;
      d.innerHTML =
        '<span class="t">' + hhmmss(s.tsMs) + '</span>' +
        '<span class="arrow sim">SIM ■</span>' +
        '<span class="topic">' + K.esc(App.topicLabel(s.topic)) + '</span>' +
        '<a href="' + K.marketUrl(s.ticker) + '" class="tk">' + K.esc((s.title || s.ticker).slice(0, 56)) + '</a>' +
        '<span class="px"><strong>' + K.esc(s.reason) + '</strong> at ' + K.usd4(String(s.exitPrice)) +
          ' → P&L <strong class="' + (good ? 'good' : 'bad') + '">' + (s.pnl >= 0 ? '+' : '') + K.usd(s.pnl) + '</strong></span>';
    }
    return d;
  }

  function renderFeeds() {
    var allEl = document.getElementById('chat-all');
    var modelEl = document.getElementById('chat-model');
    if (!allEl || !modelEl) return;
    allEl.innerHTML = ''; modelEl.innerHTML = '';
    var n = Math.min(120, state.feed.length);
    for (var i = n - 1; i >= 0; i--) {          /* oldest→newest so the chat scrolls like a chat */
      var e = state.feed[i];
      allEl.appendChild(alertRow(e));
      if (e.liked) modelEl.appendChild(alertRow(e, true));
    }
    var m = Math.min(120, state.simfeed.length);
    for (var j = m - 1; j >= 0; j--) modelEl.appendChild(simRow(state.simfeed[j]));
    tickChats();
  }

  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 40; }
  function autoscroll(el) {
    var paused = false, stick = true;
    el.addEventListener('mouseenter', function () { paused = true; });
    el.addEventListener('mouseleave', function () { paused = false; });
    el.addEventListener('scroll', function () { stick = nearBottom(el); });
    el._tick = function () { if (!paused && stick) el.scrollTop = el.scrollHeight; };
  }
  function tickChats() {
    ['chat-all', 'chat-model'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el._tick) el._tick();
    });
  }

  function renderStatus() {
    if (!pageBooted) return;
    var st = K.state;
    document.getElementById('engine-status').innerHTML =
      'mode <strong>' + K.esc(st.mode) + '</strong> · tracking <strong>' + state.pollList.length +
      '</strong> markets · cycles <strong>' + state.polls + '</strong> · every ' +
      Math.round(state.pollMs / 1000) + 's · threshold <strong>≥ $' + DEFAULTS.alertThreshold.toFixed(2) +
      '</strong> both directions · dedup ' + Math.round(DEFAULTS.dedupMs / 1000) + 's' +
      (document.hidden ? ' · <span class="badge warn">tab hidden — polling paused</span>' : '') +
      (state.paused ? ' · <span class="badge warn">alerts paused</span>' : '');
    /* their stats cards (alerts fired / up-down / resolutions / data mode) */
    var as = document.getElementById('alert-stats');
    if (as) as.innerHTML =
      '<div class="stat"><div class="label">Alerts fired</div><div class="value">' + state.stats.alerts + '</div><div class="note">≥ $0.10 swings stored in this browser</div></div>' +
      '<div class="stat"><div class="label">▲ up / ▼ down</div><div class="value">' + state.stats.up + ' / ' + state.stats.down + '</div><div class="note">direction of the swing</div></div>' +
      '<div class="stat"><div class="label">Resolutions tracked</div><div class="value">' + state.stats.resolutions + '</div><div class="note">tracked markets resolved yes/no</div></div>' +
      '<div class="stat"><div class="label">Data mode</div><div class="value">' + (K.state.mode === 'snapshot' ? 'SNAPSHOT' : 'LIVE') + '</div><div class="note">' +
        (K.state.mode === 'snapshot' ? 'verified snapshot + trades replay' : 'batched quotes + trade walk on the official demo API') + '</div></div>';
    var open = openAutoTrades();
    var auto = Store().getTrades().filter(function (t) { return !t.seed && (t.strategy === 'momentum-10c' || t.strategy === 'fade-jump') && t.status === 'settled'; });
    var realized = auto.reduce(function (a, t) { return a + (t.pnl || 0); }, 0);
    document.getElementById('at-stats-txt').textContent =
      state.feed.length + ' feed entries stored · ' + open.length + ' auto position(s) open · ' +
      auto.length + ' auto trade(s) closed · realized ' + (realized >= 0 ? '+' : '') + K.usd(realized);
    var pb = document.getElementById('pause-btn');
    if (pb) pb.textContent = state.paused ? 'Resume alerts' : 'Pause alerts';
  }

  function renderAtToggle() {
    var b = document.getElementById('at-toggle');
    if (!b) return;
    b.textContent = state.autoTrade ? 'Auto-trading: ON (simulated)' : 'Auto-trading: OFF';
    b.className = 'btn small ' + (state.autoTrade ? 'good' : '');
  }

  /* ---------- model ranking table (4-component model + ROI proxy) ---------- */
  function renderModelTable() {
    var tb = document.querySelector('#model-table tbody');
    if (!tb) return;
    tb.innerHTML = '';
    var rows = state.tracked.map(function (m) {
      return { m: m, s: scoreMarket(m, { recentDelta: recentDeltaOf(m.ticker) }, DEFAULTS), r: modelScore(m, state.norms) };
    }).sort(function (a, b) { return b.s.score - a.s.score; });
    rows.forEach(function (r) {
      var p = r.s.parts;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><a href="' + K.marketUrl(r.m.ticker) + '">' + K.esc((r.m.title || r.m.ticker).slice(0, 60)) + '</a><br><code class="small">' + K.esc(r.m.ticker) + '</code></td>' +
        '<td>' + K.esc(App.topicLabel(r.m.topic)) + '</td>' +
        '<td class="num"><strong>' + r.s.score + '</strong> ' + (r.s.liked ? '<span class="badge yes">likes</span>' : '') + '</td>' +
        '<td class="num">' + p.liquidity.toFixed(2) + '</td>' +
        '<td class="num">' + p.spread.toFixed(2) + '</td>' +
        '<td class="num">' + p.momentum.toFixed(2) + '</td>' +
        '<td class="num">' + p.band.toFixed(2) + '</td>' +
        '<td class="num">' + (r.r ? r.r.score.toFixed(2) : '—') + '</td>' +
        '<td class="num">' + K.usd4(r.m.yes_bid_dollars) + ' / ' + K.usd4(r.m.yes_ask_dollars) + '</td>' +
        '<td class="num">' + K.num(num(r.m.volume_24h_fp)) + '</td>' +
        '<td class="src">' + K.apiLink(r.m.source_url || pollQueryUrl()) + '</td>';
      tb.appendChild(tr);
    });
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="11" class="muted">No tracked markets yet (watch set builds from the five focus topics).</td></tr>';
    }
    if (state.snapshotNote) {
      var note = document.getElementById('model-note');
      if (note) note.innerHTML += ' <span class="badge warn">snapshot data</span> Scores computed from the verified snapshot rows; momentum warms up only while polling live.';
    }
  }

  /* ---------- jump detail: chart + markers + ladder + cause links ---------- */
  function selectAlert(ticker) {
    state.selected = ticker;
    state.seriesTicker = null;
    var row = state.tracked.filter(function (m) { return m.ticker === ticker; })[0] || null;
    state.selectedRow = row;
    if (row && row.series_ticker) state.seriesTicker = row.series_ticker;
    state.candles = { 1: [], 60: [] };
    renderDetailHeader();
    draw();
    loadCandles();
    loadOrderbook();
    renderCause();
  }

  function renderDetailHeader() {
    var row = state.selectedRow;
    var a = latestAlertFor(state.selected);
    var title = row ? (row.title || row.ticker) : (a ? a.title : state.selected);
    var el = document.getElementById('d-title');
    if (!el) return;
    el.innerHTML =
      K.esc(title) + ' <code class="small">' + K.esc(state.selected) + '</code>' +
      (a ? ' <span class="badge ' + (a.side === 'up' ? 'yes' : 'no') + '">jump ' +
        (a.side === 'up' ? '▲ +' : '▼ −') + Math.round(Math.abs(a.delta) * 100) + '¢ at ' + hhmmss(a.tsMs) + '</span>' : '');
  }

  function loadCandles() {
    if (!state.seriesTicker || !state.selected) return;
    var now = Math.floor(Date.now() / 1000);
    [{ p: 1, start: now - 6 * 3600, key: 1 }, { p: 60, start: now - 8 * 86400, key: 60 }].forEach(function (r) {
      var q = '/series/' + encodeURIComponent(state.seriesTicker) + '/markets/' + encodeURIComponent(state.selected) +
        '/candlesticks?start_ts=' + r.start + '&end_ts=' + now + '&period_interval=' + r.p;
      K.get(q, { timeoutMs: 9000 }).then(function (res) {
        state.candles[r.key] = ((res.data && res.data.candlesticks) || []).map(function (c) {
          return { t: c.end_period_ts, v: num(c.price && c.price.close_dollars) };
        }).filter(function (p) { return p.v !== null; });
        draw();
      }).catch(function () {});
    });
  }

  function draw() {
    if (!window.ChartLite || !state.selected) return;
    var w = K.cfg.chartWindows.filter(function (x) { return x.id === state.windowId; })[0];
    var win = w.seconds;
    var byT = {};
    function add(arr) {
      (arr || []).forEach(function (p) {
        if (p.t >= Math.floor(Date.now() / 1000) - win - 2) byT[p.t] = p.v;
      });
    }
    if (win <= 300) add(state.history[state.selected]);
    else {
      add(state.candles[1]);
      if (win >= 21600) add(state.candles[60]);
      add(state.history[state.selected]);
    }
    var pts = Object.keys(byT).map(function (t) { return { t: +t, v: byT[t] }; });
    pts.sort(function (a, b) { return a.t - b.t; });
    var canvas = document.getElementById('price-chart');
    ChartLite.drawChart(canvas, pts, { windowSeconds: win, zoom: win <= 300 });
    drawJumpMarkers(canvas, pts, win);
  }

  function drawJumpMarkers(canvas, pts, win) {
    var g = canvas._chartGeom;
    if (!g) return;
    var ctx = canvas.getContext('2d');
    var tMin = Math.floor(Date.now() / 1000) - win;
    state.feed.filter(function (e) {
      return e.ticker === state.selected && e.kind === 'swing' && e.tsMs / 1000 >= tMin;
    }).forEach(function (e) {
      var x = g.x(Math.floor(e.tsMs / 1000));
      var pt = pts.reduce(function (best, p) {
        return (!best || Math.abs(p.t - e.tsMs / 1000) < Math.abs(best.t - e.tsMs / 1000)) ? p : best;
      }, null);
      ctx.strokeStyle = e.side === 'up' ? 'rgba(21,128,61,0.65)' : 'rgba(185,28,28,0.65)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, g.padT); ctx.lineTo(x, g.padT + g.plotH); ctx.stroke();
      ctx.setLineDash([]);
      if (pt) {
        ctx.fillStyle = e.side === 'up' ? '#15803d' : '#b91c1c';
        ctx.beginPath(); ctx.arc(x, g.y(pt.v), 4, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  function loadOrderbook() {
    var tk = state.selected;
    if (!tk) return;
    K.get('/markets/' + encodeURIComponent(tk) + '/orderbook?depth=10', { timeoutMs: 9000 }).then(function (r) {
      renderLadder((r.data && r.data.orderbook_fp) || { yes_dollars: [], no_dollars: [] },
        K.state.base + '/markets/' + encodeURIComponent(tk) + '/orderbook?depth=10');
    }).catch(function () {
      var el = document.getElementById('book-summary');
      if (el) el.innerHTML =
        'Orderbook unavailable right now (live API unreachable or empty book) — the full ladder lives on ' +
        '<a href="' + K.marketUrl(tk) + '">Market Detail</a>.';
      var tb = document.querySelector('#ladder tbody');
      if (tb) tb.innerHTML = '';
    });
  }

  function renderLadder(ob, sourceUrl) {
    var yes = (ob.yes_dollars || []).slice();   /* [price, size] ascending; best bid LAST */
    var no = (ob.no_dollars || []).slice();     /* NO bids ascending ⇒ implied YES asks at 1 − price */
    var rows = {};
    yes.forEach(function (p) {
      var price = round4(num(p[0])), size = num(p[1]);
      if (price === null) return;
      rows[price] = rows[price] || {}; rows[price].bid = size;
    });
    no.forEach(function (p) {
      var noPrice = num(p[0]), size = num(p[1]);
      if (noPrice === null) return;
      var yesAsk = round4(1 - noPrice);
      rows[yesAsk] = rows[yesAsk] || {}; rows[yesAsk].ask = size;
    });
    var prices = Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).slice(0, 8);
    var tb = document.querySelector('#ladder tbody');
    if (!tb) return;
    tb.innerHTML = prices.map(function (p) {
      var r = rows[p];
      return '<tr><td class="num"><strong>$' + p.toFixed(4) + '</strong></td>' +
        '<td class="num">' + (r.bid !== undefined ? K.num(r.bid) : '') + '</td>' +
        '<td class="num">' + (r.ask !== undefined ? K.num(r.ask) : '') + '</td></tr>';
    }).join('');
    if (!prices.length) tb.innerHTML = '<tr><td colspan="3" class="muted">Empty book right now (the API returns 200 with empty arrays — ' + K.apiLink(sourceUrl, 'source') + ').</td></tr>';
    var bestBid = yes.length ? num(yes[yes.length - 1][0]) : null;
    var bestBidSize = yes.length ? num(yes[yes.length - 1][1]) : 0;
    var bestAsk = no.length ? round4(1 - num(no[no.length - 1][0])) : null;
    var bestAskSize = no.length ? num(no[no.length - 1][1]) : 0;
    var totalBid = yes.reduce(function (a, p) { return a + (num(p[1]) || 0); }, 0);
    var bs = document.getElementById('book-summary');
    if (bs) bs.innerHTML =
      'Best YES bid <strong>' + (bestBid === null ? '—' : '$' + bestBid.toFixed(4)) + '</strong> (' + K.num(bestBidSize) +
      ' contracts) · best YES ask (implied from NO bids) <strong>' + (bestAsk === null ? '—' : '$' + bestAsk.toFixed(4)) +
      '</strong> (' + K.num(bestAskSize) + ' contracts) · YES bid depth shown <strong>' + K.num(totalBid) +
      '</strong> contracts · source ' + K.apiLink(sourceUrl) +
      ' · <a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">how the book works</a>';
  }

  function renderCause() {
    var host = document.getElementById('cause');
    if (!host) return;
    var a = latestAlertFor(state.selected);
    var row = state.selectedRow;
    var srcs = (row && row.series_ticker && state.seriesMap[row.series_ticker]) ||
               (a && a.series_ticker && state.seriesMap[a.series_ticker]) ||
               (a && a.catalysts) || [];
    var parts = [];
    if (srcs.length) {
      parts.push('<strong>Official settlement sources (from the API):</strong> ' +
        srcs.map(function (s) { return '<a href="' + K.esc(s.url) + '" target="_blank" rel="noopener">' + K.esc(s.name) + '</a>'; }).join(' · '));
    } else {
      parts.push('<span class="muted">Official settlement source: not captured for this series (left blank, never guessed — see flagged F-05).</span>');
    }
    if (a) {
      parts.push('<strong>Auto-generated research pointer (not an official source, no causal claim — F-12):</strong> ' +
        '<a href="' + K.esc(newsUrl(a.title)) + '" target="_blank" rel="noopener">Google News search for this market title</a>');
      parts.push('<strong>Market rules &amp; resolution state:</strong> <a href="' + K.marketUrl(a.ticker) + '">market detail (rules_primary / rules_secondary)</a>');
      parts.push('<strong>Row source:</strong> ' + K.apiLink(a.source, a.source && a.source.indexOf('/markets/trades') !== -1 ? 'GET /markets/trades' : 'GET /markets?tickers=…'));
    } else {
      parts.push('<span class="muted">Select a jump from either chat to see its research links.</span>');
    }
    host.innerHTML = parts.map(function (p) { return '<p class="small">' + p + '</p>'; }).join('');
  }

  function render() {   /* arena/815b546d public API — full re-render */
    if (!pageBooted) return;
    renderFeeds();
    renderStatus();
    renderModelTable();
  }

  /* =====================================================================
   * PART 9 — public APIs
   * ===================================================================== */

  window.Alerts = {
    init: function () { boot(); },
    state: state,
    refresh: refresh,
    replay: replay,
    render: render,
    setPaused: function (p) { state.paused = p; renderStatus(); },
    clear: function () {
      state.feed = [];
      state.stats = { alerts: 0, up: 0, down: 0, resolutions: 0 };
      aSet('feed', state.feed);
      aSet('stats', state.stats);
      if (pageBooted) { renderFeeds(); renderStatus(); }
    },
    modelScore: modelScore,
    computeNorms: computeNorms
  };

  /* test hooks (documented): tools/alerts-render-test.mjs drives these */
  window.AlertsPage = {
    state: state,
    poll: poll,
    processRows: processRows,
    buildTrackSet: buildTrackSet,
    evaluateExits: evaluateExits,
    tradeWalk: tradeWalk,
    cfg: DEFAULTS,
    latestAlertFor: latestAlertFor,
    selectAlert: selectAlert
  };

  /* =====================================================================
   * PART 10 — page bootstrap (only when the full page shell is present;
   * dash/js/autotrade.html loads this file without app-common.js first,
   * and Node harnesses load it with stubs — in both cases boot() is skipped)
   * ===================================================================== */

  function boot() {
    if (pageBooted) return;
    if (typeof App === 'undefined' || !document.getElementById('chat-all')) return;
    pageBooted = true;

    App.renderHeader('alerts.html');
    App.renderFooter();
    ['chat-all', 'chat-model'].forEach(function (id) { autoscroll(document.getElementById(id)); });
    renderAtToggle();
    renderFeeds();
    renderStatus();

    /* window buttons */
    var wb = document.getElementById('window-btns');
    K.cfg.chartWindows.forEach(function (w) {
      var b = document.createElement('button');
      b.className = 'btn small' + (w.id === state.windowId ? ' primary' : '');
      b.textContent = w.label;
      b.addEventListener('click', function () {
        state.windowId = w.id;
        [].forEach.call(wb.children, function (c) { c.classList.remove('primary'); });
        b.classList.add('primary');
        draw();
      });
      wb.appendChild(b);
    });

    /* controls */
    document.getElementById('at-toggle').addEventListener('click', function () {
      state.autoTrade = !state.autoTrade;
      if (Store) Store().setJSON('autotrade', state.autoTrade);
      renderAtToggle(); renderStatus();
    });
    document.getElementById('pause-btn').addEventListener('click', function () {
      state.paused = !state.paused;
      renderStatus();
    });
    document.getElementById('clear-btn').addEventListener('click', function () {
      state.feed = [];
      state.simfeed = [];
      state.history = {};
      state.obs = {};
      state.alertMeta = {};
      state.stats = { alerts: 0, up: 0, down: 0, resolutions: 0 };
      saveAll(); renderFeeds(); renderStatus();
    });

    K.onModeChange(function (st) {
      if (st.mode === 'snapshot' && !state.stopped) stopEngine();
      renderStatus();
    });

    buildSeriesMap().then(function () { renderCause(); });

    buildTrackSet(false).then(function () {
      renderModelTable();
      renderStatus();
      poll();
      if (state.tracked.length) selectAlert(state.tracked[0].ticker);
      if (K.state.mode === 'snapshot') replay();   /* verified trades replay in snapshot mode */
    }).catch(function () {
      renderModelTable();
    });

    setInterval(function () { if (!document.hidden) buildTrackSet(true).catch(function () {}); }, 5 * 60 * 1000);
    setInterval(function () { saveAll(); renderStatus(); }, 30000);
  }

  /* their alerts.html called Alerts.init() explicitly; our bootstrap honors both patterns */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot(); /* page scripts load at end of body — boot immediately when the shell is present */
    }
  }
})();
