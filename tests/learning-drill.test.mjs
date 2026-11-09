import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, calculateReviewSchedule, registerLearningGateway} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';
import {LearningRecall, recallHash} from '../services/mode-architecture/learning-recall.mjs';
import {LearningVocab} from '../services/mode-architecture/learning-vocab.mjs';
import {LearningDesk} from '../services/mode-architecture/learning-desk.mjs';
import {EXPLAIN_RULES} from '../services/mode-architecture/learning-game-content.mjs';
import {
  DRILL_CHEER_RULES, DRILL_JUDGE_RULES, DRILL_RULES, LearningDrill, buildSession, drillCardHash, drillStars, drillStrength,
  foldDrillText, localCheer, localJudge, mapDrillRating, mixDrillCards, pairLabel, validateDrillCards,
} from '../services/mode-architecture/learning-drill.mjs';

const KEY = 'agent:learning:drill-test';

function fixture(t, {at = Date.parse('2026-11-04T02:00:00Z')} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-drill-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = at;
  const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
  const pact = new LearningPact(store, {now: () => clock});
  store.pact = pact;
  const organizer = {status: () => ({available: false, model: ''}), requestModel: async () => { throw new Error('B1 不该调用模型'); }};
  const recall = new LearningRecall(store, {organizer, schedule: calculateReviewSchedule, recordReview: () => pact.recordReview({count: 1})});
  store.recall = recall;
  const vocab = new LearningVocab(store, {requestModel: async () => ({unavailable: true})});
  store.vocab = vocab;
  const drill = new LearningDrill(store, {organizer, schedule: calculateReviewSchedule, recall, vocab, pact, now: () => clock});
  store.drill = drill;
  return {store, pact, recall, vocab, drill, organizer, root, setClock: value => { clock = value; }};
}

function noteCard(id, strength, extra = {}) {
  const reviewCount = strength <= 0 ? 0 : strength;
  const reviewLevel = strength <= 0 ? -1 : strength - 1;
  return {
    book: 'notes', key: `notes:${id}`, noteId: `note-${id}`, recallId: id, strength,
    question: extra.question || `问题${id}是什么？`, answer: extra.answer || `答案${id}的关键内容`,
    quote: extra.quote || `原文${id}`, subject: extra.subject || 'C 语言', topic: extra.topic || '指针',
    exam: 'zsb', learnedAt: extra.learnedAt || 0, due: true, generated: extra.generated || null,
    reviewLevel, reviewCount, lapses: extra.lapses || 0, ...extra,
  };
}

function wordCard(id, strength, extra = {}) {
  const reviewCount = strength <= 0 ? 0 : strength;
  const reviewLevel = strength <= 0 ? -1 : strength - 1;
  return {
    book: 'vocab', key: `vocab:${id}`, wordId: id, strength, word: extra.word || `word${id}`,
    meaning: extra.meaning || `释义${id}`, phonetic: '/w/', homophone: extra.homophone || '',
    collocations: extra.collocations || [], exams: extra.exams || ['cet4'], learnedAt: extra.learnedAt || 0,
    question: extra.word || `word${id}`, answer: extra.meaning || `释义${id}`, due: true,
    reviewLevel, reviewCount, lapses: extra.lapses || 0,
  };
}

function seedRecall(recall, store, cards) {
  const notes = cards.map(card => ({
    id: card.noteId, title: card.question, content: card.quote, original: card.quote,
    sourceSessionKey: KEY, status: 'active', exam: card.exam || 'zsb', subject: card.subject || 'C 语言',
    topic: card.topic || '指针', triagedAt: 1,
  }));
  store.writeNotes(notes);
  const records = {};
  for (const card of cards) {
    const note = notes.find(item => item.id === card.noteId);
    const record = records[note.id] || {hash: recallHash(note), status: 'ready', cards: []};
    record.cards.push({
      id: card.recallId, question: card.question, answer: card.answer, quote: card.quote,
      reviewLevel: card.reviewLevel, reviewCount: card.reviewCount, lapses: card.lapses || 0,
      nextReviewAt: card.nextReviewAt || 0, learnedAt: card.learnedAt || 0,
    });
    records[note.id] = record;
  }
  recall.write({v: 1, records, days: {}});
}

