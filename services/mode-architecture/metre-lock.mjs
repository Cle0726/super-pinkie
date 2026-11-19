// 正式版 Metre 开发者密码门槛（PLAN 第 5 节）。
//
// - 只在正式版（guardMode().channel === 'release'）启用；开发版完全不锁。
// - 密码不进代码和安装包，只读签名清单里的 scrypt 哈希（metre-lock-hash.json）。
// - 解锁状态按本机硬件标识（IOPlatformUUID / MachineGuid / machine-id）加 HMAC 存放在 <pinkieStateRoot>/guard/metre-lock.json，
//   拷到别的机器无效；连续 5 次输错冷却 10 分钟，之后每次翻倍，重开 App 照样算数。
// - 后端所有接受 agent:metre: 会话、Metre 专用工具、pinkie.metre.* 网关方法以及网关 chat.send / sessions.* / agent
//   都认这里的判断，不靠藏按钮。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {guardMode} from './settings-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACTIVE_LOCK_SYMBOL = Symbol.for('pinkie.metreLock.v1');
const SHARED_LOCKS_SYMBOL = Symbol.for('pinkie.metreLockInstances.v1');
const COOLDOWN_THRESHOLD = 5;
const BASE_COOLDOWN_MS = 10 * 60_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

export const LOCKED_ERROR = '正式版中 Metre 需要先输入开发者密码解锁。';

export function isMetreSession(key) {
  return /^agent:metre(?::|$)/i.test(String(key ?? '').trim());
}

export function isMetreAgent(agentId) {
  return String(agentId ?? '').trim().toLowerCase() === 'metre';
}

export function isMetreMode(mode) {
  return String(mode ?? '').trim().toLowerCase() === 'metre';
}

const METRE_SESSION_FIELDS = [
  'sessionKey', 'key', 'target', 'session', 'parentSessionKey',
  'targetSessionKey', 'childSessionKey', 'requesterSessionKey',
  'parentKey', 'sourceKey', 'fromKey', 'from', 'to', 'sessionId', 'id',
];
const METRE_TEXT_SKIP_FIELDS = new Set([
  'message', 'content', 'prompt', 'text', 'body', 'plan', 'query', 'title',
  'label', 'summary', 'description', 'background', 'question', 'password', 'note',
]);

export function paramsReferenceMetre(params, depth = 0) {
  if (!params || typeof params !== 'object' || depth > 4) return false;
  if (Array.isArray(params)) {
    return params.some(item => (typeof item === 'string' ? isMetreSession(item) : paramsReferenceMetre(item, depth + 1)));
  }
  for (const field of METRE_SESSION_FIELDS) {
    if (isMetreSession(params[field])) return true;
  }
  if (isMetreAgent(params.agentId) || isMetreAgent(params.agent)) return true;
  if (isMetreMode(params.mode)) return true;
  if (Array.isArray(params.keys) && params.keys.some(item => isMetreSession(item))) return true;
  if (Array.isArray(params.sessionKeys) && params.sessionKeys.some(item => isMetreSession(item))) return true;
  if (Array.isArray(params.agentIds) && params.agentIds.some(item => isMetreAgent(item))) return true;
  for (const [k, v] of Object.entries(params)) {
    if (METRE_TEXT_SKIP_FIELDS.has(k)) continue;
    if (v && typeof v === 'object' && paramsReferenceMetre(v, depth + 1)) return true;
  }
  return false;
}

export function defaultStateRoot() {
  if (process.env.PINKIE_STATE_ROOT) return path.resolve(process.env.PINKIE_STATE_ROOT);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SuperPinkie');
  return path.join(home, 'Library', 'Application Support', 'SuperPinkie');
}

let cachedMachineId = '';
export function resolveMachineId({
  platform = process.platform,
  exec = execFileSync,
  readFile = p => fs.readFileSync(p, 'utf8'),
  useCache = true,
} = {}) {
  if (useCache && cachedMachineId) return cachedMachineId;
  let id = '';
  try {
    if (platform === 'darwin') {
      const out = exec('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {encoding: 'utf8', timeout: 2000});
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(out || ''));
      if (match?.[1]) id = `darwin:${match[1].trim()}`;
    } else if (platform === 'win32') {
      const out = exec('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {encoding: 'utf8', timeout: 2000});
      const match = /MachineGuid\s+REG_SZ\s+([^\r\n]+)/i.exec(String(out || ''));
      if (match?.[1]) id = `win32:${match[1].trim()}`;
    } else {
      for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const text = String(readFile(file) || '').trim();
          if (text) { id = `linux:${text}`; break; }
        } catch {}
      }
    }
  } catch {}
  if (!id) {
    let user = '';
    try { user = os.userInfo().username; } catch {}
    id = `fallback:${os.hostname()}:${platform}:${os.arch()}:${user}`;
  }
  if (useCache) cachedMachineId = id;
  return id;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeHexEqual(a, b) {
  const sa = String(a || '').trim().toLowerCase();
  const sb = String(b || '').trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(sa) || sa.length !== sb.length || sa.length === 0 || sa.length % 2 !== 0) return false;
  return crypto.timingSafeEqual(Buffer.from(sa, 'hex'), Buffer.from(sb, 'hex'));
}

