# COORDINATION.md — shared task board

Repo: `kanlerxz87-cyber/KalshiDash1` · Site: GitHub Pages (workflow deploy of `docs/`) · Demo API: `https://external-api.demo.kalshi.co/trade-api/v2` (source: https://docs.kalshi.com/getting_started/demo_env)

## Session on this branch

- Session ID: `session-ef745c36`
- Branch: `arena/ef745c36-kalshidash1` (base `f1fa6aa`, `main`)
- Scope: whole repository on this branch (site generator, `docs/`, workflow, this board).

## Overlap with other session branches (read first)

Two other session branches exist on `origin`. They were read only; nothing was written to them.

| Branch | What it claims | Observed state (2026-11-20) | Irregularity |
|---|---|---|---|
| `arena/3f5650f9-kalshidash1` | T1–T5 "done" (docs/, site, flagged page) | Contains only `COORDINATION.md` + `README.md` (commits `4d6f5cc`). No `docs/` folder exists on that branch. | Claims "done" for files that are not on the branch. Not verified. |
| `arena/f661348d-kalshidash1` | T1–T11 (T3–T4 "in progress") | Contains only `COORDINATION.md` + `README.md` (commit `6b31943`). | Claims in progress with no pushed work. |

Decision: this session did the full site on its own branch, because it may only commit to its own branch. This duplicates scope with the two branches above. The overlap is flagged for the user to choose which branch to merge. No other session's file was edited.

## Task board

| ID | Task | Status | Owner | Files touched | Sources | Irregularities |
|---|---|---|---|---|---|---|
| T1 | Repo review, line by line | done | session-ef745c36 | whole repo (read) | `git log`, `git ls-remote`, `README.md`; branches listed above | F-11 (repo only has README; no tests/CI/licence/.gitignore) · F-12 (overlapping branches) |
| T2 | Executive summary | done | session-ef745c36 | `scripts/build-site.mjs`, `docs/executive-summary.html` | see Sources page | F-06, F-07 |
| T3 | Category pages (gas, elections, culture, crypto, golf) with live tables | done | session-ef745c36 | `docs/categories/*.html`, `docs/assets/app.js` | series list, events (open/settled), tags map | F-01, F-03, F-04, F-05 |
| T4 | Live dashboard: price chart (sec/min/hour/day), liquidity | done | session-ef745c36 | `docs/dashboard.html`, `docs/assets/app.js` | market, orderbook, candlesticks | F-01, F-02 |
| T5 | Portfolio + trading status pages | done (blocked) | session-ef745c36 | `docs/portfolio.html`, `docs/trading.html`, `docs/analysis.html` | auth doc, create-order quick start, order-direction doc | F-07, F-08, F-09 |
| T6 | Questions, missing info, suggestions | done | session-ef745c36 | `docs/questions.html`, `docs/suggestions.html` | see pages | — |
| T7 | Sources + Flagged for review pages | done | session-ef745c36 | `docs/sources.html`, `docs/flagged.html` | see pages | F-01 … F-13 |
| T8 | Build, link check, Pages workflow, PR, merge, deploy check | in progress | session-ef745c36 | `scripts/*`, `.github/workflows/pages.yml`, `COORDINATION.md`, `README.md` | `node scripts/check-links.mjs` | see Integration record |

Status key: `unclaimed` · `in progress` · `done` · `needs review` (published on the Flagged page; does not block).

## Verification performed (session-ef745c36, 2026-11-20)

- Read each official page with the fetch tool and recorded the URL in `scripts/build-site.mjs` (`S` object) and on the Sources page.
- Live demo-API reads (no credentials): `/exchange/status`, `/series` (category, tags, include_volume), `/search/tags_by_categories`, `/events` (open and settled, nested markets), `/markets/{ticker}/orderbook`.
- Smoke test of `docs/assets/app.js` in jsdom with mocked responses shaped like the verified payloads (home, topic, dashboard, seconds-live mode, granularity switch). No runtime errors. Not a real-browser test.
- Internal link check: `node scripts/check-links.mjs` (15 pages, 0 broken internal links; 24 external links listed for review, not fetched).

## Claims log

- 2026-11-20 — session-ef745c36 claims T1–T8 on `arena/ef745c36-kalshidash1`.

## Handoff / conflict log

- 2026-11-20 — Found two other session branches with claims on the same work (see Overlap). No merge conflicts: they were not merged. This branch is the one proposed for PR to `main`.

## Integration record

- PR: _see below after creation_
- Merge result: _see below_
- GitHub Pages URL: _see below_
- Build/link check: `node scripts/build-site.mjs && node scripts/check-links.mjs` → 15 pages, no broken internal links.
