// 「以后」S 级 P3 允许清单（ui5，11-25）：Metre 设置弹层「允许的命令」卡片。
// 只走原生 exec.approvals.get / set：带 baseHash、整份写回、只改 agents.metre.allowlist；
// security / ask 归第五批 P2，不许动；baseHash 对不上要重读再写（P2 刚换档时不能把它冲掉）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-allow.js'), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {};
    this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.className = ''; this.id = ''; this.listeners = {};
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  replaceChildren() { for (const k of this.children) k.parent = null; this.children = []; }
  before(n) { const p = this.parent; n.parent = p; p.children.splice(p.children.indexOf(this), 0, n); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  click() { for (const f of this.listeners.click || []) f({}); }
  focus() {}
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.isRoot === true; }
  closest(sel) { if (sel !== '[hidden]') throw new Error('unsupported ' + sel); for (let n = this; n; n = n.parent) if (n.hidden) return n; return null; }
  matches(sel) { return sel.startsWith('.') ? this.className.split(/\s+/).includes(sel.slice(1)) : this.tagName === sel.toUpperCase(); }
  all(sel, out = []) { for (const c of this.children) { if (c.matches(sel)) out.push(c); c.all(sel, out); } return out; }
  querySelector(sel) { return this.all(sel)[0] || null; }
}

function env({mode = 'metre', file, conflictOnce = null} = {}) {
  const body = new El('body'); body.isRoot = true;
  const html = new El('html'); html.setAttribute('data-laolao-mode', mode);
  const dialog = new El('div'); dialog.id = 'laolao-user-settings';
  const scroll = new El('div'); scroll.className = 'pinkie-user-settings__scroll';
  const footer = new El('footer'); footer.className = 'pinkie-user-settings__footer';
  scroll.append(footer); dialog.append(scroll); body.append(dialog);
  // 假网关：和原生一样，set 的 baseHash 对不上就报 changed since last load。
  const gw = {file: plain(file), hash: 1, calls: []};
  let delayGet = null;
  const gwRequest = async (method, params) => {
    gw.calls.push([method, plain(params || {})]);
    if (method === 'exec.approvals.get') {
      const snap = {path: 'x', exists: true, hash: 'h' + gw.hash, file: plain(gw.file)};
      if (delayGet) { const wait = delayGet; delayGet = null; await wait; }
      return snap;
    }
    if (method === 'exec.approvals.set') {
      if (conflictOnce) { const f = conflictOnce; conflictOnce = null; f(gw); gw.hash++; }
      if (params.baseHash !== 'h' + gw.hash) throw new Error('exec approvals changed since last load; re-run exec.approvals.get and retry');
      gw.file = plain(params.file); gw.hash++;
      return {hash: 'h' + gw.hash, file: plain(gw.file)};
    }
    throw new Error('unexpected ' + method);
  };
  const listeners = {}; const polls = [];
  const document = {documentElement: html, readyState: 'complete', createElement: (t) => new El(t), addEventListener() {},
    querySelector: (sel) => (sel === '#laolao-user-settings .pinkie-user-settings__scroll' ? scroll : null)};
  const window = {__laolaoSidebar: {gwRequest}, Pinkie: {domWatch: {poll: (f, ms) => polls.push([f, ms])}}, addEventListener: (t, f) => (listeners[t] ||= []).push(f)};
  vm.runInNewContext(SRC, {window, document, JSON, setImmediate});
  const card = () => scroll.querySelector('.pk-metre-allow');
  const text = (n) => n.textContent + n.children.map(text).join('');   // 真 DOM 的 textContent 会拼上子元素的字
  const items = () => (card() ? card().all('.pk-metre-allow__item').map((r) => text(r.querySelector('.pinkie-user-settings__row-title'))) : []);
  const status = () => card().querySelector('.pk-metre-allow__status').textContent;
  const input = () => card().querySelector('.pk-metre-allow__input');
  const addBtn = () => card().querySelector('.pk-metre-allow__add').all('button')[0];
  const removeBtn = (pattern) => card().all('.pk-metre-allow__item').find((r) => text(r.querySelector('.pinkie-user-settings__row-title')) === pattern).all('button')[0];
  const sets = () => gw.calls.filter(([m]) => m === 'exec.approvals.set');
  const setMode = (m) => { html.setAttribute('data-laolao-mode', m); for (const f of listeners['laolao:modechange'] || []) f({}); };
  return {gw, card, items, status, input, addBtn, removeBtn, sets, polls, setMode, dialog, footer, scroll,
    delayNextGet(promise) { delayGet = promise; }};
}

