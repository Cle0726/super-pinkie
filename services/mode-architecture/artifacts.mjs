import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openclawStateDir} from './openclaw-paths.mjs';
import {agentOf, readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';
import {agentForMode, isTempKey} from './session-temp.mjs';

// W1 artifact index (PLAN §7). Every file Biqi writes, edits, patches or
// generates with one of the listed extensions, inside a mode workspace, the
// bound project folder or the media output folder, becomes one artifact with
// a version history. Snapshots live under <plugin state>/artifacts/<id>/<v>.<ext>.
// Temp sessions are never recorded.
export const ARTIFACT_EXTS = new Set(['html', 'htm', 'md', 'svg', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'docx', 'pptx', 'xlsx', 'csv', 'mp4']);
export const LIMITS = Object.freeze({snapshotBytes: 20 * 1024 * 1024, versions: 50, totalBytes: 2 * 1024 * 1024 * 1024});
const KIND = {html: 'html', htm: 'html', md: 'doc', pdf: 'doc', docx: 'doc', svg: 'image', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', pptx: 'slides', xlsx: 'sheet', csv: 'sheet', mp4: 'video'};
export const KINDS = Object.freeze([...new Set(Object.values(KIND))]);
const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'multi_edit', 'create', 'update']);
const MAKE_TOOLS = /^(?:image_generate|imagegen|video_generate|canvas|canvas_\w+)$/i;
const PATH_KEYS = ['path', 'file_path', 'filePath', 'target', 'destination', 'dest', 'outputPath', 'output_path', 'output'];

const extOf = file => path.extname(file).slice(1).toLowerCase();
export const kindOf = file => KIND[extOf(file)] || '';
const inside = (root, target) => Boolean(root) && (target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
export function artifactId(file, platform = process.platform) {
  const normal = path.resolve(file);
  return createHash('sha1').update(platform === 'win32' || platform === 'darwin' ? normal.toLowerCase() : normal).digest('hex');
}

function strings(value, seen = new Set(), depth = 0) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).slice(0, 256).flatMap(item => strings(item, seen, depth + 1));
}

