// macOS WebKit screenshot fallback (screencast last-frame + sips) and CI failure capture.
// On macOS 26+, sandboxed com.apple.WebKit.WebContent fails UTType -> CGImageDestination
// for "image/png" (dynamic UTI dyn.ah62d4rv4gq80w5pbq7ww86dsq6), so WebKit's Inspector
// Page.snapshotRect returns {"dataURL":"data:,"} and Playwright's page.screenshot()
// silently returns a 0-byte Buffer. Screencast frames are encoded in the UIProcess, which
// is unaffected. Wrapping webkit.launch() here keeps test code completely unaware of it.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, afterEach, beforeEach} from 'node:test';
import {decodePng, encodePng} from './png-diff.mjs';

let tempSeq = 0;
let nativeSnapshotWorks = null; // null = untested, true = works, false = 0-byte on this host

function sanitizeFilePart(text) {
  return String(text || 'webkit-page')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'webkit-page';
}

function cropPngBuffer(pngBuffer, clip, scroll = {x: 0, y: 0}) {
  const src = decodePng(pngBuffer);
  const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(clip.x - scroll.x)));
  const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(clip.y - scroll.y)));
  const x1 = Math.max(x0 + 1, Math.min(src.width, Math.ceil(clip.x - scroll.x + clip.width)));
  const y1 = Math.max(y0 + 1, Math.min(src.height, Math.ceil(clip.y - scroll.y + clip.height)));
  const cw = x1 - x0;
  const ch = y1 - y0;
  const out = new Uint8Array(cw * ch * 4);
  const srcStride = src.width * 4;
  const dstStride = cw * 4;
  for (let row = 0; row < ch; row += 1) {
    const start = (y0 + row) * srcStride + x0 * 4;
    out.set(src.data.subarray(start, start + dstStride), row * dstStride);
  }
  return encodePng(cw, ch, out);
}

export async function wkshotBuffer(page, {
  path: outPath,
  fullPage = false,
  clip = null,
  type = 'png',
  settleMs = 400,
  maxHeight = 8000,
} = {}) {
  const vp = page.viewportSize()
    || await page.evaluate(() => ({width: window.innerWidth || 1280, height: window.innerHeight || 800}));
  const pageMetrics = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({
        docHeight: Math.max(
          document.documentElement?.scrollHeight || 0,
          document.body ? document.body.scrollHeight : 0,
        ),
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
      });
    }));
  }));

  let targetWidth = vp.width;
  let targetHeight = vp.height;
  if (fullPage) {
    targetHeight = Math.min(Math.max(pageMetrics.docHeight, vp.height), maxHeight);
  } else if (clip && clip.y + clip.height > pageMetrics.scrollY + vp.height) {
    targetHeight = Math.min(Math.max(Math.ceil(clip.y + clip.height), vp.height), maxHeight);
  }
  const size = {
    width: Math.max(2, targetWidth & ~1),
    height: Math.max(2, targetHeight & ~1),
  };
  const resized = size.width !== vp.width || size.height !== vp.height;
  if (resized) await page.setViewportSize(size);

  let last = null;
  await page.screencast.start({
    size,
    quality: 100,
    onFrame: (frame) => { last = frame; },
  });
  try {
    await page.evaluate(() => {
      const s = document.createElement('div');
      s.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
      document.documentElement.appendChild(s);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
        s.remove();
        r();
      })));
    });
    const t0 = Date.now();
    while (!last && Date.now() - t0 < 5000) await page.waitForTimeout(50);
    await page.waitForTimeout(settleMs);
  } finally {
    await page.screencast.stop().catch(() => {});
    if (resized) await page.setViewportSize(vp).catch(() => {});
  }

  if (!last?.data?.length) {
    throw new Error('wkshot: no screencast frame received within 5s');
  }

  const wantJpeg = type === 'jpeg' || (outPath && /\.jpe?g$/i.test(outPath) && !type);
  if (wantJpeg && !clip) {
    const jpgBuf = Buffer.from(last.data);
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), {recursive: true});
      fs.writeFileSync(outPath, jpgBuf);
    }
    return jpgBuf;
  }

  const stamp = `${process.pid}-${Date.now()}-${(tempSeq += 1)}`;
  const tmpJpg = path.join(os.tmpdir(), `pinkie-wkshot-${stamp}.jpg`);
  const tmpPng = path.join(os.tmpdir(), `pinkie-wkshot-${stamp}.png`);
  const srgbProfile = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
  const matchArgs = fs.existsSync(srgbProfile) ? ['--matchTo', srgbProfile] : [];
  try {
    fs.writeFileSync(tmpJpg, last.data);
    execFileSync('/usr/bin/sips', [...matchArgs, '-s', 'format', 'png', tmpJpg, '--out', tmpPng], {stdio: 'ignore'});
    let pngBuf = fs.readFileSync(tmpPng);
    if (clip) {
      const scroll = resized ? {x: 0, y: 0} : {x: pageMetrics.scrollX, y: pageMetrics.scrollY};
      pngBuf = cropPngBuffer(pngBuf, clip, scroll);
    }
    let finalBuf = pngBuf;
    if (wantJpeg) {
      const tmpCroppedPng = path.join(os.tmpdir(), `pinkie-wkshot-${stamp}-crop.png`);
      const tmpOutJpg = path.join(os.tmpdir(), `pinkie-wkshot-${stamp}-out.jpg`);
      try {
        fs.writeFileSync(tmpCroppedPng, pngBuf);
        execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', tmpCroppedPng, '--out', tmpOutJpg], {stdio: 'ignore'});
        finalBuf = fs.readFileSync(tmpOutJpg);
      } finally {
        fs.rmSync(tmpCroppedPng, {force: true});
        fs.rmSync(tmpOutJpg, {force: true});
      }
    }
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), {recursive: true});
      fs.writeFileSync(outPath, finalBuf);
    }
    return finalBuf;
  } finally {
    fs.rmSync(tmpJpg, {force: true});
    fs.rmSync(tmpPng, {force: true});
  }
}