test('prompts are copied verbatim from the product copy', t => {
  const file = new URL('../../briefs/study-desk-drill/PROMPTS.md', import.meta.url);
  if (!fs.existsSync(file)) {
    t.skip('briefs 不在这个 checkout');
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  const fences = [...text.matchAll(/```\n([\s\S]*?)\n```/g)].map(match => match[1]);
  assert.equal(DRILL_RULES, fences[0]);
  assert.equal(DRILL_JUDGE_RULES, fences[1]);
  assert.equal(DRILL_CHEER_RULES, fences[2]);
});

test('strength comes from review level, count and lapses', () => {
  assert.equal(drillStrength({reviewLevel: -1, reviewCount: 0, lapses: 0}), 0);
  assert.equal(drillStrength({reviewLevel: 3, reviewCount: 0, lapses: 0, learnedAt: 1}), 0);
  assert.equal(drillStrength({reviewLevel: 0, reviewCount: 1, lapses: 0}), 1);
  assert.equal(drillStrength({reviewLevel: 1, reviewCount: 2, lapses: 0}), 2);
  assert.equal(drillStrength({reviewLevel: 2, reviewCount: 3, lapses: 0}), 3);
  assert.equal(drillStrength({reviewLevel: 4, reviewCount: 5, lapses: 0}), 5);
  assert.equal(drillStrength({reviewLevel: 3, reviewCount: 4, lapses: 2}), 3);
  assert.equal(drillStrength({reviewLevel: 3, reviewCount: 6, lapses: 4}), 2);
});

test('rating follows the first try, hints and the per-mode clock', () => {
  assert.equal(mapDrillRating('choice', {correct: true, firstTry: true, ms: 11_000}), 'remembered');
  assert.equal(mapDrillRating('choice', {correct: true, firstTry: true, ms: 12_001}), 'fuzzy');
  assert.equal(mapDrillRating('truefalse', {correct: true, hinted: true, ms: 1000}), 'fuzzy');
  assert.equal(mapDrillRating('cloze', {correct: true, ms: 25_000}), 'remembered');
  assert.equal(mapDrillRating('pairs', {correct: true, ms: 25_001}), 'fuzzy');
  assert.equal(mapDrillRating('write', {correct: true, ms: 1000, verdict: 'partial'}), 'fuzzy');
  assert.equal(mapDrillRating('spell', {correct: false, ms: 1000}), 'forgot');
  assert.equal(mapDrillRating('dictate', {correct: true, firstTry: false, ms: 1000}), null);
  assert.equal(mapDrillRating('look', {correct: true}), null);
  assert.equal(mapDrillRating('meet', {correct: true}), null);
});

test('new note cards show look before the follow-up, and learned cards skip look', () => {
  const cards = [0, 1, 2].map(i => noteCard('n' + i, 0));
  const items = buildSession(cards, {size: 10, source: 'notes', rng: () => 0});
  const runs = maxRun(items.map(item => item.mode));
  assert.ok(runs <= 2, items.map(item => item.mode).join(','));
  for (const look of items.filter(item => item.mode === 'look')) {
    const follow = items.find(item => item.itemId !== look.itemId && item.cardRef.recallId === look.cardRef.recallId);
    assert.ok(follow);
    assert.ok(items.indexOf(look) < items.indexOf(follow));
  }
  const learned = buildSession([noteCard('seen', 0, {learnedAt: 5})], {size: 5, source: 'notes', rng: () => 0});
  assert.equal(learned.some(item => item.mode === 'look'), false);
});

test('a pairs item consumes four or five note cards and they are not dealt again', () => {
  const cards = Array.from({length: 9}, (_, i) => noteCard('p' + i, 1));
  const items = buildSession(cards, {size: 10, source: 'notes', rng: () => 0});
  const pairs = items.filter(item => item.mode === 'pairs');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].cardRef.refs.length, 5);
  const used = new Set(pairs[0].cardRef.refs.map(ref => ref.recallId));
  const again = items.filter(item => item !== pairs[0]).flatMap(item => item.cardRef.recallId ? [item.cardRef.recallId] : []);
  for (const id of used) assert.equal(again.includes(id), false);
  assert.ok(maxRun(items.map(item => item.mode)) <= 2);
  for (const [left, right] of pairs[0].answer) {
    assert.equal(pairs[0].pairs.right[right], pairs[0].reveal.answer.includes(pairs[0].pairs.left[left].slice(0, 2)) ? pairs[0].pairs.right[right] : pairs[0].pairs.right[right]);
    assert.equal(cards.find(card => card.question === pairs[0].pairs.left[left]).answer.slice(0, 12), pairs[0].pairs.right[right]);
  }
});

test('mixed pools alternate one to one and the longer side fills the rest', () => {
  const notes = [1, 2, 3, 4].map(i => noteCard('n' + i, 1));
  const words = [wordCard('w', 1)];
  const mixed = mixDrillCards(notes, words);
  assert.deepEqual(mixed.map(card => card.book), ['notes', 'vocab', 'notes', 'notes', 'notes']);
  const items = buildSession([...notes.slice(0, 2), ...[wordCard('a', 1), wordCard('b', 1)]], {size: 10, source: 'mixed', rng: () => 0});
  const books = new Set(items.map(item => item.cardRef.book));
  assert.equal(books.has('notes'), true);
  assert.equal(books.has('vocab'), true);
});

