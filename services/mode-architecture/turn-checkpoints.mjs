import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {agentWorkspaceDir, isPathInside, toolTargetPaths} from './evidence-rules.mjs';
import {RoleMutationAuditor, isRolesContext} from './metre-roles.mjs';
import {pinkieStateRoot} from './mode-constants.mjs';
import {boundProjectRoot} from './project-brief.mjs';
import {hasSessionHeader} from './session-branch.mjs';
import {agentOf, isInternalMessage, isInternalSessionKey, isPersona, messageText,
  registerSessionMethod} from './session-titles.mjs';

const MB = 1024 * 1024;
export const LIMITS = Object.freeze({
  file: 2 * MB, turn: 20 * MB, session: 100 * MB, turns: 30, total: 1024 * MB, backupMs: 24 * 3600 * 1000,
});
export const AUDIT_MAX_FILES = 1500;
export const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'code_edit']);
export const EXEC_TOOLS = new Set(['exec', 'run_tests']);
export const BUSY = '先停下再回退';
export const GONE = '这一轮的检查点已经不在了';
const NOT_FOUND = '找不到当前分支里的这条消息';
const UNAVAILABLE = '会话记录暂时不可用，没回退';
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', '.cache']);
const NO_CONTENT_DIRS = ['.git', 'node_modules'];
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;

const isUserMessage = entry => entry?.type === 'message' && entry.message?.role === 'user'
  && !isInternalMessage(entry.message)
  && !['inter_session', 'internal_system'].includes(entry.message?.provenance?.kind)
  && !['inter_session', 'internal_system'].includes(entry.message?.metadata?.inputProvenance?.kind);
const isAssistantMessage = entry => entry?.type === 'message' && entry.message?.role === 'assistant';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const statSig = file => { const st = fs.statSync(file); return `${st.size}:${st.mtimeMs}`; };
const ensureDir = dir => fs.mkdirSync(dir, {recursive: true, mode: 0o700});
const keyOf = (event, ctx) => String(ctx?.sessionKey || event?.sessionKey || '');
const callIdOf = (event, ctx) => String(event?.toolCallId || ctx?.toolCallId || event?.runId || 'default');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function writeAtomic(file, data, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, data, {mode, flag: 'wx'});
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function currentHash(file) {
  try { return sha256(fs.readFileSync(file)); } catch (error) { return error?.code === 'ENOENT' ? null : ''; }
}

function isDirectory(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function realish(file) {
  const rest = [];
  for (let current = path.resolve(file); ;) {
    try { return path.join(fs.realpathSync(current), ...rest.reverse()); } catch {}
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(file);
    rest.push(path.basename(current));
    current = parent;
  }
}

function auditScan(root) {
  const skipped = new Map();
  const stack = [root];
  let files = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, {withFileTypes: true}); } catch { continue; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(full);
        else {
          try { skipped.set(full, fs.statSync(full).mtimeMs); } catch {}
        }
      } else if (ent.isFile() && ++files > AUDIT_MAX_FILES) {
        return {truncated: true, skipped};
      }
    }
  }
  return {truncated: false, skipped};
}

const skipsChanged = (before, after) => before.size !== after.size
  || [...before].some(([dir, mtime]) => after.get(dir) !== mtime);

function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, {withFileTypes: true}); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else {
        try { total += fs.lstatSync(full).size; } catch {}
      }
    }
  }
  return total;
}

const referenced = index => new Set(index.turns.flatMap(rec => (rec.files || [])
  .map(file => file.preHash).filter(hash => HASH.test(hash || ''))));

function blobBytes(dir, index) {
  let total = 0;
  for (const hash of referenced(index)) {
    try { total += fs.statSync(path.join(dir, 'blobs', hash)).size; } catch {}
  }
  return total;
}

function branchTurns(branch) {
  const rows = [];
  for (const item of branch) {
    if (isUserMessage(item)) rows.push({turn: rows.length + 1, userEntryId: item.id, assistantEntryIds: []});
    else if (isAssistantMessage(item) && rows.length) rows.at(-1).assistantEntryIds.push(item.id);
  }
  return rows;
}

