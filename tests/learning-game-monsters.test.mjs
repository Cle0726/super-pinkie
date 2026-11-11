import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {VARIANT_RULES, SOLVE_RULES, MONSTER_NAME_RULES} from '../services/mode-architecture/learning-game-content.mjs';

const DAY = 86400000;
const KEY = 'agent:learning:notes-library';
function fakeModel({solveWrong = false, same = false} = {}) {
  const calls = [];
  const fn = async (rules, payload) => {
    calls.push(rules);
    // 每次出的变体都不一样（真模型也会避开用过的题干；一直出同一道会被当成用过，退回原题）。
    if (rules === VARIANT_RULES) { const n = calls.filter(r => r === VARIANT_RULES).length; const who = same ? 'She' : ['She', 'He', 'My sister', 'Tom', 'Our teacher'][(n - 1) % 5]; return {value: {stem: `${who} ___ to school every day. (${payload.topic})`, options: ['go', 'goes', 'going', 'gone'], answer: 1, why: '三单', point: '一般现在时'}}; }
    if (rules === SOLVE_RULES) return {value: {answer: solveWrong ? 0 : 1, unique: true}};
    if (rules === MONSTER_NAME_RULES) return {value: {name: '一般现在时 · 迷糊史莱姆', blurb: '三单的 s 总被它偷走。'}};
    return {unavailable: true};
  };
  fn.calls = calls;
  return fn;
}
const wrongItem = (id, key) => ({itemId: id, mode: 'choice', subject: '英语', topic: '一般现在时', prompt: 'He ___ tea.', options: ['like', 'likes', 'liking', 'liked'], answer: 1,
  reveal: {question: 'He ___ tea.', answer: 'likes'}, cardRef: {book: 'notes', noteId: 'n', recallId: key}});

function bornWrong(game, sid, key) {
  const it = wrongItem('i1', key);
  const s = {sessionId: sid, sessionKey: KEY, source: 'notes', items: [it], answers: [{itemId: 'i1'}]};
  game.onDrillSession(s, [{key: `notes:${key}`, strength: 1}]);
  game.onDrillAnswer({session: s, item: it, correct: false, firstTry: true, fresh: true, refs: [{book: 'notes', key: `notes:${key}`}]});
}

test('背一背答错生成怪；同考点再错升级不重复刷怪', t => {
  const {game} = gameFixture(t);
  bornWrong(game, 's1', 'k1');
  bornWrong(game, 's2', 'k1');
  const list = game.modules.monsters.list({filter: 'active'}).monsters;
  assert.equal(list.length, 1);
  assert.equal(list[0].level, 2);
  assert.equal(list[0].state, 'lurking');
  assert.ok(['ink-slime', 'tangle-yarn', 'clock-beetle'].includes(list[0].species), list[0].species);
});

test('专升本 C 语言错题不进英语 B 级讨伐', t => {
  const {game, store} = gameFixture(t);
  store.allAttempts = () => [{id: 'att-c', createdAt: Date.now(), result: {correct: false}, question: {bankId: 'c5-117', id: 'zsb-c5-117', topic: '循环结构 · while / do-while / for', question: 'int i, sum = ____; for (i = 2; i <= 50; i += 2) { sum += i; }', correctAnswer: '0'}}];
  assert.equal(game.modules.monsters.list({filter: 'due'}).monsters.length, 0);
  assert.equal(game.modules.monsters.list({}).monsters.length, 0);
  assert.equal(game.modules.monsters.spawn(game.read(), {key: 'bank:c5-74', topic: 'C语言 · 循环结构', question: '关于 do-while 循环，正确的说法是'}), null);
});

test('刷题答错（作答记录）懒生成怪，按 attempt 幂等', t => {
  const {game, store} = gameFixture(t);
  store.allAttempts = () => [{id: 'att-1', createdAt: Date.now(), result: {correct: false}, question: {question: 'The book ___ on the desk.', options: ['is', 'are'], correctAnswer: 'is', subject: '英语', topic: '主谓一致'}}];
  assert.equal(game.modules.monsters.list({}).monsters.length, 1);
  assert.equal(game.modules.monsters.list({}).monsters.length, 1);
});

