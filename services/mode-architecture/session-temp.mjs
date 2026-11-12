import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openclawStateDir} from './openclaw-paths.mjs';
import {agentOf, logSessionFailure, readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';

// H1 temporary sessions (PLAN §5). A temp session is an ordinary dashboard
// session whose key carries a `temp-` marker, so every other module can tell
// by the key alone: memory capture, auto titles, child sessions and the
// artifact index all skip it. Leaving deletes the record, the transcript, the
// trajectory and any media the transcript points at; the gateway also sweeps
// leftovers older than 24 h on start.
export const TEMP_TITLE = '临时会话';
export const TEMP_PROMPT = '【临时会话】这是临时会话，用户关掉就会删除。不要把这里的内容写进长期记忆、笔记或任何持久文件，除非用户在这一轮明确要求保存某个文件。';
export const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TEMP_KEY = /^agent:[a-z\d][a-z\d_-]*:dashboard:temp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODE_AGENT = Object.freeze({main: 'main', work: 'main', project: 'project', thinking: 'thinking', learning: 'learning', none: 'unrestricted', unrestricted: 'unrestricted'});

export const isTempKey = key => typeof key === 'string' && TEMP_KEY.test(key);

export function agentForMode(mode) {
  const value = String(mode || '').trim();
  if (MODE_AGENT[value]) return MODE_AGENT[value];
  return /^[a-z\d][a-z\d_-]*$/i.test(value) ? value : '';
}

// Media files the transcript mentions under the OpenClaw state media folder.
export function mediaPathsIn(text, stateDir) {
  const media = path.join(stateDir, 'media') + path.sep;
  const found = new Set();
  const pattern = /(?:[A-Za-z]:)?[\\/][^"'\s<>|*?]+/g;
  for (const raw of String(text || '').match(pattern) || []) {
    const clean = raw.replace(/\\\\/g, '\\').replace(/[),.;:\]}]+$/, '');
    const resolved = path.resolve(clean);
    if (resolved.startsWith(media) && !resolved.includes(path.sep + '..' + path.sep)) found.add(resolved);
  }
  return [...found];
}

export class TempSessions {
  constructor(api, {root, access, titles, prefs, now = Date.now, stateDir = openclawStateDir()}) {
    this.api = api;
    this.access = access;
    this.titles = titles;
    this.prefs = prefs;
    this.now = now;
    this.stateDir = stateDir;
    this.file = path.join(root, 'temp-sessions.json');
  }
  registry() {
    try { const data = readSessionJson(this.file); return data.sessions && typeof data.sessions === 'object' ? data.sessions : {}; }
    catch { return {}; }
  }
  writeRegistry(sessions) { writeSessionJson(this.file, {sessions}); }
  remember(key, agentId) { const all = this.registry(); all[key] = {agentId, createdAt: this.now()}; this.writeRegistry(all); }
  forgetRecord(key) { const all = this.registry(); if (key in all) { delete all[key]; this.writeRegistry(all); } }

  async create({mode} = {}) {
    const agentId = agentForMode(mode);
    if (!agentId) throw new Error('不认识这个模式');
    const key = `agent:${agentId}:dashboard:temp-${randomUUID()}`;
    this.remember(key, agentId);
    let result = null;
    for (let ordinal = 1; ordinal <= 50 && !result; ordinal++) {
      const label = ordinal === 1 ? TEMP_TITLE : `${TEMP_TITLE} ${ordinal}`;
      try { result = await this.access.rpc('sessions.create', {agentId, key, label}); }
      catch (error) { if (!/label already in use/i.test(error.message)) { this.forgetRecord(key); throw error; } }
    }
    if (result?.key !== key) { this.forgetRecord(key); throw new Error('没能建立临时会话'); }
    try { this.titles?.record?.(key, {title: TEMP_TITLE, source: 'system'}); } catch {}
    return {ok: true, key};
  }

  async leave(key) {
    if (!isTempKey(key)) throw new Error('这不是临时会话');
    const agentId = agentOf(key);
    let entry = null;
    try { entry = await this.access.entry(key); } catch {}
    const files = new Set();
    if (entry?.transcript) {
      let text = '';
      try { text = fs.readFileSync(entry.transcript, 'utf8'); } catch {}
      for (const file of mediaPathsIn(text, this.stateDir)) files.add(file);
      const dir = path.dirname(entry.transcript);
      const id = String(entry.sessionId || '');
      if (id && /^[\w.-]+$/.test(id)) {
        try { for (const name of fs.readdirSync(dir)) if (name.startsWith(id + '.')) files.add(path.join(dir, name)); } catch {}
      }
      files.add(entry.transcript);
    }
    if (entry) {
      try { await this.access.rpc('sessions.delete', {key, agentId, deleteTranscript: true}, {admin: true}); }
      catch (error) {
        try { await this.access.rpc('sessions.delete', {key, agentId, deleteTranscript: true}); }
        catch { logSessionFailure(this.api, 'session-temp', key, 'delete'); throw new Error('临时会话没删掉，稍后会再试'); }
      }
    }
    // The gateway archives the transcript instead of removing it; a temp
    // session must leave nothing, so remove what it left behind.
    if (entry?.transcript) {
      const dir = path.dirname(entry.transcript);
      const id = String(entry.sessionId || '');
      if (id && /^[\w.-]+$/.test(id)) {
        try { for (const name of fs.readdirSync(dir)) if (name.startsWith(id + '.')) files.add(path.join(dir, name)); } catch {}
      }
    }
    for (const file of files) { try { fs.rmSync(file, {force: true}); } catch {} }
    try { this.titles?.forget?.(key); } catch {}
    try { this.prefs?.forget?.(key); } catch {}
    this.forgetRecord(key);
    return {ok: true};
  }

  async sweep({maxAge = TEMP_MAX_AGE_MS} = {}) {
    const cutoff = this.now() - maxAge;
    let removed = 0;
    const known = this.registry();
    const candidates = new Map(Object.entries(known).map(([key, row]) => [key, row.createdAt || 0]));
    // Also catch temp sessions the registry lost (crash between create and write).
    for (const agentId of new Set(Object.values(known).map(row => row.agentId).concat(['main', 'project', 'thinking', 'learning', 'unrestricted']))) {
      try {
        const {entries} = await this.access.list(agentId);
        for (const [key, row] of Object.entries(entries || {})) {
          if (isTempKey(key) && !candidates.has(key)) candidates.set(key, Number(row?.updatedAt || row?.createdAt || 0));
        }
      } catch {}
    }
    for (const [key, createdAt] of candidates) {
      if (createdAt > cutoff) continue;
      try { await this.leave(key); removed++; } catch {}
    }
    return {ok: true, removed};
  }
}

export function registerSessionTemp(api, {root, titles, prefs}) {
  const temp = new TempSessions(api, {root, access: titles.access, titles, prefs});
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return {ok: false, error: error.message}; }
  });
  method('pinkie.session.temp.create', params => temp.create(params));
  method('pinkie.session.temp.leave', ({key}) => temp.leave(key));
  method('pinkie.session.temp.list', () => ({ok: true, keys: Object.keys(temp.registry())}));
  api.on?.('before_prompt_build', (_event, ctx) => (
    isTempKey(String(ctx?.sessionKey || '')) ? {appendSystemContext: `\n${TEMP_PROMPT}\n`} : undefined
  ), {priority: -10885});
  api.on?.('gateway_start', () => { setTimeout(() => { temp.sweep().catch(() => {}); }, 5000).unref?.(); });
  return temp;
}
