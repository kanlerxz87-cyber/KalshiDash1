#!/usr/bin/env node
/* cors_probe.mjs — measure what a BROWSER would be allowed to read from the Kalshi demo Trade API.
 *
 * WHY THIS EXISTS
 * ---------------
 * Flag F-01 (and its duplicate F-51) has been on the Flagged for Review page since 2026-11-20:
 *   "Browser access (CORS) to the demo API could not be tested from the build sandbox."
 * It matters because every "live" surface of the published site either reads the demo API from the
 * visitor's browser or falls back to the committed snapshot in `data/`. If the exchange does not
 * send a permissive `Access-Control-Allow-Origin`, then no visitor ever sees live data, and the site
 * must say so (it currently does, at runtime, via its data-mode badge — but the pages still describe
 * live reads as the normal path).
 *
 * The build sandbox has no egress to `external-api.demo.kalshi.co` (curl: SSL_ERROR_SYSCALL,
 * ECONNRESET), so this cannot be answered from there. A GitHub Actions runner does have egress —
 * `tools/live_engine.mjs` samples the same host every run — so the measurement is taken there and
 * the raw response headers are committed as `data/cors-probe.json`.
 *
 * WHAT IT MEASURES (and what it deliberately does not claim)
 * ---------------------------------------------------------
 * CORS is decided by response headers. A browser blocks the *reading* of a cross-origin response
 * unless the response carries `Access-Control-Allow-Origin` matching the page origin (or `*`, with
 * no credentials). So this script sends the exact requests the site's JavaScript sends, with the
 * exact `Origin` the published site uses, and records:
 *   * the response status,
 *   * `access-control-allow-origin`, `-credentials`, `-expose-headers`, `-max-age`, `-methods`,
 *     `-headers`, and `vary`,
 *   * the access-control headers seen for the OPTIONS preflight a browser sends before a request
 *     that uses custom headers (the signed demo-account requests) or a non-simple method.
 *
 * It does NOT prove what any individual visitor's network does (a corporate proxy or extension can
 * still block the host), and it does not log in: the authenticated routes are probed without
 * credentials on purpose, to see whether the *transport* is readable, and a 401 is a successful
 * transport measurement, not a failure.
 *
 * Node's fetch does not enforce CORS, which is exactly what is wanted here: it lets the raw headers
 * be read and recorded instead of being hidden by the browser's own enforcement.
 *
 * SOURCES (official):
 *   Demo host and mock funds: https://docs.kalshi.com/getting_started/demo_env
 *   Browser CORS semantics:   https://fetch.spec.whatwg.org/#http-cors-protocol
 *   Signed browser requests:  https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
 *
 * USAGE
 *   node tools/cors_probe.mjs [--out data/cors-probe.json]
 * Exit codes: 0 = measurement completed (whatever it found), 1 = the probe itself could not run.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
const SITE_ORIGIN = 'https://kanlerxz87-cyber.github.io';
const SECOND_ORIGIN = 'http://localhost:8000';
const AC = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
  'vary',
];

function outPath() {
  const i = process.argv.indexOf('--out');
  return i > -1 ? process.argv[i + 1] : 'data/cors-probe.json';
}

function pick(headers) {
  const o = {};
  for (const k of AC) {
    const v = headers.get(k);
    if (v !== null) o[k] = v;
  }
  return o;
}

/* The requests are the ones the site actually issues. An endpoint that needs a demo key is probed
 * without one: the point is the transport (headers), and 401 is recorded as such. */
const GETS = [
  { name: 'exchange_status', url: `${BASE}/exchange/status` },
  { name: 'markets_limit_1', url: `${BASE}/markets?limit=1` },
  { name: 'series_culture', url: `${BASE}/series?category=Culture&include_volume=true` },
  { name: 'orderbook', url: `${BASE}/markets/KXPRESNOMD-28-AKLO/orderbook?depth=5` },
  { name: 'trades_by_ticker', url: `${BASE}/markets/trades?ticker=KXPRESNOMD-28-AKLO&limit=5` },
  { name: 'candlesticks_1m', url: `${BASE}/series/KXPRESNOMD/markets/KXPRESNOMD-28-AKLO/candlesticks?start_ts=1795000000&end_ts=1795090000&period_interval=1` },
  { name: 'portfolio_balance_no_key', url: `${BASE}/portfolio/balance` },
];

/* Preflights a browser sends before the two shapes of request the site makes that are not
 * "simple": a signed GET (custom KALSHI-ACCESS-* headers — demo-account.html) and a POST order. */
const PREFLIGHTS = [
  {
    name: 'preflight_signed_get',
    url: `${BASE}/portfolio/balance`,
    method: 'GET',
    headers: 'kalshi-access-key,kalshi-access-signature,kalshi-access-timestamp',
  },
  {
    name: 'preflight_post_order',
    url: `${BASE}/portfolio/orders`,
    method: 'POST',
    headers: 'content-type,kalshi-access-key,kalshi-access-signature,kalshi-access-timestamp',
  },
];

async function timed(fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e), ms: Date.now() - t0 };
  }
}

const ATTEMPTS = 3;
const TIMEOUT_MS = 15000;

