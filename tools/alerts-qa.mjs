// KalshiDash1 — logic test for the alert engine + ROI model (session arena-f89b55f7).
// Runs the real merged dash/js/alerts.js in Node (with the same stub pattern as
// tools/qa_alert_test.mjs) and asserts the pure decision core (window.AlertsEngineCore)
// the Live Alerts page depends on, against values verified from docs.kalshi.com and live
// demo-API probes (see dash/sources.html rows S-A1…S-A4).
//
//   node tools/alerts-qa.mjs
//
// Key verified facts used in fixtures:
//   - prices are dollars 0..1, tick $0.01 (price_ranges step "0.0100", linear_cent)
//   - NO contract value = 1 − YES price (yes_ask $0.0700 ↔ no_bid $0.9300, live probe)
//   - swing threshold $0.10 in either direction comes from the project brief
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

/* ---- minimal browser stubs (alerts.js skips page boot: App is undefined here) ---- */
const store = {};
const elStub = () => ({ innerHTML: "", textContent: "", style: {}, children: [],
  appendChild() {}, addEventListener() {}, querySelector() { return null; },
  querySelectorAll() { return []; } });
globalThis.document = {
  hidden: true, readyState: "loading", addEventListener() {},
  getElementById: () => elStub(), querySelector: () => elStub(),
  querySelectorAll: () => [], createElement: () => elStub(), body: elStub()
};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.window = globalThis;
globalThis.fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });

for (const f of ["dash/js/config.js", "dash/js/kalshi.js", "dash/js/data.js", "dash/js/store.js", "dash/js/alerts.js"]) {
  eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
}
const E = globalThis.AlertsEngineCore;

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failed++; console.log("FAIL  " + name + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
}
const N = 1764672000000; // fixed "now" (2026-12-02T00:00:00Z, after all real demo expiries used in fixtures)

/* ---------- detectSwing ---------- */
const cfg = E.DEFAULTS;
let s = E.detectSwing({ price: 0.43, tsMs: N - 15000 }, { price: 0.55, tsMs: N }, cfg, N);
check("up swing ≥ $0.10 detected (0.43 → 0.55)", !!s && s.dir === "up" && Math.abs(s.delta - 0.12) < 1e-9, s);
s = E.detectSwing({ price: 0.61, tsMs: N - 15000 }, { price: 0.50, tsMs: N }, cfg, N);
check("down swing ≥ $0.10 detected (0.61 → 0.50)", !!s && s.dir === "down" && Math.abs(s.delta + 0.11) < 1e-9, s);
s = E.detectSwing({ price: 0.43, tsMs: N - 15000 }, { price: 0.52, tsMs: N }, cfg, N);
check("exactly $0.09 move does NOT alert", s === null, s);
s = E.detectSwing({ price: 0.43, tsMs: N - 15000 }, { price: 0.53, tsMs: N }, cfg, N);
check("exactly $0.10 move alerts (≥ threshold)", !!s && s.dir === "up", s);
s = E.detectSwing({ price: 0.43, tsMs: N - 16 * 60 * 1000 }, { price: 0.60, tsMs: N }, cfg, N);
check("stale baseline (>15 min gap) does NOT alert", s === null, s);
s = E.detectSwing({ price: "", tsMs: N - 15000 }, { price: 0.60, tsMs: N }, cfg, N);
check("unparseable previous price does NOT alert (no invented prices)", s === null, s);
s = E.detectSwing({ price: "0.5600", tsMs: N - 15000 }, { price: "0.6600", tsMs: N }, cfg, N);
check("dollar-string prices (fixed-point) parse and alert", !!s && Math.abs(s.delta - 0.1) < 1e-9, s);

/* ---------- shouldAlert (dedup) ---------- */
check("same-direction alert within 60s suppressed", E.shouldAlert({ dir: "up", tsMs: N - 30000 }, "up", cfg, N) === false);
check("same-direction alert after 60s allowed", E.shouldAlert({ dir: "up", tsMs: N - 61000 }, "up", cfg, N) === true);
check("opposite-direction alert always allowed", E.shouldAlert({ dir: "up", tsMs: N - 5000 }, "down", cfg, N) === true);

