import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {PRETCO_B_FORMAT, LINE_RULES} from '../services/mode-architecture/learning-game-content.mjs';
import {EXPLAIN_RULES} from '../services/mode-architecture/learning-game-content.mjs';
import {GRADE_RULES, validSection, gradeObjective} from '../services/mode-architecture/learning-game-exam.mjs';

const ch = i => ({stem: `Q${i} ___ ?`, options: [`w${i}a`, `w${i}b`, `RIGHT${i}`, `w${i}d`], answer: 2});
function item(kind, i) {
  if (kind.startsWith('listen-') && kind !== 'listen-dictation') return {...ch(i), tts: `W: line ${i}? M: answer ${i}.`};
  if (['choice', 'passage-choice', 'translate-choice'].includes(kind)) return ch(i);
  if (kind === 'term-match') return {stem: `术语${i}`, answer: 'C'};
  if (['translate-passage', 'writing'].includes(kind)) return {stem: `TASK ${kind}`, reference: `REFERENCE ${kind}`, rubric: `RUBRIC ${kind}`};
  return {stem: `S${i} ____`, base: kind === 'word-form' ? 'go' : undefined, answer: [`ans${i}`]};
}
const sectionFor = sec => ({parts: sec.parts.map(p => ({id: p.id, material: `MATERIAL ${p.id}`, items: Array.from({length: p.count}, (_, i) => item(p.kind, i))}))});
function model({gradeScore = 10} = {}) {
  return async (rules, payload) => {
    if (payload?.section) return {value: sectionFor(payload.section)};
    if (rules === GRADE_RULES) return {value: {score: Math.min(gradeScore, payload.max), reason: '要点齐全'}};
    if (rules === EXPLAIN_RULES) return {value: {text: `标准答案是${payload.standard}。`}};
    if (rules === LINE_RULES) return {value: {text: '这次稳稳的！'}};
    return {unavailable: true};
  };
}
async function readyPaper(game) {
  const g = game.modules.exam.generate({requestId: 'gen1'});
  await game.modules.exam.jobs.get(g.paperId);
  return g.paperId;
}

test('整卷按 PRETCO-B 题型生成；exam.start 的 JSON 里搜不到答案和评分细则', async t => {
  const {game} = gameFixture(t);
  game.requestModel = model();
  const paperId = await readyPaper(game);
  const list = game.modules.exam.papers({});
  assert.equal(list.format.total, 100);
  assert.ok(list.papers.some(p => p.paperId === paperId && p.status === 'ready'));
  const s = game.modules.exam.start({paperId, requestId: 'st1'});
  const json = JSON.stringify(s);
  for (const bad of ['REFERENCE', 'RUBRIC', '"answer"', '"reference"', '"rubric"', 'ans0']) assert.ok(!json.includes(bad), `泄题：${bad}`);
  const count = s.paper.sections.reduce((n, sec) => n + sec.items.length, 0);
  assert.equal(count, 66);
  assert.ok(s.paper.sections[0].items[0].tts.text.length > 0, '听力题带 tts');
  const full = JSON.parse(fs.readFileSync(path.join(game.root, 'papers', `${paperId}.json`), 'utf8'));
  assert.ok(JSON.stringify(full).includes('RIGHT'), '答案只在服务端卷子文件');
});

test('关掉再开：同一份卷子接着考，答案和结束时间都恢复', async t => {
  const {game} = gameFixture(t);
  game.requestModel = model();
  const paperId = await readyPaper(game);
  const s1 = game.modules.exam.start({paperId, requestId: 'a'});
  game.modules.exam.save({attemptId: s1.attemptId, answers: {'vocab-A-1': 2}});
  const s2 = game.modules.exam.start({paperId, requestId: 'b'});
  assert.equal(s2.attemptId, s1.attemptId);
  assert.equal(s2.endsAt, s1.endsAt);
  assert.equal(s2.answers['vocab-A-1'], 2);
  assert.equal(s2.resumed, true);
});

