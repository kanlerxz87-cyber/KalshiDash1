# SOURCES.md — Source Register

Every factual claim in this repository and site maps to a row here. Verification performed 2026-11-20 by fetching each source directly. Official sources = docs.kalshi.com and Kalshi's own demo API hosts. Third-party pages are informational only and verify nothing.

## A. Official documentation (docs.kalshi.com)

| # | Claim verified | Source URL | Method | Date |
|---|---|---|---|---|
| D1 | Demo/production REST + WS base URLs; demo endpoints match the project brief exactly | https://docs.kalshi.com/getting_started/api_environments | page fetch | 2026-11-20 |
| D2 | Demo env: mock funds, separate credentials, price-representativeness warning, demo web root | https://docs.kalshi.com/getting_started/demo_env | page fetch | 2026-11-20 |
| D3 | Public market data (series/events/markets/orderbook) needs no auth | https://docs.kalshi.com/getting_started/quick_start_market_data | page fetch + live call | 2026-11-20 |
| D4 | Auth headers; signature = timestamp+METHOD+path (no query); RSA-PSS/Ed25519 | https://docs.kalshi.com/getting_started/quick_start_authenticated_requests | page fetch | 2026-11-20 |
| D5 | Orderbook: yes/no bid arrays [price, size] ascending, no asks, depth param, empty→200 | https://docs.kalshi.com/getting_started/orderbook_responses + https://docs.kalshi.com/api-reference/market/get-market-orderbook | page fetch + live call | 2026-11-20 |
| D6 | Get Markets: status filters, ordering rules (no volume sort), caching caveat | https://docs.kalshi.com/api-reference/market/get-markets | page fetch + live calls | 2026-11-20 |
| D7 | Get Events: params (status, series_ticker, tickers, with_nested_markets, min_close_ts, min_updated_ts, limit≤200, cursor); NO category param; event category deprecated | https://docs.kalshi.com/api-reference/events/get-events | page fetch + live calls | 2026-11-20 |
| D8 | Market schema: status enum (initialized…finalized); result enum ('yes','no','scalar',''); price/size/volume fields; price_ranges grid | https://docs.kalshi.com/api-reference/market/get-market | page fetch + live calls | 2026-11-20 |
| D9 | Series list: category (exact, case-sensitive), tags, include_volume; fee_type/fee_multiplier; settlement sources | https://docs.kalshi.com/api-reference/market/get-series-list | page fetch + live calls | 2026-11-20 |
| D10 | Candlesticks: period_interval ∈ {1,60,1440} minutes; ≤5,000 periods; start/end_ts in seconds; OHLC schema | https://docs.kalshi.com/api-reference/market/get-market-candlesticks | page fetch + live call | 2026-11-20 |
| D11 | Settlement: $1/contract to winning side; timing; zero settlement fees for yes/no | https://docs.kalshi.com/getting_started/market_settlement | page fetch | 2026-11-20 |
| D12 | Fixed-point: _dollars prices ≤4dp, _fp counts ≤2dp, price grid structures | https://docs.kalshi.com/getting_started/fixed_point_migration | page fetch | 2026-11-20 |
| D13 | Rate limits: token buckets; most requests 10 tokens; unauth separate limits; 429 + X-RateLimit-* headers | https://docs.kalshi.com/getting_started/rate_limits | page fetch | 2026-11-20 |
| D14 | Create Order (V2) = POST /portfolio/events/orders; request/response schema; legacy /portfolio/orders → 410 Gone | https://docs.kalshi.com/api-reference/orders/create-order-v2 | page fetch | 2026-11-20 |
| D15 | WS channels (public: ticker/trade/market_lifecycle_v2/…; private: orderbook_delta/fill/…) and authenticated WS sessions | https://docs.kalshi.com/getting_started/quick_start_websockets (via official docs index https://docs.kalshi.com/llms.txt + https://docs.kalshi.com/changelog) | page fetch | 2026-11-20 |
| D16 | Endpoint inventory (portfolio, orders, order groups, subaccounts, block trades, RFQs, historical) | https://docs.kalshi.com/llms.txt | page fetch | 2026-11-20 |

## B. Live demo-API captures (all 2026-11-20, unauthenticated public endpoints)

