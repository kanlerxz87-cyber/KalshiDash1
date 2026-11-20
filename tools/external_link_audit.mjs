#!/usr/bin/env node
/*
 * external_link_audit.mjs — re-runnable external-link liveness audit (V2, session-5bb909f6).
 *
 * Why this exists: the two internal link checkers (scripts/check-links.mjs and
 * tools/linkcheck.py) verify internal links only and print external links
 * "not fetched". This script fetches every external http(s) link in the published
 * HTML tree and reports its status, so the "External links (not fetched)" gap can
 * be closed by anyone with outbound network access.
 *
 * Where it runs: any machine or CI job with general outbound HTTPS access.
 * It could NOT run inside the Arena build sandbox (its egress allowlist covers
 * github.com / npmjs / pypi only), so the V2 table in
 * verification/2026-11-20-5bb909f6.md was produced with the Arena fetch tool
 * instead. Nothing in that table is guessed; every row names the URL probed.
 *
 * Usage:
 *   node tools/external_link_audit.mjs            # audit all external links
 *   node tools/external_link_audit.mjs --sample   # one URL per host (fast pass)
 *   node tools/external_link_audit.mjs --urls URL1,URL2   # exact URLs only
 *
 * Output: markdown table on stdout (| URL | Host | Status | Final URL | Note |).
 * Exit code 1 if any link fails (network error or HTTP >= 400).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'archive', 'templates']);
const TIMEOUT_MS = 15000;

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) htmlFiles(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function collectLinks() {
  const links = new Map(); // url -> first file seen
  for (const file of htmlFiles(ROOT)) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      const url = m[1].replaceAll('&amp;', '&');
      if (!links.has(url)) links.set(url, file.slice(ROOT.length));
    }
  }
  return links;
}

async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // HEAD first; fall back to GET for servers that reject HEAD.
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal })
      .catch(() => null);
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    }
    return { status: res.status, finalUrl: res.url, ok: res.ok };
  } catch (e) {
    return { status: 0, finalUrl: '', ok: false, note: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const args = process.argv.slice(2);
const links = collectLinks();
let urls = [...links.keys()];
if (args.includes('--sample')) {
  const seen = new Set();
  urls = urls.filter((u) => {
    const host = new URL(u).host;
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
}
const idx = args.indexOf('--urls');
if (idx >= 0 && args[idx + 1]) urls = args[idx + 1].split(',');

console.log('| URL | Host | Status | Final URL | Note |');
console.log('| --- | --- | --- | --- | --- |');
let failures = 0;
for (const url of urls) {
  const r = await probe(url);
  const host = new URL(url).host;
  if (!r.ok) failures++;
  console.log(`| ${url} | ${host} | ${r.status || 'ERR'} | ${r.finalUrl || ''} | ${r.note || (r.ok ? '' : 'failing')} |`);
}
console.error(`\n${urls.length} URLs probed, ${failures} failing.`);
process.exit(failures ? 1 : 0);
