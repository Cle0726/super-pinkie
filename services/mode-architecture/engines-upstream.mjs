// 引擎台「用谁的模型」：Claude Code 除了用户自己的订阅，还能走碧琪上游配好的模型（任务书 build/quick-run/任务-引擎-CC用碧琪上游-1125.md）。
//
// 做法：
// - 引擎服务里固定一个实例 claudeAgent-pinkie，有自己的 CLAUDE_CONFIG_DIR。引擎服务开 Claude 子进程前读这个文件夹 settings.json 的 env：
//   ANTHROPIC_BASE_URL 指向本机回环上的转发口，ANTHROPIC_AUTH_TOKEN 是转发口的会话令牌（不是上游钥匙）。
//   ANTHROPIC_BASE_URL 不是 Anthropic 自己的地址时，引擎服务不再要求先登录订阅（11-25 在 0.1.11 里核对过）。
// - 转发口只听 127.0.0.1，认会话令牌，把请求原样转给碧琪上游的 Anthropic /v1/messages，换上真钥匙。
//   真钥匙每次请求时从碧琪配置里读，只在内存里，不写文件、不写日志、不回给界面。
// - 用户的规矩：只用最高档的模型、最高的思考档。模型菜单只列碧琪目录里 top 档的 Claude 系模型，所有模型槽都填同一个，思考开到最高。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {catalog, tierOf} from './metre-models.mjs';

export const PINKIE_INSTANCE = 'claudeAgent-pinkie';
export const PINKIE_FOLDER = '.claude-metre-pinkie';
export const PINKIE_LABEL = '碧琪模型';
export const TOP_EFFORT = 'xhigh';
// Claude Code 子进程认的变量里，转发口只往 settings.json 的 env 写这几个；钥匙那一格只放会话令牌。
export const ENV_NAMES = Object.freeze(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']);
const MAX_BODY = 32 * 1024 * 1024;
const PASS_HEADERS = ['content-type', 'anthropic-version', 'anthropic-beta', 'accept'];
// Codex 那条路只转这几个；别的（cookie、ChatGPT 账号头之类）一律不转。
const OPENAI_PASS_HEADERS = ['content-type', 'accept', 'openai-beta'];

// 碧琪目录里能给 Claude Code 用的模型：top 档、Claude 系（上游原生就有 Anthropic /v1/messages）、提供方有本机或 https 地址和钥匙。
// slug 是「提供方/模型」，转发口靠第一段认出是哪个提供方。
// health：碧琪自己记的模型健康（model-health.mjs 的 ModelHealth），最近调用失败的排到最后
// （11-25 隔离碧琪：同一个网关里 claude-* 那几条走的登录过期了，aws-quick/* 能用）。
// 低思考档的变体（-low / -medium / -minimal …）不列：用户只用最高的思考档。
// family：claude = Claude Code 那条路（上游要有 Anthropic /v1/messages，只列 Claude 系）；
// codex = Codex 那条路（上游要有 OpenAI /v1/responses：提供方标了 openai-responses，或者是本机网关——11-25 实测本机网关
// /v1/messages、/v1/responses、/v1/chat/completions 三个都通）。两条路都只列 top 档、不列低思考档。
export function pinkieModels(config = {}, {health = null, family = 'claude'} = {}) {
  const providers = config?.models?.providers || {};
  return catalog(config).filter(item => {
    const entry = providers[item.provider] || {};
    const model = item.id.slice(item.provider.length + 1);
    const base = upstreamBase(entry.baseUrl);
    // chat = OpenCode 那条路（上游要有 OpenAI /v1/chat/completions：提供方标了 openai-completions，或者是本机网关）。
    const fits = family === 'codex' ? (entry.api === 'openai-responses' || isLoopback(base))
      : family === 'chat' ? (entry.api === 'openai-completions' || isLoopback(base))
      : /claude/i.test(model);
    return fits && !LOW_EFFORT.test(model) && tierOf(item.id) === 'top' && base && String(entry.apiKey || '').trim();
  }).map(item => ({slug: item.id, name: item.name, failing: failing(health, item.id)}))
    // 能用的在前；同一档里版本号大的在前（claude-opus-5-5 排在 claude-opus-4-7 前面），不带思考后缀的在前。默认用第一个。
    .sort((a, b) => Number(a.failing) - Number(b.failing) || versionOf(b.slug) - versionOf(a.slug)
      || Number(EFFORT_SUFFIX.test(a.slug)) - Number(EFFORT_SUFFIX.test(b.slug)) || a.slug.localeCompare(b.slug))
    .map(({failing: bad, ...model}) => (bad ? {...model, failing: true} : model));
}

const LOW_EFFORT = /-(?:extra-low|non-reasoning|disabled|minimal|none|low|medium)$/i;
const EFFORT_SUFFIX = /-(?:thinking|high|xhigh|max|adaptive|reasoning)$/i;
const failing = (health, id) => {
  const record = health?.models?.get?.(id);
  return Boolean(record?.failAt && (!record.okAt || record.failAt > record.okAt));
};
// 家族名后面的版本：claude-opus-5-5 → 505，claude-opus-4-20250514 → 400（后面那串是日期，不算小版本）。
export const versionOf = slug => {
  const name = String(slug).split('/').at(-1) || '';
  const match = /(?:opus|sonnet|haiku)-(\d{1,2})(?:[-.](\d{1,2}))?(?!\d)/i.exec(name) || /claude-(\d{1,2})(?:[-.](\d{1,2}))?(?!\d)/i.exec(name);
  return match ? Number(match[1]) * 100 + Number(match[2] || 0) : 0;
};

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const isLoopback = base => { try { return LOOPBACK.includes(new URL(base).hostname); } catch { return false; } };

// 提供方的 baseUrl（多半以 /v1 结尾）→ 转发去的根地址。只认 http（必须是本机回环）和 https。
export function upstreamBase(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return ''; }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return '';
  // origin + pathname：天然不带地址里的用户名、密码、查询串和井号后面那段。
  return (url.origin + url.pathname).replace(/\/+$/, '').replace(/\/v1$/, '');
}

