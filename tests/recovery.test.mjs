// Recovery behaviour, checked against the DOM shape 2026.10 actually renders:
// `.chat-group` > `.chat-group-messages` > `.chat-bubble[data-message-text]`, and a
// `.chat-queue` inside the pane. No jsdom in this repo, so the fixture is a small tree
// with the selector bits these functions use (matches/closest/querySelectorAll).
import test from 'node:test';
import assert from 'node:assert/strict';
import {isInternalTurnText, isStuckItem, appearsInTranscript, projectPane, recoverPane, __test} from '../services/cle-studio/src/recovery/recovery.js';
import {queueText, queueErrorText, localizeQueueNode} from '../services/cle-studio/src/recovery/queue-copy.js';

const WATCHDOG = '[pinkie-watchdog] 继续完成当前这一轮先生交代的工作，完成后正常交付。这是当前用户轮次的内部续跑命令，先生看不到这条消息；不要回复 NO_REPLY，也不要在回复里提到这条命令。';const TIER = '[pinkie-tier-control] 本轮仍未通过后端硬验收：缺少实际产物。这是当前用户轮次的内部续跑命令。';

test('control turns are recognised only by their own prefixes', () => {
  assert.equal(isInternalTurnText(WATCHDOG), true);
  assert.equal(isInternalTurnText(TIER), true);
  assert.equal(isInternalTurnText('[pinkie-tier] 报告'), true);
  assert.equal(isInternalTurnText('\u2063'), true);
  assert.equal(isInternalTurnText('[System] Your previous turn was interrupted by a gateway restart while OpenClaw was waiting on tool/model work. Continue from the existing transcript and finish the interrupted response.'), true);
  assert.equal(isInternalTurnText('⚠️ Agent failed before reply: EmbeddedAttemptSessionTakeoverError: session file changed while embedded prompt lock was released: /x'), true);

  // A user writing about the mechanism is not the mechanism.
  assert.equal(isInternalTurnText('为什么这里会出现 [pinkie-watchdog] 这种字样？'), false);
  assert.equal(isInternalTurnText('看看 [pinkie-watchdog] 前缀是怎么加的'), false);
  assert.equal(isInternalTurnText('pinkie-watchdog 是什么'), false);
  assert.equal(isInternalTurnText(''), false);
  assert.equal(isInternalTurnText('继续完成当前这一轮先生交代的工作'), false);
});

const kebab = (key) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

