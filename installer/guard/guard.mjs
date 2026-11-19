#!/usr/bin/env node
// 产品设定防护：签名清单 + 启动校验恢复 + 更新验签（Mac / Windows 共用，用包里自带的 node 跑）。
//
//   node guard.mjs startup [--bundle DIR] [--home DIR] [--state-dir DIR] [--app-state DIR]
//        正式版（包里 build-info.json 的 guard 为 true）才做事：验清单签名、查包里的文件、
//        把被改过的人设/手册/插件/自带技能换回包里的官方版本（先备份），openclaw.json 只修产品键，
//        结果写到 <app-state>/guard/status.json。开发版直接退出，什么都不写。
//   node guard.mjs manifest DIR [--commit SHA]     生成 DIR/guard-manifest.json（打包时）
//   node guard.mjs sign DIR KEY.pem                签清单 → DIR/guard-manifest.sig（只在 CI，私钥在 Actions secrets）
//   node guard.mjs sign-release VERSION COMMIT KEY.pem   打印发布签名（写进 latest.json）
//   node guard.mjs verify-release VERSION COMMIT SIG     更新前验签：退出码 0 = 通过
//   node guard.mjs sign-latest latest.json KEY.pem       给 latest.json 加发布签名 + 安装包哈希签名（CI mirror-publish）
//   node guard.mjs verify-latest latest.json [--asset NAME --sha256 HEX] [--commit SHA]
//        更新前验 latest.json：签名对、（给了的话）安装包哈希和提交都在签名覆盖范围内。退出码 0 = 通过
//
// 只用 node 自带模块。私钥永远不进仓库和安装包；包里只有下面的公钥。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PUBLIC_KEY = 'MCowBQYDK2VwAyEAcejSsqLWnO2o0lFTrm+Lh22s8Qi5XSfTGX4GnQTgnOs=';
export const STRIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STRIKE_LIMIT = 3;
export const CATEGORY_LABELS = Object.freeze({
  persona: '人设和工作手册',
  plugin: '模式功能文件',
  skill: '内置技能',
  'user-skill-disabled': '与内置技能同名的自建技能',
  'removed-extra': '额外加入的设定文件',
  config: '基础运行配置',
});
const CORE_PERSONA_NAMES = new Set(['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'METHODS.md', 'AESTHETICS.md']);
const PROVENANCE_START = '\u2063\u200B\u2063';
const PROVENANCE_END = '\u2063\u200D\u2063';
const PROVENANCE_DIGITS = ['\u200B', '\u200C', '\u200D', '\u2060'];
const PROVENANCE_STRIP_RE = /\u2063\u200B\u2063[\u200B\u200C\u200D\u2060]+\u2063\u200D\u2063/g;
const PROVENANCE_FILES = new Set(['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'METHODS.md', 'AESTHETICS.md']);
const PROVENANCE_MODES = ['chat', 'project', 'thinking', 'learning', 'metre'];
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 清单覆盖的包内目录（runtime/ 很大，由系统代码签名管）。
const MANIFEST_ROOTS = ['VERSION', 'build-info.json', 'personas', 'services', 'installer', 'bundled-skills', 'skills', 'ui'];
// 模式 → 工作区；neutral（无限制模式）归用户，DREAMS.md 是碧琪自己写的梦，都不恢复（沿用 sync-personas 的规则）。
const MODE_WORKSPACES = {chat: 'workspace', project: 'workspace-project', thinking: 'workspace-thinking', learning: 'workspace-learning', metre: 'workspace-metre'};
const KEEP_NAMES = new Set(['DREAMS.md']);
// 插件：已装目录 ← 包里的源目录。
const PLUGINS = {'pinkie-mode-architecture': 'services/mode-architecture', 'pinkie-project-scope': 'services/project-scope', 'pinkie-first-person-renderer': 'services/first-person-renderer'};
const REQUIRED_PLUGIN_FILES = {'pinkie-mode-architecture': new Set(['index.mjs', 'settings-guard.mjs', 'metre-lock.mjs', 'metre-lock-hash.json'])};
const PRODUCT_PLUGIN_IDS = Object.keys(PLUGINS);
const HOOK_GRANT_PLUGINS = new Set(['pinkie-mode-architecture', 'pinkie-project-scope']);
const PRODUCT_AGENTS = {main: 'workspace', project: 'workspace-project', thinking: 'workspace-thinking', learning: 'workspace-learning', metre: 'workspace-metre'};
// 这些名字的文件放进工作区就会被 OpenClaw 当设定注入；包里没有就不该出现。
const INJECTED_EXTRAS = ['BOOTSTRAP.md'];

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hashFile = file => { try { return sha256(fs.readFileSync(file)); } catch { return null; } };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const posix = rel => rel.split(path.sep).join('/');

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === '__pycache__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function buildManifest(bundle, {commit = ''} = {}) {
  const files = {};
  for (const root of MANIFEST_ROOTS) {
    const full = path.join(bundle, root);
    const list = fs.existsSync(full) && fs.statSync(full).isFile() ? [full] : walk(full);
    for (const file of list) files[posix(path.relative(bundle, file))] = hashFile(file);
  }
  const version = (() => { try { return fs.readFileSync(path.join(bundle, 'VERSION'), 'utf8').trim(); } catch { return ''; } })();
  return {schema: 1, version, commit, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))};
}

const publicKey = (pem = PUBLIC_KEY) => crypto.createPublicKey({key: Buffer.from(pem, 'base64'), format: 'der', type: 'spki'});
export function signBytes(bytes, keyPem) { return crypto.sign(null, Buffer.from(bytes), crypto.createPrivateKey(keyPem)).toString('base64'); }
export function verifyBytes(bytes, signature, key = PUBLIC_KEY) {
  try { return crypto.verify(null, Buffer.from(bytes), publicKey(key), Buffer.from(String(signature || ''), 'base64')); } catch { return false; }
}
export const releasePayload = (version, commit) => `pinkie-release|v${String(version).replace(/^v/, '')}|${String(commit).toLowerCase()}`;
export const verifyRelease = (version, commit, signature, key = PUBLIC_KEY) => /^[0-9a-f]{40}$/i.test(String(commit)) && verifyBytes(releasePayload(version, commit), signature, key);

// 安装包哈希签名：版本 + 提交 + 每个文件名=sha256（按文件名排序），一份签名覆盖整套发布文件。
export function assetsPayload(version, commit, assets) {
  const lines = Object.keys(assets || {}).sort().map(name => `${name}=${String(assets[name]?.sha256 || '').toLowerCase()}`);
  return `pinkie-assets|v${String(version).replace(/^v/, '')}|${String(commit).toLowerCase()}\n${lines.join('\n')}`;
}
export function signLatest(latest, keyPem) {
  if (!/^[0-9a-f]{40}$/i.test(String(latest?.commit || ''))) throw new Error('latest.json 缺少发布提交（commit）');
  if (!latest.assets || !Object.keys(latest.assets).length) throw new Error('latest.json 没有安装包');
  return {...latest, signature: signBytes(releasePayload(latest.version, latest.commit), keyPem),
    assetsSignature: signBytes(assetsPayload(latest.version, latest.commit, latest.assets), keyPem)};
}
// 返回 {ok, reason}。asset/sha256：要装的那个文件必须在签名覆盖的清单里且哈希一致；commit：要装的提交必须就是签名里的。
export function verifyLatest(latest, {asset, sha256, commit, key = PUBLIC_KEY} = {}) {
  if (!latest || typeof latest !== 'object') return {ok: false, reason: '版本清单读不出来'};
  const version = String(latest.version || '');
  if (!latest.signature || !latest.commit) return {ok: false, reason: '版本清单没有官方签名'};
  if (!verifyRelease(version, latest.commit, latest.signature, key)) return {ok: false, reason: '版本清单的签名不对'};
  if (commit && String(commit).toLowerCase() !== String(latest.commit).toLowerCase()) return {ok: false, reason: '要装的提交和签名里的不一致'};
  if (asset || sha256) {
    if (!latest.assetsSignature || !verifyBytes(assetsPayload(version, latest.commit, latest.assets || {}), latest.assetsSignature, key)) return {ok: false, reason: '安装包清单的签名不对'};
    const entry = latest.assets?.[asset];
    if (!entry || String(entry.sha256 || '').toLowerCase() !== String(sha256 || '').toLowerCase()) return {ok: false, reason: '安装包的哈希不在签名清单里'};
  }
  return {ok: true, reason: ''};
}

// 包是不是官方签过的：CI 打的包验清单签名；Mac 用 git 更新、在本机打的包验「发布提交签名」（更新时已验过一次）。
export function bundleTrust(bundle, info, key = PUBLIC_KEY) {
  const manifestFile = path.join(bundle, 'guard-manifest.json');
  let bytes; try { bytes = fs.readFileSync(manifestFile); } catch { return {ok: false, reason: '包里没有签名清单', manifest: null}; }
  let manifest; try { manifest = JSON.parse(bytes); } catch { return {ok: false, reason: '签名清单读不出来', manifest: null}; }
  let sig = ''; try { sig = fs.readFileSync(path.join(bundle, 'guard-manifest.sig'), 'utf8').trim(); } catch {}
  if (sig && verifyBytes(bytes, sig, key)) return {ok: true, how: 'manifest', manifest};
  const release = info?.release;
  if (release && verifyRelease(release.version, release.commit, release.signature, key) && manifest.commit === release.commit
      && String(manifest.version) === String(release.version).replace(/^v/, '')) return {ok: true, how: 'release-commit', manifest};
  return {ok: false, reason: sig ? '签名清单的签名不对' : '包没有官方签名', manifest};
}

const isLink = file => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };

