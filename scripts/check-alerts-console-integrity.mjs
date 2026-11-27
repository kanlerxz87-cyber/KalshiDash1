#!/usr/bin/env node
/**
 * Offline positive/negative regression suite for:
 *   - F-ALERTS-01: finalized/settled/closed contracts excluded from live boards & polling budgets
 *   - F-ALERTS-02: alerts/index.html links -> ../market.html?ticker= + ?topic= deep-linking
 *   - F-HTML-01:   zero nested <a> tags in templates/canonical HTML and exact table column alignment
 *   - WS-probe integration: flagged.html (F-02/F-33/F-51), executive-summary.html, questions.html
 *     reflect the measured 2026-11-27 anonymous demo WebSocket handshake probe (data/ws-probe.json).
 *
 * Complements scripts/check-console-chart.mjs (F-CHART-02). Offline and synthetic-fixture based;
 * makes zero network calls.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  isLiveMarket,
  boardByTopic,
  topMarkets,
  topMarketsByTopic,
  slimHistory,
  collectOrderbooks,
  applySample,
} from '../tools/live_engine.mjs';

function emptyState() {
  return {
    meta: { generated_at: null },
    run: {},
    topics: {},
    markets: {},
    history: {},
    alerts: [],
    resolutions: [],
    settled_markets: {},
  };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok   ${name}`);
}
async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok   ${name}`);
}

/* ---------------- 1. F-ALERTS-01: engine-side live-market filtering ---------------- */

check('F-ALERTS-01: isLiveMarket accepts only active/initialized/empty-status rows without result', () => {
  assert.equal(isLiveMarket({ ticker: 'A', status: 'active', result: '' }), true);
  assert.equal(isLiveMarket({ ticker: 'B', status: 'initialized', result: null }), true);
  assert.equal(isLiveMarket({ ticker: 'C', status: '', result: '' }), true);
  for (const st of ['finalized', 'settled', 'closed', 'determined', 'disputed', 'amended', 'inactive']) {
    assert.equal(isLiveMarket({ ticker: 'X', status: st, result: '' }), false, `status=${st} must be excluded`);
  }
  for (const res of ['yes', 'no', 'scalar']) {
    assert.equal(isLiveMarket({ ticker: 'Y', status: 'active', result: res }), false, `result=${res} must be excluded`);
  }
  assert.equal(isLiveMarket(null), false);
});

const syntheticState = {
  ...emptyState(),
  markets: {
    'KXPGATOUR-THRC26-BHAR': {
      ticker: 'KXPGATOUR-THRC26-BHAR', topic: 'golf', title: 'RSM Classic: Brian Harman wins',
      status: 'finalized', result: 'no', price: 0.75, est_traded_dollars: 114896,
    },
    'KXPGATOUR-THRC26-MPEN': {
      ticker: 'KXPGATOUR-THRC26-MPEN', topic: 'golf', title: 'RSM Classic: Marco Penge wins',
      status: 'finalized', result: 'yes', price: 0.063, est_traded_dollars: 29111,
    },
    'KXDPWORLDTOUR-LIVE-1': {
      ticker: 'KXDPWORLDTOUR-LIVE-1', topic: 'golf', title: 'Live Golf Leader',
      status: 'active', result: '', price: 0.25, est_traded_dollars: 18000,
    },
    'KXAAAGASW-26NOV23-3.6200': {
      ticker: 'KXAAAGASW-26NOV23-3.6200', topic: 'gas', title: 'Nov 23 settled gas',
      status: 'finalized', result: 'no', price: 0.77, est_traded_dollars: 15063,
    },
    'KXAAAGASM-LIVE-1': {
      ticker: 'KXAAAGASM-LIVE-1', topic: 'gas', title: 'Live US gas contract',
      status: 'active', result: '', price: 0.45, est_traded_dollars: 9000,
    },
    'KXCLOSED-1': {
      ticker: 'KXCLOSED-1', topic: 'elections', title: 'Closed awaiting settlement',
      status: 'closed', result: '', price: 0.52, est_traded_dollars: 99999,
    },
  },
  history: {
    'KXPGATOUR-THRC26-BHAR': [[1700000000, 0.75], [1700000600, 0.75]],
    'KXDPWORLDTOUR-LIVE-1': [[1700000000, 0.24], [1700000600, 0.25]],
  },
};

