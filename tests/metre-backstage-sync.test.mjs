import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

// 11-24 验收打回第 3 条：后台带写「网关 连着」，同一时刻总谱顶上却是「连接断了，正在重连」。两边要读同一份连接状态，
// 连接恢复后总谱的断线条和「此刻」必须一起恢复。流程：先断线，再恢复，再打开总谱；以及总谱开着时断线、恢复。
const file = (name) => fileURLToPath(new URL('../ui/injections/' + name, import.meta.url));
const read = (name) => fs.readFileSync(file(name), 'utf8');

test('the backstage band and the score read one connection state, so neither says the gateway is down after it came back', {timeout: 60_000}, async (t) => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const tab = await browser.newPage({viewport: {width: 1024, height: 720}});
    const body = `<!doctype html><html data-laolao-mode="metre"><head><style>${read('laolao-metre-board.css')}\n${read('laolao-metre-keys.css')}</style></head>
      <body><main class="content" style="position:fixed;inset:0"></main><section class="agent-chat__input" style="position:fixed;left:100px;top:560px;width:780px;height:92px"></section></body></html>`;
    await tab.route('http://127.0.0.1:30118/**', (route) => route.fulfill({contentType: 'text/html', body}));
    await tab.goto('http://127.0.0.1:30118/chat?session=agent%3Ametre%3Atest');
    await tab.evaluate(() => {
      window.CONN = {online: true, attempt: 0};
      window.calls = [];
      window.__pinkieRunStatus = {get state() { return {key: 'agent:metre:test', status: {active: false}, conn: {...window.CONN}}; }, refresh: async () => null};
      window.__laolaoSidebar = {gwRequest: async (method) => {
        window.calls.push(method);
        if (!window.CONN.online) throw new Error('offline');
        if (method === 'pinkie.metre.board') return {overview: {state: 'Metre 空闲', running: 0, limit: 4, started: 0, cap: 8, returned: 0, failed: 0}, sessions: [], pending: [], timeline: [], changes: [], runtime: {}, raw: []};
        if (method === 'pinkie.engines.status') return {enabled: false};
        return {};
      }};
    });
    for (const name of ['laolao-metre-board.js', 'laolao-metre-board-data.js', 'laolao-metre-backstage.js']) await tab.addScriptTag({content: read(name)});
    const tick = () => tab.evaluate(() => window.dispatchEvent(new CustomEvent('pinkie:run-view', {detail: {}})));
    const band = () => tab.evaluate(() => document.querySelector('.pk-metre-backstage:not(.pk-metre-backstage--probe)')?.innerText.replace(/\s+/g, ' ') || '');
    const score = () => tab.evaluate(() => ({notice: document.querySelector('#pk-metre-board .pk-metre-board__notice')?.textContent || '', text: document.getElementById('pk-metre-board')?.innerText || '', stale: window.__pinkieMetreBoardData.stale}));
    await tick();
    assert.match(await band(), /网关 连着/);
    // 1. 先断线，再恢复，再打开总谱
    await tab.evaluate(() => { window.CONN.online = false; window.dispatchEvent(new Event('pinkie:sidebar-gateway-lost')); });
    await tick();
    assert.match(await band(), /网关 断了/, 'the band follows the gateway store');
    await tab.evaluate(() => { window.CONN.online = true; window.dispatchEvent(new Event('pinkie:sidebar-gateway-ready')); });
    await tick();
    await tab.evaluate(() => window.__pinkieMetreBoard.open());
    await tab.waitForFunction(() => window.calls.includes('pinkie.metre.board') && /Metre 空闲/.test(document.getElementById('pk-metre-board')?.innerText || ''), null, {timeout: 5000});
    let s = await score();
    assert.equal(s.stale, false);
    assert.equal(s.notice, '', 'no 断线 strip once the gateway is back');
    assert.doesNotMatch(s.text, /连接断了/);
    assert.match(await band(), /网关 连着/);
    // 2. 总谱开着时断线：两边一起说断了；恢复：断线条和「此刻」一起恢复
    await tab.evaluate(() => { window.CONN.online = false; window.dispatchEvent(new Event('pinkie:sidebar-gateway-lost')); });
    await tick();
    s = await score();
    assert.match(s.notice, /连接断了/); assert.match(await band(), /网关 断了/);
    await tab.evaluate(() => { window.CONN.online = true; });
    await tick();
    await tab.waitForFunction(() => !document.querySelector('#pk-metre-board .pk-metre-board__notice') && /Metre 空闲/.test(document.getElementById('pk-metre-board')?.innerText || ''), null, {timeout: 5000});
    assert.match(await band(), /网关 连着/);
    // 3. 连着、但这次总谱没读到：说「没读到」，不说「连接断了」
    await tab.evaluate(() => { const real = window.__laolaoSidebar.gwRequest; window.__laolaoSidebar.gwRequest = async (m, ...rest) => (m === 'pinkie.metre.board' ? Promise.reject(new Error('bad')) : real(m, ...rest)); window.__pinkieMetreBoardData.refresh(); });
    await tab.waitForFunction(() => /没读到/.test(document.querySelector('#pk-metre-board .pk-metre-board__notice')?.textContent || ''), null, {timeout: 5000});
    assert.doesNotMatch((await score()).text, /连接断了/);
  } finally { await browser.close(); }
});
