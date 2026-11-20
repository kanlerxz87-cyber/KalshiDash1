/* KalshiDash1 — page logic. No external dependencies.
   Live data comes from the Kalshi demo API in the visitor's browser.
   If the API is unreachable (offline, CORS, blocked), the UI says so
   explicitly and never displays invented prices. */
(function () {
  "use strict";
  var K = window.KalshiDash, Chart = window.KalshiChart;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (v) { return v === null || v === undefined || isNaN(v) ? "—" : "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var cents = function (v) { return v === null || v === undefined || isNaN(v) ? "—" : "$" + Number(v).toFixed(4); };
  var numFmt = function (v) { return v === null || v === undefined || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }); };
  var nowSec = function () { return Math.floor(Date.now() / 1000); };

  /* ---------- nav ---------- */
  document.querySelectorAll("nav.main a").forEach(function (a) {
    if (a.getAttribute("href") === location.pathname.split("/").pop() || (location.pathname.endsWith("/") && a.getAttribute("href") === "index.html")) a.classList.add("active");
  });

  /* ---------- shared state ---------- */
  var state = {
    seriesByCategory: null, allSeries: [], ranked: [], selected: null,
    samples: [], windowSec: 3600, liveTimer: null, bookTimer: null, ws: null,
    lastRefresh: null, liveOk: false, settled: []
  };
  function setStatus(ok, msg) {
    var el = $("live-status"); if (!el) return;
    el.className = "badge " + (ok ? "live" : "warn");
    el.textContent = msg;
    var t = $("last-refresh"); if (t) t.textContent = state.lastRefresh ? "Last refresh: " + new Date(state.lastRefresh).toLocaleString() : "Not refreshed yet";
  }
  function showError(id, err) {
    var el = $(id); if (!el) return;
    el.style.display = "block";
    el.innerHTML = "<strong>Live data unavailable.</strong> " + esc(err && err.message ? err.message : err) +
      "<br><span class='small'>This usually means the browser could not reach the Kalshi demo API (offline, network blocked, or CORS). " +
      "No prices are shown rather than invented ones. Check your connection and press Refresh. " +
      "Details: <a href='https://docs.kalshi.com/getting_started/demo_env' target='_blank' rel='noopener'>Demo environment docs</a>.</span>";
  }
  function hideError(id) { var el = $(id); if (el) el.style.display = "none"; }

  /* ---------- category discovery + ranking (dashboard & events) ---------- */
  function loadCategories() {
    return K.discoverCategories(5).then(function (res) {
      state.seriesByCategory = res.byCategory; state.allSeries = res.allSeries;
      renderSeriesTable();
      return K.rankHighestDollar(res.byCategory, 12);
    }).then(function (rows) {
      state.ranked = rows; state.liveOk = true; state.lastRefresh = Date.now();
      renderRanked(rows);
      if (rows.length && !state.selected) selectMarket(rows[0]);
      setStatus(true, "LIVE — demo API");
      hideError("dash-error");
      return rows;
    }).catch(function (err) {
      state.liveOk = false; setStatus(false, "OFFLINE / API UNREACHABLE");
      showError("dash-error", err);
      var tb = $("ranked-body"); if (tb) tb.innerHTML = "<tr><td colspan='8' class='muted'>No live rows — see error above. Nothing has been fabricated.</td></tr>";
      throw err;
    });
  }
  function renderSeriesTable() {
    var tb = $("series-body"); if (!tb) return;
    var html = "";
    K.CATEGORIES.forEach(function (cat) {
      var list = (state.seriesByCategory[cat.id] || []);
      html += "<tr><td><strong>" + esc(cat.label) + "</strong></td><td class='num'>" + list.length + "</td><td>" +
        (list.slice(0, 8).map(function (s) { return "<code>" + esc(s.ticker) + "</code> " + esc(s.title || "") + " <span class='muted small'>series volume_fp " + numFmt(K.num(s.volume_fp, 0)) + " contracts</span>"; }).join("<br>") || "<span class='muted'>None matched by keyword rules — see Methodology.</span>") +
        (list.length > 8 ? "<br><span class='muted'>+" + (list.length - 8) + " more</span>" : "") + "</td></tr>";
    });
    tb.innerHTML = html;
  }
  function renderRanked(rows) {
    var tb = $("ranked-body"); if (!tb) return;
    if (!rows.length) { tb.innerHTML = "<tr><td colspan='8' class='muted'>No open markets matched the 5 categories in the scanned series. Try Refresh — series are discovered live and change over time.</td></tr>"; return; }
    tb.innerHTML = rows.slice(0, 25).map(function (r, i) {
      var m = r.market;
      return "<tr data-ticker='" + esc(m.ticker) + "' style='cursor:pointer'>" +
        "<td class='num'>" + (i + 1) + "</td><td><span class='tag'>" + esc(r.categoryLabel) + "</span></td>" +
        "<td><strong>" + esc(K.displayTitle(m)) + "</strong><br><code>" + esc(m.ticker) + "</code>" +
        (K.isResolved(m) ? " <span class='badge ok'>" + esc(K.resolutionLabel(m)) + "</span>" : "") + "</td>" +
        "<td class='num'>" + money(r.notional) + "<br><span class='muted small'>24h " + money(r.notional24h || 0) + "</span></td>" +
        "<td class='num'>" + numFmt(r.volume) + "<br><span class='muted small'>24h " + numFmt(r.volume24h || 0) + "</span></td>" +
        "<td class='num'>" + cents(r.lastPrice) + "</td><td class='num'>" + numFmt(r.openInterest) + "</td>" +
        "<td class='small'>" + esc(m.close_time || "—") + "</td></tr>";
    }).join("");
    tb.querySelectorAll("tr[data-ticker]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        var row = rows.filter(function (r) { return r.market.ticker === tr.getAttribute("data-ticker"); })[0];
        if (row) selectMarket(row);
      });
    });
  }

  /* ---------- market detail: chart + orderbook ---------- */
  function selectMarket(row) {
    state.selected = row; state.samples = [];
    var t = $("sel-title"); if (t) t.textContent = K.displayTitle(row.market);
    var s = $("sel-sub"); if (s) s.textContent = row.market.ticker + " · " + row.categoryLabel + " · Series " + row.seriesTicker;
    var lp = $("sel-price"); if (lp) lp.textContent = cents(row.lastPrice);
    var vol = $("sel-vol"); if (vol) vol.textContent = numFmt(row.volume) + " contracts";
    var oi = $("sel-oi"); if (oi) oi.textContent = numFmt(row.openInterest) + " open interest";
    loadChart(); loadOrderbook();
    startLiveSampling();
  }
  function candleClose(c) {
    var v = c && c.price && (c.price.close !== undefined ? c.price.close : c.price);
    if (v === null || v === undefined) return null;
    var n = parseFloat(v); if (isNaN(n)) return null;
    return n > 1.5 ? n / 100 : n; /* cents -> dollars defensive */
  }
  function loadChart() {
    var cv = $("price-chart"); if (!cv || !state.selected) return;
    var m = state.selected.market, w = state.windowSec;
    if (w <= 300) {
      /* Seconds/minutes: live samples collected in-browser (candlesticks start at 1 minute). */
      Chart.drawLineChart(cv, state.samples, { windowSec: w, title: "Live samples (polling every 5s) — window " + w + "s" });
      return;
    }
    var end = nowSec(), start = end - w;
    var period = w <= 86400 ? 1 : 60;
    if (w >= 86400) period = 60;
    K.getCandlesticks(state.selected.seriesTicker, m.ticker, start, end, period).then(function (candles) {
      var pts = candles.map(function (c) { return { t: c.end_period_ts, p: candleClose(c) }; }).filter(function (p) { return p.p !== null; });
      Chart.drawLineChart(cv, pts, { windowSec: w, title: m.ticker + " · candlesticks (" + period + "m) · last " + Math.round(w / 3600) + "h" });
    }).catch(function (err) {
      Chart.drawLineChart(cv, state.samples, { windowSec: w, title: "Candlesticks unavailable — showing live samples. " + err.message });
    });
  }
  function startLiveSampling() {
    if (state.liveTimer) clearInterval(state.liveTimer);
    function tick() {
      if (!state.selected) return;
      K.getMarket(state.selected.market.ticker).then(function (m) {
        var p = K.lastPrice(m);
        if (p !== null) {
          state.samples.push({ t: nowSec(), p: p });
          if (state.samples.length > 600) state.samples.shift();
          var lp = $("sel-price"); if (lp) lp.textContent = cents(p);
          if (state.windowSec <= 300) loadChart();
        }
      }).catch(function () { /* keep last samples; status banner already explains */ });
    }
    tick(); state.liveTimer = setInterval(tick, 5000);
    if (state.bookTimer) clearInterval(state.bookTimer);
    state.bookTimer = setInterval(loadOrderbook, 10000);
  }
  function loadOrderbook() {
    if (!state.selected) return;
    K.getOrderbook(state.selected.market.ticker, 0).then(function (book) {
      var yes = book.yes_dollars || [], no = book.no_dollars || [];
      var tb = $("book-body");
      if (tb) {
        function rows(levels, label) {
          var desc = levels.slice().sort(function (a, b) { return parseFloat(b[0]) - parseFloat(a[0]); }).slice(0, 12);
          var cum = 0;
          return desc.map(function (l) {
            var price = parseFloat(l[0]), qty = parseFloat(l[1]); cum += qty;
            return "<tr><td>" + label + "</td><td class='num'>" + cents(price) + "</td><td class='num'>" + numFmt(qty) + "</td><td class='num'>" + numFmt(cum) + "</td><td class='num'>" + money(price * qty) + "</td></tr>";
          }).join("") || "<tr><td colspan='5' class='muted'>No " + label + " bids returned.</td></tr>";
        }
        tb.innerHTML = rows(yes, "YES bid") + rows(no, "NO bid");
      }
      var bestYes = yes.length ? parseFloat(yes[yes.length - 1][0]) : null;
      var bestNo = no.length ? parseFloat(no[no.length - 1][0]) : null;
      var el = $("best-bid-ask");
      if (el) el.innerHTML = "Best YES bid: <strong>" + cents(bestYes) + "</strong> · Best NO bid: <strong>" + cents(bestNo) + "</strong>" +
        (bestYes !== null && bestNo !== null ? " · Implied YES ask (1 − NO bid): <strong>" + cents(1 - bestNo) + "</strong> · Implied NO ask (1 − YES bid): <strong>" + cents(1 - bestYes) + "</strong>" : "");
      var totYes = yes.reduce(function (a, l) { return a + parseFloat(l[1]); }, 0);
      var totNo = no.reduce(function (a, l) { return a + parseFloat(l[1]); }, 0);
      var t = $("book-totals"); if (t) t.textContent = "Total contracts resting: YES " + numFmt(totYes) + " · NO " + numFmt(totNo) + " · Levels: " + yes.length + " / " + no.length;
      var cv = $("depth-chart"); if (cv) Chart.drawDepth(cv, yes, no);
    }).catch(function (err) {
      var tb = $("book-body"); if (tb) tb.innerHTML = "<tr><td colspan='5' class='muted'>Orderbook unavailable: " + esc(err.message) + "</td></tr>";
    });
  }

  /* ---------- simulator (local paper portfolio, zero credentials) ---------- */
  var SIM_KEY = "kalshidash_sim_v1";
  function loadSim() {
    try { return JSON.parse(localStorage.getItem(SIM_KEY)) || null; } catch (e) { return null; }
  }
  function saveSim(s) { localStorage.setItem(SIM_KEY, JSON.stringify(s)); }
  function sim() {
    var s = loadSim();
    if (!s) { s = { cash: 1000, positions: {}, trades: [], equity: [] }; saveSim(s); }
    return s;
  }
  function priceBucket(p) { if (p === null || p === undefined) return "unknown"; if (p < 0.2) return "<20¢"; if (p < 0.4) return "20–40¢"; if (p < 0.6) return "40–60¢"; if (p < 0.8) return "60–80¢"; return ">80¢"; }
  function renderSim() {
    var s = sim();
    var cash = $("sim-cash"); if (cash) cash.textContent = money(s.cash);
    var posBody = $("sim-pos-body");
    if (posBody) {
      var keys = Object.keys(s.positions);
      posBody.innerHTML = keys.length ? keys.map(function (t) {
        var p = s.positions[t];
        return "<tr><td>" + esc(p.title || t) + "<br><code>" + esc(t) + "</code></td><td><span class='tag'>" + esc(p.categoryLabel || "—") + "</span></td>" +
          "<td class='num'>" + numFmt(p.qty) + "</td><td class='num'>" + cents(p.avgPrice) + "</td><td class='num'>" + money(p.qty * p.avgPrice) + "</td></tr>";
      }).join("") : "<tr><td colspan='5' class='muted'>No simulator positions yet. Place a trade on the Trade page.</td></tr>";
    }
    var trBody = $("sim-trades-body");
    if (trBody) {
      trBody.innerHTML = s.trades.length ? s.trades.slice().reverse().slice(0, 50).map(function (t) {
        return "<tr><td class='small'>" + esc(new Date(t.ts * 1000).toLocaleString()) + "</td><td>" + esc(t.title || t.ticker) + "</td>" +
          "<td><span class='tag'>" + esc(t.categoryLabel || "—") + "</span></td><td>" + esc(t.side) + "</td><td class='num'>" + numFmt(t.qty) + "</td>" +
          "<td class='num'>" + cents(t.price) + "</td><td>" + esc(t.bucket) + "</td><td>" + esc(t.mode) + "</td></tr>";
      }).join("") : "<tr><td colspan='8' class='muted'>No simulator trades yet.</td></tr>";
    }
    renderCategoryStats(s);
  }
  function renderCategoryStats(s) {
    var el = $("cat-stats"); if (!el) return;
    var byCat = {};
    s.trades.forEach(function (t) {
      var c = t.categoryLabel || "Unknown";
      byCat[c] = byCat[c] || { n: 0, notional: 0, buys: 0, sells: 0 };
      byCat[c].n++; byCat[c].notional += t.qty * t.price;
      if (t.side === "buy") byCat[c].buys++; else byCat[c].sells++;
    });
    var rows = Object.keys(byCat).map(function (c) {
      var v = byCat[c];
      return "<tr><td>" + esc(c) + "</td><td class='num'>" + v.n + "</td><td class='num'>" + v.buys + "</td><td class='num'>" + v.sells + "</td><td class='num'>" + money(v.notional) + "</td></tr>";
    }).join("");
    el.innerHTML = rows || "<tr><td colspan='5' class='muted'>No trades to categorize yet.</td></tr>";
  }
  function simTrade(ticker, title, categoryLabel, side, qty, price) {
    var s = sim();
    var cost = qty * price;
    if (side === "buy") {
      if (cost > s.cash) return { ok: false, msg: "Insufficient simulator cash (" + money(s.cash) + ")." };
      s.cash -= cost;
      var p = s.positions[ticker] || { qty: 0, avgPrice: 0, title: title, categoryLabel: categoryLabel };
      p.avgPrice = p.qty + p.avgPrice * p.qty === 0 ? price : (p.avgPrice * p.qty + cost) / (p.qty + qty);
      p.qty += qty; p.title = title; p.categoryLabel = categoryLabel;
      s.positions[ticker] = p;
    } else {
      var p2 = s.positions[ticker];
      if (!p2 || p2.qty < qty) return { ok: false, msg: "Not enough simulator contracts to sell." };
      s.cash += cost; p2.qty -= qty;
      if (p2.qty === 0) delete s.positions[ticker];
    }
    s.trades.push({ ts: nowSec(), ticker: ticker, title: title, categoryLabel: categoryLabel, side: side, qty: qty, price: price, bucket: priceBucket(price), mode: "simulator" });
    saveSim(s); renderSim();
    return { ok: true, msg: "Simulator " + side + " filled: " + qty + " × " + cents(price) + " (" + money(cost) + ")." };
  }

  /* ---------- demo account auth (RSA-PSS via WebCrypto; key stays in browser) ---------- */
  var AUTH_KEY = "kalshidash_demo_auth_v1";
  function loadAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } }
  function saveAuth(a) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }
  function pemToDer(pem) {
    var b64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
    var bin = atob(b64); var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function importPrivateKey(pem) {
    var der = pemToDer(pem);
    return crypto.subtle.importKey("pkcs8", der, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"])
      .catch(function () {
        /* Try Ed25519 (supported in newer browsers only). */
        return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
      });
  }
  function authFetch(path, method, body) {
    var auth = loadAuth();
    if (!auth) return Promise.reject(new Error("No demo credentials stored in this browser. Connect on the Portfolio page first."));
    var ts = String(Date.now());
    var signPath = new URL(K.BASE + path).pathname;
    var msg = new TextEncoder().encode(ts + method + signPath);
    return importPrivateKey(auth.privateKeyPem).then(function (key) {
      return crypto.subtle.sign(key.algorithm.name === "Ed25519" ? { name: "Ed25519" } : { name: "RSA-PSS", saltLength: 32 }, key, msg);
    }).then(function (sig) {
      var b64 = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(sig))));
      return K.fetchJson(path, { method: method, body: body, headers: {
        "KALSHI-ACCESS-KEY": auth.keyId, "KALSHI-ACCESS-SIGNATURE": b64, "KALSHI-ACCESS-TIMESTAMP": ts, "Content-Type": "application/json"
      } });
    });
  }
  function renderDemo() {
    var auth = loadAuth();
    var badge = $("demo-badge"); if (badge) { badge.className = "badge " + (auth ? "live" : "warn"); badge.textContent = auth ? "DEMO CONNECTED (browser-only key)" : "DEMO NOT CONNECTED"; }
    var bal = $("demo-balance");
    if (bal && auth) {
      authFetch("/portfolio/balance", "GET").then(function (d) {
        var b = d.balance !== undefined ? (d.balance > 1000 ? d.balance / 100 : d.balance) : null;
        bal.innerHTML = "Balance: <strong>" + money(b) + "</strong>" + (d.portfolio_value !== undefined ? " · Portfolio value: <strong>" + money(d.portfolio_value > 1000 ? d.portfolio_value / 100 : d.portfolio_value) + "</strong>" : "");
      }).catch(function (e) { bal.textContent = "Balance fetch failed: " + e.message; });
      authFetch("/portfolio/positions?settlement_status=all&limit=100", "GET").then(function (d) {
        var pos = d.market_positions || d.positions || [];
        var tb = $("demo-pos-body");
        if (tb) tb.innerHTML = pos.length ? pos.map(function (p) {
          return "<tr><td><code>" + esc(p.ticker || "") + "</code></td><td class='num'>" + esc(p.position !== undefined ? p.position : (p.contracts || "—")) + "</td><td>" + esc(p.settlement_status || p.status || "—") + "</td></tr>";
        }).join("") : "<tr><td colspan='3' class='muted'>No demo positions returned.</td></tr>";
      }).catch(function (e) { var tb = $("demo-pos-body"); if (tb) tb.innerHTML = "<tr><td colspan='3' class='muted'>" + esc(e.message) + "</td></tr>"; });
      authFetch("/portfolio/fills?limit=100", "GET").then(function (d) {
        var fills = d.fills || [];
        var tb = $("demo-fills-body");
        if (tb) tb.innerHTML = fills.length ? fills.slice(0, 50).map(function (f) {
          return "<tr><td class='small'>" + esc(f.created_time || f.created_ts || "—") + "</td><td><code>" + esc(f.ticker || "") + "</code></td><td class='num'>" + esc(f.count || f.quantity || "—") + "</td><td class='num'>" + esc(f.yes_price_dollars || f.price || "—") + "</td></tr>";
        }).join("") : "<tr><td colspan='4' class='muted'>No demo fills returned.</td></tr>";
      }).catch(function () { /* fills optional */ });
    } else if (bal) {
      bal.textContent = "Connect a demo account below to see live demo balance, positions and fills. Until then, the simulator above is the working portfolio.";
    }
  }

  /* ---------- events / resolution tracking ---------- */
  function renderEvents() {
    var tb = $("events-body"); if (!tb) return;
    if (!state.ranked.length && !(state.settled || []).length) {
      loadCategories().then(renderEvents).catch(function () { tb.innerHTML = "<tr><td colspan='7' class='muted'>Live events unavailable — see dashboard error handling. Nothing fabricated.</td></tr>"; });
      return;
    }
    var rows = state.ranked.slice(0, 25).map(function (r) { return { cat: r.categoryLabel, market: r.market, lastPrice: r.lastPrice, notional: r.notional, src: "tracked (open ranking)" }; });
    (state.settled || []).slice(0, 25).forEach(function (m) {
      var cat = "Other";
      for (var i = 0; i < K.CATEGORIES.length; i++) {
        var list = (state.seriesByCategory || {})[K.CATEGORIES[i].id] || [];
        if (list.some(function (s) { return s.ticker === m.series_ticker; })) { cat = K.CATEGORIES[i].label; break; }
      }
      rows.push({ cat: cat, market: m, lastPrice: K.lastPrice(m), notional: K.estNotional(m), src: "settled · " + esc(m.series_ticker || "") });
    });
    tb.innerHTML = rows.map(function (r) {
      var m = r.market;
      return "<tr><td><span class='tag'>" + esc(r.cat) + "</span></td><td>" + esc(K.displayTitle(m)) + "<br><code>" + esc(m.ticker) + "</code><br><span class='muted small'>" + r.src + "</span></td>" +
        "<td>" + esc(m.status || "—") + "</td><td><strong>" + esc(K.resolutionLabel(m)) + "</strong>" +
        (m.settlement_ts ? "<br><span class='muted small'>" + esc(m.settlement_ts) + "</span>" : "") +
        (m.settlement_value_dollars !== undefined ? "<br><span class='muted small'>settle value $" + esc(m.settlement_value_dollars) + "</span>" : "") + "</td>" +
        "<td class='num'>" + cents(r.lastPrice) + "</td>" +
        "<td class='num'>" + money(r.notional) + "</td><td class='small'>" + esc(m.close_time || "—") + "</td></tr>";
    }).join("");
    var settledCount = rows.filter(function (r) { return K.isResolved(r.market); }).length;
    var note = $("settled-note");
    if (note) note.textContent = settledCount ? settledCount + " tracked market(s) show a resolution above (YES/NO comes from the API result field — never inferred)." : "No tracked markets have settled yet in this snapshot. This page refreshes live; settled markets show YES/NO here automatically.";
  }

  /* ---------- strategy backtest (educational, runs on real candlesticks) ---------- */
  function backtest() {
    var out = $("bt-result"); if (!out || !state.selected) return;
    var strategy = $("bt-strategy") ? $("bt-strategy").value : "favorite";
    var m = state.selected.market;
    K.getCandlesticks(state.selected.seriesTicker, m.ticker, nowSec() - 7 * 86400, nowSec(), 60).then(function (candles) {
      var pts = candles.map(function (c) { return { t: c.end_period_ts, p: candleClose(c) }; }).filter(function (p) { return p.p !== null; });
      if (pts.length < 3) { out.textContent = "Not enough candlestick history to backtest this market yet."; return; }
      var trades = [], pos = 0, cash = 0;
      for (var i = 1; i < pts.length; i++) {
        var p = pts[i].p, prev = pts[i - 1].p, signal = false;
        if (strategy === "favorite") signal = p >= 0.8;
        else if (strategy === "longshot") signal = p <= 0.2;
        else if (strategy === "momentum") signal = p > prev;
        else if (strategy === "reversion") signal = p < 0.4;
        if (signal && pos === 0) { pos = 1; trades.push({ t: pts[i].t, side: "buy", p: p }); }
        else if (!signal && pos === 1 && strategy !== "favorite") { pos = 0; cash += (p - trades[trades.length - 1].p); trades.push({ t: pts[i].t, side: "sell", p: p }); }
      }
      var wins = 0; for (var j = 0; j + 1 < trades.length; j += 2) { if (trades[j + 1].p > trades[j].p) wins++; }
      var roundTrips = Math.floor(trades.length / 2);
      out.innerHTML = "Backtest on <strong>" + esc(m.ticker) + "</strong> (" + pts.length + " hourly candles, 7 days): strategy <strong>" + esc(strategy) + "</strong> → " +
        roundTrips + " round trips, " + wins + " winning, gross P&L per contract <strong>" + money(cash) + "</strong> (before fees/slippage). " +
        "This is an educational illustration on past prices, not a prediction or financial advice. Past prices do not predict future outcomes.";
    }).catch(function (e) { out.textContent = "Backtest failed: " + e.message; });
  }

  /* ---------- suggestions voting (local only) ---------- */
  function initSuggestions() {
    var KEY = "kalshidash_sug_votes", CHOSEN = "kalshidash_sug_chosen";
    function votes() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
    document.querySelectorAll("[data-sug]").forEach(function (card) {
      var id = card.getAttribute("data-sug");
      var v = votes()[id] || 0;
      var btn = card.querySelector(".vote-btn"), cnt = card.querySelector(".vote-count"), pick = card.querySelector(".pick-btn");
      if (cnt) cnt.textContent = v;
      if (btn) btn.addEventListener("click", function () { var all = votes(); all[id] = (all[id] || 0) + 1; localStorage.setItem(KEY, JSON.stringify(all)); cnt.textContent = all[id]; });
      if (pick) pick.addEventListener("click", function () {
        localStorage.setItem(CHOSEN, id);
        document.querySelectorAll(".pick-btn").forEach(function (b) { b.textContent = "Choose this path"; });
        pick.textContent = "✓ Chosen path";
        var note = $("chosen-note"); if (note) note.textContent = "Chosen path: " + id + " (saved in this browser only — no backend).";
      });
      if (localStorage.getItem(CHOSEN) === id && pick) pick.textContent = "✓ Chosen path";
    });
    var chosen = localStorage.getItem(CHOSEN);
    var note = $("chosen-note"); if (note && chosen) note.textContent = "Chosen path: " + chosen + " (saved in this browser only — no backend).";
  }

  /* ---------- wire up pages ---------- */
  var page = document.body.getAttribute("data-page");
  function exchangeBadge() {
    var el = $("exchange-status"); if (!el) return;
    K.getExchangeStatus().then(function (d) {
      var ex = d.exchange_active, tr = d.trading_active;
      el.className = "badge " + (ex && tr ? "live" : "warn");
      el.textContent = "Exchange " + (ex ? "ACTIVE" : "INACTIVE") + " · Trading " + (tr ? "OPEN" : "CLOSED") +
        (d.exchange_estimated_resume_time ? " · est. resume " + d.exchange_estimated_resume_time : "");
      el.title = "GET /exchange/status — flags are only meaningful on a 200 response (official docs).";
    }).catch(function (err) { el.className = "badge warn"; el.textContent = "Exchange status unavailable: " + err.message; });
  }

  if (page === "dashboard") {
    exchangeBadge();
    loadCategories().catch(function () { /* error already shown */ });
    var refresh = $("refresh-btn"); if (refresh) refresh.addEventListener("click", function () { loadCategories().catch(function () {}); });
    document.querySelectorAll("[data-window]").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll("[data-window]").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active"); state.windowSec = parseInt(b.getAttribute("data-window"), 10); loadChart();
      });
    });
    var ob = $("refresh-book"); if (ob) ob.addEventListener("click", loadOrderbook);
    var wsBtn = $("ws-btn");
    if (wsBtn) wsBtn.addEventListener("click", function () {
      if (state.ws) { try { state.ws.close(); } catch (e) {} state.ws = null; }
      /* Documented constraint: the Kalshi WebSocket API requires signed auth headers on the
         handshake (KALSHI-ACCESS-KEY / -SIGNATURE / -TIMESTAMP), even for public channels.
         The browser WebSocket constructor cannot set custom headers, so an unauthenticated
         browser socket is not supported. We report this instead of pretending to stream.
         Source: https://docs.kalshi.com/getting_started/quick_start_websockets */
      var el = $("ws-note");
      if (el) {
        el.style.display = "block";
        el.innerHTML = "<strong>WebSocket: not usable directly from a browser.</strong> Kalshi's docs state the WebSocket connection &ldquo;requires authentication during the connection handshake&rdquo; with signed headers, and that public market-data channels &ldquo;still use the authenticated WebSocket session&rdquo;. Browsers cannot set custom WebSocket headers, so this site streams nothing over WS and instead polls the public REST endpoints (5s for the selected market, ~15s for rankings). A server-side WS bridge is proposed as <a href='suggestions.html'>SUG-02</a>. Source: <a href='https://docs.kalshi.com/getting_started/quick_start_websockets' target='_blank' rel='noopener'>WebSocket quick start</a>.";
      }
      wsBtn.textContent = "See note below";
    });
  }
  function loadSettled() {
    var set = {};
    K.CATEGORIES.forEach(function (c) { ((state.seriesByCategory || {})[c.id] || []).forEach(function (s) { set[s.ticker] = true; }); });
    return K.recentSettled(set, 30 * 86400, 3).then(function (m) { state.settled = m || []; return m; });
  }
  if (page === "events") {
    var evReload = function () { loadCategories().then(loadSettled).then(renderEvents).catch(function () { renderEvents(); }); };
    evReload();
    var r2 = $("refresh-events"); if (r2) r2.addEventListener("click", evReload);
    setInterval(evReload, 30000);
  }
  if (page === "portfolio" || page === "trade" || page === "strategies") { renderSim(); renderDemo(); }
  if (page === "strategies") {
    loadCategories().then(function () { var b = $("bt-run"); if (b) b.addEventListener("click", backtest); }).catch(function () {});
    var b2 = $("bt-run"); if (b2) b2.addEventListener("click", backtest);
  }
  if (page === "suggestions") initSuggestions();

  /* demo connect form (portfolio + trade pages share ids pattern) */
  document.querySelectorAll(".demo-connect-form").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var keyId = form.querySelector("[name=keyId]").value.trim();
      var pem = form.querySelector("[name=privateKey]").value.trim();
      var msg = form.querySelector(".form-msg");
      if (!keyId || !pem) { if (msg) msg.textContent = "Both API Key ID and private key (.key PEM) are required."; return; }
      saveAuth({ keyId: keyId, privateKeyPem: pem });
      if (msg) msg.textContent = "Saved in this browser only (localStorage). It is sent only to the Kalshi demo API when you fetch portfolio data. Use Disconnect to erase it.";
      renderDemo();
    });
  });
  document.querySelectorAll(".demo-disconnect").forEach(function (b) {
    b.addEventListener("click", function () { localStorage.removeItem(AUTH_KEY); renderDemo(); });
  });

  /* trade form */
  var tradeForm = $("trade-form");
  if (tradeForm) {
    tradeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var ticker = tradeForm.querySelector("[name=ticker]").value.trim();
      var side = tradeForm.querySelector("[name=side]").value;
      var qty = parseInt(tradeForm.querySelector("[name=qty]").value, 10);
      var mode = tradeForm.querySelector("[name=mode]").value;
      var out = $("trade-result");
      if (!ticker || !qty || qty <= 0) { out.textContent = "Enter a ticker and a positive quantity."; return; }
      if (mode === "simulator") {
        K.getMarket(ticker).then(function (m) {
          var p = K.lastPrice(m);
          if (p === null) { out.textContent = "No live price for " + ticker + " — simulator trade not placed (no invented price)."; return; }
          var catLabel = "Unknown";
          if (state.seriesByCategory) { for (var i = 0; i < K.CATEGORIES.length; i++) { var list = state.seriesByCategory[K.CATEGORIES[i].id] || []; if (list.some(function (s) { return s.ticker === m.series_ticker; })) catLabel = K.CATEGORIES[i].label; } }
          var r = simTrade(ticker, m.title || ticker, catLabel, side, qty, p);
          out.textContent = r.msg;
        }).catch(function (err) { out.textContent = "Simulator trade failed: " + err.message; });
      } else {
        var price = parseFloat(tradeForm.querySelector("[name=price]").value);
        if (!price || price <= 0 || price >= 1) { out.textContent = "Demo limit orders need a price between $0.01 and $0.99."; return; }
        /* Create Order (V2) request shape — required fields: ticker, side (bid|ask), count (fp string),
           price (fixed-point dollars), time_in_force, self_trade_prevention_type.
           BookSide docs: "bid means buy YES, ask means sell YES" — everything is quoted from the YES leg.
           Source: https://docs.kalshi.com/api-reference/orders/create-order-v2 */
        var cid = "kd-" + Date.now() + "-" + Math.floor(Math.random() * 1e6); /* <=64 chars, charset [A-Za-z0-9_:-+=/] */
        var body = { ticker: ticker, side: side === "buy" ? "bid" : "ask", count: qty.toFixed(2), price: price.toFixed(4),
          time_in_force: "good_till_canceled", self_trade_prevention_type: "taker_at_cross", client_order_id: cid };
        out.textContent = "Submitting demo order " + cid + " …";
        authFetch("/portfolio/events/orders", "POST", body).then(function (d) {
          /* A 201 means the order was accepted, not that it is resting — check remaining_count. */
          out.innerHTML = "Demo order accepted (201). Order ID: <code>" + esc(d.order_id || "—") + "</code> · filled <strong>" + esc(d.fill_count !== undefined ? d.fill_count : "—") +
            "</strong> · remaining <strong>" + esc(d.remaining_count !== undefined ? d.remaining_count : "—") + "</strong>" +
            (d.average_fill_price !== undefined ? " · avg fill price $" + esc(d.average_fill_price) : "") +
            (d.average_fee_paid !== undefined ? " · avg fee/contract $" + esc(d.average_fee_paid) : "") +
            "<br><span class='muted small'>Check the Positions/Fills tables below for updates; order reads can lag the matching engine briefly.</span>";
        }).catch(function (err) {
          var code = err && err.data && (err.data.code || (err.data.error && err.data.error.code)) ? (err.data.code || err.data.error.code) : "";
          out.innerHTML = "Demo order failed" + (err && err.status ? " (HTTP " + err.status + ")" : "") + (code ? " — <code>" + esc(code) + "</code>" : "") + ": " + esc(err && err.message ? err.message : err) +
            "<br><span class='muted small'>Error code reference: <a href='https://docs.kalshi.com/getting_started/order_errors' target='_blank' rel='noopener'>Order Errors</a>.</span>";
        });
      }
    });
    /* fill ticker from dashboard selection if present */
    var sel = sessionStorage.getItem("kalshidash_selected_ticker");
    if (sel) tradeForm.querySelector("[name=ticker]").value = sel;
  }
  /* remember selected ticker for trade page */
  document.addEventListener("click", function (e) {
    var tr = e.target.closest && e.target.closest("tr[data-ticker]");
    if (tr) sessionStorage.setItem("kalshidash_selected_ticker", tr.getAttribute("data-ticker"));
  });

  /* simulator reset */
  var reset = $("sim-reset");
  if (reset) reset.addEventListener("click", function () { localStorage.removeItem(SIM_KEY); renderSim(); });
})();
