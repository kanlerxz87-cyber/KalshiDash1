#!/usr/bin/env node
/** Demo-only boundary and signing tests. OFFLINE fixtures, no API credentials or orders. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
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
});
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
  const paths = [];
  const good = await captureAccount(creds, async (_c, method, path) => {
    paths.push(path); assert.equal(method, 'GET'); return { ok: true, status: 200, json: { synthetic_fixture: true } };
  });
  check('successful mocked account reads retain the exact four source paths', () => {
    assert.equal(good.connected, true); assert.ok(good.captured_at);
    assert.equal(paths.length, 4); assert.ok(paths.includes('/portfolio/fills?limit=200'));
    assert.equal(good.source_urls.length, 4); assert.ok(good.source_urls.every((url) => url.startsWith(primary)));
  });
  check('signed transport refuses redirects, rather than forwarding auth headers', () => {
    assert.match(readFileSync('tools/demo_trader.mjs', 'utf8'), /body: payload, redirect: "error"/);
  });
} finally { globalThis.fetch = savedFetch; }
check('offline test never writes account fixtures to the published data', () => assert.equal(readFileSync('data/account.json', 'utf8'), before));
console.log(`\ndemo-only safety: ${checks} offline checks passed. No authenticated exchange call or order was made.`);
