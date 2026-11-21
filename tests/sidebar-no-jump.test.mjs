import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

// 11-21 user: the sidebar jumps while 碧琪/Metre replies, on entering a mode, on clicking a session
// and on a new session. Measured on the real app: every list redraw dropped Metre's 「总谱」 entry
// (another script re-adds it ~0.1-0.3s later), so the whole list jumped 36px up and back; and
// leaving the start page briefly listed its empty draft as 「新会话」 at the top.
const script = fileURLToPath(new URL('../ui/injections/laolao-session-list.js', import.meta.url));

test('a redraw keeps 总谱 and a left-behind start-page draft stays out of the list', {timeout: 30_000}, async () => {
  const browser = await playwright().chromium.launch({headless: true, channel: 'chrome'});
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30114/**', route => route.fulfill({contentType: 'text/html', body: '<aside class="sidebar"><section id="sidebar"></section></aside>'}));
    await tab.goto('http://127.0.0.1:30114/');
    await tab.addScriptTag({path: script});
    const draft = 'agent:metre:dashboard:draft', a = 'agent:metre:dashboard:a', b = 'agent:metre:dashboard:b';
    await tab.evaluate(({draft, a, b}) => {
      document.documentElement.setAttribute('data-laolao-startup-home', '1');
      window.__laolaoStartupHome = {status: () => ({draft: {key: draft}})};
      const now = Date.now();
      const qa = window.qa = {api: {mode: 'metre', agentId: 'metre', currentKey: draft,
        state: {pins: [], collapsed: {}, projects: {}, projectFolders: {}},
        gwRequest: async method => method === 'sessions.list' ? {sessions: [
          {key: draft, label: '新会话', updatedAt: now},
          {key: a, label: '电脑所有的AI', lastMessagePreview: '好', updatedAt: now - 1000},
          {key: b, label: '查看所有补丁是否生效', lastMessagePreview: '好', updatedAt: now - 2000},
        ]} : method === 'pinkie.session.lineage' ? {children: {}, states: {}} : {rows: {}},
        toast(message) { throw Error(message); }}};
      qa.render = () => window.PinkieSessionList.render(document.querySelector('#sidebar'), qa.api);
      qa.render();
    }, {draft, a, b});
    await tab.locator(`[data-session-key="${a}"]`).waitFor();
    // Metre's board script adds its entry to the shortcut strip, as laolao-metre-board.js does.
    const board = await tab.evaluate(() => {
      const btn = document.createElement('button'); btn.className = 'pinkie-sidebar-entry pk-metre-nav pk-metre-nav--board'; btn.textContent = '总谱';
      document.querySelector('.laolao-session-controls').append(btn); window.qa.board = btn; return true;
    });
    assert.ok(board);
    assert.equal(await tab.locator(`[data-session-key="${draft}"]`).count(), 0, 'the start-page draft is not listed');
    // Click another session: the start page closes first, the address follows a moment later.
    await tab.evaluate(() => { document.documentElement.removeAttribute('data-laolao-startup-home'); window.qa.render(); });
    assert.equal(await tab.evaluate(() => window.qa.board.isConnected && document.querySelectorAll('.pk-metre-nav--board').length), 1, '总谱 survives the redraw');
    assert.equal(await tab.locator(`[data-session-key="${draft}"]`).count(), 0, 'no 新会话 flash while the address still names the draft');
    await tab.evaluate(b => { window.qa.api.currentKey = b; window.qa.render(); }, b);
    assert.equal(await tab.evaluate(() => window.qa.board.isConnected), true);
    // Outside Metre the entry is not carried over.
    await tab.evaluate(() => { window.qa.api.mode = 'chat'; window.qa.api.agentId = 'main'; window.qa.render(); });
    assert.equal(await tab.locator('.pk-metre-nav--board').count(), 0);
  } finally { await browser.close(); }
});
