/* alerts.js — live alerting engine + two scrolling chats (all events / high-ROI model filter).
 *
 * Detection (verified sources):
 *  - Primary: GET /markets/trades?ticker=… (Get Trades, docs.kalshi.com/api-reference/market/get-trades).
 *    Trades are walked newest-first; a swing >= $0.10 between consecutive trade prices fires an alert.
 *    This is the finest public, unauthenticated price data (trade-by-trade).
 *  - Fallback: market polling of last_price_dollars (Get Market) when trades are unavailable.
 *  - Offline: the verified trades_sample in dash/data/snapshot.json is replayed through the same
 *    detector so the chats show real captured swings with no live connection.
 *
 * The high-ROI filter is a TRANSPARENT HEURISTIC model (documented formula below), not a Kalshi
 * feature — it is labeled as such everywhere it appears (flagged F-09).
 */
(function () {
  'use strict';
  var K = window.K;
  var NS = 'kalshidash:alerts:v1:';
  var SWING = 0.10;                       // brief: alert on >= $0.10 either direction
  var WATCH_N = 8;                        // top markets watched across focus topics
  var FEED_CAP = 300;                     // chat entries kept per feed

  /* ---------- persistence ---------- */
  function getJSON(key, fb) {
    try { var raw = localStorage.getItem(NS + key); return raw ? JSON.parse(raw) : fb; }
    catch (e) { return fb; }
  }
  function setJSON(key, v) { try { localStorage.setItem(NS + key, JSON.stringify(v)); } catch (e) {} }

  /* ---------- state ---------- */
  var state = {
    feed: getJSON('feed', null),          // [{id,ts,ticker,title,topic,side,from,to,delta,kind,roi,roiLabel,catalysts,source,resolved}]
    baseline: getJSON('baseline', {}),    // ticker -> last observed YES trade price (or last price)
    paused: false,
    live: false,
    stats: { alerts: 0, up: 0, down: 0, resolutions: 0 }
  };
  if (!state.feed) { state.feed = []; setJSON('feed', state.feed); }

  /* ---------- high-ROI heuristic model ----------
   * score = 0.40 * liquidity + 0.30 * open interest + 0.30 * opportunity
   *   liquidity    = volume_24h_fp normalized against the watched set (0..1)
   *   open interest = open_interest_fp normalized against the watched set (0..1)
   *   opportunity   = |0.5 - last| * 2 (a price near the middle has the most room to move; 0..1)
   * ROI proxy     = (1 - price) for a YES buy, price for a NO buy, times liquidity.
   * Transparent, deterministic, source-linked; NOT an official Kalshi model (flagged F-09). */
  function modelScore(m, norms) {
    var fp = K.fp;
    var vol = fp(m.volume_24h_fp) || 0, oi = fp(m.open_interest_fp) || 0;
    var price = fp(m.last_price_dollars);
    if (price === null) return null;
    var liq = norms.liq[m.ticker] || 0, oiN = norms.oi[m.ticker] || 0;
    var opp = Math.abs(0.5 - price) * 2;
    return {
      score: Math.round((0.40 * liq + 0.30 * oiN + 0.30 * opp) * 1000) / 1000,
      roiYes: Math.round((1 - price) * (0.5 + liq) * 1000) / 1000,
      roiNo: Math.round(price * (0.5 + liq) * 1000) / 1000
    };
  }

  function computeNorms(rows) {
    var maxVol = 1, maxOi = 1;
    rows.forEach(function (m) {
      maxVol = Math.max(maxVol, K.fp(m.volume_24h_fp) || 0);
      maxOi = Math.max(maxOi, K.fp(m.open_interest_fp) || 0);
    });
    var liq = {}, oi = {};
    rows.forEach(function (m) {
      liq[m.ticker] = (K.fp(m.volume_24h_fp) || 0) / maxVol;
      oi[m.ticker] = (K.fp(m.open_interest_fp) || 0) / maxOi;
    });
    return { liq: liq, oi: oi };
  }

  /* ---------- catalyst links (settlement sources from series rows) ---------- */
  function catalystsFor(seriesTicker) {
    if (!seriesTicker) return [];
    var out = [];
    Object.keys(Data.cache.series || {}).forEach(function (tid) {
      (Data.cache.series[tid] || []).forEach(function (s) {
        if (s.ticker !== seriesTicker) return;
        var src = s.settlement_source || '';
        src.split(';').forEach(function (part) {
          var mm = /\(([^)]+)\)/.exec(part.trim());
          if (mm && /^https?:\/\//i.test(mm[1])) {
            out.push({ name: part.trim().replace(/\([^)]*\)/, '').trim() || mm[1], url: mm[1] });
          }
        });
      });
    });
    return out;
  }

  function marketRow(ticker) {
    return Data.allMarkets({ topN: WATCH_N }).then(function (rows) {
      for (var i = 0; i < rows.length; i++) if (rows[i].ticker === ticker) return rows[i];
      return null;
    });
  }

  /* ---------- feed ---------- */
  function pushEntry(e) {
    e.id = 'al-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    state.feed.unshift(e);
    if (state.feed.length > FEED_CAP) state.feed.length = FEED_CAP;
    setJSON('feed', state.feed);
    if (e.kind === 'resolution') state.stats.resolutions++;
    else { state.stats.alerts++; if (e.side === 'up') state.stats.up++; else if (e.side === 'down') state.stats.down++; }
    return e;
  }

  function rowToEntry(m, side, from, to, kind, roi) {
    return {
      ts: new Date().toISOString(),
      ticker: m.ticker,
      title: m.title || m.ticker,
      topic: m.topic,
      event_ticker: m.event_ticker || null,
      series_ticker: m.series_ticker || null,
      side: side, from: from, to: to, delta: to - from,
      kind: kind,
      roi: roi ? roi.score : null,
      roiYes: roi ? roi.roiYes : null,
      roiNo: roi ? roi.roiNo : null,
      catalysts: catalystsFor(m.series_ticker),
      source: m.source_url || (K.state.base + '/markets/' + encodeURIComponent(m.ticker)),
      resolved: m.result || ''
    };
  }

  /* ---------- detectors ---------- */
  function detectFromTrades(m, trades) {
    /* trades: array newest-first; walk from newest, first jump >= SWING vs previous trade fires. */
    var priced = trades.filter(function (t) { return K.fp(t.yes_price_dollars) !== null; });
    if (priced.length < 2) return null;
    for (var i = 1; i < priced.length; i++) {
      var a = K.fp(priced[i - 1].yes_price_dollars);
      var b = K.fp(priced[i].yes_price_dollars);
      if (Math.abs(a - b) >= SWING) {
        return { side: a > b ? 'up' : 'down', from: b, to: a };
      }
    }
    return null;
  }

  function detectFromPrice(m) {
    var cur = K.fp(m.last_price_dollars);
    if (cur === null) return null;
    var prev = K.fp(state.baseline[m.ticker]);
    if (prev === null || prev === undefined) { state.baseline[m.ticker] = cur; return null; }
    if (Math.abs(cur - prev) >= SWING) {
      var side = cur > prev ? 'up' : 'down';
      state.baseline[m.ticker] = cur;
      return { side: side, from: prev, to: cur };
    }
    state.baseline[m.ticker] = cur;
    return null;
  }

  function fireAlert(m, hit, roi, kind) {
    if (state.paused) return null;
    var e = rowToEntry(m, hit.side, hit.from, hit.to, kind, roi);
    pushEntry(e);
    return e;
  }

  /* ---------- engine tick ---------- */
  var rows = [];        // watched market rows
  var norms = { liq: {}, oi: {} };

  function refreshWatchlist() {
    return Data.allMarkets({ topN: WATCH_N }).then(function (r) {
      rows = r.filter(function (m) { return !m.result && (m.status === 'active' || m.status === 'closed'); });
      if (!rows.length) return Data.snapshot().then(function (snap) {
        var top = [];
        Object.keys(snap.topics).forEach(function (tid) {
          (snap.topics[tid].live_markets || []).forEach(function (m) { top.push(Object.assign({}, m, { topic: tid })); });
        });
        top.sort(function (a, b) {
          return (K.fp(b.volume_24h_fp) || 0) - (K.fp(a.volume_24h_fp) || 0) || (K.fp(b.volume_fp) || 0) - (K.fp(a.volume_fp) || 0);
        });
        rows = top.slice(0, WATCH_N).map(function (m) { return Object.assign({}, m, { live: false, fromSnapshot: true }); });
      });
      norms = computeNorms(rows);
      // resolutions: settle known results into the feed
      return rows.forEach(function (m) {
        if (m.result && !state.baseline['res:' + m.ticker]) {
          state.baseline['res:' + m.ticker] = m.result;
          var roi = modelScore(m, norms);
          pushEntry(rowToEntry(m, m.result === 'yes' ? 'up' : 'down', 0, 1, 'resolution', roi));
        }
      });
    });
  }

  function tickOne(m) {
    var roi = modelScore(m, norms);
    // 1) trade-by-trade detection (live)
    if (!m.fromSnapshot) {
      return K.get('/markets/trades?ticker=' + encodeURIComponent(m.ticker) + '&limit=100', { timeoutMs: 8000 })
        .then(function (r) {
          var trades = r.data.trades || [];
          if (trades.length) {
            var newest = trades[0];
            var lastPrice = K.fp(newest.yes_price_dollars);
            var prev = K.fp(state.baseline[m.ticker]);
            if (lastPrice !== null && prev !== null && prev !== undefined && Math.abs(lastPrice - prev) >= SWING) {
              var hit = { side: lastPrice > prev ? 'up' : 'down', from: prev, to: lastPrice };
              state.baseline[m.ticker] = lastPrice;
              return fireAlert(m, hit, roi, 'swing');
            }
            if (lastPrice !== null) state.baseline[m.ticker] = lastPrice;
            var deeper = detectFromTrades(m, trades);
            if (deeper) return fireAlert(m, deeper, roi, 'swing');
          }
          // 2) last-price fallback
          var p = detectFromPrice(m);
          if (p) return fireAlert(m, p, roi, 'swing');
          return null;
        })
        .catch(function () {
          var p = detectFromPrice(m);
          if (p) return fireAlert(m, p, roi, 'swing');
          return null;
        });
    }
    // snapshot fallback: replay verified trades_sample through the same detector
    return Data.snapshot().then(function (snap) {
      var ts = snap.trades_sample;
      if (ts && ts.ticker === m.ticker && ts.trades && ts.trades.length) {
        var byTs = ts.trades.slice().sort(function (a, b) { return String(b.created_time).localeCompare(String(a.created_time)); });
        var hit = detectFromTrades(m, byTs);
        if (hit) {
          var e = rowToEntry(m, hit.side, hit.from, hit.to, 'swing', roi);
          e.ts = byTs[0].created_time;
          e.source = ts.source_url;
          e.replay = true;
          return pushEntry(e);
        }
      }
      var p = detectFromPrice(m);
      if (p) return fireAlert(m, p, roi, 'swing');
      return null;
    });
  }

  function tick() {
    if (state.paused || document.hidden) return;
    var seq = rows.slice(0, 6).map(function (m) { return tickOne(m).catch(function () {}); });
    Promise.all(seq);
  }

  /* ---------- offline replay (runs once on load, snapshot mode) ---------- */
  function replayOffline() {
    return Data.snapshot().then(function (snap) {
      var ts = snap.trades_sample;
      if (!ts || !ts.trades) return;
      var m = rows.filter(function (r) { return r.ticker === ts.ticker; })[0];
      if (!m) return;
      var byTs = ts.trades.slice().sort(function (a, b) { return String(b.created_time).localeCompare(String(a.created_time)); });
      var hit = detectFromTrades(m, byTs);
      if (!hit) return;
      var e = rowToEntry(m, hit.side, hit.from, hit.to, 'swing', modelScore(m, norms));
      e.ts = byTs[0].created_time;
      e.source = ts.source_url;
      e.replay = true;
      if (!state.feed.some(function (x) { return x.ticker === e.ticker && x.kind === 'swing' && x.replay; })) pushEntry(e);
    });
  }

  /* ---------- rendering (two scrolling chats) ---------- */
  function entryHtml(e) {
    var dirCls = e.side === 'up' ? 'good' : (e.side === 'down' ? 'bad' : 'neutral');
    var dirArrow = e.side === 'up' ? '▲' : (e.side === 'down' ? '▼' : '•');
    var cat = (e.catalysts || []).slice(0, 3).map(function (c) {
      return '<a href="' + K.esc(c.url) + '" target="_blank" rel="noopener" title="' + K.esc(c.name) + '">' + K.esc(c.name) + '</a>';
    }).join(' · ');
    var roi = e.roi === null || e.roi === undefined ? '' :
      ' <span class="badge accent" title="transparent heuristic model score (F-09)">ROI ' + e.roi.toFixed(2) + '</span>';
    var msg =
      '<div class="msg ' + (e.kind === 'resolution' ? 'res' : dirCls) + '">' +
        '<div class="msg-head"><span class="t mono">' + K.fmtTs(e.ts) + '</span>' +
        '<span class="badge ' + dirCls + '">' + dirArrow + ' ' + (e.kind === 'resolution' ? 'resolved ' + (e.resolved || '?').toUpperCase() : e.side === 'up' ? '+$' + e.delta.toFixed(2) : '−$' + Math.abs(e.delta).toFixed(2)) + '</span>' +
        (e.replay ? ' <span class="badge warn" title="replayed from verified snapshot trades">replay</span>' : '') + roi + '</div>' +
        '<div class="msg-body"><a href="' + K.marketUrl(e.ticker) + '">' + K.esc(e.title) + '</a>' +
        '<code class="small">' + K.esc(e.ticker) + '</code> · ' + App.topicLabel(e.topic) +
        (e.kind !== 'resolution' ? ' · $' + e.from.toFixed(2) + ' → $' + e.to.toFixed(2) : '') + '</div>' +
        (cat ? '<div class="msg-cat small">catalysts: ' + cat + '</div>' : '') +
        '<div class="msg-src small"><a href="' + K.esc(e.source) + '" target="_blank" rel="noopener">source</a></div>' +
      '</div>';
    return msg;
  }

  function renderChat(elId, filter) {
    var el = document.getElementById(elId);
    if (!el) return;
    var rows = state.feed.filter(filter).slice(0, 120);
    el.innerHTML = rows.length
      ? rows.map(entryHtml).join('')
      : '<div class="chat-empty">Waiting for alerts — watching the top markets for swings ≥ $0.10. New entries appear here automatically.</div>';
    if (el.scrollTop !== el.scrollHeight) el.scrollTop = el.scrollHeight;
  }

  function render() {
    renderChat('chat-all', function () { return true; });
    renderChat('chat-roi', function (e) { return e.roi !== null && e.roi !== undefined && e.roi >= 0.5; });
    var st = document.getElementById('alert-stats');
    if (st) st.innerHTML =
      '<div class="stat"><div class="label">Alerts fired</div><div class="value">' + state.stats.alerts + '</div><div class="note">≥ $0.10 swings since page load</div></div>' +
      '<div class="stat"><div class="label">▲ up / ▼ down</div><div class="value">' + state.stats.up + ' / ' + state.stats.down + '</div><div class="note">direction of the swing</div></div>' +
      '<div class="stat"><div class="label">Resolutions tracked</div><div class="value">' + state.stats.resolutions + '</div><div class="note">markets resolved yes/no</div></div>' +
      '<div class="stat"><div class="label">Data mode</div><div class="value">' + (K.state.mode === 'snapshot' ? 'SNAPSHOT' : 'LIVE') + '</div><div class="note">' + (K.state.mode === 'snapshot' ? 'trades replayed from verified capture' : 'polling official demo API') + '</div></div>';
    var paused = document.getElementById('pause-btn');
    if (paused) paused.textContent = state.paused ? 'Resume alerts' : 'Pause alerts';
  }

  /* ---------- public API ---------- */
  function init() {
    refreshWatchlist().then(function () {
      replayOffline().then(render);
      setInterval(function () { refreshWatchlist().then(render); }, K.cfg.polling.listRefreshMs);
      setInterval(function () { tick(); }, K.cfg.polling.marketRefreshMs);
    });
    render();
    setInterval(render, 4000);
  }

  window.Alerts = {
    init: init,
    state: state,
    refresh: refreshWatchlist,
    replay: replayOffline,
    render: render,
    setPaused: function (p) { state.paused = p; render(); },
    clear: function () { state.feed = []; state.stats = { alerts: 0, up: 0, down: 0, resolutions: 0 }; setJSON('feed', []); render(); },
    modelScore: modelScore,
    computeNorms: computeNorms
  };
})();
