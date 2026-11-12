import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {agentOf, channelTitle, isInternalMessage, isInternalSessionKey, isPersona, messageText,
  readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';

// Edit / regenerate / switch work on the transcript tree that OpenClaw already
// keeps (id + parentId). Moving the persisted leaf changes both chat.history and
// the context of the next run, without copying the session (PLAN §4.1 spike).
export const BUSY = '这轮跑完再改';
const MAX_TEXT = 100_000;
const RESTORE_FILE = 'session-branch-restore.json';

const isUserMessage = entry => entry?.type === 'message' && entry.message?.role === 'user'
  && !isInternalMessage(entry.message)
  && !['inter_session', 'internal_system'].includes(entry.message?.provenance?.kind)
  && !['inter_session', 'internal_system'].includes(entry.message?.metadata?.inputProvenance?.kind);
const isChatMessage = entry => entry?.type === 'message' && ['user', 'assistant'].includes(entry.message?.role);

// Siblings of a user message are the user messages that follow the same
// earlier chat message. Gateway bookkeeping (model_change, custom, …) can sit
// between them, so the raw parentId is not enough.
export function messageAnchor(byId, entry) {
  const seen = new Set();
  let id = entry.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = byId.get(id);
    if (!parent) return null;
    if (isChatMessage(parent)) return parent.id;
    id = parent.parentId;
  }
  return null;
}

export function variantsOf(entries, branch) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const order = new Map(entries.map((entry, index) => [entry.id, index]));
  const groups = new Map();
  for (const entry of entries) {
    if (!isUserMessage(entry)) continue;
    const anchor = messageAnchor(byId, entry) ?? '';
    if (!groups.has(anchor)) groups.set(anchor, []);
    groups.get(anchor).push(entry.id);
  }
  const items = [];
  for (const entry of branch) {
    if (!isUserMessage(entry)) continue;
    const siblings = groups.get(messageAnchor(byId, entry) ?? '') || [];
    if (siblings.length < 2) continue;
    siblings.sort((a, b) => order.get(a) - order.get(b));
    items.push({entryId: entry.id, index: siblings.indexOf(entry.id) + 1, total: siblings.length, siblings: [...siblings]});
  }
  return items;
}

// The newest entry below `rootId` (inclusive), by file order.
export function latestLeafUnder(entries, rootId) {
  const children = new Map();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    if (!children.has(entry.parentId)) children.set(entry.parentId, []);
    children.get(entry.parentId).push(entry.id);
  }
  const order = new Map(entries.map((entry, index) => [entry.id, index]));
  let best = rootId;
  const stack = [rootId], seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if ((order.get(id) ?? -1) > (order.get(best) ?? -1)) best = id;
    for (const child of children.get(id) || []) stack.push(child);
  }
  return best;
}

export function userTextOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('') : messageText(message);
}

export function imageAttachmentsOf(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.filter(part => part?.type === 'image' && typeof part.data === 'string' && part.data)
    .map(part => ({type: 'image', mimeType: part.mimeType || 'image/png', content: part.data}));
}

// SessionManager.open() rewrites a transcript that has no header yet (a fresh
// session before its first run flushes). Doing that while a run is writing
// makes OpenClaw treat the file as taken over and drop the reply, so readers
// only open files that already start with a session header.
export function hasSessionHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(65536);
    const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, size).toString('utf8');
    const end = text.indexOf('\n');
    if (end < 0) return size === buffer.length; // one very long first line: not empty
    const record = JSON.parse(text.slice(0, end));
    return Boolean(record && typeof record === 'object' && typeof record.type === 'string');
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

export class SessionBranches {
  constructor(api, {access, root, lineage, isBusy = () => false, now = Date.now}) {
    this.api = api;
    this.access = access;
    this.lineage = lineage;
    this.isBusy = isBusy;
    this.now = now;
    this.restoreFile = path.join(root, RESTORE_FILE);
    this.locks = new Map();
  }

  async tools() {
    const [sessions, harness] = await Promise.all([
      this.access.sdk?.('agent-sessions'), this.access.sdk?.('agent-harness-runtime'),
    ]);
    if (!sessions?.SessionManager || !harness?.acquireSessionWriteLock) throw new Error('暂时不能改这条消息，请稍后再试');
    return {SessionManager: sessions.SessionManager, acquireSessionWriteLock: harness.acquireSessionWriteLock};
  }

  async entryFor(key, {write = false} = {}) {
    if (!agentOf(key) || isInternalSessionKey(key)) throw new Error('找不到这条会话');
    const entry = await this.access.entry(key);
    if (!entry?.transcript || !fs.existsSync(entry.transcript)) throw new Error('找不到这条会话');
    if (write) {
      if (isPersona(key)) throw new Error('分身会话不能改');
      if (channelTitle(entry, key)) throw new Error('渠道会话撤不回已发出的消息，不能改');
      if (entry.archivedAt) throw new Error('已归档的会话不能改');
    }
    return entry;
  }

