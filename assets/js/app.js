/* KalshiDash1 — shared client for the verified Kalshi demo Trade API.
 *
 * All endpoints below are documented at https://docs.kalshi.com
 * Demo environment doc: https://docs.kalshi.com/getting_started/demo_env
 *
 * Public (no auth) market-data endpoints used here:
 *   GET /markets                     list markets (series_ticker, status, limit, cursor)
 *   GET /events/{event_ticker}       event detail (title, category, ...)
 *   GET /markets/{ticker}/orderbook  yes/no bid price levels + contract counts
 *   GET /series/{series_ticker}/markets/{ticker}/candlesticks  price history (period 1/60/1440 min)
 *
 * Authenticated endpoints (portfolio / order execution) require a demo API key
 * + Ed25519 private key signature. They are NOT called from this static site because
 * no credentials were provided and none should be entered manually. See portfolio.html
 * and trades.html for the documented structure, flagged as requiring credentials.
 */
(function (window) {
  'use strict';

  // Recommended demo Trade API root (verified against official docs).
  // Also supported: https://demo-api.kalshi.co/trade-api/v2
  const BASE_URL = 'https://external-api.demo.kalshi.co/trade-api/v2';

  const Kalshi = {
    baseUrl: BASE_URL,

    // ---------- request ----------
    fetchJson: async function (path, opts) {
      const url = this.baseUrl + path;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, { signal: controller.signal, ...opts });
        clearTimeout(timeout);
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status + ' ' + res.statusText);
          err.status = res.status;
          try { err.body = await res.json(); } catch (e) { err.body = await res.text(); }
          throw err;
        }
        const ct = res.headers.get('content-type') || '';
        if (ct.indexOf('application/json') === -1) {
          throw new Error('Non-JSON response (' + ct + ') from ' + url);
        }
        return await res.json();
      } finally {
        clearTimeout(timeout);
      }
    },

    // ---------- public market data ----------
    listMarkets: function (params) {
      const qs = [];
      if (params.series_ticker) qs.push('series_ticker=' + encodeURIComponent(params.series_ticker));
      if (params.status) qs.push('status=' + encodeURIComponent(params.status));
      if (params.limit) qs.push('limit=' + encodeURIComponent(params.limit));
      if (params.cursor) qs.push('cursor=' + encodeURIComponent(params.cursor));
      return this.fetchJson('/markets?' + qs.join('&'));
    },
    getEvent: function (eventTicker) {
      return this.fetchJson('/events/' + encodeURIComponent(eventTicker));
    },
    getOrderbook: function (ticker, depth) {
      let path = '/markets/' + encodeURIComponent(ticker) + '/orderbook';
      if (depth) path += '?depth=' + encodeURIComponent(depth);
      return this.fetchJson(path);
    },
    getCandlesticks: function (seriesTicker, ticker, startTs, endTs, periodInterval) {
      const qs = [
        'start_ts=' + encodeURIComponent(startTs),
        'end_ts=' + encodeURIComponent(endTs),
        'period_interval=' + encodeURIComponent(periodInterval),
      ];
      return this.fetchJson(
        '/series/' + encodeURIComponent(seriesTicker) +
        '/markets/' + encodeURIComponent(ticker) +
        '/candlesticks?' + qs.join('&')
      );
    },

    // ---------- helpers ----------
    nowSeconds: function () { return Math.floor(Date.now() / 1000); },
    usd: function (cents) {
      if (cents === null || cents === undefined || cents === '') return '—';
      return '$' + Number(cents).toFixed(2);
    },
    pct: function (v) {
      if (v === null || v === undefined || v === '') return '—';
      return Number(v).toFixed(1) + '%';
    },
    fmtTs: function (seconds) {
      const d = new Date(seconds * 1000);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    sourceLink: function (label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener" class="small">' + label + '</a>';
    }
  };

  window.KalshiDash = window.KalshiDash || {};
  window.KalshiDash.client = Kalshi;
  window.KalshiDash.BASE_URL = BASE_URL;

})(window);
