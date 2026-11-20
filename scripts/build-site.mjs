#!/usr/bin/env node
// Generates the static GitHub Pages site at the repository root (no dependencies).
// Run: node scripts/build-site.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, ".."); // site is published from the repository root (GitHub Pages: main, /)

const API = "https://external-api.demo.kalshi.co/trade-api/v2";
const DOCS = "https://docs.kalshi.com";
const CHECKED = "2026-11-20";

// ---------- Official sources (every one was fetched and read on CHECKED) ----------
const S = {
  demoEnv: { url: `${DOCS}/getting_started/demo_env`, label: "Kalshi docs: Demo environment" },
  llms: { url: `${DOCS}/llms.txt`, label: "Kalshi docs: documentation index" },
  envs: { url: `${DOCS}/getting_started/api_environments`, label: "Kalshi docs: API environments (linked from demo env page)" },
  events: { url: `${DOCS}/api-reference/events/get-events.md`, label: "Kalshi API ref: Get Events" },
  market: { url: `${DOCS}/api-reference/market/get-market.md`, label: "Kalshi API ref: Get Market" },
  orderbook: { url: `${DOCS}/api-reference/market/get-market-orderbook.md`, label: "Kalshi API ref: Get Market Orderbook" },
  candles: { url: `${DOCS}/api-reference/market/get-market-candlesticks.md`, label: "Kalshi API ref: Get Market Candlesticks" },
  seriesList: { url: `${DOCS}/api-reference/market/get-series-list.md`, label: "Kalshi API ref: Get Series List" },
  tags: { url: `${DOCS}/api-reference/search/get-tags-for-series-categories.md`, label: "Kalshi API ref: Get Tags for Series Categories" },
  settlement: { url: `${DOCS}/getting_started/market_settlement.md`, label: "Kalshi docs: Market Settlement" },
  apiKeys: { url: `${DOCS}/getting_started/api_keys.md`, label: "Kalshi docs: API Keys" },
  ws: { url: `${DOCS}/getting_started/quick_start_websockets.md`, label: "Kalshi docs: Quick Start WebSockets" },
  rates: { url: `${DOCS}/getting_started/rate_limits.md`, label: "Kalshi docs: Rate Limits and Tiers" },
  createOrder: { url: `${DOCS}/getting_started/quick_start_create_order.md`, label: "Kalshi docs: Quick Start Create your first order" },
  orderDir: { url: `${DOCS}/getting_started/order_direction.md`, label: "Kalshi docs: Order direction (outcome_side and book_side)" },
  histData: { url: `${DOCS}/getting_started/historical_data.md`, label: "Kalshi docs: Historical Data" },
  exchangeStatusApi: { url: `${API}/exchange/status`, label: "Kalshi demo API: exchange status (live)" },
  tagsApi: { url: `${API}/search/tags_by_categories`, label: "Kalshi demo API: tags by category (live)" },
  golfSeriesApi: { url: `${API}/series?tags=Golf&category=Sports&include_volume=true`, label: "Kalshi demo API: Golf series (live)" },
  gasSeriesApi: { url: `${API}/series?tags=Oil%20%26%20Gas&include_volume=true`, label: "Kalshi demo API: Oil & Gas series (live)" },
  gasSettledApi: { url: `${API}/events?series_ticker=KXAAAGASM&status=settled&with_nested_markets=true`, label: "Kalshi demo API: settled US gas price events (live)" },
  gasOrderbookApi: { url: `${API}/markets/KXAAAGASM-26NOV30-3.00/orderbook?depth=5`, label: "Kalshi demo API: orderbook for KXAAAGASM-26NOV30-3.00 (live, no credentials)" },
  gasEventsApi: { url: `${API}/events?series_ticker=KXAAAGASM&status=open&with_nested_markets=true`, label: "Kalshi demo API: open US gas price events (live)" },
  aaa: { url: "https://gasprices.aaa.com/", label: "AAA (settlement source named in the API series record for gas markets; not independently fetched)" },
};

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
const src = (key) => `<a href="${S[key].url}" target="_blank" rel="noopener" title="${esc(S[key].label)}">${esc(S[key].label.split(": ").slice(-1)[0].slice(0, 48))} ↗</a>`;
const flag = (id) => `<a class="flag" href="{{ROOT}}flagged.html#${id}">${id}</a>`;
const badge = (text, kind = "") => `<span class="badge ${kind}">${esc(text)}</span>`;

