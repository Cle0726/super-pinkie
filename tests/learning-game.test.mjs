import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, calculateReviewSchedule} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';
import {LearningDrill} from '../services/mode-architecture/learning-drill.mjs';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {LearningGame, registerLearningGame, beijingDate, mondayOf, seasonOn, isQuiet} from '../services/mode-architecture/learning-game.mjs';

const KEY = 'agent:learning:notes-library';
const T0 = Date.parse('2026-11-08T04:00:00Z'); // 北京 12:00


const fakeApi = () => {
  const methods = new Map();
  return {methods, registerGatewayMethod: (name, fn, opts) => methods.set(name, {fn, opts})};
};
async function call(api, name, params = {}) {
  let out;
  await api.methods.get(`pinkie.learning.game.${name}`).fn({params: {sessionKey: KEY, ...params}, respond: (ok, value, error) => { out = ok ? {ok, value} : {ok, error}; }});
  return out;
}
const sess = (id, items) => ({sessionId: id, sessionKey: KEY, source: 'notes', items, answers: [], graded: {}, learned: {}});
const item = (id, key, mode = 'choice') => ({itemId: id, mode, cardRef: {book: 'notes', noteId: `n-${key}`, recallId: key}});
const refsOf = it => [{book: 'notes', key: `notes:${it.cardRef.recallId}`}];
function answer(game, session, it, correct = true, extra = {}) {
  session.answers.push({itemId: it.itemId});
  return game.onDrillAnswer({session, item: it, correct, firstTry: true, fresh: true, refs: refsOf(it), ...extra});
}

test('CONTRACT §2 每个方法都注册了，权限照背一背', async t => {
  const {store} = gameFixture(t);
  const api = fakeApi();
  registerLearningGame(api, store);
  const names = ['state', 'awards.pending', 'awards.ack', 'world', 'world.regenerate', 'node.start', 'guard.answer', 'guard.finish',
    'monsters.list', 'hunt.start', 'shop.catalog', 'shop.buy', 'gacha.banners', 'gacha.pull', 'forms.list', 'forms.equip', 'forms.awaken',
    'wishlist.set', 'items.equip', 'quests.today', 'quests.claim', 'chest.open', 'exam.papers', 'exam.generate', 'exam.start', 'exam.save',
    'exam.submit', 'exam.result', 'boss.state', 'boss.realScore', 'line'];
  for (const n of names) {
    assert.ok(api.methods.has(`pinkie.learning.game.${n}`), n);
    assert.equal(api.methods.get(`pinkie.learning.game.${n}`).opts.scope, 'operator.admin');
  }
  const st = await call(api, 'state');
  assert.ok(st.ok);
  for (const k of ['wallet', 'rank', 'form', 'today', 'boss', 'monsters', 'season', 'wishlist', 'quiet']) assert.ok(k in st.value, k);
  assert.equal(st.value.form.equipped, 'daily');
  assert.equal(st.value.season.term, 'lidong');
  const bad = await new Promise(resolve => api.methods.get('pinkie.learning.game.state').fn({params: {sessionKey: 'agent:main:x'}, respond: (ok, v, e) => resolve({ok, e})}));
  assert.equal(bad.ok, false);
  assert.equal(bad.e.code, 'INVALID_REQUEST');
});

test('同一题重放不重复发星，连击不涨；没到期且记牢的卡 0 星', t => {
  const {game} = gameFixture(t);
  const items = [item('i1', 'a'), item('i2', 'b'), item('i3', 'strong')];
  const s = sess('s1', items);
  game.onDrillSession(s, [{key: 'notes:a', due: true, strength: 2}, {key: 'notes:b', strength: 0}, {key: 'notes:strong', strength: 4, nextReviewAt: T0 + 5 * 86400000}]);
  const a1 = answer(game, s, items[0]);
  assert.equal(a1.filter(a => a.kind === 'stars').reduce((x, a) => x + a.amount, 0), 1);
  const replay = game.onDrillAnswer({session: s, item: items[0], correct: true, firstTry: true, fresh: false, refs: refsOf(items[0])});
  assert.equal(replay.length, 0, '重放（drill 那边 fresh=false）不发星');
  answer(game, s, items[1]);
  const strong = answer(game, s, items[2]);
  assert.equal(strong.filter(a => a.kind === 'stars' && a.reason === '答对了').length, 0, '没到期且记牢 → 0 星');
  assert.equal(game.read().drill.s1.combo, 3);
  assert.equal(game.read().wallet.stars, 2);
});

