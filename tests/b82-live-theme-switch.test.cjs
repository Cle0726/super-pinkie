// B82 · 页面开着时系统深浅色一切换就实时同步：Metre 的过场、启动闪屏、像素猫只认 html[data-pinkie-night]
// （laolao-night.js 按保存的配色 + 系统外观算好再打上），不再自己读 prefers-color-scheme。
// 复发点：保存的是「浅色」、系统是深色时，过场和闪屏被系统外观带成深色；切换深浅色后空闲的猫要等到下次眨眼才换色。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INJ = 'ui/injections/';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function fakeCtx(fills) {
  const props = {};
  return new Proxy({}, {
    get(_, key) {
      if (key in props) return props[key];
      if (key === 'fillRect') return () => fills.push(props.fillStyle);
      if (key === 'createLinearGradient') return () => ({addColorStop() {}});
      return () => {};
    },
    set(_, key, value) { props[key] = value; return true; },
  });
}

function env({attrs = {}, systemDark = false} = {}) {
  const listeners = {}, timers = [], fills = [];
  const root = {
    getAttribute: (name) => attrs[name] ?? null, hasAttribute: (name) => name in attrs,
    setAttribute: (name, value) => { attrs[name] = String(value); }, dataset: {},
  };
  const element = (tag) => ({
    tag, style: {}, setAttribute() {}, append() {}, remove() {},
    getContext: tag === 'canvas' ? () => fakeCtx(fills) : undefined,
  });
  const window = {
    addEventListener: (name, fn) => (listeners[name] ??= []).push(fn), dispatchEvent() {},
    matchMedia: (query) => ({matches: systemDark && /prefers-color-scheme:\s*dark/.test(query)}),
    innerWidth: 1440, innerHeight: 820, devicePixelRatio: 1,
  };
  const document = {
    documentElement: root, hidden: false, readyState: 'complete', body: {append() {}},
    addEventListener: (name, fn) => (listeners['doc:' + name] ??= []).push(fn),
    querySelector: () => null, querySelectorAll: () => [], createElement: element,
  };
  let clock = 0;
  const ctx = {
    window, document, console, Date, Math, JSON, Map, Set, WeakMap, Promise, Error, Object, Event: class {}, CustomEvent: class {},
    performance: {now: () => (clock += 100)},
    requestAnimationFrame: (fn) => { Promise.resolve().then(() => fn(0)); return 1; },
    setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimeout() {}, setInterval: () => 0,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return {ctx, window, attrs, timers, listeners, fills};
}
const load = (e, files) => { for (const file of files) vm.runInContext(read(INJ + file), e.ctx, {filename: file}); return e; };

const LIGHT_BG = '#F7F6F3', DARK_BG = '#151514';

test('B82: Metre 过场的底色只跟 data-pinkie-night 走，保存浅色 + 系统深色时仍是浅色', async () => {
  const e = load(env({systemDark: true}), ['laolao-metre-transition.js']);
  await e.window.PinkieMetreTransition.leave().covered;
  assert.ok(e.fills.includes(LIGHT_BG), '没有 data-pinkie-night 时应画浅色谱纸');
  assert.ok(!e.fills.includes(DARK_BG), '不能被系统外观带成深色');

  e.attrs['data-pinkie-night'] = '';   // 页面开着时切到深色：下一次过场当场取色
  e.fills.length = 0;
  await e.window.PinkieMetreTransition.leave().covered;
  assert.ok(e.fills.includes(DARK_BG), '打上 data-pinkie-night 后应画深色谱纸');
  assert.ok(!e.fills.includes(LIGHT_BG));
});

test('B82: Metre 启动闪屏不靠 @media (prefers-color-scheme: dark) 上深色，只认 data-pinkie-night / data-theme', () => {
  const css = read(INJ + 'laolao-metre-brand.css');
  assert.match(css, /html\[data-laolao-splash-metre\]:is\(\[data-theme="dark"\], \[data-pinkie-night\]\) #laolao-splash \{[^}]*--sp-bg: #131315/,
    '深色闪屏仍由 data-pinkie-night 打开');
  for (const m of css.matchAll(/@media\s*\([^)]*prefers-color-scheme[^)]*\)\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    while (depth && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
    assert.doesNotMatch(css.slice(m.index, i), /#laolao-splash/, '保存浅色 + 系统深色时闪屏会被这段 @media 刷成深色');
  }
});

test('B82: Metre 的脚本和样式都不自己读系统外观（统一由 laolao-night.js 判定）', () => {
  const files = fs.readdirSync(path.join(ROOT, INJ)).filter((f) => /^laolao-metre-.*\.(?:js|css)$/.test(f));
  assert.ok(files.length > 5);
  for (const file of files) assert.doesNotMatch(read(INJ + file), /prefers-color-scheme/, file);
});

test('B82: 深浅色一切换，空闲的像素猫当场重画，不等下次眨眼', () => {
  const e = load(env(), ['laolao-metre-cat-frames.js', 'laolao-metre-cat.js']);
  assert.ok(e.listeners['pinkie:night']?.length, '猫要听 pinkie:night');
  e.listeners['pinkie:motion-change'][0]();   // 先排上一拍（空闲时是一个长定时器）
  const before = e.timers.length;
  for (const fn of e.listeners['pinkie:night']) fn({detail: true});
  const fresh = e.timers.slice(before);
  assert.ok(fresh.some((t) => t.ms === 0), '切换后要撤掉长定时器、立刻重画');
});
