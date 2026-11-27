// #150 续做（mac2，#150 issuecomment-7183750963）：真实控制台页面 metre-board 320 宽时，「⋯」为躲开右下角的麦克风
// （button.chat-send-btn / #laolao-native-dictation）自己占一行、排到行首（data-dodge），却又落到输入框左下角浮着的托盘键
// button.pinkie-tray-btn（absolute，z-index 3，在 .agent-chat__composer-actions 里，约 [25,781,30,30]）底下：
// 「⋯」中心点下去是托盘键，点不开会话详情。改前 covered() 只认 button.chat-send-btn，看不见托盘键。
// 这里不开浏览器：用 tests/fixtures/mini-dom.cjs 的假 DOM，加一个很小的假排版（flex-wrap 一行行排、绝对定位的键按
// left / right / bottom 贴在输入框上，和 laolao-metre-skin.css 里托盘键 left 9 / bottom 49、发送键 right 10 / bottom 49 一样），
// 在 node:vm 里跑真的 ui/injections/laolao-metre-perm.js。elementFromPoint 用同一份排版算：绝对定位的键在按键行上面。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {FakeElement, createDocument} = require('./fixtures/mini-dom.cjs');
const SRC = fs.readFileSync(fileURLToPath(new URL('../ui/injections/laolao-metre-perm.js', import.meta.url)), 'utf8');
const SK = 'agent:metre:dashboard:t1';

// ---------- 给假 DOM 补上本批脚本用到、mini-dom 没有的几样（只在这个测试进程里） ----------
const camel = (n) => (n.startsWith('--') ? n : n.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
const STYLE = {setProperty(n, v) { this[camel(n)] = String(v); }, removeProperty(n) { delete this[camel(n)]; }};
Object.defineProperty(FakeElement.prototype, 'style', {configurable: true, get() { return this._style; }, set(v) { this._style = Object.assign(Object.create(STYLE), v); }});
Object.defineProperty(FakeElement.prototype, 'nextElementSibling', {configurable: true, get() {
  const s = this.parentElement?.children; return s ? s[s.indexOf(this) + 1] || null : null;
}});
Object.assign(FakeElement.prototype, {
  contains(n) { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; },
  after(node) { const p = this.parentElement; node.parentElement?.removeChild(node); p.children.splice(p.children.indexOf(this) + 1, 0, node); node.parentElement = p; node.isConnected = true; },
  before(node) { const p = this.parentElement; node.parentElement?.removeChild(node); p.children.splice(p.children.indexOf(this), 0, node); node.parentElement = p; node.isConnected = true; },
  replaceWith(node) {
    const p = this.parentElement; if (!p) return;
    if (node.parentElement) node.parentElement.removeChild(node);
    p.children.splice(p.children.indexOf(this), 1, node); node.parentElement = p; node.isConnected = true;
    this.parentElement = null; this.isConnected = false;
  },
  getBoundingClientRect() { return layout(current).get(this) || R(0, 0, 0, 0); },
});

// ---------- 假排版 ----------
const R = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top});
// 输入框左上角 (0, 600)；按键行在输入框里左边距 17、上面留 60 给输入区；一行高 30、行距 4；行下面到输入框底 45。
// 每个 .pk-eng-chip（Metre 键和本批的键）自带 margin-left 10px（laolao-metre-engine.css）。按键行 gap 4，本批键之间 gap 2。
const G = {left: 0, top: 600, padL: 17, padR: 12, head: 60, line: 30, step: 34, foot: 45, gap: 4, chipGap: 2, ml: 10};
const CHIP = {'pk-perm-chip--level': 44, 'pk-perm-chip--plan': 64, 'pk-perm-chip--go': 90};
const chipW = (k) => {
  for (const [c, w] of Object.entries(CHIP)) if (k.classList.contains(c)) return w;
  return k.querySelector('.pk-eng-chip__name')?.textContent === '⋯' ? 27 : 40;
};
let current = null;
function layout(w) {
  const rects = new Map();
  if (!w) return rects;
  const CW = w.width, cl = G.left + G.padL, ct = G.top + G.head;
  let x = 0, line = 0, count = 0;
  for (const c of w.controls.children) {
    if (c.style.display === 'none') continue;
    const box = c.classList.contains('pk-perm-chips');
    const ml = !box && c.classList.contains('pk-eng-chip') ? G.ml : 0;
    const keys = box ? c.children.filter((k) => k.classList.contains('pk-perm-chip')) : [];
    // 和真页面一样：按键这一截的 padding-left 不推动里面的键（#273 pr-shots run 45950069956：内联 padding-left 40px、「⋯」仍在 x=27），
    // 只有键自己的 margin-left 算数（第一个键 margin-left 50px 把「⋯」推到 x=67）
    const km = (k) => (k.style.marginLeft ? parseFloat(k.style.marginLeft) : G.ml);
    const inner = keys.reduce((s, k, i) => s + (i ? G.chipGap : 0) + km(k) + chipW(k), 0);
    const dodge = box && c.dataset.dodge != null;   // laolao-metre-perm.css：[data-dodge] { flex-basis: 100% }
    const outer = dodge ? CW : box ? inner : ml + c._w;
    if (count && (dodge || x + G.gap + outer > CW)) { line++; x = 0; count = 0; }
    if (count) x += G.gap;
    const top = ct + line * G.step;
    rects.set(c, R(cl + x + ml, top, outer - ml, G.line));
    if (box) {
      let kx = cl + x;
      keys.forEach((k, i) => {
        if (i) kx += G.chipGap;
        kx += km(k);
        const kw = chipW(k);
        rects.set(k, R(kx, top, kw, G.line));
        const name = k.querySelector('.pk-eng-chip__name'); if (name) rects.set(name, R(kx + 6, top + 7, kw - 12, 16));
        kx += kw;
      });
    }
    x += outer; count++;
    if (dodge) { line++; x = 0; count = 0; }
  }
  const lines = count ? line + 1 : Math.max(1, line);
  const input = R(G.left, G.top, CW + G.padL + G.padR, G.head + lines * G.step + G.foot);
  rects.set(w.input, input);
  // w.contents：和真页面主题一样，按键行是 display: contents（laolao-theme.css 5024–5027），自己没有盒子，量出来全是 0
  rects.set(w.controls, w.contents ? R(0, 0, 0, 0) : R(cl, ct, CW, lines * G.step - 4));
  for (const b of w.floats) {
    if (b.style.display === 'none' || !b.parentElement) continue;
    const a = b._anchor, left = a.left != null ? input.left + a.left : input.right - a.right - a.w;
    rects.set(b, R(left, input.bottom - a.bottom - a.h, a.w, a.h));
  }
  return rects;
}
const computed = (el) => ({
  position: el.style.position || 'static',
  display: el.style.display || (el.classList.contains('pk-perm-chips') ? 'inline-flex' : 'block'),
  visibility: el.style.visibility || 'visible',
  pointerEvents: el.style.pointerEvents || 'auto',
  marginLeft: el.classList.contains('pk-eng-chip') ? G.ml + 'px' : '0px',
});

