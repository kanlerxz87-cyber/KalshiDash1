/* events.js — Live Events tracker page. */
(function () {
  'use strict';
  App.renderHeader('events.html');
  App.renderFooter();
  var K = window.K;
  var state = { topic: 'all', sort: 'vol24', dir: -1, rows: [] };

  var tabsEl = document.getElementById('topic-tabs');
  var noteEl = document.getElementById('topic-note');
  var tabs = [{ id: 'all', label: 'All topics' }].concat(K.cfg.topics);
  tabs.forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'tab' + (t.id === 'all' ? ' active' : '');
    b.textContent = t.label;
    b.dataset.topic = t.id;
    b.addEventListener('click', function () {
      state.topic = t.id;
      [].forEach.call(tabsEl.children, function (c) { c.classList.remove('active'); });
      b.classList.add('active');
      load(true);
    });
    tabsEl.appendChild(b);
  });

  function cmp(a, b) {
    var f = K.fp;
    switch (state.sort) {
      case 'title': return state.dir * String(a.title || a.ticker).localeCompare(String(b.title || b.ticker));
      case 'topic': return state.dir * String(a.topic).localeCompare(String(b.topic));
      case 'last': return state.dir * ((f(a.last_price_dollars) || 0) - (f(b.last_price_dollars) || 0));
      case 'vol24': return state.dir * ((f(a.volume_24h_fp) || 0) - (f(b.volume_24h_fp) || 0));
      case 'voltot': return state.dir * ((f(a.volume_fp) || 0) - (f(b.volume_fp) || 0));
      case 'oi': return state.dir * ((f(a.open_interest_fp) || 0) - (f(b.open_interest_fp) || 0));
      case 'close': return state.dir * (String(a.close_time || '').localeCompare(String(b.close_time || '')));
      default: return 0;
    }
  }

  function render() {
    var tb = document.querySelector('#events-table tbody');
    tb.innerHTML = '';
    var rows = state.rows.slice().sort(cmp);
    rows.forEach(function (m) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><a href="' + K.marketUrl(m.ticker) + '">' + K.esc(m.title || m.ticker) + '</a><br><code class="small">' + K.esc(m.ticker) + '</code></td>' +
        '<td>' + App.topicLabel(m.topic) + '</td>' +
        '<td class="num">' + K.usd4(m.last_price_dollars) + '</td>' +
        '<td class="num">' + K.usd4(m.yes_bid_dollars) + ' (' + K.num(K.fp(m.yes_bid_size_fp)) + ') / ' +
          K.usd4(m.yes_ask_dollars) + ' (' + K.num(K.fp(m.yes_ask_size_fp)) + ')</td>' +
        '<td class="num">' + K.num(K.fp(m.volume_24h_fp)) + '</td>' +
        '<td class="num">' + K.num(K.fp(m.volume_fp)) + '</td>' +
        '<td class="num">' + K.num(K.fp(m.open_interest_fp)) + '</td>' +
        '<td class="small nowrap">' + K.fmtTs(m.close_time) + '</td>' +
        '<td>' + App.statusBadge(m.status, m.result) + '</td>' +
        '<td class="src">' + K.apiLink(m.source_url) + '</td>';
      tb.appendChild(tr);
    });
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="10" class="muted">No open markets captured for this topic at the moment — see the note below and the resolution log.</td></tr>';
    }
  }

  function renderResolved() {
    Data.snapshotSettled().then(function (rows) {
      var tb = document.querySelector('#resolved-table tbody');
      tb.innerHTML = '';
      rows.forEach(function (m) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><code class="small">' + K.esc(m.ticker) + '</code><br><span class="small muted">' + K.esc(m.event_title || '') + '</span></td>' +
          '<td>' + App.topicLabel(m.topic) + '</td>' +
          '<td>' + K.esc(m.strike || '') + '</td>' +
          '<td class="num">' + K.num(K.fp(m.volume_fp)) + '</td>' +
          '<td>' + (m.result === 'yes' ? '<span class="badge yes">YES</span>' : m.result === 'no' ? '<span class="badge no">NO</span>' : '<span class="badge neutral">' + K.esc(m.result) + '</span>') + '</td>' +
          '<td class="num">' + K.usd4(m.settlement_value_dollars) + '</td>' +
          '<td class="small nowrap">' + K.fmtTs(m.settlement_ts) + '</td>' +
          '<td class="small">' + K.esc(m.settlement_source || '') + '</td>' +
          '<td class="src">' + K.apiLink(m.source_url) + '</td>';
        tb.appendChild(tr);
      });
      if (!rows.length) tb.innerHTML = '<tr><td colspan="9" class="muted">No settled markets in the snapshot.</td></tr>';
    });
  }

  function load(force) {
    var note = document.getElementById('refresh-note');
    note.textContent = 'loading…';
    var p = state.topic === 'all'
      ? Data.allMarkets({ force: force, topN: 4 })
      : Data.loadTopicMarkets(state.topic, { force: force, topN: 6 });
    p.then(function (rows) {
      state.rows = rows;
      render();
      note.textContent = (K.state.mode === 'live' || K.state.mode === 'legacy' ? 'live' : 'snapshot') + ' · updated ' + new Date().toISOString().substr(11, 8) + ' UTC';
      // topic note
      if (state.topic === 'all') {
        noteEl.innerHTML = '<strong>Ranking:</strong> all focus topics merged, sorted by 24h dollar volume. ' +
          'Rows without open markets are listed in the per-topic snapshot notes on <a href="sources.html">Sources</a>.';
      } else {
        Data.snapshot().then(function (snap) {
          var t = snap.topics[state.topic];
          noteEl.innerHTML = '<strong>' + App.topicLabel(state.topic) + ':</strong> ' + K.esc(t && t.live_note ? t.live_note : '') +
            (t && t.series_query ? ' <br>Series query: ' + K.apiLink(t.series_query, 'GET /series') : '');
        });
      }
    });
  }

  document.querySelectorAll('#events-table th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var s = th.dataset.sort;
      if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = -1; }
      render();
    });
  });
  document.getElementById('refresh-btn').addEventListener('click', function () { load(true); });

  load(false);
  renderResolved();
  setInterval(function () { if (!document.hidden) load(true); }, K.cfg.polling.listRefreshMs);
})();
