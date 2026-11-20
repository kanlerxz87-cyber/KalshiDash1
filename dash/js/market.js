/* market.js — single market page: chart (time windows), orderbook ladder, paper trade. */
(function () {
  'use strict';
  App.renderHeader('market.html');
  App.renderFooter();
  var K = window.K;

  var params = new URLSearchParams(location.search);
  var ticker = params.get('ticker') || '';
  var windowId = params.get('w') || '1h';
  var current = null;          // market row (live or snapshot)
  var seriesTicker = null;
  var sessionPoints = [];      // {t, v} accumulated in-browser (seconds granularity)
  var candles = { 1: [], 60: [], 1440: [] };

  /* ---- window buttons ---- */
  var wb = document.getElementById('window-btns');
  K.cfg.chartWindows.forEach(function (w) {
    var b = document.createElement('button');
    b.className = 'btn small' + (w.id === windowId ? ' primary' : '');
    b.textContent = w.label;
    b.addEventListener('click', function () {
      windowId = w.id;
      [].forEach.call(wb.children, function (c) { c.classList.remove('primary'); });
      b.classList.add('primary');
      draw();
    });
    wb.appendChild(b);
  });

  /* ---- ticker picker (from snapshot + any live rows already cached) ---- */
  function fillPicker() {
    var sel = document.getElementById('ticker-pick');
    Data.snapshot().then(function (snap) {
      var opts = ['<option value="">jump to…</option>'];
      K.cfg.topics.forEach(function (t) {
        (snap.topics[t.id].live_markets || []).forEach(function (m) {
          opts.push('<option value="' + K.esc(m.ticker) + '">' + t.label + ' — ' + K.esc((m.title || m.ticker).slice(0, 60)) + '</option>');
        });
      });
      sel.innerHTML = opts.join('');
      sel.addEventListener('change', function () {
        if (sel.value) location.search = '?ticker=' + encodeURIComponent(sel.value);
      });
    });
  }
  fillPicker();

  document.getElementById('ticker-go').addEventListener('click', go);
  document.getElementById('ticker-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  function go() {
    var v = document.getElementById('ticker-input').value.trim();
    if (v) location.search = '?ticker=' + encodeURIComponent(v);
  }

  /* ---- market discovery: snapshot rows first, then live GET /markets/{ticker} ---- */
  function findInSnapshot(tk) {
    return Data.snapshot().then(function (snap) {
      var found = null;
      Object.keys(snap.topics).forEach(function (tid) {
        (snap.topics[tid].live_markets || []).forEach(function (m) {
          if (m.ticker === tk) found = Object.assign({}, m, { topic: tid, fromSnapshot: true });
        });
        (snap.topics[tid].settled_events || []).forEach(function (ev) {
          (ev.markets || []).forEach(function (m) {
            if (m.ticker === tk) found = Object.assign({}, m, {
              topic: tid, event_ticker: ev.event_ticker, fromSnapshot: true,
              close_time: ev.settlement_ts, source_url: ev.source_url
            });
          });
        });
      });
      return found;
    });
  }

  function loadMarket() {
    if (!ticker) {
      // default to the top snapshot market so the page is never empty
      Data.snapshot().then(function (snap) {
        var m = snap.topics.crypto.live_markets[0];
        if (m) location.replace('market.html?ticker=' + encodeURIComponent(m.ticker));
      });
      return;
    }
    document.getElementById('ticker-input').value = ticker;

    findInSnapshot(ticker).then(function (snapRow) {
      if (snapRow) setCurrent(snapRow);
      return K.get('/markets/' + encodeURIComponent(ticker), { timeoutMs: 8000 }).then(function (r) {
        var m = r.data.market;
        if (m) setCurrent(K.classifyMarket(m)
          ? Object.assign({}, normalize(m), { topic: K.classifyMarket(m), source_url: K.state.base + '/markets/' + encodeURIComponent(ticker) })
          : Object.assign({}, normalize(m), { topic: (snapRow && snapRow.topic) || 'other', source_url: K.state.base + '/markets/' + encodeURIComponent(ticker) }));
      }).catch(function () { /* keep snapshot row */ });
    });
  }

  function normalize(m) {
    return {
      ticker: m.ticker, event_ticker: m.event_ticker, series_ticker: m.series_ticker || null,
      title: m.title || m.yes_sub_title || m.ticker,
      status: m.status, result: m.result || '',
      last_price_dollars: m.last_price_dollars, previous_price_dollars: m.previous_price_dollars,
      yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
      no_bid_dollars: m.no_bid_dollars, no_ask_dollars: m.no_ask_dollars,
      yes_bid_size_fp: m.yes_bid_size_fp, yes_ask_size_fp: m.yes_ask_size_fp,
      volume_fp: m.volume_fp, volume_24h_fp: m.volume_24h_fp, open_interest_fp: m.open_interest_fp,
      notional_value_dollars: m.notional_value_dollars,
      close_time: m.close_time, expected_expiration_time: m.expected_expiration_time,
      latest_expiration_time: m.latest_expiration_time,
      rules_primary: m.rules_primary || '', rules_secondary: m.rules_secondary || '',
      settlement_ts: m.settlement_ts || null, settlement_value_dollars: m.settlement_value_dollars || null
    };
  }

  function setCurrent(m) {
    current = m;
    seriesTicker = m.series_ticker || seriesTicker || guessSeries(m.ticker);
    renderHeaderStats();
    samplePrice();
    draw();
    loadCandles();
    loadOrderbook();
  }

  function guessSeries(tk) {
    // series ticker is the market ticker up to the first date-ish segment; used only for the candlesticks path
    var m = /^([A-Z0-9-]+?)-(?:\d|[A-Z]{3}\d)/.exec(tk);
    return m ? m[1] : null;
  }

  function renderHeaderStats() {
    var m = current;
    document.getElementById('m-title').innerHTML = K.esc(m.title || m.ticker) + ' ' + App.statusBadge(m.status, m.result);
    document.getElementById('m-sub').innerHTML =
      '<code>' + K.esc(m.ticker) + '</code> · event <code>' + K.esc(m.event_ticker || '—') + '</code> · ' +
      App.topicLabel(m.topic) + ' · source ' + K.apiLink(m.source_url || K.state.base, m.fromSnapshot ? 'snapshot row' : 'live row') +
      (m.result ? ' · <strong>resolved ' + K.esc(m.result.toUpperCase()) + '</strong>' : '');
    document.getElementById('chart-title').textContent = m.ticker;
    var f = K.fp;
    document.getElementById('m-stats').innerHTML =
      stat('Last price', K.usd4(m.last_price_dollars), 'previous close ' + K.usd4(m.previous_price_dollars)) +
      stat('Best YES bid / ask', K.usd4(m.yes_bid_dollars) + ' / ' + K.usd4(m.yes_ask_dollars), 'sizes ' + K.num(f(m.yes_bid_size_fp)) + ' / ' + K.num(f(m.yes_ask_size_fp))) +
      stat('24h volume', K.usd(f(m.volume_24h_fp)), f(m.volume_24h_fp) === null ? 'not captured' : 'contracts × $1 notional') +
      stat('Total volume', K.usd(f(m.volume_fp)), f(m.volume_fp) === null ? 'not captured' : 'since listing') +
      stat('Open interest', K.usd(f(m.open_interest_fp)), 'contracts bought, pre-netting') +
      stat('Closes', K.fmtTs(m.close_time) || '—', 'expected expiry ' + K.fmtTs(m.expected_expiration_time)) +
      stat('Spread', spreadStr(m), 'ask − bid') +
      stat('Notional / contract', K.usd4(m.notional_value_dollars) || '$1.0000', 'payout to winning side');
  }
  function stat(label, value, note) {
    return '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="note">' + note + '</div></div>';
  }
  function spreadStr(m) {
    var b = K.fp(m.yes_bid_dollars), a = K.fp(m.yes_ask_dollars);
    return (b === null || a === null) ? '—' : K.usd4((a - b).toFixed(4));
  }

  /* ---- price sampling (seconds granularity within session) ---- */
  function samplePrice() {
    if (!current) return;
    var v = K.fp(current.last_price_dollars);
    if (v !== null) {
      var t = Math.floor(Date.now() / 1000);
      var last = sessionPoints[sessionPoints.length - 1];
      if (!last || last.t !== t || last.v !== v) sessionPoints.push({ t: t, v: v });
      if (sessionPoints.length > 3000) sessionPoints.shift();
    }
  }

  /* ---- candlesticks ---- */
  function loadCandles() {
    if (!seriesTicker) {
      document.getElementById('chart-note').innerHTML += ' <span class="badge warn">series ticker unknown — history backfill unavailable for this row</span>';
      return;
    }
    var now = Math.floor(Date.now() / 1000);
    var ranges = [
      { p: 1, start: now - 6 * 3600, key: 1 },
      { p: 60, start: now - 8 * 86400, key: 60 }
    ];
    ranges.forEach(function (r) {
      var q = '/series/' + encodeURIComponent(seriesTicker) + '/markets/' + encodeURIComponent(ticker) +
        '/candlesticks?start_ts=' + r.start + '&end_ts=' + now + '&period_interval=' + r.p;
      K.get(q, { timeoutMs: 9000 }).then(function (res) {
        candles[r.key] = (res.data.candlesticks || []).map(function (c) {
          return { t: c.end_period_ts, v: K.fp(c.price && (c.price.close_dollars)) };
        }).filter(function (p) { return p.v !== null; });
        draw();
      }).catch(function () {});
    });
  }

  function draw() {
    if (!window.ChartLite) return;
    var w = K.cfg.chartWindows.filter(function (x) { return x.id === windowId; })[0];
    var pts = [];
    var win = w.seconds;
    // merge sources in priority order; dedupe by timestamp (keep last)
    var byT = {};
    function add(arr) { arr.forEach(function (p) { if (p.t >= Math.floor(Date.now() / 1000) - win - 2) byT[p.t] = p.v; }); }
    if (win <= 300) add(sessionPoints);
    else {
      add(candles[1]);
      if (win >= 21600) add(candles[60]);
      add(sessionPoints);
    }
    Object.keys(byT).forEach(function (t) { pts.push({ t: +t, v: byT[t] }); });
    pts.sort(function (a, b) { return a.t - b.t; });
    ChartLite.drawChart(document.getElementById('price-chart'), pts, {
      windowSeconds: win,
      zoom: win <= 300
    });
  }
  window.addEventListener('resize', draw);
  ChartLite.attachTooltip(document.getElementById('price-chart'), document.getElementById('chart-tip'));

  /* ---- orderbook ladder ---- */
  function loadOrderbook() {
    if (!current) return;
    K.get('/markets/' + encodeURIComponent(ticker) + '/orderbook?depth=20', { timeoutMs: 8000 }).then(function (r) {
      renderLadder(r.data.orderbook_fp || { yes_dollars: [], no_dollars: [] }, K.state.base + '/markets/' + encodeURIComponent(ticker) + '/orderbook?depth=20');
    }).catch(function () {
      // snapshot sample ladder if the live call fails and ticker matches
      Data.snapshot().then(function (snap) {
        var ob = snap.orderbook_sample;
        if (ob && ob.ticker === ticker) renderLadder(ob.orderbook_fp, ob.source_url);
        else document.querySelector('#ladder tbody').innerHTML =
          '<tr><td colspan="3" class="muted">Orderbook unavailable (live API unreachable and no snapshot ladder for this ticker).</td></tr>';
      });
    });
  }

  function renderLadder(ob, sourceUrl) {
    var tb = document.querySelector('#ladder tbody');
    var yes = (ob.yes_dollars || []).slice();   // [price, size] ascending; best bid LAST
    var no = (ob.no_dollars || []).slice();     // NO bids ascending; implies YES asks at 1-price
    if (!yes.length && !no.length) {
      tb.innerHTML = '<tr><td colspan="3" class="muted">Empty book for this market at the moment (the API returns 200 with empty arrays — ' +
        K.apiLink(sourceUrl, 'source') + ').</td></tr>';
      document.getElementById('book-summary').innerHTML = 'No resting orders.';
      return;
    }
    var rows = {}; // price -> {bid, ask}
    yes.forEach(function (p) {
      var price = K.fp(p[0]), size = K.fp(p[1]);
      rows[price] = rows[price] || {}; rows[price].bid = size;
    });
    no.forEach(function (p) {
      var noPrice = K.fp(p[0]), size = K.fp(p[1]);
      var yesAsk = Math.round((1 - noPrice) * 10000) / 10000;
      rows[yesAsk] = rows[yesAsk] || {}; rows[yesAsk].ask = size;
    });
    // implied asks from YES bids at same price? No — an ask at P comes only from NO bids at 1-P.
    var prices = Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }); // desc
    var maxSize = 1;
    prices.forEach(function (p) { maxSize = Math.max(maxSize, rows[p].bid || 0, rows[p].ask || 0); });
    tb.innerHTML = prices.map(function (p) {
      var r = rows[p];
      var bidW = r.bid ? Math.round(r.bid / maxSize * 100) : 0;
      var askW = r.ask ? Math.round(r.ask / maxSize * 100) : 0;
      return '<tr>' +
        '<td class="num"><strong>$' + p.toFixed(4) + '</strong></td>' +
        '<td class="num bar bid">' + (r.bid !== undefined ? '<span class="fill" style="width:' + bidW + '%"></span>' + K.num(r.bid) : '') + '</td>' +
        '<td class="num bar ask">' + (r.ask !== undefined ? '<span class="fill" style="width:' + askW + '%"></span>' + K.num(r.ask) : '') + '</td>' +
        '</tr>';
    }).join('');

    var bestBid = yes.length ? K.fp(yes[yes.length - 1][0]) : null;
    var bestBidSize = yes.length ? K.fp(yes[yes.length - 1][1]) : 0;
    var bestAsk = no.length ? Math.round((1 - K.fp(no[no.length - 1][0])) * 10000) / 10000 : null;
    var bestAskSize = no.length ? K.fp(no[no.length - 1][1]) : 0;
    var totalBid = yes.reduce(function (a, p) { return a + K.fp(p[1]); }, 0);
    document.getElementById('book-summary').innerHTML =
      'Best YES bid: <strong>' + (bestBid === null ? '—' : '$' + bestBid.toFixed(4)) + '</strong> (' + K.num(bestBidSize) + ' contracts)<br>' +
      'Best YES ask (implied from NO bids): <strong>' + (bestAsk === null ? '—' : '$' + bestAsk.toFixed(4)) + '</strong> (' + K.num(bestAskSize) + ' contracts)<br>' +
      'Total YES bid depth shown: <strong>' + K.num(totalBid) + ' contracts</strong><br>' +
      'Source: ' + K.apiLink(sourceUrl) +
      ' · <a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">how the book works</a>';

    var m = current || {};
    document.getElementById('m-rules').innerHTML =
      (m.rules_primary ? '<p>' + K.esc(m.rules_primary) + '</p>' : '<p class="muted">Rules text not captured for this row.</p>') +
      (m.rules_secondary ? '<p class="muted">' + K.esc(m.rules_secondary) + '</p>' : '') +
      (m.result ? '<p><strong>Resolution:</strong> ' + K.esc(m.result) +
        (m.settlement_ts ? ' at ' + K.fmtTs(m.settlement_ts) : '') +
        (m.settlement_value_dollars ? ' · YES payout ' + K.usd4(m.settlement_value_dollars) : '') + '</p>' : '');
  }

  /* ---- paper trade form ---- */
  var stratSel = document.getElementById('tr-strategy');
  Store.STRATEGIES.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.id; o.textContent = s.label;
    stratSel.appendChild(o);
  });
  function updateCost() {
    var p = parseFloat(document.getElementById('tr-price').value);
    var q = parseFloat(document.getElementById('tr-qty').value);
    document.getElementById('tr-cost').innerHTML = '<div class="value">' + (isNaN(p * q) ? '—' : K.usd(p * q)) + '</div><div class="note">price × quantity (fees not applied — see S-05)</div>';
  }
  ['tr-price', 'tr-qty'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', updateCost);
  });
  updateCost();

  document.getElementById('tr-submit').addEventListener('click', function () {
    if (!current) return;
    var side = document.getElementById('tr-side').value;
    var price = parseFloat(document.getElementById('tr-price').value);
    var qty = parseFloat(document.getElementById('tr-qty').value);
    var msg = document.getElementById('tr-msg');
    if (isNaN(price) || price < 0 || price > 1) { msg.innerHTML = '<span class="badge bad">price must be $0–$1</span>'; return; }
    if (isNaN(qty) || qty < 1) { msg.innerHTML = '<span class="badge bad">quantity must be ≥ 1</span>'; return; }
    var tr = Store.addTrade({
      ticker: current.ticker, title: current.title, topic: current.topic,
      side: side, price: price, qty: qty, strategy: stratSel.value, fee: 0
    });
    msg.innerHTML = '<span class="badge good">simulated trade recorded</span> ' +
      K.esc(tr.id) + ' — ' + side.toUpperCase() + ' ' + qty + ' @ ' + K.usd4(String(price)) +
      ' · <a href="portfolio.html">view portfolio</a>';
  });

  /* ---- polling ---- */
  function poll() {
    if (!current || document.hidden) return;
    K.get('/markets/' + encodeURIComponent(ticker), { timeoutMs: 8000 }).then(function (r) {
      if (r.data.market) {
        current = Object.assign(current, normalize(r.data.market));
        renderHeaderStats();
        samplePrice();
        draw();
      }
    }).catch(function () {});
    loadOrderbook();
  }

  loadMarket();
  setInterval(poll, K.cfg.polling.marketRefreshMs);
  setInterval(function () { if (!document.hidden) loadCandles(); }, K.cfg.polling.historyRefreshMs);
})();
