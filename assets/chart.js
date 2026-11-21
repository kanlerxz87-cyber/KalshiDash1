/* chart.js — dependency-free canvas charts for KalshiDash1.
 *
 * X axis = time (seconds resolution, adaptive tick labels).
 * Y axis = contract price in dollars (0 .. 1 for a binary market).
 *
 * Public API:
 *   KDChart.line(canvas, points, opts)
 *     points: [{ t: epochSeconds, v: price|null }]
 *     opts:   { windowSeconds, zoom, threshold, yMin, yMax, color, fill,
 *               hover: true, label }
 *   KDChart.spark(canvas, points, opts)   — tiny inline trend line
 *   KDChart.bars(canvas, points, opts)    — volume bars over time
 */
(function () {
  'use strict';

  var PALETTE = ['#00dd94', '#4c9aff', '#a78bfa', '#f5a524', '#ff6b6b', '#35d07f', '#f472b6', '#22d3ee'];

  function dpr() { return window.devicePixelRatio || 1; }

  /* A no-op 2D context: used when the browser offers no canvas (headless or very old
   * engines) so the page keeps working with tables and text instead of throwing. */
  function nullCtx() {
    function obj() {
      var fn = function () { return obj(); };
      return new Proxy(fn, {
        get: function (t, k) { return k === 'width' ? 0 : fn; },   /* measureText().width */
        set: function () { return true; },
        apply: function () { return obj(); }
      });
    }
    return obj();
  }

  function prep(canvas) {
    var ratio = dpr();
    var w = canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 600;
    var h = canvas.clientHeight || 300;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) ctx = nullCtx();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function fmtClock(ts, span) {
    var d = new Date(ts * 1000);
    var hh = String(d.getUTCHours()).padStart(2, '0');
    var mm = String(d.getUTCMinutes()).padStart(2, '0');
    var ss = String(d.getUTCSeconds()).padStart(2, '0');
    if (span <= 600) return hh + ':' + mm + ':' + ss;
    if (span <= 86400) return hh + ':' + mm;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' + hh + ':' + mm;
  }

  function niceStep(range, target) {
    if (!isFinite(range) || range <= 0) return 1;
    var raw = range / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return step * mag;
  }

  /* Public helpers are shared by the chart and the source-linked jump table.
   * Null is NOT zero. Sort once and let the last observation at a timestamp win. */
  function preparePoints(points) {
    var byTime = {};
    (points || []).forEach(function (q) {
      if (!q || q.t === null || q.t === undefined || q.v === null || q.v === undefined
          || typeof q.t === 'boolean' || typeof q.v === 'boolean'
          || (typeof q.t === 'string' && !q.t.trim()) || (typeof q.v === 'string' && !q.v.trim())) return;
      var t = Number(q.t), v = Number(q.v);
      if (!Number.isFinite(t) || !Number.isFinite(v)) return;
      byTime[t] = Object.assign({}, q, { t: t, v: v });
    });
    return Object.keys(byTime).map(function (key) { return byTime[key]; }).sort(function (a, b) { return a.t - b.t; });
  }
  function jumps(points, threshold) {
    var pts = preparePoints(points), result = [];
    (pts || []).forEach(function (q, i) {
      if (!i) return;
      var delta = Math.round((q.v - pts[i - 1].v) * 10000) / 10000;
      if (Math.round(Math.abs(delta) * 10000) < Math.round((threshold || 0.10) * 10000)) return;
      result.push({ t: q.t, from: pts[i - 1].v, to: q.v, delta: delta,
        source_url: q.source_url || null, baseline_source_url: pts[i - 1].source_url || null,
        basis: q.basis || 'consecutive published observations' });
    });
    return result;
  }

  /* ------------------------------------------------------------------ line */
  function line(canvas, points, opts) {
    if (!canvas) return;
    opts = opts || {};
    /* A redraw with no points must not leave a previous chart's hover/click active. */
    canvas.onmousemove = canvas.onmouseleave = canvas.onclick = null;
    var p = prep(canvas), ctx = p.ctx, W = p.w, H = p.h;
    var padL = 64, padR = 16, padT = 18, padB = 28;
    var plotW = Math.max(10, W - padL - padR), plotH = Math.max(10, H - padT - padB);
    var now = Number.isFinite(opts.now) ? opts.now : Math.floor(Date.now() / 1000);
    var win = opts.windowSeconds > 0 ? opts.windowSeconds : 3600;
    var tMin = now - win, tMax = now;
    var pts = preparePoints(points).filter(function (q) { return q.t >= tMin && q.t <= tMax; });
    var binary = opts.binary !== false;
    if (binary) pts = pts.filter(function (q) { return q.v >= 0 && q.v <= 1; });
    var yMin = opts.yMin, yMax = opts.yMax;
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      if ((!binary || opts.zoom) && pts.length) {
        var values = pts.map(function (q) { return q.v; });
        if (!binary) values.push(0);
        var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
        var padding = Math.max(0.02, (high - low) * 0.15);
        yMin = binary ? Math.max(0, low - padding) : low - padding;
        yMax = binary ? Math.min(1, high + padding) : high + padding;
      } else { yMin = 0; yMax = 1; }
    }
    if (yMax <= yMin) yMax = yMin + 0.02;
    var xOf = function (t) { return padL + (t - tMin) / win * plotW; };
    var yOf = function (v) { return padT + (1 - (v - yMin) / (yMax - yMin)) * plotH; };
    var events = (opts.events || []).filter(function (ev) {
      return Number.isFinite(ev.t) && Number.isFinite(ev.to) && ev.t >= tMin && ev.t <= tMax;
    }).slice(-12);
    var color = opts.color || PALETTE[0], hovered = null;
    var font = '11px ' + (window.getComputedStyle(document.body).fontFamily || 'sans-serif');

    function paint() {
      ctx.clearRect(0, 0, W, H); ctx.setLineDash([]); ctx.font = font; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#7b8a9c'; ctx.textAlign = 'right'; ctx.lineWidth = 1;
      var ys = niceStep(yMax - yMin, 5);
      for (var v = Math.ceil(yMin / ys) * ys; v <= yMax + 1e-9; v += ys) {
        var y = yOf(v); ctx.strokeStyle = '#1e2836';
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.fillText((v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2), padL - 7, y);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var xs = niceStep(win, Math.max(2, Math.floor(plotW / 110)));
      for (var t = Math.ceil(tMin / xs) * xs; t <= tMax; t += xs) {
        var x = xOf(t); ctx.strokeStyle = '#161f2b';
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
        ctx.fillText(fmtClock(t, win), x, padT + plotH + 7);
      }
      if (!pts.length) {
        ctx.textBaseline = 'middle';
        ctx.fillText('No verified price points in this window.', padL + plotW / 2, padT + plotH / 2);
        return;
      }
      function trace() {
        ctx.beginPath(); ctx.moveTo(xOf(pts[0].t), yOf(pts[0].v));
        pts.slice(1).forEach(function (q) { ctx.lineTo(xOf(q.t), yOf(q.v)); });
      }
      if (opts.fill !== false) {
        trace(); ctx.lineTo(xOf(pts[pts.length - 1].t), padT + plotH); ctx.lineTo(xOf(pts[0].t), padT + plotH); ctx.closePath();
        var gradient = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        gradient.addColorStop(0, color + '33'); gradient.addColorStop(1, color + '00');
        ctx.fillStyle = gradient; ctx.fill();
      }
      trace(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      var last = pts[pts.length - 1];
      ctx.beginPath(); ctx.arc(xOf(last.t), yOf(last.v), 3.2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      /* A $0.10 CHANGE is not an absolute $0.10 price level. Actual sourced
       * observations get markers; no misleading horizontal 10c/90c lines. */
      events.forEach(function (ev) {
        var x = xOf(ev.t), y = yOf(ev.to);
        ctx.setLineDash([3, 4]); ctx.strokeStyle = '#f5a52466'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, padT + plotH); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#f5a524'; ctx.fill();
      });
      if (hovered) {
        ctx.strokeStyle = '#5f7188'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xOf(hovered.t), padT); ctx.lineTo(xOf(hovered.t), padT + plotH); ctx.stroke(); ctx.setLineDash([]);
        var text = fmtClock(hovered.t, win) + ' UTC  ' + (hovered.v < 0 ? '-$' : '$') + Math.abs(hovered.v).toFixed(4);
        var tw = Math.min(W - 8, ctx.measureText(text).width + 16), tx = Math.max(4, Math.min(W - tw - 4, xOf(hovered.t) - tw / 2));
        ctx.fillStyle = '#0a0e14'; ctx.fillRect(tx, 0, tw, 19);
        ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, tx + 8, 10);
      }
    }
    paint();
    if (opts.hover !== false && pts.length) {
      canvas.onmousemove = function (ev) {
        var mx = ev.clientX - canvas.getBoundingClientRect().left;
        hovered = pts.reduce(function (best, q) { return !best || Math.abs(xOf(q.t) - mx) < Math.abs(xOf(best.t) - mx) ? q : best; }, null);
        paint();
      };
      canvas.onmouseleave = function () { hovered = null; paint(); };
    }
    if (events.length && typeof opts.onEvent === 'function') canvas.onclick = function (ev) {
      var mx = ev.clientX - canvas.getBoundingClientRect().left;
      var nearest = events.reduce(function (best, q) { return !best || Math.abs(xOf(q.t) - mx) < Math.abs(xOf(best.t) - mx) ? q : best; }, null);
      if (nearest && Math.abs(xOf(nearest.t) - mx) <= 14) opts.onEvent(nearest);
    };
  }

  /* ----------------------------------------------------------------- spark */
  function spark(canvas, points, opts) {
    if (!canvas) return;
    opts = opts || {};
    var p = prep(canvas);
    var ctx = p.ctx, W = p.w, H = p.h;
    var pts = (points || []).filter(function (q) { return q && q.v !== null && isFinite(q.v); });
    if (pts.length < 2) {
      ctx.fillStyle = '#3b4a5e';
      ctx.fillText('—', W / 2 - 4, H / 2 - 6);
      return;
    }
    var vs = pts.map(function (q) { return q.v; });
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    if (mx - mn < 0.001) { mn -= 0.01; mx += 0.01; }
    var xOf = function (i) { return (i / (pts.length - 1)) * (W - 2) + 1; };
    var yOf = function (v) { return H - 3 - ((v - mn) / (mx - mn)) * (H - 6); };
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pts[0].v));
    for (var i = 1; i < pts.length; i++) ctx.lineTo(xOf(i), yOf(pts[i].v));
    ctx.strokeStyle = opts.color || PALETTE[0]; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.arc(xOf(pts.length - 1), yOf(pts[pts.length - 1].v), 2, 0, Math.PI * 2);
    ctx.fillStyle = opts.color || PALETTE[0]; ctx.fill();
  }

  /* ------------------------------------------------------------------ bars */
  function bars(canvas, points, opts) {
    if (!canvas) return;
    opts = opts || {};
    var p = prep(canvas);
    var ctx = p.ctx, W = p.w, H = p.h;
    var padB = 20, padT = 8;
    var pts = (points || []).filter(function (q) { return q && isFinite(q.v); });
    if (!pts.length) return;
    var mx = Math.max.apply(null, pts.map(function (q) { return q.v; })) || 1;
    var bw = Math.max(1, (W / pts.length) - 1);
    ctx.fillStyle = opts.color || 'rgba(76,154,255,.55)';
    pts.forEach(function (q, i) {
      var h = ((H - padB - padT) * q.v) / mx;
      ctx.fillRect(i * (W / pts.length), H - padB - h, bw, h);
    });
    ctx.strokeStyle = '#1e2836';
    ctx.beginPath(); ctx.moveTo(0, H - padB + 0.5); ctx.lineTo(W, H - padB + 0.5); ctx.stroke();
  }

  window.KDChart = { line: line, spark: spark, bars: bars, preparePoints: preparePoints, jumps: jumps, PALETTE: PALETTE };
})();