export function atomicWriteFileSync(target, data, {mode} = {}) {
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

export function atomicCopyFileSync(source, target, expectedHash = '') {
  const bytes = fs.readFileSync(source);
  if (expectedHash && sha256(bytes) !== expectedHash) throw new Error('安装包里的文件校验不通过');
  atomicWriteFileSync(target, bytes);
  if (expectedHash && hashFile(target) !== expectedHash) throw new Error('写入后校验不通过（可能被安全软件拦截或磁盘异常）');
}

function backupAndCopy(source, target, backupRoot, key, restored, restoreFailed, kind, expectedHash = '') {
  const existed = fs.existsSync(target) || isLink(target);
  try {
    if (existed) {
      const backup = path.join(backupRoot, key);
      fs.mkdirSync(path.dirname(backup), {recursive: true});
      try { fs.renameSync(target, backup); } catch {
        if (isLink(target)) {
          try { fs.symlinkSync(fs.readlinkSync(target), backup); } catch {}
          fs.rmSync(target, {force: true});
        } else {
          fs.copyFileSync(target, backup);
          fs.rmSync(target, {force: true});
        }
      }
    }
    atomicCopyFileSync(source, target, expectedHash);
    restored.push({file: target, kind, existed});
    return true;
  } catch (error) {
    restoreFailed.push({file: target, kind, error: String(error?.message || error)});
    return false;
  }
}

export function bundleIdentity(bundle, info = null, manifest = null) {
  const buildInfo = info || readJson(path.join(bundle, 'build-info.json')) || {};
  let manifestSha = '';
  let parsedManifest = manifest;
  try {
    const raw = fs.readFileSync(path.join(bundle, 'guard-manifest.json'));
    manifestSha = sha256(raw);
    if (!parsedManifest) parsedManifest = JSON.parse(raw.toString('utf8'));
  } catch {}
  return {
    channel: String(buildInfo.channel || 'release'),
    version: String(buildInfo.version || parsedManifest?.version || ''),
    commit: String(parsedManifest?.commit || buildInfo.commit || ''),
    manifestSha,
  };
}

function sameIdentity(a, b) {
  return Boolean(a && b)
    && String(a.channel || '') === String(b.channel || '')
    && String(a.version || '') === String(b.version || '')
    && String(a.commit || '') === String(b.commit || '')
    && String(a.manifestSha || '') === String(b.manifestSha || '');
}

function counterPayload(state) {
  const events = Array.isArray(state.events) ? state.events : [];
  return [
    1,
    String(state.channel || 'release'),
    String(state.version || ''),
    String(state.commit || ''),
    String(state.manifestSha || ''),
    events.join(','),
    state.tamperLocked ? '1' : '0',
    String(state.updatedAt || ''),
  ].join('|');
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

export function signCounterState({events = [], tamperLocked = false, updatedAt = new Date().toISOString()}, identity, key = PUBLIC_KEY) {
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

export function verifyCounterState(raw, identity, key = PUBLIC_KEY) {
  if (!raw || typeof raw !== 'object' || raw.schema !== 1 || !Array.isArray(raw.events)) return false;
  if (!sameIdentity(raw, identity)) return false;
  const expected = counterMacs(raw, identity, key);
  return timingSafeHexEqual(raw.mac, expected.mac) && timingSafeHexEqual(raw.chainMac, expected.chainMac);
}

function verifyCounterChain(raw, key = PUBLIC_KEY) {
  if (!raw || typeof raw !== 'object' || raw.schema !== 1 || !Array.isArray(raw.events)) return false;
  const oldIdentity = {
    channel: String(raw.channel || 'release'),
    version: String(raw.version || ''),
    commit: String(raw.commit || ''),
    manifestSha: String(raw.manifestSha || ''),
  };
  const expected = counterMacs(raw, oldIdentity, key);
  return timingSafeHexEqual(raw.chainMac, expected.chainMac);
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); } catch { return false; }
}

function pruneEvents(events, nowMs) {
  return (Array.isArray(events) ? events : []).filter(ts => {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) && ms <= nowMs + 60_000 && nowMs - ms < STRIKE_WINDOW_MS;
  });
}

