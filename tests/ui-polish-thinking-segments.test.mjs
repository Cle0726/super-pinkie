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
    performance: {now: () => 1}, matchMedia: () => ({matches: true}),
    MutationObserver: class {constructor(fn) { observer = fn; } observe() {}},
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; }, clearTimeout() {}, setInterval() {}, console,
    Date: clock || Date});
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

test('a later round with a blank reasoning block gets a duration-only 思考了', () => {
  const msg = (role, content, id, timestamp, extra = {}) => ({role, content, timestamp, ...extra, __openclaw: {id}});
  const grp = (role, id, messages, timestamp) => ({kind: 'group', role, key: id, timestamp,
    messages: messages.map((value, i) => ({message: value, key: `${id}:${i}`}))});
  const projected = pinkieBuildTimeline([
    grp('user', 'user1', [msg('user', '继续', 'user1', 1000)], 1000),
    grp('tool', 'step1', [msg('assistant', [
      {type: 'thinking', thinking: '先看'}, {type: 'text', text: '看一下'},
      {type: 'tool_call', callId: 'read1', name: 'read', arguments: {}},
    ], 'step1', 1100)], 1100),
    grp('tool', 'res1', [msg('toolResult', [{type: 'text', text: 'ok'}], 'res1', 8600, {toolCallId: 'read1', details: {durationMs: 500}})], 8600),
    grp('tool', 'step2', [msg('assistant', [
      {type: 'thinking', thinking: ' '}, {type: 'text', text: '再跑'},
      {type: 'tool_call', callId: 'read2', name: 'exec', arguments: {}},
    ], 'step2', 8650)], 8650),
    grp('tool', 'res2', [msg('toolResult', [{type: 'text', text: 'ok'}], 'res2', 16150, {toolCallId: 'read2', details: {durationMs: 500}})], 16150),
  ], getToolCalls).find(row => row.isProcessCard);
  const segs = projected.processThinkingSegments;
  assert.deepEqual(segs.map(ep => [ep.text, ep.ms, Boolean(ep.narration)]), [['先看', 7000, false], ['', 7000, false]]);
  const h = harness();
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '先看'});
  h.send('assistant', {delta: '看一下'});
  h.send('tool', {phase: 'result', name: 'read', toolCallId: 'read1'});
  h.setRows(4);
  h.top.pinkieHistorySegments = segs;
  h.invalidateHistory();
  const boxes = [...h.card.querySelectorAll('.pinkie-thinking')];
  assert.equal(boxes.length, 2);
  assert.equal(boxes[1].classList.contains('is-empty'), true);
  const labels = boxes.map(box => box.querySelector('.pinkie-thinking__label').textContent);
  assert.match(labels[0], /^思考了 \d+ 秒$/); // live timing wins when it was measured
  assert.equal(labels[1], '思考了 7 秒');
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


test('a Mac chat opened without ?session= still places each thought by its row', () => {
  const h = harness({}, '');
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一段'});
  h.send('assistant', {delta: '说一句'});
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  h.send('tool', {phase: 'result', name: 'read', toolCallId: 'read1'});
  h.send('thinking', {delta: '第二段'});
  assert.deepEqual(h.textAt(0), ['第一段']);
  assert.deepEqual(h.textAt(2), ['第二段']);
});

test('unrestricted mode places each thought by its row instead of one top block', () => {
  const h = harness({}, 'agent:unrestricted:main');
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一段'});
  h.send('assistant', {delta: '说一句'});
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  h.send('tool', {phase: 'result', name: 'read', toolCallId: 'read1'});
  h.send('thinking', {delta: '第二段'});
  assert.deepEqual(h.textAt(0), ['第一段']);
  assert.deepEqual(h.textAt(2), ['第二段']);
  assert.equal(h.card.textContent.includes('2 次'), false);
});

test('other sessions keep one combined thought in the original top position', () => {
  const h = harness({}, 'agent:other:test');
  h.send('lifecycle', {phase: 'start'});
  h.send('thinking', {delta: '第一段'});
  h.send('assistant', {delta: '说一句'});
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  h.send('tool', {phase: 'result', name: 'read'});
  h.send('thinking', {delta: '第二段'});
  assert.deepEqual(h.textAt(0), ['第一段\n\n第二段']);
  assert.deepEqual(h.textAt(2), []);
});

