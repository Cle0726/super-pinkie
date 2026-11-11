import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const reply = value => ({content: [{type: 'text', text: JSON.stringify(value)}], details: value});
const SESSION = /^agent:[a-z0-9_-]+:.{1,500}$/i;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_APP = 512 * 1024;

export const RICH_RULES = `聊天已支持富回复，按需使用，短答照常说话。三步以上的长任务先调用 plan_update，开始/完成一项时更新同一份清单；完成状态必须有实际结果。
按钮/表单用 ui JSON 代码块，图表用 chart，流程用 mermaid，公式用 $…$，追问用 followups。要做可运行的计算器、小游戏或交互图解时，用 app 代码块输出完整的自包含 HTML（可有内联 CSS/JS）。小应用在隔离框架里运行，没有文件、账号、网络权限；不引用 CDN，不假装能直接保存文件或调用模型。应用名写在 <title> 里。页面自带碧琪的配色和控件样式，会跟着白天/夜间变：直接用原生 button、input、select、table 和 class="card"、"row"、"stack"、"muted"、"big"，主要按钮加 class="primary"；要颜色就用 var(--pk-accent)、var(--pk-pink)、var(--pk-fg)、var(--pk-mute)、var(--pk-line)、var(--pk-panel)，不写死白底黑字、阴影和字体，不设 body 背景。
用户让设定时任务时用现有 cron 工具：先查已有任务避免重复，写明时区和投递目标；不替用户新增未请求的周期任务。深度研究使用 pinkie-deep-research 技能，先读来源、核对关键结论，交付带来源的报告。`;

function sessionKey(value) {
  const key = String(value || '');
  if (!SESSION.test(key)) throw new Error('没有找到当前聊天，请打开一段对话后重试。');
  return key;
}

export function normalizePlan(params = {}) {
  if (!Array.isArray(params.items) || params.items.length < 1 || params.items.length > 20) throw new Error('计划需要 1–20 项。');
  const ids = new Set();
  let active = 0;
  const items = params.items.map((item, index) => {
    if (!object(item)) throw new Error('计划项目格式无效。');
    const text = String(item.text || '').trim();
    const id = String(item.id || index + 1);
    const status = String(item.status || 'pending');
    if (!text || text.length > 200 || id.length > 80 || ids.has(id)) throw new Error('计划文字为空、过长或项目编号重复。');
    if (!['pending', 'in_progress', 'completed'].includes(status)) throw new Error('计划状态必须是 pending、in_progress 或 completed。');
    if (status === 'in_progress') active++;
    ids.add(id);
    return {id, text, status};
  });
  if (active > 1) throw new Error('一次只把一项标成进行中。');
  return {title: String(params.title || '工作计划').trim().slice(0, 80), items, explanation: String(params.explanation || '').slice(0, 500)};
}

export class RichStore {
  constructor(root, clock = Date.now) { this.root = root; this.clock = clock; }
  directory(kind) {
    const dir = path.join(this.root, kind);
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    return dir;
  }
  write(kind, id, value) {
    const dir = this.directory(kind), file = path.join(dir, id + '.json');
    const temp = file + '.' + randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(value), {mode: 0o600, flag: 'wx'});
      fs.renameSync(temp, file);
    } finally { try { fs.unlinkSync(temp); } catch {} }
  }
  read(kind, id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, kind, id + '.json'), 'utf8')); }
    catch { return null; }
  }
  updatePlan(key, params, ctx = {}) {
    sessionKey(key);
    const plan = {...normalizePlan(params), sessionKey: key, runId: String(ctx.runId || ''), toolCallId: String(ctx.toolCallId || ''), updatedAt: this.clock()};
    this.write('plans', digest(key), plan);
    return plan;
  }
  plan(key) { return this.read('plans', digest(sessionKey(key))); }
  app(key, source) {
    sessionKey(key);
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_APP) throw new Error('小应用内容为空或超过 512KB。');
    const id = digest(key + '\0' + source);
    let record = this.read('apps', id);
    if (!record) {
      record = {id, source, token: randomBytes(32).toString('hex'), createdAt: this.clock()};
      this.write('apps', id, record);
    }
    return {id, token: record.token, url: '/pinkie-app/' + id + '?key=' + record.token};
  }
  authorizedApp(id, token) {
    if (!/^[a-f0-9]{64}$/.test(String(id)) || !/^[a-f0-9]{64}$/.test(String(token))) return null;
    const record = this.read('apps', id);
    if (!record || !/^[a-f0-9]{64}$/.test(record.token) || !timingSafeEqual(Buffer.from(record.token, 'hex'), Buffer.from(token, 'hex'))) return null;
    return record;
  }
}

