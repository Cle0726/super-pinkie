// 界面计划 T3 #3「会话内查找」（L19，linux2，11-27）：Metre 的 Ctrl+F（Mac ⌘F）查找条（laolao-metre-find.js / .css）。
// 原生 Ctrl/⌘+F 只切一个「过滤消息」的搜索条：没命中的消息整条藏掉，没有高亮、没有上一条 / 下一条，输入框里 Esc 不关。
// 这里用极简假 DOM 在 vm 里跑真文件：
//   1. 只在 Metre：Ctrl+F / ⌘F 唤出查找条并吞掉按键（原生过滤条收不到），输入框拿到焦点；
//   2. 高亮命中（CSS Custom Highlight，当前那条单独一组），命中可以跨粗体拆开的文本节点，<style> 里的字和对话区外的字不算；
//   3. Enter 下一条、Shift+Enter 上一条、到头回绕，按钮也能翻；n/m 计数；
//   4. 没命中写「无匹配」，上一条 / 下一条变灰；
//   5. Esc 关闭、清掉高亮、焦点还给原来的地方；切出 Metre 自动关；回答流进来后按 pinkie:run-view 重算；
//   6. 反例：其他模式、工作台编辑器里、没有对话区的页面、输入法组字中，一个键都不拦，不建任何节点。
// 只回退功能（不挂 keydown / 去掉 Metre 判断）时对应几条会红，见 PR 说明。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const JS = read('../ui/injections/laolao-metre-find.js');
const CSS_TEXT = read('../ui/injections/laolao-metre-find.css');
const HEAD = read('../ui/injections/laolao-head.fragment.html');
const REGIONS = JSON.parse(read('../ui/injections/regions.json'));

// ---------- 极简假 DOM ----------
class Text {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentElement = null; }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : false; }
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class El {
  constructor(tag, cls = '', doc = null) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.className = cls; this.childNodes = []; this.parentElement = null;
    this.attrs = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.hidden = false; this.disabled = false;
    this.value = ''; this.textContent = ''; this.innerHTML = ''; this.doc = doc; this.scrolled = 0;
  }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return Boolean(n.isRoot); }
  append(...kids) {
    for (const k of kids) {
      if (k.parentElement) k.parentElement.childNodes.splice(k.parentElement.childNodes.indexOf(k), 1);
      k.parentElement = this; if (k.nodeType === 1) k.doc = this.doc; this.childNodes.push(k);
    }
  }
  replaceChildren(...kids) { for (const k of this.childNodes) k.parentElement = null; this.childNodes = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  has(c) { return this.className.split(/\s+/).includes(c); }
  matches(sel) {
    return sel.split(',').map((s) => s.trim()).some((s) => {
      const attr = /^\[([\w-]+)\]$/.exec(s);
      if (attr) return attr[1].startsWith('data-') ? this.dataset[camel(attr[1].slice(5))] != null || this.attrs[attr[1]] != null : this.attrs[attr[1]] != null;
      const [tag, ...cls] = s.split('.');
      return (!tag || this.tagName === tag.toUpperCase()) && cls.length > 0 && cls.every((c) => this.has(c));
    });
  }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches?.(sel)) return n; return null; }
  walk(out = []) { for (const c of this.childNodes) if (c.nodeType === 1) { out.push(c); c.walk(out); } return out; }
  focus() { if (this.doc) this.doc.activeElement = this; }
  select() { this.selected = true; }
  scrollIntoView() { this.scrolled += 1; }
  getBoundingClientRect() { return {top: 0, bottom: 10, left: 0, right: 900, width: 900, height: 10}; }
}

class Highlight { constructor(...ranges) { this.ranges = ranges; } get size() { return this.ranges.length; } }

