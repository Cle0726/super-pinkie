#!/usr/bin/env node
// Runs the macOS WebKit suite listed in tests/webkit-ci.list (one test file per line, '#' comments).
// Each file runs in its own node --test child with PINKIE_IMAGE_UI_ENGINE=webkit, empty credential
// dirs and upstream API keys stripped, so only local fake gateways are ever reached.
// TAP logs, failure screenshots and summary.{json,md} land in --artifact-dir for CI upload.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STRIPPED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'PINKIE_VISUAL_UPDATE',
  'NODE_TEST_CONTEXT',
];

export function readTestList(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter(Boolean);
}

function parseArgs(argv) {
  const opts = {
    list: path.join(REPO_ROOT, 'tests/webkit-ci.list'),
    artifactDir: process.env.PINKIE_WEBKIT_ARTIFACT_DIR
      || path.join(os.tmpdir(), `pinkie-macos-webkit-${process.pid}`),
    concurrency: Number.parseInt(process.env.PINKIE_WEBKIT_CONCURRENCY || '', 10) || 2,
    maxMinutes: 12,
    only: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list' && argv[i + 1]) opts.list = path.resolve(argv[++i]);
    else if (arg === '--artifact-dir' && argv[i + 1]) opts.artifactDir = path.resolve(argv[++i]);
    else if (arg === '--concurrency' && argv[i + 1]) opts.concurrency = Number.parseInt(argv[++i], 10);
    else if (arg === '--max-minutes' && argv[i + 1]) opts.maxMinutes = Number(argv[++i]);
    else if (arg === '--only' && argv[i + 1]) {
      opts.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return opts;
}

function parseTapCounts(text) {
  const last = (re) => {
    const matches = [...text.matchAll(re)];
    return matches.length ? Number.parseInt(matches.at(-1)[1], 10) : null;
  };
  return {
    tests: last(/^# tests (\d+)/gm) ?? 0,
    pass: last(/^# pass (\d+)/gm) ?? 0,
    fail: last(/^# fail (\d+)/gm) ?? 0,
    cancelled: last(/^# cancelled (\d+)/gm) ?? 0,
    skipped: last(/^# skipped (\d+)/gm) ?? 0,
  };
}

function extractFailureExcerpt(output) {
  const lines = output.split(/\r?\n/);
  const chunks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('not ok ') || /AssertionError|Error:|ERR_TEST_FAILURE/.test(lines[i])) {
      chunks.push(lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 16)).join('\n'));
      if (chunks.length >= 4) break;
    }
  }
  return (chunks.join('\n---\n') || lines.slice(-30).join('\n')).slice(0, 4000);
}

function runSingleFile(relFile, {env, timeoutMs, logDir, shotDir}) {
  return new Promise((resolve) => {
    const stem = path.basename(relFile).replace(/\.[^.]+$/, '');
    const fileShotDir = path.join(shotDir, stem);
    const t0 = Date.now();
    const childEnv = {
      ...env,
      FORCE_COLOR: '0',
      PINKIE_IMAGE_UI_ENGINE: 'webkit',
      PINKIE_WEBKIT_SHOT_DIR: fileShotDir,
    };
    for (const key of STRIPPED_ENV_KEYS) delete childEnv[key];

    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', relFile],
      {cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']},
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const sec = Math.round((Date.now() - t0) / 10) / 100;
      const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      const counts = parseTapCounts(stdout);
      const rc = timedOut ? 124 : (code ?? (signal ? 1 : 0));
      const failed = rc !== 0 || counts.fail > 0 || counts.cancelled > 0 || counts.tests === 0;

      fs.mkdirSync(logDir, {recursive: true});
      const logFile = path.join(logDir, `${stem}.tap.log`);
      fs.writeFileSync(logFile, combined, 'utf8');

      const shots = fs.existsSync(fileShotDir)
        ? fs.readdirSync(fileShotDir).filter((f) => f.endsWith('.png')).map((f) => `${stem}/${f}`)
        : [];

      resolve({
        file: relFile,
        rc,
        timedOut,
        sec,
        ...counts,
        failed,
        logFile,
        screenshots: shots,
        failExcerpt: failed ? extractFailureExcerpt(combined) : '',
      });
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const maxMinutes = opts.maxMinutes > 0 ? opts.maxMinutes : 12;
  const maxTotalMs = maxMinutes * 60_000;
  const concurrency = Math.max(1, opts.concurrency || 2);

  let files = readTestList(fs.readFileSync(opts.list, 'utf8'));
  if (opts.only?.length) {
    files = files.filter((f) => opts.only.some((pat) => f === pat || f.includes(pat)));
  }
  if (!files.length) throw new Error(`No test files selected from ${opts.list}`);
  for (const rel of files) {
    if (!fs.existsSync(path.resolve(REPO_ROOT, rel))) {
      throw new Error(`Listed test file does not exist: ${rel}`);
    }
  }

  const artifactDir = opts.artifactDir;
  const logDir = path.join(artifactDir, 'logs');
  const shotDir = path.join(artifactDir, 'screenshots');
  fs.mkdirSync(logDir, {recursive: true});
  fs.mkdirSync(shotDir, {recursive: true});

  const emptyCredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-webkit-nocreds-'));
  const claudeEmpty = path.join(emptyCredDir, 'claude');
  const codexEmpty = path.join(emptyCredDir, 'codex');
  fs.mkdirSync(claudeEmpty, {recursive: true});
  fs.mkdirSync(codexEmpty, {recursive: true});
  const baseEnv = {...process.env, CLAUDE_CONFIG_DIR: claudeEmpty, CODEX_HOME: codexEmpty};

  const suiteStart = Date.now();
  const queue = files.map((file, index) => ({file, index}));
  const results = new Array(files.length);
  let budgetExceeded = false;

  console.log(
    `[macos-webkit] Running ${files.length} files `
    + `(concurrency=${concurrency}, budget=${maxMinutes}m, artifacts=${artifactDir})`,
  );

  async function worker() {
    while (queue.length > 0) {
      const elapsed = Date.now() - suiteStart;
      if (elapsed >= maxTotalMs) {
        budgetExceeded = true;
        break;
      }
      const item = queue.shift();
      if (!item) break;
      const remainingMs = Math.max(15_000, Math.min(240_000, maxTotalMs - elapsed));
      const res = await runSingleFile(item.file, {env: baseEnv, timeoutMs: remainingMs, logDir, shotDir});
      results[item.index] = res;
      console.log(
        `[${String(item.index + 1).padStart(2, '0')}/${files.length}] ${res.failed ? 'FAIL' : 'PASS'} ${res.file} `
        + `(rc=${res.rc}, pass=${res.pass}, fail=${res.fail}, skip=${res.skipped}, ${res.sec}s)`,
      );
      if (res.failed && res.failExcerpt) {
        console.error(`--- Failure excerpt: ${res.file} ---\n${res.failExcerpt}\n---`);
      }
    }
  }

  try {
    await Promise.all(Array.from({length: Math.min(concurrency, files.length)}, () => worker()));
  } finally {
    fs.rmSync(emptyCredDir, {recursive: true, force: true});
  }

  const completed = results.filter(Boolean);
  const failedFiles = completed.filter((r) => r.failed);
  const allShots = completed.flatMap((r) => r.screenshots);
  const summary = {
    ok: failedFiles.length === 0 && !budgetExceeded && completed.length === files.length,
    engine: 'webkit',
    platform: process.platform,
    totalFiles: files.length,
    completedFiles: completed.length,
    passedFiles: completed.length - failedFiles.length,
    failedFiles: failedFiles.length,
    budgetExceeded,
    totalTests: completed.reduce((s, r) => s + r.tests, 0),
    totalPass: completed.reduce((s, r) => s + r.pass, 0),
    totalFail: completed.reduce((s, r) => s + r.fail, 0),
    totalCancelled: completed.reduce((s, r) => s + r.cancelled, 0),
    totalSkipped: completed.reduce((s, r) => s + r.skipped, 0),
    durationSec: Math.round((Date.now() - suiteStart) / 10) / 100,
    failureScreenshots: allShots,
    results: completed,
  };

  fs.writeFileSync(path.join(artifactDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  const md = [
    '# macOS WebKit suite summary',
    '',
    `- Status: ${summary.ok ? 'PASS' : 'FAIL'}`,
    `- Files: ${summary.passedFiles}/${summary.totalFiles} passed (${summary.failedFiles} failed)`,
    `- Tests: total=${summary.totalTests}, pass=${summary.totalPass}, fail=${summary.totalFail}, cancelled=${summary.totalCancelled}, skipped=${summary.totalSkipped}`,
    `- Duration: ${summary.durationSec}s (budget: ${maxMinutes * 60}s${budgetExceeded ? ', EXCEEDED' : ''})`,
    `- Failure screenshots: ${allShots.length ? allShots.join(', ') : 'none'}`,
    '',
  ];
  if (failedFiles.length) {
    md.push('## Failed files', '');
    for (const f of failedFiles) {
      md.push(
        `### \`${f.file}\` (rc=${f.rc}, pass=${f.pass}, fail=${f.fail}, cancelled=${f.cancelled})`,
        '',
        '```text',
        f.failExcerpt,
        '```',
        '',
      );
    }
  }
  fs.writeFileSync(path.join(artifactDir, 'summary.md'), md.join('\n'), 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');

  console.log(
    `[macos-webkit] Done in ${summary.durationSec}s: `
    + `files ${summary.passedFiles}/${summary.totalFiles} passed, `
    + `tests pass=${summary.totalPass} fail=${summary.totalFail} skip=${summary.totalSkipped}`,
  );
  if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[macos-webkit] Fatal error:', err);
    process.exitCode = 1;
  });
}
