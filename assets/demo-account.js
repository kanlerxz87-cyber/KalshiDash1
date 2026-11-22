// Demo-account display: only a captured, authenticated DEMO response can populate these tables.
// List records are first-page observations, not a complete account-performance history.
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmt(v) {
  if (v === null || v === undefined || v === "") return '<span class="muted">—</span>';
  if (typeof v === "object") return `<code>${esc(JSON.stringify(v))}</code>`;
  return esc(String(v));
}

// The collector only uses these exact endpoints. Do not turn an arbitrary stored string,
// production URL, lookalike host or API root into a purported official per-row source.
const ROUTES = {
  balance: "/portfolio/balance",
  positions: "/portfolio/positions",
  fills: "/portfolio/fills?limit=200",
  settlements: "/portfolio/settlements?limit=200",
};
const DEMO_ROOTS = [
  "https://external-api.demo.kalshi.co/trade-api/v2",
  "https://demo-api.kalshi.co/trade-api/v2",
];
function endpointSources(payload) {
  if (!DEMO_ROOTS.includes(payload.api_root) || !Array.isArray(payload.source_urls)) return null;
  const result = {};
  for (const [name, suffix] of Object.entries(ROUTES)) {
    const exact = payload.api_root + suffix;
    if (!payload.source_urls.includes(exact)) return null;
    result[name] = exact;
  }
  return result;
}

// Recheck the minimum required official envelopes so an older malformed snapshot cannot
// masquerade as a connected account. Actual field values are never filled or backfilled.
function validEnvelope(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const objects = (x) => Array.isArray(x) && x.every((row) => row !== null && typeof row === "object" && !Array.isArray(row));
  const optionalCursor = (x) => x === undefined || typeof x === "string";
  if (name === "balance") {
    return Number.isSafeInteger(value.balance) && typeof value.balance_dollars === "string"
      && /^-?\d+(?:\.\d+)?$/.test(value.balance_dollars)
      && Number.isSafeInteger(value.portfolio_value) && Number.isSafeInteger(value.updated_ts);
  }
  if (name === "positions") return objects(value.market_positions) && objects(value.event_positions) && optionalCursor(value.cursor);
  if (name === "fills") return objects(value.fills) && typeof value.cursor === "string";
  if (name === "settlements") return objects(value.settlements) && optionalCursor(value.cursor);
  return false;
}

function sourceCell(url) {
  return `<td><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Official endpoint ↗</a></td>`;
}

function rowsTable(items, sourceUrl) {
  const cols = [];
  for (const item of items) for (const key of Object.keys(item)) if (!cols.includes(key)) cols.push(key);
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = items.map((item) => `<tr>${cols.map((c) => `<td>${fmt(item[c])}</td>`).join("")}${sourceCell(sourceUrl)}</tr>`).join("\n");
  return `<div class="table-wrap"><table class="compact"><thead><tr>${head}<th>source</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function kvTable(obj, sourceUrl) {
  const body = Object.entries(obj).map(([key, value]) => `<tr><td>${esc(key)}</td><td>${fmt(value)}</td>${sourceCell(sourceUrl)}</tr>`).join("\n");
  return `<div class="table-wrap"><table class="compact"><thead><tr><th>API field</th><th>value</th><th>source</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function listSection(title, items, sourceUrl) {
  const heading = `<h3>${esc(title)} <span class="muted small">(${items.length} captured rows)</span></h3>`;
  if (!items.length) return heading + '<p class="muted">No entries in this captured page.</p>';
  return heading + rowsTable(items, sourceUrl);
}

function paginationNote(cursor) {
  return cursor ? '<p class="notice">Additional pages are available and are not included in this capture.</p>' : "";
}

async function main() {
  const status = $("#conn-status");
  const host = $("#account-data");
  let payload = null;
  try {
    const r = await fetch("data/account.json", { headers: { accept: "application/json" } });
    if (r.ok) payload = await r.json();
  } catch { /* report unavailable instead of inventing account data */ }

  if (!payload || payload.connected !== true) {
    status.innerHTML = '<strong>Account snapshot: not connected.</strong> Authenticated demo-account data is unavailable or unverified.';
    host.innerHTML = '<p class="muted">No authenticated account values are displayed. The endpoint contracts and setup details are listed below.</p>';
    return;
  }
  const sources = endpointSources(payload);
  const valid = Object.keys(ROUTES).every((name) => validEnvelope(name, payload[name]));
  if (!sources || !valid || typeof payload.captured_at !== "string" || !Number.isFinite(Date.parse(payload.captured_at))) {
    status.innerHTML = '<strong>Account snapshot: unverified.</strong> Required response fields, capture time or official demo endpoint provenance are missing or invalid.';
    host.innerHTML = '<p class="notice">Account values are withheld until the capture and its official sources can be verified.</p>';
    return;
  }

  status.innerHTML = `<strong>Last authenticated demo snapshot:</strong> <code>${esc(payload.captured_at)}</code>
    from <code>${esc(payload.api_root)}</code> (key ${esc(payload.key_fingerprint)}).
    This records a completed capture, not a live connection. Demo values may not reflect real markets
    (<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Kalshi demo environment ↗</a>).`;

  host.innerHTML =
    '<p class="notice"><strong>Public snapshot:</strong> account responses committed to this public repository and GitHub Pages are visible to visitors. Key secrecy does not make account data private. <a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages">GitHub Pages visibility ↗</a></p>' +
    '<p class="muted">These sequential reads are first-page snapshots, not an atomic or complete account history.</p>' +
    '<h3>Balance (API fields)</h3>' + kvTable(payload.balance, sources.balance) +
    listSection("Market positions", payload.positions.market_positions, sources.positions) +
    listSection("Event positions", payload.positions.event_positions, sources.positions) + paginationNote(payload.positions.cursor) +
    listSection("Fills", payload.fills.fills, sources.fills) + paginationNote(payload.fills.cursor) +
    listSection("Settlements", payload.settlements.settlements, sources.settlements) + paginationNote(payload.settlements.cursor);
}

main();