test('判卷：客观题代码判、主观题模型按细则判；巴别兽掉血；答错生成怪；金印每周最多 2 次', async t => {
  const {game} = gameFixture(t);
  game.requestModel = model({gradeScore: 10});
  const paperId = await readyPaper(game);
  const runOnce = async tag => {
    const s = game.modules.exam.start({paperId, requestId: `s-${tag}`});
    const answers = {};
    for (const sec of s.paper.sections) for (const it of sec.items) answers[it.id] = it.options ? 2 : it.kind === 'term-match' ? 'C' : ['translate-passage', 'writing'].includes(it.kind) ? 'My long answer text goes here with many words.' : it.id.endsWith('-1') ? 'wrong' : `ans${Number(it.id.split('-').pop()) - 1}`;
    game.modules.exam.save({attemptId: s.attemptId, answers});
    game.modules.exam.submit({attemptId: s.attemptId, requestId: `sub-${tag}`});
    await game.modules.exam.grading.get(s.attemptId);
    return game.modules.exam.result({attemptId: s.attemptId});
  };
  const r1 = await runOnce(1);
  assert.equal(r1.status, 'done');
  assert.ok(r1.score > 70 && r1.score < 100, `score ${r1.score}`);
  assert.equal(r1.notes['translation-B-1'].source, 'model');
  assert.match(r1.notes['translation-B-1'].standard, /REFERENCE/);
  assert.ok(r1.explained.length >= 1);
  assert.ok(r1.explained.every(item => item.standard && item.text.startsWith('标准答案是') && item.text.includes(item.standard)));
  assert.ok(r1.bossAfter.hpPercent < r1.bossBefore.hpPercent);
  assert.ok(r1.monstersSpawned.length >= 1);
  assert.ok(r1.awards.some(a => a.kind === 'seals'));
  assert.ok(r1.awards.some(a => a.kind === 'form' && a.itemId === 'dragon-rider'), '预估 ≥ 稳过线 → 巴别兽破防');
  const r2 = await runOnce(2);
  const r3 = await runOnce(3);
  assert.ok(r2.awards.some(a => a.kind === 'seals'));
  assert.ok(!r3.awards.some(a => a.kind === 'seals'), '同一北京周第 3 次交卷不给金印');
  assert.ok(r3.awards.some(a => a.kind === 'stars'));
  assert.equal(game.modules.exam.bossState(game.read()).phase, 'broken');
});

test('空白作文 0 分（不调用模型）；跑题由细则限制', async t => {
  const {game} = gameFixture(t);
  game.requestModel = model({gradeScore: 15});
  const paperId = await readyPaper(game);
  const s = game.modules.exam.start({paperId, requestId: 'e1'});
  game.modules.exam.submit({attemptId: s.attemptId, requestId: 'e2'});
  await game.modules.exam.grading.get(s.attemptId);
  const r = game.modules.exam.result({attemptId: s.attemptId});
  assert.equal(r.notes['writing-A-1'].score, 0);
  assert.equal(r.score, 0);
});

test('校验：题量不对的部分被拒；客观题判分规则', () => {
  const sec = PRETCO_B_FORMAT.sections[1];
  const good = sectionFor(sec);
  assert.ok(validSection(sec, good));
  const bad = structuredClone(good); bad.parts[0].items.pop();
  assert.equal(validSection(sec, bad), null);
  assert.equal(gradeObjective('word-form', {answer: ['went']}, ' Went '), true);
  assert.equal(gradeObjective('choice', {options: ['a', 'b', 'c', 'd'], answer: 1}, 1), true);
  assert.equal(gradeObjective('term-match', {answer: 'C'}, 'c'), true);
});

