// CleKkAuditLog hash-chain logger and CleKkSupervisor turn-decision engine.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isRolesContext} from './metre-roles.mjs';
import {unverifiedNote} from './run-contract.mjs';
import {renderFirstPerson} from './first-person.mjs';
import {ACTION_CONTINUATION, AUDIT_CORRUPTION_FAILURE, COMPLETION_CLAIM, DELIVERY_CLAIM, DELIVERY_GUARD_TOOL, IN_PROGRESS_CLAIM, failedAssistantMessage, isInternalExecutionSession, isMutationRequest, pinkieStateRoot, workFirstPrompt} from './mode-constants.mjs';
import {compactToolEvidence, completionRunKey, isHonestIncomplete, isLikelyActionRequest, proseOnly, resultText, toolResultFailed, waitingForGeneratedMedia, workFirstBackgroundResult, workFirstContext, workFirstReplyText} from './evidence-rules.mjs';
import {CompletionIntegrityGuard, assistantMessageHasToolCall, auditRecordDigest, hashForAudit, housekeepingTurn, internalControlText, isTerminalAssistantMessage, payloadText, runtimeTurnText, visibleAssistantText} from './completion-integrity.mjs';
import {agentFromSessionKey, assistantTextFromMessages, modeForContext, section} from './deliberation-audit.mjs';

export class CleKkAuditLog {
  constructor(root = path.join(pinkieStateRoot(), 'cle-kk', 'audit')) {
    this.root = root;
    this.sequence = new Map();
    this.lastHash = new Map();
    // A full JSONL verification for every append makes a long session
    // quadratic (and, under two gateway writers, can hold the sidecar lock
    // long enough for the other writer to time out).  The append protocol is
    // already serialized by withFileLock; verify the complete chain when a
    // file is first seen and periodically thereafter, while each append still
    // reloads the authoritative tail under the lock.
    this.appendCounts = new Map();
    this.fullVerifyEvery = 128;
  }

  fileFor(sessionKey) {
    if (!this.root || !sessionKey) return '';
    return path.join(this.root, `${hashForAudit(sessionKey).slice(0, 32)}.jsonl`);
  }

  stateFileFor(sessionKey) {
    if (!this.root || !sessionKey) return '';
    return path.join(this.root, `${hashForAudit(sessionKey).slice(0, 32)}.state.json`);
  }

