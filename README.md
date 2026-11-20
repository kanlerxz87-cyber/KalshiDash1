# KalshiDash1

A simple, read-only dashboard for the **Kalshi demo** exchange, published with GitHub Pages.

- **Site source:** generated at the repository root (`index.html`, `*.html`, `categories/`, `assets/`). Edit `scripts/build-site.mjs` (pages) or `assets/app.js` / `assets/style.css` (browser code), then regenerate. GitHub Pages serves `main` at `/`.
- **Build and check:**
  ```bash
  node scripts/build-site.mjs      # regenerates the site at the repo root
  node scripts/check-links.mjs     # offline check: internal links, nav, titles
  node --check assets/app.js      # syntax check of browser code
  ```
  No dependencies are needed (Node 22 or later).
- **Live data:** read in the visitor's browser from the official demo Trade API, `https://external-api.demo.kalshi.co/trade-api/v2`, using public endpoints only. No credentials are requested, stored or sent.
- **Pages:** the repository's Pages source is the legacy `main` branch, root folder (set by the repository owner; the automation token could not change it). `.github/workflows/pages.yml` rebuilds the site, checks links, and fails if the committed site is stale.
- **Coordination:** see `COORDINATION.md` for the task board, sources, verification and flagged items.

Official references: [Demo environment](https://docs.kalshi.com/getting_started/demo_env) · [API index](https://docs.kalshi.com/llms.txt) · [Sources page in the site](sources.html).

Unverified items and irregularities are listed on the site's **Flagged for review** page (`flagged.html`).

---

# KalshiDash1 — the `docs/` live suite (added by session-3f5650f9, kept alongside the generated root site)

The repository root is the generated site (see above). This session built a second, independent
implementation under `docs/`, and both are published — nothing was overwritten or deleted. `docs/` has
its own API client, page logic, methodology, verification table and Flagged page.

## Pages under `docs/`

| Path | Purpose |
|------|---------|
| `docs/index.html` | Live dashboard: exchange status, highest-dollar open markets, price chart, order-book liquidity, discovered series |
| `docs/executive-summary.html` | Executive summary; every claim source-linked |
| `docs/events.html` | Tracked markets with status + YES/NO resolution from the API `result` field |
| `docs/gas-prices.html`, `docs/elections.html`, `docs/culture.html`, `docs/crypto.html`, `docs/golf.html` | Per-category subpages: open markets, resolutions, and the exact series that matched |
| `docs/portfolio.html` | Local paper-trading portfolio + trade categorization, plus optional demo-account connect (balance/positions/fills) |
| `docs/trade.html` | Trade execution: simulator fills, or a real demo order via `POST /portfolio/events/orders` |
| `docs/strategies.html` | Strategy templates and candlestick backtests (educational) |
| `docs/suggestions.html` | Suggestion board with trade-offs, voting and "choose this path" (browser-local) |
| `docs/questions.html` | Questions / information needed / answers with how-to-discover steps |
| `docs/methodology.html` | Discovery rules, ranking formula, chart sources, order-book semantics, accounting |
| `docs/sources.html` | Line-by-line verification table (S-01 … S-51), one official link per row |
| `docs/flagged.html` | Flagged for review: unverified items, doc irregularities, repo findings |

## Conventions (applied to both implementations)

* Demo environment only, mock funds: "the price and behavior of markets in the demo environment may not be
  reflective of those in real markets" ([demo environment docs](https://docs.kalshi.com/getting_started/demo_env)).
* No market data is committed anywhere in this repository. Prices, books and resolutions are fetched by the
  browser at page load; if the API cannot be reached the tables say so instead of showing placeholders.
* If a value cannot be confirmed from an official source it stays blank and is listed on the Flagged page —
  never inferred, defaulted, or filled with example data.
* Computed numbers (estimated notional, cumulative depth, implied asks) are labelled as ours next to the API
  fields they come from. `notional_value_dollars` is a per-contract settlement value, not traded dollars
  ([Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)).
* No credential is stored in the repo or sent anywhere except the demo API origin; the `docs/` suite keeps a
  pasted demo key in the visitor's browser only.
* Nothing here is financial advice.

## Additional tooling

```bash
python3 tools/linkcheck.py        # repo-wide internal link check (covers root, docs/ and archive/)
node tools/qa_logic_test.mjs      # 28 logic checks on docs/assets/kalshi.js against documented response shapes
python3 tools/kalshi_client.py snapshot --with-settled --with-candles   # durable JSON snapshot (needs network)
python3 tools/kalshi_client.py markets --category crypto --limit 25
```

`tools/kalshi_client.py` is standard-library only, applies the same category keyword rules as the browser
client, backs off on `429` per the [rate-limit docs](https://docs.kalshi.com/getting_started/rate_limits),
and reads demo credentials from environment variables only.

CI runs all of the above (plus `node scripts/check-links.mjs`-style syntax checks) in
`.github/workflows/site-qa.yml`; the root site itself is rebuilt and checked by `.github/workflows/pages.yml`.
