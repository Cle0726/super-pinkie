// 产品设定防护（正式版才打开；开发版、源码运行、隔离副本默认关）。
//
// 用户只享有碧琪对他们的记忆：聊天里不能让碧琪改自己的人设/手册/技能/配置，
// 记忆里塞指令不生效。不影响写代码：只按「受保护路径」黑名单拦 write/edit/apply_patch/code_edit，
// exec 不拦（只拦改 openclaw 配置的那几条命令），exec 改了的东西由启动校验（installer/guard）换回。
//
// 开关写死在正式包里：App 包里的 build-info.json（release.yml 写入，参与签名清单）。
// 这里只认包里的文件，不读环境变量、配置、命令行参数来关防护。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {agentEntries, agentWorkspace, expandHome, openclawConfigPath, openclawStateDir, readConfigFile} from './openclaw-paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const PRODUCT_AGENTS = ['main', 'project', 'thinking', 'learning'];
export const USER_SKILLS_DIR = 'user-skills';
// 工作区里碧琪可以写、但内容要过滤的「记忆区」。
const MEMORY_FILES = new Set(['memory.md', 'user.md', 'tools.md', 'dreams.md']);
// 工作区里的产品设定（相对工作区，小写比较）。其它文件（碧琪替用户生成的东西）照常可写。
const WORKSPACE_PROTECTED_FILES = new Set(['agents.md', 'soul.md', 'identity.md', 'heartbeat.md', 'bootstrap.md']);
const WORKSPACE_PROTECTED_DIRS = ['persona', 'playbooks', 'skills', '.openclaw'];
// 状态目录（~/.openclaw）里的产品键和凭据：聊天一律不能写。
const STATE_PROTECTED = [
  {match: rel => /^openclaw\.json/.test(rel), label: '碧琪的配置文件 openclaw.json'},
  {match: rel => /^extensions(\/|$)/.test(rel), label: '碧琪的插件代码'},
  {match: rel => /^agents\/[^/]+\/agent(\/|$)/.test(rel), label: '模型密钥和模型列表'},
  {match: rel => /^(exec-approvals\.json|identity(\/|$)|devices(\/|$)|credentials(\/|$)|hooks(\/|$)|workspace-attestations(\/|$)|config-journal)/.test(rel), label: '碧琪的运行设定'},
];

