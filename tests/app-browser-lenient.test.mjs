// tools-health-1113 A6: app_browser accepts the shapes models actually write.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {AppBrowserServers, CERT_ERROR_NOTE, MAC_TAB_NOTE, appBrowserTimeout, createAppBrowserTool, friendlyBrowserReason} from '../services/mode-architecture/app-browser.mjs';

function setup(t, {systemBrowser = false} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-lenient-'));
  const opened = [];
  const servers = new AppBrowserServers({environment: {}, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser, systemOpener: async target => { opened.push(target); }});
  t.after(async () => { await servers.dispose?.(); fs.rmSync(home, {recursive: true, force: true}); });
  const sent = [];
  // Stand-in for the native browser: record exactly what reaches it.
  servers.request = async (action, params) => { sent.push({action, params, timeoutMs: appBrowserTimeout(action, params)}); return {ok: true, result: {page: {url: params.url || 'http://x/'}}}; };
  const tool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's1'}, {servers});
  const run = async params => (await tool.execute('call', params));
  return {home: fs.realpathSync(home), sent, opened, tool, run};
}

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); }); });

test('wait: a target plus ms waits for the target, at most ms', async t => {
  const {sent, run} = setup(t);
  const r = await run({action: 'wait', name: 'go', ms: 4000});
  assert.equal(r.isError, false);
  assert.equal(sent[0].params.name, 'go');
  assert.equal(sent[0].params.ms, undefined, 'ms is not passed on as a sleep');
  assert.equal(sent[0].params.timeout_ms, 4000);
  assert.equal(sent[0].timeoutMs, 4000);
  await run({action: 'wait', selector: '#go', ms: 60_000});
  assert.equal((await run({action: 'wait', selector: '#go', ms: 60_000})).details.ok, false, 'over 15 s is still refused');
  await run({action: 'wait', ms: 500});
  assert.equal(sent.at(-1).params.ms, 500, 'ms alone is a plain wait');
  await run({action: 'wait', text: '点到了'});
  assert.equal(sent.at(-1).timeoutMs, 15_000, 'no ms: the usual 15 s ceiling');
  const bad = await run({action: 'wait', name: 'a', selector: '#b'});
  assert.equal(bad.details.ok, false, 'two targets are still ambiguous');
  assert.match(bad.details.reason, /可再加 ms 作为最长等待/);
  assert.equal((await run({action: 'wait'})).details.ok, false);
});

test('serve: dir + port starts a static server on that port; dir + command is the only conflict', async t => {
  const {home, run} = setup(t, {systemBrowser: true});
  const site = path.join(home, 'site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), '<p>ok</p>');
  const port = await freePort();
  const served = (await run({action: 'serve', dir: site, port})).details;
  assert.equal(served.ok, true, JSON.stringify(served));
  assert.match(served.url, new RegExp(`:${port}/`));
  assert.equal(await (await fetch(served.url)).text(), '<p>ok</p>');
  const both = (await run({action: 'serve', dir: site, command: 'npm run dev', cwd: site, port: port + 1})).details;
  assert.equal(both.ok, false);
  assert.match(both.reason, /dir（可加 port 指定端口）/);
});

test('tab on the Mac: op=new with a url opens it; other ops explain and are not errors', async t => {
  const {sent, run} = setup(t, {systemBrowser: false});
  const opened = await run({action: 'tab', op: 'new', url: 'https://example.com/'});
  assert.equal(opened.isError, false);
  assert.equal(sent[0].action, 'open');
  assert.equal(sent[0].params.url, 'https://example.com/');
  for (const params of [{action: 'tab'}, {action: 'tab', op: 'list'}, {action: 'tab', op: 'switch', tabId: 't2'}, {action: 'tab', op: 'new'}]) {
    const r = await run(params);
    assert.equal(r.isError, false, JSON.stringify(params));
    assert.equal(r.details.message, MAC_TAB_NOTE);
  }
  assert.equal(sent.length, 1, 'nothing else reached the browser');
});

test('certificate errors read as one Chinese sentence with a next step', async t => {
  for (const raw of ['net::ERR_CERT_DATE_INVALID', 'NSURLErrorDomain: The certificate for this server is invalid.', 'ERR_SSL_PROTOCOL_ERROR']) {
    assert.equal(friendlyBrowserReason(raw), CERT_ERROR_NOTE);
  }
  assert.equal(friendlyBrowserReason('等待的内容没有出现，请先观察页面。'), '等待的内容没有出现，请先观察页面。');
  const {tool} = setup(t);

  assert.match(tool.description, /name\+ms=4000/);
  assert.match(tool.description, /静态页填dir（可加port指定端口）/);
});
