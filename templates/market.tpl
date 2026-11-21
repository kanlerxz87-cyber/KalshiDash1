<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Market detail — KalshiDash1</title>
<meta name="description" content="Price chart over time, order-book liquidity (contracts available at each price), settlement rules and the resolution state of one Kalshi demo market.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="market" data-base="{{BASE}}">
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
      <h1 id="m-title">Market</h1>
      <p class="sub"><code id="m-ticker"></code> · <span id="m-topic"></span> · <span id="m-status"></span> · <span id="m-result"></span></p>
    </div>
    <div class="btnrow"><a class="btn" href="dashboard.html">Back to dashboard</a></div>
  </div>

  <div class="grid cols-4">
    <div class="stat"><div class="label">Last price</div><div class="value" id="m-last">—</div><div class="note">last traded YES contract</div></div>
    <div class="stat"><div class="label">Bid / Ask</div><div class="value" id="m-bid">—</div><div class="note" id="m-ask">—</div></div>
    <div class="stat"><div class="label">24h volume</div><div class="value" id="m-vol">—</div><div class="note">contracts</div></div>
    <div class="stat"><div class="label">Open interest</div><div class="value" id="m-oi">—</div><div class="note">contracts</div></div>
  </div>

  <h2>Price over time</h2>
  <p class="sub">X axis is time, Y axis is the contract price in dollars. The window buttons change the time span;
  the dashed lines mark the swing-alert threshold and its mirror image.</p>
  <div class="chart-box">
    <div class="toolbar" style="margin:0 0 10px" id="window-btns"></div>
    <canvas id="price-chart" class="tall"></canvas>
    <div class="chart-legend">
      <span><i style="background:#00dd94"></i>YES contract price</span>
      <span><i style="background:#f5a524"></i>alert threshold</span>
      <span class="muted" id="m-liquidity">—</span>
      <span class="muted">ROI score: <b id="m-roi">—</b></span>
    </div>
  </div>

  <div class="grid cols-2">
    <div class="panel pad-0">
      <div style="padding:12px 14px 0"><h3 style="margin:0">Order book — contracts available at each price</h3>
      <p class="small muted" id="book-total">—</p></div>
      <div class="table-wrap" style="border:0;border-radius:0">
        <table class="ladder"><thead><tr>
          <th>YES bid</th><th class="num">Contracts</th><th>→ YES ask</th>
          <th>NO bid</th><th class="num">Contracts</th><th>→ YES ask</th><th></th></tr></thead>
          <tbody id="book-body"></tbody></table>
        <p class="small muted" style="padding:0 14px 12px">A YES ask is <code>1 − NO bid</code>, which is the
        relation the exchange documents for a binary book. Both executable sides are shown because a
        one-sided book (a bid with no offer, or an offer with no bid) means the headline price cannot be
        traded — that is exactly the condition the high-ROI model now refuses to score.</p>
      </div>
    </div>
    <div class="panel">
      <h3>Resolution — how this contract ended</h3>
      <p class="small" style="margin-top:0">Read from the exchange, never inferred. <code>result</code> is
        <code>yes</code>, <code>no</code> or <code>scalar</code> (<a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">Market Lifecycle</a>,
        <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a>).
        A blank cell means the exchange has not published a determination.</p>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><th>Result</th><td id="m-result-cell">—</td></tr>
            <tr><th>Settlement value</th><td id="m-settle-value">—</td></tr>
            <tr><th>Settled at</th><td id="m-settle-ts">—</td></tr>
            <tr><th>Rules</th><td class="small"><span id="m-rule-text">—</span></td></tr>
            <tr><th>Source</th><td id="m-settle-src" class="src">—</td></tr>
          </tbody>
        </table>
      </div>

      <h3>Contract &amp; settlement</h3>
      <dl class="kv">
        <dt>Closes at</dt><dd id="m-close">—</dd>
        <dt>Settled at</dt><dd id="m-settle">—</dd>
        <dt>ROI score</dt><dd id="m-roi2">—</dd>
        <dt>Sources</dt><dd id="m-sources">—</dd>
      </dl>
      <h3>Rules (as published by the exchange)</h3>
      <p class="small" id="m-rules" style="white-space:pre-wrap">—</p>
      <p class="small muted">Source endpoints:
      <code>GET /markets/{ticker}</code> ·
      <code>GET /markets/{ticker}/orderbook</code> ·
      <code>GET /series/{series}/markets/{ticker}/candlesticks</code>.
      See <a href="api.html">API reference</a>.</p>
    </div>
  </div>

  <h2>Simulated trade</h2>
  <div class="panel">
    <p class="small muted">This records a <strong>paper</strong> trade in your browser against the live price. It never sends an
    order to Kalshi. To place a real order on the demo exchange, use the
    <a href="demo-account.html">Demo account</a> page with your own API key.</p>
    <form id="trade-form" class="row" style="margin-top:10px">
      <div><label for="t-side">Side</label><select id="t-side"><option value="yes">Yes</option><option value="no">No</option></select></div>
      <div><label for="t-qty">Contracts</label><input type="number" id="t-qty" value="10" min="1" step="1"></div>
      <div><label for="t-strategy">Strategy</label><select id="t-strategy"></select></div>
      <div class="shrink"><button class="btn primary" type="submit">Record paper trade</button></div>
    </form>
    <p id="trade-msg" class="small"></p>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/app.js"></script>
<script src="assets/chart.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
