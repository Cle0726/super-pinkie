// 学习台游戏 · 前端截图 / 录屏 / 帧率 QA。只在隔离 harness 里跑：不连 18789，不碰用户的 App 和学习数据。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/ui-qa.mjs <demo|fps|idle|all> [--out=dir] [--headed]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startHarness} from '../study-desk/harness.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), cmd = args.find(a => !a.startsWith('--')) || 'all';
const opt = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const out = path.resolve(opt('out') || path.join(repo, 'design/study-game/qa'));
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));

export function launch({headed = args.includes('--headed'), video = null, width = 1440, height = 900} = {}) {
  const req = createRequire(import.meta.url);
  const root = '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/node_modules';
  let pw; try { pw = req('playwright'); } catch { pw = req(root + '/playwright-core'); }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  // 录屏时窗口必须和视口一样大，否则底部约 90px 是灰条（已知坑）。
  const flags = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', `--window-size=${width},${height}`, '--autoplay-policy=no-user-gesture-required'];
  return pw.chromium.launch({headless: !headed, args: flags, ...(fs.existsSync(chrome) ? {executablePath: chrome} : {})});
}
export async function openPage(browser, harness, {width = 1440, height = 900, dpr = 1, theme = 'light', tier = 'standard', query = '', video = null} = {}) {
  const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr, ...(video ? {recordVideo: {dir: video, size: {width, height}}} : {})});
  await context.addInitScript(([tier, theme]) => {
    try { localStorage.setItem('pinkie.gamefx.v1', JSON.stringify({tier, custom: {}})); } catch {}
    // rAF 计数器：证明空闲时零 rAF。
    const raw = window.requestAnimationFrame.bind(window); window.__rafCalls = 0;
    window.requestAnimationFrame = cb => { window.__rafCalls++; return raw(cb); };
    const paint = () => { const d = document.documentElement; if (!d) return false; d.dataset.themeMode = theme === 'dark' ? 'dark' : 'light'; if (theme === 'dark') d.setAttribute('data-pinkie-night', ''); return true; };
    if (!paint()) document.addEventListener('readystatechange', paint, {once: true});
  }, [tier, theme]);
  const page = await context.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(harness.url + query);
  return {page, context};
}
async function demoReady(page) { await page.waitForFunction(() => window.__pinkieGameDemo && window.__pinkieGameFx); await page.evaluate(() => window.__pinkieGameFx.ensure()); }

async function demo() {
  const harness = await startHarness(); const browser = await launch();
  const shots = [];
  try {
    for (const width of [1440, 1920, 2560]) for (const theme of ['light', 'dark']) for (const tier of ['standard', 'cinematic']) {
      const height = Math.round(width * 10 / 16);
      const {page, context} = await openPage(browser, harness, {width, height, theme, tier, query: '&game-demo'});
      await demoReady(page);
      const tag = `${width}-${theme}-${tier}`;
      // 一屏粒子：所有种类同时从敌人处炸开
      await page.evaluate(() => { const fx = window.__pinkieGameFx, c = window.__pinkieGameDemo.center(); fx.kinds.forEach((k, i) => fx.burst(k, {x: c.x + (i % 6 - 2.5) * 90, y: c.y + (Math.floor(i / 6) - 1.5) * 90}, {power: .9})); });
      await wait(380); const f1 = path.join(out, `demo-particles-${tag}.png`); await page.screenshot({path: f1}); shots.push(f1);
      for (const preset of ['spell', 'curtain', 'stamp']) {
        const dur = await page.evaluate(p => { window.__pinkieGameFx.cinematic(p, {text: '碧琪大招！', sub: '演示', particle: 'stars'}); return ({spell: 1.9, curtain: 2, stamp: 1.4})[p] * (window.__pinkieGameFx.settings().cine === 'short' ? .62 : 1); }, preset);
        await wait(dur * 1000 * .55); const f = path.join(out, `demo-cine-${preset}-${tag}.png`); await page.screenshot({path: f}); shots.push(f);
        await page.waitForFunction(() => !window.__pinkieGameFx.stats().cine, null, {timeout: 6000});
      }
      await context.close();
    }
    // 1440 白天电影级：9 种过场每种一张中段截图
    const {page, context} = await openPage(browser, harness, {width: 1440, height: 900, tier: 'cinematic', query: '&game-demo'});
    await demoReady(page);
    const timing = {burst: 1.5, slash: 1.35, spell: 1.9, curtain: 2, ink: 1.9, warp: 1.8, rain: 1.8, stamp: 1.4, beam: 1.7};
    for (const [preset, d] of Object.entries(timing)) for (const at of [.3, .6]) {
      await page.evaluate(p => { window.__pinkieGameFx.cinematic(p, {text: '碧琪大招！', sub: window.__pinkieGameFx.presetLabel[p], particle: 'stars'}); return 0; }, preset);
      await wait(d * 1000 * at); const f = path.join(out, `cine-${preset}-${Math.round(at * 100)}.png`); await page.screenshot({path: f}); shots.push(f);
      await page.waitForFunction(() => !window.__pinkieGameFx.stats().cine, null, {timeout: 6000});
    }
    await context.close();
  } finally { await browser.close(); await harness.close(); }
  console.log(JSON.stringify({demo: shots.length, out}));
}