test('choice modes stay off until four vocabulary cards exist', () => {
  const few = buildSession([wordCard('a', 1), wordCard('b', 1)], {size: 5, source: 'vocab', rng: () => 0});
  assert.equal(few.every(item => !['word2meaning', 'meaning2word', 'listen'].includes(item.mode)), true);
  const enough = [1, 2, 3, 4].map(i => wordCard('w' + i, 1, {word: 'w' + i, meaning: 'm' + i}));
  const items = buildSession(enough, {size: 5, source: 'vocab', rng: () => 0});
  assert.equal(items.some(item => ['meaning2word', 'listen', 'word2meaning'].includes(item.mode)), true);
  const choice = items.find(item => item.options);
  assert.equal(choice.options.length, 4);
  assert.equal(choice.options[choice.answer], choice.mode === 'word2meaning' ? choice.reveal.answer : choice.reveal.question);
});

test('flip-only sessions are entirely flip cards', () => {
  const items = buildSession([noteCard('a', 0), noteCard('b', 3), wordCard('c', 1), wordCard('d', 4)], {size: 10, source: 'mixed', flipOnly: true, rng: () => 0});
  assert.equal(items.every(item => item.mode === 'flip'), true);
});

test('local judging and the session star formula', () => {
  assert.equal(localJudge({answer: '另一个变量的地址', keys: ['地址', '变量'], text: '保存的是另一个变量的地址'}).verdict, 'correct');
  assert.equal(localJudge({answer: '另一个变量的地址', keys: ['地址', '变量'], text: '地址'}).verdict, 'partial');
  assert.equal(localJudge({answer: '另一个变量的地址', keys: ['地址'], text: ''}).verdict, 'wrong');
  assert.equal(localJudge({answer: 'x', keys: ['地址'], text: '完全不沾边'}).comment, '碧琪没来得及细看，按关键词判的');
  assert.equal(drillStars({answerStars: 3, scored: 4, correct: 3, finished: true}), 8);
  assert.equal(drillStars({answerStars: 4, scored: 4, correct: 4, finished: true}), 14);
  assert.equal(localCheer({quiet: true, accuracy: 1, scored: 4, jarFull: true}), '稳住节奏，今晚早点睡');
  assert.equal(localCheer({jarFull: true, accuracy: 0.4, scored: 4}), '今天的星星罐装满了');
  assert.equal(localCheer({accuracy: 1, scored: 4}), '一道没错，记得很牢');
  assert.equal(localCheer({accuracy: 0.5, scored: 4}), '错的那几道，下一组先看它们');
  // 结算页标题是「这一页背完啦 / 了」，本地台词不能和它重字。
  for (const args of [{quiet: true}, {jarFull: true}, {accuracy: 1, scored: 4}, {accuracy: 0.9, scored: 10}, {accuracy: 0, scored: 4}]) {
    assert.equal(/背完/.test(localCheer(args)), false);
  }
});

test('bad generated questions are dropped and the valid modes stay', () => {
  const batch = [{id: 'c1', answer: '另一个变量的地址'}];
  const result = {cards: [{id: 'c1',
    keys: ['地址', '不在答案里的词'],
    choice: {stem: '指针保存什么？', options: ['另一个变量的地址', '变量的值', '函数名', '源文件'], answer: 0, why: '地址'},
    truefalse: {statement: '指针变量保存的是另一个变量的地址。', isTrue: true, why: '原文如此'},
    cloze: {text: '指针保存{{1}}', blanks: ['地址'], distractors: ['数值']},
    order: {steps: ['编译', '编译']},
  }, {id: 'missing', keys: ['地址']}]};
  const kept = validateDrillCards(result, batch);
  assert.deepEqual([...kept.keys()], ['c1']);
  assert.deepEqual(kept.get('c1').keys, ['地址']);
  assert.equal(kept.get('c1').choice.options.length, 4);
  assert.equal(kept.get('c1').truefalse.isTrue, true);
  assert.equal(kept.get('c1').cloze.blanks[0], '地址');
  assert.equal(kept.get('c1').order, undefined);
  const badChoice = validateDrillCards({cards: [{id: 'c1', keys: ['地址'], choice: {stem: '题', options: ['甲', '乙', '丙', '丁'], answer: 4, why: ''}}]}, batch);
  assert.equal(badChoice.get('c1').choice, undefined);
  const longStem = '题'.repeat(601);
  const tooLong = validateDrillCards({cards: [{id: 'c1', keys: ['地址'], choice: {stem: longStem, options: ['另一个变量的地址', '甲', '乙', '丙'], answer: 0, why: '因为'}}]}, batch);
  assert.equal(tooLong.get('c1').choice, undefined);
});

