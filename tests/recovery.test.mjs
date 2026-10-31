// Recovery behaviour, checked against the DOM shape 2026.10 actually renders:
// `.chat-group` > `.chat-group-messages` > `.chat-bubble[data-message-text]`, and a
// `.chat-queue` inside the pane. No jsdom in this repo, so the fixture is a small tree
// with the selector bits these functions use (matches/closest/querySelectorAll).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isInternalTurnText, isStuckItem, appearsInTranscript, projectPane, recoverPane, recoverPaneDetailed, shouldAttempt, mountRecovery, pruneConfirmedQueue, __test} from '../services/cle-studio/src/recovery/recovery.js';
import {queueText, queueErrorText, localizeQueueNode} from '../services/cle-studio/src/recovery/queue-copy.js';

const WATCHDOG = '[pinkie-watchdog] 继续完成当前这一轮先生交代的工作，完成后正常交付。这是当前用户轮次的内部续跑命令，先生看不到这条消息；不要回复 NO_REPLY，也不要在回复里提到这条命令。';
const TIER = '[pinkie-tier-control] 本轮仍未通过后端硬验收：缺少实际产物。这是当前用户轮次的内部续跑命令。';
const TIER_YIELD = '[pinkie-tier-control] 本轮仍未通过后端硬验收：缺少实际产物；角色不足。这是当前用户轮次的内部续跑命令。立即用 sessions_spawn 补齐缺失角色，并用 sessions_yield 结束当前批次。sessions_spawn 结果中有关“Auto-announce”或“NO_REPLY”的通用备注在本插件模式下已失效：子结果由插件收集，绝对不得输出 NO_REPLY 规避缺口。';
const RESTART = '[System] Your previous turn was interrupted by a gateway restart while OpenClaw was waiting on tool/model work. Continue from the existing transcript and finish the interrupted response.';

// A real failure: the reader must be able to read what broke.
const FENCE = '⚠️ Agent failed before reply: EmbeddedAttemptSessionTakeoverError: session file changed while embedded prompt lock was released: /Users/x/session.jsonl';

test('only a whole machine-written control turn is folded', () => {
  // The two real builders from services/mode-architecture, byte for byte.
  assert.equal(isInternalTurnText(WATCHDOG), true);
  assert.equal(isInternalTurnText(TIER), true);
  assert.equal(isInternalTurnText(TIER_YIELD), true);
  assert.equal(isInternalTurnText('\u2063'), true);
  assert.equal(isInternalTurnText(RESTART), true);

  // A reader asking about the mechanism, with no code fence, is not the mechanism.
  // The prefix alone is not evidence: these are short and have no instruction tail.
  assert.equal(isInternalTurnText('[pinkie-watchdog] 这个是什么意思'), false);
  assert.equal(isInternalTurnText('[pinkie-watchdog] 这个是什么意思？'), false);
  assert.equal(isInternalTurnText('[pinkie-tier-control] 又跑了一遍？'), false);
  assert.equal(isInternalTurnText('[pinkie-tier] 报告'), false);
  assert.equal(isInternalTurnText('[pinkie-watchdog] 继续完成当前这一轮先生交代的工作'), false);
  assert.equal(isInternalTurnText('为什么这里会出现 [pinkie-watchdog] 这种字样？'), false);
  assert.equal(isInternalTurnText('看看 [pinkie-watchdog] 前缀是怎么加的'), false);
  assert.equal(isInternalTurnText('pinkie-watchdog 是什么'), false);

  // An assistant restating the instruction for the reader is a reply, not a control turn.
  // It has the prefix and even the words, but not the exact trailing scaffold.
  assert.equal(isInternalTurnText('[pinkie-watchdog] 是网关内部续跑用的前缀，我自己不会发。'), false);
  assert.equal(isInternalTurnText('刚才那条 [pinkie-watchdog] 消息是系统自己发的，你看不到它是正常的。'), false);

  // Empty and ordinary text.
  assert.equal(isInternalTurnText(''), false);
  assert.equal(isInternalTurnText('继续完成当前这一轮先生交代的工作'), false);
});

