// 「以后」S 级 M8（ui2，11-24）：Metre 设置弹层里的「对话」卡片，自动滚动三档。
// 原生聊天设置齿轮在所有模式都被藏着（#31 用户要求），所以入口放在碧琪设置弹层里，只在 Metre 显示；
// 值归原生：只经对话面板 openclaw-chat-pane.state.applySettings 写（它会存 localStorage）。
// 浏览器实测：从侧栏进设置是 /settings/general，对话面板不在，设置页 openclaw-config-page 的 applySettings
// 只认主题 / 圆角 / 字号，写 chatAutoScroll 不存。所以设置页上点了先记「待生效」，回到对话页再交给原生。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SRC = read('ui/injections/laolao-metre-prefs.js');
const PENDING = 'pinkie.metre.prefs.pendingAutoScroll';
const plain = (o) => JSON.parse(JSON.stringify(o)); // vm 里造的对象原型不同，按内容比

// 极简假 DOM：只实现这个文件用到的部分。
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.hidden = false; this.textContent = ''; this.id = ''; this.listeners = {}; this.className = '';
    const self = this; this.classList = {toggle(c, on) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); (on ?? !s.has(c)) ? s.add(c) : s.delete(c); self.className = [...s].join(' '); }, contains: (c) => self.className.split(/\s+/).includes(c)}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  before(n) { const p = this.parent; const i = p.children.indexOf(this); n.parent = p; p.children.splice(i, 0, n); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  click() { for (const f of this.listeners.click || []) f({}); }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.isRoot === true; }
  closest(sel) { if (sel !== '[hidden]') throw new Error('unsupported ' + sel); for (let n = this; n; n = n.parent) if (n.hidden) return n; return null; }
  matches(sel) { return sel.startsWith('.') ? this.classList.contains(sel.slice(1)) : sel.startsWith('#') ? this.id === sel.slice(1) : this.tagName === sel.toUpperCase(); }
  all(sel, out = []) { for (const c of this.children) { if (c.matches(sel)) out.push(c); c.all(sel, out); } return out; }
  querySelector(sel) { return this.all(sel)[0] || null; }
}

function env({mode = 'metre', pane = true, config = false, stored = {}, settings = {chatAutoScroll: 'near-bottom', chatSendShortcut: 'enter', splitRatio: 0.6}} = {}) {
  const body = new El('body'); body.isRoot = true;
  const html = new El('html'); html.setAttribute('data-laolao-mode', mode);
  const vars = new Map();
  html.style = {setProperty: (k, v) => vars.set(k, String(v)), removeProperty: (k) => vars.delete(k), getPropertyValue: (k) => vars.get(k) ?? ''};
  const applied = [], configWrites = [];
  const paneEl = new El('openclaw-chat-pane');
  const mkPane = () => { paneEl.state = {settings: {...settings}, applySettings(next) { applied.push(next); this.settings = {...next}; }}; };
  if (pane) mkPane();
  // 设置页上的原生元素：applySettings 只认主题 / 圆角 / 字号（和真机一样），记下有没有人调它。
  const configEl = new El('openclaw-config-page');
  configEl.settings = {...settings}; configEl.applySettings = (next) => configWrites.push(next);
  const dialog = new El('div'); dialog.id = 'laolao-user-settings';
  const scroll = new El('div'); scroll.className = 'pinkie-user-settings__scroll';
  const other = new El('section'); other.className = 'pinkie-user-settings__card';
  const footer = new El('footer'); footer.className = 'pinkie-user-settings__footer';
  scroll.append(other, footer); dialog.append(scroll); body.append(dialog);
  const ls = new Map(Object.entries(stored));
  const localStorage = {getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k)};
  const winListeners = {}; const polls = [];
  const state = {pane, config};
  const document = {documentElement: html, readyState: 'complete', createElement: (t) => new El(t), addEventListener() {},
    querySelector(sel) { if (sel === 'openclaw-chat-pane') return state.pane ? paneEl : null; if (sel === 'openclaw-config-page') return state.config ? configEl : null; if (sel === '#laolao-user-settings .pinkie-user-settings__scroll') return null; return body.querySelector(sel); }};
  const window = {localStorage, addEventListener: (t, f) => (winListeners[t] ||= []).push(f), Pinkie: {domWatch: {poll: (f, ms) => polls.push([f, ms])}}};
  vm.runInNewContext(SRC, {window, document});
  const fire = (t, detail) => { for (const f of winListeners[t] || []) f({detail}); };
  fire('pinkie:settings-ready', scroll);
  const card = scroll.querySelector('.pk-metre-prefs');
  const all = card ? card.all('button') : [];
  const buttons = all.filter((b) => b.dataset.scroll);
  const btn = (key) => buttons.find((b) => b.dataset.scroll === key);
  const pressed = () => buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.scroll);
  // G2：字号 / 行距两组按钮。
  const look = (field) => all.filter((b) => b.dataset[field]);
  const lookBtn = (field, key) => look(field).find((b) => b.dataset[field] === key);
  const lookPressed = (field) => look(field).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset[field]);
  const tick = () => polls[0][0]();
  // 模拟「回到对话页」：设置页没了，对话面板回来。
  const backToChat = () => { state.config = false; state.pane = true; if (!paneEl.state) mkPane(); };
  return {vars, look, lookBtn, lookPressed, html, scroll, card, buttons, btn, pressed, applied, configWrites, paneEl, fire, polls, tick, ls, backToChat, note: () => card.querySelector('.pk-metre-prefs__note')};
}