test('answering is idempotent per card, stars only land on the first correct try, and the jar uses Beijing dates', async t => {
  const {drill, recall, store, pact, setClock} = await fixture(t);
  const cards = [noteCard('c1', 1, {nextReviewAt: 0})];
  seedRecall(recall, store, cards);
  let scheduled = 0;
  recall.schedule = (card, rating, now) => { scheduled += 1; return calculateReviewSchedule(card, rating, now); };
  const opened = drill.session({sessionKey: KEY, source: 'notes', scope: {kind: 'due'}, size: 5});
  assert.equal(opened.items.length, 1);
  assert.equal(opened.settings.soundDefault, true);
  const item = opened.items[0];
  const wrong = drill.answer({sessionId: opened.sessionId, itemId: item.itemId, correct: false, firstTry: true, ms: 1000});
  assert.equal(wrong.rating, 'forgot');
  assert.equal(wrong.stars, 0);
  assert.equal(wrong.requeue, true);
  const again = drill.answer({sessionId: opened.sessionId, itemId: item.itemId, correct: true, firstTry: false, ms: 1000});
  assert.equal(again.rating, null);
  assert.equal(again.stars, 0);
  assert.equal(scheduled, 1);
  const learned = noteCard('c0', 0);
  seedRecall(recall, store, [cards[0], learned]);
  const intro = drill.session({sessionKey: KEY, source: 'notes', size: 5});
  const look = intro.items.find(entry => entry.mode === 'look');
  assert.equal(drill.learned({sessionId: intro.sessionId, itemId: look.itemId}).ok, true);
  const stored = recall.read().records[learned.noteId].cards.find(card => card.id === learned.recallId);
  assert.ok(stored.learnedAt > 0);
  setClock(Date.parse('2026-11-01T15:59:00Z'));
  pact.recordDrill({stars: 1});
  assert.equal(pact.jar().today, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pact.daysRoot, '2026-11-01.json'), 'utf8')).stars, 1);
  setClock(Date.parse('2026-11-01T16:01:00Z'));
  assert.equal(pact.jar().today, 0);
  pact.recordQuestion({correct: true});
  assert.equal(pact.jar().today, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pact.daysRoot, '2026-11-01.json'), 'utf8')).stars, 1);
});

test('finishing pays the set bonus, a perfect bonus, and only the first set stamps today', async t => {
  const {drill, recall, store, pact} = await fixture(t);
  drill.setSettings({jarGoal: 15, size: 5});
  const cards = [1, 2, 3, 4, 5].map(i => noteCard('f' + i, 1));
  seedRecall(recall, store, cards);
  const opened = drill.session({sessionKey: KEY, source: 'notes', size: 5});
  for (const item of opened.items) drill.answer({sessionId: opened.sessionId, itemId: item.itemId, correct: true, firstTry: true, ms: 1000});
  const done = drill.finish({sessionId: opened.sessionId});
  assert.equal(done.accuracy, 1);
  assert.equal(done.stars, opened.items.length + 10);
  assert.equal(done.firstFinishToday, true);
  assert.equal(done.jar.unit, 'sets');
  assert.equal(done.jar.today, 1);
  assert.equal(done.jar.goal, 2);
  assert.equal(done.jar.filledNow, false);
  assert.equal(done.streak.stampedToday, true);
  assert.equal(pact.streak().current >= 1, true);
  const repeat = drill.finish({sessionId: opened.sessionId});
  assert.equal(repeat.stars, done.stars);
  assert.equal(pact.readDay('2026-11-04').drillFinished, 1);
  const second = drill.session({sessionKey: KEY, source: 'notes', scope: {kind: 'more'}, size: 5});
  if (second.items[0]) drill.answer({sessionId: second.sessionId, itemId: second.items[0].itemId, correct: true, firstTry: true, ms: 500});
  const again = drill.finish({sessionId: second.sessionId});
  assert.equal(again.firstFinishToday, false);
  assert.equal(again.jar.today, 2);
  assert.equal(again.jar.filledNow, true);
  assert.equal((await drill.cheer({sessionId: opened.sessionId})).line, '一道没错，记得很牢');
});

test('leave slips are issued on Beijing Mondays, cap at two, and bridge a blank day', async t => {
  const {pact, setClock} = await fixture(t, {at: Date.parse('2026-11-01T15:59:00Z')});
  const sunday = pact.leaveNotes({now: Date.parse('2026-11-01T15:59:00Z')});
  assert.equal(sunday.grantedWeek, '2026-10-26');
  assert.equal(sunday.balance, 1);
  const monday = pact.leaveNotes({now: Date.parse('2026-11-01T16:01:00Z')});
  assert.equal(monday.grantedWeek, '2026-11-02');
  assert.equal(monday.balance, 2);
  assert.equal(pact.leaveNotes({now: Date.parse('2026-11-08T16:01:00Z')}).balance, 2);
  setClock(Date.parse('2026-11-04T02:00:00Z'));
  for (const date of ['2026-11-02', '2026-11-04']) {
    fs.mkdirSync(pact.daysRoot, {recursive: true});
    fs.writeFileSync(path.join(pact.daysRoot, `${date}.json`), JSON.stringify({
      date, minutes: 40, questions: {answered: 20, correct: 20}, reviews: {done: 20}, notes: {added: 0},
      completedAt: Date.parse(`${date}T02:00:00Z`),
    }));
  }
  const bridged = pact.drillStreak();
  // 11-03 夹在两个盖章日中间，用一张补上；11-01 往前没有连续可保，不用。11-02 到 11-04 连成 3 天。
  assert.equal(bridged.current, 3);
  assert.equal(bridged.leaveUsedYesterday, true);
  assert.equal(bridged.weekKind[1], 'leave');
  assert.equal(bridged.leaveNotes, 1);
  assert.deepEqual(pact.streak(), {current: 1, best: 1});
  const again = pact.drillStreak();
  assert.equal(again.current, 3);
  assert.equal(again.leaveNotes, 1);
});

