#!/usr/bin/env python3
"""Kalshi demo snapshot collector (offline tool, standard library only).

Purpose
-------
The site at ``docs/`` reads the Kalshi demo API live in the browser and stores
nothing.  This tool exists for the one thing a static page cannot do: keep a
durable record of rankings and resolutions over time (see SUG-01 in
``docs/suggestions.html``).

Sources of truth (verified 2026-11-20)
--------------------------------------
* Demo REST root  https://external-api.demo.kalshi.co/trade-api/v2
  -- https://docs.kalshi.com/getting_started/demo_env
* GET /markets    limit<=1000, status in unopened|open|paused|closed|settled
  -- https://docs.kalshi.com/api-reference/market/get-markets
* GET /series     params: category, tags, include_product_metadata,
  include_volume, min_updated_ts
  -- https://docs.kalshi.com/api-reference/market/get-series-list
* GET /markets/{ticker}/orderbook   [price_dollars, count_fp] levels, ascending,
  best bid last, order counts not returned
  -- https://docs.kalshi.com/api-reference/market/get-market-orderbook
* GET /series/{s}/markets/{t}/candlesticks  period_interval in {1,60,1440},
  timestamps in seconds, max 5000 periods
  -- https://docs.kalshi.com/api-reference/market/get-market-candlesticks

No value is invented: a field the API did not return is written as ``null`` and
the row is marked ``"unverified_fields"``.  Credentials are read from the
environment only (KALSHI_DEMO_KEY_ID / KALSHI_DEMO_PRIVATE_KEY_PEM_FILE) and are
never written to disk by this script.

Usage
-----
    python3 tools/kalshi_client.py snapshot --out data/snapshots
    python3 tools/kalshi_client.py snapshot --top 10 --hours 24 --stdout
    python3 tools/kalshi_client.py markets --category crypto --limit 25
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = os.environ.get("KALSHI_DEMO_BASE", "https://external-api.demo.kalshi.co/trade-api/v2")
USER_AGENT = "KalshiDash1/1.0 (demo snapshot tool)"

# Same keyword rules the browser client uses, so both produce the same rows.
# Keep docs/assets/kalshi.js and this list in sync (logged in COORDINATION.md).
CATEGORIES = {
    "gas": ["gasoline", "gas price", "gas prices", "fuel price", "fuel prices"],
    "elections": ["election", "president", "senate", "house race", "governor", "mayor", "ballot", "congress"],
    "culture": ["oscar", "grammy", "emmy", "box office", "movie", "film", "celebrity", "entertainment", "culture"],
    "crypto": ["crypto", "bitcoin", "ethereum", "btc", "eth price", "digital asset"],
    "golf": ["golf", "pga", "masters", "ryder cup", "open championship"],
}


def log(msg: str) -> None:
    print(f"[kalshi_client] {msg}", file=sys.stderr)


def http_get(path: str, params: dict | None = None, retries: int = 3) -> dict:
    """GET with cursor-friendly retry. 429 -> exponential backoff (documented)."""
    url = BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
    delay = 1.0
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
            return json.loads(body) if body.strip() else {}
        except urllib.error.HTTPError as exc:  # noqa: PERF203
            status = exc.code
            last_err = exc
            if status == 429 and attempt < retries:
                log(f"429 rate limited; backing off {delay:.1f}s")
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"HTTP {status} for {url}: {exc.read().decode('utf-8', 'replace')[:300]}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last_err = exc
            if attempt < retries:
                log(f"network error ({exc}); retry {attempt}/{retries} in {delay:.1f}s")
                time.sleep(delay)
                delay *= 2
                continue
    raise RuntimeError(f"unreachable: {url} ({last_err})")


def fnum(value, default=None):
    """Fixed-point values arrive as strings ('1234.00', '0.5600')."""
    if value is None or value == "":
        return default
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def last_price(market: dict):
    for key in ("last_price_dollars", "yes_last_price"):
        v = fnum(market.get(key))
        if v is not None and key.endswith("dollars"):
            return v
    cents = fnum(market.get("last_price"))
    if cents is not None:
        return cents / 100.0
    bid = fnum(market.get("yes_bid_dollars"), fnum(market.get("yes_bid")))
    ask = fnum(market.get("yes_ask_dollars"), fnum(market.get("yes_ask")))
    if bid is not None and ask is not None:
        return (bid + (ask / 100.0 if ask > 1.5 else ask)) / 2.0
    return bid


def volume(market: dict) -> float:
    return fnum(market.get("volume_fp", market.get("volume")), 0.0) or 0.0


def est_notional(market: dict):
    p = last_price(market)
    return None if p is None else round(volume(market) * p, 2)


def page_until(path: str, params: dict, key: str, max_pages: int = 5):
    """Cursor pagination (docs: https://docs.kalshi.com/getting_started/pagination)."""
    cursor, rows, pages = None, [], 0
    while pages < max_pages:
        data = http_get(path, {**params, **({"cursor": cursor} if cursor else {})})
        rows.extend(data.get(key) or [])
        cursor = data.get("cursor") or ""
        pages += 1
        if not cursor:
            break
    return rows


def match_category(series: dict):
    hay = " ".join([
        str(series.get("title") or ""),
        str(series.get("category") or ""),
        " ".join(series.get("categories") or []),
        str(series.get("ticker") or ""),
    ]).lower()
    for cat, kws in CATEGORIES.items():
        if any(kw in hay for kw in kws):
            return cat
    return None


def discover_series(max_pages: int = 6) -> dict:
    """GET /series (include_volume=true) -> {category: [series,...]}."""
    by_cat = {c: [] for c in CATEGORIES}
    series_rows = page_until("/series", {"include_volume": "true"}, "series", max_pages)
    for s in series_rows:
        cat = match_category(s)
        if cat:
            by_cat[cat].append(s)
    for cat in by_cat:
        by_cat[cat].sort(key=lambda s: fnum(s.get("volume_fp"), 0.0) or 0.0, reverse=True)
    log(f"scanned {len(series_rows)} series; matched " + ", ".join(f"{c}={len(v)}" for c, v in by_cat.items()))
    return by_cat


def open_markets(by_cat: dict, max_series_per_cat: int) -> list[dict]:
    rows = []
    for cat, series_list in by_cat.items():
        for s in series_list[:max_series_per_cat]:
            try:
                markets = http_get("/markets", {"series_ticker": s["ticker"], "status": "open", "limit": 1000}).get("markets") or []
            except RuntimeError as exc:
                log(f"skip {s['ticker']}: {exc}")
                continue
            for m in markets:
                rows.append({
                    "category": cat,
                    "series_ticker": s["ticker"],
                    "series_title": s.get("title"),
                    "ticker": m.get("ticker"),
                    "event_ticker": m.get("event_ticker"),
                    "title": m.get("yes_sub_title") or m.get("title"),
                    "status": m.get("status"),
                    "result": m.get("result", ""),
                    "last_price_dollars": last_price(m),
                    "volume_fp": fnum(m.get("volume_fp")),
                    "volume_24h_fp": fnum(m.get("volume_24h_fp")),
                    "open_interest_fp": fnum(m.get("open_interest_fp")),
                    "est_notional_dollars": est_notional(m),
                    "close_time": m.get("close_time"),
                    "settlement_ts": m.get("settlement_ts"),
                    "settlement_value_dollars": fnum(m.get("settlement_value_dollars")),
                })
    rows.sort(key=lambda r: (r["est_notional_dollars"] is None, -(r["est_notional_dollars"] or 0)))
    return rows


def settled_markets(series_tickers: set, hours_back: int, max_pages: int) -> list[dict]:
    """Status filter + optional min_settled_ts; falls back if the combination is rejected.

    Docs warn timestamp filters are "mutually exclusive from ... certain status filters"
    (https://docs.kalshi.com/api-reference/market/get-markets) - hence the fallback.
    """
    params_variants = [
        {"status": "settled", "limit": 1000, "min_settled_ts": int(time.time()) - hours_back * 3600},
        {"status": "settled", "limit": 1000},
    ]
    for params in params_variants:
        try:
            markets = page_until("/markets", params, "markets", max_pages)
        except RuntimeError as exc:
            log(f"settled query failed ({exc}); trying next variant")
            continue
        out = []
        for m in markets:
            if m.get("series_ticker") in series_tickers:
                out.append({
                    "category": None,
                    "series_ticker": m.get("series_ticker"),
                    "ticker": m.get("ticker"),
                    "event_ticker": m.get("event_ticker"),
                    "title": m.get("yes_sub_title") or m.get("title"),
                    "status": m.get("status"),
                    "result": m.get("result", ""),
                    "resolution": "YES" if m.get("result") == "yes" else "NO" if m.get("result") == "no" else None,
                    "last_price_dollars": last_price(m),
                    "est_notional_dollars": est_notional(m),
                    "settlement_ts": m.get("settlement_ts"),
                    "settlement_value_dollars": fnum(m.get("settlement_value_dollars")),
                    "close_time": m.get("close_time"),
                })
        if out:
            log(f"{len(out)} settled markets in tracked series")
        return out
    return out


def orderbook(ticker: str) -> dict:
    """Levels are [price_dollars, count_fp], ascending, best bid last."""
    data = http_get(f"/markets/{urllib.parse.quote(ticker)}/orderbook", {"depth": 100})
    book = data.get("orderbook_fp") or {}
    yes = book.get("yes_dollars") or []
    no = book.get("no_dollars") or []

    def agg(levels, label):
        return [{
            "side": label,
            "price_dollars": fnum(lv[0]),
            "contracts_fp": fnum(lv[1]),
            "notional_dollars": None if fnum(lv[0]) is None or fnum(lv[1]) is None else round(fnum(lv[0]) * fnum(lv[1]), 2),
        } for lv in levels]

    best_yes = fnum(yes[-1][0]) if yes else None
    best_no = fnum(no[-1][0]) if no else None
    return {
        "ticker": ticker,
        "yes_bids": agg(yes, "yes"),
        "no_bids": agg(no, "no"),
        "best_yes_bid_dollars": best_yes,
        "best_no_bid_dollars": best_no,
        # Binary equivalence: a YES bid at X is a NO ask at 1-X (orderbook docs).
        "implied_yes_ask_dollars": None if best_no is None else round(1 - best_no, 4),
        "implied_no_ask_dollars": None if best_yes is None else round(1 - best_yes, 4),
        "note": "aggregate contracts per price level; order counts are not returned by the API",
    }


def candlesticks(series_ticker: str, ticker: str, hours: int, period: int) -> list[dict]:
    """period_interval must be 1, 60 or 1440 minutes (candlestick docs)."""
    if period not in (1, 60, 1440):
        raise SystemExit("period_interval must be 1, 60 or 1440 minutes")
    end = int(time.time())
    start = end - hours * 3600
    if (end - start) // (period * 60) > 5000:
        start = end - 5000 * period * 60
        log("range shortened to the documented 5000-period maximum")
    data = http_get(f"/series/{urllib.parse.quote(series_ticker)}/markets/{urllib.parse.quote(ticker)}/candlesticks",
                    {"start_ts": start, "end_ts": end, "period_interval": period})
    return [{
        "end_period_ts": c.get("end_period_ts"),
        "yes_bid": fnum(c.get("yes_bid")),
        "yes_ask": fnum(c.get("yes_ask")),
        "price": fnum(c.get("price")),
        "volume_fp": fnum(c.get("volume_fp")),
        "open_interest_fp": fnum(c.get("open_interest_fp")),
    } for c in (data.get("candlesticks") or [])]


def cmd_snapshot(args) -> None:
    by_cat = discover_series()
    rows = open_markets(by_cat, args.max_series_per_cat)
    top = rows[: args.top]
    tickers = {s["ticker"] for lst in by_cat.values() for s in lst}
    settled = settled_markets(tickers, args.hours, args.pages) if args.with_settled else []

    books, candles = {}, {}
    for r in top:
        if not r.get("ticker"):
            continue
        try:
            books[r["ticker"]] = orderbook(r["ticker"])
        except Exception as exc:  # noqa: BLE001 - record, never fabricate
            books[r["ticker"]] = {"ticker": r["ticker"], "error": str(exc), "unverified_fields": ["orderbook"]}
        if r.get("series_ticker") and args.with_candles:
            try:
                candles[r["ticker"]] = candlesticks(r["series_ticker"], r["ticker"], args.hours, args.period)
            except Exception as exc:  # noqa: BLE001
                candles[r["ticker"]] = {"ticker": r["ticker"], "error": str(exc), "unverified_fields": ["candlesticks"]}

    snapshot = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_base_url": BASE_URL,
        "environment": "demo (mock funds; prices may not reflect real markets)",
        "ranking_definition": "estimated traded notional = volume_fp x last price (no official dollar-volume field)",
        "series_by_category": {c: [s.get("ticker") for s in lst] for c, lst in by_cat.items()},
        "markets": rows,
        "top": top,
        "settled": settled,
        "orderbooks": books,
        "candlesticks": candles,
    }
    payload = json.dumps(snapshot, indent=2, sort_keys=False)
    if args.stdout:
        print(payload)
        return
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    latest = out_dir / "latest.json"
    dated = out_dir / f"snapshot-{stamp}.json"
    latest.write_text(payload)
    dated.write_text(payload)
    log(f"wrote {dated} and {latest} ({len(rows)} markets, {len(settled)} settled)")


