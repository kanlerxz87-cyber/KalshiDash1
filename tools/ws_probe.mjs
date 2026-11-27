#!/usr/bin/env node
/* ws_probe.mjs — measure, on a machine that actually has egress, whether an ANONYMOUS client can
 * open the Kalshi demo WebSocket endpoint and subscribe to public market data.
 *
 * WHY THIS EXISTS
 * ---------------
 * The published site claims in several places (F-02, F-33, F-51, executive summary, questions)
 * that "the WebSocket handshake requires API-key authentication, so a static page cannot stream
 * ticks". Every one of those claims is documented, not measured: F-33 says outright that the
 * "live WebSocket path is not exercised". The repository's precedent for such claims is to
 * MEASURE them on a GitHub Actions runner and commit the raw evidence — that is exactly what
 * `tools/cors_probe.mjs` did for the CORS claims (F-01/F-51/F-66).
 *
 * WHAT IT MEASURES (per documented demo host)
 * -------------------------------------------
 *   1. An anonymous WebSocket upgrade request — the exact request a browser `new WebSocket(url)`
 *      sends (Connection/Upgrade/Sec-WebSocket-Version/Sec-WebSocket-Key plus an Origin header),
 *      with NO `KALSHI-ACCESS-*` headers and no signature anywhere.
 *      Recorded: the HTTP status line, response headers, body snippet and latency.
 *      Per the official docs a rejected handshake "returns an HTTP error instead of upgrading",
 *      so a 401 here is a SUCCESSFUL transport measurement, not a probe failure.
 *   2. If — and only if — the upgrade succeeded, the documented subscribe-first flow is spoken
 *      over RFC6455 frames (masked client frames, unmasked server frames, ping→pong, close):
 *      `{"cmd":"subscribe","params":{"channels":["ticker"]}}` exactly as the official
 *      Quick Start shows, then `list_subscriptions`, then up to 5 live ticker events for 5 s,
 *      then a polite close. Every response is recorded verbatim (truncated).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It never reads, requests or logs credentials of any kind; it never sends a signature; it never
 * touches a private channel; it never places, signs or simulates an order; and it refuses to run
 * against anything except the two documented DEMO WebSocket hosts (DEMO-ONLY guard, same spirit
 * as `tools/demo_trader.mjs`). Loopback is allowed only for `--selftest`, which runs the whole
 * probe against local fixture servers (one that rejects the upgrade, one that accepts it and
 * speaks frames) with negative controls, so the parsing/handshake logic is testable offline.
 *
 * SOURCES (official, fetched 2026-11-27):
 *   Demo hosts + mock funds:  https://docs.kalshi.com/getting_started/demo_env
 *   WS handshake auth:        https://docs.kalshi.com/getting_started/quick_start_websockets
 *   WS commands/responses:    https://docs.kalshi.com/websockets/websocket-connection
 *   RFC6455 framing:          https://www.rfc-editor.org/rfc/rfc6455
 *
 * USAGE
 *   node tools/ws_probe.mjs [--out data/ws-probe.json]
 *   node tools/ws_probe.mjs --selftest          (offline; loopback fixture servers only)
 * Exit codes: 0 = measurement completed (whatever it found) / selftest passed; 1 = the probe
 * itself could not run, or the selftest failed.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/* ---------------------------------------------------------------- constants */

const DEMO_WS_HOSTS = ['external-api-ws.demo.kalshi.co', 'demo-api.kalshi.co'];
const DEMO_WS_PATH = '/trade-api/ws/v2';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // RFC6455 §1.3
const SITE_ORIGIN = 'https://kanlerxz87-cyber.github.io';
const USER_AGENT = 'kalshidash1-ws-probe (+https://github.com/kanlerxz87-cyber/KalshiDash1)';

const HOST_ROLES = {
  'external-api-ws.demo.kalshi.co': {
    role: 'recommended demo WebSocket host',
    sources: [
      'https://docs.kalshi.com/getting_started/quick_start_websockets',
      'https://docs.kalshi.com/getting_started/demo_env',
    ],
  },
  'demo-api.kalshi.co': {
    role: 'legacy shared demo WebSocket host ("remain supported")',
    sources: [
      'https://docs.kalshi.com/getting_started/quick_start_websockets',
      'https://docs.kalshi.com/getting_started/demo_env',
    ],
  },
};

/* RFC6455 opcodes */
const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

const UPGRADE_TIMEOUT_MS = 10_000;
const CMD_WAIT_MS = 8_000;
const EVENTS_WINDOW_MS = 5_000;
const CLOSE_WAIT_MS = 3_000;
const MAX_EVENTS = 5;
const SNIPPET = 300;
const MAX_FRAME_BUFFER = 1 << 20;

