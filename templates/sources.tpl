<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sources — KalshiDash1</title>
<meta name="description" content="Every official Kalshi document and demo API endpoint this site relies on, what each one confirms, and how it was verified.">
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
      <h1>Sources</h1>
      <p class="sub">Exchange field definitions and historical captures use this register; project rules and calculations are separately labelled. <strong>{{SOURCE_COUNT_DOCS}}</strong> official
      documentation pages, <strong>{{SOURCE_COUNT_API}}</strong> demo API endpoints and
      <strong>{{SOURCE_COUNT_EXTERNAL}}</strong> external references named by the exchange (publisher authenticity is not automatically verified).
      Snapshot captured {{SNAPSHOT_CAPTURED}}; each source below has its own verification date.</p>
    </div>
  </div>

  <div class="notice good">
    <strong>How to audit any number.</strong> Open the endpoint, read the row, and compare it with the value on the page.
    Normalized captured values and request URLs are in <code>data/snapshot.json</code>, not the original raw HTTP bodies. Re-fetching a live endpoint may return changed values. Official definitions do not verify browser-local trades or a news cause.
  </div>

  <div class="table-wrap">
    <table class="compact">
      <thead><tr><th style="width:220px">Source</th><th style="width:260px">URL</th><th>What it confirms</th><th style="width:260px">How it was verified</th></tr></thead>
      <tbody>{{SOURCES_TABLE}}</tbody>
    </table>
  </div>

  <h2>Rules this site follows</h2>
  <div class="panel">
    <ol>
      <li><strong>Missing exchange fields stay missing.</strong> If a value cannot be confirmed, the cell is left
      blank and the gap is listed on the <a href="flagged.html">Flagged for Review</a> page.</li>
      <li><strong>Every row carries its own provenance.</strong> Tables show the endpoint URL that produced the row, so a row can
      be re-fetched and compared directly.</li>
      <li><strong>Documents and live payloads are both cited.</strong> Where the official documentation defines a field, the
      documentation is the source; where a row came from the demo exchange, the endpoint is the source.</li>
      <li><strong>Derived values say so.</strong> Dollar columns, the ROI score and the swing alerts are derived by this project;
      each is labelled and its formula is published.</li>
    </ol>
  </div>

  <h2>Data capture</h2>
  <div class="panel">
    <p>The committed snapshot was produced by <code>scripts/fetch-snapshot.mjs</code>, which calls the public demo endpoints
    directly and stores normalized fields with the exact request URL. It uses
    <strong>{{ENDPOINT_COUNT}}</strong> endpoint calls and covers <strong>{{MARKET_COUNT}}</strong> open markets across the five
    focus topics. A GitHub Actions job
    (<code>.github/workflows/refresh-data.yml</code>) re-runs it on a schedule on a best-effort basis; the published age, not the schedule, determines freshness.</p>
    <p class="small muted">To refresh it yourself on a machine that can reach the API:
    <code>node scripts/fetch-snapshot.mjs</code>. To rebuild the site from the templates:
    <code>node scripts/build-site.mjs</code>. To check internal links:
    <code>node scripts/check-links.mjs</code>.</p>
  </div>
</div></main>

<footer class="site">{{FOOTER}}</footer>
<script src="assets/paper.js"></script>
<script src="assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