const BASE = {version: 1, defaults: {security: 'full', ask: 'off'}, agents: {
  main: {security: 'allowlist', ask: 'on-miss', allowlist: [{id: 'm1', pattern: 'ls'}]},
  metre: {security: 'allowlist', ask: 'on-miss', allowlist: [{id: 'a1', pattern: 'git'}, {id: 'a2', pattern: 'npm', argPattern: 'test'}]},
}};

test('Metre: the card sits before the footer, lists the metre allowlist and says how it applies', async () => {
  const e = env({file: BASE});
  await flush();
  assert.ok(e.card(), 'card mounted');
  assert.equal(e.scroll.children.indexOf(e.card()) + 1, e.scroll.children.indexOf(e.footer), 'card goes right above the footer');
  assert.equal(e.card().hidden, false);
  assert.deepEqual(e.items(), ['git', 'npm'], 'only agents.metre, not main');
  assert.match(e.status(), /清单外的先问你/);
  assert.equal(e.removeBtn('git').getAttribute('aria-label'), '从允许清单里移除 git');
  assert.equal(e.input().getAttribute('aria-label'), '要允许的命令');
});

test('adding writes back the whole file with baseHash and changes only agents.metre.allowlist', async () => {
  const e = env({file: BASE});
  await flush();
  e.input().value = '  pnpm  '; e.addBtn().click();
  await flush();
  const [[, params]] = e.sets();
  assert.equal(params.baseHash, 'h1');
  const want = plain(BASE); want.agents.metre.allowlist.push({pattern: 'pnpm'});
  assert.deepEqual(params.file, want, 'defaults, main, metre.security / ask untouched');
  assert.deepEqual(e.items(), ['git', 'npm', 'pnpm']);
  assert.equal(e.input().value, '', 'input clears after a successful add');
});

test('exact duplicates, blanks and multi-line input are refused without writing', async () => {
  const e = env({file: BASE});
  await flush();
  for (const v of ['git', '   ', 'a\nb']) { e.input().value = v; e.addBtn().click(); await flush(); }
  assert.equal(e.sets().length, 0);
  assert.match(e.status(), /不要换行/);
});

test('GIT is kept beside git: the kernel matches command names case-sensitively off Windows', async () => {
  const e = env({file: BASE});
  await flush();
  e.input().value = 'GIT'; e.addBtn().click(); await flush();
  assert.deepEqual(e.gw.file.agents.metre.allowlist.map((x) => x.pattern), ['git', 'npm', 'GIT']);
  assert.deepEqual(e.items(), ['git', 'npm', 'GIT']);
  e.input().value = 'git'; e.addBtn().click(); await flush();
  assert.equal(e.sets().length, 1, 'the exact pattern already in the list is still refused');
  assert.match(e.status(), /已经有/);
  assert.doesNotMatch(e.card().querySelector('.pk-metre-allow__help').textContent, /大小写不分/);
});

