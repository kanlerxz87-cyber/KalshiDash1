<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flagged for review — KalshiDash1</title>
<meta name="description" content="Every unverified value, limitation and irregularity found while building the Kalshi demo dashboard, with the official source to check it against.">
<link rel="stylesheet" href="assets/style.css">
</head>
<body data-page="flagged">
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
      <h1>Flagged for review</h1>
      <p class="sub">Nothing here blocks the site. Each row is an unverified value, a limitation of the Kalshi API, or an
      irregularity found in the repository — with the official source you need to check it against.
      Nothing on this site was guessed: where a value could not be confirmed, the cell is left blank.</p>
    </div>
  </div>

  <h2>Open in this session</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>ID</th><th>Type</th><th>Item</th><th>Affects</th><th>Source to check</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td><strong>F-01</strong></td><td>Unverified</td>
          <td>Browser access (CORS) to the demo API could not be tested. The build sandbox can reach only GitHub, npm and PyPI,
          so the live feed was exercised through the fetch tool and through GitHub Actions instead of from a browser.
          The site probes the API on load and falls back to the committed snapshot, stating which mode it is in.</td>
          <td>Every live table, both chat panes</td>
          <td><a href="https://docs.kalshi.com/getting_started/quick_start_market_data" target="_blank" rel="noopener">Quick Start: Market Data</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-02</strong></td><td>Limitation</td>
          <td>REST candlesticks have a one-minute minimum period (1, 60 or 1440 minutes). Sub-minute resolution only exists while the
          page is open, because the browser samples the price itself. The WebSocket feed, which would give true tick data, requires
          API-key authentication during the handshake.</td>
          <td>Charts, swing detection</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market-candlesticks" target="_blank" rel="noopener">Get Market Candlesticks</a> ·
          <a href="https://docs.kalshi.com/websockets/websocket-connection" target="_blank" rel="noopener">WebSocket Connection</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-03</strong></td><td>Interpretation</td>
          <td>The Kalshi API has no "dollar volume" field. The dollar columns here are
          <code>contracts × notional_value_dollars</code>, where <code>notional_value_dollars</code> is the settlement value of one
          contract as published by the API. Where the API did not return that field the dollar cell is left blank rather than
          assumed. Ranking is therefore a derived figure, not an official one.</td>
          <td>All ranking and dollar columns</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market" target="_blank" rel="noopener">Get Market</a> ·
          <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-04</strong></td><td>Interpretation</td>
          <td>"Highest dollar amount live events" is read as "highest 24-hour dollar volume, then highest total volume".
          Kalshi publishes no volume ranking, so the ordering is a stated interpretation.</td>
          <td>Dashboard, topic pages, markets</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market" target="_blank" rel="noopener">Get Market</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-05</strong></td><td>Interpretation</td>
          <td>No news feed exists in the Kalshi API, so a price move cannot be attributed to a cause. Each chat message links the
          event's <strong>official settlement source</strong> — AAA for the gas series, the named election authority for election
          series, the named news organisations for the culture series — as a <em>candidate</em> source, plus the Kalshi market page
          and the exact API row. These links are not a verified cause of the move.</td>
          <td>Both chat panes</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-series-list" target="_blank" rel="noopener">Get Series List</a> ·
          <a href="https://gasprices.aaa.com/" target="_blank" rel="noopener">AAA</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-06</strong></td><td>Derived value</td>
          <td>The ROI score is a weighted heuristic written by this project, not an official Kalshi figure. Every weight and every
          formula is published on <a href="strategies.html">Strategies</a> so it can be recomputed or rejected.</td>
          <td>High-ROI chat pane, strategy rules</td>
          <td><a href="strategies.html">Strategies</a> (own document) · <a href="https://docs.kalshi.com/api-reference/market/get-market" target="_blank" rel="noopener">Get Market</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-07</strong></td><td>Blocker</td>
          <td>No demo API key is committed anywhere in this repository, so no real order was ever placed and the demo-account page
          could not be exercised against a live account. The signing code follows the official guide line for line, but that code path
          is unverified against the exchange. The site deliberately offers no order-placement button.</td>
          <td>Demo account page, portfolio</td>
          <td><a href="https://docs.kalshi.com/getting_started/quick_start_authenticated_requests" target="_blank" rel="noopener">Quick Start: Authenticated Requests</a> ·
          <a href="https://docs.kalshi.com/api-reference/orders/create-order-v2" target="_blank" rel="noopener">Create Order (V2)</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-08</strong></td><td>Limitation</td>
          <td>Topic pages list the top 30 series by volume. The Get Series List endpoint documents no <code>limit</code> parameter,
          so a category query returns everything — the Elections query returned 2,709 series at capture time.</td>
          <td>Topic pages</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-series-list" target="_blank" rel="noopener">Get Series List</a></td>
          <td><span class="badge no">resolved in this session — rule stated on each topic page</span></td></tr>
        <tr><td><strong>F-09</strong></td><td>Unverified</td>
          <td>Some markets have an empty touch at capture time, so their order-book ladder is blank and the liquidity columns show
          "—". Nothing is filled in to hide the gap.</td>
          <td>Liquidity tables, ROI depth component</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-market-orderbook" target="_blank" rel="noopener">Get Market Orderbook</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-10</strong></td><td>Unverified</td>
          <td>The fee schedule was not read in this session. The simulator applies no trading fee; Kalshi states settlement fees
          are zero for simple yes/no determinations. Series records carry a <code>fee_type</code> that this site does not model.</td>
          <td>Portfolio P&amp;L, analysis</td>
          <td><a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a> ·
          <a href="https://docs.kalshi.com/api-reference/market/get-series-list" target="_blank" rel="noopener">Get Series List</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-11</strong></td><td>Limitation</td>
          <td>The simulator fills at the visible touch and cannot model queue position, partial fills or latency, so its results are
          an upper bound on what a real order would achieve. The strategies were published without a backtest against history.</td>
          <td>Portfolio, analysis</td>
          <td><a href="strategies.html">Strategies</a> (own document)</td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-12</strong></td><td>Limitation</td>
          <td>Markets that settled before the exchange's historical cutoff are only available through
          <code>GET /historical/markets</code>, so the resolved-event tables show the recent window only.</td>
          <td>Resolved-event tables</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-13</strong></td><td>Scope</td>
          <td>The brief names five topics, so the dashboard covers only gas prices, elections, culture, crypto and golf. The demo
          exchange also lists AI, Business, Commodities, Entertainment, Financials, Health, Mentions, Politics, Science and
          Technology, Social and World categories, which are deliberately out of scope.</td>
          <td>Whole site</td>
          <td><a href="https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories" target="_blank" rel="noopener">GET /search/tags_by_categories</a></td>
          <td><span class="badge neutral">documented</span></td></tr>
        <tr><td><strong>F-14</strong></td><td>Caveat</td>
          <td>Demo prices and market behaviour may not reflect real markets, and demo funds are mock funds. Kalshi's own warning.</td>
          <td>All price data</td>
          <td><a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Test In The Demo Environment</a></td>
          <td><span class="badge neutral">documented</span></td></tr>
        <tr><td><strong>F-15</strong></td><td>Interpretation</td>
          <td>"Culture" is a real series category in the demo exchange — the official tag taxonomy has no Culture tag list, but
          <code>GET /series?category=Culture</code> returns series such as "Will Grok be banned this year". A prior session on this
          repository asserted that Kalshi has no category named Culture; that assertion is contradicted by the live API record and
          the earlier page is preserved under <code>archive/</code>.</td>
          <td>Culture topic page</td>
          <td><a href="https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture&amp;include_volume=true" target="_blank" rel="noopener">GET /series?category=Culture</a> ·
          <a href="https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories" target="_blank" rel="noopener">GET /search/tags_by_categories</a></td>
          <td><span class="badge no">resolved in this session — contradiction documented</span></td></tr>
        <tr><td><strong>F-16</strong></td><td>Interpretation</td>
          <td>The gas topic keeps only the AAA gasoline series (ticker prefix <code>KXAAAGAS</code>, or a title containing
          "gas price"). The broader "Oil and energy" tag also returns crude-oil and coal series, which are not gas prices and are
          excluded by the stated rule.</td>
          <td>Gas topic page</td>
          <td><a href="https://external-api.demo.kalshi.co/trade-api/v2/series?category=Economics&amp;tags=Oil%20and%20energy&amp;include_volume=true" target="_blank" rel="noopener">GET /series?category=Economics&amp;tags=Oil and energy</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-17</strong></td><td>Repo irregularity</td>
          <td>Before this session the repository shipped <strong>three overlapping site trees</strong> — a generated site at the root,
          a full interactive suite under <code>dash/</code> and a second suite under <code>docs/</code> — each with its own
          overlapping pages, stylesheet and navigation. They were consolidated into one canonical site at the repository root; the
          earlier trees are preserved unchanged under <code>archive/</code> and are not re-verified line by line.</td>
          <td>Repository structure</td>
          <td><a href="COORDINATION.md">COORDINATION.md</a> · git history of this repository</td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-18</strong></td><td>Process</td>
          <td>GitHub Pages is configured as a legacy source serving the repository root of <code>main</code>; the automation token
          returned HTTP 403 when asked to change the build type or the source folder, so that choice needs a repository admin.</td>
          <td>Publishing</td>
          <td>GitHub Pages settings (repository admin)</td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-19</strong></td><td>Unverified</td>
          <td>The <code>tickers</code> batch filter documents no maximum number of tickers. The site batches 40 tickers per request
          as a precaution; a larger batch may be rejected by the exchange.</td>
          <td>Live alert feed</td>
          <td><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets</a></td>
          <td><span class="badge warn">needs review</span></td></tr>
        <tr><td><strong>F-20</strong></td><td>Process</td>
          <td>The committed snapshot is refreshed by a GitHub Actions job that calls the demo API from a GitHub runner. It runs on a
          schedule and on demand; it can only see what the public endpoints return, so it inherits the same limits as the browser feed.</td>
          <td>data/snapshot.json</td>
          <td><a href="https://github.com/kanlerxz87-cyber/KalshiDash1/blob/main/.github/workflows/refresh-data.yml" target="_blank" rel="noopener">.github/workflows/refresh-data.yml</a></td>
          <td><span class="badge neutral">documented</span></td></tr>
      </tbody>
    </table>
  </div>

  <h2>Carried forward from earlier sessions</h2>
  <div class="table-wrap">
    <table class="compact">
      <thead><tr><th>ID</th><th>Item</th><th>Outcome in this session</th></tr></thead>
      <tbody>
        <tr><td>F-09 (prior)</td><td>Positions and fills endpoints were not fetched, so their paths were not verified.</td>
          <td><span class="badge good">resolved</span> — <code>GET /portfolio/positions</code>, <code>/portfolio/fills</code> and
          <code>/portfolio/settlements</code> are now called by the demo-account page, following
          <a href="https://docs.kalshi.com/getting_started/quick_start_authenticated_requests" target="_blank" rel="noopener">the official signing guide</a>.</td></tr>
        <tr><td>F-11 (prior)</td><td>The repository contained only a README at the base commit; no tests, CI, licence or .gitignore.</td>
          <td><span class="badge good">resolved</span> — three CI workflows, a .gitignore and QA scripts now exist.</td></tr>
        <tr><td>F-12 (prior)</td><td>Other session branches claimed the same tasks, and one marked work done that was never pushed.</td>
          <td><span class="badge neutral">recorded</span> — the full history of claims and merges is in
          <a href="COORDINATION.md">COORDINATION.md</a>.</td></tr>
        <tr><td>F-16 (prior)</td><td>Overlapping site pages built by different sessions; prior versions kept under archive/.</td>
          <td><span class="badge neutral">recorded</span> — see F-17 above; the archive is unchanged and still linked from the repository root.</td></tr>
        <tr><td>F-14 (prior)</td><td>GitHub Pages settings could not be changed by the automation token.</td>
          <td><span class="badge neutral">still open</span> — see F-18.</td></tr>
      </tbody>
    </table>
  </div>

  <h2>How to check any row</h2>
  <div class="panel">
    <p>Every row above points at an official Kalshi document or an official demo endpoint. The full registry with what each
    source confirms and how it was verified is on the <a href="sources.html">Sources</a> page, and the raw captured payloads are
    committed in <code>data/snapshot.json</code> so the numbers can be traced back to the response they came from.</p>
    <p class="small muted">Verified {{SNAPSHOT_CAPTURED}}. Report any row you disagree with — each one names the exact check to run.</p>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/app.js"></script>
</body>
</html>