  async busy(key) {
    if (this.isBusy(key)) return true;
    try {
      const data = await this.access.rpc('sessions.list', {agentId: agentOf(key), archived: false, limit: 1000});
      const row = (data.sessions || []).find(item => item.key === key);
      if (this.lineage?.busy) return this.lineage.busy(key, row);
      return Boolean(row?.hasActiveRun || row?.hasActiveSubagentRun);
    } catch { return false; }
  }

  // One branch operation per session at a time, under OpenClaw's own write
  // lock, so we never race a run that is appending to the same file.
  serial(key, work) {
    const task = (this.locks.get(key) || Promise.resolve()).catch(() => {}).then(work);
    this.locks.set(key, task);
    return task.finally(() => { if (this.locks.get(key) === task) this.locks.delete(key); });
  }

  async withSession(entry, work) {
    const {SessionManager, acquireSessionWriteLock} = await this.tools();
    let lock;
    try { lock = await acquireSessionWriteLock({sessionFile: entry.transcript, timeoutMs: 1000}); }
    catch { throw new Error(BUSY); }
    try {
      if (!hasSessionHeader(entry.transcript)) throw new Error('这条会话还没有可改的消息');
      const session = SessionManager.open(entry.transcript);
      return await work(session);
    } finally { await lock.release(); }
  }

  userOnBranch(session, entryId) {
    const target = session.getBranch().find(item => item.id === entryId);
    if (!target || !isUserMessage(target)) throw new Error('找不到当前分支里的这条消息');
    return target;
  }

  moveLeaf(session, targetId) {
    if (targetId) session.branch(targetId); else session.resetLeaf();
    session.rewriteFile();
  }

  // Read-only: no write lock. Taking OpenClaw's write lock in-process while a
  // run is appending counts as a takeover and the run's reply is not saved.
  async variants(key) {
    const entry = await this.entryFor(key);
    if (!hasSessionHeader(entry.transcript)) return {ok: true, items: []};
    const {SessionManager} = await this.tools();
    const session = SessionManager.open(entry.transcript);
    return {ok: true, items: variantsOf(session.getEntries(), session.getBranch())};
  }

  async switchTo(key, entryId) {
    return this.serial(key, async () => {
      const entry = await this.entryFor(key);
      if (await this.busy(key)) throw new Error(BUSY);
      return this.withSession(entry, session => {
        const entries = session.getEntries();
        const target = entries.find(item => item.id === entryId);
        if (!target || !isUserMessage(target)) throw new Error('找不到这个版本');
        const branchIds = new Set(session.getBranch().map(item => item.id));
        const byId = new Map(entries.map(item => [item.id, item]));
        const anchor = messageAnchor(byId, target);
        // Only a sibling of a user message on the current path is reachable.
        const reachable = anchor === null || branchIds.has(anchor);
        if (!reachable) throw new Error('找不到这个版本');
        this.moveLeaf(session, latestLeafUnder(entries, entryId));
        return {ok: true};
      });
    });
  }

  // Move the leaf to just before `entryId` and send `message` as a new sibling.
  // If the send is refused, the old leaf is restored so nothing looks lost.
  async resend(key, entryId, build) {
    return this.serial(key, async () => {
      const entry = await this.entryFor(key, {write: true});
      if (await this.busy(key)) throw new Error(BUSY);
      const prepared = await this.withSession(entry, session => {
        const target = this.userOnBranch(session, entryId);
        const previousLeaf = session.getLeafId();
        const request = build(target);
        this.moveLeaf(session, target.parentId || null);
        return {previousLeaf, request};
      });
      const {request} = prepared;
      try {
        if (request.model) await this.applyModel(key, entry, request.model);
        const result = await this.access.rpc('chat.send', {
          sessionKey: key, agentId: agentOf(key), message: request.text,
          ...(request.attachments?.length ? {attachments: request.attachments} : {}),
          idempotencyKey: 'pinkie-branch-' + randomUUID(),
        });
        if (['error', 'aborted', 'timeout'].includes(result?.status)) throw new Error('send-failed');
        const runId = result?.runId || '';
        if (request.model) this.restoreAfter(key, runId);
        return {ok: true, runId};
      } catch (error) {
        if (request.model) await this.restoreModel(key).catch(() => {});
        await this.withSession(entry, session => {
          if (prepared.previousLeaf && session.getEntry(prepared.previousLeaf)) this.moveLeaf(session, prepared.previousLeaf);
        }).catch(() => {});
        throw new Error(error?.message === BUSY ? BUSY : '没有发出去，原来的内容已恢复');
      }
    });
  }