test('Metre 设置弹层里有「对话」卡片，排在页脚前面，三档对应原生取值，默认选中原生当前值', () => {
  const e = env();
  assert.ok(e.card, '卡片挂进了设置弹层');
  assert.equal(e.scroll.children.at(-1).className, 'pinkie-user-settings__footer', '卡片在页脚前面');
  assert.equal(e.card.hidden, false);
  assert.deepEqual(e.buttons.map((b) => b.dataset.scroll), ['always', 'near-bottom', 'off']);
  assert.deepEqual(e.buttons.map((b) => b.textContent), ['始终', '接近底部时', '关闭']);
  assert.deepEqual(e.pressed(), ['near-bottom']);
  assert.equal(e.note().hidden, true);
});

test('对话面板在时：点「始终」直接经原生 applySettings 写回，只改 chatAutoScroll，其余设置原样带回', () => {
  const e = env();
  e.btn('always').click();
  assert.equal(e.applied.length, 1);
  assert.deepEqual(plain(e.applied[0]), {chatAutoScroll: 'always', chatSendShortcut: 'enter', splitRatio: 0.6});
  assert.deepEqual(e.pressed(), ['always']);
  assert.equal(e.ls.has(PENDING), false, '不留待生效');
  e.btn('always').click();
  assert.equal(e.applied.length, 1, '已经是这个值就不再写');
});

test('从侧栏进设置页（只有 openclaw-config-page）：点了先记待生效、显示选中和「回到对话页就生效」，不去写设置页那份', () => {
  const e = env({pane: false, config: true});
  assert.deepEqual(e.pressed(), ['near-bottom'], '设置页上读原生当前值');
  e.btn('off').click();
  assert.deepEqual(e.pressed(), ['off']);
  assert.equal(e.ls.get(PENDING), 'off');
  assert.equal(e.note().hidden, false);
  assert.equal(e.applied.length, 0);
  assert.equal(e.configWrites.length, 0, '设置页的 applySettings 不认 chatAutoScroll，不调它');
  e.btn('near-bottom').click();
  assert.equal(e.ls.has(PENDING), false, '点回原生当前值就撤销待生效');
  assert.equal(e.note().hidden, true);
});

test('回到对话页时把待生效交给原生（经对话面板 applySettings），然后清掉', () => {
  const e = env({pane: false, config: true});
  e.btn('always').click();
  e.backToChat();
  e.tick();
  assert.equal(e.applied.length, 1);
  assert.equal(e.applied[0].chatAutoScroll, 'always');
  assert.equal(e.ls.has(PENDING), false);
  e.tick();
  assert.equal(e.applied.length, 1, '只交一次');
});

test('重开页面时已有待生效、对话面板在：加载时就交给原生', () => {
  const e = env({stored: {[PENDING]: 'off'}});
  assert.equal(e.applied.length, 1);
  assert.equal(e.applied[0].chatAutoScroll, 'off');
  assert.equal(e.ls.has(PENDING), false);
  assert.deepEqual(e.pressed(), ['off']);
  const bad = env({stored: {[PENDING]: 'weird'}});
  assert.equal(bad.applied.length, 0, '认不得的值不交');
});

test('其他五个模式看不到这张卡片；切回 Metre 再出现', () => {
  for (const mode of ['main', 'project', 'thinking', 'learning', 'unrestricted']) {
    const e = env({mode});
    assert.equal(e.card.hidden, true, mode);
    e.html.setAttribute('data-laolao-mode', 'metre'); e.fire('laolao:modechange');
    assert.equal(e.card.hidden, false, mode + ' → metre');
  }
});

test('原生值不认识时按原生默认「接近底部时」显示；弹层开着时靠 domWatch.poll 跟上别处的改动', () => {
  const e = env({settings: {chatAutoScroll: 'weird'}});
  assert.deepEqual(e.pressed(), ['near-bottom']);
  assert.equal(e.polls.length, 1);
  e.paneEl.state.settings.chatAutoScroll = 'off';
  e.tick();
  assert.deepEqual(e.pressed(), ['off']);
});