  /**
   * Audit records can be emitted by more than one gateway/plugin instance
   * during an App update or a gateway handoff.  A per-session lock keeps two
   * instances from reading the same tail and both appending the same seq.
   * The lock is deliberately a tiny, recoverable sidecar rather than a
   * process-local mutex; the latter cannot protect the external extension
   * copy loaded by an older gateway.
   */
  withFileLock(file, action) {
    if (!file || typeof action !== 'function') return null;
    const lockFile = `${file}.lock`;
    let descriptor = null;
    const startedAt = Date.now();
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
      while (descriptor === null) {
        try {
          descriptor = fs.openSync(lockFile, 'wx', 0o600);
          fs.writeSync(descriptor, `${process.pid}\n`);
        } catch (error) {
          // `open(..., 'wx')` is the mutex, but Windows does not report a lost
          // race as EEXIST.  While the winner is creating the sidecar -- or
          // unlinking it, which happens right after every append -- a second
          // writer is refused with EPERM/EACCES/EBUSY ("operation not
          // permitted") because the file has a pending delete.  That window is
          // hit constantly under contention, so treating it as fatal is how a
          // concurrent writer silently loses an audit record.  It is ordinary
          // contention, and it stays bounded by the same deadline.
          const contention = error?.code === 'EEXIST'
            || error?.code === 'EPERM'
            || error?.code === 'EACCES'
            || error?.code === 'EBUSY';
          if (!contention || Date.now() - startedAt > 5_000) return null;
          // An interrupted gateway can leave the sidecar behind. Appends are
          // short, so a lock older than this is safe to recover.
          try {
            const stat = fs.statSync(lockFile);
            if (Date.now() - stat.mtimeMs > 15_000) {
              let ownerAlive = false;
              try {
                const owner = Number(fs.readFileSync(lockFile, 'utf8').trim().split(/\s+/)[0]);
                if (Number.isInteger(owner) && owner > 0) {
                  process.kill(owner, 0);
                  ownerAlive = true;
                }
              } catch (error) {
                // ESRCH means the writer died; malformed/permission errors
                // are treated as stale only after the same grace period.
                ownerAlive = error?.code !== 'ESRCH' && error?.code !== 'ENOENT';
              }
              if (!ownerAlive) fs.unlinkSync(lockFile);
            }
          } catch {}
          // Synchronous append is intentional here: it keeps the critical
          // section indivisible even when two plugin instances share a file.
          const wait = new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(wait, 0, 0, 20);
        }
      }
      return action();
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch {}
        try { fs.unlinkSync(lockFile); } catch {}
      }
    }
  }

  loadTail(file) {
    if (!file || !fs.existsSync(file)) return {ok: true, sequence: 0, hash: 'GENESIS'};
    let descriptor = null;
    try {
      descriptor = fs.openSync(file, 'r');
      const size = fs.fstatSync(descriptor).size;
      if (size === 0) return {ok: true, sequence: 0, hash: 'GENESIS'};
      const chunks = [];
      let position = size;
      let total = 0;
      let candidate = null;
      // Read backwards until the complete final non-empty JSONL record is in
      // memory.  Normal records need one 64 KiB read; exceptionally large
      // evidence records remain supported without loading the whole journal.
      while (position > 0 && candidate === null) {
        const length = Math.min(64 * 1024, position);
        position -= length;
        const chunk = Buffer.alloc(length);
        const bytesRead = fs.readSync(descriptor, chunk, 0, length, position);
        if (bytesRead <= 0) return {ok: false, sequence: 0, hash: 'GENESIS'};
        const actual = bytesRead === length ? chunk : chunk.subarray(0, bytesRead);
        chunks.unshift(actual);
        total += bytesRead;
        const bytes = Buffer.concat(chunks, total);
        let end = bytes.length;
        while (end > 0 && (bytes[end - 1] === 0x09 || bytes[end - 1] === 0x0a
          || bytes[end - 1] === 0x0d || bytes[end - 1] === 0x20)) end -= 1;
        if (end === 0) {
          if (position === 0) return {ok: true, sequence: 0, hash: 'GENESIS'};
          continue;
        }
        const boundary = bytes.lastIndexOf(0x0a, end - 1);
        if (boundary >= 0 || position === 0) {
          const start = boundary >= 0 ? boundary + 1 : 0;
          candidate = bytes.subarray(start, end).toString('utf8');
        }
      }
      const last = candidate ? JSON.parse(candidate) : null;
      if (!last || !Number.isInteger(last.seq) || last.seq < 1
          || typeof last.hash !== 'string' || !last.hash) {
        return {ok: false, sequence: 0, hash: 'GENESIS'};
      }
      return {
        ok: true,
        sequence: Number(last?.seq) || 0,
        hash: typeof last?.hash === 'string' ? last.hash : 'GENESIS',
      };
    } catch {
      return {ok: false, sequence: 0, hash: 'GENESIS'};
    } finally {
      if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
    }
  }

  append(type, sessionKey, details = {}) {
    const file = this.fileFor(sessionKey);
    if (!file) return null;
    try {
      return this.withFileLock(file, () => {
        // The tail is always reread under the lock because another gateway
        // instance may have appended since this object was created.  A full
        // scan is intentionally periodic rather than per record: scanning a
        // growing journal on every append is O(n²) and was enough to make
        // concurrent writers lose records at the five-second lock timeout.
        const count = Number(this.appendCounts.get(file) || 0);
        const chain = count === 0 || count % this.fullVerifyEvery === 0
          ? this.verifyFile(file)
          : {ok: true};
        if (!chain.ok) return null;
        const tail = this.loadTail(file);
        if (!tail.ok) return null;
        const record = {
          v: 1,
          seq: tail.sequence + 1,
          at: Date.now(),
          type: String(type || 'event'),
          session: hashForAudit(sessionKey),
          ...details,
          prev: tail.hash,
        };
        record.hash = auditRecordDigest(record);
        fs.appendFileSync(file, `${JSON.stringify(record)}\n`, {encoding: 'utf8', mode: 0o600});
        fs.chmodSync(file, 0o600);
        this.sequence.set(file, record.seq);
        this.lastHash.set(file, record.hash);
        this.appendCounts.set(file, count + 1);
        return record;
      });
    } catch {
      return null;
    }
  }

  /** Preserve a broken chain and start a clean chain for a genuinely new
   * user turn.  We never delete the old evidence; it remains available for
   * forensic inspection while stale retries are allowed to stop looping.
   */
  quarantine(sessionKey, reason = 'corrupt') {
    const file = this.fileFor(sessionKey);
    if (!file || !fs.existsSync(file)) return false;
    try {
      return Boolean(this.withFileLock(file, () => {
        if (!fs.existsSync(file)) return false;
        const suffix = `${String(reason).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32)}-${Date.now()}-${process.pid}`;
        fs.renameSync(file, `${file}.${suffix}.jsonl`);
        this.sequence.delete(file);
        this.lastHash.delete(file);
        this.appendCounts.delete(file);
        return true;
      }));
    } catch {
      return false;
    }
  }

  readState(sessionKey) {
    const file = this.stateFileFor(sessionKey);
    if (!file || !fs.existsSync(file)) return null;
    const chain = this.verify(sessionKey);
    if (chain.busy) return null;
    if (!chain.ok) return {active: true, corrupted: true, reason: chain.reason};
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!value || value.v !== 1 || value.sessionKey !== String(sessionKey)) return null;
      const expected = String(value.digest || '');
      const unsigned = {...value};
      delete unsigned.digest;
      if (!expected || expected !== hashForAudit(JSON.stringify(unsigned))) {
        return {active: true, corrupted: true, reason: 'CLE Kk 状态摘要不一致'};
      }
      return value;
    } catch {
      return {active: true, corrupted: true, reason: 'CLE Kk 状态文件不可读'};
    }
  }

  writeState(sessionKey, state = {}) {
    const file = this.stateFileFor(sessionKey);
    if (!file) return false;
    const value = {
      v: 1,
      sessionKey: String(sessionKey),
      ...state,
      updatedAt: Date.now(),
    };
    value.digest = hashForAudit(JSON.stringify(value));
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
      fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, {encoding: 'utf8', mode: 0o600});
      fs.renameSync(temp, file);
      fs.chmodSync(file, 0o600);
      return true;
    } catch {
      try { fs.unlinkSync(temp); } catch {}
      return false;
    }
  }

  removeState(sessionKey) {
    const file = this.stateFileFor(sessionKey);
    if (!file) return;
    try { fs.unlinkSync(file); } catch {}
  }

  listStates() {
    if (!this.root || !fs.existsSync(this.root)) return [];
    let names = [];
    try { names = fs.readdirSync(this.root).filter(name => name.endsWith('.state.json')); } catch { return []; }
    const states = [];
    for (const name of names) {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(this.root, name), 'utf8'));
        if (value?.v === 1 && value.sessionKey && value.active) states.push(value);
      } catch {}
    }
    return states;
  }

  readRecords(sessionKey) {
    const file = this.fileFor(sessionKey);
    if (!file || !fs.existsSync(file)) return [];
    if (!this.verify(sessionKey).ok) return [];
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch { return []; }
  }

  verify(sessionKey) {
    const file = this.fileFor(sessionKey);
    if (!file || !fs.existsSync(file)) return {ok: true, records: 0};
    // Readers must use the same sidecar as writers.  Without this, a
    // readState()/recordFinalize() call can parse the half-written last line
    // of another gateway process and permanently classify a healthy turn as
    // corrupt.  append() calls verifyFile directly while already holding the
    // lock, so there is no recursive lock acquisition here.
    const checked = this.withFileLock(file, () => this.verifyFile(file));
    // Never fall back to an unlocked read: appendFileSync is atomic for our
    // writer, but a crashed/foreign writer can still expose a partial final
    // line.  Busy is retryable infrastructure state, not evidence corruption.
    return checked || {
      ok: false,
      busy: true,
      retryable: true,
      records: 0,
      reason: 'CLE Kk 审计日志正被写入，请稍后重试',
    };
  }

  verifyFile(file) {
    if (!file || !fs.existsSync(file)) return {ok: true, records: 0};
    let previous = 'GENESIS';
    let sequence = 0;
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.seq !== sequence + 1 || record.prev !== previous || record.hash !== auditRecordDigest(record)) {
          return {ok: false, records: sequence, reason: 'CLE Kk 审计链断裂'};
        }
        sequence = record.seq;
        previous = record.hash;
      }
      return {ok: true, records: sequence};
    } catch (error) {
      return {ok: false, records: sequence, reason: `CLE Kk 审计日志不可读：${error.message}`};
    }
  }
}

/**
 * CLE Kk supervisor：把模型当作“执行提议者”，而不是完成裁判。
 * 真实性门禁的结果先进入这里，再交给 OpenClaw 的重试/投递路径；即使
 * OpenClaw 因为已有副作用忽略 before_agent_finalize 的 revise，后面的
 * reply_payload_sending 仍会拦住未经验证的最终气泡。
 */
