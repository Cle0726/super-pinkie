import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {cleanReplyText} from './reply-hygiene.mjs';

const MODES = new Set(['main', 'project', 'thinking', 'learning']);
const INTERNAL_SESSION = /:(?:subagent|internal-session-effects|cron|heartbeat):/i;
const INTERNAL_CONTROL = /\u2063|pinkie-(?:tier|integrity|watchdog|marathon)|自动续接保护|档位控制器|档位续跑|全局交付真实性门禁/i;
const MEDIA_LINE = /^\s*MEDIA\s*:/im;
const MAX_FILES = 6;
const MAX_EVIDENCE_PATHS = 4096;
const FINAL_TTL_MS = 120_000;
const DELIVERY_TYPES = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic', 'heif', 'tif', 'tiff',
  'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'epub', 'key', 'pages', 'numbers',
  'html', 'htm', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'py', 'swift', 'go', 'rs', 'rb',
  'c', 'h', 'cpp', 'hpp', 'java', 'kt', 'sql', 'sh', 'bash', 'zsh', 'ipynb',
  'zip', '7z', 'tar', 'gz', 'tgz', 'rar',
]);

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function absolutePath(raw, home, cwd) {
  let value = String(raw || '').trim();
  if (!value || /[\0\r\n]/.test(value)) return '';
  if (/^file:\/\//i.test(value)) {
    try { value = fileURLToPath(value); } catch { return ''; }
  } else if (value.startsWith('~/')) value = path.join(home, value.slice(2));
  if (!path.isAbsolute(value)) {
    if (!cwd || !path.isAbsolute(cwd)) return '';
    value = path.resolve(cwd, value);
  }
  return path.resolve(value);
}

// Keep this policy aligned with MaterialPreviewFileAccess.validatedFile.
// Resolve symbolic links before checking the home and sensitive directories.
export function validateDeliveryFile(raw, {homeDirectory = os.homedir(), startedAt = 0, cwd} = {}) {
  try {
    const home = fs.realpathSync(homeDirectory);
    const requested = absolutePath(raw, home, cwd);
    if (!requested) return null;
    const file = fs.realpathSync(requested);
    if (!inside(home, file) || /[\0\r\n]/.test(file)) return null;
    const parts = path.relative(home, file).split(path.sep).map(part => part.toLowerCase());
    const workspace = parts[0] === '.openclaw' && (parts[1] === 'workspace' || parts[1]?.startsWith('workspace-'));
    if (parts[0] === '.ssh' || (parts[0] === 'library' && parts[1] === 'keychains') || (parts[0] === '.openclaw' && !workspace)) return null;
    if (!DELIVERY_TYPES.has(path.extname(file).slice(1).toLowerCase())) return null;
    const stat = fs.statSync(file);
    if (!stat.isFile() || !(stat.mtimeMs > startedAt)) return null;
    return file;
  } catch { return null; }
}

function withoutFences(text) {
  let fence = '';
  return String(text || '').split(/\r?\n/).filter(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]?.[0];
    if (marker) { if (!fence) fence = marker; else if (marker === fence) fence = ''; return false; }
    return !fence;
  }).join('\n');
}