// This frame has an opaque origin (sandbox=allow-scripts). It can run the
// supplied UI but cannot use the parent's gateway, storage, network or files.
//
// Every app starts on Pinkie's palette: the tokens below follow the chat's
// day/night switch, and plain elements (button, input, table, .card) already
// look like the rest of the chat. All defaults sit in :where() so anything the
// app writes itself wins.
const APP_BASE = `*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light;--pk-fg:#2a2233;--pk-mute:rgba(42,34,51,.58);--pk-line:rgba(42,34,51,.12);--pk-panel:rgba(255,255,255,.72);--pk-chip:rgba(42,34,51,.045);--pk-accent:#2f7bff;--pk-accent-ink:#1f5fd6;--pk-on-accent:#fff;--pk-on:rgba(47,123,255,.12);--pk-on-line:rgba(47,123,255,.42);--pk-pink:#e94f91;--pk-good:#16956f;--pk-bad:#c2412d;--pk-radius:12px;--pk-font:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif;--pk-mono:ui-monospace,"SF Mono",Menlo,monospace}
:root[data-theme=night]{color-scheme:dark;--pk-fg:#ece3e8;--pk-mute:rgba(236,223,230,.56);--pk-line:rgba(236,223,230,.13);--pk-panel:rgba(255,255,255,.045);--pk-chip:rgba(255,255,255,.06);--pk-accent:#8ec0ff;--pk-accent-ink:#a9d0ff;--pk-on-accent:#0d1a2e;--pk-on:rgba(142,192,255,.14);--pk-on-line:rgba(142,192,255,.45);--pk-pink:#ff8cbf;--pk-good:#6fdcb5;--pk-bad:#ff9a8a}
:where(html){background:transparent;color:var(--pk-fg);font:14px/1.6 var(--pk-font);-webkit-font-smoothing:antialiased}
:where(body){margin:0;padding:14px 16px}
:where(h1,h2,h3,h4){margin:0 0 .5em;line-height:1.3;font-weight:650;letter-spacing:.01em}:where(h1){font-size:20px}:where(h2){font-size:17px}:where(h3,h4){font-size:15px}
:where(p){margin:0 0 .6em}:where(small,.muted){color:var(--pk-mute)}:where(a){color:var(--pk-accent-ink)}
:where(button){font:inherit;font-size:13.5px;line-height:20px;padding:6px 14px;border:0;border-radius:999px;background:var(--pk-chip);color:var(--pk-fg);box-shadow:inset 0 0 0 1px var(--pk-line);cursor:pointer;transition:background .18s,box-shadow .18s,color .18s,transform .12s}
:where(button:hover:not(:disabled)){background:var(--pk-on);box-shadow:inset 0 0 0 1px var(--pk-on-line)}
:where(button:active:not(:disabled)){transform:scale(.97)}:where(button:disabled){opacity:.45;cursor:default}
:where(button.primary,button[type=submit]){background:var(--pk-accent);color:var(--pk-on-accent);box-shadow:none;font-weight:500}
:where(button.primary:hover:not(:disabled),button[type=submit]:hover:not(:disabled)){background:var(--pk-accent);filter:brightness(1.06)}
:where(button.is-on,button[aria-pressed=true]){background:var(--pk-on);color:var(--pk-accent-ink);box-shadow:inset 0 0 0 1px var(--pk-on-line)}
:where(input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea){font:inherit;color:inherit;background:var(--pk-panel);border:0;border-radius:10px;padding:7px 10px;box-shadow:inset 0 0 0 1px var(--pk-line);min-width:0}
:where(input,select,textarea,button):focus-visible{outline:2px solid var(--pk-accent);outline-offset:2px}
:where(input[type=range],input[type=checkbox],input[type=radio],progress,meter){accent-color:var(--pk-accent)}
:where(label){color:var(--pk-mute);font-size:13px}
:where(input[type=range]){-webkit-appearance:none;appearance:none;height:4px;margin:10px 0;border-radius:4px;background:var(--pk-line);cursor:pointer}
:where(input[type=range])::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--pk-accent);box-shadow:0 0 0 4px var(--pk-on);transition:box-shadow .18s}
:where(input[type=range]):hover::-webkit-slider-thumb{box-shadow:0 0 0 6px var(--pk-on)}
:where(progress){-webkit-appearance:none;appearance:none;height:6px;border:0;border-radius:6px;background:var(--pk-line);overflow:hidden}
:where(progress)::-webkit-progress-bar{background:var(--pk-line)}:where(progress)::-webkit-progress-value{background:var(--pk-accent);border-radius:6px}
:where(table){border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}:where(th,td){padding:7px 10px;border-bottom:1px solid var(--pk-line);text-align:left}:where(th){color:var(--pk-mute);font-weight:500;font-size:12.5px}
:where(.card){background:var(--pk-panel);border-radius:var(--pk-radius);box-shadow:inset 0 0 0 1px var(--pk-line);padding:14px 16px}
:where(.row){display:flex;flex-wrap:wrap;align-items:center;gap:8px}:where(.stack){display:grid;gap:10px}
:where(.big){font-size:34px;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
:where(code,pre,kbd){font-family:var(--pk-mono);font-size:12.5px}:where(hr){border:0;border-top:1px solid var(--pk-line);margin:12px 0}
:where(img,canvas,svg,video){max-width:100%}`;