def cmd_markets(args) -> None:
    by_cat = discover_series()
    cat = args.category
    rows = open_markets({cat: by_cat.get(cat, [])} if cat else by_cat, args.max_series_per_cat)
    print(json.dumps(rows[: args.limit], indent=2))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("snapshot", help="write a JSON snapshot of rankings, resolutions, books and candles")
    s.add_argument("--out", default="data/snapshots")
    s.add_argument("--top", type=int, default=10, help="how many top markets to enrich with orderbook/candles")
    s.add_argument("--hours", type=int, default=24, help="lookback for candles and for settled markets")
    s.add_argument("--period", type=int, default=60, choices=[1, 60, 1440], help="candlestick interval in minutes")
    s.add_argument("--max-series-per-cat", type=int, default=12)
    s.add_argument("--pages", type=int, default=3, help="max pages for the settled query")
    s.add_argument("--with-settled", action="store_true", help="include recently settled markets")
    s.add_argument("--with-candles", action="store_true", help="include candlesticks for the top markets")
    s.add_argument("--stdout", action="store_true", help="print instead of writing files")
    s.set_defaults(func=cmd_snapshot)

    m = sub.add_parser("markets", help="print ranked market rows as JSON")
    m.add_argument("--category", choices=sorted(CATEGORIES))
    m.add_argument("--limit", type=int, default=25)
    m.add_argument("--max-series-per-cat", type=int, default=12)
    m.set_defaults(func=cmd_markets)

    args = ap.parse_args(argv)
    try:
        args.func(args)
    except RuntimeError as exc:
        log(f"ERROR: {exc}")
        log("Nothing was written. This tool never falls back to example or placeholder data.")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
