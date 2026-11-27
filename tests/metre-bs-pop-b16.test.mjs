// .pk-bs__pop（协调者 23:55 定：开小 PR）：Metre「后台」带子上点「引擎」开着声部弹层时，窗口缩到 < 840 或 Alt+Ctrl+B
// 直接进窄窗代码页（都不经点击，pointerdown 收起不会触发），B16 规则（laolao-metre-keys.css）把带子 display: none，
// 但弹层还挂在 body 上：先停在原来带子上方压住编辑器最后几行，带子下一次重画后量到 0，跑到屏幕外 y -109，
// 一直留着一个开着的 role="dialog"（读屏能读到）。
// 修法在 laolao-metre-backstage.js fillPop()：「引擎」那格没有布局框（被样式藏起）就收起弹层。
// 真浏览器加载真 laolao-metre-keys.css + laolao-metre-backstage.js，页面搭法照 tests/metre-chat-narrow-b28.test.mjs。
// 对照：窄窗「对话」页带子在，弹层照常开着；反例：去掉这次的判断，弹层又留在页面里。
import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (name) => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const CSS = read('laolao-metre-keys.css');
const SRC = read('laolao-metre-backstage.js');
const FIX = '!seg.getClientRects().length || ';

let shared = null;
async function sharedBrowser(t) {
  shared ??= (async () => {
    let lib;
    try { lib = playwright(); } catch { return {skip: 'Playwright is not installed here'}; }
    const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
    try { return {browser: await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})})}; }
    catch (error) { return {skip: 'no browser: ' + error.message.split('\n')[0]}; }
  })();
  const got = await shared;
  if (got.skip) { t.skip(got.skip); return null; }
  return got.browser;
}
after(async () => { const got = await shared; if (got?.browser) await got.browser.close(); });

// 1440 宽开好弹层，再不经点击切到 820 窄窗的某一页，让带子重画一次，返回弹层还在不在
async function run(browser, src, view) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  try {
    const tab = await context.newPage();
    const body = `<!doctype html><html data-laolao-mode="metre"><head><meta charset="utf-8"><style>${CSS}</style></head>
      <body style="margin:0"><main class="content" style="position:fixed;inset:0"></main><section class="agent-chat__input" style="position:fixed;left:1076px;top:760px;width:340px;height:92px"></section></body></html>`;
    await tab.route('http://127.0.0.1:30131/**', (route) => route.fulfill({contentType: 'text/html; charset=utf-8', body}));
    await tab.goto('http://127.0.0.1:30131/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      const pane = document.createElement('openclaw-chat-pane'); pane.state = {chatRunId: null, chatSending: false, chatStream: null, chatQueue: [], sessionKey: 'agent:metre:test'}; document.body.append(pane);
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: false}, conn: {online: true, attempt: 0}, live: {active: false}}; }, refresh: async () => null};
      window.__laolaoSidebar = {gwRequest: async (method) => (method === 'pinkie.engines.status' ? {enabled: true, running: true} : {})};
      window.__pinkieMetreBoardData = {data: {sessions: [{key: 'e1', external: true, engineName: 'Codex', state: 'fail'}, {key: 'e2', external: true, engineName: 'Kiro', state: 'wait'}]}};
    });
    await tab.addScriptTag({content: src});
    const redraw = () => tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    await redraw();
    await tab.locator('.pk-bs__seg--pop').click();
    const opened = await tab.locator('.pk-bs__pop[role="dialog"]').count();
    await tab.setViewportSize({width: 820, height: 900});
    await tab.evaluate((view) => {
      Object.assign(document.querySelector('.agent-chat__input').style, {left: '24px', width: '772px'});
      document.documentElement.dataset.pkWbNarrow = '1'; document.documentElement.dataset.pkWbView = view;
    }, view);
    await redraw();
    await tab.waitForTimeout(50);
    const after = await tab.evaluate(() => {
      const band = document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)');
      return {pops: document.querySelectorAll('.pk-bs__pop').length, band: getComputedStyle(band).display !== 'none'};
    });
    return {opened, ...after};
  } finally { await context.close(); }
}

test('.pk-bs__pop: the engine popover closes when the B16 rule hides the band on the narrow code page, and stays open on the narrow chat page', {timeout: 90_000}, async (t) => {
  assert.equal(SRC.split(FIX).length, 2, '找不到 fillPop() 里这次加的判断');
  const browser = await sharedBrowser(t); if (!browser) return;
  const code = await run(browser, SRC, 'code');
  assert.equal(code.opened, 1, '前提：1440 点「引擎」开出弹层');
  assert.equal(code.band, false, '前提：窄窗代码页带子被 B16 藏起');
  assert.equal(code.pops, 0, '窄窗代码页：带子藏了，弹层跟着收起，不留开着的 dialog');
  const chat = await run(browser, SRC, 'chat');
  assert.equal(chat.band, true, '对照：窄窗对话页带子照常显示');
  assert.equal(chat.pops, 1, '对照：带子还在时弹层不被误关');
  // 反例：去掉这次的判断（修之前的样子），代码页上弹层还留在页面里
  const before = await run(browser, SRC.replace(FIX, ''), 'code');
  assert.equal(before.pops, 1, '反例没生效：去掉判断后弹层应留在页面里');
});
