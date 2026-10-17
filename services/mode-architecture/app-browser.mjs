import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export const APP_BROWSER_ACTIONS = Object.freeze([
  'open', 'status', 'snapshot', 'screenshot', 'click', 'type', 'press', 'scroll',
  'wait', 'back', 'forward', 'reload', 'eval', 'show_file', 'close',
  'serve', 'stop_serve', 'serve_logs',
]);
const NATIVE_ACTIONS = new Set(APP_BROWSER_ACTIONS.slice(0, 15));
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
    const onAbort = () => finish(new Error('浏览器操作已取消。'));
    const timer = setTimeout(() => finish(new Error(`App 浏览器操作超时（${Math.ceil(timeoutMs / 1000)} 秒），请检查页面后重试。`)), timeoutMs);
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
  const workspace = parts[0] === '.openclaw' && (parts[1] === 'workspace' || parts[1]?.startsWith('workspace-'));
  if (parts[0] === '.ssh' || (parts[0] === 'library' && parts[1] === 'keychains') || (parts[0] === '.openclaw' && !workspace)) {
    throw new Error('这个位置包含密钥或碧琪配置，不能从浏览器里打开。');
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
  constructor({environment = process.env, homeDirectory = os.homedir(), serveTimeoutMs = 60_000, stopGraceMs = 1_000} = {}) {
    this.environment = environment;
    this.home = fs.realpathSync(homeDirectory);
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
    if (!owner) throw new Error('缺少当前碧琪会话，不能管理本地服务。');
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
    if (!sessionOwner(ctx)) throw new Error('缺少当前碧琪会话，不能启动本地服务。');
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
        if (await portOpen(params.port)) throw new Error('这个端口已经被其他服务占用，碧琪没有启动或接管它。');
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
    if (!records.length) throw new Error('当前会话没有启动这个服务，碧琪不会停止其他会话或用户的进程。');
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

function validateNativeAction(action, params) {
  const target = () => {
    if (!(typeof params.ref === 'string' && params.ref.trim()) && !(typeof params.selector === 'string' && params.selector.trim())) {
      throw new Error('这个操作需要快照里的 ref 或网页 selector。');
    }
  };
  if (action === 'open' && !(typeof params.url === 'string' && params.url.trim())) throw new Error('打开网页需要 url。');
  if (action === 'show_file' && !(typeof params.path === 'string' && params.path.trim())) throw new Error('预览文件需要 path。');
  if (action === 'type') { target(); if (typeof params.text !== 'string') throw new Error('输入操作需要 text。'); }
  if (action === 'click' && !(Number.isFinite(params.x) && Number.isFinite(params.y))) target();
  if (action === 'press' && !['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(params.key)) {
    throw new Error('按键只支持回车、退出、制表和方向键，请填写 Enter、Escape、Tab 或 ArrowUp/Down/Left/Right。');
  }
  if (action === 'scroll' && !Number.isFinite(params.dy) && !(typeof params.ref === 'string' && params.ref.trim())) throw new Error('滚动需要 dy 或 ref。');
  if (action === 'eval' && !(typeof params.js === 'string' && params.js.trim())) throw new Error('本地网页执行需要 js。');
  if (action === 'wait') {
    const criteria = [params.text !== undefined, params.selector !== undefined, params.ms !== undefined].filter(Boolean).length;
    if (criteria !== 1 || (params.text !== undefined && !(typeof params.text === 'string' && params.text.trim()))
      || (params.selector !== undefined && !(typeof params.selector === 'string' && params.selector.trim()))
      || (params.ms !== undefined && (!Number.isInteger(params.ms) || params.ms < 0 || params.ms > 15_000))) {
      throw new Error('等待请只填写 text、selector 或 ms 之一，最多 15 秒。');
    }
  }
}

let defaultServers;
export function createAppBrowserTool(ctx = {}, {servers = defaultServers ||= new AppBrowserServers()} = {}) {
  let activeContext = sessionContext(ctx);
  return {
    name: 'app_browser',
    label: 'App 浏览器',
    description: '控制先生或老板看得到的 App 侧栏浏览器。要展示网页、打开或播放网页视频、验证自己做的网页或本地开发服务时用本工具；只需后台抓取资料用 web_fetch 或 browser，操控其他应用用 computer。先 snapshot 取得 ref 再点击或输入。serve 用 dir 启动仅绑定 127.0.0.1 的静态服务，或用 command、cwd、port 启动项目服务（命令应绑定 127.0.0.1），最多等待 60 秒后自动在侧栏打开；stop_serve/serve_logs 只能管理本会话启动的服务。eval 只允许本地页面；用户正在操作或网页 ChatGPT 协作进行时写操作会明确拒绝，请稍后重试。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: {type: 'string', enum: APP_BROWSER_ACTIONS},
        url: {type: 'string'}, focus: {type: 'boolean'}, maxChars: {type: 'integer', minimum: 1, maximum: 100_000},
        fullPage: {type: 'boolean'}, ref: {type: 'string'}, selector: {type: 'string'},
        x: {type: 'number'}, y: {type: 'number'}, text: {type: 'string'}, submit: {type: 'boolean'},
        key: {type: 'string', enum: ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']},
        dy: {type: 'number'}, ms: {type: 'integer', minimum: 0, maximum: 15_000}, js: {type: 'string'},
        path: {type: 'string'}, dir: {type: 'string'}, command: {type: 'string'}, cwd: {type: 'string'},
        port: {type: 'integer', minimum: 1, maximum: 65535}, pid: {type: 'integer', minimum: 1},
        timeout_ms: {type: 'integer', minimum: 1, maximum: 30_000},
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
      try {
        const action = String(params.action || '');
        if (action === 'serve') {
          const result = await servers.serve(activeContext, params, {signal});
          return toolResult(result);
        }
        if (action === 'stop_serve') return toolResult(await servers.stop(activeContext, params));
        if (action === 'serve_logs') return toolResult(servers.logs(activeContext, params));
        if (!NATIVE_ACTIONS.has(action)) throw new Error('不支持这个 App 浏览器操作。');
        validateNativeAction(action, params);
        const reply = await servers.request(action, params, {signal});
        if (!reply.ok) return toolResult(failure(String(reply.reason || 'App 浏览器没有完成这个操作。')));
        const result = reply.result && typeof reply.result === 'object' ? reply.result : {};
        const message = action === 'screenshot' ? '浏览器截图已保存，用 image 工具查看。' : 'App 浏览器操作已完成。';
        return toolResult({...result, ok: true, message});
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
  api.on?.('session_end', (event, ctx) => servers.cleanupSession(event, ctx));
  api.on?.('gateway_stop', () => servers.dispose());
  api.registerService?.({id: 'pinkie-app-browser', start() { servers.disposed = false; liveManagers.add(servers); }, stop: () => servers.dispose()});
  return ctx => createAppBrowserTool(ctx, {servers});
}
