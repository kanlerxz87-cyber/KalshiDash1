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
      Each proposal identifies the supporting data/mechanics and clearly labels project judgments; no proposal is exchange-endorsed.</p>
    </div>
  </div>

  <h2>Implemented, with explicit limits</h2>
  <p class="small muted">Implementation descriptions and recommendations below are project-authored. Official links define the data/mechanics; they do not validate a strategy, endorse a proposal or verify a simulated fill.</p>
  <div class="table-wrap"><table><thead><tr><th>Feature</th><th>What it does</th><th>Why it matters</th><th>Publisher / field semantics</th></tr></thead><tbody>
    <tr><td><strong>Two scrolling alert chats</strong></td><td>Observed ≥ $0.10 moves and a model-filtered subset. REST sampling can miss intervening moves; a research score is not a forecast of ROI.</td><td>Keeps raw observations visible instead of hiding them behind a model.</td><td><a href="https://docs.kalshi.com/api-reference/market/get-market">Market quote fields</a></td></tr>
    <tr><td><strong>Finalization tracking</strong></td><td>The browser keeps closed/determined positions under observation and realizes corrected paper P&L only after finalized binary results.</td><td>A provisional result can still be disputed.</td><td><a href="https://docs.kalshi.com/getting_started/market_lifecycle">Market lifecycle</a></td></tr>
    <tr><td><strong>Source links, not invented causes</strong></td><td>Jump rows link the published observations and event. News/research searches and settlement-source strings are not proof of a catalyst.</td><td>Separates a price change from an explanation.</td><td><a href="https://docs.kalshi.com/api-reference/market/get-series-list">Settlement-source field definitions</a></td></tr>
    <tr><td><strong>Time-window chart</strong></td><td>Selectable seconds, minutes and hours. Gold markers identify actual ≥ $0.10 differences; snapshot axes end at capture time. REST history is at least one minute.</td><td>A $0.10 change is not an absolute $0.10 price level.</td><td><a href="https://docs.kalshi.com/api-reference/market/get-market-candlesticks">Candle periods and timestamps</a></td></tr>
    <tr><td><strong>Quantity-aware book and paper entry</strong></td><td>Published bid levels, complementary asks and contract counts. A paper order requires the whole requested count at a fresh ask; no last-price fill.</td><td>Makes missing/insufficient size a visible rejection, not an assumed execution.</td><td><a href="https://docs.kalshi.com/getting_started/orderbook_responses">Bid/ask reciprocity and equal quantity</a></td></tr>
    <tr><td><strong>Automatic paper strategies</strong></td><td>Five project rules run while a tab is open, subject to project risk caps. Gross results exclude fees, impact, queue and latency. Legacy records are excluded from canonical performance.</td><td>Provides inspectable hypotheses, not certified account performance.</td><td><a href="https://docs.kalshi.com/getting_started/market_settlement">Binary payout semantics, not strategy validation</a></td></tr>
    <tr><td><strong>Five topic pages</strong></td><td>Gas prices, elections, culture, crypto and golf stay separate; event/market identifiers link related contracts. Discovery is a capped sample, not a complete exchange ranking.</td><td>Keeps the requested scope visible.</td><td><a href="https://docs.kalshi.com/api-reference/market/get-series-list">Discovery categories/tags</a></td></tr>
    <tr><td><strong>Timestamped fallback and recovery</strong></td><td>Scheduled jobs attempt to refresh captures. The site displays their sample ages and retries public API access automatically; schedules can be delayed or fail.</td><td>Never equates page refresh with exchange freshness.</td><td><a href="https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule">GitHub scheduling limits</a></td></tr>
  </tbody></table></div>
  <h2>Proposals — project priority/effort estimates, not verified outcomes</h2>
  <div class="table-wrap"><table><thead><tr><th>#</th><th>Proposal</th><th>Detail</th><th>Impact estimate</th><th>Effort estimate</th><th>Publisher / prerequisite</th></tr></thead><tbody>
    <tr><td>1</td><td><strong>One primary alert console</strong></td><td>Prefer one main console and keep secondary research views collapsed. The 0–1 engine score and 0–100 browser research score use different formulas and must not be compared directly.</td><td>High</td><td>Low</td><td><a href="https://github.com/kanlerxz87-cyber/KalshiDash1/blob/main/docs/ALERTS.md">Project method; no exchange endorsement</a></td></tr>
    <tr><td>2</td><td><strong>Server-held WebSocket relay</strong></td><td>An authenticated server could relay ticker/orderbook/lifecycle observations to the static site. Never put a private key in the browser; authentication and reliable reconnect/gap recovery still need implementation.</td><td>High</td><td>High</td><td><a href="https://docs.kalshi.com/getting_started/quick_start_websockets">Authenticated WebSocket handshake</a></td></tr>
    <tr><td>3</td><td><strong>Optional browser notifications</strong></td><td>Notify outside the visible tab only after the visitor grants permission. Respect the same topic/model filters and avoid claiming guaranteed delivery.</td><td>Medium</td><td>Medium</td><td><a href="https://notifications.spec.whatwg.org/">WHATWG Notifications standard</a></td></tr>
    <tr><td>4</td><td><strong>Out-of-sample strategy evaluation</strong></td><td>Preserve quotes and quantities as well as candles; candles alone cannot reproduce historical executable depth. Include fees and report uncertainty rather than promise an expected win rate.</td><td>High</td><td>High</td><td><a href="https://docs.kalshi.com/api-reference/market/get-market-candlesticks">Candle data limitations</a></td></tr>
    <tr><td>5</td><td><strong>Fees and execution stress tests</strong></td><td>Extend the current ask/size model with measured fees, queue/latency and impact scenarios. Do not label hypothetical fills realistic without validation.</td><td>High</td><td>High</td><td><a href="https://docs.kalshi.com/getting_started/orderbook_responses">Published book is not a fill guarantee</a></td></tr>
    <tr><td>6</td><td><strong>Saved watchlist and target prices</strong></td><td>Optional personal target alerts with visible reference/basis and observation time. Keep the requested ≥ $0.10 feed as the default instead of hiding it behind settings.</td><td>Medium</td><td>Low</td><td><a href="https://docs.kalshi.com/api-reference/market/get-market">Quote/status fields</a></td></tr>
    <tr><td>7</td><td><strong>Durable, source-linked export</strong></td><td>Archive observations separately from mutable model scores, with endpoint, sample time and model version. Clearly distinguish browser-local exports from complete exchange history.</td><td>High</td><td>Medium</td><td><a href="https://docs.kalshi.com/api-reference/market/get-trades">Official trade-history schema</a></td></tr>
    <tr><td>8</td><td><strong>Event-first resolution timeline</strong></td><td>Group contracts under their event and show close, expected expiration and final settlement separately; close time is not a promised payout time.</td><td>Medium</td><td>Medium</td><td><a href="https://docs.kalshi.com/getting_started/market_lifecycle">Lifecycle and settlement timing</a></td></tr>
    <tr><td>9</td><td><strong>Per-topic and per-strategy budgets</strong></td><td>Add explicit project sub-limits to the existing global paper-risk caps. These would be model policies, not account cash or exchange restrictions.</td><td>Medium</td><td>Medium</td><td><a href="https://github.com/kanlerxz87-cyber/KalshiDash1/blob/main/assets/paper.js">Project risk policy</a></td></tr>
    <tr><td>10</td><td><strong>Private cross-device paper history</strong></td><td>An opt-in hosted store could sync hypothetical trades, with retention/deletion controls. Keep authentication secrets on a server and distinct from public account snapshots.</td><td>Low</td><td>High</td><td><a href="https://docs.kalshi.com/getting_started/quick_start_authenticated_requests">Authenticated request requirements</a></td></tr>
  </tbody></table></div>

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
      <li>Gold markers only on observed ≥ $0.10 changes, with an adjacent sourced row — no absolute 10-cent/90-cent threshold lines.</li>
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