/* ---------- scoreMarket (weights 35/20/25/20, like = ≥70) ---------- */
const liquid = {
  ticker: "KXDEMOFUTHOURLY-26NOV20H12-UP", status: "active", result: "",
  volume_24h_fp: "2400.00", volume_fp: "9000.00",
  yes_bid_dollars: "0.5200", yes_ask_dollars: "0.5300", last_price_dollars: "0.5300",
  open_interest_fp: "735.00"
};
const sc = E.scoreMarket(liquid, { recentDelta: 0.12 }, cfg);
check("liquid/tight/mid-band/momentum market scores ≥ 70", sc.score >= 70, sc);
check("components are 0..1", Object.values(sc.parts).every(v => v >= 0 && v <= 1), sc.parts);
const illiquid = {
  ticker: "KXSMALL-26", status: "active", result: "",
  volume_24h_fp: "2.00", volume_fp: "9.00",
  yes_bid_dollars: "0.0100", yes_ask_dollars: "0.1400", last_price_dollars: "0.0800"
};
const sc2 = E.scoreMarket(illiquid, { recentDelta: 0 }, cfg);
check("illiquid/wide-spread/near-edge market scores < 70", sc2.score < 70, sc2);
const noQuote = { volume_24h_fp: "1000.00", yes_bid_dollars: null, yes_ask_dollars: null, last_price_dollars: "0.5000" };
const sc3 = E.scoreMarket(noQuote, {}, cfg);
check("missing quote → spread component 0.25 (never inferred)", sc3.parts.spread === 0.25, sc3);
const settledRow = { ...liquid, result: "yes", status: "settled" };
check("tradeable() excludes settled/resolved rows", E.tradeable(settledRow) === false && E.tradeable(liquid) === true);

/* ---------- pickTracked (highest-dollar per focus topic) ---------- */
const rows = [];
["gas", "elections", "culture", "crypto", "golf"].forEach(topic => {
  for (let i = 0; i < 9; i++) {
    rows.push({
      ticker: `${topic}-M${i}`, topic, status: "active", result: "",
      volume_24h_fp: String((9 - i) * 100) + ".00", volume_fp: String((9 - i) * 200) + ".00",
      last_price_dollars: "0.5000"
    });
  }
});
rows.push({ ticker: "settled-x", topic: "crypto", status: "settled", result: "yes", volume_24h_fp: "99999.00" });
const tracked = E.pickTracked(rows, cfg);
check("tracked set caps at 6 per topic (5 topics = 30)", tracked.length === 30, tracked.length);
check("no topic exceeds its per-topic cap",
  ["gas", "elections", "culture", "crypto", "golf"].every(t => tracked.filter(m => m.topic === t).length === 6));
check("settled market excluded from tracking", !tracked.some(m => m.ticker === "settled-x"));
check("tracked ordered by 24h dollar volume (highest first)", tracked[0].volume_24h_fp === "900.00" || E.DEFAULTS.cap < 30, tracked[0]);
check("cap 40 respected", tracked.length <= E.DEFAULTS.cap);

