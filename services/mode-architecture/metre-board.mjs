// Metre 总控台的数据（briefs/metre-mode-1113 PLAN 2.12、BOARD-HANDOFF.md，批 5）。
//
// 一个只读接口 `pinkie.metre.board {sessionKey}`，一次返回 overview / plan / sessions / pending / timeline / changes / runtime / raw。
// 项目记忆区读已有的 `pinkie.metre.memory`，这里不重复。
//
// 数据从两处来：
//   1. 现成的：血缘和卡片（session-lineage）、计划清单（plan_update 的存储）、模型健康（model-health）、网关的会话列表（用量、上下文）。
//   2. 这里自己记的一本小账（每个 Metre 父会话一份，<状态目录>/metre-board/<键>.json）：
//      每个子会话哪段时间在干活（画总谱用）、此刻在做什么、动过哪些文件、时间线、待回答的提问、用量、原始事件。
//      只记 Metre 父会话和它的子会话，别的模式的会话一概不碰。
// 另外两个按钮：`pinkie.metre.resume`（全停之后「接着做」，给 Metre 发一句继续的话）。暂停、全停在 session-lineage 里。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {agentOf, clipGraphemes, isInternalMessage, messageText, readSessionJson, registerSessionMethod} from './session-titles.mjs';
import {isMetreKey} from './session-lineage.mjs';
import {getActiveMetreLock} from './metre-lock.mjs';

export const RAW_LIMIT = 200;
export const TIMELINE_LIMIT = 120;
const SPAN_LIMIT = 60;
const ERROR_LIMIT = 20;
const FILE_LIMIT = 80;
const MODE_NAMES = {chat: '唠嗑模式', project: '项目模式', ideas: '想法模式', learning: '学习模式', unrestricted: '无限制模式', metre: 'Metre'};
const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'multi_edit', 'apply_patch', 'str_replace', 'create_file', 'write_file', 'edit_file']);
const STATUS_WORDS = {queued: '排队', running: '在跑', waiting: '等回复', done: '已交回', failed: '失败', stopped: '已停', interrupted: '中断了'};
const BOARD_STATE = {queued: 'wait', running: 'run', waiting: 'wait', done: 'done', failed: 'fail', stopped: 'wait', interrupted: 'fail'};

const clip = (text, n) => clipGraphemes(String(text ?? '').replace(/\s+/gu, ' ').trim(), n);
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const lines = text => typeof text === 'string' && text ? text.split(/\r?\n/u).length : 0;
const baseName = file => String(file || '').split(/[\\/]/u).filter(Boolean).pop() || '';

// The role mechanism is developed separately. An absent reader (e.g. an
// older bundle) must not break the board or look like zero validated cards.
async function loadMetreRoleCatalog() {
  const {loadRoles} = await import('./metre-roles.mjs');
  return loadRoles();
}

function metreRoleFields(record, launch, catalog) {
  const role = record.metreRole || launch?.metreRole || '';
  if (!role) return {role: '', roleName: '', roleSource: ''};
  const roleSource = record.metreRoleSource || launch?.metreRoleSource || '';
  const card = catalog.get(role);
  const matchingCard = !roleSource || roleSource === card?.source ? card : null;
  return {role, roleName: record.metreRoleName || launch?.metreRoleName || matchingCard?.name || role,
    roleSource: roleSource || matchingCard?.source || ''};
}

function summarizeMetreRoleCatalog(catalog) {
  if (!Array.isArray(catalog?.roles) && !(catalog?.roles instanceof Map)) return null;
  if (!Array.isArray(catalog.invalid)) return null;
  const roles = new Map(Array.from(catalog.roles.values(), card => [card.id, card]));
  return {roles, status: {valid: Number.isSafeInteger(catalog.validCount) ? catalog.validCount : roles.size,
    invalid: catalog.invalid.length,
    issues: catalog.invalid.map(issue => ({file: baseName(issue.file || issue.filename || issue.id),
      source: issue.source === 'user' ? 'user' : 'official', reason: clip(issue.reason || issue.error || '未提供原因', 240)}))}};
}

