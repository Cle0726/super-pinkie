const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let h;
test.before(async () => { h = await import('../tools/study-desk/harness.mjs'); });

async function run(handler, fn) {
  const harness = await h.startHarness({handler, legacyUI: true});
  const browser = await h.playwright().chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 760}});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(harness.url); await page.locator('#pinkie-study-desk').waitFor();
    await page.evaluate(() => __pinkieStudyDesk.go('today'));
    await fn(page, harness);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await harness.close(); }
}
function status(selected = '') {
  const models = [{id: 'local/first', name: '第一号', provider: 'local', image: true}, {id: 'other/second', name: '第二号', provider: 'other', image: false}];
  const current = models.find(m => m.id === selected) || models[0];
  return {available: true, selectedModel: selected, model: current.id, modelName: current.name, defaultModel: 'local/first', defaultModelName: '第一号', models};
}

test('opens immediately, offers a custom monochrome interactive SVG, tests a draft and saves one shared selection', async () => {
  let release, selected = ''; const pending = new Promise(r => { release = r; });
  await run(async (method, p) => {
    if (method.endsWith('builtinModel.status')) { await pending; return status(selected); }
    if (method.endsWith('builtinModel.setModel')) { selected = p.model; return status(selected); }
    if (method.endsWith('builtinModel.test')) return {modelName: '第二号', ms: 540};
    return {};
  }, async (page, harness) => {
    const entry = page.getByRole('button', {name: '切换内置模型'});
    assert.equal(await entry.locator('svg .model-mark-book').count(), 1);
    assert.equal(await entry.locator('svg').getAttribute('fill'), 'none');
    assert.equal(await entry.locator('svg').getAttribute('stroke'), 'currentColor');
    await entry.click();
    const dialog = page.getByRole('dialog', {name: '内置模型'});
    await dialog.waitFor({state: 'visible', timeout: 1500});
    assert.match(await dialog.innerText(), /正在读取可用模型/);
    release();
    await dialog.getByText('第一号', {exact: true}).first().waitFor();
    assert.equal(await dialog.locator('svg .model-mark-book').count(), 1);
    await dialog.getByRole('searchbox', {name: '搜索内置模型'}).fill('other/second');
    assert.equal(await dialog.locator('[data-model-ref="local/first"]').isVisible(), false);
    const second = dialog.locator('[data-model-ref="other/second"]');
    await second.click(); assert.equal(await second.getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.locator('.model-mark-star').count(), 1);
    await dialog.getByRole('button', {name: '测试连接'}).click();
    await dialog.getByText(/连接成功/).waitFor();
    assert.equal(selected, '');
    await dialog.getByRole('button', {name: '应用模型'}).click();
    await dialog.getByText(/已保存/).waitFor();
    assert.equal(selected, 'other/second');
    assert.equal(harness.calls.filter(c => c.method.endsWith('builtinModel.setModel')).length, 1);
    assert.equal(harness.calls.find(c => c.method.endsWith('builtinModel.test')).params.model, 'other/second');
    await dialog.getByRole('searchbox').fill('');
    await dialog.getByRole('button', {name: /跟随学习模式/}).click();
    await dialog.getByRole('button', {name: '应用模型'}).click();
    await page.waitForFunction(() => document.querySelector('.desk-model-current-name')?.textContent === '第一号');
    assert.equal(selected, '');
    await dialog.getByRole('button', {name: '关闭内置模型'}).click();
    assert.equal(await dialog.count(), 0);
  });
});

test('load errors can be retried and closing during a slow request never reopens the dialog', async () => {
  let calls = 0, release; const pending = new Promise(r => { release = r; });
  await run(async method => {
    if (method.endsWith('builtinModel.status')) {
      calls++;
      if (calls === 1) throw Error('连接断开');
      if (calls === 3) await pending;
      return status();
    }
    return {};
  }, async page => {
    const entry = page.getByRole('button', {name: '切换内置模型'});
    await entry.click();
    const dialog = page.getByRole('dialog', {name: '内置模型'});
    await dialog.getByText('连接断开').waitFor();
    await dialog.getByRole('button', {name: '重新加载'}).click();
    await dialog.getByRole('button', {name: /第二号/}).waitFor();
    await dialog.getByRole('button', {name: '关闭内置模型'}).click();
    await entry.click();
    await dialog.getByText('正在读取可用模型…', {exact: true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    release();
    await page.waitForTimeout(100);
    assert.equal(await dialog.count(), 0);
  });
});

test('the notebook model entry opens the same shared model panel', async () => {
  const notebook = h.createNotebookV2Mock();
  await run(async (method, params) => method.endsWith('builtinModel.status') ? status() : notebook.handler(method, params), async page => {
    await page.evaluate(() => __pinkieStudyDesk.go('notes', {exam: 'pretco-b', subject: '语法', mode: 'cards'}));
    await page.locator('.n-card').first().waitFor();
    await page.getByRole('button', {name: '笔记本更多'}).click();
    await page.getByRole('menuitem', {name: '整理模型'}).click();
    await page.getByRole('dialog', {name: '内置模型'}).getByRole('button', {name: /第二号/}).waitFor();
  });
});

test('dialog remains usable in light, dark and narrow layouts', async () => {
  await run(async method => method.endsWith('builtinModel.status') ? status('other/second') : {}, async page => {
    const output = process.env.PINKIE_MODEL_SCREENSHOTS;
    if (output) fs.mkdirSync(output, {recursive: true});
    const check = async name => {
      const dialog = page.getByRole('dialog', {name: '内置模型'});
      await dialog.getByRole('button', {name: /第二号/}).waitFor();
      const rect = await dialog.boundingBox(); const viewport = page.viewportSize();
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, JSON.stringify(rect));
      assert.equal(await dialog.getByRole('button', {name: '应用模型'}).isVisible(), true);
      if (output) await page.screenshot({path: `${output}/${name}.png`});
      await dialog.getByRole('button', {name: '关闭内置模型'}).click();
    };
    const entry = page.getByRole('button', {name: '切换内置模型'});
    await entry.click(); await check('day');
    await page.getByRole('button', {name: '切换日间和夜间'}).click();
    await entry.click(); await check('night');
    await page.setViewportSize({width: 390, height: 700});
    await entry.click(); await check('narrow');
  });
});