export function loadHashRecord(filePath) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
  if (!raw || raw.configured !== true || raw.algorithm !== 'scrypt') return null;
  const N = Number(raw.N), r = Number(raw.r), p = Number(raw.p), keylen = Number(raw.keylen);
  const salt = String(raw.salt || '').trim().toLowerCase();
  const hash = String(raw.hash || '').trim().toLowerCase();
  if (!Number.isInteger(N) || N < 16384 || N > 1048576 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
  if (!Number.isInteger(keylen) || keylen < 32 || keylen > 128) return null;
  if (!/^[0-9a-f]{32,}$/.test(salt) || salt.length % 2 !== 0) return null;
  if (!/^[0-9a-f]{64,}$/.test(hash) || hash.length !== keylen * 2) return null;
  return {algorithm: 'scrypt', configured: true, N, r, p, keylen, salt, hash};
}

export function verifyScryptPassword(password, record) {
  if (!record || typeof password !== 'string' || password.length === 0) return Promise.resolve(false);
  const normalized = password.normalize('NFC');
  const maxmem = Math.max(128 * 1024 * 1024, 256 * record.N * record.r);
  return new Promise((resolve) => {
    crypto.scrypt(
      Buffer.from(normalized, 'utf8'),
      Buffer.from(record.salt, 'hex'),
      record.keylen,
      {N: record.N, r: record.r, p: record.p, maxmem},
      (err, derived) => {
        if (err || !derived) return resolve(false);
        try {
          resolve(crypto.timingSafeEqual(derived, Buffer.from(record.hash, 'hex')));
        } catch {
          resolve(false);
        }
      },
    );
  });
}

export function cooldownMsForFailures(failures) {
  const count = Number(failures) || 0;
  if (count < COOLDOWN_THRESHOLD) return 0;
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * (2 ** Math.min(10, count - COOLDOWN_THRESHOLD)));
}

export class MetreLock {
  constructor(options = {}) {
    this.mode = options.mode || guardMode();
    this.pinkieStateRoot = options.pinkieStateRoot || defaultStateRoot();
    this.stateFile = options.stateFile || path.join(this.pinkieStateRoot, 'guard', 'metre-lock.json');
    this.hashFile = options.hashFile || this.resolveHashFile();
    this.hashRecord = options.hashRecord !== undefined ? options.hashRecord : loadHashRecord(this.hashFile);
    this.machineId = options.machineId || resolveMachineId();
    this.now = options.now || (() => Date.now());
    this.verifyPassword = options.verifyPassword || verifyScryptPassword;
    this.unlockQueue = Promise.resolve();
    this.state = {unlocked: false, unlockedAt: '', failures: 0, lockedUntil: 0};
    this.loadState();
  }

  resolveHashFile() {
    const hereHash = path.join(HERE, 'metre-lock-hash.json');
    // 已安装插件目录由启动守卫按签名清单恢复并受 SettingsGuard 只读保护：
    // 若 guardMode 是从插件自身的 guard-build.json 来的，优先读插件同目录的哈希，不让 process.cwd() 里的源码树插队。
    if (String(this.mode?.source || '').endsWith('guard-build.json') && fs.existsSync(hereHash)) {
      return hereHash;
    }
    const bundled = this.mode?.bundleRoot
      ? path.join(this.mode.bundleRoot, 'services', 'mode-architecture', 'metre-lock-hash.json')
      : '';
    if (bundled && fs.existsSync(bundled)) return bundled;
    return hereHash;
  }

  get channel() {
    return this.mode?.channel || 'dev';
  }

  isRelease() {
    return this.channel === 'release';
  }

  get configured() {
    return Boolean(this.hashRecord && this.hashRecord.configured === true);
  }

  machineHash() {
    return sha256Hex(`pinkie-machine-v1|${this.machineId}`);
  }

  computeMac(payload) {
    const key = sha256Hex(`pinkie-metre-lock-v1|${this.machineId}|${this.hashRecord?.salt || ''}|${this.hashRecord?.hash || ''}`);
    const canonical = JSON.stringify({
      version: 1,
      unlocked: Boolean(payload.unlocked),
      unlockedAt: String(payload.unlockedAt || ''),
      machineHash: String(payload.machineHash || ''),
      failures: Number(payload.failures || 0),
      lockedUntil: Number(payload.lockedUntil || 0),
    });
    return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(canonical).digest('hex');
  }