const lineId = line => { try { return JSON.parse(line)?.id; } catch { return undefined; } };

export class TurnCheckpoints {
  constructor({access, isBusy = () => false, isLocked = () => false, stateRoot = pinkieStateRoot, projectRoot,
    workspaceFor = agentWorkspaceDir, now = Date.now, sdk, limits} = {}) {
    this.access = access;
    this.isBusy = isBusy;
    this.isLocked = isLocked;
    this.stateRoot = typeof stateRoot === 'function' ? stateRoot : () => stateRoot;
    this.projectRoot = projectRoot || (key => boundProjectRoot(key, {stateRoot: this.stateRoot()}));
    this.workspaceFor = workspaceFor;
    this.now = now;
    this.sdk = sdk || (name => access?.sdk?.(name));
    this.limits = {...LIMITS, ...limits};
    this.turns = new Map();
    this.queues = new Map();
    this.prunedAt = -Infinity;
  }

  root() {
    const base = String(this.stateRoot() || '');
    return path.isAbsolute(base) ? path.join(base, 'checkpoints') : null;
  }

  sessionDir(sessionId) {
    const root = this.root();
    const id = String(sessionId || '');
    return root && SESSION_ID.test(id) ? path.join(root, id) : null;
  }

  eligible(key, event, ctx) {
    if (!key || !agentOf(key) || isInternalSessionKey(key) || isPersona(key)) return false;
    if (isRolesContext({agentId: ctx?.agentId, sessionKey: key})) return false;
    try { return !this.isLocked(event, ctx); } catch { return false; }
  }

  busy(key) {
    try { return Boolean(this.isBusy(key)); } catch { return false; }
  }

  scopeRoots(key, ctx) {
    const roots = [];
    for (const pick of [() => this.projectRoot(key), () => this.workspaceFor(ctx)]) {
      let dir = '';
      try { dir = String(pick() || ''); } catch {}
      if (!dir || !path.isAbsolute(dir)) continue;
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
      const real = realish(dir);
      if (!roots.includes(real)) roots.push(real);
    }
    return roots;
  }

  serial(dir, work) {
    const run = (this.queues.get(dir) || Promise.resolve()).then(work, work);
    this.queues.set(dir, run.catch(() => {}));
    return run;
  }

  readIndex(dir) {
    try {
      const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      if (index && Array.isArray(index.turns)) return index;
    } catch {}
    return {version: 1, turns: []};
  }

  writeIndex(dir, index) {
    ensureDir(dir);
    writeAtomic(path.join(dir, 'index.json'), JSON.stringify(index));
  }

  writeBlob(dir, hash, data) {
    const blobs = path.join(dir, 'blobs');
    ensureDir(blobs);
    const file = path.join(blobs, hash);
    if (!fs.existsSync(file)) writeAtomic(file, data);
  }

  collectBlobs(dir, index) {
    const keep = referenced(index);
    let names = [];
    try { names = fs.readdirSync(path.join(dir, 'blobs')); } catch { return; }
    for (const name of names) if (!keep.has(name)) fs.rmSync(path.join(dir, 'blobs', name), {force: true});
  }

  async sessionTools() {
    const sessions = await this.sdk('agent-sessions');
    if (!sessions?.SessionManager) throw new Error('暂时不能回退，请稍后再试');
    return sessions;
  }

  async tools() {
    const [sessions, harness] = await Promise.all([this.sdk('agent-sessions'), this.sdk('agent-harness-runtime')]);
    if (!sessions?.SessionManager || !harness?.acquireSessionWriteLock) throw new Error('暂时不能回退，请稍后再试');
    return {SessionManager: sessions.SessionManager, acquireSessionWriteLock: harness.acquireSessionWriteLock};
  }

