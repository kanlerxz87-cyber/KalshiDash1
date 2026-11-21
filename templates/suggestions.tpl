<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Suggestions — KalshiDash1</title>
<meta name="description" content="Concrete proposals for making the Kalshi demo dashboard more live and interactive, each with the reason it matters and the official source it relies on.">
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
      <h1>Suggestions</h1>
      <p class="sub">How to make the dashboard more live, more interactive and more useful for a trader deciding on a contract.
      Each proposal says what it changes, why it matters, and which official source it rests on.</p>
    </div>
  </div>

  <h2>Already built into this site</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th style="width:240px">Suggestion</th><th>What it does</th><th style="width:320px">Why it matters</th></tr></thead>
      <tbody>
        <tr><td><strong>Two scrolling chat panes</strong></td>
          <td>One pane posts every move ≥ $0.10, the other posts only the moves the ROI model likes. Both scroll, filter by topic
          and direction, and can be paused.</td>
          <td>A trader watches a screen instead of a table. The split keeps signal and noise apart instead of hiding the noise.</td></tr>
        <tr><td><strong>Resolution announcements</strong></td>
          <td>When a tracked market is determined, the chat posts the result — yes or no — with the settlement source.</td>
          <td>The brief asks to follow events until they resolve; the answer belongs in the same stream as the price moves.</td></tr>
        <tr><td><strong>Candidate source links</strong></td>
          <td>Every swing message links the market page, the event's official settlement source and the exact API row.</td>
          <td>One click from "something moved" to the page that decides the outcome.</td></tr>
        <tr><td><strong>Time-window chart</strong></td>
          <td>30 s, 1 min, 5 min, 15 min, 1 h, 6 h and 24 h windows on the same chart, with the alert threshold drawn in.</td>
          <td>The brief asks for a time axis with a selectable span and a price axis; the threshold line shows at a glance whether a
          move would have triggered an alert.</td></tr>
        <tr><td><strong>Order-book ladder</strong></td>
          <td>Contracts available at each price on both sides, with a depth bar.</td>
          <td>Answers "how many contracts are available at a given price" directly, and feeds the depth term of the ROI score.</td></tr>
        <tr><td><strong>Simulated strategy engine</strong></td>
          <td>Five published strategies run automatically against live prices, settle on resolution, and are ranked by result.</td>
          <td>Turns a tracker into something that produces testable strategies instead of just showing prices.</td></tr>
        <tr><td><strong>Topic isolation</strong></td>
          <td>Each topic has its own page with its series, open markets, liquidity and resolved events, and the topic pages are
          linked from the navigation.</td>
          <td>The brief asks to keep topics separate while keeping events grouped inside a topic.</td></tr>
        <tr><td><strong>Self-refreshing data</strong></td>
          <td>A GitHub Actions job re-captures the demo snapshot on a schedule, so the fallback data never drifts far from the market.</td>
          <td>A static site needs a live snapshot to stay useful when the browser cannot reach the API.</td></tr>
      </tbody>
    </table>
  </div>

  <h2>Next, in priority order</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th style="width:56px">#</th><th style="width:260px">Proposal</th><th>Detail</th><th style="width:120px">Impact</th><th style="width:120px">Effort</th></tr></thead>
      <tbody>
        <tr><td>1</td><td><strong>Real WebSocket feed</strong></td>
          <td>Subscribe to the <code>ticker</code>, <code>orderbook_delta</code> and <code>market_lifecycle_v2</code> channels for the
          tracked contracts. This removes the REST cache lag and gives true tick-level swings.</td>
          <td>High</td><td>Medium</td></tr>
        <tr><td>2</td><td><strong>Push alerts to the browser</strong></td>
          <td>Use the Web Notification API so a ≥ $0.10 move can be announced outside the tab, with the same ROI filter applied.</td>
          <td>High</td><td>Low</td></tr>
        <tr><td>3</td><td><strong>Backtest the strategies</strong></td>
          <td>Replay the captured candlestick history through each strategy to publish an expected win rate before the auto-trader
          is switched on.</td>
          <td>High</td><td>High</td></tr>
        <tr><td>4</td><td><strong>Spread and slippage on the fill</strong></td>
          <td>Record the depth at the fill price so the simulator can show the realistic fill, not just the touch price.</td>
          <td>Medium</td><td>Medium</td></tr>
        <tr><td>5</td><td><strong>Watchlist with target prices</strong></td>
          <td>Let the trader set a price level on a contract and have the chat shout when it is crossed, with the ROI score attached.</td>
          <td>Medium</td><td>Low</td></tr>
        <tr><td>6</td><td><strong>Alert log export</strong></td>
          <td>Download the captured alert history as CSV so a day of swings can be reviewed outside the browser.</td>
          <td>Medium</td><td>Low</td></tr>
        <tr><td>7</td><td><strong>Cross-topic comparison chart</strong></td>
          <td>Plot the ROI score of the leading contract in each topic over time, so the trader can see where activity is moving.</td>
          <td>Medium</td><td>Medium</td></tr>
        <tr><td>8</td><td><strong>Resolution calendar</strong></td>
          <td>A timeline of the tracked contracts' <code>close_time</code> and <code>expected_expiration_time</code> so the trader can
          see what resolves when.</td>
          <td>Medium</td><td>Low</td></tr>
        <tr><td>9</td><td><strong>Per-strategy risk limits</strong></td>
          <td>Cap exposure per strategy and per topic, and show the limit being consumed next to each open position.</td>
          <td>Medium</td><td>Medium</td></tr>
        <tr><td>10</td><td><strong>Shared portfolio across devices</strong></td>
          <td>Move the simulated trades off local storage into a hosted store, so a phone and a laptop see the same book.</td>
          <td>Low</td><td>High</td></tr>
      </tbody>
    </table>
  </div>

  <h2>What this session changed, and what it recommends next</h2>
  <div class="panel">
    <p class="small">Five rows used to top the high-ROI chat that <strong>could not have been traded at the price shown</strong>
    — a &ldquo;$0.01 → $0.97&rdquo; print on a market whose published YES ask was $0.01, and a &ldquo;$0.803 → $0.003&rdquo; print with
    no YES bid at all. A trader reading that pane would have been looking at noise. Two changes fix the class of problem, not just
    those rows: a <strong>follow-through gate</strong> (the quote has to sit where the swing ended, or the row is scored 0 and capped
    at 0.30) and <strong>contract counts beside every quote</strong> (a $0.97 ask &times; 0 contracts is not an offer). Both are
    checked by tests that were verified to fail on the old code. Details and every source link are in
    <a href="flagged.html#F-71">F-71</a>.</p>
    <p class="small">Recommended next, in the order that would most change what a trader can decide:</p>
    <ol class="small" style="padding-left:20px">
      <li><strong>Show the executable size on the chart.</strong> A price line says nothing about whether $0.10 of movement can be
      bought. Plotting the touch size (already published as <code>yes_bid_size_fp</code> / <code>yes_ask_size_fp</code>) as a second,
      low-contrast band would make &ldquo;real move or empty book&rdquo; a glance instead of a click.</li>
      <li><strong>Cap alerts per ticker per day, not just per 15 minutes.</strong> One contract produced most of the recorded feed
      (24 of 38 rows). The chat is readable today only because of the collapse rules; a daily cap would keep one flapping ticker
      from owning the pane.</li>
      <li><strong>Time-to-resolution on every row.</strong> <code>close_time</code> is already captured; sorting the panes by
      &ldquo;how long does this have left&rdquo; answers the question a trader actually asking about a stale-looking market.</li>
      <li><strong>Persist the alert history outside the repo.</strong> <code>data/live/feed.json</code> is capped at 200 rows and
      is rewritten on every job run, so today&rsquo;s alerts quietly push out yesterday&rsquo;s. An append-only CSV artifact would
      make the &ldquo;analyse the results by trade category&rdquo; part of the brief answerable over weeks rather than hours.</li>
    </ol>
  </div>

  <h2>What would make the charts simpler, not busier</h2>
  <div class="panel">
    <ul>
      <li>One number per chart — the current price and the change — with the axis doing the rest. No dual axes, no gauges.</li>
      <li>The threshold drawn as a single dashed line so "is this an alert?" is a glance, not a calculation.</li>
      <li>Sparklines in the tables instead of full charts: the full chart belongs on the market page only.</li>
      <li>Colour used only for direction and for status, so a green bar always means the same thing.</li>
      <li>Every chart captioned with the endpoint and the window it came from, so a reader can reproduce it.</li>
    </ul>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