// The height is the content's own height (not the frame's viewport), so a short
// app shrinks the frame instead of keeping the first guess. The parent's theme
// arrives as a message; only the embedding chat may change it.
function bootScript(record, theme) {
  const message = JSON.stringify({type: 'pinkie-app-size', id: record.id, token: record.token});
  return `<script>(()=>{const m=${message},d=document.documentElement;d.dataset.theme=${JSON.stringify(theme)};let last=0;const size=()=>{const b=document.body;if(!b)return;const cs=getComputedStyle(b),h=Math.ceil(b.getBoundingClientRect().height+parseFloat(cs.marginTop)+parseFloat(cs.marginBottom));if(Math.abs(h-last)>1){last=h;parent.postMessage({...m,height:h},'*')}};addEventListener('message',e=>{if(e.source===parent&&e.data&&e.data.type==='pinkie-app-theme')d.dataset.theme=e.data.night?'night':'day'});addEventListener('DOMContentLoaded',()=>{new ResizeObserver(size).observe(document.body);size()});addEventListener('load',size)})();</script>`;
}

export function appDocument(record, theme = 'day') {
  const mode = theme === 'night' ? 'night' : 'day';
  const boot = `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${APP_BASE}</style>` + bootScript(record, mode);
  const source = record.source.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)[\s\S]*?>/gi, '');
  return /<head\b[^>]*>/i.test(source) ? source.replace(/<head\b[^>]*>/i, match => match + boot) : '<!doctype html><html><head><meta charset="utf-8">' + boot + '</head><body>' + source + '</body></html>';
}

export const APP_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";

