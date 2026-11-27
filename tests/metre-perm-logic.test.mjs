// #94 权限 / 计划 / 用量的纯逻辑。不启动浏览器：把 laolao-metre-perm.js 放进极简假 DOM，
// 把「现在」钉在本地钟点上，只走 window.PinkieMetrePerm 已经交出来的读取、档位和额度重置。
// 排版、对比度、按键收拢仍由 tests/metre-perm.test.mjs 在真浏览器里测。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(root, 'ui/injections/laolao-metre-perm.js'), 'utf8');
const SK = 'agent:metre:dashboard:t1';
const SK2 = 'agent:metre:dashboard:t2';
const RESUME_OFF = 'pinkie.metre.autoResume.off';
const RealDate = Date;
const at = (y, m, d, h, min, s = 0) => new RealDate(y, m - 1, d, h, min, s, 0).getTime();
// 脚本跑在另一个 vm 里，对象原型和这边不同，先摊成普通 JSON 再比。
const plain = (v) => JSON.parse(JSON.stringify(v));

function classesOf(el) {
  return String(el.className || '').split(/\s+/).filter(Boolean);
}
function matchSimple(el, tok) {
  if (!el || el.nodeType === 'doc') return false;
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
function walk(el, out = []) {
  for (const c of el.children || []) { out.push(c); walk(c, out); }
  return out;
}
function stepsOf(sel) {
  const steps = [];
  let rel = 'desc';
  for (const tok of sel.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/)) {
    if (tok === '>') { rel = 'child'; continue; }
    steps.push({rel, tok});
    rel = 'desc';
  }
  return steps;
}
function evalSel(start, sel) {
  let current = [start];
  for (const step of stepsOf(sel)) {
    const next = [];
    if (step.tok === ':scope') next.push(...current);
    else if (step.rel === 'child') {
      for (const n of current) for (const c of n.children || []) if (matchSimple(c, step.tok)) next.push(c);
    } else {
      for (const n of current) for (const d of walk(n)) if (matchSimple(d, step.tok)) next.push(d);
    }
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
    this.tagName = String(tag).toUpperCase();
    this.className = cls;
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
    this._text = '';
    this.style = {};
    this.style.setProperty = (k, v) => { this.style[k] = String(v); };
    this.style.removeProperty = (k) => { delete this.style[k]; };
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }
  getAttribute(k) { return k === 'class' ? this.className || null : (this.attrs[k] ?? null); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...kids) {
    for (const k of kids) { if (k == null) continue; k.remove?.(); k.parent = this; this.children.push(k); }
  }
  remove() {
    const p = this.parent;
    if (!p) return;
    const i = p.children.indexOf(this);
    if (i >= 0) p.children.splice(i, 1);
    this.parent = null;
  }
  get nextElementSibling() { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get parentElement() { return this.parent; }
  after(n) {
    const p = this.parent; if (!p) return;
    n.remove?.();
    const i = p.children.indexOf(this);
    n.parent = p; p.children.splice(i + 1, 0, n);
  }
  before(n) {
    const p = this.parent; if (!p) return;
    n.remove?.();
    const i = p.children.indexOf(this);
    n.parent = p; p.children.splice(i, 0, n);
  }
  replaceWith(n) {
    const p = this.parent; if (!p) return;
    const i = p.children.indexOf(this);
    n.remove?.();
    n.parent = p; p.children.splice(i, 1, n); this.parent = null;
  }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  getBoundingClientRect() { return {top: 200, bottom: 228, left: 20, right: 120, width: 100, height: 28}; }
  closest(sel) { for (let n = this; n; n = n.parent) if (matchSimple(n, sel)) return n; return null; }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  focus() { this.focused = true; }
}

function boot({now = at(2026, 3, 5, 12, 0), mode = 'metre', sk = SK, responses = {}} = {}) {
  const timers = [];
  let seq = 1, clock = now, modeNow = mode, throwGet = false, throwSet = false;
  const calls = [], listen = {window: {}, document: {}};
  const map = new Map();
  const html = new El('html'), body = new El('body'), main = new El('div', 'chat-main');
  const pane = new El('openclaw-chat-pane'), input = new El('div', 'agent-chat__input');
  const controls = new El('div', 'agent-chat__composer-controls'), eng = new El('button', 'pk-eng-chip');
  const host = new El('openclaw-exec-approval'), card = new El('div', 'exec-approval-card');
  const sub = new El('div', 'exec-approval-sub'), title = new El('div', 'exec-approval-title');
  const actions = new El('div', 'exec-approval-actions');
  html.append(body); body.append(main, host); main.append(pane, input); input.append(controls); controls.append(eng);
  host.append(card); card.append(title, sub, actions);
  pane.state = {sessionKey: sk};
  html.getAttribute = (k) => (k === 'data-laolao-mode' ? modeNow : null);
  const doc = {
    documentElement: html, body,
    createElement: (tag) => new El(tag),
    addEventListener: (t, f) => { (listen.document[t] ||= []).push(f); },
    querySelector: (sel) => queryAll(html, sel)[0] || null,
    querySelectorAll: (sel) => queryAll(html, sel),
  };
  const table = {
    'exec.approvals.get': () => ({hash: 'h1', file: {version: 1, defaults: {}, agents: {}}}),
    'exec.approvals.set': (p) => ({hash: 'h2', file: p.file}),
    'pinkie.metre.planMode.get': () => ({on: false}),
    'pinkie.plan.get': () => ({plan: null}),
    'usage.status': () => ({providers: []}),
    'sessions.usage': () => ({sessions: []}),
    'pinkie.project.bind': () => ({binding: {}}),
    'pinkie.model.failure': () => ({failure: null}),
    'chat.send': () => ({ok: true}),
    ...responses,
  };
  const win = {
    addEventListener: (t, f) => { (listen.window[t] ||= []).push(f); },
    __laolaoSidebar: {
      async gwRequest(method, params) {
        calls.push({method, params: JSON.parse(JSON.stringify(params || {}))});
        const f = table[method];
        if (!f) throw new Error('unknown method: ' + method);
        return await f(params || {});
      },
      toast() {},
    },
  };
  function Clock(...args) {
    if (!new.target) return RealDate(clock).toString();
    return args.length ? new RealDate(...args) : new RealDate(clock);
  }
  Clock.now = () => clock;
  Clock.parse = RealDate.parse;
  Clock.UTC = RealDate.UTC;
  Clock.prototype = RealDate.prototype;
  vm.runInNewContext(SRC, {
    window: win, document: doc, localStorage: {
      getItem: (k) => { if (throwGet) throw new Error('get'); return map.has(k) ? map.get(k) : null; },
      setItem: (k, v) => { if (throwSet) throw new Error('set'); map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    },
    Date: Clock,
    setTimeout: (fn, ms) => { const id = seq++; timers.push({id, fn, ms, remain: ms, cleared: false}); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    getComputedStyle: () => ({display: 'none', position: 'static'}),
    innerHeight: 800, innerWidth: 1200,
    crypto: {randomUUID: () => 'id-test'},
  });
  for (const t of timers) t.cleared = true;   // 装上时排的 600ms 刷新和 5 分钟额度轮询，不放进下面的拨钟
  const api = win.PinkieMetrePerm;
  const sent = () => calls.filter((c) => c.method === 'chat.send');
  async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  function emit(type, detail) { for (const fn of listen.window[type] || []) fn({detail}); }
  return {
    api, calls, map, pane, sent, win,
    setMode: (m) => { modeNow = m; },
    setThrowGet: (v) => { throwGet = v; },
    respond: (method, fn) => { table[method] = fn; },
    refresh: () => api.refresh(),
    levelOf: (file) => api.levelOf(file),
    setLevel: (id) => api.setLevel(id),
    snapshot: () => api.snapshot(),
    async advance(ms) {
      clock += ms;
      const due = [];
      for (const t of timers) { if (t.cleared) continue; t.remain -= ms; if (t.remain <= 0) due.push(t); }
      for (const t of due) { if (t.cleared) continue; t.cleared = true; await t.fn(); }
    },
    mark: () => timers.length,
    fresh(since) { return timers.slice(since).filter((t) => !t.cleared && t.ms !== 60 && t.ms !== 400 && t.ms !== 1500); },
    stat() {
      const chip = doc.querySelector('.pk-perm-chip--stat');
      return {text: chip?.querySelector('.pk-eng-chip__name')?.textContent ?? '', tone: chip?.dataset.tone || ''};
    },
    chips() { return doc.querySelectorAll('.pk-perm-chip .pk-eng-chip__name').map((n) => n.textContent); },
    open() {
      const chip = doc.querySelector('.pk-perm-chip--stat');
      chip.onclick({preventDefault() {}, stopPropagation() {}});
      const pop = doc.querySelector('.pk-perm-pop--detail');
      const rows = {};
      for (const r of pop.querySelectorAll('.pk-perm-pop__row')) rows[r.children[0].textContent] = r.children[1].textContent;
      const buttons = pop.querySelectorAll('button').map((b) => b.textContent);
      return {
        rows,
        plan: pop.querySelector('.pk-perm-pop__plan .pk-perm-pop__k')?.textContent || '',
        now: pop.querySelector('.pk-perm-bar')?.getAttribute('aria-valuenow') || '',
        max: pop.querySelector('.pk-perm-bar')?.getAttribute('aria-valuemax') || '',
        width: pop.querySelector('.pk-perm-bar i')?.style.width || '',
        fail: pop.querySelector('.pk-perm-pop__fail span')?.textContent || '',
        resume: pop.querySelector('.pk-perm-pop__resume span')?.textContent || '',
        buttons,
        click(label) { pop.querySelectorAll('button').find((b) => b.textContent === label).onclick(); },
      };
    },
    sub(text) {
      sub.textContent = text;
      api.paintApproval();
      return sub.dataset.pkZh;
    },
    async error({key = sk, resetAt, kind = 'account'} = {}) {
      table['pinkie.model.failure'] = () => ({failure: kind == null ? null : {kind, resetAt}});
      emit('pinkie:gateway-event', {event: 'chat', payload: {sessionKey: key, state: 'error'}});
      await settle();
    },
    async startRun(key = sk) {
      emit('pinkie:gateway-event', {event: 'agent', payload: {sessionKey: key, stream: 'lifecycle', data: {phase: 'start'}}});
      await settle();
    },
  };
}

const usage = (over = {}) => ({
  sessions: [{
    key: SK, model: 'hy4flash-free', modelProvider: 'workbuddy',
    usage: {input: 12000, output: 3400, totalTokens: 15400, totalCost: 0.0123, firstActivity: at(2026, 3, 5, 9, 5, 59), ...over},
  }],
});
const quota = (windows, provider = {displayName: 'Claude', provider: 'anthropic'}) => ({providers: [{...provider, windows}]});

test('放手程度：缺省是自动，代理盖过默认，对不上才是自定义', () => {
  const env = boot();
  const {levelOf} = env;
  assert.equal(levelOf(null), 'auto');
  assert.equal(levelOf({}), 'auto');
  assert.equal(levelOf({defaults: {security: 'deny', ask: 'off'}}), 'off');
  assert.equal(levelOf({defaults: {security: 'allowlist', ask: 'on-miss'}, agents: {metre: {}}}), 'ask');
  assert.equal(levelOf({defaults: {security: 'deny', ask: 'off'}, agents: {metre: {security: 'full', ask: 'off'}}}), 'auto', '代理自己的档盖过默认');
  assert.equal(levelOf({agents: {metre: {ask: 'off'}}, defaults: {security: 'deny'}}), 'off', '代理没写的那一项才回退到默认');
  assert.equal(levelOf({agents: {metre: {security: 'allowlist', ask: null}}, defaults: {ask: 'on-miss'}}), 'ask', 'null 跟没写一样');
  assert.equal(levelOf({agents: {metre: {security: '', ask: 'off'}}}), 'custom', '空字符串不算没写');
  assert.equal(levelOf({agents: {metre: {security: 'full', ask: 'always'}}}), 'custom');
  assert.deepEqual(plain(env.api.LEVELS.map((l) => [l.id, l.security, l.ask])), [
    ['auto', 'full', 'off'], ['ask', 'allowlist', 'on-miss'], ['off', 'deny', 'off'],
  ]);
});

test('改档只写 Metre 的 security / ask：冲突就重读，最多三次；别的错误不重试', async () => {
  const original = {version: 1, agents: {main: {allowlist: [{id: 'a', pattern: 'git *'}]}}};
  let n = 0;
  const hashes = ['h1', 'h2', 'h3'];
  const sets = [];
  const env = boot({responses: {
    'exec.approvals.get': () => ({hash: hashes[Math.min(n, 2)], file: original}),
    'exec.approvals.set': (p) => { sets.push(p); if (n < 2) { n += 1; throw new Error('exec approvals changed since last load'); } return {hash: 'ok'}; },
  }});
  assert.equal(await env.setLevel('ask'), 'ask');
  assert.equal(sets.length, 3, '前两次被人抢先写了，第三次用新读到的 hash');
  assert.deepEqual(sets.map((p) => p.baseHash), hashes);
  assert.equal(original.agents.metre, undefined, '写之前的那份不能被改掉');
  assert.deepEqual(plain(sets[2].file.agents.metre), {security: 'allowlist', ask: 'on-miss'});
  assert.deepEqual(plain(sets[2].file.agents.main), {allowlist: [{id: 'a', pattern: 'git *'}]});
  assert.equal(env.chips()[0], '问我');

  const noHash = boot({responses: {'exec.approvals.get': () => ({file: {version: 1, agents: null}})}});
  const written = [];
  noHash.respond('exec.approvals.set', (p) => { written.push(p); return {}; });
  assert.equal(await noHash.setLevel('off'), 'off');
  assert.equal('baseHash' in written[0], false, '没有 hash 就不带 baseHash');
  assert.deepEqual(plain(written[0].file.agents.metre), {security: 'deny', ask: 'off'});

  let tries = 0;
  const bad = boot();
  await bad.refresh();
  bad.respond('exec.approvals.set', () => { tries += 1; throw new Error('磁盘满了'); });
  await assert.rejects(() => bad.setLevel('off'), /磁盘满了/);
  assert.equal(tries, 1, '不是 hash 冲突就不重试');
  assert.equal(bad.snapshot().level, 'auto', '没写进去，档位保持原样');
  await assert.rejects(() => bad.setLevel('custom'), /没有这一档/);
  assert.equal(bad.calls.filter((c) => c.method === 'exec.approvals.set').length, 1, '没有这一档，一次都不写');
});

test('时间：当天只写钟点并且补零，跨过午夜、跨月、跨年才写月日，月和日不补零', async () => {
  const day = boot({
    now: at(2026, 3, 5, 12, 0),
    responses: {
      'sessions.usage': () => usage(),
      'usage.status': () => quota([{label: '5h', usedPercent: 60, resetAt: at(2026, 3, 5, 13, 0)}]),
    },
  });
  await day.refresh();
  const rows = day.open().rows;
  assert.equal(rows['开始'], '09:05', '9 点写 09，秒数不进位');
  assert.equal(rows['额度'], 'Claude 5h 还剩 40% · 13:00 重置');

  const midnight = boot({
    now: at(2026, 3, 5, 0, 10),
    responses: {
      'sessions.usage': () => usage({firstActivity: at(2026, 3, 4, 23, 50)}),
      'usage.status': () => quota([{label: '5h', usedPercent: 60, resetAt: at(2026, 3, 5, 1, 0)}]),
    },
  });
  await midnight.refresh();
  const night = midnight.open().rows;
  assert.equal(night['开始'], '3 月 4 日 23:50', '刚过午夜不能把昨晚写成今天的 23:50');
  assert.equal(night['额度'], 'Claude 5h 还剩 40% · 01:00 重置', '重置如果还在今天，仍然只写钟点');

  const next = boot({
    now: at(2026, 3, 5, 22, 0),
    responses: {
      'sessions.usage': () => usage({firstActivity: at(2026, 3, 5, 21, 4)}),
      'usage.status': () => quota([{label: '5h', usedPercent: 60, resetAt: at(2026, 3, 6, 1, 30)}]),
    },
  });
  await next.refresh();
  const later = next.open().rows;
  assert.equal(later['开始'], '21:04');
  assert.equal(later['额度'], 'Claude 5h 还剩 40% · 3 月 6 日 01:30 重置');

  const year = boot({
    now: at(2026, 1, 1, 0, 20),
    responses: {
      'sessions.usage': () => usage({firstActivity: at(2025, 12, 31, 23, 5)}),
      'usage.status': () => quota([{label: 'Week', usedPercent: 10, resetAt: at(2026, 1, 2, 8, 0)}]),
    },
  });
  await year.refresh();
  const ny = year.open().rows;
  assert.equal(ny['开始'], '12 月 31 日 23:05');
  assert.equal(ny['额度'], 'Claude Week 还剩 90% · 1 月 2 日 08:00 重置', '1 月不写成 01 月');
});

test('额度：取剩余最少的窗口，四舍五入，并列留第一个；没有数据不等于没读到', async () => {
  const now = at(2026, 3, 5, 12, 0);
  const env = boot({now, responses: {'usage.status': () => quota([
    {label: 'bad', usedPercent: '0', resetAt: at(2026, 3, 6, 0, 0)},
    {label: '5h', usedPercent: 59.6, resetAt: at(2026, 3, 5, 13, 0)},
    {label: 'Week', usedPercent: 59.6, resetAt: at(2026, 3, 20, 8, 0)},
    {label: 'nan', usedPercent: Number.NaN},
    {label: 'Day', usedPercent: 59.4, resetAt: at(2026, 3, 6, 9, 0)},
  ], {provider: 'anthropic'})}});
  await env.refresh();
  const tight = env.open();
  assert.equal(tight.rows['额度'], 'anthropic 5h 还剩 40% · 13:00 重置', '59.6 剩 40，59.4 剩 41；一样少时留先出现的，字符串和 NaN 跳过');
  assert.equal(tight.fail, '');
  assert.equal(env.stat().text, '额度 40%');
  assert.equal(env.stat().tone, '');

  const over = boot({responses: {'usage.status': () => quota([{label: '5h', usedPercent: 150}])}});
  await over.refresh();
  assert.equal(over.stat().text, '额度 0%');
  assert.equal(over.stat().tone, 'danger', '用超了按 0，不是负数');

  const half = boot({responses: {'usage.status': () => quota([{label: '5h', usedPercent: 99.5}])}});
  await half.refresh();
  assert.equal(half.stat().text, '额度 1%', '剩 0.5 个点进到 1');

  const none = boot();
  await none.refresh();
  const empty = none.open();
  assert.equal(none.stat().text, '详情');
  assert.equal(empty.rows['额度'], '这个账号没给额度数据');
  assert.equal(empty.rows['工作目录'], '没绑文件夹');
  assert.equal(empty.rows['模型'], '—');
  assert.equal(empty.fail, '', '网关正常回了空，不算没读到');

  const missed = boot({responses: {
    'usage.status': () => { throw new Error('超时'); },
    'pinkie.plan.get': () => ({plan: {items: [{status: 'completed'}, {status: 'pending'}]}}),
    'sessions.usage': () => usage(),
  }});
  await missed.refresh();
  assert.equal(missed.stat().text, '没读到', '有一项没读到时，状态键不再混着写计划');
  const fail = missed.open();
  assert.match(fail.fail, /额度/);
  assert.doesNotMatch(fail.fail, /模型/);
  assert.equal(fail.rows['额度'], '没读到');
  assert.equal(fail.rows['模型'], 'workbuddy / hy4flash-free');
  assert.equal(fail.plan, '计划 1 / 2');
});

test('用量对得上当前会话；对不上才退回第一条。令牌和花费按档位写', async () => {
  const other = {key: 'agent:metre:dashboard:other', model: 'wrong', modelProvider: 'nope', usage: {totalTokens: 1, totalCost: 9, firstActivity: at(2026, 3, 5, 1, 0)}};
  const env = boot({responses: {'sessions.usage': () => ({sessions: [other, ...usage({
    totalTokens: 2_500_000, input: 1_500_000, output: 1000, totalCost: 2,
  }).sessions]})}});
  await env.refresh();
  const rows = env.open().rows;
  assert.equal(rows['模型'], 'workbuddy / hy4flash-free', '第一条是别的会话，不能拿来显示');
  assert.equal(rows['本会话令牌'], '2.5M（读 1.5M · 写 1.0k）');
  assert.equal(rows['本会话花费'], '$2.00（估算）');

  const edges = boot({responses: {'sessions.usage': () => ({sessions: [{key: 'someone-else', model: 'fallback', usage: {
    totalTokens: 999, totalCost: 0.1, firstActivity: at(2026, 3, 5, 8, 0),
  }}]})}});
  await edges.refresh();
  const back = edges.open().rows;
  assert.equal(back['模型'], 'fallback', '一条都对不上时用第一条，不把用量丢成空');
  assert.equal(back['本会话令牌'], '999');
  assert.equal(back['本会话花费'], '$0.10（估算）');

  const small = boot({responses: {'sessions.usage': () => usage({totalTokens: 1000, input: 0, output: 0, totalCost: 0.099})}});
  await small.refresh();
  const tiny = small.open().rows;
  assert.equal(tiny['本会话令牌'], '1.0k（读 0 · 写 0）');
  assert.equal(tiny['本会话花费'], '$0.099（估算）', '不到 1 毛留三位');

  const missing = boot({responses: {'sessions.usage': () => ({sessions: [{key: SK, model: 'only-model', usage: {}}]})}});
  await missing.refresh();
  const blank = missing.open().rows;
  assert.equal(blank['本会话令牌'], '—');
  assert.equal(blank['本会话花费'], '—', '没有花费就不加「估算」');
  assert.equal(blank['开始'], '—');
});

test('计划按 completed 计数；状态键把计划和额度拼在一起，10 / 25 是色档边界', async () => {
  const nowText = '改  界面';
  const env = boot({responses: {
    'pinkie.plan.get': () => ({plan: {items: [
      {status: 'completed'}, {status: 'done'}, null,
      {status: 'in_progress', text: '  ' + '甲'.repeat(30)},
      {status: 'pending'},
    ]}}),
    'usage.status': () => quota([{label: '5h', usedPercent: 60}]),
  }});
  await env.refresh();
  assert.equal(env.stat().text, '计划 1 / 5 · 额度 40%', 'status 写成 done 的不算完成');
  const open = env.open();
  assert.equal(open.plan, '计划 1 / 5 · ' + '甲'.repeat(28) + '…', '进行中的一句先收空白，再在 28 字截断');
  assert.equal(open.now, '1');
  assert.equal(open.max, '5');
  assert.equal(open.width, '20%');

  const short = boot({responses: {'pinkie.plan.get': () => ({plan: {items: [
    {status: 'completed'}, {status: 'in_progress', text: nowText},
  ]}})}});
  await short.refresh();
  assert.equal(short.stat().text, '计划 1 / 2');
  assert.equal(short.open().plan, '计划 1 / 2 · 改 界面');

  const tone = async (used) => {
    const one = boot({responses: {'usage.status': () => quota([{label: '5h', usedPercent: used}])}});
    await one.refresh();
    return one.stat().tone;
  };
  assert.equal(await tone(90), 'danger', '剩 10% 已经是危险色');
  assert.equal(await tone(89), 'warn', '剩 11% 还是提醒色');
  assert.equal(await tone(75), 'warn', '剩 25% 仍是提醒色');
  assert.equal(await tone(74), '', '剩 26% 恢复普通色');
  assert.equal(await tone(0), '');
});

test('额度重置：到点后再等 20 秒才发「接着做」；跨日写月日；提前、自己开跑、非额度都不发', async () => {
  const now = at(2026, 3, 5, 22, 0);
  const reset = at(2026, 3, 6, 1, 30);
  const env = boot({now, responses: {'usage.status': () => quota([{label: '5h', usedPercent: 100}])}});
  await env.refresh();
  assert.equal(env.stat().tone, 'danger');
  const since = env.mark();
  await env.error({resetAt: new RealDate(reset).toISOString()});
  const timer = env.fresh(since);
  assert.equal(timer.length, 1);
  assert.equal(timer[0].ms, reset - now + 20_000, '恢复那一刻还不发，再留 20 秒');
  assert.deepEqual(plain(env.snapshot().resume), {key: SK, at: reset, off: false, armed: true});
  assert.equal(env.stat().text, '3 月 6 日 01:30 恢复');
  assert.equal(env.stat().tone, 'warn', '等恢复时盖过额度用尽的危险色');
  assert.equal(env.open().resume, '额度用完了，3 月 6 日 01:30 恢复后自动接着做');
  await env.advance(timer[0].ms - 1);
  assert.equal(env.sent().length, 0, '差 1 毫秒也不发');
  await env.advance(1);
  assert.equal(env.sent().length, 1);
  assert.equal(env.sent()[0].params.sessionKey, SK);
  assert.equal(env.sent()[0].params.message, '额度恢复了，接着做刚才没做完的。');
  assert.ok(env.sent()[0].params.idempotencyKey);
  assert.equal(env.snapshot().resume, null);
  assert.equal(env.stat().text, '额度 0%', '发完回到额度');

  const same = boot({now: at(2026, 3, 5, 12, 0)});
  await same.refresh();
  await same.error({resetAt: new RealDate(at(2026, 3, 5, 12, 1)).toISOString()});
  assert.equal(same.stat().text, '12:01 恢复', '重置还在今天就不写月日');

  const cancel = boot({now});
  await cancel.refresh();
  await cancel.error({resetAt: new RealDate(reset).toISOString()});
  await cancel.startRun();
  assert.equal(cancel.snapshot().resume, null, '用户自己已经开跑，就不再自动发');
  await cancel.advance(reset - now + 20_000);
  assert.equal(cancel.sent().length, 0);

  const replace = boot({now});
  await replace.refresh();
  const first = replace.mark();
  await replace.error({resetAt: new RealDate(reset).toISOString()});
  const early = at(2026, 3, 5, 22, 10);
  const second = replace.mark();
  await replace.error({resetAt: new RealDate(early).toISOString()});
  assert.equal(replace.fresh(first).length, 1, '新的恢复时间换掉上一个定时器');
  assert.equal(replace.fresh(second)[0].ms, early - now + 20_000);
  await replace.advance(early - now + 20_000);
  assert.equal(replace.sent().length, 1);
  await replace.advance(reset - early);
  assert.equal(replace.sent().length, 1, '被换掉的那次到点也不再发');

  for (const [label, arg] of [
    ['刚好到点不算还没恢复', {resetAt: new RealDate(now).toISOString()}],
    ['已经过去的时间不排', {resetAt: new RealDate(now - 1000).toISOString()}],
    ['不是额度用完不排', {kind: 'network', resetAt: new RealDate(reset).toISOString()}],
    ['没有恢复时间不排', {resetAt: ''}],
    ['别的模式的会话不排', {key: 'agent:main:chat:x', resetAt: new RealDate(reset).toISOString()}],
  ]) {
    const one = boot({now});
    await one.refresh();
    await one.error(arg);
    assert.equal(one.snapshot().resume, null, label);
  }

  const other = boot({now, responses: {'usage.status': () => quota([{label: '5h', usedPercent: 40}])}});
  await other.refresh();
  await other.error({key: SK2, resetAt: new RealDate(reset).toISOString()});
  assert.equal(other.snapshot().resume.key, SK2);
  assert.equal(other.stat().text, '额度 60%', '当前会话的状态键不显示另一个会话的恢复');
  await other.advance(reset - now + 20_000);
  assert.equal(other.sent()[0].params.sessionKey, SK2, '到点发给报额度用完的那个会话');
});

test('关掉自动接着做会记住；存储读不了就当作没关过', async () => {
  const now = at(2026, 3, 5, 22, 0);
  const reset = at(2026, 3, 6, 1, 30);
  const env = boot({now});
  env.map.set(RESUME_OFF, '1');
  await env.refresh();
  await env.error({resetAt: new RealDate(reset).toISOString()});
  assert.deepEqual(plain(env.snapshot().resume), {key: SK, at: reset, off: true, armed: false});
  let card = env.open();
  assert.equal(card.resume, '额度用完了，3 月 6 日 01:30 恢复（不自动接着做）');
  card.click('到点自动接着做');
  assert.equal(env.map.has(RESUME_OFF), false);
  assert.equal(env.snapshot().resume.armed, true);
  card = env.open();
  assert.equal(card.resume, '额度用完了，3 月 6 日 01:30 恢复后自动接着做');
  card.click('不自动接着做');
  assert.equal(env.map.get(RESUME_OFF), '1');
  assert.equal(env.snapshot().resume.armed, false);
  await env.advance(reset - now + 20_000);
  assert.equal(env.sent().length, 0);

  const broken = boot({now});
  broken.setThrowGet(true);
  await broken.refresh();
  await broken.error({resetAt: new RealDate(at(2026, 3, 5, 22, 30)).toISOString()});
  assert.equal(broken.snapshot().resume.armed, true, '存储抛错就当作没关过，照样排上');
});

test('审批还要等多久：秒 / 分 / 时有中文，认不出就保持原文', () => {
  const env = boot();
  assert.equal(env.sub('expires in 2m'), '2 分钟后过期');
  assert.equal(env.sub('45s'), '45 秒后过期');
  assert.equal(env.sub('3h'), '3 小时后过期');
  assert.equal(env.sub('2m 后过期'), '2 分钟后过期');
  assert.equal(env.sub('expired'), '已过期');
  assert.equal(env.sub('已过期'), '已过期');
  for (const text of ['2 minutes', 'Expires in 2m', '12m left', '2 m', '2M']) assert.equal(env.sub(text), undefined, text);
  env.setMode('classic');
  assert.equal(env.sub('2m'), undefined, '离开 Metre 不改原文');
});