function listAppStateMarkers(appState) {
  try {
    return fs.readdirSync(appState).filter(n => /^(?:bundled-personas-|bundled-setup-)/.test(n));
  } catch { return []; }
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

export function hasCounterReceipt({appState, stateDir, identity, previousStatus = null} = {}) {
  const status = previousStatus ?? readJson(path.join(appState, 'guard', 'status.json'));
  if (Number(status?.counterSchema) >= 1 && receiptMatches(status, identity)) {
    return true;
  }
  if (stateDir) {
    const receipt = readJson(path.join(stateDir, 'guard-receipt.json'));
    if (Number(receipt?.schema) >= 1 && receiptMatches(receipt, identity)) {
      return true;
    }
    for (const plugin of PRODUCT_PLUGIN_IDS) {
      const mark = readJson(path.join(stateDir, 'extensions', plugin, 'guard-build.json'));
      if (mark && mark.counterReady === true && receiptMatches(mark, identity)) {
        return true;
      }
    }
  }
  return false;
}

export function summarizeCategories(restored = [], configFixed = []) {
  const cats = [];
  const seen = new Set();
  const add = label => { if (label && !seen.has(label)) { seen.add(label); cats.push(label); } };
  for (const item of restored) add(CATEGORY_LABELS[item?.kind] || '设定文件');
  if (Array.isArray(configFixed) && configFixed.length) add(CATEGORY_LABELS.config);
  return cats;
}

export function isUpdateInProgress(appState, nowMs = Date.now()) {
  if (!appState) return false;
  const updatesDir = path.join(appState, 'updates');
  const checks = [
    path.join(updatesDir, 'in-progress.json'),
    path.join(updatesDir, 'install-in-progress.json'),
    path.join(updatesDir, 'manual-update.lock'),
  ];
  for (const candidate of checks) {
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

export function lockTamperedCounter({appState, bundle, info = null, manifest = null, key = PUBLIC_KEY, now = () => new Date()} = {}) {
  const identity = bundleIdentity(bundle, info, manifest);
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const existing = readJson(path.join(appState, 'guard', 'counter.json'));
  const kept = verifyCounterChain(existing, key) ? pruneEvents(existing.events, nowDate.getTime()) : [];
  while (kept.length < STRIKE_LIMIT) kept.push(nowIso);
  const signed = signCounterState({events: kept, tamperLocked: true, updatedAt: nowIso}, identity, key);
  atomicWriteFileSync(path.join(appState, 'guard', 'counter.json'), JSON.stringify(signed, null, 2) + '\n');
  return signed;
}

// ---------- 不可见来源标记（版本 + 构建号，零宽字符编码在人设首行标题后） ----------
export function encodeProvenancePayload(text) {
  const bytes = Buffer.from(String(text || ''), 'utf8');
  let out = PROVENANCE_START;
  for (const byte of bytes) {
    out += PROVENANCE_DIGITS[(byte >> 6) & 3]
      + PROVENANCE_DIGITS[(byte >> 4) & 3]
      + PROVENANCE_DIGITS[(byte >> 2) & 3]
      + PROVENANCE_DIGITS[byte & 3];
  }
  return out + PROVENANCE_END;
}

export function inspectPersonaMark(content) {
  const raw = String(content || '');
  const start = raw.indexOf(PROVENANCE_START);
  if (start < 0) return {found: false};
  const bodyStart = start + PROVENANCE_START.length;
  const end = raw.indexOf(PROVENANCE_END, bodyStart);
  if (end < 0) return {found: false};
  const encoded = raw.slice(bodyStart, end);
  if (!encoded || encoded.length % 4 !== 0) return {found: false};
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 4) {
    let val = 0;
    for (let j = 0; j < 4; j += 1) {
      const idx = PROVENANCE_DIGITS.indexOf(encoded[i + j]);
      if (idx < 0) return {found: false};
      val = (val << 2) | idx;
    }
    bytes.push(val);
  }
  const text = Buffer.from(bytes).toString('utf8');
  const parts = text.split('|');
  if (parts[0] !== 'SP' || parts.length < 4) return {found: false, raw: text};
  return {
    found: true,
    version: parts[1] || '',
    commit: parts[2] || '',
    channel: parts[3] || '',
    tag: parts[4] || '',
    raw: text,
  };
}

export function stampPersonaContent(content, {version = '', commit = '', channel = 'release'} = {}) {
  const clean = String(content || '').replace(PROVENANCE_STRIP_RE, '');
  const shortCommit = String(commit || '').slice(0, 12) || 'local';
  const payload = `SP|${String(version || '').replace(/^v/, '')}|${shortCommit}|${String(channel || 'release')}`;
  const mark = encodeProvenancePayload(payload);
  const nl = clean.indexOf('\n');
  if (nl >= 0) return clean.slice(0, nl) + mark + clean.slice(nl);
  return clean + mark;
}

export function stampPersonas(personasDir, {version = '', commit = '', channel = 'release'} = {}) {
  let count = 0;
  for (const mode of PROVENANCE_MODES) {
    const dir = path.join(personasDir, mode);
    if (!fs.existsSync(dir)) continue;
    for (const name of PROVENANCE_FILES) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const original = fs.readFileSync(file, 'utf8');
      const stamped = stampPersonaContent(original, {version, commit, channel});
      if (stamped !== original) {
        atomicWriteFileSync(file, stamped);
        count += 1;
      }
    }
  }
  return count;
}

// openclaw.json：只修产品键，其它（模型、密钥、偏好、渠道……）原样保留。
function expandTilde(value, home = os.homedir()) {
  return typeof value === 'string' ? value.replace(/^~(?=$|[\\/])/, home) : '';
}

function isOfficialPluginPath(raw, stateDir, home = os.homedir()) {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const resolved = path.resolve(expandTilde(raw, home));
  const extRoot = path.resolve(path.join(stateDir, 'extensions'));
  return resolved === extRoot || resolved.startsWith(extRoot + path.sep) || /SuperPinkie[\\/]services[\\/]/.test(raw) || /超級碧琪\.app/.test(raw);
}

function shadowsProductPlugin(raw, stateDir, home = os.homedir()) {
  if (typeof raw !== 'string' || !raw.trim() || isOfficialPluginPath(raw, stateDir, home)) return false;
  const resolved = path.resolve(expandTilde(raw, home));
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

export function repairConfig(config, {stateDir, userSkillsDir, home = os.homedir()}) {
  const fixed = [];
  const set = (label, apply) => { if (apply()) fixed.push(label); };
  const plugins = config.plugins && typeof config.plugins === 'object' ? config.plugins : (config.plugins = {});
  set('plugins.enabled', () => { if (plugins.enabled === false) { delete plugins.enabled; return true; } return false; });
  set('plugins.deny', () => {
    if (!Array.isArray(plugins.deny)) return false;
    const before = plugins.deny.length; plugins.deny = plugins.deny.filter(id => !PRODUCT_PLUGIN_IDS.includes(id)); return plugins.deny.length !== before;
  });
  const entries = plugins.entries && typeof plugins.entries === 'object' ? plugins.entries : (plugins.entries = {});
  for (const id of PRODUCT_PLUGIN_IDS) {
    const entry = entries[id];
    if (!entry || typeof entry !== 'object') continue; // 没装过的插件由 setup 装，这里不凭空加
    set(`plugins.entries.${id}.enabled`, () => { if (entry.enabled !== true) { entry.enabled = true; return true; } return false; });
    // 两个插件的钩子授权（setup 写的）：被删掉的话 OpenClaw 会挡掉碧琪的对话钩子，插件「开着但不干活」。
    if (HOOK_GRANT_PLUGINS.has(id)) set(`plugins.entries.${id}.hooks`, () => {
      const hooks = entry.hooks && typeof entry.hooks === 'object' ? entry.hooks : (entry.hooks = {});
      let changed = false;
      for (const grant of ['allowPromptInjection', 'allowConversationAccess']) if (hooks[grant] !== true) { hooks[grant] = true; changed = true; }
      return changed;
    });
    if (Array.isArray(plugins.allow)) set('plugins.allow', () => { if (!plugins.allow.includes(id)) { plugins.allow.push(id); return true; } return false; });
  }
  // 保留用户自己挂的外部插件目录，只拦截冒充产品插件 ID 的外部目录。
  if (Array.isArray(plugins.load?.paths)) {
    set('plugins.load.paths', () => {
      const before = plugins.load.paths;
      const filtered = before.filter(p => typeof p === 'string' && p.trim() && !shadowsProductPlugin(p, stateDir, home));
      const changed = filtered.length !== before.length || filtered.some((p, i) => p !== before[i]);
      if (!changed) return false;
      plugins.load.paths = filtered;
      return true;
    });
  }
  // 四个模式的工作区必须是官方位置：换个目录就能换一套人设。
  const list = Array.isArray(config.agents?.list) ? config.agents.list : null;
  for (const agent of list || []) {
    const dir = PRODUCT_AGENTS[agent?.id];
    if (!dir) continue;
    const official = path.join(stateDir, dir);
    set(`agents.list.${agent.id}.workspace`, () => {
      const current = typeof agent.workspace === 'string' ? agent.workspace.replace(/^~(?=[\\/])/, home) : '';
      if (current && path.resolve(current) === path.resolve(official)) return false;
      agent.workspace = official; return true;
    });
    set(`agents.list.${agent.id}.contextInjection`, () => { if (agent.contextInjection === 'never') { delete agent.contextInjection; return true; } return false; });
    const tools = agent.tools && typeof agent.tools === 'object' ? agent.tools : null;
    if (tools) set(`agents.list.${agent.id}.tools.deny`, () => {
      const deny = Array.isArray(tools.deny) ? tools.deny : (tools.deny = []);
      if (deny.includes('skill_workshop')) return false; deny.push('skill_workshop'); return true;
    });
  }
  // 往工作区额外注入文件的内部钩子。
  set('hooks.internal', () => { if (config.hooks?.internal) { delete config.hooks.internal; return true; } return false; });
  // 技能额外目录：保留用户自己加的目录，只确保默认的用户技能目录也在里面。
  const skills = config.skills && typeof config.skills === 'object' ? config.skills : (config.skills = {});
  const load = skills.load && typeof skills.load === 'object' ? skills.load : (skills.load = {});
  set('skills.load.extraDirs', () => {
    const current = Array.isArray(load.extraDirs) ? load.extraDirs.filter(p => typeof p === 'string' && p.trim()) : [];
    const targetResolved = path.resolve(expandTilde(userSkillsDir, home));
    const hasDefault = current.some(p => path.resolve(expandTilde(p, home)) === targetResolved);
    if (hasDefault && Array.isArray(load.extraDirs) && current.length === load.extraDirs.length) return false;
    load.extraDirs = hasDefault ? current : [...current, userSkillsDir];
    return true;
  });
  return fixed;
}

function frontName(file) {
  try { return /^---[\s\S]*?^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(fs.readFileSync(file, 'utf8'))?.[1]?.trim() || ''; } catch { return ''; }
}

export function startup({bundle = path.resolve(HERE, '../..'), home, stateDir, appState, key = PUBLIC_KEY, now = () => new Date()} = {}) {
  const started = process.hrtime.bigint();
  const info = readJson(path.join(bundle, 'build-info.json'));
  if (!info || info.guard !== true) return {guard: false};
  const resolvedHome = home || os.homedir();
  stateDir ||= (!home && process.env.OPENCLAW_STATE_DIR) ? process.env.OPENCLAW_STATE_DIR : path.join(resolvedHome, '.openclaw');
  appState ||= process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(resolvedHome, 'AppData', 'Local'), 'SuperPinkie')
    : path.join(resolvedHome, 'Library', 'Application Support', 'SuperPinkie');
  const guardDir = path.join(appState, 'guard');
  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const updating = isUpdateInProgress(appState, nowDate.getTime());
  const stamp = nowIso.replace(/[:.]/g, '-');
  const backupRoot = path.join(appState, 'backups', `guard-${stamp}`);
  const restored = [];
  const restoreFailed = [];
  const problems = [];
  const trust = bundleTrust(bundle, info, key);
  const manifest = trust.manifest || {files: {}};
  // 包里的关键文件是不是还和清单一样（包被改过 = 非官方版本，这时不拿包里的文件去恢复）。
  const tampered = [];
  for (const [rel, hash] of Object.entries(manifest.files || {})) {
    if (!/^(VERSION|build-info\.json|personas\/|services\/(mode-architecture|project-scope|first-person-renderer)\/|installer\/)/.test(rel)) continue;
    if (hashFile(path.join(bundle, rel)) !== hash) tampered.push(rel);
  }
  const bundleOk = trust.ok && tampered.length === 0;
  const identity = bundleIdentity(bundle, info, trust.manifest);

  const previous = readJson(path.join(guardDir, 'status.json'));
  const counterFile = path.join(guardDir, 'counter.json');
  const counterRaw = readJson(counterFile);
  const hasCounterFile = fs.existsSync(counterFile) || isLink(counterFile);
  const receipt = hasCounterReceipt({appState, stateDir, identity, previousStatus: previous});
  const appStateMarkers = listAppStateMarkers(appState);

  // 检测升级切换与计数器防删改（先于复制文件判断，避免升级换新文件被误算作篡改）。
  let counterTampered = false;
  let isBundleTransition = false;
  let priorEvents = [];
  let canWriteCounter = true;
  if (!hasCounterFile) {
    if (receipt && !updating) {
      counterTampered = true;
    } else if (updating
      || (previous && (!previous.counterSchema || !receiptMatches(previous, identity)))
      || appStateMarkers.length > 0) {
      isBundleTransition = true;
    }
  } else if (verifyCounterState(counterRaw, identity, key)) {
    priorEvents = pruneEvents(counterRaw.events, nowDate.getTime());
  } else if (bundleOk && counterRaw && !sameIdentity(counterRaw, identity) && !receipt && verifyCounterChain(counterRaw, key)) {
    isBundleTransition = true;
    priorEvents = pruneEvents(counterRaw.events, nowDate.getTime());
  } else if (updating) {
    isBundleTransition = true;
    if (counterRaw && verifyCounterChain(counterRaw, key)) {
      priorEvents = pruneEvents(counterRaw.events, nowDate.getTime());
    } else {
      canWriteCounter = false;
    }
  } else {
    counterTampered = true;
  }

  if (bundleOk) {
    // 1. 人设和手册
    for (const [mode, dir] of Object.entries(MODE_WORKSPACES)) {
      const prefix = `personas/${mode}/`;
      const workspace = path.join(stateDir, dir);
      for (const [rel, hash] of Object.entries(manifest.files)) {
        if (!rel.startsWith(prefix)) continue;
        const inner = rel.slice(prefix.length);
        // The role asset installer owns this subtree (including retirement
        // backups); never let the generic restorer write inside user/ or drafts/.
        if (mode === 'metre' && (inner === 'roles' || inner.startsWith('roles/'))) continue;
        if (KEEP_NAMES.has(path.basename(inner))) continue;
        const target = path.join(workspace, ...inner.split('/'));
        if (!isLink(target) && hashFile(target) === hash) continue;
        backupAndCopy(path.join(bundle, rel), target, backupRoot, `personas/${mode}/${inner}`, restored, restoreFailed, 'persona', hash);
      }
      for (const name of INJECTED_EXTRAS) {
        const extra = path.join(workspace, name);
        if (!manifest.files[`${prefix}${name}`] && (fs.existsSync(extra) || isLink(extra))) {
          try {
            const backup = path.join(backupRoot, 'extras', mode, name);
            fs.mkdirSync(path.dirname(backup), {recursive: true});
            fs.renameSync(extra, backup);
            restored.push({file: extra, kind: 'removed-extra', existed: true});
          } catch (error) {
            restoreFailed.push({file: extra, kind: 'removed-extra', error: String(error?.message || error)});
          }
        }
      }
    }
    // 2. 插件代码（版本号被改大也照样换回：正式版只认包里的插件）
    for (const [plugin, source] of Object.entries(PLUGINS)) {
      const installed = path.join(stateDir, 'extensions', plugin);
      if (!fs.existsSync(installed)) continue;
      for (const [rel, hash] of Object.entries(manifest.files)) {
        if (!rel.startsWith(source + '/')) continue;
        const inner = rel.slice(source.length + 1);
        if (/^(setup\.py|README|tests?\/)/.test(inner)) continue;
        const target = path.join(installed, ...inner.split('/'));
        const required = REQUIRED_PLUGIN_FILES[plugin]?.has(inner);
        if (!required && !fs.existsSync(target) && !isLink(target)) continue; // setup 没装的文件不凭空加；核心防护与密码门槛文件即使被删也要补回
        if (!isLink(target) && hashFile(target) === hash) continue;
        backupAndCopy(path.join(bundle, rel), target, backupRoot, `extensions/${plugin}/${inner}`, restored, restoreFailed, 'plugin', hash);
      }
      // 正式版标记跟着插件走（插件在包外也能知道自己是正式版并核对同一份计数器）
      const mark = path.join(installed, 'guard-build.json');
      const want = JSON.stringify({
        guard: true,
        channel: identity.channel,
        version: identity.version,
        commit: identity.commit,
        manifestSha: identity.manifestSha,
        bundleRoot: path.resolve(bundle),
        counterReady: true,
      }) + '\n';
      try { if (fs.readFileSync(mark, 'utf8') !== want) throw 0; } catch { try { atomicWriteFileSync(mark, want); } catch {} }
    }
    // 3. 工作区里和自带技能同名的技能：换回自带版本
    const productSkills = new Set();
    for (const rel of Object.keys(manifest.files)) { const m = /^bundled-skills\/([^/]+)\//.exec(rel); if (m) productSkills.add(m[1]); }
    for (const dir of Object.values(MODE_WORKSPACES)) {
      const skillsDir = path.join(stateDir, dir, 'skills');
      let names = []; try { names = fs.readdirSync(skillsDir); } catch {}
      for (const name of names) {
        if (!productSkills.has(name)) continue;
        for (const [rel, hash] of Object.entries(manifest.files)) {
          if (!rel.startsWith(`bundled-skills/${name}/`)) continue;
          const target = path.join(skillsDir, ...rel.slice('bundled-skills/'.length).split('/'));
          if (!isLink(target) && hashFile(target) === hash) continue;
          if (hashFile(path.join(bundle, rel)) !== hash) {
            const problem = `包里的技能文件 ${rel} 和清单不一致`;
            problems.push(problem);
            restoreFailed.push({file: target, kind: 'skill', error: problem});
            continue;
          }
          backupAndCopy(path.join(bundle, rel), target, backupRoot, `skills/${dir}/${rel.slice('bundled-skills/'.length)}`, restored, restoreFailed, 'skill', hash);
        }
      }
    }
    // 4. 用户技能目录：和自带技能同名的停用（不能覆盖自带技能）
    const userSkills = path.join(stateDir, 'user-skills');
    try { fs.mkdirSync(userSkills, {recursive: true}); } catch {}
    const lower = new Set([...productSkills].map(n => n.toLowerCase()));
    let userSkillEntries = [];
    try { userSkillEntries = fs.readdirSync(userSkills); } catch {}
    for (const name of userSkillEntries) {
      if (name.includes('.disabled-same-name-')) continue;
      const skillFile = path.join(userSkills, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const declared = frontName(skillFile) || name;
      if (lower.has(declared.toLowerCase()) || lower.has(name.toLowerCase())) {
        const disabled = path.join(userSkills, `${name}.disabled-same-name-${stamp}`);
        try {
          fs.renameSync(path.join(userSkills, name), disabled);
          restored.push({file: disabled, kind: 'user-skill-disabled', existed: true});
        } catch (error) {
          restoreFailed.push({file: path.join(userSkills, name), kind: 'user-skill-disabled', error: String(error?.message || error)});
        }
      }
    }
  }
  // 5. openclaw.json 产品键（包被改过也照样修：这些规则写在校验器里，不依赖包里的文件）
  const configFile = path.join(stateDir, 'openclaw.json');
  const configExists = fs.existsSync(configFile);
  let configFixed = [];
  let hadExtraDirs = false;
  try {
    const raw = fs.readFileSync(configFile, 'utf8');
    const config = JSON.parse(raw);
    hadExtraDirs = Array.isArray(config.skills?.load?.extraDirs) && config.skills.load.extraDirs.length > 0;
    configFixed = repairConfig(config, {stateDir, userSkillsDir: path.join(stateDir, 'user-skills'), home: resolvedHome});
    if (configFixed.length) {
      const backup = path.join(backupRoot, 'openclaw.json');
      fs.mkdirSync(path.dirname(backup), {recursive: true});
      fs.writeFileSync(backup, raw, {mode: 0o600});
      atomicWriteFileSync(configFile, JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
    }
  } catch (error) {
    if (configExists) {
      const msg = `openclaw.json 没能检查：${error.message}`;
      problems.push(msg);
      restoreFailed.push({file: configFile, kind: 'config', error: msg});
    }
  }

  const configInitializedBefore = Boolean(previous?.configInitialized);
  const configInitialized = Boolean(configInitializedBefore || configExists);
  const initialExtraDirsOnly = !configInitializedBefore && !hadExtraDirs && configFixed.length === 1 && configFixed[0] === 'skills.load.extraDirs';
  const effectiveConfigFixed = initialExtraDirsOnly ? [] : configFixed;

  const meaningfulRestore = restored.some(r => r.existed || (r.kind === 'persona' && CORE_PERSONA_NAMES.has(path.basename(r.file)))) || effectiveConfigFixed.length > 0;
  const initialSeed = !previous && !hasCounterFile && !isBundleTransition && !restored.some(r => r.existed) && effectiveConfigFixed.length === 0;
  const hasFailedRestore = restoreFailed.length > 0 || problems.length > 0;
  const isTamperEvent = !updating && !initialSeed && !isBundleTransition && !hasFailedRestore && bundleOk && meaningfulRestore;

  let nextEvents = priorEvents;
  let tamperLocked = Boolean(counterRaw?.tamperLocked && verifyCounterState(counterRaw, identity, key));
  if (counterTampered) {
    nextEvents = [...priorEvents];
    while (nextEvents.length < STRIKE_LIMIT) nextEvents.push(nowIso);
    tamperLocked = true;
  } else if (isTamperEvent) {
    nextEvents = [...priorEvents, nowIso];
    if (nextEvents.length >= STRIKE_LIMIT) tamperLocked = true;
  } else if (nextEvents.length < STRIKE_LIMIT) {
    tamperLocked = false;
  }
  const strikesIn24h = nextEvents.length;
  const limitReached = !updating && (counterTampered || (isTamperEvent && strikesIn24h >= STRIKE_LIMIT));

  fs.mkdirSync(guardDir, {recursive: true});
  if (canWriteCounter) {
    const counterOut = signCounterState({events: nextEvents, tamperLocked, updatedAt: nowIso}, identity, key);
    atomicWriteFileSync(counterFile, JSON.stringify(counterOut, null, 2) + '\n');
    if (bundleOk) {
      try {
        atomicWriteFileSync(path.join(stateDir, 'guard-receipt.json'), JSON.stringify({
          schema: 1,
          version: identity.version,
          commit: identity.commit,
          manifestSha: identity.manifestSha,
          updatedAt: nowIso,
        }, null, 2) + '\n');
      } catch {}
    }
  }

  const categories = summarizeCategories(restored, effectiveConfigFixed);
  const backupPath = restored.length || effectiveConfigFixed.length ? backupRoot : '';
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const event = {
    at: nowIso, version: identity.version, commit: identity.commit, manifestSha: identity.manifestSha, trusted: trust.ok, how: trust.how || '',
    nonOfficial: !bundleOk, reason: trust.ok ? (tampered.length ? `包里有 ${tampered.length} 个文件和签名清单不一致` : '') : trust.reason,
    tampered: tampered.slice(0, 20), restored, restoreFailed, configFixed: effectiveConfigFixed, problems, backup: backupPath,
    counterSchema: 1, configInitialized, strikesIn24h, limitReached, counterTampered, isBundleTransition, initialSeed, updating, ms: Math.round(ms),
  };
  const history = Array.isArray(previous?.history) ? previous.history : [];
  const recordHistory = !updating && (counterTampered || hasFailedRestore || event.nonOfficial || (!initialSeed && !isBundleTransition && (restored.length || effectiveConfigFixed.length)));
  if (recordHistory) {
    history.push({
      at: event.at, source: 'startup', restored: restored.length, configFixed: effectiveConfigFixed, categories,
      nonOfficial: event.nonOfficial, counterTampered, restoreFailed: restoreFailed.length,
      strikesIn24h, backup: backupPath, reason: event.reason,
    });
  }
  const status = {...event, history: history.slice(-20)};
  atomicWriteFileSync(path.join(guardDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  if (history.length !== (previous?.history?.length || 0)) {
    fs.appendFileSync(path.join(guardDir, 'guard.log'), JSON.stringify({...event, restored: restored.map(r => `${r.kind}:${r.file}`)}) + '\n');
  }

  if (!updating && (counterTampered || hasFailedRestore || event.nonOfficial || isTamperEvent)) {
    const alertPayload = {
      id: crypto.randomUUID(),
      source: 'startup',
      at: nowIso,
      categories,
      backup: backupPath,
      count: strikesIn24h,
      limit: STRIKE_LIMIT,
      limitReached,
      counterTampered,
      restoreFailed: hasFailedRestore,
      failedCount: restoreFailed.length || problems.length,
      nonOfficial: event.nonOfficial,
      reason: event.reason,
    };
    const existingAlert = readJson(path.join(guardDir, 'pending-alert.json'));
    if (!existingAlert?.limitReached || alertPayload.limitReached) {
      atomicWriteFileSync(path.join(guardDir, 'pending-alert.json'), JSON.stringify(alertPayload, null, 2) + '\n');
    }
  }
  return {guard: true, ...status};
}

function arg(name, argv) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

const isMain = (() => { try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'startup') {
      const result = startup({bundle: arg('--bundle', rest) || undefined, home: arg('--home', rest) || undefined, stateDir: arg('--state-dir', rest) || undefined, appState: arg('--app-state', rest) || undefined});
      process.stdout.write(JSON.stringify({guard: result.guard, nonOfficial: result.nonOfficial, restored: result.restored?.length || 0, restoreFailed: result.restoreFailed?.length || 0, configFixed: result.configFixed || [], strikesIn24h: result.strikesIn24h || 0, limitReached: Boolean(result.limitReached), counterTampered: Boolean(result.counterTampered), ms: result.ms}) + '\n');
    } else if (command === 'manifest') {
      const dir = rest[0];
      fs.writeFileSync(path.join(dir, 'guard-manifest.json'), JSON.stringify(buildManifest(dir, {commit: arg('--commit', rest) || ''}), null, 1) + '\n');
    } else if (command === 'stamp-personas') {
      const dir = rest[0];
      const stamped = stampPersonas(dir, {version: arg('--version', rest) || '', commit: arg('--commit', rest) || '', channel: arg('--channel', rest) || 'release'});
      process.stdout.write(JSON.stringify({stamped}) + '\n');
    } else if (command === 'inspect-mark') {
      const file = rest[0];
      process.stdout.write(JSON.stringify(inspectPersonaMark(fs.readFileSync(file, 'utf8'))) + '\n');
    } else if (command === 'lock-tampered') {
      const bundle = arg('--bundle', rest) || path.resolve(HERE, '../..');
      const home = arg('--home', rest) || os.homedir();
      const appState = arg('--app-state', rest) || (process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SuperPinkie')
        : path.join(home, 'Library', 'Application Support', 'SuperPinkie'));
      const locked = lockTamperedCounter({appState, bundle});
      process.stdout.write(JSON.stringify({ok: true, count: locked.events.length, limitReached: true}) + '\n');
    } else if (command === 'sign') {
      const [dir, keyFile] = rest;
      fs.writeFileSync(path.join(dir, 'guard-manifest.sig'), signBytes(fs.readFileSync(path.join(dir, 'guard-manifest.json')), fs.readFileSync(keyFile, 'utf8')) + '\n');
    } else if (command === 'sign-release') {
      const [version, commit, keyFile] = rest;
      process.stdout.write(signBytes(releasePayload(version, commit), fs.readFileSync(keyFile, 'utf8')) + '\n');
    } else if (command === 'verify-release') {
      const [version, commit, signature] = rest;
      process.exit(verifyRelease(version, commit, signature) ? 0 : 1);
    } else if (command === 'sign-latest') {
      const [file, keyFile] = rest;
      const signed = signLatest(JSON.parse(fs.readFileSync(file, 'utf8')), fs.readFileSync(keyFile, 'utf8'));
      fs.writeFileSync(file, JSON.stringify(signed, null, 1));
    } else if (command === 'verify-latest') {
      let latest = null; try { latest = JSON.parse(fs.readFileSync(rest[0], 'utf8').replace(/^\uFEFF/, '')); } catch {}
      // --public-key 只给测试用（调用方是我们自己的更新器，参数写死，latest.json 改不了它）。
      const result = verifyLatest(latest, {asset: arg('--asset', rest), sha256: arg('--sha256', rest), commit: arg('--commit', rest), key: arg('--public-key', rest) || PUBLIC_KEY});
      if (!result.ok) process.stderr.write(result.reason + '\n');
      process.exit(result.ok ? 0 : 1);
    } else {
      process.stderr.write('usage: guard.mjs startup|manifest|stamp-personas|inspect-mark|lock-tampered|sign|sign-release|verify-release|sign-latest|verify-latest\n');
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`guard: ${error?.stack || error}\n`);
    if (command === 'startup') {
      // 校验代码自己出错也要留下标记（诊断页显示「设定校验出错」）。
      try {
        const appState = arg('--app-state', rest) || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'SuperPinkie') : path.join(os.homedir(), 'Library', 'Application Support', 'SuperPinkie'));
        fs.mkdirSync(path.join(appState, 'guard'), {recursive: true});
        fs.writeFileSync(path.join(appState, 'guard', 'status.json'), JSON.stringify({at: new Date().toISOString(), error: String(error?.message || error), history: [{at: new Date().toISOString(), error: true}]}) + '\n');
      } catch {}
    }
    process.exit(command === 'startup' ? 0 : 1); // 启动校验出错不挡用户打开 App
  }
}
