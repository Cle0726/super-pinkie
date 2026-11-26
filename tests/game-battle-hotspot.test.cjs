'use strict';
// 热点第 28 名 ui/injections/laolao-game-battle.js：修复类提交的复发测试。
// 不起浏览器：用 vm 加一个最小 DOM 直接跑注入脚本，只看脚本自己的行为（挂在哪、按钮去哪、调用了什么）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-game-battle.js'), 'utf8');

// ───────────── 最小 DOM ─────────────
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
  const s = {
    cssText: '',
    setProperty(k, v) { s[k] = String(v ?? ''); },
    getPropertyValue(k) { return s[k] || ''; },
    removeProperty(k) { const prev = s[k]; delete s[k]; return prev || ''; },
  };
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
    this.rect = null;
    this.html = '';
    this.offsetWidth = 1;
    this.offsetHeight = 1;
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
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.textContent = ''; this.html = String(v); }
  append(...nodes) {
    for (let n of nodes) {
      if (typeof n === 'string') n = this.ownerDocument.createTextNode(n);
      n.remove();
      n.parentNode = this;
      this.children.push(n);
    }
  }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentNode = null;
  }
  after(n) {
    const p = this.parentNode;
    n.remove();
    p.children.splice(p.children.indexOf(this) + 1, 0, n);
    n.parentNode = p;
  }
  replaceWith(n) { this.after(n); this.remove(); }
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
  toggleAttribute(k, force) {
    const on = force === undefined ? !this.attrs.has(k) : Boolean(force);
    if (on) this.attrs.set(k, '');
    else this.attrs.delete(k);
    return on;
  }
  addEventListener(type, fn, opts) { this.listeners.push({type, fn, once: Boolean(opts && opts.once)}); }
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
  getBoundingClientRect() { return this.rect || {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; }
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

// ───────────── 假的学习台、游戏、反馈卡 ─────────────
function fakeDesk() {
  const d = {
    views: {},
    went: [],
    motion: {reduced: true},
    registerView(id, spec) { d.views[id] = spec; },
    go(v) { d.went.push(v); },
    backName(v) { return ({today: '回营地', gamemap: '回地图', gamehunt: '回讨伐', stage: '回舞台'}[v] || '返回'); },
    pane: () => null,
  };
  return d;
}
function fakeGame() {
  const g = {
    calls: [],
    replies: {},
    wentBack: 0,
    backLabel: () => '回地图',
    goBack() { g.wentBack += 1; },
    equippedForm: () => ({id: 'daily'}),
    portrait: () => '',
    art: () => null,
    fxForm: () => null,
    state: async () => ({}),
    forms: async () => ({}),
    manifest: async () => ({}),
    hud() {},
    play() {},
    pending() {},
    async call(name, params, timeout) {
      g.calls.push({name, params, timeout});
      const r = g.replies[name];
      return typeof r === 'function' ? r(params) : r;
    },
  };
  return g;
}
// 和 laolao-desk-reward.js 的 feedbackSheet 一样的外形：.pk-sheet 里有 .pk-sheet-copy 和继续按钮 .pk-btn。
const fakeReward = () => ({
  feedbackSheet(host, opts) {
    const doc = host.ownerDocument;
    const sheet = doc.createElement('div'); sheet.className = 'pk-sheet';
    const copy = doc.createElement('div'); copy.className = 'pk-sheet-copy';
    const title = doc.createElement('b'); title.className = 'pk-sheet-title'; title.textContent = opts.title;
    const line = doc.createElement('p'); line.className = 'pk-sheet-line'; line.textContent = opts.line || '';
    copy.append(title, line);
    const btn = doc.createElement('button'); btn.className = 'pk-btn'; btn.textContent = '继续';
    btn.addEventListener('click', () => opts.onContinue());
    sheet.append(copy, btn); host.append(sheet);
    return {sheet};
  },
});

function load({desk = fakeDesk(), game = fakeGame(), fx, source = SOURCE} = {}) {
  const doc = new FakeDocument();
  const timers = [];
  const ctx = {
    document: doc,
    console,
    Math, Number, String, Boolean, Date, Array, Object, JSON, Promise, Error, TypeError, Map, Set,
    parseInt, parseFloat, isFinite, isNaN, NaN, Infinity, undefined,
    performance: {now: () => 1000},
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: fn => fn(0),
    addEventListener() {},
    __pinkieGame: game,
    __pinkieStudyDesk: desk,
    __pinkieDeskReward: fakeReward(),
  };
  if (fx) ctx.__pinkieGameFx = fx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, {filename: 'laolao-game-battle.js'});
  return {ctx, doc, desk, game, battle: ctx.__pinkieGameBattle, flushTimers() { while (timers.length) timers.shift()(); }};
}