// 帧率：战斗负载 = 每 140 ms 一次命中（打向敌人的粒子流 + 命中炸开），每 1.4 s 一次暴击（顿帧 + 震屏），中间一次大招过场。
async function fps() {
  const harness = await startHarness(); const browser = await launch(); const rows = [];
  try {
    for (const tier of ['standard', 'cinematic']) {
      const {page, context} = await openPage(browser, harness, {width: 1440, height: 900, dpr: 2, tier, query: '&game-demo'});
      await demoReady(page);
      const r = await page.evaluate(async () => {
        const fx = window.__pinkieGameFx, demo = window.__pinkieGameDemo, sleep = ms => new Promise(r => setTimeout(r, ms));
        const from = {x: 520, y: innerHeight - 120}; let i = 0;
        const t0 = performance.now(); const timer = setInterval(() => { i++; fx.burst('stars', from, {pattern: 'stream', to: demo.target, count: 24}); if (i % 10 === 0) { fx.burst('sparkle', demo.center(), {count: 120, power: 1.6}); fx.shake(1.2); fx.hitstop(80); } }, 140);
        await sleep(5000); const battle = fx.fps(4500);
        clearInterval(timer); await sleep(200);
        const cineP = fx.cinematic('spell', {text: '碧琪大招！', particle: 'stars'}); await sleep(900); const cine = fx.fps(800); await cineP;
        return {battle, cine, ms: Math.round(performance.now() - t0)};
      });
      rows.push({tier, ...r}); await context.close();
    }
  } finally { await browser.close(); await harness.close(); }
  fs.writeFileSync(path.join(out, 'fps.json'), JSON.stringify(rows, null, 2)); console.log(JSON.stringify(rows));
}

