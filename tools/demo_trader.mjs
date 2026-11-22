#!/usr/bin/env node
/*
 * demo_trader.mjs — real Kalshi DEMO-account portfolio tracking and trade execution.
 *
 * Session: session-d5b935f4 · Contracts verified in verification/2026-11-20-d5b935f4.md
 * (C-3 create order, C-8 authenticated reads). Official sources:
 *   https://docs.kalshi.com/getting_started/quick_start_create_order.md
 *   https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md
 *   https://docs.kalshi.com/getting_started/api_keys.md
 *   https://docs.kalshi.com/getting_started/order_errors.md
 *
 * No dependencies (Node 18+). Credentials come ONLY from the environment:
 *   KALSHI_KEY_ID          API key id
 *   KALSHI_PRIVATE_KEY     PEM private key content, or
 *   KALSHI_PRIVATE_KEY_B64 base64 of the PEM content, or
 *   KALSHI_PRIVATE_KEY_PATH path to the PEM file (local use)
 *   KALSHI_API_ROOT        optional override (default: official demo API)
 * Keys are never printed, logged, or written to any file.
 *
 * Usage:
 *   node tools/demo_trader.mjs status
 *   node tools/demo_trader.mjs account [--print] [--ci]
 *   node tools/demo_trader.mjs buy    --ticker T --side bid|ask --count N --price P [--dry-run|--confirm-live]
 *   node tools/demo_trader.mjs cancel --order-id ORDER_ID --ticker MARKET_TICKER [--dry-run|--confirm-live]
 *
 * Safety: `buy` and `cancel` are ALWAYS dry-run unless `--confirm-live` is passed.
 * `account` writes data/account.json (verbatim API responses + source URLs) when keys are present.
 * `--ci` makes `account` exit 0 and stay quiet when keys are absent (scheduled workflow mode).
 *
 * This trades the DEMO environment (mock funds). Demo prices "may not be reflective of those in
 * real markets": https://docs.kalshi.com/getting_started/demo_env . Not financial advice.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/* Hard safety boundary, not merely a default. Validate before loading any key or making
 * any request. Never echo a rejected value: it could contain embedded credentials. */
export function normalizeDemoRoot(value) {
  let u;
  try { u = new URL(value); } catch { /* same non-sensitive error below */ }
  if (!u || u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash
      || !["external-api.demo.kalshi.co", "demo-api.kalshi.co"].includes(u.hostname)
      || !/^\/trade-api\/v2\/?$/.test(u.pathname)) {
    throw new Error("DEMO-ONLY: API root must be one of Kalshi's two official HTTPS demo /trade-api/v2 roots; refused before credentials or network use.");
  }
  return u.origin + "/trade-api/v2";
}
const API_ROOT = normalizeDemoRoot(process.env.KALSHI_API_ROOT || "https://external-api.demo.kalshi.co/trade-api/v2");
const here = dirnameSafe(fileURLToPath(import.meta.url));
const REPO = path.join(here, "..");
const DATA_DIR = path.join(REPO, "data");

function dirnameSafe(p) { return path.dirname(p); }

/* ---------------- credentials (environment only) ---------------- */
function loadKey() {
  const keyId = process.env.KALSHI_KEY_ID;
  if (!keyId) return null;
  let pem = process.env.KALSHI_PRIVATE_KEY;
  if (!pem && process.env.KALSHI_PRIVATE_KEY_B64) pem = Buffer.from(process.env.KALSHI_PRIVATE_KEY_B64, "base64").toString("utf8");
  if (!pem && process.env.KALSHI_PRIVATE_KEY_PATH) pem = fs.readFileSync(process.env.KALSHI_PRIVATE_KEY_PATH, "utf8");
  if (!pem) return null;
  return { keyId, key: crypto.createPrivateKey(pem) };
}

/* Signature: base64 of RSA-PSS(SHA-256) or Ed25519 over `timestamp + METHOD + path`
 * (path from root, e.g. /trade-api/v2/portfolio/events/orders). Timestamp in MILLISECONDS.
 * Verified against quick_start_create_order.md + quick_start_authenticated_requests.md,
 * and matching scripts/fetch_snapshot.mjs in this repo. */
