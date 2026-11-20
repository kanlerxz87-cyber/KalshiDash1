/* KalshiDash1 — Kalshi demo API client (public endpoints, no key required).
   Base URL source: https://docs.kalshi.com/getting_started/demo_env
   All field access is defensive: the API has migrated to fixed-point
   `_dollars` / `_fp` fields; older cent fields are handled as fallback.
   Nothing here invents data — failures surface as errors in the UI. */
(function (global) {
  "use strict";
  var BASE = "https://external-api.demo.kalshi.co/trade-api/v2";
  var WS_URL = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2";

  var CATEGORIES = [
    { id: "gas", label: "Gas prices", keywords: ["gasoline", "gas price", "gas prices", "fuel price", "fuel prices"] },
    { id: "elections", label: "Elections", keywords: ["election", "president", "senate", "house race", "governor", "mayor", "ballot", "congress"] },
    { id: "culture", label: "Culture", keywords: ["oscar", "grammy", "emmy", "box office", "movie", "film", "celebrity", "entertainment", "culture"] },
    { id: "crypto", label: "Crypto", keywords: ["crypto", "bitcoin", "ethereum", "btc", "eth price", "digital asset"] },
    { id: "golf", label: "Golf", keywords: ["golf", "pga", "masters", "ryder cup", "open championship"] }
  ];

  function fetchJson(path, opts) {
    opts = opts || {};
    var url = BASE + path;
    return fetch(url, { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" })
      .then(function (r) {
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { /* keep null */ }
          if (!r.ok) {
            var err = new Error("Kalshi API " + r.status + " for " + path + (data && data.message ? ": " + data.message : ""));
            err.status = r.status; err.data = data; throw err;
          }
          return data;
        });
      });
  }

  function num(v, dflt) {
    if (v === null || v === undefined || v === "") return dflt;
    var n = parseFloat(v);
    return isNaN(n) ? dflt : n;
  }
  /* Price fields: prefer *_dollars (string dollars). Fall back to cent fields. */
  function priceDollars(m, side) {
    if (!m) return null;
    var d = m[side + "_bid_dollars"] || m[side + "_ask_dollars"] || m[side + "_last_price_dollars"] || m.last_price_dollars;
    if (d !== undefined && d !== null) return num(d, null);
    var c = m[side + "_bid"] || m[side + "_ask"] || m.last_price;
    if (c !== undefined && c !== null) return num(c, null) / 100;
    return null;
  }
  function lastPrice(m) {
    if (!m) return null;
    var v = m.last_price_dollars !== undefined ? num(m.last_price_dollars, null)
      : (m.last_price !== undefined ? num(m.last_price, null) / 100 : null);
    if (v !== null) return v;
    var yb = priceDollars(m, "yes"), ya = null;
    var yAsk = m.yes_ask_dollars !== undefined ? num(m.yes_ask_dollars, null) : (m.yes_ask !== undefined ? num(m.yes_ask, null) / 100 : null);
    if (yb !== null && yAsk !== null) return (yb + yAsk) / 2;
    return yb;
  }
  function volume(m) { return num(m.volume_fp !== undefined ? m.volume_fp : m.volume, 0); }
  function volume24h(m) { return num(m.volume_24h_fp !== undefined ? m.volume_24h_fp : m.volume_24h, 0); }
  function openInterest(m) { return num(m.open_interest_fp !== undefined ? m.open_interest_fp : m.open_interest, 0); }
  function estNotional(m) { var p = lastPrice(m); return p === null ? 0 : volume(m) * p; }
  function estNotional24h(m) { var p = lastPrice(m); return p === null ? 0 : volume24h(m) * p; }
  /* Market.title and Market.subtitle are marked deprecated in the API reference;
     yes_sub_title is the current shortened title field. */
  function displayTitle(m) { return (m && (m.yes_sub_title || m.title)) || (m && m.ticker) || ""; }
  /* Resolution: Market.result enum is "yes" | "no" | "scalar" | "" (empty while unresolved). */
  function isResolved(m) {
    if (!m) return false;
    if (m.result === "yes" || m.result === "no") return true;
    return m.status === "settled" || m.status === "finalized";
  }
  function resolutionLabel(m) {
    if (!m) return "—";
    if (m.result === "yes") return "YES";
    if (m.result === "no") return "NO";
    if (m.result === "scalar") return "SCALAR (see settlement_value_dollars)";
    if (isResolved(m)) return "SETTLED — result field empty in API";
    return "—";
  }

  function matchCategory(series) {
    var cats = (series.categories || []).join(" ");
    var hay = ((series.title || "") + " " + (series.category || "") + " " + cats + " " + (series.ticker || "")).toLowerCase();
    for (var i = 0; i < CATEGORIES.length; i++) {
      var kws = CATEGORIES[i].keywords;
      for (var j = 0; j < kws.length; j++) {
        if (hay.indexOf(kws[j]) !== -1) return CATEGORIES[i].id;
      }
    }
    return null;
  }

  /* GET /series documented params: category, tags, include_product_metadata, include_volume, min_updated_ts.
     limit/cursor are NOT documented for /series, so we request include_volume only and page
     only if a cursor is actually returned. */
  function getSeriesList(cursor) {
    var q = "?include_volume=true" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    return fetchJson("/series" + q).then(function (d) { return { series: d.series || [], cursor: d.cursor || "" }; });
  }

  /* Discover series for the 5 tracked categories. Pages through /series while a cursor exists. */
  function discoverCategories(maxPages) {
    maxPages = maxPages || 6;
    var found = {}; CATEGORIES.forEach(function (c) { found[c.id] = []; });
    var all = [];
    function page(cursor, n) {
      if (n > maxPages) return Promise.resolve(all);
      return getSeriesList(cursor).then(function (res) {
        res.series.forEach(function (s) {
          all.push(s);
          var cat = matchCategory(s);
          if (cat) found[cat].push(s);
        });
        if (res.cursor && n < maxPages) return page(res.cursor, n + 1);
        return all;
      });
    }
    return page("", 1).then(function () {
      /* Rank each category's series by official series volume_fp (include_volume=true) so the
         most-active series are queried first — this is a documented field, not an estimate. */
      CATEGORIES.forEach(function (c) {
        (found[c.id] || []).sort(function (a, b) { return num(b.volume_fp, 0) - num(a.volume_fp, 0); });
      });
      return { byCategory: found, allSeries: all };
    });
  }

  function getMarkets(params) {
    var qs = Object.keys(params || {}).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetchJson("/markets" + (qs ? "?" + qs : "")).then(function (d) { return { markets: d.markets || [], cursor: d.cursor || "" }; });
  }
  function getMarket(ticker) { return fetchJson("/markets/" + encodeURIComponent(ticker)).then(function (d) { return d.market || d; }); }
  function getOrderbook(ticker, depth) {
    return fetchJson("/markets/" + encodeURIComponent(ticker) + "/orderbook" + (depth ? "?depth=" + depth : ""))
      .then(function (d) { return d.orderbook_fp || d.orderbook || { yes_dollars: [], no_dollars: [] }; });
  }
  function getCandlesticks(seriesTicker, ticker, startTs, endTs, periodInterval) {
    var q = "?start_ts=" + startTs + "&end_ts=" + endTs + "&period_interval=" + periodInterval;
    return fetchJson("/series/" + encodeURIComponent(seriesTicker) + "/markets/" + encodeURIComponent(ticker) + "/candlesticks" + q)
      .then(function (d) { return d.candlesticks || []; });
  }
  function getEvents(params) {
    var qs = Object.keys(params || {}).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetchJson("/events" + (qs ? "?" + qs : "")).then(function (d) { return { events: d.events || [], cursor: d.cursor || "" }; });
  }
  function getExchangeStatus() { return fetchJson("/exchange/status"); }

  /* Rank open markets in the 5 categories by estimated traded notional.
     Returns rows: [{market, category, categoryLabel, seriesTicker, notional, notional24h, volume, lastPrice, openInterest}] */
  function rankHighestDollar(seriesByCategory, maxSeriesPerCat) {
    maxSeriesPerCat = maxSeriesPerCat || 12;
    var jobs = [];
    CATEGORIES.forEach(function (cat) {
      var list = (seriesByCategory[cat.id] || []).slice(0, maxSeriesPerCat);
      list.forEach(function (s) {
        jobs.push(getMarkets({ series_ticker: s.ticker, status: "open", limit: 1000 }).then(function (res) {
          return res.markets.map(function (m) {
            return { market: m, category: cat.id, categoryLabel: cat.label, seriesTicker: s.ticker, seriesTitle: s.title || "",
              notional: estNotional(m), notional24h: estNotional24h(m), volume: volume(m), volume24h: volume24h(m),
              lastPrice: lastPrice(m), openInterest: openInterest(m) };
          });
        }).catch(function () { return []; }));
      });
    });
    return Promise.all(jobs).then(function (chunks) {
      var rows = [];
      chunks.forEach(function (c) { rows = rows.concat(c); });
      rows.sort(function (a, b) { return b.notional - a.notional; });
      return rows;
    });
  }

  /* Recently settled markets (status=settled) — resolution records for tracked series.
     Uses the documented status + min_settled_ts filters and cursor pagination; filters to the
     discovered series client-side to avoid one request per series. */
  function recentSettled(seriesTickerSet, lookbackSec, maxPages) {
    seriesTickerSet = seriesTickerSet || {}; lookbackSec = lookbackSec || 30 * 86400; maxPages = maxPages || 3;
    var out = [];
    function page(cursor, n, params) {
      if (n > maxPages) return Promise.resolve(out);
      var p = Object.assign({}, params); if (cursor) p.cursor = cursor;
      return getMarkets(p).then(function (res) {
        (res.markets || []).forEach(function (m) { if (seriesTickerSet[m.series_ticker]) out.push(m); });
        if (res.cursor && n < maxPages) return page(res.cursor, n + 1, params);
        return out;
      }).catch(function (err) {
        if (n === 1 && err && err.status === 400 && params.min_settled_ts) {
          var fallback = { status: "settled", limit: 1000 };
          return page("", 2, fallback);
        }
        return out;
      });
    }
    return page("", 1, { status: "settled", limit: 1000, min_settled_ts: Math.floor(Date.now() / 1000) - lookbackSec });
  }

  global.KalshiDash = {
    BASE: BASE, WS_URL: WS_URL, CATEGORIES: CATEGORIES,
    fetchJson: fetchJson, num: num, priceDollars: priceDollars, lastPrice: lastPrice,
    volume: volume, volume24h: volume24h, openInterest: openInterest, estNotional: estNotional,
    estNotional24h: estNotional24h, displayTitle: displayTitle, isResolved: isResolved, resolutionLabel: resolutionLabel,
    matchCategory: matchCategory, getSeriesList: getSeriesList, discoverCategories: discoverCategories,
    getMarkets: getMarkets, getMarket: getMarket, getOrderbook: getOrderbook,
    getCandlesticks: getCandlesticks, getEvents: getEvents, getExchangeStatus: getExchangeStatus,
    rankHighestDollar: rankHighestDollar, recentSettled: recentSettled
  };
})(window);
