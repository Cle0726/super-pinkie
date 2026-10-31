import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';
import {LearningDesk} from '../services/mode-architecture/learning-desk.mjs';
import {LearningVocab} from '../services/mode-architecture/learning-vocab.mjs';
import {LearningRefs, createLearningDeskTool, parseRef, refsInText, registerLearningRefs} from '../services/mode-architecture/learning-refs.mjs';

const SESSION = 'agent:learning:desk-chat:refs-test';
const AT = Date.parse('2026-10-29T12:00:00Z'); // 北京时间 20:00
const DAY = 86_400_000;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-refs-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = AT;
  const now = () => clock;
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace')});
  store.pact = new LearningPact(store, {now});
  store.desk = new LearningDesk(store, {now});
  store.vocab = new LearningVocab(store, {});
  const refs = new LearningRefs(store, {now});
  const attempt = (overrides = {}) => store.writeAttempt({id: `a-${Math.random().toString(36).slice(2)}`, sessionKey: SESSION, itemId: 'zsb-c5-75',
    question: {id: 'zsb-c5-75', topic: 'C语言 · 循环结构', question: 'while 和 do-while 的区别是什么？', answer: 'SECRET-ANSWER'},
    submission: {confidence: 70, hintUsed: false, answer: 'do-while 至少执行一次'}, result: {correct: false, explanation: '讲解'}, createdAt: clock, ...overrides});
  return {store, refs, attempt, setClock: at => { clock = at; }};
}

test('refs parse strictly and the hidden marker yields at most 8 unique refs', () => {
  assert.deepEqual(parseRef('point:c5.1'), {kind: 'point', id: 'c5.1', ref: 'point:c5.1'});
  for (const bad of ['', 'point', 'nope:x', 'point:', 'point:a b', 'POINT:c5.1']) assert.equal(parseRef(bad), null, bad);
  const text = '这个怎么理解？[[DESK_REF_V1 point:c5.1 word:w1 point:c5.1]] 还有 [[DESK_REF_V1 note:n1]]';
  assert.deepEqual(refsInText(text).map(ref => ref.ref), ['point:c5.1', 'word:w1', 'note:n1']);
  const many = `[[DESK_REF_V1 ${Array.from({length: 8}, (_, i) => `word:w${i}`).join(' ')}]] [[DESK_REF_V1 word:w9]]`;
  assert.equal(refsInText(many).length, 8);
  assert.deepEqual(refsInText('[[DESK_REF_V1]] [[DESK_REF_V2 point:c5.1]]'), []);
});

test('resolve: points carry real evidence, unanswered attempts are refused, answers never leak', t => {
  const {store, refs, attempt} = fixture(t);
  const a = attempt();
  store.writeAttempt({id: 'a-open', sessionKey: SESSION, question: {id: 'zsb-c5-76', question: '没作答', answer: 'OPEN-ANSWER'}, createdAt: AT});
  const {cards} = refs.resolve({refs: ['point:c5.1', `attempt:${a.id}`, `wrong:${a.id}`, 'attempt:a-open', 'point:c99.1', 'bogus']});
  assert.equal(cards[0].ok, true);
  assert.match(cards[0].title, /\S/);
  assert.equal(cards[0].state, 'weak');
  assert.equal(cards[1].ok, true);
  assert.equal(cards[1].state, 'weak');
  assert.equal(cards[1].status, '待复测');
  assert.equal(cards[2].ok, true);
  assert.deepEqual([cards[3].ok, cards[3].error], [false, '这道题还没作答']);
  assert.equal(cards[4].ok, false);
  assert.deepEqual([cards[5].ok, cards[5].error], [false, '条目地址不对']);
  const raw = JSON.stringify(cards);
  assert.ok(!raw.includes('SECRET-ANSWER') && !raw.includes('OPEN-ANSWER'), 'cards carry no bank answers');
  assert.ok(!('detail' in cards[0]), 'detail stays server-side');
  const context = refs.context(`看看 [[DESK_REF_V1 attempt:${a.id} attempt:a-open]]`);
  assert.match(context, /先生的答案：do-while 至少执行一次（错/);
  assert.match(context, /这道题还没作答/);
  assert.ok(!context.includes('SECRET-ANSWER') && !context.includes('OPEN-ANSWER'));
  assert.equal(refs.context('普通消息'), '');
});