test('讨伐用模型新变体（不是原题），盲答复核通过；两次打赢隔 ≥3 天才收服；失败进化', async t => {
  const {game, drill, store, tick} = gameFixture(t);
  game.requestModel = fakeModel();
  store.drill = drill;
  bornWrong(game, 's1', 'k1');
  await assert.rejects(() => game.modules.monsters.huntStart({requestId: 'h0'}), /没有到期/);
  tick(1.1 * DAY);
  const h = await game.modules.monsters.huntStart({requestId: 'h1', sessionKey: KEY});
  assert.equal(h.source, 'hunt');
  assert.notEqual(h.items[0].prompt, 'He ___ tea.', '讨伐题不是原题');
  assert.equal(h.items[0].variant.verified, true);
  assert.deepEqual(await game.modules.monsters.huntStart({requestId: 'h1'}), h, 'requestId 幂等');
  const r1 = drill.answer({sessionId: h.sessionId, itemId: 'h1', correct: true});
  assert.ok(r1.game.awards.some(a => /讨伐/.test(a.reason)));
  const mid = game.modules.monsters.list({}).monsters[0];
  assert.equal(mid.wins, 1);
  assert.equal(mid.state, 'lurking');
  tick(3.1 * DAY);
  const h2 = await game.modules.monsters.huntStart({requestId: 'h2', sessionKey: KEY});
  assert.notEqual(h2.items[0].variant.source, 'local', '第二次也是新变体（原题赢了不算收服）');
  const r2 = drill.answer({sessionId: h2.sessionId, itemId: 'h1', correct: true});
  assert.ok(r2.game.awards.some(a => a.kind === 'capture'));
  assert.equal(game.modules.monsters.list({filter: 'captured'}).monsters.length, 1);
  assert.ok(game.read().wallet.shards.any >= 1);
});

test('盲答对不上（答案可能不唯一）就不用这道变体；离线时退回原题并标 local', async t => {
  const {game, drill, store, tick} = gameFixture(t);
  store.drill = drill;
  game.requestModel = fakeModel({solveWrong: true});
  bornWrong(game, 's1', 'k2');
  tick(1.1 * DAY);
  const h = await game.modules.monsters.huntStart({requestId: 'x1', sessionKey: KEY});
  assert.equal(h.items[0].variant.source, 'local');
  game.requestModel = null;
  const h2 = await game.modules.monsters.huntStart({requestId: 'x2', sessionKey: KEY});
  assert.equal(h2.items[0].variant.source, 'local');
});

test('讨伐失败：怪进化一级、明天再来', async t => {
  const {game, drill, store, tick} = gameFixture(t);
  store.drill = drill;
  game.requestModel = fakeModel();
  bornWrong(game, 's1', 'k3');
  tick(1.1 * DAY);
  const h = await game.modules.monsters.huntStart({requestId: 'f1', sessionKey: KEY});
  drill.answer({sessionId: h.sessionId, itemId: 'h1', correct: false});
  const m = game.modules.monsters.list({}).monsters[0];
  assert.equal(m.evolved, 1);
  assert.equal(m.level, 2);
  assert.equal(m.wins, 0);
});

test('错题怪一出生就在后台备好下一次讨伐的变体；讨伐时直接用、不现场等模型；用过的变体记下来不再出', async t => {
  const {game, drill, store, tick} = gameFixture(t);
  store.drill = drill;
  const model = fakeModel({same: true});
  game.requestModel = model;
  bornWrong(game, 's1', 'k9');
  await new Promise(r => setTimeout(r, 10));
  await game.modules.monsters.naming;
  await game.modules.monsters.preparing;
  const m = Object.values(game.read().monsters.list)[0];
  assert.ok(m.prepared?.stem, '后台备好了变体');
  assert.equal(m.prepared.verified, true);
  const before = model.calls.length;
  tick(1.1 * DAY);
  const h = await game.modules.monsters.huntStart({requestId: 'p1', sessionKey: KEY});
  assert.equal(model.calls.length, before, '讨伐开始时没有再调模型');
  assert.equal(h.items[0].variant.source, 'model');
  assert.equal(h.items[0].prompt, m.prepared.stem);
  const after = Object.values(game.read().monsters.list)[0];
  assert.equal(after.prepared, undefined, '用掉了');
  assert.deepEqual(after.usedStems, [m.prepared.stem]);
  // 同一道题干再出来会被拒（fakeModel 永远出同一道）→ 这一回合退回原题并标 local
  drill.answer({sessionId: h.sessionId, itemId: 'h1', correct: true});
  await new Promise(r => setTimeout(r, 10));
  await game.modules.monsters.preparing;
  tick(3.1 * DAY);
  const h2 = await game.modules.monsters.huntStart({requestId: 'p2', sessionKey: KEY});
  assert.equal(h2.items[0].variant.source, 'local');
});