// 一次工具调用「在做什么」：工具名 + 对象（文件名、命令第一行、搜索词）。和界面上的状态词同一个意思，不另起一套话术。
export function describeTool(name = '', params = {}) {
  const tool = String(name || '').toLowerCase();
  const target = params.path || params.file_path || params.filePath || params.file || '';
  if (WRITE_TOOLS.has(tool)) return `改 ${baseName(target) || '文件'}`;
  if (/^(?:read|read_file|view)$/.test(tool)) return `读 ${baseName(target) || '文件'}`;
  if (/^(?:exec|bash|shell|run|powershell|process)$/.test(tool)) {
    const line = String(params.command || params.cmd || '').split(/\r?\n/u).map(item => item.trim()).find(Boolean) || '';
    return line ? `跑 ${clip(line, 60)}` : '跑命令';
  }
  if (/search|grep|glob|find/.test(tool)) return `找 ${clip(params.query || params.pattern || params.q || '', 40)}`.trim();
  if (/fetch|browse|web/.test(tool)) return `看网页 ${clip(params.url || params.query || '', 50)}`.trim();
  if (tool === 'plan_update') return '更新计划';
  if (tool === 'ask_user') return '等你回答';
  return clip(tool, 40) || '干活';
}

// 改动的行数：写整个文件算新增；编辑按新旧两段的行数差。拿不到就只记文件名。
export function changeOf(name = '', params = {}) {
  const tool = String(name || '').toLowerCase();
  if (!WRITE_TOOLS.has(tool)) return null;
  const file = params.path || params.file_path || params.filePath || params.file || '';
  if (!file) return null;
  if (typeof params.content === 'string') return {path: String(file), added: lines(params.content), removed: 0};
  if (Array.isArray(params.edits)) {
    let added = 0, removed = 0;
    for (const item of params.edits) { added += lines(item?.new_string ?? item?.newText); removed += lines(item?.old_string ?? item?.oldText); }
    return {path: String(file), added, removed};
  }
  const after = params.new_string ?? params.newText ?? params.new_str;
  const before = params.old_string ?? params.oldText ?? params.old_str;
  return {path: String(file), added: lines(after), removed: lines(before)};
}

export class MetreBoard {
  constructor({root, lineage, plans = null, modelHealth = null, metreRoleCatalog = loadMetreRoleCatalog,
    now = () => Date.now(), schedule = setTimeout}) {
    this.root = root;
    this.lineage = lineage;
    this.plans = plans;
    this.modelHealth = modelHealth;
    this.metreRoleCatalog = metreRoleCatalog;
    this.now = now;
    this.schedule = schedule;
    this.cache = new Map();
    this.loaded = new Map();   // parent → 读进来 / 写出去时文件的修改时间
    this.dirty = new Set();
    this.timer = null;
  }

  // 这个会话归哪个 Metre 父会话管：Metre 父会话本身，或者血缘里父会话是 Metre 的子会话。其余返回空。
  parentOf(key) {
    if (!agentOf(key)) return '';
    const record = this.lineage?.lineage?.()[key];
    if (record) return isMetreKey(record.parentKey) ? record.parentKey : '';
    return isMetreKey(key) ? key : '';
  }

