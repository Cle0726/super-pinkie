import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';
import {waitFirstFrame} from './helpers/browser-first-frame.mjs';

const script = fileURLToPath(new URL('../ui/injections/laolao-session-list.js', import.meta.url));
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';

// One browser for the file, started outside every test's 30 s budget. On a
// cold Windows runner the first Chrome launch alone took ~28 s (run
// 45557123820: the first test of each of the three browser files that start
// together took 29.96 / 29.99 / 30.0 s, while the later tests here took
// ~1.1 s each), so launching inside the test timed Chrome's start-up, not the
// sidebar. browser.newPage() still gives every test its own fresh context
// (own localStorage), so the tests stay independent.
let browser;
before(async () => {
  browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  await waitFirstFrame(browser, `metre-sidebar-e2e (${engine})`);
}, {timeout: 120_000});
after(async () => { await browser?.close(); });

test(`Metre dispatch appears during refresh, without its parent in the sidebar (${engine})`, {timeout: 30_000}, async () => {
  const tab = await browser.newPage();
  try {
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
    await tab.waitForTimeout(300);   // 保留：故意让两次 changed 通知先处理、再放行旧读，测的是先后顺序
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
  } finally { await tab.close(); }
});

test(`Metre dispatched sessions can be folded, archived and deleted from the sidebar (${engine})`, {timeout: 30_000}, async () => {
  const tab = await browser.newPage();
  try {
    await tab.route('http://127.0.0.1:30113/**', route => route.fulfill({contentType: 'text/html', body: '<section id="sidebar"></section>'}));
    await tab.goto('http://127.0.0.1:30113/');
    await tab.addScriptTag({path: script});
    const done = 'agent:project:pinkie-child:done', live = 'agent:learning:pinkie-child:live';
    await tab.evaluate(({done, live}) => {
      const qa = window.qa = {calls: []};
      qa.api = {mode: 'metre', agentId: 'metre', currentKey: 'agent:metre:current', state: {
        pins: [], collapsed: {__recent: true}, projects: {}, projectFolders: {},
      }, gwRequest: async method => {
        if (method === 'sessions.list') return {sessions: []};
        if (method === 'pinkie.session.lineage') return {away: {
          [done]: {parentKey: 'agent:metre:p', title: '对比度修复', mode: 'project', updatedAt: 2},
          [live]: {parentKey: 'agent:metre:p', title: '整理讲解稿', mode: 'learning', updatedAt: 1, hasActiveRun: true},
        }, children: {}};
        if (method === 'pinkie.session.search') return {results: []};
        return {rows: {}};
      }, toast(message) { throw Error(message); },
      toggleGroup: id => { qa.api.state.collapsed[id] = !qa.api.state.collapsed[id]; qa.render(); },
      dispatchedMenu: (anchor, key, title, opts) => qa.calls.push(['row', key, title, opts.live]),
      dispatchedGroupMenu: (anchor, opts) => qa.calls.push(['group', opts.idle, opts.total])};
      qa.render = () => window.PinkieSessionList.render(document.querySelector('#sidebar'), qa.api);
      qa.render();
    }, {done, live});
    const group = tab.locator('[data-laolao-group="__metre-dispatched"]');
    await group.locator(`[data-session-key="${done}"]`).waitFor();
    await group.getByRole('button', {name: '管理派发的会话：对比度修复'}).click();
    await group.getByRole('button', {name: '管理派发的会话：整理讲解稿'}).click();
    await group.getByRole('button', {name: '管理派发的会话', exact: true}).click();
    assert.deepEqual(await tab.evaluate(() => window.qa.calls), [
      ['row', done, '对比度修复', false], ['row', live, '整理讲解稿', true], ['group', [done], 2]]);
    // Folding hides finished dispatches but keeps running ones visible.
    await group.getByRole('button', {name: '收起派发的会话'}).click();
    await group.locator(`[data-session-key="${done}"]`).waitFor({state: 'detached'});
    assert.equal(await group.locator(`[data-session-key="${live}"]`).count(), 1);
    await group.getByRole('button', {name: '展开派发的会话'}).click();
    await group.locator(`[data-session-key="${done}"]`).waitFor();
  } finally { await tab.close(); }
});

