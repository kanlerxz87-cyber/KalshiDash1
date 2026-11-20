# VERIFICATION.md — Line-by-Line Verification Record

## Final integration — session dd012e26 (2026-11-20)

See [`verification/2026-11-20-dd012e26.md`](verification/2026-11-20-dd012e26.md) for full scope, evidence and limitations. Official demo endpoint roots and bids-only orderbook semantics were checked against Kalshi docs; one open gas market was compared field-by-field with the committed snapshot. All flag anchors are unique. The landing-page link graph reaches 52 of 53 published HTML pages; `404.html` is the intentional exception. Build freshness, whole-tree link checks, and automated suites pass. The zero schedule-triggered-run history and the stale lockfile metadata are flagged. A new schedule run, PR merge and Pages deployment remain unverified at this point.

**Verified:** 2026-11-20 · **Session:** session-cdfe52bd · **Method:** every table row, figure, and API claim re-checked against the official source listed in `SOURCES.md`; values that could not be confirmed are blank + flagged (see `dash/flagged.html`).

## 1. Verification rules applied

1. Every table row on the site carries a source link (API query URL or docs.kalshi.com page).
2. No value was inferred, interpolated, or copied from model memory. If the source didn't state it, the cell is blank and flagged.
3. Prices rendered to ≤ 4 decimals, counts to ≤ 2 decimals, per the fixed-point conventions (D12).
4. Simulation content (paper trades) is labeled SIMULATED/seed everywhere it appears.

## 2. Row-group checks

| Deliverable | Rows/claims | Source class | Check performed | Result |
|---|---|---|---|---|
| Site: API Reference §1 environments table | 3 rows | D1/D2 | Compared URL strings character-by-character with the brief and the docs page | PASS — brief matches docs exactly |
| Site: API Reference §3 public endpoints | 11 rows | D5–D10, D16 | Each path/method/param set cross-checked against its linked docs page; the 5 endpoints the dashboard calls were additionally exercised live (A1, A8, A9, A13–A16) | PASS |
| Site: API Reference §4 private endpoints | 7 rows | D14, D16 | Paths taken from official docs index + Create Order V2 page | PASS |
| Site: data model (status/result enums, field names) | enum values | D8 | Enum values quoted verbatim from OpenAPI schema on Get Market page | PASS |
| Site: Live Events tracker (snapshot rows) | 6 markets + 5 empty-probe findings | A8–A13 | Each row's fields copied verbatim from the captured JSON; each row's `source_url` re-fetchable | PASS |
| Site: Resolution log | 6 settled markets | A13/A14 | `result` values ("no" ×5 gas ladder, "yes" ×1 BTC demo) verbatim; payout semantics confirmed by D11 | PASS |
| Site: snapshot.json | all rows | A1–A17 | Fields match raw API output; unreturned fields set to `null` (F-05, F-06) | PASS |
| Site: Executive summary figures | 7,475.30 / 1,175.00 / series volumes | A2/A4/A7–A9 | Re-read against capture output | PASS |
| Site: strategy mechanics table | 5 rows | D8/D10/D11/D12 + orderbook docs | Each "exchange mechanic" statement links the page that states it | PASS |
| Site: Questions matrix | 16 rows | D1–D16 + flagged register | Answered/Partial/Open labels match evidence; every Open row has a discovery plan | PASS |
| Portfolio page | all rows | SIMULATED | Labeled simulated; seeded rows tagged `seed`; real-account cells blank (F-02) | PASS (by policy) |

## 3. Blank + flagged values (never filled)

| Value shown blank | Where | Flag |
|---|---|---|
| Real demo-account balance/positions/fills/P&L | Portfolio, exec summary | F-02 |
| `volume_fp` for KXXBANNED*, KXBTCHIT85K, ETHMAXY, KXRIPPLE, KXBNBD, KXXRPATH | snapshot series rows | F-05 |
| KXNEXTNATOSECGEN-99-BWAL bid/ask/size/volume | snapshot markets row | F-06 |
| Fee amounts | P&L math (set to 0) | S-05 |

## 4. Build/link checks

| Check | Command | Result |
|---|---|---|
| Internal link + asset check | `node scripts/check_links.js` | exit 0 — 39 internal links/assets across 10 pages, 0 broken |
| Headless render test (all 10 pages, scripts executed, live API simulated as unreachable) | jsdom harness (build tooling, not shipped) | ALL PAGES PASS — tables populated from snapshot fallback, resolution log 6 rows, trade log 8 seeded rows, chart/ladder render without errors |
| Site structure | static HTML/CSS/JS — no build step required | PASS |
| External source links | all https, all official domains (docs.kalshi.com, external-api.demo.kalshi.co, assets.kalshi.com, plus settlement-source orgs named by the API itself) | PASS |
| JSON validity | `node -e "JSON.parse(require('fs').readFileSync('dash/data/snapshot.json'))"` | PASS |
| JS syntax | `node --check` on every file in dash/js/ and scripts/ | PASS |