  edit(key, entryId, text, attachments) {
    const value = String(text ?? '');
    if (!value.trim() && !attachments?.length) return Promise.reject(new Error('请写点内容再发送'));
    if (value.length > MAX_TEXT) return Promise.reject(new Error('内容太长了'));
    return this.resend(key, entryId, () => ({text: value, attachments: Array.isArray(attachments) ? attachments : []}));
  }

  regenerate(key, entryId, model) {
    if (model !== undefined && model !== null && (typeof model !== 'string' || !/^[\w.:@/-]{1,200}$/u.test(model))) {
      return Promise.reject(new Error('模型名称不对'));
    }
    return this.resend(key, entryId, target => ({
      text: userTextOf(target.message), attachments: imageAttachmentsOf(target.message), model: model || undefined,
    }));
  }

  // A one-off model: patch it for this run, put the previous choice back when
  // the run ends. The pending restore is persisted so a restart still undoes it.
  async applyModel(key, entry, model) {
    const previous = entry.modelOverride
      ? (entry.providerOverride ? entry.providerOverride + '/' + entry.modelOverride : entry.modelOverride) : null;
    const pending = readSessionJson(this.restoreFile);
    if (!pending[key]) {
      pending[key] = {model: previous, at: this.now()};
      writeSessionJson(this.restoreFile, pending);
    }
    await this.access.rpc('sessions.patch', {key, agentId: agentOf(key), model});
  }

  async restoreModel(key) {
    const pending = readSessionJson(this.restoreFile);
    if (!pending[key]) return;
    await this.access.rpc('sessions.patch', {key, agentId: agentOf(key), model: pending[key].model ?? null});
    delete pending[key];
    writeSessionJson(this.restoreFile, pending);
  }

  restoreAfter(key, runId) {
    const wait = runId
      ? this.access.rpc('agent.wait', {runId, timeoutMs: 30 * 60_000}).catch(() => {})
      : Promise.resolve();
    wait.then(() => this.restoreModel(key)).catch(() => {});
  }

  restorePending() {
    for (const key of Object.keys(readSessionJson(this.restoreFile))) this.restoreModel(key).catch(() => {});
  }
}

const FEEDBACK_FILE = 'feedback.jsonl';
export function recordFeedback(root, {key, entryId, rating, note}, now = Date.now) {
  if (!agentOf(key) || typeof entryId !== 'string' || !entryId) throw new Error('找不到这条消息');
  if (![null, 'up', 'down'].includes(rating ?? null)) throw new Error('评价不对');
  const text = typeof note === 'string' ? note.trim().slice(0, 2000) : '';
  fs.mkdirSync(root, {recursive: true});
  const line = JSON.stringify({ts: new Date(now()).toISOString(), key, entryId, rating: rating ?? null, ...(text ? {note: text} : {})});
  fs.appendFileSync(path.join(root, FEEDBACK_FILE), line + '\n', {mode: 0o600});
  return {ok: true};
}

export function feedbackState(root, key) {
  const file = path.join(root, FEEDBACK_FILE);
  const ratings = {};
  if (!fs.existsSync(file)) return {ok: true, ratings};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    try {
      const row = JSON.parse(line);
      if (row.key === key) ratings[row.entryId] = row.rating;
    } catch {}
  }
  for (const id of Object.keys(ratings)) if (!ratings[id]) delete ratings[id];
  return {ok: true, ratings};
}

const EXPECTED = /^(?:这轮跑完再改|找不到|分身会话不能改|渠道会话|已归档的会话不能改|请写点内容|内容太长|模型名称不对|没有发出去|暂时不能改这条消息)/u;
const failure = error => ({ok: false, error: EXPECTED.test(String(error?.message || '')) ? error.message : '没改成，请稍后再试'});

export function registerSessionBranches(api, {titles, root, lineage, isBusy}) {
  const branches = new SessionBranches(api, {access: titles.access, root, lineage, isBusy});
  api.on?.('gateway_start', () => { try { branches.restorePending(); } catch {} });
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params); } catch (error) { return failure(error); }
  });
  method('pinkie.chat.edit', ({key, entryId, text, attachments}) => branches.edit(key, entryId, text, attachments));
  method('pinkie.chat.regenerate', ({key, entryId, model}) => branches.regenerate(key, entryId, model));
  method('pinkie.chat.variants', ({key}) => branches.variants(key));
  method('pinkie.chat.switch', ({key, entryId}) => branches.switchTo(key, entryId));
  method('pinkie.feedback.record', params => recordFeedback(root, params));
  method('pinkie.feedback.get', ({key}) => feedbackState(root, key));
  return branches;
}