test('真实分数：考前不能填；考后 ≥60 解锁毕业碧琪，只能填一次', async t => {
  const {game, setClock} = gameFixture(t);
  assert.throws(() => game.modules.exam.realScore({score: 75, requestId: 'r0'}), /考完以后/);
  setClock(Date.parse('2026-12-14T02:00:00Z'));
  const r = game.modules.exam.realScore({score: 75, requestId: 'r1'});
  assert.equal(r.passed, true);
  assert.ok(r.awards.some(a => a.itemId === 'graduate'));
  assert.equal(game.modules.exam.bossState(game.read()).phase, 'done');
  assert.throws(() => game.modules.exam.realScore({score: 80, requestId: 'r2'}), /填过/);
});

test('出卷后盲做复核：对不上的选择题改写一次；改不好就把盲做的答案也算对（只在服务端，不泄题）', async t => {
  const {SOLVE_RULES} = await import('../services/mode-architecture/learning-game-content.mjs');
  const {FIX_ITEM_RULES} = await import('../services/mode-architecture/learning-game-exam.mjs');
  const {game} = gameFixture(t);
  const base = model();
  game.requestModel = async (rules, payload) => {
    if (rules === SOLVE_RULES) {
      if (payload.stem.includes('Q1 ___')) return {value: {answer: 0, unique: false}}; // 第 2 题：歧义，改写后变好
      if (payload.stem.includes('Q3 ___')) return {value: {answer: 1, unique: true}};  // 第 4 题：改写也救不回
      if (payload.stem.includes('FIXED')) return {value: {answer: 2, unique: true}};
      return {value: {answer: 2, unique: true}};
    }
    if (rules === FIX_ITEM_RULES) return payload.stem.includes('Q1 ___') ? {value: {stem: 'FIXED one ___ ?', options: ['p', 'q', 'RIGHT-FIX', 's'], answer: 2}} : {unavailable: true};
    return base(rules, payload);
  };
  const paperId = await readyPaper(game);
  const full = JSON.parse(fs.readFileSync(path.join(game.root, 'papers', `${paperId}.json`), 'utf8'));
  const vocabA = full.sections.find(s => s.id === 'vocab').parts.find(p => p.id === 'A').items;
  assert.equal(vocabA[1].stem, 'FIXED one ___ ?');
  assert.deepEqual(vocabA[3].alt, [1]);
  assert.ok(full.verify.checked >= 34 && full.verify.fixed >= 1 && full.verify.ambiguous >= 1, JSON.stringify(full.verify));
  assert.equal(gradeObjective('choice', vocabA[3], 1), true, '盲做的答案也算对');
  assert.equal(gradeObjective('choice', vocabA[3], 2), true);
  assert.equal(gradeObjective('choice', vocabA[3], 0), false);
  const s = game.modules.exam.start({paperId, requestId: 'v1'});
  assert.ok(!JSON.stringify(s).includes('"alt"'), 'alt 不进公开卷');
});

test('守关答完才按标准答案讲解', async t => {
  const {game} = gameFixture(t);
  let seen;
  game.requestModel = async (rules, payload) => { seen = payload; return rules === EXPLAIN_RULES ? {value: {text: '标准答案是 Here you are。'}} : {unavailable: true}; };
  game.mutate(state => { game.modules.world.ensure(state).guards.g1 = {items: [{stem: 'Could you pass the report?', options: ['Yes', 'Here you are.'], answer: 1, why: '请求帮忙'}], answers: {}}; });
  await assert.rejects(() => game.modules.world.guardExplain({attemptId: 'g1', itemId: 'g1'}), /先做完/);
  game.modules.world.guardAnswer({attemptId: 'g1', itemId: 'g1', answer: 0});
  const told = await game.modules.world.guardExplain({attemptId: 'g1', itemId: 'g1', yours: 'Yes'});
  assert.equal(told.source, 'model');
  assert.equal(seen.standard, 'Here you are.');
  assert.deepEqual(seen.options, ['Yes', 'Here you are.']);
  assert.equal(seen.correct, false);
  assert.equal(seen.yours, 'Yes');
  const cached = await game.modules.world.guardExplain({attemptId: 'g1', itemId: 'g1'});
  assert.equal(cached.text, told.text);
});
