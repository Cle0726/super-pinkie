// 产品设定防护（正式版才打开；开发版、源码运行、隔离副本默认关）。
//
// 用户只享有碧琪对他们的记忆：聊天里不能让碧琪改自己的人设/手册/技能/配置，
// 记忆里塞指令不生效。不影响写代码：只按「受保护路径」黑名单拦 write/edit/apply_patch/code_edit，
// exec 不拦（只拦改 openclaw 配置的那几条命令），exec 改了的东西由启动校验（installer/guard）换回。
//
// 开关写死在正式包里：App 包里的 build-info.json（release.yml 写入，参与签名清单）。
// 这里只认包里的文件，不读环境变量、配置、命令行参数来关防护。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {agentEntries, agentWorkspace, expandHome, openclawConfigPath, openclawStateDir, readConfigFile} from './openclaw-paths.mjs';

// fileURLToPath：路径里有中文或空格（中文用户名、Windows 用户名带空格）时 URL.pathname 是 %E7… 编码，会读不到 guard-build.json。
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_KEY = 'MCowBQYDK2VwAyEAcejSsqLWnO2o0lFTrm+Lh22s8Qi5XSfTGX4GnQTgnOs=';
export const STRIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STRIKE_LIMIT = 3;
export const PRODUCT_AGENTS = ['main', 'project', 'thinking', 'learning'];
export const USER_SKILLS_DIR = 'user-skills';
const MODE_TO_PERSONA_DIR = Object.freeze({chat: 'chat', project: 'project', ideas: 'thinking', thinking: 'thinking', learning: 'learning', metre: 'metre'});
const CATEGORY_LABELS = Object.freeze({
  persona: '人设和工作手册',
  plugin: '模式功能文件',
  skill: '内置技能',
  'user-skill-disabled': '与内置技能同名的自建技能',
  'removed-extra': '额外加入的设定文件',
  config: '基础运行配置',
});
// 工作区里碧琪可以写、但内容要过滤的「记忆区」。
const MEMORY_FILES = new Set(['memory.md', 'user.md', 'tools.md', 'dreams.md']);
// 工作区里的产品设定（相对工作区，小写比较）。其它文件（碧琪替用户生成的东西）照常可写。
const WORKSPACE_PROTECTED_FILES = new Set(['agents.md', 'soul.md', 'identity.md', 'heartbeat.md', 'methods.md', 'aesthetics.md', 'bootstrap.md']);
const WORKSPACE_PROTECTED_DIRS = ['persona', 'playbooks', 'skills', '.openclaw'];
// 状态目录（~/.openclaw）里的产品键和凭据：聊天一律不能写。
const STATE_PROTECTED = [
  {match: rel => /^openclaw\.json/.test(rel), label: '碧琪的配置文件 openclaw.json'},
  {match: rel => /^guard-receipt\.json$/.test(rel), label: '碧琪的校验记录'},
  {match: rel => /^extensions(\/|$)/.test(rel), label: '碧琪的插件代码'},
  {match: rel => /^agents\/[^/]+\/agent(\/|$)/.test(rel), label: '模型密钥和模型列表'},
  {match: rel => /^(identity(\/|$)|devices(\/|$)|credentials(\/|$)|hooks(\/|$)|workspace-attestations(\/|$)|config-journal)/.test(rel), label: '碧琪的运行设定'},
];

const truthy = value => value === true || value === 'true' || value === 1 || value === '1';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const sha256Hex = data => crypto.createHash('sha256').update(data).digest('hex');

function atomicWriteFileSync(target, data, {mode} = {}) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.guard-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(temp, data, mode !== undefined ? {mode} : undefined);
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        fs.renameSync(temp, target);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === 3) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 35 * (attempt + 1));
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    try { fs.rmSync(temp, {force: true}); } catch {}
    throw error;
  }
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); } catch { return false; }
}

function verifySignatureBytes(bytes, signature, key = PUBLIC_KEY) {
  try {
    const pub = crypto.createPublicKey({key: Buffer.from(key, 'base64'), format: 'der', type: 'spki'});
    return crypto.verify(null, Buffer.from(bytes), pub, Buffer.from(String(signature || ''), 'base64'));
  } catch { return false; }
}

function verifyReleaseSignature(version, commit, signature, key = PUBLIC_KEY) {
  if (!/^[0-9a-f]{40}$/i.test(String(commit || ''))) return false;
  return verifySignatureBytes(`pinkie-release|v${String(version).replace(/^v/, '')}|${String(commit).toLowerCase()}`, signature, key);
}

function verifyBundleManifest(bundleRoot, key = PUBLIC_KEY) {
  if (!bundleRoot) return {ok: false, reason: '找不到安装包目录', manifest: null, manifestSha: '', info: null};
  const info = readJson(path.join(bundleRoot, 'build-info.json'));
  const manifestFile = path.join(bundleRoot, 'guard-manifest.json');
  let bytes;
  try { bytes = fs.readFileSync(manifestFile); } catch { return {ok: false, reason: '包里没有签名清单', manifest: null, manifestSha: '', info}; }
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { return {ok: false, reason: '签名清单读不出来', manifest: null, manifestSha: '', info}; }
  const manifestSha = sha256Hex(bytes);
  let sig = '';
  try { sig = fs.readFileSync(path.join(bundleRoot, 'guard-manifest.sig'), 'utf8').trim(); } catch {}
  if (sig && verifySignatureBytes(bytes, sig, key)) return {ok: true, how: 'manifest', manifest, manifestSha, info};
  const release = info?.release;
  if (release && verifyReleaseSignature(release.version, release.commit, release.signature, key)
      && manifest.commit === release.commit && String(manifest.version) === String(release.version).replace(/^v/, '')) {
    return {ok: true, how: 'release-commit', manifest, manifestSha, info};
  }
  return {ok: false, reason: sig ? '签名清单的签名不对' : '包没有官方签名', manifest, manifestSha, info};
}

function readBundleIdentity(bundleRoot, mode = {}) {
  const info = bundleRoot ? readJson(path.join(bundleRoot, 'build-info.json')) : null;
  let manifest = null;
  let manifestSha = '';
  if (bundleRoot) {
    try {
      const raw = fs.readFileSync(path.join(bundleRoot, 'guard-manifest.json'));
      manifestSha = sha256Hex(raw);
      manifest = JSON.parse(raw.toString('utf8'));
    } catch {}
  }
  return {
    channel: String(info?.channel || mode?.channel || 'release'),
    version: String(info?.version || manifest?.version || mode?.version || ''),
    commit: String(manifest?.commit || info?.commit || mode?.commit || ''),
    manifestSha: String(manifestSha || mode?.manifestSha || ''),
  };
}

function receiptMatches(record, identity) {
  if (!record || typeof record !== 'object') return false;
  const ver = String(identity?.version || '');
  const commit = String(identity?.commit || '');
  const sha = String(identity?.manifestSha || '');
  if (String(record.version || '') !== ver) return false;
  if (commit && record.commit && String(record.commit) !== commit) return false;
  if (sha && record.manifestSha && String(record.manifestSha) !== sha) return false;
  return true;
}

