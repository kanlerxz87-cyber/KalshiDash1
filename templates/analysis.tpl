<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trade analysis — KalshiDash1</title>
<meta name="description" content="Simulated Kalshi demo trades categorised by strategy and by topic, with win rate, P&amp;L and average trade so new strategies can be built from the results.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="analysis" data-base="{{BASE}}">
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
      <h1>Trade analysis</h1>
      <p class="sub">Every simulated trade is tagged with the strategy that produced it and the topic it belongs to, so a
      strategy can be judged on its own results: win rate, total P&amp;L and average trade.</p>
    </div>
    <div class="btnrow"><a class="btn" href="portfolio.html">Open the portfolio</a></div>
  </div>

  <div id="mode-notice" class="notice">Probing the official demo API…</div>

  <div id="analysis-notice" class="notice" role="status"></div>
  <div class="grid cols-2">
    <div class="panel pad-0">
      <div style="padding:12px 14px 4px"><h3 style="margin:0">Performance by strategy</h3></div>
      <div class="table-wrap" style="border:0;border-radius:0">
        <table class="compact"><thead><tr><th>Strategy</th><th class="num">Closed</th><th class="num">Open</th><th class="num">Win rate</th><th class="num">Total P&amp;L</th><th class="num">Avg gross trade</th><th>Source</th></tr></thead>
        <tbody id="strategy-stats"></tbody></table>
      </div>
    </div>
    <div class="panel pad-0">
      <div style="padding:12px 14px 4px"><h3 style="margin:0">Performance by topic</h3></div>
      <div class="table-wrap" style="border:0;border-radius:0">
        <table class="compact"><thead><tr><th>Topic</th><th class="num">Closed</th><th class="num">Open</th><th class="num">Win rate</th><th class="num">Gross P&amp;L</th><th>Source</th></tr></thead>
        <tbody id="topic-stats"></tbody></table>
      </div>
    </div>
  </div>

  <h2>Every simulated trade</h2>
  <div class="table-wrap">
    <table class="compact">
      <thead><tr><th>Time</th><th>Market</th><th>Topic</th><th>Strategy</th><th>Side</th><th class="num">Contracts</th><th class="num">Entry</th><th>P&amp;L</th><th>Result</th><th>Why it was taken</th><th>Source</th></tr></thead>
      <tbody id="analysis-body"></tbody>
    </table>
  </div>

  <h2>Trade categories used by this page</h2>
  <div class="panel">
    <p>A paper trade is categorised twice. These are project tags, not exchange recommendations:</p>
    <ul>
      <li><strong>Strategy</strong> — which rule fired (momentum, mean reversion, favorite, longshot, volume catalyst, or manual).</li>
      <li><strong>Topic</strong> — the focus topic of the series the market belongs to, taken from the series query that
      discovered the market.</li>
    </ul>
    <p>The exact rule for each strategy, including its thresholds, is published on <a href="strategies.html">Strategies</a>,
    so a result can be reproduced rather than taken on trust.</p>
    <p class="small muted">Trade-type categories come from the simulated order record itself; the market's topic comes from
    <code>GET /markets?series_ticker=…&amp;status=open</code> filtered by the series queries on
    <a href="api.html">API reference</a>.</p>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
