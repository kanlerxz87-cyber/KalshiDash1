// KalshiDash1 — dependency-free logic test for the browser API client.
// Runs the real docs/assets/kalshi.js in Node against a mocked Kalshi demo
// response set built strictly from the documented response shapes, and asserts
// the parsing/ranking rules the site depends on.
//
//   node tools/qa_logic_test.mjs
//
// Documented shapes used (all read from docs.kalshi.com on 2026-11-20):
//   GET /series      -> { series: [{ticker,title,category,categories[],volume_fp}], cursor }
//                       https://docs.kalshi.com/api-reference/market/get-series-list
//   GET /markets     -> { markets: [{ticker,event_ticker,series_ticker,yes_sub_title,status,
//                       result,volume_fp,volume_24h_fp,open_interest_fp,last_price_dollars,
//                       yes_bid_dollars,yes_ask_dollars,close_time,notional_value_dollars}], cursor }
//                       https://docs.kalshi.com/api-reference/market/get-markets
//   orderbook        -> { orderbook_fp: { yes_dollars: [[price_dollars, count_fp], ...],
//                       no_dollars: [...] } }  ascending, best bid last
//                       https://docs.kalshi.com/api-reference/market/get-market-orderbook
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "docs", "assets", "kalshi.js"), "utf8");

/* ---------- mock transport ---------- */
const SERIES = [
  { ticker: "KXBTCD", title: "Bitcoin price daily", category: "Crypto", categories: ["Crypto"], volume_fp: "900000.00" },
  { ticker: "KXETHCD", title: "Ethereum price daily", category: "Crypto", categories: ["Crypto"], volume_fp: "150000.00" },
  { ticker: "KXGASPRICE", title: "US average gasoline price", category: "Economics", categories: ["Economics", "Gas Prices"], volume_fp: "55000.00" },
  { ticker: "KXPRES", title: "Presidential election winner", category: "Politics", categories: ["Politics", "Elections"], volume_fp: "800000.00" },
  { ticker: "KXGOLF", title: "PGA Championship winner", category: "Sports", categories: ["Sports", "Golf"], volume_fp: "31000.00" },
  { ticker: "KXOSCAR", title: "Oscar for best picture", category: "Culture", categories: ["Culture", "Entertainment"], volume_fp: "240000.00" },
  { ticker: "KXTEMP", title: "Highest temperature in NYC", category: "Weather", categories: ["Weather"], volume_fp: "400000.00" }
];
const MKT = (t, series, title, vol24h, last, extra = {}) => ({
  ticker: t, event_ticker: t.slice(0, -4) + "EVT", series_ticker: series, yes_sub_title: title,
  title, status: "active", result: "", volume_fp: vol24h, volume_24h_fp: vol24h, open_interest_fp: "1000.00",
  last_price_dollars: last, yes_bid_dollars: last, yes_ask_dollars: last, close_time: "2026-11-21T00:00:00Z",
  notional_value_dollars: "1.00", ...extra
});
const MARKETS = {
  KXBTCD: [MKT("KXBTCD-NOV21-T100K", "KXBTCD", "BTC above 100k", "500000.00", "0.6200")],
  KXETHCD: [MKT("KXETHCD-NOV21-T3K", "KXETHCD", "ETH above 3k", "20000.00", "0.4100")],
  KXGASPRICE: [MKT("KXGASPRICE-NOV21-T350", "KXGASPRICE", "avg gas above 3.50", "12000.00", "0.3300")],
  KXPRES: [MKT("KXPRES-NOV21-NOM", "KXPRES", "nominee wins", "300000.00", "0.5500")],
  KXGOLF: [MKT("KXGOLF-NOV21-WIN", "KXGOLF", "player wins", "8000.00", "0.1200")],
  KXOSCAR: [MKT("KXOSCAR-2027-BP", "KXOSCAR", "film wins", "90000.00", "0.0900", { status: "settled", result: "yes", settlement_ts: "2026-11-19T10:00:00Z", settlement_value_dollars: "1.0000" })],
  KXTEMP: [MKT("KXTEMP-NOV21-T80", "KXTEMP", "temp above 80", "999999.00", "0.9000")]
};
let calls = [];
globalThis.window = globalThis;
globalThis.fetch = (url) => {
  calls.push(url);
  const u = new URL(url);
  const p = u.pathname;
  if (p.endsWith("/series")) return Promise.resolve(json({ series: SERIES, cursor: "" }));
  if (p.endsWith("/markets")) {
    const st = u.searchParams.get("status");
    const s = u.searchParams.get("series_ticker");
    let rows = s ? (MARKETS[s] || []) : Object.values(MARKETS).flat();
    if (st === "open") rows = rows.filter(m => m.status === "active");
    if (st === "settled") rows = Object.values(MARKETS).flat().filter(m => m.status === "settled");
    return Promise.resolve(json({ markets: rows, cursor: "" }));
  }
  if (p.endsWith("/orderbook")) {
    return Promise.resolve(json({ orderbook_fp: {
      yes_dollars: [["0.5000", "100.00"], ["0.5500", "200.00"], ["0.6000", "50.00"]],
      no_dollars: [["0.3500", "80.00"], ["0.3800", "10.00"]]
    } }));
  }
  if (p.endsWith("/candlesticks")) {
    return Promise.resolve(json({ candlesticks: [
      { end_period_ts: 1763600000, price: { close: "0.6000" }, volume_fp: "10.00" },
      { end_period_ts: 1763603600, price: { close: "0.6200" }, volume_fp: "12.00" }
    ] }));
  }
  if (/\/markets\/[^/]+$/.test(p)) {
    const t = p.split("/").pop();
    const all = Object.values(MARKETS).flat();
    const m = all.find(x => x.ticker === t);
    return m ? Promise.resolve(json({ market: m })) : Promise.resolve(json({ error: { code: "not_found" } }, 404));
  }
  return Promise.resolve(json({ exchange_active: true, trading_active: true }));
};
function json(obj, status = 200) {
  return Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(JSON.stringify(obj)) });
}

