/* strategylab.js — K2: trade categorisation + strategy synthesis lab (session-7f90cf50).
 *
 * Ingests simulated trades from every trade store present in this browser's localStorage,
 * normalises them to the open schema `kalshidash:trades:v2` (documented on strategylab.html),
 * categorises each trade (topic, strategy, holding period, entry-price band, size band, outcome),
 * computes per-category / per-strategy performance tables from the recorded fields, and
 * proposes strategy rules from the observed trade types. Everything here is SIMULATED data
 * analysis: no orders are placed, no credentials are used, and computed metrics are labelled.
 *
 * Verified semantics (official sources, read 2026-11-20; links on strategylab.html):
 * - Settlement: winning side receives $1 per contract; market `result` = "yes" | "no"
 *   (https://docs.kalshi.com/getting_started/market_settlement).
 * - Prices/quantities are fixed-point strings (`*_dollars`, `*_fp`)
 *   (https://docs.kalshi.com/getting_started/fixed_point_migration).
 * - Real order writes are POST /portfolio/events/orders (V2) with side bid|ask, count, price
 *   and signed auth headers (https://docs.kalshi.com/api-reference/orders/create-order-v2).
 *   This lab never calls that endpoint.
 */
(function () {
  'use strict';

  var NS_PREFIX = 'kalshidash:';
  var V2_KEY = 'kalshidash:trades:v2';
  var V1_KEY = 'kalshidash:v1:trades';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
  }
  function num(v) { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function usd(v, d) {
    var n = num(v);
    return n === null ? '<span class="muted">—</span>' : (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(d === undefined ? 2 : d);
  }
  function pct(v) { return v === null || v === undefined ? '<span class="muted">—</span>' : (v * 100).toFixed(1) + '%'; }

  var TOPIC_LABEL = {
    gas: 'Gas prices', elections: 'Elections', culture: 'Culture',
    crypto: 'Crypto', golf: 'Golf', other: 'Other', unknown: 'Unlabelled'
  };

  /* ---------------- normalisation ---------------- */
  /* v1 (dash/js/store.js): {id, ts, ticker, title, topic, side:yes|no, price, qty, strategy,
                            status, result, exit_price, pnl, fee, seed}
     v2 (published here):  see schema table on strategylab.html. */
  function normalizeV1(t) {
    if (!t || typeof t !== 'object') return null;
    var entry = num(t.price);
    var exitP = num(t.exit_price);
    var count = num(t.qty);
    return {
      id: String(t.id || ''),
      ts_open: t.ts || t.entry_ts || '',
      ts_close: (t.status === 'settled' || t.status === 'closed') ? (t.ts_close || t.settled_ts || '') : '',
      ticker: String(t.ticker || ''),
      event_ticker: String(t.event_ticker || ''),
      series_ticker: String(t.series_ticker || ''),
      title: String(t.title || ''),
      topic: TOPIC_LABEL[t.topic] ? t.topic : 'unknown',
      strategy: String(t.strategy || 'unlabelled'),
      order_side: '',
      outcome: (t.side === 'yes' || t.side === 'no') ? t.side : '',
      action: '',
      count: count,
      entry: entry,
      exit: exitP,
      status: String(t.status || ''),
      result: String(t.result || ''),
      pnl_recorded: num(t.pnl),
      fees_recorded: num(t.fee),
      engine: t.execution_model || (t.auto ? 'legacy local v1 auto record (unverified)' : 'legacy local v1 record (unverified)'),
      source_url: t.quote && t.quote.source_url || t.source_url || '',
      seed: !!t.seed,
      notes: ''
    };
  }
  function normalizeV2(t) {
    if (!t || typeof t !== 'object') return null;
    return {
      id: String(t.id || ''),
      ts_open: t.ts_open || '',
      ts_close: t.ts_close || '',
      ticker: String(t.ticker || ''),
      event_ticker: String(t.event_ticker || ''),
      series_ticker: String(t.series_ticker || ''),
      title: String(t.title || ''),
      topic: TOPIC_LABEL[t.topic] ? t.topic : 'unknown',
      strategy: String(t.strategy || 'unlabelled'),
      order_side: String(t.order_side || ''),
      outcome: (t.outcome === 'yes' || t.outcome === 'no') ? t.outcome : '',
      action: String(t.action || ''),
      count: num(t.count_fp !== undefined ? t.count_fp : t.count),
      entry: num(t.entry_price_dollars !== undefined ? t.entry_price_dollars : t.entry),
      exit: num(t.exit_price_dollars !== undefined ? t.exit_price_dollars : t.exit),
      status: String(t.status || ''),
      result: String(t.result || ''),
      pnl_recorded: num(t.pnl_dollars !== undefined ? t.pnl_dollars : t.pnl_recorded),
      fees_recorded: num(t.fees_dollars !== undefined ? t.fees_dollars : t.fees_recorded),
      engine: String(t.engine || 'unknown'),
      source_url: String(t.source_url || ''),
      seed: !!t.seed,
      notes: String(t.notes || '')
    };
  }

  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return j;
    } catch (e) { return null; }
  }

  function collect() {
    var out = [];
    var sources = [];
    var v1 = readStore(V1_KEY);
    var v1rows = Array.isArray(v1) ? v1 : [];
    v1rows.forEach(function (t) { var r = normalizeV1(t); if (r) out.push(r); });
    sources.push({ key: V1_KEY, n: v1rows.length, note: 'dash/ suite store (session-cdfe52bd); v1 field names mapped to v2.' });

    var v2raw = readStore(V2_KEY);
    var v2rows = Array.isArray(v2raw) ? v2raw : (v2raw && Array.isArray(v2raw.trades) ? v2raw.trades : []);
    v2rows.forEach(function (t) { var r = normalizeV2(t); if (r) out.push(r); });
    sources.push({ key: V2_KEY, n: v2rows.length, note: 'Open schema (this page). Auto-trade engines may write here.' });

    // Any other keys under the namespace (future engines) — normalise defensively.
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(NS_PREFIX) !== 0 || k === V1_KEY || k === V2_KEY) continue;
        if (/catalyst|swings|suggest/.test(k)) continue;
        var v = readStore(k);
        var rows = Array.isArray(v) ? v : (v && Array.isArray(v.trades) ? v.trades : null);
        if (!rows || !rows.length) continue;
        var added = 0;
        rows.forEach(function (t) {
          var r = (t && t.entry_price_dollars !== undefined ? normalizeV2(t) : normalizeV1(t));
          if (r && r.ticker && r.entry !== null) { out.push(r); added++; }
        });
        if (added) sources.push({ key: k, n: added, note: 'Additional namespaced store (defensive ingest).' });
      }
    } catch (e) { /* storage access issues — reported in the sources table as-is */ }
    return { trades: out, sources: sources };
  }

  /* ---------------- derived fields ---------------- */
  function holdingHours(t) {
    if (!t.ts_open) return null;
    var a = Date.parse(t.ts_open);
    if (isNaN(a)) return null;
    if ((t.status === 'settled' || t.status === 'closed') && !t.ts_close) return null;
    var b = t.ts_close ? Date.parse(t.ts_close) : Date.now();
    if (!Number.isFinite(b) || b < a) return null;
    return (b - a) / 3600000;
  }
  function priceBand(p) {
    if (p === null) return 'unknown';
    if (p < 0.20) return 'deep longshot (<$0.20)';
    if (p < 0.80) return 'mid ($0.20–$0.79)';
    return 'favorite (≥$0.80)';
  }
  function holdBand(h) {
    if (h === null) return 'unknown';
    if (h < 1) return '<1 h';
    if (h < 24) return '1–24 h';
    if (h < 168) return '1–7 d';
    return '>7 d';
  }
  function sizeBand(c) {
    if (c === null) return 'unknown';
    if (c <= 10) return '≤10 contracts';
    if (c <= 50) return '11–50 contracts';
    return '>50 contracts';
  }
  /* P&L derivation (only from recorded fields; labelled "computed" wherever shown):
     - closed before settlement with an exit price: (exit − entry) × count
     - settled with result but no exit price: payout $1 if the held outcome matches `result`,
       else $0 (Market Settlement doc) → (payout − entry) × count
     Fees are NOT folded in unless recorded separately. */
  function pnlComputed(t) {
    if (t.entry === null || t.entry < 0 || t.entry > 1 || t.count === null || t.count <= 0) return null;
    if (t.exit !== null) return (t.exit - t.entry) * t.count;
    if (t.status === 'settled' && (t.result === 'yes' || t.result === 'no') && t.outcome) {
      var win = t.result === t.outcome ? 1 : 0;
      return (win - t.entry) * t.count;
    }
    return null;
  }
  function enrich(t) {
    t.hold_h = holdingHours(t);
    t.price_band = priceBand(t.entry);
    t.hold_band = holdBand(t.hold_h);
    t.size_band = sizeBand(t.count);
    t.pnl_computed = pnlComputed(t);
    var settled = t.status === 'settled' || t.status === 'closed';
    t.outcome_win = settled && t.pnl_recorded !== null ? t.pnl_recorded > 0
      : (t.pnl_computed !== null && settled ? t.pnl_computed > 0 : null);
    if (settled && t.pnl_recorded !== null && t.pnl_computed !== null && Math.abs(t.pnl_recorded - t.pnl_computed) > 0.02) {
      t.pnl_mismatch = true;
    }
    return t;
  }

  /* ---------------- aggregation ---------------- */
  function aggregate(trades, keyFn) {
    var groups = {};
    trades.forEach(function (t) {
      var k = keyFn(t) || 'unknown';
      var g = groups[k] || (groups[k] = { key: k, n: 0, settled: 0, wins: 0, losses: 0, pnl_rec: 0, pnl_comp: 0, rec_n: 0, comp_n: 0, entry_sum: 0, entry_n: 0, hold_sum: 0, hold_n: 0 });
      g.n++;
      var settled = t.status === 'settled' || t.status === 'closed';
      if (settled) {
        g.settled++;
        if (t.outcome_win === true) g.wins++;
        if (t.outcome_win === false) g.losses++;
        if (t.pnl_recorded !== null) { g.pnl_rec += t.pnl_recorded; g.rec_n++; }
        if (t.pnl_computed !== null) { g.pnl_comp += t.pnl_computed; g.comp_n++; }
      }
      if (t.entry !== null) { g.entry_sum += t.entry; g.entry_n++; }
      if (t.hold_h !== null) { g.hold_sum += t.hold_h; g.hold_n++; }
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.winRate = (g.wins + g.losses) > 0 ? g.wins / (g.wins + g.losses) : null;
      g.avgPnl = g.rec_n ? g.pnl_rec / g.rec_n : (g.comp_n ? g.pnl_comp / g.comp_n : null);
      g.avgEntry = g.entry_n ? g.entry_sum / g.entry_n : null;
      g.avgHold = g.hold_n ? g.hold_sum / g.hold_n : null;
      return g;
    }).sort(function (a, b) { return b.n - a.n; });
  }

  function statsTable(caption, rows, keyLabel) {
    var body = rows.map(function (g) {
      return '<tr><td>' + esc(g.key) + '</td><td class="num">' + g.n + '</td><td class="num">' + g.settled + '</td>' +
        '<td class="num">' + g.wins + '</td><td class="num">' + g.losses + '</td>' +
        '<td class="num">' + pct(g.winRate) + '</td>' +
        '<td class="num">' + usd(g.rec_n ? g.pnl_rec : null) + (g.rec_n ? '' : ' <span class="muted">(none recorded)</span>') + '</td>' +
        '<td class="num">' + usd(g.comp_n ? g.pnl_comp : null) + ' <span class="badge neutral">computed</span></td>' +
        '<td class="num">' + usd(g.avgEntry) + '</td>' +
        '<td class="num">' + (g.avgHold === null ? '—' : g.avgHold.toFixed(1) + ' h') + '</td><td><a href="https://docs.kalshi.com/getting_started/market_settlement">payout definition only</a> · local arithmetic, unverified fills</td></tr>';
    }).join('');
    return '<h3>' + esc(caption) + '</h3><div class="table-wrap"><table><thead><tr>' +
      '<th>' + esc(keyLabel) + '</th><th class="num">Trades</th><th class="num">Settled</th><th class="num">Wins</th>' +
      '<th class="num">Losses</th><th class="num">Win rate</th><th class="num">P&amp;L (recorded)</th>' +
      '<th class="num">P&amp;L (computed)</th><th class="num">Avg entry</th><th class="num">Avg hold</th><th>Field semantics, not trade verification</th>' +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="11" class="muted">No trades in this group.</td></tr>') + '</tbody></table></div>' +
      '<p class="muted small">Metrics computed from simulated trades in this browser. P&amp;L (computed) = (exit − entry) × count when an exit price is recorded, ' +
      'else ($1 payout if the held outcome matches <code>result</code>, else $0 − entry) × count for settled trades ' +
      '(settlement semantics: <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement ↗</a>).</p>';
  }

  /* ---------------- strategy synthesis ---------------- */
  /* "Create strategies based on the type of trade": scan settled trades grouped by
     (topic × price band) and by (strategy); emit a rule hypothesis when the cell has
     n ≥ 3 settled trades, win rate ≥ 60 % and positive average P&L. Hypotheses only. */
  function synthesize(trades) {
    var settled = trades.filter(function (t) { return t.status === 'settled' || t.status === 'closed'; });
    var ideas = [];
    function scan(rows, dims, ruleFn) {
      rows.forEach(function (g) {
        if (g.settled >= 3 && g.winRate !== null && g.winRate >= 0.60 && g.avgPnl !== null && g.avgPnl > 0) {
          ideas.push({ dims: dims, group: g, rule: ruleFn(g) });
        }
      });
    }
    scan(aggregate(settled, function (t) { return TOPIC_LABEL[t.topic] + ' · ' + t.price_band; }), 'Topic × entry-price band',
      function (g) { return 'Buy the side that matches the observed winners in “' + g.key + '” contracts at entry ' + usd(g.avgEntry) + ', hold ' + (g.avgHold === null ? '—' : g.avgHold.toFixed(1) + ' h') + ', size in the observed band.'; });
    scan(aggregate(settled, function (t) { return t.strategy; }), 'Existing strategy tag',
      function (g) { return 'Keep using the “' + g.key + '” playbook on similar setups; observed win rate ' + pct(g.winRate) + ' over ' + g.settled + ' settled simulated trades.'; });
    scan(aggregate(settled, function (t) { return TOPIC_LABEL[t.topic] + ' · ' + t.hold_band; }), 'Topic × holding period',
      function (g) { return 'In “' + g.key + '”, target the observed holding pattern (' + (g.avgHold === null ? '—' : g.avgHold.toFixed(1) + ' h average') + ') with matching entry sizing.'; });
    return ideas;
  }

  function renderSynthesis(ideas, nTrades) {
    var host = $('#synthesis');
    if (!host) return;
    if (!ideas.length) {
      host.innerHTML = '<div class="notice">No rule hypothesis meets the bar yet (needs ≥ 3 settled trades per cell with ≥ 60% wins and positive average P&amp;L). ' +
        'Keep running simulated strategies — this section builds itself as the trade log grows.</div>';
      return;
    }
    host.innerHTML = ideas.map(function (idea) {
      var g = idea.group;
      return '<div class="card idea"><div class="k">' + esc(idea.dims) + '</div>' +
        '<div class="v">' + esc(g.key) + '</div>' +
        '<div class="s">' + esc(idea.rule) + '</div>' +
        '<div class="meta">Observed: ' + g.settled + ' settled / ' + g.n + ' total · win rate ' + pct(g.winRate) +
        ' · avg P&amp;L ' + usd(g.avgPnl) + ' · <strong>hypothesis only</strong> (derived from simulated trades; small samples; demo prices may not reflect real markets — ' +
        '<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo env ↗</a>). Test out-of-sample before any use.</div></div>';
    }).join('') +
    '<p class="muted small">Synthesis scan across ' + nTrades + ' ingested trades. Rule text is generated from the observed cells — never from outside data.</p>';
  }

  /* ---------------- trade table ---------------- */
  var filterState = { topic: '', strategy: '', includeSeed: true };

  function filtered(trades) {
    return trades.filter(function (t) {
      return (filterState.includeSeed || !t.seed) && (!filterState.topic || t.topic === filterState.topic)
        && (!filterState.strategy || t.strategy === filterState.strategy);
    });
  }
  function renderTrades(trades) {
    var host = $('#trade-table');
    if (!host) return;
    var rows = filtered(trades);
    host.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Opened</th><th>Ticker</th><th>Title</th><th>Topic</th><th>Strategy</th><th>Outcome held</th>' +
      '<th class="num">Count</th><th class="num">Entry</th><th class="num">Exit</th><th>Status</th><th>Result</th>' +
      '<th class="num">P&amp;L recorded</th><th class="num">P&amp;L computed</th><th>Band tags</th><th>Provenance</th><th>Source</th>' +
      '</tr></thead><tbody>' +
      (rows.map(function (t) {
        var hasSource = window.KDPaper && window.KDPaper.official(t.source_url);
        var src = hasSource ? t.source_url : 'https://docs.kalshi.com/api-reference/market/get-market';
        return '<tr>' +
          '<td>' + esc(t.ts_open || '—') + '</td>' +
          '<td>' + esc(t.ticker || '—') + '</td>' +
          '<td>' + esc(t.title || '—') + '</td>' +
          '<td><span class="badge neutral">' + esc(TOPIC_LABEL[t.topic] || t.topic) + '</span></td>' +
          '<td>' + esc(t.strategy) + '</td>' +
          '<td>' + esc(t.outcome || '—') + (t.order_side ? ' <span class="muted">(v2 ' + esc(t.order_side) + ')</span>' : '') + '</td>' +
          '<td class="num">' + (t.count === null ? '—' : t.count) + '</td>' +
          '<td class="num">' + usd(t.entry) + '</td>' +
          '<td class="num">' + usd(t.exit) + '</td>' +
          '<td>' + esc(t.status || '—') + '</td>' +
          '<td>' + esc(t.result || '—') + '</td>' +
          '<td class="num">' + usd(t.pnl_recorded) + '</td>' +
          '<td class="num">' + usd(t.pnl_computed) + (t.pnl_mismatch ? ' <span class="badge warn">differs from recorded</span>' : '') + '</td>' +
          '<td class="small">' + esc(t.price_band) + ' · ' + esc(t.hold_band) + ' · ' + esc(t.size_band) + '</td>' +
          '<td class="small">' + esc(t.engine) + (t.seed ? ' <span class="badge warn">seed</span>' : '') + '</td>' +
          '<td><a href="' + esc(src) + '" target="_blank" rel="noopener" title="Field definitions never verify a local trade">' + (hasSource ? 'stored API pointer; fill unverified' : 'field definition; no fill evidence') + '</a></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="16" class="muted">No trades match the filters (or none stored yet).</td></tr>') +
      '</tbody></table></div>';
  }

  /* ---------------- sources table ---------------- */
  function renderSources(sources) {
    var host = $('#stores');
    if (!host) return;
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>localStorage key</th><th class="num">Trades found</th><th>Notes</th><th>Project source (not exchange data)</th></tr></thead><tbody>' +
      (sources.map(function (s) {
        return '<tr><td><code>' + esc(s.key) + '</code></td><td class="num">' + s.n + '</td><td>' + esc(s.note) + '</td><td><a href="https://github.com/kanlerxz87-cyber/KalshiDash1/blob/main/assets/strategylab.js">ingestion code</a></td></tr>';
      }).join('') || '<tr><td colspan="4" class="muted">No trade stores present in this browser.</td></tr>') +
      '</tbody></table></div>' +
      '<p class="muted small">The page re-reads these keys whenever it loads and every 15 s while open, so trades produced by an auto-trade engine appear automatically.</p>';
  }

  /* ---------------- boot ---------------- */
  function render() {
    var collected = collect();
    var allTrades = collected.trades.map(enrich);
    var trades = filtered(allTrades);
    renderSources(collected.sources);

    // filter options
    var ft = $('#f-topic'), fs = $('#f-strategy');
    if (ft && !ft.options.length) {
      ft.innerHTML = '<option value="">All topics</option>' + Object.keys(TOPIC_LABEL).map(function (k) {
        return '<option value="' + k + '">' + esc(TOPIC_LABEL[k]) + '</option>';
      }).join('');
      ft.addEventListener('change', function () { filterState.topic = ft.value; render(); });
    }
    if (fs && !fs.options.length) {
      var seen = {};
      allTrades.forEach(function (t) { seen[t.strategy] = true; });
      fs.innerHTML = '<option value="">All strategies</option>' + Object.keys(seen).map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(k) + '</option>';
      }).join('');
      fs.addEventListener('change', function () { filterState.strategy = fs.value; render(); });
    }
    var seedBox = $('#f-seed');
    if (seedBox && !seedBox.dataset.wired) {
      seedBox.dataset.wired = '1';
      seedBox.addEventListener('change', function () { filterState.includeSeed = seedBox.checked; render(); });
    }

    renderTrades(trades);

    var counts = $('#lab-cards');
    if (counts) {
      var settled = trades.filter(function (t) { return t.status === 'settled' || t.status === 'closed'; });
      var wins = settled.filter(function (t) { return t.outcome_win === true; }).length;
      var losses = settled.filter(function (t) { return t.outcome_win === false; }).length;
      var pnlRec = 0, recN = 0;
      settled.forEach(function (t) { if (t.pnl_recorded !== null) { pnlRec += t.pnl_recorded; recN++; } });
      counts.innerHTML =
        stat('Trades ingested', String(trades.length), 'filtered local records, not verified exchange fills') +
        stat('Settled / closed', String(settled.length), wins + ' wins · ' + losses + ' losses (by recorded P&amp;L sign)') +
        stat('Local P&amp;L (recorded, unverified)', usd(recN ? pnlRec : null), recN ? 'sum of recorded P&amp;L on settled trades' : 'no recorded P&amp;L values yet') +
        stat('Strategy hypotheses', String(synthesize(trades).length), 'cells with ≥3 settled, ≥60% wins, avg P&amp;L &gt; 0');
    }

    var byStrategy = aggregate(trades, function (t) { return t.strategy; });
    var byTopic = aggregate(trades, function (t) { return TOPIC_LABEL[t.topic] || t.topic; });
    var byPrice = aggregate(trades, function (t) { return t.price_band; });
    var byHold = aggregate(trades, function (t) { return t.hold_band; });
    var tables = $('#stat-tables');
    if (tables) {
      tables.innerHTML =
        statsTable('Performance by strategy', byStrategy, 'Strategy') +
        statsTable('Performance by topic (brief categories)', byTopic, 'Topic') +
        statsTable('Performance by entry-price band', byPrice, 'Entry-price band') +
        statsTable('Performance by holding period', byHold, 'Holding period');
    }
    renderSynthesis(synthesize(trades), trades.length);
  }

  function stat(k, v, s) {
    return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  }

  function wireExport() {
    var btn = $('#export-json');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var collected = collect();
      var payload = {
        schema: 'kalshidash:trades:v2',
        exported_at: new Date().toISOString(),
        note: 'Simulated trades only. Normalised from localStorage stores in this browser; blanks preserved, never filled.',
        trades: collected.trades.map(enrich)
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kalshidash-trades-v2.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  function start() {
    render();
    wireExport();
    setInterval(render, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
