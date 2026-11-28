'use strict';
// #250 L10：在 WebKit 真页面里打开生词本，假网关应答缺字段或报错时，标题上方不能露出 JS 异常原文。
// 整个文件只起一套 harness、一个 WebKit、一个 page：macOS 上 WebKit 每次 newPage 约 10s（同 context 也一样），同页重载只要约 0.3s。
// 用例之间只换假网关应答（currentHandler）再 goto 整页重载（harness 页面每次加载都会重写 localStorage，状态不串），pageerror 按用例重新收集。
// 启动只做一次，失败会被记住并在每个用例里重抛；after 按逆序先关 page、再关 browser、最后关 harness。
const test = require('node:test');
const assert = require('node:assert/strict');
let harnessModule;
const controlUIRoots = [process.env.PINKIE_CONTROL_UI_ROOT, '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui', require('node:path').resolve(__dirname, '../../sandbox/try/dist/control-ui')].filter(Boolean);
const needsControlUI = controlUIRoots.some(root => require('node:fs').existsSync(require('node:path').join(root, 'index.html'))) ? {} : {skip: '没有构建好的 control-ui'};
test.before(async () => { harnessModule = await import('../tools/study-desk/harness.mjs'); });

let currentHandler = () => ({});
let shared = null;
async function closeAll({harness, browser, page}) {
  try { await page?.close(); }
  finally { try { await browser?.close(); } finally { await harness.close(); } }
}
test.after(async () => {
  if (!shared) return;
  const got = await shared;
  if (!got.error) await closeAll(got);
});
function sharedSetup() {
  shared ??= (async () => {
    const harness = await harnessModule.startHarness({
      handler(method, params) {
        if (method === 'pinkie.learning.game.state') throw Error('unknown method: ' + method);
        return currentHandler(method, params);
      },
    });
    const browser = await harnessModule.launchWithHarness(harness, () => harnessModule.playwright().webkit.launch({headless: true}));
    let page;
    try { page = await browser.newPage({viewport: {width: 1440, height: 900}}); }
    catch (error) { await closeAll({harness, browser}); throw error; }
    return {harness, browser, page};
  })().catch(error => ({error}));
  return shared.then(got => { if (got.error) throw got.error; return got; });
}

async function openVocab(handler, fn) {
  const {harness, page} = await sharedSetup();
  currentHandler = handler;
  const errors = [];
  const onError = e => errors.push(e.message);
  page.on('pageerror', onError);
  try {
    await page.goto(harness.url);
    await page.locator('#pinkie-study-desk').waitFor();
    await page.evaluate(() => __pinkieStudyDesk.go('vocab'));
    const count = page.locator('.pinkie-desk-vocab .v-count').first();
    await count.waitFor();
    await page.waitForFunction(() => { const n = document.querySelector('.pinkie-desk-vocab .v-count'); return n && n.textContent !== '正在打开…'; });
    await fn(page, (await count.textContent()) || '');
    assert.deepEqual(errors, []);
  } finally { page.off('pageerror', onError); }
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
