/* alerts.js — Live Alerts page (session arena-f89b55f7).
 *
 * Requirements this implements (from the project brief):
 *   - live alerting system for contract-price swings ≥ $0.10 in either direction;
 *   - TWO simplified scrolling chats: (1) all tracked markets, (2) a selective filter of
 *     events the ROI model likes as high-ROI (score ≥ 70) including automated SIM trades;
 *   - live chart for the selected alert: X = time (seconds/minutes/hours windows),
 *     Y = contract price; jump markers; cause-research links (official settlement
 *     sources come from the API; news-search links are labeled auto-generated pointers);
 *   - liquidity: contracts available at each price (compact orderbook ladder);
 *   - automated simulated trades (momentum-10c / fade-jump) feeding Portfolio & Analysis.
 *
 * Everything runs on public demo-API reads via K.get (primary → legacy host → bundled
 * verified snapshot). WebSocket streaming is NOT used because the official docs require
 * an authenticated session even for public channels (see dash/api.html §3, F-08).
 */
(function () {
  'use strict';
  App.renderHeader('alerts.html');
  App.renderFooter();
  var K = window.K, E = window.AlertsEngine, Store = window.Store, Data = window.Data;

  var AUTO_STRATS = ['momentum-10c', 'fade-jump'];
  var cfg = Object.assign({}, E.DEFAULTS);
  var POLL_MS = 15000, MAX_POLL_MS = 60000;

  var state = {
    tracked: [],            // rows in the watch set (highest-dollar per topic)
    pollList: [],           // tickers actually polled (tracked + pinned open positions)
    lastObs: Store.getJSON('lastobs', {}),        // ticker -> {price, tsMs}
    lastAlertMeta: Store.getJSON('alertmeta', {}),// ticker -> {dir, tsMs}
    history: Store.getJSON('pricehist', {}),      // ticker -> [{t (sec), v}]
    alerts: Store.getJSON('alertfeed', []),       // all-markets feed (persisted)
    simfeed: Store.getJSON('simfeed', []),        // model-picks + auto-trade feed (persisted)
    polls: 0,
    fails: 0,
    pollMs: POLL_MS,
    autoTrade: Store.getJSON('autotrade', true),
    selected: null,
    seriesTicker: null,
    candles: { 1: [], 60: [] },
    windowId: '5m',
    seriesMap: {},          // series ticker -> [{name,url}] settlement sources (official)
    stopped: false,
    snapshotNote: false
  };

  /* ---------- helpers ---------- */
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function parseSettlement(s) {
    var out = [], re = /([^;\(]+?)\s*\((https?:[^)]+)\)/g, m;
    while ((m = re.exec(String(s || ''))) !== null) out.push({ name: m[1].trim(), url: m[2] });
    return out;
  }
  function newsUrl(title) {
    return 'https://news.google.com/search?q=' + encodeURIComponent(title || '');
  }
  function hhmmss(tsMs) {
    return new Date(tsMs).toISOString().substr(11, 8) + 'Z';
  }
  function openAutoTrades() {
    return Store.getTrades().filter(function (t) {
      return t.status === 'open' && !t.seed && AUTO_STRATS.indexOf(t.strategy) !== -1;
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

  /* ---------- persistence ---------- */
  function saveAll() {
    Store.setJSON('lastobs', state.lastObs);
    Store.setJSON('alertmeta', state.lastAlertMeta);
    Store.setJSON('pricehist', pruneHistory());
    Store.setJSON('alertfeed', state.alerts.slice(0, 300));
    Store.setJSON('simfeed', state.simfeed.slice(0, 300));
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

  /* ---------- watch set ---------- */
  function buildSeriesMap() {
    var promises = K.cfg.topics.map(function (t) {
      return Data.loadTopicSeries(t.id).then(function (rows) {
        rows.forEach(function (s) {
          var src = parseSettlement(s.settlement_source);
          if (src.length) state.seriesMap[s.ticker] = src;
        });
      }).catch(function () {});
    });
    return Promise.all(promises);
  }

  function buildTrackSet(force) {
    return Data.allMarkets({ force: !!force, topN: cfg.perTopic }).then(function (rows) {
      state.tracked = E.pickTracked(rows, cfg);
      buildPollList();
      renderModelTable();
      return state.tracked;
    });
  }

  function buildPollList() {
    var seen = {}, list = [];
    state.tracked.forEach(function (m) {
      if (!seen[m.ticker]) { seen[m.ticker] = 1; list.push(m.ticker); }
    });
    openAutoTrades().forEach(function (t) {   // pin open positions so exits are evaluated
      if (!seen[t.ticker]) { seen[t.ticker] = 1; list.push(t.ticker); }
    });
    state.pollList = list.slice(0, 45);
  }

  /* ---------- chats ---------- */
  function chatPush(el, node, cap) {
    el.appendChild(node);
    while (el.children.length > cap) el.removeChild(el.firstChild);
  }
  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 40; }
  function autoscroll(el) {
    var paused = false, stick = true;
    el.addEventListener('mouseenter', function () { paused = true; });
    el.addEventListener('mouseleave', function () { paused = false; });
    el.addEventListener('scroll', function () {
      stick = nearBottom(el);
    });
    el._tick = function () { if (!paused && stick) el.scrollTop = el.scrollHeight; };
  }

  function alertRow(a, scored) {
    var d = document.createElement('div');
    d.className = 'chat-row' + (scored && scored.liked ? ' liked' : '');
    var arrow = a.dir === 'up' ? '▲' : '▼';
    var cents = (a.delta >= 0 ? '+' : '−') + Math.round(Math.abs(a.delta) * 100) + '¢';
    var sim = '';
    if (scored) sim = ' <span class="score-badge">model ' + scored.score + '</span>';
    d.innerHTML =
      '<span class="t">' + hhmmss(a.tsMs) + '</span>' +
      '<span class="arrow ' + a.dir + '">' + arrow + ' ' + cents + '</span>' +
      '<span class="topic">' + K.esc(App.topicLabel(a.topic)) + '</span>' +
      '<a href="' + K.marketUrl(a.ticker) + '" data-tk="' + K.esc(a.ticker) + '" class="tk">' +
        K.esc((a.title || a.ticker).slice(0, 64)) + '</a>' +
      '<span class="px">' + K.usd4(String(a.from)) + ' → <strong>' + K.usd4(String(a.to)) + '</strong></span>' +
      sim +
      '<button class="btn tiny" data-detail="' + K.esc(a.ticker) + '">why / chart</button>';
    d.querySelector('[data-detail]').addEventListener('click', function () {
      selectAlert(a.ticker);
    });
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
    allEl.innerHTML = ''; modelEl.innerHTML = '';
    state.alerts.slice(-120).forEach(function (a) {
      chatPush(allEl, alertRow(a, a.liked ? { score: a.score, liked: true } : null), 120);
    });
    state.simfeed.slice(-120).forEach(function (s) {
      if (s.kind === 'alert') chatPush(modelEl, alertRow(s.alert, { score: s.score, liked: true }), 120);
      else chatPush(modelEl, simRow(s), 120);
    });
    tickChats();
  }
  function pushAlert(a, scored) {
    state.alerts.push(a);
    chatPush(document.getElementById('chat-all'), alertRow(a, null), 120);
    if (scored && scored.liked) {
      a.liked = true; a.score = scored.score;
      state.simfeed.push({ kind: 'alert', tsMs: a.tsMs, alert: a, score: scored.score });
      chatPush(document.getElementById('chat-model'), alertRow(a, scored), 120);
    }
    tickChats();
  }
  function pushSim(s) {
    state.simfeed.push(s);
    chatPush(document.getElementById('chat-model'), simRow(s), 120);
    tickChats();
  }
  function tickChats() {
    ['chat-all', 'chat-model'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el._tick) el._tick();
    });
  }

  /* ---------- engine status / stats ---------- */
  function renderStatus() {
    var st = K.state;
    document.getElementById('engine-status').innerHTML =
      'mode <strong>' + K.esc(st.mode) + '</strong> · tracking <strong>' + state.pollList.length +
      '</strong> markets · polls <strong>' + state.polls + '</strong> · every ' +
      Math.round(state.pollMs / 1000) + 's · threshold <strong>≥ $' + cfg.alertThreshold.toFixed(2) +
      '</strong> both directions · dedup window ' + Math.round(cfg.dedupMs / 1000) + 's' +
      (document.hidden ? ' · <span class="badge warn">tab hidden — polling paused</span>' : '');
    var open = openAutoTrades();
    var auto = Store.getTrades().filter(function (t) { return !t.seed && AUTO_STRATS.indexOf(t.strategy) !== -1 && t.status === 'settled'; });
    var realized = auto.reduce(function (a, t) { return a + (t.pnl || 0); }, 0);
    document.getElementById('at-stats').textContent =
      state.alerts.length + ' alerts stored · ' + open.length + ' auto position(s) open · ' +
      auto.length + ' auto trade(s) closed · realized ' + (realized >= 0 ? '+' : '') + K.usd(realized);
  }
  function renderAtToggle() {
    var b = document.getElementById('at-toggle');
    b.textContent = state.autoTrade ? 'Auto-trading: ON (simulated)' : 'Auto-trading: OFF';
    b.className = 'btn small ' + (state.autoTrade ? 'good' : '');
  }

  /* ---------- poll cycle ---------- */
  function pollQueryUrl() {
    return K.state.base + '/markets?tickers=' + state.pollList.map(encodeURIComponent).join(',');
  }

  function processRows(markets, nowMs) {
    var now = nowMs || Date.now();
    var topicByTicker = {}, tradeByTicker = {};
    state.tracked.forEach(function (m) { topicByTicker[m.ticker] = m.topic; });
    Store.getTrades().forEach(function (t) { tradeByTicker[t.ticker] = t.topic; });

    var rowsByTicker = {};
    (markets || []).forEach(function (m) {
      rowsByTicker[m.ticker] = m;
      var v = K.fp(m.last_price_dollars);
      if (v === null) return;                       // never invent a price
      var tSec = Math.floor(now / 1000);
      var h = state.history[m.ticker] = state.history[m.ticker] || [];
      var lastPt = h[h.length - 1];
      if (!lastPt || lastPt.t !== tSec || lastPt.v !== v) h.push({ t: tSec, v: v });
      if (h.length > 1600) state.history[m.ticker] = h.slice(-800);

      var prev = state.lastObs[m.ticker];
      state.lastObs[m.ticker] = { price: v, tsMs: now };

      var swing = prev ? E.detectSwing(prev, { price: v, tsMs: now }, cfg, now) : null;
      if (!swing) return;
      if (!E.shouldAlert(state.lastAlertMeta[m.ticker], swing.dir, cfg, now)) return;
      state.lastAlertMeta[m.ticker] = { dir: swing.dir, tsMs: now };

      var scored = E.scoreMarket(m, { recentDelta: recentDeltaOf(m.ticker, now) }, cfg);
      var topic = topicByTicker[m.ticker] || tradeByTicker[m.ticker] || 'other';
      var alert = {
        id: 'al-' + now + '-' + m.ticker,
        tsMs: now, ts: new Date(now).toISOString(),
        ticker: m.ticker, title: m.title || m.yes_sub_title || m.ticker,
        topic: topic, series_ticker: m.series_ticker || null,
        from: swing.from, to: swing.to, delta: swing.delta, dir: swing.dir,
        yes_bid: m.yes_bid_dollars, yes_ask: m.yes_ask_dollars,
        no_bid: m.no_bid_dollars, no_ask: m.no_ask_dollars,
        yes_bid_size: m.yes_bid_size_fp, yes_ask_size: m.yes_ask_size_fp,
        vol24: m.volume_24h_fp, oi: m.open_interest_fp,
        source_url: pollQueryUrl()
      };
      pushAlert(alert, scored);
      if (alert.ticker === state.selected) { renderDetailHeader(); renderCause(); }

      if (state.autoTrade) {
        var st = { openCount: openAutoTrades().length, byTicker: {} };
        openAutoTrades().forEach(function (t) { st.byTicker[t.ticker] = true; });
        var plan = E.planEntry({
          ticker: m.ticker, dir: swing.dir,
          yes_ask: m.yes_ask_dollars, yes_bid: m.yes_bid_dollars,
          no_bid: m.no_bid_dollars, no_ask: m.no_ask_dollars
        }, scored, st, cfg);
        if (plan) {
          var tr = Store.addTrade({
            ticker: m.ticker, title: alert.title, topic: topic,
            side: plan.side, price: plan.price, qty: plan.qty,
            strategy: plan.strategy, fee: 0, auto: true
          });
          pushSim({ kind: 'entry', tsMs: now, ticker: m.ticker, title: alert.title, topic: topic,
                    side: plan.side, price: plan.price, qty: plan.qty, strategy: plan.strategy,
                    reason: plan.reason, score: scored.score, id: tr.id });
        }
      }
    });

    evaluateExits(rowsByTicker, now);
    if (state.selected && rowsByTicker[state.selected]) {
      state.selectedRow = rowsByTicker[state.selected];
      renderDetailHeader();
    }
    saveAll();
    renderStatus();
  }

  function evaluateExits(rowsByTicker, now) {
    openAutoTrades().forEach(function (t) {
      var m = rowsByTicker[t.ticker];
      if (!m) return;
      var last = K.fp(m.last_price_dollars);
      if (last === null) return;
      var exit = E.planExit({
        side: t.side, price: t.price, qty: t.qty,
        openedMs: Date.parse(t.ts), status: 'open'
      }, last, cfg, now);
      if (!exit) return;
      Store.updateTrade(t.id, {
        status: 'settled', exit_price: exit.exitPrice, pnl: exit.pnl,
        exit_reason: exit.reason, result: t.result || ''
      });
      pushSim({ kind: 'exit', tsMs: now, ticker: t.ticker, title: t.title, topic: t.topic,
                exitPrice: exit.exitPrice, pnl: exit.pnl, reason: exit.reason, strategy: t.strategy });
    });
  }

  function onPollSuccess() {
    state.polls++; state.fails = 0; state.pollMs = POLL_MS;
    document.getElementById('engine-notice').className = 'notice good';
    document.getElementById('engine-notice').innerHTML =
      '<strong>Live alert engine running.</strong> Polling <code>GET /markets?tickers=…</code> on ' +
      K.esc(K.state.base) + ' (batch endpoint verified live 2026-11-20 — see <a href="sources.html">Sources</a>). ' +
      'Alerts fire when the YES last-traded price moves ≥ $0.10 between two observations. REST responses are cached briefly ' +
      'per the official docs, so timestamps can lag fills by the cache lag + one poll interval (<a href="flagged.html">F-08</a>).';
  }
  function onPollFail(e) {
    state.fails++;
    state.pollMs = Math.min(MAX_POLL_MS, POLL_MS * Math.pow(2, state.fails));
    if (K.state.mode === 'snapshot') stopEngine();
    else {
      document.getElementById('engine-notice').className = 'notice warn';
      document.getElementById('engine-notice').innerHTML =
        '<strong>Poll failed (' + K.esc(String(e && e.message || e)) + ')</strong> — retrying with backoff. ' +
        'Rate limits: unauthenticated requests have separate limits; the engine backs off on failures (<a href="https://docs.kalshi.com/getting_started/rate_limits" target="_blank" rel="noopener">docs</a>).';
    }
  }

  function poll() {
    if (state.stopped) return;
    if (document.hidden) { renderStatus(); schedule(); return; }
    if (!state.pollList.length) {
      buildTrackSet(false).then(function () {
        if (state.pollList.length) pollOnce(); else schedule();
      });
      return;
    }
    pollOnce();
    function pollOnce() {
      K.get('/markets?tickers=' + state.pollList.map(encodeURIComponent).join(','), { timeoutMs: 9000 })
        .then(function (r) {
          onPollSuccess();
          processRows(r.data.markets || [], Date.now());
          if (state.selected && !document.hidden) loadDetail(state.selected);
          schedule();
        })
        .catch(function (e) { onPollFail(e); renderStatus(); schedule(); });
    }
  }
  function schedule() { setTimeout(function () { poll(); }, state.pollMs); }

  function stopEngine() {
    state.stopped = true;
    document.getElementById('engine-notice').className = 'notice warn';
    document.getElementById('engine-notice').innerHTML =
      '<strong>Snapshot mode — live alerting is off.</strong> Your browser could not reach the demo API directly ' +
      '(likely CORS or network policy). Nothing is simulated to fill the gap: the feeds below show only alerts already stored ' +
      'in this browser, and the model table shows the verified 2026-11-20 snapshot rows. To run live: open the site locally with ' +
      '<code>node scripts/local-proxy.mjs</code> (see README) and check <a href="flagged.html">F-04/F-08</a>.';
  }

  /* ---------- model ranking table ---------- */
  function renderModelTable() {
    var tb = document.querySelector('#model-table tbody');
    tb.innerHTML = '';
    var rows = state.tracked.map(function (m) {
      return { m: m, s: E.scoreMarket(m, { recentDelta: recentDeltaOf(m.ticker) }, cfg) };
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
        '<td class="num">' + K.usd4(r.m.yes_bid_dollars) + ' / ' + K.usd4(r.m.yes_ask_dollars) + '</td>' +
        '<td class="num">' + K.num(E.num(r.m.volume_24h_fp)) + '</td>' +
        '<td class="src">' + K.apiLink(r.m.source_url || pollQueryUrl()) + '</td>';
      tb.appendChild(tr);
    });
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="10" class="muted">No tracked markets yet (watch set builds from the five focus topics).</td></tr>';
    }
    if (state.snapshotNote) {
      document.getElementById('model-note').innerHTML =
        '<span class="badge warn">snapshot data</span> Scores computed from the verified 2026-11-20 snapshot rows; ' +
        'the momentum component warms up only while the page polls live.';
    }
  }

  /* ---------- detail: chart + markers + ladder + cause links ---------- */
  function selectAlert(ticker) {
    state.selected = ticker;
    state.seriesTicker = null;
    var row = (state.tracked.filter(function (m) { return m.ticker === ticker; })[0]) || null;
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
    document.getElementById('d-title').innerHTML =
      K.esc(title) + ' <code class="small">' + K.esc(state.selected) + '</code>' +
      (a ? ' <span class="badge ' + (a.dir === 'up' ? 'yes' : 'no') + '">jump ' +
        (a.dir === 'up' ? '▲ +' : '▼ −') + Math.round(Math.abs(a.delta) * 100) + '¢ at ' + hhmmss(a.tsMs) + '</span>' : '');
  }
  function latestAlertFor(ticker) {
    for (var i = state.alerts.length - 1; i >= 0; i--) {
      if (state.alerts[i].ticker === ticker) return state.alerts[i];
    }
    return null;
  }

  function loadCandles() {
    if (!state.seriesTicker) return;
    var now = Math.floor(Date.now() / 1000);
    [{ p: 1, start: now - 6 * 3600, key: 1 }, { p: 60, start: now - 8 * 86400, key: 60 }].forEach(function (r) {
      var q = '/series/' + encodeURIComponent(state.seriesTicker) + '/markets/' + encodeURIComponent(state.selected) +
        '/candlesticks?start_ts=' + r.start + '&end_ts=' + now + '&period_interval=' + r.p;
      K.get(q, { timeoutMs: 9000 }).then(function (res) {
        state.candles[r.key] = (res.data.candlesticks || []).map(function (c) {
          return { t: c.end_period_ts, v: K.fp(c.price && c.price.close_dollars) };
        }).filter(function (p) { return p.v !== null; });
        draw();
      }).catch(function () {});
    });
  }

  function draw() {
    if (!window.ChartLite) return;
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
    state.alerts.filter(function (a) { return a.ticker === state.selected && a.tsMs / 1000 >= tMin; })
      .forEach(function (a) {
        var x = g.x(Math.floor(a.tsMs / 1000));
        var pt = pts.reduce(function (best, p) {
          return (!best || Math.abs(p.t - a.tsMs / 1000) < Math.abs(best.t - a.tsMs / 1000)) ? p : best;
        }, null);
        ctx.strokeStyle = a.dir === 'up' ? 'rgba(21,128,61,0.65)' : 'rgba(185,28,28,0.65)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, g.padT); ctx.lineTo(x, g.padT + g.plotH); ctx.stroke();
        ctx.setLineDash([]);
        if (pt) {
          ctx.fillStyle = a.dir === 'up' ? '#15803d' : '#b91c1c';
          ctx.beginPath(); ctx.arc(x, g.y(pt.v), 4, 0, Math.PI * 2); ctx.fill();
        }
      });
  }

  function loadOrderbook() {
    var tk = state.selected;
    K.get('/markets/' + encodeURIComponent(tk) + '/orderbook?depth=10', { timeoutMs: 9000 }).then(function (r) {
      renderLadder(r.data.orderbook_fp || { yes_dollars: [], no_dollars: [] },
        K.state.base + '/markets/' + encodeURIComponent(tk) + '/orderbook?depth=10');
    }).catch(function () {
      document.getElementById('book-summary').innerHTML =
        'Orderbook unavailable right now (live API unreachable or empty book) — the full ladder lives on ' +
        '<a href="' + K.marketUrl(tk) + '">Market Detail</a>.';
      document.querySelector('#ladder tbody').innerHTML = '';
    });
  }

  function renderLadder(ob, sourceUrl) {
    var yes = (ob.yes_dollars || []).slice();   // [price, size] ascending; best bid LAST
    var no = (ob.no_dollars || []).slice();     // NO bids ascending ⇒ implied YES asks at 1 − price
    var rows = {};
    yes.forEach(function (p) {
      var price = E.round4(E.num(p[0])), size = E.num(p[1]);
      if (price === null) return;
      rows[price] = rows[price] || {}; rows[price].bid = size;
    });
    no.forEach(function (p) {
      var noPrice = E.num(p[0]), size = E.num(p[1]);
      if (noPrice === null) return;
      var yesAsk = E.round4(1 - noPrice);
      rows[yesAsk] = rows[yesAsk] || {}; rows[yesAsk].ask = size;
    });
    var prices = Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).slice(0, 8);
    var tb = document.querySelector('#ladder tbody');
    tb.innerHTML = prices.map(function (p) {
      var r = rows[p];
      return '<tr><td class="num"><strong>$' + p.toFixed(4) + '</strong></td>' +
        '<td class="num">' + (r.bid !== undefined ? K.num(r.bid) : '') + '</td>' +
        '<td class="num">' + (r.ask !== undefined ? K.num(r.ask) : '') + '</td></tr>';
    }).join('');
    if (!prices.length) tb.innerHTML = '<tr><td colspan="3" class="muted">Empty book right now (the API returns 200 with empty arrays — ' + K.apiLink(sourceUrl, 'source') + ').</td></tr>';
    var bestBid = yes.length ? E.num(yes[yes.length - 1][0]) : null;
    var bestBidSize = yes.length ? E.num(yes[yes.length - 1][1]) : 0;
    var bestAsk = no.length ? E.round4(1 - E.num(no[no.length - 1][0])) : null;
    var bestAskSize = no.length ? E.num(no[no.length - 1][1]) : 0;
    var totalBid = yes.reduce(function (a, p) { return a + (E.num(p[1]) || 0); }, 0);
    document.getElementById('book-summary').innerHTML =
      'Best YES bid <strong>' + (bestBid === null ? '—' : '$' + bestBid.toFixed(4)) + '</strong> (' + K.num(bestBidSize) +
      ' contracts) · best YES ask (implied from NO bids) <strong>' + (bestAsk === null ? '—' : '$' + bestAsk.toFixed(4)) +
      '</strong> (' + K.num(bestAskSize) + ' contracts) · YES bid depth shown <strong>' + K.num(totalBid) +
      '</strong> contracts · source ' + K.apiLink(sourceUrl) +
      ' · <a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">how the book works</a>';
  }

  function renderCause() {
    var host = document.getElementById('cause');
    var a = latestAlertFor(state.selected);
    var parts = [];
    var srcs = (state.selectedRow && state.selectedRow.series_ticker && state.seriesMap[state.selectedRow.series_ticker]) ||
               (a && a.series_ticker && state.seriesMap[a.series_ticker]) || [];
    if (srcs.length) {
      parts.push('<strong>Official settlement sources (from the API):</strong> ' +
        srcs.map(function (s) { return '<a href="' + K.esc(s.url) + '" target="_blank" rel="noopener">' + K.esc(s.name) + '</a>'; }).join(' · '));
    } else {
      parts.push('<span class="muted">Official settlement source: not captured for this series (left blank, never guessed — see flagged F-05).</span>');
    }
    if (a) {
      parts.push('<strong>Auto-generated research pointer (not an official source, no causal claim — F-10):</strong> ' +
        '<a href="' + K.esc(newsUrl(a.title)) + '" target="_blank" rel="noopener">Google News search for this market title</a>');
      parts.push('<strong>Market rules &amp; resolution state:</strong> <a href="' + K.marketUrl(a.ticker) + '">market detail (rules_primary / rules_secondary)</a>');
      parts.push('<strong>Row source:</strong> ' + K.apiLink(a.source_url, 'GET /markets?tickers=…'));
    } else {
      parts.push('<span class="muted">Select a jump from either chat to see its research links.</span>');
    }
    host.innerHTML = parts.map(function (p) { return '<p class="small">' + p + '</p>'; }).join('');
  }

  /* ---------- window buttons ---------- */
  (function buildWindowButtons() {
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
  })();

  /* ---------- controls ---------- */
  document.getElementById('at-toggle').addEventListener('click', function () {
    state.autoTrade = !state.autoTrade;
    Store.setJSON('autotrade', state.autoTrade);
    renderAtToggle(); renderStatus();
  });
  document.getElementById('clear-btn').addEventListener('click', function () {
    state.alerts = []; state.simfeed = []; state.history = {}; state.lastObs = {}; state.lastAlertMeta = {};
    saveAll(); renderFeeds(); renderStatus();
  });

  /* ---------- init ---------- */
  ['chat-all', 'chat-model'].forEach(function (id) { autoscroll(document.getElementById(id)); });
  renderAtToggle();
  renderFeeds();
  renderStatus();

  K.onModeChange(function (st) {
    if (st.mode === 'snapshot' && !state.stopped) stopEngine();
    renderStatus();
  });

  buildSeriesMap().then(function () { renderCause(); }); /* re-render cause links once official settlement sources are indexed */
  buildTrackSet(false).then(function () {
    renderModelTable();
    poll();
    if (state.tracked.length) selectAlert(state.tracked[0].ticker);
  }).catch(function () {
    renderModelTable();
  });

  setInterval(function () { if (!document.hidden) buildTrackSet(true).catch(function () {}); }, 5 * 60 * 1000); // watch-set refresh
  setInterval(function () { saveAll(); renderStatus(); }, 30000);

  /* test hook (documented): lets tools/alerts-render-test.mjs drive the engine */
  window.AlertsPage = {
    state: state, poll: poll, processRows: processRows, buildTrackSet: buildTrackSet,
    evaluateExits: evaluateExits, cfg: cfg, latestAlertFor: latestAlertFor
  };
})();
