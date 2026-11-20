// Kalshi Demo Dashboard — browser code.
// Reads ONLY public, unauthenticated endpoints of the official Kalshi demo Trade API.
// No credentials are requested, stored or sent. Values are shown exactly as the API returns them.
const API = "https://external-api.demo.kalshi.co/trade-api/v2";
const DAY = 86400;
const TOP_SERIES = 8;
const RESOLVED_WINDOW_DAYS = 14;

// Topic → series selection (all from official Series List filters; see sources page).
const TOPICS = {
  gas: { seriesParams: { tags: "Oil & Gas", include_volume: "true" }, filter: (s) => s.ticker.startsWith("KXAAAGAS") },
  elections: { seriesParams: { category: "Elections", include_volume: "true" }, filter: () => true },
  culture: { seriesParams: { category: "Entertainment", include_volume: "true" }, filter: () => true },
  crypto: { seriesParams: { category: "Crypto", include_volume: "true" }, filter: () => true },
  golf: { seriesParams: { category: "Sports", tags: "Golf", include_volume: "true" }, filter: () => true },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const usd = (v, d = 2) => { const n = num(v); return n === null ? "—" : "$" + n.toFixed(d); };
const cnt = (v) => { const n = num(v); return n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
const cleanTitle = (t) => String(t ?? "").replace(/\*\*/g, "").trim();
const when = (iso) => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(); };
const base = () => (location.pathname.includes("/categories/") ? "../" : "");

class ApiError extends Error {
  constructor(kind, url, detail) { super(kind); this.kind = kind; this.url = url; this.detail = detail; }
}
function apiUrl(path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}
async function api(path, params = {}) {
  const url = apiUrl(path, params);
  let r;
  try {
    r = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new ApiError("network", url, e.message);
  }
  if (!r.ok) throw new ApiError("http", url, `HTTP ${r.status}`);
  return r.json();
}
function explain(e) {
  if (e instanceof ApiError && e.kind === "network")
    return "Could not read the Kalshi demo API from this browser (network, or cross-origin blocking). Unverified in this build — see Flagged for review F-01.";
  if (e instanceof ApiError) return `Kalshi API returned ${e.detail} for ${e.url}`;
  return String(e && e.message ? e.message : e);
}
const apiLink = (url, text = "API record ↗") => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

async function eventsPages(params, maxPages) {
  const out = [];
  let cursor = "";
  let pages = 0;
  do {
    const j = await api("/events", { ...params, limit: 200, cursor });
    out.push(...(j.events || []));
    cursor = j.cursor || "";
    pages += 1;
  } while (cursor && pages < maxPages);
  return out;
}

function marketRow(m, s, ev) {
  const notional = num(m.notional_value_dollars);
  const oi = num(m.open_interest_fp);
  return {
    series: s.ticker,
    seriesTitle: s.title || s.ticker,
    ticker: m.ticker,
    eventTicker: m.event_ticker || (ev && ev.event_ticker) || "",
    title: cleanTitle(m.title || (ev && ev.title) || m.ticker),
    yesSub: cleanTitle(m.yes_sub_title || ""),
    status: m.status || "",
    result: m.result || "",
    yesBid: m.yes_bid_dollars,
    yesAsk: m.yes_ask_dollars,
    last: m.last_price_dollars,
    volume: num(m.volume_fp),
    vol24: num(m.volume_24h_fp),
    oi,
    oiUsd: oi !== null && notional !== null ? oi * notional : null,
    close: m.close_time,
    settled: m.settlement_ts || "",
    url: apiUrl(`/markets/${m.ticker}`),
  };
}

// ---------- HOME ----------
async function loadHome() {
  const el = $("#ex-status");
  const det = $("#ex-detail");
  $("#asof").textContent = new Date().toLocaleString();
  try {
    const j = await api("/exchange/status");
    el.textContent = j.exchange_active && j.trading_active ? "Active · trading on" : "Check status";
    det.innerHTML = `exchange_active: <b>${esc(j.exchange_active)}</b> · trading_active: <b>${esc(j.trading_active)}</b> · ${apiLink(apiUrl("/exchange/status"), "source")}`;
  } catch (e) {
    el.textContent = "Unavailable";
    det.innerHTML = `<span class="status-line err">${esc(explain(e))}</span>`;
  }
}

// ---------- TOPIC PAGES ----------
async function loadTopic(key) {
  const T = TOPICS[key];
  const status = $("#t-status");
  const setText = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  try {
    const sj = await api("/series", T.seriesParams);
    const seriesAll = (sj.series || []).filter(T.filter).map((s) => ({ ...s, vol: num(s.volume_fp) ?? 0 }));
    seriesAll.sort((a, b) => b.vol - a.vol);
    const series = seriesAll.slice(0, TOP_SERIES);
    setText("t-series", String(series.length));
    if (!series.length) { status.textContent = "No series found for this topic in the API response."; setText("t-open", "0"); setText("t-oi", "—"); setText("t-res", "0"); return; }

    const sinceTs = Math.floor(Date.now() / 1000) - RESOLVED_WINDOW_DAYS * DAY;
    const settled = await Promise.allSettled(series.map(async (s) => {
      const [open, closed] = await Promise.all([
        eventsPages({ series_ticker: s.ticker, status: "open", with_nested_markets: "true" }, 2),
        eventsPages({ series_ticker: s.ticker, status: "settled", with_nested_markets: "true", min_close_ts: sinceTs }, 1),
      ]);
      const openRows = [];
      for (const ev of open) for (const m of ev.markets || []) if (!m.result) openRows.push(marketRow(m, s, ev));
      const resRows = [];
      for (const ev of closed) for (const m of ev.markets || []) if (m.result === "yes" || m.result === "no") resRows.push(marketRow(m, s, ev));
      return { s, openRows, resRows };
    }));

    const errors = [];
    let openRows = [];
    let resRows = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") { openRows = openRows.concat(r.value.openRows); resRows = resRows.concat(r.value.resRows); }
      else errors.push(`${series[i].ticker}: ${explain(r.reason)}`);
    });
    openRows.sort((a, b) => (b.oiUsd ?? -1) - (a.oiUsd ?? -1));
    resRows.sort((a, b) => (b.settled || "").localeCompare(a.settled || ""));

    const oiTotal = openRows.reduce((acc, r) => acc + (r.oiUsd ?? 0), 0);
    setText("t-open", openRows.length.toLocaleString());
    setText("t-oi", "$" + oiTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }));
    setText("t-res", resRows.length.toLocaleString());
    status.innerHTML = `Live from the Kalshi demo API as of ${esc(new Date().toLocaleString())}.` +
      (errors.length ? ` <span class="status-line err">Some series could not be loaded: ${esc(errors.join(" | "))}</span>` : "");

    renderOpen(key, openRows);
    renderSettled(resRows);
    renderSeries(series);
  } catch (e) {
    status.innerHTML = `<span class="status-line err">${esc(explain(e))}</span>`;
    setText("t-series", "—"); setText("t-open", "—"); setText("t-oi", "—"); setText("t-res", "—");
  }
}

