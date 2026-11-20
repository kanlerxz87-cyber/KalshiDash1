# KalshiDash1

Kalshi demo dashboard — tracks live events (gas prices, elections, culture, crypto, golf), contract-price graphs, orderbook liquidity, demo-account portfolio performance, and trade execution structure.

## Site
- `index.html` — landing page + verified demo endpoints
- `dashboard.html` — live interactive price graph (time → contract price) + orderbook liquidity
- `categories/*.html` — findings tables per focus category
- `portfolio.html` — demo-account portfolio structure (credentials required)
- `trades.html` — trade execution structure & strategy framework (credentials required)
- `suggestions.html` — improvement suggestions with review workflow
- `questions.html` — pre-decision questions/information/answers
- `flagged.html` — unverified items & irregularities (Flagged for Review)

## Verified demo endpoints (docs.kalshi.com)
- REST Trade API: https://external-api.demo.kalshi.co/trade-api/v2 (also https://demo-api.kalshi.co/trade-api/v2)
- WebSocket API: wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2 (also wss://demo-api.kalshi.co/trade-api/ws/v2)
- Public market data needs no authentication; authenticated portfolio/order endpoints require demo API key + Ed25519 private key.

## Verification policy
Every table row links to an official Kalshi source. If a value cannot be confirmed from an official source, it is left blank and flagged unverified. No values are inferred or filled in.

## Notes
- Demo environment uses mock funds; credentials are not shared with production.
- At review time the demo environment listed sports markets; gas/elections/culture/crypto/golf events were not confirmed (flagged).
- This is not financial advice.

Official docs: https://docs.kalshi.com
Demo site: https://demo.kalshi.co/
