/* alerts-page.js — renders the two chat feeds, the price chart, the ranking table,
 * the resolution log and the liquidity ladder. Data comes from alerts-live.js. */
(function () {
  'use strict';

  var A = window.AL;
  var ui = {
    topicFilter: 'all',
    chartWindow: 3600,          // seconds
    chartTicker: '',
    boardTopic: 'all',
    seenIds: {},                // ids already rendered, so "new" highlighting is honest
    autoScroll: true
  };

  /* ---------------- header ---------------- */

  function clock() {
    var el = document.getElementById('clock');
    function t() { el.textContent = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC'); }
    t(); setInterval(t, 1000);
  }

  function setMode() {
    var b = document.getElementById('mode-badge');
    var n = document.getElementById('mode-notice');
    if (A.state.mode === 'live') {
      b.className = 'badge live';
      b.textContent = 'live: browser + engine';
      n.className = 'notice ok';
      n.innerHTML = 'Browser polling of the official demo API is working, so new swings appear within seconds. ' +
        'The engine feed is merged in underneath, which is what keeps the history when this page is closed.';
    } else if (A.state.mode === 'feed') {
      b.className = 'badge warn';
      b.textContent = 'engine feed only';
      n.className = 'notice';
      n.innerHTML = '<strong>Showing the engine feed.</strong> This browser could not poll the demo API directly ' +
        '(' + A.esc(A.state.live.note || 'request blocked') + '), which is usually a cross-origin (CORS) restriction rather than an outage. ' +
        'The engine still samples the API on its schedule, so the feed stays current — just not second-by-second. ' +
        'This limitation is listed on the <a href="../flagged.html">Flagged for review</a> page.';
    } else {
      b.className = 'badge warn';
      b.textContent = 'no live data';
      n.className = 'notice bad';
      n.innerHTML = '<strong>No data available.</strong> Neither the engine feed nor the demo API could be read from this page. ' +
        'Nothing is substituted: the tables stay empty rather than showing invented prices.' +
        (A.state.feedError ? ' <span class="mono small">feed: ' + A.esc(A.state.feedError) + '</span>' : '');
    }
    var fm = document.getElementById('feed-meta');
    if (fm) {
      fm.textContent = A.state.feed && A.state.feed.run && A.state.feed.run.sampled_at
        ? 'Last engine sample: ' + A.state.feed.run.sampled_at + ' · ' + (A.state.feed.alerts || []).length + ' alerts retained · ' +
          (A.state.feed.resolutions || []).length + ' resolutions.'
        : 'No engine sample found yet.';
    }
    var lm = document.getElementById('live-meta');
    if (lm) {
      lm.textContent = A.state.live.ok && A.state.live.lastPoll
        ? 'Last browser poll: ' + A.state.live.lastPoll.toISOString() + ' · ' + Object.keys(A.state.live.markets).length + ' markets sampled.'
        : 'Browser polling is not active.';
    }
  }

  /* ---------------- chat feeds ---------------- */

  function timeAgo(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '—';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function msgHtml(a) {
    var up = a.direction === 'up';
    var dir = up ? '▲ up' : '▼ down';
    var isCandle = a.detection === 'candle';
    var model = a.model || {};
    var reasons = (model.reasons || []).map(A.esc).join(' · ');
    var sources = [];
    if (a.source_url) sources.push('<a href="' + A.esc(a.source_url) + '" target="_blank" rel="noopener">API row</a>');
    if (a.contract_terms_url) sources.push('<a href="' + A.esc(a.contract_terms_url) + '" target="_blank" rel="noopener">contract terms</a>');
    var settle = (a.settlement_sources || []).slice(0, 2).map(function (s) {
      return s && s.url ? '<a href="' + A.esc(s.url) + '" target="_blank" rel="noopener">' + A.esc(s.name || 'settlement source') + '</a>' : '';
    }).filter(Boolean).join(' · ');

    return '<div class="msg ' + (up ? 'up' : 'down') + (ui.seenIds[a.id] ? '' : ' new') + '" data-id="' + A.esc(a.id) + '">' +
      '<div class="top">' +
        '<span class="who">' + A.esc(A.topicLabel(a.topic)) + '</span>' +
        '<span class="badge ' + (up ? 'up' : 'down') + '">' + dir + ' ' + A.usd(a.abs_delta, 2) + '</span>' +
        (isCandle ? '<span class="badge neutral" title="Detected from 1-minute candlesticks, not from two samples">candle</span>' : '') +
        (model.highROI ? '<span class="badge accent">model ' + Number(model.score).toFixed(2) + '</span>' : '') +
        '<span class="when" title="' + A.esc(a.ts || '') + '">' + timeAgo(a.ts) + '</span>' +
      '</div>' +
      '<div class="what"><a href="../dashboard.html?ticker=' + encodeURIComponent(a.ticker) + '">' +
        A.esc(a.title || a.ticker) + '</a> <code class="small muted">' + A.esc(a.ticker) + '</code></div>' +
      '<div class="figs">' +
        '<span>' + A.usd(a.from, 2) + ' → <b>' + A.usd(a.to, 2) + '</b></span>' +
        '<span>bid <b>' + A.usd(a.yes_bid_dollars, 2) + '</b></span>' +
        '<span>ask <b>' + A.usd(a.yes_ask_dollars, 2) + '</b></span>' +
        '<span>24h vol <b>' + (a.volume_24h_fp === null || a.volume_24h_fp === undefined ? '—' : A.esc(a.volume_24h_fp)) + '</b></span>' +
        (a.est_traded_dollars !== null && a.est_traded_dollars !== undefined ? '<span>est. $<b>' + A.esc(a.est_traded_dollars.toLocaleString()) + '</b></span>' : '') +
      '</div>' +
      '<div class="why">' +
        '<details><summary>model terms' + (model.score !== null && model.score !== undefined ? ' (' + Number(model.score).toFixed(2) + (model.highROI ? ', high ROI' : '') + ')' : ' (no score)') + '</summary>' +
          '<div>' + (reasons || 'no terms') + '</div>' +
          '<div class="muted">Baseline: ' + A.esc(a.baseline_kind || '—') + '</div>' +
          (a.rules_primary ? '<div class="muted">Rules: ' + A.esc(String(a.rules_primary).slice(0, 320)) + '</div>' : '') +
          (settle ? '<div class="muted">Settlement sources: ' + settle + '</div>' : '') +
        '</details>' +
        '<div class="small">' + sources.join(' · ') + '</div>' +
      '</div>' +
    '</div>';
  }

  function resolutionMsgHtml(r) {
    var yes = r.result === 'yes';
    return '<div class="msg resolved" data-id="res:' + A.esc(r.ticker) + '">' +
      '<div class="top"><span class="who">resolved</span>' +
        '<span class="badge ' + (yes ? 'yes' : 'no') + '">result: ' + A.esc(r.result) + '</span>' +
        '<span class="when" title="' + A.esc(r.settlement_ts || '') + '">' + (r.settlement_ts ? timeAgo(r.settlement_ts) : 'time not published') + '</span></div>' +
      '<div class="what">' + A.esc(r.title || r.ticker) + ' <code class="small muted">' + A.esc(r.ticker) + '</code></div>' +
      '<div class="figs"><span>settlement value <b>' + A.usd(A.num(r.settlement_value_dollars), 2) + '</b></span>' +
        '<span>payout <b>$1.00 to ' + (yes ? 'YES' : 'NO') + '</b></span></div>' +
      '<div class="small"><a href="' + A.esc(r.source_url || A.BASE) + '" target="_blank" rel="noopener">API row</a></div>' +
    '</div>';
  }

  var lastRendered = { all: '', roi: '' };

  function renderChats(force) {
    var all = A.allAlerts();
    var roi = A.highRoiAlerts();
    if (ui.topicFilter !== 'all') {
      all = all.filter(function (a) { return a.topic === ui.topicFilter; });
      roi = roi.filter(function (a) { return a.topic === ui.topicFilter; });
    }

    document.getElementById('count-all').textContent = all.length + ' alerts';
    document.getElementById('count-roi').textContent = roi.length + ' alerts';

    var allHtml = all.length
      ? all.slice(0, 120).map(msgHtml).join('')
      : '<div class="empty">No swing of $0.10 or more has been recorded yet for this selection.<br>' +
        (A.state.mode === 'offline' ? 'No data source is reachable from this page.' : 'The engine records one only when a real API price moves that far — nothing is seeded or simulated here.') + '</div>';

    var roiHtml = roi.length
      ? roi.slice(0, 120).map(msgHtml).join('')
      : '<div class="empty">No alert currently clears the model threshold of ' + A.HIGH_ROI_THRESHOLD + '.<br>' +
        'This feed stays empty rather than padding itself with low-scoring rows.</div>';

    var logAll = document.getElementById('log-all');
    var logRoi = document.getElementById('log-roi');
    if (force || allHtml !== lastRendered.all) {
      logAll.innerHTML = allHtml;
      lastRendered.all = allHtml;
      if (ui.autoScroll) logAll.scrollTop = 0;
    }
    if (force || roiHtml !== lastRendered.roi) {
      logRoi.innerHTML = roiHtml;
      lastRendered.roi = roiHtml;
      if (ui.autoScroll) logRoi.scrollTop = 0;
    }
    all.concat(roi).forEach(function (a) { ui.seenIds[a.id] = true; });
  }

  /* ---------------- stats ---------------- */

  function renderStats() {
    var all = A.allAlerts();
    var roi = A.highRoiAlerts();
    var markets = A.markets();
    var res = A.resolutions();
    var biggest = all.slice().sort(function (a, b) { return b.abs_delta - a.abs_delta; })[0];
    var feedTime = A.state.feed && A.state.feed.run && A.state.feed.run.sampled_at;

    var cards = [
      ['Alerts (all)', String(all.length), all.length ? 'since the engine started recording' : 'waiting for the first $0.10 move'],
      ['High ROI', String(roi.length), 'model score ≥ ' + A.HIGH_ROI_THRESHOLD],
      ['Largest move', biggest ? A.usd(biggest.abs_delta, 2) : '—', biggest ? A.esc(biggest.ticker) : 'no alerts yet'],
      ['Contracts tracked', String(markets.length), 'open + resolved'],
      ['Resolved', String(res.length), res.filter(function (r) { return r.result === 'yes'; }).length + ' yes · ' + res.filter(function (r) { return r.result === 'no'; }).length + ' no'],
      ['Last engine sample', feedTime ? timeAgo(feedTime) : '—', feedTime ? feedTime.replace('T', ' ').slice(0, 19) + 'Z' : 'engine has not run yet']
    ];
    document.getElementById('stats').innerHTML = cards.map(function (c) {
      return '<div class="stat"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="h">' + c[2] + '</div></div>';
    }).join('');
  }

  /* ---------------- markets table ---------------- */

  /* Per-topic board. Rows come from the engine's by_topic block when it exists (the engine is
   * the only source that samples every topic), with browser-polled rows merged on top. */
  function topicRows(topicId) {
    var feed = (A.state.feed && A.state.feed.by_topic) || {};
    var rows = ((feed[topicId] || {}).rows || []).slice();
    var seen = {};
    rows.forEach(function (m) { seen[m.ticker] = true; });
    Object.keys(A.state.live.markets).forEach(function (k) {
      var m = A.state.live.markets[k];
      if (m.topic !== topicId || seen[k]) return;
      rows.push(m);
    });
    var liveOnly = {};
    A.markets().forEach(function (m) { if (m.topic === topicId) liveOnly[m.ticker] = m; });
    rows = rows.map(function (m) { return liveOnly[m.ticker] || m; });
    rows.sort(function (a, b) { return (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0); });
    return rows;
  }

  function renderTopicTabs() {
    var wrap = document.getElementById('topic-tabs');
    var ids = ['all'].concat(A.TOPICS.map(function (t) { return t.id; }));
    wrap.innerHTML = '';
    ids.forEach(function (id) {
      var b = document.createElement('button');
      b.className = 'btn small' + (id === ui.boardTopic ? ' primary' : '');
      b.textContent = id === 'all' ? 'All topics' : A.topicLabel(id);
      b.addEventListener('click', function () {
        ui.boardTopic = id;
        renderTopicTabs();
        renderMarkets('markets-table');
      });
      wrap.appendChild(b);
    });
  }

  function renderMarkets(id) {
    var tb = document.querySelector('#' + id + ' tbody');
    var rows;
    var noteEl = document.getElementById('topic-note');
    if (ui.boardTopic === 'all') {
      rows = A.markets().filter(function (m) { return m.status === 'active' || m.status === 'initialized' || !m.status; });
      rows.sort(function (a, b) { return (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0); });
      rows = rows.slice(0, 40);
      if (noteEl) noteEl.textContent = 'Showing the combined board. Pick a topic above to see it on its own.';
    } else {
      rows = topicRows(ui.boardTopic).slice(0, 30);
      if (noteEl) {
        var seriesCount = ((A.state.feed && A.state.feed.meta && A.state.feed.meta.topic_rules) || [])
          .filter(function (t) { return t.id === ui.boardTopic; }).length ? A.topicSeriesCount(ui.boardTopic) : null;
        noteEl.textContent = A.topicLabel(ui.boardTopic) +
          (seriesCount !== null ? ' — ' + seriesCount + ' series matched in the last engine run.' : '') +
          (rows.length === 0 ? ' No open contract with a readable price was found for this topic. That is reported as-is rather than padded with examples.' : '');
      }
    }
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="10" class="empty">No live market with a readable price for this selection. Nothing is filled in on its behalf.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (m) {
      return '<tr>' +
        '<td><a href="../dashboard.html?ticker=' + encodeURIComponent(m.ticker) + '">' + A.esc(m.title || m.ticker) + '</a>' +
          '<br><code class="small muted">' + A.esc(m.ticker) + '</code></td>' +
        '<td class="num">' + A.usd(m.price, 2) + '</td>' +
        '<td class="num">' + A.usd(A.num(m.yes_bid_dollars), 2) + ' (' + (m.yes_bid_size_fp === undefined || m.yes_bid_size_fp === null ? '—' : A.esc(m.yes_bid_size_fp)) + ')</td>' +
        '<td class="num">' + A.usd(A.num(m.yes_ask_dollars), 2) + ' (' + (m.yes_ask_size_fp === undefined || m.yes_ask_size_fp === null ? '—' : A.esc(m.yes_ask_size_fp)) + ')</td>' +
        '<td class="num">' + (m.volume_24h_fp === undefined || m.volume_24h_fp === null ? '—' : A.esc(m.volume_24h_fp)) + '</td>' +
        '<td class="num">' + (m.volume_fp === undefined || m.volume_fp === null ? '—' : A.esc(m.volume_fp)) + '</td>' +
        '<td class="num">' + (m.est_traded_dollars === null || m.est_traded_dollars === undefined ? '—' : '$' + m.est_traded_dollars.toLocaleString()) + '</td>' +
        '<td class="small nowrap">' + A.esc((m.close_time || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z') || '—') + '</td>' +
        '<td>' + (m.result ? '<span class="badge ' + (m.result === 'yes' ? 'yes' : 'no') + '">' + A.esc(m.result) + '</span>' : '<span class="badge live">' + A.esc(m.status || '—') + '</span>') + '</td>' +
        '<td class="src">' + (m.source_url ? '<a href="' + A.esc(m.source_url) + '" target="_blank" rel="noopener">API</a>' : '—') + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- resolution table ---------------- */

  function renderResolutions() {
    var tb = document.querySelector('#res-table tbody');
    var rows = A.resolutions();
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">No resolutions recorded yet. The engine records one only after the API publishes a result of yes or no.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (r) {
      return '<tr>' +
        '<td>' + A.esc(r.title || r.ticker) + '<br><code class="small muted">' + A.esc(r.ticker) + '</code></td>' +
        '<td>' + A.esc(A.topicLabel(r.topic)) + '</td>' +
        '<td><span class="badge ' + (r.result === 'yes' ? 'yes' : 'no') + '">' + A.esc(r.result) + '</span></td>' +
        '<td class="num">' + A.usd(A.num(r.settlement_value_dollars), 2) + '</td>' +
        '<td class="small nowrap">' + A.esc((r.settlement_ts || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z') || '—') + '</td>' +
        '<td class="num">' + (r.volume_fp === null || r.volume_fp === undefined ? '—' : A.esc(r.volume_fp)) + '</td>' +
        '<td class="src"><a href="' + A.esc(r.source_url || A.BASE) + '" target="_blank" rel="noopener">API</a></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- liquidity ladder ---------------- */

  function renderLadders() {
    var obs = A.orderbooks();
    var el = document.getElementById('ladder');
    var keys = Object.keys(obs);
    if (!keys.length) {
      el.innerHTML = '<div class="panel small muted">No orderbook has been captured yet. The engine reads ' +
        '<code>GET /markets/{ticker}/orderbook</code> for the highest-dollar contracts on each run.</div>';
      return;
    }
    el.innerHTML = '<div class="chats">' + keys.slice(0, 4).map(function (k) {
      var ob = obs[k];
      var yes = (ob.yes_bids || []).slice(-8).reverse();
      var no = (ob.no_bids || []).slice(-8).reverse();
      function rows(levels, cls) {
        if (!levels.length) return '<tr><td colspan="2" class="empty">no resting bids</td></tr>';
        return levels.map(function (l) {
          return '<tr><td class="num">' + A.usd(l.price, 2) + '</td><td class="num">' + l.count.toLocaleString() + '</td></tr>';
        }).join('');
      }
      return '<div class="panel">' +
        '<div class="small"><strong>' + A.esc(k) + '</strong></div>' +
        '<div class="small muted" style="margin-bottom:6px">best yes bid ' + A.usd(ob.best_yes_bid, 2) +
          ' · implied yes ask ' + A.usd(ob.implied_yes_ask, 2) + ' · implied no ask ' + A.usd(ob.implied_no_ask, 2) + '</div>' +
        '<div class="chats" style="gap:8px">' +
          '<div><div class="small muted">YES bids — price / contracts</div><table><tbody>' + rows(yes) + '</tbody></table></div>' +
          '<div><div class="small muted">NO bids — price / contracts</div><table><tbody>' + rows(no) + '</tbody></table></div>' +
        '</div>' +
        '<div class="small muted" style="margin-top:6px">' +
          (ob.cumulative_contracts ? 'resting contracts: yes ' + ob.cumulative_contracts.yes.toLocaleString() + ' · no ' + ob.cumulative_contracts.no.toLocaleString() + ' · ' : '') +
          (ob.source_url ? '<a href="' + A.esc(ob.source_url) + '" target="_blank" rel="noopener">API</a>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- chart ---------------- */

  function chartWindows() {
    var defs = [
      { s: 300, l: '5 min' }, { s: 3600, l: '1 hour' }, { s: 21600, l: '6 hours' },
      { s: 86400, l: '24 hours' }, { s: 604800, l: '7 days' }
    ];
    var wrap = document.getElementById('chart-window-btns');
    wrap.innerHTML = '';
    defs.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'btn small' + (d.s === ui.chartWindow ? ' primary' : '');
      b.textContent = d.l;
      b.addEventListener('click', function () {
        ui.chartWindow = d.s;
        chartWindows();
        drawChart();
      });
      wrap.appendChild(b);
    });
  }

  function chartCandidates() {
    // Highest estimated dollars first; the picker shows the same list.
    return A.markets().slice().sort(function (a, b) {
      return (b.est_traded_dollars || 0) - (a.est_traded_dollars || 0);
    });
  }

  function fillChartPicker() {
    var sel = document.getElementById('chart-ticker');
    var cands = chartCandidates().slice(0, 25);
    if (!cands.length) return;
    if (!ui.chartTicker || !cands.some(function (m) { return m.ticker === ui.chartTicker; })) {
      ui.chartTicker = cands[0].ticker;
    }
    sel.innerHTML = cands.map(function (m) {
      return '<option value="' + A.esc(m.ticker) + '"' + (m.ticker === ui.chartTicker ? ' selected' : '') + '>' +
        A.esc((m.title || m.ticker).slice(0, 80)) + '</option>';
    }).join('');
  }

  function drawChart() {
    var canvas = document.getElementById('chart');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 800;
    var h = 260;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = null;
    try { ctx = canvas.getContext ? canvas.getContext('2d') : null; } catch (e) { ctx = null; }
    if (!ctx) {
      // No canvas support: the tables and feeds still work, so say why the chart is blank
      // instead of throwing and taking the rest of the page down with it.
      document.getElementById('chart-note').textContent = 'this browser did not provide a 2D canvas — chart unavailable';
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var pad = { l: 46, r: 12, t: 12, b: 26 };
    // History is a compact array of [timestamp, price] pairs (see tools/live_engine.mjs);
    // the object form {t,p} is still accepted so an older cached feed keeps rendering.
    var raw = A.history(ui.chartTicker) || [];
    var now = Math.floor(Date.now() / 1000);
    var from = now - ui.chartWindow;
    var pts = raw.map(function (smp) {
      if (Array.isArray(smp)) return { t: smp[0], p: smp[1] };
      return { t: smp.t, p: smp.p };
    }).filter(function (p) { return p && p.t >= from && typeof p.p === 'number'; });

    // axes
    ctx.strokeStyle = '#e3e8ee';
    ctx.fillStyle = '#5b6b7b';
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = pad.t + (h - pad.t - pad.b) * (i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      var price = 1 - i / 4;
      ctx.fillText('$' + price.toFixed(2), 6, y + 4);
    }
    // x labels
    var labels = 4;
    for (var j = 0; j <= labels; j++) {
      var x = pad.l + (w - pad.l - pad.r) * (j / labels);
      var ts = from + (ui.chartWindow * j / labels);
      var d = new Date(ts * 1000);
      var lab = ui.chartWindow <= 3600
        ? d.toISOString().slice(11, 19)
        : d.toISOString().slice(5, 16).replace('T', ' ');
      ctx.fillText(lab, Math.min(x, w - 52), h - 8);
    }

    if (pts.length < 2) {
      ctx.fillStyle = '#5b6b7b';
      ctx.fillText('Not enough samples in this window yet — the engine adds one per run.', pad.l + 10, pad.t + 24);
      document.getElementById('chart-note').textContent = ui.chartTicker
        ? 'showing ' + ui.chartTicker + ' · ' + pts.length + ' sample(s) in window'
        : '';
      return;
    }

    function xOf(t) { return pad.l + (w - pad.l - pad.r) * ((t - from) / ui.chartWindow); }
    function yOf(p) { return pad.t + (h - pad.t - pad.b) * (1 - p); }

    // line
    ctx.strokeStyle = '#14568f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(function (p, idx) {
      var x = xOf(p.t), y = yOf(p.p);
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // alert markers for this ticker (only real, recorded swings)
    A.allAlerts().filter(function (a) { return a.ticker === ui.chartTicker; }).forEach(function (a) {
      var t = Date.parse(a.ts) / 1000;
      if (t < from || t > now) return;
      var x = xOf(t), y = yOf(a.to);
      ctx.fillStyle = a.direction === 'up' ? '#1a7f4e' : '#b3372e';
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    });

    document.getElementById('chart-note').textContent =
      ui.chartTicker + ' · ' + pts.length + ' sample(s) · window ' + Math.round(ui.chartWindow / 60) + ' min';
  }

  /* ---------------- controls ---------------- */

  function wireControls() {
    document.getElementById('roi-threshold-label').textContent = A.HIGH_ROI_THRESHOLD;
    document.getElementById('roi-threshold-label-2').textContent = A.HIGH_ROI_THRESHOLD;

    document.getElementById('autoscroll').addEventListener('change', function (e) {
      ui.autoScroll = e.target.checked;
    });

    var btn = document.getElementById('btn-filter-topic');
    btn.addEventListener('click', function () {
      var ids = ['all'].concat(A.TOPICS.map(function (t) { return t.id; }));
      var idx = ids.indexOf(ui.topicFilter);
      ui.topicFilter = ids[(idx + 1) % ids.length];
      btn.textContent = 'Topics: ' + (ui.topicFilter === 'all' ? 'all' : A.topicLabel(ui.topicFilter));
      renderChats(true);
    });

    document.getElementById('chart-ticker').addEventListener('change', function (e) {
      ui.chartTicker = e.target.value;
      drawChart();
    });

    window.addEventListener('resize', function () { drawChart(); });
    setInterval(function () {
      renderChats(false);
      renderStats();
    }, 10000);
  }

  /* ---------------- bootstrap ---------------- */

  function renderAll() {
    renderTopicTabs();
    fillChartPicker();
    renderChats(true);
    renderStats();
    renderMarkets('markets-table');
    renderResolutions();
    renderLadders();
    drawChart();
    setMode();
  }

  function boot() {
    clock();
    chartWindows();
    wireControls();
    renderAll();

    A.loadFeed().then(function () {
      renderAll();
      // Try a browser poll; if it fails the feed already covers the page.
      return A.pollLive({ maxSeries: 8 }).then(function () {
        renderAll();
      }, function () {
        setMode();
      });
    });

    // Keep polling while the page is open (30 s: polite to unauthenticated limits).
    setInterval(function () {
      A.pollLive({ maxSeries: 8 }).then(renderAll, setMode);
    }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