test('collect into notes, wrong book, vocab and tomorrow memos; every receipt undoes cleanly', t => {
  const {store, refs, attempt} = fixture(t);
  assert.throws(() => refs.collect({sessionKey: 'agent:main:x', target: 'note', text: 'x'}), /学习模式/);
  assert.throws(() => refs.collect({sessionKey: SESSION, target: 'trash', text: 'x'}), /只能收进/);
  assert.throws(() => refs.collect({sessionKey: SESSION, target: 'note', text: '  '}), /空的/);

  const origin = {sessionKey: SESSION, messageId: 'm-1', quote: 'for 循环三段式', at: AT - 5};
  const note = refs.collect({sessionKey: SESSION, target: 'note', text: 'for 循环三段式：初始化；条件；步进', origin});
  assert.equal(note.receipt.target, 'note');
  assert.match(note.receipt.ref, /^note:/);
  assert.deepEqual(note.receipt.origin, origin);
  const noteId = note.receipt.ref.slice(5);
  assert.ok(store.readNotesState().notes.some(item => item.id === noteId && item.tags.includes('收进手账')));
  assert.equal(refs.resolve({refs: [note.receipt.ref]}).cards[0].origin.messageId, 'm-1', 'resolve points back to the chat message');

  const a = attempt();
  const wrong = refs.collect({sessionKey: SESSION, target: 'wrong', text: '我老是忘了 do-while', ref: `attempt:${a.id}`});
  const wrongNote = store.readNotesState().notes.find(item => `note:${item.id}` === wrong.receipt.ref);
  assert.match(wrongNote.title, /^错题 · /);
  assert.ok(wrongNote.tags.includes('错题'));
  assert.match(wrongNote.content, /先生的答案/);
  assert.ok(!wrongNote.content.includes('SECRET-ANSWER'));

  const word = refs.collect({sessionKey: SESSION, target: 'word', text: 'ambulance 救护车'});
  assert.equal(word.receipt.title, 'ambulance');
  const dup = refs.collect({sessionKey: SESSION, target: 'word', text: 'ambulance'});
  assert.equal(dup.duplicate, true);
  assert.equal(dup.receipt.undoable, false);

  const memo = refs.collect({sessionKey: SESSION, target: 'plan', text: '明天先复习 do-while'});
  assert.equal(memo.receipt.ref, 'plan:2026-10-30', 'tomorrow is a Beijing date');
  assert.equal(refs.memosFor('2026-10-30').length, 1);

  const biqi = refs.collect({sessionKey: SESSION, target: 'note', text: '碧琪帮记的', by: 'biqi'});
  assert.equal(biqi.receipt.by, 'biqi');
  assert.ok(store.readNotesState().notes.find(item => `note:${item.id}` === biqi.receipt.ref).tags.includes('碧琪收的'));

  assert.equal(refs.receipts({sessionKey: SESSION}).receipts.length, 6);
  for (const r of [note, wrong, word, memo, biqi]) assert.equal(refs.undo({receiptId: r.receipt.receiptId}).ok, true);
  assert.equal(refs.undo({receiptId: note.receipt.receiptId}).already, true);
  assert.throws(() => refs.undo({receiptId: dup.receipt.receiptId}), /不能撤销/);
  assert.equal(store.readNotesState().notes.filter(item => item.status !== 'moved').length, 0);
  assert.equal(store.vocab.read().words.length, 0);
  assert.equal(refs.memosFor('2026-10-30').length, 0);
  assert.ok(refs.receipts({sessionKey: SESSION}).receipts.filter(r => r.undoable).length === 0);
  const lines = fs.readFileSync(refs.file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.filter(line => line.type === 'undo').length, 5, 'undo is appended, never rewritten');
});

