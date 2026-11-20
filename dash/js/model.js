/* model.js — alert engine core + transparent ROI model (session arena-f89b55f7).
 *
 * PURE LOGIC ONLY: no DOM, no fetch. The page layer (alerts.js) feeds it data from the
 * official demo Trade API; tools/alerts-qa.mjs runs this file in Node against mocked
 * responses shaped exactly like the documented/live-verified payloads.
 *
 * Verified mechanics this module relies on (see dash/sources.html rows S-A1…S-A4 and
 * dash/flagged.html F-08..F-10):
 *   - Prices are dollars, 0..1, tick $0.01 ("price_level_structure": "linear_cent",
 *     "price_ranges" step 0.0100 — verified live 2026-11-20 on the demo API).
 *   - Binary markets settle at $1 (YES winner) / $0 per contract (docs: market_settlement).
 *     A NO contract's value is 1 − YES price (no_bid_dollars = 1 − yes_ask_dollars was
 *     verified live: yes ask $0.0700 ↔ no bid $0.9300 on KXELECTIONEMERGENCY-27JAN01).
 *   - Swing alerts fire when the YES last-traded price moves ≥ $0.10 between two
 *     observations of this engine (project brief). REST responses are cached "for a
 *     short time" per the Get Markets docs, so alert timestamps can lag fills by the
 *     cache lag + one poll interval (flagged as F-08).
 *   - The engine never invents prices: any field it cannot parse stays null and the
 *     affected rule is skipped (no alert, no simulated trade).
 *
 * ROI model (transparent, documented on alerts.html):
 *   score = 100 × (0.35·liquidity + 0.20·spread + 0.25·momentum + 0.20·band)
 *   "model likes" = score ≥ 70 (the high-ROI filter for the second chat).
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    alertThreshold: 0.10,        /* $0.10 — the brief's swing threshold, both directions */
    staleMs: 15 * 60 * 1000,     /* observation gap > 15 min ⇒ re-baseline (no swing across the gap) */
    dedupMs: 60 * 1000,          /* same-direction duplicate alert suppression window */
    modelLike: 70,               /* score ≥ 70 ⇒ "model likes" */
    weights: { liquidity: 0.35, spread: 0.20, momentum: 0.25, band: 0.20 },
    liquidityRef: 2000,          /* 24h $ volume mapping to liquidity=1 (log scale; calibrated to the 2026-11-20 demo snapshot top rows: 1,175 / 7,475) */
    tradeNotional: 5,            /* simulated $ committed per automated entry */
    maxOpen: 3,                  /* max simultaneous automated positions */
    exitDelta: 0.10,             /* take-profit / stop-loss distance ($) */
    timeoutMs: 15 * 60 * 1000,   /* time stop for automated positions */
    perTopic: 6,                 /* tracked markets per focus topic (highest dollar first) */
    cap: 40                      /* overall tracked-market cap */
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* ---------- swing detection ---------- */

  /* prev/next: {price: number|string, tsMs: epoch ms}. Returns null or
   * {from, to, delta, dir: 'up'|'down'}. Guards: unparseable prices and stale
   * baselines never produce a swing (nothing is inferred). */
  function detectSwing(prev, next, cfg, nowMs) {
    cfg = cfg || DEFAULTS;
    var now = nowMs || Date.now();
    if (!prev || !next) return null;
    var p = num(prev.price), n = num(next.price);
    if (p === null || n === null) return null;
    if (!prev.tsMs || (now - prev.tsMs) > cfg.staleMs) return null;
    var delta = round4(n - p);
    if (Math.abs(delta) + 1e-9 < cfg.alertThreshold) return null;
    return { from: p, to: n, delta: delta, dir: delta > 0 ? 'up' : 'down' };
  }

  /* lastAlertMeta: {dir, tsMs} of the last alert raised for this ticker, or null. */
  function shouldAlert(lastAlertMeta, dir, cfg, nowMs) {
    cfg = cfg || DEFAULTS;
    var now = nowMs || Date.now();
    if (!lastAlertMeta || lastAlertMeta.dir !== dir) return true;
    return (now - lastAlertMeta.tsMs) > cfg.dedupMs;
  }

  /* ---------- ROI model ---------- */

  function volOf(m) {
    var v = num(m && m.volume_24h_fp);
    if (v === null) v = num(m && m.volume_fp);
    return v || 0;
  }

  /* m: market row (dollar-string fields, as returned by the demo API).
   * ctx: {recentDelta} — max absolute YES-price move observed this session within
   * the momentum window (0 while the session history is still warming up). */
  function scoreMarket(m, ctx, cfg) {
    cfg = cfg || DEFAULTS;
    ctx = ctx || {};

    var vol = volOf(m);
    var liquidity = clamp(Math.log10(1 + Math.max(0, vol)) / Math.log10(1 + cfg.liquidityRef), 0, 1);

    var bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars);
    var spreadPart;
    if (bid === null || ask === null) {
      spreadPart = 0.25; /* unknown quote — conservative neutral-ish, never inferred */
    } else {
      var sp = Math.max(0, ask - bid);
      spreadPart = clamp(1 - (sp - 0.01) / 0.09, 0, 1); /* $0.01 spread → 1, $0.10 → 0 */
    }

    var mom = clamp(Math.abs(ctx.recentDelta || 0) / cfg.alertThreshold, 0, 1);

    var mid = (bid !== null && ask !== null) ? (bid + ask) / 2 : num(m.last_price_dollars);
    var band = 0;
    if (mid !== null) {
      if (mid >= 0.15 && mid <= 0.85) band = 1;
      else if (mid < 0.15) band = clamp((mid - 0.02) / 0.13, 0, 1);
      else band = clamp((0.98 - mid) / 0.13, 0, 1);
    }

    var score = Math.round(100 * (
      cfg.weights.liquidity * liquidity +
      cfg.weights.spread * spreadPart +
      cfg.weights.momentum * mom +
      cfg.weights.band * band
    ));
    return {
      score: score,
      liked: score >= cfg.modelLike,
      parts: { liquidity: liquidity, spread: spreadPart, momentum: mom, band: band },
      inputs: { volume_24h: vol, bid: bid, ask: ask, mid: mid, recentDelta: ctx.recentDelta || 0 }
    };
  }

  /* ---------- track set: highest-dollar live events per focus topic ---------- */

  function tradeable(m) {
    var r = m.result || '';
    return !r && (m.status === 'active' || m.status === 'open' || m.status === 'initialized');
  }

  /* rows: merged market rows across the five focus topics (each row has .topic). */
  function pickTracked(rows, cfg) {
    cfg = cfg || DEFAULTS;
    var byTopic = {};
    rows.filter(tradeable).forEach(function (m) {
      var t = m.topic || 'other';
      byTopic[t] = byTopic[t] || [];
      byTopic[t].push(m);
    });
    var out = [];
    Object.keys(byTopic).forEach(function (t) {
      byTopic[t].sort(function (a, b) { return volOf(b) - volOf(a); });
      out = out.concat(byTopic[t].slice(0, cfg.perTopic));
    });
    out.sort(function (a, b) { return volOf(b) - volOf(a); });
    return out.slice(0, cfg.cap);
  }

  /* ---------- automated simulated strategies ---------- */

  /* alert: {ticker, dir, yes_ask, yes_bid, no_bid, no_ask, ...}
   * scored: scoreMarket() result. state: {openCount, byTicker: {ticker: true}}. */
  function planEntry(alert, scored, state, cfg) {
    cfg = cfg || DEFAULTS;
    if ((state && state.openCount || 0) >= cfg.maxOpen) return null;
    if (state && state.byTicker && state.byTicker[alert.ticker]) return null;

    var ask = num(alert.yes_ask), bid = num(alert.yes_bid);
    var noBid = num(alert.no_bid), noAsk = num(alert.no_ask);
    function ok(p) { return p !== null && p >= 0.02 && p <= 0.95; }
    function qty(p) { return Math.max(1, Math.floor(cfg.tradeNotional / p)); }

    if (alert.dir === 'up') {
      if (scored.liked && ok(ask)) {
        return { strategy: 'momentum-10c', side: 'yes', price: round4(ask), qty: qty(ask),
                 reason: 'model likes it (score ' + scored.score + '): enter with the ≥$0.10 jump at the ask' };
      }
      if (!scored.liked && ok(noBid)) {
        return { strategy: 'fade-jump', side: 'no', price: round4(noBid), qty: qty(noBid),
                 reason: 'fade: the model does not like this jump (score ' + scored.score + '); buy NO at its bid' };
      }
      return null;
    }
    /* dir === 'down' */
    if (scored.liked && ok(noAsk)) {
      return { strategy: 'momentum-10c', side: 'no', price: round4(noAsk), qty: qty(noAsk),
               reason: 'model likes it (score ' + scored.score + '): ride the ≥$0.10 drop on the NO side at its ask' };
    }
    if (!scored.liked && ok(ask)) {
      return { strategy: 'fade-jump', side: 'yes', price: round4(ask), qty: qty(ask),
               reason: 'fade: the model does not like this drop (score ' + scored.score + '); buy YES at its ask' };
    }
    return null;
  }

  /* pos: {side:'yes'|'no', price: entry $ of the traded side, qty, openedMs, status:'open'}.
   * lastPrice: current YES last-traded price (dollars). Returns null or
   * {exitPrice (value of the traded side), pnl, reason}. */
  function planExit(pos, lastPrice, cfg, nowMs) {
    cfg = cfg || DEFAULTS;
    var now = nowMs || Date.now();
    if (!pos || pos.status !== 'open') return null;
    var entry = num(pos.price), last = num(lastPrice);
    if (entry === null || last === null) return null;
    var cur = pos.side === 'no' ? round4(1 - last) : last;
    var d = round4(cur - entry);
    var reason = null;
    if (d >= cfg.exitDelta) reason = 'take-profit ≥ $' + cfg.exitDelta.toFixed(2);
    else if (d <= -cfg.exitDelta) reason = 'stop-loss ≥ $' + cfg.exitDelta.toFixed(2);
    else if (pos.openedMs && (now - pos.openedMs) >= cfg.timeoutMs) reason = 'time-stop (15 min)';
    if (!reason) return null;
    return { exitPrice: cur, pnl: round4((cur - entry) * pos.qty), reason: reason };
  }

  var AlertsEngine = {
    DEFAULTS: DEFAULTS,
    num: num, round4: round4, clamp: clamp,
    detectSwing: detectSwing,
    shouldAlert: shouldAlert,
    scoreMarket: scoreMarket,
    pickTracked: pickTracked,
    tradeable: tradeable,
    planEntry: planEntry,
    planExit: planExit
  };

  root.AlertsEngine = AlertsEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = AlertsEngine;
})(typeof window !== 'undefined' ? window : globalThis);
