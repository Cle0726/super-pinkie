// 热点 27（laolao-companion.js）复发锁：两处已上 main、此前没有自动化测试抓的修复。
//   5e0336da 聊天卡片一时没有绘制面积（隐藏、切换中）或画布已被摘下时，氛围画布不再报错、不再往 0×0 上画。
//   91b564b1 小碧琪随机一句的气泡保持小巧：尾巴短、字号固定 12px、描边不再无限旋转。
// 都直接取 ui/injections/laolao-companion.js 里的真实函数来跑，不改产品代码。
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

/* ── 氛围画布 ─────────────────────────────────────────────────────────── */

function ambientHarness(currentMode) {
  const frames = [];
  const observers = [];
  const contexts = [];
  let clock = 1000;
  let rect = {width: 0, height: 0};
  const classList = () => {
    const set = new Set();
    return {add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c)};
  };
  const makeCanvas = () => {
    const canvas = {width: 300, height: 150, parentElement: null, classList: classList(),
      remove() { this.parentElement = null; }};
    canvas.getContext = () => {
      const calls = [];
      const record = (name) => () => calls.push(name);
      const ctx = {calls, canvas, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1};
      for (const name of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill',
        'ellipse', 'quadraticCurveTo', 'translate', 'rotate']) ctx[name] = record(name);
      // 和浏览器一样：贴一张 0×0 的画布会抛 InvalidStateError。
      ctx.drawImage = (image) => {
        if (!image.width || !image.height) throw new Error('InvalidStateError: drawImage of a 0×0 canvas');
        calls.push('drawImage');
      };
      ctx.createLinearGradient = ctx.createRadialGradient = () => ({addColorStop() {}});
      contexts.push(ctx);
      return ctx;
    };
    return canvas;
  };
  const card = {
    getBoundingClientRect: () => ({...rect}),
    prepend(node) { node.parentElement = card; },
  };
  const root = {
    getAttribute: (name) => (name === 'data-laolao-mode' ? currentMode : null),
    hasAttribute: () => false,
  };
  const context = {
    Math, Number, String, Array, Map, Error,
    devicePixelRatio: 1,
    performance: {now: () => clock},
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    ResizeObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
    document: {
      hidden: false,
      documentElement: root,
      querySelector: (sel) => (sel === '.card.chat' ? card : null),
      getElementById: () => null,
      createElement: () => makeCanvas(),
      addEventListener() {},
    },
    window: {addEventListener() {}},
    prefs: {ambient: true},
    reduced: () => false,
    mode: () => currentMode,
    tuned: (key, fallback) => fallback,
    density: (n) => n,
    canvasRatio: (cap) => Math.min(cap, 1),
    el: () => makeCanvas(),
  };
  const ambient = vm.runInNewContext(`(() => { ${between('const ambient = (() => {', '\n  const beat = ')} return ambient; })()`, context);
  return {
    ambient,
    setRect(next) { rect = next; },
    resizeObservers: () => observers.forEach((o) => o.cb([])),
    runFrame() {
      clock += 50;
      for (const cb of frames.splice(0)) cb(clock);
    },
    main: () => contexts[0],
  };
}

test('a chat card with no draw area leaves the ambient canvas idle, then draws once it has size (5e0336da)', () => {
  // 项目模式会烘焙一层网格贴图；0×0 时若照样烘焙、照样每帧贴图，浏览器会抛 InvalidStateError。
  const h = ambientHarness('project');
  h.setRect({width: 0, height: 0});
  assert.doesNotThrow(() => h.ambient.sync());
  const ctx = h.main();
  assert.ok(ctx, '已经建好氛围画布');
  assert.equal(ctx.canvas.width, 0);
  assert.equal(ctx.canvas.height, 0);
  assert.doesNotThrow(() => { h.runFrame(); h.runFrame(); });
  assert.deepEqual(ctx.calls, [], '没有绘制面积时一笔都不画，也不贴烘焙层');

  h.setRect({width: 800, height: 400});
  h.resizeObservers();
  assert.equal(ctx.canvas.width, 800);
  assert.doesNotThrow(() => h.runFrame());
  assert.ok(ctx.calls.includes('clearRect'), '有了尺寸就恢复绘制');
  assert.ok(ctx.calls.includes('drawImage'), '网格烘焙层照常贴上');
});

test('a card resize after the ambient canvas was detached does not throw (5e0336da)', () => {
  const h = ambientHarness('chat');
  h.setRect({width: 640, height: 360});
  h.ambient.sync();
  const ctx = h.main();
  assert.equal(ctx.canvas.width, 640);
  // 聊天卡片重新渲染时把画布摘掉了，卡片的 ResizeObserver 仍会回调。
  ctx.canvas.parentElement = null;
  assert.doesNotThrow(() => h.resizeObservers());
  assert.equal(ctx.canvas.width, 640, '摘下的画布保持原样，等下一次 sync 重新挂回');
});