function strings(value, max = 100) {
  if (!Array.isArray(value) || value.length > max || value.some(s => typeof s !== 'string' || s.length > 8192)) throw new Error('参数列表格式无效。');
  return value;
}
function entries(value) {
  if (!object(value) || Object.keys(value).length > 100) throw new Error('凭据或环境变量格式无效。');
  for (const [key, val] of Object.entries(value)) if (!key || key.length > 150 || typeof val !== 'string' || val.length > 16384 || /[\r\n\0]/.test(key)) throw new Error('凭据或环境变量格式无效。');
  return {...value};
}

export function connectorConfig(raw, previous = {}) {
  if (!object(raw)) throw new Error('连接器配置需要是 JSON 对象。');
  const next = {...previous};
  if (raw.url) {
    const url = new URL(String(raw.url));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('请输入有效的 HTTP/HTTPS 服务地址。');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程服务请使用 HTTPS。');
    if (url.search) throw new Error('请把密钥放在请求头，服务地址不要包含查询参数。');
    if (previous.url && new URL(previous.url).href !== url.href) {
      delete next.headers; delete next.auth; delete next.oauth;
    }
    next.url = url.href;
    next.transport = raw.transport === 'sse' || raw.type === 'sse' ? 'sse' : 'streamable-http';
    delete next.command; delete next.args; delete next.env; delete next.cwd;
    if (raw.auth === 'oauth') next.auth = 'oauth';
    else if (Object.hasOwn(raw, 'auth')) delete next.auth;
    if (Object.hasOwn(raw, 'headers')) next.headers = entries(raw.headers);
    if (object(raw.oauth)) {
      next.oauth = {...raw.oauth};
    }
  } else if (raw.command) {
    const command = String(raw.command).trim();
    if (!command || command.length > 1000 || /[\r\n\0]/.test(command)) throw new Error('启动命令格式无效。');
    if (previous.command && previous.command !== command) delete next.env;
    next.command = command; next.args = strings(raw.args ?? (previous.command === command ? previous.args || [] : []));
    if (Object.hasOwn(raw, 'env')) next.env = entries(raw.env);
    if (raw.cwd) {
      if (!path.isAbsolute(raw.cwd)) throw new Error('工作目录需要使用完整路径。');
      next.cwd = String(raw.cwd);
    }
    delete next.url; delete next.transport; delete next.auth; delete next.oauth; delete next.headers;
  } else throw new Error('请填写服务地址，或本地启动命令。');
  next.enabled = raw.enabled !== false;
  if (object(raw.toolFilter)) {
    next.toolFilter = {};
    for (const key of ['include', 'exclude']) if (raw.toolFilter[key]) next.toolFilter[key] = strings(raw.toolFilter[key]);
  }
  for (const key of ['timeout', 'connectTimeout']) {
    if (raw[key] !== undefined) {
      if (!Number.isFinite(raw[key]) || raw[key] < 1 || raw[key] > 300) throw new Error('超时应为 1–300 秒。');
      next[key] = raw[key];
    }
  }
  return next;
}

