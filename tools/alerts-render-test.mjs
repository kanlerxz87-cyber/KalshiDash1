// KalshiDash1 — headless render + behavior test for dash/alerts.html (session arena-f89b55f7).
// Loads the real page in jsdom with the real script set (config → kalshi → data → store →
// model → app-common → alerts), mocks the demo-API transport with responses shaped exactly
// like the documented/live-verified payloads, and drives two poll cycles:
//   poll 1: crypto market observed at $0.44 (baseline)
//   poll 2: observed at $0.55  → +$0.11 swing ⇒ alert + momentum-10c SIM entry
//   poll 3: observed at $0.66  → take-profit ≥ $0.10 ⇒ SIM exit, trade settled
//   node tools/alerts-render-test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsdomPkg from "jsdom";
const { JSDOM, VirtualConsole, ResourceLoader } = jsdomPkg;

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const pagePath = path.join(repo, "dash", "alerts.html");

/* serves http://localhost/dash/* scripts/stylesheets from the repo (no real HTTP server) */
class FileLoader extends ResourceLoader {
  fetch(urlString, options) {
    const u = new URL(urlString);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      const rel = u.pathname.replace(/^\/+/, ""); /* dash/js/config.js … */
      const filePath = path.join(repo, rel);
      try { return Promise.resolve(fs.readFileSync(filePath)); }
      catch (e) { return Promise.reject(new Error("FileLoader miss: " + rel)); }
    }
    return null; /* external resources never loaded */
  }
}

/* ---------- fixtures (shapes verified live 2026-11-20; see dash/sources.html S-A2/S-A3) ---------- */
const MKT = (ticker, series, title, vol24, bid, ask, extra = {}) => ({
  ticker, event_ticker: ticker.split("-").slice(0, 2).join("-"), series_ticker: series,
  title, market_type: "binary", status: "active", result: "",
  last_price_dollars: ask, previous_price_dollars: ask,
  yes_bid_dollars: bid, yes_ask_dollars: ask,
  no_bid_dollars: (1 - parseFloat(ask)).toFixed(4), no_ask_dollars: (1 - parseFloat(bid)).toFixed(4),
  yes_bid_size_fp: "12.00", yes_ask_size_fp: "16.00",
  volume_fp: (parseFloat(vol24) * 3).toFixed(2), volume_24h_fp: vol24, open_interest_fp: "735.00",
  notional_value_dollars: "1.0000", close_time: "2027-01-01T04:59:00Z",
  expected_expiration_time: "2026-12-01T15:00:00Z",
  rules_primary: "Fixture rule text (test only).", ...extra
});
const SERIES = [
  { ticker: "KXAAAGASDSD", title: "South Dakota gas price (daily)", category: "Economics", tags: ["Oil and energy"], volume_fp: "128.00", settlement_sources: [{ name: "AAA", url: "https://gasprices.aaa.com/?state=SD" }] },
  { ticker: "KXELECTIONEMERGENCY", title: "Will Trump declare an election emergency?", category: "Elections", tags: ["Trump"], volume_fp: "7517.00", settlement_sources: [{ name: "the White House", url: "https://www.whitehouse.gov" }] },
  { ticker: "KXXBANNEDGROK", title: "Will Grok be banned this year", category: "Culture", tags: [], volume_fp: "500.00", settlement_sources: [{ name: "xAI", url: "https://x.ai" }] },
  { ticker: "KXDEMOFUTHOURLY", title: "Demo BTC at or above 61985.83 USD (hourly)", category: "Crypto", tags: [], volume_fp: "3600.00", settlement_sources: [{ name: "CF Benchmarks", url: "https://www.cfbenchmarks.com" }] },
  { ticker: "KXPGAR1T5", title: "PGA round-1 top-5 finish", category: "Sports", tags: ["Golf"], volume_fp: "219.00", settlement_sources: [{ name: "PGA Tour", url: "https://www.pgatour.com" }] }
];
const MARKETS = {
  KXAAAGASDSD: [MKT("KXAAAGASDSD-26NOV29-3.7400", "KXAAAGASDSD", "Will average gas prices be above $3.7400?", "300.00", "0.3200", "0.3300")],
  KXELECTIONEMERGENCY: [MKT("KXELECTIONEMERGENCY-27JAN01", "KXELECTIONEMERGENCY", "Will Trump issue an executive action on the 2026 midterms?", "500.00", "0.0600", "0.0700")],
  KXXBANNEDGROK: [MKT("KXXBANNEDGROK-26", "KXXBANNEDGROK", "Will Grok be banned this year", "100.00", "0.6900", "0.7000")],
  KXDEMOFUTHOURLY: [MKT("KXDEMOFUTHOURLY-26NOV20H13-UP", "KXDEMOFUTHOURLY", "Demo BTC at or above 61985.83 USD", "2400.00", "0.4300", "0.4400")],
  KXPGAR1T5: [MKT("KXPGAR1T5-25NOV16-T5", "KXPGAR1T5", "PGA round-1 top-5 finish", "150.00", "0.1900", "0.2000")]
};
const SERIES_BY_CATEGORY = {
  "Economics|Oil and energy": ["KXAAAGASDSD"],
  "Economics|": ["KXAAAGASDSD"],
  "Elections|": ["KXELECTIONEMERGENCY"],
  "Culture|": ["KXXBANNEDGROK"],
  "Crypto|": ["KXDEMOFUTHOURLY"],
  "Sports|Golf": ["KXPGAR1T5"]
};