function modeFromWorkspaceDir(workspaceDir) {
  const base = path.basename(String(workspaceDir || '')).toLowerCase();
  if (base === 'workspace') return 'chat';
  if (base === 'workspace-project') return 'project';
  if (base === 'workspace-thinking') return 'thinking';
  if (base === 'workspace-learning') return 'learning';
  if (base === 'workspace-metre') return 'metre';
  if (base === 'workspace-unrestricted') return 'none';
  return '';
}

function counterPayload(state) {
  const events = Array.isArray(state.events) ? state.events : [];
  return [1, String(state.channel || 'release'), String(state.version || ''), String(state.commit || ''), String(state.manifestSha || ''), events.join(','), state.tamperLocked ? '1' : '0', String(state.updatedAt || '')].join('|');
}

function counterMacs(state, identity, key = PUBLIC_KEY) {
  const payload = counterPayload({...state, ...identity});
  const bundleKey = crypto.createHash('sha256')
    .update(`pinkie-guard-counter-v1|${key}|${identity.channel}|${identity.version}|${identity.commit}|${identity.manifestSha}`)
    .digest();
  const chainKey = crypto.createHash('sha256')
    .update(`pinkie-guard-chain-v1|${key}|${identity.channel}`)
    .digest();
  return {
    mac: crypto.createHmac('sha256', bundleKey).update(payload).digest('hex'),
    chainMac: crypto.createHmac('sha256', chainKey).update(payload).digest('hex'),
  };
}

function verifyCounterState(raw, identity, key = PUBLIC_KEY) {
  if (!raw || typeof raw !== 'object' || raw.schema !== 1 || !Array.isArray(raw.events)) return false;
  if (String(raw.channel || '') !== identity.channel || String(raw.version || '') !== identity.version
      || String(raw.commit || '') !== identity.commit || String(raw.manifestSha || '') !== identity.manifestSha) return false;
  const expected = counterMacs(raw, identity, key);
  return timingSafeHexEqual(raw.mac, expected.mac) && timingSafeHexEqual(raw.chainMac, expected.chainMac);
}

function signCounterState({events = [], tamperLocked = false, updatedAt = new Date().toISOString()}, identity, key = PUBLIC_KEY) {
  const base = {
    schema: 1,
    channel: String(identity.channel || 'release'),
    version: String(identity.version || ''),
    commit: String(identity.commit || ''),
    manifestSha: String(identity.manifestSha || ''),
    events: events.map(String),
    tamperLocked: Boolean(tamperLocked),
    updatedAt: String(updatedAt),
  };
  return {...base, ...counterMacs(base, base, key)};
}

function pruneEvents(events, nowMs) {
  return (Array.isArray(events) ? events : []).filter(ts => {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) && ms <= nowMs + 60_000 && nowMs - ms < STRIKE_WINDOW_MS;
  });
}

function isUpdateInProgress(pinkieStateRoot, nowMs = Date.now()) {
  if (!pinkieStateRoot) return false;
  const updatesDir = path.join(pinkieStateRoot, 'updates');
  for (const name of ['in-progress.json', 'install-in-progress.json', 'manual-update.lock']) {
    const candidate = path.join(updatesDir, name);
    try {
      const stat = fs.statSync(candidate);
      if (nowMs - stat.mtimeMs > 15 * 60 * 1000) continue;
      if (stat.isDirectory()) return true;
      const info = readJson(candidate);
      const pid = Number(info?.pid || 0);
      if (pid > 1) {
        try { process.kill(pid, 0); return true; } catch { continue; }
      }
      return true;
    } catch {}
  }
  return false;
}

