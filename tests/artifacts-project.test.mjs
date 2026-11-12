import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ArtifactStore, artifactId, producedPaths, registerArtifacts, kindOf} from '../services/mode-architecture/artifacts.mjs';
import {ProjectSettings, projectPrompt, registerProjectSettings, MAX_INSTRUCTIONS} from '../services/mode-architecture/project-settings.mjs';

const tmp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const KEY = 'agent:main:dashboard:7d2c1f4e';
const TEMP = 'agent:main:dashboard:temp-0f8fad5b-d9cb-469f-a165-70867728950e';

function fakeApi() {
  const methods = {}, hooks = {};
  return {
    methods, hooks,
    registerGatewayMethod(name, fn) { methods[name] = fn; },
    on(name, fn) { (hooks[name] ||= []).push(fn); },
    async call(name, params) { let out; await methods[name]({params, respond: (ok, value, error) => { out = ok ? value : {rpcError: error}; }}); return out; },
  };
}

test('W1: html written and edited twice → 1 item, 3 versions; restore v1 adds v4', () => {
  const dir = tmp('art-');
  const store = new ArtifactStore(path.join(dir, 'state'));
  const file = path.join(dir, 'page.html');
  for (const body of ['<p>one</p>', '<p>two</p>', '<p>three</p>']) { fs.writeFileSync(file, body); store.record({file, sessionKey: KEY, runId: 'r-' + body.length}); }
  store.record({file, sessionKey: KEY, runId: 'same'});
  const list = store.list({mode: 'work'});
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].total, 3);
  assert.equal(list.items[0].kind, 'html');
  assert.equal(list.items[0].mode, 'main');
  const id = list.items[0].id;
  assert.equal(fs.readFileSync(store.versionPath(id, 1).path, 'utf8'), '<p>one</p>');
  const restored = store.restore(id, 1);
  assert.equal(restored.v, 4);
  assert.equal(fs.readFileSync(file, 'utf8'), '<p>one</p>');
  assert.equal(store.get(id).item.versions.at(-1).source, 'restore');
  const preview = store.read(id, 2);
  assert.equal(preview.data, '<p>two</p>');
  assert.equal(preview.encoding, 'utf8');
  store.remove(id);
  assert.equal(store.list({}).items.length, 0);
  assert.ok(fs.existsSync(file), '移除只删索引，不删磁盘文件');
});

test('W1: > 20MB only recorded, no snapshot; latest still openable', () => {
  const dir = tmp('art-');
  const store = new ArtifactStore(path.join(dir, 'state'), {limits: {snapshotBytes: 10}});
  const file = path.join(dir, 'big.png');
  fs.writeFileSync(file, Buffer.alloc(50, 1));
  const item = store.record({file, sessionKey: KEY});
  assert.equal(item.versions[0].snapshot, null);
  assert.equal(store.versionPath(item.id, 1).path, file);
  fs.writeFileSync(file, Buffer.alloc(60, 2));
  store.record({file, sessionKey: KEY});
  assert.throws(() => store.versionPath(item.id, 1), /太大/);
  assert.throws(() => store.restore(item.id, 1), /太大/);
});

