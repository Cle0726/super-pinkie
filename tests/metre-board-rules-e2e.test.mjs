// G4：项目自己的规矩文件（project-brief.mjs 读给模型的 AGENTS.md / CLAUDE.md …）以前界面上看不到也改不了。
// 总控台「项目记忆」区多一行「项目规矩」：只列出文件夹里真有的那几个，点一下在工作台里打开。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const file = (name) => fileURLToPath(new URL('../ui/injections/' + name, import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'webkit';

async function openBoard(browser, statReply) {
  const tab = await browser.newPage({viewport: {width: 1440, height: 900}});
  await tab.route('http://127.0.0.1:30121/**', (route) => route.fulfill({contentType: 'text/html', body: `<!doctype html><html data-laolao-mode="metre"><body style="margin:0">
<div class="shell" style="display:flex;height:100vh"><aside class="sidebar shell-nav" style="width:260px;flex:none"></aside>
<main style="flex:1;display:flex;flex-direction:column"><div class="chat-thread" style="flex:1"></div><div class="agent-chat__input" style="height:90px"></div></main></div></body></html>`}));
  await tab.goto('http://127.0.0.1:30121/chat?session=agent:metre:x');
  for (const css of ['laolao-metre-board.css', 'laolao-metre-skin.css']) await tab.addStyleTag({path: file(css)});
  await tab.evaluate((statReply) => {
    const qa = window.qa = {opened: [], statCalls: []};
    window.__pinkieWorkbench = {open: async (path, options) => { qa.opened.push({path, options}); }};
    window.__laolaoSidebar = {gwRequest: async (method, params) => {
      if (method === 'pinkie.fs.stat') {
        qa.statCalls.push(params);
        if (statReply === 'fail') throw new Error('unknown method');
        return {stats: params.paths.map((p) => statReply.includes(p) ? {path: p, exists: true, kind: 'file'} : {path: p, exists: false})};
      }
      if (method === 'pinkie.metre.memory') return params.action === 'stats' ? {ok: true, folder: '/p/demo', name: 'demo', count: 0, known: 0, byCategory: {}} : {ok: true, items: []};
      return {ok: true, at: Date.now(), overview: {}, plan: {items: []}, sessions: [], pending: [], changes: [], runtime: {}, raw: [], timeline: []};
    }};
  }, statReply);
  for (const js of ['laolao-metre-board.js', 'laolao-metre-board-data.js']) await tab.addScriptTag({path: file(js)});
  await tab.evaluate(() => window.__pinkieMetreBoard.open());
  await tab.waitForFunction(() => document.querySelector('.pk-mb-memory__folder small'));
  return tab;
}

test(`项目规矩：只列出存在的规则文件，点开在工作台里（${engine}）`, {timeout: 30_000}, async () => {
  const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  try {
    const tab = await openBoard(browser, ['CLAUDE.md', '.cursorrules']);
    const call = await tab.evaluate(() => window.qa.statCalls[0]);
    assert.equal(call?.sessionKey, 'agent:metre:x', '按当前会话的项目文件夹查');
    assert.deepEqual(call.paths, ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.cursorrules', 'GEMINI.md'], '和 project-brief.mjs 读给模型的是同一组');
    const names = await tab.evaluate(() => [...document.querySelectorAll('#pk-metre-board .pk-mb-rules button')].map((b) => b.textContent));
    assert.deepEqual(names, ['CLAUDE.md', '.cursorrules'], '只列真有的');
    await tab.click('#pk-metre-board .pk-mb-rules button >> text=CLAUDE.md');
    assert.deepEqual(await tab.evaluate(() => window.qa.opened), [{path: 'CLAUDE.md', options: {pinned: true}}], '点一下在工作台里打开来改');
    await tab.close();

    const none = await openBoard(browser, []);
    assert.match(await none.evaluate(() => document.querySelector('#pk-metre-board .pk-mb-rules')?.textContent || ''), /还没有规则文件/, '一个都没有时说清楚');
    await none.close();

    // 旧网关没有 fs.stat：这一行不画，项目记忆照常显示
    const old = await openBoard(browser, 'fail');
    assert.equal(await old.evaluate(() => document.querySelector('#pk-metre-board .pk-mb-rules')), null);
    assert.equal(await old.evaluate(() => document.querySelector('.pk-mb-memory__folder small').textContent), '0 条 · 了解 0 / 9 类');
  } finally { await browser.close(); }
});
