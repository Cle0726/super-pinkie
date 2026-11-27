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

// uireview #385 issuecomment-7205982818: --test-force-exit alone turns a pure leak (tests pass) into
// exit 0, so the leak would go unseen. Every run also imports the exit hook, which fails the process
// when a listening TCP handle is still open at exit.
const HOOK = './tests/helpers/leak-exit-check.mjs';

test('every node --test in the CI workflows runs with --test-force-exit and the leak exit hook', () => {
  const missing = [];
  let seen = 0;
  for (const file of fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    fs.readFileSync(path.join(workflowsDir, file), 'utf8').split('\n').forEach((line, i) => {
      if (!/\bnode --test\b/.test(line)) return;
      seen++;
      if (!/--test-force-exit\b/.test(line)) missing.push(`${file}:${i + 1}: no --test-force-exit: ${line.trim()}`);
      if (!line.includes(`--import ${HOOK}`)) missing.push(`${file}:${i + 1}: no --import ${HOOK}: ${line.trim()}`);
    });
  }
  assert.ok(seen > 0, 'no node --test found in the workflows');
  assert.deepEqual(missing, [], 'node --test lines missing a required flag:\n' + missing.join('\n'));
});

const LEAKY = "import http from 'node:http'; import test from 'node:test';\ntest('passes but leaks a server', async () => { await new Promise((r) => http.createServer().listen(0, '127.0.0.1', r)); });\n";
const CLEAN = "import http from 'node:http'; import test from 'node:test';\ntest('passes and closes its server', async () => { const s = http.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); await new Promise((r) => s.close(r)); });\n";
// A closed server that served a fetch: the client keep-alive socket is still open at force-exit,
// and libuv has not released the closed server's handle yet. Neither is a leak.
const CLEAN_FETCH = "import http from 'node:http'; import test from 'node:test';\ntest('serves a fetch and closes', async () => { const s = http.createServer((q, a) => a.end('ok')); await new Promise((r) => s.listen(0, '127.0.0.1', r)); await (await fetch('http://127.0.0.1:' + s.address().port)).text(); await new Promise((r) => s.close(r)); });\n";

// Runs one small test file the way CI does (cwd = repo root, so the hook path resolves) and reports
// how it ended plus stderr, or 'still running' if it outlives ms.
function runFile(source, flags, ms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'force-exit-'));
  const file = path.join(dir, 'case.test.mjs');
  fs.writeFileSync(file, source);
  return new Promise((resolve) => {
    // Drop NODE_TEST_CONTEXT: inherited from this runner it puts the child in reporter-child mode, which exits differently from CI.
    const {NODE_TEST_CONTEXT, ...env} = process.env;
    const child = spawn(process.execPath, ['--test', ...flags, file], {cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env});
    // The runner relays a test process's stderr through its reporter on stdout, so read both.
    let stderr = '';
    child.stdout.on('data', (d) => { stderr += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); resolve({end: "still running", stderr}); }, ms);
    child.on('exit', (code) => { clearTimeout(timer); resolve({end: `exit ${code}`, stderr}); });
  }).finally(() => fs.rmSync(dir, {recursive: true, force: true}));
}

test('--test-force-exit ends a run whose tests passed but leaked a listening server', async () => {
  assert.equal((await runFile(LEAKY, ['--test-force-exit'], 15_000)).end, 'exit 0');
  assert.equal((await runFile(LEAKY, [], 4_000)).end, 'still running', 'without the flag the leak keeps node alive (what hung windows-checks)');
});

test('with the CI flags a pure leak (all tests pass) still fails and names the handle; a clean file passes', async () => {
  const flags = ['--test-force-exit', '--import', HOOK];
  const leaky = await runFile(LEAKY, flags, 15_000);
  assert.notEqual(leaky.end, 'exit 0', 'a leaked server must not turn green');
  assert.notEqual(leaky.end, 'still running', 'the run must still end (force-exit)');
  assert.match(leaky.stderr, /LEAKED HANDLES: Server\(127\.0\.0\.1:\d+\) still listening/);
  // A correctly closed server is still a TCPServerWrap at force-exit, so these guard against the
  // hook going red on good tests.
  for (const [name, source] of [['closed server', CLEAN], ['closed server after a fetch', CLEAN_FETCH]]) {
    const clean = await runFile(source, flags, 15_000);
    assert.equal(clean.end, 'exit 0', `${name} must pass: ` + clean.stderr.slice(0, 400));
    assert.doesNotMatch(clean.stderr, /LEAKED HANDLES/, name);
  }
});
