import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AppBrowserServers, createAppBrowserTool, WINDOWS_APP_BROWSER_NOTE} from '../services/mode-architecture/app-browser.mjs';

// Windows 版没有 App 侧栏浏览器：打开类动作交给系统浏览器，查看/操作类动作指向 browser 工具。
function setup(t, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-winbrowser-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const opened = [];
  const servers = new AppBrowserServers({environment: {}, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser: true, systemOpener: async target => { opened.push(target); }, ...extra});
  t.after(() => servers.dispose?.());
  const tool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's1'}, {servers});
  const run = async params => (await tool.execute('call', params)).details;
  return {home: fs.realpathSync(home), opened, tool, run};
}

test('open and show_file reach the system browser / default app on Windows', async t => {
  const {home, opened, tool, run} = setup(t);
  assert.ok(tool.description.startsWith(WINDOWS_APP_BROWSER_NOTE));
  const page = await run({action: 'open', url: 'https://example.com/a?x=1&y=2'});
  assert.equal(page.ok, true);
  assert.equal(page.external, true);
  assert.match(page.note, /browser 工具/);
  assert.deepEqual(opened, ['https://example.com/a?x=1&y=2']);
  const file = path.join(home, 'report.html'); fs.writeFileSync(file, '<p>hi</p>');
  assert.equal((await run({action: 'show_file', path: file})).ok, true);
  assert.equal(opened.at(-1), file);
  assert.equal((await run({action: 'open', url: 'javascript:alert(1)'})).ok, false);
  assert.equal(opened.length, 2);
});

test('inspection and control actions point to the browser tool instead of retrying a missing sidebar', async t => {
  const {opened, run} = setup(t);
  for (const params of [{action: 'snapshot'}, {action: 'screenshot'}, {action: 'click', ref: 'e1'}, {action: 'batch', url: 'https://example.com', steps: [{action: 'click', ref: 'e1'}]}]) {
    const reply = await run(params);
    assert.equal(reply.ok, false, params.action);
    assert.match(reply.reason, /browser 工具/, params.action);
  }
  assert.equal(opened.length, 1, 'batch still showed the page to the user once');
});

test('serve starts the local preview and opens it in the system browser', async t => {
  const {home, opened, run} = setup(t);
  fs.writeFileSync(path.join(home, 'index.html'), '<h1>ok</h1>');
  const reply = await run({action: 'serve', dir: home});
  assert.equal(reply.ok, true, reply.reason);
  assert.equal(reply.external, true);
  assert.match(opened[0], /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal((await fetch(opened[0]).then(r => r.text())), '<h1>ok</h1>');
  await run({action: 'stop_serve', port: reply.port});
});

test('a connected sidebar endpoint or a non-Windows host keeps the native path', async t => {
  const {run, opened} = setup(t, {systemBrowser: false});
  const reply = await run({action: 'open', url: 'https://example.com'});
  assert.equal(reply.ok, false);
  assert.match(reply.reason, /侧栏浏览器尚未连接/);
  assert.equal(opened.length, 0);
});