  openTurn(key, event, ctx) {
    const runId = String(event?.runId || ctx?.runId || '');
    let turn = this.turns.get(key);
    if (turn && runId && turn.runId && turn.runId !== runId) {
      this.turns.delete(key);
      this.finish(turn).catch(() => {});
      turn = null;
    }
    if (turn) return turn;
    const roots = this.scopeRoots(key, ctx);
    if (!roots.length) return null;
    const sessionId = String(event?.sessionId || ctx?.sessionId || '');
    turn = {key, runId, roots, sessionId, dir: this.sessionDir(sessionId), startedAt: this.now(), files: new Map(),
      bytes: 0, auditIncomplete: false, audits: new Map(), calls: new Map(), auditor: new RoleMutationAuditor(),
      pendingBlobs: new Map()};
    turn.meta = this.resolveMeta(key, sessionId).catch(() => null);
    this.turns.set(key, turn);
    return turn;
  }

  async resolveMeta(key, sessionId) {
    const entry = await this.access?.entry?.(key);
    const id = sessionId || String(entry?.sessionId || '');
    if (!entry?.transcript || !this.sessionDir(id) || !hasSessionHeader(entry.transcript)) return null;
    const {SessionManager} = await this.sessionTools();
    const users = SessionManager.open(entry.transcript).getBranch().filter(isUserMessage);
    return users.length ? {sessionId: id, userEntryId: users.at(-1).id, turn: users.length} : null;
  }

  outOfScope(file, roots) {
    const root = roots.find(dir => isPathInside(file, dir));
    if (!root) return 'outside';
    return path.relative(root, file).split(path.sep).some(part => NO_CONTENT_DIRS.includes(part)) ? 'skipped-dir' : '';
  }

  capture(turn, target) {
    const abs = path.resolve(target);
    let link = false;
    try { link = fs.lstatSync(abs).isSymbolicLink(); } catch {}
    const file = link ? abs : realish(abs);
    if (turn.files.has(file)) return file;
    const mark = unrecoverable => { turn.files.set(file, {path: file, unrecoverable}); return file; };
    const reason = link ? 'symlink' : this.outOfScope(file, turn.roots);
    if (reason) return mark(reason);
    let st;
    try { st = fs.statSync(file); } catch (error) {
      if (error?.code !== 'ENOENT') return mark('unreadable');
      turn.files.set(file, {path: file, existed: false, preHash: null});
      return file;
    }
    if (!st.isFile()) return mark('not-file');
    if (st.size > this.limits.file || turn.bytes + st.size > this.limits.turn) return mark('too-large');
    let data;
    try { data = fs.readFileSync(file); } catch { return mark('unreadable'); }
    const preHash = sha256(data);
    turn.bytes += data.length;
    if (turn.dir) this.writeBlob(turn.dir, preHash, data);
    else turn.pendingBlobs.set(preHash, data);
    turn.files.set(file, {path: file, existed: true, preHash, size: data.length, mode: st.mode & 0o777});
    return file;
  }

  startAudit(turn, callId) {
    turn.audits.set(callId, turn.roots.map((root, i) => {
      turn.auditor.beforeExec(turn.key, `${callId}::${i}`, [root]);
      return auditScan(root);
    }));
  }

  endAudit(turn, callId, scans) {
    const touched = turn.calls.get(callId) || [];
    turn.roots.forEach((root, i) => {
      for (const rel of turn.auditor.afterExec(turn.key, `${callId}::${i}`)) {
        const file = path.join(root, rel);
        if (!turn.files.has(file)) turn.files.set(file, {path: file, unrecoverable: 'exec'});
        touched.push(file);
      }
      const after = auditScan(root);
      if (scans[i].truncated || after.truncated || skipsChanged(scans[i].skipped, after.skipped)) turn.auditIncomplete = true;
    });
    turn.calls.set(callId, touched);
  }

  refreshPost(turn, files) {
    for (const file of files) {
      const item = turn.files.get(file);
      if (item && !item.unrecoverable) item.postHash = currentHash(file);
    }
  }

  beforeTool(event, ctx) {
    try {
      const key = keyOf(event, ctx);
      const name = String(event?.toolName || '').toLowerCase();
      const write = WRITE_TOOLS.has(name);
      const exec = EXEC_TOOLS.has(name);
      if ((!write && !exec) || !this.eligible(key, event, ctx)) return;
      const turn = this.openTurn(key, event, ctx);
      if (!turn) return;
      let workspace = '';
      try { workspace = String(this.workspaceFor(ctx) || ''); } catch {}
      const targets = toolTargetPaths(name, event?.params || {}, workspace)
        .filter(target => !exec || !isDirectory(target));
      const callId = callIdOf(event, ctx);
      turn.calls.set(callId, targets.map(target => this.capture(turn, target)));
      if (exec || !targets.length) this.startAudit(turn, callId);
    } catch {}
  }

