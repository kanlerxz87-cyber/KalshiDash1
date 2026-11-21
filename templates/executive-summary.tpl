<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Executive summary — KalshiDash1</title>
<meta name="description" content="Executive summary of the Kalshi demo dashboard: what was built, what the verified data shows, what the limitations are and what a trader can do with it.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-base="{{BASE}}">
<header class="site">
  <div class="head-inner">
    <div class="brand">Kalshi<span class="dot">Dash</span>1 <span class="badge neutral">Demo</span></div>
    <div class="head-meta"><span id="feed-freshness" class="badge neutral" title="Age of the last live alert-engine sample">engine …</span>
      <span id="mode-badge" class="badge warn">data: probing…</span>
      <span id="clock" class="mono small muted"></span>
    </div>
  </div>
  <nav class="site"><div class="nav-inner">{{NAV}}</div></nav>
</header>

<main><div class="wrap">
  <div class="page-head">
    <div class="grow">
      <h1>Executive summary</h1>
      <p class="sub">What was built, what the verified data shows, what it cannot show, and how a trader uses it.
      Snapshot {{SNAPSHOT_CAPTURED}}. Every claim below links to its official source.</p>
    </div>
    <div class="btnrow"><a class="btn primary" href="dashboard.html">Open the live dashboard</a></div>
  </div>

  <h2>1 · What was built</h2>
  <div class="panel">
    <p>A single, static, dependency-free dashboard for Kalshi's official <strong>demo</strong> exchange, published on GitHub
    Pages. It tracks the highest-dollar live events in exactly the five requested topics — gas prices, elections, culture, crypto
    and golf — follows each market until it resolves <strong>yes</strong> or <strong>no</strong>, and turns price action into a
    live alerting system.</p>
    <ul>
      <li><strong>Two scrolling chats.</strong> The left pane posts every tracked contract that moves at least $0.10 in either
      direction. The right pane posts only the moves the published ROI model likes. Both carry the official settlement source that
      decides the outcome, so a swing can be investigated in one click.</li>
      <li><strong>Resolution tracking.</strong> Every market is followed from <code>active</code> through <code>determined</code> to
      <code>finalized</code>; the result is shown in the tables and announced in the chat.</li>
      <li><strong>Price and liquidity.</strong> A time-series chart with selectable 30-second to 24-hour windows, a price axis, and
      an order-book ladder that answers "how many contracts are available at this price".</li>
      <li><strong>Simulated trading.</strong> Five published strategies trade automatically against live prices, settle on
      resolution, and are analysed by strategy and by topic so a new strategy can be judged on results.</li>
      <li><strong>Your demo account, read-only.</strong> Paste your own demo API key and the site reads your balance, positions,
      fills and settlements. The key is held in memory only, and the site has no order-placement button.</li>
    </ul>
  </div>

  <h2>2 · What the verified data shows</h2>
  <div class="panel">
    <p>At the captured snapshot the demo exchange returned <strong>{{MARKET_COUNT}}</strong> open markets across the five topics
    from <strong>{{SERIES_COUNT}}</strong> tracked series (top {{SERIES_KEPT_PER_TOPIC}} per topic), using <strong>{{ENDPOINT_COUNT}}</strong> documented endpoint calls.
    Every one of those rows is stored with the exact URL it came from, so the numbers can be checked by re-running the query.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Topic</th><th class="num">Series tracked</th><th class="num">Open markets</th><th class="num">24h volume ($)</th><th>Highest-dollar row</th><th>Source</th></tr></thead>
        <tbody>{{TOPICS_TABLE}}</tbody>
      </table>
    </div>
    <p class="small muted" style="margin-top:10px">Dollar volume is contracts × the contract's published settlement value — a
    derived figure, because the API publishes no dollar-volume field. The derivation is flagged as
    <a href="flagged.html">F-03</a>.</p>
  </div>

  <h2>3 · Key verified facts</h2>
  <div class="panel">
    <ul>
      <li>Public market data needs no authentication; only balances, positions and orders need signing.
      <a href="https://docs.kalshi.com/getting_started/quick_start_market_data" target="_blank" rel="noopener">Market data</a></li>
      <li>The demo endpoints in the brief match Kalshi's documentation exactly, and demo credentials are separate from production
      credentials. <a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Demo environment</a></li>
      <li>Markets resolve with <code>yes</code>, <code>no</code> or <code>scalar</code>; the winning side is paid $1.00 per contract.
      <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Settlement</a> ·
      <a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">Lifecycle</a></li>
      <li>The WebSocket feed requires API-key authentication during the handshake, so a keyless static site must poll REST — and REST
      quotes can lag the exchange by a few seconds.
      <a href="https://docs.kalshi.com/websockets/websocket-connection" target="_blank" rel="noopener">WebSocket</a></li>
      <li>Demo prices and behaviour may not reflect real markets, and demo funds are mock funds.
      <a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Demo environment</a></li>
    </ul>
  </div>

  <h2>4 · What it cannot show</h2>
  <div class="panel">
    <ul>
      <li><strong>Why a contract moved.</strong> The Kalshi API publishes no news feed. The dashboard links the event's official
      settlement source as a <em>candidate</em> explanation, and says so rather than implying a proven cause.</li>
      <li><strong>Sub-minute history from the API.</strong> Candlestick periods are 1, 60 or 1440 minutes; seconds resolution exists
      only while a page is open.</li>
      <li><strong>A real portfolio without a key.</strong> No credential is committed, so the tracked portfolio is simulated; the
      demo-account page shows the demo-account snapshot that a GitHub Actions job produces from repository secrets. A browser
      cannot read the account itself: the demo host’s CORS preflight does not allow the <code>KALSHI-ACCESS-*</code>
      headers a signed request needs (measured 2026-11-21 — <a href="flagged.html#F-66">F-66</a>).</li>
      <li><strong>Anything outside the five topics.</strong> The demo exchange lists many more categories; they are out of scope by
      the brief, and the full taxonomy is linked from <a href="api.html">API reference</a>.</li>
    </ul>
    <p class="small muted">Every limitation is listed with its source on <a href="flagged.html">Flagged for Review</a>.</p>
  </div>

  <h2>5 · What a trader should do with it</h2>
  <div class="panel">
    <ol>
      <li>Open the <a href="dashboard.html">dashboard</a> and leave the left chat running. It is the cheapest way to notice a $0.10
      move in a contract you care about.</li>
      <li>Use the right-hand pane to cut the noise: it only shows the contracts with liquidity, a tight spread and real volume.</li>
      <li>Open the contract, check the chart, the ladder and the settlement rules, and confirm the official source that decides it.</li>
      <li>Record the trade on the <a href="portfolio.html">portfolio</a> page; let the auto-trader run the published strategies and
      read the outcome on <a href="analysis.html">analysis</a>.</li>
      <li>Check every number against the source link before acting. That is the point of the source column.</li>
    </ol>
  </div>

  <h2>6 · How to review this build</h2>
  <div class="panel">
    <ul>
      <li><a href="sources.html">Sources</a> — every document and endpoint, what it confirms and how it was verified.</li>
      <li><a href="flagged.html">Flagged for review</a> — every unverified value, limitation and repository irregularity.</li>
      <li><a href="questions.html">Questions and gaps</a> — what is known, what is open and where to look.</li>
      <li><a href="strategies.html">Strategies</a> — the exact rules behind the auto-trader and the ROI score.</li>
      <li><a href="COORDINATION.md">COORDINATION.md</a> — the task board, the claims, the verification log and the merge record.</li>
      <li><code>data/snapshot.json</code> — the raw captured payloads, for line-by-line checking.</li>
    </ul>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
