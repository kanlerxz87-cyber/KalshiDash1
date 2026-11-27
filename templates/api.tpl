<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API reference — KalshiDash1</title>
<meta name="description" content="The verified Kalshi demo API endpoints this dashboard uses, what each returns, how the data pipeline works, and the official documentation link for each.">
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
      <h1>API reference</h1>
      <p class="sub">The exact endpoints this dashboard calls, what each one returns, and the official documentation page for it.
      Nothing here is used that is not documented by Kalshi.</p>
    </div>
  </div>

  <h2>Environments</h2>
  <div class="table-wrap">
    <table class="compact">
      <thead><tr><th>Surface</th><th>Recommended demo endpoint</th><th>Also supported</th><th>Source</th></tr></thead>
      <tbody>
        <tr><td>REST Trade API</td><td><code>https://external-api.demo.kalshi.co/trade-api/v2</code></td><td><code>https://demo-api.kalshi.co/trade-api/v2</code></td>
          <td><a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo_env</a></td></tr>
        <tr><td>WebSocket API</td><td><code>wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2</code></td><td><code>wss://demo-api.kalshi.co/trade-api/ws/v2</code></td>
          <td><a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo_env</a></td></tr>
        <tr><td>Web app</td><td><code>https://demo.kalshi.co</code></td><td>—</td>
          <td><a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo_env</a></td></tr>
      </tbody>
    </table>
  </div>

  <h2>Public endpoints used by the live feed</h2>
  <div class="table-wrap">
    <table class="compact">
      <thead><tr><th>Endpoint</th><th>Used for</th><th>Key fields</th><th>Official doc</th></tr></thead>
      <tbody>
        <tr><td><code>GET /exchange/status</code></td><td>Probing whether the demo exchange is reachable from this browser.</td>
          <td><code>exchange_active</code>, <code>trading_active</code></td>
          <td><a href="https://docs.kalshi.com/api-reference/exchange/get-exchange-status" target="_blank" rel="noopener">Exchange status</a></td></tr>
        <tr><td><code>GET /search/tags_by_categories</code></td><td>The official category → tag taxonomy, used to select the golf series.</td>
          <td>category keys and their tag lists</td>
          <td><a href="https://docs.kalshi.com/api-reference/search/get-tags-for-series-categories" target="_blank" rel="noopener">Get Tags for Series Categories</a></td></tr>
        <tr><td><code>GET /series?category=…&amp;tags=…&amp;include_volume=true</code></td><td>Topic discovery for all five topics.</td>
          <td><code>ticker</code>, <code>title</code>, <code>category</code>, <code>tags</code>, <code>volume_fp</code>,
          <code>settlement_sources</code>, <code>contract_terms_url</code></td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-series-list" target="_blank" rel="noopener">Get Series List</a></td></tr>
        <tr><td><code>GET /markets?series_ticker=…&amp;status=open</code></td><td>The open markets of each series, with their topic.</td>
          <td><code>ticker</code>, <code>event_ticker</code>, <code>status</code>, <code>result</code>, <code>last_price_dollars</code>,
          <code>yes_bid_dollars</code>, <code>yes_ask_dollars</code>, <code>no_bid_dollars</code>, <code>yes_bid_size_fp</code>,
          <code>yes_ask_size_fp</code>, <code>volume_fp</code>, <code>volume_24h_fp</code>, <code>open_interest_fp</code>,
          <code>notional_value_dollars</code>, <code>close_time</code>, <code>expected_expiration_time</code>,
          <code>settlement_ts</code>, <code>rules_primary</code></td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets</a></td></tr>
        <tr><td><code>GET /markets?tickers=…</code></td><td>Batch price refresh that drives the swing alerts.</td>
          <td>the same market fields, for every requested ticker in one response</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets</a></td></tr>
        <tr><td><code>GET /markets/{ticker}</code></td><td>The market detail page and the resolution state of one contract.</td>
          <td>the market object, including <code>rules_primary</code> and <code>settlement_value_dollars</code></td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market" target="_blank" rel="noopener">Get Market</a></td></tr>
        <tr><td><code>GET /markets/{ticker}/orderbook?depth=20</code></td><td>The liquidity ladder and the depth term of the ROI score.</td>
          <td><code>orderbook_fp.yes_dollars</code>, <code>orderbook_fp.no_dollars</code> — arrays of
          <code>[price_dollars, contract_count_fp]</code></td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market-orderbook" target="_blank" rel="noopener">Get Market Orderbook</a></td></tr>
        <tr><td><code>GET /series/{series_ticker}/markets/{ticker}/candlesticks</code></td>
          <td>The price chart and the replayed swing alerts in snapshot mode.</td>
          <td><code>end_period_ts</code>, <code>price.close_dollars</code>, <code>volume_fp</code>, <code>open_interest_fp</code>;
          <code>period_interval</code> is 1, 60 or 1440 minutes</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market-candlesticks" target="_blank" rel="noopener">Get Market Candlesticks</a></td></tr>
        <tr><td><code>GET /events?series_ticker=…&amp;status=settled&amp;with_nested_markets=true</code></td>
          <td>The resolved-event tables and the resolution log.</td>
          <td><code>event_ticker</code>, <code>title</code>, <code>settlement_ts</code>, <code>settlement_sources</code> and the
          nested markets with their <code>result</code> and <code>settlement_value_dollars</code></td>
          <td><a href="https://docs.kalshi.com/api-reference/events/get-events" target="_blank" rel="noopener">Get Events</a></td></tr>
      </tbody>
    </table>
  </div>

  <h2>Authenticated endpoints (used only on the Demo account page)</h2>
  <div class="table-wrap">
    <table class="compact">
      <thead><tr><th>Endpoint</th><th>Used for</th><th>Official doc</th></tr></thead>
      <tbody>
        <tr><td><code>GET /portfolio/balance</code></td><td>Demo cash balance.</td>
          <td><a href="https://docs.kalshi.com/api-reference/portfolio/get-balance" target="_blank" rel="noopener">Get Balance</a></td></tr>
        <tr><td><code>GET /portfolio/positions</code></td><td>Open positions and realised P&amp;L per market.</td>
          <td><a href="https://docs.kalshi.com/api-reference/portfolio/get-positions" target="_blank" rel="noopener">Get Positions</a></td></tr>
        <tr><td><code>GET /portfolio/fills</code></td><td>Recent fills.</td>
          <td><a href="https://docs.kalshi.com/api-reference/portfolio/get-fills" target="_blank" rel="noopener">Get Fills</a></td></tr>
        <tr><td><code>GET /portfolio/settlements</code></td><td>Recent settlements.</td>
          <td><a href="https://docs.kalshi.com/api-reference/portfolio/get-settlements" target="_blank" rel="noopener">Get Settlements</a></td></tr>
        <tr><td><code>POST /portfolio/events/orders</code></td>
          <td>Documented but <strong>not</strong> called by this site — see <a href="flagged.html">F-07</a>.</td>
          <td><a href="https://docs.kalshi.com/api-reference/orders/create-order-v2" target="_blank" rel="noopener">Create Order (V2)</a></td></tr>
      </tbody>
    </table>
  </div>

  <h2>How the data pipeline works</h2>
  <div class="panel">
    <ol>
      <li><strong>Discovery.</strong> For each topic, the series query runs and the documented selection rule is applied
      (see each topic page). The series are ranked by <code>volume_fp</code> and the top 30 are kept.</li>
      <li><strong>Universe.</strong> The open markets of those series are fetched with
      <code>GET /markets?series_ticker=…&amp;status=open</code>, and each market is tagged with its topic and with the series'
      official settlement sources.</li>
      <li><strong>Refresh.</strong> Every few seconds the tracked tickers are re-read in batches of 40 with
      <code>GET /markets?tickers=…</code>. Each new observation is compared with the previous one.</li>
      <li><strong>Alerts.</strong> A move of at least the threshold (default $0.10) posts a message to the chat panes, with a
      60-second cooldown per ticker and direction. A status change to <code>determined</code> or <code>finalized</code> with a
      result of yes or no posts a resolution message.</li>
      <li><strong>Fallback.</strong> If the API cannot be reached, the committed snapshot is loaded instead and the site says so in
      the header badge and the notice at the top of every page.</li>
    </ol>
  </div>

  <h2>Fixed-point values</h2>
  <div class="panel">
    <p>Counts and prices arrive as fixed-point strings — <code>volume_fp</code>, <code>open_interest_fp</code>,
    <code>yes_bid_size_fp</code> and the <code>*_dollars</code> fields. The site converts them to numbers for display and shows
    four decimal places for prices, matching the precision the exchange publishes.
    Reference: <a href="https://docs.kalshi.com/getting_started/fixed_point_migration" target="_blank" rel="noopener">Fixed Point Migration</a>.</p>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
