/* KalshiDash1 — live price graph (Chart.js via CDN) */
(function(){
  const KALSHI = window.KalshiDash && window.KalshiDash.KALSHI;
  let chart = null;
  let series = []; // {t: Date, v: number}
  let timer = null;
  let currentTicker = null;

  const LENGTH_MS = {
    '30s': 30*1000, '1m': 60*1000, '5m': 5*60*1000,
    '15m': 15*60*1000, '1h': 60*60*1000, '6h': 6*60*60*1000, '24h': 24*60*60*1000
  };

  function fmtTime(d){
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function fetchLastPrice(ticker){
    if (!KALSHI) return null;
    const m = await KALSHI.market(ticker);
    return { yesBid: m.yes_bid_dollars, yesAsk: m.yes_ask_dollars,
             noBid: m.no_bid_dollars, noAsk: m.no_ask_dollars,
             last: m.last_price_dollars, yesSize: m.yes_bid_size_fp, noSize: m.no_bid_size_fp,
             openInterest: m.open_interest_fp, volume: m.volume_24h_fp, status: m.status, result: m.result };
  }

  function addPoint(ticker, price){
    if (price == null || price === '') return;
    const v = Number(price);
    if (!Number.isFinite(v)) return;
    series.push({ t: Date.now(), v });
    currentTicker = ticker;
    trim();
    draw();
  }

  function trim(){
    const len = document.querySelector('#graph-length') ? Number(document.querySelector('#graph-length').value) : 3600000;
    const cutoff = Date.now() - len;
    while (series.length && series[0].t < cutoff) series.shift();
  }

  function draw(){
    if (!chart) return;
    const labels = series.map(p => fmtTime(new Date(p.t)));
    const data = series.map(p => p.v);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update('none');
  }

  function initGraph(canvasId, ticker){
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chart) { chart.destroy(); chart = null; }
    series = [];
    currentTicker = ticker;
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Yes contract price ($)', data: [], borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.1)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2, pointHitRadius: 6 }] },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'time', time: { unit: 'minute', tooltipFormat: 'MMM d, HH:mm:ss' }, title: { display: true, text: 'Time' } },
          y: { title: { display: true, text: 'Contract price ($)' }, min: 0, max: 1, ticks: { stepSize: 0.1 } }
        },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
      }
    });
    // seed with current price
    (async () => {
      try {
        const p = await fetchLastPrice(ticker);
        if (p) addPoint(ticker, p.last);
      } catch (e) { console.warn('graph seed failed', e); }
    })();
    // poll every 3 seconds
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      if (!currentTicker) return;
      try {
        const p = await fetchLastPrice(currentTicker);
        if (p) addPoint(currentTicker, p.last);
        updateLiquidity(p);
      } catch (e) { /* silent on poll failure */ }
    }, 3000);
    return chart;
  }

  function updateLiquidity(p){
    if (!p) return;
    const el = document.getElementById('liquidity-readout');
    if (!el) return;
    el.innerHTML = `
      <strong>Last price:</strong> $${Number(p.last).toFixed(4)} &nbsp;|&nbsp;
      <strong>Yes bid/ask:</strong> $${Number(p.yesBid).toFixed(4)} / $${Number(p.yesAsk).toFixed(4)} &nbsp;|&nbsp;
      <strong>Yes size:</strong> ${Number(p.yesSize).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} &nbsp;|&nbsp;
      <strong>No size:</strong> ${Number(p.noSize).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} &nbsp;|&nbsp;
      <strong>Open interest:</strong> ${Number(p.openInterest).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} &nbsp;|&nbsp;
      <strong>Vol 24h:</strong> ${Number(p.volume).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} &nbsp;|&nbsp;
      <strong>Status:</strong> ${p.status || '—'} ${p.result ? `<span style="color:p.result==='YES'?'#16a34a':'#dc2626'">(resolved ${p.result})</span>` : ''}
    `;
  }

  function setupLengthControl(){
    const sel = document.getElementById('graph-length');
    if (!sel) return;
    sel.addEventListener('change', () => { trim(); draw(); });
  }

  window.KalshiDashGraph = { initGraph, fetchLastPrice, addPoint };
  // auto-init when DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    setupLengthControl();
    const canvas = document.getElementById('priceChart');
    if (canvas && canvas.dataset.ticker) {
      initGraph('priceChart', canvas.dataset.ticker);
    }
  });
})();
