# Coordination board

Updated: 2026-11-20 (UTC)

## Branch/session constraints

- Current Arena branch: `arena/7d376726-kalshidash1` (active; branched from `main` at `f1fa6aa404597e1413dfcea0efd8062866b7a80f`).
- The Arena session is restricted to this branch. No alternate branches or worktrees are created; this branch is also the owner/session identifier below.
- Repository was clean and contained only `README.md` when this board was created. No other active claims were present.
- GitHub connector lookup returned `unsupported`; local Git/`gh` availability will be checked before any GitHub operations.

## Task board

| Task | Status | Owner/session | File scope |
| --- | --- | --- | --- |
| Review the starter repository, verify requirements against official sources, build the Kalshi demo dashboard and supporting documentation, add GitHub Pages deployment, test, and integrate | in progress | `arena/7d376726-kalshidash1` | `COORDINATION.md`, `README.md`, site source/assets, documentation, and `.github/workflows/` |

## Verification / completion log

- Claim recorded before implementation. Initial inspection: `git status --short --branch` was clean; `README.md` contained only `# KalshiDash1`; no package manifest, application, tests, coordination board, or existing deployment workflow was present.
- Official Kalshi docs reviewed for public market-data access, market listing/detail/orderbook/candlestick schemas, API environments, API-key authentication, and WebSocket availability. Source URLs and field-level notes will be recorded as the implementation is verified.
- Important constraint already identified: GitHub Pages is a static host. Authenticated demo portfolio reads and order submission require signed API requests and a private key. No API credentials or secure server are present in this repository. The public site must not collect/store a private signing key in browser storage or claim authenticated tracking/trades are active. Any account-linked actions will remain clearly gated/flagged; a local-only paper-trading path can be provided separately.

## Flagged for review

- None published yet. Add each unverified requirement, data limitation, or implementation irregularity here and on the site's clearly labeled Flagged for Review page; unresolved items do not block deployment.