test('a real failure stays visible while an internal turn is folded', () => {
  // The session-fence error is a real fault the reader needs. It used to be hidden by
  // a prefix test; now only the exact restart sentence and the control scaffold fold.
  assert.equal(isInternalTurnText(FENCE), false);
  assert.equal(isInternalTurnText('Agent failed before reply: session file changed while embedded prompt lock was released: /x'), false);
  assert.equal(isInternalTurnText('⚠️ gateway restart 之后这轮就断了'), false);

  const pane = paneOf();
  const group = el('div', 'chat-group assistant', pane);
  const failure = bubble(group, FENCE);
  bubble(group, RESTART);
  projectPane(pane);
  // The internal one folds, the failure does not, so the group stays on screen.
  assert.equal(group.getAttribute('data-cle-internal-only'), null);
  assert.equal(failure.getAttribute('data-cle-internal-turn'), null);
  assert.equal(group.getAttribute('aria-hidden'), null);
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

const bubble = (group, text, {code = false} = {}) => {
  const b = el('div', 'chat-bubble', el('div', 'chat-group-messages', group));
  b.setAttribute('data-message-text', text);
  const text_ = el('div', 'chat-text', b);
  text_.append({nodeType: 3, nodeValue: text, parentElement: null});
  // A draft embedded in a control message renders its code block as real <pre>/<code>.
  // The regression below depends on that being present in the DOM.
  if (code) { const pre = el('pre', '', text_); el('code', 'language-javascript', pre); }
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

test('a reader showing the control text in a fence keeps it visible', () => {
  // Behaviour pinned by review 1804: the wrapper, not the presence of a <pre>, decides.
  // A user demonstrating the text writes a fence, so the raw markdown starts with one
  // and the bubble renders code — and it must stay readable.
  const pane = paneOf();
  const group = el('div', 'chat-group user', pane);
  const quoted = bubble(group, '```\n' + WATCHDOG + '\n```', {code: true});
  bubble(group, '这条是普通消息');

  assert.equal(projectPane(pane), 0);
  assert.equal(quoted.getAttribute('data-cle-internal-turn'), null);
  assert.equal(group.getAttribute('data-cle-internal-only'), null);
});

test('a bare control text that merely renders code is still the gateway\'s turn', () => {
  // Same DOM shape as above (a real <pre> inside the bubble) but no wrapper in the
  // source: this is the internal command whose draft embeds code, so it folds.
  const pane = paneOf();
  const group = el('div', 'chat-group user', pane);
  const control = bubble(group, WATCHDOG, {code: true});
  assert.equal(projectPane(pane), 1);
  assert.equal(control.getAttribute('data-cle-internal-turn'), '1');
  assert.equal(group.getAttribute('data-cle-internal-only'), '1');
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
  pane.removeQueuedMessage = (id) => { calls.push(['remove', id]); state.chatQueue=state.chatQueue.filter((item)=>item.id!==id); };
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

test('a real control message whose draft contains code is still folded (review 1804)', () => {
  // The actual text captured from the QA session. Its embedded final draft holds a
  // ```javascript block, so the rendered bubble contains a <pre><code>. That used to
  // veto the fold and leak the whole internal reminder plus the draft.
  const raw = fs.readFileSync(new URL('./fixtures/qa-watchdog-with-code.txt', import.meta.url), 'utf8');
  assert.ok(raw.length > 1000, 'fixture should be the real captured length');
  assert.ok(/这是当前用户轮次的内部续跑命令/u.test(raw), 'fixture should carry the canonical tail');
  assert.ok(raw.includes('```javascript'), 'the draft really does embed a code block');

  // Recognised as a control turn regardless of the code inside it.
  assert.equal(isInternalTurnText(raw), true);

  const pane = paneOf();
  const group = el('div', 'chat-group user', pane);
  const control = bubble(group, raw, {code: true});
  // Prove the DOM really has the code the old check looked for.
  assert.equal(control.querySelectorAll('code').length, 1);

  projectPane(pane);
  assert.equal(control.getAttribute('data-cle-internal-turn'), '1');
  assert.equal(group.getAttribute('data-cle-internal-only'), '1');
  assert.equal(group.getAttribute('aria-hidden'), 'true');
});

test('the same control text is not folded when the reader wraps it', () => {
  const raw = fs.readFileSync(new URL('./fixtures/qa-watchdog-with-code.txt', import.meta.url), 'utf8');
  // Every wrapper a reader can produce while showing the text to someone.
  for (const wrapped of [`> ${raw}`, '```\n' + raw + '\n```', `“${raw}”`, `「${raw}」`]) {
    assert.equal(isInternalTurnText(wrapped), false, wrapped.slice(0, 24));
  }
  // Wrapped in a fence, the bubble also holds <pre>; it must stay visible.
  const pane = paneOf();
  const group = el('div', 'chat-group user', pane);
  const quoted = bubble(group, '```\n' + raw + '\n```', {code: true});
  projectPane(pane);
  assert.equal(quoted.getAttribute('data-cle-internal-turn'), null);
  assert.equal(group.getAttribute('data-cle-internal-only'), null);
});

test('a real failure with a stack stays visible even beside a folded control turn', () => {
  const pane = paneOf();
  const group = el('div', 'chat-group assistant', pane);
  const control = bubble(group, TIER, {code: true});
  const failure = bubble(group, FENCE, {code: true});
  projectPane(pane);
  assert.equal(control.getAttribute('data-cle-internal-turn'), '1');
  // The failure is not internal, so the group cannot be folded as a whole.
  assert.equal(failure.getAttribute('data-cle-internal-turn'), null);
  assert.equal(group.getAttribute('data-cle-internal-only'), null);
  assert.equal(group.getAttribute('aria-hidden'), null);
});

/* ---- retry attempt accounting (backoff on failure, not just on success) ---- */
test('a retry that throws is still counted as an attempt', async () => {
  const {pane, host} = harness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: Date.now()}],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  // The native path can throw synchronously or reject; both mean it was attempted.
  pane.retryQueuedChatMessage = () => { throw new Error('gateway refused'); };
  const sync = await recoverPaneDetailed(pane, host);
  assert.deepEqual(sync.retried, []);
  assert.equal(sync.attempted, true);

  const rejecting = harness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: Date.now()}],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  rejecting.pane.retryQueuedChatMessage = async () => { throw new Error('gateway refused'); };
  const async = await recoverPaneDetailed(rejecting.pane, rejecting.host);
  assert.deepEqual(async.retried, []);
  assert.equal(async.attempted, true);

  // A pass that never reached the retry must not claim one.
  const idle = harness({
    queue: [{id: 'q1', sendState: 'sending', text: '在', createdAt: Date.now()}],
    activePanels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const none = await recoverPaneDetailed(idle.pane, idle.host);
  assert.equal(none.attempted, false);
});

test('a failed attempt still starts the cooldown that stops a retry storm', async () => {
  const calls = [];
  const at = 1_000_000;
  const pane = el('openclaw-chat-pane', '');
  pane.dataset.mcpAppOwnerKey = JSON.stringify(['x', 'agent:project:main']);
  pane.isConnected = true;
  pane.state = {
    sessionKey: 'agent:project:main', chatMessages: [], chatRunId: null,
    chatQueue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: at}],
  };
  pane.retryQueuedChatMessage = async () => { calls.push(1); throw new Error('refused'); };
  const host = {request: async () => ({sessions: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}]})};

  const first = await recoverPaneDetailed(pane, host);
  // The attempt failed, but it happened — that is what has to arm the backoff.
  assert.equal(first.attempted, true);
  assert.deepEqual(first.retried, []);
  assert.equal(calls.length, 1);

  // With the attempt recorded, a burst of DOM/reconnect events inside the window is
  // rejected before it ever reaches the gateway.
  const lastAttemptAt = at;
  for (const delta of [0, 50, 400, 2_000, 5_999]) {
    assert.equal(shouldAttempt(lastAttemptAt, at + delta, 6_000), false, `${delta}ms must not retry`);
  }
  assert.equal(shouldAttempt(lastAttemptAt, at + 6_000, 6_000), true);
  // A pane that was never attempted is free to try immediately.
  assert.equal(shouldAttempt(undefined, at, 6_000), true);
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
  assert.equal(badgeText.nodeValue, '正在确认追加');

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

/* ---- activation lifecycle (real abort behaviour, not a source grep) ---- */
// mountRecovery touches document.body, MutationObserver, timers, rAF and the host
// event bus. To test retirement honestly we install a controllable set of globals,
// run one activation, abort it, and then assert nothing it owned still runs.
function lifecycleHarness({queue = [], panels = []} = {}) {
  const timers = new Map();       // id -> {fn, at}
  const intervals = new Map();
  const frames = new Map();
  let nextId = 1;
  let now = 0;

  const runTimers = (untilMs) => {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      timers.delete(id);
      now = t.at;
      t.fn();
    }
    now = untilMs;
  };

  const pane = el('openclaw-chat-pane', 'chat-pane-cache__pane--visible chat-pane-cache__pane--active');
  pane.dataset.mcpAppOwnerKey = JSON.stringify(['x', 'agent:project:main']);
  pane.isConnected = true;
  pane.state = {
    sessionKey: 'agent:project:main', connected: true, chatMessages: [],
    chatRunId: null, chatQueue: queue.map((item) => ({...item})),
  };
  const retries = [];
  const removals = [];
  pane.retryQueuedChatMessage = async (id) => { retries.push(id); };
  pane.removeQueuedMessage = (id) => { removals.push(id); pane.state.chatQueue=pane.state.chatQueue.filter((item)=>item.id!==id); };

  const body = el('div', 'body');
  const head = el('head', '');
  const styleIds = new Map();
  const observed = [];
  let listeners = 0;

  const document = {
    readyState: 'complete',
    body, head,
    documentElement: el('html', ''),
    getElementById: (id) => styleIds.get(id) || null,
    createElement: (tag) => {
      const node = el(tag, '');
      if (tag === 'style') node.textContent = '';
      return node;
    },
    querySelectorAll: (sel) => {
      // visiblePanes() asks the real document for cached panes; the harness has exactly
      // one, so answer that selector instead of pretending the pane list is empty.
      if (sel.includes('chat-pane-cache__pane--visible') || sel.includes('chat-pane-cache__pane--active')) return [pane];
      if (sel.includes('data-cle-internal')) return [];
      if (sel.includes('placeholder')) return [];
      return [];
    },
    querySelector: () => null,
    addEventListener: () => { listeners += 1; },
    removeEventListener: () => { listeners -= 1; },
  };
  // document.head.append(style) registers the stylesheet the same way the browser does
  head.append = (...kids) => {
    for (const kid of kids) { kid.parentElement = head; head.children.push(kid); if (kid.id) styleIds.set(kid.id, kid); }
    return head;
  };

  document.body.append(pane);

  const g = globalThis;
  const saved = {
    document: g.document, MutationObserver: g.MutationObserver,
    setTimeout: g.setTimeout, clearTimeout: g.clearTimeout,
    setInterval: g.setInterval, clearInterval: g.clearInterval,
    requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame,
  };
  g.document = document;
  g.setTimeout = (fn, delay = 0) => { const id = nextId++; timers.set(id, {fn, at: now + delay}); return id; };
  g.clearTimeout = (id) => { timers.delete(id); };
  g.setInterval = (fn, delay = 0) => { const id = nextId++; intervals.set(id, {fn, delay}); return id; };
  g.clearInterval = (id) => { intervals.delete(id); };
  g.requestAnimationFrame = (fn) => { const id = nextId++; frames.set(id, fn); return id; };
  g.cancelAnimationFrame = (id) => { frames.delete(id); };
  g.MutationObserver = class { constructor(cb) { this.cb = cb; observed.push(this); } observe() {} disconnect() { this.disconnected = true; } };

  const events = [];
  const subs = [];
  const host = {
    connection: {connected: true},
    request: async (method, params) => {
      events.push(['request', method]);
      return {sessions: panels};
    },
    onEvent: (name, fn) => { events.push(['on', name]); return () => events.push(['off', name]); },
    subscribe: (fn) => { subs.push(fn); return () => events.push(['off-sub']); },
  };

  const restore = () => { for (const [k, v] of Object.entries(saved)) g[k] = v; };
  return {pane, host, timers, intervals, frames, observed, events, subs, retries, removals, runTimers,
    advance: (ms) => runTimers(now + ms), now: () => now, restore, document, paneState: pane.state};
}

