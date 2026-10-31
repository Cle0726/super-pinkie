// Run one harness page and print its PASS/FAIL lines plus any page exception.
// Usage: node .harness/gate.mjs [path] [timeoutMs]
import {spawn} from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = process.argv[2] || '/panes.html';
const budget = Number(process.argv[3] || 30000);
const PORT = 9350 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync('/tmp/cle-gate-');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1100,900', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 0;

try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await wait(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('no CDP target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, {resolve, reject});
    ws.send(JSON.stringify({id: mid, method, params}));
  });
  const problems = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const {resolve, reject} = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push('EXCEPTION ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push('CONSOLE ' + (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', {url: `http://127.0.0.1:18823${page}`});

  let log = '';
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    await wait(250);
    const res = await send('Runtime.evaluate', {
      expression: 'document.getElementById("log")?.textContent || ""', returnByValue: true,
    });
    log = res.result?.value || '';
    if (log.includes('DONE_MARKER')) break;
  }
  console.log(log.trim() || '(no output)');
  if (problems.length) { console.log('--- page problems ---'); console.log(problems.join('\n')); }
  if (!log.includes('DONE_MARKER')) { console.log('!! page did not reach DONE_MARKER'); code = 2; }
  if (/^FAIL /m.test(log)) code = 1;
} catch (error) {
  console.log('!! harness error: ' + error.message);
  code = 3;
} finally {
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}); } catch {}
}
process.exit(code);
