#!/usr/bin/env node
/**
 * Keep the managed CLE Kk gateway's local agent sessions unrestricted.
 *
 * OpenClaw intentionally removes gateway/node/cron tools when a run arrives
 * from a non-owner sender. The desktop App is the user's loopback gateway,
 * so that sender distinction is not useful here: it makes the five local
 * modes appear to have tools while silently removing them at runtime.
 *
 * The runtime still keeps its normal protection everywhere else. The small
 * change below only disables that owner-only tool filter when the launcher
 * explicitly exports CLE_KK_LOCAL_UNRESTRICTED=1.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const marker = '/* cle-kk-local-unrestricted-policy:v1 */';
const oldLine = 'const ownerOnlyCoreToolDenylist = options?.senderIsOwner === false ? [...GATEWAY_OWNER_ONLY_CORE_TOOLS] : [];';
const newLine = `${marker}\n\tconst ownerOnlyCoreToolDenylist = options?.senderIsOwner === false && process.env.CLE_KK_LOCAL_UNRESTRICTED !== "1" ? [...GATEWAY_OWNER_ONLY_CORE_TOOLS] : [];`;

function backupPath(root) {
  return process.env.PINKIE_PATCH_BACKUP_ROOT
    || path.join(process.env.PINKIE_STATE_ROOT || path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Local/SuperPinkie' : 'Library/Application Support/SuperPinkie'), 'backups', `local-unrestricted-${Date.now()}`);
}

function resolveRoot() {
  const candidates = [];
  if (process.env.OPENCLAW_ROOT) candidates.push(process.env.OPENCLAW_ROOT);
  if (process.env.PINKIE_OPENCLAW_ENTRY) {
    candidates.push(path.dirname(process.env.PINKIE_OPENCLAW_ENTRY));
  }
  // The self-contained launchers execute this script with their bundled
  // Node. Resolve the sibling OpenClaw package even when no global CLI exists.
  candidates.push(path.resolve(path.dirname(process.execPath), '..', 'openclaw'));
  if (process.platform === 'darwin') {
    candidates.push('/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw');
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'openclaw.mjs'))
        && fs.existsSync(path.join(candidate, 'dist'))) return candidate;
  }
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const entry = execFileSync(command, ['openclaw'], {encoding: 'utf8'}).trim().split(/\r?\n/)[0];
    if (!entry) return null;
    const real = fs.realpathSync(entry);
    const directory = fs.statSync(real).isDirectory() ? real : path.dirname(real);
    if (fs.existsSync(path.join(directory, 'openclaw.mjs'))
        && fs.existsSync(path.join(directory, 'dist'))) return directory;
    const nested = path.join(directory, 'node_modules/openclaw');
    return fs.existsSync(path.join(nested, 'dist')) ? nested : null;
  } catch {
    return null;
  }
}

export function apply(root = resolveRoot()) {
  if (!root) throw new Error('无法找到 OpenClaw 包目录，请明确设置 OPENCLAW_ROOT');
  const dist = path.join(root, 'dist');
  const candidates = fs.readdirSync(dist)
    .filter(name => /^agent-tools-.*\.js$/.test(name))
    .map(name => path.join(dist, name));
  const alreadyPatched = candidates.find(file => fs.readFileSync(file, 'utf8').includes(marker));
  if (alreadyPatched) return {changed: false, file: alreadyPatched};
  const files = candidates.filter(file => fs.readFileSync(file, 'utf8').includes(oldLine));
  if (files.length !== 1) throw new Error(`无法唯一确认 agent-tools 模块：${files.map(file => path.basename(file)).join(', ')}`);
  const file = files[0];
  const original = fs.readFileSync(file, 'utf8');
  if (original.includes(marker)) return {changed: false, file};
  if (!original.includes(oldLine)) throw new Error('agent-tools owner-only policy anchor not found; refusing to patch');
  const next = original.replace(oldLine, newLine);
  const backup = backupPath(root);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('agent-tools 正在被更新，未覆盖');
  fs.writeFileSync(file, next);
  return {changed: true, file, backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  console.log(JSON.stringify(apply()));
}
