/* Fake CLE Kk / OpenClaw gateway for the chat UI harness (see README.md).
   Loaded before every app script: replaces window.WebSocket, so the native
   chat client and the laolao sidebar socket both talk to this in-page gateway.
   Event shapes follow OpenClaw 2026.7.1-2 server-chat / server-session-events:
   - `chat` deltas/final are broadcast; a run's text accumulates across its tool
     calls (previousText + delta) and `final` carries the whole run's text;
   - tool events reach the chat.send caller as `agent`, other session
     subscribers as `session.tool`;
   - every persisted transcript message is announced as `session.message`.
   Drive it from the page console: await __fake.scenario('narrated', {...}). */
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
  };

  const now = () => Date.now();
  const text = (t) => [{type: 'text', text: t}];
  const persist = (message) => {
    state.seq += 1;
    const stored = {...message, timestamp: message.timestamp ?? now(),
      __openclaw: {id: `m${state.seq}`, seq: state.seq}};
    state.history.push(stored);
    return stored;
  };

  // Seed: an earlier completed exchange so the window is not empty.
  persist({role: 'user', content: text('你好，碧琪')});
  persist({role: 'assistant', content: text('你好呀！有什么要我帮忙的？'), stopReason: 'stop'});

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
        const runId = params.idempotencyKey || `run-${now()}`;
        state.lastUiSocket = socket;
        ok({runId, status: 'started'});
        if (state.autoScenario) {
          const {name, opts} = state.autoScenario;
          setTimeout(() => scenarios[name]({...opts, uiRunId: runId, uiSocket: socket,
            userText: String(params.message || '')}), 30);
        }
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
    toolEvent(runId, caller, {phase: 'result', name, toolCallId: id, result: {content: text(result)}});
    persistAndAnnounce({role: 'toolResult', toolCallId: id, toolName: name, content: text(result)});
    await sleep(gap);
  }
  function startRun(runId, userText) {
    state.activeRuns.add(runId);
    persistAndAnnounce({role: 'user', content: text(userText)});
    lifecycle(runId, 'start'); sessionsChanged('start', runId);
  }
  async function finishRun(runId, reply, gap) {
    if (reply) {
      await streamText(runId, reply, 4, gap / 2);
      persistAndAnnounce({role: 'assistant', content: text(reply), stopReason: 'stop'});
    }
    state.activeRuns.delete(runId);
    lifecycle(runId, 'end');
    chatFinal(runId, {stopReason: reply ? 'stop' : 'toolUse'});
    sessionsChanged('end', runId);
  }

  const scenarios = {
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
    /** Types into the real composer and presses Enter (use with __fake.auto). */
    send(message) {
      const input = document.querySelector('.agent-chat__composer-combobox textarea');
      if (!input) throw new Error('composer not found');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, message);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      setTimeout(() => input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true})), 150);
    },
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
    auto(name, opts = {}) { state.autoScenario = name ? {name, opts} : null; },
    scenario(name, opts = {}) { return scenarios[name](opts); },
    setModel(model) { state.model = model; sessionsChanged('model', null); },
    setTierStatus(status) { state.deepThinkStatus = JSON.parse(JSON.stringify(status || {active: false})); },
    tail(n = 40) { return log.slice(-n); },
  };
})();
