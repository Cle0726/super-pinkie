// U4 收藏模型的排序和存取。不启动浏览器：直接调用 laolao-metre-fav.js 交出来的
// read / toggle / decorate / pickerFavs / decoratePicker。真页面的星标尺寸和键盘仍由 tests/metre-fav.test.mjs 测。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-fav.js'), 'utf8');
const KEY = 'pinkie:metre:fav-models:v1';
const plain = (v) => JSON.parse(JSON.stringify(v));

function classesOf(el) { return String(el.className || '').split(/\s+/).filter(Boolean); }
function matchSimple(el, tok) {
  if (!el) return false;
  let rest = tok, tag = '';
  if (rest[0] !== '.' && rest[0] !== '[') {
    const m = /^[a-zA-Z][\w-]*/.exec(rest);
    if (!m) return false;
    tag = m[0];
    rest = rest.slice(m[0].length);
  }
  const classes = [], attrs = [];
  while (rest) {
    if (rest[0] === '.') {
      const m = /^\.([_a-zA-Z][\w-]*)/.exec(rest);
      if (!m) return false;
      classes.push(m[1]);
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '[') {
      const m = /^\[([^\]]+?)(?:([~|^$*]?=)"([^"]*)")?\]/.exec(rest);
      if (!m) return false;
      attrs.push({name: m[1], op: m[2] || '', value: m[3]});
      rest = rest.slice(m[0].length);
    } else return false;
  }
  if (tag && String(el.tagName).toUpperCase() !== tag.toUpperCase()) return false;
  const have = classesOf(el);
  if (classes.some((c) => !have.includes(c))) return false;
  for (const a of attrs) {
    const v = a.name === 'class' ? el.className : el.attrs?.[a.name];
    if (a.op === '' ? v == null : v !== a.value) return false;
  }
  return true;
}
function walk(el, out = []) { for (const c of el.children || []) { out.push(c); walk(c, out); } return out; }
function stepsOf(sel) {
  const steps = []; let rel = 'desc';
  for (const tok of sel.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/)) {
    if (tok === '>') { rel = 'child'; continue; }
    steps.push({rel, tok}); rel = 'desc';
  }
  return steps;
}
function evalSel(start, sel) {
  let current = [start];
  for (const step of stepsOf(sel)) {
    const next = [];
    if (step.tok === ':scope') next.push(...current);
    else if (step.rel === 'child') { for (const n of current) for (const c of n.children || []) if (matchSimple(c, step.tok)) next.push(c); }
    else { for (const n of current) for (const d of walk(n)) if (matchSimple(d, step.tok)) next.push(d); }
    current = next;
  }
  return current;
}
function queryAll(start, selector) {
  const out = [], seen = new Set();
  for (const alt of String(selector).split(',').map((s) => s.trim()).filter(Boolean)) {
    for (const el of evalSel(start, alt)) if (!seen.has(el)) { seen.add(el); out.push(el); }
  }
  return out;
}

