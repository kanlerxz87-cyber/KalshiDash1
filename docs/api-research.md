# Kalshi API Research (verified against official docs)

Source: https://docs.kalshi.com (Kalshi API Documentation, Mintlify)
Verified pages:
- Welcome/Introduction: https://docs.kalshi.com/welcome
- Demo environment: https://docs.kalshi.com/getting_started/demo_env
- Full page index: https://docs.kalshi.com/llms.txt

## Demo environment (official)
- Demo site: https://demo.kalshi.co/
- "For testing purposes, Kalshi offers a demo environment with mock funds."
- "credentials are not shared between this environment and production."
- "The price and behavior of markets in the demo environment may not be reflective of those in real markets."
- Demo account tutorial: https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account

## Recommended demo endpoints (official, from demo_env page)

| Surface | Recommended demo endpoint | Also supported |
|---|---|---|
| REST Trade API | https://external-api.demo.kalshi.co/trade-api/v2 | https://demo-api.kalshi.co/trade-api/v2 |
| WebSocket API | wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2 | wss://demo-api.kalshi.co/trade-api/ws/v2 |

## Key Predictions REST endpoints (official API reference)

Market data (public, no auth):
- GET /events — all events (excludes multivariate)
- GET /event/{ticker} — single event
- GET /markets — markets, filter by status (unopened/open/closed/settled)
- GET /market/{ticker} — single market (yes/no positions, price, volume, settlement rules)
- GET /market-orderbook?market_ticker= — order book (yes bids and no bids only; no asks returned — a yes bid at price X is equivalent to an ask for no at 100-X)
- GET /multiple-market-orderbooks — order books for multiple markets
- GET /trades — all trades across markets
- GET /series / GET /series-list — series templates
- GET /market-candlesticks — candlesticks; period in minutes (valid: 1, 60, 1440)
- GET /batch-get-market-candlesticks, GET /event-candlesticks
- GET /event-live-data — live data for an event (crypto price charts, commodity price timeseries, weather observations)
- GET /live-data — live data for a milestone

Portfolio / trading (authenticated, API key required):
- GET /balance — balance and portfolio value
- GET /positions — unsettled positions
- GET /settlements — settlement records
- GET /fills — member fills
- GET /orders — orders (resting, canceled, executed)
- POST /orders (V2, create-order-v2) — submit event-market orders (single-book bid/ask, fixed-point dollar prices)
- DELETE /orders (cancel-order-v2), PATCH amend-order-v2
- GET /queue-positions-for-orders

Authentication: API key with RSA-PSS (SHA-256) or Ed25519 signature. API keys generated per-environment; demo credentials do not work on production.

Sandbox limitation: outbound internet from this agent sandbox is restricted to github.com / api.github.com / codeload.github.com / registry.npmjs.org / pypi.org / files.pythonhosted.org. The Kalshi API (kalshi.co) CANNOT be called directly from this environment. Therefore:
- All Kalshi values shown on the site are sourced from official docs links only, OR left blank and flagged "unverified".
- No live trade execution or live portfolio read is possible without a user-provided API key and CORS-enabled access from the browser.
- The site is built so a user can drop in their own demo API key and connect to the demo WebSocket/REST endpoints.

## Irregularities / unverified items (flagged for review)
- No Kalshi demo API credentials were provided to this session, so portfolio balance, positions, fills, and order execution cannot be demonstrated or verified.
- Live market prices / orderbooks / candlesticks could not be fetched from kalshi.co (sandbox network restriction); all such values are blank/unverified pending live connection.
- CORS policy of external-api.demo.kalshi.co from GitHub Pages is not confirmed; live fetch from the browser may be blocked and would need a proxy or API-key header setup.