async function get(url, origin) {
  return timed(async () => {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Origin: origin, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Read the body so the connection is measured end to end; the body is not published.
    const text = await res.text();
    return {
      status: res.status,
      headers: pick(res.headers),
      content_type: res.headers.get('content-type'),
      ratelimit: {
        limit: res.headers.get('x-ratelimit-limit'),
        remaining: res.headers.get('x-ratelimit-remaining'),
        reset: res.headers.get('x-ratelimit-reset'),
      },
      body_bytes: text.length,
    };
  });
}

async function preflight(spec, origin) {
  return timed(async () => {
    const res = await fetch(spec.url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': spec.method,
        'Access-Control-Request-Headers': spec.headers,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, headers: pick(res.headers) };
  });
}

function readable(headers) {
  const acao = headers && headers['access-control-allow-origin'];
  if (!acao) return { allowed: false, why: 'no access-control-allow-origin header' };
  if (acao.trim() === '*') return { allowed: true, why: 'wildcard' };
  if (acao === SITE_ORIGIN) return { allowed: true, why: 'origin echoed' };
  return { allowed: false, why: `ACAO is "${acao}", which does not match ${SITE_ORIGIN}` };
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    probe_origin: SITE_ORIGIN,
    secondary_origin: SECOND_ORIGIN,
    base_url: BASE,
    runner: {
      os: process.env.RUNNER_OS || null,
      image: process.env.ImageOS || null,
      workflow_run: process.env.GITHUB_RUN_ID || null,
      commit: process.env.GITHUB_SHA || null,
      node: process.version,
    },
    results: [],
    preflights: [],
  };

  for (const spec of GETS) {
    /* A single failed request is not a finding: the demo host is rate-limited and one request in
     * the first probe timed out while its neighbours answered in ~300 ms. Retry before concluding
     * anything, and record how many attempts it took either way. */
    let r = await get(spec.url, SITE_ORIGIN);
    let attempts = 1;
    while (r.error && attempts < ATTEMPTS) {
      attempts++;
      await new Promise((res) => setTimeout(res, 1500 * attempts));
      r = await get(spec.url, SITE_ORIGIN);
    }
    const verdict = r.error ? { allowed: null, why: `request failed after ${attempts} attempts` } : readable(r.headers);
    report.results.push({ name: spec.name, url: spec.url, attempts, ...r, readable_from_browser: verdict });
    console.log(`${spec.name.padEnd(24)} ${r.error ? 'ERROR ' + r.error : 'HTTP ' + r.status} ` +
      `acaO=${r.headers ? r.headers['access-control-allow-origin'] ?? '(none)' : '(n/a)'} ` +
      `-> ${verdict.allowed === null ? 'unknown' : verdict.allowed ? 'READABLE' : 'BLOCKED'}`);
  }

  /* One request with a second origin, to tell "wildcard" from "echo": if the ACAO changes with the
   * Origin header, the server echoes; if it stays `*`, it is a true wildcard. */
  const echo = await get(`${BASE}/exchange/status`, SECOND_ORIGIN);
  report.echo_test = {
    origin: SECOND_ORIGIN,
    status: echo.status,
    headers: echo.headers || null,
    error: echo.error || null,
    acao_changes_with_origin:
      !echo.error && !!echo.headers && echo.headers['access-control-allow-origin'] === SECOND_ORIGIN,
  };

  for (const spec of PREFLIGHTS) {
    const r = await preflight(spec, SITE_ORIGIN);
    const allow = r.headers ? r.headers['access-control-allow-methods'] : null;
    const allowHeaders = r.headers ? r.headers['access-control-allow-headers'] : null;
    report.preflights.push({
      name: spec.name,
      url: spec.url,
      requested_method: spec.method,
      requested_headers: spec.headers,
      ...r,
      allows_method: allow ? allow.toLowerCase().includes(spec.method.toLowerCase()) : false,
      allows_requested_headers: allowHeaders
        ? spec.headers.split(',').every((h) => allowHeaders.toLowerCase().includes(h.trim()))
        : false,
    });
    console.log(`${spec.name.padEnd(24)} ${r.error ? 'ERROR ' + r.error : 'HTTP ' + r.status} ` +
      `methods=${allow ?? '(none)'} headers=${allowHeaders ?? '(none)'}`);
  }

  const publicGets = report.results.filter((r) => r.name !== 'portfolio_balance_no_key');
  const known = publicGets.filter((r) => r.readable_from_browser.allowed !== null);
  report.summary = {
    public_gets_probed: publicGets.length,
    public_gets_readable: publicGets.filter((r) => r.readable_from_browser.allowed === true).length,
    all_public_gets_conclusive: known.length === publicGets.length,
    browser_can_read_public_endpoints:
      known.length === publicGets.length ? publicGets.every((r) => r.readable_from_browser.allowed) : null,
    note: 'Readability is decided from the response headers only. A visitor whose network blocks the host ' +
      'still falls back to the committed snapshot; the site reports that at runtime.',
  };
  console.log('\nSUMMARY ' + JSON.stringify(report.summary, null, 1));

  const out = outPath();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${out}`);

  /* A probe that could not reach the host at all is not a measurement; say so instead of writing a
   * misleading "blocked" verdict. */
  if (report.results.every((r) => r.error)) {
    console.error('All requests failed to complete — no CORS measurement was possible.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