  async afterTool(event, ctx) {
    const key = keyOf(event, ctx);
    const turn = this.turns.get(key);
    if (!turn || !this.eligible(key, event, ctx)) return;
    const callId = callIdOf(event, ctx);
    const scans = turn.audits.get(callId);
    if (scans) {
      turn.audits.delete(callId);
      this.endAudit(turn, callId, scans);
    }
    this.refreshPost(turn, turn.calls.get(callId) || []);
    turn.calls.delete(callId);
    await this.persist(turn);
  }

  async agentEnd(event, ctx) {
    const key = keyOf(event, ctx);
    if (!this.eligible(key, event, ctx)) return;
    const turn = this.turns.get(key) || this.openTurn(key, event, ctx);
    if (!turn) return;
    this.turns.delete(key);
    await this.finish(turn);
  }

  async finish(turn) {
    for (const [callId, scans] of turn.audits) this.endAudit(turn, callId, scans);
    turn.audits.clear();
    this.refreshPost(turn, [...turn.files.keys()]);
    await this.persist(turn, {ended: true});
    if (!turn.dir) return;
    await this.serial(turn.dir, () => this.pruneSession(turn.dir));
    this.pruneAll(turn.dir);
  }

  async persist(turn, {ended = false} = {}) {
    const meta = await turn.meta;
    if (!meta) return;
    turn.sessionId ||= meta.sessionId;
    turn.dir ||= this.sessionDir(meta.sessionId);
    if (!turn.dir) return;
    for (const [hash, data] of turn.pendingBlobs) this.writeBlob(turn.dir, hash, data);
    turn.pendingBlobs.clear();
    await this.serial(turn.dir, () => {
      const index = this.readIndex(turn.dir);
      Object.assign(index, {sessionKey: turn.key, sessionId: turn.sessionId, lastUsedAt: this.now()});
      let rec = index.turns.find(item => item.userEntryId === meta.userEntryId);
      if (!rec) {
        rec = {turn: meta.turn, userEntryId: meta.userEntryId, startedAt: turn.startedAt, endedAt: null, files: [],
          auditIncomplete: false};
        index.turns.push(rec);
      }
      const known = new Map(rec.files.map(file => [file.path, file]));
      for (const file of turn.files.values()) {
        const prev = known.get(file.path);
        if (!prev) rec.files.push({...file});
        else if (!prev.unrecoverable && 'postHash' in file) prev.postHash = file.postHash;
      }
      rec.auditIncomplete = Boolean(rec.auditIncomplete || turn.auditIncomplete);
      if (ended) rec.endedAt = this.now();
      this.writeIndex(turn.dir, index);
    });
  }

  pruneSession(dir) {
    const index = this.readIndex(dir);
    const count = index.turns.length;
    index.turns.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    while (index.turns.length > this.limits.turns) index.turns.shift();
    while (index.turns.length && blobBytes(dir, index) > this.limits.session) index.turns.shift();
    if (index.turns.length !== count) this.writeIndex(dir, index);
    this.collectBlobs(dir, index);
    this.pruneBackups(dir);
  }

  pruneBackups(dir) {
    const base = path.join(dir, 'before-restore');
    let names = [];
    try { names = fs.readdirSync(base); } catch { return; }
    for (const name of names) {
      if (this.now() - Number.parseInt(name, 10) > this.limits.backupMs) fs.rmSync(path.join(base, name), {recursive: true, force: true});
    }
  }