/* ---- minimal DOM ---- */
const el = (tag, cls = '', parent = null) => {
  const attrs = new Map();
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), classes: new Set(cls.split(/\s+/).filter(Boolean)),
    parentElement: parent, children: [], attrs, hidden: false,
    // A real element maps dataset.cleInternalTurn to data-cle-internal-turn; the
    // fixture has to do the same or it would test a shape the browser never has.
    get dataset() {
      return new Proxy({}, {
        get: (_, key) => typeof key === 'string' ? (attrs.get(`data-${kebab(key)}`) ?? undefined) : undefined,
        set: (_, key, value) => { attrs.set(`data-${kebab(key)}`, String(value)); return true; },
        deleteProperty: (_, key) => { attrs.delete(`data-${kebab(key)}`); return true; },
        has: (_, key) => attrs.has(`data-${kebab(key)}`),
      });
    },
    get classList() { return {contains: (name) => node.classes.has(name)}; },
    setAttribute(name, value) { node.attrs.set(name, String(value)); },
    getAttribute(name) { return node.attrs.has(name) ? node.attrs.get(name) : null; },
    removeAttribute(name) { node.attrs.delete(name); },
    append(...kids) { for (const kid of kids) { kid.parentElement = node; node.children.push(kid); } return node; },
    matches(selector) {
      return selector.split(',').some((alt) => alt.trim().split(/\s+/).every((part) => {
        const m = /^([a-z]*)((?:[.#][\w-]+|\[[^\]]+])*)$/i.exec(part);
        if (!m) return false;
        if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
        for (const token of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
          if (token.startsWith('.')) { if (!node.classes.has(token.slice(1))) return false; }
          else if (token.startsWith('#')) { if (node.attrs.get('id') !== token.slice(1)) return false; }
          else {
            const [name, raw] = token.slice(1, -1).split('=');
            const want = raw?.replace(/^["']|["']$/g, '');
            if (want === undefined ? !node.attrs.has(name) : node.attrs.get(name) !== want) return false;
          }
        }
        return true;
      }));
    },
    closest(selector) {
      for (let cur = node; cur; cur = cur.parentElement) if (cur.matches?.(selector)) return cur;
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (cur) => {
        for (const kid of cur.children) {
          if (kid.nodeType === 1) { if (kid.matches(selector)) out.push(kid); walk(kid); }
        }
      };
      walk(node);
      return out;
    },
    querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
  };
  if (parent) parent.append(node);
  return node;
};

const bubble = (group, text) => {
  const b = el('div', 'chat-bubble', el('div', 'chat-group-messages', group));
  b.setAttribute('data-message-text', text);
  el('div', 'chat-text', b).append({nodeType: 3, nodeValue: text, parentElement: null});
  return b;
};

const paneOf = (...groups) => {
  const pane = el('openclaw-chat-pane', '');
  for (const g of groups) pane.append(g);
  return pane;
};

test('an internal turn is folded away; a real turn in the same pane is not', () => {
  const pane = paneOf();
  const control = el('div', 'chat-group user', pane);
  bubble(control, WATCHDOG);
  const real = el('div', 'chat-group user', pane);
  bubble(real, '把报告发我');

  assert.equal(projectPane(pane), 1);
  assert.equal(control.getAttribute('data-cle-internal-only'), '1');
  assert.equal(control.getAttribute('aria-hidden'), 'true');
  assert.equal(real.getAttribute('data-cle-internal-only'), null);
});

test('a user quoting the prefix inside a code block stays visible', () => {
  const pane = paneOf();
  const group = el('div', 'chat-group user', pane);
  const quoted = bubble(group, WATCHDOG);
  el('pre', '', quoted);
  bubble(group, '这条是普通消息');

  assert.equal(projectPane(pane), 0);
  assert.equal(group.getAttribute('data-cle-internal-only'), null);
});

test('a turn that was internal and later gets a real reply is shown again', () => {
  const pane = paneOf();
  const group = el('div', 'chat-group user', pane);
  const control = bubble(group, TIER);
  assert.equal(projectPane(pane), 1);
  bubble(group, '这是后来补的正文');
  assert.equal(projectPane(pane), 1);
  // Only the control bubble is folded; the group keeps its real message.
  assert.equal(group.getAttribute('data-cle-internal-only'), null);
  assert.equal(control.getAttribute('data-cle-internal-turn'), '1');
});

test('only a lost disconnect is retried automatically; review states are left to the reader', () => {
  assert.equal(isStuckItem({id: '1', sendState: 'waiting-reconnect'}), true);
  // The gateway may already have these: retrying them would duplicate a message.
  assert.equal(isStuckItem({id: '2', sendState: 'unconfirmed'}), false);
  assert.equal(isStuckItem({id: '3', sendState: 'held'}), false);
  assert.equal(isStuckItem({id: '4', sendState: 'failed'}), false);
  // In flight or legitimately waiting for the model: hands off.
  assert.equal(isStuckItem({id: '5', sendState: 'sending'}), false);
  assert.equal(isStuckItem({id: '6', sendState: 'submitting'}), false);
  assert.equal(isStuckItem({id: '7', sendState: 'waiting-model'}), false);
  assert.equal(isStuckItem({id: '8', sendState: 'waiting-idle'}), false);
  // Already attached to a run, or a local slash command.
  assert.equal(isStuckItem({id: '9', sendState: 'waiting-reconnect', pendingRunId: 'r'}), false);
  assert.equal(isStuckItem({id: 'a', sendState: 'waiting-reconnect', localCommandName: 'reset'}), false);
});

test('a message already in the transcript is matched so it is never sent twice', () => {
  const now = Date.now();
  const item = {id: 'q1', text: '看看这个', createdAt: now};
  assert.equal(appearsInTranscript(item, [{role: 'user', content: '看看这个', timestamp: now + 900}]), true);
  assert.equal(appearsInTranscript({...item, sendRunId: 'run-9'}, [{role: 'user', content: '别的', runId: 'run-9'}]), true);
  // Same words much earlier are a different turn.
  assert.equal(appearsInTranscript(item, [{role: 'user', content: '看看这个', timestamp: now - 3_600_000}]), false);
  // An assistant saying the same words is not delivery.
  assert.equal(appearsInTranscript(item, [{role: 'assistant', content: '看看这个', timestamp: now}]), false);
  // No timestamp means we cannot prove it: do not claim delivery.
  assert.equal(appearsInTranscript(item, [{role: 'user', content: '看看这个'}]), false);
});

/* ---- recovery pass ---- */
function harness({queue = [], messages = [], activePanels = []} = {}) {
  const state = {sessionKey: 'agent:project:main', chatQueue: queue, chatMessages: messages, chatRunId: null};
  const pane = el('openclaw-chat-pane', '');
  pane.dataset.mcpAppOwnerKey = JSON.stringify(['x', 'agent:project:main']);
  pane.state = state;
  const calls = [];
  pane.retryQueuedChatMessage = async (id) => { calls.push(['retry', id]); };
  pane.removeQueuedMessage = (id) => { calls.push(['remove', id]); };
  const host = {
    request: async (method, params) => {
      calls.push(['request', method, params]);
      return {sessions: activePanels};
    },
  };
  return {pane, state, host, calls};
}

test('recovery retries exactly one stuck card, in the pane that owns it', async () => {
  const {pane, host, calls} = harness({
    queue: [
      {id: 'q1', sendState: 'waiting-reconnect', text: '第一件事', createdAt: Date.now()},
      {id: 'q2', sendState: 'waiting-reconnect', text: '第二件事', createdAt: Date.now()},
    ],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const retried = await recoverPane(pane, host);
  assert.deepEqual(retried, ['q1']);
  assert.deepEqual(calls.filter((c) => c[0] === 'retry'), [['retry', 'q1']]);
});

test('a healthy run in another pane is never treated as this pane being idle', async () => {
  const {pane, host, calls} = harness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: Date.now()}],
    activePanels: [
      {key: 'agent:project:main', status: 'running', hasActiveRun: true},
      {key: 'agent:main:main', status: 'running', hasActiveRun: true},
    ],
  });
  assert.deepEqual(await recoverPane(pane, host), []);
  assert.equal(calls.some((c) => c[0] === 'retry'), false);
});

test('a pane whose own run is live is left alone without asking the gateway', async () => {
  const {pane, state, host, calls} = harness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: Date.now()}],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  state.chatRunId = 'run-live';
  assert.deepEqual(await recoverPane(pane, host), []);
  assert.equal(calls.filter((c) => c[0] === 'request').length, 0);
});