test('abort keeps proven internal rows folded and leaves no live work behind', async () => {
  const h = lifecycleHarness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: 1}],
    panels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const controller = new AbortController();
  try {
    const group = el('div', 'chat-group user', h.pane);
    const control = el('div', 'chat-bubble', el('div', 'chat-group-messages', group));
    control.setAttribute('data-message-text', WATCHDOG);
    const real = el('div', 'chat-bubble', el('div', 'chat-group-messages', group));
    real.setAttribute('data-message-text', '把报告发我');

    mountRecovery(h.host, controller.signal);
    // Activation projects immediately.
    assert.equal(control.getAttribute('data-cle-internal-turn'), '1');
    assert.equal(real.getAttribute('data-cle-internal-turn'), null);

    controller.abort();

    // The row this module positively identified must stay folded: a hot reload retires
    // the activation while the native history DOM still holds the message.
    assert.equal(control.getAttribute('data-cle-internal-turn'), '1',
      'a retired activation must not re-publish a verified internal row');
    assert.equal(control.getAttribute('aria-hidden'), 'true');
    assert.equal(real.getAttribute('data-cle-internal-turn'), null,
      'an ordinary message was never marked, so it stays visible');
    // The stylesheet that does the folding has to survive too.
    assert.ok(h.document.getElementById('cle-recovery-style'), 'fold rule must remain');

    // Every owned handle is released.
    assert.equal(h.observed.length, 1);
    assert.equal(h.observed[0].disconnected, true, 'observer disconnected');
    assert.equal(h.intervals.size, 0, 'no polling interval left');
    assert.equal(h.frames.size, 0, 'no pending animation frame');
    for (const [, t] of h.timers) assert.fail('a timer survived abort');
  } finally { h.restore(); }
});

