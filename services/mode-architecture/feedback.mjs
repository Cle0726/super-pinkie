// 正式版「使用场景 + 纠错记录」匿名摘要收集、本机队列、脱敏、加密与批量上报。
//
// 隐私与安全底线：
// 1. 默认关闭，必须用户在界面明确同意后才记录与上报；开发版永不上传（仅可开「只写本机」调试）。
// 2. 绝不记录或上传聊天原文、文件内容、路径用户名、密钥、网址参数、称呼与姓名。
// 3. 所有记录先落本机 <应用状态目录>/feedback/，攒批（满 50 条或每 24 小时）用作者公钥加密后再发。
// 4. 断网、令牌失效、仓库不可用时安静保留队列、自动退避，绝不影响正常聊天和任务。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyModelFailure, turnFailed} from './model-health.mjs';
import {findBundleRoot, guardMode} from './settings-guard.mjs';
import {classifyWorkKind} from './work-kinds.mjs';
import {encryptFeedbackEnvelope, parseFeedbackPublicKey} from './feedback-crypto.mjs';
import {
  classifyFeedbackRule,
  detectUserCorrection,
  sanitizeFeedbackRecord,
  sanitizeModelRef,
  sanitizeToolName,
  sanitizeWorkKind,
} from './feedback-sanitize.mjs';
import {createFeedbackTransport, makeBatchFilePath} from './feedback-transport.mjs';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_QUEUE = 500;
const TRANSIENT_BACKOFF_MS = 15 * 60 * 1000;
const AUTH_BACKOFF_MS = 6 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 10_000;

const PUBLIC_DEFAULTS_URL = new URL('./feedback-public.json', import.meta.url);

export function resolveFeedbackRoot({
  stateRoot = '',
  env = process.env,
  home = os.homedir(),
  platform = process.platform,
} = {}) {
  if (stateRoot) return path.join(stateRoot, 'feedback');
  if (env.PINKIE_STATE_ROOT) return path.join(env.PINKIE_STATE_ROOT, 'feedback');
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SuperPinkie', 'feedback');
  }
  return path.join(home, 'Library', 'Application Support', 'SuperPinkie', 'feedback');
}

