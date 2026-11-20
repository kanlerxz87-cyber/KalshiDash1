#!/usr/bin/env python3
"""Refresh dash/data/snapshot.json with fresh verified captures (2026-11-20 ~13:21 UTC).

Each value written here was read from the official demo API via the platform
fetch tool in this session; source URLs are recorded per row. Existing rows are
updated in place by ticker (prior rows preserved); nothing is inferred — values
not captured stay blank.
"""
import json

SNAP = 'dash/data/snapshot.json'
d = json.load(open(SNAP))

d['meta']['captured_at'] = '2026-11-20T13:21:00Z'
d['meta']['capture_note'] = ('Refreshed 2026-11-20 ~13:21 UTC from live demo-API reads (external-api.demo.kalshi.co). '
                             'Elections + crypto live-market rows refreshed; key series volumes refreshed where captured. '
                             'New verified trades_sample block added for the alert feed.')

API = 'https://external-api.demo.kalshi.co/trade-api/v2'

# ---- elections: KXELECTIONEMERGENCY live market (fresh capture) ----
em_fresh = {
    "ticker": "KXELECTIONEMERGENCY-27JAN01",
    "event_ticker": "KXELECTIONEMERGENCY",
    "title": "Will Donald Trump issue any executive action on declaring a national emergency regarding the 2026 United States midterm election before Jan 1, 2027?",
    "yes_sub_title": "Before Jan 1, 2027",
    "status": "active",
    "result": "",
    "last_price_dollars": "0.0700",
    "previous_price_dollars": "0.0700",
    "yes_bid_dollars": "0.0000", "yes_bid_size_fp": "0.00",
    "yes_ask_dollars": "0.0700", "yes_ask_size_fp": "16.00",
    "no_bid_dollars": "0.9300", "no_ask_dollars": "1.0000",
    "volume_fp": "7475.30", "volume_24h_fp": "0.00", "open_interest_fp": "7475.30",
    "notional_value_dollars": "1.0000",
    "close_time": "2027-01-01T04:59:00Z",
    "expected_expiration_time": "2026-11-03T15:00:00Z",
    "latest_expiration_time": "2027-01-08T15:00:00Z",
    "rules_primary": "If Donald Trump has taken any executive action declaring a national emergency regarding the 2026 United States midterm election before Jan 1, 2027, then the market resolves to Yes.",
    "rules_secondary": "The qualifying action must be of the specific type designated (executive order, presidential memorandum, proclamation, directive, determination, or finding), be signed by the President personally during the specified time period, and explicitly address the topic in the document's operative provisions, title, or official White House summary.",
    "settlement_source": "Kalshi settlement rules (event ticker KXELECTIONEMERGENCY)",
    "source_url": API + "/markets?series_ticker=KXELECTIONEMERGENCY&status=open&limit=10",
}

# ---- crypto: KXDEMOFUTHOURLY live market (fresh capture) ----
cm_fresh = {
    "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP",
    "event_ticker": "KXDEMOFUTHOURLY-26NOV20H14",
    "title": "Demo BTC at or above 61498.92 USD",
    "yes_sub_title": "At or above reference",
    "status": "active",
    "result": "",
    "last_price_dollars": "0.6500",
    "previous_price_dollars": "0.0000",
    "yes_bid_dollars": "0.0100", "yes_bid_size_fp": "10.00",
    "yes_ask_dollars": "1.0000", "yes_ask_size_fp": "0.00",
    "no_bid_dollars": "0.0000", "no_ask_dollars": "0.9900",
    "volume_fp": "2820.00", "volume_24h_fp": "2235.00", "open_interest_fp": "90.00",
    "notional_value_dollars": "1.0000",
    "close_time": "2026-11-20T14:00:00Z",
    "expected_expiration_time": "",
    "latest_expiration_time": "2026-11-20T14:05:00Z",
    "rules_primary": "Demo only. YES if the Coinbase Exchange BTC-USD one-minute candle ending at 2026-11-20T14:00:00+00:00 closes at or above 61498.92 USD; otherwise NO.",
    "rules_secondary": "",
    "settlement_source": "CF Benchmarks / Coinbase Exchange BTC-USD reference (series KXDEMOFUTHOURLY)",
    "source_url": API + "/markets?series_ticker=KXDEMOFUTHOURLY&status=open&limit=10",
}

def update_row(topic, fresh):
    rows = d['topics'][topic]['live_markets']
    for r in rows:
        if r['ticker'] == fresh['ticker']:
            r.update(fresh)
            print('updated', fresh['ticker'], 'in', topic)
            return
    rows.insert(0, dict(fresh, topic=topic))
    print('added', fresh['ticker'], 'to', topic)

