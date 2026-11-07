import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {AppBrowserServers, createAppBrowserTool, WINDOWS_APP_BROWSER_NOTE, WINDOWS_INAPP_BROWSER_NOTE, appBrowserEndpoint} from '../services/mode-architecture/app-browser.mjs';

// Windows: the App's own browser window is reached through a loopback port
// named in an endpoint file; without that file the tool falls back to the
// system browser as before.
function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-winendpoint-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  return home;
}

test('requests go to the loopback endpoint with its token; system browser is not used', async t => {
  const home = tempHome(t);
  const seen = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffered = '';
    socket.on('data', chunk => {
      buffered += chunk;
      if (!buffered.includes('\n')) return;
      const request = JSON.parse(buffered.split('\n')[0]);
      seen.push(request);
      socket.end(JSON.stringify({id: request.id, ok: true, result: {url: request.url, page: {url: request.url}, observation: {elements: []}}}) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpointFile = path.join(home, 'endpoint.json');
  fs.writeFileSync(endpointFile, JSON.stringify({v: 1, host: '127.0.0.1', port: server.address().port, token: 'a'.repeat(48)}));
  const environment = {PINKIE_APP_BROWSER_ENDPOINT: JSON.stringify({v: 1, endpointFile})};
  const opened = [];
  const servers = new AppBrowserServers({environment, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser: true, systemOpener: async target => { opened.push(target); }});
  t.after(() => servers.dispose?.());
  const tool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's1'}, {servers});
  assert.ok(!tool.description.startsWith(WINDOWS_APP_BROWSER_NOTE), 'no "no sidebar" note when the App browser exists');
  const reply = (await tool.execute('call', {action: 'open', url: 'https://example.com/'})).details;
  assert.equal(reply.ok, true);
  assert.equal(reply.external, undefined);
  assert.deepEqual(opened, []);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, 'open');
  assert.equal(seen[0].token, 'a'.repeat(48));
});

test('missing endpoint file falls back to the system browser; non-loopback endpoints are refused', async t => {
  const home = tempHome(t);
  const endpointFile = path.join(home, 'gone.json');
  const environment = {PINKIE_APP_BROWSER_ENDPOINT: JSON.stringify({v: 1, endpointFile})};
  const opened = [];
  const servers = new AppBrowserServers({environment, homeDirectory: home, memoryFile: path.join(home, 'memory.json'),
    systemBrowser: true, systemOpener: async target => { opened.push(target); }});
  t.after(() => servers.dispose?.());
  const tool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's1'}, {servers});
  const reply = (await tool.execute('call', {action: 'open', url: 'https://example.com/'})).details;
  assert.equal(reply.external, true);
  assert.deepEqual(opened, ['https://example.com/']);

  fs.writeFileSync(endpointFile, JSON.stringify({host: '10.0.0.5', port: 4000, token: 'b'.repeat(48)}));
  assert.throws(() => appBrowserEndpoint(environment), /连接信息无效/);
  fs.writeFileSync(endpointFile, JSON.stringify({host: '127.0.0.1', port: 4000, token: 'short'}));
  assert.throws(() => appBrowserEndpoint(environment), /连接信息无效/);
});

// 碧琪 drives her own Windows browser's tabs, window and node through the
// same endpoint; on a Mac these Windows-only actions are refused up front.
test('vpn / tab / window go to the Windows browser and the description teaches them', async t => {
  const home = tempHome(t);
  const seen = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffered = '';
    socket.on('data', chunk => {
      buffered += chunk;
      if (!buffered.includes('\n')) return;
      const request = JSON.parse(buffered.split('\n')[0]);
      seen.push(request);
      const result = request.action === 'vpn'
        ? {message: '已选最快的「JP」（80 ms）。', node: 'JP', network: {mode: '节点：JP', nodeCount: 2}}
        : {tabs: [{id: 't1', active: true}]};
      socket.end(JSON.stringify({id: request.id, ok: true, result}) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpointFile = path.join(home, 'endpoint.json');
  fs.writeFileSync(endpointFile, JSON.stringify({v: 1, host: '127.0.0.1', port: server.address().port, token: 'a'.repeat(48)}));
  const environment = {PINKIE_APP_BROWSER_ENDPOINT: JSON.stringify({v: 1, endpointFile})};
  const servers = new AppBrowserServers({environment, homeDirectory: home, memoryFile: path.join(home, 'memory.json'), systemBrowser: true});
  t.after(() => servers.dispose?.());
  const tool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's1'}, {servers});
  assert.ok(tool.description.startsWith(WINDOWS_INAPP_BROWSER_NOTE));
  assert.match(tool.description, /vpn op=best/);

  const best = (await tool.execute('call', {action: 'vpn', op: 'best', region: '日本', on: true})).details;
  assert.equal(best.ok, true);
  assert.equal(best.message, '已选最快的「JP」（80 ms）。');
  assert.equal(best.network.mode, '节点：JP');
  assert.deepEqual([seen[0].action, seen[0].op, seen[0].region, seen[0].on, seen[0].timeoutMs], ['vpn', 'best', '日本', true, 60000]);
  // Bad arguments never reach the browser.
  assert.equal((await tool.execute('call', {action: 'vpn', op: 'enable'})).details.ok, false);
  assert.equal((await tool.execute('call', {action: 'vpn', op: 'select'})).details.ok, false);
  assert.equal((await tool.execute('call', {action: 'tab', op: 'close'})).details.ok, false);
  assert.equal(seen.length, 1);
  assert.equal((await tool.execute('call', {action: 'tab', op: 'list'})).details.ok, true);
  assert.equal((await tool.execute('call', {action: 'window', mode: 'dock'})).details.ok, true);
  assert.deepEqual(seen.slice(1).map(r => [r.action, r.op ?? r.mode]), [['tab', 'list'], ['window', 'dock']]);

  const mac = new AppBrowserServers({environment, homeDirectory: home, memoryFile: path.join(home, 'memory2.json'), systemBrowser: false});
  t.after(() => mac.dispose?.());
  const macTool = createAppBrowserTool({sessionKey: 'agent:main:main', sessionId: 's2'}, {servers: mac});
  assert.ok(!macTool.description.includes('Windows 版·碧琪自己的浏览器'));
  const refused = (await macTool.execute('call', {action: 'vpn', op: 'status'})).details;
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /只有 Windows 版/);
  assert.equal(seen.length, 3);
});
