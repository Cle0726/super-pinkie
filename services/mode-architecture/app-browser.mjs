import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export const APP_BROWSER_ACTIONS = Object.freeze([
  'open', 'status', 'snapshot', 'screenshot', 'click', 'type', 'press', 'scroll',
  'wait', 'back', 'forward', 'reload', 'eval', 'show_file', 'close', 'locate', 'read', 'select', 'batch',
  'serve', 'stop_serve', 'serve_logs', 'move', 'hover', 'drag', 'set_slider',
  'fill', 'replay', 'remember', 'recipes', 'forget',
]);
const NODE_ACTIONS = new Set(['serve','stop_serve','serve_logs','batch','fill','replay','remember','recipes','forget']);
const NATIVE_ACTIONS = new Set(APP_BROWSER_ACTIONS.filter(action => !NODE_ACTIONS.has(action)));
const BATCH_ACTIONS = new Set(['click','type','select','press','scroll','wait','move','hover','drag','set_slider']);
const WRITE_ACTIONS = new Set(['serve','stop_serve','open','back','forward','reload','eval','show_file','close','click','type','select','press','scroll','move','hover','drag','set_slider']);
const browserBatches = new WeakMap();
const NAVIGATION_ACTIONS = new Set(['open', 'back', 'forward', 'reload', 'show_file']);
const UNAVAILABLE = '当前 App 的侧栏浏览器尚未连接（旧版 App 或 Windows 暂不支持），请改用 browser 工具。';
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const liveManagers = new Set();
let exitCleanupInstalled = false;

function toolResult(value) {
  return {content: [{type: 'text', text: JSON.stringify(value)}], details: value, isError: value.ok === false};
}

function failure(reason) { return {ok: false, reason}; }
function sessionContext(ctx = {}) {
  return {sessionId: String(ctx.sessionId || ''), sessionKey: String(ctx.sessionKey || '')};
}
function sessionOwner(ctx = {}) { return String(ctx.sessionId || ctx.sessionKey || ''); }
function matchesSession(record, event = {}, ctx = {}) {
  const sessionId = String(event.sessionId || ctx.sessionId || '');
  const sessionKey = String(event.sessionKey || ctx.sessionKey || '');
  return sessionId ? record.sessionId === sessionId || (!record.sessionId && sessionKey && record.sessionKey === sessionKey)
    : sessionKey && record.sessionKey === sessionKey;
}
function aborted(signal) {
  if (signal?.aborted) throw new Error('浏览器操作已取消。');
}

export function appBrowserTimeout(action, params = {}) {
  if (action === 'wait') return 15_000;
  const ceiling = NAVIGATION_ACTIONS.has(action) ? 30_000 : 15_000;
  return Math.min(ceiling, Math.max(1, Number(params.timeout_ms) || ceiling));
}

// This endpoint only comes from the App's gateway environment, never tool args.
// The parent directory and socket must both be private to the same OS user.
export function appBrowserEndpoint(environment = process.env) {
  const raw = String(environment.PINKIE_APP_BROWSER_ENDPOINT || '').trim();
  if (!raw) throw new Error(UNAVAILABLE);
  let endpoint;
  try { endpoint = raw.startsWith('{') ? JSON.parse(raw) : {socketPath: raw}; }
  catch { throw new Error('App 浏览器连接信息无效，请改用 browser 工具。'); }
  const socketPath = String(endpoint?.socketPath || '');
  if (!path.isAbsolute(socketPath) || socketPath.includes('\0')) {
    throw new Error('App 浏览器套接字路径无效，请改用 browser 工具。');
  }
  try {
    const socket = fs.lstatSync(socketPath);
    const directory = fs.lstatSync(path.dirname(socketPath));
    const uid = process.getuid?.();
    if (!socket.isSocket() || !directory.isDirectory() || (socket.mode & 0o077)
        || (directory.mode & 0o077) || (uid !== undefined && (socket.uid !== uid || directory.uid !== uid))) {
      throw new Error('private-endpoint');
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error(UNAVAILABLE);
    throw new Error('App 浏览器连接不在当前用户的私有目录中，请改用 browser 工具。');
  }
  return {socketPath, ...(endpoint.token ? {token: String(endpoint.token)} : {})};
}

export function requestAppBrowser(action, params = {}, {environment = process.env, timeoutMs = appBrowserTimeout(action, params), signal} = {}) {
  const endpoint = appBrowserEndpoint(environment);
  aborted(signal);
  const id = randomUUID();
  const {action: _action, timeout_ms: _timeout, ...fields} = params;
  const request = {...fields, id, action, timeoutMs, ...(endpoint.token ? {token: endpoint.token} : {})};
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.socketPath);
    let buffered = '';
    let size = 0;
    let settled = false;
    const finish = (error, reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (error) reject(error); else resolve(reply);
    };
    const cancelNative = () => {
      // Cancellation uses the same authenticated private endpoint. This only
      // prevents pending work; a click already dispatched cannot be undone.
      const cancel = net.createConnection(endpoint.socketPath);
      const deadline = setTimeout(() => cancel.destroy(), 500); deadline.unref?.();
      cancel.unref();
      cancel.on('connect', () => cancel.end(JSON.stringify({id:randomUUID(),action:'cancel',requestId:id,...(endpoint.token?{token:endpoint.token}:{})})+'\n'));
      cancel.on('error', () => {});
      cancel.on('close', () => clearTimeout(deadline));
    };
    const onAbort = () => { cancelNative(); finish(new Error('浏览器操作已取消；请先观察页面确认已完成的部分。')); };
    const timer = setTimeout(() => { cancelNative(); finish(new Error(`App 浏览器操作超时（${Math.ceil(timeoutMs / 1000)} 秒），请先观察页面确认结果。`)); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, {once: true});
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_MESSAGE_BYTES) return finish(new Error('App 浏览器返回内容过大，请减少快照内容后重试。'));
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        let reply;
        try { reply = JSON.parse(line); }
        catch { return finish(new Error('App 浏览器返回了无效的连接消息。')); }
        if (reply?.id !== id) continue;
        if (typeof reply.ok !== 'boolean') return finish(new Error('App 浏览器返回的操作状态无效。'));
        return finish(null, reply);
      }
    });
    socket.on('error', error => finish(new Error(['ENOENT', 'ECONNREFUSED'].includes(error.code)
      ? UNAVAILABLE : '无法连接 App 浏览器，请检查 App 状态后重试，或改用 browser 工具。')));
    socket.on('close', () => finish(new Error('App 浏览器连接提前关闭，请重试当前操作。')));
  });
}