export class CleKkSupervisor {
  constructor({integrity = new CompletionIntegrityGuard(), audit = new CleKkAuditLog(), logger = null, platform = process.platform} = {}) {
    this.integrity = integrity;
    this.audit = audit;
    this.logger = logger;
    this.windows = platform === 'win32';
    this.turns = new Map();
    this.orphaned = new Map();
    // 运行时自己开的整理轮（压缩前写记忆、心跳）插进一件还没交付完的活时：run id -> 会话。
    this.housekeepingRuns = new Map();
    // OpenClaw's tool hooks may omit ctx.sessionKey even though the matching
    // agent/model hooks include it. Bind the provider run id to its owning
    // parent session so real tool evidence is never stranded under a run-id
    // pseudo key and then mistaken for "no work was performed".
    this.sessionByRunId = new Map();
    // Plugin tool factories receive an ephemeral conversation UUID in some
    // OpenClaw transports, while lifecycle hooks use the durable
    // `agent:<id>:...` session key. Keep a host-derived bridge between the two
    // identities so a tool can verify evidence from its own turn without ever
    // accepting a model-supplied session id.
    this.sessionBySessionId = new Map();
    // Some embedded tool factories receive no conversation identity at all.
    // The host-generated call id is still present in before_tool_call and in
    // execute(), so use it as the authoritative per-invocation bridge.
    this.sessionByToolCallId = new Map();
    this.pendingDeliverySessions = new Map();
    this.retryScheduler = null;
    this.retryCanceller = null;
    this.retryLimitResolver = null;
    this.deliveryFallbackBySession = new Map();
  }

  setRetryScheduler(fn) {
    this.retryScheduler = typeof fn === 'function' ? fn : null;
  }

  setRetryCanceller(fn) {
    this.retryCanceller = typeof fn === 'function' ? fn : null;
  }

  setRetryLimitResolver(fn) {
    this.retryLimitResolver = typeof fn === 'function' ? fn : null;
  }

  retryLimit(key, decision) {
    const configured = Number(this.retryLimitResolver?.(key, decision));
    return Number.isFinite(configured) && configured > 0
      ? configured : Math.max(1, Number(decision?.retry?.maxAttempts) || 24);
  }

  retireRetry(key) {
    if (!key || !this.retryCanceller) return;
    try {
      Promise.resolve(this.retryCanceller(key)).catch(error => {
        this.logger?.warn?.(`CLE Kk retry retirement failed session=${key}: ${String(error)}`);
      });
    } catch (error) {
      this.logger?.warn?.(`CLE Kk retry retirement failed session=${key}: ${String(error)}`);
    }
  }

  cancel(sessionKey, reason = 'manual_cancel') {
    const key = String(sessionKey || '');
    if (!key) return false;
    const turn = this.turns.get(key) || this.restore(key);
    if (turn?.runId) {
      this.orphaned.set(String(turn.runId), key);
      while (this.orphaned.size > 2048) this.orphaned.delete(this.orphaned.keys().next().value);
    }
    this.turns.delete(key);
    this.integrity.reset(key);
    this.audit.append('turn_cancelled', key, {reason: String(reason || 'manual_cancel').slice(0, 120)});
    this.audit.removeState(key);
    return Boolean(turn);
  }

  retryRecoveryDisposition(sessionKey) {
    const turn = this.turns.get(String(sessionKey || ''));
    if (!turn?.pending) return '';
    return turn.retryExhausted ? 'retire' : 'owned';
  }

  key(event = {}, ctx = {}) {
    const explicit = String(ctx.sessionKey || event.sessionKey || '');
    const runIds = [...new Set([ctx.runId, event.runId].filter(Boolean).map(String))];
    const sessionIds = [...new Set([ctx.sessionId, event.sessionId].filter(Boolean).map(String))];
    // A rejected turn can still finish after the user has started a new turn.
    // Fence those late hooks so they cannot attach old evidence to the new
    // window and keep the new message blocked.
    if (runIds.some(runId => this.orphaned.has(runId))) return '';
    const mapped = sessionIds.map(sessionId => this.sessionBySessionId.get(sessionId)).find(Boolean)
      || (explicit ? this.sessionBySessionId.get(explicit) : '')
      || runIds.map(runId => this.sessionByRunId.get(runId)).find(Boolean);
    const key = (explicit && (this.turns.has(explicit) || this.integrity.has(explicit)))
      ? explicit
      : mapped || explicit
      || completionRunKey(event, ctx);
    if (key && !isInternalExecutionSession(key)) {
      for (const runId of runIds) this.sessionByRunId.set(runId, key);
      for (const sessionId of sessionIds) this.sessionBySessionId.set(sessionId, key);
      // Affected runtime builds put the ephemeral UUID in the factory's
      // `sessionKey` slot. Once another trusted hook has resolved the owner,
      // retain that alias as well.
      if (explicit && explicit !== key) this.sessionBySessionId.set(explicit, key);
      for (const table of [this.sessionByRunId, this.sessionBySessionId]) {
        while (table.size > 2048) table.delete(table.keys().next().value);
      }
    }
    // Internal Skill reviewers and child workers feed evidence back to a
    // parent. Blocking their own terminal message recursively creates another
    // internal reviewer and leaves the real parent silent forever.
    return isInternalExecutionSession(key) ? '' : key;
  }

  resolveToolSession(context = {}, toolCallId = '') {
    const rawCallId = String(toolCallId || '');
    const byCall = this.sessionByToolCallId.get(rawCallId)
      || [...this.sessionByToolCallId.entries()].find(([candidate]) => rawCallId
        && candidate.replace(/[^a-z0-9]/gi, '') === rawCallId.replace(/[^a-z0-9]/gi, ''))?.[1];
    if (byCall && (this.integrity.has(byCall) || this.turns.has(byCall))) return byCall;
    const direct = [context.sessionKey, context.sessionId]
      .filter(Boolean).map(String)
      .find(candidate => this.integrity.has(candidate) || this.turns.has(candidate));
    if (direct) return direct;
    const mapped = [context.sessionId, context.sessionKey]
      .filter(Boolean).map(String)
      .map(candidate => this.sessionBySessionId.get(candidate))
      .find(candidate => candidate && (this.integrity.has(candidate) || this.turns.has(candidate)));
    if (mapped) return mapped;
    // Last-resort correlation for runtimes that omit every factory identity
    // and also omit execute(toolCallId). Only accept one recent, host-observed
    // pending delivery_guard call; ambiguity fails closed instead of crossing
    // sessions.
    const now = Date.now();
    const agentPrefix = context.agentId ? `agent:${context.agentId}:` : '';
    const pending = [...this.pendingDeliverySessions.entries()]
      .filter(([key, value]) => now - value.at < 15_000
        && (!agentPrefix || key.startsWith(agentPrefix))
        && (this.integrity.has(key) || this.turns.has(key)));
    return pending.length === 1 ? pending[0][0] : '';
  }

  bindToolInvocation(toolCallId = '', hookContext = {}) {
    const callId = String(toolCallId || '');
    if (!callId) return '';
    const sessionKey = this.key({}, hookContext || {});
    if (!sessionKey) return '';
    this.sessionByToolCallId.set(callId, sessionKey);
    while (this.sessionByToolCallId.size > 4096) {
      this.sessionByToolCallId.delete(this.sessionByToolCallId.keys().next().value);
    }
    return sessionKey;
  }