update_row('elections', em_fresh)
update_row('crypto', cm_fresh)

# ---- series volumes refreshed (fresh capture, include_volume=true) ----
def refresh_series(topic, updates):
    rows = d['topics'][topic]['series']
    for u in updates:
        for r in rows:
            if r['ticker'] == u['ticker']:
                if u.get('volume_fp') != '':
                    r['volume_fp'] = u['volume_fp']
                if u.get('title'):
                    r['title'] = u['title']
                r['source_url'] = u.get('source_url', r.get('source_url'))
                print('series refreshed', u['ticker'], '->', u.get('volume_fp'))

refresh_series('elections', [
    {"ticker": "KXELECTIONEMERGENCY", "title": "Election emergency executive action", "volume_fp": "7517.00"},
    {"ticker": "SENATEMT", "title": "Montana Senate race", "volume_fp": "170079.00"},
    {"ticker": "KXCLACTON4TH", "title": "Clacton by-election: 4th place", "volume_fp": "47.00"},
    {"ticker": "KXTXSUPREME2", "title": "Texas Supreme Court Place 2 election", "volume_fp": "0.00"},
])
refresh_series('crypto', [
    {"ticker": "KXLTCMAXY", "title": "LTC Max", "volume_fp": "71118.00"},
    {"ticker": "KXSOL26500", "title": "Sol above 500 in 2026", "volume_fp": "209.00"},
    {"ticker": "KXBNBY", "title": "BNB Yearly", "volume_fp": "54.00"},
])

# ---- fresh trades sample for the alert feed (verified trade rows) ----
d['trades_sample'] = {
    "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP",
    "captured_at": "2026-11-20T13:19:14Z",
    "source_url": API + "/markets/trades?ticker=KXDEMOFUTHOURLY-26NOV20H14-UP&limit=50",
    "trades": [
        {"trade_id": "07261d6d-b1c9-91bc-fd1f-1e38baeb4809", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "15.00", "yes_price_dollars": "0.5500", "no_price_dollars": "0.4500", "taker_outcome_side": "no", "taker_book_side": "ask", "created_time": "2026-11-20T13:19:13.798123Z", "is_block_trade": False},
        {"trade_id": "07261d6d-2f61-be3d-e795-f046e6f7d24c", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "10.00", "yes_price_dollars": "0.4500", "no_price_dollars": "0.5500", "taker_outcome_side": "yes", "taker_book_side": "bid", "created_time": "2026-11-20T13:19:08.807194Z", "is_block_trade": False},
        {"trade_id": "07261d6d-6c39-9a0c-2ea0-021ddec5f715", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "5.00", "yes_price_dollars": "0.3500", "no_price_dollars": "0.6500", "taker_outcome_side": "yes", "taker_book_side": "bid", "created_time": "2026-11-20T13:19:03.799762Z", "is_block_trade": False},
        {"trade_id": "07261d6c-e291-b030-12d9-1a2361a8b6fc", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "20.00", "yes_price_dollars": "0.6500", "no_price_dollars": "0.3500", "taker_outcome_side": "no", "taker_book_side": "ask", "created_time": "2026-11-20T13:18:58.798052Z", "is_block_trade": False},
        {"trade_id": "07261d6c-ab69-bc12-0724-5e3c48248eaf", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "15.00", "yes_price_dollars": "0.5500", "no_price_dollars": "0.4500", "taker_outcome_side": "yes", "taker_book_side": "bid", "created_time": "2026-11-20T13:18:53.789661Z", "is_block_trade": False},
        {"trade_id": "07261d6c-35c1-a7a7-bcd0-88623685a58e", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "10.00", "yes_price_dollars": "0.4500", "no_price_dollars": "0.5500", "taker_outcome_side": "no", "taker_book_side": "ask", "created_time": "2026-11-20T13:18:48.790529Z", "is_block_trade": False},
        {"trade_id": "07261d74-17d9-a4cd-ba23-ec090590264e", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "5.00", "yes_price_dollars": "0.3500", "no_price_dollars": "0.6500", "taker_outcome_side": "no", "taker_book_side": "ask", "created_time": "2026-11-20T13:18:43.778125Z", "is_block_trade": False},
        {"trade_id": "07261d74-7971-9bb6-7060-16984e5e6aef", "ticker": "KXDEMOFUTHOURLY-26NOV20H14-UP", "count_fp": "20.00", "yes_price_dollars": "0.6500", "no_price_dollars": "0.3500", "taker_outcome_side": "yes", "taker_book_side": "bid", "created_time": "2026-11-20T13:18:38.807755Z", "is_block_trade": False},
    ],
}

json.dump(d, open(SNAP, 'w'), indent=2)
print('snapshot refreshed, captured_at =', d['meta']['captured_at'])
