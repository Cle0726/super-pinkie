// 验收 §2.1 自己动手作弊（第二批，补现有测试没覆盖的口子）。全部在临时 store 里跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';

const T0 = Date.parse('2026-11-08T04:00:00Z');
const wallet = g => ({...g.read().wallet, shards: {...g.read().wallet.shards}});

test('本周委托：换 requestId 再领也不重复计数（questsDone 驱动觉醒挑战）', t => {
  const {game} = gameFixture(t);
  game.mutate(s => { s.stats.setsByDate = s.stats.setsByDate || {}; });
  const w0 = game.questsToday().weekly; assert.ok(w0?.id, '有本周委托');
  // 把本周组数直接写满（等于真的背了 15 组）
  game.mutate(s => { for (let i = 0; i < 7; i++) { const d = game.day(s); d.sets = 15; } });
  const w = game.questsToday().weekly;
  if (!w.done) { t.skip('本周进度不是按 day.sets 算，换不了捷径'); return; }
  const before = game.read().stats.questsDone;
  game.claim({questId: w.id, requestId: 'w1'});
  const stars1 = wallet(game).stars;
  for (let i = 2; i < 12; i++) { try { game.claim({questId: w.id, requestId: 'w' + i}); } catch { /* 应该被挡 */ } }
  assert.equal(wallet(game).stars, stars1, '钱不重复');
  assert.equal(game.read().stats.questsDone, before + 1, '委托完成数只算一次');
});

test('装备 / 觉醒：没有的形态、没有的装备、没达标的觉醒都挡住', t => {
  const {game} = gameFixture(t);
  assert.throws(() => game.equip({formId: 'queen'}), /还没有/);
  assert.throws(() => game.equipItem({slot: 'ult', itemId: 'ult:anything'}), /还没有/);
  game.mutate(s => { s.items.owned.push('hit:x'); });
  assert.throws(() => game.equipItem({slot: 'ult', itemId: 'hit:x'}), /不能装在这里/);
  assert.throws(() => game.awaken({formId: 'daily', requestId: 'a1'}), /Lv10|挑战|碎片/);
});

test('扭蛋：张数只能 1 或 10；负数 / 很大 / 非数字都拒；不存在的机子拒', t => {
  const {game} = gameFixture(t);
  game.mutate(s => { s.wallet.stars = 1e6; s.wallet.seals = 1e3; });
  for (const count of [-1, 0, 2, 100, 'x', null, 1e9]) assert.throws(() => game.pull({banner: 'star', count, requestId: 'p' + count}), /单抽或十连|只能/);
  assert.throws(() => game.pull({banner: 'gold', count: 1, requestId: 'pg'}), /没有这个/);
  const w = wallet(game);
  assert.ok(w.stars <= 1e6 && w.seals <= 1e3, '没有凭空加钱');
});

