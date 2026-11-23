// C.le. 连笔动画：每种步骤都有形态、任意两个来回都连续、被打断不跳、状态行追得上进度
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import {ALPHA, STRIDE, buildSignature} from '../ui/injections/laolao-cle-kit.js';
import {CleInk, TIME} from '../ui/injections/laolao-cle-ink.js';
import {FORM_OF, formOf} from '../ui/injections/laolao-cle-forms.js';
import {createSteps, liveKind, RESULT, RUSH, HOLD} from '../ui/injections/laolao-cle-steps.js';

const read = (name) => fs.readFileSync(new URL('../ui/injections/' + name, import.meta.url), 'utf8');
const context = {window: {}};
vm.runInNewContext(read('laolao-cle-signature.js'), context);
const SIG = context.window.CleSignature;
const sig = buildSignature(SIG);
const COUNT = 300;          // 够看连续性，比 1100 颗快得多
const DT = 1 / 60;

function ink(count = COUNT) {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return new CleInk({SIG, sig, count, random});
}
const play = (engine, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) engine.step(DT); };
const settle = (engine, name) => { engine.set(name); play(engine, 2.2); };
const STEP_FORMS = ink().names.filter((name) => name !== 'idle' && name !== 'done');

test('状态行的每一种类别都有自己的去处，不再停在上一步的样子', () => {
  const verbs = /const VERB = \{([\s\S]*?)\};/.exec(read('laolao-cle-stage.js'))[1].replace(/\/\/.*$/gm, '');
  const kinds = new Set([...verbs.matchAll(/(\w+):/g)].map((m) => m[1]));
  assert.ok(kinds.size >= 41);
  const forms = new Set(ink().names);
  for (const kind of kinds) {
    assert.ok(Object.hasOwn(FORM_OF, kind), `no form for ${kind}`);
    assert.ok(forms.has(formOf(kind)), `missing form ${formOf(kind)}`);
  }
  for (const form of forms) assert.ok(Object.values(FORM_OF).includes(form), `${form} is unreachable`);
  assert.equal(formOf('something_new'), 'tool');
  assert.equal(formOf('constructor'), 'tool');
});

test('每个形态都画得出来：数值正常、留在画面里、循环中途不会整个消失', () => {
  for (const name of STEP_FORMS) {
    const engine = ink();
    settle(engine, name);
    for (let frame = 0; frame < 60 * 8; frame++) {
      engine.step(DT);
      let shown = 0;
      for (let i = 0; i < COUNT; i++) {
        const x = engine.position[i * 3], y = engine.position[i * 3 + 1], alpha = engine.look[i * 4 + 1];
        assert.ok(Number.isFinite(x + y + alpha + engine.look[i * 4] + engine.look[i * 4 + 2]), `${name}: bad number`);
        if (alpha <= .3) continue;
        shown++;
        // 原有的羽毛笔和炸开的 e 本来就会出画
        if (name !== 'write' && name !== 'edit' && name !== 'erase') assert.ok(Math.abs(x) < 5.65 && Math.abs(y) < 2.75, `${name}: out of frame ${x.toFixed(2)},${y.toFixed(2)}`);
      }
      if (name !== 'write') assert.ok(shown > COUNT * .12, `${name}: almost blank at frame ${frame}`);
    }
  }
});

test('任意两个形态来回：按时到达，每一帧都连续', () => {
  const problems = [];
  for (const from of STEP_FORMS) {
    for (const to of [...STEP_FORMS, 'idle', 'done']) {
      if (from === to) continue;
      const engine = ink(120);
      settle(engine, from);
      const before = engine.mixed.slice();
      engine.set(to);
      let last = before, worst = 0, arrived = Infinity;
      for (let t = DT; t < 1.4; t += DT) {
        engine.step(DT);
        for (let i = 0, o = 0; i < engine.count; i++, o += STRIDE) {
          const seen = Math.min(last[o + ALPHA], engine.mixed[o + ALPHA]);
          worst = Math.max(worst, Math.hypot(engine.mixed[o] - last[o], engine.mixed[o + 1] - last[o + 1]) * seen);
        }
        last = engine.mixed.slice();
        if (arrived === Infinity && engine.form === to && !engine.moving) arrived = t;
      }
      // 画布宽 214：一帧里任何看得见的粒子都不许挪超过 1/8 屏
      if (worst > 27) problems.push(`${from} → ${to}: jumped ${worst.toFixed(1)}`);
      if (arrived > 1.25) problems.push(`${from} → ${to}: arrived after ${arrived.toFixed(2)}s`);
    }
  }
  assert.deepEqual(problems, []);
});

