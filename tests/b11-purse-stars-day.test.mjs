import test from 'node:test';
import assert from 'node:assert/strict';
import {harnessWithGame, deskReady} from '../tools/study-game/game-qa.mjs';
import {playwright, launchWithHarness} from '../tools/study-desk/harness.mjs';

// 顶栏钱袋星星（.pkg-purse 里的 .pkg-glyph[data-kind="stars"]）日间旧色 #D99A1E 在纸色 #FAF6F1 上只有 2.27:1。
// 舞台形态牌里的星星走 --st-glyph（日 #7A5518 / 夜 #F2C14E），本单不能带动它。
const NIGHT_STARS = 'rgb(242, 193, 78)';
const STAGE_DAY_STARS = 'rgb(122, 85, 24)';
const OLD_DAY = 'rgb(217, 154, 30)';
// html:not(#_r1) 抬一级特异性，否则同特异性按文档顺序，改后的规则会赢、旧色注不上。
const OLD_RULE = 'html:not(#_r1) #pinkie-study-desk .pkg-purse .pkg-glyph[data-kind="stars"]{color:#D99A1E;transition:none}';
// 日间学习台可能透出的浅底：白、卡片、纸色、粉晕、纸色 2、外底。取最不利者兜底。
const DAY_BGS = [[255, 255, 255], [255, 253, 250], [250, 246, 241], [249, 225, 236], [242, 235, 228], [234, 219, 211]];

function measure(dayBgs) {
  const P = (s) => { const c = s.match(/color\(srgb ([^)]+)\)/); if (c) { const v = c[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; } const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const over = (f, b) => { const a = f[3]; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)).concat(1); };
  const lum = (c) => { const t = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * t[0] + .7152 * t[1] + .0722 * t[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const bgOf = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) chain.push(P(getComputedStyle(n).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) bg = over(c, bg); return bg; };
  const desk = document.querySelector('#pinkie-study-desk');
  const night = desk.dataset.theme === 'night';
  const purse = [...document.querySelectorAll('.pkg-purse .pkg-glyph[data-kind="stars"]')].filter(g => g.getClientRects().length).map(g => {
    const fg = P(getComputedStyle(g).color); const cb = bgOf(g);
    const worst = night ? ratio(over(fg, cb), cb) : Math.min(...dayBgs.map(b => ratio(over(fg, b.concat(1)), b.concat(1))));
    return {color: getComputedStyle(g).color, chain: ratio(over(fg, cb), cb), worst};
  });
  const stage = document.querySelector('.pkg-stage');
  const tag = [...document.querySelectorAll('.pkg-stage__tag .pkg-glyph[data-kind="stars"]')].map(g => getComputedStyle(g).color);
  return {theme: desk.dataset.theme, time: stage?.dataset.time, purse, tag};
}

test('B11 顶栏钱袋星星：日间 ≥ 3:1、夜间保持 #F2C14E、舞台形态牌星星不变；注回旧色 #D99A1E 日间必须 < 3（WebKit）', async () => {
  const {harness, close} = await harnessWithGame();
  const browser = await launchWithHarness(harness, () => playwright().webkit.launch({headless: true}));
  try {
    for (const view of ['today', 'gamepractice']) for (const width of [1440, 820]) for (const theme of ['day', 'night']) {
      const page = await browser.newPage({viewport: {width, height: 900}, reducedMotion: 'reduce'});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => { window.__pkBeijingHour = 10; });
      await page.goto(harness.url);
      await deskReady(page, view);
      if (theme === 'night') { await page.getByRole('button', {name: '切换日间和夜间'}).click(); await page.locator('#pinkie-study-desk[data-theme="night"]').waitFor(); }
      const at = `${view} ${width} ${theme}`;
      const r = await page.evaluate(measure, DAY_BGS);
      assert.equal(r.theme, theme, at);
      assert.ok(r.purse.length > 0, `${at}：钱袋里没找到星星`);
      for (const g of r.purse) {
        if (theme === 'night') assert.equal(g.color, NIGHT_STARS, `${at}：夜间钱袋星星颜色变了`);
        else assert.notEqual(g.color, OLD_DAY, `${at}：日间仍是旧色`);
        assert.ok(g.chain >= 3, `${at}：${g.color} 逐层合成 ${g.chain.toFixed(2)} < 3`);
        assert.ok(g.worst >= 3, `${at}：${g.color} 最不利底色 ${g.worst.toFixed(2)} < 3`);
      }
      if (r.time === 'day') for (const c of r.tag) assert.equal(c, STAGE_DAY_STARS, `${at}：舞台形态牌星星颜色变了`);
      if (theme === 'day') {
        await page.addStyleTag({content: OLD_RULE});
        await page.waitForFunction((old) => [...document.querySelectorAll('.pkg-purse .pkg-glyph[data-kind="stars"]')]
          .every((g) => getComputedStyle(g).color === old), OLD_DAY, {timeout: 5_000});
        const bad = await page.evaluate(measure, DAY_BGS);
        assert.ok(bad.purse.every(g => g.chain < 3 && g.worst < 3), `${at}：注回旧色后应 < 3，实测 ${bad.purse.map(g => `${g.chain.toFixed(2)}/${g.worst.toFixed(2)}`).join(' ')}`);
      }
      assert.deepEqual(errors, [], at);
      await page.close();
    }
  } finally { try { await browser.close(); } finally { await close(); } }
});