  loadState() {
    if (!this.isRelease()) {
      this.state = {unlocked: true, unlockedAt: '', failures: 0, lockedUntil: 0};
      return this.state;
    }
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return this.state;
    if (!timingSafeHexEqual(parsed.machineHash, this.machineHash())) {
      // 从别的机器拷过来的状态文件无效：不继承解锁，也不继承冷却。
      return this.state;
    }
    const failures = Number.isInteger(parsed.failures) && parsed.failures >= 0 ? parsed.failures : 0;
    const lockedUntil = Number.isFinite(parsed.lockedUntil) && parsed.lockedUntil >= 0 ? parsed.lockedUntil : 0;
    const expectedMac = this.computeMac({
      unlocked: Boolean(parsed.unlocked),
      unlockedAt: String(parsed.unlockedAt || ''),
      machineHash: parsed.machineHash,
      failures,
      lockedUntil,
    });
    if (!timingSafeHexEqual(parsed.mac, expectedMac)) {
      // 状态文件被手改过：拒绝解锁，同时保住内存中已有的冷却计数。
      this.state.unlocked = false;
      this.state.unlockedAt = '';
      return this.state;
    }
    this.state = {
      unlocked: Boolean(parsed.unlocked) && this.configured,
      unlockedAt: Boolean(parsed.unlocked) && this.configured ? String(parsed.unlockedAt || '') : '',
      failures: Math.max(this.state.failures, failures),
      lockedUntil: Math.max(this.state.lockedUntil, lockedUntil),
    };
    return this.state;
  }

