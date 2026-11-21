<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulated portfolio — KalshiDash1</title>
<meta name="description" content="Simulated Kalshi demo portfolio: paper trades, realised and unrealised P&amp;L, win rate, exposure, equity curve and the auto-trader that runs the published strategies.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="portfolio" data-base="{{BASE}}">
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
      <h1>Simulated portfolio</h1>
      <p class="sub">An explicitly hypothetical model using observed demo asks and confirmed quantities. Positions are held until the exchange publishes <code>finalized</code> with a binary result. Gross results are not account returns.
      <strong>No real order is ever sent from this site.</strong> For your actual demo account, see
      <a href="demo-account.html">Demo account</a>.</p>
    </div>
    <div class="btnrow">
      <button class="btn" id="reset-trades">Clear simulated trades</button>
    </div>
  </div>

  <div id="mode-notice" class="notice">Probing the official demo API…</div>

  <div id="paper-notice" class="notice" role="status"></div>
  <div class="grid cols-4" id="portfolio-stats"></div>

  <h2>Equity curve</h2>
  <div class="chart-box">
    <canvas id="equity-chart" class="short"></canvas>
    <div class="chart-legend"><span><i style="background:#4c9aff"></i>cumulative gross P&amp;L at final settlement time (or explicitly recorded observation time)</span></div>
  </div>

  <h2>Auto-trader</h2>
  <div class="panel">
    <div class="row">
      <div class="shrink"><label class="switch"><input type="checkbox" id="auto-trade"> Run the published strategies automatically</label></div>
      <div><p class="small muted" style="margin:0">Each strategy is defined with exact thresholds on
      <a href="strategies.html">Strategies</a>. The auto-trader opens one paper position per market per strategy, fills at the
      observed ask only when its whole quantity is available, and settles only at finalization. It runs while a canonical-site tab is open, not in the background.</p></div>
    </div>
  </div>

  <h2>Trade log</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Time</th><th>Market</th><th>Topic</th><th>Side</th><th class="num">Contracts</th><th class="num">Entry</th><th class="num">Side bid (mark)</th><th>Strategy</th><th>Gross P&amp;L / model status</th><th>Result</th><th>Source</th></tr></thead>
      <tbody id="portfolio-trades"></tbody>
    </table>
  </div>

  <h2>How the settlement rule is applied</h2>
  <div class="panel">
    <ul>
      <li>On a <strong>yes</strong> outcome the YES holders receive $1.00 per contract; on a <strong>no</strong> outcome the NO
      holders receive $1.00 per contract — <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a>.</li>
      <li>A paper trade is settled only when the market reaches <code>finalized</code> with a result of
      yes or no — <a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">Market Lifecycle</a>.</li>
      <li>Realised P&amp;L = (payout − entry price) × contracts. Fees are not applied: Kalshi states settlement fees are zero for
      simple yes/no determinations, and the simulator does not model a trading fee.</li>
      <li>Mark-to-market uses the purchased side’s fresh bid with sufficient size; if any open position lacks one, the total stays blank. Neither a quote nor a paper fill is an exchange execution.</li>
    </ul>
    <p class="small muted">Trades are stored in this browser only. Legacy fills are retained but excluded from the corrected model’s statistics. Project caps: 50 open positions and $1,000 open entry cost (not demo-account cash); 15-second maximum local quote age. Queue position, impact and trading fees are not modeled. Clearing browser data removes this history.</p>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="assets/chart.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