/* ------------------------------------------------------------- DEMO-ONLY guard */

function isLoopback(hostname) {
  return ['127.0.0.1', '::1', 'localhost'].includes(hostname.toLowerCase());
}

/** Refuse anything that is not one of the two documented demo WebSocket hosts.
 *  Loopback is accepted only when the caller passes {allowLoopback:true} (selftest). */
function assertProbeUrl(rawUrl, { allowLoopback = false, anyPath = false } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('DEMO-ONLY: not a valid URL'); }
  const host = url.hostname.toLowerCase();
  const loopback = isLoopback(host);
  if (url.username || url.password) throw new Error('DEMO-ONLY: credentials in the URL are refused');
  if (loopback && allowLoopback) {
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error('DEMO-ONLY: loopback probe must use ws: or wss:');
    }
    return url;
  }
  if (!DEMO_WS_HOSTS.includes(host)) {
    throw new Error(`DEMO-ONLY host guard: refused "${host}" — only the documented demo WebSocket hosts (${DEMO_WS_HOSTS.join(', ')}) may be probed`);
  }
  if (url.protocol !== 'wss:') throw new Error('DEMO-ONLY: demo hosts must be probed over wss:');
  if (!anyPath && url.pathname !== DEMO_WS_PATH) {
    throw new Error(`DEMO-ONLY: refusing path "${url.pathname}" — the documented path is ${DEMO_WS_PATH}`);
  }
  return url;
}

/* ------------------------------------------------------------------ frames */

/** Build one masked client frame (RFC6455 §5.3: all client frames are masked). */
function encodeClientFrame(opcode, payload = Buffer.alloc(0)) {
  const mask = randomBytes(4);
  let header;
  const len = payload.length;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | len]);
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([header, mask, masked]);
}

/** Incremental parser for server→client frames. Yields {opcode, payload} per frame. */
function createFrameParser(onFrame, { onProtocolError } = {}) {
  let buf = Buffer.alloc(0);
  const fragments = [];
  let fragmentOpcode = null;
  return function push(chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > MAX_FRAME_BUFFER) {
      if (onProtocolError) onProtocolError('frame buffer exceeded 1 MiB');
      return;
    }
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME_BUFFER)) {
          if (onProtocolError) onProtocolError('declared frame length exceeded 1 MiB');
          return;
        }
        len = Number(big); offset = 10;
      }
      let maskKey = null;
      if (masked) {
        if (buf.length < offset + 4) return;
        maskKey = buf.subarray(offset, offset + 4); offset += 4;
      }
      if (buf.length < offset + len) return;
      const payload = Buffer.from(buf.subarray(offset, offset + len));
      buf = buf.subarray(offset + len);
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];

      if (opcode === OP.CONT) {
        if (fragmentOpcode === null) { if (onProtocolError) onProtocolError('continuation without a started message'); return; }
        fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(fragments);
          const op = fragmentOpcode;
          fragments.length = 0; fragmentOpcode = null;
          onFrame({ opcode: op, payload: full });
        }
        continue;
      }
      if (opcode >= OP.CLOSE) { // control frames may interleave; never fragmented
        onFrame({ opcode, payload });
        continue;
      }
      if (!fin) { fragmentOpcode = opcode; fragments.push(payload); continue; }
      onFrame({ opcode, payload });
    }
  };
}

/* ------------------------------------------------------- HTTP upgrade client */

