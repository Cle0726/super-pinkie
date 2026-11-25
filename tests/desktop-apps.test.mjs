import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ArtifactStore} from '../services/mode-architecture/artifacts.mjs';
import {DesktopApps, OFFLINE_CSP, appIdFor, icnsFromPng, icoFromPng, registerDesktopApps, safeAppName, withOfflinePolicy}
  from '../services/mode-architecture/desktop-apps.mjs';

// 作品装成桌面应用（PR①）网关这一半：拷副本、默认不联网、图标、重装、卸载。
const tmp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const KEY = 'agent:project:dashboard:7d2c1f4e';
// 1×1 透明 PNG（真文件头 + IHDR）。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ICON = 'data:image/png;base64,' + PNG.toString('base64');

function setup() {
  const dir = tmp('apps-');
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
function fakeApi() {
  const methods = {};
  return {
    registerGatewayMethod(name, fn) { methods[name] = fn; },
    async call(name, params) { let out; await methods[name]({params, respond: (ok, value, error) => { out = ok ? value : {rpcError: error}; }}); return out; },
  };
}

test('A1 安装：html 作品拷成 apps/<id>/index.html，CSP 在第一个脚本之前；非网页作品装不了', () => {
  const {record, apps, artifacts} = setup();
  const item = record('game.html', '<!doctype html><html><head><script>window.x=1</script></head><body>hi</body></html>');
  // 前提：作品库里有这件作品、还没装过。
  assert.equal(artifacts.get(item.id).item.kind, 'html');
  assert.equal(apps.forArtifact(item.id).app, null);
  const out = apps.install({id: item.id, name: '单词小游戏', icon: ICON});
  assert.equal(out.ok, true);
  assert.equal(out.replaced, false);
  const html = fs.readFileSync(out.app.entry, 'utf8');
  const csp = html.indexOf('Content-Security-Policy');
  assert.ok(csp > 0 && csp < html.indexOf('<script>'), 'CSP 要在页面脚本之前');
  assert.ok(html.includes("connect-src 'none'"));
  assert.deepEqual(out.app.network, [], 'PR② 起 network 是放行来源清单，空的就是不联网');
  assert.equal(out.app.name, '单词小游戏');
  assert.equal(out.app.id, appIdFor(item.id));
  assert.ok(fs.existsSync(out.app.icon.ico) && fs.existsSync(out.app.icon.icns));
  assert.equal(apps.forArtifact(item.id).app.id, out.app.id);
  // 反例：markdown 作品不能装。
  const md = record('notes.md', '# hi');
  assert.throws(() => apps.install({id: md.id}), /只有网页作品/);
  assert.equal(apps.list().apps.length, 1);
});

test('A2 拷的是快照：原文件之后被改或删掉，已装的应用照样能用', () => {
  const {dir, record, apps} = setup();
  const item = record('tool.html', '<p>v1</p>');
  const {app} = apps.install({id: item.id});
  fs.writeFileSync(path.join(dir, 'tool.html'), '<p>changed</p>');
  fs.rmSync(path.join(dir, 'tool.html'));
  assert.match(fs.readFileSync(app.entry, 'utf8'), /<p>v1<\/p>/);
  assert.ok(!app.entry.startsWith(path.join(dir, 'tool')), '入口在碧琪数据目录里，不指向原文件');
});

test('A3 重装同一件作品：id 不变、覆盖成最新版本、报出旧名字；不留暂存目录', () => {
  const {dir, record, apps} = setup();
  const first = record('page.html', '<p>one</p>');
  const a = apps.install({id: first.id, name: '旧名'});
  record('page.html', '<p>two</p>');
  const b = apps.install({id: first.id, name: '新名'});
  assert.equal(b.app.id, a.app.id);
  assert.equal(b.replaced, true);
  assert.equal(b.previousName, '旧名');
  assert.equal(b.app.version, 2);
  assert.match(fs.readFileSync(b.app.entry, 'utf8'), /two/);
  assert.equal(b.app.installedAt, a.app.installedAt);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'apps')).filter(name => name.includes('staging')), []);
  // 反例：没给图标就没有图标文件（原生端用碧琪默认图标），不会留下上次的。
  assert.equal(b.app.icon.ico, '');
});

