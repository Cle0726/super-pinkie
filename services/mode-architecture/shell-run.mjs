import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn as nodeSpawn} from 'node:child_process';

export const SHELL_TIMEOUT_MS = 120_000;
export const OUTPUT_LIMIT = 16 * 1024;
const HEAD_BYTES = 4 * 1024;
const TAIL_BYTES = 12 * 1024;
const POSIX_SAFE = new Set([':', 'cd', 'false', 'pwd', 'test', 'true', '[']);
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;
const SECURITY = ['full', 'allowlist', 'deny'];
const ASK = ['off', 'on-miss', 'always'];
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const lower = (v) => String(v ?? '').trim().toLowerCase();
const refuse = (message) => Object.assign(new Error(message), {refused: true});

export function parseBang(text) {
  const s = String(text ?? '');
  if (s.startsWith('!!')) return {kind: 'message', text: s.slice(1)};
  if (s[0] === '!' && s.length > 1 && !/\s/.test(s[1])) return {kind: 'command', command: s.slice(1).trim()};
  return {kind: 'message', text: s};
}

export function readApprovals(file) {
  try { return obj(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return {}; }
}

// Unknown values rank between the two strictest known levels, so decideTier falls through to "ask".
const rank = (order, v) => (order.includes(v) ? order.indexOf(v) : order.length - 1.5);
const stricter = (order, a, b) => (!b ? a : !a ? b : rank(order, b) > rank(order, a) ? b : a);

export function mergeApprovals(file, agentId = '', cfgExec = {}) {
  const f = obj(file), agents = obj(f.agents), own = obj(agents[agentId]), any = obj(agents['*']), defaults = obj(f.defaults);
  const pick = (k) => lower(own[k]) || lower(any[k]) || lower(defaults[k]);
  const cfg = obj(cfgExec);
  return {
    security: stricter(SECURITY, pick('security') || 'full', lower(cfg.security)),
    ask: stricter(ASK, pick('ask') || 'off', lower(cfg.ask)),
    allowlist: [own.allowlist, any.allowlist].flatMap((v) => (Array.isArray(v) ? v : [])),
  };
}

export function decideTier({enabled, security, ask, inAllowlist = false, confirmed = false} = {}) {
  if (enabled !== true) return 'off';
  if (security === 'deny') return 'deny';
  if (security === 'full' && ask === 'off') return 'run';
  if (security === 'allowlist' && ask === 'on-miss' && inAllowlist) return 'run';
  return confirmed === true ? 'run' : 'ask';
}

export function splitSegments(command) {
  const s = String(command ?? ''), segs = [];
  let cur = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (q) {
      if (q === '"' && (c === '`' || (c === '$' && n === '('))) return null;
      cur += c;
      if (c === q) q = '';
      else if (c === '\\' && q === '"' && n !== undefined) { cur += n; i++; }
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\' && n !== undefined) { cur += c + n; i++; continue; }
    if (c === '`' || (c === '$' && n === '(') || ((c === '<' || c === '>') && n === '(')) return null;
    if (c === '&' && (cur.endsWith('>') || cur.endsWith('<') || n === '>')) { cur += c; continue; }
    if (c === '|' || c === ';' || c === '\n' || c === '&') {
      if (c === '&' && n !== '&') return null;
      if ((c === '|' && n === '|') || (c === '&' && n === '&')) i++;
      segs.push(cur); cur = '';
      continue;
    }
    cur += c;
  }
  if (q) return null;
  segs.push(cur);
  return segs.map((x) => x.trim()).filter(Boolean);
}

function executableOf(segment, platform) {
  const m = /^(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(segment);
  let w = m ? (m[1] ?? m[2] ?? m[3]) : '';
  if (w === '[') return w;
  if (w.startsWith('~/')) w = path.join(os.homedir(), w.slice(2));
  const bad = platform === 'win32' ? /[$*?[\]{}()<>=`'"&|;]/ : /[$*?[\]{}()<>=`'"\\&|;~]/;
  return !w || bad.test(w) ? '' : w;
}

function resolveExecutable(w, {cwd, env, platform}) {
  const win = platform === 'win32', p = win ? path.win32 : path.posix;
  if ((win ? /[\\/]/ : /\//).test(w)) return p.resolve(cwd || '/', w);
  const dirs = String(env?.PATH ?? env?.Path ?? '').split(win ? ';' : ':').filter(Boolean);
  const exts = win ? ['', ...String(env?.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = p.join(dir, w + ext);
      try {
        if (!fs.statSync(file).isFile()) continue;
        if (!win) fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch { /* next candidate */ }
    }
  }
  return '';
}

function globRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') { if (glob[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function entryHits(entry, w, resolved, platform) {
  const e = typeof entry === 'string' ? {pattern: entry} : obj(entry);
  const pattern = String(e.pattern ?? '').trim();
  if (!pattern || String(e.argPattern ?? '').trim()) return false;
  if (pattern === '*') return true;
  const win = platform === 'win32';
  const norm = (s) => (win ? s.replace(/\\/g, '/').toLowerCase() : s);
  const glob = norm(pattern.startsWith('~/') ? path.join(os.homedir(), pattern.slice(2)) : pattern);
  if (glob.includes('/')) return Boolean(resolved) && globRegex(glob).test(norm(resolved));
  const name = norm((win ? path.win32 : path.posix).basename(resolved || w));
  return globRegex(glob).test(name) || (win && globRegex(glob).test(name.replace(/\.[^.]+$/, '')));
}

export function matchAllowlist(command, entries, {platform = process.platform, cwd = '', env = process.env} = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const segs = splitSegments(command);
  if (!segs?.length) return false;
  return segs.every((seg) => {
    const w = executableOf(seg, platform);
    if (!w) return false;
    if (platform !== 'win32' && POSIX_SAFE.has(w)) return true;
    const resolved = resolveExecutable(w, {cwd, env, platform});
    return list.some((e) => entryHits(e, w, resolved, platform));
  });
}

export function filterEnv(env = process.env) {
  return Object.fromEntries(Object.entries(obj(env)).filter(([k]) => !SECRET_NAME.test(k)));
}

export function stripAnsi(text) {
  return String(text ?? '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g, '');
}

const decode = (b) => b.toString('utf8').replace(/^\uFFFD+|\uFFFD+$/g, '');

export function outputCollector() {
  let head = Buffer.alloc(0), total = 0, tailLen = 0;
  const tail = [];
  return {
    push(chunk) {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      if (head.length < OUTPUT_LIMIT) {
        const take = Math.min(OUTPUT_LIMIT - head.length, buf.length);
        head = Buffer.concat([head, buf.subarray(0, take)]);
        buf = buf.subarray(take);
      }
      if (!buf.length) return;
      tail.push(buf); tailLen += buf.length;
      while (tail.length > 1 && tailLen - tail[0].length >= TAIL_BYTES) tailLen -= tail.shift().length;
    },
    text() {
      if (total <= OUTPUT_LIMIT) return stripAnsi(decode(head));
      const rest = Buffer.concat([head.subarray(HEAD_BYTES), ...tail]);
      const omitted = Math.max(1, Math.round((total - HEAD_BYTES - TAIL_BYTES) / 1024));
      return `${stripAnsi(decode(head.subarray(0, HEAD_BYTES)))}\n…（省略 ${omitted} KB）…\n${stripAnsi(decode(rest.subarray(rest.length - TAIL_BYTES)))}`;
    },
  };
}

export function macArgv(command) {
  return ['/bin/zsh', ['-l', '-c', command]];
}

export function windowsArgv(command) {
  const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\n${command}`;
  return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]];
}

function shellArgv(command, platform) {
  if (platform === 'win32') return windowsArgv(command);
  if (platform === 'darwin' || fs.existsSync('/bin/zsh')) return macArgv(command);
  return ['/bin/sh', ['-c', command]];
}

function killTree(pid, platform, {spawn, kill}) {
  if (!pid) return;
  if (platform === 'win32') {
    try { spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {windowsHide: true, stdio: 'ignore'}).on?.('error', () => {}); } catch { /* already gone */ }
    return;
  }
  const send = (sig) => { try { kill(-pid, sig); } catch { /* group already gone */ } };
  send('SIGTERM');
  setTimeout(() => send('SIGKILL'), 2000).unref?.();
}

function fenced(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}\n${text}\n${f}`;
}

function sessionRefusal(key, {lock, roleCardFor, activityFor}) {
  try { lock?.assertSessionAllowed?.(key); } catch (error) { return error?.message || '这个会话现在不能跑命令'; }
  if (/:subagent:/.test(key)) return '分身会话只读';
  const card = roleCardFor?.(key) || null;
  if (key.startsWith('agent:roles:') && !card) return '只读角色不跑命令';
  if (Array.isArray(card?.tools) && !card.tools.includes('write')) return '只读角色不跑命令';
  if (activityFor?.(key)?.parentRunning) return '正在回答，先停下再跑命令';
  return '';
}

export function createShellRun(deps = {}) {
  const platform = deps.platform || process.platform;
  const spawnFn = deps.spawn || nodeSpawn;
  const kill = deps.kill || process.kill.bind(process);
  const timeoutMs = deps.timeoutMs || SHELL_TIMEOUT_MS;
  const agentOf = deps.agentOf || ((key) => /^agent:([^:]+):/.exec(key)?.[1] || '');
  const log = deps.log || (() => {});
  const configFile = () => path.join(typeof deps.stateRoot === 'function' ? deps.stateRoot() : deps.stateRoot, 'shell.json');
  const running = new Map();

  const enabled = () => {
    try { return JSON.parse(fs.readFileSync(configFile(), 'utf8'))?.enabled === true; } catch { return false; }
  };
  function setEnabled(value) {
    const file = configFile(), tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(tmp, `${JSON.stringify({enabled: value === true})}\n`, {mode: 0o600});
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
    return {enabled: enabled()};
  }
  const config = () => {
    const live = obj(deps.config?.());
    return Object.keys(live).length || !deps.configFile ? live : readApprovals(deps.configFile());
  };
  const policy = (key) => mergeApprovals(
    readApprovals(path.join(deps.openclawStateDir(), 'exec-approvals.json')),
    agentOf(key),
    obj(config().tools).exec,
  );
  const inject = (key, message) => {
    const agentId = agentOf(key);
    return deps.rpc('chat.inject', {sessionKey: key, ...(agentId ? {agentId} : {}), message, label: '命令'});
  };

  function start(job, key, command, cwd, env) {
    const started = Date.now(), out = outputCollector();
    const [file, args] = shellArgv(command, platform);
    let reason = '', done = false, child = null, timer = null, fallback = null;
    const finish = (code, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(fallback);
      running.delete(key);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const status = reason === 'timeout' ? `超过 ${Math.round(timeoutMs / 1000)} 秒，已停止`
        : reason === 'cancel' ? `已停止 · ${secs} 秒`
        : error ? `没能启动：${String(error.message || error).slice(0, 200)}`
        : `退出码 ${code ?? '?'} · ${secs} 秒`;
      const body = out.text().replace(/\n$/, '');
      inject(key, `${fenced(body ? `$ ${command}\n${body}` : `$ ${command}`)}\n${status}`).catch(log);
    };
    const stop = (why) => {
      if (done || reason) return;
      reason = why;
      killTree(child?.pid, platform, {spawn: spawnFn, kill});
      fallback = setTimeout(() => finish(null), 5000);
      fallback.unref?.();
    };
    try {
      child = spawnFn(file, args, {cwd, env, detached: platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) { finish(null, error); return; }
    child.stdout?.on('data', (d) => out.push(d));
    child.stderr?.on('data', (d) => out.push(d));
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    job.stop = stop;
    if (job.pending) stop(job.pending);
  }

  async function run(params = {}) {
    const key = String(params.sessionKey || '');
    const command = String(params.command ?? '').trim();
    if (!enabled()) throw refuse('聊天里用 ! 跑命令还没打开');
    if (!key || !command) throw refuse('缺少会话或命令');
    const why = sessionRefusal(key, deps);
    if (why) throw refuse(why);
    if (running.has(key)) throw refuse('这个会话已有命令在跑');
    const cwd = deps.boundRoot(key);
    if (!cwd) throw refuse('先给这个会话绑一个文件夹');
    const env = filterEnv(deps.env || process.env);
    const p = policy(key);
    const inAllowlist = p.security === 'allowlist' && matchAllowlist(command, p.allowlist, {platform, cwd, env});
    const tier = decideTier({enabled: true, ...p, inAllowlist, confirmed: params.confirmed === true});
    if (tier === 'deny') throw refuse('这个代理设成了不跑命令');
    if (tier === 'ask') return {status: 'confirm', command, cwd};
    const job = {stop: null, pending: ''};
    running.set(key, job);
    try { await inject(key, fenced(`$ ${command}`)); } catch (error) { running.delete(key); throw error; }
    start(job, key, command, cwd, env);
    return {status: 'started', command, cwd};
  }

  function cancel(params = {}) {
    const job = running.get(String(params.sessionKey || ''));
    if (!job) return {stopped: false};
    if (job.stop) job.stop('cancel'); else job.pending = 'cancel';
    return {stopped: true};
  }

  return {config: () => ({enabled: enabled()}), setConfig: (p = {}) => setEnabled(p.enabled === true), run, cancel, isRunning: (key) => running.has(key)};
}

export function registerShellRun(api, deps) {
  const shell = createShellRun(deps);
  const method = (name, scope, fn) => api.registerGatewayMethod(name, async ({params, respond}) => {
    try { respond(true, await fn(params || {})); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: String(error?.message || '命令没跑成').slice(0, 400)}); }
  }, {scope});
  method('pinkie.shell.config.get', 'operator.read', () => shell.config());
  method('pinkie.shell.config.set', 'operator.admin', (p) => shell.setConfig(p));
  method('pinkie.shell.run', 'operator.admin', (p) => shell.run(p));
  method('pinkie.shell.cancel', 'operator.admin', (p) => shell.cancel(p));
  return shell;
}
