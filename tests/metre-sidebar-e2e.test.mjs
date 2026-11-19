import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const script = fileURLToPath(new URL('../ui/injections/laolao-session-list.js', import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';

test(`Metre dispatch appears during refresh, without its parent in the sidebar (${engine})`, {timeout: 30_000}, async () => {
  const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30113/**', route => route.fulfill({contentType: 'text/html', body: '<section id="sidebar"></section>'}));
    await tab.goto('http://127.0.0.1:30113/');
    await tab.addScriptTag({path: script});
    const parent = 'agent:metre:outside-the-list', child = 'agent:project:pinkie-child:one';
    const other = 'agent:thinking:pinkie-child:two';
    await tab.evaluate(({parent, child}) => {
      localStorage.setItem('pinkie:session-sidebar:fold:' + parent, '1');
      const qa = window.qa = {away: {}, selected: '', hold: false, release: null};
      qa.api = {mode: 'metre', agentId: 'metre', currentKey: 'agent:metre:current', state: {
        pins: [], collapsed: {__recent: true}, projects: {}, projectFolders: {},
      }, gwRequest: async (method, params) => {
        if (method === 'sessions.list') return {sessions: params.agentId === 'project' ? [{key: child, label: '正在整理提纲'}] : []};
        if (method === 'pinkie.session.lineage') {
          const snapshot = {away: qa.away, children: params.agentId === 'project' ? {[child]: {parentKey: parent, cross: true, detached: true, title: '正在整理提纲'}} : {}};
          if (qa.hold) { qa.hold = false; await new Promise(resolve => { qa.release = resolve; }); }
          return snapshot;
        }
        if (method === 'pinkie.session.search') return {results: []};
        return {rows: {}};
      }, toast(message) { throw Error(message); }};
      qa.render = () => window.PinkieSessionList.render(document.querySelector('#sidebar'), qa.api);
      qa.changed = () => dispatchEvent(new Event('laolao:sessions-changed'));
      window.addEventListener('pinkie:open-session-in-mode', e => { qa.selected = e.detail.sessionKey; });
      qa.hold = true;
      qa.render();
    }, {parent, child});
    // Complete an in-flight stale read after dispatch notifies the sidebar.
    await tab.waitForFunction(() => window.qa.release);
    await tab.evaluate(({parent, child, other}) => {
      window.qa.away = {[child]: {parentKey: parent, title: '正在整理提纲', mode: 'project', hasActiveRun: true}};
      window.qa.changed();
      window.qa.away = {...window.qa.away, [other]: {parentKey: parent, title: '起草标题方案', mode: 'ideas'}};
      window.qa.changed();
    }, {parent, child, other});
    await tab.waitForTimeout(300);
    await tab.evaluate(() => window.qa.release());
    const sideRow = tab.locator(`[data-laolao-group="__metre-dispatched"] [data-session-key="${child}"]`);
    await sideRow.getByRole('link', {name: '正在整理提纲'}).waitFor();
    assert.equal(await tab.locator(`[data-session-key="${child}"]`).count(), 1);
    assert.equal(await tab.locator(`[data-session-key="${other}"]`).getByRole('link', {name: '起草标题方案'}).count(), 1);
    assert.equal(await sideRow.getByRole('img', {name: '运行中'}).count(), 1);
    assert.equal(await sideRow.getByRole('link').getAttribute('href'), '/chat?session=' + encodeURIComponent(child));
    await sideRow.getByRole('link').click();
    assert.equal(await tab.evaluate(() => window.qa.selected), child);
    await tab.evaluate(() => { window.qa.selected = ''; });
    await tab.getByRole('button', {name: '搜索当前模式的会话', exact: true}).click();
    await tab.getByRole('searchbox').fill('整理提纲');
    await tab.getByRole('option', {name: '打开会话：正在整理提纲'}).click();
    assert.equal(await tab.evaluate(() => window.qa.selected), child);
    await tab.evaluate(() => {
      window.qa.away = {};
      window.qa.changed();
    });
    await sideRow.waitFor({state: 'detached'});
    await tab.evaluate(() => {
      Object.assign(window.qa.api, {mode: 'project', agentId: 'project'});
      window.qa.api.state.collapsed = {};
      window.qa.render();
    });
    await tab.locator(`[data-laolao-group="__recent"] [data-session-key="${child}"]`).getByRole('link', {name: '正在整理提纲'}).waitFor();
    assert.equal(await tab.locator('[data-laolao-group="__metre-dispatched"]').count(), 0);
  } finally { await browser.close(); }
});