function rawUpgradeRequest(url, timeoutMs, { origin = true } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const transport = url.protocol === 'https:' ? https : http;
    const key = randomBytes(16).toString('base64');
    const headers = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key,
      // browsers always attach Origin; this is the published site's origin. The `origin:false`
      // diagnostic variant (which no browser can produce) is recorded as diagnostic-only.
      ...(origin ? { Origin: SITE_ORIGIN } : {}),
      'User-Agent': USER_AGENT,
      // Deliberately NO KALSHI-ACCESS-KEY / -SIGNATURE / -TIMESTAMP: the measured question is
      // whether the anonymous upgrade succeeds. The tool holds no credentials at all.
    };
    const req = transport.request({
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
    });
    let settled = false;
    // Manual timeout (not the request's `timeout:` option): on the upgraded path that option
    // would arm a socket timer that could kill the live session later.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch {}
      resolve({ upgraded: false, error: `upgrade timed out after ${timeoutMs} ms`, headers: {}, ms: Date.now() - started, sec_websocket_key: key });
    }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.upgraded) { try { req.destroy(); } catch {} } // never destroy the upgraded session socket
      resolve({ ...result, ms: Date.now() - started, sec_websocket_key: key });
    };

    req.on('upgrade', (res, socket, head) => {
      const expectedAccept = createHash('sha1').update(key + WS_GUID).digest('base64');
      finish({
        upgraded: true,
        http_status: res.statusCode,
        status_message: res.statusMessage,
        headers: pickHeaders(res.headers),
        sec_websocket_accept_matches: res.headers['sec-websocket-accept'] === expectedAccept,
        socket, head,
      });
    });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.reduce((n, b) => n + b.length, 0) < SNIPPET * 4) chunks.push(c); });
      res.on('end', () => finish({
        upgraded: false,
        http_status: res.statusCode,
        status_message: res.statusMessage,
        headers: pickHeaders(res.headers),
        body_snippet: Buffer.concat(chunks).toString('utf8').slice(0, SNIPPET),
      }));
      res.on('error', (err) => finish({ upgraded: false, error: 'response error: ' + err.message }));
    });
    req.on('error', (err) => { if (!settled) finish({ upgraded: false, error: err.message }); });
    req.end();
  });
}

const HEADER_ALLOWLIST = [
  'server', 'cf-ray', 'cf-cache-status', 'cf-mitigated', 'content-type', 'content-length',
  'connection', 'upgrade', 'sec-websocket-accept', 'sec-websocket-extensions', 'date',
  'access-control-allow-origin', 'access-control-allow-credentials', 'vary', 'cache-control',
  'strict-transport-security', 'x-content-type-options', 'via',
  'location', 'x-cache', 'x-amz-cf-id', 'x-amz-cf-pop',
];
function pickHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (HEADER_ALLOWLIST.includes(k.toLowerCase())) out[k.toLowerCase()] = String(v);
  }
  return out;
}

/* ------------------------------------------------------- post-upgrade session */

