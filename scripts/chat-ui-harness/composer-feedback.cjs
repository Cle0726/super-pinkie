// Run against server.py with the native UI assets, with no model/production App.
// NODE_PATH=<Playwright deps> node scripts/chat-ui-harness/composer-feedback.cjs <harness URL> [output directory]
const assert = require('node:assert/strict');
const {mkdir, writeFile} = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:18811/chat';
const out = process.argv[3];
const engine = process.env.COMPOSER_TEST_BROWSER === 'webkit' ? webkit : chromium;
const scenarios = [
  {width:1080, height:770, night:true, mode:'unrestricted'},
  {width:645, height:760, night:false, mode:'main'},
  {width:390, height:770, night:true, mode:'unrestricted'},
  {width:1080, height:770, night:false, mode:'project'},
];
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout:14000});
const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

async function geometry(page, include) {
  const bounds = await page.evaluate((include) => {
    const take = (selector) => {
      const node = document.querySelector(selector);
      if (!node || node.hidden || getComputedStyle(node).visibility === 'hidden') return null;
      const {left,right,top,bottom,width,height} = node.getBoundingClientRect();
      return width && height ? {left,right,top,bottom} : null;
    };
    return {
      composer:take('.agent-chat__input'),
      queue:take('.chat-queue'),
      newMessages:take('.chat-new-messages'),
      run:take('.pk-run'),
      work:take('.pinkie-work__pill'),
      ...(include === 'details' ? {details:take('.pinkie-work__card')} : {}),
      ...(include === 'dot' ? {dotPopover:take('.pk-run__body')} : {}),
    };
  }, include);
  const rows = Object.entries(bounds);
  for (const [name, rect] of rows) assert.ok(rect, `${name} missing: ${JSON.stringify(bounds)}`);
  for (let i=0;i<rows.length;i++) for (let j=i+1;j<rows.length;j++) {
    const [one, a] = rows[i], [two, b] = rows[j];
    assert.ok(!overlaps(a,b), `${one} covers ${two}: ${JSON.stringify(bounds)}`);
  }
  return bounds;
}