test(`Metre dispatched sessions sit under their parent session; only a lost parent leaves them on their own (${engine})`, {timeout: 30_000}, async () => {
  const tab = await browser.newPage();
  try {
    await tab.route('http://127.0.0.1:30113/**', route => route.fulfill({contentType: 'text/html', body: '<section id="sidebar"></section>'}));
    await tab.goto('http://127.0.0.1:30113/');
    await tab.addScriptTag({path: script});
    const parent = 'agent:metre:parent', done = 'agent:project:pinkie-child:done', live = 'agent:learning:pinkie-child:live';
    const lost = 'agent:ideas:pinkie-child:lost';
    await tab.evaluate(({parent, done, live, lost}) => {
      const qa = window.qa = {calls: [], opened: ''};
      qa.api = {mode: 'metre', agentId: 'metre', currentKey: 'agent:metre:current', state: {
        pins: [], collapsed: {}, projects: {}, projectFolders: {},
      }, gwRequest: async (method, params) => {
        if (method === 'sessions.list') return {sessions: params.agentId === 'metre'
          ? [{key: parent, label: '收尾检查', lastMessagePreview: '好的', updatedAt: 10}] : []};
        if (method === 'pinkie.session.lineage') return {away: {
          [done]: {parentKey: parent, title: '对比度修复', mode: 'project', updatedAt: 2},
          [live]: {parentKey: parent, title: '整理讲解稿', mode: 'learning', updatedAt: 1, hasActiveRun: true},
          [lost]: {parentKey: 'agent:metre:gone', title: '起草标题', mode: 'ideas', updatedAt: 3},
        }, children: {}};
        if (method === 'pinkie.session.search') return {results: []};
        return {rows: {}};
      }, toast(message) { throw Error(message); },
      toggleGroup: id => { qa.api.state.collapsed[id] = !qa.api.state.collapsed[id]; qa.render(); },
      dispatchedMenu: (anchor, key, title) => qa.calls.push(['row', key, title])};
      qa.render = () => window.PinkieSessionList.render(document.querySelector('#sidebar'), qa.api);
      window.addEventListener('pinkie:open-session-in-mode', e => { qa.opened = e.detail.sessionKey; });
      qa.render();
    }, {parent, done, live, lost});
    const under = key => tab.locator(`[data-laolao-group="__recent"] [data-session-key="${parent}"] + .pinkie-session-branch [data-session-key="${key}"]`);
    await under(done).waitFor();
    assert.equal(await under(live).count(), 1);
    // The parent row says how many sit under it, and the part rows are the same rows as anywhere else.
    assert.equal(await tab.locator(`[data-session-key="${parent}"] .pinkie-session-fold__count`).textContent(), '2');
    assert.equal(await under(live).getByRole('img', {name: '运行中'}).count(), 1);
    assert.equal(await under(done).getByRole('link').getAttribute('href'), '/chat?session=' + encodeURIComponent(done));
    await under(done).getByRole('link').click();
    assert.equal(await tab.evaluate(() => window.qa.opened), done);
    await under(done).getByRole('button', {name: '管理派发的会话：对比度修复'}).click();
    assert.deepEqual(await tab.evaluate(() => window.qa.calls), [['row', done, '对比度修复']]);
    // Only the dispatch whose parent is gone is listed on its own, and not twice.
    const lonely = tab.locator(`[data-laolao-group="__metre-dispatched"] [data-session-key="${lost}"]`);
    assert.equal(await lonely.count(), 1);
    assert.equal(await tab.locator(`[data-laolao-group="__metre-dispatched"] [data-session-key="${done}"]`).count(), 0);
    assert.equal(await tab.locator(`[data-session-key="${done}"]`).count(), 1);
    assert.equal(await tab.locator('[data-laolao-group="__metre-dispatched"] .laolao-group__count').textContent(), '1');
    // Folding the parent hides the finished child and keeps the running one.
    await tab.getByRole('button', {name: '收起收尾检查的子会话'}).click();
    await under(done).waitFor({state: 'detached'});
    assert.equal(await under(live).count(), 1);
    await tab.getByRole('button', {name: '展开收尾检查的子会话'}).click();
    await under(done).waitFor();
  } finally { await tab.close(); }
});