test('W1 quota: 50 versions per item, total cap drops oldest but never a latest', () => {
  const dir = tmp('art-');
  let clock = 1000;
  const store = new ArtifactStore(path.join(dir, 'state'), {now: () => ++clock, limits: {versions: 5, totalBytes: 40}});
  const a = path.join(dir, 'a.md'), b = path.join(dir, 'b.md');
  for (let i = 0; i < 8; i++) { fs.writeFileSync(a, 'a'.repeat(10) + i); store.record({file: a, sessionKey: KEY}); }
  const itemA = store.item(artifactId(a));
  assert.ok(itemA.versions.length <= 5);
  // a's snapshots are 11 bytes each; total cap 40 keeps at most 3 snapshots overall.
  fs.writeFileSync(b, 'b'.repeat(20)); store.record({file: b, sessionKey: KEY});
  const items = store.list({}).items;
  let total = 0;
  for (const item of Object.values(store.load().items)) for (const v of item.versions) total += v.snapshot ? v.size : 0;
  assert.ok(total <= 40, 'total ' + total);
  for (const item of items) assert.ok(item.total >= 1, '每件至少留最新版');
  assert.equal(store.item(artifactId(a)).versions.at(-1).v, 8);
  for (const item of Object.values(store.load().items)) for (const v of item.versions) if (v.snapshot) assert.ok(fs.existsSync(v.snapshot));
  // Even if a single latest version is over the cap, it stays.
  const c = path.join(dir, 'c.csv'); fs.writeFileSync(c, 'x'.repeat(100)); store.record({file: c, sessionKey: KEY});
  assert.equal(store.item(artifactId(c)).versions.length, 1);
  assert.equal(store.item(artifactId(a)).versions.length, 1);
});

test('W1: index is written atomically and survives a reload', () => {
  const dir = tmp('art-');
  const root = path.join(dir, 'state');
  const file = path.join(dir, 'x.svg'); fs.writeFileSync(file, '<svg/>');
  new ArtifactStore(root).record({file, sessionKey: KEY, runId: 'r1'});
  assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.tmp')), []);
  const again = new ArtifactStore(root);
  assert.equal(again.list({runId: 'r1'}).items.length, 1);
  assert.equal(again.list({kind: 'image'}).items.length, 1);
  assert.equal(again.list({kind: 'doc'}).items.length, 0);
  assert.equal(again.list({query: 'X.SV'}).items.length, 1);
  assert.equal(again.list({mode: 'learning'}).items.length, 0);
});

test('W1: producedPaths reads writers, patches and generator results', () => {
  assert.deepEqual(producedPaths({toolName: 'write', params: {path: 'a.html', content: 'x'}}), ['a.html']);
  assert.deepEqual(producedPaths({toolName: 'write', params: {path: 'a.txt'}}), []);
  assert.deepEqual(producedPaths({toolName: 'apply_patch', params: {input: '*** Begin Patch\n*** Add File: docs/n.md\n+x\n*** End Patch'}}), ['docs/n.md']);
  assert.deepEqual(producedPaths({toolName: 'image_generate', params: {prompt: 'cat'}, result: {content: [{type: 'text', text: 'saved /tmp/x/cat.png.'}]}}), ['/tmp/x/cat.png']);
  assert.deepEqual(producedPaths({toolName: 'exec', params: {command: 'touch a.html'}}), []);
  assert.equal(kindOf('a.PPTX'), 'slides');
});

