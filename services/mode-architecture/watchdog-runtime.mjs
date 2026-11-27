// WatchdogJobStore, FileRunStore, CompactionHandoffStore, ModelUsageLedger, UpstreamWatchdog, and TierContinuation.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {openclawStateDir} from './openclaw-paths.mjs';
import {lineageRunningChildren} from './session-lineage.mjs';
import {AUTO_COMPACTION_RECOVERY_FAILURE, CONTEXT_OVERFLOW_FAILURE, DISPATCH_SETUP_FAILURE, DISPLAY_PRICING_VERSION, GATEWAY_RECOVERY_FAILURE, PERMANENT_FAILURE, PROVIDER_ACCOUNT_FAILURE, TIER_FAILED_TURN_BASE_MS, TIER_FAILED_TURN_LIMIT, TIER_FAILED_TURN_MAX_MS, TIER_FAILED_TURN_RESET_CAP_MS, TIER_RETRY_LIMITS, USER_STOP_GRACE_MS, WATCHDOG_ACCOUNT_FALLBACKS, WATCHDOG_ACTIVITY_POLL_MS, WATCHDOG_CLI_TIMEOUT_MS, WATCHDOG_DISPATCH_FAILURE_LIMIT, WATCHDOG_GATEWAY_BACKOFF_INITIAL_MS, WATCHDOG_GATEWAY_BACKOFF_MAX_MS, WATCHDOG_MAX_ATTEMPTS, WATCHDOG_OUTAGE_DELAYS_MS, WATCHDOG_OUTAGE_MAX_ATTEMPTS, WATCHDOG_QUIET_FENCE_MS, WATCHDOG_RETRY_MAX_DELAY_MS, WATCHDOG_STALLED_GENERATION_MS, displayCost, endedWithFailedAssistant, endsWithYield, failureReasonFromEvent, hasIncompleteToolTurn, isInternalExecutionSession, isProviderOutage, isTransientFailure, isWatchdogParentContext, localSetupFailure, normalizedTaskType, pinkieStateRoot, resolveGatewayCliEntry, runProcess, safeTag, shortReason, tierControlMessage, userStoppedRecently, userStops, watchdogControlMessage} from './mode-constants.mjs';
import {workFirstContext} from './evidence-rules.mjs';
import {hashForAudit, internalControlText} from './completion-integrity.mjs';
import {agentFromSessionKey, modelOverrideFor, verificationEvidence} from './deliberation-audit.mjs';

/** Durable lease for upstream failures; survives a gateway/process restart. */
export class WatchdogJobStore {
  constructor(root = path.join(pinkieStateRoot(), 'cle-kk', 'watchdog')) {
    this.root = root;
  }

  fileFor(sessionKey) {
    if (!this.root || !sessionKey) return '';
    return path.join(this.root, `${hashForAudit(sessionKey).slice(0, 32)}.json`);
  }

  set(sessionKey, value = {}) {
    const file = this.fileFor(sessionKey);
    if (!file) return false;
    const record = {
      v: 1,
      sessionKey: String(sessionKey),
      agentId: String(value.agentId || agentFromSessionKey(sessionKey)),
      runId: String(value.runId || ''),
      model: String(value.model || ''),
      kind: String(value.kind || 'upstream'),
      attempt: Math.max(1, Number(value.attempt) || 1),
      maxAttempts: Math.max(0, Number(value.maxAttempts) || 0),
      reasonHash: hashForAudit(value.reason || ''),
      updatedAt: Date.now(),
    };
    record.digest = hashForAudit(JSON.stringify(record));
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
      fs.writeFileSync(temp, `${JSON.stringify(record)}\n`, {encoding: 'utf8', mode: 0o600});
      fs.renameSync(temp, file);fs.chmodSync(file, 0o600);
      return true;
    } catch {
      try { fs.unlinkSync(temp); } catch {}
      return false;
    }
  }

  delete(sessionKey) {
    const file = this.fileFor(sessionKey);
    if (!file) return;
    try { fs.unlinkSync(file); } catch {}
  }

  list() {
    if (!this.root || !fs.existsSync(this.root)) return [];
    let names=[];try { names=fs.readdirSync(this.root).filter(name=>name.endsWith('.json')); } catch { return []; }
    const jobs=[];
    for (const name of names) {
      try {
        const value=JSON.parse(fs.readFileSync(path.join(this.root,name),'utf8'));
        const digest=String(value.digest || '');const unsigned={...value};delete unsigned.digest;
        if (value.v===1 && value.sessionKey && digest===hashForAudit(JSON.stringify(unsigned))) jobs.push(value);
      } catch {}
    }
    return jobs;
  }
}

function encodeRun(state) {
  return {
    ...state,
    pendingChildren: [...state.pendingChildren],
    completedChildren: [...state.completedChildren],
    emptyChildren: [...(state.emptyChildren || new Set())],
    childRoles: Object.fromEntries(state.childRoles),
    childCandidates: Object.fromEntries(state.childCandidates || new Map()),
    childResults: Object.fromEntries(state.childResults),
    reservations: Object.fromEntries(state.reservations),
    childModels: Object.fromEntries(state.childModels),
    modelCounts: Object.fromEntries(state.modelCounts),
    completedRoles: Object.fromEntries(state.completedRoles),
  };
}

function decodeRun(value) {
  if (!value || typeof value !== 'object' || !value.parentSessionKey) return null;
  return {
    ...value,
    pendingChildren: new Set(Array.isArray(value.pendingChildren) ? value.pendingChildren : []),
    completedChildren: new Set(Array.isArray(value.completedChildren) ? value.completedChildren : []),
    emptyChildren: new Set(Array.isArray(value.emptyChildren) ? value.emptyChildren : []),
    childRoles: new Map(Object.entries(value.childRoles || {})),
    childCandidates: new Map(Object.entries(value.childCandidates || {})),
    childResults: new Map(Object.entries(value.childResults || {})),
    reservations: new Map(Object.entries(value.reservations || {})),
    childModels: new Map(Object.entries(value.childModels || {})),
    modelCounts: new Map(Object.entries(value.modelCounts || {}).map(([model, count]) => [model, Number(count) || 0])),
    completedRoles: new Map(Object.entries(value.completedRoles || {}).map(([role, count]) => [role, Number(count) || 0])),
    taskPrompt: String(value.taskPrompt || ''),
    taskType: normalizedTaskType(value.taskType || 'pending'),
    verificationEvidence: Array.isArray(value.verificationEvidence) ? value.verificationEvidence.slice(-120) : [],
    progressDigests: Array.isArray(value.progressDigests) ? [...new Set(value.progressDigests)].slice(-120) : [],
    progressSequence: Math.max(0, Number(value.progressSequence) || 0),
    lastMutationSequence: Math.max(0, Number(value.lastMutationSequence) || 0),
    tradeoffCompared: Boolean(value.tradeoffCompared),
    tradeoffPresented: Boolean(value.tradeoffPresented),
    retryAttempts: Math.max(0, Number(value.retryAttempts) || 0),
    noProgressCycles: Math.max(0, Number(value.noProgressCycles) || 0),
    lastProgressFingerprint: String(value.lastProgressFingerprint || ''),
    lastRetryRunId: String(value.lastRetryRunId || ''),
    lastRetryReplyKey: String(value.lastRetryReplyKey || ''),
    lastRetryWithoutRunId: Boolean(value.lastRetryWithoutRunId),
    retryDifferences: Array.isArray(value.retryDifferences) ? value.retryDifferences.slice(-10) : [],
    lastRetryDecision: value.lastRetryDecision && typeof value.lastRetryDecision === 'object' ? value.lastRetryDecision : null,
    stopRequested: Boolean(value.stopRequested),
    stopReason: String(value.stopReason || ''),
    stopRunId: String(value.stopRunId || ''),
    stopReportPending: Boolean(value.stopReportPending),
    finalSourceSummary: Boolean(value.finalSourceSummary),
  };
}