export async function wkshot(page, outPath, options = {}) {
  const buf = await wkshotBuffer(page, {...options, path: outPath});
  const vp = page.viewportSize() || {width: 0, height: 0};
  return {path: outPath, width: vp.width, height: vp.height, bytes: buf.length};
}

// Failure-artifact hook: when PINKIE_WEBKIT_SHOT_DIR is set, defer closing WebKit
// contexts/browsers until node:test's top-level afterEach runs so a failed test can
// capture the live page state before teardown finishes.
const livePages = new Set();
const deferredClosers = [];
let hooksInstalled = false;
let activeTestDepth = 0;
let shotIndex = 0;

async function flushDeferredClosers() {
  while (deferredClosers.length) {
    const closer = deferredClosers.shift();
    try { await closer(); } catch {}
  }
  for (const page of [...livePages]) {
    if (page.isClosed()) livePages.delete(page);
  }
}

function shouldDeferClose() {
  return activeTestDepth > 0 && Boolean(process.env.PINKIE_WEBKIT_SHOT_DIR);
}

function ensureFailureHooks() {
  if (hooksInstalled || !process.env.PINKIE_WEBKIT_SHOT_DIR) return;
  hooksInstalled = true;
  beforeEach(() => {
    activeTestDepth += 1;
  });
  afterEach(async (t) => {
    activeTestDepth = Math.max(0, activeTestDepth - 1);
    const shotDir = process.env.PINKIE_WEBKIT_SHOT_DIR;
    if (shotDir && t && t.passed === false) {
      fs.mkdirSync(shotDir, {recursive: true});
      const candidates = [...livePages].filter((p) => !p.isClosed()).slice(-3);
      for (const page of candidates) {
        const idx = String((shotIndex += 1)).padStart(3, '0');
        const base = `${idx}-${sanitizeFilePart(t.name)}`;
        const pngPath = path.join(shotDir, `${base}.png`);
        const metaPath = path.join(shotDir, `${base}.json`);
        let bytes = 0;
        let shotError = null;
        try {
          const buf = await page.screenshot({path: pngPath});
          bytes = buf.length;
        } catch (err) {
          shotError = String(err?.message || err);
        }
        let url = '';
        try { url = page.url(); } catch {}
        fs.writeFileSync(metaPath, JSON.stringify({
          test: t.name || '',
          url,
          screenshot: bytes > 0 ? path.basename(pngPath) : null,
          bytes,
          shotError,
          error: String(t.error?.stack || t.error?.message || t.error || ''),
        }, null, 2) + '\n');
      }
    }
    await flushDeferredClosers();
  });
  after(async () => {
    await flushDeferredClosers();
  });
}

