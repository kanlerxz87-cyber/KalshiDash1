# Executive Summary — KalshiDash1

**Date:** 2026-11-20 · **Environment:** Kalshi demo (`external-api.demo.kalshi.co`) · **Branch:** `arena/cdfe52bd-kalshidash1`

## 1. The brief, in one paragraph

Build a live, interactive dashboard for the Kalshi **demo** exchange that (a) tracks the highest-dollar live events in **gas prices, elections, culture, crypto, and golf** until they resolve **yes/no**, (b) shows price movement on a time-axis chart (seconds/minutes/hours windows) and orderbook liquidity (contracts available at each price), (c) executes trades and tracks portfolio performance on the demo account with trade categorization and strategy analysis, (d) proposes improvements through a reviewable suggestions board, and (e) lists every question, known fact, and missing input before decisions are made — all verified line-by-line against official sources, published as a GitHub Pages site, with nothing inferred.

## 2. Verified platform facts (official sources only)

| Fact | Value | Source |
|---|---|---|
| Demo REST (recommended) | `https://external-api.demo.kalshi.co/trade-api/v2` | [demo_env.md](https://docs.kalshi.com/getting_started/demo_env) |
| Demo REST (also supported) | `https://demo-api.kalshi.co/trade-api/v2` | [api_environments.md](https://docs.kalshi.com/getting_started/api_environments) |
| Demo WebSocket (recommended) | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [api_environments.md](https://docs.kalshi.com/getting_started/api_environments) |
| Demo WebSocket (also supported) | `wss://demo-api.kalshi.co/trade-api/ws/v2` | [api_environments.md](https://docs.kalshi.com/getting_started/api_environments) |
| Public market data | No API key needed (series/events/markets/orderbook/candlesticks/trades) | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) — also verified live 2026-11-20 |
| Private endpoints | `KALSHI-ACCESS-KEY/-SIGNATURE/-TIMESTAMP` headers; signature = timestamp+method+path | [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) |
| Order placement | `POST /portfolio/events/orders` (V2); legacy `/portfolio/orders` writes → 410 Gone | [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2) |
| Resolution | `result` ∈ {"yes","no","scalar",""}; winners get $1/contract | [Get Market](https://docs.kalshi.com/api-reference/market/get-market) · [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) |
| Demo caveat | Mock funds, separate keys, prices may not reflect real markets | [demo_env.md](https://docs.kalshi.com/getting_started/demo_env) |

The endpoint table in the project brief matches the official documentation **exactly**.

## 3. What was built

1. **GitHub Pages site** (`dash/`) — clean dashboard UI, category subpages, every table row linked to its official source.
2. **Live Events tracker** — five topic boards ranked by dollar volume (24h, then total), each row showing price, sizes, volume, open interest, close time and resolution state; markets stay tracked until `result` flips to yes/no. Includes a resolution log built from verified settled markets (e.g. the KXAAAGASDSD-26NOV14 gas strike ladder resolved `no` against AAA prices; KXDEMOFUTHOURLY-26NOV20H11-UP resolved `yes`).
3. **Market detail** — canvas price chart with time windows (5 min at seconds granularity accumulated in-browser; 1 h/6 h/24 h from 1-minute candles; 7 d from 60-minute candles — the API's finest public candle is 1 minute per [docs](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)), full orderbook ladder with per-price contract counts, rules and settlement sources.
4. **Simulated trading & portfolio** — browser-recorded trades against live prices, P&L, win rate, exposure, equity curve, settlement watcher; clearly labeled SIMULATED.
5. **Trade analysis** — topic × strategy breakdown; five strategy types mapped to verified exchange mechanics (hold-to-resolution, momentum, mean reversion, liquidity provision, event catalyst).
6. **Suggestions board** — 8 proposals (impact/effort/evidence) with approve/reject workflow, deferred until reviewed.
7. **Questions & Gaps** — the decision-input register: what's verified, what's missing, how to discover each missing item.
8. **Verification apparatus** — `SOURCES.md`, `VERIFICATION.md`, `REVIEW.md`, Flagged-for-Review page (F-01…F-07), link checker.

## 4. Key findings from the verified snapshot (2026-11-20 11:10 UTC)

- **Focus-topic liquidity is concentrated.** Top row: `KXELECTIONEMERGENCY-27JAN01` (Trump executive action re: 2026 midterms) with 7,475.30 contracts volume and equal open interest; second: demo hourly BTC `KXDEMOFUTHOURLY-26NOV20H12-UP` (1,175.00 contracts, 735.00 in 24h). Gas, golf, and culture series had **no open markets** at capture (daily/tournament schedules) — recorded as findings with empty-result probes, not errors.
- **Series-level dollar volume leaders captured:** KXELECTIONEMERGENCY 7,517.00 · SPRMIN 1,269.00 · AAAGASD 234.00 · KXPGAR1T5 219.00 · KXAAAGASDSD 128.00 · KXAAAGASED 89.00 (contracts; $1 notional each).
- **Resolution mechanics confirmed live:** settled markets show `result` "yes"/"no" with `settlement_value_dollars` $1.0000 (yes) or $0.0000 (no) for the YES side.
- **API quirks found:** `GET /events` silently ignores `category` params (F-01); no server-side volume ranking exists (F-03).

## 5. What is intentionally blank

Real demo-account portfolio figures (requires the account holder's API keys — F-02), series volumes for two query batches (F-05), and truncated capture fields (F-06). Each is listed on the Flagged page with its discovery plan.

## 6. Recommended next decisions (from the suggestions board)

1. **S-01** Wire real demo-account sync via local key-based export (never in-repo).
2. **S-03** Scheduled scanner for exact cross-market dollar-volume rankings.
3. **S-02** WebSocket streaming once keys exist (WS sessions are authenticated even for public channels).
4. **S-05** Fee-aware P&L using per-series `fee_type`/`fee_multiplier`.

Full detail: `SOURCES.md` (provenance), `VERIFICATION.md` (checks), `COORDINATION.md` (task log), site pages **Questions & Gaps** and **Flagged for Review**.

---

# Addendum — live alerting system (session-cb49437b, 2026-11-20)

## The gap this closed

The brief's central mechanism — **live alerting on contract-price swings of $0.10 or more, shown as
two scrolling chats** — was not implemented anywhere in the repository. A grep for alert/chat logic
found only a suggestion-review widget. Everything below was added, tested and run against the live
demo API.

## What now exists

| Component | Where | What it does |
|---|---|---|
| Alert engine | `tools/live_engine.mjs` | Discovers the five focus topics, samples prices, detects ≥ $0.10 moves (sample-to-sample **and** from 1-minute candles), tracks resolutions, scores alerts |
| Live console | `alerts/index.html` | Two scrolling feeds: **All events** and **High ROI**; price chart (5 min → 7 days); per-topic highest-dollar boards; resolution log; liquidity ladders |
| Scheduled sampler | `.github/workflows/live-alerts.yml` | Runs every 10 minutes so the record continues with no browser open |
| Feed validator | `scripts/check_alerts.mjs` | Blocks any published row that is below threshold, has an invented price, or cites a non-official source |
| Page test | `scripts/check_alerts_page.mjs` | jsdom render test of both feeds, the filter and the no-invented-price rule |

## The honest state of the data

The engine ran successfully against `https://external-api.demo.kalshi.co/trade-api/v2` and captured
real markets for gas, elections, crypto and golf. **Alerts so far: zero.** The demo exchange is
quiet — repeated samples of the top contracts returned identical prices. The feeds display that
state instead of seeding example alerts, and the threshold, detection and rendering are covered by
automated tests so the mechanism is proven independently of whether the demo happens to move.

## Verified platform facts (see `docs/ALERTS.md` §2 for links)

* Public market data needs no authentication; **orders, balances and positions do**.
* The WebSocket ticker channel is real-time but its handshake is **authenticated**, so a static site
  cannot stream prices; this design uses a scheduled sampler plus in-page polling, and says so.
* Kalshi publishes **no traded-dollar field**, so "highest dollar amount" is estimated as
  contracts × price and labelled as an estimate everywhere.
* Winning contracts pay $1; results are `yes` / `no` / `scalar`.

## Findings that need your review

* **F-A1 (upstream API inconsistency):** the demo API's tag taxonomy omits `Culture` even though
  `GET /series?category=Culture` serves Culture series. The engine's own guard found this.
* **F-A3:** the dollar ranking is derived, not official.
* **F-A4:** the high-ROI feed uses a published heuristic, not a back-tested model.
* **F-A5:** "gas prices" deliberately excludes crude oil that shares the same tag.
* **F-A8:** real demo-account portfolio sync still needs your API key; nothing is requested or stored.

Full detail with links: `flagged.html` (items F-A1 … F-A8) and `docs/ALERTS.md`.

> **ID note.** The alert session's working IDs (F-A1…F-A8) were renumbered when their rows were merged into
> the single published flagged list, because the earlier batches already used F-21…F-33 and F-34…F-38
> (session b71d6814's settlement-source audit). The alert-batch mapping is: F-A1 → F-50 · F-A2 → F-51 ·
> F-A3 → F-03 · F-A4 → F-53 · F-A5 → F-05 · F-A6 → F-57 · F-A7 → F-51 · F-A8 → F-24. See the
> [Flagged for review page](flagged.html).