// ---------- 页面：模型键、Metre 键（本批的键紧跟在它后面），输入框里浮着的键 ----------
function boot(width) {
  const document = createDocument();
  const mk = (tag, cls, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; parent?.append(n); return n; };
  document.documentElement.setAttribute('data-laolao-mode', 'metre');
  const main = mk('div', 'chat-main', document.body);
  mk('openclaw-chat-pane', '', main).state = {sessionKey: SK};
  const input = mk('div', 'agent-chat__input', main);
  const controls = mk('div', 'agent-chat__composer-controls', mk('div', 'agent-chat__composer-footer', input));
  mk('button', 'chat-composer-model-control', controls)._w = 150;
  mk('button', 'pk-eng-chip', controls)._w = 56;
  const actions = mk('div', 'agent-chat__composer-actions', input);
  const w = {document, input, controls, actions, width, floats: []};
  // 绝对定位、z-index 3，挂在输入框里，按 left / right / bottom 贴在输入框上（输入框长高了它跟着往下）
  w.float = (cls, anchor, id) => { const b = mk('button', cls, actions); if (id) b.id = id; b.style.position = 'absolute'; b.style.zIndex = '3'; b._anchor = anchor; w.floats.push(b); return b; };
  w.mic = () => w.float('chat-send-btn chat-send-btn--laolao-dictation', {right: 10, bottom: 49, w: 32, h: 32}, 'laolao-native-dictation');
  // 托盘键横向放在 mac2 实测的位置：「⋯」挪到行首 [27,772,27,…] 时托盘键 [25,781,30,30]，正好压住「⋯」中心
  w.tray = (cls = 'pinkie-tray-btn', wide = 30) => w.float(cls, {left: 25, bottom: 49, w: wide, h: 30});
  const sandbox = {
    document, console, innerWidth: width + 40, innerHeight: 900,
    getComputedStyle: computed,
    setTimeout: () => 0, clearTimeout() {},   // fitSoon / 额度 / 刷新的定时器都不跑：每一步自己调 fit()
    addEventListener() {}, removeEventListener() {},
    location: {href: 'http://127.0.0.1/?session=' + SK},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  current = w;
  vm.runInContext(SRC, sandbox, {filename: 'laolao-metre-perm.js'});
  w.api = sandbox.PinkieMetrePerm;
  w.api.paint(true);
  w.fit = (next) => { if (next != null) w.width = next; w.api.fit(); };
  return w;
}
// elementFromPoint：绝对定位的键（z-index 3）在按键行上面
function hit(w, x, y) {
  const rects = layout(w), inside = (r) => r && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  for (const b of w.floats) if (inside(rects.get(b))) return b;
  for (const k of w.controls.querySelectorAll('.pk-perm-chip')) if (inside(rects.get(k))) return k;
  return null;
}
function row(w) {
  const box = w.controls.querySelector(':scope > .pk-perm-chips'), stat = box.querySelector('.pk-perm-chip--stat');
  const r = stat.getBoundingClientRect(), c = w.controls.getBoundingClientRect(), center = [r.left + r.width / 2, r.top + r.height / 2];
  const top = hit(w, ...center);
  const under = w.floats.filter((b) => { const f = b.getBoundingClientRect(); return f.width && Math.min(r.right, f.right) - Math.max(r.left, f.left) > 1 && Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top) > 1; });
  // pad：让位距离（data-shift，加在第一个键的 margin-left 上）；boxPad：按键这一截的 padding-left，应当始终不用
  return {fold: box.dataset.fold, dodge: box.dataset.dodge ?? null, pad: box.dataset.shift ?? null, boxPad: box.style.paddingLeft || null, label: stat.querySelector('.pk-eng-chip__name').textContent,
    key: [r.left, r.top, r.width], lineStart: r.left - G.ml - c.left, ownLine: r.top > w.controls.children[1].getBoundingClientRect().top,
    keyHit: top === stat, top: top ? top.className : null, coveredBy: under.map((b) => b.className), center};
}
// 鼠标点在「⋯」中心：点到的是谁就是谁的 onclick（托盘键在这里没有 onclick，点到它就打不开详情）
function clickCenter(w, [x, y]) {
  const t = hit(w, x, y);
  t?.onclick?.({preventDefault() {}, stopPropagation() {}});
  return Boolean(w.document.body.querySelector('.pk-perm-pop--detail'));
}