test('平常的切换经过 C.le.，而且不比原来的 1.25 秒慢', () => {
  assert.ok(TIME.back + TIME.rest + TIME.out <= 1.25);
  const engine = ink();
  settle(engine, 'search');
  engine.set('git');
  assert.equal(engine.form, 'idle', '先收回签名');
  assert.equal(engine.goal, 'git');
  play(engine, TIME.back + TIME.rest + TIME.out + .05);
  assert.equal(engine.form, 'git');
  assert.equal(engine.moving, false);
});

test('很快的步骤、成功和失败直接变，不绕回签名', () => {
  let engine = ink();
  settle(engine, 'think');
  engine.set('memory');
  play(engine, .15);
  engine.set('memory', {quick: true});                  // 路上就做完了
  assert.equal(engine.form, 'memory');

  engine = ink();
  settle(engine, 'read');
  engine.set('search', {quick: true});
  assert.equal(engine.form, 'search');

  engine = ink();
  settle(engine, 'test');
  engine.set('fail');
  assert.equal(engine.form, 'fail');

  engine = ink();
  settle(engine, 'think');
  engine.set('exec');
  play(engine, .2);
  engine.set('web');                                     // 还在收回签名：只换去处
  assert.equal(engine.form, 'idle');
  assert.equal(engine.goal, 'web');
});

test('变到一半被打断：从当下的位置和速度接着走', () => {
  for (const [from, to, then] of [['think', 'search', 'git'], ['exec', 'web', 'fail'], ['git', 'plan', 'done'], ['wait', 'team', 'idle'], ['edit', 'tool', 'read']]) {
    for (const at of [.08, .2, .33, .46]) {
      const steady = ink(), cut = ink();
      for (const engine of [steady, cut]) {
        settle(engine, from);
        engine.set(to, {quick: true});
        play(engine, at);
      }
      cut.set(then, {quick: true});
      steady.step(DT); cut.step(DT);
      for (let i = 0; i < COUNT; i++) {
        const o = i * STRIDE;
        if (cut.mixed[o + ALPHA] < .1) continue;
        const gap = Math.hypot(cut.mixed[o] - steady.mixed[o], cut.mixed[o + 1] - steady.mixed[o + 1]);
        assert.ok(gap < 6, `${from} → ${to} ✕ ${then} @${at}: ${gap.toFixed(1)}`);
      }
    }
  }
});

test('连珠炮一样改主意，也只会停在最后一个', () => {
  const engine = ink();
  settle(engine, 'think');
  for (const name of ['read', 'search', 'exec', 'git', 'ok', 'plan', 'wait']) { engine.set(name); play(engine, .15); }
  play(engine, 1.3);
  assert.equal(engine.form, 'wait');
  assert.equal(engine.moving, false);
});

test('落款播完回到矢量签名，静止以后不再算帧', () => {
  const engine = ink();
  settle(engine, 'git');
  engine.set('done');
  play(engine, 6.9);                                     // cle-stage 的 DONE_HOLD
  assert.equal(engine.form, 'idle');
  assert.equal(engine.fx.paper, 1);
  assert.equal(engine.fx.alpha, 0);
  const still = engine.position.slice();
  play(engine, 1);
  assert.deepEqual(engine.position, still);
});

test('红色跟着墨走：失败的叉散开之前不会先变蓝', () => {
  const engine = ink();
  settle(engine, 'fail');
  assert.ok(engine.look[3] > .99);
  engine.set('exec', {quick: true});
  engine.step(DT);
  assert.ok(engine.look[3] > .95);
  play(engine, .7);
  assert.equal(engine.look[3], 0);
});

test('测试命令演「测试」，不认识的工具演「其他工具」', () => {
  for (const command of ['npm test', 'pnpm run test:unit', 'cd "C:/my app" && node --test tests', 'python -m pytest -q', 'CI=1 npx vitest', 'cargo test']) {
    assert.equal(liveKind('exec', 'exec', {command}), 'test', command);
  }
  for (const command of ['node a.js', 'npm run testimonials', 'echo npm test', 'git status', 'cat pytest.ini']) {
    assert.equal(liveKind('exec', 'exec', {command}), 'exec', command);
  }
  assert.equal(liveKind('exec', 'some_new_tool', {x: 1}), 'tool');
  assert.equal(liveKind('exec', 'bash', {}), 'exec');
  assert.equal(liveKind('read', 'some_reader', {}), 'read');
});

