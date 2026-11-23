import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pinkieBuildTimeline, processBranchSource} from '../patch/apply-chat-timeline.mjs';

const require = createRequire(import.meta.url);
const {createDocument} = require('./fixtures/mini-dom.cjs');
const script = fs.readFileSync(new URL('../ui/injections/laolao-process-card.js', import.meta.url), 'utf8');
const key = 'pinkie:process:agent:main:test:user1';

function harness(saved = {}, session = "agent:main:test", clock = null) {
  const localKey = `pinkie:process:${session}:user1`;
  const document = createDocument();
  const proto = Object.getPrototypeOf(document.createElement('div'));
  if (!Object.getOwnPropertyDescriptor(proto, 'parentNode')) {
    Object.defineProperty(proto, 'parentNode', {get() { return this.parentElement; }});
  }
  const pane = document.createElement('openclaw-chat-pane');
  pane.requestUpdate = () => {};
  const card = document.createElement('div');
  card.className = 'chat-group chat-group--process';
  card.dataset.pinkieProcess = localKey;
  card.dataset.pinkieRowCount = '0';
  const details = document.createElement('details');
  details.className = 'pinkie-process';
  details.dataset.live = '1';
  details.open = true;
  const top = document.createElement('div');
  top.dataset.pinkieThinking = localKey; top.dataset.pinkieThinkingSeg = '0';
  const rows = document.createElement('div'); rows.className = 'pinkie-process__rows';
  const initialTail = document.createElement('div'); initialTail.dataset.pinkieThinking = localKey;
  initialTail.dataset.pinkieThinkingSeg = '0'; initialTail.dataset.pinkieThinkingTail = '1';
  details.append(top, rows, initialTail); card.append(details); pane.append(card); document.body.append(pane);
  const listeners = new Map(), frames = [], timers = [];
  let observer;
  const window = {addEventListener(name, handler) { listeners.set(name, handler); },
    __pinkieChatViewport: {preserve(_pane, change) { return change(); }}};
  const storage = {getItem: () => JSON.stringify(saved), setItem(_k, _v) {}};
  vm.runInNewContext(script, {window, document, location: {href: 'http://localhost/chat?session=' + encodeURIComponent(session)},
    localStorage: storage, Image: class {}, URL, CSS: {escape: value => value},
    performance: {now: () => clock ? clock.now : 1}, matchMedia: () => ({matches: !clock}), // a clock means: animate
    MutationObserver: class {constructor(fn) { observer = fn; } observe() {}},
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; }, clearTimeout() {}, setInterval() {}, console});
  function flush() { for (let i = 0; i < 8 && frames.length; i++) for (const fn of frames.splice(0)) fn(); }
  function render() { window.__laolaoProcessCard.schedule(); flush(); }
  function send(stream, data) {
    listeners.get('pinkie:gateway-event')({detail: {event: 'agent', payload: {sessionKey: session, stream, data}}});
    render();
  }
  function setRows(count) {
    rows.replaceChildren();
    const oldTail = details.querySelector('[data-pinkie-thinking-tail]');
    if (oldTail) oldTail.remove();
    for (let i = 0; i < count; i++) {
      if (i) { const slot = document.createElement('div'); slot.dataset.pinkieThinking = localKey; slot.dataset.pinkieThinkingSeg = String(i); rows.append(slot); }
      const row = document.createElement('div'); row.className = 'native-work-row'; rows.append(row);
    }
    const tail = document.createElement('div'); tail.dataset.pinkieThinking = localKey;
    tail.dataset.pinkieThinkingSeg = String(count); tail.dataset.pinkieThinkingTail = '1'; details.append(tail);
    card.dataset.pinkieRowCount = String(count);
    render();
  }
  function textAt(anchor) {
    const slot = card.querySelectorAll('[data-pinkie-thinking]').find(node => Number(node.dataset.pinkieThinkingSeg) === anchor && (anchor !== 0 || node.dataset.pinkieThinkingTail !== '1'));
    return (slot?.querySelectorAll('.pinkie-thinking__text') || []).map(node => node.textContent);
  }
  flush();
  function invalidateHistory() { observer([{type: 'attributes', target: top, addedNodes: [], removedNodes: []}]); flush(); }
  function changeCardKey(next) {
    card.dataset.pinkieProcess = next;
    for (const slot of card.querySelectorAll('[data-pinkie-thinking]')) slot.dataset.pinkieThinking = next;
    observer([{type: 'attributes', target: card, addedNodes: [], removedNodes: []}]); flush();
  }
  return {card, top, rows, window, send, flush, render, setRows, textAt, invalidateHistory, changeCardKey};
}

