#!/usr/bin/env node
// Applies Pinkie's runtime patches against an isolated OPENCLAW_ROOT (either
// npm openclaw or cle-core) and prints a structured JSON summary of each
// patch's result (applied / already / failed). Used by K2-4 equivalence checks,
// super-pinkie CI (cle-core-checks), and cle-core reverse CI (C7).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Patches that operate purely on OPENCLAW_ROOT (package files + dist/control-ui)
// without touching ~/.openclaw or host services.
const RUNTIME_PATCHES = [
  'patch/reapply-unrestricted-patch.mjs',
  'patch/apply-context-budget.mjs',
  'patch/apply-history-image-thumbnails.mjs',
  'patch/apply-compaction-boundary-recovery.mjs',
  'patch/apply-same-session-recovery.mjs',
  'patch/apply-steer-fallback-wait.mjs',
  'patch/apply-retry-single-user.mjs',
  'patch/apply-loopback-model-reliability.mjs',
  'patch/apply-local-unrestricted-policy.mjs',
  'patch/apply-work-thinking.mjs',
  'patch/apply-chat-linebreaks.mjs',
  'patch/apply-chat-timeline.mjs',
  'patch/apply-composer-drafts.mjs',
  'patch/apply-control-ui-cache.mjs',
  'patch/apply-control-ui-file-delivery.mjs',
  'patch/apply-pinkie-managed-skills.mjs',
];

function classifyStatus(exitCode, stdout, stderr) {
  if (exitCode !== 0) return 'failed';
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (combined.includes('already') || combined.includes('unchanged') || combined.includes('up to date') || combined.includes('skip')) {
    return 'already';
  }
  return 'applied';
}

function main() {
  const args = process.argv.slice(2);
  let openclawRoot = process.env.OPENCLAW_ROOT || '';
  let jsonOut = '';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--openclaw-root' && args[i + 1]) {
      openclawRoot = path.resolve(args[i + 1]);
      i += 1;
    } else if (args[i] === '--json-out' && args[i + 1]) {
      jsonOut = path.resolve(args[i + 1]);
      i += 1;
    }
  }
  if (!openclawRoot || !fs.existsSync(path.join(openclawRoot, 'openclaw.mjs'))) {
    console.error(`[verify-cle-patches] Invalid --openclaw-root: ${openclawRoot}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(openclawRoot, 'package.json'), 'utf8'));
  const results = [];
  let failed = 0;

  for (const relPatch of RUNTIME_PATCHES) {
    const absPatch = path.join(REPO_ROOT, relPatch);
    if (!fs.existsSync(absPatch)) continue;
    const res = spawnSync(process.execPath, [absPatch], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OPENCLAW_ROOT: openclawRoot,
        PINKIE_SKIP_APP_BUNDLES: '1',
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    const exitCode = res.status ?? 1;
    const status = classifyStatus(exitCode, res.stdout || '', res.stderr || '');
    if (exitCode !== 0) failed += 1;
    results.push({
      patch: relPatch,
      exitCode,
      status,
      stdout: (res.stdout || '').trim().slice(0, 300),
      stderr: (res.stderr || '').trim().slice(0, 300),
    });
  }

  const report = {
    openclawRoot,
    packageName: pkg.name,
    packageVersion: pkg.version,
    total: results.length,
    failed,
    results,
  };

  const payload = JSON.stringify(report, null, 2);
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, payload, 'utf8');
  }
  console.log(payload);
  if (failed > 0) process.exit(1);
}

main();
