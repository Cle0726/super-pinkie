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
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 清单覆盖的包内目录（runtime/ 很大，由系统代码签名管）。
const MANIFEST_ROOTS = ['VERSION', 'build-info.json', 'personas', 'services', 'installer', 'bundled-skills', 'skills', 'ui'];
// 模式 → 工作区；neutral（无限制模式）归用户，DREAMS.md 是碧琪自己写的梦，都不恢复（沿用 sync-personas 的规则）。
const MODE_WORKSPACES = {chat: 'workspace', project: 'workspace-project', thinking: 'workspace-thinking', learning: 'workspace-learning'};
const KEEP_NAMES = new Set(['DREAMS.md']);
// 插件：已装目录 ← 包里的源目录。
const PLUGINS = {'pinkie-mode-architecture': 'services/mode-architecture', 'pinkie-project-scope': 'services/project-scope', 'pinkie-first-person-renderer': 'services/first-person-renderer'};
const PRODUCT_PLUGIN_IDS = Object.keys(PLUGINS);
const PRODUCT_AGENTS = {main: 'workspace', project: 'workspace-project', thinking: 'workspace-thinking', learning: 'workspace-learning'};
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

function backupAndCopy(source, target, backupRoot, key, restored, kind) {
  if (fs.existsSync(target) || isLink(target)) {
    const backup = path.join(backupRoot, key);
    fs.mkdirSync(path.dirname(backup), {recursive: true});
    try { fs.renameSync(target, backup); } catch { fs.copyFileSync(target, backup); fs.rmSync(target, {force: true}); }
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(source, target);
  restored.push({file: target, kind});
}
const isLink = file => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };

// openclaw.json：只修产品键，其它（模型、密钥、偏好、渠道……）原样保留。
export function repairConfig(config, {stateDir, userSkillsDir}) {
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
    if (Array.isArray(plugins.allow)) set('plugins.allow', () => { if (!plugins.allow.includes(id)) { plugins.allow.push(id); return true; } return false; });
  }
  // 外面塞进来的插件目录（能往提示词里注入东西）：只留 ~/.openclaw/extensions 和包里的。
  if (Array.isArray(plugins.load?.paths)) {
    set('plugins.load.paths', () => {
      const before = plugins.load.paths.length;
      plugins.load.paths = plugins.load.paths.filter(p => typeof p === 'string' && (path.resolve(p).startsWith(path.join(stateDir, 'extensions')) || /SuperPinkie[\\/]services[\\/]/.test(p) || /超級碧琪\.app/.test(p)));
      return plugins.load.paths.length !== before;
    });
  }
  // 四个模式的工作区必须是官方位置：换个目录就能换一套人设。
  const list = Array.isArray(config.agents?.list) ? config.agents.list : null;
  for (const agent of list || []) {
    const dir = PRODUCT_AGENTS[agent?.id];
    if (!dir) continue;
    const official = path.join(stateDir, dir);
    set(`agents.list.${agent.id}.workspace`, () => {
      const current = typeof agent.workspace === 'string' ? agent.workspace.replace(/^~(?=[\\/])/, os.homedir()) : '';
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
  // 技能额外目录：只留用户技能目录（排在自带技能之后，同名由启动校验停用）。
  const skills = config.skills && typeof config.skills === 'object' ? config.skills : (config.skills = {});
  const load = skills.load && typeof skills.load === 'object' ? skills.load : (skills.load = {});
  set('skills.load.extraDirs', () => {
    const want = [userSkillsDir];
    const current = Array.isArray(load.extraDirs) ? load.extraDirs : [];
    if (current.length === 1 && path.resolve(current[0]) === path.resolve(userSkillsDir)) return false;
    load.extraDirs = want; return true;
  });
  return fixed;
}

function frontName(file) {
  try { return /^---[\s\S]*?^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(fs.readFileSync(file, 'utf8'))?.[1]?.trim() || ''; } catch { return ''; }
}

export function startup({bundle = path.resolve(HERE, '../..'), home = os.homedir(), stateDir, appState, key = PUBLIC_KEY, now = () => new Date()} = {}) {
  const started = process.hrtime.bigint();
  const info = readJson(path.join(bundle, 'build-info.json'));
  if (!info || info.guard !== true) return {guard: false};
  stateDir ||= path.join(home, '.openclaw');
  appState ||= process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SuperPinkie')
    : path.join(home, 'Library', 'Application Support', 'SuperPinkie');
  const guardDir = path.join(appState, 'guard');
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(appState, 'backups', `guard-${stamp}`);
  const restored = [];
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
  const official = rel => bundleOk && manifest.files?.[rel];

  if (bundleOk) {
    // 1. 人设和手册
    for (const [mode, dir] of Object.entries(MODE_WORKSPACES)) {
      const prefix = `personas/${mode}/`;
      const workspace = path.join(stateDir, dir);
      for (const [rel, hash] of Object.entries(manifest.files)) {
        if (!rel.startsWith(prefix)) continue;
        const inner = rel.slice(prefix.length);
        if (KEEP_NAMES.has(path.basename(inner))) continue;
        const target = path.join(workspace, ...inner.split('/'));
        if (!isLink(target) && hashFile(target) === hash) continue;
        backupAndCopy(path.join(bundle, rel), target, backupRoot, `personas/${mode}/${inner}`, restored, 'persona');
      }
      for (const name of INJECTED_EXTRAS) {
        const extra = path.join(workspace, name);
        if (!manifest.files[`${prefix}${name}`] && fs.existsSync(extra)) {
          const backup = path.join(backupRoot, 'extras', mode, name);
          fs.mkdirSync(path.dirname(backup), {recursive: true});
          fs.renameSync(extra, backup);
          restored.push({file: extra, kind: 'removed-extra'});
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
        if (!fs.existsSync(target) && !isLink(target)) continue; // setup 没装的文件不凭空加
        if (!isLink(target) && hashFile(target) === hash) continue;
        backupAndCopy(path.join(bundle, rel), target, backupRoot, `extensions/${plugin}/${inner}`, restored, 'plugin');
      }
      // 正式版标记跟着插件走（插件在包外也能知道自己是正式版）
      const mark = path.join(installed, 'guard-build.json');
      const want = JSON.stringify({guard: true, channel: info.channel || 'release', version: info.version || manifest.version}) + '\n';
      try { if (fs.readFileSync(mark, 'utf8') !== want) throw 0; } catch { fs.writeFileSync(mark, want); }
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
          if (hashFile(path.join(bundle, rel)) !== hash) { problems.push(`包里的技能文件 ${rel} 和清单不一致`); continue; }
          backupAndCopy(path.join(bundle, rel), target, backupRoot, `skills/${dir}/${rel.slice('bundled-skills/'.length)}`, restored, 'skill');
        }
      }
    }
    // 4. 用户技能目录：和自带技能同名的停用（不能覆盖自带技能）
    const userSkills = path.join(stateDir, 'user-skills');
    fs.mkdirSync(userSkills, {recursive: true});
    const lower = new Set([...productSkills].map(n => n.toLowerCase()));
    for (const name of fs.readdirSync(userSkills)) {
      if (name.includes('.disabled-same-name-')) continue;
      const skillFile = path.join(userSkills, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const declared = frontName(skillFile) || name;
      if (lower.has(declared.toLowerCase()) || lower.has(name.toLowerCase())) {
        const disabled = path.join(userSkills, `${name}.disabled-same-name-${stamp}`);
        fs.renameSync(path.join(userSkills, name), disabled);
        restored.push({file: disabled, kind: 'user-skill-disabled'});
      }
    }
  }
  // 5. openclaw.json 产品键（包被改过也照样修：这些规则写在校验器里，不依赖包里的文件）
  const configFile = path.join(stateDir, 'openclaw.json');
  let configFixed = [];
  try {
    const raw = fs.readFileSync(configFile, 'utf8');
    const config = JSON.parse(raw);
    configFixed = repairConfig(config, {stateDir, userSkillsDir: path.join(stateDir, 'user-skills')});
    if (configFixed.length) {
      const backup = path.join(backupRoot, 'openclaw.json');
      fs.mkdirSync(path.dirname(backup), {recursive: true});
      fs.writeFileSync(backup, raw, {mode: 0o600});
      const temp = path.join(stateDir, `.openclaw.json.guard-${process.pid}`);
      fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
      fs.renameSync(temp, configFile);
    }
  } catch (error) {
    if (fs.existsSync(configFile)) problems.push(`openclaw.json 没能检查：${error.message}`);
  }

  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const event = {
    at: now().toISOString(), version: info.version || manifest.version || '', trusted: trust.ok, how: trust.how || '',
    nonOfficial: !bundleOk, reason: trust.ok ? (tampered.length ? `包里有 ${tampered.length} 个文件和签名清单不一致` : '') : trust.reason,
    tampered: tampered.slice(0, 20), restored, configFixed, problems, backup: restored.length || configFixed.length ? backupRoot : '', ms: Math.round(ms),
  };
  fs.mkdirSync(guardDir, {recursive: true});
  const previous = readJson(path.join(guardDir, 'status.json'));
  const history = Array.isArray(previous?.history) ? previous.history : [];
  if (restored.length || configFixed.length || event.nonOfficial || problems.length) history.push({at: event.at, restored: restored.length, configFixed, nonOfficial: event.nonOfficial, reason: event.reason});
  const status = {...event, history: history.slice(-20)};
  fs.writeFileSync(path.join(guardDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  if (history.length !== (previous?.history?.length || 0)) {
    fs.appendFileSync(path.join(guardDir, 'guard.log'), JSON.stringify({...event, restored: restored.map(r => `${r.kind}:${r.file}`)}) + '\n');
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
      process.stdout.write(JSON.stringify({guard: result.guard, nonOfficial: result.nonOfficial, restored: result.restored?.length || 0, configFixed: result.configFixed || [], ms: result.ms}) + '\n');
    } else if (command === 'manifest') {
      const dir = rest[0];
      fs.writeFileSync(path.join(dir, 'guard-manifest.json'), JSON.stringify(buildManifest(dir, {commit: arg('--commit', rest) || ''}), null, 1) + '\n');
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
      process.stderr.write('usage: guard.mjs startup|manifest|sign|sign-release|verify-release|sign-latest|verify-latest\n');
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