function table(headers, rows, { id = "", cls = "", anchorFirst = false } = {}) {
  const th = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td>${anchorFirst && i === 0 ? `<span id="${String(c).replace(/<[^>]*>/g, "")}"></span>${c}` : c}</td>`).join("")}</tr>`).join("\n");
  return `<div class="table-wrap"><table ${id ? `id="${id}"` : ""} class="${cls}"><thead><tr>${th}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

const NAV = [
  ["Overview", [["index.html", "Home"], ["executive-summary.html", "Executive summary"]]],
  ["Categories", [
    ["categories/gas.html", "Gas prices"],
    ["categories/elections.html", "Elections"],
    ["categories/culture.html", "Culture"],
    ["categories/crypto.html", "Crypto"],
    ["categories/golf.html", "Golf"],
  ]],
  ["Tools", [["dashboard.html", "Live dashboard"], ["portfolio.html", "Portfolio"], ["trading.html", "Trading"], ["analysis.html", "Trade analysis"]]],
  ["Decisions", [["questions.html", "Questions & answers"], ["suggestions.html", "Suggestions"]]],
  ["Reference", [["sources.html", "Sources"], ["flagged.html", "Flagged for review"]]],
];

function shell({ root, file, title, desc, body, bodyAttrs = "" }) {
  const nav = NAV.map(([group, items]) => `<div class="nav-group"><div class="nav-title">${group}</div>${items
    .map(([p, label]) => `<a href="${root}${p}" class="${p === file ? "active" : ""}">${label}</a>`).join("")}</div>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Kalshi Demo Dashboard</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="${root}assets/style.css">
</head>
<body ${bodyAttrs}>
<header class="topbar"><button class="menu-btn" aria-label="Toggle menu" onclick="document.body.classList.toggle('menu-open')">☰</button>
<a class="brand" href="${root}index.html">Kalshi Demo Dashboard</a>
<span class="sub">Data: Kalshi demo API · not financial advice · demo prices may not reflect real markets</span></header>
<div class="layout">
<nav class="sidebar">${nav}</nav>
<main class="content">
${body}
<footer class="foot">Built ${CHECKED} from official Kalshi documentation and the public Kalshi demo API. Every table row links to its official source. Unverified values are left blank and listed on <a href="${root}flagged.html">Flagged for review</a>.</footer>
</main>
</div>
<script src="${root}assets/app.js" type="module"></script>
</body>
</html>
`;
}

const pages = [];
function page(file, title, desc, body, bodyAttrs = "") {
  const depth = file.split("/").length - 1;
  const root = depth ? "../".repeat(depth) : "";
  pages.push({ file, html: shell({ root, file, title, desc, body: body.replaceAll("{{ROOT}}", root), bodyAttrs }) });
}

// ---------- PAGES ----------

page("index.html", "Home", "Live Kalshi demo dashboard: highest-activity gas, election, culture, crypto and golf markets.", `
<h1>Kalshi Demo Dashboard</h1>
<p class="lead">A simple, read-only dashboard of the <strong>Kalshi demo</strong> exchange. It ranks open markets by open-interest dollar value in five topics, tracks resolved outcomes (YES / NO), and shows price history and order-book liquidity.</p>

<div class="cards" id="status-cards">
  <div class="card"><div class="k">Exchange status (demo, live)</div><div class="v" id="ex-status">Loading…</div><div class="s" id="ex-detail"></div></div>
  <div class="card"><div class="k">Data as of</div><div class="v" id="asof">—</div><div class="s">Read live in your browser from the demo API.</div></div>
  <div class="card"><div class="k">Portfolio &amp; trading</div><div class="v">Not connected</div><div class="s">Needs a demo API key. See ${"<a href='portfolio.html'>Portfolio</a>"}.</div></div>
</div>

<h2>Topics</h2>
<div class="cards topic-cards">
  <a class="card link" href="categories/gas.html"><div class="k">Category</div><div class="v">Gas prices</div><div class="s">AAA-settled US gas price markets</div></a>
  <a class="card link" href="categories/elections.html"><div class="k">Category</div><div class="v">Elections</div><div class="s">Kalshi "Elections" category</div></a>
  <a class="card link" href="categories/culture.html"><div class="k">Category</div><div class="v">Culture</div><div class="s">Kalshi "Entertainment" category (see flag F-04)</div></a>
  <a class="card link" href="categories/crypto.html"><div class="k">Category</div><div class="v">Crypto</div><div class="s">Kalshi "Crypto" category</div></a>
  <a class="card link" href="categories/golf.html"><div class="k">Category</div><div class="v">Golf</div><div class="s">Kalshi "Sports" category, "Golf" tag</div></a>
</div>

<h2>Key findings (short)</h2>
<ul>
  <li>Public market data (events, series, markets, order books, candlesticks) is readable without credentials. Verified on ${CHECKED} (see ${src("orderbook")} and ${src("events")}).</li>
  <li>Resolved markets carry <code>result</code> = <code>yes</code> or <code>no</code> and <code>status</code> = <code>finalized</code> (example: KXAAAGASM-26OCT31-2.50 resolved <code>yes</code>, ${src("gasSettledApi")}).</li>
  <li>The API has no "dollar volume" field. Dollar figures on this site are derived and labelled as such (see flag F-03).</li>
  <li>No trades have been placed and no portfolio data is available: no demo API key was provided. See ${flag("F-07")}.</li>