test('a retired activation cannot retry the gateway or touch the DOM again', async () => {
  const h = lifecycleHarness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: 1}],
    panels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const controller = new AbortController();
  try {
    mountRecovery(h.host, controller.signal);
    const requestsBefore = h.events.filter((e) => e[0] === 'request').length;

    // Abort while the initial 1200ms projection timer is still pending.
    controller.abort();
    h.advance(60_000);

    assert.equal(h.retries.length, 0, 'no retry may be issued after abort');
    assert.equal(h.events.filter((e) => e[0] === 'request').length, requestsBefore,
      'no sessions.list after abort');
  } finally { h.restore(); }
});

test('abort during an in-flight recovery request does not arm a cooldown or repaint', async () => {
  const h = lifecycleHarness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: 1}],
  });
  const controller = new AbortController();
  let release;
  try {
    // The host hangs until we let it resolve, so abort lands mid-await.
    h.host.request = (method) => new Promise((resolve) => {
      h.events.push(['request', method]);
      release = () => resolve({sessions: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}]});
    });
    mountRecovery(h.host, controller.signal);
    h.advance(1_300);              // fires the initial projection pass
    await new Promise((resolve) => setImmediate(resolve)); // delivery pruning precedes the roster request
    assert.ok(release, 'the recovery request should be in flight');

    controller.abort();
    release();                     // resolve after retirement
    await new Promise((r) => setImmediate(r));

    assert.equal(h.retries.length, 0, 'a resolved-but-retired pass must not retry');
  } finally { h.restore(); }
});

