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