test('a card already delivered is removed, not re-sent', async () => {
  const at = Date.now();
  const {pane, host, calls} = harness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '已经发出的一句', createdAt: at}],
    messages: [{role: 'user', content: '已经发出的一句', timestamp: at + 400}],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  await recoverPane(pane, host);
  assert.deepEqual(calls.filter((c) => c[0] === 'retry'), []);
  assert.deepEqual(calls.filter((c) => c[0] === 'remove'), [['remove', 'q1']]);
});

test('a gateway error, a missing row or a row without status means "unknown"', async () => {
  const {pane} = harness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: Date.now()}],
  });
  assert.deepEqual(await recoverPane(pane, {request: async () => { throw new Error('timeout'); }}), []);
  assert.deepEqual(await recoverPane(pane, {request: async () => ({sessions: []})}), []);
  // SessionRow.status is optional: absent must never be read as "idle".
  assert.deepEqual(await recoverPane(pane, {request: async () => ({sessions: [{key: 'agent:project:main'}]})}), []);
  // Nor may an active status be.
  for (const status of ['running', 'queued']) {
    const result = await recoverPane(pane, {request: async () => ({sessions: [{key: 'agent:project:main', status}]})});
    assert.deepEqual(result, [], status);
  }
  // A card for a different session key must not be touched either.
  const other = harness({
    queue: [{id: 'q1', sessionKey: 'agent:main:main', sendState: 'waiting-reconnect', text: '在', createdAt: Date.now()}],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  assert.deepEqual(await recoverPane(other.pane, other.host), []);
});

/* ---- queue copy ---- */
test('queue copy uses one vocabulary and keeps unknown words intact', () => {
  assert.equal(queueText('引导'), '立即追加');
  assert.equal(queueText('Steer'), '立即追加');
  assert.equal(queueText('Queued (3)'), '待发送（3）');
  assert.equal(queueText('Queued ('), '待发送（');
  assert.equal(queueText(')'), '）');
  assert.equal(queueText('正在等待重新连接'), '等待重新连接');
  // Untranslated words are left alone rather than guessed at.
  assert.equal(queueText('Something new'), null);
  assert.equal(queueText(''), null);
});