test('terminal callbacks scheduled before abort never run', async () => {
  const h = lifecycleHarness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: 1}],
    panels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const controller = new AbortController();
  try {
    mountRecovery(h.host, controller.signal);
    // Simulate the 700ms "run ended" path being armed, then abort, then let time pass.
    h.events.push(['on', 'agent']);
    controller.abort();
    h.advance(60_000);
    assert.equal(h.retries.length, 0);
  } finally { h.restore(); }
});

test('a hot reload leaves exactly one live activation, not two', async () => {
  const h = lifecycleHarness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: 1}],
    panels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const first = new AbortController();
  const second = new AbortController();
  try {
    mountRecovery(h.host, first.signal);
    first.abort();
    const intervalsAfterFirst = h.intervals.size;
    mountRecovery(h.host, second.signal);
    second.abort();

    // Both activations released their own polling; nothing accumulates per reload.
    assert.equal(intervalsAfterFirst, 0);
    assert.equal(h.intervals.size, 0, 'no interval survives either activation');
    // Two observers were created, one per activation, and both are disconnected.
    assert.equal(h.observed.length, 2);
    assert.deepEqual(h.observed.map((o) => o.disconnected), [true, true]);
    for (const [, t] of h.timers) assert.fail('a timer survived both aborts');
    h.advance(60_000);
    assert.equal(h.retries.length, 0, 'a retired activation never sends');
  } finally { h.restore(); }
});

