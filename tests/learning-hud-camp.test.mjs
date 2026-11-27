import test from 'node:test';
import assert from 'node:assert/strict';
import {harnessWithGame, deskReady} from '../tools/study-game/game-qa.mjs';
import {playwright, launchWithHarness} from '../tools/study-desk/harness.mjs';

const CASES = [
  {width: 820, hour: 10, theme: 'day'},
  {width: 820, hour: 21, theme: 'night'},
  {width: 1440, hour: 10, theme: 'day'},
  {width: 1440, hour: 21, theme: 'night'},
];

function measure() {
  const P = (s) => { const c = s.match(/color\(srgb ([^)]+)\)/); if (c) { const v = c[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; } const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const over = (f, b) => { const a = f[3]; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)).concat(1); };
  const lum = (c) => { const t = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * t[0] + .7152 * t[1] + .0722 * t[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const bgOf = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) chain.push(P(getComputedStyle(n).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) bg = over(c, bg); return bg; };
  const stage = document.querySelector('.pkg-stage'); const tag = stage.querySelector('.pkg-stage__tag');
  const night = stage.dataset.time === 'night';
  // 角标是半透明毛玻璃：除了逐层合成，再按舞台天空最不利的一端（白天的亮天、夜里的暗天）兜底。
  const sky = night ? [0, 0, 0, 1] : [255, 255, 255, 1];
  const tagBg = over(P(getComputedStyle(tag).backgroundColor), sky);
  const contrast = (n) => { const fg = P(getComputedStyle(n).color); const cb = bgOf(n); return {text: n.textContent.trim(), chain: ratio(over(fg, cb), cb), sky: ratio(over(fg, tagBg), tagBg)}; };
  const meta = document.querySelector('.pkg-camp__top .pkg-who__meta');
  const b = meta.querySelector('b').getBoundingClientRect(), s = meta.querySelector('small').getBoundingClientRect();
  const overlap = Math.max(0, Math.min(b.right, s.right) - Math.max(b.left, s.left)) * Math.max(0, Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top));
  const lines = (n, r) => Math.round(r.height / parseFloat(getComputedStyle(n).fontSize));
  // 营地文字（舞台和 boss 卡另算：它们的底是渐变和背景图，逐层合成读不到）逐个算对比度，连同祖先的 opacity。
  const camp = document.querySelector('.pkg-camp'); const low = [];
  for (const n of camp.querySelectorAll('*')) {
    if (n.closest('.pkg-stage, .pkg-boss') || ![...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) || !n.getClientRects().length) continue;
    let op = 1; for (let m = n; m; m = m.parentElement) op *= +getComputedStyle(m).opacity;
    const fg = P(getComputedStyle(n).color); fg[3] *= op; const bg = bgOf(n); const k = ratio(over(fg, bg), bg);
    if (k < 4.5) low.push(`${n.className || n.tagName}「${n.textContent.trim().slice(0, 12)}」${k.toFixed(2)}`);
  }
  const borders = [...camp.querySelectorAll('.pkg-target')].map(t => { const bg = bgOf(t.parentElement); return {cls: t.className + (t.dataset.focus ? '[focus]' : ''), k: ratio(over(P(getComputedStyle(t).borderTopColor), bg), bg)}; });
  // 用相交面积判断，窄宽换行（≤640）布局下也成立。
  const top = document.querySelector('.pkg-camp__top');
  const hit = (x, y) => Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) * Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
  const rect = (sel) => top.querySelector(sel).getBoundingClientRect();
  const who = rect('.pkg-who'), purse = rect('.pkg-purse'), stars = rect('.pkg-purse .pkg-glyph[data-kind="stars"]'), hud = rect('.pkg-hud'), seg = rect('.pkg-seg');
  // .pkg-hud 自己 min-width:0 会被压窄，子项溢出时盒子本身碰不到 seg，所以逐个子项量。
  const kids = [...top.querySelector('.pkg-hud').children].filter(k => k.getClientRects().length).map(k => ({c: k.className, r: k.getBoundingClientRect()}));
  const kidsVsSeg = kids.filter(k => hit(k.r, seg) > 0).map(k => k.c), kidsOutOfHud = kids.filter(k => k.r.right - hud.right > 0.5).map(k => k.c);
  return {time: stage.dataset.time, theme: document.querySelector('#pinkie-study-desk').dataset.theme, metaDisplay: getComputedStyle(meta).display,
    overlap, bLines: lines(meta.querySelector('b'), b), smallLines: lines(meta.querySelector('small'), s),
    smallOutOfWho: Math.max(0, s.right - who.right), smallVsPurse: hit(s, purse), smallVsStars: hit(s, stars), hudVsSeg: hit(hud, seg), kidsVsSeg, kidsOutOfHud,
    small: contrast(tag.querySelector('small')), span: contrast(tag.querySelector('span')), low, borders};
}

