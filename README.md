# KalshiDash1

A simple, read-only dashboard for the **Kalshi demo** exchange, published with GitHub Pages.

- **Site source:** generated at the repository root (`index.html`, `*.html`, `categories/`, `assets/`). Edit `scripts/build-site.mjs` (pages) or `assets/app.js` / `assets/style.css` (browser code), then regenerate. GitHub Pages serves `main` at `/`.
- **Build and check:**
  ```bash
  node scripts/build-site.mjs      # regenerates the site at the repo root
  node scripts/check-links.mjs     # offline check: internal links, nav, titles
  node --check assets/app.js      # syntax check of browser code
  ```
  No dependencies are needed (Node 22 or later).
- **Live data:** read in the visitor's browser from the official demo Trade API, `https://external-api.demo.kalshi.co/trade-api/v2`, using public endpoints only. No credentials are requested, stored or sent.
- **Pages:** the repository's Pages source is the legacy `main` branch, root folder (set by the repository owner; the automation token could not change it). `.github/workflows/pages.yml` rebuilds the site, checks links, and fails if the committed site is stale.
- **Coordination:** see `COORDINATION.md` for the task board, sources, verification and flagged items.

Official references: [Demo environment](https://docs.kalshi.com/getting_started/demo_env) · [API index](https://docs.kalshi.com/llms.txt) · [Sources page in the site](sources.html).

Unverified items and irregularities are listed on the site's **Flagged for review** page (`flagged.html`).

---

# KalshiDash1 — the `docs/` live suite (added by session-3f5650f9, kept alongside the generated root site)

The repository root is the generated site (see above). This session built a second, independent
implementation under `docs/`, and both are published — nothing was overwritten or deleted. `docs/` has
its own API client, page logic, methodology, verification table and Flagged page.

## Pages under `docs/`

| Path | Purpose |
|------|---------|
| `docs/index.html` | Live dashboard: exchange status, highest-dollar open markets, price chart, order-book liquidity, discovered series |
| `docs/executive-summary.html` | Executive summary; every claim source-linked |
| `docs/events.html` | Tracked markets with status + YES/NO resolution from the API `result` field |
| `docs/gas-prices.html`, `docs/elections.html`, `docs/culture.html`, `docs/crypto.html`, `docs/golf.html` | Per-category subpages: open markets, resolutions, and the exact series that matched |
| `docs/portfolio.html` | Local paper-trading portfolio + trade categorization, plus optional demo-account connect (balance/positions/fills) |
| `docs/trade.html` | Trade execution: simulator fills, or a real demo order via `POST /portfolio/events/orders` |
| `docs/strategies.html` | Strategy templates and candlestick backtests (educational) |
| `docs/suggestions.html` | Suggestion board with trade-offs, voting and "choose this path" (browser-local) |
| `docs/questions.html` | Questions / information needed / answers with how-to-discover steps |
| `docs/methodology.html` | Discovery rules, ranking formula, chart sources, order-book semantics, accounting |
| `docs/sources.html` | Line-by-line verification table (S-01 … S-51), one official link per row |
| `docs/flagged.html` | Flagged for review: unverified items, doc irregularities, repo findings |

## Conventions (applied to both implementations)

* Demo environment only, mock funds: "the price and behavior of markets in the demo environment may not be
  reflective of those in real markets" ([demo environment docs](https://docs.kalshi.com/getting_started/demo_env)).
* No market data is committed anywhere in this repository. Prices, books and resolutions are fetched by the
  browser at page load; if the API cannot be reached the tables say so instead of showing placeholders.
* If a value cannot be confirmed from an official source it stays blank and is listed on the Flagged page —
  never inferred, defaulted, or filled with example data.
* Computed numbers (estimated notional, cumulative depth, implied asks) are labelled as ours next to the API
  fields they come from. `notional_value_dollars` is a per-contract settlement value, not traded dollars
  ([Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)).
* No credential is stored in the repo or sent anywhere except the demo API origin; the `docs/` suite keeps a
  pasted demo key in the visitor's browser only.
* Nothing here is financial advice.

## Additional tooling

```bash
python3 tools/linkcheck.py        # repo-wide internal link check (covers root, docs/ and archive/)
node tools/qa_logic_test.mjs      # 28 logic checks on docs/assets/kalshi.js against documented response shapes
node tools/alerts-qa.mjs          # 37 logic checks on dash/js/alerts.js (swing detection, ROI model, strategies)
node tools/alerts-render-test.mjs # jsdom render+behavior test of dash/alerts.html (npm i --no-save jsdom@24.1.3 first)
node tools/qa_alert_test.mjs      # engine logic checks for the merged Alerts + Autotrade engines (snapshot replay, model bounds, trade placement)
python3 tools/kalshi_client.py snapshot --with-settled --with-candles   # durable JSON snapshot (needs network)
python3 tools/kalshi_client.py markets --category crypto --limit 25
```

`tools/kalshi_client.py` is standard-library only, applies the same category keyword rules as the browser
client, backs off on `429` per the [rate-limit docs](https://docs.kalshi.com/getting_started/rate_limits),
and reads demo credentials from environment variables only.

CI runs all of the above (plus `node scripts/check-links.mjs`-style syntax checks) in
`.github/workflows/site-qa.yml`; the root site itself is rebuilt and checked by `.github/workflows/pages.yml`.

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
<<<<<<< HEAD
| `dash/alerts.html` | **Live alerting (session arena-f89b55f7):** two scrolling chats — every ≥ $0.10 swing vs. the high-ROI model filter (score ≥ 70) — plus the ROI model ranking, jump-cause research links, a compact liquidity ladder, a chart with seconds→days windows and jump markers, and automated simulated strategies (`momentum-10c`, `fade-jump`) that write into Portfolio/Analysis. REST-polled (`GET /markets?tickers=…`, 1 batched request / 15 s + backoff); see `dash/flagged.html` F-08–F-10. |
=======
| `dash/alerts.html` | **Live alerting (merged engine, sessions arena-f89b55f7 + arena/815b546d):** two scrolling chats — every ≥ $0.10 swing vs. the high-ROI model filter (score ≥ 70) — plus the ROI model ranking, jump-cause research links, a compact liquidity ladder, a chart with seconds→days windows and jump markers, resolutions logged from the API `result` field, snapshot trades replay, and automated simulated strategies (`momentum-10c`, `fade-jump`) that write into Portfolio/Analysis. Each 15 s cycle: 1 batched `GET /markets?tickers=…` + trade-walk of the top 4 markets (`GET /markets/trades`); see `dash/flagged.html` F-08–F-12. |
>>>>>>> origin/main
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
| `dash/data/snapshot.json` | Verified point-in-time capture of the official demo API (2026-11-20) — the only market data committed in the repo; every row carries its `source_url`. Used only as fallback when the browser cannot reach the API, and clearly labeled. |
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