// 请求里的模型名 → 哪个提供方、上游要的模型名。不在碧琪目录里的（Claude Code 自己的后台小请求常带 haiku 之类的名字）一律换成默认模型。
export function routeModel(requested, models, fallback = '') {
  const wanted = String(requested || '').trim();
  const hit = models.find(model => model.slug === wanted) || models.find(model => model.slug === fallback) || models[0];
  if (!hit) return null;
  const [provider, ...rest] = hit.slug.split('/');
  return {slug: hit.slug, provider, model: rest.join('/')};
}

const sameToken = (given, token) => {
  const a = Buffer.from(String(given || '')), b = Buffer.from(String(token || ''));
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
};
const tokenOf = req => String(req.headers['x-api-key'] || '').trim() || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

// 回 4xx 之前先把还没读的请求体读掉（只读不攒）。Node 不读请求体就回包时，客户端带 Connection: close、req.destroy()、
// 或者在 for await (… of req) 里提前 return，关连接那一下内核都会对没读的字节回 RST：Windows 上连已经发出的回复都收不到
// （WinError 10053/10054，同 services/roundtable #204；11-26 本机回环实测，Node v24）。
// limit 以内：读完再回，连接照常可复用。
// 声明的长度超过 limit、读到超过 limit、长度写错或 ms 内没动静：先回（带 Connection: close，回复头和正文立刻发出去），
// 但 res.end 先压着，接着读掉丢弃，读完（或 ms 内没新数据）才真的 end、关连接，客户端能收到完整回复。
// 读掉的总量超过硬上限 cap、或总共超过 totalMs，才不再读、直接 end（这时没读的字节可能让客户端收到 RST）。
// #263 后续：之前超过 limit 就直接回、直接关，engines-upstream 1–32 MiB 的请求体回 401 / 404 / 413 全被 RST。
export const DRAIN_LIMIT = 1 << 20;
export const DRAIN_CAP = 16 << 20;
export const DRAIN_MS = 2000;
export const DRAIN_TOTAL_MS = 30000;
export function drainThen(req, res, reply, {limit = DRAIN_LIMIT, cap = DRAIN_CAP, ms = DRAIN_MS, totalMs = DRAIN_TOTAL_MS} = {}) {
  if (req.complete || req.readableEnded) return reply();
  const raw = req.headers['content-length'];
  const declared = raw === undefined ? 0 : Number(raw);
  const end = res.end;
  let seen = 0, early = false, done = false, held = null, idle = null, total = null;
  const stop = () => {
    if (done) return; done = true; clearTimeout(idle); clearTimeout(total);
    req.off('data', count); req.off('end', stop);
    if (!early) return reply();
    res.end = end;
    const args = held; held = null;
    if (args) end.apply(res, args);
  };
  // 先回：reply 照常 writeHead + end，end 里的正文先 write 出去，end 本身留到 stop 再调。
  const replyNow = () => {
    if (early || done) return; early = true;
    if (!res.headersSent) res.setHeader('Connection', 'close');
    res.end = (...args) => {
      if (done) return end.apply(res, args);
      const callback = typeof args.at(-1) === 'function' ? args.pop() : null;
      if (args.length && args[0] != null) res.write(...args.slice(0, 2));
      held = callback ? [callback] : [];
      return res;
    };
    reply();
  };
  const arm = () => { clearTimeout(idle); idle = setTimeout(early ? stop : () => { replyNow(); arm(); }, ms); idle.unref?.(); };
  const count = chunk => {
    seen += chunk.length;
    if (!early && seen > limit) replyNow();
    if (early && seen > cap) return stop();
    arm();
  };
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit) replyNow();
  // error / close 监听一直留着：客户端中途断开时 req 会报错，没人接就成了未捕获异常。stop 只走一次。
  req.on('data', count); req.on('end', stop); req.on('error', stop); req.on('close', stop);
  arm();
  total = setTimeout(() => { replyNow(); stop(); }, totalMs); total.unref?.();
  req.resume();
}

