import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ArtifactStore} from '../services/mode-architecture/artifacts.mjs';
import {DesktopApps, needsOf, policyFor} from '../services/mode-architecture/desktop-apps.mjs';

const KEY = 'agent:project:dashboard:7d2c1f4e';

function setup() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apps-port-')));
  const artifacts = new ArtifactStore(path.join(dir, 'artifacts'));
  const record = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return artifacts.record({file, sessionKey: KEY, runId: 'r1'});
  };
  let clock = 1000;
  const apps = new DesktopApps(path.join(dir, 'apps'), {artifacts, now: () => ++clock});
  return {dir, artifacts, record, apps};
}

test('默认端口和作品里不写端口是同一个来源，更新不把它报成新地址，也不丢掉已勾的放行', () => {
  const {dir, artifacts, record, apps} = setup();
  const item = record('api.html', '<script>fetch("https://api.example.com:443/v")</script>');
  const first = apps.install({id: item.id, name: '接口', network: ['https://api.example.com:443']});
  assert.deepEqual(first.app.network, ['https://api.example.com']);
  const html = fs.readFileSync(first.app.entry, 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)[1];
  assert.match(csp, /connect-src https:\/\/api\.example\.com;/);
  assert.equal(csp.includes(':443'), false);

  record('api.html', '<script>fetch("https://api.example.com/v")</script>');
  const dropped = apps.update(first.app.id);
  assert.deepEqual(dropped.newOrigins, []);
  assert.deepEqual(dropped.app.network, ['https://api.example.com']);

  const back = record('back.html', '<script>fetch("https://api.example.com/v")</script>');
  const plain = apps.install({id: back.id, name: '回程', network: ['https://api.example.com']});
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'apps', 'index.json'), 'utf8'));
  stored.apps[plain.app.id].network = ['https://api.example.com:443'];
  fs.writeFileSync(path.join(dir, 'apps', 'index.json'), JSON.stringify(stored));
  record('back.html', '<script>fetch("https://api.example.com:443/v")</script>');
  const reloaded = new DesktopApps(path.join(dir, 'apps'), {artifacts, now: () => 50});
  const kept = reloaded.update(plain.app.id);
  assert.deepEqual(kept.newOrigins, []);
  assert.deepEqual(kept.app.network, ['https://api.example.com']);
  assert.match(fs.readFileSync(kept.app.entry, 'utf8'), /connect-src https:\/\/api\.example\.com;/);
});

test('非默认端口、http 的 443、非法端口和 w3.org 的默认端口按字面处理', () => {
  assert.deepEqual(needsOf('fetch("https://cdn.example:8443/a")').network, ['https://cdn.example:8443']);
  assert.deepEqual(needsOf('fetch("http://api.example:443/v")').network, ['http://api.example:443']);
  assert.deepEqual(needsOf('fetch("https://api.example:00443/v") fetch("https://api.example:00080/v")').network,
    ['https://api.example', 'https://api.example:80']);
  assert.deepEqual(needsOf('http://files.example:80/a ws://files.example:80/a wss://files.example:443/a').network,
    ['http://files.example', 'ws://files.example', 'wss://files.example']);
  assert.deepEqual(needsOf('https://www.w3.org:443/svg https://api.example:65536/x https://api.example:99999/y').network, []);
  assert.equal(policyFor({origins: ['https://api.example:443']}).includes('https://api.example:443'), false);
  assert.match(policyFor({origins: ['https://cdn.example:8443']}), /https:\/\/cdn\.example:8443/);

  const {record, apps} = setup();
  const item = record('odd.html', '<script>fetch("https://cdn.example:8443/a")</script>');
  const installed = apps.install({id: item.id, name: '端口', network: ['https://cdn.example:8443']});
  record('odd.html', '<script>fetch("http://api.example/v")</script>');
  const changed = apps.update(installed.app.id);
  assert.deepEqual(changed.app.network, []);
  assert.deepEqual(changed.newOrigins, ['http://api.example']);

  const http443 = record('http443.html', '<script>fetch("http://api.example:443/v")</script>');
  const granted = apps.install({id: http443.id, name: '明文', network: ['http://api.example:443']});
  assert.deepEqual(granted.app.network, ['http://api.example:443']);
  record('http443.html', '<script>fetch("http://api.example/v")</script>');
  const notSame = apps.update(granted.app.id);
  assert.deepEqual(notSame.newOrigins, ['http://api.example']);
  assert.deepEqual(notSame.app.network, []);
});
