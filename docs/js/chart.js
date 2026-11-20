/* chart.js — dependency-free canvas line chart with time-window x-axis.
 * X axis = time (windows from seconds to days), Y axis = contract price in dollars (0..1). */
(function () {
  'use strict';

  function drawChart(canvas, points, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var padL = 52, padR = 14, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var nowSec = Math.floor(Date.now() / 1000);
    var windowSec = opts.windowSeconds || 3600;
    var tMin = nowSec - windowSec, tMax = nowSec;
    var pts = (points || []).filter(function (p) { return p && p.t >= tMin && p.t <= tMax + 1 && p.v !== null && p.v !== undefined; });

    // Y range: price space 0..1 unless zoomed (min..max with padding)
    var yMin = 0, yMax = 1;
    if (opts.zoom && pts.length) {
      var vs = pts.map(function (p) { return p.v; });
      var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      var padY = Math.max(0.02, (mx - mn) * 0.15);
      yMin = Math.max(0, mn - padY); yMax = Math.min(1, mx + padY);
      if (yMax - yMin < 0.02) { yMin = Math.max(0, yMin - 0.01); yMax = Math.min(1, yMax + 0.01); }
    }

    function x(t) { return padL + (t - tMin) / (tMax - tMin) * plotW; }
    function y(v) { return padT + (1 - (v - yMin) / (yMax - yMin)) * plotH; }

    // gridlines + labels
    ctx.font = '11px sans-serif';
    ctx.strokeStyle = '#e3e8ee'; ctx.fillStyle = '#5b6b7b'; ctx.lineWidth = 1;
    var ySteps = 5;
    for (var i = 0; i <= ySteps; i++) {
      var v = yMin + (yMax - yMin) * i / ySteps;
      var yy = y(v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('$' + v.toFixed(2), padL - 8, yy);
    }
    // x labels: choose granularity from window
    var nX = 6;
    for (var j = 0; j <= nX; j++) {
      var t = tMin + (tMax - tMin) * j / nX;
      var xx = x(t);
      ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
      ctx.textAlign = j === 0 ? 'left' : (j === nX ? 'right' : 'center'); ctx.textBaseline = 'top';
      ctx.fillText(fmtX(t, windowSec), xx, padT + plotH + 6);
    }

    if (!pts.length) {
      ctx.fillStyle = '#5b6b7b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No price history in this window yet — data accumulates while the page is open, or choose a wider window.', W / 2, H / 2);
      return;
    }

    // line
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var xx = x(p.t), yy = y(p.v);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    });
    ctx.strokeStyle = opts.color || '#14568f'; ctx.lineWidth = 2; ctx.stroke();

    // fill under curve
    var last = pts[pts.length - 1];
    ctx.lineTo(x(last.t), padT + plotH); ctx.lineTo(x(pts[0].t), padT + plotH); ctx.closePath();
    ctx.fillStyle = 'rgba(20,86,143,0.07)'; ctx.fill();

    // last price marker + label
    var ly = y(last.v);
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(W - padR, ly);
    ctx.strokeStyle = 'rgba(20,86,143,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.color || '#14568f';
    ctx.beginPath(); ctx.arc(x(last.t), ly, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#14568f'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('last $' + last.v.toFixed(4), padL + 6, ly - 4);

    // hover tooltip
    canvas._chartPoints = pts; canvas._chartGeom = { x: x, y: y, padL: padL, padT: padT, plotW: plotW, plotH: plotH, windowSec: windowSec };
  }

  function fmtX(t, windowSec) {
    var d = new Date(t * 1000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    if (windowSec <= 300) return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
    if (windowSec <= 86400) return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':00';
  }

  function attachTooltip(canvas, tooltipEl) {
    canvas.addEventListener('mousemove', function (ev) {
      var pts = canvas._chartPoints, g = canvas._chartGeom;
      if (!pts || !pts.length || !g) { tooltipEl.style.display = 'none'; return; }
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      var best = null, bestD = Infinity;
      pts.forEach(function (p) {
        var d = Math.abs(g.x(p.t) - mx);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (best && bestD < 40) {
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = Math.min(g.x(best.t) + 12, rect.width - 170) + 'px';
        tooltipEl.style.top = (g.y(best.v) - 10) + 'px';
        tooltipEl.innerHTML = '<strong>$' + best.v.toFixed(4) + '</strong><br>' + new Date(best.t * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z/, 'Z');
      } else { tooltipEl.style.display = 'none'; }
    });
    canvas.addEventListener('mouseleave', function () { tooltipEl.style.display = 'none'; });
  }

  window.ChartLite = { drawChart: drawChart, attachTooltip: attachTooltip };
})();