// 攒请求体，最多 max 字节。超了就停下（不 destroy，destroy 就是 RST），返回 null，剩下的交给 drainThen 读掉。
export function readCapped(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const stop = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); };
    const onData = chunk => { size += chunk.length; if (size <= max) { chunks.push(chunk); return; } stop(); req.pause(); resolve(null); };
    const onEnd = () => { stop(); resolve(Buffer.concat(chunks)); };
    const onError = error => { stop(); reject(error); };
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError);
  });
}

// 本机转发口。config()：每次请求现读碧琪配置（钥匙不留在这个对象上）。fetchImpl 给测试换。
export class PinkieRelay {
  constructor({config = () => ({}), logger = null, fetchImpl = globalThis.fetch, token = crypto.randomBytes(32).toString('base64url')} = {}) {
    this.config = config; this.logger = logger; this.fetchImpl = fetchImpl;
    Object.defineProperty(this, 'token', {value: token, enumerable: false});
    // defaultModel：Claude Code 那条路的默认模型；codexModel：Codex 那条路的。
    this.server = null; this.port = 0; this.defaultModel = ''; this.codexModel = ''; this.chatModel = '';
  }

  get baseUrl() { return this.port ? `http://127.0.0.1:${this.port}` : ''; }
  // 日志和快照里只出现这些。
  toJSON() { return {running: Boolean(this.server), port: this.port, defaultModel: this.defaultModel, codexModel: this.codexModel, chatModel: this.chatModel}; }