check('F-ALERTS-01: boardByTopic, topMarkets, topMarketsByTopic and slimHistory exclude finalized/closed rows', () => {
  const bt = boardByTopic(syntheticState, 24);
  assert.deepEqual(bt.golf.rows.map((r) => r.ticker), ['KXDPWORLDTOUR-LIVE-1']);
  assert.deepEqual(bt.gas.rows.map((r) => r.ticker), ['KXAAAGASM-LIVE-1']);
  assert.deepEqual(bt.elections.rows.map((r) => r.ticker), []);

  const tm = topMarkets(syntheticState, 60);
  assert.deepEqual(tm.map((r) => r.ticker), ['KXDPWORLDTOUR-LIVE-1', 'KXAAAGASM-LIVE-1']);

  const tmt = topMarketsByTopic(syntheticState, 4);
  assert.deepEqual(tmt.map((r) => r.ticker).sort(), ['KXAAAGASM-LIVE-1', 'KXDPWORLDTOUR-LIVE-1']);

  const hist = slimHistory(syntheticState, 12);
  assert.ok(!hist['KXPGATOUR-THRC26-BHAR'], 'finalized contract must not enter slimHistory');
  assert.ok(hist['KXDPWORLDTOUR-LIVE-1'], 'live contract retains history');
});

await checkAsync('F-ALERTS-01: collectOrderbooks skips finalized contracts and queries only live markets', async () => {
  const requested = [];
  const mockClient = {
    base: 'https://external-api.demo.kalshi.co/trade-api/v2',
    async getJson(p) {
      requested.push(p);
      return { orderbook_fp: { yes_dollars: [['0.2400', '10.00']], no_dollars: [['0.7400', '10.00']] } };
    },
  };
  const books = await collectOrderbooks(mockClient, syntheticState, { maxMarkets: 8 });
  assert.equal(requested.some((p) => p.includes('KXPGATOUR-THRC26-BHAR')), false);
  assert.equal(requested.some((p) => p.includes('KXCLOSED-1')), false);
  assert.ok(books['KXDPWORLDTOUR-LIVE-1']);
  assert.ok(books['KXAAAGASM-LIVE-1']);
});

check('F-ALERTS-01: applySample retains pending non-finalized (closed/determined) markets past the 300-row cap for settlement reconciliation', () => {
  const base = emptyState();
  const now = 1795730000;
  base.markets['KXPENDING-DET'] = {
    ticker: 'KXPENDING-DET', topic: 'golf', title: 'Pending settlement',
    status: 'determined', result: '', price: 0.99, est_traded_dollars: 5,
    close_time: new Date((now - 3600) * 1000).toISOString(),
  };
  base.markets['KXFINAL-DROP'] = {
    ticker: 'KXFINAL-DROP', topic: 'golf', title: 'Already finalized non-alerted',
    status: 'finalized', result: 'no', price: 0.01, est_traded_dollars: 500000,
    close_time: new Date((now - 3600) * 1000).toISOString(),
  };
  const liveBatch = [];
  for (let i = 0; i < 310; i += 1) {
    liveBatch.push({
      topic: 'crypto',
      series: { ticker: 'KXTEST', title: 'Test', settlement_sources: [] },
      raw: {
        ticker: `KXLIVE-${i}`, title: `Live ${i}`, status: 'active', result: '',
        last_price_dollars: '0.5000', yes_bid_dollars: '0.4900', yes_ask_dollars: '0.5100',
        no_bid_dollars: '0.4900', no_ask_dollars: '0.5100',
        volume_fp: String(100 + i), volume_24h_fp: String(100 + i),
      },
    });
  }
  const next = applySample(base, { nowSeconds: now, markets: liveBatch, topicsFound: {}, runId: 'test' });
  assert.ok(next.markets['KXPENDING-DET'], 'non-finalized pending market stays in state.markets for collectDirectResolutions');
  assert.ok(!next.markets['KXFINAL-DROP'], 'unalerted finalized market does not occupy the 300-row active budget');
  assert.equal(boardByTopic(next, 24).golf.rows.length, 0, 'neither determined nor finalized rows enter live boardByTopic');
});

