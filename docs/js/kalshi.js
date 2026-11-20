/* kalshi.js — public-data client for the Kalshi demo Trade API.
 * Tries the recommended demo host, then the legacy host, then the frozen snapshot.
 * All endpoints used here are documented as unauthenticated in docs.kalshi.com
 * (Quick Start: Market Data). Authenticated endpoints (orders, portfolio) are NOT
 * called from the browser — see api.html. */
(function () {
  'use strict';
  var C = window.KALSHI_CONFIG;

  var state = {
    mode: 'probing',            // 'live' | 'legacy' | 'snapshot'
    base: C.endpoints.primary,
    lastError: null,
    listeners: [],
    snapshot: null
  };

  function setMode(mode, base) {
    if (state.mode !== mode) {
      state.mode = mode;
      if (base) state.base = base;
      state.listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
    }
  }

  function tryFetch(base, path, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeoutMs || 8000);
      fetch(base + path, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) {
          clearTimeout(timer);
          if (!r.ok) reject(new Error('HTTP ' + r.status));
          else return r.json().then(resolve, function (e) { clearTimeout(timer); reject(e); });
        })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* GET a public endpoint. Returns {data, base, mode} or throws. */
  function get(path, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 8000;
    var forceSnapshot = opts.snapshotOnly || state.mode === 'snapshot';
    if (forceSnapshot) return Promise.reject(new Error('snapshot mode'));

    var bases = state.mode === 'live' ? [C.endpoints.primary]
      : state.mode === 'legacy' ? [C.endpoints.legacy]
      : [C.endpoints.primary, C.endpoints.legacy];

    return bases.reduce(function (p, base) {
      return p.catch(function () {
        return tryFetch(base, path, timeoutMs).then(function (data) {
          setMode(base === C.endpoints.primary ? 'live' : 'legacy', base);
          state.lastError = null;
          return { data: data, base: base, mode: state.mode };
        });
      });
    }, Promise.reject(new Error('start'))).catch(function (e) {
      state.lastError = String(e && e.message || e);
      throw e;
    });
  }

  /* Load the bundled snapshot (fetch of same-origin JSON; works offline of the API). */
  function loadSnapshot() {
    if (state.snapshot) return Promise.resolve(state.snapshot);
    return fetch('data/snapshot.json').then(function (r) {
      if (!r.ok) throw new Error('snapshot HTTP ' + r.status);
      return r.json();
    }).then(function (j) { state.snapshot = j; return j; });
  }

  function onModeChange(fn) { state.listeners.push(fn); fn(state); }

  /* ---- topic classification (series-based, ticker regex fallback) ---- */
  var seriesTopicIndex = null; // series ticker -> topic id
  function indexSeries(topicsSeriesMap) {
    seriesTopicIndex = {};
    Object.keys(topicsSeriesMap).forEach(function (tid) {
      (topicsSeriesMap[tid] || []).forEach(function (s) { seriesTopicIndex[s.ticker] = tid; });
    });
  }
  function classifyMarket(m) {
    if (seriesTopicIndex && m.series_ticker && seriesTopicIndex[m.series_ticker]) return seriesTopicIndex[m.series_ticker];
    if (seriesTopicIndex && m.event_ticker) {
      var et = m.event_ticker;
      var found = Object.keys(seriesTopicIndex).some(function () { return false; });
    }
    // regex fallback over ticker + title
    for (var i = 0; i < C.topics.length; i++) {
      var t = C.topics[i];
      if ((m.ticker && t.tickerMatch.test(m.ticker)) || (m.title && t.titleMatch.test(m.title))) return t.id;
    }
    return 'other';
  }

  /* ---- formatting helpers ---- */
  function fp(s) { if (s === null || s === undefined || s === '') return null; var n = parseFloat(s); return isNaN(n) ? null : n; }
  function usd(n, dp) { if (n === null || n === undefined || isNaN(n)) return ''; return '$' + Number(n).toFixed(dp === undefined ? 2 : dp); }
  function usd4(s) { var n = fp(s); return n === null ? '' : '$' + n.toFixed(4); }
  function num(s, dp) { var n = fp(s); return n === null ? '' : n.toLocaleString(undefined, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp === undefined ? 2 : dp }); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtTs(iso) {
    if (!iso) return '';
    try { return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'); } catch (e) { return iso; }
  }
  function fmtTsSec(sec) {
    if (!sec) return '';
    return new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  }
  function marketUrl(ticker) { return 'market.html?ticker=' + encodeURIComponent(ticker); }
  function apiLink(url, label) { return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label || 'API') + '</a>'; }

  window.K = {
    cfg: C,
    state: state,
    get: get,
    loadSnapshot: loadSnapshot,
    onModeChange: onModeChange,
    indexSeries: indexSeries,
    classifyMarket: classifyMarket,
    fp: fp, usd: usd, usd4: usd4, num: num, esc: esc,
    fmtTs: fmtTs, fmtTsSec: fmtTsSec,
    marketUrl: marketUrl, apiLink: apiLink
  };
})();
