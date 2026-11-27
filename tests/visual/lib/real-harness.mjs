// Real Control UI isolated visual & hotspot regression harness.
// Installs the pinned npm `openclaw` version from desktop/windows/runtime-manifest.json
// into an isolated temporary directory, overlays Pinkie UI using the repository's own
// tools/ui-parity/bundle.py and tools/assets/stamp.mjs, and opens the real installed
// dist/control-ui/index.html with scripts/chat-ui-harness/fake-gateway.js and the real
// Windows WebView2 bridge script from app/windows_bridge_scripts.py.
//
// Never touches production paths (%LOCALAPPDATA%\SuperPinkie, Programs\SuperPinkie,
// ~/.openclaw) or port 18789, and never renders a handwritten page skeleton.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import zlib from 'node:zlib';
import {playwright} from '../../../tools/study-desk/harness.mjs';
import {FROZEN_TIME_MS, THEMES, VIEWPORT, VISUAL_SCENES} from './harness.mjs';

export {FROZEN_TIME_MS, THEMES, VIEWPORT, VISUAL_SCENES};
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PREFERRED_PORTS = Object.freeze([5150, 5151, 5152, 5153, 5154, 0]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

// Same set the real gateway uses (openclaw dist/control-ui-*.js STATIC_ASSET_EXTENSIONS):
// a missing file with one of these extensions is a 404, anything else falls back
// to index.html (client-side routes such as /overview, /sessions, /cron).
const STATIC_ASSET_EXTENSIONS = new Set([
  '.js', '.css', '.json', '.map', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.txt', '.webmanifest',
]);

// Every failed request and every HTTP error counts. Nothing is whitelisted:
// the fake server answers each path the way the real gateway does, so a 4xx/5xx
// or an aborted request is a real defect in the page or in the harness.
function describeRequest(origin, rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return null;
    return url.origin === origin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return String(rawUrl);
  }
}

// ---- npm tarball extraction (no external `tar`) ---------------------------
// Git Bash puts GNU tar first in PATH on Windows runners, and GNU tar reads
// `C:\...` as host `C` + path. The bundled Windows bsdtar works, but which one
// wins depends on PATH order. Extract the gzip'd ustar/pax archive in-process
// so the result never depends on PATH.
function tarOctal(buf, off, len) {
  if (buf[off] & 0x80) {
    let v = 0;
    for (let i = off + 1; i < off + len; i += 1) v = v * 256 + buf[i];
    return v;
  }
  const s = buf.toString('latin1', off, off + len).replace(/\0[\s\S]*$/, '').trim();
  return s ? Number.parseInt(s, 8) : 0;
}

function tarString(buf, off, len) {
  const end = buf.indexOf(0, off);
  return buf.toString('utf8', off, end < 0 || end > off + len ? off + len : end);
}

function parsePaxRecords(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp < 0) break;
    const len = Number.parseInt(data.toString('latin1', i, sp), 10);
    if (!len) break;
    const rec = data.toString('utf8', sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

export function extractNpmTarball(tgzPath, outDir, {include = []} = {}) {
  const buf = zlib.gunzipSync(fs.readFileSync(tgzPath));
  const root = path.resolve(outDir);
  let off = 0;
  let pax = null;
  let longName = null;
  let files = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const type = String.fromCharCode(header[156] || 48);
    let size = tarOctal(header, 124, 12);
    let name = tarString(header, 0, 100);
    const prefix = header.toString('latin1', 257, 262) === 'ustar' ? tarString(header, 345, 155) : '';
    if (prefix) name = `${prefix}/${name}`;
    if (pax?.path) name = pax.path;
    if (pax?.size) size = Number(pax.size);
    if (longName) name = longName;
    const dataStart = off + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') { pax = parsePaxRecords(data); continue; }
    if (type === 'g' || type === 'K') continue;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/, ''); continue; }
    pax = null;
    longName = null;
    const parts = name.split('/').filter(Boolean);
    if (parts.includes('..') || path.isAbsolute(name) || /^[A-Za-z]:/.test(name)) {
      throw new Error(`Unsafe path in ${tgzPath}: ${name}`);
    }
    const rel = parts.slice(1).join('/'); // npm tarballs wrap everything in package/
    if (!rel) continue;
    if (include.length && !include.some((p) => rel === p || rel.startsWith(`${p.replace(/\/+$/, '')}/`))) continue;
    const target = path.join(root, ...rel.split('/'));
    if (!target.startsWith(root + path.sep)) throw new Error(`Archive entry escapes ${root}: ${name}`);
    if (type === '5') { fs.mkdirSync(target, {recursive: true}); continue; }
    if (type !== '0' && type !== '\0' && type !== '7') continue;
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, data);
    files += 1;
  }
  if (!files) throw new Error(`No files extracted from ${tgzPath} (include=${include.join(',')})`);
  return files;
}

export function readRuntimeOpenClawVersion(repoRoot = REPO_ROOT) {
  const manifestPath = path.join(repoRoot, 'desktop/windows/runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = String(manifest?.openclaw || '').trim();
  if (!version) {
    throw new Error(`Missing openclaw version in ${manifestPath}`);
  }
  return version;
}

export function buildIsolatedEnv(rootDir) {
  const homeDir = path.join(rootDir, 'home');
  const localAppData = path.join(homeDir, 'AppData', 'Local');
  const localLowAppData = path.join(homeDir, 'AppData', 'LocalLow');
  const roamingAppData = path.join(homeDir, 'AppData', 'Roaming');
  const npmPrefix = path.join(rootDir, 'npm-prefix');
  const npmCache = path.join(rootDir, 'npm-cache');
  const tmpDir = path.join(rootDir, 'tmp');
  for (const dir of [homeDir, localAppData, localLowAppData, roamingAppData, npmPrefix, npmCache, tmpDir]) {
    fs.mkdirSync(dir, {recursive: true});
  }
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: roamingAppData,
    LOCALAPPDATA: localAppData,
    npm_config_prefix: npmPrefix,
    npm_config_cache: npmCache,
    TEMP: tmpDir,
    TMP: tmpDir,
  };
}

function resolvePythonCommand() {
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], {stdio: 'pipe'});
      return cmd;
    } catch {
      // try next candidate
    }
  }
  throw new Error('Python 3 executable not found (tried python3 / python)');
}

