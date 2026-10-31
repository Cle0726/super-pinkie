const test=require('node:test'),assert=require('node:assert/strict');
for(const engine of ['chromium','webkit']) test(engine+': new learning chats stay in chat; explicit desk views remain session-local',async()=>{
  const {startHarness,playwright,isolatedService}=await import('../tools/study-desk/harness.mjs');
  const service=await isolatedService();
  const harness=await startHarness({vendor:false,handler:service.handler}),browser=await playwright()[engine].launch(engine==='chromium'?{headless:true,channel:'chrome'}:{headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(harness.url);await page.locator('#pinkie-study-desk').waitFor({state:'attached'});
    assert.equal(await page.locator('html').getAttribute('data-pinkie-study-desk'),'chat');
    assert.ok(harness.calls.every(c=>/\.(?:desk\.today|ref\.receipts|state)$/.test(c.method)), 'Only the read-only tonight strip may load when opening a chat');
    await page.getByRole('textbox',{name:'聊天输入'}).fill('还没发出的内容');
    await page.getByRole('button',{name:'舞台',exact:true}).click({modifiers:['Alt']});
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'stage');
    await page.getByRole('button',{name:'开始练习',exact:true}).click();
    await page.locator('.q-text').waitFor();
    const question=await page.locator('.q-text').innerText();
    if (await page.locator('.opt').count()) await page.locator('.opt').first().click();
    else await page.locator('.blank-answer').fill('1');
    await page.getByRole('button',{name:'很确定',exact:true}).click();
    await page.locator('.confirm-answer').click();
    await page.waitForFunction(()=>/下一题|看看这一组/.test(document.querySelector('.confirm-answer')?.textContent || ''));
    const select=key=>page.evaluate(key=>{history.replaceState({},'', '/chat?session='+encodeURIComponent(key));dispatchEvent(new CustomEvent('pinkie:session-selected',{detail:{sessionKey:key}}));},key);
    for(let i=0;i<8;i++){
      await select('agent:learning:dashboard:new-'+i);
      assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'chat');
      assert.equal(await page.getByRole('textbox',{name:'聊天输入'}).isEnabled(),true);
    }
    await select('agent:learning:study-desk-qa');
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'chat','Returning to an existing chat never auto-opens its desk');
    await page.getByRole('button',{name:'舞台',exact:true}).click({modifiers:['Alt']});
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'stage','Manual desk entry remains available');
    assert.equal(await page.locator('.q-text').innerText(),question,'The original exercise survives the chat switch');
    assert.match(await page.locator('.confirm-answer').innerText(),/下一题|看看这一组/);
    await page.evaluate(()=>{dispatchEvent(new CustomEvent('pinkie:session-selected',{detail:{sessionKey:'agent:learning:stale'}}));});
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'stage','A stale event from another chat cannot close the current desk');
    await select('agent:learning:study-desk-qa');
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'chat');
    await select('agent:project:entry-fixture');
    assert.equal(await page.locator('#pinkie-study-desk').count(),0,'A stale learning-mode attribute cannot mount the desk for a project chat');
    await page.evaluate(()=>document.documentElement.dataset.laolaoMode='project');
    assert.equal(await page.locator('#pinkie-study-desk').count(),0);
    await page.evaluate(()=>document.documentElement.dataset.laolaoMode='learning');await select('agent:learning:dashboard:last-new');
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'chat');
    await page.getByRole('button',{name:'今日',exact:true}).click({modifiers:['Alt']});
    assert.equal(await page.locator('#pinkie-study-desk').getAttribute('data-view'),'today','Manual desk entry continues to work');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await harness.close();service.close();}
});