test('other sessions retain the previous history projection', () => {
  const previous = globalThis.location;
  globalThis.location = {search: '?session=agent%3Aother%3Atest'};
  try {
    const projected = historicalCard();
    assert.deepEqual(projected.processThinkingSegments, []);
    assert.equal(projected.processThinking, '第二段思考');
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});

test('the active sidebar session also keeps other modes on the previous history projection', () => {
  const oldLocation = globalThis.location, oldDocument = globalThis.document;
  globalThis.location = {search: ''};
  globalThis.document = {querySelector: () => ({dataset: {sessionKey: 'agent:other:test'}}), querySelectorAll: () => []};
  try {
    assert.deepEqual(historicalCard().processThinkingSegments, []);
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

test('a Gemini tool round with no reasoning part at all gets its own duration-only 思考了', () => {
  const msg = (role, content, id, timestamp, extra = {}) => ({role, content, timestamp, ...extra, __openclaw: {id}});
  const grp = (role, id, messages, timestamp) => ({kind: 'group', role, key: id, timestamp,
    messages: messages.map((value, i) => ({message: value, key: `${id}:${i}`}))});
  const res = (id, call, at, ran) => grp('tool', id, [msg('toolResult', [{type: 'text', text: 'ok'}], id, at, {toolCallId: call, details: {durationMs: ran}})], at);
  const projected = pinkieBuildTimeline([
    grp('user', 'user1', [msg('user', '查', 'user1', 1000)], 1000),
    grp('tool', 'step1', [msg('assistant', [
      {type: 'thinking', thinking: '先看'}, {type: 'tool_call', callId: 'r1', name: 'read', arguments: {}},
    ], 'step1', 1000)], 1000),
    res('res1', 'r1', 6500, 500),
    grp('tool', 'step2', [msg('assistant', [
      {type: 'text', text: '再跑 `ls`'}, {type: 'tool_call', callId: 'r2', name: 'exec', arguments: {}},
    ], 'step2', 6550)], 6550),
    res('res2', 'r2', 12000, 450),
    grp('tool', 'step3', [msg('assistant', [
      {type: 'tool_call', callId: 'r3', name: 'exec', arguments: {}},
    ], 'step3', 12050)], 12050),
    res('res3', 'r3', 12600, 100),
    grp('tool', 'step4', [msg('assistant', [
      {type: 'tool_call', callId: 'r4', name: 'exec', arguments: {}},
    ], 'step4', 12650)], 12650),
    res('res4', 'r4', 15000, 100),
  ], getToolCalls).find(row => row.isProcessCard);
  const eps = projected.processThinkingSegments.map(ep => [ep.text, ep.ms]);
  // Round 3 said nothing and acted within 0.8 s: no row. Round 4 said nothing: duration only.
  assert.deepEqual(eps, [['先看', 5000], ['', 5000], ['', 2250]]);
  const h = harness();
  h.setRows(4);
  h.top.pinkieHistorySegments = projected.processThinkingSegments;
  h.invalidateHistory();
  const boxes = [...h.card.querySelectorAll('.pinkie-thinking')];
  assert.equal(boxes.length, 3);
  assert.equal(boxes[1].classList.contains('is-empty'), true);
  assert.equal(boxes[2].classList.contains('is-empty'), true);
  assert.equal(boxes[2].querySelector('.pinkie-thinking__head').disabled, true);
  assert.deepEqual(boxes.map(box => box.querySelector('.pinkie-thinking__label').textContent), ['思考了 5 秒', '思考了 5 秒', '思考了 2 秒']);
});

test('live: a round that acts without streamed reasoning gets 思考了 N 秒 before its command', () => {
  let now = 100000;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const h = harness({}, 'agent:main:test', Clock);
  h.send('lifecycle', {phase: 'start'});
  now += 3000;
  h.send('thinking', {delta: '先看'});
  now += 1000;
  h.send('tool', {phase: 'start', name: 'read'});
  h.setRows(2);
  now += 500;
  h.send('tool', {phase: 'result', name: 'read'});
  now += 6000; // the model works 6 s and streams no words
  h.send('tool', {phase: 'start', name: 'exec'});
  h.send('tool', {phase: 'start', name: 'exec'}); // same round: no second row
  h.setRows(4);
  const labels = [...h.card.querySelectorAll('.pinkie-thinking__label')].map(node => node.textContent);
  assert.deepEqual(labels, ['思考了 4 秒', '思考了 6 秒']);
  assert.deepEqual(h.textAt(0), ['先看']);
  assert.deepEqual(h.textAt(2), ['']);
});

test('live: a quiet round gets a duration-only 思考了; late reasoning fills the same box', () => {
  let now = 100000;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const h = harness({}, 'agent:main:test', Clock);
  h.send('lifecycle', {phase: 'start'});
  now += 7000; // Gemini: silence, then the sentence and the call arrive together
  h.send('assistant', {text: '碧琪先运行 date'});
  h.send('tool', {phase: 'start', name: 'exec'});
  h.setRows(2);
  now += 800;
  h.send('tool', {phase: 'result', name: 'exec'});
  now += 6000;
  h.send('assistant', {text: '碧琪先运行 date碧琪再运行 ls'}); // cumulative text: only this round's part
  h.send('tool', {phase: 'start', name: 'exec'});
  h.send('thinking', {delta: '其实要先看目录'}); // reasoning that arrives after the call
  h.setRows(4);
  const boxes = [...h.card.querySelectorAll('.pinkie-thinking')];
  assert.equal(boxes.length, 2);
  assert.deepEqual(h.textAt(0), ['']);
  assert.deepEqual(h.textAt(2), ['其实要先看目录']);
  const labels = boxes.map(box => box.querySelector('.pinkie-thinking__label').textContent);
  assert.equal(labels[0], '思考了 7 秒');
});