test('同一张卡同一个北京日只给一次答题星（换一组也不行）', t => {
  const {game} = gameFixture(t);
  const it = item('i1', 'a');
  for (const sid of ['s1', 's2']) {
    const s = sess(sid, [it]);
    game.onDrillSession(s, [{key: 'notes:a', due: true, strength: 1}]);
    answer(game, s, it);
  }
  assert.equal(game.read().wallet.stars, 1);
});

test('连击每满 5 +2，满 10 触发大招 +5', t => {
  const {game} = gameFixture(t);
  const items = Array.from({length: 10}, (_, i) => item(`i${i}`, `k${i}`));
  const s = sess('s1', items);
  game.onDrillSession(s, items.map(i => ({key: `notes:${i.cardRef.recallId}`, strength: 0})));
  const all = items.flatMap(it => answer(game, s, it));
  assert.equal(game.read().wallet.stars, 10 + 2 + 2 + 5);
  assert.ok(all.some(a => a.fx === 'cinematic'));
  assert.equal(game.read().stats.ults, 1);
});

test('一组做完：完成 +5、全对 +5、今日首组礼；finish 重放不重复', t => {
  const {game} = gameFixture(t);
  const s = {...sess('s1', []), stats: {scored: 6, correct: 6}};
  const first = game.onDrillFinish({session: s, result: {jar: {filledNow: true}, streak: {stampedToday: true, current: 7}}});
  const stars = first.filter(a => a.kind === 'stars').reduce((x, a) => x + a.amount, 0);
  assert.ok(stars >= 5 + 5 + 10 + 10 + 50, `got ${stars}`); // 完成 + 全对 + 日常首组礼 + 罐满 + 连续 7 天
  assert.ok(first.some(a => a.kind === 'seals'));
  assert.deepEqual(game.onDrillFinish({session: s, result: {jar: {filledNow: true}, streak: {stampedToday: true, current: 7}}}), []);
});

test('计分题 < 5 的一组没有完成奖', t => {
  const {game} = gameFixture(t);
  const out = game.onDrillFinish({session: {...sess('s1', []), stats: {scored: 4, correct: 4}}, result: {}});
  assert.equal(out.filter(a => a.reason === '这一组背完了').length, 0);
});

test('刷题 recordQuestion：同一 receipt 重放不重复发星；答错不发', t => {
  const {pact, game} = gameFixture(t);
  pact.recordQuestion({correct: true, receiptId: 'desk-1'});
  pact.recordQuestion({correct: true, receiptId: 'desk-1'});
  pact.recordQuestion({correct: false, receiptId: 'desk-2'});
  pact.recordQuestion({correct: true});
  pact.recordQuestion({correct: true});
  assert.equal(game.read().wallet.stars, 3);
});

test('课程 recordLesson：一节课只发一次 +15', t => {
  const {pact, game} = gameFixture(t);
  pact.recordLesson({lessonId: 'L1', minutes: 20});
  pact.recordLesson({lessonId: 'L1', minutes: 20});
  assert.equal(game.read().wallet.stars, 15);
});

test('商店：requestId 幂等、钱不够写清还差多少、买过的不能再买', t => {
  const {game} = gameFixture(t);
  assert.throws(() => game.buy({sku: 'form:learning', requestId: 'r1'}), /还差 1200 ⭐/);
  game.mutate(s => { s.wallet.stars = 2500; });
  const a = game.buy({sku: 'form:learning', requestId: 'r2'});
  const b = game.buy({sku: 'form:learning', requestId: 'r2'});
  assert.deepEqual(a, b);
  assert.equal(game.read().wallet.stars, 1300);
  assert.throws(() => game.buy({sku: 'form:learning', requestId: 'r3'}), /已经有/);
  assert.throws(() => game.buy({sku: 'form:queen', requestId: 'r4'}), /8 🟡/, 'SSR 在金印专柜，要金印');
  assert.throws(() => game.buy({sku: 'form:lidong'}), /requestId/);
});

test('立冬限定只在立冬上架；过季后用 30 万能碎片复刻', t => {
  const {game, setClock} = gameFixture(t);
  assert.ok(game.catalogView().shelves.limited.some(s => s.sku === 'form:lidong'));
  setClock(Date.parse('2026-11-22T01:00:00Z')); // 北京 11-22 09:00，小雪
  const cat = game.catalogView();
  assert.ok(!cat.shelves.limited.some(s => s.sku === 'form:lidong'));
  assert.ok(cat.shelves.limited.some(s => s.sku === 'form:xiaoxue'));
  assert.ok(cat.shelves.seal.some(s => s.sku === 'replica:lidong' && s.price.shards === 30));
});