check('F-ALERTS-01: running boardByTopic/topMarkets/topMarketsByTopic on real committed state.json emits zero non-live rows', () => {
  const realState = JSON.parse(readFileSync('data/live/state.json', 'utf8'));
  const bt = boardByTopic(realState, 24);
  for (const [topic, obj] of Object.entries(bt)) {
    const bad = obj.rows.filter((r) => !isLiveMarket(r));
    assert.equal(bad.length, 0, `boardByTopic.${topic} emitted non-live rows: ${bad.map((r) => r.ticker).join(', ')}`);
  }
  assert.equal(topMarkets(realState, 60).filter((r) => !isLiveMarket(r)).length, 0);
  assert.equal(topMarketsByTopic(realState, 4).filter((r) => !isLiveMarket(r)).length, 0);
});

/* ---------------- 2. F-ALERTS-01/02: alerts/index.html DOM verification ---------------- */

await checkAsync('F-ALERTS-01/02: alerts/index.html hides finalized rows on topic tabs, links every row to ../market.html?ticker=, and syncs ?topic=golf', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const sixHoursAgo = nowSec - 6 * 3600;
  const staleIso = new Date(sixHoursAgo * 1000).toISOString();
  const staleFeed = {
    meta: { generated_at: staleIso, swing_threshold: 0.10, high_roi_threshold: 0.62, topic_rules: [{ id: 'golf' }, { id: 'gas' }] },
    run: { sampled_at: staleIso },
    topics: { golf: { count: 2 }, gas: { count: 2 } },
    alerts: [
      {
        id: 'a-live-1', ts: staleIso, ticker: 'KXDPWORLDTOUR-LIVE-1', topic: 'golf',
        title: 'Live Golf Leader', direction: 'up', from: 0.20, to: 0.35, delta: 0.15, abs_delta: 0.15,
        yes_bid_dollars: 0.34, yes_ask_dollars: 0.35, yes_bid_size_fp: 25, yes_ask_size_fp: 25,
        volume_24h_fp: 1500, est_traded_dollars: 18000,
        source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXDPWORLDTOUR-LIVE-1',
        model: { score: 0.80, highROI: true, tradeable: true, reasons: ['synthetic test'] },
      },
    ],
    markets: [
      {
        ticker: 'KXDPWORLDTOUR-LIVE-1', topic: 'golf', title: 'Live Golf Leader',
        status: 'active', result: '', price: 0.35, yes_bid_dollars: 0.34, yes_ask_dollars: 0.35,
        yes_bid_size_fp: 25, yes_ask_size_fp: 25, volume_24h_fp: 1500, volume_fp: 50000,
        est_traded_dollars: 18000, close_time: '2027-01-01T00:00:00Z',
        source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXDPWORLDTOUR-LIVE-1',
      },
    ],
    by_topic: {
      golf: {
        label: 'Golf',
        rows: [
          {
            ticker: 'KXPGATOUR-THRC26-BHAR', topic: 'golf', title: 'Finalized Golf Loser',
            status: 'finalized', result: 'no', price: 0.75, est_traded_dollars: 999999,
            source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXPGATOUR-THRC26-BHAR',
          },
          {
            ticker: 'KXDPWORLDTOUR-LIVE-1', topic: 'golf', title: 'Live Golf Leader',
            status: 'active', result: '', price: 0.35, yes_bid_dollars: 0.34, yes_ask_dollars: 0.35,
            yes_bid_size_fp: 25, yes_ask_size_fp: 25, volume_24h_fp: 1500, volume_fp: 50000,
            est_traded_dollars: 18000, close_time: '2027-01-01T00:00:00Z',
            source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXDPWORLDTOUR-LIVE-1',
          },
        ],
      },
    },
    awaiting: [
      {
        ticker: 'KXDPWORLDTOUR-LIVE-1', topic: 'golf', title: 'Live Golf Leader',
        last_alert_delta: 0.15, last_alert_ts: staleIso, close_time: '2027-01-01T00:00:00Z',
        last_price_dollars: '0.3500',
        source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXDPWORLDTOUR-LIVE-1',
      },
    ],
    resolutions: [
      {
        ticker: 'KXPGATOUR-THRC26-BHAR', topic: 'golf', title: 'Finalized Golf Loser',
        result: 'no', settlement_value_dollars: '0.0000', settlement_ts: '2026-11-23T19:58:03Z',
        volume_fp: '153195.26',
        source_url: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXPGATOUR-THRC26-BHAR',
      },
    ],
    orderbooks: {},
    history: {
      'KXDPWORLDTOUR-LIVE-1': [
        [sixHoursAgo - 2400, 0.20],
        [sixHoursAgo - 1800, 0.24],
        [sixHoursAgo - 900, 0.31],
        [sixHoursAgo, 0.35],
      ],
    },
  };

  const html = readFileSync('alerts/index.html', 'utf8');
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: 'https://kanlerxz87-cyber.github.io/KalshiDash1/alerts/index.html?topic=golf',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });

  let lineToCalls = 0;
  const drawnTexts = [];
  const fakeCtx = {
    setTransform() {},
    clearRect() { lineToCalls = 0; drawnTexts.length = 0; },
    beginPath() {}, moveTo() {}, stroke() {}, arc() {}, fill() {},
    lineTo() { lineToCalls += 1; },
    fillText(txt) { drawnTexts.push(String(txt)); },
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
  dom.window.AbortController = dom.window.AbortController || class { constructor() { this.signal = null; } abort() {} };
  dom.window.fetch = async (url) => {
    if (String(url).includes('data/live/feed.json')) {
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(staleFeed)), text: async () => JSON.stringify(staleFeed) };
    }
    return new Promise(() => {}); // feed-only mode
  };

  for (const src of ['alerts/js/alerts-live.js', 'alerts/js/alerts-page.js']) {
    dom.window.eval(readFileSync(src, 'utf8'));
  }
  await new Promise((r) => setTimeout(r, 400));

  const doc = dom.window.document;
  // ?topic=golf deep-link applied to both tabs and chat filter
  const golfTab = doc.querySelector('#topic-tabs button[data-topic="golf"]');
  assert.ok(golfTab && golfTab.classList.contains('primary'), 'alerts/index.html?topic=golf activates Golf topic tab');
  assert.equal(doc.getElementById('btn-filter-topic').textContent, 'Topics: Golf', '?topic=golf syncs chat topic filter');

  // F-ALERTS-01: finalized golf market MUST NOT render in live board even if still in feed.by_topic
  const boardHtml = doc.querySelector('#markets-table tbody').innerHTML;
  assert.equal(boardHtml.includes('KXPGATOUR-THRC26-BHAR'), false, 'finalized row excluded from Golf live board');
  assert.ok(boardHtml.includes('KXDPWORLDTOUR-LIVE-1'), 'live golf contract shown');
  assert.ok(boardHtml.includes('leader'), 'live golf contract receives leader badge');

  // F-ALERTS-02: zero links to ../dashboard.html?ticker=; every section links to ../market.html?ticker=
  const allLinks = [...doc.querySelectorAll('#log-all a, #log-roi a, #markets-table a, #await-table a, #res-table a')]
    .map((a) => a.getAttribute('href') || '');
  assert.equal(allLinks.some((h) => h.includes('dashboard.html?ticker=')), false, 'no broken ../dashboard.html?ticker= links');
  for (const sel of ['#log-all', '#log-roi', '#markets-table', '#await-table', '#res-table']) {
    const hrefs = [...doc.querySelectorAll(`${sel} a`)].map((a) => a.getAttribute('href') || '');
    assert.ok(hrefs.some((h) => h.startsWith('../market.html?ticker=')), `${sel} links contracts to ../market.html?ticker=`);
  }

  // Chart picker excludes finalized markets when live markets exist (F-ALERTS-01) while keeping F-CHART-02 windows intact
  const pickerOpts = [...doc.querySelectorAll('#chart-ticker option')].map((o) => o.value);
  assert.equal(pickerOpts.includes('KXPGATOUR-THRC26-BHAR'), false, 'finalized market excluded from live chart picker');
  assert.ok(pickerOpts.includes('KXDPWORLDTOUR-LIVE-1'), 'live market selectable in chart picker');
  assert.ok([...doc.querySelectorAll('#chart-window-btns button')].some((b) => /60 s/i.test(b.textContent)), '60 s window button intact');

  dom.window.close();
});

