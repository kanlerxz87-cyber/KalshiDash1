/* catalyst.js — K1: swing-catalyst annotation layer (session-7f90cf50).
 *
 * Detects >= $0.10 swings in Kalshi demo contract prices and annotates each swing with
 * events and website links: (a) the official API endpoints the row came from,
 * (b) the event's official settlement_sources (name + url, returned by the API itself),
 * (c) clearly-labelled "possible catalyst" discovery searches (external news search links).
 * The discovery links are NOT evidence of causation — nothing here asserts what caused a move.
 *
 * Verified against official sources on 2026-11-20 (see the Sources table on catalyst.html):
 * - Prices are fixed-point dollar strings ("0.1200"): https://docs.kalshi.com/getting_started/fixed_point_migration
 * - Market fields (last_price_dollars, volume_24h_fp, open_interest_fp, result, ...):
 *   https://docs.kalshi.com/api-reference/market/get-markets
 * - Single market: https://docs.kalshi.com/api-reference/market/get-market
 * - Events (title, category, settlement_sources[{name,url}], nested markets):
 *   https://docs.kalshi.com/api-reference/events/get-events
 * - Candlesticks (period_interval 1|60|1440, price.open/low/high/close_dollars):
 *   https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 * - Settlement ($1 per winning contract, result yes|no):
 *   https://docs.kalshi.com/getting_started/market_settlement
 * - Demo environment (mock funds; "price and behavior of markets in the demo environment
 *   may not be reflective of those in real markets"): https://docs.kalshi.com/getting_started/demo_env
 * - Rate limits ("Unauthenticated public requests are subject to separate limits...
 *   back off on 429"): https://docs.kalshi.com/getting_started/rate_limits
 *
 * Live checks run 2026-11-20 with the fetch tool (re-run any of these URLs to verify):
 * - https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=5&status=open
 * - Get Events documents NO category parameter (re-verified 2026-11-21 against
 *   https://docs.kalshi.com/api-reference/events/get-events.md — the parameters are limit,
 *   cursor, with_nested_markets, with_milestones, status, series_ticker, tickers,
 *   min_close_ts, min_updated_ts). The earlier 2026-11-20 "unreliable filter" probe used
 *   that undocumented parameter and proved nothing about a documented filter; it is
 *   reclassified on flagged.html as F-62. Topic mapping below is client-side on the
 *   returned category/title/series fields and relies on no server-side category filter.
 * - F-62 correction applied 2026-11-21 (session-c144ad6a): the undocumented category=
 *   discovery queries were removed; see verification/2026-11-21-c144ad6a.md.
 * - Session record: verification/2026-11-20-e6c3b3b6.md (series/category map).
 */