test('today.drill has the jar, the week and the due counts', async t => {
  const {store, drill, recall, vocab} = await fixture(t);
  seedRecall(recall, store, [noteCard('due', 1)]);
  vocab.write([{
    id: 'w-due', word: 'pointer', hint: '指针', status: 'ready', meaning: '指针', phonetic: '/p/', homophone: '坡因特',
    collocations: [], example: {en: '', zh: ''}, exams: [{id: 'cet4', tier: '核心'}],
    reviewLevel: 1, reviewCount: 2, lapses: 0, nextReviewAt: 0, createdAt: 1,
  }]);
  const desk = new LearningDesk(store, {now: () => Date.parse('2026-11-04T02:00:00Z')});
  const today = desk.today({sessionKey: KEY});
  assert.equal(today.drill.jar.goal, 2);
  assert.equal(today.drill.jar.unit, 'sets');
  assert.equal(today.drill.streak.week.length, 7);
  assert.equal(today.drill.streak.weekKind.length, 7);
  assert.equal(typeof today.drill.streak.stampedToday, 'boolean');
  assert.equal(typeof today.drill.leaveUsedYesterday === 'boolean' || typeof today.drill.streak.leaveUsedYesterday === 'boolean', true);
  assert.equal(today.drill.dueNotes, 1);
  assert.equal(today.drill.dueWords, 1);
  assert.equal(drill.today().dueNotes, 1);
});

test('a changed recall card drops the old generated question', async t => {
  const {drill, recall, store} = await fixture(t);
  const card = noteCard('hash', 2, {answer: '另一个变量的地址', question: '指针变量保存什么？'});
  seedRecall(recall, store, [card]);
  const data = drill.read();
  data.cards.hash = {hash: 'stale-hash', status: 'ready', items: {keys: ['地址'], choice: {stem: 'OLD_STEM', options: ['另一个变量的地址', '甲', '乙', '丙'], answer: 0, why: '旧'}}, at: 1};
  drill.write(data);
  const opened = drill.session({sessionKey: KEY, source: 'notes', size: 5});
  assert.equal(opened.items.some(item => item.prompt === 'OLD_STEM'), false);
  assert.equal(fs.statSync(drill.file).mode & 0o777, 0o600);
});

test('settings reject unknown sizes and sessions keep only the latest twenty', async t => {
  const {drill, recall, store} = await fixture(t);
  assert.throws(() => drill.setSettings({size: 7}), /5、10、15 或 20/);
  assert.throws(() => drill.setSettings({jarGoal: 20}), /15、30 或 50/);
  drill.setSettings({size: 5, flipOnly: true});
  seedRecall(recall, store, [noteCard('only', 1)]);
  const ids = [];
  for (let i = 0; i < 21; i += 1) ids.push(drill.session({sessionKey: KEY, source: 'notes', size: 5}).sessionId);
  const kept = Object.keys(drill.read().sessions);
  assert.equal(kept.length, 20);
  assert.equal(kept.includes(ids[0]), false);
  assert.throws(() => drill.answer({sessionId: ids[0], itemId: 'd1', correct: true, firstTry: true}), /不在了/);
});

test('gateway methods are registered on the learning drill prefix', async t => {
  const {store, organizer, vocab} = await fixture(t);
  const methods = new Map();
  registerLearningGateway({registerGatewayMethod(name, fn, opts) { methods.set(name, {fn, opts}); }}, store, {organizer, vocab});
  for (const name of ['session', 'judge', 'answer', 'learned', 'finish', 'cheer', 'settings.get', 'settings.set']) {
    const method = methods.get('pinkie.learning.drill.' + name);
    assert.equal(method.opts.scope, 'operator.admin');
  }
});

function goodQuestion(card, {order = null} = {}) {
  return {id: card.id, keys: ['地址'],
    choice: {stem: '指针变量保存什么？', options: ['另一个变量的地址', '变量自己的值', '函数的名字', '源文件路径'], answer: 0, why: '保存的是地址'},
    truefalse: {statement: '指针变量保存的是另一个变量的地址。', isTrue: true, why: '和原文一致'},
    cloze: {text: '指针变量保存{{1}}', blanks: ['地址'], distractors: ['数值', '函数']},
    order};
}

