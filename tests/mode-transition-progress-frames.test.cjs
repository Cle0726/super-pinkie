// P6（重复代码合一，不改行为）：转场进度条 startWaitingProgress / finishProgressTracks 的行为锁。
// 两处都手写了一遍「把首帧写进 fill / fillSurface / litViewport / lit / tip 五个元素」，合成一个之前
// 先钉住：每个元素拿到首帧的哪一项、写在动画开始之前、lastNow 在动画之前取、finish 先取当前进度
// 再取消旧动画。直接取 ui/injections/laolao-mode-transition-fx.js 里真实的那一段放进 vm 跑，
// 合并前后这个文件里的用例都应该是绿的。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-mode-transition-fx.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};
const constLine = (name) => {
  const m = source.match(new RegExp(`const ${name} = [^;]+;`));
  assert.ok(m, `找不到 const ${name}`);
  return m[0];
};
const NAMES = ['fill', 'fillSurface', 'litViewport', 'lit', 'tip'];
const FINISH = Number(source.match(/const FINISH = (\d+)/)[1]);

function load({width = 200, height = 8, animate = true, computed = 'none'} = {}) {
  const log = [];
  const element = (name) => {
    const el = {name, style: {}, animations: []};
    let transform = '';
    Object.defineProperty(el.style, 'transform', {get: () => transform, set: (v) => { transform = v; log.push(`style ${name}`); }});
    if (animate) el.animate = (keyframes, options) => {
      log.push(`animate ${name}`);
      const a = {keyframes, options, cancel: () => log.push(`cancel ${name}`)};
      el.animations.push(a);
      return a;
    };
    return el;
  };
  const ui = Object.fromEntries(NAMES.map((n) => [n, element(n)]));
  ui.progress = {clientWidth: width, clientHeight: height};
  const root = {
    performance: {now: () => { log.push('now'); return 1000; }},
    getComputedStyle: (el) => { log.push(`computed ${el.name}`); return {transform: computed}; },
  };
  const code = `(() => {
    ${constLine('FINISH')} ${constLine('EXPECTED_WAIT')} ${constLine('clamp')} ${constLine('easeOutCubic')} ${constLine('lerp')}
    const COPY_IN = 300;
    let lastNow = 0, readyAt = Infinity, readyProgress = .72;
    ${between('const waitingProgress = ', 'const revealAt = ')}
    return {startWaitingProgress, finishProgressTracks,
      state: () => ({lastNow, readyProgress, compositorProgress, animations: progressAnimations.length})};
  })()`;
  const api = vm.runInNewContext(code, {ui, root, Math, Number}, {filename: 'laolao-mode-transition-fx.js'});
  return {...api, ui, log};
}

const firstFrame = (el) => el.animations.at(-1).keyframes[0].transform;
const kinds = (entries) => entries.map((e) => e.split(' ')[0]);
const targets = (entries) => entries.map((e) => e.split(' ')[1]);

test('等待进度：五个元素先写首帧，再取 lastNow，再按同样顺序起动画', () => {
  const fx = load();
  assert.equal(fx.startWaitingProgress(), true);
  assert.deepEqual(kinds(fx.log), [...NAMES.map(() => 'style'), 'now', ...NAMES.map(() => 'animate')], fx.log.join(' | '));
  assert.deepEqual(targets(fx.log.slice(0, 5)), NAMES);
  assert.deepEqual(targets(fx.log.slice(6)), NAMES);
  assert.match(fx.ui.fill.style.transform, /^scaleX\(/);
  assert.equal(fx.ui.litViewport.style.transform, fx.ui.fill.style.transform);
  assert.equal(fx.ui.lit.style.transform, fx.ui.fillSurface.style.transform);
  assert.match(fx.ui.tip.style.transform, /^translateX\(.+px\)$/);
  for (const n of NAMES) assert.equal(fx.ui[n].style.transform, firstFrame(fx.ui[n]), `${n} 的首帧和它动画的第 0 帧一致`);
  assert.deepEqual({...fx.state()}, {lastNow: 1000, readyProgress: .72, compositorProgress: .08, animations: 5});
  assert.equal(fx.ui.fill.animations[0].options.duration, 15_000);
});

test('等待进度：量不到宽度或不能 animate 时不写首帧，只记 lastNow', () => {
  for (const opts of [{width: 0}, {animate: false}]) {
    const fx = load(opts);
    assert.equal(fx.startWaitingProgress(), false);
    assert.deepEqual(fx.log, ['now']);
    assert.equal(fx.state().lastNow, 1000);
  }
});

test('走完：先读当前进度、取消旧动画，再写新首帧、起 FINISH 时长的动画，不再取 now', () => {
  const fx = load({computed: 'matrix(0.5, 0, 0, 1, 0, 0)'});
  fx.startWaitingProgress();
  const mark = fx.log.length;
  fx.finishProgressTracks();
  const tail = fx.log.slice(mark);
  assert.deepEqual(tail, ['computed fill', ...NAMES.map((n) => `cancel ${n}`), ...NAMES.map((n) => `style ${n}`), ...NAMES.map((n) => `animate ${n}`)], tail.join(' | '));
  const start = (0.5 - 8 / 200) / (1 - 8 / 200);
  const s = fx.state();
  assert.ok(Math.abs(s.readyProgress - start) < 1e-9 && Math.abs(s.compositorProgress - start) < 1e-9, JSON.stringify(s));
  assert.equal(s.lastNow, 1000);
  assert.equal(s.animations, 5);
  for (const n of NAMES) assert.equal(fx.ui[n].style.transform, firstFrame(fx.ui[n]));
  assert.equal(fx.ui.litViewport.style.transform, fx.ui.fill.style.transform);
  assert.equal(fx.ui.lit.style.transform, fx.ui.fillSurface.style.transform);
  assert.equal(fx.ui.fill.animations.at(-1).options.duration, FINISH);
});

test('走完：没有在跑的动画时什么都不做', () => {
  const fx = load();
  fx.finishProgressTracks();
  assert.deepEqual(fx.log, []);
});