function expandedPath(value, home) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0')) throw new Error('本地路径无效。');
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? path.join(home, raw.slice(2)) : raw;
  if (!path.isAbsolute(expanded)) throw new Error('请填写本地文件或目录的绝对路径。');
  return path.resolve(expanded);
}
function within(parent, file) {
  const relative = path.relative(parent, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function safeHomePath(home, file) {
  if (!within(home, file)) throw new Error('为保护系统文件，只能打开用户主目录里的文件。');
  const parts = path.relative(home, file).split(path.sep).map(part => part.toLowerCase());
  // ~/.openclaw/workspace* 和 --profile 的 ~/.openclaw-<名字>/workspace* 都算模式工作区。
  const isWorkspace = (dir) => typeof dir === 'string' && (dir === 'workspace' || dir.startsWith('workspace-'));
  const stateFolder = /^\.openclaw(?:-.+)?$/.test(parts[0] || '');
  const workspace = stateFolder && isWorkspace(parts[1] || '');
  if (parts[0] === '.ssh' || (parts[0] === 'library' && parts[1] === 'keychains') || (stateFolder && !workspace)) {
    throw new Error('这个位置包含密钥或 Li An 配置，不能从浏览器里打开。');
  }
}
function validateDirectory(raw, home, {requireHome = true} = {}) {
  let resolved;
  try { resolved = fs.realpathSync(expandedPath(raw, home)); }
  catch (error) { if (error.code) throw new Error('本地目录不存在或没有读取权限。'); throw error; }
  if (requireHome) safeHomePath(home, resolved);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('本地服务需要一个目录。');
  return resolved;
}

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2',
});