const message = (role, content, id) => ({role, content, timestamp: 1, __openclaw: {id}});
const group = (role, id, messages) => ({kind: 'group', role, key: id, timestamp: 1,
  messages: messages.map((value, i) => ({message: value, key: `${id}:${i}`}))});
const getToolCalls = msg => (Array.isArray(msg.content) ? msg.content : []).filter(part => part.type === 'tool_call')
  .map(part => ({callId: part.callId, name: part.name, args: part.arguments}));
function historicalCard() {
  return pinkieBuildTimeline([
    group('user', 'user1', [message('user', '查一下', 'user1')]),
    group('tool', 'step1', [message('assistant', [
      {type: 'thinking', thinking: '第一段思考'}, {type: 'text', text: '我先看一下'},
      {type: 'tool_call', callId: 'read1', name: 'read', arguments: {}},
    ], 'step1')]),
    group('assistant', 'answer1', [message('assistant', [
      {type: 'thinking', thinking: '第二段思考'}, {type: 'text', text: '看到了'},
    ], 'answer1')]),
  ], getToolCalls).find(row => row.isProcessCard);
}

test('live thinking follows its own rows and only fills Lit-owned slots', () => {
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一段思考'});
  h.send('assistant', {delta: '我先看一下'});
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  h.send('tool', {phase: 'result', name: 'read'});
  h.send('thinking', {delta: '第二段思考'});
  h.send('assistant', {delta: '看到了'});
  assert.deepEqual(h.textAt(0), ['第一段思考']);
  assert.deepEqual(h.textAt(2), ['第二段思考']);
  assert.equal(h.card.querySelectorAll('.native-work-row').every(row => row.children.length === 0), true);
  assert.match(processBranchSource('render'), /data-pinkie-thinking-seg/);
});

test('long multi-step thinking is retained past the old 8000-character cap', () => {
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  const burst = '长任务思考'.repeat(1800);
  h.send('thinking', {delta: burst});
  const record = Object.values(h.window.__laolaoProcessCard.store).find(item => item?.eps?.length);
  assert.equal(record?.eps?.reduce((sum, ep) => sum + ep.text.length, 0), burst.length);
});

test('live label stays 正在思考 while its received text is still being displayed', () => {
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '这是一段需要逐字展示的真实思考'});
  assert.match(h.top.querySelector('.pinkie-thinking__label')?.textContent || '', /^正在思考/);
  h.send('assistant', {delta: '开始回答'});
  assert.match(h.top.querySelector('.pinkie-thinking__label')?.textContent || '', /^正在思考/);
});

test('historical thinking parts are projected to the same rows', () => {
  const projected = historicalCard();
  assert.deepEqual(projected.processThinkingSegments.map(ep => [ep.text, ep.anchor]), [
    ['第一段思考', 0], ['第二段思考', 2],
  ]);
  const h = harness();
  h.setRows(2); h.top.pinkieHistorySegments = projected.processThinkingSegments;
  h.top.pinkieHistoryThinking = projected.processThinking;
  h.invalidateHistory();
  assert.deepEqual(h.textAt(0), ['第一段思考']);
  assert.deepEqual(h.textAt(2), ['第二段思考']);
});

test('a later burst stays visible when its row sits in the closed overflow', () => {
  const saved = {[key]: {text: '第一段思考\n\n第二段思考', ms: 0, count: 2, at: 1,
    eps: [{text: '第一段思考', ms: 0, anchor: 0}, {text: '第二段思考', ms: 0, anchor: 1}]}};
  const h = harness(saved);
  h.setRows(2);
  // The native card only emits a slot for displayed rows; hide row 1 as the
  // collapsed "前面还有 N 步" section does, leaving the tail as the next slot.
  const hidden = h.card.querySelectorAll('[data-pinkie-thinking]')
    .find(node => Number(node.dataset.pinkieThinkingSeg) === 1 && node.dataset.pinkieThinkingTail !== '1');
  hidden?.remove();
  h.invalidateHistory();
  assert.deepEqual(h.textAt(0), ['第一段思考']);
  assert.deepEqual(h.textAt(2), ['第二段思考']);
});

