#!/usr/bin/env node
// #250 L1 + L3：学习台今日营地，1440 / 820 × 日 / 夜（桌面主题与舞台 data-time 同步切换）。
// 约定同 minimal.mjs：node <脚本> --out <目录>，写 PNG 与 shots.jsonl，另写 report.json（重叠面积与角标对比度）。
// 隔离 harness，不连网关、不碰用户会话。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {harnessWithGame, deskReady} from '../study-game/game-qa.mjs';
import {playwright, launchWithHarness} from '../study-desk/harness.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = path.resolve(at >= 0 && args[at + 1] ? args[at + 1] : process.env.PINKIE_SHOTS_OUT || 'shots');
fs.mkdirSync(out, {recursive: true});
const engine = process.env.PINKIE_SHOTS_ENGINE || 'chromium';

function measure() {
  const P = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const over = (f, b) => { const a = f[3]; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)).concat(1); };
  const lum = (c) => { const t = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * t[0] + .7152 * t[1] + .0722 * t[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const bgOf = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) chain.push(P(getComputedStyle(n).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) bg = over(c, bg); return bg; };
  const tag = document.querySelector('.pkg-stage__tag');
  const c = (n) => { const fg = P(getComputedStyle(n).color), bg = bgOf(n); return {text: n.textContent.trim(), ratio: +ratio(over(fg, bg), bg).toFixed(2)}; };
  const meta = document.querySelector('.pkg-camp__top .pkg-who__meta');
  const b = meta.querySelector('b').getBoundingClientRect(), s = meta.querySelector('small').getBoundingClientRect();
  const hit = (x, y) => Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) * Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
  const overlap = hit(b, s);
  const top = document.querySelector('.pkg-camp__top'), rect = (sel) => top.querySelector(sel).getBoundingClientRect();
  const who = rect('.pkg-who'), purse = rect('.pkg-purse'), stars = rect('.pkg-purse .pkg-glyph[data-kind="stars"]'), hud = rect('.pkg-hud'), seg = rect('.pkg-seg');
  // .pkg-hud 自己 min-width:0 会被压窄，子项溢出时盒子本身碰不到 seg，所以逐个子项量。
  const kids = [...top.querySelector('.pkg-hud').children].filter(k => k.getClientRects().length).map(k => ({c: k.className, r: k.getBoundingClientRect()}));
  return {stageTime: document.querySelector('.pkg-stage').dataset.time, metaDisplay: getComputedStyle(meta).display, overlap,
    smallOutOfWho: +Math.max(0, s.right - who.right).toFixed(1), smallVsPurse: +hit(s, purse).toFixed(1), smallVsStars: +hit(s, stars).toFixed(1), hudVsSeg: +hit(hud, seg).toFixed(1),
    kidsVsSeg: kids.filter(k => hit(k.r, seg) > 0).map(k => k.c), kidsOutOfHud: kids.filter(k => k.r.right - hud.right > 0.5).map(k => k.c),
    tagSmall: c(tag.querySelector('small')), tagSpan: c(tag.querySelector('span'))};
}

const {harness, close} = await harnessWithGame();
const browser = await launchWithHarness(harness, () => playwright()[engine].launch(engine === 'chromium' && process.env.PINKIE_UI_CHANNEL ? {headless: true, channel: process.env.PINKIE_UI_CHANNEL} : {headless: true}));
const lines = [], report = [];
try {
  for (const night of [false, true]) for (const width of [1440, 820]) {
    const height = 900, name = `camp-${width}-${night ? 'night' : 'day'}`;
    const p = await browser.newPage({viewport: {width, height}});
    const pageErrors = []; p.on('pageerror', e => pageErrors.push(e.message));
    await p.addInitScript(h => { window.__pkBeijingHour = h; }, night ? 21 : 10);
    await p.goto(harness.url);
    await deskReady(p, 'today');
    if (night) { await p.getByRole('button', {name: '切换日间和夜间'}).click(); await p.locator('#pinkie-study-desk[data-theme="night"]').waitFor(); await p.waitForTimeout(600); }
    report.push({name, width, night, pageErrors, ...(await p.evaluate(measure))});
    const file = name + '.png';
    const buf = await p.screenshot({path: path.join(out, file)});
    await p.close();
    lines.push({name, file, os: process.platform, browser: engine, width, height, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
  }
} finally {
  try { await browser.close(); } finally { await close(); }
}
fs.appendFileSync(path.join(out, 'shots.jsonl'), lines.map((l) => JSON.stringify(l) + '\n').join(''));
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`pr-shots: ${lines.length} 张 → ${out}`);