const truthy = value => value === true || value === 'true' || value === 1 || value === '1';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// 从 OpenClaw 入口往上找包根（有 VERSION 的那一层）里的 build-info.json；
// Mac：SuperPinkie/runtime/openclaw/openclaw.mjs，Windows：…/runtime/node_modules/openclaw/openclaw.mjs。
export function findBundleRoot(entry = process.argv[1]) {
  let dir;
  try { dir = path.dirname(fs.realpathSync(String(entry || ''))); } catch { return ''; }
  for (let i = 0; i < 5; i += 1) {
    if (fs.existsSync(path.join(dir, 'VERSION')) && (fs.existsSync(path.join(dir, 'build-info.json')) || fs.existsSync(path.join(dir, 'personas')))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

let cachedMode = null;
// 防护是否打开：包里的 build-info.json 或插件目录里随包装进来的 guard-build.json，任一说开就开。
export function guardMode({entry = process.argv[1], pluginDir = HERE, refresh = false} = {}) {
  if (cachedMode && !refresh) return cachedMode;
  const bundleRoot = findBundleRoot(entry);
  const sources = [bundleRoot && path.join(bundleRoot, 'build-info.json'), path.join(pluginDir, 'guard-build.json')].filter(Boolean);
  let info = null;
  for (const file of sources) {
    const value = readJson(file);
    if (value && truthy(value.guard)) { info = {...value, source: file}; break; }
    if (value && !info) info = {...value, guard: false, source: file};
  }
  cachedMode = {
    enabled: Boolean(info && truthy(info.guard)),
    channel: info?.channel || 'dev',
    version: info?.version || '',
    bundleRoot,
    source: info?.source || '',
  };
  return cachedMode;
}
export function resetGuardModeCache() { cachedMode = null; }

// ---------- 路径解析：.. / ~ / symlink / 大小写 / Windows 反斜杠和盘符 ----------
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';
function norm(p) {
  let value = String(p || '').normalize('NFC');
  if (process.platform === 'win32') value = value.replace(/\\/g, '/');
  value = value.replace(/\/+$/, '') || '/';
  return CASE_INSENSITIVE ? value.toLowerCase() : value;
}
function realish(abs) {
  // 目标可能还不存在：解析最深的已存在祖先，再接上剩下的部分。
  let probe = abs; const rest = [];
  for (let i = 0; i < 64; i += 1) {
    try { return path.join(fs.realpathSync.native(probe), ...rest); } catch {}
    const parent = path.dirname(probe);
    if (parent === probe) break;
    rest.unshift(path.basename(probe));
    probe = parent;
  }
  return abs;
}
export function resolveTarget(raw, base, home = os.homedir()) {
  let value = String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!value) return null;
  if (/^file:\/\//i.test(value)) { try { value = decodeURIComponent(new URL(value).pathname); } catch {} }
  value = expandHome(value, home);
  if (process.platform === 'win32') value = value.replace(/\//g, '\\');
  const abs = path.resolve(base || home, value);
  return {abs, real: realish(abs)};
}
function within(child, parent) {
  const c = norm(child), p = norm(parent);
  if (!p || p === '/') return false;
  return c === p || c.startsWith(p + '/');
}
function relativeTo(child, parent) {
  return norm(child).slice(norm(parent).length + 1);
}

// ---------- 记忆 / 技能里的「指令式」内容 ----------
const INSTRUCTION_PATTERNS = [
  /(?:忽略|无视|绕过|不用(?:再)?遵守|不要(?:再)?遵守|别(?:再)?遵守|跳过|废除|覆盖|取消|解除)(?:你的|碧琪的|之前的?|以上的?|上面的?|所有的?|全部的?|一切)?[^。\n]{0,8}(?:规则|设定|指令|限制|约束|人设|系统提示|安全|手册|要求)/,
  /(?:你|碧琪)(?:的)?(?:新)?(?:规则|设定|人设|身份|系统提示词?|指令|核心设定|底层设定)(?:是|改为|改成|变成|换成|更新为|：|:)/,
  /(?:新的?|最高|最新)(?:规则|指令|设定|系统提示)(?:是|如下|：|:)/,
  /(?:从现在起|从今以后|从今天起|以后|今后|此后|永远|始终)[^。\n]{0,12}(?:你|碧琪)[^。\n]{0,10}(?:没有|不受|不再受|无需|不需要|可以无视|可以忽略|解除)[^。\n]{0,6}(?:任何)?(?:限制|约束|规则|审查|道德|安全)/,
  /(?:你|碧琪)(?:现在|从现在起)?(?:不再是|不是)碧琪/,
  /(?:你|碧琪)(?:必须|一定要|只能|务必)(?:无条件|永远|始终|总是)?(?:服从|听从|执行|遵守)(?:我|用户|以下|下面)/,
  /(?:越狱|破甲|开发者模式|无限制模式|上帝模式|DAN\b|jailbreak|developer mode|god mode)/i,
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous|prior|above|earlier|system|safety)?\s*(?:instructions?|rules?|prompts?|guidelines?|restrictions?)/i,
  /\b(?:system prompt|your (?:new )?(?:rules|instructions) (?:are|is))\b/i,
  /\bfrom now on,?\s+(?:you|the assistant)\s+(?:must|will|are|have no|can)/i,
  /\byou (?:have no|are no longer bound by|are free from) (?:any )?(?:rules|restrictions|limits|guidelines)/i,
];
export function instructionLike(text) {
  const value = String(text || '').normalize('NFKC');
  if (!value.trim()) return false;
  return INSTRUCTION_PATTERNS.some(re => re.test(value));
}
export const MEMORY_REFUSAL = '这段内容是在改碧琪的规则或设定，不是关于用户本人的事实或偏好，碧琪不会把它记进记忆。碧琪的设定在正式版里改不了；关于用户自己的事（称呼、喜好、习惯、近况）可以照常记。';

// ---------- 主体 ----------
export class SettingsGuard {
  constructor(options = {}) {
    this.home = options.home || os.homedir();
    this.env = options.env || process.env;
    this.stateDir = options.stateDir || openclawStateDir(this.env, this.home);
    this.configPath = options.configPath || openclawConfigPath({env: this.env, home: this.home});
    this.pinkieStateRoot = options.pinkieStateRoot || '';
    this.mode = options.mode || guardMode();
    this.enabledOverride = options.enabled;
    this.readConfig = options.readConfig || (() => readConfigFile({env: this.env, home: this.home}));
    this.workspaceFor = options.workspaceFor || null;
    this.productSkillNames = options.productSkillNames || null;
    this.blocked = [];
    this.cache = {at: 0, value: null};
  }
  get enabled() { return this.enabledOverride ?? this.mode.enabled; }

  workspaces() {
    const now = Date.now();
    if (this.cache.value && now - this.cache.at < 5000) return this.cache.value;
    const config = this.readConfig() || {};
    const list = new Set();
    for (const id of PRODUCT_AGENTS) {
      try { const dir = agentWorkspace(config, id, {env: this.env, home: this.home}); if (dir) list.add(dir); } catch {}
    }
    // 群聊等专用 agent 的工作区也带产品手册；无限制模式归用户，不在内。
    for (const agent of agentEntries(config)) {
      if (!agent?.id || agent.id === 'unrestricted' || PRODUCT_AGENTS.includes(agent.id)) continue;
      const dir = expandHome(agent.workspace, this.home);
      if (dir && path.isAbsolute(dir) && /[\\/]\.openclaw[^\\/]*[\\/]workspace-/.test(dir) && !/workspace-unrestricted/.test(dir)) list.add(dir);
    }
    const value = [...list].map(dir => ({dir, real: realish(dir)}));
    this.cache = {at: now, value};
    return value;
  }

  skillNames() {
    if (this.productSkillNames) return this.productSkillNames;
    const names = new Set(['deep-think', 'web-gpt-collab', 'pinkie-deep-research', 'pinkie-skill-library']);
    const roots = [this.mode.bundleRoot && path.join(this.mode.bundleRoot, 'bundled-skills'), this.env.PINKIE_MANAGED_SKILLS_DIR].filter(Boolean);
    for (const root of roots) {
      try { for (const name of fs.readdirSync(root)) if (!name.startsWith('.') && fs.statSync(path.join(root, name)).isDirectory()) names.add(name.toLowerCase()); } catch {}
    }
    this.productSkillNames = names;
    return names;
  }

  userSkillsDir() { return path.join(this.stateDir, USER_SKILLS_DIR); }

  // 一个绝对路径属于哪一类：protected（拒绝）/ memory（过滤内容）/ user-skill（查同名）/ free。
  classify(target) {
    for (const candidate of [target.abs, target.real]) {
      const verdict = this.classifyOne(candidate);
      if (verdict.kind !== 'free') return verdict;
    }
    const linked = this.hardLinked(target.real);
    if (linked) return linked;
    return {kind: 'free'};
  }

  classifyOne(file) {
    const bundle = this.mode.bundleRoot;
    if (bundle && within(file, bundle)) return {kind: 'protected', label: '碧琪的安装包'};
    if (within(file, '/Applications/超級碧琪.app') || /\/超級碧琪\.app(\/|$)/i.test(norm(file))) return {kind: 'protected', label: '碧琪的安装包'};
    if (this.pinkieStateRoot) {
      for (const sub of ['guard', 'repository']) {
        if (within(file, path.join(this.pinkieStateRoot, sub))) return {kind: 'protected', label: '碧琪的更新和校验数据'};
      }
    }
    if (within(file, this.userSkillsDir())) return {kind: 'user-skill', rel: relativeTo(file, this.userSkillsDir())};
    for (const {dir, real} of this.workspaces()) {
      const root = within(file, dir) ? dir : within(file, real) ? real : '';
      if (!root) continue;
      const rel = relativeTo(file, root);
      if (!rel) return {kind: 'protected', label: '碧琪的工作区目录'};
      const top = rel.split('/')[0];
      if (MEMORY_FILES.has(rel) || top === 'memory') return {kind: 'memory', rel};
      if (top === USER_SKILLS_DIR) return {kind: 'user-skill', rel: rel.slice(top.length + 1)};
      if (WORKSPACE_PROTECTED_FILES.has(rel)) return {kind: 'protected', label: `碧琪的人设和手册（${rel}）`};
      if (WORKSPACE_PROTECTED_DIRS.includes(top)) return {kind: 'protected', label: top === 'skills' ? '碧琪自带的技能' : `碧琪的人设和手册（${top}/）`};
      return {kind: 'free'};
    }
    if (within(file, this.stateDir)) {
      const rel = relativeTo(file, this.stateDir);
      const hit = STATE_PROTECTED.find(item => item.match(rel));
      if (hit) return {kind: 'protected', label: hit.label};
    }
    if (within(file, this.configPath)) return {kind: 'protected', label: '碧琪的配置文件 openclaw.json'};
    return {kind: 'free'};
  }

  // 硬链接：路径看着在项目里，实际和受保护文件是同一个文件。
  hardLinked(file) {
    let stat;
    try { stat = fs.statSync(file); } catch { return null; }
    if (!stat.isFile() || stat.nlink < 2) return null;
    const candidates = [this.configPath];
    for (const {dir} of this.workspaces()) {
      for (const name of ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md']) candidates.push(path.join(dir, name));
      for (const sub of WORKSPACE_PROTECTED_DIRS) walk(path.join(dir, sub), candidates, 4000);
    }
    for (const other of candidates) {
      try {
        const s = fs.statSync(other);
        if (s.ino === stat.ino && s.dev === stat.dev) return {kind: 'protected', label: '碧琪的设定文件（通过硬链接）'};
      } catch {}
    }
    return null;
  }

  refusal(label) {
    return `这是${label}，正式版里不能在聊天中修改，文件没有改动。用户能改的：记忆（memory/、USER.md）、设置里的偏好、自己的模型和密钥（设置 → 模型）、自己的技能（写到 ${this.userSkillsDir()}）。如果是在帮用户写代码，请把文件写在用户的项目目录里。`;
  }

  record(event, reason) {
    this.blocked.push({at: new Date().toISOString(), tool: event?.toolName, reason: String(reason).slice(0, 120)});
    if (this.blocked.length > 50) this.blocked.splice(0, this.blocked.length - 50);
  }

  // before_tool_call：返回 {block, blockReason} 或 undefined。
  beforeTool(event = {}, ctx = {}, {base = ''} = {}) {
    if (!this.enabled) return undefined;
    const tool = String(event.toolName || event.name || '');
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const decide = reason => { this.record(event, reason); return {block: true, blockReason: reason}; };
    if (tool === 'gateway') {
      const action = String(params.action || '');
      if (/^(config\.(apply|patch|set)|update\.run)$/.test(action)) {
        return decide('正式版里聊天不能修改碧琪的配置或触发更新。模型、密钥和偏好请用户在「设置」里改；更新请用设置里的「检查更新」。');
      }
      return undefined;
    }
    if (tool === 'exec' || tool === 'bash' || tool === 'process') {
      const command = String(params.command ?? params.cmd ?? params.input ?? '');
      if (CONFIG_COMMAND.test(command)) return decide('正式版里聊天不能用命令修改碧琪的配置、插件或更新。模型、密钥和偏好请用户在「设置」里改。其它命令照常可以用。');
      return undefined;
    }
    const writes = writeTargets(tool, params);
    if (!writes.length) return undefined;
    for (const item of writes) {
      const target = resolveTarget(item.path, item.base || base, this.home);
      if (!target) continue;
      const verdict = this.classify(target);
      if (verdict.kind === 'protected') return decide(this.refusal(verdict.label));
      if (verdict.kind === 'memory' && item.content && instructionLike(item.content)) return decide(MEMORY_REFUSAL);
      if (verdict.kind === 'user-skill') {
        const name = userSkillName(verdict.rel, item.content);
        if (name && this.skillNames().has(name.toLowerCase())) {
          return decide(`「${name}」和碧琪自带的技能同名，用户技能不能覆盖自带技能。换一个名字再写到 ${this.userSkillsDir()}。`);
        }
      }
    }
    return undefined;
  }

  status() {
    let startup = null;
    if (this.pinkieStateRoot) startup = readJson(path.join(this.pinkieStateRoot, 'guard', 'status.json'));
    // 「被修改过」看历史：哪次启动换回过文件、修过配置、发现不是官方包或校验出错，都留着标记，方便排查反馈。
    const history = Array.isArray(startup?.history) ? startup.history : [];
    const lastChange = history.length ? history[history.length - 1] : null;
    const modified = Boolean(startup && (history.length || startup.restored?.length || startup.nonOfficial || startup.error));
    return {
      enabled: this.enabled, channel: this.mode.channel, version: this.mode.version,
      userSkillsDir: this.userSkillsDir(),
      startup, modified, lastChange, error: startup?.error ? String(startup.error) : '', nonOfficial: Boolean(startup?.nonOfficial),
      recentBlocks: this.blocked.slice(-10),
    };
  }
}

function walk(dir, out, limit) {
  let entries;
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, limit); else if (entry.isFile()) out.push(full);
  }
}

// 改 openclaw 配置 / 插件 / 更新的命令（只拦这几条，其它 exec 一律放行）。
const CONFIG_COMMAND = /\bopenclaw(?:\.mjs|\.cmd)?["']?\s+(?:--[\w-]+(?:[ =]\S+)?\s+)*(?:config\s+(?:set|unset|apply|patch|edit|reset)\b|gateway\s+call\s+(?:config\.(?:apply|patch|set)|update\.run)\b|plugins?\s+(?:disable|uninstall|remove|install|enable)\b|update\b|skills\s+(?:disable|remove|uninstall)\b)/i;

function patchTargets(text) {
  const out = [];
  const re = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$|^\*\*\*\s+Move to:\s*(.+?)\s*$/gm;
  let match;
  while ((match = re.exec(String(text || '')))) out.push((match[1] || match[2]).trim());
  // 也认统一 diff 的 +++ b/path
  const diff = /^\+\+\+\s+(?:b\/)?(.+?)\s*$/gm;
  while ((match = diff.exec(String(text || '')))) if (match[1] !== '/dev/null') out.push(match[1].trim());
  return out;
}
function addedLines(text) {
  return String(text || '').split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
}

export function writeTargets(tool, params = {}) {
  const pathOf = () => params.path ?? params.file_path ?? params.filePath ?? params.file ?? params.target;
  if (tool === 'write') return [{path: pathOf(), content: String(params.content ?? params.text ?? '')}];
  if (tool === 'edit') {
    const parts = [params.new_string, params.newText, params.new_text, params.replacement];
    if (Array.isArray(params.edits)) for (const edit of params.edits) parts.push(edit?.newText, edit?.new_string, edit?.new_text);
    return [{path: pathOf(), content: parts.filter(v => typeof v === 'string').join('\n')}];
  }
  if (tool === 'code_edit') return [{path: pathOf(), content: String(params.new_text ?? '')}];
  if (tool === 'apply_patch') {
    const text = String(params.input ?? params.patch ?? params.diff ?? '');
    const content = addedLines(text);
    return patchTargets(text).map(p => ({path: p, content, base: params.cwd || params.workdir || ''}));
  }
  return [];
}

function userSkillName(rel, content) {
  const fromFront = /^---[\s\S]*?^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(String(content || ''));
  if (fromFront) return fromFront[1].trim();
  const top = String(rel || '').split('/')[0];
  return top && !top.includes('.') ? top : '';
}

// 插件挂接：before_tool_call 最先跑（priority 最高），并提供 pinkie.guard.status。
export function registerSettingsGuard(api, options = {}) {
  const guard = new SettingsGuard(options);
  const baseFor = options.baseFor || (() => '');
  api.on?.('before_tool_call', (event, ctx = {}) => {
    try { return guard.beforeTool(event, ctx, {base: baseFor(ctx)}); }
    catch (error) {
      // 校验本身出错时宁可拦下写设定类的工具，也不放过；其它工具照常。
      if (guard.enabled && ['write', 'edit', 'apply_patch', 'code_edit'].includes(String(event?.toolName))) {
        return {block: true, blockReason: `碧琪没能确认这个路径是不是产品设定（${error?.message || error}），先没有写入。请换一个项目目录里的路径再试。`};
      }
      return undefined;
    }
  }, {priority: 100000});
  api.registerGatewayMethod?.('pinkie.guard.status', ({respond}) => {
    try { respond(true, guard.status()); } catch (error) { respond(false, undefined, {code: 'guard_status_failed', message: String(error?.message || error)}); }
  });
  return guard;
}