function env({mode = 'metre', withThread = true, highlightApi = true} = {}) {
  const doc = {activeElement: null};
  const body = new El('body', '', doc); body.isRoot = true;
  const el = (tag, cls = '') => new El(tag, cls, doc);
  const html = {getAttribute: (k) => (k === 'data-laolao-mode' ? mode : null)};
  const thread = el('div', 'chat-thread');
  const inner = el('div', 'chat-thread-inner');
  // 用户：一处 React；回答：「选 <strong>Re</strong>act 吧，react 生态大。」两处（第一处跨粗体拆开的节点），外加 <style> 里的 react 不算。
  const userText = el('div', 'chat-text'); userText.append(new Text('React 和 Vue 选哪个？'));
  const answer = el('div', 'chat-text'); const p = el('p'); const strong = el('strong'); strong.append(new Text('Re'));
  const style = el('style'); style.append(new Text('.react{color:red}'));
  p.append(new Text('选 '), strong, new Text('act 吧，react 生态大。')); answer.append(p, style);
  inner.append(userText, answer); thread.append(inner);
  const side = el('div', 'sidebar'); side.append(new Text('React 会话'));   // 对话区外，不算
  const box = el('textarea', 'chat-box');
  const editor = el('div', 'monaco-editor'); const editorInput = el('textarea'); editor.append(editorInput);
  body.append(side, box, editor);
  if (withThread) body.append(thread);

  const listen = {};
  let selected = '';
  const marks = new Map();
  const win = {innerWidth: 1440, Pinkie: {}, addEventListener: (t, f) => { (listen[t] ||= []).push(f); },
    getSelection: () => ({toString: () => selected, removeAllRanges() {}, addRange() {}})};
  Object.assign(doc, {
    documentElement: html, body,
    createElement: (t) => el(t),
    createRange: () => ({setStart(n, o) { this.startContainer = n; this.startOffset = o; }, setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
      getBoundingClientRect: () => ({top: 0, bottom: 10})}),
    querySelector: (s) => (s === '.chat-thread' ? body.walk().find((n) => n.has('chat-thread')) || null : null),
    querySelectorAll: (s) => (s === '.chat-thread .chat-text' ? body.walk().filter((n) => n.has('chat-text') && n.closest('.chat-thread')) : []),
  });
  // 同步的 requestAnimationFrame 回 0（真浏览器是异步的，回调前就拿到了非 0 的 id）。
  const ctx = {window: win, document: doc, requestAnimationFrame: (f) => { f(); return 0; }};
  if (highlightApi) Object.assign(ctx, {CSS: {highlights: marks}, Highlight});
  vm.runInNewContext(JS, ctx);
  const api = win.Pinkie.metreFind;

  // window 捕获阶段先跑；没被 stopPropagation 才轮到目标元素自己的监听（真浏览器同样顺序）。
  const key = (k, extra = {}) => {
    const ev = {key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      isComposing: false, keyCode: 0, target: doc.activeElement || body, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra};
    for (const f of listen.keydown || []) f(ev);
    if (!ev.stopped) for (const f of ev.target?.listeners?.keydown || []) f(ev);
    return ev;
  };
  const bar = () => body.childNodes.find((n) => n.nodeType === 1 && n.has('pk-metre-find')) || null;
  const input = () => bar()?.childNodes.find((n) => n.has('pk-metre-find__input')) || null;
  const label = () => bar()?.childNodes.find((n) => n.has('pk-metre-find__count'))?.textContent ?? null;
  const btn = (act) => bar()?.childNodes.find((n) => n.dataset.find === act) || null;
  const type = (text) => { const i = input(); i.value = text; for (const f of i.listeners.input || []) f({target: i}); };
  const click = (act) => { const b = btn(act); for (const f of bar().listeners.click || []) f({target: b, preventDefault() {}}); };
  const fire = (t) => { for (const f of listen[t] || []) f({detail: {}}); };
  return {api, doc, body, box, editorInput, answer, p, strong, marks, key, bar, input, label, btn, type, click, fire,
    setMode: (m) => { mode = m; }, select: (s) => { selected = s; }};
}