test('old localStorage entries remain intact as one top block', () => {
  const h = harness({[key]: {text: '旧的完整思考', ms: 2300, count: 2, at: 1}});
  h.setRows(2);
  assert.deepEqual(h.textAt(0), ['旧的完整思考']);
  assert.deepEqual(h.textAt(2), []);
  assert.equal(h.window.__laolaoProcessCard.store[key].text, '旧的完整思考');
});


test('a tool result arriving before the Lit commit is anchored when its row appears', () => {
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一段'});
  h.send('assistant', {delta: '先看看'});
  h.send('tool', {phase: 'start', name: 'read', toolCallId: 'slow-row'});
  h.send('tool', {phase: 'result', name: 'read', toolCallId: 'slow-row'});
  h.send('thinking', {delta: '第二段'});
  assert.deepEqual(h.textAt(0), ['第一段']);
  h.top.pinkieToolAnchors = {'slow-row': 2};
  h.setRows(2); h.invalidateHistory();
  assert.deepEqual(h.textAt(0), ['第一段']);
  assert.deepEqual(h.textAt(2), ['第二段']);
});


test('a live card whose durable key replaces its optimistic key keeps thinking and expansion', () => {
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '原来的思考'});
  h.top.querySelector('.pinkie-thinking__head').click();
  const next = 'pinkie:process:agent:main:test:durable';
  h.changeCardKey(next);
  assert.equal(h.window.__laolaoProcessCard.run.key, next);
  assert.equal(h.window.__laolaoProcessCard.store[next].text, '原来的思考');
  assert.equal(h.top.querySelector('.pinkie-thinking').classList.contains('is-open'), true);
  h.send('thinking', {delta: '继续'});
  assert.equal(h.window.__laolaoProcessCard.store[next].text, '原来的思考继续');
});


test('every session uses per-burst thoughts, including unknown agent ids', () => {
  const h = harness({}, 'agent:other:test');
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一段'});
  h.send('assistant', {delta: '说一句'});
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  h.send('tool', {phase: 'result', name: 'read'});
  h.send('thinking', {delta: '第二段'});
  assert.deepEqual(h.textAt(0), ['第一段']);
  assert.deepEqual(h.textAt(2), ['第二段']);
});

