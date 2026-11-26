import './visual/lib/empty-upstream-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import test from 'node:test';
import {
  installRealCaptureFontFreeze,
  releaseStuckFonts,
} from './visual/lib/real-capture-freeze.mjs';

const require = createRequire(import.meta.url);

function fakeFonts(faces) {
  const fonts = {
    status: faces.some((face) => face.status === 'loading') ? 'loading' : 'loaded',
    ready: null,
    add(face) {
      faces.push(face);
      fonts.status = faces.some((item) => item.status === 'loading') ? 'loading' : 'loaded';
      return fonts;
    },
    delete(face) {
      const index = faces.indexOf(face);
      if (index >= 0) faces.splice(index, 1);
      fonts.status = faces.some((item) => item.status === 'loading') ? 'loading' : 'loaded';
    },
    [Symbol.iterator]() { return faces[Symbol.iterator](); },
  };
  fonts.ready = fonts.status === 'loaded' ? Promise.resolve() : new Promise(() => {});
  return fonts;
}

function installFakeDocument(faces, sheets = []) {
  const fonts = fakeFonts(faces);
  const stop = {called: 0};
  globalThis.CSSRule = {FONT_FACE_RULE: 5};
  globalThis.document = {
    fonts,
    styleSheets: sheets,
    head: {appendChild() {}},
    createElement() { return {setAttribute() {}, textContent: ''}; },
  };
  globalThis.window = {stop() { stop.called += 1; }};
  return {fonts, faces, stop, sheets};
}

test('releaseStuckFonts keeps a settled face and drops one that never loads', async () => {
  const loaded = {family: 'GoodFace', status: 'loaded'};
  const stuck = {family: 'StuckFace', status: 'loading'};
  const cssRules = [{
    type: 5,
    style: {getPropertyValue() { return '"StuckFace"'; }},
  }];
  const sheet = {
    get cssRules() { return cssRules; },
    deleteRule(index) { cssRules.splice(index, 1); },
  };
  const {faces, stop} = installFakeDocument([loaded, stuck], [sheet]);
  const started = Date.now();
  await releaseStuckFonts(300);
  const elapsed = Date.now() - started;
  assert.ok(faces.includes(loaded), 'a face that already loaded must stay');
  assert.equal(faces.includes(stuck), false, 'a face still loading after the wait must be removed');
  assert.equal(cssRules.length, 0, 'the @font-face rule that kept the load alive must be removed');
  assert.equal(stop.called, 1, 'the in-flight font load must be stopped or document.fonts.ready never settles');
  assert.equal(document.fonts.add({family: 'LateFace', status: 'loading'}), document.fonts);
  assert.equal(faces.some((face) => face.family === 'LateFace'), false);
  assert.ok(elapsed < 2000, `wait should stay near the budget, took ${elapsed}ms`);
});

test('releaseStuckFonts returns immediately when every face is already loaded', async () => {
  const {stop} = installFakeDocument([{family: 'GoodFace', status: 'loaded'}]);
  const started = Date.now();
  await releaseStuckFonts(5000);
  const elapsed = Date.now() - started;
  assert.equal(stop.called, 0, 'a settled page must not stop loads');
  assert.ok(elapsed < 400, `settled fonts must not burn the screenshot budget, took ${elapsed}ms`);
});

test('real-page baseline installs the font freeze before capture', () => {
  const source = fs.readFileSync(new URL('./visual-real-baseline.test.mjs', import.meta.url), 'utf8');
  assert.match(source, /installRealCaptureFontFreeze\(browser\)/);
});

test('installRealCaptureFontFreeze settles fonts before screenshot', async () => {
  const order = [];
  const page = {
    evaluate: async () => { order.push('stabilize'); },
    screenshot: async () => { order.push('shot'); return Buffer.from('png'); },
  };
  const browser = {newContext: async () => ({newPage: async () => page})};
  installRealCaptureFontFreeze(browser);
  const context = await browser.newContext();
  const wrapped = await context.newPage();
  await wrapped.screenshot({type: 'png'});
  assert.deepEqual(order, ['stabilize', 'shot']);
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('a font that never arrives does not hang the real-page screenshot', {timeout: 20000}, async () => {
  let playwright;
  try { playwright = require('playwright'); } catch { playwright = require('playwright-core'); }
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: GoodFace; src: local("Noto Serif"), local("DejaVu Sans"), local("Liberation Sans"); }
    @font-face { font-family: StuckFace; src: url(/stuck-font.woff2) format("woff2"); }
    h1 { font-family: StuckFace, GoodFace, sans-serif; font-size: 27px; }
  </style><h1>把今天学的轻轻合上吧，明天它会比今天更牢</h1>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(html);
  });
  const port = await listen(server);
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  try {
    await page.route('**/stuck-font.woff2', () => new Promise(() => {}));
    await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'domcontentloaded', timeout: 5000});
    await page.waitForFunction(() => (
      [...document.fonts].some((face) => face.family === 'StuckFace' && face.status === 'loading')
    ), {timeout: 3000});
    await page.evaluate(releaseStuckFonts, 400);
    const png = await page.screenshot({type: 'png', animations: 'disabled', timeout: 3000});
    const faces = await page.evaluate(() => [...document.fonts].map((face) => `${face.family}:${face.status}`));
    assert.ok(png.length > 100, 'screenshot should return pixels');
    assert.equal(faces.some((item) => item === 'StuckFace:loading'), false, faces.join(','));
    assert.equal(faces.some((item) => item.startsWith('GoodFace:')), true, faces.join(','));
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
