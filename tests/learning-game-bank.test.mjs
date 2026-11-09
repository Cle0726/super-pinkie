import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {flattenPaper, QuestionBank, rankItems, pick, overview, validTags, POINT_GROUPS, UNCLASSIFIED, TAG_RULES} from '../services/mode-architecture/learning-game-bank.mjs';

const DAY = 86400000;
// 一套迷你「真题」：每种题型各来一点，题号照真卷
function paper(id, {year = 2020, month = 6, kind = 'real', tweak = ''} = {}) {
  return {paperId: id, exam: 'pretco-b', kind, year, month, title: kind === 'mock' ? '官方模拟卷 1' : `${year} 年 ${month} 月真题`, audio: null, version: 5, flags: [],
    sections: [
      {id: 'listening', parts: [{id: 'A', kind: 'listen-response', each: 1, items: [{no: 1, options: ['Thank you.', 'Here you go.', 'Just water.', 'Sounds great.'], answer: 2, script: 'What would you like to drink?'}]}]},
      {id: 'vocab', parts: [
        {id: 'A', kind: 'choice', each: 1, items: [
          {no: 25, stem: `The more you practice, ____ natural it will be.${tweak}`, options: ['the best', 'best', 'the more', 'more'], answer: 2, why: 'the+比较级'},
          {no: 26, stem: 'She ____ here since 2010.', options: ['lives', 'has lived', 'lived', 'is living'], answer: 1},
          {no: 27, stem: 'He was made ____ the room.', options: ['clean', 'cleaning', 'to clean', 'cleaned'], answer: 2}]},
        {id: 'B', kind: 'word-form', each: 1, items: [{no: 35, stem: 'Your ____ is late.', base: 'pay', answer: ['payment']}, {no: 36, stem: 'He ran ____.', base: 'quick', answer: ['quickly']}]}]},
      {id: 'reading', parts: [
        {id: 'T1', kind: 'passage-choice', each: 2, material: 'A long passage about career plans.', items: [{no: 40, stem: 'A plan helps people be ____.', options: ['a', 'b', 'c', 'd'], answer: 1}, {no: 41, stem: 'The passage is mainly about ____.', options: ['a', 'b', 'c', 'd'], answer: 0}]},
        {id: 'T4', kind: 'term-match', each: 1, material: 'A — quality control\nB — business card\nC — trade fair', items: [{no: 53, stem: '质量控制', answer: 'A'}, {no: 53, stem: '名片', answer: 'B'}]}]},
      {id: 'translation', parts: [{id: 'B', kind: 'translate-passage', each: 12, items: [{no: 67, stem: 'Customer service matters.', reference: '客户服务很重要。', rubric: '准确 8 + 通顺 4'}]}]},
      {id: 'writing', parts: [{id: 'A', kind: 'writing', each: 15, items: [{no: 71, stem: '写一封邀请信', reference: 'Dear ...', rubric: '五档'}]}]},
    ]};
}
function install(game, papers) {
  const dir = path.join(game.root, 'papers');
  fs.mkdirSync(dir, {recursive: true});
  for (const p of papers) fs.writeFileSync(path.join(dir, `${p.paperId}.json`), JSON.stringify(p));
  fs.writeFileSync(path.join(dir, 'paper-2026-11-09-sim.json'), JSON.stringify({...paper('paper-2026-11-09-sim'), kind: 'sim'}));
}
// 假模型：按考点表第一个考点标；可以注入坏输出
function fakeTagger({bad = () => false} = {}) {
  const calls = [];
  const fn = async (rules, payload) => {
    calls.push(payload);
    const g = POINT_GROUPS.find(x => x.name === payload.group);
    return {value: {items: payload.items.map(it => (bad(it, payload) ? {no: it.no, point: '瞎编考点', difficulty: '中', answer: 3} : {no: it.no, point: g.points[0], difficulty: '易', answer: 0}))}};
  };
  fn.calls = calls;
  return fn;
}

