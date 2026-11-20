/* suggestions.js — review workflow for improvement proposals. */
(function () {
  'use strict';
  App.renderHeader('suggestions.html');
  App.renderFooter();
  var K = window.K;

  function render() {
    var list = Store.getSuggestions();
    var host = document.getElementById('s-list');
    host.innerHTML = '';
    var counts = { proposed: 0, approved: 0, rejected: 0, implemented: 0 };
    list.forEach(function (s) {
      counts[s.status] = (counts[s.status] || 0) + 1;
      var d = document.createElement('div');
      d.className = 'card';
      var badge = s.status === 'approved' ? '<span class="badge good">approved</span>'
        : s.status === 'rejected' ? '<span class="badge no">rejected</span>'
        : s.status === 'implemented' ? '<span class="badge accent">implemented</span>'
        : '<span class="badge neutral">proposed</span>';
      d.innerHTML =
        '<h3>' + K.esc(s.id) + ' — ' + K.esc(s.title) + ' ' + badge +
          ' <span class="badge warn">impact: ' + K.esc(s.impact) + '</span>' +
          ' <span class="badge neutral">effort: ' + K.esc(s.effort) + '</span></h3>' +
        '<div class="meta">Evidence: ' + K.apiLink(s.source, s.source.length > 90 ? 'source' : s.source) + '</div>' +
        '<div class="body"><p>' + K.esc(s.body) + '</p><p class="small muted"><strong>Why it matters:</strong> ' + K.esc(s.rationale) + '</p></div>' +
        '<div class="btnrow">' +
          (s.status !== 'approved' ? '<button class="btn good small" data-id="' + s.id + '" data-act="approved">Approve</button>' : '') +
          (s.status !== 'rejected' ? '<button class="btn bad small" data-id="' + s.id + '" data-act="rejected">Reject</button>' : '') +
          (s.status !== 'implemented' ? '<button class="btn small" data-id="' + s.id + '" data-act="implemented">Mark implemented</button>' : '') +
          (s.status !== 'proposed' ? '<button class="btn small" data-id="' + s.id + '" data-act="proposed">Back to proposed</button>' : '') +
        '</div>';
      host.appendChild(d);
    });

    document.getElementById('s-summary').textContent =
      counts.proposed + ' proposed · ' + counts.approved + ' approved · ' + counts.rejected + ' rejected · ' + counts.implemented + ' implemented';

    host.querySelectorAll('button[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        Store.updateSuggestion(b.dataset.id, { status: b.dataset.act });
        render();
      });
    });
  }
  render();
})();
