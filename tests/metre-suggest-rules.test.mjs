// I8 下一句建议的本地规则。主路径（什么时候出、点了只填不发）在 tests/metre-suggest.test.mjs。
// 这里只补规则边界：600 字、16 字「还是」、截断、编号压过「还是」、代码块、去重，以及正文从哪一段取。
// 不启动浏览器，直接调用 laolao-metre-suggest.js 交出来的 pick()。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-suggest.js'), 'utf8');

class El {
  constructor(tag, cls = '') { this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.remove(); k.parent = this; this.children.push(k); } }
  before(n) { n.remove(); const p = this.parent, i = p.children.indexOf(this); n.parent = p; p.children.splice(i, 0, n); }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get nextElementSibling() { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get parentElement() { return this.parent; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  has(c) { return this.className.split(/\s+/).includes(c); }
  matches(sel) { const last = sel.trim().split(/\s+/).pop(); const cls = last.split('.').slice(1); const tag = last.split('.')[0]; return (!tag || this.tagName === tag.toUpperCase()) && cls.every((c) => this.has(c)); }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches?.(sel)) return n; return null; }
  all(sel, out = []) { for (const c of this.children) { if (c.matches(sel)) out.push(c); c.all(sel, out); } return out; }
  querySelector(sel) { return this.all(sel)[0] || null; }
  focus() { this.focused = true; }
}

function env({mode = 'metre', getItem} = {}) {
  const win = {}, doc = {}, listen = {wnd: {}, doc: {}};
  const html = {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)};
  const paneEl = new El('openclaw-chat-pane');
  const comp = new El('div', 'agent-chat__composer-combobox'), ta = new El('textarea'); ta.value = ''; ta.setSelectionRange = () => {};
  const shell = new El('div', 'agent-chat__composer-shell'); comp.append(ta); shell.append(comp); paneEl.append(shell);
  paneEl.state = {sessionKey: 's1', chatMessage: '', chatMessages: [], chatRunId: null, chatSending: false, chatStream: null, requestUpdate() {}};
  Object.assign(doc, {documentElement: html, querySelector: (s) => (s === 'openclaw-chat-pane' ? paneEl : null), createElement: (t) => new El(t),
    addEventListener: (t, f) => { (listen.doc[t] ||= []).push(f); }});
  const storage = {getItem: getItem || (() => null), setItem() {}, removeItem() {}};
  Object.assign(win, {Pinkie: {}, localStorage: storage, addEventListener: (t, f) => { (listen.wnd[t] ||= []).push(f); }});
  vm.runInNewContext(SRC, {window: win, document: doc, requestAnimationFrame: (f) => f()});
  const fire = (t) => { for (const f of listen.wnd[t] || []) f({detail: {}}); };
  const row = () => paneEl.querySelector('.pk-metre-suggest');
  const chips = () => (row() ? row().children.map((c) => c.textContent) : null);
  const answer = (message) => {
    Object.assign(paneEl.state, {chatRunId: 'r1', chatStream: '…'}); fire('pinkie:run-view');
    paneEl.state.chatMessages = [{role: 'user', content: '问'}, message];
    Object.assign(paneEl.state, {chatRunId: null, chatStream: null}); fire('pinkie:run-view');
  };
  return {win, chips, answer, pick: (t) => JSON.parse(JSON.stringify(win.Pinkie.metreSuggest.pick(t)))};
}

const world = env();
const pick = world.pick;

test('问句：编号压过「还是」；左右刚好 16 字能拆，右边再长或英文 or 不拆', () => {
  assert.deepEqual(pick('用 React 还是 Vue？'), ['React', 'Vue']);
  assert.deepEqual(pick('用React还是Vue？'), ['用React', 'Vue']);
  assert.deepEqual(pick('React Vue 还是 Svelte？'), ['Vue', 'Svelte'], '空格左边只取紧挨着「还是」的那一个词');
  assert.deepEqual(pick('甲'.repeat(16) + '还是' + '乙'.repeat(16) + '？'), ['甲'.repeat(16), '乙'.repeat(16)]);
  assert.deepEqual(pick('甲'.repeat(17) + '还是乙？'), ['甲'.repeat(16), '乙'], '左边没有行首锚点，更长时只收紧挨着「还是」的 16 字');
  assert.deepEqual(pick('甲还是' + '乙'.repeat(17) + '？'), ['继续', '换个说法'], '右边超过 16 字，问号对不上行尾，整句不拆');
  assert.deepEqual(pick('还是乙？'), ['继续', '换个说法']);
  assert.deepEqual(pick('甲还是？'), ['继续', '换个说法']);
  assert.deepEqual(pick('用 React 还是 Vue？先别答'), ['继续', '换个说法'], '问号不在末尾就不算在问');
  assert.deepEqual(pick('React or Vue?'), ['继续', '换个说法']);
  assert.deepEqual(pick('用 React 还是 Vue？\n1. 保持现状\n2. 重写？'), ['选 1：保持现状', '选 2：重写？'], '有编号时不再拆「还是」');
  assert.deepEqual(pick('1、甲\n2)乙\n3）丙\n1.丁\n哪个？'), ['选 1：甲', '选 2：乙', '选 3：丙'], '四种编号都认，第四条丢掉');
  assert.deepEqual(pick('1.只是列表\n2.不是问句'), ['继续', '换个说法']);
  assert.deepEqual(pick('1. *深色*  主题\n2. 浅色\n要哪个？'), ['选 1：深色 主题', '选 2：浅色']);
});

