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
- `elections.html`, `crypto.html`, `golf.html`, `culture.html`, `gas-prices.html` — category subpages with sourced tables
- `categories/` — additional category pages (parallel session arena-15d2acea): crypto, culture, elections, gas, golf
- `portfolio.html` — paper-trade portfolio tracker (live execution requires Kalshi API keys)
- `suggestions.html` — improvement suggestions (review before implementing)
- `questions.html` — questions / info / answers before decisions
- `flagged-review.html` — flagged irregularities & unverified items with source links
- `flagged.html` — parallel session's flagged items (preserved)
- `qa.html` — parallel session's Q&A (preserved)
- `docs/api-research.md` — parallel session's API research (preserved)

## Data policy
Every table row links to an official Kalshi demo API source. Values not confirmed from an official source are left blank and flagged. Nothing is inferred or filled in.

## GitHub Pages
Published from `main` (root). See COORDINATION.md for task board and PR/merge record.

## Parallel sessions
This repo was worked on by multiple agent sessions. Session arena-15d2acea merged PR #1 first; session arena-652d8f6d rebased onto main and merged PR #2. Overlapping core files were resolved by keeping a single coherent implementation; unique files from both sessions were preserved. See COORDINATION.md.