  boundContext(event = {}, ctx = {}) {
    const sessionKey = this.key(event, ctx);
    if (!sessionKey) return null;
    return {
      event: {...event, sessionKey},
      ctx: {...ctx, sessionKey},
      sessionKey,
    };
  }

  isHousekeepingRun(event = {}, ctx = {}) {
    const runId = String(ctx.runId || event.runId || '');
    return Boolean(runId && this.housekeepingRuns.has(runId))
      || String(ctx.trigger || event.trigger || '') === 'memory';
  }

  beforeTool(event = {}, ctx = {}) {
    if (this.isHousekeepingRun(event, ctx)) return;
    const bound = this.boundContext(event, ctx);
    if (!bound) return;
    const toolCallId = String(event.toolCallId || ctx.toolCallId || '');
    if (toolCallId) {
      this.sessionByToolCallId.set(toolCallId, bound.sessionKey);
      while (this.sessionByToolCallId.size > 4096) {
        this.sessionByToolCallId.delete(this.sessionByToolCallId.keys().next().value);
      }
    }
    if (String(event.toolName || '') === DELIVERY_GUARD_TOOL) {
      this.pendingDeliverySessions.set(bound.sessionKey, {toolCallId, at: Date.now()});
      for (const [sessionKey, value] of this.pendingDeliverySessions) {
        if (Date.now() - value.at >= 15_000) this.pendingDeliverySessions.delete(sessionKey);
      }
    }
    this.integrity.beforeTool(bound.event, bound.ctx);
  }

  async verifyAfterTool(event = {}, ctx = {}) {
    const bound = this.boundContext(event, ctx);
    if (!bound) return;
    return this.integrity.verifyAfterTool(bound.event, bound.ctx);
  }

  finalizeDecision(event = {}, ctx = {}, options = {}) {
    if (this.isHousekeepingRun(event, ctx)) return;
    const bound = this.boundContext(event, ctx);
    if (!bound) return;
    return this.remindOnce(this.integrity.finalize(bound.event, bound.ctx, options), bound.event, bound.ctx);
  }

  /* 交付核验只提醒、不拦截（2026-10-08 用户选定）。
     同一轮用户消息里，第一次发现问题时把回复退回一次，附一句温和的提醒；
     碧琪改过的下一版（或隔了一个来回仍是同样的话）一律放行，不再打回、
     不再吞掉回复。同一版回复在同一个来回里会被两个钩子各查一次，所以
     3 秒内的同一份文字保持同一个结论。 */
  remindOnce(decision, event = {}, ctx = {}) {
    if (decision?.action !== 'revise') {
      if (!decision && workFirstContext(ctx)) {
        const key = this.key(event, ctx);
        const turn = key ? this.turns.get(key) : null;
        const note = turn?.unverified;
        const runId = String(ctx.runId || event.runId || turn?.runId || '');
        const reply = String(event.lastAssistantMessage || assistantTextFromMessages(event.messages) || '').trim();
        if (note && reply && (!note.runId || !runId || note.runId === runId)
            && hashForAudit(reply) === note.reply) {
          turn.unverified = null;
          this.persist(key, turn);
        }
      }
      return decision;
    }
    const key = this.key(event, ctx);
    const turn = key ? this.turns.get(key) : null;
    if (!turn) return decision;
    const reply = String(event.lastAssistantMessage || assistantTextFromMessages(event.messages) || '').trim();
    const replyHash = hashForAudit(reply);
    const now = Date.now();
    const seen = turn.reminded;
    const runId = String(ctx.runId || event.runId || turn.runId || '');
    // Two host hooks can inspect the same candidate, but a retry with the
    // same wording is a different run and must not spend a second reminder.
    if (seen && workFirstContext(ctx) && seen.runId && runId) {
      if (seen.runId !== runId || seen.reply !== replyHash) {
        turn.unverified = {
          reply: replyHash,
          displayReply: hashForAudit(renderFirstPerson(workFirstReplyText(reply, ctx))),
          runId,
          // Metre 有自己的口吻，不借碧琪的名字说话。
          note: (modeForContext(ctx) === 'metre' || isRolesContext(ctx)) ? '注：这一步还没核实——现有记录不足以证实这个结果。' : '这一步碧琪还没能确认：目前的记录还不足以核实这个结果。',
        };
        this.persist(key, turn);
        return undefined;
      }
    } else if (seen && (seen.reply !== replyHash || now - seen.at > 3_000)) return undefined;
    if (!seen) turn.reminded = {reply: replyHash, at: now, runId, reason: String(decision.reason || '').slice(0, 300)};
    const reason = String(decision.reason || '').replace(/^全局交付真实性门禁：/, '');
    return {
      ...decision,
      retry: {
        ...(decision.retry || {}),
        instruction: `交付前提醒（只提醒这一次）：${reason}。如果确实还没核对，就只补做最必要的一两步检查（运行测试、读回文件、用 curl 测接口之类），不要重做已经完成的工作，也不要去翻看本应用或插件的源代码；如果已经核对过，或者这条提醒不适用（比如只是转述、翻译别人的内容），就直接给出最终回复。这一版最终回复会替代上一版，所以要完整：保留上一版里用户要求汇报的全部内容（结果、数字、原因说明等），再补上新的核对结果。回复里不要提这条提醒。${reply ? `上一版最终回复草稿：<<<${reply.slice(0, 2400)}${reply.length > 2400 ? '…（后略）' : ''}>>>` : ''}`,
        maxAttempts: 1,
      },
    };
  }

