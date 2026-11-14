// 工具调用的两件事实，给界面的状态词和读图小框用（PLAN 2.8、2.9，所有模式）：
//   - 写入前路径存不存在：before_tool_call 查一次，不存在才叫「创建」；
//   - 工具确实读过 / 产出了哪些图片：after_tool_call 记一份清单（读图片文件、image 工具、浏览器 / 电脑截图、
//     结果里的 details.path、MEDIA: 行），按会话存盘，刷新、重开会话后还在。
// 图片只从 /pinkie-tool-image/<会话>/<编号>?key=<随记录发的 key> 取：路由不接收路径，只认清单里的编号和 key，
// 所以没被工具读过的文件取不到（不会变成任意读文件的口子）。图片已经不在磁盘上时 list 标 exists:false。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomBytes} from 'node:crypto';

export const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;
const MIME = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif'};
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_CALLS = 400;          // 每个会话最多记这么多次调用（够一段很长的工作）
const MAX_IMAGES = 24;          // 一次调用最多记这么多张
const ROUTE = '/pinkie-tool-image/';
const WRITE_TOOLS = new Set(['write']);
const EXEC_TOOLS = new Set(['exec', 'bash', 'exec_command']);
const SESSION = /^agent:[a-z0-9_-]+:/i;

const sessionId = key => createHash('sha256').update(String(key)).digest('hex').slice(0, 24);
const callIdOf = (event = {}, ctx = {}) => String(event.toolCallId || event.tool_call_id || event.callId || ctx.toolCallId || '');
const baseName = p => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

/** 把工具给的路径变成本机绝对路径：~、相对路径（按 cwd / 工作区）、file://、Windows 盘符和反斜杠都认。 */
export function resolveToolPath(raw, bases = []) {
  let p = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!p || /^(?:https?|data|blob):/i.test(p)) return '';
  if (/^file:\/\//i.test(p)) {
    try { p = decodeURIComponent(new URL(p).pathname); } catch { return ''; }
    if (/^\/[a-z]:\//i.test(p)) p = p.slice(1);
  }
  if (p === '~' || /^~[\\/]/.test(p)) p = path.join(os.homedir(), p.slice(1));
  if (path.isAbsolute(p)) return path.normalize(p);
  for (const base of bases) if (base && path.isAbsolute(String(base))) return path.resolve(String(base), p);
  return '';
}