export const CONNECTOR_CATALOG = [
  {id: 'github', name: 'GitHub', description: '查仓库、议题与代码；使用你自己的 GitHub 凭据。', source: 'https://github.com/github/github-mcp-server', config: {url: 'https://api.githubcopilot.com/mcp/', transport: 'streamable-http'}, credential: 'bearer'},
  {id: 'notion', name: 'Notion', description: '读写你授权的页面与数据库，网页登录授权。', source: 'https://developers.notion.com/guides/mcp/overview', config: {url: 'https://mcp.notion.com/mcp', transport: 'streamable-http', auth: 'oauth'}, credential: 'oauth'},
  {id: 'files', name: '本地资料夹', description: '把选定资料夹交给官方文件服务；默认只开放读取。', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', config: {command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], toolFilter: {include: ['read_file', 'read_text_file', 'read_multiple_files', 'list_directory', 'search_files', 'get_file_info', 'list_allowed_directories']}}, credential: 'folder'},
];

const publicConnector = (name, config) => ({name, enabled: config.enabled !== false, transport: config.url ? config.transport || 'streamable-http' : 'stdio', url: config.url ? new URL(config.url).origin + new URL(config.url).pathname : '', command: config.command || '', auth: config.auth === 'oauth' ? 'oauth' : config.headers?.Authorization ? 'token' : 'none', hasCredentials: !!(config.headers && Object.keys(config.headers).length || config.env && Object.keys(config.env).length), toolFilter: config.toolFilter || null});

export function parseCliJson(stdout) {
  const value = String(stdout).trim();
  for (let i = 0; i < value.length; i++) if (value[i] === '{' || value[i] === '[') {
    try { return JSON.parse(value.slice(i)); } catch {}
  }
  throw new Error('服务没有返回有效的连接状态。');
}

const PUSH_CHANNELS = ['openclaw-weixin', 'feishu', 'qqbot'];

// Where a scheduled job can push its result: the people who already talk to
// Pinkie on WeChat / Feishu / QQ. Each chat session remembers its delivery
// route, so the settings page can offer "微信 · 最近聊过" instead of asking
// for a raw recipient ID. Newest first, one entry per channel+recipient.
export function pushTargets(stateDir, limit = 12) {
  const found = new Map();
  let agents = [];
  try { agents = fs.readdirSync(path.join(stateDir, 'agents')); } catch { return []; }
  for (const agent of agents) {
    let sessions;
    try { sessions = JSON.parse(fs.readFileSync(path.join(stateDir, 'agents', agent, 'sessions', 'sessions.json'), 'utf8')); } catch { continue; }
    for (const entry of Object.values(sessions || {})) {
      const route = entry?.deliveryContext;
      if (!object(route) || !PUSH_CHANNELS.includes(route.channel) || typeof route.to !== 'string' || !route.to || route.to.length > 300) continue;
      if (entry.chatType && entry.chatType !== 'direct') continue;
      const at = Number(entry.lastInteractionAt || entry.updatedAt || 0);
      const key = route.channel + '\0' + route.to;
      const old = found.get(key);
      if (!old || at > old.at) found.set(key, {channel: route.channel, to: route.to, accountId: typeof route.accountId === 'string' ? route.accountId : '', at});
    }
  }
  return [...found.values()].sort((a, b) => b.at - a.at).slice(0, limit)
    .map(target => ({...target, tail: target.to.replace(/^.*[:_]/, '').slice(-4)}));
}

// 「深度研究」开关：输入框旁的按钮只在网关这边给当前对话做个记号，下一条真正的消息
// 生成提示词时带上研究要求；同一条消息的重试继续带，换一条消息就结束。关掉开关随时撤销。
const CONTROL_PROMPT = /^\s*\[pinkie-(?:watchdog|tier-control|tier)\]/;
const RESEARCH_TTL = 6 * 3600_000;
export const RESEARCH_TURN = '先生在输入框打开了「深度研究」：这一条按 pinkie-deep-research 技能完成。先用 plan_update 列出要回答的 3–6 个问题，实际阅读原始来源并交叉核对，最终回复就是完整报告：先给结论，再用表格比较，关键结论旁放可点开的原文链接，写明局限。信息不足时按最合理的理解直接开工，开头说明你的假设，不先停下来追问。';
export class ResearchSwitch {
  constructor(clock = Date.now) { this.clock = clock; this.map = new Map(); }
  arm(key, on = true) {
    if (on) this.map.set(key, {at: this.clock(), message: ''});
    else this.map.delete(key);
    return this.status(key);
  }
  status(key) {
    const r = this.map.get(key);
    if (r && this.clock() - r.at > RESEARCH_TTL) { this.map.delete(key); return {armed: false}; }
    return {armed: !!r && !r.message, running: !!r?.message};
  }
  take(key, prompt) {
    const r = this.map.get(key);
    if (!r) return '';
    if (this.clock() - r.at > RESEARCH_TTL) { this.map.delete(key); return ''; }
    const text = String(prompt || '').trim();
    if (!text || CONTROL_PROMPT.test(text)) return r.message ? RESEARCH_TURN : '';
    if (!r.message) { r.message = text.slice(0, 4000); return RESEARCH_TURN; }
    if (text === r.message || text.endsWith(r.message)) return RESEARCH_TURN;
    this.map.delete(key);
    return '';
  }
}

export function registerRichRuntime(api, options = {}) {
  const stateDir = options.stateDir || api.runtime.state.resolveStateDir();
  const store = options.store || new RichStore(path.join(stateDir, 'pinkie-rich'));
  const cli = options.cli || path.resolve(path.dirname(process.argv[1] || ''), 'openclaw.mjs');
  const runner = options.runner || (args => exec(process.execPath, [cli, 'mcp', ...args], {timeout: 60_000, maxBuffer: 2 * 1024 * 1024, env: {...process.env, FORCE_COLOR: '0'}}));
  const config = () => api.runtime.config.current();
  const safeError = error => {
    let text = String(error?.message || '操作未完成。').slice(0, 600);
    for (const server of Object.values(config()?.mcp?.servers || {})) for (const value of [...Object.values(server.headers || {}), ...Object.values(server.env || {})]) {
      if (typeof value === 'string' && value.length > 5) text = text.split(value).join('•••');
    }
    return text.replace(/Bearer\s+\S+/gi, 'Bearer •••').replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|ntn_[A-Za-z0-9_]+)/g, '•••');
  };
  const method = (name, scope, fn) => api.registerGatewayMethod(name, async ({params, respond}) => {
    try { respond(true, await fn(params || {})); }
    catch (error) { respond(false, undefined, {code: 'INVALID_REQUEST', message: safeError(error)}); }
  }, {scope});

  api.registerTool?.(ctx => ({
    name: 'plan_update', label: '更新工作计划',
    description: '三步以上的长任务用这个工具维护一张实时清单。传入完整列表，每项用 pending、in_progress 或 completed；同时最多一项进行中。做完实际工作才标 completed。短答不用。',
    parameters: {type: 'object', additionalProperties: false, properties: {title: {type: 'string'}, explanation: {type: 'string'}, items: {type: 'array', minItems: 1, maxItems: 20, items: {type: 'object', additionalProperties: false, properties: {id: {type: 'string'}, text: {type: 'string'}, status: {type: 'string', enum: ['pending', 'in_progress', 'completed']}}, required: ['text', 'status']}}}, required: ['items']},
    async execute(toolCallId, params) {
      try { return reply(store.updatePlan(ctx.sessionKey, params, {...ctx, toolCallId})); }
      catch (error) { return {...reply({error: safeError(error)}), isError: true}; }
    },
  }), {name: 'plan_update'});
  method('pinkie.plan.get', 'operator.read', params => ({plan: store.plan(params.sessionKey)}));
  method('pinkie.rich.app.put', 'operator.admin', params => store.app(params.sessionKey, params.html));
  // The plugin is loaded more than once per gateway; one switch per process.
  const research = globalThis.__pinkieResearchSwitch ||= new ResearchSwitch();
  api.on('before_prompt_build', (event, ctx) => {
    const key = String(ctx.sessionKey || '');
    const turn = key ? research.take(key, event?.prompt) : '';
    return {
      appendSystemContext: RICH_RULES + (key.startsWith('agent:unrestricted:') ? '\n挥洒模式只用组件展示结果，不用 ui 表单或选择按钮让用户确认、挑方案；沿用当前模式规则直接执行。' : ''),
      ...(turn ? {appendContext: turn} : {}),
    };
  }, {priority: -11000});
  method('pinkie.research.arm', 'operator.admin', params => research.arm(sessionKey(params.sessionKey), params.on !== false));
  method('pinkie.research.status', 'operator.read', params => research.status(String(params.sessionKey || '')));
  api.registerHttpRoute({path: '/pinkie-app/', match: 'prefix', auth: 'plugin', handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const id = url.pathname.slice('/pinkie-app/'.length), record = store.authorizedApp(id, url.searchParams.get('key'));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!record) { res.statusCode = 404; res.end('Not found'); return true; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return true; }
    res.setHeader('Content-Security-Policy', APP_CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : appDocument(record, url.searchParams.get('theme')));
    return true;
  }});

  method('pinkie.connectors.list', 'operator.admin', () => ({catalog: CONNECTOR_CATALOG, servers: Object.entries(config()?.mcp?.servers || {}).map(([name, cfg]) => publicConnector(name, cfg))}));
  method('pinkie.connectors.save', 'operator.admin', async params => {
    if (!NAME.test(String(params.name || ''))) throw new Error('名称请用 1–64 个字母、数字、短横线或下划线。');
    const result = await api.runtime.config.mutateConfigFile({base: 'source', afterWrite: {mode: 'auto'}, mutate(draft) {
      draft.mcp ||= {}; draft.mcp.servers ||= {};
      const old = draft.mcp.servers[params.name];
      if (old && !params.replace) throw new Error('同名连接器已经存在，请编辑它或换一个名称。');
      draft.mcp.servers[params.name] = connectorConfig(params.config, old);
    }});
    return {ok: true, followUp: result.followUp, message: '已保存。新对话会使用这项连接。'};
  });
  method('pinkie.connectors.toggle', 'operator.admin', async params => {
    if (!NAME.test(String(params.name || '')) || typeof params.enabled !== 'boolean') throw new Error('连接器参数无效。');
    await api.runtime.config.mutateConfigFile({base: 'source', afterWrite: {mode: 'auto'}, mutate(draft) {
      const server = draft.mcp?.servers?.[params.name];
      if (!server) throw new Error('没有找到这个连接器。');
      server.enabled = params.enabled;
    }});
    return {ok: true};
  });
  method('pinkie.connectors.remove', 'operator.admin', async params => {
    if (!NAME.test(String(params.name || ''))) throw new Error('连接器名称无效。');
    await api.runtime.config.mutateConfigFile({base: 'source', afterWrite: {mode: 'auto'}, mutate(draft) {
      if (!draft.mcp?.servers?.[params.name]) throw new Error('没有找到这个连接器。');
      delete draft.mcp.servers[params.name];
    }});
    return {ok: true};
  });
  const serverNamed = name => {
    if (!NAME.test(String(name || ''))) throw new Error('连接器名称无效。');
    const server = config()?.mcp?.servers?.[name];
    if (!server) throw new Error('没有找到这个连接器。');
    return server;
  };
  method('pinkie.connectors.probe', 'operator.admin', async params => {
    const server = serverNamed(params.name);
    if (server.enabled === false) throw new Error('先启用连接器，再测试连接。');
    const {stdout} = await runner(['probe', params.name, '--json']);
    const data = parseCliJson(stdout);
    return {servers: data.servers || {}, diagnostics: (data.diagnostics || []).map(d => ({serverName: d.serverName, message: safeError({message: d.message})}))};
  });
  method('pinkie.connectors.login', 'operator.admin', async params => {
    const server = serverNamed(params.name);
    if (server.auth !== 'oauth') throw new Error('这个服务使用密钥，不需要网页登录授权。');
    const args = ['login', params.name];
    if (params.code) {
      if (typeof params.code !== 'string' || params.code.length > 8192 || /[\r\n\0]/.test(params.code)) throw new Error('授权码格式无效。');
      args.push('--code', params.code);
    }
    const {stdout} = await runner(args);
    const url = String(stdout).match(/^https:\/\/\S+$/m)?.[0];
    return {authorized: !url && /credentials saved|authorized/i.test(stdout), url: url || null};
  });
  method('pinkie.cron.targets', 'operator.admin', () => ({targets: pushTargets(stateDir)}));
  return {store};
}
