#!/usr/bin/env node
/** Offline guard for the demo-account privacy warning.
 *
 * WHY: `.github/workflows/demo-account.yml` commits the verbatim balance, positions, fills and
 * settlements into `data/account.json` in a PUBLIC repository, and GitHub Pages serves that file.
 * The page therefore must say so, above the data, before anyone enables the workflow. This is a
 * documentation/behaviour invariant, not a Kalshi claim: the links it requires are GitHub's own.
 *
 * It also fails if the publishing step disappears from the workflow, because then the warning would
 * be describing something the site no longer does (a stale claim is its own defect).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_TEXT = [
  'id="privacy-warning"',
  'published, not private',
  'data/account.json',
  'Pages sites are publicly available',
  'removing-sensitive-data-from-a-repository',
  'docs/DEMO_ACCOUNT.md',
  'connected: false',
];

export function audit(html) {
  const missing = REQUIRED_TEXT.filter((needle) => !html.includes(needle));
  const notice = html.match(/<div class="notice warn" id="privacy-warning">[\s\S]*?<\/div>/);
  /* The warning must precede the data container, not follow it. */
  const order = html.indexOf('id="privacy-warning"') !== -1
    && html.indexOf('id="privacy-warning"') < html.indexOf('id="account-data"');
  return { missing, order, ok: missing.length === 0 && order };
}

function main() {
  let checks = 0;
  const ok = (label, fn) => { fn(); checks++; console.log('ok   ' + label); };

  for (const file of ['templates/demo-account.tpl', 'demo-account.html']) {
    const html = readFileSync(file, 'utf8');
    const result = audit(html);
    ok(file + ': the public-snapshot warning is present with GitHub links', () => assert.deepEqual(result.missing, []));
    ok(file + ': the warning is rendered above the account data', () => assert.equal(result.order, true));
  }

  ok('the workflow that publishes the snapshot still exists (so the warning is not stale)', () => {
    const yml = readFileSync('.github/workflows/demo-account.yml', 'utf8');
    assert.match(yml, /git add data\/account\.json/);
    assert.match(yml, /git push/);
  });

  /* Negative controls: the same audit must reject a page that quietly drops the warning. */
  const real = readFileSync('templates/demo-account.tpl', 'utf8');
  ok('negative control: a page without the warning fails', () => {
    const without = real.replace(/<div class="notice warn" id="privacy-warning">[\s\S]*?<\/div>\n\n/, '');
    assert.notEqual(without, real);
    assert.equal(audit(without).ok, false);
  });
  ok('negative control: a warning without the history link fails', () => {
    const weak = real.replace('removing-sensitive-data-from-a-repository', 'example');
    assert.equal(audit(weak).ok, false);
  });
  ok('negative control: a warning placed after the data fails', () => {
    const notice = real.match(/<div class="notice warn" id="privacy-warning">[\s\S]*?<\/div>/)[0];
    const moved = real.replace(notice + '\n\n', '').replace('</main>', notice + '\n</main>');
    assert.ok(moved.indexOf('id="privacy-warning"') > moved.indexOf('id="account-data"'));
    assert.equal(audit(moved).order, false);
  });

  console.log('\naccount privacy: ' + checks + ' checks passed (offline; no account data read or published).');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