test('unknown sessions also project history into per-burst segments', () => {
  const previous = globalThis.location;
  globalThis.location = {search: '?session=agent%3Aother%3Atest'};
  try {
    const projected = historicalCard();
    assert.deepEqual(projected.processThinkingSegments.map(ep => ep.text), ['第一段思考', '第二段思考']);
    assert.equal(projected.processThinking, '第一段思考\n\n第二段思考');
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});

test('the active sidebar session also gets per-burst history segments', () => {
  const oldLocation = globalThis.location, oldDocument = globalThis.document;
  globalThis.location = {search: ''};
  globalThis.document = {querySelector: () => ({dataset: {sessionKey: 'agent:other:test'}}), querySelectorAll: () => []};
  try {
    assert.deepEqual(historicalCard().processThinkingSegments.map(ep => ep.text), ['第一段思考', '第二段思考']);
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

// The user's rule (2026-11-05, repeated 2026-11-21): show the thought while it
// streams, play all of it, hold briefly, THEN fold by itself. Do not turn this
// into "finished thoughts stay open": a0ebf381 did, and it was a regression.
function playback() {
  const clock = {now: 1};
  const h = harness({}, 'agent:main:test', clock);
  h.send('lifecycle', {phase: 'start'});
  const box = () => h.card.querySelector('.pinkie-thinking');
  const at = ms => { clock.now = ms; h.render(); };
  const state = () => ({live: box().classList.contains('is-live'), open: box().classList.contains('is-open'),
    expanded: box().querySelector('.pinkie-thinking__head').getAttribute('aria-expanded'),
    text: box().querySelector('.pinkie-thinking__text').textContent});
  return {h, at, box, state};
}

for (const [name, text, typed, hold] of [
  ['short', '先看看这个文件', 500, 1800],
  ['long', '长思考'.repeat(2000), 2500, 3600],
]) {
  test(`a ${name} thought plays in full, holds, then folds by itself even though the run already ended`, () => {
    const {h, at, state} = playback();
    h.send('thinking', {delta: text});
    h.send('assistant', {delta: '回答'});
    h.send('lifecycle', {phase: 'end'});
    at(1 + typed / 2);
    assert.equal(state().live, true);
    assert.ok(state().text.length > 0 && state().text.length < text.length);
    at(1 + typed);
    assert.equal(state().text, text);
    assert.equal(state().live, true);
    at(typed + hold - 10);
    assert.equal(state().live, true, 'folded before the reading hold was over');
    at(typed + hold + 10);
    assert.deepEqual(state(), {live: false, open: false, expanded: 'false', text});
  });
}

test('a thought does not fold while the model is still thinking', () => {
  const {h, at, state} = playback();
  h.send('thinking', {delta: '还没想完'});
  at(60000);
  assert.equal(state().live, true);
});

test('each burst folds by itself', () => {
  const {h, at} = playback();
  h.send('thinking', {delta: '第一段'});
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  at(501); at(2400);
  h.send('tool', {phase: 'result', name: 'read'});
  h.send('thinking', {delta: '第二段'});
  const live = () => h.card.querySelectorAll('.pinkie-thinking').map(node => node.classList.contains('is-live'));
  assert.deepEqual(live(), [false, true]);
  h.send('lifecycle', {phase: 'end'});
  at(3000); at(4900);
  assert.deepEqual(live(), [false, false]);
});

test('a thought the reader opened while live is not folded under them', () => {
  const {h, at, box, state} = playback();
  h.send('thinking', {delta: '我点开看的思考'});
  box().querySelector('.pinkie-thinking__head').click();
  h.send('lifecycle', {phase: 'end'});
  at(501); at(2400);
  assert.equal(state().live, false);
  assert.equal(state().open, true);
});

test('a new burst does not rewind the previous one to its first line', () => {
  const {h, box} = playback();
  h.send('thinking', {delta: '第一段很长的思考'});
  h.send('tool', {phase: 'start', name: 'read'});
  const body = box().querySelector('.pinkie-thinking__body'), slot = box().parentNode, append = slot.append.bind(slot);
  body.scrollTop = 205;
  // Browsers reset scrollTop when a node is taken out and inserted again.
  slot.append = (...nodes) => {
    for (const node of nodes) if (node.querySelector?.('.pinkie-thinking__body') === body) body.scrollTop = 0;
    return append(...nodes);
  };
  h.send('tool', {phase: 'result', name: 'read'});
  h.send('thinking', {delta: '第二段'});
  assert.equal(h.card.querySelectorAll('.pinkie-thinking').length, 2);
  assert.equal(body.scrollTop, 205);
});

test('history starts folded and the reader can open and close it', () => {
  const h = harness({[key]: {text: '做完的完整思考', ms: 2300, count: 1, at: 1}});
  h.setRows(2);
  const box = () => h.card.querySelector('.pinkie-thinking');
  const head = () => box().querySelector('.pinkie-thinking__head');
  assert.equal(box().classList.contains('is-live'), false);
  assert.equal(box().classList.contains('is-open'), false);
  assert.equal(head().getAttribute('aria-expanded'), 'false');
  head().click();
  h.render();
  assert.equal(box().classList.contains('is-open'), true);
  head().click();
  assert.equal(box().classList.contains('is-open'), false);
});

test('a fresh card record while a thought is still open starts its own burst instead of throwing', () => {
  // 在跑时再发一句：第二句开了另一轮的新卡，新卡的记录还没有段落，而上一段思考还没收尾（thinkingSince 还在）。
  // 以前这里取 record.eps 的最后一项是 undefined，页面报「Cannot read properties of undefined (reading 'text')」。
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一轮的思考'});
  h.window.__laolaoProcessCard.store[key] = {text: '', ms: 0, count: 0, at: 1};
  assert.doesNotThrow(() => h.send('thinking', {delta: '第二轮的思考'}));
  assert.deepEqual(Array.from(h.window.__laolaoProcessCard.store[key].eps, ep => ep.text), ['第二轮的思考']);
});
