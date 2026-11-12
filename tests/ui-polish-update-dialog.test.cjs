const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
let playwright;
try { playwright = require(process.env.PINKIE_PLAYWRIGHT_PATH || 'playwright'); } catch {}
const ui = path.join(__dirname, '../ui/injections');

test('real progress, unknown total, background continuation and retry', {skip: !playwright, timeout: 30000}, async () => {
  const browser = await playwright.chromium.launch({headless:true, channel:'chrome'});
  const page = await browser.newPage({viewport:{width:900,height:840}});
  try {
    await page.setContent('<!doctype html><html data-pinkie-platform="windows" data-laolao-mode="chat"><head></head><body><button id="origin">更新</button></body></html>');
    await page.addStyleTag({path:path.join(ui,'laolao-update-dialog.css')});
    await page.addScriptTag({path:path.join(ui,'laolao-update-dialog.js')});
    await page.evaluate(() => {
      window.testUpdate={calls:0};
      window.pywebview={api:{check_for_updates:async()=>({available:true,version:'2.6.0',notes:'第一条\n<img src=x onerror=alert(1)>'}),
        prepare_update:()=>{window.testUpdate.calls++;return new Promise(resolve=>{window.testUpdate.resolve=resolve})},
        apply_update:async()=>({started:false})}};
    });
    await page.locator('#origin').focus();
    assert.equal(await page.evaluate(()=>window.__pinkieUpdateDialog.open()),true);
    await page.getByRole('heading',{name:'有新版本啦'}).waitFor();
    assert.equal(await page.locator('.pinkie-upd__notes img').count(),0);
    await page.getByRole('button',{name:'开始下载'}).click();
    await page.evaluate(()=>window.__pinkieUpdateProgress({stage:'download',downloaded:1048576,total:4194304,bytesPerSecond:1048576,etaSeconds:3}));
    assert.match(await page.locator('.pinkie-upd__measure').innerText(),/1\.0 MB \/ 4\.0 MB\s+25%/);
    assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),'25');
    await page.evaluate(()=>window.__pinkieUpdateProgress({stage:'download',downloaded:2097152,total:null,bytesPerSecond:524288,etaSeconds:null}));
    assert.match(await page.locator('.pinkie-upd__measure').innerText(),/已下载 2\.0 MB/);
    assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),null);
    await page.getByRole('button',{name:'后台下载'}).click();
    assert.equal(await page.locator('#pinkie-update-v2').count(),0);
    assert.equal(await page.evaluate(()=>window.__pinkieUpdateDialog.open()),true);
    await page.getByRole('heading',{name:'更新包正在路上'}).waitFor();
    await page.evaluate(()=>window.testUpdate.resolve({ready:false}));
    await page.getByRole('heading',{name:'这次没更新成功'}).waitFor();
    assert.match(await page.getByRole('link',{name:'手动下载'}).getAttribute('href'),/^https:\/\/github\.com\//);
    await page.getByRole('button',{name:'重新试试'}).click();
    assert.equal(await page.evaluate(()=>window.testUpdate.calls),2);
    await page.evaluate(()=>window.__pinkieUpdateProgress({stage:'verify'}));
    await page.getByRole('heading',{name:'下载好了，正在检查'}).waitFor();
    await page.evaluate(()=>window.testUpdate.resolve({ready:true}));
    await page.getByRole('heading',{name:'准备好了'}).waitFor();
    await page.getByRole('button',{name:'安装并重启'}).click();
    await page.getByRole('heading',{name:'这次没更新成功'}).waitFor();
    assert.equal(await page.getByText('你的记忆和设置不会丢。').isVisible(),true);
    await page.getByRole('button',{name:'关闭更新窗口'}).click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'origin');
    await page.evaluate(()=>document.documentElement.setAttribute('data-laolao-mode','other'));
    assert.equal(await page.evaluate(()=>window.__pinkieUpdateDialog.open()),false);
  } finally { await browser.close(); }
});

test('Mac native bridge carries unknown-size progress, release notes and install response', {skip: !playwright, timeout: 30000}, async () => {
  const browser = await playwright.chromium.launch({headless:true, channel:'chrome'});
  const page = await browser.newPage({viewport:{width:900,height:840}});
  try {
    await page.setContent('<!doctype html><html data-laolao-mode="project"><head></head><body></body></html>');
    await page.addStyleTag({path:path.join(ui,'laolao-update-dialog.css')});
    await page.addScriptTag({path:path.join(ui,'laolao-update-dialog.js')});
    await page.evaluate(() => {
      window.__pinkieMacUpdaterV2=true;window.macMessages=[];
      window.webkit={messageHandlers:{laolaoUpdate:{postMessage:message=>window.macMessages.push(message)}}};
    });
    assert.equal(await page.evaluate(()=>window.__pinkieUpdateDialog.open()),true);
    let request=await page.evaluate(()=>window.macMessages.at(-1));assert.equal(request.action,'check');
    await page.evaluate(id=>window.__pinkieUpdateResult(id,{supported:true,available:true,unchangedCheckout:true}),request.request);
    await page.getByRole('heading',{name:'源码没有新提交'}).waitFor();
    await page.getByRole('button',{name:'开始下载'}).click();
    request=await page.evaluate(()=>window.macMessages.at(-1));assert.equal(request.action,'prepare');
    await page.evaluate(()=>window.__pinkieUpdateProgress({stage:'download',downloaded:3145728,total:null,bytesPerSecond:1048576,etaSeconds:null}));
    assert.match(await page.locator('.pinkie-upd__measure').innerText(),/已下载 3\.0 MB/);
    assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),null);
    await page.evaluate(()=>{window.__pinkieUpdateProgress({stage:'verify'});window.__pinkieUpdateProgress({stage:'metadata',version:'3.0.0',notes:'发布说明一\n发布说明二\n发布说明三'});});
    assert.equal(await page.locator('.pinkie-upd__summary > span').innerText(),'发布说明一');assert.equal(await page.locator('.pinkie-upd__notes li').count(),2);
    await page.evaluate(id=>window.__pinkieUpdateResult(id,{ready:true,version:'3.0.0'}),request.request);
    await page.getByRole('button',{name:'安装并重启'}).click();
    request=await page.evaluate(()=>window.macMessages.at(-1));assert.equal(request.action,'apply');
    await page.evaluate(id=>window.__pinkieUpdateResult(id,{started:false,message:'安装暂不可用'}),request.request);
    await page.getByRole('heading',{name:'这次没更新成功'}).waitFor();
    assert.equal(await page.getByText('安装暂不可用').isVisible(),true);
  } finally { await browser.close(); }
});
