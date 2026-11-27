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
| 0.20 | headroom | `min(from, 1−from) / 0.50` | moves near the extremes are mostly noise — **measured limit (F-94):** at $0.99 the term is 0.02, so it can contribute at most 0.005 and cannot exclude a row by itself; size + liquidity alone reach 0.775 |
| 0.20 | size | `min(1, |Δ| / 0.50)` | bigger move, bigger signal |
| 0.35 | liquidity | `min(1, volume_24h_fp / 1000)` | a move on an empty book cannot be traded |
| 0.25 | spread | `max(0, 1 − (ask − bid) × 10)` | a $0.10 spread eats a $0.10 move |
| ×0.5 | staleness | applied when the sample is > 1 h old | REST reads lag (S2) |

`highROI = score ≥ 0.62`. **It is not back-tested and it does not predict outcomes.** Each row

**Composition is measured, not assumed (F-94, 2026-11-27).** `node scripts/highroi-composition.mjs` reports what the
selective pane contains and fails if any `highROI` row misses its own threshold or is not `tradeable` at its recorded
swing price. On the committed sample of 2026-11-27T14:24:49Z: 20 of 121 alerts are `highROI`, all 20 are down-swings,
10 of 20 start within $0.05 of an extreme, and the size and liquidity terms are saturated (1.00) on every one of them —
so the published score there is driven by book tightness, not by headroom. No re-weighting was applied: a new weight
without a back-test would be a guess. See `flagged.html#F-94`.

Each row
prints its own term values so the ranking can be challenged.

### 3.5 Resolutions
Every market this engine has alerted on is re-read through
`GET /markets?series_ticker=…&status=settled&min_settled_ts=…&limit=1000` and kept once the API
publishes a `result` of `yes` / `no` / `scalar`, with `settlement_ts` and
`settlement_value_dollars`. Markets this engine does not track are **counted**
(`untracked_settled_seen`) rather than stored, so the tracked ones are not buried (S4, S7, S8).

Four rules make that reliable, each added on 2026-11-21 after a defect was reproduced (**F-70**):

1. **Only pending markets are asked about.** A series whose alerted markets have all resolved is
   no longer polled, and series whose tracked markets closed most recently are polled first, so the
   per-run request budget is spent where a result can exist.
2. **The query is sorted by settlement time.** S4 states that `min_settled_ts` / `max_settled_ts`
   sort by settlement time, latest first, and are the filters compatible with `status=settled`
   (`limit` is capped at 1000). Asking for `status=settled` alone sorts by creation time, so a busy
   series could fill the whole page with newly created strikes and never show a market that
   resolved this hour. `min_settled_ts` is set to one 15-minute overlap before the previous sample,
   and the cursor is still followed within a two-page budget.
3. **A followed market is not evicted before it resolves.** The 300-row market cap used to drop
   small rows, and a market evicted before its result was published had that result discarded as
   "untracked" — exactly the opposite of *track until it resolves*. Alerted markets now stay in the
   map until answered (and for 7 days after), and `settled_markets` remembers every ticker this
   engine has tracked.
4. **The resolved row keeps its answer.** The market row retains `result`, `status`,
   `settlement_ts` and `settlement_value_dollars`, so the market page can still show how it ended
   after the market leaves the open boards, and the feed publishes an `awaiting` list (alerted but
   unanswered) that the alerts page shows directly under the boards.

Regression assertions for all four live in `--selftest`; `scripts/check_alerts.mjs` rejects a feed
that lists an already-resolved market as awaiting.

### 3.6 Liquidity
The orderbook is shown raw — price level and contract count — with the derived yes ask
(`1 − best no bid`) and no ask (`1 − best yes bid`) labelled as derived, exactly as S6 documents.
Levels are asserted to be in ascending price order, and the derived values are asserted to match
their formula, by `scripts/check_alerts.mjs`.

### 3.7 How it is "live" on a static host
Two layers, and the page always says which one it is showing:

1. **Engine** (`.github/workflows/live-alerts.yml`): declares a 10-minute cron, samples the API when
   GitHub runs it, validates the result, and commits `data/live/feed.json`. This is the layer that
   keeps the record while nobody has the page open. **Measured delivery is much lower than declared**
   — 6 schedule runs in 34.6 h on 2026-11-20/22 (≈1 per 5.8 h), because GitHub delays or drops
   scheduled runs ([schedule docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule));
   the feed can therefore be hours old while the job is healthy, which is why the page shows the
   measured sample age and marks it `STALE` past 45 minutes (F-83).
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
| V-07 | Threshold logic, price rule, scoring, resolution merge, resolution paging/retention (F-70), ladder | `node tools/live_engine.mjs --selftest` | **PASS** — 72 assertions (2026-11-21) |
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
are historical and must not be acted on without review. The one-swing-per-ticker flood fix (PR #39) has since
merged; the exact count and the 0-new-alerts reading disagree with the persisted rows only because the feed
retains the full detected window — nothing was seeded to make the page look busy. See F-53 and F-BFC-01/F-BFC-03.

---

## 6. What is deliberately not implemented

| Not done | Why | What would be needed |
|---|---|---|
| Real order placement on the demo account | requires RSA/Ed25519 request signing with the account holder's private key; a static site must not hold it (S10). Existing Trading page documents the endpoint | the owner runs a local script with their own key, or a hosted backend with a secret store |
| Real portfolio/P&L from the demo account | same signing requirement | same |
| WebSocket streaming | authenticated handshake (S10) | a server-side proxy holding a key |
| A committed auto-trader | "automate simulated trades" is served by the simulator on `portfolio.html`; shipping an unattended bot that writes trades with no signed account would be simulated data pretending to be real | owner decision, plus keys |
| Back-tested model | would require a sufficient alert sample; the current feed holds 173 rows (mostly one ticker) that are historical and are not validated ROI performance, so fitting a model to this sample would be fabrication — PR #39 has merged the swing-per-ticker flood fix, so the deduplicated history is now the honest read | wait for real, deduplicated swings, then fit and validate out-of-sample |

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
| F-57 / F-BFC-01 / F-BFC-03 | Latest main tree (`b6cc469`) includes feed sample from `6838cd0`, generated 2026-11-21T06:55:07Z: 23 alert records (21 trade, 2 one-minute candle), 12 feed-labeled `crypto` / `KXBTCY-27JAN0100-B97500` and 11 `elections` / `KXPRESNOMD-28-AKLO`; `abs_delta` values are $0.80 and $0.96; 1 model high-ROI flag (heuristic threshold 0.62, not realized ROI); 120 duplicates collapsed; 0 feed resolutions. The other three focus topics have no alert records in this file. This is sample-only, not exchange-wide activity; newest alert `06:40:24.627Z`, about 14m42s before generation. The earlier 31-row and 22-row samples and the 06:49Z and 06:54Z 23-row samples are historical, as are older 99/173-row snapshots. Use the freshness badge for current age. See F-BFC-03 for the BTC price anomaly and F-57 for exact source URLs. |
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
