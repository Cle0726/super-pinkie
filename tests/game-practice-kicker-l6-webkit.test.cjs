'use strict';
// #250 L6：刷题首页 .pkp-home .pkb-kicker 日间对比度原为 2.95:1，要求在 WebKit 真页面里实测 ≥4.5:1；夜间字色不变。
const test = require('node:test');
const assert = require('node:assert/strict');
let harnessModule;
const controlUIRoots = [process.env.PINKIE_CONTROL_UI_ROOT, '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui', require('node:path').resolve(__dirname, '../../sandbox/try/dist/control-ui')].filter(Boolean);
const needsControlUI = controlUIRoots.some(root => require('node:fs').existsSync(require('node:path').join(root, 'index.html'))) ? {} : {skip: '没有构建好的 control-ui'};
let harness, browser, page;
const errors = [];
// B55：清理先于启动注册，逆序关闭（page → browser → harness），前一层失败不挡后一层。
test.after(async () => {
  try { await page?.context().close(); } finally {
    try { await browser?.close(); } finally { await harness?.close(); }
  }
});
test.before(async () => {
  harnessModule = await import('../tools/study-desk/harness.mjs');
  if (needsControlUI.skip) return;
  harness = await harnessModule.startHarness({
    handler(method) {
      if (method === 'pinkie.learning.game.practice.overview') return {total: 0, papers: 0, points: [], reserved: [], wrong: 0};
      throw Error('unknown method: ' + method);
    },
  });
  try {
    browser = await harnessModule.launchWithHarness(harness, () => harnessModule.playwright().webkit.launch({headless: true}));
  } catch (error) {
    harness = null; // launchWithHarness 失败时已自己关掉 harness
    throw error;
  }
  page = await browser.newPage({viewport: {width: 1440, height: 900}});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(harness.url);
  await page.locator('#pinkie-study-desk').waitFor();
  await page.evaluate(() => __pinkieStudyDesk.go('gamepractice'));
  await page.locator('.pkp-home .pkb-kicker').first().waitFor();
  await page.locator('.pkp-home .pkp-empty').first().waitFor();
});

// 两个测试共用同一页面：日间只读在前，夜间切主题在后；pageerror 按页累计，后面的测试连同前面的一起检查。
async function onPractice(fn) {
  await fn(page);
  assert.deepEqual(errors, []);
}

function measure(page) {
  return page.evaluate(() => {
    const rgb = s => {
      let m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(s);
      if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] == null ? 1 : +m[4]];
      m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
      return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : [0, 0, 0, 0];
    };
    const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3]));
    const kicker = document.querySelector('.pkp-home .pkb-kicker');
    const layers = [];
    for (let n = kicker; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.99) break;
    }
    let base = layers.length && layers[layers.length - 1][3] >= 0.99 ? layers.pop().slice(0, 3) : rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3);
    if (!base.some(Boolean) && !layers.length) base = [255, 255, 255];
    for (const c of layers.reverse()) base = over(c, base);
    const fgRaw = rgb(getComputedStyle(kicker).color);
    const fg = over(fgRaw, base);
    const [a, b] = [lum(fg), lum(base)].sort((x, y) => y - x);
    return {ratio: (a + 0.05) / (b + 0.05), color: getComputedStyle(kicker).color, bg: base.map(Math.round)};
  });
}

test('L6 WebKit：日间刷题首页 kicker 与实际底色对比度 ≥4.5:1', needsControlUI, async () => {
  await onPractice(async page => {
    assert.notEqual(await page.locator('#pinkie-study-desk').getAttribute('data-theme'), 'night');
    const m = await measure(page);
    assert.ok(m.ratio >= 4.5, `日间对比度 ${m.ratio.toFixed(2)}:1（字 ${m.color}，底 rgb(${m.bg})）`);
  });
});

test('L6 WebKit：夜间 kicker 字色不变，仍是 --pkg-ink-3 夜间值 #8E8294', needsControlUI, async () => {
  await onPractice(async page => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme-mode', 'dark'));
    await page.waitForFunction(() => document.querySelector('#pinkie-study-desk')?.getAttribute('data-theme') === 'night');
    const m = await measure(page);
    assert.equal(m.color, 'rgb(142, 130, 148)');
  });
});