  pruneAll(keep) {
    const root = this.root();
    if (!root || this.now() - this.prunedAt < 60_000) return;
    this.prunedAt = this.now();
    let names = [];
    try { names = fs.readdirSync(root); } catch { return; }
    const dirs = names.map(name => path.join(root, name)).filter(dir => {
      try { return fs.statSync(dir).isDirectory(); } catch { return false; }
    }).map(dir => ({dir, bytes: dirBytes(dir), used: Number(this.readIndex(dir).lastUsedAt) || 0}));
    let total = dirs.reduce((sum, item) => sum + item.bytes, 0);
    for (const item of dirs.sort((a, b) => a.used - b.used)) {
      if (total <= this.limits.total) break;
      if (item.dir === keep) continue;
      fs.rmSync(item.dir, {recursive: true, force: true});
      total -= item.bytes;
    }
  }

  async sweep() {
    const root = this.root();
    if (!root || typeof this.access?.entry !== 'function') return;
    let names = [];
    try { names = fs.readdirSync(root); } catch { return; }
    for (const name of names) {
      const dir = path.join(root, name);
      this.pruneBackups(dir);
      const {sessionKey} = this.readIndex(dir);
      if (!sessionKey) continue;
      let entry;
      try { entry = await this.access.entry(sessionKey); } catch { continue; }
      if (!entry || entry.archivedAt || (entry.sessionId && entry.sessionId !== name)) fs.rmSync(dir, {recursive: true, force: true});
    }
    this.prunedAt = -Infinity;
    this.pruneAll('');
  }

  async entryFor(key) {
    if (!agentOf(key) || isInternalSessionKey(key) || isPersona(key) || isRolesContext({sessionKey: key})) {
      throw new Error('找不到这条会话');
    }
    const entry = await this.access?.entry?.(key);
    if (!entry?.transcript || !fs.existsSync(entry.transcript)) throw new Error('找不到这条会话');
    if (entry.archivedAt) throw new Error('已归档的会话不能回退');
    return entry;
  }

  async view(params) {
    const key = String(params?.sessionKey || '');
    const entry = await this.entryFor(key);
    const dir = this.sessionDir(entry.sessionId);
    const index = dir ? this.readIndex(dir) : {turns: []};
    if (!index.turns.length || !hasSessionHeader(entry.transcript)) return {key, dir, index, branch: []};
    const {SessionManager} = await this.sessionTools();
    return {key, dir, index, branch: SessionManager.open(entry.transcript).getBranch()};
  }

  locate(branch, assistantEntryId, index) {
    const at = assistantEntryId ? branch.findIndex(item => item?.id === assistantEntryId && isAssistantMessage(item)) : -1;
    const user = at < 0 ? null : branch.slice(0, at).reverse().find(isUserMessage);
    if (!user) throw new Error(NOT_FOUND);
    const records = new Map(index.turns.map(rec => [rec.userEntryId, rec]));
    if (!records.has(user.id)) throw new Error(GONE);
    const rows = branchTurns(branch);
    const turn = rows.find(row => row.userEntryId === user.id).turn;
    return {user, turn, records: rows.filter(row => row.turn >= turn && records.has(row.userEntryId))
      .map(row => ({...records.get(row.userEntryId), turn: row.turn}))};
  }

  classify(dir, records) {
    const slots = new Map();
    for (const rec of records) {
      for (const file of rec.files || []) {
        const slot = slots.get(file.path);
        if (slot) slot.last = file;
        else slots.set(file.path, {first: file, last: file});
      }
    }
    const restore = [];
    const conflicts = [];
    const unrecoverable = [];
    for (const [file, {first, last}] of slots) {
      let reason = first.unrecoverable;
      if (!reason && first.existed && (!HASH.test(first.preHash || '') || !fs.existsSync(path.join(dir, 'blobs', first.preHash)))) reason = 'missing';
      if (reason) {
        unrecoverable.push({path: file, reason});
        continue;
      }
      const current = currentHash(file);
      const target = first.existed ? first.preHash : null;
      if (current === target) continue;
      const item = {path: file, action: !first.existed ? 'delete' : current === null ? 'recreate' : 'modify', hash: target, mode: first.mode};
      const expected = last.unrecoverable ? undefined : last.postHash;
      (expected !== undefined && current === expected ? restore : conflicts).push(item);
    }
    return {restore: restore.sort(byPath), conflicts: conflicts.sort(byPath), unrecoverable: unrecoverable.sort(byPath)};
  }

