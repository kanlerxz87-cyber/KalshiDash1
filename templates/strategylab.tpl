<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strategy lab — KalshiDash1</title>
<meta name="description" content="Categorise simulated Kalshi trades, analyse performance by strategy/topic/entry-price/holding period, and synthesise strategy rules from the observed trade types.">
<link rel="stylesheet" href="assets/style.css">
<link rel="stylesheet" href="assets/strategylab.css">
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
<h1>Strategy lab</h1>
<p class="lead">Categorise every simulated trade recorded in this browser, analyse performance by
<strong>strategy, topic, entry-price band and holding period</strong>, and <strong>synthesise strategy rules
from the type of trade</strong> that actually won. All data is simulated — no orders are placed, no
credentials are used, and every computed metric is labelled. Values that are not recorded stay blank.</p>

<div class="cards" id="lab-cards"></div>

<h2>Trade stores detected in this browser</h2>
<div id="stores"></div>

<h2>Trade categorisation &amp; log</h2>
<div class="controls">
  <label>Topic <select id="f-topic"></select></label>
  <label>Strategy <select id="f-strategy"></select></label>
  <label class="check"><input type="checkbox" id="f-seed" checked> include seeded example rows</label>
  <button id="export-json" class="btn">Export normalised JSON (kalshidash:trades:v2)</button>
</div>
<div id="trade-table"></div>

<h2>Performance analysis</h2>
<div id="stat-tables"></div>

<h2>Strategy synthesis (from the type of trade)</h2>
<p class="muted small">Rule hypotheses are generated from cells of the categorised trade log where at least 3 settled
trades show ≥ 60% wins and positive average P&amp;L. They are hypotheses from simulated data — not verified
performance, not financial advice.</p>
<div id="synthesis"></div>

