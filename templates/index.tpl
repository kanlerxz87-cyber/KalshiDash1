<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KalshiDash1 — live Kalshi demo dashboard for gas, elections, culture, crypto and golf</title>
<meta name="description" content="Live dashboard for the Kalshi demo exchange: highest-dollar open events in gas prices, elections, culture, crypto and golf; two real-time swing-alert chats; price charts, order-book liquidity, simulated portfolio and strategy analysis. Every row links to its official source.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="index">
<header class="site">
  <div class="head-inner">
    <div class="brand">Kalshi<span class="dot">Dash</span>1 <span class="badge neutral">Demo</span></div>
    <div class="head-meta">
      <span id="mode-badge" class="badge warn">data: probing…</span>
      <span id="clock" class="mono small muted"></span>
    </div>
  </div>
  <nav class="site"><div class="nav-inner">{{NAV}}</div></nav>
</header>

<main><div class="wrap">
  <div class="page-head">
    <div class="grow">
      <h1>Kalshi demo dashboard</h1>
      <p class="sub">Tracks the highest-dollar live events on the Kalshi <strong>demo</strong> exchange across five focus topics —
      gas prices, elections, culture, crypto and golf — until each market resolves <strong>yes</strong> or <strong>no</strong>.
      Two scrolling chat panes turn any move of at least <strong>$0.10</strong> into a live alert, and every number on the site
      links to the official endpoint or document it came from.</p>
    </div>
    <div class="btnrow">
      <a class="btn primary" href="dashboard.html">Open the live dashboard</a>
      <a class="btn" href="executive-summary.html">Executive summary</a>
    </div>
  </div>

  <div id="mode-notice" class="notice">Probing the official demo API…</div>

  <div class="grid cols-4" id="status-cards"></div>

  <h2>Executive summary</h2>
  <div class="panel">
    <p><strong>What this is.</strong> A static, dependency-free dashboard for Kalshi's official demo Trade API.
    The recommended REST root is <code>https://external-api.demo.kalshi.co/trade-api/v2</code> (also supported:
    <code>https://demo-api.kalshi.co/trade-api/v2</code>); the WebSocket root is
    <code>wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2</code> (also supported:
    <code>wss://demo-api.kalshi.co/trade-api/ws/v2</code>). These match the endpoint table in
    <a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Test In The Demo Environment</a>
    and <a href="https://docs.kalshi.com/getting_started/api_environments" target="_blank" rel="noopener">API Environments and Endpoints</a> exactly.</p>

    <p><strong>Verified facts this site is built on.</strong></p>
    <ul>
      <li>Public market data — series, events, markets, order books and candlesticks — is reachable
      <em>without authentication</em>
      (<a href="https://docs.kalshi.com/getting_started/quick_start_market_data" target="_blank" rel="noopener">Quick Start: Market Data</a>).
      Only those endpoints are used for the live feed.</li>
      <li>Balances, positions and orders require request signing
      (<code>KALSHI-ACCESS-KEY</code>, <code>-TIMESTAMP</code>, <code>-SIGNATURE</code>;
      <code>timestamp + METHOD + path</code> signed with RSA-PSS/SHA-256 or Ed25519) —
      <a href="https://docs.kalshi.com/getting_started/quick_start_authenticated_requests" target="_blank" rel="noopener">Quick Start: Authenticated Requests</a>.
      The <a href="demo-account.html">Demo account</a> page signs requests in your browser from a key you paste; the key is never stored and never leaves your browser.</li>
      <li>Markets resolve with <code>result</code> of <code>yes</code>, <code>no</code> or <code>scalar</code>, and the winning side is paid <strong>$1.00 per contract</strong>
      (<a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a>,
      <a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">Market Lifecycle</a>).
      The tracker follows each market from active → determined → finalized and announces the resolution in the chat.</li>
      <li>The demo environment uses mock funds and separate credentials, and Kalshi warns that demo prices may not reflect real markets —
      <a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo_env</a>. Nothing on this site is a trading recommendation.</li>
    </ul>

    <p><strong>At the verified snapshot ({{SNAPSHOT_CAPTURED}}):</strong> the capture found
    <strong>{{MARKET_COUNT}}</strong> open markets across the five topics and
    <strong>{{SERIES_COUNT}}</strong> matching series, using <strong>{{ENDPOINT_COUNT}}</strong> documented endpoints.
    The highest-dollar focus-topic rows are listed below and carry their own source links.</p>

    <p><strong>What is deliberately blank or flagged.</strong> Anything the API did not return is left blank and published on the
    <a href="flagged.html">Flagged for Review</a> page with the reason. The site never fills a gap with a guess.</p>
  </div>

  <h2>Focus topics</h2>
  <p class="sub">Topics are kept separate; the events inside a topic stay grouped together on that topic's own page.</p>
  <div class="topic-cards">
    <a class="topic-card" href="categories/gas.html"><h3>Gas Prices</h3><div class="big">{{TOPIC_OPEN:gas}}</div><div class="muted small">open markets at capture</div></a>
    <a class="topic-card" href="categories/elections.html"><h3>Elections</h3><div class="big">{{TOPIC_OPEN:elections}}</div><div class="muted small">open markets at capture</div></a>
    <a class="topic-card" href="categories/culture.html"><h3>Culture</h3><div class="big">{{TOPIC_OPEN:culture}}</div><div class="muted small">open markets at capture</div></a>
    <a class="topic-card" href="categories/crypto.html"><h3>Crypto</h3><div class="big">{{TOPIC_OPEN:crypto}}</div><div class="muted small">open markets at capture</div></a>
    <a class="topic-card" href="categories/golf.html"><h3>Golf</h3><div class="big">{{TOPIC_OPEN:golf}}</div><div class="muted small">open markets at capture</div></a>
  </div>

  <h2>Topic summary</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Topic</th><th class="num">Series tracked</th><th class="num">Open markets</th><th class="num">24h volume ($)</th><th>Highest-dollar row</th><th>Source</th></tr></thead>
      <tbody>{{TOPICS_TABLE}}</tbody>
    </table>
  </div>

  <h2>Highest-dollar live rows right now</h2>
  <p class="sub">Ranked by 24-hour dollar volume (contracts × the contract's settlement value). The live feed replaces this table in place when your browser can reach the demo API.</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Market</th><th>Topic</th><th class="num">Last</th><th class="num">Bid / Ask</th><th class="num">Spread</th><th class="num">24h vol ($)</th><th class="num">Total vol ($)</th><th class="num">Open int ($)</th><th>Status</th><th>Result</th><th>Source</th></tr></thead>
      <tbody id="top-table-body">{{TOP_MARKETS_TABLE}}</tbody>
    </table>
  </div>

  <h2>How to use this site</h2>
  <div class="grid cols-2">
    <div class="panel">
      <h3>Watch and decide</h3>
      <ol>
        <li><a href="dashboard.html">Live dashboard</a> — two scrolling chats: every move ≥ $0.10, and only the moves the ROI model likes.</li>
        <li><a href="alerts/index.html">Live alerts console</a> — the same two chats fed by the background engine, so the record keeps running when no browser is open.</li>
        <li><a href="markets.html">Markets</a> — the full tracked list, filterable by topic and by open/resolved, with each market's result.</li>
        <li><a href="categories/gas.html">Topic pages</a> — series, open markets, liquidity and resolved events for one topic at a time.</li>
        <li><a href="market.html">Market detail</a> — price chart (30 s → 24 h), order-book ladder, settlement rules, paper trade.</li>
      </ol>
    </div>
    <div class="panel">
      <h3>Trade and verify</h3>
      <ol>
        <li><a href="portfolio.html">Portfolio</a> — the simulated portfolio, the auto-trader and the equity curve.</li>
        <li><a href="analysis.html">Analysis</a> — trades categorised by strategy and topic so you can build a strategy from the results.</li>
        <li><a href="strategies.html">Strategies</a> — the exact rule behind every strategy and behind the ROI score.</li>
        <li><a href="catalyst.html">Swing catalysts</a> — every ≥ $0.10 move with its official event link and the settlement sources the API names, plus clearly-labelled discovery links for a possible cause.</li>
        <li><a href="sources.html">Sources</a> · <a href="flagged.html">Flagged for review</a> · <a href="questions.html">Questions</a> — provenance and open items.</li>
      </ol>
    </div>
  </div>

  <noscript><div class="notice warn">JavaScript is disabled, so the live feed is off. The captured tables above still show the
  verified snapshot with source links. Enable JavaScript for the live dashboard, the alert chats and the charts.</div></noscript>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/app.js"></script>
<script src="assets/chart.js"></script>
</body>
</html>
