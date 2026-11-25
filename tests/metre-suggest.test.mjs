// 「以后」S 级 I8（m5，11-25）：Metre 的「下一句建议」。设计和调研：build/quick-run/设计-I8.md。
// 原生没有回答后的建议（欢迎页四条点了直接发送；内核 [[quick_replies:]] 只给 LINE），所以壳里按本地规则拼 2–3 条。
// 这里用极简假 DOM 跑 laolao-metre-suggest.js：规则、什么时候出 / 收、点了只填不发、设置里能关、只在 Metre。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-suggest.js'), 'utf8');
const KEY = 'pinkie.metre.prefs.nextSuggest';
const plain = (o) => JSON.parse(JSON.stringify(o));

class El {
  constructor(tag, cls = '') { this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.remove(); k.parent = this; this.children.push(k); } }
  before(n) { n.remove(); const p = this.parent, i = p.children.indexOf(this); n.parent = p; p.children.splice(i, 0, n); }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get nextElementSibling() { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  has(c) { return this.className.split(/\s+/).includes(c); }
  matches(sel) { const last = sel.trim().split(/\s+/).pop(); const cls = last.split('.').slice(1); const tag = last.split('.')[0]; return (!tag || this.tagName === tag.toUpperCase()) && cls.every((c) => this.has(c)); }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches?.(sel)) return n; return null; }
  all(sel, out = []) { for (const c of this.children) { if (c.matches(sel)) out.push(c); c.all(sel, out); } return out; }
  querySelector(sel) { return this.all(sel)[0] || null; }
  focus() { this.focused = true; }
}

function env({mode = 'metre', stored = {}, draftApi = true} = {}) {
  const store = new Map(Object.entries(stored));
  const win = {}, doc = {}, listen = {wnd: {}, doc: {}};
  const html = {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)};
  const paneEl = new El('openclaw-chat-pane');
  const comp = new El('div', 'agent-chat__composer-combobox'), ta = new El('textarea'); ta.value = ''; ta.setSelectionRange = () => {};
  const shell = new El('div', 'agent-chat__composer-shell'); comp.append(ta); shell.append(comp); paneEl.append(shell);
  const sent = [], drafts = [];
  paneEl.state = {sessionKey: 's1', chatMessage: '', chatMessages: [], chatRunId: null, chatSending: false, chatStream: null,
    handleSendChat() { sent.push(this.chatMessage); }, requestUpdate() {}};
  if (draftApi) paneEl.state.handleChatDraftChange = function (t) { drafts.push(t); this.chatMessage = t; ta.value = t; };
  Object.assign(doc, {documentElement: html, querySelector: (s) => (s === 'openclaw-chat-pane' ? paneEl : null), createElement: (t) => new El(t),
    addEventListener: (t, f) => { (listen.doc[t] ||= []).push(f); }});
  Object.assign(win, {Pinkie: {}, localStorage: {getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k)},
    addEventListener: (t, f) => { (listen.wnd[t] ||= []).push(f); }});
  vm.runInNewContext(SRC, {window: win, document: doc, requestAnimationFrame: (f) => f()});
  const fire = (t) => { for (const f of listen.wnd[t] || []) f({detail: {}}); };
  const row = () => paneEl.querySelector('.pk-metre-suggest');
  const chips = () => (row() ? row().children.map((c) => c.textContent) : []);
  const reply = (text) => {   // 一轮：忙 → 闲，最后一条是这条回答
    Object.assign(paneEl.state, {chatRunId: 'r1', chatStream: '…'}); fire('pinkie:run-view');
    paneEl.state.chatMessages = [...paneEl.state.chatMessages, {role: 'user', content: [{type: 'text', text: '问'}]}, {role: 'assistant', content: [{type: 'text', text}]}];
    Object.assign(paneEl.state, {chatRunId: null, chatStream: null}); fire('pinkie:run-view');
  };
  const click = (i) => { const b = row().children[i]; for (const f of row().listeners.click) f({target: b, preventDefault() {}}); };
  return {win, paneEl, shell, ta, sent, drafts, store, fire, row, chips, reply, click, listen, setMode: (m) => { mode = m; }};
}

