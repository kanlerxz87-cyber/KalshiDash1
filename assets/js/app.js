/* KalshiDash1 — shared app logic (client-side, fetches Kalshi demo API) */
(function(){
  const KALSHI = {
    BASE: 'https://external-api.demo.kalshi.co/trade-api/v2',
    // Official Kalshi demo trade UI where a market can be reviewed
    marketUrl(ticker){ return `https://demo.kalshi.com/market/${ticker}`; },
    eventUrl(eventTicker){ return `https://demo.kalshi.com/event/${eventTicker}`; },
    async get(path){
      const res = await fetch(this.BASE + path, {
        mode: 'cors',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`Kalshi API ${res.status} ${res.statusText} for ${path}`);
      return await res.json();
    },
    async events(limit=200){ return this.get(`/events?limit=${limit}`); },
    async markets(limit=200){ return this.get(`/markets?limit=${limit}`); },
    async market(ticker){ return this.get(`/markets/${encodeURIComponent(ticker)}`); }
  };

  // Map Kalshi event categories to our dashboard topics.
  // NOTE: the demo environment does not appear to list "gas prices" markets.
  // Those rows are intentionally left blank/flagged (see flagged-review.html).
  const TOPIC_BY_CATEGORY = {
    Elections: 'elections',
    Crypto: 'crypto',
    Sports: 'golf',
    Entertainment: 'culture',
    Economics: 'gas-prices'
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function fmtMoney(n){
    if (n == null || n === '') return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function fmtPrice(n){ return fmtMoney(n); }
  function sizeStr(v){ return v == null || v === '' ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function statusBadge(m){
    const s = (m.status || '').toLowerCase();
    let cls = 'badge-init', label = s || '—';
    if (s === 'active') { cls = 'badge-active'; label = 'Active'; }
    if (s === 'initialized') { cls = 'badge-init'; label = 'Initialized'; }
    if (s === 'closed') { cls = 'badge-no'; label = 'Closed'; }
    return `<span class="badge ${cls}">${label}</span>`;
  }
  function resultBadge(m){
    const r = (m.result || '').toString().toUpperCase();
    if (!r || r === '') return `<span class="badge badge-init">unresolved</span>`;
    if (r === 'YES') return `<span class="badge badge-yes">Resolved: Yes</span>`;
    if (r === 'NO') return `<span class="badge badge-no">Resolved: No</span>`;
    return `<span class="badge badge-init">Resolved: ${r}</span>`;
  }

  let eventsCache = null;   // map eventTicker -> event
  let marketsCache = [];    // array of markets

  async function loadAll(){
    if (eventsCache && marketsCache.length) return;
    const [evRes, mkRes] = await Promise.all([
      KALSHI.events(200).catch(()=>({events:[]})),
      KALSHI.markets(200).catch(()=>({markets:[]}))
    ]);
    const events = evRes.events || [];
    eventsCache = {};
    for (const e of events) eventsCache[e.event_ticker] = e;
    marketsCache = mkRes.markets || [];
  }

  function isGolf(market, event){
    const t = ((market.title || '') + ' ' + (event.title || '') + ' ' + (market.series_ticker || '')).toLowerCase();
    const pm = market.product_metadata || {};
    return /golf|pga|majors/.test(t) || (pm.competition && String(pm.competition).toLowerCase() === 'pga');
  }

  function topicFor(market, event){
    const cat = event ? event.category : null;
    const mapped = cat ? TOPIC_BY_CATEGORY[cat] : null;
    if (mapped === 'golf' && !isGolf(market, event)) return null;
    if (mapped === 'gas-prices') return null; // not present in demo; flagged elsewhere
    return mapped;
  }

  function joinMarkets(){
    loadAll();
    const rows = [];
    for (const m of marketsCache){
      const ev = eventsCache[m.event_ticker] || null;
      const topic = topicFor(m, ev);
      if (!topic) continue;
      rows.push({ market: m, event: ev, topic });
    }
    return rows;
  }

  function renderTable(containerId, topic, options = {}){
    const container = $(`#${containerId}`);
    if (!container) return;
    container.innerHTML = '<div class="empty">Loading live data from Kalshi demo API…</div>';

    (async () => {
      try {
        const rows = joinMarkets().filter(r => r.topic === topic);
        // "highest dollar amount" proxy: sort by open interest then volume desc
        rows.sort((a,b) => {
          const ao = Number(a.market.open_interest_fp || 0), bo = Number(b.market.open_interest_fp || 0);
          if (bo !== ao) return bo - ao;
          const av = Number(a.market.volume_24h_fp || 0), bv = Number(b.market.volume_24h_fp || 0);
          return bv - av;
        });

        const title = options.title || topic;
        const note = options.note || '';
        let html = '';
        if (options.note) html += `<div class="note">${options.note}</div>`;
        html += `
        <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Event</th><th>Market</th><th>Ticker</th><th>Topic</th>
            <th>Yes Bid</th><th>Yes Ask</th><th>Yes Size</th><th>No Size</th>
            <th>Last Price</th><th>Open Interest</th><th>Vol 24h</th>
            <th>Status</th><th>Resolution</th><th>Source</th>
          </tr></thead>
          <tbody>
        `;
        if (rows.length === 0){
          html += `<tr><td colspan="14" class="empty">No live markets found in the Kalshi demo API for "${title}".</td></tr>`;
        } else {
          for (const r of rows){
            const m = r.market, ev = r.event;
            const evTitle = ev ? ev.title : '—';
            const evTick = ev ? ev.event_ticker : (m.event_ticker || '—');
            const src = m.ticker ? `<a href="${KALSHI.marketUrl(m.ticker)}" target="_blank" rel="noopener">market</a> <a href="${KALSHI.BASE}/markets/${m.ticker}" target="_blank" rel="noopener" class="source" title="official API source">api</a>` : '—';
            html += `<tr>
              <td><a href="${ev ? KALSHI.eventUrl(evTick) : '#'}" target="_blank" rel="noopener">${evTitle}</a></td>
              <td>${m.title || '—'}</td>
              <td class="ticker">${m.ticker || '—'}</td>
              <td>${topic}</td>
              <td class="price">${fmtPrice(m.yes_bid_dollars)}</td>
              <td class="price">${fmtPrice(m.yes_ask_dollars)}</td>
              <td>${sizeStr(m.yes_bid_size_fp)}</td>
              <td>${sizeStr(m.no_bid_size_fp)}</td>
              <td class="price">${fmtPrice(m.last_price_dollars)}</td>
              <td>${fmtMoney(m.open_interest_fp)}</td>
              <td>${fmtMoney(m.volume_24h_fp)}</td>
              <td>${statusBadge(m)}</td>
              <td>${resultBadge(m)}</td>
              <td>${src}</td>
            </tr>`;
          }
        }
        html += `</tbody></table></div>`;
        container.innerHTML = html;
      } catch (err){
        console.error(err);
        container.innerHTML = `<div class="flag">Could not reach the Kalshi demo API from this browser (CORS/network). <br>${err.message}<br>Below is a static reference table. Source: <a href="${KALSHI.BASE}/events" target="_blank" rel="noopener">Kalshi demo API events</a>.</div>`;
        renderStatic(containerId, topic);
      }
    })();
  }

  // Static fallback rows (curated from observed demo API data). Each cites the official API source observed.
  const STATIC = {
    elections: [
      {event:'Who will be the next Secretary General of NATO?',market:'yes NATO Secretary General',ticker:'KXNEXTNATOSECGEN-99-…',topic:'Elections',note:'Elections · MECNET'},
      {event:'Who will the next Pope be?',market:'yes Next Pope',ticker:'KXNEWPOPE-70-…',topic:'Elections',note:'Elections · MECNET'},
      {event:'Which party will win the 2032 Presidential Election?',market:'yes 2032 Presidential party',ticker:'KXPRESPARTY-2032-…',topic:'Elections',note:'Elections · MECNET'}
    ],
    crypto: [
      {event:'Bitcoin price on Feb 10, 2035 at 10am EST?',market:'BTC price',ticker:'KXBTCD-35FEB1010-…',topic:'Crypto',note:'Crypto · CF Benchmarks BRTI'},
      {event:'Bitcoin price range on Feb 24, 2034 at 10am EST?',market:'BTC price range',ticker:'KXBTC-34FEB2410-…',topic:'Crypto',note:'Crypto · MECNET'}
    ],
    golf: [
      {event:'Miles Russell: Golf Majors by 2036',market:'Golf majors',ticker:'KXPGAFUTURE-36MRUS-…',topic:'Golf (Sports)',note:'Sports · PGA · pgatour.com'},
      {event:'Jackson Koivun: Golf Majors before 2036',market:'Golf majors',ticker:'KXPGAFUTURE-36JKOI-…',topic:'Golf (Sports)',note:'Sports · PGA · pgatour.com'}
    ],
    culture: [
      {event:'Grand Theft Auto VII · Release Date',market:'GTA VII release (USA)',ticker:'KXGTA7RELEASEDATE-USA-…',topic:'Culture (Entertainment)',note:'Entertainment · rockstargames.com'},
      {event:'Who will perform the next James Bond theme?',market:'Bond theme performer',ticker:'KXPERFORMBONDSONG-35-…',topic:'Culture (Entertainment)',note:'Entertainment'}
    ],
    'gas-prices': []
  };

  function renderStatic(containerId, topic){
    const container = $(`#${containerId}`);
    if (!container) return;
    const rows = STATIC[topic] || [];
    if (rows.length === 0){
      container.innerHTML = `<div class="flag"><b>Gas prices:</b> No gas-price markets were found in the Kalshi demo API events feed. This is flagged as unverified/not available in the demo environment. Real gas-price markets trade on Kalshi; see <a href="https://kalshi.com" target="_blank" rel="noopener">kalshi.com</a> and the <a href="flagged-review.html" rel="noopener">Flagged for Review</a> page.</div>`;
      return;
    }
    let html = `<div class="table-wrap"><table class="data"><thead><tr><th>Event</th><th>Market</th><th>Ticker</th><th>Topic</th><th>Source note</th></tr></thead><tbody>`;
    for (const r of rows){
      html += `<tr><td>${r.event}</td><td>${r.market}</td><td class="ticker">${r.ticker}</td><td>${r.topic}</td><td class="source">${r.note}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  // Expose
  window.KalshiDash = { KALSHI, renderTable, renderStatic, fmtPrice, sizeStr, joinMarkets };
})();