/** Speak the documented subscribe-first flow over an upgraded socket. */
function runAnonymousSession(url, upgrade, { commandWaitMs = CMD_WAIT_MS, eventsWindowMs = EVENTS_WINDOW_MS } = {}) {
  return new Promise((resolve) => {
    const socket = upgrade.socket;
    const transcript = { messages: [], sent: [], errors: [], protocol_errors: [] };
    let pendingResolve = (r) => resolve(r);
    const finish = (extra) => {
      if (!pendingResolve) return;
      const r = { ...transcript, ...extra };
      pendingResolve(r); pendingResolve = null;
      try { socket.destroy(); } catch {}
    };
    const hardStop = setTimeout(() => finish({ timed_out: true }), commandWaitMs * 3 + eventsWindowMs + 3_000);

    const closeInfo = { code: null, reason: null, received_close_frame: false, sent_close_frame: false };
    const parser = createFrameParser(handleFrame, { onProtocolError: (m) => { transcript.protocol_errors.push(m); finishFromError(); } });
    if (upgrade.head && upgrade.head.length) parser(upgrade.head); // bytes buffered before the session started
    socket.on('data', (chunk) => parser(chunk));
    socket.on('error', (err) => { transcript.errors.push('socket error: ' + err.message); finishFromError(); });
    socket.on('close', () => { /* handled via explicit finish */ });

    let step = 'start';
    const waiters = [];

    function finishFromError() {
      clearTimeout(hardStop);
      finish({ ...closeInfo, ended_by: 'error' });
    }

    function expect(predicate, then) {
      const timer = setTimeout(() => then.timeout(), commandWaitMs);
      const w = { predicate, then, timer };
      waiters.push(w);
      return w;
    }

    function send(obj, label) {
      const text = JSON.stringify(obj);
      transcript.sent.push({ label, text: text.slice(0, SNIPPET) });
      socket.write(encodeClientFrame(OP.TEXT, Buffer.from(text, 'utf8')));
    }

    function sendClose() {
      if (closeInfo.sent_close_frame) return;
      closeInfo.sent_close_frame = true;
      try { socket.write(encodeClientFrame(OP.CLOSE, encodeClosePayload(1000, 'probe complete'))); } catch {}
      const timer = setTimeout(() => {
        clearTimeout(hardStop);
        finish({ ...closeInfo, ended_by: closeInfo.received_close_frame ? 'closed_by_both' : 'closed_by_probe' });
      }, CLOSE_WAIT_MS);
      expect((m) => m.opcode === OP.CLOSE, {
        timeout: () => {}, timer,
        hit: (m) => {
          closeInfo.received_close_frame = true;
          const parsed = parseClosePayload(m.payload);
          closeInfo.code = parsed.code; closeInfo.reason = parsed.reason;
          clearTimeout(timer); clearTimeout(hardStop);
          finish({ ...closeInfo, ended_by: 'closed_by_both' });
        },
      });
    }

    function handleFrame(frame) {
      if (frame.opcode === OP.PING) {
        socket.write(encodeClientFrame(OP.PONG, frame.payload));
        return;
      }
      if (frame.opcode === OP.PONG) return;
      if (frame.opcode === OP.CLOSE) {
        closeInfo.received_close_frame = true;
        const parsed = parseClosePayload(frame.payload);
        closeInfo.code = parsed.code; closeInfo.reason = parsed.reason;
        try { socket.write(encodeClientFrame(OP.CLOSE, frame.payload)); } catch {}
        clearTimeout(hardStop);
        finish({ ...closeInfo, ended_by: closeInfo.sent_close_frame ? 'closed_by_both' : 'closed_by_server' });
        return;
      }
      const text = frame.opcode === OP.TEXT ? frame.payload.toString('utf8') : null;
      const parsedJson = text !== null ? tryParseJson(text) : null;
      const record = {
        at_ms: Date.now(),
        text: text !== null ? text.slice(0, SNIPPET) : `<binary ${frame.payload.length} bytes>`,
        json: parsedJson,
      };
      if (transcript.messages.length < 40) transcript.messages.push(record);

      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.predicate(record)) {
          waiters.splice(i, 1);
          w.then.hit(record, w);
          return;
        }
      }

      // Free-running event collection once subscribed.
      if (step === 'events' && parsedJson && parsedJson.type && parsedJson.type !== 'error') {
        if (transcript.events.length < MAX_EVENTS) transcript.events.push(record);
      }
    }

    transcript.events = [];

    // Step 1: documented subscribe command (Quick Start: "Once connected, subscribe to
    // channels by sending a subscription command") — anonymous session, public ticker channel.
    step = 'subscribe';
    send({ id: 1, cmd: 'subscribe', params: { channels: ['ticker'] } }, 'subscribe(ticker)');
    expect(
      (m) => m.json && (m.json.id === 1 || m.json.type === 'error'),
      {
        timeout: () => {
          transcript.errors.push('no response to subscribe within ' + commandWaitMs + ' ms');
          sendClose();
        },
        hit: (m, w) => {
          transcript.subscribe_response = m;
          transcript.subscribed = !!(m.json && m.json.type === 'subscribed');
          clearTimeout(w.timer);
          if (!transcript.subscribed) { sendClose(); return; }
          // Step 2: list what the anonymous session holds.
          step = 'list';
          send({ id: 2, cmd: 'list_subscriptions' }, 'list_subscriptions');
          expect(
            (mm) => mm.json && (mm.json.id === 2 || mm.json.type === 'error'),
            {
              timeout: () => { transcript.list_timed_out = true; startEvents(); },
              hit: (mm, ww) => { transcript.list_subscriptions_response = mm; clearTimeout(ww.timer); startEvents(); },
            },
          );
          function startEvents() {
            // Step 3: collect live public events for a bounded window, then close politely.
            step = 'events';
            setTimeout(() => sendClose(), eventsWindowMs);
          }
        },
      },
    );
  });
}

function encodeClosePayload(code, reason) {
  const b = Buffer.from(reason, 'utf8');
  const out = Buffer.alloc(2 + b.length);
  out.writeUInt16BE(code & 0xffff, 0);
  b.copy(out, 2);
  return out;
}
function parseClosePayload(payload) {
  if (payload.length < 2) return { code: null, reason: '' };
  return { code: payload.readUInt16BE(0), reason: payload.subarray(2).toString('utf8').slice(0, 120) };
}
function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/* ------------------------------------------------------------------ probe */

