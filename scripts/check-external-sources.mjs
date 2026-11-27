#!/usr/bin/env node
/* check-external-sources.mjs — is every Kalshi documentation page this site cites still listed
 * by Kalshi itself?
 *
 * WHY THIS EXISTS
 * ---------------
 * Every table row on the site links an official source, and `scripts/check-row-sources.mjs`
 * proves each row *carries* an official-publisher link. The two internal link checkers prove the
 * site does not link its own missing files. Nothing, however, proved that the external pages
 * those links point at still exist — the repository's own `tools/external_link_audit.mjs` says it
 * "could NOT run inside the Arena build sandbox", is not wired into any workflow, and no CI job
 * has ever run it. So a silently renamed Kalshi doc page could turn a "source" link into a dead
 * end without any check noticing.
 *
 * WHAT IT CHECKS (and what it deliberately does not)
 * --------------------------------------------------
 * Kalshi publishes its own documentation index at https://docs.kalshi.com/llms.txt and a page
 * listing at https://docs.kalshi.com/sitemap.xml. This script extracts every `docs.kalshi.com`
 * URL cited by `templates/*.tpl` and `data/sources.json`, normalises the two URL forms the site
 * uses (the page form `/getting_started/demo_env` and the Markdown form
 * `/getting_started/demo_env.md`), and asks whether the publisher lists that page.
 *
 *   * It verifies EXISTENCE and FORM. It does NOT read page content, so it cannot and does not
 *     claim that a page still says what the site quotes from it. Content claims stay with the
 *     dated verification records under `verification/`.
 *   * It never guesses a replacement URL. A page the publisher does not list is reported
 *     `broken`/`unlisted` with the evidence, not "fixed" by a plausible-looking path.
 *   * It does not touch any non-Kalshi host (GitHub, AAA, spec pages). Scope is stated in the
 *     output file so the artifact cannot be read as a site-wide external-link audit.
 *
 * MODES
 *   node scripts/check-external-sources.mjs --selftest
 *       Offline. Pure-function tests with positive and negative controls; no network.
 *   node scripts/check-external-sources.mjs --fetch --write
 *       Fetches llms.txt + sitemap.xml from docs.kalshi.com, judges every citation, and writes
 *       data/external-source-check.json. Needs general HTTPS egress (GitHub Actions has it; the
 *       Arena sandbox does not). If the publisher cannot be reached it writes `verified: false`
 *       with the reason and exits 0 — an upstream outage must be recorded, not mistaken for a
 *       broken citation.
 *   node scripts/check-external-sources.mjs --check
 *       Offline gate used by `npm test`. Fails if the evidence file is missing, malformed, marked
 *       unverified, or no longer covers every citation currently on the site. BROKEN citations
 *       are reported and do not fail the gate: an upstream rename must never take the published
 *       dashboard down. The evidence file is the review artifact for those.
 *
 * Exit codes: 0 ok, 1 failed check, 2 could not verify (network).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_FILE = path.join(ROOT, 'data', 'external-source-check.json');
const DOCS_HOST = 'docs.kalshi.com';
const LLMS_URL = 'https://docs.kalshi.com/llms.txt';
const SITEMAP_URL = 'https://docs.kalshi.com/sitemap.xml';
const SCOPE = `citations to ${DOCS_HOST} only (existence/form, not page content)`;

/* ------------------------------------------------------------------ parsing */

/* A URL straight out of a template can carry HTML entities and Markdown escapes:
 * `?tags=Oil%20and%20energy&amp;limit=2` and `getting\_started/api\_environments`. Normalise
 * before comparing, or a correct link would be reported broken for the wrong reason. */
