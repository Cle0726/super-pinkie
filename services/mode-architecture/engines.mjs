// Metre 外部引擎服务：碧琪管理的 T3 Code 后台程序（MIT，github.com/pingdotgg/t3code）。
// 计划：briefs/metre-engines-1122/PLAN.md 第 3.1、3.2 节。
//
// 为什么自己下载解压：T3 自带的启动器在 Windows 上用 tar.exe 解压，路径里有中文就失败（2026-11-22 实测）。
// 所以碧琪按固定版本下载官方发布包，对照同一发布的 SHA256SUMS，再用 PowerShell 的 Expand-Archive / tar 解压，
// 并且整个目录放在纯英文路径下。只在用户打开「外部引擎」时才装、才启动；只监听 127.0.0.1。
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {registerEngineBridge} from './engines-bridge.mjs';
import {registerEngineRegistry} from './engines-registry.mjs';
import {EngineTasks, registerEngineTasks} from './engines-task.mjs';
import {Players, registerPlayers} from './engines-players.mjs';
import {registerEngineDispatch} from './engines-dispatch.mjs';

export const T3_VERSION = '0.1.11';
export const RELEASE_BASE = 'https://github.com/pingdotgg/t3code/releases/download';
const READY = /T3 Code server is ready/;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60_000;

export const isAscii = value => /^[\x20-\x7e]*$/.test(String(value));