/* ---------- planEntry ---------- */
const likedAlert = {
  ticker: "KXA-1", dir: "up", yes_ask: "0.5400", yes_bid: "0.5300",
  no_bid: "0.4600", no_ask: "0.4700"
};
const liked = { score: 82, liked: true };
let plan = E.planEntry(likedAlert, liked, { openCount: 0, byTicker: {} }, cfg);
check("liked up-jump → momentum-10c buys YES at the ask", !!plan && plan.strategy === "momentum-10c" && plan.side === "yes" && plan.price === 0.54, plan);
check("entry qty = floor($5 / price), ≥ 1", plan && plan.qty === Math.max(1, Math.floor(5 / 0.54)), plan);
plan = E.planEntry(likedAlert, { score: 40, liked: false }, { openCount: 0, byTicker: {} }, cfg);
check("unliked up-jump → fade-jump buys NO at its bid", !!plan && plan.strategy === "fade-jump" && plan.side === "no" && plan.price === 0.46, plan);
const downAlert = { ticker: "KXB-1", dir: "down", yes_ask: "0.3000", yes_bid: "0.2900", no_bid: "0.7000", no_ask: "0.7100" };
plan = E.planEntry(downAlert, liked, { openCount: 0, byTicker: {} }, cfg);
check("liked down-jump → momentum-10c buys NO at its ask", !!plan && plan.strategy === "momentum-10c" && plan.side === "no" && plan.price === 0.71, plan);
plan = E.planEntry(downAlert, { score: 30, liked: false }, { openCount: 0, byTicker: {} }, cfg);
check("unliked down-jump → fade-jump buys YES at its ask", !!plan && plan.strategy === "fade-jump" && plan.side === "yes" && plan.price === 0.30, plan);
plan = E.planEntry(likedAlert, liked, { openCount: 3, byTicker: {} }, cfg);
check("max 3 open positions blocks new entries", plan === null, plan);
plan = E.planEntry(likedAlert, liked, { openCount: 1, byTicker: { "KXA-1": true } }, cfg);
check("one auto position per ticker", plan === null, plan);
plan = E.planEntry({ ...likedAlert, yes_ask: "0.9800" }, liked, { openCount: 0, byTicker: {} }, cfg);
check("quote ≥ $0.95 is not executable → no entry", plan === null, plan);

/* ---------- planExit (±$0.10 take-profit/stop-loss, 15-min time stop) ---------- */
const pos = { side: "yes", price: 0.54, qty: 9, openedMs: N - 5 * 60 * 1000, status: "open" };
let ex = E.planExit(pos, 0.65, cfg, N);
check("YES take-profit at +$0.11 (0.54 → 0.65)", !!ex && ex.reason.startsWith("take-profit") && Math.abs(ex.exitPrice - 0.65) < 1e-9 && Math.abs(ex.pnl - 0.99) < 1e-9, ex);
ex = E.planExit(pos, 0.44, cfg, N);
check("YES stop-loss at −$0.10 (0.54 → 0.44)", !!ex && ex.reason.startsWith("stop-loss") && Math.abs(ex.pnl + 0.9) < 1e-9, ex);
ex = E.planExit(pos, 0.58, cfg, N);
check("no exit while move is inside ±$0.10 and inside time window", ex === null, ex);
ex = E.planExit(pos, 0.58, cfg, N + 11 * 60 * 1000);
check("time-stop after 15 min", !!ex && ex.reason.startsWith("time-stop"), ex);
const posNo = { side: "no", price: 0.46, qty: 10, openedMs: N - 5 * 60 * 1000, status: "open" };
ex = E.planExit(posNo, 0.34, cfg, N);
check("NO position valued at 1 − YES price (0.46 → 0.66 when YES drops to 0.34)", !!ex && Math.abs(ex.exitPrice - 0.66) < 1e-9 && Math.abs(ex.pnl - 2.0) < 1e-9, ex);
ex = E.planExit({ ...pos, status: "settled" }, 0.99, cfg, N);
check("closed positions never re-exit", ex === null, ex);
ex = E.planExit(pos, null, cfg, N);
check("missing price → no exit (nothing inferred)", ex === null, ex);

/* ---------- fixed-point / rounding sanity used by the page ---------- */
check("round4 rounds to 4dp", E.round4(0.1 + 0.2) === 0.3, E.round4(0.1 + 0.2));
check("num parses dollar strings and rejects junk", E.num("0.5600") === 0.56 && E.num("") === null && E.num("abc") === null);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll alert-engine checks passed.");
process.exit(failed ? 1 : 0);
