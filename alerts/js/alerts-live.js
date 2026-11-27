/* alerts-live.js — data layer for the alert console.
 *
 * Two sources, in this order, and the page always says which one it is showing:
 *
 *   1. engine feed  data/live/feed.json — written by tools/live_engine.mjs on a GitHub
 *      Actions schedule. It is the only source that can hold history from periods when
 *      nobody had the page open, and the only one that can report candles between runs.
 *   2. browser poll the official demo Trade API, public endpoints only
 *      (https://docs.kalshi.com/getting_started/quick_start_market_data). This gives
 *      seconds-level freshness while the page is open, if the browser is allowed to call
 *      the API cross-origin (see the CORS note on the page).
 *
 * The two are merged, de-duplicated by ticker+timestamp, and every row keeps the URL of the
 * exact request that produced it.
 */
(function () {
  'use strict';

  var BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
  var THRESHOLD = 0.10;

  var TOPICS = [
    { id: 'gas', label: 'Gas Prices', queries: [
      { category: 'Economics', tags: 'Oil and energy' },
      { category: 'Commodities', tags: 'Oil & Gas' }], titleMatch: /\bgas\b/i },
    { id: 'elections', label: 'Elections', queries: [{ category: 'Elections' }], titleMatch: null },
    { id: 'culture', label: 'Culture', queries: [{ category: 'Culture' }], titleMatch: null },
    { id: 'crypto', label: 'Crypto', queries: [{ category: 'Crypto' }], titleMatch: null },
    { id: 'golf', label: 'Golf', queries: [{ category: 'Sports', tags: 'Golf' }], titleMatch: null }
  ];

  var DOCS = {
    demo: 'https://docs.kalshi.com/getting_started/demo_env',
    marketData: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
    getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
    getMarket: 'https://docs.kalshi.com/api-reference/market/get-market',
    orderbook: 'https://docs.kalshi.com/getting_started/orderbook_responses',
    candles: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
    lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
    settlement: 'https://docs.kalshi.com/getting_started/market_settlement',
    rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits'
  };

  /* ---------------- helpers ---------------- */

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function round(x, dp) {
    var f = Math.pow(10, dp === undefined ? 4 : dp);
    return Math.round(x * f) / f;
  }
  function usd(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '$' + Number(n).toFixed(dp === undefined ? 2 : dp);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function topicLabel(id) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i].label;
    return id || '—';
  }

  /* Same price rule as the engine (tools/live_engine.mjs). A binary book is self-checking:
   * S6 documents yes_ask + no_bid = $1 and yes_bid + no_ask = $1. The demo returned a row for
   * KXPRESPERSON-28-GABB with yes_ask 0.8030 against no_bid 0.9970, which sums to 1.80 and
   * produced fake "$0.80" alerts. When a row fails that test the price comes from the NO side
   * instead and the row is marked. A wide but reciprocal book keeps its last traded price,
   * because the midpoint of a 0.01/0.94 book means nothing. */
  var RECIPROCITY_TOLERANCE = 0.02;
  var MAX_COHERENT_SPREAD = 0.10;
  var MAX_LAST_PRICE_BOOK_GAP = 0.25;
  function bookReciprocity(m) {
    var yb = num(m.yes_bid_dollars), ya = num(m.yes_ask_dollars);
    var nb = num(m.no_bid_dollars), na = num(m.no_ask_dollars);
    var checks = [];
    if (ya !== null && nb !== null) checks.push(Math.abs(ya + nb - 1));
    if (yb !== null && na !== null) checks.push(Math.abs(yb + na - 1));
    if (!checks.length) return { tested: false, ok: null, worst: null };
    var worst = round(Math.max.apply(null, checks), 4);
    return { tested: true, ok: worst <= RECIPROCITY_TOLERANCE, worst: worst };
  }
  function trackedPrice(m) {
    var last = num(m.last_price_dollars);
    var yb = num(m.yes_bid_dollars), ya = num(m.yes_ask_dollars);
    var nb = num(m.no_bid_dollars), na = num(m.no_ask_dollars);
    var recip = bookReciprocity(m);
    var directOk = yb !== null && ya !== null && yb > 0 && ya > 0 && yb < 1 && ya < 1 && ya >= yb;
    var impliedOk = nb !== null && na !== null && nb > 0 && na > 0 && nb < 1 && na < 1;
    if (recip.ok !== false) {
      var mid = directOk ? round((yb + ya) / 2) : impliedOk ? round(((1 - na) + (1 - nb)) / 2) : null;
      var spread = directOk ? round(ya - yb, 4) : null;
      if (last !== null && last > 0 && last < 1) {
        if (mid !== null && spread !== null && spread <= MAX_COHERENT_SPREAD && Math.abs(last - mid) > MAX_LAST_PRICE_BOOK_GAP) {
          return { price: mid, field: 'book midpoint (stale last price)', book_inconsistent: true };
        }
        return { price: last, field: 'last_price_dollars' };
      }
      if (directOk) return { price: mid, field: 'mid' };
      if (impliedOk) return { price: round(((1 - na) + (1 - nb)) / 2), field: 'mid(1 - no)' };
      return { price: null, field: null };
    }
    var impliedMid = impliedOk ? round(((1 - na) + (1 - nb)) / 2) : null;
    if (impliedMid !== null && impliedMid > 0 && impliedMid < 1) {
      return { price: impliedMid, field: 'NO-side reading (row failed reciprocity)', book_inconsistent: true };
    }
    if (last !== null && last > 0 && last < 1) {
      return { price: last, field: 'last_price_dollars (row failed reciprocity)', book_inconsistent: true };
    }
    return { price: null, field: null, book_inconsistent: true };
  }

  /* Same scoring heuristic as the engine (modelScore). Duplicated deliberately: the page
   * must be able to score a swing it detects itself, and keeping the formula in one shape
   * on both sides makes them comparable. Weights documented on the page. */
  var HIGH_ROI_THRESHOLD = 0.62;
  var FOLLOW_TOLERANCE = 0.02;

  /* Follow-through gate — identical in meaning to tools/live_engine.mjs followThrough().
   * A swing only earns a score when the published quote still sits at the price the swing
   * ended at: |ask - to| for an "up" move, |bid - to| for a "down" move, within $0.02. A side
   * priced at $0.00 means there is no offer/bid, so the move was not executable. */
  function followThrough(direction, to, bid, ask) {
    if (to === null || to === undefined) return { ok: null, note: 'swing price missing — unverified' };
    if (direction !== 'up' && direction !== 'down') return { ok: null, note: 'direction unknown — unverified' };
    var ref = direction === 'up' ? ask : bid;
    var side = direction === 'up' ? 'ask' : 'bid';
    if (ref === null || ref === undefined) return { ok: null, note: 'no YES ' + side + ' published — unverified' };
    if (ref <= 0) return { ok: false, gap: round(to - ref, 4), note: 'YES ' + side + ' is $0.00 — nothing to ' + (direction === 'up' ? 'buy' : 'sell into') };
    var gap = round(Math.abs(ref - to), 4);
    return { ok: gap <= FOLLOW_TOLERANCE + 1e-9, gap: gap, note: side + ' ' + usd(ref) + ' vs swing ' + usd(to) + ' (gap ' + usd(gap) + ')' };
  }

  function modelScore(o) {
    if (o.from === null || o.from === undefined) return { score: null, highROI: false, tradeable: null, reasons: ['no baseline price — unverified'] };
    var reasons = [];
    var ft = (o.direction && o.to !== null && o.to !== undefined)
      ? followThrough(o.direction, o.to, o.bid, o.ask)
      : { ok: null, note: 'direction/price not supplied' };
    var headroom = round(Math.max(0, Math.min(o.from, 1 - o.from) / 0.5), 4);
    reasons.push('headroom ' + headroom.toFixed(2));
    var size = round(Math.min(1, Math.abs(o.delta) / 0.5), 4);
    reasons.push('move ' + (size * 100).toFixed(0) + '% of $0.50');
    var v = (o.volume24h === null || o.volume24h === undefined) ? 0 : o.volume24h;
    var liq = round(Math.min(1, v / 1000), 4);
    reasons.push('24h vol ' + v + ' -> liq ' + liq.toFixed(2));
    var spreadScore = 0;
    /* A missing or zero YES bid is a ONE-SIDED book: there is no buyer to exit into, so this
     * term must be 0. Scoring it as a tight spread is the defect fixed on 2026-11-21. */
    if (o.bid !== null && o.bid !== undefined && o.ask !== null && o.ask !== undefined && o.bid > 0 && o.ask > 0 && o.ask >= o.bid) {
      var spread = round(o.ask - o.bid, 4);
      spreadScore = round(Math.max(0, 1 - spread * 10), 4);
      reasons.push('spread ' + usd(spread) + ' -> ' + spreadScore.toFixed(2));
    } else {
      reasons.push('book is one-sided or unpriced -> 0.00');
    }
    reasons.push(ft.ok === true ? 'quote follows the swing: ' + ft.note + ' -> 1.00'
      : ft.ok === false ? 'NOT tradeable at the swing price: ' + ft.note + ' -> 0.00'
        : 'follow-through unverified (' + ft.note + ') -> 0.00');
    var score = 0.20 * headroom + 0.20 * size + 0.35 * liq + 0.25 * spreadScore;
    if (o.sampleAgeSeconds > 3600) { score *= 0.5; reasons.push('sample > 1h old -> halved'); }
    score = round(score, 4);
    if (ft.ok === false) { score = Math.min(score, 0.3); reasons.push('capped at 0.30: not executable at the recorded price'); }
    score = round(Math.max(0, Math.min(1, score)), 4);
    return { score: score, highROI: score >= HIGH_ROI_THRESHOLD, tradeable: ft.ok, reasons: reasons };
  }

  /* ---------------- engine feed ---------------- */

  var state = {
    feed: null,
    feedError: null,
    feedFetchedAt: null,
    live: { markets: {}, history: {}, alerts: [], order: [], ok: false, note: '', lastPoll: null, candles: {} },
    mode: 'probing'
  };

  function loadFeed() {
    // Cache-bust so a freshly deployed feed is not hidden by a CDN copy.
    return fetch('../data/live/feed.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        state.feed = j;
        state.feedFetchedAt = new Date();
        state.feedError = null;
        return j;
      })
      .catch(function (e) {
        state.feedError = String(e && e.message || e);
        return null;
      });
  }

  /* ---------------- browser live polling ---------------- */

  function getJson(path, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 12000);
    return fetch(BASE + path, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { accept: 'application/json' },
      cache: 'no-store'
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  function seriesPath(q) {
    var p = [];
    if (q.category) p.push('category=' + encodeURIComponent(q.category));
    if (q.tags) p.push('tags=' + encodeURIComponent(q.tags));
    p.push('include_volume=true');
    p.push('limit=200');
    return '/series?' + p.join('&');
  }

  /* Discover the highest-volume series per topic, then their open markets. Bounded request
   * count so a visitor's browser stays polite to the unauthenticated limits (rate_limits). */
  function pollLive(opts) {
    opts = opts || {};
    var maxSeries = opts.maxSeries || 10;
    var seen = {};
    var series = [];
    var chain = Promise.resolve();

    TOPICS.forEach(function (t) {
      t.queries.forEach(function (q) {
        chain = chain.then(function () {
          var path = seriesPath(q);
          return getJson(path).then(function (j) {
            (j.series || []).forEach(function (s) {
              if (seen[s.ticker]) return;
              if (t.titleMatch && !t.titleMatch.test(s.title || '')) return;
              seen[s.ticker] = true;
              series.push({
                ticker: s.ticker, title: s.title, topic: t.id,
                volume: num(s.volume_fp),
                source_url: BASE + path
              });
            });
          }, function (e) {
            // First failure is usually CORS/network: stop and report, do not hammer.
            throw e;
          });
        });
      });
    });

    return chain
      .then(function () {
        series.sort(function (a, b) { return (b.volume || 0) - (a.volume || 0); });
        var chosen = series.slice(0, maxSeries);
        state.live.series = chosen;
        var markets = [];
        var p = Promise.resolve();
        chosen.forEach(function (s) {
          p = p.then(function () {
            var path = '/markets?series_ticker=' + encodeURIComponent(s.ticker) + '&status=open&limit=200';
            return getJson(path).then(function (j) {
              (j.markets || []).forEach(function (m) {
                markets.push({ raw: m, topic: s.topic, series: s, source_url: BASE + path });
              });
            }, function () { /* one bad series must not kill the poll */ });
          });
        });
        return p.then(function () { return markets; });
      })
      .then(function (markets) {
        applyLiveSample(markets);
        state.live.ok = true;
        state.live.note = '';
        state.live.lastPoll = new Date();
        state.mode = 'live';
      })
      .catch(function (e) {
        state.live.ok = false;
        state.live.note = String(e && e.message || e);
        state.mode = state.feed ? 'feed' : 'offline';
        throw e;
      });
  }

  /* One browser sample: compare with the previous browser sample (and the last browser
   * alert) exactly like the engine does, so both layers agree on what a swing is. */
  function applyLiveSample(entries) {
    var now = Math.floor(Date.now() / 1000);
    var lastAlert = {};
    state.live.alerts.forEach(function (a) {
      var t = Date.parse(a.ts) / 1000;
      if (!lastAlert[a.ticker] || t > lastAlert[a.ticker].t) lastAlert[a.ticker] = { t: t, price: a.to };
    });

    entries.forEach(function (e) {
      var m = e.raw;
      var ticker = m.ticker;
      if (!ticker) return;
      var tp = trackedPrice(m);
      if (tp.price === null) return;
      var bid = num(m.yes_bid_dollars);
      var ask = num(m.yes_ask_dollars);
      var vol24 = num(m.volume_24h_fp);

      var hist = state.live.history[ticker] || (state.live.history[ticker] = []);
      var prev = hist.length ? hist[hist.length - 1] : null;
      var baseline = prev ? prev[1] : null;
      var kind = 'previous sample';
      var la = lastAlert[ticker];
      if (la && now - la.t <= 1800) { baseline = la.price; kind = 'last alert (within 30 min)'; }

      hist.push([now, tp.price]);
      if (hist.length > 720) hist.splice(0, hist.length - 720);

      state.live.markets[ticker] = {
        ticker: ticker, event_ticker: m.event_ticker, series_ticker: e.series.ticker,
        topic: e.topic, title: m.title || m.yes_sub_title, status: m.status, result: m.result || '',
        price: tp.price, price_field: tp.field,
        yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
        yes_bid_size_fp: m.yes_bid_size_fp, yes_ask_size_fp: m.yes_ask_size_fp,
        volume_fp: m.volume_fp, volume_24h_fp: m.volume_24h_fp, open_interest_fp: m.open_interest_fp,
        est_traded_dollars: (num(m.volume_fp) !== null && tp.price !== null) ? round(num(m.volume_fp) * tp.price, 2) : null,
        /* F-86. Both fields are the official "a day ago" pair, taken as published and never
         * rescaled: they drive the board's 24h-change column, which lets a reader see that a
         * contract swings between extremes instead of reading each print as a new opportunity. */
        last_price_dollars: num(m.last_price_dollars),
        previous_price_dollars: num(m.previous_price_dollars),
        close_time: m.close_time, rules_primary: m.rules_primary,
        book_inconsistent: !!tp.book_inconsistent,
        source_url: e.source_url, sampled_at: new Date(now * 1000).toISOString(), from_browser: true
      };

      if (baseline === null) return;
      var delta = round(tp.price - baseline, 4);
      if (Math.abs(delta) + 1e-12 < THRESHOLD) return;
      var id = 'live:' + ticker + '@' + now;
      if (state.live.alerts.some(function (a) { return a.id === id; })) return;
      state.live.alerts.push({
        id: id, ts: new Date(now * 1000).toISOString(), ticker: ticker,
        event_ticker: m.event_ticker, series_ticker: e.series.ticker, topic: e.topic,
        title: m.title || m.yes_sub_title, direction: delta > 0 ? 'up' : 'down',
        from: round(baseline, 4), to: round(tp.price, 4), delta: delta, abs_delta: round(Math.abs(delta), 4),
        threshold: THRESHOLD, baseline_kind: kind, detection: 'browser sample',
        yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
        yes_bid_size_fp: m.yes_bid_size_fp, yes_ask_size_fp: m.yes_ask_size_fp,
        volume_24h_fp: m.volume_24h_fp, volume_fp: m.volume_fp, open_interest_fp: m.open_interest_fp,
        est_traded_dollars: (num(m.volume_fp) !== null && tp.price !== null) ? round(num(m.volume_fp) * tp.price, 2) : null,
        close_time: m.close_time, rules_primary: m.rules_primary,
        model: modelScore({ from: round(baseline, 4), delta: delta, direction: delta > 0 ? 'up' : 'down', to: round(tp.price, 4), bid: bid, ask: ask, volume24h: vol24, sampleAgeSeconds: 0 }),
        source_url: e.source_url
      });
    });

    state.live.alerts.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    state.live.alerts = state.live.alerts.slice(0, 500);
  }

  /* ---------------- merged views ---------------- */

  /* All alerts: engine + browser, newest first, de-duplicated per ticker within 15 minutes
   * (matching tools/live_engine.mjs collapseDuplicates so flapping quotes cannot flood the chat). */
  function allAlerts() {
    var WINDOW_MS = 15 * 60 * 1000;
    var kept = [];
    function consider(a) {
      if (!a || !a.ticker) return;
      var t = Date.parse(a.ts) || 0;
      var dup = kept.some(function (k) {
        return k.ticker === a.ticker && Math.abs((Date.parse(k.ts) || 0) - t) <= WINDOW_MS;
      });
      if (!dup) kept.push(a);
    }
    ((state.feed && state.feed.alerts) || []).forEach(consider);
    state.live.alerts.forEach(consider);
    kept.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    return kept;
  }

  function highRoiAlerts() {
    return allAlerts().filter(function (a) { return a.model && a.model.highROI; });
  }

  function resolutions() {
    return (state.feed && state.feed.resolutions) || [];
  }

  /* Followed-but-unresolved rows, computed by the engine (tools/live_engine.mjs
   * awaitingResolutions). Empty for feeds written before that field existed; the page then
   * simply shows an empty list rather than inventing rows. */
  function awaiting() {
    return (state.feed && state.feed.awaiting) || [];
  }

  function markets() {
    var byTicker = {};
    ((state.feed && state.feed.markets) || []).forEach(function (m) { byTicker[m.ticker] = m; });
    Object.keys(state.live.markets).forEach(function (k) { byTicker[k] = state.live.markets[k]; });
    return Object.keys(byTicker).map(function (k) { return byTicker[k]; });
  }

  function history(ticker) {
    if (state.live.history[ticker] && state.live.history[ticker].length > 1) return state.live.history[ticker];
    var f = (state.feed && state.feed.history) || {};
    return f[ticker] || state.live.history[ticker] || [];
  }

  /* ---------------- official candlestick history for the console chart ----------------
   *
   * WHY THIS EXISTS (measured 2026-11-27, F-CHART-02). The console chart offered 5-minute,
   * 1-hour, 6-hour, 24-hour and 7-day windows but was fed only by `feed.history` (one point per
   * engine run) and by samples this tab recorded while open. In the committed feed NOT ONE of
   * the 25 highest-dollar chart candidates had two samples inside the 5-minute or the 1-hour
   * window, so two of the five advertised windows could not draw a line at all: the engine's
   * declared every-10-minutes cron is delivered far less often than declared (F-83).
   *
   * The exchange publishes exactly the missing resolution. GET
   * /series/{series_ticker}/markets/{ticker}/candlesticks returns per-period OHLC of *traded*
   * prices, with period_interval restricted by the official schema to 1, 60 or 1440 minutes and
   * each response capped at 5,000 periods; timestamps are Unix seconds.
   *   https://docs.kalshi.com/api-reference/market/get-market-candlesticks
   *
   * Honesty rules enforced here:
   *   * the plotted value is the OFFICIAL traded close `price.close_dollars` for that period
   *     (the same field assets/app.js charts on market.html). A period with no trade returns a
   *     null close and is SKIPPED, never filled from an adjacent candle, the bid, the ask or an
   *     interpolated estimate;
   *   * every point keeps the exact request URL that produced it, so the page can show where
   *     the line came from;
   *   * a failed or rate-limited request leaves the previous cache in place and reports it. It
   *     never downgrades the chart to an invented series.
   * The last candlesticks can lag the latest trades by a few seconds (official doc), which is
   * why the newest browser sample and the live last price are drawn on top of them. */

  var CANDLE_TTL_MS = 60000;      // re-fetch at most once a minute per market+interval
  var CANDLE_MAX_PERIODS = 5000;  // documented per-request cap

  /* The smallest documented interval that can resolve the chosen window. 7 days at 1-minute
   * periods is 10,080 periods, over the 5,000 cap, so the longer windows ask for 60-minute
   * candles (168 periods) or 1,440-minute candles (7 periods) instead. */
  function candleIntervalFor(windowSec) {
    if (!windowSec) return 1;
    if (windowSec / 60 <= CANDLE_MAX_PERIODS) return 1;
    if (windowSec / 3600 <= CANDLE_MAX_PERIODS) return 60;
    return 1440;
  }

  function candles(ticker) {
    var c = state.live.candles[ticker];
    return c && Array.isArray(c.points) ? c : null;
  }

  /* Fetch (or reuse) official candles for one market. Resolves to the cache entry.
   * `force` bypasses the TTL. Never throws: the caller draws whatever official data exists. */
  function fetchCandles(ticker, windowSec, opts) {
    opts = opts || {};
    var m = state.live.markets[ticker] || ((state.feed && state.feed.markets) || []).filter(function (x) {
      return x.ticker === ticker;
    })[0];
    var slot = state.live.candles[ticker] || (state.live.candles[ticker] = {});
    if (!m || !m.series_ticker) {
      slot.error = 'no series ticker is published for this market, so the candlestick endpoint cannot be called';
      slot.basis = null;
      return Promise.resolve(slot);
    }
    var interval = candleIntervalFor(windowSec);
    if (slot.pending && slot.interval === interval) return slot.pending;
    var nowMs = Date.now();
    if (!opts.force && slot.fetched_at && slot.interval === interval
        && nowMs - slot.fetched_at < CANDLE_TTL_MS && Array.isArray(slot.points)) {
      return Promise.resolve(slot);
    }
    var end = Math.floor(nowMs / 1000);
    /* Ask for at least one day of 1-minute candles so a short window still has context, and
     * never more than the documented 5,000-period cap. */
    var span = Math.max(windowSec || 0, interval === 1 ? 3600 : 86400);
    var maxSpan = CANDLE_MAX_PERIODS * interval * 60;
    if (span > maxSpan) span = maxSpan;
    var start = end - span;
    var path = '/series/' + encodeURIComponent(m.series_ticker) + '/markets/' + encodeURIComponent(ticker) +
      '/candlesticks?start_ts=' + start + '&end_ts=' + end + '&period_interval=' + interval;
    var url = BASE + path;
    slot.interval = interval;
    slot.basis = interval === 1 ? 'official 1-minute traded close (price.close_dollars)'
      : interval === 60 ? 'official 1-hour traded close (price.close_dollars)'
        : 'official 1-day traded close (price.close_dollars)';
    slot.source_url = url;
    slot.pending = getJson(path).then(function (j) {
      var out = [];
      (j.candlesticks || []).forEach(function (c) {
        var t = num(c && c.end_period_ts);
        var v = num(c && c.price && c.price.close_dollars);
        if (t === null || v === null) return;   // no trade in this period: never invent one
        if (v < 0 || v > 1) return;             // a binary contract price outside $0–$1 is not ours
        out.push({ t: t, p: v });
      });
      out.sort(function (a, b) { return a.t - b.t; });
      slot.points = out;
      slot.fetched_at = Date.now();
      slot.error = null;
      return slot;
    }, function (e) {
      slot.error = String(e && e.message || e);
      slot.fetched_at = Date.now();
      if (!Array.isArray(slot.points)) slot.points = [];
      return slot;
    }).then(function (s) {
      s.pending = null;
      return s;
    });
    return slot.pending;
  }

  /* The exact series the console chart plots: official traded candle closes, merged with the
   * samples recorded by the engine feed and by this tab, de-duplicated by timestamp with the
   * official print winning. Exported so the offline gate (scripts/check-console-chart.mjs) can
   * assert the merge without a canvas.
   *
   * Returns { points, official, error, basis, interval, source_url }, where `points` is always
   * strictly what was published — never an interpolation, a carry-forward, or a bid/ask stand-in. */
  function chartSeries(ticker, windowSec, nowSec) {
    var now = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000);
    var from = now - (windowSec || 3600);
    var entry = candles(ticker);
    var byT = {};
    function add(t, p, official) {
      var tt = num(t), pp = num(p);
      if (tt === null || pp === null || !isFinite(tt) || !isFinite(pp)) return;
      if (tt < from || tt > now + 60 || pp < 0 || pp > 1) return;
      var at = Math.round(tt);
      if (!byT[at] || (official && !byT[at].official)) byT[at] = { t: at, p: pp, official: !!official };
    }
    ((entry && entry.points) || []).forEach(function (c) { add(c.t, c.p, true); });
    (history(ticker) || []).forEach(function (smp) {
      if (Array.isArray(smp)) add(smp[0], smp[1], false);
      else if (smp) add(smp.t, smp.p, false);
    });
    var points = Object.keys(byT).map(function (k) { return byT[k]; })
      .sort(function (a, b) { return a.t - b.t; });
    return {
      points: points,
      official: points.filter(function (x) { return x.official; }).length,
      error: (entry && entry.error) || null,
      basis: (entry && entry.basis) || null,
      interval: (entry && entry.interval) || null,
      source_url: (entry && entry.source_url) || null
    };
  }

  /* How many series matched for a topic in the last engine run (from the compact summary). */
  function topicSeriesCount(topicId) {
    var t = (state.feed && state.feed.meta && state.feed.topic_rules) || [];
    var sum = 0;
    var summary = (state.feed && state.feed.topics) || {};
    if (summary[topicId] && typeof summary[topicId].count === 'number') return summary[topicId].count;
    return null;
  }

  function orderbooks() {
    return (state.feed && state.feed.orderbooks) || {};
  }

  window.AL = {
    BASE: BASE, THRESHOLD: THRESHOLD, TOPICS: TOPICS, DOCS: DOCS, HIGH_ROI_THRESHOLD: HIGH_ROI_THRESHOLD,
    state: state,
    loadFeed: loadFeed, pollLive: pollLive,
    allAlerts: allAlerts, highRoiAlerts: highRoiAlerts, resolutions: resolutions, awaiting: awaiting,
    markets: markets, history: history, orderbooks: orderbooks, topicSeriesCount: topicSeriesCount,
    candles: candles, fetchCandles: fetchCandles, candleIntervalFor: candleIntervalFor, chartSeries: chartSeries,
    modelScore: modelScore, trackedPrice: trackedPrice,
    num: num, round: round, usd: usd, esc: esc, topicLabel: topicLabel
  };
})();
