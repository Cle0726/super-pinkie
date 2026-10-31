const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');

const source = fs.readFileSync(require('node:path').join(__dirname, '../ui/injections/laolao-learning-stage.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(handler = () => ({}), options = {}) {
  const document = createDocument(); document.readyState = 'loading';
  const main = document.createElement('div');
  const composer = document.createElement('div'); composer.className = 'agent-chat__composer-shell'; main.append(composer); document.body.append(main);
  const calls = [], opened = [];
  const window = {addEventListener() {}, __pinkieLibrary: {open: async (...args) => opened.push(args)}, __laolaoSidebar: {gwRequest: async (method, params) => { calls.push({method, params}); return handler(method, params); }}};
  const location = {href: 'http://localhost/chat?session=agent:learning:one'};
  const exposed = source.replace(/\}\)\(\);\s*$/, 'window.testStage = {state, renderStage, submitAnswer, poll, activeItem, nextQuestion, startReview, openNotebook, continueLearning, appendQuestionSources, appendGradeCorrection};})();');
  vm.runInNewContext(exposed, {document, window, location, URL, crypto: {randomUUID: () => 'submission-1'}, setInterval() {}, setTimeout() {}, clearTimeout() {}, console, ...options});
  return {document, calls, opened, location, window, ...window.testStage};
}
const item = (id, extras = {}) => ({id, kind: 'single_choice', question: `问题 ${id}`, options: [{id: 'A', label: '选项甲'}, {id: 'B', label: '选项乙'}], ...extras});
const remote = items => ({enabled: true, revision: 1, current: {id: 'activity-1', kind: 'batch', items}});
const text = element => [element.textContent, ...element.children.map(text)].join(' ');

test('ordinary learning chat never inserts a review banner, even with hundreds of due notes', async () => {
  const empty = {enabled: true, revision: 1, current: null};
  const h = harness(method => method === 'pinkie.learning.current' ? empty : {notes: [], dueCount: 204});
  h.document.documentElement.setAttribute('data-laolao-mode', 'learning');
  h.state.dueCount = 204;
  for (let i = 0; i < 20; i++) h.renderStage(empty);
  await h.poll(); await settle();
  assert.equal(h.document.querySelector('.laolao-learning-stage'), null);
  assert.equal(h.state.stage, null);
  assert.equal(h.state.dueCount, 204, 'hiding the banner does not clear review records');
  assert.equal(h.calls.filter(call => /(?:chat.send|learning.set|review.submit)/.test(call.method)).length, 0);
});

test('ending an activity removes its fallback without replacing it with an empty-state card', () => {
  const h = harness(); h.state.remote = remote([item('one')]); h.renderStage(h.state.remote);
  assert.ok(h.document.querySelector('.laolao-learning-stage'), 'old active questions still work');
  h.renderStage({enabled: true, revision: 2, current: null});
  assert.equal(h.document.querySelector('.laolao-learning-stage'), null);
  h.renderStage({enabled: true, revision: 3, current: {id: 'empty', items: []}});
  assert.equal(h.document.querySelector('.laolao-learning-stage'), null);
});

test('a mounted message-native question replaces the old stage while still receiving state updates', () => {
  const events = [];
  const h = harness(() => ({}), {CustomEvent: class {constructor(type, init) {this.type = type; this.detail = init.detail;}}});
  const value = remote([item('one')]);
  h.renderStage(value); assert.ok(h.state.stage);
  h.window.__pinkieLearningInline = {hasActivity: (key, id) => key === 'agent:learning:one' && id === 'activity-1'};
  h.window.dispatchEvent = event => events.push(event);
  h.renderStage(value);
  assert.equal(h.document.querySelector('.laolao-learning-stage'), null);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'pinkie:learning-state'); assert.equal(events[0].detail, value);
});

test('question groups keep each draft, submit one item, and carry actual confidence and hint use', async () => {
  let model;
  const h = harness((method, params) => {
    if (method === 'pinkie.learning.submit') {
      model = {...model, revision: 2, current: {...model.current, items: model.current.items.map(value => value.id === params.itemId ? {...value, submission: {answer: params.answer, confidence: params.confidence, hintUsed: params.hintUsed, correctness: true}} : value)}};
      return model;
    }
    return {};
  });
  model = remote([item('one', {hint: '先找主语'}), item('two')]); h.state.remote = model; h.renderStage(model);
  const first = h.document.querySelector('input[data-learning-answer="1"]'); first.checked = true; first.dispatch('change');
  const hint = h.document.querySelector('.laolao-learning-stage__hint'); hint.open = true; hint.dispatch('toggle');
  h.document.querySelectorAll('.laolao-learning-stage__confidence')[2].click();
  h.document.querySelectorAll('.laolao-learning-stage__item')[1].click();
  assert.equal(h.document.querySelector('input[data-learning-answer="1"]').checked, false, 'second item has an independent draft');
  h.document.querySelectorAll('.laolao-learning-stage__item')[0].click();
  assert.equal(h.document.querySelector('input[data-learning-answer="1"]').checked, true, 'first draft survives navigation');
  const button = h.document.querySelector('.laolao-learning-stage__actions .laolao-learning-button');
  await h.submitAnswer(button);
  const submitted = h.calls.find(call => call.method === 'pinkie.learning.submit').params;
  assert.equal(submitted.itemId, 'one'); assert.equal(submitted.answer, 'A'); assert.equal(submitted.confidence, 90); assert.equal(submitted.hintUsed, true);
  assert.ok(text(h.document.querySelector('.laolao-learning-stage__submitted')).includes('A. 选项甲'));
  assert.equal(model.current.items[1].submission, undefined, 'another item must not be submitted or graded');
  assert.match(h.calls.find(call => call.method === 'chat.send').params.message, /item_id: one/);
});

