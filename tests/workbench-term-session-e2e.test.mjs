// R2 每个聊天会话一个终端（briefs/program-1120/设计-R2.md 第六节）：真的 laolao-workbench.js + laolao-workbench-term.js 在浏览器里接线。
// WebKit 默认，PINKIE_IMAGE_UI_ENGINE=chromium 对照；本机没有浏览器时跳过（CI 跑）。
// 假网关记录 terminal.* 调用。终端组件换成一个只做「恢复 / 新开 / 按键」的假 openclaw-terminal-panel，
// 行为照 ui/runtime 里原生的 restoreSessions：PANEL_KEY 里的 id 先 terminal.list 对一遍再 attach，一个都没接上就 terminal.open。
// 断言（反例的转红在 tests/workbench-term-wire.test.mjs 里做，那边不起浏览器）：
//   1. 同一文件夹两个会话 A / B 各开一个，拿到两个不同的终端；A → B → A 时对 A 调 terminal.attach，不再 open。
//   2. B 的上报里没有 A 的输出（A 自己的上报里有，证明不是空断言）。
//   3. terminal.list 里没有的 id 恢复时丢掉，面板显示「打开终端」，不 attach、不自动开。
//   4. 模型侧没有路径调到 terminal.input：假网关收到的 input 只有面板按键和开终端后那一行 cd。
// 第 9 个会话的 LRU 在 tests/workbench-term-wire.test.mjs 用假网关测，这里不开 9 个。
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = rel => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const bench = read('../ui/injections/laolao-workbench.js');
const term = read('../ui/injections/laolao-workbench-term.js');
const domWatch = read('../ui/injections/laolao-dom-watch.js');
const ORIGIN = 'http://127.0.0.1:30147';
const ROOT = '/work/my proj';
const A = 'agent:project:a', B = 'agent:project:b';
const TYPES = {js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png'};
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'webkit';

let sharedBrowser;
after(async () => { const b = await sharedBrowser; await b?.close?.(); });
async function start() {
  let lib;
  try { lib = playwright(); } catch { return {why: 'Playwright is not installed here'}; }
  const tries = engine === 'chromium' ? [{}, {channel: 'chrome'}, {channel: 'msedge'}] : [{}];
  for (const options of tries) {
    try { return await lib[engine].launch({headless: true, ...options}); } catch {}
  }
  return {why: `no ${engine} browser here`};
}
async function launch(t) {
  sharedBrowser ??= start();
  const b = await sharedBrowser;
  if (b.why) { t.skip(b.why); return null; }
  return b;
}

const html = `<!doctype html><html data-laolao-mode="project"><head><link rel="stylesheet" href="/laolao-workbench.css"></head><body>
<main class="content content--chat" style="position:fixed;inset:0;overflow:auto"><openclaw-chat-pane active><div class="chat-thread"></div></openclaw-chat-pane></main></body></html>`;

async function open(browser) {
  const tab = await browser.newPage({viewport: {width: 1280, height: 800}});
  tab.setDefaultTimeout(10_000);
  await tab.route(`${ORIGIN}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/chat') return route.fulfill({contentType: 'text/html; charset=utf-8', body: html});
    const file = fileURLToPath(new URL('../ui/injections' + url.pathname, import.meta.url));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status: 404, body: ''});
    return route.fulfill({contentType: TYPES[file.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(file)});
  });
  await tab.goto(`${ORIGIN}/chat?session=${encodeURIComponent(A)}`);
  await tab.evaluate(root => {
    const gw = window.gw = {calls: [], live: new Set(), seq: 0, typed: [], contexts: []};
    document.documentElement.dataset.openclawTerminalEnabled = 'true';
    window.__laolaoSidebar = {gwRequest: async (method, params = {}) => {
      params = params || {};
      if (method.startsWith('terminal.')) gw.calls.push([method, params.sessionId || '', typeof params.data === 'string' ? params.data : '']);
      if (method === 'pinkie.workbench.context') { gw.contexts.push(JSON.parse(JSON.stringify(params))); return {ok: true}; }
      if (method === 'pinkie.fs.status') return {root, agentId: 'project', name: 'my proj', bound: true, unrestricted: false, terminal: {enabled: true}};
      if (method === 'pinkie.fs.list') return {entries: []};
      if (method === 'pinkie.fs.git') return {repo: false};
      if (method === 'terminal.list') return {sessions: [...gw.live].map(sessionId => ({sessionId}))};
      if (method === 'terminal.open') { const sessionId = 't' + (++gw.seq); gw.live.add(sessionId); return {sessionId, cwd: '/home/u', shell: '/bin/zsh'}; }
      if (method === 'terminal.attach') { if (!gw.live.has(params.sessionId)) throw new Error('unknown terminal session'); return {buffer: ''}; }
      if (method === 'terminal.close') { gw.live.delete(params.sessionId); return {ok: true}; }
      return {};
    }};
    customElements.define('openclaw-terminal-panel', class extends HTMLElement {
      connectedCallback() {
        if (this.started) return;
        this.started = true; this.tabs = []; this.activeId = null; this.booting = true; this.errorText = null;
        void (async () => {
          let ids = [];
          try { ids = JSON.parse(sessionStorage.getItem('openclaw.terminal.sessions.v1') || '[]'); } catch {}
          const live = new Set(((await this.client.request('terminal.list', {}))?.sessions || []).map(s => s.sessionId));
          for (const id of ids.filter(id => live.has(id))) {
            await this.client.request('terminal.attach', {sessionId: id});
            this.tabs.push({id: 'tab-' + id, gatewaySessionId: id, status: 'live'});
          }
          if (!this.tabs.length) {
            const r = await this.client.request('terminal.open', {cols: 80, rows: 24});
            this.tabs.push({id: 'tab-' + r.sessionId, gatewaySessionId: r.sessionId, status: 'live'});
          }
          this.activeId = this.tabs[0].id; this.booting = false;
        })();
      }
      // 人在面板里按键
      type(data) {
        const tab = this.tabs.find(t => t.id === this.activeId);
        window.gw.typed.push(data);
        return this.client.request('terminal.input', {sessionId: tab.gatewaySessionId, data});
      }
    });
  }, ROOT);
  await tab.addScriptTag({content: domWatch});
  await tab.addScriptTag({content: term});
  await tab.addScriptTag({content: bench});
  assert.equal(await tab.evaluate(() => window.__pinkieWorkbench.show()), true, 'the workbench comes out');
  await tab.evaluate(() => window.__pinkieWorkbench.togglePanel('terminal', true));
  return tab;
}

const calls = (tab, method) => tab.evaluate(m => window.gw.calls.filter(c => c[0] === m).map(c => c[1]), method);
const openButton = tab => tab.locator('.pk-wb-empty--terminal .pk-wb-btn:not([disabled])');
async function switchTo(tab, key) {
  await tab.evaluate(key => {
    history.pushState(null, '', '/chat?session=' + encodeURIComponent(key));
    window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {sessionKey: key}}));
  }, key);
  await tab.waitForFunction(key => window.__pinkieWorkbench.state.key === key && Boolean(window.__pinkieWorkbench.state.info?.root), key);
}
const booted = tab => tab.waitForFunction(() => { const p = document.querySelector('openclaw-terminal-panel'); return p?.booting === false && p.isConnected; });
const emit = (tab, sessionId, data) => tab.evaluate(([sessionId, data]) => window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail: {event: 'terminal.data', payload: {sessionId, data}}})), [sessionId, data]);
async function reported(tab, key) {
  await tab.evaluate(key => window.__pinkieWorkbench.flushContext(key), key);
  return tab.evaluate(key => window.gw.contexts.filter(c => c.sessionKey === key && c.forMessage).at(-1) || null, key);
}

test(`per-session terminals: A → B → A re-attaches A, B never sees A's output, the model never types (${engine})`, {timeout: 90_000}, async t => {
  const browser = await launch(t); if (!browser) return;
  const tab = await open(browser);
  try {
    // A：先显示「本会话终端 · 文件夹名」+「打开终端」，不自动开
    await openButton(tab).waitFor();
    assert.match(await tab.locator('.pk-wb-empty--terminal').textContent(), /本会话终端 · my proj/);
    assert.deepEqual(await calls(tab, 'terminal.open'), [], 'nothing opens until the user asks');
    await openButton(tab).click();
    await booted(tab);
    await tab.waitForFunction(() => window.gw.calls.some(c => c[0] === 'terminal.input' && c[1] === 't1'));
    assert.deepEqual(await tab.evaluate(() => window.gw.calls.filter(c => c[0] === 'terminal.input').map(c => c[2])), ["cd -- '/work/my proj' && clear\r"], 'cd into the folder, quoted for the shell');
    await tab.evaluate(() => document.querySelector('openclaw-terminal-panel').type('echo a\r'));
    await emit(tab, 't1', 'A 的输出 只在 A 里\r\n');
    const a = await reported(tab, A);
    assert.deepEqual(a.terminals.map(x => x.sessionId), ['t1']);
    assert.match(a.terminals[0].output, /A 的输出/, 'A reports its own terminal (the B check below is not vacuous)');

    // B：同一文件夹，但没有自己的终端 → 又是「打开终端」；A 的终端停放，不关
    await switchTo(tab, B);
    await openButton(tab).waitFor();
    assert.deepEqual(await calls(tab, 'terminal.open'), ['']);
    assert.deepEqual(await calls(tab, 'terminal.close'), [], 'switching sessions parks, never closes');
    await openButton(tab).click();
    await booted(tab);
    await tab.waitForFunction(() => window.gw.calls.filter(c => c[0] === 'terminal.open').length === 2);
    assert.equal(await tab.evaluate(() => document.querySelector('openclaw-terminal-panel').tabs[0].gatewaySessionId), 't2', 'B gets its own terminal');
    await emit(tab, 't2', 'B 的输出\r\n');
    const b = await reported(tab, B);
    assert.deepEqual(b.terminals.map(x => x.sessionId), ['t2']);
    assert.ok(!JSON.stringify(b).includes('A 的输出'), "B's report has none of A's output");

    // 回到 A：直接接回 t1（attach），不新开
    await switchTo(tab, A);
    await booted(tab);
    await tab.waitForFunction(() => window.gw.calls.some(c => c[0] === 'terminal.attach'));
    assert.deepEqual(await calls(tab, 'terminal.attach'), ['t1']);
    assert.equal(await tab.evaluate(() => window.gw.calls.filter(c => c[0] === 'terminal.open').length), 2, 'A is re-attached, not reopened');

    // B 的终端被原生回收了：恢复时丢掉，回到「打开终端」，不 attach、不自动开
    await tab.evaluate(() => window.gw.live.delete('t2'));
    await switchTo(tab, B);
    await openButton(tab).waitFor();
    assert.deepEqual(await calls(tab, 'terminal.attach'), ['t1']);
    assert.equal(await tab.evaluate(() => window.gw.calls.filter(c => c[0] === 'terminal.open').length), 2);

    // 模型侧没有路径调到 terminal.input：只有面板按键和开终端后那一行 cd
    const inputs = await tab.evaluate(() => ({sent: window.gw.calls.filter(c => c[0] === 'terminal.input').map(c => c[2]), typed: window.gw.typed}));
    for (const data of inputs.sent) assert.ok(inputs.typed.includes(data) || /^cd -- '.*' && clear\r$/.test(data), `unexpected terminal.input ${JSON.stringify(data)}`);
  } finally { await tab.close(); }
});