function staticRequest(directory, home, req, res, log) {
  const respond = (status, text) => { res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(text); };
  if (!['GET', 'HEAD'].includes(req.method)) return respond(405, '这里只支持读取网页。');
  try {
    const pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) {
      return respond(403, '不能读取目录外的文件。');
    }
    let file = path.resolve(directory, `.${pathname}`);
    if (!within(directory, file)) return respond(403, '不能读取目录外的文件。');
    file = fs.realpathSync(file);
    if (!within(directory, file)) return respond(403, '不能读取目录外的文件。');
    safeHomePath(home, file);
    if (fs.statSync(file).isDirectory()) {
      file = fs.realpathSync(path.join(file, 'index.html'));
      if (!within(directory, file)) return respond(403, '不能读取目录外的文件。');
      safeHomePath(home, file);
    }
    const stat = fs.statSync(file);
    if (!stat.isFile()) return respond(403, '这里只能读取普通文件。');
    let start = 0, end = stat.size - 1, status = 200;
    const headers = {'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'};
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2]) || !stat.size) {
        res.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); return res.end();
      }
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      else { start = Math.max(0, stat.size - Number(range[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size || Number(range[2]) < 0) {
        res.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); return res.end();
      }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = stat.size ? end - start + 1 : 0;
    const stream = req.method === 'HEAD' || !stat.size ? null : fs.createReadStream(file, {start, end});
    res.writeHead(status, headers);
    log(`${req.method} ${pathname.slice(0, 200)} → ${status}`);
    if (!stream) return res.end();
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    if (error instanceof URIError) return respond(400, '网页路径无效。');
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return respond(404, '这个网页文件不存在。');
    return respond(403, '没有权限读取这个文件。');
  }
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    let settled = false;
    const finish = open => { if (settled) return; settled = true; socket.destroy(); resolve(open); };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function addLog(record, text) {
  // Keep bounded partial lines as well as the last 40 complete lines.
  record.partial = (record.partial + String(text)).slice(-32_000);
  const lines = record.partial.split(/\r?\n/);
  record.partial = lines.pop();
  record.logs.push(...lines.map(line => line.slice(-2_000)));
  record.logs = record.logs.slice(-40);
}

function signalProcess(record, signal) {
  if (!record.child?.pid) return;
  try {
    if (process.platform === 'win32') record.child.kill(signal);
    else process.kill(-record.child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function processAlive(record) {
  if (!record.child?.pid) return false;
  try { process.kill(process.platform === 'win32' ? record.child.pid : -record.child.pid, 0); return true; }
  catch { return false; }
}

export class AppBrowserServers {
  constructor({environment = process.env, homeDirectory = os.homedir(), serveTimeoutMs = 60_000, stopGraceMs = 1_000, memoryFile} = {}) {
    this.environment = environment;
    this.home = fs.realpathSync(homeDirectory);
    this.memory = new BrowserSiteMemory(memoryFile ?? path.join(this.home, '.openclaw', 'pinkie-browser', 'site-memory.json'));
    this.serveTimeoutMs = Math.min(60_000, Math.max(1, serveTimeoutMs));
    this.stopGraceMs = Math.min(2_000, Math.max(1, stopGraceMs));
    this.servers = new Set();
    this.pendingRequests = new Set();
    this.pendingServes = new Set();
    this.disposed = false;
    liveManagers.add(this);
    if (!exitCleanupInstalled) {
      exitCleanupInstalled = true;
      process.once('exit', () => { for (const manager of liveManagers) manager.disposeSync(); });
    }
  }

  async request(action, params, {signal} = {}) {
    if (this.disposed) throw new Error('网关正在退出，App 浏览器操作已取消。');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) controller.abort();
    this.pendingRequests.add(controller);
    try { return await requestAppBrowser(action, params, {environment: this.environment, signal: controller.signal}); }
    finally { this.pendingRequests.delete(controller); signal?.removeEventListener('abort', onAbort); }
  }

  records(ctx, params = {}) {
    const owner = sessionOwner(ctx);
    if (!owner) throw new Error('缺少当前 Li An 会话，不能管理本地服务。');
    if (params.pid !== undefined && (!Number.isInteger(params.pid) || params.pid < 1)) throw new Error('服务进程号无效。');
    if (params.port !== undefined && (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535)) throw new Error('服务端口无效。');
    return [...this.servers].filter(record => record.owner === owner
      && (params.pid === undefined || record.pid === params.pid) && (params.port === undefined || record.port === params.port));
  }

  async serve(ctx, params, {signal} = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) controller.abort();
    const pending = {...sessionContext(ctx), controller};
    this.pendingServes.add(pending);
    try {
      pending.done = this.startServe(ctx, params, {signal: controller.signal});
      return await pending.done;
    } finally {
      this.pendingServes.delete(pending);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async startServe(ctx, params, {signal} = {}) {
    aborted(signal);
    if (this.disposed) throw new Error('网关正在退出，不能启动新的本地服务。');
    if (!sessionOwner(ctx)) throw new Error('缺少当前 Li An 会话，不能启动本地服务。');
    // Fail before starting a process when there is no visible App browser.
    appBrowserEndpoint(this.environment);
    const staticMode = typeof params.dir === 'string' && params.dir.trim();
    if (staticMode ? params.command !== undefined || params.cwd !== undefined || params.port !== undefined
      : !params.command || !params.cwd || !Number.isInteger(params.port) || params.port < 1 || params.port > 65535) {
      throw new Error('启动服务请二选一：填写 dir，或同时填写 command、cwd、port。');
    }
    const record = {...sessionContext(ctx), owner: sessionOwner(ctx), logs: [], partial: '', kind: staticMode ? 'static' : 'command', pid: process.pid, stopped: false};
    const onAbort = () => { void this.stopRecord(record); };
    signal?.addEventListener('abort', onAbort, {once: true});
    try {
      if (staticMode) {
        const directory = validateDirectory(params.dir, this.home);
        record.http = http.createServer((req, res) => staticRequest(directory, this.home, req, res, line => addLog(record, `${line}\n`)));
        record.ready = new Promise((resolve, reject) => {
          const onError = () => reject(new Error('无法启动本地网页服务，请检查端口和目录。'));
          record.http.once('error', onError);
          record.http.listen(0, '127.0.0.1', () => { record.http.off('error', onError); resolve(); });
        });
        this.servers.add(record);
        await record.ready;
        aborted(signal);
        if (record.stopped) throw new Error('本地服务已经结束。');
        record.port = record.http.address().port;
        addLog(record, '本地网页服务已启动。\n');
      } else {
        const cwd = validateDirectory(params.cwd, this.home, {requireHome: false});
        if (await portOpen(params.port)) throw new Error('这个端口已经被其他服务占用，Li An 没有启动或接管它。');
        aborted(signal);
        if (this.disposed) throw new Error('网关正在退出，不能启动新的本地服务。');
        record.port = params.port;
        record.child = spawn(String(params.command), {
          cwd, shell: true, detached: process.platform !== 'win32',
          env: {...this.environment, HOST: '127.0.0.1', PORT: String(params.port)}, stdio: ['ignore', 'pipe', 'pipe'],
        });
        record.pid = record.child.pid;
        this.servers.add(record);
        record.child.stdout.setEncoding('utf8');
        record.child.stderr.setEncoding('utf8');
        record.child.stdout.on('data', data => addLog(record, data));
        record.child.stderr.on('data', data => addLog(record, data));
        record.child.once('error', () => { record.failed = '项目服务启动失败，请检查命令和目录。'; });
        record.child.once('exit', (code, exitSignal) => {
          record.exited = true;
          addLog(record, `项目服务已退出${Number.isInteger(code) ? `，退出码 ${code}` : exitSignal ? '。' : ''}\n`);
        });
      }
      const deadline = Date.now() + this.serveTimeoutMs;
      while (true) {
        aborted(signal);
        if (record.stopped) throw new Error('本地服务已经结束。');
        if (record.failed || record.exited) throw new Error(record.failed || '项目服务在网页可用之前退出了，请用 serve_logs 检查日志。');
        if (await portOpen(record.port)) break;
        if (Date.now() >= deadline) throw new Error('等待本地服务超时（最多 60 秒），服务已停止，请检查启动命令。');
        await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
      }
      record.url = `http://127.0.0.1:${record.port}/`;
      const reply = await this.request('open', {
        url: record.url,
        ...(params.focus !== undefined ? {focus: params.focus} : {}),
        ...(params.timeout_ms !== undefined ? {timeout_ms: params.timeout_ms} : {}),
      }, {signal});
      if (!reply.ok) {
        const reason = String(reply.reason || '侧栏暂时无法打开这个网页。');
        // A user's takeover / active ChatGPT collaboration must not destroy
        // the server they can open later; keep ownership and its stop handle.
        return {...failure(reason + ' 本地服务已启动，可稍后用 open 打开。'), url: record.url, pid: record.pid, port: record.port, kind: record.kind};
      }
      return {ok: true, message: '本地服务已启动，并已在 App 侧栏打开。', url: record.url, pid: record.pid, port: record.port, kind: record.kind};
    } catch (error) {
      await this.stopRecord(record);
      throw error;
    } finally { signal?.removeEventListener('abort', onAbort); }
  }

  async stopRecord(record) {
    if (record.stopping) return record.stopping;
    record.stopped = true;
    record.stopping = (async () => {
      if (record.http) {
        await record.ready?.catch(() => {});
        record.http.closeAllConnections?.();
        await new Promise(resolve => record.http.close(() => resolve()));
      } else if (record.child?.pid) {
        signalProcess(record, 'SIGTERM');
        const deadline = Date.now() + this.stopGraceMs;
        while (processAlive(record) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
        if (processAlive(record)) signalProcess(record, 'SIGKILL');
      }
      addLog(record, '本地服务已停止。\n');
    })();
    return record.stopping;
  }

  async stop(ctx, params = {}) {
    if (params.pid === undefined && params.port === undefined) throw new Error('停止服务需要 pid 或 port。');
    const records = this.records(ctx, params);
    if (!records.length) throw new Error('当前会话没有启动这个服务，Li An 不会停止其他会话或用户的进程。');
    await Promise.all(records.map(record => this.stopRecord(record)));
    return {ok: true, message: '本会话的本地服务已停止。', services: records.map(({url, pid, port}) => ({url, pid, port}))};
  }

  logs(ctx, params = {}) {
    const records = this.records(ctx, params);
    if (!records.length) throw new Error('当前会话还没有可查看的本地服务日志。');
    return {ok: true, message: '以下是本地服务的最后 40 行日志。', services: records.map(record => ({
      url: record.url, pid: record.pid, port: record.port, stopped: record.stopped,
      logs: [...record.logs, ...(record.partial ? [record.partial.slice(-2_000)] : [])].slice(-40),
    }))};
  }

  async cleanupSession(event = {}, ctx = {}) {
    const pending = [...this.pendingServes].filter(record => matchesSession(record, event, ctx));
    for (const entry of pending) entry.controller.abort();
    const records = [...this.servers].filter(record => matchesSession(record, event, ctx));
    await Promise.allSettled([...pending.map(entry => entry.done), ...records.map(record => this.stopRecord(record))]);
    for (const record of records) this.servers.delete(record);
  }

  async dispose() {
    this.disposed = true;
    for (const pending of this.pendingServes) pending.controller.abort();
    for (const controller of this.pendingRequests) controller.abort();
    await Promise.allSettled([...this.pendingServes].map(entry => entry.done).concat([...this.servers].map(record => this.stopRecord(record))));
    this.servers.clear();
    liveManagers.delete(this);
  }

  disposeSync() {
    this.disposed = true;
    for (const pending of this.pendingServes) pending.controller.abort();
    for (const controller of this.pendingRequests) controller.abort();
    for (const record of this.servers) {
      if (record.http) { record.http.closeAllConnections?.(); record.http.close(); }
      else { try { signalProcess(record, 'SIGKILL'); } catch {} }
    }
    this.servers.clear();
  }
}

// Site memory: steps that worked on a page are kept as portable targets
// (role + accessible name or selector, never document refs), so the next
// visit replays them in one call instead of exploring the page again.
const MEMORY_STEP_FIELDS = ['action','selector','name','role','exact','text','value','submit','key','dx','dy','x','y','sliderValue','input','button','clickCount','durationMs','waitFor','ms','toSelector','toName','toRole','toExact','toX','toY','targetTimeoutMs'];
const RECORDED_ACTIONS = new Set(['click','type','select','press','scroll','hover','drag','set_slider']);
const MAX_RECIPE_STEPS = 24, MAX_RECIPES_PER_PAGE = 6, MAX_MEMORY_PAGES = 300;
const REPLAY_ACTIONS = new Set([...BATCH_ACTIONS]);

export function browserPageKey(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return ''; }
  if (url.protocol === 'file:') return `file:${url.pathname}`;
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Ids in paths (/item/123, /doc/9f2c…) vary per visit; the page shape does not.
  const parts = url.pathname.split('/').filter(Boolean)
    .map(part => /^\d+$|^[0-9a-f]{12,}$|^[0-9a-f-]{32,36}$/i.test(part) ? ':id' : decodeURIComponent(part).slice(0, 80));
  return `${local ? 'local' : url.host.toLowerCase()}/${parts.join('/')}`;
}

function stepLabel(step) {
  const target = step.name ? `${step.role ? `${step.role}` : ''}「${step.name}」` : step.selector ? `\`${step.selector}\``
    : Number.isFinite(step.x) ? `(${step.x},${step.y})` : '';
  const to = step.toName ? ` →「${step.toName}」` : step.toSelector ? ` → \`${step.toSelector}\`` : Number.isFinite(step.toX) ? ` → (${step.toX},${step.toY})` : '';
  const value = step.text !== undefined ? ` = ${step.text}` : step.value !== undefined ? ` = ${step.value}` : step.sliderValue !== undefined ? ` = ${step.sliderValue}`
    : step.key ? ` ${step.key}` : step.action === 'scroll' && !target ? ` dy=${step.dy ?? 0}` : '';
  return `${step.action} ${target}${to}${value}`.replace(/\s+/g, ' ').trim();
}

function fieldValue(list, key) {
  if (Array.isArray(list)) return list.find(item => item && item.name === key)?.value;
  return list && typeof list === 'object' ? list[key] : undefined;
}

export class BrowserSiteMemory {
  constructor(file) { this.file = file || ''; this.data = null; this.trails = new Map(); }

  load() {
    if (this.data) return this.data;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data?.version === 1 && data.pages && typeof data.pages === 'object') this.data = data;
    } catch {}
    return this.data ||= {version: 1, pages: {}};
  }

  persist() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive: true, mode: 0o700});
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.data), {mode: 0o600});
      fs.renameSync(temporary, this.file);
    } catch {}
  }

  trail(owner) {
    const id = owner || 'default';
    let trail = this.trails.get(id);
    if (!trail) {
      trail = {key: '', url: '', refs: new Map(), elements: [], steps: [], saved: false, announced: ''};
      this.trails.set(id, trail);
      if (this.trails.size > 64) this.trails.delete(this.trails.keys().next().value);
    }
    return trail;
  }

  // A trail starts at an opened page and follows the clicks that navigate
  // away from it, so a multi-page flow replays from where it began.
  start(owner, url) {
    this.flush(owner);
    const trail = this.trail(owner);
    Object.assign(trail, {key: browserPageKey(url), url: String(url || ''), steps: [], saved: false, announced: ''});
    return trail;
  }

  observe(owner, result) {
    const trail = this.trail(owner);
    const url = result?.page?.url || (typeof result?.url === 'string' ? result.url : '');
    if (url && !trail.key) Object.assign(trail, {key: browserPageKey(url), url});
    for (const list of [result?.observation?.elements, result?.elements, result?.matches]) {
      if (!Array.isArray(list) || !list.length) continue;
      if (list !== result?.matches) trail.elements = list.slice(0, 300);
      for (const element of list) {
        if (element?.ref && element.name) trail.refs.set(element.ref, {role: element.role, name: element.name, protected: element.protected === true});
      }
    }
    while (trail.refs.size > 3000) trail.refs.delete(trail.refs.keys().next().value);
    return trail;
  }

  portable(trail, step) {
    const out = {};
    for (const field of MEMORY_STEP_FIELDS) if (step[field] !== undefined) out[field] = step[field];
    for (const [refField, nameField, roleField, exactField] of [['ref', 'name', 'role', 'exact'], ['toRef', 'toName', 'toRole', 'toExact']]) {
      if (!step[refField]) continue;
      const known = trail.refs.get(step[refField]);
      if (!known?.name) return null;
      out[nameField] = known.name; out[exactField] = true;
      if (known.role) out[roleField] = known.role;
      if (refField === 'ref' && known.protected) out.secret = true;
    }
    return out;
  }

  record(owner, step) {
    if (!RECORDED_ACTIONS.has(step?.action)) return;
    const trail = this.trail(owner);
    if (!trail.key || trail.steps.length >= MAX_RECIPE_STEPS) { trail.overflow = !!trail.key; return; }
    trail.steps.push(this.portable(trail, step));
    trail.saved = false;
  }

  recipes(key) { return key ? this.load().pages[key]?.recipes || [] : []; }

  brief(recipe) {
    return {id: recipe.id, title: recipe.title, steps: recipe.steps.map(stepLabel),
      ...(Object.keys(recipe.vars || {}).length ? {vars: recipe.vars} : {}), uses: recipe.uses || 0, ...(recipe.auto ? {auto: true} : {})};
  }

  known(owner, url) {
    const trail = this.trail(owner), key = url ? browserPageKey(url) : trail.key;
    const recipes = this.recipes(key);
    return recipes.length ? recipes.slice(0, 4).map(recipe => this.brief(recipe)) : undefined;
  }

  // Typed text, chosen options and slider values become named variables
  // whose defaults are what worked last time.
  template(steps) {
    const vars = {}, used = new Set();
    const variable = (step, field, fallback) => {
      let label = String(step.name || step.selector || fallback).slice(0, 24), n = 2;
      while (used.has(label)) label = `${String(step.name || step.selector || fallback).slice(0, 24)}${n++}`;
      used.add(label);
      vars[label] = step.secret ? '' : String(step[field]);
      return `{{${label}}}`;
    };
    const templated = steps.map((step, index) => {
      const copy = {...step};
      if (copy.action === 'type' && copy.text !== undefined) copy.text = variable(copy, 'text', `文本${index + 1}`);
      if (copy.action === 'select' && copy.value !== undefined) copy.value = variable(copy, 'value', `选项${index + 1}`);
      else if (copy.action === 'select' && copy.text !== undefined) copy.text = variable(copy, 'text', `选项${index + 1}`);
      if (copy.action === 'set_slider' && copy.sliderValue !== undefined) copy.sliderValue = variable(copy, 'sliderValue', `数值${index + 1}`);
      delete copy.secret;
      return copy;
    });
    return {steps: templated, vars};
  }

  save(owner, title, {auto = false} = {}) {
    const trail = this.trail(owner);
    if (!trail.key || !trail.steps.length) return {ok: false, reason: '这一页还没有可记住的成功操作。'};
    if (trail.overflow) return {ok: false, reason: `操作超过 ${MAX_RECIPE_STEPS} 步，没有记住；请把任务拆小后再记。`};
    if (trail.steps.some(step => !step)) return {ok: false, reason: '有步骤用的 ref 没在观察里出现过名称，没能记住；下次可用 name 或 selector 定位。'};
    const {steps, vars} = this.template(trail.steps.filter(step => step.action !== 'move'));
    const data = this.load(), signature = JSON.stringify(steps);
    const page = data.pages[trail.key] ||= {recipes: []};
    let recipe = page.recipes.find(item => JSON.stringify(item.steps) === signature);
    const name = String(title || '').trim().slice(0, 60) || `自动记录：${steps.slice(0, 2).map(stepLabel).join('，')}`.slice(0, 60);
    if (recipe) {
      if (!auto || recipe.auto) recipe.title = name;
      if (!auto) recipe.auto = false;
      recipe.vars = vars; recipe.savedAt = Date.now();
    } else {
      recipe = {id: `r${randomUUID().replace(/-/g, '').slice(0, 6)}`, title: name, steps, vars, uses: 0, fails: 0, auto, savedAt: Date.now()};
      page.recipes.unshift(recipe);
      while (page.recipes.length > MAX_RECIPES_PER_PAGE) {
        const drop = page.recipes.findLastIndex(item => item.auto);
        page.recipes.splice(drop >= 0 ? drop : page.recipes.length - 1, 1);
      }
    }
    page.url = trail.url; page.touched = Date.now();
    const keys = Object.keys(data.pages);
    if (keys.length > MAX_MEMORY_PAGES) {
      keys.sort((a, b) => (data.pages[a].touched || 0) - (data.pages[b].touched || 0));
      for (const key of keys.slice(0, keys.length - MAX_MEMORY_PAGES)) delete data.pages[key];
    }
    trail.saved = true;
    this.persist();
    return {ok: true, recipe: this.brief(recipe)};
  }

  // Unsaved trails of two or more steps are kept automatically at turn end;
  // replay failures demote them again.
  flush(owner) {
    const trail = this.trails.get(owner || 'default');
    if (!trail || trail.saved || trail.steps.length < 2) return;
    this.save(owner, '', {auto: true});
  }

  find(id) {
    for (const [key, page] of Object.entries(this.load().pages)) {
      const recipe = page.recipes.find(item => item.id === id);
      if (recipe) return {key, page, recipe};
    }
    return null;
  }

  instantiate(recipe, given) {
    const missing = [], unknown = [];
    const names = Object.keys(recipe.vars || {});
    for (const item of Array.isArray(given) ? given : Object.entries(given || {}).map(([name, value]) => ({name, value}))) {
      if (item && !names.includes(item.name)) unknown.push(item.name);
    }
    if (unknown.length) throw new Error(`这个记录没有变量 ${unknown.join('、')}；可用变量：${names.join('、') || '无'}。`);
    const fill = value => String(value).replace(/\{\{([^}]+)\}\}/g, (_, name) => {
      const supplied = fieldValue(given, name), fallback = recipe.vars?.[name];
      const result = supplied !== undefined ? supplied : fallback;
      if (result === undefined || result === '') missing.push(name);
      return String(result ?? '');
    });
    const steps = recipe.steps.map(step => {
      const copy = {...step};
      for (const field of ['text', 'value', 'sliderValue']) if (typeof copy[field] === 'string') copy[field] = fill(copy[field]);
      if (typeof copy.sliderValue === 'string') copy.sliderValue = Number(copy.sliderValue);
      return copy;
    });
    if (missing.length) throw new Error(`回放需要先提供：${[...new Set(missing)].join('、')}。`);
    return steps;
  }

  result(id, ok) {
    const found = this.find(id);
    if (!found) return;
    const {page, recipe} = found;
    if (ok) { recipe.uses = (recipe.uses || 0) + 1; recipe.fails = 0; recipe.lastUsedAt = Date.now(); }
    else {
      recipe.fails = (recipe.fails || 0) + 1;
      if (recipe.fails >= (recipe.auto ? 1 : 3)) page.recipes.splice(page.recipes.indexOf(recipe), 1);
    }
    page.touched = Date.now();
    this.persist();
  }

  forget(id) {
    const found = this.find(id);
    if (!found) return false;
    found.page.recipes.splice(found.page.recipes.indexOf(found.recipe), 1);
    this.persist();
    return true;
  }

  // fill: label → value pairs become typed steps chosen from the last
  // observation, so a whole form is one call.
  fillSteps(owner, fields) {
    const entries = Array.isArray(fields) ? fields.map(item => [item?.name, item?.value]) : Object.entries(fields || {});
    if (!entries.length || entries.length > 20) throw new Error('fill 需要 1 至 20 个 fields（name 为字段名，value 为要填的值）。');
    const elements = this.trail(owner).elements;
    return entries.map(([label, raw]) => {
      const name = String(label ?? '').trim();
      if (!name) throw new Error('fill 的每个字段都需要 name。');
      const value = String(raw ?? '');
      const clean = text => String(text || '').toLocaleLowerCase();
      const exact = elements.filter(el => clean(el.name) === clean(name));
      const loose = exact.length ? exact : elements.filter(el => clean(el.name).includes(clean(name)) && !['button', 'link'].includes(el.role));
      const el = loose.length === 1 ? loose[0] : null;
      if (!el) return {action: 'type', name, text: value};
      if (el.options) return {action: 'select', ref: el.ref, value};
      if (el.slider || el.role === 'slider') return {action: 'set_slider', ref: el.ref, sliderValue: Number(value)};
      if (['checkbox', 'radio', 'switch'].includes(el.role) || typeof el.checked === 'boolean') {
        const want = !/^(false|0|no|off|否|不|取消)$/i.test(value);
        return el.checked === want ? null : {action: 'click', ref: el.ref};
      }
      return {action: 'type', ref: el.ref, text: value};
    }).filter(Boolean);
  }
}