/* ── 状态行队列 ── */
function steps() {
  let t = 0, id = 0;
  const timers = new Map(), shown = [];
  const queue = createSteps((step) => shown.push({...step, at: t}), {
    now: () => t,
    later: (fn, ms) => { timers.set(++id, {fn, at: t + ms}); return id; },
    cancel: (key) => timers.delete(key),
  });
  function wait(ms) {
    const until = t + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
    }
    t = until;
  }
  return {queue, shown, wait, kinds: () => shown.map((step) => step.kind)};
}

test('队列：十个瞬间完成的工具不再播十四秒', () => {
  const {queue, shown, wait, kinds} = steps();
  for (let i = 0; i < 10; i++) {
    queue.start({id: 't' + i, kind: i % 2 ? 'read' : 'write', text: String(i)});
    queue.finish('t' + i, {ok: true});
  }
  wait(6000);
  assert.ok(shown.at(-1).at <= 3200, `drained at ${shown.at(-1).at}`);
  assert.equal(kinds().at(-1), 'think');
  assert.equal(shown.at(-2).text, '9', '最后一步一定播到');
});

test('队列：同类的合并，播最后一个', () => {
  const {queue, shown, wait} = steps();
  queue.start({id: 'first', kind: 'exec'});
  for (let i = 0; i < 5; i++) { queue.start({id: 'r' + i, kind: 'read', text: String(i)}); queue.finish('r' + i); }
  wait(5000);
  assert.deepEqual(shown.filter((step) => step.kind === 'read').map((step) => step.text), ['4']);
});

test('队列：失败不会被合并掉，先亮出来再往下走', () => {
  const {queue, wait, kinds} = steps();
  queue.start({id: 'a', kind: 'exec'});
  wait(200);
  queue.start({id: 'b', kind: 'read'});
  queue.finish('a', {failed: true});
  assert.equal(kinds().at(-1), 'fail');
  wait(RESULT - 10);
  assert.equal(kinds().at(-1), 'fail');
  wait(20);
  assert.equal(kinds().at(-1), 'read');

  const burst = steps();
  burst.queue.start({id: 'x', kind: 'exec'});
  for (let i = 0; i < 6; i++) { burst.queue.start({id: 'y' + i, kind: 'read'}); burst.queue.finish('y' + i, {failed: i === 1}); }
  burst.wait(6000);
  assert.ok(burst.kinds().includes('fail'));
});

test('队列：并行时已经让位的那一步失败了，仍要补演', () => {
  const {queue, wait, kinds} = steps();
  queue.start({id: 'slow', kind: 'exec'});
  queue.start({id: 'fast', kind: 'read'});
  wait(RUSH + 50);
  assert.equal(kinds().at(-1), 'read');
  queue.finish('slow', {failed: true});
  queue.finish('fast', {ok: true});
  wait(HOLD);
  assert.ok(kinds().includes('fail'));
});

test('队列：成功只给结果要紧的步骤，而且要有明确的 isError:false', () => {
  for (const [kind, result, expected] of [['test', {ok: true}, true], ['read', {ok: true}, false], ['test', {}, false]]) {
    const {queue, wait, kinds} = steps();
    queue.start({id: 'a', kind});
    wait(2000);
    queue.finish('a', result);
    wait(RESULT + 100);
    assert.equal(kinds().includes('ok'), expected, `${kind} ${JSON.stringify(result)}`);
  }
});

test('队列：等审批、并行时被顶下去的工具还在跑，就回到它', () => {
  const {queue, wait, kinds} = steps();
  queue.start({id: 'run', kind: 'exec'});
  wait(1500);
  queue.start({id: 'approval', kind: 'ask'});
  assert.equal(kinds().at(-1), 'ask');
  queue.finish('approval');
  wait(HOLD + 10);
  assert.equal(kinds().at(-1), 'exec');
  queue.finish('run');
  wait(HOLD + 10);
  assert.equal(kinds().at(-1), 'think');
});

test('队列：瞬间完成的单个工具让动画直接变过去', () => {
  const {queue, shown, wait} = steps();
  queue.start({id: 'a', kind: 'read'});
  assert.equal(shown.at(-1).quick, false);
  wait(40);
  queue.finish('a', {ok: true});
  assert.equal(shown.at(-1).quick, true);
  assert.equal(shown.at(-1).kind, 'read');
});

test('队列：还在跑的一直停着，重复的开始事件只算一次', () => {
  const {queue, wait, kinds} = steps();
  queue.start({id: 'a', kind: 'exec'});
  queue.start({id: 'a', kind: 'exec'});
  wait(HOLD * 4);
  assert.deepEqual(kinds(), ['exec']);
  assert.equal(queue.waiting, 0);
});
