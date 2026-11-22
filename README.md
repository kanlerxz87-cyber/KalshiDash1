# KalshiDash1

A public-data dashboard with an explicitly hypothetical paper model for the **Kalshi demo** exchange, published with GitHub Pages.

**Live site:** <https://kanlerxz87-cyber.github.io/KalshiDash1/>

It ranks sampled demo markets by labelled dollar/notional estimates in five focus topics — **gas prices, elections, culture, crypto and golf** —
and follows tracked binary markets to final **yes**/**no** outcomes. Observed contract moves of **$0.10 or more** feed two scrolling chats. Sampling is capped and can miss intervening moves; this is not an exchange-wide census. Source links distinguish exchange observations/definitions from project rules and calculations, not proof of actual execution or a news cause.

- Demo REST root: `https://external-api.demo.kalshi.co/trade-api/v2`
  (also supported: `https://demo-api.kalshi.co/trade-api/v2`)
- Demo WebSocket root: `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`
  (also supported: `wss://demo-api.kalshi.co/trade-api/ws/v2`)
- These match the endpoint table in [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env)
  and [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) exactly.
- Demo only: mock funds, and Kalshi warns that demo prices may not reflect real markets
  ([demo environment docs](https://docs.kalshi.com/getting_started/demo_env)). Nothing here is a trading recommendation.

---

## The live site — one canonical set of pages

Everything below is reachable from the navigation on every page.

| Page | What it does |
|---|---|
| [`index.html`](index.html) | Landing page: focus-topic cards, topic summary table, the highest-dollar live rows, and how to use the site. |
| [`executive-summary.html`](executive-summary.html) | Executive summary: verified platform facts, what the site covers, key findings, and what is deliberately blank. |
| [`dashboard.html`](dashboard.html) | **Browser research dashboard** — observed ≥ $0.10 moves and a 0–100 research-filtered subset, movers and liquidity. Its formula differs from the background console's 0–1 score; neither forecasts ROI. Polls the public demo API from your browser. |
| [`alerts/index.html`](alerts/index.html) | **Primary Live alerts console** — raw/model-filtered observed moves, fed by the background engine (`tools/live_engine.mjs`), so the record keeps running when no browser is open. |
| [`markets.html`](markets.html) | Every tracked market, filterable by topic and by open/resolved, with each market's `result`. |
| [`market.html`](market.html) | Market detail: price chart (X = time, seconds → 24 h; Y = contract price), order-book ladder (contracts available at each price), settlement rules, paper trade. |
| [`portfolio.html`](portfolio.html) | Simulated portfolio: P&L, equity curve, exposure, and the auto-trader that runs the published strategies. |
| [`analysis.html`](analysis.html) | Trades categorised by strategy and topic, so a strategy can be built from the results. |
| [`strategies.html`](strategies.html) | The exact rule behind every strategy and behind the ROI score, with the sources for the exchange mechanics each rule uses. |
| [`catalyst.html`](catalyst.html) | Swing research: sampled ≥ $0.10 moves with the official event link and the settlement sources the API names, plus clearly-labelled discovery links for a possible cause. |
| [`strategylab.html`](strategylab.html) | Unverified legacy/exploratory local-record categorisation and hypotheses, with optional seeds. Not canonical or actual account performance. |
| [`demo-account.html`](demo-account.html) | Demo-account snapshot: balance, positions, fills and settlements captured by a GitHub Actions job from repository secrets. The browser only reads `data/account.json` — it cannot sign requests itself (measured CORS limitation, [F-66](flagged.html#F-66)). |
| [`categories/gas.html`](categories/gas.html) · [`elections`](categories/elections.html) · [`culture`](categories/culture.html) · [`crypto`](categories/crypto.html) · [`golf`](categories/golf.html) | One page per focus topic: the series, the open markets, the liquidity and the resolved events for that topic only. Topics stay separate; events inside a topic stay grouped together. |
| [`sources.html`](sources.html) | Exchange publisher/field register. Project-only schemas, weights and suggestions cite their author definitions instead of pretending to be official exchange claims. |
| [`flagged.html`](flagged.html) | **Flagged for review** — every unverified value, limitation and irregularity, with the source to check it against. |
| [`questions.html`](questions.html) · [`suggestions.html`](suggestions.html) · [`api.html`](api.html) | Questions and open gaps · the reviewable suggestions board · the verified API reference. |

**Earlier builds.** Two earlier, independent builds of this dashboard are still published for reference and are
**not** the canonical site and are not kept up to date: [`dash/`](dash/index.html) and [`docs/`](docs/index.html).
Their page-by-page index is at the end of this file, under *Earlier builds — page index*.

---

## Repository layout

| Path | What it is |
|---|---|
| `templates/*.tpl` | Page templates for the canonical site. They are stored with a `.tpl` extension so the whole-tree link checker never treats them as published pages. |
| `scripts/build-site.mjs` | The site generator: fills the templates from `data/snapshot.json` + `data/sources.json` and writes the root pages and `categories/`. |
| `assets/` | Browser code for the canonical site: `style.css`, `app.js` (live feed, tables, paper trading), `paper.js` (corrected execution/accounting), `chart.js` (price chart), `catalyst.js`, `strategylab.js`, `demo-account.js`. |
| `data/snapshot.json` | Normalized point-in-time capture of the official demo API (not original raw HTTP bodies) — the committed fallback used when the browser cannot reach the API. Every row carries its `source_url`. |
| `data/sources.json` | The source registry rendered into `sources.html`. |
| `data/live/` | The alert engine's committed output (`feed.json`, `state.json`), refreshed by the scheduled engine job. |
| `alerts/` | The standalone live-alerts console (own markup, own CSS/JS). |
| `tools/live_engine.mjs` | The alert engine: discovers the five topics, samples prices, detects ≥ $0.10 moves, tracks resolutions, scores alerts. |
| `tools/` | API client, demo-account trader, link checker and the QA suites. |
| `scripts/` | Site generator, snapshot fetcher and the offline checkers. |
| `verification/` | Dated line-by-line verification records, one per session. |
| `docs/`, `dash/` | The two earlier builds (published, superseded — see above). |
| `archive/` | Verbatim copies of superseded site files, kept so nothing is lost. |
| `.github/workflows/` | Pages build check, scheduled data refresh, scheduled alert engine, demo-account snapshot, QA suites. |

---


## Corrected paper model and chart provenance

- The canonical `assets/paper.js` model buys **YES ask / NO ask**, never the bid or an assumed last price. It requires sufficient published quantity for the entire positive whole-number order and a local response observation no older than 15 seconds. NO ask quantity is the complementary YES bid quantity ([official mechanics](https://docs.kalshi.com/getting_started/orderbook_responses)).
- Snapshot data is **view-only**. Project paper-risk caps (50 open positions, $1,000 entry cost) are model policies, not exchange limits or account cash. Trading fees, queue position, impact and latency are not modeled; gross paper P&L is not a forecast or actual account performance.
- All five strategies hold to **finalized** binary outcomes; `determined` can still be disputed ([lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle)). Closed and stored open-position markets remain polled. Scalar/unknown outcomes are left unresolved by this binary simulator.
- Earlier browser fills are retained as **legacy/unverified**, excluded from corrected Portfolio/Analysis totals. The separate Strategy Lab still ingests older/seeded stores for exploratory analysis; it is not verified performance.
- Snapshot chart points retain capture time, not page-load time. Live public candles keep their exchange period-end times; seconds are local poll observation times. Gold markers and source-linked rows mark observed ≥$0.10 differences, **not proven news causes**. Equity supports negative and unbounded dollar P&L.
- Run `npm run test:paper` (pure rules) and `npm run test:chart` (canonical DOM/chart/automatic-strategy tests). Fixtures are synthetic and never shipped as market data.
- Current limitations and sources: [F-PAPER-01](https://kanlerxz87-cyber.github.io/KalshiDash1/flagged.html#F-PAPER-01), [F-PAPER-02](https://kanlerxz87-cyber.github.io/KalshiDash1/flagged.html#F-PAPER-02), [F-CHART-01](https://kanlerxz87-cyber.github.io/KalshiDash1/flagged.html#F-CHART-01).

## Build, refresh and check

```bash
node scripts/build-site.mjs      # regenerate the canonical site at the repo root
node scripts/build-site.mjs --check   # fail if the committed site is stale
node scripts/check-links.mjs     # offline check: internal links, nav, titles
npm ci && npm test               # engine selftest + feed schema + jsdom page render + both link checks
```

`npm ci` installs the one declared dev dependency (`jsdom`) used by the page-render tests. The published assets have **no browser package dependencies**. Changes to templates/data must be generated before publication; the static HTML then serves without Node. Node 22 or later runs the tooling.

More checkers used by CI:

```bash
python3 tools/linkcheck.py            # repo-wide internal link check (root, docs/, dash/, alerts/, archive/)
node scripts/check_links.js           # link + asset + JSON check for the dash/ suite
node tools/qa_logic_test.mjs          # API-client logic checks against documented response shapes
node tools/alerts-qa.mjs              # swing detection, ROI model, strategy checks
node tools/alerts-render-test.mjs     # jsdom render + behaviour test of the alert pages
node tools/qa_alert_test.mjs          # engine logic: snapshot replay, model bounds, trade placement
node scripts/check_lab.mjs            # strategy-lab assertions (jsdom)
node scripts/check_alerts.mjs         # validates the committed engine feed against the threshold rules
node scripts/check_alerts_page.mjs    # jsdom render + behaviour test of the alerts console
python3 tools/kalshi_client.py snapshot --with-settled --with-candles   # durable JSON snapshot (needs network)
```

The snapshot and the engine need network access to `*.kalshi.co`; inside GitHub Actions they have it, and in the
build sandbox they may not — in that case the committed snapshot is used and the page says so.

---

## How the live data works

- **In the browser.** The canonical site and the alert console read the public demo endpoints
  (`/series`, `/markets`, `/markets/{ticker}/orderbook`, `/series/{series}/markets/{ticker}/candlesticks`, `/markets/trades`) with no
  credentials. If the browser cannot reach the API, the pages fall back to the committed snapshot and say so.
  See [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data).
- **In the background.** GitHub Pages is static, so nothing on the site can sample the exchange while nobody is
  looking. `.github/workflows/live-alerts.yml` runs `tools/live_engine.mjs` on a schedule and commits
  `data/live/feed.json`; the console reads that feed and additionally polls the public API while it is open.
- **Data freshness.** `.github/workflows/refresh-data.yml` re-captures `data/snapshot.json` from the official demo
  API and regenerates the site on a best-effort schedule. Delays/failures are possible: displayed sample ages, not a successful page load or promised cadence, determine freshness.
- **What it will not do.** Place orders or read a portfolio on its own. Those endpoints need a request signed with
  the account holder's key. This session requested no credentials; repository-secret configuration could not be enumerated (403) and is unverified. The committed account snapshot is disconnected, with no capture time. It cannot be done from the
  browser either: the demo host's CORS preflight does not allow the `KALSHI-ACCESS-*` headers a signed request needs
  (measured 2026-11-21, [F-66](flagged.html#F-66)). Signed reads can run in GitHub Actions with repository secrets; explicit order placement uses the separate demo-only CLI, and the browser only reads the resulting `data/account.json`.

---

## Verification, sources and open items

| Where | What it holds |
|---|---|
| [`sources.html`](sources.html) · [`data/sources.json`](data/sources.json) | Every source the site uses: official documentation pages, exact demo API queries and external references. |
| [`flagged.html`](flagged.html) | Every unverified value, limitation and irregularity, each with the source to check it against. Nothing here blocks the site. |
| [`audit/index.html`](audit/index.html) | Historical 2026-11-20 audit ledger, with superseded claims identified; not a current re-verification. |
| [`verification/2026-11-21-135bb43a.md`](verification/2026-11-21-135bb43a.md) | Corrected paper/chart/demo-only safety and canonical source audit, exact test scope and release evidence. |
| [`VERIFICATION.md`](VERIFICATION.md) · [`verification/`](verification) | Dated verification records, one per session, with the method and the outcome of each check. |
| [`SOURCES.md`](SOURCES.md) · [`REVIEW.md`](REVIEW.md) · [`EXECUTIVE_SUMMARY.md`](EXECUTIVE_SUMMARY.md) | Source register, repository review, and the executive summary of the brief. |
| [`docs/ALERTS.md`](docs/ALERTS.md) | The alert engine's method: discovery, sampling, the ≥ $0.10 rule, the price-coherence check, the ROI heuristic, and every irregularity it can hit. |
| [`COORDINATION.md`](COORDINATION.md) | The shared task board: every session's claim, sources, verification and flagged items. |

**Conventions applied throughout:**

- A value that cannot be confirmed from an official source is left **blank** and listed on the Flagged for Review
  page — never inferred, defaulted or filled with example data.
- Computed numbers (estimated notional, cumulative depth, implied asks) are labelled as ours next to the API fields
  they come from. `notional_value_dollars` is a per-contract settlement value, not traded dollars
  ([Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)).
- Kalshi publishes no traded-dollar field, so "highest dollar amount" is an estimate (contracts × the contract's
  settlement value) and is labelled as an estimate wherever it appears.
- Markets may return `yes`, `no` or `scalar`. After `finalized`, a winning simple $1 binary contract pays $1.00; scalar/bounded contracts follow their own payout rules and are excluded from this binary simulator
  ([Market Settlement](https://docs.kalshi.com/getting_started/market_settlement)).
- The separate signed tool allowlists only the two official demo roots before reading a key or making a request, refuses redirects and defaults to dry-run. Production/arbitrary roots and invalid quantities/prices are rejected. `npm run test:demo-safety` verifies this offline; it does not prove live authentication.
- Nothing here is financial advice.

---

## Earlier builds — page index

<details>
<summary><code>dash/</code> — earlier interactive suite (published, superseded)</summary>

| Path | Purpose |
|------|---------|
| `dash/index.html` | Executive summary + focus-topic glance + highest-dollar rows + live-alerting intro (live or verified snapshot) |
| `dash/events.html` | Topic boards ranked by dollar volume, tracked to resolution (yes/no) + resolution log |
| `dash/alerts.html` | Live alerting: two scrolling chats (every ≥ $0.10 swing vs. the high-ROI model filter), ROI ranking, jump-cause research links, liquidity ladder, chart with seconds→days windows and jump markers, resolutions logged from the API `result` field, and automated simulated strategies (`momentum-10c`, `fade-jump`) |
| `dash/market.html` | Price chart (X = time: 5 min seconds-granularity / 1 h / 6 h / 24 h / 7 d; Y = contract price), orderbook ladder, rules + settlement sources, simulated trade ticket |
| `dash/autotrade.html` | Automated simulated-trade engine: five strategies run automatically against live prices |
| `dash/portfolio.html` | Simulated P&L, win rate, exposure, equity curve, category breakdown |
| `dash/analysis.html` | Topic × strategy breakdown; strategy definitions mapped to verified exchange mechanics |
| `dash/executive-summary.html` | Dedicated executive summary page |
| `dash/suggestions.html` | 12 evidence-backed proposals with approve/reject/implemented workflow (browser-local) |
| `dash/questions.html` | Questions & gaps: known/verified vs missing, with a discovery plan per unknown |
| `dash/api.html` | Verified API reference: environments, auth, endpoint inventory, data model, rate limits, quirks |
| `dash/sources.html` | Source register: every row → official docs page or exact API query |
| `dash/flagged.html` | Flagged for review F-01…F-12 with evidence links and blank-value policy |

Supporting files: `dash/data/snapshot.json` (verified capture; the only market data committed in that suite),
`scripts/refresh_snapshot.py`, `scripts/fetch_snapshot.mjs`, `scripts/local-proxy.mjs` (CORS-proof local live mode).

</details>

<details>
<summary><code>docs/</code> — earlier live suite (published, superseded)</summary>

| Path | Purpose |
|------|---------|
| `docs/index.html` | Live dashboard: exchange status, highest-dollar open markets, price chart, order-book liquidity, discovered series |
| `docs/executive-summary.html` | Executive summary; every claim source-linked |
| `docs/events.html` | Tracked markets with status + YES/NO resolution from the API `result` field |
| `docs/gas-prices.html`, `docs/elections.html`, `docs/culture.html`, `docs/crypto.html`, `docs/golf.html` | Per-category subpages: open markets, resolutions, and the exact series that matched |
| `docs/portfolio.html` | Local paper-trading portfolio + trade categorisation, plus optional demo-account connect |
| `docs/trade.html` | Trade execution: simulator fills, or a real demo order via `POST /portfolio/events/orders` |
| `docs/strategies.html` | Strategy templates and candlestick backtests (educational) |
| `docs/suggestions.html` | Suggestion board with trade-offs and a browser-local review workflow |
| `docs/questions.html` | Questions / information needed / answers with how-to-discover steps |
| `docs/methodology.html` | Discovery rules, ranking formula, chart sources, order-book semantics, accounting |
| `docs/sources.html` | Line-by-line verification table, one official link per row |
| `docs/flagged.html` | Flagged for review: unverified items, doc irregularities, repo findings |
| `docs/ALERTS.md` | The alert engine's method and irregularities (this file is also linked from the canonical site) |

Supporting files: `docs/assets/` (own API client and page logic).

</details>

---

# KalshiDash1 — the `dash/` interactive suite (added by session-cdfe52bd, kept alongside the root site and `docs/` suite)

A third, independent implementation under `dash/`, published at `/dash/` alongside the others. Nothing from
any other session was overwritten: its pages, `js/`, `css/` and verified data snapshot live entirely inside `dash/`.
It adds live→legacy→snapshot data fallback, a canvas price chart with seconds-to-days windows, a full orderbook
liquidity ladder, two live scrolling alert chats with a ≥ $0.10 swing detector (batched quote polls + trade-by-trade
prices from the public `/markets/trades` endpoint, merged from two independent implementations), automated simulated-trade
engines (momentum-10c/fade-jump on the Alerts page; five strategies on the Automated Trading page), a simulated
trade/portfolio engine, and a suggestions review queue.

## Pages under `dash/`

| Path | Purpose |
|------|---------|
| `dash/index.html` | Executive summary + focus-topic glance + highest-dollar rows + live-alerting intro (live or verified snapshot) |
| `dash/events.html` | Topic boards ranked by dollar volume, tracked to resolution (yes/no) + resolution log |
| `dash/alerts.html` | **Live alerting (merged engine, sessions arena-f89b55f7 + arena/815b546d):** two scrolling chats — every ≥ $0.10 swing vs. the high-ROI model filter (score ≥ 70) — plus the ROI model ranking, jump-cause research links, a compact liquidity ladder, a chart with seconds→days windows and jump markers, resolutions logged from the API `result` field, snapshot trades replay, and automated simulated strategies (`momentum-10c`, `fade-jump`) that write into Portfolio/Analysis. Each 15 s cycle: 1 batched `GET /markets?tickers=…` + trade-walk of the top 4 markets (`GET /markets/trades`); see `dash/flagged.html` F-08–F-12. |
| `dash/market.html` | Price chart (X = time: 5 min seconds-granularity / 1 h / 6 h / 24 h / 7 d; Y = contract price), orderbook ladder (contracts available at each price), rules + settlement sources, simulated trade ticket |
| `dash/autotrade.html` | Automated simulated-trade engine: five strategies run automatically against live prices; decisions, controls and stats logged |
| `dash/portfolio.html` | Simulated P&L, win rate, exposure, equity curve, category breakdown (real demo-account sync needs the owner's keys — see `dash/flagged.html` F-02) |
| `dash/analysis.html` | Topic × strategy breakdown; strategy definitions mapped to verified exchange mechanics |
| `dash/executive-summary.html` | Dedicated executive summary page: environment, verified facts, focus-topic activity, capabilities, key findings |
| `dash/suggestions.html` | 12 evidence-backed proposals with approve/reject/implemented review workflow (browser-local) |
| `dash/questions.html` | Questions & gaps: known/verified vs missing, with a discovery plan per unknown |
| `dash/api.html` | Verified API reference: environments, auth, endpoint inventory, data model, rate limits, quirks |
| `dash/sources.html` | Source register: every row → official docs page or exact API query |
| `dash/flagged.html` | Flagged for review F-01…F-12 with evidence links and blank-value policy |

## Tools and documents added alongside

| Path | Purpose |
|------|---------|
| `dash/data/snapshot.json` | Normalized point-in-time capture of the official demo API (not original raw HTTP bodies) (2026-11-20) — the only market data committed in the repo; every row carries its `source_url`. Used only as fallback when the browser cannot reach the API, and clearly labeled. |
| `scripts/refresh_snapshot.py` | Rebuilds the `dash/` snapshot from the latest verified captures (merges rows in place; keeps prior rows and blanks for unconfirmed values) |
| `EXECUTIVE_SUMMARY.md` | Executive summary of the brief, verified platform facts, findings, blank policy |
| `SOURCES.md` | Source register (D1–D16 docs rows, A1–A18 live API captures) |
| `VERIFICATION.md` | Line-by-line verification record incl. headless render test of all 10 pages |
| `REVIEW.md` | Repo review + environment irregularities |
| `scripts/check_links.js` | Link/asset/JSON checker for `dash/` |
| `scripts/fetch_snapshot.mjs` | Refresh the snapshot from the official API; `--portfolio` exports your demo account (keys stay on your machine) |
| `scripts/local-proxy.mjs` | CORS-proof local live mode (`/api/*` → demo API) |
| `.github/workflows/suite-qa.yml` | CI: link + syntax checks for the `dash/` suite |

Conventions of this suite: every table row links its official source; unconfirmed values stay blank and are
listed on the Flagged page; portfolio/trade data is simulated and labeled as such; not financial advice.

---

# Live alerts — two scrolling feeds (added by session-cb49437b)

`alerts/index.html` is a live alerting console for the Kalshi demo exchange. It watches the five
focus topics (gas prices, elections, culture, crypto, golf) and posts a message to a scrolling feed
whenever a contract moves **$0.10 or more in either direction**. A second feed repeats only the
alerts a documented heuristic scores as high expected ROI. Both feeds link the exact API row behind
each alert, plus the contract terms and settlement sources.

```bash
node tools/live_engine.mjs --selftest     # offline logic test, no network
node tools/live_engine.mjs                # one live sample, writes data/live/
node scripts/check_alerts.mjs             # validate the published feed
node scripts/check_alerts_page.mjs        # render + behaviour test of the page (jsdom)
```

* **Why a scheduled job:** GitHub Pages is static, so nothing on the site can sample the exchange
  while nobody is looking. `.github/workflows/live-alerts.yml` declares a 10-minute cron
  (`*/10 * * * *`) and commits `data/live/feed.json`; the page reads that and additionally polls the
  public API while it is open. **The declared cron is not the observed cadence.** GitHub may delay or
  drop scheduled runs, and this repository's own run history is the evidence: 20 `schedule`-triggered
  runs in total, and at 2026-11-22T08:20Z the newest engine sample
  (`data/live/state.json` → `meta.generated_at 2026-11-22T02:27:14.000Z`) was 5.9 hours old while
  `live-alerts` declares `*/10`. Treat the published sample age — the header badge and the
  `#feed-asof` line on every page — as the truth, never the cron. Recorded as F-45/F-58 on
  [`flagged.html`](flagged.html).