test('规则：quick_replies 优先、问句编号选项、A 还是 B、代码块、长回答、兜底，2–3 条、去重', () => {
  const {win} = env(), pick = (t) => plain(win.Pinkie.metreSuggest.pick(t));
  assert.deepEqual(pick('好的，改完了。'), ['继续', '换个说法']);
  assert.deepEqual(pick('选一个 [[quick_replies: 是, 否，再想想, 是]]'), ['是', '否', '再想想']);
  assert.deepEqual(pick('你想要哪种？\n1. 深色主题\n2. 浅色主题\n3. 跟随系统\n4. 其他\n要哪个？'), ['选 1：深色主题', '选 2：浅色主题', '选 3：跟随系统']);
  assert.deepEqual(pick('用 React 还是 Vue？'), ['React', 'Vue']);
  assert.deepEqual(pick('写好了：\n```js\nconst a = 1\n```'), ['解释一下这段代码', '给它写个测试']);
  assert.deepEqual(pick('长'.repeat(700)), ['总结成三点', '继续']);
  assert.deepEqual(pick('1. 只是列表\n2. 不是问句'), ['继续', '换个说法'], '不是问句结尾的编号列表不拆成选项');
  for (const t of ['', '?', '```\nx?\n```', '[[quick_replies: ]]']) { const out = pick(t); assert.ok(out.length >= 2 && out.length <= 3, t + ' → ' + out); }
});

test('一轮回答结束出建议，放在输入框外壳前面；有 role=group 和名字', () => {
  const e = env();
  e.fire('pinkie:run-view'); assert.equal(e.row(), null, '没跑过一轮不出');
  e.reply('用 React 还是 Vue？');
  assert.deepEqual(e.chips(), ['React', 'Vue']);
  assert.equal(e.row().nextElementSibling, e.shell);
  assert.equal(e.row().getAttribute('role'), 'group');
  assert.equal(e.row().getAttribute('aria-label'), '下一句建议');
  e.fire('pinkie:run-view'); assert.deepEqual(e.chips(), ['React', 'Vue'], '之后的 run-view 不会把它收掉');
});

test('点一条只填进输入框、聚焦，不发送；建议收起', () => {
  for (const draftApi of [true, false]) {
    const e = env({draftApi});
    e.reply('用 React 还是 Vue？');
    e.click(1);
    assert.equal(e.paneEl.state.chatMessage, 'Vue');
    assert.deepEqual(e.sent, [], '不能发送');
    if (draftApi) { assert.deepEqual(e.drafts, ['Vue']); assert.ok(e.ta.focused); }
    assert.equal(e.row(), null);
  }
});

test('收起：开始新一轮、输入框有字、打字、换会话、切出 Metre；最后一条不是回答不出', () => {
  const e = env();
  e.reply('好的。'); assert.ok(e.row());
  Object.assign(e.paneEl.state, {chatSending: true}); e.fire('pinkie:run-view'); assert.equal(e.row(), null, '新一轮开始就收');
  Object.assign(e.paneEl.state, {chatSending: false, chatMessage: '我自己打的'}); e.fire('pinkie:run-view'); assert.equal(e.row(), null, '输入框有字不出');
  e.paneEl.state.chatMessage = '';
  e.reply('好的。'); assert.ok(e.row());
  e.ta.value = 'x'; for (const f of e.listen.doc.input) f({target: e.ta}); assert.equal(e.row(), null, '打字就收');
  e.ta.value = '';
  e.reply('好的。'); assert.ok(e.row());
  e.paneEl.state.sessionKey = 's2'; e.fire('pinkie:session-selected'); assert.equal(e.row(), null, '换会话就收');
  e.reply('好的。'); assert.ok(e.row());
  e.setMode('baton'); e.fire('laolao:modechange'); assert.equal(e.row(), null, '切出 Metre 就收');
  e.setMode('metre');
  Object.assign(e.paneEl.state, {chatRunId: 'r2'}); e.fire('pinkie:run-view');
  e.paneEl.state.chatMessages.push({role: 'user', content: [{type: 'text', text: '只有我的一句'}]});
  Object.assign(e.paneEl.state, {chatRunId: null}); e.fire('pinkie:run-view');
  assert.equal(e.row(), null, '最后一条不是 assistant 不出');
});

test('设置里关掉（off）不出；不在 Metre 不出；开着时关掉马上收', () => {
  const off = env({stored: {[KEY]: 'off'}}); off.reply('好的。'); assert.equal(off.row(), null);
  const other = env({mode: 'baton'}); other.reply('好的。'); assert.equal(other.row(), null);
  const on = env(); on.reply('好的。'); assert.ok(on.row()); on.store.set(KEY, 'off'); on.win.Pinkie.metreSuggest.check(); assert.equal(on.row(), null);
});

test('不新增定时器、观察器和 window.__ 全局名', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // 注释里写着「不加 window.__」，只看代码
  assert.doesNotMatch(code, /setInterval|setTimeout|MutationObserver|ResizeObserver|window\.__/);
});