test('A4 卸载：副本目录和记录都删掉；再删一次不报错；没装过的 get 报错', () => {
  const {record, apps} = setup();
  const item = record('x.html', '<p>x</p>');
  const {app} = apps.install({id: item.id, icon: ICON});
  assert.ok(fs.existsSync(app.dir));
  assert.deepEqual(apps.remove(app.id), {ok: true, removed: true, name: 'x'});
  assert.equal(fs.existsSync(app.dir), false);
  assert.equal(apps.list().apps.length, 0);
  assert.deepEqual(apps.remove(app.id), {ok: true, removed: false});
  assert.throws(() => apps.get(app.id), /没有装过/);
});

test('A5 名字做文件名：去掉非法字符、保留中文、保留字加后缀、空名兜底', () => {
  assert.equal(safeAppName('我的:游戏/第*1版?.html'), '我的 游戏 第 1版');
  assert.equal(safeAppName('  ...  '), '作品');
  assert.equal(safeAppName('CON'), 'CON 作品');
  assert.equal([...safeAppName('长'.repeat(80))].length, 40);
  // 反例：正常名字原样不动。
  assert.equal(safeAppName('单词卡 Pro'), '单词卡 Pro');
});

test('A6 CSP 插入点：有 head 进 head；只有 html / doctype 跟在后面；片段放最前；规则本身禁网', () => {
  assert.match(withOfflinePolicy('<html lang="zh"><head><title>t</title></head></html>'), /<head><meta http-equiv="Content-Security-Policy"/);
  assert.match(withOfflinePolicy('<!doctype html><html><body>b</body></html>'), /^<!doctype html><html><meta /);
  assert.match(withOfflinePolicy('<p>片段</p><script>1</script>'), /^<meta http-equiv/);
  for (const rule of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"]) assert.ok(OFFLINE_CSP.includes(rule), rule);
  // 反例：不放行任何 http(s) 来源。
  assert.doesNotMatch(OFFLINE_CSP, /https?:|\*/);
});

test('A7 图标：PNG 包成 ICO / ICNS 文件头正确；不是 PNG 的拒收', () => {
  const ico = icoFromPng(PNG);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.equal(ico.readUInt32LE(14), PNG.length);
  assert.ok(ico.subarray(22).equals(PNG));
  const icns = icnsFromPng(PNG);
  assert.equal(icns.toString('latin1', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(icns.toString('latin1', 8, 12), 'ic08');
  assert.throws(() => icoFromPng(Buffer.from('GIF89a......................')), /不是 PNG/);
  const {record, apps} = setup();
  const item = record('y.html', '<p>y</p>');
  assert.throws(() => apps.install({id: item.id, icon: 'data:image/png;base64,' + Buffer.from('not a png at all, no').toString('base64')}), /图标不对/);
  assert.equal(apps.list().apps.length, 0, '图标不对时什么都不装');
});

test('A8 网关方法：pinkie.apps.* 都在，出错回 {ok:false} 不抛', async () => {
  const {dir, record, artifacts} = setup();
  const api = fakeApi();
  registerDesktopApps(api, {root: path.join(dir, 'apps2'), artifacts});
  const item = record('z.html', '<p>z</p>');
  const out = await api.call('pinkie.apps.install', {id: item.id, name: 'Z'});
  assert.equal(out.ok, true);
  assert.equal((await api.call('pinkie.apps.list', {})).apps.length, 1);
  assert.equal((await api.call('pinkie.apps.forArtifact', {id: item.id})).app.name, 'Z');
  assert.equal((await api.call('pinkie.apps.remove', {id: out.app.id})).removed, true);
  const bad = await api.call('pinkie.apps.install', {id: 'nope'});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /作品库里没有/);
});
