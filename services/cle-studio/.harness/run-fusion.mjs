// Drive headless Chrome over CDP for the fusion seam harness: print the page log
// (measurements + computed styles) and any page errors. Read-only, throwaway profile.
import {spawn} from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const URL_ = process.env.FUSION_HARNESS_URL || 'http://127.0.0.1:18824/';
const profile = fs.mkdtempSync('/tmp/cle-fusion-');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1280,900', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (path) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();

let ws;
try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await wait(250);
    try { target = (await json('/json/list')).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('no CDP target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, {resolve, reject});
    ws.send(JSON.stringify({id: mid, method, params}));
  });
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const {resolve, reject} = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('CONSOLE ' + (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', {url: URL_});

  let log = '';
  for (let i = 0; i < 120; i++) {
    await wait(250);
    const res = await send('Runtime.evaluate', {expression: 'document.getElementById("log")?.textContent || ""', returnByValue: true});
    log = res.result?.value || '';
    if (log.includes('DONE_MARKER')) break;
  }
  console.log(log.trim());
  if (errors.length) { console.log('--- page errors ---'); console.log(errors.join('\n')); }
  process.exitCode = log.includes('DONE_MARKER') ? 0 : 1;
} finally {
  ws?.close();
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}); } catch {}
}
