# ALERTS.md — live alert engine and the two-chat console

**Session:** `session-cb49437b` · **Date:** 2026-11-20 · **Branch:** `arena/cb49437b-kalshidash1`
**Page:** [`alerts/index.html`](../alerts/index.html) · **Engine:** [`tools/live_engine.mjs`](../tools/live_engine.mjs)
**Feed:** [`data/live/feed.json`](../data/live/feed.json) · **Board:** [`COORDINATION.md`](../COORDINATION.md)

This file records what was built, every source each rule is based on, the verification that was
actually run, and every irregularity found. Nothing on the page is stated without one of these
sources.

---

## 1. What the brief asked for, and where it now lives

| Requirement | Status | Where |
|---|---|---|
| Highest-dollar live events, five topics only (gas, elections, culture, crypto, golf) | done | `alerts/index.html` per-topic boards; engine `TOPICS` |
| Live alerting on swings **≥ $0.10 in either direction** | done | engine `detectSwing()` + `candleSwings()`; page feeds |
| Alert system as a **scrolling chat** | done | `#log-all` (all events) |
| **Second chat**, selective, "events our model likes as high ROI" | done | `#log-roi` + `scoreHighROI()` / `modelScore()` |
| Track events **until they resolve**, yes/no | done | `collectResolutions()`; "Resolved events" table |
| Automated **simulated trades** to test strategies | partly — see §6 | engine data feeds the simulator already on the site; no auto-trader is committed |
| Portfolio performance on the **demo account** | blocked without the account holder's key | see F-24 on the flagged page and the existing Portfolio page |
| Categorise trades, build strategies by trade type | existing | `portfolio.html`, `analysis.html` (simulated) |
| Price graph, **X = time (seconds/minutes/hours), Y = price** | done | `#chart`, window buttons 5 min → 7 days |
| Current **liquidity**: contracts available at a price | done | orderbook ladder, bids + derived asks |
| Sharper/organised UX, topics kept separate | done | per-topic tabs, per-topic candle + history budgets |
| Links to what may have caused a jump | done | every alert row links its API row, contract terms and settlement sources |

---

## 2. Sources (each rule is traceable to one)

