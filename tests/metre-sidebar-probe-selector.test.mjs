import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

// The packaged Windows smoke (tools/windows-smoke/upstream_probe.py) looks for the dispatched
// child with its own selector. a0ebf381 moved a dispatch whose parent is listed out of the
// 「派发的会话」 group and into the parent's branch, and the smoke kept waiting in the old group
// for 75s. Render the real sidebar and run the probe's own selectors against it, so the two
// cannot drift apart again without this test failing.
const script = fileURLToPath(new URL('../ui/injections/laolao-session-list.js', import.meta.url));
const probe = fs.readFileSync(new URL('../tools/windows-smoke/upstream_probe.py', import.meta.url), 'utf8');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';

function probeSelectors() {
  const nested = probe.match(/def nested_child_selector\(parent\):[\s\S]*?return f'([^']+)'/);
  const orphan = probe.match(/^ORPHAN_GROUP_SELECTOR = '([^']+)'$/m);
  assert.ok(nested && orphan, 'upstream_probe.py no longer defines the sidebar selectors this test checks');
  return {nested: parent => nested[1].replace('{parent}', parent), orphan: orphan[1]};
}

test(`the Windows smoke finds a Metre dispatch where the sidebar puts it (${engine})`, {timeout: 30_000}, async () => {
  const selectors = probeSelectors();
  const browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  try {
    const tab = await browser.newPage();
    await tab.route('http://127.0.0.1:30113/**', route => route.fulfill({contentType: 'text/html', body: '<section id="sidebar"></section>'}));
    await tab.goto('http://127.0.0.1:30113/');
    await tab.addScriptTag({path: script});
    // The smoke's parent: a fresh Metre conversation it folds before sending, then dispatches from.
    const parent = 'agent:metre:sidebar-smoke-0a1b2c3d', child = 'agent:project:pinkie-child:ef27';
    const lost = 'agent:project:pinkie-child:lost';
    await tab.evaluate(({parent, child, lost}) => {
      localStorage.setItem('pinkie:session-sidebar:fold:' + parent, '1');
      const qa = window.qa = {};
      qa.api = {mode: 'metre', agentId: 'metre', currentKey: parent, state: {
        pins: [], collapsed: {}, projects: {}, projectFolders: {},
      }, gwRequest: async (method, params) => {
        if (method === 'sessions.list') return {sessions: params.agentId === 'metre'
          ? [{key: parent, label: 'METRE-SIDEBAR-PROBE', lastMessagePreview: '续上了', updatedAt: 10, hasActiveRun: true}] : []};
        if (method === 'pinkie.session.lineage') return {away: {
          [child]: {parentKey: parent, title: '整理侧栏验收提纲', mode: 'project', updatedAt: 11, hasActiveRun: true, status: 'running'},
          [lost]: {parentKey: 'agent:metre:gone', title: '找不到父会话', mode: 'project', updatedAt: 3},
        }, children: {}};
        if (method === 'pinkie.session.search') return {results: []};
        return {rows: {}};
      }, toast(message) { throw Error(message); }};
      window.PinkieSessionList.render(document.querySelector('#sidebar'), qa.api);
    }, {parent, child, lost});
    const entry = tab.locator(selectors.nested(parent)).filter({hasText: '整理侧栏验收提纲'});
    await entry.waitFor({state: 'visible'});
    assert.equal(await entry.getAttribute('data-session-key'), child);
    assert.equal(await entry.getByRole('link', {name: '整理侧栏验收提纲', exact: true}).count(), 1);
    // The listed parent's dispatch is not also in the orphan group; a lost parent's still is.
    assert.equal(await tab.locator(`${selectors.orphan} [data-session-key="${child}"]`).count(), 0);
    assert.equal(await tab.locator(`${selectors.orphan} [data-session-key="${lost}"]`).count(), 1);
    assert.equal(await tab.locator(selectors.nested(parent)).filter({hasText: '找不到父会话'}).count(), 0);
  } finally { await browser.close(); }
});