export function assetName(version = T3_VERSION, platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!['win32-x64', 'win32-arm64', 'darwin-arm64', 'linux-x64', 'linux-arm64'].includes(key)) return '';
  return `t3-${version}-${key}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}

// 第一个纯英文的候选目录。用户名是中文时，家目录下的路径不行，退到系统的英文目录。
export function engineRoot({stateDir = path.join(os.homedir(), '.openclaw'), base = '', env = process.env, platform = process.platform} = {}) {
  const candidates = [base ? path.join(base, 'engines') : path.join(stateDir, 'pinkie', 'engines')];
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'SuperPinkie', 'engines'));
    candidates.push(path.join(env.ProgramData || 'C:\\ProgramData', 'SuperPinkie', 'engines'));
  } else {
    candidates.push(path.join('/tmp', 'superpinkie-engines'));
  }
  return candidates.find(isAscii) || candidates[candidates.length - 1];
}

export function parseSums(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === name) return match[1].toLowerCase();
  }
  return '';
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// 命令行输出里取第一段 JSON（前面可能有提示行）。
export function parseJsonOutput(text) {
  const raw = String(text || '');
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  const close = raw[start] === '{' ? '}' : ']';
  for (let end = raw.lastIndexOf(close); end > start; end = raw.lastIndexOf(close, end - 1)) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* 往前找更短的一段 */ }
  }
  return null;
}

// t3 把错误打成「[时间] ERROR (#2): XxxError: 说明」，后面跟堆栈；取那句说明，不取堆栈。
export function errorLine(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const tagged = lines.map(line => line.match(/\bERROR \(#\d+\):\s*(.+)$/)).find(Boolean);
  if (tagged) return tagged[1];
  return lines.find(line => !/^at\s/.test(line)) || '';
}

// 引擎和登录状态。缓存文件里有账号邮箱：只留「已登录」和套餐名，邮箱一律不出这个函数。
// 引擎服务缓存的每家状态原样读出（含邮箱，只给 summarizeProviders / readProviders 用，不外传）。
export function readProviderFiles(home) {
  const dir = path.join(home, 'caches');
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.json')); } catch { return []; }
  const rows = [];
  for (const name of names) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    if (data && typeof data === 'object') rows.push({instanceId: name.replace(/\.json$/, ''), ...data});
  }
  return rows;
}

export function readProviders(home) {
  const rows = [];
  for (const data of readProviderFiles(home)) {
    const name = data.instanceId;
    const label = String(data.auth?.label || '');
    rows.push({
      id: String(data.instanceId || name.replace(/\.json$/, '')),
      driver: String(data.driver || ''),
      name: String(data.displayName || data.instanceId || name),
      enabled: data.enabled === true,
      installed: data.installed === true,
      version: data.version || null,
      status: String(data.status || 'unknown'),
      signedIn: data.auth?.status === 'authenticated',
      plan: label.includes('@') ? '' : label,
      message: String(data.message || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '…'),
      models: (Array.isArray(data.models) ? data.models : []).map(m => ({slug: String(m.slug || ''), name: String(m.name || m.slug || ''), isDefault: m.isDefault === true})).filter(m => m.slug),
    });
  }
  return rows.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

export function runProcess(file, args, {env = process.env, input = null, timeout = 60_000, cwd} = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', done = false;
    const child = spawn(file, args, {env, cwd, windowsHide: true, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe']});
    const finish = code => { if (!done) { done = true; clearTimeout(timer); resolve({code, stdout, stderr}); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(124); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { stderr += String(error?.message || error); finish(127); });
    child.on('close', code => finish(code ?? 1));
    if (input != null) child.stdin.end(String(input));
  });
}

export async function localProxy(ports = [7897, 7890]) {
  for (const port of ports) {
    const open = await new Promise(resolve => {
      const socket = net.connect({host: '127.0.0.1', port, timeout: 400}, () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
    if (open) return 'http://127.0.0.1:' + port;
  }
  return '';
}

async function freePort(preferred = 3790) {
  for (let port = preferred; port < preferred + 40; port += 1) {
    const free = await new Promise(resolve => {
      const server = net.createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('找不到空闲端口');
}

export class EngineService {
  constructor({root = engineRoot(), version = T3_VERSION, platform = process.platform, arch = process.arch,
    exec = runProcess, spawnImpl = spawn, proxy = localProxy, logger = null, now = () => Date.now()} = {}) {
    Object.assign(this, {root, version, platform, arch, exec, spawnImpl, proxy, logger, now});
    this.child = null;
    this.port = 0;
    this.error = '';
    this.restarts = [];
    this.wanted = false;
  }

  get dir() { return path.join(this.root, 'versions', this.version); }
  get exe() { return path.join(this.dir, this.platform === 'win32' ? 't3.exe' : 't3'); }
  get home() { return path.join(this.root, 'home'); }
  installed() { return fs.existsSync(this.exe); }
  log(level, text) { try { this.logger?.[level]?.(`engines ${text}`); } catch {} }

  async env() {
    const url = await this.proxy();
    const proxyVars = url ? {HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url} : {};
    return {...process.env, ...proxyVars, NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1', T3CODE_HOME: this.home};
  }

  async install() {
    if (this.installed()) return {ok: true, already: true};
    const name = assetName(this.version, this.platform, this.arch);
    if (!name) throw new Error(`外部引擎不支持这台电脑（${this.platform}-${this.arch}）`);
    const staging = path.join(this.root, 'downloads', `${this.version}-${this.now()}`);
    fs.mkdirSync(staging, {recursive: true});
    try {
      const env = await this.env();
      const proxyArgs = env.HTTPS_PROXY ? ['-x', env.HTTPS_PROXY] : [];
      for (const file of [name, 'SHA256SUMS']) {
        const got = await this.exec('curl', ['-fsSL', '--retry', '3', ...proxyArgs, '-o', path.join(staging, file), `${RELEASE_BASE}/v${this.version}/${file}`], {timeout: 30 * 60_000});
        if (got.code !== 0) throw new Error(`下载 ${file} 失败：${(got.stderr || '').trim().slice(0, 200) || '网络不通'}`);
      }
      const expected = parseSums(fs.readFileSync(path.join(staging, 'SHA256SUMS'), 'utf8'), name);
      if (!expected) throw new Error('发布包的校验清单里没有这个文件');
      if (sha256File(path.join(staging, name)) !== expected) throw new Error('下载的文件校验不对，已丢弃');
      const out = path.join(staging, 'x');
      fs.mkdirSync(out, {recursive: true});
      const extracted = this.platform === 'win32'
        ? await this.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${path.join(staging, name).replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`], {timeout: 10 * 60_000})
        : await this.exec('tar', ['-xzf', path.join(staging, name), '-C', out], {timeout: 10 * 60_000});
      if (extracted.code !== 0) throw new Error('解压失败：' + (extracted.stderr || '').trim().slice(0, 200));
      const binary = this.platform === 'win32' ? 't3.exe' : 't3';
      const found = [out, ...fs.readdirSync(out).map(entry => path.join(out, entry))].find(dir => fs.existsSync(path.join(dir, binary)));
      if (!found) throw new Error('发布包里没有找到 ' + binary);
      fs.mkdirSync(path.dirname(this.dir), {recursive: true});
      fs.rmSync(this.dir, {recursive: true, force: true});
      fs.renameSync(found, this.dir);
      this.log('info', `installed t3 ${this.version} at ${this.dir}`);
      return {ok: true};
    } finally {
      fs.rmSync(staging, {recursive: true, force: true});
    }
  }

  async start() {
    this.wanted = true;
    if (this.child) return this.status();
    if (!this.installed()) await this.install();
    fs.mkdirSync(this.home, {recursive: true});
    this.port = await freePort();
    const child = this.spawnImpl(this.exe, ['serve', '--host', '127.0.0.1', '--port', String(this.port), '--no-browser'],
      {env: await this.env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    this.child = child;
    this.error = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('外部引擎 60 秒内没有启动好')), 60_000);
      const onData = chunk => { if (READY.test(String(chunk))) { clearTimeout(timer); resolve(); } };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`外部引擎启动后退出（${code}）`)); });
    }).catch(error => { this.error = error.message; this.stopChild(); throw error; });
    child.on('exit', code => this.onExit(child, code));
    this.log('info', `t3 serving on 127.0.0.1:${this.port}`);
    return this.status();
  }

  onExit(child, code) {
    if (this.child !== child) return;
    this.child = null;
    if (!this.wanted) return;
    const now = this.now();
    this.restarts = this.restarts.filter(at => now - at < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.error = `外部引擎 10 分钟内退出了 ${MAX_RESTARTS} 次，已停止重启（最后一次退出码 ${code}）`;
      this.log('warn', this.error);
      return;
    }
    this.restarts.push(now);
    this.log('warn', `t3 exited (${code}), restarting`);
    this.start().catch(error => this.log('warn', `restart failed: ${error.message}`));
  }

  stopChild() {
    const child = this.child;
    this.child = null;
    if (!child?.pid) return;
    if (this.platform === 'win32') void this.exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], {timeout: 15_000});
    else { try { child.kill('SIGTERM'); } catch {} }
  }

  stop() { this.wanted = false; this.stopChild(); return this.status(); }

  status() {
    return {installed: this.installed(), running: Boolean(this.child), port: this.child ? this.port : 0, version: this.version,
      error: this.error, url: this.child ? `http://127.0.0.1:${this.port}` : ''};
  }

  providers() { return readProviders(this.home); }

  async cli(args, {input = null, timeout = 120_000} = {}) {
    if (!this.installed()) throw new Error('外部引擎还没有安装');
    const result = await this.exec(this.exe, args, {env: await this.env(), input, timeout});
    const data = parseJsonOutput(result.stdout);
    if (data) return data;
    if (result.code !== 0) throw new Error(errorLine(`${result.stdout}\n${result.stderr}`) || `t3 退出码 ${result.code}`);
    return {text: String(result.stdout || '').trim()};
  }

  async addProject(folder) {
    try { return await this.cli(['project', 'add', folder]); } catch (error) {
      if (/AlreadyExists|already exists/i.test(error.message)) return {ok: true, already: true};
      throw error;
    }
  }

  threadStartArgs({folder, provider = '', model = '', options = {}, title = '', wait = false} = {}) {
    const args = ['thread', 'start', folder, '-', '--json'];
    if (title) args.push('--title', String(title).slice(0, 120));
    if (provider && model) {
      args.push('--provider', provider, '--model', model);
      for (const [key, value] of Object.entries(options || {})) args.push('--option', `${key}=${value}`);
    }
    if (wait) args.push('--wait');
    return args;
  }

  async startThread({folder, message, ...rest} = {}) {
    if (!folder || !message) throw new Error('需要文件夹和要说的话');
    await this.addProject(folder);
    return this.cli(this.threadStartArgs({folder, ...rest}), {input: message, timeout: rest.wait ? 60 * 60_000 : 120_000});
  }

  send(threadId, message, {wait = false} = {}) {
    return this.cli(['thread', 'send', threadId, '-', '--json', ...(wait ? ['--wait'] : [])], {input: message, timeout: wait ? 60 * 60_000 : 120_000});
  }

  show(threadId) { return this.cli(['thread', 'show', threadId, '--json']); }
}