test('model questions enter the session, a bad card is kept without its bad modes, and 429 stops the round', async t => {
  const {drill, recall, store, organizer} = await fixture(t);
  let calls = 0;
  let block = true;
  organizer.status = () => ({available: true, model: 'qa/fake', modelName: 'QA'});
  organizer.requestModel = async (_model, rules, input) => {
    calls += 1;
    if (!String(rules).includes('出题')) throw new Error('不该走到别的提示词');
    if (block) throw new Error('笔记整理模型请求失败（429），笔记保持原样');
    return {cards: input.map(card => card.id === 'bad' ? {id: card.id, keys: ['不在答案里']} : goodQuestion(card))};
  };
  const burst = Array.from({length: 8}, (_, i) => noteCard('b' + i, 1, {answer: '另一个变量的地址', question: '指针变量保存什么？'}));
  seedRecall(recall, store, burst);
  drill.session({sessionKey: KEY, source: 'notes', size: 5});
  await drill.running;
  assert.equal(calls, 1);
  assert.equal([...drill.requested].length, 0);
  assert.equal(Object.values(drill.read().cards).every(card => card.status === 'failed'), true);
  block = false;
  const practice = [noteCard('ok', 1, {answer: '另一个变量的地址', question: '指针变量保存什么？'}), noteCard('bad', 1, {answer: '编译要经过四步', question: '编译过程是什么？'})];
  seedRecall(recall, store, practice);
  drill.session({sessionKey: KEY, source: 'notes', size: 5});
  await drill.running;
  const opened = drill.session({sessionKey: KEY, source: 'notes', size: 5});
  assert.equal(opened.items.some(item => item.mode === 'choice' && item.prompt === '指针变量保存什么？'), true);
  assert.equal(opened.items.some(item => item.cardRef.recallId === 'bad' && item.mode === 'choice'), false);
  const before = calls;
  const record = recall.read();
  record.records[practice[0].noteId].cards[0].answer = '保存的是内存地址';
  recall.write(record);
  drill.session({sessionKey: KEY, source: 'notes', size: 5});
  await drill.running;
  assert.equal(calls > before, true);
  assert.notEqual(drill.read().cards.ok.hash, drillCardHash({question: '指针变量保存什么？', answer: '另一个变量的地址', quote: practice[0].quote}));
});

test('write judging and the closing line use the model, then fall back locally', async t => {
  const {drill, recall, store, organizer, pact} = await fixture(t);
  let mode = 'ok';
  organizer.status = () => ({available: true, model: 'qa/fake', modelName: 'QA'});
  organizer.requestModel = async (_model, rules) => {
    if (String(rules).includes('出题')) return {cards: []};
    if (String(rules).includes('检查默写')) {
      if (mode === 'slow') throw new Error('笔记整理超时，请稍后再试');
      return {verdict: 'partial', missing: ['地址'], comment: '差了地址这个词'};
    }
    if (String(rules).includes('学习搭子')) {
      if (mode === 'slow') throw new Error('笔记整理超时，请稍后再试');
      return {line: '计网那组连对得很稳'};
    }
    throw new Error(rules.slice(0, 20));
  };
  const card = noteCard('write', 3, {answer: '另一个变量的地址', question: '指针变量保存什么？'});
  seedRecall(recall, store, [card]);
  const data = drill.read();
  data.cards.write = {hash: drillCardHash(card), status: 'ready', items: {keys: ['地址'], choice: goodQuestion({id: 'write'}).choice}, at: 1};
  drill.write(data);
  const opened = drill.session({sessionKey: KEY, source: 'notes', size: 5});
  const write = opened.items.find(item => item.mode === 'write');
  assert.equal(write.judge, 'model');
  const judged = await drill.judge({sessionId: opened.sessionId, itemId: write.itemId, text: '变量'});
  assert.equal(judged.verdict, 'partial');
  assert.equal(judged.comment, '差了地址这个词');
  mode = 'slow';
  const local = await drill.judge({sessionId: opened.sessionId, itemId: write.itemId, text: ''});
  assert.equal(local.verdict, 'wrong');
  assert.equal(local.comment, '碧琪没来得及细看，按关键词判的');
  drill.answer({sessionId: opened.sessionId, itemId: write.itemId, correct: true, firstTry: true, ms: 1000, verdict: 'partial'});
  mode = 'ok';
  pact.set({exams: [{id: 'zsb', date: '2026-11-08'}]});
  const done = drill.finish({sessionId: opened.sessionId});
  assert.equal(done.quiet, true);
  assert.equal((await drill.cheer({sessionId: opened.sessionId})).line, '计网那组连对得很稳');
  mode = 'slow';
  assert.equal((await drill.cheer({sessionId: opened.sessionId})).line, '稳住节奏，今晚早点睡');
});

function maxRun(modes) {
  let best = 0;
  let run = 0;
  let prev = '';
  for (const mode of modes) {
    run = mode === prev ? run + 1 : 1;
    prev = mode;
    best = Math.max(best, run);
  }
  return best;
}