test('截断按字不算 UTF-16，quick_replies 只取第一处，去重后再补到两条', () => {
  assert.deepEqual(pick(`[[quick_replies: ${'答'.repeat(41)}, 好, 行]]`), ['答'.repeat(40) + '…', '好', '行']);
  assert.deepEqual(pick(`[[quick_replies: ${'😀'.repeat(41)}, 好]]`), ['😀'.repeat(40) + '…', '好'], '表情算一个字，不能从中间切开');
  assert.deepEqual(pick('1. ' + '项'.repeat(25) + '\n2. 乙\n选哪个？'), ['选 1：' + '项'.repeat(24) + '…', '选 2：乙']);
  assert.deepEqual(pick('[[QUICK_REPLIES: Yes, No]] 以及 [[quick_replies: 三, 四]]'), ['Yes', 'No'], '大小写不限，第二处 quick_replies 不再读');
  assert.deepEqual(pick('[[quick_replies: , ，是, ]]'), ['是', '继续']);
  assert.deepEqual(pick('[[quick_replies: 继续, *继续*, 换个说法]]'), ['继续', '换个说法'], '去掉记号以后相同的只留一条');
  assert.deepEqual(pick('[[quick_replies: 一, 二, 三, 四]]'), ['一', '二', '三']);
  assert.deepEqual(pick('[[quick_replies: 就这]]\n```js\n1\n```'), ['就这', '解释一下这段代码', '给它写个测试']);
});

test('600 字才总结；闭合代码块里的问句不算选项，没闭合的仍算', () => {
  assert.deepEqual(pick('长'.repeat(600)), ['继续', '换个说法'], '刚好 600 字不总结');
  assert.deepEqual(pick('长'.repeat(601)), ['总结成三点', '继续']);
  assert.deepEqual(pick('```js\nx\n```\n' + '长'.repeat(601)), ['解释一下这段代码', '给它写个测试', '总结成三点']);
  assert.deepEqual(pick('看\n```\n用 A 还是 B？\n1. 甲\n```\n以上'), ['解释一下这段代码', '给它写个测试'], '闭合代码块里的问句和编号都不拆');
  assert.deepEqual(pick('```\n1. 甲\n2. 乙\n选？'), ['选 1：甲', '选 2：乙', '解释一下这段代码'], '没闭合的代码块挡不住编号，同时仍给出代码建议');
  assert.deepEqual(pick(null), ['继续', '换个说法']);
  assert.deepEqual(pick(undefined), ['继续', '换个说法']);
});

test('规则吃的是回答正文：字符串、文本块、text 字段；图片块不退回 text', () => {
  const show = (message) => { const e = env(); e.answer(message); return e.chips(); };
  assert.deepEqual(show({role: 'assistant', content: '用 React 还是 Vue？', text: '继续'}), ['React', 'Vue']);
  assert.deepEqual(show({role: 'assistant', text: '用 React 还是 Vue？'}), ['React', 'Vue']);
  assert.deepEqual(show({role: 'assistant', content: null, text: '用 React 还是 Vue？'}), ['React', 'Vue']);
  assert.deepEqual(show({role: 'assistant', content: [{type: 'text', text: '看代码'}, {type: 'text', text: '用 React 还是 Vue？'}]}), ['React', 'Vue']);
  assert.deepEqual(show({role: 'assistant', content: [{type: 'image', text: '用 React 还是 Vue？'}], text: '用 React 还是 Vue？'}), ['继续', '换个说法'], '只有图片时不用旁边的 text 字段');
  assert.deepEqual(show({role: 'assistant', content: [{type: 'text', text: '用 React 还是 Vue？'}, {type: 'text', text: '补充'}]}), ['继续', '换个说法'], '问号不在拼完的正文末尾，就不拆');

  const thrown = env({getItem() { throw new Error('blocked'); }});
  thrown.answer({role: 'assistant', content: '用 React 还是 Vue？'});
  assert.deepEqual(thrown.chips(), ['React', 'Vue'], '存储抛错就当作开着');
  const gone = env();
  gone.win.localStorage = undefined;
  gone.answer({role: 'assistant', content: '好的。'});
  assert.deepEqual(gone.chips(), ['继续', '换个说法'], '没有 localStorage 也当作开着');
});
