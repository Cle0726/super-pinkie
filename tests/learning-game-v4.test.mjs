// v4（11-13，Windows 侧）：扭蛋每档里形态只占一小份、首次十连保底一个 SR 形态、备考目标（多场考试 + 节奏）、四类特效常驻上架。
import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import * as E from '../services/mode-architecture/learning-game-economy.mjs';
import {examPace, registerLearningGame} from '../services/mode-architecture/learning-game.mjs';

const sum = list => list.reduce((n, x) => n + x.w, 0);

test('扭蛋奖池：每一档权重加起来是 1，形态只占 formShare 那一份，SSR 只有形态', () => {
  const eco = E.loadEconomy();
  for (const id of ['star', 'seal']) {
    const pools = E.gachaPools(id);
    for (const [tier, list] of Object.entries(pools)) {
      if (!list.length) continue;
      assert.ok(Math.abs(sum(list) - 1) < 1e-9, `${id} ${tier} 权重和 ${sum(list)}`);
      const forms = sum(list.filter(x => x.kind === 'form'));
      if (tier === 'SSR') assert.equal(forms, 1);
      else if (eco.gacha[id].formShare?.[tier] != null && list.some(x => x.kind === 'form')) assert.ok(Math.abs(forms - eco.gacha[id].formShare[tier]) < 1e-9, `${id} ${tier} 形态占 ${forms}`);
    }
  }
  assert.ok(E.gachaPools('star').SR.some(x => x.kind === 'ult') && E.gachaPools('star').R.some(x => x.kind === 'hit'), '小件按种类归档');
});

test('扭蛋：十连里的形态平均不到 1 个（以前 R / SR 档只有形态，十连能出三五个）', () => {
  const rng = E.mulberry32(20261113);
  let forms = 0, most = 0; const N = 4000;
  let pity = {sr: 0, ssr: 0};
  for (let i = 0; i < N; i++) {
    const r = E.gachaPull('star', {pity, count: 10, rng}); pity = r.pity;
    const n = r.results.filter(x => x.kind === 'form').length; forms += n; most = Math.max(most, n);
    assert.ok(r.results.some(x => x.rarity === 'SR' || x.rarity === 'SSR'), '十连保底 SR+ 还在');
  }
  const avg = forms / N;
  assert.ok(avg > 0.3 && avg < 1, `十连平均 ${avg.toFixed(2)} 个形态`);
  assert.ok(most <= 4, `最多一次 ${most} 个`);
});

test('扭蛋：每个池第一次十连必出一个 SR 以上的形态；之后不保', t => {
  for (let seed = 0; seed < 30; seed++) {
    const {game} = gameFixture(t);
    game.mutate(s => { s.wallet.stars = 9000; });
    const first = game.pull({banner: 'star', count: 10, requestId: `first-${seed}`});
    assert.ok(first.results.some(r => r.kind === 'form' && ['SR', 'SSR'].includes(r.rarity)), `第 ${seed} 个存档的首次十连没有 SR 形态`);
  }
  const {game} = gameFixture(t);
  assert.equal(game.banners().find(b => b.id === 'star').firstTenForm, true);
  game.mutate(s => { s.wallet.stars = 9000; });
  game.pull({banner: 'star', count: 10, requestId: 'a'});
  assert.equal(game.banners().find(b => b.id === 'star').firstTenForm, false);
});

test('扭蛋出的碎片进钱包（不是「重复」）', t => {
  const {game} = gameFixture(t);
  game.mutate(s => { s.wallet.stars = 50000; });
  let shards = 0;
  for (let i = 0; i < 12; i++) { const r = game.pull({banner: 'star', count: 10, requestId: `s${i}`}); for (const x of r.results) if (x.kind === 'shards') { shards += x.shards; assert.equal(x.dup, false); } }
  assert.ok(shards > 0, '120 抽里应该有碎片');
  assert.ok(game.read().wallet.shards.any >= shards);
});

test('备考节奏：越近越紧，最后一周放松', () => {
  assert.deepEqual([examPace(200).phase, examPace(60).phase, examPace(30).phase, examPace(7).phase, examPace(0).phase, examPace(-3).phase, examPace(null).phase],
    ['far', 'build', 'sprint', 'final', 'day', 'after', 'unset']);
  assert.ok(examPace(20).sets > examPace(60).sets && examPace(5).sets < examPace(60).sets);
});

test('备考目标：日期以学习台填的为准，没填用预估日；可以加四级 / 六级；今日目标跟着阶段走', t => {
  const {game, pact} = gameFixture(t); // 时钟 2026-11-08
  let tg = game.state().targets;
  const b = tg.list.find(x => x.id === 'pretco-b');
  assert.equal(b.estimated, true); assert.equal(b.date, '2026-12-13'); assert.equal(b.phase, 'build');
  assert.equal(game.state().today.jar.goal, 2);
  assert.deepEqual(tg.addable.map(a => a.id).sort(), ['cet4', 'cet6']);
  // 用户把 B 级改到 20 天后 → 冲刺期，每天 3 组；Boss 倒计时、考前安静都跟着这一天
  game.setTarget({exam: 'pretco-b', date: '2026-11-28'});
  assert.equal(pact.get().exams.find(e => e.id === 'pretco-b').date, '2026-11-28', '写进学习台的 pact');
  const s = game.state();
  assert.equal(s.targets.list.find(x => x.id === 'pretco-b').estimated, false);
  assert.equal(s.targets.focus, 'pretco-b'); assert.equal(s.today.jar.goal, 3); assert.equal(s.boss.daysLeft, 20);
  assert.equal(game.quiet('2026-11-25'), true); assert.equal(game.quiet('2026-12-10'), false);
  // 加四级
  game.setTarget({exam: 'cet4', date: '2027-06-19'});
  tg = game.state().targets;
  assert.equal(tg.list.find(x => x.id === 'cet4').daysLeft, 223); assert.equal(tg.list.find(x => x.id === 'cet4').playable, false);
  assert.deepEqual(tg.addable.map(a => a.id), ['cet6']);
  assert.equal(tg.list[0].id, 'pretco-b', '最近的一场排第一');
  assert.throws(() => game.setTarget({exam: 'cet4', date: '明年六月'}), /日期/);
  assert.throws(() => game.setTarget({exam: 'x y', date: '2027-01-01'}), /代号/);
});

test('备考目标 RPC 注册了；四类特效都在常驻货架', async t => {
  const {game, store} = gameFixture(t);
  const methods = new Map();
  registerLearningGame({registerGatewayMethod: (name, fn) => methods.set(name, fn)}, store);
  assert.ok(methods.has('pinkie.learning.game.targets') && methods.has('pinkie.learning.game.target.set'));
  const kinds = new Set(game.shelves(game.read()).permanent.map(x => String(x.itemId || '').split(':')[0]));
  for (const k of ['hit', 'particles', 'ult', 'result']) assert.ok(kinds.has(k), `常驻货架缺 ${k}`);
});