test('camp HUD: name and intimacy level never overlap, stage tag and camp text are at least 4.5:1, target card borders at least 3:1, by day and night (WebKit)', async () => {
  const {harness, close} = await harnessWithGame();
  const browser = await launchWithHarness(harness, () => playwright().webkit.launch({headless: true}));
  try {
    for (const {width, hour, theme} of CASES) {
      const page = await browser.newPage({viewport: {width, height: 900}, reducedMotion: 'reduce'});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(h => { window.__pkBeijingHour = h; }, hour);
      await page.goto(harness.url);
      await deskReady(page, 'today');
      if (theme === 'night') { await page.getByRole('button', {name: '切换日间和夜间'}).click(); await page.locator('#pinkie-study-desk[data-theme="night"]').waitFor(); }
      const r = await page.evaluate(measure);
      const at = `${width}px 桌面${theme} 舞台${r.time}`;
      assert.equal(r.time, hour >= 18 ? 'night' : 'day', at);
      assert.equal(r.metaDisplay, 'grid', `${at}：.pkg-who__meta 的 grid 规则被吞`);
      assert.equal(r.overlap, 0, `${at}：「日常碧琪」与「亲密度」重叠`);
      assert.equal(r.bLines, 1, `${at}：名字折成 ${r.bLines} 行`);
      assert.equal(r.smallLines, 1, `${at}：「亲密度」被挤成 ${r.smallLines} 行`);
      assert.equal(r.smallOutOfWho, 0, `${at}：「亲密度」溢出 .pkg-who ${r.smallOutOfWho}px`);
      assert.equal(r.smallVsPurse, 0, `${at}：「亲密度」压到 .pkg-purse 分割线`);
      assert.equal(r.smallVsStars, 0, `${at}：「亲密度」与星星图标重叠`);
      assert.equal(r.hudVsSeg, 0, `${at}：HUD 压到 .pkg-seg`);
      assert.deepEqual(r.kidsVsSeg, [], `${at}：HUD 子项压到 .pkg-seg`);
      assert.deepEqual(r.kidsOutOfHud, [], `${at}：HUD 子项溢出 .pkg-hud`);
      for (const k of ['small', 'span']) {
        assert.ok(r[k].chain >= 4.5, `${at}：角标 ${k}「${r[k].text}」对比度 ${r[k].chain.toFixed(2)} < 4.5`);
        assert.ok(r[k].sky >= 4.5, `${at}：角标 ${k}「${r[k].text}」在最不利天空上 ${r[k].sky.toFixed(2)} < 4.5`);
      }
      assert.deepEqual(r.low, [], `${at}：营地文字对比度 < 4.5`);
      assert.ok(r.borders.length > 1, `${at}：没找到 .pkg-target`);
      for (const bd of r.borders) assert.ok(bd.k >= 3, `${at}：${bd.cls} 边框对比度 ${bd.k.toFixed(2)} < 3`);
      assert.deepEqual(errors, [], at);
      await page.close();
    }
  } finally { try { await browser.close(); } finally { await close(); } }
});
