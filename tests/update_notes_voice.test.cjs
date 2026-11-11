// 碧琪口吻的更新说明：摘要 + 「听碧琪一件件说」展开，白天/夜间/窄窗口都要摆得下。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
let playwright;
try { playwright = require(process.env.PINKIE_PLAYWRIGHT_PATH || 'playwright'); } catch {}
const ui = path.join(__dirname, '../ui/injections');
const info = {available:true, version:'2.5.48', summary:'碧琪给自己来了一次大扫除。',
  details:['第一件','第二件','第三件<img src=x onerror=alert(1)>','第四件']};

async function open(page, extra) {
  await page.setContent(`<!doctype html><html data-pinkie-platform="windows" data-laolao-mode="chat" ${extra||''}><head></head><body></body></html>`);
  await page.addStyleTag({path:path.join(ui,'laolao-update-dialog.css')});
  await page.addScriptTag({path:path.join(ui,'laolao-update-dialog.js')});
  await page.evaluate(() => { window.pywebview={api:{check_for_updates:async()=>({}),prepare_update:async()=>({}),apply_update:async()=>({})}}; });
}

test('long notes show the summary and 碧琪 expand entry; short notes show inline', {skip: !playwright, timeout: 30000}, async () => {
  const browser = await playwright.chromium.launch({headless:true, channel:'chrome'});
  for (const [width, night] of [[900,false],[900,true],[380,false]]) {
    const page = await browser.newPage({viewport:{width,height:820}});
    await open(page, night ? 'data-pinkie-night' : '');
    await page.evaluate(i => window.__pinkieUpdateDialog.open(i), info);
    await page.getByText('碧琪给自己来了一次大扫除。').waitFor();
    const more = page.getByRole('button', {name:'听碧琪一件件说'});
    assert.equal(await more.isVisible(), true);
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#pinkie-upd-details').isVisible(), false);
    assert.equal(await page.getByText('查看详细').count(), 0);
    await more.click();
    assert.equal(await page.locator('#pinkie-upd-details li').count(), 4);
    assert.equal(await page.locator('#pinkie-upd-details img').count(), 0);
    const less = page.getByRole('button', {name:'先说到这儿'});
    assert.equal(await less.getAttribute('aria-expanded'), 'true');
    // 不出横向滚动，入口不被挤出卡片。
    assert.equal(await page.evaluate(() => { const c=document.querySelector('.pinkie-upd'); return c.scrollWidth <= c.clientWidth; }), true);
    await less.click();
    assert.equal(await page.locator('#pinkie-upd-details').isVisible(), false);
    await page.close();
  }
  const page = await browser.newPage({viewport:{width:900,height:820}});
  await open(page);
  await page.evaluate(() => window.__pinkieUpdateDialog.open({available:true,version:'2.5.49',summary:'碧琪修好了一个小毛病。',details:['图标更清楚了']}));
  await page.getByText('图标更清楚了').waitFor();
  assert.equal(await page.locator('.pinkie-upd__more').isVisible(), false);
  // 旧格式（只有 notes 一串行）：第一行当摘要。
  await page.evaluate(() => { document.getElementById('pinkie-update-v2').remove(); window.__pinkieUpdateDialog.open({available:true,version:'2.5.40',notes:'一\n二\n三\n四'}); });
  assert.equal(await page.locator('.pinkie-upd__summary > span').innerText(), '一');
  assert.equal(await page.locator('.pinkie-upd__more').isVisible(), true);
  await browser.close();
});

test('Windows shows the installed card with the same notes', {skip: !playwright, timeout: 30000}, async () => {
  const browser = await playwright.chromium.launch({headless:true, channel:'chrome'});
  const page = await browser.newPage({viewport:{width:900,height:820}});
  await open(page);
  assert.equal(await page.evaluate(i => window.__pinkieUpdateDialog.showInstalled(i), {version:'2.5.48', summary:info.summary, details:info.details}), true);
  await page.getByRole('heading', {name:'碧琪换上新版本啦'}).waitFor();
  assert.equal(await page.locator('.pinkie-upd__panel').isVisible(), false);
  await page.getByRole('button', {name:'听碧琪一件件说'}).click();
  assert.equal(await page.locator('#pinkie-upd-details li').count(), 4);
  await page.getByRole('button', {name:'知道了'}).click();
  assert.equal(await page.locator('#pinkie-update-v2').count(), 0);
  assert.equal(await page.evaluate(() => window.__pinkieUpdateDialog.showInstalled({version:'1'})), false);
  await browser.close();
});
