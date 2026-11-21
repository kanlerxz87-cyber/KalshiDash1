#!/usr/bin/env node
// Check every block-form run script, including steps skipped on feature branches.
// GitHub substitutes expressions before executing the script; replace them with a
// shell-safe token for this syntax-only check. No workflow commands are executed.
//
// WHY THIS EXISTS (session-9bee7c49, 2026-11-21)
// The `live-alerts` and `Refresh demo data snapshot` jobs failed on EVERY scheduled run
// with the job annotation "Process completed with exit code 2" — which is exactly what
// bash returns for a SYNTAX ERROR. Both commit scripts were missing a closing `fi`, so
// bash could not parse the step at all and it never ran. The raw job log is served from a
// host that is not reachable from the repository tooling, so this syntax-only check is
// what turns "the step failed" into "the step could not be parsed".
//
// Extended by session-9bee7c49 from the two data writers to EVERY workflow in the
// repository, so a new workflow cannot introduce the same defect unnoticed.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = '.github/workflows';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort()
  .map((f) => `${dir}/${f}`);
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
if (!process.exitCode) console.log(`Syntax OK: ${count} workflow shell blocks across ${files.length} workflow file(s)`);