</ul>
<p><a href="executive-summary.html">Read the full executive summary →</a></p>
`, 'data-page="home"');

page("executive-summary.html", "Executive summary", "Executive summary: scope, verified facts, limitations and next decisions.", `
<h1>Executive summary</h1>
<p class="muted">Prepared ${CHECKED}. Each statement cites an official Kalshi source or is marked as unverified.</p>

<h2>1. What was built</h2>
<ul>
  <li>A static GitHub Pages site (no backend, no secrets). Live numbers are fetched in the visitor's browser from the official Kalshi <strong>demo</strong> Trade API.</li>
  <li>Five category pages (gas prices, elections, culture, crypto, golf), a live price and liquidity dashboard, placeholder pages for portfolio and trading, a questions list, a suggestions list, a sources table and a Flagged for review page.</li>
</ul>

<h2>2. Verified facts that shape the design</h2>
${table(["Fact", "Evidence", "Source"], [
  ["The recommended demo Trade API root is <code>https://external-api.demo.kalshi.co/trade-api/v2</code>.", "Matches the URL given in the project brief.", src("demoEnv")],
  ["Demo prices and behaviour \"may not be reflective of those in real markets\".", "Quoted from the demo environment page.", src("demoEnv")],
  ["Public market data needs no credentials.", "Events, series, orderbook and exchange status returned HTTP 200 with no credentials on " + CHECKED + ".", src("orderbook") + " · " + src("exchangeStatusApi")],
  ["WebSocket channels all require an authenticated handshake.", "Docs state that connections need the KALSHI-ACCESS headers, even for public channels.", src("ws")],
  ["Portfolio and trade endpoints need signed requests.", "Every request must carry KALSHI-ACCESS-KEY, -SIGNATURE and -TIMESTAMP headers.", src("apiKeys")],
  ["Candlesticks are available at 1-minute, 1-hour and 1-day periods; max 5,000 periods per request.", "Quoted from the endpoint reference.", src("candles")],
  ["Order books return resting bids only; a YES bid at X equals a NO ask at 100−X.", "Quoted from the endpoint reference.", src("orderbook")],
  ["A settled market pays $1 per winning contract.", "Quoted from the settlement page.", src("settlement")],
  ["Settled markets expose <code>result</code> (yes/no) and <code>status</code> (finalized).", "Observed in the settled US gas price events response; field definitions in the Get Market reference.", src("gasSettledApi") + " · " + src("market")],
], { cls: "compact" })}

<h2>3. Key limitations</h2>
<ul>
  <li><strong>No dollar-volume field.</strong> The site ranks by open interest × $1 notional per contract (a derived figure). Raw volume in contracts is also shown. See ${flag("F-03")}.</li>
  <li><strong>Seconds-level charts are not from the API.</strong> REST candlesticks start at 1 minute. Second-by-second points are recorded only while the dashboard is open in a browser. See ${flag("F-02")}.</li>
  <li><strong>No portfolio, trades or P&amp;L.</strong> Those need a demo API key and signed requests. None were provided and none were requested. See ${flag("F-07")}.</li>
  <li><strong>Browser access is not confirmed.</strong> The sandbox could not run a browser against the demo API, so cross-origin access (CORS) is unconfirmed. If it fails, the pages say so. See ${flag("F-01")}.</li>
</ul>

<h2>4. Decisions needed (choose on the Suggestions page)</h2>
<ol>
  <li>Whether to add a small server-side proxy (needed for signed portfolio calls and to avoid browser CORS limits).</li>
  <li>Whether to provide a demo API key through a secure channel for portfolio tracking. This is a user decision; nothing has been requested.</li>
  <li>Which trade categorisation schema to use before any trades are placed.</li>
</ol>

