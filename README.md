# KalshiDash1

Kalshi demo dashboard — tracks live events and contract prices on the [Kalshi demo Trade API v2](https://external-api.demo.kalshi.co/trade-api/v2).

## Focus topics
Gas prices, elections, culture, crypto, and golf.

## Live API base
- REST: `https://external-api.demo.kalshi.co/trade-api/v2` (also `https://demo-api.kalshi.co/trade-api/v2`)
- WebSocket: `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`

## Site
- `index.html` — landing page + executive summary
- `dashboard.html` — live interactive price graph (X = time, Y = contract price), liquidity readout
- `elections.html`, `crypto.html`, `golf.html`, `culture.html`, `gas-prices.html` — category subpages with sourced tables
- `portfolio.html` — paper-trade portfolio tracker (live execution requires Kalshi API keys)
- `suggestions.html` — improvement suggestions (review before implementing)
- `questions.html` — questions / info / answers before decisions
- `flagged-review.html` — flagged irregularities & unverified items with source links

## Data policy
Every table row links to an official Kalshi demo API source. Values not confirmed from an official source are left blank and flagged. Nothing is inferred or filled in.

## GitHub Pages
Published from `main` (root). See COORDINATION.md for task board and PR/merge record.