  async start() {
    if (this.server) return this;
    const server = http.createServer((req, res) => { this.handle(req, res).catch(error => this.fail(res, 502, 'api_error', this.scrub(error.message))); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    this.server = server; this.port = server.address().port;
    return this;
  }

  async stop() {
    const server = this.server; this.server = null; this.port = 0;
    if (server) await new Promise(resolve => server.close(() => resolve()));
  }

  // 错误信息里万一带了钥匙或令牌，换掉。
  scrub(text) {
    let out = String(text || '');
    const key = this.currentKeys();
    for (const secret of [this.token, ...key]) if (secret && secret.length >= 8) out = out.split(secret).join('…');
    return out.slice(0, 600);
  }

  currentKeys() {
    const providers = this.config()?.models?.providers || {};
    return Object.values(providers).map(entry => String(entry?.apiKey || '').trim()).filter(Boolean);
  }

  // openai：Codex 那条路（/v1/responses）用 OpenAI 的错误格式，Claude Code 那条路用 Anthropic 的。
  // 回复前先把没读的请求体读掉（drainThen），不然 Windows 上 Claude Code / Codex 连这条报错都收不到。
  fail(res, status, type, message, {openai = false} = {}) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    const reply = () => {
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(status, {'content-type': 'application/json'});
      res.end(JSON.stringify(openai ? {error: {type, message, code: type}} : {type: 'error', error: {type, message}}));
    };
    // 硬上限要比 MAX_BODY（32 MiB）大：超 32 MiB 的 413 也得先读掉剩下的，客户端才收得到。
    if (res.req) drainThen(res.req, res, reply, {cap: 2 * MAX_BODY}); else reply();
  }

  async handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!sameToken(tokenOf(req), this.token)) return this.fail(res, 401, 'authentication_error', '令牌不对');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const data = pinkieModels(this.config()).map(model => ({type: 'model', id: model.slug, display_name: model.name}));
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify({data, has_more: false, first_id: data[0]?.id || null, last_id: data.at(-1)?.id || null}));
    }
    // 两条路：Claude Code 走 Anthropic /v1/messages，Codex 走 OpenAI /v1/responses（上游原生就有，不做协议转换）。
    // 第三条：OpenCode 走 OpenAI /v1/chat/completions（本机网关原生有）。codex / chat 两条路都用 OpenAI 的头和错误格式。
    const codex = url.pathname === '/v1/responses';
    const chat = url.pathname === '/v1/chat/completions';
    const claude = /^\/v1\/messages(?:\/count_tokens)?$/.test(url.pathname);
    const openai = codex || chat;
    const opts = {openai};
    if (req.method !== 'POST' || !(openai || claude)) return this.fail(res, 404, 'not_found_error', '只转 /v1/messages、/v1/responses 和 /v1/chat/completions');
    // 不在 for await (… of req) 里提前 return：迭代器退出时会销毁 req，客户端只收到 RST。
    if (Number(req.headers['content-length']) > MAX_BODY) return this.fail(res, 413, 'request_too_large', '请求太大', opts);
    const raw = await readCapped(req, MAX_BODY);
    if (!raw) return this.fail(res, 413, 'request_too_large', '请求太大', opts);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return this.fail(res, 400, 'invalid_request_error', '请求不是 JSON', opts); }
    const config = this.config();
    const family = codex ? 'codex' : chat ? 'chat' : 'claude';
    const route = routeModel(body?.model, pinkieModels(config, {family}), codex ? this.codexModel : chat ? this.chatModel : this.defaultModel);
    if (!route) return this.fail(res, 503, 'api_error', `碧琪这边没有能给 ${codex ? 'Codex' : chat ? 'OpenCode' : 'Claude Code'} 用的模型`, opts);
    const entry = config?.models?.providers?.[route.provider] || {};
    const key = String(entry.apiKey || '').trim();
    const base = upstreamBase(entry.baseUrl);
    if (!key || !base) return this.fail(res, 503, 'api_error', '碧琪这个上游没配好', opts);
    const headers = openai ? {authorization: `Bearer ${key}`} : {'x-api-key': key, authorization: `Bearer ${key}`};
    for (const name of openai ? OPENAI_PASS_HEADERS : PASS_HEADERS) if (req.headers[name]) headers[name] = String(req.headers[name]);
    headers['content-type'] ||= 'application/json';
    if (!openai) headers['anthropic-version'] ||= '2023-06-01';
    const upstream = await this.fetchImpl(base + url.pathname, {method: 'POST', headers, body: JSON.stringify({...body, model: route.model})});
    const out = {'content-type': upstream.headers.get('content-type') || 'application/json'};
    for (const name of ['retry-after', 'anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset', 'request-id',
      'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-request-id']) {
      const value = upstream.headers.get(name); if (value) out[name] = value;
    }
    // 上游出错：原样转状态码（429 = 额度用完，Claude Code / Codex 和引擎服务照常按「额度用完」处理），正文去掉钥匙。
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      res.writeHead(upstream.status, out);
      const fallback = openai ? {error: {type: 'api_error', message: `上游 ${upstream.status}`}} : {type: 'error', error: {type: 'api_error', message: `上游 ${upstream.status}`}};
      return res.end(this.scrub(text) || JSON.stringify(fallback));
    }
    res.writeHead(upstream.status, out);
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  }
}