test('unselected confidence remains null and network retries retain the same submission id', async () => {
  let count = 0;
  const h = harness(method => { if (method === 'pinkie.learning.submit') { count++; throw new Error('network interrupted'); } return {}; });
  h.state.remote = remote([item('one')]); h.renderStage(h.state.remote);
  const input = h.document.querySelector('input[data-learning-answer="1"]'); input.checked = true;
  const button = h.document.querySelector('.laolao-learning-stage__actions .laolao-learning-button');
  await h.submitAnswer(button); await h.submitAnswer(button);
  const submissions = h.calls.filter(call => call.method === 'pinkie.learning.submit');
  assert.equal(count, 2); assert.equal(submissions[0].params.confidence, null);
  assert.equal(submissions[0].params.submissionId, submissions[1].params.submissionId);
});

test('a submission finishing after a session switch never overwrites the other session or sends its control message', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = harness(method => method === 'pinkie.learning.submit' ? pending : {});
  h.state.remote = remote([item('one')]); h.renderStage(h.state.remote);
  h.document.querySelector('input[data-learning-answer="1"]').checked = true;
  const button = h.document.querySelector('.laolao-learning-stage__actions .laolao-learning-button');
  const submitting = h.submitAnswer(button);
  h.location.href = 'http://localhost/chat?session=agent:learning:two';
  const other = {enabled: true, revision: 1, current: item('different')}; h.state.remote = other; h.renderStage(other);
  resolve(remote([item('one', {submission: {answer: 'A'}})])); await submitting;
  assert.equal(h.state.remote.current.id, 'different');
  assert.equal(h.calls.filter(call => call.method === 'chat.send').length, 0);
});

test('late polling responses are fenced by the session they were requested for', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = harness(method => method === 'pinkie.learning.current' ? pending : {});
  h.document.documentElement.setAttribute('data-laolao-mode', 'learning');
  const poll = h.poll(); h.location.href = 'http://localhost/chat?session=agent:learning:two';
  h.state.remote = {enabled: true, current: item('other')};
  resolve(remote([item('one')])); await poll;
  assert.equal(h.state.remote.current.id, 'other'); assert.equal(h.state.polling, false);
});

test('mutation/event storms cannot exceed one current poll per 1.2 seconds and hidden pages pause', async () => {
  let now = 10_000;
  class Clock extends Date { static now() { return now; } }
  const h = harness(method => method === 'pinkie.learning.current' ? remote([item('one')]) : {}, {Date: Clock});
  for (let i = 0; i < 300; i++) { now = 10_000 + i * 10; await h.poll(); }
  assert.equal(h.calls.filter(call => call.method === 'pinkie.learning.current').length, 3);
  h.document.hidden = true; now += 2000; await h.poll();
  assert.equal(h.calls.filter(call => call.method === 'pinkie.learning.current').length, 3);
});

test('an incomplete rubric stays pending, keeps the saved answer, and does not enable a new activity', () => {
  const h = harness(); h.state.remote = remote([item('one', {phase: 'evaluating', submission: {answer: 'A'}, result: {correct: null, criteria: [{id: 'reason', met: null}]}})]); h.renderStage(h.state.remote);
  assert.match(text(h.state.stage), /评分点还没核对完整/);
  assert.match(text(h.state.stage), /A\. 选项甲/);
  assert.ok(!h.document.querySelector('.laolao-learning-stage__actions'), 'pending score must not enable another activity');
});

test('results retain answer and individual scoring points, and only genuine source anchors open the reader', async () => {
  const h = harness();
  const current = item('one', {submission: {answer: 'B', attemptId: 'attempt-1'}, result: {correct: false, feedback: '主语看反了', criteria: [{id: 'subject', label: '找准主语', met: false, feedback: '应看前半句'}]}, sources: [{bookId: 'book-1', location: 4, title: '语法', label: '第4页', quote: '原文'}, {title: '没有真实位置'}]});
  h.state.remote = remote([current]); h.renderStage(h.state.remote);
  assert.match(text(h.state.stage), /B\. 选项乙/); assert.match(text(h.state.stage), /待补 找准主语/);
  const jumps = h.document.querySelectorAll('.pinkie-library__source-jump'); assert.equal(jumps.length, 1);
  jumps[0].click(); await settle(); assert.equal(h.opened[0][0], 'book-1'); assert.equal(h.opened[0][1].location, 4);
});

