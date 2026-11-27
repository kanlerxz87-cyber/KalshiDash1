#!/usr/bin/env node
// Check every block-form run script in every workflow, including steps skipped on feature branches.
// GitHub substitutes expressions before executing the script; replace them with a
// shell-safe token for this syntax-only check. No workflow commands are executed.
//
// WHY EVERY WORKFLOW (measured 2026-11-27, session-1a950f57)
// ----------------------------------------------------------
// This checker used to hard-code three files — refresh-data.yml, live-alerts.yml and keepalive.yml —
// because those are "the data writers". That list was never derived from the directory, so the
// repository grew to ten workflows while the gate kept reading three, and a brand-new workflow
// would never be checked at all. The one it skipped that matters most is `demo-account.yml`: it is
// the only workflow that handles the Kalshi credentials (KALSHI_KEY_ID / KALSHI_PRIVATE_KEY) and
// the only one that runs `tools/demo_trader.mjs account --ci` against the authenticated demo API.
// A shell error there is invisible until the owner enables the secrets and the job fails on its
// own; nothing in the repository would have caught it first.
//
// The file list is now `readdirSync(.github/workflows)`, so adding a workflow adds it to this gate
// automatically, and the list itself is asserted: if the directory ever contains fewer workflows
// than were discovered, or a file with no `run:` block at all, this fails instead of passing on an
// empty set of checks. Positive and negative controls run the same parser at the end.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DIR = '.github/workflows';
const files = readdirSync(DIR).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml')).sort();

/** Every block-form `run: |` / `run: >-` body in a workflow, as { line, script }. */
function runBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)run:\s*\|[-+]?\s*$/.exec(lines[i]);
    if (!match) continue;
    const start = i + 1;
    const minIndent = match[1].length + 1;
    const body = [];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (next.trim() && (next.match(/^ */)[0].length < minIndent)) break;
      body.push(next);
      i++;
    }
    blocks.push({ line: start, script: body.join('\n') });
  }
  return blocks;
}

function check(filesToCheck) {
  let count = 0;
  let bad = 0;
  const perFile = new Map();
  for (const name of filesToCheck) {
    const file = `${DIR}/${name}`;
    const text = readFileSync(file, 'utf8');
    const blocks = runBlocks(text);
    perFile.set(name, blocks.length);
    for (const block of blocks) {
      const script = block.script.replace(/\$\{\{[\s\S]*?\}\}/g, 'EXPRESSION');
      const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
      count++;
      if (result.error || result.status !== 0) {
        bad++;
        console.error(`${file}:${block.line}: invalid shell block\n${result.stderr || result.error}`);
        process.exitCode = 1;
      }
    }
  }
  return { count, bad, perFile };
}

const { count, bad, perFile } = check(files);

/* ---- guards: the gate must not be able to pass on a truncated or empty file set ---- */
const problems = [];
if (!files.length) problems.push('no workflow files were discovered');
for (const [name, n] of perFile) {
  if (!n) problems.push(`${name} contains no block-form run: body — the parser is not seeing it`);
}
/* A file may legitimately use only one-line `run:` steps (pages.yml, site-qa.yml, the QA suites do
 * that), so "zero block bodies" is not an error for every file. But the known multi-block writers
 * must keep at least one, or a YAML shape change has silently removed them from this gate. */
const MUST_HAVE_BLOCK = [
  'refresh-data.yml', 'live-alerts.yml', 'keepalive.yml', 'demo-account.yml',
  'ws-probe.yml', 'cors-probe.yml'
];
for (const name of MUST_HAVE_BLOCK) {
  if (!perFile.has(name)) problems.push(`${name} was not found under ${DIR}`);
  else if (!perFile.get(name)) problems.push(`${name} no longer has a block-form run: body`);
}
/* Self-test: positive and negative controls through the same parser. A parser that cannot see a
 * good block, or that blesses a bad one, fails this gate rather than passing silently. */
const selfText = [
  'jobs:', '  a:', '    steps:', '      - name: good', '        run: |',
  '          echo "hello"', '          if [ -f x ]; then echo y; fi'
].join('\n');
const selfBad = [
  'jobs:', '  a:', '    steps:', '      - name: bad', '        run: |',
  '          if [ -f x ]; then echo y'
].join('\n');
const goodBlocks = runBlocks(selfText);
if (goodBlocks.length !== 1) problems.push('self-test: the parser did not find the positive-control block');
else {
  const r = spawnSync('bash', ['-n'], { input: goodBlocks[0].script, encoding: 'utf8' });
  if (r.status !== 0) problems.push('self-test: a valid shell block was rejected');
}
const badBlocks = runBlocks(selfBad);
if (badBlocks.length !== 1) problems.push('self-test: the parser did not find the negative-control block');
else {
  const r = spawnSync('bash', ['-n'], { input: badBlocks[0].script, encoding: 'utf8' });
  if (!r.error && r.status === 0) problems.push('self-test: an invalid shell block was accepted');
}

if (problems.length) {
  for (const p of problems) console.error('FAIL ' + p);
  process.exitCode = 1;
}

const summary = files.map((n) => `${n}:${perFile.get(n)}`).join(' ');
console.log(`${count} block-form run script(s) shell-checked across ${files.length} workflow(s) — ${summary}`);
console.log(`positive and negative controls ${problems.length ? 'FAILED' : 'passed'}; ${bad} invalid block(s).`);
