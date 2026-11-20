/* freshness.js — print the measured age of the live alert engine on every page.
 *
 * WHY THIS EXISTS
 * ---------------
 * The site can read the exchange directly from the visitor's browser, but the two scrolling
 * alert feeds are produced by `tools/live_engine.mjs` running in GitHub Actions and committed to
 * `data/live/feed.json`. If that job stops, the page would otherwise keep showing the words
 * "live" over a frozen file. On 2026-11-20 that is exactly what happened: no `schedule`
 * trigger had ever fired for this repository and the newest sample was hours old while the page
 * still said LIVE. This module makes that impossible: it reads `meta.generated_at` from the
 * feed, computes the real age against the visitor's clock, and prints it in the header badge.
 *
 * HONESTY RULES
 *   * The badge reflects the *measured* age. It is never set from a constant or a guess.
 *   * If the feed cannot be read, the badge says so instead of falling back to "live".
 *   * Thresholds are stated on the page (see data/dash-quality.json → freshness): WARN at 20
 *     minutes, STALE at 45 minutes. The engine is designed to be re-dispatched every 15.
 *   * No network call to any third party: only the same-origin committed JSON.
 *
 * SOURCE FOR THE THRESHOLDS: they are this project's own operating parameters, chosen to match
 * the 15-minute keepalive dispatch interval in `.github/workflows/keepalive.yml`. Nothing here
 * is a Kalshi claim, so nothing here needs a Kalshi citation.
 */
(function () {
  'use strict';

  var WARN_MIN = 20;
  var STALE_MIN = 45;
  var FILTER_TOPIC_TTL_MS = 3000;

  function root() {
    /* Pages are served from the repository root and from /categories/ (one level down) and
     * /alerts/ (one level down, own app). `document.body.dataset.base` is written by the site
     * generator for exactly this purpose; fall back to counting path segments. */
    var b = document.body && document.body.getAttribute('data-base');
    if (b !== null && b !== undefined) return b;
    var m = location.pathname.match(/\/(categories|alerts|dash|docs)\//);
    return m ? '../' : '';
  }

  function ageMinutes(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 60000));
  }

  function human(min) {
    if (min === null) return 'unknown age';
    if (min < 1) return 'just now';
    if (min === 1) return '1 min ago';
    if (min < 60) return min + ' min ago';
    var h = min / 60;
    if (h < 48) return h.toFixed(1) + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }

  function paint(stamp, state) {
    /* One badge, reused: the generator puts `<span id="feed-freshness">` in the header of every
     * page. It is deliberately a separate element from the API-mode badge so that "the API
     * answered my browser just now" and "the alert engine sampled recently" cannot be confused. */
    var el = document.getElementById('feed-freshness');
    if (!el) return;
    var cls, text, title;
    if (state === 'loading') {
      cls = 'badge neutral'; text = 'engine …';
      title = 'Reading the age of the last alert-engine sample.';
    } else if (state === 'error') {
      cls = 'badge warn'; text = 'engine unreadable';
      title = 'data/live/feed.json could not be read, so the age of the last sample is unknown. '
        + 'The alert feeds below may be out of date — this badge never assumes they are current.';
    } else if (state === 'fresh') {
      cls = 'badge live'; text = 'engine ' + human(stamp.min);
      title = 'The alert engine sampled the demo API ' + human(stamp.min) + ' ('
        + stamp.iso + '). Fresh means under ' + WARN_MIN + ' minutes old.';
    } else if (state === 'warn') {
      cls = 'badge warn'; text = 'engine ' + human(stamp.min);
      title = 'The newest alert-engine sample is ' + human(stamp.min) + ' (' + stamp.iso + '). '
        + 'Over ' + WARN_MIN + ' minutes means the scheduled sampler has not run recently; '
        + 'moves since then are not in the feeds.';
    } else {
      cls = 'badge stale'; text = 'STALE · engine ' + human(stamp.min);
      title = 'The newest alert-engine sample is ' + human(stamp.min) + ' (' + stamp.iso + '), '
        + 'older than the ' + STALE_MIN + '-minute limit. Treat every feed on this page as '
        + 'historical, not live. The page says so on purpose rather than showing a stale feed '
        + 'under a "live" label.';
    }
    el.className = cls;
    el.textContent = text;
    el.title = title;
    el.setAttribute('data-age-minutes', stamp && stamp.min !== null ? String(stamp.min) : '');
    el.setAttribute('data-state', state);
  }

  function classify(min) {
    if (min === null) return 'error';
    if (min < WARN_MIN) return 'fresh';
    if (min < STALE_MIN) return 'warn';
    return 'stale';
  }

  /* Optional machine-readable bundle written by the generator (data/dash-quality.json).
   * Absent is fine: the thresholds above are the fallback and are the same numbers. */
  function loadQuality(base, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', base + 'data/dash-quality.json?_=' + Date.now(), true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      if (req.status >= 200 && req.status < 300) {
        try {
          var q = JSON.parse(req.responseText);
          if (q && q.freshness) {
            if (typeof q.freshness.warn_minutes === 'number') WARN_MIN = q.freshness.warn_minutes;
            if (typeof q.freshness.stale_minutes === 'number') STALE_MIN = q.freshness.stale_minutes;
          }
          cb(q);
          return;
        } catch (e) { /* fall through with defaults */ }
      }
      cb(null);
    };
    req.send();
  }

  function loadFeed(base, cb) {
    var req = new XMLHttpRequest();
    /* Cache-buster so a republished feed is picked up on the next page view; no third party. */
    req.open('GET', base + 'data/live/feed.json?_=' + Date.now(), true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      if (req.status >= 200 && req.status < 300) {
        try { cb(JSON.parse(req.responseText)); return; } catch (e) { /* unreadable */ }
      }
      cb(null);
    };
    req.send();
  }

  /* ------------------------------------------------------- topic deep links */
  /* `dashboard.html?topic=golf` and `alerts/index.html?topic=golf` were previously accepted by
   * neither page, so a "Golf" nav entry could not open the dashboard already filtered. This
   * applies the filter by clicking the filter control the page already has, so it stays in sync
   * with each page's own logic instead of duplicating it. */
  function applyTopicFilter() {
    var m = location.search.match(/[?&]topic=([a-z]+)/i);
    if (!m) return;
    var want = m[1].toLowerCase();
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var btns = document.querySelectorAll('#filters button, #topic-filter button, .filters button');
      var hit = null;
      for (var i = 0; i < btns.length; i++) {
        var key = (btns[i].getAttribute('data-topic') || btns[i].getAttribute('data-filter')
          || btns[i].textContent || '').toLowerCase();
        if (key.indexOf(want) !== -1) { hit = btns[i]; break; }
      }
      if (hit) {
        hit.click();
        clearInterval(timer);
        return;
      }
      if (tries * 250 >= FILTER_TOPIC_TTL_MS) clearInterval(timer);
    }, 250);
  }

  function init() {
    var base = root();
    paint(null, 'loading');
    loadQuality(base, function () {
      paint(null, 'loading');
      loadFeed(base, function (feed) {
        var iso = feed && feed.meta && feed.meta.generated_at ? feed.meta.generated_at : null;
        var min = ageMinutes(iso);
        paint({ min: min, iso: iso || 'missing from feed.json' }, classify(min));
      });
    });
    applyTopicFilter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