async function run(browser, scene) {
  const {width, height, night, mode} = scene;
  const page = await browser.newPage({viewport:{width,height}, reducedMotion:'reduce', serviceWorkers:'block'});
  const name = `${mode}-${width}-${night ? 'dark' : 'light'}`;
  const errors = [];
  page.on('pageerror', e => { if (!/ServiceWorker/.test(String(e))) errors.push(String(e)); });
  const url = new URL(base);
  url.searchParams.set('session', `agent:${mode}:dashboard:composer-feedback`);
  url.searchParams.set('harnessSession', 'active');
  await page.addInitScript(key => localStorage.setItem('laolao:deep-think-tier:'+key,'marathon'), url.searchParams.get('session'));
  try {
    await page.goto(url.href, {waitUntil:'domcontentloaded'});
    await wait(page, () => window.__fake && window.__pinkieComposerDock
      && document.querySelector('openclaw-chat-pane')?.state?.connected === true);
    const input = page.locator('.agent-chat__composer-combobox textarea');
    await input.waitFor({state:'visible'});
    await page.evaluate(({night}) => {
      window.__laolaoStartupHome?.leave();
      document.documentElement.toggleAttribute('data-pinkie-night', night);
      __fake.auto('steer-accepted', {holdMs:60000, gap:80, once:true, reply:'固定验证回复'});
    }, {night});
    await input.fill('先完成回归测试的第一步');
    // Start a native run without coupling the check to the separate new-task
    // tier-arming flow; the follow-up itself uses the actual Enter/button.
    await page.evaluate(() => { void document.querySelector('openclaw-chat-pane').state.handleSendChat(); });
    await wait(page, () => Boolean(document.querySelector('openclaw-chat-pane').state.chatRunId));
    await wait(page, () => document.querySelector('.laolao-deep-think-btn')?.title.includes('长跑档'));
    const originalRun = await page.evaluate(() => document.querySelector('openclaw-chat-pane').state.chatRunId);
    await page.evaluate(async runId => {
      const now = Date.now();
      window.__fakeWorkStatus = {sessionKey: __fake.SK, tier:{active:true, tier:'marathon',
        children:[{id:'checker', state:'running', roleLabel:'核对任务', startedAt:now-3000}]},
        reasoning:{phase:'answering', level:'ultra'}};
      window.__fakeRunStatus = {active:true,phase:'running',review:{phase:'idle'}};
      window.__fakePlan = {title:'回归',items:[{id:'one',text:'准备工作区和工具（初始化、工具自检、输出路径验证）',status:'in_progress'},
        {id:'two',text:'检查交付',status:'pending'}]};
      window.dispatchEvent(new CustomEvent('pinkie:gateway-event', {detail:{event:'agent', payload:{
        runId, sessionKey:__fake.SK, stream:'tool', data:{phase:'start', name:'exec', toolCallId:'layout-replay-existing-tool'}
      }}}));
      await window.__pinkieRunStatus.refresh();
    },originalRun);
    // Use the real composer; in the old unrestricted UI the row acquired an
    // ID immediately, but no chat.send for the follow-up reached the gateway.
    await input.fill('默认立即追加的消息');
    await input.press('Enter');
    await wait(page, () => __fake.checks.deliveries('默认立即追加的消息').length === 1);
    await wait(page, () => __fake.checks.queue().length === 0);
    const automatic = await page.evaluate(() => __fake.checks.deliveries('默认立即追加的消息'));
    assert.equal(automatic[0].kind,'steer');
    assert.equal(automatic[0].runId,originalRun);
    assert.equal(await page.evaluate(() => __fake.log.filter(v => v.method==='pinkie.deepThink.arm').length),0,
      'a follow-up must not arm a new tier on the old run');

    await page.evaluate(() => {
      const pane = document.querySelector('openclaw-chat-pane');
      window.__laolaoQueueSteer.setFollowUpMode(pane,'queue');
    });
    await input.fill('先排队再点立即追加');
    await input.press('Enter');
    await page.locator('.chat-queue__steer').waitFor({state:'visible'});
    await page.evaluate(() => {
      // Force the real Lit-controlled, in-flow button to be visible without
      // racing scroll physics. Do not create our own DOM copy of it.
      const pane = document.querySelector('openclaw-chat-pane');
      // Resizing the composer can clear this indicator on a short seed
      // transcript. Pin only its test input, not the button's DOM or style.
      Object.defineProperty(pane.state, 'chatNewMessagesBelow', {
        configurable:true, get:()=>true, set:()=>{},
      });
      pane.requestUpdate();
    });
    await wait(page, () => document.querySelector('.pinkie-work__pill') && document.querySelector('.pk-run.is-shown')
      && document.querySelector('.agent-chat__composer-shell[data-pinkie-composer-dock]'));
    await page.locator('.chat-new-messages').waitFor({state:'visible'});
    await page.waitForTimeout(100);
    const collapsed = await geometry(page);
    if (out) await page.screenshot({path:path.join(out,`${name}.png`)});
    await page.locator('.pinkie-work__pill').click();
    await page.locator('.pinkie-work__card').waitFor({state:'visible'});
    await page.waitForTimeout(120);
    const expanded = await geometry(page, 'details');
    await page.locator('.pinkie-work__pill').click();
    if (await page.locator('.pk-run__dot').isVisible()) {
      await page.locator('.pk-run__dot').click();
      await page.waitForTimeout(120);
      await geometry(page, 'dot');
      await page.locator('.pk-run__dot').click();
    }

    assert.equal(await page.evaluate(() => __fake.checks.deliveries('先排队再点立即追加').length),0);
    await page.locator('.chat-queue__steer').click();
    await wait(page, () => __fake.checks.deliveries('先排队再点立即追加').length === 1);
    await wait(page, () => __fake.checks.queue().length === 0);
    const manual = await page.evaluate(() => __fake.checks.deliveries('先排队再点立即追加'));
    assert.equal(manual[0].kind,'steer');
    assert.equal(manual[0].runId,originalRun);
    assert.deepEqual(errors,[]);
    return {name, automatic:automatic[0], manual:manual[0], collapsed, expanded};
  } catch (error) {
    if (out) {
      const diagnostic = await page.evaluate(() => ({
        mode:document.documentElement.dataset.laolaoMode, key:__fake.SK, latest:window.__pinkieWorkLatest,
        dock:window.__pinkieComposerDock?true:false,
        workPanel:document.querySelector('#pinkie-work-panel')?.hidden,
        runClass:document.querySelector('.pk-run')?.className,
        active:__fake.state.activeRuns.size,
        requests:__fake.tail(100).filter(v=>/work.status|run.status|plan.get|chat.send/.test(v.method || '')).slice(-20),
      })).catch(() => ({}));
      await writeFile(path.join(out,`${name}-error.json`), JSON.stringify({diagnostic, errors},null,2));
    }
    throw error;
  } finally {
    if (out) await page.screenshot({path:path.join(out,`${name}-end.png`)}).catch(() => {});
    await page.close();
  }
}

(async () => {
  if (out) await mkdir(out, {recursive:true});
  const browser = await engine.launch();
  try {
    const results = [];
    for (const scene of scenarios) {
      results.push(await run(browser, scene));
      console.log('PASS', results.at(-1).name);
    }
    if (out) await writeFile(path.join(out,'receipt.json'), JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
