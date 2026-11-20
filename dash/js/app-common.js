/* app-common.js — shared header/nav/status + small DOM helpers. */
(function () {
  'use strict';

  var NAV = [
    ['index.html', 'Home'],
    ['events.html', 'Live Events'],
    ['alerts.html', 'Live Alerts'],
    ['market.html', 'Market Detail'],
    ['autotrade.html', 'Automated Trading'],
    ['portfolio.html', 'Portfolio'],
    ['analysis.html', 'Trade Analysis'],
    ['executive-summary.html', 'Executive Summary'],
    ['suggestions.html', 'Suggestions'],
    ['questions.html', 'Questions & Gaps'],
    ['api.html', 'API Reference'],
    ['sources.html', 'Sources'],
    ['flagged.html', 'Flagged for Review']
  ];

  function renderHeader(active) {
    var page = (location.pathname.split('/').pop() || 'index.html');
    var h = document.createElement('header');
    h.className = 'site';
    h.innerHTML =
      '<div class="head-inner">' +
        '<div class="brand">Kalshi<span class="dot">Dash</span>1 <span class="badge neutral">Demo</span></div>' +
        '<div class="head-meta">' +
          '<span id="mode-badge" class="badge warn">data: probing…</span>' +
          '<span id="clock" class="mono small muted"></span>' +
        '</div>' +
      '</div>' +
      '<nav class="site">' +
        NAV.map(function (n) {
          var isActive = n[0] === (active || page);
          return '<a href="' + n[0] + '"' + (isActive ? ' class="active"' : '') + '>' + n[1] + '</a>';
        }).join('') +
      '</nav>';
    document.body.insertBefore(h, document.body.firstChild);

    // clock
    var clock = h.querySelector('#clock');
    function tick() {
      clock.textContent = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
    }
    tick(); setInterval(tick, 1000);

    // live/snapshot badge
    var badge = h.querySelector('#mode-badge');
    window.K.onModeChange(function (st) {
      if (st.mode === 'live') { badge.className = 'badge live'; badge.textContent = 'data: LIVE (demo API)'; badge.title = 'Fetching from ' + window.K.cfg.endpoints.primary; }
      else if (st.mode === 'legacy') { badge.className = 'badge live'; badge.textContent = 'data: LIVE (legacy host)'; badge.title = 'Fetching from ' + window.K.cfg.endpoints.legacy; }
      else if (st.mode === 'snapshot') { badge.className = 'badge warn'; badge.textContent = 'data: SNAPSHOT 2026-11-20'; badge.title = 'Live API unreachable from this browser (CORS or network). Showing the verified snapshot bundled with the site.'; }
      else { badge.className = 'badge neutral'; badge.textContent = 'data: probing…'; }
    });
  }

  function renderFooter() {
    var f = document.createElement('footer');
    f.className = 'site';
    f.innerHTML = '<div class="inner">' +
      'KalshiDash1 — an independent demo dashboard for the Kalshi demo environment (external-api.demo.kalshi.co). ' +
      'Not affiliated with Kalshi. Not financial advice. All portfolio/trade data on this site is SIMULATED unless explicitly labeled otherwise.<br>' +
      'Sources: <a href="https://docs.kalshi.com" target="_blank" rel="noopener">docs.kalshi.com</a> · ' +
      '<a href="https://external-api.demo.kalshi.co/trade-api/v2/markets?limit=1" target="_blank" rel="noopener">demo API</a> · ' +
      '<a href="sources.html">verification log</a> · <a href="flagged.html">flagged items</a>' +
      '</div>';
    document.body.appendChild(f);
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function statusBadge(status, result) {
    if (result === 'yes') return '<span class="badge yes">resolved YES</span>';
    if (result === 'no') return '<span class="badge no">resolved NO</span>';
    if (status === 'active') return '<span class="badge live">live</span>';
    if (status === 'closed') return '<span class="badge warn">closed</span>';
    if (status === 'determined') return '<span class="badge accent">determined</span>';
    if (status === 'finalized') return '<span class="badge neutral">finalized</span>';
    return '<span class="badge neutral">' + window.K.esc(status || '—') + '</span>';
  }

  function topicLabel(id) {
    var t = window.K.cfg.topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.label : (id === 'other' ? 'Other' : id);
  }

  window.App = {
    renderHeader: renderHeader,
    renderFooter: renderFooter,
    el: el,
    statusBadge: statusBadge,
    topicLabel: topicLabel
  };
})();