// ---------- 注册与体量 ----------
test('loaded after laolao-metre-allow, owned by the metre region, no observer / interval / window.__ / gateway / !important', () => {
  const at = (name) => HEAD.indexOf(`/${name}?v=@hash`);
  assert.ok(at('laolao-metre-allow.js') > 0);
  assert.ok(at('laolao-metre-find.css') > at('laolao-metre-allow.js'), 'find.css comes after allow.js');
  assert.ok(at('laolao-metre-find.js') > at('laolao-metre-find.css'), 'find.js comes after find.css');
  assert.ok(HEAD.includes('<script defer src="/laolao-metre-find.js?v=@hash"></script>'));
  assert.ok(HEAD.includes('<link rel="stylesheet" href="/laolao-metre-find.css?v=@hash">'));
  const metre = REGIONS.regions.find((r) => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-find.js') && metre.files.includes('laolao-metre-find.css'));
  assert.doesNotMatch(JS, /new MutationObserver|setInterval\(|window\.__\w+\s*=|globalThis\./);
  assert.doesNotMatch(JS, /gwRequest|fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(CSS_TEXT, /!\s*important/);
  assert.ok(JS.split('\n').length <= 1500 && CSS_TEXT.split('\n').length <= 1500);
});

test('every CSS rule is scoped to html[data-laolao-mode="metre"] (other modes get nothing from this file)', () => {
  const bare = CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...bare.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
  assert.ok(selectors.length >= 10, 'found the rules');
  for (const s of selectors) assert.ok(s.startsWith('html[data-laolao-mode="metre"]'), s);
});

test('positions(): case-insensitive, non-overlapping, blank query finds nothing', () => {
  const {api} = env();
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(api.positions('React react REACT', 'react')), [[0, 5], [6, 11], [12, 17]]);
  assert.deepEqual(plain(api.positions('aaaa', 'aa')), [[0, 2], [2, 4]]);
  assert.deepEqual(plain(api.positions('中文里找中文', '中文')), [[0, 2], [4, 6]]);
  for (const q of ['', '   ', null, undefined]) assert.deepEqual(plain(api.positions('abc', q)), [], String(q));
});

// ---------- Metre：唤出、高亮、上一条 / 下一条、无命中、Esc ----------
test('Metre: Ctrl+F opens the find bar (native filter bar never sees the key), highlights hits, Enter / Shift+Enter cycle with wrap', () => {
  const t = env();
  t.box.focus();
  const ev = t.key('f', {ctrlKey: true});
  assert.equal(ev.defaultPrevented, true, 'browser find is suppressed');
  assert.equal(ev.stopped, true, 'native section.card.chat filter toggle never receives the key');
  assert.ok(t.bar() && t.bar().hidden === false, 'find bar shown');
  assert.equal(t.doc.activeElement, t.input(), 'focus moves to the find input');
  assert.equal(t.bar().getAttribute('role'), 'search');
  assert.equal(t.label(), '', 'no count before typing');

  t.type('REACT');
  assert.equal(t.api.state().total, 3, 'user message 1 + answer 2 (one across a <strong> split); <style> text and the sidebar do not count');
  assert.equal(t.label(), '1/3');
  assert.equal(t.marks.get(t.api.HL).size, 2, 'other hits share one highlight');
  assert.equal(t.marks.get(t.api.HL_CUR).size, 1, 'the current hit has its own highlight');
  assert.equal(t.marks.get(t.api.HL_CUR).ranges[0].startContainer.data, 'React 和 Vue 选哪个？');

  t.key('Enter', {target: t.input()});
  assert.equal(t.label(), '2/3');
  const cross = t.marks.get(t.api.HL_CUR).ranges[0];
  assert.deepEqual([cross.startContainer.data, cross.startOffset, cross.endContainer.data, cross.endOffset], ['Re', 0, 'act 吧，react 生态大。', 3], 'hit spans the bold split');
  assert.ok(t.strong.scrolled > 0, 'current hit is scrolled into view');
  t.key('Enter', {target: t.input()});
  assert.equal(t.label(), '3/3');
  t.key('Enter', {target: t.input()});
  assert.equal(t.label(), '1/3', 'wraps forward');
  t.key('Enter', {target: t.input(), shiftKey: true});
  assert.equal(t.label(), '3/3', 'Shift+Enter wraps backward');
  t.click('prev');
  assert.equal(t.label(), '2/3', 'previous button');
  t.click('next');
  assert.equal(t.label(), '3/3', 'next button');

  const again = t.key('f', {ctrlKey: true, target: t.input()});
  assert.equal(again.defaultPrevented, true);
  assert.equal(t.input().selected, true, 'pressing it again selects the query');
  assert.equal(t.api.state().total, 3, 'still open with the same hits');
});

test('Metre: no hits says 无匹配, disables prev / next and clears every highlight', () => {
  const t = env();
  t.key('f', {ctrlKey: true});
  t.type('react');
  assert.equal(t.label(), '1/3');
  t.type('不存在的词');
  assert.equal(t.label(), '无匹配');
  assert.equal(t.bar().dataset.state, 'none');
  assert.equal(t.btn('prev').disabled, true);
  assert.equal(t.btn('next').disabled, true);
  assert.equal(t.input().getAttribute('aria-invalid'), 'true');
  assert.equal(t.marks.size, 0, 'no stale highlight left behind');
  t.key('Enter', {target: t.input()});
  assert.equal(t.label(), '无匹配', 'Enter with no hits does nothing');
  t.type('');
  assert.equal(t.label(), '', 'empty query shows no count');
  assert.equal(t.input().getAttribute('aria-invalid'), 'false');
});

test('Metre: Esc in the bar closes it, clears highlights and gives focus back; the close button does the same', () => {
  const t = env();
  t.box.focus();
  t.key('f', {ctrlKey: true});
  t.type('react');
  const esc = t.key('Escape', {target: t.input()});
  assert.equal(esc.defaultPrevented, true);
  assert.equal(esc.stopped, true, 'Esc does not also reach laolao-sidebar / workspace handlers');
  assert.equal(t.bar().hidden, true);
  assert.equal(t.marks.size, 0);
  assert.equal(t.doc.activeElement, t.box, 'focus is back in the composer');
  assert.equal(t.api.state().open, false);

  t.key('f', {ctrlKey: true, target: t.box});
  assert.equal(t.input().value, 'react', 'reopening keeps the last query');
  assert.equal(t.api.state().total, 3);
  t.click('close');
  assert.equal(t.bar().hidden, true);
  assert.equal(t.marks.size, 0);

  const outside = t.key('Escape', {target: t.box});
  assert.equal(outside.defaultPrevented, false, 'Esc outside the bar is left alone (stop button, double-Esc clear keep working)');
  assert.equal(outside.stopped, false);
});

test('Metre: ⌘F works too; text selected before opening becomes the query', () => {
  const t = env();
  t.select('Vue');
  const ev = t.key('f', {metaKey: true});
  assert.equal(ev.defaultPrevented, true);
  assert.equal(t.input().value, 'Vue');
  assert.equal(t.label(), '1/1');
});

test('Metre: hits follow the re-rendered thread (stale ranges, pinkie:run-view), and leaving Metre closes the bar', () => {
  const t = env();
  t.key('f', {ctrlKey: true});
  t.type('react');
  assert.equal(t.label(), '1/3');
  t.answer.replaceChildren(new Text('react 又回来了 React'));
  t.key('Enter', {target: t.input()});   // 旧范围的节点已经不在页面上：先重算再翻
  assert.equal(t.api.state().total, 3);
  assert.equal(t.label(), '2/3');
  t.answer.replaceChildren(new Text('换了一条回答，没有那个词。'));
  t.fire('pinkie:run-view');
  assert.equal(t.label(), '1/1', 'only the user message still matches');
  t.setMode('project');
  t.fire('laolao:modechange');
  assert.equal(t.bar().hidden, true, 'closed when leaving Metre');
  assert.equal(t.marks.size, 0);
});

test('Metre without the Highlight API: still counts and navigates', () => {
  const t = env({highlightApi: false});
  t.key('f', {ctrlKey: true});
  t.type('react');
  assert.equal(t.label(), '1/3');
  t.key('Enter', {target: t.input()});
  assert.equal(t.label(), '2/3');
});

// ---------- 反例：别的地方一个键都不拦 ----------
test('other modes: Ctrl+F / ⌘F pass straight through to the native filter bar, nothing is built', () => {
  for (const mode of ['main', 'project', 'thinking', 'learning', 'unrestricted', null]) {
    const t = env({mode});
    t.box.focus();
    for (const mod of [{ctrlKey: true}, {metaKey: true}]) {
      const ev = t.key('f', mod);
      assert.equal(ev.defaultPrevented, false, `${mode}: key not prevented`);
      assert.equal(ev.stopped, false, `${mode}: key not stopped`);
    }
    assert.equal(t.api.open(), false, `${mode}: open() refuses`);
    assert.equal(t.bar(), null, `${mode}: no node created`);
    assert.equal(t.marks.size, 0, `${mode}: no highlight`);
    assert.equal(t.doc.activeElement, t.box, `${mode}: focus untouched`);
  }
});

test('Metre: not taken inside the workbench editor, on pages without a chat thread, while composing (IME), or with Shift / Alt', () => {
  const t = env();
  t.editorInput.focus();
  assert.equal(t.key('f', {ctrlKey: true}).defaultPrevented, false, 'Monaco keeps its own find');
  assert.equal(t.bar(), null);
  t.box.focus();
  assert.equal(t.key('f', {ctrlKey: true, isComposing: true}).defaultPrevented, false, 'IME composing');
  assert.equal(t.key('f', {ctrlKey: true, keyCode: 229}).defaultPrevented, false, 'IME keyCode 229');
  assert.equal(t.key('f', {ctrlKey: true, shiftKey: true}).defaultPrevented, false, 'Ctrl+Shift+F is not ours');
  assert.equal(t.key('f', {ctrlKey: true, altKey: true}).defaultPrevented, false, 'Ctrl+Alt+F is not ours');
  assert.equal(t.key('f').defaultPrevented, false, 'plain f');
  assert.equal(t.bar(), null);

  const bare = env({withThread: false});
  assert.equal(bare.key('f', {ctrlKey: true}).defaultPrevented, false, 'no chat thread: leave it to the browser');
  assert.equal(bare.bar(), null);
});