async function probeHost(rawUrl, { allowLoopback = false, commandWaitMs, eventsWindowMs, upgradeTimeoutMs = UPGRADE_TIMEOUT_MS } = {}) {
  const firstUrl = assertProbeUrl(rawUrl, { allowLoopback });
  const result = {
    url: rawUrl,
    host_role: isLoopback(firstUrl.hostname) ? 'loopback selftest fixture' : (HOST_ROLES[firstUrl.hostname.toLowerCase()] || {}).role || null,
    official_sources: isLoopback(firstUrl.hostname) ? [] : (HOST_ROLES[firstUrl.hostname.toLowerCase()] || {}).sources || [],
    attempts: [],
    anonymous_handshake: null,
    post_upgrade: null,
    verdict: null,
  };

  // Attempt queue: one browser-faithful attempt (with Origin); if the host never answers
  // (timeout/unreachable) one polite retry, then one diagnostic attempt without the Origin
  // header (labelled diagnostic — a browser always sends Origin). Any 3xx whose Location is
  // still a documented demo host is followed ONCE (never credentials, never a foreign host).
  const pending = [{ url: rawUrl, variant: 'origin' }];
  let attemptNo = 0;
  let followedChain = false;
  while (pending.length && attemptNo < 4) {
    const job = pending.shift();
    attemptNo += 1;
    let jobUrl;
    try {
      jobUrl = job.prevalidated ? new URL(job.url) : assertProbeUrl(job.url, { allowLoopback, anyPath: !!job.anyPath });
    } catch (err) {
      if (attemptNo === 1 && !job.prevalidated) throw err; // misuse of the tool: fail loudly
      result.attempts.push({
        attempt: attemptNo, requested_url: String(job.url), variant: job.variant, note: job.note || null,
        upgraded: false, http_status: null, status_message: null, headers: {}, body_snippet: null,
        sec_websocket_accept_matches: null, error: 'DEMO-ONLY guard rejected follow target: ' + err.message, ms: 0,
      });
      result.anonymous_handshake = result.attempts[result.attempts.length - 1];
      continue;
    }
    const up = await rawUpgradeRequest(jobUrl, upgradeTimeoutMs, { origin: job.variant !== 'no_origin' });
    const entry = {
      attempt: attemptNo,
      requested_url: job.url,
      variant: job.variant,
      note: job.note || null,
      upgraded: up.upgraded === true,
      http_status: up.http_status ?? null,
      status_message: up.status_message ?? null,
      headers: up.headers || {},
      body_snippet: up.body_snippet ?? null,
      sec_websocket_accept_matches: up.sec_websocket_accept_matches ?? null,
      error: up.error ?? null,
      ms: up.ms,
      __socket: up.socket || null,
      __head: up.head || null,
    };

    if (entry.upgraded) {
      result.attempts.push(entry);
      result.anonymous_handshake = entry;
      break;
    }

    // Redirect? Record the target; follow it only into a documented demo host.
    const loc = entry.headers['location'];
    if (entry.http_status && entry.http_status >= 300 && entry.http_status < 400 && loc) {
      entry.redirect_location = loc;
      try {
        const target = new URL(loc, jobUrl);
        if (target.username || target.password) {
          entry.follow_blocked_by = 'DEMO-ONLY guard: redirect target carries credentials';
        } else {
          const demoHost = allowLoopback
            ? isLoopback(target.hostname) // selftest fixtures redirect within loopback only
            : DEMO_WS_HOSTS.includes(target.hostname.toLowerCase());
          // A wss→https 301 is common (the upgrade request over TLS gets a plain HTTP answer),
          // so follow jobs may use wss OR https on demo hosts; ws/http only in loopback selftests.
          const schemeOk = allowLoopback
            ? ['ws:', 'wss:'].includes(target.protocol)
            : ['wss:', 'https:'].includes(target.protocol);
          if (demoHost && schemeOk) {
            entry.followed_to = target.toString();
            if (!followedChain) {
              followedChain = true;
              pending.unshift({ url: target.toString(), variant: job.variant, prevalidated: true, note: 'followed 3xx Location (one hop max)' });
            } else {
              entry.follow_blocked_by = 'redirect chain already followed once';
            }
          } else {
            entry.follow_blocked_by = 'DEMO-ONLY guard: redirect target is not a documented demo host (or its scheme is refused)';
          }
        }
      } catch {
        entry.follow_blocked_by = 'invalid redirect Location';
      }
    } else if (entry.error) {
      // Unresponsive host: one retry, then the no-Origin diagnostic (only for the primary attempt).
      if (job.variant === 'origin' && !job.retried) {
        pending.unshift({ url: job.url, variant: 'origin', retried: true, note: `retry after: ${entry.error}` });
      } else if (job.variant === 'origin' && job.retried) {
        pending.push({ url: job.url, variant: 'no_origin', note: 'diagnostic only — browsers always send Origin on the WebSocket handshake; this checks whether Origin-based filtering (not authentication) caused the silence' });
      }
    }
    result.attempts.push(entry);
    result.anonymous_handshake = entry;
  }

  if (result.anonymous_handshake && result.anonymous_handshake.upgraded) {
    const handshake = result.anonymous_handshake;
    const upgrade = { socket: handshake.__socket, head: handshake.__head };
    const session = await runAnonymousSession(firstUrl, upgrade, { commandWaitMs, eventsWindowMs });
    result.post_upgrade = session;
    result.verdict = session.subscribed
      ? 'handshake_upgraded_subscription_accepted'
      : (session.subscribe_response ? 'handshake_upgraded_subscription_rejected' : 'handshake_upgraded_no_subscribe_response');
  } else {
    const last = result.anonymous_handshake || {};
    result.verdict = last.error
      ? 'unreachable_or_timed_out'
      : `handshake_rejected_http_${last.http_status ?? 'unknown'}`;
  }
  // never serialize the live sockets
  for (const a of result.attempts) { delete a.__socket; delete a.__head; }
  return result;
}

