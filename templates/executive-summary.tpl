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
      <h1>Executive summary</h1>
      <p class="sub">What was built, what the verified data shows, what it cannot show, and how a trader uses it.
      Snapshot {{SNAPSHOT_CAPTURED}}. Every claim below links to its official source.</p>
    </div>
    <div class="btnrow"><a class="btn primary" href="dashboard.html">Open the live dashboard</a></div>
  </div>

  <aside class="notice good" aria-label="Current operational status">
    <strong>Operational status · verified 2026-11-27 22:40 UTC (session-8e28c889).</strong>
    The alert feed is current again: <code>data/live/feed.json</code> was generated at
    <code>2026-11-27T22:26:30Z</code> — 2.3 minutes old at verification — and the committed snapshot at
    <code>2026-11-27T22:26:41Z</code>. The advance came from one dispatched
    <a href="https://github.com/kanlerxz87-cyber/KalshiDash1/actions/runs/46076632008">keepalive run</a>,
    not from a schedule fix: GitHub's <code>schedule</code> delivery here is sparse (10 runs in 24 h, tracked as
    <a href="flagged.html">F-83</a>), so the feed ages again when nothing dispatches it. Read the age badge, not the
    word "live". The demo-account snapshot is still disconnected (<code>connected: false</code>), and the paper
    simulator is not exchange execution. Evidence:
    <a href="verification/2026-11-27-8e28c889.md">dated verification report</a>.
  </aside>

  <aside class="notice warn" aria-label="Earlier operational status, kept as history">
    <strong>Historical · status at 2026-11-27 22:25 UTC (session-a1ded21f), kept verbatim.</strong>
    At that moment the committed feed was generated at <code>2026-11-27T17:34:38Z</code> and measured 290.2 minutes
    old, beyond the 45-minute stale threshold; its 122 alerts, 41 resolutions and 14 awaiting rows were a
    historical sample. The snapshot then in force was <code>2026-11-27T17:41:59Z</code>.
    <a href="verification/2026-11-27-a1ded21f.md">That report</a> is retained unchanged; only its freshness lines
    were superseded, 68 seconds later, by the pulse above.

  <aside class="notice warn" aria-label="Current operational status">
    <strong>Operational status · verified 2026-11-27 22:25 UTC.</strong>
    The committed alert feed was generated at <code>2026-11-27T17:34:38Z</code> and was 290.2 minutes old at verification,
    beyond the 45-minute stale threshold. Treat its prices and counts as a historical sample, not current quotes.
    The most recent captured market snapshot is <code>2026-11-27T17:41:59Z</code>. The demo-account snapshot is
    disconnected (<code>connected: false</code>); the paper simulator is not exchange execution. See the
    <a href="verification/2026-11-27-a1ded21f.md">dated verification report</a> and
    <a href="flagged.html">Flagged for Review</a> for limitations and source links.
  </aside>

  <h2>1 · What was built</h2>
  <div class="panel">
    <p>A single, static, dependency-free dashboard for Kalshi's official <strong>demo</strong> exchange, published on GitHub
    Pages. It ranks sampled live events in exactly the five requested topics — gas prices, elections, culture, crypto
    and golf — follows alerted markets toward resolution and turns observed price action into a
    live alerting system.</p>
    <ul>
      <li><strong>Two scrolling chats.</strong> The left pane posts every tracked contract that moves at least $0.10 in either
      direction. The right pane posts only the moves the published ROI model likes. Both carry the official settlement source that
      decides the outcome, so a swing can be investigated in one click.</li>
      <li><strong>Resolution tracking.</strong> Every contract this engine alerts on stays on a follow list until the exchange
      publishes <code>result</code> — <code>yes</code>, <code>no</code> or <code>scalar</code> — with its
      <code>settlement_ts</code> and <code>settlement_value_dollars</code>. Unanswered contracts are listed under
      <a href="alerts/index.html#await-table">Followed to resolution</a>; answered ones move to the resolved table and to the
      resolution block on each market page. Both lists are read from the API, never inferred (see F-70 on
      <a href="flagged.html">Flagged for Review</a> for the two retention/retrieval defects this replaced).</li>
      <li><strong>Price and liquidity.</strong> Gold markers and source-linked rows identify observed ≥ $0.10 changes; missing news causes stay unverified. Snapshot times are never relabelled as current.  A time-series chart with selectable 30-second to 24-hour windows, a price axis, and
      an order-book ladder that answers "how many contracts are available at this price".</li>
      <li><strong>Simulated trading.</strong> Five project-authored strategies run automatically while a tab is open, using fresh observed asks with confirmed quantities. No fills are invented from a snapshot or a missing quote. They hold to final settlement and are grouped by strategy and topic. Gross P&amp;L excludes fees, impact and legacy/unverified fills; no profitable ROI is claimed. See <a href="flagged.html#F-PAPER-01">paper-model limits</a>.</li>
      <li><strong>Demo-account access is not connected; do not enable it on this public site yet.</strong> A GitHub Actions job
      (<code>tools/demo_trader.mjs</code>) is designed to sign account reads with repository secrets and write
      <code>data/account.json</code>, but GitHub Pages serves that file publicly. If enabled now, balances, positions, fills and settlements
      would be published. The current snapshot remains <code>connected: false</code> with no capture time. Do not add account secrets
      until an access-controlled private data path is in place; see <a href="flagged.html#F-85">Flagged for Review F-85</a>.
      The browser cannot sign requests itself because the demo API's preflight does not allow the three
      <code>KALSHI-ACCESS-*</code> headers (measured, <a href="flagged.html#F-66">F-66</a>).</li>
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
      <li>Markets resolve with <code>yes</code>, <code>no</code> or <code>scalar</code>. For a simple binary contract, a
      <strong>yes</strong> outcome pays YES holders $1 per contract and a <strong>no</strong> outcome pays NO holders $1 per
      contract. A <code>scalar</code> market pays the value it settles at (minus any settlement floor for YES), not a flat
      $1.00, so this site never prices a scalar contract as a binary win/loss — see
      <a href="flagged.html#F-84">F-84</a>.
      <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Settlement</a> ·
      <a href="https://docs.kalshi.com/getting_started/settlement_bounds" target="_blank" rel="noopener">Settlement Bounds</a> ·
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
      <li><strong>Why a contract moved.</strong> The Kalshi API publishes no news feed. The chart links the published price observations, the event and separately labeled research sources. A settlement source is not evidence that it caused a move; verified causes stay blank.</li>
      <li><strong>Sub-minute history from the API.</strong> Candlestick periods are 1, 60 or 1440 minutes; seconds resolution exists
      only while a page is open.</li>
      <li><strong>A real portfolio without a key.</strong> The committed account snapshot says <code>connected: false</code> with no capture time; the
      demo-account page shows the demo-account snapshot that a GitHub Actions job produces from repository secrets. A browser
      cannot read the account itself: the demo host's CORS preflight does not allow the <code>KALSHI-ACCESS-*</code>
      headers a signed request needs (measured 2026-11-21 &mdash; <a href="flagged.html#F-66">F-66</a>). Repository-secret configuration could not be enumerated by this integration token (403), so it is not asserted absent. In the current account snapshot no balance or account trade is verified: the portfolio figures are simulated and labelled as such, and
      <code>data/account.json</code> records <code>connected: false</code>.</li>
      <li><strong>A live order feed from the exchange.</strong> Kalshi's WebSocket handshake requires a signed API-key request
      (<a href="https://docs.kalshi.com/getting_started/quick_start_websockets" target="_blank" rel="noopener">Quick Start:
      WebSockets</a>), so a static site cannot stream ticks. Alerts come from a scheduled REST sampler plus in-browser polling;
      the header badge always states the measured age of the newest sample.</li>
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
      <li>View the simulated trades on the <a href="portfolio.html">portfolio</a> page; let the auto-trader run the published strategies and
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
      <li><code>data/snapshot.json</code> — the normalized captured API values and exact source URLs, for review (not the original raw HTTP bodies).</li>
    </ul>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
