const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('full-page note menus escape cards, fit inside the view, restore focus and close on navigation', {timeout:45000}, async () => {
  const {startHarness, playwright, createNotebookV2Mock} = await import('../tools/study-desk/harness.mjs');
  const mock = createNotebookV2Mock(), server = await startHarness({handler:mock.handler});
  const browser = await playwright().chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1024,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.url);await page.waitForFunction(()=>!!window.__pinkieStudyDesk);
    await page.evaluate(()=>__pinkieStudyDesk.go('notes',{exam:'pretco-b',subject:'语法',mode:'cards'}));await page.locator('.n-card').first().waitFor();
    const more=page.locator('.n-card .n-icon').first();await more.click();const menu=page.locator('.n-menu[role=menu]');await menu.waitFor();
    assert.equal(await menu.evaluate(n=>n.parentElement.classList.contains('pinkie-desk-notes')),true);
    const geometry=await menu.evaluate(n=>({menu:n.getBoundingClientRect().toJSON(),root:n.parentElement.getBoundingClientRect().toJSON()}));
    assert.ok(geometry.menu.top>=geometry.root.top && geometry.menu.bottom<=geometry.root.bottom+1);
    await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});assert.equal(await more.evaluate(n=>n===document.activeElement),true);
    await more.click();await page.evaluate(()=>__pinkieStudyDesk.go('today'));assert.equal(await page.locator('.n-menu').count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
});

test('learning stage cache keys match across the head fragment and both installers', () => {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  for (const asset of ['css', 'js']) {
    const key = fragment.match(new RegExp(`laolao-learning-stage\\.${asset}\\?v=([a-z]+\\d+)`))[1];
    // CSS and JS advance independently; each install site must match the
    // fragment's own key for that asset.
    assert.match(key, /^learning\d+$/);
    const macKeys = [...mac.matchAll(new RegExp(`laolao-learning-stage\\.${asset}\\?v=([a-z]+\\d+)`, 'g'))].map(match => match[1]);
    assert.ok(macKeys.length >= 2);
    assert.deepEqual([...new Set(macKeys)], [key]);
    assert.match(windows, new RegExp(`laolao-learning-stage\\.${asset}\\?v=${key}`));
    assert.match(windows, new RegExp(`'laolao-learning-stage\\.${asset}' = '${key}'`));
  }
  assert.deepEqual([...fs.readFileSync(path.join(root, 'installer/windows/apply-theme.ps1')).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