<h2>5. Pointers</h2>
<p>Open questions and missing information: <a href="questions.html">Questions &amp; answers</a>. Full source list: <a href="sources.html">Sources</a>. Irregularities and unverified items: <a href="flagged.html">Flagged for review</a>.</p>
`);

// ---- Category pages ----
const TOPIC_INFO = {
  gas: { title: "Gas prices", blurb: "Markets on US gas prices settled by AAA. Series are found through the \"Oil &amp; Gas\" tag and filtered to tickers starting with <code>KXAAAGAS</code>. WTI oil and natural gas series are excluded (see " + "flag F-05).", flag: "F-05" },
  elections: { title: "Elections", blurb: "Series in Kalshi's <code>Elections</code> category (US and international races, primaries, nominations and related combos).", flag: null },
  culture: { title: "Culture", blurb: "Kalshi's <code>Entertainment</code> category (music, awards, TV, movies, games). Kalshi has no category named \"culture\"; this mapping is our interpretation (see flag F-04).", flag: "F-04" },
  crypto: { title: "Crypto", blurb: "Series in Kalshi's <code>Crypto</code> category (BTC, ETH, SOL and others, many settled by CF Benchmarks).", flag: null },
  golf: { title: "Golf", blurb: "Series in Kalshi's <code>Sports</code> category that carry the <code>Golf</code> tag (for example Masters, Ryder Cup and PGA Tour markets).", flag: null },
};
const CATEGORY_SOURCES = {
  gas: [S.gasSeriesApi, S.gasEventsApi, S.gasSettledApi],
  elections: [S.tags],
  culture: [S.tags],
  crypto: [S.tags],
  golf: [S.golfSeriesApi, S.tags],
};
for (const [key, info] of Object.entries(TOPIC_INFO)) {
  const srcs = CATEGORY_SOURCES[key].map((s) => `<li>${src(Object.keys(S).find((k) => S[k] === s))}</li>`).join("");
  page(`categories/${key}.html`, info.title, `${info.title} markets on the Kalshi demo: open markets ranked by open-interest dollars, and recently resolved YES/NO outcomes.`, `
<h1>${info.title}</h1>
<p class="lead">${info.blurb}</p>
<div class="cards" id="topic-cards">
  <div class="card"><div class="k">Series in scope</div><div class="v" id="t-series">…</div><div class="s">Top 8 by series volume (contracts)</div></div>
  <div class="card"><div class="k">Open markets (loaded)</div><div class="v" id="t-open">…</div><div class="s">From up to 2 pages of open events per series</div></div>
  <div class="card"><div class="k">Open interest, $ (derived)</div><div class="v" id="t-oi">…</div><div class="s">Σ open interest × $1 notional per contract</div></div>
  <div class="card"><div class="k">Resolved, last 14 days</div><div class="v" id="t-res">…</div><div class="s">Markets with result yes / no</div></div>
</div>
<p class="muted" id="t-status">Loading live data from the Kalshi demo API…</p>

<h2>Open markets: ranked by open-interest $ (derived)</h2>
<p class="muted">Ranking field is derived (see ${flag("F-03")}). Click a ticker to open the live chart and order book. Prices are dollars per $1 contract.</p>
<input class="filter" id="open-filter" placeholder="Filter rows (title, ticker, series)…" aria-label="Filter open markets">
<div id="open-table"></div>

<h2>Recently resolved (YES / NO)</h2>
<p class="muted">Settled events closed in the last 14 days, from the API's <code>status=settled</code> list. A market's result is its <code>result</code> field.</p>
<div id="settled-table"></div>

<h2>Series in scope</h2>
<div id="series-table"></div>

<h2>Sources for this page</h2>
<ul>${srcs}<li>${src("seriesList")}</li><li>${src("events")}</li></ul>
<p class="muted">Unverified or missing values appear as “—”. Open <a href="${"{{ROOT}}"}flagged.html">Flagged for review</a> for caveats.</p>
`, `data-page="topic" data-topic="${key}"`);
}

page("dashboard.html", "Live dashboard", "Live price chart (seconds, minutes, hours, days) and order-book liquidity for a Kalshi demo market.", `
<h1>Live market dashboard</h1>
<p class="lead">Price over time for one market. X axis = time, Y axis = last traded YES price (dollars). Liquidity = resting orders by price from the order book.</p>
<div class="controls">
  <label>Market <select id="market-select"><option value="">Choose from a category page…</option></select></label>
  <label>Granularity <select id="gran">
    <option value="sec">Seconds (live, recorded here)</option>
    <option value="min" selected>Minutes (1-min candles)</option>
    <option value="hour">Hours (1-hour candles)</option>
    <option value="day">Days (1-day candles)</option>
  </select></label>
  <label>Range <select id="range"></select></label>
  <button id="refresh" class="btn">Refresh now</button>
</div>
<p class="muted" id="m-status">Loading…</p>

<div class="cards" id="m-cards">
  <div class="card"><div class="k">Last price (YES)</div><div class="v" id="c-last">—</div></div>
  <div class="card"><div class="k">Best YES bid</div><div class="v" id="c-bid">—</div></div>
  <div class="card"><div class="k">Best YES ask</div><div class="v" id="c-ask">—</div></div>
  <div class="card"><div class="k">Open interest (contracts)</div><div class="v" id="c-oi">—</div></div>
  <div class="card"><div class="k">Status</div><div class="v" id="c-status">—</div></div>
</div>

<div class="chart-wrap"><svg id="chart" viewBox="0 0 900 360" role="img" aria-label="Price chart"></svg></div>
<p class="muted small" id="chart-note"></p>

<div class="two-col">
  <div>
    <h2>Liquidity: resting YES bids</h2>
    <p class="muted small">Buy orders for YES. Contracts = quantity resting at that price (highest first).</p>
    <div id="bids-table"></div>
  </div>
  <div>
    <h2>Liquidity: implied YES asks</h2>
    <p class="muted small">Derived: a NO bid at P is a YES ask at 1 − P (per the order book reference). Lowest first.</p>
    <div id="asks-table"></div>
  </div>