function runNpm(args, {cwd, env}) {
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  return execFileSync('npm', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function isValidUpstreamOpenClaw(dir, expectedVersion) {
  try {
    const pkgPath = path.join(dir, 'package.json');
    const indexPath = path.join(dir, 'dist', 'control-ui', 'index.html');
    if (!fs.existsSync(pkgPath) || !fs.existsSync(indexPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg?.name === 'openclaw' && pkg?.version === expectedVersion;
  } catch {
    return false;
  }
}

export function ensureUpstreamOpenClaw(version = readRuntimeOpenClawVersion()) {
  const cacheRoot = process.env.PINKIE_REAL_OPENCLAW_CACHE
    || path.join(os.tmpdir(), 'pinkie-real-ui-cache', `openclaw-${version}`);
  if (isValidUpstreamOpenClaw(cacheRoot, version)) {
    return cacheRoot;
  }

  fs.mkdirSync(path.dirname(cacheRoot), {recursive: true});
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(cacheRoot), `openclaw-${version}-stage-`));
  const env = buildIsolatedEnv(stageRoot);
  const packDir = path.join(stageRoot, 'pack');
  const extractDir = path.join(stageRoot, 'extracted');
  fs.mkdirSync(packDir, {recursive: true});
  fs.mkdirSync(extractDir, {recursive: true});

  try {
    const output = runNpm(
      ['pack', `openclaw@${version}`, '--silent', '--pack-destination', packDir],
      {cwd: packDir, env},
    );
    const tgzName = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
    const tgzPath = path.join(packDir, tgzName);
    if (!tgzName || !fs.existsSync(tgzPath)) {
      throw new Error(`npm pack openclaw@${version} did not produce a tarball (output=${output.trim()})`);
    }
    extractNpmTarball(tgzPath, extractDir, {include: ['package.json', 'dist/control-ui']});
    if (!isValidUpstreamOpenClaw(extractDir, version)) {
      throw new Error(`Extracted openclaw@${version} is missing package.json or dist/control-ui/index.html`);
    }
    try {
      fs.renameSync(extractDir, cacheRoot);
    } catch {
      if (!isValidUpstreamOpenClaw(cacheRoot, version)) {
        fs.rmSync(cacheRoot, {recursive: true, force: true});
        fs.cpSync(extractDir, cacheRoot, {recursive: true});
      }
    }
    return cacheRoot;
  } finally {
    fs.rmSync(stageRoot, {recursive: true, force: true});
  }
}

// Everything the install reads, including this harness (so changing the install
// steps below can never reuse an old entry). Over-inclusion only costs a
// rebuild; a missing input could serve a stale bundle, so whole tool folders are
// hashed. Python bytecode is derived from the sources and is skipped, otherwise
// the first run's __pycache__ would change the key for the next one.
const INSTALL_INPUT_DIRS = ['ui/assets', 'ui/injections', 'ui/runtime', 'tools/ui-parity', 'tools/assets'];
const INSTALL_INPUT_FILES = ['ui/parity-policy.json', 'ui/control-ui.index.html', 'tests/visual/lib/real-harness.mjs'];
const INSTALL_CACHE_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
const INSTALL_STAGE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const INSTALL_COMPLETE_MARK = '.pinkie-install-complete';

export function realUiInstallKey(repoRoot = REPO_ROOT, version = readRuntimeOpenClawVersion(repoRoot)) {
  const hash = crypto.createHash('sha256');
  hash.update(`openclaw@${version}\0`);
  const add = (abs, rel) => {
    const data = fs.readFileSync(abs);
    hash.update(`${rel}\0${data.length}\0`);
    hash.update(data);
  };
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const abs = path.join(dir, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.isFile()) add(abs, childRel);
    }
  };
  for (const dir of INSTALL_INPUT_DIRS) walk(path.join(repoRoot, dir), dir);
  for (const file of INSTALL_INPUT_FILES) {
    const abs = path.join(repoRoot, file);
    if (fs.existsSync(abs)) add(abs, file);
  }
  return hash.digest('hex').slice(0, 20);
}

function runInstallSteps({repoRoot, upstreamDir, packageDir, env}) {
  const controlUiDir = path.join(packageDir, 'dist', 'control-ui');
  fs.mkdirSync(path.dirname(packageDir), {recursive: true});
  fs.cpSync(upstreamDir, packageDir, {recursive: true});
  const pythonCmd = resolvePythonCommand();
  const bundlePy = path.join(repoRoot, 'tools/ui-parity/bundle.py');
  const stampMjs = path.join(repoRoot, 'tools/assets/stamp.mjs');
  const opts = {cwd: repoRoot, env, stdio: 'pipe'};
  execFileSync(pythonCmd, [bundlePy, 'install', '--root', repoRoot, '--control-ui', controlUiDir], opts);
  execFileSync(process.execPath, [stampMjs, '--root', repoRoot, '--control-ui', controlUiDir], opts);
  checkInstalledControlUi({repoRoot, controlUiDir, env});
  return controlUiDir;
}

function checkInstalledControlUi({repoRoot, controlUiDir, env}) {
  const bundlePy = path.join(repoRoot, 'tools/ui-parity/bundle.py');
  execFileSync(resolvePythonCommand(), [bundlePy, 'check', '--root', repoRoot, '--control-ui', controlUiDir], {cwd: repoRoot, env, stdio: 'pipe'});
}

function pruneInstallCache(cacheParent, keepDir) {
  let entries = [];
  try { entries = fs.readdirSync(cacheParent, {withFileTypes: true}); } catch { return; }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(cacheParent, entry.name);
    if (entry.name.startsWith('stage-')) {
      // Left behind by a killed run; a live build is far younger than this.
      try { if (now - fs.statSync(dir).mtimeMs > INSTALL_STAGE_MAX_AGE_MS) fs.rmSync(dir, {recursive: true, force: true}); } catch {}
      continue;
    }
    if (!entry.name.startsWith('installed-') || dir === keepDir) continue;
    try {
      const mark = path.join(dir, INSTALL_COMPLETE_MARK);
      const stamp = fs.existsSync(mark) ? fs.statSync(mark).mtimeMs : fs.statSync(dir).mtimeMs;
      if (now - stamp > INSTALL_CACHE_MAX_IDLE_MS) fs.rmSync(dir, {recursive: true, force: true});
    } catch {}
  }
}

// The installed Control UI (upstream package + bundle install/stamp/check) is
// cached per content key and shared read-only: bundle install is ~57s locally
// (~25s on CI) and every *-real test file used to repeat it. Callers only read
// controlUiDir; per-run state (fake-server prefs, isolated env) lives in a fresh
// runDir that cleanup() removes. Entries are built in a stage folder and renamed
// into place, so concurrent test files or worktrees never see a partial one.
// On every hit bundle.py check still runs (~3s); a failing entry is rebuilt once.
// PINKIE_REAL_UI_NO_CACHE=1 restores a full install into runDir.
export function installRealControlUi({repoRoot = REPO_ROOT, baseDir = os.tmpdir()} = {}) {
  const version = readRuntimeOpenClawVersion(repoRoot);
  const upstreamDir = ensureUpstreamOpenClaw(version);
  const runDir = fs.mkdtempSync(path.join(baseDir, 'pinkie-real-ui-run-'));
  const env = buildIsolatedEnv(runDir);
  const result = (packageDir, controlUiDir, cached) => ({
    version,
    runDir,
    packageDir,
    controlUiDir,
    cached,
    cleanup() {
      fs.rmSync(runDir, {recursive: true, force: true});
    },
  });

  try {
    if (process.env.PINKIE_REAL_UI_NO_CACHE === '1') {
      const packageDir = path.join(runDir, 'node_modules', 'openclaw');
      return result(packageDir, runInstallSteps({repoRoot, upstreamDir, packageDir, env}), false);
    }

    const cacheParent = process.env.PINKIE_REAL_UI_INSTALL_CACHE || path.join(os.tmpdir(), 'pinkie-real-ui-cache');
    const cacheDir = path.join(cacheParent, `installed-${realUiInstallKey(repoRoot, version)}`);
    const packageDir = path.join(cacheDir, 'openclaw');
    const controlUiDir = path.join(packageDir, 'dist', 'control-ui');
    const mark = path.join(cacheDir, INSTALL_COMPLETE_MARK);

    if (fs.existsSync(mark)) {
      try {
        checkInstalledControlUi({repoRoot, controlUiDir, env});
        const now = new Date();
        try { fs.utimesSync(mark, now, now); } catch {}
        return result(packageDir, controlUiDir, true);
      } catch {
        // A cached entry that no longer passes check (e.g. changed by hand) is
        // rebuilt; a fresh build that fails check still throws below.
        fs.rmSync(cacheDir, {recursive: true, force: true});
      }
    }

    // Entries only appear by renaming a finished stage folder (mark included),
    // so a folder without the mark is a half-removed leftover that would make
    // the rename below fail forever.
    if (fs.existsSync(cacheDir) && !fs.existsSync(mark)) fs.rmSync(cacheDir, {recursive: true, force: true});
    fs.mkdirSync(cacheParent, {recursive: true});
    const stageDir = fs.mkdtempSync(path.join(cacheParent, 'stage-'));
    try {
      runInstallSteps({repoRoot, upstreamDir, packageDir: path.join(stageDir, 'openclaw'), env});
      fs.writeFileSync(path.join(stageDir, INSTALL_COMPLETE_MARK), `${version}\n`);
      try {
        fs.renameSync(stageDir, cacheDir);
      } catch (error) {
        // Another process finished the same key first: use its entry, after
        // the same check a cache hit gets. (Our own staged copy was checked
        // inside runInstallSteps before the rename.)
        if (!fs.existsSync(mark)) throw error;
        checkInstalledControlUi({repoRoot, controlUiDir, env});
      }
    } finally {
      fs.rmSync(stageDir, {recursive: true, force: true});
    }
    pruneInstallCache(cacheParent, cacheDir);
    return result(packageDir, controlUiDir, false);
  } catch (error) {
    fs.rmSync(runDir, {recursive: true, force: true});
    throw error;
  }
}