// Paths a tool call says it produced. Writers name the file in their params;
// generators hand it back somewhere in the result.
export function producedPaths(event = {}) {
  const name = String(event.toolName || event.name || '').toLowerCase();
  const params = event.params && typeof event.params === 'object' ? event.params : {};
  const found = [];
  if (WRITE_TOOLS.has(name)) {
    for (const key of PATH_KEYS) if (typeof params[key] === 'string') found.push(params[key]);
    if (name === 'apply_patch') {
      for (const text of strings(params)) for (const m of text.matchAll(/^\*\*\* (?:Add File|Update File|Move to):\s*([^\r\n]+)/gm)) found.push(m[1].trim());
    }
  } else if (MAKE_TOOLS.test(name)) {
    for (const key of PATH_KEYS) if (typeof params[key] === 'string') found.push(params[key]);
    for (const text of strings(event.result)) {
      for (const m of text.matchAll(/(?:file:\/\/)?(?:~|[A-Za-z]:)?[\\/][^\s"'<>|*?`]+/g)) found.push(m[0].replace(/[),.;:\]}]+$/, ''));
    }
  } else return [];
  return [...new Set(found.filter(value => value && ARTIFACT_EXTS.has(extOf(value.replace(/[?#].*$/, '')))))];
}

function resolvePath(raw, {home, cwd}) {
  let value = String(raw || '').trim();
  if (!value || /[\0\r\n]/.test(value)) return '';
  if (/^file:\/\//i.test(value)) { try { value = fileURLToPath(value); } catch { return ''; } }
  else if (value === '~' || value.startsWith('~/')) value = path.join(home, value.slice(2));
  if (!path.isAbsolute(value)) {
    if (!cwd || !path.isAbsolute(cwd)) return '';
    value = path.resolve(cwd, value);
  }
  try { return fs.realpathSync(value); } catch { return ''; }
}

function hashFile(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

export class ArtifactStore {
  constructor(root, {now = Date.now, limits = LIMITS, platform = process.platform} = {}) {
    this.root = root;
    this.file = path.join(root, 'index.json');
    this.now = now;
    this.limits = {...LIMITS, ...limits};
    this.platform = platform;
    this.cache = null;
  }
  load() {
    if (this.cache) return this.cache;
    let data = {};
    try { data = readSessionJson(this.file); } catch { data = {}; }
    this.cache = {items: data.items && typeof data.items === 'object' ? data.items : {}};
    return this.cache;
  }
  save() { writeSessionJson(this.file, this.cache); }
  snapshotPath(id, v, ext) { return path.join(this.root, id, `${v}.${ext}`); }

  // One produced file → maybe one new version. Returns the item, or null when
  // the file is not an artifact. Unchanged content adds no version.
  record({file, sessionKey = '', runId = '', source = 'tool'}) {
    if (!file || !ARTIFACT_EXTS.has(extOf(file))) return null;
    let stat;
    try { stat = fs.statSync(file); } catch { return null; }
    if (!stat.isFile()) return null;
    const id = artifactId(file, this.platform);
    const data = this.load();
    const sha256 = hashFile(file);
    const ts = this.now();
    let item = data.items[id];
    if (!item) {
      item = {id, path: file, kind: kindOf(file), title: path.basename(file), sessionKey, mode: agentOf(sessionKey) || '', runId, createdAt: ts, updatedAt: ts, versions: []};
      data.items[id] = item;
    }
    const last = item.versions.at(-1);
    if (last && last.sha256 === sha256) return item;
    const v = (last?.v || 0) + 1;
    let snapshot = null;
    if (stat.size <= this.limits.snapshotBytes) {
      snapshot = this.snapshotPath(id, v, extOf(file));
      fs.mkdirSync(path.dirname(snapshot), {recursive: true, mode: 0o700});
      fs.copyFileSync(file, snapshot);
    }
    item.versions.push({v, ts, size: stat.size, sha256, snapshot, runId, sessionKey, source});
    item.path = file;
    item.updatedAt = ts;
    if (runId) item.runId = runId;
    if (sessionKey) { item.sessionKey = sessionKey; item.mode = agentOf(sessionKey) || item.mode; }
    this.prune(item);
    this.save();
    return item;
  }

  dropVersion(item, index) {
    const [gone] = item.versions.splice(index, 1);
    if (gone?.snapshot) { try { fs.rmSync(gone.snapshot, {force: true}); } catch {} }
  }
  // ≤ 50 versions per artifact; ≤ 2 GB of snapshots overall, oldest first.
  // The newest version of any artifact is never removed.
  prune(touched) {
    while (touched && touched.versions.length > this.limits.versions) this.dropVersion(touched, 0);
    const items = Object.values(this.load().items);
    let total = 0;
    for (const item of items) for (const version of item.versions) if (version.snapshot) total += version.size || 0;
    if (total <= this.limits.totalBytes) return;
    const candidates = [];
    for (const item of items) item.versions.forEach((version, index) => {
      if (index < item.versions.length - 1) candidates.push({item, version});
    });
    candidates.sort((a, b) => a.version.ts - b.version.ts || a.version.v - b.version.v);
    for (const {item, version} of candidates) {
      if (total <= this.limits.totalBytes) break;
      const index = item.versions.indexOf(version);
      if (index < 0 || index === item.versions.length - 1) continue;
      total -= version.snapshot ? version.size || 0 : 0;
      this.dropVersion(item, index);
    }
  }

  view(item) {
    if (!item) return null;
    const latest = item.versions.at(-1) || {};
    let exists = false;
    try { exists = fs.statSync(item.path).isFile(); } catch {}
    return {
      id: item.id, path: item.path, kind: item.kind, title: item.title, sessionKey: item.sessionKey, mode: item.mode,
      runId: item.runId, createdAt: item.createdAt, updatedAt: item.updatedAt, exists,
      size: latest.size || 0, version: latest.v || 0, total: item.versions.length,
      versions: item.versions.map(({v, ts, size, runId, source, snapshot}) => ({v, ts, size, runId, source, snapshot: Boolean(snapshot)})),
    };
  }
  list({mode, query, kind, sessionKey, runId, limit = 60, cursor} = {}) {
    const agent = mode && mode !== 'all' ? agentForMode(mode) || String(mode) : '';
    const needle = String(query || '').trim().toLowerCase();
    let items = Object.values(this.load().items)
      .filter(item => !agent || item.mode === agent)
      .filter(item => !kind || kind === 'all' || item.kind === kind)
      .filter(item => !sessionKey || item.sessionKey === sessionKey || item.versions.some(v => v.sessionKey === sessionKey))
      .filter(item => !runId || item.runId === runId || item.versions.some(v => v.runId === runId))
      .filter(item => !needle || item.title.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
    const start = Math.max(0, Number.parseInt(cursor, 10) || 0);
    const size = Math.max(1, Math.min(200, Number(limit) || 60));
    const page = items.slice(start, start + size).map(item => this.view(item));
    return {ok: true, items: page, cursor: start + size < items.length ? String(start + size) : null};
  }
  item(id) {
    const item = this.load().items[String(id || '')];
    if (!item) throw new Error('作品库里没有这件作品');
    return item;
  }
  get(id) { return {ok: true, item: this.view(this.item(id))}; }
  versionPath(id, v) {
    const item = this.item(id);
    const version = item.versions.find(entry => entry.v === Number(v));
    if (!version) throw new Error('没有这个版本');
    if (version.snapshot && fs.existsSync(version.snapshot)) return {ok: true, path: version.snapshot};
    if (version === item.versions.at(-1) && fs.existsSync(item.path)) return {ok: true, path: item.path};
    throw new Error('这个版本太大，没有存副本');
  }
  restore(id, v, {sessionKey = ''} = {}) {
    const item = this.item(id);
    const version = item.versions.find(entry => entry.v === Number(v));
    if (!version) throw new Error('没有这个版本');
    if (!version.snapshot || !fs.existsSync(version.snapshot)) throw new Error('这个版本太大，没有存副本，不能恢复');
    fs.mkdirSync(path.dirname(item.path), {recursive: true});
    const temporary = `${item.path}.pinkie-restore-${process.pid}-${Date.now()}`;
    fs.copyFileSync(version.snapshot, temporary);
    fs.renameSync(temporary, item.path);
    // A restore is itself a new version, even when it equals an older one.
    const last = item.versions.at(-1);
    if (last && last.sha256 === version.sha256) return {ok: true, v: last.v};
    const updated = this.record({file: item.path, sessionKey: sessionKey || item.sessionKey, runId: '', source: 'restore'});
    return {ok: true, v: updated?.versions.at(-1)?.v || last?.v || 0};
  }
  remove(id) {
    const data = this.load();
    const item = data.items[String(id || '')];
    if (!item) return {ok: true};
    delete data.items[item.id];
    this.save();
    try { fs.rmSync(path.join(this.root, item.id), {recursive: true, force: true}); } catch {}
    return {ok: true};
  }
}

// Folders whose files count as artifacts for one tool call.
export function artifactRoots(ctx = {}, {stateDir = openclawStateDir(), bindings = () => ({}), home = os.homedir()} = {}) {
  const roots = new Set();
  const add = dir => { if (dir && path.isAbsolute(dir)) { try { roots.add(fs.realpathSync(dir)); } catch {} } };
  add(ctx.workspaceDir || ctx.workspace);
  add(path.join(stateDir, 'media'));
  try { for (const name of fs.readdirSync(stateDir)) if (name === 'workspace' || name.startsWith('workspace-')) add(path.join(stateDir, name)); } catch {}
  const bound = bindings()?.[String(ctx.sessionKey || '')];
  if (bound?.root) add(bound.root);
  return [...roots];
}

const STORE_INSTANCES = Symbol.for('pinkie.artifacts.instances');
export function registerArtifacts(api, {root, stateDir = openclawStateDir(), bindingsFile = '', home = os.homedir()} = {}) {
  const shared = globalThis[STORE_INSTANCES] ??= new Map();
  if (!shared.has(root)) shared.set(root, new ArtifactStore(root));
  const store = shared.get(root);
  const bindings = () => { if (!bindingsFile) return {}; try { return readSessionJson(bindingsFile); } catch { return {}; } };
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return {ok: false, error: error.message}; }
  });
  method('pinkie.artifacts.list', params => store.list(params));
  method('pinkie.artifacts.get', ({id}) => store.get(id));
  method('pinkie.artifacts.version', ({id, v}) => store.versionPath(id, v));
  method('pinkie.artifacts.restore', ({id, v, key}) => store.restore(id, v, {sessionKey: key}));
  method('pinkie.artifacts.remove', ({id}) => store.remove(id));
  api.on?.('after_tool_call', (event, ctx = {}) => {
    try {
      const sessionKey = String(ctx.sessionKey || event?.sessionKey || '');
      if (!agentOf(sessionKey) || isTempKey(sessionKey)) return;
      if (event?.error || event?.result?.isError === true) return;
      const raws = producedPaths(event);
      if (!raws.length) return;
      const params = event.params && typeof event.params === 'object' ? event.params : {};
      const binding = bindings()[sessionKey];
      const cwd = String(params.cwd || params.workdir || binding?.root || ctx.workspaceDir || '');
      const roots = artifactRoots(ctx, {stateDir, bindings, home});
      const runId = String(ctx.runId || event.runId || '');
      for (const raw of raws.slice(0, 20)) {
        const file = resolvePath(raw, {home, cwd});
        if (!file || !roots.some(dir => inside(dir, file))) continue;
        store.record({file, sessionKey, runId});
      }
    } catch (error) {
      api.logger?.warn?.(`[artifacts] record failed: ${error.code || 'error'}`);
    }
  }, {priority: -10890});
  return store;
}
