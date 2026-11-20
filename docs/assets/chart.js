/* KalshiDash1 — dependency-free canvas price chart.
   X axis = time, Y axis = contract price ($0–$1). No external libraries. */
(function (global) {
  "use strict";
  function fmtTime(ts, windowSec) {
    var d = new Date(ts * 1000);
    if (windowSec <= 300) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (windowSec <= 86400) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function drawLineChart(canvas, points, opts) {
    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.parentElement.clientWidth || 800;
    var h = canvas.clientHeight || 320;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var padL = 52, padR = 14, padT = 14, padB = 34;
    var iw = w - padL - padR, ih = h - padT - padB;
    ctx.font = "11px system-ui, sans-serif";
    if (!points || points.length === 0) {
      ctx.fillStyle = "#9fb0c3";
      ctx.fillText(opts.emptyText || "No price data yet — select a market and wait for live samples, or pick a longer window.", padL, padT + 20);
      return;
    }
    var t0 = points[0].t, t1 = points[points.length - 1].t;
    if (t1 === t0) t1 = t0 + (opts.windowSec || 60);
    var yMin = 0, yMax = 1;
    if (opts.yMin !== undefined) yMin = opts.yMin;
    if (opts.yMax !== undefined) yMax = opts.yMax;
    function X(t) { return padL + (t - t0) / (t1 - t0) * iw; }
    function Y(p) { return padT + (1 - (p - yMin) / (yMax - yMin)) * ih; }
    /* grid + y labels */
    ctx.strokeStyle = "#2a3646"; ctx.fillStyle = "#9fb0c3"; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var p = yMin + (yMax - yMin) * i / 4;
      var y = Y(p);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iw, y); ctx.stroke();
      ctx.fillText("$" + p.toFixed(2), 6, y + 4);
    }
    /* x labels (5 ticks) */
    for (var j = 0; j <= 4; j++) {
      var t = t0 + (t1 - t0) * j / 4;
      ctx.fillText(fmtTime(t, opts.windowSec || (t1 - t0)), X(t) - 24, h - 10);
    }
    /* line */
    ctx.strokeStyle = "#00b67a"; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach(function (pt, idx) {
      var x = X(pt.t), y = Y(pt.p);
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    /* last point */
    var last = points[points.length - 1];
    ctx.fillStyle = "#00b67a";
    ctx.beginPath(); ctx.arc(X(last.t), Y(last.p), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e8eef4";
    ctx.fillText("$" + last.p.toFixed(4), Math.min(X(last.t) + 8, w - 70), Y(last.p) - 8);
    if (opts.title) { ctx.fillStyle = "#9fb0c3"; ctx.fillText(opts.title, padL, padT - 2); }
    canvas._points = points; canvas._geom = { padL: padL, padT: padT, iw: iw, ih: ih, t0: t0, t1: t1, yMin: yMin, yMax: yMax };
  }
  function drawDepth(canvas, yesLevels, noLevels) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 800, h = canvas.clientHeight || 180;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    var levels = (yesLevels || []).slice(-12).map(function (l) { return { side: "YES", price: parseFloat(l[0]), qty: parseFloat(l[1]) }; })
      .concat((noLevels || []).slice(-12).map(function (l) { return { side: "NO", price: parseFloat(l[0]), qty: parseFloat(l[1]) }; }));
    if (!levels.length) { ctx.fillStyle = "#9fb0c3"; ctx.font = "11px system-ui"; ctx.fillText("No orderbook levels returned.", 12, 22); return; }
    var maxQ = Math.max.apply(null, levels.map(function (l) { return l.qty; }).concat([1]));
    var bw = Math.max(10, (w - 90) / levels.length - 4);
    ctx.font = "10px system-ui";
    levels.forEach(function (l, i) {
      var x = 70 + i * (bw + 4);
      var bh = (h - 50) * (l.qty / maxQ);
      ctx.fillStyle = l.side === "YES" ? "#00b67a" : "#3b82f6";
      ctx.fillRect(x, h - 30 - bh, bw, bh);
      ctx.fillStyle = "#9fb0c3";
      ctx.fillText("$" + l.price.toFixed(2), x - 2, h - 16);
      ctx.fillText(String(Math.round(l.qty)), x - 2, h - 34 - bh);
    });
    ctx.fillStyle = "#9fb0c3"; ctx.fillText("Contracts per price level (best bids, last 12 per side)", 12, 14);
  }
  global.KalshiChart = { drawLineChart: drawLineChart, drawDepth: drawDepth };
})(window);