if (process.platform === 'darwin' && process.env.PINKIE_WEBKIT_SHOT_DIR) {
  ensureFailureHooks();
}

function wrapPage(page) {
  if (!page || page.__pinkieWkWrapped) return page;
  Object.defineProperty(page, '__pinkieWkWrapped', {value: true});
  livePages.add(page);
  page.on('close', () => livePages.delete(page));

  const origScreenshot = page.screenshot.bind(page);
  page.screenshot = async (options = {}) => {
    if (nativeSnapshotWorks !== false) {
      const probeOpts = {...options};
      delete probeOpts.path;
      const nativeBuf = await origScreenshot(probeOpts);
      if (nativeBuf && nativeBuf.length > 0) {
        nativeSnapshotWorks = true;
        if (options.path) {
          fs.mkdirSync(path.dirname(options.path), {recursive: true});
          fs.writeFileSync(options.path, nativeBuf);
        }
        return nativeBuf;
      }
      nativeSnapshotWorks = false;
    }
    return wkshotBuffer(page, options);
  };

  if (process.env.PINKIE_WEBKIT_SHOT_DIR) {
    ensureFailureHooks();
    const origPageClose = page.close.bind(page);
    page.close = async (...args) => {
      if (!shouldDeferClose()) return origPageClose(...args);
      deferredClosers.push(() => origPageClose(...args));
    };
  }
  return page;
}

function wrapContext(context) {
  if (!context || context.__pinkieWkWrapped) return context;
  Object.defineProperty(context, '__pinkieWkWrapped', {value: true});
  for (const existing of context.pages()) wrapPage(existing);
  context.on('page', (page) => wrapPage(page));

  const origNewPage = context.newPage.bind(context);
  context.newPage = async (...args) => wrapPage(await origNewPage(...args));

  if (process.env.PINKIE_WEBKIT_SHOT_DIR) {
    ensureFailureHooks();
    const origClose = context.close.bind(context);
    context.close = async (...args) => {
      if (!shouldDeferClose()) return origClose(...args);
      deferredClosers.push(() => origClose(...args));
    };
  }
  return context;
}

function wrapBrowser(browser) {
  if (!browser || browser.__pinkieWkWrapped) return browser;
  Object.defineProperty(browser, '__pinkieWkWrapped', {value: true});

  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => wrapContext(await origNewContext(...args));

  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = wrapPage(await origNewPage(...args));
    wrapContext(page.context());
    return page;
  };

  if (process.env.PINKIE_WEBKIT_SHOT_DIR) {
    ensureFailureHooks();
    const origClose = browser.close.bind(browser);
    browser.close = async (...args) => {
      if (!shouldDeferClose()) return origClose(...args);
      deferredClosers.push(() => origClose(...args));
    };
  }
  return browser;
}

const wrappedTypes = new WeakMap();

export function wrapWebKitPlaywright(pw) {
  if (process.platform !== 'darwin' || !pw?.webkit) return pw;
  if (wrappedTypes.has(pw)) return wrappedTypes.get(pw);

  const origWebKit = pw.webkit;
  const webkitProxy = new Proxy(origWebKit, {
    get(target, prop, receiver) {
      if (prop === 'launch') {
        return async (...args) => wrapBrowser(await target.launch(...args));
      }
      if (prop === 'launchPersistentContext') {
        return async (...args) => wrapContext(await target.launchPersistentContext(...args));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const pwProxy = new Proxy(pw, {
    get(target, prop, receiver) {
      if (prop === 'webkit') return webkitProxy;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  wrappedTypes.set(pw, pwProxy);
  return pwProxy;
}
