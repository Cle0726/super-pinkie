// L28（#96，T3 #16）：Metre 侧栏会话行的悬停预览卡（laolao-metre-peek.js / .css）。不起浏览器：
// 真的 laolao-metre-list.js 和 laolao-metre-peek.js 放进同一个 vm 上下文，用极简假 DOM 跑——
// 延迟弹出、内容（会话名 / 摘要 / 状态 · 模型 · 时间）、移开 / 按下 / 滚动 / 改大小 / 失焦 / 切模式 / Esc 收起、
// 键盘聚焦弹出与 aria-describedby、列表重画后跟到新行、侧栏看不见时不弹、窄窗口夹在窗口里、
// 其他模式一个节点都不加；以及头片段 / regions / 例外文件 / 样式与健康规矩（只在 Metre、不挡点击、无 !important / 观察器 / 请求）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, 'ui/injections', f), 'utf8');
const LIST = read('laolao-metre-list.js'), PEEK = read('laolao-metre-peek.js');

// ---------- 极简假 DOM：只支持本文件用到的选择器（标签 / 类 / [data-x] / [data-x="v"]、后代、:scope >、:hover、:focus-visible） ----------
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function compound(n, c) {
  const tag = /^[a-z][\w-]*/i.exec(c)?.[0];
  if (tag && n.tagName !== tag.toUpperCase()) return false;
  for (const m of c.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)) if (!n.has(m[1])) return false;
  for (const m of c.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)) {
    const k = camel(m[1]);
    if (!(k in n.dataset) || (m[2] !== undefined && n.dataset[k] !== m[2])) return false;
  }
  return true;
}
class El {
  constructor(doc, tag, cls = '') { Object.assign(this, {doc, tagName: tag.toUpperCase(), className: cls, children: [], parent: null, attrs: {}, dataset: {}, style: {}, textContent: '', id: '', rect: null}); }
  has(c) { return this.className.split(/\s+/).includes(c); }
  append(...kids) { for (const k of kids) { k.remove(); k.parent = this; this.children.push(k); } }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  replaceWith(n) { const p = this.parent, i = p.children.indexOf(this); n.remove(); this.remove(); n.parent = p; p.children.splice(i, 0, n); }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === this.doc.documentElement; }
  contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  matches(sel) {
    if (sel === ':hover') return Boolean(this.doc.hover && this.contains(this.doc.hover));
    if (sel === ':focus-visible') return this.doc.activeElement === this && this.doc.focusVisible;
    const parts = sel.trim().split(/\s+/);
    if (!compound(this, parts.pop())) return false;
    let n = this.parent;
    while (parts.length) { const c = parts.pop(); while (n && !compound(n, c)) n = n.parent; if (!n) return false; n = n.parent; }
    return true;
  }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null; }
  all(out = []) { for (const c of this.children) { out.push(c); c.all(out); } return out; }
  querySelectorAll(sel) { const m = /^:scope > (.+)$/.exec(sel); return m ? this.children.filter((c) => c.matches(m[1])) : this.all().filter((c) => c.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return this.rect || {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; }
  get offsetWidth() { return 240; }
  get offsetHeight() { return 96; }
}

const NOW = Date.now();
const ROWS = [
  {key: 'agent:metre:a', label: '修登录页按钮', lastMessagePreview: '按钮已经改成蓝色，\n   测试 12 个全过。', model: 'mm/MiniMax-M2', updatedAt: NOW - 3 * 60_000 - 5_000},
  {key: 'agent:metre:b', label: '空会话', lastMessagePreview: null, updatedAt: NOW - 30 * 3_600_000},
  {key: 'agent:metre:c', label: '长回答', lastMessagePreview: '长'.repeat(300), model: 'glm-4.6', updatedAt: NOW},
  {key: 'agent:metre:d', label: '在跑的会话', lastMessagePreview: '正在跑测试', model: 'mm/MiniMax-M2', status: 'running', updatedAt: NOW},
];

function env({mode = 'metre', width = 1440} = {}) {
  const doc = {activeElement: null, hover: null, focusVisible: false, listeners: {}};
  const mk = (tag, cls) => new El(doc, tag, cls);
  const html = mk('html'); html.setAttribute('data-laolao-mode', mode); doc.documentElement = html;
  const body = mk('body'); html.append(body); doc.body = body;
  const main = mk('main'); body.append(main);
  const aside = mk('aside', 'sidebar'); aside.rect = {left: 0, top: 0, right: 238, bottom: 900, width: 238, height: 900}; body.append(aside);
  const build = () => {
    const groups = mk('div', 'laolao-managed-groups');
    ROWS.forEach((s, i) => {
      const row = mk('div', 'sidebar-recent-session session-row-host'); row.dataset.sessionKey = s.key;
      row.rect = {left: 4, right: 234, width: 230, top: 80 + i * 32, bottom: 110 + i * 32, height: 30};
      const link = mk('a', 'sidebar-recent-session__link'), name = mk('span', 'sidebar-recent-session__name'); name.textContent = s.label;
      link.append(name); row.append(link); groups.append(row);
    });
    return groups;
  };
  let groups = build(); aside.append(groups);
  Object.assign(doc, {createElement: (t) => mk(t), querySelector: (s) => html.querySelector(s), addEventListener: (t, f) => (doc.listeners[t] ||= []).push(f)});
  const win = {innerWidth: width, innerHeight: 900, listeners: {}, addEventListener: (t, f) => (win.listeners[t] ||= []).push(f),
    PinkieSessionList: {sessionStatus: (s) => (s.status === 'running' ? 'running' : ''), invalidate() {}}};
  const timers = new Map(), micro = []; let seq = 0;
  const ctx = vm.createContext({window: win, document: doc, CSS: {escape: (s) => s},
    setTimeout: (f, ms) => { timers.set(++seq, {f, ms}); return seq; }, clearTimeout: (id) => { timers.delete(id); }, queueMicrotask: (f) => { micro.push(f); }});
  vm.runInContext(LIST, ctx); vm.runInContext(PEEK, ctx);
  const decorate = (g = groups) => win.PinkieMetreList.decorate(g, ROWS, {state: {pins: []}});
  decorate();   // laolao-session-list.js 在 Metre 里每次画完列表都会调一次

  const tick = () => { const all = [...timers.values()]; timers.clear(); for (const t of all) t.f(); return all.map((t) => t.ms); };
  const flush = () => { while (micro.length) micro.shift()(); };
  const fire = (type, props = {}) => {
    const e = {type, pointerType: 'mouse', isComposing: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...props};
    for (const f of win.listeners[type] || []) f(e);
    for (const f of doc.listeners[type] || []) f(e);
    return e;
  };
  const row = (k) => html.querySelector(`.session-row-host[data-session-key="agent:metre:${k}"]`);
  const link = (k) => row(k).querySelector(':scope > .sidebar-recent-session__link');
  const card = () => body.querySelector('.pk-mpeek');
  const texts = () => { const c = card(); if (!c) return null; const [t, x, m] = c.children; return [t.textContent, x.textContent, ...(m ? m.children.map((n) => n.textContent) : [])]; };
  const hover = (k) => {   // 指针从当前位置移到第 k 行的会话名上（k 为空 = 移到正文）
    const prev = doc.hover, to = k ? link(k).children[0] : main;
    doc.hover = to;
    if (prev) fire('pointerout', {target: prev, relatedTarget: to});
    fire('pointerover', {target: to, relatedTarget: prev});
  };
  const focus = (k, visible = true) => {
    const prev = doc.activeElement, to = k ? link(k) : null;
    doc.activeElement = to; doc.focusVisible = visible;
    if (prev) fire('focusout', {target: prev, relatedTarget: to});
    if (to) fire('focusin', {target: to, relatedTarget: prev});
  };
  // 列表重画：先 decorate 新的一组行，再整组 replaceWith（同 laolao-session-list.js），最后跑微任务
  const rerender = (hoverKey) => {
    const next = build(); decorate(next); groups.replaceWith(next); groups = next;
    doc.hover = hoverKey ? link(hoverKey).children[0] : main;
    flush();
  };
  return {doc, win, html, body, aside, timers, tick, flush, fire, row, link, card, texts, hover, focus, rerender, peek: win.Pinkie.metrePeek, mk};
}

test('悬停延迟弹出：停够 450ms 才出；卡片有会话名、摘要（空白折成一个）、模型（去掉厂商前缀）· 相对时间，在侧栏右边、和这一行顶对齐', () => {
  const e = env();
  e.hover('a');
  assert.equal(e.card(), null, '还没到时间不出');
  assert.deepEqual(e.tick(), [450], '只有一次性的弹出延时');
  const c = e.card();
  assert.ok(c, '停够了就出');
  assert.equal(c.parent, e.body, '卡片挂在 body 上，不动侧栏的节点');
  // 复发防护（pr-shots run 46034579951）：Metre 皮肤给 :is([role="tooltip"], .tooltip, .laolao-tooltip) 强制铺反色，
  // 卡片若被它选中，摘要字和底同色（对比度 1）整行看不见。卡片不能落进这条规则（同 laolao-metre-cite.js 的引用卡）。
  assert.match(read('laolao-metre-skin.css'), /:is\(\[role="tooltip"\], \.tooltip, \.laolao-tooltip\) \{ background: var\(--metre-text\) !important;/, '前提：皮肤里那条 tooltip 反色规则还在');
  assert.equal(c.getAttribute('role'), null, '卡片不带 role="tooltip"');
  assert.ok(!c.has('tooltip') && !c.has('laolao-tooltip'), '卡片也不带 .tooltip / .laolao-tooltip');
  assert.deepEqual(e.texts(), ['修登录页按钮', '按钮已经改成蓝色， 测试 12 个全过。', 'MiniMax-M2', '3 分钟前']);
  assert.equal(c.children[2].children[1].tagName, 'TIME');
  assert.equal(c.style.left, '246px', '侧栏右边 238 + 8');
  assert.equal(c.style.top, '80px', '和这一行顶对齐');
  assert.equal(e.link('a').getAttribute('aria-describedby'), c.id, '读屏能从链接读到卡片');
  assert.equal(e.peek.open, true);
  e.hover('a');
  assert.deepEqual(e.tick(), [], '还在同一行里移动不重新计时');
  assert.ok(e.card());
});

test('内容：在跑的会话前面写「在跑」；没有消息写「还没有消息」（灰字、没有模型）；长摘要截到 160 字加省略号', () => {
  const e = env();
  e.hover('d'); e.tick();
  assert.deepEqual(e.texts(), ['在跑的会话', '正在跑测试', '在跑', 'MiniMax-M2', '刚刚']);
  e.hover('b'); e.tick();
  assert.equal(e.body.querySelectorAll('.pk-mpeek').length, 1, '换行时只留一张');
  const [title, text, ...meta] = e.texts();
  assert.equal(title, '空会话');
  assert.equal(text, '还没有消息');
  assert.ok(e.card().children[1].has('is-empty'));
  assert.equal(e.card().querySelector('.pk-mpeek__model'), null);
  assert.equal(meta.length, 1, '只有时间');
  e.hover('c'); e.tick();
  const long = e.texts()[1];
  assert.equal(long.length, 160);
  assert.ok(long.endsWith('…'));
  assert.equal(e.texts()[2], 'glm-4.6', '没有厂商前缀的模型名原样');
});

test('收起：移开（含没到时间就移开）、按下、滚动、改窗口大小、窗口失焦、切出 Metre 都收；收起时拿掉 aria-describedby', () => {
  const e = env();
  e.hover('a'); e.hover(null);
  assert.deepEqual(e.tick(), [], '没到时间就移开：延时取消，不会再弹');
  assert.equal(e.card(), null);
  for (const [what, act] of [
    ['移开', () => e.hover(null)],
    ['按下', () => e.fire('pointerdown', {target: e.link('a')})],
    ['滚动', () => e.fire('scroll', {target: e.aside})],
    ['改窗口大小', () => e.fire('resize')],
    ['窗口失焦', () => e.fire('blur')],
    ['切模式', () => e.fire('laolao:modechange')],
  ]) {
    e.hover(null); e.hover('a'); e.tick();
    assert.ok(e.card(), what + '：先弹出来');
    act();
    assert.equal(e.card(), null, what + '就收起');
    assert.equal(e.link('a').getAttribute('aria-describedby'), null, what + '：aria-describedby 拿掉');
    assert.equal(e.peek.open, false);
  }
});

test('键盘：Tab 到会话链接（:focus-visible）同样延迟弹出；鼠标点出来的焦点不弹；焦点离开收起；焦点还在时指针移开不收', () => {
  const e = env();
  e.focus('b', false);
  assert.deepEqual(e.tick(), [], '不是 focus-visible 不弹');
  e.focus('a');
  assert.deepEqual(e.tick(), [450]);
  assert.equal(e.texts()[0], '修登录页按钮');
  assert.equal(e.link('a').getAttribute('aria-describedby'), e.card().id);
  e.hover('a'); e.hover(null);
  assert.ok(e.card(), '焦点还在这一行：指针移开不收');
  e.focus(null);
  assert.equal(e.card(), null, '焦点离开就收');
});

test('Esc：焦点在这一行时收卡片并吃掉这次按键（不连带收抽屉）；只是指针悬停时收卡片但照常往下传；没有卡片时不管', () => {
  const e = env();
  assert.equal(e.fire('keydown', {key: 'Escape'}).defaultPrevented, false, '没有卡片：不管');
  e.hover('a'); e.tick();
  const passed = e.fire('keydown', {key: 'Escape'});
  assert.equal(e.card(), null, '悬停时 Esc 收卡片');
  assert.equal(passed.defaultPrevented, false, '悬停时不挡「Esc 停止」');
  assert.equal(passed.stopped, false);
  e.hover(null); e.focus('c'); e.tick();
  assert.ok(e.card());
  const eaten = e.fire('keydown', {key: 'Escape'});
  assert.equal(e.card(), null);
  assert.equal(eaten.defaultPrevented, true, '焦点在这一行：这次 Esc 只收卡片');
  assert.equal(eaten.stopped, true);
  e.focus('d');
  assert.equal(e.fire('keydown', {key: 'Escape', isComposing: true}).defaultPrevented, false, '输入法组字时不管');
  assert.deepEqual(e.tick(), [450], '组字时的 Esc 没取消弹出');
});

test('列表重画（整组行换成新节点）：指针还在同一会话上就跟到新行；指针不在了就收起；还在计时的也跟过去', () => {
  const e = env();
  e.hover('a'); e.tick();
  const before = e.card();
  e.rerender('a');
  assert.ok(e.card(), '跟到新行');
  assert.notEqual(e.card(), before, '按新行重新画了一张');
  assert.equal(e.body.querySelectorAll('.pk-mpeek').length, 1);
  assert.equal(e.link('a').getAttribute('aria-describedby'), e.card().id, '新行的链接挂上 aria-describedby');
  e.rerender(null);
  assert.equal(e.card(), null, '指针不在了就收');
  e.hover('b');
  e.rerender('b');
  assert.deepEqual(e.tick(), [450], '还在计时的：在新行上重新计时');
  assert.equal(e.texts()[0], '空会话');
});

test('侧栏收起 / 抽屉没拉出来（行看不见）不弹；窄窗口右边放不下时贴窗口右边；同一行名字的侧栏提示收掉、按钮提示不动', () => {
  const e = env();
  e.row('a').rect = {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0};
  e.hover('a'); e.tick();
  assert.equal(e.card(), null, '行看不见不弹');
  const n = env({width: 400});
  n.hover('a'); n.tick();
  assert.equal(n.card().style.left, '152px', '400 - 240 - 8');
  const t = env();
  const tip = t.mk('div', 'pinkie-sidebar-tooltip'); tip.textContent = '修登录页按钮'; t.body.append(tip);
  t.hover('a'); t.tick();
  assert.equal(tip.parent, null, '和卡片第一行重复的会话名提示收掉');
  const other = t.mk('div', 'pinkie-sidebar-tooltip'); other.textContent = '置顶'; t.body.append(other);
  t.hover('b'); t.tick();
  assert.equal(other.parent, t.body, '别的提示不动');
});

test('其他模式：悬停、聚焦、Esc、mark 都不加节点、不计时、不挂属性', () => {
  for (const mode of ['main', 'project', 'thinking', 'learning', 'unrestricted', null]) {
    const e = env({mode});
    if (mode === null) e.html.removeAttribute('data-laolao-mode');
    e.hover('a'); e.focus('b');
    e.peek.mark(null, new Map());
    e.flush();
    assert.deepEqual(e.tick(), [], `${mode}：不计时`);
    assert.equal(e.card(), null, `${mode}：不出卡片`);
    assert.equal(e.link('a').getAttribute('aria-describedby'), null);
    assert.equal(e.link('b').getAttribute('aria-describedby'), null);
    assert.equal(e.fire('keydown', {key: 'Escape'}).defaultPrevented, false, `${mode}：Esc 照常`);
    assert.deepEqual(e.body.children.map((c) => c.className), ['', 'sidebar'], `${mode}：body 下没多出节点`);
  }
  const e = env();
  e.hover('a'); e.tick();
  e.html.setAttribute('data-laolao-mode', 'project'); e.fire('laolao:modechange');
  assert.equal(e.card(), null, '从 Metre 切走时收掉');
  e.hover(null); e.hover('b');
  assert.deepEqual(e.tick(), [], '切走以后不再弹');
});

test('接线：列表 decorate 把行数据交给 peek；头片段、regions、例外文件都登记了；样式只在 Metre、不挡点击、没有 !important；脚本不发请求、不加观察器 / 循环定时器 / window.__ 名', () => {
  assert.match(LIST, /window\.PinkieMetreWorktree\?\.mark\(groups\); window\.Pinkie\?\.metrePeek\?\.mark\(groups, byKey\);/);
  const head = read('laolao-head.fragment.html');
  assert.match(head, /<script defer src="\/laolao-metre-worktree\.js\?v=@hash"><\/script>\r?\n<link rel="stylesheet" href="\/laolao-metre-peek\.css\?v=@hash">\r?\n<script defer src="\/laolao-metre-peek\.js\?v=@hash"><\/script>/);
  const metre = JSON.parse(read('regions.json')).regions.find((r) => r.id === 'metre');
  assert.ok(metre.files.includes('laolao-metre-peek.css') && metre.files.includes('laolao-metre-peek.js'));
  const ex = JSON.parse(fs.readFileSync(path.join(root, 'tools/health/exceptions.d/linux-L28.json'), 'utf8'));
  assert.deepEqual(ex.map((x) => [x.file, x.metric, x.add]), [['ui/injections/laolao-head.fragment.html', 'lines', 2], ['ui/injections/regions.json', 'lines', 2]]);
  const css = read('laolao-metre-peek.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /!\s*important/i);
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((s) => !/^(from|to)$/.test(s));
  assert.ok(selectors.length >= 8);
  for (const s of selectors) assert.match(s, /^html(\[data-pinkie-reduce-motion\])?\[data-laolao-mode="metre"\] \.pk-mpeek/, '每条规则都只在 Metre：' + s);
  assert.match(css, /html\[data-laolao-mode="metre"\] \.pk-mpeek \{[^}]*pointer-events: none;/, '卡片不接指针，不挡点击');
  const js = PEEK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(js, /setInterval|MutationObserver|ResizeObserver|IntersectionObserver|window\.__\w+\s*=/);
  assert.doesNotMatch(js, /gwRequest|fetch\(|XMLHttpRequest|WebSocket/, '只用侧栏已经拿到的行数据');
  assert.deepEqual([...js.matchAll(/window\.(\w+)\s*=(?!=)/g)].map((m) => m[1]), ['Pinkie'], '只挂在 window.Pinkie 下');
  assert.match(js, /ns\.metrePeek = Object\.freeze\(/);
  for (const f of ['laolao-metre-peek.js', 'laolao-metre-peek.css']) assert.ok(read(f).split('\n').length <= 1500, f);
});