// 从 OpenClaw 入口往上找包根（有 VERSION 的那一层）里的 build-info.json；
// Mac：SuperPinkie/runtime/openclaw/openclaw.mjs，Windows：…/runtime/node_modules/openclaw/openclaw.mjs。
export function findBundleRoot(entry = process.argv[1]) {
  let dir;
  try {
    const resolved = fs.realpathSync(String(entry || ''));
    dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch { return ''; }
  for (let i = 0; i < 7; i += 1) {
    if (fs.existsSync(path.join(dir, 'VERSION')) && (fs.existsSync(path.join(dir, 'build-info.json')) || fs.existsSync(path.join(dir, 'personas')))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

let cachedMode = null;
// 防护是否打开：包里存在 build-info.json 时以它为准（装了开发版覆盖正式版时不会被旧的 guard-build.json 拉回正式版）；
// 脱离包运行时才回退到插件目录里的 guard-build.json。
export function guardMode(options = {}) {
  const hasExplicitEntry = Object.prototype.hasOwnProperty.call(options, 'entry');
  const {entry = process.argv[1], pluginDir = HERE, refresh = false} = options;
  if (cachedMode && !refresh) return cachedMode;
  let bundleRoot = findBundleRoot(entry);
  if (!bundleRoot && !hasExplicitEntry) {
    for (const hint of [process.env.PINKIE_OPENCLAW_ENTRY, process.env.OPENCLAW_ROOT]) {
      if (!hint) continue;
      bundleRoot = findBundleRoot(hint);
      if (bundleRoot) break;
    }
  }
  const bundleInfoFile = bundleRoot ? path.join(bundleRoot, 'build-info.json') : '';
  let info = null;
  if (bundleInfoFile && fs.existsSync(bundleInfoFile)) {
    const value = readJson(bundleInfoFile);
    if (value && typeof value === 'object') info = {...value, guard: truthy(value.guard), source: bundleInfoFile};
  }
  if (!info) {
    const fallback = path.join(pluginDir, 'guard-build.json');
    const value = readJson(fallback);
    if (value && typeof value === 'object') {
      info = {...value, guard: truthy(value.guard), source: fallback};
      if (!bundleRoot && typeof value.bundleRoot === 'string' && value.bundleRoot && fs.existsSync(path.join(value.bundleRoot, 'build-info.json'))) {
        bundleRoot = value.bundleRoot;
      }
    }
  }
  cachedMode = {
    enabled: Boolean(info && truthy(info.guard)),
    channel: info?.channel || 'dev',
    version: info?.version || '',
    commit: info?.commit || '',
    manifestSha: info?.manifestSha || '',
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
  /(?:越狱模式|破甲|上帝模式|\bDAN\b|\bgod\s+mode\b|\bjailbreak\s+(?:mode|prompt)\b)/i,
  /(?:(?:你|碧琪)[^。\n]{0,8}(?:进入|开启|打开|切换到?|启用|激活|处于|变成)\s*(?:越狱(?:模式)?|开发者模式|无限制模式)|(?:^|[，。；！？\n\s])(?:请|现在|立刻|马上|从现在起)?(?:进入|启用|激活)\s*(?:越狱(?:模式)?|开发者模式|无限制模式))/,
  /\b(?:enter|enable|activate|switch\s+to|turn\s+on|you\s+are\s+in)\s+(?:developer\s+mode|jailbreak(?:\s+mode)?|god\s+mode|unrestricted\s+mode)\b/i,
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous|prior|above|earlier|system|safety)?\s*(?:instructions?|rules?|prompts?|guidelines?|restrictions?)/i,
  /\b(?:your\s+(?:new\s+)?(?:system\s+prompt|rules|instructions)\s+(?:are|is)\b|(?:new|override|replace|ignore|reveal|show|print|dump)\s+(?:your\s+|the\s+)?system\s+prompt\b|system\s+prompt\s*[:=])/i,
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
    this.key = options.key || PUBLIC_KEY;
    this.now = options.now || (() => new Date());
    this.blocked = [];
    this.cache = {at: 0, value: null};
    this.manifestCache = {mtimeMs: -1, trust: null};
  }
  get enabled() { return this.enabledOverride ?? this.mode.enabled; }

  trustedManifest() {
    const bundleRoot = this.mode?.bundleRoot;
    if (!bundleRoot) return {ok: false, reason: '找不到安装包目录', manifest: null, manifestSha: '', info: null};
    const manifestFile = path.join(bundleRoot, 'guard-manifest.json');
    let mtimeMs = -1;
    try { mtimeMs = fs.statSync(manifestFile).mtimeMs; } catch { return {ok: false, reason: '包里没有签名清单', manifest: null, manifestSha: '', info: null}; }
    if (this.manifestCache.trust && this.manifestCache.mtimeMs === mtimeMs) return this.manifestCache.trust;
    const trust = verifyBundleManifest(bundleRoot, this.key);
    this.manifestCache = {mtimeMs, trust};
    return trust;
  }

  // 每轮注入前核对签名清单里的哈希：不一致或被删就用安装包里的版本，不依赖磁盘上那份。
  verifyBootstrapFiles(mode, workspaceDir, files) {
    if (!this.enabled || !Array.isArray(files) || !workspaceDir) return files;
    const effectiveMode = mode || modeFromWorkspaceDir(workspaceDir);
    if (!effectiveMode || effectiveMode === 'none') return files;
    const personaMode = MODE_TO_PERSONA_DIR[effectiveMode];
    if (!personaMode) return files;
    const trust = this.trustedManifest();
    const manifest = trust.ok ? trust.manifest : null;
    if (!manifest?.files) return files;
    const bundleRoot = this.mode.bundleRoot;
    const out = [];
    for (const file of files) {
      if (!file || typeof file !== 'object') continue;
      const name = String(file.name || '');
      if (name === 'BOOTSTRAP.md' && !manifest.files[`personas/${personaMode}/BOOTSTRAP.md`]) continue;
      const rel = `personas/${personaMode}/${name}`;
      const expectedHash = manifest.files[rel];
      if (!expectedHash) {
        out.push(file);
        continue;
      }
      const currentHash = file.missing ? null : sha256Hex(Buffer.from(String(file.content || ''), 'utf8'));
      if (currentHash === expectedHash) {
        out.push(file);
        continue;
      }
      const bundleFile = path.join(bundleRoot, 'personas', personaMode, name);
      try {
        const officialBytes = fs.readFileSync(bundleFile);
        if (sha256Hex(officialBytes) === expectedHash) {
          out.push({...file, content: officialBytes.toString('utf8'), missing: false});
          continue;
        }
      } catch {}
      out.push(file);
    }
    return out;
  }

  // 读取工作区受保护的人设/手册文件时，先核对签名清单（或启动官方快照），不一致则直接取用官方副本。
  readVerifiedWorkspaceFile(mode, root, relative, maxChars = 25_600) {
    if (!root || !relative) return '';
    const requested = path.resolve(root, relative);
    const normRoot = norm(root);
    const normReq = norm(requested);
    if (normReq !== normRoot && !normReq.startsWith(normRoot + '/')) return '';
    const relPosix = relative.split(path.sep).join('/');
    let diskText = null;
    try {
      const resolved = fs.realpathSync(requested);
      const normRes = norm(resolved);
      if ((normRes === normRoot || normRes.startsWith(normRoot + '/')) && fs.statSync(resolved).isFile()) {
        diskText = fs.readFileSync(resolved, 'utf8');
      }
    } catch {}
    if (this.enabled && mode && mode !== 'none') {
      const personaMode = MODE_TO_PERSONA_DIR[mode];
      if (personaMode) {
        const trust = this.trustedManifest();
        const manifestRel = `personas/${personaMode}/${relPosix}`;
        const expectedHash = trust.ok ? trust.manifest?.files?.[manifestRel] : null;
        if (expectedHash) {
          if (diskText !== null && sha256Hex(Buffer.from(diskText, 'utf8')) === expectedHash) {
            return diskText.length <= maxChars ? diskText : `${diskText.slice(0, maxChars)}\n\n[文件超过全量加载上限，请先精简后再继续累积]`;
          }
          try {
            const officialBytes = fs.readFileSync(path.join(this.mode.bundleRoot, 'personas', personaMode, ...relPosix.split('/')));
            if (sha256Hex(officialBytes) === expectedHash) {
              const officialText = officialBytes.toString('utf8');
              return officialText.length <= maxChars ? officialText : `${officialText.slice(0, maxChars)}\n\n[文件超过全量加载上限，请先精简后再继续累积]`;
            }
          } catch {}
        }
      }
      const snap = globalThis[BASELINES]?.get(`${this.stateDir}|${this.configPath}`);
      const officialBuf = snap?.files?.get(requested) || snap?.files?.get(realish(requested));
      if (officialBuf && (diskText === null || !Buffer.from(diskText, 'utf8').equals(officialBuf))) {
        const officialText = officialBuf.toString('utf8');
        return officialText.length <= maxChars ? officialText : `${officialText.slice(0, maxChars)}\n\n[文件超过全量加载上限，请先精简后再继续累积]`;
      }
    }
    if (diskText === null) return '';
    return diskText.length <= maxChars ? diskText : `${diskText.slice(0, maxChars)}\n\n[文件超过全量加载上限，请先精简后再继续累积]`;
  }

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
      for (const sub of ['guard', 'repository', 'updates']) {
        if (within(file, path.join(this.pinkieStateRoot, sub))) return {kind: 'protected', label: '碧琪的更新和校验数据'};
      }
    }
    if (within(file, this.userSkillsDir())) return {kind: 'user-skill', rel: relativeTo(file, this.userSkillsDir())};
    for (const {dir, real} of this.workspaces()) {
      const root = within(file, dir) ? dir : within(file, real) ? real : '';
      if (!root) continue;
      const rel = relativeTo(file, root);
      if (!rel) return {kind: 'protected', label: '碧琪的工作区目录'};
      // 名单都是小写；Mac / Windows 上路径已经整体转小写，Linux 等大小写敏感的系统在这里比对小写名，结果一致。
      const key = rel.toLowerCase();
      const top = key.split('/')[0];
      if (MEMORY_FILES.has(key) || top === 'memory') return {kind: 'memory', rel};
      if (top === USER_SKILLS_DIR.toLowerCase()) return {kind: 'user-skill', rel: rel.slice(top.length + 1)};
      if (WORKSPACE_PROTECTED_FILES.has(key)) return {kind: 'protected', label: `碧琪的人设和手册（${rel}）`};
      if (WORKSPACE_PROTECTED_DIRS.includes(top)) return {kind: 'protected', label: top === 'skills' ? '碧琪自带的技能' : `碧琪的人设和手册（${top}/）`};
      return {kind: 'free'};
    }
    if (within(file, this.stateDir)) {
      const rel = relativeTo(file, this.stateDir);
      const hit = STATE_PROTECTED.find(item => item.match(rel.toLowerCase()));
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
      for (const name of ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'METHODS.md', 'AESTHETICS.md', 'BOOTSTRAP.md']) candidates.push(path.join(dir, name));
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
    return `这是${label}，正式版里不能在聊天中修改，文件没有改动。如果是要改已有模型的看图、思考开关或上下文/回复上限，请用 pinkie_model_capability 工具，或让用户在「设置 → 模型服务」里调整；用户还能改的：记忆（memory/、USER.md）、设置里的偏好、自己的模型和密钥（设置 → 模型服务）、自己的技能（写到 ${this.userSkillsDir()}）。如果是在帮用户写代码，请把文件写在用户的项目目录里。`;
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
        return decide('正式版里聊天不能修改碧琪的配置或触发更新。如果是要改已有模型的看图、思考开关或上下文/回复上限，请用 pinkie_model_capability 工具，或让用户在「设置 → 模型服务」里调整；其他模型、密钥和偏好请用户在「设置」里改；更新请用设置里的「检查更新」。');
      }
      return undefined;
    }
    if (tool === 'exec' || tool === 'bash' || tool === 'process') {
      const command = String(params.command ?? params.cmd ?? params.input ?? '');
      if (CONFIG_COMMAND.test(command)) return decide('正式版里聊天不能用命令修改碧琪的配置或触发更新。如果是要改已有模型的看图、思考开关或上下文/回复上限，请用 pinkie_model_capability 工具，或让用户在「设置 → 模型服务」里调整；其他模型、密钥和偏好请用户在「设置」里改。其它命令照常可以用。');
      const blockedManaged = blockedProductManageCommand(command, {stateDir: this.stateDir, home: this.home, skillNames: this.skillNames()});
      if (blockedManaged) return decide(blockedManaged);
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

  // ---------- exec 兜底：命令不拦，但命令跑完要是改了人设文件或配置里的产品键，当场换回 ----------
  // 11-13 隔离验收：一句「把插件 enabled 改成 false」，碧琪用 python 改了 openclaw.json，网关热加载后防护整个没了。
  // 只看产品设定（四个模式的人设/手册、openclaw.json 的产品键），用户项目和其它文件一概不管。
  baseline() {
    if (!this.enabled) return null;
    const key = `${this.stateDir}|${this.configPath}`;
    const shared = globalThis[BASELINES] ||= new Map();
    // 同一进程里插件会注册好几次；用第一次（启动校验刚换回官方版本之后）的快照，后来的实例不能拿被改过的文件当基准。
    if (shared.has(key)) return shared.get(key);
    const files = new Map();
    const dirs = [];
    const roots = this.workspaces().map(w => w.dir);
    for (const dir of roots) {
      for (const name of EXEC_WATCH_FILES) { const file = path.join(dir, name); try { files.set(file, fs.readFileSync(file)); } catch {} }
      for (const sub of EXEC_WATCH_DIRS) {
        const root = path.join(dir, sub); dirs.push(root);
        const list = []; walk(root, list, 4000);
        for (const file of list) { try { files.set(file, fs.readFileSync(file)); } catch {} }
      }
    }
    let config = null; try { config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch {}
    if (!config || typeof config !== 'object') config = this.readConfig() || {};
    const viewCtx = {stateDir: this.stateDir, home: this.home, userSkillsDir: this.userSkillsDir()};
    const snap = {files, stats: new Map([...files.keys()].map(f => [f, statKey(f)])), dirs, roots,
      // official：启动校验之后的配置（产品键以它为准）；lastGood：最近一份读得出的配置（整份坏掉时用它，保住用户后来改的偏好）。
      product: productView(config, viewCtx), official: structuredClone(config), lastGood: structuredClone(config),
      configKnown: statKey(this.configPath) !== 'missing' && Object.keys(config).length > 0, configStat: statKey(this.configPath), restores: [], unreported: []};
    shared.set(key, snap);
    return snap;
  }

  // 返回换回 / 挪走的文件列表（空 = 什么都没改）。
  verifyAfterCommand(tool = 'exec') {
    const snap = this.baseline();
    if (!snap) return [];
    if (isUpdateInProgress(this.pinkieStateRoot, this.now().getTime())) return [];
    const fixed = [];
    const fixedKinds = new Set();
    const restoreFailed = [];
    const nowDate = this.now();
    const nowIso = nowDate.toISOString();
    const stamp = nowIso.replace(/[:.]/g, '-');
    const backupRoot = this.pinkieStateRoot ? path.join(this.pinkieStateRoot, 'backups', `guard-exec-${stamp}`) : '';
    let backupUsed = false;
    const backup = (file, mode = 'copy') => {
      if (!backupRoot) { if (mode === 'move') fs.rmSync(file, {force: true, recursive: true}); return; }
      const target = path.join(backupRoot, path.relative(this.stateDir, file).replace(/^(\.\.[\\/])+/, ''));
      fs.mkdirSync(path.dirname(target), {recursive: true});
      if (mode === 'move') fs.renameSync(file, target); else fs.copyFileSync(file, target);
      backupUsed = true;
    };
    for (const [file, official] of snap.files) {
      if (statKey(file) === snap.stats.get(file)) continue;
      let now = null; try { now = fs.readFileSync(file); } catch {}
      if (now && now.equals(official)) { snap.stats.set(file, statKey(file)); continue; }
      try {
        if (now) backup(file);
        try { if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file); } catch {}
        atomicWriteFileSync(file, official);
        const verify = fs.readFileSync(file);
        if (!verify.equals(official)) throw new Error('写入后内容校验不一致');
        snap.stats.set(file, statKey(file));
        fixed.push(file);
        fixedKinds.add('persona');
      } catch (error) {
        restoreFailed.push({file, kind: 'persona', error: String(error?.message || error)});
      }
    }
    // 人设/手册目录里新冒出来的文件、工作区里新出现的 BOOTSTRAP.md（会被当设定注入）：挪进备份。
    const extras = [];
    for (const dir of snap.dirs) walk(dir, extras, 4000);
    for (const dir of snap.roots) { const file = path.join(dir, 'BOOTSTRAP.md'); if (fs.existsSync(file)) extras.push(file); }
    for (const file of extras) {
      if (snap.files.has(file)) continue;
      try {
        backup(file, 'move');
        fixed.push(file);
        fixedKinds.add(path.basename(file) === 'BOOTSTRAP.md' ? 'removed-extra' : 'persona');
      } catch (error) {
        restoreFailed.push({file, kind: 'removed-extra', error: String(error?.message || error)});
      }
    }
    // openclaw.json：只比产品键；用户改的模型、偏好原样留着。
    const configStat = statKey(this.configPath);
    if (configStat !== snap.configStat) {
      try {
        let raw = null; try { raw = fs.readFileSync(this.configPath, 'utf8'); } catch {}
        let config = null; try { config = JSON.parse(raw); } catch {}
        const baseViewCtx = {stateDir: this.stateDir, home: this.home, userSkillsDir: this.userSkillsDir()};
        const requiredAllowed = PRODUCT_PLUGIN_IDS.filter(id => Boolean(snap.official?.plugins?.entries?.[id]) || (Array.isArray(snap.official?.plugins?.allow) && snap.official.plugins.allow.includes(id)));
        const requiredAgentDeny = requiredAgentDenyMap(snap.official);
        const viewCtx = {...baseViewCtx, requiredAllowed, requiredAgentDeny};
        if (!snap.configKnown) {
          // 插件加载时还没有配置文件（Windows 第一次启动）：第一份读得出的配置就当基准，不改它。
          if (config && typeof config === 'object') Object.assign(snap, {configKnown: true, product: productView(config, baseViewCtx), official: structuredClone(config), lastGood: structuredClone(config)});
        } else if (config && typeof config === 'object' && JSON.stringify(productView(config, viewCtx)) !== JSON.stringify(snap.product)) {
          applyProductView(config, snap.official, viewCtx);
          backup(this.configPath);
          let mode = 0o600; try { mode = fs.statSync(this.configPath).mode & 0o777; } catch {}
          atomicWriteFileSync(this.configPath, JSON.stringify(config, null, 2) + '\n', {mode});
          fixed.push(this.configPath);
          fixedKinds.add('config');
        } else if (!config || typeof config !== 'object') {
          // 删掉或改成读不出来的样子：整份换回快照（快照就是启动校验之后的官方配置 + 当时的用户设置）。
          if (raw !== null) backup(this.configPath);
          atomicWriteFileSync(this.configPath, JSON.stringify(snap.lastGood, null, 2) + '\n', {mode: 0o600});
          fixed.push(this.configPath);
          fixedKinds.add('config');
        }
        if (snap.configKnown && config && typeof config === 'object') snap.lastGood = structuredClone(config);
        this.cache = {at: 0, value: null};
      } catch (error) {
        restoreFailed.push({file: this.configPath, kind: 'config', error: String(error?.message || error)});
      }
      snap.configStat = statKey(this.configPath);
    }
    if (fixed.length || restoreFailed.length) {
      this.recordRuntimeOutcome({snap, tool, fixed, fixedKinds, restoreFailed, backup: backupUsed ? backupRoot : '', nowDate, nowIso});
    }
    return fixed;
  }

  hasCounterReceipt(identity, startupStatus = null) {
    if (!this.pinkieStateRoot) return false;
    const status = startupStatus ?? readJson(path.join(this.pinkieStateRoot, 'guard', 'status.json'));
    if (Number(status?.counterSchema) >= 1 && receiptMatches(status, identity)) {
      return true;
    }
    const receipt = readJson(path.join(this.stateDir, 'guard-receipt.json'));
    if (Number(receipt?.schema) >= 1 && receiptMatches(receipt, identity)) {
      return true;
    }
    for (const id of PRODUCT_PLUGIN_IDS) {
      const mark = readJson(path.join(this.stateDir, 'extensions', id, 'guard-build.json'));
      if (mark?.counterReady === true && receiptMatches(mark, identity)) return true;
    }
    return false;
  }

  recordRuntimeOutcome({snap, tool, fixed, fixedKinds, restoreFailed, backup, nowDate, nowIso}) {
    const categories = [...fixedKinds].map(k => CATEGORY_LABELS[k] || '设定文件');
    const event = {
      at: nowIso,
      tool,
      restored: fixed.map(f => path.relative(this.stateDir, f) || f),
      restoreFailed: restoreFailed.length,
      categories,
      backup,
    };
    if (fixed.length) {
      snap.restores.push(event);
      snap.unreported.push(...fixed.map(file => ({file, at: nowDate.getTime()})));
      if (snap.restores.length > 20) snap.restores.splice(0, snap.restores.length - 20);
      this.record({toolName: tool}, `命令改了 ${fixed.length} 个设定文件，已换回`);
    }
    if (!this.pinkieStateRoot) return;
    const guardDir = path.join(this.pinkieStateRoot, 'guard');
    try { fs.mkdirSync(guardDir, {recursive: true}); } catch {}
    try {
      fs.appendFileSync(path.join(guardDir, 'guard.log'), JSON.stringify({...event, kind: restoreFailed.length ? 'exec-restore-failed' : 'exec-restore'}) + '\n');
    } catch {}

    const identity = readBundleIdentity(this.mode.bundleRoot, this.mode);
    const statusFile = path.join(guardDir, 'status.json');
    const previousStatus = readJson(statusFile);
    const counterFile = path.join(guardDir, 'counter.json');
    const counterRaw = readJson(counterFile);
    const hasCounterFile = fs.existsSync(counterFile);
    const receipt = this.hasCounterReceipt(identity, previousStatus);

    let counterTampered = false;
    let priorEvents = [];
    if (!hasCounterFile) {
      if (receipt) counterTampered = true;
    } else if (verifyCounterState(counterRaw, identity, this.key)) {
      priorEvents = pruneEvents(counterRaw.events, nowDate.getTime());
    } else {
      counterTampered = true;
    }

    const hasFailedRestore = restoreFailed.length > 0;
    let nextEvents = priorEvents;
    let tamperLocked = Boolean(counterRaw?.tamperLocked && verifyCounterState(counterRaw, identity, this.key));
    if (counterTampered) {
      nextEvents = [...priorEvents];
      while (nextEvents.length < STRIKE_LIMIT) nextEvents.push(nowIso);
      tamperLocked = true;
    } else if (!hasFailedRestore && fixed.length > 0) {
      nextEvents = [...priorEvents, nowIso];
      if (nextEvents.length >= STRIKE_LIMIT) tamperLocked = true;
    } else if (nextEvents.length < STRIKE_LIMIT) {
      tamperLocked = false;
    }
    const strikesIn24h = nextEvents.length;
    const limitReached = counterTampered || (!hasFailedRestore && fixed.length > 0 && strikesIn24h >= STRIKE_LIMIT);

    try {
      const counterOut = signCounterState({events: nextEvents, tamperLocked, updatedAt: nowIso}, identity, this.key);
      atomicWriteFileSync(counterFile, JSON.stringify(counterOut, null, 2) + '\n');
    } catch {}

    try {
      const history = Array.isArray(previousStatus?.history) ? previousStatus.history : [];
      history.push({
        at: nowIso,
        source: 'runtime',
        tool,
        restored: fixed.length,
        restoreFailed: restoreFailed.length,
        configFixed: fixed.includes(this.configPath) ? ['openclaw.json'] : [],
        categories,
        counterTampered,
        strikesIn24h,
        backup,
      });
      const updatedStatus = {
        ...(previousStatus || {}),
        at: nowIso,
        version: identity.version,
        commit: identity.commit,
        manifestSha: identity.manifestSha,
        counterSchema: 1,
        strikesIn24h,
        limitReached,
        counterTampered,
        restoreFailed: hasFailedRestore ? restoreFailed : (previousStatus?.restoreFailed || []),
        backup: backup || previousStatus?.backup || '',
        history: history.slice(-20),
      };
      atomicWriteFileSync(statusFile, JSON.stringify(updatedStatus, null, 2) + '\n');
    } catch {}

    try {
      const alertFile = path.join(guardDir, 'pending-alert.json');
      const existingAlert = readJson(alertFile);
      const alertPayload = {
        id: crypto.randomUUID(),
        source: 'runtime',
        at: nowIso,
        categories,
        backup,
        count: strikesIn24h,
        limit: STRIKE_LIMIT,
        limitReached,
        counterTampered,
        restoreFailed: hasFailedRestore,
        failedCount: restoreFailed.length,
        nonOfficial: false,
      };
      if (!existingAlert?.limitReached || alertPayload.limitReached) {
        atomicWriteFileSync(alertFile, JSON.stringify(alertPayload, null, 2) + '\n');
      }
    } catch {}
  }

  takeUnreported() {
    const snap = this.enabled ? globalThis[BASELINES]?.get(`${this.stateDir}|${this.configPath}`) : null;
    if (!snap?.unreported?.length) return [];
    // 只报最近两分钟换回的（文件监视换回的可能不是这条命令干的，太久以前的就不往这条结果里写了）。
    const recent = snap.unreported.splice(0).filter(item => Date.now() - item.at < 120_000).map(item => item.file);
    return [...new Set(recent)];
  }

  execNote(fixed) {
    const names = fixed.map(f => path.relative(this.stateDir, f) || f).slice(0, 6).join('、');
    return `【碧琪设定防护】这条命令改动了碧琪的产品设定（${names}${fixed.length > 6 ? ' 等' : ''}），正式版里不允许，已经换回官方版本（改动前的文件备份在 ${this.pinkieStateRoot ? path.join(this.pinkieStateRoot, 'backups') : '备份目录'}）。如实告诉用户这件事没有做成；要改已有模型的看图、思考开关或上下文/回复上限请用 pinkie_model_capability 工具或让用户在「设置 → 模型服务」里调整；用户还能改的是记忆、设置里的偏好、自己的模型和密钥、自己的技能（${this.userSkillsDir()}）。命令的其它效果不受影响。`;
  }

  // 文件监视：命令写完设定后不退出（sleep、后台进程）时，after 钩子来不及——配置热加载会先把插件卸掉。
  // 11-13 隔离验收里碧琪用「写完 sleep 2 秒」绕过了命令后检查。监视到改动就马上换回，赶在热加载（约 0.7 秒）之前。
  watch({delay = 80} = {}) {
    const snap = this.baseline();
    if (!snap || snap.watchers) return snap?.watchers || [];
    snap.watchers = [];
    let timer = null;
    const kick = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; try { this.verifyAfterCommand('watch'); } catch {} }, delay);
      timer.unref?.();
    };
    const add = (dir, opts, filter) => {
      try {
        const watcher = fs.watch(dir, {persistent: false, ...opts}, (type, name) => { if (!filter || !name || filter(String(name))) kick(); });
        watcher.on?.('error', () => {});
        snap.watchers.push(watcher);
      } catch {}
    };
    const configName = path.basename(this.configPath);
    add(path.dirname(this.configPath), {}, name => name === configName);
    const rootNames = new Set([...EXEC_WATCH_FILES, 'BOOTSTRAP.md']);
    for (const dir of snap.roots) add(dir, {}, name => rootNames.has(name));
    for (const dir of snap.dirs) if (fs.existsSync(dir)) add(dir, {recursive: true}, name => !path.basename(name).includes('.guard-'));
    return snap.watchers;
  }

  status() {
    let startup = null;
    let counter = null;
    if (this.pinkieStateRoot) {
      startup = readJson(path.join(this.pinkieStateRoot, 'guard', 'status.json'));
      counter = readJson(path.join(this.pinkieStateRoot, 'guard', 'counter.json'));
    }
    const nowMs = this.now().getTime();
    const identity = readBundleIdentity(this.mode.bundleRoot, this.mode);
    let strikesIn24h = Number(startup?.strikesIn24h || 0);
    let counterTampered = Boolean(startup?.counterTampered);
    if (this.enabled) {
      if (counter) {
        if (verifyCounterState(counter, identity, this.key)) {
          strikesIn24h = pruneEvents(counter.events, nowMs).length;
          counterTampered = Boolean(counter.tamperLocked && strikesIn24h >= STRIKE_LIMIT && counterTampered);
        } else {
          counterTampered = true;
        }
      } else if (this.pinkieStateRoot && this.hasCounterReceipt(identity, startup)) {
        counterTampered = true;
      }
    }
    let nonOfficial = Boolean(startup?.nonOfficial);
    if (this.enabled && this.mode.bundleRoot && fs.existsSync(path.join(this.mode.bundleRoot, 'guard-manifest.json'))) {
      if (!this.trustedManifest().ok) nonOfficial = true;
    }
    // 「被修改过」看历史：哪次启动或运行中换回过文件、修过配置、发现不是官方包或校验出错，都留着标记，方便排查反馈。
    const history = Array.isArray(startup?.history) ? startup.history : [];
    const execRestores = this.enabled ? (globalThis[BASELINES]?.get(`${this.stateDir}|${this.configPath}`)?.restores || []) : [];
    const lastHistory = history.length ? history[history.length - 1] : null;
    const lastExec = execRestores.length ? execRestores[execRestores.length - 1] : null;
    const lastChange = lastExec && (!lastHistory || Date.parse(lastExec.at) >= Date.parse(lastHistory.at || 0))
      ? {...lastExec, source: 'runtime', restored: Array.isArray(lastExec.restored) ? lastExec.restored.length : Number(lastExec.restored || 0)}
      : lastHistory;
    const restoreFailedCount = Array.isArray(startup?.restoreFailed) ? startup.restoreFailed.length : 0;
    const modified = Boolean(execRestores.length || counterTampered || restoreFailedCount || (startup && (history.length || startup.nonOfficial || startup.error)));
    return {
      enabled: this.enabled, channel: this.mode.channel, version: this.mode.version,
      userSkillsDir: this.userSkillsDir(),
      startup, modified, lastChange, error: startup?.error ? String(startup.error) : '', nonOfficial,
      strikesIn24h, strikeLimit: STRIKE_LIMIT, limitReached: strikesIn24h >= STRIKE_LIMIT || counterTampered,
      counterTampered, restoreFailedCount,
      recentBlocks: this.blocked.slice(-10), execRestores: execRestores.slice(-10),
    };
  }
}

