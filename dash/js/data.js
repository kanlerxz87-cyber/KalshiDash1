/* data.js — topic data pipeline: live demo API first, bundled snapshot as fallback.
 * Pipeline per topic: series list (category/tag filtered, include_volume) -> top series
 * by volume_fp -> open markets per series -> rank by 24h volume. Documented on api.html. */
(function () {
  'use strict';
  var K = window.K;

  var cache = {
    snapshot: null,
    series: {},      // topicId -> rows
    markets: {},     // topicId -> rows
    liveErrors: []
  };

  function snapshot() {
    if (!cache.snapshot) cache.snapshot = K.loadSnapshot();
    return cache.snapshot;
  }

  function seriesRowFromApi(s, topicId, sourceUrl) {
    return {
      ticker: s.ticker,
      title: s.title,
      category: s.category,
      tags: s.tags || [],
      volume_fp: s.volume_fp === undefined ? null : s.volume_fp,
      contract_terms_url: s.contract_terms_url || null,
      settlement_source: (s.settlement_sources || []).map(function (x) { return x.name + ' (' + x.url + ')'; }).join('; ') || null,
      topic: topicId,
      source_url: sourceUrl,
      live: true
    };
  }

  function marketRowFromApi(m, topicId, sourceUrl, seriesTicker) {
    return {
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      series_ticker: seriesTicker || m.series_ticker || null,
      title: m.title || m.yes_sub_title || m.ticker,
      topic: topicId,
      status: m.status,
      result: m.result || '',
      last_price_dollars: m.last_price_dollars,
      previous_price_dollars: m.previous_price_dollars,
      yes_bid_dollars: m.yes_bid_dollars,
      yes_ask_dollars: m.yes_ask_dollars,
      no_bid_dollars: m.no_bid_dollars,
      no_ask_dollars: m.no_ask_dollars,
      yes_bid_size_fp: m.yes_bid_size_fp,
      yes_ask_size_fp: m.yes_ask_size_fp,
      volume_fp: m.volume_fp,
      volume_24h_fp: m.volume_24h_fp,
      open_interest_fp: m.open_interest_fp,
      notional_value_dollars: m.notional_value_dollars,
      close_time: m.close_time,
      expected_expiration_time: m.expected_expiration_time,
      latest_expiration_time: m.latest_expiration_time,
      rules_primary: m.rules_primary || '',
      settlement_ts: m.settlement_ts || null,
      settlement_value_dollars: m.settlement_value_dollars || null,
      source_url: sourceUrl,
      live: true
    };
  }

  function snapshotRows(topicId) {
    return snapshot().then(function (snap) {
      var t = snap.topics[topicId];
      if (!t) return { series: [], markets: [], settled: [], note: '' };
      var markets = (t.live_markets || []).map(function (m) { return Object.assign({}, m, { live: false, fromSnapshot: true }); });
      return {
        series: (t.series || []).map(function (s) { return Object.assign({}, s, { topic: topicId, live: false, fromSnapshot: true }); }),
        markets: markets,
        settled: t.settled_events || [],
        note: t.live_note || '',
        source_query: t.series_query
      };
    });
  }

  function loadTopicSeries(topicId) {
    if (cache.series[topicId]) return cache.series[topicId];
    var topic = K.cfg.topics.filter(function (t) { return t.id === topicId; })[0];
    if (!topic) return Promise.resolve([]);

    var p = Promise.all(topic.seriesQueries.map(function (q) {
      return K.get(q, { timeoutMs: 9000 }).then(function (r) {
        var url = K.state.base + q;
        return (r.data.series || []).map(function (s) { return seriesRowFromApi(s, topicId, url); });
      });
    })).then(function (lists) {
      var seen = {};
      var merged = [];
      lists.forEach(function (l) {
        l.forEach(function (s) {
          if (!seen[s.ticker]) {
            seen[s.ticker] = true;
            // topic focus filter (e.g. gas = title/ticker match), keeps categories tight
            if (!topic.titleMatch.test(s.title || '') && !topic.tickerMatch.test(s.ticker || '')) return;
            merged.push(s);
          }
        });
      });
      merged.sort(function (a, b) { return (K.fp(b.volume_fp) || 0) - (K.fp(a.volume_fp) || 0); });
      cache.series[topicId] = merged;
      return merged;
    }).catch(function (e) {
      cache.liveErrors.push(topicId + ': ' + e.message);
      return snapshotRows(topicId).then(function (r) { return r.series; });
    });
    cache.series[topicId] = p;
    return p;
  }

  function loadTopicMarkets(topicId, opts) {
    opts = opts || {};
    if (cache.markets[topicId] && !opts.force) return cache.markets[topicId];
    var p = loadTopicSeries(topicId).then(function (series) {
      var top = series.slice(0, opts.topN || 6);
      return Promise.all(top.map(function (s) {
        var q = '/markets?series_ticker=' + encodeURIComponent(s.ticker) + '&status=open&limit=50';
        return K.get(q, { timeoutMs: 9000 }).then(function (r) {
          var url = K.state.base + q;
          return (r.data.markets || []).map(function (m) { return marketRowFromApi(m, topicId, url, s.ticker); });
        }).catch(function () { return []; });
      })).then(function (lists) {
        var merged = [].concat.apply([], lists);
        merged.sort(function (a, b) {
          return (K.fp(b.volume_24h_fp) || 0) - (K.fp(a.volume_24h_fp) || 0) ||
                 (K.fp(b.volume_fp) || 0) - (K.fp(a.volume_fp) || 0);
        });
        if (merged.length) { cache.markets[topicId] = merged; return merged; }
        // live worked but no open markets -> return snapshot rows (which also record "no open markets" notes)
        return snapshotRows(topicId).then(function (r) { cache.markets[topicId] = r.markets; return r.markets; });
      });
    }).catch(function (e) {
      return snapshotRows(topicId).then(function (r) { cache.markets[topicId] = r.markets; return r.markets; });
    });
    cache.markets[topicId] = p;
    return p;
  }

  function allMarkets(opts) {
    return Promise.all(K.cfg.topics.map(function (t) { return loadTopicMarkets(t.id, opts); })).then(function (lists) {
      var merged = [].concat.apply([], lists);
      merged.sort(function (a, b) {
        return (K.fp(b.volume_24h_fp) || 0) - (K.fp(a.volume_24h_fp) || 0) ||
               (K.fp(b.volume_fp) || 0) - (K.fp(a.volume_fp) || 0);
      });
      return merged;
    });
  }

  function snapshotSettled() {
    return snapshot().then(function (snap) {
      var out = [];
      Object.keys(snap.topics).forEach(function (tid) {
        (snap.topics[tid].settled_events || []).forEach(function (ev) {
          (ev.markets || []).forEach(function (m) {
            out.push(Object.assign({}, m, {
              event_ticker: ev.event_ticker, event_title: ev.title, topic: tid,
              settlement_ts: ev.settlement_ts, settlement_source: ev.settlement_source,
              source_url: ev.source_url
            }));
          });
        });
      });
      return out;
    });
  }

  function snapshotMeta() { return snapshot().then(function (s) { return s.meta; }); }

  window.Data = {
    snapshot: snapshot, snapshotMeta: snapshotMeta, snapshotRows: snapshotRows,
    loadTopicSeries: loadTopicSeries, loadTopicMarkets: loadTopicMarkets,
    allMarkets: allMarkets, snapshotSettled: snapshotSettled,
    cache: cache
  };
})();
