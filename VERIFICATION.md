# VERIFICATION.md — Line-by-Line Verification Record

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

## 6. Session arena/815b546d-kalshidash1 — live alerting + automated trading (2026-11-20)

**Verified:** 2026-11-20 · **Session:** arena/815b546d-kalshidash1 · **Method:** the new alert engine, autotrade
engine, and refreshed snapshot were verified against the official demo API (platform fetch tool, see F-07) and the
linked docs pages; the alert detector was tested headlessly against the verified snapshot trades.

### New deliverables (all source-linked)

| Deliverable | Basis | Check performed | Result |
|---|---|---|---|
| `dash/alerts.html` — two scrolling chats (all events + high-ROI filter), ≥ $0.10 swing alerts | Brief requirement; detection from public `GET /markets/trades` (D17) | Detector unit test against verified snapshot trades (8 captured trades, ≥ $0.10 moves); live API fetch confirmed trade schema | PASS — swing fires at exactly ≥ $0.10; entries link API source + settlement-source catalyst links |
| `dash/js/alerts.js` — alert engine, high-ROI heuristic model | 40/30/30 liquidity/OI/opportunity formula from Get Market fields | `tools/qa_alert_test.mjs` (5 checks: threshold, replay, model bounds, settlement, feed clear) | PASS — all 5 checks |
| `dash/js/autotrade.js` — automated simulated trade engine (5 strategies) | Strategy definitions on analysis.html; settlement semantics D11 | Engine test: simulated trade placed, settled at `result`, P&L = (exit−entry)×qty | PASS |
| `dash/autotrade.html` — engine controls, strategy table, decision log | Create Order (V2) doc for the simulation boundary; strategy mechanics D8/D10/D11 | Link + syntax checks; rendered in DOM-stub harness | PASS |
| `dash/executive-summary.html` — dedicated executive summary | Brief requirement | Row-group check: every fact row links its official docs page; figures re-read from captures | PASS |
| Snapshot refresh (`dash/data/snapshot.json`) | Live reads 2026-11-20 ~13:21 UTC | New rows (KXDEMOFUTHOURLY-26NOV20H14-UP, 2,820.00 vol) and refreshed volumes verified against the fetch output; JSON validity checked | PASS |
| `scripts/refresh_snapshot.py` | Same verified captures | Rows merged in place; prior rows preserved; blanks kept for unconfirmed values | PASS |
| `tools/qa_alert_test.mjs` | Headless engine test (build tooling) | Run in CI (suite-qa.yml) | PASS — 5 checks |
| Flags F-08 / F-09 / F-10 | Poll latency, heuristic-model disclosure, demo-hourly concentration | Published on flagged.html with evidence links | PASS (does not block merge) |

### Verification sources used this session

- Get Trades (trade-by-trade prices, ticker/min_ts/max_ts filters): https://docs.kalshi.com/api-reference/market/get-trades
- WebSocket quick start (session auth required even for public channels): https://docs.kalshi.com/getting_started/quick_start_websockets
- Live captures: `GET /markets?series_ticker=KXELECTIONEMERGENCY&status=open`, `GET /markets?series_ticker=KXDEMOFUTHOURLY&status=open`,
  `GET /series?category=Crypto&include_volume=true`, `GET /series?category=Elections&include_volume=true`,
  `GET /markets/trades?ticker=KXDEMOFUTHOURLY-26NOV20H14-UP&limit=50` — all on external-api.demo.kalshi.co (logged in dash/sources.html)

### Build/link checks (this session)

| Check | Command | Result |
|---|---|---|
| dash/ suite links + JS syntax + snapshot JSON | `node scripts/check_links.js` + `node --check dash/js/*.js` + JSON.parse | PASS — 63 links/13 pages, 0 broken |
| Repo-wide links (root, docs/, archive/, dash/) | `python3 tools/linkcheck.py` | PASS — 1,011 links, 0 broken |
| Alert/autotrade logic tests | `node tools/qa_logic_test.mjs` + `node tools/qa_alert_test.mjs` | PASS — 5 checks |
| Root site build | `node scripts/build-site.mjs` | PASS — 16 pages written, no root-site staleness |
