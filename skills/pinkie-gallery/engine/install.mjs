// 缺什么自己装：npm 依赖装进成品库自己的 runtime 目录，Chromium 装进 browsers 目录。
// 国内镜像优先，连不上换官方源；装好记进下载账本。全程不问先生。
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, spawn} from 'node:child_process';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {homePaths, ensureDir} from './paths.mjs';
import {record} from './ledger.mjs';

// 固定版本：每台电脑装到的一样，出图才一样。
export const RUNTIME_VERSIONS = {
  'playwright-core': '1.64.1',
  'pptxgenjs': '4.0.1',
  'docx': '9.15.1',
  'exceljs': '4.4.0',
  'jszip': '3.10.1',
};

const REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org'];

// 先测哪个源快（国内用户通常是国内镜像，海外用户通常是官方源），按快慢排序；测不通的放最后。
let registryOrder = null;
export async function rankedRegistries() {
  if (registryOrder) return registryOrder;
  if (process.env.PINKIE_NPM_REGISTRY) return (registryOrder = [process.env.PINKIE_NPM_REGISTRY, ...REGISTRIES]);
  const timed = await Promise.all(REGISTRIES.map(async registry => {
    const started = Date.now();
    try {
      const response = await fetch(`${registry}/jszip/3.10.1`, {signal: AbortSignal.timeout(6000)});
      await response.arrayBuffer();
      return {registry, ms: response.ok ? Date.now() - started : 1e9};
    } catch { return {registry, ms: 1e9}; }
  }));
  registryOrder = timed.sort((a, b) => a.ms - b.ms).map(t => t.registry);
  return registryOrder;
}
const PLAYWRIGHT_HOSTS = ['https://cdn.npmmirror.com/binaries/playwright', 'https://npmmirror.com/mirrors/playwright', ''];

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function say(message, quiet) {
  if (!quiet) process.stderr.write(`${message}\n`);
}

function runtimeManifest(runtime) {
  const file = path.join(runtime, 'package.json');
  if (!fs.existsSync(file)) {
    ensureDir(runtime);
    fs.writeFileSync(file, JSON.stringify({name: 'pinkie-gallery-runtime', private: true, version: '1.0.0'}, null, 2) + '\n');
  }
  return file;
}

export function isInstalled(name, runtime = homePaths().runtime) {
  return fs.existsSync(path.join(runtime, 'node_modules', ...name.split('/'), 'package.json'));
}

// specs: ['playwright-core', '@fontsource/noto-sans-sc@5.3.1', ...]
export async function ensurePackages(specs, {task = '', quiet = false} = {}) {
  const {runtime} = homePaths();
  runtimeManifest(runtime);
  const wanted = specs.map(spec => {
    const at = spec.lastIndexOf('@');
    const name = at > 0 ? spec.slice(0, at) : spec;
    const version = at > 0 ? spec.slice(at + 1) : RUNTIME_VERSIONS[spec] || 'latest';
    return {name, spec: `${name}@${version}`};
  });
  const missing = wanted.filter(w => !isInstalled(w.name, runtime));
  if (!missing.length) return true;
  say(`正在下载：${missing.map(m => m.name).join('、')}（第一次用会慢一点，之后不用再下）`, quiet);
  let lastError = '';
  for (const registry of await rankedRegistries()) {
    const result = spawnSync(npmCommand(), ['install', '--no-audit', '--no-fund', '--loglevel=error', '--registry', registry, ...missing.map(m => m.spec)], {
      cwd: runtime, encoding: 'utf8', shell: process.platform === 'win32', timeout: 15 * 60 * 1000,
      env: {...process.env, npm_config_update_notifier: 'false'},
    });
    if (result.status === 0 && missing.every(m => isInstalled(m.name, runtime))) {
      for (const m of missing) {
        record({target: path.join(runtime, 'node_modules', ...m.name.split('/')), what: `成品库依赖 ${m.name}`, task, source: registry});
      }
      return true;
    }
    lastError = (result.stderr || result.error?.message || '').trim().split('\n').slice(-3).join(' ');
  }
  throw new Error(`下载依赖失败（国内镜像和官方源都试过了）：${lastError}`);
}

export function requireRuntime(name) {
  const {runtime} = homePaths();
  const require = createRequire(path.join(runtime, 'package.json'));
  return require(name);
}

export async function importRuntime(name) {
  const {runtime} = homePaths();
  const require = createRequire(path.join(runtime, 'package.json'));
  const resolved = require.resolve(name);
  const {pathToFileURL} = await import('node:url');
  return import(pathToFileURL(resolved).href);
}