function buildReport(results) {
  const accepted = results.filter((r) => r.anonymous_handshake && r.anonymous_handshake.upgraded);
  return {
    probe: 'anonymous demo WebSocket handshake measurement',
    why: 'Turns the documented WS-authentication limitation (F-02/F-33/F-51) into a measured fact; a static page cannot stream ticks unless an anonymous handshake is accepted, so that is what is measured.',
    generated_at: new Date().toISOString(),
    probe_origin: SITE_ORIGIN,
    no_credentials_sent: true,
    signature_headers_sent: [],
    orders_placed: 0,
    private_channels_touched: [],
    protocol_sources: [
      'https://docs.kalshi.com/getting_started/quick_start_websockets',
      'https://docs.kalshi.com/websockets/websocket-connection',
      'https://docs.kalshi.com/getting_started/demo_env',
      'https://www.rfc-editor.org/rfc/rfc6455',
    ],
    runner: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      workflow_run: process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null,
      commit: process.env.GITHUB_SHA || null,
    },
    hosts: results,
    summary: {
      anonymous_handshake_accepted_on_any_demo_host: accepted.length > 0,
      hosts_measured: results.length,
      hosts_rejected_anonymous_upgrade: results.filter((r) => r.anonymous_handshake && !r.anonymous_handshake.upgraded && !r.anonymous_handshake.error).length,
      hosts_unreachable: results.filter((r) => r.anonymous_handshake && r.anonymous_handshake.error).length,
      note: accepted.length > 0
        ? 'An anonymous handshake WAS accepted: a static page could stream at least the subscribed public channel — any published claim that streaming is impossible for a keyless page must be corrected.'
        : results.every((r) => r.anonymous_handshake && r.anonymous_handshake.error)
          ? 'No verdict: every documented demo host was unreachable from this machine (no TCP/TLS connection). Re-run the probe from a host with egress — the ws-probe workflow does this on GitHub runners.'
          : 'Every reachable documented demo host rejected the anonymous upgrade with an HTTP error instead of upgrading: measured confirmation of the official docs statement that WebSocket connections require authentication during the handshake.',
    },
  };
}

/* ---------------------------------------------------------------- selftest */

