#!/usr/bin/env node
// Check every block-form run script, including steps skipped on feature branches.
// GitHub substitutes expressions before executing the script; replace them with a
// shell-safe token for this syntax-only check. No workflow commands are executed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/* keepalive.yml is included because it is the third data writer and its commit step is the one
 * that actually failed on main on 2026-11-21T06:37:33Z ("could not push after 3 attempts").
 * A syntax error there would fail the same way it did in the other two workflows. */
const files = [
  '.github/workflows/refresh-data.yml',
  '.github/workflows/live-alerts.yml',
  '.github/workflows/keepalive.yml',
];
let count = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
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
    const script = body.join('\n').replace(/\$\{\{[\s\S]*?\}\}/g, 'EXPRESSION');
    const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      console.error(`${file}:${start}: invalid shell block\n${result.stderr || result.error}`);
      process.exitCode = 1;
    }
    count++;
  }
}
if (!count) throw new Error('No workflow run blocks found');
if (!process.exitCode) console.log(`Syntax OK: ${count} data-workflow shell blocks`);
