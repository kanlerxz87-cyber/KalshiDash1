# Demo-account tracking & trade execution (`tools/demo_trader.mjs`)

Session: `session-d5b935f4`. Verified contract record: [`verification/2026-11-20-d5b935f4.md`](../verification/2026-11-20-d5b935f4.md) (C-3, C-8).

This tool implements the credential-gated path for the brief's *"Track the portfolio performance using the kalshi demo account"* and
*"Execute trades on events"* for the **real Kalshi demo account** — the authenticated path that the
simulated (paper) engines deliberately do not touch. It is separate from `session-815b546d`'s
simulated auto-trade engine and from the portfolio *pages* owned by the final integration session.

## What it does

| Command | Effect | Auth | Source |
|---|---|---|---|
| `node tools/demo_trader.mjs status` | Prints API root + credential state + `GET /exchange/status` | none | [Get Exchange Status](https://docs.kalshi.com/api-reference/exchange/get-exchange-status.md) |
| `node tools/demo_trader.mjs account` | Signed `GET /portfolio/balance`, `/portfolio/positions`, `/portfolio/fills?limit=200`, `/portfolio/settlements?limit=200` → writes `data/account.json` (verbatim responses + source URLs) | key pair | [API Keys](https://docs.kalshi.com/getting_started/api_keys.md), [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md) |
| `node tools/demo_trader.mjs buy --ticker T --side bid --count N --price P` | Posts `POST /portfolio/events/orders` with the exact quick-start body (`side`, `count`, `price`, `time_in_force: good_till_canceled`, `self_trade_prevention_type: taker_at_cross`, `client_order_id`) — **dry-run unless `--confirm-live`** | key pair | [Quick Start: Create your first order](https://docs.kalshi.com/getting_started/quick_start_create_order.md) |
| `node tools/demo_trader.mjs cancel --order-id O --ticker T` | `DELETE /portfolio/events/orders/{order_id}?market_ticker=T`; ticker enables shard auto-routing — **dry-run unless `--confirm-live`** | key pair | [Cancel Order V2](https://docs.kalshi.com/api-reference/orders/cancel-order-v2) |

Signing (verified C-3): `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP`
headers; signature = base64(RSA-PSS SHA-256 or Ed25519) over `timestamp + METHOD + path` where the
timestamp is **milliseconds** and `path` includes `/trade-api/v2/…`. A `201` means *accepted*, not
necessarily resting — check `remaining_count`.

## Privacy warning before enabling account snapshots

**The account snapshot is public, not just visible to you.** This is a public repository and
its GitHub Pages publishing source is the `main` branch root. When enabled, the workflow commits
`data/account.json` to that branch and the page reads that file. Its verbatim balance, positions,
fills and settlements can therefore be read by anyone through the repository and the published
site. Demo funds are mock funds, but the activity and account details may still be sensitive.
Secrets staying out of the browser does **not** make the resulting account data private.
[GitHub warns that Pages sites are publicly available](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https#about-https-and-github-pages).

Do not enable this workflow for account data you want to keep private. Removing a later snapshot
from the current tree does not by itself remove earlier copies from Git history, clones or forks;
[GitHub's sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
describes the limits and coordination needed. A private authenticated backend and private storage
would be needed for a private dashboard; this static public site is not one.

## Enabling it (owner action — no manual input needed until you want live data)

1. Create a **demo-environment** API key pair ([API Keys](https://docs.kalshi.com/getting_started/api_keys.md):
   account page or `POST /trade-api/v2/api_keys/generate`).
2. Add two GitHub repository secrets (Settings → Secrets → Actions):
   - `KALSHI_KEY_ID` — the key id
   - `KALSHI_PRIVATE_KEY` — the full PEM private key
3. `.github/workflows/demo-account.yml` declares a six-hour schedule (or can run via
   *Actions → demo-account → Run workflow*) to refresh `data/account.json`, which the page reads.
   [GitHub notes scheduled runs can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule); a successful historical capture does not prove a current connection.

Local use: export `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY` (or `KALSHI_PRIVATE_KEY_PATH`) and run
any command. `--print` shows the raw JSON responses on stdout.

## Security model

- **Hard demo-only host boundary.** `KALSHI_API_ROOT` may select only
  `https://external-api.demo.kalshi.co/trade-api/v2` or
  `https://demo-api.kalshi.co/trade-api/v2` ([official environment table](https://docs.kalshi.com/getting_started/demo_env)).
  Production, arbitrary hosts, embedded credentials, extra ports, query strings and altered paths
  are rejected **before** a private key is read or any request is sent. Redirects are refused so
  signed headers cannot be forwarded elsewhere.
- Orders require a positive safe whole count and a binary price strictly between $0 and $1,
  with no more than four decimals. The tool never rounds an invalid price into a new order;
  exchange-specific tick grids, eligibility and actual available funds remain exchange-validated.
  This is not the browser paper model or a guarantee of a fill.
- `npm run test:demo-safety` tests both demo roots, refusal of production, invalid order values,
  dry-run/confirm conflicts, RSA-PSS/Ed25519 signing and failed-account status using offline
  fixtures and ephemeral test keys only. Passing these tests does **not** verify live authentication.

- Keys exist only in GitHub Actions secrets or your shell environment — **never** in this
  repository, never in `data/account.json`, never printed (only a SHA-256 fingerprint of the key
  *id* is logged). The browser never sees keys; a static page cannot and must not sign requests
  (measured browser-signing limitation [F-66](../flagged.html#F-66)).
- Mutating commands require an explicit `--confirm-live` (the retained flag name means **demo only**, never production). Everything else is dry-run; combining it with `--dry-run` is rejected.
- Without secrets `account --ci` is a no-op. It does not replace any previously published capture, so always use its timestamp; the current committed placeholder is disconnected. If a capture fails, the workflow exits before its normal commit step, so an older published file may remain. See the [verification record](../verification/2026-11-22-f134d89d.md).

## Data produced (`data/account.json`)

`captured_at` (after all four sequential reads pass the documented minimum envelope checks), `attempted_at`, `connected`, `environment: "demo"`, `api_root`, `key_fingerprint`, `source_urls[]`, and the four verbatim successful API responses (`balance`, `positions`, `fills`, `settlements`). Values are not inferred. Failed or malformed reads are marked `error: true`; a transport exception is recorded without its potentially sensitive details. Any such failure keeps `connected: false` and `captured_at: null`; the CLI exits nonzero. Zero balances and correctly shaped empty lists are valid, not failures. The lists are first-page samples (fills/settlements limit 200), not a complete or atomic account-history return calculation. [Official balance](https://docs.kalshi.com/api-reference/portfolio/get-balance), [positions](https://docs.kalshi.com/api-reference/portfolio/get-positions), [fills](https://docs.kalshi.com/api-reference/portfolio/get-fills) and [settlements](https://docs.kalshi.com/api-reference/portfolio/get-settlements) document the required envelopes.

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
