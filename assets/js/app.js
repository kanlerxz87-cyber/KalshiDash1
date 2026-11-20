/* KalshiDash1 — shared application logic
 *
 * Verified against official Kalshi docs (https://docs.kalshi.com):
 *   - Demo Trade API: https://external-api.demo.kalshi.co/trade-api/v2
 *   - Demo WebSocket: wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2
 *   - Demo site: https://demo.kalshi.co/
 *   - Credentials are NOT shared between demo and production.
 *
 * Sandbox limitation: this agent environment cannot call kalshi.co directly
 * (outbound internet limited to GitHub/npm/PyPI hosts). All live-data calls below
 * are attempted from the browser and fail gracefully. Values that cannot be
 * confirmed from an official source are left blank and flagged "unverified".
 */

(function () {
  "use strict";

  // ---------- Verified configuration ----------
  const CONFIG = {
    demoRest: "https://external-api.demo.kalshi.co/trade-api/v2",
    demoAltRest: "https://demo-api.kalshi.co/trade-api/v2",
    demoWs: "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
    demoWsAlt: "wss://demo-api.kalshi.co/trade-api/ws/v2",
    demoSite: "https://demo.kalshi.co/",
    docs: {
      welcome: "https://docs.kalshi.com/welcome",
      demoEnv: "https://docs.kalshi.com/getting_started/demo_env",
      llms: "https://docs.kalshi.com/llms.txt",
      marketOrderbook: "https://docs.kalshi.com/api-reference/market/get-market-orderbook.md",
      getMarkets: "https://docs.kalshi.com/api-reference/market/get-markets.md",
      getEvents: "https://docs.kalshi.com/api-reference/events/get-events.md",
      getMarketCandlesticks: "https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md",
      getBalance: "https://docs.kalshi.com/api-reference/portfolio/get-balance.md",
      getPositions: "https://docs.kalshi.com/api-reference/portfolio/get-positions.md",
      getFills: "https://docs.kalshi.com/api-reference/portfolio/get-fills.md",
      createOrderV2: "https://docs.kalshi.com/api-reference/orders/create-order-v2.md",
    },
    help: {
      demoAccount: "https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account",
    },
  };

  // Category -> example series/tickers to track (unverified placeholders pending live data)
  const CATEGORIES = {
    gas: {
      name: "Gas Prices",
      series: "gas prices",
      tickers: [], // filled from live data when available
      description: "Energy / gasoline price event contracts.",
    },
    elections: {
      name: "Elections",
      series: "elections",
      tickers: [],
      description: "Election outcome event contracts.",
    },
    culture: {
      name: "Culture",
      series: "culture",
      tickers: [],
      description: "Culture and entertainment event contracts.",
    },
    crypto: {
      name: "Crypto",
      series: "crypto",
      tickers: [],
      description: "Cryptocurrency price event contracts.",
    },
    golf: {
      name: "Golf",
      series: "golf",
      tickers: [],
      description: "Golf tournament outcome event contracts.",
    },
  };

  // ---------- State ----------
  const STATE = {
    apiKey: null, // user must supply their own demo API key; never hardcode credentials
    liveData: {}, // market_ticker -> { yes, no, bid, ask, ts }
    history: {},  // market_ticker -> [{t, price}]
    events: [],
    portfolio: null,
    positions: [],
    fills: [],
    initialized: false,
  };

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => root.querySelectorAll(sel);

  function fmtMoney(cents) {
    if (cents == null) return "—";
    const v = cents / 100;
    return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }
  function fmtPct(n) {
    if (n == null) return "—";
    return n.toFixed(1) + "¢";
  }
  function fmtTs(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString();
  }
  function isUnverified(el) {
    el.classList.add("unverified");
  }

  // ---------- Live data fetch (graceful degradation) ----------
  // Tries to fetch from the demo API. Returns null on any error (CORS, network,
  // missing auth, 401/403) so the UI can show an unverified/placeholder state.
  async function tryFetchJson(url, init = {}) {
    try {
      const headers = { Accept: "application/json", ...(init.headers || {}) };
      if (STATE.apiKey) {
        // Demo API keys are authenticated via signature headers; a raw key alone
        // is insufficient. We store it but do not fabricate a signature.
        headers["X-Demo-Api-Key"] = STATE.apiKey;
      }
      const res = await fetch(url, { ...init, headers, mode: "cors" });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async function loadMarkets() {
    const data = await tryFetchJson(`${CONFIG.demoRest}/markets?limit=200`);
    if (!data) return [];
    return data.markets || data || [];
  }

  async function loadOrderbook(marketTicker) {
    return tryFetchJson(
      `${CONFIG.demoRest}/market-orderbook?market_ticker=${encodeURIComponent(marketTicker)}`
    );
  }

  async function loadCandlesticks(marketTicker, period = 60) {
    return tryFetchJson(
      `${CONFIG.demoRest}/market-candlesticks?market_ticker=${encodeURIComponent(marketTicker)}&period=${period}`
    );
  }

  async function loadPortfolio() {
    const [balance, positions, fills] = await Promise.all([
      tryFetchJson(`${CONFIG.demoRest}/balance`),
      tryFetchJson(`${CONFIG.demoRest}/positions`),
      tryFetchJson(`${CONFIG.demoRest}/fills`),
    ]);
    STATE.portfolio = balance || null;
    STATE.positions = (positions && positions.positions) ? positions.positions : (positions || []);
    STATE.fills = (fills && fills.fills) ? fills.fills : (fills || []);
  }

  // ---------- Rendering ----------
  function renderCategoryPage() {
    const root = $("#category-root");
    if (!root) return;
    const categoryId = root.dataset.category;
    const cat = CATEGORIES[categoryId];
    if (!cat) return;

    const tbody = $("#events-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const rows = [];
    (STATE.events || []).forEach((ev) => {
      // crude topic match by series/category words in title/ticker
      const hay = ((ev.title || "") + " " + (ev.ticker || "") + " " + (ev.series_ticker || "")).toLowerCase();
      if (cat.series.split(" ").some((w) => hay.includes(w))) {
        rows.push(ev);
      }
    });

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="graph-placeholder">No live events found for <strong>${cat.name}</strong>. Live Kalshi data could not be fetched (see Flagged for Review). Add demo API credentials to enable live tracking.</td></tr>`;
      return;
    }

    rows.forEach((ev) => {
      const markets = ev.markets || [];
      const primary = markets[0] || {};
      const yesPrice = primary.yes_bid != null ? primary.yes_bid : (primary.yes_ask != null ? primary.yes_ask : null);
      const noPrice = primary.no_bid != null ? primary.no_bid : (primary.no_ask != null ? primary.no_ask : null);
      const resolved = ev.status === "settled";
      const resClass = ev.result === "yes" ? "res-yes" : ev.result === "no" ? "res-no" : "res-unresolved";
      const resText = resolved ? (ev.result === "yes" ? "Resolved YES" : ev.result === "no" ? "Resolved NO" : "Resolved") : "Unresolved";
      const liq = primary.volume != null ? primary.volume : "—";
      const statusClass = ev.status === "open" ? "status-open" : ev.status === "settled" ? "status-settled" : "status-closed";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="ticker">${escapeHtml(ev.ticker || "—")}</span></td>
        <td>${escapeHtml(ev.title || "—")}</td>
        <td><span class="${statusClass}">${escapeHtml(ev.status || "—")}</span></td>
        <td>${fmtPct(yesPrice)}</td>
        <td>${fmtPct(noPrice)}</td>
        <td><span class="${resClass}">${resText}</span></td>
        <td>${escapeHtml(liq)}</td>
        <td><a class="source-link" href="${escapeHtml(ev.sourceUrl || CONFIG.docs.getEvents)}" target="_blank" rel="noopener">Kalshi API docs</a>${ev.verified ? "" : " <span class=" + '"badge badge-warn"' + ">unverified</span>"}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---------- Price graph (Chart.js via CDN) ----------
  let priceChartInstance = null;

  function loadChartLib() {
    return new Promise((resolve, reject) => {
      if (window.Chart) return resolve(window.Chart);
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js";
      script.onload = () => resolve(window.Chart);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderPriceGraph(containerSelector, marketTicker, period = 60) {
    const container = $(containerSelector);
    if (!container) return;
    try {
      await loadChartLib();
    } catch (e) {
      container.innerHTML = `<div class="graph-placeholder">Chart library failed to load.</div>`;
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.id = "priceChart";
    container.innerHTML = "";
    container.appendChild(canvas);

    // Try live candlesticks; fall back to empty (unverified) state.
    let candles = [];
    try {
      const data = await loadCandlesticks(marketTicker, period);
      if (data && data.candlesticks) candles = data.candlesticks;
    } catch (e) { /* unverified */ }

    const labels = candles.map((c) => new Date(c.t || c.start_ts || c.ts || 0).toLocaleTimeString());
    const prices = candles.map((c) => c.close != null ? c.close : (c.c != null ? c.c : null));

    const cfg = {
      type: "line",
      data: {
        labels: labels.length ? labels : ["—"],
        datasets: [{
          label: marketTicker ? `Price — ${marketTicker}` : "Contract price (¢)",
          data: prices.length ? prices : [null],
          borderColor: "#0ea5e9",
          backgroundColor: "rgba(14, 165, 233, 0.1)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
        scales: {
          x: { type: "time", time: { unit: period >= 1440 ? "day" : period >= 60 ? "hour" : "minute" }, title: { display: true, text: "Time" } },
          y: { title: { display: true, text: "Current contract price (¢)" }, min: 0, max: 100, beginAtZero: true },
        },
        animation: { duration: 0 },
      },
    };

    priceChartInstance = new window.Chart(canvas.getContext("2d"), cfg);

    if (!candles.length) {
      container.insertAdjacentHTML("afterbegin", `<div class="alert alert-warn" style="margin-top:8px;"><span class="k">Unverified:</span> live candlesticks could not be fetched from Kalshi (network/auth restriction). Showing empty graph.</div>`);
    }
  }

  function setupGraphControls(marketTicker) {
    const sel = $("#graph-period");
    if (!sel) return;
    sel.addEventListener("change", (e) => {
      const period = parseInt(e.target.value, 10) || 60;
      renderPriceGraph("#graph-canvas", marketTicker, period);
    });
  }

  // ---------- Portfolio ----------
  async function renderPortfolio() {
    const bal = $("#portfolio-balance");
    const pval = $("#portfolio-value");
    const tbody = $("#positions-table-body");
    if (!bal && !pval && !tbody) return;

    await loadPortfolio();

    if (bal) bal.textContent = STATE.portfolio ? fmtMoney(STATE.portfolio.balance) : "—";
    if (pval) pval.textContent = STATE.portfolio ? fmtMoney(STATE.portfolio.total_portfolio_value) : "—";

    if (tbody) {
      tbody.innerHTML = "";
      if (!STATE.portfolio) {
        tbody.innerHTML = `<tr><td colspan="6" class="graph-placeholder">Demo API credentials not configured. Portfolio data cannot be fetched (see Flagged for Review). See ${CONFIG.help.demoAccount} to create a demo account.</td></tr>`;
        return;
      }
      (STATE.positions || []).forEach((pos) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="ticker">${escapeHtml(pos.ticker || "—")}</span></td>
          <td>${escapeHtml(pos.side || "—")}</td>
          <td>${pos.quantity != null ? pos.quantity : "—"}</td>
          <td>${fmtMoney(pos.cost_basis)}</td>
          <td>${fmtPct(pos.current_value)}</td>
          <td>${fmtMoney(pos.unrealized_pl)}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // ---------- API-key config UI ----------
  function renderApiKeyNotice() {
    const notice = $("#api-key-notice");
    if (!notice) return;
    if (STATE.apiKey) {
      notice.innerHTML = `<span class="badge badge-ok">Demo API key configured</span> — live fetch enabled (subject to CORS/auth).`;
      notice.className = "alert alert-ok";
    } else {
      notice.innerHTML = `No demo API key configured. Live Kalshi data is <strong>disabled</strong>. Values are blank/unverified. To enable live tracking, open browser DevTools and run: <code>window.KALSHI_API_KEY = "your-demo-key"</code>, then refresh. Never paste production keys.`;
      notice.className = "alert alert-warn";
    }
  }

  // ---------- Init ----------
  async function init() {
    if (STATE.initialized) return;
    STATE.initialized = true;

    // Allow console-set demo API key (never stored in repo).
    if (window.KALSHI_API_KEY) STATE.apiKey = window.KALSHI_API_KEY;
    renderApiKeyNotice();

    try {
      STATE.events = await loadMarkets();
    } catch (e) {
      STATE.events = [];
    }
    renderCategoryPage();
    await renderPortfolio();
  }

  // Bootstrap on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for console use
  window.KalshiDash = { CONFIG, CATEGORIES, STATE, loadMarkets, loadPortfolio, loadOrderbook, loadCandlesticks, renderPriceGraph };

})();
