import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {LINES_RULES, LINE_EVENTS, QUEST_TEXT_RULES, validLine, validLines, validQuestText, localLine} from '../services/mode-architecture/learning-game-content.mjs';

test('台词：池子没好前即时回本地（标 local）并在后台让模型写今天的池子；池子好了即时回模型台词；骂人的被拒', async t => {
  const {game} = gameFixture(t);
  assert.equal((await game.modules.content.line({event: 'setFinish'})).source, 'local');
  const pool = Object.fromEntries(Object.keys(LINE_EVENTS).map(ev => [ev, [`${ev} 一`, `${ev} 二`, `${ev} 三`]]));
  pool.capture = ['抓到啦，它乖乖进图鉴了', '你又错了吧', '收服！'];
  let calls = 0;
  game.requestModel = async rules => { calls += 1; return rules === LINES_RULES ? {value: {lines: pool}} : {unavailable: true}; };
  const t0 = Date.now();
  const first = await game.modules.content.line({event: 'setFinish'});
  assert.equal(first.source, 'local', '池子还没好：先回本地');
  assert.ok(Date.now() - t0 < 4000);
  await game.modules.content.lineJob;
  const a = await game.modules.content.line({event: 'setFinish'});
  const b = await game.modules.content.line({event: 'setFinish'});
  assert.equal(a.source, 'model');
  assert.ok(pool.setFinish.includes(a.text) && pool.setFinish.includes(b.text));
  assert.notEqual(a.text, b.text, '同一事件连着两次不重复');
  for (let i = 0; i < 6; i += 1) assert.notEqual((await game.modules.content.line({event: 'capture'})).text, '你又错了吧', '骂人的台词进不了池子');
  assert.equal((await game.modules.content.line({event: 'unknown-event'})).source, 'model', '没有的事件用 default 池');
  assert.equal(calls, 1, '一天只写一次池子');
  // 模型太慢 / 离线：始终即时回本地
  const {game: g2} = gameFixture(t);
  g2.requestModel = () => new Promise(r => setTimeout(() => r({unavailable: true}), 6000).unref());
  const t1 = Date.now();
  assert.equal((await g2.modules.content.line({event: 'capture'})).source, 'local');
  assert.ok(Date.now() - t1 < 1000);
  assert.equal(validLine({text: '你又错了吧'}), null);
  assert.equal(validLines({lines: {setFinish: ['好']}}), null, '池子太空不收');
});

test('考前 7 天：本地台词换安静版', t => {
  assert.ok(localLine('setFinish', {quiet: true}).length > 0);
  const {game, setClock} = gameFixture(t);
  setClock(Date.parse('2026-12-08T02:00:00Z'));
  assert.equal(game.state().quiet, true);
  const cat = game.catalogView();
  assert.equal(cat.shelves.limited.length, 0, '安静期不上节气限定');
  assert.ok(!cat.shelves.daily.some(s => s.discount), '安静期不打限时折扣');
});

test('委托文案：模型补写标题和文案，数字不变；写好前是本地文案', async t => {
  const {game} = gameFixture(t);
  game.requestModel = async (rules, payload) => (rules === QUEST_TEXT_RULES ? {value: {quests: payload.quests.map(q => ({id: q.id, title: '浇浇水', text: `今天来 ${q.count} 次吧`}))}} : {unavailable: true});
  const before = game.questsToday();
  assert.equal(before.quests[0].source, 'local');
  await game.modules.content.questJobs.get(game.today());
  const after = game.questsToday();
  assert.equal(after.quests[0].source, 'model');
  assert.equal(after.quests[0].title, '浇浇水');
  assert.deepEqual(after.quests.map(q => q.target), before.quests.map(q => q.target));
});

test('委托文案：改了数字、把「组」说成「卷子」的不收', () => {
  const ids = ['a', 'b'];
  const counts = {a: 20, b: 2};
  assert.ok(validQuestText({quests: [{id: 'a', title: '浇浇水', text: '答对 20 道就好'}, {id: 'b', title: '两组', text: '背完 2 组～'}]}, ids, counts));
  assert.equal(validQuestText({quests: [{id: 'a', title: '浇浇水', text: '答对 30 道就好'}, {id: 'b', title: '两组', text: '背完 2 组～'}]}, ids, counts), null);
  assert.equal(validQuestText({quests: [{id: 'a', title: '浇浇水', text: '答对 20 道'}, {id: 'b', title: '攻克两套卷', text: '刷完这两套卷子'}]}, ids, counts), null);
});