* **What it will not do:** place orders or read a portfolio. Those endpoints need a signed request
  with the account holder's key; the site holds no credentials and never asks for them.
* Method, sources and every irregularity: [`docs/ALERTS.md`](docs/ALERTS.md). Flagged items with
  links: [`flagged.html`](flagged.html).

---

# Live-loop integrity: how "live" is made checkable (added by session-f7490df7)

This section documents a measured defect and the guarantee that replaces it. Nothing here is a
claim about Kalshi; it is about this repository's own plumbing.

## The defect that was measured

On 2026-11-20 at 19:15 UTC, this repository's "live" alert feed was **five hours old** and the
site still said LIVE. The evidence, all re-checkable:

| What was checked | How | Result |
|---|---|---|
| Does any `schedule` trigger ever fire here? | `GET /repos/kanlerxz87-cyber/KalshiDash1/actions/runs?event=schedule` | **empty** — no scheduled run, ever, for any of the three workflows that declare a cron |
| How old was the published sample? | `data/live/feed.json` → `meta.generated_at` | `2026-11-20T14:18:54Z` (≈5 h at audit time) |
| Was the refresh job healthy? | Actions run `44752211268` on `main` | **failing**, step "Commit refreshed data" |
| Root cause of the failure | `git log --author=kalshidash-bot origin/main` | **no commits** — the refresh bot had never once won its push race against the engine bot |

