import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {WORLD_RULES, GUARD_RULES, REGIONS, validWorld, localWorld} from '../services/mode-architecture/learning-game-world.mjs';
import {SOLVE_RULES} from '../services/mode-architecture/learning-game-content.mjs';

const DAY = 86400000;
const modelWorld = () => ({regions: REGIONS.map(r => ({id: r.id, nodes: [
  {id: 'a', name: `${r.name}一`, summary: 's', deps: [], kind: 'lesson', lesson: {k: 'e1', i: 1}},
  {id: 'b', name: `${r.name}二`, summary: 's', deps: ['a'], kind: 'lesson', lesson: {k: 'e9', i: 0}},
  {id: 'c', name: `守关 · ${r.name}`, summary: 's', deps: ['a', 'b'], kind: 'guard'}]}))});
const guardItems = n => Array.from({length: n}, (_, i) => ({stem: `Q${i} ___`, options: [`a${i}`, `b${i}`, `c${i}`, `d${i}`], answer: 2, why: 'w', point: `点${i % 3}`}));
function model({world = modelWorld(), guard = guardItems(12)} = {}) {
  return async (rules, payload) => {
    if (rules === WORLD_RULES) return {value: world};
    if (rules === GUARD_RULES) return {value: {items: guard}};
    if (rules === SOLVE_RULES) return {value: {answer: 2, unique: true}};
    return {unavailable: true};
  };
}
const flush = () => new Promise(r => setTimeout(r, 20));

test('考点地图：模型生成 → 校验 → 缓存；校验修正越界课程考点；离线用本地兜底并标 local', async t => {
  const {game} = gameFixture(t);
  const offline = game.modules.world.world({});
  assert.equal(offline.source, 'local');
  assert.equal(offline.regions.length, 6);
  game.requestModel = model();
  const first = game.modules.world.world({});
  assert.equal(first.status, 'generating');
  await game.modules.world.generating.get('pretco-b');
  await flush();
  const w = game.modules.world.world({});
  assert.equal(w.source, 'model');
  assert.equal(w.status, 'ready');
  const node = w.regions[0].nodes[1];
  assert.deepEqual([node.refs.chapterId, node.refs.i], ['e1', 0], '模型给了不存在的 e9 → 回落到区域默认考点');
  assert.equal(w.regions[0].nodes[2].kind, 'guard');
  assert.ok(w.regions.every(r => r.nodes.every(n => n.state === 'fog')));
  assert.equal(validWorld({regions: []}), null);
});

test('节点：上课 → 已探索；节点一组 ≥80% → 点亮 +10；隔 3 天再过 → 金章 +20 +1🟡', async t => {
  const {game, pact, tick} = gameFixture(t);
  const w = game.modules.world.world({});
  const node = w.regions[1].nodes[0];
  const start = await game.modules.world.nodeStart({nodeId: node.id, mode: 'learn', requestId: 'n1'});
  assert.equal(start.flow, 'lesson');
  pact.recordLesson({lessonId: 'L1', minutes: 10, chapter: start.payload.k});
  assert.equal(game.modules.world.world({}).regions[1].nodes[0].state, 'explored');
  const d = await game.modules.world.nodeStart({nodeId: node.id, mode: 'drill', requestId: 'n2'});
  assert.equal(d.payload.scope.nodeId, node.id);
  const finishSet = sid => {
    game.onDrillSession({sessionId: sid, source: 'vocab', scope: d.payload.scope, items: []}, []);
    return game.onDrillFinish({session: {sessionId: sid, items: [], stats: {scored: 10, correct: 9}}, result: {}});
  };
  const a1 = finishSet('s1');
  assert.ok(a1.some(a => a.kind === 'node'));
  assert.equal(game.modules.world.world({}).regions[1].nodes[0].state, 'lit');
  tick(3.2 * DAY);
  const a2 = finishSet('s2');
  assert.ok(a2.some(a => a.kind === 'seals'));
  assert.equal(game.modules.world.world({}).regions[1].nodes[0].state, 'gold');
  assert.deepEqual(finishSet('s1'), [], '同一组重放不再发');
});

test('守关战：卷子不含答案；答错生成怪；通过首次 +30 +2🟡，重刷减半；requestId 幂等', async t => {
  const {game} = gameFixture(t);
  game.requestModel = model();
  const w = game.modules.world.world({});
  const guard = w.regions[2].nodes.find(n => n.kind === 'guard');
  const g = await game.modules.world.nodeStart({nodeId: guard.id, mode: 'guard', requestId: 'g1'});
  assert.deepEqual(await game.modules.world.nodeStart({nodeId: guard.id, mode: 'guard', requestId: 'g1'}), g);
  assert.equal(g.flow, 'guard');
  const text = JSON.stringify(g);
  assert.ok(!/"answer"|"why"/.test(text), '守关卷不带答案和解析');
  const items = g.payload.items;
  for (const [i, it] of items.entries()) game.modules.world.guardAnswer({attemptId: g.payload.attemptId, itemId: it.itemId, answer: i < 2 ? 0 : 2});
  const res = game.modules.world.guardFinish({attemptId: g.payload.attemptId});
  assert.equal(res.passed, true);
  assert.equal(res.awards.filter(a => a.kind === 'stars')[0].amount, 30);
  assert.equal(res.awards.find(a => a.kind === 'seals').amount, 2);
  assert.deepEqual(game.modules.world.guardFinish({attemptId: g.payload.attemptId}), res);
  assert.ok(game.modules.monsters.list({}).monsters.length >= 1, '守关答错生成怪');
  const g2 = await game.modules.world.nodeStart({nodeId: guard.id, mode: 'guard', requestId: 'g2'});
  for (const it of g2.payload.items) game.modules.world.guardAnswer({attemptId: g2.payload.attemptId, itemId: it.itemId, answer: 2});
  const res2 = game.modules.world.guardFinish({attemptId: g2.payload.attemptId});
  assert.equal(res2.perfect, true);
  assert.deepEqual(res2.awards.filter(a => a.kind !== 'node').map(a => [a.kind, a.amount]), [['stars', 25], ['seals', 1]], '重刷：⭐ 减半、金印只补满分差额');
});

test('本地兜底地图结构完整', () => {
  const w = localWorld();
  assert.equal(w.regions.length, 6);
  for (const r of w.regions) assert.equal(r.nodes.at(-1).kind, 'guard');
});