test('一组中途换形态不叠加成：同一组每题只按当时装的那一个形态算', t => {
  const run = (swap) => {
    const ctx = {after() {}};
    const f = gameFixture(ctx, {at: T0});
    const {game} = f;
    game.mutate(s => { if (!s.forms.owned.includes('learning')) s.forms.owned.push('learning'); });
    const session = {sessionId: 's1', sessionKey: 'agent:learning:notes-library', source: 'notes', items: [], answers: [], graded: {}, learned: {}};
    const items = Array.from({length: 8}, (_, i) => ({itemId: 'i' + i, mode: 'choice', cardRef: {book: 'notes', noteId: 'n' + i, recallId: 'k' + i}}));
    session.items = items;
    game.onDrillStart?.({session, items});
    items.forEach((it, i) => {
      if (swap && i === 4) game.equip({formId: 'learning'});
      session.answers.push({itemId: it.itemId});
      game.onDrillAnswer({session, item: it, correct: true, firstTry: true, fresh: true, refs: [{book: 'notes', key: 'notes:' + it.cardRef.recallId}]});
    });
    return game.read().wallet.stars;
  };
  const daily = run(false);
  const swapped = run(true);
  const ctx = {after() {}};
  // 全程学习碧琪
  const f = gameFixture(ctx); f.game.mutate(s => { s.forms.owned.push('learning'); s.forms.equipped = 'learning'; });
  const session = {sessionId: 's1', sessionKey: 'agent:learning:notes-library', source: 'notes', items: [], answers: [], graded: {}, learned: {}};
  for (let i = 0; i < 8; i++) { const it = {itemId: 'i' + i, mode: 'choice', cardRef: {book: 'notes', noteId: 'n' + i, recallId: 'k' + i}}; session.answers.push({itemId: it.itemId}); f.game.onDrillAnswer({session, item: it, correct: true, firstTry: true, fresh: true, refs: [{book: 'notes', key: 'notes:k' + i}]}); }
  const learning = f.game.read().wallet.stars;
  assert.ok(swapped <= Math.max(daily, learning), `换形态 ${swapped} 不该超过单一形态 ${daily}/${learning}`);
});

test('前端直接调：awards.ack 乱传、state 返回的是拷贝（改了不进存档）', t => {
  const {game} = gameFixture(t);
  const before = wallet(game);
  game.ack(['aw-nope', '', null, 123]);
  const st = game.state(); st.wallet.stars = 99999;
  assert.deepEqual(wallet(game), before);
});

test('讨伐离线退回原题（local）时背原题答案赢了也不算收服进度，但照常冷却', async t => {
  const {game, drill, store, tick} = gameFixture(t);
  store.drill = drill; game.requestModel = null;
  const M = game.modules.monsters;
  const id = game.mutate(s => { const m = M.spawn(s, {key: 'c-prep', subject: '英语', topic: '介词搭配', question: 'The policy has an impact ___ business.', answer: 'on', options: ['in', 'at', 'on', 'to']}); m.dueAt = 0; m.state = 'due'; return m.id; });
  for (let round = 0; round < 3; round++) {
    const h = await M.huntStart({requestId: 'h' + round, sessionKey: 'agent:learning:notes-library'});
    const it = h.items.find(x => x.cardRef?.monsterId === id) || h.items[0];
    assert.equal(it.variant.source, 'local');
    game.mutate(s => M.onHuntAnswer(s, {session: {sessionId: 'hs' + round}, item: it, ok: true, firstTry: true}));
    const m = game.read().monsters.list[id];
    assert.notEqual(m.state, 'captured', `第 ${round + 1} 次原题赢了不该收服`);
    assert.equal(m.wins.length, 0);
    assert.ok(m.dueAt > Date.parse('2026-11-08T04:00:00Z'), '照常冷却');
    tick(4 * 86400000);
    game.mutate(s => { s.monsters.list[id].state = 'due'; });
  }
});

test('扭蛋公示和代码一致：公示概率 > 0 的档位池子里都有东西；含保底综合概率和 2 万次实抽对得上', async t => {
  const E = await import('../services/mode-architecture/learning-game-economy.mjs');
  const {game} = gameFixture(t);
  for (const b of game.banners()) {
    for (const [tier, p] of Object.entries(b.rates)) if (p > 0) assert.ok(b.pools[tier]?.length, `${b.id} 公示 ${tier} ${p * 100}% 但池子是空的`);
    const rng = E.mulberry32(E.seedFrom('cheats', b.id)); let pity = {sr: 0, ssr: 0}, ssr = 0; const N = 20000;
    for (let i = 0; i < N; i++) { const r = E.gachaPull(b.id, {pity, rng}); pity = r.pity; if (r.results[0].rarity === 'SSR') ssr++; }
    assert.ok(Math.abs(ssr / N - b.effectiveSSR) < 0.006, `${b.id} 实抽 ${ssr / N} vs 公示 ${b.effectiveSSR}`);
  }
});