export function readVerifiedBundleFile(mode, root, relative, {entry = process.argv[1], maxChars = 25_600} = {}) {
  const m = guardMode({entry});
  if (!m.enabled || !m.bundleRoot) {
    try { return fs.readFileSync(path.join(root, relative), 'utf8'); } catch { return ''; }
  }
  const guard = new SettingsGuard({mode: m});
  return guard.readVerifiedWorkspaceFile(mode, root, relative, maxChars);
}

// exec 兜底看哪些：人设/手册（几十到一百多个小文件，约 2 MB）。自带技能和插件代码由下次启动校验换回。
const EXEC_WATCH_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'METHODS.md', 'AESTHETICS.md'];
const EXEC_WATCH_DIRS = ['persona', 'playbooks'];
const BASELINES = Symbol.for('pinkie.settingsGuard.baselines');
const PRODUCT_PLUGIN_IDS = ['pinkie-mode-architecture', 'pinkie-project-scope', 'pinkie-first-person-renderer'];
const REQUIRED_AGENT_DENY = ['skill_workshop'];
function requiredAgentDenyMap(config = {}) {
  const out = {};
  for (const agent of Array.isArray(config.agents?.list) ? config.agents.list : []) {
    if (!PRODUCT_AGENTS.includes(agent?.id)) continue;
    const hasTools = Boolean(agent.tools && typeof agent.tools === 'object');
    out[agent.id] = hasTools ? [...REQUIRED_AGENT_DENY] : [];
  }
  return out;
}
function statKey(file) {
  try { const s = fs.lstatSync(file); return `${s.isSymbolicLink() ? 'L' : ''}${s.size}:${s.mtimeMs}:${s.ino}`; } catch { return 'missing'; }
}
function isOfficialPluginPath(raw, stateDir, home = os.homedir()) {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const resolved = path.resolve(expandHome(raw, home));
  const extRoot = path.resolve(path.join(stateDir, 'extensions'));
  return resolved === extRoot || resolved.startsWith(extRoot + path.sep) || /SuperPinkie[\\/]services[\\/]/.test(raw) || /超級碧琪\.app/.test(raw);
}
function shadowsProductPlugin(raw, stateDir, home = os.homedir()) {
  if (typeof raw !== 'string' || !raw.trim() || isOfficialPluginPath(raw, stateDir, home)) return false;
  const resolved = path.resolve(expandHome(raw, home));
  const manifests = [path.join(resolved, 'openclaw.plugin.json')];
  try {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) manifests.push(path.join(path.dirname(resolved), 'openclaw.plugin.json'));
    else if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved, {withFileTypes: true}).slice(0, 200)) {
        if (entry.isDirectory()) manifests.push(path.join(resolved, entry.name, 'openclaw.plugin.json'));
      }
    }
  } catch { return false; }
  for (const file of manifests) {
    const data = readJson(file);
    if (data && PRODUCT_PLUGIN_IDS.includes(String(data.id || ''))) return true;
  }
  return false;
}
function sameResolvedPath(a, b, home = os.homedir()) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.trim() || !b.trim()) return false;
  return norm(path.resolve(expandHome(a, home))) === norm(path.resolve(expandHome(b, home)));
}
// openclaw.json 的产品键（和 installer/guard/guard.mjs 的 repairConfig 管的是同一批）。
function productView(config = {}, {stateDir = '', home = os.homedir(), userSkillsDir = '', requiredAllowed = null, requiredAgentDeny = null} = {}) {
  const plugins = config.plugins || {};
  const agents = {};
  for (const agent of Array.isArray(config.agents?.list) ? config.agents.list : []) {
    if (!PRODUCT_AGENTS.includes(agent?.id)) continue;
    const hasTools = Boolean(agent.tools && typeof agent.tools === 'object');
    const deny = Array.isArray(agent.tools?.deny) ? agent.tools.deny : [];
    const mustDeny = requiredAgentDeny
      ? (Array.isArray(requiredAgentDeny[agent.id]) && requiredAgentDeny[agent.id].length
        ? requiredAgentDeny[agent.id]
        : (hasTools ? REQUIRED_AGENT_DENY : []))
      : [];
    agents[agent.id] = {
      workspace: agent.workspace ?? null,
      contextInjection: agent.contextInjection ?? null,
      missingToolsDeny: mustDeny.filter(name => !deny.includes(name)),
    };
  }
  const loadPaths = Array.isArray(plugins.load?.paths) ? plugins.load.paths : null;
  const extraDirs = Array.isArray(config.skills?.load?.extraDirs) ? config.skills.load.extraDirs : null;
  const mustAllow = Array.isArray(requiredAllowed)
    ? requiredAllowed
    : PRODUCT_PLUGIN_IDS.filter(id => Boolean(plugins.entries?.[id]) || (Array.isArray(plugins.allow) && plugins.allow.includes(id)));
  return {
    enabled: plugins.enabled ?? null,
    productDenied: Array.isArray(plugins.deny) ? plugins.deny.filter(id => PRODUCT_PLUGIN_IDS.includes(id)) : [],
    missingProductAllow: Array.isArray(plugins.allow) ? mustAllow.filter(id => !plugins.allow.includes(id)) : [],
    officialPaths: loadPaths ? loadPaths.filter(p => isOfficialPluginPath(p, stateDir, home)) : null,
    shadowingPaths: loadPaths ? loadPaths.filter(p => shadowsProductPlugin(p, stateDir, home)) : [],
    // 插件开关 + 钩子授权（授权被删，OpenClaw 会挡掉碧琪的对话钩子）。
    entries: Object.fromEntries(PRODUCT_PLUGIN_IDS.map(id => {
      const entry = plugins.entries?.[id];
      if (!entry) return [id, 'absent'];
      return [id, {enabled: entry.enabled ?? null, prompt: entry.hooks?.allowPromptInjection ?? null, conversation: entry.hooks?.allowConversationAccess ?? null}];
    })),
    agents, hooksInternal: config.hooks?.internal ?? null,
    hasUserSkillsDir: extraDirs && userSkillsDir ? extraDirs.some(p => sameResolvedPath(p, userSkillsDir, home)) : null,
  };
}
function applyProductView(config, official, ctx = {}) {
  const {stateDir = '', home = os.homedir(), userSkillsDir = ''} = ctx;
  const requiredAllowed = PRODUCT_PLUGIN_IDS.filter(id => Boolean(official?.plugins?.entries?.[id]) || (Array.isArray(official?.plugins?.allow) && official.plugins.allow.includes(id)));
  const requiredAgentDeny = requiredAgentDenyMap(official);
  const want = productView(official, {...ctx, requiredAllowed, requiredAgentDeny});
  const put = (obj, key, value) => { if (value === null || value === undefined) delete obj[key]; else obj[key] = structuredClone(value); };
  const plugins = config.plugins && typeof config.plugins === 'object' ? config.plugins : (config.plugins = {});
  put(plugins, 'enabled', want.enabled);
  if (Array.isArray(plugins.deny)) plugins.deny = plugins.deny.filter(id => !PRODUCT_PLUGIN_IDS.includes(id));
  if (Array.isArray(plugins.allow)) {
    for (const id of requiredAllowed) if (!plugins.allow.includes(id)) plugins.allow.push(id);
  }
  if (want.officialPaths !== null || Array.isArray(plugins.load?.paths)) {
    plugins.load = plugins.load && typeof plugins.load === 'object' ? plugins.load : {};
    const existing = Array.isArray(plugins.load.paths) ? plugins.load.paths : [];
    const keptUser = existing.filter(p => typeof p === 'string' && p.trim() && !isOfficialPluginPath(p, stateDir, home) && !shadowsProductPlugin(p, stateDir, home));
    const merged = [...(want.officialPaths || [])];
    for (const p of keptUser) if (!merged.some(cur => sameResolvedPath(cur, p, home))) merged.push(p);
    plugins.load.paths = merged;
  }
  for (const id of PRODUCT_PLUGIN_IDS) {
    const value = want.entries[id];
    if (value === 'absent') continue;
    plugins.entries = plugins.entries && typeof plugins.entries === 'object' ? plugins.entries : {};
    if (!plugins.entries[id] || typeof plugins.entries[id] !== 'object') plugins.entries[id] = structuredClone(official.plugins.entries[id]);
    const entry = plugins.entries[id];
    put(entry, 'enabled', value.enabled);
    if (value.prompt !== null || value.conversation !== null) {
      entry.hooks = entry.hooks && typeof entry.hooks === 'object' ? entry.hooks : {};
      put(entry.hooks, 'allowPromptInjection', value.prompt); put(entry.hooks, 'allowConversationAccess', value.conversation);
    }
  }
  const list = Array.isArray(config.agents?.list) ? config.agents.list : null;
  for (const [id, values] of Object.entries(want.agents)) {
    let agent = list?.find(a => a?.id === id);
    if (!agent) {
      // 产品模式整条被删了：从快照里放回去。
      config.agents = config.agents && typeof config.agents === 'object' ? config.agents : {};
      config.agents.list = Array.isArray(config.agents.list) ? config.agents.list : [];
      config.agents.list.push(structuredClone(official.agents.list.find(a => a?.id === id)));
      continue;
    }
    put(agent, 'workspace', values.workspace); put(agent, 'contextInjection', values.contextInjection);
    // 禁用工具清单：和启动校验一致，只守住必须禁用的内部项（skill_workshop），保留用户自己加减的禁用项。
    const mustDeny = Array.isArray(requiredAgentDeny[id]) && requiredAgentDeny[id].length
      ? requiredAgentDeny[id]
      : (agent.tools && typeof agent.tools === 'object' ? REQUIRED_AGENT_DENY : []);
    if (mustDeny.length) {
      agent.tools = agent.tools && typeof agent.tools === 'object' ? agent.tools : {};
      const deny = Array.isArray(agent.tools.deny) ? agent.tools.deny : (agent.tools.deny = []);
      for (const name of mustDeny) if (!deny.includes(name)) deny.push(name);
    }
  }
  if (want.hooksInternal !== null) { config.hooks = config.hooks || {}; config.hooks.internal = structuredClone(want.hooksInternal); }
  else if (config.hooks) delete config.hooks.internal;
  if (want.hasUserSkillsDir && userSkillsDir) {
    config.skills = config.skills && typeof config.skills === 'object' ? config.skills : {};
    config.skills.load = config.skills.load && typeof config.skills.load === 'object' ? config.skills.load : {};
    const existing = Array.isArray(config.skills.load.extraDirs) ? config.skills.load.extraDirs.filter(p => typeof p === 'string' && p.trim()) : [];
    if (!existing.some(p => sameResolvedPath(p, userSkillsDir, home))) existing.push(userSkillsDir);
    config.skills.load.extraDirs = existing;
  }
}