GitHub documents two causes for a silent `schedule` stall: runs "can be delayed during periods of
high loads … some queued jobs may be dropped", and scheduled workflows are disabled in public
repositories after 60 days without activity
([events that trigger workflows § schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).
Neither can be ruled out from inside the repository, so the fix does not depend on the cron.

## The three-part fix

1. **`keepalive.yml` samples inline.** It calls `tools/live_engine.mjs` and
   `scripts/fetch-snapshot.mjs` itself, on a 15-minute cron, and commits with a rebase-and-retry
   loop. It does not *dispatch* other workflows — that was tried and measured not to work: a
   dispatch made with the repository's own `GITHUB_TOKEN` returns 2xx but starts nothing, and a
   workflow file first added on a branch is not registered until it exists on the default branch.
   ([dispatch semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow))
2. **`tools/freshness_check.mjs` is the gate.** It fails the run when the *published* feed is
   older than 45 minutes, when an alert lacks a `source_url`, when a recorded swing is below the
   published `$0.10` threshold, or when a resolution is anything other than the exchange's own
   `yes` / `no`.
3. **`assets/freshness.js` puts the measurement in front of the reader.** Every page header now
   shows the real age of the newest engine sample, green under 20 minutes, amber to 45, and
   **`STALE`** beyond that — with a tooltip that says the feeds are historical. If the feed
   cannot be read at all it says `engine unreadable`; it never falls back to the word "live".

The badge is a checked property, not a promise: `node scripts/check_freshness_badge.mjs` loads the
real pages in jsdom with controlled timestamps and asserts all four states plus "no third-party
request" (53 assertions, run in CI).

## Navigation

The primary nav is now five labelled groups — **Start · Topics · Trading · Model · Review** —
instead of one 20-link row. Topic links carry `?topic=<id>` so the dashboard and the alert console
can open already filtered. No URL was removed: the legacy `dash/` and `docs/` suites are still
reachable under **Review**, and every page they served still resolves.

## Reproduce every check locally

```bash
node scripts/build-site.mjs --check        # site matches templates + data
node scripts/check-links.mjs              # 0 broken internal links
python3 tools/linkcheck.py                # same, independent implementation
node tools/live_engine.mjs --selftest     # alert-engine logic (offline)
node scripts/check_alerts.mjs             # feed structure, provenance, thresholds
node tools/freshness_check.mjs            # staleness gate
node scripts/check_freshness_badge.mjs    # header badge honesty (needs `npm install`)
```

## Sources used for this section

* Demo environment, and the caveat that demo prices "may not be reflective of those in real
  markets" — <https://docs.kalshi.com/getting_started/demo_env>
* Unauthenticated public market data used by the sampler —
  <https://docs.kalshi.com/getting_started/quick_start_market_data>
* Settlement pays `$1` per winning contract; `result` is `yes` | `no` | `scalar` —
  <https://docs.kalshi.com/getting_started/market_settlement>
* GitHub `schedule` semantics, delay/drop behaviour —
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
* GitHub dispatch-from-workflow semantics —
  <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow>
Official references: [Demo environment](https://docs.kalshi.com/getting_started/demo_env) ·
[API index](https://docs.kalshi.com/llms.txt) · [Market data](https://docs.kalshi.com/getting_started/quick_start_market_data) ·
[Market settlement](https://docs.kalshi.com/getting_started/market_settlement) ·
[Sources page in the site](sources.html).