test('健康度和接入：不新增观察器 / 定时器 / window.__ 全局；头片段加载、regions.json 登记；不把原生齿轮露回来', () => {
  assert.doesNotMatch(SRC, /new\s+MutationObserver|setInterval\s*\(|window\.__[A-Za-z]/);
  assert.match(read('ui/injections/laolao-head.fragment.html'), /<script defer src="\/laolao-metre-prefs\.js\?v=@hash"><\/script>/);
  const regions = JSON.parse(read('ui/injections/regions.json'));
  const list = Array.isArray(regions) ? regions : regions.regions;
  assert.ok(list.find((r) => r.id === 'metre').files.includes('laolao-metre-prefs.js'));
  assert.doesNotMatch(SRC, /chat-settings-popover-wrapper/);
  assert.match(read('ui/injections/laolao-ui-subtraction.css'), /\.agent-chat__input \.chat-settings-popover-wrapper \{ display: none !important; \}/, '#31 藏齿轮的规则还在');
});

// ---------- G2 字号 / 行距（只在 Metre，不动原生全局 textScale） ----------
const TEXT_KEY = 'pinkie.metre.prefs.textSize';
const LEAD_KEY = 'pinkie.metre.prefs.leading';

test('G2 默认「标准 / 标准」：不写任何变量，Metre 对话正文规则回落到原来的 15.5px / 1.7（默认档逐像素不变）', () => {
  const e = env();
  assert.deepEqual(e.look('text').map((b) => b.textContent), ['小', '标准', '大', '特大']);
  assert.deepEqual(e.look('leading').map((b) => b.textContent), ['紧凑', '标准', '宽松']);
  assert.deepEqual(e.lookPressed('text'), ['m']);
  assert.deepEqual(e.lookPressed('leading'), ['normal']);
  assert.equal(e.vars.size, 0);
  assert.match(read('ui/injections/laolao-metre-skin.css'), /\.chat-group \.chat-text :is\(p, li\) \{ font-size: var\(--metre-chat-fs, 15\.5px\) !important; line-height: var\(--metre-chat-lh, 1\.7\) !important; \}/);
});

test('G2 点「大」「宽松」：写变量并存本地；点回「标准」去掉变量和存的值', () => {
  const e = env();
  e.lookBtn('text', 'l').click();
  e.lookBtn('leading', 'loose').click();
  assert.equal(e.vars.get('--metre-chat-fs'), '17px');
  assert.equal(e.vars.get('--metre-chat-lh'), '1.9');
  assert.equal(e.ls.get(TEXT_KEY), 'l');
  assert.equal(e.ls.get(LEAD_KEY), 'loose');
  assert.deepEqual(e.lookPressed('text'), ['l']);
  assert.deepEqual(e.lookPressed('leading'), ['loose']);
  e.lookBtn('text', 'm').click();
  e.lookBtn('leading', 'normal').click();
  assert.equal(e.vars.size, 0);
  assert.equal(e.ls.has(TEXT_KEY), false);
  assert.equal(e.ls.has(LEAD_KEY), false);
  assert.equal(e.applied.length, 0, '字号 / 行距不经原生 applySettings');
});

test('G2 重开时按存的值套上；存了不认识的值按「标准」', () => {
  const e = env({stored: {[TEXT_KEY]: 'xl', [LEAD_KEY]: 'tight'}});
  assert.equal(e.vars.get('--metre-chat-fs'), '19px');
  assert.equal(e.vars.get('--metre-chat-lh'), '1.5');
  assert.deepEqual(e.lookPressed('text'), ['xl']);
  const w = env({stored: {[TEXT_KEY]: 'huge', [LEAD_KEY]: '3'}});
  assert.equal(w.vars.size, 0);
  assert.deepEqual(w.lookPressed('text'), ['m']);
  assert.deepEqual(w.lookPressed('leading'), ['normal']);
});

test('G2 只影响 Metre：变量只在 Metre 作用域的规则里被读；不写原生全局 textScale', () => {
  assert.doesNotMatch(SRC, /setTextScale|textScale\s*:|control-ui-text-scale/);
  const dir = path.join(root, 'ui/injections');
  for (const f of fs.readdirSync(dir).filter((n) => /\.(css|js)$/.test(n))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/--metre-chat-(fs|lh)/.test(text)) continue;
    assert.ok(f === 'laolao-metre-skin.css' || f === 'laolao-metre-prefs.js', `${f} 不该读 --metre-chat-*`);
    if (f.endsWith('.css')) for (const line of text.split('\n').filter((l) => /--metre-chat-(fs|lh)/.test(l))) assert.match(line, /^html\[data-laolao-mode="metre"\]/, line);
  }
});
