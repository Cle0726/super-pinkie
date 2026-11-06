#!/usr/bin/env node
// 进阶调节 end-to-end check in a real browser, fully isolated:
// the chat-ui harness serves the installed native bundle + this repo's
// injections against an in-page fake gateway (no App, no 18789, no ~/.openclaw).
//
//   node tools/power-settings/e2e.mjs [--ui-root DIR] [--port 18834] [--shots DIR]
//
// Proves: defaults are unchanged, and every control changes what the scripts do.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('--port', 18834));
// Pass a control-ui built with `tools/ui-parity/bundle.py install` so index.html loads the
// injections exactly as the App does (the harness alone appends new scripts late, as defer).
const UI_ROOT = arg('--ui-root', path.join(os.homedir(), '碧琪实测/iso-wf/runtime/openclaw/dist/control-ui'));
const SHOTS = arg('--shots', '');
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-power-'));

// Long chat: 3000 rows, the newest reply 300 000 characters.
fs.mkdirSync(path.join(tmp, 'seeds'));
fs.writeFileSync(path.join(tmp, 'seeds/long.js'), `(() => {
  const msgs = [];
  for (let i = 0; i < 3000; i++) {
    const user = i % 2 === 0;
    msgs.push({role: user ? 'user' : 'assistant', content: [{type: 'text', text: i === 2999 ? 'L'.repeat(300000) : (user ? '问题 ' + i : '回答 ' + i)}],
      timestamp: 1700000000000 + i * 1000, ...(user ? {} : {stopReason: 'stop'})});
  }
  window.__fakeSeedHistory = msgs;
  window.__historyCalls = [];
  const parse = JSON.parse;
  JSON.parse = function (text, ...rest) {
    const v = parse.call(this, text, ...rest);
    if (v && v.type === 'req' && v.method === 'chat.history' && v.params && v.params.maxChars) window.__historyCalls.push(v.params);
    return v;
  };
})();`);

const server = spawn('python3', [path.join(REPO, 'scripts/chat-ui-harness/server.py'), '--port', String(PORT), '--ui-root', UI_ROOT,
  '--injections', path.join(REPO, 'ui/injections')], {env: {...process.env, PINKIE_HARNESS_SEEDS: path.join(tmp, 'seeds')}, stdio: 'ignore'});
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--window-size=1280,860', '--force-device-scale-factor=2', '--no-first-run', '--no-default-browser-check', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('chrome did not start')), 20000);
});
const browser = new WebSocket(wsUrl);
await new Promise((r) => browser.addEventListener('open', r, {once: true}));
let id = 0; const pending = new Map();
browser.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, (m) => m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result));
  browser.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})}));
});
const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable');
await page('Emulation.setDeviceMetricsOverride', {width: 1280, height: 860, deviceScaleFactor: 2, mobile: false});
const evaluate = async (expr) => {
  const r = await page('Runtime.evaluate', {expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true});
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await sleep(250); } }
const BASE = `http://127.0.0.1:${PORT}/chat?session=${encodeURIComponent('agent:unrestricted:dashboard:harness0001')}`;
const open = async (url, tuning) => {
  await page('Page.navigate', {url: BASE});
  await sleep(800);
  await evaluate(`localStorage.clear(); ${tuning ? `localStorage.setItem('pinkie.tuning.v1', ${JSON.stringify(JSON.stringify(tuning))});` : ''} return 1;`);
  await page('Page.navigate', {url});
  await evaluate(`for (let i = 0; i < 80 && (document.getElementById('laolao-splash') || !window.PinkieTuning); i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 2500)); return 1;`);
};
const level = (name, values = {}) => ({version: 1, level: name, values});

