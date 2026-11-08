// 学习台游戏 · 特效逐帧审片。引擎放慢到 0.2 倍（CSS 动画同步放慢），按时间点截图，再拼成接触表给人 / 给模型看。
// 只在隔离 harness 里跑：不连 18789，不碰用户的 App 和学习数据。
// 用法：NODE_PATH=<App>/runtime/openclaw/node_modules node tools/study-game/vfx-shots.mjs [cine|hits|kinds|awards|all] [--theme=light|dark] [--preset=a,b] [--out=dir] [--dpr=1]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startHarness} from '../study-desk/harness.mjs';
import {launch, openPage} from './ui-qa.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), cmd = args.find(a => !a.startsWith('--')) || 'all';
const opt = (name, d) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const out = path.resolve(opt('out', path.join(repo, 'design/study-game/vfx')));
const theme = opt('theme', 'dark'), dpr = Number(opt('dpr', 1)), slow = .2;
fs.mkdirSync(out, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
function sheet(files, name, tile) {
  if (!files.length) return null;
  const target = path.join(out, name);
  execFileSync('magick', ['montage', '-font', FONT, '-pointsize', '18', '-background', '#111', '-fill', '#ddd', ...files.flatMap(f => ['-label', path.basename(f, '.png'), f]), '-tile', tile, '-geometry', '720x450+4+4', target]);
  return target;
}
async function ready(page) {
  await page.waitForFunction(() => window.__pinkieGameDemo && window.__pinkieGameFx);
  await page.evaluate(() => window.__pinkieGameFx.ensure());
  await page.evaluate(() => { document.querySelector('.pk-gamefx-demo').style.display = 'none'; document.querySelector('.pk-gamefx-demo-stage').style.left = '0'; });
  await wait(400);
}
async function engineTime(page) { return page.evaluate(() => window.__pinkieGameFx._st().time); }
async function atEngine(page, t0, dt) { for (let i = 0; i < 400; i++) { if ((await engineTime(page)) - t0 >= dt) return; await wait(15); } }

async function cine(page) {
  const files = [];
  const presets = opt('preset', '').split(',').filter(Boolean);
  const list = presets.length ? presets : await page.evaluate(() => window.__pinkieGameFx.presets);
  for (const preset of list) {
    await page.evaluate(p => { const fx = window.__pinkieGameFx, d = window.__pinkieGameDemo; fx._timeScale(.2); fx.cinematic(p, {text: '星砂 · 流转', sub: '连续盖章 7 天', kicker: d.form.name, palette: d.form.palette, particle: 'stars', form: d.form}); setTimeout(() => fx._timeScale(.2), 40); return 0; }, preset);
    await page.waitForFunction(() => window.__pinkieGameFx._st().cine);
    for (const f of [.08, .18, .3, .5, .7, .8, .86, .93]) {
      for (let i = 0; i < 600; i++) { const T = await page.evaluate(() => { const c = window.__pinkieGameFx._st().cine; return c ? c.t / c.dur : 2; }); if (T >= f) break; await wait(15); }
      const file = path.join(out, `cine-${theme}-${preset}-${String(Math.round(f * 100)).padStart(2, '0')}.png`); await page.screenshot({path: file}); files.push(file);
    }
    await page.waitForFunction(() => !window.__pinkieGameFx._st().cine, null, {timeout: 30000});
    await page.evaluate(() => window.__pinkieGameFx._timeScale(1)); await wait(300);
  }
  for (const preset of list) sheet(files.filter(f => f.includes(`-${preset}-`)), `sheet-cine-${theme}-${preset}.png`, '4x2');
  return files.length;
}
async function grid(page, names, fire, label) {
  const files = [];
  await page.evaluate(() => window.__pinkieGameFx._timeScale(.2));
  const t0 = await page.evaluate(([names, fire]) => {
    const fx = window.__pinkieGameFx, W = innerWidth, H = innerHeight, cols = 6, rows = Math.ceil(names.length / cols);
    names.forEach((n, i) => { const x = W * (i % cols + .5) / cols, y = H * (Math.floor(i / cols) + .5) / rows; fx[fire](n, {x, y}, fire === 'hit' ? {sound: false} : {}); });
    return fx._st().time;
  }, [names, fire]);
  for (const dt of [.06, .16, .35, .7, 1.3]) { await atEngine(page, t0, dt); const file = path.join(out, `${label}-${theme}-${String(Math.round(dt * 100)).padStart(3, '0')}.png`); await page.screenshot({path: file}); files.push(file); }
  await page.evaluate(() => window.__pinkieGameFx._timeScale(1)); await wait(2500);
  sheet(files, `sheet-${label}-${theme}.png`, '3x2');
  // 单张放大：每个元素单独看（第一张时间点之后的 0.16 s）
  return files.length;
}
async function single(page, names, fire, label) {
  const files = [];
  for (const n of names) {
    await page.evaluate(() => window.__pinkieGameFx._timeScale(.2));
    const t0 = await page.evaluate(([n, fire]) => { const fx = window.__pinkieGameFx, c = window.__pinkieGameDemo.center(); fx[fire](n, c, fire === 'hit' ? {sound: false} : {}); return fx._st().time; }, [n, fire]);
    for (const dt of [.12, .45]) { await atEngine(page, t0, dt); const box = await page.evaluate(() => { const c = window.__pinkieGameDemo.center(); return {x: Math.max(0, c.x - 360), y: Math.max(0, c.y - 225), width: 720, height: 450}; }); const file = path.join(out, `${label}-${theme}-${n}-${Math.round(dt * 100)}.png`); await page.screenshot({path: file, clip: box}); files.push(file); }
    await page.evaluate(() => window.__pinkieGameFx._timeScale(1)); await wait(1200);
  }
  sheet(files, `sheet-${label}-single-${theme}.png`, '6x');
  return files.length;
}
async function awards(page) {
  const files = [];
  for (const lv of ['small', 'medium', 'big']) {
    await page.evaluate(lv => { const d = window.__pinkieGameDemo; window.__pinkieGameFx.playAward({id: 'shot-' + lv + Date.now(), kind: 'stars', amount: 48, reason: '背一背 · 全对', fx: lv}, {from: d.target}); window.__pinkieGameFx.playAward({id: 'shot-s-' + lv + Date.now(), kind: lv === 'big' ? 'seals' : 'shards', amount: 3, reason: '守关成功', fx: 'small'}, {from: d.target}); return 0; }, lv);
    for (const ms of [250, 700]) { await wait(ms === 250 ? 250 : 450); const file = path.join(out, `award-${theme}-${lv}-${ms}.png`); await page.screenshot({path: file}); files.push(file); }
    await wait(2600);
  }
  sheet(files, `sheet-awards-${theme}.png`, '2x3');
  return files.length;
}

const harness = await startHarness(); const browser = await launch();
const result = {};
try {
  const {page, context} = await openPage(browser, harness, {width: 1440, height: 900, dpr, theme, tier: opt('tier', 'cinematic'), query: '&game-demo'});
  await ready(page);
  if (cmd === 'kinds' || cmd === 'all') { const names = await page.evaluate(() => window.__pinkieGameFx.kinds); result.kinds = await grid(page, names, 'burst', 'kinds'); if (args.includes('--single')) result.kindsSingle = await single(page, names, 'burst', 'kind'); }
  if (cmd === 'hits' || cmd === 'all') { const names = await page.evaluate(() => window.__pinkieGameFx.hits); result.hits = await grid(page, names, 'hit', 'hits'); if (args.includes('--single')) result.hitsSingle = await single(page, names, 'hit', 'hit'); }
  if (cmd === 'cine' || cmd === 'all') result.cine = await cine(page);
  if (cmd === 'awards' || cmd === 'all') result.awards = await awards(page);
  await context.close();
} finally { await browser.close(); await harness.close(); }
console.log(JSON.stringify({...result, out}));
