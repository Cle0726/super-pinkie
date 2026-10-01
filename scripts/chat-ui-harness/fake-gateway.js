/* Fake CLE Kk / OpenClaw gateway for the chat UI harness (see README.md).
   Loaded before every app script: replaces window.WebSocket, so the native
   chat client and the laolao sidebar socket both talk to this in-page gateway.
   Event shapes follow OpenClaw 2026.7.1-2 server-chat / server-session-events:
   - `chat` deltas/final are broadcast; a run's text accumulates across its tool
     calls (previousText + delta) and `final` carries the whole run's text;
   - tool events reach the chat.send caller as `agent`, other session
     subscribers as `session.tool`;
   - every persisted transcript message is announced as `session.message`.
   Drive it from the page console: await __fake.scenario('narrated', {...}).

   Queue/steer probes deliberately model the awkward boundaries that matter to
   the Control UI: a run can end without its terminal event, a steer can be
   accepted on the current run, and an acknowledgement can lose the race with
   the run ending.  See the README's "追加消息" table for the six probes. */
(() => {
  'use strict';
  const AGENT = 'unrestricted';
  const SK = 'agent:unrestricted:dashboard:harness0001';
  const SID = 'harness-session-0001';
  const log = [];
  const note = (kind, detail) => { log.push({t: Date.now(), kind, ...detail}); };

  const state = {
    history: [],
    seq: 0,
    activeRuns: new Set(),
    runText: new Map(),
    sockets: new Set(),
    lastUiSocket: null,
    autoScenario: null,
    model: 'gemini-3.6-flash',
    deepThinkStatus: {active: false},
    // This is server-side observability, not a second implementation of the
    // native composer queue.  A delivery is written only once the fake server
    // has accepted the message, so browser tests can distinguish a visible
    // queue card from a message that really reached a run.
    deliveries: [],
    injectionsByRun: new Map(),
    transport: {
      steerPlans: [],
      normalPlans: [],
      autoCompleteNormal: false,
      normalReply: '已收到这条后续消息。【队列已发送】',
    },
    refreshSnapshot: null,
  };

  const now = () => Date.now();
  const text = (t) => [{type: 'text', text: t}];
  const trimText = (value) => String(value ?? '').trim();
  const activeRunId = () => [...state.activeRuns].at(-1) || null;
  const acceptedSendStatus = (status) => ['ok', 'started', 'in_flight', 'accepted'].includes(status);
  const nextPlan = (kind) => {
    const plans = kind === 'steer' ? state.transport.steerPlans : state.transport.normalPlans;
    return plans.length ? plans.shift() : {};
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const persist = (message) => {
    state.seq += 1;
    const stored = {...message, timestamp: message.timestamp ?? now(),
      __openclaw: {id: `m${state.seq}`, seq: state.seq}};
    state.history.push(stored);
    return stored;
  };

  const alreadyDelivered = (idempotencyKey) => idempotencyKey
    ? state.deliveries.find((entry) => entry.idempotencyKey === idempotencyKey) || null
    : null;
  const recordDelivery = ({message, runId, kind, status, idempotencyKey, source = 'chat.send'}) => {
    const value = trimText(message);
    const duplicate = alreadyDelivered(idempotencyKey);
    if (duplicate) return {...duplicate, duplicate: true};
    const delivery = {
      id: `delivery-${state.deliveries.length + 1}`,
      message: value,
      runId: runId || null,
      kind,
      status,
      idempotencyKey: idempotencyKey || null,
      source,
      acceptedAt: now(),
    };
    state.deliveries.push(delivery);
    // A steering message is a real user message.  Announce it exactly as the
    // gateway does so history de-duplication and timeline grouping can see it.
    if (value) persistAndAnnounce({role: 'user', content: text(value)});
    note('delivery', {id: delivery.id, kind, runId: delivery.runId, status, message: value});
    return delivery;
  };
  const injectedMessages = (runId) => state.injectionsByRun.get(runId) || [];
  const rememberInjection = (runId, delivery) => {
    if (!runId || !delivery || delivery.duplicate) return;
    state.injectionsByRun.set(runId, [...injectedMessages(runId), delivery]);
  };

  // Native Control UI composer persistence.  This helper is intentionally a
  // seed only: the browser still owns queue hydration, retry and removal.
  // Writing all known local URLs makes the probe work whether the app had a
  // saved gateway URL or is using its default connection.
  const COMPOSER_STORE_PREFIX = 'openclaw.control.chatComposer.v1:';
  const composerSessionKey = `${SK}\u0000agent:${AGENT}`;
  const composerStorage = () => {
    try { return window.localStorage || null; } catch { return null; }
  };
  const composerStorageKeys = (gatewayUrl) => {
    const storage = composerStorage();
    const keys = new Set([
      `${COMPOSER_STORE_PREFIX}default`,
      `${COMPOSER_STORE_PREFIX}${encodeURIComponent('ws://127.0.0.1:18789')}`,
      `${COMPOSER_STORE_PREFIX}${encodeURIComponent('ws://localhost:18789')}`,
    ]);
    if (gatewayUrl) keys.add(`${COMPOSER_STORE_PREFIX}${encodeURIComponent(gatewayUrl)}`);
    // The harness itself can run on an arbitrary localhost port. Include the
    // live fake socket URL so a reload exercises the exact persistence key
    // that this Control UI instance will hydrate, not only app defaults.
    for (const socket of state.sockets) {
      if (socket?.url) keys.add(`${COMPOSER_STORE_PREFIX}${encodeURIComponent(socket.url)}`);
    }
    try {
      for (let i = 0; storage && i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(COMPOSER_STORE_PREFIX)) keys.add(key);
      }
    } catch {}
    return [...keys];
  };
  const seedComposerQueue = (entries, {gatewayUrl} = {}) => {
    const storage = composerStorage();
    const queue = clone(entries || []);
    const keys = composerStorageKeys(gatewayUrl);
    if (!storage) return {seeded: false, keys: [], queue};
    for (const key of keys) {
      let saved = {version: 1, sessions: {}};
      try {
        const raw = storage.getItem(key);
        if (raw) saved = JSON.parse(raw);
      } catch {}
      if (!saved || saved.version !== 1 || !saved.sessions || typeof saved.sessions !== 'object') {
        saved = {version: 1, sessions: {}};
      }
      saved.sessions[composerSessionKey] = {queue, updatedAt: now()};
      storage.setItem(key, JSON.stringify(saved));
    }
    note('composer-queue-seeded', {count: queue.length, keys});
    return {seeded: true, keys, queue};
  };

  // Seed: an earlier completed exchange so the window is not empty.  A page
  // can instead define window.__fakeSeedHistory (e.g. a real chat.history
  // `messages` array) before this script runs to replay a recorded session.
  const seedHistory = Array.isArray(window.__fakeSeedHistory) ? window.__fakeSeedHistory : null;
  if (seedHistory) {
    for (const message of seedHistory) persist(clone(message));
  } else {
    persist({role: 'user', content: text('你好，碧琪')});
    persist({role: 'assistant', content: text('你好呀！有什么要我帮忙的？'), stopReason: 'stop'});
  }

  const row = () => ({
    key: SK, sessionId: SID, kind: 'direct', chatType: 'direct', channel: 'webchat',
    label: 'harness', displayName: 'harness', updatedAt: now(), agentId: AGENT,
    hasActiveRun: state.activeRuns.size > 0, activeRunIds: [...state.activeRuns],
    status: state.activeRuns.size > 0 ? 'running' : 'done', model: state.model, modelProvider: 'mm',
  });
  const snapshot = () => {
    const r = row();
    return {session: r, updatedAt: r.updatedAt, sessionId: SID, kind: 'direct',
      hasActiveRun: r.hasActiveRun, activeRunIds: r.activeRunIds, status: r.status};
  };

  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0; this.bufferedAmount = 0; this.protocol = ''; this.extensions = '';
      this.binaryType = 'blob'; this.evSeq = 0; this.subscribedSessions = false;
      this.subscribedMessages = false; this.id = `conn${Math.random().toString(16).slice(2, 8)}`;
      state.sockets.add(this);
      note('socket-open', {id: this.id, url: this.url});
      setTimeout(() => {
        this.readyState = 1;
        this._fire('open', new Event('open'));
        this._event('connect.challenge', {nonce: `n${Math.random()}`, ts: now()}, false);
      }, 5);
    }
    _fire(type, ev) {
      const handler = this['on' + type];
      if (typeof handler === 'function') { try { handler.call(this, ev); } catch (e) { console.error(e); } }
      this.dispatchEvent(ev);
    }
    _raw(obj) {
      if (this.readyState !== 1) return;
      this._fire('message', new MessageEvent('message', {data: JSON.stringify(obj)}));
    }
    _event(event, payload, withSeq = true) {
      const frame = {type: 'event', event, payload};
      if (withSeq) frame.seq = ++this.evSeq;
      this._raw(frame);
    }
    send(data) {
      let frame; try { frame = JSON.parse(data); } catch { return; }
      if (frame?.type !== 'req') return;
      Promise.resolve().then(() => handleReq(this, frame));
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 3; state.sockets.delete(this);
      const CloseEventImpl = typeof CloseEvent === 'function' ? CloseEvent : Event;
      setTimeout(() => this._fire('close', new CloseEventImpl('close', {code, reason, wasClean: true})), 0);
    }
  }
  Object.assign(FakeSocket, {CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3});
  window.WebSocket = FakeSocket;

  const broadcast = (event, payload, filter = () => true) => {
    for (const socket of state.sockets) if (filter(socket)) socket._event(event, payload);
    note('emit', {event, state: payload?.state, runId: payload?.runId, stream: payload?.stream});
  };

  const historyPage = (params) => {
    const limit = Math.max(1, Number(params?.limit) || 200);
    const offset = Math.max(0, Number(params?.offset) || 0);
    const end = Math.max(0, state.history.length - offset);
    const start = Math.max(0, end - limit);
    return {
      sessionKey: SK, sessionId: SID, sessionInfo: {sessionId: SID},
      messages: state.history.slice(start, end), hasMore: start > 0,
      totalMessages: state.history.length, thinkingLevel: null, verboseLevel: null,
    };
  };

  const hello = () => ({
    type: 'hello-ok', protocol: 4,
    server: {version: '2026.7.1-2', connId: 'fake', host: 'harness'},
    features: {methods: [], events: ['chat', 'agent', 'session.message', 'session.tool', 'sessions.changed']},
    snapshot: {presence: [], health: {ok: true}, stateVersion: {presence: 0, health: 0}, uptimeMs: 1000,
      sessionDefaults: {defaultAgentId: AGENT, mainKey: 'main', mainSessionKey: `agent:${AGENT}:main`, scope: 'per-sender'}},
    policy: {maxPayload: 26214400, maxBufferedBytes: 52428800, tickIntervalMs: 30000},
    auth: {role: 'operator', scopes: ['operator.admin', 'operator.read', 'operator.write']},
  });

  const QUEUE_PROBE_SCENARIOS = new Set([
    'queue-normal', 'busy-queue-normal',
    'queue-missing-terminal', 'busy-queue-missing-terminal',
    'steer-accepted', 'steer-race-ended', 'queue-refresh', 'watchdog-append',
  ]);

  function scheduleAutoScenario(socket, params, runId) {
    const auto = state.autoScenario;
    if (!auto) return false;
    const scenario = scenarios[auto.name];
    if (typeof scenario !== 'function') {
      note('scenario-missing', {name: auto.name});
      return false;
    }
    if (auto.once || QUEUE_PROBE_SCENARIOS.has(auto.name)) state.autoScenario = null;
    setTimeout(() => scenario({...auto.opts, uiRunId: runId, uiSocket: socket,
      userText: String(params.message || '')}), 30);
    return true;
  }

  async function completeDeliveredNormalRun(runId, message, plan) {
    // The native client has already rendered the optimistic user message from
    // the accepted send.  Do not persist it twice in this fake transcript.
    startRun(runId, message, {persistUser: false});
    await sleep(plan.replyDelayMs ?? 45);
    await finishRun(runId, plan.reply || state.transport.normalReply, plan.replyGap ?? 8);
  }

  async function receiveChatSend(socket, params) {
    const requestedRunId = trimText(params?.idempotencyKey) || `run-${now()}`;
    const message = String(params?.message || '');
    state.lastUiSocket = socket;
    const currentRunId = activeRunId();

    if (currentRunId) {
      const plan = nextPlan('steer');
      const status = plan.status || 'in_flight';
      note('steer-request', {runId: currentRunId, requestedRunId, status, message: trimText(message)});

      // Reproduce the narrow race that matters to pane.steerQueuedChatMessage:
      // it observed a live run, but the server ends it before the acknowledgement
      // reaches the browser.  No user message is persisted in that branch.
      if (plan.endBeforeReply && state.activeRuns.has(currentRunId)) {
        await sleep(plan.endDelayMs ?? 0);
        if (state.activeRuns.has(currentRunId)) {
          await finishRun(currentRunId, plan.terminalReply || '这一轮刚好结束。【race terminal】', plan.terminalGap ?? 4);
        }
      }
      if (plan.responseDelayMs) await sleep(plan.responseDelayMs);

      if (acceptedSendStatus(status) && plan.persist !== false) {
        const delivery = recordDelivery({
          message, runId: currentRunId, kind: 'steer', status,
          idempotencyKey: requestedRunId,
        });
        rememberInjection(currentRunId, delivery);
      }
      return {runId: currentRunId, status};
    }

    const plan = nextPlan('normal');
    const status = plan.status || 'started';
    note('normal-send', {runId: requestedRunId, status, message: trimText(message)});
    if (!acceptedSendStatus(status)) return {runId: requestedRunId, status};

    // The first user send of an auto scenario is persisted by startRun inside
    // that scenario.  A later queue retry has no auto scenario and is recorded
    // here, exactly once, before its lightweight follow-up run begins.
    if (scheduleAutoScenario(socket, params, requestedRunId)) return {runId: requestedRunId, status};
    const delivery = recordDelivery({
      message, runId: requestedRunId, kind: 'normal', status,
      idempotencyKey: requestedRunId,
    });
    if (!delivery.duplicate && plan.complete !== false && state.transport.autoCompleteNormal) {
      setTimeout(() => { void completeDeliveredNormalRun(requestedRunId, message, plan); }, plan.startDelayMs ?? 10);
    }
    return {runId: requestedRunId, status};
  }

  function handleReq(socket, frame) {
    const ok = (payload) => socket._raw({type: 'res', id: frame.id, ok: true, payload});
    const params = frame.params || {};
    note('req', {conn: socket.id, method: frame.method});
    switch (frame.method) {
      case 'connect': return ok(hello());
      case 'chat.history':
      case 'chat.startup': return ok(historyPage(params));
      case 'sessions.list': return ok({sessions: [row()], count: 1, ts: now(), path: '', defaults: {model: state.model, contextTokens: 1000000}});
      case 'sessions.subscribe': socket.subscribedSessions = true; return ok({subscribed: true});
      case 'sessions.messages.subscribe': socket.subscribedMessages = true; return ok({subscribed: true, key: SK, agentId: AGENT});
      case 'sessions.messages.unsubscribe': socket.subscribedMessages = false; return ok({subscribed: false});
      case 'agents.list': return ok({defaultId: AGENT, mainKey: 'main', scope: 'per-sender', agents: [{id: AGENT, name: AGENT}, {id: 'main', name: 'main'}]});
      case 'agent.identity.get': return ok({agentId: AGENT, name: '碧琪', avatar: null});
      case 'models.list': return ok({models: []});
      case 'pinkie.deepThink.arm': {
        const tier = String(params.tier || 'boost');
        state.deepThinkStatus = {
          active: true, tier, mode: 'unrestricted', phase: 'planning',
          spawned: 0, pending: 0, reserved: 0, complete: false,
          required: 0, completed: 0, roles: [],
          workflow: {type: 'pending', label: '等待本轮问题', stages: [{label: '收到问题', used: false}]},
        };
        return ok({armed: true, tier, mode: 'unrestricted'});
      }
      case 'pinkie.deepThink.disarm':
        state.deepThinkStatus = {active: false};
        return ok({disarmed: true});
      case 'pinkie.deepThink.status':
        return ok(JSON.parse(JSON.stringify(state.deepThinkStatus)));
      case 'chat.abort': return ok({ok: true, aborted: false, runIds: []});
      case 'chat.send': {
        void receiveChatSend(socket, params).then(ok, (error) => {
          note('chat-send-error', {error: String(error?.message || error)});
          ok({runId: trimText(params.idempotencyKey) || `run-${now()}`, status: 'error'});
        });
        return;
      }
      default: return ok({});
    }
  }

  // --- Event helpers ---------------------------------------------------------
  const sessionMessage = (stored) => broadcast('session.message', {
    sessionKey: SK, agentId: AGENT, message: stored, messageId: stored.__openclaw.id,
    messageSeq: stored.__openclaw.seq, ...snapshot(),
  }, (socket) => socket.subscribedMessages || socket.subscribedSessions);
  const sessionsChanged = (phase, runId) => broadcast('sessions.changed', {
    sessionKey: SK, agentId: AGENT, phase, runId, ts: now(), ...snapshot(),
  }, (socket) => socket.subscribedSessions);
  const lifecycle = (runId, phase) => broadcast('agent', {
    runId, stream: 'lifecycle', ts: now(), seq: 0, sessionKey: SK, agentId: AGENT, data: {phase},
  });
  const toolEvent = (runId, callerSocket, data) => {
    const payload = {runId, stream: 'tool', ts: now(), seq: 0, sessionKey: SK, agentId: AGENT, data, ...snapshot()};
    for (const socket of state.sockets) {
      if (socket === callerSocket) socket._event('agent', payload);
      else if (socket.subscribedSessions) socket._event('session.tool', payload);
    }
    note('emit', {event: 'tool', runId, phase: data.phase});
  };
  const chatDelta = (runId, full, previous) => broadcast('chat', {
    runId, sessionKey: SK, agentId: AGENT, seq: 0, state: 'delta',
    deltaText: previous && full.startsWith(previous) ? full.slice(previous.length) : full,
    ...(previous && !full.startsWith(previous) ? {replace: true} : {}),
    message: {role: 'assistant', content: text(full), timestamp: now()},
  });
  // Terminal `final` carries the run's accumulated text (emitChatTerminal).
  const chatFinal = (runId, extra = {}) => {
    const full = state.runText.get(runId) || '';
    state.runText.delete(runId);
    broadcast('chat', {
      runId, sessionKey: SK, agentId: AGENT, seq: 0, state: 'final', ...extra,
      message: full ? {role: 'assistant', content: text(full), timestamp: now()} : undefined,
    });
  };
  const chatError = (runId, error) => {
    state.runText.delete(runId);
    broadcast('chat', {
      runId, sessionKey: SK, agentId: AGENT, seq: 0, state: 'error', errorMessage: error,
      message: {role: 'assistant', content: text(`Error: ${error}`), timestamp: now()},
    });
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const persistAndAnnounce = (message) => { const stored = persist(message); sessionMessage(stored); return stored; };
  // Append to the run buffer and stream it in chunks, like emitChatDelta.
  async function streamText(runId, addition, chunks, gap) {
    const base = state.runText.get(runId) || '';
    let previous = base;
    for (let i = 1; i <= chunks; i++) {
      const full = base + addition.slice(0, Math.ceil(addition.length * i / chunks));
      chatDelta(runId, full, previous); previous = full;
      await sleep(gap);
    }
    state.runText.set(runId, base + addition);
  }
  let toolSeq = 0;
  async function runTool(runId, caller, name, args, result, gap, {say = '', thinking = ''} = {}) {
    const id = `call_${++toolSeq}`;
    if (say) await streamText(runId, say, 2, gap / 2);
    const content = [
      ...(thinking ? [{type: 'thinking', thinking}] : []),
      ...(say ? text(say) : []),
      {type: 'toolCall', id, name, arguments: args},
    ];
    persistAndAnnounce({role: 'assistant', content, stopReason: 'toolUse'});
    toolEvent(runId, caller, {phase: 'start', name, toolCallId: id, args});
    await sleep(gap);
    // A function result can embed the call id (ask_user stores it in its card).
    const output = typeof result === 'function' ? result(id) : result;
    toolEvent(runId, caller, {phase: 'result', name, toolCallId: id, result: {content: text(output)}});
    persistAndAnnounce({role: 'toolResult', toolCallId: id, toolName: name, content: text(output)});
    await sleep(gap);
  }
  function startRun(runId, userText, {persistUser = true} = {}) {
    state.activeRuns.add(runId);
    if (persistUser) persistAndAnnounce({role: 'user', content: text(userText)});
    lifecycle(runId, 'start'); sessionsChanged('start', runId);
  }
  async function finishRun(runId, reply, gap) {
    const additions = injectedMessages(runId);
    const effectiveReply = reply && additions.length
      ? `${reply}\n\n已按追加信息调整：${additions.map((item) => item.message).join('；')}`
      : reply;
    if (effectiveReply) {
      await streamText(runId, effectiveReply, 4, gap / 2);
      persistAndAnnounce({role: 'assistant', content: text(effectiveReply), stopReason: 'stop'});
    }
    state.activeRuns.delete(runId);
    state.injectionsByRun.delete(runId);
    lifecycle(runId, 'end');
    chatFinal(runId, {stopReason: effectiveReply ? 'stop' : 'toolUse'});
    sessionsChanged('end', runId);
  }

  const probe = (name, beforeFix, detail = {}) => {
    const observation = {name, beforeFix, ...detail};
    note('queue-probe', observation);
    return observation;
  };
  const queueProbeEntry = (value, overrides = {}) => ({
    id: overrides.id || `restored-${state.seq + 1}`,
    text: value,
    createdAt: overrides.createdAt ?? now() - 60_000,
    kind: overrides.kind || 'steered',
    // These are deliberately stale values.  They are the state the resume
    // repair must normalize before it delegates to the native retry method.
    sendState: overrides.sendState || 'failed',
    sendError: overrides.sendError || 'Steer failed before it reached the run; try again.',
    sendRunId: overrides.sendRunId || 'expired-send-run',
    pendingRunId: overrides.pendingRunId || 'expired-run',
    sessionKey: SK,
    agentId: AGENT,
  });
  async function runBusyQueueProbe(o, {name, beforeFix, terminal = 'final'} = {}) {
    const gap = o.gap ?? 250;
    const runId = o.uiRunId || `ui-${now()}`;
    const caller = o.uiSocket || state.lastUiSocket;
    state.transport.autoCompleteNormal = true;
    startRun(runId, o.userText || '请执行一个需要多步的任务');
    await sleep(gap);
    await runTool(runId, caller, 'exec', {command: 'slow-step'}, 'step complete', gap,
      {say: '我先处理第一步。'});
    note('queue-probe-ready', {name, runId, active: true});
    await sleep(o.holdMs ?? Math.max(700, gap * 4));
    if (terminal === 'missing') {
      // Deliberately no lifecycle/end, chat/final or sessions.changed.  The
      // next sessions.list is authoritative and says idle, reproducing the
      // exact forceIdleComposerState recovery path.
      state.activeRuns.delete(runId);
      state.runText.delete(runId);
      note('terminal-dropped', {runId, scenario: name});
    } else if (state.activeRuns.has(runId)) {
      await finishRun(runId, o.reply || '第一轮完成。【初始轮结束】', gap);
    }
    return probe(name, beforeFix, {runId, terminal, activeAfter: state.activeRuns.has(runId)});
  }

  const scenarios = {
    /* Pinkie stops to ask a multiple-choice question (ask_user), exactly as the
       plugin tool returns it: the result starts with the card marker + JSON. */
    async ask(o = {}) {
      const gap = o.gap ?? 250;
      const runId = o.uiRunId || `ui-${now()}`;
      const caller = o.uiSocket || state.lastUiSocket;
      startRun(runId, o.userText || '帮我把登录页改好看一点');
      await sleep(gap);
      const card = {
        question: o.question || '登录页想往哪个方向改？',
        header: o.header ?? '风格',
        multiSelect: o.multiSelect === true,
        options: o.options || [
          {label: '柔和粉（推荐）', description: '沿用碧琪的粉色和圆角，改动最小'},
          {label: '简洁白', description: '大面积留白和细线条，更克制'},
          {label: '活泼派对', description: '加彩纸和气球动效，最热闹'},
        ],
      };
      await runTool(runId, caller, 'ask_user', card,
        (id) => `[[PINKIE_ASK_V1]]${JSON.stringify({id, ...card})}\n已把问题展示给先生，正在等先生选择。`,
        gap, {say: o.say ?? '这个得你来拍板。'});
      await finishRun(runId, o.reply || '选好我就接着改～', gap);
      note('scenario-done', {name: 'ask'});
    },
    /* The target behaviour: a short sentence before each tool call. As in
       real transcripts, that sentence is persisted in the same assistant
       message as the toolCall, and the live `final` carries all of them. */
    async narrated(o = {}) {
      const gap = o.gap ?? 250;
      const runId = o.uiRunId || `ui-${now()}`;
      const caller = o.uiSocket || state.lastUiSocket;
      startRun(runId, o.userText || '帮我跑一下基线测试');
      await sleep(gap);
      const steps = o.steps || [
        ['我先看一下测试入口有哪些。', 'exec', {command: 'ls tests'}, 'a.test.cjs\nb.test.cjs'],
        ['接着跑一遍完整测试，记录输出。', 'exec', {command: 'node --test tests'}, 'pass 42\nfail 0'],
        ['再读一下架构文档，确认有没有冲突规则。', 'read', {path: 'docs/ARCHITECTURE.md'}, '# 架构'],
      ];
      for (const [say, name, args, result] of steps) {
        await runTool(runId, caller, name, args, result, gap, {say, thinking: o.thinking ? '规划下一步' : ''});
      }
      await finishRun(runId, o.reply || '基线测试全部通过，没有发现冲突规则。【最终回复】', gap);
      note('scenario-done', {name: 'narrated'});
    },

    /* One visible run: several consecutive tool calls, then the reply. */
    async multiTool(o = {}) {
      const gap = o.gap ?? 250;
      const runId = o.uiRunId || `ui-${now()}`;
      const caller = o.uiSocket || state.lastUiSocket;
      startRun(runId, o.userText || '帮我连续检查几个文件');
      await sleep(gap);
      for (let i = 1; i <= (o.tools ?? 4); i++) {
        await runTool(runId, caller, 'exec', {command: `cat f${i}.txt`}, `content ${i}`, gap);
      }
      if (o.parallel) {
        // One assistant message carrying two tool calls (parallel tool use).
        const a = `call_${++toolSeq}`, b = `call_${++toolSeq}`;
        persistAndAnnounce({role: 'assistant', stopReason: 'toolUse', content: [
          {type: 'toolCall', id: a, name: 'read', arguments: {path: 'x'}},
          {type: 'toolCall', id: b, name: 'read', arguments: {path: 'y'}}]});
        toolEvent(runId, caller, {phase: 'start', name: 'read', toolCallId: a, args: {path: 'x'}});
        toolEvent(runId, caller, {phase: 'start', name: 'read', toolCallId: b, args: {path: 'y'}});
        await sleep(gap);
        for (const id of [a, b]) {
          toolEvent(runId, caller, {phase: 'result', name: 'read', toolCallId: id, result: {content: text('ok')}});
          persistAndAnnounce({role: 'toolResult', toolCallId: id, toolName: 'read', content: text('ok')});
        }
        await sleep(gap);
      }
      await finishRun(runId, o.reply || '全部检查完毕，文件都正常。【最终回复】', gap);
      note('scenario-done', {name: 'multiTool'});
    },

    /* User turn -> tools -> run ends without a reply (incomplete tool turn)
       -> gateway watchdog chat.send from another connection (the CLI), with
       an invisible U+2063 user message -> tools -> final reply. */
    async watchdog(o = {}) {
      const gap = o.gap ?? 250;
      const r1 = o.uiRunId || `ui-${now()}`;
      const caller = o.uiSocket || state.lastUiSocket;
      startRun(r1, o.userText || '帮我检查一下这个文件');
      await sleep(gap);
      if (o.preText !== false) await streamText(r1, '好的，我先看看。', 2, gap / 2);
      await runTool(r1, caller, 'exec', {command: 'ls'}, 'a.txt\nb.txt', gap);
      await runTool(r1, caller, 'read', {path: 'a.txt'}, 'hello', gap);
      state.activeRuns.delete(r1);
      if (o.r1Terminal === 'error') {
        // Lifecycle errors are held for the 15s retry grace before `chat` error.
        lifecycle(r1, 'error');
        setTimeout(() => { chatError(r1, o.r1Error || 'upstream stream ended'); sessionsChanged('error', r1); }, o.graceMs ?? 15000);
      } else if (o.r1Terminal !== 'none') {
        lifecycle(r1, 'end');
        chatFinal(r1, {stopReason: 'toolUse'});
        sessionsChanged('end', r1);
      }
      let previous = r1;
      const rounds = o.rounds ?? 1;
      for (let i = 1; i <= rounds; i++) {
        await sleep(o.watchdogDelay ?? 600);
        const w = `pinkie-watchdog-${previous}-${i}`;
        state.activeRuns.add(w);
        persistAndAnnounce({role: 'user', content: text('⁣')});
        lifecycle(w, 'start'); sessionsChanged('start', w);
        await sleep(gap);
        await runTool(w, null, 'exec', {command: `check ${i}`}, `ok ${i}`, gap);
        if (i < rounds) { await finishRun(w, '', gap); previous = w; continue; }
        await finishRun(w, o.reply || '检查完成：a.txt 内容是 hello，一切正常。【最终回复】', gap);
      }
      note('scenario-done', {name: 'watchdog'});
    },

    // a. Baseline: an ordinary busy queue waits for the terminal event.  The
    // native renderer should release it once the first run has ended.
    async 'queue-normal'(o = {}) {
      return runBusyQueueProbe(o, {
        name: 'queue-normal', terminal: 'final',
        beforeFix: '基线正常：收到 final 后原生会尝试发出第一张普通排队卡。',
      });
    },
    async 'busy-queue-normal'(o = {}) { return scenarios['queue-normal'](o); },

    // b. The regression: no terminal event arrives, while sessions.list says
    // idle.  Before the repair forceIdle only cleared busy fields, leaving the
    // queue card above the composer forever.
    async 'queue-missing-terminal'(o = {}) {
      return runBusyQueueProbe(o, {
        name: 'queue-missing-terminal', terminal: 'missing',
        beforeFix: '修复前：forceIdle 只回到空闲，排队卡一直挂在输入框上方，网关未收到消息。',
      });
    },
    async 'busy-queue-missing-terminal'(o = {}) { return scenarios['queue-missing-terminal'](o); },

    // c. An active server run accepts the steer.  It persists the added user
    // turn immediately, but answers with accepted (not ok), matching the
    // statuses that old Control UI kept as a pending steered card.
    async 'steer-accepted'(o = {}) {
      state.transport.steerPlans.push({status: o.steerStatus || 'accepted'});
      return runBusyQueueProbe(o, {
        name: 'steer-accepted', terminal: 'final',
        beforeFix: '修复前：accepted/in_flight 的已追加卡会等旧 run 的终端事件；事件丢失时不会自行消失。',
      });
    },

    // d. The steer API was reached while a run was live, but the run finishes
    // before its acknowledgement.  The fake returns timeout and deliberately
    // does not persist the added message, so the client must fall back to its
    // ordinary queue/retry path without losing the draft.
    async 'steer-race-ended'(o = {}) {
      state.transport.steerPlans.push({
        status: 'timeout', endBeforeReply: true,
        endDelayMs: o.endDelayMs ?? 2,
        responseDelayMs: o.raceResponseDelay ?? 8,
      });
      return runBusyQueueProbe(o, {
        name: 'steer-race-ended', terminal: 'final',
        beforeFix: '修复前：引导与结束撞车后卡片会保留，除非用户手动 Retry；原文可能一直不发。',
      });
    },

    // e. Browser refresh retains queue persistence.  Seed the *native*
    // composer storage with a stale steered entry; reload the page after this
    // scenario.  No UI state is changed here, which lets the real hydration
    // and resume script prove their recovery behaviour.
    async 'queue-refresh'(o = {}) {
      state.activeRuns.clear();
      state.transport.autoCompleteNormal = true;
      const entry = queueProbeEntry(o.message || '刷新后也要送达的追加消息', o.entry || {});
      const seeded = seedComposerQueue([entry], o);
      state.refreshSnapshot = {entry: clone(entry), seeded, preparedAt: now()};
      return probe('queue-refresh',
        '修复前：刷新恢复的 failed / steered 队列不会被 forceIdle 或空闲轮询接手，卡片永久残留。',
        {entry, seeded});
    },

    // f. A watchdog creates a new run after the visible run has ended.  The
    // old pane can still be tracking r1; steer must bind to the watchdog run
    // and be rendered as a real user turn, not as the invisible U+2063 turn.
    async 'watchdog-append'(o = {}) {
      const gap = o.gap ?? 250;
      const r1 = o.uiRunId || `ui-${now()}`;
      const caller = o.uiSocket || state.lastUiSocket;
      state.transport.autoCompleteNormal = true;
      startRun(r1, o.userText || '请完成一项较长任务');
      await sleep(gap);
      await runTool(r1, caller, 'exec', {command: 'first-pass'}, 'partial', gap, {say: '我先做第一步。'});
      state.activeRuns.delete(r1);
      lifecycle(r1, 'end'); chatFinal(r1, {stopReason: 'toolUse'}); sessionsChanged('end', r1);
      await sleep(o.watchdogDelay ?? Math.max(25, gap));
      const watchdogRunId = `pinkie-watchdog-${r1}-1`;
      state.activeRuns.add(watchdogRunId);
      persistAndAnnounce({role: 'user', content: text('⁣')});
      lifecycle(watchdogRunId, 'start'); sessionsChanged('start', watchdogRunId);
      state.transport.steerPlans.push({status: o.steerStatus || 'accepted'});
      await runTool(watchdogRunId, null, 'exec', {command: 'watchdog-resume'}, 'resumed', gap,
        {say: '我继续处理刚才没完成的步骤。'});
      note('queue-probe-ready', {name: 'watchdog-append', runId: watchdogRunId, replacesRunId: r1});
      await sleep(o.holdMs ?? Math.max(700, gap * 4));
      if (state.activeRuns.has(watchdogRunId)) {
        await finishRun(watchdogRunId, o.reply || '续跑完成。【看门狗最终回复】', gap);
      }
      return probe('watchdog-append',
        '修复前：界面仍盯着旧 runId，追加/已引导卡的时机错乱，消息可能被看门狗续跑吞掉。',
        {runId: watchdogRunId, replacesRunId: r1});
    },
  };

  // --- Page-side checks (browser only) ---------------------------------------
  const pane = () => document.querySelector('openclaw-chat-pane');
  const checks = {
    /** Records chat pane render errors; `rebuilt:` entries are self-healed ones. */
    captureRenderErrors() {
      const current = pane();
      if (!current) return [];
      if (current.__harnessErrors) return current.__harnessErrors;
      const errors = [];
      const update = current.update;
      current.update = function (...a) {
        try { return update.apply(this, a); } catch (error) { errors.push(String(error?.message || error)); throw error; }
      };
      window.addEventListener('pinkie:chat-pane-rebuilt', (event) => errors.push(`rebuilt: ${event.detail?.error}`));
      current.__harnessErrors = errors;
      return errors;
    },
    /** Lit text bindings whose marker or text node was removed by a script. */
    brokenLitParts() {
      const broken = [];
      const pending = [pane()?.renderRoot?._$litPart$];
      while (pending.length) {
        const part = pending.pop();
        if (!part || part._$AA === undefined) continue;
        const value = part._$AH;
        if (!part._$AA.isConnected || (value != null && typeof value !== 'object' && typeof value !== 'function'
            && typeof value !== 'symbol' && part._$AA.nextSibling?.nodeType !== 3)) broken.push(String(value).slice(0, 40));
        if (Array.isArray(value)) pending.push(...value);
        else if (Array.isArray(value?._$AV)) pending.push(...value._$AV);
      }
      return broken;
    },
    /** Types into the real composer and presses Enter (use with __fake.auto).
        Pass {altKey:true} for the explicit "send after this run" path. */
    send(message, options = {}) {
      const input = document.querySelector('.agent-chat__composer-combobox textarea');
      if (!input) throw new Error('composer not found');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, message);
      // Match a real event leaving the composer's shadow root.  The queue
      // steering layer deliberately observes document-capture events so it
      // can leave the native submit handler untouched; a non-composed test
      // event would never reach that listener.
      input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      setTimeout(() => {
        if (options.click === true) {
          const button = document.querySelector('.chat-send-btn:not(.chat-send-btn--stop):not(.chat-send-btn--voice)');
          if (!button) throw new Error('send button not found');
          button.dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true}));
          return;
        }
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', bubbles: true, composed: true,
          altKey: options.altKey === true,
          ctrlKey: options.ctrlKey === true,
          metaKey: options.metaKey === true,
          shiftKey: options.shiftKey === true,
        }));
      }, options.delayMs ?? 150);
    },
    /** Visible native queue cards, including action labels. */
    queue() {
      return [...document.querySelectorAll('.chat-queue__item')].map((item) => ({
        classes: item.className,
        text: item.querySelector('.chat-queue__text')?.textContent?.trim() || '',
        badges: [...item.querySelectorAll('.chat-queue__badge')].map((badge) => badge.textContent?.trim() || ''),
        error: item.querySelector('.chat-queue__error')?.textContent?.trim() || null,
        actions: [...item.querySelectorAll('button')].map((button) => button.textContent?.replace(/\s+/g, ' ').trim() || button.getAttribute('aria-label')),
      }));
    },
    /** Server-side receipt log. Each idempotency key appears at most once. */
    deliveries(message) {
      const needle = message == null ? null : String(message);
      return state.deliveries.filter((delivery) => needle == null || delivery.message === needle).map(clone);
    },
    wait(ms = 0) { return sleep(ms); },
    /** Is the bubble containing `marker` in the DOM and scrolled into view?
        Layout fields are meaningless while the window is hidden (0×0). */
    threadStatus(marker) {
      const thread = document.querySelector('.chat-thread');
      const bubble = [...document.querySelectorAll('.chat-bubble')]
        .find((item) => (item.getAttribute('data-message-text') || item.textContent || '').includes(marker));
      const box = thread?.getBoundingClientRect();
      const end = bubble?.getBoundingClientRect();
      return {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        inDom: Boolean(bubble),
        distanceFromBottom: thread ? Math.round(thread.scrollHeight - thread.scrollTop - thread.clientHeight) : null,
        endVisible: end && box ? end.bottom <= box.bottom + 4 && end.bottom >= box.top : null,
      };
    },
    /** One line per rendered group: role classes, avatar kind, first text. */
    groups() {
      return [...document.querySelectorAll('.chat-thread .chat-group')].map((group) => ({
        classes: group.className,
        avatar: group.querySelector('.chat-avatar')?.className || null,
        activity: group.querySelector('.chat-activity-group__label')?.textContent.replace(/\s+/g, ' ').trim() || null,
        text: (group.querySelector('.chat-bubble')?.getAttribute('data-message-text') || '').slice(0, 60),
      }));
    },
  };

  window.__fake = {
    SK, state, log, scenarios, checks,
    /** Run `name` automatically whenever the UI sends a message; null stops. */
    auto(name, opts = {}) { state.autoScenario = name ? {name, opts, once: opts.once === true} : null; },
    scenario(name, opts = {}) { return scenarios[name](opts); },
    /** Queue raw fake-server acknowledgements for the next sends. */
    setTransport(options = {}) {
      if (Array.isArray(options.steerPlans)) state.transport.steerPlans.push(...clone(options.steerPlans));
      if (Array.isArray(options.normalPlans)) state.transport.normalPlans.push(...clone(options.normalPlans));
      if (typeof options.autoCompleteNormal === 'boolean') state.transport.autoCompleteNormal = options.autoCompleteNormal;
      if (typeof options.normalReply === 'string') state.transport.normalReply = options.normalReply;
      return clone(state.transport);
    },
    /** Seed the native composer persistence, then call location.reload(). */
    seedComposerQueue(entries, options = {}) { return seedComposerQueue(entries, options); },
    clearComposerQueue({gatewayUrl} = {}) {
      const storage = composerStorage();
      const keys = composerStorageKeys(gatewayUrl);
      for (const key of keys) {
        try {
          const raw = storage?.getItem(key);
          const saved = raw ? JSON.parse(raw) : null;
          if (!saved?.sessions) continue;
          delete saved.sessions[composerSessionKey];
          if (Object.keys(saved.sessions).length) storage.setItem(key, JSON.stringify(saved));
          else storage.removeItem(key);
        } catch {}
      }
      state.refreshSnapshot = null;
      return {keys};
    },
    setModel(model) { state.model = model; sessionsChanged('model', null); },
    setTierStatus(status) { state.deepThinkStatus = JSON.parse(JSON.stringify(status || {active: false})); },
    tail(n = 40) { return log.slice(-n); },
  };
})();