test('mounting with an already-aborted signal allocates nothing', async () => {
  const h = lifecycleHarness({
    queue: [{id: 'q1', sendState: 'waiting-reconnect', text: '在', createdAt: 1}],
    panels: [{key: 'agent:project:main', status: 'done', hasActiveRun: false}],
  });
  const controller = new AbortController();
  try {
    // A row that WOULD be folded by a live activation: proves an early return is not
    // sneaking in a projection either.
    const group = el('div', 'chat-group user', h.pane);
    const control = el('div', 'chat-bubble', el('div', 'chat-group-messages', group));
    control.setAttribute('data-message-text', WATCHDOG);

    controller.abort();                 // retire before mounting
    mountRecovery(h.host, controller.signal);

    // No resources created. addEventListener on an already-aborted signal would never
    // fire, so every one of these would otherwise leak for the page's lifetime.
    assert.equal(h.observed.length, 0, 'no MutationObserver');
    assert.equal(h.intervals.size, 0, 'no polling interval');
    assert.equal(h.timers.size, 0, 'no timeout');
    assert.equal(h.frames.size, 0, 'no animation frame');
    assert.equal(h.events.filter((e) => e[0] === 'on').length, 0, 'no onEvent subscription');
    assert.equal(h.subs.length, 0, 'no host.subscribe');

    // No behaviour: no RPC, and the DOM is left exactly as it was.
    h.advance(60_000);
    assert.equal(h.events.filter((e) => e[0] === 'request').length, 0, 'no sessions.list');
    assert.equal(h.retries.length, 0);
    assert.equal(control.getAttribute('data-cle-internal-turn'), null, 'no DOM writes');

    // The fold rule itself must survive: it is static presentation, not a handle.
    assert.ok(h.document.getElementById('cle-recovery-style'), 'fold rule retained');
  } finally { h.restore(); }
});


test('an active run prunes a durably confirmed steer without waiting for idle or retrying', async () => {
  const at = Date.now();
  const h = harness({queue: [
    {id:'accepted',kind:'steered',sendState:'unconfirmed',pendingRunId:'live',sendRunId:'steer-1',text:'追加任务',createdAt:at},
    {id:'waiting',sendState:'waiting-model',pendingRunId:'live',text:'稍后做',createdAt:at},
  ], messages:[{role:'user',content:'追加任务',idempotencyKey:'steer-1:user',timestamp:at+100}]});
  h.state.chatRunId='live';
  h.state.chatStream={runId:'live'};
  const result=await recoverPaneDetailed(h.pane,h.host);
  assert.deepEqual(result.removed,['accepted']);
  assert.deepEqual(result.retried,[]);
  assert.equal(result.attempted,false,'pruning never arms a send cooldown');
  assert.deepEqual(h.calls,[['remove','accepted']]);
  assert.equal(h.state.chatRunId,'live');
  assert.equal(h.state.chatStream.runId,'live');
  assert.equal(h.state.chatQueue[0].pendingRunId,'live');
});

test('delivery requires a user receipt and never falls back to text when sendRunId is known', () => {
  const at=Date.now();
  const item={id:'q',sendRunId:'expected',text:'相同文字',createdAt:at};
  assert.equal(appearsInTranscript(item,[{role:'assistant',runId:'expected',content:'相同文字'}]),false);
  assert.equal(appearsInTranscript(item,[{role:'user',runId:'other',content:'相同文字',timestamp:at+10}]),false);
  assert.equal(appearsInTranscript(item,[{role:'user',idempotencyKey:'expected:user',content:'不同文字'}]),true);
  assert.equal(appearsInTranscript(item,[{role:'user',__openclaw:{idempotencyKey:'expected:user'}}]),true);
});

test('fallback confirmation accepts ISO, second and millisecond dates only after queue creation', () => {
  const at=1_790_000_000_000;
  for(const createdAt of [at,at/1000,new Date(at).toISOString()]){
    for(const timestamp of [at+1000,(at+1000)/1000,new Date(at+1000).toISOString()]){
      assert.equal(appearsInTranscript({text:'同文',createdAt},[{role:'user',content:'同文',timestamp}]),true);
    }
    assert.equal(appearsInTranscript({text:'同文',createdAt},[{role:'user',content:'同文',timestamp:at-1}]),false);
  }
  assert.equal(appearsInTranscript({text:'同文',createdAt:at},[{role:'user',content:'同文'}]),false);
});

