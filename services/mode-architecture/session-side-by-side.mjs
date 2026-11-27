import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {agentOf, isInternalMessage, logSessionFailure, readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';
import {BUSY, SessionBranches, hasSessionHeader, imageAttachmentsOf, userTextOf} from './session-branch.mjs';
import {REVIEW_TOOLS} from './reasoning.mjs';

// A5 并排答（briefs/program-1120/设计-A5.md 第四节）：同一道题、同一轮，两个模型各在一个
// 临时会话里跑，各自流式；用户选一边后，把「这道题 + 选中的回复」写回父会话，落选的一边也作为
// 兄弟版本写进去（走现有「上一版 / 下一版」）。两个临时会话的键带 `:internal-session-effects:`，
// 和审稿员一样不进侧栏、不起标题、不进会话搜索。
//
// 工具：两边只放行 REVIEW_TOOLS。chat.send 要内核支持 toolsAllow 才能限制（cle-core
// core/a5-tools-allow）；内核不支持时不开始比较（不静默放开全部工具）。before_tool_call 另外
// 拦一层，内核漏了也只能用只读工具。
export const SIDES = Object.freeze(['left', 'right']);
export const COMPARING = '并排答进行中，选一边或停掉比较后再发';
export const TOOLS_UNAVAILABLE = '这一版还不能限制工具，并排答暂不可用';
export const SAME_MODEL = '两边是同一个模型，请改用「重新回答」';
export const LOST = '这次比较没保住，可以重新发起';
export const READ_ONLY = '并排答里两边都只能用只读工具（read / image / pdf / web_fetch / web_search），这一步没有执行。';
export const NOT_COMPARING = '这个会话现在没有并排答';
export const CHANGED = '父会话变了，这次比较没法写回';
export const COMPARE_TIMEOUT_MS = 30 * 60_000;
export const CHAT_SEND_TOOLS_ALLOW = 'chat.send.toolsAllow';
const MAX_AGE_MS = 24 * 60 * 60_000;
const POLL_MS = 10_000;
const MAX_TEXT = 100_000;
const STATE_FILE = 'side-by-side.json';
const MODEL = /^[\w.:@/-]{1,200}$/u;
const SIDE_KEY = /^agent:[a-z\d][a-z\d_-]*:internal-session-effects:pinkie-side-[0-9a-f-]{36}-(?:left|right)$/i;
const TOKEN_FIELDS = Object.freeze(['inputTokens', 'outputTokens', 'totalTokens']);

const userError = message => Object.assign(new Error(message), {expected: true});
export const isSideKey = key => typeof key === 'string' && SIDE_KEY.test(key);
export const sideKeyFor = (agentId, id, side) => `agent:${agentId}:internal-session-effects:pinkie-side-${id}-${side}`;

// 内核是否支持 chat.send 带 toolsAllow。字段名以 cle-core core/a5-tools-allow 落地后为准；
// 认不出来一律当不支持。
export function kernelToolsAllow(api) {
  const features = api?.runtime?.features;
  if (Array.isArray(features)) return features.includes(CHAT_SEND_TOOLS_ALLOW);
  return Boolean(features && typeof features === 'object' && features[CHAT_SEND_TOOLS_ALLOW] === true);
}

export function validateModels(models) {
  if (!Array.isArray(models) || models.length !== 2) throw userError('请选两个模型');
  const pair = models.map(model => (typeof model === 'string' ? model.trim() : ''));
  if (!pair.every(model => MODEL.test(model))) throw userError('模型名称不对');
  if (pair[0] === pair[1]) throw userError(SAME_MODEL);
  return pair;
}

export function phaseOf(record, now = Date.now()) {
  if (!record) return 'none';
  if (record.lost || now - Number(record.createdAt || 0) > MAX_AGE_MS) return 'lost';
  return SIDES.some(side => record.sides?.[side]?.status === 'running') ? 'running' : 'choosing';
}

// 合计只算两个临时会话，不含父会话历史用量。
export function usageOf(rows, record) {
  const byKey = new Map((Array.isArray(rows) ? rows : []).map(row => [row?.key, row]));
  const total = Object.fromEntries(TOKEN_FIELDS.map(field => [field, 0]));
  const sides = {};
  for (const side of SIDES) {
    const row = byKey.get(record.sides[side].key) || {};
    sides[side] = {};
    for (const field of TOKEN_FIELDS) {
      const value = Number(row[field]);
      sides[side][field] = Number.isFinite(value) && value > 0 ? value : 0;
      total[field] += sides[side][field];
    }
  }
  return {sides, total};
}

const isPrompt = entry => entry?.type === 'message' && entry.message?.role === 'user' && !isInternalMessage(entry.message);
const isTurnMessage = entry => entry?.type === 'message' && ['assistant', 'toolResult'].includes(entry.message?.role);
const hasReply = turn => Boolean(turn?.reply?.some(entry => entry.message?.role === 'assistant'));

// 临时会话当前分支上最后一道题和它之后的这一轮（助手消息和工具结果）。
export function replyTurn(branch) {
  const list = Array.isArray(branch) ? branch : [];
  for (let index = list.length - 1; index >= 0; index--) {
    if (isPrompt(list[index])) return {user: list[index], reply: list.slice(index + 1).filter(isTurnMessage)};
  }
  return {user: null, reply: []};
}

export function sideToolGuard(event = {}, ctx = {}) {
  if (!isSideKey(String(ctx?.sessionKey || event?.sessionKey || ''))) return undefined;
  const tool = String(event?.toolName || event?.name || '');
  return REVIEW_TOOLS.includes(tool) ? undefined : {block: true, blockReason: READ_ONLY};
}

const sideError = error => String(error?.message || error || '这一边没答完').slice(0, 300);
const sideRecord = (agentId, id, side, model) => ({key: sideKeyFor(agentId, id, side), model, status: 'running', runId: '', error: ''});

export class SideBySide {
  constructor(api, {access, root, branches, isBusy = () => false, toolsAllowSupported, now = Date.now,
    timeoutMs = COMPARE_TIMEOUT_MS, pollMs = POLL_MS}) {
    this.api = api;
    this.access = access;
    this.isBusy = isBusy;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.toolsAllowSupported = toolsAllowSupported || (() => kernelToolsAllow(api));
    this.branches = branches || new SessionBranches(api, {access, root, isBusy});
    this.file = path.join(root, STATE_FILE);
    this.watches = new Set();
  }

  all() {
    try {
      const data = readSessionJson(this.file);
      return data.comparisons && typeof data.comparisons === 'object' ? data.comparisons : {};
    } catch { return {}; }
  }
  record(key) { const all = this.all(); return Object.hasOwn(all, key) ? all[key] : null; }
  put(record) { const all = this.all(); all[record.parentKey] = record; writeSessionJson(this.file, {comparisons: all}); }
  forget(key, id) {
    const all = this.all();
    if (!all[key] || (id && all[key].id !== id)) return;
    delete all[key];
    writeSessionJson(this.file, {comparisons: all});
  }
  update(key, id, change) {
    const all = this.all();
    const record = all[key];
    if (!record || record.id !== id) return null;
    change(record);
    writeSessionJson(this.file, {comparisons: all});
    return record;
  }
  isComparing(key) { const record = this.record(key); return Boolean(record) && phaseOf(record, this.now()) !== 'lost'; }
  async settled() { while (this.watches.size) await Promise.allSettled([...this.watches]); }

  // 比较中的父会话自己的标记不算「在跑」，只看真正的运行。
  async parentRunning(key) {
    if (this.isBusy(key)) return true;
    try {
      const data = await this.access.rpc('sessions.list', {agentId: agentOf(key), archived: false, limit: 1000});
      const row = (data?.sessions || []).find(item => item.key === key);
      return Boolean(row?.hasActiveRun || row?.hasActiveSubagentRun);
    } catch { return false; }
  }

  liveRecord(key) {
    const record = this.record(key);
    if (!record || phaseOf(record, this.now()) === 'lost') throw userError(NOT_COMPARING);
    return record;
  }

  start({key, models, entryId, text, attachments} = {}) {
    let pair;
    try { pair = validateModels(models); } catch (error) { return Promise.reject(error); }
    return this.branches.serial(key, () => this.begin(key, pair, {entryId, text, attachments}));
  }

  async begin(key, [left, right], request) {
    if (this.isComparing(key)) throw userError(COMPARING);
    const entry = await this.branches.entryFor(key, {write: true});
    if (await this.parentRunning(key)) throw new Error(BUSY);
    if (!this.toolsAllowSupported()) throw userError(TOOLS_UNAVAILABLE);
    const prepared = await this.prepare(entry, request);
    const agentId = agentOf(key), id = randomUUID();
    const record = {id, parentKey: key, agentId, entryId: prepared.entryId, base: prepared.base, createdAt: this.now(),
      models: [left, right], sides: {left: sideRecord(agentId, id, 'left', left), right: sideRecord(agentId, id, 'right', right)}};
    // 先落盘再建会话：中途崩了，重启时还能找到并清掉两个临时会话。
    this.put(record);
    try {
      for (const side of SIDES) await this.createSide(agentId, record.sides[side], prepared.history);
    } catch (error) {
      await this.cleanup(record);
      this.forget(key, id);
      throw error;
    }
    const sent = await Promise.allSettled(SIDES.map(side => this.send(agentId, record.sides[side], prepared)));
    if (sent.every(result => result.status === 'rejected')) {
      await this.cleanup(record);
      this.forget(key, id);
      throw userError('两边都没有发出去，原来的内容没动');
    }
    SIDES.forEach((side, index) => {
      const result = sent[index], target = record.sides[side];
      if (result.status === 'rejected') Object.assign(target, {status: 'error', error: sideError(result.reason)});
      else if (!result.value) Object.assign(target, {status: 'error', error: '没拿到这一边的运行编号'});
      else target.runId = result.value;
    });
    this.put(record);
    for (const side of SIDES) if (record.sides[side].status === 'running') this.watch(key, id, side, record.sides[side].runId);
    return this.view(record);
  }

  async prepare(entry, {entryId, text, attachments}) {
    if (entryId !== undefined && entryId !== null) {
      if (typeof entryId !== 'string' || !entryId) throw userError('找不到当前分支里的这条消息');
      return this.branches.withSession(entry, session => {
        const target = this.branches.userOnBranch(session, entryId);
        const base = target.parentId || null;
        return {entryId, base, history: base ? branchCopy(session, base, entry.transcript) : null,
          text: userTextOf(target.message), attachments: imageAttachmentsOf(target.message)};
      });
    }
    const value = String(text ?? '');
    const files = Array.isArray(attachments) ? attachments : [];
    if (!value.trim() && !files.length) throw userError('请写点内容再发送');
    if (value.length > MAX_TEXT) throw userError('内容太长了');
    // 写回要在父会话记录里接着写；还没有记录头的新会话先发一句再用。
    if (!hasSessionHeader(entry.transcript)) throw userError('先在这个会话里发一句，再用并排答');
    return this.branches.withSession(entry, session => {
      const base = session.getLeafId() || null;
      return {entryId: null, base, history: base ? branchCopy(session, base, entry.transcript) : null, text: value, attachments: files};
    });
  }

  async createSide(agentId, side, history) {
    let created;
    try { created = await this.access.rpc('sessions.create', {agentId, key: side.key, model: side.model}); }
    catch (error) {
      throw userError(/model/i.test(String(error?.message || '')) ? `模型「${side.model}」开不起来，换一个` : '没能建立并排会话，请稍后再试');
    }
    if (created?.key !== side.key) throw userError('没能建立并排会话，请稍后再试');
    if (!history?.length) return;
    const entry = await this.access.entry(side.key);
    if (!entry?.transcript || !entry.sessionId) throw userError('没能建立并排会话，请稍后再试');
    const lines = [...history];
    lines[0] = JSON.stringify({...JSON.parse(lines[0]), id: entry.sessionId});
    const temporary = entry.transcript + '.' + randomUUID() + '.tmp';
    try {
      fs.mkdirSync(path.dirname(entry.transcript), {recursive: true, mode: 0o700});
      fs.writeFileSync(temporary, lines.join('\n') + '\n', {mode: 0o600, flag: 'wx'});
      fs.renameSync(temporary, entry.transcript);
    } finally { fs.rmSync(temporary, {force: true}); }
  }

  async send(agentId, side, prepared) {
    const result = await this.access.rpc('chat.send', {
      sessionKey: side.key, agentId, message: prepared.text,
      ...(prepared.attachments?.length ? {attachments: prepared.attachments} : {}),
      toolsAllow: [...REVIEW_TOOLS],
      idempotencyKey: 'pinkie-side-' + randomUUID(),
    });
    if (['error', 'aborted', 'timeout'].includes(result?.status)) throw new Error(String(result?.error || result.status));
    return result?.runId || '';
  }

  // agent.wait 分小段等：网关调用本身有 15 秒超时，一次等 30 分钟会被当成失败。
  async waitRun(runId) {
    const deadline = this.now() + this.timeoutMs;
    let failures = 0;
    while (this.now() < deadline) {
      let result;
      try {
        result = await this.access.rpc('agent.wait', {runId, timeoutMs: Math.max(1, Math.min(this.pollMs, deadline - this.now()))});
        failures = 0;
      } catch (error) {
        if (++failures >= 3) return {status: 'error', error: sideError(error)};
        continue;
      }
      const status = String(result?.status || '');
      if (status === 'timeout') continue;
      return status === 'ok' ? {status: 'final'} : {status: 'error', error: sideError(result?.error || status || '这一边没答完')};
    }
    return {status: 'timeout'};
  }

  watch(parentKey, id, side, runId) {
    const task = this.waitRun(runId).then(async outcome => {
      if (outcome.status === 'timeout') {
        const record = this.record(parentKey);
        if (record?.id === id) await this.stopSide(record, side, '超过 30 分钟没答完，已停下');
        return;
      }
      this.update(parentKey, id, record => {
        const target = record.sides[side];
        if (target.status === 'running') Object.assign(target, {status: outcome.status, error: outcome.error || ''});
      });
    }).catch(() => {});
    this.watches.add(task);
    task.finally(() => this.watches.delete(task));
  }

  async stopSide(record, side, reason = '已停下') {
    const target = record.sides[side];
    try { await this.access.rpc('chat.abort', {sessionKey: target.key, agentId: record.agentId, preserveSideRuns: false}, {admin: true}); }
    catch { logSessionFailure(this.api, 'side-by-side', target.key, 'abort'); }
    this.update(record.parentKey, record.id, current => {
      const one = current.sides[side];
      if (one.status === 'running') Object.assign(one, {status: 'aborted', error: reason});
    });
  }

  async abort({key, side} = {}) {
    const record = this.liveRecord(key);
    if (side !== undefined && side !== null && !SIDES.includes(side)) throw userError('选左边还是右边？');
    for (const one of side ? [side] : SIDES) if (record.sides[one].status === 'running') await this.stopSide(record, one);
    return this.view(this.record(key));
  }

  async readTurn(side) {
    const entry = await this.access.entry(side.key);
    if (!entry?.transcript || !hasSessionHeader(entry.transcript)) return null;
    const {SessionManager} = await this.branches.tools();
    return replyTurn(SessionManager.open(entry.transcript).getBranch());
  }

  adopt({key, side} = {}) {
    return this.branches.serial(key, async () => {
      const record = this.liveRecord(key);
      if (!SIDES.includes(side)) throw userError('选左边还是右边？');
      const chosen = record.sides[side];
      if (chosen.status === 'running') throw userError('这一边还没答完，等它答完再选');
      if (chosen.status !== 'final') throw userError('这一边没有答完，不能选');
      const otherSide = SIDES.find(one => one !== side);
      if (record.sides[otherSide].status === 'running') await this.stopSide(record, otherSide, '选了另一边，这一边已停下');
      const entry = await this.branches.entryFor(key, {write: true});
      if (await this.parentRunning(key)) throw new Error(BUSY);
      const chosenTurn = await this.readTurn(chosen);
      if (!hasReply(chosenTurn)) throw userError('这一边没有可用的回复');
      const other = this.record(key)?.sides?.[otherSide];
      const otherTurn = other?.status === 'final' ? await this.readTurn(other).catch(() => null) : null;
      const leaf = await this.branches.withSession(entry, session => this.writeBack(session, record, chosenTurn, hasReply(otherTurn) ? otherTurn : null));
      // 选边后父会话改用选中那边的模型（持久，win-coord 已定）。
      let modelSaved = true;
      try { await this.access.rpc('sessions.patch', {key, agentId: record.agentId, model: chosen.model}); }
      catch { modelSaved = false; }
      await this.cleanup(record);
      this.forget(key, record.id);
      return {ok: true, leaf, model: chosen.model, modelSaved};
    });
  }

  // 在父会话 transcript 里写真正的用户消息和助手消息（下一轮模型看得到），不用 chat.inject。
  // 落选的一版先写、选中的最后写，当前叶停在选中的一版。
  writeBack(session, record, chosenTurn, otherTurn) {
    const byId = new Map(session.getEntries().map(item => [item.id, item]));
    if (record.base && !byId.has(record.base)) throw userError(CHANGED);
    let prompt = null;
    if (record.entryId) {
      prompt = byId.get(record.entryId);
      if (!isPrompt(prompt) || (prompt.parentId || null) !== record.base) throw userError(CHANGED);
    }
    const write = turn => {
      if (record.base) session.branch(record.base); else session.resetLeaf();
      let last = session.appendMessage(structuredClone((prompt || turn.user).message));
      for (const item of turn.reply) last = session.appendMessage(structuredClone(item.message));
      return last;
    };
    if (otherTurn) write(otherTurn);
    const leaf = write(chosenTurn);
    this.branches.moveLeaf(session, leaf);
    return leaf;
  }

  discard({key} = {}) {
    return this.branches.serial(key, async () => {
      const record = this.record(key);
      if (!record) throw userError(NOT_COMPARING);
      for (const side of SIDES) if (record.sides[side].status === 'running') await this.stopSide(record, side);
      await this.cleanup(record);
      this.forget(key, record.id);
      return {ok: true};
    });
  }

  async status({key} = {}) {
    const record = this.record(key);
    if (!record) return {ok: true, active: false, phase: 'none'};
    if (phaseOf(record, this.now()) === 'lost') {
      await this.cleanup(record);
      this.forget(key, record.id);
      return {ok: true, active: false, phase: 'lost', message: LOST};
    }
    let usage = null;
    try {
      const data = await this.access.rpc('sessions.list', {agentId: record.agentId, archived: false, limit: 1000});
      usage = usageOf(data?.sessions, record);
    } catch {}
    return {...this.view(record), usage};
  }

  view(record) {
    const sides = Object.fromEntries(SIDES.map(side => {
      const {key, model, status, error} = record.sides[side];
      return [side, {key, model, status, ...(error ? {error} : {})}];
    }));
    return {ok: true, active: true, phase: phaseOf(record, this.now()), id: record.id, entryId: record.entryId, models: [...record.models], sides};
  }

  // 重启：还在跑的接着等；只剩结果的进入待选边；临时会话没了的那一边算失败，两边都没了就是没保住。
  async recover() {
    for (const record of Object.values(this.all())) {
      if (phaseOf(record, this.now()) === 'lost') {
        if (!record.lost) this.update(record.parentKey, record.id, current => { current.lost = true; });
        await this.cleanup(record);
        continue;
      }
      let missing = 0;
      for (const side of SIDES) {
        let entry = null;
        try { entry = await this.access.entry(record.sides[side].key); } catch {}
        const target = record.sides[side];
        if (!entry) {
          missing++;
          this.update(record.parentKey, record.id, current => Object.assign(current.sides[side], {status: 'error', error: '这一边的记录没了'}));
        } else if (target.status === 'running') {
          if (target.runId) this.watch(record.parentKey, record.id, side, target.runId);
          else this.update(record.parentKey, record.id, current => Object.assign(current.sides[side], {status: 'error', error: '没拿到这一边的运行编号'}));
        }
      }
      if (missing === SIDES.length) {
        this.update(record.parentKey, record.id, current => { current.lost = true; });
        await this.cleanup(record);
      }
    }
  }

  // 只在比较中拦父会话自己的新一轮（输入框按 busy 处理，后端也兜一层）。
  runGate(event = {}, ctx = {}) {
    const key = String(ctx?.sessionKey || event?.sessionKey || '');
    if (!agentOf(key) || isSideKey(key) || !this.isComparing(key)) return undefined;
    return {outcome: 'block', reason: 'pinkie-side-by-side', message: COMPARING};
  }

  async cleanup(record) {
    for (const side of SIDES) await this.deleteSide(record.agentId, record.sides[side].key);
  }

  async deleteSide(agentId, key) {
    let entry = null;
    try { entry = await this.access.entry(key); } catch {}
    const gone = error => /not found|no such session|unknown session|不存在/i.test(String(error?.message || ''));
    try { await this.access.rpc('sessions.delete', {key, agentId, deleteTranscript: true}, {admin: true}); }
    catch (error) {
      if (!gone(error)) {
        try { await this.access.rpc('sessions.delete', {key, agentId, deleteTranscript: true}); }
        catch (again) { if (!gone(again)) logSessionFailure(this.api, 'side-by-side', key, 'delete'); }
      }
    }
    if (!entry?.transcript) return;
    const dir = path.dirname(entry.transcript), id = String(entry.sessionId || '');
    if (id && /^[\w.-]+$/.test(id)) {
      try { for (const name of fs.readdirSync(dir)) if (name.startsWith(id + '.')) fs.rmSync(path.join(dir, name), {force: true}); } catch {}
    }
    fs.rmSync(entry.transcript, {force: true});
  }
}

// 复制父会话从根到 leafId 的这一段，给临时会话当历史。
function branchCopy(session, leafId, parentFile) {
  const file = session.createBranchedSession(leafId);
  if (!file || path.resolve(file) === path.resolve(parentFile)) throw userError('暂时不能复制这条会话的记录');
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (!lines.length) throw userError('暂时不能复制这条会话的记录');
    return lines;
  } finally { fs.rmSync(file, {force: true}); }
}

