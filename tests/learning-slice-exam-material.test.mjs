// B3a 复发测试：出卷后的盲做复核 / 改写必须看到整篇材料，不能只看前 1500 字。
// 阅读、实用文的答案依据常在后半篇；截断后盲做会判「不唯一」，改写失败还会把盲做选的错答案记进 alt 当对。
import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {SOLVE_RULES} from '../services/mode-architecture/learning-game-content.mjs';
import {FIX_ITEM_RULES} from '../services/mode-architecture/learning-game-exam.mjs';

const TAIL = 'TAIL-EVIDENCE-SENTENCE';
const LONG = `${'The office opens at nine and the staff meet in room two. '.repeat(40)}${TAIL}`; // 约 2300 字，<= validSection 的 4000
const ch = i => ({stem: `Q${i} ___ ?`, options: [`w${i}a`, `w${i}b`, `RIGHT${i}`, `w${i}d`], answer: 2});
function item(kind, i) {
  if (kind.startsWith('listen-') && kind !== 'listen-dictation') return {...ch(i), tts: `W: line ${i}? M: answer ${i}.`};
  if (['choice', 'passage-choice', 'translate-choice'].includes(kind)) return ch(i);
  if (kind === 'term-match') return {stem: `术语${i}`, answer: 'C'};
  if (['translate-passage', 'writing'].includes(kind)) return {stem: `TASK ${kind}`, reference: `REFERENCE ${kind}`, rubric: `RUBRIC ${kind}`};
  return {stem: `S${i} ____`, base: kind === 'word-form' ? 'go' : undefined, answer: [`ans${i}`]};
}
const sectionFor = sec => ({parts: sec.parts.map(p => ({id: p.id, material: LONG, items: Array.from({length: p.count}, (_, i) => item(p.kind, i))}))});

test('出卷复核：盲做和改写拿到的是完整材料（含 1500 字之后的尾段）', async t => {
  const {game} = gameFixture(t);
  const solved = [], fixed = [];
  game.requestModel = async (rules, payload) => {
    if (payload?.section) return {value: sectionFor(payload.section)};
    if (rules === SOLVE_RULES) {
      solved.push(payload.stem);
      // 第一道带材料的题判不唯一，逼出一次改写；其余都对得上
      return payload.stem.startsWith('The office opens') && fixed.length === 0 ? {value: {answer: 0, unique: false}} : {value: {answer: 2, unique: true}};
    }
    if (rules === FIX_ITEM_RULES) { fixed.push(payload); return {unavailable: true}; }
    return {unavailable: true};
  };
  const g = game.modules.exam.generate({requestId: 'gen-long'});
  await game.modules.exam.jobs.get(g.paperId);
  const withMaterial = solved.filter(stem => stem.startsWith('The office opens'));
  assert.ok(withMaterial.length > 0, '有带材料的选择题进了盲做');
  for (const stem of withMaterial) assert.ok(stem.includes(TAIL), '盲做看到的材料被截断了，尾段证据不在');
  const fixWithMaterial = fixed.filter(p => p.material);
  assert.ok(fixWithMaterial.length > 0, '有带材料的题进了改写');
  for (const p of fixWithMaterial) assert.ok(p.material.includes(TAIL), '改写看到的材料被截断了，尾段证据不在');
});

test('交卷批注：作文 / 翻译段落的标准答案和用户作答给全文，不截成半篇', async t => {
  const {game} = gameFixture(t);
  const REF_TAIL = 'REFERENCE-TAIL-SENTENCE';
  const LONG_REF = `${'Dear Mr. Smith, thank you for your kind letter about the visit. '.repeat(12)}${REF_TAIL}`; // 约 800 字，> 旧上限 400
  const YOURS_TAIL = 'YOURS-TAIL-SENTENCE';
  const LONG_YOURS = `${'I am writing to tell you about the meeting next week. '.repeat(10)}${YOURS_TAIL}`; // 约 560 字，> 旧上限 300
  const subjective = kind => ['translate-passage', 'writing'].includes(kind);
  game.requestModel = async (rules, payload) => {
    if (payload?.section) return {value: {parts: payload.section.parts.map(p => ({id: p.id, material: 'MATERIAL',
      items: Array.from({length: p.count}, (_, i) => (subjective(p.kind) ? {stem: `TASK ${p.kind}`, reference: LONG_REF, rubric: 'RUBRIC'} : item(p.kind, i)))}))}};
    return {unavailable: true};
  };
  const g = game.modules.exam.generate({requestId: 'gen-notes'});
  await game.modules.exam.jobs.get(g.paperId);
  const s = game.modules.exam.start({paperId: g.paperId, requestId: 'st-notes'});
  const answers = {};
  for (const sec of s.paper.sections) for (const it of sec.items) if (subjective(it.kind)) answers[it.id] = LONG_YOURS;
  assert.ok(Object.keys(answers).length >= 2, '卷子里有作文和翻译段落');
  game.modules.exam.save({attemptId: s.attemptId, answers});
  game.modules.exam.submit({attemptId: s.attemptId, requestId: 'sub-notes'});
  await game.modules.exam.grading.get(s.attemptId);
  const notes = Object.values(game.modules.exam.result({attemptId: s.attemptId}).notes || {});
  assert.ok(notes.length >= 2);
  for (const n of notes) {
    assert.ok(n.standard.includes(REF_TAIL), '批注卡的标准答案被截成了半篇');
    assert.ok(n.yours.includes(YOURS_TAIL), '批注卡的用户作答被截成了半篇');
  }
});