## 5. Post-merge integration verification

Recorded in `COORDINATION.md` (task 9): link check re-run on `main` after merge, GitHub Pages deploy confirmed via the Pages API/Actions run, PR link + merge SHA appended.

---

# Session arena-f89b55f7 — Live Alerts verification record (2026-11-20, appended additively)

Scope: new `dash/alerts.html` + the merged `dash/js/alerts.js` engine (session files; merged with arena/815b546d's parallel implementation at integration), additive
edits to `dash/js/app-common.js` (nav), `dash/js/store.js` (2 strategy definitions), `dash/index.html`,
`dash/flagged.html` (F-11–F-12 after renumbering; F-08–F-10 are arena/815b546d's rows), `dash/sources.html` (S-A1–S-A4), `README.md`, this file, and
`.github/workflows/site-qa.yml` (two new CI steps). Nothing from earlier sessions was overwritten or removed.

## 1. New official-source checks (row-linked on dash/sources.html, S-A1–S-A4)

| Claim | Source | How verified |
|---|---|---|
| `GET /markets?tickers=…` batch: "every matching market is returned in one response" when tickers is the only filter | https://docs.kalshi.com/api-reference/market/get-markets | Docs page fetched and read (param + paging/ordering/caching sections) |
| Batch endpoint works unauthenticated on the demo host and returns full quote fields | https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXELECTIONEMERGENCY-27JAN01 (+ 2-ticker probe) | Platform fetch returned the live market JSON (yes_ask $0.0700 ↔ no_bid $0.9300, price_ranges step $0.0100, linear_cent) |
| REST response caching lag (alert timestamps can lag fills) | https://docs.kalshi.com/api-reference/market/get-markets (caching note) | Docs text quoted on the alerts page and flagged as F-08 |
| Rate limits: unauthenticated requests have separate limits; back off on 429 | https://docs.kalshi.com/getting_started/rate_limits | Docs page fetched; engine uses 1 batched request / 15 s + exponential backoff |

## 2. Test results (all run in this session)

| Check | Command | Result |
|---|---|---|
| Alert-engine logic (swing detect ±$0.10, stale-baseline guard, dedup, ROI model weights, pickTracked caps, planEntry/planExit incl. NO side = 1 − YES, time stop) | `node tools/alerts-qa.mjs` | 37/37 PASS (re-run after the merge — see the reconciliation record in COORDINATION.md) |
| Live Alerts page render + behavior (jsdom, real page scripts, mocked transport shaped like verified payloads; drives 3 poll cycles: baseline → +$0.11 swing → take-profit exit) | `node tools/alerts-render-test.mjs` (jsdom 24.1.3, dev-only, not committed) | 21/21 PASS |
| Syntax | `node --check dash/js/alerts.js dash/js/store.js dash/js/app-common.js dash/js/autotrade.js` | PASS |
| dash suite link/asset check (now 11 pages incl. alerts.html) | `node scripts/check_links.js` | 47 links, 0 broken |
| Repo-wide link check | `python3 tools/linkcheck.py` | 64 pages, 995 internal links, 0 broken |
| docs-suite logic test (unchanged, regression) | `node tools/qa_logic_test.mjs` | all PASS |
| Root-site check (unchanged, regression) | `node scripts/check-links.mjs` | 64 pages, 0 broken internal links |
| Local serve of every touched page | python3 http.server + curl | /dash/alerts.html, /dash/index.html, all js → 200 |

## 3. Behavior guarantees asserted by the tests

- No invented values: unparseable/missing prices never alert, never trade (guarded in code + tests).
- No look-ahead: a SIM entry pays the executable ask observed after the jump (test fixture ties ask to the post-jump price; entry = $0.55, not the pre-jump $0.44).
- NO-side accounting uses the verified 1 − YES relation (fixture + live probe).
- Dedup prevents alert spam; stale baselines (>15 min) re-baseline silently.
- Alert feeds and SIM trades persist in localStorage (browser-local by design; F-11), never committed as market data.

## 4. Blank values added by this session

None. All new values are either computed from live API fields (labeled), documented constants
(threshold $0.10 from the brief; model weights — ours, documented on the page), or left blank
(e.g., settlement-source lines say "not captured" when the API returned none — F-12 policy).