export function normaliseUrl(raw) {
  return String(raw)
    .replace(/&amp;/g, '&')
    .replace(/\\_/g, '_')
    .replace(/&quot;|&#39;/g, '')
    .replace(/[.,;:]+$/, '');
}

export function stripAnchor(url) {
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

export function stripQuery(url) {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/* The site cites two forms of the same page. Reduce both to the canonical page URL so the
 * sitemap (page form) and llms.txt (Markdown form) can be compared against one key. */
export function toPageForm(url) {
  const u = stripQuery(stripAnchor(normaliseUrl(url)));
  return u.endsWith('.md') ? u.slice(0, -3) : u;
}

export function formOf(url) {
  const u = stripAnchor(normaliseUrl(url));
  if (/\.md$/i.test(stripQuery(u))) return 'markdown';
  if (/\.(txt|xml|json)$/i.test(stripQuery(u))) return 'index-or-asset';
  return 'page';
}

export function isKalshiDocsUrl(url) {
  try {
    const u = new URL(normaliseUrl(url));
    return u.protocol === 'https:' && u.hostname === DOCS_HOST && !u.username && !u.password && !u.port;
  } catch { return false; }
}

/* A citation is a LINK the reader can follow: an `href` attribute. A documentation URL that is
 * merely quoted in prose is not one, and treating it as one produces a false positive — the
 * Flagged page names a dead Kalshi path in <code> when it explains why that path is wrong, and the
 * first version of this extractor dutifully reported the explanation as a broken citation.
 * data/sources.json is structured, so its `url` fields are read directly instead (readCitations). */
export function extractCitations(text) {
  const out = [];
  for (const m of String(text).matchAll(/\bhref\s*=\s*["'](https:\/\/docs\.kalshi\.com[^"']*)["']/g)) {
    const url = normaliseUrl(m[1]);
    if (!isKalshiDocsUrl(url)) continue;
    out.push(url);
  }
  return out;
}

/* llms.txt is a Markdown bullet list: `- [Title](https://docs.kalshi.com/path.md): description`.
 * Only the link target matters; nothing is inferred from the title. */
export function indexFromLlms(text) {
  const set = new Set();
  for (const m of String(text).matchAll(/\((https:\/\/docs\.kalshi\.com\/[^)\s]+)\)/g)) {
    const url = toPageForm(normaliseUrl(m[1]));
    if (isKalshiDocsUrl(url)) set.add(url);
  }
  return set;
}

export function indexFromSitemap(text) {
  const set = new Set();
  const raw = String(text);
  /* The publisher serves <loc> elements; the fetch tooling may hand us the flattened text. The
   * URL pattern is the stable part, so match the pattern and ignore the surrounding markup. */
  for (const m of raw.matchAll(/https:\/\/docs\.kalshi\.com\/[^\s<>"')\]}]+/g)) {
    const url = toPageForm(normaliseUrl(m[0]));
    if (isKalshiDocsUrl(url)) set.add(url);
  }
  return set;
}

/* A citation is OK if the publisher's sitemap lists its page form. The llms.txt index is the
 * fallback for pages that are listed there but omitted from the sitemap; the output records both
 * booleans so a reviewer can see which evidence supported the verdict. */
export function judge(url, { sitemap, index }) {
  const page = toPageForm(url);
  const inSitemap = sitemap.has(page);
  const inIndex = index.has(page);
  let verdict;
  if (inSitemap || inIndex) verdict = 'ok';
  else if (formOf(url) === 'index-or-asset') verdict = 'skipped';
  else verdict = 'broken';
  return { url, page, form: formOf(url), in_sitemap: inSitemap, in_llms_index: inIndex, verdict };
}

/* --------------------------------------------------------------- collection */

function readCitations() {
  const byTarget = new Map();
  const add = (raw, source) => {
    const url = stripAnchor(normaliseUrl(raw));
    if (!isKalshiDocsUrl(url)) return;
    if (formOf(url) === 'index-or-asset') return;      /* llms.txt itself, not a citation */
    const key = toPageForm(url);
    if (!byTarget.has(key)) byTarget.set(key, { target: key, forms: new Set(), cited_in: new Set() });
    const entry = byTarget.get(key);
    entry.forms.add(formOf(url));
    entry.cited_in.add(source);
  };

  const tplDir = path.join(ROOT, 'templates');
  for (const name of fs.readdirSync(tplDir).sort()) {
    if (!name.endsWith('.tpl')) continue;
    const text = fs.readFileSync(path.join(tplDir, name), 'utf8');
    for (const url of extractCitations(text)) add(url, 'templates/' + name);
  }

  const sourcesPath = path.join(ROOT, 'data', 'sources.json');
  if (fs.existsSync(sourcesPath)) {
    const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    for (const group of ['docs', 'api', 'external']) {
      for (const row of sources[group] || []) if (row && row.url) add(row.url, 'data/sources.json');
    }
  }

  return [...byTarget.values()]
    .map((e) => ({ target: e.target, forms: [...e.forms].sort(), cited_in: [...e.cited_in].sort() }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

/* --------------------------------------------------------------------- I/O */

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'KalshiDash1 external-source check (repository verification tool)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/* ------------------------------------------------------------------- modes */

function selftest() {
  let pass = 0;
  const failures = [];
  const ok = (cond, label) => { if (cond) { pass += 1; console.log('ok   ' + label); } else { failures.push(label); console.log('FAIL ' + label); } };

  ok(toPageForm('https://docs.kalshi.com/api-reference/market/get-market.md')
    === 'https://docs.kalshi.com/api-reference/market/get-market', 'markdown form reduces to the page form');
  ok(toPageForm('https://docs.kalshi.com/api-reference/market/get-market#schema')
    === 'https://docs.kalshi.com/api-reference/market/get-market', 'an anchor is dropped before comparing');
  ok(toPageForm('https://docs.kalshi.com/getting\\_started/demo\\_env')
    === 'https://docs.kalshi.com/getting_started/demo_env', 'a Markdown-escaped path is unescaped');
  ok(normaliseUrl('https://docs.kalshi.com/x?tags=Oil%20and%20energy&amp;limit=2')
    === 'https://docs.kalshi.com/x?tags=Oil%20and%20energy&limit=2', 'an HTML-escaped ampersand is unescaped');
  ok(formOf('https://docs.kalshi.com/getting_started/demo_env') === 'page', 'page form is detected');
  ok(formOf('https://docs.kalshi.com/api-reference/market/get-market.md') === 'markdown', 'markdown form is detected');
  ok(formOf('https://docs.kalshi.com/llms.txt') === 'index-or-asset', 'the index file itself is not a citation');

  ok(isKalshiDocsUrl('https://docs.kalshi.com/getting_started/demo_env'), 'the publisher host is accepted');
  ok(!isKalshiDocsUrl('https://docs.kalshi.com.evil.example/getting_started/demo_env'), 'a lookalike suffix is rejected');
  ok(!isKalshiDocsUrl('http://docs.kalshi.com/getting_started/demo_env'), 'plain http is rejected');
  ok(!isKalshiDocsUrl('https://user:pw@docs.kalshi.com/x'), 'embedded credentials are rejected');

  const llms = [
    '# API Documentation',
    '- [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md): demo',
    '- [Get Market](https://docs.kalshi.com/api-reference/market/get-market.md): market'
  ].join('\n');
  const index = indexFromLlms(llms);
  ok(index.size === 2 && index.has('https://docs.kalshi.com/getting_started/demo_env'),
    'llms.txt indexing keeps page form and drops .md');

  const sitemap = indexFromSitemap(
    '<url><loc>https://docs.kalshi.com/getting_started/demo_env</loc></url>' +
    '<url><loc>https://docs.kalshi.com/getting\\_started/market\\_lifecycle</loc></url>');
  ok(sitemap.size === 2 && sitemap.has('https://docs.kalshi.com/getting_started/market_lifecycle'),
    'sitemap indexing unescapes Markdown-escaped paths');

  ok(judge('https://docs.kalshi.com/getting_started/demo_env', { sitemap, index }).verdict === 'ok',
    'positive: a page the publisher lists is ok');
  ok(judge('https://docs.kalshi.com/api-reference/market/get-market.md', { sitemap: new Set(), index }).verdict === 'ok',
    'positive: a markdown citation listed only in llms.txt is ok');
  ok(judge('https://docs.kalshi.com/removed/page', { sitemap, index }).verdict === 'broken',
    'negative control: a page the publisher does not list is broken');
  ok(judge('https://docs.kalshi.com/removed/page', { sitemap: new Set(), index: new Set() }).verdict === 'broken',
    'negative control: an empty index cannot promote a page to ok');
  ok(judge('https://docs.kalshi.com/llms.txt', { sitemap, index }).verdict === 'skipped',
    'the index file is skipped, not reported broken');

  const cites = extractCitations('<a href="https://docs.kalshi.com/a">a</a> and <a href="https://docs.kalshi.com/c.md">c</a>');
  ok(cites.length === 2 && cites[1] === 'https://docs.kalshi.com/c.md',
    'citation extraction finds every linked page in either form');
  ok(extractCitations('<code>https://docs.kalshi.com/removed/path</code> is wrong').length === 0,
    'negative control: a URL quoted in prose is not a citation (it would be a false positive)');

  if (failures.length) { console.error(`\nexternal-source selftest: ${failures.length} FAILED`); process.exit(1); }
  console.log(`\nexternal-source selftest: ${pass} checks passed (offline, no network).`);
}

function buildEvidence({ llmsText, sitemapText, source }) {
  const index = indexFromLlms(llmsText);
  const sitemap = indexFromSitemap(sitemapText);
  const citations = readCitations().map((c) => ({ ...c, ...judge(c.target, { sitemap, index }) }));
  const broken = citations.filter((c) => c.verdict === 'broken').map((c) => c.page);
  return {
    checked_at: new Date().toISOString(),
    verified: true,
    scope: SCOPE,
    method:
      'Every docs.kalshi.com citation found in templates/*.tpl and data/sources.json is reduced to its '
      + 'canonical page URL and looked up in the publisher\'s own listings: llms.txt (the documentation '
      + 'index) and sitemap.xml. Two URL forms are normalised onto one key (/path and /path.md). '
      + 'Existence and form only — page content is not read, so this file never asserts what a page says.',
    sources: {
      llms_txt: { url: LLMS_URL, entry: source.llms, pages_listed: index.size },
      sitemap_xml: { url: SITEMAP_URL, entry: source.sitemap, pages_listed: sitemap.size }
    },
    summary: {
      distinct_citations: citations.length,
      ok: citations.filter((c) => c.verdict === 'ok').length,
      broken: broken.length,
      broken_pages: broken
    },
    citations
  };
}

function writeEvidence(doc) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(doc, null, 2) + '\n');
}

async function fetchMode(write) {
  let llmsText;
  let sitemapText;
  try {
    llmsText = await fetchText(LLMS_URL);
    sitemapText = await fetchText(SITEMAP_URL);
  } catch (e) {
    const doc = {
      checked_at: new Date().toISOString(),
      verified: false,
      scope: SCOPE,
      reason: `The publisher could not be reached from this environment: ${e && e.message ? e.message : e}. `
        + 'No verdict is recorded; an outage is not a broken citation.',
      citations: []
    };
    if (write) writeEvidence(doc);
    console.error('could not verify: ' + doc.reason);
    process.exit(2);
  }
  const doc = buildEvidence({
    llmsText, sitemapText,
    source: { llms: 'fetched', sitemap: 'fetched' }
  });
  if (write) writeEvidence(doc);
  console.log(`external sources: ${doc.summary.distinct_citations} distinct citations, `
    + `${doc.summary.ok} listed by the publisher, ${doc.summary.broken} broken.`);
  for (const page of doc.summary.broken_pages) console.log('  BROKEN  ' + page);
  if (doc.summary.broken) {
    console.log('::warning::' + doc.summary.broken + ' cited Kalshi doc page(s) are not listed by the publisher.');
  }
}

function checkMode() {
  if (!fs.existsSync(OUT_FILE)) {
    console.error('external-source check: data/external-source-check.json is missing.');
    console.error('  Produce it with the "External source check" workflow (it needs general HTTPS egress).');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  const problems = [];
  if (doc.verified !== true) {
    problems.push(`the evidence is marked unverified (${doc.reason || 'no reason recorded'})`);
  }
  if (!Array.isArray(doc.citations)) problems.push('the evidence has no citations array');
  const recorded = new Set((doc.citations || []).map((c) => c.target));
  const current = readCitations().map((c) => c.target);
  const uncovered = current.filter((t) => !recorded.has(t));
  const stale = [...recorded].filter((t) => !current.includes(t));
  /* A citation the evidence does not cover must not publish silently: that is the state in which
   * the broken-link defect F-SOURCE-02 existed. A citation that has been REMOVED from the site is
   * the expected, good outcome of a fix, so it is reported as a reminder and never fails — failing
   * it would make the gate red until a network job happened to re-run. */
  if (uncovered.length) {
    problems.push(`${uncovered.length} citation(s) on the site are not covered by the evidence `
      + `(${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}); re-run the external source check`);
  }
  if (stale.length) {
    console.log(`  ${stale.length} recorded citation(s) are no longer on the site — the evidence can be refreshed `
      + `by the external-sources workflow (expected after a citation fix): ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', …' : ''}`);
  }

  const broken = (doc.citations || []).filter((c) => c.verdict === 'broken');
  console.log(`external-source check — ${doc.citations ? doc.citations.length : 0} distinct citations, `
    + `evidence checked_at ${doc.checked_at || 'unknown'}`);
  for (const b of broken) {
    console.log(`  NEEDS REVIEW  ${b.page} — cited in ${(b.cited_in || []).join(', ')}`);
    console.log('                not listed in llms.txt or sitemap.xml; recorded, not auto-fixed');
  }
  if (problems.length) {
    for (const p of problems) console.error('FAIL ' + p);
    console.error(`external-source check: ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(`external-source check: coverage complete (${current.length} citations). `
    + `${broken.length} broken citation(s) recorded, none auto-fixed, none blocking publication.`);
}

/* -------------------------------------------------------------------- main */

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
} else if (argv.includes('--fetch')) {
  await fetchMode(argv.includes('--write'));
} else if (argv.includes('--check')) {
  checkMode();
} else {
  console.log('usage: node scripts/check-external-sources.mjs --selftest | --fetch [--write] | --check');
  process.exit(1);
}