const EXPECTED = new RegExp(`^(?:${BUSY}|找不到|分身会话不能改|渠道会话|已归档的会话不能改|暂时不能改这条消息|这条会话还没有可改的消息)`, 'u');
const failure = error => ({ok: false, error: error?.expected || EXPECTED.test(String(error?.message || '')) ? error.message : '没办成，请稍后再试'});

export function registerSessionSideBySide(api, {titles, root, branches, isBusy, toolsAllowSupported} = {}) {
  const sides = new SideBySide(api, {access: titles.access, root, branches, isBusy, toolsAllowSupported});
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return failure(error); }
  });
  method('pinkie.chat.sideBySide', params => sides.start(params));
  method('pinkie.chat.sideBySide.adopt', params => sides.adopt(params));
  method('pinkie.chat.sideBySide.abort', params => sides.abort(params));
  method('pinkie.chat.sideBySide.discard', params => sides.discard(params));
  method('pinkie.chat.sideBySide.status', params => sides.status(params));
  api.on?.('before_tool_call', (event, ctx) => sideToolGuard(event, ctx), {priority: 10800});
  api.on?.('before_agent_run', (event, ctx) => { try { return sides.runGate(event, ctx); } catch { return undefined; } }, {priority: 10850});
  api.on?.('gateway_start', () => { sides.recover().catch(() => {}); });
  return sides;
}