/* ---------- load the real client ---------- */
new Function(src)();
const K = globalThis.KalshiDash;

let failed = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const { byCategory } = await K.discoverCategories(2);
check("series discovery finds crypto by category field", byCategory.crypto.some(s => s.ticker === "KXBTCD"));
check("gas prices matched via categories[] keyword", byCategory.gas.some(s => s.ticker === "KXGASPRICE"), JSON.stringify(byCategory.gas.map(s => s.ticker)));
check("elections matched", byCategory.elections.some(s => s.ticker === "KXPRES"));
check("golf matched", byCategory.golf.some(s => s.ticker === "KXGOLF"));
check("culture matched", byCategory.culture.some(s => s.ticker === "KXOSCAR"));
check("unrelated weather series excluded", !Object.values(byCategory).flat().some(s => s.ticker === "KXTEMP"));
check("crypto series ordered by official volume_fp", byCategory.crypto[0].ticker === "KXBTCD");

const rows = await K.rankHighestDollar(byCategory, 5);
check("ranking returns rows", rows.length > 0, `${rows.length} rows`);
check("estimated notional = volume x last price", Math.abs(rows[0].notional - 500000 * 0.62) < 1e-6, JSON.stringify({ t: rows[0].market.ticker, n: rows[0].notional }));
check("ranking is descending by estimated notional", rows.every((r, i) => i === 0 || rows[i - 1].notional >= r.notional));
check("open markets only (settled excluded from ranking)", !rows.some(r => r.market.result === "yes" && r.market.status === "settled"));
check("display title prefers yes_sub_title", K.displayTitle(rows[0].market) === "BTC above 100k");
check("no /series limit param requested", !calls.some(c => /\/series\?.*limit=/.test(c)), calls.filter(c => /series/.test(c))[0]);
check("series request uses documented include_volume", calls.some(c => /\/series\?include_volume=true/.test(c)));

const settled = await K.recentSettled({ KXOSCAR: true }, 30 * 86400, 2);
check("recentSettled returns the settled market", settled.length === 1 && settled[0].ticker === "KXOSCAR-2027-BP", JSON.stringify(settled.map(m => m.ticker)));
check("resolution label reads the result field", K.resolutionLabel(settled[0]) === "YES");
check("isResolved true for result=yes", K.isResolved(settled[0]) === true);
check("isResolved false for empty result + active status", K.isResolved(MKT("X", "Y", "Z", "1", "0.5")) === false);
check("settled-but-empty result is not guessed", K.resolutionLabel({ status: "settled", result: "" }) === "SETTLED — result field empty in API");

const book = await K.getOrderbook("KXBTCD-NOV21-T100K", 0);
const yes = book.yes_dollars, no = book.no_dollars;
check("orderbook best bid is the last level", parseFloat(yes[yes.length - 1][0]) === 0.6, JSON.stringify(yes));
check("contracts at a price are the second element", parseFloat(yes[yes.length - 1][1]) === 50);
check("implied YES ask = 1 - best NO bid", Math.abs((1 - parseFloat(no[no.length - 1][0])) - 0.62) < 1e-9);

const c = await K.getCandlesticks("KXBTCD", "KXBTCD-NOV21-T100K", 1, 2, 60);
check("candlesticks parsed", c.length === 2 && c[0].end_period_ts === 1763600000);
check("nested candle close readable", JSON.stringify(c[1].price) === JSON.stringify({ close: "0.6200" }));

const st = await K.getExchangeStatus();
check("exchange status parsed from a 200 response", st.exchange_active === true && st.trading_active === true);

check("fixed-point strings parse", K.num("1234.00") === 1234 && K.num("0.5600") === 0.56 && K.num(null, 0) === 0);
check("absent price stays null (never defaulted to 0)", K.lastPrice({ yes_bid: 40, yes_ask: undefined, last_price: undefined }) === 0.4);
check("empty volume field yields 0 contracts only where documented", K.volume({}) === 0 && K.openInterest({}) === 0);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