export function extractWindowsBridgeScript(repoRoot = REPO_ROOT) {
  const filePath = path.join(repoRoot, 'app/windows_bridge_scripts.py');
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(/BRIDGE_SCRIPT\s*=\s*r"""([\s\S]*?)"""/);
  if (!match) {
    throw new Error(`Unable to extract BRIDGE_SCRIPT from ${filePath}`);
  }
  return match[1];
}

// Deterministic fake-gateway response extension for RPCs that fake-gateway.js
// currently answers with empty defaults (models catalog for model-picker,
// fixed usage for laolao-usage-stats, and session totalTokens for context viewer).
// Never alters UI behavior or DOM.
// Gateway methods answered by the product's own server code instead of the
// in-page fake-gateway.js default ({}): the composer chips read the session's
// prefs on mount and keep retrying (re-rendering at random times) while the
// answer has no prefs in it. services/mode-architecture/session-prefs.mjs is
// what the installed pinkie-mode-architecture plugin registers for these.
// The study desk game HUD reads pinkie.learning.game.state on mount (s.form.equipped);
// the in-page default {} made it show "Cannot read properties of undefined
// (reading 'equipped')" in .desk-status, which the real gateway never does.
// Those methods are answered by the product's own registerLearningGame() on a
// LearningInteractionStore inside the isolated run dir (no model, no real-paper sync).
const REAL_RPC_METHODS = Object.freeze(['pinkie.prefs.get', 'pinkie.session.prefs.get', 'pinkie.session.prefs.set']);
const REAL_RPC_PREFIXES = Object.freeze(['pinkie.learning.game.']);

async function createRealRpc(repoRoot, stateDir) {
  const mod = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
  const {SessionPrefs} = await mod('services/mode-architecture/session-prefs.mjs');
  const {agentOf} = await mod('services/mode-architecture/session-titles.mjs');
  const {LearningInteractionStore} = await mod('services/mode-architecture/learning.mjs');
  const {registerLearningGame} = await mod('services/mode-architecture/learning-game.mjs');
  fs.mkdirSync(stateDir, {recursive: true});
  const prefs = new SessionPrefs(stateDir);
  // Same wrappers as registerSessionPrefs() in session-prefs.mjs.
  const handlers = {
    'pinkie.prefs.get': () => ({ok: true, ...prefs.globalPrefs()}),
    'pinkie.session.prefs.get': ({key}) => {
      if (typeof key !== 'string' || !agentOf(key)) throw new Error('会话不存在');
      return {ok: true, ...prefs.forSession(key)};
    },
    'pinkie.session.prefs.set': ({key, ...rest}) => prefs.setSession(key, rest),
  };
  const learningRoot = path.join(stateDir, 'learning');
  const store = new LearningInteractionStore({root: learningRoot, workspace: path.join(stateDir, 'workspace')});
  store.materials = {root: path.join(stateDir, 'learning-materials')};
  const registered = {};
  registerLearningGame({
    registerGatewayMethod: (name, handler) => { registered[name] = handler; },
    registerHttpRoute: () => {},
    logger: {warn: () => {}, info: () => {}},
  }, store, {requestModel: null, autoReal: false});
  return async (method, params) => {
    if (registered[method]) {
      return new Promise((resolve) => {
        Promise.resolve(registered[method]({params: params || {}, respond: (ok, payload, error) => resolve({ok: Boolean(ok), payload, error})}))
          .catch((error) => resolve({ok: false, error: {message: String(error?.message || error)}}));
      });
    }
    const fn = handlers[method];
    if (!fn) return {ok: false, error: {message: `unsupported ${method}`}};
    // registerSessionPrefs() answers ok:true and puts {ok:false, error} in the payload.
    try { return {ok: true, payload: await fn(params || {})}; } catch (error) { return {ok: true, payload: {ok: false, error: error.message}}; }
  };
}

const FAKE_GATEWAY_EXT_SCRIPT = `(() => {
  'use strict';
  const BaseSocket = window.WebSocket;
  if (!BaseSocket || BaseSocket.__pinkieRealHarnessWrapped) return;
  const REAL_RPC_METHODS = ${JSON.stringify(REAL_RPC_METHODS)};
  const REAL_RPC_PREFIXES = ${JSON.stringify(REAL_RPC_PREFIXES)};
  const isRealRpc = (method) => REAL_RPC_METHODS.includes(method) || REAL_RPC_PREFIXES.some((p) => String(method || '').startsWith(p));
  const origSend = BaseSocket.prototype.send;
  const origRaw = BaseSocket.prototype._raw;
  if (typeof origRaw === 'function') {
    BaseSocket.prototype._raw = function patchedRaw(obj) {
      if (obj && obj.type === 'res' && obj.ok && Array.isArray(obj.payload?.sessions)) {
        const sessions = obj.payload.sessions.map((s) => (
          s && typeof s === 'object'
            ? {
                ...s,
                totalTokens: s.totalTokens ?? 128000,
                contextTokens: s.contextTokens ?? 1000000,
              }
            : s
        ));
        return origRaw.call(this, {...obj, payload: {...obj.payload, sessions}});
      }
      return origRaw.call(this, obj);
    };
  }
  BaseSocket.prototype.send = function patchedSend(data) {
    try {
      const frame = JSON.parse(data);
      if (frame && frame.type === 'req') {
        (window.__realHarnessRpcLog ||= []).push(frame.method);
        if (isRealRpc(frame.method)) {
          fetch('/__pinkie-rpc', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({method: frame.method, params: frame.params || {}}),
          })
            .then((res) => res.json())
            .then((r) => this._raw?.(r.ok
              ? {type: 'res', id: frame.id, ok: true, payload: r.payload}
              : {type: 'res', id: frame.id, ok: false, error: r.error || {message: 'failed'}}))
            .catch((error) => this._raw?.({type: 'res', id: frame.id, ok: false, error: {message: String(error)}}));
          return;
        }
        if ((frame.method === 'chat.metadata' || frame.method === 'models.list') && Array.isArray(window.__realHarnessModels)) {
          const models = window.__realHarnessModels;
          const reply = () => this._raw?.({type: 'res', id: frame.id, ok: true, payload: {models}});
          // Only the readiness regression test sets this (via opts.initScript): the catalog
          // reply is parked until the test releases it, i.e. it arrives late the way it can on
          // a slow runner. Unset, the reply stays a microtask as before.
          if (frame.method === 'chat.metadata' && window.__realHarnessHoldCatalog) (window.__realHarnessHeldCatalog ||= []).push(reply);
          else Promise.resolve().then(reply);
          return;
        }
        if (frame.method === 'pinkie.usage.get') {
          Promise.resolve().then(() => {
            this._raw?.({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: {
                scope: 'lifetime',
                input: 12400,
                output: 4800,
                cacheRead: 3200,
                cacheWrite: 0,
                cost: 0.04,
                requests: 12,
                successRate: 100,
                updatedAt: ${FROZEN_TIME_MS},
                source: '累计 · 隔离测试网关',
              },
            });
          });
          return;
        }
      }
    } catch {
      // Fall through to original fake-gateway.js handler
    }
    return origSend.call(this, data);
  };
  BaseSocket.__pinkieRealHarnessWrapped = true;
})();`;

