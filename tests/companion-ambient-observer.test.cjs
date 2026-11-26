// P3 复发测试（laolao-companion.js 氛围画布）：画布每次重建都会给聊天卡片新挂一个 ResizeObserver，
// 旧的从不断开。聊天卡片重渲染摘掉画布几次，同一张卡上就叠几个观察器，尺寸一变 resize() 跑几遍；
// 换了一张卡片，旧卡片还被观察器拽着。修复后：任何时候只留一个连着的观察器，换卡时旧的先断开。
// 直接取 ui/injections/laolao-companion.js 里的真实 ambient 代码来跑，不改产品代码。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-companion.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};

function harness() {
  const observers = [];
  let rectCalls = 0;
  let latestCanvas = null;
  const makeCanvas = () => {
    const canvas = {width: 300, height: 150, parentElement: null,
      classList: {add() {}, remove() {}, contains: () => false},
      remove() { this.parentElement = null; }};
    canvas.getContext = () => {
      const ctx = {canvas, globalAlpha: 1};
      for (const name of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill',
        'ellipse', 'quadraticCurveTo', 'translate', 'rotate', 'drawImage']) ctx[name] = () => {};
      ctx.createLinearGradient = ctx.createRadialGradient = () => ({addColorStop() {}});
      return ctx;
    };
    return canvas;
  };
  const makeCard = () => {
    const card = {
      getBoundingClientRect: () => { rectCalls += 1; return {width: 640, height: 360}; },
      prepend(node) { node.parentElement = card; latestCanvas = node; },
    };
    return card;
  };
  let card = makeCard();
  const root = {getAttribute: name => (name === 'data-laolao-mode' ? 'chat' : null), hasAttribute: () => false};
  const context = {
    Math, Number, String, Array, Map, Error,
    devicePixelRatio: 1,
    performance: {now: () => 1000},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    // 和浏览器一样：disconnect() 之后不再回调。
    ResizeObserver: class {
      constructor(cb) { this.cb = cb; this.targets = new Set(); observers.push(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    },
    document: {
      hidden: false,
      documentElement: root,
      querySelector: sel => (sel === '.card.chat' ? card : null),
      getElementById: () => null,
      createElement: () => makeCanvas(),
      addEventListener() {},
    },
    window: {addEventListener() {}},
    prefs: {ambient: true},
    reduced: () => false,
    mode: () => 'chat',
    tuned: (key, fallback) => fallback,
    density: n => n,
    canvasRatio: cap => Math.min(cap, 1),
    el: () => makeCanvas(),
  };
  const ambient = vm.runInNewContext(`(() => { ${between('const ambient = (() => {', '\n  const beat = ')} return ambient; })()`, context);
  const live = () => observers.filter(o => o.targets.size > 0);
  return {
    ambient,
    live,
    get card() { return card; },
    // 聊天卡片重渲染把画布摘掉了
    detachCanvas() { latestCanvas.parentElement = null; },
    swapCard() { const old = card; card = makeCard(); return old; },
    // 卡片尺寸变一次：只回调还连着的观察器；数 resize() 读了几次卡片尺寸。
    fireResize() { rectCalls = 0; for (const o of live()) o.cb([]); return rectCalls; },
  };
}

test('画布反复被摘下重建，只留一个连着的尺寸观察器，尺寸变一次只 resize 一次', () => {
  const h = harness();
  h.ambient.sync();
  assert.equal(h.live().length, 1, '第一次挂上画布就有一个观察器');
  for (let i = 0; i < 5; i++) { h.detachCanvas(); h.ambient.sync(); }
  assert.equal(h.live().length, 1, '重建 5 次后仍只有一个观察器连着');
  assert.equal(h.fireResize(), 1, '卡片尺寸变一次，resize() 只跑一遍');
});

test('聊天卡片换了一张：旧卡片上的观察器断开，只盯新卡片', () => {
  const h = harness();
  h.ambient.sync();
  const oldCard = h.swapCard();
  h.ambient.sync();
  const live = h.live();
  assert.equal(live.length, 1, '只留一个观察器');
  assert.ok(live[0].targets.has(h.card), '盯的是新卡片');
  assert.ok(!live.some(o => o.targets.has(oldCard)), '旧卡片不再被观察器拽着');
});