// 空闲零 rAF + 页面隐藏即停
async function idle() {
  const harness = await startHarness(); const browser = await launch(); let res;
  try {
    const {page, context} = await openPage(browser, harness, {tier: 'cinematic', query: '&game-demo'});
    await demoReady(page);
    res = await page.evaluate(async () => {
      const fx = window.__pinkieGameFx, sleep = ms => new Promise(r => setTimeout(r, ms));
      await fx.burst('confetti', {x: 600, y: 400});
      await sleep(3200); // confetti 最长 2.4 s
      const s0 = fx.stats(), raf0 = window.__rafCalls; await sleep(3000); const s1 = fx.stats(), raf1 = window.__rafCalls;
      return {afterBurst: {rafActive: s0.rafActive, fxFramesDuringIdle: s1.frames - s0.frames, globalRafDuringIdle: raf1 - raf0}, contexts: s1.contexts};
    });
    // 页面隐藏：开一个长效果，然后切走
    await page.evaluate(() => window.__pinkieGameFx.burst('snow', {x: 600, y: 300}, {count: 200}));
    await wait(200);
    const hiddenPage = await context.newPage(); await hiddenPage.goto('about:blank'); await hiddenPage.bringToFront();
    await page.evaluate(() => Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}) || document.dispatchEvent(new Event('visibilitychange')));
    await wait(600);
    res.hidden = await page.evaluate(async () => { const a = window.__pinkieGameFx.stats().frames; await new Promise(r => setTimeout(r, 1000)); const s = window.__pinkieGameFx.stats(); return {rafActive: s.rafActive, framesWhileHidden: s.frames - a}; });
    await context.close();
  } finally { await browser.close(); await harness.close(); }
  fs.writeFileSync(path.join(out, 'idle.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res));
}

// 设置页：真实的 laolao-settings-user.js + 引擎，裸页面里打开「外观与声音」，点档位和细项，读回 settings()。
async function settingsPage() {
  const http = await import('node:http');
  const inj = path.join(repo, 'ui/injections');
  const html = `<!doctype html><html data-theme-mode="light"><meta charset="utf-8"><link rel="stylesheet" href="/laolao-settings-user.css"><link rel="stylesheet" href="/laolao-game-fx.css"><body style="margin:0;background:#f6eee6"><div class="config-view-toggle"></div><script defer src="/laolao-settings-user.js"></script><script defer src="/laolao-game-fx.js"></script></body></html>`;
  const server = http.createServer((req, res) => { const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1); if (!name) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; } const f = path.join(inj, name); if (!name.includes('..') && fs.existsSync(f)) { res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(f)); } else { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await launch(); const result = {};
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({viewport: {width: 1440, height: 1100}, deviceScaleFactor: 1});
      const page = await context.newPage(); page.on('pageerror', e => console.error('[pageerror]', e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => document.querySelector('.pk-gamefx-settings'), null, {timeout: 8000});
      await page.evaluate(theme => { document.documentElement.dataset.themeMode = theme; const root = document.getElementById('laolao-user-settings'); root.hidden = false; root.style.cssText += ';position:static;width:900px;margin:20px auto'; document.querySelector('.pk-gamefx-custom').open = true; document.querySelector('.pk-gamefx-tier-row').scrollIntoView({block: 'start'}); }, theme);
      if (theme === 'light') {
        const steps = [];
        for (const label of ['华丽', '标准', '安静', '电影级（默认）']) { await page.locator('.pk-gamefx-tier-row button', {hasText: label}).click(); steps.push(await page.evaluate(() => { const s = window.__pinkieGameFx.settings(); return {tier: s.tier, density: s.density, bloom: s.bloom, cine: s.cine, fps: s.fps, res: s.res}; })); }
        await page.locator('.pk-gamefx-custom .pinkie-user-settings__row', {hasText: '全屏过场'}).locator('button', {hasText: '简短'}).click();
        await page.locator('.pk-gamefx-custom .pinkie-user-settings__row', {hasText: '景深'}).locator('button', {hasText: '关'}).click();
        await page.locator('.pk-gamefx-custom input[aria-label="粒子密度"]').fill('35');
        await page.locator('.pk-gamefx-custom input[aria-label="粒子密度"]').dispatchEvent('change');
        steps.push(await page.evaluate(() => { const s = window.__pinkieGameFx.settings(); return {tier: s.tier, custom: s.custom, stored: localStorage.getItem('pinkie.gamefx.v1')}; }));
        await page.evaluate(() => { localStorage.setItem('pinkie.motion.reduce.v1', '1'); dispatchEvent(new CustomEvent('pinkie:motion-change')); });
        steps.push(await page.evaluate(() => { const s = window.__pinkieGameFx.settings(); return {reducedTier: s.tier, density: s.density, cine: s.cine, note: !document.querySelector('.pk-gamefx-reduced').hidden}; }));
        await page.screenshot({path: path.join(out, 'settings-reduced-light.png'), fullPage: true});
        await page.evaluate(() => { localStorage.setItem('pinkie.motion.reduce.v1', '0'); dispatchEvent(new CustomEvent('pinkie:motion-change')); });
        await page.waitForTimeout(500);
        steps.push(await page.evaluate(() => ({fps: window.__pinkieGameFx.settings().fps, pressed: [...document.querySelectorAll('.pk-gamefx-custom .pinkie-user-settings__row')].find(r => r.textContent.includes('帧率')).querySelector('[aria-pressed="true"]')?.textContent, tierPressed: document.querySelector('.pk-gamefx-tier-row [aria-pressed="true"]')?.textContent})));
        result.steps = steps;
      }
      await page.screenshot({path: path.join(out, `settings-${theme}.png`), fullPage: true});
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(out, 'settings.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cmd === 'settings') await settingsPage();
  if (cmd === 'demo' || cmd === 'all') await demo();
  if (cmd === 'fps' || cmd === 'all') await fps();
  if (cmd === 'idle' || cmd === 'all') await idle();
}
