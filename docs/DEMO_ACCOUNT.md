# Demo-account tracking & trade execution (`tools/demo_trader.mjs`)

Session: `session-d5b935f4`. Verified contract record: [`verification/2026-11-20-d5b935f4.md`](../verification/2026-11-20-d5b935f4.md) (C-3, C-8).

This tool covers the brief's *"Track the portfolio performance using the kalshi demo account"* and
*"Execute trades on events"* for the **real Kalshi demo account** — the authenticated path that the
simulated (paper) engines deliberately do not touch. It is separate from `session-815b546d`'s
simulated auto-trade engine and from the portfolio *pages* owned by the final integration session.

## What it does

| Command | Effect | Auth | Source |
|---|---|---|---|
| `node tools/demo_trader.mjs status` | Prints API root + credential state + `GET /exchange/status` | none | [Get Exchange Status](https://docs.kalshi.com/api-reference/exchange/get-exchange-status.md) |
| `node tools/demo_trader.mjs account` | Signed `GET /portfolio/balance`, `/portfolio/positions`, `/portfolio/fills?limit=200`, `/portfolio/settlements?limit=200` → writes `data/account.json` (verbatim responses + source URLs) | key pair | [API Keys](https://docs.kalshi.com/getting_started/api_keys.md), [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md) |
| `node tools/demo_trader.mjs buy --ticker T --side bid --count N --price P` | Posts `POST /portfolio/events/orders` with the exact quick-start body (`side`, `count`, `price`, `time_in_force: good_till_canceled`, `self_trade_prevention_type: taker_at_cross`, `client_order_id`) — **dry-run unless `--confirm-live`** | key pair | [Quick Start: Create your first order](https://docs.kalshi.com/getting_started/quick_start_create_order.md) |
| `node tools/demo_trader.mjs cancel --order-id O` | `DELETE /portfolio/events/orders/{order_id}` — **dry-run unless `--confirm-live`** | key pair | same ("Next Steps") |

Signing (verified C-3): `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP`
headers; signature = base64(RSA-PSS SHA-256 or Ed25519) over `timestamp + METHOD + path` where the
timestamp is **milliseconds** and `path` includes `/trade-api/v2/…`. A `201` means *accepted*, not
necessarily resting — check `remaining_count`.

## Enabling it (owner action — no manual input needed until you want live data)

1. Create a **demo-environment** API key pair ([API Keys](https://docs.kalshi.com/getting_started/api_keys.md):
   account page or `POST /trade-api/v2/api_keys/generate`).
2. Add two GitHub repository secrets (Settings → Secrets → Actions):
   - `KALSHI_KEY_ID` — the key id
   - `KALSHI_PRIVATE_KEY` — the full PEM private key
3. The scheduled workflow `.github/workflows/demo-account.yml` (every 6 h, or run manually via
   *Actions → demo-account → Run workflow*) then refreshes `data/account.json`, which the
   `demo-account.html` page renders. Nothing else is required.

Local use: export `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY` (or `KALSHI_PRIVATE_KEY_PATH`) and run
any command. `--print` shows the raw JSON responses on stdout.

## Security model

- Keys exist only in GitHub Actions secrets or your shell environment — **never** in this
  repository, never in `data/account.json`, never printed (only a SHA-256 fingerprint of the key
  *id* is logged). The browser never sees keys; a static page cannot and must not sign requests
  (repo flag F-07).
- Mutating commands require an explicit `--confirm-live`; everything else is dry-run.
- Without secrets the tool is a no-op (`account --ci` exits 0) and the site shows
  "not connected" with this setup page.

## Data produced (`data/account.json`)

`captured_at`, `environment: "demo"`, `api_root`, `key_fingerprint`, `source_urls[]`, and the four
verbatim API responses (`balance`, `positions`, `fills`, `settlements`). Every field is exactly what
the API returned; nothing is inferred. If a call fails, the failure body is stored under that key
with `error: true` — never fabricated.

## Caveats (flagged, not blocking)

- Demo-environment prices and behaviour "may not be reflective of those in real markets"
  ([Demo environment](https://docs.kalshi.com/getting_started/demo_env)).
- Fees are not modeled anywhere in this repo (`fee_type: "quadratic"` is returned on series rows;
  see [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding.md)) — reported P&L on
  simulated pages is fee-free and labelled as such.
- Order-side wording: the current official quick start posts `side: "bid"`; the
  [Order direction](https://docs.kalshi.com/getting_started/order_direction.md) page documents
  `outcome_side` / `book_side` on Order/Fill/Trade **responses** (repo flag F-08, refined).
- Nothing here is financial advice.
