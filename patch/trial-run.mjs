#!/usr/bin/env node
// Tools to try each patch on a throwaway copy of the pristine OpenClaw package.
// Never touches the pristine directory; every trial starts from a fresh copy.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export const PRISTINE = process.env.PINKIE_PRISTINE_ROOT
  || path.join(os.homedir(), 'release-superpinkie/sandbox/openclaw-pristine');
export const TRY = process.env.PINKIE_TRY_ROOT
  || path.join(os.homedir(), 'release-superpinkie/sandbox/try');

export function freshCopy() {
  fs.mkdirSync(TRY, {recursive: true});
  const r = spawnSync('rsync', ['-a', '--delete', PRISTINE + '/', TRY + '/'], {encoding: 'utf8'});
  if (r.status !== 0) throw new Error('rsync failed: ' + (r.stderr || r.stdout));
  return TRY;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

const MANIFEST_NAME = 'asset-manifest.json';
const skip = (name) => /\.(br|gz)$/.test(name) || name === '.DS_Store';

export function hashes(dir) {
  const map = new Map();
  for (const file of walk(dir)) {
    if (skip(file) || path.basename(file) === MANIFEST_NAME) continue;
    map.set(path.relative(dir, file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  }
  return map;
}

export function diffHashes(before, after) {
  const changed = [], added = [], removed = [];
  for (const [file, hash] of after) {
    if (!before.has(file)) added.push(file);
    else if (before.get(file) !== hash) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);
  return {changed, added, removed};
}

export {spawnSync};