  restore(key) {
    const persisted = this.audit.readState(key);
    if (!persisted?.active) return null;
    const turn = {
      prompt: String(persisted.prompt || '').slice(0, 12_000),
      promptHash: String(persisted.promptHash || ''),
      startedAt: Number(persisted.startedAt) || Date.now(),
      runId: String(persisted.runId || ''),
      pending: persisted.pending && typeof persisted.pending === 'object' ? {
        decision: persisted.pending.decision,
        runId: String(persisted.pending.runId || persisted.runId || ''),
        textHash: String(persisted.pending.textHash || ''),
        at: Number(persisted.pending.at) || Date.now(),
      } : null,
      // Timers do not survive a gateway process. Treat an old in-flight
      // marker as stale and re-arm it during recovery instead of leaving a
      // rejected turn permanently silent.
      retryScheduled: false,
      waitingBackground: Boolean(persisted.waitingBackground),
      retryAttempts: Number(persisted.retryAttempts) || 0,
      // The timer itself is process-local, but an already accepted durable
      // attempt must be resumed with the same ordinal after restart. Advancing
      // 24 -> 25 here used to discard the final legal attempt silently.
      retryResumeAttempt: Boolean(persisted.retryScheduled && Number(persisted.retryAttempts) > 0),
      retryExhausted: Boolean(persisted.retryExhausted),
      reminded: persisted.reminded && typeof persisted.reminded === 'object' ? {
        reply: String(persisted.reminded.reply || ''), at: Number(persisted.reminded.at) || 0,
        runId: String(persisted.reminded.runId || ''), reason: String(persisted.reminded.reason || ''),
      } : null,
      unverified: persisted.unverified && typeof persisted.unverified === 'object' ? {
        reply: String(persisted.unverified.reply || ''), displayReply: String(persisted.unverified.displayReply || ''),
        runId: String(persisted.unverified.runId || ''), note: String(persisted.unverified.note || ''),
      } : null,
      corrupted: Boolean(persisted.corrupted),
      toolIds: new Set(),
      followUps: Array.isArray(persisted.followUps) ? persisted.followUps.slice(-8) : [],
      restored: true,
    };
    if (!persisted.corrupted && persisted.integrity) {
      this.integrity.restore(key, persisted.integrity);
      const replay = this.audit.readRecords(key)
        .filter(record => record.type === 'tool_result' && record.at >= turn.startedAt - 2_000 && record.evidence)
        .map(record => record.evidence);
      this.integrity.replayTools(key, replay);
    }
    if (persisted.corrupted) {
      // A damaged chain cannot be repaired by asking the model to retry: the
      // next hook would fail the same provenance check and burn the entire
      // retry budget. Keep the evidence and require a fresh user turn to
      // quarantine it and start a clean chain.
      turn.retryExhausted = true;
      turn.pending = {
        decision: this.integrity.revise(key, persisted.reason || 'CLE Kk 状态不可验证'),
        runId: turn.runId,
        textHash: '',
        at: Date.now(),
      };
      this.retireRetry(key);
    }
    this.turns.set(key, turn);
    return turn;
  }

  persist(key, turn) {
    if (!key || !turn) return;
    const pending = turn.pending ? {
      decision: turn.pending.decision,
      runId: turn.pending.runId,
      textHash: turn.pending.textHash,
      at: turn.pending.at,
    } : null;
    this.audit.writeState(key, {
      active: true,
      prompt: String(turn.prompt || '').slice(0, 12_000),
      startedAt: turn.startedAt,
      promptHash: turn.promptHash || hashForAudit(turn.prompt || ''),
      runId: turn.runId || '',
      pending,
      retryScheduled: Boolean(turn.retryScheduled),
      retryScheduledAt: turn.retryScheduled ? (Number(turn.retryScheduledAt) || Date.now()) : 0,
      retryAttempts: Number(turn.retryAttempts) || 0,
      retryExhausted: Boolean(turn.retryExhausted),
      reminded: turn.reminded || null,
      unverified: turn.unverified || null,
      waitingBackground: Boolean(turn.waitingBackground),
      followUps: Array.isArray(turn.followUps) ? turn.followUps.slice(-8) : [],
      // Tool evidence is append-only in the audit journal. Rewriting the full
      // history into this state file after every tool caused long sessions to
      // stutter; only the small contract/attestation snapshot lives here.
      integrity: this.integrity.snapshot(key, {includeTools: false}),
    });
  }

  /** Re-arm rejected turns left on disk after a gateway restart. */
  async recoverPending(agentResolver = agentFromSessionKey) {
    const states = this.audit.listStates();
    for (const state of states) {
      const key = String(state.sessionKey || '');
      // Child sessions are quiet implementation details.  Replaying their
      // rejected transcript after a gateway restart creates invisible child
      // loops and can flood the parent with duplicate candidates; only a
      // parent session may own a user-visible recovery turn.
      if (!key || isInternalExecutionSession(key)) {
        // Old builds persisted recursive control-plane states. They are not
        // user work and can never be delivered, so retire only their state
        // marker while preserving the append-only audit journal.
        if (key) this.audit.removeState(key);
        continue;
      }
      if (this.turns.has(key)) continue;
      const turn = this.restore(key);
      if (!turn?.pending || turn.retryScheduled) continue;
      this.scheduleRetry({key, turn, ...turn.pending}, {
        agentId: agentResolver(key),
        sessionKey: key,
      }, 'gateway_restart');
    }
    return states.length;
  }

