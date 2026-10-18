// 真实样式引擎验收：在 headless Chrome 里给元素赋值，让浏览器自己解析 var()，
// 再读回 computed style。只有"赋值后元素上算出来的值"才算数——
// 不用 CSS.supports 含 var 字符串来证明有效（那只能说明语法能被接受）。
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CLE_AUDIT_CDP || 9337);
const BASE = process.env.CLE_AUDIT_BASE || 'http://127.0.0.1:18824';
const PAGE = process.env.CLE_AUDIT_PAGE || '/surface-audit.html';

const profile = fs.mkdtempSync('/tmp/cle-audit-');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1280,860', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
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
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  await send('Runtime.enable');
  await send('Page.enable');
  // headless 的窗口尺寸会被默认视口覆盖，显式设成验收用的 1280×720
  const vw = Number(process.env.CLE_AUDIT_W || 1280);
  const vh = Number(process.env.CLE_AUDIT_H || 720);
  await send('Emulation.setDeviceMetricsOverride', {width: vw, height: vh, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: BASE + PAGE});

  let out = '';
  for (let i = 0; i < 200; i++) {
    await wait(250);
    // 不同场景页的日志容器 id 不同：surface-audit 用 #audit，wb-hit 用 #log
    const res = await send('Runtime.evaluate', {
      expression: '(document.getElementById("audit") || document.getElementById("log"))?.textContent || ""',
      returnByValue: true,
    });
    out = res.result?.value || '';
    if (out.includes('AUDIT_DONE')) break;
  }
  console.log(out.trim());
  if (errors.length) { console.log('--- page errors ---'); console.log(errors.join('\n')); }
  process.exitCode = out.includes('AUDIT_DONE') ? 0 : 1;
} finally {
  ws?.close();
  chrome.kill('SIGKILL');
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}); } catch {}
}
