'use strict';
// #250 L9：在 WebKit 真页面里打开看板，假网关 metrics 应答缺字段（默认 {}）或报错时，
// load 不能卡住（aria-busy 复位、「重新分析」可点），页面不抛异常、不露 JS 异常原文。
const test = require('node:test');
const assert = require('node:assert/strict');
let harnessModule;
const controlUIRoots = [process.env.PINKIE_CONTROL_UI_ROOT, '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui', require('node:path').resolve(__dirname, '../../sandbox/try/dist/control-ui')].filter(Boolean);
const needsControlUI = controlUIRoots.some(root => require('node:fs').existsSync(require('node:path').join(root, 'index.html'))) ? {} : {skip: '没有构建好的 control-ui'};
test.before(async () => { harnessModule = await import('../tools/study-desk/harness.mjs'); });

async function openBoard(handler, fn) {
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
    await page.evaluate(() => __pinkieStudyDesk.go('board'));
    await page.locator('.pinkie-desk-board .b-metrics').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.pinkie-desk-board')?.getAttribute('aria-busy') === 'false');
    const board = page.locator('.pinkie-desk-board').first();
    await fn(page, board);
    assert.deepEqual(errors, []);
  } finally { try { await browser.close(); } finally { await harness.close(); } }
}
const RAW_JS_ERROR = /Cannot read|undefined|is not a function|is not an object|is not iterable|TypeError/;

test('L9 WebKit：metrics 应答是 {} 时看板画出四张 0 卡，「重新分析」可点，不露 JS 异常原文', needsControlUI, async () => {
  await openBoard(() => ({}), async (page, board) => {
    assert.equal(await board.locator('.b-metrics .b-metric').count(), 4);
    assert.equal(await board.locator('.b-refresh').first().isEnabled(), true);
    assert.equal(await board.locator('.b-skeleton').count(), 0);
    assert.doesNotMatch((await board.textContent()) || '', RAW_JS_ERROR);
    await board.getByText('暂无可判断的作答').first().waitFor();
  });
});

test('L9 WebKit：网关报的业务错误照样显示给用户', needsControlUI, async () => {
  await openBoard(method => {
    if (method === 'pinkie.learning.desk.metrics') throw Error('互动学习只在学习模式会话中可用');
    return {};
  }, async (page, board) => {
    assert.equal(await board.locator('.b-metrics .b-failure').first().textContent(), '统计暂时没有读到：互动学习只在学习模式会话中可用');
    assert.equal(await board.locator('.b-refresh').first().isEnabled(), true);
  });
});