async function listenOnPreferredPort(server, ports = PREFERRED_PORTS) {
  let lastError = null;
  for (const port of ports) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      return server.address().port;
    } catch (err) {
      lastError = err;
      if (err?.code !== 'EADDRINUSE' && err?.code !== 'EACCES') {
        throw err;
      }
    }
  }
  throw lastError || new Error('Failed to bind local real-UI server');
}

// ---- real gateway HTTP surface ---------------------------------------------
// Mirrors openclaw dist/control-ui-*.js handleControlUiHttpRequest /
// handleControlUiAvatarRequest for an installed Super Pinkie (basePath ''):
//   * /control-ui-config.json (+ the two legacy aliases) -> bootstrap payload
//   * /avatar/<agentId>?meta=1 -> avatar resolution JSON; /avatar/<agentId> -> image or 404
//   * existing control-ui file -> file; missing *.js/.css/.json/... -> 404
//   * anything else (client routes /chat, /overview, /sessions, /cron ...) -> index.html
// Agent identities come from the repo's personas/*/IDENTITY.md and avatar files
// from the same table app/super_pinkie.py uses to seed workspace avatars.
const AGENT_PERSONA_DIRS = Object.freeze({
  main: 'chat', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'neutral', metre: 'metre',
});
const BOOTSTRAP_CONFIG_PATHS = new Set(['/control-ui-config.json', '/__openclaw/control-ui-config.json', '/__openclaw__/control-ui-config.json']);

function readIdentityField(text, field) {
  const m = String(text || '').match(new RegExp(`^\\s*-\\s*\\*\\*${field}:\\*\\*\\s+(.+?)\\s*$`, 'im'));
  return m ? m[1].trim() : '';
}

export function loadAgentIdentities(repoRoot = REPO_ROOT) {
  const appSource = fs.readFileSync(path.join(repoRoot, 'app/super_pinkie.py'), 'utf8');
  const seeded = new Map();
  for (const m of appSource.matchAll(/\(\s*"(workspace(?:-[a-z]+)?)"\s*,\s*"([^"]+\.png)"\s*,\s*"([^"]+\.png)"\s*\)/g)) {
    seeded.set(`${m[1]}/avatars/${m[3]}`, path.join(repoRoot, 'ui/assets', m[2]));
  }
  if (!seeded.size) throw new Error('Unable to read workspace avatar table from app/super_pinkie.py');
  const identities = {};
  for (const [agentId, personaDir] of Object.entries(AGENT_PERSONA_DIRS)) {
    const identityPath = path.join(repoRoot, 'personas', personaDir, 'IDENTITY.md');
    const text = fs.existsSync(identityPath) ? fs.readFileSync(identityPath, 'utf8') : '';
    const avatarSource = readIdentityField(text, 'Avatar') || null;
    const workspace = agentId === 'main' ? 'workspace' : `workspace-${agentId}`;
    const filePath = avatarSource ? seeded.get(`${workspace}/${avatarSource.replace(/\\/g, '/')}`) || null : null;
    identities[agentId] = {
      agentId,
      name: readIdentityField(text, 'Name') || 'Assistant',
      avatarSource,
      avatarFile: filePath && fs.existsSync(filePath) ? filePath : null,
    };
  }
  return identities;
}

function avatarMeta(identity) {
  if (!identity?.avatarSource) return {avatarSource: null, avatarStatus: 'none', avatarReason: 'missing'};
  if (!identity.avatarFile) return {avatarSource: identity.avatarSource, avatarStatus: 'none', avatarReason: 'missing'};
  return {avatarSource: identity.avatarSource, avatarStatus: 'local', avatarReason: null};
}

function bootstrapConfigPayload(identities, version, runDir) {
  const main = identities.main;
  const meta = avatarMeta(main);
  return {
    basePath: '',
    assistantName: main.name,
    assistantAvatar: meta.avatarStatus === 'local' ? '/avatar/main' : (main.avatarSource || 'A'),
    assistantAvatarSource: meta.avatarSource,
    assistantAvatarStatus: meta.avatarStatus,
    assistantAvatarReason: meta.avatarReason,
    assistantAgentId: 'main',
    serverVersion: version,
    localMediaPreviewRoots: runDir ? [path.join(runDir, 'home', '.openclaw', 'workspace')] : [],
    embedSandbox: 'scripts',
    allowExternalEmbedUrls: false,
    terminalEnabled: false,
  };
}

function sendGatewayNotFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not Found');
}

export async function startRealUiServer({
  controlUiDir,
  repoRoot = REPO_ROOT,
  ports = PREFERRED_PORTS,
  version = readRuntimeOpenClawVersion(repoRoot),
  runDir = null,
} = {}) {
  if (!controlUiDir || !fs.existsSync(path.join(controlUiDir, 'index.html'))) {
    throw new Error(`Invalid controlUiDir: ${controlUiDir}`);
  }
  const fakeGatewayPath = path.join(repoRoot, 'scripts/chat-ui-harness/fake-gateway.js');
  const identities = loadAgentIdentities(repoRoot);
  const stateRoot = runDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-real-ui-state-'));
  const realRpc = await createRealRpc(repoRoot, path.join(stateRoot, 'home', '.openclaw', 'pinkie-mode-architecture'));
  const rootResolved = path.resolve(controlUiDir);
  const requests = [];

  const sendIndex = (res) => {
    const rawHtml = fs.readFileSync(path.join(controlUiDir, 'index.html'), 'utf8');
    const injectTags = [
      '<script src="/__fake-gateway.js"></script>',
      '<script src="/__fake-gateway-ext.js"></script>',
      '<script src="/__windows-bridge.js"></script>',
    ].join('\n');
    const html = rawHtml
      .replace(/<html\b/i, '<html data-openclaw-terminal-enabled="false"')
      .replace(/<head>/i, `<head>\n${injectTags}`);
    res.setHeader('Content-Type', MIME['.html']);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(html);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    res.on('finish', () => requests.push({method: req.method, path: pathname, status: res.statusCode}));
    if (pathname === '/__fake-gateway.js' || pathname === '/__fake-gateway-ext.js' || pathname === '/__windows-bridge.js') {
      res.setHeader('Content-Type', MIME['.js']);
      res.setHeader('Cache-Control', 'no-store');
      res.end(pathname === '/__fake-gateway.js'
        ? fs.readFileSync(fakeGatewayPath, 'utf8')
        : pathname === '/__fake-gateway-ext.js' ? FAKE_GATEWAY_EXT_SCRIPT : extractWindowsBridgeScript(repoRoot));
      return;
    }
    if (pathname === '/__pinkie-rpc' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        let payload;
        try {
          const {method, params} = JSON.parse(body || '{}');
          payload = await realRpc(String(method || ''), params);
        } catch (error) {
          payload = {ok: false, error: {message: String(error?.message || error)}};
        }
        res.setHeader('Content-Type', MIME['.json']);
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(payload));
      });
      return;
    }
    if (BOOTSTRAP_CONFIG_PATHS.has(pathname)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME['.json']);
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(bootstrapConfigPayload(identities, version, runDir)));
      return;
    }
    if (pathname.startsWith('/avatar/')) {
      const parts = pathname.slice('/avatar/'.length).split('/').filter(Boolean);
      const agentId = parts[0] || '';
      if (parts.length !== 1 || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agentId)) { sendGatewayNotFound(res); return; }
      const identity = identities[agentId.toLowerCase()] || null;
      const meta = avatarMeta(identity);
      if (url.searchParams.get('meta') === '1') {
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME['.json']);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify({avatarUrl: meta.avatarStatus === 'local' ? `/avatar/${agentId}` : null, ...meta}));
        return;
      }
      if (meta.avatarStatus !== 'local') { sendGatewayNotFound(res); return; }
      res.setHeader('Content-Type', MIME[path.extname(identity.avatarFile).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(fs.readFileSync(identity.avatarFile));
      return;
    }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { sendGatewayNotFound(res); return; }
    const assetsIndex = decoded.indexOf('/assets/');
    const rel = decoded === '/' ? '' : assetsIndex >= 0 ? decoded.slice(assetsIndex + 1) : decoded.slice(1);
    const fileRel = (rel && !rel.endsWith('/') ? rel : `${rel}index.html`) || 'index.html';
    const normalized = path.posix.normalize(fileRel);
    if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized) || normalized.includes('\0')) {
      sendGatewayNotFound(res);
      return;
    }
    const target = path.resolve(rootResolved, normalized);
    if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) { sendGatewayNotFound(res); return; }
    const isFile = fs.existsSync(target) && fs.statSync(target).isFile();
    if (isFile && path.basename(target) === 'index.html') { sendIndex(res); return; }
    if (isFile) {
      res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(fs.readFileSync(target));
      return;
    }
    if (STATIC_ASSET_EXTENSIONS.has(path.extname(normalized).toLowerCase())) { sendGatewayNotFound(res); return; }
    sendIndex(res);
  });

  const port = await listenOnPreferredPort(server, ports);
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    controlUiDir,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}

