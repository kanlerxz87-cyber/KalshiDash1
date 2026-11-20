/* portfolio.js — simulated portfolio performance + trade log. */
(function () {
  'use strict';
  App.renderHeader('portfolio.html');
  App.renderFooter();
  var K = window.K;

  // populate filters
  var ft = document.getElementById('f-topic');
  K.cfg.topics.forEach(function (t) {
    var o = document.createElement('option'); o.value = t.id; o.textContent = t.label; ft.appendChild(o);
  });
  var fs = document.getElementById('f-strategy');
  Store.STRATEGIES.forEach(function (s) {
    var o = document.createElement('option'); o.value = s.id; o.textContent = s.label; fs.appendChild(o);
  });

  function render() {
    var trades = Store.getTrades();
    var stats = Store.computeStats(trades);

    document.getElementById('p-stats').innerHTML =
      stat('Realized P&L', K.usd(stats.realized), 'settled simulated trades') +
      stat('Win rate', stats.winRate === null ? '—' : (stats.winRate * 100).toFixed(1) + '%', stats.wins + ' wins / ' + stats.losses + ' losses') +
      stat('Open exposure', K.usd(stats.openExposure), stats.open + ' open trades at entry cost') +
      stat('Fees', K.usd(stats.fees), 'not applied by default — see S-05');

    // table
    var tb = document.querySelector('#trades-table tbody');
    tb.innerHTML = '';
    var ftv = ft.value, fsv = fs.value, fstv = document.getElementById('f-status').value;
    trades.filter(function (t) {
      return (!ftv || t.topic === ftv) && (!fsv || t.strategy === fsv) && (!fstv || t.status === fstv);
    }).forEach(function (t) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="small nowrap">' + K.fmtTs(t.ts) + '</td>' +
        '<td><a href="' + K.marketUrl(t.ticker) + '">' + K.esc((t.title || t.ticker).slice(0, 60)) + '</a><br><code class="small">' + K.esc(t.ticker) + '</code></td>' +
        '<td>' + App.topicLabel(t.topic) + '</td>' +
        '<td><span class="badge ' + (t.side === 'yes' ? 'yes' : 'no') + '">' + K.esc(t.side) + '</span></td>' +
        '<td class="num">' + K.usd4(String(t.price)) + '</td>' +
        '<td class="num">' + K.num(t.qty, 0) + '</td>' +
        '<td class="num">' + K.usd(t.price * t.qty) + '</td>' +
        '<td class="small">' + K.esc((Store.STRATEGIES.filter(function (s) { return s.id === t.strategy; })[0] || {}).label || t.strategy) + '</td>' +
        '<td>' + (t.status === 'open' ? '<span class="badge accent">open</span>' : '<span class="badge neutral">settled</span>') +
          (t.seed ? ' <span class="badge warn" title="seeded demo trade, not a real order">seed</span>' : '') + '</td>' +
        '<td>' + (t.result ? (t.result === 'yes' ? '<span class="badge yes">YES</span>' : '<span class="badge no">NO</span>') : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (t.exit_price === null || t.exit_price === undefined ? '—' : K.usd4(String(t.exit_price))) + '</td>' +
        '<td class="num">' + (t.pnl === null || t.pnl === undefined ? '<span class="muted">unrealized</span>' :
            (t.pnl >= 0 ? '<strong style="color:var(--good)">' + K.usd(t.pnl) + '</strong>' : '<strong style="color:var(--bad)">' + K.usd(t.pnl) + '</strong>')) + '</td>' +
        '<td class="src">' + K.apiLink('https://docs.kalshi.com/api-reference/market/get-market', 'model') + '</td>';
      tb.appendChild(tr);
    });

    // category table
    var cats = {};
    trades.forEach(function (t) {
      cats[t.topic] = cats[t.topic] || [];
      cats[t.topic].push(t);
    });
    var ctb = document.querySelector('#cat-table tbody');
    ctb.innerHTML = '';
    Object.keys(cats).forEach(function (k) {
      var s = Store.computeStats(cats[k]);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + App.topicLabel(k) + '</td><td class="num">' + s.total + '</td><td class="num">' + s.settled +
        '</td><td class="num">' + s.wins + '</td><td class="num">' + (s.winRate === null ? '—' : (s.winRate * 100).toFixed(1) + '%') +
        '</td><td class="num">' + K.usd(s.realized) + '</td>';
      ctb.appendChild(tr);
    });

    drawEquity(trades);
  }

  function stat(label, value, note) {
    return '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="note">' + note + '</div></div>';
  }

  function drawEquity(trades) {
    var settled = trades.filter(function (t) { return t.status === 'settled' && t.pnl !== null && t.pnl !== undefined && t.ts; })
      .sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
    var cum = 0;
    var pts = settled.map(function (t) {
      cum += t.pnl;
      return { t: Math.floor(new Date(t.ts).getTime() / 1000), v: Math.round(cum * 100) / 100 };
    });
    var canvas = document.getElementById('equity-chart');
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!pts.length) { ctx.fillStyle = '#5b6b7b'; ctx.textAlign = 'center'; ctx.fillText('No settled trades yet.', W / 2, H / 2); return; }
    var padL = 52, padR = 14, padT = 12, padB = 26;
    var vs = pts.map(function (p) { return p.v; });
    var mn = Math.min(0, Math.min.apply(null, vs)), mx = Math.max(0, Math.max.apply(null, vs));
    if (mx === mn) { mx = mn + 1; }
    var tMin = pts[0].t, tMax = pts[pts.length - 1].t;
    if (tMax === tMin) tMax = tMin + 1;
    function X(t) { return padL + (t - tMin) / (tMax - tMin) * (W - padL - padR); }
    function Y(v) { return padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB); }
    // zero line
    ctx.strokeStyle = '#e3e8ee'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();
    ctx.fillStyle = '#5b6b7b'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('$' + mn.toFixed(0), padL - 8, Y(mn) + 4);
    ctx.fillText('$' + mx.toFixed(0), padL - 8, Y(mx) + 4);
    ctx.beginPath();
    pts.forEach(function (p, i) { var x = X(p.t), y = Y(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = '#14568f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#14568f';
    pts.forEach(function (p) { ctx.beginPath(); ctx.arc(X(p.t), Y(p.v), 3, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#5b6b7b'; ctx.textAlign = 'left';
    ctx.fillText(K.fmtTsSec(tMin).slice(5, 16), padL, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText(K.fmtTsSec(tMax).slice(5, 16), W - padR, H - 8);
    ctx.textAlign = 'left';
    ctx.fillText('end P&L ' + K.usd(vs[vs.length - 1]), padL + 6, padT + 12);
  }

  // filters
  ['f-topic', 'f-strategy', 'f-status'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', render);
  });

  document.getElementById('settle-btn').addEventListener('click', function () {
    var results = {};
    Data.snapshotSettled().then(function (rows) {
      rows.forEach(function (m) { if (m.result) results[m.ticker] = m.result; });
      return Data.allMarkets({ topN: 4 });
    }).then(function (rows) {
      rows.forEach(function (m) { if (m.result) results[m.ticker] = m.result; });
    }).catch(function () {}).then(function () {
      var changed = Store.settleTrades(results);
      document.getElementById('p-msg').textContent = changed
        ? 'settled open trades whose results are known (' + Object.keys(results).length + ' known results loaded)'
        : 'no open trades matched a known result';
      render();
    });
  });

  document.getElementById('reset-btn').addEventListener('click', function () {
    if (!confirm('Reset to seeded demo data? Your recorded trades will be replaced.')) return;
    Store.setJSON('trades', null);
    location.reload();
  });

  render();
})();
