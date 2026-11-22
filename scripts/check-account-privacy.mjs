#!/usr/bin/env node
/** Offline guard for the public demo-account snapshot warning.
 *
 * WHY: `.github/workflows/demo-account.yml` commits the verbatim balance, positions, fills and
 * settlements into `data/account.json` in a PUBLIC repository, and GitHub Pages serves that file
 * from the same branch. The site therefore has to say so, above the data, before anyone enables
 * the workflow. The warning and its row (F-85) already exist; nothing here re-publishes or reads
 * account data — only the packaged page text is inspected.
 *
 * The required links are GitHub's own documentation of repository/Pages visibility and of what
 * history rewriting can and cannot remove. They are publisher links, not Kalshi claims.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WARNING_ID = 'id="public-snapshot-warning"';
export const REQUIRED_TEXT = [
  WARNING_ID,
  'the snapshot is public',
  'data/account.json',
  'connected: false',
  'about-repositories#about-repository-visibility',
  'removing-sensitive-data-from-a-repository',
  'docs/DEMO_ACCOUNT.md',
];

/** @returns {{missing: string[], order: boolean, crossRef: boolean, ok: boolean}} */
export function audit(html) {
  const missing = REQUIRED_TEXT.filter((needle) => !html.includes(needle));
  const start = html.indexOf(WARNING_ID);
  const data = html.indexOf('id="account-data"');
  const order = start !== -1 && data !== -1 && start < data;
  /* The row link must say what it links to: "F-82 on Flagged for review" pointing at #F-85 is a
   * one-word falsehood a reader has no way to notice. */
  const link = html.match(/<a href="flagged\.html#(F-[A-Za-z0-9-]+)">([^<]+)<\/a>/);
  const crossRef = !!link && link[2].trim().startsWith(link[1]);
  return { missing, order, crossRef, ok: missing.length === 0 && order && crossRef };
}

function main() {
  let checks = 0;
  const ok = (label, fn) => { fn(); checks++; console.log('ok   ' + label); };

  for (const file of ['templates/demo-account.tpl', 'demo-account.html']) {
    const html = readFileSync(file, 'utf8');
    const result = audit(html);
    ok(file + ': the public-snapshot warning and its publisher links are present', () => assert.deepEqual(result.missing, []));
    ok(file + ': the warning is rendered above the account data', () => assert.equal(result.order, true));
    ok(file + ': the Flagged cross-reference label matches the row it links to', () => assert.equal(result.crossRef, true));
  }

  ok('the workflow that publishes the snapshot still exists (so the warning is not stale)', () => {
    const yml = readFileSync('.github/workflows/demo-account.yml', 'utf8');
    assert.match(yml, /git add data\/account\.json/);
    assert.match(yml, /git push/);
  });

  /* Negative controls: the audit must reject a page that quietly drops or mislabels the warning. */
  const real = readFileSync('templates/demo-account.tpl', 'utf8');
  ok('negative control: a page without the warning fails', () => {
    const without = real.replace(/<div class="notice bad" id="public-snapshot-warning">[\s\S]*?<\/div>\n/, '');
    assert.notEqual(without, real);
    assert.equal(audit(without).ok, false);
  });
  ok('negative control: a warning without the history-removal link fails', () => {
    assert.equal(audit(real.replace('removing-sensitive-data-from-a-repository', 'example')).ok, false);
  });
  ok('negative control: a warning placed after the data fails', () => {
    const block = real.match(/<div class="notice bad" id="public-snapshot-warning">[\s\S]*?<\/div>/)[0];
    const moved = real.replace(block + '\n', '').replace('</main>', block + '\n</main>');
    assert.ok(moved.indexOf(WARNING_ID) > moved.indexOf('id="account-data"'));
    assert.equal(audit(moved).order, false);
  });
  ok('negative control: the pre-fix mislabelled cross-reference ("F-82" linking #F-85) fails', () => {
    const mislabelled = real.replace('<a href="flagged.html#F-85">F-85 on', '<a href="flagged.html#F-85">F-82 on');
    assert.notEqual(mislabelled, real, 'fixture must actually change the label');
    assert.equal(audit(mislabelled).crossRef, false);
  });

  console.log('\naccount privacy: ' + checks + ' checks passed (offline; no account data read or published).');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