test('removing goes by id; removing the last one drops the allowlist key', async () => {
  const e = env({file: {version: 1, agents: {metre: {security: 'allowlist', ask: 'off', allowlist: [{id: 'a1', pattern: 'git'}, {id: 'a3', pattern: 'git'}]}}}});
  await flush();
  e.removeBtn('git').click(); await flush();
  assert.deepEqual(e.gw.file.agents.metre.allowlist, [{id: 'a3', pattern: 'git'}], 'only the row clicked');
  e.removeBtn('git').click(); await flush();
  assert.deepEqual(e.gw.file.agents.metre, {security: 'allowlist', ask: 'off'});
  assert.match(e.status(), /清单外的不跑/);
});

test('base hash conflict: re-reads and keeps what the other writer just changed (level and a new pattern)', async () => {
  const e = env({file: BASE, conflictOnce: (gw) => {
    gw.file.agents.metre.security = 'full';
    gw.file.agents.metre.ask = 'off';
    gw.file.agents.metre.allowlist.push({id: 'c', pattern: 'cargo'});
  }});
  await flush();
  e.input().value = 'node'; e.addBtn().click();
  await flush();
  assert.equal(e.sets().length, 2, 'retried once');
  assert.equal(e.gw.file.agents.metre.security, 'full', 'P2 change survives');
  assert.equal(e.gw.file.agents.metre.ask, 'off');
  assert.deepEqual(e.gw.file.agents.metre.allowlist.map((x) => x.pattern), ['git', 'npm', 'cargo', 'node']);
  assert.match(e.status(), /暂时不起作用/, 'auto level: tells the list is not in effect');
});

test('other modes: card hidden and the gateway is never asked', async () => {
  const e = env({mode: 'chat', file: BASE});
  await flush();
  assert.equal(e.card().hidden, true);
  assert.equal(e.gw.calls.length, 0);
  e.setMode('metre'); await flush();
  assert.equal(e.card().hidden, false);
  assert.deepEqual(e.items(), ['git', 'npm'], 'loads once Metre is on');
  assert.equal(e.polls.length, 1, 'one domWatch poll, no own timers');
});

test('a lone * asks once more before it is added, and shows as 全部命令', async () => {
  const e = env({file: BASE});
  await flush();
  e.input().value = '*'; e.addBtn().click(); await flush();
  assert.equal(e.sets().length, 0, 'first click only warns');
  assert.match(e.status(), /放行所有命令/);
  assert.equal(e.addBtn().textContent, '确认放行全部');
  e.addBtn().click(); await flush();
  assert.equal(e.sets().length, 1);
  assert.deepEqual(e.gw.file.agents.metre.allowlist.at(-1), {pattern: '*'});
  assert.ok(e.items().includes('全部命令（不再询问）'), 'listed in words, not a bare *');
  assert.equal(e.addBtn().textContent, '加进清单');
});

test('changing the text after the * warning cancels the pending confirm', async () => {
  const e = env({file: BASE});
  await flush();
  e.input().value = '*'; e.addBtn().click(); await flush();
  e.input().value = 'node'; for (const f of e.input().listeners.input || []) f({});
  assert.equal(e.addBtn().textContent, '加进清单');
  e.input().value = '*'; e.addBtn().click(); await flush();
  assert.equal(e.sets().length, 0, 'a fresh * warns again');
});

test('empty input disables the add button; the placeholder never suggests an entry already listed', async () => {
  const e = env({file: BASE});
  await flush();
  assert.equal(e.addBtn().disabled, true);
  assert.equal(e.input().placeholder, '例如 pnpm');
  e.input().value = 'pnpm'; for (const f of e.input().listeners.input || []) f({});
  assert.equal(e.addBtn().disabled, false);
  e.addBtn().click(); await flush();
  assert.equal(e.input().placeholder, '例如 node', 'moves on once pnpm is in the list');
  assert.equal(e.addBtn().disabled, true, 'cleared input disables it again');
});