  file(parent) { return path.join(this.root, createHash('sha256').update(parent).digest('hex').slice(0, 24) + '.json'); }
  // 网关里同一个插件可能有不止一个实例（11-15 隔离副本实测：记账的钩子在一个实例里跑，总控台的读数请求落在另一个实例上，
  // 后者一直拿着自己内存里的旧账，子会话一行时间段都没有）。所以每次取账都看一眼文件：别的实例写过、自己又没有没写出去的改动，就重读。
  mtime(parent) {
    try { return fs.statSync(this.file(parent)).mtimeMs; } catch { return 0; }
  }
  journal(parent) {
    let value = this.cache.get(parent);
    if (value && !this.dirty.has(parent)) {
      const mtime = this.mtime(parent);
      if (mtime > (this.loaded.get(parent) || 0)) value = null;
    }
    if (!value) {
      this.loaded.set(parent, this.mtime(parent));
      const stored = readSessionJson(this.file(parent));
      value = {parent, events: [], raw: [], spans: {}, doing: {}, changes: {}, pending: [], errors: [], usage: {}, requestAt: 0,
        ...(stored && stored.parent === parent ? stored : {})};
      this.cache.set(parent, value);
      if (this.cache.size > 32) { const old = this.cache.keys().next().value; this.cache.delete(old); this.loaded.delete(old); }
    }
    return value;
  }
  save(parent) {
    this.dirty.add(parent);
    if (this.timer) return;
    this.timer = this.schedule(() => this.flush(), 500);
    this.timer?.unref?.();
  }
  flush() {
    this.timer = null;
    for (const parent of this.dirty) {
      const value = this.cache.get(parent);
      if (!value) continue;
      try {
        fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
        const file = this.file(parent), temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(value), {mode: 0o600});
        fs.renameSync(temp, file);
        this.loaded.set(parent, this.mtime(parent));
      } catch { /* 总控台的账写不下去不影响干活 */ }
    }
    this.dirty.clear();
  }

  // 每个会话最后一次有动静的时间（开始一轮、调工具、模型回了用量、一轮结束）。上游在重试、卡住时它不动，
  // 总控台据此把「在跑」但很久没动静的行标出来，不让人以为还在正常跑。
  touch(j, key) {
    (j.seen ||= {})[key] = this.now();
  }
  raw(j, event, data) {
    j.raw.push({at: this.now(), event, data});
    if (j.raw.length > RAW_LIMIT) j.raw.splice(0, j.raw.length - RAW_LIMIT);
  }
  event(j, kind, sessionKey, text) {
    j.events.push({at: this.now(), kind, sessionKey, text: clip(text, 160)});
    if (j.events.length > TIMELINE_LIMIT) j.events.splice(0, j.events.length - TIMELINE_LIMIT);
  }
  title(key) {
    const record = this.lineage?.lineage?.()[key];
    return record?.title || (isMetreKey(key) ? 'Metre' : '子会话');
  }

  // ---- 钩子 ----
  runStarted(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || event.sessionKey || '');
    const parent = this.parentOf(key);
    if (!parent) return;
    const j = this.journal(parent);
    this.touch(j, key);
    if (key !== parent) {
      const spans = j.spans[key] ||= [];
      const open = spans.at(-1);
      if (!open || open.to) spans.push({from: this.now(), to: 0, kind: 'run'});
      if (spans.length > SPAN_LIMIT) spans.splice(0, spans.length - SPAN_LIMIT);
    }
    this.raw(j, 'run.start', {session: key === parent ? 'Metre' : this.title(key)});
    this.save(parent);
  }

  messageReceived(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || event.sessionKey || '');
    const parent = this.parentOf(key);
    if (!parent) return;
    const text = messageText(event.content ?? event.body ?? event.prompt);
    if (!text.trim() || isInternalMessage(text) || event.provenance?.kind === 'inter_session') return;
    const j = this.journal(parent);
    // 用户在这个会话里说话了：那边等他回答的提问算处理过了。Metre 父会话里的用户消息开始一件新事，用时从下一次派发算起。
    const before = j.pending.length;
    j.pending = j.pending.filter(item => item.sessionKey !== key);
    if (key === parent) j.requestAt = 0;
    if (before !== j.pending.length || key === parent) this.save(parent);
  }

  toolCalled(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || '');
    const parent = this.parentOf(key);
    if (!parent) return;
    const j = this.journal(parent);
    this.touch(j, key);
    const name = String(event.toolName || event.name || '');
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const failed = Boolean(event.error || event.isError || event.result?.isError);
    const who = key === parent ? 'Metre' : this.title(key);
    this.raw(j, 'tool', {session: who, tool: name, ok: !failed});
    if (key !== parent) j.doing[key] = describeTool(name, params);
    if (failed) {
      j.errors.push({at: this.now(), sessionKey: key, text: clip(`${who} · ${name}：${messageText(event.error || event.result?.content || '') || '出错'}`, 200)});
      if (j.errors.length > ERROR_LIMIT) j.errors.splice(0, j.errors.length - ERROR_LIMIT);
      this.save(parent);
      return;
    }
    const change = changeOf(name, params);
    if (change) {
      const files = j.changes[key] ||= {};
      const row = files[change.path] ||= {added: 0, removed: 0, at: 0};
      row.added += change.added; row.removed += change.removed; row.at = this.now();
      const names = Object.keys(files);
      if (names.length > FILE_LIMIT) for (const old of names.sort((a, b) => files[a].at - files[b].at).slice(0, names.length - FILE_LIMIT)) delete files[old];
    }
    if (name === 'pinkie_session_start' && key === parent) {
      if (!j.requestAt) j.requestAt = this.now();
      const mode = MODE_NAMES[String(params.mode || '')] || '子会话';
      this.event(j, 'dispatch', key, `「${clip(params.title || '新会话', 30)}」交给${mode}${params.model ? ' · ' + params.model : ''}`);
    } else if (name === 'pinkie_mode_ask' && key === parent) {
      this.event(j, 'dispatch', key, `问${MODE_NAMES[String(params.mode || '')] || '另一个模式'}：${clip(params.question, 60)}`);
    } else if (name === 'pinkie_session_message') {
      const to = String(params.session || '');
      this.event(j, 'message', key, `${who} → ${to === parent ? 'Metre' : this.title(to)}：${clip(params.message, 60)}`);
    } else if (name === 'metre_memory' && /^(?:remember|update|forget)$/.test(String(params.action || ''))) {
      this.event(j, 'memory', key, `${{remember: '记下', update: '改了', forget: '忘掉'}[params.action]}：${clip(params.text || params.id || '', 60)}`);
    } else if (name === 'pinkie_sessions' && /^(?:stop|stop_children|archive|delete)$/.test(String(params.action || ''))) {
      this.event(j, 'stop', key, `${who} ${{stop: '停了', stop_children: '停了子会话', archive: '归档了', delete: '删了'}[params.action]}会话`);
    } else if (name === 'ask_user') {
      const text = params.question || params.title || params.prompt || '';
      j.pending.push({id: String(event.toolCallId || ctx.toolCallId || this.now()), kind: 'ask_user', sessionKey: key,
        text: clip(text, 160), askedAt: this.now()});
      if (j.pending.length > 20) j.pending.splice(0, j.pending.length - 20);
    }
    this.save(parent);
  }

  runEnded(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || event.sessionKey || '');
    const parent = this.parentOf(key);
    if (!parent) return;
    const j = this.journal(parent);
    this.touch(j, key);
    const ok = event.success === true;
    const stopped = /abort|cancel|stop requested|interrupted by/i.test(String(event.error || ''));
    if (key !== parent) {
      const open = (j.spans[key] || []).at(-1);
      if (open && !open.to) { open.to = this.now(); open.kind = ok ? 'done' : stopped ? 'wait' : 'fail'; }
      delete j.doing[key];
      const title = this.title(key);
      if (stopped) this.event(j, 'stop', key, `「${title}」停下了`);
      // 一轮跑完不等于交了汇报（汇报是 pinkie_session_report 的卡片，在血缘里另算）：这里只说跑完。
      else if (ok) this.event(j, 'end', key, `「${title}」这一轮跑完`);
      else this.event(j, 'error', key, `「${title}」出错：${clip(event.error || '没说原因', 80)}`);
    } else if (!ok && !stopped) {
      this.event(j, 'error', key, `Metre 这一轮出错：${clip(event.error || '没说原因', 80)}`);
    }
    if (!ok && !stopped && event.error) {
      j.errors.push({at: this.now(), sessionKey: key, text: clip(event.error, 200)});
      if (j.errors.length > ERROR_LIMIT) j.errors.splice(0, j.errors.length - ERROR_LIMIT);
    }
    this.raw(j, 'run.end', {session: key === parent ? 'Metre' : this.title(key), ok, ...(stopped ? {stopped: true} : {})});
    this.save(parent);
  }

  usage(event = {}, ctx = {}) {
    const key = String(ctx.sessionKey || event.sessionKey || '');
    const parent = this.parentOf(key);
    if (!parent) return;
    const j = this.journal(parent);
    this.touch(j, key);
    const u = event.usage || {};
    const row = j.usage[key] ||= {input: 0, output: 0, points: []};
    row.input += num(u.input); row.output += num(u.output);
    row.points.push([this.now(), num(u.input) + num(u.output)]);
    if (row.points.length > 60) row.points.splice(0, row.points.length - 60);
    this.save(parent);
  }

  // ---- 总控台读的那一份 ----
  async board(sessionKey) {
    const parent = this.parentOf(String(sessionKey || ''));
    if (!parent) throw new Error('只有 Metre 会话有总控台');
    const j = this.journal(parent);
    const lineage = this.lineage.lineage();
    const parentState = this.lineage.state(parent);
    let rows = new Map();
    try { rows = await this.lineage.familyRows(parent); } catch { /* 网关列表暂时拿不到：用量和「在跑」退回账本里的记录 */ }
    let metreRoleCatalog = null;
    try { metreRoleCatalog = summarizeMetreRoleCatalog(await this.metreRoleCatalog()); }
    catch { /* diagnostics must never hide the rest of a Metre board */ }
    const metreRoles = metreRoleCatalog?.roles || new Map();
    const now = this.now();
    const launches = Object.values(parentState.launches || {});
    const reports = (parentState.cards || []).filter(card => card.kind === 'report');
    const stoppedKeys = new Set((parentState.lastStop?.children || []).filter(item => item.stopped).map(item => item.key));
    const children = Object.entries(lineage).filter(([, record]) => record.parentKey === parent && record.initiation !== 'consult');
    const keys = new Set(children.map(([key]) => key));
    for (const launch of launches) keys.add(launch.key);

    const sessions = [...keys].map(key => {
      const record = lineage[key] || {};
      const launch = launches.find(item => item.key === key);
      const state = this.lineage.state(key);
      const row = rows.get(key);
      const busy = this.lineage.busy(key, row);
      const childReports = reports.filter(card => card.childKey === key);
      const lastReport = childReports.at(-1);
      const failure = this.modelHealth?.sessions?.get?.(key);
      // 一轮开了头、没有收尾（agent_end 没来），会话又不在跑：网关重启或进程被杀，这一轮是被打断的，不能算交回。
      const openSpan = (j.spans[key] || []).at(-1);
      const interrupted = !busy && openSpan && !openSpan.to;
      let status = launch && !record.started ? 'queued' : busy ? 'running' : interrupted ? 'interrupted'
        : state.phase === 'waiting' ? 'waiting'
        : state.phase === 'error' || lastReport?.failed ? 'failed'
        : stoppedKeys.has(key) && !(lastReport && lastReport.createdAt > (parentState.lastStop?.at || 0)) ? 'stopped' : 'done';
      const spans = (j.spans[key] || []).map(span => ({from: span.from, to: span.to || (busy ? now : (state.at || span.from)),
        kind: span.to ? span.kind : busy ? 'run' : status === 'failed' || status === 'interrupted' ? 'fail' : 'done'}));
      const usage = j.usage[key] || {};
      return {key, title: row?.label || record.title || launch?.title || '子会话', mode: record.mode || launch?.mode || '',
        modeName: MODE_NAMES[record.mode || launch?.mode] || '', model: record.model || launch?.model || '',
        ...metreRoleFields(record, launch, metreRoles),
        status, statusText: STATUS_WORDS[status], state: BOARD_STATE[status],
        startedAt: record.createdAt || launch?.at || 0, endedAt: busy ? 0 : (state.at || 0),
        doing: busy ? (j.doing[key] || '想') : '',
        usage: {input: usage.input || num(row?.inputTokens), output: usage.output || num(row?.outputTokens), total: num(row?.totalTokens)},
        reports: childReports.length,
        lastActiveAt: Math.max(j.seen?.[key] || 0, ...(j.spans[key] || []).map(span => span.to || span.from)),
        error: status === 'failed' ? clip(failure?.reason || lastReport?.text || '没跑起来', 160)
          : status === 'interrupted' ? '这一轮没跑完就断了（网关重启或进程退出），结果没交回；可以打开看看停在哪，或发消息让它接着做' : '',
        spans};
    }).sort((a, b) => a.startedAt - b.startedAt);

    const running = sessions.filter(item => item.status === 'running').length;
    const failed = sessions.filter(item => item.status === 'failed' || item.status === 'interrupted').length;
    const returned = sessions.filter(item => item.reports && item.status !== 'failed' && item.status !== 'interrupted').length;
    const limits = this.lineage.metreLimits();
    const paused = Boolean(parentState.paused);
    const parentBusy = this.lineage.busy(parent, rows.get(parent));

    // 待你处理：等回答的提问（账本里记的，用户在那个会话说话就清掉）+ Metre 提的、还没点的卡片。
    const pending = [
      ...j.pending.map(item => ({...item, title: item.sessionKey === parent ? 'Metre' : this.title(item.sessionKey)})),
      ...(parentState.cards || []).filter(card => card.kind === 'proposal' && card.state === 'pending' && !(card.expiresAt <= now))
        .map(card => ({id: card.id, kind: 'confirm', sessionKey: parent, title: 'Metre', text: clip(`想开「${card.title}」：${String(card.prompt || '').split('\n')[0]}`, 160), askedAt: card.createdAt})),
    ].sort((a, b) => b.askedAt - a.askedAt);

    const lastStop = parentState.lastStop;
    const recentStop = lastStop && !parentBusy && running === 0 && lastStop.at >= (j.requestAt || 0);
    // 用 Metre 自己的话：分谱 = 把活拆给声部（子会话），收住 = 指挥的收拍（全停），起拍 = 开始。
    const stateText = paused ? '暂停分谱' : recentStop ? '已收住'
      : pending.length ? `等你（${pending.length}）` : running ? `${running} 个声部在奏` : parentBusy ? 'Metre 在做'
      : sessions.length ? '休止' : '还没起拍';

    const timeline = [...j.events];
    // 真正交回的汇报（血缘里的汇报卡片）：一张一条。
    const sessionsByKey = new Map(sessions.map(row => [row.key, row]));
    for (const card of reports) {
      if (!card.createdAt) continue;
      // Consultations don't occupy rows in the score, but their report can
      // still carry a name from the role snapshot.
      const row = sessionsByKey.get(card.childKey) || metreRoleFields(lineage[card.childKey] || {}, null, metreRoles);
      const roleName = card.metreRoleName || row.roleName;
      timeline.push({at: card.createdAt, kind: card.failed ? 'error' : 'report', sessionKey: card.childKey,
        text: `「${this.title(card.childKey)}」${roleName ? `（${roleName}）` : ''}${card.failed ? '汇报失败' : '交回汇报'}${card.text ? '：' + clip(card.text, 60) : ''}`});
    }
    if (lastStop?.at) timeline.push({at: lastStop.at, kind: 'stop', sessionKey: parent,
      text: `全体收住：收了 ${(lastStop.children || []).filter(item => item.stopped).length} 个声部${lastStop.parent ? '和 Metre 这一轮' : ''}`});
    if (parentState.pausedAt && paused) timeline.push({at: parentState.pausedAt, kind: 'stop', sessionKey: parent, text: '暂停分谱'});
    timeline.sort((a, b) => b.at - a.at);

    const changes = Object.entries(j.changes).map(([key, files]) => ({sessionKey: key, title: key === parent ? 'Metre' : this.title(key),
      files: Object.entries(files).sort((a, b) => b[1].at - a[1].at).map(([file, row]) => ({path: file, added: row.added, removed: row.removed}))}))
      .filter(group => group.files.length);

    const models = [...new Set([sessions.map(item => item.model), String(this.modelHealth?.runs?.get?.(String(this.lineage.turns?.get?.(parent)?.runId || '')) || '')].flat().filter(Boolean))];
    const health = id => {
      const record = this.modelHealth?.models?.get?.(id) || [...(this.modelHealth?.models?.entries?.() || [])].find(([name]) => name.endsWith('/' + id))?.[1];
      if (!record) return {id, health: 'unknown', lastError: ''};
      const bad = record.failAt && (!record.okAt || record.failAt > record.okAt);
      return {id, health: bad ? 'fail' : 'ok', lastError: bad ? clip(record.reason, 160) : ''};
    };
    const own = rows.get(parent);
    const usageTotal = Object.values(j.usage).reduce((sum, row) => ({input: sum.input + num(row.input), output: sum.output + num(row.output)}), {input: 0, output: 0});
    const series = Object.values(j.usage).flatMap(row => row.points || []).sort((a, b) => a[0] - b[0]);

    const plan = this.plans?.plan?.(parent);
    return {ok: true, sessionKey: parent, at: now,
      overview: {state: stateText, startedAt: j.requestAt || 0, running, limit: limits.maxRunning, started: parentState.metreStarts || 0,
        cap: limits.requestCap, returned, failed, paused, stopped: Boolean(recentStop), parentRunning: parentBusy,
        parentLastActiveAt: j.seen?.[parent] || 0},
      plan: plan ? {title: plan.title || '', updatedAt: plan.updatedAt || 0,
        items: (plan.items || []).map((item, index) => ({id: item.id || String(index + 1), text: item.text,
          status: item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'active' : 'pending'}))} : null,
      sessions, pending, timeline: timeline.slice(0, 60), changes,
      runtime: {models: models.map(health), context: {used: num(own?.totalTokens), max: num(own?.contextTokens)},
        usage: usageTotal, series: series.slice(-60), errors: j.errors.slice(-8).reverse(),
        metreRoles: metreRoleCatalog?.status || null},
      raw: j.raw.slice(-RAW_LIMIT)};
  }

  async resume(sessionKey) {
    const parent = this.parentOf(String(sessionKey || ''));
    if (!parent || parent !== sessionKey) throw new Error('只有 Metre 会话能接着做');
    const state = this.lineage.state(parent);
    if (state.paused) this.lineage.setPaused(parent, false);
    const id = `pinkie-metre-resume-${createHash('sha256').update(parent + this.now()).digest('hex').slice(0, 24)}`;
    // 这是用户点的按钮：作为用户的一句话发过去，Metre 把它当成用户叫它接着做。
    await this.lineage.access.rpc('chat.send', {sessionKey: parent, agentId: agentOf(parent),
      message: '接着做刚才停下的事：先看看每个子会话停在哪、哪些已经交回，再继续。', idempotencyKey: id, deliver: false});
    const j = this.journal(parent);
    this.event(j, 'dispatch', parent, '用户点了「接着做」');
    this.save(parent);
    return {ok: true};
  }
}

