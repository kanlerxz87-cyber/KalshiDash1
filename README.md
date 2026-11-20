# KalshiDash1

A simple, read-only dashboard for the **Kalshi demo** exchange, published with GitHub Pages.

- **Site source:** `docs/` (generated). Edit `scripts/build-site.mjs` (pages) or `docs/assets/*` (browser code), then regenerate.
- **Build and check:**
  ```bash
  node scripts/build-site.mjs      # regenerates docs/
  node scripts/check-links.mjs     # offline check: internal links, nav, titles
  node --check docs/assets/app.js  # syntax check of browser code
  ```
  No dependencies are needed (Node 22 or later).
- **Live data:** read in the visitor's browser from the official demo Trade API, `https://external-api.demo.kalshi.co/trade-api/v2`, using public endpoints only. No credentials are requested, stored or sent.
- **Pages deploy:** `.github/workflows/pages.yml` builds, checks, and deploys `docs/` on pushes to `main`.
- **Coordination:** see `COORDINATION.md` for the task board, sources, verification and flagged items.

Official references: [Demo environment](https://docs.kalshi.com/getting_started/demo_env) · [API index](https://docs.kalshi.com/llms.txt) · [Sources page in the site](docs/sources.html).

Unverified items and irregularities are listed on the site's **Flagged for review** page (`docs/flagged.html`).
