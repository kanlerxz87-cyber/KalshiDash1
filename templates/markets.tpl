<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>All markets — KalshiDash1</title>
<meta name="description" content="Every tracked Kalshi demo market in the five focus topics, filterable by topic, by open or resolved state, and by ticker or title.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="markets" data-base="{{BASE}}">
<header class="site">
  <div class="head-inner">
    <div class="brand">Kalshi<span class="dot">Dash</span>1 <span class="badge neutral">Demo</span></div>
    <div class="head-meta"><span id="feed-freshness" class="badge neutral" title="Age of the last live alert-engine sample">engine …</span><span class="asof-wrap">{{FEED_ASOF}}</span>
      <span id="mode-badge" class="badge warn">data: probing…</span>
      <span id="clock" class="mono small muted"></span>
    </div>
  </div>
  <nav class="site"><div class="nav-inner">{{NAV}}</div></nav>
</header>

<main><div class="wrap">
  <div class="page-head">
    <div class="grow">
      <h1>Tracked markets</h1>
      <p class="sub">Every contract the dashboard follows in the five focus topics, kept from <code>active</code> through
      <code>determined</code> to <code>finalized</code>. The <strong>Result</strong> column shows how the market resolved —
      <span class="badge good">yes</span> or <span class="badge bad">no</span> — exactly as the exchange published it.</p>
    </div>
    <div class="btnrow"><span class="badge neutral" id="markets-count">0 markets</span></div>
  </div>

  <div id="mode-notice" class="notice">Probing the official demo API…</div>

  <div class="toolbar">
    <div class="group" id="markets-topic-chips"></div>
    <div class="group">
      <label for="status-filter">State</label>
      <select id="status-filter" style="width:170px">
        <option value="open">Open (still trading)</option>
        <option value="resolved">Resolved (yes / no)</option>
        <option value="all">Everything</option>
      </select>
    </div>
    <div class="group">
      <label for="search-input">Search ticker or title</label>
      <input type="text" id="search-input" placeholder="e.g. KXAAAGAS" style="width:220px">
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead id="markets-head"></thead>
      <tbody id="markets-body"></tbody>
    </table>
  </div>

  <h2>Market states used by this tracker</h2>
  <div class="panel">
    <p>The REST API returns these lifecycle statuses for a market, and <code>result</code> becomes <code>yes</code>,
    <code>no</code> or <code>scalar</code> once the outcome is known:</p>
    <div class="pill-list">
      <span class="pill">initialized — created, not yet trading</span>
      <span class="pill">active — open for trading</span>
      <span class="pill">inactive — paused by the exchange</span>
      <span class="pill">closed — past close time, awaiting determination</span>
      <span class="pill">determined — result known, settlement timer running</span>
      <span class="pill">disputed — result challenged</span>
      <span class="pill">amended — re-determined after a dispute</span>
      <span class="pill">finalized — settled, positions paid</span>
    </div>
    <p class="small muted">Source: <a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">Market Lifecycle</a>.
    On a YES outcome the YES holders receive $1.00 per contract; on a NO outcome the NO holders receive $1.00 per contract —
    <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a>.</p>
  </div>

  <noscript><div class="notice warn">JavaScript is disabled. The captured snapshot for all five topics is still available on the
  topic pages, each row linked to its source.</div></noscript>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
