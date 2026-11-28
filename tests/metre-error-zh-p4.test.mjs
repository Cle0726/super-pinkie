// P4（#96 L62）：Metre 审批卡、「允许的命令」卡和解锁框不再把英文原文 / 堆栈 / undefined / [object Object] 写进界面。
// 复发场景：网关超时或断线时 gwRequest 抛 Error('gateway timeout') / Error('gateway socket unavailable')，
// 网关回 ok:false 时带英文 message，或者 reject 的根本不是 Error（undefined、普通对象）。
// 修复前：审批行显示「没批成：gateway timeout」，toast 显示「没改成：[object Object]」，允许清单状态行
// 显示「读不到审批设置：gateway socket unavailable」「没存上：undefined」，解锁框错误行显示「gateway timeout」。
// 修复后：界面上只放中文说明，原文进 console.warn；本来就是中文的提示照原样显示。
// 直接从 ui/injections/laolao-metre-{perm,allow,lock}.js 取真实代码段放进 vm 里跑，不起浏览器、不连网关。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, 'ui/injections', name), 'utf8');
const PERM = read('laolao-metre-perm.js'), ALLOW = read('laolao-metre-allow.js'), LOCK = read('laolao-metre-lock.js');
const line = (src, prefix) => {
  const start = src.indexOf(prefix);
  assert.ok(start >= 0, `找不到 ${prefix}`);
  return src.slice(start, src.indexOf('\n', start));
};
const between = (src, from, to) => {
  const start = src.indexOf(from), end = src.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return src.slice(start, end);
};
// 修复前文件里没有 zh：给一个「原样返回」的替身，好让代码段照旧能跑、断言在「原文漏出」上失败。
const zhOf = (src) => (src.includes('const zh = ') ? line(src, 'const zh = ') : 'const zh = (e, f) => String(e?.message ?? e);');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const LEAK = /gateway|timeout|socket|unavailable|ECONN|Traceback|undefined|\[object|[{}]|\bat\s/i;
const consoleSpy = () => { const warnings = []; return {warnings, console: {warn: (...a) => warnings.push(a.map((x) => String(x?.message ?? x)).join(' '))}}; };
// 网关失败的几种样子：英文 Error、带堆栈的 Error、普通对象、undefined
const stack = Object.assign(new Error('Cannot read properties of undefined'), {stack: 'TypeError: x\n    at gwRequest (laolao-sidebar.js:146:20)'});
const FAILURES = [
  ['gateway timeout', new Error('gateway timeout')],
  ['gateway socket unavailable', new Error('gateway socket unavailable')],
  ['英文 message', new Error('exec approval not found')],
  ['普通对象', {code: 'UNAVAILABLE'}],
  ['undefined', undefined],
  ['带堆栈', stack],
];

// ---------- 审批卡（perm） ----------
function permEnv(rpc) {
  const spy = consoleSpy(), toasts = [];
  const code = `(() => {
    ${line(PERM, 'const el = ')}
    ${line(PERM, 'const clip = ')}
    ${zhOf(PERM)}
    const METRE = /^agent:metre:/, uid = () => 'u1', paint = () => {};
    const state = {key: 'agent:metre:dashboard:t1', planOn: false};
    ${between(PERM, 'async function decide(', '  // 原生 openclaw-modal-dialog')}
    ${between(PERM, 'async function togglePlan(', '  function chip(')}
    return {decide, togglePlan, approvePlan};
  })()`;
  const document = {createElement: (t) => ({tagName: t, className: '', textContent: ''})};
  const window = {__laolaoSidebar: {toast: (m) => toasts.push(m)}};
  const fns = vm.runInNewContext(code, {document, window, rpc, console: spy.console, globalThis: {console: spy.console}});
  return {...fns, toasts, warnings: spy.warnings};
}
const fakeRow = () => {
  const acts = {replaceChildren() {}};
  return {dataset: {}, querySelectorAll: () => [], querySelector: () => acts};
};

for (const [name, failure] of FAILURES) {
  test(`审批卡：网关失败（${name}）时「没批成」只显示中文，原文进日志`, async () => {
    const e = permEnv(async () => { throw failure; });
    const row = fakeRow();
    await e.decide({id: 'a2', kind: 'exec'}, 'allow-once', row);
    assert.match(row.dataset.error, /^没批成：[㐀-鿿]/);
    assert.doesNotMatch(row.dataset.error, LEAK);
    if (failure) assert.ok(e.warnings.length >= 1, '原文应进 console.warn');
  });
  test(`先出方案 / 照方案做：网关失败（${name}）时 toast 只显示中文`, async () => {
    const e = permEnv(async () => { throw failure; });
    await e.togglePlan();
    await e.approvePlan();
    assert.equal(e.toasts.length, 2);
    assert.match(e.toasts[0], /^没改成：[㐀-鿿]/);
    assert.match(e.toasts[1], /^没发出去：[㐀-鿿]/);
    for (const t of e.toasts) assert.doesNotMatch(t, LEAK);
  });
}
test('审批卡：服务端本来就是中文的提示照原样显示', async () => {
  const e = permEnv(async () => { throw new Error('这条审批已经过期'); });
  const row = fakeRow();
  await e.decide({id: 'a2', kind: 'plugin'}, 'deny', row);
  assert.equal(row.dataset.error, '没批成：这条审批已经过期');
});

// ---------- 允许的命令（allow） ----------
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.className = ''; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  replaceChildren() { this.children = []; }
  before(n) { const p = this.parent; n.parent = p; p.children.splice(p.children.indexOf(this), 0, n); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  click() { for (const f of this.listeners.click || []) f({}); }
  focus() {}
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.isRoot === true; }
  closest() { for (let n = this; n; n = n.parent) if (n.hidden) return n; return null; }
  matches(sel) { return sel.startsWith('.') ? this.className.split(/\s+/).includes(sel.slice(1)) : this.tagName === sel.toUpperCase(); }
  all(sel, out = []) { for (const c of this.children) { if (c.matches(sel)) out.push(c); c.all(sel, out); } return out; }
  querySelector(sel) { return this.all(sel)[0] || null; }
}
function allowEnv(gwRequest) {
  const spy = consoleSpy();
  const body = new El('body'); body.isRoot = true;
  const html = new El('html'); html.setAttribute('data-laolao-mode', 'metre');
  const scroll = new El('div'); scroll.className = 'pinkie-user-settings__scroll';
  const footer = new El('footer'); footer.className = 'pinkie-user-settings__footer';
  scroll.append(footer); body.append(scroll);
  const document = {documentElement: html, readyState: 'complete', createElement: (t) => new El(t), addEventListener() {},
    querySelector: (sel) => (sel === '#laolao-user-settings .pinkie-user-settings__scroll' ? scroll : null)};
  const window = {__laolaoSidebar: {gwRequest}, Pinkie: {domWatch: {poll() {}}}, addEventListener() {}};
  vm.runInNewContext(ALLOW, {window, document, JSON, setImmediate, console: spy.console, globalThis: {console: spy.console}});
  const card = () => scroll.querySelector('.pk-metre-allow');
  return {card, status: () => card().querySelector('.pk-metre-allow__status').textContent, warnings: spy.warnings};
}
const FILE = {version: 1, agents: {metre: {security: 'allowlist', ask: 'on-miss', allowlist: [{id: 'a1', pattern: 'git'}]}}};