function writeDay(pact, date, value) {
  fs.mkdirSync(pact.daysRoot, {recursive: true});
  fs.writeFileSync(path.join(pact.daysRoot, `${date}.json`), JSON.stringify({date, notes: {added: 0}, ...value}));
}

test('local judging keeps signs, operators and degrees', () => {
  assert.equal(foldDrillText('−10'), foldDrillText('-10'));
  assert.notEqual(foldDrillText('−10'), foldDrillText('10'));
  assert.equal(localJudge({answer: '−10', keys: ['−10'], text: '10'}).verdict, 'wrong');
  assert.equal(localJudge({answer: '−10', keys: [], text: '10'}).verdict, 'wrong');
  assert.equal(localJudge({answer: '−10', keys: ['−10'], text: '－10'}).verdict, 'correct');
  assert.equal(localJudge({answer: 'a > b', keys: ['a > b'], text: 'a < b'}).verdict, 'wrong');
  assert.equal(localJudge({answer: 'a > b', keys: [], text: 'a < b'}).verdict, 'wrong');
  assert.equal(localJudge({answer: '90°', keys: ['90°'], text: '90度'}).verdict, 'correct');
  assert.equal(localJudge({answer: '90°', keys: [], text: '90 度'}).verdict, 'correct');
  assert.equal(localJudge({answer: '“地址”。', keys: [], text: '地址'}).verdict, 'correct');
  // 判题抽检里本地兜底把「MAC 解析为 IP」判成了对；关键词顺序反了只给部分对。
  assert.equal(localJudge({answer: '将 IP 地址解析为 MAC 地址', keys: ['IP 地址', 'MAC 地址'], text: '将 MAC 地址解析为 IP 地址'}).verdict, 'partial');
  assert.equal(localJudge({answer: '将 IP 地址解析为 MAC 地址', keys: ['IP 地址', 'MAC 地址'], text: '把ip地址解析成mac地址'}).verdict, 'correct');
  const cloze = validateDrillCards({cards: [{id: 'n', keys: ['−10'], cloze: {text: '温度是 {{1}} 度', blanks: ['−10'], distractors: ['10', '-5']}}]},
    [{id: 'n', answer: '温度是 −10 度'}]);
  assert.deepEqual(cloze.get('n').cloze.blanks, ['−10']);
});

test('a brand-new learner keeps the leave slip and sees no streak', async t => {
  const {pact, drill} = await fixture(t);
  const streak = pact.drillStreak();
  assert.equal(streak.current, 0);
  assert.equal(streak.leaveUsedYesterday, false);
  assert.equal(streak.leaveNotes, 1);
  assert.equal(drill.today().streak.leaveUsedYesterday, false);
  assert.equal(pact.readDrillMeta().balance, 1);
  assert.deepEqual(pact.readDrillMeta().used, {});
});

test('a blank Tuesday between a stamped Monday and Wednesday becomes leave', async t => {
  const {pact} = await fixture(t, {at: Date.parse('2026-11-04T02:00:00Z')});
  writeDay(pact, '2026-11-02', {drillFinished: 1, stars: 10});
  const wednesday = pact.drillStreak();
  assert.equal(wednesday.current, 2);
  assert.equal(wednesday.leaveUsedYesterday, true);
  assert.deepEqual(wednesday.weekKind.slice(0, 3), ['stamped', 'leave', 'empty']);
  assert.equal(wednesday.leaveNotes, 0);
});

test('a partial day can be bridged by a leave slip', async t => {
  const {pact} = await fixture(t, {at: Date.parse('2026-11-04T02:00:00Z')});
  writeDay(pact, '2026-11-02', {drillFinished: 1, stars: 10});
  writeDay(pact, '2026-11-03', {minutes: 3, questions: {answered: 1, correct: 1}, reviews: {done: 0}});
  writeDay(pact, '2026-11-04', {drillFinished: 1, stars: 8});
  const streak = pact.drillStreak();
  assert.equal(streak.current, 3);
  assert.equal(streak.weekKind[1], 'leave');
});

test('the closing line sees the finish result, not the bare summary', async t => {
  const {drill, recall, store, organizer, pact} = await fixture(t);
  let payload = null;
  organizer.status = () => ({available: true, model: 'qa/fake', modelName: 'QA'});
  organizer.requestModel = async (_model, rules, input) => {
    if (String(rules).includes('学习搭子')) { payload = input; return {line: '计网那组连对得很稳'}; }
    return {cards: []};
  };
  drill.setSettings({jarGoal: 15, size: 5});
  pact.recordDrill({stars: 10});
  const cards = [1, 2, 3, 4, 5].map(i => noteCard('c' + i, 1, {nextReviewAt: 0}));
  seedRecall(recall, store, cards);
  const opened = drill.session({sessionKey: KEY, source: 'notes', size: 5});
  for (const item of opened.items) drill.answer({sessionId: opened.sessionId, itemId: item.itemId, correct: true, firstTry: true, ms: 800});
  const done = drill.finish({sessionId: opened.sessionId});
  await drill.cheer({sessionId: opened.sessionId});
  assert.ok(payload);
  assert.equal(payload.firstFinishToday, true);
  assert.equal(payload.stars, done.stars);
  assert.equal(payload.stars, opened.items.filter(item => item.mode !== 'look').length + 10);
  assert.equal(payload.jarFull, done.jar.filledNow);
  assert.equal(payload.jarFull, false);
});