/* ---------------- 3. F-ALERTS-02: freshness.js ?topic= deep-link on dashboard & markets ---------------- */

await checkAsync('F-ALERTS-02: assets/freshness.js applies ?topic=golf to #topic-chips and #markets-topic-chips', async () => {
  const freshnessJs = readFileSync('assets/freshness.js', 'utf8');
  for (const [page, containerId] of [
    ['dashboard.html?topic=golf', 'topic-chips'],
    ['markets.html?topic=golf', 'markets-topic-chips'],
  ]) {
    let clicked = '';
    const dom = new JSDOM(
      `<!doctype html><html><body data-base=""><header class="site"><nav></nav></header>` +
      `<div id="${containerId}"><button data-topic="all">All topics</button><button data-topic="golf">Golf</button></div></body></html>`,
      { url: `https://kanlerxz87-cyber.github.io/KalshiDash1/${page}`, runScripts: 'outside-only' },
    );
    dom.window.XMLHttpRequest = class {
      open() {}
      send() {
        this.readyState = 4;
        this.status = 404;
        if (this.onreadystatechange) this.onreadystatechange();
      }
    };
    dom.window.document.querySelector('[data-topic="golf"]').addEventListener('click', () => { clicked = 'golf'; });
    dom.window.eval(freshnessJs);
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(clicked, 'golf', `${page} must click [data-topic="golf"] inside #${containerId}`);
    dom.window.close();
  }
});