/* price map mutated between polls by the test. NOTE: the mock ties the executable ask to
 * the observed price (realistic for a thin book right after a trade), so the SIM entry
 * correctly pays the post-jump ask — the engine has no look-ahead to the pre-jump quote. */
const PRICE = { "KXDEMOFUTHOURLY-26NOV20H13-UP": "0.4400" };
const BOOK = { yes_dollars: [["0.4200", "10.00"], ["0.4300", "20.00"]], no_dollars: [["0.5500", "15.00"], ["0.5600", "12.00"]] };

function json(data) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}
function marketWithLivePrice(m) {
  if (PRICE[m.ticker]) {
    const p = PRICE[m.ticker];
    return { ...m, last_price_dollars: p, previous_price_dollars: m.last_price_dollars,
      yes_ask_dollars: p, no_bid_dollars: (1 - parseFloat(p)).toFixed(4) };
  }
  return m;
}
let pollQueries = 0;

function makeFetch(url) {
  const u = new URL(url, "http://localhost/dash/");
  const p = u.pathname, q = u.searchParams;
  if (p.endsWith("/data/snapshot.json")) return json({ meta: {}, topics: {} });
  if (p.endsWith("/v2/series") && !/candlesticks/.test(p)) {
    const cat = q.get("category") || "", tags = q.get("tags") || "";
    const tickers = SERIES_BY_CATEGORY[cat + "|" + tags] || [];
    return json({ series: SERIES.filter(s => tickers.includes(s.ticker)), cursor: "" });
  }
  if (p.endsWith("/v2/markets") && q.get("tickers")) {
    pollQueries++;
    const wanted = q.get("tickers").split(",");
    const rows = [];
    wanted.forEach(t => {
      for (const s of Object.keys(MARKETS)) {
        MARKETS[s].forEach(m => { if (m.ticker === t) rows.push(marketWithLivePrice(m)); });
      }
    });
    return json({ markets: rows, cursor: "" });
  }
  if (p.endsWith("/v2/markets") && q.get("series_ticker")) {
    return json({ markets: (MARKETS[q.get("series_ticker")] || []).map(marketWithLivePrice), cursor: "" });
  }
  const ob = /\/v2\/markets\/([^/]+)\/orderbook$/.exec(p);
  if (ob) return json({ orderbook_fp: BOOK });
  const cs = /\/v2\/series\/([^/]+)\/markets\/([^/]+)\/candlesticks$/.exec(p);
  if (cs) return json({ candlesticks: [] });
  const mk = /\/v2\/markets\/([^/]+)$/.exec(p);
  if (mk) {
    for (const s of Object.keys(MARKETS)) {
      const found = MARKETS[s].find(m => m.ticker === mk[1]);
      if (found) return json({ market: marketWithLivePrice(found) });
    }
    return json({ market: null });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

/* ---------- jsdom boot ---------- */
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => errors.push("jsdomError: " + e.message));
vc.on("error", e => errors.push("console.error: " + e));

const html = fs.readFileSync(pagePath, "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost/dash/alerts.html",
  runScripts: "dangerously",
  resources: new FileLoader(),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = url => makeFetch(String(url));
    /* jsdom has no canvas backend — stub a permissive 2D context so chart drawing is a no-op */
    const noop = () => {};
    window.HTMLCanvasElement.prototype.getContext = function () {
      const target = {};
      return new Proxy(target, {
        get: (t, prop) => {
          if (prop === "measureText") return () => ({ width: 10 });
          if (typeof prop === "string") return noop;
          return undefined;
        },
        set: () => true
      });
    };
  }
});

const { window } = dom;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failed++; console.log("FAIL  " + name + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
}

await sleep(400); /* let buildTrackSet + first poll + selectAlert settle */