  begin(event = {}, ctx = {}) {
    // Hook payloads are not uniform across OpenClaw lifecycle stages. The
    // first hook commonly has sessionKey but no prompt; before_prompt_build
    // then has the prompt and only runId. Bind both to the same durable
    // session before touching the evidence window.
    const bound = this.boundContext(event, ctx);
    if (!bound) return;
    event = bound.event;
    ctx = bound.ctx;
    const key = bound.sessionKey;
    const prompt = workFirstPrompt(event.prompt, modeForContext(ctx)).trim();
    // `message_received` also fires for a real user message that was steered
    // into an already-live agent run. Its inbound run id is deliberately new,
    // while the active harness keeps emitting tool/final hooks under the old
    // run id. It must open a new evidence window, but must not orphan that
    // still-live harness (or its remaining tool evidence would be discarded).
    const inboundUserMessage = event.__pinkieInboundUserMessage === true;
    let turn = this.turns.get(key) || this.restore(key);
    // 11-04 隔离实测 routes-m R-ad：交付被提醒退回、续跑还在排队时，运行时先插了一轮「压缩前写记忆」
    // （记录里只显示 Continue the OpenClaw runtime event.）。这一轮被当成用户的新消息，整件活的工具记录
    // 被清空；随后的续跑只看到 ls / ffprobe，误报「做完之后没有亲自看过成品」，把剩下的时间耗光。
    // 整理轮不动正在做的那件活的记录，它自己的工具、收尾也不算进来。
    const housekeepingRunId = String(ctx.runId || event.runId || '');
    if (housekeepingRunId && housekeepingTurn(event, ctx, prompt)) {
      this.housekeepingRuns.set(housekeepingRunId, key);
      while (this.housekeepingRuns.size > 256) this.housekeepingRuns.delete(this.housekeepingRuns.keys().next().value);
      return;
    }
    // 真正的一轮开始了：这个会话之前没收尾的整理轮标记作废，免得一直挡着这个会话的交付检查。
    for (const [runId, sessionKey] of this.housekeepingRuns) if (sessionKey === key) this.housekeepingRuns.delete(runId);
    const backgroundResult = workFirstContext(ctx) && turn?.waitingBackground && workFirstBackgroundResult(prompt);
    const control = internalControlText(prompt) || backgroundResult;
    if (backgroundResult) turn.waitingBackground = false;
    // 追加消息（steer）在 run 还活着时到达，是对同一个任务的补充，比如
    // “改成用 X 方法”。它不能清空这一轮已经做过的工具记录，也不能拿这句
    // 补充话去重新判定任务类型；否则碧琪按要求答完也会被判“没有执行记录”，
    // 一直重试到“本轮未完成”。只有补充里明确要求改动文件时才提高门槛。
    if (inboundUserMessage && !control && prompt && turn?.prompt && !turn.pending
        && !internalControlText(turn.prompt) && prompt !== turn.prompt
        && this.integrity.has(key)) {
      turn.amendments = [...(Array.isArray(turn.amendments) ? turn.amendments : []), prompt.slice(0, 8_000)].slice(-8);
      this.audit.append('turn_amended', key, {prompt: hashForAudit(prompt)});
      if (isMutationRequest(prompt) && !isMutationRequest(turn.prompt)) {
        this.integrity.amendPrompt({prompt: `${turn.prompt}\n${prompt}`}, ctx);
      }
      this.persist(key, turn);
      return;
    }
    // 同一个 session 的新用户消息必须开启新的证据窗口；内部续接消息则
    // 继承原窗口，避免重试时把已经完成的工具调用丢掉。
    const incomingRunId = String(ctx.runId || event.runId || '');
    // 运行时开的别的内部轮（后台任务完成、运行时事件）接着同一件活，不是用户的新要求。
    const distinctUserTurn = !control && turn && prompt && !runtimeTurnText(prompt) && (
      turn.corrupted
      || (Boolean(turn.prompt) && (
        prompt !== turn.prompt
        || (incomingRunId && turn.runId && incomingRunId !== turn.runId)
      ))
    );
    if (distinctUserTurn) {
      this.deliveryFallbackBySession.delete(key);
      // “继续/接着” explicitly belongs to the old task. Every other new
      // request must remain usable even when the previous turn is pending:
      // a stale retry lane must never monopolize the session or hide replies.
      const continuesPreviousTurn = ACTION_CONTINUATION.test(prompt);
      if (turn.pending && !turn.retryExhausted && continuesPreviousTurn) {
        turn.followUps = Array.isArray(turn.followUps) ? turn.followUps : [];
        if (!turn.followUps.includes(prompt)) turn.followUps.push(prompt.slice(0, 8_000));
        turn.followUps = turn.followUps.slice(-8);
        this.audit.append('turn_followup_queued', key, {prompt: hashForAudit(prompt)});
      } else {
        // Preserve the old append-only audit chain, retire its retry lease,
        // and start a clean evidence window for the actual new message. Late
        // hooks from the superseded run are fenced by `orphaned` above.
        if (!inboundUserMessage && turn.runId && turn.runId !== incomingRunId) {
          this.orphaned.set(String(turn.runId), key);
          while (this.orphaned.size > 2048) this.orphaned.delete(this.orphaned.keys().next().value);
        }
        if (turn.pending) this.retireRetry(key);
        const chain = this.audit.verify(key);
        if (!chain.ok && !chain.busy) this.audit.quarantine(key, 'new-turn');
        this.integrity.reset(key);
        this.audit.append('turn_superseded', key, {
          reason: continuesPreviousTurn ? 'new_turn_after_exhausted_retry' : 'new_user_turn',
        });
        this.audit.removeState(key);
        turn = null;
      }
    }
    if (!turn) {
      turn = {
        prompt,
        promptHash: hashForAudit(prompt),
        startedAt: Date.now(),
        runId: String(ctx.runId || event.runId || ''),
        pending: null,
        retryScheduled: false,
        retryAttempts: 0,
        retryResumeAttempt: false,
        retryExhausted: false,
        corrupted: false,
        toolIds: new Set(),
        followUps: [],
      };
      this.turns.set(key, turn);
      this.audit.append('turn_start', key, {
        run: turn.runId ? hashForAudit(turn.runId) : '',
        prompt: hashForAudit(prompt),
      });
    } else if (control) {
      turn.retryScheduled = false;
      turn.retryScheduledAt = 0;
      turn.runId = String(ctx.runId || event.runId || turn.runId || '');
      if (turn.pending && turn.runId) turn.pending.runId = turn.runId;
    }
    // Fill the prompt when the first lifecycle hook had no prompt. This is
    // the common ordering for embedded runs (before_agent_run -> prompt
    // build) and is essential for action-vs-chat classification.
    if (turn && prompt && !control && !turn.prompt) {
      turn.prompt = prompt;
      turn.promptHash = hashForAudit(prompt);
    }
    this.integrity.begin(event, ctx);
    this.integrity.updatePrompt({prompt: turn?.prompt || prompt}, ctx);
    if (turn) this.persist(key, turn);
  }

  /**
   * `before_prompt_build` is not called again when OpenClaw steers an inbound
   * message into the currently running harness. Observe that transport-level
   * event explicitly so the added instruction is a real user turn for the
   * integrity gate, while the original live run stays valid for later tools.
   */
  receiveUserMessage(event = {}, ctx = {}) {
    const prompt = String(event.content ?? event.body ?? event.prompt ?? '').trim();
    if (!prompt || internalControlText(prompt)) return false;
    const bound = this.boundContext(event, ctx);
    if (!bound) return false;
    this.begin({
      ...bound.event,
      prompt,
      __pinkieInboundUserMessage: true,
    }, bound.ctx);
    return true;
  }

  afterTool(event = {}, ctx = {}) {
    if (this.isHousekeepingRun(event, ctx)) return;
    const bound = this.boundContext(event, ctx);
    if (!bound) return;
    const {sessionKey: key} = bound;
    this.integrity.afterTool(bound.event, bound.ctx);
    let turn = this.turns.get(key);
    if (!turn) {
      this.begin({prompt: ''}, ctx);
      turn = this.turns.get(key);
    }
    const toolId = String(event.toolCallId || `${event.runId || ''}:${turn?.toolIds?.size || 0}`);
    if (turn?.toolIds?.has(toolId)) return;
    turn?.toolIds?.add(toolId);
    this.audit.append('tool_result', key, {
      run: event.runId ? hashForAudit(event.runId) : '',
      tool: String(event.toolName || ''),
      call: hashForAudit(toolId),
      failed: Boolean(event.error) || toolResultFailed(event, resultText(event.result)),
      changed: this.integrity.runs.get(key)?.tools?.at(-1)?.effects?.filter(effect => effect.changed).length || 0,
      result: hashForAudit(resultText(event.result, 24_000)),
      evidence: compactToolEvidence(this.integrity.runs.get(key)?.tools?.at(-1) || {}),
    });
    if (turn) this.persist(key, turn);
  }

