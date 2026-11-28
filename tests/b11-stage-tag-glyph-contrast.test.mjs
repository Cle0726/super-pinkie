import test from 'node:test';
import assert from 'node:assert/strict';
import {harnessWithGame, deskReady} from '../tools/study-game/game-qa.mjs';
import {playwright, launchWithHarness} from '../tools/study-desk/harness.mjs';

// 舞台昼夜跟北京时间（.pkg-stage[data-time]），学习台主题跟按钮（#pinkie-study-desk[data-theme]），两者独立：
// 夜间主题 + 白天舞台时，夜间 stars 规则（1,3,0）压过形态牌的金色规则（1,2,0），亮黄 #F2C14E 落到浅色毛玻璃牌上，只有 ~1.0:1。
// 提速（L112）：北京时间只能在开页前注入，所以每个舞台时刻开一页（开页 + deskReady 8 → 2 次），
// 同一页上依次量 日间 1440 → 日间 820 → 切夜间 820 → 夜间 1440；反例要注入旧规则，放在这一页最后量（1440、820 各一次）。
// 断言与原来逐格一致：4 种主题 × 舞台组合 × 2 个宽度都量，反例两个宽度都量。
const HOURS = [10, 21];

// main@b3e231ad 的两条旧规则：注回后夜间主题 + 白天舞台必须变红。
// 加 html:not(#_r1) 抬一级特异性：同特异性时按文档顺序，学习台样式表排在注入的 <style> 后面，改后的同名规则会赢，旧色注不上（WebKit 实测仍是 #7A5518，6.32）。
const OLD_COLORS = {stars: 'rgb(242, 193, 78)', shards: 'rgb(154, 168, 255)'};
const OLD_RULES = `html:not(#_r1) #pinkie-study-desk[data-theme="night"] .pkg-glyph[data-kind="stars"]{color:#F2C14E;transition:none}
html:not(#_r1) #pinkie-study-desk[data-theme="night"] .pkg-glyph[data-kind="shards"]{color:#9AA8FF;transition:none}`;

function measure() {
  const P = (s) => { const c = s.match(/color\(srgb ([^)]+)\)/); if (c) { const v = c[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; } const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const over = (f, b) => { const a = f[3]; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)).concat(1); };
  const lum = (c) => { const t = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * t[0] + .7152 * t[1] + .0722 * t[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const bgOf = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) chain.push(P(getComputedStyle(n).backgroundColor)); let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) bg = over(c, bg); return bg; };
  const stage = document.querySelector('.pkg-stage'); const tag = stage.querySelector('.pkg-stage__tag');
  const night = stage.dataset.time === 'night';
  // 毛玻璃牌半透明：再按最不利的天空（白天亮天、夜里暗天）兜底。
  const tagBg = over(P(getComputedStyle(tag).backgroundColor), night ? [0, 0, 0, 1] : [255, 255, 255, 1]);
  const glyphs = [...tag.querySelectorAll('.pkg-glyph')].filter(g => g.getClientRects().length).map(g => {
    const fg = P(getComputedStyle(g).color); const cb = bgOf(g);
    return {kind: g.dataset.kind, color: getComputedStyle(g).color, chain: ratio(over(fg, cb), cb), sky: ratio(over(fg, tagBg), tagBg)};
  });
  return {time: stage.dataset.time, theme: document.querySelector('#pinkie-study-desk').dataset.theme, width: window.innerWidth, glyphs};
}

// 改视口后等布局真的换到这个宽度（innerWidth 到位、形态牌里的图标还在），再量。
async function resize(page, width) {
  await page.setViewportSize({width, height: 900});
  await page.waitForFunction((w) => window.innerWidth === w && !!document.querySelector('.pkg-stage .pkg-stage__tag .pkg-glyph'), width, {timeout: 5_000});
}

test('B11 舞台形态牌里的星星 / 封印 / 碎片图标：按舞台昼夜取色，四种主题 × 舞台组合都 ≥ 3:1；注回旧规则夜间主题 + 白天舞台变红（WebKit）', async () => {
  const {harness, close} = await harnessWithGame();
  const browser = await launchWithHarness(harness, () => playwright().webkit.launch({headless: true}));
  try {
    for (const hour of HOURS) {
      const stageTime = hour >= 18 ? 'night' : 'day';
      const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
      try {
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(h => { window.__pkBeijingHour = h; }, hour);
        await page.goto(harness.url);
        await deskReady(page, 'today');

        const check = async (width, theme) => {
          const at = `${width} 桌面${theme} 舞台${stageTime}`;
          const r = await page.evaluate(measure);
          assert.equal(r.width, width, at);
          assert.equal(r.time, stageTime, at);
          assert.equal(r.theme, theme, at);
          assert.ok(r.glyphs.length > 0, `${at}：形态牌里没找到 .pkg-glyph`);
          for (const g of r.glyphs) {
            assert.ok(g.chain >= 3, `${at}：${g.kind} ${g.color} 逐层合成 ${g.chain.toFixed(2)} < 3`);
            assert.ok(g.sky >= 3, `${at}：${g.kind} ${g.color} 最不利天空 ${g.sky.toFixed(2)} < 3`);
          }
          assert.deepEqual(errors, [], at);
        };

        await check(1440, 'day');
        await resize(page, 820);
        await check(820, 'day');
        await page.getByRole('button', {name: '切换日间和夜间'}).click();
        await page.locator('#pinkie-study-desk[data-theme="night"]').waitFor();
        await check(820, 'night');
        await resize(page, 1440);
        await check(1440, 'night');

        if (hour < 18) {
          await page.addStyleTag({content: OLD_RULES});
          await page.waitForFunction((old) => [...document.querySelectorAll('.pkg-stage__tag .pkg-glyph')]
            .filter((g) => old[g.dataset.kind]).every((g) => getComputedStyle(g).color === old[g.dataset.kind]), OLD_COLORS, {timeout: 5_000});
          for (const width of [1440, 820]) {
            if (width !== 1440) await resize(page, width);
            const at = `${width} 桌面night 舞台${stageTime}`;
            const bad = await page.evaluate(measure);
            assert.equal(bad.width, width, at);
            assert.ok(bad.glyphs.some(g => g.sky < 3), `${at}：注回旧规则后应 < 3，实测 ${bad.glyphs.map(g => `${g.kind}:${g.sky.toFixed(2)}`).join(' ')}`);
            assert.deepEqual(errors, [], at);
          }
        }
      } finally {
        await page.close();
      }
    }
  } finally { try { await browser.close(); } finally { await close(); } }
});
