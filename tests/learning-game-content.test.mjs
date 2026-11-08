import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {LINE_RULES, QUEST_TEXT_RULES, validLine, localLine} from '../services/mode-architecture/learning-game-content.mjs';

test('台词：模型 ≤4 s 内回来用模型的；超时 / 离线回本地台词并标 local；骂人的被拒', async t => {
  const {game} = gameFixture(t);
  assert.equal((await game.modules.content.line({event: 'setFinish'})).source, 'local');
  game.requestModel = async rules => (rules === LINE_RULES ? {value: {text: '这一页盖得漂亮～'}} : {unavailable: true});
  assert.deepEqual(await game.modules.content.line({event: 'setFinish'}), {text: '这一页盖得漂亮～', source: 'model'});
  game.requestModel = () => new Promise(r => setTimeout(() => r({value: {text: '太慢了'}}), 6000).unref());
  const t0 = Date.now();
  const slow = await game.modules.content.line({event: 'capture'});
  assert.equal(slow.source, 'local');
  assert.ok(Date.now() - t0 < 4800);
  assert.equal(validLine({text: '你又错了吧'}), null);
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
