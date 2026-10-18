#!/usr/bin/env node
// Browser smoke for the recovery projection. Runs the real module in headless Chrome
// against a fixture that carries the same class names and data attribute the native
// pane renders, so the CSS rule is exercised by an actual style engine — not by a
// string assertion. No screenshot and no visual judgement: only computed display.
//
//   node tools/recovery-smoke.mjs
//
// Requires Chrome at the standard macOS path and the plugin's esbuild. Exits non-zero
// on any mismatch so it can gate a commit.
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUDIO = path.join(ROOT, 'services/cle-studio');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.unref();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const {port} = probe.address(); probe.close(() => resolve(port)); });
});
const PORT = await freePort();

if (!fs.existsSync(CHROME)) {
  console.log('skip: Google Chrome not installed');
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-recovery-smoke-'));
const bundle = path.join(dir, 'recovery.js');
execFileSync(path.join(STUDIO, 'node_modules/.bin/esbuild'), [
  path.join(STUDIO, 'src/recovery/recovery.js'),
  '--bundle', '--format=esm', '--target=safari17', `--outfile=${bundle}`,
], {stdio: 'pipe'});

const VOICE = '[pinkie-watchdog] 继续完成当前这一轮先生交代的工作。这是当前用户轮次的内部续跑命令。';
fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>pending</title></head>
<body><openclaw-chat-pane id="pane"></openclaw-chat-pane>
<script type="module" src="/recovery.js"></script>
<script type="module">
const pane = document.getElementById('pane');
const mk = (cls) => { const g = document.createElement('div'); g.className = 'chat-group ' + cls; pane.append(g); return g; };
const bub = (g, text, quote) => {
  const b = document.createElement('div'); b.className = 'chat-bubble'; b.dataset.messageText = text;
  const t = document.createElement('div'); t.className = 'chat-text'; t.textContent = text; b.append(t); g.append(b);
  if (quote) { const pre = document.createElement('pre'); pre.textContent = text; b.append(pre); }
  return b;
};
const control = mk('user'); bub(control, ${JSON.stringify(VOICE)});
const quote = mk('user'); bub(quote, ${JSON.stringify(VOICE)}, true);
const real = mk('user'); bub(real, '把报告发我');
const {projectPane} = await import('/recovery.js');
projectPane(pane);
window.__r = {
  control: getComputedStyle(control).display,
  quote: getComputedStyle(quote).display,
  real: getComputedStyle(real).display,
  marked: control.getAttribute('data-cle-internal-only'),
};
document.body.dataset.result = JSON.stringify(window.__r);
document.title = 'done';
</script></body></html>`);

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {cwd: dir, stdio: 'ignore'});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = 0;
try {
  await wait(1200);
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=6000', '--dump-dom',
    `http://127.0.0.1:${PORT}/index.html`,
  ], {stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000}).toString();

  const json = /data-result="([^"]*)"/.exec(dom)?.[1];
  if (!json) throw new Error('the page never published a result (script error?)');
  const result = JSON.parse(json.replace(/&quot;/g, '"'));
  const expect = (label, actual, want) => {
    const ok = actual === want;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (want ${want})`}`);
  };
  expect('control turn folded', result.control, 'none');
  expect('quoted control text kept visible', result.quote !== 'none', true);
  expect('ordinary message kept visible', result.real !== 'none', true);
  expect('control group marked internal', result.marked, '1');
} catch (error) {
  failed += 1;
  console.log('FAIL ' + error.message);
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dir, {recursive: true, force: true});
}
console.log(failed ? `recovery smoke: ${failed} failure(s)` : 'recovery smoke: all checks passed');
process.exit(failed ? 1 : 0);
