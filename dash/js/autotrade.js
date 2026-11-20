/* autotrade.js — automated SIMULATED trade engine for strategy testing.
 *
 * All execution is simulated in-browser against live public prices. Real order
 * placement needs the account holder's demo API keys and signed requests
 * (POST /portfolio/events/orders — docs.kalshi.com/api-reference/orders/create-order-v2).
 * This static site never requests or stores credentials (flagged F-02).
 *
 * Strategies (definitions and verified mechanics: analysis.html):
 *  - momentum:          enter in the direction of a >= $0.10 alert swing.
 *  - mean-reversion:    fade extremes — price <= 0.15 buy YES, >= 0.85 buy NO.
 *  - event-catalyst:    enter high-ROI markets whose close is within N hours.
 *  - liquidity-provision: when the spread is wide, rest simulated orders at both
 *                        book edges (inventory risk is the cost).
 *  - hold-to-resolution: enter high-ROI markets and hold until yes/no resolution.
 *
 * Engine state is persisted (localStorage) so runs survive page reloads.
 */
(function () {
  'use strict';
  var K = window.K;
  var NS = 'kalshidash:autotrade:v1:';
  var DEFAULTS = {
    enabled: { 'momentum': true, 'mean-reversion': true, 'event-catalyst': false, 'liquidity-provision': false, 'hold-to-resolution': true },
    qty: 10,               // contracts per simulated order
    maxOpen: 8,            // cap on concurrently open simulated positions
    capital: 1000,         // simulated capital ceiling (notional exposure)
    catalystHours: 24,     // event-catalyst: close within N hours
    minRoi: 0.40           // only trade markets the model scores at least this
  };

  function getCfg() {
    try {
      var raw = localStorage.getItem(NS + 'cfg');
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULTS);
  }
  function setCfg(c) { try { localStorage.setItem(NS + 'cfg', JSON.stringify(c)); } catch (e) {} }

  var cfg = getCfg();
  var log = [];       // in-memory engine decisions this session
  var watch = [];     // watched market rows
  var norms = { liq: {}, oi: {} };

  function pushLog(e) {
    e.ts = new Date().toISOString();
    log.unshift(e);
    if (log.length > 120) log.length = 120;
  }

  function openCount() {
    return Store.getTrades().filter(function (t) { return t.status === 'open' && !t.seed; }).length;
  }

  function exposure() {
    return Store.getTrades().filter(function (t) { return t.status === 'open' && !t.seed; })
      .reduce(function (a, t) { return a + t.price * t.qty; }, 0);
  }

  function place(m, side, price, strategy, reason, roi) {
    if (openCount() >= cfg.maxOpen) { pushLog({ kind: 'skip', reason: 'max open positions reached', ticker: m.ticker }); return false; }
    if (exposure() + price * cfg.qty > cfg.capital) { pushLog({ kind: 'skip', reason: 'capital ceiling reached', ticker: m.ticker }); return false; }
    if (price <= 0) return false;
    var tr = Store.addTrade({
      ticker: m.ticker, title: m.title, topic: m.topic,
      side: side, price: price, qty: cfg.qty, strategy: strategy,
      fee: 0, auto: true, entry_ts: new Date().toISOString()
    });
    pushLog({ kind: 'trade', reason: reason, ticker: m.ticker, side: side, price: price, strategy: strategy, roi: roi ? roi.score : null });
    return true;
  }

  function closePosition(m, price, reason) {
    var trades = Store.getTrades().filter(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker; });
    if (!trades.length) return false;
    trades.forEach(function (t) {
      var won = (t.side === 'yes' && price >= 0.995) || (t.side === 'no' && price <= 0.005);
      // simulate exit at current price for an early close, or full payout on resolution
      var exit = won ? 1 : 0;
      if (!won) exit = t.side === 'yes' ? price : (1 - price);
      Store.updateTrade(t.id, {
        status: 'settled', exit_price: exit,
        pnl: (exit - t.price) * t.qty,
        auto_exit_reason: reason
      });
    });
    pushLog({ kind: 'exit', reason: reason, ticker: m.ticker });
    return true;
  }

  /* ---- strategy evaluation per market ---- */
  function evaluate(m, price, alerts) {
    if (m.result) {
      // resolution: settle our open simulated positions on this market
      if (Store.getTrades().some(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker; })) {
        closePosition(m, price, 'resolved ' + m.result.toUpperCase());
      }
      return;
    }
    var roi = Alerts.modelScore(m, norms);
    if (!roi || roi.score < cfg.minRoi) return;

    // momentum: enter in the direction of the last alert for this ticker
    var last = alerts.filter(function (a) { return a.ticker === m.ticker && a.kind === 'swing'; })[0];
    if (cfg.enabled.momentum && last && !Store.getTrades().some(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker && t.strategy === 'momentum'; })) {
      if (last.side === 'up') place(m, 'yes', price, 'momentum', 'alert swing up', roi);
      else if (last.side === 'down') place(m, 'no', price, 'momentum', 'alert swing down', roi);
      return;
    }
    if (cfg.enabled['mean-reversion'] && !Store.getTrades().some(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker && t.strategy === 'mean-reversion'; })) {
      if (price <= 0.15) place(m, 'yes', price, 'mean-reversion', 'price at low extreme', roi);
      else if (price >= 0.85) place(m, 'no', price, 'mean-reversion', 'price at high extreme', roi);
      return;
    }
    if (cfg.enabled['event-catalyst']) {
      var closeMs = m.close_time ? new Date(m.close_time).getTime() : 0;
      var hours = closeMs ? (closeMs - Date.now()) / 3.6e6 : 999;
      if (hours > 0 && hours <= cfg.catalystHours && !Store.getTrades().some(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker && t.strategy === 'event-catalyst'; })) {
        place(m, price >= 0.5 ? 'no' : 'yes', price, 'event-catalyst', 'closes within ' + Math.ceil(hours) + 'h', roi);
        return;
      }
    }
    if (cfg.enabled['liquidity-provision']) {
      var b = K.fp(m.yes_bid_dollars), a = K.fp(m.yes_ask_dollars);
      var spread = (b !== null && a !== null) ? a - b : 0;
      if (spread >= 0.30 && !Store.getTrades().some(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker && t.strategy === 'liquidity-provision'; })) {
        place(m, 'yes', b || 0.05, 'liquidity-provision', 'wide spread ' + spread.toFixed(2), roi);
        return;
      }
    }
    if (cfg.enabled['hold-to-resolution'] && !Store.getTrades().some(function (t) { return t.status === 'open' && !t.seed && t.ticker === m.ticker && t.strategy === 'hold-to-resolution'; })) {
      place(m, price >= 0.5 ? 'no' : 'yes', price, 'hold-to-resolution', 'high-ROI market held to resolution', roi);
    }
  }

  function tick() {
    if (document.hidden) return;
    watch.forEach(function (m) {
      K.get('/markets/' + encodeURIComponent(m.ticker), { timeoutMs: 8000 }).then(function (r) {
        if (!r.data.market) return;
        var mm = Object.assign({}, m, r.data.market, {
          series_ticker: r.data.market.series_ticker || m.series_ticker,
          source_url: K.state.base + '/markets/' + encodeURIComponent(m.ticker)
        });
        evaluate(mm, K.fp(r.data.market.last_price_dollars), Alerts.state.feed);
      }).catch(function () {});
    });
  }

  function refresh() {
    return Data.allMarkets({ topN: 6 }).then(function (r) {
      watch = r.filter(function (m) { return !m.result && (m.status === 'active' || m.status === 'closed'); });
      norms = Alerts.computeNorms(watch);
      return watch;
    }).catch(function () { return watch; });
  }

  function stats() {
    var trades = Store.getTrades().filter(function (t) { return !t.seed; });
    var s = Store.computeStats(trades);
    s.auto = trades.length;
    return s;
  }

  window.Autotrade = {
    cfg: cfg, setCfg: function (c) { cfg = c; setCfg(c); },
    log: function () { return log; },
    stats: stats,
    init: function (opts) {
      opts = opts || {};
      var start = function () {
        refresh().then(function () {
          tick();
          setInterval(function () { refresh().then(function () { tick(); }); }, K.cfg.polling.marketRefreshMs);
        });
      };
      if (opts.onChange) start(); else start();
    }
  };
})();