for (const [name, failure] of FAILURES) {
  test(`允许清单：读设置失败（${name}）时状态行只显示中文`, async () => {
    const e = allowEnv(async () => { throw failure; });
    await flush();
    assert.match(e.status(), /^读不到审批设置：[㐀-鿿]/);
    assert.doesNotMatch(e.status(), LEAK);
  });
  test(`允许清单：写回失败（${name}）时「没存上」只显示中文`, async () => {
    const e = allowEnv(async (method) => {
      if (method === 'exec.approvals.get') return {hash: 'h1', file: JSON.parse(JSON.stringify(FILE))};
      throw failure;
    });
    await flush();
    const input = e.card().querySelector('.pk-metre-allow__input');
    input.value = 'pnpm';
    e.card().querySelector('.pk-metre-allow__add').all('button')[0].click();
    await flush();
    assert.match(e.status(), /^没存上：[㐀-鿿]/);
    assert.doesNotMatch(e.status(), LEAK);
  });
}
test('允许清单：网关断线时原文 gateway socket unavailable 进 console.warn', async () => {
  const e = allowEnv(async () => { throw new Error('gateway socket unavailable'); });
  await flush();
  assert.ok(e.warnings.some((w) => w.includes('gateway socket unavailable')), `实际：${e.warnings.join(' | ')}`);
});

// ---------- 解锁框（lock） ----------
function lockCard(rpc) {
  const spy = consoleSpy();
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.className = ''; }
    setAttribute() {} append(...k) { this.children.push(...k); } focus() {}
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    async fire(t) { for (const f of this.listeners[t] || []) await f({preventDefault() {}}); }
    find(tag) { if (this.tagName === tag) return this; for (const c of this.children) { const r = c.find?.(tag); if (r) return r; } return null; }
  }
  const code = `(() => {
    ${zhOf(LOCK)}
    const emitChange = () => {}, formatWait = () => '1 秒';
    ${between(LOCK, 'function buildLockCard(', '  function showPrompt(')}
    return buildLockCard;
  })()`;
  const document = {createElement: (t) => new Node(t)};
  const window = {setInterval: () => 1, clearInterval() {}};
  const build = vm.runInNewContext(code, {document, window, rpc, Date, Number, console: spy.console, globalThis: {console: spy.console}});
  const card = build({initialStatus: {configured: true}, onCancel() {}, onUnlocked() {}});
  const form = card.dialog.find('FORM');
  const error = form.children[1];
  return {form, input: card.input, error, warnings: spy.warnings};
}
for (const [name, failure] of FAILURES) {
  test(`解锁框：网关失败（${name}）时错误行只显示中文`, async () => {
    const e = lockCard(async () => { throw failure; });
    e.input.value = 'pw';
    await e.form.fire('submit');
    assert.match(e.error.textContent, /^[㐀-鿿]/);
    assert.doesNotMatch(e.error.textContent, LEAK);
  });
}
test('解锁框：服务端回的中文错误照原样显示（开发者密码不正确）', async () => {
  const e = lockCard(async () => ({ok: false, code: 'WRONG_PASSWORD', error: '开发者密码不正确。', remainingAttempts: 4}));
  e.input.value = 'pw';
  await e.form.fire('submit');
  assert.match(e.error.textContent, /^开发者密码不正确。/);
});
test('解锁框：打不开时的 toast 走 zh，不再直接用 err?.message', () => {
  assert.doesNotMatch(LOCK, /__laolaoToast\?\.\(err\?\.message/);
  assert.match(LOCK, /__laolaoToast\?\.\(zh\(err, /);
});