test('扭蛋：requestId 幂等，结果可复现；保底计数持久化（重开进程还在）', t => {
  const {game, store} = gameFixture(t);
  game.mutate(s => { s.wallet.stars = 5000; });
  const a = game.pull({banner: 'star', count: 10, requestId: 'g1'});
  const b = game.pull({banner: 'star', count: 10, requestId: 'g1'});
  assert.deepEqual(a, b);
  assert.equal(game.read().wallet.stars, 5000 - 720, '第一次十连半价');
  assert.ok(a.results.some(r => ['SR', 'SSR'].includes(r.rarity)), '十连必出 SR+');
  game.pull({banner: 'star', count: 1, requestId: 'g2'});
  const again = new LearningGame(store, {now: () => T0});
  assert.equal(again.read().gacha.star.pulls, 11);
  assert.equal(again.banners().find(x => x.id === 'star').cost.ten.stars, 1440);
});

test('收藏品带中文名：扭蛋结果、奖池条目、state.items.names', t => {
  const {game} = gameFixture(t);
  game.mutate(s => { s.wallet.stars = 5000; });
  const cjk = /[\u4e00-\u9fff]/;
  for (const b of game.banners()) for (const list of Object.values(b.pools)) for (const e of list) assert.ok(cjk.test(e.name || ''), `${b.id} ${e.itemId} 没有中文名`);
  const r = game.pull({banner: 'star', count: 10, requestId: 'gn'});
  for (const x of r.results) assert.ok(cjk.test(x.name || ''), `${x.itemId} 没有中文名`);
  const st = game.state();
  assert.ok(st.items.owned.length > 0);
  for (const id of st.items.owned) assert.ok(cjk.test(st.items.names[id] || ''), `${id} 没有中文名`);
});

test('并发：同步读改写，两次快速购买不会花两份钱', t => {
  const {game} = gameFixture(t);
  game.mutate(s => { s.wallet.stars = 1300; });
  game.buy({sku: 'form:learning', requestId: 'x1'});
  assert.throws(() => game.buy({sku: 'form:chef', requestId: 'x2'}), /还差/);
  assert.equal(game.read().wallet.stars, 100);
});

test('形态加成只改奖励：装学习碧琪后学习关 +30%', t => {
  const {game, pact} = gameFixture(t);
  game.mutate(s => { s.forms.owned.push('learning'); });
  game.equip({formId: 'learning'});
  pact.recordLesson({lessonId: 'L9', minutes: 10});
  assert.equal(game.read().wallet.stars, 20);
  assert.throws(() => game.equip({formId: 'queen'}), /还没有/);
});

test('委托：目标从真实数据算、领取幂等、三个领完才能开宝箱', t => {
  const {game} = gameFixture(t);
  const q = game.questsToday();
  assert.equal(q.quests.length, 3);
  assert.throws(() => game.claim({questId: q.quests[0].id, requestId: 'c0'}), /还没完成/);
  game.mutate(s => { const d = game.day(s); d.correct = 50; d.sets = 3; d.lessons = 1; });
  const ids = game.questsToday().quests.map(x => x.id);
  const first = game.claim({questId: ids[0], requestId: 'c1'});
  assert.deepEqual(game.claim({questId: ids[0], requestId: 'c1'}), first);
  assert.throws(() => game.openChest({requestId: 'o0'}), /三个委托/);
  game.claim({questId: ids[1], requestId: 'c2'});
  game.claim({questId: ids[2], requestId: 'c3'});
  const chest = game.openChest({requestId: 'o1'});
  assert.equal(chest.awards.length, 1);
  assert.throws(() => game.openChest({requestId: 'o2'}), /开过/);
});

test('awards 队列：pending 返回、ack 后不再返回', t => {
  const {game, pact} = gameFixture(t);
  pact.recordQuestion({correct: true, receiptId: 'q1'});
  const {awards} = game.pendingAwards();
  assert.equal(awards.length, 1);
  assert.equal(awards[0].source.type, 'question');
  game.ack([awards[0].id]);
  assert.equal(game.pendingAwards().awards.length, 0);
});