/** 一次工具调用里出现的图片路径（还没查磁盘）。 */
export function imageCandidates(name, params = {}, result = undefined) {
  const out = [];
  const add = value => { if (typeof value === 'string' && value.trim()) out.push(value.trim()); };
  const tool = String(name || '').toLowerCase();
  const p = params && typeof params === 'object' ? params : {};
  if (tool === 'read' || tool === 'workbench_read') for (const key of ['path', 'file_path', 'filePath', 'file']) add(p[key]);
  if (tool === 'image') { add(p.image); if (Array.isArray(p.images)) p.images.forEach(add); }
  const r = result && typeof result === 'object' ? result : null;
  const details = r?.details && typeof r.details === 'object' ? r.details : null;
  if (details) {
    add(details.path);
    if (details.media && typeof details.media === 'object') { add(details.media.mediaUrl); add(details.media.path); }
    if (Array.isArray(details.paths)) details.paths.forEach(add);
  }
  const texts = [];
  if (typeof result === 'string') texts.push(result);
  if (Array.isArray(r?.content)) for (const block of r.content) if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text);
  for (const text of texts) for (const m of text.matchAll(/^\s*MEDIA:\s*(.+?)\s*$/gm)) add(m[1]);
  return [...new Set(out)].filter(v => IMAGE_EXT.test(v.replace(/[?#].*$/, '')));
}

export class ToolTraceStore {
  constructor({root, now = () => Date.now()} = {}) {
    this.root = root;
    this.now = now;
    this.cache = new Map();     // sessionId → {sessionKey, calls}
    this.pending = new Map();   // toolCallId → {sessionKey, created, path}
  }

  file(id) { return path.join(this.root, id + '.json'); }

  load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    let data = null;
    try { data = JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch {}
    if (!data || typeof data !== 'object' || typeof data.calls !== 'object') data = null;
    if (data) {
      this.cache.set(id, data);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    }
    return data;
  }

  save(id, data) {
    const ids = Object.keys(data.calls);
    if (ids.length > MAX_CALLS) ids.sort((a, b) => (data.calls[a].at || 0) - (data.calls[b].at || 0)).slice(0, ids.length - MAX_CALLS).forEach(k => delete data.calls[k]);
    fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
    const tmp = this.file(id) + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), {mode: 0o600});
    fs.renameSync(tmp, this.file(id));
    this.cache.set(id, data);
  }

  /** before_tool_call：写入前路径存不存在。 */
  beforeTool(event = {}, ctx = {}, bases = []) {
    const callId = callIdOf(event, ctx);
    const sessionKey = String(ctx.sessionKey || '');
    const tool = String(event.toolName || event.name || '').toLowerCase();
    if (!callId || !SESSION.test(sessionKey) || !WRITE_TOOLS.has(tool)) return null;
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const file = resolveToolPath(params.path || params.file_path || params.filePath || params.file, [params.cwd, ...bases]);
    if (!file) return null;
    let created;
    try { created = !fs.existsSync(file); } catch { return null; }
    const record = {sessionKey, created, name: baseName(file)};
    this.pending.set(callId, record);
    if (this.pending.size > 256) this.pending.delete(this.pending.keys().next().value);
    // 「正在创建」要在工具跑的时候就能显示：先落盘，结果出来后再补图片
    this.merge(sessionKey, callId, {created, name: record.name});
    return record;
  }

  /** after_tool_call：这次调用读到 / 产出的图片。写入失败的不算「创建了」。 */
  afterTool(event = {}, ctx = {}, bases = []) {
    const callId = callIdOf(event, ctx);
    const sessionKey = String(ctx.sessionKey || this.pending.get(callId)?.sessionKey || '');
    if (!callId || !SESSION.test(sessionKey)) return null;
    const pending = this.pending.get(callId);
    this.pending.delete(callId);
    const failed = Boolean(event.error || event.isError || event.result?.isError);
    const patch = {};
    if (pending && failed) patch.created = false;
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    // 命令原文第一行：历史里只有工具结果没有参数，换了浏览器也要能说「删除了 / 安装了」
    const tool = String(event.toolName || event.name || '').toLowerCase();
    if (EXEC_TOOLS.has(tool) && typeof (params.command || params.cmd) === 'string') {
      const line = String(params.command || params.cmd).split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';
      if (line) patch.command = line.length > 200 ? line.slice(0, 199) + '…' : line;
    }
    if (!failed) {
      const images = [];
      for (const candidate of imageCandidates(event.toolName || event.name, params, event.result)) {
        if (images.length >= MAX_IMAGES) break;
        const file = resolveToolPath(candidate, [params.cwd, params.workdir, ...bases]);
        if (!file) continue;
        let real = '';
        try { real = fs.realpathSync.native(file); } catch { continue; }
        let stat;
        try { stat = fs.statSync(real); } catch { continue; }
        if (!stat.isFile() || stat.size > MAX_BYTES || !IMAGE_EXT.test(real)) continue;
        if (images.some(img => img.path === real)) continue;
        images.push({id: randomBytes(8).toString('hex'), key: randomBytes(16).toString('hex'), path: real, name: baseName(real), size: stat.size});
      }
      if (images.length) patch.images = images;
    }
    if (!Object.keys(patch).length) return null;
    return this.merge(sessionKey, callId, patch);
  }

  merge(sessionKey, callId, patch) {
    const id = sessionId(sessionKey);
    const data = this.load(id) || {sessionKey, calls: {}};
    if (data.sessionKey !== sessionKey) return null;
    const call = {...(data.calls[callId] || {}), ...patch, at: this.now()};
    data.calls[callId] = call;
    try { this.save(id, data); } catch { this.cache.set(id, data); }
    return call;
  }

  /** 界面用：这个会话里每次调用的记录。图片给地址，不给路径；已经不在磁盘上的标出来。 */
  list(sessionKey) {
    const key = String(sessionKey || '');
    if (!SESSION.test(key)) throw new Error('会话无效');
    const id = sessionId(key);
    const data = this.load(id);
    const calls = {};
    if (!data || data.sessionKey !== key) return {calls};
    for (const [callId, call] of Object.entries(data.calls)) {
      const out = {};
      if (typeof call.created === 'boolean') out.created = call.created;
      if (call.name) out.name = call.name;
      if (call.command) out.command = call.command;
      if (Array.isArray(call.images) && call.images.length) {
        out.images = call.images.map(img => ({
          name: img.name,
          url: ROUTE + id + '/' + img.id + '?key=' + img.key,
          exists: (() => { try { return fs.statSync(img.path).isFile(); } catch { return false; } })(),
        }));
      }
      calls[callId] = out;
    }
    return {calls};
  }

  /** 路由用：只认清单里的编号和 key；返回本机路径或 null。 */
  imageFile(sessionPart, imageId, key) {
    if (!/^[0-9a-f]{24}$/.test(String(sessionPart || '')) || !/^[0-9a-f]{16}$/.test(String(imageId || '')) || !/^[0-9a-f]{32}$/.test(String(key || ''))) return null;
    const data = this.load(sessionPart);
    if (!data || sessionId(data.sessionKey) !== sessionPart) return null;
    for (const call of Object.values(data.calls)) {
      for (const img of call.images || []) {
        if (img.id === imageId && img.key === key) return IMAGE_EXT.test(img.path) ? img.path : null;
      }
    }
    return null;
  }
}

export function serveToolImage(store, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const [sessionPart = '', imageId = ''] = url.pathname.slice(ROUTE.length).split('/');
  const file = store.imageFile(sessionPart, imageId, url.searchParams.get('key'));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!file) { res.statusCode = 404; res.end(); return true; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return true; }
  let stat;
  try { stat = fs.statSync(file); } catch { res.statusCode = 404; res.end(); return true; }
  if (!stat.isFile() || stat.size > MAX_BYTES) { res.statusCode = 404; res.end(); return true; }
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  return true;
}

export function registerToolTrace(api, {root, baseFor = () => ''} = {}) {
  const store = new ToolTraceStore({root});
  const bases = ctx => { try { return [baseFor(ctx)].filter(Boolean); } catch { return []; } };
  api.on?.('before_tool_call', (event, ctx) => {
    try { store.beforeTool(event, ctx, bases(ctx)); } catch {}
    return undefined;
  }, {priority: -13000});
  api.on?.('after_tool_call', (event, ctx) => {
    try { store.afterTool(event, ctx, bases(ctx)); } catch {}
  });
  api.registerGatewayMethod?.('pinkie.toolTrace.list', ({params, respond}) => {
    try { respond(true, store.list(params?.sessionKey)); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: error.message}); }
  }, {scope: 'operator.read'});
  try {
    api.registerHttpRoute?.({path: ROUTE, match: 'prefix', auth: 'plugin', handler: (req, res) => serveToolImage(store, req, res)});
  } catch (error) { api.logger?.warn?.(`tool image route: ${error?.message || error}`); }
  return store;
}