// 网关方法（界面用）：status / enable / threads。插件在同一个网关里会被加载好几份，引擎服务只能有一个。
const SHARED = Symbol.for('pinkie.engines.v1');
// lineage：Metre 的血缘（metre-board.mjs 传进来），有了它才提供 pinkie_engine_task（Metre 派活给外部引擎，engines-task.mjs）。
// modelHealth：碧琪的模型健康（metre-board.mjs 传进来），「碧琪模型」那条路把能用的模型排在前面。
export function registerEngines(api, {base = '', register, lineage = null, modelHealth = null} = {}) {
  const shared = globalThis[SHARED] ||= {service: new EngineService({root: engineRoot({base}), logger: api.logger})};
  const service = shared.service;
  const prefsFile = path.join(service.root, 'prefs.json');
  const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')) || {}; } catch { return {}; } };
  const savePrefs = patch => {
    const next = {...prefs(), ...patch};
    fs.mkdirSync(service.root, {recursive: true});
    fs.writeFileSync(prefsFile + '.tmp', JSON.stringify(next));
    fs.renameSync(prefsFile + '.tmp', prefsFile);
    return next;
  };
  const status = () => ({...service.status(), enabled: prefs().enabled === true, providers: service.providers()});
  register(api, 'pinkie.engines.status', () => status());
  register(api, 'pinkie.engines.enable', async ({on} = {}) => {
    savePrefs({enabled: on === true});
    if (on === true) await service.start(); else service.stop();
    return status();
  });
  register(api, 'pinkie.engines.threads', async ({folder} = {}) => {
    if (!service.status().running) throw new Error('外部引擎没有在运行');
    return service.cli(['thread', 'list', '--project', String(folder || '.'), '--json']);
  });
  // 嵌进 Metre 的引擎界面用一次性配对链接（5 分钟有效）换浏览器会话；权限只给用得到的，不给终端和远程访问管理。
  register(api, 'pinkie.engines.open', async () => {
    const {running, url} = service.status();
    if (!running) throw new Error('外部引擎没有在运行');
    const scopes = ['orchestration:read', 'orchestration:operate', 'settings:write', 'providers:manage', 'filesystem:read', 'source-control:write', 'preview:operate', 'diagnostics:read'];
    const data = await service.cli(['auth', 'pairing', 'create', '--ttl', '5m', '--label', 'metre', '--base-url', url, '--json', ...scopes.flatMap(scope => ['--scope', scope])]);
    const pairUrl = String(data?.pairUrl || '');
    if (!pairUrl.startsWith(url + '/pair#token=')) throw new Error('没有拿到引擎界面的登录链接');
    return {url: pairUrl, expiresAt: data.expiresAt || null};
  });
  // 引擎台（Metre 自己画的对话界面）的方法：engines-bridge.mjs。
  const ensureRunning = async () => {
    if (service.status().running) return;
    if (prefs().enabled !== true) throw new Error('外部引擎还没打开：在引擎菜单里打开它（第一次会下载约 170MB）');
    await service.start();
  };
  // pinkieConfig：「碧琪模型」那条路每次现读碧琪的配置（模型目录和上游钥匙），钥匙不留在引擎桥上。
  shared.bridge ||= registerEngineBridge(api, {service, register, stateRoot: base, isEnabled: () => prefs().enabled === true, ensureRunning,
    pinkieConfig: () => api.runtime?.config?.current?.() || api.config || {}, health: modelHealth});
  // 「更多引擎」：从公开的 ACP 注册表里加别家的引擎（engines-registry.mjs），和桥注册在同一处。
  shared.registry ||= registerEngineRegistry(api, {bridge: shared.bridge, register, ensureRunning, status: () => ({...service.status(), enabled: prefs().enabled === true})});
  shared.players ||= new Players(path.join(service.root, 'players.json'));
  registerPlayers(api, {players: shared.players, register, roles: () => {
    const registry = lineage?.metreRolesEnabled?.() === false ? null : lineage?.rolesRegistry?.();
    return (registry?.validIds || []).map(id => ({id, name: registry.byId[id]?.name || id}));
  }});
  if (lineage) {
    shared.tasks ||= new EngineTasks({bridge: shared.bridge, lineage, players: shared.players, isEnabled: () => prefs().enabled === true, ensureRunning, logger: api.logger});
    shared.tasks.lineage = lineage; // 血缘每个状态目录只有一份；以最新注册的为准
    registerEngineTasks(api, {tasks: shared.tasks, register});
    // 用户在 Metre 里选的外部引擎当主脑：它也能派活，走同一条路（engines-dispatch.mjs）。
    shared.dispatch ||= registerEngineDispatch(api, {bridge: shared.bridge, lineage, tasks: shared.tasks, service, isEnabled: () => prefs().enabled === true});
  }
  if (!shared.booted) {
    shared.booted = true;
    if (prefs().enabled === true) service.start().catch(error => service.log('warn', `autostart failed: ${error.message}`));
    process.once('exit', () => { try { service.stop(); } catch {} });
  }
  return service;
}
