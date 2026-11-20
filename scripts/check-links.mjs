#!/usr/bin/env node
// Offline check of the generated site (repository root, see build-site.mjs):
//  - every internal href/src resolves to an existing file (and #anchor exists if given)
//  - generated pages have a <title>, a <h1>, the shared navigation, stylesheet and script
//    (archive/ holds prior-session pages: link check only)
// External links are listed (not fetched) so reviewers can check them.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, "..");

const SKIP = new Set(["node_modules", "scripts"]);
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    if (f.startsWith(".") || SKIP.has(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
  });
}

const pages = walk(DOCS);
const errors = [];
const external = new Set();
const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) {
    const html = readFileSync(file, "utf8");
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
};

for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const rel = file.slice(DOCS.length + 1);
  // Generated pages must carry the shared template. Archived prior-session pages are checked for links only.
  // docs/ is an independent suite (its own template, nav and stylesheet under docs/assets/) and is
  // therefore checked for links but not against the root-page template. Added by the integration session.
  if (!rel.startsWith("archive/") && !rel.startsWith("docs/")) {
    if (!/<title>[^<]+<\/title>/.test(html)) errors.push(`${rel}: missing <title>`);
    if (!/<h1[ >]/.test(html)) errors.push(`${rel}: missing <h1>`);
    if (!html.includes('class="sidebar"')) errors.push(`${rel}: missing navigation`);
    if (!/href="[^"]*assets\/style\.css"/.test(html)) errors.push(`${rel}: missing stylesheet link`);
    if (!/src="[^"]*assets\/app\.js"/.test(html)) errors.push(`${rel}: missing app.js`);
  }

  for (const m of html.matchAll(/\b(href|src)="([^"]*)"/g)) {
    const raw = m[2];
    if (raw === "" || raw.startsWith("mailto:") || raw.startsWith("data:")) continue;
    // JavaScript template placeholders inside archived inline scripts are not links.
    if (raw.includes("${")) continue;
    if (/^https?:\/\//.test(raw)) { external.add(raw); continue; }
    const [pathPart, hash] = raw.split("#");
    if (pathPart === "") {
      if (hash && !idsOf(file).has(hash)) errors.push(`${rel}: missing anchor #${hash}`);
      continue;
    }
    const target = resolve(dirname(file), pathPart);
    if (!target.startsWith(DOCS)) { errors.push(`${rel}: link escapes site: ${raw}`); continue; }
    if (!existsSync(target)) { errors.push(`${rel}: broken link ${raw}`); continue; }
    if (hash && target.endsWith(".html") && !idsOf(target).has(hash)) errors.push(`${rel}: missing anchor ${raw}`);
  }
}

console.log(`Checked ${pages.length} pages.`);
console.log(`External links (not fetched, listed for review): ${external.size}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log("No broken internal links.");
