#!/usr/bin/env node
/* build-site.mjs — generate the canonical KalshiDash1 site from
 *   templates/*.html          (page markup, authored by hand)
 *   data/snapshot.json        (verified capture of the official Kalshi demo API)
 *   data/sources.json         (verified source registry)
 * and write the result to the repository root, which is what GitHub Pages serves.
 *
 *   node scripts/build-site.mjs
 *   node scripts/build-site.mjs --check     # fail if the committed site is stale
 *
 * Nothing is invented: every table row is rendered from the captured payload and
 * carries the endpoint URL it came from. Fields the API did not return are left
 * blank and listed on the Flagged for Review page.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TPL = path.join(ROOT, 'templates');
const OUT = ROOT;

const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');

/* ------------------------------------------------------------------ helpers */
const esc = (s) => (s === null || s === undefined ? '' : String(s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const num = (v, dp = 0) => (v === null || v === undefined || v === '' || isNaN(v)
  ? '<span class="muted">—</span>'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const usd = (v, dp = 2) => (v === null || v === undefined || v === '' || isNaN(v)
  ? '<span class="muted">—</span>'
  : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const cents = (v) => (v === null || v === undefined || v === '' || isNaN(v)
  ? '<span class="muted">—</span>'
  : '$' + Number(v).toFixed(4));
const dt = (iso) => (iso ? esc(String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '')) + ' UTC' : '<span class="muted">—</span>');
const srcLink = (url, label = 'source') => (url
  ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`
  : '<span class="muted">—</span>');

/* Age words for the as-of line. Deliberately the same thresholds as assets/freshness.js
 * (20 min warn / 45 min stale), which are this project's operating limits, not Kalshi claims. */
const ASOF_WARN_MIN = 20;
const ASOF_STALE_MIN = 45;

function feedAsOfHtml() {
  const file = path.join(ROOT, 'data', 'live', 'feed.json');
  if (!fs.existsSync(file)) {
    return '<span id="feed-asof" class="small muted" data-state="missing">Data as of: no committed alert-feed sample yet.</span>';
  }
  let feed;
  try { feed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { feed = null; }
  const iso = feed && feed.meta && feed.meta.generated_at ? feed.meta.generated_at : null;
  if (!iso) {
    return '<span id="feed-asof" class="small muted" data-state="missing">Data as of: the committed feed has no timestamp.</span>';
  }
  /* DETERMINISTIC BY DESIGN. The first version of this line printed "N min old at build" from
   * Date.now(), which made the generated HTML depend on the wall clock: `build-site.mjs --check`
   * then failed on the next CI run although nothing in the repo had changed (reproduced locally:
   * "Committed site is stale for: market.html"). The measured age is now computed in the
   * visitor's browser by assets/freshness.js (paintAsOf). The committed HTML carries the absolute
   * sample time and the project's own staleness rule — both constant until the data changes — so
   * a screenshot or a no-JS reader still sees WHEN the data is from. */
  return `<span id="feed-asof" class="small" data-state="pending" data-asof="${esc(iso)}">`
    + `Data as of <b>${esc(iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</b> — `
    + `samples older than ${ASOF_WARN_MIN} min are marked late, older than ${ASOF_STALE_MIN} min STALE `
    + `(age measured in your browser when the page loaded).</span>`;
}

const TOPICS = [
  { id: 'gas', label: 'Gas Prices', color: 'gas' },
  { id: 'elections', label: 'Elections', color: 'elections' },
  { id: 'culture', label: 'Culture', color: 'culture' },
  { id: 'crypto', label: 'Crypto', color: 'crypto' },
  { id: 'golf', label: 'Golf', color: 'golf' }
];
const topicLabel = (id) => (TOPICS.find((t) => t.id === id) || { label: id || '—' }).label;

/* Series per topic actually tracked/shown on the topic pages. The Get Series List
   endpoint documents no `limit`, so the query returns every matching series and the
   site keeps the top N locally, ranked by volume_fp (see flagged.html F-25). */
const SERIES_KEPT_PER_TOPIC = 30;

/* --------------------------------------------------------------- navigation */
/* Five groups, in the order a trader actually uses the dashboard:
 *   Start   -> what is on fire right now (alerts, dashboard, executive summary)
 *   Topics  -> one page per focus topic, so events in the same topic stay together
 *   Trading -> act on it and measure what happened
 *   Model   -> how the score and the strategies are computed
 *   Review  -> sources, questions, flagged items, API reference
 * Every URL that existed before this change still exists; only the labels are grouped.
 * The legacy suites (`dash/`, `docs/`) are reachable from Review -> "Legacy suites" so no
 * working page is orphaned, but they no longer clutter the primary navigation. */
const NAV_GROUPS = [
  ['Start', [
    ['alerts/index.html', 'Live alerts · 2 chats'],
    ['dashboard.html', 'Dashboard'],
    ['executive-summary.html', 'Executive summary']
  ]],
  ['Topics', TOPICS.map((t) => [`categories/${t.id}.html?topic=${t.id}`, t.label])],
  ['Trading', [
    ['markets.html', 'Markets'],
    ['market.html', 'Market detail'],
    ['portfolio.html', 'Portfolio'],
    ['analysis.html', 'Trade analysis'],
    ['strategylab.html', 'Strategy lab']
  ]],
  ['Model', [
    ['strategies.html', 'Strategies & ROI model'],
    ['catalyst.html', 'Swing catalysts'],
    ['suggestions.html', 'Suggestions']
  ]],
  ['Review', [
    ['sources.html', 'Sources'],
    ['flagged.html', 'Flagged for review'],
    ['questions.html', 'Questions'],
    ['api.html', 'API reference'],
    ['demo-account.html', 'Demo account'],
    ['dash/index.html', 'Legacy suite (dash/)'],
    ['docs/index.html', 'Legacy suite (docs/)']
  ]]
];

function navHtml(base = '') {
  return NAV_GROUPS.map(([group, links]) => {
    const items = links.map(([href, label]) => {
      /* Category links carry ?topic= so the dashboard/alert pages can pre-filter. */
      const [path, query] = href.split('?');
      const url = base + path + (query ? '?' + query : '');
      return `<a href="${url}">${esc(label)}</a>`;
    }).join('');
    return `<span class="nav-sep nav-group">${esc(group)}</span><span class="nav-links">${items}</span>`;
  }).join('');
}
function footerHtml(base = '') {
  const captured = snap.meta && snap.meta.captured_at ? dt(snap.meta.captured_at) : '—';
  return `
  <div class="nav-inner">
    <p><strong>KalshiDash1</strong> — a static dashboard for the official Kalshi <em>demo</em> exchange.
    Demo only: mock funds, and demo prices may not reflect real markets
    (<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">demo environment docs</a>).</p>
    <p>REST root <code>https://external-api.demo.kalshi.co/trade-api/v2</code> ·
       WebSocket <code>wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2</code> ·
       Snapshot captured ${captured} ·
       <a href="${base}sources.html">Sources</a> ·
       <a href="${base}flagged.html">Flagged for review</a> ·
       <a href="${base}COORDINATION.md">Coordination board</a></p>
    <p class="muted">Every table row links to the endpoint or document it came from. Nothing on this site is inferred.
    Simulated trades are paper trades in your browser — no real order is ever placed by this site.</p>
    <p class="muted small">Canonical site: the pages in the navigation above. Two earlier builds are still published for
    reference only and are not kept up to date:
    <a href="${base}dash/index.html">dash/</a> · <a href="${base}docs/index.html">docs/</a>.</p>
  </div>`;
}

/* ------------------------------------------------------------------ tables */
function marketTable(rows, opts = {}) {
  const base = opts.base || '';
  if (!rows.length) {
    return `<tr><td colspan="12" class="muted">${esc(opts.empty || 'No rows.')}</td></tr>`;
  }
  return rows.map((m) => {
    const spread = (m.yes_ask_dollars !== null && m.yes_bid_dollars !== null && m.yes_ask_dollars > 0 && m.yes_bid_dollars > 0)
      ? (m.yes_ask_dollars - m.yes_bid_dollars) : null;
    /* Dollar columns = contracts x the contract's published settlement value.
     * When the API did not return notional_value_dollars the dollar cell stays
     * blank rather than assuming $1.00 (flagged as F-03). */
    const notional = (m.notional_value_dollars === null || m.notional_value_dollars === undefined) ? null : m.notional_value_dollars;
    const vol24 = (m.volume_24h_fp === null || notional === null) ? null : m.volume_24h_fp * notional;
    const vol = (m.volume_fp === null || notional === null) ? null : m.volume_fp * notional;
    const oi = (m.open_interest_fp === null || notional === null) ? null : m.open_interest_fp * notional;
    return `<tr>
      <td><a href="${base}market.html?ticker=${encodeURIComponent(m.ticker)}">${esc(m.title || m.ticker)}</a><br><span class="ticker">${esc(m.ticker)}</span></td>
      <td><span class="tag ${esc(m.topic || '')}">${esc(topicLabel(m.topic))}</span></td>
      <td class="num">${cents(m.last_price_dollars)}</td>
      <td class="num">${cents(m.yes_bid_dollars)} / ${cents(m.yes_ask_dollars)}</td>
      <td class="num">${spread === null ? '<span class="muted">—</span>' : cents(spread)}</td>
      <td class="num">${num(vol24)}</td>
      <td class="num">${num(vol)}</td>
      <td class="num">${num(oi)}</td>
      <td>${esc(m.status || '—')}</td>
      <td>${m.result ? `<span class="badge ${m.result === 'yes' ? 'good' : 'bad'}">${esc(m.result)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="src">${srcLink(m.source_url, 'row')}</td>
    </tr>`;
  }).join('\n');
}
const MARKET_HEAD = `<tr><th>Market</th><th>Topic</th><th class="num">Last</th><th class="num">Bid / Ask</th>
  <th class="num">Spread</th><th class="num">24h vol ($)</th><th class="num">Total vol ($)</th>
  <th class="num">Open int ($)</th><th>Status</th><th>Result</th><th>Source</th></tr>`;

function allMarkets() {
  return (snap.markets || []).slice().sort((a, b) =>
    (b.volume_24h_fp || 0) - (a.volume_24h_fp || 0) || (b.volume_fp || 0) - (a.volume_fp || 0));
}

function topicOverviewTable(base = '') {
  return TOPICS.map((t) => {
    const topic = snap.topics[t.id] || {};
    const live = (topic.live_markets || []);
    const vol = live.reduce((s, m) => s + ((m.volume_24h_fp === null || m.volume_24h_fp === undefined
      || m.notional_value_dollars === null || m.notional_value_dollars === undefined)
      ? 0 : m.volume_24h_fp * m.notional_value_dollars), 0);
    const best = live[0];
    return `<tr>
      <td><strong><a href="${base}categories/${t.id}.html">${esc(t.label)}</a></strong></td>
      <td class="num">${num((topic.series || []).length)}</td>
      <td class="num">${num(topic.live_markets_total === undefined ? live.length : topic.live_markets_total)}</td>
      <td class="num">${num(vol)}</td>
      <td>${best ? `<a href="${base}market.html?ticker=${encodeURIComponent(best.ticker)}">${esc(best.title)}</a>` : '<span class="muted">no open market at capture</span>'}</td>
      <td class="src">${srcLink(topic.series_query, 'series query')}</td>
    </tr>`;
  }).join('\n');
}

function seriesTable(topicId) {
  const topic = snap.topics[topicId] || {};
  const rows = topic.series || [];
  if (!rows.length) return '<tr><td colspan="7" class="muted">No series captured for this topic.</td></tr>';
  return rows.map((s) => `<tr>
    <td><code>${esc(s.ticker)}</code></td>
    <td>${esc(s.title || '—')}</td>
    <td>${esc(s.category || '—')}</td>
    <td>${esc((s.tags || []).join(', ') || '—')}</td>
    <td class="num">${num(s.volume_fp)}</td>
    <td>${(s.settlement_sources || []).map((x) => (x.url
      ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`
      : esc(x.name || '—'))).join(', ') || '<span class="muted">—</span>'}</td>
    <td class="src">${srcLink(s.source_url, 'query')}</td>
  </tr>`).join('\n');
}

function resolvedTable(topicId) {
  const topic = snap.topics[topicId] || {};
  const rows = [];
  (topic.settled_events || []).forEach((ev) => {
    (ev.markets || []).forEach((m) => rows.push({ ev, m }));
  });
  if (!rows.length) return '<tr><td colspan="8" class="muted">No settled event captured for this topic at snapshot time.</td></tr>';
  return rows.map((r) => `<tr>
    <td>${esc(r.ev.title || r.ev.event_ticker)}<br><span class="ticker">${esc(r.ev.event_ticker)}</span></td>
    <td>${esc(r.m.yes_sub_title || '—')}<br><span class="ticker">${esc(r.m.ticker)}</span></td>
    <td>${r.m.result ? `<span class="badge ${r.m.result === 'yes' ? 'good' : 'bad'}">${esc(r.m.result)}</span>` : '<span class="muted">—</span>'}</td>
    <td class="num">${cents(r.m.settlement_value_dollars)}</td>
    <td class="num">${num(r.m.volume_fp)}</td>
    <td>${dt(r.ev.settlement_ts || r.m.settlement_ts)}</td>
    <td>${(r.ev.settlement_sources || []).map((x) => (x.url
      ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`
      : esc(x.name || '—'))).join(', ') || '<span class="muted">—</span>'}</td>
    <td class="src">${srcLink(r.ev.source_url, 'events query')}</td>
  </tr>`).join('\n');
}

function liquidityTable(base = '', topicId = null) {
  const rows = [];
  Object.keys(snap.orderbooks || {}).forEach((t) => {
    const ob = snap.orderbooks[t];
    const m = (snap.markets || []).find((x) => x.ticker === t) || {};
    const yes = ob.yes_dollars || [];
    const no = ob.no_dollars || [];
    const total = yes.concat(no).reduce((s, l) => s + (Number(l[1]) || 0), 0);
    const bestYes = yes.length ? Number(yes[yes.length - 1][0]) : null;
    const bestNo = no.length ? Number(no[no.length - 1][0]) : null;
    rows.push({ ticker: t, title: m.title, topic: m.topic, yes, no, total, bestYes, bestNo, source: ob.source_url });
  });
  const shown = topicId ? rows.filter((r) => r.topic === topicId) : rows;
  if (!shown.length) {
    return topicId
      ? '<tr><td colspan="7" class="muted">No order book for this topic&rsquo;s markets was captured at snapshot time (the capture stores the busiest books overall).</td></tr>'
      : '<tr><td colspan="7" class="muted">No order book captured.</td></tr>';
  }
  return shown.map((r) => `<tr>
    <td><a href="${base}market.html?ticker=${encodeURIComponent(r.ticker)}">${esc(r.title || r.ticker)}</a><br><span class="ticker">${esc(r.ticker)}</span></td>
    <td><span class="tag ${esc(r.topic || '')}">${esc(topicLabel(r.topic))}</span></td>
    <td class="num">${r.bestYes === null ? '<span class="muted">—</span>' : cents(r.bestYes)}</td>
    <td class="num">${r.bestNo === null ? '<span class="muted">—</span>' : cents(r.bestNo)}</td>
    <td class="num">${num(r.yes.length + r.no.length)}</td>
    <td class="num">${num(r.total)}</td>
    <td class="src">${srcLink(r.source, 'orderbook')}</td>
  </tr>`).join('\n');
}

function sourcesTable() {
  const groups = [
    ['Official documentation', sources.docs || []],
    ['Official demo API endpoints (called live)', sources.api || []],
    ['Third-party official sources named by the exchange', sources.external || []]
  ];
  return groups.map(([title, list]) => `
    <tr><th colspan="4" style="background:#1b2432">${esc(title)}</th></tr>
    ${list.map((s) => `<tr>
      <td><strong>${esc(s.title)}</strong></td>
      <td><a href="${esc(s.url)}" target="_blank" rel="noopener" class="srcline">${esc(s.url)}</a></td>
      <td>${esc(s.confirms)}</td>
      <td class="small muted">${esc(s.verification)}</td>
    </tr>`).join('\n')}`).join('\n');
}

/* ------------------------------------------------------------ page assembly */
const CATEGORY_PAGES = TOPICS.map((t) => ({
  out: `categories/${t.id}.html`,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.label)} — KalshiDash1</title>
<meta name="description" content="Kalshi demo ${esc(t.label)} markets: series, highest-dollar open markets, order-book liquidity and resolved events, each row linked to its official source.">
<link rel="stylesheet" href="{{BASE}}assets/style.css">
</head>
<body data-page="category" data-topic="${t.id}" data-base="../">
<header class="site">
  <div class="head-inner">
    <div class="brand">Kalshi<span class="dot">Dash</span>1 <span class="badge neutral">Demo</span></div>
    <div class="head-meta"><span id="feed-freshness" class="badge neutral" title="Age of the last live alert-engine sample">engine …</span><span class="asof-wrap">{{FEED_ASOF}}</span><span id="mode-badge" class="badge warn">data: probing…</span><span id="clock" class="mono small muted"></span></div>
  </div>
  <nav class="site"><div class="nav-inner">{{NAV}}</div></nav>
</header>
<main><div class="wrap">
  <div class="page-head">
    <div class="grow">
      <h1><span class="tag ${t.color}">${esc(t.label)}</span> ${esc(t.label)} markets</h1>
      <p class="sub">Every event in this topic stays on one page: the series that define it, the open markets ranked by
      dollar volume, the liquidity sitting at the touch, and the events that have already resolved yes or no.
      Live values replace the captured table as soon as your browser can reach the demo API.</p>
    </div>
  </div>
  <div id="mode-notice" class="notice">Probing the official demo API…</div>

  <h2>Selection rule</h2>
  <div class="panel"><p>${esc((snap.topics[t.id] || {}).selection_rule || '—')}</p>
  <p class="small muted">Series query used for this topic:
  <a href="${esc((snap.topics[t.id] || {}).series_query || '')}" target="_blank" rel="noopener" class="srcline">${esc((snap.topics[t.id] || {}).series_query || '—')}</a></p></div>

  <h2>Series in this topic</h2>
  <div class="table-wrap"><table class="compact"><thead><tr>
    <th>Series ticker</th><th>Title</th><th>Category</th><th>Official tags</th><th class="num">Volume (contracts)</th>
    <th>Official settlement source(s)</th><th>Source</th></tr></thead>
    <tbody id="series-body">{{CATEGORY_SERIES:${t.id}}}</tbody></table></div>

  <h2>Open markets — highest dollar amount first</h2>
  <p class="sub">Dollar volume = contracts traded x the contract's settlement value
  (<code>notional_value_dollars</code>). Rows are sorted by 24h dollar volume. Live values replace this table in place.</p>
  <div class="table-wrap"><table class="compact"><thead>${MARKET_HEAD}</thead><tbody id="market-body">{{CATEGORY_MARKETS:${t.id}}}</tbody></table></div>

  <h2>Liquidity at the captured snapshot</h2>
  <p class="sub">Contracts available at each price, captured from the order book of the busiest markets at snapshot time.</p>
  <div class="table-wrap"><table class="compact"><thead><tr>
    <th>Market</th><th>Topic</th><th class="num">Best yes bid</th><th class="num">Best no bid</th>
    <th class="num">Price levels</th><th class="num">Contracts in book</th><th>Source</th></tr></thead>
    <tbody id="liquidity-body">{{LIQUIDITY:${t.id}}}</tbody></table></div>

  <h2>Resolved events (yes / no)</h2>
  <p class="sub">Events that have already been determined, with the market-level result the exchange published.</p>
  <div class="table-wrap"><table class="compact"><thead><tr>
    <th>Event</th><th>Market side</th><th>Result</th><th class="num">Settlement value</th><th class="num">Volume (contracts)</th>
    <th>Settled at</th><th>Official settlement source(s)</th><th>Source</th></tr></thead>
    <tbody id="resolved-body">{{CATEGORY_RESOLVED:${t.id}}}</tbody></table></div>

  <h2>What a trader should do on this page</h2>
  <div class="panel">
    <ol>
      <li>Open <a href="{{BASE}}dashboard.html">Dashboard</a> and watch the two chat panes for moves of at least $0.10.</li>
      <li>Pick the market, open its <a href="{{BASE}}market.html">detail page</a> and read the chart, the order book and the settlement rules.</li>
      <li>Check the ROI score and the liquidity before acting — the model is documented on <a href="../strategies.html">Strategies</a>.</li>
      <li>Record the trade on the <a href="../portfolio.html">Portfolio</a> page; the auto-trader will also run the published strategies for you.</li>
    </ol>
  </div>
</div></main>
<footer class="site">{{FOOTER}}</footer>
<script src="{{BASE}}assets/paper.js"></script>
<script src="{{BASE}}assets/app.js"></script>
<script src="{{BASE}}assets/freshness.js"></script>
</body>
</html>
`
}));

const PAGES = [
  ...CATEGORY_PAGES,
  { out: 'index.html', tpl: 'index.html' },
  { out: 'executive-summary.html', tpl: 'executive-summary.html' },
  { out: 'dashboard.html', tpl: 'dashboard.html' },
  { out: 'markets.html', tpl: 'markets.html' },
  { out: 'market.html', tpl: 'market.html' },
  { out: 'portfolio.html', tpl: 'portfolio.html' },
  { out: 'analysis.html', tpl: 'analysis.html' },
  { out: 'strategies.html', tpl: 'strategies.html' },
  { out: 'demo-account.html', tpl: 'demo-account.html' },
  { out: 'sources.html', tpl: 'sources.html' },
  { out: 'flagged.html', tpl: 'flagged.html' },
  // The alerts console is a standalone app (own nav, own css/js under alerts/) so it is NOT
  // regenerated from templates/; it is listed here only so the build reports it.
  { out: 'questions.html', tpl: 'questions.html' },
  { out: 'suggestions.html', tpl: 'suggestions.html' },
  { out: 'api.html', tpl: 'api.html' },
  { out: 'catalyst.html', tpl: 'catalyst.html' },
  { out: 'strategylab.html', tpl: 'strategylab.html' },
  { out: '404.html', tpl: '404.html' }
];

/* --------------------------------------------------------------- rendering */
function replacements(text, base = '') {
  const markets = allMarkets();
  const live = markets.filter((m) => m.status !== 'finalized' && m.status !== 'settled');
  const map = {
    '{{BASE}}': base,
    '{{DATA_BASE}}': base || '',
    '{{NAV}}': navHtml(base),
    '{{FOOTER}}': footerHtml(base),
    '{{SNAPSHOT_CAPTURED}}': dt(snap.meta && snap.meta.captured_at),
    /* Absolute, non-JS as-of line. Rendered into the HTML so a screenshot, a PDF, an archived
     * copy or a no-JS reader sees the sample time and its age AT BUILD TIME. assets/freshness.js
     * then replaces it with the age measured in the visitor's browser. The element id is read by
     * assets/freshness.js (paintAsOf) and asserted by scripts/check_freshness_badge.mjs. */
    '{{FEED_ASOF}}': feedAsOfHtml(),
    '{{SNAPSHOT_META}}': esc(JSON.stringify(snap.meta, null, 2)),
    '{{TOPICS_TABLE}}': topicOverviewTable(base),
    '{{TOP_MARKETS_TABLE}}': marketTable(live.slice(0, 20), { empty: 'No open focus-topic market at capture time.', base }),
    '{{ALL_MARKETS_TABLE}}': marketTable(markets.slice(0, 60), { empty: 'No market captured.', base }),
    '{{LIQUIDITY}}': liquidityTable(base),
    '{{SOURCES_TABLE}}': sourcesTable(),
    '{{SOURCE_COUNT_DOCS}}': String((sources.docs || []).length),
    '{{SOURCE_COUNT_API}}': String((sources.api || []).length),
    '{{SOURCE_COUNT_EXTERNAL}}': String((sources.external || []).length),
    '{{MARKET_COUNT}}': String(snap.markets_count_all || (snap.markets || []).length),
    '{{TOPIC_COUNT}}': String(TOPICS.length),
    '{{SERIES_COUNT}}': String(TOPICS.reduce((s, t) => s + (((snap.topics[t.id] || {}).series) || []).length, 0)),
    '{{SERIES_KEPT_PER_TOPIC}}': String(SERIES_KEPT_PER_TOPIC),
    '{{ENDPOINT_COUNT}}': String(((snap.meta || {}).endpoints_used || []).length)
  };
  TOPICS.forEach((t) => {
    const topic = snap.topics[t.id] || {};
    map[`{{CATEGORY_SERIES:${t.id}}}`] = seriesTable(t.id);
    map[`{{CATEGORY_MARKETS:${t.id}}}`] = marketTable(topic.live_markets || [], { empty: 'No open market for this topic at capture time.', base });
    map[`{{CATEGORY_RESOLVED:${t.id}}}`] = resolvedTable(t.id);
    map[`{{LIQUIDITY:${t.id}}}`] = liquidityTable(base, t.id);
    map[`{{TOPIC_OPEN:${t.id}}}`] = String(topic.live_markets_total === undefined ? (topic.live_markets || []).length : topic.live_markets_total);
  });
  Object.keys(map).forEach((k) => { text = text.split(k).join(map[k]); });
  return text;
}

let stale = [];
for (const page of PAGES) {
  // templates are stored as *.tpl so the whole-tree HTML link checker never treats them as published pages
  const src = page.tpl ? path.join(TPL, page.tpl.replace(/\.html$/, '.tpl')) : null;
  let html;
  if (src) {
    if (!fs.existsSync(src)) { console.error('missing template', src); process.exit(1); }
    html = fs.readFileSync(src, 'utf8');
  } else {
    html = page.html;
  }
  html = replacements(html, page.out.includes('/') ? '../' : '');
  const dest = path.join(OUT, page.out);
  const existing = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (existing === html) continue;
  if (checkOnly) { stale.push(page.out); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  console.log('wrote', page.out);
}

/* Machine-readable operating thresholds read by assets/freshness.js (no 404 XHRs). */
{
  const qualityPath = path.join(OUT, 'data', 'dash-quality.json');
  const qualityBody = JSON.stringify({
    freshness: {
      warn_minutes: 20,
      stale_minutes: 45,
      source: 'scripts/build-site.mjs',
      note: 'Project operating thresholds matching the 15-minute keepalive.yml cadence.'
    }
  }, null, 2) + '\n';
  const existingQ = fs.existsSync(qualityPath) ? fs.readFileSync(qualityPath, 'utf8') : null;
  if (existingQ !== qualityBody) {
    if (checkOnly) stale.push('data/dash-quality.json');
    else {
      fs.writeFileSync(qualityPath, qualityBody);
      console.log('wrote data/dash-quality.json');
    }
  }
}

if (checkOnly) {
  if (stale.length) {
    console.error('Committed site is stale for: ' + stale.join(', '));
    process.exit(1);
  }
  console.log('Committed site matches the templates and data.');
} else {
  console.log('build-site: ' + PAGES.length + ' pages generated.');
}