// 这个实例的 settings.json：env 指向转发口，所有模型槽填同一个 top 模型，思考开到最高。
// 已有的其它设置（用户在这个文件夹里自己加的）留着，只覆盖 env 里这几个名字和 effortLevel。
export function writePinkieSettings(dir, {baseUrl, token, model}) {
  if (!path.isAbsolute(String(dir || ''))) throw new Error('需要绝对路径');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'settings.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  const env = Object.fromEntries(Object.entries(current.env || {}).filter(([name]) => !ENV_NAMES.includes(name)));
  Object.assign(env, {ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: token, CLAUDE_CODE_EFFORT_LEVEL: TOP_EFFORT, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'});
  if (model) for (const name of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) env[name] = model;
  const next = {...current, env, effortLevel: TOP_EFFORT};
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
  return file;
}

// 会话历史：Claude Code 把每段对话记在「配置文件夹/projects」下。这个实例有自己的配置文件夹，
// 不接上的话，同一段对话切到 / 切出「碧琪模型」后下一轮就找不到之前的记录。
// 做法：把这个实例的 projects 用 junction（Windows 上不要管理员权限；别的系统是普通符号链接）接到默认账号的 projects。
// 规矩：已有的目录一律不删、不覆盖。
// - 这里还没有 projects：建 junction → linked
// - 已经是指向同一处的链接 → ok
// - 是真目录，或者是指向别处的链接 → conflict，什么都不动，交给人看
// shared 不存在就建一个空的（只新建，不碰 ~/.claude 里别的东西）。
export function linkPinkieHistory(dir, {shared = path.join(os.homedir(), '.claude', 'projects'), fsImpl = fs} = {}) {
  if (!path.isAbsolute(String(dir || '')) || !path.isAbsolute(String(shared || ''))) throw new Error('需要绝对路径');
  const link = path.join(dir, 'projects');
  const view = state => ({state, link, shared});
  let stat = null;
  try { stat = fsImpl.lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    if (!stat.isSymbolicLink()) return view('conflict');
    let real = '';
    try { real = fsImpl.realpathSync(link); } catch { return view('conflict'); } // 断掉的链接也不替人删
    const want = (() => { try { return fsImpl.realpathSync(shared); } catch { return path.resolve(shared); } })();
    return view(path.resolve(real).toLowerCase() === path.resolve(want).toLowerCase() ? 'ok' : 'conflict');
  }
  fsImpl.mkdirSync(dir, {recursive: true});
  fsImpl.mkdirSync(shared, {recursive: true});
  fsImpl.symlinkSync(path.resolve(shared), link, 'junction');
  return view('linked');
}

// 引擎服务里这个实例的配置：自己的配置文件夹 + 碧琪的模型清单。
export function pinkieInstance(dir, models) {
  return {driver: 'claudeAgent', displayName: `Claude Code · ${PINKIE_LABEL}`, enabled: true,
    config: {homePath: dir, customModels: models.map(model => ({slug: model.slug, name: model.name}))}};
}

// ---- Codex 那一家 ----
// 引擎服务给 Codex 开子进程时会删掉 OPENAI_API_KEY / OPENAI_BASE_URL（0.1.11 里核对过），所以不走环境变量，
// 走这个实例自己的启动参数（-c 覆盖，只给这一个子进程，不改用户的 ~/.codex/config.toml）：
// - model_providers.pinkie：base_url 指向转发口，wire_api="responses"（Codex 0.171 只认这一种），
//   experimental_bearer_token 放转发口的会话令牌（不是上游钥匙），requires_openai_auth=false 所以不用登录订阅。
// - 思考开最高档 xhigh。
// 会话历史：用影子文件夹（shadowHomePath）。引擎服务会把 ~/.codex 里除 auth.json / auth.lock / models_cache.json /
// log / memories / tmp 以外的东西（sessions、sqlite、config.toml …）都链进来，所以切到 / 切出「碧琪模型」历史还在；
// auth.json 这个实例自己一份，用户的 ChatGPT 登录不会被读到这条路上来。
export const CODEX_PINKIE_INSTANCE = 'codex-pinkie';
export const CODEX_PINKIE_FOLDER = '.codex-metre-pinkie';
export const CODEX_PROVIDER_ID = 'pinkie';
// 和引擎服务的 quoteCliArg 同一套引号规则：它用 tokenizeCliArgs 拆 launchArgs。
const quoteArg = value => `"${String(value).replace(/["\\$`]/g, '\\$&')}"`;
const tomlString = value => JSON.stringify(String(value));

export function codexLaunchArgs({baseUrl, token}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(String(baseUrl || ''))) throw new Error('转发口地址不对');
  if (!/^[A-Za-z0-9_-]{16,}$/.test(String(token || ''))) throw new Error('转发口令牌不对');
  const provider = `model_providers.${CODEX_PROVIDER_ID}={name=${tomlString(`碧琪模型`)},base_url=${tomlString(`${baseUrl}/v1`)},wire_api="responses",`
    + `experimental_bearer_token=${tomlString(token)},requires_openai_auth=false,supports_websockets=false}`;
  return [`model_provider=${tomlString(CODEX_PROVIDER_ID)}`, provider, `model_reasoning_effort=${tomlString(TOP_EFFORT)}`]
    .map(setting => `-c ${quoteArg(setting)}`).join(' ');
}