  recordFinalize(event = {}, ctx = {}, decision) {
    if (this.isHousekeepingRun(event, ctx)) return decision;
    const key = this.key(event, ctx);
    if (!key) return decision;
    let turn = this.turns.get(key);
    if (!turn) {
      this.begin({prompt: ''}, ctx);
      turn = this.turns.get(key);
    }
    const reply = String(event.lastAssistantMessage || assistantTextFromMessages(event.messages) || '').trim();
    const runId = String(ctx.runId || event.runId || turn?.runId || '');
    const fallback = this.deliveryFallbackBySession.get(key);
    if (fallback && Date.now() - fallback.at < 120_000
        && (!fallback.runId || !runId || fallback.runId === runId)
        && reply !== fallback.text) {
      // Some hosts call finalize again with the original model candidate
      // after the transcript hook replaced it. Do not rearm that rejected
      // candidate after the honest fallback has already been accepted.
      return;
    }
    const chain = this.audit.verify(key);
    // A damaged control log is itself a failed verification. Never clear a
    // pending decision or accept a final while the provenance chain is broken.
    if (!chain.ok && (!decision || decision.action !== 'revise'
      || !AUDIT_CORRUPTION_FAILURE.test(String(decision.reason || '')))) {
      // A pre-existing revise decision (for example “no real tool effect”)
      // must not hide a concurrently discovered journal break. Retrying the
      // former reason would append nothing to the broken chain and loop until
      // the entire integrity budget is burned.
      decision = this.remindOnce(this.integrity.revise(key, chain.reason || '审计链断裂，无法确认工具事件完整性'), event, ctx);
    }
    if (decision?.action === 'revise') {
      const previous = turn.pending;
      // before_message_write 拿不到 runId（审计里 run 为空），before_agent_finalize 才有。
      // 同一份候选被两个钩子各判一次时，空 runId 视为同一次尝试：否则「已安排重试」被清掉，
      // agent_end 又记一次，唯一的一次提醒额度被重复计数直接耗尽，连已排好的重试计时器也被撤掉，
      // 结果整轮没有最终回复（界面上表现为「已中断」/像断线了一样不再恢复）。
      const sameAttempt = Boolean(previous) && previous.decision?.reason === decision.reason
        && (!previous.runId || !runId || previous.runId === runId);
      turn.pending = {
        decision,
        runId: runId || previous?.runId || '',
        textHash: hashForAudit(reply),
        at: Date.now(),
      };
      if (AUDIT_CORRUPTION_FAILURE.test(String(decision.reason || ''))) {
        // Retrying cannot repair a provenance file that is already broken.
        // Mark it terminal for this turn; a new user message will quarantine
        // the old chain and open a fresh evidence window.
        turn.retryExhausted = true;
        this.retireRetry(key);
      }
      turn.retryScheduled = sameAttempt ? turn.retryScheduled : false;
      this.audit.append('final_rejected', key, {
        run: runId ? hashForAudit(runId) : '',
        reason: String(decision.reason || '').slice(0, 600),
        reply: hashForAudit(reply),
      });
      this.persist(key, turn);
      return decision;
    }
    const hadPending = Boolean(turn.pending);
    const explicitIncomplete = isHonestIncomplete(reply)
      || (IN_PROGRESS_CLAIM.test(proseOnly(reply)) && !COMPLETION_CLAIM.test(reply));
    // 只有真正通过门禁的终稿，或明确告诉用户“尚未完成/被阻塞”的诚实
    // 说明，才会清掉上一条待重试决定。普通的阶段性句子不能把失败状态
    // 静默改成成功，否则下一轮又会失去续接依据。
    // NO_REPLY / HEARTBEAT_OK 用户看不到，不是对被退回那一版的回答：不能把待续跑的提醒清掉。
    const silentReply = /^(?:NO_REPLY|HEARTBEAT_OK)$/i.test(reply);
    if (reply && !internalControlText(reply) && !(silentReply && hadPending)) {
      if (hadPending && !turn.reminded && isLikelyActionRequest(turn.prompt)
        && !COMPLETION_CLAIM.test(reply) && !DELIVERY_CLAIM.test(reply) && !explicitIncomplete) {
        this.persist(key, turn);
        return decision;
      }
      turn.pending = null;
      turn.retryScheduled = false;
      turn.retryAttempts = 0;
      turn.retryExhausted = false;
      this.audit.append('final_accepted', key, {
        run: runId ? hashForAudit(runId) : '',
        reply: hashForAudit(reply),
      });
    }
    this.persist(key, turn);
    return decision;
  }

  pendingFor(event = {}, ctx = {}) {
    const key = this.key(event, ctx);
    const turn = this.turns.get(key);
    const pending = turn?.pending;
    if (!pending) return null;
    const runId = String(ctx.runId || event.runId || '');
    if (runId && pending.runId && runId !== pending.runId) return null;
    return {key, turn, ...pending};
  }

  unverifiedNote(text, event = {}, ctx = {}) {
    const note = this.turns.get(this.key(event, ctx))?.unverified;
    if (!note || !text || text.includes(note.note)) return '';
    const runId = String(ctx.runId || event.runId || '');
    if (runId && note.runId && runId !== note.runId) return '';
    const hash = hashForAudit(String(text).trim());
    return hash === note.reply || hash === note.displayReply ? note.note : '';
  }

  scheduleRetry(pending, ctx = {}, source = 'delivery') {
    if (!pending?.turn || pending.turn.retryScheduled || pending.turn.retryExhausted || isInternalExecutionSession(pending.key)) return false;
    if (AUDIT_CORRUPTION_FAILURE.test(String(pending.decision?.reason || ''))) {
      pending.turn.retryExhausted = true;
      pending.turn.retryScheduled = false;
      pending.turn.retryScheduledAt = 0;
      this.retireRetry(pending.key);
      this.persist(pending.key, pending.turn);
      this.logger?.warn?.(`CLE Kk retry stopped because the audit chain is corrupt session=${pending.key}`);
      return false;
    }
    pending.turn.retryScheduled = true;
    pending.turn.retryScheduledAt = Date.now();
    const resumeAcceptedAttempt = source === 'gateway_restart'
      && pending.turn.retryResumeAttempt && Number(pending.turn.retryAttempts) > 0;
    pending.turn.retryResumeAttempt = false;
    if (!resumeAcceptedAttempt) pending.turn.retryAttempts = (pending.turn.retryAttempts || 0) + 1;
    this.audit.append('retry_requested', pending.key, {
      run: pending.runId ? hashForAudit(pending.runId) : '',
      source: String(source),
      attempt: pending.turn.retryAttempts,
      reason: String(pending.decision?.reason || '').slice(0, 600),
    });
    this.persist(pending.key, pending.turn);
    if (!this.retryScheduler) {
      pending.turn.retryScheduled = false;
      pending.turn.retryScheduledAt = 0;
      this.persist(pending.key, pending.turn);
      return false;
    }
    Promise.resolve(this.retryScheduler({
      sessionKey: pending.key,
      agentId: ctx.agentId || agentFromSessionKey(pending.key),
      runId: pending.runId,
      decision: pending.decision,
      attempt: pending.turn.retryAttempts,
    })).then(result => {
      const accepted = result === true || result?.ok === true || result?.accepted === true;
      if (!accepted) {
        pending.turn.retryScheduled = false;
        pending.turn.retryScheduledAt = 0;
        if (result?.exhausted === true) {
          pending.turn.retryExhausted = true;
          this.audit.append('retry_exhausted', pending.key, {
            run: pending.runId ? hashForAudit(pending.runId) : '',
            attempt: pending.turn.retryAttempts,
            reason: String(pending.decision?.reason || '').slice(0, 600),
          });
        }
      }
      this.persist(pending.key, pending.turn);
    }).catch(error => {
      pending.turn.retryScheduled = false;
      pending.turn.retryScheduledAt = 0;
      this.persist(pending.key, pending.turn);
      this.logger?.warn?.(`CLE Kk retry scheduling failed: ${String(error)}`);
    });
    return true;
  }

