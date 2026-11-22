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
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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

const OPTIONAL_404_PATHS = new Set([
  '/favicon.ico',
  '/laolao-stats.json',
  '/laolao-quota.json',
  '/laolao-exam-packs.json',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
]);

const REAL_ASSET_PATH_RE = /(?:^\/(?:assets|vendor|fonts|study-desk|provider-icons)\/|^\/laolao-|\.(?:js|mjs|css|woff2?|ttf|png|jpe?g|webp|svg)$)/i;

function isTrackedAssetPath(pathname) {
  if (!pathname || OPTIONAL_404_PATHS.has(pathname)) return false;
  return REAL_ASSET_PATH_RE.test(pathname);
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
    execFileSync(
      'tar',
      ['-xzf', tgzPath, '-C', extractDir, '--strip-components=1', 'package/package.json', 'package/dist/control-ui'],
      {cwd: stageRoot, env, stdio: 'pipe'},
    );
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

export function installRealControlUi({repoRoot = REPO_ROOT, baseDir = os.tmpdir()} = {}) {
  const version = readRuntimeOpenClawVersion(repoRoot);
  const upstreamDir = ensureUpstreamOpenClaw(version);
  const runDir = fs.mkdtempSync(path.join(baseDir, 'pinkie-real-ui-run-'));
  const env = buildIsolatedEnv(runDir);
  const packageDir = path.join(runDir, 'node_modules', 'openclaw');
  const controlUiDir = path.join(packageDir, 'dist', 'control-ui');
  fs.mkdirSync(path.dirname(packageDir), {recursive: true});
  fs.cpSync(upstreamDir, packageDir, {recursive: true});

  const pythonCmd = resolvePythonCommand();
  const bundlePy = path.join(repoRoot, 'tools/ui-parity/bundle.py');
  const stampMjs = path.join(repoRoot, 'tools/assets/stamp.mjs');

  execFileSync(pythonCmd, [bundlePy, 'install', '--root', repoRoot, '--control-ui', controlUiDir], {
    cwd: repoRoot,
    env,
    stdio: 'pipe',
  });
  execFileSync(process.execPath, [stampMjs, '--root', repoRoot, '--control-ui', controlUiDir], {
    cwd: repoRoot,
    env,
    stdio: 'pipe',
  });
  execFileSync(pythonCmd, [bundlePy, 'check', '--root', repoRoot, '--control-ui', controlUiDir], {
    cwd: repoRoot,
    env,
    stdio: 'pipe',
  });

  return {
    version,
    runDir,
    packageDir,
    controlUiDir,
    cleanup() {
      fs.rmSync(runDir, {recursive: true, force: true});
    },
  };
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
const FAKE_GATEWAY_EXT_SCRIPT = `(() => {
  'use strict';
  const BaseSocket = window.WebSocket;
  if (!BaseSocket || BaseSocket.__pinkieRealHarnessWrapped) return;
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
        if ((frame.method === 'chat.metadata' || frame.method === 'models.list') && Array.isArray(window.__realHarnessModels)) {
          const models = window.__realHarnessModels;
          Promise.resolve().then(() => {
            this._raw?.({type: 'res', id: frame.id, ok: true, payload: {models}});
          });
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

export async function startRealUiServer({
  controlUiDir,
  repoRoot = REPO_ROOT,
  ports = PREFERRED_PORTS,
} = {}) {
  if (!controlUiDir || !fs.existsSync(path.join(controlUiDir, 'index.html'))) {
    throw new Error(`Invalid controlUiDir: ${controlUiDir}`);
  }
  const fakeGatewayPath = path.join(repoRoot, 'scripts/chat-ui-harness/fake-gateway.js');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__fake-gateway.js') {
      res.setHeader('Content-Type', MIME['.js']);
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(fakeGatewayPath, 'utf8'));
      return;
    }
    if (url.pathname === '/__fake-gateway-ext.js') {
      res.setHeader('Content-Type', MIME['.js']);
      res.setHeader('Cache-Control', 'no-store');
      res.end(FAKE_GATEWAY_EXT_SCRIPT);
      return;
    }
    if (url.pathname === '/__windows-bridge.js') {
      res.setHeader('Content-Type', MIME['.js']);
      res.setHeader('Cache-Control', 'no-store');
      res.end(extractWindowsBridgeScript(repoRoot));
      return;
    }
    if (url.pathname === '/control-ui-config.json') {
      res.setHeader('Content-Type', MIME['.json']);
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({basePath: '', assistantName: '碧琪', assistantAvatar: null}));
      return;
    }
    if (url.pathname.startsWith('/avatar/')) {
      res.statusCode = 404;
      res.end('no custom avatar');
      return;
    }
    const baseName = path.posix.basename(url.pathname);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel.includes('..')) {
      res.statusCode = 404;
      res.end('invalid path');
      return;
    }
    const target = path.resolve(controlUiDir, rel);
    const rootResolved = path.resolve(controlUiDir);
    const isFileOnDisk = rel && target.startsWith(rootResolved + path.sep)
      && fs.existsSync(target) && fs.statSync(target).isFile();

    if (url.pathname === '/' || url.pathname === '/index.html' || (!baseName.includes('.') && !isFileOnDisk)) {
      const indexPath = path.join(controlUiDir, 'index.html');
      const rawHtml = fs.readFileSync(indexPath, 'utf8');
      const injectTags = [
        '<script src="/__fake-gateway.js"></script>',
        '<script src="/__fake-gateway-ext.js"></script>',
        '<script src="/__windows-bridge.js"></script>',
      ].join('\n');
      const html = rawHtml.replace(/<head>/i, `<head>\n${injectTags}`);
      res.setHeader('Content-Type', MIME['.html']);
      res.setHeader('Cache-Control', 'no-store');
      res.end(html);
      return;
    }

    if (!isFileOnDisk) {
      res.statusCode = 404;
      res.end(`missing ${rel}`);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(target));
  });

  const port = await listenOnPreferredPort(server, ports);
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    controlUiDir,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function launchRealBrowser(engine = process.env.PINKIE_VISUAL_ENGINE || '') {
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
    ],
  };
  if (engine === 'msedge' || engine === 'chrome') {
    return chromium.launch({...launchOpts, channel: engine});
  }
  try {
    return await chromium.launch(launchOpts);
  } catch {
    return chromium.launch({...launchOpts, channel: 'chrome'});
  }
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

export async function settleRealPage(page, theme) {
  const isNight = theme === 'night';
  await page.evaluate(async (dark) => {
    // Sync theme through real laolao-night controller if needed
    const wantMode = dark ? 'dark' : 'light';
    if (document.documentElement.getAttribute('data-theme-mode') !== wantMode) {
      window.__pinkieNight?.setMode?.(wantMode);
      document.documentElement.setAttribute('data-theme-mode', wantMode);
      document.documentElement.toggleAttribute('data-pinkie-night', dark);
    }

    // Remove one-shot entrance classes that auto-clear on a timer
    document.querySelectorAll('.laolao-welcome--materializing').forEach((el) => {
      el.classList.remove('laolao-welcome--materializing');
    });

    // Temporarily freeze performance.now only during laolao-usage-stats refresh
    // so linkLatency is deterministically 0ms without blocking later animations/transitions.
    const origPerfNow = performance.now.bind(performance);
    try {
      performance.now = () => 1000;
      if (window.__laolaoUsage?.refresh) {
        await window.__laolaoUsage.refresh();
      }
    } finally {
      performance.now = origPerfNow;
    }

    // Finish any active Web Animations
    if (typeof document.getAnimations === 'function') {
      for (const anim of document.getAnimations()) {
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

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, isNight);
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

export async function openRealScenePage(browser, origin, sceneId, theme = 'day', opts = {}) {
  const meta = sceneMeta(sceneId);
  const isNight = theme === 'night';
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: isNight ? 'dark' : 'light',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });

  const extraInit = opts.initScript || null;
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
    const pathname = new URL(req.url()).pathname;
    if (isTrackedAssetPath(pathname)) {
      failedRequests.push(`${req.method()} ${pathname}: ${req.failure()?.errorText || 'failed'}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const pathname = new URL(res.url()).pathname;
      if (isTrackedAssetPath(pathname)) {
        failedRequests.push(`${res.status()} ${pathname}`);
      }
    }
  });

  const targetUrl = `${origin}/chat?harnessSession=active&session=${encodeURIComponent(meta.sessionKey)}`;
  await page.goto(targetUrl, {waitUntil: 'load'});

  // Wait for splash screen to clear and real OpenClaw + Pinkie UI to mount
  await page.waitForFunction(() => !document.getElementById('laolao-splash'), {timeout: 15_000});
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
        && (!st?.draft || st.draft.state === 'ready' || st.draft.state === 'failed');
    }, {timeout: 15_000});
  }

  // Trigger immediate context-capacity fetch and wait briefly for async UI injections
  await page.evaluate(() => {
    window.dispatchEvent(new Event('laolao:sessions-changed'));
  });
  await page.waitForTimeout(350);

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
    await page.waitForFunction(() => {
      const details = document.querySelector('details.chat-controls__model[open], details.chat-controls__model-picker[open]');
      const menu = details?.querySelector('.chat-controls__inline-select-menu--combined');
      return Boolean(menu && menu.getBoundingClientRect().height > 40);
    }, {timeout: 10_000});
    await page.waitForTimeout(200);
  } else if (sceneId === 'settings') {
    const settingsLink = 'a.sidebar-footer-icon[aria-label="设置"]';
    await page.waitForSelector(settingsLink, {timeout: 10_000});
    await page.click(settingsLink);
    await page.waitForFunction(() => (
      location.pathname.startsWith('/settings')
      && (document.body.getAttribute('data-pinkie-user-settings') === '1'
        || Boolean(document.querySelector('.config-view-toggle')))
    ), {timeout: 10_000});
    await page.waitForTimeout(350);
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
      return opts.length === 4 && [...opts].every((el) => el.getBoundingClientRect().height > 20);
    }, {timeout: 10_000});
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

  await settleRealPage(page, theme);
  return {context, page, pageErrors, failedRequests, meta};
}

export async function captureRealScenePng(browser, origin, sceneId, theme) {
  const {context, page, pageErrors, failedRequests} = await openRealScenePage(browser, origin, sceneId, theme);
  try {
    const proof = await assertRealPageLoaded(page);
    const png = await page.screenshot({animations: 'disabled', caret: 'hide', type: 'png'});
    return {png, pageErrors, failedRequests, proof};
  } finally {
    await context.close();
  }
}