/* ---------------- 4. F-HTML-01: zero nested <a> & table column alignment ---------------- */

const CANONICAL_HTML = [
  'index.html', 'executive-summary.html', 'markets.html', 'sources.html', 'api.html', 'catalyst.html',
  ...['gas', 'elections', 'culture', 'crypto', 'golf'].map((t) => `categories/${t}.html`),
  'flagged.html', 'questions.html', 'requirements.html', 'strategies.html', 'strategylab.html', 'suggestions.html',
  'dashboard.html', 'market.html', 'portfolio.html', 'analysis.html', 'demo-account.html',
  'alerts/index.html',
];

check('F-HTML-01: zero nested <a> elements across all templates and canonical HTML pages', () => {
  const tplFiles = readdirSync('templates').filter((f) => f.endsWith('.tpl')).map((f) => path.join('templates', f));
  const nestedRe = /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*?<a\b/i;
  for (const file of [...tplFiles, ...CANONICAL_HTML]) {
    const raw = readFileSync(file, 'utf8');
    assert.equal(nestedRe.test(raw), false, `${file} contains an invalid nested <a> element`);
  }
  // Negative control: ensure regex catches nested <a>
  assert.equal(nestedRe.test('<a href="a">outer <a href="b">inner</a></a>'), true, 'negative control must catch nested <a>');
});

check('F-HTML-01: every <tbody> row colspan matches its <thead> column count across all canonical HTML pages', () => {
  const rowCols = (tr) => [...tr.children].reduce((sum, td) => sum + Math.max(1, Number(td.getAttribute('colspan') || 1)), 0);
  for (const file of CANONICAL_HTML) {
    const dom = new JSDOM(readFileSync(file, 'utf8'));
    const tables = [...dom.window.document.querySelectorAll('table')];
    for (let i = 0; i < tables.length; i += 1) {
      const theadRow = tables[i].querySelector('thead tr');
      if (!theadRow) continue;
      const expected = rowCols(theadRow);
      for (const tr of tables[i].querySelectorAll('tbody tr')) {
        const actual = rowCols(tr);
        assert.equal(actual, expected, `${file} table[${i}] row has ${actual} cols, expected ${expected}`);
      }
    }
    dom.window.close();
  }
});

/* ---------------- 5. WS-probe handoff integration (session-528c51c9 §4) ---------------- */

check('WS-probe handoff: flagged.html (F-02/F-33/F-51), executive-summary.html and questions.html cite measured data/ws-probe.json', () => {
  assert.ok(existsSync('data/ws-probe.json'), 'data/ws-probe.json must exist');
  const probe = JSON.parse(readFileSync('data/ws-probe.json', 'utf8'));
  assert.equal(probe.summary?.anonymous_handshake_accepted_on_any_demo_host, false);

  const flagged = readFileSync('flagged.html', 'utf8');
  const rowFor = (id) => {
    const start = flagged.indexOf(`id="${id}"`);
    assert.ok(start !== -1, `flagged.html missing ${id}`);
    return flagged.slice(start, flagged.indexOf('</tr>', start));
  };
  for (const id of ['F-02', 'F-33', 'F-51']) {
    const row = rowFor(id);
    assert.ok(row.includes('data/ws-probe.json'), `flagged.html#${id} must link data/ws-probe.json`);
  }
  assert.equal(/the live WebSocket path is not exercised/i.test(rowFor('F-33')), false, 'F-33 must not claim WS path is unexercised');
  assert.ok(readFileSync('executive-summary.html', 'utf8').includes('data/ws-probe.json'));
  assert.ok(readFileSync('questions.html', 'utf8').includes('data/ws-probe.json'));
});

console.log(`\nalerts-console integrity suite: ${passed}/${passed} checks passed.`);