test('attachment confirmation requires enough persisted attachments and a creation timestamp', () => {
  const at=Date.now();
  const item={id:'image',createdAt:at,attachments:[{id:'image'}]};
  assert.equal(appearsInTranscript(item,[{role:'user',content:'',timestamp:at+1,MediaPaths:['/image.png']}]),true);
  assert.equal(appearsInTranscript(item,[{role:'user',content:'',timestamp:at+1}]),false);
  assert.equal(appearsInTranscript({...item,text:'图'},[{role:'user',content:'图',timestamp:at+1}]),false);
});

test('two identical cards cannot consume one receipt over separate polls or a replacement pane', async () => {
  const at=Date.now();
  const h=harness({queue:[
    {id:'first',kind:'steered',sendState:'unconfirmed',text:'重复一句',createdAt:at},
    {id:'second',kind:'steered',sendState:'unconfirmed',text:'重复一句',createdAt:at+1},
  ],messages:[{role:'user',content:'重复一句',timestamp:at+100,__openclaw:{id:'one-proof'}}]});
  h.state.chatRunId='live';
  assert.deepEqual(await pruneConfirmedQueue(h.pane),['first']);
  assert.deepEqual(await pruneConfirmedQueue(h.pane),[]);
  const replacement={...h.pane,state:h.state};
  assert.deepEqual(await pruneConfirmedQueue(replacement),[]);
  assert.equal(h.state.chatQueue[0].id,'second');
  assert.deepEqual(h.calls,[['remove','first']]);
  h.state.chatMessages.push({role:'user',content:'重复一句',timestamp:at+200,__openclaw:{id:'second-proof'}});
  assert.deepEqual(await pruneConfirmedQueue(replacement),['second']);
});

test('an exact retry receipt is reserved before a same-text fallback card', async () => {
  const at=Date.now();
  const h=harness({queue:[
    {id:'fallback',kind:'steered',text:'same',createdAt:at},
    {id:'exact',sendRunId:'exact-run',text:'same',createdAt:at+1},
  ],messages:[{role:'user',content:'same',timestamp:at+100,idempotencyKey:'exact-run:user'}]});
  assert.deepEqual(await pruneConfirmedQueue(h.pane),['exact']);
  assert.deepEqual(h.state.chatQueue.map(item=>item.id),['fallback']);
});

test('a no-op native remover never turns delivery confirmation into a retry', async () => {
  const at=Date.now();
  const h=harness({queue:[{id:'stuck',sendState:'waiting-reconnect',text:'delivered',createdAt:at}],
    messages:[{role:'user',content:'delivered',timestamp:at+1}],
    activePanels:[{key:'agent:project:main',status:'done',hasActiveRun:false}]});
  h.pane.removeQueuedMessage=()=>{};
  const result=await recoverPaneDetailed(h.pane,h.host);
  assert.deepEqual(result.removed,[]);
  assert.deepEqual(result.retried,[]);
  assert.equal(h.calls.some(call=>call[0]==='retry'),false);
});

test('a receipt arriving during the idle check is removed before retry is considered', async () => {
  const at=Date.now();
  const h=harness({queue:[{id:'race',sendState:'waiting-reconnect',text:'arrived',createdAt:at}]});
  h.host.request=async()=>{
    h.state.chatMessages.push({role:'user',content:'arrived',timestamp:at+100});
    return {sessions:[{key:'agent:project:main',status:'done',hasActiveRun:false}]};
  };
  const result=await recoverPaneDetailed(h.pane,h.host);
  assert.deepEqual(result.removed,['race']);
  assert.deepEqual(result.retried,[]);
  assert.deepEqual(h.calls,[['remove','race']]);
});

test('a retired controller cannot remove or repaint the replacement controller after an awaited native action', async () => {
  const at=Date.now();
  const h=harness({queue:[{id:'old',kind:'steered',text:'old',createdAt:at}],
    messages:[{role:'user',content:'old',timestamp:at+100}]});
  let finish;
  h.pane.removeQueuedMessage=()=>new Promise(resolve=>{finish=resolve;});
  const pending=pruneConfirmedQueue(h.pane);
  const replacement={sessionKey:h.state.sessionKey,chatQueue:[{id:'new',text:'new'}],chatMessages:[]};
  h.pane.state=replacement;
  finish();
  assert.deepEqual(await pending,[]);
  assert.equal(replacement.chatQueue[0].id,'new');
});

