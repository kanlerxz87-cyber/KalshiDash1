# KalshiDash1

A live, dependency-free dashboard for the **Kalshi demo environment** (`https://external-api.demo.kalshi.co/trade-api/v2`), tracking the highest-dollar live events across **gas prices, elections, culture, crypto, and golf** until each market resolves **yes** or **no**, with simulated portfolio/trade analytics, a suggestions review board, and a full questions/gaps register.

**Live site (GitHub Pages):** see the About section of this repo, or open `dash/index.html` locally.

## What's inside

| Path | What it is |
|---|---|
| `dash/` | The GitHub Pages site (static HTML/CSS/JS — no build step) |
| `dash/data/snapshot.json` | Verified point-in-time capture of the official demo API (2026-11-20), every row with its source URL |
| `EXECUTIVE_SUMMARY.md` | Executive summary of the brief, the API surface, and findings |
| `SOURCES.md` | Source register: every claim → official page/endpoint → verification date |
| `REVIEW.md` | Line-by-line repo review + irregularities |
| `VERIFICATION.md` | Line-by-line verification record for the combined deliverable |
| `COORDINATION.md` | Shared task board for parallel sessions (claims, statuses, hand-off log) |
| `scripts/` | `check_links.js` (internal link checker), `fetch_snapshot.mjs` (refresh data; optionally sync a demo portfolio with **your own** keys), `local-proxy.mjs` (CORS-proof local live mode) |

## Site map

- **Home** — executive summary + top-dollar snapshot
- **Live Events** — topic boards ranked by dollar volume, tracked to resolution (yes/no) with a resolution log
- **Market Detail** — price chart (time axis: seconds → days windows; Y = contract price), full orderbook ladder (contracts available at every price), rules + settlement sources, simulated trade ticket
- **Portfolio** — simulated P&L, win rate, exposure, equity curve, category breakdown
- **Trade Analysis** — topic × strategy categorization, strategy definitions mapped to verified exchange mechanics
- **Suggestions** — improvement proposals with impact/effort and an approve/reject workflow
- **Questions & Gaps** — known/verified vs missing, with a discovery plan for each unknown
- **API Reference** — verified endpoint inventory, auth, data model, rate limits
- **Sources / Flagged for Review** — per-row provenance and the irregularity register

## Data honesty rules (enforced throughout)

1. Every table row links to the official endpoint or docs page it came from.
2. If a value can't be confirmed from an official source, it is left **blank** and listed on Flagged for Review — never inferred.
3. Portfolio/trade data is **simulated** (clearly labeled). Real demo-account numbers require the account holder's API keys (F-02/S-01) and are blank until then.

## Running locally

```bash
# just open the static site
python3 -m http.server 8000 --directory docs   # then http://localhost:8000

# optional: CORS-proof live data (proxies /api/* to the demo host)
node scripts/local-proxy.mjs                    # then http://localhost:8080

# optional: refresh dash/data/snapshot.json from the official API (no keys needed)
node scripts/fetch_snapshot.mjs

# optional: export YOUR demo-account portfolio (keys never leave your machine)
KALSHI_KEY_ID=... KALSHI_PRIVATE_KEY_PATH=... node scripts/fetch_snapshot.mjs --portfolio
```

## Verification

Build-session verification (2026-11-20) is recorded in `SOURCES.md` and `VERIFICATION.md`; run `node scripts/check_links.js` to re-check internal links. Open questions before any decision are listed on the site's **Questions & Gaps** page.

Not affiliated with Kalshi. Not financial advice.
