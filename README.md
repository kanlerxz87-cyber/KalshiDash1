# KalshiDash1

Kalshi **demo** dashboard suite: tracks the highest-dollar live events on Kalshi's demo environment for
five topics — **gas prices, elections, culture, crypto, golf** — follows each event until it resolves
(YES/NO), charts contract price against time with selectable windows, shows order-book liquidity
(contracts available at each price), and supports portfolio tracking, trade categorization, strategy
backtests, a suggestions review board and a pre-decision questions page.

**Live site (GitHub Pages):** https://kanlerxz87-cyber.github.io/KalshiDash1/
Pages source: `main` branch, repository root (`/`).

> Demo environment only. Mock funds. Kalshi's docs state that "the price and behavior of markets in the
> demo environment may not be reflective of those in real markets"
> ([source](https://docs.kalshi.com/getting_started/demo_env)). Nothing here is financial advice.

## Two dashboards in this repo

Three agent sessions built this repository, and their work was kept rather than overwritten:

| Tree | Built by | What it is |
|------|----------|------------|
| repository root (`index.html`, `dashboard.html`, `categories/`, `portfolio.html`, `trades.html`, …) | `session-arena-15d2acea`, `arena-f661348d-kalshidash1` | Landing page, first live dashboard with price graph and order book, static category findings pages, flagged page |
| `docs/` | `session-3f5650f9` | Full live-data suite: browser-side demo-API client, ranking of open markets by estimated traded notional, price chart with 60s → 7d windows, order-book depth, resolution tracking, simulator + optional demo-account trading, strategy backtests, methodology, sources/verification table, flagged page, one subpage per category |

Both are published. `docs/` is reachable at `/docs/` on the live site and the root landing page links to it.
The decision of which becomes the single canonical site is recorded as
[SUG-08](https://kanlerxz87-cyber.github.io/KalshiDash1/docs/suggestions.html) and
[R-02](https://kanlerxz87-cyber.github.io/KalshiDash1/docs/flagged.html) — it was deliberately **not**
resolved by deleting another session's work.

## Pages (docs/ suite)

| Path | Purpose |
|------|---------|
| `docs/index.html` | Live dashboard: exchange status, highest-dollar open markets, price chart, order-book liquidity, discovered series |
| `docs/executive-summary.html` | Executive summary of important details, each claim sourced |
| `docs/events.html` | Tracked markets with status + YES/NO resolution from the API `result` field |
| `docs/gas-prices.html`, `docs/elections.html`, `docs/culture.html`, `docs/crypto.html`, `docs/golf.html` | Per-category subpages: open markets, resolutions, and the exact series that matched |
| `docs/portfolio.html` | Simulator portfolio (local), trade categorization, optional demo-account connect (balance/positions/fills) |
| `docs/trade.html` | Trade execution: simulator fills, or a real demo order via `POST /portfolio/events/orders` |
| `docs/strategies.html` | Strategy templates and candlestick backtests (educational) |
| `docs/suggestions.html` | Suggestions board with per-option trade-offs, voting and "choose this path" (browser-local) |
| `docs/questions.html` | Questions / information needed / answers, with how-to-discover steps |
| `docs/methodology.html` | How every number is produced: discovery rules, ranking formula, chart sources, order-book semantics, accounting |
| `docs/sources.html` | Line-by-line verification table (S-01 … S-51), one official link per row |
| `docs/flagged.html` | Flagged for Review: unverified items, doc irregularities, repo findings |

## Verified demo endpoints

From [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) and
[API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments):

| Surface | Recommended demo endpoint | Also supported |
|---------|---------------------------|----------------|
| REST Trade API | `https://external-api.demo.kalshi.co/trade-api/v2` | `https://demo-api.kalshi.co/trade-api/v2` |
| WebSocket API | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | `wss://demo-api.kalshi.co/trade-api/ws/v2` |

Public market-data endpoints need no authentication
([Market Data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data)).
Portfolio and order endpoints are authenticated with an API Key ID + private key created in
[demo.kalshi.co](https://demo.kalshi.co/), signed as `timestamp + METHOD + path` with RSA-PSS/SHA-256 (or
Ed25519) — [quick start](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests).
**No credential is ever stored in this repository**, and the site keeps a pasted key in the visitor's
browser only.

## Verification policy

* Every table row on the site links to the official page it was read from
  (see [`docs/sources.html`](docs/sources.html)); values were read from
  [docs.kalshi.com](https://docs.kalshi.com) on 2026-11-20.
* If a value cannot be confirmed from an official source it is left **blank** and listed on
  [Flagged for Review](docs/flagged.html). Nothing is inferred, defaulted, or filled with placeholder data.
* Computed numbers (estimated notional, cumulative depth, implied asks) are labelled as ours and shown
  next to the API fields they come from.
* **No market data is committed.** Prices, books and resolutions are fetched by the browser at page load,
  so a stale snapshot can never be mistaken for live data. If the API is unreachable, the tables say so.
* Three irregularities in the official docs were found during review and are published rather than
  silently worked around: status-vocabulary mismatch (F-03), a broken internal link slug (F-12), and
  overlapping deprecation dates (F-13).

## Tools

```bash
python3 tools/linkcheck.py                     # fail if any internal link is broken
python3 tools/kalshi_client.py snapshot --with-settled --with-candles   # durable JSON snapshot (needs network)
python3 tools/kalshi_client.py markets --category crypto --limit 25
```

`tools/kalshi_client.py` is standard-library only, uses the same category keyword rules as the browser
client, backs off on `429` as the [rate-limit docs](https://docs.kalshi.com/getting_started/rate_limits)
recommend, and reads demo credentials from environment variables only.

## Coordination

[`COORDINATION.md`](COORDINATION.md) is the shared task board for parallel agent sessions: claims, file
scopes, conflict/handoff log, sources per task, and the integration record (PR link, merge result, Pages
status). Read it before starting; claim before editing; never edit another session's claimed files.

## Notes and limitations

* Ranking by "highest dollar amount" is an **estimate** (`volume_fp × last price`): Kalshi publishes no
  traded-dollar field, and `notional_value_dollars` means the settlement value of a single contract
  ([Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)).
* Sub-minute price series come from this site's own 5-second polling: candlesticks support only 1, 60 and
  1440-minute intervals ([Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)).
* Real-time streaming is not possible from a static browser page: the WebSocket handshake requires signed
  headers, which browsers cannot set ([WS quick start](https://docs.kalshi.com/getting_started/quick_start_websockets)).
* Whether a Pages-hosted page may call the demo API cross-origin (CORS) could not be confirmed from any
  official source and is flagged (F-01); the site degrades to an explicit "unavailable" state instead of
  inventing numbers.
* Demo activity varies: some categories can legitimately be empty at a given moment.
* Simulator P&L is gross (no fee model), which is stated in the UI and flagged (F-09).

Official docs: https://docs.kalshi.com · Demo site: https://demo.kalshi.co/