  saveState() {
    if (!this.isRelease()) return;
    const payload = {
      version: 1,
      unlocked: Boolean(this.state.unlocked),
      unlockedAt: String(this.state.unlockedAt || ''),
      machineHash: this.machineHash(),
      failures: Number(this.state.failures || 0),
      lockedUntil: Number(this.state.lockedUntil || 0),
    };
    payload.mac = this.computeMac(payload);
    fs.mkdirSync(path.dirname(this.stateFile), {recursive: true});
    const temp = `${this.stateFile}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(temp, this.stateFile);
  }

  isUnlocked() {
    if (!this.isRelease()) return true;
    return this.configured && this.state.unlocked === true;
  }

  isLocked() {
    return this.isRelease() && !this.isUnlocked();
  }

  isLockedSession(key) {
    return this.isLocked() && isMetreSession(key);
  }

  status() {
    const now = this.now();
    const release = this.isRelease();
    const unlocked = this.isUnlocked();
    const locked = release && !unlocked;
    const lockedUntil = locked && this.state.lockedUntil > now ? this.state.lockedUntil : 0;
    const retryAfterMs = lockedUntil ? Math.max(0, lockedUntil - now) : 0;
    return {
      channel: this.channel,
      release,
      required: release,
      locked,
      unlocked,
      configured: this.configured,
      failures: release ? this.state.failures : 0,
      remainingAttempts: release ? Math.max(0, COOLDOWN_THRESHOLD - this.state.failures) : COOLDOWN_THRESHOLD,
      lockedUntil,
      retryAfterMs,
    };
  }

  async unlock(password) {
    const run = async () => {
      if (!this.isRelease()) return {ok: true, ...this.status()};
      if (!this.configured) {
        return {
          ok: false,
          code: 'NOT_CONFIGURED',
          error: '当前正式版还没有设置开发者密码，暂时无法解锁 Metre。',
          ...this.status(),
        };
      }
      const now = this.now();
      if (this.state.lockedUntil > now) {
        return {
          ok: false,
          code: 'COOLDOWN',
          error: '输错次数过多，请等待冷却结束后再试。',
          ...this.status(),
        };
      }
      if (typeof password !== 'string' || password.length === 0) {
        return {
          ok: false,
          code: 'EMPTY_PASSWORD',
          error: '请输入开发者密码。',
          ...this.status(),
        };
      }
      const matched = await this.verifyPassword(password, this.hashRecord);
      const after = this.now();
      if (matched) {
        this.state = {
          unlocked: true,
          unlockedAt: new Date(after).toISOString(),
          failures: 0,
          lockedUntil: 0,
        };
        this.saveState();
        return {ok: true, ...this.status()};
      }
      const failures = (this.state.failures || 0) + 1;
      const waitMs = cooldownMsForFailures(failures);
      this.state = {
        unlocked: false,
        unlockedAt: '',
        failures,
        lockedUntil: waitMs ? after + waitMs : 0,
      };
      this.saveState();
      const status = this.status();
      return {
        ok: false,
        code: waitMs ? 'COOLDOWN' : 'WRONG_PASSWORD',
        error: waitMs ? '连续输错次数过多，请等待冷却结束后再试。' : '开发者密码不正确。',
        ...status,
      };
    };
    const next = this.unlockQueue.then(run, run);
    this.unlockQueue = next.catch(() => {});
    return next;
  }

  lock() {
    if (!this.isRelease()) return {ok: true, ...this.status()};
    this.state = {
      unlocked: false,
      unlockedAt: '',
      failures: this.state.failures || 0,
      lockedUntil: this.state.lockedUntil || 0,
    };
    this.saveState();
    return {ok: true, ...this.status()};
  }

  assertUnlocked() {
    if (this.isLocked()) throw new Error(LOCKED_ERROR);
  }

  assertSessionAllowed(sessionKey) {
    if (this.isLocked() && isMetreSession(sessionKey)) throw new Error(LOCKED_ERROR);
  }

  assertAgentAllowed(agentId) {
    if (this.isLocked() && isMetreAgent(agentId)) throw new Error(LOCKED_ERROR);
  }

  checkGatewayRequest(method, params = {}) {
    if (!this.isLocked()) return '';
    const name = String(method || '').trim();
    if (name === 'pinkie.guard.status' || name === 'pinkie.guard.metreStatus'
        || name === 'pinkie.guard.metreUnlock' || name === 'pinkie.guard.metreLock') {
      return '';
    }
    if (name === 'pinkie.metre.today') {
      // 首页节日彩蛋只传 {date}，不带会话或目录；带会话 / 目录查 Metre 记忆则拒绝。
      if (!params || (!params.sessionKey && !params.folder && !params.scope && !paramsReferenceMetre(params))) return '';
      return LOCKED_ERROR;
    }
    if (name.startsWith('pinkie.metre.')) return LOCKED_ERROR;
    if (name.startsWith('agents.') && isMetreAgent(params?.id)) return LOCKED_ERROR;
    if (name === 'pinkie.quiet.set' && params?.quiet === true) return LOCKED_ERROR;
    if (paramsReferenceMetre(params)) return LOCKED_ERROR;
    return '';
  }
}

export function getActiveMetreLock() {
  return globalThis[ACTIVE_LOCK_SYMBOL] || null;
}

export function setActiveMetreLock(lock) {
  globalThis[ACTIVE_LOCK_SYMBOL] = lock || null;
  return lock;
}

export function registerMetreLock(api, options = {}) {
  let lock;
  if (options.lock instanceof MetreLock) {
    lock = options.lock;
  } else {
    const candidate = new MetreLock(options);
    // OpenClaw 同一网关进程内会多次加载/注册同一插件：按目录和配置复用同一个锁实例，
    // 避免某份旧注册句柄执行 unlock / lock 时改的不是当前全局生效的那一份。
    const cacheKey = `${candidate.channel}|${candidate.stateFile}|${candidate.hashFile}|${candidate.machineId}|${candidate.hashRecord?.hash || ''}`;
    const shared = (globalThis[SHARED_LOCKS_SYMBOL] ??= new Map());
    if (shared.has(cacheKey)) {
      lock = shared.get(cacheKey);
    } else {
      shared.set(cacheKey, candidate);
      lock = candidate;
    }
  }
  if (options.activate !== false) setActiveMetreLock(lock);
  const current = () => (options.lock instanceof MetreLock ? lock : (getActiveMetreLock() || lock));
  api?.registerGatewayMethod?.('pinkie.guard.metreStatus', ({respond}) => {
    try { respond(true, {ok: true, ...current().status()}); }
    catch (error) { respond(false, undefined, {code: 'METRE_LOCK_ERROR', message: String(error?.message || error)}); }
  }, {scope: 'operator.read'});
  api?.registerGatewayMethod?.('pinkie.guard.metreUnlock', async ({params, respond}) => {
    try {
      const result = await current().unlock(typeof params?.password === 'string' ? params.password : '');
      respond(true, result);
    } catch (error) {
      respond(false, undefined, {code: 'METRE_LOCK_ERROR', message: String(error?.message || error)});
    }
  }, {scope: 'operator.admin'});
  api?.registerGatewayMethod?.('pinkie.guard.metreLock', ({respond}) => {
    try { respond(true, current().lock()); }
    catch (error) { respond(false, undefined, {code: 'METRE_LOCK_ERROR', message: String(error?.message || error)}); }
  }, {scope: 'operator.admin'});
  return lock;
}