export function deliveryPathsFromText(text = '') {
  const body = withoutFences(text);
  const values = [];
  for (const match of body.matchAll(/`([^`\r\n]+)`/g)) values.push(match[1]);
  for (const line of body.split('\n')) {
    const value = line.trim().replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '');
    if (/^(?:\/|~\/|file:\/\/|[A-Za-z]:[\\/])/.test(value)) values.push(value);
  }
  return [...new Set(values)].filter(value => /^(?:\/|~\/|file:\/\/|[A-Za-z]:[\\/])/.test(value));
}

function evidencePathsFromText(text = '') {
  const values = deliveryPathsFromText(text);
  // Shell-quoted and JSON paths preserve filenames with spaces. The final
  // token pass covers unquoted command/output paths without parsing commands.
  for (const match of String(text).matchAll(/["'`]((?:\/|~\/|file:\/\/|[A-Za-z]:[\\/])[^"'`\r\n]+)["'`]/g)) values.push(match[1]);
  for (const match of String(text).matchAll(/(?:^|[\s=("'`])((?:\/|~\/|file:\/\/|[A-Za-z]:[\\/])[^\s"'`<>;|)]+)[\s"'`<>;|)]?/g)) values.push(match[1]);
  return [...new Set(values)].slice(0, MAX_EVIDENCE_PATHS);
}

function resultStrings(value, seen = new Set(), depth = 0) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).slice(0, 256).flatMap(item => resultStrings(item, seen, depth + 1));
}

function messageText(message = {}) {
  if (typeof message.content === 'string') return message.content;
  return Array.isArray(message.content) ? message.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';
}

function finalMessage(message = {}) {
  if (message.role !== 'assistant' || message.toolCall || message.tool_call || message.toolCalls?.length || message.tool_calls?.length) return false;
  if (Array.isArray(message.content) && message.content.some(part => ['toolCall', 'tool_use', 'toolUse'].includes(part?.type))) return false;
  const stop = String(message.stopReason || message.stop_reason || '').toLowerCase();
  if (['error', 'aborted', 'length', 'tooluse', 'tool_use', 'tool_calls'].includes(stop)) return false;
  return ['stop', 'end_turn', 'end', 'complete', 'completed'].includes(stop)
    || message.final === true || message.isFinal === true || message.terminal === true;
}

function incomplete(text) {
  return /(?:本轮未完成|尚未完成|还没(?:有)?完成|无法完成|仍在(?:处理|生成)|正在后台|已停止重试|被阻塞)/.test(text);
}
function denied(decision) { return Boolean(decision?.block || decision?.cancel || decision?.skip || decision?.action === 'revise'); }
function fingerprint(text) {
  const clean = cleanReplyText(text).replace(/^\s*MEDIA\s*:[^\r\n]*$/gim, '').replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(clean).digest('hex');
}
function withMediaLines(text, files) { return `${text.trimEnd()}\n\n${files.map(file => `MEDIA:${file}`).join('\n')}`; }
function withMessageText(message, files) {
  if (typeof message.content === 'string') return {...message, content: withMediaLines(message.content, files)};
  const content = [...message.content];
  const index = content.findLastIndex(part => part?.type === 'text' && typeof part.text === 'string');
  if (index < 0) return message;
  content[index] = {...content[index], text: withMediaLines(content[index].text, files)};
  return {...message, content};
}

function hasMedia(payload) {
  return Boolean(payload?.mediaUrl || payload?.mediaUrls?.some(Boolean) || MEDIA_LINE.test(String(payload?.text || '')));
}

function sameSession(record, event = {}, ctx = {}) {
  const id = String(event.sessionId || ctx.sessionId || '');
  const key = String(event.sessionKey || ctx.sessionKey || '');
  return id ? record.sessionId === id || (!record.sessionId && key && record.sessionKey === key)
    : key && record.sessionKey === key;
}

export class FileDeliveryTracker {
  constructor({supervisor, homeDirectory = os.homedir(), now = Date.now, finalTtlMs = FINAL_TTL_MS} = {}) {
    this.supervisor = supervisor;
    this.home = fs.realpathSync(homeDirectory);
    this.now = now;
    this.finalTtlMs = Math.min(FINAL_TTL_MS, Math.max(1, finalTtlMs));
    this.active = new Map();
    this.generationByTurn = new WeakMap();
    this.nextGeneration = 0;
    // Only hashes and up to six validated paths survive agent_end. No reply
    // or tool-output text is persisted by this independent delivery helper.
    this.finals = new Map();
  }

  binding(event = {}, ctx = {}) {
    const bound = this.supervisor?.boundContext(event, ctx);
    if (!bound) return null;
    const key = bound.sessionKey;
    if ([ctx.sessionKey, event.sessionKey].some(value => String(value || '').startsWith('agent:') && value !== key)) return null;
    const turn = this.supervisor.turns.get(key);
    let generation = turn && this.generationByTurn.get(turn);
    if (turn && !generation) { generation = ++this.nextGeneration; this.generationByTurn.set(turn, generation); }
    return {...bound, turn, generation};
  }

  prune() {
    for (const [runId, final] of this.finals) if (this.now() - final.at >= this.finalTtlMs) this.finals.delete(runId);
    while (this.finals.size > 2048) this.finals.delete(this.finals.keys().next().value);
    while (this.active.size > 1024) this.clear(this.active.keys().next().value);
  }

  noteTurn(event = {}, ctx = {}) {
    this.prune();
    const bound = this.binding(event, ctx);
    if (!bound?.turn || !(bound.turn.startedAt > 0)) return;
    const {sessionKey: key, turn} = bound;
    let record = this.active.get(key);
    const control = INTERNAL_CONTROL.test(String(event.prompt ?? event.content ?? ''));
    const agent = String(bound.ctx.agentId || /^agent:([^:]+):/.exec(key)?.[1] || '');
    const automatic = Boolean(ctx.jobId || event.jobId || (ctx.trigger && !['user', 'manual'].includes(ctx.trigger)));
    const userOrigin = MODES.has(agent) && !INTERNAL_SESSION.test(key) && !automatic && !control;
    if (!record || record.generation !== bound.generation || record.startedAt !== turn.startedAt) {
      this.clear(key);
      record = {sessionKey: key, sessionId: String(ctx.sessionId || event.sessionId || ''), startedAt: turn.startedAt, generation: bound.generation,
        userOrigin, paths: new Set(), runIds: new Set(), allowedRuns: new Set(), continuations: new Set()};
      this.active.set(key, record);
    }
    const runId = String(ctx.runId || event.runId || turn.runId || '');
    if (!runId) return;
    record.runIds.add(runId);
    // A retry inherits only an already-observed user turn. A fresh automatic
    // request, even in a user's main session, cannot acquire its eligibility.
    if (control && record.userOrigin) { record.allowedRuns.add(runId); record.continuations.add(runId); }
    else if (userOrigin && record.userOrigin) record.allowedRuns.add(runId);
    else if (automatic || control || !MODES.has(agent)) record.allowedRuns.delete(runId);
  }

  record(event = {}, ctx = {}) {
    const bound = this.binding(event, ctx);
    if (!bound?.turn) return null;
    const record = this.active.get(bound.sessionKey);
    const runId = String(ctx.runId || event.runId || event.message?.runId || bound.turn.runId || '');
    if (!record?.userOrigin || record.generation !== bound.generation || record.startedAt !== bound.turn.startedAt || !runId || !record.allowedRuns.has(runId)) return null;
    if (record.sessionId && [ctx.sessionId, event.sessionId].some(value => value && value !== record.sessionId)) return null;
    if ((ctx.jobId || event.jobId || (ctx.trigger && !['user', 'manual'].includes(ctx.trigger))) && !record.continuations.has(runId)) return null;
    return {record, bound, runId};
  }

  afterTool(event = {}, ctx = {}) {
    const current = this.record(event, ctx);
    if (!current) return;
    const {record, bound} = current;
    const latest = this.supervisor.integrity?.runs.get(bound.sessionKey)?.tools?.at(-1);
    if (event.error || event.result?.isError === true || latest?.failed) return;
    const name = String(event.toolName || '').toLowerCase();
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const values = [];
    const cwd = String(params.cwd || params.workdir || bound.ctx.workspaceDir || '');
    if (['write', 'edit', 'apply_patch'].includes(name)) {
      for (const key of ['path', 'file_path', 'filePath', 'target', 'destination', 'dest', 'outputPath', 'output_path']) {
        if (typeof params[key] === 'string') values.push(params[key]);
      }
      if (name === 'apply_patch') {
        for (const text of resultStrings(params)) for (const match of text.matchAll(/^\*\*\* (?:Add File|Update File|Move to):\s*([^\r\n]+)/gm)) values.push(match[1]);
      }
    } else if (name === 'exec' || name.endsWith('_exec') || name === 'exec_command') {
      values.push(...evidencePathsFromText(String(params.command || params.cmd || '')));
      for (const text of resultStrings(event.result)) values.push(...evidencePathsFromText(text));
    } else return;
    for (const raw of values) {
      if (record.paths.size >= MAX_EVIDENCE_PATHS) break;
      const file = validateDeliveryFile(raw, {homeDirectory: this.home, startedAt: record.startedAt, cwd});
      if (file) record.paths.add(file);
    }
  }

  files(text, record) {
    if (!text || MEDIA_LINE.test(text) || INTERNAL_CONTROL.test(text) || incomplete(text)) return [];
    const files = new Set();
    for (const candidate of deliveryPathsFromText(text)) {
      const file = validateDeliveryFile(candidate, {homeDirectory: this.home, startedAt: record.startedAt});
      if (file && record.paths.has(file)) files.add(file);
      if (files.size === MAX_FILES) break;
    }
    return [...files];
  }

  approve(text, current) {
    if (!text || INTERNAL_CONTROL.test(text) || incomplete(text) || current.bound.turn?.pending) return null;
    const files = this.files(text, current.record);
    const final = {sessionKey: current.record.sessionKey, sessionId: current.record.sessionId,
      startedAt: current.record.startedAt, hash: fingerprint(text), files, at: this.now()};
    this.finals.set(current.runId, final);
    this.prune();
    return final;
  }

  finalizeResult(decision, event = {}, ctx = {}) {
    if (denied(decision)) return decision;
    const current = this.record(event, ctx);
    if (!current) return decision;
    const last = [...(event.messages || [])].reverse().find(message => message?.role === 'assistant');
    if (last && !finalMessage(last)) return decision;
    const text = typeof event.lastAssistantMessage === 'string' ? event.lastAssistantMessage : messageText(last);
    this.approve(text, current);
    return decision;
  }

  writeResult(result, event = {}, ctx = {}) {
    if (denied(result)) return result;
    const message = result?.message || event.message;
    if (!finalMessage(message)) return result;
    const current = this.record({...event, message}, ctx);
    if (!current) return result;
    const final = this.approve(messageText(message), current);
    if (!final?.files.length) return result;
    return {...(result || {}), message: withMessageText(message, final.files)};
  }

  replyResult(result, event = {}, ctx = {}) {
    this.prune();
    if (denied(result) || event.kind !== 'final') return result;
    const payload = result?.payload || event.payload;
    if (!payload || hasMedia(payload) || typeof payload.text !== 'string' || incomplete(payload.text)) return result;
    const runId = String(event.runId || ctx.runId || '');
    if (!runId) return result;
    if (event.runId && ctx.runId && event.runId !== ctx.runId) return result;
    let final = this.finals.get(runId);
    if (!final) {
      const current = this.record(event, ctx);
      if (current) final = this.approve(payload.text, current);
    }
    if (!final || final.hash !== fingerprint(payload.text)) return result;
    if ([ctx.sessionKey, event.sessionKey].some(value => String(value || '').startsWith('agent:') && value !== final.sessionKey)) return result;
    if (final.sessionId && [ctx.sessionId, event.sessionId].some(value => value && value !== final.sessionId)) return result;
    const bound = this.binding(event, ctx);
    const requestedSession = bound?.sessionKey || String(ctx.sessionKey || event.sessionKey || '');
    if (requestedSession && requestedSession !== final.sessionKey) return result;
    const files = [...new Set(final.files.map(file => validateDeliveryFile(file, {homeDirectory: this.home, startedAt: final.startedAt})).filter(Boolean))].slice(0, MAX_FILES);
    if (!files.length) return result;
    // MEDIA has already been parsed before this outbound hook on the pinned
    // runtime. Keep transport text clean and supply the native media field.
    return {...(result || {}), payload: {...payload, mediaUrls: files}};
  }

  endResult(ended, event = {}, ctx = {}) {
    if (!ended) return ended;
    const key = String(ctx.sessionKey || event.sessionKey || '');
    const runId = String(ctx.runId || event.runId || '');
    const record = this.active.get(key);
    if (record && (!runId || record.runIds.has(runId))) this.active.delete(key);
    this.prune();
    return ended;
  }

  clear(key) {
    if (!key) { this.active.clear(); this.finals.clear(); return; }
    this.active.delete(key);
    for (const [runId, final] of this.finals) if (final.sessionKey === key) this.finals.delete(runId);
  }

  sessionEnded(event = {}, ctx = {}) {
    for (const [key, record] of this.active) if (sameSession(record, event, ctx)) this.active.delete(key);
    for (const [runId, final] of this.finals) if (sameSession(final, event, ctx)) this.finals.delete(runId);
  }
}

export function createFileDelivery(supervisor, api, options = {}) {
  const tracker = new FileDeliveryTracker({supervisor, ...options});
  api?.on?.('session_end', (event, ctx) => tracker.sessionEnded(event, ctx));
  api?.registerService?.({id: 'pinkie-file-delivery', start() {}, stop: () => tracker.clear()});
  const lifecycleOwner = api?.lifecycle?.registerRuntimeLifecycle ? api.lifecycle : api;
  lifecycleOwner?.registerRuntimeLifecycle?.({id: 'pinkie-file-delivery', cleanup: ({sessionKey} = {}) => tracker.clear(sessionKey)});
  return tracker;
}
