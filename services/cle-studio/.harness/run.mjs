// Drive headless Chrome over CDP: open the harness, wait for its DONE_MARKER, print the log
// lines and any page errors. Read-only against a throwaway local page.
import {spawn} from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const profile = fs.mkdtempSync('/tmp/cle-cdp-');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=900,900', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = 'http://127.0.0.1:18823/';

async function json(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await wait(250);
    try {
      const list = await json('/json/list');
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
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const {resolve, reject} = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (/MISSING|present|GL_|VERB|CHIP|ANCHOR|NATIVE|LIVE|DONE|TWO_PANES|ERROR|WARN/.test(text)) errors.push(text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', {url});

  let log = '';
  for (let i = 0; i < 120; i++) {
    await wait(250);
    const res = await send('Runtime.evaluate', {expression: 'document.getElementById("log")?.textContent || ""', returnByValue: true});
    log = res.result?.value || '';
    if (log.includes('DONE_MARKER')) break;
  }
  const text = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({gl: window.__glCount ? window.__glCount() : -1})', returnByValue: true,
  });
  console.log('--- harness log ---');
  console.log(log.trim());
  console.log('--- gl ---', text.result?.value);
  if (errors.length) { console.log('--- console ---'); console.log(errors.join('\n')); }
} finally {
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}); } catch {}
}