| ID | Source | Used for |
|---|---|---|
| S1 | [Demo environment](https://docs.kalshi.com/getting_started/demo_env) | Recommended REST `https://external-api.demo.kalshi.co/trade-api/v2`, legacy `https://demo-api.kalshi.co/trade-api/v2`, WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`; mock funds; prices "may not be reflective" of real markets |
| S2 | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Which endpoints need no auth; REST responses are cached and can lag |
| S3 | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list) | `category` matches **any** entry in `categories`, exact and case-sensitive; `tags`, `include_volume` |
| S4 | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | `series_ticker`, `status` values, `limit ≤ 1000`, dedupe note |
| S5 | [Get Market](https://docs.kalshi.com/api-reference/market/get-market) | Field names: `last_price_dollars`, `yes_bid_dollars`, `yes_ask_dollars`, `*_size_fp`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `result`, `settlement_value_dollars`, `settlement_ts`, `close_time` |
| S6 | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | Bids only; best bid is the **last** element; `[price, count_fp]`; yes ask = 1 − best no bid |
| S7 | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | `active → closed → determined → finalized`; `result` is `yes`/`no`/`scalar` |
| S8 | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | Winning side receives $1 per contract |
| S9 | [Rate Limits](https://docs.kalshi.com/getting_started/rate_limits) | Unauthenticated limits are separate; back off exponentially on `429` |
| S10 | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | The WS handshake is **authenticated** (`KALSHI-ACCESS-*` headers), so a static site cannot use the live ticker channel |
| S11 | [`/search/tags_by_categories`](https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories) | The live tag taxonomy the topic rules are checked against |
| S12 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | `period_interval` ∈ {1,60,1440}; `price.high_dollars` / `low_dollars` / `close_dollars` are nullable when nothing traded; 5,000-period cap |

---

## 3. The method, stated plainly

### 3.1 Topics
| Topic | API filter | Narrowing | Why |
|---|---|---|---|
| Gas Prices | `Economics` + tag `Oil and energy`; `Commodities` + tag `Oil & Gas` | series title must contain the word "gas" | AAA gasoline series live under Economics/Oil and energy; natural-gas and TTF-gas under Commodities/Oil & Gas. The same tags also carry crude oil (Brent, WTI, heating oil), which are oil prices, not gas prices, so they are excluded by the title rule. (S3, S11) |
| Elections | `Elections` | none | the whole official category |
| Culture | `Culture` | none | the whole official category |
| Crypto | `Crypto` | none | the whole official category |
| Golf | `Sports` + tag `Golf` | none | a dedicated tag exists (S11) |

A run **fails loudly** if a tag disappears from a category that publishes tags, so an empty
board can never be caused silently by a stale filter. See irregularity **F-50** for the one
category that the taxonomy does not key.

### 3.2 The tracked price — and why this is the most important rule here

`trackedPrice()`, identical in the engine and the page. It is deliberately defensive, because
the demo API was measured returning prices that contradict each other (see the run record in §5).

A binary book is self-checking. S6 documents the reciprocity that must hold:

```
yes_ask + no_bid = $1.00        yes_bid + no_ask = $1.00
```

The rule, in order:

1. **Reciprocity test.** If both sides are present and `|yes_ask + no_bid − 1| > $0.02` (or the
   same for `yes_bid + no_ask`), the row contradicts itself. The price is then taken from the
   **NO side** (`1 − no price`), which the corrupt field was not part of, and the row is marked
   `book_inconsistent`.
2. **Stale-last-price test.** On a *tight* book (spread ≤ $0.10, where a midpoint is meaningful)
   a `last_price_dollars` more than $0.25 from the midpoint is treated as stale and the midpoint is
   used instead. A **wide** but reciprocal book keeps its last traded price — replacing a real
   0.943 trade with the midpoint of a 0.01/0.94 book would be worse than useless. That case is a
   documented live market (`KXPRESNOMD-28-JP`).
3. **Corroboration.** A swing found by *sampling* is published as an alert only if the new price is
   within $0.10 of a **second published field** — the book (yes quotes or 1 − no quotes) or
   `previous_price_dollars`. Uncorroborated swings are suppressed and counted, never shown.
   Trade- and candle-detected alerts are exempt: their price *is* a published trade.
4. **Otherwise null.** The market is skipped and counted in `markets_without_price`.

Every branch returns a published quote, a published previous price, or null. No midpoint is ever
invented from an empty book, and no default value exists anywhere in this path.

### 3.3 Alert rule
An alert is raised when |new price − baseline| ≥ **$0.10**.

* Baseline = the previous sample of the same contract, or the price of the last alert for that
  contract if that alert is less than 30 minutes old (so a slow grind alerts once, not every
  sample).
* The comparison is inclusive at exactly $0.10, and uses rounding so binary floating point cannot
  drop a boundary case (`0.34 → 0.44` alerts; `0.34 → 0.43` does not). Both cases are asserted in
  `--selftest`.

A second detector reads 1-minute candles for the top contracts of **each** topic:

* up-swing: `close_dollars − low_dollars ≥ $0.10`
* down-swing: `high_dollars − close_dollars ≥ $0.10`
* candles with null OHLC (nothing traded) are skipped, never treated as a price;
* repeated identical swings in consecutive candles collapse to one alert. (S12)

These rows are marked `candle` in the feed, so a reader can tell how each alert was found.

### 3.4 The high-ROI model
`modelScore()` — a fixed, published heuristic with weights summing to 1.0:

| Weight | Term | Formula | Reasoning |
|---|---|---|---|
| 0.20 | headroom | `min(from, 1−from) / 0.50` | moves near the extremes are mostly noise |
| 0.20 | size | `min(1, |Δ| / 0.50)` | bigger move, bigger signal |
| 0.35 | liquidity | `min(1, volume_24h_fp / 1000)` | a move on an empty book cannot be traded |
| 0.25 | spread | `max(0, 1 − (ask − bid) × 10)` | a $0.10 spread eats a $0.10 move |
| ×0.5 | staleness | applied when the sample is > 1 h old | REST reads lag (S2) |

`highROI = score ≥ 0.62`. **It is not back-tested and it does not predict outcomes.** Each row
prints its own term values so the ranking can be challenged.

### 3.5 Resolutions
Every tracked market is re-read through `GET /markets?series_ticker=…&status=settled` and kept once
the API publishes a `result` of `yes` / `no` / `scalar`, with `settlement_ts` and
`settlement_value_dollars`. Markets this engine does not track are **counted**
(`untracked_settled_seen`) rather than stored, so the tracked ones are not buried (S4, S7, S8).

### 3.6 Liquidity
The orderbook is shown raw — price level and contract count — with the derived yes ask
(`1 − best no bid`) and no ask (`1 − best yes bid`) labelled as derived, exactly as S6 documents.
Levels are asserted to be in ascending price order, and the derived values are asserted to match
their formula, by `scripts/check_alerts.mjs`.

### 3.7 How it is "live" on a static host
Two layers, and the page always says which one it is showing:

1. **Engine** (`.github/workflows/live-alerts.yml`): samples the API every 10 minutes, validates
   the result, and commits `data/live/feed.json`. This is the layer that keeps the record while
   nobody has the page open.
2. **Browser**: while the page is open it polls the same public endpoints and merges the results,
   giving second-level freshness when the browser is allowed to make the cross-origin request.
   If it is not, the page says so and continues on the engine feed.

The WebSocket ticker channel would remove the polling delay, but its handshake requires a signed
API key (S10), which this site does not hold and will not ask for. That is recorded as F-51.

---

## 4. Verification actually performed

| # | Check | Command / method | Result |
|---|---|---|---|
| V-01 | Endpoint list in the brief matches the official docs character for character | read S1 | **PASS** — brief and docs agree |
| V-02 | Every configured category/tag exists in the live taxonomy, or is documented | S11 fetched, compared to `TOPICS` | **PASS with one note** — `Culture` is not keyed (F-50) |
| V-03 | Gas-price markets really exist | `GET /series?category=Economics&tags=Oil and energy` | **PASS** — AAA series returned (e.g. `KXAAAGASMTX`) |
| V-04 | Natural-gas markets are reachable | `GET /series?category=Commodities&tags=Oil & Gas`, then `GET /markets?series_ticker=KXNATGASW` | **PASS** — strikes such as `KXNATGASW-26NOV2717-T5.899` |
| V-05 | Culture category works despite the missing taxonomy key | `GET /series?category=Culture` | **PASS** — series `KXXBANNEDGROK` etc., `category: "Culture"` |
| V-06 | Field names used by the engine exist | S5 read; live payloads contain every field used | **PASS** |
| V-07 | Threshold logic, price rule, scoring, resolution merge, ladder | `node tools/live_engine.mjs --selftest` | **PASS** — 30 assertions |
| V-08 | Feed cannot contain a sub-threshold alert, an invented price, a non-official source or a false high-ROI flag | `node scripts/check_alerts.mjs` | **PASS**; and deliberately-corrupted input produced 8 expected failures |
| V-09 | Page renders both feeds, filters correctly, never shows an invented price | `node scripts/check_alerts_page.mjs` (jsdom) | **PASS** — 14 assertions |
| V-10 | Engine runs against the live demo API | GitHub Actions `live-alerts` runs | **PASS** — see §5 |
| V-11 | Internal links across the whole published tree | `node scripts/check-links.mjs`, `python3 tools/linkcheck.py` | **PASS** — 64 pages, 0 broken |

The engine selftest and the page test run on every push (`.github/workflows/alerts-qa.yml`), so a
regression in any of these rules fails CI rather than reaching the site.

---

## 5. Live run record

| Run | Result | What it proved / found |
|---|---|---|
| 1 | failed (by design) | Reached the API; the taxonomy guard stopped the run because `Culture` is unkeyed. This is F-50, found by the engine's own check, not by inspection. |
| 2 | success | First real sample: series for all five topics found; the data exposed three defects (below). |
| 3 | success | Per-topic **series** budget added. |
| 4 | success | Per-topic **candle** and **history** budgets added; per-run counters fixed. |

Defects found in real data and fixed (each would have been invisible without running it):

1. **Topic starvation** — golf's high-volume series took every slot in the global ranking, so gas,
   culture and crypto got no markets. Fixed with a round-robin budget across the five topics.
2. **5 MB state file** — verbose per-sample objects and raw series rows. Fixed with compact
   `[timestamp, price]` history, series summaries, and a per-topic history cap; now ~0.8 MB.
3. **Wrong counters** — `markets_sampled` reported 0 because the state was reset on the second
   `applySample()` call of the same run. Fixed with a `run_id`-scoped accumulator.

A fifth and sixth pass then fixed the **price-coherence defect** (F-49) in four layers —
reciprocity, stale-last-price, corroboration, and a clean state reset — after the demo API was
caught returning `last_price_dollars: 0.8030` for a market whose book was `yes 0.0020 / 0.0030`
and whose `previous_price_dollars` was `0.0030`. That is a $0.80 jump from $0.003, and every
version of the rule before the final one would have published it as a real alert. It was caught by
re-reading the single-market endpoint after an alert looked implausible, not by code review.

Alerts so far: the latest sample (2026-11-21T06:28:52Z) created **0 new trade alerts** and added 60 candle
alerts (242 duplicates collapsed). The persisted feed deliberately retains its rows across the retained range
— it currently holds 173 rows (99 for `KXPRESNOMD-28-AKLO` and 74 for `KXBTCY-27JAN0100-B97500`), many of which
are historical and must not be acted on without review. The one-ticker flood is addressed by open PR #39;
the exact count and the 0-new-alerts reading disagree with the persisted rows only because the feed retains
the full detected window — nothing was seeded to make the page look busy. See F-53 and F-BFC-01/F-BFC-02.

---

## 6. What is deliberately not implemented

| Not done | Why | What would be needed |
|---|---|---|
| Real order placement on the demo account | requires RSA/Ed25519 request signing with the account holder's private key; a static site must not hold it (S10). Existing Trading page documents the endpoint | the owner runs a local script with their own key, or a hosted backend with a secret store |
| Real portfolio/P&L from the demo account | same signing requirement | same |
| WebSocket streaming | authenticated handshake (S10) | a server-side proxy holding a key |
| A committed auto-trader | "automate simulated trades" is served by the simulator on `portfolio.html`; shipping an unattended bot that writes trades with no signed account would be simulated data pretending to be real | owner decision, plus keys |
| Back-tested model | would require a sufficient alert sample; the current feed holds 173 rows (mostly one ticker) that are historical and are not validated ROI performance, so fitting a model to this sample would be fabrication — PR #39 is addressing the flood first | wait for real, deduplicated swings, then fit and validate out-of-sample |

---

## 7. Irregularities

Full list with links: [Flagged for review](../flagged.html#F-50). Alert-specific items (IDs as published on the flagged page):

| ID | Item |
|---|---|
| F-50 | `/search/tags_by_categories` omits `Culture` while `GET /series?category=Culture` serves it — upstream API inconsistency, verified both ways |
| F-51 | Browser→API CORS could not be confirmed from the sandbox; the page detects and reports it |
| F-03 (existing) | No traded-dollar field exists; ranking is `volume_fp × price`, labelled as an estimate |
| F-53 | The high-ROI model is a documented heuristic, not a back-tested model |
| F-05 (existing) | "Gas prices" excludes crude oil that shares the `Oil & Gas` tag — a judgement call, stated openly |
| F-57 / F-BFC-01 | History vs current state: no contract has moved the full $0.10 threshold in the LATEST sample (0 new trade alerts), but the persisted feed holds 173 historical rows on two tickers — these must not be acted on as real events; nothing is seeded to make the page look busy |
| F-51 | No streaming: schedule + polling only, because the WS handshake needs a key |
| F-24 (existing) | Demo-account portfolio sync still needs the owner's key |

---

## 8. Files

| File | Purpose |
|---|---|
| `tools/live_engine.mjs` | discovery, sampling, swing detection, candles, resolutions, orderbooks, state, selftest |
| `alerts/index.html` | the console: two chats, chart, per-topic boards, resolutions, ladder, method |
| `alerts/js/alerts-live.js` | data layer: engine feed + browser polling, merge, scoring |
| `alerts/js/alerts-page.js` | rendering: feeds, chart, tables, ladders, controls |
| `alerts/css/alerts.css` | styles (same design tokens as the rest of the site) |
| `scripts/check_alerts.mjs` | feed validator (threshold, sources, price range, enums, model consistency) |
| `scripts/check_alerts_page.mjs` | jsdom render/behaviour test |
| `.github/workflows/live-alerts.yml` | scheduled sampling + commit |
| `.github/workflows/alerts-qa.yml` | CI for the engine, the feed and the page |
| `data/live/feed.json` | published feed (the site reads this) |
| `data/live/state.json` | engine state carried between runs |
