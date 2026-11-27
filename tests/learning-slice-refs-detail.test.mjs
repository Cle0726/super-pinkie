// B3a 复发测试：手账条目交给模型当「真实记录」时，超长的题目 / 讲解 / 笔记正文被悄悄截断，
// 模型（以及收进错题笔记的用户）会把半截当全文。截可以，但必须标明「后略」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore} from '../services/mode-architecture/learning.mjs';
import {LearningPact} from '../services/mode-architecture/learning-pact.mjs';
import {LearningDesk} from '../services/mode-architecture/learning-desk.mjs';
import {LearningVocab} from '../services/mode-architecture/learning-vocab.mjs';
import {LearningRefs} from '../services/mode-architecture/learning-refs.mjs';

const SESSION = 'agent:learning:desk-chat:slice-test';
const AT = Date.parse('2026-10-29T12:00:00Z');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-refs-slice-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const now = () => AT;
  const store = new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace')});
  store.pact = new LearningPact(store, {now});
  store.desk = new LearningDesk(store, {now});
  store.vocab = new LearningVocab(store, {});
  return {store, refs: new LearningRefs(store, {now})};
}

test('条目详情超长时标明「后略」，短的照原样', t => {
  const {store, refs} = fixture(t);
  const longQuestion = '阅读下面这段材料并回答问题。'.repeat(40) + 'QUESTION-TAIL';
  const longExplain = '因为这里考的是循环条件的判断时机。'.repeat(50) + 'EXPLAIN-TAIL';
  store.writeAttempt({id: 'a-long', sessionKey: SESSION, itemId: 'zsb-c5-75',
    question: {id: 'zsb-c5-75', topic: 'C语言 · 循环结构', question: longQuestion, answer: 'SECRET-ANSWER'},
    submission: {confidence: 70, hintUsed: false, answer: 'do-while 至少执行一次'}, result: {correct: false, explanation: longExplain}, createdAt: AT});
  const ctx = refs.context('看看 [[DESK_REF_V1 attempt:a-long]]');
  assert.ok(!ctx.includes('QUESTION-TAIL') && !ctx.includes('EXPLAIN-TAIL'), '上限本身不变');
  assert.match(ctx, /题目：[^\n]*…（后略，原文共 \d+ 字）/, '题目截断要标明');
  assert.match(ctx, /讲解：[^\n]*…（后略，原文共 \d+ 字）/, '讲解截断要标明');
  assert.ok(!ctx.includes('SECRET-ANSWER'));

  const longNote = '笔记正文要点一二三四五六七八九十。'.repeat(120) + 'NOTE-TAIL';
  const saved = refs.collect({sessionKey: SESSION, target: 'note', text: longNote, title: '长笔记'});
  const noteCtx = refs.context(`[[DESK_REF_V1 ${saved.receipt.ref}]]`);
  assert.match(noteCtx, /…（后略，原文共 \d+ 字）/, '笔记正文截断要标明');

  const shortNote = refs.collect({sessionKey: SESSION, target: 'note', text: '短笔记就一句。', title: '短'});
  const shortCtx = refs.context(`[[DESK_REF_V1 ${shortNote.receipt.ref}]]`);
  assert.ok(shortCtx.includes('短笔记就一句。') && !shortCtx.includes('后略'), '没截就不加标注');
});

test('收进明天计划的便签保留用户原话全文（旧版悄悄截到 300 字）', t => {
  const {refs} = fixture(t);
  const memo = '明天先把第五章循环结构的错题重做一遍，再背二十个单词。'.repeat(14) + 'MEMO-TAIL'; // 约 380 字
  refs.collect({sessionKey: SESSION, target: 'plan', text: memo});
  const saved = refs.memosFor('2026-10-30'); // AT 是北京时间 10-29 晚上，便签记在第二天
  assert.equal(saved.length, 1);
  assert.ok(saved[0].text.endsWith('MEMO-TAIL'), '明天计划的便签被截掉了尾巴');
});
