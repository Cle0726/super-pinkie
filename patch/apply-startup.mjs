#!/usr/bin/env node
/**
 * patch/apply-startup.mjs — installer entry for the first-paint layer.
 *
 * The real work lives next to the UI that owns it (services/cle-studio/scripts/apply-startup.mjs:
 * one CSS file, one patcher, one test suite). This entry only adapts the installer contract the
 * other patches in patch/ follow — OPENCLAW_ROOT in, JSON out — and resolves the Control UI root
 * from that runtime. It is the last patch in the chain because it rewrites index.html, sw.js and
 * the web manifest, all of which earlier patches also touch.
 *
 * Safety is inherited: an explicit runtime root only, no discovery, and the shared patcher
 * refuses the signed App bundle and the live ~/.openclaw profile.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyLayer, refuseReason} from '../services/cle-studio/scripts/apply-startup.mjs';

// <repo>/patch/apply-startup.mjs → <repo>
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(REPO, 'services', 'cle-studio', 'static', 'startup.css');

export function apply(root) {
  if (!root) throw new Error('OPENCLAW_ROOT is required');
  const resolved = path.resolve(root);
  const reason = refuseReason(resolved);
  if (reason) throw new Error(reason);
  // A packaged runtime keeps the UI at dist/control-ui; a source checkout may nest it.
  const candidates = [path.join(resolved, 'dist', 'control-ui'), path.join(resolved, 'control-ui')];
  const controlUi = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
  if (!controlUi) throw new Error(`no dist/control-ui/index.html under ${resolved}`);
  const result = applyLayer(controlUi, {cssPath: CSS});
  return {changed: result.index === 'patched' || result.offlineShell === 'patched' || result.manifest === 'patched', ...result, controlUi};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) {
    console.error('apply-startup: set OPENCLAW_ROOT to the test runtime, never the live App');
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(apply(root)));
  } catch (error) {
    console.error(`apply-startup: ${error.message}`);
    process.exit(1);
  }
}