test('conflicting or manually corrected grades fold the original commentary and show the grading basis', () => {
  const h = harness();
  h.state.remote = remote([item('one', {submission: {answer: 'A'}, result: {correct: true, gradingConflict: true, feedback: '错误的模型点评'}})]); h.renderStage(h.state.remote);
  const original = h.document.querySelector('.laolao-learning-stage__original-explanation');
  assert.ok(original && !original.open); assert.match(text(original), /错误的模型点评/);
  assert.match(text(h.state.stage), /答案已按标准答案核对/);
  h.state.remote = remote([item('one', {submission: {answer: 'A'}, result: {correct: true, gradeSource: 'user_correction', correctionReason: '同义答案应接受', feedback: '原来判错了'}})]); h.renderStage(h.state.remote);
  assert.match(text(h.state.stage), /已按你的人工纠正记录：同义答案应接受/);
  assert.ok(h.document.querySelector('.laolao-learning-stage__original-explanation'));
});

test('legacy multi-note cards explain why one overall grade does not schedule every knowledge point', () => {
  const h = harness();
  h.state.remote = remote([item('one', {submission: {answer: 'A'}, result: {correct: true, reviewStatus: 'needs_individual_assessment', reviewMessage: '这张题关联多个知识点，请拆成独立小题后再安排复习。', reviewedNotes: []}})]); h.renderStage(h.state.remote);
  assert.match(text(h.state.stage), /这张题关联多个知识点，请拆成独立小题后再安排复习。/);
  assert.doesNotMatch(text(h.state.stage), /已安排复习：/);
});

test('variant requests preserve the attempt relation and actual note association', async () => {
  const h = harness(); h.state.remote = remote([item('one', {noteIds: ['note-1'], submission: {answer: 'A', attemptId: 'attempt-1'}, result: {correct: false}})]);
  h.renderStage(h.state.remote); await h.nextQuestion(null);
  const message = h.calls.find(call => call.method === 'chat.send').params.message;
  assert.match(message, /retry_of: attempt-1/); assert.match(message, /note-1/);
});

test('review continuation opens the full-page recall view without constructing a drawer', async () => {
  const h = harness(), opened = [];
  h.window.__pinkieStudyDesk = {go: (...args) => opened.push(args)};
  const root = h.document.createElement('div'); root.id = 'pinkie-study-desk'; h.document.body.append(root);
  h.document.getElementById = id => h.document.querySelector('#' + id);
  await h.startReview(); assert.equal(opened[0][0], 'notes'); assert.equal(opened[0][1].view, 'review');
  assert.equal(h.document.querySelector('.laolao-learning-notes'), null);
});

test('a stale next step for another session cannot trigger an attempt request in the current pane', async () => {
  const h = harness(); await h.continueLearning({sessionKey: 'agent:learning:other', attemptId: 'other-attempt'});
  assert.equal(h.calls.length, 0);
});

test('manual grading corrections require a reason and retain the actual attempt scope', async () => {
  const h = harness(() => ({ok: true}));
  const root = h.document.createElement('div'); h.document.body.append(root); h.appendGradeCorrection(root, 'attempt-1', false);
  const button = root.querySelector('button'); await button.listeners.get('click')[0]();
  assert.equal(h.calls.length, 0);
  root.querySelector('textarea').value = '同义答案也表达了这个概念'; await button.listeners.get('click')[0]();
  assert.equal(h.calls[0].method, 'pinkie.learning.attempts.correct');
  assert.equal(h.calls[0].params.id, 'attempt-1'); assert.equal(h.calls[0].params.sessionKey, 'agent:learning:one');
  assert.equal(h.calls[0].params.correct, true); assert.equal(h.calls[0].params.reason, '同义答案也表达了这个概念');
});

test('native port keeps pane ownership and the same per-item contract', () => {
  const port = fs.readFileSync(require('node:path').join(__dirname, '../services/cle-studio/static/legacy/laolao-learning-stage.js'), 'utf8');
  assert.match(port, /const instances = new Set/);
  assert.match(port, /const pageSessionKey = \(\) => sessionKeyFor\(state\.pane\)/);
  for (const marker of ['  const activityItems =', '  const renderStage =']) {
    const block = value => value.slice(value.indexOf(marker), value.indexOf('\n  const ', value.indexOf(marker) + marker.length));
    assert.equal(block(source), block(port), `shared implementation drift at ${marker}`);
  }
});