async function selftest() {
  const assert = (await import('node:assert/strict')).default;
  let checks = 0;
  const ok = (label) => { checks++; console.log('ok   ' + label); };

  // 1. DEMO-ONLY host guard, negative controls.
  for (const bad of [
    'wss://external-api-ws.kalshi.com/trade-api/ws/v2',      // production host
    'wss://api.elections.kalshi.com/trade-api/ws/v2',        // production legacy host
    'wss://evil.invalid/trade-api/ws/v2',
    'ws://external-api-ws.demo.kalshi.co/trade-api/ws/v2',   // insecure scheme on a demo host
    'wss://external-api.demo.kalshi.co/trade-api/v2',        // wrong path
    'wss://user:pw@external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    'not a url',
  ]) {
    assert.throws(() => assertProbeUrl(bad), /DEMO-ONLY/, `guard accepted ${bad}`);
  }
  ok('DEMO-ONLY guard rejects production/insecure/wrong-path/credentialed URLs');

  // 2. Rejecter fixture: the upgrade must be measured as an HTTP rejection.
  const rejecter = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', message: 'fixture: anonymous handshake rejected' }));
  });
  rejecter.on('upgrade', (req, socket) => { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); });
  await new Promise((r) => rejecter.listen(0, '127.0.0.1', r));
  const rejUrl = 'ws://127.0.0.1:' + rejecter.address().port + DEMO_WS_PATH;
  const rej = await probeHost(rejUrl, { allowLoopback: true, commandWaitMs: 500, eventsWindowMs: 100 });
  assert.equal(rej.anonymous_handshake.upgraded, false, 'rejecter fixture was upgraded (negative control failed)');
  assert.equal(rej.anonymous_handshake.http_status, 401);
  assert.equal(rej.verdict, 'handshake_rejected_http_401');
  ok('rejecter fixture measured as HTTP 401 with verdict handshake_rejected_http_401');
  rejecter.close();

  // 3. Accepter fixture: real 101 upgrade + frame-level subscribe/list/event/close flow.
  const accepter = http.createServer((req, res) => { res.writeHead(500); res.end(); });
  accepter.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n',
    );
    const sendServer = (opcode, payload) => socket.write(encodeServerFrame(opcode, Buffer.from(payload, 'utf8')));
    const parser = createFrameParser((frame) => {
      if (frame.opcode === OP.PING) { socket.write(encodeServerFrame(OP.PONG, frame.payload)); return; }
      if (frame.opcode === OP.CLOSE) { socket.write(encodeServerFrame(OP.CLOSE, frame.payload)); socket.end(); return; }
      if (frame.opcode !== OP.TEXT) return;
      let msg; try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { return; }
      if (msg.cmd === 'subscribe') {
        sendServer(OP.TEXT, JSON.stringify({ id: msg.id, type: 'subscribed', sending_ts_ms: 1, msg: { channel: 'ticker', sid: 7 } }));
      } else if (msg.cmd === 'list_subscriptions') {
        sendServer(OP.TEXT, JSON.stringify({ id: msg.id, type: 'ok', sending_ts_ms: 3, msg: [{ channel: 'ticker', sid: 7 }] }));
        // Send the fixture ticker event AFTER the list response so the probe is already inside
        // its bounded events window (deterministic ordering for the assertion below).
        setTimeout(() => sendServer(OP.TEXT, JSON.stringify({ type: 'ticker', seq: 1, sending_ts_ms: 2, msg: { market_ticker: 'FIXTURE-1', yes_bid_dollars: 41, yes_ask_dollars: 43 } })), 30);
      } else {
        sendServer(OP.TEXT, JSON.stringify({ id: msg.id ?? null, type: 'error', sending_ts_ms: 4, msg: { code: 1, msg: 'fixture: unexpected command' } }));
      }
    });
    socket.on('data', (c) => parser(c));
    socket.on('error', () => {});
  });
  await new Promise((r) => accepter.listen(0, '127.0.0.1', r));
  const accUrl = 'ws://127.0.0.1:' + accepter.address().port + DEMO_WS_PATH;
  const acc = await probeHost(accUrl, { allowLoopback: true, commandWaitMs: 2000, eventsWindowMs: 300 });
  assert.equal(acc.anonymous_handshake.upgraded, true, 'accepter fixture did not upgrade');
  assert.equal(acc.anonymous_handshake.sec_websocket_accept_matches, true, 'Sec-WebSocket-Accept mismatch');
  assert.equal(acc.post_upgrade.subscribed, true, 'subscribe was not accepted by the accepter fixture');
  assert.ok(acc.post_upgrade.events.length >= 1, 'no ticker event captured by the probe');
  assert.ok(acc.post_upgrade.list_subscriptions_response, 'list_subscriptions response missing');
  assert.equal(acc.post_upgrade.ended_by, 'closed_by_both', 'close handshake did not complete');
  ok('accepter fixture: upgrade 101 verified, subscribe/list/event/close recorded, close completed by both sides');

  // 3b. Redirecter fixture: a 3xx whose Location is another allowed (loopback) target is followed
  //     exactly once, and the session then completes on the target.
  const redirecter = http.createServer((req, res) => { res.writeHead(500); res.end(); });
  redirecter.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 301 Moved Permanently\r\nLocation: ws://127.0.0.1:' + accepter.address().port + '/trade-api/ws/v2\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  });
  await new Promise((r) => redirecter.listen(0, '127.0.0.1', r));
  const red = await probeHost('ws://127.0.0.1:' + redirecter.address().port + '/trade-api/ws/v2', { allowLoopback: true, upgradeTimeoutMs: 1500, commandWaitMs: 2000, eventsWindowMs: 100 });
  assert.equal(red.attempts[0].http_status, 301, 'redirecter fixture did not 301');
  assert.equal(red.attempts[0].redirect_location.includes('/trade-api/ws/v2'), true, 'redirect Location not recorded');
  assert.equal(red.attempts.length, 2, 'redirect was not followed exactly one hop');
  assert.equal(red.attempts[1].upgraded, true, 'followed target did not upgrade');
  assert.equal(red.post_upgrade.subscribed, true, 'session after redirect did not subscribe');
  assert.equal(red.verdict, 'handshake_upgraded_subscription_accepted');
  ok('redirecter fixture: 301 Location recorded, followed once, session completed on the target');
  redirecter.close();

  // 3c. Foreign redirect: the DEMO-ONLY guard must block following a non-demo target.
  const foreign = http.createServer((req, res) => { res.writeHead(500); res.end(); });
  foreign.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 301 Moved Permanently\r\nLocation: http://evil.invalid/not-demo\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  });
  await new Promise((r) => foreign.listen(0, '127.0.0.1', r));
  const fore = await probeHost('ws://127.0.0.1:' + foreign.address().port + '/trade-api/ws/v2', { allowLoopback: true, upgradeTimeoutMs: 1500, commandWaitMs: 1000, eventsWindowMs: 100 });
  assert.equal(fore.attempts.length, 1, 'foreign redirect was followed (negative control failed)');
  assert.match(fore.attempts[0].follow_blocked_by || '', /DEMO-ONLY/);
  assert.equal(fore.verdict, 'handshake_rejected_http_301');
  ok('foreign redirect target refused by the DEMO-ONLY guard, never followed');
  foreign.close();

  // 3d. Silent host (accepts TCP, never answers): one retry, then the labelled no-Origin
  //     diagnostic — and the verdict stays "unreachable", never "accepted".
  const silent = net.createServer((sock) => { sock.on('error', () => {}); }); // never writes
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  const sil = await probeHost('ws://127.0.0.1:' + silent.address().port + '/trade-api/ws/v2', { allowLoopback: true, upgradeTimeoutMs: 300, commandWaitMs: 300, eventsWindowMs: 50 });
  assert.equal(sil.attempts.length, 3, 'expected timeout→retry→no-Origin diagnostic, got ' + sil.attempts.length);
  assert.ok(sil.attempts.every((a) => a.error && !a.upgraded), 'an attempt on the silent fixture reported success');
  assert.equal(sil.attempts[2].variant, 'no_origin');
  assert.equal(sil.verdict, 'unreachable_or_timed_out');
  ok('silent fixture: timeout retry + labelled no-Origin diagnostic recorded, verdict unreachable_or_timed_out');
  silent.close();

  // 4. Structural guarantees: the report can never claim orders/credentials.
  const report = buildReport([acc]);
  assert.equal(report.no_credentials_sent, true);
  assert.equal(report.orders_placed, 0);
  assert.equal(report.signature_headers_sent.length, 0);
  assert.equal(report.summary.anonymous_handshake_accepted_on_any_demo_host, true);
  ok('report structure: no_credentials_sent=true, orders_placed=0, no signature headers');

  // 5. Poisoned-environment negative control: even with credential-looking env vars set, nothing
  //    may appear in the tool's output — the tool reads no credential environment variables.
  const sentinel = 'SYNTHETIC-DO-NOT-LOG-THIS';
  process.env.KALSHI_KEY_ID = sentinel;
  process.env.KALSHI_PRIVATE_KEY_PATH = sentinel;
  const acc2 = await probeHost(accUrl, { allowLoopback: true, commandWaitMs: 2000, eventsWindowMs: 100 });
  const acc2Text = JSON.stringify(acc2);
  assert.ok(!acc2Text.includes(sentinel), 'sentinel credential leaked into probe output (negative control failed)');
  delete process.env.KALSHI_KEY_ID;
  delete process.env.KALSHI_PRIVATE_KEY_PATH;
  ok('poisoned credential environment never reaches probe output');
  accepter.close();

  console.log(`ws_probe selftest: ${checks} checks passed`);
}

/** Server→client frames are unmasked (RFC6455 §5.1); used only by selftest fixtures. */
function encodeServerFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65_536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

/* -------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    await selftest();
    return;
  }
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : 'data/ws-probe.json';
  const targets = DEMO_WS_HOSTS.map((h) => `wss://${h}${DEMO_WS_PATH}`);

  const results = [];
  for (const url of targets) {
    process.stdout.write(`probing ${url} ... `);
    try {
      const r = await probeHost(url);
      results.push(r);
      console.log(r.verdict + (r.anonymous_handshake.error ? ` (${r.anonymous_handshake.error})` : ''));
    } catch (err) {
      // A refused URL or a crash is a probe malfunction, not a measurement — surface it.
      console.error('probe error for ' + url + ': ' + err.message);
      process.exitCode = 1;
      return;
    }
  }
  const report = buildReport(results);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log('summary: ' + JSON.stringify(report.summary));
  console.log('evidence written to ' + out);
}

main().catch((err) => { console.error(err && err.stack ? err.stack : err); process.exitCode = 1; });