</div>

<h2>Market rules &amp; sources</h2>
<div id="m-rules" class="rules"></div>
<p class="muted small">Sources: ${src("market")} · ${src("orderbook")} · ${src("candles")}. Seconds granularity is recorded in this browser only (no API history at seconds resolution). See ${flag("F-02")}.</p>
`, 'data-page="dashboard"');

page("portfolio.html", "Portfolio", "Portfolio tracking for the Kalshi demo account: status, required access and what is still missing.", `
<h1>Portfolio performance (demo account)</h1>
<div class="notice"><strong>Status: not connected.</strong> Portfolio endpoints require signed requests with a demo API key (KALSHI-ACCESS-KEY, -SIGNATURE, -TIMESTAMP). No key was provided or requested, and no key is stored in this site. No values are shown because none could be verified. See ${flag("F-07")}.</div>

<h2>Required endpoints and their status</h2>
${table(["Item", "Official endpoint / reference", "Value on this site", "Status"], [
  ["Cash balance", `<code>GET /portfolio/balance</code> · ${src("rates")} (balance bucket) · ${src("apiKeys")} (signing)`, "", badge("UNVERIFIED — no key", "warn")],
  ["Open positions", "Not verified in this session (endpoint list not fetched). " + flag("F-09"), "", badge("UNVERIFIED", "warn")],
  ["Fills / trade history", "Not verified in this session. " + flag("F-09"), "", badge("UNVERIFIED", "warn")],
  ["Realised P&amp;L", "Not an API field we have verified. Derived P&amp;L would need fees and fills; see " + flag("F-10"), "", badge("NOT COMPUTED", "warn")],
], { cls: "compact" })}

<h2>What is needed to switch this on</h2>
<ol>
  <li>A demo API key pair. Keys are created on the account page or with <code>POST /trade-api/v2/api_keys/generate</code> (${src("apiKeys")}).</li>
  <li>Signing must happen server-side. A static page cannot hold a private key safely. See suggestion S-02 on the Suggestions page.</li>
  <li>Rate-limit handling: the balance endpoint has its own bucket, one call per second on Basic and Advanced tiers (${src("rates")}).</li>
</ol>
`);

page("trading.html", "Trading", "Trade execution status for the Kalshi demo: no orders placed, what the API requires, open issues.", `
<h1>Trade execution (demo)</h1>
<div class="notice"><strong>Status: no trades placed.</strong> Placing orders requires authenticated requests against the demo account. No credentials were provided, so no order was submitted. Nothing on this page is a recommendation to trade.</div>

<h2>Order endpoint as documented (not yet implemented)</h2>
${table(["Item", "Documented value", "Source", "Status"], [
  ["Create order path", "<code>POST /portfolio/events/orders</code> (in the quick-start example)", src("createOrder"), badge("UNVERIFIED — see F-08", "warn")],
  ["Order fields in example", "<code>ticker</code>, <code>side: \"bid\"</code>, <code>count</code>, <code>price</code> (dollars string), <code>time_in_force</code>, <code>self_trade_prevention_type</code>, <code>client_order_id</code>", src("createOrder"), badge("UNVERIFIED — see F-08", "warn")],
  ["Success response", "HTTP 201 means accepted, not necessarily resting; check <code>remaining_count</code>", src("createOrder"), badge("Documented", "ok")],
  ["Error codes", "400 / 401 / 404 / 409 / 429 are described in the quick-start; full list in Order Errors reference", src("createOrder"), badge("Documented", "ok")],
  ["Trades executed", "0", "—", badge("None", "")],
], { cls: "compact" })}

<h2>Blockers</h2>
<ul>
  <li>No demo API key (see <a href="portfolio.html">Portfolio</a>).</li>
  <li>Order-direction fields: the quick-start uses the legacy <code>side</code> field, while the order-direction page recommends <code>outcome_side</code> / <code>book_side</code> (${src("orderDir")}). Reconcile before any order code is written (${flag("F-08")}).</li>
</ul>
`);

page("analysis.html", "Trade analysis", "How trades would be categorised and analysed once demo fills exist. Currently no trade data.", `
<h1>Trade analysis &amp; strategy categories</h1>
<div class="notice"><strong>No trade data yet.</strong> There are zero fills, so no results, win rates or strategy returns are shown. Nothing here is computed from real trades.</div>