test('pairs use keys[0] on the right, truncate with an ellipsis, and skip duplicate labels', () => {
  assert.equal(pairLabel(noteCard('k', 1, {answer: '存放另一个变量的地址的变量', generated: {keys: ['地址']}})), '地址');
  assert.equal(pairLabel(noteCard('k', 1, {answer: '一二三四五六七八九十十一十二十三'})), '一二三四五六七八九十十一…');
  const keyed = Array.from({length: 5}, (_, i) => noteCard('q' + i, 1, {generated: {keys: ['关键' + i]}}));
  const items = buildSession(keyed, {size: 10, source: 'notes', rng: () => 0});
  const pairs = items.find(item => item.mode === 'pairs');
  assert.deepEqual([...pairs.pairs.right].sort(), ['关键0', '关键1', '关键2', '关键3', '关键4']);
  const dupes = Array.from({length: 5}, (_, i) => noteCard('d' + i, 1, {generated: {keys: [i < 2 ? '地址' : '值' + i]}}));
  const plain = buildSession(dupes, {size: 10, source: 'notes', rng: () => 0});
  assert.equal(plain.some(item => item.mode === 'pairs'), false);
  assert.equal(plain.length, 5);
});

test('notes without recall cards are sent to the recall queue instead of leaving an empty set', async t => {
  const {drill, store, recall, organizer} = await fixture(t);
  let calls = 0;
  organizer.status = () => ({available: true, model: 'qa/fake', modelName: 'QA'});
  organizer.requestModel = () => { calls += 1; return new Promise(() => {}); };
  store.writeNotes([{id: 'bare', title: 'ARP', content: 'ARP 把 IP 地址解析为 MAC 地址。', original: 'ARP 把 IP 地址解析为 MAC 地址。',
    sourceSessionKey: KEY, status: 'active', exam: 'zsb', subject: '计算机网络', topic: '协议', triagedAt: 1}]);
  assert.throws(() => drill.session({sessionKey: KEY, source: 'notes'}), /正在把笔记拆成回忆卡/);
  assert.equal(['queued', 'running'].includes(recall.read().records.bare?.status), true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1);
});

test('notes saved from any learning chat are drilled, whichever chat opens the drill', async t => {
  const {drill, recall, store} = await fixture(t);
  seedRecall(recall, store, [noteCard('elsewhere', 1, {nextReviewAt: 0})]);
  const opened = drill.session({sessionKey: 'agent:learning:dashboard:other-chat', source: 'notes', size: 5});
  assert.equal(opened.items.length, 1);
  assert.equal(opened.items[0].cardRef.recallId, 'elsewhere');
  const result = drill.answer({sessionId: opened.sessionId, itemId: opened.items[0].itemId, correct: true, firstTry: true, ms: 800});
  assert.equal(result.rating, 'remembered');
  const card = recall.read().records['note-elsewhere'].cards[0];
  assert.ok(card.drillSessions?.[opened.sessionId]);
});

test('做完才讲：讲解顺着标准答案，没做完不能要', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-explain-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
  let payload;
  const organizer = {catalog: () => ({defaultRef: 'qa/explain'}), requestModel: async (_model, rules, body) => { payload = body; assert.equal(rules, EXPLAIN_RULES); return {text: 'impact 后面固定用 on。'}; }};
  const drill = new LearningDrill(store, {organizer});
  const session = {sessionId: 's1', sessionKey: KEY, items: [{itemId: 'd1', mode: 'choice', prompt: 'impact ___', reveal: {question: 'impact ___ business', answer: 'on', extra: '介词用 on'}}], answers: [], graded: {}, learned: {}};
  drill.save(session);
  await assert.rejects(() => drill.explain({sessionId: 's1', itemId: 'd1', yours: 'in'}), /先做完/);
  session.answers.push({itemId: 'd1', correct: false});
  drill.save(session);
  const told = await drill.explain({sessionId: 's1', itemId: 'd1', yours: 'in'});
  assert.equal(told.source, 'model');
  assert.equal(told.text, 'impact 后面固定用 on。');
  assert.equal(payload.standard, 'on');
  assert.equal(payload.yours, 'in');
  assert.equal(payload.correct, false);
  organizer.requestModel = async () => { throw new Error('不该再叫模型'); };
  const again = await drill.explain({sessionId: 's1', itemId: 'd1', yours: 'in'});
  assert.equal(again.text, told.text);
});