function marketLink(r) {
  return `<a href="${base()}dashboard.html?series=${encodeURIComponent(r.series)}&ticker=${encodeURIComponent(r.ticker)}">${esc(r.ticker)}</a>`;
}

function renderOpen(key, rows) {
  const host = $("#open-table");
  const draw = (filter) => {
    const f = (filter || "").toLowerCase();
    const shown = rows.filter((r) => !f || `${r.title} ${r.ticker} ${r.seriesTitle} ${r.yesSub}`.toLowerCase().includes(f)).slice(0, 150);
    if (!rows.length) { host.innerHTML = `<p class="muted">No open markets returned for this topic.</p>`; return; }
    const body = shown.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${esc(r.title)}${r.yesSub ? `<div class="muted small">${esc(r.yesSub)}</div>` : ""}</td>
      <td>${marketLink(r)}</td>
      <td>${esc(r.seriesTitle)}</td>
      <td class="num">${usd(r.yesBid)}</td>
      <td class="num">${usd(r.yesAsk)}</td>
      <td class="num">${usd(r.last)}</td>
      <td class="num">${cnt(r.volume)}</td>
      <td class="num">${cnt(r.oi)}</td>
      <td class="num">${r.oiUsd === null ? "—" : "$" + r.oiUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
      <td>${esc(when(r.close))}</td>
      <td>${apiLink(r.url)}</td>
    </tr>`).join("");
    host.innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Market</th><th>Ticker</th><th>Series</th><th class="num">Yes bid</th><th class="num">Yes ask</th><th class="num">Last</th>
      <th class="num">Volume (contracts)</th><th class="num">Open interest (contracts)</th><th class="num">Open-interest $ (derived)</th><th>Closes</th><th>Source</th>
      </tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted small">Showing ${shown.length} of ${rows.length} open markets. Ranked by open-interest $ (derived: open interest × notional_value_dollars).</p>`;
  };
  draw("");
  const input = $("#open-filter");
  if (input) input.addEventListener("input", () => draw(input.value));
  void key;
}

function renderSettled(rows) {
  const host = $("#settled-table");
  if (!rows.length) { host.innerHTML = `<p class="muted">No YES/NO results returned in the last ${RESOLVED_WINDOW_DAYS} days for these series.</p>`; return; }
  const body = rows.slice(0, 150).map((r) => `<tr>
    <td>${esc(r.title)}${r.yesSub ? `<div class="muted small">${esc(r.yesSub)}</div>` : ""}</td>
    <td>${esc(r.ticker)}</td>
    <td class="${r.result === "yes" ? "yes" : "no"}">${esc(r.result.toUpperCase())}</td>
    <td>${esc(r.status)}</td>
    <td>${esc(when(r.settled))}</td>
    <td class="num">${cnt(r.volume)}</td>
    <td>${apiLink(r.url)}</td>
  </tr>`).join("");
  host.innerHTML = `<div class="table-wrap"><table><thead><tr>
    <th>Market</th><th>Ticker</th><th>Result</th><th>Status</th><th>Settled</th><th class="num">Volume (contracts)</th><th>Source</th>
    </tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderSeries(series) {
  const host = $("#series-table");
  const body = series.map((s) => {
    const srcs = (s.settlement_sources || []).filter((x) => x && x.url).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(", ") || "—";
    return `<tr>
      <td>${esc(s.ticker)}</td><td>${esc(s.title)}</td><td class="num">${cnt(s.volume_fp)}</td>
      <td>${esc(s.frequency || "—")}</td><td>${srcs}</td>
      <td>${s.contract_terms_url ? `<a href="${esc(s.contract_terms_url)}" target="_blank" rel="noopener">terms ↗</a>` : "—"}</td>
      <td>${apiLink(apiUrl(`/series/${s.ticker}`))}</td></tr>`;
  }).join("");
  host.innerHTML = `<div class="table-wrap"><table><thead><tr>
    <th>Series</th><th>Title</th><th class="num">Series volume (contracts)</th><th>Frequency</th><th>Settlement source(s), from API</th><th>Contract terms</th><th>Source</th>
    </tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- DASHBOARD ----------
const RANGES = {
  sec: [["Since page opened", 0]],
  min: [["1 hour", 3600], ["6 hours", 6 * 3600], ["24 hours", DAY], ["3 days", 3 * DAY]],
  hour: [["24 hours", DAY], ["3 days", 3 * DAY], ["7 days", 7 * DAY], ["30 days", 30 * DAY]],
  day: [["30 days", 30 * DAY], ["90 days", 90 * DAY], ["365 days", 365 * DAY]],
};
const PERIOD = { min: 1, hour: 60, day: 1440 };
const LIVE_MAX = 1800;
const state = { series: "", ticker: "", market: null, gran: "min", range: 3600, live: [], timer: null, tick: 0 };

function fmtX(gran) {
  return (t) => {
    const d = new Date(t * 1000);
    if (gran === "sec") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (gran === "min") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (gran === "hour") return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
}

function drawChart(lines, gran) {
  const svg = $("#chart");
  const W = 900, H = 360, pl = 64, pr = 16, pt = 14, pb = 40;
  const all = lines.flatMap((l) => l.pts.filter((p) => p.y !== null));
  if (!all.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="axis-label">No price points for this range yet.</text>`;
    return;
  }
  let t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  if (t1 === t0) { t1 = t0 + 1; }
  let y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
  if (y1 === y0) { y0 -= 0.01; y1 += 0.01; }
  const pad = (y1 - y0) * 0.1;
  y0 = Math.max(0, y0 - pad); y1 = Math.min(1, y1 + pad);
  if (y1 <= y0) { y1 = y0 + 0.01; }
  const X = (t) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis-label" x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">$${v.toFixed(3)}</text>`;
  }
  const fx = fmtX(gran);
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    g += `<text class="axis-label" x="${X(t)}" y="${H - 14}" text-anchor="middle">${esc(fx(t))}</text>`;
  }
  g += `<text class="axis-label" x="${pl}" y="${pt - 2}">Price, USD per YES contract (y)</text>`;
  g += `<text class="axis-label" x="${W - pr}" y="${H - 2}" text-anchor="end">Time (x)</text>`;
  let body = "";
  for (const l of lines) {
    let seg = [];
    const flush = () => {
      if (seg.length === 1) body += `<circle class="dot" cx="${seg[0][0]}" cy="${seg[0][1]}" r="3"/>`;
      else if (seg.length > 1) body += `<polyline class="${l.cls}" points="${seg.map((p) => p.join(",")).join(" ")}"/>`;
      seg = [];
    };
    for (const p of l.pts) { if (p.y === null) flush(); else seg.push([X(p.t).toFixed(1), Y(p.y).toFixed(1)]); }
    flush();
  }
  const legend = `<text class="axis-label" x="${W - pr - 230}" y="${pt + 10}">— last &nbsp; - - bid &nbsp; - - ask</text>`;
  svg.innerHTML = g + body + legend;
}

function setCards(m) {
  $("#c-last").textContent = usd(m.last_price_dollars, 4);
  $("#c-bid").textContent = usd(m.yes_bid_dollars, 4);
  $("#c-ask").textContent = usd(m.yes_ask_dollars, 4);
  $("#c-oi").textContent = cnt(m.open_interest_fp);
  $("#c-status").textContent = `${m.status || "—"}${m.result ? " · result " + m.result : ""}`;
}

function bookTables(ob, ticker) {
  const src = apiLink(apiUrl(`/markets/${ticker}/orderbook`, { depth: 20 }), "orderbook ↗");
  const yes = (ob.yes_dollars || []).map(([p, q]) => ({ p: num(p), q: num(q) })).filter((x) => x.p !== null);
  const no = (ob.no_dollars || []).map(([p, q]) => ({ p: num(p), q: num(q) })).filter((x) => x.p !== null);
  const bids = yes.slice().sort((a, b) => b.p - a.p);
  const asks = no.map((x) => ({ p: +(1 - x.p).toFixed(4), q: x.q })).sort((a, b) => a.p - b.p);
  const table = (rows, label) => {
    if (!rows.length) return `<p class="muted">No resting ${label} at this depth (the API returned an empty side).</p>`;
    let cum = 0;
    const body = rows.map((r) => { cum += r.q; return `<tr><td class="num">$${r.p.toFixed(4)}</td><td class="num">${cnt(r.q)}</td><td class="num">${cnt(cum)}</td><td>${src}</td></tr>`; }).join("");
    return `<div class="table-wrap"><table class="compact"><thead><tr><th class="num">Price</th><th class="num">Contracts</th><th class="num">Cumulative</th><th>Source</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  $("#bids-table").innerHTML = table(bids, "YES bids");
  $("#asks-table").innerHTML = table(asks, "implied YES asks");
}

async function refreshMarket() {
  const j = await api(`/markets/${state.ticker}`);
  state.market = j.market;
  setCards(j.market);
  const m = j.market;
  $("#m-rules").textContent = [`Title: ${cleanTitle(m.title || "")}`, `Event: ${m.event_ticker}`, `Status: ${m.status}${m.result ? ` · Result: ${m.result}` : ""}`, `Closes: ${when(m.close_time)}`, "", `Rules (primary): ${m.rules_primary || "—"}`, m.rules_secondary ? `Rules (secondary): ${m.rules_secondary}` : ""].join("\n");
  return j.market;
}

async function refreshBook() {
  const j = await api(`/markets/${state.ticker}/orderbook`, { depth: 20 });
  bookTables(j.orderbook_fp || {}, state.ticker);
}

async function loadCandles() {
  const period = PERIOD[state.gran];
  const end = Math.floor(Date.now() / 1000);
  const start = end - state.range;
  const j = await api(`/series/${state.series}/markets/${state.ticker}/candlesticks`, { start_ts: start, end_ts: end, period_interval: period });
  const cs = j.candlesticks || [];
  const lines = [
    { cls: "line-last", pts: cs.map((c) => ({ t: c.end_period_ts, y: num(c.price && c.price.close_dollars) })) },
    { cls: "line-bid", pts: cs.map((c) => ({ t: c.end_period_ts, y: num(c.yes_bid && c.yes_bid.close_dollars) })) },
    { cls: "line-ask", pts: cs.map((c) => ({ t: c.end_period_ts, y: num(c.yes_ask && c.yes_ask.close_dollars) })) },
  ];
  drawChart(lines, state.gran);
  const withPrice = cs.filter((c) => c.price && c.price.close_dollars !== null).length;
  $("#chart-note").innerHTML = `${cs.length} candles from ${apiLink(apiUrl(`/series/${state.series}/markets/${state.ticker}/candlesticks`, { start_ts: start, end_ts: end, period_interval: period }), "candlesticks API ↗")}; ${withPrice} with a traded price (null = no trade in that period, left as a gap).`;
}

function liveLines() {
  const pts = state.live;
  return [
    { cls: "line-last", pts: pts.map((s) => ({ t: s.t, y: s.last })) },
    { cls: "line-bid", pts: pts.map((s) => ({ t: s.t, y: s.bid })) },
    { cls: "line-ask", pts: pts.map((s) => ({ t: s.t, y: s.ask })) },
  ];
}

async function liveSample() {
  try {
    const m = await refreshMarket();
    state.live.push({ t: Math.floor(Date.now() / 1000), last: num(m.last_price_dollars), bid: num(m.yes_bid_dollars), ask: num(m.yes_ask_dollars) });
    if (state.live.length > LIVE_MAX) state.live.shift();
    state.tick += 1;
    if (state.tick % 3 === 0) await refreshBook();
    drawChart(liveLines(), "sec");
    $("#chart-note").innerHTML = `${state.live.length} samples recorded in this browser tab (every 5 s from ${apiLink(apiUrl(`/markets/${state.ticker}`), "market record ↗")}). Not API history; stops when the page closes.`;
    $("#m-status").textContent = `Live · last update ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    $("#m-status").innerHTML = `<span class="status-line err">${esc(explain(e))}</span>`;
  }
}

function stopLive() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

function setRangeOptions() {
  const sel = $("#range");
  sel.innerHTML = RANGES[state.gran].map(([label, secs]) => `<option value="${secs}">${label}</option>`).join("");
  state.range = RANGES[state.gran][0][1];
  sel.value = String(state.range);
}

async function applyView() {
  stopLive();
  if (!state.ticker) return;
  if (state.gran === "sec") {
    state.live = [];
    $("#m-status").textContent = "Starting live recording…";
    await liveSample();
    state.timer = setInterval(liveSample, 5000);
  } else {
    $("#m-status").textContent = "Loading candles…";
    try {
      await loadCandles();
      $("#m-status").textContent = `Loaded ${state.gran === "min" ? "1-minute" : state.gran === "hour" ? "1-hour" : "1-day"} candles · ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      $("#m-status").innerHTML = `<span class="status-line err">${esc(explain(e))}</span>`;
      drawChart([], state.gran);
    }
  }
}

async function loadDashboard() {
  const p = new URLSearchParams(location.search);
  state.series = p.get("series") || "";
  state.ticker = p.get("ticker") || "";
  const sel = $("#market-select");
  const gran = $("#gran");
  setRangeOptions();

  if (!state.ticker || !state.series) {
    $("#m-status").innerHTML = `Pick a market from a category page (each ticker link opens this dashboard). Categories: <a href="${base()}categories/gas.html">Gas</a> · <a href="${base()}categories/elections.html">Elections</a> · <a href="${base()}categories/culture.html">Culture</a> · <a href="${base()}categories/crypto.html">Crypto</a> · <a href="${base()}categories/golf.html">Golf</a>`;
    return;
  }

  // Populate the market picker with open markets in this series.
  try {
    const evs = await eventsPages({ series_ticker: state.series, status: "open", with_nested_markets: "true" }, 1);
    const ms = [];
    for (const ev of evs) for (const m of ev.markets || []) if (!m.result) ms.push(m);
    sel.innerHTML = ms.map((m) => `<option value="${esc(m.ticker)}" ${m.ticker === state.ticker ? "selected" : ""}>${esc(cleanTitle(m.title))} · ${esc(m.ticker)}</option>`).join("");
    if (!ms.some((m) => m.ticker === state.ticker)) sel.insertAdjacentHTML("afterbegin", `<option value="${esc(state.ticker)}" selected>${esc(state.ticker)}</option>`);
  } catch (e) {
    sel.innerHTML = `<option value="${esc(state.ticker)}">${esc(state.ticker)}</option>`;
  }

  sel.addEventListener("change", () => {
    state.ticker = sel.value;
    history.replaceState(null, "", `?series=${encodeURIComponent(state.series)}&ticker=${encodeURIComponent(state.ticker)}`);
    loadBoth();
  });
  gran.addEventListener("change", () => { state.gran = gran.value; setRangeOptions(); applyView(); });
  $("#range").addEventListener("change", (e) => { state.range = Number(e.target.value); applyView(); });
  $("#refresh").addEventListener("click", () => loadBoth());
  await loadBoth();
}

async function loadBoth() {
  try {
    await refreshMarket();
    await refreshBook();
  } catch (e) {
    $("#m-status").innerHTML = `<span class="status-line err">${esc(explain(e))}</span>`;
    return;
  }
  await applyView();
}

// ---------- start ----------
const page = document.body.dataset.page;
if (page === "home") loadHome();
if (page === "topic") loadTopic(document.body.dataset.topic);
if (page === "dashboard") loadDashboard();