<h2>Proposed categorisation schema (our proposal, not an official Kalshi classification)</h2>
${table(["Dimension", "Possible values", "Data needed", "Available now?", "Source"], [
  ["Topic", "Gas, Elections, Culture, Crypto, Golf", "Market → series → category (from API)", "Yes (live)", src("seriesList")],
  ["Side", "YES / NO", "Fill side", badge("No fills", "warn"), src("settlement")],
  ["Entry price band", "Price in $0.00–$1.00 buckets", "Fill price", badge("No fills", "warn"), src("market")],
  ["Time to close", "< 1 day, 1–7 days, > 7 days", "Fill time and close_time (API)", badge("No fills", "warn"), src("events")],
  ["Liquidity at entry", "Resting contracts at best price", "Orderbook snapshot at fill time", badge("Not recorded", "warn"), src("orderbook")],
  ["Strategy label", "Analyst-defined (proposal only)", "Analyst label per trade", badge("Not defined", "warn"), "Internal proposal — no external source"],
], { cls: "compact" })}
<p class="muted small">Strategy labels are a human decision and have no external source.</p>

<h2>What is needed</h2>
<ul>
  <li>Demo fills history (see ${flag("F-07")}).</li>
  <li>Agreement on the schema above (see Questions and Suggestions).</li>
</ul>
`);

page("questions.html", "Questions & answers", "Questions that must be answered before decisions, with what is known, the source, and how to find what is missing.", `
<h1>Questions, answers and missing information</h1>
<p class="muted">Answers are shown only where an official source supports them. Items marked “Missing” need information we do not yet have.</p>

<h2>A. Answered (with official source)</h2>
${table(["ID", "Question", "Answer", "Source"], [
  ["Q-01", "What is the demo REST root?", "<code>https://external-api.demo.kalshi.co/trade-api/v2</code>", src("demoEnv")],
  ["Q-02", "Is the demo environment's price data a real-market proxy?", "Docs: demo behaviour \"may not be reflective of\" real markets.", src("demoEnv")],
  ["Q-03", "Can public market data be read without credentials?", "Yes for events, series, orderbook and exchange status (HTTP 200 observed with no credentials on " + CHECKED + ").", src("orderbook") + " · " + src("events")],
  ["Q-04", "Can the WebSocket feed be used without credentials?", "No: the handshake is authenticated for all channels.", src("ws")],
  ["Q-05", "How is a resolved outcome recorded?", "Field <code>result</code> = yes or no; status <code>finalized</code>. Observed on US gas price markets.", src("gasSettledApi")],
  ["Q-06", "What does a winning contract pay?", "$1.00 per contract.", src("settlement")],
  ["Q-07", "What candle sizes exist?", "1, 60 and 1440 minutes.", src("candles")],
  ["Q-08", "How many candles per request?", "At most 5,000 periods; longer ranges are rejected with 400.", src("candles")],
  ["Q-09", "What does an order book show?", "Resting YES bids and NO bids only, as price/quantity pairs; asks are implied.", src("orderbook")],
], { cls: "compact" })}

<h2>B. Missing information (needs discovery)</h2>
${table(["ID", "Question", "Why it matters", "How to discover it"], [
  ["M-01", "Exact unauthenticated rate limits", "Sets how often the dashboard may poll.", `Read <code>X-RateLimit-*</code> headers on a test call; the docs say unauthenticated limits are separate but give no numbers (${src("rates")}).`],
  ["M-02", "Whether browsers can call the demo API cross-origin (CORS)", "Without it, live tables cannot load on GitHub Pages.", "Open the live site in a normal browser and check the console (" + src("demoEnv") + " for the API host). If blocked, see S-01 (proxy)."],
  ["M-03", "A dollar-volume field", "The brief asks for the highest dollar amount; the API has no such field.", "Confirm by reading all market fields in the Get Market reference (" + src("market") + "); rank by OI $ as a stated proxy (" + flag("F-03") + ")."],
  ["M-04", "Demo account balance, positions and fills", "Needed for portfolio and P&amp;L.", "Provide a demo key through a secure channel (S-02); signing rules in " + src("apiKeys") + "."],
  ["M-05", "Fee schedule for each series", "Net P&amp;L needs fees. Series records carry a fee_type (" + src("seriesList") + "); the schedule itself is not verified.", "Read the fee schedule linked from the docs and the series record (" + flag("F-10") + ")."],
  ["M-06", "History before the API cutoff", "Settled markets older than the cutoff are not in nested market lists (" + src("events") + ").", "Use the historical endpoints in the Historical Data reference " + "(" + "<a href=\"https://docs.kalshi.com/getting_started/historical_data.md\" target=\"_blank\" rel=\"noopener\">Kalshi docs: Historical Data ↗</a>, not yet read)."],
  ["M-07", "Seconds-level price history", "REST candles are at least 1 minute (" + src("candles") + ").", "Record samples or use the authenticated WebSocket (" + src("ws") + "; " + flag("F-02") + ")."],
  ["M-08", "Whether the AAA gas series settles on the AAA page as named", "The series record names AAA as settlement source (" + src("gasSeriesApi") + "); the rules are on each market.", "Compare the market rules text with AAA's published data (" + src("aaa") + "; " + flag("F-05") + ")."],
], { cls: "compact" })}