function walk(dir, out, limit) {
  let entries;
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name.includes('.guard-')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, limit); else if (entry.isFile()) out.push(full);
  }
}

// 改 openclaw 配置 / 更新的命令（一律拦）；插件与技能管理命令按目标区分，只拦碧琪自带的、放开用户自己的。
const CONFIG_COMMAND = /\bopenclaw(?:\.mjs|\.cmd)?["']?\s+(?:--[\w-]+(?:[ =]\S+)?\s+)*(?:config\s+(?:set|unset|apply|patch|edit|reset)\b|gateway\s+call\s+(?:config\.(?:apply|patch|set)|update\.run)\b|update\b)/i;
const PRODUCT_MANAGE_RE = /\bopenclaw(?:\.mjs|\.cmd)?["']?\s+(?:--[\w-]+(?:[ =]\S+)?\s+)*(plugins?|skills)\s+(disable|uninstall|remove|install|enable|update)\b([^;\r\n|&]*)/gi;
const PRODUCT_PLUGIN_PATTERNS = [
  ...PRODUCT_PLUGIN_IDS,
  'mode-architecture', 'project-scope', 'first-person-renderer',
];

function splitShellTokens(segment = '') {
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function blockedProductManageCommand(command = '', {stateDir = '', home = os.homedir(), skillNames = new Set()} = {}) {
  const text = String(command || '');
  for (const match of text.matchAll(PRODUCT_MANAGE_RE)) {
    const kind = match[1].toLowerCase().startsWith('plugin') ? 'plugin' : 'skill';
    const segment = String(match[3] || '');
    const tokens = splitShellTokens(segment);
    const unsafeExpansion = /[$`*?]/.test(segment) || tokens.some(t => /^(-a|--all)$/i.test(t));
    const targets = tokens.filter(t => t && !t.startsWith('-'));
    if (unsafeExpansion || !targets.length) {
      return '这条命令目标不明确或带通配符，可能会影响到碧琪自带的插件或技能。请写出具体的第三方插件或技能名再操作。';
    }
    if (kind === 'plugin') {
      const hitsProduct = targets.some(raw => {
        const lower = raw.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
        const base = path.posix.basename(lower);
        if (PRODUCT_PLUGIN_IDS.includes(lower) || PRODUCT_PLUGIN_IDS.includes(base)) return true;
        if (/(?:^|\/)(?:services|extensions)\/(?:pinkie-)?(?:mode-architecture|project-scope|first-person-renderer)$/.test(lower)) return true;
        if (PRODUCT_PLUGIN_PATTERNS.some(id => lower === id)) return true;
        return shadowsProductPlugin(raw, stateDir, home);
      });
      if (hitsProduct) {
        return '这是碧琪自带的核心插件，正式版里不能停用、卸载或覆盖；用户自己装的第三方插件可以照常安装、启停或卸载。';
      }
    } else {
      const hitsSkill = targets.some(raw => {
        const lower = raw.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
        const base = path.posix.basename(lower).replace(/\.md$/i, '');
        return skillNames.has(lower) || skillNames.has(base);
      });
      if (hitsSkill) {
        return '这是碧琪自带的技能，正式版里不能停用、删除或覆盖；用户自己装的技能可以照常管理。';
      }
    }
  }
  return '';
}

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
  // exec 兜底：插件一加载就记下官方快照（启动校验刚跑完）；命令结果落进记录时同步检查、换回，并在结果里写明。
  // tool_result_persist 是同步钩子，赶在配置热加载（约 0.5 秒防抖）之前把产品键改回去；after_tool_call 再查一次兜底。
  const COMMAND_TOOLS = new Set(['exec', 'bash', 'process']);
  try { guard.baseline(); } catch {}
  try { if (guard.enabled && options.watch !== false) guard.watch(); } catch {}
  api.on?.('tool_result_persist', (event = {}) => {
    try {
      const tool = String(event.toolName || event.message?.toolName || '');
      if (!guard.enabled || !COMMAND_TOOLS.has(tool)) return undefined;
      guard.verifyAfterCommand(tool);
      if (!event.message) return undefined;
      const fixed = guard.takeUnreported();
      if (!fixed.length) return undefined;
      const message = {...event.message};
      const note = {type: 'text', text: guard.execNote(fixed)};
      message.content = Array.isArray(message.content) ? [...message.content, note] : [{type: 'text', text: String(message.content ?? '')}, note];
      return {message};
    } catch { return undefined; }
  }, {priority: 100000});
  api.on?.('after_tool_call', (event = {}) => {
    try { if (guard.enabled && COMMAND_TOOLS.has(String(event.toolName || ''))) guard.verifyAfterCommand(String(event.toolName)); } catch {}
  });
  api.registerGatewayMethod?.('pinkie.guard.status', ({respond}) => {
    try { respond(true, guard.status()); } catch (error) { respond(false, undefined, {code: 'guard_status_failed', message: String(error?.message || error)}); }
  });
  return guard;
}