test('gateway error sentences are reworded without dropping the original', () => {
  assert.equal(queueErrorText('Message will send when the Gateway reconnects.'), '连接恢复后会自动送出。');
  assert.equal(queueErrorText('Chat failed before the run started; try again.'), '这一轮还没开始就失败了，再试一次。');
  assert.equal(queueErrorText('ECONNRESET'), null);

  const queue = el('div', 'chat-queue');
  const error = el('div', 'chat-queue__error', queue);
  const span = el('span', 'chat-queue__error-text', error);
  const text = {nodeType: 3, nodeValue: 'Message will send when the Gateway reconnects.', parentElement: span};
  assert.equal(localizeQueueNode(text), true);
  assert.equal(text.nodeValue, '连接恢复后会自动送出。');
  // The original sentence stays attached to the element that now shows the rewrite.
  assert.equal(span.getAttribute('title'), 'Message will send when the Gateway reconnects.');
});

test('the steered badge reads as a state, the steer button as an action', () => {
  const queue = el('div', 'chat-queue');
  const badge = el('span', 'chat-queue__badge chat-queue__badge--steered', queue);
  const badgeText = {nodeType: 3, nodeValue: '引导', parentElement: badge};
  localizeQueueNode(badgeText);
  assert.equal(badgeText.nodeValue, '已追加');

  const button = el('button', 'chat-queue__action chat-queue__steer', el('span', 'chat-queue__actions', queue));
  button.setAttribute('aria-label', '使用队列中的消息进行引导');
  const label = el('span', '', button);
  const buttonText = {nodeType: 3, nodeValue: '引导', parentElement: label};
  localizeQueueNode(buttonText);
  assert.equal(buttonText.nodeValue, '立即追加');
  assert.equal(button.getAttribute('aria-label'), '立即追加这条消息');
});

test('queue copy never reaches chat content, the queue text itself or the composer', () => {
  const group = el('div', 'chat-group user');
  const text = {nodeType: 3, nodeValue: '引导', parentElement: el('div', 'chat-text', group)};
  assert.equal(localizeQueueNode(text), false);
  assert.equal(text.nodeValue, '引导');

  // A queued message whose own words are “引导” must keep them.
  const queue = el('div', 'chat-queue');
  const copy = el('span', 'chat-queue__text', el('span', 'chat-queue__copy', queue));
  const own = {nodeType: 3, nodeValue: '引导', parentElement: copy};
  assert.equal(localizeQueueNode(own), false);
  assert.equal(own.nodeValue, '引导');

  // The edit box is the draft, not chrome.
  const editing = el('textarea', 'chat-queue__edit-input', queue);
  const draft = {nodeType: 3, nodeValue: 'Steer', parentElement: editing};
  assert.equal(localizeQueueNode(draft), false);

  const composer = el('div', 'agent-chat__composer');
  const type = {nodeType: 3, nodeValue: 'Steer', parentElement: composer};
  assert.equal(localizeQueueNode(type), false);
  assert.equal(type.nodeValue, 'Steer');
});

test('control-segment detector does not confuse ordinary text', () => {
  assert.equal(__test.CONTROL_SEGMENT.test(WATCHDOG), true);
  assert.equal(__test.CONTROL_SEGMENT.test('我写了 [pinkie-watchdog] 这个词'), true); // it is present…
  assert.equal(isInternalTurnText('我写了 [pinkie-watchdog] 这个词'), false); // …but not at the start
});

/* ---- chrome copy ---- */
// A tiny document stub for the attribute-only rewrite.
const docWith = (...placeholders) => {
  const nodes = placeholders.map((value) => {
    const attrs = new Map([['placeholder', value]]);
    return {attrs, getAttribute: (name) => attrs.get(name) ?? null, setAttribute: (name, v) => attrs.set(name, v)};
  });
  return {nodes, querySelectorAll: () => nodes};
};

test('upstream brand names are renamed only in exact chrome placeholders', async () => {
  const {localizeRecoveryChrome} = await import('../services/cle-studio/src/recovery/recovery.js');
  const doc = docWith('给 OpenClaw 发消息…', 'OpenClaw 正在思考', '描述你看到的情况');
  assert.equal(localizeRecoveryChrome(doc), 2);
  assert.equal(doc.nodes[0].attrs.get('placeholder'), '给李岸发消息…');
  assert.equal(doc.nodes[1].attrs.get('placeholder'), '李岸正在思考');
  // Anything not exactly known is left alone rather than partially rewritten.
  assert.equal(doc.nodes[2].attrs.get('placeholder'), '描述你看到的情况');
});