<h2>C. Decisions blocked until M-items are answered</h2>
<ul>
  <li>Choosing which markets to trade (blocked: no trade data, no key).</li>
  <li>Any strategy conclusion (blocked: no trades; see Trade analysis).</li>
  <li>Whether the site can run without a proxy (blocked: M-02).</li>
</ul>
`);

page("suggestions.html", "Suggestions", "Suggestions to improve the site and decision-making. Nothing is implemented until you choose.", `
<h1>Suggestions: review and choose</h1>
<div class="notice"><strong>Nothing here is implemented.</strong> Each item is a proposal. Choose the path you want; only chosen items will be built.</div>
${table(["ID", "Suggestion", "Why", "Evidence / source", "Decision"], [
  ["S-01", "Add a small server-side proxy that caches public Kalshi data.", "Avoids browser CORS limits (M-02) and reduces repeated polling.", src("rates"), "☐ Choose  ☐ Defer"],
  ["S-02", "Add portfolio tracking using a demo key that is stored only as a server secret.", "Needed for balances, positions, fills and P&amp;L.", src("apiKeys"), "☐ Choose  ☐ Defer"],
  ["S-03", "Record a dollar-volume history by snapshotting markets on a schedule.", "The API has no dollar-volume field; history must be built.", src("market"), "☐ Choose  ☐ Defer"],
  ["S-04", "Add WebSocket streaming for seconds-level prices (requires credentials).", "Only path to true second-by-second data.", src("ws"), "☐ Choose  ☐ Defer"],
  ["S-05", "Define the trade categorisation schema before any order is placed.", "Makes later strategy analysis comparable.", "Internal proposal — see Trade analysis page; no external source.", "☐ Choose  ☐ Defer"],
  ["S-06", "Add a paper-trade log (no orders sent) to test ideas first.", "Reduces risk of unplanned demo trades.", "Internal proposal — no external source; orders would need " + src("createOrder") + ".", "☐ Choose  ☐ Defer"],
  ["S-07", "Show fee-adjusted expected value per market once fee schedule is verified.", "Fees change the answer.", src("seriesList") + " (fee_type field)", "☐ Choose  ☐ Defer"],
  ["S-08", "Add a reviewer checklist that each market has an official source and a verified result before it is used in analysis.", "Keeps the verification rule the brief asks for.", src("events"), "☐ Choose  ☐ Defer"],
], { cls: "compact" })}
<p class="muted small">Decision recording: this site cannot store choices. Record yours in <code>COORDINATION.md</code> or in your reply.</p>
`);

page("sources.html", "Sources", "Every official source used, the date checked, and what each one supports.", `
<h1>Sources</h1>
<p class="muted">Each source was fetched on ${CHECKED} with the fetch tool. Live API links return data that changes; the value shown on the site is whatever the API returned when you loaded it.</p>
${table(["ID", "Official source (link)", "Supports", "Checked"], [
  ["SRC-01", src("demoEnv"), "Demo REST and WebSocket roots; demo prices caveat", CHECKED],
  ["SRC-02", src("llms"), "Index of Kalshi docs pages used", CHECKED],
  ["SRC-03", src("envs"), "Environment list (linked; not fetched in full)", CHECKED],
  ["SRC-04", src("events"), "Events list parameters (status, series_ticker, with_nested_markets, cursor)", CHECKED],
  ["SRC-05", src("market"), "Market fields: status, result, bids/asks, volume, open interest", CHECKED],
  ["SRC-06", src("orderbook"), "Orderbook structure, YES/NO bids, implied asks", CHECKED],
  ["SRC-07", src("candles"), "Candlestick periods, 5,000 limit, OHLC price fields", CHECKED],
  ["SRC-08", src("seriesList"), "Series list filters (category, tags, include_volume)", CHECKED],
  ["SRC-09", src("tags"), "Category → tags mapping", CHECKED],
  ["SRC-10", src("settlement"), "$1 payout per winning contract", CHECKED],
  ["SRC-11", src("apiKeys"), "Signed-request headers; key creation", CHECKED],
  ["SRC-12", src("ws"), "WebSocket authentication for all channels", CHECKED],
  ["SRC-13", src("rates"), "Rate-limit structure; unauthenticated limits not numerically given", CHECKED],
  ["SRC-14", src("createOrder"), "Quick-start order example (legacy fields; see F-08)", CHECKED],
  ["SRC-15", src("exchangeStatusApi"), "Live exchange status response", CHECKED],
  ["SRC-16", src("tagsApi"), "Live category/tag map", CHECKED],
  ["SRC-17", src("golfSeriesApi"), "Live Golf series list", CHECKED],
  ["SRC-18", src("gasSeriesApi"), "Live Oil &amp; Gas series list (includes AAA gas series)", CHECKED],
  ["SRC-19", src("gasEventsApi"), "Live open US gas price events", CHECKED],
  ["SRC-20", src("gasSettledApi"), "Live settled US gas price events with result yes/no", CHECKED],
  ["SRC-21", src("gasOrderbookApi"), "Live orderbook call with no credentials (empty book at this moment)", CHECKED],
  ["SRC-22", src("aaa"), "Named settlement source for gas series (linked, not independently checked)", "not fetched"],
  ["SRC-23", src("orderDir"), "Legacy action/side fields and removal date (\"not before May 28, 2026\")", CHECKED],
  ["SRC-24", src("histData"), "Live vs historical cutoff; which market/trade records leave live endpoints", CHECKED],
], { cls: "compact" })}
`);

page("flagged.html", "Flagged for review", "Irregularities, unverified items and caveats flagged for the reviewer, with source links.", `
<h1>Flagged for review</h1>
<p class="muted">These items do not block the site. Each one needs your review. Source links are included so you can check them.</p>
${table(["ID", "Type", "Item", "Affects", "Sources to check", "Status"], [
  ["F-01", "Unverified", "Browser access (CORS) to the demo API could not be tested from the build sandbox. The live tables depend on it.", "All category pages, dashboard", src("demoEnv") + " · " + src("orderbook"), badge("Needs review", "warn")],
  ["F-02", "Limitation", "REST candles are 1 minute minimum. Seconds granularity is recorded only while the page is open, not from the API. WebSocket requires credentials.", "Dashboard", src("candles") + " · " + src("ws"), badge("Needs review", "warn")],
  ["F-03", "Derived value", "No dollar-volume field exists in the API. Ranking uses open interest × notional_value_dollars (contracts × $1). This is a derived figure, not an official one.", "Category pages", src("market") + " · " + src("settlement"), badge("Needs review", "warn")],
  ["F-04", "Interpretation", "\"Culture\" is mapped to Kalshi's Entertainment category. Kalshi has no category named Culture.", "Culture page", src("tags"), badge("Needs review", "warn")],
  ["F-05", "Interpretation", "\"Gas prices\" uses only AAA gas series (KXAAAGAS*). Oil & Gas tag includes WTI and natural gas series, which are excluded.", "Gas page", src("gasSeriesApi") + " · " + src("aaa"), badge("Needs review", "warn")],
  ["F-06", "Caveat", "Demo prices may not reflect real markets (Kalshi's own warning).", "All price data", src("demoEnv"), badge("Documented", "")],
  ["F-07", "Blocker", "Portfolio, trades and P&amp;L not available: no demo API key provided; none requested or stored.", "Portfolio, Trading, Analysis", src("apiKeys"), badge("Blocked", "warn")],
  ["F-08", "Irregularity", "The quick-start order example uses <code>POST /portfolio/events/orders</code> with <code>side: \"bid\"</code>. The order-direction page says legacy action/side fields \"will not be removed before May 28, 2026\"; today is 2026-11-20, so the example may be out of date. Not tested (no key).", "Trading page", src("createOrder") + " · " + src("orderDir"), badge("Needs review", "warn")],
  ["F-09", "Unverified", "Positions and fills endpoints were not fetched in this session, so their paths are not listed as verified.", "Portfolio", src("llms"), badge("Needs review", "warn")],
  ["F-10", "Unverified", "Fee schedule not read. Series records carry a fee_type; the schedule PDF is not verified here.", "Analysis, suggestions", src("seriesList"), badge("Needs review", "warn")],
  ["F-11", "Repo irregularity", "Repository at base commit f1fa6aa contains only README.md (\"# KalshiDash1\"). No tests, CI, licence or .gitignore existed before this work.", "Repo", "git history of this repository", badge("Noted", "")],
  ["F-12", "Coordination", "Other session branches exist (arena/3f5650f9-kalshidash1 and arena/f661348d-kalshidash1) with claims on the same tasks. Branch 3f5650f9 marks docs as done, but those docs are not on that branch. See COORDINATION.md.", "Process", "COORDINATION.md on this branch", badge("Needs review", "warn")],
  ["F-13", "Unverified", "Some market field values are cached briefly by the API (Get Market reference), so live figures can lag.", "Dashboard", src("market"), badge("Documented", "")],
  ["F-14", "Process", "GitHub Pages settings could not be changed by the automation token (HTTP 403 for build type and for the /docs folder). The site is therefore published from the repository root on main (legacy source). Repository owner may prefer a different source.", "Publishing", "GitHub Pages settings (repo admin)", badge("Needs review", "warn")],
], { cls: "compact", anchorFirst: true })}
`);

// ---------- write files ----------
for (const p of pages) {
  const path = join(OUT, p.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, p.html);
}
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`Wrote ${pages.length} pages to ${relative(process.cwd(), OUT) || "."}`);
