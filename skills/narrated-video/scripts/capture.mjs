// Playwright helpers for capturing a product at 1440x900, 2x: screenshots, per-keystroke typing frames, tall shots for
// scrolling, and measured click targets (CSS px boxes the pointer aims at). Use them from a per-product script:
//
//   import { open } from '<skill>/scripts/capture.mjs';
//   const cap = await open({ out: 'assets/app', hide: [/used all your credits/],
//     login: { url: 'https://app.example.com/', done: /app\.example\.com\/dashboard/ } });   // only for an app behind a sign-in
//   const p = await cap.page();
//   await p.goto('https://app.example.com/search', { waitUntil: 'networkidle' });
//   await cap.box(p, 'search.input', p.getByPlaceholder('Search'));     // -> boxes.json
//   await cap.shot(p, 'search-00');
//   await p.getByPlaceholder('Search').click(); await cap.shot(p, 'search-01');
//   await cap.typeFrames(p, 'search', 'running shoes', 2);             // search-02.png ... one per keystroke
//   await cap.tall(p, 'results-tall', 2400);                           // a tall viewport, not fullPage: apps scroll inside a container
//   await cap.close();
//
// Sign-in: with `login`, the first run opens a visible Chrome window on login.url for the person to sign in, waits until
// the address matches login.done, and saves the session to <out>/../session.json (or `session`). Later runs reuse it
// headless; delete the file to sign in again. It is a live login: keep it out of git and never print it.
//
// Playwright is resolved from the directory you run in (a project with playwright or @playwright/test installed).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const req = createRequire(process.cwd() + '/');
const modPath = ['playwright', '@playwright/test'].map((m) => { try { return req.resolve(m); } catch { return null; } }).find(Boolean);
if (!modPath) throw new Error('Playwright not found: run from a project that has playwright installed (npm i -D playwright; npx playwright install chromium)');
const pw = await import(pathToFileURL(modPath).href);
const { chromium } = pw.default ?? pw;

async function signIn(login, session) {
  // Real Chrome without the automation flag where it is installed: Google's sign-in page refuses an automated browser.
  const opts = { headless: false, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] };
  const browser = await chromium.launch({ ...opts, channel: 'chrome' }).catch(() => chromium.launch(opts));
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(login.url);
  console.log('Sign in in the browser window (waiting up to 10 minutes)...');
  await page.waitForURL(login.done, { timeout: 600000 });
  await page.waitForLoadState('networkidle');
  await page.context().storageState({ path: session });
  console.log('signed in; session saved to', session);
  await browser.close();
}

export async function open({ out, login, session, viewport = { width: 1440, height: 900 }, scale = 2, hide = [], locale = 'en-US', permissions = [] }) {
  fs.mkdirSync(out, { recursive: true });
  if (login) {
    session ??= path.join(path.dirname(path.resolve(out)), 'session.json');
    if (!fs.existsSync(session)) await signIn(login, session);
  }
  const storageState = login ? session : undefined;
  const boxesPath = `${out}/boxes.json`;
  const boxes = fs.existsSync(boxesPath) ? JSON.parse(fs.readFileSync(boxesPath, 'utf8')) : {};
  const browser = await chromium.launch();
  // Hide what is not part of the story (a credits banner, a cookie notice): a CSS selector, or a RegExp matched against
  // the text of small elements. Never edit pixels; change the page instead.
  const tidy = (p) => p.evaluate((rules) => {
    for (const r of rules) {
      if (r.sel) { document.querySelectorAll(r.sel).forEach((el) => { el.style.display = 'none'; }); continue; }
      const re = new RegExp(r.re, r.flags);
      for (const el of document.querySelectorAll('div, section, aside')) {
        if (re.test(el.textContent || '') && el.children.length < 4 && el.getBoundingClientRect().height < 120) { el.style.display = 'none'; break; }
      }
    }
  }, hide.map((h) => (h instanceof RegExp ? { re: h.source, flags: h.flags } : { sel: h })));
  const cap = {
    boxes,
    // extra: more context options, e.g. { javaScriptEnabled: false } for what a crawler that runs no JavaScript gets
    async page(extra = {}) {
      const ctx = await browser.newContext({ ...(storageState ? { storageState } : {}), viewport, deviceScaleFactor: scale, colorScheme: 'light', locale, ...extra });
      if (permissions.length) await ctx.grantPermissions(permissions);   // e.g. ['clipboard-read', 'clipboard-write'] for a Copy button
      return ctx.newPage();
    },
    async shot(p, name, { wait = 350 } = {}) {
      await p.mouse.move(viewport.width - 5, viewport.height - 5);   // park the mouse: no hover styles on the targets
      await p.waitForTimeout(wait); await tidy(p); await p.waitForTimeout(80);
      await p.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name);
    },
    async tall(p, name, height, { wait = 1500 } = {}) {
      await p.setViewportSize({ width: viewport.width, height }); await cap.shot(p, name, { wait });
      await p.setViewportSize(viewport);
    },
    async box(p, name, locator) {
      await tidy(p); await p.waitForTimeout(120);
      const b = await locator.first().boundingBox();
      if (!b) throw new Error('no box for ' + name);
      boxes[name] = [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10) / 10);
    },
    async typeFrames(p, prefix, text, start = 1) {
      for (let i = 0; i < text.length; i++) { await p.keyboard.type(text[i]); await cap.shot(p, `${prefix}-${String(start + i).padStart(2, '0')}`, { wait: 120 }); }
    },
    async close() {
      fs.writeFileSync(boxesPath, JSON.stringify(boxes, null, 1));
      console.log('boxes', Object.keys(boxes).length, '->', boxesPath);
      await browser.close();
    },
  };
  return cap;
}