const ITEMS = [
  {itemId: 'q1', prompt: 'She depends ___ her team.', options: ['on', 'in', 'at', 'by'], point: '介词'},
  {itemId: 'q2', prompt: 'I look forward to ___ you.', options: ['see', 'seeing', 'saw', 'seen']},
];
function guardGame() {
  const g = fakeGame();
  g.replies['guard.answer'] = p => ({correct: p.answer === 0, answer: 0, combo: p.answer === 0 ? 1 : 0, explain: '固定搭配'});
  g.replies['guard.finish'] = {passed: true, score: 2, awards: []};
  g.replies['guard.explain'] = {text: '标准答案是 A：depend on 表示依靠。'};
  return g;
}
function mountGuard(h, {returnView} = {}) {
  const host = h.doc.createElement('div');
  h.doc.body.append(host);
  const local = {
    guardRoute: {payload: {attemptId: 'att-1', items: ITEMS}, node: {name: '第一关', region: 'grammar'}},
    returnView,
  };
  const went = [];
  // 真的 go() 没有返回值。
  const ctx = {local: () => local, go: v => { went.push(v); }};
  const runtime = h.desk.views.gameguard.mount(host, ctx);
  return {host, runtime, went, top: host.querySelector('header')};
}
function mountHunt(h) {
  const host = h.doc.createElement('div');
  h.doc.body.append(host);
  h.desk.views.gamehunt.mount(host, {local: () => ({})});
  return {host, back: host.querySelector('button.pkb-x')};
}
const settle = async () => { for (let k = 0; k < 8; k++) await new Promise(r => setImmediate(r)); };
const byText = (root, selector, text) => root.querySelectorAll(selector).find(n => n.textContent === text) || null;
function press(m, key, {target} = {}) {
  const ev = {key, target: target || m.host, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
  m.runtime.keydown(ev);
  return ev;
}
async function answer(m, k) {
  m.host.querySelectorAll('.pkb-opt')[k].click();
  m.host.querySelector('.pk-drill-check').click();
  await settle();
}
async function next(m) { m.host.querySelector('.pk-sheet .pk-btn').click(); await settle(); }

// ───────────── 测试 ─────────────

test('8f1e6869：守关战和讨伐两页登记成宽页（窄卡片里打开也铺满学习台）', () => {
  const h = load();
  assert.equal(h.desk.views.gameguard?.wide, 720);
  assert.equal(h.desk.views.gamehunt?.wide, 720);
});

test('4f079b19：离线换序的原题，怪的名牌写明这次不算收服', () => {
  const h = load();
  const m = {id: 'm1', species: 'ink-slime', name: '墨团', level: 2, wins: 1};
  assert.match(h.battle.monsterEnemy(m, {source: 'local'}).note, /这次不算收服/);
  assert.doesNotMatch(h.battle.monsterEnemy(m, {source: 'local'}).note, /再赢/);
  assert.equal(h.battle.monsterEnemy(m, {source: 'model'}).note, '已打赢 1 次 · 再赢 1 次收服');
});

test('caa3bb99：背一背挂点把对战条放进状态条，伤害数字挂在怪身上，退出时拆掉', () => {
  const hits = [];
  const fx = {settings: () => ({tier: 'full'}), hit: (kind, target, opts) => hits.push({kind, opts}), cinematic: async () => {}};
  const h = load({fx});
  const root = h.doc.createElement('section');
  const top = h.doc.createElement('header');
  root.append(top); h.doc.body.append(root);
  top.rect = {left: 100, top: 40, right: 500, bottom: 80, width: 400, height: 40};
  const b = h.battle.attach(root, {route: {}, top});
  const arena = top.querySelector('.pkb-arena');
  assert.ok(arena, '对战条在状态条里');
  assert.equal(arena.parentNode, top);
  assert.ok(arena.classList.contains('is-strip'));
  assert.ok(top.classList.contains('pkb-top'));
  assert.ok(arena.querySelector('.pkb-foe .pkb-pops'), '伤害数字挂在怪身上');
  assert.equal(root.dataset.battle, '1');
  b.strike({correct: true, firstTry: true, ms: 4000});
  assert.ok(arena.querySelector('.pkb-foe .pkb-pops .pkb-pop'), '出手后伤害数字从怪身上升起');
  b.detach();
  assert.equal(top.querySelector('.pkb-arena'), null, '退出后对战条要从状态条拿掉');
  assert.equal(top.classList.contains('pkb-top'), false);
  assert.equal(root.dataset.battle, undefined);
});

test('915ac4db：记下状态条底边和中线，大奖励标题才能对齐状态条', () => {
  const h = load();
  const root = h.doc.createElement('section');
  const top = h.doc.createElement('header');
  root.append(top); h.doc.body.append(root);
  top.rect = {left: 100, top: 40, right: 500, bottom: 80, width: 400, height: 40};
  h.battle.attach(root, {route: {}, top});
  const s = h.doc.documentElement.style;
  assert.equal(s['--pkb-arena-bottom'], '80px');
  assert.equal(s['--pkb-arena-cx'], '300px', '大奖励标题对齐状态条中线');
});

test('d43cf723：讨伐页的 × 走游戏自己的返回，不再一律送回营地', async () => {
  const h = load();
  h.game.replies['monsters.list'] = {monsters: []};
  const m = mountHunt(h);
  assert.equal(m.back.getAttribute('aria-label'), '回地图');
  m.back.click();
  assert.equal(h.game.wentBack, 1);
  assert.deepEqual(h.desk.went, [], '有 goBack 时不要再 desk.go(today)');
});

test('fc9b7451：守关结算的主按钮回到打开这一卷的那一页，不是写死回地图', async () => {
  const h = load({game: guardGame()});
  const m = mountGuard(h, {returnView: 'gamehunt'});
  await answer(m, 0);
  await next(m);
  await answer(m, 0);
  await next(m);
  const primary = m.host.querySelector('.pkb-result__act .pkg-btn');
  assert.equal(primary.textContent, '回讨伐');
  assert.ok(byText(m.host, '.pkb-link', '回地图'), '不是讨伐来的话，地图仍是次要出口');
  primary.click();
  assert.deepEqual(m.went, ['gamehunt']);
  assert.deepEqual(h.desk.went, [], '主按钮只回打开处，不要顺便再送回营地');
});

test('aee46f90：守关做到一半退出要先问；go() 没有返回值时不能再被拽回营地', async () => {
  const h = load({game: guardGame()});
  const m = mountGuard(h, {returnView: 'gamemap'});
  // 还没作答：× 直接离开，且只走 ctx.go，不会因为返回值是 undefined 再 desk.go('today')。
  m.top.querySelector('.pkb-x').click();
  assert.equal(m.host.querySelector('dialog'), null);
  assert.deepEqual(m.went, ['gamemap']);
  assert.deepEqual(h.desk.went, []);

  const m2 = mountGuard(h, {returnView: 'gamemap'});
  await answer(m2, 0);
  await next(m2);
  assert.match(m2.host.querySelector('.pk-drill-kicker').textContent, /第 2 题/);
  m2.top.querySelector('.pkb-x').click();
  const dialog = m2.host.querySelector('dialog[open]');
  assert.ok(dialog, '做到一半退出要弹出确认');
  assert.match(dialog.textContent, /这次不算/);
  assert.equal(byText(dialog, 'button', '接着打')?.dataset.kind, 'go');
  assert.equal(byText(dialog, 'button', '退出，回地图')?.textContent, '退出，回地图');
  byText(dialog, 'button', '接着打').click();
  assert.equal(m2.host.querySelector('dialog'), null);
  assert.deepEqual(m2.went, [], '选接着打不能离开');
  assert.match(m2.host.querySelector('.pk-drill-kicker').textContent, /第 2 题/);

  press(m2, 'Escape');
  assert.ok(m2.host.querySelector('dialog[open]'), 'Escape 也要先问');
  byText(m2.host, 'button', '退出，回地图').click();
  assert.deepEqual(m2.went, ['gamemap']);
  assert.deepEqual(h.desk.went, [], '离开时不要再被 ?? desk.go(today) 拽回营地');
});

test('ab19d8b6：守关讲题按这道题的选项去讲，点了「讲给我听」才调用，不另编一个答案', async () => {
  const h = load({game: guardGame()});
  const m = mountGuard(h, {returnView: 'gamemap'});
  await answer(m, 0);
  assert.equal(h.game.calls.some(c => c.name === 'guard.explain'), false, '讲解要等人自己点，不自动调模型');
  const ask = byText(m.host, '.pk-sheet-explain button, .pkb-link', '讲给我听');
  assert.ok(ask, '反馈卡里要有「讲给我听」');
  ask.click();
  await settle();
  const explain = h.game.calls.filter(c => c.name === 'guard.explain');
  assert.equal(explain.length, 1);
  const params = explain[0].params;
  assert.equal(params.attemptId, 'att-1');
  assert.equal(params.itemId, 'q1');
  assert.equal(params.yours, 'on', '讲解要带上这道题选过的选项，不能另编一个答案');
  assert.match(m.host.querySelector('.pk-sheet-explain').textContent, /depend on/);
});