test('摊平：一题一条，稳定 id、同题号的两个空拆开、文章按引用共用、仿真卷不进', t => {
  const {items, materials} = flattenPaper(paper('real-2020-06'));
  const ids = items.map(i => i.id);
  assert.ok(ids.includes('real-2020-06#25') && ids.includes('real-2020-06#53') && ids.includes('real-2020-06#53-2'));
  assert.equal(new Set(ids).size, ids.length);
  const t1 = items.filter(i => i.part === 'T1');
  assert.equal(t1[0].material, t1[1].material);
  assert.equal(materials[t1[0].material], 'A long passage about career plans.');
  assert.equal(items.find(i => i.id === 'real-2020-06#25').answer, 2);
  assert.equal(items.find(i => i.id === 'real-2020-06#1').script, 'What would you like to drink?');
  assert.equal(flattenPaper({...paper('x'), kind: 'sim'}).items.length, 0);
});

test('标注：考点必须在表里，乱写的重试后归「未分类」；单考点组强制；模型输出的答案不会写进题库', async t => {
  const {game} = gameFixture(t);
  install(game, [paper('real-2020-06')]);
  const model = fakeTagger({bad: (it, p) => p.group === '词汇语法 · 词形'});
  const bank = new QuestionBank({root: game.root, requestModel: model});
  await bank.tagAll({concurrency: 2});
  const rep = bank.report();
  assert.equal(rep.tagged, rep.items);
  const vf = bank.load().items.filter(i => i.group === 'vf');
  assert.ok(vf.every(i => i.point === UNCLASSIFIED));
  assert.ok(rep.unclassified.length === vf.length);
  const vc = bank.item('real-2020-06#25');
  assert.equal(vc.point, '时态');
  assert.equal(vc.answer, 2, '答案只从卷子来');
  assert.equal(bank.item('real-2020-06#53-2').point, '公共标识', '同题号第二个空也标上了');
  assert.match(TAG_RULES, /不要质疑、不要改/);
  // 单考点组：模型写别的也按唯一考点
  const out = validTags({items: [{no: '1', point: '随便', difficulty: '难'}]}, [{id: 'x', tagNo: '1'}], 'lb');
  assert.deepEqual(out.x, {point: '短对话', difficulty: '难'});
});

test('增量：再跑不调模型；卷子题目变了只重标变了的那一节', async t => {
  const {game} = gameFixture(t);
  install(game, [paper('real-2020-06'), paper('real-2019-06', {year: 2019})]);
  const model = fakeTagger();
  const bank = new QuestionBank({root: game.root, requestModel: model});
  await bank.tagAll();
  const first = model.calls.length;
  assert.ok(first > 0);
  await bank.tagAll();
  assert.equal(model.calls.length, first, '没有新题就不调模型');
  install(game, [paper('real-2020-06', {tweak: ' (rev)'}), paper('real-2019-06', {year: 2019})]);
  await bank.tagAll();
  assert.equal(model.calls.length, first + 1, '只重标改了的那一节');
  assert.equal(bank.untagged().length, 0);
});

test('抽题规则：没做过优先 → 做错过 → 做对超过 7 天；7 天内做对的不出', () => {
  const now = Date.parse('2026-11-09T00:00:00Z');
  const items = ['a', 'b', 'c', 'd'].map(id => ({id}));
  const rec = {a: {n: 1, ok: true, okAt: now - 2 * DAY, at: now - 2 * DAY}, b: {n: 1, ok: false, at: now - DAY}, c: {n: 2, ok: true, okAt: now - 9 * DAY, at: now - 9 * DAY}};
  assert.deepEqual(rankItems(items, rec, {now}).map(i => i.id), ['d', 'b', 'c']);
});

