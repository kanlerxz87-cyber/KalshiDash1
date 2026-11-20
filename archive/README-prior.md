# KalshiDash1

Kalshi demo dashboard — tracks live events and contract prices on the [Kalshi demo Trade API v2](https://external-api.demo.kalshi.co/trade-api/v2).

## Focus topics
Gas prices, elections, culture, crypto, and golf.

## Live API base
- REST Trade API: `https://external-api.demo.kalshi.co/trade-api/v2` (also `https://demo-api.kalshi.co/trade-api/v2`)
- WebSocket API: `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (also `wss://demo-api.kalshi.co/trade-api/ws/v2`)

## Site
- `index.html` — landing page + executive summary
- `dashboard.html` — live interactive price graph (X = time, Y = contract price), selectable graph length (seconds/minutes/hours), liquidity readout
- `assets/js/graph.js` — Chart.js price-over-time graph
- `assets/js/charts.js` — additional chart/orderbook liquidity module (parallel session arena-f661348d)
- `elections.html`, `crypto.html`, `golf.html`, `culture.html`, `gas-prices.html` — category subpages with sourced tables
- `categories/` — additional category pages (parallel sessions): crypto, culture, elections, gas, golf
- `404.html` — GitHub Pages 404 page
- `trades.html` — trades page (parallel session arena-f661348d)
- `portfolio.html` — paper-trade portfolio tracker (live execution requires Kalshi API keys)
- `suggestions.html` — improvement suggestions (review before implementing)
- `questions.html` — questions / info / answers before decisions
- `qa.html` — parallel session's Q&A (preserved)
- `flagged-review.html` — flagged irregularities & unverified items with source links
- `flagged.html` — parallel session's flagged items (preserved)
- `docs/api-research.md` — parallel session's API research (preserved)

## Data policy
Every table row links to an official Kalshi demo API source. Values not confirmed from an official source are left blank and flagged. Nothing is inferred or filled in.

## GitHub Pages
Published from `main` (root). See COORDINATION.md for task board and PR/merge record.

## Parallel sessions
Three agent sessions built this repo in parallel. Session arena-15d2acea (PR #1), session arena-f661348d (PR #3), and this session arena-652d8f6d (PR #2, integration). All three PRs merged to main. Overlapping core files were resolved into a single coherent implementation; unique files from every session were preserved. See COORDINATION.md.