const page = window.AlertsPage;
const Store = window.Store;
check("page booted (test hook present)", !!page, Object.keys(window).filter(k => /Alerts/.test(k)));
check("no script errors on load", errors.length === 0, errors);

check("watch set built from 5 focus topics", page.state.tracked.length === 5, page.state.tracked.map(m => m.ticker));
check("highest-dollar market tracked first (crypto 24h $2400)", page.state.tracked[0] && page.state.tracked[0].ticker === "KXDEMOFUTHOURLY-26NOV20H13-UP", page.state.tracked.map(m => m.ticker + ":" + m.volume_24h_fp));
check("poll list built", page.state.pollList.length === 5, page.state.pollList);

check("first poll is a baseline (no alerts yet)", page.state.alerts.length === 0, page.state.alerts);
check("model table rendered 5 rows", window.document.querySelectorAll("#model-table tbody tr").length === 5, window.document.querySelectorAll("#model-table tbody tr").length);
check("detail auto-selected (ladder rendered: 4 price levels)",
  window.document.querySelectorAll("#ladder tbody tr").length === 4,
  window.document.querySelectorAll("#ladder tbody tr").length);
check("cause panel shows official settlement sources at boot", /Official settlement sources/.test(window.document.getElementById("cause").textContent),
  window.document.getElementById("cause").textContent.slice(0, 120));

/* poll 2: crypto jumps 0.44 → 0.55 (+$0.11 ≥ $0.10) */
PRICE["KXDEMOFUTHOURLY-26NOV20H13-UP"] = "0.5500";
page.poll();
await sleep(300);

check("swing alert created (Δ +0.12→0.11 rounding: from 0.44 to 0.55)", page.state.alerts.length === 1 &&
  Math.abs(page.state.alerts[0].delta - 0.11) < 1e-9 && page.state.alerts[0].dir === "up", page.state.alerts);
check("alert carries per-row source URL (batched tickers query)", /tickers=/.test(page.state.alerts[0].source_url || ""));
check("chat 1 (all markets) has the alert row", window.document.querySelectorAll("#chat-all .chat-row").length >= 1);
check("chat 2 (model picks) has liked-alert + SIM entry", window.document.querySelectorAll("#chat-model .chat-row").length >= 2,
  window.document.querySelectorAll("#chat-model .chat-row").length);
check("cause panel now shows the labeled auto-generated news pointer (F-10) + rules link",
  /Google News/.test(window.document.getElementById("cause").textContent) &&
  /not an official source/.test(window.document.getElementById("cause").textContent) &&
  /market detail/.test(window.document.getElementById("cause").textContent),
  window.document.getElementById("cause").textContent.slice(0, 200));
const autoTrades = Store.getTrades().filter(t => !t.seed && t.strategy === "momentum-10c");
check("momentum-10c SIM entry recorded at the executable post-jump ask ($0.55, qty 9 — no look-ahead)", autoTrades.length === 1 &&
  Math.abs(parseFloat(autoTrades[0].price) - 0.55) < 1e-9 && autoTrades[0].qty === 9, autoTrades[0]);
check("dedup: an immediate identical re-poll adds no duplicate alert", (() => {
  page.poll();
  return page.state.alerts.length === 1;
})());
await sleep(150);

/* poll 3: 0.55 → 0.66 (+$0.11 from entry price 0.44 → +$0.22 ≥ take-profit $0.10) */
PRICE["KXDEMOFUTHOURLY-26NOV20H13-UP"] = "0.6600";
page.poll();
await sleep(300);

const settled = Store.getTrades().filter(t => !t.seed && t.strategy === "momentum-10c")[0];
check("take-profit exit settled the SIM trade", settled && settled.status === "settled" &&
  Math.abs(parseFloat(settled.exit_price) - 0.66) < 1e-9, settled);
check("P&L computed (0.66 − 0.55) × 9 = $0.99", settled && Math.abs(settled.pnl - 0.99) < 1e-9, settled && settled.pnl);
check("SIM exit row appended to chat 2", /SIM ■/.test(window.document.getElementById("chat-model").textContent));
check("exit_reason recorded", settled && /take-profit/.test(settled.exit_reason || ""), settled && settled.exit_reason);

/* persistence: feeds survive a "reload" of the store */
const storedAlerts = JSON.parse(window.localStorage.getItem("kalshidash:v1:alertfeed") || "[]");
check("alerts persisted to localStorage", storedAlerts.length >= 1, storedAlerts.length);

check("no script errors after all polls", errors.length === 0, errors);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll render/behavior checks passed.");
process.exit(failed ? 1 : 0);