/* ── 随机一句的气泡 ───────────────────────────────────────────────────── */

const shapes = (() => {
  const context = {
    Math,
    figure: {getBoundingClientRect: () => ({left: 600, width: 100})},
    bubble: {getBoundingClientRect: () => ({left: 400})},
    reduced: () => false,
  };
  return vm.runInNewContext(`(() => { ${between('const M = 56', 'const NEXT_ICON')} return {SHAPE, drawShape}; })()`, context);
})();

// SVG 里最靠下的一点（路径端点与控制点、圆、椭圆、矩形），够判断尾巴拖多长。
const ARGS = {M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0};
function pathYs(d) {
  const ys = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  for (const [, cmd, body] of d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const upper = cmd.toUpperCase(), rel = cmd !== upper;
    const nums = (body.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (upper === 'Z') { x = startX; y = startY; continue; }
    const n = ARGS[upper];
    for (let i = 0; i + n <= nums.length; i += n) {
      const a = nums.slice(i, i + n);
      if (upper === 'H') { x = rel ? x + a[0] : a[0]; ys.push(y); continue; }
      if (upper === 'V') { y = rel ? y + a[0] : a[0]; ys.push(y); continue; }
      if (upper === 'A') { x = rel ? x + a[5] : a[5]; y = rel ? y + a[6] : a[6]; ys.push(y); continue; }
      for (let k = 1; k < n; k += 2) ys.push(rel ? y + a[k] : a[k]);
      x = rel ? x + a[n - 2] : a[n - 2]; y = rel ? y + a[n - 1] : a[n - 1];
      if (upper === 'M' && i === 0) { startX = x; startY = y; }
    }
  }
  return ys;
}
function lowestPoint(svg) {
  const ys = [];
  for (const [, d] of svg.matchAll(/\sd="([^"]+)"/g)) ys.push(...pathYs(d));
  for (const [, cy, r] of svg.matchAll(/<circle[^>]*\scy="([-\d.]+)"[^>]*\sr="([-\d.]+)"/g)) ys.push(+cy + +r);
  for (const [, cy, ry] of svg.matchAll(/<ellipse[^>]*\scy="([-\d.]+)"[^>]*\sry="([-\d.]+)"/g)) ys.push(+cy + +ry);
  for (const [, y0, hh] of svg.matchAll(/<rect[^>]*\sy="([-\d.]+)"[^>]*\sheight="([-\d.]+)"/g)) ys.push(+y0 + +hh);
  return Math.max(...ys);
}

const W = 240, H = 60;
const quoteCard = (m) => ({dataset: {m}, offsetWidth: W, offsetHeight: H, html: '',
  querySelector: () => null, insertAdjacentHTML(_, html) { this.html = html; }});

test('each mode keeps its quote-bubble tail short, still pointing at 小碧琪 (91b564b1)', () => {
  // 尾巴最多拖到气泡底边以下这么多（px）；改前是 43 / 18 / 33.5 / 18 / 24。
  const limit = {chat: 14, project: 12, thinking: 18, learning: 12, unrestricted: 12};
  assert.deepEqual(Object.keys(shapes.SHAPE).sort(), Object.keys(limit).sort(), '五个模式都有气泡外形');
  for (const [m, max] of Object.entries(limit)) {
    const tail = lowestPoint(shapes.SHAPE[m](W, H, 'pqT', 210)) - H;
    assert.ok(tail > 4, `${m} 气泡仍有朝向小碧琪的尾巴（${tail}）`);
    assert.ok(tail <= max, `${m} 气泡尾巴不把框撑大：${tail} > ${max}`);
  }
});

test('the quote-bubble outline no longer spins forever, even without reduced motion (91b564b1)', () => {
  for (const m of Object.keys(shapes.SHAPE)) {
    const card = quoteCard(m);
    shapes.drawShape(card);
    assert.match(card.html, /^<svg class="pq__shape"/, `${m} 画出了气泡外形`);
    assert.doesNotMatch(card.html, /<animate/, `${m} 描边不带无限循环的动画`);
  }
});

test('quote text uses one small fixed size whatever the line length (91b564b1)', () => {
  const speak = between('const speak = () => {', 'bubble.classList.add("is-quote")');
  assert.match(speak, /const n = chars\.length, fs = 12;/, '字号固定 12px，不比聊天正文大');
  assert.doesNotMatch(speak, /fs = n\s*</, '不再按句子长短放大字号');
  assert.match(speak, /--fs:\$\{fs\}px/);
});