export function sign(key, timestamp, method, pathname) {
  const msg = Buffer.from(timestamp + method + pathname);
  if (key.asymmetricKeyType === "ed25519") return crypto.sign(null, msg, key).toString("base64");
  return crypto.sign("sha256", msg, {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

export function apiPathname(p) {
  // full path from root for signing, e.g. /trade-api/v2/portfolio/balance
  return new URL(API_ROOT + p).pathname;
}

async function callAuth(creds, method, p, body) {
  const pathname = apiPathname(p);
  const ts = String(Date.now()); // milliseconds (C-3)
  const headers = {
    "KALSHI-ACCESS-KEY": creds.keyId,
    "KALSHI-ACCESS-SIGNATURE": sign(creds.key, ts, method, pathname),
    "KALSHI-ACCESS-TIMESTAMP": ts,
    accept: "application/json",
  };
  let payload;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(API_ROOT + p, { method, headers, body: payload, redirect: "error", signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, ok: res.ok, json, text, url: API_ROOT + p };
}

async function callPublic(p) {
  const res = await fetch(API_ROOT + p, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, ok: res.ok, json, text, url: API_ROOT + p };
}

/* ---------------- commands ---------------- */
function keyFingerprint(keyId) {
  const h = crypto.createHash("sha256").update(String(keyId)).digest("hex").slice(0, 8);
  return `sha256:${h}… (id length ${String(keyId).length}; id never printed)`;
}

async function cmdStatus(args) {
  console.log(`API root: ${API_ROOT}`);
  const creds = loadKey();
  console.log(`Credentials: ${creds ? `present (${keyFingerprint(creds.keyId)})` : "absent — account/buy/cancel need KALSHI_KEY_ID + KALSHI_PRIVATE_KEY[_B64|_PATH]"}`);
  const st = await callPublic("/exchange/status");
  if (st.ok && st.json) {
    console.log(`GET /exchange/status → ${st.status} (source: ${st.url})`);
    console.log(`  exchange_active=${st.json.exchange_active} trading_active=${st.json.trading_active}`);
  } else {
    console.log(`GET /exchange/status → ${st.status} ${String(st.text).slice(0, 200)}`);
    process.exitCode = 1;
  }
}

async function cmdAccount(args) {
  const ci = args.includes("--ci");
  const print = args.includes("--print");
  const creds = loadKey();
  if (!creds) {
    const msg = "not connected: KALSHI_KEY_ID / KALSHI_PRIVATE_KEY not set in the environment";
    if (ci) { console.log(`demo-account: ${msg} (no-op)`); return; }
    console.log(`demo_trader: ${msg}`);
    console.log("See docs/DEMO_ACCOUNT.md. Nothing was written.");
    process.exitCode = 1;
    return;
  }
  const out = await captureAccount(creds);
  if (print) console.log(JSON.stringify(out, null, 2).slice(0, 4000));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, "account.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(REPO, file)} (responses; keys not stored; connected=${out.connected})`);
  if (!out.connected) process.exitCode = 1;
}

/* Validate the minimum documented envelope, not the full semantics of individual trades.
 * Empty arrays and zero balances are valid; missing, wrongly typed or unsafe numeric fields
 * are not evidence of an authenticated account. Response bodies remain unmodified on success.
 * https://docs.kalshi.com/api-reference/portfolio/get-balance
 * https://docs.kalshi.com/api-reference/portfolio/get-positions
 * https://docs.kalshi.com/api-reference/portfolio/get-fills
 * https://docs.kalshi.com/api-reference/portfolio/get-settlements */
function validAccountEnvelope(name, value) {
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

/* Separate the capture from persistence so HTTP failures can be tested entirely offline.
 * A timestamped attempt is not a successful authenticated account connection. */
export async function captureAccount(creds, request = callAuth) {
  const paths = ["/portfolio/balance", "/portfolio/positions", "/portfolio/fills?limit=200", "/portfolio/settlements?limit=200"];
  const out = {
    captured_at: null,
    attempted_at: new Date().toISOString(),
    environment: "demo",
    api_root: API_ROOT,
    connected: false,
    key_fingerprint: keyFingerprint(creds.keyId),
    source_urls: paths.map((p) => API_ROOT + p),
    disclaimer: "Verbatim demo-account API responses captured by tools/demo_trader.mjs. Each list is a first page, not a complete performance history. Demo environment only; values may not reflect real markets (https://docs.kalshi.com/getting_started/demo_env).",
  };
  for (const p of paths) {
    const name = p.split("?")[0].split("/").pop();
    let r;
    try {
      r = await request(creds, "GET", p);
    } catch {
      // Do not echo transport exceptions: they could contain request details. Return a
      // disconnected attempt for the CLI to write locally; workflow publication is separate.
      console.error(`GET ${p} → transport failure: authenticated account data unverified`);
      out[name] = { error: true, status: null, reason: "Request failed; account data unverified." };
      continue;
    }
    if (!r || !r.ok || r.status !== 200) {
      console.error(`GET ${p} → ${r?.status ?? "unknown"}: authenticated account data unverified`);
      out[name] = { error: true, status: r?.status ?? null, body: String(r?.text ?? "").slice(0, 500) };
      continue;
    }
    if (!validAccountEnvelope(name, r.json)) {
      console.error(`GET ${p} → ${r.status}: required account response fields unverified`);
      out[name] = { error: true, status: r.status, reason: "Missing or invalid required response fields; account data unverified." };
      continue;
    }
    out[name] = r.json;
    console.log(`GET ${p} → ${r.status} (source: ${API_ROOT + p})`);
    if (request === callAuth) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  out.connected = ["balance", "positions", "fills", "settlements"].every((key) => out[key] && !out[key].error);
  // The four calls are sequential, not an atomic account snapshot.
  if (out.connected) out.captured_at = new Date().toISOString();
  return out;
}

export function mutationRequested(args) {
  if (args.includes("--dry-run") && args.includes("--confirm-live")) {
    throw new Error("Conflicting --dry-run and --confirm-live flags; nothing sent.");
  }
  return args.includes("--confirm-live");
}

export function orderBody(args) {
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const ticker = get("--ticker");
  const side = get("--side"); // "bid" = buy YES, "ask" = sell YES (quick-start example posts side:"bid")
  const count = get("--count");
  const price = get("--price");
  if (!ticker || !["bid", "ask"].includes(side) || !count || !price) {
    console.error("buy requires --ticker, --side bid|ask, --count N, --price P (price as decimal string, e.g. 0.3500)");
    process.exit(2);
  }
  if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) <= 0) {
    throw new Error("--count must be a positive, safe whole number; nothing sent.");
  }
  if (!/^\d+(\.\d{1,4})?$/.test(price) || !Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) >= 1) {
    throw new Error("This tool requires a binary price strictly between $0 and $1 with at most four decimal places; no rounding or fill is assumed.");
  }
  const priceStr = Number(price).toFixed(4); // representation only; market-specific tick grid is still validated by the exchange
  return {
    ticker,
    side,
    count: Number(count).toFixed(2),
    price: priceStr,
    time_in_force: "good_till_canceled",
    self_trade_prevention_type: "taker_at_cross",
    client_order_id: `kd1-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
  };
}

async function cmdBuy(args) {
  const live = mutationRequested(args);
  const body = orderBody(args);
  console.log(`POST ${API_ROOT}/portfolio/events/orders`);
  console.log(JSON.stringify(body, null, 2));
  if (!live) {
    console.log("DRY RUN — nothing was sent. Re-run with --confirm-live to place this order on the demo exchange.");
    return;
  }
  const creds = loadKey();
  if (!creds) { console.error("no credentials in environment (KALSHI_KEY_ID / KALSHI_PRIVATE_KEY)"); process.exit(1); }
  const r = await callAuth(creds, "POST", "/portfolio/events/orders", body);
  console.log(`→ HTTP ${r.status}`);
  console.log(JSON.stringify(r.json ?? r.text, null, 2).slice(0, 2000));
  if (r.status === 201) console.log("Accepted (not necessarily resting — check remaining_count; quick_start_create_order.md).");
  else process.exitCode = 1;
}

async function cmdCancel(args) {
  const live = mutationRequested(args);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const orderId = get("--order-id");
  const ticker = get("--ticker");
  const validArg = (v) => typeof v === "string" && v.trim() === v && v.length > 0 && !v.startsWith("--");
  if (!validArg(orderId) || [".", ".."].includes(orderId) || !validArg(ticker)) {
    throw new Error("cancel requires --order-id ORDER_ID and --ticker MARKET_TICKER; nothing sent.");
  }
  // Order creation auto-routes by ticker. Canceling by order ID alone defaults to shard 0;
  // require the ticker as well so cancellation can route to the order's exchange shard.
  // https://docs.kalshi.com/api-reference/orders/cancel-order-v2
  const p = `/portfolio/events/orders/${encodeURIComponent(orderId)}?${new URLSearchParams({ market_ticker: ticker })}`;
  console.log(`DELETE ${API_ROOT}${p}`);
  if (!live) { console.log("DRY RUN — nothing was sent. Re-run with --confirm-live to cancel on the demo exchange."); return; }
  const creds = loadKey();
  if (!creds) { console.error("no credentials in environment"); process.exit(1); }
  const r = await callAuth(creds, "DELETE", p);
  console.log(`→ HTTP ${r.status} ${String(r.text).slice(0, 500)}`);
  if (!r.ok) process.exitCode = 1;
}

/* ---------------- main ---------------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "status") await cmdStatus(args);
    else if (cmd === "account") await cmdAccount(args);
    else if (cmd === "buy") await cmdBuy(args);
    else if (cmd === "cancel") await cmdCancel(args);
    else {
      console.log("usage: node tools/demo_trader.mjs status|account|buy|cancel  (see header comment)");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`demo_trader: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  }
}
