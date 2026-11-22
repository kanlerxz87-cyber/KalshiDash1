#!/usr/bin/env node
/** Demo-only boundary and signing tests. OFFLINE fixtures, no API credentials or orders. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';
import { normalizeDemoRoot, mutationRequested, orderBody, sign, apiPathname, captureAccount } from '../tools/demo_trader.mjs';

let checks = 0;
function check(label, fn) { fn(); checks++; console.log('ok   ' + label); }
const before = readFileSync('data/account.json', 'utf8');
const primary = 'https://external-api.demo.kalshi.co/trade-api/v2';
const alternate = 'https://demo-api.kalshi.co/trade-api/v2';
for (const url of [primary, alternate, primary + '/']) {
  check('official demo root accepted: ' + url, () => assert.equal(normalizeDemoRoot(url), url.replace(/\/$/, '')));
}
for (const url of [
  'https://external-api.kalshi.com/trade-api/v2', 'https://api.elections.kalshi.com/trade-api/v2',
  'https://example.org/trade-api/v2', 'http://external-api.demo.kalshi.co/trade-api/v2',
  primary + '/portfolio', primary + '?redirect=example.org', primary + '#demo',
  'https://user:DO-NOT-LOG-THIS@external-api.demo.kalshi.co/trade-api/v2',
  'https://external-api.demo.kalshi.co:444/trade-api/v2',
  'https://external-api.demo.kalshi.co.evil.invalid/trade-api/v2', '',
]) {
  check('non-demo, credential-bearing or altered root rejected', () => {
    assert.throws(() => normalizeDemoRoot(url), /DEMO-ONLY/);
  });
}
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('KALSHI_')));
check('CLI refuses production BEFORE opening a key file or sending a request', () => {
  const child = spawnSync(process.execPath, ['tools/demo_trader.mjs', 'status'], {
    env: { ...childEnv, KALSHI_API_ROOT: 'https://external-api.kalshi.com/trade-api/v2', KALSHI_KEY_ID: 'SYNTHETIC-NOT-A-KEY', KALSHI_PRIVATE_KEY_PATH: '/does-not-exist-offline-test' },
    encoding: 'utf8', timeout: 3000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /DEMO-ONLY/);
  assert.doesNotMatch(child.stderr, /ENOENT|fetch failed/);
});
check('rejected API root error never echoes embedded credentials', () => {
  const child = spawnSync(process.execPath, ['tools/demo_trader.mjs', 'status'], {
    env: { ...childEnv, KALSHI_API_ROOT: 'https://user:DO-NOT-LOG-THIS@external-api.demo.kalshi.co/trade-api/v2' }, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(child.status, 1); assert.doesNotMatch(child.stderr + child.stdout, /DO-NOT-LOG-THIS/);
});
check('default and explicit dry runs cannot become mutating calls', () => {
  assert.equal(mutationRequested([]), false); assert.equal(mutationRequested(['--dry-run']), false);
  assert.equal(mutationRequested(['--confirm-live']), true);
  assert.throws(() => mutationRequested(['--confirm-live', '--dry-run']), /Conflicting/);
});
const args = (count = '5', price = '0.35') => ['--ticker', 'SYNTHETIC-TEST', '--side', 'bid', '--count', count, '--price', price];
check('V2 body uses documented fixed-point strings and required order fields', () => {
  const body = orderBody(args());
  assert.equal(body.count, '5.00'); assert.equal(body.price, '0.3500'); assert.equal(body.side, 'bid');
  assert.equal(body.time_in_force, 'good_till_canceled'); assert.equal(body.self_trade_prevention_type, 'taker_at_cross');
});
for (const count of ['0', '-1', '1.5', '9007199254740992', 'NaN']) {
  check('invalid whole count rejected: ' + count, () => assert.throws(() => orderBody(args(count)), /positive/));
}
for (const price of ['0', '1', '-0.1', '1.1', '0.12345', 'Infinity', 'NaN']) {
  check('invalid or silently rounded binary price rejected: ' + price, () => assert.throws(() => orderBody(args('1', price)), /strictly between/));
}
check('signing path includes /trade-api/v2 and excludes the query', () => {
  assert.equal(apiPathname('/portfolio/fills?limit=200'), '/trade-api/v2/portfolio/fills');
  assert.equal(apiPathname('/portfolio/events/orders/order-123?market_ticker=TEST-TICKER'), '/trade-api/v2/portfolio/events/orders/order-123');
});
check('cancel dry run supplies the market ticker for exchange-shard auto-routing', () => {
  const child = spawnSync(process.execPath, ['tools/demo_trader.mjs', 'cancel', '--order-id', 'offline-id', '--ticker', 'TEST-TICKER', '--dry-run'], { env: childEnv, encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  const url = new URL(child.stdout.split('\n')[0].replace(/^DELETE /, ''));
  assert.equal(url.pathname, '/trade-api/v2/portfolio/events/orders/offline-id');
  assert.equal(url.searchParams.get('market_ticker'), 'TEST-TICKER');
  assert.equal(url.searchParams.has('exchange_index'), false);
  assert.match(child.stdout, /DRY RUN/);
});
check('cancel encodes the ticker as one query value, never an injected routing parameter', () => {
  const child = spawnSync(process.execPath, ['tools/demo_trader.mjs', 'cancel', '--order-id', 'offline-id', '--ticker', 'TICKER&exchange_index=0', '--dry-run'], { env: childEnv, encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  const url = new URL(child.stdout.split('\n')[0].replace(/^DELETE /, ''));
  assert.equal(url.searchParams.get('market_ticker'), 'TICKER&exchange_index=0');
  assert.equal(url.searchParams.has('exchange_index'), false);
});
for (const bad of [
  ['--order-id', 'offline-id'],
  ['--order-id', 'offline-id', '--ticker', '--confirm-live'],
  ['--order-id', '..', '--ticker', 'TEST-TICKER'],
]) {
  check('cancel rejects missing or unsafe routing arguments before network access', () => {
    const child = spawnSync(process.execPath, ['tools/demo_trader.mjs', 'cancel', ...bad], { env: childEnv, encoding: 'utf8', timeout: 3000 });
    assert.notEqual(child.status, 0);
    assert.doesNotMatch(child.stdout + child.stderr, /fetch failed|→ HTTP/);
  });
}
const stamp = '1795298400000', pathname = '/trade-api/v2/portfolio/balance';
check('RSA-PSS signature verifies over timestamp + method + full path', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sig = Buffer.from(sign(privateKey, stamp, 'GET', pathname), 'base64');
  const options = { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST };
  assert.equal(crypto.verify('sha256', Buffer.from(stamp + 'GET' + pathname), options, sig), true);
  assert.equal(crypto.verify('sha256', Buffer.from(stamp + 'GET' + pathname + '?wrong=1'), options, sig), false);
});
check('Ed25519 signs the message directly, not a prehashed message', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const sig = Buffer.from(sign(privateKey, stamp, 'GET', pathname), 'base64');
  assert.equal(crypto.verify(null, Buffer.from(stamp + 'GET' + pathname), publicKey, sig), true);
});

const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('NETWORK FORBIDDEN IN OFFLINE TEST'); };
try {
  const creds = { keyId: 'SYNTHETIC-NOT-AN-API-KEY' };
  const failed = await captureAccount(creds, async () => ({ ok: false, status: 401, text: 'SYNTHETIC UNAUTHORIZED' }));
  check('four authentication failures cannot produce connected=true or a capture timestamp', () => {
    assert.equal(failed.connected, false); assert.equal(failed.captured_at, null); assert.ok(failed.attempted_at);
    assert.equal(failed.balance.error, true);
  });
  const fixtures = {
    '/portfolio/balance': { balance: 0, balance_dollars: '0.0000', portfolio_value: 0, updated_ts: 1795300000 },
    '/portfolio/positions': { market_positions: [], event_positions: [], cursor: '' },
    '/portfolio/fills?limit=200': { fills: [], cursor: '' },
    '/portfolio/settlements?limit=200': { settlements: [], cursor: '' },
  };
  const paths = [];
  const good = await captureAccount(creds, async (_c, method, path) => {
    paths.push(path); assert.equal(method, 'GET'); return { ok: true, status: 200, json: fixtures[path] };
  });
  check('schema-shaped empty lists and zero balances are valid, with exact source paths', () => {
    assert.equal(good.connected, true); assert.ok(good.captured_at);
    assert.equal(good.balance.balance, 0);
    assert.equal(paths.length, 4); assert.ok(paths.includes('/portfolio/fills?limit=200'));
    assert.equal(good.source_urls.length, 4); assert.ok(good.source_urls.every((url) => url.startsWith(primary)));
  });
  for (const [path, invalid] of [
    ['/portfolio/balance', {}],
    ['/portfolio/balance', { balance: 0, balance_dollars: '', portfolio_value: 0, updated_ts: 0 }],
    ['/portfolio/positions', { market_positions: [], event_positions: null }],
    ['/portfolio/fills?limit=200', { fills: [], cursor: null }],
    ['/portfolio/settlements?limit=200', { settlements: [{} , null] }],
  ]) {
    const bad = await captureAccount(creds, async (_c, _m, p) => ({ ok: true, status: 200, json: p === path ? invalid : fixtures[p] }));
    const name = path.split('?')[0].split('/').pop();
    check(`HTTP 200 with malformed ${name} stays disconnected and unverified`, () => {
      assert.equal(bad.connected, false); assert.equal(bad.captured_at, null); assert.equal(bad[name].error, true);
    });
  }
  const thrown = await captureAccount(creds, async (_c, _m, p) => {
    if (p === '/portfolio/balance') throw new Error('SYNTHETIC TRANSPORT FAILURE');
    return { ok: true, status: 200, json: fixtures[p] };
  });
  check('transport exceptions produce a disconnected attempt, not a successful or stale capture', () => {
    assert.equal(thrown.connected, false); assert.equal(thrown.captured_at, null); assert.equal(thrown.balance.error, true);
    assert.ok(!JSON.stringify(thrown).includes('SYNTHETIC TRANSPORT FAILURE'));
  });
  check('signed transport refuses redirects, rather than forwarding auth headers', () => {
    assert.match(readFileSync('tools/demo_trader.mjs', 'utf8'), /body: payload, redirect: "error"/);
  });
} finally { globalThis.fetch = savedFetch; }

// Render the connected state with invented fixtures; no real account is needed or published.
const fixture = {
  connected: true, captured_at: '2026-11-22T00:00:00Z', api_root: primary, environment: 'demo',
  key_fingerprint: 'offline-only',
  source_urls: ['/portfolio/balance', '/portfolio/positions', '/portfolio/fills?limit=200', '/portfolio/settlements?limit=200'].map((p) => primary + p),
  balance: { balance: 0, balance_dollars: '0.0000', portfolio_value: 0, updated_ts: 1795300000 },
  positions: { market_positions: [{ ticker: 'SYNTHETIC-POSITION', position_fp: '2.00' }], event_positions: [], cursor: '' },
  fills: { fills: [{ ticker: '<img src=x onerror=alert(1)>', count_fp: '2.00' }], cursor: 'MORE-PAGES' },
  settlements: { settlements: [{ ticker: 'SYNTHETIC-SETTLEMENT', market_result: 'yes' }], cursor: '' },
};
async function renderAccount(payload) {
  const dom = new JSDOM('<div id="conn-status"></div><div id="account-data"></div>', { url: 'https://example.test/demo-account.html', runScripts: 'outside-only' });
  dom.window.fetch = async () => ({ ok: true, json: async () => payload });
  dom.window.eval(readFileSync('assets/demo-account.js', 'utf8'));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  return dom;
}
const disconnectedDom = await renderAccount({ connected: false });
check('disconnected snapshots show no invented account rows', () => {
  assert.match(disconnectedDom.window.document.body.textContent, /not connected/i);
  assert.equal(disconnectedDom.window.document.querySelectorAll('#account-data tbody tr').length, 0);
});
disconnectedDom.window.close();
const dom = await renderAccount(fixture);
check('each rendered account data row carries its exact official endpoint, including zero balances', () => {
  const rows = [...dom.window.document.querySelectorAll('#account-data tbody tr')];
  assert.ok(rows.length >= 7, `expected expanded account rows, got ${rows.length}`);
  for (const row of rows) {
    const link = row.querySelector('a[href]');
    assert.ok(link, `data row missing source: ${row.textContent}`);
    assert.ok(fixture.source_urls.includes(link.href), `unapproved source: ${link.href}`);
  }
  const sourceFor = (text) => rows.find((row) => row.textContent.includes(text)).querySelector('a').href;
  assert.equal(sourceFor('0.0000'), fixture.source_urls[0]);
  assert.equal(sourceFor('SYNTHETIC-POSITION'), fixture.source_urls[1]);
  assert.equal(sourceFor('<img'), fixture.source_urls[2]);
  assert.equal(sourceFor('SYNTHETIC-SETTLEMENT'), fixture.source_urls[3]);
  assert.equal(dom.window.document.querySelector('#account-data img'), null);
  assert.match(dom.window.document.querySelector('#account-data').textContent, /additional page/i);
});
dom.window.close();
const alternateDom = await renderAccount({ ...fixture, api_root: alternate, source_urls: fixture.source_urls.map((url) => url.replace(primary, alternate)) });
check('alternate official demo root also renders with matching endpoint sources', () => {
  const rows = [...alternateDom.window.document.querySelectorAll('#account-data tbody tr')];
  assert.ok(rows.length >= 7);
  assert.ok(rows.every((row) => row.querySelector('a').href.startsWith(alternate + '/portfolio/')));
});
alternateDom.window.close();
for (const sourceUrls of [
  fixture.source_urls.slice(0, 3),
  fixture.source_urls.map((url) => url.replace('external-api.demo.kalshi.co', 'external-api.demo.kalshi.co.evil.invalid')),
  fixture.source_urls.map((url) => url.replace('?limit=200', '?limit=1')),
]) {
  const invalidDom = await renderAccount({ ...fixture, source_urls: sourceUrls });
  check('missing or lookalike endpoint provenance withholds account values and flags them', () => {
    const text = invalidDom.window.document.body.textContent;
    assert.match(text, /unverified/i);
    assert.doesNotMatch(text, /SYNTHETIC-POSITION|0\.0000/);
  });
  invalidDom.window.close();
}
for (const badPayload of [
  { ...fixture, balance: {} },
  { ...fixture, captured_at: null },
  { ...fixture, positions: { market_positions: [], event_positions: null } },
]) {
  const invalidDom = await renderAccount(badPayload);
  check('old connected snapshots with invalid envelopes or timestamps are withheld', () => {
    assert.match(invalidDom.window.document.body.textContent, /unverified/i);
    assert.doesNotMatch(invalidDom.window.document.body.textContent, /SYNTHETIC-POSITION|0\.0000/);
  });
  invalidDom.window.close();
}
check('offline test never writes account fixtures to the published data', () => assert.equal(readFileSync('data/account.json', 'utf8'), before));
console.log(`\ndemo-only safety: ${checks} offline checks passed. No authenticated exchange call or order was made.`);