export function codexPinkieInstance(dir, models, {baseUrl, token}) {
  return {driver: 'codex', displayName: `Codex · ${PINKIE_LABEL}`, enabled: true,
    config: {shadowHomePath: dir, launchArgs: codexLaunchArgs({baseUrl, token}), customModels: models.map(model => ({slug: model.slug, name: model.name}))}};
}

// 每一家能不能切到「碧琪模型」（11-25 在引擎服务 0.1.11 里逐家查的，表在 build/quick-run/engines/pinkie-upstream-others-1125.md）。
// row：能的那几家对应的固定实例；why：不能的那几家给用户看的一句原因（界面上不出现引擎服务的名字）。
export const OPENCODE_PINKIE_INSTANCE = 'opencode-pinkie';   // OpenCode 那一家的固定实例（说明见下面「OpenCode 那一家」），放这里是因为下面这张表要用
export const PINKIE_UPSTREAM = Object.freeze({
  claudeAgent: {row: PINKIE_INSTANCE},
  codex: {row: CODEX_PINKIE_INSTANCE},
  opencode: {row: OPENCODE_PINKIE_INSTANCE},
  pi: {why: '还没接上：要先在这台电脑上装 Pi 核对它的模型配置'},
  antigravity: {why: '只能用 Google 账号或 Gemini 的 API 密钥，没有换上游的口子'},
  cursor: {why: '模型在 Cursor 自己的服务器上跑，只能用 Cursor 账号'},
  fx: {why: '模型在 fx 自己那边跑，只能用 fx 账号'},
  grok: {why: '只能用 Grok 自己的登录'},
  kiro: {why: '模型在 Kiro 那边跑，只能用 Kiro 账号'},
  muse: {why: '只能用 Muse Code 自己的登录'},
  acpRegistry: {why: '从注册表加的引擎要逐个核对，暂时还不能切'},
});
export const pinkieUpstreamOf = driver => PINKIE_UPSTREAM[driver] || {why: '这一家还没核对能不能换上游'};

// ---- OpenCode 那一家 ----
// 引擎服务起 OpenCode 服务器时，把实例的 environment 合进子进程，并且原样传 OPENCODE_CONFIG_CONTENT（0.1.11 里核对过）。
// OpenCode 把这段配置叠在用户自己的 opencode.json 上，所以用户的文件不动。
// - provider「pinkie」：@ai-sdk/openai-compatible，baseURL 指转发口 /v1（走 /v1/chat/completions）。
// - apiKey 直接写转发口的会话令牌（不是上游钥匙）。OpenCode 1.18 里没核到 {env:} 替换，不靠它；
//   整个 OPENCODE_CONFIG_CONTENT 标 sensitive，引擎服务把这种值另存，不和设置放一起。
// - 模型名：引擎服务在第一个「/」处拆成 providerID / modelID，所以菜单里的名字是「pinkie/<碧琪的模型名>」，
//   转发口收到的就是碧琪的模型名（gw/aws-quick/…）。思考开最高档（@ai-sdk/openai-compatible 的 reasoningEffort → reasoning_effort）。
// 固定实例 id OPENCODE_PINKIE_INSTANCE 写在上面那张「能不能切」的表前面。
export const OPENCODE_PROVIDER_ID = 'pinkie';

export function openCodeConfigContent({baseUrl, token, models}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(String(baseUrl || ''))) throw new Error('转发口地址不对');
  if (!/^[A-Za-z0-9_-]{16,}$/.test(String(token || ''))) throw new Error('转发口令牌不对');
  const entries = Object.fromEntries(models.map(model => [model.slug, {name: model.name || model.slug, options: {reasoningEffort: TOP_EFFORT}}]));
  return JSON.stringify({provider: {[OPENCODE_PROVIDER_ID]: {npm: '@ai-sdk/openai-compatible', name: PINKIE_LABEL,
    options: {baseURL: `${baseUrl}/v1`, apiKey: token}, models: entries}}});
}

export function openCodePinkieInstance(models, {baseUrl, token}) {
  return {driver: 'opencode', displayName: `OpenCode · ${PINKIE_LABEL}`, enabled: true,
    environment: [{name: 'OPENCODE_CONFIG_CONTENT', value: openCodeConfigContent({baseUrl, token, models}), sensitive: true}],
    config: {customModels: models.map(model => ({slug: `${OPENCODE_PROVIDER_ID}/${model.slug}`, name: model.name}))}};
}