  async list(params) {
    const {key, index, branch} = await this.view(params);
    const records = new Map(index.turns.map(rec => [rec.userEntryId, rec]));
    const turns = [];
    let later = false;
    for (const row of branchTurns(branch).reverse()) {
      const rec = records.get(row.userEntryId);
      if (rec?.files?.length) later = true;
      if (rec && later) turns.unshift({...row, auditIncomplete: Boolean(rec.auditIncomplete)});
    }
    return {ok: true, running: this.busy(key), turns};
  }

  async preview(params) {
    const {key, dir, index, branch} = await this.view(params);
    const {user, turn, records} = this.locate(branch, String(params?.assistantEntryId || ''), index);
    const plan = this.classify(dir, records);
    const brief = ({path: file, action}) => ({path: file, action});
    return {ok: true, turn, running: this.busy(key), text: messageText(user.message?.content),
      restore: plan.restore.map(brief), conflicts: plan.conflicts.map(brief), unrecoverable: plan.unrecoverable,
      auditIncomplete: records.filter(rec => rec.auditIncomplete).map(rec => rec.turn)};
  }

  async restore(params) {
    const key = String(params?.sessionKey || '');
    const entry = await this.entryFor(key);
    if (this.busy(key)) throw new Error(BUSY);
    const dir = this.sessionDir(entry.sessionId);
    if (!dir) throw new Error(GONE);
    const {SessionManager, acquireSessionWriteLock} = await this.tools();
    let lock;
    try { lock = await acquireSessionWriteLock({sessionFile: entry.transcript, timeoutMs: 1000}); } catch {
      throw new Error('会话正在被写入，请稍后再试');
    }
    try {
      return await this.serial(dir, () => this.restoreLocked(params, entry, dir, SessionManager));
    } finally {
      await lock.release();
    }
  }

  restoreLocked(params, entry, dir, SessionManager) {
    if (!hasSessionHeader(entry.transcript)) throw new Error('这条会话还没有可回退的记录');
    const session = SessionManager.open(entry.transcript);
    const before = statSig(entry.transcript);
    const branch = session.getBranch();
    const index = this.readIndex(dir);
    const {user, turn, records} = this.locate(branch, String(params?.assistantEntryId || ''), index);
    const plan = this.classify(dir, records);
    const chosen = new Set(Array.isArray(params?.overwrite) ? params.overwrite.map(String) : []);
    const jobs = [...plan.restore, ...plan.conflicts.filter(item => chosen.has(item.path))];
    const backup = this.backupFiles(dir, jobs);
    const applied = [];
    try {
      for (const job of jobs) {
        this.applyJob(dir, job);
        applied.push(job);
      }
      this.truncate(session, entry, branch, user, before);
    } catch (error) {
      this.rollback(backup, applied);
      throw error;
    }
    const dropped = new Set(records.map(rec => rec.userEntryId));
    index.turns = index.turns.filter(rec => !dropped.has(rec.userEntryId));
    index.lastUsedAt = this.now();
    this.writeIndex(dir, index);
    this.collectBlobs(dir, index);
    this.pruneBackups(dir);
    return {ok: true, turn, restored: jobs.length, skipped: plan.conflicts.length + plan.restore.length - jobs.length,
      unrecoverable: plan.unrecoverable.length, text: messageText(user.message?.content)};
  }

  backupFiles(dir, jobs) {
    const base = path.join(dir, 'before-restore', `${this.now()}-${randomUUID().slice(0, 8)}`);
    ensureDir(base);
    const items = jobs.map((job, i) => {
      try {
        const data = fs.readFileSync(job.path);
        writeAtomic(path.join(base, String(i)), data);
        return {path: job.path, existed: true, data, mode: fs.statSync(job.path).mode & 0o777};
      } catch (error) {
        if (error?.code === 'ENOENT') return {path: job.path, existed: false};
        throw new Error(`有文件读不出来，没回退：${job.path}`);
      }
    });
    writeAtomic(path.join(base, 'manifest.json'), JSON.stringify(items.map(({data, ...rest}) => rest)));
    return items;
  }

