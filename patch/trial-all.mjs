#!/usr/bin/env node
// Step 1 harness: run every patch alone on a clean copy and record the result.
//   node patch/trial-all.mjs [--json out.json]
// Exit code is always 0; the machine-readable result is printed as JSON.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRISTINE, TRY, freshCopy, hashes, diffHashes, spawnSync} from './trial-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const backups = path.join(os.tmpdir(), 'pinkie-trial-backups');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const patches = fs.readdirSync(here).filter((name) => name.endsWith('.mjs') && name !== 'trial-run.mjs' && name !== 'trial-all.mjs').sort();
const results = [];
for (const name of patches) {
  freshCopy();
  fs.rmSync(backups, {recursive: true, force: true});
  const before = hashes(TRY);
  const run = spawnSync(process.execPath, [path.join(here, name)], {
    env: {...process.env, OPENCLAW_ROOT: TRY, PINKIE_PATCH_BACKUP_ROOT: backups, PINKIE_PATCH_BACKUP: backups, UR_PROMPTS_DIR: backups},
    encoding: 'utf8',
    timeout: 120000,
  });
  const after = hashes(TRY);
  const diff = diffHashes(before, after);
  const files = [...diff.changed, ...diff.added].map((rel) => `${rel}${diff.added.includes(rel) ? ' (新增)' : ''}`);
  results.push({
    name,
    code: run.status,
    signal: run.signal,
    stdout: (run.stdout || '').trim(),
    stderr: (run.stderr || '').trim(),
    changed: files,
    removed: diff.removed,
  });
  console.log(`\n### ${name}  exit=${run.status}`);
  if (run.stdout?.trim()) console.log('stdout: ' + run.stdout.trim());
  if (run.stderr?.trim()) console.log('stderr: ' + run.stderr.trim());
  console.log(files.length ? 'changed: ' + files.join(', ') : 'changed: (none)');
}
// Leave the shared try directory pristine again.
freshCopy();
console.log(`\npristine=${PRISTINE}\ntry=${TRY}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
