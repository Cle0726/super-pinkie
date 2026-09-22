import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const MAX_EVENTS = 40;
const MAX_TEXT = 16_000;
const VALID_SESSION = /^agent:(?:main|project|thinking|learning|unrestricted):/;
const VALID_STAGE = new Set(['queued', 'sent', 'received', 'failed', 'note']);

function stateRoot() {
  if (process.env.PINKIE_STATE_ROOT) return path.resolve(process.env.PINKIE_STATE_ROOT);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'SuperPinkie');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'SuperPinkie');
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'super-pinkie');
}

function cleanText(value, limit = MAX_TEXT) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function assertSession(sessionKey) {
  const key = String(sessionKey || '');
  if (!VALID_SESSION.test(key)) throw new Error('缺少有效的碧琪会话标识');
  return key;
}

function sessionHash(sessionKey) {
  return createHash('sha256').update(String(sessionKey)).digest('hex');
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function sessionFromContext(context = {}) {
  return String(context.sessionKey || context.hookContext?.sessionKey || context.context?.sessionKey || '');
}

function toolResponse(value, isError = false) {
  return {content: [{type: 'text', text: JSON.stringify(value)}], details: value, isError};
}

export class WebGptActivityStore {
  constructor({root = path.join(stateRoot(), 'web-gpt-activity')} = {}) {
    this.root = path.resolve(root);
  }

  fileFor(sessionKey) {
    return path.join(this.root, `${sessionHash(assertSession(sessionKey))}.json`);
  }

  read(sessionKey) {
    const key = assertSession(sessionKey);
    const initial = {v: 1, sessionKey: key, revision: 0, events: [], updatedAt: 0};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.fileFor(key), 'utf8'));
      if (!parsed || parsed.sessionKey !== key) return initial;
      return {...initial, ...parsed, events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : []};
    } catch {
      return initial;
    }
  }

  append(sessionKey, payload = {}) {
    const key = assertSession(sessionKey);
    const stage = cleanText(payload.stage || payload.action, 32).toLowerCase();
    if (!VALID_STAGE.has(stage)) throw new Error('不支持的网页 GPT 协作状态');
    const state = this.read(key);
    const event = {
      id: randomUUID(),
      stage,
      label: cleanText(payload.label, 160),
      text: cleanText(payload.text ?? payload.content, MAX_TEXT),
      at: Date.now(),
    };
    state.events = [...state.events, event].slice(-MAX_EVENTS);
    state.revision = Math.max(0, Number(state.revision) || 0) + 1;
    state.updatedAt = event.at;
    writeJsonAtomic(this.fileFor(key), state);
    return this.status(key);
  }

  status(sessionKey, options = {}) {
    const state = this.read(sessionKey);
    const totalEvents = state.events.length;
    const requestedLimit = Number(options.limit);
    const hasLimit = Number.isFinite(requestedLimit) && requestedLimit > 0;
    const limit = hasLimit ? Math.min(MAX_EVENTS, Math.floor(requestedLimit)) : MAX_EVENTS;
    const offset = hasLimit ? Math.max(0, Math.min(totalEvents - 1, Math.floor(Number(options.offset) || 0))) : 0;
    const end = hasLimit ? Math.max(0, totalEvents - offset) : totalEvents;
    const start = hasLimit ? Math.max(0, end - limit) : 0;
    return {
      v: 1,
      sessionKey: state.sessionKey,
      revision: state.revision,
      events: state.events.slice(start, end),
      totalEvents,
      latestStage: state.events[totalEvents - 1]?.stage || '',
      updatedAt: state.updatedAt,
    };
  }
}

export function createWebGptActivityTool(store, initialContext = {}) {
  let activeSessionKey = sessionFromContext(initialContext);
  return {
    name: 'web_gpt_activity',
    label: '网页 GPT 协作记录',
    description: '记录实际发往网页 ChatGPT 的完整控制消息、网页 ChatGPT 的完整返回或失败原因，让用户可以在协作记录面板核对。只有真实发生相应步骤时才能记录。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {type: 'string', enum: ['sent', 'received', 'failed', 'note']},
        content: {type: 'string'},
        label: {type: 'string'},
      },
      required: ['action', 'content'],
    },
    prepareBeforeToolCallParams(params, meta = {}) {
      activeSessionKey = sessionFromContext(meta.hookContext || meta) || activeSessionKey;
      return params;
    },
    async execute(_toolCallId, params = {}) {
      try {
        if (!activeSessionKey) throw new Error('缺少当前碧琪会话');
        return toolResponse(store.append(activeSessionKey, {
          stage: params.action,
          text: params.content,
          label: params.label,
        }));
      } catch (error) {
        return toolResponse({ok: false, error: error instanceof Error ? error.message : String(error)}, true);
      }
    },
  };
}

export function registerWebGptActivityGateway(api, store) {
  api.registerGatewayMethod('pinkie.webGpt.activity.get', async ({params, respond}) => {
    try {
      respond(true, store.status(String(params?.sessionKey || ''), {limit: params?.limit, offset: params?.offset}));
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  }, {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.webGpt.activity.append', async ({params, respond}) => {
    try {
      const sessionKey = String(params?.sessionKey || '');
      store.append(sessionKey, {
        stage: params?.stage,
        label: params?.label,
        text: params?.text,
      });
      respond(true, store.status(sessionKey, {limit: params?.limit, offset: params?.offset}));
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  }, {scope: 'operator.admin'});
}