test('留卷：最新 3 套真题默认不进随机池；交过整卷或手动解锁后进池；模拟卷不留', async t => {
  const {game} = gameFixture(t);
  install(game, [paper('real-2024-06', {year: 2024}), paper('real-2023-12', {year: 2023, month: 12}), paper('real-2023-06', {year: 2023}), paper('real-2022-12', {year: 2022, month: 12}), paper('mock-1', {kind: 'mock', year: 0, month: 0})]);
  const pr = game.modules.practice;
  assert.deepEqual(pr.bank.reservedPapers(), ['real-2024-06', 'real-2023-12', 'real-2023-06']);
  const r = pick(pr.bank, {mode: 'random', count: 20});
  assert.ok(r.items.length > 0 && r.items.every(i => ['real-2022-12', 'mock-1'].includes(i.paperId)));
  pr.unlock({paperId: 'real-2024-06'});
  game.mutate(s => { s.exam ||= {papers: {}, attempts: {}, scores: [], real: {}, bossDone: {}}; s.exam.attempts.a = {paperId: 'real-2023-12', submittedAt: game.now()}; });
  const un = pr.unlockedOf(game.read());
  assert.ok(un['real-2024-06'] && un['real-2023-12'] && !un['real-2023-06']);
  const ov = pr.overview();
  assert.deepEqual(ov.reserved.map(x => x.locked), [false, false, true]);
  assert.throws(() => pr.unlock({paperId: 'real-2022-12'}), /不是留卷/);
});

test('刷题一组：答对给真题星（名侦探 +30%）、同题重交不重复给、答错生错题怪、做完计入今日组数和委托', async t => {
  const {game} = gameFixture(t);
  install(game, [paper('real-2020-06'), paper('real-2019-06', {year: 2019}), paper('real-2018-06', {year: 2018}), paper('real-2017-06', {year: 2017})]);
  const pr = game.modules.practice;
  game.mutate(s => { s.forms.owned.push('detective'); s.forms.equipped = 'detective'; });
  const set = pr.start({mode: 'kind', kind: 'vc', requestId: 'r1'});
  assert.equal(set.items.length, 3);
  assert.ok(set.items.every(i => i.answer === undefined && i.options), '前端拿不到答案');
  const again = pr.start({mode: 'kind', kind: 'vc', requestId: 'r1'});
  assert.equal(again.setId, set.setId, 'requestId 幂等');
  const bank = pr.bank;
  const stars0 = game.read().wallet.stars;
  const [i1, i2, i3] = set.items;
  const ok1 = await pr.answer({setId: set.setId, itemId: i1.itemId, answer: bank.item(i1.itemId).answer});
  assert.equal(ok1.correct, true);
  assert.equal(ok1.awards.find(a => a.reason === '真题答对').amount, 3, '2 × 1.3 → 3');
  const dup = await pr.answer({setId: set.setId, itemId: i1.itemId, answer: 0});
  assert.equal(dup.correct, true, '重交返回第一次的结果');
  assert.equal(game.read().wallet.stars, stars0 + 3);
  const bad = await pr.answer({setId: set.setId, itemId: i2.itemId, answer: (bank.item(i2.itemId).answer + 1) % 4});
  assert.equal(bad.correct, false);
  assert.ok(bad.monster?.id, '答错生错题怪');
  assert.match(bad.key, /^[ABCD]\. /);
  await pr.answer({setId: set.setId, itemId: i3.itemId, answer: bank.item(i3.itemId).answer});
  const fin = pr.finish({setId: set.setId});
  assert.equal(fin.scored, 3);
  const d = game.read().days[game.today()];
  assert.equal(d.realCorrect, 2);
  assert.equal(game.read().practice.rec[i2.itemId].ok, false);
  // 错题重刷能抽到刚错的那题
  const w = pick(bank, {mode: 'wrong', rec: game.read().practice.rec});
  assert.deepEqual(w.items.map(i => i.id), [i2.itemId]);
  // 7 天内做对的再刷不给星
  const s2 = pr.start({mode: 'point', point: `vc/${bank.item(i1.itemId).point || ''}`, requestId: 'r2'});
  assert.ok(s2.empty || !s2.items.some(i => i.itemId === i1.itemId));
});

