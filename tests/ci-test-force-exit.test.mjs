// B55 follow-up (uireview 23:18Z): a handle a test forgets to close (a listening server, a timer) kept
// node --test alive after every test had finished, so windows-checks sat until its 30-minute step
// limit with no output. Every node --test in CI runs with --test-force-exit, so a leaked handle ends
// the step instead of hanging it (the leak itself is still fixed in the test, e.g. #382 / #384).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(root, '.github/workflows');

test('every node --test in the CI workflows runs with --test-force-exit', () => {
  const missing = [];
  let seen = 0;
  for (const file of fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    fs.readFileSync(path.join(workflowsDir, file), 'utf8').split('\n').forEach((line, i) => {
      if (!/\bnode --test\b/.test(line)) return;
      seen++;
      if (!/--test-force-exit\b/.test(line)) missing.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.ok(seen > 0, 'no node --test found in the workflows');
  assert.deepEqual(missing, [], 'node --test without --test-force-exit:\n' + missing.join('\n'));
});

// The flag must do what we rely on: a file whose tests pass but which leaks a listening server exits.
function runLeaky(flags, ms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'force-exit-'));
  const file = path.join(dir, 'leaky.test.mjs');
  fs.writeFileSync(file, "import http from 'node:http'; import test from 'node:test';\ntest('passes but leaks a server', async () => { await new Promise((r) => http.createServer().listen(0, '127.0.0.1', r)); });\n");
  return new Promise((resolve) => {
    // Drop NODE_TEST_CONTEXT: inherited from this runner it puts the child in reporter-child mode, which exits differently from CI.
    const {NODE_TEST_CONTEXT, ...env} = process.env;
    const child = spawn(process.execPath, ['--test', ...flags, file], {stdio: 'ignore', env});
    const timer = setTimeout(() => { child.kill(); resolve('still running'); }, ms);
    child.on('exit', (code) => { clearTimeout(timer); resolve(`exit ${code}`); });
  }).finally(() => fs.rmSync(dir, {recursive: true, force: true}));
}

test('--test-force-exit ends a run whose tests passed but leaked a listening server', async () => {
  assert.equal(await runLeaky(['--test-force-exit'], 15_000), 'exit 0');
  assert.equal(await runLeaky([], 4_000), 'still running', 'without the flag the leak keeps node alive (what hung windows-checks)');
});
