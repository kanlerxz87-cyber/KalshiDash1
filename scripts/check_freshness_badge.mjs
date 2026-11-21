#!/usr/bin/env node
/**
 * check_freshness_badge.mjs — prove the header badge reports the *measured* age of the engine
 * sample, and that it degrades to STALE instead of lying.
 *
 * This is the QA for the honesty guarantee added in session-f7490df7. It loads the real
 * published pages into jsdom, feeds them real feed payloads with controlled timestamps, and
 * asserts the badge text/class. Without this, "the site never claims to be live on its own"
 * would be a sentence in a README rather than a checked property.
 *
 * Runs offline. Skips cleanly when jsdom is not installed (CI installs it via `npm install`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.log('check_freshness_badge: jsdom not installed — skipping (CI installs it).');
  process.exit(0);
}

const PAGES = [
  ['index.html', ''],
  ['dashboard.html', ''],
  ['categories/golf.html', '../'],
  ['alerts/index.html', '../']
];

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass += 1; else fails.push(label); };

function feedWith(iso) {
  return JSON.stringify({ meta: { generated_at: iso, engine: 'tools/live_engine.mjs' }, alerts: [], resolutions: [] });
}

const nowIso = () => new Date().toISOString();
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

/* jsdom has no XHR against the filesystem, so the module is exercised through a tiny shim that
 * serves the same two URLs the real page requests. This keeps the test offline and deterministic
 * while still running the *actual* shipped script, not a copy of its logic. */
function run(page, base, feedBody, opts = {}) {
  const html = readFileSync(page, 'utf8')
    /* strip the site's own app.js: it would probe the live API and is not what this test covers */
    .replace(/<script src="[^"]*assets\/app\.js"><\/script>/g, '')
    .replace(/<script src="js\/[^"]*"><\/script>/g, '')
    .replace(/<script src="\.\.\/assets\/freshness\.js"><\/script>/g, '')
    .replace(/<script src="assets\/freshness\.js"><\/script>/g, '');

  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/KalshiDash1/' });
  const { window } = dom;

  /* minimal XHR: enough for freshness.js (open / onreadystatechange / send) */
  const requests = [];
  window.XMLHttpRequest = class {
    constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; }
    open(method, url) { this._url = url; }
    send() {
      requests.push(this._url);
      const url = this._url;
      let body = null;
      let status = 404;
      if (/data\/dash-quality\.json/.test(url)) {
        body = JSON.stringify({ freshness: { warn_minutes: 20, stale_minutes: 45 } });
        status = opts.qualityMissing ? 404 : 200;
      } else if (/data\/live\/feed\.json/.test(url)) {
        body = feedBody;
        status = opts.feedMissing ? 503 : 200;
      }
      setTimeout(() => {
        this.readyState = 4;
        this.status = status;
        this.responseText = body || '';
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
      }, 0);
    }
  };

  window.eval(readFileSync('assets/freshness.js', 'utf8'));
  return new Promise((resolve) => {
    setTimeout(() => {
      const el = window.document.getElementById('feed-freshness');
      const asof = window.document.getElementById('feed-asof');
      resolve({
        el, text: el ? el.textContent : null, cls: el ? el.className : null, requests,
        asofText: asof ? asof.textContent : null,
        asofState: asof ? asof.getAttribute('data-state') : null,
      });
      /* The shipped script keeps a 30-second age tick alive for the visitor's benefit. That is
       * correct in a browser and wrong in a test runner, so each case closes its own window —
       * without this the checker hangs instead of exiting (measured: >120 s, exit 124). */
      try { dom.window.close(); } catch (e) { /* nothing left to close */ }
    }, 60);
  });
}

const badge = (r) => (r.el ? `${r.cls} | ${r.text}` : 'MISSING');
const asofStateFresh = (st) => st === 'fresh' || st === 'pending' || st === 'warn';

/* ---------------------------------------------------------------- assertions */
console.log('check_freshness_badge — the header must report the measured age, never a guess\n');