test('W1 hook: records inside workspace/project, skips outside, failures and temp sessions; methods respond', async () => {
  const dir = tmp('art-');
  const stateDir = path.join(dir, 'openclaw');
  const workspace = path.join(stateDir, 'workspace');
  const project = path.join(dir, 'proj');
  fs.mkdirSync(workspace, {recursive: true}); fs.mkdirSync(project);
  const bindingsFile = path.join(dir, 'bindings.json');
  fs.writeFileSync(bindingsFile, JSON.stringify({[KEY]: {root: project, name: '示例'}}));
  const api = fakeApi();
  const store = registerArtifacts(api, {root: path.join(dir, 'artifacts'), stateDir, bindingsFile, home: dir});
  const hook = api.hooks.after_tool_call[0];
  fs.writeFileSync(path.join(workspace, 'w.html'), '<p>w</p>');
  fs.writeFileSync(path.join(project, 'p.md'), '# p');
  fs.writeFileSync(path.join(dir, 'outside.md'), 'o');
  hook({toolName: 'write', params: {path: path.join(workspace, 'w.html')}}, {sessionKey: KEY, runId: 'run-1', workspaceDir: workspace});
  hook({toolName: 'write', params: {path: 'p.md'}}, {sessionKey: KEY, runId: 'run-1', workspaceDir: workspace});
  hook({toolName: 'write', params: {path: path.join(dir, 'outside.md')}}, {sessionKey: KEY, runId: 'run-1', workspaceDir: workspace});
  hook({toolName: 'write', params: {path: path.join(workspace, 'w.html')}, error: 'boom'}, {sessionKey: KEY, runId: 'run-2', workspaceDir: workspace});
  fs.writeFileSync(path.join(workspace, 't.html'), 't');
  hook({toolName: 'write', params: {path: path.join(workspace, 't.html')}}, {sessionKey: TEMP, runId: 'run-3', workspaceDir: workspace});
  const listed = await api.call('pinkie.artifacts.list', {runId: 'run-1'});
  assert.deepEqual(listed.items.map(item => item.title).sort(), ['p.md', 'w.html']);
  assert.equal((await api.call('pinkie.artifacts.list', {})).items.length, 2);
  const got = await api.call('pinkie.artifacts.get', {id: 'nope'});
  assert.equal(got.ok, false);
  assert.match(got.error, /没有这件作品/);
  const id = listed.items[0].id;
  assert.ok((await api.call('pinkie.artifacts.version', {id, v: 1})).path);
  assert.deepEqual(await api.call('pinkie.artifacts.remove', {id}), {ok: true});
  assert.equal(store, registerArtifacts(fakeApi(), {root: path.join(dir, 'artifacts'), stateDir, bindingsFile}), '同一个 root 共用一个实例');
});

test('P1: settings keyed by folder, prompt per PROMPTS §6, pinned only paths inside the folder', async () => {
  const dir = tmp('proj-');
  const project = path.join(dir, 'proj'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'brief.md'), 'secret body');
  const bindingsFile = path.join(dir, 'bindings.json');
  fs.writeFileSync(bindingsFile, JSON.stringify({[KEY]: {root: project, name: '旧名'}}));
  const api = fakeApi();
  registerProjectSettings(api, {root: path.join(dir, 'state'), bindingsFile});
  const empty = await api.call('pinkie.project.settings.get', {name: '旧名'});
  assert.equal(empty.folder, project);
  assert.equal(empty.instructions, '');
  assert.deepEqual(await api.call('pinkie.project.settings.set', {name: '新名', folder: project, instructions: '回答结尾加一句：喵', pinned: ['brief.md']}), {ok: true});
  const got = await api.call('pinkie.project.settings.get', {name: '新名'});
  assert.deepEqual(got.pinned, [path.join(project, 'brief.md')]);
  const hook = api.hooks.before_prompt_build[0];
  const out = hook({}, {sessionKey: KEY}).appendSystemContext;
  assert.match(out, /【项目说明：新名】/);
  assert.match(out, /回答结尾加一句：喵/);
  assert.match(out, /【常看资料】（只是路径，需要时再去读）\n- .*brief\.md/);
  assert.ok(!out.includes('secret body'), '常看资料不塞全文');
  assert.equal(hook({}, {sessionKey: 'agent:main:dashboard:other'}), undefined, '项目外的会话不受影响');
  assert.match((await api.call('pinkie.project.settings.set', {folder: project, pinned: ['/etc/hosts']})).error, /项目文件夹里/);
  assert.match((await api.call('pinkie.project.settings.set', {folder: project, instructions: 'x'.repeat(MAX_INSTRUCTIONS + 1)})).error, /最多 8000/);
  assert.match((await api.call('pinkie.project.settings.set', {name: '没文件夹'})).error, /还没有文件夹/);
  const files = await api.call('pinkie.project.settings.files', {folder: project, query: 'brief'});
  assert.deepEqual(files.files.map(f => f.rel), ['brief.md']);
  assert.equal(projectPrompt('A', '说明', []).includes('常看资料'), false);
  assert.equal(projectPrompt('A', '', []), '');
  assert.ok(new ProjectSettings(path.join(dir, 'state'), {bindingsFile}).promptFor(KEY));
});