function readJsonSafe(file) {
  try {
    if (!file || fs.lstatSync(file).isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readPublicDefaults() {
  try {
    return JSON.parse(fs.readFileSync(PUBLIC_DEFAULTS_URL, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function readFeedbackBuildConfig({
  mode = null,
  entry = process.argv[1],
  env = process.env,
} = {}) {
  const resolvedMode = mode || guardMode({entry});
  const isRelease = resolvedMode.channel === 'release';
  const bundleRoot = resolvedMode.bundleRoot || findBundleRoot(env.PINKIE_OPENCLAW_ENTRY);
  const buildInfo = bundleRoot ? readJsonSafe(path.join(bundleRoot, 'build-info.json')) : null;
  const bundleFb = buildInfo?.feedback && typeof buildInfo.feedback === 'object' ? buildInfo.feedback : {};
  const defaults = readPublicDefaults();

  return {
    channel: resolvedMode.channel === 'release' ? 'release' : 'dev',
    isRelease,
    version: String(resolvedMode.version || buildInfo?.version || '').trim(),
    repo: String(bundleFb.repo || defaults.repo || '').trim(),
    publicKey: String(bundleFb.publicKey || defaults.publicKey || '').trim(),
    endpoint: String(bundleFb.endpoint || defaults.endpoint || '').trim(),
    // 令牌只在正式版打包时注入 build-info.json，开发版绝不使用上传凭据。
    token: isRelease ? String(bundleFb.token || '').trim() : '',
  };
}

function atomicWriteJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  try {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) return false;
  } catch {}
  const temp = path.join(dir, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  fs.renameSync(temp, file);
  return true;
}

const DEFAULT_PREFS = Object.freeze({
  version: 1,
  asked: false,
  consent: false,
  localDebug: false,
  updatedAt: 0,
  lastUploadAt: 0,
  lastErrorAt: 0,
  lastErrorCode: '',
  backoffUntil: 0,
  uploadedCount: 0,
});

export class FeedbackStore {
  constructor(root, {maxQueue = DEFAULT_MAX_QUEUE} = {}) {
    this.root = root;
    this.prefsFile = path.join(root, 'prefs.json');
    this.queueFile = path.join(root, 'queue.json');
    this.maxQueue = Math.max(10, Number(maxQueue) || DEFAULT_MAX_QUEUE);
  }

  readPrefs() {
    const raw = readJsonSafe(this.prefsFile);
    if (!raw || typeof raw !== 'object') return {...DEFAULT_PREFS};
    return {
      ...DEFAULT_PREFS,
      asked: Boolean(raw.asked),
      consent: Boolean(raw.consent),
      localDebug: Boolean(raw.localDebug),
      updatedAt: Number(raw.updatedAt) || 0,
      lastUploadAt: Number(raw.lastUploadAt) || 0,
      lastErrorAt: Number(raw.lastErrorAt) || 0,
      lastErrorCode: typeof raw.lastErrorCode === 'string' ? raw.lastErrorCode.slice(0, 32) : '',
      backoffUntil: Number(raw.backoffUntil) || 0,
      uploadedCount: Math.max(0, Number(raw.uploadedCount) || 0),
    };
  }

  writePrefs(next) {
    const merged = {...DEFAULT_PREFS, ...next, version: 1};
    atomicWriteJson(this.prefsFile, merged);
    return merged;
  }

  readQueue() {
    const raw = readJsonSafe(this.queueFile);
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return items.map(item => sanitizeFeedbackRecord(item));
  }

  writeQueue(items) {
    const normalized = Array.isArray(items)
      ? items.slice(-this.maxQueue).map(item => sanitizeFeedbackRecord(item))
      : [];
    atomicWriteJson(this.queueFile, {version: 1, items: normalized});
    return normalized;
  }

  enqueue(record) {
    const clean = sanitizeFeedbackRecord(record);
    const items = this.readQueue();
    items.push(clean);
    const saved = this.writeQueue(items);
    return {record: clean, count: saved.length};
  }

  replaceItem(id, updater) {
    if (!id) return false;
    const items = this.readQueue();
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return false;
    const updated = sanitizeFeedbackRecord(updater(items[index]));
    items[index] = updated;
    this.writeQueue(items);
    return true;
  }

  removeIds(ids) {
    const drop = new Set(ids);
    if (!drop.size) return 0;
    const items = this.readQueue();
    const remaining = items.filter(item => !drop.has(item.id));
    if (remaining.length !== items.length) this.writeQueue(remaining);
    return items.length - remaining.length;
  }

  clearQueue() {
    const current = this.readQueue();
    this.writeQueue([]);
    return current.length;
  }
}

export function samplePreviewRecord({version = '2.5.49', channel = 'release', platform = process.platform, arch = process.arch} = {}) {
  return sanitizeFeedbackRecord({
    id: '00000000-0000-0000-0000-000000000000',
    type: 'usage',
    at: new Date().toISOString().slice(0, 16) + ':00.000Z',
    appVersion: version || '2.5.49',
    channel,
    platform,
    arch,
    mode: 'project',
    workKind: 'code',
    workKinds: ['code'],
    tools: ['read', 'edit', 'exec'],
    failedTools: [],
    toolCalls: 3,
    outcome: 'success',
    errorKind: '',
    durationMs: 4200,
    model: 'provider/example-model',
    retried: false,
  });
}

function minuteStamp(ms) {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 16)}:00.000Z`;
}

function promptFingerprint(prompt = '') {
  return crypto.createHash('sha256').update(String(prompt || '').trim()).digest('hex').slice(0, 16);
}

export class FeedbackManager {
  constructor(options = {}) {
    this.root = options.root || resolveFeedbackRoot();
    this.store = new FeedbackStore(this.root, {maxQueue: options.maxQueue});
    this.now = options.now || (() => Date.now());
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE);
    this.flushIntervalMs = Math.max(60_000, Number(options.flushIntervalMs) || DEFAULT_FLUSH_INTERVAL_MS);
    this.logger = options.logger || null;

    const mode = options.mode || guardMode();
    const detected = readFeedbackBuildConfig({mode});
    const override = options.buildConfig && typeof options.buildConfig === 'object' ? options.buildConfig : {};
    this.channel = (override.channel ?? detected.channel) === 'release' ? 'release' : 'dev';
    this.isRelease = this.channel === 'release';
    this.appVersion = String(override.version ?? detected.version ?? '0.0.0').trim() || '0.0.0';
    this.publicKeyInput = String(override.publicKey ?? detected.publicKey ?? '').trim();
    this.publicKey = null;
    if (this.publicKeyInput) {
      try { this.publicKey = parseFeedbackPublicKey(this.publicKeyInput); } catch { this.publicKey = null; }
    }
    this.transport = options.transport || createFeedbackTransport({
      repo: override.repo ?? detected.repo ?? '',
      token: this.isRelease ? String(override.token ?? detected.token ?? '').trim() : '',
      endpoint: override.endpoint ?? detected.endpoint ?? '',
      githubApiBase: override.githubApiBase,
    }, {fetchFn: options.fetchFn, appVersion: this.appVersion});

    this.activeTurns = new Map();
    this.lastSessionTurn = new Map();
    this.runModels = new Map();
    this.flushing = null;
    this.timer = null;
  }

  isRecordingEnabled() {
    const prefs = this.store.readPrefs();
    return this.isRelease ? prefs.consent === true : prefs.localDebug === true;
  }

  canUpload() {
    if (!this.isRelease) return false;
    const prefs = this.store.readPrefs();
    return prefs.consent === true && Boolean(this.publicKey) && Boolean(this.transport?.configured);
  }

  status() {
    const prefs = this.store.readPrefs();
    const queue = this.store.readQueue();
    return {
      ok: true,
      channel: this.channel,
      isRelease: this.isRelease,
      asked: prefs.asked,
      consent: this.isRelease ? prefs.consent : false,
      localDebug: !this.isRelease ? prefs.localDebug : false,
      recording: this.isRelease ? prefs.consent : prefs.localDebug,
      canUpload: this.canUpload(),
      transportConfigured: Boolean(this.transport?.configured),
      publicKeyConfigured: Boolean(this.publicKey),
      transportKind: this.transport?.kind || 'none',
      queueCount: queue.length,
      uploadedCount: prefs.uploadedCount,
      lastUploadAt: prefs.lastUploadAt,
      lastErrorAt: prefs.lastErrorAt,
      lastErrorCode: prefs.lastErrorCode,
    };
  }

  setPrefs(params = {}) {
    const current = this.store.readPrefs();
    const next = {...current, updatedAt: this.now()};
    if (this.isRelease) {
      if (typeof params.consent === 'boolean') {
        next.consent = params.consent;
        next.asked = true;
      }
      if (typeof params.asked === 'boolean') next.asked = params.asked;
    } else {
      // 开发版永不开启网络上报，只允许切换「只写本机」调试开关。
      next.consent = false;
      if (typeof params.localDebug === 'boolean') next.localDebug = params.localDebug;
      if (typeof params.asked === 'boolean') next.asked = params.asked;
    }
    this.store.writePrefs(next);
    if (this.canUpload()) void this.maybeAutoFlush();
    return this.status();
  }

  preview() {
    const items = this.store.readQueue();
    const sample = samplePreviewRecord({
      version: this.appVersion,
      channel: this.channel,
      platform: this.platform,
      arch: this.arch,
    });
    return {
      ok: true,
      count: items.length,
      items: items.slice(-this.batchSize).reverse(),
      sample,
      status: this.status(),
    };
  }

  clear() {
    const cleared = this.store.clearQueue();
    return {ok: true, cleared, status: this.status()};
  }

  onUserPrompt({sessionKey = '', mode = 'chat', prompt = '', runId = ''} = {}) {
    try {
      const key = String(sessionKey || '').trim();
      const text = String(prompt || '').trim();
      if (!key || !text || /:subagent:/.test(key)) return;
      const now = this.now();
      const fp = promptFingerprint(text);
      const existing = this.activeTurns.get(key);
      // message_received 与 before_prompt_build 可能先后到达同一条消息：按指纹短窗去重。
      if (existing && existing.promptFp === fp && now - existing.startedAt < DEDUP_WINDOW_MS) {
        if (runId && !existing.runId) existing.runId = String(runId);
        return;
      }
      const classified = classifyWorkKind(text, {mode});
      const turn = {
        sessionKey: key,
        mode: mode || 'chat',
        startedAt: now,
        promptFp: fp,
        runId: String(runId || ''),
        workKind: sanitizeWorkKind(classified?.kind),
        workKinds: Array.isArray(classified?.kinds) ? classified.kinds.slice(0, 3) : [],
        tools: new Set(),
        failedTools: new Set(),
        toolCalls: 0,
        model: '',
        retried: false,
        correctionId: '',
      };
      this.activeTurns.set(key, turn);
      if (this.activeTurns.size > 256) {
        const oldest = this.activeTurns.keys().next().value;
        if (oldest) this.activeTurns.delete(oldest);
      }

      if (!this.isRecordingEnabled()) return;
      const prior = this.lastSessionTurn.get(key) || null;
      const correction = detectUserCorrection(text, {
        hasPriorTurn: Boolean(prior),
        mode: turn.mode,
        prevWorkKind: prior?.workKind || 'unknown',
        prevTools: prior?.tools || [],
        prevOutcome: prior?.outcome || 'success',
      });
      if (correction) {
        const id = crypto.randomUUID();
        // 记落盘后的 id（enqueue 会先过 sanitizeFeedbackRecord），保证之后 replaceItem 能按同一个 id 找到它。
        const {record} = this.store.enqueue({
          id,
          type: 'correction',
          at: minuteStamp(now),
          appVersion: this.appVersion,
          channel: this.channel,
          platform: this.platform,
          arch: this.arch,
          model: prior?.model || 'unknown',
          ...correction,
        });
        turn.correctionId = record.id;
      }
    } catch {}
  }

  onModelStarted(event = {}) {
    try {
      const model = event.provider && event.model ? sanitizeModelRef(`${event.provider}/${event.model}`) : '';
      if (!model || !event.runId) return;
      this.runModels.set(String(event.runId), model);
      if (this.runModels.size > 512) {
        const oldest = this.runModels.keys().next().value;
        if (oldest) this.runModels.delete(oldest);
      }
      for (const turn of this.activeTurns.values()) {
        if (turn.runId && turn.runId === String(event.runId)) turn.model = model;
      }
    } catch {}
  }

  onModelEnded(event = {}) {
    try {
      const model = event.provider && event.model ? sanitizeModelRef(`${event.provider}/${event.model}`) : '';
      if (model && event.runId) this.runModels.set(String(event.runId), model);
    } catch {}
  }

  onToolAfter(event = {}, ctx = {}) {
    try {
      const key = String(ctx.sessionKey || event.sessionKey || '').trim();
      if (!key || /:subagent:/.test(key)) return;
      const toolName = sanitizeToolName(event.toolName || event.name || '');
      const failed = Boolean(event.error || event.isError || event.result?.isError);
      const turn = this.activeTurns.get(key);
      if (turn && toolName) {
        turn.tools.add(toolName);
        if (failed) turn.failedTools.add(toolName);
        turn.toolCalls += 1;
      }

      if (!failed && toolName === 'clekk_memory' && event.params?.action === 'remember' && event.params?.kind === 'feedback') {
        if (!this.isRecordingEnabled()) return;
        const prior = this.lastSessionTurn.get(key) || null;
        const mode = turn?.mode || 'chat';
        const classified = classifyFeedbackRule(String(event.params?.text || ''), {
          mode,
          prevWorkKind: prior?.workKind || turn?.workKind || 'unknown',
          prevTools: prior?.tools || [],
          prevOutcome: prior?.outcome || 'success',
        });
        if (!classified) return;
        if (turn?.correctionId) {
          this.store.replaceItem(turn.correctionId, existing => ({
            ...existing,
            source: 'both',
            mistakeKind: classified.mistakeKind !== 'factual_or_logic_error' ? classified.mistakeKind : existing.mistakeKind,
            correctionDirection: classified.correctionDirection !== 'redo_or_fix' ? classified.correctionDirection : existing.correctionDirection,
            tags: [...new Set([...(existing.tags || []), ...classified.tags])].slice(0, 6),
          }));
        } else {
          const id = crypto.randomUUID();
          // 同 onUserPrompt：记落盘后的 id，保证内存和磁盘里的 correctionId 一致。
          const {record} = this.store.enqueue({
            id,
            type: 'correction',
            at: minuteStamp(this.now()),
            appVersion: this.appVersion,
            channel: this.channel,
            platform: this.platform,
            arch: this.arch,
            model: turn?.model || prior?.model || 'unknown',
            ...classified,
          });
          if (turn) turn.correctionId = record.id;
        }
      }
    } catch {}
  }

  onAgentEnd(event = {}, ctx = {}, {
    retrying = false,
    stopped = false,
    errorReason = '',
    mode = 'chat',
  } = {}) {
    try {
      const key = String(ctx.sessionKey || event.sessionKey || '').trim();
      if (!key || /:subagent:/.test(key)) return;
      const turn = this.activeTurns.get(key);
      const runId = String(event.runId || ctx.runId || turn?.runId || '');
      const model = sanitizeModelRef(turn?.model || (runId && this.runModels.get(runId)) || '');

      if (retrying) {
        if (turn) {
          turn.retried = true;
          if (model && model !== 'unknown') turn.model = model;
        }
        return;
      }

      this.activeTurns.delete(key);
      const now = this.now();
      const failed = !stopped && (turnFailed(event) || event.success === false);
      const outcome = stopped ? 'stopped' : failed ? 'error' : 'success';
      const errorKind = outcome === 'error' ? classifyModelFailure(errorReason) : '';
      const tools = turn ? [...turn.tools] : [];
      const failedTools = turn ? [...turn.failedTools] : [];
      const workKind = turn?.workKind || 'unknown';
      const workKinds = turn?.workKinds || [];
      const turnMode = turn?.mode || mode || 'chat';

      this.lastSessionTurn.set(key, {
        workKind,
        tools,
        outcome,
        model,
        at: now,
      });
      if (this.lastSessionTurn.size > 256) {
        const oldest = this.lastSessionTurn.keys().next().value;
        if (oldest) this.lastSessionTurn.delete(oldest);
      }

      if (!this.isRecordingEnabled()) return;
      const {count} = this.store.enqueue({
        id: crypto.randomUUID(),
        type: 'usage',
        at: minuteStamp(now),
        appVersion: this.appVersion,
        channel: this.channel,
        platform: this.platform,
        arch: this.arch,
        mode: turnMode,
        workKind,
        workKinds,
        tools,
        failedTools,
        toolCalls: turn?.toolCalls || 0,
        outcome,
        errorKind,
        durationMs: turn ? Math.max(0, now - turn.startedAt) : 0,
        model,
        retried: Boolean(turn?.retried),
      });

      if (count >= this.batchSize) void this.maybeAutoFlush();
    } catch {}
  }

  shouldAutoFlush() {
    if (!this.canUpload()) return false;
    const prefs = this.store.readPrefs();
    const now = this.now();
    if (prefs.backoffUntil && now < prefs.backoffUntil) return false;
    const queue = this.store.readQueue();
    if (!queue.length) return false;
    if (queue.length >= this.batchSize) return true;
    const last = prefs.lastUploadAt || 0;
    return now - last >= this.flushIntervalMs;
  }

  // 四处调用（setPrefs、攒够一批、启动 15 秒、每 30 分钟）都是 void 发出去不管：
  // _doFlush 里同步写盘（writePrefs / removeIds）和加密出错会让它 reject，在这里接住并记日志，
  // 不然就是一条 unhandledRejection。队列里的记录还在，下一次自动上报再发。
  async maybeAutoFlush() {
    try {
      if (!this.shouldAutoFlush()) return {ok: false, skipped: true};
      return await this.flush();
    } catch (error) {
      try { this.logger?.warn?.(`pinkie feedback auto upload failed: ${String(error?.message || error).slice(0, 200)}`); } catch {}
      return {ok: false, uploaded: 0, errorCode: 'auto_flush_failed'};
    }
  }

  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this._doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async _doFlush() {
    if (!this.isRelease) return {ok: false, uploaded: 0, reason: 'dev_mode'};
    const prefs = this.store.readPrefs();
    if (!prefs.consent) return {ok: false, uploaded: 0, reason: 'no_consent'};
    if (!this.publicKey) return {ok: false, uploaded: 0, reason: 'no_public_key'};
    if (!this.transport?.configured) return {ok: false, uploaded: 0, reason: 'not_configured'};

    let totalUploaded = 0;
    const uploadedPaths = [];
    while (true) {
      const queue = this.store.readQueue();
      if (!queue.length) break;
      const chunk = queue.slice(0, this.batchSize).map(item => sanitizeFeedbackRecord(item));
      const now = this.now();
      const batch = {
        schema: 1,
        batchId: crypto.randomUUID(),
        sentAt: new Date(now).toISOString(),
        appVersion: this.appVersion,
        channel: 'release',
        records: chunk,
      };
      const envelope = encryptFeedbackEnvelope(batch, this.publicKey);
      const filePath = makeBatchFilePath(new Date(now));
      const result = await this.transport.upload({envelope, filePath});
      if (!result?.ok) {
        const latest = this.store.readPrefs();
        const backoff = result?.retryable === false ? AUTH_BACKOFF_MS : TRANSIENT_BACKOFF_MS;
        this.store.writePrefs({
          ...latest,
          lastErrorAt: now,
          lastErrorCode: String(result?.errorCode || 'upload_failed').slice(0, 32),
          backoffUntil: now + backoff,
        });
        this.logger?.info?.(`pinkie feedback upload deferred (${String(result?.errorCode || 'unknown')})`);
        return {
          ok: false,
          uploaded: totalUploaded,
          paths: uploadedPaths,
          errorCode: result?.errorCode || 'upload_failed',
        };
      }
      const removed = this.store.removeIds(chunk.map(item => item.id));
      totalUploaded += removed || chunk.length;
      uploadedPaths.push(filePath);
      const latest = this.store.readPrefs();
      this.store.writePrefs({
        ...latest,
        lastUploadAt: now,
        lastErrorAt: 0,
        lastErrorCode: '',
        backoffUntil: 0,
        uploadedCount: (Number(latest.uploadedCount) || 0) + (removed || chunk.length),
      });
    }
    return {ok: true, uploaded: totalUploaded, paths: uploadedPaths};
  }

  startBackgroundTimer() {
    if (this.timer || !this.isRelease) return;
    const startupTimer = setTimeout(() => { void this.maybeAutoFlush(); }, 15_000);
    startupTimer.unref?.();
    this.timer = setInterval(() => { void this.maybeAutoFlush(); }, 30 * 60 * 1000);
    this.timer.unref?.();
  }

  stopBackgroundTimer() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

const FEEDBACK_INSTANCES = Symbol.for('pinkie.feedback.instances');

export function sharedFeedbackManager(root, options = {}) {
  const key = path.resolve(String(root || resolveFeedbackRoot()));
  const shared = globalThis[FEEDBACK_INSTANCES] ??= new Map();
  if (!shared.has(key)) shared.set(key, new FeedbackManager({...options, root: key}));
  return shared.get(key);
}

export function registerFeedback(api, options = {}) {
  const root = options.root || resolveFeedbackRoot();
  const manager = options.manager || sharedFeedbackManager(root, {logger: api?.logger, ...options});

  api.registerGatewayMethod?.('pinkie.feedback.status', ({respond}) => {
    try { respond(true, manager.status()); }
    catch (error) { respond(false, undefined, {code: 'FEEDBACK_STATUS_FAILED', message: String(error?.message || error)}); }
  }, {scope: 'operator.read'});

  api.registerGatewayMethod?.('pinkie.feedback.setPrefs', ({params, respond}) => {
    try { respond(true, manager.setPrefs(params || {})); }
    catch (error) { respond(false, undefined, {code: 'FEEDBACK_PREFS_FAILED', message: String(error?.message || error)}); }
  }, {scope: 'operator.admin'});

  api.registerGatewayMethod?.('pinkie.feedback.preview', ({respond}) => {
    try { respond(true, manager.preview()); }
    catch (error) { respond(false, undefined, {code: 'FEEDBACK_PREVIEW_FAILED', message: String(error?.message || error)}); }
  }, {scope: 'operator.read'});

  api.registerGatewayMethod?.('pinkie.feedback.clear', ({respond}) => {
    try { respond(true, manager.clear()); }
    catch (error) { respond(false, undefined, {code: 'FEEDBACK_CLEAR_FAILED', message: String(error?.message || error)}); }
  }, {scope: 'operator.admin'});

  api.registerGatewayMethod?.('pinkie.feedback.flush', async ({respond}) => {
    try { respond(true, await manager.flush()); }
    catch (error) { respond(false, undefined, {code: 'FEEDBACK_FLUSH_FAILED', message: String(error?.message || error)}); }
  }, {scope: 'operator.admin'});

  api.on?.('gateway_start', () => {
    try { manager.startBackgroundTimer(); } catch {}
  });

  return manager;
}