test('mutation sweeps never scan the whole pane again and newly mounted panes project once', async () => {
  const h=lifecycleHarness();
  const controller=new AbortController();
  try {
    let scans=0;
    const original=h.pane.querySelectorAll;
    h.pane.querySelectorAll=(selector)=>{if(selector==='.chat-group')scans++;return original(selector);};
    mountRecovery(h.host,controller.signal);
    assert.equal(scans,1);
    const group=el('div','chat-group user',h.pane);
    const b=bubble(group,'streamed token');
    const text=b.querySelector('.chat-text').children[0];
    for(let i=0;i<3;i++){
      h.observed[0].cb([{type:'characterData',target:text}]);
      for(const [id,fn] of [...h.frames]){h.frames.delete(id);fn();}
      for(const {fn} of h.intervals.values())fn();
    }
    assert.equal(scans,1,'dirty rows and polling do not re-project history');
    const added=paneOf();
    added.isConnected=true;
    added.dataset.mcpAppOwnerKey=JSON.stringify(['x','agent:learning:new']);
    added.state={sessionKey:'agent:learning:new',chatQueue:[],chatMessages:[]};
    let addedScans=0;
    const query=added.querySelectorAll;
    added.querySelectorAll=(selector)=>{if(selector==='.chat-group')addedScans++;return query(selector);};
    const docQuery=h.document.querySelectorAll;
    h.document.querySelectorAll=(selector)=>selector.includes('chat-pane-cache__pane')?[h.pane,added]:docQuery(selector);
    h.observed[0].cb([{type:'childList',target:h.document.body,addedNodes:[added]}]);
    assert.equal(addedScans,1);
    h.observed[0].cb([{type:'characterData',target:text}]);
    assert.equal(addedScans,1,'the new pane projects only once');
  } finally {controller.abort();h.restore();}
});


test('a same-key session reset during native removal stops pruning the new incarnation', async () => {
  const at=Date.now();
  const h=harness({queue:[
    {id:'first',sendRunId:'one',kind:'steered',text:'one',createdAt:at},
    {id:'second',sendRunId:'two',kind:'steered',text:'two',createdAt:at},
  ],messages:[
    {role:'user',content:'one',idempotencyKey:'one:user'},
    {role:'user',content:'two',idempotencyKey:'two:user'},
  ]});
  h.state.currentSessionId='before-reset';
  let finish;
  h.pane.removeQueuedMessage=(id)=>{
    h.calls.push(['remove',id]);
    return new Promise(resolve=>{finish=resolve;});
  };
  const pruning=pruneConfirmedQueue(h.pane);
  h.state.currentSessionId='after-reset';
  h.state.chatQueue=[{id:'second',kind:'queued',text:'new incarnation'}];
  h.state.chatMessages=[];
  finish();
  assert.deepEqual(await pruning,[]);
  assert.deepEqual(h.calls,[['remove','first']]);
  assert.equal(h.state.chatQueue[0].text,'new incarnation');
});

test('delivery fallback keeps internal whitespace meaningful and leaves unproved busy cards unchanged', async () => {
  const at=Date.now();
  assert.equal(appearsInTranscript({text:'a  b',createdAt:at},[{role:'user',content:'a b',timestamp:at+1}]),false);
  assert.equal(appearsInTranscript({text:'a\nb',createdAt:at},[{role:'user',content:'a b',timestamp:at+1}]),false);
  const h=harness({queue:[{id:'unconfirmed',kind:'steered',sendState:'unconfirmed',pendingRunId:'active',text:'a  b',createdAt:at}],
    messages:[{role:'user',content:'a b',timestamp:at+1}]});
  h.state.chatRunId='active';
  const before={...h.state.chatQueue[0]};
  assert.deepEqual(await recoverPaneDetailed(h.pane,h.host),{retried:[],removed:[],attempted:false});
  assert.deepEqual(h.state.chatQueue[0],before);
  assert.deepEqual(h.calls,[]);
});
