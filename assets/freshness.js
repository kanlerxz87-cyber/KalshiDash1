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
    paintAsOf(stamp, state);
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

  /* AS-OF LINE (added 2026-11-21).
   *
   * A badge that ages in the browser is correct for a live visitor and useless everywhere else:
   * in a screenshot, a printed page, a PDF, or an archived snapshot, "engine 3 min ago" stays
   * frozen while the data behind it keeps getting older. On 2026-11-21 the committed feed was
   * ~3 h old while the page still rendered a healthy-looking header. So every page ALSO prints
   * the absolute sample time and, on the first paint, the age measured at load. The age word is
   * refreshed on the same 30-second tick as the badge; the timestamp never changes.
   *
   * The element is optional: if a template does not carry it, nothing breaks. */
  function paintAsOf(stamp, state) {
    var el = document.getElementById('feed-asof');
    if (!el) return;
    var iso = stamp && stamp.iso ? String(stamp.iso) : null;
    if (state === 'loading') {
      el.textContent = 'Data as of …';
      return;
    }
    if (state === 'error' || !iso) {
      el.textContent = 'Data as of: unknown — the committed feed could not be read. Do not assume it is current.';
      el.setAttribute('data-state', 'error');
      return;
    }
    var when = iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
    var age = human(stamp.min);
    el.innerHTML = 'Alert engine sampled <b>' + esc(when) + '</b> — that is <b>' + esc(age) + '</b>.'
      + (state === 'stale'
        ? ' <span class="warn"><b>STALE</b>: beyond the ' + STALE_MIN + '-minute limit, so the feeds on this page are historical, not live.</span>'
        : state === 'warn'
          ? ' <span class="warn">Late: past the ' + WARN_MIN + '-minute target; the scheduled sampler may not be running.</span>'
          : '');
    el.setAttribute('data-state', state);
    el.setAttribute('data-asof', iso);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
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
  /* `dashboard.html?topic=golf`, `markets.html?topic=golf`, and `alerts/index.html?topic=golf`
   * apply the filter by clicking the page's own topic button so it stays in sync with each
   * page's logic instead of duplicating it (F-ALERTS-02: updated selectors to match the actual
   * #topic-chips, #markets-topic-chips, and #topic-tabs containers). */
  function applyTopicFilter() {
    var m = location.search.match(/[?&]topic=([a-z]+)/i);
    if (!m) return;
    var want = m[1].toLowerCase();
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var btns = document.querySelectorAll(
        '#topic-chips button, #markets-topic-chips button, #topic-tabs button, #filters button, #topic-filter button, .filters button'
      );
      var hit = null;
      for (var i = 0; i < btns.length; i++) {
        var exact = (btns[i].getAttribute('data-topic') || btns[i].getAttribute('data-filter') || '').toLowerCase();
        if (exact && exact === want) { hit = btns[i]; break; }
      }
      if (!hit) {
        for (var j = 0; j < btns.length; j++) {
          var label = (btns[j].textContent || '').toLowerCase();
          if (label.indexOf(want) !== -1) { hit = btns[j]; break; }
        }
      }
      if (hit) {
        hit.click();
        clearInterval(timer);
        return;
      }
      if (tries * 250 >= FILTER_TOPIC_TTL_MS) clearInterval(timer);
    }, 250);
  }

  var lastStamp = null;
  var lastState = 'loading';

  function init() {
    var base = root();
    paint(null, 'loading');
    loadQuality(base, function () {
      paint(null, 'loading');
      loadFeed(base, function (feed) {
        var iso = feed && feed.meta && feed.meta.generated_at ? feed.meta.generated_at : null;
        var min = ageMinutes(iso);
        lastStamp = { min: min, iso: iso || 'missing from feed.json' };
        lastState = classify(min);
        paint(lastStamp, lastState);
        /* Keep the measured age honest while a visitor has the page open. The SOURCE of every
         * tick is the visitor's own clock and the committed timestamp — no network call, no
         * third party. Re-classifying means a page left open for an hour starts saying STALE on
         * its own, instead of staying green forever. */
        var ticker = null;
        var tick = function () {
          if (!lastStamp) return;
          var next = { min: ageMinutes(lastStamp.iso), iso: lastStamp.iso };
          if (next.min === null) return;
          lastStamp = next;
          lastState = classify(next.min);
          paint(next, lastState);
        };
        var start = function () { if (!ticker) ticker = setInterval(tick, 30 * 1000); };
        var stop = function () { if (ticker) { clearInterval(ticker); ticker = null; } };
        start();
        /* Stop the tick as soon as the page is hidden or torn down: nothing on screen needs it,
         * and an abandoned timer is what keeps an automated harness (jsdom) alive. A real browser
         * tab also gets the battery saving from not repainting a hidden page. */
        window.addEventListener('pagehide', stop);
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') { stop(); return; }
          /* Re-arm on return: measure once right away, then resume the 30-second tick. (The first
           * version of this block armed a 0 ms interval and immediately cleared it, so the age
           * stopped advancing after a tab was revisited. Fixed here.) */
          tick();
          start();
        });
      });
    });
    applyTopicFilter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