  applyJob(dir, job) {
    try {
      if (job.action === 'delete') return void fs.rmSync(job.path, {force: true});
      const data = fs.readFileSync(path.join(dir, 'blobs', job.hash));
      if (sha256(data) !== job.hash) throw new Error('corrupt');
      fs.mkdirSync(path.dirname(job.path), {recursive: true});
      writeAtomic(job.path, data, job.mode ?? 0o644);
    } catch {
      throw new Error(`有文件写不回去，已全部拨回：${job.path}`);
    }
  }

  rollback(backup, applied) {
    const saved = new Map(backup.map(item => [item.path, item]));
    for (const job of [...applied].reverse()) {
      const item = saved.get(job.path);
      try {
        if (!item?.existed) fs.rmSync(job.path, {force: true});
        else {
          fs.mkdirSync(path.dirname(job.path), {recursive: true});
          writeAtomic(job.path, item.data, item.mode ?? 0o644);
        }
      } catch {}
    }
  }

  truncate(session, entry, branch, user, before) {
    const header = session.getHeader?.();
    if (!header || typeof header.type !== 'string' || (entry.sessionId && header.id !== entry.sessionId)) throw new Error(UNAVAILABLE);
    // 传 user 消息的 parentId：createBranchedSession 的路径包含叶子本身，传 user id 会把这句留下。
    const parentId = user.parentId || null;
    const upto = parentId ? branch.findIndex(item => item.id === parentId) : -1;
    if (parentId && upto < 0) throw new Error(UNAVAILABLE);
    let branchFile = null;
    let temporary = null;
    try {
      let lines = null;
      if (parentId) {
        branchFile = session.createBranchedSession(parentId) || null;
        if (branchFile && path.resolve(branchFile) === path.resolve(entry.transcript)) {
          branchFile = null;
          throw new Error(UNAVAILABLE);
        }
        session.rewriteFile?.();
        if (branchFile && fs.existsSync(branchFile)) lines = fs.readFileSync(branchFile, 'utf8').split('\n').filter(Boolean);
      }
      // 路径里没有助手消息时 rewriteFile() 会延后、分支文件可能没写出来，这时自己按「文件头 + 路径条目」写。
      if (lines?.length > 1 && lineId(lines.at(-1)) === parentId) lines[0] = JSON.stringify(header);
      else lines = [header, ...branch.slice(0, upto + 1)].map(item => JSON.stringify(item));
      if (lines.slice(1).some(line => lineId(line) === user.id)) throw new Error(UNAVAILABLE);
      temporary = `${entry.transcript}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, `${lines.join('\n')}\n`, {mode: 0o600, flag: 'wx'});
      if (statSig(entry.transcript) !== before) throw new Error('会话记录刚被改过，没回退，请稍后再试');
      fs.renameSync(temporary, entry.transcript);
      temporary = null;
    } finally {
      if (temporary) fs.rmSync(temporary, {force: true});
      if (branchFile) fs.rmSync(branchFile, {force: true});
    }
  }
}

const EXPECTED = /^(?:先停下再回退|这一轮的检查点已经不在了|找不到|已归档的会话不能回退|会话正在被写入|会话记录|有文件|这条会话还没有|暂时不能回退)/u;
const failure = error => ({ok: false, error: EXPECTED.test(String(error?.message || '')) ? error.message : '没回退成功，请稍后再试'});

export function registerTurnCheckpoints(api, deps = {}) {
  const checkpoints = new TurnCheckpoints(deps);
  api.on?.('before_tool_call', (event, ctx) => { checkpoints.beforeTool(event, ctx); }, {priority: -13000});
  api.on?.('after_tool_call', (event, ctx) => { checkpoints.afterTool(event, ctx).catch(() => {}); });
  api.on?.('agent_end', (event, ctx) => { checkpoints.agentEnd(event, ctx).catch(() => {}); });
  api.on?.('gateway_start', () => { checkpoints.sweep().catch(() => {}); });
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params); } catch (error) { return failure(error); }
  });
  method('pinkie.checkpoint.list', params => checkpoints.list(params));
  method('pinkie.checkpoint.preview', params => checkpoints.preview(params));
  method('pinkie.checkpoint.restore', params => checkpoints.restore(params));
  return checkpoints;
}