class El {
  constructor(tag, cls = '') {
    this.tagName = String(tag).toUpperCase(); this.className = cls; this.children = []; this.parent = null;
    this.attrs = {}; this.dataset = {}; this.listeners = {}; this._text = '';
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return k === 'class' ? this.className || null : (this.attrs[k] ?? null); }
  append(...kids) { for (const k of kids) { if (k == null) continue; k.remove?.(); k.parent = this; this.children.push(k); } }
  remove() { const p = this.parent; if (!p) return; const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parent = null; }
  replaceWith(n) { const p = this.parent; if (!p) return; const i = p.children.indexOf(this); n.remove?.(); n.parent = p; p.children.splice(i, 1, n); this.parent = null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  get parentElement() { return this.parent; }
  get isConnected() { for (let n = this; n; n = n.parent) if (n.tagName === 'BODY') return true; return false; }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
}

function node(tag, cls, text) {
  const n = new El(tag, cls || '');
  if (text != null) n.textContent = text;
  return n;
}

function boot() {
  let mode = 'metre', throwGet = false, throwSet = false;
  const map = new Map();
  const html = new El('html'), body = new El('body');
  html.append(body);
  html.getAttribute = (k) => (k === 'data-laolao-mode' ? mode : null);
  const storage = {
    getItem: (k) => { if (throwGet) throw new Error('get'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (throwSet) throw new Error('set'); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  const win = {Pinkie: {}, localStorage: storage, addEventListener() {}};
  const doc = {
    documentElement: html, body, createElement: (tag) => new El(tag),
    addEventListener() {}, querySelector: (sel) => queryAll(html, sel)[0] || null, querySelectorAll: (sel) => queryAll(html, sel),
  };
  vm.runInNewContext(SRC, {window: win, document: doc});
  const fav = win.Pinkie.metre.fav;
  const click = (el) => {
    const event = {target: el, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }};
    for (let n = el; n && !event.stopped; n = n.parent) for (const fn of n.listeners?.click || []) fn(event);
    return event;
  };
  return {
    fav, map, body, click,
    setMode: (m) => { mode = m; },
    setThrowGet: (v) => { throwGet = v; },
    setThrowSet: (v) => { throwSet = v; },
    put(list) { map.set(KEY, JSON.stringify(list)); },
    raw(text) { map.set(KEY, text); },
    read: () => plain(fav.read()),
    toggle: (key) => fav.toggle(key),
    names: (menu) => menu.querySelectorAll('.pk-eng-menu__name').map((n) => n.textContent),
    stars: (menu) => menu.querySelectorAll('.pk-fav-star').map((s) => ({on: s.getAttribute('aria-pressed'), label: s.getAttribute('aria-label'), text: s.textContent, title: s.title})),
  };
}

function menu(engine, rows, subtitle) {
  const m = node('div', 'pk-eng-menu');
  const head = node('div', 'pk-eng-menu__head');
  head.append(node('span', 'pk-eng-menu__sub', subtitle ?? `${engine} 用哪个模型`));
  const box = node('div', 'pk-eng-menu__body');
  box.append(node('button', 'pk-eng-menu__back', '‹ 换引擎'));
  for (const [name, note, opts] of rows) {
    const item = node('button', 'pk-eng-menu__item');
    item.setAttribute('role', 'menuitemradio');
    if (name != null) item.append(node('span', 'pk-eng-menu__name', name));
    item.append(node('span', 'pk-eng-menu__note', note));
    if (opts?.listen) item.addEventListener('click', opts.listen);
    box.append(item);
  }
  m.append(head, box);
  return m;
}
const MODELS = [['Opus', 'opus · 默认'], ['Sonnet', 'sonnet'], ['Haiku', 'haiku'], ['Fable', 'fable · 额度用完了']];

test('存取：坏数据当空，新收藏插到最前，关掉会清掉重复，超过 200 丢掉最旧的', () => {
  const env = boot();
  assert.equal(env.fav.KEY, KEY);
  assert.deepEqual(env.read(), []);
  for (const raw of ['{', 'null', '{"a":1}', '"x"', '1']) {
    env.raw(raw);
    assert.deepEqual(env.read(), [], raw);
  }
  env.put(['ok', '', 1, null, '也行']);
  assert.deepEqual(env.read(), ['ok', '也行']);
  env.put(['a', 'a', 'b']);
  assert.equal(env.toggle('a'), false);
  assert.deepEqual(env.read(), ['b'], '关掉时重复的键一起去掉');
  assert.equal(env.toggle('c'), true);
  assert.equal(env.toggle('b'), false);
  assert.equal(env.toggle('b'), true);
  assert.deepEqual(env.read(), ['b', 'c'], '重新收藏插到最前，不是按字母排');

  const seed = Array.from({length: 200}, (_, i) => `e/m${String(i).padStart(3, '0')}`);
  env.put(seed);
  assert.equal(env.toggle('e/new'), true);
  const saved = env.read();
  assert.equal(saved.length, 200);
  assert.equal(saved[0], 'e/new');
  assert.equal(saved.at(-1), 'e/m198');
  assert.equal(saved.includes('e/m199'), false, '超限丢掉最旧的一条，不丢掉刚收藏的');

  env.setThrowGet(true);
  assert.deepEqual(env.read(), []);
  env.setThrowGet(false);
  env.put([]);
  env.setThrowSet(true);
  assert.equal(env.toggle('a'), true, '存不了也告诉调用方这次是收藏');
  assert.deepEqual(env.read(), [], '存不了就不留');
});

test('引擎菜单：收藏排到换引擎后面，组内保持原顺序；点星标不跳位，下次打开才排', () => {
  const env = boot();
  env.put(['Claude Code/haiku', 'Claude Code/opus', 'Codex/sonnet']);
  const first = menu('Claude Code', MODELS);
  env.body.append(first);
  env.fav.decorate(first);
  assert.equal(first.querySelector('.pk-eng-menu__body').children[0].textContent, '‹ 换引擎');
  assert.deepEqual(env.names(first), ['Opus', 'Haiku', 'Sonnet', 'Fable'], '收藏按菜单原来的顺序，不按最近收藏；别的引擎不算');
  assert.deepEqual(env.stars(first).map((s) => s.on), ['true', 'true', 'false', 'false']);
  assert.equal(env.stars(first)[0].label, '取消收藏 Opus');
  assert.equal(env.stars(first)[2].text, '☆');
  assert.equal(env.stars(first)[2].title, '收藏：下次打开排在最前');

  const sonnet = first.querySelectorAll('.pk-fav-row').find((r) => r.textContent.includes('Sonnet'));
  const star = sonnet.querySelector('.pk-fav-star');
  const item = sonnet.querySelector('.pk-eng-menu__item');
  assert.equal(item.querySelector('.pk-fav-star'), null, '星标是行旁边的兄弟，不在模型按键里面');
  let bubbled = 0;
  first.addEventListener('click', () => { bubbled += 1; });
  const event = env.click(star);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(bubbled, 0, '点星标不冒泡到菜单');
  assert.deepEqual(env.names(first), ['Opus', 'Haiku', 'Sonnet', 'Fable'], '点星标不当场重排');
  assert.equal(star.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(env.read(), ['Claude Code/sonnet', 'Claude Code/haiku', 'Claude Code/opus', 'Codex/sonnet']);

  env.fav.decorate(first);
  assert.equal(first.querySelectorAll('.pk-fav-star').length, 4, '已经包过的行不会再包一层');
  assert.equal(first.querySelectorAll('.pk-fav-row .pk-fav-row').length, 0);

  const again = menu('Claude Code', MODELS);
  env.body.append(again);
  env.fav.decorate(again);
  assert.deepEqual(env.names(again), ['Opus', 'Sonnet', 'Haiku', 'Fable']);

  const all = boot();
  all.put(MODELS.map(([, note]) => 'Claude Code/' + note.split(' · ')[0]));
  const full = menu('Claude Code', MODELS);
  all.body.append(full);
  all.fav.decorate(full);
  assert.deepEqual(all.names(full), ['Opus', 'Sonnet', 'Haiku', 'Fable'], '全都收藏时顺序不变');

  const none = boot();
  const plain = menu('Claude Code', MODELS);
  none.body.append(plain);
  none.fav.decorate(plain);
  assert.deepEqual(none.names(plain), ['Opus', 'Sonnet', 'Haiku', 'Fable']);
  assert.deepEqual(none.stars(plain).map((s) => s.on), ['false', 'false', 'false', 'false']);
});

test('不该包的菜单不动：别的模式、没挂上、副标题不对、没有 slug', () => {
  const env = boot();
  env.put(['Claude Code/haiku']);
  env.setMode('pinkie');
  const other = menu('Claude Code', MODELS);
  env.body.append(other);
  env.fav.decorate(other);
  assert.equal(other.querySelectorAll('.pk-fav-star').length, 0);
  assert.deepEqual(env.names(other), ['Opus', 'Sonnet', 'Haiku', 'Fable']);

  env.setMode('metre');
  const loose = menu('Claude Code', MODELS);
  env.fav.decorate(loose);
  assert.equal(loose.querySelectorAll('.pk-fav-star').length, 0, '没挂到页面上不包');

  for (const subtitle of ['这段对话交给谁来做', 'Claude Code 用哪个模型 ', '用哪个模型']) {
    const step = menu('Claude Code', MODELS, subtitle);
    env.body.append(step);
    env.fav.decorate(step);
    assert.equal(step.querySelectorAll('.pk-fav-star').length, 0, subtitle);
  }

  env.put(['Claude Code/haiku']);
  const blank = menu('Claude Code', [['空', '   '], ['Haiku', 'haiku'], ['Opus', 'opus']]);
  env.body.append(blank);
  env.fav.decorate(blank);
  assert.equal(blank.querySelectorAll('.pk-fav-star').length, 2, '没有 slug 的行不包');
  assert.deepEqual(env.names(blank), ['空', 'Haiku', 'Opus']);

  const nameless = menu('Claude Code', [[null, 'haiku · 默认']]);
  env.body.append(nameless);
  env.put(['Claude Code/haiku']);
  env.fav.decorate(nameless);
  assert.equal(env.stars(nameless)[0].label, '取消收藏 haiku', '没有展示名就用 slug');

  env.put(['claude code/haiku']);
  const cased = menu('Claude Code', [['Haiku', 'haiku']]);
  env.body.append(cased);
  env.fav.decorate(cased);
  assert.equal(env.stars(cased)[0].on, 'false', '引擎名区分大小写');
});

test('原生选择器：picker: 单独排序，跟着可见目录，不收引擎菜单的收藏', () => {
  const env = boot();
  env.put(['picker:b', 'Claude Code/haiku', 'picker:a', 'picker:missing']);
  assert.deepEqual(plain(env.fav.pickerFavs(['a', 'c', 'b'])), ['b', 'a'], '按存储顺序，目录里没有的丢掉，引擎收藏不进这里');
  env.setMode('baton');
  assert.deepEqual(plain(env.fav.pickerFavs(['a', 'b'])), [], '不是 Metre 时常用模型不提前');
  env.setMode('metre');
  assert.deepEqual(plain(env.fav.pickerFavs(['a', 'b'])), ['b', 'a']);

  const surface = new El('div');
  surface.setAttribute('data-pinkie-picker-surface', '1');
  const host = new El('div', 'chat-controls__model-options');
  const old = new El('button');
  old.setAttribute('data-chat-model-option', 'google/gemini-3-flash');
  old.setAttribute('aria-selected', 'true');
  old.append(node('span', 'chat-controls__model-option-title', 'Gemini Old'));
  host.append(old);
  const catalog = new El('div', 'pinkie-fallback-catalog');
  const hidden = new El('button');
  hidden.setAttribute('data-chat-model-option', 'hidden/old');
  hidden.setAttribute('aria-selected', 'true');
  hidden.setAttribute('data-pinkie-hidden-model', '1');
  hidden.textContent = '藏起来的';
  const shown = new El('button');
  shown.setAttribute('data-chat-model-option', 'openai/gpt-5.2');
  shown.setAttribute('aria-selected', 'true');
  shown.append(node('span', 'chat-controls__model-option-title', 'GPT-5.2'), node('span', 'extra', '不要这个'));
  const other = new El('button');
  other.setAttribute('data-chat-model-option', 'google/gemini-3-flash');
  other.setAttribute('aria-selected', 'false');
  other.textContent = 'Gemini 3 Flash';
  catalog.append(hidden, shown, other);
  surface.append(host, catalog);
  env.body.append(surface);

  env.fav.decoratePicker(surface);
  const button = () => surface.querySelector(':scope > .pk-fav-current');
  assert.equal(button().textContent, '☆ 收藏当前模型 GPT-5.2', '用可见目录的展示名，不拿藏着的旧行，也不拿路由');
  assert.equal(button().getAttribute('aria-pressed'), 'false');
  env.click(button());
  assert.equal(button().textContent, '★ 已收藏 GPT-5.2');
  assert.deepEqual(env.read()[0], 'picker:openai/gpt-5.2');
  assert.equal(env.read().includes('Claude Code/haiku'), true, '收藏当前模型不冲掉引擎菜单的收藏');
  assert.deepEqual(plain(env.fav.pickerFavs(['openai/gpt-5.2', 'google/gemini-3-flash', 'b', 'a'])), ['openai/gpt-5.2', 'b', 'a']);
  env.click(button());
  assert.equal(env.read().includes('picker:openai/gpt-5.2'), false);
  assert.equal(button().getAttribute('aria-pressed'), 'false');

  shown.setAttribute('aria-selected', 'false');
  env.fav.decoratePicker(surface);
  assert.equal(button(), null, '可见目录里没有选中项就把键拿掉');

  const named = new El('div');
  const row = new El('button');
  row.setAttribute('data-chat-model-option', 'prov/slug');
  row.setAttribute('aria-selected', 'true');
  row.setAttribute('data-chat-model-name', '数据名');
  row.textContent = 'prov/slug';
  named.append(row);
  env.body.append(named);
  env.fav.decoratePicker(named);
  assert.equal(named.querySelector('.pk-fav-current').textContent, '☆ 收藏当前模型 数据名');

  const bare = new El('div');
  const only = new El('button');
  only.setAttribute('data-chat-model-option', 'prov/slug');
  only.setAttribute('aria-selected', 'true');
  bare.append(only);
  env.body.append(bare);
  env.fav.decoratePicker(bare);
  assert.equal(bare.querySelector('.pk-fav-current').textContent, '☆ 收藏当前模型 prov/slug', '没有名字才退回路由');

  env.setMode('pinkie');
  env.fav.decoratePicker(bare);
  assert.equal(bare.querySelector('.pk-fav-current'), null);
});
