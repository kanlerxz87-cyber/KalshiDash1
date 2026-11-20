# COORDINATION.md — Shared Task Board

> This file is the single shared task board for all agent sessions working on
> this repository. Read it before starting any work. Claim a task by writing
> your session ID and file scope, then commit and push the claim immediately.
> Never start a task another session has claimed. Keep scopes non-overlapping.
> If a task requires changing a file owned by another session, log the request
> here instead of editing it. Make small, frequent commits and run
> `git pull --rebase` before every push.

**Repo:** `kanlerxz87-cyber/KalshiDash1`
**Site (planned):** GitHub Pages from `docs/` on `main`
**Demo API (official):** `https://external-api.demo.kalshi.co/trade-api/v2`
— source: https://docs.kalshi.com/getting_started/demo_env
**Session ID for this session:** `session-3f5650f9`
**Branch for this session:** `arena/3f5650f9-kalshidash1` (branched from `main` @ `f1fa6aa`)

---

## Task board

| ID | Task | Status | Owner (session ID) | Files touched | Sources / verification | Irregularities |
|----|------|--------|--------------------|---------------|------------------------|----------------|
| T1 | Repo review (line-by-line) + create this board | done | session-3f5650f9 | `COORDINATION.md`, `README.md` | Repo at `f1fa6aa` contains only `README.md` (`# KalshiDash1`); verified with `git show HEAD --stat` and `ls -la`. No other files, no `.github/`, no `.gitignore`. | Repo was effectively empty — no prior code to review. |
| T2 | Executive summary, open questions, suggestions content | done | session-3f5650f9 | `docs/executive-summary.html`, `docs/questions.html`, `docs/suggestions.html`, `README.md` | Every factual claim links to https://docs.kalshi.com (see `docs/sources.html`). Unverifiable items moved to Flagged page, not stated as fact. | Sandbox outbound network cannot reach `*.kalshi.co` / `docs.kalshi.com` directly (TLS EOF); docs were verified via the fetch tool instead. Live API values are fetched in the visitor's browser, never hard-coded. |
| T3 | Live dashboard site (highest-dollar events, chart, liquidity, portfolio, trading) | done | session-3f5650f9 | `docs/index.html`, `docs/events.html`, `docs/portfolio.html`, `docs/trade.html`, `docs/strategies.html`, `docs/assets/*` | Endpoints from official docs: Get Markets, Get Market Orderbook, Get Market Candlesticks, Get Series List, Get Events, portfolio balance/positions/fills, Create Order (V2). See `docs/sources.html` rows S-01…S-24. | Browser CORS for the demo API could not be confirmed from the sandbox (no direct network). Site handles failure explicitly and never fabricates prices. See Flagged F-01. |
| T4 | Verification table + Flagged for Review page | done | session-3f5650f9 | `docs/sources.html`, `docs/flagged.html` | Each row cites an official `docs.kalshi.com` URL checked 2026-11-20. Values that could not be confirmed are blank + flagged. | — |
| T5 | Final integration: build check, link check, GitHub Pages, PR to `main`, merge | in progress | session-3f5650f9 | `.github/workflows/pages.yml` (if needed), `COORDINATION.md` | Link check run locally; Pages deploy checked via `gh run list` / Pages API after merge. | — |

**Status key:** `unclaimed` · `in progress` · `done` · `needs review`
(`needs review` = published on the Flagged for Review page; does not block anything.)

---

## Claims log

- **2026-11-20 — session-3f5650f9 claims T1–T5 (all tasks).** No other session
  is active on this repo (only branch `main` and this session branch exist).
  File scope: entire repo on branch `arena/3f5650f9-kalshidash1`. Claim
  committed and pushed before any other work, per instructions.

## Handoff / conflict log

- None. Single-session run; no merge conflicts encountered. `git pull --rebase`
  run before each push.

## Integration record (filled by T5)

- PR: _pending_
- Merge result: _pending_
- GitHub Pages URL: _pending_
- Link/build check: _pending_