export function registerMetreBoard(api, {root, lineage, plans = null, modelHealth = null, lock = null, metreRoleCatalog} = {}) {
  const activeLock = () => lock || getActiveMetreLock();
  const board = new MetreBoard({root, lineage, plans, modelHealth, metreRoleCatalog});
  const safe = work => (event, ctx) => {
    if (activeLock()?.isLocked?.()) return;
    try { work(event, ctx); } catch { /* 看板记账出错不影响这一轮 */ }
  };
  api.on?.('before_agent_run', safe((event, ctx) => board.runStarted(event, ctx)), {priority: -10900});
  api.on?.('message_received', safe((event, ctx) => board.messageReceived(event, ctx)));
  api.on?.('after_tool_call', safe((event, ctx) => board.toolCalled(event, ctx)));
  api.on?.('agent_end', safe((event, ctx) => board.runEnded(event, ctx)), {priority: -10900});
  api.on?.('llm_output', safe((event, ctx) => board.usage(event, ctx)));
  registerSessionMethod(api, 'pinkie.metre.board', async ({sessionKey}) => {
    try { activeLock()?.assertUnlocked?.(); return await board.board(sessionKey); }
    catch (error) { return {ok: false, error: error.message}; }
  });
  registerSessionMethod(api, 'pinkie.metre.resume', async ({sessionKey}) => {
    try { activeLock()?.assertUnlocked?.(); return await board.resume(sessionKey); }
    catch (error) { return {ok: false, error: error.message}; }
  });
  return board;
}
