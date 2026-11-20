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

1. **GitHub Pages site** (`docs/`) — clean dashboard UI, category subpages, every table row linked to its official source.
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
