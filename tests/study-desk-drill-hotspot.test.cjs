'use strict';
// 热点第 29 名 ui/injections/laolao-study-desk-drill.js：修复类提交的复发测试。
// 不起浏览器：用 vm 加一个最小 DOM 直接跑注入脚本。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-study-desk-drill.js'), 'utf8');

class FakeClassList {
  constructor(node) { this.node = node; }
  get list() { return String(this.node.className || '').split(/\s+/).filter(Boolean); }
  write(list) { this.node.className = [...new Set(list)].join(' '); }
  add(...names) { this.write([...this.list, ...names]); }
  remove(...names) { this.write(this.list.filter(n => !names.includes(n))); }
  contains(name) { return this.list.includes(name); }
  toggle(name, force) { const on = force === undefined ? !this.contains(name) : Boolean(force); if (on) this.add(name); else this.remove(name); return on; }
}
function fakeStyle() {
  const s = {cssText: '', setProperty(k, v) { s[k] = String(v ?? ''); }, getPropertyValue(k) { return s[k] || ''; }};
  return s;
}
function compound(node, part) {
  if (node.nodeType !== 1) return false;
  const m = /^([a-z][\w-]*)?((?:\.[-\w]+)*)((?:\[[\w-]+(?:=[^\]]+)?\])*)$/i.exec(part);
  if (!m) throw new Error(`fake DOM: unsupported selector ${part}`);
  if (m[1] && node.localName !== m[1].toLowerCase()) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  for (const raw of m[3].match(/\[[\w-]+(?:=[^\]]+)?\]/g) || []) {
    const am = /^\[([\w-]+)(?:=([^\]]+))?\]$/.exec(raw);
    if (!node.hasAttribute(am[1])) return false;
    if (am[2] != null && node.getAttribute(am[1]) !== am[2].replace(/^["']|["']$/g, '')) return false;
  }
  return true;
}
function matches(node, selector) {
  return selector.split(',').some(sel => {
    const parts = sel.trim().split(/\s+/);
    if (!compound(node, parts[parts.length - 1])) return false;
    let i = parts.length - 2, n = node.parentNode;
    while (i >= 0 && n) { if (compound(n, parts[i])) i--; n = n.parentNode; }
    return i < 0;
  });
}

function appendParsed(parent, html) {
  const re = /<([a-zA-Z][\w:-]*)([^>]*)\/>|<([a-zA-Z][\w:-]*)([^>]*)>([\s\S]*?)<\/\3>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[6] != null) {
      if (m[6].trim()) parent.append(parent.ownerDocument.createTextNode(m[6]));
      continue;
    }
    const tag = (m[1] || m[3]).toLowerCase();
    const attrs = m[2] || m[4] || '';
    const inner = m[1] ? '' : (m[5] || '');
    const node = parent.ownerDocument.createElement(tag);
    for (const am of attrs.matchAll(/([:\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(am[1], am[2] == null ? '' : am[2]);
    if (inner) appendParsed(node, inner);
    parent.append(node);
  }
}

class FakeNode {
  constructor(doc, tag, text) {
    this.ownerDocument = doc;
    this.localName = tag;
    this.tagName = tag.toUpperCase();
    this.nodeType = tag === '#text' ? 3 : 1;
    this.parentNode = null;
    this.children = [];
    this.className = '';
    this.attrs = new Map();
    this.dataset = {};
    this.listeners = [];
    this.own = text == null ? '' : String(text);
    this.style = fakeStyle();
    this.classList = new FakeClassList(this);
    this.disabled = false;
    this.hidden = false;
    this.returnValue = '';
    this.html = '';
    this.offsetWidth = 1;
    this.offsetHeight = 1;
    this.scrollHeight = 1;
    this.clientHeight = 1;
    this.scrollTop = 0;
  }
  get firstElementChild() { return this.children.find(c => c.nodeType === 1) || null; }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.ownerDocument.documentElement;
  }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.own = v == null ? '' : String(v);
    this.html = '';
  }
  get innerHTML() { return this.html || this.children.map(c => c.outerHTML || c.textContent).join(''); }
  set innerHTML(v) {
    this.textContent = '';
    this.html = String(v);
    appendParsed(this, String(v));
  }
  get outerHTML() { return `<${this.localName} class="${this.className}">${this.innerHTML || this.textContent}</${this.localName}>`; }
  append(...nodes) {
    for (let n of nodes) {
      if (typeof n === 'string') n = this.ownerDocument.createTextNode(n);
      n.remove();
      n.parentNode = this;
      this.children.push(n);
    }
  }
  prepend(...nodes) {
    const ready = [];
    for (let n of nodes) {
      if (typeof n === 'string') n = this.ownerDocument.createTextNode(n);
      n.remove();
      n.parentNode = this;
      ready.push(n);
    }
    this.children.unshift(...ready);
  }
  before(n) {
    const p = this.parentNode;
    n.remove();
    p.children.splice(p.children.indexOf(this), 0, n);
    n.parentNode = p;
  }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  querySelectorAll(selector) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (matches(c, selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let n = this; n; n = n.parentNode) if (n.nodeType === 1 && matches(n, selector)) return n; return null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(type, fn, opts) { this.listeners.push({type, fn, once: Boolean(opts && opts.once), passive: Boolean(opts && opts.passive)}); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    for (const l of [...this.listeners]) {
      if (l.type !== ev.type) continue;
      if (l.once) this.listeners.splice(this.listeners.indexOf(l), 1);
      l.fn.call(this, ev);
    }
    return true;
  }
  click() { if (this.disabled) return; this.dispatchEvent({type: 'click', target: this, preventDefault() {}}); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.setAttribute('open', ''); }
  close(v) { if (v !== undefined) this.returnValue = v; this.removeAttribute('open'); this.dispatchEvent({type: 'close', target: this}); }
}
class FakeDocument {
  constructor() {
    this.documentElement = new FakeNode(this, 'html');
    this.body = new FakeNode(this, 'body');
    this.documentElement.append(this.body);
    this.activeElement = this.body;
  }
  createElement(tag) { return new FakeNode(this, String(tag).toLowerCase()); }
  createTextNode(text) { return new FakeNode(this, '#text', text); }
}

function fakeReward() {
  const r = {
    lastSummary: null,
    lines: {
      exit: (n) => `还有 ${n} 题。先放着进度还在。`,
      pending: (n) => `还有 ${n} 张在拆`,
      failed: '这次成绩没记下',
    },
    sticker() {},
    sound() {},
    paintProgress() {},
    comboBadge() {},
    stop() {},
    feedbackSheet(host, opts) {
      const doc = host.ownerDocument;
      const sheet = doc.createElement('div'); sheet.className = 'pk-sheet';
      const copy = doc.createElement('div'); copy.className = 'pk-sheet-copy';
      const title = doc.createElement('b'); title.textContent = opts.title || '';
      copy.append(title);
      const btn = doc.createElement('button'); btn.className = 'pk-btn'; btn.textContent = '继续';
      btn.addEventListener('click', () => opts.onContinue?.());
      sheet.append(copy, btn); host.append(sheet);
      return {sheet};
    },
    completeScreen(root, summary, hooks) {
      r.lastSummary = summary;
      const doc = root.ownerDocument;
      const done = doc.createElement('div'); done.className = 'pk-done';
      if (summary.jar) {
        const jar = doc.createElement('p'); jar.className = 'pk-done-jar';
        jar.textContent = `${summary.jar.today}/${summary.jar.goal}${summary.jar.unit ? ' ' + summary.jar.unit : ''}`;
        done.append(jar);
      }
      if (summary.failed) {
        const fail = doc.createElement('p'); fail.className = 'pk-done-failed';
        fail.textContent = `本地 ${summary.stars} 星`;
        done.append(fail);
      }
      const back = doc.createElement('button');
      back.type = 'button';
      back.className = 'pk-btn pk-done-back';
      back.textContent = summary.backLabel || '返回';
      back.addEventListener('click', () => hooks.onBack());
      done.append(back);
      root.querySelectorAll('.pk-done').forEach(n => n.remove());
      root.append(done);
    },
  };
  return r;
}

function load({source = SOURCE} = {}) {
  const doc = new FakeDocument();
  const desk = {
    views: {},
    went: [],
    backName(v) { return ({today: '回营地', gamemap: '回地图', gamehunt: '回讨伐', gameexam: '回考场', vocab: '回生词本', notes: '回笔记本', stage: '回舞台'}[v] || '返回'); },
    registerView(id, spec) { desk.views[id] = spec; },
    go(v) { desk.went.push(v); },
    pane: () => ({state: {}}),
  };
  const reward = fakeReward();
  const timers = [];
  const ctx = {
    document: doc,
    console,
    Math, Number, String, Boolean, Date, Array, Object, JSON, Promise, Error, TypeError, Map, Set,
    parseInt, parseFloat, isFinite, isNaN, NaN, Infinity, undefined, structuredClone,
    performance: {now: () => 1000},
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: fn => fn(0),
    addEventListener() {},
    ResizeObserver: class { constructor() {} observe() {} },
    speechSynthesis: {cancel() {}, getVoices() { return []; }, speak() {}},
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    __pinkieStudyDesk: desk,
    __pinkieDeskReward: reward,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, {filename: 'laolao-study-desk-drill.js'});
  return {ctx, doc, desk, reward, flushTimers() { while (timers.length) timers.shift()(); }};
}

const CHOICE = {
  itemId: 'q1',
  mode: 'choice',
  prompt: 'impact ___ business',
  options: ['in', 'on', 'at', 'of'],
  answer: 1,
  reveal: {question: 'impact ___ business', answer: 'on', extra: '介词用 on'},
};
const settle = async () => { for (let k = 0; k < 10; k++) await new Promise(r => setImmediate(r)); };
const byText = (root, selector, text) => root.querySelectorAll(selector).find(n => n.textContent === text) || null;

function mountDrill(h, route, {session, onRequest} = {}) {
  const root = h.doc.createElement('section');
  h.doc.body.append(root);
  const local = {drillRoute: {...route}, returnView: route.returnView};
  const went = [];
  const calls = [];
  const ctx = {
    local: () => local,
    go: (v) => { went.push(v); },
    motion: {reduced: true},
    desk: {isFocused: () => true},
    request: async (method, params, timeout) => {
      const name = String(method).replace(/^pinkie\.learning\.drill\./, '');
      calls.push({name, params, timeout});
      if (onRequest) {
        const r = await onRequest(name, params, timeout);
        if (r !== undefined) return r;
      }
      if (name === 'settings.get') return {size: 10, jarGoal: 30};
      if (name === 'session') return session ?? {sessionId: 's1', items: [CHOICE], pending: 0};
      if (name === 'answer') return {rating: 'remembered', stars: 1, requeue: false};
      if (name === 'finish') return {stars: 1, accuracy: 1, jar: {today: 1, goal: 2, unit: 'sets'}};
      if (name === 'explain') return {text: 'impact 后面固定用 on。', source: 'model'};
      if (name === 'cheer') return {line: '这一组记住了。'};
      throw new Error('unknown method ' + name);
    },
  };
  const runtime = h.desk.views.drill.mount(root, ctx);
  return {root, runtime, went, local, calls};
}
function press(m, key, {target, code} = {}) {
  const ev = {key, code: code || key, target: target || m.root, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
  m.runtime.keydown(ev);
  return ev;
}
async function answerChoice(m, k) {
  await settle();
  m.root.querySelectorAll('.pk-choice')[k].click();
  m.root.querySelector('.pk-drill-check').click();
  await settle();
}

test('d43cf723：从讨伐进来，退出按钮和确认框要说「讨伐 / 接着打」，空组给出回讨伐', async () => {
  const h = load();
  const empty = mountDrill(h, {source: 'hunt', returnTo: 'gamehunt'}, {session: {sessionId: 'h1', items: []}});
  await settle();
  assert.equal(empty.root.querySelector('.pk-drill-exit').getAttribute('aria-label'), '退出讨伐');
  assert.match(empty.root.querySelector('.pk-drill-empty').textContent, /没有要讨伐的错题怪/);
  const back = empty.root.querySelector('.pk-drill-empty .pk-btn');
  assert.equal(back.textContent, '回讨伐');
  assert.equal(back.dataset.kind, 'go');
  back.click();
  assert.deepEqual(empty.went, ['gamehunt']);

  const live = mountDrill(h, {source: 'hunt', returnTo: 'gamehunt'}, {session: {sessionId: 'h2', items: [CHOICE]}});
  await settle();
  live.root.querySelector('.pk-drill-exit').click();
  const dialog = live.root.querySelector('dialog[open]');
  assert.ok(dialog);
  assert.equal(byText(dialog, 'button', '接着打')?.getAttribute('aria-label'), '接着打');
  assert.equal(byText(dialog, 'button', '先放着，回讨伐')?.getAttribute('aria-label'), '先放着，回讨伐');
});

test('d43cf723：从地图关卡进来，退出说「退出这一关 / 接着做」', async () => {
  const h = load();
  const m = mountDrill(h, {source: 'mixed', returnTo: 'gamemap', node: {id: 'n1'}}, {session: {sessionId: 'm1', items: [CHOICE]}});
  await settle();
  assert.equal(m.root.querySelector('.pk-drill-exit').getAttribute('aria-label'), '退出这一关');
  m.root.querySelector('.pk-drill-exit').click();
  assert.ok(byText(m.root, 'button', '接着做'));
  assert.ok(byText(m.root, 'button', '先放着，回地图'));
});

test('fc9b7451：中途退出和结算都回到打开这一组的那一页，不再掉进笔记本', async () => {
  const h = load();
  const mid = mountDrill(h, {source: 'hunt', returnTo: 'gamehunt'}, {session: {sessionId: 's1', items: [CHOICE]}});
  await settle();
  mid.root.querySelector('.pk-drill-exit').click();
  byText(mid.root, 'button', '先放着，回讨伐').click();
  assert.deepEqual(mid.went, ['gamehunt']);
  assert.equal(mid.local.drillSaved?.returnTo, 'gamehunt');

  const done = mountDrill(h, {source: 'hunt', returnTo: 'gamehunt'}, {session: {sessionId: 's2', items: [CHOICE]}});
  await answerChoice(done, 1);
  done.root.querySelector('.pk-sheet .pk-btn').click();
  await settle();
  assert.equal(h.reward.lastSummary.backLabel, '回讨伐');
  done.root.querySelector('.pk-done-back').click();
  assert.deepEqual(done.went, ['gamehunt']);
});

test('aee46f90：没有到期卡片时主按钮是回去的路，不再给一个没用的「再试一次」', async () => {
  const h = load();
  const empty = mountDrill(h, {source: 'notes', returnTo: 'notes'}, {
    onRequest: async (name) => {
      if (name === 'session') throw new Error('今天的笔记都回顾过了，没有到期的卡片。');
    },
  });
  await settle();
  const box = empty.root.querySelector('.pk-drill-empty');
  assert.equal(box.querySelector('.pk-btn').textContent, '回笔记本');
  assert.equal(byText(box, 'button', '再试一次'), null);
  box.querySelector('.pk-btn').click();
  assert.deepEqual(empty.went, ['notes']);

  const boom = mountDrill(h, {source: 'notes', returnTo: 'today'}, {
    onRequest: async (name) => {
      if (name === 'session') throw new Error('网关超时');
    },
  });
  await settle();
  const box2 = boom.root.querySelector('.pk-drill-empty');
  assert.equal(box2.querySelector('.pk-btn').textContent, '回营地');
  assert.ok(byText(box2, 'button', '再试一次'), '真出错才保留再试一次');
});

test('f30d835d：结算页上按 Enter / 空格要让按钮自己响应，不当成「检查」', async () => {
  const h = load();
  const m = mountDrill(h, {source: 'notes', returnTo: 'notes'}, {session: {sessionId: 's1', items: [CHOICE]}});
  await answerChoice(m, 1);
  m.root.querySelector('.pk-sheet .pk-btn').click();
  await settle();
  const back = m.root.querySelector('.pk-done-back');
  assert.ok(back && back.closest('.pk-done'));
  const enter = press(m, 'Enter', {target: back});
  assert.equal(enter.defaultPrevented, false, 'Enter 不能 preventDefault，否则结算按钮按不下去');
  const space = press(m, ' ', {code: 'Space', target: back});
  assert.equal(space.defaultPrevented, false);
  assert.deepEqual(m.went, [], '只是按键到按钮上，还没有点回去');
});

test('4ec4f176：演示结算的罐子按今天完成的组数计，不再把 30 颗星当成满罐', () => {
  const block = SOURCE.slice(SOURCE.indexOf('function demoSummary()'), SOURCE.indexOf('function localSummary()'));
  assert.match(block, /jar:\s*\{today:\s*2,\s*goal:\s*2,\s*unit:\s*'sets'/);
  assert.doesNotMatch(block, /today:\s*30/);
});

test('f125d5ab：结算接口失败时用这一组的本地数，不拿演示成绩顶上', async () => {
  const h = load();
  const m = mountDrill(h, {source: 'notes', returnTo: 'notes'}, {
    onRequest: async (name) => {
      if (name === 'finish') throw new Error('结算没记上');
    },
  });
  await answerChoice(m, 1);
  m.root.querySelector('.pk-sheet .pk-btn').click();
  await settle();
  const s = h.reward.lastSummary;
  assert.equal(s.failed, true);
  assert.equal(s.stars, 1);
  assert.equal(s.firstFinishToday, false, '失败结算不能当成今天第一次盖章');
  assert.equal(s.jar, undefined, '失败结算不动罐子');
  assert.match(m.root.querySelector('.pk-done-failed').textContent, /1 星/);
});

test('ab19d8b6：点「讲给我听」时把这道题选过的选项带给讲解，不自动调用模型', async () => {
  const h = load();
  const m = mountDrill(h, {source: 'notes', returnTo: 'notes'}, {session: {sessionId: 's1', items: [CHOICE]}});
  await answerChoice(m, 0);
  assert.equal(m.calls.some(c => c.name === 'explain'), false);
  const ask = byText(m.root, '.pk-sheet-explain button, .pkb-link', '讲给我听');
  assert.ok(ask);
  ask.click();
  await settle();
  const explain = m.calls.filter(c => c.name === 'explain');
  assert.equal(explain.length, 1);
  assert.equal(explain[0].params.sessionId, 's1');
  assert.equal(explain[0].params.itemId, 'q1');
  assert.equal(explain[0].params.yours, 'in');
  assert.match(m.root.querySelector('.pk-sheet-explain').textContent, /impact/);
});

test('caa3bb99：作答页题型小字在题干上面，星星是矢量而不是 emoji', async () => {
  const h = load();
  const m = mountDrill(h, {source: 'notes', returnTo: 'notes'}, {session: {sessionId: 's1', items: [CHOICE]}});
  await settle();
  const kids = m.root.querySelector('.pk-drill-q').children.filter(n => n.nodeType === 1);
  assert.ok(kids[0].classList.contains('pk-drill-kicker'));
  assert.match(kids[0].textContent, /单选/);
  assert.ok(kids[1].classList.contains('pk-drill-stem'));
  assert.equal(kids[1].textContent, CHOICE.prompt);
  assert.ok(m.root.querySelector('.pk-drill-options'));
  const stars = m.root.querySelector('.pk-drill-stars');
  assert.ok(stars.innerHTML.includes('<svg'), '星星要用矢量小星');
  assert.doesNotMatch(stars.textContent, /[⭐🌟✨]/);
});
