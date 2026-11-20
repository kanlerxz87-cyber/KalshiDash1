/* KalshiDash1 — live dashboard chart + orderbook liquidity.
 *
 * Reads market ticker from the page, fetches public (no-auth) data from the
 * verified Kalshi demo Trade API and renders:
 *   • price-over-time graph (X = time, Y = contract price)
 *   • orderbook liquidity: price levels and contracts available at each price
 *
 * Endpoints (official docs: https://docs.kalshi.com/api-reference):
 *   GET /markets?tickers=...          resolve series_ticker for a market
 *   GET /markets/{ticker}/orderbook   yes/no bid price levels + counts
 *   GET /series/{series}/markets/{ticker}/candlesticks  price history
 *
 * Caveats (verified from docs):
 *   • candlestick period_interval supports 1 / 60 / 1440 minutes only — no
 *     sub-minute ("seconds") resolution. A "seconds" lookback still plots
 *     1-minute candlesticks (finest available). Documented on dashboard.
 *   • start_ts/end_ts must be Unix seconds (not ms). Max 5000 periods/request.
 *   • Market data is cached briefly; prices can lag the exchange by seconds.
 */
(function (window) {
  'use strict';

  const client = window.KalshiDash.client;
  const Chart = window.Chart;

  // DOM
  const els = {
    ticker: document.getElementById('d-ticker'),
    series: document.getElementById('d-series'),
    loadBtn: document.getElementById('d-load'),
    range: document.getElementById('d-range'),
    status: document.getElementById('d-status'),
    statusText: document.getElementById('d-status-text'),
    lastPrice: document.getElementById('d-last-price'),
    yesBid: document.getElementById('d-yes-bid'),
    yesAsk: document.getElementById('d-yes-ask'),
    noBid: document.getElementById('d-no-bid'),
    noAsk: document.getElementById('d-no-ask'),
    openInt: document.getElementById('d-open-int'),
    volume: document.getElementById('d-volume'),
    ctx: document.getElementById('priceChart'),
    orderbookBody: document.getElementById('d-orderbook-body'),
    chartNotice: document.getElementById('d-chart-notice'),
  };

  let chartInstance = null;

  function setStatus(kind, msg) {
    if (!els.status) return;
    els.status.className = 'status ' + kind;
    els.statusText.textContent = msg;
    els.status.style.display = msg ? 'flex' : 'none';
  }

  function clearKpis() {
    [els.lastPrice, els.yesBid, els.yesAsk, els.noBid, els.noAsk, els.openInt, els.volume].forEach(function (el) {
      if (el) el.textContent = '—';
    });
    if (els.orderbookBody) els.orderbookBody.innerHTML = '<tr><td colspan="5" class="td-blank center">No orderbook data.</td></tr>';
  }

  function resolveSeriesTicker(ticker) {
    return client.listMarkets({ tickers: ticker }).then(function (data) {
      const markets = data.markets || [];
      if (!markets.length) throw new Error('Market "' + ticker + '" not found in demo environment.');
      return markets[0].series_ticker || null;
    });
  }

  function timeRangeConfig(range) {
    const now = client.nowSeconds();
    // label, lookback seconds, period interval (minutes), description
    const presets = {
      sec:   { label: 'Last 60 seconds', span: 60, period: 1, desc: 'Finest available resolution is 1 minute (API limitation).' },
      min:   { label: 'Last 60 minutes', span: 60 * 60, period: 1, desc: '1-minute candlesticks over the last hour.' },
      hour:  { label: 'Last 6 hours', span: 6 * 60 * 60, period: 1, desc: '1-minute candlesticks over the last 6 hours.' },
      day:   { label: 'Last 24 hours', span: 24 * 60 * 60, period: 60, desc: '1-hour candlesticks over the last 24 hours.' },
    };
    return presets[range] || presets.min;
  }

  function renderChart(ticker, points) {
    const canvas = els.ctx;
    if (Chart && chartInstance) chartInstance.destroy();
    if (!Chart) return;
    chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map(function (p) { return new Date(p.t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }),
        datasets: [{
          label: ticker + ' — YES contract price ($)',
          data: points.map(function (p) { return p.p; }),
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.10)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.25,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          x: { type: 'category', title: { display: true, text: 'Time' } },
          y: { title: { display: true, text: 'Contract price ($)' }, min: 0, max: 1, ticks: { stepSize: 0.2, callback: function (v) { return '$' + v.toFixed(2); } } }
        },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
      }
    });
  }

  function renderOrderbook(ob) {
    const body = els.orderbookBody;
    if (!body) return;
    body.innerHTML = '';
    const yes = (ob.orderbook_fp && ob.orderbook_fp.yes_dollars) || [];
    const no = (ob.orderbook_fp && ob.orderbook_fp.no_dollars) || [];
    const levels = Math.max(yes.length, no.length);
    if (levels === 0) {
      body.innerHTML = '<tr><td colspan="5" class="td-blank center">No orderbook levels for this market.</td></tr>';
      return;
    }
    // yes_dollars / no_dollars are arrays of [price_string, fp_count_string], ascending price; best bid is LAST.
    for (let i = 0; i < levels; i++) {
      const tr = document.createElement('tr');
      const y = yes[yes.length - 1 - i]; // best yes bid first
      const n = no[no.length - 1 - i];   // best no bid first
      function cell(v) { return v ? '<strong>$' + Number(v[0]).toFixed(4) + '</strong><br><span class="small">' + Number(v[1]).toFixed(2) + ' contracts</span>' : '—'; }
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td class="nowrap">' + cell(y) + '</td>' +
        '<td class="nowrap">' + cell(n) + '</td>';
      body.appendChild(tr);
    }
  }

  window.KalshiDash.loadMarket = function () {
    const ticker = (els.ticker && els.ticker.value) ? els.ticker.value.trim() : '';
    if (!ticker) { setStatus('err', 'Enter a market ticker (e.g. KX...).'); return; }
    clearKpis();
    setStatus('info', 'Loading market data for ' + ticker + ' …');
    els.loadBtn.disabled = true;

    let seriesTicker = (els.series && els.series.value) ? els.series.value.trim() : '';

    Promise.resolve()
      .then(function () {
        if (seriesTicker) return seriesTicker;
        return resolveSeriesTicker(ticker).then(function (s) { seriesTicker = s; });
      })
      .then(function () {
        const range = els.range ? els.range.value : 'min';
        const cfg = timeRangeConfig(range);
        const endTs = client.nowSeconds();
        const startTs = endTs - cfg.span;

        return Promise.all([
          client.getOrderbook(ticker),
          client.getCandlesticks(seriesTicker, ticker, startTs, endTs, cfg.period)
        ]);
      })
      .then(function (results) {
        const orderbook = results[0];
        const candles = results[1];
        const candlesticks = candles.candlesticks || [];

        // KPIs from orderbook best levels + latest candle
        const yes = (orderbook.orderbook_fp && orderbook.orderbook_fp.yes_dollars) || [];
        const no = (orderbook.orderbook_fp && orderbook.orderbook_fp.no_dollars) || [];
        const bestYes = yes.length ? yes[yes.length - 1] : null;
        const bestNo = no.length ? no[no.length - 1] : null;
        const lastCandle = candlesticks.length ? candlesticks[candlesticks.length - 1] : null;

        if (els.lastPrice) els.lastPrice.textContent = client.usd(lastCandle ? lastCandle.price : null);
        if (els.yesBid) els.yesBid.textContent = client.usd(bestYes ? bestYes[0] : null);
        if (els.yesAsk) els.yesAsk.textContent = client.usd(bestYes ? bestYes[0] : null); // binary: yes bid = no ask mirror
        if (els.noBid) els.noBid.textContent = client.usd(bestNo ? bestNo[0] : null);
        if (els.noAsk) els.noAsk.textContent = client.usd(bestNo ? bestNo[0] : null);
        if (els.openInt && lastCandle) els.openInt.textContent = client.usd(lastCandle.open_interest_fp);
        if (els.volume && lastCandle) els.volume.textContent = Number(lastCandle.volume_fp || 0).toFixed(2);

        renderOrderbook(orderbook);
        const points = candlesticks.filter(function (c) { return c.price != null; }).map(function (c) {
          return { t: c.end_period_ts, p: Number(c.price) };
        });
        if (points.length) renderChart(ticker, points);
        if (els.chartNotice) els.chartNotice.textContent = 'Plotting ' + points.length + ' candlestick close prices. ' + cfg.desc;
        setStatus('ok', 'Live data loaded for ' + ticker + ' (demo environment). Prices may lag the exchange by seconds.');
      })
      .catch(function (err) {
        console.error(err);
        setStatus('err', 'Failed to load ' + ticker + ': ' + (err.message || err));
        if (els.chartNotice) els.chartNotice.textContent = 'Live chart unavailable — see status above.';
      })
      .finally(function () { els.loadBtn.disabled = false; });
  };

  // Auto wire load button if present
  if (els.loadBtn) els.loadBtn.addEventListener('click', window.KalshiDash.loadMarket);

})(window);
