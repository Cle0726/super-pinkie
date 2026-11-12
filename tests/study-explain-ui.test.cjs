const test = require('node:test');
const assert = require('node:assert/strict');

test('刷题讲解失败可切模型重试，成功后显示结果并等足后台时间', {timeout: 30000}, async () => {
  const h = await import('../tools/study-desk/harness.mjs');
  let attempts = 0;
  const handler = async method => {
    if (method.endsWith('game.practice.start')) return {setId: 'set-qa', title: '隔离真题', mode: 'kind', items: [{itemId: 'q1', qkind: 'choice', stem: 'She depends ___ her team.', options: ['on', 'in', 'at', 'by']}]};
    if (method.endsWith('game.practice.answer')) return {correct: false, answer: 0, key: 'A. on', why: 'depend on 是依靠', combo: 0, awards: []};
    if (method.endsWith('game.practice.explain')) return ++attempts === 1 ? {text: '', source: 'none', error: '模型服务限流或额度不足，请在内置模型里换一个可用模型。'} : {text: '这里用 depend on，意思是依靠。', source: 'model'};
    if (method.endsWith('builtinModel.status')) return {available:true, selectedModel:'', model:'qa/model', modelName:'测试模型', defaultModel:'qa/model', defaultModelName:'测试模型', models:[{id:'qa/model',name:'测试模型'}]};
    return {};
  };
  const server = await h.startHarness({handler, legacyUI: true});
  const browser = await h.playwright().chromium.launch({headless:true, channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:800}}), errors = [];
    page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url); await page.waitForFunction(() => window.__pinkieGamePractice && window.__pinkieStudyDesk);
    await page.evaluate(() => {
      __pinkieGameBattle.arena = () => null;
      __pinkieGame.equippedForm = () => ({});
      __pinkieGame.play = () => {};
      const real = __pinkieGame.call;
      __pinkieGame.call = (name, params, timeout) => { if (name === 'practice.explain') window.qaExplainTimeout = timeout; return real(name, params, timeout); };
    });
    await page.evaluate(() => __pinkieGamePractice.openSet({mode:'kind', kind:'vc'}));
    await page.locator('.pkp-set .pkb-opt').first().waitFor();
    await page.locator('.pkp-set .pkb-opt').nth(1).click();
    await page.locator('.pkp-set .pk-drill-check').click();
    const box = page.locator('.pkp-fb'); await box.waitFor();
    await box.getByRole('button', {name:'讲给我听'}).click();
    await box.getByText(/限流或额度不足/).waitFor();
    assert.equal(await page.evaluate(() => qaExplainTimeout), 260000);
    await box.getByRole('button', {name:'切换模型'}).click();
    const dialog = page.getByRole('dialog', {name:'内置模型'}); await dialog.waitFor();
    await dialog.getByRole('button', {name:'关闭内置模型'}).click();
    await box.getByRole('button', {name:'再讲一次'}).click();
    await box.getByText('这里用 depend on，意思是依靠。').waitFor();
    assert.equal(attempts, 2);
    assert.equal(await box.getByText(/限流或额度不足/).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