function validateNativeAction(action, params) {
  const target = () => {
    if (!(typeof params.ref === 'string' && params.ref.trim()) && !(typeof params.selector === 'string' && params.selector.trim()) && !(typeof params.name === 'string' && params.name.trim())) {
      throw new Error('这个操作需要快照里的 ref 或网页 selector。');
    }
  };
  if (action === 'open' && !(typeof params.url === 'string' && params.url.trim())) throw new Error('打开网页需要 url。');
  if (action === 'show_file' && !(typeof params.path === 'string' && params.path.trim())) throw new Error('预览文件需要 path。');
  if (action === 'type') { target(); if (typeof params.text !== 'string') throw new Error('输入操作需要 text。'); }
  if (action === 'select') { target(); if (params.value === undefined && typeof params.text !== 'string') throw new Error('选择下拉选项需要 value 或 text。'); }
  if (action === 'locate' && !params.selector && !params.name && !params.text && !params.role) throw new Error('定位控件需要 name、role、text 或 selector。');
  if (['click','move','hover','drag'].includes(action)) {
    if (params.x !== undefined || params.y !== undefined) {
      if (!Number.isFinite(params.x) || !Number.isFinite(params.y) || params.x < 0 || params.y < 0) throw new Error('鼠标坐标需同时提供有限的非负 x、y，单位为网页可见区域 CSS 像素。');
      if (params.ref || params.selector || params.name) throw new Error('鼠标目标请在 ref/selector/name 与 x/y 中选择一种。');
    } else target();
    if (params.input !== undefined && !['auto','native'].includes(params.input)) throw new Error('input 只支持 auto 或 native。');
    if (params.button !== undefined && !['left','right'].includes(params.button)) throw new Error('button 只支持 left 或 right。');
    if (params.clickCount !== undefined && (!Number.isInteger(params.clickCount)||params.clickCount<1||params.clickCount>3)) throw new Error('clickCount 范围为 1 到 3。');
  }
  if (action === 'drag') {
    const byRef=typeof params.toRef==='string'&&params.toRef.trim(),bySelector=typeof params.toSelector==='string'&&params.toSelector.trim(),byName=typeof params.toName==='string'&&params.toName.trim(),byPoint=params.toX!==undefined||params.toY!==undefined;
    if ([!!byRef,!!bySelector,!!byName,byPoint].filter(Boolean).length!==1 || (byPoint&&(!Number.isFinite(params.toX)||!Number.isFinite(params.toY)||params.toX<0||params.toY<0))) throw new Error('拖拽终点请提供 toRef、toSelector、toName 或一组非负 toX/toY。');
    if (params.button==='right') throw new Error('拖拽使用左键。');
    if (params.durationMs!==undefined&&(!Number.isInteger(params.durationMs)||params.durationMs<100||params.durationMs>1500)) throw new Error('拖拽时间范围为 100 到 1500 毫秒。');
  }
  if(action==='set_slider'){target();if(!Number.isFinite(params.sliderValue))throw new Error('set_slider需要有限的sliderValue目标数值。');}
  if (action === 'press' && !['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(params.key)) {
    throw new Error('按键只支持回车、退出、制表和方向键，请填写 Enter、Escape、Tab 或 ArrowUp/Down/Left/Right。');
  }
  if (action === 'scroll' && !Number.isFinite(params.dy) && !Number.isFinite(params.dx) && !params.ref && !params.selector) throw new Error('滚动需要 dx/dy、ref 或 selector。');
  if (action === 'eval' && !(typeof params.js === 'string' && params.js.trim())) throw new Error('本地网页执行需要 js。');
  if (action === 'wait') {
    const criteria = [params.text !== undefined, params.selector !== undefined, params.ref !== undefined, params.name !== undefined, params.ms !== undefined].filter(Boolean).length;
    if (criteria !== 1 || (params.text !== undefined && !(typeof params.text === 'string' && params.text.trim()))
      || (params.selector !== undefined && !(typeof params.selector === 'string' && params.selector.trim()))
      || (params.ref !== undefined && !(typeof params.ref === 'string' && params.ref.trim()))
      || (params.name !== undefined && !(typeof params.name === 'string' && params.name.trim()))
      || (params.waitFor !== undefined && !['visible','hidden','attached','detached','enabled'].includes(params.waitFor))
      || (params.ms !== undefined && (!Number.isInteger(params.ms) || params.ms < 0 || params.ms > 15_000))) {
      throw new Error('等待请只填写 text、selector、ref、name 或 ms 之一，最多 15 秒。');
    }
  }
}

let defaultServers;
export function createAppBrowserTool(ctx = {}, {servers = defaultServers ||= new AppBrowserServers()} = {}) {
  let activeContext = sessionContext(ctx);
  return {
    name: 'app_browser',
    label: 'App 浏览器',
    description: '所有模式共用的内置悬浮浏览器，操作用户当前看得到的页面。【最快路径，少回合】①open拿精简observation；结果里有known（这一页以前成功过的操作）就直接replay recipe=id，vars改要填的值，一次完成。②没有记录就看observation把能确定的步骤合成一次batch（可带url先打开再操作）：type/select/set_slider/hover→click菜单/drag，最后用wait text或name校验结果；表单直接fill fields=[{name:字段名,value:值}]，submitName填提交按钮名。③不要一回合只做一个动作，不要每步后再snapshot（操作已自带observation）。成功的步骤会按role+名称自动记住；完成多步任务时在最后那次调用加remember="简短标题"，下次同一页就能一步replay。replay失败说明页面改版：看返回的observation改用batch，成功后带remember覆盖。recipes列出本页记录，forget删除过期记录。【细节】ref在同一文档内稳定，失效时用locate按role/name定位，不猜坐标；snapshot可用since传snapshotId省略未变内容，可传ref或selector只观察局部，scope=page看屏幕外控件。select优先用快照options里的value，也可传text匹配显示文字；read单独读取正文。scroll加selector/ref和dy可滚动表格等内部容器。batch内每步重新定位并检查遮挡，失败会返回已完成部分和failedStep，先看新观察再继续，不能整批重发。open默认等待DOM可操作，不等广告和图片；动态内容用wait selector/name和waitFor=visible/hidden/enabled，避免固定sleep。set_slider用sliderValue直接设原生range滑杆并回读，不要猜坐标。move/hover控制浏览器内独立鼠标；drag从ref/selector/name或x/y拖到toRef/toSelector/toName或toX/toY，用于滑块、Canvas、选中文字。click默认快速定位，input=native或提供坐标、button、clickCount时走原生指针。坐标是当前可见网页的CSS像素，不能用全页截图坐标。文件弹窗或仍不能处理的原生控件改用computer，不要循环试点。用户正在操作或ChatGPT协作时写操作会拒绝，不要强行重试。不要并发发多个独立写操作。serve用于本地项目预览（127.0.0.1）；stop_serve/serve_logs仅管理本会话服务。eval仍只允许本地页面；操控其他应用用computer。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: {type: 'string', enum: APP_BROWSER_ACTIONS},
        url: {type: 'string'}, focus: {type: 'boolean'}, maxChars: {type: 'integer', minimum: 1, maximum: 100_000},
        fullPage: {type: 'boolean'}, ref: {type: 'string'}, selector: {type: 'string'},
        x: {type: 'number'}, y: {type: 'number'}, text: {type: 'string'}, submit: {type: 'boolean'},
        toRef: {type:'string'},toSelector: {type:'string'},toX: {type:'number'},toY: {type:'number'},
        toName:{type:'string'},toRole:{type:'string'},toExact:{type:'boolean'},
        durationMs: {type:'integer',minimum:100,maximum:1500},input: {type:'string',enum:['auto','native']},
        sliderValue:{type:'number'},
        button: {type:'string',enum:['left','right']},clickCount: {type:'integer',minimum:1,maximum:3},dx:{type:'number'},
        key: {type: 'string', enum: ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']},
        dy: {type: 'number'}, ms: {type: 'integer', minimum: 0, maximum: 15_000}, js: {type: 'string'},
        path: {type: 'string'}, dir: {type: 'string'}, command: {type: 'string'}, cwd: {type: 'string'},
        port: {type: 'integer', minimum: 1, maximum: 65535}, pid: {type: 'integer', minimum: 1},
        timeout_ms: {type: 'integer', minimum: 1, maximum: 30_000},
        compact: {type: 'boolean'}, includeText: {type: 'boolean'}, includeRects: {type: 'boolean'},
        maxElements: {type: 'integer', minimum: 1, maximum: 300}, since: {type: 'string'},
        scope: {type: 'string', enum: ['viewport','page']}, observe: {type: 'boolean'},
        name: {type: 'string'}, role: {type: 'string'}, exact: {type: 'boolean'},
        limit: {type: 'integer', minimum: 1, maximum: 40}, value: {type: 'string'},
        remember: {type: 'string'}, title: {type: 'string'}, recipe: {type: 'string'}, submitName: {type: 'string'},
        vars: {type: 'array', maxItems: 20, items: {type: 'object', additionalProperties: false, properties: {name: {type: 'string'}, value: {type: 'string'}}, required: ['name', 'value']}},
        fields: {type: 'array', minItems: 1, maxItems: 20, items: {type: 'object', additionalProperties: false, properties: {name: {type: 'string'}, value: {type: 'string'}}, required: ['name', 'value']}},
        waitUntil: {type: 'string', enum: ['domcontentloaded','load']},
        waitFor: {type:'string',enum:['visible','hidden','attached','detached','enabled']},
        targetTimeoutMs: {type: 'integer', minimum: 0, maximum: 5000},
        steps: {type: 'array', minItems: 1, maxItems: 12, items: {type: 'object', additionalProperties: false,
          properties: {action:{type:'string',enum:[...BATCH_ACTIONS]},ref:{type:'string'},selector:{type:'string'},name:{type:'string'},role:{type:'string'},exact:{type:'boolean'},
            x:{type:'number'},y:{type:'number'},toRef:{type:'string'},toSelector:{type:'string'},toX:{type:'number'},toY:{type:'number'},durationMs:{type:'integer',minimum:100,maximum:1500},input:{type:'string',enum:['auto','native']},button:{type:'string',enum:['left','right']},clickCount:{type:'integer',minimum:1,maximum:3},dx:{type:'number'},
            sliderValue:{type:'number'},
            toName:{type:'string'},toRole:{type:'string'},toExact:{type:'boolean'},
            text:{type:'string'},value:{type:'string'},submit:{type:'boolean'},key:{type:'string',enum:['Enter','Escape','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']},dy:{type:'number'},waitFor:{type:'string',enum:['visible','hidden','attached','detached','enabled']},ms:{type:'integer',minimum:0,maximum:15000},targetTimeoutMs:{type:'integer',minimum:0,maximum:5000}},required:['action']}},
      }, required: ['action'],
    },
    prepareBeforeToolCallParams(params, meta = {}) {
      const trusted = sessionContext(meta.hookContext || meta);
      activeContext = {
        sessionId: trusted.sessionId || activeContext.sessionId,
        sessionKey: trusted.sessionKey || activeContext.sessionKey,
      };
      return params;
    },
    async execute(_toolCallId, params = {}, signal) {
      const memory = servers.memory ||= new BrowserSiteMemory('');
      const owner = sessionOwner(activeContext);
      const remember = typeof params.remember === 'string' && params.remember.trim() ? params.remember.trim() : '';
      const saved = reply => {
        if (!remember || !reply.ok) return reply;
        const kept = memory.save(owner, remember);
        return {...reply, remembered: kept.ok ? kept.recipe : {ok: false, reason: kept.reason}};
      };
      // Validate everything before the first side effect. Never retry a
      // completed prefix, even when a later control rerenders or navigates.
      const runSteps = async (steps, {url, limit = 12, recipe} = {}) => {
        if (!Array.isArray(steps) || !steps.length || steps.length > limit) throw new Error(`批量操作需要1至${limit}个步骤。`);
        for (const step of steps) {
          if (!step || !BATCH_ACTIONS.has(step.action)) throw new Error('batch只支持同页click/type/select/press/scroll/wait/move/hover/drag/set_slider。');
          validateNativeAction(step.action, step);
        }
        if (url !== undefined && !(typeof url === 'string' && url.trim())) throw new Error('打开网页需要 url。');
        if (browserBatches.has(servers)) throw new Error('另一组浏览器操作正在执行，请等待它完成。');
        const lease = {}, completed = [], deadline = AbortSignal.timeout(Math.min(30000, Math.max(1, params.timeout_ms || (url ? 25000 : 15000))));
        const batchSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
        browserBatches.set(servers, lease);
        try {
          if (url) {
            const opened = await servers.request('open', {url, ...(params.focus !== undefined ? {focus: params.focus} : {})}, {signal: batchSignal});
            if (!opened.ok) return {ok: false, reason: String(opened.reason || '侧栏暂时无法打开这个网页。'), completed, failedIndex: -1, replay: false, mayHaveExecuted: false};
            memory.start(owner, opened.result?.page?.url || url);
            memory.observe(owner, opened.result);
          }
          for (const [index, step] of steps.entries()) {
            aborted(batchSignal);
            const reply = await servers.request(step.action, {...step, observe: false}, {signal: batchSignal});
            if (!reply.ok) {
              if (recipe) memory.result(recipe, false);
              return {ok: false, reason: String(reply.reason || '步骤未完成'), completed, failedIndex: index, failedStep: stepLabel(step), replay: false, mayHaveExecuted: WRITE_ACTIONS.has(step.action), nextAction: 'snapshot-before-retry'};
            }
            memory.record(owner, step);
            memory.observe(owner, reply.result);
            completed.push({index, action: step.action, result: reply.result || {}});
          }
          if (recipe) memory.result(recipe, true);
          let observation;
          if (params.observe !== false) {
            const reply = await servers.request('snapshot', {compact: true, maxElements: 80, maxChars: 2400}, {signal: batchSignal});
            if (reply.ok) { observation = reply.result; memory.observe(owner, observation); }
          }
          return {ok: true, completed, ...(observation ? {observation} : {}), message: '批量操作已完成。'};
        } catch (error) {
          if (recipe) memory.result(recipe, false);
          return {ok: false, reason: batchSignal.aborted ? '这组操作已停止；已完成的步骤不会自动重发。' : error.message, completed, failedIndex: completed.length, replay: false, mayHaveExecuted: WRITE_ACTIONS.has(steps[completed.length]?.action), nextAction: 'snapshot-before-retry'};
        } finally { if (browserBatches.get(servers) === lease) browserBatches.delete(servers); }
      };
      try {
        const action = String(params.action || '');
        if (action === 'batch') return toolResult(saved(await runSteps(params.steps, {url: params.url})));
        if (action === 'fill') {
          const steps = memory.fillSteps(owner, params.fields);
          if (typeof params.submitName === 'string' && params.submitName.trim()) steps.push({action: 'click', name: params.submitName.trim(), exact: true});
          if (!steps.length) return toolResult({ok: true, completed: [], message: '这些字段已经是目标值，没有操作。'});
          return toolResult(saved(await runSteps(steps, {url: params.url, limit: 21})));
        }
        if (action === 'replay') {
          const found = typeof params.recipe === 'string' && memory.find(params.recipe.trim());
          if (!found) throw new Error('没有这个操作记录；先 open 页面查看 known 里的记录 id。');
          const steps = memory.instantiate(found.recipe, params.vars);
          for (const step of steps) if (!REPLAY_ACTIONS.has(step.action)) throw new Error('这个记录里有不能回放的步骤，请改用 batch。');
          const url = params.url || (memory.trail(owner).key !== found.key ? found.page.url : undefined);
          const result = await runSteps(steps, {url, limit: MAX_RECIPE_STEPS, recipe: found.recipe.id});
          if (result.ok) memory.trail(owner).saved = true;
          return toolResult({...result, recipe: found.recipe.id, ...(result.ok ? {} : {hint: '记录可能已过期：先看页面，再用 batch 完成；成功后带 remember 重新记住。'})});
        }
        if (action === 'remember') {
          const kept = memory.save(owner, params.title || params.remember || '');
          return toolResult(kept.ok ? {ok: true, message: '已记住这一页的操作，下次 open 时会出现在 known 里，可直接 replay。', recipe: kept.recipe} : kept);
        }
        if (action === 'recipes') {
          const known = memory.known(owner, params.url);
          return toolResult({ok: true, known: known || [], message: known ? '这一页已记住的操作。' : '这一页还没有记住的操作。'});
        }
        if (action === 'forget') return toolResult(memory.forget(String(params.recipe || '')) ? {ok: true, message: '已删除这条操作记录。'} : failure('没有这个操作记录。'));
        if (browserBatches.has(servers) && WRITE_ACTIONS.has(action)) throw new Error('另一组浏览器操作正在执行，请等待它完成。');
        if (action === 'serve') {
          const result = await servers.serve(activeContext, params, {signal});
          if (result.ok && result.url) { memory.start(owner, result.url); const known = memory.known(owner); if (known) result.known = known; }
          return toolResult(result);
        }
        if (action === 'stop_serve') return toolResult(await servers.stop(activeContext, params));
        if (action === 'serve_logs') return toolResult(servers.logs(activeContext, params));
        if (!NATIVE_ACTIONS.has(action)) throw new Error('不支持这个 App 浏览器操作。');
        validateNativeAction(action, params);
        const {remember: _remember, ...native} = params;
        const reply = await servers.request(action, native, {signal});
        if (!reply.ok) return toolResult({...failure(String(reply.reason || 'App 浏览器没有完成这个操作。')),mayHaveExecuted:reply.mayHaveExecuted===true,nextAction:reply.nextAction||'snapshot-before-retry'});
        const result = reply.result && typeof reply.result === 'object' ? reply.result : {};
        if (['open', 'show_file'].includes(action)) memory.start(owner, result.page?.url || result.url || params.url || '');
        else memory.record(owner, params);
        const trail = memory.observe(owner, result);
        // Saved steps for this page ride along with the first observation of it.
        let known;
        if (trail.key && trail.announced !== trail.key) { known = memory.known(owner); trail.announced = trail.key; }
        const message = action === 'screenshot' ? '浏览器截图已保存，用 image 工具查看。' : known ? '已打开。这一页有记住的操作（known），能用就直接 replay。' : 'App 浏览器操作已完成。';
        return toolResult(saved({...result, ...(known ? {known} : {}), ok: true, message}));
      } catch (error) {
        return toolResult(failure(error instanceof Error ? error.message : 'App 浏览器调用失败，请检查后重试。'));
      }
    },
  };
}

// Keep lifecycle wiring beside its resources, with one new tool registration
// in index.mjs. agent_end is a turn boundary, so never stop a preview there.
export function registerAppBrowserLifecycle(api, options = {}) {
  const servers = new AppBrowserServers(options);
  api.on?.('session_end', (event, ctx) => { servers.memory.flush(sessionOwner(ctx) || sessionOwner(event)); return servers.cleanupSession(event, ctx); });
  // Turn end is when an unsaved, successful trail is kept for next time.
  api.on?.('agent_end', (event, ctx) => { try { servers.memory.flush(sessionOwner(ctx) || sessionOwner(event)); } catch {} });
  api.on?.('gateway_stop', () => servers.dispose());
  api.registerService?.({id: 'pinkie-app-browser', start() { servers.disposed = false; liveManagers.add(servers); }, stop: () => servers.dispose()});
  return ctx => createAppBrowserTool(ctx, {servers});
}