test('数据只写 learning/game/；文件坏了用上一份好的，钱包不清零', t => {
  const {game, root} = gameFixture(t);
  game.mutate(s => { s.wallet.stars = 777; });
  game.mutate(s => { s.wallet.stars = 778; });
  const files = fs.readdirSync(path.join(root, 'game'));
  assert.ok(files.includes('game.json'));
  fs.writeFileSync(path.join(root, 'game', 'game.json'), '{坏掉');
  assert.equal(game.read().wallet.stars, 777, '从备份恢复');
  assert.ok(fs.readdirSync(path.join(root, 'game')).some(f => f.includes('corrupt')));
});

test('背一背真接线：讨伐题（book=hunt）答题返回 game.awards，不碰回忆卡', t => {
  const {drill, game} = gameFixture(t);
  const it = {itemId: 'h1', mode: 'choice', cardRef: {book: 'hunt', monsterId: 'm1'}};
  drill.save({sessionId: 'hunt-1', sessionKey: KEY, source: 'hunt', items: [it], graded: {}, learned: {}, answers: [], createdAt: T0});
  const r = drill.answer({sessionId: 'hunt-1', itemId: 'h1', correct: true});
  assert.ok(Array.isArray(r.game.awards));
  assert.equal(r.game.awards.filter(a => a.kind === 'stars').reduce((x, a) => x + a.amount, 0), 1);
  const again = drill.answer({sessionId: 'hunt-1', itemId: 'h1', correct: true});
  assert.equal(again.game.awards.length, 0);
  assert.equal(game.read().wallet.stars, 1);
});

test('游戏层坏了不影响背一背', t => {
  const {drill, store} = gameFixture(t);
  store.game = {onDrillAnswer() { throw new Error('boom'); }, onDrillSession() { throw new Error('boom'); }};
  const it = {itemId: 'h1', mode: 'choice', cardRef: {book: 'hunt', monsterId: 'm1'}};
  drill.save({sessionId: 'hunt-2', sessionKey: KEY, source: 'hunt', items: [it], graded: {}, learned: {}, answers: [], createdAt: T0});
  const r = drill.answer({sessionId: 'hunt-2', itemId: 'h1', correct: true});
  assert.deepEqual(r.game, {awards: []});
});

test('北京时间：太平洋时间深夜 = 北京第二天；周一、节气、考前安静', () => {
  // 2026-11-08 08:30 PST = 北京 11-09 00:30（周一）
  const t = Date.parse('2026-11-08T16:30:00Z');
  assert.equal(beijingDate(t), '2026-11-09');
  assert.equal(mondayOf('2026-11-09'), '2026-11-09');
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(seasonOn('2026-11-21').term, 'lidong');
  assert.equal(seasonOn('2026-11-22').term, 'xiaoxue');
  assert.equal(isQuiet('2026-12-05'), false);
  assert.equal(isQuiet('2026-12-06'), true);
  assert.equal(isQuiet('2026-12-13'), true);
  assert.equal(isQuiet('2026-12-14'), false);
});

test('跨北京 00:00：同一张卡第二天又能给星', t => {
  const {game, setClock} = gameFixture(t, {at: Date.parse('2026-11-08T15:50:00Z')}); // 北京 23:50
  const it = item('i1', 'a');
  const s1 = sess('s1', [it]);
  game.onDrillSession(s1, [{key: 'notes:a', strength: 0}]);
  answer(game, s1, it);
  setClock(Date.parse('2026-11-08T16:10:00Z')); // 北京次日 00:10
  const s2 = sess('s2', [it]);
  game.onDrillSession(s2, [{key: 'notes:a', strength: 0}]);
  answer(game, s2, it);
  assert.equal(game.read().wallet.stars, 2);
});

test('game.state 带 items:{owned, equipped}（衣橱 / 战斗层用），是拷贝不是引用', t => {
  const {game} = gameFixture(t);
  assert.deepEqual(game.state().items, {owned: [], equipped: {}, names: {}});
  const item = game.catalog.items.find(i => /^ult:/.test(i.id));
  game.mutate(s => { s.items.owned.push(item.id); });
  game.equipItem({slot: 'ult', itemId: item.id});
  const st = game.state();
  assert.deepEqual(st.items, {owned: [item.id], equipped: {ult: item.id}, names: {[item.id]: item.name}});
  st.items.owned.push('x');
  assert.deepEqual(game.state().items.owned, [item.id]);
});