test('词形 / 填空判分归一大小写和首尾空格；术语配对认字母；幻形灵第一次答错不断连击', async t => {
  const {game} = gameFixture(t);
  install(game, [paper('real-2020-06'), paper('real-2019-06', {year: 2019}), paper('real-2018-06', {year: 2018}), paper('real-2017-06', {year: 2017})]);
  const pr = game.modules.practice;
  game.mutate(s => { s.forms.owned.push('changeling'); s.forms.equipped = 'changeling'; });
  const set = pr.start({mode: 'kind', kind: 'vf', requestId: 'f1'});
  const pay = set.items.find(i => i.base === 'pay');
  const r = await pr.answer({setId: set.setId, itemId: pay.itemId, answer: '  Payment '});
  assert.equal(r.correct, true);
  const quick = set.items.find(i => i.base === 'quick' && i.paperId === pay.paperId);
  if (quick) {
    const r2 = await pr.answer({setId: set.setId, itemId: quick.itemId, answer: 'quick'});
    assert.equal(r2.correct, false);
    assert.equal(r2.combo, 1, '幻形灵：第一次答错连击不断');
  }
  const tm = pr.start({mode: 'kind', kind: 'r4', requestId: 't1'});
  assert.equal(tm.items.length, 2);
  assert.ok(tm.materials[tm.items[0].material].includes('quality control'));
  const r3 = await pr.answer({setId: tm.setId, itemId: tm.items[1].itemId, answer: 'b'});
  assert.equal(r3.correct, true);
});

test('写作 / 翻译段落：没模型时不瞎给分；空白 0 分；概览按考点给题数 · 做过 · 正确率', async t => {
  const {game} = gameFixture(t);
  install(game, [paper('real-2020-06'), paper('real-2019-06', {year: 2019}), paper('real-2018-06', {year: 2018}), paper('real-2017-06', {year: 2017})]);
  const pr = game.modules.practice;
  const set = pr.start({mode: 'kind', kind: 'writing', requestId: 'w1'});
  assert.equal(set.items.length, 1);
  const blank = await pr.answer({setId: set.setId, itemId: set.items[0].itemId, answer: '   '});
  assert.equal(blank.grade.score, 0);
  const ov = overview(pr.bank, {rec: game.read().practice.rec});
  assert.ok(ov.kinds.find(k => k.id === 'writing').done === 1);
  assert.ok(ov.kinds.find(k => k.id === 'translation').total >= 1);
  assert.equal(ov.total, 4 * 12);
});

test('今日闭环：讲完课的下一站是这节课考点的真题；没上课给弱项；守关优先用真题；loop 从当天数据算', async t => {
  const {game} = gameFixture(t);
  const many = [];
  for (let y = 2010; y < 2016; y += 1) many.push(paper(`real-${y}-06`, {year: y}));
  install(game, many);
  const pr = game.modules.practice;
  await pr.bank.tagAll({concurrency: 1}).catch(() => {});
  // 没有模型：手动给 vc 题标「时态」
  const store = pr.bank.readTags();
  for (const it of pr.bank.load().items) store.tags[it.id] = {point: it.group === 'vc' ? '时态' : POINT_GROUPS.find(g => g.id === it.group).points[0], difficulty: '中', sig: it.sig};
  pr.bank.writeTags(store);
  const node = {id: 'grammar:tense', name: '时态的一致', summary: '现在完成时和一般过去时', region: 'grammar'};
  assert.equal(pr.pointForNode(node).id, 'vc/时态');
  game.mutate(s => { s.lastLesson = {date: game.today(), nodeId: 'x'}; });
  game.modules.world.findNode = () => node;
  const sg = pr.suggest(game.read());
  assert.equal(sg.point, 'vc/时态');
  assert.equal(sg.reason, 'lesson');
  game.mutate(s => { s.lastLesson = {date: '2020-01-01', nodeId: 'x'}; });
  assert.equal(pr.suggest(game.read()).reason, 'weak');
  const g = pr.guardItems('grammar');
  assert.ok(g.length >= 5 && g.every(x => x.options && Number.isInteger(x.answer)));
  assert.deepEqual(pr.guardItems('reading'), [], '阅读守关没有不带文章的单选 → 模型出');
  const loop = game.state().today.loop;
  assert.equal(loop.realSets, 0);
  assert.equal(typeof loop.weekend, 'boolean');
  assert.ok(loop.suggest?.point);
});
