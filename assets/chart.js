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

  /* ------------------------------------------------------------------ line */
  function line(canvas, points, opts) {
    if (!canvas) return;
    opts = opts || {};
    var p = prep(canvas);
    var ctx = p.ctx, W = p.w, H = p.h;
    var padL = 54, padR = 16, padT = 12, padB = 26;
    var plotW = Math.max(10, W - padL - padR), plotH = Math.max(10, H - padT - padB);

    var now = opts.now || Math.floor(Date.now() / 1000);
    var win = opts.windowSeconds || 3600;
    var tMin = now - win, tMax = now;

    var pts = (points || []).filter(function (q) {
      return q && q.v !== null && q.v !== undefined && isFinite(q.v) && q.t >= tMin && q.t <= tMax + 1;
    });

    ctx.font = '11px ' + (window.getComputedStyle(document.body).fontFamily || 'sans-serif');
    ctx.textBaseline = 'middle';

    /* y range */
    var yMin = opts.yMin, yMax = opts.yMax;
    if (yMin === undefined || yMin === null) {
      if (opts.zoom && pts.length) {
        var vs = pts.map(function (q) { return q.v; });
        var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
        var pad = Math.max(0.02, (mx - mn) * 0.2);
        yMin = Math.max(0, mn - pad); yMax = Math.min(1, mx + pad);
      } else { yMin = 0; yMax = 1; }
    }
    if (yMax - yMin < 0.02) { var mid = (yMin + yMax) / 2; yMin = Math.max(0, mid - 0.01); yMax = Math.min(1, mid + 0.01); }

    var xOf = function (t) { return padL + ((t - tMin) / (tMax - tMin || 1)) * plotW; };
    var yOf = function (v) { return padT + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH; };

    /* grid + axes */
    ctx.strokeStyle = '#1e2836'; ctx.lineWidth = 1;
    ctx.fillStyle = '#7b8a9c'; ctx.textAlign = 'right';
    var yStep = niceStep(yMax - yMin, 5);
    for (var v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
      var y = yOf(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText('$' + v.toFixed(2), padL - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xStep = niceStep(tMax - tMin, Math.max(2, Math.floor(plotW / 110)));
    for (var t = Math.ceil(tMin / xStep) * xStep; t <= tMax; t += xStep) {
      var x = xOf(t);
      ctx.strokeStyle = '#161f2b';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.fillStyle = '#7b8a9c';
      ctx.fillText(fmtClock(t, win), x, padT + plotH + 6);
    }

    /* threshold line (swing alert level) */
    if (opts.threshold) {
      [opts.threshold, 1 - opts.threshold].forEach(function (lv) {
        if (lv <= yMin || lv >= yMax) return;
        var y = yOf(lv);
        ctx.save();
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#f5a524'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.restore();
      });
    }

    if (!pts.length) {
      ctx.fillStyle = '#7b8a9c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No price points in this window yet.', padL + plotW / 2, padT + plotH / 2);
      return;
    }

    /* area + line */
    var color = opts.color || PALETTE[0];
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0].t), yOf(pts[0].v));
    for (var i = 1; i < pts.length; i++) ctx.lineTo(xOf(pts[i].t), yOf(pts[i].v));
    if (opts.fill !== false) {
      ctx.save();
      ctx.lineTo(xOf(pts[pts.length - 1].t), padT + plotH);
      ctx.lineTo(xOf(pts[0].t), padT + plotH);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, color + '33');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(xOf(pts[0].t), yOf(pts[0].v));
      for (var j = 1; j < pts.length; j++) ctx.lineTo(xOf(pts[j].t), yOf(pts[j].v));
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.stroke();

    /* last price marker */
    var last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(xOf(last.t), yOf(last.v), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();

    /* hover crosshair */
    if (opts.hover !== false && pts.length > 1) {
      var hit = null;
      canvas.onmousemove = function (ev) {
        var rect = canvas.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var best = null, bestD = Infinity;
        pts.forEach(function (q) {
          var dd = Math.abs(xOf(q.t) - mx);
          if (dd < bestD) { bestD = dd; best = q; }
        });
        hit = best;
        draw();
        if (hit) {
          ctx.strokeStyle = '#3b4a5e'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(xOf(hit.t), padT); ctx.lineTo(xOf(hit.t), padT + plotH); ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(xOf(hit.t), yOf(hit.v), 4, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          var txt = fmtClock(hit.t, win) + ' UTC  $' + hit.v.toFixed(2);
          ctx.font = '11px ' + (window.getComputedStyle(document.body).fontFamily || 'sans-serif');
          var tw = ctx.measureText(txt).width + 12;
          var tx = Math.min(W - tw - 4, Math.max(padL, xOf(hit.t) - tw / 2));
          ctx.fillStyle = 'rgba(10,14,20,.94)';
          ctx.fillRect(tx, 2, tw, 18);
          ctx.strokeStyle = '#2f3d50'; ctx.strokeRect(tx + .5, 2.5, tw - 1, 17);
          ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(txt, tx + 6, 11);
        }
      };
      canvas.onmouseleave = function () { hit = null; draw(); };
    }

    function draw() {
      var q = prep(canvas);
      var c2 = q.ctx;
      c2.font = '11px ' + (window.getComputedStyle(document.body).fontFamily || 'sans-serif');
      c2.textBaseline = 'middle';
      c2.strokeStyle = '#1e2836'; c2.lineWidth = 1; c2.fillStyle = '#7b8a9c'; c2.textAlign = 'right';
      var ys = niceStep(yMax - yMin, 5);
      for (var vv = Math.ceil(yMin / ys) * ys; vv <= yMax + 1e-9; vv += ys) {
        var yy = yOf(vv);
        c2.beginPath(); c2.moveTo(padL, yy); c2.lineTo(padL + plotW, yy); c2.stroke();
        c2.fillText('$' + vv.toFixed(2), padL - 6, yy);
      }
      c2.textAlign = 'center'; c2.textBaseline = 'top';
      var xs = niceStep(tMax - tMin, Math.max(2, Math.floor(plotW / 110)));
      for (var tt = Math.ceil(tMin / xs) * xs; tt <= tMax; tt += xs) {
        var xx = xOf(tt);
        c2.strokeStyle = '#161f2b';
        c2.beginPath(); c2.moveTo(xx, padT); c2.lineTo(xx, padT + plotH); c2.stroke();
        c2.fillStyle = '#7b8a9c';
        c2.fillText(fmtClock(tt, win), xx, padT + plotH + 6);
      }
      c2.beginPath();
      c2.moveTo(xOf(pts[0].t), yOf(pts[0].v));
      for (var k = 1; k < pts.length; k++) c2.lineTo(xOf(pts[k].t), yOf(pts[k].v));
      c2.strokeStyle = color; c2.lineWidth = 2; c2.stroke();
      var lp = pts[pts.length - 1];
      c2.beginPath(); c2.arc(xOf(lp.t), yOf(lp.v), 3.2, 0, Math.PI * 2);
      c2.fillStyle = color; c2.fill();
      if (hit) {
        c2.strokeStyle = '#3b4a5e'; c2.setLineDash([3, 3]);
        c2.beginPath(); c2.moveTo(xOf(hit.t), padT); c2.lineTo(xOf(hit.t), padT + plotH); c2.stroke();
        c2.setLineDash([]);
      }
    }
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

  window.KDChart = { line: line, spark: spark, bars: bars, PALETTE: PALETTE };
})();
