// demo-account.js — renders data/account.json (verbatim demo-account API responses).
// Session session-d5b935f4. No field names are invented: tables are built from the raw JSON
// keys the API returned. Values that cannot be confirmed stay blank (never filled in).
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmt(v) {
  if (v === null || v === undefined || v === "") return '<span class="muted">—</span>';
  if (typeof v === "object") return `<code>${esc(JSON.stringify(v))}</code>`;
  return esc(String(v));
}

// Generic table: columns = union of keys across items (order preserved from first appearance).
function rowsTable(items, sourceUrl) {
  const cols = [];
  for (const it of items) for (const k of Object.keys(it || {})) if (!cols.includes(k)) cols.push(k);
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = items.map((it) => `<tr>${cols.map((c) => `<td>${fmt(it ? it[c] : undefined)}</td>`).join("")}</tr>`).join("\n");
  return `<div class="table-wrap"><table class="compact"><thead><tr>${head}<th>source</th></tr></thead><tbody>\n${body}\n<tr>${cols.map(() => "<td></td>").join("")}<td><a href="${esc(sourceUrl)}" target="_blank" rel="noopener">endpoint ↗</a></td></tr>\n</tbody></table></div>`;
}

function kvTable(obj, sourceUrl) {
  const body = Object.entries(obj || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join("\n");
  return `<div class="table-wrap"><table class="compact"><thead><tr><th>API field</th><th>value</th></tr></thead><tbody>\n${body}\n<tr><td class="muted">source</td><td><a href="${esc(sourceUrl)}" target="_blank" rel="noopener">endpoint ↗</a></td></tr>\n</tbody></table></div>`;
}

function sectionItems(payload, name, sourceUrl) {
  const node = payload[name];
  if (node && node.error) return `<h3>${esc(name)}</h3><p class="muted">API call failed (HTTP ${esc(node.status)}): <code>${esc(String(node.body || "").slice(0, 300))}</code></p>`;
  if (Array.isArray(node)) {
    if (!node.length) return `<h3>${esc(name)}</h3><p class="muted">Empty list returned.</p>`;
    return `<h3>${esc(name)} <span class="muted small">(${node.length} rows, verbatim)</span></h3>` + rowsTable(node, sourceUrl);
  }
  if (node && typeof node === "object") return `<h3>${esc(name)}</h3>` + kvTable(node, sourceUrl);
  return `<h3>${esc(name)}</h3><p class="muted">Not present in the snapshot.</p>`;
}

async function main() {
  const status = $("#conn-status");
  const host = $("#account-data");
  let payload = null;
  try {
    const r = await fetch("data/account.json", { headers: { accept: "application/json" } });
    if (r.ok) payload = await r.json();
  } catch (e) { /* fall through to not-connected */ }

  if (!payload || payload.connected !== true) {
    status.innerHTML = `<strong>Connection status: not connected.</strong> No demo-account snapshot exists
      (<code>data/account.json</code> missing or <code>connected: false</code>). The site never stores API keys —
      add repository secrets as described in <a href="#setup">Setup</a> and run the
      <code>demo-account</code> workflow. Nothing on this page is fabricated meanwhile.`;
    host.innerHTML = `<p class="muted">No account data until the owner connects the demo account. Required endpoints and their verified contracts are listed below.</p>`;
    return;
  }

  status.innerHTML = `<strong>Connection status: connected.</strong> Snapshot captured at
    <code>${esc(payload.captured_at)}</code> from <code>${esc(payload.api_root)}</code>
    (key ${esc(payload.key_fingerprint)}). Environment: ${esc(payload.environment)}.
    Demo values “may not be reflective of those in real markets”
    (<a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Demo environment ↗</a>).`;

  const urls = payload.source_urls || [];
  const u = (frag) => urls.find((x) => x.includes(frag)) || payload.api_root || "#";
  host.innerHTML =
    sectionItems(payload, "balance", u("/portfolio/balance")) +
    sectionItems(payload, "positions", u("/portfolio/positions")) +
    sectionItems(payload, "fills", u("/portfolio/fills")) +
    sectionItems(payload, "settlements", u("/portfolio/settlements"));
}

main();
