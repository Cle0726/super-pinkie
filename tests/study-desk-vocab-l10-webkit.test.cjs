'use strict';
// #250 L10：在 WebKit 真页面里打开生词本，假网关应答缺字段或报错时，标题上方不能露出 JS 异常原文。
const test = require('node:test');
const assert = require('node:assert/strict');
let harnessModule;
const controlUIRoots = [process.env.PINKIE_CONTROL_UI_ROOT, '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui', require('node:path').resolve(__dirname, '../../sandbox/try/dist/control-ui')].filter(Boolean);
const needsControlUI = controlUIRoots.some(root => require('node:fs').existsSync(require('node:path').join(root, 'index.html'))) ? {} : {skip: '没有构建好的 control-ui'};
test.before(async () => { harnessModule = await import('../tools/study-desk/harness.mjs'); });

async function openVocab(handler, fn) {
  const harness = await harnessModule.startHarness({
    handler(method, params) {
      if (method === 'pinkie.learning.game.state') throw Error('unknown method: ' + method);
      return handler(method, params);
    },
  });
  const browser = await harnessModule.launchWithHarness(harness, () => harnessModule.playwright().webkit.launch({headless: true}));
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(harness.url);
    await page.locator('#pinkie-study-desk').waitFor();
    await page.evaluate(() => __pinkieStudyDesk.go('vocab'));
    const count = page.locator('.pinkie-desk-vocab .v-count').first();
    await count.waitFor();
    await page.waitForFunction(() => { const n = document.querySelector('.pinkie-desk-vocab .v-count'); return n && n.textContent !== '正在打开…'; });
    await fn(page, (await count.textContent()) || '');
    assert.deepEqual(errors, []);
  } finally { try { await browser.close(); } finally { await harness.close(); } }
}
const RAW_JS_ERROR = /Cannot read|undefined|is not a function|is not an object|TypeError/;

test('L10 WebKit：生词本应答是 {} 时标题上方显示「还没有生词」，不露 JS 异常原文', needsControlUI, async () => {
  await openVocab(() => ({}), async (page, text) => {
    assert.doesNotMatch(text, RAW_JS_ERROR);
    assert.equal(text, '还没有生词');
    await page.locator('.pinkie-desk-vocab .v-empty').getByText('生词本还是空的').waitFor();
  });
});

test('L10 WebKit：网关报的业务错误照样显示给用户', needsControlUI, async () => {
  await openVocab(method => {
    if (method === 'pinkie.learning.vocab.list') throw Error('互动学习只在学习模式会话中可用');
    return {};
  }, async (page, text) => {
    assert.equal(text, '互动学习只在学习模式会话中可用');
  });
});