test('只有麦克风（#150 反例）：「⋯」让到行首、不加让位距离、点得开详情，放宽后回原位', () => {
  const w = boot(1000);
  assert.equal(row(w).fold, '0');
  w.fit(262);
  const wrapped = row(w);
  assert.equal(wrapped.fold, '3', `收到「⋯」（${JSON.stringify(wrapped)}）`);
  assert.equal(wrapped.dodge, null, '没被盖住：不挪');
  w.mic(); w.fit();
  const r = row(w);
  assert.deepEqual([r.fold, r.label, r.dodge, r.pad], ['3', '⋯', '1', null], `自己占一行、排在行首，不加让位距离（${JSON.stringify(r)}）`);
  assert.equal(r.lineStart, 0, `排在行首（${JSON.stringify(r)}）`);
  assert.equal(r.keyHit, true, `「⋯」中心点下去是它自己（${JSON.stringify(r)}）`);
  assert.equal(clickCenter(w, r.center), true, '点「⋯」中心打开会话详情');
  w.fit(1000);
  const back = row(w);
  assert.deepEqual([back.fold, back.dodge, back.pad, back.keyHit], ['0', null, null, true], `放宽后回原位（${JSON.stringify(back)}）`);
});

for (const cls of ['pinkie-tray-btn', 'laolao-deep-think-btn']) {
  test(`真实页面 320 宽的样子：「⋯」让到行首后落在浮着的 ${cls} 底下，要接着让开，点得开详情，放宽后回原位`, () => {
    const w = boot(1000);
    w.tray(cls);
    assert.deepEqual([row(w).fold, row(w).keyHit], ['0', true], '宽的时候托盘键只压在行首的模型键上，本批的键不动');
    w.fit(262);
    const wrapped = row(w);
    assert.deepEqual([wrapped.fold, wrapped.dodge, wrapped.keyHit], ['3', null, true], `收到「⋯」、没被盖住：不挪（${JSON.stringify(wrapped)}）`);
    // 前提：托盘键浮在最后一行的行首，「⋯」挪到行首（自己占一行）就正好在它底下——不成立就测不到 mac2 的 bug
    const tray = w.floats[0].getBoundingClientRect(), c = w.controls.getBoundingClientRect();
    assert.ok(tray.left < c.left + G.ml + 27 && tray.right > c.left + G.ml, `前提：托盘键横向压在行首键的位置上（${JSON.stringify({tray, c})}）`);
    w.mic(); w.fit();
    const r = row(w);
    assert.deepEqual([r.fold, r.label, r.dodge], ['3', '⋯', '1'], `还是「⋯」、自己占一行（${JSON.stringify(r)}）`);
    assert.equal(r.ownLine, true, `「⋯」在 Metre 键下面一行（${JSON.stringify(r)}）`);
    // mac2 的现象：改前 keyHit / statHit 是 false（中心点下去是托盘键），点中心打不开详情
    assert.equal(r.keyHit, true, `「⋯」中心点下去是它自己，不是 ${cls}（${JSON.stringify(r)}）`);
    assert.equal(clickCenter(w, r.center), true, '点「⋯」中心打开会话详情');
    assert.deepEqual(r.coveredBy, [], `「⋯」没被任何浮着的键盖住（${JSON.stringify(r)}）`);
    // 放宽（托盘键、麦克风都还在）：回第 0 档原位，让位距离清掉
    w.fit(1000);
    const back = row(w);
    assert.deepEqual([back.fold, back.dodge, back.pad, back.keyHit], ['0', null, null, true], `放宽后回原位（${JSON.stringify(back)}）`);
  });
}