export function shellInstalled(browsers = homePaths().browsers) {
  if (!fs.existsSync(browsers)) return false;
  return fs.readdirSync(browsers).some(n => /^chromium_headless_shell-\d+$/.test(n) || /^chromium-\d+$/.test(n))
    && !fs.existsSync(path.join(browsers, '__dirlock'));
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let st; try { st = fs.lstatSync(cur); } catch { continue; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(cur)) stack.push(path.join(cur, n)); } else total += st.size;
  }
  return total;
}

// 浏览器内核的下载源也先测速：哪个先回应先用哪个。
async function rankedHosts() {
  const timed = await Promise.all(PLAYWRIGHT_HOSTS.map(async host => {
    const url = host || 'https://cdn.playwright.dev';
    const started = Date.now();
    try { const r = await fetch(url, {method: 'HEAD', signal: AbortSignal.timeout(6000)}); return {host, ms: r.status < 500 ? Date.now() - started : 1e9}; }
    catch { return {host, ms: 1e9}; }
  }));
  return timed.sort((a, b) => a.ms - b.ms).map(t => t.host);
}

// Playwright 先下到系统临时目录再解压，所以两边一起看有没有在长。
function downloadingBytes() {
  let total = 0;
  try {
    for (const n of fs.readdirSync(os.tmpdir())) if (n.startsWith('playwright-download')) total += dirSize(path.join(os.tmpdir(), n));
  } catch {}
  return total;
}

// 跑一次 playwright 的安装；60 秒没有新字节就判定这个源卡住了，换下一个。
function installFrom(host, {cli, browsers, stallMs = 90000, totalMs = 25 * 60 * 1000}) {
  return new Promise(resolve => {
    const env = {...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers};
    if (host) env.PLAYWRIGHT_DOWNLOAD_HOST = host; else delete env.PLAYWRIGHT_DOWNLOAD_HOST;
    const child = spawn(process.execPath, [cli, 'install', 'chromium', '--only-shell'], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let last = -1, lastChange = Date.now(), out = '';
    child.stdout.on('data', d => { out += d; lastChange = Date.now(); });
    child.stderr.on('data', d => { out += d; lastChange = Date.now(); });
    const started = Date.now();
    const timer = setInterval(() => {
      const size = dirSize(browsers) + downloadingBytes();
      if (size !== last) { last = size; lastChange = Date.now(); }
      if (Date.now() - lastChange > stallMs || Date.now() - started > totalMs) child.kill('SIGKILL');
    }, 5000);
    child.on('close', code => { clearInterval(timer); fs.rmSync(path.join(browsers, '__dirlock'), {recursive: true, force: true}); resolve(code === 0 && shellInstalled(browsers)); });
    child.on('error', () => { clearInterval(timer); resolve(false); });
  });
}

// 下载 Playwright 自带的 Chromium（无界面版）。成功返回 true；下载不了返回 false。
export async function ensureBrowser({task = '', quiet = false} = {}) {
  const {runtime, browsers} = homePaths();
  await ensurePackages(['playwright-core'], {task, quiet});
  if (shellInstalled(browsers)) return true;
  ensureDir(browsers);
  const cli = path.join(runtime, 'node_modules', 'playwright-core', 'cli.js');
  say('正在下载出图用的浏览器内核（约 100 MB，只下一次）……', quiet);
  for (const host of await rankedHosts()) {
    if (await installFrom(host, {cli, browsers})) {
      record({target: browsers, what: '出图用的浏览器内核（Chromium）', task, source: host || '官方源'});
      return true;
    }
  }
  return false;
}

// 电脑上已经有 Chrome / Edge 时：先用它出图，同时在后台把自带内核下好，下次起改用自带的（每台电脑一样）。
export function fetchBrowserInBackground({task = ''} = {}) {
  const {browsers} = homePaths();
  if (shellInstalled(browsers)) return false;
  const marker = path.join(ensureDir(browsers), '.fetching');
  try {
    const st = fs.statSync(marker);
    if (Date.now() - st.mtimeMs < 30 * 60 * 1000) return false; // 已经在下了
  } catch {}
  fs.writeFileSync(marker, String(process.pid));
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fetch-browser.mjs');
  const child = spawn(process.execPath, [script, task], {detached: true, stdio: 'ignore', env: process.env});
  child.unref();
  return true;
}
