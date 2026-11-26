import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ArtifactStore} from '../services/mode-architecture/artifacts.mjs';
import {DesktopApps, FILE_GUARD, OFFLINE_CSP, needsOf, policyFor, withPolicy} from '../services/mode-architecture/desktop-apps.mjs';

// 作品装成桌面应用 PR②：联网 / 读文件的勾选、「更新成新版本」。
const tmp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const KEY = 'agent:project:dashboard:7d2c1f4e';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ICON = 'data:image/png;base64,' + PNG.toString('base64');
const WEATHER = '<html><head><script>fetch("https://api.weather.example/v1?q=1").then(r=>r.json())</script></head>'
  + '<body><img src="https://cdn.example.com:8443/a.png"><a href="http://www.w3.org/2000/svg">x</a></body></html>';

function setup() {
  const dir = tmp('apps-perm-');
  const artifacts = new ArtifactStore(path.join(dir, 'artifacts'));
  const record = (name, body) => { const file = path.join(dir, name); fs.writeFileSync(file, body); return artifacts.record({file, sessionKey: KEY, runId: 'r'}); };
  let clock = 1000;
  return {dir, artifacts, record, apps: new DesktopApps(path.join(dir, 'apps'), {artifacts, now: () => ++clock})};
}
const cspOf = html => /content="([^"]+)"/.exec(html)[1];

test('P1 needsOf：列出作品写死的 http(s)/ws(s) 来源（去重、排序、去掉 w3.org 命名空间），认出文件选择框', () => {
  assert.deepEqual(needsOf(WEATHER), {network: ['https://api.weather.example', 'https://cdn.example.com:8443'], files: false});
  assert.equal(needsOf('<input type="file" accept="image/*">').files, true);
  assert.equal(needsOf('<script>showOpenFilePicker()</script>').files, true);
  assert.deepEqual(needsOf('<p>纯本地</p><a href="./x.html">x</a>'), {network: [], files: false});
  assert.deepEqual(needsOf('wss://live.example.org:9000/socket').network, ['wss://live.example.org:9000']);
});

test('P2 policyFor：没勾等于离线 CSP；勾了只对那几个来源放开，default-src 仍是 none，不出现通配', () => {
  assert.equal(policyFor({}), OFFLINE_CSP);
  const csp = policyFor({origins: ['https://api.weather.example', 'javascript:alert(1)', 'https://*.evil', '*']});
  assert.match(csp, /connect-src https:\/\/api\.weather\.example(;|$)/);
  assert.match(csp, /img-src data: blob: https:\/\/api\.weather\.example/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.doesNotMatch(csp, /\*|javascript:/, '非法来源一律丢掉');
});

test('P3 安装：勾了联网就只放行勾的、而且作品里真用到的来源；没勾读文件就带守卫脚本，守卫在作品脚本之前', () => {
  const {record, apps} = setup();
  const item = record('weather.html', WEATHER);
  // 前提：安装前能读到它要什么。
  assert.deepEqual(apps.needs(item.id).network, ['https://api.weather.example', 'https://cdn.example.com:8443']);
  const out = apps.install({id: item.id, icon: ICON, network: ['https://api.weather.example', 'https://not-in-the-work.example'], files: false});
  const html = fs.readFileSync(out.app.entry, 'utf8');
  const csp = cspOf(html);
  assert.match(csp, /connect-src https:\/\/api\.weather\.example(;|$)/);
  assert.doesNotMatch(csp, /not-in-the-work|cdn\.example/, '没勾的、作品里没有的都不放行');
  assert.deepEqual(out.app.network, ['https://api.weather.example']);
  assert.equal(out.app.files, false);
  const guard = html.indexOf(FILE_GUARD);
  assert.ok(guard > 0 && guard < html.indexOf('<script>fetch'), '守卫要在作品自己的脚本之前');
  // 反例：勾了读文件就没有守卫；不传 network 等于离线。
  const files = record('pick.html', '<head></head><input type=file>');
  const picked = apps.install({id: files.id, files: true});
  assert.ok(!fs.readFileSync(picked.app.entry, 'utf8').includes(FILE_GUARD));
  assert.equal(cspOf(fs.readFileSync(picked.app.entry, 'utf8')), OFFLINE_CSP);
  assert.equal(picked.app.files, true);
});

test('P4 更新成新版本：名字、图标、勾选都留着；新版本多出来的来源不自动放行，报出来', () => {
  const {record, apps} = setup();
  const item = record('w.html', WEATHER);
  const first = apps.install({id: item.id, name: '天气', icon: ICON, network: ['https://api.weather.example']});
  record('w.html', WEATHER.replace('</body>', '<script>new WebSocket("wss://push.example.net")</script></body>'));
  assert.equal(apps.get(first.app.id).app.latest, 2, '前提：作品有新版本了');
  const up = apps.update(first.app.id);
  assert.equal(up.app.version, 2);
  assert.equal(up.app.name, '天气');
  assert.deepEqual(up.app.network, ['https://api.weather.example']);
  assert.ok(fs.readFileSync(up.app.icon.png).equals(PNG), '图标沿用');
  assert.deepEqual(up.newOrigins, ['https://cdn.example.com:8443', 'wss://push.example.net']);
  assert.match(fs.readFileSync(up.app.entry, 'utf8'), /push\.example\.net/);
  assert.doesNotMatch(cspOf(fs.readFileSync(up.app.entry, 'utf8')), /push\.example\.net/, '新来源没放行');
  // 反例：没装过的更新报错。
  assert.throws(() => apps.update('w0000000000000000'), /没有装过/);
});

test('P5 withPolicy 插入点同 PR①：有 head 进 head；守卫跟在 CSP 后面', () => {
  const html = withPolicy('<!doctype html><html><head><title>t</title></head></html>', {});
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf(FILE_GUARD));
  assert.ok(html.indexOf(FILE_GUARD) < html.indexOf('<title>'));
});