| # | Request | Produced | Where used |
|---|---|---|---|
| A1 | GET /markets?limit=2 | market object shape probe | schema verification |
| A2 | GET /series?category=Economics&tags=Oil%20and%20energy&include_volume=true&limit=50 | gas/energy series + volumes | snapshot, events page, exec summary |
| A3 | GET /series?category=Economics&limit=50 | KXGAS-MONTH + others | snapshot |
| A4 | GET /series?category=Elections&include_volume=true&limit=50 | elections series + volumes | snapshot, exec summary |
| A5 | GET /series?category=Culture&limit=50 | 2 culture series (volumes not requested — blank) | snapshot (F-05) |
| A6 | GET /series?category=Crypto&limit=50 | crypto series | snapshot (F-05) |
| A7 | GET /series?category=Sports&tags=Golf&include_volume=true&limit=50 | golf series + volumes | snapshot, exec summary |
| A8 | GET /markets?series_ticker=KXELECTIONEMERGENCY&status=open&limit=10 | KXELECTIONEMERGENCY-27JAN01 row | snapshot, tracker |
| A9 | GET /markets?series_ticker=KXDEMOFUTHOURLY&status=open&limit=5 | KXDEMOFUTHOURLY-26NOV20H12-UP row | snapshot, tracker, market page default |
| A10 | GET /markets?series_ticker=KXGAS-MONTH&status=open&limit=10 (also KXAAAGASDSD, AAAGASD via /events) | empty results | findings (no open gas markets at capture) |
| A11 | GET /markets?series_ticker=KXPGAR1T5&status=open&limit=10 (also KXPGAUNDERPAR) | empty results | findings (golf) |
| A12 | GET /markets?series_ticker=KXXBANNEDGROK&status=open&limit=10 (also KXXBANNEDMURRAYHILLGUY1) | empty results | findings (culture) |
| A13 | GET /events?series_ticker=KXAAAGASDSD&status=settled&with_nested_markets=true&limit=2 | gas strike ladder, result "no", AAA source | snapshot resolution log |
| A14 | GET /markets?status=settled&limit=25 | result "yes"/"no"; settlement_value_dollars semantics | snapshot, resolution docs |
| A15 | GET /markets/KXDEMOFUTHOURLY-26NOV20H12-UP/orderbook?depth=10 | orderbook sample | snapshot ladder fallback |
| A16 | GET /series/KXDEMOFUTHOURLY/markets/KXDEMOFUTHOURLY-26NOV20H12-UP/candlesticks?start_ts=1795169439&end_ts=1795173039&period_interval=1 | 10 × 1-min candles | snapshot chart fallback |
| A17 | GET /events?status=open&category=Crypto&with_nested_markets=true&limit=10 | mixed-category events (category ignored — F-01) | flagged; KXNEXTNATOSECGEN rows |
| A18 | GET /events?status=open&limit=100 | taxonomy sample (World/Elections/Climate/Science categories seen) | research |

All A-requests were issued to `https://external-api.demo.kalshi.co/trade-api/v2/...`; each snapshot row in `docs/data/snapshot.json` carries its own `source_url` field pointing at the exact request.

## C. Informational third-party pages (verify nothing)

- https://predictreport.io/blog/kalshi-api-guide — agrees with D1/D3/D4
- https://www.botforkalshi.com/blog/kalshi-api-tutorial — agrees with D15
- https://blog.predictefy.com/kalshi-api-key — agrees with D2/D4
- https://agentbets.ai/guides/kalshi-api-guide — agrees with D1/D4

## D. Deliberately NOT sourced (blank + flagged)

| Item | Why blank | Flag |
|---|---|---|
| Real demo-account balance/positions/fills/P&L | Requires account-holder credentials; may not be requested or stored | F-02 |
| Series volume_fp for Culture + Crypto rows | Query batches omitted include_volume; not estimated | F-05 |
| KXNEXTNATOSECGEN-99-BWAL bid/ask/volume fields | Truncated capture; not estimated | F-06 |
| Exact unauthenticated rate limits | Not published in docs | Questions D2 |
| Fee amounts in P&L | Fee schedule PDF not parsed; fees set to 0 and labeled | S-05 |