test('paths are split into segments after each / or \\ so long ones wrap between folders; text stays exact', async () => {
  const p = 'C:/Users/me/stable-x86_64-pc/bin\\tool.exe';
  const e = env({file: {version: 1, agents: {metre: {allowlist: [{id: 'p', pattern: p}]}}}});
  await flush();
  const title = e.card().querySelector('.pk-metre-allow__item').querySelector('.pinkie-user-settings__row-title');
  assert.deepEqual(title.children.map((c) => c.textContent), ['C:/', 'Users/', 'me/', 'stable-x86_64-pc/', 'bin\\', 'tool.exe']);
  assert.deepEqual(e.items(), [p], 'joined text is the pattern, no extra characters');
});

test('ask always prompts even when security is full, so the list does not silently run commands', async () => {
  const e = env({file: {version: 1, agents: {metre: {security: 'full', ask: 'always', allowlist: [{id: 'a', pattern: 'git'}]}}}});
  await flush();
  assert.match(e.status(), /先问你/);
  assert.doesNotMatch(e.status(), /直接跑/);
});

test('a bare * under allowlist means every command runs; the status does not still say misses will ask', async () => {
  const e = env({file: {version: 1, agents: {metre: {security: 'allowlist', ask: 'on-miss', allowlist: [{id: 's', pattern: '*'}]}}}});
  await flush();
  assert.deepEqual(e.items(), ['全部命令（不再询问）']);
  assert.match(e.status(), /不再问你/);
  assert.doesNotMatch(e.status(), /清单外的先问你/);
});

test('a * with an argPattern is not allow-everything, and a bare * does not claim that while the level is deny', async () => {
  const scoped = env({file: {version: 1, agents: {metre: {security: 'allowlist', ask: 'on-miss', allowlist: [{id: 's', pattern: '*', argPattern: '^--version$'}]}}}});
  await flush();
  assert.deepEqual(scoped.items(), ['*']);
  assert.match(scoped.status(), /清单外的先问你/);
  const shown = env({file: {version: 1, agents: {metre: {security: 'deny', ask: 'off', allowlist: [{id: 's', pattern: '*'}]}}}});
  await flush();
  assert.deepEqual(shown.items(), ['全部命令']);
  assert.match(shown.status(), /不跑命令/);
  const denied = env({file: {version: 1, agents: {metre: {security: 'deny', ask: 'off', allowlist: [{id: 'a', pattern: 'git'}]}}}});
  await flush();
  denied.input().value = '*'; denied.addBtn().click(); await flush();
  assert.equal(denied.sets().length, 0, 'the first click still only warns');
  assert.match(denied.status(), /不起作用/);
  assert.doesNotMatch(denied.status(), /会放行所有命令/);
});

test('a reload that started before an add cannot paint the pre-add file over the add', async () => {
  const e = env({file: BASE});
  await flush();
  e.dialog.hidden = true; e.polls[0][0]();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  e.delayNextGet(gate);
  e.dialog.hidden = false; e.polls[0][0]();
  e.input().value = 'node'; e.addBtn().click();
  await flush();
  assert.deepEqual(e.items(), ['git', 'npm', 'node']);
  release();
  await flush();
  assert.deepEqual(e.items(), ['git', 'npm', 'node'], 'the slow get must not clobber the add');
  assert.deepEqual(e.gw.file.agents.metre.allowlist.map((x) => x.pattern), ['git', 'npm', 'node']);
});

test('reopening the dialog re-reads the file; a closed dialog does nothing', async () => {
  const e = env({file: BASE});
  await flush();
  const gets = () => e.gw.calls.filter(([m]) => m === 'exec.approvals.get').length;
  const n0 = gets();
  e.dialog.hidden = true; e.polls[0][0](); e.polls[0][0](); await flush();
  assert.equal(gets(), n0, 'hidden: no reads');
  e.gw.file.agents.metre.allowlist.push({id: 'z', pattern: 'cargo'});
  e.dialog.hidden = false; e.polls[0][0](); await flush();
  assert.equal(gets(), n0 + 1);
  assert.deepEqual(e.items(), ['git', 'npm', 'cargo']);
});