(function () {
  'use strict';

  /* ---------------- configuration ---------------- */
  var CFG = {
    apiPrimary: 'https://external-api.demo.kalshi.co/trade-api/v2',
    apiLegacy: 'https://demo-api.kalshi.co/trade-api/v2',
    docs: {
      fixedPoint: 'https://docs.kalshi.com/getting_started/fixed_point_migration',
      getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
      getMarket: 'https://docs.kalshi.com/api-reference/market/get-market',
      getEvents: 'https://docs.kalshi.com/api-reference/events/get-events',
      candlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
      settlement: 'https://docs.kalshi.com/getting_started/market_settlement',
      demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
      rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits'
    },
    threshold: 0.10,          // dollars; brief: "sudden swings ... >= $0.10 in either direction"
    cooldownSec: 180,         // do not re-alert the same ticker/direction within this window
    minSampleGapSec: 5,       // minimum distance between the two observations that form a swing
    pollMs: 30000,            // market refresh cadence (conservative: unauthenticated limits unspecified)
    discoveryMs: 300000,      // full event/series discovery cadence
    maxTracked: 8,            // highest-dollar tracked markets (by derived 24h dollar-volume estimate)
    maxSwings: 400,
    swingStoreKey: 'kalshidash:catalyst:swings:v1'
  };

  var MODE = { live: false, base: null, lastError: null, backoffUntil: 0, snapshotFallback: false };

  /* ---------------- small helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
  }
  function num(v) { var n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  function usd(v, d) {
    var n = num(v);
    return n === null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(d === undefined ? 4 : d);
  }
  function clockT(iso) {
    /* Full UTC date + time, not just the clock time. The feed keeps up to 120 swings, which can
     * span more than one day, and a bare "14:05:00Z" made two different days look like the same
     * moment — the one thing a trader must not misread on a chart of sharp moves. */
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 19) + 'Z';
  }
  function apiLink(url, label) {
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="Official Kalshi endpoint (source of this row)">' + esc(label || 'API') + ' ↗</a>';
  }
  function docLink(url, label) {
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="Official Kalshi documentation">' + esc(label) + ' ↗</a>';
  }

  /* ---------------- topic classification (client-side heuristic; Get Events documents no category parameter — F-62) --- */
  /* Map verified in verification/2026-11-20-e6c3b3b6.md and refined here:
     gas = AAA gasoline series (KXAAAGAS*, AAAGAS*); diesel excluded (flag F-18);
     culture = category "Culture" or "Entertainment"; golf = golf-tagged Sports series/titles. */
  function classifyTopic(row) {
    var cat = String(row.category || '').toLowerCase();
    var s = (row.series_ticker || '') + ' ' + (row.title || '') + ' ' + (row.event_title || '');
    var t = s.toLowerCase();
    if (/diesel/.test(t)) return 'other'; // diesel is AAA-settled but out of the brief's "gas prices" scope (F-18)
    if (/aaagas|gasoline|gas price|gas prices|\bgas\b/.test(t) || (/economics/.test(cat) && /oil|gas/.test(t))) return 'gas';
    if (/golf|pga|masters|ryder|tour championship|open championship/.test(t)) return 'golf';
    if (/bitcoin|btc|ethereum|eth\b|solana|crypto|doge|xrp|coinbase/.test(t) || cat === 'crypto') return 'crypto';
    if (/election|senate|house|president|presidential|governor|primary|nominee|electoral|nato|parliament|mayor/.test(t) || cat === 'elections') return 'elections';
    if (/oscar|grammy|emmy|coachella|box office|banned|celebrity|album|movie|film|television|show\b|culture|entertainment/.test(t) || cat === 'culture' || cat === 'entertainment') return 'culture';
    return 'other';
  }
  var TOPIC_LABEL = {
    gas: 'Gas prices', elections: 'Elections', culture: 'Culture',
    crypto: 'Crypto', golf: 'Golf', other: 'Other (not in brief topics)'
  };

  /* ---------------- API client ---------------- */
  function apiUrl(base, path, params) {
    var u = base + path;
    var first = true;
    for (var k in params) {
      if (params[k] === undefined || params[k] === null || params[k] === '') continue;
      u += (first ? '?' : '&') + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      first = false;
    }
    return u;
  }
  function fetchJSON(url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
      if (r.status === 429 || r.status === 403) {
        MODE.backoffUntil = Date.now() + 60000; // docs: "back off on 429" (rate_limits)
        throw new Error('HTTP ' + r.status + ' (backing off 60 s)');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function api(path, params) {
    if (Date.now() < MODE.backoffUntil) return Promise.reject(new Error('rate-limit backoff active'));
    if (!MODE.base) {
      return fetchJSON(apiUrl(CFG.apiPrimary, path, params)).then(function (j) {
        MODE.live = true; MODE.base = CFG.apiPrimary; MODE.lastError = null; return j;
      }, function (e) {
        return fetchJSON(apiUrl(CFG.apiLegacy, path, params)).then(function (j) {
          MODE.live = true; MODE.base = CFG.apiLegacy; MODE.lastError = null; return j;
        }, function (e2) {
          MODE.live = false;
          MODE.lastError = String(e2 && e2.message ? e2.message : e2);
          throw e2;
        });
      });
    }
    return fetchJSON(apiUrl(MODE.base, path, params)).catch(function (e) {
      MODE.lastError = String(e && e.message ? e.message : e);
      throw e;
    });
  }
  function marketApiUrl(ticker) { return CFG.apiPrimary + '/markets/' + encodeURIComponent(ticker); }
  function eventQueryUrl(eventTicker) {
    return CFG.apiPrimary + '/events?status=open&with_nested_markets=true&limit=200';
  }

  /* ---------------- state ---------------- */
  var watch = [];              // market rows: {ticker, event_ticker, series_ticker, title, event_title, category, topic, ...}
  var eventInfo = {};          // event_ticker -> {title, category, settlement_sources, series_ticker, source_url}
  var obs = {};                // ticker -> [{t: epochSec, p: price, src}]
  var swings = [];             // swing records (newest first)
  var lastAlert = {};          // ticker+dir -> epochSec
  var selectedTicker = null;
  var windowSec = 3600;
  var chartCache = {};         // ticker -> candle points [{t, p, src:'candle'}]

  function loadSwings() {
    try {
      var raw = localStorage.getItem(CFG.swingStoreKey);
      swings = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(swings)) swings = [];
    } catch (e) { swings = []; }
  }
  function saveSwings() {
    try { localStorage.setItem(CFG.swingStoreKey, JSON.stringify(swings.slice(0, CFG.maxSwings))); }
    catch (e) { /* storage unavailable — feed stays in memory */ }
  }

  /* ---------------- swing detection ---------------- */
  /* A swing is |price_b - price_a| >= $0.10 between two observations at least
     minSampleGapSec apart (live samples or 1-min candle closes — both are labelled in the record). */
  function detectSwing(row, t, p, basis) {
    if (p === null) return;
    var list = obs[row.ticker] || (obs[row.ticker] = []);
    var ref = null;
    for (var i = list.length - 1; i >= 0; i--) {
      if (t - list[i].t >= CFG.minSampleGapSec) { ref = list[i]; break; }
    }
    list.push({ t: t, p: p, src: basis });
    if (list.length > 2000) list.splice(0, list.length - 2000);
    if (!ref) return;
    var delta = p - ref.p;
    if (Math.abs(delta) + 1e-9 < CFG.threshold) return;
    var dir = delta > 0 ? 'up' : 'down';
    var key = row.ticker + '|' + dir;
    if (lastAlert[key] && t - lastAlert[key] < CFG.cooldownSec) return;
    lastAlert[key] = t;
    pushSwing({
      id: row.ticker + '-' + t + '-' + dir,
      ts: new Date(t * 1000).toISOString(),
      basis: basis === 'candle' ? 'candle-close' : 'live-sample',
      ticker: row.ticker,
      event_ticker: row.event_ticker || '',
      series_ticker: row.series_ticker || '',
      title: row.title || '',
      event_title: row.event_title || '',
      topic: row.topic || classifyTopic(row),
      from_dollars: ref.p,
      to_dollars: p,
      delta_dollars: delta,
      dir: dir,
      status: row.status || '',
      result: row.result || '',
      volume_24h_fp: row.volume_24h_fp || '',
      open_interest_fp: row.open_interest_fp || '',
      settlement_sources: (eventInfo[row.event_ticker] && eventInfo[row.event_ticker].settlement_sources) || []
    });
  }
  function pushSwing(rec) {
    swings.unshift(rec);
    if (swings.length > CFG.maxSwings) swings.length = CFG.maxSwings;
    saveSwings();
    renderFeed();
    renderChart();
  }

  /* A swing may also be compared against the API's previous_price_dollars field
     (previous settlement reference returned on the market object). Reported separately:
     basis "prev-close", only when the API value is present and > 0. */
  function detectPrevCloseSwing(row) {
    var prev = num(row.previous_price_dollars);
    var last = num(row.last_price_dollars);
    if (prev === null || last === null || prev <= 0 || prev === last) return;
    var delta = last - prev;
    if (Math.abs(delta) + 1e-9 < CFG.threshold) return;
    var dir = delta > 0 ? 'up' : 'down';
    var key = row.ticker + '|' + dir + '|prev';
    var now = Math.floor(Date.now() / 1000);
    if (lastAlert[key] && now - lastAlert[key] < CFG.cooldownSec) return;
    lastAlert[key] = now;
    pushSwing({
      id: row.ticker + '-prev-' + dir,
      ts: new Date().toISOString(),
      basis: 'prev-close',
      ticker: row.ticker,
      event_ticker: row.event_ticker || '',
      series_ticker: row.series_ticker || '',
      title: row.title || '',
      event_title: row.event_title || '',
      topic: row.topic || classifyTopic(row),
      from_dollars: prev,
      to_dollars: last,
      delta_dollars: delta,
      dir: dir,
      status: row.status || '',
      result: row.result || '',
      volume_24h_fp: row.volume_24h_fp || '',
      open_interest_fp: row.open_interest_fp || '',
      settlement_sources: (eventInfo[row.event_ticker] && eventInfo[row.event_ticker].settlement_sources) || []
    });
  }

  /* ---------------- data loading ---------------- */
  function marketRowFrom(m, extra) {
    var row = {
      ticker: m.ticker,
      event_ticker: m.event_ticker || (extra && extra.event_ticker) || '',
      series_ticker: (extra && extra.series_ticker) || '',
      title: m.title || (m.yes_sub_title || ''),
      event_title: (extra && extra.event_title) || '',
      category: (extra && extra.category) || '',
      last_price_dollars: m.last_price_dollars,
      previous_price_dollars: m.previous_price_dollars,
      yes_bid_dollars: m.yes_bid_dollars,
      yes_ask_dollars: m.yes_ask_dollars,
      volume_fp: m.volume_fp,
      volume_24h_fp: m.volume_24h_fp,
      open_interest_fp: m.open_interest_fp,
      status: m.status,
      result: m.result,
      close_time: m.close_time
    };
    row.topic = classifyTopic(row);
    return row;
  }

  function upsertRow(row) {
    for (var i = 0; i < watch.length; i++) {
      if (watch[i].ticker === row.ticker) {
        // keep first-seen series/category context; refresh live fields
        row.series_ticker = row.series_ticker || watch[i].series_ticker;
        row.event_title = row.event_title || watch[i].event_title;
        row.category = row.category || watch[i].category;
        row.topic = watch[i].topic === 'other' ? row.topic : watch[i].topic;
        watch[i] = row;
        return;
      }
    }
    watch.push(row);
  }

  function discover() {
    // Events (verified shape: events[] with category, series_ticker, title, settlement_sources,
    // markets[] when with_nested_markets=true). Get Events documents NO category parameter
    // (see F-62), so a single documented discovery query is used and every response is
    // topic-filtered client-side below.
    var eventQueries = [
      { params: { status: 'open', limit: 200, with_nested_markets: 'true' }, src: 'events?status=open&with_nested_markets=true&limit=200' }
    ];
    var jobs = eventQueries.map(function (q) {
      return api('/events', q.params).then(function (j) {
        (j.events || []).forEach(function (ev) {
          var topic = classifyTopic({ category: ev.category, title: ev.title, series_ticker: ev.series_ticker, event_title: ev.title });
          if (topic === 'other') return; // brief: focus topics only
          eventInfo[ev.event_ticker] = {
            title: ev.title,
            category: ev.category,
            series_ticker: ev.series_ticker,
            settlement_sources: ev.settlement_sources || [],
            source_url: (MODE.base || CFG.apiPrimary) + '/events?status=open&with_nested_markets=true&limit=200'
          };
          (ev.markets || []).forEach(function (m) {
            upsertRow(marketRowFrom(m, {
              event_ticker: ev.event_ticker,
              series_ticker: ev.series_ticker,
              event_title: ev.title,
              category: ev.category
            }));
          });
        });
      }, function () { /* one query failed; others continue */ });
    });

    // Gas prices: AAA gasoline series (verified map: Economics + "Oil and energy", KXAAAGAS*/AAAGAS*)
    jobs.push(api('/series', { category: 'Economics', tags: 'Oil and energy', include_volume: 'true' }).then(function (j) {
      var series = (j.series || []).filter(function (s) {
        var t = String(s.ticker || '');
        return /^(KX)?AAAGAS/.test(t) && !/diesel/i.test(t + (s.title || ''));
      }).slice(0, 4);
      return series.reduce(function (chain, s) {
        return chain.then(function () {
          return api('/markets', { series_ticker: s.ticker, status: 'open', limit: 5 }).then(function (mj) {
            (mj.markets || []).forEach(function (m) {
              upsertRow(marketRowFrom(m, {
                event_ticker: m.event_ticker,
                series_ticker: s.ticker,
                event_title: s.title,
                category: s.category
              }));
            });
          }, function () { });
        });
      }, Promise.resolve());
    }, function () { }));

    return Promise.all(jobs).then(function () {
      watch.sort(function (a, b) { return dollarVol(b) - dollarVol(a); });
      if (watch.length > CFG.maxTracked) watch.length = CFG.maxTracked;
      if (!selectedTicker && watch.length) selectedTicker = watch[0].ticker;
      return refreshPrices(true);
    });
  }

  /* Derived ranking metric: 24h dollar-volume ESTIMATE = volume_24h_fp x last_price_dollars.
     The API has no dollar-volume field (flag F-03 on the root flagged page). Derived, labelled. */
  function dollarVol(r) {
    var v = num(r.volume_24h_fp), p = num(r.last_price_dollars);
    return v && p ? v * p : 0;
  }

  function refreshPrices(withHistory) {
    if (!watch.length) return Promise.resolve();
    var bySeries = {};
    watch.forEach(function (r) {
      var k = r.series_ticker || '';
      (bySeries[k] = bySeries[k] || []).push(r);
    });
    var jobs = Object.keys(bySeries).map(function (series) {
      if (!series) return Promise.resolve();
      return api('/markets', { series_ticker: series, status: 'open', limit: 20 }).then(function (j) {
        (j.markets || []).forEach(function (m) {
          var row = marketRowFrom(m, {
            event_ticker: m.event_ticker,
            series_ticker: series,
            event_title: (eventInfo[m.event_ticker] || {}).title,
            category: (eventInfo[m.event_ticker] || {}).category
          });
          upsertRow(row);
          var t = Math.floor(Date.now() / 1000);
          var p = num(m.last_price_dollars);
          if (p !== null) detectSwing(row, t, p, 'live');
          detectPrevCloseSwing(row);
        });
      }, function () { });
    });
    return Promise.all(jobs).then(function () {
      watch.sort(function (a, b) { return dollarVol(b) - dollarVol(a); });
      renderAll();
      if (withHistory) return backfillCandles();
    });
  }

  /* Candle backfill: 1-min candles over the last 6 h, per tracked market (capped).
     Historical swings are detected from consecutive candle closes (basis "candle-close"). */
  function backfillCandles() {
    var now = Math.floor(Date.now() / 1000);
    var jobs = watch.slice(0, 6).map(function (r) {
      if (!r.series_ticker) return Promise.resolve();
      return api('/series/' + encodeURIComponent(r.series_ticker) + '/markets/' + encodeURIComponent(r.ticker) + '/candlesticks', {
        start_ts: now - 6 * 3600, end_ts: now, period_interval: 1
      }).then(function (j) {
        var pts = [];
        (j.candlesticks || []).forEach(function (c) {
          var close = c.price && num(c.price.close_dollars);
          if (close === null) return;
          var t = c.end_period_ts;
          pts.push({ t: t, p: close, src: 'candle' });
        });
        pts.sort(function (a, b) { return a.t - b.t; });
        chartCache[r.ticker] = pts;
        for (var i = 1; i < pts.length; i++) {
          detectSwing(r, pts[i].t, pts[i].p, 'candle');
        }
      }, function () { });
    });
    return Promise.all(jobs).then(function () { renderChart(); });
  }

  /* ---------------- rendering ---------------- */
  function statusCards() {
    var host = $('#status-cards');
    if (!host) return;
    var source = MODE.snapshotFallback
      ? 'snapshot fallback'
      : (MODE.live ? 'live demo API (' + (MODE.base || '').replace('https://', '') + ')' : 'not connected');
    host.innerHTML =
      card('Data source', source, MODE.live
        ? 'Unauthenticated public reads; polled every ' + (CFG.pollMs / 1000) + ' s.'
        : (MODE.lastError ? 'Last error: ' + esc(MODE.lastError) : 'Probing the demo API…')) +
      card('Markets tracked', String(watch.length), 'Top focus-topic markets by derived 24 h dollar-volume estimate (F-03).') +
      card('Swings on record', String(swings.length), '≥ $0.10 moves, persisted in this browser (localStorage).') +
      card('Threshold', '$0.10', 'Either direction. Cooldown ' + (CFG.cooldownSec / 60) + ' min per ticker + direction.');
  }
  function card(k, v, s) {
    return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + s + '</div></div>';
  }

  function renderWatchlist() {
    var host = $('#watch-table');
    if (!host) return;
    if (!watch.length) {
      host.innerHTML = '<p class="muted">No focus-topic markets returned by the API yet' +
        (MODE.live ? '.' : ' (and the browser could not reach the demo API — see the notice above).') + '</p>';
      return;
    }
    var rows = watch.map(function (r) {
      var src = (MODE.base || CFG.apiPrimary) + '/markets?series_ticker=' + encodeURIComponent(r.series_ticker || '') + '&status=open&limit=20';
      return '<tr' + (r.ticker === selectedTicker ? ' class="row-active"' : '') + '>' +
        '<td><button class="linklike" data-ticker="' + esc(r.ticker) + '">' + esc(r.ticker) + '</button></td>' +
        '<td>' + esc(r.title || '—') + '</td>' +
        '<td><span class="badge ok">' + esc(TOPIC_LABEL[r.topic] || r.topic) + '</span></td>' +
        '<td class="num">' + usd(r.last_price_dollars) + '</td>' +
        '<td class="num">' + usd(r.yes_bid_dollars) + ' / ' + usd(r.yes_ask_dollars) + '</td>' +
        '<td class="num">' + esc(r.volume_24h_fp || '—') + '</td>' +
        '<td class="num">' + esc(r.open_interest_fp || '—') + '</td>' +
        '<td class="num">' + (dollarVol(r) ? '$' + dollarVol(r).toFixed(2) + ' <span class="badge warn">est.</span>' : '—') + '</td>' +
        '<td>' + esc(r.status || '—') + (r.result ? ' · result <strong>' + esc(r.result) + '</strong>' : '') + '</td>' +
        '<td>' + apiLink(src, 'source') + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Market ticker</th><th>Title</th><th>Topic</th><th class="num">Last (YES)</th>' +
      '<th class="num">Bid / ask</th><th class="num">24 h vol (fp)</th><th class="num">Open int (fp)</th>' +
      '<th class="num">24 h $ vol (derived)</th><th>Status</th><th>Source</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    [].forEach.call(host.querySelectorAll('button.linklike'), function (b) {
      b.addEventListener('click', function () {
        selectedTicker = b.dataset.ticker;
        renderWatchlist(); renderChart();
      });
    });
  }

  function swingLinks(rec) {
    var links = [];
    links.push(apiLink(marketApiUrl(rec.ticker), 'market'));
    links.push(apiLink(eventQueryUrl(rec.event_ticker), 'events'));
    (rec.settlement_sources || []).slice(0, 4).forEach(function (s) {
      if (s && s.url) links.push('<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="Official settlement source for this event (returned by the API)">' + esc(s.name || 'source') + ' ↗</a>');
    });
    var q = encodeURIComponent((rec.event_title || rec.title || rec.ticker));
    links.push('<a class="disc" href="https://news.google.com/search?q=' + q + '" target="_blank" rel="noopener" title="Possible catalyst — external discovery search only; NOT evidence of causation">news search ↗</a>');
    links.push('<a class="disc" href="https://www.google.com/search?q=' + q + '" target="_blank" rel="noopener" title="Possible catalyst — external discovery search only; NOT evidence of causation">web search ↗</a>');
    return links.join(' · ');
  }

  function renderFeed() {
    var host = $('#swing-feed');
    if (!host) return;
    if (!swings.length) {
      host.innerHTML = '<div class="feed-item muted">No ≥ $0.10 swings recorded yet. The detector watches live prices and 1-min candle closes; ' +
        'a swing appears here as soon as one is observed. (In low-volume demo markets this can take a while.)</div>';
      return;
    }
    host.innerHTML = swings.slice(0, 120).map(function (s) {
      var dirBadge = s.dir === 'up'
        ? '<span class="badge up">▲ +' + usd(s.delta_dollars, 2).replace('$', '$') + '</span>'
        : '<span class="badge down">▼ ' + usd(s.delta_dollars, 2) + '</span>';
      return '<div class="feed-item">' +
        '<div class="feed-head"><span class="feed-time">' + esc(clockT(s.ts)) + '</span>' +
        dirBadge +
        '<span class="badge neutral">' + esc(TOPIC_LABEL[s.topic] || s.topic) + '</span>' +
        '<span class="badge neutral" title="Detection basis">' + esc(s.basis) + '</span></div>' +
        '<div class="feed-body"><strong>' + esc(s.ticker) + '</strong> — ' + esc(s.title || s.event_title || '') +
        ' <span class="muted">(' + usd(s.from_dollars) + ' → ' + usd(s.to_dollars) + ')</span></div>' +
        '<div class="feed-links">' + swingLinks(s) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderChart() {
    var svg = $('#chart');
    if (!svg) return;
    var W = 900, H = 360, padL = 56, padR = 16, padT = 16, padB = 34;
    var pts = ((chartCache[selectedTicker] || []).concat((obs[selectedTicker] || []).map(function (o) {
      return { t: o.t, p: o.p };
    }))).sort(function (a, b) { return a.t - b.t; });
    var now = Math.floor(Date.now() / 1000);
    var tMin = now - windowSec;
    pts = pts.filter(function (p) { return p.t >= tMin && p.p !== null; });
    var marks = swings.filter(function (s) {
      return s.ticker === selectedTicker && (Date.parse(s.ts) / 1000) >= tMin;
    });

    var parts = [];
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>');
    if (!pts.length) {
      parts.push('<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" fill="#6b7280" font-size="14">No price observations for this window yet.</text>');
      svg.innerHTML = parts.join('');
      var note0 = $('#chart-note');
      if (note0) note0.textContent = 'Select a market in the watchlist; points appear from live polling and 1-min candle backfill (last 6 h).';
      return;
    }
    var yMin = 0, yMax = 1;
    pts.forEach(function (p) { if (p.p < yMin) yMin = p.p; if (p.p > yMax) yMax = p.p; });
    yMin = Math.max(0, Math.floor((yMin - 0.05) * 20) / 20);
    yMax = Math.min(1, Math.ceil((yMax + 0.05) * 20) / 20);
    if (yMax <= yMin) yMax = yMin + 0.1;
    function X(t) { return padL + (t - tMin) / (now - tMin || 1) * (W - padL - padR); }
    function Y(v) { return padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB); }

    // grid + axes
    for (var g = 0; g <= 4; g++) {
      var yv = yMin + (yMax - yMin) * g / 4;
      var y = Y(yv);
      parts.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e5e7eb"/>');
      parts.push('<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#6b7280">$' + yv.toFixed(2) + '</text>');
    }
    for (var k = 0; k <= 4; k++) {
      var t = tMin + (now - tMin) * k / 4;
      var x = X(t);
      parts.push('<text x="' + x + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11" fill="#6b7280">' +
        new Date(t * 1000).toISOString().slice(11, 16) + 'Z</text>');
    }
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.p).toFixed(1); }).join(' ');
    parts.push('<path d="' + d + '" fill="none" stroke="#2563eb" stroke-width="2"/>');

    // swing markers (the "events and website links" ride on these jumps)
    marks.forEach(function (s) {
      var t = Date.parse(s.ts) / 1000;
      var x = X(Math.min(Math.max(t, tMin), now)), y = Y(s.to_dollars);
      var color = s.dir === 'up' ? '#16a34a' : '#dc2626';
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6" fill="' + color + '" stroke="#fff" stroke-width="2">' +
        '<title>' + esc(clockT(s.ts) + ' ' + s.dir + ' ' + usd(s.delta_dollars, 2) + ' (' + s.basis + ')') + '</title></circle>');
    });
    svg.innerHTML = parts.join('');

    var row = watch.filter(function (r) { return r.ticker === selectedTicker; })[0] || {};
    var note = $('#chart-note');
    if (note) {
      note.innerHTML = 'X axis = time (window: ' + (windowSec < 3600 ? (windowSec / 60) + ' min' : (windowSec / 3600) + ' h') +
        '), Y axis = contract price (YES, dollars). Colored dots = detected ≥ $0.10 swings (hover for detail; links in the feed below). ' +
        'Points: 1-min candle closes (last 6 h, ' + docLink(CFG.docs.candlesticks, 'candlesticks') + ') + live samples in this browser. ' +
        'Current row source: ' + apiLink(marketApiUrl(selectedTicker || ''), 'GET /markets/' + (selectedTicker || '')) + '. ' +
        'Demo prices may not reflect real markets (' + docLink(CFG.docs.demoEnv, 'demo env') + ').';
    }
  }

  function renderEventSources() {
    var host = $('#event-sources');
    if (!host) return;
    var seen = {};
    var rows = [];
    watch.forEach(function (r) {
      if (!r.event_ticker || seen[r.event_ticker]) return;
      seen[r.event_ticker] = true;
      var ev = eventInfo[r.event_ticker] || {};
      var srcs = (ev.settlement_sources || []).map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name || s.url) + ' ↗</a>';
      }).join(' · ') || '<span class="muted">—</span>';
      rows.push('<tr>' +
        '<td>' + esc(r.event_ticker) + '</td>' +
        '<td>' + esc(ev.title || r.event_title || '—') + '</td>' +
        '<td><span class="badge neutral">' + esc(ev.category || '—') + '</span></td>' +
        '<td>' + srcs + '</td>' +
        '<td>' + apiLink(eventQueryUrl(r.event_ticker), 'event query') + '</td>' +
        '</tr>');
    });
    host.innerHTML = rows.length
      ? '<div class="table-wrap"><table><thead><tr><th>Event ticker</th><th>Event title</th><th>API category</th><th>Official settlement sources (from the API)</th><th>Source</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : '<p class="muted">No focus-topic events loaded yet.</p>';
  }

  function renderAll() {
    statusCards();
    renderWatchlist();
    renderFeed();
    renderChart();
    renderEventSources();
  }

  /* ---------------- boot ---------------- */
  function setWindowButtons() {
    var host = $('#window-btns');
    if (!host) return;
    var wins = [
      { sec: 60, label: '60 s' }, { sec: 300, label: '5 min' }, { sec: 900, label: '15 min' },
      { sec: 3600, label: '1 h' }, { sec: 6 * 3600, label: '6 h' }, { sec: 24 * 3600, label: '24 h' }
    ];
    host.innerHTML = wins.map(function (w) {
      return '<button class="btn small' + (w.sec === windowSec ? ' primary' : '') + '" data-sec="' + w.sec + '">' + w.label + '</button>';
    }).join('');
    [].forEach.call(host.children, function (b) {
      b.addEventListener('click', function () {
        windowSec = parseInt(b.dataset.sec, 10);
        [].forEach.call(host.children, function (c) { c.classList.remove('primary'); });
        b.classList.add('primary');
        renderChart();
      });
    });
  }

  function notice() {
    var el = $('#mode-notice');
    if (!el) return;
    if (MODE.snapshotFallback) {
      el.innerHTML = '<strong>Snapshot mode.</strong> This browser could not reach the Kalshi demo API (' +
        esc(MODE.lastError || 'network/CORS') + '). The watchlist below is the frozen snapshot shipped with the repo ' +
        '(captured 2026-11-20T11:10Z by session-cdfe52bd; source: ' +
        apiLink(CFG.apiPrimary + '/markets?limit=5&status=open', 'demo API') + '). Swing detection needs live data and is paused. ' +
        'Open the API link manually to verify values.';
    } else if (MODE.live) {
      el.innerHTML = '<strong>Live:</strong> reading unauthenticated public endpoints of the official demo Trade API' +
        (MODE.base ? ' (' + esc(MODE.base) + ')' : '') + ' every ' + (CFG.pollMs / 1000) + ' s. ' +
        'If a request is rate-limited (HTTP 429) the client backs off 60 s (' + docLink(CFG.docs.rateLimits, 'rate limits') + ').';
    } else {
      el.innerHTML = '<strong>Data source:</strong> probing the official demo API (' +
        apiLink(CFG.apiPrimary + '/exchange/status', 'exchange/status') + ')…';
    }
  }

  function loadSnapshotFallback() {
    MODE.snapshotFallback = true;
    return fetch('../dash/data/snapshot.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.topics) { renderAll(); return; }
      Object.keys(j.topics).forEach(function (topicId) {
        var t = j.topics[topicId] || {};
        (t.series || []).forEach(function (s) {
          (s.markets || []).forEach(function (m) {
            upsertRow(marketRowFrom(m, {
              event_ticker: m.event_ticker || '',
              series_ticker: s.ticker,
              event_title: s.title || t.label || '',
              category: s.category || ''
            }));
          });
        });
      });
      watch.sort(function (a, b) { return dollarVol(b) - dollarVol(a); });
      if (watch.length > CFG.maxTracked) watch.length = CFG.maxTracked;
      if (!selectedTicker && watch.length) selectedTicker = watch[0].ticker;
      renderAll();
      notice();
    }, function () { renderAll(); notice(); });
  }

  function start() {
    loadSwings();
    setWindowButtons();
    renderAll();
    notice();
    discover().then(function () {
      notice();
      setInterval(function () {
        refreshPrices(false).then(notice, function () { notice(); });
      }, CFG.pollMs);
      setInterval(function () {
        discover().then(notice, function () { notice(); });
      }, CFG.discoveryMs);
    }, function () {
      return loadSnapshotFallback();
    });
    var refreshBtn = $('#refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      refreshPrices(true).then(renderAll, function () { notice(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