test('biqi regrade writes a receipt with actor=biqi and can only be undone within 24 hours', t => {
  const {store, refs, attempt, setClock} = fixture(t);
  const a = attempt();
  assert.throws(() => refs.regrade({sessionKey: SESSION, attemptId: a.id, correct: 'yes'}), /true 或 false/);
  assert.equal(refs.regrade({sessionKey: SESSION, attemptId: a.id, correct: false, reason: 'x'}).unchanged, true);
  const r = refs.regrade({sessionKey: SESSION, attemptId: a.id, correct: true, reason: '答案其实对'});
  assert.equal(r.receipt.action, 'regrade');
  assert.equal(r.receipt.undoUntil, AT + DAY);
  const fresh = store.readAttempt('agent:learning:notes-library', a.id);
  assert.equal(fresh.result.correct, true);
  assert.equal(fresh.corrections.at(-1).actor, 'biqi');
  refs.undo({receiptId: r.receipt.receiptId});
  assert.equal(store.readAttempt('agent:learning:notes-library', a.id).result.correct, false);

  const again = refs.regrade({sessionKey: SESSION, attemptId: a.id, correct: true, reason: '再改一次'});
  setClock(AT + DAY + 1);
  assert.equal(refs.receipts({id: again.receipt.receiptId}).receipt.undoable, false);
  assert.throws(() => refs.undo({receiptId: again.receipt.receiptId}), /24 小时/);
});

test('biqi plans are proposals until adopted; undoing restores the previous tomorrow plan', t => {
  const {store, refs} = fixture(t);
  assert.throws(() => refs.propose({sessionKey: SESSION, items: [{kind: 'learn', k: 'nope', i: 1}]}), /能用的考点/);
  const plan = refs.propose({sessionKey: SESSION, text: '明天学循环', items: [{kind: 'learn', k: 'c5', i: 1}, {kind: 'set', chapter: 'c5', size: 6}, {kind: 'set', chapter: 'c5', size: 99}]});
  assert.equal(plan.items.length, 2, 'invalid set size is dropped');
  assert.equal(plan.date, '2026-10-30');
  assert.equal(store.pact.get().tomorrowPlan, undefined, 'proposal does not touch the pact');
  assert.equal(refs.planGet({id: plan.id}).plan.adopted, false);
  const adopted = refs.planAdopt({id: plan.id, sessionKey: SESSION});
  assert.equal(store.pact.get().tomorrowPlan.id, plan.id);
  assert.equal(refs.planAdopt({id: plan.id}).already, true);
  assert.equal(refs.resolve({refs: ['plan:2026-10-30']}).cards[0].ok, true);
  refs.undo({receiptId: adopted.receipt.receiptId});
  assert.equal(store.pact.get().tomorrowPlan, undefined, 'undo removes the adopted plan when there was none before');

  const first = refs.propose({sessionKey: SESSION, items: [{kind: 'learn', k: 'c5', i: 2}]});
  refs.planAdopt({id: first.id});
  const second = refs.propose({sessionKey: SESSION, items: [{kind: 'learn', k: 'c5', i: 3}]});
  const swap = refs.planAdopt({id: second.id});
  refs.undo({receiptId: swap.receipt.receiptId});
  assert.equal(store.pact.get().tomorrowPlan.id, first.id, 'undo brings back the earlier plan');
});