// #273 pr-shots run 45929551714（linux，320 宽）：真页面按键行是 display: contents，getBoundingClientRect() 全是 0，
// 改前 clearCover 拿 controls.right=0 当行宽，永远判「让不开」挪回原位：refit 后 dodge=null、「⋯」中心点下去是麦克风，点不开详情
test('按键行是 display: contents（没有盒子、量出来是 0）时：「⋯」让到行首后照样往右让过托盘键，点得开详情，放宽后回原位', () => {
  const w = boot(1000);
  w.contents = true;
  w.tray();
  w.fit(262);
  assert.equal(row(w).fold, '3');
  assert.equal(w.controls.getBoundingClientRect().width, 0, '前提：按键行量出来没有宽度');
  w.mic(); w.fit();
  const r = row(w);
  assert.deepEqual([r.fold, r.label, r.dodge], ['3', '⋯', '1'], `自己占一行、排在行首（${JSON.stringify(r)}）`);
  assert.ok(parseFloat(r.pad) > 0, `往右让过托盘键（${JSON.stringify(r)}）`);
  assert.equal(r.keyHit, true, `「⋯」中心点下去是它自己（${JSON.stringify(r)}）`);
  assert.deepEqual(r.coveredBy, [], `「⋯」没被任何浮着的键盖住（${JSON.stringify(r)}）`);
  assert.equal(clickCenter(w, r.center), true, '点「⋯」中心打开会话详情');
  w.fit(1000);
  const back = row(w);
  assert.deepEqual([back.fold, back.dodge, back.pad, back.keyHit], ['0', null, null, true], `放宽后回原位（${JSON.stringify(back)}）`);
});

test('行首浮着的键宽到这一行让不开：挪回原位，不留让位距离（不停在一个仍被盖住的地方）', () => {
  const w = boot(1000);
  w.fit(262);
  assert.equal(row(w).fold, '3');
  w.tray('pinkie-tray-btn', 250); w.mic(); w.fit();
  const r = row(w);
  assert.deepEqual([r.fold, r.dodge, r.pad], ['3', null, null], `让不开就挪回来（${JSON.stringify(r)}）`);
});
