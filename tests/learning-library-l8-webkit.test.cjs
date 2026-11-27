const test = require('node:test');
const assert = require('node:assert/strict');
let harnessModule;
const controlUIRoots = [process.env.PINKIE_CONTROL_UI_ROOT, '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui', require('node:path').resolve(__dirname, '../../sandbox/try/dist/control-ui')].filter(Boolean);
const needsControlUI = controlUIRoots.some(root => require('node:fs').existsSync(require('node:path').join(root, 'index.html'))) ? {} : {skip: '没有构建好的 control-ui'};
test.before(async () => { harnessModule = await import('../tools/study-desk/harness.mjs'); });

// Border contrast against what is actually painted behind it: translucent borders and
// backgrounds are composited up the ancestor chain, onto white when nothing is opaque.
function borderContrast(selector) {
  const rgba = c => { const v = c.match(/[\d.]+/g).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const over = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
  const node = document.querySelector(selector);
  const layers = [];
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    const bg = rgba(getComputedStyle(n).backgroundColor);
    if (bg[3] > 0) layers.push(bg);
    if (bg[3] >= 1) break;
  }
  let base = [255, 255, 255, 1];
  for (const layer of layers.reverse()) base = over(layer, base);
  const edge = over(rgba(getComputedStyle(node).borderTopColor), base);
  const lum = c => c.slice(0, 3).map(v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const a = lum(edge), b = lum(base);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('bookshelf search box and primary buttons keep a ≥3:1 border in day and night (#250 L8)', needsControlUI, async () => {
  const service = await harnessModule.isolatedService();
  const harness = await harnessModule.startHarness({legacyUI: true, handler(method, params) {
    if (method === 'pinkie.learning.game.state') throw Error('unknown method: ' + method);
    return service.handler(method, params);
  }});
  const browser = await harnessModule.launchWithHarness(harness, () => harnessModule.playwright().webkit.launch({headless: true}));
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(harness.url);
    await page.locator('#pinkie-study-desk').waitFor();
    await page.getByRole('button', {name: '书架', exact: true}).click({modifiers: ['Alt']});
    await page.locator('.pinkie-library:not([hidden]) .pinkie-library__search').waitFor();
    const low = [];
    for (const theme of ['day', 'night']) {
      if (theme === 'night') await page.getByRole('button', {name: '切换日间和夜间'}).click();
      const night = await page.evaluate(() => document.documentElement.hasAttribute('data-pinkie-night'));
      assert.equal(night, theme === 'night', `${theme}: theme switch did not apply`);
      for (const selector of ['.pinkie-library .pinkie-library__search', '.pinkie-library .pinkie-library__primary']) {
        const ratio = await page.evaluate(borderContrast, selector);
        if (ratio < 3) low.push(`${theme} ${selector} ${ratio.toFixed(2)}`);
      }
    }
    assert.deepEqual(low, [], 'border contrast below 3:1');
    assert.deepEqual(errors, []);
  } finally { try { await browser.close(); } finally { try { await harness.close(); } finally { await service.close(); } } }
});