// Browser chosen explicitly so a baseline always comes from the same engine:
// Playwright's pinned Chromium on Linux and Windows alike (install it with
// `playwright install chromium-headless-shell`, as CI does). PINKIE_VISUAL_ENGINE
// overrides (chromium | chrome | msedge) for local experiments only.
export function resolveRealEngine(engine = process.env.PINKIE_VISUAL_ENGINE || '') {
  if (engine) return engine;
  // Playwright's own pinned Chromium (headless-shell, revision fixed by the
  // playwright version in tools/pinkie-toolbox/toolbox-manifest.json) on every
  // platform. The system Chrome channel auto-updates (154 locally vs 157 on the
  // windows-latest runner), which moved text rendering by 0.2-1.3% and made a
  // committed win32 baseline drift on its own.
  return 'chromium';
}

export async function launchRealBrowser(engine = resolveRealEngine()) {
  const {chromium} = playwright();
  const launchOpts = {
    headless: true,
    args: [
      '--disable-gpu',
      '--font-render-hinting=none',
      '--disable-font-subpixel-positioning',
      '--disable-lcd-text',
      '--force-color-profile=srgb',
      '--num-raster-threads=1',
      // Without these, separate pages of the same scene differ by a few pixels at
      // 1-4 channel levels (partial raster / checker-imaging / threaded compositor
      // timing). Measured on Windows Chrome: 0 px across 4 captures with them,
      // up to 32 px without. Rendering output is otherwise unchanged.
      '--disable-partial-raster',
      '--disable-checker-imaging',
      '--run-all-compositor-stages-before-draw',
      '--disable-threaded-animation',
      '--disable-threaded-scrolling',
      '--disable-image-animation-resync',
      '--disable-skia-runtime-opts',
    ],
  };
  const browser = engine === 'msedge' || engine === 'chrome'
    ? await chromium.launch({...launchOpts, channel: engine})
    : await chromium.launch(launchOpts);
  browser.__pinkieEngine = engine;
  return browser;
}

export function realBaselinePlatform() {
  return process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : process.platform;
}

const REAL_LONG_HISTORY = Object.freeze([
  {
    role: 'user',
    content: [{type: 'text', text: '帮我核对一下当前隔离安装后的真实控制界面，并检查工具调用过程卡和阅读位置保持。'}],
    timestamp: FROZEN_TIME_MS - 600_000,
  },
  {
    role: 'assistant',
    content: [
      {type: 'thinking', thinking: '先核对 desktop/windows/runtime-manifest.json 里的 OpenClaw 版本，再检查 bundle.py 校验输出。'},
      {type: 'text', text: '我先读取版本清单并核对安装后的 UI 资源。'},
      {type: 'toolCall', id: 'm5_call_read_1', name: 'read', arguments: {path: 'desktop/windows/runtime-manifest.json'}},
    ],
    stopReason: 'toolUse',
    timestamp: FROZEN_TIME_MS - 540_000,
  },
  {
    role: 'toolResult',
    toolCallId: 'm5_call_read_1',
    toolName: 'read',
    content: [{type: 'text', text: '{\n  "node": "24.20.0",\n  "openclaw": "2026.7.1-2"\n}'}],
    timestamp: FROZEN_TIME_MS - 530_000,
  },
  {
    role: 'assistant',
    content: [
      {type: 'text', text: '再执行一次共享 UI 一致性校验。'},
      {type: 'toolCall', id: 'm5_call_exec_2', name: 'exec', arguments: {command: 'python tools/ui-parity/bundle.py check'}},
    ],
    stopReason: 'toolUse',
    timestamp: FROZEN_TIME_MS - 480_000,
  },
  {
    role: 'toolResult',
    toolCallId: 'm5_call_exec_2',
    toolName: 'exec',
    content: [{type: 'text', text: 'shared UI check OK: 203 entries, 1686 resources'}],
    timestamp: FROZEN_TIME_MS - 470_000,
  },
  {
    role: 'assistant',
    content: [{type: 'text', text: '已完成核对：真实页面已挂载 OpenClaw Control UI 与碧琪全部注入脚本，工具过程卡与聊天主列边界正常。'}],
    stopReason: 'stop',
    timestamp: FROZEN_TIME_MS - 420_000,
  },
  {
    role: 'user',
    content: [{type: 'text', text: '继续补充长对话内容，确保对话线程足够长可以滚动，并验证局部追加后滚动位置不跳回顶部。'}],
    timestamp: FROZEN_TIME_MS - 360_000,
  },
  {
    role: 'assistant',
    content: [{type: 'text', text: '收到。下面是第二段长回复，用来撑开真实 `.chat-thread` 的垂直高度：\n1. 侧栏展开与收起由真实 `laolao-sidebar-autohide.js` 控制。\n2. 模式切换由真实 `laolao-mode-switcher.js` 控制。\n3. 窗口右上角按钮由真实 `app/windows_bridge_scripts.py` 挂载。'}],
    stopReason: 'stop',
    timestamp: FROZEN_TIME_MS - 300_000,
  },
  {
    role: 'user',
    content: [{type: 'text', text: '日夜主题与模型选择弹层呢？'}],
    timestamp: FROZEN_TIME_MS - 240_000,
  },
  {
    role: 'assistant',
    content: [{type: 'text', text: '日夜主题由真实 `laolao-night.js` 与 `laolao-night.css` 联动，模型选择弹层由 `laolao-model-picker.js` 计算边界，确保不超出视口且保持可读对比度。'}],
    stopReason: 'stop',
    timestamp: FROZEN_TIME_MS - 180_000,
  },
]);

const REAL_SHORT_HISTORY = Object.freeze([
  {
    role: 'user',
    content: [{type: 'text', text: '请核对当前工作区的视觉与热点回归状态。'}],
    timestamp: FROZEN_TIME_MS - 120_000,
  },
  {
    role: 'assistant',
    content: [{type: 'text', text: '已就绪：当前在隔离目录中运行真实安装的 OpenClaw Control UI 与碧琪界面。'}],
    stopReason: 'stop',
    timestamp: FROZEN_TIME_MS - 60_000,
  },
]);

