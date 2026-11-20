# KalshiDash1

Kalshi demo dashboard — tracks the highest dollar-amount live events on Kalshi (gas prices, elections, culture, crypto, golf), portfolio performance on the Kalshi demo account, price graphs, liquidity, trade analysis, suggestions, and a pre-decision Q&A register.

## Live site (GitHub Pages)
Published from the `main` branch. Enable GitHub Pages in repo Settings → Pages → source: `main` / `(root)`.

## Verified official sources
- Kalshi API docs: https://docs.kalshi.com/welcome
- Demo environment: https://docs.kalshi.com/getting_started/demo_env
- Demo Trade API: https://external-api.demo.kalshi.co/trade-api/v2
- Demo WebSocket: wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2
- Demo site: https://demo.kalshi.co/
- Demo account tutorial: https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account

## Important (unverified)
This repo is a static frontend. No Kalshi demo API credentials were provided, and the build sandbox cannot call kalshi.co directly. Live market prices, orderbooks, portfolio balances, fills, and trade execution are left blank and flagged `unverified` until a demo API key is configured. See `docs/api-research.md` and `flagged.html`.

## Structure
- `index.html` — landing page + executive summary
- `categories/*.html` — gas, elections, culture, crypto, golf event tables
- `portfolio.html` — demo portfolio balance, positions, fills, trade strategies
- `suggestions.html` — improvement register with review-before-implement workflow
- `qa.html` — pre-decision questions / missing-information register
- `flagged.html` — irregularities + unverified items
- `assets/css/style.css` — shared styles
- `assets/js/app.js` — shared logic (graceful live-data client)
- `docs/api-research.md` — verified Kalshi API research
- `COORDINATION.md` — shared task board

## Disclaimer
Not financial advice. Demo market prices may not reflect real markets. Demo credentials are not shared with production.
