#!/usr/bin/env node
// Run one patch alone on a clean copy and print what it changed.
//   node patch/trial-one.mjs apply-chat-linebreaks.mjs
// With --keep the try directory is left in the patched state (for inspection).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TRY, freshCopy, hashes, diffHashes, spawnSync} from './trial-run.mjs';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const name = args.find((item) => !item.startsWith('--'));
if (!name) throw new Error('usage: node patch/trial-one.mjs apply-xxx.mjs [--keep]');
const here = path.dirname(fileURLToPath(import.meta.url));
const backups = path.join(os.tmpdir(), 'pinkie-trial-backups');
freshCopy();
fs.rmSync(backups, {recursive: true, force: true});
const before = hashes(TRY);
const run = spawnSync(process.execPath, [path.join(here, name)], {
  env: {...process.env, OPENCLAW_ROOT: TRY, PINKIE_PATCH_BACKUP_ROOT: backups, PINKIE_PATCH_BACKUP: backups, UR_PROMPTS_DIR: backups},
  encoding: 'utf8',
  timeout: 180000,
});
const diff = diffHashes(before, hashes(TRY));
console.log(`### ${name}  exit=${run.status}`);
if (run.stdout?.trim()) console.log(run.stdout.trim());
if (run.stderr?.trim()) console.log(run.stderr.trim());
for (const file of diff.changed) console.log(`changed: ${file}`);
for (const file of diff.added) console.log(`added: ${file}`);
for (const file of diff.removed) console.log(`removed: ${file}`);
if (!diff.changed.length && !diff.added.length) console.log('changed: (none)');
if (!keep) freshCopy();