const results = [];
const check = (name, ok, detail) => { results.push({name, ok: Boolean(ok), detail}); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`); };

// ── history: default / 全开 / 省着用 / single overrides ──────────────────────
const historyRun = async (tuning) => {
  await open(`${BASE}&seed=long`, tuning);
  await sleep(4000);
  return evaluate(`const st = document.querySelector('openclaw-chat-pane')?.state;
    const calls = window.__historyCalls || [];
    return {count: st?.chatMessages?.length || 0, limits: [...new Set(calls.map(c => c.limit))], maxChars: [...new Set(calls.map(c => c.maxChars))],
      pages: Math.max(0, ...calls.map(c => c.offset)) / (calls[0]?.limit || 1) + 1};`);
};
const hDefault = await historyRun(null);
check('default: 512 messages, pages of 128, maxChars 240000', hDefault.count === 512 && hDefault.limits.join() === '128' && hDefault.maxChars.join() === '240000', hDefault);
const hMax = await historyRun(level('max'));
check('全开: 2000 messages, pages of 500, maxChars 500000', hMax.count === 2000 && hMax.limits.join() === '500' && hMax.maxChars.join() === '500000', hMax);
const hSaver = await historyRun(level('saver'));
check('省着用: 256 messages, pages of 64, maxChars 120000', hSaver.count === 256 && hSaver.limits.join() === '64' && hSaver.maxChars.join() === '120000', hSaver);
const hScan = await historyRun(level('standard', {'history.liveWindow': 2000, 'history.scanPages': 6}));
check('history.scanPages caps the pages read (6 × 128 = 768)', hScan.count === 768 && hScan.pages === 6, hScan);
const hWin = await historyRun(level('standard', {'history.liveWindow': 1000}));
check('history.liveWindow alone raises the first load to 1000+', hWin.count >= 1000 && hWin.count < 1200 && hWin.limits.join() === '128', hWin);

// ── effects, rendering, ink, process cards, warmup ───────────────────────────
await open(BASE, null);
const fx = await evaluate(`
  const T = window.PinkieTuning;
  const defaults = T.snapshot();
  const stored = localStorage.getItem(T.KEY);
  const proto = CanvasRenderingContext2D.prototype;
  let frames = 0, draws = 0;
  const wrap = (name, onCall) => { const orig = proto[name]; proto[name] = function (...a) { if (this.canvas.classList?.contains('pinkie-ambient')) onCall(); return orig.apply(this, a); }; };
  wrap('clearRect', () => frames++); ['drawImage', 'fill', 'stroke', 'fillRect'].forEach(n => wrap(n, () => draws++));
  const measure = async () => { frames = 0; draws = 0; await new Promise(r => setTimeout(r, 2000)); return {fps: frames / 2, perFrame: frames ? draws / frames : 0}; };
  const canvas = () => document.querySelector('canvas.pinkie-ambient');
  const out = {defaults, stored, dpr: devicePixelRatio, ambientOn: !!document.querySelector('canvas.pinkie-ambient.is-on')};
  out.f30 = await measure();
  T.set('effects.ambientFps', 60); out.f60 = await measure();
  T.set('effects.ambientFps', 20); out.f20 = await measure();
  T.reset();
  out.wStandard = canvas()?.width; out.cssW = canvas()?.getBoundingClientRect().width;
  T.set('render.pixelRatio', 'native'); await new Promise(r => setTimeout(r, 300)); out.wNative = canvas()?.width;
  T.set('render.pixelRatio', 'low'); await new Promise(r => setTimeout(r, 300)); out.wLow = canvas()?.width;
  T.reset(); await new Promise(r => setTimeout(r, 300)); out.wBack = canvas()?.width;
  return out;`);
const SPEC_DEFAULTS = {'effects.ambientFps': 30, 'effects.particles': 1, 'render.pixelRatio': 'standard', 'history.liveWindow': 512, 'history.pageSize': 128,
  'history.scanPages': 12, 'history.maxChars': 240000, 'process.maxCards': 80, 'process.maxText': 8000, 'warmup.idleRoutes': 3, 'warmup.maxRoutes': 8, 'ink.scale': 1};
check('fresh profile stores nothing and every value is today\'s constant', fx.stored === null && JSON.stringify(Object.entries(fx.defaults).sort()) === JSON.stringify(Object.entries(SPEC_DEFAULTS).sort()), fx.defaults);
check('ambient canvas runs by default', fx.ambientOn);
check('氛围帧率: default ≈30 fps', fx.f30.fps >= 24 && fx.f30.fps <= 32, fx.f30);
check('氛围帧率: 60 fps setting draws ~2× as often', fx.f60.fps >= 45, fx.f60);
check('氛围帧率: 20 fps setting draws less', fx.f20.fps >= 15 && fx.f20.fps <= 22, fx.f20);
// Unrestricted-mode ambient: 1× DPR in standard (soft mode), screen density in 原生.
check('画布清晰度: standard keeps today\'s 1× for the soft unrestricted backdrop', Math.abs(fx.wStandard - Math.round(fx.cssW)) <= 1, fx);
check('画布清晰度: 原生 draws at the screen density (2×)', Math.abs(fx.wNative - Math.round(fx.cssW * fx.dpr)) <= 1, fx);
check('画布清晰度: 低 draws at 1×, and reset restores', Math.abs(fx.wLow - Math.round(fx.cssW)) <= 1 && fx.wBack === fx.wStandard, fx);

// particles: switch to 唠嗑 (balloons, 7 by default) and count balloon fills per frame
const particles = await evaluate(`
  const T = window.PinkieTuning;
  const proto = CanvasRenderingContext2D.prototype; let frames = 0, ellipses = 0;
  const wrap = (name, onCall) => { const orig = proto[name]; proto[name] = function (...a) { if (this.canvas.classList?.contains('pinkie-ambient')) onCall(); return orig.apply(this, a); }; };
  wrap('clearRect', () => frames++); wrap('ellipse', () => ellipses++);
  window.__pinkieBuddy.ambient.sync();
  document.documentElement.setAttribute('data-laolao-mode', 'chat');
  try { localStorage.setItem('laolao:active-mode', 'chat'); } catch {}
  window.dispatchEvent(new CustomEvent('laolao:modechange', {detail: {mode: 'chat'}}));
  await new Promise(r => setTimeout(r, 800));
  const measure = async () => { frames = 0; ellipses = 0; await new Promise(r => setTimeout(r, 1500)); return frames ? ellipses / frames : 0; };
  const one = await measure();
  T.set('effects.particles', 2); await new Promise(r => setTimeout(r, 300)); const two = await measure();
  T.set('effects.particles', 0.5); await new Promise(r => setTimeout(r, 300)); const half = await measure();
  T.reset();
  return {mode: document.documentElement.getAttribute('data-laolao-mode'), one, two, half};`);
check('粒子数量: 2× draws twice the balloons, 0.5× half', particles.one > 0 && Math.abs(particles.two / particles.one - 2) < 0.15 && Math.abs(particles.half / particles.one - 4 / 7) < 0.15, particles);

const ink = await evaluate(`
  const T = window.PinkieTuning, L = window.__laolaoLaser;
  const stroke = async () => {
    L.on(); L.setTool('pen');
    const ev = (type, x, y) => window.dispatchEvent(new PointerEvent(type, {clientX: x, clientY: y, button: 0, bubbles: true}));
    ev('pointerdown', 10, 10);
    for (let i = 0; i < 4000; i++) ev('pointermove', 10 + (i % 600) * 2, 10 + Math.floor(i / 600) * 3);
    ev('pointerup', 0, 0);
    const pts = L.strokePoints().at(-1);
    L.setTool('laser');
    for (let i = 0; i < 2000; i++) ev('pointermove', 10 + (i % 600) * 2, 300 + Math.floor(i / 600) * 3);
    const trail = L.trailPoints();
    L.clear(); L.off();
    return {pts, trail};
  };
  const one = await stroke();
  T.set('ink.scale', 3); const three = await stroke();
  T.set('ink.scale', 0.5); const half = await stroke();
  T.reset();
  return {one, three, half};`);
check('笔迹长度: 1× keeps 1200 stroke / 480 trail points', ink.one.pts === 1200 && ink.one.trail <= 480 && ink.one.trail > 400, ink.one);
check('笔迹长度: 3× keeps 3600 / 1440, 0.5× keeps 600 / 240', ink.three.pts === 3600 && ink.three.trail > 1200 && ink.half.pts === 600 && ink.half.trail <= 240, ink);

const processRun = async (tuning) => {
  const seeded = {};
  for (let i = 0; i < 150; i++) seeded['pinkie:process:old:' + i] = {text: 'x', ms: 0, count: 1, at: 1000 + i};
  await page('Page.navigate', {url: BASE}); await sleep(800);
  await evaluate(`localStorage.clear(); localStorage.setItem('laolao:process-thinking:v1', ${JSON.stringify(JSON.stringify(seeded))}); ${tuning ? `localStorage.setItem('pinkie.tuning.v1', ${JSON.stringify(JSON.stringify(tuning))});` : ''} return 1;`);
  await page('Page.navigate', {url: BASE});
  await evaluate(`for (let i = 0; i < 80 && document.getElementById('laolao-splash'); i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 2000)); return 1;`);
  return evaluate(`await window.__fake.scenario('narrated', {thinking: 'T'.repeat(30000), thinkingChunks: 1, gap: 150});
    await new Promise(r => setTimeout(r, 1500));
    const store = JSON.parse(localStorage.getItem('laolao:process-thinking:v1') || '{}');
    const fresh = Object.entries(store).filter(([k]) => !k.startsWith('pinkie:process:old:'));
    return {cards: Object.keys(store).length, longest: Math.max(0, ...fresh.map(([, r]) => (r.text || '').length))};`);
};
const pDefault = await processRun(null);
check('思考过程: default keeps 80 cards, text ≤ 8000', pDefault.cards === 80 && pDefault.longest > 7000 && pDefault.longest <= 8000, pDefault);
const pMore = await processRun(level('standard', {'process.maxCards': 300, 'process.maxText': 50000}));
check('思考过程: raised limits keep all 151 cards and 30 000+ characters', pMore.cards === 151 && pMore.longest >= 30000, pMore);
const pLess = await processRun(level('saver'));
check('思考过程: 省着用 keeps 40 cards, text ≤ 4000', pLess.cards === 40 && pLess.longest <= 4000 && pLess.longest > 3000, pLess);

const warmRun = async (tuning) => {
  await open(BASE, tuning);
  await sleep(2500);
  return evaluate(`const idle = document.querySelectorAll('link[data-laolao-route-warmup]').length;
    const links = [...document.querySelectorAll('a[href]')].filter(a => a.origin === location.origin && !a.pathname.startsWith('/chat'));
    for (const a of links) a.dispatchEvent(new PointerEvent('pointerover', {bubbles: true}));
    return {idle, links: links.length, total: document.querySelectorAll('link[data-laolao-route-warmup]').length};`);
};
const wDefault = await warmRun(null);
// The idle pass runs twice (page load, then splash cleared), each warming up to the limit — unchanged behaviour.
check('预加载: default warms 3 per idle pass (2 passes), at most 8', wDefault.idle === 6 && wDefault.total === 8, wDefault);
const wNone = await warmRun(level('standard', {'warmup.idleRoutes': 0, 'warmup.maxRoutes': 4}));
check('预加载: 不备 warms none while idle, hover cap 4', wNone.idle === 0 && wNone.total === 4, wNone);
const wMax = await warmRun(level('max'));
check('预加载: 全开 warms 6 per idle pass, cap raised past 8 (≤ 16)', wMax.idle === 12 && wMax.total > 8 && wMax.total <= 16, wMax);

// ── the page itself ───────────────────────────────────────────────────────────
await open(BASE, null);
const ui = await evaluate(`
  for (let i = 0; i < 20 && !document.getElementById('pinkie-power-entry'); i++) await new Promise(r => setTimeout(r, 250));
  const railEntry = document.getElementById('pinkie-power-entry');
  const railInfo = {inRail: !!railEntry?.closest('.chat-workspace-rail'), afterRoundtable: railEntry?.previousElementSibling?.id === 'pinkie-roundtable-entry',
    visible: !!railEntry && railEntry.getBoundingClientRect().width > 0};
  railEntry?.click(); await new Promise(r => setTimeout(r, 400));
  railInfo.opens = window.__pinkiePower.isOpen; window.__pinkiePower.close();
  window.__pinkieBuddy.toggleMenu();
  await new Promise(r => setTimeout(r, 200));
  const menuItem = [...document.querySelectorAll('.pinkie-buddy__item')].find(b => b.textContent.includes('进阶调节'));
  menuItem?.click();
  await new Promise(r => setTimeout(r, 500));
  const q = s => document.querySelector(s);
  const out = {rail: railInfo, fromMenu: window.__pinkiePower.isOpen, rows: document.querySelectorAll('.pinkie-power__row').length};
  q('.pinkie-power__level--max').click();
  out.max = window.PinkieTuning.level;
  const row = q('.pinkie-power__row[data-key="history.maxChars"]');
  [...row.querySelectorAll('.pinkie-power__opt')].find(b => b.textContent.startsWith('12'))?.click();
  out.override = window.PinkieTuning.overrides; out.mark = !row.querySelector('.pinkie-power__changed').hidden;
  [...q('.pinkie-power__row:not([data-key])').querySelectorAll('.pinkie-power__opt')][1].click();
  out.motion = window.__pinkieMotion.reduce;
  q('.pinkie-power__reset').click();
  out.afterReset = {stored: localStorage.getItem('pinkie.tuning.v1'), motion: window.__pinkieMotion.reduce, level: window.PinkieTuning.level};
  return out;`);
check('rail button sits under 灵感圆桌 and opens the page', ui.rail.inRail && ui.rail.afterRoundtable && ui.rail.visible && ui.rail.opens, ui.rail);
check('page also opens from the 小碧琪 menu, with every row', ui.fromMenu && ui.rows === 14);
check('page: 全开 + one override + 减少动效, then 恢复默认 clears everything', ui.max === 'max' && ui.override['history.maxChars'] === 120000 && ui.mark && ui.motion === true
  && ui.afterReset.stored === null && ui.afterReset.motion === false && ui.afterReset.level === 'standard', ui);

const shot = async (name, theme) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, {recursive: true});
  await evaluate(`document.documentElement.setAttribute('data-theme-mode', ${JSON.stringify(theme)}); ${theme === 'light' ? "document.documentElement.removeAttribute('data-pinkie-night');" : "document.documentElement.setAttribute('data-pinkie-night', '');"} window.__pinkiePower.open(); await new Promise(r => setTimeout(r, 700)); return 1;`);
  const {data} = await page('Page.captureScreenshot', {format: 'png'});
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
  await evaluate(`window.__pinkiePower.close(); return 1;`);
};
await shot('power-settings-light.png', 'light');
await shot('power-settings-dark.png', 'dark');
if (SHOTS) {
  const box = await evaluate(`const r = document.getElementById('pinkie-power-entry')?.closest('.chat-workspace-rail')?.getBoundingClientRect(); return r && {x: r.x, y: r.y, width: r.width, height: r.height};`);
  if (box) {
    const {data} = await page('Page.captureScreenshot', {format: 'png', clip: {...box, x: box.x - 8, width: box.width + 16, scale: 1}});
    fs.writeFileSync(path.join(SHOTS, 'rail-entry.png'), Buffer.from(data, 'base64'));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
cleanup();
process.exit(failed.length ? 1 : 0);