test('learning_desk tool: learning sessions only, inline cards, no direct mastery writes', async t => {
  const {refs, attempt} = fixture(t);
  const outside = createLearningDeskTool(refs, {sessionKey: 'agent:main:x'});
  const denied = await outside.execute('1', {action: 'open', ref: 'point:c5.1'});
  assert.equal(denied.isError, true);
  const tool = createLearningDeskTool(refs, {sessionKey: SESSION});
  const open = (await tool.execute('2', {action: 'open', ref: 'point:c5.1'})).details;
  assert.deepEqual([open.ok, open.inline.kind, open.inline.id, open.inline.sessionKey], [true, 'desk_card', 'point:c5.1', SESSION]);
  const collect = (await tool.execute('3', {action: 'collect', target: 'word', text: 'ambulance'})).details;
  assert.equal(collect.inline.kind, 'desk_receipt');
  assert.equal(collect.receipt.by, 'biqi');
  const plan = (await tool.execute('4', {action: 'plan', items: [{kind: 'learn', k: 'c5', i: 1}]})).details;
  assert.equal(plan.inline.kind, 'desk_plan');
  const a = attempt();
  const regrade = (await tool.execute('5', {action: 'regrade', attempt_id: a.id, correct: true, reason: '判错了'})).details;
  assert.equal(regrade.inline.kind, 'desk_receipt');
  assert.equal((await tool.execute('6', {action: 'master', ref: 'point:c5.1'})).isError, true);
  assert.deepEqual(tool.parameters.properties.action.enum, ['open', 'collect', 'plan', 'regrade']);
  tool.prepareBeforeToolCallParams({}, {hookContext: {sessionKey: 'agent:main:y'}});
  assert.equal((await tool.execute('7', {action: 'open', ref: 'point:c5.1'})).isError, true, 'session key follows the hook context');
});

test('gateway: RPCs, tool factory and before_prompt_build hook only act in learning sessions', async t => {
  const {store} = fixture(t);
  const methods = new Map(), hooks = [], tools = [];
  const api = {registerGatewayMethod: (name, handler, options) => methods.set(name, {handler, options}),
    registerTool: (factory, options) => tools.push({factory, options}), on: (name, handler, options) => hooks.push({name, handler, options})};
  registerLearningRefs(api, store, {now: () => AT});
  assert.deepEqual([...methods.keys()].sort(), ['pinkie.learning.ref.collect', 'pinkie.learning.ref.memos', 'pinkie.learning.ref.plan.adopt',
    'pinkie.learning.ref.plan.get', 'pinkie.learning.ref.receipts', 'pinkie.learning.ref.resolve', 'pinkie.learning.ref.undo']);
  assert.equal(methods.get('pinkie.learning.ref.resolve').options.scope, 'operator.read');
  assert.equal(methods.get('pinkie.learning.ref.collect').options.scope, 'operator.admin');
  const call = (name, params) => new Promise(resolve => methods.get(name).handler({params, respond: (ok, value, error) => resolve({ok, value, error})}));
  const collected = await call('pinkie.learning.ref.collect', {sessionKey: SESSION, target: 'note', text: 'x', by: 'biqi'});
  assert.equal(collected.ok, true);
  assert.equal(collected.value.receipt.by, 'user', 'RPC callers cannot claim to be biqi');
  const failed = await call('pinkie.learning.ref.undo', {receiptId: 'nope'});
  assert.deepEqual([failed.ok, failed.error.code], [false, 'INVALID_REQUEST']);

  assert.equal(tools[0].options.name, 'learning_desk');
  assert.equal(tools[0].factory({sessionKey: 'agent:main:x'}), null);
  assert.equal(tools[0].factory({sessionKey:'agent:learning:ordinary-chat'}),null);
  assert.equal(tools[0].factory({sessionKey: SESSION}).name, 'learning_desk');

  const hook = hooks.find(item => item.name === 'before_prompt_build');
  const prompt = '解释一下 [[DESK_REF_V1 point:c5.1]]';
  assert.equal(hook.handler({prompt}, {sessionKey: 'agent:main:x'}), undefined);
  assert.match(hook.handler({prompt:'普通'},{sessionKey:SESSION}).prependContext,/学习台独立对话[\s\S]*不要沿用/);
  assert.equal(hook.handler({prompt:'普通'},{sessionKey:'agent:learning:ordinary'}),undefined);
  assert.match(hook.handler({prompt}, {sessionKey: SESSION}).prependContext, /先生从手账里带过来的条目[\s\S]*考点 c5\.1/);
});