function stateFileId(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

// `active.md` used to be shared by every conversation in one mode workspace.
// A mode can have many independent conversations, so a shared checkpoint lets
// one session's unfinished task leak into another session's model context.
// Keep the old file untouched for backwards-compatible user data, but never
// load or write it as live state again.
export function sessionCheckpointRelative(sessionKey = '') {
  const normalized = String(sessionKey || '').trim();
  return normalized ? `memory/context/sessions/${stateFileId(normalized)}.md` : '';
}

export class FileRunStore {
  constructor(root = process.env.PINKIE_STATE_ROOT
    ? path.join(pinkieStateRoot(), 'cle-kk', 'deep-think')
    : path.join(openclawStateDir(), 'pinkie-deep-think')) {
    this.root = root;
  }

  runFile(sessionKey) {
    return path.join(this.root, 'runs', `${stateFileId(sessionKey)}.json`);
  }

  childFile(childSessionKey) {
    return path.join(this.root, 'children', `${stateFileId(childSessionKey)}.json`);
  }

  write(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const record = {v: 1, ...value, updatedAt: Date.now()};
    record.digest = hashForAudit(JSON.stringify(record));
    fs.writeFileSync(temp, JSON.stringify(record), {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  }

  read(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value && !value.v && !value.digest) return {...value, legacy: true};
    const expected = String(value?.digest || '');
    const unsigned = {...value}; delete unsigned.digest;
    if (value?.v !== 1 || !expected || hashForAudit(JSON.stringify(unsigned)) !== expected) return null;
    return value;
  }

  get(sessionKey) {
    try {
      const file = this.runFile(sessionKey), value = this.read(file);
      if (value?.legacy && value.sessionKey === sessionKey) this.write(file, {sessionKey, state: value.state});
      return value.sessionKey === sessionKey ? decodeRun(value.state) : null;
    } catch { return null; }
  }

  set(sessionKey, state) {
    this.write(this.runFile(sessionKey), {sessionKey, state: encodeRun(state)});
  }

  delete(sessionKey) {
    try { fs.unlinkSync(this.runFile(sessionKey)); } catch {}
  }

  mapChild(childSessionKey, parentSessionKey) {
    this.write(this.childFile(childSessionKey), {childSessionKey, parentSessionKey});
  }

  parentForChild(childSessionKey) {
    try {
      const file = this.childFile(childSessionKey), value = this.read(file);
      if (value?.legacy && value.childSessionKey === childSessionKey) {
        this.write(file, {childSessionKey, parentSessionKey: value.parentSessionKey});
      }
      return value.childSessionKey === childSessionKey ? String(value.parentSessionKey || '') : '';
    } catch { return ''; }
  }
}

function handoffText(value, max = 12_000) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n[已为续接截短；以项目现场和原始会话为准]`;
}

function handoffRunState(state = null) {
  if (!state || typeof state !== 'object') return null;
  const completedRoles = state.completedRoles instanceof Map
    ? Object.fromEntries(state.completedRoles)
    : state.completedRoles && typeof state.completedRoles === 'object'
      ? {...state.completedRoles}
      : {};
  const childEntries = state.childResults instanceof Map
    ? [...state.childResults]
    : Array.isArray(state.childResults)
      ? state.childResults
      : state.childResults && typeof state.childResults === 'object'
        ? Object.entries(state.childResults)
        : [];
  return {
    active: state.active !== false,
    tier: String(state.tier || ''),
    mode: String(state.mode || ''),
    model: String(state.model || ''),
    spawned: Number(state.count) || 0,
    pendingChildren: Number(state.pendingChildren?.size) || 0,
    completedRoles,
    childResults: childEntries.slice(-8).map(([child, entry]) => ({
      child: String(child).slice(-48),
      role: String(entry?.role || ''),
      text: handoffText(entry?.text, 2_000),
    })),
  };
}

function handoffToolEvidence(snapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  return (Array.isArray(snapshot.tools) ? snapshot.tools : []).slice(-16).map(entry => ({
    name: String(entry?.name || ''),
    failed: Boolean(entry?.failed),
    output: handoffText(entry?.output, 1_500),
    effects: (Array.isArray(entry?.effects) ? entry.effects : []).slice(0, 8).map(effect => ({
      path: handoffText(effect?.path, 500), changed: Boolean(effect?.changed),
      exists: Boolean(effect?.exists), hostReported: Boolean(effect?.hostReported),
    })),
  })).filter(entry => entry.name);
}

/**
 * A compacted transcript is a context checkpoint, not a completed task.  Keep
 * a small, signed local handoff beside the gateway state so a failed automatic
 * compaction can resume from the task's real anchors instead of asking the
 * user to repeat themselves or replaying already-completed side effects.
 */
export class CompactionHandoffStore {
  constructor(root = path.join(pinkieStateRoot(), 'cle-kk', 'compaction-handoffs')) {
    this.root = root;
  }

  fileFor(sessionKey) {
    return sessionKey ? path.join(this.root, `${stateFileId(sessionKey)}.json`) : '';
  }

  write(sessionKey, value = {}) {
    const file = this.fileFor(sessionKey);
    if (!file) return null;
    const record = {
      v: 1,
      sessionKey: String(sessionKey),
      ...value,
      updatedAt: Date.now(),
    };
    delete record.digest;
    record.digest = hashForAudit(JSON.stringify(record));
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
      fs.writeFileSync(temp, `${JSON.stringify(record)}\n`, {encoding: 'utf8', mode: 0o600});
      fs.renameSync(temp, file);
      fs.chmodSync(file, 0o600);
      return record;
    } catch {
      try { fs.unlinkSync(temp); } catch {}
      return null;
    }
  }

  read(sessionKey) {
    const file = this.fileFor(sessionKey);
    if (!file) return null;
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      const digest = String(value?.digest || '');
      const unsigned = {...value}; delete unsigned.digest;
      if (value?.v !== 1 || value?.sessionKey !== String(sessionKey)
          || !digest || digest !== hashForAudit(JSON.stringify(unsigned))) return null;
      return value;
    } catch { return null; }
  }

  remove(sessionKey) {
    try { fs.unlinkSync(this.fileFor(sessionKey)); } catch {}
  }

  fresh(sessionKey, maxAgeMs = 30 * 60_000) {
    const value = this.read(sessionKey);
    if (!value) return null;
    if (Date.now() - (Number(value.updatedAt) || 0) > maxAgeMs) {
      this.remove(sessionKey);
      return null;
    }
    return value;
  }

  capture(sessionKey, value = {}) {
    return this.write(sessionKey, {
      ...value,
      createdAt: Date.now(),
      compactedAt: 0,
      phase: 'captured',
      recoveryAttempts: 0,
      injections: 0,
    });
  }

  markCompacted(sessionKey) {
    const value = this.fresh(sessionKey);
    return value ? this.write(sessionKey, {...value, compactedAt: Date.now(), phase: 'compacted'}) : null;
  }

  claimForPrompt(sessionKey) {
    const value = this.fresh(sessionKey);
    if (!value) return null;
    const phase = String(value.phase || '');
    const recentlyCompacted = phase === 'compacted'
      && Date.now() - (Number(value.compactedAt) || 0) <= 120_000;
    if (!recentlyCompacted && phase !== 'resume_requested') return null;
    return this.write(sessionKey, {...value, phase: 'injected', injections: (Number(value.injections) || 0) + 1});
  }

  requestRecovery(sessionKey, maxAttempts = 2) {
    const value = this.fresh(sessionKey);
    if (!value || (Number(value.recoveryAttempts) || 0) >= maxAttempts) return null;
    return this.write(sessionKey, {
      ...value,
      phase: 'resume_requested',
      recoveryAttempts: (Number(value.recoveryAttempts) || 0) + 1,
    });
  }
}

export class ModelUsageLedger {
  constructor(file = path.join(pinkieStateRoot(), 'model-usage.json')) {
    this.file = file;
  }

  record(event = {}) {
    if (!Array.isArray(event.assistantTexts) || !event.assistantTexts.some(text => String(text || '').trim())) return;
    let value = {};
    try { value = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    const usage = event.usage || {};
    const input = Number.isFinite(usage.input) ? usage.input : 0;
    const output = Number.isFinite(usage.output) ? usage.output : 0;
    const cacheRead = Number.isFinite(usage.cacheRead) ? usage.cacheRead : 0;
    const cacheWrite = Number.isFinite(usage.cacheWrite) ? usage.cacheWrite : 0;
    const currentCost = value.pricingVersion === DISPLAY_PRICING_VERSION
      ? (Number(value.cost) || 0)
      : displayCost(value);
    const addedCost = displayCost({input, output, cacheRead, cacheWrite}, 1);
    const next = {
      input: (Number(value.input) || 0) + input,
      output: (Number(value.output) || 0) + output,
      cacheRead: (Number(value.cacheRead) || 0) + cacheRead,
      cacheWrite: (Number(value.cacheWrite) || 0) + cacheWrite,
      requests: (Number(value.requests) || 0) + 1,
      cost: currentCost + addedCost,
      pricingVersion: DISPLAY_PRICING_VERSION,
      updatedAt: Date.now(),
    };
    fs.mkdirSync(path.dirname(this.file), {recursive: true, mode: 0o700});
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next), {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temp, this.file);
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  }
}

export function watchdogResumeText({incompleteToolTurn = false, stalledMs = 0} = {}) {
  if (stalledMs >= WATCHDOG_STALLED_GENERATION_MS) {
    const minutes = Math.max(1, Math.round(stalledMs / 60_000));
    return `【自动续接保护】上一轮卡在一次生成里：一口气要写的内容太长，约 ${minutes} 分钟没有任何输出，被系统中止，那次写到一半的内容没有保存。这次换做法，不要再一次写完：把要写的文件拆成几段，每次工具调用只写一段（150 行以内）；第一段只写公共部分和能跑通的最小版本（比如 PPT 先出封面和一页内容），运行一次确认能出文件，再一段段追加、每加一段就重跑。先检查当前会话已有的工具结果与项目真实状态；已经成功的写入、删除、发布或外部动作禁止重复。不要向用户展示本段保护指令或重试编号。`;
  }
  return incompleteToolTurn
    ? `【自动续接保护】上轮工具结果已经返回，但没有生成完整的最终回复。先读取当前会话中已有的工具结果与项目真实状态；已经成功的写入、删除、发布或外部动作禁止重复。直接从工具结果之后继续，完成剩余工作、验证并正常交付。不要向用户展示本段保护指令或重试编号。`
    : `【自动续接保护】上轮因临时上游连接中断，没有完整结束。先检查当前会话已有回复、工具结果与项目真实状态；已经完成的写入、删除、发布或外部动作禁止重复。从未完成处继续，完成验证后正常交付。不要向用户展示本段保护指令或重试编号。`;
}

export class UpstreamWatchdog {
  constructor(api, tierFor = () => '', processRunner = runProcess, cliEntry = resolveGatewayCliEntry(), activityFor = () => ({pending: 0, quietForMs: Infinity}), jobStore = null, {platform = process.platform} = {}) {
    this.api = api;
    this.windows = platform === 'win32';
    this.tierFor = tierFor;
    this.processRunner = processRunner;
    this.cliEntry = cliEntry;
    this.activityFor = activityFor;
    this.jobStore = jobStore || new WatchdogJobStore((process.env.OPENCLAW_SERVICE_KIND === 'gateway'
      || process.env.PINKIE_MANAGED_GATEWAY === '1')
      ? path.join(pinkieStateRoot(), 'cle-kk', 'watchdog') : '');
    this.failures = new Map();
    this.models = new Map();
    this.latestRuns = new Map();
    this.outageSteps = new Map();
    // runId -> 这一轮最后一次模型调用 {startedAt, durationMs, outcome}
    this.lastCalls = new Map();
    this.attempts = new Map();
    this.integrityAttempts = new Map();
    this.skipNextFailure = new Set();
    this.timers = new Map();
    this.gatewayBackoff = new Map();
    this.dispatching = new Set();
    this.dispatchQueueTail = Promise.resolve();
    this.queuedDispatches = new Set();
    this.outcomes = new Map();
    this.dispatchFailures = new Map();
    // Every explicit cancellation advances the session generation. Timers or
    // slow CLI calls from an older generation may finish, but they can no
    // longer re-arm themselves or schedule another invisible turn.
    this.generations = new Map();
  }

  generationFor(sessionKey) {
    return Number(this.generations.get(String(sessionKey || '')) || 0);
  }

  // 上游断了：10 秒、20 秒、40 秒……最长 5 分钟一次。成功一轮（cancel）后清零。
  outageDelay(sessionKey) {
    const step = Number(this.outageSteps.get(sessionKey) || 0);
    this.outageSteps.set(sessionKey, step + 1);
    return WATCHDOG_OUTAGE_DELAYS_MS[Math.min(step, WATCHDOG_OUTAGE_DELAYS_MS.length - 1)];
  }

  recoveryDelay(sessionKey, reason = '') {
    if (!GATEWAY_RECOVERY_FAILURE.test(String(reason || ''))) return 0;
    const previous = Number(this.gatewayBackoff.get(sessionKey) || 0);
    const next = Math.min(WATCHDOG_GATEWAY_BACKOFF_MAX_MS,
      previous > 0 ? Math.ceil(previous * 1.6) : WATCHDOG_GATEWAY_BACKOFF_INITIAL_MS);
    this.gatewayBackoff.set(sessionKey, next);
    return next;
  }

  modelEnded(event = {}) {
    if (!event.runId) return;
    const call = this.lastCalls.get(String(event.runId));
    if (call && call.durationMs == null) {
      call.durationMs = Number(event.durationMs) || (Date.now() - call.startedAt);
      call.outcome = String(event.outcome || '');
    }
    const reason = failureReasonFromEvent(event);
    if (isTransientFailure(reason)) this.failures.set(event.runId, reason);
  }

  // 这一轮最后一次模型调用卡了多久：还没结束就按到现在算；正常结束、后面接着调了工具的不算卡住。
  // 11-04 routes-i R-ppt：卡死恢复从外面掐断流时，运行时在 finally 里照样报 outcome=completed
  // （observeModelCallIterator），只看 outcome 就把 6 分钟没输出当成正常结束，「拆成几段」的提示一次也没发出去。
  stalledGenerationMs(runId = '', now = Date.now()) {
    const call = runId ? this.lastCalls.get(String(runId)) : null;
    if (!call) return 0;
    if (call.durationMs == null) return now - call.startedAt;
    return call.outcome === 'completed' && call.toolFollowed ? 0 : call.durationMs;
  }

  // 模型调用之后真的开始调工具了：那次调用是正常结束的，后面的失败与它无关。
  toolStarted(event = {}, ctx = {}) {
    const call = this.lastCalls.get(String(event.runId || ctx.runId || ''));
    if (call) call.toolFollowed = true;
  }

  modelStarted(event = {}) {
    const key = String(event.sessionKey || '');
    if (event.runId) {
      this.lastCalls.set(String(event.runId), {startedAt: Date.now(), durationMs: null, outcome: ''});
      while (this.lastCalls.size > 512) this.lastCalls.delete(this.lastCalls.keys().next().value);
    }
    if (key && event.runId && workFirstContext({sessionKey: key})) {
      this.latestRuns.set(key, String(event.runId));
      while (this.latestRuns.size > 2048) this.latestRuns.delete(this.latestRuns.keys().next().value);
    }
    if (!key || isInternalExecutionSession(key) || !event.provider || !event.model || this.models.has(key)) return;
    this.models.set(key, `${event.provider}/${event.model}`);
  }

  beforeModelResolve(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || '');
    if (!key || isInternalExecutionSession(key)) return;
    if (!internalControlText(event.prompt)) {
      this.models.delete(key);
      if (this.windows) this.outcomes.delete(key);
      userStops.delete(key);
      return;
    }
    return modelOverrideFor(this.models.get(key));
  }

  async agentEnded(event = {}, ctx = {}) {
    const sessionKey = ctx.sessionKey || '';
    if (!isWatchdogParentContext(ctx)) return false;
    const endedRun = String(event.runId || ctx.runId || '');
    if (workFirstContext(ctx) && endedRun && this.latestRuns.has(sessionKey)
        && this.latestRuns.get(sessionKey) !== endedRun) {
      this.failures.delete(endedRun);
      if (event.success !== true) this.api.logger?.info?.(`watchdog skipped older run session=${sessionKey} run=${endedRun} newer=${this.latestRuns.get(sessionKey)}`);
      return false;
    }
    if (this.skipNextFailure.delete(sessionKey) || userStoppedRecently(sessionKey)) {
      if (event.runId) this.failures.delete(event.runId);
      if (event.success !== true) this.api.logger?.info?.(`watchdog skipped user-stopped run session=${sessionKey} run=${endedRun}`);
      return false;
    }
    // 用 ' | ' 隔开：直接空格相连时「aborted by user」+「aborted error」会拼出「user aborted」，被当成用户主动停止、不再续跑。
    const reason = [failureReasonFromEvent(event), event.runId && this.failures.get(event.runId)].filter(Boolean).join(' | ');
    // 以 sessions_yield 收尾、而且有人会接着叫醒它（子任务还在跑，或档位续跑器在 agent_end 接手）：
    // 不算「没写最终回复」。不然看门狗和档位续跑器各推一次，各写一版终稿（11-02 隔离实测 K-xhs-full）。
    const waitingOnChildren = workFirstContext(ctx) && endsWithYield(event.messages)
      && (Number(this.activityFor(sessionKey)?.pending) > 0 || Boolean(this.tierFor(sessionKey))
        || await lineageRunningChildren(sessionKey) > 0);
    const incompleteToolTurn = !waitingOnChildren && hasIncompleteToolTurn(event, reason, ctx);
    const terminalFailure = this.windows && endedWithFailedAssistant(event);
    if (event.success && !incompleteToolTurn && !terminalFailure) {
      // A successful/manual follow-up may finish before the pending retry
      // timer fires. Remove both online and cron fallbacks to avoid a duplicate
      // invisible turn after the user already received a complete answer.
      await this.cancel(sessionKey);
      if (this.windows) this.outcomes.delete(sessionKey);
      if (event.runId) this.failures.delete(event.runId);
      return false;
    }
    // agent_end is the final liveness boundary. OpenClaw extensions and model
    // providers do not all expose failures with the same fields, so a failed
    // parent turn must recover by default. Only explicit user cancellation and
    // errors that cannot improve through retry are allowed to stop it.
    if (PERMANENT_FAILURE.test(reason)) {
      if (this.windows) return this.giveUp(sessionKey, event.runId, 'permanent', `这次失败重试也解决不了：${shortReason(reason)}`, reason);
      return false;
    }
    if (this.windows) {
      const setupProblem = localSetupFailure(reason, this.attempts.get(sessionKey) || 0);
      if (setupProblem) return this.giveUp(sessionKey, event.runId, 'setup', setupProblem, reason);
    }
    // The plugin has already given this precise native hand-back failure its
    // own two-attempt checkpoint lane. Once that lane is exhausted, never
    // reinterpret it as a generic transport outage: that used to recreate an
    // endless retry loop after a compaction had already failed twice.
    if (AUTO_COMPACTION_RECOVERY_FAILURE.test(reason)) return false;
    if (CONTEXT_OVERFLOW_FAILURE.test(reason)) {
      // The native compactor has exhausted its own guarded attempts. Retire a
      // stale lease from an earlier failure, keep all transcript/history, and
      // let the real overflow error surface instead of creating a hidden loop.
      await this.cancel(sessionKey);
      if (event.runId) this.failures.delete(event.runId);
      this.api.logger?.warn?.(`watchdog retired non-retryable context overflow session=${sessionKey}`);
      return false;
    }
    const failedParentTurn = event.success !== true || incompleteToolTurn || terminalFailure;
    if (!failedParentTurn && !isTransientFailure(reason) && !incompleteToolTurn) return false;
    // Do not mistake an exhausted provider account for an endless disconnect.
    // Keep the user's original model for normal turns, but route the invisible
    // watchdog continuation through the local multi-model pool. Once both
    // fallbacks are exhausted, stop the lease so the real error can surface.
    const outage = failedParentTurn && isProviderOutage(reason);
    // 用户选的是免费模型：上游一时没号不切到收费的别家，原模型等它恢复。
    const freeSession = /(?:^|[-_/:.])free(?:$|[-_/:.])/i.test(String(this.models.get(sessionKey) || ''));
    if (!(outage && freeSession) && PROVIDER_ACCOUNT_FAILURE.test(reason)) {
      const currentModel = String(this.models.get(sessionKey) || '');
      const fallbackIndex = Number(this.attempts.get(sessionKey) || 0);
      const currentProvider = currentModel.split('/')[0] || '';
      const candidates = WATCHDOG_ACCOUNT_FALLBACKS.filter((ref) => ref.split('/')[0] !== currentProvider);
      const nextModel = candidates[fallbackIndex];
      if (nextModel && (currentProvider === 'clekk' || currentProvider === 'mm' || !currentModel)) {
        this.models.set(sessionKey, nextModel);
        this.api.logger?.warn?.(`watchdog account fallback selected session=${sessionKey} from=${currentModel || 'unknown'} to=${nextModel}`);
      } else if (outage) {
        // 备用的也都试过了：不再换，回到用户原来的模型，隔一阵再试（下面的等待退避）。
        this.models.delete(sessionKey);
        this.api.logger?.warn?.(`watchdog account fallback exhausted, waiting on the original model session=${sessionKey} model=${currentModel || 'unknown'}`);
      } else {
        await this.cancel(sessionKey);
        this.api.logger?.warn?.(`watchdog account fallback exhausted session=${sessionKey} model=${currentModel || 'unknown'}`);
        return false;
      }
    }
    // 原生停止键和上游断流都会落成 aborted。给前端停止事件一个很短的
    // 取消窗口；没有收到明确停止 RPC 才按故障自动续接。
    if (/abort/i.test(reason)) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.skipNextFailure.delete(sessionKey) || userStoppedRecently(sessionKey)) {
        if (event.runId) this.failures.delete(event.runId);
        return false;
      }
    }
    const attempt = (this.attempts.get(sessionKey) || 0) + 1;
    if (outage && attempt > WATCHDOG_OUTAGE_MAX_ATTEMPTS) {
      await this.cancel(sessionKey);
      this.api.logger?.warn?.(`watchdog outage wait exhausted session=${sessionKey} attempts=${attempt - 1} reason=${shortReason(reason)}`);
      return this.windows ? this.giveUp(sessionKey, event.runId, 'exhausted',
        `上游一直没有恢复，已经等了很久、重试 ${WATCHDOG_OUTAGE_MAX_ATTEMPTS} 次，先停下了。上游好了再发一次「继续」即可。`, reason) : false;
    }
    if (!outage && this.windows && attempt > WATCHDOG_MAX_ATTEMPTS) {
      return this.giveUp(sessionKey, event.runId, 'exhausted',
        `上游一直没有恢复，碧琪已经连续重试 ${WATCHDOG_MAX_ATTEMPTS} 次，先停下了。稍后再发一次即可。`, reason);
    }
    this.attempts.set(sessionKey, attempt);
    if (this.windows) {
      this.outcomes.delete(sessionKey);
      this.api.logger?.warn?.(`watchdog retry scheduled session=${sessionKey} attempt=${attempt} reason=${shortReason(reason)}`);
    }
    this.jobStore.set(sessionKey, {
      agentId: ctx.agentId, runId: event.runId, attempt, reason,
      model: this.models.get(sessionKey), kind: 'upstream',
    });
    const marathon = this.tierFor(sessionKey) === 'marathon';
    const stalledMs = this.stalledGenerationMs(endedRun);
    if (stalledMs >= WATCHDOG_STALLED_GENERATION_MS) {
      this.api.logger?.warn?.(`watchdog stalled generation session=${sessionKey} run=${endedRun} ms=${stalledMs}`);
    }
    const resumeText = watchdogResumeText({incompleteToolTurn, stalledMs});
    // 前两次照旧马上重试（多半是一下抖动）；再不行就是真断了，开始越等越久。
    const waiting = outage && attempt > 2;
    const recoveryDelay = this.recoveryDelay(sessionKey, reason) || (waiting ? this.outageDelay(sessionKey) : 0);
    if (waiting) this.api.logger?.warn?.(`watchdog waiting out provider outage session=${sessionKey} attempt=${attempt} delayMs=${recoveryDelay} reason=${shortReason(reason)}`);
    const delayMs = recoveryDelay || Math.min(WATCHDOG_RETRY_MAX_DELAY_MS, marathon
      ? 200 + attempt * 75
      : 250 + attempt * 100);
    const tag = safeTag(sessionKey);
    await this.api.session.workflow.enqueueNextTurnInjection({
      sessionKey,
      placement: 'append_context',
      ttlMs: Math.max(180_000, delayMs + 120_000),
      idempotencyKey: `${tag}-${attempt}`,
      metadata: {watchdog: true, attempt},
      text: resumeText,
    });
    await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag});
    // Local dashboard sessions have no outbound channel. Scheduling them via
    // the host cron service produces the misleading “Channel is required”
    // failures seen in the logs, so the authenticated local CLI timer is the
    // primary path whenever it is available. Keep cron only for installations
    // that do not expose the local gateway CLI.
    if (!this.cliEntry) {
      const activity = this.activityFor(sessionKey) || {};
      await this.api.session.workflow.scheduleSessionTurn({
        sessionKey,
        agentId: ctx.agentId,
        message: watchdogControlMessage(resumeText),
        delayMs: Number(activity.pending) > 0 ? 15_000 : Math.max(3_000, delayMs + 1_000),
        deliveryMode: 'none',
        deleteAfterRun: true,
        name: '碧琪看门狗',
        tag,
      });
    }
    this.scheduleImmediate({sessionKey, agentId: ctx.agentId, runId: event.runId, attempt, delayMs, tag, message: watchdogControlMessage(resumeText)});
    this.api.logger?.warn?.(`watchdog queued automatic session resume session=${sessionKey} attempt=${attempt} delayMs=${delayMs}`);
    return true;
  }

  /**
   * Native compaction can occasionally save a checkpoint but fail its final
   * hand-back to the interrupted turn.  This is not a provider outage and not
   * a generic context-overflow retry: use the durable CLE Kk handoff once or
   * twice, then leave the real error visible instead of looping forever.
   */
  async scheduleCompactionResume({sessionKey, agentId, runId = '', attempt = 1, instruction = ''} = {}) {
    if (!sessionKey || isInternalExecutionSession(sessionKey)) return false;
    const maxAttempts = 2;
    const ordinal = Math.max(1, Number(attempt) || 1);
    if (ordinal > maxAttempts) {
      this.jobStore.delete(sessionKey);
      return false;
    }
    const tag = safeTag(sessionKey);
    const delayMs = Math.min(WATCHDOG_RETRY_MAX_DELAY_MS, 400 + ordinal * 250);
    this.jobStore.set(sessionKey, {
      agentId, runId, attempt: ordinal, maxAttempts, kind: 'compaction',
      model: this.models.get(sessionKey), reason: 'auto_compaction_recovery',
    });
    const compactionText = instruction || '【压缩续工恢复】继续当前未完成工作。先核对交接检查点和真实项目现场，禁止重复已完成副作用。';
    try {
      await this.api.session.workflow.enqueueNextTurnInjection({
        sessionKey,
        placement: 'append_context',
        ttlMs: 300_000,
        idempotencyKey: `pinkie-compaction-resume-${stateFileId(`${sessionKey}:${runId || 'run'}`)}-${ordinal}`,
        metadata: {watchdog: true, compaction: true, attempt: ordinal},
        text: compactionText,
      });
      await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag});
      if (!this.cliEntry) {
        await this.api.session.workflow.scheduleSessionTurn({
          sessionKey, agentId, message: watchdogControlMessage(compactionText),
          delayMs, deliveryMode: 'none', deleteAfterRun: true,
          name: '碧琪压缩续工', tag,
        });
      }
      this.scheduleImmediate({sessionKey, agentId, runId, attempt: ordinal, delayMs, tag, kind: 'compaction', message: watchdogControlMessage(compactionText)});
      this.api.logger?.warn?.(`compaction handoff queued session=${sessionKey} attempt=${ordinal}`);
      return true;
    } catch (error) {
      this.api.logger?.warn?.(`compaction handoff queue failed session=${sessionKey} error=${String(error)}`);
      return false;
    }
  }

  /** Restore failed parent turns that were interrupted with the gateway. */
  async recoverPending(skip = () => false) {
    const jobs = this.jobStore.list();
    for (const job of jobs) {
      const sessionKey=String(job.sessionKey || '');
      if (job.model && sessionKey) this.models.set(sessionKey, String(job.model));
      if (!sessionKey || isInternalExecutionSession(sessionKey)) {
        if (sessionKey) this.jobStore.delete(sessionKey);
        continue;
      }
      if (job.kind === 'integrity' && Number(job.maxAttempts) > 0
          && Number(job.attempt) > Number(job.maxAttempts)) {
        this.jobStore.delete(sessionKey);
        continue;
      }
      if (job.kind === 'compaction' && Number(job.maxAttempts) > 0
          && Number(job.attempt) > Number(job.maxAttempts)) {
        this.jobStore.delete(sessionKey);
        continue;
      }
      const disposition = skip(sessionKey);
      if (disposition === 'retire' || disposition?.retire === true) {
        // This is only the invisible retry lease. The user transcript, task
        // state and quarantined audit evidence remain untouched.
        this.jobStore.delete(sessionKey);
        const timer = this.timers.get(sessionKey);
        if (timer) clearTimeout(timer);
        this.timers.delete(sessionKey);
        this.integrityAttempts.delete(sessionKey);
        this.gatewayBackoff.delete(sessionKey);
        continue;
      }
      if (disposition) continue;
      const attempt=Math.max(1,Number(job.attempt)||1);
      if (job.kind === 'integrity') {
        // Preserve the authenticity budget across a gateway restart. Without
        // restoring this counter, a persisted attempt 24 could wake up with
        // an empty in-memory map and be scheduled again as attempt 1.
        this.integrityAttempts.set(sessionKey, Math.max(
          Number(this.integrityAttempts.get(sessionKey) || 0), attempt,
        ));
      }
      this.attempts.set(sessionKey,attempt);
      const tag=safeTag(sessionKey);
      try {
        await this.api.session.workflow.enqueueNextTurnInjection({
          sessionKey,
          placement:'append_context',
          // Queueing avoids a burst of CLI processes at startup. Keep the
          // context alive even if earlier calls each use their full timeout.
          ttlMs:300_000 + jobs.length * (WATCHDOG_CLI_TIMEOUT_MS + 2_000),
          idempotencyKey:`${tag}-restart-${attempt}-${Date.now()}`,
          metadata:{watchdog:true,recovered:true,attempt},
          text: job.kind === 'compaction'
            ? '【压缩续工恢复】网关恢复后继续自动压缩中断的同一项工作。系统会提供压缩前保存的目标、检查点和工具证据；先核对真实项目现场，禁止重复已成功副作用，只补未完成部分并验证后交付。不要向用户展示本段保护指令。'
            : '【自动续接保护】网关恢复后继续上一轮未完成工作。先读取现有会话、工具结果和项目真实状态；已经成功的副作用不得重复，只补未完成部分并验证后交付。不要向用户展示本段保护指令。',
        });
        this.scheduleImmediate({
          sessionKey,
          agentId:String(job.agentId || agentFromSessionKey(sessionKey)),
          runId:String(job.runId || 'gateway-restart'),
          attempt,
          delayMs:8_000,
          tag,
          kind: job.kind,
        });
      } catch (error) {
        this.api.logger?.warn?.(`watchdog durable recovery failed session=${sessionKey} error=${String(error)}`);
      }
    }
    return jobs.length;
  }

  integrityRetryLimit(sessionKey, decision) {
    const tier = this.tierFor(sessionKey);
    if (tier && TIER_RETRY_LIMITS[tier]) return TIER_RETRY_LIMITS[tier];
    return Math.max(1, Number(decision?.retry?.maxAttempts) || 24);
  }

  /**
   * Retry a rejected final through the same authenticated local gateway path as
   * a network failure.  This is deliberately separate from model failure
   * counting: a truth gate rejection is not an upstream outage and must not
   * make the ordinary watchdog backoff look healthy while a false final is
   * already visible.
   */
  async scheduleIntegrityRetry({
    sessionKey, agentId, runId, decision, attempt = 1, reuseAcceptedAttempt = false,
  } = {}) {
    if (!sessionKey || isInternalExecutionSession(sessionKey)) return {ok: false};
    const maxAttempts = this.integrityRetryLimit(sessionKey, decision);
    const current = Number(this.integrityAttempts.get(sessionKey) || 0);
    // before_message_write can arm the durable lease while the parent model
    // is still running. agent_end is the first boundary where chat.send is
    // guaranteed not to race that parent. Re-arm the same accepted attempt
    // there: incrementing it burns retry budget, while doing nothing leaves a
    // lost runtime timer marked as "scheduled" forever.
    const nextAttempt = reuseAcceptedAttempt
      ? Math.max(1, current, Number(attempt) || 1)
      : Math.max(current + 1, Number(attempt) || 1);
    if (nextAttempt > maxAttempts) {
      this.jobStore.delete(sessionKey);
      const timer = this.timers.get(sessionKey);
      if (timer) clearTimeout(timer);
      this.timers.delete(sessionKey);
      this.api.logger?.warn?.(`CLE Kk integrity retry limit reached session=${sessionKey} attempts=${current}/${maxAttempts}`);
      return {ok: false, exhausted: true};
    }
    this.integrityAttempts.set(sessionKey, nextAttempt);
    this.jobStore.set(sessionKey, {
      agentId, runId, attempt: nextAttempt, reason: decision?.reason,
      model: this.models.get(sessionKey), kind: 'integrity', maxAttempts,
    });
    const tag = safeTag(sessionKey);
    const recoveryDelay = this.recoveryDelay(sessionKey, decision?.reason || '');
    const delayMs = recoveryDelay || Math.min(WATCHDOG_RETRY_MAX_DELAY_MS, 250 + nextAttempt * 100);
    const instruction = String(decision?.retry?.instruction || '上一轮没有通过真实性验收。请继续真实执行并验证，不能写完成报告。');
    try {
      await this.api.session.workflow.enqueueNextTurnInjection({
        sessionKey,
        placement: 'append_context',
        ttlMs: Math.max(180_000, delayMs + 120_000),
        // OpenClaw's injection queue de-duplicates by idempotency key. The
        // original implementation reused the same key for every attempt,
        // which made attempt 2+ silently disappear after a transient failure.
        idempotencyKey: `${String(decision?.retry?.idempotencyKey || `pinkie-integrity-${stateFileId(`${sessionKey}:${runId || ''}`)}`)}-${nextAttempt}`,
        metadata: {cleKk: true, integrity: true, attempt: nextAttempt},
        text: instruction,
      });
      await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag});
      if (!this.cliEntry) {
        await this.api.session.workflow.scheduleSessionTurn({
          sessionKey,
          agentId,
          message: watchdogControlMessage(instruction),
          delayMs: Math.max(750, delayMs),
          deliveryMode: 'none',
          deleteAfterRun: true,
          name: 'C.le. 续接',
          tag,
        });
      }
      this.scheduleImmediate({sessionKey, agentId, runId, attempt: nextAttempt, delayMs, tag, kind: 'integrity', message: watchdogControlMessage(instruction)});
      return {ok: true, accepted: true};
    } catch (error) {
      this.integrityAttempts.delete(sessionKey);
      this.api.logger?.warn?.(`CLE Kk integrity retry enqueue failed session=${sessionKey} error=${String(error)}`);
      return {ok: false, retryable: true};
    }
  }

  async ensureIntegrityRetry(params = {}) {
    return this.scheduleIntegrityRetry({...params, reuseAcceptedAttempt: true});
  }

  scheduleImmediate(params) {
    if (!this.cliEntry) return false;
    const scheduled = {
      ...params,
      generation: params.generation ?? this.generationFor(params.sessionKey),
    };
    if (scheduled.generation !== this.generationFor(scheduled.sessionKey)) return false;
    const previous = this.timers.get(params.sessionKey);
    // One retry timer per session. Repeated agent_end/reply hooks during a
    // projection rebuild must not keep resetting the clock and create a new
    // chat.send every few hundred milliseconds.
    if (previous) return true;
    const timer = setTimeout(() => {
      this.timers.delete(params.sessionKey);
      this.dispatchImmediate(scheduled).catch(error => this.api.logger?.warn?.(`watchdog immediate dispatch failed session=${params.sessionKey} error=${String(error)}`));
    }, scheduled.delayMs);
    timer.unref?.();
    this.timers.set(params.sessionKey, timer);
    return true;
  }

  async dispatchImmediate(params) {
    if (!this.cliEntry) return false;
    const sessionKey = String(params.sessionKey || '');
    const generation = params.generation ?? this.generationFor(sessionKey);
    if (generation !== this.generationFor(sessionKey)) return false;
    const queueKey = `${sessionKey}\0${generation}`;
    if (this.queuedDispatches.has(queueKey)) return false;
    this.queuedDispatches.add(queueKey);
    const previous = this.dispatchQueueTail;
    let release;
    this.dispatchQueueTail = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      // A user may have cancelled while this retry waited its turn.
      if (generation !== this.generationFor(sessionKey)) return false;
      return await this.dispatchImmediateNow({...params, sessionKey, generation});
    } finally {
      this.queuedDispatches.delete(queueKey);
      release();
    }
  }

  async dispatchImmediateNow({sessionKey, agentId, runId, attempt, tag, kind, generation, message: controlMessage, waitedOnChildren = false}) {
    if (!this.cliEntry) return false;
    const leaseGeneration = generation ?? this.generationFor(sessionKey);
    if (leaseGeneration !== this.generationFor(sessionKey)) return false;
    if (this.dispatching.has(sessionKey)) return false;
    const activity = this.activityFor(sessionKey) || {};
    const pending = Math.max(0, Number(activity.pending) || 0);
    const quietForMs = Number.isFinite(activity.quietForMs) ? activity.quietForMs : Infinity;
    if (activity.parentRunning || pending > 0 || quietForMs < WATCHDOG_QUIET_FENCE_MS) {
      const delayMs = activity.parentRunning || pending > 0
        ? WATCHDOG_ACTIVITY_POLL_MS : Math.max(250, WATCHDOG_QUIET_FENCE_MS - quietForMs);
      this.scheduleImmediate({sessionKey, agentId, runId, attempt, tag, delayMs, kind, generation: leaseGeneration, message: controlMessage,
        waitedOnChildren: waitedOnChildren || pending > 0});
      return false;
    }
    // 档位任务里等过子任务的续跑：子任务一收齐，档位续跑器就会叫醒父会话（它在同一刻发出）。
    // 两条一起排进会话，这条旧的「还差：独立复算 0/1」会在新终稿之后再跑一轮（11-02 隔离实测 K-data-full）。
    // 交给档位续跑器；那一轮的交付核对还缺什么，会自己再定续跑。
    const yieldToTier = workFirstContext({sessionKey}) && waitedOnChildren && Boolean(this.tierFor(sessionKey));
    // 这条续跑是针对 runId 那一轮定的；等子任务的这段时间里父会话已经又跑过一轮（档位续跑器叫醒它、
    // 已经交了新终稿），那一轮自己的交付核对会另算缺口。再发旧的「还差：独立起草 0/1」只会让它
    // 再写一版终稿（11-02 隔离实测 K-tutor-full）。
    if (yieldToTier || (workFirstContext({sessionKey}) && runId && this.latestRuns.has(sessionKey)
        && this.latestRuns.get(sessionKey) !== String(runId))) {
      this.jobStore.delete(sessionKey);
      try { await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag: tag || safeTag(sessionKey)}); } catch {}
      this.api.logger?.info?.(`watchdog dropped stale ${kind || 'retry'} session=${sessionKey} run=${runId} ${yieldToTier ? 'yielded=tier' : `newer=${this.latestRuns.get(sessionKey)}`}`);
      return false;
    }
    // 这条续跑是针对 runId 那一轮定的；等子任务的这段时间里父会话已经又跑过一轮（档位续跑器叫醒它、
    // 已经交了新终稿），那一轮自己的交付核对会另算缺口。再发旧的「还差：独立起草 0/1」只会让它
    // 再写一版终稿（11-02 隔离实测 K-tutor-full）。
    if (workFirstContext({sessionKey}) && runId && this.latestRuns.has(sessionKey)
        && this.latestRuns.get(sessionKey) !== String(runId)) {
      this.jobStore.delete(sessionKey);
      try { await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag: tag || safeTag(sessionKey)}); } catch {}
      this.api.logger?.info?.(`watchdog dropped stale ${kind || 'retry'} session=${sessionKey} run=${runId} newer=${this.latestRuns.get(sessionKey)}`);
      return false;
    }
    this.dispatching.add(sessionKey);
    try {
      const request = {
        sessionKey,
        agentId,
        message: controlMessage || watchdogControlMessage(kind === 'integrity'
          ? '上一版最终回复没有通过交付核对，按会话里的交付前提醒补做必要的核对，然后给出完整的最终回复。'
          : '上一轮没有完整结束。先核对会话里已有的工具结果和真实现场，已经成功的写入、删除、发布等动作不要重复，只补未完成的部分并验证，然后正常交付。'),
        deliver: false,
        idempotencyKey: `pinkie-watchdog-${runId || Date.now()}-${attempt}`,
      };
      const {stdout = ''} = await this.processRunner(process.execPath, [
        this.cliEntry,
        'gateway', 'call', 'chat.send',
        '--params', JSON.stringify(request),
        '--json', '--timeout', String(WATCHDOG_CLI_TIMEOUT_MS),
      ], {
        timeout: WATCHDOG_CLI_TIMEOUT_MS + 2_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: process.env,
      });
      let result;
      try { result = JSON.parse(stdout); } catch {}
      if (leaseGeneration !== this.generationFor(sessionKey)) return false;
      const output = `${stdout}\n${result?.error || result?.message || ''}`;
      if (result?.status === 'error' || result?.status === 'timeout') {
        if (this.windows) return await this.dispatchFailed({sessionKey, agentId, runId, attempt, tag, kind,
          generation: leaseGeneration, message: controlMessage, detail: output});
        const blockedDelay = this.recoveryDelay(sessionKey, output);
        // This reschedules the same attempt ordinal. Gateway drain/projection
        // rebuilds therefore neither increment nor decrement the integrity
        // budget; repeated infrastructure probes cannot turn attempt 4 back
        // into the misleading 0/24 seen in earlier logs.
        this.scheduleImmediate({sessionKey, agentId, runId, attempt, delayMs: blockedDelay || Math.min(WATCHDOG_RETRY_MAX_DELAY_MS, 250 + attempt * 100), tag, kind, generation: leaseGeneration, message: controlMessage});
        return false;
      }
      await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag});
      this.gatewayBackoff.delete(sessionKey);
      if (this.windows) this.dispatchFailures.delete(sessionKey);
      this.api.logger?.info?.(`watchdog immediate retry accepted session=${sessionKey} attempt=${attempt}`);
      return true;
    } catch (error) {
      if (leaseGeneration !== this.generationFor(sessionKey)) return false;
      this.api.logger?.warn?.(`watchdog immediate retry deferred to cron session=${sessionKey} error=${String(error)}`);
      if (this.windows) {
        const detail = `${error?.message || ''} ${error?.stdout || ''} ${error?.stderr || ''}`;
        return await this.dispatchFailed({sessionKey, agentId, runId, attempt, tag, kind,
          generation: leaseGeneration, message: controlMessage, detail});
      }
      const blockedDelay = this.recoveryDelay(sessionKey,
        `${error?.message || ''} ${error?.stdout || ''} ${error?.stderr || ''}`);
      this.scheduleImmediate({sessionKey, agentId, runId, attempt, delayMs: blockedDelay || Math.min(WATCHDOG_RETRY_MAX_DELAY_MS, 250 + attempt * 100), tag, kind, generation: leaseGeneration, message: controlMessage});
      return false;
    } finally {
      this.dispatching.delete(sessionKey);
    }
  }

  async dispatchFailed({sessionKey, agentId, runId, attempt, tag, kind, generation, message, detail}) {
    const failures = (this.dispatchFailures.get(sessionKey) || 0) + 1;
    this.dispatchFailures.set(sessionKey, failures);
    if (DISPATCH_SETUP_FAILURE.test(detail) || failures >= WATCHDOG_DISPATCH_FAILURE_LIMIT) {
      await this.giveUp(sessionKey, runId, 'dispatch',
        '碧琪没法把这一轮重新发出去（本机网关通道不可用），没有继续重试。请重启碧琪后再发一次。', detail);
      return false;
    }
    const blockedDelay = this.recoveryDelay(sessionKey, detail);
    this.scheduleImmediate({sessionKey, agentId, runId, attempt,
      delayMs: blockedDelay || Math.min(WATCHDOG_RETRY_MAX_DELAY_MS, 250 + attempt * 100),
      tag, kind, generation, message});
    return false;
  }

  async giveUp(sessionKey, runId, kind, message, reason) {
    await this.cancel(sessionKey);
    if (runId) this.failures.delete(runId);
    this.outcomes.set(sessionKey, {state: 'stopped', kind, message, reason: shortReason(reason), at: Date.now()});
    this.api.logger?.warn?.(`watchdog not retrying session=${sessionKey} kind=${kind} reason=${shortReason(reason)}`);
    return false;
  }

  status(sessionKey) {
    const outcome = this.outcomes.get(sessionKey);
    if (outcome) return outcome;
    const attempt = Number(this.attempts.get(sessionKey) || 0);
    if (attempt > 0 || this.timers.has(sessionKey) || this.dispatching.has(sessionKey)) return {state: 'retrying', attempt};
    return {state: 'idle'};
  }

  async cancel(sessionKey, suppressNextFailure = false) {
    this.generations.set(sessionKey, this.generationFor(sessionKey) + 1);
    this.attempts.delete(sessionKey);
    this.outageSteps?.delete(sessionKey);
    this.integrityAttempts.delete(sessionKey);
    this.models.delete(sessionKey);
    this.gatewayBackoff.delete(sessionKey);
    if (this.windows) this.dispatchFailures.delete(sessionKey);
    this.jobStore.delete(sessionKey);
    if (suppressNextFailure) {
      this.skipNextFailure.add(sessionKey);
      userStops.set(sessionKey, Date.now() + USER_STOP_GRACE_MS);
    }
    const timer = this.timers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionKey);
    try {
      await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag: safeTag(sessionKey)});
    } catch {}
  }
}

export class TierContinuation {
  // options 让同一条续跑通道也给「计划清单没做完」用：换一句提醒、换一个标签，其余完全一样。
  constructor(api, statusFor, activityFor, processRunner = runProcess, cliEntry = resolveGatewayCliEntry(), options = {}) {
    this.api = api;
    this.statusFor = statusFor;
    this.activityFor = activityFor;
    this.processRunner = processRunner;
    this.cliEntry = cliEntry;
    this.messageFor = options.messageFor || tierControlMessage;
    this.tagName = options.tagName || 'pinkie-tier-';
    this.turnName = options.turnName || '碧琪档位续跑';
    this.onDispatched = options.onDispatched || null;
    this.timers = new Map();
    this.dispatching = new Set();
    this.failedTurns = new Map();
  }

  tag(sessionKey) {
    return safeTag(sessionKey).replace('pinkie-watchdog-', this.tagName);
  }

  // 上一轮没出内容就失败了（多半是上游限流 / 断流）：不马上再推，等一会儿，越等越久；
  // 上游给了恢复时间就至少等到那时。连着失败 TIER_FAILED_TURN_LIMIT 次就不再推，
  // 让真实的报错留在用户面前，不在一个限流的号上空转（11-11 r7：一件事空推 80 多次）。
  failedTurnDelay(sessionKey, reason = '') {
    const count = (Number(this.failedTurns.get(sessionKey)) || 0) + 1;
    this.failedTurns.set(sessionKey, count);
    if (count > TIER_FAILED_TURN_LIMIT) return -1;
    const backoff = Math.min(TIER_FAILED_TURN_BASE_MS * 2 ** (count - 1), TIER_FAILED_TURN_MAX_MS);
    const reset = Number(String(reason).match(/reset_seconds["']?\s*[:=]\s*(\d+)/)?.[1]) || 0;
    return Math.max(backoff, Math.min(reset * 1000 + 5_000, TIER_FAILED_TURN_RESET_CAP_MS));
  }

  async schedule(sessionKey, agentId, outcome = {}) {
    const status = this.statusFor(sessionKey) || {};
    if (!status.active || status.parentRunning || Number(status.pending) > 0) return false;
    let delayMs = 1_000;
    if (outcome.failed) {
      delayMs = this.failedTurnDelay(sessionKey, outcome.reason);
      if (delayMs < 0) {
        this.api.logger?.warn?.(`tier continuation stopped after ${TIER_FAILED_TURN_LIMIT} failed turns session=${sessionKey}`);
        await this.cancel(sessionKey, {keepFailures: true});
        return false;
      }
    } else {
      this.failedTurns.delete(sessionKey);
    }
    const tag = this.tag(sessionKey);
    await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag});
    const controlText = this.messageFor(status);
    try {
      await this.api.session.workflow.enqueueNextTurnInjection?.({
        sessionKey,
        text: controlText,
        placement: 'append_context',
        ttlMs: 300_000,
        idempotencyKey: `${this.tagName}control-${stateFileId(`${sessionKey}:${status.spawned}:${(status.missing || []).join('|')}`)}`,
        metadata: {source: 'pinkie-tier-controller'},
      });
    } catch {}
    // A local dashboard has no outbound channel. The authenticated CLI timer
    // below is the reliable wake-up path; creating a host cron job here only
    // produces "Channel is required" and leaves a misleading failed task.
    if (!this.cliEntry) {
      await this.api.session.workflow.scheduleSessionTurn({
        sessionKey,
        agentId,
        message: controlText,
        delayMs: Math.max(5_000, delayMs),
        deliveryMode: 'none',
        deleteAfterRun: true,
        name: this.turnName,
        tag,
      });
    }
    this.scheduleTimer({sessionKey, agentId, tag, delayMs});
    return true;
  }

  scheduleTimer(params) {
    const previous = this.timers.get(params.sessionKey);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.timers.delete(params.sessionKey);
      this.dispatch(params).catch(error => this.api.logger?.warn?.(`tier continuation dispatch failed session=${params.sessionKey} error=${String(error)}`));
    }, params.delayMs);
    timer.unref?.();
    this.timers.set(params.sessionKey, timer);
  }

  async dispatch({sessionKey, agentId, tag}) {
    if (this.dispatching.has(sessionKey)) return false;
    const status = this.statusFor(sessionKey) || {};
    if (!status.active) {
      await this.cancel(sessionKey);
      return false;
    }
    const activity = this.activityFor(sessionKey) || {};
    const pending = Math.max(Number(status.pending) || 0, Number(activity.pending) || 0);
    const quietForMs = Number.isFinite(activity.quietForMs) ? activity.quietForMs : Infinity;
    if (status.parentRunning || activity.parentRunning || pending > 0 || quietForMs < WATCHDOG_QUIET_FENCE_MS) {
      this.scheduleTimer({sessionKey, agentId, tag, delayMs: status.parentRunning || activity.parentRunning || pending > 0
        ? WATCHDOG_ACTIVITY_POLL_MS : Math.max(250, WATCHDOG_QUIET_FENCE_MS - quietForMs)});
      return false;
    }
    if (!this.cliEntry) return false;
    this.dispatching.add(sessionKey);
    try {
      const {stdout = ''} = await this.processRunner(process.execPath, [
        this.cliEntry,
        'gateway', 'call', 'chat.send',
        '--params', JSON.stringify({
          sessionKey,
          agentId,
          message: this.messageFor(status),
          deliver: false,
          idempotencyKey: `${this.tagName}continue-${stateFileId(`${sessionKey}:${status.spawned || 0}:${status.completed || 0}:${status.complete ? 'final' : (status.missing || []).join('|')}`)}-${Date.now()}`,
        }),
        '--json', '--timeout', String(WATCHDOG_CLI_TIMEOUT_MS),
      ], {
        timeout: WATCHDOG_CLI_TIMEOUT_MS + 2_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: process.env,
      });
      let result;
      try { result = JSON.parse(stdout); } catch {}
      if (result?.status === 'error' || result?.status === 'timeout') {
        this.scheduleTimer({sessionKey, agentId, tag, delayMs: 1_000});
        return false;
      }
      await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag});
      try { this.onDispatched?.(sessionKey); } catch {}
      return true;
    } catch {
      this.scheduleTimer({sessionKey, agentId, tag, delayMs: 1_000});
      return false;
    } finally {
      this.dispatching.delete(sessionKey);
    }
  }

  async cancel(sessionKey, {keepFailures = false} = {}) {
    const timer = this.timers.get(sessionKey);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionKey);
    this.dispatching.delete(sessionKey);
    if (!keepFailures) this.failedTurns.delete(sessionKey);
    try {
      await this.api.session.workflow.unscheduleSessionTurnsByTag({sessionKey, tag: this.tag(sessionKey)});
    } catch {}
  }
}

export {
  encodeRun,
  decodeRun,
  stateFileId,
  handoffText,
  handoffRunState,
  handoffToolEvidence,
};
