# Executive Summary — KalshiDash1

**Updated:** 2026-11-21 20:28 UTC · **Environment:** Kalshi demo (`external-api.demo.kalshi.co`) · **Branch:** `arena/96019ad5-kalshidash1` · **Session:** `session-96019ad5`

> **Scope and freshness note:** Sections 4–6 below preserve the historical findings from the explicitly dated
> 2026-11-20 11:10 UTC snapshot; those numbers are not current-market claims. Current repository/feed checks and
> the stale-feed discrepancy are recorded in [this session's dated verification report](verification/2026-11-21-96019ad5.md).
> The canonical live site is the root GitHub Pages build linked from [README](README.md), not the older `dash/` suite.

## 1. The brief, in one paragraph

Build a live, interactive dashboard for the Kalshi **demo** exchange that (a) tracks the highest-dollar live events in **gas prices, elections, culture, crypto, and golf** until they resolve **yes/no**, (b) shows price movement on a time-axis chart (seconds/minutes/hours windows) and orderbook liquidity (contracts available at each price), (c) executes trades and tracks portfolio performance on the demo account with trade categorization and strategy analysis, (d) proposes improvements through a reviewable suggestions board, and (e) lists every question, known fact, and missing input before decisions are made — all verified line-by-line against official sources, published as a GitHub Pages site, with nothing inferred.

## Current operational status (2026-11-21 UTC)

> **Current status note — 2026-11-21 20:28 UTC (session-96019ad5).** This section replaces the earlier 06:30-UTC
> status line ("173 alert rows", Pages commit `0a32e1d`) which described an earlier feed and no longer matches the
> committed artifact. Historical findings from the 2026-11-20 11:10 UTC snapshot are preserved in the sections below
> and are not current-market claims; the 2026-11-21 verification record is in [the dated verification report](verification/2026-11-21-96019ad5.md).

| Check | Observed state | Source |
|---|---|---|
| Published background feed | **11 alert rows**, generated **2026-11-21T20:24:48Z** — crypto 6 · elections 5 (0 culture / 0 gas / 0 golf in the window); 3 high-ROI flags; 0 resolutions; 589 duplicates collapsed; 60 tracked markets; 8 orderbooks; all 11 by trade detection. | [Committed feed](data/live/feed.json) · [engine sample commit](https://github.com/kanlerxz87-cyber/KalshiDash1/commit/25885b9c48b2e66d3621503e39242ba71dcb7d69) |
| Feed staleness (live-alert threshold 20/45 min) | **FRESHNESS OK** — the committed feed is 1.3 minutes old at last check against the 45-minute stale limit; the scheduled sampler produced a new run at 2026-11-21T20:24:48Z (commit `25885b9`). Historical stall (F-45/F-58) is resolved for this run set; scheduled-run reliability remains documented as delayed/dropped and keeps the flag. | [freshness_check.mjs](tools/freshness_check.mjs) · [schedule docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) |
| Data snapshot | Captured **2026-11-21T16:02:38.983Z** by the keepalive workflow (run 44922333872, success). Not re-captured from this session's offline sandbox. | [data/snapshot.json](data/snapshot.json) |
| Scheduled write-back runs on `main` | `live-alerts` engine sample commit `25885b9` — success, 2026-11-21T20:24:59Z (generated feed 20:24:48Z). `refresh-data` schedule run 44905774178 — success, 2026-11-21T12:49:05Z. `keepalive` run 44922333872 — success, 2026-11-21T16:02:13Z. | [engine sample](https://github.com/kanlerxz87-cyber/KalshiDash1/commit/25885b9c48b2e66d3621503e39242ba71dcb7d69) · [snapshot](https://github.com/kanlerxz87-cyber/KalshiDash1/actions/runs/44905774178) · [keepalive](https://github.com/kanlerxz87-cyber/KalshiDash1/actions/runs/44922333872) |
| GitHub Pages | Latest build for `main` commit `25885b9` reports **built**, no error — 2026-11-21T20:25:01Z → +20.8 s. | [Pages build API](https://api.github.com/repos/kanlerxz87-cyber/KalshiDash1/pages/builds/latest) |
| Offline checks | `npm test` (engine, feed, flood-guard, page render, ids, source rows, lab, links) — **PASS**; `build-site --check` — PASS; duplicate-id scan — PASS (549 ids, 0 dupes); freshness-badge — PASS (53 assertions). | [Verification report](verification/2026-11-21-96019ad5.md) |
| Exchange status / demo reachability | Not re-fetched from this sandbox (TLS failure to `external-api.demo.kalshi.co` and `kanlerxz87-cyber.github.io` — outbound access is github/npm/pypi only). The committed snapshot's meta records the official capture method and URL. | [data/snapshot.json](data/snapshot.json) · [official demo exchange status](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) |

The committed feed row counts describe the last successful engine sample, not independent confirmation of market
health. Official demo trades for the BTC ticker alternate between `$0.97` and `$0.01` while the current book is very
wide; those API-returned values are preserved but flagged for review (F-BFC-03) rather than labelled false or treated
as a reliable ROI signal. The interactive browser path was not checked across every visitor's CORS/network setup.
See [F-BFC-01 through F-BFC-03](verification/2026-11-21-bfc2de45.md#findings-requiring-review).

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
> F-A3 → F-03 · F-A4 → F-53 · F-A5 → F-05 · F-A6 → F-57 · F-A7 → F-51 · F-A8 → F-24. The later
> working ID **F-A9** (the 2026-11-20 price-coherence fix, whose “clean state reset” the alert note
> cites) maps to **F-49**. See the [Flagged for review page](flagged.html).