  beforeMessageWrite(event = {}, ctx = {}, preDecision, prechecked = false) {
    const message = event.message || {};
    if (message.role !== 'assistant' || assistantMessageHasToolCall(message)) return;
    if (this.windows && failedAssistantMessage(message)) return;
    const text = visibleAssistantText(message);
    if (!text || /^(?:toolUse|tool_use)$/i.test(String(message.stopReason || ''))) return;
    if (internalControlText(text)) return {block: true};
    // 写记录这一步拿不到 run id：整理轮正在跑的会话，这条（通常是 NO_REPLY）不当交付，也不拦。
    const writingSession = this.key({}, ctx);
    if (this.isHousekeepingRun(event, ctx)
        || (writingSession && [...this.housekeepingRuns.values()].includes(writingSession))) return;
    // The model transcript can be persisted before OpenClaw's finalize hook
    // runs. Re-evaluate the cheap, deterministic gate here so a false
    // completion cannot enter JSONL even when the host ignores a revision
    // after a side effect. The expensive external verifier remains in the
    // lifecycle hook below.
    let pending = this.pendingFor({}, ctx);
    if (isTerminalAssistantMessage(message)) {
      const candidate = {lastAssistantMessage: text, messages: [message], runId: ctx.runId, sessionKey: ctx.sessionKey};
      const decision = prechecked ? preDecision
        : this.remindOnce(this.integrity.finalize(candidate, ctx, {verifyExternal: false}), candidate, ctx);
      // A pending marker belongs to the previously rejected attempt, not to
      // every future final in this session. Re-evaluate every new terminal
      // against the latest tool evidence before transcript persistence. A
      // valid retry clears the old marker here, so its final text is written
      // to durable history instead of appearing only in the live stream and
      // vanishing after a reload.
      const key = this.key({}, ctx);
      const turn = this.turns.get(key);
      if (decision?.action === 'revise' && turn
          && (turn.retryExhausted || Number(turn.retryAttempts) >= this.retryLimit(key, decision))) {
        // The scheduler marks exhaustion only *after* this synchronous write
        // hook has blocked the candidate. No later model answer then exists
        // to release. Write a truthful terminal failure instead of silence.
        const fallbackText = '本轮未完成：多次自动核验后仍无法确认最终结果，已停止重试。工具记录保留在当前会话中，请查看记录后再继续。';
        const fallbackMessage = {...message,stopReason:'stop',content:[{type:'text',text:fallbackText}]};
        const fallbackDecision = this.integrity.finalize({
          lastAssistantMessage:fallbackText,messages:[fallbackMessage],runId:ctx.runId,sessionKey:key,
        },ctx,{verifyExternal:false});
        if (!fallbackDecision || fallbackDecision.action !== 'revise') {
          this.recordFinalize({lastAssistantMessage:fallbackText,messages:[fallbackMessage],runId:ctx.runId},ctx,fallbackDecision);
          this.deliveryFallbackBySession.set(key, {
            runId:String(ctx.runId || event.runId || ''),text:fallbackText,at:Date.now(),
          });
          this.retireRetry(key);
          return {message:fallbackMessage};
        }
      }
      this.recordFinalize({lastAssistantMessage: text, messages: [message], runId: ctx.runId}, ctx, decision);
      pending = this.pendingFor({}, ctx);
    }
    if (!pending) {
      const note = this.unverifiedNote(text, event, ctx);
      if (!note) return;
      const content = typeof message.content === 'string' ? `${message.content}\n\n${note}`
        : [...(Array.isArray(message.content) ? message.content : []), {type: 'text', text: `\n\n${note}`}];
      return {message: {...message, content}};
    }
    // 重试预算已耗尽时放行最后一次回复，不再阻断。继续阻断只会导致
    // 会话无输出地静默结束——用户看到"工具调用完成"后永远等不到文字。
    if (pending.turn?.retryExhausted) {
      pending.turn.pending = null;
      pending.turn.retryScheduled = false;
      this.persist(this.key({}, ctx), pending.turn);
      return;
    }
    this.scheduleRetry(pending, ctx, 'transcript');
    // 诚实的未完成说明可以留在记录里，完成性谎报则连 transcript 也不落盘。
    if (isHonestIncomplete(text)) return;
    return {block: true};
  }

  async beforeReplyPayload(event = {}, ctx = {}) {
    if (String(event.kind || '') !== 'final') return;
    const text = payloadText(event.payload);
    const key = this.key(event, ctx);
    const fallback = this.deliveryFallbackBySession.get(key);
    const runId = String(ctx.runId || event.runId || '');
    if (fallback && Date.now() - fallback.at < 120_000
        && (!fallback.runId || !runId || fallback.runId === runId)) {
      return {payload:{text:fallback.text}};
    }
    if (internalControlText(text)) return {cancel: true, reason: 'internal_control_payload'};
    const pending = this.pendingFor(event, ctx);
    if (!pending) {
      const note = this.unverifiedNote(text, event, ctx);
      if (note && typeof event.payload?.text === 'string') return {payload: {...event.payload, text: `${event.payload.text}\n\n${note}`}};
      return;
    }
    // 重试已耗尽时放行，避免最终回复被永久拦截。
    if (pending.turn?.retryExhausted) {
      pending.turn.pending = null;
      pending.turn.retryScheduled = false;
      this.persist(this.key(event, ctx), pending.turn);
      return;
    }
    this.scheduleRetry(pending, ctx, 'reply_payload');
    if (isHonestIncomplete(text)) return;
    return {cancel: true, reason: 'CLE Kk 正在继续核对真实执行结果'};
  }

  hasPending(sessionKey) {
    return Boolean(this.turns.get(String(sessionKey || ''))?.pending);
  }

  end(event = {}, ctx = {}) {
    const housekeepingRunId = String(ctx.runId || event.runId || '');
    if (housekeepingRunId && this.housekeepingRuns.has(housekeepingRunId)) {
      this.housekeepingRuns.delete(housekeepingRunId);
      return false;
    }
    const key = this.key(event, ctx);
    if (!key) return true;
    const turn = this.turns.get(key);
    if (turn?.pending && !turn.retryExhausted) return false;
    if (workFirstContext({...ctx, sessionKey: key}) && turn && waitingForGeneratedMedia(event)) {
      turn.waitingBackground = true;
      this.persist(key, turn);
      return false;
    }
    this.integrity.end(event, ctx);
    this.turns.delete(key);
    this.audit.append('turn_end', key, {run: event.runId ? hashForAudit(event.runId) : ''});
    this.audit.removeState(key);
    for (const runId of [ctx.runId, event.runId].filter(Boolean).map(String)) {
      this.sessionByRunId.delete(runId);
    }
    return true;
  }
}