let results = 0;
for (const [page, base] of PAGES) {
  /* 1. fresh sample → green */
  const fresh = await run(page, base, feedWith(minutesAgo(2)));
  if (!fresh.el) { fails.push(`${page}: #feed-freshness element missing from the page`); continue; }
  ok(/badge live/.test(fresh.cls), `${page}: 2-minute-old feed must render as live, got "${badge(fresh)}"`);
  ok(/2 min ago|just now|1 min ago/.test(fresh.text), `${page}: fresh badge must state the age, got "${fresh.text}"`);
  ok(!/^engine …$/.test(fresh.text), `${page}: badge must not stay in the loading state`);

  /* 2. 30 minutes → amber warn */
  const warn = await run(page, base, feedWith(minutesAgo(30)));
  ok(/badge warn/.test(warn.cls), `${page}: 30-minute-old feed must render as warn, got "${badge(warn)}"`);
  ok(/30 min|29 min|31 min/.test(warn.text), `${page}: warn badge must state the age, got "${warn.text}"`);

  /* 3. 5 hours → STALE, said out loud */
  const stale = await run(page, base, feedWith(minutesAgo(300)));
  ok(/badge stale/.test(stale.cls), `${page}: 5-hour-old feed must render as stale, got "${badge(stale)}"`);
  ok(/STALE/.test(stale.text), `${page}: stale badge must contain the word STALE, got "${stale.text}"`);
  ok(/4\.9 h ago|5\.0 h ago|4\.9|300 min/.test(stale.text), `${page}: stale badge must state the age, got "${stale.text}"`);
  ok(/historical, not live/.test(stale.el.title || ''), `${page}: stale badge tooltip must say the feeds are historical`);

  /* 4. unreadable feed → must NOT claim live */
  const broken = await run(page, base, feedWith(nowIso()), { feedMissing: true });
  ok(/badge warn/.test(broken.cls), `${page}: unreadable feed must render as warn, got "${badge(broken)}"`);
  ok(/unreadable/.test(broken.text), `${page}: unreadable feed must say so, got "${broken.text}"`);
  ok(!/live/.test(broken.cls), `${page}: unreadable feed must never render as live`);
  results += 1;

  /* 4b. THE AS-OF LINE (added 2026-11-21). The badge ages in the browser, which is right for a
   * live visitor and useless in a screenshot or an archived copy — on 2026-11-21 the committed
   * feed was ~3 h old while the page still looked healthy. Every page must therefore carry a
   * visible, absolute as-of line, and it must say STALE out loud, not only in a tooltip. */
  const asofEl = fresh.asofText !== null;
  ok(asofEl, `${page}: #feed-asof element missing — the page must state WHEN its data is from`);
  if (asofEl) {
    ok(/Alert engine sampled|Data as of/i.test(fresh.asofText || ''), `${page}: as-of line must label itself, got "${fresh.asofText}"`);
    ok(/\d{4}-\d{2}-\d{2}/.test(fresh.asofText || ''), `${page}: as-of line must contain an absolute date/time, got "${fresh.asofText}"`);
    ok(/STALE/.test(stale.asofText || ''), `${page}: 5-hour-old data must print STALE in the as-of line, got "${stale.asofText}"`);
    ok(stale.asofState === 'stale', `${page}: as-of data-state must be "stale" for a 5-hour-old feed, got "${stale.asofState}"`);
    ok(asofStateFresh(fresh.asofState), `${page}: as-of data-state must be fresh/live for a 2-minute-old feed, got "${fresh.asofState}"`);
    ok(/unknown|could not be read/i.test(broken.asofText || ''), `${page}: unreadable feed must be stated in the as-of line, got "${broken.asofText}"`);
  }
}

/* 5. It reads only same-origin committed data — no third party, no API call. */
const probe = await run('index.html', '', feedWith(nowIso()));
const urls = probe.requests;
ok(urls.some((u) => /data\/live\/feed\.json/.test(u)), 'the badge must read data/live/feed.json');
ok(!urls.some((u) => /^https?:/.test(u)), `the badge must not call a third party, saw: ${urls.join(', ')}`);
ok(urls.every((u) => u.startsWith('data/') || u.startsWith('../data/') || u.startsWith('/')),
  'the badge requests must stay on the committed data paths');

/* 6. Deep-link support: ?topic= must reach a filter control when the page has one. */
const golfHtml = readFileSync('categories/golf.html', 'utf8');
ok(/data-topic="golf"/.test(golfHtml), 'category pages must carry data-topic so ?topic= can be honoured');
ok(/data-base="\.\.\/"/.test(golfHtml), 'category pages must carry data-base="../" for the badge');

console.log(`\nassertions passed: ${pass}`);
if (fails.length) {
  console.error(`FAILURES (${fails.length}):`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`check_freshness_badge: all ${pass} assertions passed across ${results} page(s) + deep-link checks.`);