<h2>Published trade schema — <code>kalshidash:trades:v2</code></h2>
<p class="muted small">Auto-trade engines and manual simulators can write records in this shape to the
<code>localStorage</code> key <code>kalshidash:trades:v2</code> (array of records, or <code>{"schema":"kalshidash:trades:v2","trades":[…]}</code>)
and this page will ingest them automatically. Field names follow the official API spelling
(<code>*_fp</code> quantities, <code>*_dollars</code> prices —
<a href="https://docs.kalshi.com/getting_started/fixed_point_migration" target="_blank" rel="noopener">Fixed-Point Representation ↗</a>).
Blanks are allowed and are never filled in.</p>
<div class="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Meaning</th><th>Official source for the semantics</th></tr></thead><tbody>
<tr><td><code>schema</code></td><td>string</td><td>Record-set tag: <code>kalshidash:trades:v2</code></td><td>This page (session-7f90cf50)</td></tr>
<tr><td><code>id</code></td><td>string</td><td>Trade id, unique within the store</td><td>This page</td></tr>
<tr><td><code>ts_open</code> / <code>ts_close</code></td><td>ISO 8601 string</td><td>Open / close timestamps (close blank while open)</td><td>This page</td></tr>
<tr><td><code>ticker</code></td><td>string</td><td>Market ticker the trade references</td><td><a href="https://docs.kalshi.com/api-reference/market/get-market" target="_blank" rel="noopener">Get Market ↗</a></td></tr>
<tr><td><code>event_ticker</code> / <code>series_ticker</code></td><td>string</td><td>Parent event / series tickers</td><td><a href="https://docs.kalshi.com/api-reference/events/get-events" target="_blank" rel="noopener">Get Events ↗</a></td></tr>
<tr><td><code>title</code></td><td>string</td><td>Market title as returned by the API</td><td><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets ↗</a></td></tr>
<tr><td><code>topic</code></td><td>gas | elections | culture | crypto | golf | other</td><td>Focus-topic tag (client-side heuristic on API category/title fields)</td><td>Heuristic — see flag F-62 on <a href="flagged.html#F-62">the flagged page</a> (Get Events documents no <code>category</code> parameter; client-side heuristic only)</td></tr>
<tr><td><code>strategy</code></td><td>string</td><td>Strategy tag used by the producing engine (e.g. momentum, mean-reversion, hold-to-resolution)</td><td>This page / producing engine</td></tr>
<tr><td><code>order_side</code></td><td>bid | ask</td><td>The Create Order (V2) <code>side</code> value (single-book bid/ask). Informational — P&amp;L below is computed from entry/exit/result, not from this field.</td><td><a href="https://docs.kalshi.com/api-reference/orders/create-order-v2" target="_blank" rel="noopener">Create Order (V2) ↗</a></td></tr>
<tr><td><code>outcome</code></td><td>yes | no</td><td>Which binary side of the market the position is on</td><td><a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement ↗</a></td></tr>
<tr><td><code>count_fp</code></td><td>string (2 dp)</td><td>Contract quantity, fixed-point string (e.g. "10.00")</td><td><a href="https://docs.kalshi.com/getting_started/fixed_point_migration" target="_blank" rel="noopener">Fixed-Point Representation ↗</a></td></tr>
<tr><td><code>entry_price_dollars</code> / <code>exit_price_dollars</code></td><td>string (≤4 dp)</td><td>Prices in fixed-point dollars ("0.5600"). Exit blank while open.</td><td><a href="https://docs.kalshi.com/getting_started/fixed_point_migration" target="_blank" rel="noopener">Fixed-Point Representation ↗</a></td></tr>
<tr><td><code>status</code></td><td>open | closed | settled</td><td><em>Simulated trade</em> lifecycle (not the market status enum)</td><td>This page</td></tr>
<tr><td><code>result</code></td><td>yes | no | ""</td><td>Market settlement result once determined</td><td><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets schema (<code>result</code>) ↗</a></td></tr>
<tr><td><code>pnl_dollars</code></td><td>string | blank</td><td>P&amp;L as recorded by the producing engine (never filled in here)</td><td>Producing engine</td></tr>
<tr><td><code>fees_dollars</code></td><td>string | blank</td><td>Fees as recorded by the producing engine</td><td>Producing engine</td></tr>
<tr><td><code>engine</code> / <code>seed</code> / <code>notes</code></td><td>string / bool / string</td><td>Provenance: which engine wrote the row; whether it is a seeded example; free-form notes</td><td>This page</td></tr>
</tbody></table></div>

<h2>Method &amp; limits (read before using any number)</h2>
<div class="panel">
<ul>
  <li><strong>Simulation only.</strong> Real order placement is <code>POST /portfolio/events/orders</code> with signed auth headers
  (<a href="https://docs.kalshi.com/api-reference/orders/create-order-v2" target="_blank" rel="noopener">Create Order (V2) ↗</a>); this site never calls it.
  Tracking a real demo account needs the account holder's API key, which is deliberately not requested or stored
  (see <a href="questions.html">Questions &amp; answers</a>).</li>
  <li><strong>Settlement semantics</strong> used for computed P&amp;L: winning side receives $1 per contract; <code>result</code> = yes/no
  (<a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement ↗</a>).</li>
  <li><strong>Recorded vs computed.</strong> Where both exist and differ by more than $0.02 the row is flagged — differences are reported, never silently reconciled.</li>
  <li><strong>Seeded rows</strong> (marked <span class="badge warn">seed</span>) are pre-loaded examples from the dash/ suite store; exclude them with the filter above for clean analysis.</li>
  <li><strong>Synthesis is descriptive, not predictive.</strong> Rule hypotheses are generated from small simulated samples; demo prices may not reflect real markets
  (<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo env ↗</a>). No backtest returns are claimed anywhere on this page.</li>
</ul>
</div>

<div class="foot">KalshiDash1 · Strategy lab (session-7f90cf50) · Simulated-data analysis for the Kalshi <strong>demo</strong> environment. Not financial advice.</div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/app.js"></script>
<script src="assets/strategylab.js" defer></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