const REAL_MODELS = Object.freeze([
  {provider: 'google', id: 'gemini-3-pro', name: 'Gemini 3 Pro', available: true, contextWindow: 1_000_000, reasoning: true},
  {provider: 'google', id: 'gemini-3-flash', name: 'Gemini 3 Flash', available: true, contextWindow: 1_000_000, reasoning: true},
  {provider: 'openai', id: 'gpt-5.2', name: 'GPT-5.2', available: true, contextWindow: 400_000, reasoning: true},
  {provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', available: true, contextWindow: 200_000, reasoning: true},
]);

const REAL_QUIZ_ACTIVITY = Object.freeze({
  id: 'm5-real-study-quiz-1',
  kind: 'single_choice',
  title: '非谓语动词 · 回归自检',
  question: 'This museum is well worth ______.',
  options: ['to visit', 'visiting', 'visited', 'be visited'],
  correctIndex: 1,
  explanation: 'be worth 后固定接动名词（-ing）主动形式表示被动含义。',
});

export function sceneMeta(sceneId) {
  const scene = VISUAL_SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown visual scene: ${sceneId}`);
  const isHome = scene.id.startsWith('home-');
  const agentId = scene.mode === 'chat' ? 'main' : scene.mode;
  const sessionKey = `agent:${agentId}:dashboard:harness0001`;
  return {...scene, isHome, agentId, sessionKey};
}

export async function settleRealPage(page, theme, {lockPerfClock = false} = {}) {
  const isNight = theme === 'night';
  await page.evaluate(async ({dark, lockClock}) => {
    // Sync theme through real laolao-night controller if needed
    const wantMode = dark ? 'dark' : 'light';
    if (document.documentElement.getAttribute('data-theme-mode') !== wantMode) {
      window.__pinkieNight?.setMode?.(wantMode);
      document.documentElement.setAttribute('data-theme-mode', wantMode);
      document.documentElement.toggleAttribute('data-pinkie-night', dark);
    }

    // Wait until the real page stops changing on its own: late gateway replies
    // and debounced injections (composer tray, usage chips, session list) land at
    // different times on a busy machine, so a fixed sleep is not enough. A quiet
    // window is QUIET_MS without any DOM mutation, capped at MAX_MS.
    const waitForQuietDom = (quietMs, maxMs) => new Promise((resolve) => {
      let quietTimer = null;
      let mutations = 0;
      const finish = (quiet) => {
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        resolve({quiet, mutations});
      };
      // Rewrites that leave the value unchanged (e.g. a timer re-assigning the
      // same className) cannot change pixels and do not count.
      const changed = (rec) => {
        if (rec.type === 'attributes') return rec.oldValue !== rec.target.getAttribute(rec.attributeName);
        if (rec.type === 'characterData') return rec.oldValue !== rec.target.data;
        return true;
      };
      const observer = new MutationObserver((records) => {
        const real = records.filter(changed).length;
        if (!real) return;
        mutations += real;
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(true), quietMs);
      });
      observer.observe(document, {
        subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true,
      });
      quietTimer = setTimeout(() => finish(true), quietMs);
      const hardTimer = setTimeout(() => finish(false), maxMs);
    });
    window.__pinkieRealSettle = {first: await waitForQuietDom(400, 8000)};

    // Remove one-shot entrance classes that auto-clear on a timer
    document.querySelectorAll('.laolao-welcome--materializing').forEach((el) => {
      el.classList.remove('laolao-welcome--materializing');
    });

    // Freeze performance.now during laolao-usage-stats refresh so linkLatency is
    // deterministically 0ms. When lockClock=true (screenshot-only capture before
    // closing context), keep it locked so any pending 500ms sessions-changed
    // debounce cannot overwrite 0ms with a live wall-clock latency.
    const origPerfNow = performance.now.bind(performance);
    try {
      if (window.__laolaoUsage?.refresh) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          performance.now = () => 1000;
          await window.__laolaoUsage.refresh();
          const link = window.__laolaoUsage.link;
          if (link?.online && link.latency === 0) break;
          await new Promise((r) => setTimeout(r, 40));
        }
      }
    } finally {
      if (!lockClock) {
        performance.now = origPerfNow;
      }
    }

    // Finish any active Web Animations (e.g. usage chip pulse)
    if (typeof document.getAnimations === 'function') {
      for (const anim of document.getAnimations({subtree: true})) {
        try { anim.finish(); } catch { try { anim.cancel(); } catch {} }
      }
    }

    // Ensure all fonts, <img> elements, and CSS background images are decoded
    if (document.fonts) {
      await Promise.all([...document.fonts].map((font) => font.load().catch(() => {})));
      await document.fonts.ready;
    }
    await Promise.all([...document.images].map(async (img) => {
      if (!img.complete) {
        await new Promise((r) => {
          img.addEventListener('load', r, {once: true});
          img.addEventListener('error', r, {once: true});
        });
      }
      if (typeof img.decode === 'function') {
        await img.decode().catch(() => {});
      }
    }));

    const bgUrls = new Set();
    const collectBg = (style) => {
      const bg = style?.backgroundImage || '';
      for (const match of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
        if (match[2] && !match[2].startsWith('data:')) bgUrls.add(match[2]);
      }
    };
    for (const el of [document.documentElement, document.body, ...document.querySelectorAll('*')]) {
      collectBg(getComputedStyle(el));
      collectBg(getComputedStyle(el, '::before'));
      collectBg(getComputedStyle(el, '::after'));
    }
    await Promise.all([...bgUrls].map(async (url) => {
      const probe = new Image();
      probe.src = url;
      await probe.decode().catch(() => {});
    }));

    // Blur focused inputs/textareas so high-specificity caret-color:!important rules
    // cannot leave a blinking caret in the screenshot.
    const blurAll = () => {
      if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      for (const field of document.querySelectorAll('textarea:focus, input:focus')) {
        field.blur();
      }
    };
    blurAll();
    // The real composer textarea still paints a blinking caret on some frames even
    // after blur (activeElement is <body>), and Playwright's caret:'hide' does not
    // reach every product rule. Hide the caret everywhere, which is what caret:'hide'
    // intends; nothing else about the page is changed.
    const hideCaret = (root) => {
      const style = document.createElement('style');
      style.setAttribute('data-real-harness', 'caret');
      style.textContent = '*, *::before, *::after { caret-color: transparent !important; }';
      (root === document ? document.head : root).appendChild(style);
    };
    hideCaret(document);
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) hideCaret(el.shadowRoot);
    window.__pinkieRealSettle.last = await waitForQuietDom(250, 3000);
    if (typeof document.getAnimations === 'function') {
      for (const anim of document.getAnimations({subtree: true})) {
        try { anim.finish(); } catch { try { anim.cancel(); } catch {} }
      }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    blurAll();
    await new Promise((r) => requestAnimationFrame(r));
  }, {dark: isNight, lockClock: lockPerfClock});
}

export async function assertRealPageLoaded(page) {
  const proof = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource').map((r) => r.name);
    const hasOpenClawIndex = resources.some((name) => /\/assets\/index-[^/?#]+\.js/i.test(name));
    const hasOpenClawChatPage = resources.some((name) => /\/assets\/chat-page-[^/?#]+\.js/i.test(name));
    const laolaoTags = document.querySelectorAll('script[src*="laolao-"], link[href*="laolao-"]').length;
    const onSettingsRoute = String(location.pathname || '').startsWith('/settings');
    return {
      definedApp: Boolean(customElements.get('openclaw-app')),
      hasAppEl: Boolean(document.querySelector('openclaw-app')),
      hasChatPane: Boolean(document.querySelector('openclaw-chat-pane')),
      onSettingsRoute,
      hasFakeSkeleton: Boolean(document.querySelector('#m5-sidebar, .m5-shell, .m5-stage')),
      hasOpenClawIndex,
      hasOpenClawChatPage,
      laolaoTags,
    };
  });
  if (!proof.definedApp || !proof.hasAppEl || (!proof.hasChatPane && !proof.onSettingsRoute)) {
    throw new Error(`Real OpenClaw Control UI did not mount: ${JSON.stringify(proof)}`);
  }
  if (proof.hasFakeSkeleton) {
    throw new Error(`Detected forbidden handwritten skeleton DOM: ${JSON.stringify(proof)}`);
  }
  if (!proof.hasOpenClawIndex || !proof.hasOpenClawChatPage) {
    throw new Error(`Real OpenClaw runtime chunks were not loaded: ${JSON.stringify(proof)}`);
  }
  if (proof.laolaoTags < 100) {
    throw new Error(`Expected >= 100 Pinkie UI injection tags, got ${proof.laolaoTags}`);
  }
  return proof;
}

// The model picker fills its list from an async catalog (laolao-model-picker.js
// ensureFallbackData: chat.metadata + sessions.list), then re-sorts and re-renders.
// A menu taller than 40px only means the shell is open, so a fixed wait after it can
// shoot a half-filled or still-reordering list (model-picker-day 0.5–0.85% red on
// #302 / #313). Ready = the catalog has landed (data-pinkie-fallback-ready="1", set
// for both a list and an error) and the menu's text, option order, selection and
// height stay the same for two frames in a row. Counts frames, not ms: the page's
// Date is frozen. Returns what it settled on so tests can check it.
export async function waitModelPickerReady(page, {timeout = 10_000} = {}) {
  await page.waitForFunction(() => {
    const details = document.querySelector('details.chat-controls__model[open], details.chat-controls__model-picker[open]');
    const menu = details?.querySelector('.chat-controls__inline-select-menu--combined');
    return Boolean(menu && menu.getBoundingClientRect().height > 40 && details.dataset.pinkieFallbackReady === '1');
  }, {timeout});
  return page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const read = () => {
      const details = document.querySelector('details.chat-controls__model[open], details.chat-controls__model-picker[open]');
      const menu = details?.querySelector('.chat-controls__inline-select-menu--combined');
      if (!menu) return null;
      const all = [...menu.querySelectorAll('.chat-controls__combined-model-option, [data-chat-model-option]')];
      const options = all
        .filter((el) => el.getClientRects().length)
        .map((el) => `${el.textContent.trim()}|${el.getAttribute('aria-selected') || ''}`);
      // The default 常用模型 tab can legitimately be empty (no favourites or recent models yet):
      // rows are then in the DOM but hidden, and the picker shows its empty-state line instead.
      // rows = every model row the catalog produced (hidden or not); empty = the visible empty line.
      const emptyEl = menu.querySelector('.pinkie-model-empty');
      const empty = emptyEl && emptyEl.getClientRects().length ? emptyEl.textContent.trim() : '';
      return {options, rows: all.length, empty, height: Math.round(menu.getBoundingClientRect().height), text: menu.textContent.replace(/\s+/g, ' ').trim()};
    };
    let last = JSON.stringify(read());
    let same = 0;
    for (let i = 0; i < 600 && same < 2; i++) {
      await frame();
      const now = JSON.stringify(read());
      same = now === last ? same + 1 : 0;
      last = now;
    }
    if (same < 2) throw new Error(`model picker list never held still for two frames: ${last.slice(0, 200)}`);
    return JSON.parse(last);
  });
}

export async function openRealScenePage(browser, origin, sceneId, theme = 'day', opts = {}) {
  const meta = sceneMeta(sceneId);
  const isNight = theme === 'night';
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: opts.deviceScaleFactor || 1,   // B36 高 DPI 走查传 1.25 / 1.5；不给就是 1，现有场景和基线不变
    colorScheme: isNight ? 'dark' : 'light',
    locale: 'zh-CN',
    ...(opts.timezoneId ? {timezoneId: opts.timezoneId} : {}),   // 不给就跟着机器（CI 上是 UTC）
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });

  const extraInit = opts.initScript || null;
  // Chromium keeps only 250 resource timing entries by default. The real page already fills it
  // (Pinkie injects ~200 tags), so later chunks such as chat-page-*.js can be dropped and
  // assertRealPageLoaded() below would misjudge them as "not loaded". Only the buffer size is
  // raised here; what the check looks for is unchanged.
  await context.addInitScript(() => {
    if (typeof performance !== 'undefined' && typeof performance.setResourceTimingBufferSize === 'function') {
      performance.setResourceTimingBufferSize(2000);
    }
  });
  await context.addInitScript(({
    frozenMs,
    isNight: dark,
    meta: m,
    longHistory,
    shortHistory,
    models,
  }) => {
    const OrigDate = Date;
    class FrozenDate extends OrigDate {
      constructor(...args) { super(...(args.length ? args : [frozenMs])); }
      static now() { return frozenMs; }
    }
    window.Date = FrozenDate;
    window.__laolaoStartupHomeClock = () => new FrozenDate(frozenMs);

    let seed = 0x51505150;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    window.__laolaoStartupHomeRandom = Math.random;

    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('pinkie.motion.reduce.v1', '1');
    localStorage.setItem('laolao:motion-preference', 'reduce');
    localStorage.setItem('laolao:active-mode', m.mode);
    localStorage.setItem('laolao.workspaceMode.v1', m.mode);
    localStorage.setItem(`laolao:last-session:${m.mode}`, m.sessionKey);
    localStorage.setItem('openclaw.i18n.locale', 'zh-CN');
    localStorage.setItem('pinkie-buddy-prefs-v1', JSON.stringify({ambient: false, narrate: false, quotes: false}));

    if (!m.isHome) {
      sessionStorage.setItem('laolao:startup-home-seen', '1');
    }

    const gatewayUrl = location.origin.replace(/^http/, 'ws');
    const settingsPayload = JSON.stringify({
      gatewayUrl,
      token: 'm5-real-harness',
      sessionKey: m.sessionKey,
      lastActiveSessionKey: m.sessionKey,
      themeMode: dark ? 'dark' : 'light',
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 238,
      navGroupsCollapsed: {},
      borderRadius: 50,
    });
    localStorage.setItem('openclaw.control.settings.v1', settingsPayload);
    localStorage.setItem(`openclaw.control.settings.v1:${gatewayUrl}`, settingsPayload);
    localStorage.setItem(`openclaw.control.currentGateway.v1:${gatewayUrl}`, gatewayUrl);

    window.__realHarnessModels = models;
    window.__fakeExtraSessions = [
      ...(m.isHome ? [{
        key: m.sessionKey,
        sessionId: 'harness-session-0001',
        label: '新会话',
        displayName: '新会话',
        lastMessagePreview: '',
        updatedAt: frozenMs,
        agentId: m.agentId,
      }] : []),
      {
        key: `agent:${m.agentId}:dashboard:prev01`,
        sessionId: 'harness-prev-01',
        label: '视觉基线与热点核对',
        displayName: '视觉基线与热点核对',
        lastMessagePreview: '已完成真实页面视觉基线与十个热点核对。',
        updatedAt: frozenMs - 120_000,
        agentId: m.agentId,
      },
      {
        key: `agent:${m.agentId}:dashboard:prev02`,
        sessionId: 'harness-prev-02',
        label: '工作台布局回归记录',
        displayName: '工作台布局回归记录',
        lastMessagePreview: '侧栏展开与收起宽度已验证无回归。',
        updatedAt: frozenMs - 3_600_000,
        agentId: m.agentId,
      },
    ];

    if (m.isHome) {
      window.__fakeSeedHistory = [];
    } else if (m.id === 'long-conversation') {
      window.__fakeSeedHistory = longHistory;
    } else {
      window.__fakeSeedHistory = shortHistory;
    }
  }, {
    frozenMs: FROZEN_TIME_MS,
    isNight,
    meta,
    longHistory: REAL_LONG_HISTORY,
    shortHistory: REAL_SHORT_HISTORY,
    models: REAL_MODELS,
  });

  if (typeof extraInit === 'function') {
    await context.addInitScript(extraInit);
  }

  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) => {
    const where = describeRequest(origin, req.url());
    if (where) failedRequests.push(`${req.method()} ${where}: ${req.failure()?.errorText || 'failed'}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const where = describeRequest(origin, res.url());
      if (where) failedRequests.push(`${res.status()} ${where}`);
    }
  });

  const targetUrl = `${origin}/chat?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`;
  await page.goto(targetUrl, {waitUntil: 'load', timeout: 60_000});

  // Wait for splash screen to clear and real OpenClaw + Pinkie UI to mount
  await page.waitForFunction(() => !document.getElementById('laolao-splash'), {timeout: 30_000});
  await page.waitForFunction(() => (
    Boolean(document.querySelector('openclaw-chat-pane'))
    && Boolean(document.querySelector('.chat-main'))
    && Boolean(document.querySelector('.agent-chat__input'))
    && Boolean(document.querySelector('#laolao-session-manager'))
    && Boolean(document.getElementById('pinkie-native-window-controls'))
  ), {timeout: 15_000});

  if (meta.isHome) {
    await page.waitForFunction(() => {
      const st = window.__laolaoStartupHome?.status?.();
      return document.documentElement.getAttribute('data-laolao-startup-ready') === '1'
        && Boolean(document.querySelector('.laolao-startup-home__greeting')?.textContent?.trim())
        && document.querySelectorAll('.laolao-startup-home__recent .laolao-startup-home__item').length >= 1
        && (!st?.draft || st.draft.state === 'ready' || st.draft.state === 'failed');
    }, {timeout: 15_000});
  }

  // Trigger immediate context-capacity fetch and wait for post-splash mode-enter animation
  // and initial async UI injections (usage chips, context viewer ring, sidebar sessions) to settle.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('laolao:sessions-changed'));
  });
  // The mode-enter entrance (laolao-motion.js enter()) is CSS animations keyed on
  // data-laolao-mode-enter, which the product removes on a fixed 1250ms timer;
  // waiting for that timer was ~1s of every page open. Contexts here use
  // reducedMotion: 'reduce', under which laolao-theme.css turns those animations
  // off, so nothing was animating during the wait. Finish the entrance animations
  // (a safety net for the non-reduced case), then remove the attribute: every
  // animated value then already equals its resting value, so no transition starts
  // (cle-stage gives body::before a 0.7s opacity transition) and the captured frame
  // is the one the timer would have produced. The product's own removeAttribute
  // later is a no-op. Late async UI updates that used to land during the timer
  // are still waited for by settleRealPage's quiet-DOM wait.
  // Only the animations laolao-theme.css keys on html[data-laolao-mode-enter="1"]
  // (not the mode-transition overlay's laolao-mode-scene/content-enter). The two
  // welcome animations are also driven by .laolao-welcome--materializing; those
  // keep running, since removing the attribute would not end them either.
  await page.evaluate(() => {
    const html = document.documentElement;
    if (!html.hasAttribute('data-laolao-mode-enter')) return;
    const ENTER = new Set([
      'laolao-wallpaper-enter', 'laolao-glass-enter', 'laolao-avatar-enter',
      'laolao-native-wallpaper-enter', 'laolao-native-glass-enter',
      'laolao-welcome-particle-gather', 'laolao-welcome-materialize',
    ]);
    for (const anim of document.getAnimations()) {
      if (!ENTER.has(anim.animationName)) continue;
      if (anim.effect?.target?.closest?.('.laolao-welcome--materializing')) continue;
      try { anim.finish(); } catch {}
    }
    html.removeAttribute('data-laolao-mode-enter');
  });
  await page.waitForFunction(() => {
    const hasMeta = Boolean(document.querySelector('.agent-chat__composer-meta'));
    if (!hasMeta) return true;
    const pct = document.querySelector('.laolao-context-viewer__percent')?.textContent?.trim();
    return Boolean(pct && pct !== '—');
  }, {timeout: 5_000}).catch(() => {});
  await page.waitForTimeout(150);

  if (sceneId === 'sidebar-collapsed') {
    const toggleSel = '.sidebar [data-pinkie-sidebar-toggle], .sidebar button[aria-label="折叠侧边栏"]';
    await page.waitForSelector(toggleSel, {timeout: 10_000});
    await page.click(toggleSel);
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-pinkie-sidebar-auto') === '1'
        || Boolean(document.querySelector('.sidebar.sidebar--collapsed')),
      {timeout: 5_000},
    );
    // Allow laolao-sidebar-autohide's 200ms native collapse timer to settle
    await page.waitForTimeout(260);
  } else if (sceneId === 'model-picker') {
    const triggerSel = 'details.chat-controls__model > summary, details.chat-controls__model-picker > summary';
    await page.waitForSelector(triggerSel, {timeout: 10_000});
    await page.click(triggerSel);
    await waitModelPickerReady(page);
  } else if (sceneId === 'settings') {
    const settingsLink = 'a.sidebar-footer-icon[aria-label="设置"]';
    await page.waitForSelector(settingsLink, {timeout: 10_000});
    await page.click(settingsLink);
    await page.waitForFunction(() => (
      location.pathname.startsWith('/settings')
      && document.body.getAttribute('data-pinkie-user-settings') === '1'
      && Boolean(document.querySelector('#laolao-user-settings:not([hidden])'))
    ), {timeout: 10_000});
    await page.waitForTimeout(250);
  } else if (sceneId === 'study-desk') {
    await page.waitForFunction(
      () => typeof window.__pinkieStudyDesk?.go === 'function' && typeof window.__pinkieDrill?.start === 'function',
      {timeout: 10_000},
    );
    await page.evaluate(() => {
      window.__pinkieDrill.start({demo: true, auto: false});
    });
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.pk-drill .pk-drill-options .pk-choice');
      if (opts.length !== 4 || ![...opts].every((el) => el.getBoundingClientRect().height > 20)) return false;
      const deskRoot = document.querySelector('#pinkie-study-desk');
      const paperLoaded = !deskRoot || (
        Boolean(deskRoot.style.getPropertyValue('--paper-texture'))
        && deskRoot.style.getPropertyValue('--grain').includes('grain.png')
      );
      const imgs = [...document.querySelectorAll('.pk-drill img')];
      const imgsReady = imgs.every((img) => img.complete && img.naturalWidth > 0);
      return paperLoaded && imgsReady;
    }, {timeout: 10_000});
    await page.waitForTimeout(200);
  } else if (sceneId === 'metre-board') {
    await page.waitForFunction(
      () => typeof window.__pinkieMetreBoard?.open === 'function',
      {timeout: 10_000},
    );
    await page.evaluate(() => {
      window.__pinkieMetreBoard.open();
    });
    await page.waitForFunction(() => {
      const board = document.querySelector('.pk-metre-board');
      return Boolean(board && !board.hidden && board.querySelectorAll('[data-metre-slot]').length >= 3);
    }, {timeout: 10_000});
  } else if (sceneId === 'long-conversation') {
    await page.waitForFunction(
      () => document.querySelectorAll('.chat-thread .chat-group').length >= 4,
      {timeout: 10_000},
    );
    await page.evaluate(() => {
      const thread = document.querySelector('.chat-thread');
      if (thread) thread.scrollTop = 0;
    });
  }

  await settleRealPage(page, theme, {lockPerfClock: Boolean(opts.lockPerfClock)});
  return {context, page, pageErrors, failedRequests, meta};
}

export async function captureRealScenePng(browser, origin, sceneId, theme) {
  const {context, page, pageErrors, failedRequests} = await openRealScenePage(
    browser,
    origin,
    sceneId,
    theme,
    {lockPerfClock: true},
  );
  try {
    const proof = await assertRealPageLoaded(page);
    const png = await page.screenshot({animations: 'disabled', caret: 'hide', type: 'png'});
    return {png, pageErrors, failedRequests, proof};
  } finally {
    await context.close();
  }
}
