<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo account — KalshiDash1</title>
<meta name="description" content="Kalshi demo account: balance, positions, fills and settlements, read from data/account.json. The browser never sees API keys.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="demo-account">
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
<h1>Demo account: portfolio tracking &amp; trade execution</h1>
<p class="lead">This page tracks the <strong>real Kalshi demo account</strong> (balance, positions, fills, settlements)
and documents the verified trade-execution path. It is fed by <code>tools/demo_trader.mjs</code> from
<code>data/account.json</code> — the browser never sees API keys. Session record:
<a href="verification/2026-11-20-d5b935f4.md">verification/2026-11-20-d5b935f4.md</a> · setup guide:
<a href="docs/DEMO_ACCOUNT.md">docs/DEMO_ACCOUNT.md</a>.</p>

<div class="notice" id="conn-status"><strong>Connection status: checking <code>data/account.json</code>…</strong></div>

<h2 id="account">Account snapshot (verbatim API responses)</h2>
<p class="muted small">Rows are rendered exactly as returned by the official API (raw JSON keys as column headers).
Nothing is inferred or filled in. If a value cannot be confirmed it stays blank and is listed on
<a href="flagged.html">Flagged for review</a>.</p>
<div id="account-data"><p class="muted">No account snapshot loaded.</p></div>
<p class="muted small">Raw file: <a href="data/account.json">data/account.json</a> · every response records its exact
endpoint under <code>source_urls</code>.</p>

<h2 id="endpoints">Verified endpoints (this execution path)</h2>
<div class="table-wrap"><table class="compact"><thead><tr><th>Item</th><th>Verified value</th><th>Official source</th><th>Status</th></tr></thead><tbody>
<tr><td>Portfolio reads</td><td><code>GET /portfolio/balance</code> · <code>/portfolio/positions</code> · <code>/portfolio/fills?limit=200</code> · <code>/portfolio/settlements?limit=200</code>, signed</td><td><a href="https://docs.kalshi.com/getting_started/api_keys.md" target="_blank" rel="noopener">API Keys ↗</a> · <a href="https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md" target="_blank" rel="noopener">Authenticated Requests ↗</a></td><td><span class="badge ok">Documented</span></td></tr>
<tr><td>Create order</td><td><code>POST /portfolio/events/orders</code> with <code>ticker</code>, <code>side: "bid"</code>, <code>count</code>, <code>price</code> (4-decimal dollars), <code>time_in_force: "good_till_canceled"</code>, <code>self_trade_prevention_type: "taker_at_cross"</code>, <code>client_order_id</code></td><td><a href="https://docs.kalshi.com/getting_started/quick_start_create_order.md" target="_blank" rel="noopener">Quick Start: Create your first order ↗</a></td><td><span class="badge ok">Documented</span></td></tr>
<tr><td>Signing</td><td><code>KALSHI-ACCESS-KEY</code> / <code>-SIGNATURE</code> / <code>-TIMESTAMP</code>; timestamp in <strong>milliseconds</strong>; signature over <code>timestamp + METHOD + path</code> (path from root, incl. <code>/trade-api/v2</code>)</td><td><a href="https://docs.kalshi.com/getting_started/quick_start_create_order.md" target="_blank" rel="noopener">Quick Start ↗</a></td><td><span class="badge ok">Documented</span></td></tr>
<tr><td>Success semantics</td><td>HTTP <code>201</code> = accepted, not necessarily resting; check <code>remaining_count</code></td><td><a href="https://docs.kalshi.com/getting_started/quick_start_create_order.md" target="_blank" rel="noopener">Quick Start ↗</a></td><td><span class="badge ok">Documented</span></td></tr>
<tr><td>Amend / cancel</td><td><code>POST /portfolio/events/orders/{order_id}/amend</code> · <code>DELETE /portfolio/events/orders/{order_id}</code></td><td><a href="https://docs.kalshi.com/getting_started/quick_start_create_order.md" target="_blank" rel="noopener">Quick Start ↗</a></td><td><span class="badge ok">Documented</span></td></tr>
<tr><td>Error codes</td><td><code>400</code> invalid_price / insufficient_balance / invalid_order · <code>401</code> · <code>404</code> insufficient_shard_balance · <code>409</code> order_already_exists / market_inactive · <code>429</code></td><td><a href="https://docs.kalshi.com/getting_started/order_errors.md" target="_blank" rel="noopener">Order Errors ↗</a></td><td><span class="badge ok">Documented</span></td></tr>
<tr><td>Demo funds in this site</td><td>—</td><td>—</td><td><span class="badge warn">UNVERIFIED — no key configured (F-07)</span></td></tr>
</tbody></table></div>
<p class="muted small">Prices/behaviour of the demo environment “may not be reflective of those in real markets”
(<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Demo environment ↗</a>).
Fees are not modeled anywhere in this repo (flagged). Nothing here is financial advice.</p>

<h2 id="setup">Setup (owner action, ~2 minutes)</h2>
<ol>
<li>Create a demo API key pair: account page or <code>POST /trade-api/v2/api_keys/generate</code>
(<a href="https://docs.kalshi.com/getting_started/api_keys.md" target="_blank" rel="noopener">API Keys ↗</a>).</li>
<li>Add repository secrets <code>KALSHI_KEY_ID</code> and <code>KALSHI_PRIVATE_KEY</code> (Settings → Secrets → Actions).</li>
<li>Run <strong>Actions → demo-account → Run workflow</strong> (or wait for the 6-hour schedule). The page above fills in automatically.</li>
</ol>
<p class="muted small">Without secrets this tool is a no-op. Keys are never stored in the repository or sent anywhere
except the official demo API host, and mutating commands require an explicit <code>--confirm-live</code>
(<a href="docs/DEMO_ACCOUNT.md">full security model</a>).</p>

<h2 id="simulated">Simulated trading lives elsewhere</h2>
<p class="muted">Automated <em>simulated</em> trades (paper bankroll, strategy testing) are a separate, credential-free
system — see the <a href="portfolio.html">Portfolio</a>, <a href="portfolio.html">Trading</a> and
<a href="analysis.html">Trade analysis</a> pages and the live suites. This page is only about the
<strong>real demo account</strong> connection.</p>

<footer class="foot">Built 2026-11-20 from official Kalshi documentation and the public Kalshi demo API. Every table row links to its official source. Unverified values are left blank and listed on <a href="flagged.html">Flagged for review</a>.</footer>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/app.js"></script>
<script src="assets/demo-account.js" type="module"></script>
</body>
</html>
